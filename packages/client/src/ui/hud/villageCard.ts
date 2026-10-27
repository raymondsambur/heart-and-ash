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
  // days of food and fuel, the rations lever and the alert line (M3)
  const foodDays = h('span', { class: 'vstat-val' }, '');
  const fuelDays = h('span', { class: 'vstat-val' }, '');
  const foodBox = h('div', { class: 'vstat', title: t('status.food.title') }, h('span', {}, t('status.food')), foodDays);
  const fuelBox = h('div', { class: 'vstat', title: t('status.fuel.title') }, h('span', {}, t('status.fuel')), fuelDays);
  const rationBtns = ([0, 1, 2] as const).map((l) => h('button', { class: 'btn btn-sm vration', type: 'button', 'aria-pressed': 'false', onclick: () => ui.session.setRation(l) }, t(`status.rations.${l}`)));
  const rations = h('div', { class: 'vrations', role: 'group', 'aria-label': t('status.rations'), title: t('status.rations.title') }, h('span', { class: 'vrations-label' }, t('status.rations')), ...rationBtns);
  const alert = h('div', { class: 'valert', role: 'status', hidden: true });
  const el = h(
    'section',
    { class: 'vcard glass', 'aria-label': t('village.card') },
    h('div', { class: 'vcard-head' }, h('span', { class: 'vcard-seal', 'aria-hidden': 'true' }, icon('logo')), h('div', { class: 'vcard-titles' }, name, sub), leave),
    stock,
    h('div', { class: 'vstats' }, foodBox, fuelBox),
    rations,
    alert,
  );
  host.appendChild(el);

  const update = () => {
    const v = ui.state.get('village');
    name.textContent = v?.name ?? t('app.title');
    sub.textContent = tn('village.population', ui.state.get('population'));
    const s = ui.state.get('stock');
    // Food is raw rations and cooked meals together (a meal feeds as well as a ration).
    for (const g of SHOWN) items.get(g)!.textContent = fmtCompact((s[g] ?? 0) + (g === 'ration' ? (s.meal ?? 0) : 0));
    const st = ui.state.get('status');
    foodDays.textContent = t('status.days', { n: String(Math.round(st.foodDays)) });
    fuelDays.textContent = st.fuelDays >= 99 ? '-' : t('status.days', { n: String(Math.round(st.fuelDays)) });
    foodBox.classList.toggle('low', st.foodDays < 8);
    // Wood only becomes a worry once autumn has come: in spring the winter is far off.
    fuelBox.classList.toggle('low', st.fuelDays < 8 && (ui.state.get('time')?.season ?? 0) >= 2);
    rationBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(st.rationing === i)));
    const msg = st.alert ? t(`status.alert.${st.alert}`) : st.blight > 0 ? t('status.blight', { n: String(st.blight) }) : '';
    alert.hidden = msg === '';
    alert.textContent = msg;
    alert.classList.toggle('bad', st.alert !== null);
  };
  update();
  const unsub = ui.state.subscribe(['village', 'population', 'stock', 'status', 'time'], update);
  return {
    destroy() {
      unsub();
      el.remove();
    },
  };
}
