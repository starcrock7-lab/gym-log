import { h, frag, icon, screen, empty, sheet, closeSheet, confirmSheet, toast } from '../dom.js';
import { state, routineById, exerciseName, saveRoutine, removeRoutine } from '../store.js';
import { exercisePicker } from './pickers.js';

export function routinesScreen() {
  const routines = [...state.routines].sort((a, b) => a.position - b.position);

  return screen('Routines', {
    back: '#/',
    subtitle: 'Reusable workout templates',
    action: h('button', { class: 'icon-btn', 'aria-label': 'New routine', onclick: () => createRoutine() }, icon('plus')),
  },
    routines.length
      ? routines.map((routine) =>
          h('a', { class: 'card card-link', href: `#/routine/${routine.id}` },
            h('div', { class: 'spread' },
              h('div', { class: 'grow' },
                h('div', {}, routine.name),
                h('div', { class: 'muted small' }, `${routine.exercises.length} ${routine.exercises.length === 1 ? 'exercise' : 'exercises'}`),
              ),
              icon('edit'),
            ),
            routine.exercises.length
              ? h('p', { class: 'muted small truncate', style: { marginTop: '6px' } },
                  routine.exercises.map((e) => exerciseName(e.exerciseId)).join(' · '))
              : null,
          ))
      : empty('No routines yet', 'A routine is just a list of exercises you reuse.'),

    h('button', { class: 'btn btn-primary btn-block', onclick: () => createRoutine() }, icon('plus'), 'New routine'),
  );
}

async function createRoutine() {
  const routine = await saveRoutine({ name: 'New routine', exercises: [] });
  location.hash = `#/routine/${routine.id}`;
}

// ---------------------------------------------------------------------------

export function routineScreen(id) {
  const routine = routineById(id);
  if (!routine) return screen('Routine', { back: '#/routines' }, empty('That routine no longer exists'));

  const draft = JSON.parse(JSON.stringify(routine));
  const body = h('div', { class: 'stack' });

  const persist = () => {
    draft.exercises.forEach((e, i) => { e.position = i; });
    saveRoutine(draft);
  };

  const render = () => {
    body.replaceChildren(
      h('div', { class: 'field' },
        h('label', {}, 'Name'),
        h('input', { class: 'input', value: draft.name, onchange: (e) => { draft.name = e.target.value.trim() || 'Untitled routine'; persist(); } })),

      ...(draft.exercises.length
        ? draft.exercises.map((planned, index) =>
            h('div', { class: 'card stack-sm' },
              h('div', { class: 'spread' },
                h('div', { class: 'grow truncate' }, exerciseName(planned.exerciseId)),
                h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: index === 0, onclick: () => { swap(index, index - 1); } }, icon('up')),
                h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: index === draft.exercises.length - 1, onclick: () => { swap(index, index + 1); } }, icon('down')),
                h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { draft.exercises.splice(index, 1); persist(); render(); } }, icon('trash')),
              ),
              h('div', { class: 'row', style: { gap: '8px' } },
                numberField('Sets', planned.targetSets, (v) => { planned.targetSets = Math.max(1, v); persist(); }),
                numberField('Reps from', planned.repsLow, (v) => { planned.repsLow = v; persist(); }),
                numberField('to', planned.repsHigh, (v) => { planned.repsHigh = v; persist(); }),
                numberField('Rest (s)', planned.restSec ?? '', (v) => { planned.restSec = v || null; persist(); }),
              ),
            ))
        : [empty('No exercises yet', 'Add the lifts you want in this session.')]),

      h('button', {
        class: 'btn btn-block',
        onclick: () => exercisePicker({
          multi: true,
          exclude: draft.exercises.map((e) => e.exerciseId),
          onPick: (ids) => {
            for (const exerciseId of ids) {
              draft.exercises.push({ exerciseId, targetSets: 3, repsLow: 8, repsHigh: 12, restSec: null, note: '', position: draft.exercises.length });
            }
            persist();
            render();
          },
        }),
      }, icon('plus'), 'Add exercise'),

      h('button', {
        class: 'btn btn-danger btn-block',
        onclick: async () => {
          const ok = await confirmSheet('Delete this routine?', 'Workouts you already logged from it are not affected.', { confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          await removeRoutine(draft.id);
          toast('Routine deleted');
          location.hash = '#/routines';
        },
      }, 'Delete routine'),
    );
  };

  const swap = (a, b) => {
    [draft.exercises[a], draft.exercises[b]] = [draft.exercises[b], draft.exercises[a]];
    persist();
    render();
  };

  render();

  return screen(routine.name, { back: '#/routines', subtitle: 'Changes save as you go' }, body);
}

function numberField(label, value, onChange) {
  return h('div', { class: 'field grow' },
    h('label', {}, label),
    h('input', {
      class: 'input', type: 'number', inputmode: 'numeric', min: '0', value,
      style: { textAlign: 'center' },
      onchange: (e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0))),
    }),
  );
}
