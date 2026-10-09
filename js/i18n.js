/**
 * i18n.js — interface strings, in the learner's own language.
 *
 * The UI language follows the course's *speaker*, not its target: someone
 * learning English from Japanese gets a Japanese interface. Course-specific
 * wording (the placement intro, note labels) lives in that course's content
 * manifest instead, so this file only holds strings every course shares.
 *
 * Values are plain strings with {placeholders}, or functions when the
 * wording itself changes with the numbers (English plurals). A key missing
 * from a dictionary falls back to English rather than showing the raw key —
 * that is how the Characters screens, which only exist for courses whose
 * speakers read English, get away with having no Japanese strings.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const en = {
  'tab.today': 'Today',
  'tab.browse': 'Browse',
  'tab.characters': 'Characters',
  'tab.scenarios': 'Scenarios',
  'tab.settings': 'Settings',

  'today.title': 'Today',
  'today.empty': 'Your deck is empty — add a category to get going.',
  'today.caughtUp': 'All caught up. Come back later today.',
  'today.waiting': ({ n, mature }) => `${plural(n, 'card')} waiting. ${mature} are sticking.`,
  'today.startReview': ({ n }) => `Start review · ${plural(n, 'card')}`,
  'today.nothingDue': '✅ Nothing due right now.',
  'today.nothingDueHint': 'Add a category or study ahead from the browse screen.',
  'today.browse': 'Browse phrases',
  'today.inDeck': 'In your deck',
  'today.noCategories': 'No categories active yet.',
  'today.addMore': 'Add more categories →',
  'stat.due': 'due',
  'stat.new': 'new',
  'stat.doneToday': 'done today',
  'stat.streak': 'day streak',
  'queue.toReview': '{n} to review',
  'queue.relearning': '{n} relearning',
  'queue.new': '{n} new',
  'forecast.title': 'Next 7 days',
  'forecast.today': 'today',
  'reading.title': 'Reading',
  'reading.characters': 'Characters',
  'reading.notAdded': 'Hiragana, katakana and everyday kanji — not added yet',
  'reading.pending': '{due} due · {unseen} unseen · counted separately',
  'reading.caughtUp': 'All caught up · {mature} mature',
  'category.progress': '{studied}/{total} started · {due} due',
  'category.count': '{n} phrases',

  'browse.title': 'Browse',
  'browse.lede': 'Grouped by situation. Add a couple at a time — the review load adds up.',
  'browse.missing': '⚠️ content file missing',
  'browse.inDeck': 'in deck',
  'browse.add': 'Add',
  'browse.added': 'Added {added} cards',
  'browse.addedSeeded': 'Added {added} cards ({seeded} seeded forward)',

  'category.back': '← Browse',
  'category.practise': 'Practise the full exchange',
  'category.study': 'Study this category',
  'category.add': 'Add to deck',
  'category.addedToDeck': 'Added {added} cards to your deck',
  'category.dueNew': '{due} due · {fresh} new',

  'study.nothingIn': 'Nothing due in {title}.',
  'study.scheduledOut': 'Everything here is scheduled further out. That is the system working.',
  'study.backToToday': 'Back to today',
  'study.back': '← Back',
  'study.tapToReveal': 'Tap to reveal',
  'study.showAnswer': 'Show answer',
  'study.done': 'Session done',
  'study.doneSummary': '{done} cards graded · {total} total today',
  'grade.again': 'No idea',
  'grade.hard': 'Shaky',
  'grade.good': 'Got it',
  'grade.easy': 'Too easy',

  'audio.missing': 'No audio clip for this phrase yet',
  'audio.missingTitle': 'No audio clip generated for this phrase yet',
  'audio.play': 'Play audio for {text}',

  'settings.title': 'Settings',
  'settings.furigana': 'Furigana',
  'settings.furiganaHelp': 'Kana readings above kanji',
  'settings.romaji': 'Romaji',
  'settings.romajiHelp': 'Turn this off once the kana stick — README §6 suggests after week 1',
  'settings.autoplay': 'Auto-play audio',
  'settings.autoplayHelp': 'Play the clip when a card is revealed',
  'settings.newPerDay': 'New cards per day',
  'settings.newPerDayHelp': 'Caps how fast the deck grows',
  'settings.newChars': 'New characters per day',
  'settings.newCharsHelp': 'Kana and kanji, capped separately from phrases',
  'settings.textSize': 'Text size',
  'settings.textSizeHelp': 'Doubles as an accessibility control — applies to every language',
  'settings.deck': 'Deck',
  'settings.phrases': 'Phrases: {total} cards · {review} in review · {mature} mature',
  'settings.characters': 'Characters: {total} cards · {review} in review · {mature} mature',
  'settings.storage': 'Storage: {backend}',
  'settings.resetConfirm': 'Erase all {course} progress, SRS state and placement results? This cannot be undone. Other languages are not affected.',
  'settings.reset': 'Reset all progress',

  'toast.romajiRetired': 'Week 1 done — romaji is now off by default. Turn it back on in Settings.',

  'error.title': 'Something went wrong',
  'error.lede': 'The app could not finish starting up.',
  'error.hint': 'If this was a connection problem, reloading once more usually fixes it — the offline cache installs in the background.',
  'error.reload': 'Reload',

  'home.tagline': 'Words, phrases and real conversations — spaced repetition that works offline, in your pocket.',
  'home.speaker': 'I speak',
  'home.learn': 'I want to learn',
  'home.notStarted': 'Not started — a quick placement check comes first',
  'home.due': ({ n }) => `${plural(n, 'card')} due today`,
  'home.caughtUp': 'All caught up for today',
  'home.comingSoon': 'Coming soon',
  'home.comingSoonSub': 'In the works — not available yet',
  'coursebar.home': 'Languages',
  'coursebar.pair': '{speaker} › {target}',
  'planned.title': '{lang} is coming soon',
  'planned.body': 'This course is planned but not built yet. When it is ready it will appear here, with its own deck and progress kept separate from your other languages.',
  'planned.back': 'Back to languages',

  'quiz.title': 'Where are you starting from?',
  'quiz.start': 'Start',
  'quiz.skip': 'Skip — I\'m a complete beginner',
  'quiz.progress': '{i} of {n} · {title}',
  'quiz.listen': '🔊 Listen',
  'quiz.showMeaning': 'Show meaning',
  'quiz.known': 'I know this',
  'quiz.knownSub': 'could say it myself',
  'quiz.seen': 'I recognise it',
  'quiz.seenSub': 'understand it, couldn\'t say it',
  'quiz.unknown': 'New to me',
  'quiz.unknownSub': 'start from the beginning',
  'quiz.back': '← Back',
  'quiz.building': 'Building your deck…',
  'quiz.built': 'Deck built',
  'quiz.level.strong': 'Strong start',
  'quiz.level.partial': 'Partial — lopsided, as expected',
  'quiz.level.early': 'Early beginner',
  'quiz.level.fresh': 'Starting fresh',
  'quiz.summary': '{label} — {pct}% of the sample already familiar.',
  'quiz.phrases': 'Phrases',
  'quiz.reading': 'Reading',
  'quiz.readingStrong': 'You can already read — those sets will be seeded well forward if you add them, rather than starting you at あ.',
  'quiz.readingWeak': 'Reading is the highest-leverage thing you can add. Hiragana first: it unlocks the furigana readings used everywhere else in the app.',
  'quiz.loaded': 'Your starter categories are loaded and ready ({total} cards, {review} seeded forward because you already had them). The other categories, and the character sets, are added from Browse and Characters when you want them — loading everything at once would bury you in reviews.',
  'quiz.loadedNoChars': 'Your starter categories are loaded and ready ({total} cards, {review} seeded forward because you already had them). The other categories are added from Browse when you want them — loading everything at once would bury you in reviews.',
  'quiz.startStudying': 'Start studying',
  'quiz.readingFirst': 'Set up reading first',

  'register.polite': 'Polite',
  'register.casual': 'Casual',
  'register.politeVersion': 'Polite version',

  'scenarios.title': 'Scenarios',
  'scenarios.lede': 'Full exchanges rather than isolated phrases. Every reply is one you could actually give — including the ones that land badly, which are the interesting ones.',
  'scenarios.notInDeck': ' · category not in your deck yet',
  'scenarios.none': 'No scenarios defined yet.',
  'scenario.back': '← Scenarios',
  'scenario.you': 'You',
  'scenario.listen': '🔊 Listen',
  'scenario.reply': 'Your reply',
  'scenario.fromDeck': 'from your deck · {id}',
  'scenario.again': 'Run it again',
  'scenario.backToList': 'Back to scenarios',
  'scenario.broken': 'Scenario {id} has a broken link to "{node}".',
  'scenario.missingPhrase': '(missing phrase {id})',
  'quality.good': 'Natural',
  'quality.awkward': 'Understood, but off',
  'quality.wrong': 'Misfires',
  'speaker.staff': 'Staff',
  'speaker.officer': 'Officer',
  'speaker.passerby': 'Passer-by',
  'speaker.server': 'Server',
  'speaker.barista': 'Barista',
  'speaker.clerk': 'Clerk',
  'speaker.receptionist': 'Receptionist',

  'interval.new': 'new',
  'interval.now': 'now',
  'interval.min': '{n} min',
  'interval.hr': '{n} hr',
  'interval.day': ({ n }) => plural(n, 'day'),
  'interval.mo': '{n} mo',
};

const ja = {
  'tab.today': '今日',
  'tab.browse': '一覧',
  'tab.characters': '文字',
  'tab.scenarios': '会話練習',
  'tab.settings': '設定',

  'today.title': '今日',
  'today.empty': 'デッキはまだ空です。カテゴリーを追加して始めましょう。',
  'today.caughtUp': '今日の分はすべて完了です。また後で来てください。',
  'today.waiting': '{n}枚のカードが待っています。{mature}枚は定着しています。',
  'today.startReview': '復習を始める・{n}枚',
  'today.nothingDue': '✅ 今は復習するカードがありません。',
  'today.nothingDueHint': '一覧からカテゴリーを追加するか、先取りで学習しましょう。',
  'today.browse': 'フレーズ一覧へ',
  'today.inDeck': '学習中のカテゴリー',
  'today.noCategories': 'まだカテゴリーがありません。',
  'today.addMore': 'カテゴリーを追加 →',
  'stat.due': '復習',
  'stat.new': '新規',
  'stat.doneToday': '今日の学習',
  'stat.streak': '日連続',
  'queue.toReview': '復習 {n}',
  'queue.relearning': '再学習 {n}',
  'queue.new': '新規 {n}',
  'forecast.title': '今後7日間',
  'forecast.today': '今日',
  'category.progress': '{studied}/{total} 学習済み・復習 {due}',
  'category.count': '{n}フレーズ',

  'browse.title': 'フレーズ一覧',
  'browse.lede': '場面ごとに分かれています。復習の量は積み重なっていくので、カテゴリーは2つずつくらい追加するのがおすすめです。',
  'browse.missing': '⚠️ コンテンツファイルがありません',
  'browse.inDeck': '学習中',
  'browse.add': '追加',
  'browse.added': '{added}枚追加しました',
  'browse.addedSeeded': '{added}枚追加しました（{seeded}枚は習得済みとして先に進めました）',

  'category.back': '← 一覧',
  'category.practise': '会話の流れで練習する',
  'category.study': 'このカテゴリーを学習',
  'category.add': 'デッキに追加',
  'category.addedToDeck': '{added}枚をデッキに追加しました',
  'category.dueNew': '復習 {due}・新規 {fresh}',

  'study.nothingIn': '「{title}」に今復習するカードはありません。',
  'study.scheduledOut': 'どのカードも先の日付に予定されています。仕組みどおりに進んでいます。',
  'study.backToToday': '今日の画面へ',
  'study.back': '← 戻る',
  'study.tapToReveal': 'タップして答えを見る',
  'study.showAnswer': '答えを見る',
  'study.done': 'セッション完了',
  'study.doneSummary': '{done}枚を評価・今日の合計 {total}枚',
  'grade.again': 'わからない',
  'grade.hard': 'あやしい',
  'grade.good': 'わかった',
  'grade.easy': '簡単すぎ',

  'audio.missing': 'このフレーズの音声はまだありません',
  'audio.missingTitle': 'このフレーズの音声はまだ作成されていません',
  'audio.play': '「{text}」の音声を再生',

  'settings.title': '設定',
  'settings.autoplay': '音声の自動再生',
  'settings.autoplayHelp': '答えを表示したときに音声を流します',
  'settings.newPerDay': '1日の新規カード数',
  'settings.newPerDayHelp': 'デッキが増えるペースの上限です',
  'settings.textSize': '文字サイズ',
  'settings.textSizeHelp': 'アクセシビリティの調整にも使えます。すべての言語に適用されます',
  'settings.deck': 'デッキ',
  'settings.phrases': 'フレーズ：{total}枚・復習中 {review}枚・定着 {mature}枚',
  'settings.storage': '保存先：{backend}',
  'settings.resetConfirm': '{course}の学習記録・復習スケジュール・レベルチェックの結果をすべて消去しますか？元に戻せません。ほかの言語には影響しません。',
  'settings.reset': '学習記録をリセット',

  'error.title': '問題が発生しました',
  'error.lede': 'アプリを起動できませんでした。',
  'error.hint': '通信の問題であれば、もう一度読み込むとたいてい直ります。オフライン用のデータは裏で準備されます。',
  'error.reload': '再読み込み',

  'home.tagline': '単語、フレーズ、実際の会話 — オフラインでも使える間隔反復で、ポケットの中で。',
  'home.speaker': 'あなたの言語',
  'home.learn': '学びたい言語',
  'home.notStarted': '未開始 — 最初に簡単なレベルチェックがあります',
  'home.due': '今日の復習 {n}枚',
  'home.caughtUp': '今日の分は完了',
  'home.comingSoon': '近日公開',
  'home.comingSoonSub': '準備中 — まだ利用できません',
  'coursebar.home': '言語選択',
  'coursebar.pair': '{speaker} › {target}',
  'planned.title': '{lang}は近日公開',
  'planned.body': 'このコースは計画中で、まだ準備ができていません。完成したらここに表示されます。学習記録はほかの言語とは別に保存されます。',
  'planned.back': '言語選択に戻る',

  'quiz.title': 'まずはレベルチェック',
  'quiz.start': 'はじめる',
  'quiz.skip': 'スキップ — まったくの初心者です',
  'quiz.progress': '{i} / {n}・{title}',
  'quiz.listen': '🔊 聞く',
  'quiz.showMeaning': '意味を見る',
  'quiz.known': '知っている',
  'quiz.knownSub': '自分で言える',
  'quiz.seen': '見ればわかる',
  'quiz.seenSub': '意味はわかるが、自分では言えない',
  'quiz.unknown': '初めて見る',
  'quiz.unknownSub': '最初から学ぶ',
  'quiz.back': '← 戻る',
  'quiz.building': 'デッキを作成中…',
  'quiz.built': 'デッキができました',
  'quiz.level.strong': '好スタート',
  'quiz.level.partial': 'ところどころ — 得意と不得意がはっきり',
  'quiz.level.early': '初級',
  'quiz.level.fresh': 'ゼロからスタート',
  'quiz.summary': '{label} — サンプルの{pct}%はすでに知っていました。',
  'quiz.phrases': 'フレーズ',
  'quiz.loadedNoChars': 'スタート用のカテゴリーを用意しました（{total}枚。うち{review}枚はすでに知っていたので先の日付に進めてあります）。残りのカテゴリーは、必要になったら一覧から追加してください。一度に全部入れると復習に追われてしまいます。',
  'quiz.startStudying': '学習を始める',

  'register.polite': '丁寧',
  'register.casual': 'カジュアル',
  'register.politeVersion': '丁寧な言い方',

  'scenarios.title': '会話練習',
  'scenarios.lede': '単発のフレーズではなく、やりとり全体を練習します。選択肢はどれも実際に口にしそうな返事です — うまく伝わらないものも含めて。そこが一番の学びどころです。',
  'scenarios.notInDeck': '・このカテゴリーはまだデッキにありません',
  'scenarios.none': 'まだ会話練習がありません。',
  'scenario.back': '← 会話練習',
  'scenario.you': 'あなた',
  'scenario.listen': '🔊 聞く',
  'scenario.reply': 'あなたの返事',
  'scenario.fromDeck': 'デッキのフレーズ・{id}',
  'scenario.again': 'もう一度',
  'scenario.backToList': '会話練習の一覧へ',
  'scenario.broken': '会話「{id}」のリンク「{node}」が壊れています。',
  'scenario.missingPhrase': '（フレーズ {id} が見つかりません）',
  'quality.good': '自然',
  'quality.awkward': '通じるけど不自然',
  'quality.wrong': '誤解を招く',
  'speaker.staff': '店員',
  'speaker.officer': '審査官',
  'speaker.passerby': '通行人',
  'speaker.server': '店員',
  'speaker.barista': 'バリスタ',
  'speaker.clerk': '係員',
  'speaker.receptionist': 'フロント',

  'interval.new': '新規',
  'interval.now': '今',
  'interval.min': '{n}分',
  'interval.hr': '{n}時間',
  'interval.day': '{n}日',
  'interval.mo': '{n}か月',
};

const DICTS = { en, ja };

/** Interface languages there are dictionaries for. */
export const UI_LANGS = Object.keys(DICTS);

/** For tools/selftest.mjs, which checks every key used is defined and translated. */
export const dictionaries = DICTS;

let lang = 'en';

/** Switch the interface language; also sets <html lang> for fonts and screen readers. */
export function setLang(next) {
  lang = DICTS[next] ? next : 'en';
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang;
  }
}

export function getLang() {
  return lang;
}

/** Fill {placeholders} in a template — also used for manifest-supplied copy. */
export function fill(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export function t(key, params = {}) {
  const value = DICTS[lang][key] ?? en[key];
  if (value === undefined) return key;
  return typeof value === 'function' ? value(params) : fill(value, params);
}

export function has(key) {
  return key in DICTS[lang] || key in en;
}

/** Locale for date formatting. English keeps the device default, as before. */
export function locale() {
  return lang === 'ja' ? 'ja-JP' : undefined;
}

/** Localised "next review in …" (srs.formatInterval is the English original). */
export function formatInterval(card, DAY = 86400000, MIN = 60000) {
  if (card.state === 'new') return t('interval.new');
  const ms = card.due - Date.now();
  if (ms <= 0) return t('interval.now');
  if (ms < 60 * MIN) return t('interval.min', { n: Math.max(1, Math.round(ms / MIN)) });
  if (ms < DAY) return t('interval.hr', { n: Math.round(ms / (60 * MIN)) });
  const days = Math.round(ms / DAY);
  if (days < 30) return t('interval.day', { n: days });
  return t('interval.mo', { n: Math.round(days / 30) });
}
