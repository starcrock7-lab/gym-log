// IndexedDB plumbing. Nothing here decides anything — it opens the database,
// reads, writes, and gets out of the way. The decisions live in schema.js and
// calc.js, where they can be tested.

import { DB_NAME, DB_VERSION, STORE, KV } from './schema.js';

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Version 1 creates everything. Later versions add to this switch and
      // fall through, so a database at any age lands on the current shape.
      switch (event.oldVersion) {
        case 0: {
          db.createObjectStore(STORE.exercises, { keyPath: 'id' });
          db.createObjectStore(STORE.routines, { keyPath: 'id' });
          const workouts = db.createObjectStore(STORE.workouts, { keyPath: 'id' });
          workouts.createIndex('startedAt', 'startedAt');
          workouts.createIndex('finishedAt', 'finishedAt');
          db.createObjectStore(STORE.bodyWeights, { keyPath: 'date' });
          db.createObjectStore(STORE.kv, { keyPath: 'key' });
        }
        // falls through
        default:
          break;
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database is open in another tab — close it and reload.'));
  });
  return dbPromise;
}

function run(storeNames, mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        result = work(tx);
        // If `work` returned a request, resolve with its value once it lands.
        if (result && typeof result.then !== 'function' && 'onsuccess' in Object(result)) {
          const request = result;
          request.onsuccess = () => { result = request.result; };
        }
      }),
  );
}

const asPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export async function getAll(storeName) {
  const db = await openDb();
  return asPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await openDb();
  return asPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function put(storeName, value) {
  await run(storeName, 'readwrite', (tx) => tx.objectStore(storeName).put(value));
  return value;
}

export async function putMany(storeName, values) {
  if (!values.length) return;
  await run(storeName, 'readwrite', (tx) => {
    const store = tx.objectStore(storeName);
    for (const value of values) store.put(value);
  });
}

export async function remove(storeName, key) {
  await run(storeName, 'readwrite', (tx) => tx.objectStore(storeName).delete(key));
}

export async function clear(storeNames) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  await run(names, 'readwrite', (tx) => {
    for (const name of names) tx.objectStore(name).clear();
  });
}

// --- singletons -------------------------------------------------------------

export async function getKv(key, fallback = null) {
  const row = await get(STORE.kv, key);
  return row ? row.value : fallback;
}

export async function setKv(key, value) {
  await put(STORE.kv, { key, value });
  return value;
}

export async function deleteKv(key) {
  await remove(STORE.kv, key);
}

// --- wholesale replace ------------------------------------------------------

// Used by import and restore. One transaction across every data store, so a
// failure part-way leaves the old database intact rather than a half-import.
// `kv` is not cleared: that would take the backup credentials with it.
export async function replaceAll({ exercises, routines, workouts, bodyWeights, settings }) {
  const stores = [STORE.exercises, STORE.routines, STORE.workouts, STORE.bodyWeights, STORE.kv];
  await run(stores, 'readwrite', (tx) => {
    for (const [name, rows] of [
      [STORE.exercises, exercises],
      [STORE.routines, routines],
      [STORE.workouts, workouts],
      [STORE.bodyWeights, bodyWeights],
    ]) {
      const store = tx.objectStore(name);
      store.clear();
      for (const row of rows || []) store.put(row);
    }
    if (settings) tx.objectStore(STORE.kv).put({ key: KV.settings, value: settings });
    // An import lands you outside any session — a half-finished workout from
    // another device would be nonsense here.
    tx.objectStore(STORE.kv).delete(KV.activeWorkout);
  });
}

export async function wipeEverything() {
  await clear([STORE.exercises, STORE.routines, STORE.workouts, STORE.bodyWeights, STORE.kv]);
}
