// The grid of Sheet mode, drawn on one canvas so it scrolls smoothly with thousands of rows and
// pictures of structures in them. It works as Excel's does: click and drag to select, type to
// fill a cell, Enter and Tab to move on, F2 or a double-click to change a cell, the small
// square at the corner of the selection to fill, column and row borders to resize, frozen
// header rows that stay put, and a filter button on each header of a filtered table.
//
// Structures are drawn as pictures that shrink to fit their cell; rows grow to fit the
// structures and wrapped text in them unless their height has been set by hand.

import { Workbook, Sheet, Structure, CellStyle, Side, growToMerges, countOn } from '../sheet/workbook';
import { Range, MAX_ROWS, MAX_COLS, colName, rangeName, normRange, inRange, keyOf, rowOf, colOf, cellName } from '../sheet/refs';
import { formatValue, generalFitting } from '../sheet/numfmt';
import { readTyped, isError, CellError } from '../sheet/values';
import { chemPieces } from '../sheet/cell-text';
import { DEFAULT_COL_W, DEFAULT_ROW_H, STRUCTURE_SCALE, STRUCTURE_PAD, MAX_AUTO_ROW, structureHeight, structurePlace } from '../sheet/layout';
import { formulaRefs, normalizeFormula } from '../sheet/formula';
import { Chart, chartData } from '../sheet/chart';
import { drawChart, ChartHits, Box } from '../render/chart-draw';
import { DashboardView } from './dashboard-view';
import { newDashboard, Tile } from '../sheet/dashboard';

const HEADER_W = 44;
const HEADER_H = 22;
/** Calibri, as Excel uses, with stand-ins that have the same widths elsewhere. */
export const CELL_FONT = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";
export const CELL_SIZE = 11;
const PAD = STRUCTURE_PAD;

export interface Cursor { r: number; c: number }

export interface Selection {
  /** The active cell (where typing goes). */
  active: Cursor;
  /** Where the selection was started from (Shift+click and Shift+arrows move the other corner). */
  anchor: Cursor;
  range: Range;
}

export interface ViewState {
  sheet: number;
  sels: Map<Sheet, Selection>;
  scroll: Map<Sheet, { x: number; y: number }>;
  zoom: number;
}

export interface SheetViewHost {
  /** Size in points of a structure's picture. */
  structureBox(s: Structure): { w: number; h: number };
  /** The structure painted at `scale` pixels per point (null while it's being made). */
  structureBitmap(s: Structure, scale: number): CanvasImageSource | null;
  /** Open the structure editor on a cell. */
  editStructure(row: number, col: number): void;
  /** A key not handled by the grid (menus, hotkeys). True when it did something. */
  key(e: KeyboardEvent): boolean;
  /** The selection, the sheet showing or the cell being typed in changed. */
  changed(): void;
  /** A right-click: what was clicked. */
  contextMenu(x: number, y: number, where: 'cell' | 'row' | 'col' | 'chart' | 'tile'): void;
  /** A dashboard tile was double-clicked (open its settings). */
  openTile?(tile: Tile): void;
  /** A chart was double-clicked (open its settings). */
  editChart?(id: number): void;
  /** The filter button on a header was clicked. */
  filterMenu(col: number, at: { x: number; y: number }): void;
  flash(msg: string, ms?: number): void;
  /** The typing in a cell (or the formula bar) changed. */
  typing(text: string | null): void;
}

/** Sizes of rows or columns, with the position of each worked out once. */
class Axis {
  tops: Float64Array;
  constructor(public n: number, size: (i: number) => number, public def: number) {
    this.tops = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) this.tops[i + 1] = this.tops[i] + size(i);
  }
  pos(i: number): number {
    return i <= this.n ? this.tops[i] : this.tops[this.n] + (i - this.n) * this.def;
  }
  size(i: number): number {
    return this.pos(i + 1) - this.pos(i);
  }
  /** The row or column at a position. */
  at(p: number): number {
    if (p < 0) return 0;
    const end = this.tops[this.n];
    if (p >= end) return Math.min(this.n + Math.floor((p - end) / this.def), this.limit - 1);
    let lo = 0, hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] <= p) lo = mid; else hi = mid - 1;
    }
    // hidden ones (no size) are skipped
    while (lo < this.n && this.tops[lo + 1] === this.tops[lo]) lo++;
    return lo;
  }
  limit = MAX_ROWS;
  get total(): number { return this.tops[this.n]; }
}

type Region = { x: number; y: number; w: number; h: number; ox: number; oy: number; r1: number; r2: number; c1: number; c2: number };

type Drag =
  | { kind: 'select'; pointer: number }
  | { kind: 'rows'; pointer: number }
  | { kind: 'cols'; pointer: number }
  | { kind: 'resize-col'; col: number; start: number; size: number; orig: number | undefined; pointer: number }
  | { kind: 'resize-row'; row: number; start: number; size: number; orig: number | undefined; pointer: number }
  | { kind: 'fill'; src: Range; to: Range; pointer: number; ctrl: boolean }
  | { kind: 'point'; pointer: number; start: Cursor }
  | { kind: 'chart'; pointer: number; id: number; how: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'label'; series?: number; x0: number; y0: number; orig: Chart; moved: boolean };

const HANDLE = 7;

export class SheetView {
  wb: Workbook | null = null;
  zoom = 1;
  /** The cell being typed in, if any. 'enter': arrows finish typing (Excel's Enter mode); 'edit': arrows move in the text. */
  editing: { r: number; c: number; mode: 'enter' | 'edit'; original: string } | null = null;
  /** Cells copied (shown with a dashed border until Esc or the next edit). */
  copied: { sheet: Sheet; range: Range } | null = null;
  /** Called with the reference to put in a formula being typed (pointing at cells). */
  readonly el: HTMLDivElement;
  readonly input: HTMLTextAreaElement;
  private scroller: HTMLDivElement;
  private spacer: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tabsEl: HTMLDivElement;
  private sels = new Map<Sheet, Selection>();
  private scrolls = new Map<Sheet, { x: number; y: number }>();
  private rows!: Axis;
  private cols!: Axis;
  private metricsKey = '';
  private extentRows = 200;
  private extentCols = 40;
  private queued = false;
  private drag: Drag | null = null;
  private hoverTip = '';
  private measureCtx: CanvasRenderingContext2D;
  /** Pictures still to be made: drawn in the next frames, a few at a time. */
  private pendingPictures = false;
  /** Point mode: a reference put in a formula by clicking, replaced as the pointer moves. */
  private pointRef: { start: number; end: number } | null = null;
  private findBar: HTMLDivElement;
  /** The chart picked (by its id), on the sheet showing. */
  chartSel: number | null = null;
  /** A chart being dragged, drawn in place of the saved one until the drag ends. */
  private chartPreview: Chart | null = null;
  /** Shows a dashboard sheet in place of the grid. */
  readonly dash: DashboardView;
  private chartCache = new Map<number, { key: string; chart: Chart; canvas: HTMLCanvasElement; hits: ChartHits }>();

  constructor(root: HTMLElement, private host: SheetViewHost) {
    this.el = root as HTMLDivElement;
    root.classList.add('sheet-host');
    this.scroller = document.createElement('div');
    this.scroller.className = 'sh-scroll';
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute('role', 'grid');
    this.scroller.setAttribute('aria-label', 'Sheet');
    this.spacer = document.createElement('div');
    this.spacer.className = 'sh-spacer';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sh-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.input = document.createElement('textarea');
    this.input.className = 'sh-input';
    this.input.spellcheck = false;
    this.input.hidden = true;
    this.input.setAttribute('aria-label', 'Cell contents');
    this.scroller.append(this.canvas, this.spacer, this.input);
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'sh-tabs';
    this.tabsEl.setAttribute('role', 'tablist');
    this.tabsEl.setAttribute('aria-label', 'Sheets');
    this.findBar = document.createElement('div');
    this.findBar.className = 'sh-find';
    this.findBar.hidden = true;
    root.append(this.findBar, this.scroller, this.tabsEl);
    this.measureCtx = document.createElement('canvas').getContext('2d')!;
    this.rows = new Axis(0, () => DEFAULT_ROW_H, DEFAULT_ROW_H);
    this.cols = new Axis(0, () => DEFAULT_COL_W, DEFAULT_COL_W);
    this.cols.limit = MAX_COLS;

    this.scroller.addEventListener('scroll', () => {
      this.growExtent();
      this.render();
    });
    this.scroller.addEventListener('pointerdown', (e) => this.onDown(e));
    this.scroller.addEventListener('pointermove', (e) => this.onMove(e));
    this.scroller.addEventListener('pointerup', (e) => this.onUp(e));
    this.scroller.addEventListener('dblclick', (e) => this.onDouble(e));
    this.scroller.addEventListener('contextmenu', (e) => this.onContext(e));
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('keydown', (e) => this.onInputKey(e));
    this.input.addEventListener('input', () => { this.pointRef = null; this.fitInput(); this.host.typing(this.input.value); });
    this.input.addEventListener('pointerdown', (e) => e.stopPropagation());
    new ResizeObserver(() => this.render()).observe(this.scroller);
    this.buildFindBar();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const view = this;
    this.dash = new DashboardView(root, {
      get wb() { return view.wb; },
      get zoom() { return view.zoom; },
      structureBox: (st) => host.structureBox(st),
      structureBitmap: (st, scale) => host.structureBitmap(st, scale),
      setDashboard: (d, label) => {
        const sh = this.sheet!;
        this.wb!.edit(label, () => sh.setDashboard(d), this.place());
      },
      picked: () => host.changed(),
      open: (t) => host.openTile?.(t),
      contextMenu: (x, y) => host.contextMenu(x, y, 'tile'),
      flash: (m, ms) => host.flash(m, ms),
      key: (e) => host.key(e),
    });
  }

  // ---------------------------------------------------------------- the workbook shown

  /** Show a workbook (a sheet tab came to the front), with its selection and scroll if kept. */
  show(wb: Workbook | null, state?: ViewState | null): void {
    this.cancelEdit();
    this.chartSel = null;
    this.chartCache.clear();
    this.wb = wb;
    this.copied = null;
    if (state) {
      this.sels = new Map(state.sels);
      this.scrolls = new Map(state.scroll);
      this.zoom = state.zoom;
      if (wb) wb.active = Math.min(state.sheet, wb.sheets.length - 1);
    } else {
      this.sels = new Map();
      this.scrolls = new Map();
      this.zoom = 1;
    }
    this.metricsKey = '';
    this.renderTabs();
    this.restoreScroll();
    this.render();
  }

  /** The selection and scroll of every sheet, kept while another tab shows. */
  state(): ViewState {
    this.saveScroll();
    return { sheet: this.wb?.active ?? 0, sels: new Map(this.sels), scroll: new Map(this.scrolls), zoom: this.zoom };
  }

  get sheet(): Sheet | null {
    return this.wb ? this.wb.sheet : null;
  }

  get sel(): Selection {
    const s = this.sheet!;
    let sel = this.sels.get(s);
    if (!sel) {
      sel = { active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 } };
      this.sels.set(s, sel);
    }
    return sel;
  }

  /** Where the selection is, for the undo history. */
  place(): { sheet: Sheet; sel: Range } | undefined {
    return this.sheet ? { sheet: this.sheet, sel: { ...this.sel.range } } : undefined;
  }

  /** Go to another sheet of the workbook. */
  goSheet(i: number): void {
    const wb = this.wb;
    if (!wb || i < 0 || i >= wb.sheets.length || i === wb.active) return;
    this.commitEdit();
    this.chartSel = null;
    this.saveScroll();
    wb.active = i;
    this.copied = null;
    this.metricsKey = '';
    this.renderTabs();
    this.restoreScroll();
    this.render();
    this.host.changed();
  }

  private saveScroll(): void {
    if (this.sheet) this.scrolls.set(this.sheet, { x: this.scroller.scrollLeft, y: this.scroller.scrollTop });
  }

  private restoreScroll(): void {
    const p = this.sheet ? this.scrolls.get(this.sheet) : null;
    this.layout();
    this.scroller.scrollLeft = p?.x ?? 0;
    this.scroller.scrollTop = p?.y ?? 0;
  }

  /** After the workbook changed (an edit, undo or redo): lay out and draw again. */
  refresh(): void {
    this.metricsKey = '';
    this.renderTabs();
    this.render();
  }

  // ---------------------------------------------------------------- sizes and positions

  /** The height a row needs for its structures and wrapped text (null: the standard height). */
  autoHeights(s: Sheet): Map<number, number> {
    const out = new Map<number, number>();
    for (const [k, c] of s.cells) {
      const row = rowOf(k), col = colOf(k);
      let h = 0;
      const style = s.styleAt(row, col);
      if (c.structure) {
        // a structure in a column narrower than it shrinks, and needs less height
        h = structureHeight(this.host.structureBox(c.structure), s.colWidths.get(col) ?? DEFAULT_COL_W);
      } else if (style?.wrap && c.input) {
        const w = (s.colWidths.get(col) ?? DEFAULT_COL_W) - 2 * PAD;
        const lines = this.wrapLines(s.shownText(row, col), this.font(style, 1), w).length;
        h = lines * this.lineHeight(style) + 6;
      } else if (style?.size && style.size > CELL_SIZE) {
        h = this.lineHeight(style) + 6;
      }
      if (h > DEFAULT_ROW_H) out.set(row, Math.min(MAX_AUTO_ROW, Math.max(out.get(row) ?? 0, Math.ceil(h))));
    }
    return out;
  }

  private lineHeight(style: CellStyle | undefined): number {
    return Math.round(((style?.size ?? CELL_SIZE) * 96) / 72 * 1.22);
  }

  /** Lay out rows and columns (again, when the sheet, the zoom or the size changed). */
  private layout(): void {
    const s = this.sheet;
    if (!s) return;
    const key = `${s.uid}|${this.wb!.edits}|${this.zoom}|${this.extentRows}|${this.extentCols}`;
    if (key === this.metricsKey) return;
    this.metricsKey = key;
    const z = this.zoom;
    const sel = this.sel;
    this.extentRows = Math.max(this.extentRows, s.lastRow + 60, sel.range.r2 + 30);
    this.extentCols = Math.max(this.extentCols, s.lastCol + 12, sel.range.c2 + 8);
    const auto = this.autoHeights(s);
    this.rows = new Axis(Math.min(this.extentRows, MAX_ROWS), (r) => (s.hiddenRows.has(r) ? 0 : (s.rowHeights.get(r) ?? auto.get(r) ?? DEFAULT_ROW_H) * z), DEFAULT_ROW_H * z);
    this.cols = new Axis(Math.min(this.extentCols, MAX_COLS), (c) => (s.hiddenCols.has(c) ? 0 : (s.colWidths.get(c) ?? DEFAULT_COL_W) * z), DEFAULT_COL_W * z);
    this.cols.limit = MAX_COLS;
    this.spacer.style.width = `${HEADER_W + this.cols.total}px`;
    this.spacer.style.height = `${HEADER_H + this.rows.total}px`;
  }

  /** Scrolling near the end makes more rows and columns. */
  private growExtent(): void {
    const sc = this.scroller;
    let grew = false;
    if (sc.scrollTop + sc.clientHeight > this.rows.total - 200 && this.extentRows < MAX_ROWS) { this.extentRows += 500; grew = true; }
    if (sc.scrollLeft + sc.clientWidth > this.cols.total - 200 && this.extentCols < MAX_COLS) { this.extentCols += 20; grew = true; }
    if (grew) { this.metricsKey = ''; this.layout(); }
  }

  /** The height of a row in pixels at 100% (as the grid shows it). */
  rowHeight(r: number): number {
    this.layout();
    return this.rows.size(r) / this.zoom;
  }

  colWidth(c: number): number {
    this.layout();
    return this.cols.size(c) / this.zoom;
  }

  private frozen(): { fr: number; fc: number; FH: number; FW: number } {
    const s = this.sheet!;
    const fr = s.frozen.rows, fc = s.frozen.cols;
    return { fr, fc, FH: this.rows.pos(fr), FW: this.cols.pos(fc) };
  }

  /** The four parts of the grid: frozen corner, frozen rows, frozen columns, and the part that scrolls. */
  private regions(): Region[] {
    const vw = this.scroller.clientWidth, vh = this.scroller.clientHeight;
    const sx = this.scroller.scrollLeft, sy = this.scroller.scrollTop;
    const { fr, fc, FH, FW } = this.frozen();
    const make = (x: number, y: number, w: number, h: number, ox: number, oy: number, rowsFrom: number, rowsTo: number | null, colsFrom: number, colsTo: number | null): Region => {
      const r1 = rowsTo === null ? this.rows.at(oy) : rowsFrom;
      const r2 = rowsTo === null ? this.rows.at(oy + h) : rowsTo;
      const c1 = colsTo === null ? this.cols.at(ox) : colsFrom;
      const c2 = colsTo === null ? this.cols.at(ox + w) : colsTo;
      return { x, y, w, h, ox, oy, r1: Math.max(r1, rowsFrom), r2, c1: Math.max(c1, colsFrom), c2 };
    };
    const out: Region[] = [];
    const mainW = Math.max(0, vw - HEADER_W - FW), mainH = Math.max(0, vh - HEADER_H - FH);
    out.push(make(HEADER_W + FW, HEADER_H + FH, mainW, mainH, FW + sx, FH + sy, fr, null, fc, null));
    if (fr) out.push(make(HEADER_W + FW, HEADER_H, mainW, FH, FW + sx, 0, 0, fr - 1, fc, null));
    if (fc) out.push(make(HEADER_W, HEADER_H + FH, FW, mainH, 0, FH + sy, fr, null, 0, fc - 1));
    if (fr && fc) out.push(make(HEADER_W, HEADER_H, FW, FH, 0, 0, 0, fr - 1, 0, fc - 1));
    return out;
  }

  /** The cell at a point in the grid (view coordinates), and whether it's on a header. */
  private hit(x: number, y: number): { r: number; c: number; where: 'cell' | 'col' | 'row' | 'corner' } {
    const { FH, FW } = this.frozen();
    const sx = this.scroller.scrollLeft, sy = this.scroller.scrollTop;
    const gx = x - HEADER_W, gy = y - HEADER_H;
    const sheetX = gx < FW ? gx : gx + sx;
    const sheetY = gy < FH ? gy : gy + sy;
    const c = this.cols.at(Math.max(0, sheetX)), r = this.rows.at(Math.max(0, sheetY));
    const where = x < HEADER_W && y < HEADER_H ? 'corner' : y < HEADER_H ? 'col' : x < HEADER_W ? 'row' : 'cell';
    return { r, c, where };
  }

  /** Where a cell is on the screen (view coordinates); null when it's scrolled out of sight. */
  cellRect(r: number, c: number): { x: number; y: number; w: number; h: number } | null {
    this.layout();
    const { fr, fc } = this.frozen();
    const sx = this.scroller.scrollLeft, sy = this.scroller.scrollTop;
    const { FH, FW } = this.frozen();
    const x = HEADER_W + (c < fc ? this.cols.pos(c) : this.cols.pos(c) - sx);
    const y = HEADER_H + (r < fr ? this.rows.pos(r) : this.rows.pos(r) - sy);
    const m = this.sheet?.mergeAt(r, c);
    const w = m ? this.cols.pos(m.c2 + 1) - this.cols.pos(m.c1) : this.cols.size(c);
    const h = m ? this.rows.pos(m.r2 + 1) - this.rows.pos(m.r1) : this.rows.size(r);
    if (c >= fc && x + w < HEADER_W + FW) return null;
    if (r >= fr && y + h < HEADER_H + FH) return null;
    return { x, y, w, h };
  }

  /** Scroll so a cell can be seen. */
  reveal(r: number, c: number): void {
    this.layout();
    const { fr, fc, FH, FW } = this.frozen();
    const sc = this.scroller;
    const vw = sc.clientWidth - HEADER_W - FW, vh = sc.clientHeight - HEADER_H - FH;
    if (r >= fr) {
      const top = this.rows.pos(r) - FH, bottom = this.rows.pos(r + 1) - FH;
      if (top < sc.scrollTop) sc.scrollTop = top;
      else if (bottom > sc.scrollTop + vh) sc.scrollTop = Math.min(top, bottom - vh);
    }
    if (c >= fc) {
      const left = this.cols.pos(c) - FW, right = this.cols.pos(c + 1) - FW;
      if (left < sc.scrollLeft) sc.scrollLeft = left;
      else if (right > sc.scrollLeft + vw) sc.scrollLeft = Math.min(left, right - vw);
    }
  }

  // ---------------------------------------------------------------- drawing

  render(): void {
    // a dashboard sheet shows its tiles in place of the grid
    const dashSheet = this.sheet?.dashboard ? this.sheet : null;
    if (this.scroller.hidden !== !!dashSheet) this.scroller.hidden = !!dashSheet;
    this.dash.show(dashSheet);
    if (dashSheet) return;
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  /** Draw now (tests and screenshots). */
  draw(): void {
    const s = this.sheet;
    const vw = this.scroller.clientWidth, vh = this.scroller.clientHeight;
    if (!s || !vw || !vh) return;
    this.layout();
    const dpr = window.devicePixelRatio || 1;
    const cv = this.canvas;
    if (cv.width !== Math.round(vw * dpr) || cv.height !== Math.round(vh * dpr)) {
      cv.width = Math.round(vw * dpr);
      cv.height = Math.round(vh * dpr);
      cv.style.width = `${vw}px`;
      cv.style.height = `${vh}px`;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, vw, vh);
    this.pendingPictures = false;
    let budget = { n: 6 };
    const regions = this.regions();
    for (const g of regions) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x, g.y, g.w, g.h);
      ctx.clip();
      this.drawRegion(g, budget);
      this.drawSelection(g);
      ctx.restore();
    }
    this.drawCharts(vw, vh);
    this.drawHeaders(regions);
    const { FH, FW } = this.frozen();
    ctx.strokeStyle = '#9aa3b5';
    ctx.lineWidth = 1;
    if (FH) { ctx.beginPath(); ctx.moveTo(0, HEADER_H + FH + 0.5); ctx.lineTo(vw, HEADER_H + FH + 0.5); ctx.stroke(); }
    if (FW) { ctx.beginPath(); ctx.moveTo(HEADER_W + FW + 0.5, 0); ctx.lineTo(HEADER_W + FW + 0.5, vh); ctx.stroke(); }
    if (this.editing) this.placeInput();
    if (this.pendingPictures) this.render();
    budget = { n: 0 };
  }

  // ---------------------------------------------------------------- charts

  /** The charts of the sheet showing, with one being dragged in its new place. */
  private chartsShown(): Chart[] {
    const list = this.sheet?.charts ?? [];
    const p = this.chartPreview;
    return p ? list.map((c) => (c.id === p.id ? p : c)) : list;
  }

  /** The chart picked, if it is still there. */
  get selectedChart(): Chart | null {
    if (this.chartSel === null) return null;
    return this.sheet?.charts.find((c) => c.id === this.chartSel) ?? null;
  }

  /** Pick a chart (null: back to the cells). */
  pickChart(id: number | null): void {
    if (id === this.chartSel) return;
    this.chartSel = id;
    this.render();
    this.host.changed();
  }

  /** Where a chart is on the screen (view coordinates). */
  chartBox(c: Chart): Box {
    this.layout();
    const { fr, fc } = this.frozen();
    const z = this.zoom;
    const x = HEADER_W + this.cols.pos(c.at.col) + c.at.dx * z - (c.at.col < fc ? 0 : this.scroller.scrollLeft);
    const y = HEADER_H + this.rows.pos(c.at.row) + c.at.dy * z - (c.at.row < fr ? 0 : this.scroller.scrollTop);
    return { x, y, w: c.w * z, h: c.h * z };
  }

  /** The cell and offset (pixels at 100%) of a point on the sheet, for placing a chart. */
  private anchorAt(sheetX: number, sheetY: number): Chart['at'] {
    const col = this.cols.at(Math.max(0, sheetX)), row = this.rows.at(Math.max(0, sheetY));
    return { row, col, dx: Math.max(0, (sheetX - this.cols.pos(col)) / this.zoom), dy: Math.max(0, (sheetY - this.rows.pos(row)) / this.zoom) };
  }

  /** A new chart moved down below any chart it would cover. */
  clearOfCharts(c: Chart): Chart {
    let cur = c;
    const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let k = 0; k < 50; k++) {
      const b = this.chartBox(cur);
      const hit = this.sheet!.charts.find((o) => o.id !== cur.id && overlap(b, this.chartBox(o)));
      if (!hit) break;
      const ob = this.chartBox(hit);
      const sheetX = this.cols.pos(cur.at.col) + cur.at.dx * this.zoom;
      const sheetY = ob.y + ob.h - b.y + this.rows.pos(cur.at.row) + cur.at.dy * this.zoom + 12 * this.zoom;
      cur = { ...cur, at: this.anchorAt(sheetX, sheetY) };
    }
    return cur;
  }

  /** A chart drawn at the screen's resolution, kept until its data or settings change. */
  private chartPicture(c: Chart): { canvas: HTMLCanvasElement; hits: ChartHits } {
    const s = this.sheet!;
    const dpr = window.devicePixelRatio || 1;
    const scale = this.zoom * dpr;
    const key = `${this.wb!.edits}|${scale}|${this.wb!.sheets.map((x) => x.values.size).join(',')}`;
    const got = this.chartCache.get(c.id);
    if (got && got.chart === c && got.key === key && got.hits) return got;
    const canvas = got?.canvas ?? document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(c.w * scale));
    canvas.height = Math.max(1, Math.round(c.h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, c.w, c.h);
    const hits = drawChart(ctx, c, chartData(this.wb!, s, c), c.w, c.h);
    const entry = { key, chart: c, canvas, hits };
    this.chartCache.set(c.id, entry);
    return entry;
  }

  /** The fitted lines and plot area of a chart as last drawn (for the side panel). */
  chartHits(id: number): ChartHits | null {
    return this.chartCache.get(id)?.hits ?? null;
  }

  private drawCharts(vw: number, vh: number): void {
    const charts = this.chartsShown();
    if (!charts.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(HEADER_W, HEADER_H, vw - HEADER_W, vh - HEADER_H);
    ctx.clip();
    for (const c of charts) {
      const b = this.chartBox(c);
      if (b.x > vw || b.y > vh || b.x + b.w < HEADER_W || b.y + b.h < HEADER_H) continue;
      const pic = this.chartPicture(c);
      ctx.drawImage(pic.canvas, b.x, b.y, b.w, b.h);
      if (c.id === this.chartSel) {
        const acc = this.accent();
        ctx.strokeStyle = acc;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w) - 1, Math.round(b.h) - 1);
        ctx.fillStyle = '#ffffff';
        for (const [hx, hy] of this.handlePoints(b)) {
          ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeRect(hx - HANDLE / 2 + 0.5, hy - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1);
        }
      }
    }
    ctx.restore();
  }

  private handlePoints(b: Box): [number, number, string][] {
    const { x, y, w, h } = b;
    return [[x, y, 'nw'], [x + w / 2, y, 'n'], [x + w, y, 'ne'], [x + w, y + h / 2, 'e'], [x + w, y + h, 'se'], [x + w / 2, y + h, 's'], [x, y + h, 'sw'], [x, y + h / 2, 'w']];
  }

  /** The chart under a point (the top one), and which part of it. */
  private chartAt(x: number, y: number): { chart: Chart; how: Extract<Drag, { kind: 'chart' }>['how']; series?: number } | null {
    if (x < HEADER_W || y < HEADER_H) return null;
    const charts = this.chartsShown();
    for (let i = charts.length - 1; i >= 0; i--) {
      const c = charts[i];
      const b = this.chartBox(c);
      if (c.id === this.chartSel) {
        for (const [hx, hy, how] of this.handlePoints(b)) {
          if (Math.abs(x - hx) <= HANDLE && Math.abs(y - hy) <= HANDLE) return { chart: c, how: how as 'n' };
        }
      }
      if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
      const hits = this.chartCache.get(c.id)?.hits;
      if (hits && c.id === this.chartSel) {
        const lx = (x - b.x) / this.zoom, ly = (y - b.y) / this.zoom;
        for (const l of hits.fitLabels) {
          if (lx >= l.box.x && lx <= l.box.x + l.box.w && ly >= l.box.y && ly <= l.box.y + l.box.h) return { chart: c, how: 'label', series: l.series };
        }
      }
      return { chart: c, how: 'move' };
    }
    return null;
  }

  private dragChart(d: Extract<Drag, { kind: 'chart' }>, x: number, y: number): void {
    const z = this.zoom, o = d.orig;
    const dx = (x - d.x0) / z, dy = (y - d.y0) / z;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    const box = this.chartBox(o);
    const { fr, fc } = this.frozen();
    const toSheet = (vx: number, vy: number) => ({
      x: vx - HEADER_W + (o.at.col < fc ? 0 : this.scroller.scrollLeft),
      y: vy - HEADER_H + (o.at.row < fr ? 0 : this.scroller.scrollTop),
    });
    let next: Chart;
    if (d.how === 'label') {
      const hits = this.chartCache.get(o.id)?.hits;
      const lab = hits?.fitLabels.find((l) => l.series === d.series);
      if (!hits || !lab) return;
      const s = o.series[d.series!];
      const fx = (lab.box.x + 2 + dx - hits.plot.x) / hits.plot.w, fy = (lab.box.y + 2 + dy - hits.plot.y) / hits.plot.h;
      next = { ...o, series: o.series.map((x2, i) => (i === d.series ? { ...s, fit: { ...s.fit!, labelAt: { x: fx, y: fy } } } : x2)) };
    } else if (d.how === 'move') {
      const p = toSheet(box.x + dx * z, box.y + dy * z);
      next = { ...o, at: this.anchorAt(p.x, p.y) };
    } else {
      let { x: bx, y: by, w, h } = { x: box.x, y: box.y, w: o.w, h: o.h };
      const min = 80;
      if (d.how.includes('e')) w = Math.max(min, o.w + dx);
      if (d.how.includes('s')) h = Math.max(min, o.h + dy);
      if (d.how.includes('w')) { const nw = Math.max(min, o.w - dx); bx += (o.w - nw) * z; w = nw; }
      if (d.how.includes('n')) { const nh = Math.max(min, o.h - dy); by += (o.h - nh) * z; h = nh; }
      const p = toSheet(bx, by);
      next = { ...o, at: this.anchorAt(p.x, p.y), w: Math.round(w), h: Math.round(h) };
      this.host.flash(`${Math.round(w)} × ${Math.round(h)} pixels`, 800);
    }
    this.chartPreview = next;
    this.render();
  }

  /** Put a changed chart in the sheet (one undo step). */
  replaceChart(c: Chart, label = 'Change chart'): void {
    const s = this.sheet!;
    this.wb!.edit(label, () => s.setCharts(s.charts.map((x) => (x.id === c.id ? c : x))), this.place());
    this.render();
  }

  deleteChart(id = this.chartSel): void {
    const s = this.sheet;
    if (id === null || !s) return;
    this.wb!.edit('Delete chart', () => s.setCharts(s.charts.filter((c) => c.id !== id)), this.place());
    if (this.chartSel === id) this.chartSel = null;
    this.render();
    this.host.changed();
  }

  /** Keys while a chart is picked: Delete removes it, arrows nudge it, Esc goes back to the cells. */
  private chartKey(e: KeyboardEvent): boolean {
    const c = this.selectedChart;
    if (!c) { this.chartSel = null; return false; }
    const k = e.key;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteChart(); return true; }
    if (k === 'Escape') { e.preventDefault(); this.pickChart(null); return true; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (arrows[k]) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const b = this.chartBox(c);
      const { fr, fc } = this.frozen();
      const sx = b.x - HEADER_W + (c.at.col < fc ? 0 : this.scroller.scrollLeft) + arrows[k][0] * step * this.zoom;
      const sy = b.y - HEADER_H + (c.at.row < fr ? 0 : this.scroller.scrollTop) + arrows[k][1] * step * this.zoom;
      this.replaceChart({ ...c, at: this.anchorAt(sx, sy) }, 'Move chart');
      return true;
    }
    if (k === 'Enter' && this.host.editChart) { e.preventDefault(); this.host.editChart(c.id); return true; }
    if (this.host.key(e)) { e.preventDefault(); return true; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey) e.preventDefault();
    return true;
  }

  private font(style: CellStyle | undefined, z = this.zoom, pos: 'base' | 'sub' | 'sup' = 'base', italic = false): string {
    const size = ((style?.size ?? CELL_SIZE) * 96) / 72 * z * (pos === 'base' ? 1 : 0.7);
    return `${style?.italic || italic ? 'italic ' : ''}${style?.bold ? 'bold ' : ''}${size.toFixed(2)}px ${style?.font ? `"${style.font}", ` : ''}${CELL_FONT}`;
  }

  private textWidth(text: string, font: string): number {
    const m = this.measureCtx;
    m.font = font;
    return m.measureText(text).width;
  }

  /** Text broken into lines that fit a width. */
  private wrapLines(text: string, font: string, width: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/(?<=\s)/)) {
        if (line && this.textWidth(line + word, font) > width) { out.push(line.trimEnd()); line = word; }
        else line += word;
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  private drawRegion(g: Region, budget: { n: number }): void {
    const s = this.sheet!;
    const ctx = this.ctx;
    const z = this.zoom;
    const X = (c: number) => g.x + this.cols.pos(c) - g.ox;
    const Y = (r: number) => g.y + this.rows.pos(r) - g.oy;
    // grid lines
    ctx.strokeStyle = '#e1e4e8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = g.c1; c <= g.c2 + 1; c++) {
      const x = Math.round(X(c)) - 0.5;
      ctx.moveTo(x, g.y);
      ctx.lineTo(x, g.y + g.h);
    }
    for (let r = g.r1; r <= g.r2 + 1; r++) {
      const y = Math.round(Y(r)) - 0.5;
      ctx.moveTo(g.x, y);
      ctx.lineTo(g.x + g.w, y);
    }
    ctx.stroke();
    // merged blocks in view
    const merges = s.merges.filter((m) => m.r2 >= g.r1 && m.r1 <= g.r2 && m.c2 >= g.c1 && m.c1 <= g.c2);
    const inMerge = (r: number, c: number) => merges.find((m) => inRange(m, r, c));
    // cells: fills, then contents, then borders on top
    const filter = s.filter;
    const filterRow = filter ? filter.range.r1 : -1;
    const drawn = new Set<Range>();
    const borders: (() => void)[] = [];
    for (let r = g.r1; r <= g.r2; r++) {
      if (s.hiddenRows.has(r)) continue;
      let spillUntil = -1;
      for (let c = g.c1; c <= g.c2; c++) {
        if (s.hiddenCols.has(c)) continue;
        const m = inMerge(r, c);
        let rr = r, cc = c, x = X(c), y = Y(r), w = this.cols.size(c), h = this.rows.size(r);
        if (m) {
          if (drawn.has(m)) continue;
          drawn.add(m);
          rr = m.r1; cc = m.c1;
          x = X(m.c1); y = Y(m.r1);
          w = this.cols.pos(m.c2 + 1) - this.cols.pos(m.c1);
          h = this.rows.pos(m.r2 + 1) - this.rows.pos(m.r1);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y, w - 1, h - 1);
        }
        const cell = s.cell(rr, cc);
        const style = s.shownStyleAt(rr, cc);
        const look = s.condLook(rr, cc);
        const v = s.values.get(keyOf(rr, cc));
        if (style?.fill) {
          ctx.fillStyle = style.fill;
          ctx.fillRect(x - 1, y - 1, w + 1, h + 1);
        }
        if (look?.bar) this.drawDataBar(look.bar, x, y, w, h);
        if (look?.icon) this.drawIcon(look.icon.set, look.icon.level, x + 3 * z, y + h / 2, Math.min(14 * z, h - 4));
        if (cell?.structure) this.drawStructure(cell.structure, x, y, w, h, style, budget);
        else if (look?.hideValue) { /* only the bar or icon shows */ }
        else if (v !== undefined && v !== null && v !== '' && c > spillUntil) {
          const last = this.drawText(rr, cc, x, y, w, h, style, g, X);
          if (last > c) spillUntil = last;
        }
        if (style?.borders) borders.push(() => this.drawBorders(style.borders!, x, y, w, h));
        // a value typed over a property column's own: a small mark in the corner
        if (s.isOverride(rr, cc)) {
          ctx.fillStyle = '#d07a00';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 6 * z, y);
          ctx.lineTo(x, y + 6 * z);
          ctx.fill();
        }
        if (isError(v) && v.code !== '#BUSY!') {
          ctx.fillStyle = '#18794e';
          ctx.beginPath();
          ctx.moveTo(x + w - 7 * z, y);
          ctx.lineTo(x + w - 1, y);
          ctx.lineTo(x + w - 1, y + 6 * z);
          ctx.fill();
        }
        if (rr === filterRow && filter && cc >= filter.range.c1 && cc <= filter.range.c2) this.drawFilterButton(x, y, w, h, cc in filter.conditions);
      }
    }
    for (const b of borders) b();
    // the copied cells
    const cp = this.copied;
    if (cp && cp.sheet === s) {
      const x1 = X(cp.range.c1), y1 = Y(cp.range.r1), x2 = X(cp.range.c2 + 1), y2 = Y(cp.range.r2 + 1);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = this.accent();
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1 - 2, y2 - y1 - 2);
      ctx.restore();
    }
  }

  /** A data bar across a cell (conditional formatting). */
  private drawDataBar(bar: { from: number; to: number; color: string; gradient: boolean; negative: boolean }, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const colour = bar.negative ? '#ff0000' : bar.color;
    const inner = w - 4;
    const bx = x + 2 + bar.from * inner, bw = Math.max(1, (bar.to - bar.from) * inner);
    const by = y + 2, bh = Math.max(2, h - 5);
    if (bar.gradient) {
      const g = bar.negative ? ctx.createLinearGradient(bx + bw, 0, bx, 0) : ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, colour);
      g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
    } else ctx.fillStyle = colour;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.max(0, Math.round(bw) - 1), Math.max(0, Math.round(bh) - 1));
  }

  /** An icon of an icon set at the left of a cell: level 0 the lowest, 2 the highest. */
  private drawIcon(set: string, level: number, x: number, cy: number, size: number): void {
    const ctx = this.ctx;
    const colours = ['#e0453a', '#f2b81b', '#3a9b4a'];
    const col = colours[level];
    const s = size, r = s / 2, cx = x + r;
    ctx.save();
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, s / 7);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (set === 'arrows') {
      const a = level === 2 ? -Math.PI / 2 : level === 1 ? 0 : Math.PI / 2;
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.moveTo(r * 0.9, 0); ctx.lineTo(0, -r * 0.8); ctx.lineTo(0, -r * 0.3); ctx.lineTo(-r * 0.9, -r * 0.3);
      ctx.lineTo(-r * 0.9, r * 0.3); ctx.lineTo(0, r * 0.3); ctx.lineTo(0, r * 0.8); ctx.closePath();
      ctx.fill();
    } else if (set === 'lights') {
      ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (set === 'marks') {
      ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      if (level === 2) { ctx.moveTo(cx - r * 0.45, cy); ctx.lineTo(cx - r * 0.1, cy + r * 0.35); ctx.lineTo(cx + r * 0.45, cy - r * 0.35); }
      else if (level === 1) { ctx.moveTo(cx, cy - r * 0.45); ctx.lineTo(cx, cy + r * 0.1); ctx.moveTo(cx, cy + r * 0.42); ctx.lineTo(cx, cy + r * 0.44); }
      else { ctx.moveTo(cx - r * 0.35, cy - r * 0.35); ctx.lineTo(cx + r * 0.35, cy + r * 0.35); ctx.moveTo(cx + r * 0.35, cy - r * 0.35); ctx.lineTo(cx - r * 0.35, cy + r * 0.35); }
      ctx.stroke();
    } else if (set === 'flags') {
      ctx.lineWidth = Math.max(1, s / 10);
      ctx.strokeStyle = '#555555';
      ctx.moveTo(x + s * 0.2, cy + r * 0.9); ctx.lineTo(x + s * 0.2, cy - r * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.22, cy - r * 0.9); ctx.lineTo(x + s * 0.95, cy - r * 0.5); ctx.lineTo(x + s * 0.22, cy - r * 0.05); ctx.closePath();
      ctx.fill();
    } else {
      // stars: empty, half and full
      const star = () => {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? r * 0.42 : r * 0.95, a = -Math.PI / 2 + (i * Math.PI) / 5;
          ctx[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
        }
        ctx.closePath();
      };
      ctx.fillStyle = '#f2b81b';
      ctx.strokeStyle = '#c99200';
      ctx.lineWidth = 1;
      star();
      if (level === 2) ctx.fill();
      else if (level === 1) { ctx.save(); ctx.clip(); ctx.fillRect(cx - r, cy - r, r, s); ctx.restore(); star(); }
      ctx.stroke();
    }
    ctx.restore();
  }

  private accent(): string {
    return getComputedStyle(this.el).getPropertyValue('--accent').trim() || '#1e8a50';
  }

  private drawBorders(b: Partial<Record<Side, { style: string; color?: string }>>, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const line = (side: Side, x1: number, y1: number, x2: number, y2: number) => {
      const bd = b[side];
      if (!bd) return;
      const width = bd.style === 'thick' ? 3 : bd.style === 'medium' ? 2 : 1;
      ctx.save();
      ctx.strokeStyle = bd.color ?? '#000000';
      ctx.lineWidth = width;
      if (bd.style === 'dashed') ctx.setLineDash([4, 2]);
      if (bd.style === 'dotted') ctx.setLineDash([1, 2]);
      const off = width % 2 ? 0.5 : 0;
      ctx.beginPath();
      if (bd.style === 'double') {
        const dx = y1 === y2 ? 0 : 1.5, dy = y1 === y2 ? 1.5 : 0;
        ctx.moveTo(x1 - dx + off, y1 - dy + off); ctx.lineTo(x2 - dx + off, y2 - dy + off);
        ctx.moveTo(x1 + dx + off, y1 + dy + off); ctx.lineTo(x2 + dx + off, y2 + dy + off);
      } else {
        ctx.moveTo(x1 + off, y1 + off);
        ctx.lineTo(x2 + off, y2 + off);
      }
      ctx.stroke();
      ctx.restore();
    };
    const L = Math.round(x) - 1, T = Math.round(y) - 1, R = Math.round(x + w) - 1, B = Math.round(y + h) - 1;
    line('top', L, T, R, T);
    line('bottom', L, B, R, B);
    line('left', L, T, L, B);
    line('right', R, T, R, B);
  }

  private drawFilterButton(x: number, y: number, w: number, h: number, on: boolean): void {
    const ctx = this.ctx;
    const s = Math.min(16, h - 4);
    const bx = x + w - s - 3, by = y + h - s - 2;
    ctx.fillStyle = on ? this.accent() : '#f3f4f6';
    ctx.strokeStyle = '#9aa3b5';
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, s, s);
    ctx.strokeRect(bx + 0.5, by + 0.5, s - 1, s - 1);
    ctx.fillStyle = on ? '#ffffff' : '#3a414d';
    ctx.beginPath();
    if (on) {
      // a funnel: this column is filtered
      ctx.moveTo(bx + s * 0.22, by + s * 0.28); ctx.lineTo(bx + s * 0.78, by + s * 0.28); ctx.lineTo(bx + s * 0.56, by + s * 0.52);
      ctx.lineTo(bx + s * 0.56, by + s * 0.78); ctx.lineTo(bx + s * 0.44, by + s * 0.72); ctx.lineTo(bx + s * 0.44, by + s * 0.52);
    } else {
      ctx.moveTo(bx + s * 0.28, by + s * 0.4); ctx.lineTo(bx + s * 0.72, by + s * 0.4); ctx.lineTo(bx + s * 0.5, by + s * 0.66);
    }
    ctx.fill();
  }

  /** The filter button's box in a header cell (for clicks). */
  private filterButtonAt(x: number, y: number): number | null {
    const s = this.sheet!;
    const f = s.filter;
    if (!f) return null;
    const h = this.hit(x, y);
    if (h.where !== 'cell' || h.r !== f.range.r1 || h.c < f.range.c1 || h.c > f.range.c2) return null;
    const rect = this.cellRect(h.r, h.c);
    if (!rect) return null;
    const size = Math.min(16, rect.h - 4);
    return x >= rect.x + rect.w - size - 3 && y >= rect.y + rect.h - size - 2 ? h.c : null;
  }

  private drawStructure(st: Structure, x: number, y: number, w: number, h: number, style: CellStyle | undefined, budget: { n: number }): void {
    const p = structurePlace(this.host.structureBox(st), { x, y, w, h }, style?.align, style?.valign, this.zoom);
    if (p.k <= 0) return;
    const { x: dx, y: dy, w: dw, h: dh } = p;
    const scale = p.k * (window.devicePixelRatio || 1);
    let pic = this.host.structureBitmap(st, scale);
    if (!pic && budget.n > 0) {
      budget.n--;
      pic = this.host.structureBitmap(st, -scale); // negative: make it now
    }
    if (pic) this.ctx.drawImage(pic, dx, dy, dw, dh);
    else {
      this.pendingPictures = true;
      this.ctx.fillStyle = '#f3f4f6';
      this.ctx.fillRect(dx, dy, dw, dh);
    }
  }

  /** Draw a cell's text; returns the last column its text spills into. */
  private drawText(r: number, c: number, x: number, y: number, w: number, h: number, style: CellStyle | undefined, g: Region, X: (c: number) => number): number {
    const s = this.sheet!;
    const ctx = this.ctx;
    const v = s.values.get(keyOf(r, c)) ?? null;
    const shown = formatValue(v, style?.numFmt);
    let text = shown.text;
    const align = style?.align ?? shown.align;
    const font = this.font(style);
    ctx.font = font;
    ctx.fillStyle = shown.color ?? style?.color ?? (isError(v) ? '#b4232a' : '#000000');
    const pad = 3 * this.zoom;
    const lineH = this.lineHeight(style) * this.zoom;
    const valign = style?.valign ?? 'bottom';
    let last = c;
    if (style?.wrap) {
      const lines = this.wrapLines(text, font, w - 2 * pad);
      const total = lines.length * lineH;
      let ty = valign === 'top' ? y + 2 : valign === 'middle' ? y + (h - total) / 2 : y + h - total - 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w - 1, h - 1);
      ctx.clip();
      for (const line of lines) {
        this.drawLine(line, style, x, w, pad, ty + lineH * 0.78, align);
        ty += lineH;
      }
      ctx.restore();
      return c;
    }
    text = text.replace(/\n/g, ' ');
    const widthOf = (t: string) => (style?.chem ? this.piecesWidth(t, style) : this.textWidth(t, font));
    let tw = widthOf(text);
    // a number too wide for its column: fewer decimals (General), else ### as in Excel
    if (typeof v === 'number' && tw > w - 2 * pad) {
      const general = !style?.numFmt || /^general$/i.test(style.numFmt);
      text = (general ? generalFitting(v, (t) => widthOf(t) <= w - 2 * pad) : null) ?? '#'.repeat(Math.max(1, Math.floor((w - 2 * pad) / Math.max(1, this.textWidth('#', font)))));
      tw = widthOf(text);
    }
    let clipW = w;
    // text too long for its cell runs on over empty cells beside it (as in Excel)
    if (tw > w - 2 * pad && typeof v === 'string' && align === 'left') {
      let cc = c + 1;
      while (cc <= Math.min(g.c2 + 20, c + 60) && clipW < tw + 2 * pad) {
        const nv = s.values.get(keyOf(r, cc));
        if ((nv !== undefined && nv !== null && nv !== '') || s.cell(r, cc)?.structure || s.mergeAt(r, cc)) break;
        clipW = X(cc + 1) - x;
        last = cc;
        cc++;
      }
      if (last > c) {
        // hide the grid lines under the text
        ctx.fillStyle = style?.fill ?? '#ffffff';
        ctx.fillRect(x + w - 2, y, clipW - w, h - 1);
        ctx.fillStyle = shown.color ?? style?.color ?? '#000000';
      }
    }
    const baseline = valign === 'top' ? y + lineH * 0.8 + 1 : valign === 'middle' ? y + h / 2 + lineH * 0.3 : y + h - 4 * this.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, clipW - 1, h - 1);
    ctx.clip();
    this.drawLine(text, style, x, clipW, pad, baseline, align);
    ctx.restore();
    if (style?.underline) {
      const lw = Math.min(tw, clipW - 2 * pad);
      const lx = align === 'right' ? x + clipW - pad - lw : align === 'center' ? x + (clipW - lw) / 2 : x + pad;
      ctx.fillRect(lx, baseline + 2, lw, Math.max(1, this.zoom));
    }
    return last;
  }

  private piecesWidth(text: string, style: CellStyle | undefined): number {
    let w = 0;
    for (const p of chemPieces(text)) w += this.textWidth(p.text, this.font(style, this.zoom, p.pos, p.italic));
    return w;
  }

  private drawLine(text: string, style: CellStyle | undefined, x: number, w: number, pad: number, baseline: number, align: string): void {
    const ctx = this.ctx;
    if (!style?.chem) {
      ctx.font = this.font(style);
      const tw = this.textWidth(text, ctx.font);
      const tx = align === 'right' ? x + w - pad - tw : align === 'center' ? x + (w - tw) / 2 : x + pad;
      ctx.fillText(text, tx, baseline);
      return;
    }
    const pieces = chemPieces(text);
    const tw = this.piecesWidth(text, style);
    let tx = align === 'right' ? x + w - pad - tw : align === 'center' ? x + (w - tw) / 2 : x + pad;
    const size = ((style.size ?? CELL_SIZE) * 96) / 72 * this.zoom;
    for (const p of pieces) {
      ctx.font = this.font(style, this.zoom, p.pos, p.italic);
      const dy = p.pos === 'sub' ? size * 0.25 : p.pos === 'sup' ? -size * 0.38 : 0;
      ctx.fillText(p.text, tx, baseline + dy);
      tx += this.textWidth(p.text, ctx.font);
    }
  }

  private drawSelection(g: Region): void {
    const s = this.sheet!;
    const sel = this.sel;
    const ctx = this.ctx;
    const X = (c: number) => g.x + this.cols.pos(c) - g.ox;
    const Y = (r: number) => g.y + this.rows.pos(r) - g.oy;
    const range = growToMerges(s, sel.range);
    const x1 = X(range.c1), y1 = Y(range.r1), x2 = X(range.c2 + 1), y2 = Y(range.r2 + 1);
    const accent = this.accent();
    const one = range.r1 === range.r2 && range.c1 === range.c2 || !!(s.mergeAt(sel.active.r, sel.active.c) && sameRange(s.mergeAt(sel.active.r, sel.active.c)!, range));
    if (!one) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = accent;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
      // the active cell stays white
      const m = s.mergeAt(sel.active.r, sel.active.c);
      const ar = m ?? { r1: sel.active.r, c1: sel.active.c, r2: sel.active.r, c2: sel.active.c };
      ctx.fillStyle = 'rgba(255,255,255,0)';
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(X(ar.c1) + 0.5, Y(ar.r1) + 0.5, X(ar.c2 + 1) - X(ar.c1) - 2, Y(ar.r2 + 1) - Y(ar.r1) - 2);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(x1 - 0.5, y1 - 0.5, x2 - x1 - 0.5, y2 - y1 - 0.5);
    // the fill handle
    if (!this.editing) {
      ctx.fillStyle = accent;
      ctx.fillRect(x2 - 4, y2 - 4, 6, 6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x2 - 4.5, y2 - 4.5, 7, 7);
    }
    if (this.drag?.kind === 'fill') {
      const t = this.drag.to;
      ctx.save();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = '#3a414d';
      ctx.lineWidth = 1;
      ctx.strokeRect(X(t.c1) + 0.5, Y(t.r1) + 0.5, X(t.c2 + 1) - X(t.c1) - 1, Y(t.r2 + 1) - Y(t.r1) - 1);
      ctx.restore();
    }
  }

  private drawHeaders(regions: Region[]): void {
    const s = this.sheet!;
    const ctx = this.ctx;
    const vw = this.scroller.clientWidth, vh = this.scroller.clientHeight;
    const sel = growToMerges(s, this.sel.range);
    const accent = this.accent();
    const css = getComputedStyle(this.el);
    const headBg = css.getPropertyValue('--sh-head').trim() || '#f3f4f6';
    const headText = css.getPropertyValue('--sh-head-text').trim() || '#3a414d';
    const soft = css.getPropertyValue('--accent-soft').trim() || '#d8eee2';
    ctx.fillStyle = headBg;
    ctx.fillRect(0, 0, vw, HEADER_H);
    ctx.fillRect(0, 0, HEADER_W, vh);
    const filtered = s.filterRows();
    ctx.font = `${12 * Math.min(1.2, Math.max(0.8, this.zoom))}px ${CELL_FONT}`;
    ctx.textBaseline = 'middle';
    const allRows = sel.r1 === 0 && sel.r2 >= MAX_ROWS - 1, allCols = sel.c1 === 0 && sel.c2 >= MAX_COLS - 1;
    // column letters
    const doneCols = new Set<number>();
    for (const g of regions) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x, 0, g.w, HEADER_H);
      ctx.clip();
      for (let c = g.c1; c <= g.c2; c++) {
        if (doneCols.has(c)) continue;
        doneCols.add(c);
        const x = g.x + this.cols.pos(c) - g.ox, w = this.cols.size(c);
        if (!w) continue;
        const on = c >= sel.c1 && c <= sel.c2;
        if (on) {
          ctx.fillStyle = soft;
          ctx.fillRect(x, 0, w, HEADER_H);
          ctx.fillStyle = accent;
          ctx.fillRect(x, HEADER_H - 2, w, 2);
        }
        ctx.fillStyle = on && allRows ? accent : headText;
        ctx.textAlign = 'center';
        ctx.fillText(colName(c), x + w / 2, HEADER_H / 2 + 1);
        ctx.fillStyle = '#d6dae1';
        ctx.fillRect(Math.round(x + w) - 1, 0, 1, HEADER_H);
      }
      ctx.restore();
    }
    // row numbers
    const doneRows = new Set<number>();
    for (const g of regions) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, g.y, HEADER_W, g.h);
      ctx.clip();
      for (let r = g.r1; r <= g.r2; r++) {
        if (doneRows.has(r)) continue;
        doneRows.add(r);
        const y = g.y + this.rows.pos(r) - g.oy, h = this.rows.size(r);
        if (!h) continue;
        const on = r >= sel.r1 && r <= sel.r2;
        if (on) {
          ctx.fillStyle = soft;
          ctx.fillRect(0, y, HEADER_W, h);
          ctx.fillStyle = accent;
          ctx.fillRect(HEADER_W - 2, y, 2, h);
        }
        // rows of a filtered table show their numbers in the accent colour, as in Excel
        const inFilter = filtered && r >= filtered.r1 && r <= filtered.r2 && Object.keys(s.filter!.conditions).length > 0;
        ctx.fillStyle = (on && allCols) || inFilter ? accent : headText;
        ctx.textAlign = 'right';
        ctx.fillText(String(r + 1), HEADER_W - 6, y + Math.min(h, 20 * this.zoom) / 2 + 1);
        ctx.fillStyle = '#d6dae1';
        ctx.fillRect(0, Math.round(y + h) - 1, HEADER_W, 1);
      }
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // the corner (select all)
    ctx.fillStyle = headBg;
    ctx.fillRect(0, 0, HEADER_W, HEADER_H);
    ctx.fillStyle = '#b8bec9';
    ctx.beginPath();
    ctx.moveTo(HEADER_W - 4, 6); ctx.lineTo(HEADER_W - 4, HEADER_H - 4); ctx.lineTo(HEADER_W - 4 - (HEADER_H - 10), HEADER_H - 4);
    ctx.fill();
    ctx.fillStyle = '#c5cad3';
    ctx.fillRect(0, HEADER_H - 1, vw, 1);
    ctx.fillRect(HEADER_W - 1, 0, 1, vh);
  }

  // ---------------------------------------------------------------- sheet tabs

  renderTabs(): void {
    const wb = this.wb;
    if (!wb) { this.tabsEl.replaceChildren(); return; }
    const items = wb.sheets.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sh-tab${i === wb.active ? ' active' : ''}${s.dashboard ? ' dash-tab' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === wb.active));
      b.textContent = s.name;
      b.title = `${s.name}: double-click to rename, right-click for more`;
      b.addEventListener('click', () => this.goSheet(i));
      b.addEventListener('dblclick', () => this.renameSheet(i));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.goSheet(i);
        this.sheetMenu(e.clientX, e.clientY);
      });
      return b;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'sh-tab-add';
    add.textContent = '+';
    add.title = 'New sheet';
    add.addEventListener('click', () => this.addSheet());
    this.tabsEl.replaceChildren(...items, add);
  }

  addSheet(): void {
    const wb = this.wb;
    if (!wb) return;
    this.commitEdit();
    const s = wb.edit('New sheet', () => wb.addSheet(undefined, wb.active + 1), this.place());
    this.goSheet(wb.sheets.indexOf(s));
  }

  /** A new dashboard sheet after the one showing. */
  addDashboard(): void {
    const wb = this.wb;
    if (!wb) return;
    this.commitEdit();
    let n = 1;
    while (wb.sheetNamed(`Dashboard${n === 1 ? '' : n}`)) n++;
    const s = wb.edit('New dashboard', () => {
      const sh = wb.addSheet(`Dashboard${n === 1 ? '' : n}`, wb.active + 1);
      sh.setDashboard(newDashboard());
      return sh;
    }, this.place());
    this.goSheet(wb.sheets.indexOf(s));
  }

  renameSheet(i: number): void {
    const wb = this.wb;
    if (!wb) return;
    const btn = this.tabsEl.children[i] as HTMLElement | undefined;
    if (!btn) return;
    const s = wb.sheets[i];
    const box = document.createElement('input');
    box.className = 'sh-tab-name';
    box.value = s.name;
    box.setAttribute('aria-label', 'Sheet name');
    btn.replaceWith(box);
    box.focus();
    box.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const name = box.value.trim().replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      if (keep && name && name !== s.name) {
        if (wb.sheets.some((x) => x !== s && x.name.toLowerCase() === name.toLowerCase())) this.host.flash(`There is already a sheet called ${name}.`);
        else wb.edit('Rename sheet', () => s.rename(name), this.place());
      }
      this.renderTabs();
      this.focus();
    };
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    box.addEventListener('blur', () => finish(true));
  }

  private sheetMenu(x: number, y: number): void {
    const wb = this.wb!;
    const i = wb.active;
    popupMenu(x, y, [
      ['Insert Sheet', () => this.addSheet()],
      ['Insert Dashboard', () => this.addDashboard()],
      ['Rename…', () => this.renameSheet(i)],
      ['Delete Sheet', () => this.deleteSheet(), wb.sheets.length > 1],
      null,
      ['Move Left', () => this.moveSheet(-1), i > 0],
      ['Move Right', () => this.moveSheet(1), i < wb.sheets.length - 1],
    ]);
  }

  deleteSheet(): void {
    const wb = this.wb;
    if (!wb) return;
    const s = wb.sheet;
    if (wb.sheets.length < 2) { this.host.flash('A workbook needs at least one sheet.'); return; }
    wb.edit('Delete sheet', () => wb.removeSheet(s), this.place());
    this.metricsKey = '';
    this.renderTabs();
    this.restoreScroll();
    this.render();
    this.host.changed();
  }

  moveSheet(step: number): void {
    const wb = this.wb!;
    const i = wb.active, j = i + step;
    if (j < 0 || j >= wb.sheets.length) return;
    const list = wb.sheets.slice();
    [list[i], list[j]] = [list[j], list[i]];
    wb.edit('Move sheet', () => wb.setSheets(list), this.place());
    wb.active = j;
    this.renderTabs();
  }

  // ---------------------------------------------------------------- selecting

  /** Select a block (the active cell at `active`). */
  select(range: Range, active: Cursor = { r: range.r1, c: range.c1 }, anchor: Cursor = active, reveal = true): void {
    const s = this.sheet;
    if (!s) return;
    const r = normRange({ r1: clampR(range.r1), c1: clampC(range.c1), r2: clampR(range.r2), c2: clampC(range.c2) });
    this.sels.set(s, { active: { r: clampR(active.r), c: clampC(active.c) }, anchor: { r: clampR(anchor.r), c: clampC(anchor.c) }, range: r });
    if (r.r2 + 30 > this.extentRows || r.c2 + 8 > this.extentCols) { this.metricsKey = ''; }
    if (reveal) this.reveal(active.r, active.c);
    this.render();
    this.host.changed();
  }

  selectCell(r: number, c: number): void {
    const s = this.sheet!;
    const m = s.mergeAt(r, c);
    this.select(m ?? { r1: r, c1: c, r2: r, c2: c }, { r: m?.r1 ?? r, c: m?.c1 ?? c });
  }

  /** Grow the selection from its anchor to a cell. */
  private extendTo(r: number, c: number, reveal = true): void {
    const sel = this.sel;
    const range = growToMerges(this.sheet!, { r1: sel.anchor.r, c1: sel.anchor.c, r2: r, c2: c });
    this.select(range, sel.active, sel.anchor, false);
    if (reveal) this.reveal(r, c);
  }

  /** Ctrl+A: the table around the active cell, then the whole sheet. */
  selectAll(): void {
    const s = this.sheet!;
    const sel = this.sel;
    const region = s.currentRegion(sel.active.r, sel.active.c);
    const isOne = region.r1 === region.r2 && region.c1 === region.c2;
    if (!isOne && !sameRange(region, sel.range)) this.select(region, sel.active, sel.active, false);
    else this.select({ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }, sel.active, sel.active, false);
  }

  selectRows(): void {
    const sel = this.sel;
    this.select({ r1: sel.range.r1, c1: 0, r2: sel.range.r2, c2: MAX_COLS - 1 }, sel.active, sel.active, false);
  }

  selectCols(): void {
    const sel = this.sel;
    this.select({ r1: 0, c1: sel.range.c1, r2: MAX_ROWS - 1, c2: sel.range.c2 }, sel.active, sel.active, false);
  }

  /** Move the active cell (arrows, Enter, Tab); with `extend`, grow the selection instead. */
  move(dr: number, dc: number, extend = false, jump = false): void {
    const s = this.sheet!;
    const sel = this.sel;
    if (extend) {
      // the moving corner is the one away from the anchor
      const cur = { r: sel.anchor.r === sel.range.r1 ? sel.range.r2 : sel.range.r1, c: sel.anchor.c === sel.range.c1 ? sel.range.c2 : sel.range.c1 };
      const to = jump ? this.edge(cur, dr, dc) : this.step(cur, dr, dc);
      this.extendTo(to.r, to.c);
      return;
    }
    const from = sel.active;
    const to = jump ? this.edge(from, dr, dc) : this.step(from, dr, dc);
    const m = s.mergeAt(to.r, to.c);
    this.select(m ?? { r1: to.r, c1: to.c, r2: to.r, c2: to.c }, { r: m?.r1 ?? to.r, c: m?.c1 ?? to.c });
  }

  /** One cell on, skipping hidden rows and columns and the rest of a merged block. */
  private step(from: Cursor, dr: number, dc: number): Cursor {
    const s = this.sheet!;
    let { r, c } = from;
    const m = s.mergeAt(r, c);
    if (m) {
      if (dr > 0) r = m.r2;
      if (dc > 0) c = m.c2;
      if (dr < 0) r = m.r1;
      if (dc < 0) c = m.c1;
    }
    do { r += dr; c += dc; } while ((dr && s.hiddenRows.has(r)) || (dc && s.hiddenCols.has(c)));
    return { r: clampR(r), c: clampC(c) };
  }

  /** Ctrl+arrow: to the edge of the block of filled cells, or the next filled cell. */
  private edge(from: Cursor, dr: number, dc: number): Cursor {
    const s = this.sheet!;
    const filled = (r: number, c: number) => {
      const v = s.values.get(keyOf(r, c));
      return (v !== undefined && v !== null && v !== '') || !!s.cell(r, c)?.structure;
    };
    let { r, c } = from;
    const limitR = dr > 0 ? Math.max(s.lastRow, r) + 1 : 0, limitC = dc > 0 ? Math.max(s.lastCol, c) + 1 : 0;
    const next = () => { r += dr; c += dc; };
    const inside = () => r >= 0 && c >= 0 && (dr <= 0 || r <= limitR) && (dc <= 0 || c <= limitC) && r < MAX_ROWS && c < MAX_COLS;
    const startFilled = filled(r, c);
    next();
    if (startFilled && inside() && filled(r, c)) {
      while (inside() && filled(r + dr, c + dc)) next();
      return { r: clampR(r), c: clampC(c) };
    }
    while (inside() && !filled(r, c)) next();
    if (!inside()) return dr > 0 || dc > 0 ? { r: dr > 0 ? (s.lastRow < from.r ? MAX_ROWS - 1 : clampR(limitR)) : from.r, c: dc > 0 ? (s.lastCol < from.c ? MAX_COLS - 1 : clampC(limitC)) : from.c } : { r: Math.max(0, r), c: Math.max(0, c) };
    return { r, c };
  }

  // ---------------------------------------------------------------- typing in a cell

  /** Start typing in the active cell: `text` replaces it (typing), or undefined keeps it (F2, double-click). */
  editCell(text?: string): void {
    const s = this.sheet;
    if (!s) return;
    const { r, c } = this.sel.active;
    const cell = s.cell(r, c);
    if (cell?.structure && text === undefined) {
      this.host.editStructure(r, c);
      return;
    }
    const original = s.effectiveInput(r, c) ?? '';
    this.editing = { r, c, mode: text === undefined ? 'edit' : 'enter', original };
    this.input.value = text ?? original;
    this.input.hidden = false;
    this.pointRef = null;
    this.placeInput();
    this.input.focus();
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
    this.host.typing(this.input.value);
    this.render();
  }

  /** Type in the formula bar: the same as typing in the cell. */
  beginFromBar(): void {
    if (!this.editing) {
      const { r, c } = this.sel.active;
      const s = this.sheet!;
      if (s.cell(r, c)?.structure) return;
      this.editing = { r, c, mode: 'edit', original: s.effectiveInput(r, c) ?? '' };
      this.input.value = this.editing.original;
      this.input.hidden = false;
      this.placeInput();
      this.render();
    }
  }

  /** The formula bar's text changed. */
  setTyping(text: string): void {
    if (!this.editing) this.beginFromBar();
    this.input.value = text;
    this.fitInput();
  }

  private placeInput(): void {
    const e = this.editing;
    if (!e) return;
    const rect = this.cellRect(e.r, e.c);
    const inp = this.input;
    if (!rect) { inp.style.left = '-9999px'; return; }
    const style = this.sheet!.styleAt(e.r, e.c);
    inp.style.font = this.font(style);
    inp.style.left = `${rect.x + this.scroller.scrollLeft}px`;
    inp.style.top = `${rect.y + this.scroller.scrollTop}px`;
    inp.style.minWidth = `${rect.w + 1}px`;
    inp.style.minHeight = `${rect.h + 1}px`;
    inp.style.textAlign = style?.align ?? 'left';
    this.fitInput();
  }

  /** The typing box grows to the right as text is typed, like Excel's. */
  private fitInput(): void {
    const inp = this.input;
    const lines = inp.value.split('\n');
    const w = Math.max(...lines.map((l) => this.textWidth(l + 'MM', inp.style.font || this.font(undefined))));
    inp.style.width = `${Math.min(w + 8, this.scroller.clientWidth * 0.8)}px`;
    inp.style.height = 'auto';
    inp.style.height = `${inp.scrollHeight}px`;
  }

  /** Put what was typed into the cell. False when nothing was being typed. */
  commitEdit(dr = 0, dc = 0, allSelected = false): boolean {
    const e = this.editing;
    const wb = this.wb;
    if (!e || !wb) return false;
    const s = wb.sheet;
    const text = this.input.value;
    this.editing = null;
    this.pointRef = null;
    this.input.hidden = true;
    this.copied = null;
    if (text !== e.original) {
      const sel = this.sel.range;
      wb.edit('Typing', () => {
        if (allSelected) {
          // Ctrl+Enter: the same typing in every selected cell (formulas move with each cell)
          const block = { rows: 1, cols: 1, cells: [[{ input: text }]], origin: { row: e.r, col: e.c } };
          for (let r = sel.r1; r <= Math.min(sel.r2, Math.max(s.lastRow, e.r) + 1); r++) for (let c = sel.c1; c <= Math.min(sel.c2, Math.max(s.lastCol, e.c) + 1); c++) {
            if (text.startsWith('=')) s.paste({ row: r, col: c }, block, 'values');
            else s.setInput(r, c, text);
          }
        } else this.typeInto(s, e.r, e.c, text);
      }, this.place());
      this.metricsKey = '';
    }
    this.host.typing(null);
    this.scroller.focus({ preventScroll: true });
    if (dr || dc) this.moveWithin(dr, dc);
    else this.render();
    this.host.changed();
    return true;
  }

  /** Typing into a property column puts back its own formula when the typing is that formula, or nothing at all. */
  private typeInto(s: Sheet, r: number, c: number, text: string): void {
    const def = s.colDefs.get(c);
    const cell = s.cell(r, c);
    if (def && r >= def.firstRow && !text) {
      // emptying a typed-over value brings the calculated one back
      s.setCell(r, c, { style: cell?.style });
      return;
    }
    s.setInput(r, c, text);
  }

  cancelEdit(): void {
    if (!this.editing) return;
    this.editing = null;
    this.pointRef = null;
    this.input.hidden = true;
    this.host.typing(null);
    if (document.activeElement === this.input) this.scroller.focus({ preventScroll: true });
    this.render();
  }

  /** Enter and Tab move within a selected block, as in Excel; otherwise one cell on. */
  private moveWithin(dr: number, dc: number): void {
    const sel = this.sel;
    const R = sel.range;
    if (R.r1 === R.r2 && R.c1 === R.c2 || this.sheet!.mergeAt(sel.active.r, sel.active.c) && sameRange(this.sheet!.mergeAt(sel.active.r, sel.active.c)!, R)) {
      // as in Excel, Enter after typing across a row with Tab goes to the next row's first cell
      const a = sel.active, t = this.tabStart;
      const carry = t && t.sheet === this.sheet && t.at.r === a.r && t.at.c === a.c;
      this.tabStart = null;
      if (dc && !dr) {
        const start = carry ? t.c : a.c;
        this.move(0, dc);
        this.tabStart = { sheet: this.sheet!, c: start, at: { ...this.sel.active } };
      } else if (dr === 1 && carry) this.selectCell(a.r + 1, t.c);
      else this.move(dr, dc);
      return;
    }
    let { r, c } = sel.active;
    if (dr) {
      r += dr;
      if (r > R.r2) { r = R.r1; c = c + 1 > R.c2 ? R.c1 : c + 1; }
      if (r < R.r1) { r = R.r2; c = c - 1 < R.c1 ? R.c2 : c - 1; }
    } else {
      c += dc;
      if (c > R.c2) { c = R.c1; r = r + 1 > R.r2 ? R.r1 : r + 1; }
      if (c < R.c1) { c = R.c2; r = r - 1 < R.r1 ? R.r2 : r - 1; }
    }
    this.sels.set(this.sheet!, { ...sel, active: { r, c } });
    this.reveal(r, c);
    this.render();
    this.host.changed();
  }

  /** Where typing across a row with Tab started (Enter goes back to that column on the next row). */
  private tabStart: { sheet: Sheet; c: number; at: Cursor } | null = null;

  /** Is the typing at a place where clicking a cell should put its address in (a formula, after an operator)? */
  private pointing(): boolean {
    if (!this.editing) return false;
    const v = this.input.value;
    if (!v.startsWith('=')) return false;
    if (this.pointRef) return true;
    const before = v.slice(0, this.input.selectionStart ?? v.length).trimEnd();
    return /[=(,+\-*/^&<>:]$/.test(before);
  }

  /** Put a reference in the formula being typed, replacing the one put in by the last click. */
  private putRef(range: Range): void {
    const inp = this.input;
    const text = rangeName(range);
    const at = this.pointRef ?? { start: inp.selectionStart ?? inp.value.length, end: inp.selectionEnd ?? inp.value.length };
    inp.value = inp.value.slice(0, at.start) + text + inp.value.slice(at.end);
    this.pointRef = { start: at.start, end: at.start + text.length };
    inp.setSelectionRange(this.pointRef.end, this.pointRef.end);
    this.fitInput();
    this.host.typing(inp.value);
  }

  // ---------------------------------------------------------------- keys

  private onInputKey(e: KeyboardEvent): void {
    e.stopPropagation();
    const ed = this.editing;
    if (!ed) return;
    const k = e.key;
    if (k === 'Enter' && e.altKey) {
      // a new line in the cell
      e.preventDefault();
      const inp = this.input;
      const p = inp.selectionStart ?? inp.value.length;
      inp.value = inp.value.slice(0, p) + '\n' + inp.value.slice(inp.selectionEnd ?? p);
      inp.setSelectionRange(p + 1, p + 1);
      this.fitInput();
      this.host.typing(inp.value);
      return;
    }
    if (k === 'Enter') { e.preventDefault(); this.commitEdit(e.ctrlKey || e.metaKey ? 0 : e.shiftKey ? -1 : 1, 0, e.ctrlKey || e.metaKey); return; }
    if (k === 'Tab') { e.preventDefault(); this.commitEdit(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Escape') { e.preventDefault(); this.cancelEdit(); return; }
    if (k === 'F2') { e.preventDefault(); ed.mode = ed.mode === 'enter' ? 'edit' : 'enter'; return; }
    if (ed.mode === 'enter' && /^Arrow/.test(k) && !this.pointing()) {
      e.preventDefault();
      const [dr, dc] = k === 'ArrowUp' ? [-1, 0] : k === 'ArrowDown' ? [1, 0] : k === 'ArrowLeft' ? [0, -1] : [0, 1];
      this.commitEdit(dr, dc);
      return;
    }
    this.pointRef = null;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.wb || e.defaultPrevented) return;
    if (e.target !== this.scroller) return;
    if (this.chartSel !== null && this.chartKey(e)) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k] && !e.altKey) {
      e.preventDefault();
      this.move(arrows[k][0], arrows[k][1], e.shiftKey, ctrl);
      return;
    }
    if (k === 'Enter' && !ctrl && !e.altKey) { e.preventDefault(); this.moveWithin(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'Tab' && !ctrl && !e.altKey) { e.preventDefault(); this.moveWithin(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Home' && !e.altKey) {
      e.preventDefault();
      const { fr, fc } = this.frozen();
      if (ctrl) this.selectCell(fr, fc);
      else if (e.shiftKey) this.extendTo(this.sel.active.r, 0);
      else this.selectCell(this.sel.active.r, 0);
      return;
    }
    if (k === 'End' && ctrl) {
      e.preventDefault();
      const s = this.sheet!;
      this.selectCell(Math.max(0, s.lastRow), Math.max(0, s.lastCol));
      return;
    }
    if ((k === 'PageDown' || k === 'PageUp') && !e.altKey) {
      e.preventDefault();
      if (ctrl) { this.goSheet(this.wb.active + (k === 'PageDown' ? 1 : -1)); return; }
      const page = Math.max(1, Math.floor(this.scroller.clientHeight / (DEFAULT_ROW_H * this.zoom)) - 2);
      this.move(k === 'PageDown' ? page : -page, 0, e.shiftKey);
      this.scroller.scrollTop += (k === 'PageDown' ? 1 : -1) * (this.scroller.clientHeight - HEADER_H - 40);
      return;
    }
    if (k === 'F2') { e.preventDefault(); this.editCell(); return; }
    if (k === 'Escape') {
      if (this.copied) { this.copied = null; this.render(); }
      if (!this.findBar.hidden) this.closeFind();
      return;
    }
    if (k === ' ' && ctrl && !e.shiftKey) { e.preventDefault(); this.selectCols(); return; }
    if (k === ' ' && e.shiftKey && !ctrl) { e.preventDefault(); this.selectRows(); return; }
    if (k === 'Backspace' && !ctrl && !e.altKey) {
      e.preventDefault();
      const { r, c } = this.sel.active;
      if (this.sheet!.cell(r, c)?.structure) { this.clearSelection(); return; }
      this.editCell('');
      return;
    }
    if (k === 'Delete' && !ctrl && !e.altKey) { e.preventDefault(); this.clearSelection(); return; }
    // menu commands and hotkeys (Ctrl+C, Ctrl+B, Ctrl+D…)
    if (this.host.key(e)) { e.preventDefault(); return; }
    // a character starts typing in the cell
    if (k.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      const { r, c } = this.sel.active;
      if (this.sheet!.cell(r, c)?.structure) {
        this.host.flash('This cell holds a structure: double-click to change it, or press Delete first to type here.');
        return;
      }
      this.editCell(k);
    }
  }

  /** Delete: empty the selected cells (keeping their formatting). */
  clearSelection(): void {
    const wb = this.wb!;
    const s = wb.sheet;
    const r = this.sel.range;
    wb.edit('Clear', () => s.clear(r, 'contents'), this.place());
    this.copied = null;
    this.metricsKey = '';
    this.render();
  }

  // ---------------------------------------------------------------- the mouse

  private viewPoint(e: MouseEvent): { x: number; y: number } {
    const b = this.scroller.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  /** Near a column or row border on the headers (for resizing): which one. */
  private borderAt(x: number, y: number): { kind: 'col' | 'row'; index: number } | null {
    const { FW, FH } = this.frozen();
    if (y < HEADER_H && x > HEADER_W) {
      const gx = x - HEADER_W;
      const sheetX = gx < FW ? gx : gx + this.scroller.scrollLeft;
      const c = this.cols.at(sheetX);
      const left = this.cols.pos(c), right = this.cols.pos(c + 1);
      if (right - sheetX <= 4) return { kind: 'col', index: c };
      if (sheetX - left <= 3 && c > 0) {
        let p = c - 1;
        while (p > 0 && this.cols.size(p) === 0) p--;
        return { kind: 'col', index: p };
      }
    }
    if (x < HEADER_W && y > HEADER_H) {
      const gy = y - HEADER_H;
      const sheetY = gy < FH ? gy : gy + this.scroller.scrollTop;
      const r = this.rows.at(sheetY);
      const top = this.rows.pos(r), bottom = this.rows.pos(r + 1);
      if (bottom - sheetY <= 3) return { kind: 'row', index: r };
      if (sheetY - top <= 2 && r > 0) return { kind: 'row', index: r - 1 };
    }
    return null;
  }

  /** On the fill handle (the small square at the selection's corner)? */
  private onFillHandle(x: number, y: number): boolean {
    const R = growToMerges(this.sheet!, this.sel.range);
    const rect = this.cellRect(R.r2, R.c2);
    if (!rect) return false;
    const hx = rect.x + rect.w, hy = rect.y + rect.h;
    const m = this.sheet!.mergeAt(R.r2, R.c2);
    if (m) return false;
    return Math.abs(x - hx) <= 5 && Math.abs(y - hy) <= 5 && R.r2 < MAX_ROWS - 1;
  }

  private onDown(e: PointerEvent): void {
    if (!this.wb || e.button !== 0) return;
    if ((e.target as HTMLElement) === this.input) return;
    const { x, y } = this.viewPoint(e);
    if (x > this.scroller.clientWidth || y > this.scroller.clientHeight) return; // the scroll bars
    e.preventDefault();
    const fb = this.filterButtonAt(x, y);
    if (fb !== null) {
      this.commitEdit();
      const rect = this.cellRect(this.sheet!.filter!.range.r1, fb)!;
      const b = this.scroller.getBoundingClientRect();
      this.host.filterMenu(fb, { x: b.left + rect.x + rect.w - 16, y: b.top + rect.y + rect.h });
      return;
    }
    const onChart = this.pointing() ? null : this.chartAt(x, y);
    if (onChart) {
      this.commitEdit();
      this.scroller.focus({ preventScroll: true });
      this.scroller.setPointerCapture(e.pointerId);
      this.pickChart(onChart.chart.id);
      this.drag = { kind: 'chart', pointer: e.pointerId, id: onChart.chart.id, how: onChart.how, series: onChart.series, x0: x, y0: y, orig: onChart.chart, moved: false };
      return;
    }
    if (this.chartSel !== null) this.pickChart(null);
    const border = this.borderAt(x, y);
    if (border) {
      this.commitEdit();
      this.scroller.setPointerCapture(e.pointerId);
      const s = this.sheet!;
      if (border.kind === 'col') this.drag = { kind: 'resize-col', col: border.index, start: x, size: this.colWidth(border.index), orig: s.colWidths.get(border.index), pointer: e.pointerId };
      else this.drag = { kind: 'resize-row', row: border.index, start: y, size: this.rowHeight(border.index), orig: s.rowHeights.get(border.index), pointer: e.pointerId };
      return;
    }
    const h = this.hit(x, y);
    if (this.pointing() && h.where === 'cell') {
      this.scroller.setPointerCapture(e.pointerId);
      this.drag = { kind: 'point', pointer: e.pointerId, start: { r: h.r, c: h.c } };
      this.putRef({ r1: h.r, c1: h.c, r2: h.r, c2: h.c });
      this.input.focus();
      return;
    }
    if (!this.editing) this.scroller.focus({ preventScroll: true });
    if (h.where === 'cell' && !this.editing && this.onFillHandle(x, y)) {
      this.scroller.setPointerCapture(e.pointerId);
      const src = growToMerges(this.sheet!, this.sel.range);
      this.drag = { kind: 'fill', src, to: src, pointer: e.pointerId, ctrl: e.ctrlKey || e.altKey };
      return;
    }
    this.commitEdit();
    this.scroller.setPointerCapture(e.pointerId);
    if (h.where === 'corner') { this.select({ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }, this.sel.active, this.sel.active, false); return; }
    if (h.where === 'col') {
      if (e.shiftKey) this.select({ r1: 0, c1: Math.min(this.sel.anchor.c, h.c), r2: MAX_ROWS - 1, c2: Math.max(this.sel.anchor.c, h.c) }, this.sel.active, this.sel.anchor, false);
      else this.select({ r1: 0, c1: h.c, r2: MAX_ROWS - 1, c2: h.c }, { r: this.firstVisibleRow(), c: h.c }, { r: 0, c: h.c }, false);
      this.drag = { kind: 'cols', pointer: e.pointerId };
      return;
    }
    if (h.where === 'row') {
      if (e.shiftKey) this.select({ r1: Math.min(this.sel.anchor.r, h.r), c1: 0, r2: Math.max(this.sel.anchor.r, h.r), c2: MAX_COLS - 1 }, this.sel.active, this.sel.anchor, false);
      else this.select({ r1: h.r, c1: 0, r2: h.r, c2: MAX_COLS - 1 }, { r: h.r, c: this.firstVisibleCol() }, { r: h.r, c: 0 }, false);
      this.drag = { kind: 'rows', pointer: e.pointerId };
      return;
    }
    if (e.shiftKey) this.extendTo(h.r, h.c, false);
    else this.selectCell(h.r, h.c);
    this.drag = { kind: 'select', pointer: e.pointerId };
  }

  private firstVisibleRow(): number {
    return this.rows.at(this.scroller.scrollTop + this.frozen().FH);
  }

  private firstVisibleCol(): number {
    return this.cols.at(this.scroller.scrollLeft + this.frozen().FW);
  }

  private onMove(e: PointerEvent): void {
    if (!this.wb) return;
    const { x, y } = this.viewPoint(e);
    const d = this.drag;
    if (!d) {
      // cursors and tips
      const ch = this.chartAt(x, y);
      if (ch) {
        const cur: Record<string, string> = { move: 'move', label: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
        this.scroller.style.cursor = this.chartSel === ch.chart.id ? cur[ch.how] : 'pointer';
        if (this.hoverTip) { this.hoverTip = ''; this.scroller.title = ''; }
        return;
      }
      const border = this.borderAt(x, y);
      const h = this.hit(x, y);
      this.scroller.style.cursor = border ? (border.kind === 'col' ? 'col-resize' : 'row-resize')
        : this.filterButtonAt(x, y) !== null ? 'pointer'
          : !this.editing && h.where === 'cell' && this.onFillHandle(x, y) ? 'crosshair'
            : h.where === 'col' ? 's-resize' : h.where === 'row' ? 'e-resize'
              // a structure: a hand, since a double-click opens it for drawing
              : h.where === 'cell' && this.sheet?.cell(h.r, h.c)?.structure ? 'pointer' : 'cell';
      const tip = h.where === 'cell' ? this.tipFor(h.r, h.c) : '';
      if (tip !== this.hoverTip) { this.hoverTip = tip; this.scroller.title = tip; }
      return;
    }
    if (e.pointerId !== d.pointer) return;
    if (d.kind === 'chart') { this.dragChart(d, x, y); return; }
    this.autoScroll(x, y);
    const h = this.hit(Math.max(HEADER_W + 1, x), Math.max(HEADER_H + 1, y));
    switch (d.kind) {
      case 'select': this.extendTo(h.r, h.c, false); break;
      case 'cols': this.select({ r1: 0, c1: Math.min(this.sel.anchor.c, h.c), r2: MAX_ROWS - 1, c2: Math.max(this.sel.anchor.c, h.c) }, this.sel.active, this.sel.anchor, false); break;
      case 'rows': this.select({ r1: Math.min(this.sel.anchor.r, h.r), c1: 0, r2: Math.max(this.sel.anchor.r, h.r), c2: MAX_COLS - 1 }, this.sel.active, this.sel.anchor, false); break;
      case 'resize-col': {
        const w = Math.max(0, d.size + (x - d.start) / this.zoom);
        this.previewSize('col', d.col, w);
        break;
      }
      case 'resize-row': {
        const hh = Math.max(0, d.size + (y - d.start) / this.zoom);
        this.previewSize('row', d.row, hh);
        break;
      }
      case 'fill': {
        // fill goes one way: down, up, right or left, whichever the pointer has gone furthest
        const s = d.src;
        const downBy = h.r - s.r2, upBy = s.r1 - h.r, rightBy = h.c - s.c2, leftBy = s.c1 - h.c;
        const best = Math.max(downBy, upBy, rightBy, leftBy);
        let to = s;
        if (best > 0) {
          if (best === downBy) to = { ...s, r2: h.r };
          else if (best === upBy) to = { ...s, r1: h.r };
          else if (best === rightBy) to = { ...s, c2: h.c };
          else to = { ...s, c1: h.c };
        }
        d.to = to;
        d.ctrl = e.ctrlKey || e.altKey;
        this.render();
        break;
      }
      case 'point': {
        this.putRef(normRange({ r1: d.start.r, c1: d.start.c, r2: h.r, c2: h.c }));
        break;
      }
    }
  }

  private sizePreview: { kind: 'col' | 'row'; index: number; size: number } | null = null;

  private previewSize(kind: 'col' | 'row', index: number, size: number): void {
    this.sizePreview = { kind, index, size };
    const s = this.sheet!;
    // show it at once, without recording each step
    const map = kind === 'col' ? s.colWidths : s.rowHeights;
    map.set(index, Math.round(size));
    this.metricsKey = '';
    this.render();
    this.host.flash(kind === 'col' ? `Width: ${Math.round(size)} pixels` : `Height: ${Math.round(size)} pixels`, 800);
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    if (this.scroller.hasPointerCapture(e.pointerId)) this.scroller.releasePointerCapture(e.pointerId);
    const wb = this.wb!;
    const s = wb.sheet;
    if (d.kind === 'chart') {
      const p = this.chartPreview;
      this.chartPreview = null;
      if (p && d.moved) this.replaceChart(p, d.how === 'move' ? 'Move chart' : d.how === 'label' ? 'Move equation' : 'Resize chart');
      this.render();
      return;
    }
    if ((d.kind === 'resize-col' || d.kind === 'resize-row') && this.sizePreview) {
      const p = this.sizePreview;
      this.sizePreview = null;
      const map = p.kind === 'col' ? s.colWidths : s.rowHeights;
      // put the old size back so the change is recorded (and undoable)
      if (d.orig === undefined) map.delete(p.index);
      else map.set(p.index, d.orig);
      const sel = this.sel.range;
      const whole = p.kind === 'col' ? sel.r1 === 0 && sel.r2 >= MAX_ROWS - 1 && p.index >= sel.c1 && p.index <= sel.c2 : sel.c1 === 0 && sel.c2 >= MAX_COLS - 1 && p.index >= sel.r1 && p.index <= sel.r2;
      wb.edit(p.kind === 'col' ? 'Column width' : 'Row height', () => {
        // with several whole columns (or rows) selected, they all get the new size
        const from = whole ? (p.kind === 'col' ? sel.c1 : sel.r1) : p.index, to = whole ? (p.kind === 'col' ? Math.min(sel.c2, s.lastCol + 1) : Math.min(sel.r2, s.lastRow + 1)) : p.index;
        for (let i = from; i <= Math.max(from, to); i++) {
          if (p.kind === 'col') s.setColWidth(i, p.size);
          else s.setRowHeight(i, p.size);
        }
      }, this.place());
      this.metricsKey = '';
      this.render();
    } else if (d.kind === 'fill' && !sameRange(d.src, d.to)) {
      const src = d.src;
      const nums = [];
      for (let r = src.r1; r <= src.r2; r++) for (let c = src.c1; c <= src.c2; c++) nums.push(readTyped(s.effectiveInput(r, c) ?? '').value);
      // as in Excel: a single number is copied (Ctrl counts on), anything else counts on (Ctrl copies)
      const single = nums.length === 1 && typeof nums[0] === 'number';
      const series = single ? d.ctrl : !d.ctrl;
      wb.edit('Fill', () => s.fill(src, d.to, series), this.place(), () => ({ sheet: s, sel: d.to }));
      this.select(d.to, this.sel.active, this.sel.anchor, false);
    } else if (d.kind === 'point') {
      this.input.focus();
    }
    this.render();
  }

  private autoScroll(x: number, y: number): void {
    const sc = this.scroller;
    const step = 18;
    if (y > sc.clientHeight - 10) sc.scrollTop += step;
    else if (y < HEADER_H + 4 && sc.scrollTop > 0) sc.scrollTop -= step;
    if (x > sc.clientWidth - 10) sc.scrollLeft += step;
    else if (x < HEADER_W + 4 && sc.scrollLeft > 0) sc.scrollLeft -= step;
  }

  private onDouble(e: MouseEvent): void {
    if (!this.wb) return;
    const { x, y } = this.viewPoint(e);
    const onChart = this.chartAt(x, y);
    if (onChart) { this.host.editChart?.(onChart.chart.id); return; }
    const border = this.borderAt(x, y);
    if (border) { this.autoFit(border.kind, border.index); return; }
    const h = this.hit(x, y);
    if (h.where !== 'cell') return;
    if (this.onFillHandle(x, y)) { this.fillToEnd(); return; }
    this.selectCell(h.r, h.c);
    const s = this.sheet!;
    const m = s.mergeAt(h.r, h.c);
    if (s.cell(m?.r1 ?? h.r, m?.c1 ?? h.c)?.structure) this.host.editStructure(m?.r1 ?? h.r, m?.c1 ?? h.c);
    else this.editCell();
  }

  /** Double-clicking the fill handle fills down as far as the column beside it has data (Excel's). */
  fillToEnd(): void {
    const wb = this.wb!;
    const s = wb.sheet;
    const src = growToMerges(s, this.sel.range);
    const filled = (r: number, c: number) => {
      const v = s.values.get(keyOf(r, c));
      return (v !== undefined && v !== null && v !== '') || !!s.cell(r, c)?.structure;
    };
    let end = src.r2;
    for (const c of [src.c1 - 1, src.c2 + 1]) {
      if (c < 0) continue;
      let r = src.r2;
      while (r + 1 <= s.lastRow + 1 && filled(r + 1, c)) r++;
      end = Math.max(end, r);
    }
    if (end === src.r2) return;
    const to = { ...src, r2: end };
    wb.edit('Fill', () => s.fill(src, to, false), this.place(), () => ({ sheet: s, sel: to }));
    this.select(to, this.sel.active, this.sel.anchor, false);
  }

  /** Make a column as wide (or a row as tall) as its contents need. */
  autoFit(kind: 'col' | 'row', index: number): void {
    const wb = this.wb!;
    const s = wb.sheet;
    if (kind === 'row') {
      wb.edit('Row height', () => s.setRowHeight(index, undefined), this.place());
      this.metricsKey = '';
      this.render();
      return;
    }
    let w = 0;
    for (const k of s.keysIn({ r1: 0, c1: index, r2: Math.max(0, s.lastRow), c2: index })) {
      const r = rowOf(k);
      const c = s.cells.get(k)!;
      const style = s.styleAt(r, index);
      if (c.structure) w = Math.max(w, this.host.structureBox(c.structure).w * STRUCTURE_SCALE + 2 * PAD);
      else w = Math.max(w, (style?.chem ? this.piecesWidth(s.shownText(r, index), style) / this.zoom : this.textWidth(s.shownText(r, index), this.font(style, 1))) + 10);
    }
    // property columns: their worked-out values count too
    if (s.colDefs.has(index)) for (let r = 0; r <= s.lastDataRow; r++) {
      const style = s.styleAt(r, index);
      w = Math.max(w, this.textWidth(s.shownText(r, index), this.font(style, 1)) + 10);
    }
    wb.edit('Column width', () => s.setColWidth(index, Math.max(24, Math.min(600, w || DEFAULT_COL_W))), this.place());
    this.metricsKey = '';
    this.render();
  }

  private onContext(e: MouseEvent): void {
    e.preventDefault();
    if (!this.wb) return;
    const { x, y } = this.viewPoint(e);
    const onChart = this.chartAt(x, y);
    if (onChart) {
      this.commitEdit();
      this.pickChart(onChart.chart.id);
      this.host.contextMenu(e.clientX, e.clientY, 'chart');
      return;
    }
    const h = this.hit(x, y);
    this.commitEdit();
    const R = this.sel.range;
    if (h.where === 'cell' && !inRange(R, h.r, h.c)) this.selectCell(h.r, h.c);
    if (h.where === 'col' && !(h.c >= R.c1 && h.c <= R.c2 && R.r1 === 0 && R.r2 >= MAX_ROWS - 1)) this.select({ r1: 0, c1: h.c, r2: MAX_ROWS - 1, c2: h.c }, { r: 0, c: h.c });
    if (h.where === 'row' && !(h.r >= R.r1 && h.r <= R.r2 && R.c1 === 0 && R.c2 >= MAX_COLS - 1)) this.select({ r1: h.r, c1: 0, r2: h.r, c2: MAX_COLS - 1 }, { r: h.r, c: 0 });
    this.host.contextMenu(e.clientX, e.clientY, h.where === 'col' ? 'col' : h.where === 'row' ? 'row' : 'cell');
  }

  private onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
    this.metricsKey = '';
    this.render();
    this.host.flash(`Zoom ${Math.round(this.zoom * 100)}%`, 900);
  }

  /** A tip for a cell: an error's reason, or that a value was typed over a calculated one. */
  private tipFor(r: number, c: number): string {
    const s = this.sheet!;
    const v = s.values.get(keyOf(r, c));
    if (isError(v)) {
      const f = s.formulas.get(keyOf(r, c));
      const problem = f ? this.wb!.formulaProblem(f) : null;
      return `${(v as CellError).code}: ${problem ?? (v as CellError).detail}`;
    }
    if (s.isOverride(r, c)) return 'A value typed over the calculated one (right-click > Reset to Calculated puts it back)';
    if (s.cell(r, c)?.structure) return 'Double-click to change the structure';
    return '';
  }

  focus(): void {
    if (this.sheet?.dashboard) this.dash.el.focus({ preventScroll: true });
    else if (this.editing) this.input.focus();
    else this.scroller.focus({ preventScroll: true });
  }

  get hasFocus(): boolean {
    return this.el.contains(document.activeElement);
  }

  // ---------------------------------------------------------------- find

  private buildFindBar(): void {
    const bar = this.findBar;
    bar.innerHTML = `<label>Find <input type="search" class="sh-find-text" aria-label="Find in the sheet" /></label>
      <button type="button" data-act="prev" title="Find the one before (Shift+Enter)">↑</button>
      <button type="button" data-act="next" title="Find the next (Enter)">↓</button>
      <span class="sh-find-count muted"></span>
      <button type="button" data-act="close" title="Close (Esc)">×</button>`;
    const box = bar.querySelector<HTMLInputElement>('.sh-find-text')!;
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.findNext(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
    });
    box.addEventListener('input', () => this.findNext(0));
    bar.querySelector('[data-act=next]')!.addEventListener('click', () => this.findNext(1));
    bar.querySelector('[data-act=prev]')!.addEventListener('click', () => this.findNext(-1));
    bar.querySelector('[data-act=close]')!.addEventListener('click', () => this.closeFind());
  }

  openFind(): void {
    this.findBar.hidden = false;
    const box = this.findBar.querySelector<HTMLInputElement>('.sh-find-text')!;
    box.focus();
    box.select();
  }

  closeFind(): void {
    this.findBar.hidden = true;
    this.focus();
  }

  /** Go to the next cell (in reading order) whose text or formula has the words looked for. */
  private findNext(dir: -1 | 0 | 1): void {
    const s = this.sheet;
    if (!s) return;
    const want = this.findBar.querySelector<HTMLInputElement>('.sh-find-text')!.value.trim().toLowerCase();
    const count = this.findBar.querySelector('.sh-find-count')!;
    if (!want) { count.textContent = ''; return; }
    const keys = new Set<number>([...s.cells.keys(), ...s.values.keys()]);
    const hits = [...keys].filter((k) => {
      const r = rowOf(k), c = colOf(k);
      const text = `${s.shownText(r, c)}\u0000${s.cell(r, c)?.input ?? ''}`.toLowerCase();
      return text.includes(want);
    }).sort((a, b) => a - b);
    count.textContent = hits.length ? `${hits.length} found` : 'Not found';
    if (!hits.length) return;
    const cur = keyOf(this.sel.active.r, this.sel.active.c);
    let k: number;
    if (dir === 0) k = hits.find((x) => x >= cur) ?? hits[0];
    else if (dir > 0) k = hits.find((x) => x > cur) ?? hits[0];
    else k = [...hits].reverse().find((x) => x < cur) ?? hits[hits.length - 1];
    this.selectCell(rowOf(k), colOf(k));
  }
}

const clampR = (r: number) => Math.max(0, Math.min(MAX_ROWS - 1, r));
const clampC = (c: number) => Math.max(0, Math.min(MAX_COLS - 1, c));
const sameRange = (a: Range, b: Range) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;

/** A small menu at a point: [label, action, enabled?] items, null for a line. */
export function popupMenu(x: number, y: number, items: ([string, () => void, boolean?] | null)[]): HTMLDivElement {
  document.querySelector('.popup-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'menu popup-menu';
  m.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) { m.append(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = it[0];
    b.disabled = it[2] === false;
    b.addEventListener('click', () => { m.remove(); it[1](); });
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    if (e instanceof PointerEvent && m.contains(e.target as Node)) return;
    m.remove();
    document.removeEventListener('pointerdown', close, true);
    document.removeEventListener('keydown', close, true);
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
  });
  m.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  m.addEventListener('keydown', (e) => {
    const list = [...m.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  });
  return m;
}

/** The text a reference for the selection reads as in the name box (B3, or A1:C5). */
export function selectionName(range: Range): string {
  if (range.r1 === 0 && range.r2 >= MAX_ROWS - 1 && range.c1 === 0 && range.c2 >= MAX_COLS - 1) return 'All';
  if (range.r1 === 0 && range.r2 >= MAX_ROWS - 1) return `${colName(range.c1)}:${colName(range.c2)}`;
  if (range.c1 === 0 && range.c2 >= MAX_COLS - 1) return `${range.r1 + 1}:${range.r2 + 1}`;
  return rangeName(range);
}

export { cellName, normalizeFormula, formulaRefs, countOn };
