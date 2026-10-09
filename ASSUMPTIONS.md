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
