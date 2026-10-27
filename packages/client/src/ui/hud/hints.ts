/**
 * First-run hints (M5): one small card at a time that says what to try next, ticked off by what the player does and never shown
 * again once done or dismissed. Everything is stored in the browser; nothing about it reaches the server.
 */
import { addStrings, t } from '../../i18n';
import type { UiContext } from '../context';
import { h, loadJson, saveJson } from '../dom';
import { icon } from '../icons';

addStrings({
  'hint.look': 'Click a villager to see who they are, what they need, and why they do what they do.',
  'hint.build': 'Press B for the build menu, pick a house and click open ground twice. The villagers fetch the materials and raise it, and you can watch every stage.',
  'hint.manage': 'Open Manage (bottom right). Press "Add suggested rules" on the Rules tab so the village looks after itself, or set priorities on Work.',
  'hint.away': 'You may close the game whenever you like. The village keeps living on its rules for a while, and writes a report of what happened when you come back.',
  'hint.step': 'Hint {n} of {total}',
  'hint.dismiss': 'Got it',
  'hint.hideAll': 'Hide hints',
});

const KEY = 'hearth.hints';
const STEPS = ['look', 'build', 'manage', 'away'] as const;
type Step = (typeof STEPS)[number];

export function mountHints(layers: HTMLElement, ui: UiContext): { destroy(): void } {
  const prefs = loadJson<{ done: Step[]; off: boolean }>(KEY, { done: [], off: false });
  const st = ui.state;
  const card = h('section', { class: 'hint panel glass', role: 'status', 'aria-live': 'polite', hidden: true });
  layers.appendChild(card);

  const mark = (s: Step): void => {
    if (prefs.done.includes(s)) return;
    prefs.done.push(s);
    saveJson(KEY, prefs);
  };

  /** What the player has already done tells which hints they no longer need. */
  const observe = (): void => {
    if (st.get('selected') !== null) mark('look');
    if (st.get('orders').length > 0 || st.get('buildings').length > 6) mark('build');
    const p = st.get('policy');
    if (p.rules.length > 0 || p.priorities.some((x) => x !== 2) || st.get('status').rationing !== 0) mark('manage');
  };

  const render = (): void => {
    observe();
    const next = STEPS.find((s) => !prefs.done.includes(s));
    // The hints wait until the village is on screen and a decision card is not in the way.
    if (prefs.off || !next || st.get('time') === null || st.get('policy').offers.length > 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const n = STEPS.indexOf(next) + 1;
    card.replaceChildren(
      h('span', { class: 'seal', 'aria-hidden': 'true' }, icon('book')),
      h(
        'div',
        { class: 'hint-text' },
        h('div', { class: 'hint-step' }, t('hint.step', { n, total: STEPS.length })),
        h('div', {}, t(`hint.${next}`)),
        h(
          'div',
          { class: 'hint-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (mark(next), render()) }, t('hint.dismiss')),
          ' ',
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => ((prefs.off = true), saveJson(KEY, prefs), render()) }, t('hint.hideAll')),
        ),
      ),
    );
  };
  render();
  const unsub = st.subscribe(['selected', 'orders', 'buildings', 'policy', 'status', 'time'], render);
  return {
    destroy() {
      unsub();
      card.remove();
    },
  };
}
