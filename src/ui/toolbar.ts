// The tool bar down the left side. Most tools have a button of their own; related tools share a
// palette button that shows the one last picked. Its corner arrow, a second click, a right-click
// or a long press opens the whole set.

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
}
export type ToolbarItem = ToolDef | PaletteDef;

interface Palette { def: PaletteDef; button: HTMLButtonElement; current: string }

export class Toolbar {
  private buttons = new Map<string, HTMLButtonElement>();
  private defs = new Map<string, ToolDef>();
  private palettes: Palette[] = [];
  private flyout: HTMLDivElement | null = null;
  private flyoutOwner: Palette | null = null;

  /**
   * `keys` gives the hotkeys of a tool as text for its tool tip (" (x)"); call refreshTitles()
   * when the key map changes.
   */
  constructor(root: HTMLElement, groups: ToolbarItem[][], private pick: (name: string) => void, private keys: (name: string) => string = () => '') {
    for (const group of groups) {
      const g = document.createElement('div');
      g.className = 'tool-group';
      for (const item of group) g.appendChild('palette' in item ? this.paletteButton(item) : this.toolButton(item));
      root.appendChild(g);
    }
    document.addEventListener('pointerdown', (e) => {
      if (this.flyout && !this.flyout.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.palette-wrap')) this.close();
    });
    window.addEventListener('resize', () => this.close());
  }

  private icon(def: PaletteDef | null, name: string, size = 28): string {
    // a palette's own pictures in the open palette; the bar's buttons keep to the 24 px icon grid
    return (size > 28 ? def?.icon?.(name, size) : undefined) ?? ICONS[name] ?? def?.icon?.(name, size) ?? name;
  }

  private toolButton(t: ToolDef): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.name;
    this.titleTool(b, t);
    b.innerHTML = this.icon(null, t.name);
    b.addEventListener('click', () => this.pick(t.name));
    this.buttons.set(t.name, b);
    this.defs.set(t.name, t);
    return b;
  }

  private titleTool(b: HTMLButtonElement, t: ToolDef, extra = ''): void {
    b.title = t.title + this.keys(t.name) + extra;
    b.setAttribute('aria-label', t.title);
  }

  /** Show the current hotkeys in the tool tips. */
  refreshTitles(): void {
    for (const [name, b] of this.buttons) this.titleTool(b, this.defs.get(name)!);
    for (const pal of this.palettes) this.show(pal);
  }

  private paletteButton(def: PaletteDef): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'palette-wrap';
    const b = document.createElement('button');
    b.className = 'tool';
    const pal: Palette = { def, button: b, current: def.items[0].name };
    this.palettes.push(pal);
    this.show(pal);
    // a long press opens the palette too (touch screens have no right-click)
    let timer = 0, held = false;
    b.addEventListener('click', () => {
      if (held) { held = false; return; } // the press that opened it
      // a second click on the tool in use opens its set
      if (b.classList.contains('active')) { if (this.flyoutOwner === pal) this.close(); else this.open(pal); return; }
      this.pick(pal.current);
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
    return wrap;
  }

  private show(pal: Palette): void {
    const t = pal.def.items.find((i) => i.name === pal.current)!;
    pal.button.innerHTML = this.icon(pal.def, t.name);
    this.titleTool(pal.button, t, `. Click again, or right-click, for all ${pal.def.title.toLowerCase()}`);
    pal.button.dataset.tool = t.name;
  }

  /** Mark the tool in use (and show it on its palette's button). */
  setActive(name: string): void {
    for (const [n, b] of this.buttons) b.classList.toggle('active', n === name);
    for (const pal of this.palettes) {
      const has = pal.def.items.some((i) => i.name === name);
      if (has && pal.current !== name) { pal.current = name; this.show(pal); }
      pal.button.classList.toggle('active', has);
    }
    // the tool in use stays in sight when the bar scrolls (picked from Search or by a key)
    const on = this.buttons.get(name) ?? this.palettes.find((p) => p.current === name && p.button.classList.contains('active'))?.button;
    on?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private open(pal: Palette): void {
    this.close();
    const f = document.createElement('div');
    f.className = 'flyout';
    f.setAttribute('role', 'menu');
    f.setAttribute('aria-label', pal.def.title);
    f.style.gridTemplateColumns = `repeat(${pal.def.columns ?? 3}, auto)`;
    for (const t of pal.def.items) {
      const b = document.createElement('button');
      b.className = 'tool' + (pal.def.large ? ' large' : '') + (t.name === pal.current ? ' active' : '');
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
    f.style.left = `${r.right + 6}px`;
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
