/** The villager sheet (top right, below the clock): needs, mood, skills, traits, dreams, ties, memories, and why they do what they do. */
import type { PersonSheet } from '@hearth/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { append, h, mount, type Child } from '../dom';
import { icon } from '../icons';
import { moodClass } from './moodClass';

const needClass = (v: number): string => (v >= 55 ? 'mood-good' : v >= 30 ? 'mood-ok' : v >= 10 ? 'mood-low' : 'mood-bad');

function bar(value: number, cls: string, label: string): HTMLElement {
  return h('div', { class: 'bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(value)), 'aria-label': label }, h('div', { class: ['bar-fill', cls], style: { width: `${Math.max(0, Math.min(100, value))}%` } }));
}

function section(title: string, ...body: Child[]): HTMLElement {
  return h('div', { class: 'sheet-sec' }, h('h4', {}, title), ...body);
}

export function mountSheet(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const portrait = h('canvas', { class: 'sheet-portrait', width: 64, height: 80, 'aria-hidden': 'true' });
  const name = h('div', { class: 'sheet-name' });
  const sub = h('div', { class: 'sheet-sub' });
  const follow = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title: t('sheet.follow'), 'aria-label': t('sheet.follow'), 'aria-pressed': 'false', onclick: () => ui.session.setFollow(!ui.state.get('follow')) }, icon('target'));
  const close = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title: t('common.close'), 'aria-label': t('common.close'), onclick: () => ui.session.select(null) }, icon('close'));
  const body = h('div', { class: 'sheet-body' });
  const el = h('section', { class: 'panel sheet glass', 'aria-label': t('sheet.title'), hidden: true }, h('div', { class: 'sheet-head' }, portrait, h('div', { class: 'sheet-titles' }, name, sub), follow, close), body);
  host.appendChild(el);

  let whyOpen = false;
  let drawnLook = '';

  function why(s: PersonSheet): HTMLElement {
    const w = s.why;
    const d = h('details', { class: 'why', open: whyOpen }, h('summary', {}, t('sheet.why')));
    d.addEventListener('toggle', () => {
      whyOpen = d.open;
    });
    append(d, [
      h('p', {}, t('sheet.why.goal', { goal: w.goal, source: w.source })),
      w.plan ? h('p', { class: 'dim' }, t('sheet.why.plan', { plan: w.plan })) : null,
      w.blocked ? h('p', { class: 'warn' }, t('sheet.why.blocked', { reason: w.blocked })) : null,
      w.top.length ? h('p', { class: 'dim' }, t('sheet.why.others'), ' ', w.top.map((x) => `${x.label} (${x.score})`).join('; ')) : null,
    ]);
    return d;
  }

  function render(): void {
    const s = ui.state.get('sheet');
    const sel = ui.state.get('selected');
    el.hidden = sel === null;
    host.closest('.hud')?.toggleAttribute('data-sheet', sel !== null);
    follow.setAttribute('aria-pressed', String(ui.state.get('follow')));
    if (sel === null) return;
    if (!s || s.id !== sel) {
      name.textContent = t('common.loading');
      sub.textContent = '';
      body.replaceChildren();
      return;
    }
    const lookKey = JSON.stringify(s.look);
    if (lookKey !== drawnLook) {
      drawnLook = lookKey;
      ui.portrait(portrait, s.look);
    }
    name.textContent = s.name;
    sub.textContent = t('sheet.sub', { title: s.title, age: s.age, home: s.home });
    mount(
      body,
      section(
        t('sheet.now'),
        h('p', { class: 'sheet-doing' }, s.doing),
        why(s),
        s.ills.length ? h('p', { class: 'warn' }, t('sheet.ill', { ills: s.ills.join(', ') })) : null,
      ),
      section(
        t('sheet.mood'),
        h('div', { class: 'mood-line' }, h('span', { class: ['mood-dot', moodClass(s.mood)] }), h('strong', {}, `${s.mood}`), h('span', { class: 'dim' }, s.moodWord), h('span', { class: 'dim hp' }, t('sheet.hp', { hp: s.hp, max: s.maxHp }))),
        bar(s.mood, moodClass(s.mood), t('sheet.mood')),
        s.moodCauses.length ? h('ul', { class: 'causes' }, s.moodCauses.map((c) => h('li', { class: c.v < 0 ? 'neg' : 'pos' }, `${c.v > 0 ? '+' : ''}${c.v} ${c.text}`))) : null,
      ),
      section(
        t('sheet.needs'),
        h('p', { class: 'dim' }, s.needNote),
        h(
          'div',
          { class: 'needs' },
          s.needs.map((n) => h('div', { class: 'need', title: n.state ?? '' }, h('span', { class: 'need-name' }, n.label), bar(n.value, needClass(n.value), n.label), h('span', { class: 'need-val' }, `${n.value}`))),
        ),
      ),
      s.ambitions.length
        ? section(
            t('sheet.dreams'),
            s.ambitions.map((a) =>
              h(
                'div',
                { class: ['dream', a.ended ? 'ended' : ''] },
                h('div', { class: 'dream-title' }, a.label),
                h('div', { class: 'dim' }, a.text),
                a.ended ? h('div', { class: 'dim' }, a.ended) : bar(a.progress * 100, 'mood-ok', a.label),
                a.stuck && !a.ended ? h('div', { class: 'warn' }, t('sheet.stuck', { reason: a.stuck })) : null,
              ),
            ),
          )
        : null,
      section(t('sheet.skills'), s.skills.length ? h('div', { class: 'tags' }, s.skills.map((k) => h('span', { class: 'tag', title: `${k.pct}%` }, `${k.label} ${k.lv}`))) : h('p', { class: 'dim' }, t('sheet.none'))),
      section(t('sheet.traits'), h('div', { class: 'tags' }, s.traits.map((tr) => h('span', { class: 'tag', title: tr.desc, tabindex: '0' }, tr.label)))),
      section(
        t('sheet.ties'),
        s.relations.length
          ? s.relations.map((r) => h('button', { class: 'tie', type: 'button', onclick: () => ui.session.select(r.id) }, h('span', {}, r.name), h('span', { class: 'dim' }, `${r.kind}${r.aff >= 30 ? ' +' : r.aff <= -25 ? ' -' : ''}`)))
          : h('p', { class: 'dim' }, t('sheet.none')),
      ),
      section(t('sheet.memories'), s.memories.length ? h('ul', { class: 'memories' }, s.memories.map((m) => h('li', { class: m.val < 0 ? 'neg' : m.val > 0 ? 'pos' : '' }, m.text))) : h('p', { class: 'dim' }, t('sheet.none'))),
      section(t('sheet.carrying'), h('p', { class: 'dim' }, t('sheet.carrying.line', { carrying: s.carrying, silver: s.silver, tools: s.tools }))),
    );
  }
  render();
  const unsub = ui.state.subscribe(['sheet', 'selected', 'follow'], render);
  return {
    destroy() {
      unsub();
      el.remove();
    },
  };
}
