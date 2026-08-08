// Sharing a split.
//
// A shared split carries the *plan* and never the numbers: exercises, set
// counts, rep ranges, rest. When your friend starts it, the weights that appear
// are their own, pulled from their own history by the same code that fills in
// ghost text on any other workout. Sending someone your working weights would
// be worse than useless.
//
// The payload is self-describing — every entry carries the exercise definition,
// not just an id — so the receiving app can show the whole routine even if it
// has none of the exercises, and can match them up by name if the ids differ.
//
// Pure: no DOM, no database. The UI in ui/share.js drives it.

export const SHARE_FORMAT = 'gymlog-split';
export const SHARE_VERSION = 1;

// --- url-safe base64, utf-8 clean -------------------------------------------

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

// --- building ---------------------------------------------------------------

// Short keys because this ends up in a URL someone pastes into a chat.
export function buildSharePayload(routine, exercisesById) {
  return {
    f: SHARE_FORMAT,
    v: SHARE_VERSION,
    n: routine.name,
    d: routine.note || undefined,
    e: [...routine.exercises]
      .sort((a, b) => a.position - b.position)
      .map((planned) => {
        const exercise = exercisesById.get?.(planned.exerciseId) || null;
        const entry = {
          i: planned.exerciseId,
          s: planned.targetSets,
          l: planned.repsLow,
          h: planned.repsHigh,
        };
        if (planned.restSec) entry.r = planned.restSec;
        if (planned.note) entry.o = planned.note;
        entry.x = {
          n: exercise?.name || planned.exerciseId,
          m: exercise?.muscleGroup || 'Other',
          q: exercise?.equipment || 'Other',
          ...(exercise?.isBodyweight ? { b: 1 } : {}),
        };
        return entry;
      }),
  };
}

export function encodeShare(payload) {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShare(code) {
  let text;
  try {
    text = fromBase64Url(String(code || '').trim());
  } catch {
    throw new Error('That share link is damaged — it may have been cut short.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That share link is damaged — it may have been cut short.');
  }
}

export function shareUrl(code, base = '') {
  return `${base}#/import/${code}`;
}

// --- validating -------------------------------------------------------------

export function validateSharePayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['Not a share link'] };
  if (payload.f !== SHARE_FORMAT) return { ok: false, errors: ['That link is not a Gym Log split'] };
  if (!Number.isInteger(payload.v) || payload.v < 1) return { ok: false, errors: ['That split has no usable version'] };
  if (payload.v > SHARE_VERSION) {
    return { ok: false, errors: [`That split came from a newer version of the app (v${payload.v}). Update first.`] };
  }

  const errors = [];
  if (!payload.n || typeof payload.n !== 'string') errors.push('The split has no name');
  if (!Array.isArray(payload.e)) return { ok: false, errors: [...errors, 'The split has no exercise list'] };
  if (!payload.e.length) errors.push('The split has no exercises in it');

  for (const [i, entry] of payload.e.entries()) {
    const where = `exercise ${i + 1}`;
    if (!entry || typeof entry !== 'object') { errors.push(`${where} is malformed`); continue; }
    if (!entry.i) errors.push(`${where} has no id`);
    if (!entry.x?.n) errors.push(`${where} has no name`);
  }

  return { ok: errors.length === 0, errors };
}

// --- matching up with the receiver's library --------------------------------

// Ignore case, spacing and punctuation. "Incline DB Press" and
// "incline db press" are the same lift; treating them as different would give
// the receiver a duplicate exercise with none of their history attached.
export function normaliseName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Works out, without touching the database, what importing would do:
// which exercises the receiver already has, which match one of theirs by name,
// and which are genuinely new. `locals` is their exercise list.
export function planImport(payload, locals = []) {
  const byId = new Map(locals.map((e) => [e.id, e]));
  const byName = new Map(locals.map((e) => [normaliseName(e.name), e]));

  const items = (payload.e || []).map((entry) => {
    const definition = {
      id: entry.i,
      name: entry.x?.n || entry.i,
      muscleGroup: entry.x?.m || 'Other',
      equipment: entry.x?.q || 'Other',
      isBodyweight: Boolean(entry.x?.b),
    };

    const existing = byId.get(entry.i);
    // Falling back to the name is what links a shared split to history the
    // receiver already has under a differently-generated id.
    const matched = existing || byName.get(normaliseName(definition.name)) || null;

    return {
      definition,
      resolved: matched,
      action: existing ? 'existing' : matched ? 'matched' : 'create',
      targetSets: Number(entry.s) || 3,
      repsLow: Number(entry.l) || 8,
      repsHigh: Number(entry.h) || Number(entry.l) || 12,
      restSec: entry.r ? Number(entry.r) : null,
      note: entry.o || '',
    };
  });

  return {
    name: payload.n || 'Shared split',
    note: payload.d || '',
    items,
    knownCount: items.filter((i) => i.resolved).length,
    newCount: items.filter((i) => !i.resolved).length,
  };
}

// A shared "Push" landing next to your own "Push" with no way to tell them
// apart is a bad afternoon. Suffix until the name is free.
export function uniqueRoutineName(name, existingNames = []) {
  const taken = new Set(existingNames.map((n) => String(n).trim().toLowerCase()));
  if (!taken.has(String(name).trim().toLowerCase())) return name;
  const shared = `${name} (shared)`;
  if (!taken.has(shared.toLowerCase())) return shared;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${name} (shared ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} (shared)`;
}

// The routine to save, once any missing exercises have been created and their
// real ids handed back in `createdIds` (definition id -> local id).
export function routineFromPlan(plan, createdIds = new Map(), existingNames = []) {
  return {
    name: uniqueRoutineName(plan.name, existingNames),
    note: plan.note,
    exercises: plan.items.map((item, index) => ({
      exerciseId: item.resolved?.id || createdIds.get(item.definition.id) || item.definition.id,
      targetSets: item.targetSets,
      repsLow: item.repsLow,
      repsHigh: item.repsHigh,
      restSec: item.restSec,
      note: item.note,
      position: index,
    })),
  };
}
