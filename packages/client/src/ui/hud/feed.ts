/** Events feed (bottom left): births, deaths, quarrels, dreams, arrivals. Tap a line to look at the first person it names. */
import { SEASONS } from '@hearth/shared';
import type { FeedEntry } from '@hearth/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h, isNarrow, loadJson, saveJson } from '../dom';
import { icon } from '../icons';

const KEY = 'hearth.feed';
const SHORT = 5;
const LONG = 40;

/** Feed kinds that deserve a colour. */
const TONE: Record<string, string> = { death: 'bad', crime: 'bad', fight: 'warn', wound: 'warn', illness: 'warn', birth: 'good', love: 'good', ambition: 'good', arrive: 'info', raid: 'bad', plague: 'bad', cold: 'warn', harvest: 'warn', blight: 'warn', refugees: 'info', master: 'good' };

export function mountFeed(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const prefs = loadJson<{ open: boolean }>(KEY, { open: false });
  void isNarrow;
  const title = h('span', { class: 'panel-title' }, t('feed.title'));
  const toggle = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('feed.toggle'), title: t('feed.toggle') });
  const list = h('div', { class: 'feed-list', role: 'log', 'aria-live': 'polite', 'aria-label': t('feed.title') });
  const el = h('section', { class: 'panel feed glass', 'aria-label': t('feed.title') }, h('div', { class: 'panel-head' }, title, toggle), list);
  host.appendChild(el);

  toggle.onclick = () => {
    prefs.open = !prefs.open;
    saveJson(KEY, prefs);
    render();
  };

  const when = (f: FeedEntry): string => {
    const dayOfSeason = (f.day % 24) + 1;
    return t('feed.when', { day: dayOfSeason, season: t(`season.${SEASONS[Math.floor(f.day / 24) % 4].toLowerCase()}`), hour: String(f.hour).padStart(2, '0') });
  };

  function render(): void {
    const feed = ui.state.get('feed').slice(-(prefs.open ? LONG : SHORT));
    el.classList.toggle('expanded', prefs.open);
    toggle.replaceChildren(icon(prefs.open ? 'chevron-down' : 'chevron-up'));
    toggle.setAttribute('aria-expanded', String(prefs.open));
    list.replaceChildren(
      ...(feed.length
        ? feed.map((f) =>
            h(
              'button',
              { class: ['feed-line', `tone-${TONE[f.kind] ?? 'plain'}`], type: 'button', title: when(f), onclick: () => f.people[0] !== undefined && ui.session.select(f.people[0]) },
              h('span', { class: 'feed-when' }, when(f)),
              h('span', { class: 'feed-text' }, f.text),
            ),
          )
        : [h('div', { class: 'feed-empty' }, t('feed.empty'))]),
    );
    list.scrollTop = list.scrollHeight;
  }
  render();
  const unsub = ui.state.subscribe('feed', render);
  return {
    destroy() {
      unsub();
      el.remove();
    },
  };
}
