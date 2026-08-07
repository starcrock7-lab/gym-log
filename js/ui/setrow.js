// One set row, shared by the list view and focus mode. There is exactly one
// implementation of "log a set" so the two lenses can never drift apart.

import { h, frag, icon, sheet, closeSheet, toast } from '../dom.js';
import { state, mutateActive, startRest } from '../store.js';
import { formatWeight, effectiveLoadLb, estimate1RM, personalRecords } from '../calc.js';
import { normaliseSet } from '../schema.js';
import { plateSheet } from './pickers.js';
import { repaintTimer } from './timer.js';

// Callbacks the host screen supplies so the row can nudge it without knowing
// which screen it is on.
let onSetLogged = () => {};
export function setSetLoggedHandler(fn) { onSetLogged = fn || (() => {}); }

export function setRow({ entry, entryIndex, set, setIndex, previous, exercise, bodyWeightLb, onStructuralChange }) {
  const previousSet = previous?.sets?.[setIndex];
  const isWarmup = set.type === 'warmup';

  // Writing straight into the live object keeps the input's own DOM node
  // untouched, so the caret does not jump while you are typing.
  const write = (patch) => mutateActive((w) => Object.assign(w.entries[entryIndex].sets[setIndex], patch));

  const weight = h('input', {
    class: `set-input${set.done ? ' is-done' : ''}`, type: 'number', inputmode: 'decimal', step: '2.5', min: '0',
    value: set.weightLb || '',
    placeholder: previousSet ? formatWeight(previousSet.weightLb) : '0',
    onfocus: (e) => e.target.select(),
    onchange: (e) => write({ weightLb: Number(e.target.value) || 0 }),
  });

  const reps = h('input', {
    class: `set-input${set.done ? ' is-done' : ''}`, type: 'number', inputmode: 'numeric', step: '1', min: '0',
    value: set.reps || '',
    placeholder: previousSet ? String(previousSet.reps) : '0',
    onfocus: (e) => e.target.select(),
    onchange: (e) => write({ reps: Math.max(0, Math.floor(Number(e.target.value) || 0)) }),
  });

  const done = h('button', {
    class: `set-done${set.done ? ' on' : ''}`,
    'aria-label': set.done ? 'Mark set not done' : 'Mark set done',
    onclick: async () => {
      const nowDone = !set.done;
      // Ticking an untouched row takes whatever is showing, including the
      // ghost numbers, so repeating last week is a single tap.
      const weightLb = Number(weight.value) || (nowDone ? previousSet?.weightLb || 0 : 0);
      const repCount = Number(reps.value) || (nowDone ? previousSet?.reps || 0 : 0);

      // The row updates itself. A redraw here would rebuild the button you are
      // still touching, and the tap would be lost.
      set.done = nowDone;
      done.classList.toggle('on', nowDone);
      weight.value = weightLb || '';
      reps.value = repCount || '';
      weight.classList.toggle('is-done', nowDone);
      reps.classList.toggle('is-done', nowDone);

      await mutateActive((w) => {
        Object.assign(w.entries[entryIndex].sets[setIndex], {
          weightLb, reps: repCount, done: nowDone, doneAt: nowDone ? new Date().toISOString() : null,
        });
      });
      onSetLogged();

      if (nowDone && !isWarmup) {
        const rest = entry.restSec || exercise?.defaultRestSec || state.settings.defaultRestSec;
        if (rest > 0) { await startRest(rest, exercise?.name || ''); repaintTimer(); }
        announcePR(entry.exerciseId, { weightLb, reps: repCount }, bodyWeightLb, exercise);
      }
    },
  }, icon('check'));

  return frag(
    h('button', {
      class: `set-no${isWarmup ? ' warmup' : ''}`,
      'aria-label': 'Change set type',
      onclick: () => setTypeSheet(entryIndex, setIndex, onStructuralChange),
    }, isWarmup ? 'W' : String(workingSetNumber(entry.sets, setIndex))),

    previousSet
      ? h('button', {
          class: 'ghost',
          style: { background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer' },
          onclick: () => {
            weight.value = previousSet.weightLb || '';
            reps.value = previousSet.reps || '';
            write({ weightLb: previousSet.weightLb, reps: previousSet.reps });
          },
        }, `${formatWeight(previousSet.weightLb)} × ${previousSet.reps}`)
      : h('span', { class: 'ghost none' }, 'first time'),

    weight,
    reps,
    done,
  );
}

// Warm-ups do not consume a working set number — set 1 is your first real set.
export function workingSetNumber(sets, index) {
  let n = 0;
  for (let i = 0; i <= index; i += 1) if (sets[i].type !== 'warmup') n += 1;
  return n;
}

// ---------------------------------------------------------------------------

let lastAnnounced = new Set();

function announcePR(exerciseId, set, bodyWeightLb, exercise) {
  const finished = state.workouts.filter((w) => w.finishedAt);
  const prs = personalRecords(finished, exercise || exerciseId);
  const load = effectiveLoadLb(set, exercise, bodyWeightLb);
  const est = estimate1RM(load, set.reps);
  if (!est || !prs.heaviest) return;

  const key = `${exerciseId}:${load}:${set.reps}`;
  if (lastAnnounced.has(key)) return;

  if (load > prs.heaviest.loadLb) {
    lastAnnounced.add(key);
    toast(`Heaviest ever on ${exercise?.name || 'this lift'} — ${formatWeight(load)} lb`);
  } else if (prs.bestE1RM && est.confidence !== 'low' && est.value > prs.bestE1RM.value) {
    lastAnnounced.add(key);
    toast(`Best estimated 1RM on ${exercise?.name || 'this lift'} — ${formatWeight(est.value)} lb`);
  }
}

export function resetPRAnnouncements() { lastAnnounced = new Set(); }

// ---------------------------------------------------------------------------

function setTypeSheet(entryIndex, setIndex, onStructuralChange) {
  const set = state.active.entries[entryIndex].sets[setIndex];
  const redraw = () => { closeSheet(); onStructuralChange?.(); };

  sheet('Set type', frag(
    h('div', { class: 'list' },
      [
        ['working', 'Working set', 'Counts toward volume, records and charts'],
        ['warmup', 'Warm-up', 'Logged, but never counts toward a record'],
        ['drop', 'Drop set', 'Counts as working'],
        ['failure', 'To failure', 'Counts as working'],
      ].map(([type, title, note]) =>
        h('button', {
          class: 'list-item',
          onclick: () => { mutateActive((w) => { w.entries[entryIndex].sets[setIndex].type = type; }, { redraw: true }); redraw(); },
        },
          h('div', { class: 'grow' }, h('div', {}, title), h('div', { class: 'dim small' }, note)),
          set.type === type ? icon('check') : null)),
    ),

    h('button', { class: 'btn btn-block', onclick: () => plateSheet(set.weightLb) }, 'Plate calculator'),

    h('button', {
      class: 'btn btn-danger btn-block',
      onclick: () => {
        mutateActive((w) => {
          const sets = w.entries[entryIndex].sets;
          sets.splice(setIndex, 1);
          if (!sets.length) sets.push(normaliseSet({}));
        }, { redraw: true });
        redraw();
      },
    }, 'Delete set'),
  ));
}
