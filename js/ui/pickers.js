import { h, sheet, closeSheet, icon, frag, mount } from '../dom.js';
import { state, saveExercise } from '../store.js';
import {
  formatWeight, platesOnSide, loadedTotalLb, addPlate, removePlate, plateOptions,
} from '../calc.js';
import { MUSCLE_GROUPS, EQUIPMENT } from '../schema.js';

// Pick one or more exercises. Search matches name, muscle group and equipment,
// so "barbell" and "chest" both narrow the list the way you would expect.
export function exercisePicker({ multi = false, exclude = [], title = 'Add exercise', onPick }) {
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
      .filter((e) => group === 'All' || e.muscleGroups.includes(group))
      .filter((e) => !q || `${e.name} ${e.muscleGroups.join(' ')} ${e.equipment}`.toLowerCase().includes(q))
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
              h('div', { class: 'muted small' }, `${exercise.muscleGroups.join(' · ')} · ${exercise.equipment}`),
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

  // Same filter rail as the Exercises screen: every group visible at once, and
  // compact enough that the list underneath is still worth scrolling.
  const groups = h('div', { class: 'chip-row' },
    ['All', ...MUSCLE_GROUPS].map((name) =>
      h('button', {
        class: 'chip', type: 'button',
        onclick: (e) => {
          group = name;
          for (const b of groups.children) b.classList.remove('on');
          e.currentTarget.classList.add('on');
          render();
        },
      }, name)),
  );
  groups.firstChild.classList.add('on');

  render();
  sheet(title, frag(search, groups, results), {
    actions: [
      h('button', { class: 'btn', onclick: () => newExerciseSheet(query, (created) => { onPick(multi ? [created.id] : created.id); closeSheet(); }) }, 'New'),
      confirm,
    ].filter(Boolean),
  });
  setTimeout(() => search.focus(), 120);
}

// Multi-select for an exercise's muscle groups, shared by the new-exercise and
// edit-exercise sheets.
//
// The chip list is MUSCLE_GROUPS plus anything already on the exercise that is
// not in it. Without that, opening an imported exercise tagged with a group this
// build does not list and pressing Save would silently drop the tag.
export function muscleGroupField(selected = []) {
  const known = [...MUSCLE_GROUPS, ...selected.filter((g) => !MUSCLE_GROUPS.includes(g))];
  const chosen = new Set(selected.length ? selected : [MUSCLE_GROUPS[0]]);

  const chips = known.map((name) =>
    h('button', {
      class: `chip${chosen.has(name) ? ' on' : ''}`, type: 'button',
      'aria-pressed': chosen.has(name) ? 'true' : 'false',
      onclick: (e) => {
        // An exercise tagged with nothing would vanish from every filter, so
        // the last one cannot be turned off.
        if (chosen.has(name) && chosen.size === 1) return;
        if (chosen.has(name)) chosen.delete(name); else chosen.add(name);
        e.currentTarget.classList.toggle('on', chosen.has(name));
        e.currentTarget.setAttribute('aria-pressed', chosen.has(name) ? 'true' : 'false');
      },
    }, name));

  return {
    node: h('div', { class: 'chip-row' }, chips),
    // Keeps the exercise's existing order and appends anything newly picked.
    // Sorting into MUSCLE_GROUPS order instead would reshuffle the head of the
    // list, and the head is what every screen currently shows — so merely
    // opening this sheet and pressing Save could change what an exercise reads
    // as.
    read: () => [
      ...selected.filter((g) => chosen.has(g)),
      ...known.filter((g) => chosen.has(g) && !selected.includes(g)),
    ],
  };
}

export function newExerciseSheet(prefillName = '', onCreated) {
  const name = h('input', { class: 'input', value: prefillName, placeholder: 'e.g. Incline Machine Press' });
  const groups = muscleGroupField();
  const equipment = h('select', { class: 'input' }, EQUIPMENT.map((g) => h('option', { value: g }, g)));
  const bodyweight = h('input', { type: 'checkbox' });

  const save = async () => {
    if (!name.value.trim()) { name.focus(); return; }
    const created = await saveExercise({
      name: name.value.trim(),
      muscleGroups: groups.read(),
      equipment: equipment.value,
      isBodyweight: bodyweight.checked,
      isCustom: true,
    });
    closeSheet();
    onCreated?.(created);
  };

  sheet('New exercise', frag(
    h('div', { class: 'field' }, h('label', {}, 'Name'), name),
    h('div', { class: 'field' }, h('label', {}, 'Muscle groups'), groups.node),
    h('div', { class: 'field' }, h('label', {}, 'Equipment'), equipment),
    h('label', { class: 'switch' }, h('span', {}, 'Loaded by bodyweight', h('div', { class: 'muted small' }, 'Pull-ups, dips — the number you log is added weight')), bodyweight),
  ), { actions: [h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, 'Create')] });
  setTimeout(() => name.focus(), 120);
}

// What to hang on the bar. Honest when a weight cannot be made.
// Load the bar by tapping plates. One side is drawn because one side is what
// you load; the total counts both. Tap a size to add a pair, tap a plate on the
// bar to take it off along with everything outside it.
//
// Opens on whatever weight is already in the box, so adjusting 225 to 235 is two
// taps rather than a rebuild. `onType` is passed when it was opened from the
// weight box, and hands the box back to the keyboard.
export function plateLoaderSheet({ weightLb, onUse, onType }) {
  const { barWeightLb, plates: inventory } = state.settings;
  let plates = platesOnSide(Number(weightLb) || barWeightLb, barWeightLb, inventory);

  // Height tracks plate size, so a glance tells 45s from 10s before you read them.
  const plateHeight = (lb) => Math.round(Math.min(96, 32 + lb * 1.4));

  const total = h('div', { class: 'loader-total', 'aria-live': 'polite' });
  const bar = h('div', { class: 'loader-bar' });
  const adders = h('div', { class: 'loader-adders' });
  const use = h('button', {
    class: 'btn btn-primary',
    onclick: () => { closeSheet(); onUse(loadedTotalLb(barWeightLb, plates)); },
  });

  const render = () => {
    const lb = loadedTotalLb(barWeightLb, plates);
    total.textContent = `${formatWeight(lb)} lb`;
    use.textContent = `Use ${formatWeight(lb)} lb`;

    bar.replaceChildren(
      h('div', { class: 'loader-sleeve', 'aria-hidden': 'true' }),
      ...plates.map((p, i) => h('button', {
        class: 'loader-plate', type: 'button',
        'aria-label': i < plates.length - 1
          ? `Take off the ${formatWeight(p)} and the plates outside it`
          : `Take off the ${formatWeight(p)}`,
        onclick: () => { plates = removePlate(plates, i); render(); },
      }, h('span', { style: { height: `${plateHeight(p)}px` } }, formatWeight(p)))),
      // Native replaceChildren stringifies null into a visible "null"; h() skips
      // it, this does not.
      ...(plates.length ? [] : [h('p', { class: 'loader-empty muted small' }, 'Empty bar')]),
    );

    adders.replaceChildren(...plateOptions(inventory, plates).map(({ lb: p, available }) =>
      h('button', {
        class: 'chip', type: 'button', disabled: !available,
        'aria-label': `Add a pair of ${formatWeight(p)}s`,
        onclick: () => { plates = addPlate(plates, p); render(); },
      }, `+${formatWeight(p)}`)));
  };
  render();

  sheet('Load the bar', frag(
    total,
    h('p', { class: 'center muted small' },
      `${formatWeight(barWeightLb)} lb bar · one side shown · tap a plate to take it off`),
    h('div', { class: 'loader-bar-wrap' }, bar),
    adders,
  ), {
    actions: [
      onType
        ? h('button', { class: 'btn', onclick: () => { closeSheet(); onType(); } }, 'Type it')
        : h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
      use,
    ],
  });
}
