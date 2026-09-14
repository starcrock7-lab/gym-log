// The shape of everything on disk, plus the pure parts of import/export.
// Kept free of IndexedDB so it can be tested in Node.

export const DB_NAME = 'personal-gym';
export const DB_VERSION = 2;   // 2: muscleGroup -> muscleGroups

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
    // Which unit you type your body weight in. Storage and display stay in
    // pounds regardless — this only decides how a bare number is read.
    bodyWeightEntryUnit: 'lb',
    defaultRestSec: 120,
    dropPercent: 20,
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

// Accepts either shape — a single `muscleGroup` string from before the change,
// or a `muscleGroups` list — and always yields a non-empty, de-duplicated list.
// Values are not checked against MUSCLE_GROUPS: 'Other' was always a possible
// stored value and an import may carry a group this build has never heard of,
// and silently dropping someone's data is worse than carrying a stray label.
export function toMuscleGroups(exercise) {
  const raw = Array.isArray(exercise?.muscleGroups)
    ? exercise.muscleGroups
    : [exercise?.muscleGroup];
  const groups = [];
  for (const value of raw) {
    const name = String(value ?? '').trim();
    if (name && !groups.includes(name)) groups.push(name);
  }
  return groups.length ? groups : ['Other'];
}

export function normaliseExercise(exercise) {
  const muscleGroups = toMuscleGroups(exercise);
  return {
    id: exercise.id,
    name: String(exercise.name || '').trim(),
    muscleGroups,
    // Transitional alias. Every read site still expects a single value; step 3
    // of this change switches them to the list and this field goes away. It is
    // derived here and nowhere else, and seeding, saveExercise and import all
    // funnel through this function, so the two cannot drift apart.
    muscleGroup: muscleGroups[0],
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

// The rows an exercise should open with next time you do it: the session you
// actually did last, so six sets stay six sets with the weight used on each.
// `previousSets` is what came back from the last finished session (already
// stripped to the sets that were ticked), and `fallbackCount` is the routine's
// plan, used only when there is no history yet.
//
// Nothing is carried across as done — it is a starting point, not a record.
export function setsForNextSession(previousSets, fallbackCount = 3) {
  const previous = Array.isArray(previousSets) ? previousSets : [];
  const count = previous.length || Math.max(1, Math.floor(Number(fallbackCount) || 0) || 1);
  return Array.from({ length: count }, (_, i) => {
    const before = previous[i];
    return normaliseSet({
      weightLb: before?.weightLb ?? 0,
      reps: before?.reps ?? 0,
      // Keep the kind you actually did. A drop set opens as a drop set and a
      // set to failure as one, so a new session starts in the shape of the last
      // one. normaliseSet turns anything it does not recognise back to
      // 'working', and a row with no history behind it has no type to keep.
      type: before?.type,
      done: false,
    });
  });
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
