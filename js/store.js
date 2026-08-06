// All application state, held in memory and written straight back to IndexedDB.
//
// Everything is loaded once at boot. Five years of hard training is roughly a
// thousand workouts, which is nothing to hold in RAM, and it means history,
// charts and personal records read from one consistent snapshot instead of a
// derived index that can drift out of step with the log.

import * as db from './db.js';
import {
  STORE, KV, defaultSettings, defaultBackupState, newId, isoDay,
  normaliseExercise, normaliseRoutine, normaliseWorkout, normaliseSet,
} from './schema.js';
import { SEED_EXERCISES, SEED_ROUTINES } from './seed.js';

export const state = {
  ready: false,
  exercises: [],
  routines: [],
  workouts: [],
  bodyWeights: [],
  settings: defaultSettings(),
  backup: defaultBackupState(),
  active: null, // the in-progress workout, or null
  rest: null,   // { endsAt, durationSec, label } — wall-clock, so it survives sleep
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function init() {
  const [exercises, routines, workouts, bodyWeights, settings, backup, active, rest] = await Promise.all([
    db.getAll(STORE.exercises),
    db.getAll(STORE.routines),
    db.getAll(STORE.workouts),
    db.getAll(STORE.bodyWeights),
    db.getKv(KV.settings),
    db.getKv(KV.backupState),
    db.getKv(KV.activeWorkout),
    db.getKv('rest'),
  ]);

  state.exercises = exercises;
  state.routines = routines;
  state.workouts = workouts;
  state.bodyWeights = bodyWeights;
  state.settings = { ...defaultSettings(), ...(settings || {}) };
  state.backup = { ...defaultBackupState(), ...(backup || {}) };
  state.active = active || null;
  // A rest timer that expired while the app was closed is simply over.
  state.rest = rest && rest.endsAt > Date.now() ? rest : null;

  if (!state.exercises.length) await seedLibrary();

  state.ready = true;
  notify();
}

async function seedLibrary() {
  const exercises = SEED_EXERCISES.map(normaliseExercise);
  await db.putMany(STORE.exercises, exercises);
  state.exercises = exercises;

  const routines = SEED_ROUTINES.map((routine, index) =>
    normaliseRoutine({
      id: newId('rt'),
      name: routine.name,
      position: index,
      exercises: routine.exercises.map(([exerciseId, targetSets, repsLow, repsHigh], i) => ({
        exerciseId, targetSets, repsLow, repsHigh, position: i,
      })),
    }),
  );
  await db.putMany(STORE.routines, routines);
  state.routines = routines;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function exercisesById() {
  return new Map(state.exercises.map((e) => [e.id, e]));
}

export function exerciseById(id) {
  return state.exercises.find((e) => e.id === id) || null;
}

export function exerciseName(id) {
  return exerciseById(id)?.name || 'Unknown exercise';
}

export function routineById(id) {
  return state.routines.find((r) => r.id === id) || null;
}

export function workoutById(id) {
  return state.workouts.find((w) => w.id === id) || null;
}

// History, newest first. Excludes anything still in progress.
export function finishedWorkouts() {
  return state.workouts
    .filter((w) => w.finishedAt)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
}

export function latestBodyWeightLb(onOrBefore = null) {
  const rows = [...state.bodyWeights]
    .filter((b) => !onOrBefore || b.date <= onOrBefore)
    .sort((a, b) => a.date.localeCompare(b.date));
  return rows.length ? rows[rows.length - 1].weightLb : null;
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export async function saveExercise(partial) {
  const exercise = normaliseExercise({ id: partial.id || newId('ex'), isCustom: true, ...partial });
  await db.put(STORE.exercises, exercise);
  const i = state.exercises.findIndex((e) => e.id === exercise.id);
  if (i >= 0) state.exercises[i] = exercise;
  else state.exercises.push(exercise);
  notify();
  return exercise;
}

// Exercises are archived rather than deleted whenever history references them,
// so a past session can never end up pointing at nothing.
export async function removeExercise(id) {
  const used = state.workouts.some((w) => (w.entries || []).some((e) => e.exerciseId === id)) ||
    state.routines.some((r) => r.exercises.some((e) => e.exerciseId === id));
  if (used) {
    const exercise = exerciseById(id);
    return saveExercise({ ...exercise, archived: true });
  }
  await db.remove(STORE.exercises, id);
  state.exercises = state.exercises.filter((e) => e.id !== id);
  notify();
  return null;
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export async function saveRoutine(partial) {
  const routine = normaliseRoutine({
    id: partial.id || newId('rt'),
    position: partial.position ?? state.routines.length,
    ...partial,
  });
  await db.put(STORE.routines, routine);
  const i = state.routines.findIndex((r) => r.id === routine.id);
  if (i >= 0) state.routines[i] = routine;
  else state.routines.push(routine);
  notify();
  return routine;
}

export async function removeRoutine(id) {
  await db.remove(STORE.routines, id);
  state.routines = state.routines.filter((r) => r.id !== id);
  notify();
}

// ---------------------------------------------------------------------------
// The active workout
// ---------------------------------------------------------------------------

// Written on every single change. Close the tab, lose the browser, let the
// phone die mid-set — reopening lands you exactly where you were.
async function persistActive() {
  if (state.active) await db.setKv(KV.activeWorkout, state.active);
  else await db.deleteKv(KV.activeWorkout);
}

// Persists immediately; redraws only when asked.
//
// Typing a weight must never rebuild the screen. A redraw triggered by an
// input's change event fires while focus is moving to whatever you tapped
// next, which destroys that control before its click lands — you tap the tick,
// nothing happens, and the app feels broken. So value edits persist silently
// and the screen updates its own node; only structural changes (adding a set,
// removing an exercise) ask for a redraw.
export async function mutateActive(fn, { redraw = false } = {}) {
  if (!state.active) return;
  fn(state.active);
  await persistActive();
  if (redraw) notify();
}

export async function startWorkout({ routineId = null, name = null } = {}) {
  const routine = routineId ? routineById(routineId) : null;
  const bodyWeightLb = latestBodyWeightLb();

  state.active = {
    id: newId('w'),
    name: name || routine?.name || 'Workout',
    routineId: routineId || null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    note: '',
    bodyWeightLb,
    entries: (routine?.exercises || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((planned, index) => ({
        exerciseId: planned.exerciseId,
        position: index,
        note: '',
        // Rows are pre-created empty so the screen looks like the plan, and
        // pre-filled from last time so the number to beat is already there.
        sets: buildPlannedSets(planned),
      })),
  };
  await persistActive();
  notify();
  return state.active;
}

function buildPlannedSets(planned) {
  const previous = lastPerformanceSets(planned.exerciseId);
  const count = Math.max(1, planned.targetSets || 3);
  return Array.from({ length: count }, (_, i) => {
    const before = previous[i];
    return normaliseSet({
      weightLb: before?.weightLb ?? 0,
      reps: before?.reps ?? 0,
      type: before?.type === 'warmup' ? 'warmup' : 'working',
      done: false,
    });
  });
}

// The sets from the last session that included this exercise — warm-ups kept,
// so set 1 lines up with set 1.
export function lastPerformanceSets(exerciseId, excludeWorkoutId = null) {
  return lastPerformanceSession(exerciseId, excludeWorkoutId)?.sets || [];
}

export function lastPerformanceSession(exerciseId, excludeWorkoutId = null) {
  for (const workout of finishedWorkouts()) {
    if (workout.id === excludeWorkoutId) continue;
    const entry = (workout.entries || []).find((e) => e.exerciseId === exerciseId);
    if (entry && (entry.sets || []).some((s) => s.done)) {
      return { sets: entry.sets, at: workout.finishedAt, bodyWeightLb: workout.bodyWeightLb };
    }
  }
  return null;
}

export async function addExerciseToActive(exerciseId) {
  await mutateActive((workout) => {
    const previous = lastPerformanceSets(exerciseId);
    workout.entries.push({
      exerciseId,
      position: workout.entries.length,
      note: '',
      sets: previous.length
        ? previous.slice(0, 4).map((s) => normaliseSet({ weightLb: s.weightLb, reps: s.reps, type: s.type }))
        : [normaliseSet({})],
    });
  }, { redraw: true });
}

export async function finishWorkout() {
  if (!state.active) return null;

  const workout = normaliseWorkout({ ...state.active, finishedAt: new Date().toISOString() });
  // Rows you never ticked were never done. They are dropped so an abandoned
  // set does not sit in history looking like a real one.
  workout.entries = workout.entries
    .map((entry) => ({ ...entry, sets: entry.sets.filter((s) => s.done) }))
    .filter((entry) => entry.sets.length);

  if (!workout.entries.length) {
    await discardWorkout();
    return null;
  }

  await db.put(STORE.workouts, workout);
  state.workouts.push(workout);
  state.active = null;
  state.rest = null;
  await Promise.all([persistActive(), db.deleteKv('rest')]);
  notify();
  return workout;
}

export async function discardWorkout() {
  state.active = null;
  state.rest = null;
  await Promise.all([persistActive(), db.deleteKv('rest')]);
  notify();
}

// ---------------------------------------------------------------------------
// Editing history
// ---------------------------------------------------------------------------

export async function saveWorkout(workout) {
  const clean = normaliseWorkout(workout);
  await db.put(STORE.workouts, clean);
  const i = state.workouts.findIndex((w) => w.id === clean.id);
  if (i >= 0) state.workouts[i] = clean;
  else state.workouts.push(clean);
  notify();
  return clean;
}

export async function removeWorkout(id) {
  await db.remove(STORE.workouts, id);
  state.workouts = state.workouts.filter((w) => w.id !== id);
  notify();
}

// ---------------------------------------------------------------------------
// Body weight
// ---------------------------------------------------------------------------

export async function logBodyWeight(weightLb, date = isoDay(), note = '') {
  const row = { date, weightLb: Number(weightLb) || 0, note };
  await db.put(STORE.bodyWeights, row);
  const i = state.bodyWeights.findIndex((b) => b.date === date);
  if (i >= 0) state.bodyWeights[i] = row;
  else state.bodyWeights.push(row);
  notify();
  return row;
}

export async function removeBodyWeight(date) {
  await db.remove(STORE.bodyWeights, date);
  state.bodyWeights = state.bodyWeights.filter((b) => b.date !== date);
  notify();
}

// ---------------------------------------------------------------------------
// Settings and rest timer
// ---------------------------------------------------------------------------

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.setKv(KV.settings, state.settings);
  notify();
  return state.settings;
}

export async function saveBackupState(patch) {
  state.backup = { ...state.backup, ...patch };
  await db.setKv(KV.backupState, state.backup);
  notify();
  return state.backup;
}

// Stored as an end timestamp rather than a countdown, so backgrounding the app,
// locking the phone, or a slow tab all leave the remaining time correct.
export async function startRest(durationSec, label = '') {
  state.rest = { endsAt: Date.now() + durationSec * 1000, durationSec, label };
  await db.setKv('rest', state.rest);
  notify();
}

export async function adjustRest(deltaSec) {
  if (!state.rest) return;
  state.rest = { ...state.rest, endsAt: state.rest.endsAt + deltaSec * 1000 };
  await db.setKv('rest', state.rest);
  notify();
}

export async function stopRest() {
  state.rest = null;
  await db.deleteKv('rest');
  notify();
}
