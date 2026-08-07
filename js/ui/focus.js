// Focus mode: one exercise, filling the screen, with the next one a thumb away.
//
// Same data and the same set rows as the list view — this is a different lens
// on the live workout, not a second copy of it.

import { h, frag, icon, empty, toast, confirmSheet } from '../dom.js';
import { state, mutateActive, exerciseById, lastPerformanceSession } from '../store.js';
import { formatWeight, formatDuration, sessionTotals, workingSets } from '../calc.js';
import { normaliseSet } from '../schema.js';
import { setRow } from './setrow.js';
import { openTimerFullscreen } from './timer.js';

export function focusScreen(rawIndex) {
  const workout = state.active;
  if (!workout) {
    location.hash = '#/';
    return empty('No workout in progress');
  }
  if (!workout.entries.length) {
    location.hash = '#/workout';
    return empty('Add an exercise first');
  }

  // Clamp rather than 404 — a deleted exercise must not strand you on a blank
  // screen mid-session.
  const index = Math.max(0, Math.min(workout.entries.length - 1, Number(rawIndex) || 0));
  const entry = workout.entries[index];
  const exercise = exerciseById(entry.exerciseId);
  const previous = lastPerformanceSession(entry.exerciseId, workout.id);

  const go = (to) => { location.hash = `#/focus/${to}`; };
  const done = workingSets(entry.sets).length;
  const totals = sessionTotals(workout, new Map(state.exercises.map((e) => [e.id, e])));

  const elapsed = h('span', { class: 'mono small dim' }, formatDuration(Date.now() - Date.parse(workout.startedAt)));
  const tick = setInterval(() => {
    if (!elapsed.isConnected) return clearInterval(tick);
    elapsed.textContent = formatDuration(Date.now() - Date.parse(state.active?.startedAt || Date.now()));
  }, 1000);

  return h('div', { class: 'focus' },
    h('div', { class: 'focus-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'Show all exercises', onclick: () => { location.hash = '#/workout'; } }, icon('list')),
      h('div', { class: 'focus-progress' },
        workout.entries.map((other, i) =>
          h('i', { class: i === index ? 'on' : workingSets(other.sets).length ? 'done' : '' }))),
      h('button', { class: 'icon-btn', 'aria-label': 'Open the timer', onclick: () => openTimerFullscreen() }, icon('timer')),
    ),

    h('div', { class: 'focus-body' },
      h('div', { class: 'spread' },
        h('span', { class: 'eyebrow' }, `Exercise ${index + 1} of ${workout.entries.length}`),
        elapsed,
      ),

      h('h1', { class: 'focus-title' },
        h('a', { href: `#/exercise/${entry.exerciseId}`, style: { color: 'inherit', textDecoration: 'none' } },
          exercise?.name || 'Unknown exercise')),

      h('div', { class: 'row wrap', style: { gap: '6px' } },
        exercise ? h('span', { class: 'pill' }, exercise.muscleGroup) : null,
        exercise ? h('span', { class: 'pill' }, exercise.equipment) : null,
        exercise?.isBodyweight ? h('span', { class: 'pill pill-accent' }, 'Bodyweight') : null,
        done ? h('span', { class: 'pill pill-pr' }, `${done} done`) : null,
      ),

      previous
        ? h('div', { class: 'panel' },
            h('span', { class: 'eyebrow', style: { color: 'inherit', opacity: 0.75 } }, 'Last time'),
            h('div', { class: 'mono', style: { marginTop: '3px' } },
              previous.sets.map((s) => `${formatWeight(s.weightLb)}×${s.reps}`).join('   ')))
        : h('div', { class: 'panel' }, 'First time doing this — set the baseline.'),

      entry.note ? h('p', { class: 'muted small' }, entry.note) : null,

      h('div', { class: 'focus-sets' },
        h('div', { class: 'head' }, 'Set'),
        h('div', { class: 'head' }, 'Last'),
        h('div', { class: 'head' }, 'lb'),
        h('div', { class: 'head' }, 'Reps'),
        h('div', { class: 'head' }),
        entry.sets.map((set, setIndex) =>
          setRow({
            entry, entryIndex: index, set, setIndex, previous, exercise,
            bodyWeightLb: workout.bodyWeightLb,
            onStructuralChange: () => go(index),
          })),
      ),

      h('button', {
        class: 'btn btn-block',
        onclick: () => mutateActive((w) => {
          const sets = w.entries[index].sets;
          const last = sets[sets.length - 1];
          sets.push(normaliseSet({ weightLb: last?.weightLb || 0, reps: last?.reps || 0, type: 'working' }));
        }, { redraw: true }),
      }, icon('plus'), 'Add set'),

      h('p', { class: 'dim small center' },
        `${totals.sets} sets · ${Math.round(totals.volumeLb).toLocaleString('en-US')} lb so far`),
    ),

    h('div', { class: 'focus-nav' },
      h('button', {
        class: 'btn', 'aria-label': 'Previous exercise',
        disabled: index === 0,
        onclick: () => go(index - 1),
      }, icon('back')),

      index === workout.entries.length - 1
        ? h('button', { class: 'btn btn-primary', onclick: () => finishFromFocus() }, 'Finish workout')
        : h('button', { class: 'btn btn-primary', onclick: () => go(index + 1) },
            `Next · ${shortName(workout.entries[index + 1].exerciseId)}`),

      h('button', {
        class: 'btn', 'aria-label': 'Next exercise',
        disabled: index === workout.entries.length - 1,
        onclick: () => go(index + 1),
      }, icon('forward')),
    ),
  );
}

function shortName(exerciseId) {
  const name = exerciseById(exerciseId)?.name || '';
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

async function finishFromFocus() {
  // Finishing lives on the list screen, which shows what is about to be
  // dropped. Sending you there beats a confirm sheet over a single exercise.
  location.hash = '#/workout';
  await new Promise((r) => setTimeout(r, 80));
  document.querySelector('.topbar .btn-primary')?.click();
}
