# Wayword — Dev README
*(formerly "Nihongo Tabi" — renamed so the name isn't tied to one language)*

A language-learning tool for **real conversation**, built by a solo dev for
personal use. Japanese is the first course; more languages come later (§13).

It's shaped around one learner: an English speaker with a Japanese partner,
who listens and speaks reasonably well but reads weakly — hiragana still
needs solidifying, katakana isn't learned yet. So the priorities, in order:

1. **Remember words and know what to say.**
2. **Chain them into sentences** with connectors — て, から, けど, たら and the rest.
3. **Read** — solid kana first, then kanji, with furigana that fades as reading improves.

Anything that doesn't serve those gets cut or deferred.

*(It began in August 2026 as a phrasebook for a trip to Japan; §2 is that
original build plan, kept as history. The trip is over and nothing here is on
a deadline.)*

---

## 0. Platform

The full vision (native Flutter apps for Windows/Android/iOS/macOS,
bundled native-speaker audio, live AI chat) is real but large. What exists is
a **PWA (installable web app)** — it runs in the browser on Windows, Android
and iOS, installs to the home screen and works offline, with no store
submission and no native build chain. Native ports are Phase 2 (§9), not a
blocker.

---

## 1. Execution Directive for Claude Code

- **Target model:** Claude Opus 5, high thinking effort, for
  architecture, the SRS scheduler, and the content JSON schema. Sonnet 5
  is fine for repetitive content entry once the schema is set.
- **Do not stop to ask clarifying questions.** All open decisions have
  been made below. Where a genuinely new decision comes up during build,
  make the most reasonable call, keep moving, and log it in a running
  `ASSUMPTIONS.md` at the repo root so it can be revisited later.
- Extend the existing app rather than rebuilding it. Prioritize a working
  end-to-end loop over polish at every step — a rough version of
  everything beats a perfect version of one piece.

---

## 2. Original MVP Build Plan (history)

The first build, from August 2026. Everything here is done except where noted.

**Day 1 — working skeleton + first content + placement quiz:**
- [x] Static web app shell: category browser → phrase list → flashcard view
- [x] IndexedDB for progress + SRS state (localStorage fallback if simpler)
- [x] SRS scheduler (SM-2 — don't over-engineer)
- [x] Audio pre-generation script (build-time, see §3-audio) run for
      categories 1-4, bundled audio files wired to phrase playback
- [x] Content for categories 1-4 (see §6) — enough to start studying same day
- [x] **Onboarding placement quiz** (see §6a) — runs before first study session
- [x] PWA manifest + service worker (offline-capable, installable)
- [x] Runs via local dev server; add a one-command deploy script to a
      free static host (GitHub Pages by default) so it's reachable on
      the phone without manual file transfer — `npm run deploy` (§12)

**Day 2 — depth + remaining core:**
- [ ] Scenario dialogue trees (branching, static JSON) for loaded categories
      — *six per course; emergencies and small talk still have none*
- [x] Furigana toggle, romaji toggle
- [x] Remaining categories 5-10 stubbed in (thin coverage of everything
      beats deep coverage of a few)
- [x] "Due today" home screen driven by the SRS scheduler — *one tap in
      from the language picker since §13*

**Explicitly deferred (not blocking, add later if time allows):**
- Live AI conversation practice / AI-assisted placement (needs backend proxy)
- Native Windows/Android/iOS/macOS builds
- Bundled professionally-recorded audio
- Cloud sync

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App shell | Plain HTML/CSS/JS or a lightweight framework (Svelte/vanilla) | Zero build-chain overhead |
| Storage | IndexedDB (small wrapper) | Offline, no backend |
| Audio | **Pre-generated audio files, bundled with the app** | See §3a-audio below — real files, not a live device call |
| Offline/install | Service worker + Web App Manifest | Installable PWA on Windows and Android today |
| SRS | SM-2, implemented directly | Simple, testable |
| Content | Static JSON, one file per category, **versioned schema** | See §3a |
| Hosting | Local dev server + one-command deploy to GitHub Pages (or equivalent) | Reachable from phone without cabling files |

### 3-audio. Audio: Generated Once, Bundled, Not Live

**This is a build-time step, not a runtime dependency.** A script runs
once during content creation, synthesizes every phrase in the curriculum
to an actual audio file (mp3/ogg), and saves it alongside that phrase's
entry in the content JSON. The app just plays the file — no live TTS
call at runtime, no dependency on the end user's device having a
Japanese voice installed.

- Use whatever TTS the build environment has available for the one-time
  generation pass — a free TTS library/API (e.g. gTTS) if internet is
  available at build time, or a local/offline synthesizer (e.g.
  eSpeak-NG) if not. Claude Code's call to make; either is fine since it
  runs once, not per-user.
- Output: one short audio file per phrase ID, referenced by filename in
  that phrase's JSON entry. A few hundred short clips is realistically a
  few MB total — trivial to bundle and cache via the service worker.
- **Practical effect on setup:** the "download Japanese TTS voices on
  your devices" prep step is no longer required for the app to work —
  that was only needed under the live-TTS approach. No harm in still
  having a Japanese voice installed, just not a dependency anymore.
- Quality note: pre-rendered synthesized audio is good for pronunciation
  shape and pitch pattern, not a full substitute for real listening
  practice. Worth supplementing with outside native audio (podcasts,
  YouTube) regardless of this app.
- Real native-speaker recordings replacing the synthesized set remains a
  Phase 2 upgrade (§9) — same file-based playback mechanism, just swap
  the source audio files later with no app-code changes needed.

---

## 3a. Content Architecture (Scalability)

Content must be fully decoupled from app logic so the app can grow after
launch without code changes:

- One JSON file per category (`content/ja/airport.json`, etc.), a shared
  schema (id, Japanese, furigana, romaji, English, register notes,
  audio-hint, tags, difficulty).
- A single `manifest.json` listing active category files — adding a
  category means adding a file + one manifest line, not touching app code.
- Scenario trees follow the same pattern: one JSON file per scenario,
  referencing phrase IDs from the category files rather than duplicating
  text.
- Schema includes a `schemaVersion` field from day one so future content
  format changes don't break old data.
- This same structure is what would let a future language pack (beyond
  Japanese) or a native Flutter port reuse the content wholesale — the
  content layer shouldn't need to know what's rendering it. (Now in use:
  English for Japanese speakers is the second course — see §13.)

---

## 4. Learning Experience

1. **Onboarding placement quiz** — see §6a, runs once at first launch.
2. **Flashcards + SRS** — core daily loop: words, sentences, phrases and your
   own words, each asked three ways — see it, say it, hear it (§14).
3. **Connectors** — the words that chain sentences together (て, から, けど,
   たら…), each explained and drilled; missed drills feed the SRS (§15).
4. **Reading** — a short daily kana drill until hiragana and katakana are
   mastered, then kanji (§16).
5. **Scenario dialogue trees** — full exchanges, not isolated phrases.

*(Live AI chat is a future pillar — see §9.)*

---

## 5. Offline-First Architecture

- App shell + all content JSON + all bundled audio files cached via
  service worker on first load.
- Audio plays from bundled files — no network call, no dependency on the
  device's own TTS voice being installed.
- All progress/SRS/quiz-result state stored client-side.
- Zero backend, for anything the app does (the audio-generation script is
  a one-time build step, not something the running app does).

---

## 6. Content Scope

**Words first.** Twelve word decks (197 words: people, time, everyday verbs,
the little words, home, food, describing things, feelings, places, weather,
work and study, free time) and a deck of everyday sentences built from them —
see §14. Placement starts a new learner on three word decks and the sentences
as well as the phrase basics.

**Register.** Every phrase is labelled **Polite** or **Casual** on screen.
The phrase categories are polite (です/ます) throughout — consistent and
safe with anyone. The **Casual Speech** set (39 phrases) is how you actually
talk with a partner, friends and family; each casual phrase is shown next to
its polite version, with its own audio, and a note on when each is right.
It is fully studiable, not recognition-only — with a partner, casual is what
you say (ASSUMPTIONS A54).

**Phrase categories**, shown under topic groups (each manifest declares its
`groups`; `starter` categories are loaded by placement):

| Group | Categories |
|---|---|
| Everyday basics | Greetings & politeness · Numbers, time & money · Small talk · Casual speech |
| Out and about | Transportation · Directions · Restaurants & ordering (incl. allergies and dietary needs) · Shopping & payments |
| Travelling | Airport & immigration · Hotel |
| If something goes wrong | Emergencies & health |

Per-phrase: furigana toggle, romaji toggle (off by default after the first
week), register notes — including where anime Japanese diverges from real
polite usage (dramatic or masculine speech patterns that sound odd or
brusque from a polite speaker).

### 6a. Onboarding & Level Calibration

Japanese picked up by ear — from a partner, friends or the screen — tends to
be real but lopsided: you understand more than you can say, register skews
casual, and reading lags behind listening.

Calibration (offline, no AI call needed):
- On first entering a course, a short placement quiz pulls two sample cards
  from every phrase category (22 for Japanese), plus two per character set.
  Word and sentence decks aren't sampled: they are new material, and the
  starter ones simply begin from the first card.
- Self-graded ("did you know this?") rather than typed-answer, to keep
  it fast.
- Known cards get inserted into the SRS deck at a later starting
  interval instead of the beginning, so the first weeks aren't spent on
  material already retained.
- Unknown or "recognized but wouldn't produce" cards start at the normal
  first interval.

Optional future enhancement (Phase 2, not blocking): a one-shot Claude
API call at onboarding where the user free-types what they know, and
Claude suggests a calibrated starting configuration and flags likely
register mismatches from anime exposure. Requires network once and a
minimal backend proxy — worth adding once the core app is stable, not
before.

---

## 7. Pacing

There's no calendar. Placement loads the course's starter categories; add
more from Learn a couple at a time. Don't front-load everything into the SRS
deck at once — the review load is cumulative, and a handful of new decks a
week keeps daily review time bounded. The new-cards-per-day cap (Settings)
does the rest.

---

## 8. Non-Functional Requirements

- App launch + usable state in under 2 seconds, offline.
- Adjustable text size, furigana/romaji toggles double as accessibility features.
- No data leaves the device in the MVP — no backend, so this is automatic.
  The one way out is a backup file the learner saves themselves (§17).

---

## 9. Phase 2+ — Long-Term Vision (Not Blocking)

- Native builds: Flutter recommended for Windows/Android/iOS/macOS —
  Skia rendering handles furigana/CJK layout well, one codebase across
  all four targets.
- Bundled native-speaker audio to replace/supplement TTS.
- Live AI conversation practice via Claude API (backend proxy for the key).
- AI-assisted onboarding calibration (see §6a).
- Cloud sync/backup of progress.
- Additional language packs, enabled by the content architecture in §3a.
  *(Started — English for Japanese speakers is live and Indonesian is
  stubbed; see §13.)*

---

## 10. Open Questions

None. *(Closed: the app name — it's **Wayword**, chosen in October 2026 so the
name isn't tied to one language; see ASSUMPTIONS A32.)*

---

## 11. Characters — Reading (added after the MVP)

A top-level section — the **Reading** tab — covering the writing system
itself. The daily kana drill and kana mastery that lead into it are §16. Reading unlocks the rest of the app: furigana, signage, and
menus all stop being opaque.

**Sets** (one JSON file each, listed in `manifest.json → characterSets`,
same versioned-schema rules as §3a):

| Set | File | Count | Scope |
|---|---|---|---|
| Hiragana | `content/ja/hiragana.json` | 104 | 46 base + 25 dakuten/handakuten + 33 yōon |
| Katakana | `content/ja/katakana.json` | 116 | same structure, plus 12 extended combos (ファ, ティ, ジェ…) for loanwords |
| Kanji in Your Words | `content/ja/kanji-words.json` | 70 | the kanji behind the word decks (人, 今, 食, 話, 電…), grouped like them |
| Common Kanji | `content/ja/kanji-common.json` | 82 | curated for everyday reading, not exhaustive |

Kanji covers numbers and money, the seven day kanji and time, wayfinding
(出口, 入口, 男, 女, お手洗い, compass points), stations and tickets, shops and
payment, warnings (危険, 禁止, 非常口), and everyday signage (押, 引, 空, 満).
Multi-character compounds are included where that is how you actually read
them off a sign.

**Per-character schema:** `character`, `readings[]`, `romaji`, `english`
(kanji only — kana carries `null`), `audio`, plus `group`, `row`/`column` for
grid placement, `difficulty` and `tags`. Kanji additionally carry `seenIn`,
a generated list of phrase IDs containing that character.

**Cross-reinforcement.** `tools/crossref-kanji.mjs` scans the words,
sentences and phrases and links each kanji to the ones it appears in — words
first, since 行く is the most direct place to meet 行. Every one of the 70
kanji in *Kanji in Your Words* is linked, and 43 of the 82 common ones. The
kanji list shows those as tappable chips, so the Characters section
reinforces the decks rather than sitting beside them as a second
disconnected vocabulary list. The same tool lists the kanji the word decks
use that no set teaches yet (about 125 today) — the to-do list for growing
the kanji sets.

**Reuse, not a parallel system:**
- Audio comes from the same build-time pass as §3-audio — 372 bundled clips,
  no live TTS. Kanji clips are synthesised from the kana reading, not the glyph.
- Review is the same SM-2 scheduler and the same flashcard UI as phrases.
  Character content is stored phrase-shaped, so the review screen needed no
  changes at all.
- The furigana/romaji toggles work throughout, including on the charts.

**Separate deck.** Character cards are tagged `kind: 'character'` and have
their own queue, their own daily new-card cap, and their own review counter.
Character reviews never appear in phrase review counts, in either direction.

**Onboarding.** The placement quiz (§6a) samples two characters from each set
alongside the phrase cards — 30 items total for Japanese. Prior exposure to written Japanese
is credited exactly the way phrase knowledge is: known characters seed forward
instead of starting from あ.

**UI.** A reference chart per set (kana as the traditional grid by row, kanji
as a browsable list grouped by usage), tap any character to hear it; plus
flashcard review per set or across all sets.

**Deliberately out of scope:** handwriting practice, stroke-order diagrams and
stroke-order animations. This app teaches reading, not writing. See `ASSUMPTIONS.md` A24.

---

## 12. Running It (added during build)

No runtime dependencies and no build step; Node 18+. `npm install` brings in two
dev-only tools for the test suites: jsdom and puppeteer-core.

```bash
npm start                 # dev server on :5173, also prints your LAN URL for phone testing
npm test                  # every course's content + UI-string coverage + SRS + end-to-end logic (23,000+ checks)
npm run test:render       # renders every screen in both courses + service worker checks (jsdom)
npm run test:browser      # the real app in Firefox: service worker, full precache, every tab, offline
npm run test:sw           # service worker registration regression tests
npm run audio             # generate any missing TTS clips, every course, each in its own language
npm run audio -- --course ja-en   # …or just one course
npm run audio:check       # report audio coverage without generating
npm run kana              # regenerate the hiragana/katakana content files
npm run crossref          # relink kanji to the phrases they appear in
npm run icons             # regenerate the PWA icons
npm run deploy            # tests, push main, wait until the live site serves the new build
```

**On your phone:** run `npm start`, then open the `Network:` URL it prints
(same Wi-Fi). The app works, but **the service worker will not register over a
plain `http://` LAN address** — service workers require a secure context, so
offline mode and *Add to Home screen* need either `http://localhost` or an
HTTPS deployment. The app now logs exactly this to the console rather than
skipping silently. This applies to Android and iOS alike.

### Deployed

**Live: https://shikomisen.github.io/Wayword/**

(Until the rename it was published at `/Nihongo-Tabi/`. GitHub does not
redirect project Pages URLs after a repo rename, so that address no longer
serves the app — see *Rename to Wayword* in `ASSUMPTIONS.md`.)

Served by GitHub Pages straight from **`main` / `root`** — no build step, no
`gh-pages` branch, because the build output (audio, content JSON, icons) is
committed. `.nojekyll` at the repo root keeps Jekyll's hands off it.

**Deploying a change:**

```bash
npm run deploy                 # checks you are on a clean, up-to-date main; runs the
                               # test suites; pushes main; waits until the live site
                               # serves the new service worker, then prints the URL
npm run deploy -- --dry-run    # everything except the push
```

Pages rebuilds from `main` on every push, so a plain `git push origin main` also
deploys — the script just refuses to do it with failing tests or uncommitted
work, and tells you when it is actually live.

The script pushes as the repository's owner (`Shikomisen`). Git Credential
Manager otherwise stops to ask which account to use when it holds more than
one GitHub account. To push as someone else, set `DEPLOY_GIT_USER=<account>`.

Install it on a phone by opening that URL in Chrome or Safari → *Add to Home
screen*. Because it's HTTPS, the service worker registers and the app is fully
offline-capable once loaded — unlike the `http://` LAN address that `npm start`
prints.

The service worker registers correctly from the project subpath —
`register('sw.js')` is document-relative and takes `/Wayword/` as its
scope, which is asserted in `npm run test:sw`. Don't make that path absolute.

Content lives in `content/` — adding a category is one JSON file plus one line
in its course's manifest (`content/ja/manifest.json` for Japanese,
`content/en/manifest.json` for English), with no app-code changes (§3a).
Run `npm run audio` afterwards to synthesise its clips.

See `ASSUMPTIONS.md` for decisions made during the build that this spec
didn't cover.

---

## 13. Multiple languages (added after the rename)

The app now opens on a language picker instead of going straight into
Japanese.

**Home page (`#/`).** At the top, *I speak*: English or 日本語. Below it, the
languages taught from that one, each card showing where you are — cards due
today, not started yet, or coming soon. Choosing a speaker relabels the whole
page in that language. Inside a course, a slim bar at the top
("‹ Languages · English › Japanese") leads back to the picker.

| Course | id | Status | Content |
|---|---|---|---|
| Japanese, for English speakers | `en-ja` | available | `content/ja/` — 197 words, 16 sentences, 16 connector lessons (64 examples), 187 phrases (incl. 39 casual), 372 characters, 6 scenarios |
| English, for Japanese speakers | `ja-en` | available | `content/en/` — 104 phrases, 10 categories, 6 scenarios |
| Indonesian, for English speakers | `en-id` | planned | placeholder screen only |
| Indonesian, for Japanese speakers | `ja-id` | planned | placeholder screen only |

**Courses are content.** `content/courses.json` lists every course; each
available one points at its own manifest. Content is namespaced by the
language being learned — `content/ja/`, `content/en/` — matching `audio/ja/`
and `audio/en/`. A manifest's `fields` says which
field holds the text being learned (`target`) and which holds the gloss
(`meaning`), plus `ruby` and `reading` where they exist; `noteFields` names the
usage notes and how they're labelled; `copy` carries the course's own wording
for the placement intro; `groups` names the topic groups and `aids` names the
reading aids (ふりがな, romaji) and their settings. Screens only ever see the generic fields content.js
derives from those (`target`, `meaning`, `notes`…), so neither direction is
special-cased, and each course's files keep field names that read naturally
to their authors (`english` / `japanese`).

**URLs carry the course** — `#/en-ja/browse`, `#/ja-en/scenario/checkin`.
Links from before courses existed, including the installed app's own
shortcuts, open in the course used last.

**Progress is per course.** Each course has its own IndexedDB database:
`nihongo-tabi` for Japanese (the name it always had, so existing progress
carried straight over), `wayword-ja-en` for English, and so on. Placement,
settings, streaks and the deck are all per course; resetting one course
leaves the others alone. Text size is app-wide.

**The interface speaks the learner's language.** Interface strings are
content too: `content/ui/en.json` and `content/ui/ja.json` (plurals as
`key_one` / `key_other`, chosen by the browser's own plural rules). The
interface follows the course's *speaker*, so
Japanese speakers get a Japanese UI throughout. `npm test` fails if a string
the Japanese interface can reach has no translation, or if code uses a key
that doesn't exist. The Characters section only exists for courses with
character sets (today, Japanese for English speakers), so its wording stays
English. Controls a course can't use — furigana, romaji, the Characters tab —
simply don't appear.

**English for Japanese speakers** mirrors the Japanese course's ten phrase
categories, written for a Japanese speaker using English abroad: American English by
default, British variants mentioned in the notes. Every phrase has a Japanese
gloss and a 使い方 (usage) note; many also have a よくある間違い note on
katakana-English and direct-translation traps — wake-up call not モーニングコール,
outlet not コンセント, front desk not フロント, *to go* not テイクアウト,
plastic bag not ビニール袋, *on sale* vs *for sale*. Six scenarios (immigration,
the subway, asking the way, hotel check-in, a restaurant, a shop checkout) give
Japanese feedback on every reply, wrong ones included. Its 135 audio clips
come from the same build-time pass as §3-audio, synthesised in English.

**Adding a language** (Indonesian, say) is content only — no app code:

1. Write `content/id/manifest.json` and its category (and scenario) files in
   the same shape. Put the field names you like in the files and map them in
   `fields`; add `groups`, mark a few categories `starter`.
2. In `courses.json`: set the course's `status` to `available` and add its
   `manifest` path. If the language needs a particular font stack, give it a
   `font` (applied to every `:lang(id)` element).
3. `npm run audio -- --course en-id`, then `npm test`.

A new *speaker* language (people learning *from* it) additionally needs
`content/ui/<code>.json` and a place in `courses.json → speakers`.
`tools/language-pack-test.mjs` (part of `npm test`) proves the claim: it adds
a made-up Esperanto course purely as content and runs placement, the deck,
review and grading over it.

---

## 14. Words, sentences and how cards are asked (added with the repositioning)

The tab that was *Browse* is now **Learn**: word decks, sentence decks, the
phrase categories, and your own words, in that order.

**Word decks** (`content/ja/words/*.json`, 12 decks, 197 words). Each word has
its meaning, part of speech, a usage note where one helps (あなた is best
avoided to someone's face; 彼女 is both "she" and "girlfriend"), and — for
verbs — its ます and て forms, because those are what get chained into
sentences. Every kanji carries furigana, written inline as `{行|い}く`.
Katakana words carry a hiragana reading aid (`{コーヒー|こーひー}`) while
katakana is still being learned. New content has no romaji: furigana is the
reading aid from here on.

**Sentence decks** (`content/ja/sentences/everyday.json`, 16 sentences).
Short, natural sentences built from the word decks, each cut into `chunks`
that name the word they use by id. A sentence card lists its words (tap one
to go to its deck); a word card lists the sentences it appears in. The chunks
are also what the sentence-building drills reorder.

**Kanji in Your Words** (`content/ja/kanji-words.json`, 70 kanji). The kanji
behind the word decks, as flashcards in the Characters section — see §11.

**Card types.** Every word, sentence, phrase and your-own card can be asked
three ways (Settings → *Card types*):

| Card type | Front | Back | Default |
|---|---|---|---|
| Recognise | the Japanese (with furigana per the setting) and its audio | meaning, notes, word details | on |
| Say it | the meaning — *How do you say this in Japanese?* | the Japanese, played aloud | on |
| Listen | the audio only, played as the card appears | what was said and what it means | off |

Each type is its own SM-2 card (`w-iku`, `w-iku~p`, `w-iku~l`), so knowing a
word when you see it and being able to say it are scheduled separately. A new
*Say it* or *Listen* card waits until you've seen the word's *Recognise* card,
so one word never arrives three ways on the same day (unless Recognise is
switched off, in which case nothing waits). Switching a type on adds its
cards for every deck you've added, as new cards paced by the daily cap;
switching it off parks them without deleting them. Characters are only ever
asked one way.

**Furigana fades.** Furigana has three modes — *Always*, *Tap to show* (the
reading is there but invisible until you tap the word) and *Hidden* — set in
Settings or cycled from the ふりがな chip above any deck or card. On the back
of a card, **I can read this** marks that one item as readable: its furigana
then drops from *Always* to *Tap to show*, everywhere it appears, so the
readings fade card by card as your reading improves.

**Your own words** (Learn → *Your own words*). Add anything you want to learn
— what your partner said at dinner, a word you looked up: the Japanese
(readings can be typed inline as `{漢字|かんじ}`), an optional kana reading
(turned into furigana), the meaning and a note. Audio, where possible:

- **the device's own voice** for Japanese, if the device has one that runs on
  the device itself — checked when you add the card, and used to say it;
- **a recording** you make on the spot, of yourself or of whoever said it;
- otherwise the card is marked **No audio**, plainly, and gets no *Listen* card.

Nothing is sent to an online speech service (§8). Your own words are stored
with the course's progress, recordings included.

**Adding a word or sentence deck** is content only: a file shaped like
`content/ja/words/people.json` and one entry under `decks` in the manifest
(`kind`: `words` or `sentences`; `starter: true` to have placement add it).
Then `npm run audio` and `npm run crossref`. `npm test` checks every word
has a known part of speech, every verb its forms, every kanji its furigana,
every sentence chunks that rebuild it exactly, and every chunk a real word.

---

## 15. Connectors and sentence building (added with the repositioning)

The core of the course: the words that turn single sentences into
conversation. A **Connectors** tab holds one lesson per connector, in five
groups:

| Group | Connectors |
|---|---|
| And, and then | 〜て · そして · それから |
| Because and so | から · ので · だから |
| But | けど · が · でも |
| If and when | と · たら · ば · とき |
| While, what's more, in order to | ながら · し · ために |

**Each lesson** (`content/ja/connectors/<name>.json`) has:
- the pattern;
- a plain-English explanation;
- **Sounds natural** and **Sounds stiff or wrong** notes — where it fits,
  and what to say instead where it doesn't;
- four example sentences, each with audio and furigana, labelled polite or
  casual. About half are casual, the way you'd talk with a partner.

The Japanese inside the explanations carries furigana too (written
`{漢字|かんじ}` in the prose), following the furigana setting.

The examples are built from the word decks' vocabulary, and each one links
the words it uses by id. A word's card lists the connector examples it
appears in, and an example lists its words — learned words reappear in
context.

**Drills** (*Practise* on a lesson, or *Mixed practice* across the lessons
you've done). Three kinds, all built from the examples:

| Drill | Prompt | Answer |
|---|---|---|
| Fill the gap | the meaning, and the sentence with its connector (or the form before it) missing | pick from 3–4 options |
| Put it in order | the meaning | tap the sentence's pieces in order |
| Join them with … | two short sentences | build the joined sentence from the pieces — with a trap or two among them (the wrong form, the wrong connector) |

- **Also right is accepted.** Where another answer is also right (ので for
  から, が for けど, ば or なら for たら), it counts as right, with a note on
  the difference.
- **Alternative orders.** A sentence that can be ordered more than one way
  accepts each of them.
- **After every answer** you get the full sentence, its audio and, when you
  were wrong, why.
- **Missed drills feed the SRS.** The missed sentence joins your review deck,
  with its *Say it* card failed so it comes back within minutes. Its lesson
  becomes one of your decks, holding just the sentences you missed.
  *Study as cards* on the lesson adds the rest.
- **Progress.** Each session's score is kept per lesson; the best shows on
  the list. A day of drills keeps the streak going.

**Navigation.** With Connectors, the course has more sections than a phone's
tab bar holds comfortably, so the tab bar keeps five and **Scenarios moves
into Learn** (as *Conversations*). The English course, which has no
Connectors, keeps its Scenarios tab.

**Adding a lesson** is content only: a file shaped like
`content/ja/connectors/kara.json` and one line under `lessons` in the
manifest. Each example needs:
- `chunks` — the sentence in pieces, with word ids;
- a `gap` — the text either side of the answer, the options, and optionally
  `ok` (other right answers) with a `note`, and `why`;
- optionally `combine` (two sentences and their traps) and `alsoOrders`.

`npm test` checks:
- the gap rebuilds the sentence exactly;
- the answer is among the options;
- traps aren't real pieces;
- every kanji, prose included, has its reading.

---

## 16. Reading progression (added with the repositioning)

Reading is the weak skill: hiragana needs solidifying, katakana isn't
learned yet. So the Reading tab (§11) now leads with kana, and kanji wait
for them.

**Kana mastery.** Each kana is tracked on its own. It counts as mastered
once you've got it right **three times in a row, on at least two different
days** — knowledge that lasted overnight, not a lucky run. A miss starts it
over. A kana whose flashcard has reached a week-long interval counts too, so
kana already learned through the character deck aren't drilled again.

A script is mastered at **90% of its 71 core kana** — the 46 base kana and
the 25 with ゛ or ゜. Yōon (きゃ) and extended katakana (ファ) are built from
those, so they don't hold anything up. Both scripts' progress shows at the
top of the Reading tab.

**The daily kana drill** — about two minutes, on Today and in Reading, until
both scripts are mastered:
- **Order:** hiragana first, then katakana. Either can be practised at any
  time.
- **New kana, a row at a time** (あいうえお, かきくけこ…), met on an intro
  screen first — tap to hear each — and then asked. Five a session to start,
  ten once most answers are right. No new ones while twenty are still
  half-learned.
- **About fifteen questions** of two kinds: *What does it say?* (see the
  kana, pick its sound) and *Which one did you hear?* (hear it, pick the
  kana).
- **The options** are the kana it's easiest to confuse it with — same row,
  same vowel. Kana that sound the same (お/を, じ/ぢ, ず/づ) are never
  offered together.
- **Practised first:** the kana missed last time; a few mastered ones come
  up too, so they stay mastered.
- **Answers:** a right answer moves on by itself, a wrong one shows the
  answer and waits. Every answer plays the sound.

**Kanji wait for hiragana — softly.** Until hiragana is mastered, a kanji
set says so ("Kanji come after hiragana. You've mastered 34 of 71…"). It
offers today's hiragana drill, plus **Add anyway**. Kanji readings are
written in hiragana, so kanji stick far better once it's solid — but nothing
is locked.

**Katakana aids retire themselves.** The hiragana written over katakana
words (`{コーヒー|こーひー}`) is there because katakana isn't learned yet. Once
katakana is mastered it disappears everywhere — words, sentences, connector
examples, drill tiles — and kanji keep their furigana.

---

## 17. Your data — backup and restore (added with the repositioning)

All progress lives in one browser on one device (IndexedDB). Clearing the
browser's site data, losing the phone or switching browsers would lose it,
so **Settings → Your data** can save and restore everything.

**Download a backup** saves one JSON file, `wayword-backup-YYYY-MM-DD.json`,
holding everything the app stores:
- every course's cards, settings, placement, daily stats, streak,
  readings marked "I can read this", connector scores and kana mastery;
- your own words and their recordings;
- the app-wide preferences.

Where the device can hand files to the system share sheet (phones, mostly),
**Save it elsewhere…** sends it straight to Files, Drive, mail and so on.

**Restore from a backup…** reads a backup file:
- **Checked first** — a file that isn't a Wayword backup, or that comes from
  a newer version of the app, is turned away and nothing changes.
- **Then it asks**, saying when the backup was made and what it holds per
  course (cards, your own words).
- **Then it replaces** the progress of the courses in the backup. Courses
  the backup doesn't hold are left as they are.
- **Undo** — what the restore replaced is kept, so **Undo the restore** in
  Settings puts it back (one level).

**Reminders.** Once there's progress worth keeping, Today shows a *Back up
your progress* row whenever there's no backup, or the last one is more than
two weeks old. It goes straight to the section. "Last backup: 3 days ago"
shows there too.

The file is plain JSON — `{ format, version, exportedAt, namespaces: { app,
en-ja, ja-en… } }`, each namespace holding its `meta` and `srs` stores
exactly as stored — so it stays readable and can be restored by any later
version.
