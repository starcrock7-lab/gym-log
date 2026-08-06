import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateExport,
  normaliseExport,
  normaliseSet,
  normaliseWorkout,
  buildExport,
  defaultSettings,
  newId,
  isoDay,
  EXPORT_FORMAT,
  EXPORT_VERSION,
} from '../js/schema.js';
import { SEED_EXERCISES, SEED_ROUTINES } from '../js/seed.js';

const validPayload = () =>
  buildExport({
    exercises: [{ id: 'bench', name: 'Bench Press', muscleGroup: 'Chest', equipment: 'Barbell' }],
    routines: [],
    workouts: [
      {
        id: 'w1',
        startedAt: '2026-08-01T10:00:00.000Z',
        finishedAt: '2026-08-01T11:00:00.000Z',
        entries: [{ exerciseId: 'bench', sets: [{ weightLb: 185, reps: 5, done: true }] }],
      },
    ],
    bodyWeights: [{ date: '2026-08-01', weightLb: 180 }],
  });

// ---------------------------------------------------------------------------

test('a well-formed backup validates', () => {
  assert.deepEqual(validateExport(validPayload()), { ok: true, errors: [] });
});

test('a file from some other app is refused', () => {
  const result = validateExport({ format: 'not-us', version: 1, data: {} });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Not a Personal Gym backup/);
});

test('junk is refused rather than throwing', () => {
  assert.equal(validateExport(null).ok, false);
  assert.equal(validateExport('a string').ok, false);
  assert.equal(validateExport(42).ok, false);
});

test('a backup from a newer app version is refused, not guessed at', () => {
  const payload = { ...validPayload(), version: EXPORT_VERSION + 1 };
  const result = validateExport(payload);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /newer version/);
});

test('a workout with an unreadable start time is caught', () => {
  const payload = validPayload();
  payload.data.workouts[0].startedAt = 'last tuesday';
  const result = validateExport(payload);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /unreadable start time/);
});

test('a workout missing its id is caught', () => {
  const payload = validPayload();
  delete payload.data.workouts[0].id;
  assert.equal(validateExport(payload).ok, false);
});

test('a malformed set list is caught before it reaches the database', () => {
  const payload = validPayload();
  payload.data.workouts[0].entries[0].sets = 'five by five';
  const result = validateExport(payload);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /malformed set list/);
});

test('every problem is reported at once, not one per attempt', () => {
  const payload = validPayload();
  delete payload.data.workouts[0].id;
  payload.data.exercises[0].name = '';
  assert.ok(validateExport(payload).errors.length >= 2);
});

// ---------------------------------------------------------------------------

test('an export round-trips through validation and normalisation unchanged', () => {
  const payload = validPayload();
  assert.equal(validateExport(payload).ok, true);
  const restored = normaliseExport(payload);
  assert.equal(restored.workouts[0].entries[0].sets[0].weightLb, 185);
  assert.equal(restored.workouts[0].entries[0].sets[0].reps, 5);
  assert.equal(restored.workouts[0].entries[0].sets[0].done, true);
  assert.equal(restored.bodyWeights[0].weightLb, 180);
});

test('normalising fills in fields an older backup never had', () => {
  const set = normaliseSet({ weightLb: 185, reps: 5 });
  assert.deepEqual(set, { weightLb: 185, reps: 5, type: 'working', rpe: null, done: false, doneAt: null });
});

test('an unknown set type falls back to working rather than corrupting filters', () => {
  assert.equal(normaliseSet({ type: 'superset' }).type, 'working');
  assert.equal(normaliseSet({ type: 'warmup' }).type, 'warmup');
});

test('reps are whole numbers and weights are numbers, whatever the file says', () => {
  const set = normaliseSet({ weightLb: '185.5', reps: '5.7' });
  assert.equal(set.weightLb, 185.5);
  assert.equal(set.reps, 5);
  assert.equal(normaliseSet({ weightLb: 'heavy', reps: null }).weightLb, 0);
});

test('a workout keeps its exercise order when positions are missing', () => {
  const workout = normaliseWorkout({
    id: 'w', startedAt: '2026-08-01T10:00:00.000Z',
    entries: [{ exerciseId: 'a', sets: [] }, { exerciseId: 'b', sets: [] }],
  });
  assert.deepEqual(workout.entries.map((e) => [e.exerciseId, e.position]), [['a', 0], ['b', 1]]);
});

test('settings missing from an old backup come back at their defaults', () => {
  const payload = buildExport({ workouts: [] });
  payload.data.settings = { defaultRestSec: 90 };
  const restored = normaliseExport(payload);
  assert.equal(restored.settings.defaultRestSec, 90, 'keeps what the file had');
  assert.equal(restored.settings.barWeightLb, 45, 'fills in what it did not');
});

test('an export carries the format marker and never carries credentials', () => {
  const payload = buildExport({ workouts: [], settings: { ...defaultSettings(), secret: 'nope' } });
  assert.equal(payload.format, EXPORT_FORMAT);
  assert.equal(payload.version, EXPORT_VERSION);
  assert.ok(!('backupAuth' in payload.data), 'backup credentials must never be exported');
  assert.ok(!JSON.stringify(payload).includes('ghp_'), 'no token shape in an export');
});

// ---------------------------------------------------------------------------

test('generated ids do not collide', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId('w')));
  assert.equal(ids.size, 500);
});

test('a day key uses local time, so a late-night session is not filed as tomorrow', () => {
  const late = new Date(2026, 7, 6, 23, 30);
  assert.equal(isoDay(late), '2026-08-06');
});

// ---------------------------------------------------------------------------

test('every seeded exercise has a unique id', () => {
  const ids = SEED_EXERCISES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('seeded ids are clean slugs', () => {
  for (const exercise of SEED_EXERCISES) {
    assert.match(exercise.id, /^[a-z0-9-]+$/, `${exercise.name} has an unusable id`);
  }
});

test('every seeded routine points at exercises that exist', () => {
  const known = new Set(SEED_EXERCISES.map((e) => e.id));
  for (const routine of SEED_ROUTINES) {
    for (const [exerciseId] of routine.exercises) {
      assert.ok(known.has(exerciseId), `routine "${routine.name}" references missing exercise "${exerciseId}"`);
    }
  }
});

test('bodyweight lifts are flagged so their load is computed correctly', () => {
  const byId = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
  assert.equal(byId.get('pull-up').isBodyweight, true);
  assert.equal(byId.get('chin-up').isBodyweight, true);
  assert.equal(byId.get('barbell-bench-press').isBodyweight, false);
});
