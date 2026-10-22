// Sheet mode's finishing touches on the Home and Page Layout tabs: the font box, Orientation (text
// turned up, down, at an angle or stacked), indents, the Cell Styles gallery (Good, Bad, Neutral,
// Headings, Total, Input, Output, the Accent styles and the number styles) and the workbook's
// theme (its colours and fonts, Excel's Themes, Colours and Fonts menus).

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import { ask } from './ask';
import { growToMerges, type Sheet, type CellStyle, type Workbook } from '../sheet/workbook';
import { CELL_STYLES, cellStyleNamed, cellStylePatch, cellStyleBorders, type CellStyleGroup } from '../sheet/cell-styles';
import { WORKBOOK_THEMES, DEFAULT_THEME, themeOf, themePalette, mixTheme, sameTheme, type WorkbookTheme } from '../sheet/themes';
import { rowOf, colOf } from '../sheet/refs';

export interface LookHost {
  readonly view: SheetView;
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
}

const GROUPS: CellStyleGroup[] = ['Good, Bad and Neutral', 'Data and Model', 'Titles and Headings', 'Themed Cell Styles', 'Number Format'];

/** A menu of pictures (swatches, previews) that closes on a click outside or Escape. */
export function galleryMenu(x: number, y: number, cls: string, fill: (m: HTMLDivElement, close: () => void) => void): HTMLDivElement {
  document.querySelector('.popup-menu')?.remove();
  const m = document.createElement('div');
  m.className = `menu popup-menu ${cls}`;
  m.setAttribute('role', 'menu');
  const off = () => {
    document.removeEventListener('pointerdown', close, true);
    document.removeEventListener('keydown', close, true);
  };
  const shut = () => { m.remove(); off(); };
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    if (e instanceof PointerEvent && m.contains(e.target as Node)) return;
    shut();
  };
  fill(m, shut);
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', close, true); });
  return m;
}

const heading = (text: string) => {
  const h = document.createElement('div');
  h.className = 'gallery-head';
  h.textContent = text;
  return h;
};

/** The theme's colours (ten columns with their shades) for the top of a colour menu. */
export function themeColourGrid(theme: WorkbookTheme, pick: (c: string) => void): HTMLElement {
  const box = document.createElement('div');
  box.append(heading('Theme Colours'));
  const grid = document.createElement('div');
  grid.className = 'colour-grid theme-grid';
  const cols = themePalette(theme);
  // row by row: the colours, then each shade
  for (let row = 0; row < 6; row++) {
    for (const col of cols) {
      const c = col.colours[row];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c;
      b.title = row === 0 ? `${col.name} (${c})` : `${col.name}, shade ${row} (${c})`;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => pick(c));
      grid.append(b);
    }
  }
  box.append(grid, heading('Standard Colours'));
  return box;
}

export class SheetLook {
  constructor(private host: LookHost) {}

  private get view(): SheetView { return this.host.view; }
  private get wb(): Workbook | null { return this.view.wb; }
  get theme(): WorkbookTheme { return themeOf(this.wb?.theme); }

  private style(label: string, patch: Partial<CellStyle> | ((st: CellStyle) => Partial<CellStyle>)): void {
    const v = this.view;
    this.host.edit(label, (s) => {
      for (const a of v.areas()) {
        const R = growToMerges(s, a);
        if (typeof patch !== 'function') { s.patchStyle(R, patch); continue; }
        // per cell (an indent goes up from each cell's own)
        const keys = s.keysIn(R);
        if (!keys.length || keys.length > 20000) { s.patchStyle(R, patch(s.styleAt(R.r1, R.c1) ?? {})); continue; }
        for (const k of keys) {
          const r = rowOf(k), c = colOf(k);
          s.patchStyle({ r1: r, c1: c, r2: r, c2: c }, patch(s.styleAt(r, c) ?? {}));
        }
        // empty cells in the block take the first cell's
        if (keys.length < (R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1)) {
          const first = patch(s.styleAt(R.r1, R.c1) ?? {});
          for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 499); r++) for (let c = R.c1; c <= Math.min(R.c2, R.c1 + 99); c++) if (!s.cell(r, c)) s.patchStyle({ r1: r, c1: c, r2: r, c2: c }, first);
        }
      }
    });
  }

  /** The font box: a font for the selected cells (empty: the theme's body font). */
  setFont(name: string): void {
    const f = name.trim();
    this.style('Font', { font: f && f.toLowerCase() !== this.theme.minor.toLowerCase() ? f : undefined });
  }

  // ---------------------------------------------------------------- orientation and indent

  orientationMenu(x: number, y: number): void {
    const cur = this.view.sheet?.styleAt(this.view.sel.active.r, this.view.sel.active.c)?.rotate;
    const it = (label: string, deg: number | undefined): [string, () => void] => [`${cur === deg ? '✓ ' : ''}${label}`, () => this.style('Orientation', { rotate: deg })];
    popupMenu(x, y, [
      it('Horizontal', undefined),
      it('Angle Counterclockwise', 45),
      it('Angle Clockwise', -45),
      it('Vertical Text (stacked letters)', 255),
      it('Rotate Text Up', 90),
      it('Rotate Text Down', -90),
      null,
      ['Format Cell Alignment…', () => void this.angleWindow(cur)],
    ]);
  }

  private async angleWindow(cur: number | undefined): Promise<void> {
    const got = await ask('Text orientation', [
      { name: 'deg', label: 'Degrees', value: String(cur === 255 ? 0 : cur ?? 0), type: 'number', unit: '°', help: 'From −90 (turned down) to 90 (turned up); 0 is level.' },
      { name: 'stack', label: 'Stack the letters (one under another)', value: String(cur === 255), type: 'checkbox' },
    ]);
    this.view.focus();
    if (!got) return;
    if (got.stack === 'true') { this.style('Orientation', { rotate: 255 }); return; }
    const d = Math.round(Number(got.deg));
    if (!Number.isFinite(d) || d < -90 || d > 90) { this.host.flash('Give an angle from −90 to 90 degrees.'); return; }
    this.style('Orientation', { rotate: d || undefined });
  }

  /** Increase or Decrease Indent (Excel's limit is 250; a level is about three characters). */
  indent(by: 1 | -1): void {
    this.style(by > 0 ? 'Increase indent' : 'Decrease indent', (st) => {
      const n = Math.max(0, Math.min(250, (st.indent ?? 0) + by));
      // indenting a cell that lines up by its type puts it on the left, as Excel does
      return { indent: n || undefined, ...(by > 0 && !st.align ? { align: 'left' as const } : {}) };
    });
  }

  // ---------------------------------------------------------------- cell styles

  /** Home > Cell Styles: a gallery of the styles, each shown in its own look. */
  cellStylesMenu(x: number, y: number): void {
    const t = this.theme;
    const cur = this.view.sheet?.styleAt(this.view.sel.active.r, this.view.sel.active.c)?.cellStyle ?? 'Normal';
    galleryMenu(x, y, 'cell-styles-menu', (m, close) => {
      for (const g of GROUPS) {
        m.append(heading(g));
        const grid = document.createElement('div');
        grid.className = 'cell-style-grid';
        for (const def of CELL_STYLES.filter((d) => d.group === g)) {
          const look = def.look(t);
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cell-style-swatch';
          b.textContent = def.name;
          b.title = `${def.name} (Excel's own style: Excel shows it under the same name)`;
          if (def.name === cur) b.setAttribute('aria-pressed', 'true');
          if (look.fill) b.style.background = look.fill;
          if (look.color) b.style.color = look.color;
          if (look.bold) b.style.fontWeight = '700';
          if (look.italic) b.style.fontStyle = 'italic';
          if (look.font) b.style.fontFamily = `"${look.font}", sans-serif`;
          if (look.size && look.size > 11) b.style.fontSize = `${Math.min(15, look.size - 2)}px`;
          const bd = look.borders;
          if (bd?.bottom) b.style.borderBottom = `${bd.bottom.style === 'thick' ? 3 : bd.bottom.style === 'double' ? 3 : bd.bottom.style === 'medium' ? 2 : 1}px ${bd.bottom.style === 'double' ? 'double' : 'solid'} ${bd.bottom.color ?? '#000'}`;
          if (bd?.top) b.style.borderTop = `1px solid ${bd.top.color ?? '#000'}`;
          b.addEventListener('click', () => { close(); this.applyCellStyle(def.name); });
          grid.append(b);
        }
        m.append(grid);
      }
    });
  }

  /** Put a cell style on the selected cells: its font, fill and borders replace theirs. */
  applyCellStyle(name: string): void {
    const v = this.view, theme = this.wb?.theme ?? null;
    const patch = cellStylePatch(name, theme);
    const borders = cellStyleBorders(name, theme);
    const numberOnly = cellStyleNamed(name)?.group === 'Number Format';
    this.host.edit(`Cell style: ${name}`, (s) => {
      for (const a of v.areas()) {
        const R = growToMerges(s, a);
        s.patchStyle(R, patch);
        if (!numberOnly && borders) s.patchStyle(R, { borders });
      }
    });
    v.focus();
  }

  // ---------------------------------------------------------------- themes

  themesMenu(x: number, y: number): void {
    this.themeGallery(x, y, 'Themes', (t) => t, (t) => this.setTheme(t, `Theme: ${t.name}`));
  }

  coloursMenu(x: number, y: number): void {
    this.themeGallery(x, y, 'Colours', (t) => mixTheme(this.theme, t, null), (t) => this.setTheme(mixTheme(this.theme, t, null), `Theme colours: ${t.name}`));
  }

  fontsMenu(x: number, y: number): void {
    const cur = this.theme;
    popupMenu(x, y, WORKBOOK_THEMES.filter((t, i, all) => all.findIndex((o) => o.major === t.major && o.minor === t.minor) === i).map((t) => {
      const on = t.major === cur.major && t.minor === cur.minor;
      return [`${on ? '✓ ' : ''}${t.major === t.minor ? t.major : `${t.major} / ${t.minor}`}`, () => this.setTheme(mixTheme(cur, null, t), `Theme fonts: ${t.minor}`)];
    }));
  }

  private themeGallery(x: number, y: number, title: string, preview: (t: WorkbookTheme) => WorkbookTheme, pick: (t: WorkbookTheme) => void): void {
    const cur = this.theme;
    galleryMenu(x, y, 'theme-menu', (m, close) => {
      m.append(heading(title));
      for (const t of WORKBOOK_THEMES) {
        const p = preview(t);
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.className = 'theme-item';
        if (sameTheme(p, cur)) b.setAttribute('aria-pressed', 'true');
        const sw = document.createElement('span');
        sw.className = 'theme-swatches';
        for (const c of t.colors.slice(4, 10)) {
          const s = document.createElement('span');
          s.style.background = c;
          sw.append(s);
        }
        const name = document.createElement('span');
        name.textContent = title === 'Themes' ? `${t.name}: ${t.major === t.minor ? t.major : `${t.major} and ${t.minor}`}` : t.name;
        name.style.fontFamily = `"${t.minor}", sans-serif`;
        b.append(sw, name);
        b.addEventListener('click', () => { close(); pick(t); });
        m.append(b);
      }
    });
  }

  /**
   * Change the workbook's theme. Cells styled with a theme's look (Headings, Title, Total, the
   * Accent styles) that still look that way take the new theme's colours and fonts.
   */
  setTheme(t: WorkbookTheme, label: string): void {
    const wb = this.wb;
    if (!wb) return;
    const old = wb.theme;
    const next = sameTheme(t, DEFAULT_THEME) && t.name === DEFAULT_THEME.name ? null : t;
    if (sameTheme(old, next) && (old?.name ?? 'Office') === (next?.name ?? 'Office')) return;
    this.host.edit(label, () => {
      wb.setTheme(next);
      for (const s of wb.sheets) {
        for (const [k, cell] of s.cells) {
          const name = cell.style?.cellStyle;
          if (!name) continue;
          const def = cellStyleNamed(name);
          if (!def || def.group === 'Number Format') continue;
          const was = def.look(themeOf(old));
          const st = cell.style!;
          if ((was.fill ?? undefined) !== (st.fill ?? undefined) || (was.color ?? undefined) !== (st.color ?? undefined)) continue;
          const r = rowOf(k), c = colOf(k), R = { r1: r, c1: c, r2: r, c2: c };
          s.patchStyle(R, cellStylePatch(name, next));
          const b = cellStyleBorders(name, next);
          if (b) s.patchStyle(R, { borders: b });
        }
      }
    });
    this.view.refresh();
  }
}
