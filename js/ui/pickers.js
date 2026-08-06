import { h, sheet, closeSheet, icon, frag, mount } from '../dom.js';
import { state, saveExercise } from '../store.js';
import { platesFor, formatWeight } from '../calc.js';
import { MUSCLE_GROUPS, EQUIPMENT } from '../schema.js';

// Pick one or more exercises. Search matches name, muscle group and equipment,
// so "barbell" and "chest" both narrow the list the way you would expect.
export function exercisePicker({ multi = false, exclude = [], onPick }) {
  const excluded = new Set(exclude);
  const chosen = new Set();
  let query = '';
  let group = 'All';

  const results = h('div', { class: 'list' });
  const confirm = multi
    ? h('button', { class: 'btn btn-primary btn-block', disabled: true, onclick: () => { onPick([...chosen]); closeSheet(); } }, 'Add')
    : null;

  const matches = () => {
    const q = query.trim().toLowerCase();
    return state.exercises
      .filter((e) => !e.archived && !excluded.has(e.id))
      .filter((e) => group === 'All' || e.muscleGroup === group)
      .filter((e) => !q || `${e.name} ${e.muscleGroup} ${e.equipment}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const render = () => {
    const list = matches();
    mount(results, list.length
      ? list.map((exercise) => {
          const on = chosen.has(exercise.id);
          return h('button', {
            class: 'list-item',
            onclick: () => {
              if (!multi) { onPick(exercise.id); closeSheet(); return; }
              if (on) chosen.delete(exercise.id); else chosen.add(exercise.id);
              confirm.disabled = chosen.size === 0;
              confirm.textContent = chosen.size ? `Add ${chosen.size}` : 'Add';
              render();
            },
          },
            h('div', { class: 'grow' },
              h('div', { class: 'truncate' }, exercise.name),
              h('div', { class: 'muted small' }, `${exercise.muscleGroup} · ${exercise.equipment}`),
            ),
            on ? h('span', { class: 'pill pill-pr' }, icon('check')) : null,
          );
        })
      : h('div', { class: 'empty' },
          h('p', {}, 'No exercise matches that'),
          h('button', { class: 'btn btn-sm', onclick: () => newExerciseSheet(query, (created) => { onPick(multi ? [created.id] : created.id); closeSheet(); }) }, 'Create it'),
        ));
  };

  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search exercises', autocomplete: 'off',
    oninput: (e) => { query = e.target.value; render(); },
  });

  const groups = h('div', { class: 'row wrap', style: { gap: '6px' } },
    ['All', ...MUSCLE_GROUPS].map((name) =>
      h('button', {
        class: 'btn btn-sm',
        onclick: (e) => {
          group = name;
          for (const b of groups.children) b.classList.remove('btn-primary');
          e.currentTarget.classList.add('btn-primary');
          render();
        },
      }, name)),
  );
  groups.firstChild.classList.add('btn-primary');

  render();
  sheet('Add exercise', frag(search, groups, results), {
    actions: [
      h('button', { class: 'btn', onclick: () => newExerciseSheet(query, (created) => { onPick(multi ? [created.id] : created.id); closeSheet(); }) }, 'New'),
      confirm,
    ].filter(Boolean),
  });
  setTimeout(() => search.focus(), 120);
}

export function newExerciseSheet(prefillName = '', onCreated) {
  const name = h('input', { class: 'input', value: prefillName, placeholder: 'e.g. Incline Machine Press' });
  const group = h('select', { class: 'input' }, MUSCLE_GROUPS.map((g) => h('option', { value: g }, g)));
  const equipment = h('select', { class: 'input' }, EQUIPMENT.map((g) => h('option', { value: g }, g)));
  const bodyweight = h('input', { type: 'checkbox' });

  const save = async () => {
    if (!name.value.trim()) { name.focus(); return; }
    const created = await saveExercise({
      name: name.value.trim(),
      muscleGroup: group.value,
      equipment: equipment.value,
      isBodyweight: bodyweight.checked,
      isCustom: true,
    });
    closeSheet();
    onCreated?.(created);
  };

  sheet('New exercise', frag(
    h('div', { class: 'field' }, h('label', {}, 'Name'), name),
    h('div', { class: 'field' }, h('label', {}, 'Muscle group'), group),
    h('div', { class: 'field' }, h('label', {}, 'Equipment'), equipment),
    h('label', { class: 'switch' }, h('span', {}, 'Loaded by bodyweight', h('div', { class: 'muted small' }, 'Pull-ups, dips — the number you log is added weight')), bodyweight),
  ), { actions: [h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, 'Create')] });
  setTimeout(() => name.focus(), 120);
}

// What to hang on the bar. Honest when a weight cannot be made.
export function plateSheet(targetLb) {
  const { barWeightLb, plates } = state.settings;
  const result = platesFor(targetLb, barWeightLb, plates);

  const body = result.reason === 'below-bar'
    ? h('p', { class: 'muted' }, `${formatWeight(targetLb)} lb is lighter than the ${formatWeight(barWeightLb)} lb bar on its own.`)
    : frag(
        h('div', { class: 'plate-visual' },
          h('div', { class: 'plate-bar' }),
          result.perSide.flatMap((plate) =>
            Array.from({ length: plate.count }, () =>
              h('div', { class: 'plate', style: { height: `${Math.min(74, 26 + plate.lb * 0.85)}px` } }, formatWeight(plate.lb)))),
          h('div', { class: 'plate-bar' }),
        ),
        h('p', { class: 'center muted small' }, 'Per side, biggest plate first'),
        result.perSide.length
          ? h('p', { class: 'center' }, result.perSide.map((p) => `${p.count} × ${formatWeight(p.lb)}`).join('  +  '))
          : h('p', { class: 'center muted' }, 'Empty bar'),
        result.reachable
          ? null
          : h('p', { class: 'card', style: { borderColor: 'var(--warn)' } },
              `Closest you can load is ${formatWeight(result.achievedLb)} lb — ${formatWeight(Math.abs(result.remainderLb))} lb short. Add smaller plates in Settings if you own them.`),
      );

  sheet(`${formatWeight(targetLb)} lb`, body, { actions: [h('button', { class: 'btn btn-block', onclick: closeSheet }, 'Close')] });
}
