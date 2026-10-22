// Your own ribbons (View > Customize the Ribbon): each ribbon's tabs in your order, renamed or
// hidden, and each tab's groups in your order, moved to another tab of the same ribbon, renamed
// or hidden, with groups of your own holding the commands you choose. Kept with the settings;
// the ribbons in the page are rearranged to match when the program starts and on each change.

import { commandIcon } from './command-icons';
import { topMenuEntry } from './context-menu';

/** What is changed in one ribbon. Groups are named "g:<name>" (the ribbon's) or "own:<id>" (yours). */
export interface RibbonPrefs {
  /** The tabs in your order (tabs not listed follow, as they come). */
  tabs?: string[];
  hiddenTabs?: string[];
  tabNames?: Record<string, string>;
  /** Each tab's groups in your order; a group listed under another tab has moved there. */
  groups?: Record<string, string[]>;
  hiddenGroups?: string[];
  groupNames?: Record<string, string>;
  /** Groups of your own: their names and commands ("cmd:", "sh:", "doc:" keys). */
  own?: Record<string, { title: string; items: string[] }>;
}

/** Every ribbon's changes, by ribbon (sheet, doc, slides, design). */
export type RibbonsPrefs = Record<string, RibbonPrefs>;

export const RIBBON_IDS = ['slides', 'doc', 'sheet', 'design'] as const;
const NAME = /^[\w-]{1,60}$/;
const GROUP = /^(?:g:[\w-]{1,60}|own:[a-z0-9]{1,16})$/;
const ITEM = /^(?:cmd|sh|doc):[^\s"'<>`]{1,80}$/;

const strings = (v: unknown, ok: RegExp, max = 200): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ok.test(x)))].slice(0, max) : []);
const names = (v: unknown, ok: RegExp): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (ok.test(k) && typeof t === 'string' && t.trim()) out[k] = t.trim().slice(0, 40);
  return out;
};

/** Ribbon settings read from the settings file, keeping only what makes sense. */
export function parseRibbons(raw: unknown): RibbonsPrefs {
  const out: RibbonsPrefs = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of RIBBON_IDS) {
    const r = (raw as Record<string, unknown>)[id];
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const v = r as Record<string, unknown>;
    const p: RibbonPrefs = {};
    const tabs = strings(v.tabs, NAME);
    if (tabs.length) p.tabs = tabs;
    const hiddenTabs = strings(v.hiddenTabs, NAME);
    if (hiddenTabs.length) p.hiddenTabs = hiddenTabs;
    const tabNames = names(v.tabNames, NAME);
    if (Object.keys(tabNames).length) p.tabNames = tabNames;
    if (v.groups && typeof v.groups === 'object' && !Array.isArray(v.groups)) {
      const g: Record<string, string[]> = {};
      const seen = new Set<string>();
      for (const [tab, list] of Object.entries(v.groups as Record<string, unknown>)) {
        if (!NAME.test(tab)) continue;
        // a group is in one tab only
        g[tab] = strings(list, GROUP).filter((x) => !seen.has(x) && seen.add(x));
      }
      if (Object.keys(g).length) p.groups = g;
    }
    const hiddenGroups = strings(v.hiddenGroups, GROUP);
    if (hiddenGroups.length) p.hiddenGroups = hiddenGroups;
    const groupNames = names(v.groupNames, GROUP);
    if (Object.keys(groupNames).length) p.groupNames = groupNames;
    if (v.own && typeof v.own === 'object' && !Array.isArray(v.own)) {
      const own: Record<string, { title: string; items: string[] }> = {};
      for (const [id, g] of Object.entries(v.own as Record<string, unknown>)) {
        if (!/^[a-z0-9]{1,16}$/.test(id) || !g || typeof g !== 'object') continue;
        const { title, items } = g as Record<string, unknown>;
        own[id] = { title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 40) : 'My Commands', items: strings(items, ITEM, 60) };
      }
      if (Object.keys(own).length) p.own = own;
    }
    if (Object.keys(p).length) out[id] = p;
  }
  return out;
}

/** A ribbon as it comes: its tabs in order, each with its groups in order. */
export interface RibbonPlan { tabs: { key: string; groups: string[] }[] }

/** The tabs in the order to show them: yours, then the rest as they come. */
export function tabOrder(plan: RibbonPlan, p: RibbonPrefs = {}): string[] {
  const keys = plan.tabs.map((t) => t.key);
  const mine = (p.tabs ?? []).filter((k) => keys.includes(k));
  return [...mine, ...keys.filter((k) => !mine.includes(k))];
}

/**
 * Where every group goes, tab by tab, in order: the groups you listed under a tab, then that
 * tab's own groups you didn't move anywhere, as they come. Groups of your own not placed
 * (or placed under a tab that isn't there) go at the end of the first tab. Hidden ones are
 * still placed (they keep their place for when they show again).
 */
export function groupLayout(plan: RibbonPlan, p: RibbonPrefs = {}): Record<string, string[]> {
  const known = new Set(plan.tabs.flatMap((t) => t.groups));
  for (const id of Object.keys(p.own ?? {})) known.add(`own:${id}`);
  const tabs = plan.tabs.map((t) => t.key);
  const placed = new Set<string>();
  const out: Record<string, string[]> = {};
  for (const t of plan.tabs) {
    const mine = (p.groups?.[t.key] ?? []).filter((g) => known.has(g) && !placed.has(g));
    mine.forEach((g) => placed.add(g));
    out[t.key] = mine;
  }
  for (const t of plan.tabs) {
    for (const g of t.groups) if (!placed.has(g)) { out[t.key].push(g); placed.add(g); }
  }
  const first = tabs[0];
  for (const id of Object.keys(p.own ?? {})) if (!placed.has(`own:${id}`) && first) out[first].push(`own:${id}`);
  return out;
}

/** A group's name made into its key: lower case words joined by hyphens, made unique among `taken`. */
export function groupKey(label: string, taken: Set<string>): string {
  const base = `g:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'group'}`;
  let k = base, n = 2;
  while (taken.has(k)) k = `${base}-${n++}`;
  taken.add(k);
  return k;
}

// ---------------------------------------------------------------- the ribbons in the page

/** One ribbon in the page, as it came, so changes can be laid over it again from the start. */
export interface RibbonInfo {
  id: string;
  title: string;
  el: HTMLElement;
  plan: RibbonPlan;
  /** Each tab's button (none in an untabbed ribbon) and the panel holding its groups. */
  tabs: Map<string, { button: HTMLElement | null; panel: HTMLElement; name: string }>;
  /** Each group by key, with its name as it came. */
  groups: Map<string, { el: HTMLElement; tab: string; name: string }>;
  /** Groups of your own made so far, by id. */
  own: Map<string, HTMLElement>;
}

const TAB_ATTR: Record<string, string> = { sheet: 'sh', doc: 'doc', slides: 'sl' };
const RIBBON_EL: Record<string, string> = { sheet: '#sheet-ribbon', doc: '#doc-ribbon', slides: '#ribbon', design: '#design-ribbon' };
const RIBBON_TITLE: Record<string, string> = { slides: 'Slides', doc: 'Document', sheet: 'Sheet', design: 'Design' };

/** Read every ribbon in the page as it comes (once, at start). */
export function readRibbons(): RibbonInfo[] {
  const out: RibbonInfo[] = [];
  for (const id of RIBBON_IDS) {
    const el = document.querySelector<HTMLElement>(RIBBON_EL[id]);
    if (!el) continue;
    const info: RibbonInfo = { id, title: RIBBON_TITLE[id], el, plan: { tabs: [] }, tabs: new Map(), groups: new Map(), own: new Map() };
    const taken = new Set<string>();
    const a = TAB_ATTR[id];
    const panels: { key: string; button: HTMLElement | null; panel: HTMLElement; name: string }[] = a
      ? [...el.querySelectorAll<HTMLElement>(`.rb-tabs [data-${a}-tab]`)].map((b) => {
        const key = b.getAttribute(`data-${a}-tab`)!;
        return { key, button: b, panel: el.querySelector<HTMLElement>(`[data-${a}-panel="${key}"]`)!, name: b.textContent!.trim() };
      }).filter((t) => t.panel)
      : [{ key: 'main', button: null, panel: el, name: RIBBON_TITLE[id] }];
    for (const t of panels) {
      info.tabs.set(t.key, { button: t.button, panel: t.panel, name: t.name });
      const groups: string[] = [];
      for (const g of t.panel.querySelectorAll<HTMLElement>(':scope > .rb-group')) {
        const name = g.querySelector(':scope > .rb-label')?.textContent?.trim() || 'Group';
        const key = groupKey(name, taken);
        g.dataset.groupKey = key;
        info.groups.set(key, { el: g, tab: t.key, name });
        groups.push(key);
      }
      info.plan.tabs.push({ key: t.key, groups });
    }
    out.push(info);
  }
  return out;
}

export interface OwnGroupHooks {
  /** Run a menu command. */
  run(cmd: string): void;
}

/** A button for a command in a group of your own: a copy of the ribbon's own, or one made from the menus. */
export function ownButton(info: RibbonInfo, key: string, hooks: OwnGroupHooks): HTMLElement | null {
  const [kind, ...rest] = key.split(':');
  const name = rest.join(':');
  const attr = kind === 'cmd' ? 'data-cmd' : kind === 'sh' ? 'data-sh' : kind === 'doc' ? 'data-doc' : '';
  if (!attr) return null;
  const src = [...info.el.querySelectorAll<HTMLElement>(`button[${attr}="${CSS.escape(name)}"]`)].find((b) => !b.closest('.rb-own'));
  let b: HTMLElement;
  if (src) {
    b = src.cloneNode(true) as HTMLElement;
    b.removeAttribute('id');
    b.removeAttribute('hidden');
    b.classList.remove('rb-big');
  } else if (kind === 'cmd' && topMenuEntry(name)) {
    b = document.createElement('button');
    b.setAttribute('type', 'button');
    const icon = commandIcon(name);
    const label = topMenuEntry(name)!.label;
    b.innerHTML = icon ? `<span class="rb-own-ic">${icon}</span>` : '';
    b.append(label);
    b.title = label;
  } else return null;
  // menu commands run here (the ribbons' own buttons run through each ribbon)
  if (kind === 'cmd') {
    b.removeAttribute('data-cmd');
    b.dataset.ownCmd = name;
    b.addEventListener('click', (e) => { e.stopPropagation(); hooks.run(name); });
  }
  return b;
}

/** A group of your own, as the ribbon shows it: its buttons in columns of three, its name under them. */
function ownGroup(info: RibbonInfo, id: string, g: { title: string; items: string[] }, hooks: OwnGroupHooks): HTMLElement {
  const el = info.own.get(id) ?? document.createElement('div');
  el.className = 'rb-group rb-own';
  el.dataset.groupKey = `own:${id}`;
  el.replaceChildren();
  const row = document.createElement('div');
  row.className = 'rb-row';
  const buttons = g.items.map((k) => ownButton(info, k, hooks)).filter((b): b is HTMLElement => !!b);
  for (let i = 0; i < buttons.length; i += 3) {
    const col = document.createElement('div');
    col.className = 'rb-col';
    col.append(...buttons.slice(i, i + 3));
    row.append(col);
  }
  if (!buttons.length) {
    const none = document.createElement('span');
    none.className = 'rb-own-empty';
    none.textContent = 'Empty: View ▸ Customize the Ribbon';
    row.append(none);
  }
  const label = document.createElement('div');
  label.className = 'rb-label';
  label.textContent = g.title;
  el.append(row, label);
  info.own.set(id, el);
  return el;
}

/** Lay a ribbon out as it came, then with your changes over it. */
export function applyRibbon(info: RibbonInfo, p: RibbonPrefs = {}, hooks: OwnGroupHooks): void {
  // tabs: your order, names and hidden ones
  const order = tabOrder(info.plan, p);
  const buttons = order.map((k) => info.tabs.get(k)!.button).filter((b): b is HTMLElement => !!b);
  if (buttons.length) {
    const strip = buttons[0].parentElement!;
    const tabsNow = [...strip.children].filter((c) => buttons.includes(c as HTMLElement));
    const after = tabsNow[tabsNow.length - 1]?.nextSibling ?? null;
    for (const b of buttons) strip.insertBefore(b, after);
  }
  for (const [key, t] of info.tabs) {
    if (!t.button) continue;
    t.button.textContent = p.tabNames?.[key] ?? t.name;
    t.button.classList.toggle('rb-user-hidden', !!p.hiddenTabs?.includes(key));
  }
  // groups: where they go, named and shown or not
  const layout = groupLayout(info.plan, p);
  const live = new Set<string>();
  for (const [tab, list] of Object.entries(layout)) {
    const panel = info.tabs.get(tab)!.panel;
    for (const key of list) {
      let el: HTMLElement | undefined;
      if (key.startsWith('own:')) {
        const id = key.slice(4);
        el = ownGroup(info, id, p.own![id], hooks);
        live.add(id);
      } else el = info.groups.get(key)?.el;
      if (!el) continue;
      // (a group folded to fit keeps its button first, so the name is set on the label itself)
      if (!key.startsWith('own:')) {
        const label = el.querySelector<HTMLElement>(':scope > .rb-label');
        const name = p.groupNames?.[key] ?? info.groups.get(key)!.name;
        if (label && label.textContent !== name) label.textContent = name;
        const fold = el.querySelector<HTMLElement>(':scope > .rb-fold-btn > span');
        if (fold && fold.textContent !== name) fold.textContent = name;
      } else if (p.groupNames?.[key]) el.querySelector<HTMLElement>(':scope > .rb-label')!.textContent = p.groupNames[key];
      el.classList.toggle('rb-user-hidden', !!p.hiddenGroups?.includes(key));
      panel.append(el);
    }
  }
  for (const [id, el] of info.own) if (!live.has(id)) { el.remove(); info.own.delete(id); }
  // a hidden tab that was open gives way to the first one showing
  const open = buttons.find((b) => b.getAttribute('aria-selected') === 'true');
  if (open?.classList.contains('rb-user-hidden')) buttons.find((b) => !b.hidden && !b.classList.contains('rb-user-hidden'))?.click();
}
