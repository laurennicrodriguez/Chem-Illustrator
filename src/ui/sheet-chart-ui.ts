// Sheet mode's charts: making one from the selected cells (Insert tab), the Chart tab's menus,
// and the panel on the right where every setting can be changed by hand, down to each series'
// cell references, axis limits and fitted-line options.

import { askAltText } from './accessibility-pane';
import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import { ask, Field } from './ask';
import type { Sheet } from '../sheet/workbook';
import { Range, colName, parseCellRef } from '../sheet/refs';
import {
  Chart, ChartKind, ChartAxis, Series, SeriesFit, ErrorBars, MarkerShape, CHART_NAMES, CHART_PALETTES, MARKERS,
  chartFromRange, chartData, readRef, refText, isXY, isLevelled, comboAs, onSecondAxis, Bins, BoxOptions,
} from '../sheet/chart';
import { FIT_NAMES, FitKind, fitEquation, r2Text, fitNumber } from '../sheet/fit';
import { histogram } from '../sheet/chart-stats';
import { chartCanvas, chartItems, chartFits } from '../render/chart-draw';
import { itemsToSvg } from '../render/svg';
import { copyPictureItems } from '../io/clipboard';
import { saveFileDialog, writeFile, PICTURE, SVG } from '../io/files';
import { canvasPng } from '../render/picture';

export interface ChartHost {
  readonly view: SheetView;
  /** One undoable change to the sheet showing. */
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
}

type MenuItem = [string, () => void, boolean?] | null;

const KINDS = Object.keys(CHART_NAMES) as ChartKind[];
/** Charts that take fitted lines and error bars. */
const FITTED = new Set<ChartKind>(['scatter', 'line', 'column', 'bar', 'area', 'bubble']);
const FITS = Object.keys(FIT_NAMES) as FitKind[];

/** The block of filled cells around a cell (Excel's current region), for charting one cell's table. */
export function currentRegion(s: Sheet, r: number, c: number): Range {
  const filled = (row: number, col: number) => row >= 0 && col >= 0 && s.value(row, col) !== null && s.value(row, col) !== '';
  const R = { r1: r, c1: c, r2: r, c2: c };
  for (let grew = true, guard = 0; grew && guard < 10000; guard++) {
    grew = false;
    const rowHas = (row: number) => { for (let col = R.c1 - 1; col <= R.c2 + 1; col++) if (filled(row, col)) return true; return false; };
    const colHas = (col: number) => { for (let row = R.r1 - 1; row <= R.r2 + 1; row++) if (filled(row, col)) return true; return false; };
    if (R.r1 > 0 && rowHas(R.r1 - 1)) { R.r1--; grew = true; }
    if (rowHas(R.r2 + 1)) { R.r2++; grew = true; }
    if (R.c1 > 0 && colHas(R.c1 - 1)) { R.c1--; grew = true; }
    if (colHas(R.c2 + 1)) { R.c2++; grew = true; }
  }
  return R;
}

const num = (s: string): number | undefined => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);

export class SheetCharts {
  constructor(private host: ChartHost) {}

  private get view(): SheetView { return this.host.view; }
  private get sheet(): Sheet { return this.view.sheet!; }
  /** A chart kept somewhere other than on a sheet (a dashboard tile), while it is the one being changed. */
  target: { get(): Chart | null; set(c: Chart, label: string): void; remove(): void } | null = null;
  /** The chart keeps its own data (a chart in a document or on a slide): no sheet-only settings. */
  ownData = false;

  get chart(): Chart | null { return this.target ? this.target.get() : this.view.selectedChart; }

  private change(c: Chart, label = 'Change chart'): void {
    if (this.target) this.target.set(c, label);
    else this.view.replaceChart(c, label);
  }

  deleteChart(): void {
    if (this.target) this.target.remove();
    else this.view.deleteChart();
  }

  /** Change the picked chart. */
  private patch(fn: (c: Chart) => Chart, label?: string): void {
    const c = this.chart;
    if (c) this.change(fn(c), label);
  }

  private patchSeries(i: number, p: Partial<Series>, label?: string): void {
    this.patch((c) => ({ ...c, series: c.series.map((s, j) => (j === i ? clean({ ...s, ...p }) : s)) }), label);
  }

  // ---------------------------------------------------------------- making a chart

  /** Insert > a chart of the selected cells (the table around the cell when one is selected). */
  insert(kind: ChartKind): void {
    const v = this.view;
    const s = this.sheet;
    let R = v.sel.range;
    if (R.r1 === R.r2 && R.c1 === R.c2) {
      const t = s.tableAt(R.r1, R.c1);
      R = t ? t.range : currentRegion(s, R.r1, R.c1);
    } else R = s.clip(R) ?? R;
    if (s.value(R.r1, R.c1) === null && R.r1 === R.r2 && R.c1 === R.c2) {
      this.host.flash('Select the numbers to chart first (with their header row, and for a scatter chart the x column first).', 6000);
      return;
    }
    const chart = v.clearOfCharts(chartFromRange(s, R, kind));
    this.host.edit(`Insert ${CHART_NAMES[kind].toLowerCase()} chart`, (sh) => sh.setCharts([...sh.charts, chart]));
    v.pickChart(chart.id);
    v.focus();
    if (kind === 'scatter') this.host.flash('Chart tab > Fit Line adds a straight line (or curve) with its equation and R². Drag the chart to move it; the corners resize it.', 7000);
    else if (HINTS[kind]) this.host.flash(HINTS[kind]!, 7000);
  }

  // ---------------------------------------------------------------- the Chart tab

  typeMenu(x: number, y: number): void {
    const c = this.chart;
    if (!c) return;
    popupMenu(x, y, [
      ...KINDS.map((k) => [`${c.kind === k ? '✓ ' : ''}${CHART_NAMES[k]}`, () => this.setKind(k)] as MenuItem),
      null,
      [`${c.stacked ? '✓ ' : ''}Stacked (columns, bars, areas)`, () => this.patch((x2) => ({ ...x2, stacked: !x2.stacked || undefined }), 'Stacked'), c.kind === 'column' || c.kind === 'bar' || c.kind === 'area'],
    ]);
  }

  setKind(k: ChartKind): void {
    this.patch((c) => {
      const out: Chart = { ...c, kind: k };
      if (k === 'pie' && c.legend === 'none') out.legend = 'right';
      if (k !== 'pie' && c.kind === 'pie' && c.series.length === 1) out.legend = 'none';
      out.y = { ...c.y, grid: k === 'pie' ? false : c.y.grid ?? true };
      return out;
    }, 'Chart type');
  }

  fitMenu(x: number, y: number): void {
    const c = this.chart;
    if (!c) return;
    const all = (fn: (s: Series) => Series) => this.patch((x2) => ({ ...x2, series: x2.series.map((s) => clean(fn(s))) }), 'Fitted line');
    const first = c.series[0]?.fit;
    popupMenu(x, y, [
      [`${!c.series.some((s) => s.fit) ? '✓ ' : ''}None`, () => all((s) => ({ ...s, fit: undefined }))],
      ...FITS.map((k) => [`${first?.kind === k ? '✓ ' : ''}${FIT_NAMES[k]}`, () => all((s) => ({ ...s, fit: { showEq: true, showR2: true, ...s.fit, kind: k } }))] as MenuItem),
      null,
      [`${first?.showEq ? '✓ ' : ''}Show Equation`, () => all((s) => (s.fit ? { ...s, fit: { ...s.fit, showEq: !s.fit.showEq } } : s)), !!first],
      [`${first?.showR2 ? '✓ ' : ''}Show R²`, () => all((s) => (s.fit ? { ...s, fit: { ...s.fit, showR2: !s.fit.showR2 } } : s)), !!first],
      ['Through the Origin', () => all((s) => (s.fit ? { ...s, fit: { ...s.fit, intercept: s.fit.intercept === 0 ? undefined : 0 } } : s)), !!first && (first.kind === 'linear' || first.kind.startsWith('poly'))],
      null,
      ['More Options (each series)…', () => this.focusPanel()],
    ]);
  }

  legendMenu(x: number, y: number): void {
    const c = this.chart;
    if (!c) return;
    const opts: [Chart['legend'], string][] = [['right', 'Right'], ['bottom', 'Bottom'], ['top', 'Top'], ['none', 'None']];
    popupMenu(x, y, opts.map(([v, l]) => [`${c.legend === v ? '✓ ' : ''}${l}`, () => this.patch((x2) => ({ ...x2, legend: v }), 'Legend')] as MenuItem));
  }

  paletteMenu(x: number, y: number): void {
    const c = this.chart;
    if (!c) return;
    popupMenu(x, y, [
      ...Object.entries(CHART_PALETTES).map(([k, p]) => [`${(c.palette ?? 'office') === k ? '✓ ' : ''}${p.name}`, () => this.patch((x2) => ({ ...x2, palette: k === 'office' ? undefined : k, series: x2.series.map((s) => ({ ...s, color: undefined })) }), 'Chart colours')] as MenuItem),
      null,
      ['Each Series Its Own Colour…', () => this.focusPanel()],
    ]);
  }

  errorsMenu(x: number, y: number): void {
    const c = this.chart;
    if (!c) return;
    const all = (e: ErrorBars | undefined) => this.patch((x2) => ({ ...x2, series: x2.series.map((s) => clean({ ...s, errors: e })) }), 'Error bars');
    const now = c.series[0]?.errors;
    popupMenu(x, y, [
      [`${!now ? '✓ ' : ''}None`, () => all(undefined)],
      [`${now?.kind === 'stdev' ? '✓ ' : ''}Standard Deviation`, () => all({ kind: 'stdev', value: 1 })],
      [`${now?.kind === 'percent' ? '✓ ' : ''}5%`, () => all({ kind: 'percent', value: 5 })],
      [`${now?.kind === 'fixed' ? '✓ ' : ''}Fixed Amount…`, () => void this.fixedErrors()],
      [`${now?.kind === 'cells' ? '✓ ' : ''}From Cells (your own ±)…`, () => void this.cellErrors()],
    ]);
  }

  private async fixedErrors(): Promise<void> {
    const got = await ask('Error Bars', [{ name: 'v', label: 'Plus and minus', value: String(this.chart?.series[0]?.errors?.value ?? 1), type: 'number' }], { ok: 'Apply' });
    const v = got ? num(got.v) : undefined;
    if (v !== undefined) this.patch((c) => ({ ...c, series: c.series.map((s) => ({ ...s, errors: { kind: 'fixed', value: v } })) }), 'Error bars');
  }

  private async cellErrors(): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const fields: Field[] = c.series.flatMap((s, i) => [
      { name: `p${i}`, label: `${seriesLabel(c, i)}: plus`, value: s.errors?.kind === 'cells' ? s.errors.plus ?? '' : '', placeholder: '=Sheet1!$D$2:$D$9' },
      { name: `m${i}`, label: `${seriesLabel(c, i)}: minus (blank: same)`, value: s.errors?.kind === 'cells' ? s.errors.minus ?? '' : '' },
    ]);
    const got = await ask('Error Bars from Cells', fields, { ok: 'Apply', note: 'One amount per point, such as a column of standard deviations from repeat runs. Type a range like D2:D9.' });
    if (!got) return;
    this.patch((x) => ({
      ...x,
      series: x.series.map((s, i) => {
        const p = this.asRef(got[`p${i}`]);
        if (!p) return { ...s, errors: undefined };
        return { ...s, errors: { kind: 'cells', plus: p, ...(this.asRef(got[`m${i}`]) ? { minus: this.asRef(got[`m${i}`]) } : {}) } };
      }),
    }), 'Error bars');
  }

  /** "D2:D9" or "=Sheet2!D2:D9" as a full reference on this sheet ("=Sheet1!$D$2:$D$9"); '' stays unset. */
  asRef(text: string | undefined): string | undefined {
    const t = text?.trim();
    if (!t) return undefined;
    const got = readRef(this.view.wb!, t, this.sheet);
    return got ? refText(got.sheet.name, got.range) : t.startsWith('=') ? t : '=' + t;
  }

  async titles(): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const got = await ask('Chart Titles', [
      { name: 'title', label: 'Chart title', value: c.title ?? '' },
      { name: 'x', label: c.kind === 'bar' ? 'Value axis (across)' : 'Horizontal axis', value: c.x.title ?? '' },
      { name: 'y', label: c.kind === 'bar' ? 'Category axis (down)' : 'Vertical axis', value: c.y.title ?? '' },
      ...(c.kind === 'combo' ? [{ name: 'y2', label: 'Second vertical axis (right)', value: c.y2?.title ?? '' }] : []),
    ], { ok: 'Apply', note: 'k_{obs} writes a subscript and s^{-1} a superscript; one character needs no braces (H_2O). Leave a box empty for no title.' });
    if (!got) return;
    this.patch((x) => clean({
      ...x, title: got.title.trim() || undefined, x: clean({ ...x.x, title: got.x.trim() || undefined }), y: clean({ ...x.y, title: got.y.trim() || undefined }),
      ...(got.y2 !== undefined ? { y2: clean({ ...x.y2, title: got.y2.trim() || undefined }) } : {}),
    }), 'Chart titles');
  }

  async axes(): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const f = (p: 'x' | 'y' | 'y2', label: string): Field[] => [
      { name: `${p}min`, label: `${label}: minimum`, value: c[p]?.min?.toString() ?? '', placeholder: 'auto' },
      { name: `${p}max`, label: `${label}: maximum`, value: c[p]?.max?.toString() ?? '', placeholder: 'auto' },
      { name: `${p}step`, label: `${label}: gap between labels`, value: c[p]?.step?.toString() ?? '', placeholder: 'auto' },
      { name: `${p}fmt`, label: `${label}: number format`, value: c[p]?.numFmt ?? '', placeholder: 'General (or 0.00, 0.0E+00…)' },
      { name: `${p}log`, label: `${label}: log scale`, value: String(!!c[p]?.log), type: 'checkbox' },
      { name: `${p}grid`, label: `${label}: grid lines`, value: String(p === 'y' ? c.y.grid !== false : !!c[p]?.grid), type: 'checkbox' },
      { name: `${p}rev`, label: `${label}: values in reverse order`, value: String(!!c[p]?.reverse), type: 'checkbox' },
    ];
    const numeric = isXY(c.kind);
    const second = c.kind === 'combo' && c.series.some((s, i) => onSecondAxis(s, i));
    const got = await ask('Axes', [...(numeric || c.kind === 'bar' ? f('x', 'Horizontal') : []), ...(c.kind !== 'bar' ? f('y', 'Vertical') : []), ...(second ? f('y2', 'Second vertical (right)') : [])], { ok: 'Apply', note: 'Leave a box empty for the automatic value.' });
    if (!got) return;
    const read = (p: 'x' | 'y' | 'y2', a: ChartAxis): ChartAxis => (got[`${p}min`] === undefined ? a : clean({
      ...a, min: num(got[`${p}min`]), max: num(got[`${p}max`]), step: num(got[`${p}step`]), numFmt: got[`${p}fmt`].trim() || undefined,
      log: got[`${p}log`] === 'true' || undefined, grid: got[`${p}grid`] === 'true', reverse: got[`${p}rev`] === 'true' || undefined,
    }));
    this.patch((x) => clean({ ...x, x: read('x', x.x), y: read('y', x.y), ...(second ? { y2: read('y2', x.y2 ?? {}) } : {}) }), 'Axes');
  }

  async addSeries(): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const last = c.series[c.series.length - 1];
    const got = await ask('Add Series', [
      { name: 'name', label: 'Name (or a cell)', value: '' },
      { name: 'y', label: 'Values', value: '', placeholder: 'C2:C10' },
      { name: 'x', label: isXY(c.kind) ? 'X values' : 'Category labels', value: last?.x ?? '', placeholder: 'A2:A10' },
      ...(c.kind === 'bubble' ? [{ name: 'size', label: 'Bubble sizes', value: '', placeholder: 'D2:D10' }] : []),
    ], { ok: 'Add', note: 'Type ranges such as C2:C10, or Sheet2!C2:C10 for another sheet.' });
    if (!got || !got.y.trim()) return;
    const y = this.asRef(got.y)!;
    const s: Series = clean({ y, x: this.asRef(got.x), size: this.asRef(got.size), name: /^=|^[A-Z]+\d+$/i.test(got.name.trim()) && parseCellRef(got.name.trim().replace(/^=/, '')) ? this.asRef(got.name) : got.name.trim() || undefined });
    this.patch((x) => ({ ...x, series: [...x.series, s], legend: x.legend === 'none' ? 'right' : x.legend }), 'Add series');
  }

  toggleLabels(): void {
    const c = this.chart;
    if (!c) return;
    const on = !c.series.every((s) => s.labels);
    this.patch((x) => ({ ...x, series: x.series.map((s) => clean({ ...s, labels: on || undefined })) }), 'Data labels');
  }

  /** The chart as shapes in points, and a bitmap of it. */
  private pictureOf(c: Chart, dpi = 300): { items: ReturnType<typeof chartItems>; canvas: HTMLCanvasElement } {
    const data = chartData(this.view.wb!, this.sheet, c);
    return { items: chartItems(c, data), canvas: chartCanvas(c, data, dpi / 96) };
  }

  async copyPicture(): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const p = this.pictureOf(c);
    this.host.flash(await copyPictureItems(p.items, { x1: 0, y1: 0, x2: c.w * 0.75, y2: c.h * 0.75 }, p.canvas, 300));
  }

  async savePicture(): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const got = await ask('Save Chart as Picture', [
      { name: 'format', label: 'Format', value: 'png', options: [
        { value: 'png', label: 'PNG (Word, journals, web)' },
        { value: 'svg', label: 'SVG (stays sharp: Illustrator, Inkscape)' },
      ] },
      { name: 'dpi', label: 'Resolution (PNG)', value: '300', type: 'number', unit: 'dpi' },
    ], { ok: 'Save…', note: `The chart is ${(c.w / 96).toFixed(2)} × ${(c.h / 96).toFixed(2)} inches; resize it on the sheet to change that.` });
    if (!got) return;
    const svg = got.format === 'svg';
    const type = svg ? SVG : PICTURE;
    const name = `${(c.title || 'Chart').replace(/[\\/:*?"<>|_^{}]+/g, ' ').trim() || 'Chart'}.${type.extension}`;
    const where = await saveFileDialog(name, type);
    if (!where) return;
    const p = this.pictureOf(c, Math.max(72, Math.min(1200, Number(got.dpi) || 300)));
    const data = svg ? itemsToSvg(p.items, { x1: 0, y1: 0, x2: c.w * 0.75, y2: c.h * 0.75 }) : new Uint8Array(await (await canvasPng(p.canvas)).arrayBuffer());
    await writeFile(where.ref, where.name, data, type);
    this.host.flash(`Saved ${where.name}.`);
  }

  /** Put SLOPE, INTERCEPT and RSQ formulas for a series' straight line into cells, so they follow the data. */
  async fitToCells(i: number): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const s = c.series[i];
    const yr = readRef(this.view.wb!, s.y, this.sheet);
    const xr = s.x ? readRef(this.view.wb!, s.x, this.sheet) : null;
    if (!yr) return;
    const at = { r: yr.range.r2 + 2, c: xr && xr.sheet === yr.sheet ? xr.range.c1 : yr.range.c1 };
    const got = await ask('Fitted Line in Cells', [{ name: 'at', label: 'Put it from cell', value: `${colName(at.c)}${at.r + 1}` }], {
      ok: 'Put in cells',
      note: 'Writes Slope, Intercept and R² with formulas (SLOPE, INTERCEPT, RSQ) that follow the data, plus their standard errors (LINEST) as Excel does.',
    });
    const ref = got ? parseCellRef(got.at.trim()) : null;
    if (!ref) return;
    const plain = (t: string | undefined) => (t ?? '').replace(/^=/, '');
    const yref = plain(s.y), xs = plain(s.x);
    if (!xs) return;
    const rows: [string, string][] = [
      ['Slope', `=SLOPE(${yref},${xs})`],
      ['Intercept', `=INTERCEPT(${yref},${xs})`],
      ['R²', `=RSQ(${yref},${xs})`],
      ['Standard error of y', `=STEYX(${yref},${xs})`],
    ];
    this.host.edit('Fitted line in cells', (sh) => rows.forEach(([label, f], k) => { sh.setInput(ref.row + k, ref.col, label); sh.setInput(ref.row + k, ref.col + 1, f); }));
    this.view.pickChart(null);
    this.view.select({ r1: ref.row, c1: ref.col, r2: ref.row + rows.length - 1, c2: ref.col + 1 });
  }

  /** Delete, and the right-click menu's chart items. */
  menuItems(): MenuItem[] {
    const c = this.chart;
    if (!c) return [];
    return [
      ['Change Chart Type ▸', () => this.typeMenu(lastX, lastY)],
      ['Fit Line ▸', () => this.fitMenu(lastX, lastY), FITTED.has(c.kind)],
      ['Titles…', () => void this.titles()],
      ['Axes…', () => void this.axes(), c.kind !== 'pie'],
      ['Legend ▸', () => this.legendMenu(lastX, lastY)],
      ['Colours ▸', () => this.paletteMenu(lastX, lastY)],
      ['Error Bars ▸', () => this.errorsMenu(lastX, lastY), FITTED.has(c.kind)],
      ['Add Series…', () => void this.addSeries()],
      [`${c.series.every((s) => s.labels) ? '✓ ' : ''}Data Labels`, () => this.toggleLabels()],
      null,
      ['Copy as Picture', () => void this.copyPicture()],
      ['Save as Picture…', () => void this.savePicture()],
      null,
      ['Bring to Front', () => this.restack(1), !this.target && this.sheet.charts.length > 1],
      ['Send to Back', () => this.restack(-1), !this.target && this.sheet.charts.length > 1],
      ['All Settings…', () => this.focusPanel()],
      // a chart on a slide or in a document has its alt text on its picture
      ...(this.target ? [] : [['Alt Text…', () => void this.altText()] as MenuItem]),
      ['Delete Chart', () => this.deleteChart()],
    ];
  }

  /** Alt Text… for the chart picked on the sheet. */
  async altText(): Promise<void> {
    const c = this.chart;
    if (!c) return;
    const got = await askAltText(c.title?.trim() ? `"${c.title.trim()}"` : 'chart', c.alt);
    const cur = this.chart;
    if (got === null || !cur || cur.id !== c.id) return;
    this.change({ ...cur, alt: got || undefined }, 'Alt text');
  }

  contextMenu(x: number, y: number): void {
    lastX = x; lastY = y;
    popupMenu(x, y, this.menuItems());
  }

  private restack(dir: 1 | -1): void {
    const c = this.chart;
    if (!c) return;
    this.host.edit(dir > 0 ? 'Bring to front' : 'Send to back', (s) => {
      const rest = s.charts.filter((x) => x.id !== c.id);
      s.setCharts(dir > 0 ? [...rest, c] : [c, ...rest]);
    });
  }

  focusPanel(): void {
    document.querySelector<HTMLElement>('#cell-body input, #cell-body select')?.focus();
  }

  // ---------------------------------------------------------------- the side panel

  /** Every setting of the picked chart, each changeable by hand. */
  panel(c: Chart): HTMLElement[] {
    const out: HTMLElement[] = [];
    const head = (t: string) => Object.assign(document.createElement('h4'), { textContent: t, className: 'cp-head' });
    const note = (t: string, cls = 'muted small') => Object.assign(document.createElement('p'), { textContent: t, className: cls });
    out.push(note(this.ownData ? 'Everything here can be changed; a blank box means automatic. Series take ranges of the data, such as B2:B5.' : 'Drag the chart to move it and its corners to resize it. Everything here can be changed; a blank box means automatic.'));

    out.push(head('Chart'));
    out.push(row('Type', select(KINDS.map((k) => [k, CHART_NAMES[k]]), c.kind, (v) => this.setKind(v as ChartKind))));
    out.push(row('Title', text(c.title ?? '', (v) => this.patch((x) => clean({ ...x, title: v || undefined }), 'Chart title'), 'none')));
    out.push(row('Legend', select([['right', 'Right'], ['bottom', 'Bottom'], ['top', 'Top'], ['none', 'None']], c.legend, (v) => this.patch((x) => ({ ...x, legend: v as Chart['legend'] }), 'Legend'))));
    out.push(row('Colours', select(Object.entries(CHART_PALETTES).map(([k, p]) => [k, p.name]), c.palette ?? 'office', (v) => this.patch((x) => clean({ ...x, palette: v === 'office' ? undefined : v }), 'Chart colours'))));
    if (c.kind === 'column' || c.kind === 'bar' || c.kind === 'area') out.push(row('Stacked', check(!!c.stacked, (v) => this.patch((x) => clean({ ...x, stacked: v || undefined }), 'Stacked'))));
    if (c.kind === 'radar') out.push(row('Filled', check(!!c.filled, (v) => this.patch((x) => clean({ ...x, filled: v || undefined }), 'Filled radar'), 'Shapes filled in')));
    if (c.kind === 'histogram') {
      const b = c.bins ?? {};
      const setB = (q: Partial<Bins>) => this.patch((x) => { const bins = clean({ ...x.bins, ...q }); return clean({ ...x, bins: Object.keys(bins).length ? bins : undefined }); }, 'Bins');
      out.push(row('Bin width', numberBox(b.width, (v) => setB({ width: v && v > 0 ? v : undefined }), 'auto')));
      out.push(row('Or bins', numberBox(b.count, (v) => setB({ count: v && v >= 1 ? Math.round(v) : undefined }), 'auto', 'of them')));
      out.push(row('Overflow', numberBox(b.overflow, (v) => setB({ overflow: v }), 'none', 'and above in one bin')));
      out.push(row('Underflow', numberBox(b.underflow, (v) => setB({ underflow: v }), 'none', 'and below in one bin')));
      const h = histogram(chartData(this.view.wb!, this.sheet, c)[0]?.ys ?? [], b);
      if (h.width) out.push(note(`Bins ${Number(h.width.toPrecision(4))} wide${b.width || b.count ? '' : ' (chosen by Scott\'s rule, as Excel does)'}; each holds the numbers above its start, up to and including its end.`));
    }
    if (c.kind === 'box') {
      const o = c.boxes ?? {};
      const setO = (q: Partial<BoxOptions>) => this.patch((x) => { const boxes = clean({ ...x.boxes, ...q }); return clean({ ...x, boxes: Object.keys(boxes).length ? boxes : undefined }); }, 'Box options');
      out.push(row('Mean', check(o.mean !== false, (v) => setO({ mean: v ? undefined : false }), 'Cross'), check(!!o.meanLine, (v) => setO({ meanLine: v || undefined }), 'Line joining them')));
      out.push(row('Points', check(o.outliers !== false, (v) => setO({ outliers: v ? undefined : false }), 'Outliers'), check(!!o.points, (v) => setO({ points: v || undefined }), 'All the others')));
      out.push(row('Quartiles', select([['exclusive', 'Exclusive median (Excel\'s default)'], ['inclusive', 'Inclusive median']], o.quartiles ?? 'exclusive', (v) => setO({ quartiles: v === 'inclusive' ? 'inclusive' : undefined }))));
    }
    out.push(row('Font', text(c.font ?? '', (v) => this.patch((x) => clean({ ...x, font: v || undefined }), 'Chart font'), 'Arial')));
    out.push(row('Font size', numberBox(c.fontSize, (v) => this.patch((x) => clean({ ...x, fontSize: v }), 'Chart font size'), '12', 'px')));
    if (!this.ownData) out.push(row('Size', numberBox(c.w, (v) => v && this.patch((x) => ({ ...x, w: Math.max(80, v) }), 'Resize chart'), '', '×'), numberBox(c.h, (v) => v && this.patch((x) => ({ ...x, h: Math.max(80, v) }), 'Resize chart'), '', 'px')));
    out.push(row('Background', colour(c.background && c.background !== 'none' ? c.background : '#ffffff', (v) => this.patch((x) => ({ ...x, background: v === '#ffffff' ? undefined : v }), 'Chart background')),
      check(c.background === 'none', (v) => this.patch((x) => clean({ ...x, background: v ? 'none' : undefined }), 'Chart background'), 'See-through')));
    out.push(row('Border', check(c.border !== false, (v) => this.patch((x) => clean({ ...x, border: v ? undefined : false }), 'Chart border'))));
    if (!this.ownData) out.push(row('Hidden rows', check(!!c.showHidden, (v) => this.patch((x) => clean({ ...x, showHidden: v || undefined }), 'Chart hidden rows'), 'Chart them too (off: a filtered table charts what shows)')));

    // a treemap is drilled into, and a decomposition tree expanded, by clicking it once it is picked
    if (c.kind === 'treemap' || c.kind === 'decomp') {
      const tree = c.kind === 'decomp';
      out.push(row(tree ? 'Expanded' : 'Drilled into', note(c.path?.length ? c.path.join(' › ') : tree ? 'The first level only' : 'The whole', 'cp-value'),
        c.path?.length ? button(tree ? 'Close up' : 'Back to the whole', () => this.patch((x) => clean({ ...x, path: undefined }), tree ? 'Close up tree' : 'Drill up')) : null));
      out.push(note(tree ? 'Click a node of the chart to split it by the next level; click it again to close it up.' : 'Click a box of the chart to drill into it, and the trail over it to go back up.'));
    }

    // a Sankey chart, treemap or decomposition tree has no axes, and its series are its levels
    const sankey = isLevelled(c.kind);
    if (c.kind !== 'pie' && !sankey) {
      const axis = (p: 'x' | 'y' | 'y2', name: string) => {
        const a = c[p] ?? {};
        const set = (q: Partial<ChartAxis>, label = 'Axis') => this.patch((x) => ({ ...x, [p]: clean({ ...x[p], ...q }) }), label);
        out.push(head(name));
        out.push(row('Title', text(a.title ?? '', (v) => set({ title: v || undefined }, 'Axis title'), 'none')));
        const numeric = p === 'x' ? isXY(c.kind) || c.kind === 'bar' : c.kind !== 'bar';
        if (numeric) {
          out.push(row('From', numberBox(a.min, (v) => set({ min: v }), 'auto'), numberBox(a.max, (v) => set({ max: v }), 'auto', 'to')));
          out.push(row('Label every', numberBox(a.step, (v) => set({ step: v }), 'auto')));
          out.push(row('Numbers', text(a.numFmt ?? '', (v) => set({ numFmt: v || undefined }), 'General')));
          if (c.kind !== 'radar') out.push(row('Log scale', check(!!a.log, (v) => set({ log: v || undefined }))));
        }
        out.push(row('Grid lines', check(p === 'y' ? a.grid !== false : !!a.grid, (v) => set({ grid: v }))));
        if (c.kind !== 'radar') out.push(row('Reverse', check(!!a.reverse, (v) => set({ reverse: v || undefined }))));
      };
      if (c.kind !== 'radar') axis('x', c.kind === 'bar' ? 'Value axis (across)' : 'Horizontal axis');
      axis('y', c.kind === 'bar' ? 'Category axis (down)' : c.kind === 'radar' ? 'Values (along the spokes)' : 'Vertical axis');
      if (c.kind === 'combo' && c.series.some((s, i) => onSecondAxis(s, i))) axis('y2', 'Second vertical axis (right)');
    }

    const data = chartData(this.view.wb!, this.sheet, c);
    const fits = chartFits(c, data);
    c.series.forEach((s, i) => {
      out.push(head(`${sankey ? 'Level' : 'Series'} ${i + 1}: ${data[i]?.name ?? ''}`));
      out.push(row('Name', text(s.name ?? '', (v) => this.patchSeries(i, { name: v || undefined }, 'Series name'), `Series ${i + 1}`)));
      out.push(row(sankey ? 'Amounts' : 'Values', text(s.y, (v) => v && this.patchSeries(i, { y: this.asRef(v)! }, 'Series values'), '', true)));
      if ((c.kind !== 'pie' || i === 0) && c.kind !== 'histogram') out.push(row(isXY(c.kind) ? 'X values' : sankey ? 'Categories' : 'Labels', text(s.x ?? '', (v) => this.patchSeries(i, { x: this.asRef(v) }, 'Series x values'), c.kind === 'box' ? 'one box' : '1, 2, 3…', true)));
      if (sankey) { if (c.series.length > 1) out.push(row('', button('Remove this level', () => this.patch((x) => ({ ...x, series: x.series.filter((_, j) => j !== i) }), 'Remove level')))); return; }
      if (c.kind === 'bubble') out.push(row('Sizes', text(s.size ?? '', (v) => this.patchSeries(i, { size: this.asRef(v) }, 'Bubble sizes'), 'all the same', true)));
      if (c.kind === 'combo') {
        out.push(row('Drawn as', select([['column', 'Columns'], ['line', 'A line']], comboAs(s, i), (v) => this.patchSeries(i, { as: v === (i === 0 ? 'column' : 'line') ? undefined : v as 'column' | 'line' }, 'Series drawn as')),
          check(onSecondAxis(s, i), (v) => this.patchSeries(i, { secondary: v === i > 0 ? undefined : v }, 'Second axis'), 'Second axis')));
      }
      if (c.kind !== 'pie') {
        out.push(row('Colour', colour(data[i]?.color ?? '#4472c4', (v) => this.patchSeries(i, { color: v }, 'Series colour')),
          s.color ? button('Auto', () => this.patchSeries(i, { color: undefined }, 'Series colour')) : null));
      }
      const lineLike = c.kind === 'scatter' || c.kind === 'line' || (c.kind === 'radar' && !c.filled) || (c.kind === 'combo' && comboAs(s, i) === 'line');
      if (lineLike) {
        const joined = c.kind !== 'scatter';
        if (c.kind === 'scatter') out.push(row('Sticks', check(!!s.sticks, (v) => this.patchSeries(i, { sticks: v || undefined, ...(v ? { errors: undefined } : {}) }, 'Sticks'), 'Peaks drawn from zero, as a mass spectrum')));
        out.push(row('Markers', select([...MARKERS, 'none'].map((m) => [m, m[0].toUpperCase() + m.slice(1)]), s.marker ?? (c.kind === 'scatter' && !s.sticks ? 'circle' : 'none'), (v) => this.patchSeries(i, { marker: v as MarkerShape }, 'Markers')),
          numberBox(s.markerSize, (v) => this.patchSeries(i, { markerSize: v }, 'Marker size'), '7', 'px')));
        out.push(row('Line', check(joined ? s.line !== false : !!s.line, (v) => this.patchSeries(i, { line: joined ? (v ? undefined : false) : v || undefined }, 'Series line')),
          c.kind !== 'radar' ? check(!!s.smooth, (v) => this.patchSeries(i, { smooth: v || undefined }, 'Smooth line'), 'Smooth') : null));
        out.push(row('Line style', select([['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']], s.dash ?? 'solid', (v) => this.patchSeries(i, { dash: v === 'solid' ? undefined : (v as 'dash') }, 'Line style')),
          numberBox(s.lineWidth, (v) => this.patchSeries(i, { lineWidth: v }, 'Line width'), '2', 'px')));
      }
      const remove = () => row('', button('Remove this series', () => this.patch((x) => ({ ...x, series: x.series.filter((_, j) => j !== i) }), 'Remove series')));
      if (c.kind !== 'box') out.push(row('Values shown', check(!!s.labels, (v) => this.patchSeries(i, { labels: v || undefined }, 'Data labels')),
        c.kind === 'scatter' ? check(!!s.labelX, (v) => this.patchSeries(i, { labelX: v || undefined, ...(v ? { labels: true } : {}) }, 'Data labels'), 'Show x (m/z)') : null));
      if (!FITTED.has(c.kind)) { if (c.series.length > 1 && c.kind !== 'pie') out.push(remove()); return; }
      // error bars
      const e = s.errors;
      if (!s.sticks) out.push(row('Error bars', select([['', 'None'], ['fixed', 'Fixed amount'], ['percent', 'Percentage'], ['stdev', 'Standard deviations'], ['cells', 'From cells']], e?.kind ?? '', (v) => this.patchSeries(i, { errors: v ? { kind: v as ErrorBars['kind'], value: v === 'percent' ? 5 : 1 } : undefined }, 'Error bars'))));
      if (e && e.kind !== 'cells') out.push(row(e.kind === 'percent' ? 'Percent' : e.kind === 'stdev' ? 'How many' : 'Amount', numberBox(e.value, (v) => this.patchSeries(i, { errors: { ...e, value: v } }, 'Error bars'), '1')));
      if (e?.kind === 'cells') {
        out.push(row('Plus', text(e.plus ?? '', (v) => this.patchSeries(i, { errors: clean({ ...e, plus: this.asRef(v) }) }, 'Error bars'), 'D2:D9', true)));
        out.push(row('Minus', text(e.minus ?? '', (v) => this.patchSeries(i, { errors: clean({ ...e, minus: this.asRef(v) }) }, 'Error bars'), 'same as plus', true)));
      }
      // fitted line
      const f = s.fit;
      const setFit = (q: Partial<SeriesFit> | null) => this.patchSeries(i, { fit: q === null ? undefined : clean({ kind: 'linear', showEq: true, showR2: true, ...f, ...q } as SeriesFit) }, 'Fitted line');
      out.push(row('Fitted line', select([['', 'None'], ...FITS.map((k) => [k, FIT_NAMES[k]] as [string, string])], f?.kind ?? '', (v) => setFit(v ? { kind: v as FitKind } : null))));
      if (f) {
        out.push(row('Show', check(!!f.showEq, (v) => setFit({ showEq: v }), 'Equation'), check(!!f.showR2, (v) => setFit({ showR2: v }), 'R²')));
        if (f.kind === 'linear' || f.kind.startsWith('poly') || f.kind === 'exp') out.push(row(f.kind === 'exp' ? 'Value at x = 0' : 'Crosses y at', numberBox(f.intercept, (v) => setFit({ intercept: v }), 'fitted')));
        out.push(row('Extend', numberBox(f.backward, (v) => setFit({ backward: v }), '0', 'back'), numberBox(f.forward, (v) => setFit({ forward: v }), '0', 'forward')));
        out.push(row('Colour', colour(f.color ?? data[i]?.color ?? '#4472c4', (v) => setFit({ color: v })), f.color ? button('Auto', () => setFit({ color: undefined })) : null));
        out.push(row('Legend', check(f.legend !== false, (v) => setFit({ legend: v ? undefined : false }), 'List it')));
        if (f.labelAt) out.push(row('Equation', button('Put back beside the line', () => setFit({ labelAt: undefined }))));
        const fit = fits[i];
        if (fit) {
          const box = document.createElement('div');
          box.className = 'cp-fit';
          box.append(note(`${fitEquation(fit, 6)}`, 'cp-value'), note(`${r2Text(fit, 5)}   (n = ${fit.n})`, 'cp-value'));
          if (fit.kind === 'linear') box.append(note(`Slope ${fitNumber(fit.coef[1], 6)}, intercept ${fitNumber(fit.coef[0], 6)}`, 'muted small'));
          const btns = document.createElement('div');
          btns.className = 'cp-buttons';
          btns.append(button('Copy equation', () => void navigator.clipboard?.writeText(`${fitEquation(fit, 6)}\n${r2Text(fit, 5)}`).then(() => this.host.flash('Copied the equation.'), () => this.host.flash('This browser would not copy.'))));
          if (fit.kind === 'linear' && f.intercept === undefined && s.x && c.kind === 'scatter' && !this.target) btns.append(button('Put in cells…', () => void this.fitToCells(i)));
          box.append(btns);
          out.push(box);
        } else out.push(note('Too few usable points to fit (log and power fits need x > 0; exponential and power fits need y > 0).', 'cp-error'));
      }
      if (c.series.length > 1) out.push(remove());
    });
    out.push(rowOf(button('Add series…', () => void this.addSeries()), button('Copy as picture', () => void this.copyPicture()), button('Delete chart', () => this.deleteChart())));
    return out;
  }
}

let lastX = 0, lastY = 0;

/** What to select for each newer kind of chart, said when one is made. */
const HINTS: Partial<Record<ChartKind, string>> = {
  combo: 'The first series is drawn as columns and the others as lines on a second axis, on the right; the panel changes each series.',
  histogram: 'A histogram counts the numbers of one column in bins of equal width; set the width or number of bins in the panel.',
  box: 'One box for each label in the first column (or one per column of numbers): the line is the median, the cross the mean.',
  bubble: 'Columns go x, y, then the bubble sizes (a bubble\'s area goes with its number).',
  radar: 'One spoke for each row label; each column of numbers is a shape round them.',
};

const seriesLabel = (c: Chart, i: number) => c.series[i].name && !c.series[i].name!.startsWith('=') ? c.series[i].name! : `Series ${i + 1}`;

/** Drop unset fields, so saved charts stay small and "unset" means automatic. */
function clean<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k];
  return out as T;
}

// ---------------------------------------------------------------- panel controls

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

/** Keys typed in the panel stay out of the grid; Enter and leaving the box apply the change. */
function guard(el: HTMLInputElement | HTMLSelectElement): void {
  el.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    e.stopPropagation();
    if (e.key === 'Enter' && el instanceof HTMLInputElement) el.blur();
  });
}

function text(value: string, set: (v: string) => void, placeholder = '', wide = false): HTMLInputElement {
  const i = document.createElement('input');
  i.value = value;
  i.placeholder = placeholder;
  i.spellcheck = false;
  if (wide) i.className = 'cp-ref';
  guard(i);
  i.addEventListener('change', () => set(i.value.trim()));
  return i;
}

function numberBox(value: number | undefined, set: (v: number | undefined) => void, placeholder = '', unit = ''): HTMLElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = 'any';
  i.value = value === undefined ? '' : String(value);
  i.placeholder = placeholder;
  i.className = 'cp-num';
  guard(i);
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
  guard(s);
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
  i.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#4472c4';
  i.addEventListener('change', () => set(i.value));
  return i;
}

