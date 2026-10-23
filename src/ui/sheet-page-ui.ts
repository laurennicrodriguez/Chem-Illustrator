// Sheet mode's Page Layout tab: margins, orientation, paper size, the print area, page breaks,
// print titles, scaling (a percentage or fit to pages), printing gridlines and headings, the Page
// Setup window and the Header and Footer window.

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import { ask, Field } from './ask';
import type { Sheet } from '../sheet/workbook';
import { Range, MAX_ROWS, MAX_COLS, colName, rangeName } from '../sheet/refs';
import {
  PageSetup, HeaderFooter, SHEET_PAPERS, PaperName, MARGIN_PRESETS, DEFAULT_MARGINS, withSetup, toggleBreak,
  codesToWords, wordsToCodes,
} from '../sheet/page-setup';
import { readBlock } from '../io/xlsx-print';
import { defaultPaper } from '../print-layout';

export interface PageHost {
  readonly view: SheetView;
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
}

const PAPER_KEYS = Object.keys(SHEET_PAPERS) as PaperName[];

/** Ranges as typed (A1:D20, $1:$2, A:B), several split by commas. */
function readRanges(text: string): Range[] | null {
  const out: Range[] = [];
  for (const part of text.split(',').map((p) => p.trim().replace(/^.*!/, '')).filter(Boolean)) {
    const R = readBlock(part);
    if (!R || R.c1 < 0 || R.c2 < 0) return null;
    out.push(R);
  }
  return out;
}

const rowsText = (t: [number, number] | undefined) => (t ? `$${t[0] + 1}:$${t[1] + 1}` : '');
const colsText = (t: [number, number] | undefined) => (t ? `$${colName(t[0])}:$${colName(t[1])}` : '');

export class SheetPage {
  constructor(private host: PageHost) {}

  private get view(): SheetView { return this.host.view; }
  private get sheet(): Sheet { return this.view.sheet!; }
  get setup(): PageSetup | null { return this.sheet.pageSetup; }

  /** Change part of the page setup (one undo step). */
  set(label: string, patch: Partial<PageSetup>): void {
    this.host.edit(label, (s) => s.setPageSetup(withSetup(s.pageSetup, patch)));
  }

  marginsMenu(x: number, y: number): void {
    const cur = this.setup?.margins ?? DEFAULT_MARGINS;
    const same = (m: typeof cur) => (Object.keys(m) as (keyof typeof m)[]).every((k) => Math.abs(m[k] - cur[k]) < 1e-6);
    popupMenu(x, y, [
      ...(Object.keys(MARGIN_PRESETS) as (keyof typeof MARGIN_PRESETS)[]).map((k) => {
        const p = MARGIN_PRESETS[k];
        return [`${same(p.m) ? '✓ ' : ''}${p.name}: ${p.m.left}″ sides, ${p.m.top}″ top and bottom`, () => this.set('Margins', { margins: k === 'normal' ? undefined : p.m })] as [string, () => void];
      }),
      null,
      ['Custom Margins…', () => void this.pageSetupWindow('margins')],
    ]);
  }

  orientationMenu(x: number, y: number): void {
    const o = this.setup?.orientation ?? 'portrait';
    popupMenu(x, y, [
      [`${o === 'portrait' ? '✓ ' : ''}Portrait`, () => this.set('Orientation', { orientation: undefined })],
      [`${o === 'landscape' ? '✓ ' : ''}Landscape`, () => this.set('Orientation', { orientation: 'landscape' })],
    ]);
  }

  sizeMenu(x: number, y: number): void {
    const cur = this.setup?.paper ?? defaultPaper(navigator.language);
    popupMenu(x, y, PAPER_KEYS.map((k) => [`${k === cur ? '✓ ' : ''}${SHEET_PAPERS[k].name}`, () => this.set('Paper size', { paper: k })]));
  }

  printAreaMenu(x: number, y: number): void {
    const has = !!this.setup?.printArea?.length;
    popupMenu(x, y, [
      ['Set Print Area', () => this.setPrintArea(false)],
      ['Add to Print Area', () => this.setPrintArea(true), has],
      ['Clear Print Area', () => this.set('Clear print area', { printArea: undefined }), has],
    ]);
  }

  /** The selected cells become the print area (or another block of it, printed on pages of its own). */
  setPrintArea(add: boolean): void {
    const R = this.view.sel.range;
    // whole rows or columns: only as far as the sheet is in use
    const s = this.sheet;
    const block: Range = { r1: R.r1, c1: R.c1, r2: R.r2 >= MAX_ROWS - 1 ? Math.max(R.r1, s.lastRow) : R.r2, c2: R.c2 >= MAX_COLS - 1 ? Math.max(R.c1, s.lastCol) : R.c2 };
    const list = add ? [...(this.setup?.printArea ?? []), block] : [block];
    this.set(add ? 'Add to print area' : 'Set print area', { printArea: list });
    this.view.showPageBreaks = true;
    this.host.flash(`Print area: ${list.map(rangeName).join(', ')}. ${list.length > 1 ? 'Each block prints on pages of its own.' : 'Only these cells print.'}`, 5000);
  }

  breaksMenu(x: number, y: number): void {
    const ps = this.setup;
    const has = !!(ps?.rowBreaks?.length || ps?.colBreaks?.length);
    popupMenu(x, y, [
      ['Insert Page Break', () => this.insertBreak()],
      ['Remove Page Break', () => this.removeBreak(), has],
      ['Reset All Page Breaks', () => this.set('Reset page breaks', { rowBreaks: undefined, colBreaks: undefined }), has],
    ]);
  }

  /**
   * Excel's Insert Page Break: above the active cell and to its left (only above it in the first
   * column or with whole rows selected, only to its left in the first row or with whole columns).
   */
  insertBreak(): void {
    const v = this.view, R = v.sel.range, { r, c } = v.sel.active;
    const wholeRows = R.c1 === 0 && R.c2 >= MAX_COLS - 1, wholeCols = R.r1 === 0 && R.r2 >= MAX_ROWS - 1;
    const row = wholeCols ? 0 : wholeRows ? R.r1 : r, col = wholeRows ? 0 : wholeCols ? R.c1 : c;
    if (!row && !col) { this.host.flash('Pick a cell below or to the right of where the new page should start.'); return; }
    const ps = this.setup;
    this.set('Insert page break', { rowBreaks: row ? toggleBreak(ps?.rowBreaks, row, true) : ps?.rowBreaks, colBreaks: col ? toggleBreak(ps?.colBreaks, col, true) : ps?.colBreaks });
    this.view.showPageBreaks = true;
    if (ps?.fit) this.host.flash('Fit to pages is on, which ignores page breaks put in by hand (as Excel does). Set Width and Height to Automatic to use them.', 7000);
  }

  removeBreak(): void {
    const { r, c } = this.view.sel.active;
    const ps = this.setup;
    if (!ps?.rowBreaks?.includes(r) && !ps?.colBreaks?.includes(c)) { this.host.flash('There is no page break above or to the left of this cell.'); return; }
    this.set('Remove page break', { rowBreaks: toggleBreak(ps.rowBreaks, r, false), colBreaks: toggleBreak(ps.colBreaks, c, false) });
  }

  /** Width or Height on the Scale to Fit group: Automatic, or so many pages. */
  fitMenu(x: number, y: number, which: 'wide' | 'tall'): void {
    const fit = this.setup?.fit;
    const cur = fit ? fit[which] : 0;
    const pick = (n: number) => {
      const next = { wide: fit?.wide ?? 0, tall: fit?.tall ?? 0, [which]: n };
      this.set('Scale to fit', { fit: next.wide || next.tall ? next : undefined });
    };
    popupMenu(x, y, [
      [`${cur === 0 ? '✓ ' : ''}Automatic`, () => pick(0)],
      ...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => [`${cur === n ? '✓ ' : ''}${n} page${n > 1 ? 's' : ''}`, () => pick(n)] as [string, () => void]),
    ]);
  }

  async scaleWindow(): Promise<void> {
    const got = await ask('Scale', [{ name: 'scale', label: 'Print at', value: String(this.setup?.scale ?? 100), type: 'number', unit: '% of its size' }], { ok: 'Set', note: 'From 10% to 400%. This turns off Fit to pages.' });
    if (!got) return;
    const n = Math.round(Number(got.scale));
    if (!Number.isFinite(n) || n < 10 || n > 400) { this.host.flash('The scale is a percentage from 10 to 400.'); return; }
    this.set('Scale', { scale: n === 100 ? undefined : n, fit: undefined });
  }

  toggle(which: 'gridlines' | 'headings'): void {
    const on = !this.setup?.[which];
    this.set(which === 'gridlines' ? 'Print gridlines' : 'Print headings', { [which]: on || undefined });
  }

  async printTitles(): Promise<void> {
    const ps = this.setup;
    const got = await ask('Print Titles', [
      { name: 'rows', label: 'Rows to repeat at top', value: rowsText(ps?.titleRows), placeholder: '$1:$1', help: 'Rows printed at the top of every page, such as a table\'s header row.' },
      { name: 'cols', label: 'Columns to repeat at left', value: colsText(ps?.titleCols), placeholder: '$A:$A', help: 'Columns printed at the left of every page, such as compound numbers.' },
    ], { ok: 'Set' });
    if (!got) return;
    const rows = got.rows.trim() ? readRanges(got.rows) : [];
    const cols = got.cols.trim() ? readRanges(got.cols) : [];
    if (!rows || !cols) { this.host.flash('Type rows like $1:$2 and columns like $A:$B.'); return; }
    this.set('Print titles', {
      titleRows: rows[0] ? [rows[0].r1, rows[0].r2] : undefined,
      titleCols: cols[0] ? [cols[0].c1, cols[0].c2] : undefined,
    });
  }

  /** The Page Setup window, with everything on it. */
  async pageSetupWindow(focus?: 'margins'): Promise<void> {
    const ps = this.setup ?? {};
    const m = ps.margins ?? DEFAULT_MARGINS;
    const fields: Field[] = [
      { name: 'paper', label: 'Paper size', value: ps.paper ?? defaultPaper(navigator.language), options: PAPER_KEYS.map((k) => ({ value: k, label: SHEET_PAPERS[k].name })) },
      { name: 'orientation', label: 'Orientation', value: ps.orientation ?? 'portrait', options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] },
      { name: 'scaling', label: 'Scaling', value: ps.fit ? 'fit' : 'scale', options: [{ value: 'scale', label: 'Adjust to a percentage' }, { value: 'fit', label: 'Fit to pages' }] },
      { name: 'scale', label: 'Adjust to', value: String(ps.scale ?? 100), type: 'number', unit: '% of normal size' },
      { name: 'wide', label: 'Fit to: pages wide', value: String(ps.fit?.wide ?? 1), type: 'number', help: '0 leaves it as many as it takes.' },
      { name: 'tall', label: 'Fit to: pages tall', value: String(ps.fit?.tall ?? 0), type: 'number' },
      { name: 'firstPage', label: 'First page number', value: ps.firstPage ? String(ps.firstPage) : '', type: 'number', placeholder: 'Auto (1)' },
      { name: 'top', label: 'Top margin', value: String(m.top), type: 'number', unit: 'in' },
      { name: 'bottom', label: 'Bottom margin', value: String(m.bottom), type: 'number', unit: 'in' },
      { name: 'left', label: 'Left margin', value: String(m.left), type: 'number', unit: 'in' },
      { name: 'right', label: 'Right margin', value: String(m.right), type: 'number', unit: 'in' },
      { name: 'header', label: 'Header (from the top)', value: String(m.header), type: 'number', unit: 'in' },
      { name: 'footer', label: 'Footer (from the bottom)', value: String(m.footer), type: 'number', unit: 'in' },
      { name: 'centerH', label: 'Centre on page across', value: String(!!ps.centerH), type: 'checkbox' },
      { name: 'centerV', label: 'Centre on page up and down', value: String(!!ps.centerV), type: 'checkbox' },
      { name: 'area', label: 'Print area', value: (ps.printArea ?? []).map(rangeName).join(','), placeholder: 'Everything in use', help: 'Blocks such as A1:F40; several, split by commas, print on pages of their own.' },
      { name: 'rows', label: 'Rows to repeat at top', value: rowsText(ps.titleRows), placeholder: '$1:$1' },
      { name: 'cols', label: 'Columns to repeat at left', value: colsText(ps.titleCols), placeholder: '$A:$A' },
      { name: 'gridlines', label: 'Print gridlines', value: String(!!ps.gridlines), type: 'checkbox' },
      { name: 'headings', label: 'Print row and column headings', value: String(!!ps.headings), type: 'checkbox' },
      { name: 'order', label: 'Page order', value: ps.order ?? 'down', options: [{ value: 'down', label: 'Down, then over' }, { value: 'over', label: 'Over, then down' }] },
    ];
    // Custom Margins… opens with the margins first
    if (focus === 'margins') fields.sort((a, b) => Number(!/margin|header|footer|center/.test(a.name + a.label.toLowerCase())) - Number(!/margin|header|footer|center/.test(b.name + b.label.toLowerCase())));
    const got = await ask('Page Setup', fields, { ok: 'OK', note: 'Saved with the sheet in .xlsx files, as Excel\'s own page setup. Headers and footers are on the Page Layout tab.' });
    if (!got) return;
    const num = (k: string, d: number, lo: number, hi: number) => { const x = Number(got[k]); return Number.isFinite(x) && got[k].trim() !== '' ? Math.min(hi, Math.max(lo, x)) : d; };
    const area = got.area.trim() ? readRanges(got.area) : [];
    const rows = got.rows.trim() ? readRanges(got.rows) : [];
    const cols = got.cols.trim() ? readRanges(got.cols) : [];
    if (!area || !rows || !cols) { this.host.flash('Type blocks like A1:F40, rows like $1:$2 and columns like $A:$B.'); return; }
    const margins = { left: num('left', m.left, 0, 10), right: num('right', m.right, 0, 10), top: num('top', m.top, 0, 10), bottom: num('bottom', m.bottom, 0, 10), header: num('header', m.header, 0, 10), footer: num('footer', m.footer, 0, 10) };
    const sameMargins = (Object.keys(margins) as (keyof typeof margins)[]).every((k) => Math.abs(margins[k] - DEFAULT_MARGINS[k]) < 1e-6);
    const fit = got.scaling === 'fit' ? { wide: Math.round(num('wide', 1, 0, 100)), tall: Math.round(num('tall', 0, 0, 100)) } : undefined;
    const scale = Math.round(num('scale', 100, 10, 400));
    const first = got.firstPage.trim() ? Math.round(num('firstPage', 1, 1, 10000)) : undefined;
    this.set('Page setup', {
      paper: got.paper === defaultPaper(navigator.language) && !ps.paper ? undefined : (got.paper as PaperName),
      orientation: got.orientation === 'landscape' ? 'landscape' : undefined,
      fit: fit && (fit.wide || fit.tall) ? fit : undefined,
      scale: fit || scale === 100 ? undefined : scale,
      firstPage: first && first !== 1 ? first : undefined,
      margins: sameMargins ? undefined : margins,
      centerH: got.centerH === 'true' || undefined, centerV: got.centerV === 'true' || undefined,
      printArea: area.length ? area : undefined,
      titleRows: rows[0] ? [rows[0].r1, rows[0].r2] : undefined,
      titleCols: cols[0] ? [cols[0].c1, cols[0].c2] : undefined,
      gridlines: got.gridlines === 'true' || undefined, headings: got.headings === 'true' || undefined,
      order: got.order === 'over' ? 'over' : undefined,
    });
  }

  /** The Header and Footer window: three parts each, codes typed as &[Page], &[Pages], &[Date]… */
  async headerFooter(): Promise<void> {
    const ps = this.setup ?? {};
    const words = (h: HeaderFooter | undefined, k: keyof HeaderFooter) => codesToWords(h?.[k] ?? '');
    const SUGGEST = ['&[Page]', 'Page &[Page]', 'Page &[Page] of &[Pages]', '&[Tab]', '&[File]', '&[Date]', '&[Time]', '&[Date] &[Time]', 'Confidential', 'Prepared by '];
    const part = (prefix: string, label: string, h: HeaderFooter | undefined): Field[] => (['left', 'center', 'right'] as const).map((k) => ({
      name: `${prefix}-${k}`, label: `${label}: ${k === 'center' ? 'centre' : k}`, value: words(h, k), suggestions: SUGGEST,
    }));
    const got = await ask('Header and Footer', [
      ...part('h', 'Header', ps.header),
      ...part('f', 'Footer', ps.footer),
      { name: 'first', label: 'Different first page', value: String(!!ps.differentFirst), type: 'checkbox' },
      ...part('fh', 'First page header', ps.firstHeader),
      ...part('ff', 'First page footer', ps.firstFooter),
    ], { ok: 'OK', note: 'Type &[Page] for the page number, &[Pages] for the number of pages, &[Date], &[Time], &[File] for the file\'s name and &[Tab] for the sheet\'s. Saved as Excel\'s own header and footer.' });
    if (!got) return;
    const read = (prefix: string): HeaderFooter | undefined => {
      const h: HeaderFooter = {};
      for (const k of ['left', 'center', 'right'] as const) { const t = wordsToCodes(got[`${prefix}-${k}`] ?? '').trim(); if (t) h[k] = t; }
      return h.left || h.center || h.right ? h : undefined;
    };
    const first = got.first === 'true';
    this.set('Header and footer', {
      header: read('h'), footer: read('f'),
      differentFirst: first || undefined,
      firstHeader: first ? read('fh') : undefined, firstFooter: first ? read('ff') : undefined,
    });
  }
}
