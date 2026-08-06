// Backup encryption. Split out from backup.js so it can be tested without a
// browser: this module touches nothing but WebCrypto, which Node has too.

const PBKDF2_ITERATIONS = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPayload(payload, passphrase) {
  if (!passphrase) throw new Error('A passphrase is required to encrypt a backup.');
  // A fresh salt and IV every time. Reusing either across backups is what
  // turns AES-GCM from safe into broken.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return {
    encryption: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(cipher),
  };
}

export async function decryptPayload(envelope, passphrase) {
  if (!isEncrypted(envelope)) throw new Error('That file is not an encrypted backup.');
  try {
    const key = await deriveKey(passphrase || '', fromB64(envelope.salt), envelope.iterations || PBKDF2_ITERATIONS);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.ciphertext));
    return JSON.parse(dec.decode(plain));
  } catch {
    // AES-GCM fails closed, and a wrong passphrase is indistinguishable from a
    // tampered file. Both mean the same thing: do not import this.
    throw new Error('Could not decrypt the backup — check the passphrase.');
  }
}

export function isEncrypted(content) {
  return Boolean(content && content.encryption === 'AES-GCM' && content.salt && content.iv && content.ciphertext);
}
