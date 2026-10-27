/**
 * Connection feedback: a banner while the socket reconnects, and a full-screen card when the connection ended for good
 * (the village was opened somewhere else, the session ended, or the client is out of date).
 */
import { t } from '../../i18n';
import type { GameSocket } from '../../net/socket';
import type { UiContext } from '../context';
import { h } from '../dom';

export function mountConnection(host: HTMLElement, ui: UiContext, socket: GameSocket): { destroy(): void } {
  const text = h('span', {});
  const retry = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => socket.retryNow() }, t('conn.retryNow'));
  const banner = h('div', { class: 'conn glass', role: 'status', hidden: true }, text, retry);
  let overlay: HTMLElement | null = null;
  host.appendChild(banner);

  const card = (title: string, body: string, action: { label: string; run: () => void }): HTMLElement =>
    h(
      'div',
      { class: 'hud-overlay', role: 'alertdialog', 'aria-labelledby': 'conn-title' },
      h('div', { class: 'hud-overlay-card glass' }, h('h2', { id: 'conn-title' }, title), h('p', {}, body), h('button', { class: 'btn btn-primary', type: 'button', onclick: action.run }, action.label)),
    );

  let timer: ReturnType<typeof setInterval> | null = null;
  const update = () => {
    const c = ui.state.get('conn');
    if (timer) clearInterval(timer);
    timer = null;
    banner.hidden = true;
    if (c.state === 'connecting') {
      banner.hidden = false;
      text.textContent = t('conn.connecting');
      retry.hidden = true;
    } else if (c.state === 'reconnecting') {
      banner.hidden = false;
      retry.hidden = false;
      const until = Date.now() + (c.retryIn ?? 0);
      const tick = () => {
        const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        text.textContent = c.retryIn ? t('conn.retryIn', { n: left }) : t('conn.reconnecting');
      };
      tick();
      timer = setInterval(tick, 500);
    } else if (c.state === 'closed' && c.reason && c.reason !== 'logout' && !overlay) {
      const r = c.reason;
      overlay =
        r === 'replaced'
          ? card(t('conn.replaced.title'), t('conn.replaced.text'), { label: t('conn.reload'), run: () => ui.reload() })
          : r === 'outdated'
            ? card(t('conn.outdated.title'), t('conn.outdated.text'), { label: t('conn.reload'), run: () => ui.reload() })
            : card(t('conn.auth.title'), t('conn.auth.text'), { label: t('conn.signin'), run: () => ui.reauth() });
      host.appendChild(overlay);
    }
  };
  update();
  const unsub = ui.state.subscribe('conn', update);
  return {
    destroy() {
      unsub();
      if (timer) clearInterval(timer);
      banner.remove();
      overlay?.remove();
    },
  };
}
