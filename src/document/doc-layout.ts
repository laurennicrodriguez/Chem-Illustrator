// Laying a document out on pages. Each paragraph is laid out by the same text layout as every
// caption and text box (so typing, the caret and selection work the same), once, and again
// only when it changes; the paragraphs' lines are then stacked onto pages. A paragraph can run
// on to the next page, but never leaves its first or last line alone (Word's widow and orphan
// control), headings stay with the paragraph after them, and a page break starts a new page.
//
// The pages sit one under another with a gap between them, all in one set of coordinates (in
// points), and the lines of every page together make one text layout, so the text editing's
// caret, selection and arrow keys run across pages without knowing about them.

import type { CellMargins, Contents, Justify, ParaStyle, TableData, TextRun } from '../model';
import type { DocStyle } from '../style';
import { withStack, layoutText, type Glyphs, type InlineBox, type LaidLine, type Measure, type Narrow, type TextFrame, type TextLayout } from '../text/layout';
import { fitParas, listMarkers, paraCount, splitParagraphs } from '../text/paragraphs';
import { isCovered, rowSpanOf, spanOf } from '../table';
import * as rt from '../richtext';
import { nestedTables, BOX_PAD, FLOAT_GAP, LINE_NUMBER_GAP, OBJECT_CHAR, columnsOf, fieldTexts, floatOf, lookExtent, lookOf, noteStyle, objectsInText, styleOf, FORM_SHADE, type DocObject, type DocText, type HeaderFooter, type NamedStyle, type PageSetup, type WrapKind } from './document';
import { pageNumText, samePaper, sectionOfParas, sectionsOf } from './sections';
import { bibliography, type BibEntry } from './references';
import { emptyTof, tocEntries, tocLines, tofEntries, type TocEntry } from './toc';
import { EMPTY_INDEX, emptyToa, indexItems, listLines, toaItems, type ListItem } from './index-toa';
import { authorColours, hasChanges, markedRuns } from './revisions';
import { layoutMath, type MathBox } from './math';

/** A table row is at least one line of Normal text tall. */
export const SINGLE_ROW = 1.15;

/** Space between pages on screen, in points. */
export const PAGE_GAP = 18;

export interface LayoutDeps {
  measure: Measure;
  /** A drawing's own size in points (that of its picture). */
  drawingSize(contents: Contents, style: DocStyle): { w: number; h: number };
}

/** Outline view: paragraphs left out, and those shown by their first line only. */
export interface ShownParas {
  hidden?: Set<number>;
  firstLine?: Set<number>;
  /** The views without pages: footnotes go after the text, with the endnotes. */
  notesAtEnd?: boolean;
}

/** The short line between the text and its footnotes (or the endnotes): Word's two inches. */
export const NOTE_RULE = 144;

/** A footnote or endnote as placed: its text laid out where it is, its number before it. */
export interface PlacedNote {
  id: number;
  page: number;
  /** Its top left corner and width (the text's lines are in `lay`, already in place). */
  x: number;
  y: number;
  w: number;
  h: number;
  lay: TextLayout;
}

export interface PageBox {
  index: number;
  /** Top of the page in the document's coordinates. */
  top: number;
  /** Its lines: from `first` up to (not including) `end` in the layout's lines. */
  first: number;
  end: number;
  /** The page number as shown ("S3"), or '' where none is shown. */
  label: string;
  /** Its number whether shown or not, as a table of contents lists it. */
  number: string;
  /** Its left edge (narrower pages sit in the middle of wider ones), width and height. */
  x: number;
  w: number;
  h: number;
  /** Its paper and margins, and its header and footer: those of the section it starts in. */
  setup: PageSetup;
  hf: HeaderFooter;
  /** That section's index. */
  section: number;
}

/** A line's number in the margin: its text, right-aligned to end `distance` left of the text (`x` is its left edge), on the line's baseline. */
export interface LineNumber { page: number; x: number; y: number; text: string; size: number; family: string }

/** What the bibliography shows when nothing is cited yet (on screen and in the PDF only). */
export const EMPTY_BIBLIOGRAPHY = 'Bibliography: no references are cited yet. Cite one with References > Insert Citation.';

/**
 * How far a bibliography's entries hang their numbers out: the widest number ("(12)") and a
 * little space, so every entry's text starts at the same place.
 */
export function bibHang(labels: string[], size: number, font: string, measure: Measure): number {
  const family = withStack(font);
  const widest = Math.max(0, ...labels.map((l) => measure(l, size, family, '')));
  return Math.max(1.5 * size, widest + 0.5 * size);
}

/**
 * The bibliography's entries as text: each a paragraph with its number hanging out, the text
 * in italics and bold as the style prints it. A spacer after the number (an object with a
 * negative id, `spacer` its width) brings the text to the hanging indent.
 */
export function bibFrame(entries: BibEntry[], st: NamedStyle, ps: ParaStyle, measure: Measure): { runs: TextRun[]; paras: ParaStyle[]; spacer: (id: number) => number } {
  const font = st.font, size = st.size;
  const base = { font, size };
  if (!entries.length) return { runs: [{ ...base, italic: true, color: '#8a8f98', text: EMPTY_BIBLIOGRAPHY }], paras: [{ line: ps.line }], spacer: () => 0 };
  const hang = bibHang(entries.map((e) => e.label), size, font, measure);
  const family = withStack(font);
  const runs: TextRun[] = [];
  const widths: number[] = [];
  entries.forEach((e, i) => {
    if (i) runs.push({ ...base, text: '\n' });
    runs.push({ ...base, text: e.label }, { ...base, obj: -(i + 1), text: OBJECT_CHAR });
    widths.push(Math.max(0.25 * size, hang - measure(e.label, size, family, '')));
    for (const p of e.pieces) runs.push({ ...rt.cleanStyle({ ...base, italic: p.italic, bold: p.bold }), text: p.text });
  });
  const paras = entries.map((): ParaStyle => ({ indent: hang, firstLine: -hang, line: ps.line }));
  return { runs, paras, spacer: (id) => widths[-id - 1] ?? 0 };
}

export interface PlacedObject {
  id: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The line it is on (in the layout's lines); for a floating one, its anchor paragraph's first line. */
  line: number;
  /** How text wraps round it, when it floats on the page instead of sitting in its line. */
  wrap?: WrapKind;
}

/** A table in the text: its columns and rows, each cell's text, and where each row went. */
export interface TableBox {
  id: number;
  /** Left edge of each column from the table's left, and the right edge of the last one. */
  xs: number[];
  /** Each row's height. */
  hs: number[];
  /** Each cell's text, laid out from the top left of the inside of the cell (null where a cell spans over it). */
  cells: (TextLayout | null)[][];
  /** How far each cell's text is moved down to sit in the middle or at the bottom of its row. */
  drop: number[][];
  /** Each cell's margins (its text starts at its left and top margin). */
  pads: CellMargins[][];
  /** Each row's page and top left corner (in the document's coordinates), as placed. */
  rows: { page: number; x: number; y: number }[];
  /** 0 for a table in the text, 1 for one in a cell of such a table, and so on. */
  depth: number;
}

export { CELL_PAD, GRID_LINE, ACS_LINE } from './table-styles';
import { CELL_PAD, cellMargins, resolveTable, type CellText } from './table-styles';

/** How a cell's text lines up across: its own choice, its column's, or left. */
export function docCellAlign(t: TableData, r: number, c: number): Justify {
  return t.rows[r]?.[c]?.align ?? t.align?.[c] ?? 'left';
}

/** Room a floating figure keeps clear on its page, from the top left of the margins (gap included). */
export interface WrapRect { x1: number; y1: number; x2: number; y2: number; wrap: WrapKind }

/** Less room than this beside a figure (an inch) and text goes below it instead (as Word does). */
export const MIN_BESIDE = 72;

/**
 * The room a document line gives up to floating figures beside it. `y1`–`y2` is the line's
 * box (from the top of the margins), `textW` the width between them. Text wraps on the wider
 * side of a figure ("square"), or moves down past it ("top and bottom", or when too little
 * room is left beside it).
 */
export function narrowLine(rects: WrapRect[], y1: number, y2: number, textW: number): Narrow | null {
  let left = 0, right = 0, hit = false, below = Infinity, block = false;
  for (const r of rects) {
    if (r.wrap !== 'square' && r.wrap !== 'topBottom') continue;
    if (r.y2 <= y1 + 0.01 || r.y1 >= y2 - 0.01 || r.x2 <= 0 || r.x1 >= textW) continue;
    hit = true;
    below = Math.min(below, r.y2);
    const roomL = r.x1, roomR = textW - r.x2;
    if (r.wrap === 'topBottom' || Math.max(roomL, roomR) < MIN_BESIDE) block = true;
    else if (roomL >= roomR) right = Math.max(right, textW - r.x1);
    else left = Math.max(left, r.x2);
  }
  if (!hit) return null;
  if (block || textW - left - right < MIN_BESIDE) return { left: 0, right: 0, down: Math.max(0.5, below - y1) };
  return { left, right };
}

export interface DocLayout {
  /** Every line of every page, for the text editing. */
  text: TextLayout;
  pages: PageBox[];
  objects: PlacedObject[];
  /** What each field shows (caption numbers, references). */
  fields: Map<number, string>;
  /** Size each figure, picture and text box is shown at. */
  sizes: Map<number, { w: number; h: number }>;
  /** Each text box's text, laid out from the top left of the inside of the box. */
  boxes: Map<number, TextLayout>;
  /** The tables in the text. */
  tables: Map<number, TableBox>;
  /** Each equation laid out, with the font and colour it is drawn in. */
  maths: Map<number, PlacedMath>;
  /** The top of each paragraph (after its space above), in the document's coordinates, and its page. */
  paraTops: { y: number; page: number }[];
  /** The page size, and the width of the text between the margins. */
  pageW: number;
  pageH: number;
  /** The width text is set in: between the margins, or a column's when there are columns. */
  textW: number;
  /** The columns: how many, and the left edge of each from the left margin. */
  cols: { n: number; w: number; x: number[] };
  /** Footnotes at the bottom of their pages, and endnotes after the text. */
  notes: Map<number, PlacedNote>;
  /** The short line above each page's footnotes, and above the endnotes. */
  noteRules: { page: number; x: number; y: number; w: number }[];
  /** Line numbers in the margins (Layout > Line Numbers). */
  lineNums: LineNumber[];
}

/** A page setup's text area: the width between the margins, the columns, and the height. */
interface Geometry { page: PageSetup; fullW: number; textW: number; cs: { n: number; gap: number; w: number }; colX: number[]; textH: number }

function geometry(page: PageSetup): Geometry {
  const fullW = Math.max(36, page.w - page.left - page.right);
  const cs = columnsOf(page, fullW);
  const colX = Array.from({ length: cs.n }, (_, c) => c * (cs.w + cs.gap));
  return { page, fullW, textW: cs.w, cs, colX, textH: Math.max(36, page.h - page.top - page.bottom) };
}

/** An equation as laid out: drawn with its baseline `ascent` below the top of its box. */
export interface PlacedMath extends MathBox { family: string; color: string }

/** The page number shown on a page (index from 0), or '' for none. */
export function pageLabel(hf: HeaderFooter, index: number): string {
  if (hf.numbers === 'none' || (index === 0 && !hf.onFirst)) return '';
  return pageNumber(hf, index);
}

/** A page's number as a table of contents lists it, shown on the page or not (S1 on a first page whose number is hidden). */
export function pageNumber(hf: HeaderFooter, index: number): string {
  return `${hf.prefix ?? ''}${(hf.start ?? 1) + index}`;
}

/** The size a figure or picture is shown at: its own size (times its scale), made smaller to fit the width between the margins. */
export function shownSize(own: { w: number; h: number }, scale: number, textW: number): { w: number; h: number } {
  let w = own.w * scale, h = own.h * scale;
  if (w > textW && w > 0) { h *= textW / w; w = textW; }
  return { w, h };
}

export class DocLayouter {
  private cache = new Map<string, TextLayout>();
  private used = new Set<string>();

  constructor(private deps: LayoutDeps) {}

  /**
   * A paragraph holding a bibliography: the text before it and after it laid out as any
   * paragraph's, and in between the bibliography's entries, each line shown but not part of
   * the text (the caret passes over the whole bibliography as its one character). The lines
   * flow onto the next page like any others.
   */
  withBlocks(frame: TextFrame, st: NamedStyle, block: (id: number, st: NamedStyle, ps: ParaStyle, wrap: number) => LaidLine[] | null, table?: (id: number) => TableBox | null): TextLayout {
    const measure = this.deps.measure;
    const ps = frame.paras?.[0] ?? {};
    const lines: LaidLine[] = [];
    let at = 0;
    let part: TextRun[] = [];
    let first = true;
    const flush = () => {
      const len = part.reduce((a, r) => a + r.text.length, 0);
      if (len) {
        const sub = layoutText({ ...frame, runs: part, paras: [first ? ps : { ...ps, firstLine: undefined }], markers: first ? frame.markers : [null] }, st.size, measure);
        for (const l of sub.lines) lines.push({ ...shiftLine(l, 0, 0, at - len, 0), last: false });
        first = false;
      }
      part = [];
    };
    for (const r of frame.runs) {
      const tb = r.obj !== undefined ? table?.(r.obj) ?? null : null;
      if (tb) {
        // a table: a line for each row, the caret passing over the whole table as its one character
        flush();
        const w = tb.xs[tb.xs.length - 1];
        const room = frame.wrap ?? w;
        const align = ps.align ?? 'left';
        const x = align === 'center' ? Math.max(0, (room - w) / 2) : align === 'right' ? Math.max(0, room - w) : 0;
        const family = withStack(st.font);
        let y = 0;
        tb.hs.forEach((h, i) => {
          y += h;
          const pieces: Glyphs[] = [];
          if (i === 0) pieces.push({ text: OBJECT_CHAR, start: at, x, w, dy: 0, size: st.size, family, style: '', obj: r.obj, shown: '' });
          if (i === tb.hs.length - 1) pieces.push({ text: '', start: at + 1, x: x + w, w: 0, dy: 0, size: st.size, family, style: '' });
          lines.push({
            para: 0, start: i === 0 ? at : at + 1, end: at + 1, y, ascent: Math.min(h, st.size), descent: 0, above: h, below: 0,
            size: st.size, left: x, room, x, width: w, pieces, last: false, block: r.obj,
          });
        });
        at += 1;
        first = false;
        continue;
      }
      const bl = r.obj !== undefined ? block(r.obj, st, ps, frame.wrap ?? 0) : null;
      if (!bl) { part.push(r); at += r.text.length; continue; }
      flush();
      const id = r.obj!;
      bl.forEach((l, i) => {
        const shown: Glyphs[] = l.pieces.filter((g) => g.obj === undefined).map((g) => ({ ...g, start: at, decor: true }));
        const pieces: Glyphs[] = [];
        if (i === 0) pieces.push({ text: OBJECT_CHAR, start: at, x: l.x, w: l.width, dy: 0, size: st.size, family: withStack(st.font), style: '', obj: id, shown: '' });
        pieces.push(...shown);
        if (i === bl.length - 1 && i > 0) pieces.push({ text: '', start: at + 1, x: l.x + l.width, w: 0, dy: 0, size: st.size, family: withStack(st.font), style: '' });
        lines.push({ ...l, para: 0, block: id, marker: undefined, start: i === 0 ? at : at + 1, end: at + 1, last: false, pieces });
      });
      at += 1;
      first = false;
    }
    flush();
    if (lines.length) lines[lines.length - 1].last = true;
    const box = { x1: 0, y1: 0, x2: frame.wrap ?? 0, y2: 0 };
    return { lines, boxWidth: frame.wrap ?? 0, box, length: at, measure };
  }

  /** What a table cell's text is laid out with, from the last layout (for typing into a cell). */
  cellCtx: { N: NamedStyle; inline: (id: number) => InlineBox | null; objKey: (id: number) => string; t: DocText } | null = null;

  /** A table cell's text as it would be laid out in the document now (typing into the cell). */
  cellNow(tb: TableData, r: number, c: number, runs: TextRun[], paras: ParaStyle[] | undefined): TextLayout | null {
    const cx = this.cellCtx;
    if (!cx) return null;
    const xs = [0];
    for (const w of tb.cols) xs.push(xs[xs.length - 1] + w);
    const look = resolveTable(tb, cx.t.tableStyles).text[r]?.[c];
    return this.cellText(cx.N, runs, paras, xs[c + spanOf(tb, r, c)] - xs[c], docCellAlign(tb, r, c), cx.inline, cx.objKey, cellMargins(tb, r, c), look);
  }

  /**
   * How wide a table cell's text is without wrapping, structures and pictures at their own
   * size, with the cell's margins: what Fit Columns makes its column.
   */
  naturalWidth(t: DocText, runs: TextRun[], paras: ParaStyle[] | undefined): number {
    const cx = this.cellCtx;
    const N = cx?.N ?? t.styles.Normal ?? styleOf(t, {});
    const inline = (id: number): InlineBox | null => {
      const o = t.objects[id];
      const k = o && (o.kind === 'drawing' || o.kind === 'picture') ? o.scale ?? 1 : 1;
      const own = o?.kind === 'drawing' ? this.deps.drawingSize(o.contents, t.drawingStyle) : o?.kind === 'picture' ? { w: o.w, h: o.h } : null;
      if (own) {
        const [l, tp, r, b] = lookExtent(lookOf(o));
        return { w: own.w * k + l + r, ascent: own.h * k + tp, descent: b };
      }
      return cx?.inline(id) ?? null;
    };
    const resolved = runs.map((r) => (r.font && r.size ? r : { ...r, font: r.font ?? N.font, size: r.size ?? N.size }));
    const ps = fitParas(paras, paraCount(rt.plainText(runs)));
    const lay = layoutText({ runs: resolved, paras: ps, justify: 'left', boxes: true, markers: listMarkers(ps), inline }, N.size, this.deps.measure);
    return Math.max(0, ...lay.lines.map((l) => l.x + l.width)) + 2 * CELL_PAD.x;
  }

  /** naturalWidth with a cell's own margins. */
  naturalCellWidth(t: DocText, tb: TableData, r: number, c: number): number {
    const cell = tb.rows[r]?.[c];
    if (!cell) return 0;
    const m = cellMargins(tb, r, c);
    return this.naturalWidth(t, cell.runs, cell.paras) - 2 * CELL_PAD.x + m.left + m.right;
  }

  /** Forget every paragraph's layout (fonts were loaded, measurements changed). */
  clear(): void {
    this.cache.clear();
  }

  /** Each paragraph's page number as last laid out, for the tables of contents. */
  private tocPages: string[] = [];

  /**
   * The document laid out on its pages. With a table of contents, its page numbers are those
   * of the layout before; when a heading turns out to be on another page, it is laid out again
   * (only the contents change, so it settles at once, and the rest comes from the cache).
   */
  layout(t: DocText, only?: ShownParas): DocLayout {
    const hasToc = Object.values(t.objects).some((o) => o.kind === 'toc' || o.kind === 'tof' || o.kind === 'index' || o.kind === 'toa');
    // an index or table of authorities lists the pages of the paragraphs marked for it
    const marked = Object.values(t.objects).some((o) => o.kind === 'index' || o.kind === 'toa') ? t.paras.flatMap((ps, p) => (ps?.xe || ps?.ta ? [p] : [])) : [];
    let lay = this.layoutOnce(t, only);
    for (let pass = 0; hasToc && pass < 3; pass++) {
      const now = lay.paraTops.map((pt) => lay.pages[pt.page]?.number ?? '');
      const heads = Object.values(t.objects).flatMap((o) => (o.kind === 'toc' ? tocEntries(t, o.levels) : o.kind === 'tof' ? tofEntries(t, o.name, lay.fields) : []));
      if (heads.every((e) => this.tocPages[e.para] === now[e.para]) && marked.every((p) => this.tocPages[p] === now[p])) break;
      this.tocPages = now;
      lay = this.layoutOnce(t, only);
    }
    return lay;
  }

  private layoutOnce(t: DocText, only?: ShownParas): DocLayout {
    this.used.clear();
    const text = rt.plainText(t.runs);
    const n = paraCount(text);
    const paras = fitParas(t.paras, n);
    const markers = listMarkers(paras);
    const fields = fieldTexts(t);
    const paraRuns = splitParagraphs(t.runs);
    const colours = hasChanges(t.runs) ? authorColours(t.runs) : null;
    // the sections, each with its own paper, margins and columns (in columns, text is set in a column's width)
    const secs = sectionsOf({ ...t, paras });
    const secOf = sectionOfParas(secs);
    const geoms = secs.map((x) => geometry(x.page));
    const widthOf = (p: number) => geoms[secOf[p] ?? 0].textW;
    // pages of different sizes sit one under another, each in the middle of the widest
    const maxW = Math.max(...secs.map((x) => x.page.w));
    const maxH = Math.max(...secs.map((x) => x.page.h));
    let G = geoms[0];
    let page = G.page, fullW = G.fullW, cs = G.cs, textW = G.textW, colX = G.colX, textH = G.textH;
    let ox = (maxW - page.w) / 2;
    let sec = 0;
    const useSection = (i: number) => {
      sec = i;
      G = geoms[i];
      ({ page, fullW, cs, textW, colX, textH } = G);
      ox = (maxW - page.w) / 2;
    };

    // sizes of figures and pictures (fitting the width of the section each is in)
    const objWidth = new Map<number, number>();
    paraRuns.forEach((runs, p) => { for (const r of runs) if (r.obj !== undefined) objWidth.set(r.obj, widthOf(p)); });
    const sizes = new Map<number, { w: number; h: number }>();
    for (const [k, o] of Object.entries(t.objects)) {
      const room = objWidth.get(Number(k)) ?? textW;
      if (o.kind === 'drawing') sizes.set(Number(k), shownSize(this.deps.drawingSize(o.contents, t.drawingStyle), o.scale ?? 1, room));
      else if (o.kind === 'picture') sizes.set(Number(k), shownSize({ w: o.w, h: o.h }, o.scale ?? 1, room));
    }
    // equations: laid out in the font and size of the text round them
    const maths = new Map<number, PlacedMath>();
    const mathAt = (r: TextRun, st: NamedStyle) => {
      const o = r.obj !== undefined ? t.objects[r.obj] : undefined;
      if (o?.kind !== 'math') return;
      const size = r.size ?? st.size, family = withStack(r.font ?? st.font);
      const m = layoutMath(o.tex, size, family, this.deps.measure);
      maths.set(r.obj!, { ...m, family, color: r.color ?? '#000' });
      sizes.set(r.obj!, { w: m.w, h: m.ascent + m.descent });
    };
    if (Object.values(t.objects).some((o) => o.kind === 'math')) {
      const N0 = t.styles.Normal ?? styleOf(t, {});
      paraRuns.forEach((runs, p) => { const st = styleOf(t, paras[p]); for (const r of runs) mathAt(r, st); });
      for (const o of Object.values(t.objects)) {
        if (o.kind === 'table') for (const row of o.table.rows) for (const cell of row) for (const r of cell.runs) mathAt(r, N0);
        if (o.kind === 'textbox') for (const r of o.runs) mathAt(r, N0);
      }
    }
    // text boxes: their text laid out in the box, which grows to fit it
    const boxes = new Map<number, TextLayout>();
    for (const [k, o] of Object.entries(t.objects)) {
      if (o.kind !== 'textbox') continue;
      const lay = this.boxText(t, o.runs, o.paras, o.w);
      boxes.set(Number(k), lay);
      sizes.set(Number(k), { w: o.w, h: Math.max(o.h ?? 0, lay.box.y2 - lay.box.y1 + 2 * BOX_PAD.y) });
    }
    // tables: structures and pictures in a cell fit its width
    for (const o of Object.values(t.objects)) {
      if (o.kind !== 'table') continue;
      const tb = o.table;
      const xs = [0];
      for (const w of tb.cols) xs.push(xs[xs.length - 1] + w);
      tb.rows.forEach((row, r) => row.forEach((cell, c) => {
        if (isCovered(tb, r, c)) return;
        const m = cellMargins(tb, r, c);
        const room = Math.max(6, xs[c + spanOf(tb, r, c)] - xs[c] - m.left - m.right);
        for (const x of cell.runs) {
          const n = x.obj !== undefined ? t.objects[x.obj] : undefined;
          if (n?.kind === 'drawing') sizes.set(x.obj!, shownSize(this.deps.drawingSize(n.contents, t.drawingStyle), n.scale ?? 1, room));
          else if (n?.kind === 'picture') sizes.set(x.obj!, shownSize({ w: n.w, h: n.h }, n.scale ?? 1, room));
        }
      }));
    }
    // the bibliography's entries (worked out once: every bibliography in the text shows them)
    const hasBib = Object.values(t.objects).some((o) => o.kind === 'bib');
    const entries = hasBib ? bibliography(t) : [];
    // the contents' headings, for each depth asked for, and their page numbers from the last layout
    const tocs = new Map<number, TocEntry[]>();
    for (const o of Object.values(t.objects)) if (o.kind === 'toc' && !tocs.has(o.levels)) tocs.set(o.levels, tocEntries(t, o.levels));
    // the tables of figures' captions, for each label asked for
    const tofs = new Map<string, TocEntry[]>();
    for (const o of Object.values(t.objects)) if (o.kind === 'tof' && !tofs.has(o.name)) tofs.set(o.name, tofEntries(t, o.name, fields));
    const pageOf = (p: number) => this.tocPages[p] ?? '';
    const listKey = (m: Map<unknown, TocEntry[]>) => [...m].map(([k, es]) => [k, es.map((e) => [e.level, e.text, pageOf(e.para)])]);
    // the indexes' and tables of authorities' lines, each kind asked for worked out once
    const lists = new Map<string, ListItem[]>();
    const listOf = (o: Extract<DocObject, { kind: 'index' | 'toa' }>): ListItem[] => {
      const k = o.kind === 'index' ? `i${o.letters ? 1 : 0}` : `a${o.cat}${o.passim ? 'p' : ''}`;
      let got = lists.get(k);
      if (!got) { got = o.kind === 'index' ? indexItems(t, pageOf, o.letters) : toaItems(t, o.cat, pageOf, o.passim); lists.set(k, got); }
      return got;
    };
    for (const o of Object.values(t.objects)) if (o.kind === 'index' || o.kind === 'toa') listOf(o);
    const tocKey = tocs.size || tofs.size || lists.size ? JSON.stringify([listKey(tocs), listKey(tofs), [...lists]]) : 0;
    const isBib = (r: { obj?: number }) => r.obj !== undefined && ['bib', 'toc', 'tof', 'index', 'toa'].includes(t.objects[r.obj]?.kind);
    const blockLines = (id: number, st: NamedStyle, ps: ParaStyle, wrap: number): LaidLine[] | null => {
      const o = t.objects[id];
      if (o?.kind === 'toc') return tocLines(tocs.get(o.levels) ?? [], pageOf, st, ps.line, wrap, this.deps.measure);
      if (o?.kind === 'tof') return tocLines(tofs.get(o.name) ?? [], pageOf, st, ps.line, wrap, this.deps.measure, emptyTof(o.name), false);
      if (o?.kind === 'index') return listLines(listOf(o), st, ps.line, wrap, this.deps.measure, EMPTY_INDEX, !!o.right);
      if (o?.kind === 'toa') return listLines(listOf(o), st, ps.line, wrap, this.deps.measure, emptyToa(o.cat), true);
      if (o?.kind !== 'bib') return null;
      const bf = bibFrame(entries, st, ps, this.deps.measure);
      return layoutText({
        runs: bf.runs, paras: bf.paras, justify: 'left', wrap, boxes: true,
        inline: (x) => (x < 0 ? { w: bf.spacer(x), ascent: 0 } : null),
      }, st.size, this.deps.measure).lines;
    };
    const extentOf = (id: number) => lookExtent(lookOf(t.objects[id]));
    const floating = (id: number) => floatOf(t.objects[id]) !== undefined;
    const inline = (id: number): InlineBox | null => {
      const f = fields.get(id);
      if (f !== undefined) return { text: f };
      // a floating figure keeps its place in the text but takes no room in the line
      if (floating(id)) return { w: 0, ascent: 0 };
      // an equation sits on the baseline like a letter, with its lower part below it
      const m = maths.get(id);
      if (m) return { w: m.w, ascent: m.ascent, descent: m.descent };
      const s = sizes.get(id);
      if (!s) return null;
      // a frame or shadow takes room round the figure
      const [l, tp, r, b] = extentOf(id);
      return { w: s.w + l + r, ascent: s.h + tp, descent: b };
    };
    // each table's cells laid out, and its rows' heights
    const tables = new Map<number, TableBox>();
    const N = t.styles.Normal ?? styleOf(t, {});
    const objKey = (x: number) => {
      const f = fields.get(x), s = sizes.get(x);
      return f !== undefined ? `=${f}` : s ? `${s.w.toFixed(3)}x${s.h.toFixed(3)}/${extentOf(x).join(',')}` : '?';
    };
    this.cellCtx = { N, inline, objKey, t };
    const tableOf = (id: number): TableBox | null => {
      const o = t.objects[id];
      if (o?.kind !== 'table') return null;
      let tb = tables.get(id);
      if (!tb) {
        tb = this.tableBox(id, o.table, N, inline, objKey, 0, t.tableStyles);
        tables.set(id, tb);
      }
      return tb;
    };
    // tables inside table cells, the innermost first: each sits in its cell's text as a figure does
    const nested = nestedTables(t);
    for (const { id, depth } of nested) {
      const o = t.objects[id];
      if (o?.kind !== 'table') continue;
      const tb = this.tableBox(id, o.table, N, inline, objKey, depth, t.tableStyles);
      tables.set(id, tb);
      sizes.set(id, { w: tb.xs[tb.xs.length - 1], h: sum(tb.hs) });
    }
    const isTable = (r: { obj?: number }) => r.obj !== undefined && t.objects[r.obj]?.kind === 'table' && !tables.get(r.obj)?.depth;

    // each paragraph's lines (from the cache when nothing about it changed)
    const laid: TextLayout[] = [];
    const again: ({ key: string; frame: TextFrame; size: number } | null)[] = [];
    for (let p = 0; p < n; p++) {
      const runs = paraRuns[p] ?? [];
      const ps = paras[p];
      const st = styleOf(t, ps);
      // runs without a font or size of their own take their paragraph style's
      // tracked changes: inserted text underlined, deleted text struck through, in each author's colour
      const shownRuns = colours ? markedRuns(runs, colours) : runs;
      const resolved = shownRuns.map((r) => {
        // form fields are shaded, as Word shows them
        if (r.obj !== undefined && !r.highlight && t.objects[r.obj]?.kind === 'form') r = { ...r, highlight: FORM_SHADE };
        return r.font && r.size ? r : { ...r, font: r.font ?? st.font, size: r.size ?? st.size };
      });
      const objs = runs.filter((r) => r.obj !== undefined).map((r) => {
        const f = fields.get(r.obj!);
        const s = sizes.get(r.obj!);
        if (floating(r.obj!)) return `${r.obj}~`;
        return f !== undefined ? `${r.obj}=${f}` : s ? `${r.obj}:${s.w.toFixed(3)}x${s.h.toFixed(3)}/${extentOf(r.obj!).join(',')}` : `${r.obj}?`;
      });
      const tabs = runs.filter(isTable).map((r) => tableOf(r.obj!)!);
      const bib = runs.some(isBib) || tabs.length > 0;
      const W = widthOf(p);
      const key = JSON.stringify([resolved, ps, markers[p], W, objs, st.size, bib ? [t.citeStyle, t.citeOptions, entries.map((e) => [e.label, e.pieces]), st.font, tocKey] : 0, tabs.map((x) => [x.xs, x.hs])]);
      let lay = this.cache.get(key);
      if (!lay) {
        const frame: TextFrame = {
          runs: resolved, paras: [ps], justify: 'left', wrap: W, boxes: true, markers: [markers[p]], inline,
        };
        lay = bib ? this.withBlocks(frame, st, blockLines, tableOf) : layoutText(frame, st.size, this.deps.measure);
        this.cache.set(key, lay);
      }
      this.used.add(key);
      laid.push(lay);
      again.push(bib ? null : { key, frame: { runs: resolved, paras: [ps], justify: 'left', wrap: W, boxes: true, markers: [markers[p]], inline }, size: st.size });
    }
    // a paragraph laid out again round the floating figures beside it (`y` its top on the page)
    const wrapped = (p: number, y: number, all: WrapRect[], dx: number): TextLayout => {
      const a = again[p];
      // the figures' places from the column's left edge
      const near = all.filter((r) => r.y2 > y && (r.wrap === 'square' || r.wrap === 'topBottom')).map((r) => ({ ...r, x1: r.x1 - dx, x2: r.x2 - dx }));
      if (!a || !near.length) return laid[p];
      const rel = near.map((r) => [r.x1, r.y1 - y, r.x2, r.y2 - y, r.wrap].map((v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
      const key = `${a.key}|${JSON.stringify(rel)}|${textH}`;
      let lay = this.cache.get(key);
      if (!lay) {
        const narrow = (top: number, h: number) => (y + top > textH ? null : narrowLine(near, y + top, y + top + h, textW));
        lay = layoutText({ ...a.frame, narrow }, a.size, this.deps.measure);
        this.cache.set(key, lay);
      }
      this.used.add(key);
      return lay;
    };
    // forget paragraphs no longer in the document
    if (this.cache.size > this.used.size * 2 + 200) for (const k of [...this.cache.keys()]) if (!this.used.has(k)) this.cache.delete(k);

    // stack the lines onto pages
    const pages: PageBox[] = [];
    const lines: LaidLine[] = [];
    const objects: PlacedObject[] = [];
    const paraTops: { y: number; page: number }[] = [];
    let pageIdx = 0;
    let cursor = 0;
    let hasContent = false;
    let col = 0;
    // where the columns start on the page (lower after a Continuous section break), and the lowest any column reached
    let regionTop = 0;
    let low = 0;
    // the first line of the section (for evening up its columns at a Continuous break)
    let secLine = 0;
    // the floating figures on the page so far
    let rects: WrapRect[] = [];
    const pageTop = (i: number) => pages[i].top;

    // footnotes: those whose numbers are on the page so far (with the line each is on) take room
    // at its foot, below a short line; a line goes to the next page when it and its notes don't fit
    const notes = new Map<number, PlacedNote>();
    const noteRules: DocLayout['noteRules'] = [];
    const nst = noteStyle(t);
    const sep = 1.2 * nst.size;
    const noteLay = (id: number, w: number): TextLayout | null => {
      const o = t.objects[id];
      return o?.kind === 'note' ? this.noteText(t, o.runs, o.paras, fields.get(id) ?? '', w) : null;
    };
    const noteH = (id: number) => { const l = noteLay(id, fullW); return l ? l.box.y2 - l.box.y1 : 0; };
    let feet: { id: number; line: number }[] = [];
    const footArea = (more: number[] = []) => (feet.length || more.length ? sep + sum(feet.map((f) => noteH(f.id))) + sum(more.map(noteH)) : 0);
    const room = () => textH - footArea();
    const lineFeet = (l: LaidLine): number[] => {
      if (only?.notesAtEnd) return [];
      const out: number[] = [];
      for (const g of l.pieces) { const o = g.obj !== undefined ? t.objects[g.obj] : undefined; if (o?.kind === 'note' && !o.end && !out.includes(g.obj!)) out.push(g.obj!); }
      return out;
    };
    const putNote = (id: number, x: number, y: number, w: number, line: number) => {
      const l = noteLay(id, w);
      if (!l) return 0;
      const h = l.box.y2 - l.box.y1;
      notes.set(id, { id, page: pageIdx, x, y, w, h, lay: movedLayout(l, x, y - l.box.y1) });
      objects.push({ id, page: pageIdx, x, y, w, h, line });
      return h;
    };
    // the page's footnotes, at its foot
    const placeFeet = () => {
      if (!feet.length) return;
      let y = pageTop(pageIdx) + page.top + textH - footArea();
      noteRules.push({ page: pageIdx, x: ox + page.left, y: y + sep / 2, w: Math.min(NOTE_RULE, fullW) });
      y += sep;
      for (const f of feet) y += putNote(f.id, ox + page.left, y, fullW, f.line);
      feet = [];
    };

    // page numbers: carried on from page to page, started again where a section says
    let num = secs[0].restart ?? 1;
    let restartAt: number | undefined;
    const makePage = (index: number, top: number, starts: boolean): PageBox => {
      const hf = secs[sec].hf;
      const number = `${hf.prefix ?? ''}${pageNumText(num, secs[sec].format)}`;
      const label = hf.numbers === 'none' || (starts && !hf.onFirst) ? '' : number;
      return { index, top, first: lines.length, end: lines.length, label, number, x: ox, w: page.w, h: page.h, setup: page, hf, section: sec };
    };
    pages.push(makePage(0, 0, true));
    /** The next page, in section `to` when given (its first page). */
    const newPage = (to?: number) => {
      placeFeet();
      pages[pageIdx].end = lines.length;
      const prev = pages[pageIdx];
      if (to !== undefined) {
        useSection(to);
        if (secs[to].restart !== undefined) restartAt = secs[to].restart;
      }
      num = restartAt ?? num + 1;
      restartAt = undefined;
      pageIdx++;
      pages.push(makePage(pageIdx, prev.top + prev.h + PAGE_GAP, to !== undefined));
      cursor = 0;
      hasContent = false;
      rects = [];
      col = 0;
      regionTop = 0;
      low = 0;
    };
    // the next column, or the next page after the last column
    const nextColumn = () => {
      if (col + 1 >= cs.n) { newPage(); return; }
      low = Math.max(low, cursor);
      col++;
      cursor = regionTop;
      hasContent = false;
    };
    const heightOf0 = (l: LaidLine) => (l.above ?? l.ascent) + (l.below ?? l.descent);
    /**
     * At a Continuous section break, the section's lines on this page shared out evenly between
     * its columns (as Word does), and the page's lowest point after them, for the next section to start at.
     */
    const evenColumns = () => {
      const from = Math.max(secLine, pages[pageIdx].first);
      const top0 = pageTop(pageIdx) + page.top + regionTop;
      if (cs.n > 1 && lines.length - from > 1) {
        const run = lines.slice(from);
        const hs = run.map(heightOf0);
        // space between paragraphs (none at the top of a column)
        const gaps = run.map((l, i) => (i > 0 && l.para !== run[i - 1].para ? (paras[run[i - 1].para]?.spaceAfter ?? 0) + (paras[l.para]?.spaceBefore ?? 0) : 0));
        const fill = (T: number, place?: (i: number, c: number, y: number) => void): number => {
          let c = 0, y = 0;
          for (let i = 0; i < run.length; i++) {
            if (y > 0 && y + gaps[i] + hs[i] > T + 0.01) { c++; y = 0; }
            const at = y > 0 ? y + gaps[i] : 0;
            place?.(i, c, at);
            y = at + hs[i];
          }
          return c + 1;
        };
        let lo = Math.max(...hs), hi = sum(hs) + sum(gaps);
        for (let k = 0; k < 30 && hi - lo > 0.25; k++) { const mid = (lo + hi) / 2; if (fill(mid) <= cs.n) hi = mid; else lo = mid; }
        let bottom = 0;
        fill(hi, (i, c, y) => {
          const l = run[i];
          const above = l.above ?? l.ascent;
          const x0 = ox + page.left + colX[c];
          const dx = x0 - (l.band?.[0] ?? ox + page.left);
          const dy = top0 + y + above - l.y;
          const moved = shiftLine(l, dx, dy, 0, l.para);
          moved.band = [x0, x0 + textW];
          lines[from + i] = moved;
          for (const o of objects) if (o.line === from + i && !o.wrap) { o.x += dx; o.y += dy; }
          if (i === 0 || l.para !== run[i - 1].para) { const pt = paraTops[l.para]; if (pt && pt.page === pageIdx) pt.y = top0 + y; }
          bottom = Math.max(bottom, y + hs[i]);
        });
        cursor = regionTop + bottom;
      } else cursor = Math.max(low, cursor);
      low = cursor;
    };
    const heightOf = heightOf0;

    let paraStart = 0;
    for (let p = 0; p < n; p++) {
      const ps = paras[p];
      const lay = laid[p];
      // a new section: on a new page (in its page setup), or on this one below what is there
      const si = secOf[p] ?? 0;
      if (si !== sec) {
        const s = secs[si];
        if (s.kind === 'continuous' && samePaper(s.page, page)) {
          evenColumns();
          useSection(si);
          if (s.restart !== undefined) restartAt = s.restart;
          regionTop = cursor;
          col = 0;
        } else {
          // an Even Page or Odd Page break leaves a blank page when the next would be the wrong one
          const next = s.restart ?? num + 1;
          if ((s.kind === 'evenPage' && next % 2 === 1) || (s.kind === 'oddPage' && next % 2 === 0)) newPage();
          newPage(si);
        }
        secLine = lines.length;
      }
      // a paragraph left out of view (Outline's folded headings): it takes no room
      if (only?.hidden?.has(p)) {
        paraTops.push({ y: pageTop(pageIdx) + page.top + cursor, page: pageIdx });
        paraStart += (paraRuns[p] ?? []).reduce((a, r) => a + r.text.length, 0) + 1;
        continue;
      }
      let pl = only?.firstLine?.has(p) ? lay.lines.slice(0, 1) : lay.lines;
      let hs = pl.map(heightOf);
      if (ps.pageBreak && (hasContent || col > 0)) newPage();
      else if (ps.colBreak && hasContent) nextColumn();
      // space above a paragraph isn't kept at the top of a page, except on the first page
      const before = () => (hasContent || pageIdx === 0 ? ps.spaceBefore ?? 0 : 0);
      // a heading moves to the next page when the start of the paragraph after it won't fit beside it
      if (ps.keepNext && hasContent && p + 1 < n) {
        const next = laid[p + 1].lines;
        const nextNeed = (paras[p + 1].spaceBefore ?? 0) + next.slice(0, Math.min(2, next.length)).reduce((a, l) => a + heightOf(l), 0);
        const need = before() + sum(hs) + (ps.spaceAfter ?? 0) + nextNeed;
        if (cursor + need > room() + 0.01 && need <= textH) nextColumn();
      }
      // a paragraph's first line isn't left alone at the bottom of a page
      const firstNeed = sum(hs.slice(0, pl.length >= 2 ? 2 : 1));
      if (hasContent && cursor + before() + firstNeed > room() + 0.01) nextColumn();
      cursor += before();
      paraTops.push({ y: pageTop(pageIdx) + page.top + cursor, page: pageIdx });

      // figures floating from this paragraph go on its page, and text on the page wraps round them
      for (const r of paraRuns[p] ?? []) {
        const fl = r.obj !== undefined ? floatOf(t.objects[r.obj]) : undefined;
        const s = r.obj !== undefined ? sizes.get(r.obj) : undefined;
        if (!fl || !s) continue;
        const [el, et, er, eb] = extentOf(r.obj!);
        const bw = s.w + el + er, bh = s.h + et + eb;
        let bx = (fl.xFrom === 'page' ? 0 : page.left) + fl.x;
        let by = (fl.yFrom === 'page' ? 0 : fl.yFrom === 'margin' ? page.top : page.top + cursor) + fl.y;
        bx = Math.max(0, Math.min(bx, page.w - bw));
        by = Math.max(0, Math.min(by, page.h - bh));
        objects.push({ id: r.obj!, page: pageIdx, x: ox + bx + el, y: pageTop(pageIdx) + by + et, w: s.w, h: s.h, line: lines.length, wrap: fl.wrap });
        const g = fl.gap ?? FLOAT_GAP;
        rects.push({ x1: bx - page.left - g, y1: by - page.top - g, x2: bx + bw - page.left + g, y2: by + bh - page.top + g, wrap: fl.wrap });
      }
      const wl = rects.length ? wrapped(p, cursor, rects, colX[col]).lines : pl;
      if (wl !== pl) { pl = only?.firstLine?.has(p) ? wl.slice(0, 1) : wl; hs = pl.map(heightOf); }

      let i = 0;
      let onPage = 0;
      while (i < pl.length) {
        const ft = lineFeet(pl[i]);
        if (hasContent && cursor + hs[i] > textH - footArea(ft) + 0.01) {
          // its last line isn't left alone at the top of the next page either
          if (pl.length - i === 1 && onPage >= 3) {
            i--;
            lines.pop();
            while (objects.length && objects[objects.length - 1].line === lines.length && !objects[objects.length - 1].wrap) objects.pop();
            feet = feet.filter((f) => f.line !== lines.length);
          }
          nextColumn();
          onPage = 0;
        }
        const l = pl[i];
        const above = l.above ?? l.ascent;
        const top = pageTop(pageIdx) + page.top + cursor;
        const placed = shiftLine(l, ox + page.left + colX[col], top + above - l.y, paraStart, p);
        if (cs.n > 1) placed.band = [ox + page.left + colX[col], ox + page.left + colX[col] + textW];
        lines.push(placed);
        for (const id of ft) feet.push({ id, line: lines.length - 1 });
        for (const g of placed.pieces) {
          const s = g.obj !== undefined ? sizes.get(g.obj) : undefined;
          if (s && !fields.has(g.obj!) && !floating(g.obj!)) objects.push({ id: g.obj!, page: pageIdx, x: g.x + extentOf(g.obj!)[0], y: placed.y - s.h + (maths.get(g.obj!)?.descent ?? 0), w: s.w, h: s.h, line: lines.length - 1 });
        }
        cursor += hs[i];
        hasContent = true;
        onPage++;
        i++;
      }
      cursor += ps.spaceAfter ?? 0;
      paraStart += (paraRuns[p] ?? []).reduce((a, r) => a + r.text.length, 0) + 1;
    }

    // endnotes after the text, in the order of their numbers, each kept whole on a page (in the
    // views without pages, the footnotes too, before them), under a short line
    const inText = objectsInText(t.runs);
    const tail = (end: boolean) => inText.filter((id, i) => { const o = t.objects[id]; return o?.kind === 'note' && !!o.end === end && inText.indexOf(id) === i; });
    const lastLine = Math.max(0, lines.length - 1);
    for (const group of [only?.notesAtEnd ? tail(false) : [], tail(true)]) {
      let first = true;
      for (const id of group) {
        const l = noteLay(id, textW);
        if (!l) continue;
        const need = (first ? sep : 0) + l.box.y2 - l.box.y1;
        if (hasContent && cursor + need > room() + 0.01) nextColumn();
        if (first) {
          noteRules.push({ page: pageIdx, x: ox + page.left + colX[col], y: pageTop(pageIdx) + page.top + cursor + sep / 2, w: Math.min(NOTE_RULE, textW) });
          cursor += sep;
          first = false;
        }
        cursor += putNote(id, ox + page.left + colX[col], pageTop(pageIdx) + page.top + cursor, textW, lastLine);
        hasContent = true;
      }
    }
    placeFeet();
    pages[pageIdx].end = lines.length;

    // where each table's rows went, and the structures and pictures (and tables) in its cells
    for (const tb of tables.values()) tb.rows = [];
    const placeRow = (tb: TableBox, r: number, page: number, x: number, top: number, line: number) => {
      tb.rows.push({ page, x, y: top });
      tb.cells[r]?.forEach((cl, c) => {
        if (!cl) return;
        const m = tb.pads[r][c];
        const ox = x + tb.xs[c] + m.left, oy = top + m.top + tb.drop[r][c] - cl.box.y1;
        for (const cline of cl.lines) for (const g of cline.pieces) {
          const s = g.obj !== undefined ? sizes.get(g.obj) : undefined;
          if (s && !fields.has(g.obj!)) objects.push({ id: g.obj!, page, x: ox + g.x + extentOf(g.obj!)[0], y: oy + cline.y - s.h + (maths.get(g.obj!)?.descent ?? 0), w: s.w, h: s.h, line });
        }
      });
    };
    pages.forEach((pg) => {
      for (let i = pg.first; i < pg.end; i++) {
        const l = lines[i];
        const tb = l.block !== undefined ? tables.get(l.block) : undefined;
        if (!tb) continue;
        placeRow(tb, tb.rows.length, pg.index, l.x, l.y - (l.above ?? 0), i);
      }
    });
    // a table in a cell: its rows one under another where it sits in the cell (all on that page)
    for (const { id } of [...nested].reverse()) {
      const tb = tables.get(id);
      const at = objects.find((o) => o.id === id);
      if (!tb || !at) continue;
      let y = at.y;
      tb.hs.forEach((h, r) => { placeRow(tb, r, at.page, at.x, y, at.line); y += h; });
    }

    // a bibliography or table is picked by clicking anywhere on it: its box on each page it is on
    const blocks = new Map<string, PlacedObject>();
    pages.forEach((pg) => {
      for (let i = pg.first; i < pg.end; i++) {
        const l = lines[i];
        if (l.block === undefined) continue;
        const k = `${l.block}@${pg.index}`;
        const y1 = l.y - (l.above ?? l.ascent), y2 = l.y + (l.below ?? l.descent);
        const got = blocks.get(k);
        const tb = tables.get(l.block);
        if (!got) blocks.set(k, tb ? { id: l.block, page: pg.index, x: l.x, y: y1, w: l.width, h: y2 - y1, line: i } : { id: l.block, page: pg.index, x: l.band?.[0] ?? pg.x + pg.setup.left, y: y1, w: l.band ? l.band[1] - l.band[0] : geometry(pg.setup).textW, h: y2 - y1, line: i });
        else got.h = y2 - got.y;
      }
    });
    objects.push(...blocks.values());

    const lineNums = this.lineNumbers(t, lines, pages, paras, secs, secOf);
    const last = pages[pages.length - 1];
    const box = { x1: 0, y1: 0, x2: maxW, y2: last.top + last.h };
    const g0 = geoms[0];
    const textLayout: TextLayout = { lines, boxWidth: g0.textW, box, length: text.length, measure: this.deps.measure };
    return { text: textLayout, pages, objects, fields, sizes, boxes, tables, maths, paraTops, pageW: maxW, pageH: maxH, textW: g0.textW, cols: { n: g0.cs.n, w: g0.textW, x: g0.colX }, notes, noteRules, lineNums };
  }

  /**
   * Line numbers, as Word counts them: every line of text in a section that has them (not
   * tables, contents or bibliographies, nor paragraphs that turn them off), starting again on
   * each page, in each section, or never; every nth shown, at the left of its column.
   */
  private lineNumbers(t: DocText, lines: LaidLine[], pages: PageBox[], paras: ParaStyle[], secs: ReturnType<typeof sectionsOf>, secOf: number[]): LineNumber[] {
    if (!secs.some((s) => s.lines)) return [];
    const N = t.styles.Normal ?? styleOf(t, {});
    const family = withStack(N.font), size = N.size;
    const out: LineNumber[] = [];
    let count: number | null = null;
    let lastPage = -1, lastSec = -1;
    for (const pg of pages) {
      for (let i = pg.first; i < pg.end; i++) {
        const l = lines[i];
        const si = secOf[l.para] ?? 0;
        const L = secs[si]?.lines;
        if (!L || l.block !== undefined || paras[l.para]?.noLineNumbers) continue;
        if (count === null || (L.restart === 'page' && pg.index !== lastPage) || (L.restart === 'section' && si !== lastSec)) count = Math.max(0, Math.round(L.start));
        lastPage = pg.index;
        lastSec = si;
        const n = count++;
        const every = Math.max(1, Math.round(L.countBy));
        if (n % every !== 0) continue;
        const text = String(n);
        const w = this.deps.measure(text, size, family, '');
        const left = l.band?.[0] ?? pg.x + pg.setup.left;
        out.push({ page: pg.index, x: left - (L.distance ?? LINE_NUMBER_GAP) - w, y: l.y, text, size, family });
      }
    }
    return out;
  }

  /** A table's cells laid out (each from the cache when nothing about it changed), and its rows' heights. */
  tableBox(id: number, tb: TableData, N: NamedStyle, inline: (id: number, room: number) => InlineBox | null, objKey: (id: number) => string, depth = 0, kept?: DocText['tableStyles']): TableBox {
    const xs = [0];
    for (const w of tb.cols) xs.push(xs[xs.length - 1] + w);
    const cells: (TextLayout | null)[][] = [];
    const hs: number[] = [];
    const pads: CellMargins[][] = [];
    const tall = (l: TextLayout | null) => (l ? l.box.y2 - l.box.y1 : 0);
    const looks = resolveTable(tb, kept).text;
    // cells merged down several rows: the rows they cover make room for them after
    const merged: { r: number; c: number; down: number }[] = [];
    tb.rows.forEach((row, r) => {
      const out: (TextLayout | null)[] = [];
      const ms: CellMargins[] = [];
      let h = SINGLE_ROW * N.size + 2 * CELL_PAD.y;
      for (let c = 0; c < tb.cols.length; c++) {
        const m = cellMargins(tb, r, c);
        ms.push(m);
        if (isCovered(tb, r, c)) { out.push(null); continue; }
        h = Math.max(h, SINGLE_ROW * N.size + m.top + m.bottom);
        const cell = row[c] ?? { runs: [] };
        const lay = this.cellText(N, cell.runs, cell.paras, xs[c + spanOf(tb, r, c)] - xs[c], docCellAlign(tb, r, c), inline, objKey, m, looks[r]?.[c]);
        out.push(lay);
        const down = rowSpanOf(tb, r, c);
        if (down > 1) merged.push({ r, c, down });
        else h = Math.max(h, tall(lay) + m.top + m.bottom);
      }
      hs.push(h);
      cells.push(out);
      pads.push(ms);
    });
    // a merged cell taller than its rows: the last of them grows (as in Word)
    merged.sort((a, b) => a.r + a.down - (b.r + b.down));
    for (const m of merged) {
      const p = pads[m.r][m.c];
      const need = tall(cells[m.r][m.c]) + p.top + p.bottom;
      const have = sum(hs.slice(m.r, m.r + m.down));
      if (need > have) hs[m.r + m.down - 1] += need - have;
    }
    const drop = cells.map((out, r) => out.map((l, c) => {
      if (!l) return 0;
      const p = pads[r][c];
      const h = sum(hs.slice(r, r + rowSpanOf(tb, r, c)));
      const room = h - p.top - p.bottom - tall(l);
      const v = tb.rows[r]?.[c]?.valign;
      return v === 'center' ? room / 2 : v === 'bottom' ? room : 0;
    }));
    return { id, xs, hs, cells, drop, pads, rows: [], depth };
  }

  /** A table cell's text laid out in its width (`w`, the inner margins taken off). */
  cellText(N: NamedStyle, runs: TextRun[], paras: ParaStyle[] | undefined, w: number, align: Justify, inline: (id: number, room: number) => InlineBox | null, objKey: (id: number) => string, pad: CellMargins = { top: CELL_PAD.y, bottom: CELL_PAD.y, left: CELL_PAD.x, right: CELL_PAD.x }, look?: CellText): TextLayout {
    if (hasChanges(runs)) runs = markedRuns(runs);
    // the table style's bold, italic and colour, where the text has none of its own
    if (look) runs = runs.map((r) => ({ ...r, bold: r.bold ?? look.bold, italic: r.italic ?? look.italic, color: r.color ?? look.color }));
    const resolved = runs.map((r) => (r.font && r.size ? r : { ...r, font: r.font ?? N.font, size: r.size ?? N.size }));
    const n = paraCount(rt.plainText(runs));
    const ps = fitParas(paras, n);
    const objs = runs.filter((r) => r.obj !== undefined).map((r) => `${r.obj}${objKey(r.obj!)}`);
    const room = w - pad.left - pad.right;
    const key = `cell|${JSON.stringify([resolved, ps, room, align, objs])}`;
    let lay = this.cache.get(key);
    if (!lay) {
      lay = layoutText({ runs: resolved, paras: ps, justify: align, wrap: Math.max(6, room), boxes: true, markers: listMarkers(ps), inline }, N.size, this.deps.measure);
      this.cache.set(key, lay);
    }
    this.used.add(key);
    return lay;
  }

  /**
   * A footnote's or endnote's text laid out `w` wide, in the notes' style: its number (`label`)
   * in superscript before the first line, which starts after it (the number is shown, not typed).
   */
  noteText(t: DocText, runs: TextRun[], paras: ParaStyle[] | undefined, label: string, w: number): TextLayout {
    const st = noteStyle(t);
    if (hasChanges(runs)) runs = markedRuns(runs);
    const resolved = runs.map((r) => (r.font && r.size ? r : { ...r, font: r.font ?? st.font, size: r.size ?? st.size }));
    const ps = fitParas(paras, paraCount(rt.plainText(runs)));
    const family = withStack(st.font);
    const small = 0.75 * st.size;
    const lw = this.deps.measure(label, small, family, '') + 0.3 * st.size;
    const first = ps.map((p, i) => (i === 0 ? { ...p, firstLine: (p.firstLine ?? 0) + lw } : p));
    const key = `note|${JSON.stringify([resolved, first, w, label])}`;
    let lay = this.cache.get(key);
    if (!lay) {
      lay = layoutText({ runs: resolved, paras: first, justify: 'left', wrap: Math.max(6, w), boxes: true, markers: listMarkers(first) }, st.size, this.deps.measure);
      const l0 = lay.lines[0];
      if (l0) {
        const mark: Glyphs = { text: label, start: 0, x: l0.x - lw, w: lw - 0.3 * st.size, dy: -0.42 * st.size, size: small, family, style: '', decor: true };
        lay = { ...lay, lines: [{ ...l0, pieces: [mark, ...l0.pieces] }, ...lay.lines.slice(1)] };
      }
      this.cache.set(key, lay);
    }
    this.used.add(key);
    return lay;
  }

  /** A text box's text laid out inside it (`w` the box's width), from the top left of its inner margins. */
  boxText(t: DocText, runs: TextRun[], paras: ParaStyle[] | undefined, w: number): TextLayout {
    const N = t.styles.Normal ?? styleOf(t, {});
    if (hasChanges(runs)) runs = markedRuns(runs);
    const resolved = runs.map((r) => (r.font && r.size ? r : { ...r, font: r.font ?? N.font, size: r.size ?? N.size }));
    const n = paraCount(rt.plainText(runs));
    const ps = fitParas(paras, n);
    const frame: TextFrame = { runs: resolved, paras: ps, justify: 'left', wrap: Math.max(6, w - 2 * BOX_PAD.x), boxes: true, markers: listMarkers(ps) };
    const key = `box|${JSON.stringify([resolved, ps, w])}`;
    let lay = this.cache.get(key);
    if (!lay) {
      lay = layoutText(frame, N.size, this.deps.measure);
      this.cache.set(key, lay);
    }
    this.used.add(key);
    return lay;
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** A paragraph's line moved onto its page: shifted across and down, with offsets in the whole text. */
function shiftLine(l: LaidLine, dx: number, dy: number, offset: number, para: number): LaidLine {
  return {
    ...l,
    para,
    start: l.start + offset,
    end: l.end + offset,
    y: l.y + dy,
    left: l.left + dx,
    x: l.x + dx,
    pieces: l.pieces.map((g) => ({ ...g, start: g.start + offset, x: g.x + dx })),
    marker: l.marker ? { ...l.marker, start: l.marker.start + offset, x: l.marker.x + dx } : undefined,
  };
}

/** A text layout moved across and down (a text box's text, onto its page). */
export function movedLayout(lay: TextLayout, dx: number, dy: number): TextLayout {
  const b = lay.box;
  return { ...lay, lines: lay.lines.map((l) => shiftLine(l, dx, dy, 0, l.para)), box: { x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy } };
}

/** The paragraph style a place in the text has. */
export function paraStyleAt(t: DocText, para: number): ParaStyle {
  return fitParas(t.paras, paraCount(rt.plainText(t.runs)))[para] ?? {};
}
