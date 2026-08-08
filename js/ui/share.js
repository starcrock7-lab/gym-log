// Sending a split, and receiving one.

import { h, frag, icon, screen, sheet, closeSheet, toast, empty } from '../dom.js';
import { state, exercisesById, saveExercise, saveRoutine, lastPerformanceSession } from '../store.js';
import { formatWeight } from '../calc.js';
import {
  buildSharePayload, encodeShare, decodeShare, validateSharePayload,
  planImport, routineFromPlan, shareUrl,
} from '../share.js';

function appBase() {
  return `${location.origin}${location.pathname}`;
}

// --- sending ----------------------------------------------------------------

export function shareRoutineSheet(routine) {
  const payload = buildSharePayload(routine, exercisesById());
  const code = encodeShare(payload);
  const url = shareUrl(code, appBase());

  const link = h('input', { class: 'input mono', value: url, readonly: true, onfocus: (e) => e.target.select() });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      // Clipboard is blocked without a secure context or a user gesture in
      // some browsers; selecting the text is always available.
      link.focus();
      link.select();
      toast('Press and hold the link to copy', { error: true });
    }
  };

  sheet(`Share "${routine.name}"`, frag(
    h('div', { class: 'panel' },
      'This sends the plan — exercises, sets and rep ranges. It does not send your weights. ',
      'When they run it, the numbers they see are their own, from their own history.'),

    h('div', { class: 'field' }, h('label', {}, 'Link'), link),

    h('p', { class: 'dim small' },
      `${routine.exercises.length} ${routine.exercises.length === 1 ? 'exercise' : 'exercises'} · ${url.length} characters. ` +
      'Anyone who opens it on a phone with the app installed gets the split added.'),
  ), {
    actions: [
      h('button', { class: 'btn', onclick: copy }, 'Copy'),
      navigator.share
        ? h('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              try {
                await navigator.share({ title: `${routine.name} — Gym Log split`, text: `My ${routine.name} split:`, url });
                closeSheet();
              } catch {
                // The user dismissed the share sheet. Nothing to report.
              }
            },
          }, icon('forward'), 'Send')
        : h('button', { class: 'btn btn-primary', onclick: () => { copy(); closeSheet(); } }, 'Copy link'),
    ],
  });
}

// --- receiving --------------------------------------------------------------

export function importScreen(code) {
  let payload;
  try {
    payload = decodeShare(code);
  } catch (error) {
    return screen('Shared split', { back: '#/routines' }, errorPanel(error.message));
  }

  const check = validateSharePayload(payload);
  if (!check.ok) {
    return screen('Shared split', { back: '#/routines' },
      errorPanel(check.errors[0]),
      check.errors.length > 1
        ? h('ul', { class: 'dim small' }, check.errors.slice(1, 6).map((e) => h('li', {}, e)))
        : null);
  }

  const plan = planImport(payload, state.exercises);

  return screen(plan.name, {
    back: '#/routines',
    subtitle: `Shared split · ${plan.items.length} ${plan.items.length === 1 ? 'exercise' : 'exercises'}`,
  },
    h('div', { class: 'panel' },
      'The plan is theirs; the weights will be yours. ',
      plan.knownCount
        ? `You have logged ${plan.knownCount} of these before, so your own numbers appear as soon as you start it.`
        : 'You have not logged any of these yet, so you will be setting your own baseline.'),

    plan.note ? h('p', { class: 'muted small' }, plan.note) : null,

    h('div', { class: 'stack-sm' },
      h('p', { class: 'section-title' }, 'What you are getting'),
      plan.items.map((item) => {
        const previous = item.resolved ? lastPerformanceSession(item.resolved.id) : null;
        return h('div', { class: 'card card-tight' },
          h('div', { class: 'spread' },
            h('div', { class: 'grow' },
              h('div', { class: 'truncate' }, item.definition.name),
              h('div', { class: 'dim small' },
                `${item.definition.muscleGroup} · ${item.targetSets} × ${item.repsLow}–${item.repsHigh}`),
            ),
            item.action === 'create'
              ? h('span', { class: 'pill' }, 'New')
              : h('span', { class: 'pill pill-pr' }, 'Yours'),
          ),
          previous
            ? h('p', { class: 'small mono', style: { marginTop: '5px', color: 'var(--win)' } },
                `Your last: ${previous.sets.map((s) => `${formatWeight(s.weightLb)}×${s.reps}`).join('  ')}`)
            : item.resolved
              ? h('p', { class: 'dim small', style: { marginTop: '5px' } }, 'In your library, not logged yet')
              : null,
        );
      }),
    ),

    plan.newCount
      ? h('p', { class: 'dim small' },
          `${plan.newCount} ${plan.newCount === 1 ? 'exercise is' : 'exercises are'} new to you and will be added to your library.`)
      : null,

    h('button', {
      class: 'btn btn-primary btn-block btn-lg',
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          const routine = await applyImport(plan);
          toast(`Added "${routine.name}"`);
          location.hash = `#/routine/${routine.id}`;
        } catch (error) {
          toast(error.message || 'Could not add that split', { error: true });
          e.target.disabled = false;
        }
      },
    }, icon('plus'), 'Add to my routines'),

    h('p', { class: 'dim small center' }, 'Nothing of yours is overwritten — this only adds a routine.'),
  );
}

// Creates whatever is missing, then saves the routine. Purely additive: an
// import can add a routine and some exercises, and can never touch history.
async function applyImport(plan) {
  const createdIds = new Map();
  for (const item of plan.items) {
    if (item.resolved) continue;
    const created = await saveExercise({
      name: item.definition.name,
      muscleGroup: item.definition.muscleGroup,
      equipment: item.definition.equipment,
      isBodyweight: item.definition.isBodyweight,
      isCustom: true,
    });
    createdIds.set(item.definition.id, created.id);
  }
  return saveRoutine(routineFromPlan(plan, createdIds, state.routines.map((r) => r.name)));
}

function errorPanel(message) {
  return frag(
    h('div', { class: 'panel panel-bad' }, message),
    h('p', { class: 'dim small' },
      'Share links are long. If it arrived over a chat app it may have been shortened or wrapped — ask for it again, or have them send the link as plain text.'),
    h('a', { class: 'btn btn-block', href: '#/routines' }, 'Back to routines'),
  );
}

// --- pasting a code by hand -------------------------------------------------

export function pasteSplitSheet() {
  const field = h('textarea', { class: 'input', placeholder: 'Paste the share link here', rows: 3 });

  sheet('Add a shared split', frag(
    h('p', { class: 'muted small' }, 'Paste a link a friend sent you.'),
    h('div', { class: 'field' }, h('label', {}, 'Link'), field),
  ), {
    actions: [
      h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          const text = field.value.trim();
          const match = text.match(/#\/import\/([A-Za-z0-9_-]+)/);
          // Accept a bare code too — people paste all sorts of things.
          const code = match ? match[1] : text.replace(/\s+/g, '');
          if (!code) { toast('Paste a link first', { error: true }); return; }
          closeSheet();
          location.hash = `#/import/${code}`;
        },
      }, 'Open'),
    ],
  });
}
