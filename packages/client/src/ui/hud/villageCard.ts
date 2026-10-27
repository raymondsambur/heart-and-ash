/** Top-left village card: name, population, the stockpile summary and the way out. */
import { t, tn } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { STOCK_ICON, fmtCompact } from '../format';
import { icon } from '../icons';

/** The goods shown on the card, in order; anything else the server sends is ignored here. */
const SHOWN = ['ration', 'wood', 'planks', 'stone'];

export function mountVillageCard(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const name = h('div', { class: 'vcard-name' });
  const sub = h('div', { class: 'vcard-sub' });
  const leave = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('village.leave'), title: t('village.leave'), onclick: () => ui.logout() }, icon('login'));
  const items = new Map<string, HTMLElement>();
  const stock = h(
    'div',
    { class: 'vcard-stock', role: 'list', 'aria-label': t('village.stock') },
    SHOWN.map((g) => {
      const qty = h('span', { class: 'stock-qty' }, '0');
      items.set(g, qty);
      return h('div', { class: 'stock-item', role: 'listitem', title: t(`stock.${g}`) }, icon(STOCK_ICON[g] ?? 'bag'), qty, h('span', {}, t(`stock.${g}`)));
    }),
  );
  const el = h(
    'section',
    { class: 'vcard glass', 'aria-label': t('village.card') },
    h('div', { class: 'vcard-head' }, h('span', { class: 'vcard-seal', 'aria-hidden': 'true' }, icon('logo')), h('div', { class: 'vcard-titles' }, name, sub), leave),
    stock,
  );
  host.appendChild(el);

  const update = () => {
    const v = ui.state.get('village');
    name.textContent = v?.name ?? t('app.title');
    sub.textContent = tn('village.population', ui.state.get('population'));
    const s = ui.state.get('stock');
    // Food is raw rations and cooked meals together (a meal feeds as well as a ration).
    for (const g of SHOWN) items.get(g)!.textContent = fmtCompact((s[g] ?? 0) + (g === 'ration' ? (s.meal ?? 0) : 0));
  };
  update();
  const unsub = ui.state.subscribe(['village', 'population', 'stock'], update);
  return {
    destroy() {
      unsub();
      el.remove();
    },
  };
}
