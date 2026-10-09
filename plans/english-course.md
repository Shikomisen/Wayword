# Plan: rebuild the English-for-Japanese-speakers course

*Saved October 2026 from a planning session. The first part shipped as v8,
and the rest of the plan as v9 (offline, voice) and v10 (content,
listening). It's complete, apart from switching on the New Zealand voice,
which waits for an Azure key. The block below the line is a prompt for that
remaining step: paste it into a new Claude Code session opened in this
repository.*

---

Work only inside `D:\Remote work\Repositories\Wayword`; don't create, modify
or move files outside it. Use Firefox for any browser work. Log decisions in
`ASSUMPTIONS.md` (next entry is **A93**). Commit when done, ending the commit
message with the attribution line your system prompt gives. Read `README.md`
§3-audio, §5 and §18, and the tail of `ASSUMPTIONS.md` (A78 onwards), first.

## Where things stand

The English course (`ja-en`, content in `content/en/`) is rebuilt around the
user's Japanese partner. That means everyday English as the customer, New
Zealand English, and speaking first. It has:

- 250 words in 8 decks and 42 everyday sentences;
- 112 phrases;
- 30 lessons — phrase patterns, polite phrasing, linking words, word order —
  under 表現・つなぎ言葉, each with fill, order, combine and say-it drills;
- a small daily listening drill: 30 lines said back, and 18 sound pairs;
- 7 customer-side scenarios.

All 629 English clips are in Google's voice.

The New Zealand voice is wired up but off. `content/en/manifest.json` has:

```json
"voice": { "engine": "google",
           "azure": { "default": "en-NZ-MollyNeural", "speakers": "en-NZ-MitchellNeural" } }
```

`tools/generate-audio.mjs` reads `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
On Windows it also reads them from the user's saved environment, so a key
saved with `setx` works without restarting.

## The remaining step: switch on the New Zealand voice

1. Check the key is there (never print it):
   `node -e "console.log(Boolean(process.env.AZURE_SPEECH_KEY))"`. If it
   isn't, ask the user to set it up, with the steps from
   `node tools/generate-audio.mjs --course ja-en --samples`, which prints them.
2. `npm run voice:samples` makes six clips in `tmp/voice-samples/`: a
   statement, a question and a scenario line, in each voice.
   - **Stop here and ask the user to listen.** Send the clips with
     SendUserFile if the session supports it.
   - If a voice sounds wrong, change it in the manifest's `voice.azure` (see
     Microsoft's list of `en-NZ` voices), and run the samples again.
3. Once approved, run `npm run voice:nz`. It sets `"engine": "azure"` and
   remakes all 629 English clips; the free tier is plenty. If some fail,
   they're removed rather than left in the old voice, and
   `npm run audio -- --course ja-en` makes them.
4. Run every suite:
   - `npm test`;
   - `npm run test:render`;
   - `npm run test:browser`;
   - `node tools/browser-check.mjs --upgrade-from origin/main`.

   Then listen to a few clips in the app.
5. Bump `CACHE_VERSION` in `sw.js` (currently `v12`, so next is `v13` — and `VERSION` in `js/version.js` with it).
6. Deploy:
   1. Commit.
   2. `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 npm run deploy`.
   3. `node tools/browser-check.mjs --live https://shikomisen.github.io/Wayword/`.
7. Update README §3-audio, §13 and §18 (the voice is on), and log it in
   ASSUMPTIONS.

## Later (ask the user first)

- **Where are the gaps?** In October 2026 the answer was *saying what they
  want*. Ask again once the course has been used for a while. If hearing
  matters more than expected, grow the listening drill: longer and faster
  replies, reductions (*gonna, dunno, lemme*), linking (*pick it up*).
- More content follows the same shape: word decks under `decks`, lessons
  under `lessons`, listening under `listening`. The builders in `tmp/` (if
  still there) show the validate-then-write pattern.

## Environment notes (learned the hard way)

- **Shell and editing:**
  - The setup is Windows and Git Bash with `core.autocrlf=true`, so scripted
    edits must normalise CRLF.
  - Pass `MSYS_NO_PATHCONV=1` for arguments containing `#/…`.
  - The shell's working directory resets on each call, so `cd` in every
    command.
  - Heredocs, and backticks inside double quotes, get mangled or executed by
    the Bash tool, so write scripts with the Write tool.
  - The Edit and Write tools need a Read of the exact
    `D:\Remote work\Repositories\Wayword\…` path first.
  - `tools/sw-test.mjs` contains NUL characters on purpose (`'\0RESULT'`), so
    edit it with a script that splices text, not the Edit tool.
- **Scratch work:** it goes in `tmp/` (gitignored), never outside the repo.
- **Deploying:** `npm run deploy` pushes as the repo owner (`Shikomisen`; set
  `DEPLOY_GIT_USER` to override). Git Credential Manager holds two accounts
  and can't ask which one to use in a non-interactive session.
