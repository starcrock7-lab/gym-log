import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimate1RM,
  isWorkingSet,
  workingSets,
  effectiveLoadLb,
  setVolumeLb,
  exerciseSessions,
  lastPerformance,
  personalRecords,
  trendVerdict,
  sessionTotals,
  platesFor,
  roundToStep,
  formatWeight,
  formatVolume,
  formatDuration,
} from '../js/calc.js';

const DAY = 86400000;
const NOW = Date.parse('2026-08-06T12:00:00.000Z');

const set = (weightLb, reps, extra = {}) => ({ weightLb, reps, type: 'working', done: true, ...extra });

function workout(daysAgo, sets, opts = {}) {
  const at = new Date(NOW - daysAgo * DAY).toISOString();
  return {
    id: `w-${daysAgo}`,
    startedAt: at,
    finishedAt: at,
    entries: [{ exerciseId: 'bench', position: 0, sets }],
    ...opts,
  };
}

// ---------------------------------------------------------------------------

test('a set only counts when it was completed and was not a warm-up', () => {
  assert.equal(isWorkingSet(set(185, 5)), true);
  assert.equal(isWorkingSet(set(135, 10, { type: 'warmup' })), false);
  assert.equal(isWorkingSet(set(185, 5, { done: false })), false);
  assert.equal(isWorkingSet(set(185, 5, { type: 'drop' })), true, 'drop sets are real work');
  assert.equal(isWorkingSet(set(185, 1, { type: 'failure' })), true);
  assert.equal(isWorkingSet(null), false);
});

test('warm-ups are filtered out of the working set list', () => {
  const sets = [set(135, 10, { type: 'warmup' }), set(185, 5), set(185, 5)];
  assert.equal(workingSets(sets).length, 2);
});

test('Epley is exact at one rep and never rewards a single rep less than the load', () => {
  assert.equal(estimate1RM(225, 1).value, 225);
  assert.equal(estimate1RM(225, 1).confidence, 'exact');
  assert.equal(estimate1RM(200, 5).value, 200 * (1 + 5 / 30));
  assert.equal(estimate1RM(0, 5), null);
  assert.equal(estimate1RM(200, 0), null);
});

test('a 1RM estimate past 12 reps is marked low confidence', () => {
  assert.equal(estimate1RM(135, 12).confidence, 'good');
  assert.equal(estimate1RM(135, 13).confidence, 'low');
  assert.equal(estimate1RM(135, 20).confidence, 'low');
});

test('bodyweight lifts add the lifter back in; loaded lifts do not', () => {
  const chinup = { id: 'chinup', isBodyweight: true };
  const bench = { id: 'bench' };
  assert.equal(effectiveLoadLb(set(25, 8), chinup, 180), 205);
  assert.equal(effectiveLoadLb(set(0, 8), chinup, 180), 180, 'bodyweight-only is not zero');
  assert.equal(effectiveLoadLb(set(185, 5), bench, 180), 185);
  assert.equal(setVolumeLb(set(25, 8), chinup, 180), 205 * 8);
});

// ---------------------------------------------------------------------------

test('history skips workouts that were never finished', () => {
  const inProgress = { id: 'live', startedAt: new Date(NOW).toISOString(), entries: [{ exerciseId: 'bench', sets: [set(225, 5)] }] };
  assert.equal(exerciseSessions([inProgress], 'bench').length, 0);
});

test('history comes back oldest first regardless of input order', () => {
  const sessions = exerciseSessions([workout(1, [set(200, 5)]), workout(30, [set(185, 5)])], 'bench');
  assert.deepEqual(sessions.map((s) => s.sets[0].weightLb), [185, 200]);
});

test('last performance keeps warm-ups so set rows line up with last time', () => {
  const w = workout(7, [set(135, 10, { type: 'warmup' }), set(185, 5)]);
  const previous = lastPerformance([w], 'bench');
  assert.equal(previous.allSets.length, 2);
  assert.equal(previous.sets.length, 1);
});

test('last performance can be asked what came before a given moment', () => {
  const workouts = [workout(30, [set(185, 5)]), workout(3, [set(205, 5)])];
  assert.equal(lastPerformance(workouts, 'bench').sets[0].weightLb, 205);
  assert.equal(lastPerformance(workouts, 'bench', NOW - 5 * DAY).sets[0].weightLb, 185);
  assert.equal(lastPerformance(workouts, 'bench', NOW - 90 * DAY), null);
});

// ---------------------------------------------------------------------------

test('warm-ups never set a personal record', () => {
  const w = workout(1, [set(315, 12, { type: 'warmup' }), set(185, 5)]);
  const prs = personalRecords([w], 'bench');
  assert.equal(prs.heaviest.loadLb, 185, 'a 315 warm-up must not become the heaviest set');
  assert.equal(prs.bestSetVolume.loadLb, 185);
});

test('an uncompleted set never sets a personal record', () => {
  const w = workout(1, [set(405, 5, { done: false }), set(185, 5)]);
  assert.equal(personalRecords([w], 'bench').heaviest.loadLb, 185);
});

test('personal records pick the right set for each category', () => {
  const w = workout(1, [set(275, 1), set(225, 8), set(185, 15)]);
  const prs = personalRecords([w], 'bench');
  assert.equal(prs.heaviest.loadLb, 275);
  assert.equal(prs.bestE1RM.loadLb, 225, '225x8 estimates higher than a 275 single');
  assert.equal(prs.bestSetVolume.loadLb, 185, '185x15 is the most work in one set');
});

test('a high-rep set cannot invent a 1RM record', () => {
  const w = workout(1, [set(135, 30), set(225, 3)]);
  const prs = personalRecords([w], 'bench');
  assert.equal(prs.bestE1RM.loadLb, 225, '135x30 is not evidence of a 270 max');
});

test('at equal load the higher rep count is the better heaviest-set record', () => {
  const prs = personalRecords([workout(2, [set(225, 3)]), workout(1, [set(225, 6)])], 'bench');
  assert.equal(prs.heaviest.reps, 6);
});

test('best reps at each weight are tracked, heaviest first', () => {
  const workouts = [workout(3, [set(225, 3)]), workout(2, [set(225, 5)]), workout(1, [set(185, 10)])];
  const prs = personalRecords(workouts, 'bench');
  assert.deepEqual(prs.repsAtWeight.map((r) => [r.loadLb, r.reps]), [[225, 5], [185, 10]]);
});

test('records recompute from scratch, so deleting a session withdraws its PR', () => {
  const big = workout(2, [set(315, 5)]);
  const small = workout(1, [set(185, 5)]);
  assert.equal(personalRecords([big, small], 'bench').heaviest.loadLb, 315);
  assert.equal(personalRecords([small], 'bench').heaviest.loadLb, 185);
});

test('an exercise with no history reports nothing rather than zero', () => {
  const prs = personalRecords([], 'bench');
  assert.equal(prs.heaviest, null);
  assert.equal(prs.bestE1RM, null);
  assert.equal(prs.sessionCount, 0);
});

// ---------------------------------------------------------------------------

test('trend refuses to draw a conclusion from too little training', () => {
  const verdict = trendVerdict([workout(3, [set(185, 5)])], 'bench', NOW);
  assert.equal(verdict.status, 'insufficient');
  assert.equal(verdict.pctChange, null);
  assert.match(verdict.label, /Not enough data/);
});

test('trend says so plainly when nothing has been logged at all', () => {
  assert.equal(trendVerdict([], 'bench', NOW).label, 'No completed sets yet');
});

test('trend calls a real increase an increase', () => {
  const workouts = [
    workout(50, [set(185, 5)]),
    workout(45, [set(185, 5)]),
    workout(10, [set(225, 5)]),
    workout(5, [set(225, 5)]),
  ];
  const verdict = trendVerdict(workouts, 'bench', NOW);
  assert.equal(verdict.status, 'up');
  assert.ok(verdict.pctChange > 20);
  assert.match(verdict.label, /^Up /);
});

test('trend calls a decrease a decrease', () => {
  const workouts = [
    workout(50, [set(245, 5)]),
    workout(45, [set(245, 5)]),
    workout(10, [set(185, 5)]),
    workout(5, [set(185, 5)]),
  ];
  const verdict = trendVerdict(workouts, 'bench', NOW);
  assert.equal(verdict.status, 'down');
  assert.ok(verdict.pctChange < 0);
});

test('a change under two percent is flat, not progress', () => {
  const workouts = [
    workout(50, [set(200, 5)]),
    workout(45, [set(200, 5)]),
    workout(10, [set(201, 5)]),
    workout(5, [set(201, 5)]),
  ];
  const verdict = trendVerdict(workouts, 'bench', NOW);
  assert.equal(verdict.status, 'flat');
  assert.match(verdict.label, /Holding steady/);
});

test('trend ignores training older than the two comparison windows', () => {
  const workouts = [
    workout(200, [set(400, 5)]),
    workout(50, [set(185, 5)]),
    workout(45, [set(185, 5)]),
    workout(10, [set(225, 5)]),
    workout(5, [set(225, 5)]),
  ];
  assert.equal(trendVerdict(workouts, 'bench', NOW).status, 'up');
});

test('more reps at the same weight registers as progress', () => {
  const workouts = [
    workout(50, [set(200, 5)]),
    workout(45, [set(200, 5)]),
    workout(10, [set(200, 8)]),
    workout(5, [set(200, 8)]),
  ];
  assert.equal(trendVerdict(workouts, 'bench', NOW).status, 'up');
});

// ---------------------------------------------------------------------------

test('session totals count only working sets', () => {
  const w = {
    startedAt: '2026-08-06T10:00:00.000Z',
    finishedAt: '2026-08-06T11:05:00.000Z',
    entries: [{ exerciseId: 'bench', sets: [set(135, 10, { type: 'warmup' }), set(185, 5), set(185, 5)] }],
  };
  const totals = sessionTotals(w);
  assert.equal(totals.volumeLb, 185 * 10);
  assert.equal(totals.sets, 2);
  assert.equal(totals.reps, 10);
  assert.equal(totals.durationMs, 65 * 60 * 1000);
});

test('session totals survive a workout that never finished', () => {
  assert.equal(sessionTotals({ startedAt: '2026-08-06T10:00:00.000Z', entries: [] }).durationMs, null);
});

// ---------------------------------------------------------------------------

test('plate maths loads the bar the way you actually would', () => {
  const result = platesFor(225, 45);
  assert.equal(result.reachable, true);
  assert.deepEqual(result.perSide, [{ lb: 45, count: 2 }]);
  assert.equal(result.achievedLb, 225);
});

test('plate maths hits an awkward weight exactly', () => {
  const result = platesFor(190, 45);
  assert.equal(result.reachable, true);
  assert.equal(result.achievedLb, 190);
  assert.deepEqual(result.perSide, [{ lb: 45, count: 1 }, { lb: 25, count: 1 }, { lb: 2.5, count: 1 }]);
});

test('a weight needing a plate you do not own is refused, not faked', () => {
  // 192.5 needs 73.75 a side, and the last 1.25 does not exist in a standard set.
  const result = platesFor(192.5, 45);
  assert.equal(result.reachable, false);
  assert.equal(result.achievedLb, 190);
  assert.equal(result.remainderLb, 2.5);
});

test('the empty bar needs no plates', () => {
  const result = platesFor(45, 45);
  assert.equal(result.reachable, true);
  assert.deepEqual(result.perSide, []);
});

test('a weight under the bar is refused, not rounded away', () => {
  const result = platesFor(30, 45);
  assert.equal(result.reachable, false);
  assert.equal(result.reason, 'below-bar');
});

test('an unreachable weight reports exactly how far short it lands', () => {
  const result = platesFor(137, 45, [45, 25, 10, 5, 2.5]);
  assert.equal(result.reachable, false);
  assert.equal(result.achievedLb, 135);
  assert.equal(Math.round(result.remainderLb * 100) / 100, 2);
});

test('plate maths respects how many pairs you actually own', () => {
  const result = platesFor(225, 45, [{ lb: 45, pairs: 1 }, { lb: 25, pairs: 4 }, { lb: 10, pairs: 4 }]);
  assert.equal(result.reachable, true);
  assert.deepEqual(result.perSide, [{ lb: 45, count: 1 }, { lb: 25, count: 1 }, { lb: 10, count: 2 }]);
});

test('stacking small plates does not drift into an unreachable weight', () => {
  // 2.5s repeatedly subtracted is exactly where float error bites.
  const result = platesFor(70, 45, [2.5]);
  assert.equal(result.reachable, true);
  assert.deepEqual(result.perSide, [{ lb: 2.5, count: 5 }]);
});

test('rounding snaps to the nearest 2.5 lb', () => {
  assert.equal(roundToStep(184), 185);
  assert.equal(roundToStep(183.7), 182.5, '183.7 is nearer 182.5 than 185');
  assert.equal(roundToStep(181), 180);
  assert.equal(roundToStep(0), 0);
});

// ---------------------------------------------------------------------------

test('weights read as whole numbers when they are whole', () => {
  assert.equal(formatWeight(185), '185');
  assert.equal(formatWeight(182.5), '182.5');
  assert.equal(formatWeight(0), '0');
});

test('big volumes are abbreviated, small ones are not', () => {
  assert.equal(formatVolume(9250), '9,250');
  assert.equal(formatVolume(12400), '12.4k');
});

test('durations read like a stopwatch', () => {
  assert.equal(formatDuration(65 * 60 * 1000), '1h 05m');
  assert.equal(formatDuration(90 * 1000), '1m 30s');
  assert.equal(formatDuration(45 * 1000), '45s');
  assert.equal(formatDuration(null), '—');
});
