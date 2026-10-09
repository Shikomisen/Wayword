/**
 * home.js — the language picker at #/.
 *
 * Two choices, top to bottom: the language you speak, then the language you
 * want to learn. Picking a speaker re-labels the whole page in that
 * language and lists only the courses taught from it; each course card says
 * where you are in it (due today, not started, coming soon) so the daily
 * habit is still one tap from launch.
 *
 * Course progress is read through deck.courseSnapshot(), which takes the
 * course explicitly and writes nothing — drawing this page never activates
 * a course or creates storage for one nobody has opened.
 */

import * as course from './course.js';
import * as deck from './deck.js';
import { t, setLang } from './i18n.js';
import { el, clear } from './render.js';
import { VERSION } from './version.js';

export async function renderHome(root) {
  const registry = await course.loadCourses();
  const prefs = await course.getPrefs();
  let speaker = registry.speakers.includes(prefs.speaker)
    ? prefs.speaker
    : course.guessSpeaker(registry.speakers);

  const view = el('div', { class: 'screen home-picker' });
  root.append(view);

  async function draw() {
    await setLang(speaker);
    const cards = await Promise.all(
      registry.courses.filter((c) => c.speaker === speaker).map((c) => courseCard(c, speaker)));

    clear(view).append(
      el('header', { class: 'home-hero' },
        el('h1', { class: 'brand' }, 'Wayword'),
        el('p', { class: 'lede' }, t('home.tagline'))),

      el('section', { class: 'picker-section' },
        el('h2', { class: 'section-title', id: 'speaker-label' }, t('home.speaker')),
        el('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'speaker-label' },
          registry.speakers.map((code) =>
            el('button', {
              type: 'button',
              class: code === speaker ? 'segment is-on' : 'segment',
              'aria-pressed': code === speaker ? 'true' : 'false',
              lang: code,
              dataset: { speaker: code },
              onclick: async () => {
                if (code === speaker) return;
                speaker = code;
                await course.savePrefs({ speaker });
                draw();
              },
            }, course.languageInfo(code).native)))),

      el('section', { class: 'picker-section' },
        el('h2', { class: 'section-title' }, t('home.learn')),
        el('div', { class: 'course-list' }, cards)),

      // Which version this phone has — Settings shows it too, with a way to update.
      el('footer', { class: 'home-footer' }, `Wayword ${VERSION}`));
  }

  await draw();
}

async function courseCard(c, speaker) {
  const info = course.languageInfo(c.target);
  const planned = c.status !== 'available';

  let status;
  if (planned) {
    status = t('home.comingSoonSub');
  } else {
    const snap = await deck.courseSnapshot(c.id);
    status = !snap.onboarded
      ? t('home.notStarted')
      : snap.due ? t('home.due', { n: snap.due }) : t('home.caughtUp');
  }

  return el('a', {
    class: planned ? 'course-card is-planned' : 'course-card',
    href: `#/${c.id}/`,
    dataset: { course: c.id },
  },
    el('span', { class: 'course-badge', lang: c.target }, info.badge),
    el('span', { class: 'course-body' },
      el('span', { class: 'course-name' }, course.languageName(c.target, speaker)),
      el('span', { class: 'course-native', lang: c.target }, info.native),
      el('span', { class: 'course-status' }, status)),
    planned
      ? el('span', { class: 'pill' }, t('home.comingSoon'))
      : el('span', { class: 'row-chev' }, '›'));
}

/** A course that exists on the home page but has no content yet (Indonesian). */
export function renderPlannedCourse(root, c) {
  const info = course.languageInfo(c.target);
  root.append(
    el('div', { class: 'screen planned-course' },
      el('div', { class: 'empty-state' },
        el('div', { class: 'course-badge course-badge-lg', lang: c.target }, info.badge),
        el('h1', {}, t('planned.title', { lang: course.languageName(c.target, c.speaker) })),
        el('p', { class: 'lede', lang: c.target }, info.native),
        el('p', { class: 'muted' }, t('planned.body')),
        el('a', { class: 'btn btn-primary', href: '#/' }, t('planned.back')))));
}
