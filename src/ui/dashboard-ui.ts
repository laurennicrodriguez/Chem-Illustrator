// The Dashboard tab and panel: adding tiles (each fed by a table or block of cells), their
// right-click menu, and the side panel where every setting of a tile can be changed by hand.

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import type { SheetCharts } from './sheet-chart-ui';
import { ask, Field } from './ask';
import { refText, CHART_NAMES, ChartKind } from '../sheet/chart';
import {
  Dashboard, Tile, TileKind, Source, Aggregate, KpiTile, TableTile, SlicerTile, GalleryTile, TextTile, ChartTile,
  AGGREGATE_NAMES, TILE_NAMES, resolveSource, sourceKey, sourceName, columnOf, newTileId, freeSpot, chartOfColumns,
} from '../sheet/dashboard';

export interface DashUiHost {
  readonly view: SheetView;
  readonly charts: SheetCharts;
  flash(msg: string, ms?: number): void;
}

type MenuItem = [string, () => void, boolean?] | null;
/** The kinds of chart a tile takes (the newer kinds need their own data: bin widths, sizes, raw repeat runs). */
export const DASH_CHART_KINDS: ChartKind[] = ['scatter', 'line', 'column', 'bar', 'area', 'pie'];
const KINDS = DASH_CHART_KINDS;
const AGGS = Object.keys(AGGREGATE_NAMES) as Aggregate[];
const num = (s: string): number | undefined => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);

/** Tiles' usual sizes, in grid squares. */
const SIZES: Record<TileKind, [number, number]> = { chart: [6, 5], kpi: [3, 2], table: [6, 5], slicer: [3, 4], gallery: [6, 5], text: [12, 1] };

export class DashboardUi {
  constructor(private host: DashUiHost) {}

  private get view(): SheetView { return this.host.view; }
  private get dash(): Dashboard | null { return this.view.sheet?.dashboard ?? null; }
  private get wb() { return this.view.wb!; }

  private set(d: Dashboard, label: string): void {
    const s = this.view.sheet!;
    this.wb.edit(label, () => s.setDashboard(d), this.view.place());
  }

  private update(id: number, patch: Partial<Tile>, label = 'Change tile'): void {
    this.view.dash.update(id, patch, label);
  }

  /** Every table in the workbook, and each sheet's block of data, as places tiles can read from. */
  sources(): { label: string; src: Source }[] {
    const out: { label: string; src: Source }[] = [];
    for (const s of this.wb.sheets) for (const t of s.tables) out.push({ label: `Table ${t.name} (${s.name})`, src: { table: t.name } });
    for (const s of this.wb.sheets) {
      if (s.dashboard || s.lastRow < 1 || s.lastCol < 0) continue;
      out.push({ label: `All of ${s.name} (A1 down to the last row)`, src: { range: refText(s.name, { r1: 0, c1: 0, r2: Math.max(s.lastRow, s.lastDataRow), c2: s.lastCol }) } });
    }
    return out;
  }

  /** Ask which table a new tile reads (skipped when there is only one). */
  private async pickSource(title: string): Promise<Source | null> {
    const list = this.sources();
    if (!list.length) { this.host.flash('There is no data to show yet: put a table on another sheet first (Format as Table makes one that grows).', 7000); return null; }
    if (list.length === 1) return list[0].src;
    const got = await ask(title, [
      { name: 'src', label: 'Data from', value: '0', options: [...list.map((x, i) => ({ value: String(i), label: x.label })), { value: 'cells', label: 'Other cells (type below)…' }] },
      { name: 'cells', label: 'Cells, with a header row', value: '', placeholder: 'Sheet1!A1:F30' },
    ], { ok: 'Next' });
    if (!got) return null;
    if (got.src === 'cells') {
      const t = got.cells.trim();
      if (!t) return null;
      const res = resolveSource(this.wb, { range: t.startsWith('=') ? t : '=' + t });
      if (!res) { this.host.flash(`${t} isn't a block of cells here (write it as Sheet1!A1:F30).`); return null; }
      return { range: refText(res.sheet.name, res.range) };
    }
    return list[Number(got.src)].src;
  }

  private place(kind: TileKind): Pick<Tile, 'x' | 'y' | 'w' | 'h'> {
    const [w, h] = SIZES[kind];
    const d = this.dash!;
    return { ...freeSpot(d, Math.min(w, d.cols), h), w: Math.min(w, d.cols), h };
  }

  private add(t: Tile): void {
    const d = this.dash!;
    this.set({ ...d, tiles: [...d.tiles, t] }, `Add ${TILE_NAMES[t.kind].toLowerCase()}`);
    this.view.dash.pick(t.id);
    this.view.focus();
  }

  /** Dashboard > a new tile of a kind, asking what it shows. */
  async addTile(kind: TileKind, chartKind: ChartKind = 'column'): Promise<void> {
    if (!this.dash) return;
    if (kind === 'text') {
      const got = await ask('Add Text', [
        { name: 'text', label: 'Text', value: '', type: 'textarea' },
        { name: 'size', label: 'Size', value: '20', type: 'number', unit: 'px' },
        { name: 'bold', label: 'Bold', value: 'true', type: 'checkbox' },
      ], { ok: 'Add' });
      if (!got || !got.text.trim()) return;
      this.add({ id: newTileId(), kind: 'text', ...this.place('text'), text: got.text, size: num(got.size) ?? 20, bold: got.bold === 'true' });
      return;
    }
    if (kind === 'chart') {
      // a chart already on a sheet can be copied in, or a new one made from a table's columns
      const existing = this.wb.sheets.flatMap((s) => s.charts.map((c) => ({ s, c })));
      if (existing.length) {
        const got = await ask('Add Chart', [{ name: 'from', label: 'Chart', value: 'new', options: [
          { value: 'new', label: 'A new chart of a table…' },
          ...existing.map((x, i) => ({ value: String(i), label: `Copy of ${x.c.title || CHART_NAMES[x.c.kind]} (${x.s.name})` })),
        ] }], { ok: 'Next' });
        if (!got) return;
        if (got.from !== 'new') {
          const { c } = existing[Number(got.from)];
          this.add({ id: newTileId(), kind: 'chart', ...this.place('chart'), chart: { ...c, id: newTileId() } });
          return;
        }
      }
    }
    const src = await this.pickSource(`Add ${TILE_NAMES[kind]}`);
    if (!src) return;
    const res = resolveSource(this.wb, src);
    if (!res) return;
    const cols = res.names.map((n) => ({ value: n, label: n }));
    const numeric = res.names.filter((_, i) => res.rows.some((r) => typeof res.sheet.value(r, res.range.c1 + i) === 'number'));
    const structCol = res.names.find((_, i) => res.rows.some((r) => !!res.sheet.cell(r, res.range.c1 + i)?.structure));
    const checks = (prefix: string, names: string[], on: (n: string) => boolean): Field[] => names.map((n) => ({ name: prefix + n, label: n, value: String(on(n)), type: 'checkbox' as const }));
    const picked = (got: Record<string, string>, prefix: string) => res.names.filter((n) => got[prefix + n] === 'true');
    const base = { id: newTileId(), ...this.place(kind) };
    switch (kind) {
      case 'chart': {
        const got = await ask('Add Chart: what it shows', [
          { name: 'kind', label: 'Kind', value: chartKind, options: KINDS.map((k) => ({ value: k, label: CHART_NAMES[k] })) },
          { name: 'x', label: 'Across the bottom (x or labels)', value: res.names[0], options: [{ value: '', label: '(1, 2, 3…)' }, ...cols] },
          { name: 'group', label: 'Rows with the same label', value: 'auto', options: [
            { value: 'auto', label: 'Average them if labels repeat' }, { value: '', label: 'One bar or point per row' },
            ...(['average', 'sum', 'count', 'median', 'min', 'max'] as Aggregate[]).map((a) => ({ value: a, label: `${AGGREGATE_NAMES[a]} of each label` })),
          ] },
          ...checks('y:', numeric, (n) => n === numeric.find((m) => m !== res.names[0])),
        ], { ok: 'Add', note: 'Tick the columns of numbers to chart. Scatter charts always show every row.' });
        if (!got) return;
        const ys = picked(got, 'y:');
        if (!ys.length) { this.host.flash('Tick at least one column of numbers.'); return; }
        const chart = chartOfColumns(res, got.kind as ChartKind, got.x || undefined, ys, newTileId());
        const xc = columnOf(res, got.x);
        const repeats = xc !== null && new Set(res.rows.map((r) => res.sheet.shownText(r, xc))).size < res.rows.length;
        const group = got.group === 'auto' ? (repeats && chart.kind !== 'scatter' ? 'average' : undefined) : (got.group as Aggregate) || undefined;
        if (group && chart.kind !== 'pie') chart.y = { ...chart.y, title: `${AGGREGATE_NAMES[group]}${group === 'count' ? '' : ` ${ys.length === 1 ? ys[0] : ''}`}`.trim() };
        this.add({ ...base, kind: 'chart', chart, ...(group ? { group } : {}) });
        return;
      }
      case 'kpi': {
        const got = await ask('Add Headline Number', [
          { name: 'agg', label: 'Show the', value: numeric.length ? 'average' : 'count', options: AGGS.map((a) => ({ value: a, label: AGGREGATE_NAMES[a] })) },
          { name: 'col', label: 'of', value: numeric[0] ?? res.names[0], options: cols },
          { name: 'fmt', label: 'Number format', value: '', placeholder: 'automatic (or 0.0, 0%…)' },
          { name: 'suffix', label: 'After the number', value: '', placeholder: ' %' },
          { name: 'target', label: 'Target (optional)', value: '', type: 'number' },
          { name: 'high', label: 'Higher is better', value: 'true', type: 'checkbox' },
        ], { ok: 'Add', note: 'The number follows the slicers. Its settings can also take any formula instead.' });
        if (!got) return;
        const t: KpiTile = { ...base, kind: 'kpi', source: src, column: got.col, agg: got.agg as Aggregate, title: `${AGGREGATE_NAMES[got.agg as Aggregate]}${got.agg === 'count' ? '' : ` ${got.col}`}` };
        if (got.fmt.trim()) t.numFmt = got.fmt.trim();
        if (got.suffix) t.suffix = got.suffix;
        if (num(got.target) !== undefined) { t.target = num(got.target); if (got.high !== 'true') t.higherIsBetter = false; }
        this.add(t);
        return;
      }
      case 'table': {
        const got = await ask('Add Table', checks('c:', res.names, () => true), { ok: 'Add', note: 'Tick the columns to show. Click a heading on the dashboard to sort by it.' });
        if (!got) return;
        const columns = picked(got, 'c:');
        this.add({ ...base, kind: 'table', source: src, ...(columns.length < res.names.length ? { columns } : {}), title: sourceName(src) });
        return;
      }
      case 'slicer': {
        const text = res.names.filter((n) => !numeric.includes(n) && n !== structCol);
        const got = await ask('Add Slicer', [{ name: 'col', label: 'Filter by', value: text[0] ?? res.names[0], options: cols }], { ok: 'Add', note: 'A button for each different value. Clicking buttons filters every tile fed by this table.' });
        if (!got) return;
        this.add({ ...base, kind: 'slicer', source: src, column: got.col });
        return;
      }
      case 'gallery': {
        if (!structCol) this.host.flash('No column of drawn structures found; pick the column that holds them.', 6000);
        const got = await ask('Add Structure Gallery', [
          { name: 'col', label: 'Structures in', value: structCol ?? res.names[0], options: cols },
          { name: 'size', label: 'Card width', value: '140', type: 'number', unit: 'px' },
          ...checks('l:', res.names.filter((n) => n !== structCol), (n) => n === res.names.find((m) => m !== structCol) || n === numeric[0]),
        ], { ok: 'Add', note: 'Tick what to write under each structure (an ID, a yield…).' });
        if (!got) return;
        this.add({ ...base, kind: 'gallery', source: src, structure: got.col, labels: picked(got, 'l:'), size: num(got.size) ?? 140, title: sourceName(src) });
        return;
      }
    }
  }

  clearFilters(): void {
    const d = this.dash;
    if (!d || !d.tiles.some((t) => t.kind === 'slicer' && t.selected?.length)) return;
    this.set({ ...d, tiles: d.tiles.map((t) => (t.kind === 'slicer' ? { ...t, selected: undefined } : t)) }, 'Clear filters');
  }

  /** Right-click on the dashboard: the tile's commands, or adding tiles. */
  contextMenu(x: number, y: number): void {
    const t = this.view.dash.pickedTile;
    const add: MenuItem[] = (Object.keys(TILE_NAMES) as TileKind[]).map((k) => [`Add ${TILE_NAMES[k]}…`, () => void this.addTile(k)] as MenuItem);
    if (!t) { popupMenu(x, y, [...add, null, ['Clear All Filters', () => this.clearFilters()], ['Dashboard Settings', () => this.focusPanel()]]); return; }
    const items: MenuItem[] = [];
    if (t.kind === 'chart') items.push(...this.chartItems(t), null);
    if (t.kind === 'slicer') items.push(['Clear This Slicer', () => this.update(t.id, { selected: undefined } as Partial<SlicerTile>, 'Clear slicer'), !!t.selected?.length], null);
    items.push(
      ['Settings…', () => this.focusPanel()],
      ['Duplicate', () => { const d = this.dash!; const copy = { ...structuredClone(t), id: newTileId(), ...freeSpot(d, t.w, t.h) } as Tile; this.add(copy); }],
      ['Delete Tile', () => this.view.dash.remove(t.id)],
      null,
      ...add,
    );
    popupMenu(x, y, items);
  }

  private chartItems(t: ChartTile): MenuItem[] {
    this.bindChart(t.id);
    return this.host.charts.menuItems().filter((m) => !m || !/^(Bring|Send|Delete Chart|All Settings)/.test(m[0]));
  }

  /** Let the chart tools (Chart tab, chart panel) change a chart tile. */
  bindChart(id: number | null): void {
    if (id === null) { this.host.charts.target = null; return; }
    this.host.charts.target = {
      get: () => (this.dash?.tiles.find((x) => x.id === id && x.kind === 'chart') as ChartTile | undefined)?.chart ?? null,
      set: (c, label) => this.update(id, { chart: c } as Partial<ChartTile>, label),
      remove: () => this.view.dash.remove(id),
    };
  }

  focusPanel(): void {
    document.querySelector<HTMLElement>('#cell-body input, #cell-body select, #cell-body textarea')?.focus();
  }

  // ---------------------------------------------------------------- the side panel

  panel(): HTMLElement[] {
    const d = this.dash!;
    const t = this.view.dash.pickedTile;
    const out: HTMLElement[] = [];
    const head = (s: string) => Object.assign(document.createElement('h4'), { textContent: s, className: 'cp-head' });
    const note = (s: string, cls = 'muted small') => Object.assign(document.createElement('p'), { textContent: s, className: cls });
    if (!t) {
      out.push(note('Click a tile to change it; drag tiles to move them and their corner to resize them. Slicer buttons filter every tile fed by the same table.'));
      out.push(head('Dashboard'));
      out.push(row('Columns', numberBox(d.cols, (v) => v && this.set({ ...d, cols: Math.max(2, Math.min(24, Math.round(v))), tiles: d.tiles.map((x) => ({ ...x, w: Math.min(x.w, Math.max(2, Math.round(v))), x: Math.min(x.x, Math.max(0, Math.round(v) - x.w)) })) }, 'Dashboard columns'))));
      out.push(row('Row height', numberBox(d.rowH, (v) => v && this.set({ ...d, rowH: Math.max(20, v) }, 'Dashboard row height'), '', 'px')));
      out.push(row('Gap', numberBox(d.gap, (v) => v !== undefined && this.set({ ...d, gap: Math.max(0, v) }, 'Dashboard gap'), '', 'px')));
      out.push(row('Background', colour(d.background ?? '#f3f4f6', (v) => this.set({ ...d, background: v }, 'Dashboard background')), d.background ? button('Default', () => this.set({ ...d, background: undefined }, 'Dashboard background')) : null));
      out.push(head('Add a tile'));
      const btns = document.createElement('div');
      btns.className = 'cp-buttons';
      for (const k of Object.keys(TILE_NAMES) as TileKind[]) btns.append(button(TILE_NAMES[k], () => void this.addTile(k)));
      out.push(btns);
      const filtered = d.tiles.filter((x): x is SlicerTile => x.kind === 'slicer' && !!x.selected?.length);
      if (filtered.length) {
        out.push(head('Filters on'));
        for (const s of filtered) out.push(note(`${s.column}: ${s.selected!.join(', ')}`, 'cp-value'));
        out.push(rowOf(button('Clear all filters', () => this.clearFilters())));
      }
      return out;
    }

    out.push(head(TILE_NAMES[t.kind]));
    out.push(row('Title', text(t.title ?? '', (v) => this.update(t.id, { title: v || undefined }, 'Tile title'), t.kind === 'chart' ? 'none (the chart has its own)' : 'automatic')));
    out.push(row('Place', numberBox(t.x + 1, (v) => v && this.update(t.id, { x: Math.max(0, Math.min(d.cols - t.w, Math.round(v) - 1)) }, 'Move tile'), '', 'across'), numberBox(t.y + 1, (v) => v && this.update(t.id, { y: Math.max(0, Math.round(v) - 1) }, 'Move tile'), '', 'down')));
    out.push(row('Size', numberBox(t.w, (v) => v && this.update(t.id, { w: Math.max(1, Math.min(d.cols - t.x, Math.round(v))) }, 'Resize tile'), '', 'wide'), numberBox(t.h, (v) => v && this.update(t.id, { h: Math.max(1, Math.round(v)) }, 'Resize tile'), '', 'high')));
    out.push(row('Fill', colour(t.fill ?? '#ffffff', (v) => this.update(t.id, { fill: v === '#ffffff' ? undefined : v }, 'Tile fill'))));

    const sourceRow = (src: Source | undefined, set: (s: Source) => void) => {
      const list = this.sources();
      const key = sourceKey(src);
      const options: [string, string][] = list.map((x) => [sourceKey(x.src), x.label]);
      if (src && !options.some(([k]) => k === key)) options.unshift([key, sourceName(src)]);
      return row('Data from', select(options, key, (k) => { const hit = list.find((x) => sourceKey(x.src) === k); if (hit) set(hit.src); }));
    };
    const res = 'source' in t ? resolveSource(this.wb, t.source) : null;
    const names: [string, string][] = (res?.names ?? []).map((n) => [n, n]);
    if ('source' in t && t.kind !== 'kpi' && !res) out.push(note(`The data (${sourceName(t.source)}) isn't in this workbook any more: pick it again.`, 'cp-error'));

    switch (t.kind) {
      case 'chart': {
        this.bindChart(t.id);
        // the tile sets the chart's size, background and border, so those rows go
        const tileSets = new Set(['Size', 'Background', 'Border']);
        if (t.chart.kind !== 'scatter') {
          out.push(row('Same labels', select([['', 'One bar or point per row'], ...(['average', 'sum', 'count', 'median', 'min', 'max'] as Aggregate[]).map((a): [string, string] => [a, `${AGGREGATE_NAMES[a]} of each`])], t.group ?? '', (v) => this.update(t.id, { group: (v as Aggregate) || undefined } as Partial<ChartTile>, 'Combine rows'))));
          if (t.group === 'average' || t.group === 'median') out.push(note('Turn on error bars to show the standard deviation of each label.'));
        }
        out.push(...this.host.charts.panel(t.chart).slice(1).filter((el) => !tileSets.has(el.querySelector(':scope > span')?.textContent ?? '')));
        break;
      }
      case 'kpi': {
        out.push(sourceRow(t.source, (s) => this.update(t.id, { source: s } as Partial<KpiTile>)));
        out.push(row('Show the', select(AGGS.map((a) => [a, AGGREGATE_NAMES[a]]), t.agg, (v) => this.update(t.id, { agg: v as Aggregate } as Partial<KpiTile>))));
        out.push(row('Of', select(names, t.column ?? '', (v) => this.update(t.id, { column: v } as Partial<KpiTile>))));
        out.push(row('Or a formula', text(t.formula ?? '', (v) => this.update(t.id, { formula: v ? (v.startsWith('=') ? v : '=' + v) : undefined } as Partial<KpiTile>, 'Tile formula'), '=AVERAGE(Sheet1!C2:C30)', true)));
        out.push(row('Number format', text(t.numFmt ?? '', (v) => this.update(t.id, { numFmt: v || undefined } as Partial<KpiTile>), 'automatic')));
        out.push(row('After it', text(t.suffix ?? '', (v) => this.update(t.id, { suffix: v || undefined } as Partial<KpiTile>), ' %')));
        out.push(row('Target', numberBox(t.target, (v) => this.update(t.id, { target: v } as Partial<KpiTile>), 'none'), check(t.higherIsBetter !== false, (v) => this.update(t.id, { higherIsBetter: v ? undefined : false } as Partial<KpiTile>), 'Higher is better')));
        break;
      }
      case 'table': {
        out.push(sourceRow(t.source, (s) => this.update(t.id, { source: s, columns: undefined, sortBy: undefined } as Partial<TableTile>)));
        const shown = new Set(t.columns ?? res?.names ?? []);
        for (const [n] of names) out.push(row('', check(shown.has(n), (v) => {
          const next = (res?.names ?? []).filter((m) => (m === n ? v : shown.has(m)));
          this.update(t.id, { columns: next.length === res?.names.length ? undefined : next } as Partial<TableTile>, 'Table columns');
        }, n)));
        out.push(row('Sort by', select([['', '(sheet order)'], ...names], t.sortBy ?? '', (v) => this.update(t.id, { sortBy: v || undefined } as Partial<TableTile>)), check(!!t.descending, (v) => this.update(t.id, { descending: v || undefined } as Partial<TableTile>), 'Largest first')));
        out.push(row('Most rows', numberBox(t.maxRows, (v) => this.update(t.id, { maxRows: v } as Partial<TableTile>), '200')));
        break;
      }
      case 'slicer': {
        out.push(sourceRow(t.source, (s) => this.update(t.id, { source: s, selected: undefined } as Partial<SlicerTile>)));
        out.push(row('Filter by', select(names, t.column, (v) => this.update(t.id, { column: v, selected: undefined } as Partial<SlicerTile>))));
        out.push(note(t.selected?.length ? `Showing only: ${t.selected.join(', ')}` : 'Showing everything. Click buttons on the tile to filter (click again to take one off).'));
        if (t.selected?.length) out.push(rowOf(button('Clear this slicer', () => this.update(t.id, { selected: undefined } as Partial<SlicerTile>, 'Clear slicer'))));
        break;
      }
      case 'gallery': {
        out.push(sourceRow(t.source, (s) => this.update(t.id, { source: s } as Partial<GalleryTile>)));
        out.push(row('Structures in', select(names, t.structure, (v) => this.update(t.id, { structure: v } as Partial<GalleryTile>))));
        out.push(row('Card width', numberBox(t.size, (v) => this.update(t.id, { size: v } as Partial<GalleryTile>), '120', 'px')));
        const labels = new Set(t.labels ?? []);
        out.push(note('Written under each structure:'));
        for (const [n] of names) if (n !== t.structure) out.push(row('', check(labels.has(n), (v) => this.update(t.id, { labels: (res?.names ?? []).filter((m) => (m === n ? v : labels.has(m))) } as Partial<GalleryTile>, 'Gallery labels'), n)));
        break;
      }
      case 'text': {
        const ta = document.createElement('textarea');
        ta.value = t.text;
        ta.rows = 3;
        ta.className = 'cp-textarea';
        ta.addEventListener('keydown', (e) => e.stopPropagation());
        ta.addEventListener('change', () => this.update(t.id, { text: ta.value } as Partial<TextTile>, 'Tile text'));
        out.push(ta);
        out.push(row('Size', numberBox(t.size, (v) => this.update(t.id, { size: v } as Partial<TextTile>), '16', 'px'), check(!!t.bold, (v) => this.update(t.id, { bold: v || undefined } as Partial<TextTile>), 'Bold')));
        out.push(row('Align', select([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], t.align ?? 'left', (v) => this.update(t.id, { align: v as TextTile['align'] } as Partial<TextTile>))));
        out.push(row('Colour', colour(t.color ?? '#1f2937', (v) => this.update(t.id, { color: v } as Partial<TextTile>))));
        break;
      }
    }
    out.push(rowOf(button('Delete tile', () => this.view.dash.remove(t.id))));
    return out;
  }
}

// ---------------------------------------------------------------- panel controls (as the chart panel's)

function row(label: string, ...controls: (HTMLElement | null)[]): HTMLElement {
  const r = document.createElement('div');
  r.className = 'cp-row cp-chart-row';
  r.append(Object.assign(document.createElement('span'), { textContent: label }), ...controls.filter((x): x is HTMLElement => !!x));
  return r;
}

function rowOf(...bs: HTMLElement[]): HTMLElement {
  const d = document.createElement('div');
  d.className = 'cp-buttons';
  d.append(...bs);
  return d;
}

function button(label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

const stop = (el: HTMLElement) => el.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && el instanceof HTMLInputElement) el.blur();
});

function text(value: string, set: (v: string) => void, placeholder = '', wide = false): HTMLInputElement {
  const i = document.createElement('input');
  i.value = value;
  i.placeholder = placeholder;
  i.spellcheck = false;
  if (wide) i.className = 'cp-ref';
  stop(i);
  i.addEventListener('change', () => set(i.value.trim()));
  return i;
}

function numberBox(value: number | undefined, set: (v: number | undefined) => void, placeholder = '', unit = ''): HTMLElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = 'any';
  i.value = value === undefined ? '' : String(value);
  i.placeholder = placeholder;
  stop(i);
  i.addEventListener('change', () => set(num(i.value)));
  if (!unit) return i;
  const w = document.createElement('label');
  w.className = 'cp-unit';
  w.append(i, document.createTextNode(` ${unit}`));
  return w;
}

function select(options: [string, string][], value: string, set: (v: string) => void): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [v, l] of options) s.add(new Option(l, v, false, v === value));
  s.value = value;
  stop(s);
  s.addEventListener('change', () => set(s.value));
  return s;
}

function check(on: boolean, set: (v: boolean) => void, label = ''): HTMLElement {
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = on;
  i.addEventListener('change', () => set(i.checked));
  if (!label) return i;
  const l = document.createElement('label');
  l.className = 'cp-check';
  l.append(i, document.createTextNode(` ${label}`));
  return l;
}

function colour(value: string, set: (v: string) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'color';
  i.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  i.addEventListener('change', () => set(i.value));
  return i;
}

