# Plan: rebuild the English-for-Japanese-speakers course

*Saved October 2026 from a planning session, and updated once the first part
was built and deployed (v8). The block below the line is a prompt: paste it
into a new Claude Code session opened in this repository. It covers what's
left.*

---

Work only inside `D:\Remote work\Repositories\Wayword`; don't create, modify
or move files outside it. Use Firefox for any browser work. Make reasonable
calls and log them in `ASSUMPTIONS.md` (next entry is **A85**) — **except**
the open questions below: ask the user those first, in one message, and
don't default them. Commit after each phase, ending every commit message with
the attribution line your system prompt gives. Read `README.md` §13–§18 and
the tail of `ASSUMPTIONS.md` (A78 onwards) first.

## Goal

Finish turning the English course (`en` target, `ja` speaker, course id
`ja-en`, content in `content/en/`) into what the Japanese course became: the
same loop of words → sentences → connectors → drills → SRS, pointed at one
learner — **the user's Japanese partner**. The goals: **learn more words to
expand their vocabulary**, and **practical, everyday English** — general, not
tied to a job. Extend the existing app; don't rebuild it.

The three situations that come up most, all as the **customer**:
- *ordering food* — "I'd like the ○○, please", "Can I get the menu?", "Is this
  spicy?";
- *trying on clothes* — "Can I try this on?", "Do you have a bigger/smaller
  size?", "Where's the fitting room?";
- *asking for things* — "Can I have ○○, please?", "Could I get a bag?", "How
  much is this?"

## Done already — the first part (v8; README §18, ASSUMPTIONS A78–A84)

- **Phrases:** everything from the three situations is a card. Eight were
  added (`res-11`…`res-14`, `sho-11`…`sho-14`); ten were reworded to New
  Zealand English and the notes rewritten, ids unchanged. The groups are
  basics, food, shopping, town, travel and help, and the starters are
  greetings, numbers, restaurant and shopping.
- **Words:** `content/en/words/cafe.json`, `clothes.json` and `shopping.json`
  (73 words). Café and shopping are starters. Notes go in `registerNotes`
  (使い方) and `pitfallNote` (よくある間違い), and tags are in Japanese.
- **Phrase patterns:** seven lessons in `content/en/patterns/` (`pat-like`,
  `pat-have`, `pat-get`, `pat-doyouhave`, `pat-isthis`, `pat-where`,
  `pat-howmuch`) in the connectors' lesson format, with four examples each and
  fill and order drills. They sit under `lessonGroups` `ask` and `question`.
  The tab is named by the manifest's `copy.lessonsTitle` (フレーズの型 🧩).
- **Scenarios:**
  - New: `cafe`, `clothes`, `bakery` and `bus`.
  - Rewritten for New Zealand: `lost` and `immigration`.
  - Kept: `checkin`.
  - Removed: the subway, restaurant and shop-checkout scenarios.
- **Code:**
  - Parts of speech and word forms come from the manifest (`words: { pos,
    forms, verbForms }`).
  - The register label is optional.
  - Lesson screens use the course's language and name (`lessonsCopy()` in
    `js/shared.js`).
- **Audio:** all 252 English clips, from Google Translate TTS for now.

## Decisions already made (don't re-ask)

- **Audience:** the user's Japanese partner. Priorities, in order:
  1. words;
  2. practical phrases and patterns for everyday situations, from the
     customer's side;
  3. connectors and polite phrasing;
  4. hearing the reply.

  Keep the existing travel phrases as one group.
- **General, not staff-side.** Asked whether the partner also serves
  customers, the user said to keep it general rather than staff-focused. So
  there are no staff-side scenarios and no customer-service or shop-floor
  vocabulary.
- **English variety:** closest to **New Zealand English**. Wording and
  spelling follow NZ usage (*takeaway, flat, lift, petrol, queue, colour,
  organise, no worries*). The notes keep the American word, since that's
  what school and films teach.
- **Audio:** a more natural **neural voice**, not Google Translate's: Microsoft
  Azure Speech, with `en-NZ-MollyNeural` (female) and `en-NZ-MitchellNeural`
  (male) as the second speaker in scenarios.
  - Build-time only: the app never calls it, and the key never goes in the
    repo.
  - The key comes from the env vars `AZURE_SPEECH_KEY` and
    `AZURE_SPEECH_REGION`.
  - The Japanese course keeps its current voice.

## Open questions — ask the user before the phases they affect

1. **Where are the gaps?** Understanding the reply, saying what's wanted, or
   reading? When asked in October 2026 the answer was **not known yet**: the
   user wants to decide after the first part has been used for a while. Ask
   again before Phase 2 and Phase 4. The answer sets the build order, the size
   of the listening tab, and whether a reading or spelling track is needed.
   (The Japanese course has one because the user's own gap is reading.)
2. **Is it used on a phone, offline, when out?** If so, per-course offline
   caching (Phase 4) comes first.

## Phase 1 — the New Zealand voice

1. **Per-course voice in `tools/generate-audio.mjs`.**
   - Put the voice in the course manifest, e.g. `"voice": { "engine":
     "azure", "default": "en-NZ-MollyNeural", "speakers": { "barista":
     "en-NZ-MitchellNeural" } }`.
   - Courses without a voice stay on the current Google path.
   - Keep `--force`, `--check`, `--only` and `--course`.
   - Fail clearly, not silently, if the key is missing.
   - Check the output size before accepting a clip, as now.
2. **A "slower" button** (75% playback) on cards and drills. Use
   `audio.playbackRate` per play, not as a global setting.
3. **Checkpoint: stop and ask the user to listen** before generating
   everything. Use about six sample clips: a plain phrase, a question, and a
   scenario line in each voice. Send them with SendUserFile if the session
   supports it.
4. **Regenerate every English clip** (phrases, words, pattern examples and
   scenario lines), then bump the cache version (see Phase 5).

## Phase 2 — more vocabulary (~230 more words, general)

Add word decks under `content/en/words/`, in the shape of the three that
exist, listed under `decks` in the manifest. The order depends on open
question 1.

- **General core (~80):** everyday verbs, and the phrasal verbs that come up
  all the time — *sort out, hold on, check out, run out of, end up, figure
  out, pick up, put back*.
- **Katakana English (~50):**
  - loanwords that mean something else in English: レジ → *till/checkout*,
    クレーム → *complaint*, マンション → *flat*, コンセント → *power point*;
  - words that are said differently in English: *energy, virus, label,
    allergy*.
- **New Zealand words (~25):** *heaps, keen, reckon, sweet as, togs, dairy,
  no worries, kia ora*.
- **Money and paying (~30)**, beyond the shopping deck: GST, *insert/swipe*,
  *declined*, "card or cash?", splitting the bill.
- **Everyday sentences (~40)**, built from these words and the existing ones:
  - a `kind: "sentences"` deck, cut into `chunks` with `w` word links, so the
    sentence drills and the word↔sentence links come free;
  - mostly what the learner says as the customer, and what's said back.

New parts of speech go in the manifest's `words.pos`, with matching `pos.*`
strings in both `content/ui/*.json`.

## Phase 3 — English connectors and polite phrasing (~20 lessons)

Lessons go under `content/en/connectors/`, listed under `lessons` with new
`lessonGroups`.
- They follow the format of `content/ja/connectors/*.json`: pattern,
  explanation, natural, stiff, and 3–5 examples, each with `chunks`, `gap`,
  and optionally `combine` and `alsoOrders`.
- Explanations are **in Japanese**, with English examples as the target text,
  drawn from everyday life.

- **Polite phrasing (5):**
  - *could you / would you mind / I was wondering if*;
  - *sorry* vs *thanks* for すみません;
  - replying to thanks;
  - saying no politely as the customer (*I'm just looking, thanks*; *No
    thanks, I'm fine*);
  - *Excuse me* to get someone's attention.
- **Linking words (12):** so, because/'cause, but/though, even though,
  actually, anyway, by the way, I mean, you know, kind of, unless, as long as.
- **Word order (5):**
  - descriptions after the noun ("the one I showed you");
  - trailing phrases;
  - "it's … to …";
  - questions with do/did/have;
  - yes/no to negative questions, and tag questions.

The lessons tab is called フレーズの型. Before adding connectors, ask the user
how to name the tab: give connectors their own groups inside it, or rename it
through `copy.lessonsTitle` and `copy.lessonsTab` to cover both.

## Phase 4 — Listening tab (聞き取り) and per-course caching

The listening tab is the counterpart of the kana drill (`js/kana.js`,
`js/reading.js`). Its size depends on open question 1: if the learner already
follows replies well, build it small; if hearing is the gap, it's the
centrepiece.

- **What's said back (~80 sentences)**, at natural speed:
  - examples: *Eat in or takeaway? Would you like a bag? Sorry, we're out of
    that in a medium. The fitting rooms are at the back. That'll be
    twenty-four fifty.*
  - include reductions (gonna, dunno, lemme, whaddaya) and linking ("pick it
    up");
  - the drill: hear it, pick or build what was said, replay slowly;
  - content files go under `content/en/listening/`, listed in the manifest
    under a new key (e.g. `listening`) and validated in `tools/selftest.mjs`.
- **Sound contrasts (~8 sets of ~8 pairs):** L/R, B/V, S/TH,
  *thirteen/thirty*, *cap/cup*. The question is "Which one did you hear?".
  Pick pairs that stay distinct in an NZ accent; NZ vowels shift (*fish and
  chips*, *bed* vs *bad*).
- **Mastery per item, like kana:** right 3× in a row on 2 different days.
  - A daily 2–3 minute drill on Today, and a Listening tab.
  - Factor the question screen and the mastery rules in `js/kana.js` into
    shared pieces rather than copying them.
  - With a sixth tab, Scenarios moves into Learn (`MAX_TABS` in `js/app.js`).
- **Per-course offline caching:**
  - `sw.js` currently precaches every course (≈15 MB, heading for ≈30 MB).
    Cache only the courses the learner has opened, e.g. by having the app post
    the course id to the worker on entering a course.
  - Keep the shell, `courses.json` and the UI strings always cached.
  - Extend `tools/sw-test.mjs` and `tools/browser-check.mjs`; the latter's
    `expectedAssets` list is hand-written on purpose. The browser check must
    still prove that everything a learner has opened works offline, and that
    opening a second course downloads it.
  - Do this first if open question 2 says the learner uses it offline when
    out.
- **Checkpoint: stop and ask the user to listen** to the natural-speech
  clips. Synthetic voices mangle reductions, and the user will hear it faster
  than any test will.

## Phase 5 — verify and deploy (after each phase that ships)

- Run every suite:
  - `npm test`;
  - `npm run test:render`;
  - `npm run test:browser` (Firefox, online and offline);
  - `node tools/browser-check.mjs --upgrade-from origin/main`.
- Take phone-width screenshots of each new screen (the `tmp/shots.mjs`
  pattern: Firefox, 390 px wide, placement skipped).
- README: update §13 (the English course) and §18 (built, and what's next).
- Deploy:
  1. Bump `CACHE_VERSION` in `sw.js` (currently `v8`, so next is `v9`).
  2. Run `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 npm run deploy`.
  3. Run `node tools/browser-check.mjs --live
     https://shikomisen.github.io/Wayword/`.
- Report what was built, what was stubbed, and anything the user must do.

## Needs from the user

- An **Azure Speech key** (free F0 tier), set as `AZURE_SPEECH_KEY` and
  `AZURE_SPEECH_REGION` on this PC, before Phase 1's audio step. If it isn't
  set, build everything else and say so, rather than falling back silently.
- About ten minutes of listening at each of the two checkpoints.

## Not in scope

The user's own recordings, a neural voice for the Japanese course, and any
change to Japanese content.

## Environment notes (learned the hard way)

- **Shell and editing:**
  - The setup is Windows and Git Bash with `core.autocrlf=true`, so scripted
    edits must normalise CRLF.
  - Pass `MSYS_NO_PATHCONV=1` for arguments containing `#/…`.
  - The shell's working directory resets on each call, so `cd` in every
    command.
  - Heredocs in the Bash tool mangle backslashes, so write scripts with the
    Write tool.
  - The Edit and Write tools need a Read of the exact
    `D:\Remote work\Repositories\Wayword\…` path first.
- **Scratch work and content:**
  - Scratch work goes in `tmp/` (gitignored), never outside the repo.
  - Generate repetitive content with a throwaway script in `tmp/` that
    validates before writing; the JSON is then the source of truth.
  - The first part's generators (`tmp/build-en-slice.mjs` and its data files)
    may still be there to copy from.
- **Deploying:** `npm run deploy` pushes as the repo owner (`Shikomisen`; set
  `DEPLOY_GIT_USER` to override). Git Credential Manager holds two accounts
  and can't ask which one to use in a non-interactive session.
