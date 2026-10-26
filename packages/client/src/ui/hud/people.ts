/** Villager list (top left, under the village card): everyone on the map, sortable, one tap to select. */
import type { PersonBrief } from '@hearth/shared';
import { t, tn } from '../../i18n';
import type { UiContext } from '../context';
import { h, isNarrow, loadJson, mount, saveJson } from '../dom';
import { icon } from '../icons';
import { moodClass } from './moodClass';

type SortKey = 'mood' | 'job' | 'age' | 'name';
const SORTS: SortKey[] = ['mood', 'job', 'age', 'name'];
const KEY = 'hearth.people';

const compare: Record<SortKey, (a: PersonBrief, b: PersonBrief) => number> = {
  mood: (a, b) => a.mood - b.mood,
  job: (a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name),
  age: (a, b) => b.age - a.age,
  name: (a, b) => a.name.localeCompare(b.name),
};

export function mountPeople(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const prefs = loadJson<{ sort: SortKey; open: boolean }>(KEY, { sort: 'mood', open: !isNarrow() });
  const title = h('span', { class: 'panel-title' });
  const toggle = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('people.toggle'), title: t('people.toggle') });
  const sorts = SORTS.map((k) =>
    h(
      'button',
      {
        class: 'chip',
        type: 'button',
        'aria-pressed': 'false',
        onclick: () => {
          prefs.sort = k;
          saveJson(KEY, prefs);
          render();
        },
      },
      t(`people.sort.${k}`),
    ),
  );
  const list = h('div', { class: 'people-list', role: 'list' });
  const body = h('div', { class: 'panel-body' }, h('div', { class: 'chips', role: 'group', 'aria-label': t('people.sort') }, sorts), list);
  const el = h('section', { class: 'panel people glass', 'aria-label': t('people.title') }, h('div', { class: 'panel-head' }, title, toggle), body);
  host.appendChild(el);

  toggle.onclick = () => {
    prefs.open = !prefs.open;
    saveJson(KEY, prefs);
    render();
  };

  const rows = new Map<number, HTMLElement>();
  function render(): void {
    const roster = ui.state.get('roster');
    const sel = ui.state.get('selected');
    title.textContent = tn('people.count', roster.length);
    el.classList.toggle('collapsed', !prefs.open);
    toggle.replaceChildren(icon(prefs.open ? 'chevron-up' : 'chevron-down'));
    toggle.setAttribute('aria-expanded', String(prefs.open));
    SORTS.forEach((k, i) => sorts[i].setAttribute('aria-pressed', String(prefs.sort === k)));
    if (!prefs.open) return;
    const sorted = [...roster].sort(compare[prefs.sort]);
    const seen = new Set<number>();
    sorted.forEach((p, i) => {
      seen.add(p.id);
      let row = rows.get(p.id);
      if (!row) {
        row = h('button', { class: 'person-row', type: 'button', role: 'listitem', onclick: () => ui.session.select(ui.state.get('selected') === p.id ? null : p.id) });
        rows.set(p.id, row);
      }
      mount(
        row,
        h('span', { class: ['mood-dot', moodClass(p.mood)], title: t('people.mood', { n: Math.round(p.mood) }) }),
        h('span', { class: 'person-main' }, h('span', { class: 'person-name' }, p.name), h('span', { class: 'person-sub' }, `${p.title}, ${p.age} · ${p.doing}`)),
        p.flags.length ? h('span', { class: 'person-flags' }, p.flags.map((f) => t(`people.flag.${f}`)).join(', ')) : null,
      );
      row.classList.toggle('selected', sel === p.id);
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] ?? null);
    });
    for (const [id, row] of rows) {
      if (!seen.has(id)) {
        row.remove();
        rows.delete(id);
      }
    }
  }
  render();
  const unsub = ui.state.subscribe(['roster', 'selected'], render);
  return {
    destroy() {
      unsub();
      el.remove();
    },
  };
}
