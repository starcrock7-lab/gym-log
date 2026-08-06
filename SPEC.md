# Personal Gym Log — spec & build plan

A single-user workout tracker, Strong-style, offline-first, living in `personal-gym/`.
Completely separate from the `gymgearcompare.com` API. **`server.js` is never touched.**

---

## 0. The prompt

> Build me a personal workout tracker as a self-contained, offline-first web app in
> `personal-gym/`. It is for one person — me — so there are no accounts, no login, no
> server, and no network calls of any kind. I install it to my phone's home screen and it
> works in a basement gym with no signal.
>
> Copy the **Strong** app's logging flow, because it is the one that answers the question I
> actually care about: *am I lifting more than last time?* Every set row shows what I did
> for that same set last session as grey ghost text, so the number to beat is always on
> screen before I lift.
>
> The core loop is: pick a routine (or start empty) → the workout screen opens with my
> exercises and last session's numbers pre-filled → I type weight and reps and tick each
> set → ticking a set auto-starts the rest timer → I finish, and the session is saved
> forever.
>
> On top of the log, I need honest progress readouts per exercise: heaviest set, best
> estimated 1RM, best working-set volume, a weight-over-time chart, and a plain-English
> verdict — *up 4% / flat / down 3% vs. the previous four weeks*. Warm-up sets must never
> count toward PRs, volume, or charts.
>
> Also: reusable routine templates, a searchable exercise library I can add my own
> exercises to, body-weight logging with its own chart, and a barbell plate calculator.
>
> Units are **pounds**. Weights go in 2.5 lb steps, reps are whole numbers.
>
> Non-negotiables: an in-progress workout survives the phone dying, the tab closing, or
> the browser evicting the page — it is persisted on every keystroke and resumes exactly
> where I left off. All data is exportable to a JSON file and importable back, because the
> browser is the only copy. Nothing about my training ever leaves the device.
>
> Build it with zero runtime dependencies and no build step: plain ES modules, IndexedDB,
> a service worker for offline. Every calculation — 1RM, volume, PR detection, trend
> verdict, plate math, schema migration — is a pure function with unit tests under
> `node --test`. I want it organised, fast to use one-handed mid-set, and correct.

---

## 1. Decisions already locked

| Decision | Choice | Why |
|---|---|---|
| Data location | On-device only (IndexedDB) | No signal needed in the gym; no server to sleep, break, or leak |
| Model app | Strong | Ghost text of last session is the single best "am I progressing" affordance |
| Units | **lb**, stored canonically as a number | 2.5 lb increments; bar 45 lb; plates 45/35/25/10/5/2.5 |
| Stack | Vanilla ES modules, IndexedDB, service worker. **Zero npm deps, no bundler** | Repo currently has one dependency (express). Nothing to break, nothing to audit, deployable as static files anywhere |
| Charts | Hand-rolled inline SVG | A line chart and a bar chart do not justify a 200 KB library |
| Tests | `node --test` (built into Node 22) | Zero deps; this repo has no test suite today, so the calculation layer gets the first one |
| Location | `personal-gym/` | Zero coupling to `server.js`; the production API is untouched |

**Privacy note.** The repo is public, so the *code* is public. The *data* never is — it is
written only to IndexedDB on your device and to JSON files you explicitly export. There is
no fetch/XHR/WebSocket anywhere in the app, and that is enforceable by grep.

---

## 2. Data model

Stored in IndexedDB, database `personal-gym`, with `meta.schemaVersion` driving migrations.

```
exercises        id, name, muscleGroup, equipment, isCustom, defaultRestSec, notes, archived
routines         id, name, notes, position, exercises[]
                   exercises[]: { exerciseId, targetSets, repsLow, repsHigh, restSec,
                                  note, supersetGroup? }
workouts         id, startedAt, finishedAt, routineId?, name, note, entries[]
                   entries[]:  { exerciseId, position, note, sets[] }
                   sets[]:     { weightLb, reps, type, rpe?, done, doneAt }
                                 type: 'working' | 'warmup' | 'drop' | 'failure'
bodyWeights      date (PK), weightLb, note
settings         singleton: defaultRestSec, barWeightLb, plates[], vibrate, sound,
                            firstDayOfWeek, lastExportAt
activeWorkout    singleton: the in-progress session, rewritten on every mutation
meta             singleton: schemaVersion
```

**Deliberately denormalised.** Sets live inside their workout, so a session is one read and
one write. Per-exercise history is built by indexing all workouts in memory at startup —
five years of training at 4 sessions/week is ~1,000 workouts and ~35,000 sets, which is
nothing in RAM and removes an entire class of derived-index-drift bugs.

**Weight is stored as a number in pounds, never a display string.** Rendering formats it;
storage never sees `"185 lb"`.

---

## 3. The calculations, pinned down

These are the parts that quietly go wrong in real apps, so they are specified rather than
left to taste, and each one gets a test.

- **Working sets only.** Warm-up, and any set with `done !== true`, are excluded from
  volume, PRs, charts, and the trend verdict. Drop sets count as working.
- **Estimated 1RM** — Epley: `weight × (1 + reps / 30)`; exactly `weight` at 1 rep. Above 12
  reps the estimate is shown greyed and marked low-confidence rather than hidden, so a
  20-rep set does not silently invent a PR.
- **Volume** = `Σ(weight × reps)` across working sets. Session volume, per-exercise volume.
- **PRs**, recomputed from full history on demand (never incremented, so they cannot drift):
  heaviest weight · best estimated 1RM · best single-set volume · best reps at each weight.
- **Trend verdict** — best e1RM in the last 28 days vs. the 28 days before that.
  `≥ +2%` → **up**, `≤ −2%` → **down**, otherwise **flat**. Fewer than 2 sessions in either
  window → *"not enough data yet"*, never a fabricated arrow.
- **Body-weight exercises**: the logged number is *added* weight; total load uses your most
  recent body weight, and the UI says which it is showing.
- **Plate calculator**: `(target − barWeight) / 2` per side, greedy over your plate list,
  and it states the exact remainder when a target is unreachable instead of rounding
  silently.

---

## 4. Screens

1. **Home** — resume banner if a workout is in progress, "Start empty workout", routine
   cards, last 3 sessions, current streak.
2. **Active workout** — the screen that matters. Sticky header: elapsed time, Finish.
   One card per exercise; each set row is
   `[#] [ghost: 185 × 8] [weight] [reps] [✓]`.
   Ticking ✓ marks the set done and auto-starts rest. Add/remove set, add exercise
   mid-workout, reorder, per-exercise note, warm-up toggle, plate calculator from the weight
   field. Rest timer is a bottom sheet with −15s / +15s / skip, driven by wall-clock
   timestamps (not tick-counting), so it stays accurate when the phone sleeps.
3. **History** — reverse-chronological sessions, month heatmap, tap through to a full,
   editable session detail.
4. **Exercise detail** — trend verdict at the top, PR cards, e1RM/top-set chart with 30d /
   90d / 1y / all ranges, then every set ever performed.
5. **Routines** — create/edit/reorder templates; "save this workout as a routine" from any
   finished session.
6. **Body weight** — log and chart.
7. **Settings** — rest defaults, bar and plate inventory, **Export JSON** / **Import JSON**,
   wipe-all behind a typed confirmation. A gentle nag appears if the last export is older
   than 30 days, because the browser is the only copy.

Design: dark-first, thumb-reachable bottom nav, inputs at least 44 px tall, numeric keypads
on number fields, no layout shift when the keyboard opens.

---

## 5. Files

```
personal-gym/
  index.html            app shell
  manifest.webmanifest  installable PWA
  sw.js                 versioned cache-first service worker
  css/app.css
  js/
    app.js              boot + hash router
    db.js               IndexedDB wrapper + migrations
    store.js            state, mutations, persistence of activeWorkout
    seed.js             ~120 seeded exercises
    calc.js             1RM, volume, PRs, trend, plate math  ← pure, fully tested
    charts.js           inline SVG line/bar
    ui/                 home, workout, history, exercise, routines, bodyweight, settings
  test/
    calc.test.js  db-migrations.test.js  export-import.test.js
  README.md             how to run, install to phone, back up
```

## 6. Phases

| Phase | Ships | Proof it works |
|---|---|---|
| 1 | `db.js`, `calc.js`, `seed.js`, tests | `node --test personal-gym/test` green |
| 2 | Shell, router, exercise library, routine editor | Create a routine, reload, it is still there |
| 3 | **Active workout**: ghost text, set rows, rest timer, crash-safe resume | Log a session, kill the tab mid-set, reopen — same state |
| 4 | History, session detail + editing | Edit a past set, PRs recompute correctly |
| 5 | Exercise detail: charts, PRs, trend verdict | Seeded 6-month fixture produces the right up/flat/down calls |
| 6 | Body weight, plate calculator, warm-up handling | Warm-ups provably absent from PRs and volume |
| 7 | PWA: manifest, service worker, offline | Airplane mode, cold start, full session logged |
| 8 | Export/import, backup nag, README | Export → wipe → import → byte-identical state |

## 7. Definition of done

- `node --test personal-gym/test` passes; `node --check` passes on every JS file.
- A full session can be logged start to finish in airplane mode.
- Killing the browser mid-workout loses nothing.
- Export → wipe → import restores the database exactly.
- Warm-up sets appear in history and nowhere else.
- `grep -rE "fetch\(|XMLHttpRequest|WebSocket" personal-gym/js` returns nothing.
- `server.js` and the production API are byte-for-byte unchanged.

## 8. Deployment

Static files — no build. Three ways to get it on the phone, cheapest first:

1. **GitHub Pages** on this repo (`/personal-gym`) — free, HTTPS, installable. HTTPS matters:
   service workers refuse to run without it.
2. Any static host (Vercel/Netlify), same folder.
3. `npx serve personal-gym` on the laptop for development.

Not served by `server.js`. The API keeps its own job.
