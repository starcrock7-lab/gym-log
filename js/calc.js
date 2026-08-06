// Every number the app shows comes from this file, and nothing here touches the
// DOM, the database, or the clock unless it is handed one. That is deliberate:
// these are the parts that quietly go wrong in workout trackers, so they are the
// parts that get tested.

export const WEIGHT_STEP_LB = 2.5;

// Above this many reps a 1RM estimate stops meaning much. We still show it, but
// greyed and marked, and it can never set a PR or move the trend verdict.
export const E1RM_CONFIDENT_REPS = 12;

const DAY_MS = 86400000;
export const TREND_WINDOW_DAYS = 28;

// Below this the two windows are treated as noise rather than progress.
export const TREND_FLAT_PCT = 2;

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

// A set counts toward volume, PRs and charts only if it was actually completed
// and was not a warm-up. Drop sets and sets taken to failure are real work.
export function isWorkingSet(set) {
  return Boolean(set) && set.done === true && set.type !== 'warmup';
}

export function workingSets(sets) {
  return (sets || []).filter(isWorkingSet);
}

// What was actually on the bar (or the body). For bodyweight-loaded lifts the
// logged number is the *added* weight, so chin-ups at bodyweight read as 0 until
// we add the lifter back in.
export function effectiveLoadLb(set, exercise, bodyWeightLb) {
  const added = Number(set?.weightLb) || 0;
  if (!exercise?.isBodyweight) return added;
  return added + (Number(bodyWeightLb) || 0);
}

export function setVolumeLb(set, exercise, bodyWeightLb) {
  const reps = Number(set?.reps) || 0;
  return effectiveLoadLb(set, exercise, bodyWeightLb) * reps;
}

// ---------------------------------------------------------------------------
// One-rep max
// ---------------------------------------------------------------------------

// Epley. One formula, used everywhere, so two screens can never disagree about
// the same set.
export function estimate1RM(loadLb, reps) {
  const w = Number(loadLb) || 0;
  const r = Math.floor(Number(reps) || 0);
  if (w <= 0 || r <= 0) return null;
  const value = r === 1 ? w : w * (1 + r / 30);
  return {
    value,
    reps: r,
    confidence: r === 1 ? 'exact' : r <= E1RM_CONFIDENT_REPS ? 'good' : 'low',
  };
}

export function isConfident(estimate) {
  return Boolean(estimate) && estimate.confidence !== 'low';
}

// ---------------------------------------------------------------------------
// Reading history
// ---------------------------------------------------------------------------

function timeOf(workout) {
  const t = Date.parse(workout?.finishedAt || workout?.startedAt || '');
  return Number.isNaN(t) ? 0 : t;
}

// Flattens the workout log into one session-per-entry view of a single exercise,
// oldest first. Everything below is built on this.
export function exerciseSessions(workouts, exerciseId) {
  const out = [];
  for (const workout of workouts || []) {
    if (!workout?.finishedAt) continue; // an in-progress session is not history yet
    for (const entry of workout.entries || []) {
      if (entry.exerciseId !== exerciseId) continue;
      const sets = workingSets(entry.sets);
      if (!sets.length) continue;
      out.push({
        workoutId: workout.id,
        at: timeOf(workout),
        bodyWeightLb: workout.bodyWeightLb ?? null,
        sets,
        allSets: entry.sets || [],
        note: entry.note || '',
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// The ghost text on the workout screen: what you did for this exercise last
// time, so the number to beat is on screen before you lift. Warm-ups are kept
// here — matching set-for-set is more useful than a tidy list.
export function lastPerformance(workouts, exerciseId, beforeMs = Infinity) {
  const sessions = exerciseSessions(workouts, exerciseId).filter((s) => s.at < beforeMs);
  return sessions.length ? sessions[sessions.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

// Recomputed from the full history every time rather than incremented, so
// editing or deleting a past session can never leave a stale PR behind.
export function personalRecords(workouts, exercise) {
  const exerciseId = typeof exercise === 'string' ? exercise : exercise?.id;
  const ex = typeof exercise === 'string' ? null : exercise;
  const sessions = exerciseSessions(workouts, exerciseId);

  let heaviest = null; // biggest load, any rep count
  let bestE1RM = null; // best confident estimate
  let bestSetVolume = null; // hardest single set
  const repsAtWeight = new Map(); // load -> most reps ever done at it

  for (const session of sessions) {
    for (const set of session.sets) {
      const load = effectiveLoadLb(set, ex, session.bodyWeightLb);
      const reps = Number(set.reps) || 0;
      if (load <= 0 || reps <= 0) continue;
      const record = { loadLb: load, reps, at: session.at, workoutId: session.workoutId };

      if (!heaviest || load > heaviest.loadLb || (load === heaviest.loadLb && reps > heaviest.reps)) {
        heaviest = record;
      }

      const est = estimate1RM(load, reps);
      if (isConfident(est) && (!bestE1RM || est.value > bestE1RM.value)) {
        bestE1RM = { ...record, value: est.value };
      }

      const volume = load * reps;
      if (!bestSetVolume || volume > bestSetVolume.volumeLb) {
        bestSetVolume = { ...record, volumeLb: volume };
      }

      const previous = repsAtWeight.get(load);
      if (!previous || reps > previous.reps) repsAtWeight.set(load, record);
    }
  }

  return {
    heaviest,
    bestE1RM,
    bestSetVolume,
    repsAtWeight: [...repsAtWeight.values()].sort((a, b) => b.loadLb - a.loadLb),
    sessionCount: sessions.length,
  };
}

// ---------------------------------------------------------------------------
// Am I going up?
// ---------------------------------------------------------------------------

function bestConfidentE1RM(sessions, ex) {
  let best = 0;
  for (const session of sessions) {
    for (const set of session.sets) {
      const est = estimate1RM(effectiveLoadLb(set, ex, session.bodyWeightLb), set.reps);
      if (isConfident(est) && est.value > best) best = est.value;
    }
  }
  return best;
}

// The question the whole app exists to answer. Best estimated 1RM over the last
// four weeks against the four weeks before that.
//
// When there is not enough training in either window it says so, rather than
// drawing an arrow out of one data point.
export function trendVerdict(workouts, exercise, nowMs = Date.now()) {
  const exerciseId = typeof exercise === 'string' ? exercise : exercise?.id;
  const ex = typeof exercise === 'string' ? null : exercise;
  const windowMs = TREND_WINDOW_DAYS * DAY_MS;
  const sessions = exerciseSessions(workouts, exerciseId);

  const recent = sessions.filter((s) => s.at > nowMs - windowMs && s.at <= nowMs);
  const prior = sessions.filter((s) => s.at > nowMs - 2 * windowMs && s.at <= nowMs - windowMs);

  const base = {
    recentSessions: recent.length,
    priorSessions: prior.length,
    windowDays: TREND_WINDOW_DAYS,
  };

  if (recent.length < 2 || prior.length < 2) {
    const needed = [];
    if (recent.length < 2) needed.push('recent');
    if (prior.length < 2) needed.push('prior');
    return {
      ...base,
      status: 'insufficient',
      pctChange: null,
      label: sessions.length
        ? 'Not enough data yet — keep logging'
        : 'No completed sets yet',
      needed,
    };
  }

  const recentBest = bestConfidentE1RM(recent, ex);
  const priorBest = bestConfidentE1RM(prior, ex);
  if (!recentBest || !priorBest) {
    return { ...base, status: 'insufficient', pctChange: null, label: 'Not enough data yet — keep logging', needed: ['confident-sets'] };
  }

  const pctChange = ((recentBest - priorBest) / priorBest) * 100;
  const status = pctChange >= TREND_FLAT_PCT ? 'up' : pctChange <= -TREND_FLAT_PCT ? 'down' : 'flat';
  const magnitude = `${Math.abs(pctChange).toFixed(1)}%`;

  return {
    ...base,
    status,
    pctChange,
    recentBestLb: recentBest,
    priorBestLb: priorBest,
    label:
      status === 'up'
        ? `Up ${magnitude} vs. the previous 4 weeks`
        : status === 'down'
          ? `Down ${magnitude} vs. the previous 4 weeks`
          : 'Holding steady vs. the previous 4 weeks',
  };
}

// ---------------------------------------------------------------------------
// Session totals
// ---------------------------------------------------------------------------

export function sessionTotals(workout, exercisesById = new Map()) {
  let volumeLb = 0;
  let sets = 0;
  let reps = 0;
  for (const entry of workout?.entries || []) {
    const ex = exercisesById.get?.(entry.exerciseId) || null;
    for (const set of workingSets(entry.sets)) {
      volumeLb += setVolumeLb(set, ex, workout.bodyWeightLb);
      sets += 1;
      reps += Number(set.reps) || 0;
    }
  }
  const started = Date.parse(workout?.startedAt || '');
  const finished = Date.parse(workout?.finishedAt || '');
  const durationMs =
    Number.isNaN(started) || Number.isNaN(finished) ? null : Math.max(0, finished - started);
  return { volumeLb, sets, reps, durationMs, exercises: (workout?.entries || []).length };
}

// ---------------------------------------------------------------------------
// Plate maths
// ---------------------------------------------------------------------------

export function roundToStep(value, step = WEIGHT_STEP_LB) {
  const s = Number(step) || WEIGHT_STEP_LB;
  return Math.round((Number(value) || 0) / s) * s;
}

// Greedy, largest plate first, which is optimal for any real plate set and is
// also how you would actually load the bar.
//
// `inventory` is a list of numbers (assume plenty of each) or of
// { lb, pairs } when you only own so many. Returns exactly what to hang on one
// side, and is honest about a target it cannot hit instead of rounding quietly.
export function platesFor(targetLb, barLb = 45, inventory = [45, 35, 25, 10, 5, 2.5]) {
  const target = Number(targetLb) || 0;
  const bar = Number(barLb) || 0;

  if (target < bar) {
    return { reachable: false, reason: 'below-bar', perSide: [], achievedLb: bar, remainderLb: target - bar, barLb: bar };
  }

  const perSideTarget = (target - bar) / 2;
  const plates = inventory
    .map((p) => (typeof p === 'number' ? { lb: p, pairs: Infinity } : { lb: Number(p.lb), pairs: Number(p.pairs ?? Infinity) }))
    .filter((p) => p.lb > 0 && p.pairs > 0)
    .sort((a, b) => b.lb - a.lb);

  const perSide = [];
  let remaining = perSideTarget;
  for (const plate of plates) {
    // Float guard: 2.5 + 2.5 + ... drifts, and a 1e-9 remainder must not read
    // as an unreachable weight.
    const count = Math.min(plate.pairs, Math.floor((remaining + 1e-6) / plate.lb));
    if (count > 0) {
      perSide.push({ lb: plate.lb, count });
      remaining -= count * plate.lb;
    }
  }

  const loadedPerSide = perSideTarget - remaining;
  const achievedLb = bar + loadedPerSide * 2;
  const remainderLb = target - achievedLb;

  return {
    reachable: Math.abs(remainderLb) < 1e-6,
    reason: Math.abs(remainderLb) < 1e-6 ? null : 'no-plate-combination',
    perSide,
    achievedLb,
    remainderLb,
    barLb: bar,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatWeight(lb) {
  const n = Number(lb) || 0;
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatVolume(lb) {
  const n = Math.round(Number(lb) || 0);
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-US');
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatSetLine(set, exercise, bodyWeightLb) {
  const load = effectiveLoadLb(set, exercise, bodyWeightLb);
  return `${formatWeight(load)} × ${Number(set?.reps) || 0}`;
}
