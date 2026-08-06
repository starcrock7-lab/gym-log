// The shape of everything on disk, plus the pure parts of import/export.
// Kept free of IndexedDB so it can be tested in Node.

export const DB_NAME = 'personal-gym';
export const DB_VERSION = 1;

export const STORE = {
  exercises: 'exercises',
  routines: 'routines',
  workouts: 'workouts',
  bodyWeights: 'bodyWeights',
  kv: 'kv',
};

// Singletons live in `kv` rather than getting a store each.
export const KV = {
  settings: 'settings',
  activeWorkout: 'activeWorkout',
  backupState: 'backupState',
  // The gist token and passphrase. Deliberately a separate key from
  // backupState so that export can never sweep them up by accident.
  backupAuth: 'backupAuth',
};

export const EXPORT_FORMAT = 'personal-gym-export';
export const EXPORT_VERSION = 1;

// Exactly what an export carries. `backupAuth` is absent on purpose: a backup
// file should never contain the credentials to reach another backup.
export const EXPORTED_STORES = ['exercises', 'routines', 'workouts', 'bodyWeights'];

export const SET_TYPES = ['working', 'warmup', 'drop', 'failure'];

export const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Full body', 'Cardio',
];

export const EQUIPMENT = [
  'Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'Other',
];

export function defaultSettings() {
  return {
    unit: 'lb',
    defaultRestSec: 120,
    barWeightLb: 45,
    plates: [45, 35, 25, 10, 5, 2.5],
    vibrate: true,
    sound: true,
    keepScreenAwake: true,
    autoBackup: true,
  };
}

export function defaultBackupState() {
  return { gistId: null, lastBackupAt: null, lastError: null, encrypted: true };
}

export function newId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function isoDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Import validation
// ---------------------------------------------------------------------------

// An import replaces everything, so a malformed file must be refused outright
// rather than half-loaded on top of a working history.
export function validateExport(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['File is not a JSON object'] };
  }
  if (payload.format !== EXPORT_FORMAT) {
    return { ok: false, errors: ['Not a Personal Gym backup file'] };
  }
  if (!Number.isInteger(payload.version) || payload.version < 1) {
    return { ok: false, errors: ['Backup is missing a usable version number'] };
  }
  if (payload.version > EXPORT_VERSION) {
    return {
      ok: false,
      errors: [`Backup was written by a newer version of the app (v${payload.version}). Update the app first.`],
    };
  }
  if (!payload.data || typeof payload.data !== 'object') {
    return { ok: false, errors: ['Backup has no data section'] };
  }

  for (const store of EXPORTED_STORES) {
    const rows = payload.data[store];
    if (rows !== undefined && !Array.isArray(rows)) errors.push(`"${store}" is not a list`);
  }

  for (const [i, workout] of (payload.data.workouts || []).entries()) {
    const where = `workout ${i + 1}`;
    if (!workout || typeof workout !== 'object') { errors.push(`${where} is not an object`); continue; }
    if (!workout.id) errors.push(`${where} has no id`);
    if (!workout.startedAt || Number.isNaN(Date.parse(workout.startedAt))) errors.push(`${where} has an unreadable start time`);
    if (workout.entries !== undefined && !Array.isArray(workout.entries)) errors.push(`${where} has a malformed exercise list`);
    for (const entry of workout.entries || []) {
      if (!entry?.exerciseId) errors.push(`${where} has an exercise with no id`);
      if (entry?.sets !== undefined && !Array.isArray(entry.sets)) errors.push(`${where} has a malformed set list`);
    }
  }

  for (const [i, exercise] of (payload.data.exercises || []).entries()) {
    if (!exercise?.id) errors.push(`exercise ${i + 1} has no id`);
    if (!exercise?.name) errors.push(`exercise ${i + 1} has no name`);
  }

  return { ok: errors.length === 0, errors };
}

// Normalises a validated payload into exactly what the stores expect, filling
// in fields added since the file was written.
export function normaliseExport(payload) {
  const data = payload.data || {};
  return {
    exercises: (data.exercises || []).map(normaliseExercise),
    routines: (data.routines || []).map(normaliseRoutine),
    workouts: (data.workouts || []).map(normaliseWorkout),
    bodyWeights: (data.bodyWeights || []).filter((b) => b?.date).map((b) => ({
      date: b.date,
      weightLb: Number(b.weightLb) || 0,
      note: b.note || '',
    })),
    settings: { ...defaultSettings(), ...(data.settings || {}) },
  };
}

export function normaliseExercise(exercise) {
  return {
    id: exercise.id,
    name: String(exercise.name || '').trim(),
    muscleGroup: exercise.muscleGroup || 'Other',
    equipment: exercise.equipment || 'Other',
    isBodyweight: Boolean(exercise.isBodyweight),
    isCustom: Boolean(exercise.isCustom),
    defaultRestSec: Number(exercise.defaultRestSec) || null,
    note: exercise.note || '',
    archived: Boolean(exercise.archived),
  };
}

export function normaliseRoutine(routine) {
  return {
    id: routine.id,
    name: String(routine.name || 'Untitled routine').trim(),
    note: routine.note || '',
    position: Number(routine.position) || 0,
    exercises: (routine.exercises || []).map((e, i) => ({
      exerciseId: e.exerciseId,
      targetSets: Number(e.targetSets) || 3,
      repsLow: Number(e.repsLow) || 8,
      repsHigh: Number(e.repsHigh) || Number(e.repsLow) || 12,
      restSec: Number(e.restSec) || null,
      note: e.note || '',
      position: Number(e.position ?? i),
    })),
  };
}

export function normaliseWorkout(workout) {
  return {
    id: workout.id,
    name: workout.name || 'Workout',
    routineId: workout.routineId || null,
    startedAt: workout.startedAt,
    finishedAt: workout.finishedAt || null,
    note: workout.note || '',
    bodyWeightLb: workout.bodyWeightLb ?? null,
    entries: (workout.entries || []).map((entry, i) => ({
      exerciseId: entry.exerciseId,
      position: Number(entry.position ?? i),
      note: entry.note || '',
      sets: (entry.sets || []).map(normaliseSet),
    })),
  };
}

export function normaliseSet(set) {
  const type = SET_TYPES.includes(set?.type) ? set.type : 'working';
  return {
    weightLb: Number(set?.weightLb) || 0,
    reps: Math.max(0, Math.floor(Number(set?.reps) || 0)),
    type,
    rpe: set?.rpe == null ? null : Number(set.rpe),
    done: Boolean(set?.done),
    doneAt: set?.doneAt || null,
  };
}

export function buildExport(data, exportedAt = new Date().toISOString()) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    data: {
      exercises: data.exercises || [],
      routines: data.routines || [],
      workouts: data.workouts || [],
      bodyWeights: data.bodyWeights || [],
      settings: data.settings || defaultSettings(),
    },
  };
}
