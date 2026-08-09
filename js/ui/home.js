import { h, frag, icon, screen, empty, relativeDay, confirmSheet, toast } from '../dom.js';
import { state, finishedWorkouts, startWorkout, routineById, exerciseName } from '../store.js';
import { sessionTotals, formatVolume, formatDuration } from '../calc.js';

export function homeScreen() {
  const history = finishedWorkouts();
  const exercisesById = new Map(state.exercises.map((e) => [e.id, e]));

  // The site's two-tone lockup, in this app's name. `screen` takes a node here.
  return screen(h('span', { class: 'wordmark' }, 'GYM', h('em', {}, 'LOG')), { subtitle: streakLine(history) },
    state.active ? resumeCard() : null,

    h('div', { class: 'stack-sm' },
      h('p', { class: 'section-title' }, 'Start'),
      h('button', {
        class: 'btn btn-primary btn-block btn-lg',
        onclick: () => begin({}),
      }, icon('plus'), 'Start empty workout'),
    ),

    h('div', { class: 'stack-sm' },
      h('div', { class: 'spread' },
        h('p', { class: 'section-title' }, 'Routines'),
        h('a', { class: 'btn btn-sm btn-ghost', href: '#/routines' }, 'Edit'),
      ),
      state.routines.length
        ? h('div', { class: 'stack-sm' },
            [...state.routines].sort((a, b) => a.position - b.position).map((routine) =>
              h('button', { class: 'card card-tight spread', style: { textAlign: 'left', cursor: 'pointer' }, onclick: () => begin({ routineId: routine.id }) },
                h('div', { class: 'grow' },
                  h('div', {}, routine.name),
                  h('div', { class: 'muted small truncate' },
                    routine.exercises.length
                      ? routine.exercises.map((e) => exerciseName(e.exerciseId)).join(' · ')
                      : 'No exercises yet'),
                ),
                h('span', { class: 'pill pill-accent' }, `${routine.exercises.length}`),
              )),
          )
        : empty('No routines yet', 'Create one from the Routines screen.'),
    ),

    h('div', { class: 'stack-sm' },
      h('div', { class: 'spread' },
        h('p', { class: 'section-title' }, 'Recent'),
        history.length > 3 ? h('a', { class: 'btn btn-sm btn-ghost', href: '#/history' }, 'All') : null,
      ),
      history.length
        ? history.slice(0, 3).map((workout) => sessionRow(workout, exercisesById))
        : empty('Nothing logged yet', 'Your first session will show up here.'),
    ),
  );
}

function resumeCard() {
  const totals = sessionTotals(state.active);
  return h('a', { class: 'card card-link', href: '#/workout', style: { borderColor: 'var(--accent)' } },
    h('div', { class: 'spread' },
      h('div', { class: 'grow' },
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'pill pill-accent' }, 'In progress'), h('span', { class: 'truncate' }, state.active.name)),
        h('div', { class: 'muted small' }, `Started ${relativeDay(state.active.startedAt).toLowerCase()} · ${totals.sets} sets logged`),
      ),
      h('span', { class: 'btn btn-primary btn-sm' }, 'Resume'),
    ),
  );
}

export function sessionRow(workout, exercisesById) {
  const totals = sessionTotals(workout, exercisesById);
  return h('a', { class: 'card card-tight card-link', href: `#/session/${workout.id}` },
    h('div', { class: 'spread' },
      h('div', { class: 'grow' },
        h('div', { class: 'truncate' }, workout.name),
        h('div', { class: 'muted small' }, relativeDay(workout.finishedAt)),
      ),
      h('div', { class: 'muted small mono center' },
        h('div', {}, `${totals.sets} sets`),
        h('div', {}, `${formatVolume(totals.volumeLb)} lb`),
      ),
    ),
  );
}

function streakLine(history) {
  if (!history.length) return 'Nothing logged yet';
  const days = new Set(history.map((w) => new Date(w.finishedAt).toDateString()));
  const thisWeek = history.filter((w) => Date.parse(w.finishedAt) > Date.now() - 7 * 86400000).length;
  return `${days.size} training ${days.size === 1 ? 'day' : 'days'} logged · ${thisWeek} this week`;
}

async function begin(options) {
  if (state.active) {
    const ok = await confirmSheet(
      'A workout is already in progress',
      'Starting a new one discards the session you have open.',
      { confirmLabel: 'Discard and start', danger: true },
    );
    if (!ok) { location.hash = '#/workout'; return; }
  }
  const routine = options.routineId ? routineById(options.routineId) : null;
  await startWorkout(options);
  if (routine && !routine.exercises.length) toast('That routine has no exercises yet — add some as you go');
  location.hash = '#/workout';
}
