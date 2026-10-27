/**
 * Dev tools, offered only when the server runs in dev mode: a small button by the time controls that opens a panel with a
 * fast-forward (10, 30, 50, 100 days or any number), its progress and an undo. The buttons only ask; the server does the work.
 */
import { MAX_SKIP_DAYS } from '@hearth/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { clear, h } from '../dom';

const QUICK = [10, 30, 50, 100];

export function mountDevTools(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const { state, session } = ui;
  let open = false;

  const toggle = h('button', { class: 'btn btn-sm dev-toggle', type: 'button', 'aria-expanded': 'false', title: t('dev.toggle'), onclick: () => ((open = !open), update()) }, 'DEV');
  const input = h('input', { class: 'dev-days', type: 'number', min: '1', max: String(MAX_SKIP_DAYS), step: '1', value: '50', 'aria-label': t('dev.days') });
  const go = () => {
    const n = Math.floor(Number(input.value));
    if (Number.isFinite(n) && n >= 1) session.devSkip(Math.min(n, MAX_SKIP_DAYS));
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') go();
    ev.stopPropagation();
  };
  const quick = QUICK.map((n) => h('button', { class: 'btn btn-sm', type: 'button', onclick: () => session.devSkip(n) }, `+${n}`));
  const progress = h('progress', { class: 'dev-progress', max: '1', value: '0' });
  const progressText = h('span', { class: 'dev-progress-text' });
  const stop = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => session.devSkip(0) }, t('dev.stop'));
  const running = h('div', { class: 'dev-running' }, progress, progressText, stop);
  const undo = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => session.devUndo() }, t('dev.undo'));
  const panel = h(
    'div',
    { class: 'dev-panel glass', role: 'group', 'aria-label': t('dev.title') },
    h('div', { class: 'dev-title' }, t('dev.skip')),
    h('div', { class: 'dev-row' }, quick),
    h('div', { class: 'dev-row' }, input, h('button', { class: 'btn btn-sm', type: 'button', onclick: go }, t('dev.go'))),
    running,
    h('div', { class: 'dev-row' }, undo),
    h('p', { class: 'dev-hint' }, t('dev.hint')),
  );
  const root = h('div', { class: 'devtools' }, toggle, panel);
  host.append(root);

  const update = () => {
    const on = state.get('dev');
    const skip = state.get('devSkip');
    root.hidden = !on;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('dev-busy', skip !== null);
    running.hidden = skip === null;
    if (skip) {
      const done = Math.max(0, skip.total - skip.left);
      progress.max = skip.total;
      progress.value = done;
      clear(progressText);
      progressText.append(t('dev.progress', { done: Math.round(done * 10) / 10, total: skip.total }));
    }
    undo.disabled = !state.get('devUndo');
  };
  update();
  const unsub = state.subscribe(['dev', 'devSkip', 'devUndo'], update);
  return {
    destroy() {
      unsub();
      root.remove();
    },
  };
}
