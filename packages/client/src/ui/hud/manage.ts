/**
 * The manager's desk (M4): how the village's labour is shared (priorities), the standing rules that look after the village when
 * you are away, and the reports (daily, seasonal, and "While you were away"). Decisions the village asks for (refugees at the
 * gate) appear as a card in the middle of the screen until they are answered, and an unread away report opens as a dialog.
 */
import { BLUEPRINTS, BUILD_KINDS, CARETAKER_RULES, GROUP_LABEL, JOB_GROUPS, METRIC_LABEL, PRIORITY_LABEL, RULE_METRICS, type OfferView, type ReportView, type RuleAct, type RuleDef, type RuleMetric } from '@hearth/shared';
import { addStrings, t } from '../../i18n';
import type { UiContext } from '../context';
import { h, isTypingTarget, loadJson, saveJson } from '../dom';
import { icon } from '../icons';
import { openModal } from '../widgets/modal';
import { tabs } from '../widgets/tabs';

addStrings({
  'manage.title': 'Manage',
  'manage.toggle': 'Show or hide priorities, rules and reports (M)',
  'manage.tab.work': 'Work',
  'manage.tab.rules': 'Rules',
  'manage.tab.reports': 'Reports',
  'manage.tab.outside': 'Outside',
  'manage.outside.hint': 'The town beyond the map is not drawn. Its caravans buy what the village can spare and sell what it lacks, and its envoys ask for things. What it thinks of the village decides who comes to live here.',
  'manage.outside.regard': 'Regard',
  'manage.outside.caravan': 'Next caravan',
  'manage.outside.prices': 'The caravans pay (silver each)',
  'manage.outside.news': 'Lately heard',
  'manage.outside.nonews': 'Nothing yet.',
  'manage.outside.pact': 'A trade pact is in force.',
  'manage.work.hint': 'How much of the village’s labour goes where. People still choose for themselves, and eat, sleep and tend the sick first.',
  'manage.rules.hint': 'A rule acts while its condition holds, every game hour, even when you are away. Later rules win over earlier ones.',
  'manage.rules.empty': 'No rules yet. A rule such as "if food is under 7 days, set the rations to tight" lets the village look after itself.',
  'manage.rules.add': 'Add rule',
  'manage.rules.suggest': 'Add suggested rules',
  'manage.rules.suggest.hint': 'Rations that follow the food, a watch that turns urgent when raiders are expected, firewood in autumn, and a few buildings as the village needs them.',
  'manage.rules.if': 'If',
  'manage.rules.then': 'then',
  'manage.rules.on': 'On',
  'manage.rules.delete': 'Remove this rule',
  'manage.rules.do.ration': 'set the rations',
  'manage.rules.do.priority': 'set the priority of',
  'manage.rules.do.build': 'order a',
  'manage.rules.ration.0': 'normal',
  'manage.rules.ration.1': 'tight',
  'manage.rules.ration.2': 'strict',
  'manage.reports.empty': 'The first report comes at the end of the first day.',
  'manage.reports.unread': 'New',
  'manage.away': 'The village is running on its own',
  'manage.crisis': 'The village stopped itself: {why}. It waits for you.',
  'manage.offer.fallback': 'If you do not answer, the village will: {what}',
  'manage.away.title': 'While you were away',
  'manage.away.close': 'Read',
});

const KEY = 'hearth.manage';
const OPS = ['<', '>', '='] as const;

/** A short name for a rule's action in the editor. */
function actLabel(a: RuleAct): string {
  if (a.t === 'ration') return `${t('manage.rules.do.ration')} ${t(`manage.rules.ration.${a.level}`)}`;
  if (a.t === 'priority') return `${t('manage.rules.do.priority')} ${GROUP_LABEL[a.group].toLowerCase()}: ${PRIORITY_LABEL[a.level].toLowerCase()}`;
  return `${t('manage.rules.do.build')} ${BLUEPRINTS[a.kind].label.toLowerCase()}`;
}

function sentence(r: RuleDef): string {
  return `${t('manage.rules.if')} ${METRIC_LABEL[r.cond.metric]} ${r.cond.op} ${r.cond.value}, ${t('manage.rules.then')} ${actLabel(r.act)}`;
}

function select<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void, label: string): HTMLSelectElement {
  const el = h('select', { class: 'manage-select', 'aria-label': label }, options.map(([v, text]) => h('option', { value: v }, text)));
  el.value = value;
  el.onchange = () => onChange(el.value as T);
  return el;
}

function reportCard(r: ReportView, ui: UiContext, open: boolean): HTMLElement {
  const card = h('details', { class: ['report', `report-${r.kind}`, r.unread ? 'unread' : ''], open }, h('summary', {}, h('span', { class: 'report-title' }, r.title), r.unread ? h('span', { class: 'report-new' }, t('manage.reports.unread')) : null));
  for (const l of r.lines) card.appendChild(h('p', { class: ['report-line', `tone-${l.tone}`] }, l.text));
  card.addEventListener('toggle', () => {
    if ((card as HTMLDetailsElement).open && r.unread) ui.session.markRead(r.id);
  });
  return card;
}

export function mountManage(host: HTMLElement, layers: HTMLElement, ui: UiContext): { destroy(): void } {
  const prefs = loadJson<{ open: boolean; tab: string }>(KEY, { open: false, tab: 'work' });
  const st = ui.state;

  const toggle = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('manage.toggle'), title: t('manage.toggle') });
  const badge = h('span', { class: 'badge', hidden: true });
  const head = h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, icon('book'), ' ', t('manage.title'), ' ', badge), toggle);
  const banner = h('div', { class: 'manage-banner', role: 'status', hidden: true });
  const work = h('div', { class: 'manage-work' });
  const rulesBox = h('div', { class: 'manage-rules' });
  const reportsBox = h('div', { class: 'manage-reports' });
  const outsideBox = h('div', { class: 'manage-outside' });
  const tabBar = tabs(
    [
      { id: 'work', label: t('manage.tab.work') },
      { id: 'rules', label: t('manage.tab.rules') },
      { id: 'reports', label: t('manage.tab.reports') },
      { id: 'outside', label: t('manage.tab.outside') },
    ],
    (id) => {
      prefs.tab = id;
      saveJson(KEY, prefs);
      showTab();
    },
    { initial: prefs.tab, label: t('manage.title') },
  );
  const body = h('div', { class: 'panel-body manage-body' }, banner, tabBar.el, work, rulesBox, reportsBox, outsideBox);
  const el = h('section', { class: 'panel manage glass', 'aria-label': t('manage.title') }, head, body);
  host.appendChild(el);

  const showTab = (): void => {
    work.hidden = prefs.tab !== 'work';
    rulesBox.hidden = prefs.tab !== 'rules';
    reportsBox.hidden = prefs.tab !== 'reports';
    outsideBox.hidden = prefs.tab !== 'outside';
  };

  // ---- work: one row per kind of work, five levels --------------------------------------------------
  const renderWork = (): void => {
    const levels = st.get('policy').priorities;
    work.replaceChildren(
      h('p', { class: 'manage-hint' }, t('manage.work.hint')),
      ...JOB_GROUPS.map((g, i) =>
        h(
          'div',
          { class: 'manage-row', role: 'group', 'aria-label': GROUP_LABEL[g] },
          h('span', { class: 'manage-row-name' }, GROUP_LABEL[g]),
          h(
            'div',
            { class: 'manage-levels' },
            PRIORITY_LABEL.map((label, lv) => h('button', { class: 'btn btn-sm manage-level', type: 'button', 'aria-pressed': String((levels[i] ?? 2) === lv), title: label, onclick: () => ui.session.setPriority(g, lv) }, label[0] === 'N' ? 'Norm' : label)),
          ),
        ),
      ),
    );
  };

  // ---- rules ------------------------------------------------------------------------------------------------
  let draft: { metric: RuleMetric; op: (typeof OPS)[number]; value: number; act: 'ration' | 'priority' | 'build'; level: number; group: (typeof JOB_GROUPS)[number]; kind: (typeof BUILD_KINDS)[number] } = { metric: 'foodDays', op: '<', value: 7, act: 'ration', level: 1, group: 'food', kind: 'house' };
  const renderRules = (): void => {
    const rules = st.get('policy').rules;
    const list = rules.length
      ? rules.map((r) =>
          h(
            'div',
            { class: ['manage-rule', r.enabled ? '' : 'off'] },
            h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': String(r.enabled), title: t('manage.rules.on'), onclick: () => ui.session.saveRule({ ...r, enabled: !r.enabled }) }, r.enabled ? t('manage.rules.on') : 'Off'),
            h('span', { class: 'manage-rule-text' }, sentence(r)),
            h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('manage.rules.delete'), title: t('manage.rules.delete'), onclick: () => ui.session.deleteRule(r.id) }, icon('close')),
          ),
        )
      : [h('p', { class: 'manage-hint' }, t('manage.rules.empty')), h('button', { class: 'btn btn-sm', type: 'button', title: t('manage.rules.suggest.hint'), onclick: () => CARETAKER_RULES.forEach((r) => ui.session.saveRule({ ...r, id: 0 })) }, t('manage.rules.suggest'))];
    const actSel = select(
      [['ration', t('manage.rules.do.ration')], ['priority', t('manage.rules.do.priority')], ['build', t('manage.rules.do.build')]] as const,
      draft.act,
      (v) => {
        draft.act = v;
        renderRules();
      },
      'action',
    );
    const second =
      draft.act === 'ration'
        ? select([['0', t('manage.rules.ration.0')], ['1', t('manage.rules.ration.1')], ['2', t('manage.rules.ration.2')]] as const, String(draft.level), (v) => (draft.level = Number(v)), 'rations')
        : draft.act === 'priority'
          ? [
              select(JOB_GROUPS.map((g) => [g, GROUP_LABEL[g]] as const), draft.group, (v) => (draft.group = v), 'work'),
              select(PRIORITY_LABEL.map((l, i) => [String(i), l] as const), String(draft.level), (v) => (draft.level = Number(v)), 'priority'),
            ]
          : select(BUILD_KINDS.map((k) => [k, BLUEPRINTS[k].label] as const), draft.kind, (v) => (draft.kind = v), 'building');
    const value = h('input', { class: 'manage-num', type: 'number', value: String(draft.value), 'aria-label': 'value', step: 'any' });
    value.oninput = () => (draft.value = Number(value.value));
    const add = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, t('manage.rules.add'));
    add.onclick = () => {
      const act: RuleAct = draft.act === 'ration' ? { t: 'ration', level: draft.level as 0 | 1 | 2 } : draft.act === 'priority' ? { t: 'priority', group: draft.group, level: draft.level } : { t: 'build', kind: draft.kind };
      ui.session.saveRule({ id: 0, enabled: true, cond: { metric: draft.metric, op: draft.op, value: draft.value }, act });
    };
    rulesBox.replaceChildren(
      h('p', { class: 'manage-hint' }, t('manage.rules.hint')),
      ...list,
      h(
        'div',
        { class: 'manage-editor' },
        h('span', {}, t('manage.rules.if')),
        select(RULE_METRICS.map((m) => [m, METRIC_LABEL[m]] as const), draft.metric, (v) => (draft.metric = v), 'condition'),
        select(OPS.map((o) => [o, o] as const), draft.op, (v) => (draft.op = v), 'comparison'),
        value,
        h('span', {}, t('manage.rules.then')),
        actSel,
        ...(Array.isArray(second) ? second : [second]),
        add,
      ),
    );
  };

  // ---- reports ----------------------------------------------------------------------------------------------
  const renderReports = (): void => {
    const reports = [...st.get('reports')].reverse();
    reportsBox.replaceChildren(...(reports.length ? reports.map((r, i) => reportCard(r, ui, i === 0 && r.unread)) : [h('p', { class: 'manage-hint' }, t('manage.reports.empty'))]));
  };

  // ---- the Outside ------------------------------------------------------------------------------------------------
  const regardWord = (r: number): string => (r >= 40 ? 'warm' : r >= 10 ? 'friendly' : r > -10 ? 'neutral' : r > -40 ? 'cool' : 'hostile');
  const renderOutside = (): void => {
    const o = st.get('outside');
    const status = st.get('status');
    const line = (text: string): HTMLElement => h('p', { class: 'outside-line' }, text);
    outsideBox.replaceChildren(
      h('p', { class: 'manage-hint' }, t('manage.outside.hint')),
      line(`${o.name || '...'}: ${t('manage.outside.regard')} ${regardWord(o.regard)} (${o.regard}), ${Math.round(status.silver)} silver in the village.`),
      line(`${t('manage.outside.caravan')}: ${o.caravanIn === null ? '-' : o.caravanIn <= 0 ? 'any day' : `in about ${o.caravanIn} days`}.${o.pact ? ` ${t('manage.outside.pact')}` : ''}`),
      line(`${t('manage.outside.prices')}: ${Object.entries(o.prices).map(([g, p]) => `${g === 'ration' ? 'food' : g} ${p}`).join(', ')}.`),
      o.nextTier ? line(`Next: ${o.nextTier}`) : line('This settlement is a town.'),
      h('p', { class: 'outside-line' }, t('manage.outside.news')),
      h('ul', { class: 'outside-news' }, (o.news.length ? o.news : [t('manage.outside.nonews')]).map((n) => h('li', {}, n))),
    );
  };

  const renderState = (): void => {
    const p = st.get('policy');
    const unread = st.get('reports').filter((r) => r.unread).length + p.offers.length;
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
    banner.hidden = !p.away && !p.crisis;
    banner.textContent = p.crisis ? t('manage.crisis', { why: p.crisis }) : p.away ? t('manage.away') : '';
    el.classList.toggle('expanded', prefs.open);
    toggle.replaceChildren(icon(prefs.open ? 'chevron-down' : 'chevron-up'));
    toggle.setAttribute('aria-expanded', String(prefs.open));
    body.hidden = !prefs.open;
  };
  const flip = (): void => {
    prefs.open = !prefs.open;
    saveJson(KEY, prefs);
    renderState();
  };
  toggle.onclick = flip;
  // M shows or hides the desk, as B does the build menu.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() !== 'm' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    flip();
  };
  window.addEventListener('keydown', onKey);

  // ---- decisions waiting: a card in the middle of the screen --------------------------------------------------------
  const offerHost = h('div', { class: 'offers', role: 'region', 'aria-label': 'Decisions' });
  layers.appendChild(offerHost);
  const offerCard = (o: OfferView): HTMLElement =>
    h(
      'section',
      { class: 'offer panel glass', role: 'alertdialog', 'aria-label': o.title },
      h('h3', { class: 'offer-title' }, o.title),
      h('p', { class: 'offer-text' }, o.text),
      h('div', { class: 'offer-options' }, o.options.map((opt) => h('button', { class: ['btn', opt.id === o.fallback ? 'btn-primary' : ''], type: 'button', title: opt.note, onclick: () => ui.session.answer(o.id, opt.id) }, h('span', {}, opt.label), h('span', { class: 'offer-note' }, opt.note)))),
      h('p', { class: 'offer-fallback' }, t('manage.offer.fallback', { what: o.options.find((x) => x.id === o.fallback)?.label.toLowerCase() ?? o.fallback })),
    );
  const renderOffers = (): void => offerHost.replaceChildren(...st.get('policy').offers.map(offerCard));

  // ---- the away report opens by itself ----------------------------------------------------------------------------------
  let awayShown = -1;
  const maybeAway = (): void => {
    const r = st.get('reports').find((x) => x.kind === 'away' && x.unread);
    if (!r || r.id === awayShown) return;
    awayShown = r.id;
    openModal(
      (close) =>
        h(
          'div',
          { class: 'away-report' },
          ...r.lines.map((l) => h('p', { class: ['report-line', `tone-${l.tone}`] }, l.text)),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, t('manage.away.close')),
        ),
      { title: t('manage.away.title'), glyph: 'book', onClose: () => ui.session.markRead(r.id) },
    );
  };

  const all = (): void => {
    renderState();
    renderWork();
    renderRules();
    renderReports();
    renderOutside();
    renderOffers();
    maybeAway();
  };
  showTab();
  all();
  const unsub = st.subscribe(['policy', 'reports', 'outside', 'status'], all);
  return {
    destroy() {
      unsub();
      window.removeEventListener('keydown', onKey);
      el.remove();
      offerHost.remove();
    },
  };
}
