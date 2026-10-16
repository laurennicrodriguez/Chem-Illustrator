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
}

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
export const TOOLBOX_IDS = ['main', 'structure', 'arrange', 'templates', 'colours', 'custom', 'details'] as const;
export type ToolboxId = (typeof TOOLBOX_IDS)[number];

export function defaultToolboxes(): ToolboxState {
  const places: Record<string, BoxPlace> = {};
  TOOLBOX_IDS.forEach((id, i) => { places[id] = { shown: id === 'main', dock: id === 'main' ? 'left' : 'float', x: 110 + i * 24, y: 90 + i * 64 }; });
  // the side panel, when taken out, starts near where it was
  places.details = { shown: false, dock: 'right', x: 900, y: 90 };
  return { locked: true, places, custom: ['cmd:clean-up', 'cmd:add-frame', 'cmd:fill-rings', 'cmd:highlight', 'cmd:chain-ends'], sideCollapsed: false };
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
  if (Array.isArray(r.custom)) s.custom = r.custom.filter((x): x is string => typeof x === 'string' && /^(tool|cmd):[\w:-]+$/.test(x)).slice(0, 80);
  return s;
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
  id: ToolboxId;
  title: string;
  /** Fill the toolbox's body; `vertical` when it is docked at the left or right. */
  build(body: HTMLElement, vertical: boolean): void;
}

export interface ToolboxHooks {
  get(): ToolboxState;
  set(s: ToolboxState): void;
  /** The drawing area, whose edges are the docks' drop zones. */
  work(): HTMLElement;
  /** Open the window for choosing what is in your own toolbox. */
  customize(): void;
}

const DOCK_LABEL: Record<Dock, string> = { left: 'Dock Left', right: 'Dock Right', top: 'Dock at the Top', bottom: 'Dock at the Bottom', float: 'Float' };

export class Toolboxes {
  private frames = new Map<string, HTMLElement>();
  private docks: Record<Exclude<Dock, 'float'>, HTMLElement>;

  constructor(private defs: ToolboxDef[], private hooks: ToolboxHooks) {
    this.docks = {
      left: document.getElementById('dock-left')!, right: document.getElementById('dock-right')!,
      top: document.getElementById('dock-top')!, bottom: document.getElementById('dock-bottom')!,
    };
    window.addEventListener('resize', () => this.keepOnScreen());
  }

  /** Show every toolbox where the settings say (building them again, so their contents are up to date). */
  render(): void {
    const st = this.hooks.get();
    for (const def of this.defs) {
      const place = st.places[def.id];
      let f = this.frames.get(def.id);
      if (!place?.shown) { f?.remove(); continue; }
      if (!f) { f = this.frame(def); this.frames.set(def.id, f); }
      const vertical = place.dock === 'left' || place.dock === 'right';
      f.classList.toggle('vertical', vertical);
      f.classList.toggle('floating', place.dock === 'float');
      f.classList.toggle('collapsed', !!place.collapsed);
      const locked = boxLocked(st, def.id);
      f.classList.toggle('locked', locked);
      const fold = f.querySelector<HTMLElement>('.tb-fold');
      if (fold) { fold.textContent = place.collapsed ? '▸' : '▾'; fold.title = place.collapsed ? `Open ${def.title} out` : `Fold ${def.title} up to its title`; }
      const lock = f.querySelector<HTMLElement>('.tb-lock');
      if (lock) { lock.innerHTML = lockIcon(locked, 14); lock.title = locked ? `${def.title} is locked: click to unlock it, then drag it by its title` : `${def.title} is unlocked: click to lock it where it is`; lock.setAttribute('aria-pressed', String(locked)); }
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
    for (const d of Object.values(this.docks)) {
      const kids = [...d.children] as HTMLElement[];
      kids.sort((a, b) => TOOLBOX_IDS.indexOf(a.dataset.id as ToolboxId) - TOOLBOX_IDS.indexOf(b.dataset.id as ToolboxId)).forEach((k) => d.append(k));
    }
    this.keepOnScreen();
  }

  /** Show or hide a toolbox (View > Toolboxes). */
  toggle(id: ToolboxId, show?: boolean): void {
    const st = this.hooks.get();
    const p = st.places[id];
    this.change({ ...st, places: { ...st.places, [id]: { ...p, shown: show ?? !p.shown } } });
  }

  isShown(id: ToolboxId): boolean {
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
    const p = this.hooks.get().places[id];
    if (p) this.place(id, { collapsed: (collapsed ?? !p.collapsed) || undefined });
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
    if (def.id === 'details') close.title = 'Put the panel back at the right side';
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
    const body = document.createElement('div');
    body.className = 'tb-body';
    f.append(head, body);
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
      { cmd: 'tbx:fold', label: st.places[def.id]?.collapsed ? 'Open Out' : 'Fold Up' },
      ...(def.id === 'custom' ? [{ cmd: 'tbx:customize', label: 'Choose What Is in It…' }] : []),
      { cmd: 'tbx:hide', label: def.id === 'details' ? 'Put Back at the Right Side' : `Hide ${def.title}` },
    ];
    showContextMenu(x, y, items, {
      key: () => undefined,
      run: (cmd) => {
        const what = cmd.slice(4);
        if (what === 'lock') this.setBoxLocked(def.id, !boxLocked(st, def.id));
        else if (what === 'lock-all') this.setLocked(!st.locked);
        else if (what === 'hide') this.toggle(def.id, false);
        else if (what === 'fold') this.fold(def.id);
        else if (what === 'customize') this.hooks.customize();
        else if (DOCKS.includes(what as Dock)) {
          const r = this.frames.get(def.id)?.getBoundingClientRect();
          this.place(def.id, what === 'float' && r ? { dock: 'float', x: Math.round(r.left + 24), y: Math.round(r.top + 24) } : { dock: what as Dock });
        }
      },
    });
  }

  /** Drag a toolbox by its title: it follows the pointer, and the dock it would go to lights up. */
  private drag(id: string, f: HTMLElement, e: PointerEvent): void {
    if (boxLocked(this.hooks.get(), id)) return;
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

// ---------------------------------------------------------------- choosing what is in your own toolbox

export interface Pickable { key: string; label: string; icon?: string }

let customDialog: HTMLDialogElement | null = null;

/**
 * The window for your own toolbox: every tool and menu command, ticked when it is in the
 * toolbox, and the toolbox's items in order (moved up and down, or taken out).
 */
export function customizeToolbox(groups: { name: string; items: Pickable[] }[], get: () => string[], set: (items: string[]) => void): void {
  if (!customDialog) {
    customDialog = document.createElement('dialog');
    customDialog.className = 'toolbox-dialog';
    customDialog.setAttribute('aria-label', 'My Toolbox');
    customDialog.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.body.append(customDialog);
  }
  const d = customDialog;
  const label = new Map<string, Pickable>();
  for (const g of groups) for (const it of g.items) label.set(it.key, it);
  let filter = '';
  const draw = () => {
    d.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = 'My Toolbox';
    const intro = document.createElement('p');
    intro.className = 'muted';
    intro.textContent = 'Tick the tools and commands you want together in one toolbox. View > Toolboxes > My Toolbox shows it.';
    const cols = document.createElement('div');
    cols.className = 'tbd-cols';

    const left = document.createElement('div');
    left.className = 'tbd-all';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Find a tool or command';
    search.value = filter;
    search.setAttribute('aria-label', 'Find a tool or command');
    search.addEventListener('input', () => { filter = search.value; fillList(); });
    const list = document.createElement('div');
    list.className = 'tbd-list';
    const fillList = () => {
      list.replaceChildren();
      const q = filter.trim().toLowerCase();
      for (const g of groups) {
        const items = g.items.filter((it) => !q || it.label.toLowerCase().includes(q));
        if (!items.length) continue;
        const gh = document.createElement('div');
        gh.className = 'tbd-group';
        gh.textContent = g.name;
        list.append(gh);
        for (const it of items) {
          const row = document.createElement('label');
          row.className = 'tbd-item';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = get().includes(it.key);
          box.addEventListener('change', () => {
            const cur = get();
            set(box.checked ? [...cur, it.key] : cur.filter((k) => k !== it.key));
            drawOrder();
          });
          const ic = document.createElement('span');
          ic.className = 'tbd-icon';
          if (it.icon) ic.innerHTML = it.icon;
          row.append(box, ic, document.createTextNode(it.label));
          list.append(row);
        }
      }
    };
    left.append(search, list);

    const right = document.createElement('div');
    right.className = 'tbd-order';
    const oh = document.createElement('div');
    oh.className = 'tbd-group';
    oh.textContent = 'In my toolbox, in order';
    const order = document.createElement('ol');
    const drawOrder = () => {
      const cur = get();
      order.replaceChildren();
      if (!cur.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'Nothing yet: tick some on the left.';
        order.append(li);
      }
      cur.forEach((k, i) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = label.get(k)?.label ?? k;
        const btn = (t: string, title: string, on: () => void, off: boolean) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = t;
          b.title = title;
          b.setAttribute('aria-label', `${title}: ${name.textContent}`);
          b.disabled = off;
          b.addEventListener('click', () => { on(); drawOrder(); fillList(); });
          return b;
        };
        const move = (to: number) => { const n = cur.slice(); const [x] = n.splice(i, 1); n.splice(to, 0, x); set(n); };
        li.append(name, btn('↑', 'Move up', () => move(i - 1), i === 0), btn('↓', 'Move down', () => move(i + 1), i === cur.length - 1),
          btn('×', 'Take out', () => set(cur.filter((_, j) => j !== i)), false));
        order.append(li);
      });
    };
    right.append(oh, order);
    cols.append(left, right);

    const foot = document.createElement('div');
    foot.className = 'hk-foot';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Empty it';
    clear.addEventListener('click', () => { set([]); drawOrder(); fillList(); });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'primary';
    close.textContent = 'Close';
    close.addEventListener('click', () => d.close());
    foot.append(clear, close);
    d.append(h, intro, cols, foot);
    fillList();
    drawOrder();
  };
  draw();
  if (!d.open) d.showModal();
}
