// Laying a document out on pages. Each paragraph is laid out by the same text layout as every
// caption and text box (so typing, the caret and selection work the same), once, and again
// only when it changes; the paragraphs' lines are then stacked onto pages. A paragraph can run
// on to the next page, but never leaves its first or last line alone (Word's widow and orphan
// control), headings stay with the paragraph after them, and a page break starts a new page.
//
// The pages sit one under another with a gap between them, all in one set of coordinates (in
// points), and the lines of every page together make one text layout, so the text editing's
// caret, selection and arrow keys run across pages without knowing about them.

import type { Contents, Justify, ParaStyle, TableData, TextRun } from '../model';
import type { DocStyle } from '../style';
import { withStack, layoutText, type Glyphs, type InlineBox, type LaidLine, type Measure, type Narrow, type TextFrame, type TextLayout } from '../text/layout';
import { fitParas, listMarkers, paraCount, splitParagraphs } from '../text/paragraphs';
import { isCovered, rowSpanOf, spanOf } from '../table';
import * as rt from '../richtext';
import { nestedTables, BOX_PAD, FLOAT_GAP, OBJECT_CHAR, columnsOf, fieldTexts, floatOf, lookExtent, lookOf, styleOf, type DocText, type HeaderFooter, type NamedStyle, type WrapKind } from './document';
import { bibliography, type BibEntry } from './references';
import { tocEntries, tocLines, type TocEntry } from './toc';
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
}

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
  /** Each row's page and top left corner (in the document's coordinates), as placed. */
  rows: { page: number; x: number; y: number }[];
  /** 0 for a table in the text, 1 for one in a cell of such a table, and so on. */
  depth: number;
}

/** Room inside a table cell at the sides and above and below the text (Word's 0.075 in at the sides). */
export const CELL_PAD = { x: 5.4, y: 1.5 };

/** Width of a table's lines: Word's half-point grid; the ACS rules a little heavier at the top and bottom. */
export const GRID_LINE = 0.5;
export const ACS_LINE = 0.75;

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
  cellCtx: { N: NamedStyle; inline: (id: number) => InlineBox | null; objKey: (id: number) => string } | null = null;

  /** A table cell's text as it would be laid out in the document now (typing into the cell). */
  cellNow(tb: TableData, r: number, c: number, runs: TextRun[], paras: ParaStyle[] | undefined): TextLayout | null {
    const cx = this.cellCtx;
    if (!cx) return null;
    const xs = [0];
    for (const w of tb.cols) xs.push(xs[xs.length - 1] + w);
    return this.cellText(cx.N, runs, paras, xs[c + spanOf(tb, r, c)] - xs[c], docCellAlign(tb, r, c), cx.inline, cx.objKey);
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
    const hasToc = Object.values(t.objects).some((o) => o.kind === 'toc');
    let lay = this.layoutOnce(t, only);
    for (let pass = 0; hasToc && pass < 3; pass++) {
      const now = lay.paraTops.map((pt) => pageNumber(t.hf, pt.page));
      const heads = Object.values(t.objects).filter((o) => o.kind === 'toc').flatMap((o) => tocEntries(t, (o as { levels: number }).levels));
      if (heads.every((e) => this.tocPages[e.para] === now[e.para])) break;
      this.tocPages = now;
      lay = this.layoutOnce(t, only);
    }
    return lay;
  }

  private layoutOnce(t: DocText, only?: ShownParas): DocLayout {
    this.used.clear();
    const page = t.page;
    const fullW = Math.max(36, page.w - page.left - page.right);
    // in columns, text is set in a column's width
    const cs = columnsOf(page, fullW);
    const textW = cs.w;
    const colX = Array.from({ length: cs.n }, (_, c) => c * (cs.w + cs.gap));
    const textH = Math.max(36, page.h - page.top - page.bottom);
    const text = rt.plainText(t.runs);
    const n = paraCount(text);
    const paras = fitParas(t.paras, n);
    const markers = listMarkers(paras);
    const fields = fieldTexts(t);
    const paraRuns = splitParagraphs(t.runs);
    const colours = hasChanges(t.runs) ? authorColours(t.runs) : null;

    // sizes of figures and pictures
    const sizes = new Map<number, { w: number; h: number }>();
    for (const [k, o] of Object.entries(t.objects)) {
      if (o.kind === 'drawing') sizes.set(Number(k), shownSize(this.deps.drawingSize(o.contents, t.drawingStyle), o.scale ?? 1, textW));
      else if (o.kind === 'picture') sizes.set(Number(k), shownSize({ w: o.w, h: o.h }, o.scale ?? 1, textW));
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
    const CP = CELL_PAD;
    for (const o of Object.values(t.objects)) {
      if (o.kind !== 'table') continue;
      const tb = o.table;
      const xs = [0];
      for (const w of tb.cols) xs.push(xs[xs.length - 1] + w);
      tb.rows.forEach((row, r) => row.forEach((cell, c) => {
        if (isCovered(tb, r, c)) return;
        const room = Math.max(6, xs[c + spanOf(tb, r, c)] - xs[c] - 2 * CP.x);
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
    const pageOf = (p: number) => this.tocPages[p] ?? '';
    const tocKey = tocs.size ? JSON.stringify([...tocs].map(([k, es]) => [k, es.map((e) => [e.level, e.text, pageOf(e.para)])])) : 0;
    const isBib = (r: { obj?: number }) => r.obj !== undefined && (t.objects[r.obj]?.kind === 'bib' || t.objects[r.obj]?.kind === 'toc');
    const blockLines = (id: number, st: NamedStyle, ps: ParaStyle, wrap: number): LaidLine[] | null => {
      const o = t.objects[id];
      if (o?.kind === 'toc') return tocLines(tocs.get(o.levels) ?? [], pageOf, st, ps.line, wrap, this.deps.measure);
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
    this.cellCtx = { N, inline, objKey };
    const tableOf = (id: number): TableBox | null => {
      const o = t.objects[id];
      if (o?.kind !== 'table') return null;
      let tb = tables.get(id);
      if (!tb) {
        tb = this.tableBox(id, o.table, N, inline, objKey);
        tables.set(id, tb);
      }
      return tb;
    };
    // tables inside table cells, the innermost first: each sits in its cell's text as a figure does
    const nested = nestedTables(t);
    for (const { id, depth } of nested) {
      const o = t.objects[id];
      if (o?.kind !== 'table') continue;
      const tb = this.tableBox(id, o.table, N, inline, objKey, depth);
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
      const resolved = shownRuns.map((r) => (r.font && r.size ? r : { ...r, font: r.font ?? st.font, size: r.size ?? st.size }));
      const objs = runs.filter((r) => r.obj !== undefined).map((r) => {
        const f = fields.get(r.obj!);
        const s = sizes.get(r.obj!);
        if (floating(r.obj!)) return `${r.obj}~`;
        return f !== undefined ? `${r.obj}=${f}` : s ? `${r.obj}:${s.w.toFixed(3)}x${s.h.toFixed(3)}/${extentOf(r.obj!).join(',')}` : `${r.obj}?`;
      });
      const tabs = runs.filter(isTable).map((r) => tableOf(r.obj!)!);
      const bib = runs.some(isBib) || tabs.length > 0;
      const key = JSON.stringify([resolved, ps, markers[p], textW, objs, st.size, bib ? [t.citeStyle, t.citeOptions, entries.map((e) => [e.label, e.pieces]), st.font, tocKey] : 0, tabs.map((x) => [x.xs, x.hs])]);
      let lay = this.cache.get(key);
      if (!lay) {
        const frame: TextFrame = {
          runs: resolved, paras: [ps], justify: 'left', wrap: textW, boxes: true, markers: [markers[p]], inline,
        };
        lay = bib ? this.withBlocks(frame, st, blockLines, tableOf) : layoutText(frame, st.size, this.deps.measure);
        this.cache.set(key, lay);
      }
      this.used.add(key);
      laid.push(lay);
      again.push(bib ? null : { key, frame: { runs: resolved, paras: [ps], justify: 'left', wrap: textW, boxes: true, markers: [markers[p]], inline }, size: st.size });
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
    // the floating figures on the page so far
    let rects: WrapRect[] = [];
    const pageTop = (i: number) => i * (page.h + PAGE_GAP);
    pages.push({ index: 0, top: 0, first: 0, end: 0, label: pageLabel(t.hf, 0) });
    const newPage = () => {
      pages[pageIdx].end = lines.length;
      pageIdx++;
      pages.push({ index: pageIdx, top: pageTop(pageIdx), first: lines.length, end: lines.length, label: pageLabel(t.hf, pageIdx) });
      cursor = 0;
      hasContent = false;
      rects = [];
      col = 0;
    };
    // the next column, or the next page after the last column
    const nextColumn = () => {
      if (col + 1 >= cs.n) { newPage(); return; }
      col++;
      cursor = 0;
      hasContent = false;
    };
    const heightOf = (l: LaidLine) => (l.above ?? l.ascent) + (l.below ?? l.descent);

    let paraStart = 0;
    for (let p = 0; p < n; p++) {
      const ps = paras[p];
      const lay = laid[p];
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
        if (cursor + need > textH + 0.01 && need <= textH) nextColumn();
      }
      // a paragraph's first line isn't left alone at the bottom of a page
      const firstNeed = sum(hs.slice(0, pl.length >= 2 ? 2 : 1));
      if (hasContent && cursor + before() + firstNeed > textH + 0.01) nextColumn();
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
        objects.push({ id: r.obj!, page: pageIdx, x: bx + el, y: pageTop(pageIdx) + by + et, w: s.w, h: s.h, line: lines.length, wrap: fl.wrap });
        const g = fl.gap ?? FLOAT_GAP;
        rects.push({ x1: bx - page.left - g, y1: by - page.top - g, x2: bx + bw - page.left + g, y2: by + bh - page.top + g, wrap: fl.wrap });
      }
      const wl = rects.length ? wrapped(p, cursor, rects, colX[col]).lines : pl;
      if (wl !== pl) { pl = only?.firstLine?.has(p) ? wl.slice(0, 1) : wl; hs = pl.map(heightOf); }

      let i = 0;
      let onPage = 0;
      while (i < pl.length) {
        if (hasContent && cursor + hs[i] > textH + 0.01) {
          // its last line isn't left alone at the top of the next page either
          if (pl.length - i === 1 && onPage >= 3) {
            i--;
            lines.pop();
            while (objects.length && objects[objects.length - 1].line === lines.length && !objects[objects.length - 1].wrap) objects.pop();
          }
          nextColumn();
          onPage = 0;
        }
        const l = pl[i];
        const above = l.above ?? l.ascent;
        const top = pageTop(pageIdx) + page.top + cursor;
        const placed = shiftLine(l, page.left + colX[col], top + above - l.y, paraStart, p);
        if (cs.n > 1) placed.band = [page.left + colX[col], page.left + colX[col] + textW];
        lines.push(placed);
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
    pages[pageIdx].end = lines.length;

    // where each table's rows went, and the structures and pictures (and tables) in its cells
    for (const tb of tables.values()) tb.rows = [];
    const placeRow = (tb: TableBox, r: number, page: number, x: number, top: number, line: number) => {
      tb.rows.push({ page, x, y: top });
      tb.cells[r]?.forEach((cl, c) => {
        if (!cl) return;
        const ox = x + tb.xs[c] + CP.x, oy = top + CP.y + tb.drop[r][c] - cl.box.y1;
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
        if (!got) blocks.set(k, tb ? { id: l.block, page: pg.index, x: l.x, y: y1, w: l.width, h: y2 - y1, line: i } : { id: l.block, page: pg.index, x: l.band?.[0] ?? page.left, y: y1, w: textW, h: y2 - y1, line: i });
        else got.h = y2 - got.y;
      }
    });
    objects.push(...blocks.values());

    const last = pages[pages.length - 1];
    const box = { x1: 0, y1: 0, x2: page.w, y2: last.top + page.h };
    const textLayout: TextLayout = { lines, boxWidth: textW, box, length: text.length, measure: this.deps.measure };
    return { text: textLayout, pages, objects, fields, sizes, boxes, tables, maths, paraTops, pageW: page.w, pageH: page.h, textW, cols: { n: cs.n, w: textW, x: colX } };
  }

  /** A table's cells laid out (each from the cache when nothing about it changed), and its rows' heights. */
  tableBox(id: number, tb: TableData, N: NamedStyle, inline: (id: number, room: number) => InlineBox | null, objKey: (id: number) => string, depth = 0): TableBox {
    const xs = [0];
    for (const w of tb.cols) xs.push(xs[xs.length - 1] + w);
    const cells: (TextLayout | null)[][] = [];
    const hs: number[] = [];
    const tall = (l: TextLayout | null) => (l ? l.box.y2 - l.box.y1 : 0);
    // cells merged down several rows: the rows they cover make room for them after
    const merged: { r: number; c: number; down: number }[] = [];
    tb.rows.forEach((row, r) => {
      const out: (TextLayout | null)[] = [];
      let h = SINGLE_ROW * N.size;
      for (let c = 0; c < tb.cols.length; c++) {
        if (isCovered(tb, r, c)) { out.push(null); continue; }
        const cell = row[c] ?? { runs: [] };
        const lay = this.cellText(N, cell.runs, cell.paras, xs[c + spanOf(tb, r, c)] - xs[c], docCellAlign(tb, r, c), inline, objKey);
        out.push(lay);
        const down = rowSpanOf(tb, r, c);
        if (down > 1) merged.push({ r, c, down });
        else h = Math.max(h, tall(lay));
      }
      hs.push(h + 2 * CELL_PAD.y);
      cells.push(out);
    });
    // a merged cell taller than its rows: the last of them grows (as in Word)
    merged.sort((a, b) => a.r + a.down - (b.r + b.down));
    for (const m of merged) {
      const need = tall(cells[m.r][m.c]) + 2 * CELL_PAD.y;
      const have = sum(hs.slice(m.r, m.r + m.down));
      if (need > have) hs[m.r + m.down - 1] += need - have;
    }
    const drop = cells.map((out, r) => out.map((l, c) => {
      if (!l) return 0;
      const h = sum(hs.slice(r, r + rowSpanOf(tb, r, c)));
      const room = h - 2 * CELL_PAD.y - tall(l);
      const v = tb.rows[r]?.[c]?.valign;
      return v === 'center' ? room / 2 : v === 'bottom' ? room : 0;
    }));
    return { id, xs, hs, cells, drop, rows: [], depth };
  }

  /** A table cell's text laid out in its width (`w`, the inner margins taken off). */
  cellText(N: NamedStyle, runs: TextRun[], paras: ParaStyle[] | undefined, w: number, align: Justify, inline: (id: number, room: number) => InlineBox | null, objKey: (id: number) => string): TextLayout {
    if (hasChanges(runs)) runs = markedRuns(runs);
    const resolved = runs.map((r) => (r.font && r.size ? r : { ...r, font: r.font ?? N.font, size: r.size ?? N.size }));
    const n = paraCount(rt.plainText(runs));
    const ps = fitParas(paras, n);
    const objs = runs.filter((r) => r.obj !== undefined).map((r) => `${r.obj}${objKey(r.obj!)}`);
    const key = `cell|${JSON.stringify([resolved, ps, w, align, objs])}`;
    let lay = this.cache.get(key);
    if (!lay) {
      lay = layoutText({ runs: resolved, paras: ps, justify: align, wrap: Math.max(6, w - 2 * CELL_PAD.x), boxes: true, markers: listMarkers(ps), inline }, N.size, this.deps.measure);
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
