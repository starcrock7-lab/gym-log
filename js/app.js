// Boot, routing, and the two things that live outside any one screen: the rest
// timer and the tab bar.

import { h, mount, icon, toast, frag } from './dom.js';
import { state, subscribe, init, adjustRest, stopRest } from './store.js';
import { backupInBackground } from './backup.js';
import { homeScreen } from './ui/home.js';
import { workoutScreen } from './ui/workout.js';
import { historyScreen, sessionScreen } from './ui/history.js';
import { exerciseListScreen, exerciseScreen } from './ui/exercises.js';
import { routinesScreen, routineScreen } from './ui/routines.js';
import { bodyScreen } from './ui/body.js';
import { settingsScreen } from './ui/settings.js';

const app = document.getElementById('app');

const ROUTES = [
  [/^\/?$/, () => homeScreen()],
  [/^\/workout$/, () => workoutScreen()],
  [/^\/history$/, () => historyScreen()],
  [/^\/session\/(.+)$/, (id) => sessionScreen(id)],
  [/^\/exercises$/, () => exerciseListScreen()],
  [/^\/exercise\/(.+)$/, (id) => exerciseScreen(id)],
  [/^\/routines$/, () => routinesScreen()],
  [/^\/routine\/(.+)$/, (id) => routineScreen(id)],
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
    app.append(tabBar(path));
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
// Rest timer
// ---------------------------------------------------------------------------

// Rendered outside the router so it survives navigation, and driven off the
// stored end timestamp so locking the phone cannot desynchronise it.
const restHost = h('div', {});
document.body.append(restHost);

let alerted = false;

function paintRest() {
  const rest = state.rest;
  if (!rest) {
    restHost.replaceChildren();
    alerted = false;
    return;
  }

  const remaining = Math.max(0, rest.endsAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  const done = remaining <= 0;

  if (done && !alerted) {
    alerted = true;
    if (state.settings.vibrate && navigator.vibrate) navigator.vibrate([180, 90, 180]);
    if (state.settings.sound) beep();
  }

  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const pct = done ? 100 : 100 - (remaining / (rest.durationSec * 1000)) * 100;

  restHost.replaceChildren(
    h('div', { class: `rest-bar${done ? ' done' : ''}` },
      h('span', { class: 'time' }, done ? 'Go' : label),
      h('span', { class: 'grow muted small truncate' }, done ? 'Rest over' : rest.label || 'Rest'),
      h('button', { class: 'btn btn-sm', onclick: () => adjustRest(-15) }, '−15'),
      h('button', { class: 'btn btn-sm', onclick: () => adjustRest(15) }, '+15'),
      h('button', { class: 'icon-btn', 'aria-label': 'Dismiss rest timer', onclick: () => stopRest() }, icon('close')),
      h('div', { class: 'rest-progress', style: { width: `${Math.min(100, pct)}%` } }),
    ),
  );
}

setInterval(paintRest, 500);

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    setTimeout(() => ctx.close(), 600);
  } catch {
    // Audio is a nicety; a browser that blocks it must not break the timer.
  }
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
    paintRest();
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
    render();
    paintRest();
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
