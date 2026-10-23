// Toolboxes (View > Toolboxes): the drawing tools down the left, and others to show as wanted:
// structure commands, arranging, templates, colours, and one of your own that mixes any tools
// and commands. Unlocked, a toolbox is dragged by its title to float anywhere, or to an edge of
// the drawing to dock there. Where each one is, and what is in your own, is kept with the settings.

import { showContextMenu, topMenuEntry, type MenuItem } from './context-menu';
import { commandIcon } from './command-icons';

export type Dock = 'left' | 'right' | 'top' | 'bottom' | 'float';
export const DOCKS: Dock[] = ['left', 'right', 'top', 'bottom', 'float'];

export interface BoxPlace {
  shown: boolean; dock: Dock; x: number; y: number;
  /** Folded up to its title bar (the arrow in the title). */
  collapsed?: boolean;
  /** Locked where it is (its own padlock); unset follows the big Locked button. */
  locked?: boolean;
}

export interface ToolboxState {
  /** The big Locked button: on when every toolbox is locked (each can also be locked on its own). */
  locked: boolean;
  places: Record<string, BoxPlace>;
  /** Your own toolbox: "tool:name" and "cmd:name" items, in order. */
  custom: string[];
  /** The side panel (Style, Warnings, Analysis) folded to a strip at the right, in modes without their own choice. */
  sideCollapsed: boolean;
  /** Folded or open in each mode (drawing, slides, sheet, document, design), as last left there. */
  sideByMode?: Record<string, boolean>;
  /** What is in each toolbox of buttons, where changed from how it comes (My Toolbox's is `custom`). See ITEM. */
  items?: Record<string, string[]>;
  /** Toolboxes of your own, made in Customize Toolboxes. */
  own?: OwnBox[];
  /** New names for the toolboxes that come with the app. */
  titles?: Record<string, string>;
  /** Toolboxes that come with the app and were deleted (Restore brings them back). */
  removed?: string[];
  /** The order the toolboxes are listed in (the View menu, and the docks), where changed. */
  order?: string[];
  /** The tools in each fly-out palette, where changed: palette name → tool names. */
  flyouts?: Record<string, string[]>;
  /** The icons jiggle while a toolbox is customized (never when the system asks for less motion). */
  jiggle?: boolean;
}

/** A toolbox of your own. */
export interface OwnBox { id: string; title: string }

/**
 * What can go in a toolbox: "tool:name" (a drawing tool), "cmd:name" (a menu command),
 * "pal:name" (a fly-out palette of tools), "w:looks" (the highlight looks), or "sep" (a divider).
 */
export const ITEM = /^(?:(?:tool|cmd|pal|w):[^\s"'<>`]{1,80}|sep)$/;
/** The name of a toolbox of your own. */
const OWN_ID = /^own-[a-z0-9]{1,16}$/;
/** The toolboxes whose buttons can be chosen (the rest are laid out by the app: templates, colours, the side panel). */
export const EDITABLE: readonly string[] = ['main', 'structure', 'arrange', 'highlight', 'custom'];
/** Toolboxes that can't be deleted (they can still be hidden, except the side panel). */
export const KEEP: readonly string[] = ['main', 'details'];

export const isOwnBox = (id: string): boolean => OWN_ID.test(id);
export const isEditable = (id: string): boolean => EDITABLE.includes(id) || isOwnBox(id);

/** Whether a toolbox is locked where it is. */
export function boxLocked(st: ToolboxState, id: string): boolean {
  return st.places[id]?.locked ?? st.locked;
}

/** Every toolbox locked or unlocked together (the big Locked button). */
export function withAllLocked(st: ToolboxState, locked: boolean): ToolboxState {
  const places: Record<string, BoxPlace> = {};
  for (const [id, p] of Object.entries(st.places)) places[id] = { ...p, locked };
  return { ...st, locked, places };
}

/** One toolbox locked or unlocked (its own padlock). The big button shows locked while every shown one is. */
export function withBoxLocked(st: ToolboxState, id: string, locked: boolean): ToolboxState {
  // the others keep the lock they have now, whatever the big button then shows
  const places: Record<string, BoxPlace> = {};
  for (const [k, p] of Object.entries(st.places)) places[k] = { ...p, locked: k === id ? locked : boxLocked(st, k) };
  const next = { ...st, places };
  const shown = Object.keys(places).filter((k) => places[k].shown);
  return { ...next, locked: shown.length ? shown.every((k) => boxLocked(next, k)) : locked };
}

/** Whether the side panel is folded away in a mode. */
export function sideFolded(st: ToolboxState, mode: string): boolean {
  return st.sideByMode?.[mode] ?? st.sideCollapsed;
}

/** The side panel folded or opened in one mode only. */
export function withSideFolded(st: ToolboxState, mode: string, folded: boolean): ToolboxState {
  return { ...st, sideByMode: { ...st.sideByMode, [mode]: folded } };
}

/**
 * The toolboxes and where they start: the drawing tools on the left, the rest hidden until wanted.
 * "details" is the side panel taken out of its place at the right, to float or dock elsewhere.
 */
export const TOOLBOX_IDS = ['main', 'structure', 'arrange', 'templates', 'colours', 'highlight', 'custom', 'details'] as const;
export type ToolboxId = (typeof TOOLBOX_IDS)[number];

export function defaultToolboxes(): ToolboxState {
  const places: Record<string, BoxPlace> = {};
  TOOLBOX_IDS.forEach((id, i) => { places[id] = { shown: id === 'main', dock: id === 'main' ? 'left' : 'float', x: 110 + i * 24, y: 90 + i * 64 }; });
  // the side panel (Style, Warnings, Analysis) is always shown, docked at the right to start with
  places.details = { shown: true, dock: 'right', x: 900, y: 90 };
  return { locked: true, places, custom: ['cmd:clean-up', 'cmd:add-frame', 'cmd:fill-rings', 'cmd:highlight', 'cmd:chain-ends'], sideCollapsed: false };
}

/**
 * Every toolbox back where it starts (View > Reset Toolboxes): shown or hidden, docked or floating,
 * open, and locked as they come. What is in them, their names and your own toolboxes are kept.
 */
export function withLayoutReset(st: ToolboxState): ToolboxState {
  const d = defaultToolboxes();
  const places = d.places;
  (st.own ?? []).forEach((b, i) => { places[b.id] = { shown: true, dock: 'float', x: 160 + i * 24, y: 120 + i * 64 }; });
  for (const id of st.removed ?? []) places[id] = { ...places[id], shown: false };
  const { sideByMode: _, ...rest } = st;
  return { ...rest, locked: d.locked, places, sideCollapsed: d.sideCollapsed };
}

/** Toolbox settings read from the settings file, keeping only what makes sense. */
export function parseToolboxes(raw: unknown): ToolboxState {
  const s = defaultToolboxes();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.locked === 'boolean') s.locked = r.locked;
  if (typeof r.sideCollapsed === 'boolean') s.sideCollapsed = r.sideCollapsed;
  if (r.sideByMode && typeof r.sideByMode === 'object') {
    const by: Record<string, boolean> = {};
    for (const [m, v] of Object.entries(r.sideByMode as Record<string, unknown>)) if (/^[a-z]+$/.test(m) && typeof v === 'boolean') by[m] = v;
    s.sideByMode = by;
  }
  if (r.places && typeof r.places === 'object') {
    for (const [id, v] of Object.entries(r.places as Record<string, unknown>)) {
      if (!(TOOLBOX_IDS as readonly string[]).includes(id) || !v || typeof v !== 'object') continue;
      const p = v as Record<string, unknown>;
      const num = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
      s.places[id] = {
        shown: typeof p.shown === 'boolean' ? p.shown : s.places[id].shown,
        dock: DOCKS.includes(p.dock as Dock) ? (p.dock as Dock) : s.places[id].dock,
        x: num(p.x, s.places[id].x), y: num(p.y, s.places[id].y),
        ...(p.collapsed === true ? { collapsed: true } : {}),
        ...(typeof p.locked === 'boolean' ? { locked: p.locked } : {}),
      };
    }
  }
  // the side panel can't be hidden (older settings could put it away)
  s.places.details = { ...s.places.details, shown: true };
  const list = (v: unknown, max = 200): string[] | null => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ITEM.test(x)))].slice(0, max) : null);
  // (a divider may come more than once)
  const items = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ITEM.test(x)).filter((x, i, a) => x === 'sep' || a.indexOf(x) === i).slice(0, 200) : null);
  const custom = items(r.custom);
  if (custom) s.custom = custom.filter((x) => !x.startsWith('w:') || x === 'w:looks');
  if (Array.isArray(r.own)) {
    const seen = new Set<string>();
    s.own = [];
    for (const b of r.own as unknown[]) {
      if (!b || typeof b !== 'object') continue;
      const { id, title } = b as Record<string, unknown>;
      if (typeof id !== 'string' || !OWN_ID.test(id) || seen.has(id)) continue;
      seen.add(id);
      s.own.push({ id, title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 60) : 'My Toolbox' });
    }
    if (!s.own.length) delete s.own;
  }
  const known = (id: string) => (TOOLBOX_IDS as readonly string[]).includes(id) || !!s.own?.some((b) => b.id === id);
  if (r.items && typeof r.items === 'object') {
    const by: Record<string, string[]> = {};
    for (const [id, v] of Object.entries(r.items as Record<string, unknown>)) { const l = items(v); if (l && id !== 'custom' && known(id) && isEditable(id)) by[id] = l; }
    if (Object.keys(by).length) s.items = by;
  }
  if (r.titles && typeof r.titles === 'object') {
    const by: Record<string, string> = {};
    for (const [id, v] of Object.entries(r.titles as Record<string, unknown>)) if ((TOOLBOX_IDS as readonly string[]).includes(id) && typeof v === 'string' && v.trim()) by[id] = v.trim().slice(0, 60);
    if (Object.keys(by).length) s.titles = by;
  }
  const removed = list(r.removed)?.filter((id) => (TOOLBOX_IDS as readonly string[]).includes(id) && !KEEP.includes(id));
  if (removed?.length) s.removed = removed;
  const order = Array.isArray(r.order) ? [...new Set((r.order as unknown[]).filter((x): x is string => typeof x === 'string' && known(x)))] : [];
  if (order.length) s.order = order;
  if (r.flyouts && typeof r.flyouts === 'object') {
    const by: Record<string, string[]> = {};
    for (const [id, v] of Object.entries(r.flyouts as Record<string, unknown>)) {
      const l = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[^\s"'<>`]{1,80}$/.test(x)))].slice(0, 400) : null;
      if (l && /^[\w-]{1,40}$/.test(id)) by[id] = l;
    }
    if (Object.keys(by).length) s.flyouts = by;
  }
  if (r.jiggle === false) s.jiggle = false;
  // a toolbox of your own goes where the settings say, or floats
  for (const b of s.own ?? []) {
    const p = (r.places as Record<string, Record<string, unknown>> | undefined)?.[b.id];
    const num = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
    s.places[b.id] = {
      shown: typeof p?.shown === 'boolean' ? p.shown : true,
      dock: DOCKS.includes(p?.dock as Dock) ? (p!.dock as Dock) : 'float',
      x: num(p?.x, 160), y: num(p?.y, 120),
      ...(p?.collapsed === true ? { collapsed: true } : {}),
      ...(typeof p?.locked === 'boolean' ? { locked: p.locked } : {}),
    };
  }
  for (const id of s.removed ?? []) s.places[id] = { ...s.places[id], shown: false };
  return s;
}

// ---------------------------------------------------------------- changing the toolboxes (Customize Toolboxes)

/** The buttons in a toolbox, in order: as changed, or as it comes (`given`). */
export function boxItems(st: ToolboxState, id: string, given: readonly string[] = []): string[] {
  if (id === 'custom') return st.custom;
  return st.items?.[id] ?? (isOwnBox(id) ? [] : [...given]);
}

/** A toolbox's buttons changed. */
export function withItems(st: ToolboxState, id: string, items: string[]): ToolboxState {
  if (id === 'custom') return { ...st, custom: items };
  return { ...st, items: { ...st.items, [id]: items } };
}

/** A toolbox's buttons back as they come. */
export function withItemsReset(st: ToolboxState, id: string, given: readonly string[] = []): ToolboxState {
  if (id === 'custom') return { ...st, custom: [...given] };
  const items = { ...st.items };
  delete items[id];
  return { ...st, items };
}

/** A fly-out palette's tools changed, or back as they come (null). */
export function withFlyout(st: ToolboxState, palette: string, tools: string[] | null): ToolboxState {
  const flyouts = { ...st.flyouts };
  if (tools) flyouts[palette] = tools; else delete flyouts[palette];
  return { ...st, flyouts };
}

/** Every toolbox there is now (the app's, less deleted ones, then your own), in the order they are listed. */
export function boxIds(st: ToolboxState): string[] {
  const ids = [...TOOLBOX_IDS.filter((id) => !st.removed?.includes(id)), ...(st.own ?? []).map((b) => b.id)];
  const at = (id: string) => { const i = st.order?.indexOf(id) ?? -1; return i < 0 ? 1000 + ids.indexOf(id) : i; };
  return ids.sort((a, b) => at(a) - at(b));
}

/** A toolbox's name: your own, or as the app names it (`given`). */
export function boxTitle(st: ToolboxState, id: string, given = ''): string {
  return st.own?.find((b) => b.id === id)?.title ?? st.titles?.[id] ?? given;
}

/** A new toolbox of your own, empty, shown floating. */
export function withNewBox(st: ToolboxState, title: string, at = { x: 160, y: 120 }, id = `own-${Date.now().toString(36)}`): { state: ToolboxState; id: string } {
  while (st.own?.some((b) => b.id === id)) id += 'a';
  const state: ToolboxState = {
    ...st,
    own: [...(st.own ?? []), { id, title: title.trim().slice(0, 60) || 'My Toolbox' }],
    items: { ...st.items, [id]: [] },
    places: { ...st.places, [id]: { shown: true, dock: 'float', x: at.x, y: at.y, locked: false } },
    ...(st.order ? { order: [...st.order, id] } : {}),
  };
  return { state, id };
}

/** A toolbox renamed (one of the app's keeps the new name in `titles`). */
export function withTitle(st: ToolboxState, id: string, title: string): ToolboxState {
  const t = title.trim().slice(0, 60);
  if (!t) return st;
  if (isOwnBox(id)) return { ...st, own: st.own?.map((b) => (b.id === id ? { ...b, title: t } : b)) };
  return { ...st, titles: { ...st.titles, [id]: t } };
}

/** A toolbox deleted: one of your own goes for good, one of the app's until Restore. */
export function withoutBox(st: ToolboxState, id: string): ToolboxState {
  if (KEEP.includes(id)) return st;
  const order = st.order?.filter((x) => x !== id);
  if (isOwnBox(id)) {
    const places = { ...st.places };
    delete places[id];
    const items = { ...st.items };
    delete items[id];
    return { ...st, own: st.own?.filter((b) => b.id !== id), places, items, ...(order ? { order } : {}) };
  }
  return { ...st, removed: [...new Set([...(st.removed ?? []), id])], places: { ...st.places, [id]: { ...st.places[id], shown: false } } };
}

/** The app's deleted toolboxes back (hidden, to show from View > Toolboxes), and their names as they come. */
export function withBoxesRestored(st: ToolboxState): ToolboxState {
  return { ...st, removed: undefined, titles: undefined };
}

/** A toolbox moved up (-1) or down (+1) the list. */
export function withBoxMoved(st: ToolboxState, id: string, by: number): ToolboxState {
  const ids = boxIds(st);
  const i = ids.indexOf(id), j = Math.max(0, Math.min(ids.length - 1, i + by));
  if (i < 0 || i === j) return st;
  ids.splice(j, 0, ...ids.splice(i, 1));
  return { ...st, order: ids };
}

/** A list with one entry moved from `from` to before what is now at `to` (after taking it out). */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const n = list.slice();
  const [x] = n.splice(from, 1);
  n.splice(Math.max(0, Math.min(n.length, to)), 0, x);
  return n;
}

/** A button put in a list at `at`: one already there moves (a divider can be there more than once). */
export function inserted(list: readonly string[], key: string, at: number): string[] {
  const i = key === 'sep' ? -1 : list.indexOf(key);
  if (i >= 0) return moved(list, i, i < at ? at - 1 : at);
  const n = list.slice();
  n.splice(Math.max(0, Math.min(n.length, at)), 0, key);
  return n;
}

/** Where a toolbox dropped at (x, y) goes: a dock when near an edge of the drawing, else floating there. */
export function dropTarget(x: number, y: number, work: { left: number; top: number; right: number; bottom: number }, edge = 44): Dock {
  if (x < work.left + edge) return 'left';
  if (x > work.right - edge) return 'right';
  if (y < work.top + edge) return 'top';
  if (y > work.bottom - edge) return 'bottom';
  return 'float';
}

/** What a toolbox shows, as the app knows it. */
export interface ToolboxDef {
  /** One of TOOLBOX_IDS, or a toolbox of your own ("own-…"). */
  id: string;
  title: string;
  /** Fill the toolbox's body; `vertical` when it is docked at the left or right. */
  build(body: HTMLElement, vertical: boolean): void;
}

export interface ToolboxHooks {
  get(): ToolboxState;
  set(s: ToolboxState): void;
  /** The drawing area, whose edges are the docks' drop zones. */
  work(): HTMLElement;
  /** Open Customize Toolboxes, at a toolbox. */
  customize(id?: string): void;
  /** Whether a toolbox is folded, when the app keeps that itself (the side panel, per mode). */
  folded?(id: string): boolean | undefined;
  /** Fold or open a toolbox the app folds itself; true when it did. */
  fold?(id: string): boolean;
  /** Show a short message in the status bar. */
  say?(text: string): void;
  /** After the toolboxes are laid out again. */
  rendered?(): void;
}

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * Where a newly shown floating toolbox of size w × h goes: the first place inside the area,
 * scanning down from the top right corner (structures are usually drawn in the middle) and then
 * leftwards, that overlaps none of the boxes already there. The top right corner when none is free.
 */
export function freeSpot(w: number, h: number, area: Box, taken: Box[], gap = 8, step = 16): { x: number; y: number } {
  const clear = (x: number, y: number) => taken.every((t) => x + w + gap <= t.left || x >= t.right + gap || y + h + gap <= t.top || y >= t.bottom + gap);
  const right = area.right - w - gap, bottom = area.bottom - h - gap;
  for (let x = right; x >= area.left + gap; x -= step) {
    for (let y = area.top + gap; y <= bottom; y += step) if (clear(x, y)) return { x: Math.round(x), y: Math.round(y) };
  }
  return { x: Math.round(Math.max(area.left + gap, right)), y: Math.round(area.top + gap) };
}

const DOCK_LABEL: Record<Dock, string> = { left: 'Dock Left', right: 'Dock Right', top: 'Dock at the Top', bottom: 'Dock at the Bottom', float: 'Float' };

export class Toolboxes {
  private frames = new Map<string, HTMLElement>();
  private toldLocked = false;
  private docks: Record<Exclude<Dock, 'float'>, HTMLElement>;

  /** `defs` gives the toolboxes there are now (your own come and go), with their names as they are now. */
  constructor(private defs: () => ToolboxDef[], private hooks: ToolboxHooks) {
    this.docks = {
      left: document.getElementById('dock-left')!, right: document.getElementById('dock-right')!,
      top: document.getElementById('dock-top')!, bottom: document.getElementById('dock-bottom')!,
    };
    window.addEventListener('resize', () => this.keepOnScreen());
  }

  /** Show every toolbox where the settings say (building them again, so their contents are up to date). */
  render(): void {
    const st = this.hooks.get();
    const defs = this.defs();
    // toolboxes deleted go
    for (const [id, f] of this.frames) if (!defs.some((d) => d.id === id)) { f.remove(); this.frames.delete(id); }
    for (const def of defs) {
      const place = st.places[def.id];
      let f = this.frames.get(def.id);
      if (!place?.shown) { f?.remove(); continue; }
      if (!f) { f = this.frame(def); this.frames.set(def.id, f); }
      // (renamed in Customize Toolboxes)
      f.querySelector('.tb-title')!.textContent = def.title;
      f.setAttribute('aria-label', def.title);
      const vertical = place.dock === 'left' || place.dock === 'right';
      f.classList.toggle('vertical', vertical);
      f.classList.toggle('floating', place.dock === 'float');
      const folded = this.hooks.folded?.(def.id) ?? !!place.collapsed;
      f.classList.toggle('collapsed', folded);
      const locked = boxLocked(st, def.id);
      f.classList.toggle('locked', locked);
      const fold = f.querySelector<HTMLElement>('.tb-fold');
      if (fold) { fold.textContent = folded ? '▸' : '▾'; fold.title = folded ? `Open ${def.title} out` : `Fold ${def.title} up to its title`; }
      const tab = f.querySelector<HTMLElement>('.tb-tab');
      if (tab) { tab.title = `Fold ${def.title} up to its title`; tab.setAttribute('aria-label', tab.title); }
      const lock = f.querySelector<HTMLElement>('.tb-lock');
      if (lock) { lock.innerHTML = lockIcon(locked, 14); lock.title = locked ? `Lock this toolbox's place (locked). Click to unlock it, then drag it by its title. The drawing itself is never locked.` : `Lock this toolbox's place (unlocked: drag it by its title). Click to lock it where it is.`; lock.setAttribute('aria-pressed', String(locked)); }
      f.dataset.dock = place.dock;
      const body = f.querySelector<HTMLElement>('.tb-body')!;
      body.replaceChildren();
      def.build(body, vertical || place.dock === 'float' && def.id === 'main');
      if (place.dock === 'float') {
        document.body.append(f);
        f.style.left = `${place.x}px`;
        f.style.top = `${place.y}px`;
      } else {
        f.style.left = f.style.top = '';
        this.docks[place.dock].append(f);
      }
    }
    // the docks keep the order the toolboxes are listed in
    const order = boxIds(st);
    for (const d of Object.values(this.docks)) {
      const kids = [...d.children] as HTMLElement[];
      kids.sort((a, b) => order.indexOf(a.dataset.id!) - order.indexOf(b.dataset.id!)).forEach((k) => d.append(k));
    }
    this.keepOnScreen();
    this.hooks.rendered?.();
  }

  /** Show or hide a toolbox (View > Toolboxes). */
  toggle(id: string, show?: boolean): void {
    const st = this.hooks.get();
    const p = st.places[id];
    if (!p) return;
    const shown = show ?? !p.shown;
    this.change({ ...st, places: { ...st.places, [id]: { ...p, shown } } });
    if (shown && !p.shown && p.dock === 'float') this.findRoom(id);
  }

  /** Move a floating toolbox just shown to free space over the drawing, clear of the other toolboxes. */
  private findRoom(id: string): void {
    const f = this.frames.get(id);
    if (!f?.isConnected) return;
    const r = f.getBoundingClientRect();
    const taken = [...this.frames.entries()].filter(([k, g]) => k !== id && g.isConnected && g.classList.contains('floating')).map(([, g]) => g.getBoundingClientRect());
    const { x, y } = freeSpot(r.width, r.height, this.hooks.work().getBoundingClientRect(), taken);
    this.place(id, { x, y });
  }

  isShown(id: string): boolean {
    return !!this.hooks.get().places[id]?.shown;
  }

  /** Lock or unlock every toolbox (the big Locked button). */
  setLocked(locked: boolean): void {
    this.change(withAllLocked(this.hooks.get(), locked));
  }

  /** Lock or unlock one toolbox (its own padlock). */
  setBoxLocked(id: string, locked: boolean): void {
    this.change(withBoxLocked(this.hooks.get(), id, locked));
  }

  /** Fold a toolbox up to its title bar, or open it out again. */
  fold(id: string, collapsed?: boolean): void {
    if (this.hooks.fold?.(id)) return;
    const p = this.hooks.get().places[id];
    if (p) this.place(id, { collapsed: (collapsed ?? !p.collapsed) || undefined });
  }

  /** Every toolbox back where it starts (View > Reset Toolboxes). */
  reset(): void {
    this.change(withLayoutReset(this.hooks.get()));
  }

  /** Fold the side panel to a strip at the right, or open it again, in one mode. */
  setSideCollapsed(mode: string, collapsed: boolean): void {
    this.change(withSideFolded(this.hooks.get(), mode, collapsed));
  }

  private place(id: string, p: Partial<BoxPlace>): void {
    const st = this.hooks.get();
    this.change({ ...st, places: { ...st.places, [id]: { ...st.places[id], ...p } } });
  }

  private change(s: ToolboxState): void {
    this.hooks.set(s);
    this.render();
  }

  private frame(def: ToolboxDef): HTMLElement {
    const f = document.createElement('section');
    f.className = 'toolbox';
    f.dataset.id = def.id;
    f.setAttribute('aria-label', def.title);
    const head = document.createElement('div');
    head.className = 'tb-head';
    head.title = 'Drag to move: to an edge of the drawing to dock it, anywhere else to float. Right-click for more.';
    const grip = document.createElement('span');
    grip.className = 'tb-grip';
    grip.textContent = '⋮⋮';
    const name = document.createElement('span');
    name.className = 'tb-title';
    name.textContent = def.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tb-close';
    close.textContent = '×';
    close.title = `Hide ${def.title} (View > Toolboxes shows it again)`;
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => this.toggle(def.id, false));
    // fold the box up to its title, and lock or unlock it, from the title bar
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'tb-fold';
    fold.addEventListener('click', () => this.fold(def.id));
    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'tb-lock';
    lock.addEventListener('click', () => this.setBoxLocked(def.id, !boxLocked(this.hooks.get(), def.id)));
    head.append(grip, name, lock, fold, close);
    // a locked docked box hides its title bar, so this slim arrow folds it instead (folded, the title shows again to open it)
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tb-tab';
    tab.textContent = '▴';
    tab.addEventListener('click', () => this.fold(def.id, true));
    const body = document.createElement('div');
    body.className = 'tb-body';
    f.append(head, tab, body);
    head.addEventListener('pointerdown', (e) => { if (e.button === 0 && !(e.target as Element).closest('button')) this.drag(def.id, f, e); });
    // right-click the title, or the box round its buttons (a locked docked box has no title showing)
    f.addEventListener('contextmenu', (e) => {
      if ((e.target as Element).closest('.tb-body button, .tb-body input, .tb-body select')) return;
      e.preventDefault();
      this.menu(def, e.clientX, e.clientY);
    });
    return f;
  }

  /** The toolbox's own menu: dock it, float it, lock it or all of them, hide it. */
  private menu(def: ToolboxDef, x: number, y: number): void {
    const st = this.hooks.get();
    const items: MenuItem[] = [
      ...DOCKS.map((d) => ({ cmd: `tbx:${d}`, label: DOCK_LABEL[d] })), null,
      { cmd: 'tbx:lock', label: boxLocked(st, def.id) ? `Unlock ${def.title}` : `Lock ${def.title}` },
      { cmd: 'tbx:lock-all', label: st.locked ? 'Unlock All Toolboxes' : 'Lock All Toolboxes' },
      { cmd: 'tbx:fold', label: (this.hooks.folded?.(def.id) ?? st.places[def.id]?.collapsed) ? 'Open Out' : 'Fold Up' },
      { cmd: 'tbx:customize', label: isEditable(def.id) ? 'Customize This Toolbox…' : 'Customize Toolboxes…' },
      ...(def.id === 'details' ? [] : [{ cmd: 'tbx:hide', label: `Hide ${def.title}` }]),
    ];
    showContextMenu(x, y, items, {
      key: () => undefined,
      run: (cmd) => {
        const what = cmd.slice(4);
        if (what === 'lock') this.setBoxLocked(def.id, !boxLocked(st, def.id));
        else if (what === 'lock-all') this.setLocked(!st.locked);
        else if (what === 'hide') this.toggle(def.id, false);
        else if (what === 'fold') this.fold(def.id);
        else if (what === 'customize') this.hooks.customize(def.id);
        else if (DOCKS.includes(what as Dock)) {
          const r = this.frames.get(def.id)?.getBoundingClientRect();
          this.place(def.id, what === 'float' && r ? { dock: 'float', x: Math.round(r.left + 24), y: Math.round(r.top + 24) } : { dock: what as Dock });
        }
      },
    });
  }

  /** Drag a toolbox by its title: it follows the pointer, and the dock it would go to lights up. */
  private drag(id: string, f: HTMLElement, e: PointerEvent): void {
    if (boxLocked(this.hooks.get(), id)) {
      // say once why nothing moves
      if (!this.toldLocked) this.hooks.say?.('This toolbox is locked in place. Click its padlock, or the Locked button at the top, to move it.');
      this.toldLocked = true;
      return;
    }
    e.preventDefault();
    const r = f.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let moved = false;
    let target: Dock = 'float';
    const work = this.hooks.work();
    // the window hears the pointer (moving the toolbox out of its dock would lose a capture)
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
      if (!moved) {
        moved = true;
        // lift it out of its dock while it moves
        f.classList.add('dragging', 'floating');
        f.classList.remove('vertical');
        document.body.append(f);
      }
      f.style.left = `${m.clientX - dx}px`;
      f.style.top = `${m.clientY - dy}px`;
      const w = work.getBoundingClientRect();
      target = dropTarget(m.clientX, m.clientY, w);
      for (const [d, el] of Object.entries(this.docks)) el.classList.toggle('drop', d === target);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      for (const el of Object.values(this.docks)) el.classList.remove('drop');
      f.classList.remove('dragging');
      if (!moved) return;
      const fr = f.getBoundingClientRect();
      this.place(id, target === 'float' ? { dock: 'float', x: Math.round(fr.left), y: Math.round(fr.top) } : { dock: target });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Floating toolboxes stay inside the window when it gets smaller. */
  private keepOnScreen(): void {
    for (const f of this.frames.values()) {
      if (!f.classList.contains('floating') || !f.isConnected) continue;
      const r = f.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.left, innerWidth - Math.min(r.width, innerWidth))), y = Math.max(0, Math.min(r.top, innerHeight - 40));
      if (x !== r.left) f.style.left = `${x}px`;
      if (y !== r.top) f.style.top = `${y}px`;
    }
  }
}

/** A padlock, shut or open, for the lock buttons (in the text colour). */
export function lockIcon(locked: boolean, size = 16): string {
  const shackle = locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.6-1.8';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="${shackle}"/></svg>`;
}

// ---------------------------------------------------------------- buttons for commands and tools

/** A button for a menu command, named as in the top menus (with its tick shown as pressed). */
export function commandButton(cmd: string, run: (cmd: string) => void, label?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tb-cmd';
  b.dataset.cmd = cmd;
  const top = topMenuEntry(cmd);
  const name = label ?? top?.label ?? cmd;
  const icon = commandIcon(cmd);
  // an icon when the command has one (its name shows on hover), else the name
  if (icon) { b.innerHTML = icon; b.classList.add('tb-icon'); b.setAttribute('aria-label', name); } else b.textContent = name;
  b.title = top?.label ?? name;
  if (top?.checked != null) b.setAttribute('aria-pressed', String(top.checked));
  b.addEventListener('click', () => {
    run(cmd);
    // a checked command changes its tick: show the new one
    const now = topMenuEntry(cmd);
    if (now?.checked != null) b.setAttribute('aria-pressed', String(now.checked));
  });
  return b;
}

/** Every command in the top menus, by menu, for choosing what goes in your own toolbox. */
export function menuCommands(): { menu: string; items: { cmd: string; label: string }[] }[] {
  const out: { menu: string; items: { cmd: string; label: string }[] }[] = [];
  for (const wrap of document.querySelectorAll<HTMLElement>('header .menu-wrap')) {
    const menu = wrap.querySelector<HTMLElement>(':scope > button')?.textContent?.trim() ?? '';
    const items: { cmd: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const b of wrap.querySelectorAll<HTMLElement>('[data-cmd]')) {
      const cmd = b.dataset.cmd!;
      if (seen.has(cmd) || b.hidden) continue;
      seen.add(cmd);
      const e = topMenuEntry(cmd);
      items.push({ cmd, label: e?.label ?? cmd });
    }
    if (items.length) out.push({ menu, items });
  }
  return out;
}

/** A tool, command or palette, as Customize Toolboxes lists it. */
export interface Pickable { key: string; label: string; icon?: string }

/**
 * Where something dragged over a packed grid of buttons goes, as an index among `boxes` (in
 * reading order): before the first box below the pointer, or before the first one in the
 * pointer's row whose middle is right of it; at the end otherwise.
 */
export function slotAt(boxes: readonly Box[], x: number, y: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const r = boxes[i];
    if (y < r.top) return i;
    if (y <= r.bottom && x < (r.left + r.right) / 2) return i;
  }
  return boxes.length;
}
