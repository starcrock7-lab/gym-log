// The only network code in the app.
//
// It runs after a workout is finished and when you press the button in
// Settings — never on a path you are waiting on mid-session. If it fails, it
// says so and the app carries on; a lost connection must never cost you a set.

import * as db from './db.js';
import { STORE, KV, buildExport, validateExport, normaliseExport } from './schema.js';
import { encryptPayload, isEncrypted, decryptPayload } from './crypto.js';
import { state, saveBackupState } from './store.js';

const GIST_FILENAME = 'gym-log-backup.json';
const API = 'https://api.github.com';

// --- credentials ------------------------------------------------------------

// Kept under their own key so that export, which reads the data stores, can
// never sweep them into a file you might share.
export async function getAuth() {
  return (await db.getKv(KV.backupAuth)) || { token: '', passphrase: '' };
}

export async function setAuth(patch) {
  const auth = { ...(await getAuth()), ...patch };
  await db.setKv(KV.backupAuth, auth);
  return auth;
}

export async function clearAuth() {
  await db.deleteKv(KV.backupAuth);
}

// --- payload ----------------------------------------------------------------

export function currentPayload() {
  return buildExport({
    exercises: state.exercises,
    routines: state.routines,
    workouts: state.workouts,
    bodyWeights: state.bodyWeights,
    settings: state.settings,
  });
}

// --- GitHub -----------------------------------------------------------------

async function gh(path, { token, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No connection to GitHub.');
  }

  if (response.status === 401) throw new Error('GitHub rejected the token. Generate a new one with the "gist" scope.');
  if (response.status === 403) throw new Error('GitHub refused the request — the token is missing the "gist" scope, or you have hit a rate limit.');
  if (response.status === 404) throw new Error('That backup gist no longer exists. Press "Back up now" to create a fresh one.');
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  return response.json();
}

export async function pushBackup({ silent = false } = {}) {
  const auth = await getAuth();
  if (!auth.token) throw new Error('No GitHub token saved.');

  const encrypt = state.backup.encrypted !== false;
  if (encrypt && !auth.passphrase) throw new Error('No passphrase saved — set one in Settings, or switch encryption off.');

  const payload = currentPayload();
  const content = encrypt ? await encryptPayload(payload, auth.passphrase) : payload;
  const files = { [GIST_FILENAME]: { content: JSON.stringify(content, null, 2) } };

  try {
    let gistId = state.backup.gistId;
    if (gistId) {
      await gh(`/gists/${gistId}`, { token: auth.token, method: 'PATCH', body: { files } });
    } else {
      const created = await gh('/gists', {
        token: auth.token,
        method: 'POST',
        body: { description: 'Gym Log backup — do not edit by hand', public: false, files },
      });
      gistId = created.id;
    }
    await saveBackupState({ gistId, lastBackupAt: new Date().toISOString(), lastError: null });
    return { gistId, workouts: payload.data.workouts.length, encrypted: encrypt };
  } catch (error) {
    // Recorded rather than swallowed: Settings shows the date and the reason,
    // so silence is never mistaken for a working backup.
    await saveBackupState({ lastError: error.message });
    if (!silent) throw error;
    return null;
  }
}

export async function pullBackup() {
  const auth = await getAuth();
  if (!auth.token) throw new Error('No GitHub token saved.');

  let gistId = state.backup.gistId;
  if (!gistId) {
    const gists = await gh('/gists', { token: auth.token });
    const found = gists.find((g) => g.files && GIST_FILENAME in g.files);
    if (!found) throw new Error('No Gym Log backup found on this GitHub account.');
    gistId = found.id;
  }

  const gist = await gh(`/gists/${gistId}`, { token: auth.token });
  const file = gist.files?.[GIST_FILENAME];
  if (!file) throw new Error('That gist has no Gym Log backup in it.');

  // Large gists come back truncated, with the full body behind raw_url.
  let raw = file.content;
  if (file.truncated && file.raw_url) raw = await (await fetch(file.raw_url)).text();

  let content;
  try {
    content = JSON.parse(raw);
  } catch {
    throw new Error('The backup file is not readable JSON.');
  }

  const payload = isEncrypted(content) ? await decryptPayload(content, auth.passphrase) : content;

  const check = validateExport(payload);
  if (!check.ok) throw new Error(`Backup is not usable: ${check.errors[0]}`);

  await saveBackupState({ gistId });
  return { payload, normalised: normaliseExport(payload) };
}

// Fired after a workout is saved. Deliberately swallows its own failures — the
// error is on record in Settings, and nothing about finishing a session should
// depend on the network.
export async function backupInBackground() {
  if (!state.settings.autoBackup) return;
  const auth = await getAuth();
  if (!auth.token) return;
  await pushBackup({ silent: true });
}

export function backupIsStale(days = 30) {
  if (!state.backup.lastBackupAt) return true;
  return Date.now() - Date.parse(state.backup.lastBackupAt) > days * 86400000;
}
