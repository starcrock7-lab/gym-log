import { h, frag, icon, screen, empty, relativeDay, sheet, closeSheet, confirmSheet, toast } from '../dom.js';
import { state, exerciseById, finishedWorkouts, saveExercise, removeExercise } from '../store.js';
import {
  personalRecords, trendVerdict, exerciseSessions, estimate1RM, effectiveLoadLb,
  formatWeight, formatVolume, isConfident,
} from '../calc.js';
import { lineChart } from '../charts.js';
import { newExerciseSheet } from './pickers.js';
import { MUSCLE_GROUPS, EQUIPMENT } from '../schema.js';

export function exerciseListScreen() {
  const history = finishedWorkouts();
  const counts = new Map();
  for (const workout of history) {
    for (const entry of workout.entries || []) {
      counts.set(entry.exerciseId, (counts.get(entry.exerciseId) || 0) + 1);
    }
  }

  const list = h('div', { class: 'stack-sm' });
  let query = '';
  let group = 'All';

  const render = () => {
    const q = query.trim().toLowerCase();
    const matched = state.exercises
      .filter((e) => !e.archived)
      .filter((e) => group === 'All' || e.muscleGroup === group)
      .filter((e) => !q || `${e.name} ${e.muscleGroup} ${e.equipment}`.toLowerCase().includes(q))
      .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.name.localeCompare(b.name));

    list.replaceChildren(...(matched.length
      ? matched.map((exercise) =>
          h('a', { class: 'card card-tight card-link spread', href: `#/exercise/${exercise.id}` },
            h('div', { class: 'grow' },
              h('div', { class: 'truncate' }, exercise.name),
              h('div', { class: 'muted small' }, `${exercise.muscleGroup} · ${exercise.equipment}`),
            ),
            counts.get(exercise.id)
              ? h('span', { class: 'pill' }, `${counts.get(exercise.id)}×`)
              : h('span', { class: 'muted small' }, 'never'),
          ))
      : [empty('Nothing matches that')]));
  };

  const groups = h('div', { class: 'chip-row' },
    ['All', ...MUSCLE_GROUPS].map((name) =>
      h('button', {
        class: 'chip',
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

  return screen('Exercises', {
    subtitle: `${state.exercises.filter((e) => !e.archived).length} in your library`,
    action: h('button', { class: 'icon-btn', 'aria-label': 'New exercise', onclick: () => newExerciseSheet('', () => { location.hash = '#/exercises'; }) }, icon('plus')),
  },
    h('input', { class: 'input', type: 'search', placeholder: 'Search exercises', oninput: (e) => { query = e.target.value; render(); } }),
    groups,
    list,
  );
}

// ---------------------------------------------------------------------------

const RANGES = [
  ['30d', 30], ['90d', 90], ['1y', 365], ['All', Infinity],
];

export function exerciseScreen(id) {
  const exercise = exerciseById(id);
  if (!exercise) return screen('Exercise', { back: '#/exercises' }, empty('That exercise no longer exists'));

  const history = finishedWorkouts();
  const sessions = exerciseSessions(history, id);
  const prs = personalRecords(history, exercise);
  const verdict = trendVerdict(history, exercise);

  const chartBox = h('div', {});
  let rangeDays = 90;

  const drawChart = () => {
    const cutoff = rangeDays === Infinity ? 0 : Date.now() - rangeDays * 86400000;
    const points = sessions
      .filter((s) => s.at >= cutoff)
      .map((session) => {
        let best = 0;
        for (const set of session.sets) {
          const est = estimate1RM(effectiveLoadLb(set, exercise, session.bodyWeightLb), set.reps);
          if (isConfident(est) && est.value > best) best = est.value;
        }
        return best ? { x: session.at, y: best } : null;
      })
      .filter(Boolean);
    chartBox.replaceChildren(lineChart(points, { format: (v) => `${Math.round(v)}` }));
  };

  const rangeTabs = h('div', { class: 'range-tabs' },
    RANGES.map(([label, days]) =>
      h('button', {
        class: days === rangeDays ? 'on' : '',
        onclick: (e) => {
          rangeDays = days;
          for (const b of rangeTabs.children) b.classList.remove('on');
          e.currentTarget.classList.add('on');
          drawChart();
        },
      }, label)),
  );
  drawChart();

  return screen(exercise.name, {
    back: '#/exercises',
    subtitle: `${exercise.muscleGroup} · ${exercise.equipment}`,
    action: h('button', { class: 'icon-btn', 'aria-label': 'Options', onclick: () => exerciseOptions(exercise) }, icon('grip')),
  },
    verdictCard(verdict),

    prs.sessionCount
      ? frag(
          h('div', { class: 'card stack-sm' },
            h('p', { class: 'section-title' }, 'Estimated 1 rep max'),
            rangeTabs,
            chartBox,
            h('p', { class: 'muted small' }, 'Best confident estimate per session. Sets above 12 reps are left out — they say more about endurance than strength.'),
          ),

          h('div', { class: 'stat-row' },
            prs.heaviest ? statCard('Heaviest', `${formatWeight(prs.heaviest.loadLb)} lb`, `× ${prs.heaviest.reps} · ${relativeDay(new Date(prs.heaviest.at).toISOString())}`) : null,
            prs.bestE1RM ? statCard('Best est. 1RM', `${formatWeight(prs.bestE1RM.value)} lb`, `from ${formatWeight(prs.bestE1RM.loadLb)} × ${prs.bestE1RM.reps}`) : null,
            prs.bestSetVolume ? statCard('Best set', `${formatVolume(prs.bestSetVolume.volumeLb)} lb`, `${formatWeight(prs.bestSetVolume.loadLb)} × ${prs.bestSetVolume.reps}`) : null,
            statCard('Sessions', String(prs.sessionCount)),
          ),

          prs.repsAtWeight.length
            ? h('div', { class: 'card stack-sm' },
                h('p', { class: 'section-title' }, 'Best reps at each weight'),
                h('div', { class: 'list' },
                  prs.repsAtWeight.slice(0, 8).map((record) =>
                    h('div', { class: 'list-item', style: { cursor: 'default' } },
                      h('span', { class: 'grow mono' }, `${formatWeight(record.loadLb)} lb`),
                      h('span', { class: 'mono' }, `${record.reps} reps`),
                      h('span', { class: 'muted small' }, relativeDay(new Date(record.at).toISOString())),
                    )),
                ),
              )
            : null,

          h('div', { class: 'stack-sm' },
            h('p', { class: 'section-title' }, 'Every session'),
            [...sessions].reverse().map((session) =>
              h('a', { class: 'card card-tight card-link', href: `#/session/${session.workoutId}` },
                h('div', { class: 'spread' },
                  h('span', { class: 'muted small' }, relativeDay(new Date(session.at).toISOString())),
                  h('span', { class: 'muted small mono' }, `${session.sets.length} sets`),
                ),
                h('div', { class: 'mono small', style: { marginTop: '4px' } },
                  session.sets.map((set) => `${formatWeight(effectiveLoadLb(set, exercise, session.bodyWeightLb))}×${set.reps}`).join('   ')),
              )),
          ),
        )
      : empty('No completed sets yet', 'Log this exercise in a workout and its history builds here.'),
  );
}

function verdictCard(verdict) {
  const iconName = verdict.status === 'up' ? 'up' : verdict.status === 'down' ? 'down' : 'flat';
  const cls = verdict.status === 'insufficient' ? '' : ` verdict-${verdict.status}`;
  return h('div', { class: `verdict${cls}` },
    icon(verdict.status === 'insufficient' ? 'timer' : iconName),
    h('div', { class: 'grow' },
      h('h2', {}, verdict.label),
      h('p', { class: 'small', style: { opacity: 0.85 } },
        verdict.status === 'insufficient'
          ? `Needs at least 2 sessions in each 4-week window — you have ${verdict.recentSessions} recent and ${verdict.priorSessions} before that.`
          : `Best estimated 1RM: ${formatWeight(verdict.recentBestLb)} lb now vs ${formatWeight(verdict.priorBestLb)} lb then.`),
    ),
  );
}

function statCard(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 's' }, sub) : null);
}

function exerciseOptions(exercise) {
  const name = h('input', { class: 'input', value: exercise.name });
  const group = h('select', { class: 'input' }, MUSCLE_GROUPS.map((g) => h('option', { value: g, selected: g === exercise.muscleGroup }, g)));
  const equipment = h('select', { class: 'input' }, EQUIPMENT.map((g) => h('option', { value: g, selected: g === exercise.equipment }, g)));
  const rest = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: `Default (${state.settings.defaultRestSec}s)`, value: exercise.defaultRestSec ?? '' });
  const bodyweight = h('input', { type: 'checkbox', checked: exercise.isBodyweight });

  sheet('Edit exercise', frag(
    h('div', { class: 'field' }, h('label', {}, 'Name'), name),
    h('div', { class: 'field' }, h('label', {}, 'Muscle group'), group),
    h('div', { class: 'field' }, h('label', {}, 'Equipment'), equipment),
    h('div', { class: 'field' }, h('label', {}, 'Rest between sets (seconds)'), rest),
    h('label', { class: 'switch' }, h('span', {}, 'Loaded by bodyweight'), bodyweight),
    h('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        closeSheet();
        const ok = await confirmSheet('Remove this exercise?', 'If it appears in any workout or routine it is hidden rather than deleted, so your history stays intact.', { confirmLabel: 'Remove', danger: true });
        if (!ok) return;
        await removeExercise(exercise.id);
        toast('Exercise removed');
        location.hash = '#/exercises';
      },
    }, 'Remove exercise'),
  ), {
    actions: [
      h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          await saveExercise({
            ...exercise,
            name: name.value.trim() || exercise.name,
            muscleGroup: group.value,
            equipment: equipment.value,
            defaultRestSec: Number(rest.value) || null,
            isBodyweight: bodyweight.checked,
          });
          closeSheet();
          toast('Saved');
        },
      }, 'Save'),
    ],
  });
}
