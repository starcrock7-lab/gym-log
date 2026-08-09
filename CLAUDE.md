# Gym Log — working notes

Personal workout tracker. Offline-first PWA, one user per device, no server, no
accounts. This repo is the whole app.

Read `README.md` for what the app does from a user's point of view, and `SPEC.md`
for what it was built to be; this file is about changing it safely.

**History note.** This app was built inside `starcrock7-lab/GYMGEAR-BACKEND5`
under `personal-gym/` and moved out on 2026-08-08, history intact, because it has
nothing to do with that Express API. Older commit messages mention that repo and
its rules (`server.js`, the price catalogue, the `claude/personal-gym-app-*`
branch) — none of that applies here any more.

---

## First: the rules that keep this repo working

1. **The repo is public. Never commit a secret.** No tokens, no keys, no workout
   data. The gist backup token lives in the user's browser only, never on disk
   here.
2. **Never add a runtime dependency.** See below — it would have to be vendored
   to survive offline, which is the whole point of the app.

Git email must be `starcrock7@gmail.com`.

## Verify after every change

```sh
npm test                                            # 92 tests, node --test
for f in $(find js test scripts -name '*.js'); do node --check "$f"; done
```

There is no build step and no bundler. Zero runtime dependencies — keep it that
way; a dependency here would have to be vendored to survive offline.

**After changing anything under `js/`, `css/` or `fonts/`, bump `CACHE` in
`sw.js`.** Installed phones are cache-first and will serve the old app forever
otherwise. This is the single most common way to ship a change that appears not
to work. Add new files to the `SHELL` list in `sw.js` too, or they 404 offline.

To see it: `npm run serve` (a plain static server on :8099 — the app needs no
build), then drive it in a browser. UI changes are not verified until they have
actually been run in one; several bugs in this app's history looked completely
fine in the source.

---

## Architecture

```
index.html            shell; loads js/app.js as a module
sw.js                 versioned cache-first service worker
css/app.css           the whole design system, one file
fonts/                Inter + Space Grotesk, self-hosted woff2
js/
  app.js              boot, hash router, wake lock
  dom.js              h() hyperscript, sheets, toasts, icons — the whole view layer
  db.js               IndexedDB plumbing. Decides nothing.
  schema.js           on-disk shapes, defaults, import validation   (pure, tested)
  store.js            all state in memory + every mutation
  calc.js             every number the app displays                 (pure, tested)
  crypto.js           backup encryption                             (pure, tested)
  share.js            split sharing: encode, decode, plan an import (pure, tested)
  backup.js           the ONLY network code in the app
  charts.js           hand-rolled inline SVG
  seed.js             ~100 exercises, 5 starter routines
  ui/                 one module per screen; setrow.js is shared
test/                 node --test
scripts/make-icons.mjs  regenerates icons (hand-rolled PNG writer, no deps)
```

**Everything loads into memory at boot.** `store.state` holds all exercises,
routines, workouts and body weights. A thousand workouts is nothing to hold in
RAM, and it means history, charts and personal records all read one consistent
snapshot. There is deliberately **no derived index** — deriving PRs into their
own store is the obvious optimisation and it is a trap, because it drifts the
moment a past session is edited.

**Pure logic is separated from effects on purpose.** `calc.js`, `schema.js`,
`share.js` and `crypto.js` touch no DOM, no database and no clock they aren't
handed. That is what makes them testable in Node without a browser, and it is
why the test suite can cover the parts that actually decide numbers. Keep new
logic on that side of the line.

---

## Invariants — break these and the app quietly lies

### Typing must never trigger a redraw

`mutateActive(fn)` persists silently. `mutateActive(fn, { redraw: true })`
redraws. Value edits (weight, reps) use the silent form and the row updates its
own DOM node.

This is not a performance choice. A redraw fired from an input's `change` event
lands *while focus is moving to whatever you tapped next* — it removes that
control before its click is dispatched, and the tap vanishes. The first version
of this app had exactly that bug: every tick button was dead, and the source
looked perfect. Deferring the redraw to `blur` instead is the same bug wearing a
hat.

If a change needs the screen rebuilt (add/remove a set, reorder, add an
exercise), pass `{ redraw: true }` — those come from button taps where losing
focus is expected.

### The active workout is persisted on every single change

`persistActive()` runs inside `mutateActive`. Killing the browser mid-set must
lose nothing. Do not batch or debounce this.

### Warm-ups are logged and then ignored

`isWorkingSet()` in `calc.js` is the gate: completed, and not a warm-up. Warm-ups
never reach volume, PRs, charts or the trend verdict. Drop sets and sets to
failure *do* count as working. If you add a set type, decide which side it is on
and add a test.

### PRs are recomputed, never incremented

`personalRecords()` walks the full history every call. Incrementing would be
faster and would leave stale records behind whenever a past session is edited or
deleted. There is a test for exactly that.

### The trend verdict refuses to guess

Fewer than two sessions in either 4-week window returns `insufficient`, not an
arrow. Estimates above 12 reps are `low` confidence and can never set a record or
move the verdict. A 20-rep set must not invent a 1RM.

### The timer stores an end timestamp

Not a countdown. Paused, it stores `remainingMs` and recomputes `endsAt` on
resume. This is why a paused timer survives a reload and an expired one does not.
Never tick a counter — a backgrounded tab throttles and the time goes wrong.

### Backup is a safety net, never a dependency

`backup.js` holds the only `fetch` in the app. It must stay off every logging
path. A gym session never waits on the network. Failures are recorded in
`state.backup.lastError` and surfaced in Settings — silence must never look like
a working backup.

### A shared split carries the plan, never the numbers

`share.js` encodes exercises, set counts, rep ranges and rest. The receiver's own
weights come from their own history via the normal ghost-text path. Importing is
**purely additive**: it can create exercises and one routine, and can never touch
history or settings. Exercises are matched by id, then by normalised name — the
name fallback is what attaches a shared split to history the receiver already has
under a differently-generated id. There is a test for that; don't remove it.

### `personal-gym` is a frozen name, not a stale one

`DB_NAME = 'personal-gym'` and `EXPORT_FORMAT = 'personal-gym-export'` in
`schema.js` are the old folder's name, and they stay that way. They are not
paths — they identify a user's data. Renaming `DB_NAME` points the app at a
fresh, empty IndexedDB and every logged session vanishes from view; renaming
`EXPORT_FORMAT` makes `validateExport` reject every backup file written before
the change. Tidying these up is the one "obvious cleanup" here that destroys
data.

---

## Design system

`css/app.css` is a port of the real thing from `starcrock7-lab/gymgear-frontend5`
(`src/app/globals.css` plus its components), with the accent ramp rotated from
orange to blue. Tokens carried over verbatim: `--off` / `--card` navy surfaces,
`--ink` / `--ink-2`, `--line` at 12% white, `--win: #2fbf62`, the 54px grid
overlay, the `0.62rem` uppercase micro-label at `0.2em` tracking, and generous
radii (8/12/16/22px — the site uses `rounded-lg`/`xl`/`2xl`, not tight corners).

Where this app deliberately departs from the site, and why — don't "restore"
these without re-measuring:

- **`--accent-lift` (#4d9bff) is the colour of accent *text*.** Plain `--accent`
  on navy measures 4.40:1, which fails AA at the sizes these labels run
  (pills, active tab, range tabs, links, drop-set markers). Borders, fills and
  glows still use `--accent`, where contrast doesn't apply.
- **`--ink-3` is #7d89a6, lifted from the site's #667192**, which measured
  3.89:1 against this app's raised navy while colouring 0.62rem micro-labels.
- **The accent is a two-tone gradient** (`--accent-grad`) on primary buttons,
  stat ticks and the wordmark — matching the launch video, which never uses a
  flat accent fill.
- **Blue is the data colour; green means "done".** The training heatmap is
  accent, not `--win`. A wall of green reads as a status, not a record.
- **Atmosphere lives in `body::after`**: an accent bloom plus static SVG light
  streaks from the video, masked out well above the first list. It is not
  animated — it sits under a screen you read between sets.

Verify contrast and tap targets by measuring, not by looking: drive the app and
check computed colours. Screenshots will not tell you a label is at 3.9:1.

Fonts are self-hosted so the app keeps its typography offline. Do not switch to a
CDN.

If you need to check something against the real site, clone it —
`git clone --depth 1 https://github.com/starcrock7-lab/gymgear-frontend5` — rather
than guessing. gymgearcompare.com itself is blocked by the sandbox's egress proxy.

Everything tappable is at least 44px. Number fields carry `inputmode` so phones
show a numeric keypad. Nothing may shift under a thumb mid-set.

---

## Gotchas worth knowing before you hit them

- **GitHub Pages serves this repo from `main`, at its root.** The live URL is
  `https://starcrock7-lab.github.io/gym-log/`. `.nojekyll` at the repo root stops
  Pages running the files through Jekyll — keep it.
- **Nothing in the app hardcodes that URL, and it must stay that way.** The
  manifest uses `start_url`/`scope` of `./`, `sw.js` registers as `'sw.js'`, and
  every `SHELL` entry is relative. That is why moving repos cost nothing; an
  absolute `/gym-log/...` path anywhere would break both the old installs and
  any future move.
- **Anyone who installed the old `/GYMGEAR-BACKEND5/personal-gym/` URL is on a
  different origin path**, so their service worker, IndexedDB and history stay
  there. Moving them over means exporting a backup from the old install and
  importing it into the new one — the data does not follow the move by itself.
- **iOS has no Fullscreen API.** The fullscreen timer is an overlay; the native
  call is a bonus on Android and desktop. Don't rely on it.
- **On iOS, deleting the home-screen icon deletes the database.** That is why
  backup exists and why it nags.
- **`node --test` needs the glob**, not the directory: `node --test test/*.test.js`.
- **A 90-second preset is `1:30`, not `1.5:30`.** Format durations through the
  shared helper; naive `seconds/60` has bitten this file before.
- **Finishing a workout is what creates the "last time" numbers.**
  `lastPerformanceSession` walks `finishedWorkouts()`, so a session that is never
  finished never becomes the prefill or the ghost text on the next one. That made
  a missing Finish affordance look exactly like a broken history feature — keep
  finishing obvious, and don't let Discard be the only action at the foot of the
  workout screen.
- **`platesFor` is allowed to say no.** 192.5 lb on a 45 lb bar needs 1.25s. It
  reports the shortfall rather than rounding. Don't "fix" that.

## Testing conventions

Tests are named as sentences describing the behaviour a user would notice
("warm-ups never set a personal record"), not the function under test. Prefer a
test that would have caught a real bug over one that restates the implementation.
The suite currently covers 1RM, volume, PRs, the trend verdict, plate maths,
import validation, backup encryption, share encoding and import planning.

UI has no automated tests. Drive it in a browser and say plainly what you
actually observed.
