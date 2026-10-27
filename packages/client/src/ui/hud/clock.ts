/** Top-right clock: time-of-day icon, time, date and the weather. */
import { SEASONS } from '@hearth/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { PHASE_ICON, WEATHER_ICON, clockText, dayPhase, seasonName } from '../format';
import { icon } from '../icons';

export function mountClock(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const phase = h('span', { class: 'clock-phase', 'aria-hidden': 'true' });
  const time = h('span', { class: 'clock-time' });
  const date = h('span', { class: 'clock-date' });
  const wGlyph = h('span', { class: 'clock-weather-glyph', 'aria-hidden': 'true' });
  const wText = h('span', { class: 'clock-weather-text' });
  const el = h(
    'div',
    { class: 'clock glass', role: 'timer', 'aria-live': 'off', 'aria-label': t('clock.label') },
    phase,
    h('span', { class: 'clock-main' }, time, date),
    h('span', { class: 'clock-weather' }, wGlyph, wText),
  );
  host.appendChild(el);

  const update = () => {
    const tv = ui.state.get('time');
    if (!tv) return;
    const p = dayPhase(tv.hours);
    phase.replaceChildren(icon(PHASE_ICON[p]));
    phase.dataset.phase = p;
    time.textContent = clockText(tv.hours);
    date.textContent = t('clock.date', { day: tv.dayOfSeason, season: seasonName(tv.season), year: tv.year + 1 });
    wGlyph.replaceChildren(icon(WEATHER_ICON[tv.weather]));
    wText.textContent = t(`weather.${tv.weather}`);
    el.title = `${t(`clock.${p}`)} · ${t(`weather.${tv.weather}`)} · ${SEASONS[tv.season]}`;
  };
  update();
  const unsub = ui.state.subscribe('time', update);
  return {
    destroy() {
      unsub();
      el.remove();
    },
  };
}
