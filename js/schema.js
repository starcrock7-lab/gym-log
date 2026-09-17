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

export const SET_TYPES = ['working', 'warmup', 'drop', 'superset', 'amrap', 'failure'];

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
    equipment: exercise.equipment || 'Other',
    isBodyweight: Boolean(exercise.isBodyweight),
    isCustom: Boolean(exercise.isCustom),
    defaultRestSec: Number(exercise.defaultRestSec) || null,
    // How the exercise takes plates. null means "follow the defaults" (see
    // barSetup in calc.js), so an exercise nobody configured stays unconfigured
    // and keeps following them if its equipment changes.
    plateLoaded: typeof exercise.plateLoaded === 'boolean' ? exercise.plateLoaded : null,
    barWeightLb: Number.isFinite(Number(exercise.barWeightLb)) && exercise.barWeightLb !== null
      && exercise.barWeightLb !== '' && Number(exercise.barWeightLb) >= 0
      ? Number(exercise.barWeightLb) : null,
    loadedSides: exercise.loadedSides === 1 || exercise.loadedSides === 2 ? exercise.loadedSides : null,
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

// Rebuilds a routine's exercise list from one finished session of it: the
// exercises in the order you did them, with the number of sets you logged.
//
// A session records what you did, not what you planned, so rep range, rest and
// note are kept from the current routine wherever the exercise is still in it,
// and only worked out from the session's reps for an exercise the routine no
// longer has. Exercises that no longer resolve or were archived are left out
// and handed back by id, so the confirmation can say what was dropped rather
// than restoring a routine that silently has a hole in it.
export function exercisesFromSession(session, currentExercises = [], isAvailable = () => true) {
  const current = new Map(currentExercises.map((e) => [e.exerciseId, e]));
  const exercises = [];
  const skipped = [];

  for (const entry of session?.entries || []) {
    if (!isAvailable(entry.exerciseId)) { skipped.push(entry.exerciseId); continue; }
    if (exercises.some((e) => e.exerciseId === entry.exerciseId)) continue;

    const sets = entry.sets || [];
    const reps = sets.map((s) => Number(s.reps) || 0).filter((r) => r > 0);
    const before = current.get(entry.exerciseId);
    exercises.push({
      exerciseId: entry.exerciseId,
      targetSets: Math.max(1, sets.length),
      repsLow: before?.repsLow ?? (reps.length ? Math.min(...reps) : 8),
      repsHigh: before?.repsHigh ?? (reps.length ? Math.max(...reps) : 12),
      restSec: before?.restSec ?? null,
      note: before?.note ?? '',
      position: exercises.length,
    });
  }
  return { exercises, skipped };
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
