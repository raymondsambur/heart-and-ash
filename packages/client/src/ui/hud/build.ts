/**
 * Build panel (bottom right): the build menu, the order list with cancel, what villagers wish for, and a read-out for the
 * building or field the player tapped (progress, what is missing, take it down). While a tool is active the pointer lays out
 * a footprint on the ground: green where it may go, red where it may not (the same `canPlace` the sim applies).
 */
import { BLUEPRINTS, BUILD_KINDS, TIER_NAMES, TIER_UNLOCK, blueprintOfKind, type OrderView, type PlaceWorld } from '@hearth/shared';
import { t, tn } from '../../i18n';
import type { DecodedWorld, PickGesture, PickResult } from '../../render/api';
import type { Focus, MapTool } from '../../state/store';
import type { UiContext } from '../context';
import { h, isTypingTarget, loadJson, saveJson } from '../dom';
import { icon } from '../icons';
import { costText, footprintOfFocus, kindLabel, orderText, previewFor, structureAt } from './buildLogic';

const KEY = 'hearth.build';

export interface BuildPanel {
  /** Give the panel a pointer event; true when the build or demolish tool took it. */
  handlePick(pick: PickResult, gesture: PickGesture): boolean;
  destroy(): void;
}

export function mountBuild(host: HTMLElement, ui: UiContext, world: DecodedWorld): BuildPanel {
  const prefs = loadJson<{ open: boolean }>(KEY, { open: false });
  const st = ui.state;
  const pw = (): PlaceWorld => ({
    world: { w: world.payload.w, h: world.payload.h, terrain: world.terrain, objects: world.objects, blight: world.blight, start: { center: world.payload.center } },
    buildings: st.get('buildings'),
    plots: st.get('plots'),
  });

  const toggle = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('build.toggle'), title: `${t('build.toggle')} (B)` });
  const head = h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, icon('hammer'), ' ', t('build.title')), toggle);
  const menu = h('div', { class: 'build-menu', role: 'list' });
  const hint = h('div', { class: 'build-hint', role: 'status', 'aria-live': 'polite' });
  const focusCard = h('div', { class: 'build-focus' });
  const orders = h('div', { class: 'build-orders', role: 'list', 'aria-label': t('build.orders') });
  const wishes = h('div', { class: 'build-wishes', 'aria-label': t('build.wishes') });
  const body = h('div', { class: 'panel-body build-body' }, menu, hint, focusCard, orders, wishes);
  const el = h('section', { class: 'panel build glass', 'aria-label': t('build.title') }, head, body);
  host.appendChild(el);

  // ---- the tool ---------------------------------------------------------------------------------------
  let last: { x: number; y: number } | null = null;

  const setTool = (tool: MapTool): void => {
    st.set('tool', tool);
    last = null;
    ui.gameView.setPlacement(null);
  };

  const showFor = (tile: { x: number; y: number }): { ok: boolean; reason?: string; origin: { x: number; y: number } } | null => {
    const tool = st.get('tool');
    if (!tool) return null;
    if (tool.t === 'build') {
      const p = previewFor(pw(), tool.kind, tool.rot, tile);
      ui.gameView.setPlacement(p.placement);
      return { ok: p.ok, reason: p.reason, origin: { x: p.placement.x, y: p.placement.y } };
    }
    const f = structureAt(st.get('buildings'), st.get('plots'), tile.x, tile.y);
    const fp = f ? footprintOfFocus(f, st.get('buildings'), st.get('plots')) : null;
    if (!f || !fp) {
      ui.gameView.setPlacement(null);
      return { ok: false, reason: t('build.nothingThere'), origin: tile };
    }
    const can = !fp.con && (f.plot !== undefined || blueprintOfKind(fp.kind) !== null);
    ui.gameView.setPlacement({ x: fp.x, y: fp.y, w: fp.w, d: fp.d, tone: can ? 'demolish' : 'bad' });
    return { ok: can, reason: fp.con ? t('build.busy') : t('build.cannotTakeDown'), origin: { x: fp.x, y: fp.y } };
  };

  const handlePick = (pick: PickResult, gesture: PickGesture): boolean => {
    const tool = st.get('tool');
    if (!tool) return false;
    if (gesture === 'context') {
      setTool(null);
      return true;
    }
    const tile = { x: pick.x, y: pick.y };
    if (gesture === 'hover') {
      showFor(tile);
      last = tile;
      return true;
    }
    // A tap on a spot that is already marked confirms it; the first tap on a touch screen only moves the marker.
    const before = last ? showFor(last) : null;
    const now = showFor(tile);
    last = tile;
    if (!now) return true;
    if (!now.ok) {
      if (now.reason) ui.toast(now.reason, 'warn');
      return true;
    }
    if (before && before.origin.x === now.origin.x && before.origin.y === now.origin.y) {
      if (tool.t === 'build') ui.session.build(tool.kind, now.origin.x, now.origin.y, tool.rot);
      else {
        const f = structureAt(st.get('buildings'), st.get('plots'), tile.x, tile.y);
        if (f) ui.session.demolish(f);
        setTool(null);
      }
    }
    return true;
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || isTypingTarget(ev.target)) return;
    const tool = st.get('tool');
    if (ev.key === 'Escape' && tool) setTool(null);
    else if (ev.key === 'b' || ev.key === 'B') {
      prefs.open = !prefs.open;
      saveJson(KEY, prefs);
      render();
    } else if ((ev.key === 'r' || ev.key === 'R') && tool?.t === 'build' && BLUEPRINTS[tool.kind].rotates) {
      st.set('tool', { ...tool, rot: !tool.rot });
      if (last) showFor(last);
    }
  };
  window.addEventListener('keydown', onKey);

  // ---- drawing the panel -------------------------------------------------------------------------------
  toggle.onclick = () => {
    prefs.open = !prefs.open;
    saveJson(KEY, prefs);
    render();
  };

  const bar = (pct: number): HTMLElement => h('div', { class: 'build-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, h('div', { class: 'build-bar-fill', style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));

  const needsLine = (o: OrderView): HTMLElement | null => {
    const open = o.needs.filter((n) => n.have < n.need);
    if (o.mode !== 'build' || !open.length) return null;
    return h('div', { class: 'build-needs' }, open.map((n) => h('span', { class: 'build-need' }, `${t(`stock.${n.good}`)} ${n.have}/${n.need}`)));
  };

  const orderRow = (o: OrderView): HTMLElement => {
    const tx = orderText(o);
    return h(
      'div',
      { class: 'build-order', role: 'listitem', dataset: { mode: o.mode } },
      h(
        'button',
        { class: 'build-order-main', type: 'button', title: t('build.look'), onclick: () => ui.gameView.centerOn(o.x + o.w / 2, o.y + o.d / 2) },
        h('span', { class: 'build-order-title' }, o.mode === 'build' ? o.label : o.mode === 'demolish' ? t('build.takingDown', { what: o.label }) : t('build.clearing', { what: o.label })),
        h('span', { class: 'build-order-status' }, `${tx.status} · ${Math.round(o.overall)}%`),
      ),
      h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('build.cancelOrder'), title: t('build.cancelOrder'), onclick: () => ui.session.cancelOrder(o.id) }, icon('close')),
      bar(o.overall),
      o.waiting ? h('div', { class: 'build-waiting' }, o.waiting) : null,
      needsLine(o),
      h('div', { class: 'build-workers' }, o.workers > 0 ? tn('build.workers', o.workers) : t('build.noWorkers')),
    );
  };

  const renderFocus = (): void => {
    const f: Focus | null = st.get('focus');
    const fp = f ? footprintOfFocus(f, st.get('buildings'), st.get('plots')) : null;
    if (!f || !fp) {
      focusCard.replaceChildren();
      focusCard.hidden = true;
      return;
    }
    focusCard.hidden = false;
    const o = st.get('orders').find((x) => (f.building !== undefined ? x.building === f.building : x.plot === f.plot));
    const canDown = !o && (f.plot !== undefined || blueprintOfKind(fp.kind) !== null);
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'build-focus-head' }, h('strong', {}, kindLabel(fp.kind)), h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('common.close'), onclick: () => st.set('focus', null) }, icon('close'))),
      o ? h('div', { class: 'build-focus-body' }, h('div', {}, `${orderText(o).status} · ${Math.round(o.overall)}%`), bar(o.overall), o.waiting ? h('div', { class: 'build-waiting' }, o.waiting) : null, needsLine(o)) : h('div', { class: 'build-focus-body' }, t('build.standing')),
      o ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ui.session.cancelOrder(o.id) }, t('build.cancelOrder')) : null,
      canDown ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ui.session.demolish(f) }, t('build.takeDown')) : null,
    ];
    focusCard.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
  };

  function render(): void {
    el.classList.toggle('collapsed', !prefs.open);
    toggle.replaceChildren(icon(prefs.open ? 'chevron-down' : 'chevron-up'));
    toggle.setAttribute('aria-expanded', String(prefs.open));
    const tool = st.get('tool');
    const n = st.get('orders').length;
    menu.replaceChildren(
      ...BUILD_KINDS.map((k) => {
        const bp = BLUEPRINTS[k];
        const active = tool?.t === 'build' && tool.kind === k;
        const need = TIER_UNLOCK[k] ?? 0;
        const locked = st.get('status').tier < need;
        const why = locked ? `A ${TIER_NAMES[need]} is needed to raise this: ${st.get('outside').nextTier ?? ''}` : bp.blurb;
        return h(
          'button',
          { class: ['build-kind', active && 'active', locked && 'locked'], type: 'button', role: 'listitem', 'aria-pressed': String(active), 'aria-disabled': String(locked), title: why, onclick: () => (locked ? ui.toast(why, 'warn') : setTool(active ? null : { t: 'build', kind: k, rot: tool?.t === 'build' ? tool.rot : false })) },
          h('span', { class: 'build-kind-name' }, bp.label),
          h('span', { class: 'build-kind-size' }, `${bp.w}×${bp.d}`),
          h('span', { class: 'build-kind-cost' }, locked ? `Needs a ${TIER_NAMES[need]}` : costText(k) || t('build.free')),
        );
      }),
      h('button', { class: ['build-kind', 'build-demolish', tool?.t === 'demolish' && 'active'], type: 'button', role: 'listitem', 'aria-pressed': String(tool?.t === 'demolish'), title: t('build.demolishBlurb'), onclick: () => setTool(tool?.t === 'demolish' ? null : { t: 'demolish' }) }, h('span', { class: 'build-kind-name' }, icon('pickaxe'), ' ', t('build.demolish')), h('span', { class: 'build-kind-cost' }, t('build.demolishBlurb'))),
    );
    hint.textContent = !tool ? '' : tool.t === 'demolish' ? t('build.hintDemolish') : BLUEPRINTS[tool.kind].rotates ? t('build.hintRotate', { what: BLUEPRINTS[tool.kind].label }) : t('build.hintPlace', { what: BLUEPRINTS[tool.kind].label });
    hint.hidden = !tool;
    body.hidden = !prefs.open && !tool && n === 0 && st.get('focus') === null;
    renderFocus();
    orders.replaceChildren(...(n ? [h('div', { class: 'build-sub' }, tn('build.ordersCount', n)), ...st.get('orders').map(orderRow)] : []));
    const ws = st.get('wishes');
    wishes.replaceChildren(...(ws.length ? [h('div', { class: 'build-sub' }, t('build.wishes')), ...ws.slice(0, 4).map((w) => h('button', { class: 'build-wish', type: 'button', onclick: () => ui.session.select(w.who) }, `${w.name}: ${w.wish}`))] : []));
    menu.hidden = !prefs.open;
  }
  render();
  const unsub = st.subscribe(['orders', 'wishes', 'tool', 'focus', 'buildings', 'plots', 'status'], render);

  return {
    handlePick,
    destroy() {
      unsub();
      window.removeEventListener('keydown', onKey);
      ui.gameView.setPlacement(null);
      el.remove();
    },
  };
}
