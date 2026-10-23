// The tool bar down the left side. Most tools have a button of their own; related tools share a
// palette button that shows the one last picked. Its corner arrow, a second click, a right-click
// or a long press opens the whole set. Customize Toolboxes changes what is on it, so it is
// built again (fill) when that changes; any toolbox can hold tools and palettes the same way.

import { ICONS } from '../icons';

export interface ToolDef { name: string; title: string }
export interface PaletteDef {
  palette: string;
  title: string;
  items: ToolDef[];
  columns?: number;
  /** Draws an item's picture, at a given size, when it has no icon (templates). */
  icon?: (name: string, size: number) => string;
  /** Bigger buttons in the open palette (templates). */
  large?: boolean;
  /** Picture size in the open palette, in pixels, for large palettes (46 unless set). */
  iconSize?: number;
  /** The open palette's cells, row by row, `columns` wide (null: an empty cell), as Customize Toolboxes sets them. Unset: the items packed in order. */
  cells?: (string | null)[];
}
export type ToolbarItem = ToolDef | PaletteDef;

interface Palette { def: PaletteDef; button: HTMLButtonElement }

export class Toolbar {
  /** Every tool button on the bar and in toolboxes (a tool can be in several). */
  private buttons: { name: string; def: ToolDef; b: HTMLButtonElement }[] = [];
  private palettes: Palette[] = [];
  /** The tool each palette shows, as last picked from it (kept when the bar is built again). */
  private current = new Map<string, string>();
  private active = '';
  private flyout: HTMLDivElement | null = null;
  private flyoutOwner: Palette | null = null;

  /**
   * `keys` gives the hotkeys of a tool as text for its tool tip (" (x)"); call refreshTitles()
   * when the key map changes. `iconFor` draws a tool moved into a palette it didn't come in.
   */
  constructor(private root: HTMLElement, groups: ToolbarItem[][], private pick: (name: string) => void, private keys: (name: string) => string = () => '', private iconFor: (name: string, size: number) => string | undefined = () => undefined) {
    this.fill((root) => {
      for (const group of groups) {
        const g = document.createElement('div');
        g.className = 'tool-group';
        for (const item of group) g.appendChild(this.button(item));
        root.appendChild(g);
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.flyout && !this.flyout.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.palette-wrap')) this.close();
    });
    window.addEventListener('resize', () => this.close());
  }

  /** Build the bar again (Customize Toolboxes): `make` puts its buttons in, made with toolButton and paletteButton. */
  fill(make: (root: HTMLElement) => void): void {
    this.close();
    this.root.replaceChildren();
    make(this.root);
    // (the bar may be built while a toolbox is still being laid out, so nothing is forgotten here)
    if (this.active) this.mark(this.active);
  }

  /** A button for a tool or a palette. */
  button(item: ToolbarItem): HTMLElement {
    return 'palette' in item ? this.paletteButton(item) : this.toolButton(item);
  }

  /** Buttons no longer on the screen are forgotten. */
  private prune(): void {
    this.buttons = this.buttons.filter((t) => t.b.isConnected || this.root.contains(t.b));
    this.palettes = this.palettes.filter((p) => p.button.isConnected || this.root.contains(p.button));
  }

  private icon(def: PaletteDef | null, name: string, size = 28): string {
    // a palette's own pictures in the open palette; the bar's buttons keep to the 24 px icon grid
    return (size > 28 ? def?.icon?.(name, size) ?? this.iconFor(name, size) : undefined) ?? ICONS[name] ?? def?.icon?.(name, size) ?? this.iconFor(name, size) ?? name;
  }

  /** A tool's button, for the bar or any toolbox: picks the tool, and shows when it is the one in use. */
  toolButton(t: ToolDef, extraClass = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'tool' + (extraClass ? ` ${extraClass}` : '');
    b.dataset.tool = t.name;
    this.titleTool(b, t);
    b.innerHTML = this.icon(null, t.name);
    b.addEventListener('click', () => this.pick(t.name));
    b.classList.toggle('active', t.name === this.active);
    this.buttons.push({ name: t.name, def: t, b });
    return b;
  }

  private titleTool(b: HTMLButtonElement, t: ToolDef, extra = ''): void {
    b.title = t.title + this.keys(t.name) + extra;
    b.setAttribute('aria-label', t.title);
  }

  /** Show the current hotkeys in the tool tips. */
  refreshTitles(): void {
    this.prune();
    for (const t of this.buttons) this.titleTool(t.b, t.def);
    for (const pal of this.palettes) this.show(pal);
  }

  /** A palette's button (with its corner arrow), for the bar or any toolbox. */
  paletteButton(def: PaletteDef): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'palette-wrap';
    const b = document.createElement('button');
    b.className = 'tool';
    const pal: Palette = { def, button: b };
    if (!def.items.some((i) => i.name === this.current.get(def.palette))) this.current.set(def.palette, def.items[0]?.name ?? '');
    this.palettes.push(pal);
    this.show(pal);
    // a long press opens the palette too (touch screens have no right-click)
    let timer = 0, held = false;
    b.addEventListener('click', () => {
      if (held) { held = false; return; } // the press that opened it
      // a second click on the tool in use opens its set
      if (b.classList.contains('active')) { if (this.flyoutOwner === pal) this.close(); else this.open(pal); return; }
      this.pick(this.current.get(def.palette)!);
    });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.open(pal); });
    b.addEventListener('pointerdown', () => { held = false; timer = window.setTimeout(() => { held = true; this.open(pal); }, 450); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
    const more = document.createElement('button');
    more.className = 'more';
    more.title = `All ${def.title.toLowerCase()}`;
    more.setAttribute('aria-label', more.title);
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => (this.flyoutOwner === pal ? this.close() : this.open(pal)));
    wrap.append(b, more);
    const has = def.items.some((i) => i.name === this.active);
    b.classList.toggle('active', has);
    return wrap;
  }

  private show(pal: Palette): void {
    const t = pal.def.items.find((i) => i.name === this.current.get(pal.def.palette)) ?? pal.def.items[0];
    if (!t) return;
    pal.button.innerHTML = this.icon(pal.def, t.name);
    this.titleTool(pal.button, t, `. Click again, or right-click, for all ${pal.def.title.toLowerCase()}`);
    pal.button.dataset.tool = t.name;
  }

  /** Mark the tool in use (and show it on its palettes' buttons). */
  setActive(name: string): void {
    this.active = name;
    this.prune();
    this.mark(name);
    // the tool in use stays in sight when the bar scrolls (picked from Search or by a key)
    const on = this.buttons.find((t) => t.name === name && this.root.contains(t.b))?.b ?? this.palettes.find((p) => this.root.contains(p.button) && p.button.classList.contains('active'))?.button;
    on?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private mark(name: string): void {
    // (pressed or not, for screen readers)
    for (const t of this.buttons) { t.b.classList.toggle('active', t.name === name); t.b.setAttribute('aria-pressed', String(t.name === name)); }
    for (const pal of this.palettes) {
      const has = pal.def.items.some((i) => i.name === name);
      if (has && this.current.get(pal.def.palette) !== name) this.current.set(pal.def.palette, name);
      this.show(pal);
      pal.button.classList.toggle('active', has);
      pal.button.setAttribute('aria-pressed', String(has));
    }
  }

  private open(pal: Palette): void {
    this.close();
    const f = document.createElement('div');
    f.className = 'flyout';
    f.setAttribute('role', 'menu');
    f.setAttribute('aria-label', pal.def.title);
    const cols = pal.def.columns ?? 3;
    f.style.gridTemplateColumns = `repeat(${cols}, auto)`;
    // laid out on its grid: each tool in its cell, empty cells kept
    const cell = new Map(pal.def.cells?.map((n, i) => [n, i]).filter((x): x is [string, number] => !!x[0]));
    if (pal.def.cells) {
      // (an empty cell keeps its column's width and its row's height)
      const rows = Math.ceil(pal.def.cells.length / cols);
      const w = pal.def.large ? (pal.def.iconSize ? pal.def.iconSize + 6 : 52) : 34, h = pal.def.large ? w : 32;
      f.style.gridTemplateColumns = `repeat(${cols}, minmax(${w}px, auto))`;
      f.style.gridTemplateRows = `repeat(${rows}, minmax(${h}px, auto))`;
    }
    for (const t of pal.def.items) {
      const b = document.createElement('button');
      const at = cell.get(t.name);
      if (at != null) { b.style.gridRow = String(Math.floor(at / cols) + 1); b.style.gridColumn = String((at % cols) + 1); }
      b.className = 'tool' + (pal.def.large ? ' large' : '') + (t.name === this.current.get(pal.def.palette) ? ' active' : '');
      b.setAttribute('role', 'menuitem');
      this.titleTool(b, t);
      const px = pal.def.large ? pal.def.iconSize ?? 46 : 28;
      if (pal.def.large && pal.def.iconSize) b.style.width = b.style.height = `${px + 6}px`;
      b.innerHTML = this.icon(pal.def, t.name, px);
      b.addEventListener('click', () => { this.close(); this.pick(t.name); });
      f.appendChild(b);
    }
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); pal.button.focus(); }
    });
    document.body.appendChild(f);
    const r = pal.button.getBoundingClientRect();
    const top = Math.min(r.top, window.innerHeight - f.offsetHeight - 8);
    // (to the left of a palette in a toolbox at the right)
    const left = r.right + 6 + f.offsetWidth > window.innerWidth - 4 ? r.left - 6 - f.offsetWidth : r.right + 6;
    f.style.left = `${Math.max(4, left)}px`;
    f.style.top = `${Math.max(8, top)}px`;
    this.flyout = f;
    this.flyoutOwner = pal;
    f.querySelector<HTMLButtonElement>('button.active, button')?.focus();
  }

  close(): void {
    this.flyout?.remove();
    this.flyout = null;
    this.flyoutOwner = null;
  }
}
