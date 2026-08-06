import { h, frag, icon, screen, empty, relativeDay, sheet, closeSheet, confirmSheet, toast } from '../dom.js';
import { state, finishedWorkouts, workoutById, exerciseById, exerciseName, saveWorkout, removeWorkout, saveRoutine } from '../store.js';
import { sessionTotals, formatVolume, formatDuration, formatWeight, workingSets, effectiveLoadLb } from '../calc.js';
import { sessionRow } from './home.js';

export function historyScreen() {
  const history = finishedWorkouts();
  const exercisesById = new Map(state.exercises.map((e) => [e.id, e]));

  if (!history.length) {
    return screen('History', {}, empty('No finished workouts yet', 'Finish a session and it lands here.'));
  }

  const totalVolume = history.reduce((sum, w) => sum + sessionTotals(w, exercisesById).volumeLb, 0);
  const groups = new Map();
  for (const workout of history) {
    const date = new Date(workout.finishedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(workout);
  }

  return screen('History', { subtitle: `${history.length} workouts` },
    h('div', { class: 'stat-row' },
      stat('Workouts', String(history.length)),
      stat('Total volume', `${formatVolume(totalVolume)} lb`),
      stat('This month', String(history.filter((w) => sameMonth(w.finishedAt)).length)),
    ),

    heatmap(history),

    ...[...groups.entries()].map(([key, workouts]) =>
      h('div', { class: 'stack-sm' },
        h('p', { class: 'section-title' }, monthLabel(key)),
        workouts.map((workout) => sessionRow(workout, exercisesById)),
      )),
  );
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 's' }, sub) : null);
}

function sameMonth(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Last 12 weeks, one square a day.
function heatmap(history) {
  const trained = new Set(history.map((w) => new Date(w.finishedAt).toDateString()));
  const today = new Date();
  const squares = [];
  for (let i = 83; i >= 0; i -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    squares.push(h('i', { class: trained.has(day.toDateString()) ? 'on' : '', title: day.toLocaleDateString() }));
  }
  return h('div', { class: 'card' },
    h('p', { class: 'section-title', style: { marginBottom: '8px' } }, 'Last 12 weeks'),
    h('div', { class: 'heatmap' }, squares),
  );
}

// ---------------------------------------------------------------------------

export function sessionScreen(id) {
  const workout = workoutById(id);
  if (!workout) return screen('Workout', { back: '#/history' }, empty('That workout no longer exists'));

  const exercisesById = new Map(state.exercises.map((e) => [e.id, e]));
  const totals = sessionTotals(workout, exercisesById);
  const date = new Date(workout.finishedAt || workout.startedAt);

  return screen(workout.name, {
    back: '#/history',
    subtitle: date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    action: h('button', { class: 'icon-btn', 'aria-label': 'Options', onclick: () => sessionOptions(workout) }, icon('grip')),
  },
    h('div', { class: 'stat-row' },
      stat('Duration', formatDuration(totals.durationMs)),
      stat('Volume', `${formatVolume(totals.volumeLb)} lb`),
      stat('Sets', String(totals.sets)),
      stat('Reps', String(totals.reps)),
    ),

    workout.note ? h('div', { class: 'card' }, h('p', { class: 'muted small' }, workout.note)) : null,
    workout.bodyWeightLb ? h('p', { class: 'muted small' }, `Body weight that day: ${formatWeight(workout.bodyWeightLb)} lb`) : null,

    workout.entries.map((entry) => {
      const exercise = exerciseById(entry.exerciseId);
      return h('div', { class: 'exercise-card' },
        h('div', { class: 'exercise-head' },
          h('h2', { class: 'truncate' }, h('a', { href: `#/exercise/${entry.exerciseId}` }, exerciseName(entry.exerciseId))),
          h('span', { class: 'muted small' }, `${workingSets(entry.sets).length} sets`),
        ),
        entry.note ? h('p', { class: 'muted small', style: { padding: '0 12px 8px' } }, entry.note) : null,
        h('div', { class: 'list', style: { padding: '0 12px 10px' } },
          entry.sets.map((set, i) =>
            h('div', { class: 'list-item', style: { minHeight: '38px', cursor: 'default' } },
              h('span', { class: set.type === 'warmup' ? 'pill pill-warm' : 'pill' }, set.type === 'warmup' ? 'W' : String(i + 1)),
              h('span', { class: 'grow mono' }, `${formatWeight(set.weightLb)} lb × ${set.reps}`),
              exercise?.isBodyweight && workout.bodyWeightLb
                ? h('span', { class: 'muted small mono' }, `${formatWeight(effectiveLoadLb(set, exercise, workout.bodyWeightLb))} total`)
                : null,
            )),
        ),
      );
    }),

    h('button', { class: 'btn btn-block', onclick: () => editSession(workout) }, icon('edit'), 'Edit this workout'),
  );
}

function sessionOptions(workout) {
  sheet(workout.name, frag(
    h('button', { class: 'btn btn-block', onclick: () => { closeSheet(); editSession(workout); } }, 'Edit sets'),
    h('button', {
      class: 'btn btn-block',
      onclick: async () => {
        const routine = await saveRoutine({
          name: workout.name,
          exercises: workout.entries.map((entry, i) => ({
            exerciseId: entry.exerciseId,
            targetSets: workingSets(entry.sets).length || entry.sets.length,
            repsLow: Math.min(...entry.sets.map((s) => s.reps).filter(Boolean)) || 8,
            repsHigh: Math.max(...entry.sets.map((s) => s.reps).filter(Boolean)) || 12,
            position: i,
          })),
        });
        closeSheet();
        toast(`Saved "${routine.name}" as a routine`);
      },
    }, 'Save as routine'),
    h('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        closeSheet();
        const ok = await confirmSheet('Delete this workout?', 'It disappears from history and any records it held are withdrawn.', { confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await removeWorkout(workout.id);
        toast('Workout deleted');
        location.hash = '#/history';
      },
    }, 'Delete workout'),
  ));
}

// A full editor for a past session — the whole point of history is being able
// to fix the set you fat-fingered at the time.
function editSession(workout) {
  const draft = JSON.parse(JSON.stringify(workout));

  const body = h('div', { class: 'stack' });
  const render = () => {
    body.replaceChildren(
      h('div', { class: 'field' },
        h('label', {}, 'Name'),
        h('input', { class: 'input', value: draft.name, onchange: (e) => { draft.name = e.target.value; } })),
      ...draft.entries.map((entry, entryIndex) =>
        h('div', { class: 'exercise-card' },
          h('div', { class: 'exercise-head' },
            h('h2', { class: 'truncate' }, exerciseName(entry.exerciseId)),
            h('button', {
              class: 'icon-btn', 'aria-label': 'Remove exercise',
              onclick: () => { draft.entries.splice(entryIndex, 1); render(); },
            }, icon('trash')),
          ),
          h('div', { class: 'set-grid', style: { gridTemplateColumns: '34px 1fr 74px 62px 44px' } },
            h('div', { class: 'head' }, 'Set'), h('div', { class: 'head' }, 'Type'),
            h('div', { class: 'head' }, 'lb'), h('div', { class: 'head' }, 'Reps'), h('div', { class: 'head' }),
            ...entry.sets.flatMap((set, setIndex) => [
              h('span', { class: `set-no${set.type === 'warmup' ? ' warmup' : ''}` }, set.type === 'warmup' ? 'W' : String(setIndex + 1)),
              h('select', { class: 'set-input', onchange: (e) => { set.type = e.target.value; render(); } },
                ['working', 'warmup', 'drop', 'failure'].map((t) => h('option', { value: t, selected: set.type === t }, t))),
              h('input', { class: 'set-input', type: 'number', inputmode: 'decimal', step: '2.5', value: set.weightLb, onchange: (e) => { set.weightLb = Number(e.target.value) || 0; } }),
              h('input', { class: 'set-input', type: 'number', inputmode: 'numeric', value: set.reps, onchange: (e) => { set.reps = Math.max(0, Math.floor(Number(e.target.value) || 0)); } }),
              h('button', { class: 'icon-btn', 'aria-label': 'Delete set', onclick: () => { entry.sets.splice(setIndex, 1); if (!entry.sets.length) draft.entries.splice(entryIndex, 1); render(); } }, icon('trash')),
            ]),
          ),
          h('button', {
            class: 'btn btn-sm', style: { margin: '0 10px 10px' },
            onclick: () => { const last = entry.sets[entry.sets.length - 1]; entry.sets.push({ ...last, done: true }); render(); },
          }, 'Add set'),
        )),
    );
  };
  render();

  sheet('Edit workout', body, {
    actions: [
      h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          // Every set in history is by definition done — an edited row must not
          // silently drop out of records because `done` went missing.
          draft.entries = draft.entries
            .map((entry) => ({ ...entry, sets: entry.sets.map((s) => ({ ...s, done: true })) }))
            .filter((entry) => entry.sets.length);
          if (!draft.entries.length) {
            closeSheet();
            const ok = await confirmSheet('No sets left', 'Saving with no sets deletes this workout.', { confirmLabel: 'Delete workout', danger: true });
            if (ok) { await removeWorkout(workout.id); location.hash = '#/history'; }
            return;
          }
          await saveWorkout(draft);
          closeSheet();
          toast('Workout updated');
        },
      }, 'Save'),
    ],
  });
}
