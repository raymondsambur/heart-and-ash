/** Bottom-centre time controls: pause, 1x, 2x, 4x. The buttons only ask; the highlight follows what the server reports. */
import type { Speed } from '@hearth/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h, isTypingTarget } from '../dom';
import { icon } from '../icons';

interface Control {
  speed: Speed;
  label: string;
  key: string;
  title: string;
}

const CONTROLS: Control[] = [
  { speed: 0, label: '', key: 'Space', title: 'time.pause' },
  { speed: 1, label: '1x', key: '1', title: 'time.speed1' },
  { speed: 2, label: '2x', key: '2', title: 'time.speed2' },
  { speed: 4, label: '4x', key: '3', title: 'time.speed4' },
];

export function mountTimeControls(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const badge = h('div', { class: 'paused-badge', role: 'status' }, t('time.paused'));
  const buttons = CONTROLS.map((c) =>
    h(
      'button',
      {
        class: 'btn btn-sm timebar-btn',
        type: 'button',
        dataset: { speed: c.speed },
        'aria-pressed': 'false',
        'aria-label': t(c.title),
        title: `${t(c.title)} (${c.key})`,
        onclick: (ev: Event) => {
          ui.session.setSpeed(c.speed);
          // Space should pause, not press this button again.
          (ev.currentTarget as HTMLElement).blur();
        },
      },
      c.speed === 0 ? icon('pause') : c.label,
    ),
  );
  const bar = h('div', { class: 'timebar glass', role: 'group', 'aria-label': t('time.controls') }, buttons);
  host.append(badge, bar);

  const update = () => {
    const speed = ui.state.get('speed');
    CONTROLS.forEach((c, i) => buttons[i].setAttribute('aria-pressed', String(c.speed === speed)));
    badge.hidden = speed !== 0;
  };
  update();
  const unsub = ui.state.subscribe('speed', update);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || isTypingTarget(ev.target)) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      // Space toggles between paused and the last running speed.
      const cur = ui.state.get('speed');
      ui.session.setSpeed(cur === 0 ? lastRunning : 0);
      return;
    }
    const c = CONTROLS.find((x) => x.speed !== 0 && x.key === ev.key);
    if (c) ui.session.setSpeed(c.speed);
  };
  let lastRunning: Speed = 1;
  const unsubRun = ui.state.subscribe('speed', () => {
    const s = ui.state.get('speed');
    if (s !== 0) lastRunning = s;
  });
  window.addEventListener('keydown', onKey);
  return {
    destroy() {
      window.removeEventListener('keydown', onKey);
      unsub();
      unsubRun();
      badge.remove();
      bar.remove();
    },
  };
}
