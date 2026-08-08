import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSharePayload, encodeShare, decodeShare, validateSharePayload,
  planImport, routineFromPlan, normaliseName, uniqueRoutineName, SHARE_FORMAT, SHARE_VERSION,
} from '../js/share.js';
import { workingSetNumber } from '../js/ui/setrow.js';

const exercise = (id, name, extra = {}) => ({
  id, name, muscleGroup: 'Chest', equipment: 'Barbell', isBodyweight: false, isCustom: false, ...extra,
});

const routine = {
  id: 'rt1',
  name: 'Push',
  note: 'Chest day',
  exercises: [
    { exerciseId: 'barbell-bench-press', targetSets: 4, repsLow: 5, repsHigh: 8, restSec: 180, note: '', position: 0 },
    { exerciseId: 'ex_custom1', targetSets: 3, repsLow: 8, repsHigh: 12, restSec: null, note: '', position: 1 },
  ],
};

const senderLibrary = new Map([
  ['barbell-bench-press', exercise('barbell-bench-press', 'Barbell Bench Press')],
  ['ex_custom1', exercise('ex_custom1', 'Incline Machine Press', { equipment: 'Machine', isCustom: true })],
]);

const payload = () => buildSharePayload(routine, senderLibrary);

// ---------------------------------------------------------------------------

test('a split round-trips through a share code', () => {
  const original = payload();
  const restored = decodeShare(encodeShare(original));
  assert.deepEqual(restored, original);
  assert.equal(restored.n, 'Push');
  assert.equal(restored.e.length, 2);
});

test('the share code is url-safe', () => {
  assert.match(encodeShare(payload()), /^[A-Za-z0-9_-]+$/);
});

test('a share code survives non-ascii names', () => {
  const spicy = buildSharePayload(
    { ...routine, name: 'Épaules — Poussé 💪' },
    senderLibrary,
  );
  assert.equal(decodeShare(encodeShare(spicy)).n, 'Épaules — Poussé 💪');
});

test('a split carries the plan and never the weights', () => {
  const serialised = JSON.stringify(payload());
  assert.ok(!/weightLb|"w":\s*\d/.test(serialised), 'no weight field may appear in a shared split');
  assert.ok(!serialised.includes('workouts'), 'history must never travel with a split');
  assert.ok(serialised.includes('Push'));
});

test('every entry carries its exercise definition, so the receiver can read it cold', () => {
  for (const entry of payload().e) {
    assert.ok(entry.x?.n, 'name');
    assert.ok(entry.x?.m, 'muscle group');
    assert.ok(entry.x?.q, 'equipment');
  }
});

test('a truncated link is refused rather than half-read', () => {
  const code = encodeShare(payload());
  assert.throws(() => decodeShare(code.slice(0, 20)), /damaged/);
  assert.throws(() => decodeShare('not a code at all!!'), /damaged/);
});

// ---------------------------------------------------------------------------

test('a valid split validates', () => {
  assert.deepEqual(validateSharePayload(payload()), { ok: true, errors: [] });
});

test('some other link is refused', () => {
  assert.equal(validateSharePayload({ f: 'something-else', v: 1, e: [] }).ok, false);
  assert.equal(validateSharePayload(null).ok, false);
});

test('a split from a newer app version is refused, not guessed at', () => {
  const result = validateSharePayload({ ...payload(), v: SHARE_VERSION + 1 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /newer version/);
});

test('an empty split is caught', () => {
  const result = validateSharePayload({ f: SHARE_FORMAT, v: 1, n: 'Empty', e: [] });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------

test('exercises the receiver already has resolve to theirs, keeping their history', () => {
  const receiver = [exercise('barbell-bench-press', 'Barbell Bench Press')];
  const plan = planImport(payload(), receiver);

  assert.equal(plan.items[0].action, 'existing');
  assert.equal(plan.items[0].resolved.id, 'barbell-bench-press');
  assert.equal(plan.knownCount, 1);
  assert.equal(plan.newCount, 1);
});

test('a custom exercise matches the receiver\'s own by name, not by id', () => {
  // The whole point: their "Incline Machine Press" has a different generated
  // id, and importing must attach to it so their logged weights show up.
  const receiver = [exercise('ex_theirOwnId', 'Incline Machine Press', { isCustom: true })];
  const plan = planImport(payload(), receiver);

  const item = plan.items[1];
  assert.equal(item.action, 'matched');
  assert.equal(item.resolved.id, 'ex_theirOwnId');
});

test('name matching ignores case, spacing and punctuation', () => {
  assert.equal(normaliseName('Incline Machine Press'), normaliseName('incline  machine-press'));
  assert.equal(normaliseName('T-Bar Row'), normaliseName('t bar row'));
  assert.notEqual(normaliseName('Front Squat'), normaliseName('Back Squat'));
});

test('an exercise the receiver has never seen is marked new', () => {
  const plan = planImport(payload(), []);
  assert.deepEqual(plan.items.map((i) => i.action), ['create', 'create']);
  assert.equal(plan.knownCount, 0);
  assert.equal(plan.newCount, 2);
});

test('the plan keeps the sender\'s sets, reps and rest', () => {
  const plan = planImport(payload(), []);
  assert.equal(plan.items[0].targetSets, 4);
  assert.equal(plan.items[0].repsLow, 5);
  assert.equal(plan.items[0].repsHigh, 8);
  assert.equal(plan.items[0].restSec, 180);
  assert.equal(plan.items[1].restSec, null);
});

test('exercise order is preserved end to end', () => {
  const plan = planImport(payload(), []);
  assert.deepEqual(plan.items.map((i) => i.definition.name),
    ['Barbell Bench Press', 'Incline Machine Press']);
});

test('a bodyweight flag survives the trip', () => {
  const bw = buildSharePayload(
    { ...routine, exercises: [{ exerciseId: 'pull-up', targetSets: 3, repsLow: 6, repsHigh: 10, position: 0 }] },
    new Map([['pull-up', exercise('pull-up', 'Pull-Up', { isBodyweight: true, equipment: 'Bodyweight' })]]),
  );
  assert.equal(planImport(bw, []).items[0].definition.isBodyweight, true);
});

// ---------------------------------------------------------------------------

test('the saved routine points at the receiver\'s own exercise ids', () => {
  const receiver = [exercise('ex_theirOwnId', 'Incline Machine Press', { isCustom: true })];
  const plan = planImport(payload(), receiver);
  // Bench was new to them, so it gets created and handed back a fresh id.
  const created = new Map([['barbell-bench-press', 'ex_freshlyMade']]);
  const saved = routineFromPlan(plan, created);

  assert.equal(saved.name, 'Push');
  assert.deepEqual(saved.exercises.map((e) => e.exerciseId), ['ex_freshlyMade', 'ex_theirOwnId']);
  assert.deepEqual(saved.exercises.map((e) => e.position), [0, 1]);
});

test('a shared split does not collide with a routine you already have', () => {
  assert.equal(uniqueRoutineName('Push', ['Legs']), 'Push');
  assert.equal(uniqueRoutineName('Push', ['Push']), 'Push (shared)');
  assert.equal(uniqueRoutineName('Push', ['Push', 'Push (shared)']), 'Push (shared 2)');
  assert.equal(uniqueRoutineName('Push', ['push']), 'Push (shared)', 'case must not fool it');
});

test('the collision suffix is applied when the routine is built', () => {
  const plan = planImport(payload(), []);
  assert.equal(routineFromPlan(plan, new Map(), ['Push']).name, 'Push (shared)');
  assert.equal(routineFromPlan(plan, new Map(), []).name, 'Push');
});

test('importing produces a routine and nothing else — no workouts, no settings', () => {
  const saved = routineFromPlan(planImport(payload(), []));
  assert.deepEqual(Object.keys(saved).sort(), ['exercises', 'name', 'note']);
});

// ---------------------------------------------------------------------------
// Drop sets

test('a drop set takes no set number of its own', () => {
  const sets = [
    { type: 'warmup' },
    { type: 'working' },  // 1
    { type: 'drop' },     // hangs off set 1
    { type: 'working' },  // 2
    { type: 'failure' },  // 3
  ];
  assert.equal(workingSetNumber(sets, 1), 1);
  assert.equal(workingSetNumber(sets, 2), 1, 'the drop does not advance the count');
  assert.equal(workingSetNumber(sets, 3), 2);
  assert.equal(workingSetNumber(sets, 4), 3);
});
