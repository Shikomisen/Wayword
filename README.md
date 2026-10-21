# Wayword

An offline-first language-learning app for real conversation. It runs in the browser, installs to a phone's home screen, works without a connection, and keeps every bit of progress on the device.

- **Live:** https://shikomisen.github.io/Wayword/
- **Version:** v19
- **Courses:** Japanese for English speakers, and English for Japanese speakers. Indonesian is planned.

This README is the complete description of the project: what it does, how it's built, the content format, the learning rules, storage, audio, offline behaviour, and how to run, test, deploy or port it. It describes what is true now. The design rationale and project history are kept in the maintainer's private notes, outside this repository.

## Contents

1. [Overview](#1-overview)
2. [Features](#2-features)
3. [Courses and content](#3-courses-and-content)
4. [Architecture](#4-architecture)
5. [Repository layout](#5-repository-layout)
6. [Content schema](#6-content-schema)
7. [Learning engine](#7-learning-engine)
8. [Storage and backups](#8-storage-and-backups)
9. [Audio](#9-audio)
10. [Offline and updates](#10-offline-and-updates)
11. [Running, testing and deploying](#11-running-testing-and-deploying)
12. [Platform notes](#12-platform-notes)
13. [Porting to another platform](#13-porting-to-another-platform)
14. [Roadmap](#14-roadmap)

---

## 1. Overview

Wayword teaches the language you need to talk with people. Words come first, then whole sentences, then the connectors and patterns that chain sentences into conversation. Spaced repetition (SM-2) decides what to review each day. Reading practice and a listening drill support that where a course needs them.

**Principles**

- **Conversation first:** words, then sentences, then connectors and patterns, then scenarios. Every item has audio.
- **Spaced repetition:** flashcards are scheduled by SM-2. Drills feed the review deck but never move the schedule themselves (§7.6).
- **Offline-first:** the app installs in seconds. Each course downloads the first time it's opened, and from then on works with no connection (§10).
- **Private by construction:** there are no accounts, no server, no analytics and no third-party requests at runtime. Progress stays in the browser, and the only way out is a backup file the learner saves (§8).
- **Content is data:** courses, decks, lessons and interface strings are JSON files listed in manifests. Adding content, or a whole language, needs no app code (§6).
- **No build step:** plain HTML, CSS and native ES modules, served exactly as committed (§4).

**Who each course is shaped around**

| Course | The learner | Priorities, in order |
|---|---|---|
| Japanese, for English speakers (`en-ja`) | An English speaker who understands and speaks reasonably well but reads weakly: hiragana still shaky, katakana not yet learned | 1. Remember words and know what to say. 2. Chain them into sentences with connectors (て, から, けど, たら…). 3. Read: solid kana first, then kanji, with furigana that fades as reading improves |
| English, for Japanese speakers (`ja-en`) | A Japanese speaker who wants practical, everyday English, starting with the times they're the customer: ordering food, trying on clothes, asking for things | 1. Words first. 2. Practical phrases and patterns ("I'd like ○○, please"). 3. Connectors and polite phrasing. 4. Hearing real replies. It uses New Zealand English, and speaking comes first, so listening is a small daily drill |

Controls a course can't use don't appear: the English course has no furigana and no Reading tab.

**Levels.** Each course is divided into levels, and the learner is always at one of them (§7.10):

| Level | For | Roughly |
|---|---|---|
| **First steps** | Someone brand new to the language: the first words and phrases, and how a sentence is built (particles, です and ます; or be-verbs, a and the, the present and past) | CEFR A1; before JLPT N5 |
| **Basic** | Getting by: everyday words, set phrases for shops, stations and hotels, connectors, polite phrasing, and (in Japanese) the first kanji | A2; JLPT N5 |
| **Intermediate** | Real conversation: talking about yourself, your plans and opinions, reacting as you listen, polite Japanese (keigo) for a partner's family, and sorting out problems at the doctor, a hotel or a shop | B1; JLPT N4 into N3 |

The equivalences are approximate: the levels are built around what a learner can do, not around an exam. The Japanese course has all three levels; the English course has First steps and Basic, and its Intermediate level is planned (§14).

- **Placement** suggests where to start, and the learner can pick another level.
- **Learn** shows one level at a time.
- **Today** shows how far through their level the learner is, and offers the next deck when new cards run low.

---

## 2. Features

### 2.1 Language picker

- `#/` opens on every launch. **I speak** (English or 日本語) relabels the page and lists the courses taught from that language.
- Each course card shows where the learner is: cards due today, not started, or coming soon.
- The speaker defaults to the device language if the app teaches from it, otherwise English, and it's remembered.
- Inside a course, a slim bar ("‹ Languages · English › Japanese") leads back, and Settings has a Language row.
- The version shows at the foot of the picker ("Wayword v19") and in Settings → About.

### 2.2 Placement

The first visit to a course runs a short placement quiz.

- It takes two cards from each phrase category (its easiest and its hardest), plus two from each character set: 30 items for Japanese, 20 for English. A level marked `placement: false` isn't sampled, which keeps the quiz short: Japanese Intermediate isn't, so the quiz covers First steps and Basic.
- Each is self-graded as **I know this**, **I'd recognise it** or **New to me**. Nothing is typed, and nothing is scored against the learner. The answers decide where cards enter the review deck (§7.4).
- **Where to start:** the results suggest a level from the overall score (§7.10), and show every level to pick from instead, each with its description.
- Afterwards, the chosen level's `starter` decks are added to study.

### 2.3 Today

Top to bottom:

1. What's due, four stats (due, new, done today, day streak) and **Start review**, with a breakdown: to review · relearning · new.
2. **Your level** (§7.10): its name, how many of its items are learned and how many of its lessons practised, with a bar. Under it, one of these:
   - **Ready for the next level**, once the level is learned, with **Move up**. Moving up makes it the learner's level and adds its starter decks.
   - **Next step:** the next deck on the level's path, with **Add**, whenever fewer new cards are waiting than one day's limit.

   A course without levels shows a nudge to add a word deck instead, if it has word decks and none is in study.
3. The daily extras:
   - **Reading:** the kana drill until both scripts are mastered, then the character deck.
   - **The course's lessons:** the level's next lesson to practise, and how many of the level's lessons have been practised. Once they all have, mixed practice.
   - **Listening,** where the learner's level (or one below it) has something to hear.
4. **Back up your progress**, once there's progress and no backup in the last 14 days.
5. **In your deck:** every deck in study, with its progress.
6. A seven-day forecast of reviews, and a way into Learn.

### 2.4 Learn: decks

Learn lists word decks, sentence decks, phrase categories (under the course's topic groups), Your own words, Listening (where the course has it, at the learner's level or below), and Scenarios when they have no tab (§4.5).

- **One level at a time.** A row of level buttons sits at the top, with the shown level's description. Learn opens on the learner's level; the decks, sentences and phrase categories listed are that level's.
- **Another level** can be shown with its button. The learner's own level stays underlined, and **Make this my level** switches to the one shown. The lessons list (§2.6) shows the same level.

- **Word decks:** each word has its meaning, its part of speech and a usage note where one helps. A Japanese verb also shows its ます and て forms. A word card lists the sentences it appears in.
- **Sentence decks:** short sentences built from the word decks. Each is cut into pieces linked to the words they use, and a sentence card lists its words.
- **Phrase categories:** set phrases for situations.
  - Japanese phrases carry a **Polite** or **Casual** badge.
  - The **Casual Speech** set pairs each casual phrase with its polite version, shown underneath with its own audio, plus a note on when each fits. Casual is for partners, friends and family; polite is for staff, strangers and, at first, a partner's family.
- **Your own words:** anything the learner wants to learn, such as something heard at dinner or a word they looked up.
  - Japanese readings can be typed inline as `{漢字|かんじ}`, or given as a kana reading that the app spreads over the kanji.
  - Audio comes from the device's own on-device voice, or from a recording made on the spot. With neither, the card says **No audio** and gets no Listen card.
  - Nothing is sent to an online service.
- **Paste a message** (in a course with a dictionary: Japanese). **📋 Paste a message**, on Your own words, takes a whole message, such as a text from a friend.
  - **Find the words** keeps the message and shows it sentence by sentence, with every word the course's dictionary knows underlined. Particles are quieter, and words already yours are marked.
  - Tapping a word opens its entry under its sentence:
    - the dictionary form, with its reading (食べなかった → 食べる, "negative, past");
    - what kind of word it is, and its meanings to choose from;
    - whether it's already yours, or also in the course;
    - other ways to read the same spot (今日 + は, or 今日は, "hello").
  - **＋ Add to my words** adds it in one tap, with its reading, furigana and chosen meaning filled in, and the sentence it came from as its note. **Edit first** opens the add form, filled in.
  - **＋ Add this sentence** opens the add form with the sentence and its suggested furigana. The meaning is the learner's to write.
  - **Your messages** keeps each message on the device, with how many words and sentences were added from it, until it's deleted. Deleting a message keeps the words added from it.
  - It all works offline: the dictionary downloads with the course (§6.14). A message pasted before that is kept, shown as plain text with a note, and gets its words once the dictionary arrives.
  - The dictionary's credit is at the foot of these screens and in Settings → About.
- **Adding and taking out decks:** **Add** puts a deck into study, and its row then shows **✓ In deck**.
  - Tapping it again takes the deck out, after a confirmation. Taking a deck out parks it: its cards keep their progress but stop coming up.
  - Adding it again carries on where it left off.

### 2.5 Flashcards

- **Card types** (Settings → Card types). Each type is a separate card (§7.1):
  - **Recognise:** see and hear the target language, recall the meaning.
  - **Say it:** see the meaning, say it aloud, then check.
  - **Listen:** hear it, recall what was said.

  Recognise and Say it are on by default; Listen is off.
- **Grading:** after revealing, **No idea / Shaky / Got it / Too easy**, each showing when the card would come back. A failed card returns later in the same session.
- **Reading aids (Japanese):**
  - Furigana has three modes: **Always**, **Tap to show** (the reading is in place but invisible until tapped) and **Hidden**. Set it in Settings, or cycle it from the ふりがな chip.
  - Romaji has the same three modes, set in Settings or cycled from the romaji chip. Phrases, characters and everything at First steps (its words, sentences and grammar examples) carry romaji, so a brand-new learner can follow before reading kana. From Basic on, words and sentences have furigana only.
    - On Tap to show, each romaji line keeps its place, blank until tapped. In the kana chart, tapping a character plays it and shows its romaji.
    - A week after the course was first opened, Always changes once to Tap to show, and the app says so.
  - **I can read this**, on the back of a card, drops that item's furigana and romaji to Tap to show everywhere it appears.
  - The hiragana written over katakana words disappears once katakana is mastered (§7.8).
- **Audio:** every 🔊 has a 🐢 beside it that replays the clip at 0.75× with the pitch kept. Settings can play audio automatically when a card is revealed.
- **Keyboard (desktop):** Space or Enter reveals the answer; 1–4 grade it.

### 2.6 Lessons and drills

Each course has a lessons tab, named by its manifest. Like Learn, it shows one level at a time (§2.4):
- **Grammar and connectors** in the Japanese course (the tab says Grammar): 62 lessons.
  - **First steps, 20 lessons:**
    - *Particles: building a sentence:* です, は, が, を, に, で, から〜まで, の, も, と ("and, with"), か.
    - *Verbs and adjectives:* the ます forms, い- and な-adjectives, ある・いる, 〜たい, 〜ましょう・〜ませんか, 〜ている, the plain and ない forms, the plain past (〜た).
  - **Basic, 16 lessons,** one per connector: 〜て, そして, それから, から, ので, だから, けど, が, でも, と, たら, ば, とき, ながら, し, ために.
  - **Intermediate, 26 lessons,** with furigana and no romaji:
    - *Verb forms that say more:* 〜てみる, 〜てしまう, 〜ておく, 〜たことがある, 〜つもり, the potential (〜られる), 〜ようになる, 〜ことにする.
    - *Allowed, must and needn't:* 〜てもいい, 〜てはいけない, 〜なければならない and 〜なくてもいい.
    - *Giving and receiving:* あげる・くれる・もらう, and favours with 〜てくれる・〜てもらう.
    - *Saying what you think and hear:* 〜と思う, quoting with 〜って, かもしれない and でしょう, 〜そう (looks like), 〜みたい and らしい.
    - *Nuance in conversation:* 〜んです, よ and ね, のに, 〜ても, 〜すぎる・〜やすい・〜にくい, comparing with より, ほう and 一番.
    - *Polite Japanese (keigo):* respectful verbs (いらっしゃる, 召し上がる…) and humble ones (いたします, 申します…).
- **表現・文法** in the English course (the tab says 表現): 48 lessons.
  - **First steps, 18 lessons** (はじめての英語), explained in Japanese:
    - *文の基本:* am / is / are, not and questions, this and that, a and the, plurals, my and your, there is, in / on / at for places and for times.
    - *動詞の基本:* the present simple, don't and doesn't, can, the present continuous, the past with -ed and the irregular past, question words, want to, please and don't.
  - **Basic, 30 lessons:** phrase patterns, polite phrasing, linking words and word order.

**A lesson** has:
- the pattern;
- a plain explanation;
- **Sounds natural** and **Sounds stiff or wrong** notes;
- 3–5 example sentences with audio.

In the Japanese course, Japanese quoted in the pattern and the prose carries furigana.

**Drills** run from *Practise* on a lesson, or *Mixed practice* across the lessons done so far.

| Drill | The learner | Notes |
|---|---|---|
| Fill the gap | sees the meaning and the sentence with a gap, and picks the connector or the form before it | "Also right" answers count, with a note on the difference |
| Put it in order | taps the sentence's pieces in order | Alternative orders are accepted |
| Join them | builds one sentence from two | Trap pieces are mixed in with the real ones |
| Say it (English course) | says the sentence aloud first, then reveals it with 🔊🐢 | Then answers *I said it* or *Not yet* |

After every answer the learner sees the full sentence and its audio, and why, if they were wrong.

**Missed drills feed the reviews.**
- The missed sentence joins the review deck with its Say it card failed, so it comes back within minutes.
- The lesson becomes a deck holding just the missed sentences. *Study as cards* adds the rest.
- Right answers don't touch the schedule (§7.6).
- Each session's score is kept per lesson, and the best one shows on the list.

### 2.7 Reading (Japanese)

The **Reading** tab covers the writing system. It has five sets:
- **Hiragana:** 104 characters.
- **Katakana:** 116 characters.
- **Kanji in Your Words:** the 70 kanji behind the word decks.
- **Common Kanji:** 82 kanji from everyday signs, such as exits, platforms, prices and warnings.
- **More Kanji:** 124 kanji that the Intermediate content uses most and the other sets don't teach: health, travel, plans and the polite phrases.

What the tab does:
- **Levels:** the sets are listed under their level. The kana are First steps, Kanji in Your Words and Common Kanji are Basic, and More Kanji is Intermediate.
- **Browsing:** kana show as the traditional grid and kanji as lists grouped by use. Tapping any character plays it. Each kanji links to the words, sentences and phrases it appears in.
- **Kana mastery** is tracked per character and per script, and shown at the top of the tab (§7.7).
- **The daily kana drill** takes about two minutes and appears on Today and in Reading until both scripts are mastered.
  - Hiragana comes first, then katakana.
  - New kana arrive a row at a time, on an intro screen.
  - There are two kinds of question: *What does it say?* (see the kana, pick its sound) and *Which one did you hear?* (hear it, pick the kana).
- **Kanji wait for hiragana, softly.** Until hiragana is mastered, a kanji set says so, offers the hiragana drill, and shows **Add anyway** instead of Add.
- **Character cards** have their own review queue and daily limit, separate from everything else.
- **Writing is out of scope.** Handwriting and stroke-order practice are left out on purpose: the app teaches reading.

### 2.8 Listening drill

About ten questions a day, on Today and in Learn, in both courses. It has no tab of its own. There are two kinds of question:
- **What did they say?** A line someone says to the learner. The learner picks its meaning from three, then sees what they could answer.
- **Which one did you hear?** One word of a pair that's easy to confuse. The learner picks which one it was.

| Course | Lines said back | Sound pairs |
|---|---|---|
| English | 30, at a counter, a café or on a bus, in New Zealand English (*Eat in or takeaway?*, *Are you right there?*). Basic | 18 that Japanese doesn't tell apart: L/R, B/V, S/TH, and *fifteen / fifty*. First steps |
| Japanese | 32 that staff and friends say, at natural speed and in polite Japanese (ポイントカードはお持ちですか, 割り勘でいい？). Intermediate | 15 that English speakers miss: long vowels (おばさん / おばあさん), the small っ (きて / きって), and つ against す. Basic |

Items are mastered by the same rule as kana (§7.7). Listening content never enters the review deck.

The drill draws on the learner's level and the levels below it. Where those have nothing to hear yet (a Japanese learner at First steps), Today and Learn don't show listening.

### 2.9 Scenarios

Scenarios are branching conversations.
- **How they work:** the other person speaks, with audio, and the learner picks one of two or three replies. Each reply is marked good, awkward or wrong, with feedback on why.
- **Awkward isn't a dead end:** an awkward reply doesn't end the scenario. It explains what landed oddly and carries on.
- **Audio:** a reply that is a phrase from the course plays that phrase's audio.

| Course | Scenarios |
|---|---|
| Japanese (13) | **Basic:** a convenience-store checkout, buying a train ticket, an immigration desk, hotel check-in, ordering at a restaurant, asking the way, at the pharmacy, chatting with a neighbour. **Intermediate**, with furigana and no romaji: dinner with a partner's family, making weekend plans, at a clinic, staying at a ryokan, when the order is wrong |
| English (7) | All as the customer: a café, a clothes shop, a bakery, the bus, asking the way, immigration, hotel check-in. Every reply gets Japanese feedback |

Picking a reply doesn't move any card's schedule (§7.6). The scenario list puts each scenario under its level.

### 2.10 Your data

Settings → Your data:
- **Download a backup** saves one JSON file holding everything the app stores:
  - every course's cards, settings, placement, stats, lesson scores and mastery records;
  - your own words and their recordings, and the messages kept by Paste a message;
  - the app-wide preferences.

  **Save it elsewhere…** sends the file to the system share sheet, where the device supports it.
- **Restore from a backup…**
  1. Checks the file.
  2. Shows when it was made and what it holds per course, and asks.
  3. Replaces only the courses that are in the file.

  **Undo the restore** puts back what it replaced (one level).
- It also shows when the last backup was made, which storage the browser is using, and whether this course is saved for offline use.

The file format is in §8.4.

### 2.11 Settings

- Language
- Furigana and romaji: Always, Tap to show or Hidden (Japanese)
- Card types
- Auto-play audio
- New cards (default 10)
- New characters (default 15, Japanese)
- Text size (0.85× to 1.6×, for every course)
- Connection: Online or Offline, for every course (§2.13)
- Deck counts
- Your data
- About: the version and **Check for updates**. **Update now** appears only once an update is ready. A course with a dictionary also credits it here (§6.14)
- **Reset this course**, which clears that course only

### 2.12 Updates

An open app checks for a new version whenever it comes back to the foreground. Once one has installed, a bar says **"A new version of Wayword is ready."**, with two buttons:
- **Update now** reloads into it.
- **Not now** puts the bar away for this visit. Settings → About then offers **Update now**, and the next time the app starts, it starts on the new version anyway.

Nothing reloads in the middle of a session (§10.5).

### 2.13 Online and offline

Settings → Connection has two modes, and the choice applies to every course:
- **Online** (the default): the app uses the internet when it answers within 10 seconds, and what's on the device when it doesn't.
  - Wi-Fi with no internet behind it doesn't fail a request; it leaves it hanging. After 10 seconds the app opens from the device instead of showing a blank screen, and says it's working offline.
  - It then stops waiting on the network until it's next opened.
- **Offline:** only what's on the device. The app opens straight away, doesn't check for updates and doesn't download anything. A course that isn't on the device yet offers **Go online**.

How it works is in §10.6.

---

## 3. Courses and content

| Course | id | Status | Content | Audio |
|---|---|---|---|---|
| Japanese, for English speakers | `en-ja` | available | `content/ja/` | `audio/ja/`: 1,725 clips, 22.6 MB |
| English, for Japanese speakers | `ja-en` | available | `content/en/` | `audio/en/`: 846 clips, 11.7 MB |
| Indonesian, for English speakers | `en-id` | planned (placeholder screen) | — | — |
| Indonesian, for Japanese speakers | `ja-id` | planned (placeholder screen) | — | — |

| | Japanese (`en-ja`) | English (`ja-en`) |
|---|---|---|
| Words | 471 in 23 decks | 395 in 14 decks |
| Sentences | 66 in 3 decks | 42 |
| Phrases | 262 in 17 categories, 51 of them casual, each with its polite version | 112 in 10 categories |
| Lessons | 62: 46 grammar lessons and 16 connectors; 248 examples (25 can be joined) | 48: 18 grammar lessons and 30 others; 192 examples (12 can be joined) |
| Characters | 496: hiragana 104, katakana 116, kanji 70 + 82 + 124 | — |
| Listening | 32 lines and 15 sound pairs | 30 lines and 18 sound pairs |
| Scenarios | 13 | 7 |
| Dictionary, for Paste a message | 22,645 common words (JMdict, §6.14) | — |

**By level** (§7.10):

| Level | Japanese | English |
|---|---|---|
| First steps | 92 words in 5 decks; 16 sentences; 58 phrases in 3 categories; 20 grammar lessons; hiragana and katakana | 145 words in 6 decks; 24 phrases in 2 categories; 18 grammar lessons; the sound pairs |
| Basic | 125 words in 8 decks; 129 phrases in 8 categories; 16 connector lessons; two kanji sets; the sound pairs; 8 scenarios | 250 words in 8 decks; 42 sentences; 88 phrases in 8 categories; 30 lessons; the lines said back; 7 scenarios |
| Intermediate | 254 words in 10 decks; 50 sentences in 2 decks; 75 phrases in 6 categories; 26 grammar lessons; More Kanji; the lines said back; 5 scenarios | planned (§14) |

These are the counts for v19. `npm test` prints them as it validates.

**Japanese, for English speakers.** Each level is listed in next-step order (`step`). Decks marked \* are its starters, added by placement or by moving up.

- **First steps:**
  - *Phrases:* Greetings & Politeness 24\*, Numbers, Time & Money 24\*.
  - *Words:* People & Family 18\*, Everyday Verbs 20\*, Little Words 16\*.
  - *Sentences:* Everyday Sentences 16.
  - *Words:* Things Around You 20, Time & Days 18.
  - *Phrases:* Small Talk 10.
  - Hiragana and katakana, and the 20 grammar lessons (§2.6).
  - Everything at this level carries romaji (§2.5).
- **Basic:**
  - *Phrases:* Casual Speech 39\*.
  - *Words:* Food & Drink 18\*, Home & Daily Life 17, Describing Things 18\*.
  - *Phrases:* Restaurants & Ordering 10\*, Shopping & Payments 10\*.
  - *Words:* Places & Getting Around 15.
  - *Phrases:* Transportation 20, Directions & Getting Lost 10.
  - *Words:* Feelings & Health 16, Weather & Seasons 14, Work & Study 14, Free Time 13.
  - *Phrases:* Emergencies & Health 10, Airport & Immigration 20, Hotel Check-in / out 10.
  - The connector lessons, in five groups:
    - And, and then (〜て, そして, それから);
    - Because and so (から, ので, だから);
    - But (けど, が, でも);
    - If and when (と, たら, ば, とき);
    - While, what's more, in order to (ながら, し, ために).
  - Kanji in Your Words and Common Kanji, the listening sound pairs, and eight scenarios (the six travel ones, the pharmacy and a neighbour).
- **Intermediate:** furigana and no romaji throughout.
  - *Words:* More Verbs 27*.
  - *Phrases:* Reactions & Listening 12*.
  - *Words:* Feelings & Reactions 25*.
  - *Sentences:* Talking About Yourself 25.
  - *Words:* People & Social Life 25.
  - *Phrases:* Plans & Invitations 12.
  - *Words:* Time & How Often 25, More Describing Words 26.
  - *Phrases:* Opinions & Agreeing 12.
  - *Words:* Opinions & Ideas 25, Travel & Sightseeing 26.
  - *Sentences:* Out and About 25.
  - *Phrases:* Meeting the Family 13.
  - *Words:* Health & the Doctor 25.
  - *Phrases:* The Doctor & Pharmacy 13.
  - *Words:* Home & Everyday Life 25, Shopping & Money 25.
  - *Phrases:* Problems & Complaints 13.
  - The 26 grammar lessons (§2.6), More Kanji, the listening lines, and five scenarios.
- **Phrase groups:** Everyday basics, Out and about, Travelling, If something goes wrong, Real conversations, Life in Japan.
- **Kanji not taught yet:** 227 kanji used in the words, sentences and lesson examples aren't taught by any set, most of them once or twice. `npm run crossref` lists them, most frequent first.

**English, for Japanese speakers.** In next-step order; \* marks a level's starters. Titles are given in English here; the app shows them in Japanese.

- **First steps:**
  - *Phrases:* greetings 12\*, numbers, time and money 12\*.
  - *Words:*
    - people and family 25\*, first verbs 25\*;
    - little words (I, you, this, what…) 20, things around you 25;
    - time, days and weather 25, describing words and colours 25.
  - The 18 はじめての英語 lessons (§2.6), and the listening sound pairs.
- **Basic:**
  - *Phrases:* café and restaurant 14\*, shopping and paying 14\*.
  - *Words:* café and food 25\*, shops and paying 25\*, everyday verbs 45\*, clothes and sizes 23.
  - *Sentences:* everyday sentences 42.
  - *Phrases:* small talk 10, trains, buses and taxis 10, asking the way 10.
  - *Words:* money 27, phrasal verbs 32.
  - *Phrases:* hotel 10, airport and immigration 10, emergencies and health 10.
  - *Words:* katakana English that means something else 44, New Zealand words 29.
  - The 30 lessons below, the listening lines, and the seven scenarios.
- **Basic lesson groups:**
  - お願いする: *I'd like…*, *Can I have…?*, *Could I get…?*
  - たずねる: *Do you have…?*, *Is this…?*, *Where's…?*, *How much…?*
  - ていねいに頼む・断る (6 lessons): *Could you…?*, *Would you mind…?*, *Is it OK if I…?*, saying no, *Excuse me / Sorry*, *You too!*
  - つなぎ言葉 (12 lessons): *so, because, but / though, even though, actually, anyway, by the way, I mean, you know, a bit / kind of, unless, as long as*
  - 語順・質問の形 (5 lessons): *the one I…*, *Do / Does / Did…?*, tag questions, yes/no to negative questions, *It's … to …*
- **The language:**
  - It's New Zealand English throughout (*takeaway*, *the bill*, *power point*, *on special*), with the American word given in the notes.
  - Every item has a Japanese gloss.
  - Phrases carry a 使い方 (usage) note, and many words and phrases a よくある間違い (common mistake) note on katakana English and direct-translation traps.
  - The interface and every note are in Japanese.

---

## 4. Architecture

### 4.1 Stack

| Layer | What |
|---|---|
| App | Plain HTML, CSS and native ES modules: `index.html`, `css/styles.css`, `js/*.js`. No framework, no bundler, no runtime dependency |
| Routing | Hash routes: `#/`, and `#/<course>/<screen>` (§4.3). The deploy path never reaches the router, so every path stays relative |
| Rendering | Each screen render clears `#app` and rebuilds it from the DOM helpers in `js/render.js` |
| Storage | IndexedDB, one database per course, with a localStorage fallback (§8) |
| Scheduling | SM-2, in `js/srs.js` (§7.2) |
| Content | Static JSON, with one manifest per course (§6) |
| Audio | Pre-generated MP3s, committed to the repo (§9) |
| Offline and install | A service worker and a Web App Manifest (§10) |
| Hosting | GitHub Pages, from `main` / root (§11.5) |
| Tooling | Node ≥ 18 scripts in `tools/`. `jsdom` and `puppeteer-core` are dev dependencies for the tests only |

### 4.2 Modules

All in `js/`. Screens talk to `deck.js`, never to `store.js` directly.

| Module | Responsibility |
|---|---|
| `app.js` | Boot, the router, the chrome (course bar, tab bar, update bar), and the Today, Learn, deck, study and Settings screens |
| `course.js` | The course registry (`content/courses.json`), the active course and app-wide preferences. Entering a course switches storage, interface language and content together, and applies each language's font stack |
| `content.js` | Loads a course's manifest and files, and gives every item the generic fields (§6.1). Also attaches your own words, and loads scenarios on demand |
| `deck.js` | The bridge between content, SRS and storage: settings, active and parked decks, adding cards, grading, stats, streak, drill records, saved messages, and the learner's level |
| `levels.js` | A course's levels (§7.10): which level each deck is in, a level's progress, the next step, the suggested starting level. Pure logic |
| `srs.js` | SM-2: the card record, grades, card kinds and directions, queue building |
| `store.js` | Persistence: an IndexedDB database per namespace, with a localStorage fallback |
| `i18n.js` | Interface strings (`t()`), plurals, the date locale, and the built-in boot-error strings |
| `render.js` | DOM helpers, `<ruby>` furigana rendering, the furigana and romaji modes, note blocks, the polite version, toasts |
| `ruby.js` | Furigana notation: inline `{漢字|かんじ}` to segments and back, readings, kanji detection, reading alignment |
| `audio.js` | Clip playback, 🐢 at 0.75×, the device voice, microphone recording |
| `shared.js` | Helpers shared by screens: the header, `playItem`, adding and taking out decks, the reading-aid chips, `lessonsCopy()` |
| `home.js` | The language picker (`#/`), the placeholder screen for a planned course, the version footer |
| `quiz.js` | The placement quiz and its seeding |
| `study.js` | The flashcard session, in all three directions |
| `mine.js` | Your own words: the list, the form (which can open filled in, from a pasted message), the device voice, recordings |
| `paste.js` | Paste a message: the paste screen, saved messages, a message's words and the word sheet, and the dictionary's credit |
| `dictionary.js` | A course's offline dictionary (§6.14): loading and indexing it, the inflection rules, longest-match lookup, cutting a message into words, readings and suggested furigana. Pure logic, apart from loading the file |
| `connectors.js` | The lessons list, a lesson, and practice sessions |
| `drills.js` | Drill construction, session ordering and answer checks. Pure logic |
| `characters.js` | Character sets: charts, lists, adding and taking out sets |
| `reading.js` | The Reading tab: the kana panel, the kana drill, the kanji gate, katakana aid retirement |
| `kana.js` | Kana mastery and kana-drill construction. Pure logic |
| `listening.js` | Listening-drill construction. Pure logic |
| `listen-drill.js` | The listening screens |
| `mastery.js` | The shared mastery rule (right 3 times in a row, on 2 different days) and practice ordering |
| `choice.js` | The multiple-choice question card shared by the kana and listening drills |
| `scenario.js` | Branching scenario dialogues |
| `backup.js` | Backup export, validation, restore and undo |
| `offline.js` | Messages to the service worker (`keep-courses`, `course-status`, `connection`), and the connection mode (§10.6) |
| `updates.js` | Update checks on returning to the foreground (not in offline mode), and spotting a new version taking over |
| `version.js` | `VERSION`, which must equal `CACHE_VERSION` in `sw.js` |

### 4.3 Routes

Every screen except the picker lives under its course, e.g. `#/en-ja/browse`.

| Route (after `#/<course>`) | Screen |
|---|---|
| `/` | Today |
| `/browse` | Learn |
| `/category/<id>` | A deck: a phrase category, or a word or sentence deck. A lesson id redirects to `/connectors/<id>`, and `mine` redirects to `/mine` |
| `/study/<id>` | Study one deck. It adds the deck, and any of its missing cards, first |
| `/review` | Review everything due |
| `/mine`, `/mine/new`, `/mine/<id>` | Your own words: the list, adding one, editing one |
| `/mine/paste`, `/mine/paste/<id>` | Paste a message, with the saved messages; one message and its words (a course with a dictionary) |
| `/connectors`, `/connectors/<id>` | The lessons list; a lesson |
| `/connectors/<id>/practice`, `/connectors/mixed` | Practising one lesson; mixed practice |
| `/listening`, `/listening/drill` | The listening section; today's drill |
| `/scenarios`, `/scenario/<id>` | The scenario list; a scenario |
| `/characters`, `/characters/<id>`, `/characters/<id>/study` | Reading; a character set; studying it |
| `/characters/review`, `/characters/drill/hiragana`, `/characters/drill/katakana` | Character review; a kana drill |
| `/settings`, `/settings/data` | Settings; Settings scrolled to Your data |

How unmatched routes are handled:
- A section a course doesn't have (characters, connectors, listening, Paste a message) isn't routable, and falls back to Today.
- A path with no course (`#/review`, `#/browse`, such as an older home-screen shortcut) opens in the course used last, or Japanese if there isn't one. An unknown path goes to the picker.
- A planned course shows a placeholder screen.
- The first visit to a course goes to placement.

### 4.4 Boot and data flow

1. `index.html` loads `js/app.js` as a module.
2. `boot()` runs these steps:
   1. readies audio for iOS (the first tap unlocks playback);
   2. starts watching for updates;
   3. tells the service worker the connection mode (§10.6);
   4. sets the interface language from the saved speaker, or the device language;
   5. applies the text size and routes;
   6. if the worker answers that this launch's page came from the device because the connection didn't answer in time, shows a toast saying the app is working offline;
   7. asks the service worker to keep every course started on this device (§10.3).
3. After `boot()` settles, whether or not it failed, the service worker is registered with `register('sw.js')`, a document-relative path. A failed boot shows an error screen with Reload.
4. Entering a course (`course.setCourse`) does these, in order:
   1. points storage at that course's database;
   2. switches the interface to the speaker's language;
   3. loads the content and draws the tab bar;
   4. asks the worker to keep the course, with a toast when it's newly downloaded;
   5. remembers the last course and speaker;
   6. moves romaji from Always to Tap to show after the first week;
   7. adds cards for any newly enabled card type;
   8. updates the katakana aids.
5. Studying: `deck.js` builds the queue from the active decks, `srs.js` schedules each grade, and the results go to the course's `srs` and `meta` stores.

### 4.5 Navigation

Each course has a tab bar of at most five tabs: Today, Learn, the lessons tab (if any), Reading (if the course has character sets), Scenarios (if any) and Settings. When a course would have more than five, Scenarios moves into Learn.

| Course | Tabs | Elsewhere |
|---|---|---|
| Japanese | Today · Learn · Grammar · Reading · Settings | Scenarios are in Learn |
| English | 今日 · 学ぶ · 表現 · 会話練習 · 設定 | Listening is in Learn and on Today |

The lessons tab's title, label, icon and intro come from the manifest's `copy`. The interface language follows the course's speaker.

---

## 5. Repository layout

```text
Wayword/
├── index.html          app shell: loads js/app.js; static tab links as a fallback for the
│                       first launch after an update (§10.5)
├── app.webmanifest     install metadata: name, icons, standalone, portrait, shortcuts
├── sw.js               the service worker; CACHE_VERSION (§10)
├── .nojekyll           tells GitHub Pages to serve the files as they are
├── css/styles.css      one stylesheet: dark by default, light under prefers-color-scheme,
│                       sizes driven by --text-scale
├── js/                 32 ES modules (§4.2)
├── content/
│   ├── courses.json    languages, speakers, courses (§6.2)
│   ├── ui/             interface strings: en.json, ja.json (§6.11)
│   ├── ja/             Japanese, for English speakers: manifest.json, 17 phrase categories,
│   │                   5 character sets, words/ (23), sentences/ (3), grammar/ (46),
│   │                   connectors/ (16), listening/ (2), scenarios/ (13), and dictionary.json
│   │                   (JMdict, CC BY-SA 4.0, §6.14)
│   └── en/             English, for Japanese speakers: manifest.json, 10 phrase categories,
│                       words/ (14), sentences/ (1), grammar/ (18), patterns/ (7),
│                       connectors/ (23), listening/ (2), scenarios/ (7)
├── audio/
│   ├── ja/             1,725 clips: phrases at the top level; casual/ chars/ connectors/
│   │                   grammar/ listening/ scenario/ sentences/ words/
│   └── en/             846 clips: phrases at the top level; connectors/ grammar/ listening/
│                       patterns/ scenario/ sentences/ words/
├── icons/              192, 512, maskable 512 and 180 (apple-touch) PNGs, from tools/make-icons.mjs
├── tools/              Node scripts: dev server, generators, test suites, deploy (§11.2)
├── package.json        npm scripts; dev dependencies jsdom and puppeteer-core
└── README.md           this file
```

`node_modules/` and `tmp/` (scratch space for the tools) are gitignored. So are the maintainer's private notes and `CLAUDE.md`, which never go in this public repository.

---

## 6. Content schema

### 6.1 Rules for all content

- **`schemaVersion: 1`** is in every content file. If a manifest declares a newer version, the app warns and renders it anyway.
- **Field names.** Each course's files use field names that read naturally (`japanese`, `english`…). The manifest's `fields` map says which field holds the text being learned and which holds the gloss. The loader then adds generic fields to every item, and screens use only those:

  | Generic field | What it holds |
  |---|---|
  | `target` | The text being learned |
  | `ruby` | Furigana segments, or null |
  | `reading` | Romanisation, or null |
  | `meaning` | The gloss, in the learner's language |
  | `notes` | `[{ label, text, style }]`, from `noteFields` |
  | `targetLang`, `meaningLang` | The language codes of the two |
- **Ids** are unique within a course. Two courses may share an id (both have `gre-01`), because each course has its own storage. The conventions:

  | Content | Ids |
  |---|---|
  | Phrases | Three letters of their category plus a number: `gre-01`, `res-12`, `cas-07` |
  | Words | `w-…` |
  | Sentences | `s-NN` |
  | Connector and pattern examples | `cx-<lesson>-N`, `px-<lesson>-N` |
  | Grammar lessons, and their examples | `gr-<name>`; `gx-<name>-N` |
  | Kana | `hira-…`, `kata-…`, `kata-ext-…` |
  | Kanji | `kw-…` (Kanji in Your Words), `kan-…` (Common Kanji), `km-…` (More Kanji) |
  | Listening | `lr-NN` (lines said back), `lc-<set>-<word>` (sound pairs) |
  | Your own words | `u-<time>` |
- **`audio`** is the clip's path from the site root. It's unique across every course and sits under `audio/<target language>/`. The audio tool writes to exactly that path (§9).
- **`difficulty`** is 1–5. It orders new cards, easiest first, and drives placement's sampling and seeding.
- **`tags`** is a non-empty array of short labels, shown as chips. The English course writes them in Japanese.

### 6.2 `content/courses.json`

```json
{
  "schemaVersion": 1,
  "languages": {
    "ja": { "name": { "en": "Japanese", "ja": "日本語" }, "native": "日本語", "badge": "JA",
            "font": "\"Hiragino Kaku Gothic ProN\", \"Yu Gothic\", \"Meiryo\", \"Noto Sans JP\", sans-serif" }
  },
  "speakers": ["en", "ja"],
  "courses": [
    { "id": "en-ja", "speaker": "en", "target": "ja", "status": "available", "manifest": "content/ja/manifest.json" },
    { "id": "en-id", "speaker": "en", "target": "id", "status": "planned" }
  ]
}
```

- A course id is `<speaker>-<target>`.
- An `available` course has a `manifest`; a `planned` one has none and shows a placeholder.
- `speakers` are the languages people learn *from*. Each needs `content/ui/<code>.json`.
- Every language needs a `name` in every speaker language.
- `font` is a CSS font stack, applied as a `:lang(<code>)` rule to text in that language wherever it appears.

### 6.3 Course manifest

`content/<target>/manifest.json`:

| Key | Required | Meaning |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `language`, `speaker` | yes | Must equal the course's target and speaker |
| `fields` | yes | `{ target, meaning, ruby?, reading? }`: which item fields hold the text being learned, the gloss, furigana and romanisation. Japanese: `japanese`, `english`, `furigana`, `romaji`. English: `english`, `japanese` |
| `copy` | yes (`placementLede`) | The course's own wording: `placementLede` (`{n}` = number of items), `placementAside`, and `lessonsTitle`, `lessonsTab`, `lessonsIcon`, `lessonsLede` for the lessons tab. Without the lessons keys, the tab is called Connectors |
| `groups` | yes | `[{ id, title }]`, the topic groups for phrase categories |
| `levels` | no | `[{ id, icon, title, description, placement? }]`, in order (§7.10). With it, every entry below names its `level`, and `categories` and `decks` entries may give a `step` (a number) for the order of the next-step path. `placement: false` keeps a level out of the placement quiz |
| `categories` | yes | `[{ id, order, file, title, icon, group, level?, step?, starter? }]` |
| `register` | no | The default register. `polite` or `casual` gives every phrase without its own register a badge; any other value (the English course uses `polite-neutral`) shows none |
| `noteFields` | no | `[{ field, label, style? }]`: which note fields exist and how they're labelled. Japanese: `registerNotes` (Register), `animeNote` (From anime?), `usage` (Usage). English: `registerNotes` (使い方), `pitfallNote` (よくある間違い) |
| `aids` | no | The reading aids' names: `{ ruby: { chip, label, help }, reading: { … } }`. `label` names the aid in Settings, and `chip` on its inline chip. `help` describes it; Settings shows its own help for the three modes instead |
| `words` | with word decks | `{ pos: [...], forms: [...], verbForms: [...] }`: the parts of speech allowed, the word forms allowed, and the forms every verb must have. Japanese: forms `masu` and `te` |
| `decks` | no | `[{ id, kind: "words" or "sentences", order, file, title, icon, level?, step?, starter? }]` |
| `lessonGroups`, `lessons` | no | `[{ id, title, description }]`; `[{ id, order, file, title, group, level? }]` |
| `drills` | no | The drill kinds lessons use: `fill`, `order`, `combine`, `say`. Without it, the first three |
| `characterSets` | no | `[{ id, order, file, title, icon, script: "hiragana", "katakana" or "kanji", layout: "grid" or "list", level? }]` |
| `listening` | no | `[{ id, kind: "replies" or "contrasts", file, title, icon, level? }]` |
| `scenarios` | no | `[{ id, file, title, icon, category, level? }]`, where `category` is a phrase category id |
| `dictionary` | no | `{ file, name, owner, ownerUrl, url, licence, licenceUrl, credit }`: the course's offline dictionary, for Paste a message, and the credit its licence asks for (§6.14) |
| `voice` | no | `{ engine: "google" or "azure", azure: { default, speakers } }` (§9.2) |
| `generatedFor`, `notes` | no | Free text. The app doesn't use them |

`starter: true` on a category or deck means placement adds it. In a course with levels, placement adds the chosen level's starters, and moving up adds the next level's (§7.10).

### 6.4 Phrase categories

A category file is `{ schemaVersion, id, title, order, description, phrases: [...] }`, and its `id` must match the manifest entry.

**A phrase** has:
- `id`;
- the target text and the gloss;
- `registerNotes`;
- `audio`, `tags` and `difficulty`;
- furigana and romaji where the course declares them.

**Optional:**
- `audioHint`: what to synthesise instead of the text;
- `register`: `polite` or `casual`;
- the other note fields (`animeNote`, `pitfallNote`);
- `polite`, on a casual phrase: its polite counterpart, which shares the meaning and has its own clip.

```json
{ "id": "cas-01", "register": "casual", "japanese": "うん", "furigana": "うん", "romaji": "un",
  "english": "Yeah. / Yes.",
  "polite": { "japanese": "はい", "furigana": "はい", "romaji": "hai", "audio": "audio/ja/casual/cas-01-polite.mp3" },
  "registerNotes": "The everyday yes with anyone you're close to…",
  "audio": "audio/ja/casual/cas-01.mp3", "tags": ["yes-no", "essential"], "difficulty": 1 }
```

### 6.5 Word and sentence decks

A deck file is `{ schemaVersion, id, title, description, items: [...] }`.

**A word** has:
- `id`, the target text and the gloss;
- `pos`, from the manifest's `words.pos`;
- `audio`, `tags` and `difficulty`.

It may also have:
- furigana (required wherever the text has kanji);
- romaji, where the course declares it. The Japanese First-steps decks have it, and so do the grammar lessons' examples;
- `forms` (a Japanese verb needs both `masu` and `te`, written in inline notation);
- note fields (`usage`, `registerNotes`, `pitfallNote`);
- `audioHint`.

**A sentence** has the same base fields, plus:
- `register`, where the course uses registers;
- `chunks`: the sentence cut into pieces, `[{ "t": "<text in inline notation>", "w": "<word id>"? }]`.

The rules for chunks:
- The pieces must rebuild the sentence exactly, furigana included.
- At least one piece must link a word.
- Every linked word must exist.

The chunks also give each word its "In sentences" list, and they're what the ordering drills shuffle.

### 6.6 Lessons

A lesson file is `{ schemaVersion, id, connector, gloss, title, pattern, explanation, natural, stiff, examples: [3–5] }`.

- The prose fields and `pattern` may use inline furigana. In a course with furigana, every kanji in them must have a reading. `connector`, `gloss` and `title` are shown without furigana, so in a furigana course they're written in kana.
- An example is a sentence (§6.5) plus its drill data:

```json
{
  "id": "cx-kara-1",
  "japanese": "雨が降っているから、家にいる。",
  "furigana": "{雨|あめ}が{降|ふ}っているから、{家|いえ}にいる。",
  "english": "It's raining, so I'm staying in.",
  "register": "casual",
  "chunks": [ { "t": "{雨|あめ}が", "w": "w-ame" }, { "t": "{降|ふ}っているから、", "w": "w-furu" },
              { "t": "{家|いえ}に", "w": "w-ie" }, { "t": "いる。" } ],
  "gap": { "before": "{雨|あめ}が{降|ふ}っている", "answer": "から", "after": "、{家|いえ}にいる。",
           "options": ["から", "ので", "けど", "ながら"], "ok": ["ので"],
           "note": "ので works too, and sounds a little softer.", "why": "The reason comes first, then から." },
  "combine": { "a": "{雨|あめ}が{降|ふ}っている。", "b": "{家|いえ}にいる。", "distractors": ["{降|ふ}っているけど、"] },
  "audio": "audio/ja/connectors/cx-kara-1.mp3", "tags": ["connectors", "kara"], "difficulty": 1
}
```

**`gap`:**
- `before + answer + after` must equal the sentence (its furigana form in a course with furigana).
- `options` holds 2–4 distinct options, including the answer.
- `ok` lists "also right" options, which need a `note`.
- `why` explains the right answer.

**`combine`:** two sentences to join, `a` and `b`, and the trap pieces (`distractors`). A trap must not be one of the sentence's real pieces.

**`alsoOrders`:** optional extra accepted orders, each an array of chunk indices that is a permutation of the written order.

### 6.7 Character sets

A set file is `{ schemaVersion, id, kind: "characters", title, script, description, groups: [{ id, title, description }], characters: [...] }`.

**A character** has:
- `id`, `character`, and `japanese`, which equals `character`;
- `furigana` as segments, and `readings` (a non-empty array);
- `romaji`;
- `english`: the meaning for kanji, `null` for kana (the app shows "reads 'a'" instead);
- `audio` and `audioHint` (the kana reading, which is what gets synthesised);
- `group`, `tags` and `difficulty`.

**Kana** also have `row` and `column`: grid positions, with vowel columns `a i u e o`.

**Kanji** may have a `note`, and `seenIn`: the ids of the words, sentences, lesson examples and phrases containing them, written by `npm run crossref`.

| Kana group | Count |
|---|---|
| `base` | 46 |
| `dakuten` | 20 |
| `handakuten` | 5 |
| `yoon` | 33 |
| `extended` (katakana only) | 12 |

The kana files are generated by `npm run kana`; the kanji files are written by hand. Characters use the phrase shape, so the same flashcard screen shows them.

### 6.8 Listening

- **`replies`:** `{ schemaVersion, id, title, description, items: [...] }`.
  - An item has the course's own text fields (`english` and `japanese`, plus `furigana` in a furigana course), then `id`, `speaker`, `reply?`, `note?`, `audio`, `tags` and `difficulty`.
  - `speaker` names the other person, with a `speaker.*` interface string: barista, clerk, doctor, driver, friend, neighbour, passerby, pharmacist, receptionist, server or staff.
  - `reply`, what the learner could answer, is an object in the course's own fields: `{ japanese, furigana, english }` in the Japanese course. The English course writes it flat instead, as `reply` (the English) and `replyJapanese` (its meaning), which always come together.
  - The file needs at least 3 items, since each question offers three meanings.
- **`contrasts`:** `{ schemaVersion, id, title, description, sets: [{ id, sound, note, pairs: [[word, word], …] }] }`.
  - A word is `{ id, english, japanese, audio }`. Japanese words are written in kana: the pair is about sound.
  - A pair is two different words.

### 6.9 Scenarios

A scenario file is `{ schemaVersion, id, title, category, setting, start, nodes: { <nodeId>: node } }`.

**A node:**
- `speaker`: `narration`, or a role with a `speaker.*` interface string, such as staff, officer, passerby, barista, driver, receptionist, pharmacist, neighbour, doctor, friend, or a partner's mother or father (`mother`, `father`);
- the target text, gloss and reading fields;
- `audio` and `audioHint`, on lines the other person speaks;
- `options`: 2–3 replies;
- `end: true` on a terminal node.

**An option:**
- `quality`: `good`, `awkward` or `wrong`;
- `feedback`, which is required;
- `next`: a node id;
- either a `phraseId` (a phrase of this course, whose text and clip are used) or inline text fields.

**The rules:**
- `start` exists, and every `next` resolves.
- Every node is reachable from `start`, and some path ends.
- Narration is written in the learner's language.
- Every `phraseId` exists.

Node ids are `n1`, `n2`… with a terminal `end`.

### 6.10 Furigana notation

Both forms work everywhere:

```text
segments:  [{ "b": "電車", "r": "でんしゃ" }, { "b": "に" }]
inline:    "{電車|でんしゃ}に"
```

- The segments must spell the text exactly, and every reading must be kana.
- Give each word its own segment. A segment can't wrap across lines, so a long one (a whole price, `{一万三千八百二十円|いちまんさんぜんはっぴゃくにじゅうえん}`) can run off a phone's screen; split it into words instead (`{一万|いちまん}{三千|さんぜん}…`).
- A katakana word may carry a hiragana reading aid, such as `{コーヒー|こーひー}`. It's hidden once katakana is mastered, and audio is still made from the katakana.
- `js/ruby.js` converts between the forms. `alignReading` spreads a whole-word reading over a word's kanji: `食べ物` with たべもの becomes `{食|た}べ{物|もの}`.

### 6.11 Interface strings

`content/ui/<lang>.json` is a flat map from key to string.

- `{name}` placeholders are filled in at runtime.
- Plurals are `key_one` / `key_other` (or any other CLDR form), chosen by `Intl.PluralRules`.
- `$locale` sets the date locale. Japanese uses `ja-JP`; with none, the device default applies.
- A key missing from a dictionary falls back to English, then to the key itself.

English has 459 keys and Japanese 430. The keys only English-taught courses can reach (Reading, the character limit, the romaji notice) have no Japanese version. Paste a message has its strings in both, though only the Japanese course has a dictionary so far. Four boot-error strings are built into `js/i18n.js`, because they have to work when no content loads.

### 6.12 The content contract (`npm test`)

`tools/selftest.mjs` fails on any of the following.

- **Courses:**
  - a course id that isn't `<speaker>-<target>`, or that's duplicated;
  - an undeclared speaker, or a language not named in every speaker language;
  - an available course without a manifest, or a planned course with one.
- **Manifests:**
  - a missing `schemaVersion`;
  - `language` or `speaker` not matching the course;
  - no `fields.target` or `fields.meaning`;
  - no `copy.placementLede`;
  - undeclared groups, or no starter category;
  - with `levels`: an empty list, a repeated level id, a level without a title or description, an entry naming an undeclared level, a `step` that isn't a number, a level with no decks or lessons, no starter in the first level, or no level that placement samples;
  - no `words.pos` in a course with word decks, or verb forms that aren't declared forms;
  - an unknown voice engine, or an Azure voice that isn't an `xx-XX-…Neural` voice in the course's language;
  - unknown drill kinds, or undeclared lesson groups.
- **Any content file:** a `schemaVersion` or `id` that doesn't match the manifest, or an empty list.
- **Any item:**
  - missing required fields;
  - an id repeated within the course;
  - difficulty outside 1–5, or empty tags;
  - furigana that doesn't parse, doesn't rebuild the text, or has non-kana readings;
  - kanji without furigana, in a furigana course;
  - an audio path that's reused across courses or isn't under `audio/<target>/`;
  - a clip of 800 bytes or less.
- **Words:**
  - an undeclared part of speech;
  - a verb without its required forms;
  - an undeclared or unannotated form.
- **Sentences and examples:**
  - an invalid register;
  - chunks that don't rebuild the sentence and its furigana;
  - no linked word, or a link to a word that doesn't exist.
- **Lessons:**
  - missing prose fields, or kanji without readings in the prose or the pattern;
  - fewer than 3 or more than 5 examples;
  - a gap that doesn't rebuild the sentence;
  - an answer that isn't among 2–4 distinct options;
  - an "also right" option that isn't offered or isn't explained;
  - an alternative order that isn't a permutation;
  - combine data missing its two sentences or traps, or a trap that's a real piece.
- **Characters:**
  - missing fields, or an undeclared group;
  - `japanese` not matching `character`, or empty readings;
  - kanji without a meaning, or with `seenIn` references that don't exist;
  - kana with a non-null `english`.
- **Listening:**
  - an unknown kind;
  - fewer than 3 replies;
  - a flat `reply` without `replyJapanese`, or the reverse; a `reply` object without its text and meaning;
  - furigana that doesn't rebuild a line or a reply;
  - no speaker;
  - a pair that isn't two different words.
- **Scenarios:**
  - an unresolved start or option target;
  - an invalid quality, or missing feedback;
  - an option with neither text nor a phrase;
  - an unknown `phraseId`;
  - an unreachable node, or no path that ends;
  - narration not in the learner's language;
  - a missing clip.
- **Dictionaries** (§6.14):
  - a manifest `dictionary` whose file is missing;
  - a file that isn't `schemaVersion` 1, or isn't from the course's language into the speaker's;
  - fewer than 1,000 entries, or an entry that isn't four strings with a reading and a meaning;
  - a file of 3 MB or more;
  - credit fields that differ between the manifest and the file;
  - no named source release (a file built from a local copy).

  A file more than 35 days old gets a reminder to refresh it, not a failure.
- **Interface strings:**
  - a key in any dictionary that English lacks;
  - a reachable English key with no translation;
  - a `t('…')` literal in the code naming a key that doesn't exist;
  - a missing runtime-built key (`pos.*`, `forms.*`, `data.*`, `drill.*`, `dir.*`).
- **Service worker:**
  - a module in `js/` missing from `SHELL`, or a `SHELL` entry that doesn't exist;
  - `VERSION` differing from `CACHE_VERSION`.
- **SRS:** a regression in the scheduler (§7.2).

### 6.13 Adding content

All of these are content only: no app code.

**A phrase category, word or sentence deck, lesson or scenario:**
1. Write the file, using an existing one as the model: `content/ja/greetings.json`, `content/ja/words/people.json`, `content/ja/connectors/kara.json`, `content/ja/grammar/wa.json` or `content/ja/scenarios/conbini.json`.
2. Add an entry to the manifest's `categories`, `decks`, `lessons` or `scenarios`, with its `level` (and, for a deck or category, its `step` on the level's path).
3. Run `npm run audio -- --course <id>`.
4. For Japanese, also run `npm run crossref`.
5. Run `npm test`.
6. Release it (§11.4).

**A language to learn** (say, Indonesian):
1. Write `content/<code>/manifest.json` and its files.
2. In `courses.json`, set the course's `status` to `available`, add its `manifest`, and give the language a `font` if it needs one.
3. Run `npm run audio -- --course en-id`, then `npm test`.

`tools/language-pack-test.mjs` proves this works: it adds an Esperanto course in memory and runs placement, the deck, the review queue and grading over it.

**A language to learn from** (a new speaker) also needs `content/ui/<code>.json` and an entry in `speakers`.

### 6.14 Course dictionary

A course can have an offline dictionary, for Paste a message (§2.4). The Japanese course has one; the English course doesn't, yet.

- **The manifest key:** `"dictionary": { file, name, owner, ownerUrl, url, licence, licenceUrl, credit }`. `file` is the dictionary; the rest is the credit its licence asks for, which the screens show without loading the file.
- **The file:** `content/ja/dictionary.json`, 2.1 MB (0.8 MB gzipped). It downloads with the course and is cached with it (§10.3).
  - **Its header** repeats the manifest's credit fields, and adds `schemaVersion`, `kind`, `language`, `meaningLanguage`, `source`, `sourceVersion` (the release it was built from), `dictDate`, `fields` and `note`.
  - **`entries`** has one entry per line, so a refresh shows as a readable diff. Each is `[kanji, kana, pos, senses]`:
    - `kanji` and `kana`: the spellings and the readings, `|`-separated, common ones first and search-only spellings last;
    - `pos`: JMdict's word-class codes, space-separated (only those the app uses), plus `uk` for a word usually written in kana;
    - `senses`: up to 4 meanings, `|`-separated, each up to 4 English glosses joined with `; `.
- **The source:** JMdict's common words with English glosses, 22,645 entries in the edition of 12/10/2026, as the jmdict-simplified project's `jmdict-eng-common` release. `npm run dictionary` (`tools/make-dictionary.mjs`) downloads the latest release and rebuilds the file. `-- --from <file.json>` builds from a copy already downloaded, but the file then names no release, which `npm test` refuses.
- **The licence:** the JMdict files are the property of the Electronic Dictionary Research and Development Group (EDRDG), and are used under its licence, Creative Commons Attribution-ShareAlike 4.0. `content/ja/dictionary.json` is built from them and is under the same licence. The licence asks for:
  - **an acknowledgement on every screen that shows entries,** with links to the source and the licence. The paste screens carry it at the foot, and Settings → About has it too;
  - **regular updates from the latest release.** Rebuild about once a month with `npm run dictionary`, then release (§11.4). `npm test` prints a reminder once the file is more than 35 days old.
- **How a message is read** (`js/dictionary.js`, no external library):
  - **Longest match:** from each position, the longest text (up to 14 characters) that is a dictionary word, as written or inflected. Anything else stays plain text.
  - **Inflections:** the app's own rules undo an ending a step at a time: ます forms, ない, た, て, たい, たら, たり, ば, the potential, passive and causative, the volitional, the commands 食べろ, しろ and 来い (not a godan verb's, like 書け), ないで, なきゃ, ながら, なさい, ている, ておく, てしまう and ちゃう, すぎる, and the い-adjective forms, for ichidan and godan verbs, する and 来る. A candidate counts only if the dictionary has that word, of the class the rule makes. 食べなかった is 食べる (negative, past); 勉強した is 勉強, a noun that takes する.
  - **When one spelling is several words:** text in kana prefers a word usually written in kana (に is the particle, not 荷), text in kanji prefers a word's main spelling, and straight after a number, a counter (7時 is read じ, not とき).
  - **Set phrases:** a phrase ending in a particle (今日は, "hello") gives way to the word before it (今日 + は). The word sheet still offers the phrase.
  - **Readings** are the text's own (食べなかった is たべなかった; 来ない is こない), spread over the kanji as furigana (§6.10).
  - **The card's word:** the spelling the message used, if it used kanji; otherwise how the word is usually written.
- **What it can't do:** find a word that isn't among the common words, or give a whole sentence's meaning. A sentence's meaning is the learner's to write.

---

## 7. Learning engine

### 7.1 Cards and directions

- **One card per direction.** Every studyable item has one card per enabled direction:

  | Direction | Card id |
  |---|---|
  | Recognition | the item's own id, e.g. `w-iku` |
  | Production (Say it) | `<id>~p`, e.g. `w-iku~p` |
  | Listening | `<id>~l`, e.g. `w-iku~l` |
- **Card kinds:** `phrase`, `word` and `sentence` share the main queue. `character` cards have their own queue and are recognition only.
- **Listening needs audio:** a listening card exists only for an item with a clip, a recording or a device voice.
- **At least one direction stays on.** Settings refuses to switch off the last one.
- **The sibling rule:** a new production or listening card isn't introduced until the same item's recognition card has been seen. When recognition is switched off, nothing waits.
- **Switching a direction on** adds its cards to every active deck, as new cards. **Switching it off** parks them: they drop out of the queue and the counts, but keep their state.
- **The card record:**

```text
{ id, itemId, dir: recognition | production | listening, categoryId,
  kind: phrase | word | sentence | character, difficulty (1–5),
  ease, interval (days), reps, lapses, due (epoch ms),
  state: new | learning | review, introduced (epoch ms), lastReview (epoch ms), seededBy }
```

  A missing `kind`, `dir` or `itemId` defaults to `phrase`, `recognition` and the card's own id.

### 7.2 SM-2 scheduling

`js/srs.js`:

| Grade (button) | SM-2 quality |
|---|---|
| No idea | 0 |
| Shaky | 3 |
| Got it | 4 |
| Too easy | 5 |

- **A new card:** ease 2.5, interval 0, reps 0, due now, state `new`.
- **A failure** (quality < 3):
  - reps go to 0 and lapses up by one;
  - the interval goes to 0 and the state to `learning`;
  - it's due in **10 minutes**, and ease drops by 0.2, with a floor of 1.3;
  - the card also goes to the back of the current session.
- **A success:**
  - the interval becomes 1 day the first time, 6 days the second, then `round(interval × ease)`;
  - reps go up by one and the state becomes `review`;
  - ease becomes `ease + 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)`, with a floor of 1.3;
  - **Too easy** with an interval over 1 multiplies the new interval by 1.3, rounded;
  - it's due at now + interval days.
- **"Mature"** means an interval of 21 days or more.
- **Previews:** each grade button shows the interval it would give.

### 7.3 Queues and new-card limits

- **The main queue** draws on cards from active decks, in enabled directions, after the sibling rule.
  - First come the due cards (state isn't `new` and the due time has passed), oldest due first.
  - Then up to `newPerDay` new cards (default 10), easiest first: by `difficulty`, then by when they were added.
- **The character queue** works the same way over active character sets, with up to `newCharsPerDay` new cards (default 15).
- **The limit is per queue.** It applies each time a queue is built, not per calendar day, so a second session on the same day can bring more new cards.
- **Studying one deck** (`/study/<id>`) uses the same rules, scoped to that deck.
- **Today's "new" figure** is `min(new cards in study, newPerDay)`.

### 7.4 Placement and seeding

- **Sampling:** for each phrase category and character set, the easiest and the hardest item by `difficulty` (one, if they're the same). Categories and sets in a level marked `placement: false` aren't sampled.
- **Scoring:** answers count as known 1, seen 0.5 and unknown 0. Each category's score is the average.

  | Overall average | Label |
  |---|---|
  | ≥ 0.75 | strong |
  | ≥ 0.45 | partial |
  | ≥ 0.2 | early |
  | below that | just starting |
- **Sampled items:** a "known" item's recognition card is seeded at 6 days (ease 2.6, reps 2, state `review`). The rest start new.
- **Starters:** in a course with levels, the starting level is set (§7.10), and that level's `starter` categories and decks are added. Picking another level on the results screen takes out the first level's starters, if none of their cards has been reviewed, and adds the new level's. In a course without levels, every `starter` is added.
- **Adding a deck or set**, at placement or later:
  - recognition cards with difficulty ≤ 2 start at 4 days (ease 2.6) when the category scored ≥ 0.75;
  - recognition cards with difficulty 1 start at 2 days (ease 2.5) when it scored ≥ 0.5;
  - everything else, including every production and listening card, starts new;
  - cards that already exist are never touched.
- **The stored result:** placement is saved as `meta.placement` (§8.3), and it gates each course on its first visit.

### 7.5 Decks

- **What's active:** `settings.activeCategories` lists the decks in study: phrase categories, word and sentence decks, lessons and `mine`. Character sets are in `settings.activeCharacterSets`.
- **Adding** a deck creates its missing cards. **Taking it out** moves its id to `parkedDecks` (or `parkedSets`) and leaves the cards untouched. Adding it again restores it as it was, which is how a return is told apart from a first add.
- **Entering a course** gives every active deck the cards for any newly enabled direction.
- **Your own words:**
  - The `mine` deck becomes active with the first word.
  - Deleting an item deletes its cards and its recording.
  - An item whose audio is removed loses its listening card.
- **Reset this course** clears that course's database and nothing else.

### 7.6 What moves the schedule

Only flashcard grading moves SM-2. Everything else either feeds the deck or keeps its own records.

- **Scenario replies:** picking a reply that's a course phrase updates its card's `lastReview` (unless the card is new), and nothing more.
- **Lesson drills**, per example:
  - *Fill the gap* exists if the example has a `gap`.
  - *Put it in order* exists if it has 3 or more chunks.
  - *Join them* exists if it has `combine` data.
  - *Say it* exists if the course's `drills` include it.
- **Sessions:**
  - Practising a lesson runs all of its drills.
  - Mixed practice runs 12 drills from the lessons practised so far, or from all lessons before any has been.
  - Drills are spread out, so the same sentence never comes twice in a row where that can be avoided.
- **Checking answers:**
  - *Fill the gap* has three verdicts. `right` and `ok` (also right, shown with its note) both count as right; `wrong` shows why.
  - *Put it in order* and *Join them* are right when the placed pieces form an accepted order and include no trap.
  - *Say it* is the learner's own call, and *Not yet* is a miss.
- **A miss** adds the sentence's cards in every enabled direction. It fails the production card (or, if production is off, the first enabled direction), so that card is due in 10 minutes. The lesson then becomes an active deck. Right answers change nothing.
- **Each session** is recorded per lesson as `{ sessions, right, total, best: { right, total }, lastAt }`.
- **Kana and listening drills** keep their own mastery records (§7.7).
- **The streak:** all drills count toward it.

### 7.7 Mastery drills

**The rule** (`js/mastery.js`):
- An item is mastered when it has been right **3 times in a row** and those answers fall on **at least 2 different days**, counted as UTC days.
- A wrong answer resets both the streak and the days.
- The record is `{ right, wrong, streak, days[], last }`.

**Kana:**
- **Mastery:** a kana also counts as mastered if its character card is in `review` with an interval of 7 days or more.
- **The core:** the groups `base`, `dakuten` and `handakuten`, 71 kana per script. A script is mastered at 90% of its core.
- **The daily focus:** hiragana, then katakana, then nothing once both are done (Today then shows the character deck instead).
- **A drill has 15 questions:**
  - *New kana:* up to 10, in teaching order, row by row. It's 5 until at least 10 answers have been given with 80% right, and none while 20 are still in progress.
  - *In progress:* missed last time first, then the least recently seen.
  - *Refreshers:* at least 2 mastered kana, and more when there's room.
- **Questions:**
  - About one in three is *Which one did you hear?* (when the kana has audio); the rest are *What does it say?*.
  - Each has four options: the answer and three kana that sound different, preferring the same row or vowel column, and kana already met.
  - お/を, じ/ぢ and ず/づ are never offered together.
  - New kana are shown on an intro screen first.

**Listening:**
- **A drill has 10 questions:**
  - *In progress:* missed last time first, always leaving 2 places for new items.
  - *New:* up to 6, alternating lines said back and sound pairs.
  - *Refreshers:* 2 mastered items, and more when there's room.
- **Questions:**
  - A *What did they say?* question offers three meanings: the right one and two others with different meanings.
  - A *Which one did you hear?* question offers the pair, in its written order.

### 7.8 Reading aids

- **Furigana:** `settings.furiganaMode` is `always`, `tap` or `hidden`. An older `furigana: false` setting reads as hidden.
  - An item marked **I can read this** shows as `tap` where the mode is `always`. It never reduces `hidden`.
  - Drill tiles show readings unless the mode is `hidden`, because a tile you tap to move can't also be tapped to reveal.
- **Katakana aids:** the hiragana over katakana segments is hidden once katakana is mastered. This is checked on entering the course and after every kana drill.
- **Romaji** (Japanese): `settings.romajiMode` is `always`, `tap` or `hidden`, the same modes as furigana. An older `romaji: false` setting reads as hidden, and `true` as always.
  - An item marked **I can read this** shows its romaji as `tap` where the mode is `always`, as for furigana.
  - On `tap`, the romaji line keeps its space, its text invisible until tapped. In the kana chart, the tap that plays a character also shows its romaji.
  - 7 days after the course was first opened, a mode still on `always` changes once to `tap`, with a message (`romajiRetired` records that it happened). A mode the learner chose themselves is left alone, and either way it can be changed back.
- **The kanji gate:** while hiragana isn't mastered, kanji sets offer **Add anyway** instead of Add.

### 7.9 Stats and streak

- **Daily stats:** `meta.stats` is keyed by UTC date, as `{ reviews, again, charReviews, charAgain, drills }`.
- **Done today:** counts flashcard reviews, excluding characters.
- **The streak:** consecutive days with any review, character review or drill. Today counts once something has been done; otherwise counting starts from yesterday.
- **The forecast:** reviews due on each of the next 7 local days.

### 7.10 Levels

`js/levels.js` holds the rules; `deck.js` reads the data for it.

- **A course's levels** are its manifest's `levels`, in order. Every category, deck, lesson, character set, scenario and listening set names one. A course without `levels` has none: everything is shown together, as before.
- **The learner's level** is `settings.level`, kept per course.
  - Placement sets it from the overall score: below 0.45 ("just starting" or "early") the first level, from 0.45 ("partial") the second, from 0.75 ("strong") the third. A course with fewer levels caps it at its last. A level with `placement: false` isn't sampled, but can still be suggested: in Japanese, a strong result on First steps and Basic suggests Intermediate.
  - The results screen offers the other levels too.
  - **Make this my level,** in Learn or the lessons list, sets it.
  - **Move up,** on Today, sets it to the next level and adds that level's starters.
  - A learner from before levels existed gets the highest level among the decks they study, saved the first time it's needed.
- **A level's items** are the phrases, words and sentences in its categories and decks. Lesson examples aren't counted: they only become cards once practised.
- **Learned** means the item's recognition card is in `review` with an interval of 7 days or more. That's the same bar as for a kana card (§7.7).
- **Ready for the next level** means 80% of the level's items are learned and 80% of its lessons have been practised at least once.
- **The path:** a level's categories and decks, ordered by `step`, then words before sentences before phrases, then each list's own `order`.
  - **The next step** is the first entry on the path that isn't in study and hasn't been taken out.
  - Today offers it whenever fewer new cards are waiting in study than `newPerDay`.
- **The next lesson** is the level's first lesson, in order, not yet practised.
- **Listening** draws on the sets at the learner's level and the levels below it. With none there, Today and Learn don't show it.
- **Screens:**
  - Learn and the lessons list show one level at a time, the learner's own by default; the level picked there is kept while the app is open.
  - The Reading tab and the scenario list put each set and scenario under its level's heading.

---

## 8. Storage and backups

### 8.1 Namespaces

| Namespace | IndexedDB database | localStorage prefix | Holds |
|---|---|---|---|
| `en-ja` | `nihongo-tabi` | `nt` | The Japanese course. The name predates the app's name and must never change: renaming it would orphan existing progress |
| any other course (`ja-en`…) | `wayword-<course>` | `ww-<course>` | That course |
| `app` | `wayword` | `ww` | App-wide preferences |
| `restore-undo` | `wayword-restore-undo` | `ww-restore-undo` | What the last restore replaced. Never backed up |

- **The database:** each one is version 1, with two object stores and out-of-line keys: `srs` (cards, by card id) and `meta` (records, by key).
- **The fallback:** storage falls back to localStorage, as `<prefix>:<store>:<key>` with JSON values, when IndexedDB is missing, fails to open, or doesn't open within 2 seconds (as can happen in Safari's private mode). Settings → Your data shows which one is in use.

### 8.2 Card records

The `srs` store holds one record per card, shaped as in §7.1.

### 8.3 Meta records

| Key | Namespace | Shape |
|---|---|---|
| `prefs` | `app` | `{ speaker, lastCourse, textScale, lastBackupAt, connection: "online" or "offline" }` |
| `settings` | course | `{ furiganaMode, romajiMode, newPerDay, newCharsPerDay, activeCategories, activeCharacterSets, parkedDecks, parkedSets, directions: { recognition, production, listening }, autoPlayAudio, installedAt, romajiRetired }`, plus the legacy `furigana`, `romaji` and `textScale` |
| `placement` | course | `{ done, at, answers, perCategory: { <id>: { known, seen, unknown, n, score } }, overall }` |
| `stats` | course | `{ "<UTC date, YYYY-MM-DD>": { reviews, again, charReviews, charAgain, drills } }` |
| `lessonStats` | course | `{ <lessonId>: { sessions, right, total, best: { right, total }, lastAt } }` |
| `kanaStats`, `listenStats` | course | `{ <itemId>: { right, wrong, streak, days, last } }` |
| `kanaLog`, `listenLog` | course | `{ sessions, lastDay, lastScript? }`: whether today's drill is done |
| `readable` | course | `[itemId]`, the items marked "I can read this" |
| `userItems` | course | `[{ id, kind: "word" or "sentence", target, reading, furigana, meaning, note, audioMode: "recording", "tts" or "none", createdAt }]` |
| `messages` | course | `[{ id: "m-<time>", text, createdAt, added: [userItem ids] }]`: messages kept by Paste a message, oldest first, and the words added from each |
| `rec:<id>` | course | A recording, as a `data:` URL |
| `beforeRestore` | `restore-undo` | `{ at, restored, data: <a backup object> }` |

Settings defaults: `newPerDay` 10, `newCharsPerDay` 15, directions recognition and production on with listening off, `autoPlayAudio` on, `furiganaMode` and `romajiMode` `always`. The `connection` preference defaults to `online`.

### 8.4 Backup file

- **The name** is `wayword-backup-<UTC date, YYYY-MM-DD>.json`, a machine format the app writes.
- **The shape:**

```json
{
  "format": "wayword-backup", "version": 1, "app": "Wayword", "exportedAt": "<ISO time>",
  "namespaces": {
    "app":   { "meta": { "prefs": { … } }, "srs": {} },
    "en-ja": { "meta": { "settings": { … }, "userItems": [ … ], "rec:u-…": "data:…" },
               "srs":  { "w-iku": { … }, "w-iku~p": { … } } }
  }
}
```

- **What goes in:** `app` and every available course, with empty namespaces left out. Each store is copied exactly as stored, so anything added in future is backed up with no change to the backup code.
- **Validation,** before anything changes:
  - `format` is `wayword-backup`;
  - `version` is a number no higher than 1 (a newer one is refused with its own message);
  - `namespaces` is a non-empty object, with names `app` or `xx-xx`;
  - the stores are objects, and every card is an object with a string `id`.
- **Restoring:**
  1. The app asks first, showing the date and the card and own-word counts per course.
  2. It saves the namespaces about to be replaced to `restore-undo`.
  3. It clears and rewrites each namespace in the file. Namespaces not in the file are left alone.
  4. It reloads.
- **Undo** restores that snapshot, without saving a new one, and then deletes it.
- **Reminders:** `prefs.lastBackupAt` is set when the file is handed over, since the app can't know whether it was kept. Today shows the reminder once there's progress (a studied card, or one of your own words) and no backup in the last 14 days.

---

## 9. Audio

### 9.1 Bundled clips

- **One MP3 per item,** committed under `audio/<target language>/`, at the path in the item's `audio` field.
- **The folders:** phrases sit at the top level (`audio/ja/gre-01.mp3`), and everything else in `words/`, `sentences/`, `grammar/`, `connectors/`, `patterns/`, `listening/`, `scenario/`, `casual/` (casual phrases and their polite versions) and `chars/`.
- **What gets a clip:**
  - every phrase, and every casual phrase's polite version;
  - every word, sentence and lesson example;
  - every listening line and every word of a sound pair;
  - every character;
  - every scenario line the other person speaks.

  A scenario reply that references a phrase plays that phrase's clip; an inline reply has none.
- **No speech at runtime:** the app never synthesises speech for bundled content.
- **The totals:** Japanese 1,725 clips (22.6 MB), English 846 (11.7 MB).

### 9.2 Generating clips

`tools/generate-audio.mjs` walks every course in `courses.json` (or just one, with `--course`), finds every item with an `audio` path, and synthesises the clips that are missing.

| Option | Effect |
|---|---|
| `--force` | Regenerate every clip |
| `--check` | Only report what's missing |
| `--only <ids>` | Limit the run to some categories or decks |

**What's spoken:**
- the item's `audioHint`, if it has one;
- otherwise, in a furigana course, the text with each annotated kanji run replaced by its reading. Kana segments, such as katakana with a hiragana aid, are spoken as written;
- otherwise, the text itself;
- for characters, the `audioHint` (the kana reading) or the character itself.

Six Japanese words whose kana spelling is a common homophone (あめ, かえる, しる, かさ, あき, はる) set `audioHint` to their kanji instead.

**Engines** (the manifest's `voice`):

| | `google` (the default) | `azure` |
|---|---|---|
| Service | Google Translate's public text-to-speech endpoint (`translate_tts`, `tl=<language>`) | Microsoft neural voices, through the Speech REST API (SSML, `audio-24khz-48kbitrate-mono-mp3`) |
| Pace | One request every 350 ms | One request every 3.1 s (the free tier allows 20 a minute). A 429 is waited out; a 401 stops the run |
| Voices | One per language | `voice.azure.default` for the learner's own lines. `voice.azure.speakers` (one voice, or one per speaker with `*` as the fallback) for scenario lines and listening replies |

- **The Azure key:** Azure needs `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`. They're read from the environment, or on Windows from the user's saved environment, so a key set with `setx` works in a terminal opened earlier.
- **No key, no run:** without a key an Azure run stops before changing anything, and never falls back to another voice, which would mix two voices in one course.
- **The English course** names `en-NZ-MollyNeural` (default) and `en-NZ-MitchellNeural` (speakers), but stays on `google` until there's a key.
  - `npm run voice:samples` writes six sample clips to `tmp/voice-samples/`.
  - `npm run voice:nz` sets `"engine": "azure"`, with a targeted edit that keeps the manifest's layout, and remakes every English clip.
- **Failures:** each clip gets up to 3 attempts, with backoff. A response under 800 bytes counts as a failure.
- **Internet:** generating clips needs a connection. The app at runtime doesn't.

### 9.3 Playback

- **One clip at a time:** `js/audio.js` plays files through `HTMLAudioElement`.
- **🐢 slower** plays at 0.75× with `preservesPitch` (and the `moz`/`webkit` versions). It also sets `defaultPlaybackRate`, because Safari resets `playbackRate` when a clip loads.
- **iOS** only plays audio started from a user gesture, so the first tap anywhere unlocks playback.
- **When clips play:** recognition and production cards play on reveal, when auto-play is on. Listening cards play as they appear.

### 9.4 Your own words

- **The device voice:** `speechSynthesis`, with a voice in the right language and `localService` true. Only on-device voices are used, and the rate is 0.95 × the chosen speed.
- **A recording:** `MediaRecorder` captures the microphone, stored as `meta.rec:<id>`, a `data:` URL.
- **Neither:** the card says "No audio" and gets no listening card.
- **A word added from a pasted message** (§2.4) gets the device voice if there is one, and otherwise "No audio". A recording can be added by editing the card.

---

## 10. Offline and updates

### 10.1 Caches

- **`wayword-<version>`** (`wayword-v19`): one cache per version, holding the app and the courses this device keeps.
- **`wayword-kept`** isn't versioned. It holds `./__kept-courses.json`, the ids of the courses this device keeps, and `./__connection.json`, `{ mode: "online" or "offline" }` (§10.6).
- **Cleanup:** only caches named `wayword-…`, or with the legacy prefix `nihongo-tabi-…`, are ever deleted, because the `github.io` origin is shared with other sites. A worker deletes only caches from older versions, never a later version's.

### 10.2 Install

- **What's cached:** `./`, `index.html`, `app.webmanifest`, `css/styles.css`, every module in `js/` and the four icons (the `SHELL` list), plus `content/courses.json` and `content/ui/<lang>.json` for English and every speaker. That's 42 URLs, after which the worker takes over at once (`skipWaiting`).
- **Tolerant loading:** downloads go through `cacheAllTolerant`.
  - It skips files already cached, so an interrupted install resumes.
  - It fetches 12 at a time, with up to 3 attempts and pauses of 1.5 s and then 3 s.
  - Whatever is still missing is reported, but doesn't fail the install.

### 10.3 Keeping courses

**Messages.** These go over a `MessageChannel` (`js/offline.js`):

| Message | Answer |
|---|---|
| `{ type: "keep-courses", courses: [ids] }` | `{ courses: [{ course, total, added, missing, error? }] }`, or `{ courses: [], offline: true }` when it's offline (§10.6) |
| `{ type: "course-status", course }` | `{ course, kept, cached, total, downloading }` |
| `{ type: "connection", mode?, retry? }` | `{ mode, offlineSince }` (§10.6) |
| `"skipWaiting"` | (none) |

**When the app sends keep-courses:**
- when it enters a course, with a toast once the course is newly downloaded;
- at every launch, with every course started on the device (placement done). An empty list tells the worker the device keeps no courses.

The app waits up to 10 minutes for a keep and 15 seconds for a status.

**What the worker does** (when it's offline, it only records the ids, step 2):
1. Re-checks the app's own files (the install list, §10.2) and fetches any that are missing. Normally they're all there, and this costs one lookup each.
2. Records the ids in `wayword-kept`.
3. For each kept course, walks the manifest: the manifest itself, every file listed in `categories`, `decks`, `lessons`, `listening`, `characterSets` and `scenarios`, and every `audio` string anywhere in those files. A course's `dictionary` file is kept too, without being read: it has no clips.
4. Caches whatever this version lacks, through the same tolerant loader. JSON reads are tried 3 times.
5. Two asks for the same course share one download, and writes to the record are serialised.
6. Once the app's files and every kept course are complete, the older versions' caches are deleted.

**Sizes:** the app is 42 URLs, the Japanese course 959 files (its dictionary among them) and the English course 688. That's 1,689 in all, about 22 MB.

### 10.4 Fetch strategy

- **Navigations:** the network first (cached if OK), falling back to the cached `index.html`: this version's, or an older version's if it has none. In offline mode, the cached page straight away (§10.6).
- **Other same-origin GETs**, in order:
  1. this version's cache, ignoring the query string;
  2. the network, cached if OK. Skipped when offline (§10.6);
  3. any older version's cache;
  4. a `504 Offline and not cached`.
- **The time limit:** the network gets 10 seconds (`NETWORK_TIMEOUT` in `sw.js`) to answer, after which it's treated as offline (§10.6).
- **Offline:** the content loader treats a 504, or a network error, as offline. A course opened offline before it was ever downloaded shows "Not on this device yet", with a way back. In offline mode, it says so and offers **Go online**.

### 10.5 Updates and versioning

- **One version, two files.** The number lives in `CACHE_VERSION` in `sw.js` and `VERSION` in `js/version.js`, and `npm test` fails if they differ. A changed `sw.js` is what makes a browser install a new worker. **Bump both for every release that changes any app file.**
- **On activation, the worker:**
  - claims the open pages;
  - deletes older caches straight away, but only if the device keeps no courses;
  - reloads pages from versions before v12, which have no update bar.
- **Spotting a new version** (`js/updates.js`):
  - When the page becomes visible again, it calls `registration.update()`, unless offline mode is on.
  - A `controllerchange` on a page that already had a worker marks an update as ready and shows the bar. A first install isn't announced.
  - Settings → About → Check for updates reports latest, downloading, ready, offline (no answer, or none within 10 seconds), offline mode (it didn't ask), or unsupported (no service worker). **Update now** shows only while an update is ready, including one that finishes downloading while Settings is open.
- **The update bar** sits below an iPhone's status bar (safe-area padding). Its message wraps, and its two buttons, **Not now** and **Update now**, stay on one line, under the message on a phone.
  - **Update now** reloads into the new version.
  - **Not now** removes the bar for this page, with a toast saying Settings has the update; Settings → About then shows **Update now**. Nothing is stored: the next launch runs the new version anyway, because the new worker has already taken over.
  - The bar is drawn by the running version, so changes to the bar show from the update after the one that ships them. Updating to v16 still shows v15's one-button bar; **Not now** first appears for the update after v16.
- **`[hidden]` wins:** the stylesheet's `[hidden] { display: none !important; }` stops a component's own `display` (`.btn`, `.action-row`) from showing an element the code has hidden. Before v16, Settings always showed **Update now** because of it.
- **Right after an update,** until the app has asked for its courses, offline content may come from the previous version's cache. Content changes therefore stay backward compatible: new fields are optional.
- **Updating from v13 or v14:** those workers took every other cache for an older one. Asked to keep their courses while a new version was installing, they could delete the new version's cache. Since v15, the new version's first ask to keep courses puts back any app files that went missing (§10.3), so such a device is repaired on its first launch online.
- **First launch after an update:** `index.html` keeps static tab links, so that launch (new HTML, old cached JS) still has a tab bar.

### 10.6 Online and offline mode

Wi-Fi with no internet behind it (a dead router, a hotel login page) doesn't refuse a request; it leaves it hanging. Browsers still report the device as online, so the app can't ask the browser. Before v16, the page request waited with no limit, and an installed app opened to a blank screen.

**The modes.** The learner chooses in Settings → Connection (§2.13). The page keeps the choice in `prefs.connection` and tells the worker at every launch and on every change (`{ type: "connection", mode }`). The worker keeps it in `wayword-kept` as `./__connection.json`, because it serves the next launch before any of the app runs; a new version's worker reads it from there too.

| | Online (default) | Offline for now | Offline mode |
|---|---|---|---|
| When | Normally | A request got no answer in 10 seconds, since the page last loaded | Chosen in Settings |
| Page loads | Network, up to 10 s; then the cached page | The network again, up to 10 s: every page load retries | The cached page, without asking the network (the network only if nothing is cached) |
| Files not in this version's cache | Network, up to 10 s; then an older version's copy, or 504 | An older version's copy, or 504, at once | The same, at once |
| keep-courses | Downloads | Records the ids only, and answers `offline: true` | The same |
| course-status | Counts what's cached, reading the network for a missing manifest | Counts what's cached only | The same |
| Update checks | On returning to the app, and from Settings | The same | None: Settings says offline mode is on |

- **The time limit** is `NETWORK_TIMEOUT` in `sw.js`, 10 seconds. A request still pending is left to finish or fail in the background; nothing waits on it. A request refused outright (airplane mode) fails at once, falls back at once, and doesn't count as "offline for now".
- **Offline for now** is the worker's `offlineSince`: when a request first ran out of time. Every page load clears it and tries the network again. It's held in the worker's memory, so it also ends when the browser stops an idle worker.
- **Telling the learner.** At launch the page sends the mode and the worker answers `{ mode, offlineSince }`. If the launch fell back, a toast says the app is working offline, and Settings → Connection says why. A change in Settings sends `retry: true`, which ends offline for now.
- **Going online** in Settings (or with **Go online** on "Not on this device yet") also asks the worker to keep every course started here, so what offline mode left undownloaded comes down.
- **Installing a new version isn't affected.** The browser only installs one when it has fetched the new `sw.js`, so the network works at that moment, and the install caches the app as usual (§10.2). In offline mode, the new version's courses then come from the previous version's cache until the app goes online.
- **Update checks** from Settings are given 10 seconds too, and report offline after that.

---

## 11. Running, testing and deploying

### 11.1 Requirements

- **Node.js 18 or newer,** with npm. Last tested on Node 24 LTS.
- **git on PATH,** for `npm run deploy` and `browser-check --upgrade-from`.
- **Firefox,** for the browser checks. `FIREFOX_PATH` overrides the standard install paths.
- **Internet,** to generate audio. Nothing else needs it.
- **Optional:** `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` (Azure voices); `DEPLOY_GIT_USER` (the GitHub account to push as).

Setup: `npm ci` installs the two dev dependencies, `jsdom` and `puppeteer-core`. The app itself has no runtime dependencies and no build step.

### 11.2 Scripts

| Command | Runs | What it does |
|---|---|---|
| `npm start`, `npm run dev` | `tools/serve.mjs` | A static server on port 5173, bound to `0.0.0.0`. Prints the LAN URL and sends `Cache-Control: no-cache` |
| `npm test` | selftest, integration-test, language-pack-test, voice-test | The content contract, the end-to-end logic, the language-pack claim and the Azure path |
| `npm run test:content`, `test:integration`, `test:voice` | One suite each | |
| `npm run test:render` | render-test, then sw-test | Every screen in jsdom, then the service-worker checks |
| `npm run test:sw` | sw-test | The real `sw.js`, run in a sandbox (§11.3) |
| `npm run test:browser` | browser-check | The real app in headless Firefox: service worker, Cache Storage, every tab, backup, updates, offline. Also takes `--upgrade-from <git ref>` and `--live <url>` |
| `npm run audio`, `audio:check`, `audio:force` | generate-audio | Generate missing clips; report coverage; regenerate everything. Add `-- --course <id>` to limit it to one course |
| `npm run voice:samples`, `voice:nz` | generate-audio | Azure sample clips; switch the English course to Azure (§9.2) |
| `npm run kana` | make-kana | Regenerate the hiragana and katakana files (they're written with LF line endings) |
| `npm run crossref`, `crossref:check` | crossref-kanji | Link each kanji to where it appears, and list the kanji no set teaches; `:check` writes nothing |
| `npm run icons` | make-icons | Regenerate the PNG icons (a torii, drawn from rectangles, with no image library) |
| `npm run dictionary` | make-dictionary | Rebuild the Japanese course's dictionary from the latest JMdict release (§6.14). Run it about monthly, then release |
| `npm run deploy` | deploy | Release to GitHub Pages (§11.4). `-- --dry-run` stops before the push |

### 11.3 Test suites

| Suite | What it covers | Checks (21/10/2026) |
|---|---|---|
| `tools/selftest.mjs` | The content contract (§6.12), including furigana short enough to fit a line, the levels and the course dictionary; interface strings; the service-worker shell and version; SRS regressions | 63,755 |
| `tools/integration-test.mjs` | The real modules, end to end in Node (with a filesystem `fetch` and a localStorage shim): placement and the starting level (sampling only the levels that ask for it), levels (progress, the next step, moving up, older learners, listening by level), decks, queues, grading, directions, drills, mastery, listening, backups, course isolation, the romaji modes, and the dictionary: inflections, lookups, readings, suggested furigana and saved messages | 351 |
| `tools/language-pack-test.mjs` | An Esperanto course added purely as content, run through placement, the deck, the queue and grading | 13 |
| `tools/voice-test.mjs` | The generator against a local stand-in for Azure: headers, SSML, voice choice, rate limits, the engine switch, every no-key path | 18 |
| `tools/render-test.mjs` | Every screen of both courses rendered in jsdom, including the starting level at placement, Today's level and next step, listening only where the level has some, Learn and the lessons list by level, furigana in a lesson's pattern, whole drill sessions, backup and restore through the real buttons, the reading-aid modes, the connection setting, the update bar with Not now, and Paste a message from a message with no dictionary yet to a word added | 352 |
| `tools/sw-test.mjs` | The real `sw.js` in a sandbox: registration in every boot path; installing, keeping courses, resuming and retrying over a flaky connection; one version replacing another on shared Cache Storage; a connection that never answers, and offline mode | 54 |
| `tools/browser-check.mjs` | Headless Firefox through a proxy that can cut every connection, or stall them (take each request and never answer): install, per-course downloads, every tab online and offline, text fitting a 320px screen at the largest size, an IndexedDB backup round trip, an update while the app is open (Not now, then Update now from Settings), opening on a connection that never answers, online and in offline mode, and pasting a message offline, with a word looked up and added. `--upgrade-from <ref>` installs that build first; `--live <url>` checks the deployed site | 68 local, 59 live |

### 11.4 Releasing

A **release** is any change to an app file: `index.html`, `app.webmanifest`, `css/`, `js/`, `content/`, `audio/` or `icons/`. Finished releases are deployed straight away.

1. Make the change, and update this README wherever its facts change.
2. Bump `CACHE_VERSION` in `sw.js` and `VERSION` in `js/version.js` to the same new value.
3. Run `npm test`, `npm run test:render`, `npm run test:browser`, and `node tools/browser-check.mjs --upgrade-from origin/main` (the update a returning learner gets).
4. Commit, then run `npm run deploy`:
   1. **Preflight:** checks you're on `main`, with nothing uncommitted and nothing behind `origin`.
   2. **Tests:** runs the content, integration, language-pack, render, service-worker and voice suites.
   3. **Push:** pushes `main` as `DEPLOY_GIT_USER`, or git's `credential.username`, or the repository's owner (`-c credential.username=…`, because Git Credential Manager can hold several accounts).
   4. **Wait:** polls the live `sw.js` until it reports the new version, for up to 10 minutes.
5. Run `node tools/browser-check.mjs --live https://shikomisen.github.io/Wayword/`. Right after a deploy, GitHub's CDN can be slow for a few minutes, so if a download times out, run it again.

A change that touches no app file (this README, the tools) needs no version bump. A plain push to `main` publishes it.

### 11.5 Hosting

- **What's served:** GitHub Pages serves `main` / root exactly as committed. `.nojekyll` stops Jekyll processing. There's no `gh-pages` branch and no build: the committed tree is the site.
- **Everything committed is public,** on GitHub and on the site. That's why private notes stay out of the repository.
- **Every path is relative:** the manifest's `start_url` (`./index.html`) and `scope` (`./`), `register('sw.js')`, the service worker's lists, and every content and audio fetch. The same files then work at `/Wayword/` and at `/` under `npm start`. Never hard-code `/Wayword/`.
- **Renaming the repository** changes the site's URL, and GitHub doesn't redirect project Pages, so every installed copy would break.
- **On a phone, during development:** `npm start` prints a `Network:` URL for the same Wi-Fi. The app works there, but no service worker registers over plain `http://` on a LAN address, so there's no offline use and no install. The console says so. Use `localhost`, or the deployed HTTPS site.

---

## 12. Platform notes

- **Browsers:** current Chrome, Edge, Firefox and Safari. Offline use and installing need a secure context: HTTPS, or `http://localhost`.
- **Android:**
  - Install from Chrome's menu: *Add to Home screen* or *Install app*.
  - The installed app has two shortcuts: Review due cards, and Learn. They open in the course used last.
- **iPhone and iPad:**
  - Install from Safari: Share → *Add to Home Screen*.
  - **Separate storage:** a home-screen install keeps its own storage, separate from Safari's and from any other install. Moving progress between them means a backup and a restore.
  - **Audio** has to start from a tap. The app unlocks it on the first tap anywhere.
  - **Slower playback:** Safari resets `playbackRate` when a clip loads, so 🐢 also sets `defaultPlaybackRate`.
  - **The status bar:** the app draws under it (`viewport-fit=cover`, `black-translucent`), and the update bar pads itself by `env(safe-area-inset-top)`.
  - **Private browsing** can stall IndexedDB, in which case storage falls back to localStorage after 2 seconds.
  - **Backups** can go through the share sheet, to Files, Drive or mail, where `navigator.canShare` accepts files.
- **Desktop:** in a review, Space or Enter reveals the answer and 1–4 grade it.
- **Small screens and big text:** everything is laid out to fit a 320px-wide phone at the largest text size (1.6×).
  - Japanese has no spaces, so it wraps between characters, following Japanese line-breaking rules (`line-break: strict`). Browsers that support it (Chrome) wrap between phrases instead (`word-break: auto-phrase`).
  - A furigana reading can't be split across lines, so long numbers and compounds carry their readings word by word: 一万・三千・八百・二十・円, not the whole price as one reading.
  - A word too long for its box breaks rather than overflowing (`overflow-wrap: break-word`).
  - The browser check fails if any text runs out of its box at that size (§11.3).
- **Developing on Windows:**
  - **Line endings:** checkouts use `core.autocrlf=true`, so working files have CRLF line endings and scripted edits must handle them. `npm run kana` writes LF, which git may show as a change with no real difference.
  - **`tools/sw-test.mjs` contains NUL characters on purpose** (`'\0RESULT'`), so git treats it as binary. Edit it with a script that splices bytes, not with a text editor that might rewrite it.
  - **git** must be on PATH for the deploy and upgrade scripts.
  - **Scratch files** go in `tmp/`, which is gitignored.

---

## 13. Porting to another platform

A native app (for example in Flutter, or the current web app wrapped in a native shell such as Capacitor) would reuse most of the project.

**Reusable as-is**
- **Content:** every file in `content/`, with the schema and the rules in §6.
- **Audio:** every clip in `audio/`, with the same paths.
- **The learning rules:** §7, exactly as written. `npm test`'s SRS checks and the integration suite are a ready-made specification to test a port against.
- **The backup format:** §8.4. It's the way to carry progress over: a port that imports a Wayword backup keeps every card and record.
- **The interface strings:** `content/ui/`.
- **The dictionary and how it's read:** `content/ja/dictionary.json`, under its own licence and credit, and §6.14. `js/dictionary.js` is plain logic apart from one `fetch`, so its rules port line by line, and the integration suite's cases test them.

**Web-specific parts to replace**

| In the web app | What it does | What a native app needs |
|---|---|---|
| Service worker and Cache Storage (§10) | Offline use, downloading each course, the 10-second limit and offline mode | Bundled assets, or per-course downloads to app storage, and a timeout on network requests |
| Version lockstep and the update bar | Getting phones onto the new version | Store updates; content updates could ship as data |
| IndexedDB with a localStorage fallback (§8) | Namespaced key-value stores | Any local database: the same two stores per course |
| Hash routes (§4.3) | Navigation, and links that carry the course | A router with the same route map |
| `<ruby>`, `render.js`, the furigana modes | Readings over kanji, and tap to reveal | A furigana text widget. Native text layout has no ruby support built in |
| `:lang()` font stacks from `courses.json` | The right glyphs for each language | Per-locale fonts: Japanese text needs a Japanese face, to get the right glyph forms |
| `HTMLAudioElement`, with 0.75× and pitch kept | Playing clips | A platform audio player with rate control and time-stretching |
| `speechSynthesis`, on-device voices only | Audio for your own words | Platform text-to-speech, on-device |
| `MediaRecorder` and `data:` URLs | Recording your own words | Platform recording, stored as files |
| `navigator.share` and file download or upload | Backups | The share sheet and a file picker |
| `prefers-color-scheme` and `--text-scale` | Dark-first theme, text size | System theme and text scaling |
| `env(safe-area-inset-top)` | The notch | Safe-area insets |
| `confirm()` | Asking before reset, restore or taking a deck out | Native dialogs |

Native platforms also allow what the web app can't do without a server: scheduled review reminders, and on-device speech recognition, which could check the Say it drills.

---

## 14. Roadmap

**Next**
- **An Intermediate level for the English course** (roughly CEFR B1): travel and health in more depth, social conversation, opinions, plans and problems, with word and sentence decks, phrase categories, grammar lessons, scenarios and more listening.

**Waiting on something**
- **The New Zealand voice for the English course.** It needs an Azure Speech key (§9.2):
  1. `npm run voice:samples`, and listen;
  2. `npm run voice:nz`;
  3. run the tests and release (§11.4).
- **More listening practice, if the English learner's gaps turn out to be hearing:** longer and faster replies, reductions (*gonna, dunno, lemme*) and linking (*pick it up*). This waits until the course has had real use.

**Later (not scheduled)**
- **Paste a message, next steps:**
  - a dictionary for the English course: English words with Japanese meanings;
  - an optional online helper, to pick out useful phrases and give whole sentences their meanings. It would send a message to an AI service when asked, so it waits on a decision about that;
  - sharing a message straight into the app (Android only: iPhones don't let web apps receive shares);
  - picking words out of a photo.
- Native-speaker recordings to replace or supplement the synthesised clips. Playback works the same way, and no app code changes.
- A native app (§13).
- Live AI conversation practice, and AI-assisted placement. Both need a backend proxy to hold an API key.
- Cloud sync. Today the backup file is how progress moves.
- Indonesian. It's content only: the `en-id` and `ja-id` entries are placeholders.

**Not planned**
- Handwriting and stroke order: the app teaches reading.
- Staff-side English (customer-service vocabulary): the English course is customer-side.
- A neural voice for the Japanese course.
