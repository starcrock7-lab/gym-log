// Boot, routing, and the two things that live outside any one screen: the rest
// timer and the tab bar.

import { h, mount, icon, toast, frag } from './dom.js';
import { state, subscribe, init } from './store.js';
import { backupInBackground } from './backup.js';
import { homeScreen } from './ui/home.js';
import { workoutScreen } from './ui/workout.js';
import { focusScreen } from './ui/focus.js';
import { mountTimer, repaintTimer } from './ui/timer.js';
import { historyScreen, sessionScreen } from './ui/history.js';
import { exerciseListScreen, exerciseScreen } from './ui/exercises.js';
import { routinesScreen, routineScreen } from './ui/routines.js';
import { importScreen } from './ui/share.js';
import { bodyScreen } from './ui/body.js';
import { settingsScreen } from './ui/settings.js';

const app = document.getElementById('app');

const ROUTES = [
  [/^\/?$/, () => homeScreen()],
  [/^\/workout$/, () => workoutScreen()],
  [/^\/focus(?:\/(\d+))?$/, (index) => focusScreen(index)],
  [/^\/history$/, () => historyScreen()],
  [/^\/session\/(.+)$/, (id) => sessionScreen(id)],
  [/^\/exercises$/, () => exerciseListScreen()],
  [/^\/exercise\/(.+)$/, (id) => exerciseScreen(id)],
  [/^\/routines$/, () => routinesScreen()],
  [/^\/routine\/(.+)$/, (id) => routineScreen(id)],
  [/^\/import\/(.+)$/, (code) => importScreen(code)],
  [/^\/body$/, () => bodyScreen()],
  [/^\/settings$/, () => settingsScreen()],
];

const TABS = [
  ['#/', 'dumbbell', 'Workout'],
  ['#/history', 'history', 'History'],
  ['#/exercises', 'list', 'Exercises'],
  ['#/body', 'body', 'Body'],
  ['#/settings', 'gear', 'Settings'],
];

function currentPath() {
  return (location.hash.replace(/^#/, '') || '/');
}

function render() {
  const path = currentPath();
  const scrollY = window.scrollY;

  for (const [pattern, view] of ROUTES) {
    const match = path.match(pattern);
    if (!match) continue;
    try {
      mount(app, view(...match.slice(1)));
    } catch (error) {
      console.error(error);
      mount(app, h('div', { class: 'empty' },
        h('p', {}, 'Something went wrong drawing this screen.'),
        h('p', { class: 'muted small' }, String(error?.message || error)),
        h('a', { class: 'btn', href: '#/' }, 'Back to start')));
    }
    if (!path.startsWith('/focus')) app.append(tabBar(path));
    // Same screen redrawing after a change should not throw you back to the
    // top of a long history list.
    if (path === lastRenderedPath) window.scrollTo(0, scrollY);
    lastRenderedPath = path;
    return;
  }

  location.hash = '#/';
}

let lastRenderedPath = null;

function tabBar(path) {
  return h('nav', { class: 'tabbar' },
    TABS.map(([href, iconName, label]) => {
      const target = href.replace(/^#/, '');
      const active = target === '/' ? path === '/' || path === '/workout' : path.startsWith(target);
      return h('a', { href, class: active ? 'active' : '' },
        icon(state.active && href === '#/' ? 'timer' : iconName),
        state.active && href === '#/' ? 'Active' : label);
    }),
  );
}

// ---------------------------------------------------------------------------
// Redraw scheduling
// ---------------------------------------------------------------------------

// Redraws happen when the store asks for one, and never as a side effect of
// typing — see the note on `mutateActive`. Deferring a redraw to `blur`
// instead looks tidier and is a trap: blur fires while focus moves to the
// control you just tapped, so the redraw removes that control before its click
// is dispatched and the tap is silently lost.
function scheduleRender() {
  render();
}

// ---------------------------------------------------------------------------
// Screen wake lock
// ---------------------------------------------------------------------------

let wakeLock = null;

async function syncWakeLock() {
  const wanted = Boolean(state.active) && state.settings.keepScreenAwake;
  try {
    if (wanted && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!wanted && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // Denied or unsupported. Not worth telling anyone about.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncWakeLock();
    repaintTimer();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('hashchange', render);

subscribe(() => {
  scheduleRender();
  syncWakeLock();
});

// Finishing a workout is the natural moment to push a backup, and it happens
// after the session is already safely on disk.
let previousWorkoutCount = 0;
subscribe(() => {
  const finished = state.workouts.filter((w) => w.finishedAt).length;
  if (state.ready && finished > previousWorkoutCount && previousWorkoutCount > 0) {
    backupInBackground().catch(() => {});
  }
  previousWorkoutCount = finished;
});

init()
  .then(() => {
    previousWorkoutCount = state.workouts.filter((w) => w.finishedAt).length;
    mountTimer();
    render();
    syncWakeLock();
  })
  .catch((error) => {
    console.error(error);
    mount(app, h('div', { class: 'empty' },
      h('p', {}, 'Could not open the local database.'),
      h('p', { class: 'muted small' }, String(error?.message || error)),
      h('p', { class: 'muted small' }, 'Private browsing blocks storage in some browsers — try a normal window.')));
  });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
