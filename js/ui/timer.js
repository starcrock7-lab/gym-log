// The timer. A compact bar while you are logging, a fullscreen face when you
// tap it — readable from the floor, from a bench, or across the rack.
//
// It paints itself on its own interval and never asks the router to redraw:
// a redraw mid-workout would rebuild the controls under your thumb.

import { h, icon, mount } from '../dom.js';
import {
  state, startRest, adjustRest, pauseRest, resumeRest, resetRest, stopRest,
  restRemainingMs, restIsPaused,
} from '../store.js';

const PRESETS = [30, 60, 90, 120, 180, 300];

let host = null;
let fullscreen = false;
let alerted = false;

export function mountTimer() {
  host = h('div', {});
  document.body.append(host);
  setInterval(paint, 250);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') paint();
  });
  paint();
}

export function openTimerFullscreen() {
  // Start a timer if there isn't one, so the button always does something.
  if (!state.rest) startRest(state.settings.defaultRestSec || 120, '');
  fullscreen = true;
  requestNativeFullscreen();
  paint();
}

export function closeTimerFullscreen() {
  fullscreen = false;
  exitNativeFullscreen();
  paint();
}

// iPhone Safari has no Fullscreen API, so the overlay is the real mechanism and
// this is a bonus on desktop and Android. Failure here must not matter.
function requestNativeFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  } catch { /* not available */ }
}

function exitNativeFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } catch { /* not available */ }
}

function format(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function paint() {
  if (!host) return;
  const rest = state.rest;

  if (!rest) {
    mount(host);
    alerted = false;
    if (fullscreen) { fullscreen = false; exitNativeFullscreen(); }
    return;
  }

  const remaining = restRemainingMs();
  const paused = restIsPaused();
  const done = remaining <= 0 && !paused;

  if (done && !alerted) {
    alerted = true;
    if (state.settings.vibrate && navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
    if (state.settings.sound) beep();
  }
  if (!done) alerted = false;

  mount(host, fullscreen ? fullFace(remaining, paused, done) : bar(remaining, paused, done));
}

// --- compact bar ------------------------------------------------------------

function bar(remaining, paused, done) {
  const pct = done ? 100 : 100 - (remaining / (state.rest.durationSec * 1000)) * 100;

  return h('div', { class: `rest-bar${done ? ' done' : ''}${paused ? ' paused' : ''}` },
    h('button', {
      class: 'time', 'aria-label': 'Open the timer fullscreen',
      onclick: () => { fullscreen = true; requestNativeFullscreen(); paint(); },
    }, done ? 'Go' : format(remaining)),

    h('button', {
      class: 'grow truncate',
      style: { background: 'none', border: 0, textAlign: 'left', color: 'var(--text-3)', fontSize: '0.8rem', cursor: 'pointer', minHeight: '38px' },
      onclick: () => { fullscreen = true; requestNativeFullscreen(); paint(); },
    }, done ? 'Rest over' : paused ? 'Paused' : state.rest.label || 'Rest'),

    h('button', { class: 'btn btn-sm', onclick: () => { adjustRest(-15).then(paint); } }, '−15'),
    h('button', { class: 'btn btn-sm', onclick: () => { adjustRest(15).then(paint); } }, '+15'),
    h('button', {
      class: 'btn btn-sm', 'aria-label': paused ? 'Resume' : 'Pause',
      onclick: () => { (paused ? resumeRest() : pauseRest()).then(paint); },
    }, paused ? '▶' : '❚❚'),
    h('button', { class: 'icon-btn', 'aria-label': 'Dismiss timer', onclick: () => { stopRest().then(paint); } }, icon('close')),

    h('div', { class: 'rest-progress', style: { width: `${Math.min(100, Math.max(0, pct))}%` } }),
  );
}

// --- fullscreen face --------------------------------------------------------

function fullFace(remaining, paused, done) {
  const total = state.rest.durationSec * 1000;
  const fraction = done ? 0 : Math.max(0, Math.min(1, remaining / total));
  const R = 46;
  const circumference = 2 * Math.PI * R;

  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '0 0 100 100');
  for (const [cls, dash] of [['track', null], ['run', circumference * (1 - fraction)]]) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', String(R));
    if (dash != null) {
      circle.setAttribute('stroke-dasharray', String(circumference));
      circle.setAttribute('stroke-dashoffset', String(dash));
    }
    ring.append(circle);
  }

  return h('div', { class: `timer-full${done ? ' done' : ''}` },
    h('div', { class: 'timer-full-top' },
      h('span', { class: 'eyebrow' }, state.rest.label || 'Rest timer'),
      h('button', { class: 'icon-btn', 'aria-label': 'Close fullscreen', onclick: () => { fullscreen = false; exitNativeFullscreen(); paint(); } }, icon('close')),
    ),

    h('div', { class: 'timer-face' },
      h('div', { class: 'timer-ring' },
        ring,
        h('div', { class: 'center' },
          h('div', { class: 'timer-digits' }, done ? 'GO' : format(remaining)),
          h('div', { class: 'timer-label' }, done ? 'Rest over' : paused ? 'Paused' : `of ${format(total)}`),
        ),
      ),
    ),

    h('div', { class: 'timer-presets' },
      PRESETS.map((seconds) =>
        h('button', {
          class: state.rest.durationSec === seconds ? 'on' : '',
          onclick: () => { startRest(seconds, state.rest.label).then(paint); },
        }, seconds >= 60 ? format(seconds * 1000) : `${seconds}s`)),
    ),

    h('div', { class: 'timer-controls' },
      h('button', { class: 'btn btn-lg', onclick: () => { adjustRest(-15).then(paint); } }, '−15s'),
      h('button', {
        class: 'btn btn-lg btn-primary',
        onclick: () => { (done ? resetRest() : paused ? resumeRest() : pauseRest()).then(paint); },
      }, done ? 'Restart' : paused ? 'Resume' : 'Pause'),
      h('button', { class: 'btn btn-lg', onclick: () => { adjustRest(15).then(paint); } }, '+15s'),
    ),

    h('button', {
      class: 'btn btn-ghost btn-block', style: { marginTop: '10px' },
      onclick: () => { stopRest().then(paint); },
    }, 'Skip rest'),
  );
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Three rising blips carry across a noisy gym better than one tone.
    [0, 0.22, 0.44].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 760 + i * 180;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const at = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      osc.start(at);
      osc.stop(at + 0.19);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // Audio is a nicety; a browser that blocks it must not break the timer.
  }
}

export { paint as repaintTimer };
