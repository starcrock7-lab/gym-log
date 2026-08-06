# Gym Log

A personal workout tracker. One user, no accounts, no server, no signal needed.
Strong-style logging: every set row shows what you did last session, so the number to beat
is on screen before you lift.

Lives entirely in this folder. It has nothing to do with the `gymgearcompare.com` API in
`server.js` and never touches it.

---

## Put it on your phone

The app is static files, so it needs to be served over **HTTPS** — service workers refuse
to run otherwise, and without one there is no offline mode.

**GitHub Pages** is the least effort, since this repo is already public:

1. Open <https://github.com/starcrock7-lab/GYMGEAR-BACKEND5/settings/pages>.
   This is the **repository's** settings, not your account's — account settings has no
   Pages section and GitHub redirects you to the docs, which is the usual wrong turn.
2. Source **Deploy from a branch**, branch **whichever branch holds this folder**, folder
   **`/ (root)`**, then Save. Picking `main` before the app is merged there gives a 404.
3. Wait a minute or two, then open
   <https://starcrock7-lab.github.io/GYMGEAR-BACKEND5/personal-gym/> on your phone.
4. **iPhone:** Safari → Share → *Add to Home Screen*.
   **Android:** Chrome → menu → *Install app*.

`.nojekyll` at the repo root stops Pages running the files through Jekyll before serving
them. Deleting it will eventually break something in a way that is annoying to diagnose.

It now launches fullscreen from your home screen, with no browser chrome, and works in
airplane mode.

Vercel, Netlify or any other static host works the same way — point it at `personal-gym/`.

## Run it locally

```sh
npx serve personal-gym      # or: python3 -m http.server 8099 --directory personal-gym
```

`localhost` counts as a secure origin, so the service worker works there too.

## Tests

```sh
node --test personal-gym/test/*.test.js
```

Covers everything that decides a number: 1RM estimates, volume, personal records, the
trend verdict, plate maths, import validation, and backup encryption. There is no UI test
suite — the browser walkthrough is manual.

After changing anything under `js/`, bump `CACHE` in `sw.js`. Otherwise installed phones
keep serving the old version forever.

---

## How it works

- **Storage** is IndexedDB, read into memory once at boot. Roughly a thousand workouts is
  nothing to hold in RAM, and it means history, charts and records all read from one
  consistent snapshot instead of a derived index that can drift.
- **The active workout is written on every change.** Close the tab, lose the browser, let
  the phone die — reopening lands you exactly where you were.
- **Typing never triggers a redraw.** A redraw fired from an input's change event lands
  while focus is moving to whatever you tapped next, destroying that control before its
  click is dispatched. The tap vanishes. Value edits persist silently and the row updates
  its own node; only structural changes redraw.
- **The rest timer stores an end timestamp**, not a countdown, so locking the phone
  mid-set cannot desynchronise it.

### The numbers

All of it lives in `js/calc.js` as pure functions, and all of it is tested.

- **Warm-ups are logged and then ignored** — excluded from volume, PRs, charts and the
  trend verdict. Drop sets and sets to failure count as working.
- **Estimated 1RM** is Epley, `weight × (1 + reps / 30)`. Past 12 reps it is marked
  low-confidence and can never set a record, so a 20-rep set cannot invent a max.
- **PRs are recomputed from the full history** every time rather than incremented, so
  deleting or editing a past session correctly withdraws the record it held.
- **The trend verdict** compares your best confident 1RM estimate over 28 days against the
  28 before it. Under ±2% is flat. Fewer than two sessions in either window returns
  *"not enough data yet"* rather than an arrow drawn from one point.
- **Bodyweight lifts** log *added* weight; true load adds the body weight recorded that day.
- **The plate calculator** says when a weight cannot be made and by how much, instead of
  quietly rounding. 192.5 lb on a 45 lb bar needs 1.25s, and it will tell you so.

---

## Backing up

**Your history exists on this phone and nowhere else.** On iOS, deleting the home screen
icon deletes the database with it — there is no iCloud copy and no undo.

Two ways to have a second copy:

**Automatic, to a private gist.** Settings → Backup. Paste a GitHub token with the `gist`
scope and nothing else, set a passphrase, and the app encrypts a copy (AES-GCM, key derived
with PBKDF2-SHA256) into one secret gist after every workout. Secret gists are visible only
to you. The token is stored on the device and is never committed, logged, or put in a URL —
and never included in an export.

> A lost passphrase is unrecoverable. Write it down when you set it up.

**Manual, to a file.** Settings → Export. Drop the JSON in iCloud Drive or email it to
yourself. Import replaces everything, and refuses a malformed file whole rather than
half-loading it over a working history.

Installed web apps are exempt from Safari's 7-day storage eviction, so a quiet week costs
you nothing. Storage can still be purged under severe device-storage pressure.

## Privacy

The code is public; the data is not. Everything is written to IndexedDB on your device.
The only network request the app ever makes is the backup upload to `api.github.com`, in
`js/backup.js` — it is absent from every logging path, and turning backup off removes it
entirely.

## Layout

```
index.html              app shell
manifest.webmanifest    installable PWA metadata
sw.js                   versioned cache-first service worker
css/app.css
js/
  app.js                boot, hash router, rest timer, wake lock
  db.js                 IndexedDB plumbing — decides nothing
  schema.js             on-disk shape, import validation      (tested)
  store.js              in-memory state and every mutation
  seed.js               ~100 exercises and 5 starter routines
  calc.js               all the maths                          (tested)
  crypto.js             backup encryption                      (tested)
  backup.js             the only network code
  charts.js             hand-rolled inline SVG
  ui/                   one module per screen
scripts/make-icons.mjs  regenerates the app icons
test/                   node --test
```
