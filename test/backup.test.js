import test from 'node:test';
import assert from 'node:assert/strict';

import { encryptPayload, decryptPayload, isEncrypted } from '../js/crypto.js';
import { buildExport, validateExport, normaliseExport, defaultSettings } from '../js/schema.js';

const samplePayload = () =>
  buildExport({
    exercises: [{ id: 'bench', name: 'Bench Press', muscleGroup: 'Chest', equipment: 'Barbell' }],
    routines: [{ id: 'rt1', name: 'Push', exercises: [{ exerciseId: 'bench', targetSets: 3, repsLow: 5, repsHigh: 8 }] }],
    workouts: [
      {
        id: 'w1',
        name: 'Push',
        startedAt: '2026-08-01T10:00:00.000Z',
        finishedAt: '2026-08-01T11:02:00.000Z',
        bodyWeightLb: 181.5,
        entries: [{
          exerciseId: 'bench',
          sets: [
            { weightLb: 135, reps: 10, type: 'warmup', done: true },
            { weightLb: 225, reps: 5, type: 'working', done: true },
          ],
        }],
      },
    ],
    bodyWeights: [{ date: '2026-08-01', weightLb: 181.5 }],
    settings: defaultSettings(),
  });

// ---------------------------------------------------------------------------

test('an encrypted backup round-trips back to exactly what went in', async () => {
  const payload = samplePayload();
  const envelope = await encryptPayload(payload, 'correct horse battery staple');
  const restored = await decryptPayload(envelope, 'correct horse battery staple');
  assert.deepEqual(restored, payload);
});

test('the ciphertext gives nothing away', async () => {
  const envelope = await encryptPayload(samplePayload(), 'hunter2');
  const serialised = JSON.stringify(envelope);
  assert.ok(!serialised.includes('Bench Press'), 'exercise names must not be readable');
  assert.ok(!serialised.includes('225'), 'weights must not be readable');
  assert.ok(!serialised.includes('hunter2'), 'the passphrase is never stored in the envelope');
});

test('a wrong passphrase fails rather than returning garbage', async () => {
  const envelope = await encryptPayload(samplePayload(), 'right');
  await assert.rejects(() => decryptPayload(envelope, 'wrong'), /check the passphrase/);
});

test('an empty passphrase fails too', async () => {
  const envelope = await encryptPayload(samplePayload(), 'right');
  await assert.rejects(() => decryptPayload(envelope, ''), /check the passphrase/);
});

test('a tampered backup is refused, not silently imported', async () => {
  const envelope = await encryptPayload(samplePayload(), 'pass');
  const bytes = atob(envelope.ciphertext).split('');
  bytes[10] = String.fromCharCode(bytes[10].charCodeAt(0) ^ 0xff);
  const tampered = { ...envelope, ciphertext: btoa(bytes.join('')) };
  await assert.rejects(() => decryptPayload(tampered, 'pass'), /check the passphrase/);
});

test('encrypting the same data twice produces different ciphertext', async () => {
  const payload = samplePayload();
  const a = await encryptPayload(payload, 'pass');
  const b = await encryptPayload(payload, 'pass');
  assert.notEqual(a.ciphertext, b.ciphertext, 'a reused salt/IV would be a real weakness');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
});

test('encryption refuses to run without a passphrase', async () => {
  await assert.rejects(() => encryptPayload(samplePayload(), ''), /passphrase is required/);
});

test('an encrypted envelope is recognisable, and a plain export is not mistaken for one', () => {
  assert.equal(isEncrypted({ encryption: 'AES-GCM', salt: 'a', iv: 'b', ciphertext: 'c' }), true);
  assert.equal(isEncrypted(samplePayload()), false);
  assert.equal(isEncrypted(null), false);
  assert.equal(isEncrypted({ encryption: 'AES-GCM' }), false, 'a half-written envelope is not usable');
});

// ---------------------------------------------------------------------------

test('backup → restore preserves every workout, set and warm-up flag', async () => {
  const payload = samplePayload();
  const envelope = await encryptPayload(payload, 'pass');
  const restored = await decryptPayload(envelope, 'pass');

  assert.equal(validateExport(restored).ok, true);
  const data = normaliseExport(restored);

  assert.equal(data.workouts.length, 1);
  assert.equal(data.workouts[0].bodyWeightLb, 181.5);
  assert.equal(data.workouts[0].entries[0].sets.length, 2);
  assert.equal(data.workouts[0].entries[0].sets[0].type, 'warmup');
  assert.equal(data.workouts[0].entries[0].sets[1].weightLb, 225);
  assert.equal(data.routines[0].name, 'Push');
  assert.equal(data.bodyWeights[0].weightLb, 181.5);
});

test('a restore of a decrypted-but-corrupt payload is caught by validation', async () => {
  const payload = samplePayload();
  payload.data.workouts[0].startedAt = 'not a date';
  const restored = await decryptPayload(await encryptPayload(payload, 'p'), 'p');
  assert.equal(validateExport(restored).ok, false);
});

test('a plain (unencrypted) backup still validates and restores', () => {
  const payload = samplePayload();
  assert.equal(validateExport(payload).ok, true);
  assert.equal(normaliseExport(payload).workouts.length, 1);
});
