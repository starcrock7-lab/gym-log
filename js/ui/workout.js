// The screen that matters. Everything else in the app is a report on what
// happens here, so it has to be fast, one-handed, and impossible to lose.

import { h, frag, icon, screen, sheet, closeSheet, confirmSheet, toast, empty } from '../dom.js';
import {
  state, mutateActive, exerciseById, exerciseName, addExerciseToActive, addSetToActive,
  finishWorkout, discardWorkout, startRest, lastPerformanceSession, saveRoutine, logBodyWeight,
} from '../store.js';
import { formatWeight, formatDuration, sessionTotals, workingSets } from '../calc.js';
import { normaliseSet } from '../schema.js';
import { exercisePicker } from './pickers.js';
import { setRow, setSetLoggedHandler, resetPRAnnouncements } from './setrow.js';
import { openTimerFullscreen } from './timer.js';

export { resetPRAnnouncements };

// Held so ticking a set can update the running total in place rather than
// redrawing the screen out from under your thumb.
let totalsNode = null;

function refreshTotals() {
  if (!totalsNode || !state.active) return;
  const totals = sessionTotals(state.active, new Map(state.exercises.map((e) => [e.id, e])));
  totalsNode.textContent = `${totals.sets} sets · ${Math.round(totals.volumeLb).toLocaleString('en-US')} lb`;
}

export function workoutScreen() {
  const workout = state.active;
  if (!workout) {
    return screen('Workout', {}, empty('No workout in progress', 'Start one from the Home tab.'));
  }

  const elapsed = h('span', { class: 'mono' }, formatDuration(Date.now() - Date.parse(workout.startedAt)));
  // The clock is the one thing that redraws on its own — repainting the whole
  // screen every second would fight with whatever you are typing.
  const tick = setInterval(() => {
    if (!elapsed.isConnected) return clearInterval(tick);
    elapsed.textContent = formatDuration(Date.now() - Date.parse(state.active?.startedAt || Date.now()));
  }, 1000);

  totalsNode = h('div', { class: 'muted small mono' });
  refreshTotals();
  setSetLoggedHandler(refreshTotals);

  return screen(workout.name, {
    subtitle: null,
    action: h('button', { class: 'btn btn-primary btn-sm', onclick: () => finishSheet() }, 'Finish'),
  },
    h('div', { class: 'card card-tight spread' },
      h('button', {
        class: 'row', style: { gap: '6px', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', minHeight: '38px', padding: 0 },
        'aria-label': 'Open the timer',
        onclick: () => openTimerFullscreen(),
      }, icon('timer'), elapsed),
      totalsNode,
      h('button', { class: 'icon-btn', 'aria-label': 'Workout options', onclick: () => optionsSheet() }, icon('grip')),
    ),

    workout.entries.length
      ? h('button', {
          class: 'btn btn-primary btn-block btn-lg',
          onclick: () => { location.hash = `#/focus/${firstUnfinished(workout)}`; },
        }, icon('focus'), 'Focus mode — one exercise at a time')
      : null,

    workout.entries.length
      ? workout.entries.map((entry, index) => exerciseCard(entry, index))
      : empty('Nothing added yet', 'Add your first exercise below.'),

    h('button', { class: 'btn btn-block', onclick: () => addExercise() }, icon('plus'), 'Add exercise'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => cancelWorkout() }, 'Discard workout'),
  );
}

// Focus mode should open where the work is, not always at the top.
function firstUnfinished(workout) {
  const index = workout.entries.findIndex((entry) => entry.sets.some((set) => !set.done));
  return index === -1 ? 0 : index;
}

// ---------------------------------------------------------------------------

function exerciseCard(entry, entryIndex) {
  const exercise = exerciseById(entry.exerciseId);
  const previous = lastPerformanceSession(entry.exerciseId, state.active.id);
  const bodyWeightLb = state.active.bodyWeightLb;

  const rows = entry.sets.map((set, setIndex) =>
    setRow({ entry, entryIndex, set, setIndex, previous, exercise, bodyWeightLb }));

  return h('div', { class: 'exercise-card' },
    h('div', { class: 'exercise-head' },
      h('h2', { class: 'truncate' },
        h('a', { href: `#/exercise/${entry.exerciseId}` }, exercise?.name || 'Unknown exercise')),
      exercise?.isBodyweight ? h('span', { class: 'pill' }, 'BW') : null,
      h('button', {
        class: 'icon-btn', 'aria-label': `Focus on ${exercise?.name || 'this exercise'}`,
        onclick: () => { location.hash = `#/focus/${entryIndex}`; },
      }, icon('focus')),
      h('button', { class: 'icon-btn', 'aria-label': 'Exercise options', onclick: () => entrySheet(entry, entryIndex) }, icon('grip')),
    ),

    entry.note ? h('p', { class: 'muted small', style: { padding: '0 12px 8px' } }, entry.note) : null,

    h('div', { class: 'set-grid' },
      h('div', { class: 'head' }, 'Set'),
      h('div', { class: 'head' }, 'Last time'),
      h('div', { class: 'head' }, 'lb'),
      h('div', { class: 'head' }, 'Reps'),
      h('div', { class: 'head' }),
      rows,
    ),

    h('div', { class: 'row', style: { padding: '0 11px 12px', gap: '8px' } },
      h('button', {
        class: 'btn btn-sm grow',
        onclick: () => addSetToActive(entryIndex),
      }, icon('plus'), 'Add set'),
      h('button', {
        class: 'btn btn-sm grow',
        onclick: () => addSetToActive(entryIndex, { type: 'drop' }),
      }, icon('down'), `Drop set −${state.settings.dropPercent}%`),
    ),
  );
}

function entrySheet(entry, entryIndex) {
  const note = h('textarea', { class: 'input', placeholder: 'Notes for this exercise', value: entry.note || '' });

  sheet(exerciseName(entry.exerciseId), frag(
    h('div', { class: 'field' }, h('label', {}, 'Note'), note),
    h('a', { class: 'btn btn-block', href: `#/exercise/${entry.exerciseId}`, onclick: closeSheet }, 'History & records'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn grow', disabled: entryIndex === 0,
        onclick: () => { moveEntry(entryIndex, -1); closeSheet(); },
      }, 'Move up'),
      h('button', {
        class: 'btn grow', disabled: entryIndex === state.active.entries.length - 1,
        onclick: () => { moveEntry(entryIndex, 1); closeSheet(); },
      }, 'Move down'),
    ),
    h('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        closeSheet();
        if (await confirmSheet('Remove exercise?', 'Its sets in this workout will be discarded.', { confirmLabel: 'Remove', danger: true })) {
          mutateActive((w) => { w.entries.splice(entryIndex, 1); w.entries.forEach((e, i) => { e.position = i; }); }, { redraw: true });
        }
      },
    }, 'Remove from workout'),
  ), {
    actions: [h('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => { mutateActive((w) => { w.entries[entryIndex].note = note.value; }, { redraw: true }); closeSheet(); },
    }, 'Save')],
  });
}

function moveEntry(index, delta) {
  mutateActive((w) => {
    const target = index + delta;
    if (target < 0 || target >= w.entries.length) return;
    [w.entries[index], w.entries[target]] = [w.entries[target], w.entries[index]];
    w.entries.forEach((e, i) => { e.position = i; });
  }, { redraw: true });
}

function addExercise() {
  exercisePicker({
    multi: true,
    exclude: state.active.entries.map((e) => e.exerciseId),
    onPick: async (ids) => { for (const id of ids) await addExerciseToActive(id); },
  });
}

function optionsSheet() {
  const name = h('input', { class: 'input', value: state.active.name });
  const note = h('textarea', { class: 'input', placeholder: 'How did it go?', value: state.active.note || '' });
  const bw = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.1', placeholder: 'Body weight (lb)', value: state.active.bodyWeightLb ?? '' });

  sheet('Workout', frag(
    h('div', { class: 'field' }, h('label', {}, 'Name'), name),
    h('div', { class: 'field' }, h('label', {}, 'Body weight today'), bw,
      h('p', { class: 'muted small' }, 'Used to work out the true load on pull-ups and dips.')),
    h('div', { class: 'field' }, h('label', {}, 'Note'), note),
    h('button', {
      class: 'btn btn-block',
      onclick: async () => {
        const routine = await saveRoutine({
          name: state.active.name,
          exercises: state.active.entries.map((entry, i) => ({
            exerciseId: entry.exerciseId,
            targetSets: entry.sets.length,
            repsLow: Math.min(...entry.sets.map((s) => s.reps).filter(Boolean)) || 8,
            repsHigh: Math.max(...entry.sets.map((s) => s.reps).filter(Boolean)) || 12,
            position: i,
          })),
        });
        closeSheet();
        toast(`Saved "${routine.name}" as a routine`);
      },
    }, 'Save as routine'),
  ), {
    actions: [h('button', {
      class: 'btn btn-primary btn-block',
      onclick: async () => {
        const weightLb = Number(bw.value) || null;
        await mutateActive((w) => { w.name = name.value.trim() || 'Workout'; w.note = note.value; w.bodyWeightLb = weightLb; }, { redraw: true });
        if (weightLb) await logBodyWeight(weightLb);
        closeSheet();
      },
    }, 'Save')],
  });
}

async function finishSheet() {
  const workout = state.active;
  const doneSets = workout.entries.reduce((n, e) => n + workingSets(e.sets).length + e.sets.filter((s) => s.done && s.type === 'warmup').length, 0);
  const emptyRows = workout.entries.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);

  if (!doneSets) {
    toast('Tick at least one set before finishing', { error: true });
    return;
  }

  const ok = await confirmSheet(
    'Finish workout?',
    emptyRows
      ? `${doneSets} sets logged. ${emptyRows} untouched ${emptyRows === 1 ? 'row' : 'rows'} will be dropped.`
      : `${doneSets} sets logged.`,
    { confirmLabel: 'Finish' },
  );
  if (!ok) return;

  const saved = await finishWorkout();
  resetPRAnnouncements();
  if (saved) {
    toast('Workout saved');
    location.hash = `#/session/${saved.id}`;
  } else {
    location.hash = '#/';
  }
}

async function cancelWorkout() {
  const ok = await confirmSheet('Discard this workout?', 'Everything logged in this session is deleted. This cannot be undone.', {
    confirmLabel: 'Discard', danger: true,
  });
  if (!ok) return;
  await discardWorkout();
  resetPRAnnouncements();
  location.hash = '#/';
}
