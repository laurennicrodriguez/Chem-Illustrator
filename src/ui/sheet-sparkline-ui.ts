// Insert > Sparklines and the Sparkline tab in Sheet mode: make line, column or win/loss sparklines
// from a block of numbers, then change the group's type, the points marked, colours, axis, how
// empty cells show, its data, or clear it.

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import { ToolWindow, absText } from './tool-window';
import { ask } from './ask';
import { galleryMenu, themeColourGrid } from './sheet-look-ui';
import type { Sheet, Workbook } from '../sheet/workbook';
import { readRef } from '../sheet/chart';
import { quoteSheet } from '../sheet/refs';
import { makeSparklines, sparklineAt, SPARK_STYLES, type SparkKind, type SparklineGroup, type SparkAxisLimit } from '../sheet/sparklines';
import { themeOf } from '../sheet/themes';

export interface SparkHost {
  readonly view: SheetView;
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
}

const KIND_NAMES: Record<SparkKind, string> = { line: 'Line', column: 'Column', winloss: 'Win/Loss' };

/** A small menu of colours: the theme's, then a few standard ones and any colour. */
export function colourPopup(x: number, y: number, wb: Workbook | null, pick: (c: string) => void): void {
  galleryMenu(x, y, 'colour-menu', (m, close) => {
    const done = (c: string) => { close(); pick(c); };
    m.append(themeColourGrid(themeOf(wb?.theme), done));
    const grid = document.createElement('div');
    grid.className = 'colour-grid theme-grid';
    for (const c of ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', c);
      b.addEventListener('click', () => done(c));
      grid.append(b);
    }
    const more = document.createElement('label');
    more.className = 'colour-more';
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.systemPicker = '';
    input.addEventListener('change', () => done(input.value));
    more.append('More colours ', input);
    m.append(grid, more);
  });
}

export class SheetSparklines {
  constructor(private host: SparkHost) {}

  private get view(): SheetView { return this.host.view; }

  /** The sparkline at the active cell, and its group. */
  here(): { group: SparklineGroup; row: number; col: number } | null {
    const s = this.view.sheet;
    if (!s || !s.sparklines.length) return null;
    const { r, c } = this.view.sel.active;
    const at = sparklineAt(s.sparklines, r, c);
    return at ? { group: at.group, row: r, col: c } : null;
  }

  /** Change the group at the active cell. */
  private setGroup(label: string, patch: Partial<SparklineGroup>): void {
    const h = this.here();
    if (!h) return;
    this.host.edit(label, (s) => s.setSparklines(s.sparklines.map((g) => (g.id === h.group.id ? { ...g, ...patch } : g))));
  }

  /** Insert > Sparklines: the Create Sparklines window. */
  insert(kind: SparkKind): void {
    const s = this.view.sheet, wb = this.view.wb;
    if (!s || !wb || s.dashboard) return;
    const R = this.view.sel.range;
    const block = R.r1 === R.r2 && R.c1 === R.c2 ? null : (s.clip(R) ?? R);
    const w = new ToolWindow(`Create ${KIND_NAMES[kind]} Sparklines`);
    w.home = s.name;
    w.note('Choose the data that you want, then where to put the sparklines: one cell for each row (or column) of the data.');
    const data = w.ref('Data Range', block ? absText(block, null) : '');
    // a column of cells just right of the data is the usual place
    const place = w.ref('Location Range', block ? absText({ r1: block.r1, c1: block.c2 + 1, r2: block.r2, c2: block.c2 + 1 }, null) : '');
    if (block) setTimeout(() => place.focus());
    w.actions('OK', () => {
      const home = wb.sheetNamed(w.home ?? '') ?? s;
      const d = readRef(wb, data.value, home);
      if (!d) return 'The data range isn\'t a block of cells.';
      const p = readRef(wb, place.value, home);
      if (!p) return 'The location range isn\'t a block of cells.';
      if (p.sheet !== home) return 'Put the sparklines on this sheet.';
      const g = makeSparklines(kind, d.range, p.range, d.sheet !== home ? d.sheet.name : undefined);
      if (typeof g === 'string') return g;
      this.host.edit('Insert sparklines', (sh) => {
        const taken = new Set(g.items.map((it) => `${it.row},${it.col}`));
        // a cell holds one sparkline: the new one replaces any there
        const kept = sh.sparklines.map((x) => ({ ...x, items: x.items.filter((it) => !taken.has(`${it.row},${it.col}`)) })).filter((x) => x.items.length);
        sh.setSparklines([...kept, g]);
      });
      this.view.select(p.range);
    });
    w.show();
  }

  setKind(kind: SparkKind): void { this.setGroup('Sparkline type', { kind }); }

  /** The Show checkboxes (High Point, Markers…). */
  setOption(opt: 'high' | 'low' | 'negative' | 'first' | 'last' | 'markers', on: boolean): void {
    this.setGroup('Sparkline points', { [opt]: on || undefined });
  }

  styleMenu(x: number, y: number): void {
    const h = this.here();
    if (!h) return;
    galleryMenu(x, y, 'spark-style-menu', (m, close) => {
      for (const st of SPARK_STYLES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.className = 'theme-item';
        const sw = document.createElement('span');
        sw.className = 'theme-swatches';
        for (const c of [st.color, st.mark, st.neg]) { const s = document.createElement('span'); s.style.background = c; sw.append(s); }
        b.append(sw, st.name);
        b.addEventListener('click', () => {
          close();
          this.setGroup('Sparkline style', { color: st.color, markerColor: st.mark, highColor: st.mark, lowColor: st.mark, firstColor: st.mark, lastColor: st.mark, negColor: st.neg });
        });
        m.append(b);
      }
    });
  }

  colourMenu(x: number, y: number): void {
    const h = this.here();
    if (!h) return;
    const w = h.group.weight ?? 0.75;
    popupMenu(x, y, [
      ['Colour…', () => colourPopup(x, y, this.view.wb, (c) => this.setGroup('Sparkline colour', { color: c }))],
      null,
      ...[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3].map((pt) => [`${pt === w ? '✓ ' : ''}Weight ${pt} pt`, () => this.setGroup('Sparkline weight', { weight: pt === 0.75 ? undefined : pt })] as [string, () => void]),
    ]);
  }

  markerColourMenu(x: number, y: number): void {
    const h = this.here();
    if (!h) return;
    const one = (label: string, key: 'negColor' | 'markerColor' | 'highColor' | 'lowColor' | 'firstColor' | 'lastColor'): [string, () => void] =>
      [`${label}…`, () => colourPopup(x, y, this.view.wb, (c) => this.setGroup(`${label} colour`, { [key]: c }))];
    popupMenu(x, y, [
      one('Negative Points', 'negColor'),
      one('Markers', 'markerColor'),
      one('High Point', 'highColor'),
      one('Low Point', 'lowColor'),
      one('First Point', 'firstColor'),
      one('Last Point', 'lastColor'),
    ]);
  }

  axisMenu(x: number, y: number): void {
    const h = this.here();
    if (!h) return;
    const g = h.group;
    const tick = (on: boolean) => (on ? '✓ ' : '');
    const limit = (which: 'minAxis' | 'maxAxis', label: string): [string, () => void][] => {
      const cur: SparkAxisLimit = g[which] ?? 'each';
      return [
        [`${tick(cur === 'each')}${label}: Automatic for Each Sparkline`, () => this.setGroup('Sparkline axis', { [which]: undefined })],
        [`${tick(cur === 'group')}${label}: Same for All Sparklines`, () => this.setGroup('Sparkline axis', { [which]: 'group' })],
        [`${tick(typeof cur === 'number')}${label}: Custom Value…${typeof cur === 'number' ? ` (${cur})` : ''}`, () => void this.customLimit(which, label)],
      ];
    };
    popupMenu(x, y, [
      [`${tick(!!g.axis)}Show Axis`, () => this.setGroup('Sparkline axis', { axis: !g.axis || undefined })],
      [`${tick(!!g.rtl)}Plot Data Right-to-Left`, () => this.setGroup('Sparkline axis', { rtl: !g.rtl || undefined })],
      null,
      ...limit('minAxis', 'Minimum'),
      null,
      ...limit('maxAxis', 'Maximum'),
    ]);
  }

  private async customLimit(which: 'minAxis' | 'maxAxis', label: string): Promise<void> {
    const cur = this.here()?.group[which];
    const got = await ask(`Sparkline Vertical Axis Setting`, [{ name: 'v', label: `${label} value`, value: typeof cur === 'number' ? String(cur) : which === 'minAxis' ? '0' : '', type: 'number' }]);
    this.view.focus();
    if (!got) return;
    const n = Number(got.v);
    if (!got.v.trim() || !Number.isFinite(n)) { this.host.flash('Give a number.'); return; }
    this.setGroup('Sparkline axis', { [which]: n });
  }

  emptyMenu(x: number, y: number): void {
    const h = this.here();
    if (!h) return;
    const g = h.group, tick = (on: boolean) => (on ? '✓ ' : '');
    popupMenu(x, y, [
      [`${tick(!g.empty)}Show empty cells as Gaps`, () => this.setGroup('Empty cells', { empty: undefined })],
      [`${tick(g.empty === 'zero')}Show empty cells as Zero`, () => this.setGroup('Empty cells', { empty: 'zero' })],
      [`${tick(g.empty === 'span')}Connect data points with line`, () => this.setGroup('Empty cells', { empty: 'span' }), g.kind === 'line'],
      null,
      [`${tick(!!g.hidden)}Show data in hidden rows and columns`, () => this.setGroup('Hidden cells', { hidden: !g.hidden || undefined })],
    ]);
  }

  clearMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['Clear Selected Sparklines', () => this.clear(false)],
      ['Clear Selected Sparkline Groups', () => this.clear(true)],
    ]);
  }

  clear(whole: boolean): void {
    const s = this.view.sheet;
    if (!s) return;
    const areas = this.view.areas();
    const inSel = (r: number, c: number) => areas.some((a) => r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2);
    const hit = s.sparklines.filter((g) => g.items.some((it) => inSel(it.row, it.col)));
    if (!hit.length) { this.host.flash('No sparklines in the selected cells.'); return; }
    this.host.edit(whole ? 'Clear sparkline groups' : 'Clear sparklines', (sh) => {
      sh.setSparklines(sh.sparklines.flatMap((g) => {
        if (!hit.includes(g)) return [g];
        if (whole) return [];
        const items = g.items.filter((it) => !inSel(it.row, it.col));
        return items.length ? [{ ...g, items }] : [];
      }));
    });
  }

  editMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['Edit Group Location & Data…', () => this.editGroup()],
      ['Edit Single Sparkline\'s Data…', () => void this.editOne()],
    ]);
  }

  /** The group's data and place, as one block each (made again with its look kept). */
  private editGroup(): void {
    const h = this.here(), s = this.view.sheet, wb = this.view.wb;
    if (!h || !s || !wb) return;
    const g = h.group;
    const blocks = g.items.map((it) => readRef(wb, it.data, s)).filter((b): b is NonNullable<typeof b> => !!b);
    if (!blocks.length) return;
    const src = blocks[0].sheet;
    const all = blocks.reduce((a, b) => ({ r1: Math.min(a.r1, b.range.r1), c1: Math.min(a.c1, b.range.c1), r2: Math.max(a.r2, b.range.r2), c2: Math.max(a.c2, b.range.c2) }), blocks[0].range);
    const rs = g.items.map((it) => it.row), cs = g.items.map((it) => it.col);
    const where = { r1: Math.min(...rs), c1: Math.min(...cs), r2: Math.max(...rs), c2: Math.max(...cs) };
    const w = new ToolWindow('Edit Sparklines');
    w.home = s.name;
    const data = w.ref('Data Range', absText(all, src !== s ? src.name : null));
    const place = w.ref('Location Range', absText(where, null));
    w.actions('OK', () => {
      const d = readRef(wb, data.value, s);
      const p = readRef(wb, place.value, s);
      if (!d || !p) return 'Give the data and the location as blocks of cells.';
      if (p.sheet !== s) return 'Put the sparklines on this sheet.';
      const made = makeSparklines(g.kind, d.range, p.range, d.sheet !== s ? d.sheet.name : undefined);
      if (typeof made === 'string') return made;
      this.host.edit('Edit sparklines', (sh) => sh.setSparklines(sh.sparklines.map((x) => (x.id === g.id ? { ...g, items: made.items } : x))));
    });
    w.show();
  }

  private async editOne(): Promise<void> {
    const h = this.here(), s = this.view.sheet, wb = this.view.wb;
    if (!h || !s || !wb) return;
    const it = h.group.items.find((x) => x.row === h.row && x.col === h.col)!;
    const got = await ask('Edit Sparkline Data', [{ name: 'd', label: 'Data range', value: it.data, type: 'text' }]);
    this.view.focus();
    if (!got) return;
    const d = readRef(wb, got.d, s);
    if (!d) { this.host.flash('That isn\'t a block of cells.'); return; }
    const text = (d.sheet !== s ? `${quoteSheet(d.sheet.name)}!` : '') + absText(d.range, null).replace(/\$/g, '');
    this.host.edit('Edit sparkline data', (sh) => sh.setSparklines(sh.sparklines.map((g) => (g.id === h.group.id ? { ...g, items: g.items.map((x) => (x === it ? { ...x, data: text } : x)) } : g))));
  }
}
