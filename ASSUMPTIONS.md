# Assumptions & Decisions

Running log of calls made during the build where the README didn't specify,
per §1. Each entry says what was decided and why, so it can be revisited.

---

## Day 1

### A1 — Repo has no GitHub remote
The GitHub CLI (`gh`) is **not installed** on this machine, so no GitHub repo
was created and nothing was pushed. The local git repo is initialised and
committed on `main`.

**To connect a remote manually:**
```bash
git remote add origin https://github.com/<you>/Wayword.git
git push -u origin main
npm run deploy        # publishes to the gh-pages branch
```
Then enable GitHub Pages once: *Settings → Pages → Source: Deploy from a
branch → `gh-pages` / (root)*.

`npm run deploy` already detects the missing remote and prints these steps
rather than failing obscurely.

### A2 — Audio generated via Google Translate TTS, not gTTS/eSpeak
README §3-audio left the TTS choice open ("Claude Code's call"). Python on
this machine is the Microsoft Store stub, not a real interpreter, so `gTTS`
was not available; eSpeak-NG is not installed either. Node 22 is present, so
`tools/generate-audio.mjs` calls the same public Google Translate TTS
endpoint that gTTS wraps, directly via `fetch`. Zero dependencies to install.

The vendor decision is isolated in a single function (`synthesise()`), so
swapping to eSpeak-NG, a paid API, or real native-speaker recordings (Phase 2,
§9) touches one function and no app code.

### A3 — Synthesis is driven from kana, not kanji
Each phrase carries an `audioHint` field holding the kana reading, and the
generator prefers it over the kanji `japanese` field. Synthesisers routinely
mis-read kanji with multiple readings (七時 as *nanaji* rather than *shichiji*),
and this made the output measurably more accurate. `audioHint` is the
"audio-hint" field named in §3a, given a concrete job.

### A4 — Furigana stored as segments, not a parallel string
§3a lists `furigana` as a field but not its shape. It's stored as an array of
`{ b: base, r: reading }` segments so a reading attaches to the specific kanji
run rather than the whole phrase — `[{b:"電車",r:"でんしゃ"},{b:"は"}]`. This is
what makes correct `<ruby>` rendering possible, and the self-test asserts that
concatenating the segments reproduces the `japanese` field exactly.

### A5 — Placement quiz pulls 20 cards, 2 per category
§6a says "~15-20 sample cards spread across all 10 categories". 2 per category
× 10 = 20, at the top of that range but exactly even in coverage. The two picks
per category are deliberately the **easiest and the hardest** available card:
anime-derived knowledge is lopsided, and sampling both ends is what exposes the
lopsidedness rather than just measuring an average.

### A6 — Categories 5-10 seeded on Day 1, not Day 2
The Day 2 checklist puts categories 5-10 in Day 2, but §6a requires the
placement quiz — a Day 1 item — to span **all ten** categories. Those two
can't both hold with six empty files. Resolution: 4 phrases each were written
for categories 5-10 on Day 1 (enough for the quiz to sample from), and Day 2
expands them to full thin coverage. Day 1's audio pass therefore covered 112
phrases rather than only categories 1-4's 88.

### A7 — Three-way self-grading, but only "known" skips ahead
§6a describes "known" vs "recognised but wouldn't produce" vs unknown. The quiz
offers all three, but per the spec's explicit wording only **"I know this"**
seeds the card forward (6 days); "recognise" and "new" both start at the normal
first interval. The "recognise" answer still counts as 0.5 toward the category
score, so it influences *sibling* cards even though it doesn't advance its own.

### A8 — Placement results also seed unsampled cards
§6a only describes what happens to the sampled cards. Extending that: a
category whose placement score is ≥0.75 gets its easy (difficulty ≤2) cards
seeded at a 4-day interval when the category is activated, and ≥0.5 seeds
difficulty-1 cards at 2 days. Without this, answering "I know this" to two
greetings cards would still leave you grinding all 22 remaining greetings from
zero — which is the exact waste §6a exists to prevent. Tunable in
`js/deck.js → activateCategory()`.

### A9 — Week-1 rollout enforced, later categories opt-in
§7 says don't front-load all 10 categories. On finishing the quiz, only the
four week-1 categories are activated. The rest are visible and readable in
Browse from the start, but only enter the review queue when explicitly added.
Cards for unrolled categories that the quiz happened to sample are stored but
excluded from the queue until their category is activated.

### A10 — Failed cards return within the same session
SM-2 proper just reschedules a lapsed card. Here a lapse sets a 10-minute
learning step *and* the card is pushed to the back of the current session
queue, so it's seen again before you close the app. This is standard Anki-style
behaviour and materially improves same-day retention.

### A11 — Icons generated, not designed
`tools/make-icons.mjs` writes the PWA PNGs from raw RGBA scanlines via
`zlib` — a torii drawn with rectangles. No image library, no binary assets
committed that can't be regenerated. Fine for a launcher icon; replace with
real artwork any time by dropping PNGs into `icons/`.

### A12 — Dark-first single stylesheet
Not specified anywhere. One CSS file, dark by default with a
`prefers-color-scheme: light` override, sized for a phone held one-handed.
Text-size slider in Settings drives a `--text-scale` custom property, which
covers the §8 accessibility requirement alongside the furigana/romaji toggles.

### A13 — Romaji auto-retires after week 1
§6 says romaji should be "off by default after week 1". Rather than silently
changing behaviour, the app flips the default once, 7 days after first launch,
and shows a toast explaining it. It can be turned straight back on in Settings
and won't auto-flip again.
---

## Day 2

### A14 — Scenario trees are branching, with a "best" path
§2 asks for branching dialogue trees and §3a requires them to reference phrase
IDs rather than duplicate text. Each node holds an NPC line plus 2-3 player
options; options carry an optional `phraseId` that links back into the category
content, and a `quality` marker (`good` / `awkward` / `wrong`). Picking an
awkward option doesn't dead-end the scenario — it continues and explains what
landed oddly, since the register mismatch *is* the lesson (§6).

Scenario NPC lines are content in their own right and are not all present in
the category files, so they carry their own inline text. Only **player** lines
reference phrase IDs. The self-test verifies every `phraseId` resolves and
every `next` target exists.

### A15 — Scenario audio reuses phrase clips
Player options that reference a phrase ID play that phrase's existing bundled
clip. NPC lines got their own generated clips under `audio/ja/scenario/`, so a
scenario can be listened through end to end.

### A16 — "Due today" home screen ordering
The home screen shows due cards first, then new ones capped by the
new-cards-per-day setting (default 10). Due cards are ordered by how overdue
they are, not by category, so nothing is starved. Categories can still be
studied individually from Browse, which ignores the daily cap — deliberate, so
cramming a specific category before you need it is possible.

### A17 — No analytics, no network calls at runtime
§8 says no data leaves the device. There is no telemetry, no CDN, no external
font, and no runtime fetch to any origin other than the app's own. The only
network access in the whole project is the build-time audio script, which runs
on your machine and not the user's.

### A18 — jsdom is a test-only, non-installed dependency
`tools/render-test.mjs` renders every screen in a real DOM and asserts the
output. It needs jsdom, but the app itself has **zero dependencies** and that
was worth keeping — so jsdom is not in `package.json`. Install it only when you
want to run that suite:

```bash
npm install --no-save jsdom
npm run test:render
```

The script exits 0 with a note if jsdom isn't present, so it never breaks a
clean checkout.

### A19 — Scenario choices nudge the SRS, they don't grade it
Picking a phrase inside a scenario updates its `lastReview` but does not
advance its interval. Choosing from a list of three is much weaker evidence of
recall than producing an answer to a flashcard, so treating it as a real
review would inflate intervals and quietly damage retention. Flashcards remain
the only thing that moves the schedule.

---

## Characters section

### A20 — Character content reuses the phrase schema verbatim
Kana and kanji entries carry `japanese`, `furigana`, `romaji` and `english`
alongside their own `character` / `readings` / `group` fields. That is not
redundancy — it means the existing flashcard session, the `<ruby>` furigana
renderer, the furigana/romaji toggles and the audio button all render a
character with **zero branching**. `runSession()` was not modified at all to
support character review.

The only synthesised field is a display `english` for kana, which genuinely
has no meaning to show: the JSON keeps `english: null` (per the brief — English
meaning is kanji-only) and the loader substitutes `reads “a”` at read time.
The original value stays available as `meaning`.

### A21 — Separate deck implemented as a `kind` tag, not a second store
Cards carry `kind: 'phrase' | 'character'`. One IndexedDB store, one SM-2
scheduler, two queues — `deck.queue()` and `deck.characterQueue()` filter on
it, as do `deckSummary()` and `characterSummary()`. `kind` defaults to
`'phrase'` everywhere it is read, so SRS records written before this section
existed keep working untouched.

Daily stats gained `charReviews` / `charAgain` next to `reviews` / `again`, so
the "done today" figure on the home screen stays a *phrase* figure. Forty kana
drills should not make it look like the phrase reviews are done. The streak
counts either kind — studying is studying.

### A22 — Character sets are opt-in, with their own daily cap
Adding hiragana introduces 104 cards at once. Auto-activating that at placement
would swamp week 1 and directly contradict §7's "don't front-load". So character
sets are added from the Characters screen exactly like categories 5-10 are added
from Browse. Placement still samples and scores them, and those results seed the
set forward when it *is* added.

New characters have their own cap (`newCharsPerDay`, default 15, separate from
the phrase `newPerDay` of 10) because a kana card takes about two seconds and a
phrase card takes about ten.

### A23 — New cards are introduced easiest-first
`buildQueue` now orders new cards by `difficulty` before `introduced`, and cards
store their content difficulty. This exists for kana: the 46 base characters
have to arrive before the yōon combinations built out of them, and all 104 are
introduced on the same timestamp so `introduced` alone could not order them.
Phrases benefit incidentally.

### A24 — Handwriting and stroke order deliberately deferred, not forgotten
No stroke-order diagrams, no animations, no handwriting or drawing practice.
Explicitly out of scope for this pass.

Beyond the instruction, it is also the right call for this app: the goal is
reading signs, menus and tickets on a 28-day trip, and recognition is what
serves that. Handwriting is a much larger investment that pays off over months.
If it is ever added, the natural shape is a `strokes` field on the existing
character schema plus a new view — no change to the SRS or deck layer.

A note to this effect is shown at the bottom of the Characters screen so it
reads as a deliberate scope decision rather than an oversight.

### A25 — Kana content is generated; kanji is hand-curated
`tools/make-kana.mjs` generates both kana files from a compact table. Writing
220 near-identical JSON entries by hand invites typos no test would catch — a
wrong romaji on ぬ still validates as JSON. The romaji convention (Hepburn:
shi/chi/tsu/fu/ji, matching Japanese road signage) is stated once in that table.

Kanji is hand-written because the selection, the meanings and the traveller
notes are judgement calls, not derivable from a rule. Note that ぢ/づ and
ヂ/ディ collide under Hepburn, so machine-facing ids are disambiguated
(`hira-di`, `kata-ext-di`) while the displayed romaji stays honest.

### A26 — Kanji set includes multi-character compounds
Strictly, 出口 is two kanji, not one. But a traveller reads 出口, 非常口 and
両替 as units off a sign, and splitting them into single characters would make
the set less useful for its actual purpose. The set therefore contains 82
entries mixing single kanji (円, 駅, 右) with high-value signage compounds
(出口, 立入禁止, 営業中).

### A27 — Cross-references match exact written forms only
`tools/crossref-kanji.mjs` links each kanji to phrases containing it — 38 of 82
currently. An earlier version fell back to component matching when a compound
had no exact hit, which claimed 曜日 appeared in 日本語が少しわかります merely
because 日 does. That is a lie that sends the learner to a phrase not containing
the word, so the fallback was removed. The 44 unmatched entries are genuinely
signage-only (押, 引, 危険, 準備中) and are simply shown without cross-references.

Re-run `npm run crossref` after adding phrase content to refresh the links.

---

## Deployment & service worker verification

### A28 — GitHub Pages was not set up at the time of writing — RESOLVED, see A31
Re-checked on 2026-08-18: no git remote, no `gh-pages` branch, `gh` still not
installed, no `GITHUB_TOKEN`/`GH_TOKEN` in the environment. Pages was never
configured — this is unchanged from A1, not a regression.

It cannot be completed autonomously. Two of the three required steps need
authenticated access to the GitHub account:

1. **Create the remote repo** — needs `gh` or the web UI. Git alone cannot
   create a repository.
2. **Push** — Git Credential Manager is configured as the credential helper, so
   this step might succeed interactively, but it has nothing to push *to* until
   step 1 exists.
3. **Enable Pages** — a repository setting. Reachable only through the GitHub
   web UI or the REST API with a token. There is no git-only path to it.

Extracting a token from the credential store to do this unattended would mean
taking a stored secret and using it against an external service without being
asked to, so that was not attempted.

What *was* done instead: the deploy path is now verified end to end against a
local bare repository standing in for `origin` (nothing left the machine), so
`npm run deploy` is known to work the moment a real remote exists. See A30.

### A29 — Real bug found and fixed: service worker registration was skippable
`boot()` ended with:

```js
await router();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')…
```

Registration was the **last statement after several `await`s that can reject**.
`router()`'s try/catch does not cover the onboarding branch — it does
`return renderPlacement(...)` before the loop — so a content fetch failure
propagates out of `router()`, out of `boot()`, and registration never runs.

The failure mode is self-reinforcing and silent: a flaky or offline first load
means no service worker, which means no cache, which means the next load fails
the same way. Confirmed by booting the real app with content fetches rejecting —
`register()` was called 0 times.

Fixed by chaining registration off `.finally()` so it runs regardless of
boot's outcome, while still running *after* first paint so the ~7 MB precache
doesn't compete with initial render. A failed boot now also shows an error
screen instead of a blank page. `tools/sw-test.mjs` locks all of this in.

The `'serviceWorker' in navigator` guard was **kept** — it is required feature
detection, and removing it would throw instead of skipping. It now logs *why*
it skipped, because over plain `http://` on a LAN IP the API is absent
entirely and that is indistinguishable from an unsupported browser otherwise.
The caching logic in `sw.js` was reviewed and left alone; no bug was found in it.

### A30 — Real bug found and fixed: `npm run deploy` was broken
The deploy script created an orphan branch in a temporary worktree and then ran
`git checkout HEAD -- <files>`. On an orphan branch HEAD does not resolve to a
commit, so git aborts with `fatal: invalid reference: HEAD`. The first real
deploy would have failed.

The checkout was also unnecessary: `git worktree add --detach` has already
placed every tracked file on disk, and `--orphan` leaves the working tree
intact. The fix drops the checkout and instead deletes the paths that shouldn't
ship (`tools/`, `.gitignore`, `package.json`) before committing.

Verified by deploying to a local bare repo: 523 files on `gh-pages`, including
all 482 audio clips, all three character sets and `.nojekyll`, with tooling
correctly excluded. The resulting tree was then served and checked to load.

The script also used to write a stray untracked `.nojekyll` into the working
directory on every run; it now writes it only into the deploy worktree. The
existing root `.nojekyll` is kept and tracked, because it is also what makes
the simpler "serve from `main` / root" Pages option work.

### A31 — GitHub Pages is live (resolves A1 and A28)
**Site: https://shikomisen.github.io/Wayword/** — served from `main` / `root`.
(Published at `/Nihongo-Tabi/` until the rename — see *Rename to Wayword*.)

Enabled via `POST /repos/Shikomisen/Nihongo-Tabi/pages` (201; the repo's
pre-rename name), build completed,
and every path verified by actually fetching the live origin rather than
trusting the API response: `index.html`, `sw.js`, `app.webmanifest`,
`css/styles.css`, `js/app.js`, `js/characters.js`, all three character-set JSON
files, sample audio clips and an icon — 15/15 returned 200. The served content
parses to 10 categories, 3 character sets (104 / 116 / 82 with 38 kanji
cross-references) and 6 scenarios, and the deployed `js/app.js` contains the
A29 registration fix.

Two things blocked this for three attempts, both worth recording:

1. **Wrong identity.** Git Credential Manager's `git:https://github.com` entry
   was bound to `ShikoMDS`, which has `push` but not `admin` on the repo. Pages
   administration requires admin, and GitHub returns **404** (not 403) for
   permission failures on write endpoints, which reads like a missing route
   rather than a permissions problem. The `fork:...Shikomisen.oauth_token`
   entry visible in Credential Manager is Fork.app's own store and is not a
   namespace git reads.
2. **A public repo hides the auth step.** After the credential was cleared,
   `git fetch origin` succeeded anonymously — public repos need no auth to
   read — so GCM was never invoked and nothing was stored. Forcing the sign-in
   needs an operation that actually authenticates; a no-op `git push` does it
   safely when local and remote are identical.

`npm run deploy` and the `gh-pages` branch are therefore **not used** by this
setup. That script still works (verified in A30) and remains available if the
served site should ever be split from source, but serving `main` at root needs
no build step and no second branch, which suits a project with committed
build output.

---

## Rename to Wayword

### A32 — "Nihongo Tabi" → "Wayword", and what that covered
The app will grow beyond Japanese, so its name no longer names a language.
Renamed everywhere the name is shown or identifies the project: the page
`<title>`, `apple-mobile-web-app-title`, the `<noscript>` message, manifest
`name` and `short_name`, `package.json` `name` (`wayword`), the dev-server
banner, the console-log prefix (`[nihongo-tabi]` → `[wayword]`), the
stylesheet header, the README and this file.

- `short_name` is also `Wayword`: 7 characters, well inside the ~12 that iOS
  and Android launchers show under an icon before truncating.
- The description still says "survival-level conversational Japanese". That is
  what the app teaches today; changing it would be a content change.
- The only edit under `content/` is the `generatedFor` label in
  `manifest.json` (`"Wayword MVP"`). Nothing reads it. No phrase, scenario,
  kana, kanji or audio file changed.
- The torii icon is unchanged. It is Japan-specific, but redesigning it is
  beyond a rename; worth revisiting when a second language lands.
- Entries above that record what happened under the old name (the A31 API
  call) keep the old repo name, annotated as such.

### A33 — The GitHub repo was already renamed; only the remote changed
`gh` is still not installed (see A1), and the instruction for this task was
"use gh if authenticated, otherwise give click-through steps". The Git
Credential Manager route used in A31 was deliberately not reused for an admin
action that hadn't been authorised that way.

It turned out not to matter: pushing the rename commit to the old URL drew
GitHub's "repository moved" notice, and the API reports
`Shikomisen/Wayword`, so the repo had already been renamed by hand. `origin`
now points at `https://github.com/Shikomisen/Wayword.git`. (GitHub keeps
redirecting the old git URL, but not the old Pages URL — see A37.)

### A34 — Deploy path: everything was already relative, and stays that way
There is no build step and no router base: routing is hash-based
(`#/browse`), so the deploy path never reaches the router. Every
path-dependent value is relative and resolves under `/Wayword/` unchanged:
manifest `start_url` (`./index.html`), `scope` (`./`) and shortcut URLs;
`register('sw.js')`, and therefore the SW scope; the SW precache list (`./…`)
and its offline fallback (`./index.html`); every content and audio fetch.

They were deliberately **not** hard-coded to `/Wayword/`. That would break
`npm start`, which serves at `/`, and would need editing again on any future
move. No absolute `/Nihongo-Tabi/` path existed outside the docs, one code
comment and the `test:sw` fixture URL, all of which were updated.

### A35 — Cache renamed to `wayword-v4`; cleanup scoped to this app
`CACHE` went from `nihongo-tabi-v3` to `wayword-v4` (new prefix, version
bumped), so every client re-installs the full precache and drops the old one
on activation.

The activate handler used to delete *every* cache on the origin except its
own. `shikomisen.github.io` is a single origin shared by every project site on
the account, so that also wiped other apps' offline caches. It now deletes
only stale caches with this app's prefixes (`wayword-` and the legacy
`nihongo-tabi-`). The outcome for this app is identical; it just no longer
touches anything else.

### A36 — Storage keys deliberately keep the old name
The IndexedDB database stays `nihongo-tabi` and the localStorage fallback
prefix stays `nt:`. `/Nihongo-Tabi/` and `/Wayword/` are the same origin, so
in the same browser (desktop, Android Chrome) existing SRS progress carries
straight over to the new URL. Renaming either key would silently reset
everyone's progress. A comment in `store.js` records this so it isn't "fixed"
later.

The exception is iOS. A home-screen install there keeps its own storage,
separate from Safari and from any other install, so progress in an iOS install
of the old URL cannot move to a new install. There is no export feature, and
adding one is beyond this rename.

### A37 — The old URL stops working after the repo rename
GitHub does not redirect project Pages sites when a repo is renamed:
`https://shikomisen.github.io/Nihongo-Tabi/` now returns 404. A device with the
old app installed should remove that home-screen icon and install from
`https://shikomisen.github.io/Wayword/`. The old cache is deleted the first
time the new service worker activates in that browser.

A redirect stub could only be served by creating a new repo named
`Nihongo-Tabi`, and that would break GitHub's git redirect from the old name.
For a personal app with one user it isn't worth it, so none was created.

### A38 — Verification
`npm test` (content self-test and 81 integration checks) and
`npm run test:render` (80 render checks and 15 service-worker checks) all
pass. `jsdom` was installed temporarily (`--no-save`) so the render and SW
suites actually ran instead of skipping.

Then in real headless Chrome 154, with the **pre-rename build** served at
`/Nihongo-Tabi/` and the new build at `/Wayword/` on one origin (the state a
returning user's browser is in):

- The old SW was installed and `nihongo-tabi-v3` filled, alongside a foreign
  `other-app-v1` cache.
- The new SW registered and took control, with scope exactly `/Wayword/`.
  Title and `apple-mobile-web-app-title` are `Wayword`. The manifest parses
  with no errors and reports no installability errors, and `start_url` and
  `scope` resolve under `/Wayword/`.
- `wayword-v4` held all 520 assets (482 audio clips) that the SW's own
  manifest walk lists. `nihongo-tabi-v3` was deleted and `other-app-v1`
  survived.
- Offline, Chrome was routed through a proxy that drops every connection
  (page and service worker), the HTTP cache was cleared, and a probe confirmed
  the network was unreachable. Reload booted the app, the placement skip
  persisted, all five tabs and a category screen rendered, all 520 assets
  fetched with 200 (5.2 MB), and a cold navigation to `index.html#/review`
  booted.

### A39 — Live verification at the new URL
After the push, Pages served the new `sw.js` (`v4`) within about 20 s. The
same headless-Chrome run against **https://shikomisen.github.io/Wayword/**,
from a fresh profile, passed every check. The SW registered with scope
`https://shikomisen.github.io/Wayword/`; the manifest is installable, with
`start_url` `/Wayword/index.html` and scope `/Wayword/`; `wayword-v4` held all
520 assets; and with every connection dropped and the HTTP cache cleared,
reload, all five tabs, a category screen, all 520 assets (5.2 MB) and a cold
navigation to `index.html#/review` worked offline.
`https://shikomisen.github.io/Nihongo-Tabi/` returns 404, as A37 expects.

---

## Multiple languages

Asked for: a small home page with a button per language; Indonesian as a
placeholder; Japanese speakers able to learn English, picked as
*speaker › language to learn* at the top of that page. Three calls were put
to the user before building, and these are their answers:

- **What Japanese speakers study:** a new travel-English set written for
  them, rather than the Japanese course's phrases flipped round.
- **Interface:** fully in Japanese for Japanese speakers.
- **Scenarios:** English scenarios now, rather than phrases only.

Everything below was decided without asking.

### A40 — A course is a speaker–target pair, and the URL carries it
`content/courses.json` lists four courses: `en-ja` (the existing app),
`ja-en`, and the Indonesian placeholders `en-id` and `ja-id`. Indonesian
appears for both speakers, as the second option after each speaker's
available course.

Routes are `#/<course>/<screen>`, and `#/` is the picker. Putting the course
in the URL rather than in a preference means the back button, bookmarks and a
reload all stay in the right language.

Links from before courses existed — including the installed app's
"Review due cards" / "Browse phrases" shortcuts, which can't be rewritten on
devices that already have them — open in the course used last, or Japanese if
there isn't one. Unknown paths go to the picker.

### A41 — The picker opens on every launch, with due counts
As asked, the app opens on the home page, not the last course. To keep the
daily habit to one tap, each course card shows its state: *N cards due today*,
*not started*, or *coming soon*. These counts are read without switching the
active course and without writing anything (`deck.courseSnapshot`), so drawing
the page can't create storage for a course nobody has opened.

The *I speak* default is the device language if it's English or Japanese,
otherwise English. It's remembered, and entering a course sets it to that
course's speaker.

### A42 — Each course has its own database
Progress is per course: one IndexedDB database each, plus a matching
localStorage fallback prefix. That covers the deck, settings, placement and
stats. Resetting a course clears only that course's database.

- **en-ja** keeps `nihongo-tabi` / `nt:` (see A36), so existing progress was
  never moved. That was verified through a real upgrade in A50.
- **New courses** get `wayword-<course>` / `ww-<course>:`.
- **App-wide preferences** (speaker, last course, text size) live in their own
  `wayword` database.

The shared-database alternative — namespacing card ids inside `nihongo-tabi` —
would have needed a migration of existing cards and made "reset this course"
a filter instead of a clear.

Text size moved from the Japanese course's settings to the app-wide
preferences, since it's an accessibility setting. Its existing value is
carried over the first time it's read.

### A43 — Content keeps its own field names; a manifest map makes it generic
Japanese content files are unchanged. Each manifest gains:

- `fields` — which field is being learned (`target`) and which is the gloss
  (`meaning`), plus `ruby` / `reading` where they exist.
- `noteFields` — which notes exist and their labels: *Register* /
  *From anime?* for Japanese, 使い方 / よくある間違い for English.
- `copy` — the course's own placement-intro wording. The Japanese text moved
  out of `quiz.js` verbatim.

`content.js` adds generic `target`, `ruby`, `reading`, `meaning`, `notes`,
`targetLang` and `meaningLang` to every phrase, character, scenario line and
inline reply, and screens only use those. The alternative, renaming every
field in 148 phrases, 302 characters and 6 scenarios to generic names, was
rejected as churn on content that works.

Japanese content stays at `content/` rather than moving to `content/en-ja/`,
so its tools (`make-kana`, `crossref-kanji`) and all 482 audio paths are
untouched.

### A44 — The interface follows the speaker
`js/i18n.js` holds the English and Japanese strings; the English ones are the
previous UI text, verbatim. Course-specific wording lives in the manifest
instead (A43).

Some features appear only where the content supports them: furigana and
romaji toggles, romaji retirement, the Characters tab, the "Reading" row and
the character-card cap. The Characters screens can only be reached from a
course taught in English, so they were left in English rather than
translated. `npm test` enforces this split in both directions:

- Every `t('…')` key used in the code must exist.
- Every key the Japanese UI can reach must have a Japanese translation.

Fonts follow `lang`, which every target, meaning and note node now carries.
Japanese gets the CJK stack and correct glyph forms; English inside the
Japanese UI gets the Latin stack.

**The Japanese wording — the interface strings and all of the English
course's glosses, notes and feedback — was written by Claude and has not been
reviewed by a native speaker.** It's worth a native read before it's relied
on.

### A45 — What the English course teaches
The English course mirrors the Japanese course's ten categories, week
grouping and trip-relevance order, rewritten for a Japanese traveller abroad.

- **Phrases:** 104 of them. Each has a Japanese gloss and a 使い方 (usage)
  note. 29 also have a よくある間違い note, focused on katakana English (wake-up
  call, outlet, front desk, plastic bag, to go, receipt, allergy, claim) and
  direct-translation errors (*I'm reserving*, *since one week*,
  *We are two*, *on sale* vs *for sale*).
- **Variety of English:** American by default, because it's the most likely
  destination and what the 'en' TTS voice speaks. British equivalents are
  named in the notes (bill, platform, toilet, takeaway, lift).
- **Scenarios:** six of them, in American and British settings. Every reply
  gets Japanese feedback, and wrong replies are the classic mistakes above.
  Inline wrong replies gloss what the English *actually* says, e.g.
  「（わたしは観光という人です）」.
- **Ids:** phrase ids follow the Japanese course's scheme (`gre-01`…). They
  can't collide because each course has its own storage (A42). Audio lives
  under `audio/en/`.
- **No character sets:** English has no counterpart to kana drills worth
  building, so the Characters section is simply absent.

### A46 — English audio
The English audio comes from the same build-time pass and vendor as A2,
called with `tl=en`. That gives 135 clips: 104 phrases and 31 scenario NPC
lines.

`tools/generate-audio.mjs` now walks every course in `courses.json` and
synthesises each one in its manifest's `language`. A `--course` flag
restricts it to one course, since category ids repeat across courses.

### A47 — Indonesian is a placeholder in the data, not just the UI
`en-id` and `ja-id` are real course entries with `status: "planned"` and no
manifest. Their cards on the home page are dimmed and say *Coming soon*.
Opening one shows a coming-soon screen (course bar, no tabs, back to the
picker) rather than doing nothing, so the route is already in place.
Building Indonesian is then the content-only job described in README §13.

### A48 — Updating from the deployed build
The first launch after an update fetches the new `index.html` from the
network while the previous service worker still serves the previous `app.js`
from cache. Old JavaScript runs inside new HTML for that one launch.

The tab bar moved from HTML into JS, so `index.html` keeps the old static tab
links as a fallback for that launch. Without them, the previous build would
have rendered with no tab bar. The new code replaces those links on entering
a course, and hides them on the picker.

The cache went to `wayword-v5`. Precaching now walks `courses.json` and every
manifest in it, and one broken course no longer stops the others caching.

### A49 — Bugs found and fixed along the way
Most of these were pre-existing in the deployed app; one was introduced by
this change and caught before shipping.

- **"null" printed on screen (three places).** Three screens passed an absent
  child straight to the DOM's native `append()`, which prints `null` as text:
  - the first placement card (pre-existing)
  - every scenario's end screen (pre-existing)
  - the English study card, which has no toggle strip (introduced here,
    caught by a screenshot pass before shipping)

  All three now filter out absent children, and the render test checks for a
  stray "null".
- **Kana/kanji tap highlight never cleared (pre-existing).** The highlight
  read `e.currentTarget` inside a 400 ms timer. Browsers null that property
  once dispatch ends, so the timer threw and the highlight stuck. It now keeps
  its own reference to the element.
- **"Set up reading first" landed on Today (pre-existing).** The button set
  the Characters hash, then `onDone()` immediately overwrote it with Today.
  `onDone` now takes the destination.

### A50 — Verification
**Test suites.** All pass:

| Suite | Checks | Covers |
|---|---|---|
| `npm test` | 11,002 self-test + 111 integration | every course's content and scenarios; UI-string coverage; SRS; both courses end to end, including isolation (English study never touches Japanese progress or stats; resetting one course leaves the other) |
| `npm run test:render` | 136 render + 16 service-worker | the picker, the Indonesian placeholder, the whole English course in Japanese in a real DOM, old-link redirects, and an old deep link still booting |

**Real browser.** In headless Firefox 157, following the user's standing
preference, the deployed build (git HEAD, cache `v4`) was installed and used
at `/Wayword/`: placement skipped, a card graded. Then the same URL started
serving the new build:

- **First launch after the update:** the previous app still worked, tab bar
  included (A48).
- **Service worker:** the new one installed, and `wayword-v4` was replaced by
  `wayword-v5`.
- **Next launch:** opened the picker. Japanese showed *10 cards due today* —
  progress survived — and went straight to Today without re-placement.
- **Precache:** `wayword-v5` held all 676 assets of both courses, including
  135 English clips.
- **English course:** switching to 日本語 relabelled the picker. The English
  course ran its own Japanese-language placement and showed Japanese tabs
  without Characters. English text rendered in the Latin font stack and
  Japanese glosses in the CJK one.
- **Offline:** every connection dropped and Firefox's HTTP cache disabled. A
  cold launch opened the picker. Eight screens across both courses and an
  English scenario rendered, and all 676 assets (8.0 MB) loaded.

Phone-sized screenshots of the new screens were also reviewed by eye; that is
how the study-card "null" in A49 was caught.

---

## Repositioning: from trip phrasebook to a general learning tool

The trip is over. The app is now a general Japanese-learning tool for an
English speaker with a Japanese partner. He listens and speaks reasonably
well, but his hiragana is shaky and he hasn't learned katakana. The goals,
in order:

1. Remember words and know what to say.
2. Chain them into sentences with connectors.

The brief said not to stop for questions, so every call below was made
without asking.

### A51 — Setup check
- **Repo:** confirmed as `Shikomisen/Wayword`, clean, and level with
  `origin/main`. `git pull` was a no-op.
- **The space in "Remote work":** every tool was run from this path —
  `serve`, `make-icons`, `make-kana`, `crossref --check`,
  `generate-audio --check` and every test suite. None broke. They all build
  paths with `fileURLToPath` and pass arguments as arrays, never through a
  shell. The deploy script wasn't run, because it force-pushes; item 1
  replaces it.
- **`make-kana` is deterministic:** it writes LF line endings while this
  checkout uses CRLF. Git flags the files as modified, but there is no
  content difference.
- **Audio generation needs nothing installed:** it calls the A2 endpoint
  with Node's built-in `fetch`. Internet is needed at build time only.
- **`jsdom` and `puppeteer-core` are now dev dependencies (supersedes A18):**
  with `jsdom` missing, `npm run test:render` printed "skipping" and exited 0,
  so a green run proved nothing. The app itself still has no runtime
  dependencies.
- **Browser check committed:** the Firefox checks used in earlier sessions
  are now `tools/browser-check.mjs` (`npm run test:browser`). It covers a real
  service worker, Cache Storage, every tab of every course, and offline with
  every connection dropped. Its temporary browser profile and its
  `--upgrade-from` checkout live in `tmp/`, which is gitignored.

### A52 — Item 1: trip framing removed; weeks became topic groups
- **Copy:** the trip and deadline wording is gone from the UI and README
  (taglines, Browse intro, set descriptions, the Characters footnote, page
  and manifest descriptions). The manifest category `travel` was dropped.
- **Kept on purpose:**
  - §2 survives as a dated history of the original build plan.
  - The English course stays a travel-English course. That is its content,
    not framing.
  - Airport and Hotel stay as phrase categories, under a "Travelling" group.
- **Weeks became groups:** categories used to be grouped by a `week` field
  ("Week 1 — get off the plane"), which was the trip calendar built into the
  data. Each manifest now declares named `groups`, written in that course's
  own UI language, and each category names its group.
- **Starters replace "week 1" (supersedes A9):** placement used to activate
  the four week-1 categories. It now activates the categories marked
  `starter`. For Japanese the starters are greetings, numbers, small talk and
  the new casual set — what a partner conversation needs first. For English
  they stay greetings, numbers, airport and transport.
- **Checkboxes:** README §2 boxes are ticked. The exception is
  "scenarios for loaded categories", which stays unticked with a note:
  emergencies and small talk still have no scenario. §10 is closed; the name
  is Wayword.

### A53 — `npm run deploy` fixed rather than removed
The old script force-pushed a `gh-pages` branch. Pages serves `main`, so it
changed nothing users saw.

The new script runs the checks first, then pushes:
- It refuses if not on `main`, if anything is uncommitted, or if behind
  `origin`.
- It runs all four test suites.
- It pushes `main`, then polls the live `sw.js` until it reports this
  build's cache version.
- `--dry-run` stops before the push.

Removing the script was the alternative. A deploy that won't ship failing
tests and says when the site is live is worth keeping, so it stayed.

**Incident during the switch (no remote effect):** a write of the new script
failed silently, and my follow-up `--dry-run` therefore ran the *old* script,
which ignores that flag. I stopped it within seconds. `git ls-remote`
confirmed it never pushed: origin still had only `main` at `c5b4b71`. It had
created a local `.deploy-worktree` checkout and a local `gh-pages` branch;
both were removed.

### A54 — The casual set: studiable, labelled, paired with polite
README §6 had casual forms arriving later, as recognition-only. For this
learner that is backwards: the person he talks to most is his partner, and
casual is what you *say* to a partner. So:

- **Size and content:** the casual set has 39 phrases (`content/casual.json`),
  all fully studiable. Each carries its polite counterpart and a note on when
  each form is right: partner, friends and family get casual; staff,
  strangers and — at first — the partner's parents get polite.
- **Labels:** every phrase in the course now shows a **Polite** or **Casual**
  badge. A phrase's `register`, or else the course manifest's `register`,
  decides which. The English course declares no register, so it shows no
  badges.
- **Polite versions:** shown under each casual phrase, with furigana, romaji
  and their own audio clip (78 new clips).
- **Avoided:** gendered sentence-enders (わ, ぜ) and heavy forms. 愛してる is
  only mentioned in a note, as rare and heavy.
- **Furigana notation:** new content may write furigana inline, as
  `{漢字|かんじ}` (`js/ruby.js`), instead of segment arrays. Both forms are
  accepted everywhere. The self-test checks that the notation spells out the
  text exactly and that every reading is kana. TTS reads the kana reading the
  notation spells out.
- **Placement size (supersedes A5's ~15–20):** 11 categories × 2 = 22 phrase
  cards, plus 6 character cards.

### A55 — Item 2: content namespaced by language; adding a language is content only
- **Folders:** each course's content now lives in a folder named for the
  language being learned. Japanese is `content/ja/`, the English course
  `content/en/`, mirroring the existing `audio/ja/` and `audio/en/`. Every file
  moved with `git mv`, so history follows it. Card ids are unchanged, so no
  stored progress is affected.
- **A second course for the same language:** a Japanese course for
  Indonesian speakers would get its own folder (say `content/ja-id/`). The
  folder is just what `courses.json` points at.
- **What moved out of code into content:**
  - interface strings → `content/ui/<lang>.json` (plurals as
    `key_one`/`key_other` via `Intl.PluralRules`; the date locale as
    `$locale`)
  - per-language font stacks → `courses.json` `font`, injected as `:lang()`
    rules (the stylesheet's own `:lang` rules were removed so there is one
    source)
  - the furigana/romaji labels → each manifest's `aids`
- **Still built into the code:** four boot-error strings, which must work
  when no content can load.
- **Tools follow the manifests:** `make-kana` writes wherever the manifest
  declares the kana sets. `crossref-kanji` runs for every course that has a
  kanji set; re-running it now also links kanji to the casual phrases.
- **The claim is tested:** `tools/language-pack-test.mjs` (in `npm test`)
  adds an Esperanto course purely as content — a `courses.json` entry, a
  manifest and one category, held in memory. It then runs placement, the
  deck, the review queue, grading and the home-page snapshot over it.
- **Language selector inside the course:** a Language row in Settings
  joins the existing course-bar link back to the picker.
- **"Only Japanese ships now" — interpreted, not obeyed literally.** The
  English-for-Japanese-speakers course built on 8 October stays available.
  It was explicitly requested, it's complete and tested, and it may well
  suit the partner. I read the line as "add no other new language now":
  Indonesian stays a placeholder, and all of items 3–5 is Japanese only.
  Hiding it is one line — `"status": "planned"` on `ja-en` in
  `content/courses.json`.

### A56 — Item 3: words and sentences are decks, like phrase categories
- **Content I wrote:** 12 word decks (197 words) and one sentence deck (16
  sentences). The words are the everyday core for talking with a partner:
  people and family, time, everyday verbs, the little words, home, food,
  describing things, feelings and health, places, weather, work and study,
  free time.
- **Same machinery as phrases.** They are listed under the manifest's new
  `decks` key (`kind`: `words` | `sentences`) rather than added to
  `categories`, so the phrase screens and the placement quiz don't change
  meaning. Activation, the queue, progress and Today all treat a deck exactly
  like a category.
- **Learn replaces Browse.** It lists word decks, then sentences, then the
  phrase groups, then your own words. The route stays `#/…/browse`, so old
  links and the installed app's shortcuts still work.
- **Word details.** Part of speech; for verbs, the ます and て forms, because
  those are what the connectors chain. A usage note where one prevents a real
  mistake.
- **No romaji on the new content.** Furigana is the reading aid from here on.
  The learner listens and speaks well and needs reading practice, and romaji
  under every word would be read instead of the kana.
- **Katakana words carry a hiragana reading aid** (`{コーヒー|こーひー}`),
  since katakana isn't learned yet. Item 5 retires the aid once katakana is
  mastered.
- **Sentences are cut into chunks**, each optionally naming the word it uses
  by id. That gives each word its sentences ("In sentences"), each sentence
  its words, and item 4 its reorder drill. `npm test` checks the chunks
  rebuild the sentence exactly and every link is a real word.
- **Starters.** A new learner gets People & Family, Everyday Verbs, Little
  Words and Everyday Sentences, alongside the four phrase starters. Words are
  the stated top priority.
- **Placement doesn't sample word decks.** They are new material, and 30
  cards is already a long first screen.
- **Audio.** 213 new clips from the same build-time Google TTS pass.
  - The input is the kana reading, as for phrases. A katakana word is spoken
    from its katakana, not from its hiragana aid.
  - Six words whose kana form is a common homophone with a different pitch
    (あめ rain/candy, かえる return/frog, しる, かさ, あき, はる) are spoken
    from their kanji instead (`audioHint`). Each of those kanji has a single
    reading when it stands alone.

### A57 — Kanji flashcards: a set built from the words, not a bigger sign set
- The existing Common Kanji set is travel signage: exits, platforms,
  warnings. The word decks use about 180 kanji, and almost none of them were
  taught anywhere.
- **New set: Kanji in Your Words** (70 kanji, `content/ja/kanji-words.json`).
  The most frequent and most basic kanji in the word decks, grouped like the
  decks, each with readings, meaning, a note, audio, and links to the words
  it appears in.
- It goes through the same character deck and SM-2 queue as the other sets.
- **Compounds where the parts mean little alone:** 仕事 and 勉強 are entries,
  not 仕 and 強. The Common Kanji set does the same with 出口 and 病院.
- **Readings shown** use the dictionary form (`食` → たべる) with the other
  readings listed, the same convention as the existing set (`押` → おす).
- **Stubbed:** about 110 kanji in the word decks still aren't in any set.
  `npm run crossref` prints the list, most frequent first, so the set can
  grow from it.
- `crossref-kanji` now links kanji to words and sentences as well as
  phrases, words first. The kanji screen's label became "Seen in your words
  and phrases".

### A58 — Card directions: one SM-2 card per direction
- **Each direction is its own card.** Recognition keeps the item's own id;
  production is `<id>~p` and listening `<id>~l`. Recognising a word and being
  able to say it are different memories, so they are scheduled apart.
  Existing progress is untouched: every stored card is a recognition card
  under its old id.
- **Defaults:** Recognise and Say it on, Listen off.
  - Saying things is the stated goal.
  - Listening is already the learner's strength, and doubling the daily load
    on day one would hurt more than it helps.
  - Listen is one checkbox away (Settings → Card types).
- **Sibling rule.** A new Say it or Listen card waits until the same item's
  Recognise card has been seen once, so an item never arrives three ways in
  one day.
  - If Recognise is switched off, nothing waits. Otherwise those cards would
    never be introduced; the integration test covers this.
- **Switching a direction on** adds its cards to every deck already added, as
  new cards paced by the daily cap.
- **Existing learners:** decks added before directions existed gain their
  Say it cards the next time the course is opened. The "new" count on Today
  goes up accordingly; nothing jumps the queue.
- **Switching a direction off** parks its cards (they leave the queue and the
  counts) rather than deleting them, so switching it back on resumes where it
  was.
- **Characters** are only ever recognition cards: "say this hiragana" isn't a
  useful card.
- **Placement** credits recognition only. A phrase marked "I know this" gets
  its Recognise card seeded forward; its Say it card starts new, but can be
  introduced straight away, since the phrase has already been met.
- **Listening needs audio.** An item has a Listen card only if it can be
  heard: a bundled clip, a recording, or the device voice.

### A59 — Furigana modes, and "I can read this"
- **Three modes:** Always, Tap to show, Hidden.
  - Tap-to-show keeps the readings in place but invisible, so revealing one
    doesn't make the line jump. A faint dotted underline marks which words
    have one waiting.
  - The old on/off setting migrates: off becomes Hidden.
- **The ふりがな chip** cycles through the three modes wherever it appears.
  Settings shows them side by side.
- **"I can read this"** is a per-item switch on the back of a card. A marked
  item's furigana drops from Always to Tap to show everywhere it appears: its
  card, its deck, its sentences.
  - It only ever reduces help: Hidden stays hidden.
  - It is stored per course as a list of item ids.
  - So furigana fades item by item, at the learner's own judgement, rather
    than by a global switch the learner isn't ready to flip.

### A60 — Your own words: audio from the device, never from a server
- **Stored with the course's progress** (meta `userItems`), shown as one more
  deck, "mine", and studied exactly like the built-in decks. Ids are
  `u-<time>`.
- **Furigana.** Readings can be typed inline (`{漢字|かんじ}`). Or give a kana
  reading, which is spread over the kanji using the kana already in the word
  as anchors (`食べ物` + たべもの → `{食|た}べ{物|もの}`). If it can't be
  spread, the whole word gets the one reading.
- **"Generating audio at add-time where possible."** The bundled clips come
  from an online TTS service at build time. Calling one from the app would
  send what the learner types to a server, and README §8 says no data leaves
  the device. So at add-time the app uses what the device can do itself:
  - **Device voice:** if the device has a Japanese voice that runs locally
    (`speechSynthesis`, `localService` only — a network voice would send the
    text away), the card uses it, and it can be heard on the form before
    saving.
  - **A recording** made on the spot (`MediaRecorder`) — of yourself, or of
    whoever said it. Stored as a data URL under `rec:<id>`; a few seconds is
    tens of kilobytes.
  - **Neither:** the card says **No audio** in its list, on its card and on
    the form, instead of showing a play button that does nothing. It gets no
    Listen card.
- **Word or sentence** is guessed from the text (punctuation, length, or a
  particle mid-text: 今日は暑いね) and can be changed with one tap. It only
  changes the label.
- Export/import (item 6) carries all of this, recordings included.

### A61 — Smaller calls in item 3
- **Two bugs found with the screenshots.**
  - The add form printed a literal "null" where the voice controls would be
    (native `append()`); there is now a render check for it.
  - The screenshot tool skipped placement before it had rendered: the
    service worker now precaches over a thousand files at startup.
- **The service worker walks content files for any `audio` field**, rather
  than knowing each content kind. A new kind of content then needs no
  worker change.
  - `browser-check` keeps its own hand-written list of content kinds, so a
    kind the worker missed would still show up there.
  - `npm test` now fails if a module in `js/` isn't in the precached shell.
    `ruby.js` had been missing since item 1; it only worked offline because
    it had been cached at runtime.
- **Copy.** The deck button says "Study this deck", since it isn't always a
  category.

### A62 — Item 3 verification
- `npm test`: 19,282 content/UI/SRS checks, 150 integration checks (30 new:
  word and sentence normalisation, the chunk ↔ word links, all three
  directions, the sibling rule with recognition on and off, listening cards
  following audio, "I can read this", your own words from add to delete), 13
  language-pack checks.
- `npm run test:render`: 187 checks. The jsdom walkthrough now drives Learn,
  a word deck, a sentence deck, the furigana cycle, "I can read this", each
  card direction through the Settings checkboxes, and adding, editing and
  studying one of your own words. 16 service-worker checks.
- `npm run test:browser` in Firefox: 29 of 29. The cache holds all 1,058
  files (978 clips), every tab of both courses renders online and offline,
  and no errors are logged.
- Screenshots checked at phone width: Learn, a word deck, a sentence deck,
  both sides of a card, the add form, Settings and the new kanji set.

### A63 — Item 4: the Connectors course
- **The sixteen connectors asked for, one lesson each**, in five groups
  (and / because / but / if-and-when / while-and-the-rest).
  - The order runs simple to subtle: て before そして, から before ので
    before だから, たら before ば.
  - と is the conditional と ("whenever"), not the "and" between nouns. The
    list is about joining clauses, and the lesson says so.
- **Each lesson** has a pattern, a plain-English explanation, *Sounds
  natural* and *Sounds stiff or wrong* notes, and four examples.
  - Four is the middle of the 3–5 asked for: enough for a short drill
    session, few enough to read.
  - About half the examples are casual; with a partner, that's most of what
    gets said.
- **Furigana everywhere, prose included.** The explanations quote Japanese,
  and the learner reads weakly. So the prose writes kanji as `{漢字|かんじ}`
  and renders it with readings, following the furigana setting. `npm test`
  fails on any kanji in the prose without one. Katakana in examples carries
  a hiragana aid, as in the word decks.
- **Vocabulary reuse.** Every example links at least one word from the word
  decks (most link three or four), and the words show those examples under
  "In sentences".
  - One example was rewritten for this: the button that dispenses hot water
    became a button that turns the light on (電気).
- **One source, checked.** The lessons were written as chunks in a generator
  that derived the furigana, the plain text and the gap, and checked them
  before writing any file. The JSON is now the source; the generator was
  throwaway, in `tmp/`.

### A64 — The drills
- **Three kinds, all derived from each example's data**, so a new lesson
  needs no code: fill the gap, put it in order, join two sentences.
- **Fill the gap shows the English meaning.** Several connectors overlap
  (から/ので, けど/が, たら/ば, し as a reason). Without the meaning, more
  than one option would be defensible; with it, the distractors are clearly
  wrong.
- **"Also right" answers count as right.** Where a second option truly
  works (ので for から, が for けど, あれば for あったら, なら for だったら,
  したら for すれば), picking it is accepted, with a note on the difference.
  Marking it wrong would teach something false.
- **The gap is sometimes the form, not the connector** (歩いて vs 歩きて,
  寝れば vs 寝るれば, 子供のとき vs 子供なとき). Getting the form in front
  of the connector right is half the skill.
- **Put it in order** needs at least three pieces.
  - The pieces are cut so there's usually one natural order.
  - Where Japanese allows another (a し list in any order, 毎日 before or
    after 健康のために, 今日は at the front), it's listed in `alsoOrders` and
    accepted.
- **Join them** is on 25 of the 64 examples. It's left out where "joining"
  would still mean two sentences (そして, だから, でも) and for し, whose
  point is three or more parts.
  - The traps are clearly wrong forms or connectors (降っているけど,
    寝るれば, 来るながら).
  - Grammatical-but-formal versions such as 遅れましたので are never used
    as traps.
- **Tiles always show readings** (or none, when furigana is hidden).
  Tap-to-show can't work on something you tap to move.
- **Session size.** A lesson's practice uses all of its drills (about ten).
  Mixed practice draws 12 from the lessons already practised, or from all
  of them before any has been. The same sentence isn't asked twice in a row
  where that can be avoided.

### A65 — Missed drills go into the review deck
- **What a miss does:**
  - The missed sentence gets its cards in every enabled direction.
  - Its *Say it* card is failed (SM-2 "again") and comes back within about
    ten minutes. *Say it* because building the sentence is what the drill
    tested. If Say it is off, the first enabled direction is used.
- **Only what was missed.** The lesson becomes one of your decks, holding
  only the sentences you missed — "feed missed items into SRS", not "add
  the lesson".
  - *Study as cards* on the lesson adds the rest.
  - Studying a deck now always fills in its missing cards, which costs
    nothing for a deck that already has them all.
- **Right answers leave the deck alone.** A drill is recall with a lot of
  help — the pieces, the options — so counting it as a review would push
  cards out further than the learner has earned.
- **Practice is still counted.** Each session's score is kept per lesson
  (sessions, totals, best), and the day's drills keep the streak alive, the
  same as reviews.

### A66 — Connectors gets a tab; Scenarios moves into Learn
- Five tabs fit a phone comfortably. Japanese now has six sections (Today,
  Learn, Connectors, Characters, Scenarios, Settings).
  - Scenarios moves into Learn, under *Conversations*. It's the least
    central section now: the scenarios are the travel ones (immigration,
    tickets, a hotel), and the core of the course is words and connectors.
  - The rule is generic — over five, Scenarios goes to Learn. The English
    course, with no Connectors, keeps its Scenarios tab.
- **Today** has a Connectors row (how many lessons practised; mixed practice
  once one has been).
- **Lesson links.** A lesson deck in Today's "In your deck", and a connector
  example in a word's "In sentences", both link to the lesson, not to a deck
  screen.
- **Smaller fixes along the way:** the shared link helper now also handles
  kanji cross-references, so a kanji's chips open a word's or a lesson's
  page correctly.

### A67 — Item 4 verification
- `npm test`: 23,203 content/UI/SRS checks — every lesson's prose, gaps,
  options, traps and orders included. 177 integration checks (27 new: all
  sixteen connectors present, the drill builder and checks, alternative
  orders, traps, a miss landing in the deck as a failed Say-it card due
  within the hour, Study-as-cards adding the rest, practice stats). 13
  language-pack checks.
- `npm run test:render`: 206 checks. The walkthrough opens Connectors and a
  lesson, then plays a whole practice session: every fill-in, order and
  combine drill, the first fill-in deliberately wrong. It checks the marking,
  the score, the missed sentence in the deck, the best score on the list and
  Today's Connectors row.
- `npm run test:browser` in Firefox: 29 of 29. The cache holds all 1,140 files
  (1,042 clips, 13.2 MB), and Connectors works online and offline.
- Screenshots checked at phone width: the lesson list, a lesson, and a fill,
  order and combine drill before and after answering. Two layout bugs were
  fixed from them: a sentence broken onto three lines around its gap, and
  the connector column too narrow for それから.

### A68 — Item 5: what "kana mastery" means
- **Per character: right three times in a row, across at least two
  different days.** Three rights in one sitting is short-term memory; the
  second day is what shows it stuck. A miss resets both the streak and the
  days.
- **A character card at a week-long interval also counts.** Kana learned
  through the character flashcards shouldn't have to be proven again.
  Placement's "I know this" seeds cards at four to six days, so placement
  alone doesn't count.
- **A script is mastered at 90% of its 71 core kana** (46 base + 25 with ゛/゜).
  - Yōon and extended katakana are combinations of the core, so they don't
    gate anything.
  - 90% rather than 100%: one stubborn ぬ shouldn't hold back everything else.
- **The days are UTC days**, the same as the app's daily stats. For someone
  in Japan the day turns over at 9 a.m. That doesn't matter for a two-day
  rule, and keeps one definition of "a day" in the app.

### A69 — The daily kana drill
- **Hiragana first, then katakana.** Hiragana is half-known and needs
  solidifying, and kanji readings depend on it. Katakana can be practised
  any time from the Reading tab; the *daily* drill switches to it once
  hiragana is mastered.
- **Session:** about 15 questions — roughly two minutes.
  - Up to five new kana to start (a row, in teaching order), ten once most
    answers so far are right.
  - No new ones while 20 are half-learned.
  - Then the kana missed last time, then the least recently seen, plus two
    or more mastered ones, so they stay mastered.
- **Two kinds of question, about two to one:** see the kana and pick its
  sound (romaji — the fastest way to answer "what does this say?" for an
  English speaker), and hear it and pick the kana. The second matches this
  learner: listening is the strong skill, so sound → shape is the bridge
  into reading.
- **New kana are met before they're asked**, on an intro screen with their
  sound — katakana starts from nothing, and guessing isn't learning.
- **The options are near-misses:** the same row or the same vowel first
  (か き く, か さ た), from kana already met where there are enough of them.
  Kana that sound identical (お/を, じ/ぢ, ず/づ) are never offered together.
  Hearing them couldn't tell them apart, and the romaji would be the same.
- **Right answers move on by themselves** after a moment; wrong ones wait,
  showing the answer. Every answer plays the sound.
- **"Until the user passes a mastery threshold":** once both scripts are
  mastered, Today stops offering the drill and shows the character deck
  again. The drill stays reachable from Reading.
- **Its own record, not the SRS.** The kana drill keeps its own
  per-character record (meta `kanaStats`) instead of grading the character
  flashcards. The two measure different things — fast recognition in a
  multiple-choice drill vs. recall on a card — and mixing them would let
  easy drill answers push flashcards weeks out. A drill session counts
  toward the streak.

### A70 — Kanji wait for hiragana, softly; katakana aids retire themselves
- **The gate is soft, as asked ("gate or soft-nudge"), not a lock.** Until
  hiragana is mastered:
  - a kanji set's row says "After hiragana — n/71 mastered so far" and its
    button is a quieter **Add anyway**;
  - the set's own page explains why — kanji readings are written in
    hiragana — and offers today's hiragana drill first.
  - A lock would be wrong for someone who already reads some kanji.
- **Only hiragana gates kanji.** Furigana and kanji readings are written in
  hiragana; katakana doesn't come into it.
- **Katakana aids retire automatically.** The hiragana written over
  katakana words exists only because katakana isn't learned yet. Once it's
  mastered, those readings stop showing everywhere; kanji furigana is
  unaffected. The check runs on entering the course and after every kana
  drill.
- **Reading is the tab's name now** (it was Characters): it's where reading
  is learned, kana first. The route stays `#/…/characters`, so links keep
  working.
- **Today's order:** reviews, then the kana drill, then Connectors, then the
  deck list. The deck list grows long, and the two daily drills were ending
  up below it.

### A71 — Item 5 verification
- `npm test`: 23,000+ checks. 198 integration checks (21 new: the core
  counts, first-drill contents, option rules over 4,000+ generated
  questions, the mastery rule across days, card-based mastery, pacing, the
  move to katakana, aid detection, storage and the daily log).
- `npm run test:render`: 225 checks. The walkthrough covers:
  - the panel, the gate and Today's kana row;
  - a full first drill, with a deliberate miss;
  - hiragana mastery opening the kanji sets;
  - katakana mastery removing コーヒー's aid while kanji keep their furigana.
- One flaky check found and fixed along the way: the connector session
  builder could put two drills on the same sentence back to back. It now
  always spreads them, which is checked over 25 shuffles of every lesson.
- `npm run test:browser` in Firefox: 29 of 29. The cache holds all 1,142
  files (the two new modules included), and Reading works online and offline.
- Screenshots checked at phone width: the Reading tab, the intro screen, a
  listening question, the kanji gate and Today.

### A72 — Item 6: what a backup holds, and how a restore behaves
- **Everything the app stores, raw.** Every namespace store.js keeps —
  each available course plus the app-wide one — with its `meta` and `srs`
  stores exactly as stored, keyed as stored.
  - Copying the stores, rather than picking out "progress", means nothing
    is forgotten: recordings, connector scores, kana mastery, the romaji
    switch-off, placement.
  - Anything added later is in the backup without touching the backup code.
  - Namespaces with nothing in them are left out.
- **Plain JSON, one file**, with a format name and a version. A newer app
  can restore an older backup; an older app refuses a newer one with its
  own message rather than half-restoring it.
- **A restore replaces, but only what the backup holds.**
  - Each course in the backup is cleared and rewritten exactly. Merging
    two histories of the same cards has no right answer.
  - A course the backup doesn't hold is left alone. A backup made before
    starting the English course shouldn't wipe English progress made since.
- **Validated before anything is touched:** the format and version, sane
  namespace names, and every card an object with an id. A wrong file
  changes nothing and says so.
- **It asks first,** saying when the backup was made and what each course
  in it holds. The app's existing "reset" uses the same native confirm.
- **One level of undo.** Before a restore, what it's about to replace is
  saved in a separate store (`restore-undo`, never part of a backup), and
  Settings offers *Undo the restore*. The most likely accident with a
  restore feature is restoring the wrong file over good progress.
- **After a restore the app reloads**, so every cache (settings, content,
  your own words) starts from the restored data.

### A73 — Getting the file out of the browser, and reminders
- **Download is the main button; share is offered where it works.**
  - A download works everywhere: desktop browsers, Android Chrome, iOS
    Safari (into Files).
  - Where the system share sheet takes files (`navigator.canShare`), a
    second button sends the backup straight to Drive, mail or Files. If
    sharing fails for any reason but the user closing the sheet, it falls
    back to a download.
- **No cloud sync.** README §8 keeps data on the device, and sync needs a
  backend (README §9 lists it as a later phase). The backup file is the
  learner's to keep wherever they like.
- **A reminder, not a nag.** Today shows *Back up your progress* only once
  there is progress worth keeping (a card studied, or a word of your own),
  and only when there's no backup or it's over two weeks old. It's a row,
  not a pop-up.
  - Two weeks of reviews is real work to lose. Daily would be noise.
  - "Last backup" is remembered when a file is handed over. The app can't
    know whether the download was then kept.
- **The restore runs through the same storage code** as everything else,
  checked three ways:
  - localStorage, in the Node integration test;
  - jsdom, through the actual Settings buttons;
  - IndexedDB, in Firefox (a full export → import round trip, added to
    `npm run test:browser`).

### A74 — Item 6 verification
- `npm test`: 23,300+ checks. 215 integration checks (17 new):
  - the backup's contents, recordings included;
  - refusing non-backups and newer versions;
  - a full restore after a reset — cards, placement, your own words and the
    other course;
  - undo;
  - a one-course backup leaving the other course alone.
- `npm run test:render`: 236 checks. Through the real UI: the Today
  reminder, downloading a backup and reading the file back, the reminder
  going away, a non-backup file refused, a confirmed restore (the prompt
  checked), and undo.
- `npm run test:browser` in Firefox: 31 of 31, including the IndexedDB
  round trip (461 entries out and back, with an undo kept) and everything
  offline.
- Also renamed: Settings' deck summary said "Phrases: … cards" while
  counting words and sentences too; it now says "Flashcards".

### A75 — Item 7: the update a returning learner gets, checked before deploying
- **The live site served cache `v5`** (the multi-language build of 8
  October); everything in items 1–6 ships as `v6`. So every installed copy
  picks up a fresh cache, and the old one is removed.
- **`npm run test:browser -- --upgrade-from origin/main`, in Firefox: 33 of
  33.** It installs the live build, does placement in it, then serves this
  build at the same URL — what a returning learner's browser goes through:
  - the first launch after the update still renders (the old shell, as
    expected, while the new worker installs);
  - `wayword-v6` replaces `wayword-v5` with all 1,143 files (1,042 clips);
  - progress survives: Japanese opens on Today, not placement;
  - every tab of both courses works online and offline;
  - a backup round-trips through IndexedDB.
- **What changes for someone with existing progress:**
  - *Say it* cards are added for the decks they already have, as new cards
    the daily cap paces (A58).
  - Today suggests a word deck (they have none yet), the daily kana drill,
    Connectors, and a backup, since there's progress and no backup yet.
- **`npm run deploy` fixed again.**
  - Every test passed, then `git push` failed: Git Credential Manager here
    holds two GitHub accounts (Shikomisen, ShikoMDS), and with no window to
    ask which to use, it gave up.
  - The script now names the account for that one push (`-c
    credential.username=…`): `DEPLOY_GIT_USER` if set, else git's own
    setting, else the repository's owner. No config file is changed.
  - A failed push now explains itself instead of printing a stack trace.

### A76 — The live check found a hole in the install: fixed, and shipped as v7
- **Deployed as v6** (`c5b4b71..35ecfac`, live in 122 s). The browser check
  against the live site then passed 29 of 31.
  - One clip, `audio/en/res-04.mp3`, wasn't in the cache, so it failed
    offline. The file itself was fine (served 200, 18,048 bytes).
- **Cause:** the install sent all ~1,100 requests at once and skipped any
  that failed, so a single dropped request meant a file missing offline
  until it was next used online. Locally every request succeeds, which is
  why only the live check could catch it.
  - It's worse than one clip: a test run of the old worker on a flaky
    connection left out `js/app.js`, so offline the app wouldn't start at
    all.
- **Fix:**
  - The install now caches a dozen files at a time and retries failures
    twice, after a pause.
  - Whatever is still missing is reported, and the install still completes.
  - The cache version moved to **v7**, so every copy — including any v6
    copy with gaps — installs again.
- **Tested where it can't be missed.** `tools/sw-test.mjs` (part of every
  deploy) now runs the real sw.js in a sandbox over a connection where one
  request in ten fails the first time. It checks:
  - all 1,143 files end up cached;
  - the failed ones are retried;
  - nothing is reported missing;
  - a truly missing file is given up on after three tries without failing
    the install.
  The old worker fails this test, and the new one passes it.

### A77 — Item 7: live verification of v7
- **Deployed** `35ecfac..3039eda` with `npm run deploy`: every suite passed,
  pushed as Shikomisen, and https://shikomisen.github.io/Wayword/ served v7
  31 seconds later.
- **`npm run test:browser -- --live https://shikomisen.github.io/Wayword/`,
  Firefox: 31 of 31.**
  - The service worker takes control with the right scope.
  - `wayword-v7` holds all 1,143 files (1,042 clips, 13.2 MB).
  - Every tab of both courses renders online.
  - A backup goes out and back through IndexedDB on the live origin (461
    entries).
  - With the network really cut, the app starts cold, every tab renders,
    and every one of the 1,143 files loads from the cache. No errors are
    logged.
- **The learner's own update path, checked directly:** the v5 build that
  was live this morning (`c5b4b71`), used, then this build at the same URL:
  33 of 33. Progress survives, v7 replaces v5, nothing is missing, and
  everything works offline.

### A78 — The English course's first part: scope, and the answers it rests on
- **Asked before building, and answered:**
  - **Scope:** the three situations the partner named, end to end — the
    missing phrases, the ○○ patterns as lessons, café / clothes / asking
    scenarios as the customer, the words those need, and New Zealand
    wording — plus the README and the saved plan. The listening tab,
    per-course caching and the NZ voice come later.
  - **Audio for now:** the current Google voice; the NZ neural voice later.
  - **Where the gaps are:** not known yet. Build without assuming, and decide
    once the course has been used.
  - **Staff side:** none. The user asked for general English rather than
    staff-focused, so there are no staff-side scenarios and no
    customer-service vocabulary; the README and the plan drop them.
- **Pronouns:** the docs say "the partner" and "they". Nobody's pronouns were
  stated, and earlier drafts in this session had guessed.

### A79 — Phrase patterns are lessons, named by the course
- **Taught as frames.** The ○○ phrases are frames, so each is taught as the
  frame plus what fits it, in the connectors' lesson format. Seven lessons in
  `content/en/patterns/`, four examples each:
  - お願いする: *I'd like…*, *Can I have…?*, *Could I get…?*
  - たずねる: *Do you have…?*, *Is this…?*, *Where's…?*, *How much…?*
- **What comes free.** Every example is cut into chunks linked to the word
  decks, so these work with no new code:
  - fill-in and put-in-order drills;
  - word ↔ sentence links;
  - a missed drill going into the reviews.

  There are no combine drills: joining two sentences isn't what these frames
  teach.
- **The gaps.** The gap is usually the frame itself (*I'd like* / *I want* /
  *I like*), sometimes the piece learners drop (the *to* in *I'd like to try
  this on*). Every option has a Japanese *why*. *I want…* is marked wrong,
  not "also right": it's grammatical but blunt, and that is the lesson.
- **Naming comes from the manifest.** These all come from the manifest's
  `copy` (`lessonsTitle`, `lessonsTab`, `lessonsIcon`, `lessonsLede`):
  - the tab, its icon;
  - the list's title and intro;
  - the lesson's back link.

  Without them it falls back to Connectors, so the English course says
  フレーズの型 🧩 and the Japanese course is unchanged. The code is
  `lessonsCopy()` in `js/shared.js`.
- **Language tags.** Lesson marks and titles carry the course's target
  language (`lang="en"`), so English gets the Latin font and a wider column.
- **Tabs.** The English course has five: 今日, 学ぶ, フレーズの型, 会話練習
  and 設定. That's `MAX_TABS`, so Scenarios keeps its tab.

### A80 — Words and phrases: what was added, and New Zealand wording
- **Three word decks, 73 words**, covering what the three situations need:
  - café and food (25);
  - clothes and sizes (23);
  - shops and paying (25).
- **Starters.** Café and shops start in the deck, alongside the greetings,
  numbers, restaurant and shopping phrases. Clothes is added from Learn.
- **The shopping deck's name.** It's called お店・お会計, with 🧾, so Today
  doesn't show two decks both named 買い物・支払い 🛍️.
- **Notes and tags:**
  - Notes use the course's existing fields: `registerNotes` (使い方) and
    `pitfallNote` (よくある間違い).
  - Tags are in Japanese, like the phrases' tags, because they show as chips
    on a Japanese screen: カフェ, 服, お店, and on pattern examples フレーズの型
    plus the frame.
- **Parts of speech:** noun, verb, adjective, adverb and phrase (*try on*,
  *eat in*, *just looking* are phrases). English words have no forms to
  declare.
- **Eight phrases added**, for what the three situations were missing:
  - `res-11` *I'd like a flat white, please*
  - `res-12` *Is this spicy?*
  - `res-13` *Can I have the fish and chips, please?*
  - `res-14` *Do you have any vegetarian options?*
  - `sho-11` *Do you have this in a bigger size?*
  - `sho-12` *Where's the fitting room?*
  - `sho-13` *It's a bit too small*
  - `sho-14` *Can I have this one, please?*
- **New Zealand wording:**
  - Ten phrases reworded: `air-04`, `tra-01`, `tra-02`, `tra-05`, `dir-08`,
    `hot-07`, `hot-09`, `res-07`, `res-08`, `sho-10`. That gives *takeaway*,
    *the bill*, *power point*, *reception*, *on special*, *city centre*,
    Wellington and Queen Street.
  - Notes on 23 more were rewritten.
  - The notes keep the American word.
  - Ids are unchanged, so progress carries over. The reworded phrases' old
    clips were deleted and regenerated (`audioHint` holds the new text).
- **Groups and starters.** The groups are now 基本のひとこと, カフェ・レストラン,
  買い物, 街で, 空港・ホテル and もしもの時. The starter phrase categories are
  greetings, numbers, restaurant and shopping, where they were greetings,
  numbers, airport and transport: the course now starts with everyday
  situations rather than with arriving in a country.

### A81 — Scenarios: the learner as the customer
- **New:**
  - a café: ordering, *Is this spicy?*, eat in or takeaway, paying;
  - a clothes shop: sizes, the fitting room, *it's a bit too small*;
  - a bakery: asking for things, a bag, the price;
  - a bus: asking the driver.
- **Rewritten for New Zealand:** asking the way, and immigration, which gained
  a food-declaration step. Hotel check-in is kept, now with *lift*.
- **Removed:** the subway, restaurant and shop-checkout scenarios, which the
  café, bakery and clothes shop replace. Their clips went with them.
- **Unchanged:** every reply still gets Japanese feedback, wrong ones
  included. There's a new speaker label, 運転手 (driver).

### A82 — Code: what had to stop being Japanese-only
- **`tools/selftest.mjs`:**
  - Parts of speech and word forms come from the manifest's `words` (`pos`,
    `forms`, `verbForms`).
  - The polite/casual register check only applies to courses that use those
    registers.
  - The check that kanji in lesson prose has furigana only applies to courses
    with furigana.

  The Japanese manifest declares its own lists, so its checks are unchanged.
- **Interface strings:** new `pos.adjective`, `pos.phrase`, `speaker.driver`,
  `connectors.start` and `drill.backToList`. `lesson.back` now takes the
  lessons' name.
- **A bug found on the way:** the Japanese word decks' `usage` notes were
  written but never shown, because the en-ja manifest's `noteFields` didn't
  list `usage`. Now it does.

### A83 — Verifying v8 before deploying
- **`npm test`:**
  - 25,495 content checks.
  - 225 integration checks. New ones cover the English word decks and their
    notes, the pattern lessons with their gaps, verdicts, drills and word
    links, every English scenario resolving, and the new starters.
  - 13 language-pack checks.
- **`npm run test:render`:** 247 checks, then 20 service-worker checks. New
  ones cover:
  - the five-tab bar with フレーズの型;
  - the pattern list;
  - a lesson in English, with no furigana;
  - a pattern drill answered right;
  - a word deck with Japanese part-of-speech labels;
  - the café scenario.
- **`npm run audio:check`:** all 1,159 clips are there. 252 are English: 112
  phrases, 73 words, 28 pattern examples and 39 scenario lines. The 153 new
  ones use the interim Google voice.
- **`npm run test:browser`, Firefox: 33 of 33.** `wayword-v8` holds all 1,271
  files, and every tab of both courses renders online and offline.
- **`--upgrade-from origin/main` (the live v7, used, then this build at the
  same URL): 35 of 35.** v8 replaces v7, progress survives, and everything
  works offline.
- **Screenshots at phone width, checked by eye:** Today, the pattern list and
  a lesson, the café words and the café scenario. They led to two fixes:
  - the duplicate 買い物・支払い name (A80);
  - English tags ("cafe") showing on Japanese screens.

### A84 — Live verification of v8
- **Deployed** `1045ceb..1cc7bcb` with `npm run deploy`. Every suite passed
  again, it pushed as Shikomisen, and https://shikomisen.github.io/Wayword/
  served v8 31 seconds later.
- **`npm run test:browser -- --live https://shikomisen.github.io/Wayword/`,
  Firefox: 33 of 33.**
  - `wayword-v8` holds all 1,271 files (1,159 clips, 14.7 MB).
  - Every tab of both courses renders online, including the English course's
    フレーズの型 tab.
  - A backup goes out and back through IndexedDB on the live origin (577
    entries).
  - With the network cut, the app starts cold and every tab renders. Every
    file loads from the cache, and no errors are logged.
- **One README claim corrected.** *Can I get the menu?* has no card of its
  own. It appears in the note on the *Can I see the menu, please?* card, and
  the *Could I get…?* lesson teaches *Can I get…?* as natural too. §18 now
  says so.

### A85 — Completing the English plan: the answers, and the order they set
- **Asked before building (October 2026), as the plan requires:**
  - **Where the gaps are:** *saying what they want.* So the build leans on
    patterns, polite phrasing and "say it" practice, and the listening tab
    stays small.
  - **Offline use:** *often, on a phone.* So per-course offline caching comes
    first.
  - **The lessons tab:** *one tab with a broader name*, with patterns and
    connectors as groups inside it.
  - **The NZ voice:** *later.* Azure support and the slower button get built,
    but the clips stay on Google's voice until there's a key.
- **Order:**
  1. per-course offline caching;
  2. voice support and the slower button;
  3. speaking-first content: polite phrasing and connectors, then
     vocabulary and everyday sentences;
  4. a small listening tab;
  5. verify and deploy.

### A86 — Each course is cached once it's opened, not everything for everyone
- **What's cached when:**
  - **First visit:** the worker caches the shell, the course list and the
    interface strings — 34 files.
  - **Opening a course:** the app sends `keep-courses` and the worker
    downloads that course in the background: content files and every clip.
    The English course is 280 files (≈4 MB); the Japanese one is 958
    (≈10 MB).
  - A toast says when the download is done, and Settings → Your data shows
    whether this course is saved offline.
- **Nothing that works offline stops working:**
  - The worker records the courses it keeps in an unversioned cache,
    `wayword-kept`, and every new version downloads them before it takes
    over.
  - At launch the app asks for every course started on the device, so a
    course the browser evicted comes back. Since that list may be empty, a
    device that has started nothing is known to keep nothing.
  - **Updating from v8 or earlier** (every course cached, no record), the
    worker keeps every course for that one update, rather than guessing which
    ones are used. The record forms as the app is used, and the update after
    that keeps only the used courses.
- **Offline before a course was ever downloaded:** a content file the worker
  doesn't have answers 504 offline. `content.js` marks that error `offline`,
  and the router shows "Not on this device yet" in the learner's language,
  with a way back to the picker, instead of "Something went wrong".
- **Robustness:** JSON reads in the worker are tried three times, since a
  dropped manifest request would leave a whole course out. Two asks for the
  same course share one download, and writes to the record are serialised.
- **Tests:**
  - `tools/sw-test.mjs` runs the real worker over a flaky connection, one
    version after another on shared Cache Storage. It checks:
    - a first install caches the app only;
    - a course download is complete, with every flaky file retried;
    - only the opened course is downloaded;
    - the record;
    - offline asks are reported, not thrown;
    - the next version downloads the kept courses;
    - activation keeps the record;
    - the v8 update keeps everything.
  - `tools/browser-check.mjs` in Firefox checks:
    - a first visit caches 34 files and no course;
    - opening each course downloads all of it, and only it;
    - Settings says it's saved;
    - a never-opened course offline says it isn't on the device;
    - the record lists both courses.

    Its expected file lists are now fetched from Node, straight from the
    server. Fetching them through the page let the worker cache every JSON
    file the check read, so the check was measuring its own footprints.
  - `tools/render-test.mjs` checks the "not on this device yet" screen.

### A87 — The NZ voice is wired up, waiting for a key; 🐢 plays any clip slower
- **Voice per course.** A course's manifest can say which voice its clips are
  made with: `voice.engine` (`google` or `azure`), and under `voice.azure` a
  `default` voice for what the learner says and a `speakers` voice for the
  people they talk to (scenario lines).
  - The English course names `en-NZ-MollyNeural` and `en-NZ-MitchellNeural`,
    as the plan decided, but stays on `google`, as the user asked: no key
    yet.
  - The Japanese course has no `voice` and is unchanged.
- **Switching is one command:** `npm run voice:nz`. It writes
  `"engine": "azure"` into the manifest with a targeted edit (the layout is
  kept), then remakes every English clip. From then on new content is made
  in Azure too, so voices never mix.
  - A clip that fails mid-switch is deleted rather than left in the old
    voice, and a plain `npm run audio -- --course ja-en` makes it.
  - `npm run voice:samples` makes six clips first (a statement, a question
    and a scenario line, in each voice) for the plan's listening checkpoint.
- **No key, no run.** Without `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`, an
  Azure run, the samples and the switch all stop before changing anything,
  and say how to get a key. There's no silent fallback to Google.
  - On Windows a key saved with `setx` is read from the user's saved
    environment, so a terminal opened earlier still finds it.
  - A variable set but empty counts as no key; the test uses that.
- **Azure details:**
  - the REST endpoint, with `audio-24khz-48kbitrate-mono-mp3`;
  - SSML with the text XML-escaped;
  - free-tier pacing of one request every 3.1 s, since the free tier allows
    20 requests a minute;
  - a 429 is waited out (`Retry-After`) and not counted as a failure;
  - a 401 stops the run with a pointer to the key.
- **Tested without a key.** `tools/voice-test.mjs`, in `npm test` and the
  deploy, runs the real generator against a local stand-in for Azure. It
  checks:
  - the headers and well-formed, escaped SSML;
  - the learner's words in the default voice, and scenario lines in the
    other;
  - a rate-limited request retried;
  - clips written to `tmp/`, never over the real ones;
  - the switch editing one word and remaking all 252 clips;
  - every no-key path changing nothing.

  It puts the manifest back afterwards and checks that it did.
- **🐢 Slower.** Every 🔊 has a 🐢 beside it that plays the same clip at 0.75×
  with the pitch kept (`playbackRate`, plus `preservesPitch` and its
  prefixed forms). Listening cards and scenario lines get a 🐢 button too.
  It's per play, not a setting.
  - Safari resets `playbackRate` when a clip loads, so
    `defaultPlaybackRate` is set as well.
  - Your own words follow the same speed: recordings by playback rate, and
    the device voice through its `rate`.
  - It's in both courses: slower is as useful for hearing Japanese.

### A88 — Speaking first: words, everyday sentences, 23 lessons, and a say-it drill
- **Vocabulary, general rather than job-specific: five new decks, 177
  words.**
  - Everyday verbs (45), a starter: *get, take, bring/take, borrow/lend,
    tell/teach, hear/listen*.
  - Phrasal verbs (32): *pick up, hold on, sort out, run out of, top up*.
  - Money (27): *GST, insert, declined, split the bill, owe, afford*.
  - Katakana English that means something else (44): *complaint* for
    クレーム, *flat* for マンション, *power point* for コンセント, *buffet*
    for バイキング. Also words said differently: *allergy*, *energy*,
    *virus*.
  - New Zealand words (29): *kia ora, heaps, keen, reckon, sweet as, togs*.
    The corner-shop *dairy* is its own card, `w-dairy-shop`, distinct from
    the café's *dairy* (乳製品).

  Every word has a Japanese gloss; usage and pitfall notes come where they
  help, and the katakana deck always has one.
- **A sentence deck, 毎日の文 (42 sentences).** Short things to say, built
  from the words and cut into linked pieces. With "say it" cards on by
  default, each one is practised from the Japanese.
- **23 lessons in the connectors' format**, joining the 7 phrase patterns
  for 30 in five groups:
  - **ていねいに頼む・断る (polite):** *Could you…?* vs *Could I…?*; *Would
    you mind…?*, where "yes" means no; *Is it OK if I…?*; saying no with
    thanks; *Excuse me / Sorry / Thank you* for すみません; *You too!*, not
    *Me too!*.
  - **つなぎ言葉 (linking words):** *so, because, but / though, even though*
    (against *even if*), *actually, anyway, by the way* (against *on the
    way*), *I mean, you know, a bit / kind of, unless, as long as*.
  - **語順・質問の形 (word order):** *the one I…*, *Do / Does / Did…?*, tag
    questions (with NZ *eh?*), yes/no to negative questions, *It's … to …*.
  - Explanations, "natural" and "stiff" notes and every *why* are in
    Japanese. Each example links the words it uses, and 12 can be joined
    from two sentences with a trap piece.
- **The tab.** The user chose one tab with a broader name: 表現・つなぎ言葉,
  set by `copy.lessonsTitle`. The tab bar itself says 表現, because the full
  name wrapped onto two lines at phone width.
- **Say-it drill (the speaking answer).** A fourth drill kind in `drills.js`:
  1. the Japanese is shown;
  2. "say it out loud first";
  3. reveal the English with 🔊🐢;
  4. "I said it" or "Not yet".

  "Not yet" is a miss, so the sentence goes into the reviews as a failed
  "say it" card and comes back within the hour, like any missed drill. The
  app can't hear the learner, so the learner judges.
  - A course opts in through its manifest's `drills`. The English course
    lists all four. The Japanese course has no `drills`, so it keeps its
    three and is unchanged (its integration test now says so).
- **Built from data.** A throwaway builder (`tmp/`) checks everything before
  writing anything: ids are unique, word links exist, gaps rebuild their
  sentences, "also right" options have notes, traps aren't real pieces, and
  no sentence repeats one already in the course. It caught five repeats,
  which were reworded.
- **Verification:**
  - 311 new clips (Google voice, 0 failed);
  - `npm test`: 31,782 content checks and 233 integration checks;
  - render: 257, including a whole "so" session with all four drill kinds,
    "Not yet" landing in the reviews, and the 表現 tab;
  - service worker 34, voice 18.

### A89 — A small listening drill, on Today and in Learn rather than a tab
- **Small, because the gap is speaking.** It's about ten questions a day,
  two to three minutes, over 66 items:
  - **What did they say? (30 lines).** Things said back at a counter, a café
    or on a bus. They're in NZ English (*Are you right there?*,
    *twenty-four fifty*, *Tag on when you get on*). Hear the line and pick its
    meaning from three, in Japanese. Afterwards you see the line, its audio,
    **what you could answer** (the speaking half: *Takeaway, please.*) and a
    note where the wording is local.
  - **Which one did you hear? (18 pairs).** Sounds Japanese doesn't tell
    apart: L/R (light/right…), B/V, S/TH, and 13/30 as
    *That's fifteen / fifty dollars*, the mix-up that matters at a till.
    Vowel pairs were left out, because New Zealand vowels shift (*bed*, *bad*,
    *fish*) and would be unfair to drill against.
  - Every question has 🔊 and 🐢. A right sound pair moves on by itself; a
    reply waits, since there's an answer to read.
- **Mastery like kana:** right 3× in a row on 2 different days. The rule now
  lives in `js/mastery.js`, shared by `kana.js` and `listening.js`, as the
  plan asked. So does the "missed last time first" ordering.
- **The question card.** `js/choice.js` is shared by the kana drill (now
  rebuilt on it, with the same markup, and its tests pass unchanged) and the
  listening drill.
- **A drill's mix:**
  - what's in progress, missed first;
  - new items, taking replies and pairs in turn, up to six (a first drill
    is six questions);
  - two seats kept for something new even with a backlog;
  - two mastered items so they stay mastered.
- **Records.** Per item in `listenStats`, plus a `listenLog` for "done
  today". Both are ordinary meta records, so backups carry them. A finished
  drill counts toward the day like any drill.
- **Not a tab — a decision, not one of the open questions.** The plan said
  "a Listening tab". A sixth tab would push Scenarios into Learn, and
  Scenarios are the speaking practice. With speaking the stated gap,
  Scenarios keep the tab, and listening lives:
  - on Today, as a daily row like the kana drill;
  - in Learn, as a section.

  `/listening` lights the Learn tab.
- **Content rules.** Listening content sits under the manifest's
  `listening`, as `replies` and `contrasts` files. It isn't flashcards and
  never enters the review deck. Clips: the lines in the voice of the people
  the learner talks to (Mitchell, once the NZ voice is on), the pair words
  in the default voice. `npm test` checks:
  - ids and audio are unique;
  - each line has a speaker, and a reply comes with its meaning;
  - each pair is two different words;
  - there are enough lines for three-way choices.

  The worker and the Firefox check's hand-written walk both cache and
  expect the listening files.
- **Placement:** listening is on Today below the lessons, as the speaking
  work comes first.

### A90 — Verifying v10 before deploying
- **`npm test`:**
  - 32,492 content checks;
  - 245 integration checks — new: the 177 words and sentences, the 30
    lessons in five groups, all four drill kinds in a linking-word lesson
    with "because" as the trap, yes/no to negatives, and listening (loading,
    a first drill of both kinds, decoys, records, mastery over two days,
    refreshers, "done today");
  - 13 language-pack checks;
  - 18 voice checks (the other voice now covers what's said back).
- **`npm run test:render`:**
  - 269 render checks — new: the 表現 tab and title, a whole "so" session
    with say-it and "Not yet", and listening on Today and in Learn, its page,
    a full drill with a wrong first answer, and Today showing it done;
  - 34 service-worker checks.
- **Audio:** 1,536 clips present (629 English): 311 + 66 new ones, none
  failed.
- **`npm run test:browser`, Firefox: 41 of 41.** A first visit caches 38 app
  files. Opening the Japanese course downloads its 958 files; the English
  course, 688 (≈10 MB each).
- **`--upgrade-from origin/main` (the live v9): 39 of 39.** The design
  working across real versions:
  - v9 had recorded that this device uses the Japanese course;
  - v10 downloaded exactly that (996 files) before taking over, and kept the
    record;
  - the English course downloaded when first opened.

  The check had wrongly counted `wayword-kept` among the old caches to
  delete. It now expects the record to survive, and expects either "the
  recorded courses" or "everything" depending on what the previous build
  kept.
- **Deployed** `1665f0f..adb38a6` with `npm run deploy` (every suite again,
  the voice test included); https://shikomisen.github.io/Wayword/ served v10
  31 seconds later.
- **`--live`, Firefox: 45 of 45.**
  - A first visit caches the app (38 files).
  - Each course downloads when opened: 958 and 688 files.
  - A never-opened course offline says it isn't on the device.
  - The record of courses kept forms.
  - Every tab of both courses, and the listening page and drill, render
    online and offline; every one of the 1,684 files (20.2 MB) loads with
    the network cut; no errors are logged.
  - The check now visits sections without a tab (listening), and accepts a
    drill's question where a screen has no heading.
