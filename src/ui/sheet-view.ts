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
import { chemPieces, showsChem } from '../sheet/cell-text';
import { DEFAULT_COL_W, DEFAULT_ROW_H, STRUCTURE_SCALE, STRUCTURE_PAD, MAX_AUTO_ROW, structureHeight, structurePlace } from '../sheet/layout';
import { formulaRefs, normalizeFormula } from '../sheet/formula';
import { Chart, chartData } from '../sheet/chart';
import { drawChart, partHit, ChartHits, Box } from '../render/chart-draw';
import { DashboardView } from './dashboard-view';
import { newDashboard, Tile } from '../sheet/dashboard';
import { Validation, passes, invalidCells } from '../sheet/validation';
import { followLink, linkTip } from './links-ui';
import { linkOfFormula } from '../links';
import { typingPrefs } from '../text/typing';
import { SheetObject, objectLook, shapePath, arrowHead, lineEnds, isLine } from '../sheet/sheet-objects';
import { sheetPages, sheetSizes } from '../sheet/print-range';
import { breakLines, withSetup, toggleBreak, type PrintPage } from '../sheet/page-setup';
import { defaultPaper } from '../print-layout';
import { BRUSH } from '../editor/cursors';
import { OutlineGroup, outlineGroups, maxLevel, setCollapsed, showLevel } from '../sheet/outline';
import { SparklineGroup, sparkShape, sparkSource, sparklineAt } from '../sheet/sparklines';
import { headerRuns, paperSize, DEFAULT_MARGINS } from '../sheet/page-setup';
import { themeOf } from '../sheet/themes';

/** The row numbers' width and the column letters' height (when shown). */
const HEAD_W = 44;
const HEAD_H = 22;
/** One level of the outline's buttons beside the row numbers or above the column letters. */
const OUTLINE_STEP = 16;
/** The bar between split panes. */
const SPLIT_BAR = 5;
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
  /** More blocks selected with it (Go To Special, Find All, Ctrl+click): typing with Ctrl+Enter, Delete and formatting reach them too. */
  more?: Range[];
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
  /** F3 and its variants (names and Insert Function), in a cell or while typing. */
  f3?(e: KeyboardEvent): void;
  /** The selection, the sheet showing or the cell being typed in changed. */
  changed(): void;
  /** A right-click: what was clicked. */
  contextMenu(x: number, y: number, where: 'cell' | 'row' | 'col' | 'chart' | 'tile' | 'object'): void;
  /** A picture, shape or text box was double-clicked (change its text). */
  editObject?(id: number): void;
  /** A letter typed while a shape is picked starts typing in it. True when it did. */
  typeInObject?(id: number, key: string): boolean;
  /** A dashboard tile was double-clicked (open its settings). */
  openTile?(tile: Tile): void;
  /** A chart was double-clicked (open its settings). */
  editChart?(id: number): void;
  /** The filter button on a header was clicked. */
  filterMenu(col: number, at: { x: number; y: number }): void;
  flash(msg: string, ms?: number): void;
  /** The typing in a cell (or the formula bar) changed. */
  typing(text: string | null): void;
  /** Text was typed into one cell and kept (not a formula). */
  typed?(row: number, col: number, text: string): void;
  /** The pointer is over a cell with a note or comment (null: over none), at this box on the screen. */
  hoverNote?(cell: Cursor | null, box: DOMRect | null): void;
  /** The grid was drawn (notes shown all the time follow it). */
  drawn?(): void;
  /** The drop-down of a cell with a list rule was opened, under this point on the screen. */
  dropDown?(r: number, c: number, at: { x: number; y: number }): void;
  /** Typing broke a cell's data validation rule: what to do about it. */
  invalid?(rule: Validation, text: string): Promise<'retry' | 'keep' | 'cancel'>;
  /** Page Layout view: a header or footer was double-clicked (open the Header and Footer window). */
  headerFooter?(): void;
}

/**
 * Sizes of rows or columns, with the position of each worked out once. In Page Layout view some
 * have a gap before them (the space between pages, and the margins).
 */
class Axis {
  tops: Float64Array;
  sizes: Float64Array;
  constructor(public n: number, size: (i: number) => number, public def: number, gap?: (i: number) => number) {
    this.tops = new Float64Array(n + 1);
    this.sizes = new Float64Array(n);
    let p = gap?.(0) ?? 0;
    for (let i = 0; i < n; i++) {
      this.tops[i] = p;
      const s = size(i);
      this.sizes[i] = s;
      p += s;
      if (gap && i + 1 < n) p += gap(i + 1);
    }
    this.tops[n] = p;
  }
  pos(i: number): number {
    return i <= this.n ? this.tops[i] : this.tops[this.n] + (i - this.n) * this.def;
  }
  size(i: number): number {
    return i < this.n ? this.sizes[i] : this.def;
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
    while (lo < this.n && this.sizes[lo] === 0) lo++;
    return lo;
  }
  limit = MAX_ROWS;
  get total(): number { return this.tops[this.n]; }
}

/** Page Layout view: where pages start along each axis, and the paper and margins in screen pixels. */
interface PageGrid {
  rowStarts: number[];
  colStarts: number[];
  paperW: number;
  paperH: number;
  margins: { left: number; right: number; top: number; bottom: number; header: number; footer: number };
}

/** The space between pages in Page Layout view, in pixels. */
const PAGE_GAP = 18;

/** A part of the grid on the screen: where it is, the sheet position at its corner, the cells it shows, and the rows and columns that belong in it. */
type Region = { x: number; y: number; w: number; h: number; ox: number; oy: number; r1: number; r2: number; c1: number; c2: number; rlo: number; rhi: number; clo: number; chi: number };

type Drag =
  | { kind: 'select'; pointer: number }
  | { kind: 'rows'; pointer: number }
  | { kind: 'cols'; pointer: number }
  | { kind: 'resize-col'; col: number; start: number; size: number; orig: number | undefined; pointer: number }
  | { kind: 'resize-row'; row: number; start: number; size: number; orig: number | undefined; pointer: number }
  | { kind: 'fill'; src: Range; to: Range; pointer: number; ctrl: boolean }
  | { kind: 'point'; pointer: number; start: Cursor }
  | { kind: 'split'; pointer: number; axis: 'row' | 'col' }
  | { kind: 'break'; pointer: number; axis: 'row' | 'col'; from: number }
  | { kind: 'chart'; pointer: number; id: number; how: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'label'; series?: number; x0: number; y0: number; orig: Chart; moved: boolean; picked?: boolean }
  | { kind: 'object'; pointer: number; id: number; how: Handle; x0: number; y0: number; orig: SheetObject; moved: boolean };

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'start' | 'end';
/** Anything floating over the cells: a corner cell and offset, and a size, in pixels at 100%. */
type Floating = { at: Chart['at']; w: number; h: number };

const HANDLE = 7;

export class SheetView {
  wb: Workbook | null = null;
  zoom = 1;
  /** The cell being typed in, if any. 'enter': arrows finish typing (Excel's Enter mode); 'edit': arrows move in the text. */
  editing: { r: number; c: number; mode: 'enter' | 'edit'; original: string } | null = null;
  /** Format Painter, while the brush is held (set by the app): called when a click or drag has picked the cells to paint. */
  painter: (() => void) | null = null;
  /** Cells copied (shown with a dashed border until Esc or the next edit). */
  copied: { sheet: Sheet; range: Range } | null = null;
  /** Called with the reference to put in a formula being typed (pointing at cells). */
  readonly el: HTMLDivElement;
  readonly input: HTMLTextAreaElement;
  readonly scroller: HTMLDivElement;
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
  /** The chart picked (by its id), on the sheet showing. */
  chartSel: number | null = null;
  /** A chart being dragged, drawn in place of the saved one until the drag ends. */
  private chartPreview: Chart | null = null;
  /** The picture, shape or text box picked (by its id). */
  objSel: number | null = null;
  private objPreview: SheetObject | null = null;
  private objImages = new Map<string, HTMLImageElement>();
  /** Page Layout > Page Breaks: the lines where pages end, drawn on the grid. */
  showPageBreaks = false;
  private breakCache: { key: string; rows: Set<number>; cols: Set<number>; manualRows: Set<number>; manualCols: Set<number>; pages: PrintPage[]; innerRows: Set<number>; innerCols: Set<number> } | null = null;
  /** Shows a dashboard sheet in place of the grid. */
  readonly dash: DashboardView;
  private chartCache = new Map<number, { key: string; chart: Chart; canvas: HTMLCanvasElement; hits: ChartHits }>();
  /** The input message of the selected cell's data validation rule. */
  private promptBox: HTMLDivElement;
  /** Notes shown all the time sit in this layer over the cells. */
  readonly noteLayer: HTMLDivElement;
  /** Data > Circle Invalid Data: red rings round cells that break their rules, until cleared. */
  circleInvalid = false;
  private circles: { gen: number; sheet: Sheet; rules: Validation[]; cells: { row: number; col: number }[] } | null = null;
  /** The cell with a note the pointer is over. */
  private hovered: Cursor | null = null;
  /** An alert about typing that broke a rule is showing. */
  private alerting = false;
  /** How far the upper and left panes of a split window are scrolled (pixels on the sheet), by sheet. */
  private paneScroll = new Map<Sheet, { top: number; left: number }>();
  /** The width of the row numbers and the height of the column letters, with the outline's buttons beside them (0 when hidden). */
  private HW = HEAD_W;
  private HH = HEAD_H;
  /** The outline's buttons: their width beside the row numbers and height above the column letters. */
  private OW = 0;
  private OH = 0;
  private rowOutline: OutlineGroup[] = [];
  private colOutline: OutlineGroup[] = [];
  /** Page Layout view: the pages (null in the other views). */
  private pageGrid: PageGrid | null = null;
  /** Page Break Preview: a page break being dragged. */
  private breakPreview: { axis: 'row' | 'col'; at: number } | null = null;
  private sparkCache: { key: string; values: Map<SparklineGroup, (number | null)[][]>; limits: Map<SparklineGroup, { min?: number; max?: number }> } | null = null;

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
    this.promptBox = document.createElement('div');
    this.promptBox.className = 'sh-prompt';
    this.promptBox.hidden = true;
    this.promptBox.setAttribute('role', 'tooltip');
    this.noteLayer = document.createElement('div');
    this.noteLayer.className = 'sh-note-layer';
    this.scroller.append(this.canvas, this.spacer, this.noteLayer, this.input, this.promptBox);
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'sh-tabs';
    this.tabsEl.setAttribute('role', 'tablist');
    this.tabsEl.setAttribute('aria-label', 'Sheets');
    root.append(this.scroller, this.tabsEl);
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
    this.scroller.addEventListener('pointerleave', () => this.setHovered(null));
    this.scroller.addEventListener('pointerup', (e) => this.onUp(e));
    this.scroller.addEventListener('dblclick', (e) => this.onDouble(e));
    this.scroller.addEventListener('contextmenu', (e) => this.onContext(e));
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('keydown', (e) => this.onInputKey(e));
    this.input.addEventListener('input', () => { this.pointRef = null; this.fitInput(); this.host.typing(this.input.value); });
    this.input.addEventListener('pointerdown', (e) => e.stopPropagation());
    new ResizeObserver(() => this.render()).observe(this.scroller);
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
    this.objSel = null;
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
      } else if (style?.rotate && c.input) {
        // turned text: as tall as it reaches
        const text = s.shownText(row, col);
        const lh = this.lineHeight(style);
        if (style.rotate === 255) h = [...text].length * lh + 6;
        else {
          const a = (style.rotate * Math.PI) / 180;
          h = Math.abs(this.textWidth(text, this.font(style, 1)) * Math.sin(a)) + Math.abs(lh * Math.cos(a)) + 6;
        }
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
    // the row numbers and column letters (unless hidden), and the outline's buttons beside them
    const heads = s.viewOpts?.headings !== false;
    const symbols = s.viewOpts?.outlineSymbols !== false;
    const lr = symbols ? maxLevel(s, 'row') : 0, lc = symbols ? maxLevel(s, 'col') : 0;
    this.OW = lr ? (lr + 1) * OUTLINE_STEP + 4 : 0;
    this.OH = lc ? (lc + 1) * OUTLINE_STEP + 4 : 0;
    this.HW = this.OW + (heads ? HEAD_W : this.OH ? OUTLINE_STEP + 4 : 0);
    this.HH = this.OH + (heads ? HEAD_H : this.OW ? OUTLINE_STEP + 4 : 0);
    this.rowOutline = lr ? outlineGroups(s, 'row') : [];
    this.colOutline = lc ? outlineGroups(s, 'col') : [];
    const nr = Math.min(this.extentRows, MAX_ROWS), nc = Math.min(this.extentCols, MAX_COLS);
    const rowSize = (r: number) => (s.hiddenRows.has(r) ? 0 : (s.rowHeights.get(r) ?? auto.get(r) ?? DEFAULT_ROW_H) * z);
    const colSize = (c: number) => (s.hiddenCols.has(c) ? 0 : (s.colWidths.get(c) ?? DEFAULT_COL_W) * z);
    this.pageGrid = s.viewOpts?.layout === 'pageLayout' ? this.pagesFor(s, nr, nc, rowSize, colSize) : null;
    const pg = this.pageGrid;
    const gaps = (starts: number[], size: (i: number) => number, paper: number, before: number, after: number) => {
      const out = new Map<number, number>([[0, PAGE_GAP + before]]);
      let band = 0, k = 1;
      for (let i = 0; i < starts[starts.length - 1]; i++) {
        band += size(i);
        if (i + 1 === starts[k]) { out.set(i + 1, Math.max(PAGE_GAP + before + after, paper + PAGE_GAP - band)); band = 0; k++; }
      }
      return (i: number) => out.get(i) ?? 0;
    };
    this.rows = new Axis(nr, rowSize, DEFAULT_ROW_H * z, pg ? gaps(pg.rowStarts, rowSize, pg.paperH, pg.margins.top, pg.margins.bottom) : undefined);
    this.cols = new Axis(nc, colSize, DEFAULT_COL_W * z, pg ? gaps(pg.colStarts, colSize, pg.paperW, pg.margins.left, pg.margins.right) : undefined);
    this.cols.limit = MAX_COLS;
    // a split window's lower pane is shorter, so it scrolls that much further
    const { x0, y0 } = this.frozen();
    this.spacer.style.width = `${x0 + this.cols.total}px`;
    this.spacer.style.height = `${y0 + this.rows.total}px`;
  }

  /** Page Layout view: pages cut from the paper size, margins and page breaks (at 100%, as the cells show). */
  private pagesFor(s: Sheet, nr: number, nc: number, rowSize: (r: number) => number, colSize: (c: number) => number): PageGrid {
    const ps = s.pageSetup;
    const paper = paperSize(ps, defaultPaper(navigator.language));
    const m = ps?.margins ?? DEFAULT_MARGINS;
    const z = this.zoom, px = (inch: number) => inch * 96 * z;
    const paperW = (paper.w / 0.75) * z, paperH = (paper.h / 0.75) * z;
    const margins = { left: px(m.left), right: px(m.right), top: px(m.top), bottom: px(m.bottom), header: px(m.header), footer: px(m.footer) };
    const cut = (n: number, size: (i: number) => number, room: number, manual: number[] | undefined) => {
      const breaks = new Set(ps?.fit ? [] : manual ?? []);
      const starts = [0];
      let used = 0;
      for (let i = 0; i < n; i++) {
        const sz = size(i);
        if (i > 0 && (breaks.has(i) || (used + sz > room + 0.01 && used > 0))) { starts.push(i); used = 0; }
        used += sz;
      }
      starts.push(n);
      return starts;
    };
    return {
      rowStarts: cut(nr, rowSize, Math.max(20, paperH - margins.top - margins.bottom), ps?.rowBreaks),
      colStarts: cut(nc, colSize, Math.max(20, paperW - margins.left - margins.right), ps?.colBreaks),
      paperW, paperH, margins,
    };
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

  /**
   * Where the panes are. Frozen rows and columns (fr, fc; FH, FW pixels) don't scroll. A split
   * window's upper and left panes (SH, SW pixels) scroll on their own. x0 and y0 are where the
   * part that scrolls with the scroll bars starts on the screen, before frozen rows and columns.
   */
  private frozen(): { fr: number; fc: number; FH: number; FW: number; SH: number; SW: number; x0: number; y0: number } {
    const s = this.sheet!;
    // Page Layout view has no frozen or split panes (as in Excel)
    const paged = s.viewOpts?.layout === 'pageLayout';
    const fr = paged ? 0 : s.frozen.rows, fc = paged ? 0 : s.frozen.cols;
    const sp = !fr && !fc && !paged ? s.split : null;
    const vw = this.scroller.clientWidth || 800, vh = this.scroller.clientHeight || 600;
    // a split pane takes the height of its rows, but leaves room for the pane below it
    const SH = sp?.rows ? Math.max(8, Math.min(this.rows.pos(sp.rows), vh - this.HH - 60)) : 0;
    const SW = sp?.cols ? Math.max(8, Math.min(this.cols.pos(sp.cols), vw - this.HW - 60)) : 0;
    return { fr, fc, FH: this.rows.pos(fr), FW: this.cols.pos(fc), SH, SW, x0: this.HW + (SW ? SW + SPLIT_BAR : 0), y0: this.HH + (SH ? SH + SPLIT_BAR : 0) };
  }

  /** How far a split window's upper and left panes are scrolled. */
  private panes(): { top: number; left: number } {
    const s = this.sheet!;
    let p = this.paneScroll.get(s);
    if (!p) { p = { top: 0, left: 0 }; this.paneScroll.set(s, p); }
    return p;
  }

  /** The parts of the grid: frozen corner, frozen rows, frozen columns and the part that scrolls; or the two or four panes of a split window. */
  private regions(): Region[] {
    const vw = this.scroller.clientWidth, vh = this.scroller.clientHeight;
    const sx = this.scroller.scrollLeft, sy = this.scroller.scrollTop;
    const { fr, fc, FH, FW, SH, SW, x0, y0 } = this.frozen();
    const make = (x: number, y: number, w: number, h: number, ox: number, oy: number, rowsFrom: number, rowsTo: number | null, colsFrom: number, colsTo: number | null): Region => {
      const r1 = rowsTo === null ? this.rows.at(oy) : rowsFrom;
      const r2 = rowsTo === null ? this.rows.at(oy + h) : rowsTo;
      const c1 = colsTo === null ? this.cols.at(ox) : colsFrom;
      const c2 = colsTo === null ? this.cols.at(ox + w) : colsTo;
      return { x, y, w, h, ox, oy, r1: Math.max(r1, rowsFrom), r2, c1: Math.max(c1, colsFrom), c2, rlo: rowsFrom, rhi: rowsTo ?? Infinity, clo: colsFrom, chi: colsTo ?? Infinity };
    };
    const out: Region[] = [];
    const mainW = Math.max(0, vw - x0 - FW), mainH = Math.max(0, vh - y0 - FH);
    out.push(make(x0 + FW, y0 + FH, mainW, mainH, FW + sx, FH + sy, fr, null, fc, null));
    if (fr) out.push(make(x0 + FW, y0, mainW, FH, FW + sx, 0, 0, fr - 1, fc, null));
    if (fc) out.push(make(x0, y0 + FH, FW, mainH, 0, FH + sy, fr, null, 0, fc - 1));
    if (fr && fc) out.push(make(x0, y0, FW, FH, 0, 0, 0, fr - 1, 0, fc - 1));
    // a split: panes in a row scroll up and down together, panes in a column across together
    if (SH || SW) {
      const p = this.panes();
      if (SH) out.push(make(x0, this.HH, mainW, SH, sx, p.top, 0, null, 0, null));
      if (SW) out.push(make(this.HW, y0, SW, mainH, p.left, sy, 0, null, 0, null));
      if (SH && SW) out.push(make(this.HW, this.HH, SW, SH, p.left, p.top, 0, null, 0, null));
    }
    return out;
  }

  /** The part of the grid under a point (by its column alone over the column letters, by its row alone over the row numbers). */
  private regionAt(x: number, y: number, regions = this.regions()): Region {
    const inX = (g: Region) => x >= g.x && x < g.x + g.w, inY = (g: Region) => y >= g.y && y < g.y + g.h;
    if (y < this.HH && x >= this.HW) return regions.find(inX) ?? regions[0];
    if (x < this.HW && y >= this.HH) return regions.find(inY) ?? regions[0];
    return regions.find((g) => inX(g) && inY(g))
      // on a split bar or past the edge: the pane nearest
      ?? regions.find((g) => inX(g) && y >= g.y + g.h - SPLIT_BAR - 1) ?? regions.find((g) => inY(g) && x >= g.x + g.w - SPLIT_BAR - 1) ?? regions[0];
  }

  /** The cell at a point in the grid (view coordinates), and whether it's on a header. */
  private hit(x: number, y: number): { r: number; c: number; where: 'cell' | 'col' | 'row' | 'corner' } {
    const g = this.regionAt(x, y);
    const sheetX = x - g.x + g.ox, sheetY = y - g.y + g.oy;
    const c = this.cols.at(Math.max(0, sheetX)), r = this.rows.at(Math.max(0, sheetY));
    const where = x < this.HW && y < this.HH ? 'corner' : y < this.HH ? 'col' : x < this.HW ? 'row' : 'cell';
    return { r, c, where };
  }

  /** The split bar under a point (to drag), if any. */
  private splitBarAt(x: number, y: number): 'row' | 'col' | null {
    const { SH, SW, x0, y0 } = this.frozen();
    if (SH && y >= y0 - SPLIT_BAR - 1 && y <= y0 + 1 && x >= this.HW) return 'row';
    if (SW && x >= x0 - SPLIT_BAR - 1 && x <= x0 + 1 && y >= this.HH) return 'col';
    return null;
  }

  /** Where a cell is on the screen (view coordinates); null when it's scrolled out of sight. */
  cellRect(r: number, c: number): { x: number; y: number; w: number; h: number } | null {
    this.layout();
    const m = this.sheet?.mergeAt(r, c);
    const w = m ? this.cols.pos(m.c2 + 1) - this.cols.pos(m.c1) : this.cols.size(c);
    const h = m ? this.rows.pos(m.r2 + 1) - this.rows.pos(m.r1) : this.rows.size(r);
    // the pane it belongs in (the one that scrolls first), unless it is scrolled out of sight there
    for (const g of this.regions()) {
      if (r < g.rlo || r > g.rhi || c < g.clo || c > g.chi) continue;
      const x = g.x + this.cols.pos(c) - g.ox, y = g.y + this.rows.pos(r) - g.oy;
      if (x + w < g.x || y + h < g.y) continue;
      return { x, y, w, h };
    }
    return null;
  }

  /** Scroll so a cell can be seen. */
  reveal(r: number, c: number): void {
    this.layout();
    const { fr, fc, FH, FW, x0, y0 } = this.frozen();
    const sc = this.scroller;
    const vw = sc.clientWidth - x0 - FW, vh = sc.clientHeight - y0 - FH;
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
    if (s.viewOpts?.layout === 'pageBreakPreview') for (const g of regions) this.drawBreakPreview(g);
    else if (this.showPageBreaks) for (const g of regions) this.drawPageBreaks(g);
    this.drawCharts(vw, vh);
    this.drawObjects(vw, vh);
    this.drawHeaders(regions);
    const { FH, FW, SH, SW, x0, y0 } = this.frozen();
    ctx.strokeStyle = '#9aa3b5';
    ctx.lineWidth = 1;
    if (FH) { ctx.beginPath(); ctx.moveTo(0, y0 + FH + 0.5); ctx.lineTo(vw, y0 + FH + 0.5); ctx.stroke(); }
    if (FW) { ctx.beginPath(); ctx.moveTo(x0 + FW + 0.5, 0); ctx.lineTo(x0 + FW + 0.5, vh); ctx.stroke(); }
    // a split window's bars, which can be dragged (or double-clicked to take the split away)
    ctx.fillStyle = '#c9ced8';
    if (SH) ctx.fillRect(0, y0 - SPLIT_BAR, vw, SPLIT_BAR);
    if (SW) ctx.fillRect(x0 - SPLIT_BAR, 0, SPLIT_BAR, vh);
    const bp = this.breakPreview;
    if (bp) {
      ctx.fillStyle = 'rgba(47, 91, 211, 0.7)';
      if (bp.axis === 'row') ctx.fillRect(0, bp.at - 1.5, vw, 3);
      else ctx.fillRect(bp.at - 1.5, 0, 3, vh);
    }
    const sp = this.splitPreview;
    if (sp) {
      ctx.fillStyle = 'rgba(80, 90, 110, 0.5)';
      if (sp.axis === 'row') ctx.fillRect(0, sp.at - 2, vw, SPLIT_BAR);
      else ctx.fillRect(sp.at - 2, 0, SPLIT_BAR, vh);
    }
    this.drawCircles(regions);
    this.drawDropButton();
    this.placePrompt();
    if (this.editing) this.placeInput();
    this.host.drawn?.();
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
    if (id !== null) this.objSel = null;
    this.render();
    this.host.changed();
  }

  /** Where a chart (or a picture, shape or text box) is on the screen (view coordinates). */
  chartBox(c: Floating): Box {
    this.layout();
    const { fr, fc, x0, y0 } = this.frozen();
    const z = this.zoom;
    // (in a split window, charts show in the lower right pane)
    const x = (c.at.col < fc ? this.HW : x0 - this.scroller.scrollLeft) + this.cols.pos(c.at.col) + c.at.dx * z;
    const y = (c.at.row < fr ? this.HH : y0 - this.scroller.scrollTop) + this.rows.pos(c.at.row) + c.at.dy * z;
    return { x, y, w: c.w * z, h: c.h * z };
  }

  /** The cell and offset (pixels at 100%) of a point on the sheet, for placing a chart. */
  anchorAt(sheetX: number, sheetY: number): Chart['at'] {
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
    const { x0, y0, SH, SW } = this.frozen();
    const left = SW ? x0 : this.HW, top = SH ? y0 : this.HH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, vw - left, vh - top);
    ctx.clip();
    for (const c of charts) {
      const b = this.chartBox(c);
      if (b.x > vw || b.y > vh || b.x + b.w < left || b.y + b.h < top) continue;
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
    if (x < this.HW || y < this.HH) return null;
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

  /** A click on a treemap's box (or its trail back up), or a decomposition tree's node: drill or expand to where it leads. */
  private chartPartClick(c: Chart, x: number, y: number): void {
    const hits = this.chartCache.get(c.id)?.hits;
    if (!hits) return;
    const b = this.chartBox(c);
    const part = partHit(hits, (x - b.x) / this.zoom, (y - b.y) / this.zoom);
    if (!part?.drill) return;
    const { path: _was, ...rest } = c;
    const tree = c.kind === 'decomp';
    this.replaceChart(part.drill.length ? { ...rest, path: part.drill } : rest, tree ? 'Expand tree' : part.drill.length > (c.path?.length ?? 0) ? 'Drill down' : 'Drill up');
  }

  private dragChart(d: Extract<Drag, { kind: 'chart' }>, x: number, y: number): void {
    const z = this.zoom, o = d.orig;
    const dx = (x - d.x0) / z, dy = (y - d.y0) / z;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    const box = this.chartBox(o);
    const { fr, fc, x0, y0 } = this.frozen();
    const toSheet = (vx: number, vy: number) => ({
      x: o.at.col < fc ? vx - this.HW : vx - x0 + this.scroller.scrollLeft,
      y: o.at.row < fr ? vy - this.HH : vy - y0 + this.scroller.scrollTop,
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
      const { fr, fc, x0, y0 } = this.frozen();
      const sx = (c.at.col < fc ? b.x - this.HW : b.x - x0 + this.scroller.scrollLeft) + arrows[k][0] * step * this.zoom;
      const sy = (c.at.row < fr ? b.y - this.HH : b.y - y0 + this.scroller.scrollTop) + arrows[k][1] * step * this.zoom;
      this.replaceChart({ ...c, at: this.anchorAt(sx, sy) }, 'Move chart');
      return true;
    }
    if (k === 'Enter' && this.host.editChart) { e.preventDefault(); this.host.editChart(c.id); return true; }
    if (this.host.key(e)) { e.preventDefault(); return true; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey) e.preventDefault();
    return true;
  }

  // ---------------------------------------------------------------- pictures, shapes and text boxes

  private objectsShown(): SheetObject[] {
    const list = this.sheet?.objects ?? [];
    const p = this.objPreview;
    return p ? list.map((o) => (o.id === p.id ? p : o)) : list;
  }

  get selectedObject(): SheetObject | null {
    if (this.objSel === null) return null;
    return this.sheet?.objects.find((o) => o.id === this.objSel) ?? null;
  }

  /** Pick a picture, shape or text box (null: back to the cells). */
  pickObject(id: number | null): void {
    if (id === this.objSel) return;
    this.objSel = id;
    if (id !== null) this.chartSel = null;
    this.render();
    this.host.changed();
  }

  /** Where a new object goes: by the active cell, in sight. */
  newObjectPlace(): Chart['at'] {
    const { r, c } = this.sel.active;
    return { row: r, col: c, dx: 8, dy: 4 };
  }

  private objectImage(src: string): HTMLImageElement | null {
    let img = this.objImages.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.render();
      img.src = src;
      this.objImages.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private drawObjects(vw: number, vh: number): void {
    const list = this.objectsShown();
    if (!list.length) return;
    const ctx = this.ctx, z = this.zoom;
    // (in a split window, like charts, only in the lower right pane)
    const { x0, y0, SH, SW } = this.frozen();
    const left = SW ? x0 : this.HW, top = SH ? y0 : this.HH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, vw - left, vh - top);
    ctx.clip();
    for (const o of list) {
      const b = this.chartBox(o);
      if (b.x > vw + 50 || b.y > vh + 50 || b.x + b.w < left - 50 || b.y + b.h < top - 50) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      if (o.rot) { ctx.translate(b.w / 2, b.h / 2); ctx.rotate((o.rot * Math.PI) / 180); ctx.translate(-b.w / 2, -b.h / 2); }
      this.paintObject(ctx, o, z);
      ctx.restore();
      if (o.id === this.objSel) this.drawObjectHandles(o, b);
    }
    ctx.restore();
  }

  /** One object drawn at the origin, `z` pixels to each pixel at 100%. */
  paintObject(ctx: CanvasRenderingContext2D, o: SheetObject, z: number): void {
    const look = objectLook(o);
    const w = o.w * z, h = o.h * z;
    const lw = Math.max(0.5, (look.lineW * 4) / 3 * z);
    if (o.kind === 'picture') {
      const img = o.src ? this.objectImage(o.src) : null;
      if (img) ctx.drawImage(img, 0, 0, w, h);
      else { ctx.fillStyle = '#f0f1f4'; ctx.fillRect(0, 0, w, h); }
      if (look.line !== 'none') { ctx.strokeStyle = look.line; ctx.lineWidth = lw; ctx.strokeRect(0, 0, w, h); }
      return;
    }
    if (isLine(o)) {
      const [x1, y1, x2, y2] = lineEnds(o, w, h);
      ctx.strokeStyle = look.line;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const head = arrowHead(o, w, h, lw);
      if (head) { ctx.fillStyle = look.line; ctx.fill(new Path2D(head)); }
      return;
    }
    const path = new Path2D(shapePath(o.shape ?? 'rect', w, h));
    if (look.fill !== 'none') { ctx.fillStyle = look.fill; ctx.fill(path); }
    if (look.line !== 'none') { ctx.strokeStyle = look.line; ctx.lineWidth = lw; ctx.stroke(path); }
    if (o.text) {
      const size = ((o.size ?? 11) * 96) / 72 * z;
      const font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${size.toFixed(2)}px ${o.font ? `"${o.font}", ` : ''}${CELL_FONT}`;
      const pad = 7 * z;
      const lines = this.wrapLines(o.text, font, Math.max(4, w - 2 * pad));
      const lh = size * 1.2;
      const align = o.align ?? (o.kind === 'text' ? 'left' : 'center');
      const valign = o.valign ?? (o.kind === 'text' ? 'top' : 'middle');
      const total = lines.length * lh;
      let y = valign === 'top' ? pad * 0.6 : valign === 'bottom' ? h - pad * 0.6 - total : (h - total) / 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.font = font;
      ctx.fillStyle = look.color;
      ctx.textBaseline = 'top';
      ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
      const x = align === 'center' ? w / 2 : align === 'right' ? w - pad : pad;
      for (const line of lines) { ctx.fillText(line, x, y + size * 0.1); y += lh; }
      ctx.restore();
    }
  }

  private objectHandles(o: SheetObject, b: Box): [number, number, Handle][] {
    if (isLine(o)) {
      const [x1, y1, x2, y2] = lineEnds(o, b.w, b.h);
      return [[b.x + x1, b.y + y1, 'start'], [b.x + x2, b.y + y2, 'end']];
    }
    return this.handlePoints(b) as [number, number, Handle][];
  }

  private drawObjectHandles(o: SheetObject, b: Box): void {
    const ctx = this.ctx;
    ctx.strokeStyle = this.accent();
    ctx.lineWidth = 1.5;
    ctx.setLineDash(isLine(o) ? [] : [4, 3]);
    if (!isLine(o)) ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w) - 1, Math.round(b.h) - 1);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    for (const [hx, hy] of this.objectHandles(o, b)) {
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE / 2 + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** The object under a point (the top one), and which handle. */
  private objectAt(x: number, y: number): { o: SheetObject; how: Handle } | null {
    if (x < this.HW || y < this.HH) return null;
    const list = this.objectsShown();
    const sel = list.find((o) => o.id === this.objSel);
    if (sel) {
      for (const [hx, hy, how] of this.objectHandles(sel, this.chartBox(sel))) if (Math.abs(x - hx) <= HANDLE && Math.abs(y - hy) <= HANDLE) return { o: sel, how };
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i], b = this.chartBox(o);
      if (isLine(o)) {
        const [x1, y1, x2, y2] = lineEnds(o, b.w, b.h);
        const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - b.x - x1) * dx + (y - b.y - y1) * dy) / len2));
        if (Math.hypot(b.x + x1 + t * dx - x, b.y + y1 + t * dy - y) <= 5) return { o, how: 'move' };
        continue;
      }
      // a point turned back by the object's turn, to test against its box
      let px = x, py = y;
      if (o.rot) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = (-o.rot * Math.PI) / 180;
        px = cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
        py = cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
      }
      if (px >= b.x && py >= b.y && px <= b.x + b.w && py <= b.y + b.h) return { o, how: 'move' };
    }
    return null;
  }

  /** A view point as a point on the sheet (pixels at this zoom), for an object at `at`. */
  private toSheet(at: Chart['at'], vx: number, vy: number): { x: number; y: number } {
    const { fr, fc, x0, y0 } = this.frozen();
    return { x: at.col < fc ? vx - this.HW : vx - x0 + this.scroller.scrollLeft, y: at.row < fr ? vy - this.HH : vy - y0 + this.scroller.scrollTop };
  }

  private dragObject(d: Extract<Drag, { kind: 'object' }>, x: number, y: number, shift: boolean): void {
    const z = this.zoom, o = d.orig;
    const dx = (x - d.x0) / z, dy = (y - d.y0) / z;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    const box = this.chartBox(o);
    let next: SheetObject;
    if (d.how === 'move') {
      const p = this.toSheet(o.at, box.x + dx * z, box.y + dy * z);
      next = { ...o, at: this.anchorAt(p.x, p.y) };
    } else if (d.how === 'start' || d.how === 'end') {
      // a line's end moves; the box is made again round both ends
      const [x1, y1, x2, y2] = lineEnds(o, o.w, o.h);
      let a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
      if (d.how === 'start') a = { x: x1 + dx, y: y1 + dy }; else b = { x: x2 + dx, y: y2 + dy };
      const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
      const p = this.toSheet(o.at, box.x + left * z, box.y + top * z);
      const flipH = a.x > b.x, flipV = a.y > b.y;
      next = { ...o, at: this.anchorAt(p.x, p.y), w: Math.max(1, Math.round(Math.abs(b.x - a.x))), h: Math.max(1, Math.round(Math.abs(b.y - a.y))), flipH: flipH || undefined, flipV: flipV || undefined };
    } else {
      let bx = box.x, by = box.y, w = o.w, h = o.h;
      const min = 8;
      if (d.how.includes('e')) w = Math.max(min, o.w + dx);
      if (d.how.includes('s')) h = Math.max(min, o.h + dy);
      if (d.how.includes('w')) w = Math.max(min, o.w - dx);
      if (d.how.includes('n')) h = Math.max(min, o.h - dy);
      // pictures keep their shape from a corner (Shift does it for shapes)
      if (d.how.length === 2 && (o.kind === 'picture') !== shift) {
        const k = Math.max(w / o.w, h / o.h);
        w = Math.max(min, o.w * k); h = Math.max(min, o.h * k);
      }
      if (d.how.includes('w')) bx += (o.w - w) * z;
      if (d.how.includes('n')) by += (o.h - h) * z;
      const p = this.toSheet(o.at, bx, by);
      next = { ...o, at: this.anchorAt(p.x, p.y), w: Math.round(w), h: Math.round(h) };
      this.host.flash(`${Math.round(w)} × ${Math.round(h)} pixels`, 800);
    }
    this.objPreview = next;
    this.render();
  }

  /** Put a changed object in the sheet (one undo step). */
  replaceObject(o: SheetObject, label = 'Change shape'): void {
    const s = this.sheet!;
    this.wb!.edit(label, () => s.setObjects(s.objects.map((x) => (x.id === o.id ? o : x))), this.place());
    this.render();
    this.host.changed();
  }

  deleteObject(id = this.objSel): void {
    const s = this.sheet;
    if (id === null || !s) return;
    const o = s.objects.find((x) => x.id === id);
    this.wb!.edit(`Delete ${o?.kind === 'picture' ? 'picture' : o?.kind === 'text' ? 'text box' : 'shape'}`, () => s.setObjects(s.objects.filter((x) => x.id !== id)), this.place());
    if (this.objSel === id) this.objSel = null;
    this.render();
    this.host.changed();
  }

  /** Keys while an object is picked: Delete, arrows to nudge, Esc back to the cells, Enter or F2 to change its text. */
  private objectKey(e: KeyboardEvent): boolean {
    const o = this.selectedObject;
    if (!o) { this.objSel = null; return false; }
    const k = e.key;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteObject(); return true; }
    if (k === 'Escape') { e.preventDefault(); this.pickObject(null); return true; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (arrows[k]) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * this.zoom;
      const b = this.chartBox(o);
      const p = this.toSheet(o.at, b.x + arrows[k][0] * step, b.y + arrows[k][1] * step);
      this.replaceObject({ ...o, at: this.anchorAt(p.x, p.y) }, 'Move');
      return true;
    }
    if ((k === 'Enter' || k === 'F2') && o.kind !== 'picture' && !isLine(o)) { e.preventDefault(); this.host.editObject?.(o.id); return true; }
    if (this.host.key(e)) { e.preventDefault(); return true; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.host.typeInObject?.(o.id, k);
    }
    return true;
  }

  // ---------------------------------------------------------------- page breaks

  private pageBreaks(): NonNullable<SheetView['breakCache']> {
    const s = this.sheet!;
    const key = `${s.uid}|${this.wb!.edits}`;
    if (this.breakCache?.key === key) return this.breakCache;
    const p = sheetPages(s, sheetSizes(s, (r) => this.rowHeight(r)), defaultPaper(navigator.language));
    const { rows, cols } = breakLines(p);
    // breaks between two pages (not the edges of what prints), which Page Break Preview can drag
    const innerRows = new Set(p.pages.filter((a) => p.pages.some((b) => b.rows[1] === a.rows[0] - 1 && b.cols[0] === a.cols[0])).map((a) => a.rows[0]));
    const innerCols = new Set(p.pages.filter((a) => p.pages.some((b) => b.cols[1] === a.cols[0] - 1 && b.rows[0] === a.rows[0])).map((a) => a.cols[0]));
    this.breakCache = { key, rows, cols, manualRows: new Set(s.pageSetup?.fit ? [] : s.pageSetup?.rowBreaks ?? []), manualCols: new Set(s.pageSetup?.fit ? [] : s.pageSetup?.colBreaks ?? []), pages: p.pages, innerRows, innerCols };
    return this.breakCache;
  }

  /**
   * Page Break Preview: what doesn't print greyed, each page's number over it, and the breaks as
   * blue lines (dashed where Excel put them, solid where put by hand or at the edge of what prints).
   */
  private drawBreakPreview(g: Region): void {
    const b = this.pageBreaks();
    const ctx = this.ctx;
    const X = (c: number) => g.x + this.cols.pos(c) - g.ox;
    const Y = (r: number) => g.y + this.rows.pos(r) - g.oy;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x, g.y, g.w, g.h);
    ctx.clip();
    const box = (p: PrintPage) => ({ x: X(p.cols[0]), y: Y(p.rows[0]), w: X(p.cols[1] + 1) - X(p.cols[0]), h: Y(p.rows[1] + 1) - Y(p.rows[0]) });
    ctx.beginPath();
    ctx.rect(g.x, g.y, g.w, g.h);
    for (const p of b.pages) { const r = box(p); ctx.rect(r.x, r.y, r.w, r.h); }
    ctx.fillStyle = 'rgba(110, 116, 128, 0.32)';
    ctx.fill('evenodd');
    ctx.font = `bold ${Math.round(44 * this.zoom)}px ${CELL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(120, 130, 150, 0.3)';
    for (const p of b.pages) {
      const r = box(p);
      if (r.x > g.x + g.w || r.y > g.y + g.h || r.x + r.w < g.x || r.y + r.h < g.y) continue;
      ctx.fillText(`Page ${p.index}`, r.x + r.w / 2, r.y + r.h / 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = '#2f5bd3';
    ctx.lineWidth = 2.5;
    for (const p of b.pages) {
      const r = box(p);
      const edge = (x1: number, y1: number, x2: number, y2: number, dashed: boolean) => {
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };
      // the left and top edges of a page that follows another are its breaks
      edge(r.x, r.y, r.x + r.w, r.y, b.innerRows.has(p.rows[0]) && !b.manualRows.has(p.rows[0]));
      edge(r.x, r.y, r.x, r.y + r.h, b.innerCols.has(p.cols[0]) && !b.manualCols.has(p.cols[0]));
      edge(r.x + r.w, r.y, r.x + r.w, r.y + r.h, false);
      edge(r.x, r.y + r.h, r.x + r.w, r.y + r.h, false);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Page Break Preview: the break between two pages under a point, to drag. */
  private breakAt(x: number, y: number): { axis: 'row' | 'col'; at: number } | null {
    if (this.sheet?.viewOpts?.layout !== 'pageBreakPreview' || x < this.HW || y < this.HH) return null;
    const b = this.pageBreaks();
    const g = this.regionAt(x, y);
    const sx = x - g.x + g.ox, sy = y - g.y + g.oy;
    for (const r of b.innerRows) if (Math.abs(this.rows.pos(r) - sy) <= 3) return { axis: 'row', at: r };
    for (const c of b.innerCols) if (Math.abs(this.cols.pos(c) - sx) <= 3) return { axis: 'col', at: c };
    return null;
  }

  /** Page Layout > Page Breaks: dashed lines where Excel would start new pages, solid ones for breaks put in by hand. */
  private drawPageBreaks(g: Region): void {
    const b = this.pageBreaks();
    const ctx = this.ctx;
    const X = (c: number) => Math.round(g.x + this.cols.pos(c) - g.ox) - 0.5;
    const Y = (r: number) => Math.round(g.y + this.rows.pos(r) - g.oy) - 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x, g.y, g.w, g.h);
    ctx.clip();
    ctx.lineWidth = 1.5;
    for (const manual of [false, true]) {
      ctx.strokeStyle = manual ? '#2f5bd3' : '#4a4f5a';
      ctx.setLineDash(manual ? [] : [5, 4]);
      ctx.beginPath();
      for (let c = g.c1; c <= g.c2 + 1; c++) if (b.cols.has(c) && b.manualCols.has(c) === manual) { ctx.moveTo(X(c), g.y); ctx.lineTo(X(c), g.y + g.h); }
      for (let r = g.r1; r <= g.r2 + 1; r++) if (b.rows.has(r) && b.manualRows.has(r) === manual) { ctx.moveTo(g.x, Y(r)); ctx.lineTo(g.x + g.w, Y(r)); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private font(style: CellStyle | undefined, z = this.zoom, pos: 'base' | 'sub' | 'sup' = 'base', italic = false): string {
    const size = ((style?.size ?? CELL_SIZE) * 96) / 72 * z * (pos === 'base' ? 1 : 0.7);
    // cells with no font of their own are in the theme's body font
    const family = style?.font ?? (this.wb?.theme ? themeOf(this.wb.theme).minor : undefined);
    return `${style?.italic || italic ? 'italic ' : ''}${style?.bold ? 'bold ' : ''}${size.toFixed(2)}px ${family ? `"${family}", ` : ''}${CELL_FONT}`;
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
    // Page Layout view: sheets of paper on grey, the cells only on the paper inside the margins
    const pg = this.pageGrid;
    if (pg) this.drawPaper(g, pg, X, Y);
    // grid lines (unless hidden: View > Gridlines)
    if (s.viewOpts?.gridlines !== false) {
      ctx.strokeStyle = '#e1e4e8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = g.c1; c <= g.c2 + 1; c++) {
        const x = Math.round(X(c)) - 0.5;
        ctx.moveTo(x, g.y);
        ctx.lineTo(x, g.y + g.h);
        // pages have gaps between them: each column's right edge too
        if (pg) { const x2 = Math.round(X(c) + this.cols.size(c)) - 0.5; ctx.moveTo(x2, g.y); ctx.lineTo(x2, g.y + g.h); }
      }
      for (let r = g.r1; r <= g.r2 + 1; r++) {
        const y = Math.round(Y(r)) - 0.5;
        ctx.moveTo(g.x, y);
        ctx.lineTo(g.x + g.w, y);
        if (pg) { const y2 = Math.round(Y(r) + this.rows.size(r)) - 0.5; ctx.moveTo(g.x, y2); ctx.lineTo(g.x + g.w, y2); }
      }
      ctx.stroke();
    }
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
        if (s.sparklines.length) {
          const sp = sparklineAt(s.sparklines, rr, cc);
          if (sp) this.drawSparkline(s, sp.group, sp.item, x, y, w, h);
        }
        if (cell?.structure) this.drawStructure(cell.structure, x, y, w, h, style, budget);
        else if (look?.hideValue) { /* only the bar or icon shows */ }
        else if (v !== undefined && v !== null && v !== '' && c > spillUntil) {
          // a compound (Data > Data Types): its mark before the name, as Excel marks its data types
          const mark = cell?.compound ? this.drawCompoundMark(x, y, h) : 0;
          const last = this.drawText(rr, cc, x + mark, y, w - mark, h, style, g, X);
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
        const note = s.notes.size ? s.noteAt(rr, cc) : undefined;
        if (isError(v) && v.code !== '#BUSY!') {
          // (at the bottom when a note's mark has the top corner)
          const top = note ? y + h - 1 : y, edge = note ? y + h - 1 - 6 * z : y + 6 * z;
          ctx.fillStyle = '#18794e';
          ctx.beginPath();
          ctx.moveTo(x + w - 7 * z, top);
          ctx.lineTo(x + w - 1, top);
          ctx.lineTo(x + w - 1, edge);
          ctx.fill();
        }
        // a note: a red triangle in the top right corner; a comment: purple, as in Excel
        if (note) {
          ctx.fillStyle = note.kind === 'comment' ? (note.done ? '#a59bb8' : '#7b3fbf') : '#e02020';
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
    if (pg) ctx.restore();
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
    // the array the active cell spilled into (or would, dashed, when something is in the way)
    const sp = s.spillAt(this.sel.active.r, this.sel.active.c);
    if (sp) {
      const x1 = X(sp.range.c1), y1 = Y(sp.range.r1), x2 = X(sp.range.c2 + 1), y2 = Y(sp.range.r2 + 1);
      ctx.save();
      if (sp.blocked) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#4a7fd6';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 1.5, y1 + 1.5, x2 - x1 - 3, y2 - y1 - 3);
      ctx.restore();
    }
  }

  /**
   * Page Layout view: grey round the pages, each page white with its header and footer, and the
   * cells clipped to the part inside the margins (the clip is undone at the end of drawRegion).
   */
  private drawPaper(g: Region, pg: PageGrid, X: (c: number) => number, Y: (r: number) => number): void {
    const s = this.sheet!, ctx = this.ctx, m = pg.margins;
    ctx.fillStyle = '#dfe2e7';
    ctx.fillRect(g.x, g.y, g.w, g.h);
    const bands = (starts: number[], lo: number, hi: number) => {
      const out: [number, number][] = [];
      for (let k = 0; k + 1 < starts.length; k++) if (starts[k + 1] - 1 >= lo && starts[k] <= hi) out.push([starts[k], starts[k + 1] - 1]);
      return out;
    };
    const rowBands = bands(pg.rowStarts, g.r1, g.r2), colBands = bands(pg.colStarts, g.c1, g.c2);
    // pages of the cells in use get their header, footer and number
    const used = s.usedRange();
    const usedRows = used ? pg.rowStarts.filter((r, k) => k + 1 < pg.rowStarts.length && r <= used.r2).length : 0;
    const usedCols = used ? pg.colStarts.filter((c, k) => k + 1 < pg.colStarts.length && c <= used.c2).length : 0;
    const pages = usedRows * usedCols;
    const content: { x: number; y: number; w: number; h: number }[] = [];
    for (const [r1] of rowBands) {
      for (const [c1] of colBands) {
        const px = X(c1) - m.left, py = Y(r1) - m.top;
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(px + 2, py + 2, pg.paperW, pg.paperH);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px, py, pg.paperW, pg.paperH);
        content.push({ x: X(c1), y: Y(r1), w: pg.paperW - m.left - m.right, h: pg.paperH - m.top - m.bottom });
        const rb = pg.rowStarts.indexOf(r1), cb = pg.colStarts.indexOf(c1);
        if (rb < usedRows && cb < usedCols) {
          const index = (s.pageSetup?.order === 'over' ? rb * usedCols + cb : cb * usedRows + rb) + (s.pageSetup?.firstPage ?? 1);
          this.drawHeaderFooter(s, px, py, pg, index, pages);
        }
      }
    }
    ctx.save();
    ctx.beginPath();
    for (const b of content) ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
  }

  /** A page's header and footer in Page Layout view (double-click them to change them). */
  private drawHeaderFooter(s: Sheet, px: number, py: number, pg: PageGrid, page: number, pages: number): void {
    const ps = s.pageSetup, ctx = this.ctx, m = pg.margins;
    const first = ps?.differentFirst && page === (ps.firstPage ?? 1);
    const head = first ? ps?.firstHeader : ps?.header, foot = first ? ps?.firstFooter : ps?.footer;
    const hf = { page, pages, sheet: s.name, file: '', date: new Date() };
    ctx.save();
    ctx.font = `${(11 * 96) / 72 * this.zoom}px ${CELL_FONT}`;
    ctx.fillStyle = '#3a414d';
    const put = (h: typeof head, base: number) => {
      for (const k of ['left', 'center', 'right'] as const) {
        const t = headerRuns(h?.[k], hf).map((r) => r.text).join('');
        if (!t) continue;
        ctx.textAlign = k === 'center' ? 'center' : k;
        ctx.fillText(t, k === 'left' ? px + m.left : k === 'right' ? px + pg.paperW - m.right : px + pg.paperW / 2, base);
      }
    };
    put(head, py + m.header + 12 * this.zoom);
    put(foot, py + pg.paperH - m.footer);
    // an empty header shows where to click
    if (!head?.left && !head?.center && !head?.right) {
      ctx.fillStyle = '#a3a9b4';
      ctx.textAlign = 'center';
      ctx.fillText('Double-click to add header', px + pg.paperW / 2, py + m.header + 12 * this.zoom);
    }
    ctx.restore();
  }

  /** Is a point in the header or footer of a page in Page Layout view? */
  headerFooterAt(x: number, y: number): boolean {
    const pg = this.pageGrid;
    if (!pg) return false;
    const g = this.regionAt(x, y);
    const sy = y - g.y + g.oy;
    const r = this.rows.at(sy), k = pg.rowStarts.findIndex((st, i) => i + 1 < pg.rowStarts.length && r >= st && r < pg.rowStarts[i + 1]);
    if (k < 0) return false;
    const top = this.rows.pos(pg.rowStarts[k]) - pg.margins.top, bottom = top + pg.paperH;
    return sy >= top && sy < top + pg.margins.top || sy >= bottom - pg.margins.bottom && sy < bottom;
  }

  /** The values a sparkline charts (null for empty cells; hidden rows and columns left out unless the group shows them). */
  private sparkValues(s: Sheet, g: SparklineGroup): { values: (number | null)[][]; min?: number; max?: number } {
    const wb = this.wb!;
    const key = `${wb.edits}|${s.valuesGen}|${s.uid}`;
    if (this.sparkCache?.key !== key) this.sparkCache = { key, values: new Map(), limits: new Map() };
    const c = this.sparkCache;
    let values = c.values.get(g);
    if (!values) {
      values = g.items.map((it) => {
        const src = sparkSource(it.data);
        const sh = src?.sheet ? wb.sheetNamed(src.sheet) : s;
        if (!src || !sh) return [];
        const R = src.range, out: (number | null)[] = [];
        for (let r = R.r1; r <= R.r2; r++) {
          if (!g.hidden && sh.hiddenRows.has(r)) continue;
          for (let col = R.c1; col <= R.c2; col++) {
            if (!g.hidden && sh.hiddenCols.has(col)) continue;
            const v = sh.values.get(keyOf(r, col));
            out.push(typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : null);
          }
        }
        return out;
      });
      c.values.set(g, values);
      const all = values.flat().filter((v): v is number => v !== null);
      c.limits.set(g, {
        min: typeof g.minAxis === 'number' ? g.minAxis : g.minAxis === 'group' && all.length ? Math.min(...all, g.kind === 'column' ? 0 : Infinity) : undefined,
        max: typeof g.maxAxis === 'number' ? g.maxAxis : g.maxAxis === 'group' && all.length ? Math.max(...all) : undefined,
      });
    }
    return { values, ...c.limits.get(g) };
  }

  /** A sparkline in its cell. */
  private drawSparkline(s: Sheet, g: SparklineGroup, it: { row: number; col: number }, x: number, y: number, w: number, h: number): void {
    const { values, min, max } = this.sparkValues(s, g);
    const vals = values[g.items.findIndex((i) => i.row === it.row && i.col === it.col)] ?? [];
    const nums = vals.filter((v): v is number => v !== null);
    const lim = min !== undefined || max !== undefined ? { min: min ?? Math.min(...nums), max: max ?? Math.max(...nums) } : undefined;
    const shape = sparkShape(g, vals, w - 2, h - 2, lim);
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w - 1, h - 1);
    ctx.clip();
    ctx.translate(x + 1, y + 1);
    if (shape.axis !== undefined) {
      ctx.strokeStyle = g.axisColor ?? '#000000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(shape.axis) + 0.5);
      ctx.lineTo(w - 2, Math.round(shape.axis) + 0.5);
      ctx.stroke();
    }
    for (const b of shape.bars ?? []) { ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h); }
    if (shape.line) {
      ctx.strokeStyle = g.color;
      ctx.lineWidth = Math.max(0.75, ((g.weight ?? 0.75) * 96) / 72 * this.zoom);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      for (const p of shape.line) {
        if (!p) { pen = false; continue; }
        if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
      for (const d of shape.dots ?? []) {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, Math.max(1.5, 2 * this.zoom), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
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
  /** A compound cell's mark: a small ring at the left of the cell. Returns the room it takes. */
  private drawCompoundMark(x: number, y: number, h: number): number {
    const ctx = this.ctx, z = this.zoom;
    const r = 4.2 * z, cx = x + 3 * z + r, cy = y + h - Math.min(h, 20 * z) / 2 - 0.5;
    ctx.save();
    ctx.strokeStyle = '#2b6cb0';
    ctx.lineWidth = Math.max(1, 1.1 * z);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return 2 * r + 4 * z;
  }

  private drawText(r: number, c: number, x: number, y: number, w: number, h: number, style: CellStyle | undefined, g: Region, X: (c: number) => number): number {
    const s = this.sheet!;
    const ctx = this.ctx;
    const v = s.values.get(keyOf(r, c)) ?? null;
    style = this.chemLook(style, v);
    const shown = formatValue(v, style?.numFmt);
    let text = shown.text;
    const align = style?.align ?? shown.align;
    const font = this.font(style);
    ctx.font = font;
    ctx.fillStyle = shown.color ?? style?.color ?? (isError(v) ? '#b4232a' : '#000000');
    // an indent moves the text in from the side it is aligned to (about three characters a level)
    const pad = (3 + (align === 'center' ? 0 : 9 * (style?.indent ?? 0))) * this.zoom;
    const lineH = this.lineHeight(style) * this.zoom;
    const valign = style?.valign ?? 'bottom';
    let last = c;
    if (style?.rotate) { this.drawTurned(text, style, x, y, w, h, pad, align, valign, font); return c; }
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

  /**
   * Text turned in its cell (Format Cells > Orientation): at an angle, up or down the cell, or
   * stacked a letter to a line. Turned text stays in its cell (it doesn't run on over the next).
   */
  private drawTurned(text: string, style: CellStyle, x: number, y: number, w: number, h: number, pad: number, align: string, valign: string, font: string): void {
    const ctx = this.ctx;
    const lineH = this.lineHeight(style) * this.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w - 1, h - 1);
    ctx.clip();
    text = text.replace(/\n/g, ' ');
    if (style.rotate === 255) {
      // stacked: one letter under another, centred across the cell
      const chars = [...text];
      const total = chars.length * lineH;
      let ty = valign === 'top' ? y + 2 : valign === 'middle' ? y + (h - total) / 2 : y + h - total - 2;
      ctx.textAlign = 'center';
      const cx = align === 'left' ? x + pad + lineH / 2 : align === 'right' ? x + w - pad - lineH / 2 : x + w / 2;
      for (const ch of chars) { ctx.fillText(ch, cx, ty + lineH * 0.78); ty += lineH; }
      ctx.textAlign = 'left';
      ctx.restore();
      return;
    }
    const a = (style.rotate! * Math.PI) / 180;
    const tw = this.textWidth(text, font);
    // the turned text's box, to place it in the cell as aligned
    const bw = Math.abs(tw * Math.cos(a)) + Math.abs(lineH * Math.sin(a)), bh = Math.abs(tw * Math.sin(a)) + Math.abs(lineH * Math.cos(a));
    const cx = align === 'left' ? x + pad + bw / 2 : align === 'center' ? x + w / 2 : x + w - pad - bw / 2;
    const cy = valign === 'top' ? y + 2 + bh / 2 : valign === 'middle' ? y + h / 2 : y + h - 2 - bh / 2;
    ctx.translate(cx, cy);
    ctx.rotate(-a);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = font;
    ctx.fillText(text, 0, 0);
    if (style.underline) ctx.fillRect(-tw / 2, lineH * 0.35, tw, Math.max(1, this.zoom));
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /** The cell's look with chemistry on where its text has a formula in it (see showsChem). */
  private chemLook(style: CellStyle | undefined, v: unknown): CellStyle | undefined {
    return style?.chem === undefined && showsChem(undefined, v) ? { ...style, chem: true } : style;
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
    // the other blocks selected: shaded, with a thin edge
    for (const m of sel.more ?? []) {
      const a = growToMerges(s, m);
      const mx = X(a.c1), my = Y(a.r1), mw = X(a.c2 + 1) - mx, mh = Y(a.r2 + 1) - my;
      if (mx > g.x + g.w || my > g.y + g.h || mx + mw < g.x || my + mh < g.y) continue;
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = accent;
      ctx.fillRect(mx, my, mw, mh);
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
    }
    const one = !sel.more?.length && (range.r1 === range.r2 && range.c1 === range.c2 || !!(s.mergeAt(sel.active.r, sel.active.c) && sameRange(s.mergeAt(sel.active.r, sel.active.c)!, range)));
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
    const HW = this.HW, HH = this.HH, OW = this.OW, OH = this.OH;
    if (!HW && !HH) return;
    const sel = growToMerges(s, this.sel.range);
    const accent = this.accent();
    const css = getComputedStyle(this.el);
    const headBg = css.getPropertyValue('--sh-head').trim() || '#f3f4f6';
    const headText = css.getPropertyValue('--sh-head-text').trim() || '#3a414d';
    const soft = css.getPropertyValue('--accent-soft').trim() || '#d8eee2';
    ctx.fillStyle = headBg;
    ctx.fillRect(0, 0, vw, HH);
    ctx.fillRect(0, 0, HW, vh);
    const filtered = s.filterRows();
    ctx.font = `${12 * Math.min(1.2, Math.max(0.8, this.zoom))}px ${CELL_FONT}`;
    ctx.textBaseline = 'middle';
    const allRows = sel.r1 === 0 && sel.r2 >= MAX_ROWS - 1, allCols = sel.c1 === 0 && sel.c2 >= MAX_COLS - 1;
    const heads = s.viewOpts?.headings !== false;
    // column letters (below the outline's buttons)
    const doneCols = new Set<string>();
    if (heads) for (const g of regions) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x, OH, g.w, HH - OH);
      ctx.clip();
      for (let c = g.c1; c <= g.c2; c++) {
        const id = `${g.x}|${c}`;
        if (doneCols.has(id)) continue;
        doneCols.add(id);
        const x = g.x + this.cols.pos(c) - g.ox, w = this.cols.size(c);
        if (!w) continue;
        const on = c >= sel.c1 && c <= sel.c2;
        if (on) {
          ctx.fillStyle = soft;
          ctx.fillRect(x, OH, w, HH - OH);
          ctx.fillStyle = accent;
          ctx.fillRect(x, HH - 2, w, 2);
        }
        ctx.fillStyle = on && allRows ? accent : headText;
        ctx.textAlign = 'center';
        ctx.fillText(colName(c), x + w / 2, OH + (HH - OH) / 2 + 1);
        ctx.fillStyle = '#d6dae1';
        ctx.fillRect(Math.round(x + w) - 1, OH, 1, HH - OH);
      }
      ctx.restore();
    }
    // row numbers (right of the outline's buttons)
    const doneRows = new Set<string>();
    if (heads) for (const g of regions) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(OW, g.y, HW - OW, g.h);
      ctx.clip();
      for (let r = g.r1; r <= g.r2; r++) {
        const id = `${g.y}|${r}`;
        if (doneRows.has(id)) continue;
        doneRows.add(id);
        const y = g.y + this.rows.pos(r) - g.oy, h = this.rows.size(r);
        if (!h) continue;
        const on = r >= sel.r1 && r <= sel.r2;
        if (on) {
          ctx.fillStyle = soft;
          ctx.fillRect(OW, y, HW - OW, h);
          ctx.fillStyle = accent;
          ctx.fillRect(HW - 2, y, 2, h);
        }
        // rows of a filtered table show their numbers in the accent colour, as in Excel
        const inFilter = filtered && r >= filtered.r1 && r <= filtered.r2 && Object.keys(s.filter!.conditions).length > 0;
        ctx.fillStyle = (on && allCols) || inFilter ? accent : headText;
        ctx.textAlign = 'right';
        ctx.fillText(String(r + 1), HW - 6, y + Math.min(h, 20 * this.zoom) / 2 + 1);
        ctx.fillStyle = '#d6dae1';
        ctx.fillRect(OW, Math.round(y + h) - 1, HW - OW, 1);
      }
      ctx.restore();
    }
    if (OW || OH) this.drawOutline(regions, headBg, headText);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // the corner (select all)
    ctx.fillStyle = headBg;
    ctx.fillRect(OW, OH, HW - OW, HH - OH);
    if (heads) {
      ctx.fillStyle = '#b8bec9';
      ctx.beginPath();
      ctx.moveTo(HW - 4, OH + 6); ctx.lineTo(HW - 4, HH - 4); ctx.lineTo(HW - 4 - (HH - OH - 10), HH - 4);
      ctx.fill();
    }
    // the level buttons (1 2 3) of the row outline sit beside the corner, the columns' above it
    const levelButtons = (n: number, across: boolean) => {
      ctx.font = `${10 * Math.min(1.2, Math.max(0.8, this.zoom))}px ${CELL_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= n; i++) {
        const bx = across ? i * OUTLINE_STEP + 3 : HW - OUTLINE_STEP - 1, by = across ? HH - OUTLINE_STEP - 1 : i * OUTLINE_STEP + 3;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, OUTLINE_STEP - 3, OUTLINE_STEP - 3);
        ctx.strokeStyle = '#8a93a3';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, OUTLINE_STEP - 4, OUTLINE_STEP - 4);
        ctx.fillStyle = headText;
        ctx.fillText(String(i + 1), bx + (OUTLINE_STEP - 3) / 2, by + (OUTLINE_STEP - 3) / 2 + 0.5);
      }
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
    };
    if (OW) { ctx.fillStyle = headBg; ctx.fillRect(0, 0, OW, HH); levelButtons(maxLevel(s, 'row'), true); }
    if (OH) { ctx.fillStyle = headBg; ctx.fillRect(0, 0, HW, OH); levelButtons(maxLevel(s, 'col'), false); }
    ctx.fillStyle = '#c5cad3';
    ctx.fillRect(0, HH - 1, vw, 1);
    ctx.fillRect(HW - 1, 0, 1, vh);
  }

  /** The outline beside the row numbers and above the column letters: a bracket for each group, and its − or + button. */
  private drawOutline(regions: Region[], bg: string, ink: string): void {
    const ctx = this.ctx;
    const vw = this.scroller.clientWidth, vh = this.scroller.clientHeight;
    const box = OUTLINE_STEP - 5;
    const button = (cx: number, cy: number, plus: boolean) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - box / 2, cy - box / 2, box, box);
      ctx.strokeStyle = '#7b8494';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(cx - box / 2) + 0.5, Math.round(cy - box / 2) + 0.5, box - 1, box - 1);
      ctx.fillStyle = ink;
      ctx.fillRect(Math.round(cx - box / 2 + 2), Math.round(cy) - 0.5, box - 4, 1.2);
      if (plus) ctx.fillRect(Math.round(cx) - 0.5, Math.round(cy - box / 2 + 2), 1.2, box - 4);
    };
    if (this.OW) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, this.HH, this.OW, vh);
      const done = new Set<number>();
      for (const g of regions) {
        if (done.has(g.y)) continue;
        done.add(g.y);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, g.y, this.OW, g.h);
        ctx.clip();
        const Y = (r: number) => g.y + this.rows.pos(r) - g.oy;
        for (const o of this.rowOutline) {
          if (o.to < g.r1 - 1 && o.button < g.r1) continue;
          if (o.from > g.r2 + 1 && o.button > g.r2) continue;
          const cx = (o.level - 1) * OUTLINE_STEP + OUTLINE_STEP / 2 + 2;
          const by = Y(o.button) + Math.min(this.rows.size(o.button) || DEFAULT_ROW_H * this.zoom, 20 * this.zoom) / 2;
          if (!o.collapsed) {
            const y1 = Y(o.from) + 2, y2 = Y(o.to + 1) - 1;
            ctx.strokeStyle = '#7b8494';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + 0.5, Math.min(y1, by));
            ctx.lineTo(cx + 0.5, Math.max(y2, by));
            // a tick at the far end from the button
            const tip = o.button > o.to ? y1 : y2;
            ctx.moveTo(cx + 0.5, tip + 0.5);
            ctx.lineTo(cx + 5.5, tip + 0.5);
            ctx.stroke();
          }
          button(cx + 0.5, by, o.collapsed);
        }
        ctx.restore();
      }
    }
    if (this.OH) {
      ctx.fillStyle = bg;
      ctx.fillRect(this.HW, 0, vw, this.OH);
      const done = new Set<number>();
      for (const g of regions) {
        if (done.has(g.x)) continue;
        done.add(g.x);
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.x, 0, g.w, this.OH);
        ctx.clip();
        const X = (c: number) => g.x + this.cols.pos(c) - g.ox;
        for (const o of this.colOutline) {
          if (o.to < g.c1 - 1 && o.button < g.c1) continue;
          if (o.from > g.c2 + 1 && o.button > g.c2) continue;
          const cy = (o.level - 1) * OUTLINE_STEP + OUTLINE_STEP / 2 + 2;
          const bx = X(o.button) + (this.cols.size(o.button) || DEFAULT_COL_W * this.zoom) / 2;
          if (!o.collapsed) {
            const x1 = X(o.from) + 2, x2 = X(o.to + 1) - 1;
            ctx.strokeStyle = '#7b8494';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.min(x1, bx), cy + 0.5);
            ctx.lineTo(Math.max(x2, bx), cy + 0.5);
            const tip = o.button > o.to ? x1 : x2;
            ctx.moveTo(tip + 0.5, cy + 0.5);
            ctx.lineTo(tip + 0.5, cy + 5.5);
            ctx.stroke();
          }
          button(bx, cy + 0.5, o.collapsed);
        }
        ctx.restore();
      }
    }
  }

  /**
   * A click on the outline: a group's − or + (hide or show its details), or a level button.
   * True when it was one.
   */
  private outlineClick(x: number, y: number): boolean {
    const s = this.sheet, wb = this.wb;
    if (!s || !wb || (!this.OW && !this.OH)) return false;
    const act = (label: string, fn: () => void) => { this.commitEdit(); wb.edit(label, fn, this.place()); this.refresh(); this.host.changed(); };
    // level buttons
    if (this.OW && x < this.OW && y >= this.HH - OUTLINE_STEP - 1 && y < this.HH) {
      const n = Math.floor((x - 3) / OUTLINE_STEP) + 1;
      if (n >= 1 && n <= maxLevel(s, 'row') + 1) act(`Show row level ${n}`, () => showLevel(s, 'row', n));
      return true;
    }
    if (this.OH && y < this.OH && x >= this.HW - OUTLINE_STEP - 1 && x < this.HW) {
      const n = Math.floor((y - 3) / OUTLINE_STEP) + 1;
      if (n >= 1 && n <= maxLevel(s, 'col') + 1) act(`Show column level ${n}`, () => showLevel(s, 'col', n));
      return true;
    }
    // a group's button
    if (this.OW && x < this.OW && y >= this.HH) {
      const level = Math.floor((x - 2) / OUTLINE_STEP) + 1;
      const r = this.hit(this.HW, y).r;
      const g = this.rowOutline.find((o) => o.level === level && o.button === r);
      if (g) act(g.collapsed ? 'Show Detail' : 'Hide Detail', () => setCollapsed(s, 'row', g, !g.collapsed));
      return true;
    }
    if (this.OH && y < this.OH && x >= this.HW) {
      const level = Math.floor((y - 2) / OUTLINE_STEP) + 1;
      const c = this.hit(x, this.HH).c;
      const g = this.colOutline.find((o) => o.level === level && o.button === c);
      if (g) act(g.collapsed ? 'Show Detail' : 'Hide Detail', () => setCollapsed(s, 'col', g, !g.collapsed));
      return true;
    }
    return false;
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
  select(range: Range, active: Cursor = { r: range.r1, c: range.c1 }, anchor: Cursor = active, reveal = true, more?: Range[]): void {
    const s = this.sheet;
    if (!s) return;
    const r = normRange({ r1: clampR(range.r1), c1: clampC(range.c1), r2: clampR(range.r2), c2: clampC(range.c2) });
    this.sels.set(s, { active: { r: clampR(active.r), c: clampC(active.c) }, anchor: { r: clampR(anchor.r), c: clampC(anchor.c) }, range: r, ...(more?.length ? { more } : {}) });
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

  /** Grow the selection from its anchor to a cell (the last block, when several are selected). */
  private extendTo(r: number, c: number, reveal = true): void {
    const sel = this.sel;
    const range = growToMerges(this.sheet!, { r1: sel.anchor.r, c1: sel.anchor.c, r2: r, c2: c });
    this.select(range, sel.active, sel.anchor, false, sel.more);
    if (reveal) this.reveal(r, c);
  }

  /** Every block selected: the one being worked in first. */
  areas(): Range[] {
    const sel = this.sel;
    return [sel.range, ...(sel.more ?? [])];
  }

  /** Select several blocks (Go To Special, Find All); the active cell is the first block's corner unless given. */
  selectAreas(areas: Range[], active?: Cursor): void {
    if (!areas.length) return;
    const i = active ? Math.max(0, areas.findIndex((a) => inRange(a, active.r, active.c))) : 0;
    const first = areas[i];
    const at = active && inRange(first, active.r, active.c) ? active : { r: first.r1, c: first.c1 };
    this.select(first, at, at, true, areas.filter((_, j) => j !== i));
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

  /** Insert > Symbol: type text at the caret in the cell being typed in, or start typing in the active cell (keeping what is there). */
  typeText(text: string): boolean {
    if (!this.sheet) return false;
    if (!this.editing) this.editCell();
    if (!this.editing) return false;
    const inp = this.input;
    inp.setRangeText(text, inp.selectionStart ?? inp.value.length, inp.selectionEnd ?? inp.value.length, 'end');
    this.host.typing(inp.value);
    this.fitInput();
    return true;
  }

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

  /**
   * Put what was typed into the cell. False when nothing was being typed. Typing that breaks the
   * cell's data validation rule stays in the cell while its alert asks what to do (`force` puts
   * it in anyway).
   */
  commitEdit(dr = 0, dc = 0, allSelected = false, force = false): boolean {
    const e = this.editing;
    const wb = this.wb;
    if (!e || !wb) return false;
    const s = wb.sheet;
    const text = this.input.value;
    if (this.alerting) return true;
    const rule = !force && text !== e.original && this.host.invalid ? s.validationAt(e.r, e.c) : undefined;
    if (rule && !rule.noAlert && !this.typedPasses(s, rule, e.r, e.c, text)) {
      this.alerting = true;
      void this.host.invalid!(rule, text).then((what) => {
        this.alerting = false;
        if (this.editing !== e) return;
        if (what === 'keep') this.commitEdit(dr, dc, allSelected, true);
        else if (what === 'cancel') this.cancelEdit();
        else { this.input.focus(); this.input.select(); }
      });
      return true;
    }
    this.editing = null;
    this.pointRef = null;
    this.input.hidden = true;
    this.copied = null;
    if (text !== e.original) {
      const areas = this.areas();
      wb.edit('Typing', () => {
        if (allSelected) {
          // Ctrl+Enter: the same typing in every selected cell, in every block (formulas move with each cell)
          const block = { rows: 1, cols: 1, cells: [[{ input: text }]], origin: { row: e.r, col: e.c } };
          for (const sel of areas) {
            for (let r = sel.r1; r <= Math.min(sel.r2, Math.max(s.lastRow, e.r, sel.r1) + 1); r++) for (let c = sel.c1; c <= Math.min(sel.c2, Math.max(s.lastCol, e.c, sel.c1) + 1); c++) {
              if (text.startsWith('=')) s.paste({ row: r, col: c }, block, 'values');
              else s.setInput(r, c, text);
            }
          }
        } else {
          this.typeInto(s, e.r, e.c, text);
          this.widenForDate(s, e.r, e.c, text);
        }
      }, this.place());
      this.metricsKey = '';
      if (!allSelected && text.trim() && !text.startsWith('=')) this.host.typed?.(e.r, e.c, text.trim());
    }
    this.host.typing(null);
    this.scroller.focus({ preventScroll: true });
    if (dr || dc) this.moveWithin(dr, dc);
    else this.render();
    this.host.changed();
    return true;
  }

  /** Excel widens a column still at its first width to fit a date or time typed in it, rather than show ####. */
  private widenForDate(s: Sheet, r: number, c: number, text: string): void {
    if (s.colWidths.has(c) || !text.trim()) return;
    const typed = readTyped(text);
    const style = s.styleAt(r, c);
    const fmt = style?.numFmt ?? typed.format;
    if (!fmt || !/[dmyh]/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]/g, '')) || /[0#?]/.test(fmt)) return;
    const v = typed.formula ? this.wb!.formulaAt(s, text, { row: r, col: c }, r, c) : typed.value;
    if (typeof v !== 'number') return;
    const w = this.textWidth(formatValue(v, fmt).text, this.font(style, 1)) + 10;
    if (w > DEFAULT_COL_W) s.setColWidth(c, Math.min(600, Math.ceil(w)));
  }

  /** Would typing this into a cell pass its rule? (A formula's answer isn't known yet, so it passes, and Circle Invalid Data finds it.) */
  private typedPasses(s: Sheet, rule: Validation, r: number, c: number, text: string): boolean {
    const typed = readTyped(text);
    if (typed.formula) return true;
    const shown = formatValue(typed.value, s.styleAt(r, c)?.numFmt ?? typed.format).text;
    return passes(rule, typed.value, shown, s, this.wb!.validationHost(s), r, c);
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
    if (sel.more?.length) { this.moveAcrossAreas(dr || dc); return; }
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

  /** Enter and Tab with several blocks selected: on through each block, then into the next (as in Excel). */
  private moveAcrossAreas(dir: number): void {
    const sel = this.sel;
    const R = sel.range, { r, c } = sel.active;
    const width = R.c2 - R.c1 + 1, size = width * (R.r2 - R.r1 + 1);
    const i = (r - R.r1) * width + (c - R.c1) + dir;
    if (i >= 0 && i < size) {
      this.sels.set(this.sheet!, { ...sel, active: { r: R.r1 + Math.floor(i / width), c: R.c1 + (i % width) } });
    } else {
      // the next block becomes the one worked in, starting at its first cell (or its last, going back)
      const all = [R, ...sel.more!];
      const next = all[(dir > 0 ? 1 : all.length - 1) % all.length];
      const rest = dir > 0 ? [...all.slice(2), R] : [R, ...all.slice(1, -1)];
      const at = dir > 0 ? { r: next.r1, c: next.c1 } : { r: next.r2, c: next.c2 };
      this.sels.set(this.sheet!, { active: at, anchor: at, range: next, more: rest });
    }
    this.reveal(this.sel.active.r, this.sel.active.c);
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
    if (k === 'F3' && this.host.f3) { e.preventDefault(); this.host.f3(e); return; }
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
    if (this.objSel !== null && this.objectKey(e)) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    // Alt+Down: the cell's drop-down list, as in Excel
    if (k === 'ArrowDown' && e.altKey && !ctrl) { e.preventDefault(); this.openDropDown(); return; }
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
      this.scroller.scrollTop += (k === 'PageDown' ? 1 : -1) * (this.scroller.clientHeight - this.HH - 40);
      return;
    }
    if (k === 'F2' && !e.shiftKey && !ctrl) { e.preventDefault(); this.editCell(); return; }
    if (k === 'F3' && this.host.f3) { e.preventDefault(); this.host.f3(e); return; }
    if (k === 'Escape') {
      if (this.copied) { this.copied = null; this.render(); }
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
    const areas = this.areas();
    wb.edit('Clear', () => { for (const r of areas) s.clear(r, 'contents'); }, this.place());
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
    if (y < this.HH && x > this.HW) {
      const g = this.regionAt(x, y);
      const sheetX = x - g.x + g.ox;
      const c = this.cols.at(sheetX);
      const left = this.cols.pos(c), right = left + this.cols.size(c);
      if (right - sheetX <= 4) return { kind: 'col', index: c };
      if (sheetX - left <= 3 && c > 0) {
        let p = c - 1;
        while (p > 0 && this.cols.size(p) === 0) p--;
        return { kind: 'col', index: p };
      }
    }
    if (x < this.HW && y > this.HH) {
      const g = this.regionAt(x, y);
      const sheetY = y - g.y + g.oy;
      const r = this.rows.at(sheetY);
      const top = this.rows.pos(r), bottom = top + this.rows.size(r);
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
    if (this.overDrop(x, y)) {
      this.commitEdit();
      if (!this.editing) this.openDropDown();
      return;
    }
    if (this.outlineClick(x, y)) return;
    if (this.pageGrid && this.headerFooterAt(x, y) && e.detail >= 2) { this.commitEdit(); this.host.headerFooter?.(); return; }
    const pb = this.breakAt(x, y);
    if (pb) {
      this.commitEdit();
      this.scroller.setPointerCapture(e.pointerId);
      this.drag = { kind: 'break', pointer: e.pointerId, axis: pb.axis, from: pb.at };
      this.breakPreview = { axis: pb.axis, at: pb.axis === 'row' ? y : x };
      return;
    }
    const fb = this.filterButtonAt(x, y);
    if (fb !== null) {
      this.commitEdit();
      const rect = this.cellRect(this.sheet!.filter!.range.r1, fb)!;
      const b = this.scroller.getBoundingClientRect();
      this.host.filterMenu(fb, { x: b.left + rect.x + rect.w - 16, y: b.top + rect.y + rect.h });
      return;
    }
    const onObj = this.pointing() ? null : this.objectAt(x, y);
    if (onObj) {
      this.commitEdit();
      this.scroller.focus({ preventScroll: true });
      this.scroller.setPointerCapture(e.pointerId);
      this.pickObject(onObj.o.id);
      this.drag = { kind: 'object', pointer: e.pointerId, id: onObj.o.id, how: onObj.how, x0: x, y0: y, orig: onObj.o, moved: false };
      return;
    }
    if (this.objSel !== null) this.pickObject(null);
    const onChart = this.pointing() ? null : this.chartAt(x, y);
    if (onChart) {
      this.commitEdit();
      this.scroller.focus({ preventScroll: true });
      this.scroller.setPointerCapture(e.pointerId);
      // a click on a treemap or decomposition tree already picked drills into it or expands it
      const picked = onChart.chart.id === this.chartSel;
      this.pickChart(onChart.chart.id);
      this.drag = { kind: 'chart', pointer: e.pointerId, id: onChart.chart.id, how: onChart.how, series: onChart.series, x0: x, y0: y, orig: onChart.chart, moved: false, picked };
      return;
    }
    if (this.chartSel !== null) this.pickChart(null);
    const bar = this.splitBarAt(x, y);
    if (bar) {
      this.commitEdit();
      this.scroller.setPointerCapture(e.pointerId);
      this.drag = { kind: 'split', pointer: e.pointerId, axis: bar };
      return;
    }
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
    // typing that broke its cell's rule stays until its alert is answered
    if (this.editing) return;
    // a cell's link: Ctrl+click follows it (or a plain click, if Edit > Typing and Spelling says so)
    if (h.where === 'cell' && !e.shiftKey && !e.altKey) {
      const link = this.linkOf(h.r, h.c);
      if (link && (e.ctrlKey || e.metaKey || !typingPrefs.linkCtrlClick)) {
        this.selectCell(h.r, h.c);
        void followLink(link);
        return;
      }
    }
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
    else if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      // Ctrl+click: another block, keeping those selected (as in Excel)
      const sel = this.sel, m = this.sheet!.mergeAt(h.r, h.c);
      this.select(m ?? { r1: h.r, c1: h.c, r2: h.r, c2: h.c }, { r: m?.r1 ?? h.r, c: m?.c1 ?? h.c }, undefined, false, [...(sel.more ?? []), sel.range]);
    } else this.selectCell(h.r, h.c);
    this.drag = { kind: 'select', pointer: e.pointerId };
  }

  /** How many rows (columns) of the standard size fit in the window. */
  visibleRows(): number {
    return Math.floor((this.scroller.clientHeight - this.HH) / (DEFAULT_ROW_H * this.zoom));
  }

  visibleCols(): number {
    return Math.floor((this.scroller.clientWidth - this.HW) / (DEFAULT_COL_W * this.zoom));
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
      const ob = this.objectAt(x, y);
      if (ob) {
        const cur: Record<string, string> = { move: 'move', start: 'crosshair', end: 'crosshair', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
        this.scroller.style.cursor = this.objSel === ob.o.id ? cur[ob.how] : 'pointer';
        if (this.hoverTip !== (ob.o.descr ?? '')) { this.hoverTip = ob.o.descr ?? ''; this.scroller.title = this.hoverTip; }
        this.setHovered(null);
        return;
      }
      const ch = this.chartAt(x, y);
      if (ch) {
        const cur: Record<string, string> = { move: 'move', label: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
        this.scroller.style.cursor = this.chartSel === ch.chart.id ? cur[ch.how] : 'pointer';
        if (this.hoverTip) { this.hoverTip = ''; this.scroller.title = ''; }
        this.setHovered(null);
        return;
      }
      const brk = this.breakAt(x, y);
      if (brk) { this.scroller.style.cursor = brk.axis === 'row' ? 'row-resize' : 'col-resize'; return; }
      if ((this.OW && x < this.OW) || (this.OH && y < this.OH)) { this.scroller.style.cursor = 'pointer'; return; }
      const border = this.borderAt(x, y);
      const h = this.hit(x, y);
      const bar = this.splitBarAt(x, y);
      this.setHovered(h.where === 'cell' && this.sheet?.noteAt(h.r, h.c) ? { r: h.r, c: h.c } : null);
      this.scroller.style.cursor = bar ? (bar === 'row' ? 'row-resize' : 'col-resize') : border ? (border.kind === 'col' ? 'col-resize' : 'row-resize')
        : this.filterButtonAt(x, y) !== null ? 'pointer'
          : !this.editing && h.where === 'cell' && this.onFillHandle(x, y) ? 'crosshair'
            : h.where === 'col' ? 's-resize' : h.where === 'row' ? 'e-resize'
              // a structure: a hand, since a double-click opens it for drawing
              : h.where === 'cell' && this.painter ? BRUSH
                : h.where === 'cell' && this.sheet?.cell(h.r, h.c)?.structure ? 'pointer' : 'cell';
      const overDrop = this.overDrop(x, y);
      if (overDrop) this.scroller.style.cursor = 'pointer';
      // a note's card says what a tip would (and the drop-down's button what it is)
      const tip = overDrop ? 'Pick from the list (Alt+Down)' : h.where === 'cell' && !this.sheet?.noteAt(h.r, h.c) ? this.tipFor(h.r, h.c) : '';
      if (tip !== this.hoverTip) { this.hoverTip = tip; this.scroller.title = tip; }
      return;
    }
    if (e.pointerId !== d.pointer) return;
    if (d.kind === 'chart') { this.dragChart(d, x, y); return; }
    if (d.kind === 'split') { this.splitPreview = { axis: d.axis, at: d.axis === 'row' ? y : x }; this.render(); return; }
    if (d.kind === 'break') { this.breakPreview = { axis: d.axis, at: d.axis === 'row' ? y : x }; this.render(); return; }
    if (d.kind === 'object') { this.dragObject(d, x, y, e.shiftKey); return; }
    this.autoScroll(x, y);
    const h = this.hit(Math.max(this.HW + 1, x), Math.max(this.HH + 1, y));
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
  /** A split bar being dragged: where it would go. */
  private splitPreview: { axis: 'row' | 'col'; at: number } | null = null;

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
    if (d.kind === 'split') {
      const p = this.splitPreview;
      this.splitPreview = null;
      if (p) this.dropSplitBar(p.axis, p.at);
      this.render();
      return;
    }
    if (d.kind === 'break') {
      const p = this.breakPreview;
      this.breakPreview = null;
      if (p) {
        // the nearest edge between rows (or columns) to where it was let go
        const { x, y } = this.viewPoint(e);
        const g = this.regionAt(x, y);
        const axis = d.axis === 'row' ? this.rows : this.cols;
        const at = d.axis === 'row' ? y - g.y + g.oy : x - g.x + g.ox;
        let i = axis.at(at);
        if (at - axis.pos(i) > axis.size(i) / 2) i++;
        const ps = s.pageSetup;
        if (i > 0 && i !== d.from) {
          const key = d.axis === 'row' ? 'rowBreaks' : 'colBreaks';
          // fitting to pages ignores breaks put in by hand, so dragging one turns fitting off (as Excel does)
          wb.edit('Move page break', () => s.setPageSetup(withSetup(ps, { [key]: toggleBreak(toggleBreak(ps?.[key], d.from, false), i, true), fit: undefined })), this.place());
          this.host.changed();
        }
      }
      this.render();
      return;
    }
    if (d.kind === 'object') {
      const p = this.objPreview;
      this.objPreview = null;
      if (p && d.moved) this.replaceObject(p, d.how === 'move' ? 'Move' : 'Resize');
      this.render();
      return;
    }
    if (d.kind === 'chart') {
      const p = this.chartPreview;
      this.chartPreview = null;
      if (p && d.moved) this.replaceChart(p, d.how === 'move' ? 'Move chart' : d.how === 'label' ? 'Move equation' : 'Resize chart');
      else if (!d.moved && d.picked && d.how === 'move' && (d.orig.kind === 'treemap' || d.orig.kind === 'decomp')) this.chartPartClick(d.orig, d.x0, d.y0);
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
    } else if ((d.kind === 'select' || d.kind === 'rows' || d.kind === 'cols') && this.painter) {
      this.painter();
    }
    this.render();
  }

  private autoScroll(x: number, y: number): void {
    const sc = this.scroller;
    const step = 18;
    if (y > sc.clientHeight - 10) sc.scrollTop += step;
    else if (y < this.HH + 4 && sc.scrollTop > 0) sc.scrollTop -= step;
    if (x > sc.clientWidth - 10) sc.scrollLeft += step;
    else if (x < this.HW + 4 && sc.scrollLeft > 0) sc.scrollLeft -= step;
  }

  private onDouble(e: MouseEvent): void {
    if (!this.wb) return;
    const { x, y } = this.viewPoint(e);
    const bar = this.splitBarAt(x, y);
    if (bar) { this.dropSplitBar(bar, 0); return; }
    const onObj = this.objectAt(x, y);
    if (onObj) { this.host.editObject?.(onObj.o.id); return; }
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
      const look = this.chemLook(style, s.values.get(k) ?? null);
      if (c.structure) continue;
      w = Math.max(w, (look?.chem ? this.piecesWidth(s.shownText(r, index), look) / this.zoom : this.textWidth(s.shownText(r, index), this.font(style, 1))) + 10);
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
    const onObj = this.objectAt(x, y);
    if (onObj) {
      this.commitEdit();
      this.pickObject(onObj.o.id);
      this.host.contextMenu(e.clientX, e.clientY, 'object');
      return;
    }
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
    if (!(e.ctrlKey || e.metaKey)) { this.wheelPane(e); return; }
    e.preventDefault();
    this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }

  /** The wheel over a split window's upper or left pane scrolls that pane. */
  private wheelPane(e: WheelEvent): void {
    if (!this.sheet) return;
    const { SH, SW, x0, y0 } = this.frozen();
    if (!SH && !SW) return;
    const { x, y } = this.viewPoint(e);
    const inTop = !!SH && y >= this.HH && y < y0, inLeft = !!SW && x >= this.HW && x < x0;
    if (!inTop && !inLeft) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    const p = this.panes();
    if (inTop) p.top = Math.max(0, Math.min(this.rows.total, p.top + dy)); else this.scroller.scrollTop += dy;
    if (inLeft) p.left = Math.max(0, Math.min(this.cols.total, p.left + dx)); else this.scroller.scrollLeft += dx;
    this.growExtent();
    this.render();
  }

  /** A split bar let go at a point: the split moves to the nearest row or column edge (or goes, at the edge of the grid). */
  private dropSplitBar(axis: 'row' | 'col', at: number): void {
    const s = this.sheet!, wb = this.wb!;
    const cur = s.split ?? { rows: 0, cols: 0 };
    // the upper pane is as tall as the rows above the split (the left pane as wide as the columns left of it)
    let n = 0;
    if (axis === 'row' && at > this.HH + 4) n = Math.max(1, this.rows.at(at - this.HH + this.rows.size(0) / 2));
    if (axis === 'col' && at > this.HW + 4) n = Math.max(1, this.cols.at(at - this.HW + this.cols.size(0) / 2));
    // a pane can't push the other off the screen
    if (axis === 'row' && at > this.scroller.clientHeight - 40) n = 0;
    if (axis === 'col' && at > this.scroller.clientWidth - 40) n = 0;
    const next = axis === 'row' ? { rows: n, cols: cur.cols } : { rows: cur.rows, cols: n };
    wb.edit(next.rows || next.cols ? 'Move split' : 'Remove split', () => s.setSplit(next), this.place());
    this.metricsKey = '';
  }

  /** View > Split: split the window above and left of a cell (the top left cell: no split), each pane scrolled to go on from the one before. */
  splitAt(rows: number, cols: number): void {
    const s = this.sheet, wb = this.wb;
    if (!s || !wb) return;
    const keepTop = this.scroller.scrollTop, keepLeft = this.scroller.scrollLeft;
    wb.edit(rows || cols ? 'Split' : 'Remove split', () => s.setSplit(rows || cols ? { rows, cols } : null), this.place());
    this.metricsKey = '';
    this.layout();
    // the upper and left panes show what showed there; the others go on from them
    this.paneScroll.set(s, { top: rows ? keepTop : 0, left: cols ? keepLeft : 0 });
    if (rows) this.scroller.scrollTop = keepTop + this.rows.pos(rows);
    if (cols) this.scroller.scrollLeft = keepLeft + this.cols.pos(cols);
    this.render();
  }

  /** Before a split window's panes are frozen: scroll back by the split's rows and columns, so the cells below and right of them stay where they were. */
  keepPlaceForFreeze(): void {
    const sp = this.sheet?.split;
    if (!sp) return;
    this.layout();
    if (sp.rows) this.scroller.scrollTop = Math.max(0, this.scroller.scrollTop - this.rows.pos(sp.rows));
    if (sp.cols) this.scroller.scrollLeft = Math.max(0, this.scroller.scrollLeft - this.cols.pos(sp.cols));
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
    this.metricsKey = '';
    this.render();
    this.host.flash(`Zoom ${Math.round(this.zoom * 100)}%`, 900);
  }

  // ---------------------------------------------------------------- notes, drop-downs and input messages

  private setHovered(cell: Cursor | null): void {
    const was = this.hovered;
    if (was === cell || (was && cell && was.r === cell.r && was.c === cell.c)) return;
    this.hovered = cell;
    this.host.hoverNote?.(cell, cell ? this.screenRect(cell.r, cell.c) : null);
  }

  /** A cell's box on the screen (for cards and menus beside it), or null when out of sight. */
  screenRect(r: number, c: number): DOMRect | null {
    const rect = this.cellRect(r, c);
    if (!rect) return null;
    const b = this.scroller.getBoundingClientRect();
    return new DOMRect(b.left + rect.x, b.top + rect.y, rect.w, rect.h);
  }

  /** A cell's box within the scrolling area (for boxes laid over the cells there). */
  layerRect(r: number, c: number): { x: number; y: number; w: number; h: number } | null {
    const rect = this.cellRect(r, c);
    return rect ? { x: rect.x + this.scroller.scrollLeft, y: rect.y + this.scroller.scrollTop, w: rect.w, h: rect.h } : null;
  }

  /** The list rule of the active cell, when it shows a drop-down. */
  private dropRule(): Validation | undefined {
    const s = this.sheet;
    if (!s || s.dashboard || !s.validations.length) return undefined;
    const v = s.validationAt(this.sel.active.r, this.sel.active.c);
    return v?.kind === 'list' && !v.noDropDown ? v : undefined;
  }

  /** The drop-down button beside the active cell (view coordinates), when it has one. */
  private dropBtn: { x: number; y: number; w: number; h: number } | null = null;

  private overDrop(x: number, y: number): boolean {
    const b = this.dropBtn;
    return !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  private drawDropButton(): void {
    this.dropBtn = null;
    if (!this.dropRule() || this.chartSel !== null) return;
    const { r, c } = this.sel.active;
    const rect = this.cellRect(r, c);
    if (!rect) return;
    const size = Math.max(12, Math.min(17, rect.h - 1));
    // just right of the cell, as Excel puts it
    const x = rect.x + rect.w + 1, y = rect.y + rect.h - size;
    if (x < this.HW || y < this.HH) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#f3f4f6';
    ctx.strokeStyle = '#9aa3b5';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, size, size);
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.fillStyle = '#3a414d';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.28, y + size * 0.4); ctx.lineTo(x + size * 0.72, y + size * 0.4); ctx.lineTo(x + size * 0.5, y + size * 0.66);
    ctx.fill();
    this.dropBtn = { x, y, w: size, h: size };
  }

  /** Open the active cell's drop-down (its list, or the column's entries, as Excel's Pick From Drop-down List). */
  openDropDown(): void {
    const s = this.sheet;
    if (!s || this.editing) return;
    const { r, c } = this.sel.active;
    const rect = this.screenRect(r, c);
    if (!rect) return;
    this.host.dropDown?.(r, c, { x: rect.left, y: rect.bottom });
  }

  private placePrompt(): void {
    const box = this.promptBox;
    const s = this.sheet;
    const v = s && !s.dashboard && s.validations.length && this.chartSel === null ? s.validationAt(this.sel.active.r, this.sel.active.c) : undefined;
    const text = v && !v.hidePrompt ? (v.prompt ?? '') : '';
    const title = v && !v.hidePrompt ? (v.promptTitle ?? '') : '';
    const rect = text || title ? this.cellRect(this.sel.active.r, this.sel.active.c) : null;
    if (!rect) { box.hidden = true; return; }
    const key = `${title}\n${text}`;
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.replaceChildren();
      if (title) { const b = document.createElement('b'); b.textContent = title; box.append(b); }
      if (text) { const p = document.createElement('div'); p.textContent = text; box.append(p); }
    }
    box.hidden = false;
    // under the cell and a little to its right, as Excel shows it
    box.style.left = `${rect.x + Math.min(rect.w / 2, 40) + this.scroller.scrollLeft}px`;
    box.style.top = `${rect.y + rect.h + 6 + this.scroller.scrollTop}px`;
  }

  /** Red rings round the cells that break their rules (Data > Circle Invalid Data). */
  private drawCircles(regions: Region[]): void {
    const s = this.sheet!;
    if (!this.circleInvalid || !s.validations.length || !regions.length) return;
    if (!this.circles || this.circles.gen !== s.valuesGen || this.circles.sheet !== s || this.circles.rules !== s.validations) {
      this.circles = { gen: s.valuesGen, sheet: s, rules: s.validations, cells: invalidCells(s, this.wb!.validationHost(s)) };
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.HW, this.HH, this.scroller.clientWidth, this.scroller.clientHeight);
    ctx.clip();
    ctx.strokeStyle = '#e02020';
    ctx.lineWidth = 1.6;
    for (const { row, col } of this.circles.cells) {
      if (s.hiddenRows.has(row) || s.hiddenCols.has(col)) continue;
      const rect = this.cellRect(row, col);
      if (!rect) continue;
      ctx.beginPath();
      ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2 + 4, rect.h / 2 + 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** How many cells break their rules on the sheet showing. */
  invalidCount(): number {
    const s = this.sheet;
    return s && this.wb ? invalidCells(s, this.wb.validationHost(s)).length : 0;
  }

  /** A tip for a cell: an error's reason, or that a value was typed over a calculated one. */
  /** Where a cell links to: its own link, or the address in its HYPERLINK formula. */
  linkOf(r: number, c: number): string | null {
    const cell = this.sheet?.cell(r, c);
    return cell?.link ?? linkOfFormula(cell?.input);
  }

  private tipFor(r: number, c: number): string {
    const s = this.sheet!;
    const link = this.linkOf(r, c);
    if (link) return linkTip(link, typingPrefs.linkCtrlClick);
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
