import { h, frag, icon, screen, sheet, closeSheet, confirmSheet, toast, relativeDay } from '../dom.js';
import { state, saveSettings, saveBackupState, init as reloadStore } from '../store.js';
import * as db from '../db.js';
import { STORE, validateExport, normaliseExport, buildExport, defaultSettings } from '../schema.js';
import { getAuth, setAuth, clearAuth, pushBackup, pullBackup, backupIsStale, currentPayload } from '../backup.js';
import { formatWeight } from '../calc.js';

export function settingsScreen() {
  const { settings, backup } = state;

  return screen('Settings', {},
    backupCard(),

    h('div', { class: 'card stack' },
      h('p', { class: 'section-title' }, 'Workout'),
      numberSetting('Rest timer (seconds)', settings.defaultRestSec, (v) => saveSettings({ defaultRestSec: v })),
      numberSetting('Bar weight (lb)', settings.barWeightLb, (v) => saveSettings({ barWeightLb: v }), 2.5),
      h('div', { class: 'field' },
        h('label', {}, 'Plates you own (lb, per pair)'),
        h('input', {
          class: 'input', value: settings.plates.join(', '),
          onchange: async (e) => {
            const plates = e.target.value.split(',').map((p) => Number(p.trim())).filter((p) => p > 0).sort((a, b) => b - a);
            if (!plates.length) { e.target.value = settings.plates.join(', '); return; }
            await saveSettings({ plates });
            e.target.value = plates.join(', ');
            toast('Plates updated');
          },
        }),
        h('p', { class: 'muted small' }, 'Used by the plate calculator to work out what to load.'),
      ),
      toggle('Vibrate when rest ends', settings.vibrate, (v) => saveSettings({ vibrate: v })),
      toggle('Sound when rest ends', settings.sound, (v) => saveSettings({ sound: v })),
      toggle('Keep screen awake during a workout', settings.keepScreenAwake, (v) => saveSettings({ keepScreenAwake: v })),
    ),

    h('div', { class: 'card stack' },
      h('p', { class: 'section-title' }, 'Your data'),
      h('p', { class: 'muted small' }, 'Everything lives on this device. Nothing is uploaded except the backup you set up above.'),
      h('button', { class: 'btn btn-block', onclick: exportFile }, 'Export to a file'),
      h('button', { class: 'btn btn-block', onclick: importFile }, 'Import from a file'),
      h('button', { class: 'btn btn-danger btn-block', onclick: wipe }, 'Erase everything'),
    ),

    h('p', { class: 'muted small center' },
      `${state.workouts.filter((w) => w.finishedAt).length} workouts · ${state.exercises.length} exercises · ${state.bodyWeights.length} weigh-ins`),
  );
}

// ---------------------------------------------------------------------------

function backupCard() {
  const { backup } = state;
  const stale = backupIsStale();
  const configured = Boolean(backup.gistId || backup.lastBackupAt);

  return h('div', {
    class: 'card stack',
    style: backup.lastError || (configured && stale) ? { borderColor: 'var(--warn)' } : {},
  },
    h('div', { class: 'spread' },
      h('p', { class: 'section-title' }, 'Backup'),
      icon('cloud'),
    ),

    backup.lastError
      ? h('p', { class: 'small', style: { color: 'var(--warn)' } }, `Last attempt failed: ${backup.lastError}`)
      : backup.lastBackupAt
        ? h('p', { class: 'muted small' }, `Last backed up ${relativeDay(backup.lastBackupAt).toLowerCase()}${stale ? ' — overdue' : ''}`)
        : h('p', { class: 'muted small' }, 'Not set up. Your history exists only on this phone, and deleting the app icon would take it with you.'),

    h('button', { class: 'btn btn-block', onclick: backupSheet }, configured ? 'Backup settings' : 'Set up backup'),
    configured
      ? h('div', { class: 'row' },
          h('button', {
            class: 'btn grow',
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const result = await pushBackup();
                toast(`Backed up ${result.workouts} workouts`);
              } catch (error) {
                toast(error.message, { error: true });
              } finally {
                e.target.disabled = false;
              }
            },
          }, 'Back up now'),
          h('button', { class: 'btn grow', onclick: restore }, 'Restore'),
        )
      : null,
  );
}

function backupSheet() {
  const token = h('input', { class: 'input', type: 'password', placeholder: 'ghp_… or github_pat_…', autocapitalize: 'none', autocomplete: 'off' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'Passphrase', autocapitalize: 'none', autocomplete: 'off' });
  const passAgain = h('input', { class: 'input', type: 'password', placeholder: 'Passphrase again', autocapitalize: 'none', autocomplete: 'off' });
  const encrypt = h('input', { type: 'checkbox', checked: state.backup.encrypted !== false });
  const recorded = h('input', { type: 'checkbox' });
  const auto = h('input', { type: 'checkbox', checked: state.settings.autoBackup });

  getAuth().then((auth) => {
    token.value = auth.token || '';
    pass.value = auth.passphrase || '';
    passAgain.value = auth.passphrase || '';
    if (auth.passphrase) recorded.checked = true;
  });

  sheet('Backup to a private gist', h('div', { class: 'stack' },
    h('p', { class: 'muted small' },
      'Creates one secret gist on your GitHub account and overwrites it after each workout. Secret gists are visible only to you. Generate a token with the ',
      h('strong', {}, 'gist'),
      ' scope and nothing else — it can reach your gists and no other part of your account.'),

    h('div', { class: 'field' }, h('label', {}, 'GitHub token'), token),
    h('label', { class: 'switch' }, h('span', {}, 'Encrypt the backup'), encrypt),
    h('div', { class: 'field' }, h('label', {}, 'Passphrase'), pass),
    h('div', { class: 'field' }, h('label', {}, 'Confirm passphrase'), passAgain),
    h('label', { class: 'switch' },
      h('span', {}, 'I have recorded this passphrase somewhere',
        h('div', { class: 'muted small' }, 'There is no reset. Lose it and the backup is unreadable.')),
      recorded),
    h('label', { class: 'switch' }, h('span', {}, 'Back up automatically after each workout'), auto),
  ), {
    actions: [
      h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const wantsEncryption = encrypt.checked;
          if (!token.value.trim()) { toast('Paste a GitHub token', { error: true }); return; }
          if (wantsEncryption) {
            if (!pass.value) { toast('Set a passphrase', { error: true }); return; }
            if (pass.value !== passAgain.value) { toast('The two passphrases do not match', { error: true }); return; }
            if (!recorded.checked) { toast('Confirm you have recorded the passphrase', { error: true }); return; }
          }
          await setAuth({ token: token.value.trim(), passphrase: wantsEncryption ? pass.value : '' });
          await saveBackupState({ encrypted: wantsEncryption, lastError: null });
          await saveSettings({ autoBackup: auto.checked });
          closeSheet();
          try {
            const result = await pushBackup();
            toast(`Backed up ${result.workouts} workouts${result.encrypted ? ', encrypted' : ''}`);
          } catch (error) {
            toast(error.message, { error: true });
          }
        },
      }, 'Save and back up'),
    ],
  });
}

async function restore() {
  const ok = await confirmSheet(
    'Restore from backup?',
    'Everything on this device is replaced by what is in the backup. Anything logged here since the last backup is lost.',
    { confirmLabel: 'Restore', danger: true },
  );
  if (!ok) return;

  try {
    const { normalised, payload } = await pullBackup();
    await db.replaceAll(normalised);
    await reloadStore();
    toast(`Restored ${payload.data.workouts.length} workouts`);
    location.hash = '#/';
  } catch (error) {
    toast(error.message, { error: true });
  }
}

// ---------------------------------------------------------------------------

function exportFile() {
  const payload = currentPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const link = h('a', { href: url, download: `gym-log-${stamp}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  saveBackupState({ lastBackupAt: new Date().toISOString() });
  toast(`Exported ${payload.data.workouts.length} workouts`);
}

function importFile() {
  const picker = h('input', { type: 'file', accept: 'application/json,.json' });
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast('That file is not readable JSON', { error: true });
      return;
    }

    const check = validateExport(payload);
    if (!check.ok) {
      // Refused whole rather than half-loaded over a working history.
      sheet('Cannot import this file', h('div', { class: 'stack-sm' },
        h('p', { class: 'muted small' }, 'Nothing was changed. The file has these problems:'),
        h('ul', { class: 'muted small' }, check.errors.slice(0, 8).map((e) => h('li', {}, e))),
      ), { actions: [h('button', { class: 'btn btn-block', onclick: closeSheet }, 'Close')] });
      return;
    }

    const incoming = payload.data.workouts?.length || 0;
    const ok = await confirmSheet(
      'Replace everything?',
      `This file holds ${incoming} workouts. Importing it replaces the ${state.workouts.filter((w) => w.finishedAt).length} on this device.`,
      { confirmLabel: 'Import', danger: true },
    );
    if (!ok) return;

    await db.replaceAll(normaliseExport(payload));
    await reloadStore();
    toast(`Imported ${incoming} workouts`);
    location.hash = '#/';
  };
  picker.click();
}

async function wipe() {
  const ok = await confirmSheet(
    'Erase everything?',
    'Every workout, routine and weigh-in on this device is deleted. If you have no backup, this cannot be undone.',
    { confirmLabel: 'Erase', danger: true, requireText: 'ERASE' },
  );
  if (!ok) return;
  await db.wipeEverything();
  await reloadStore();
  toast('Everything erased');
  location.hash = '#/';
}

// ---------------------------------------------------------------------------

function numberSetting(label, value, onChange, step = 1) {
  return h('div', { class: 'field' },
    h('label', {}, label),
    h('input', {
      class: 'input', type: 'number', inputmode: 'decimal', step: String(step), min: '0', value,
      onchange: (e) => { const v = Number(e.target.value); if (v >= 0) onChange(v); },
    }),
  );
}

function toggle(label, checked, onChange) {
  return h('label', { class: 'switch' },
    h('span', {}, label),
    h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
  );
}
