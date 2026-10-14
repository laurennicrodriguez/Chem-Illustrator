// Laying a document out on pages. Each paragraph is laid out by the same text layout as every
// caption and text box (so typing, the caret and selection work the same), once, and again
// only when it changes; the paragraphs' lines are then stacked onto pages. A paragraph can run
// on to the next page, but never leaves its first or last line alone (Word's widow and orphan
// control), headings stay with the paragraph after them, and a page break starts a new page.
//
// The pages sit one under another with a gap between them, all in one set of coordinates (in
// points), and the lines of every page together make one text layout, so the text editing's
// caret, selection and arrow keys run across pages without knowing about them.

import type { Contents, ParaStyle, TextRun } from '../model';
import type { DocStyle } from '../style';
import { FONT_STACK, layoutText, type Glyphs, type InlineBox, type LaidLine, type Measure, type TextFrame, type TextLayout } from '../text/layout';
import { fitParas, listMarkers, paraCount, splitParagraphs } from '../text/paragraphs';
import * as rt from '../richtext';
import { OBJECT_CHAR, fieldTexts, styleOf, type DocText, type HeaderFooter, type NamedStyle } from './document';
import { bibliography, type BibEntry } from './references';

/** Space between pages on screen, in points. */
export const PAGE_GAP = 18;

export interface LayoutDeps {
  measure: Measure;
  /** A drawing's own size in points (that of its picture). */
  drawingSize(contents: Contents, style: DocStyle): { w: number; h: number };
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
  const family = `${font}, ${FONT_STACK}`;
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
  const family = `${font}, ${FONT_STACK}`;
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
  /** The line it is on (in the layout's lines). */
  line: number;
}

export interface DocLayout {
  /** Every line of every page, for the text editing. */
  text: TextLayout;
  pages: PageBox[];
  objects: PlacedObject[];
  /** What each field shows (caption numbers, references). */
  fields: Map<number, string>;
  /** Size each figure and picture is shown at. */
  sizes: Map<number, { w: number; h: number }>;
  /** The page size, and the width of the text between the margins. */
  pageW: number;
  pageH: number;
  textW: number;
}

/** The page number shown on a page (index from 0), or '' for none. */
export function pageLabel(hf: HeaderFooter, index: number): string {
  if (hf.numbers === 'none' || (index === 0 && !hf.onFirst)) return '';
  return `${hf.prefix}${hf.start + index}`;
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
  withBlocks(frame: TextFrame, st: NamedStyle, entries: BibEntry[], isBib: (r: TextRun) => boolean): TextLayout {
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
      if (!isBib(r)) { part.push(r); at += r.text.length; continue; }
      flush();
      const bf = bibFrame(entries, st, ps, measure);
      const bl = layoutText({
        runs: bf.runs, paras: bf.paras, justify: 'left', wrap: frame.wrap, boxes: true,
        inline: (id) => (id < 0 ? { w: bf.spacer(id), ascent: 0 } : null),
      }, st.size, measure).lines;
      const id = r.obj!;
      bl.forEach((l, i) => {
        const shown: Glyphs[] = l.pieces.filter((g) => g.obj === undefined).map((g) => ({ ...g, start: at, decor: true }));
        const pieces: Glyphs[] = [];
        if (i === 0) pieces.push({ text: OBJECT_CHAR, start: at, x: l.x, w: l.width, dy: 0, size: st.size, family: `${st.font}, ${FONT_STACK}`, style: '', obj: id, shown: '' });
        pieces.push(...shown);
        if (i === bl.length - 1 && i > 0) pieces.push({ text: '', start: at + 1, x: l.x + l.width, w: 0, dy: 0, size: st.size, family: `${st.font}, ${FONT_STACK}`, style: '' });
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

  /** Forget every paragraph's layout (fonts were loaded, measurements changed). */
  clear(): void {
    this.cache.clear();
  }

  layout(t: DocText): DocLayout {
    const page = t.page;
    const textW = Math.max(36, page.w - page.left - page.right);
    const textH = Math.max(36, page.h - page.top - page.bottom);
    const text = rt.plainText(t.runs);
    const n = paraCount(text);
    const paras = fitParas(t.paras, n);
    const markers = listMarkers(paras);
    const fields = fieldTexts(t);
    const paraRuns = splitParagraphs(t.runs);

    // sizes of figures and pictures
    const sizes = new Map<number, { w: number; h: number }>();
    for (const [k, o] of Object.entries(t.objects)) {
      if (o.kind === 'drawing') sizes.set(Number(k), shownSize(this.deps.drawingSize(o.contents, t.drawingStyle), o.scale ?? 1, textW));
      else if (o.kind === 'picture') sizes.set(Number(k), shownSize({ w: o.w, h: o.h }, o.scale ?? 1, textW));
    }
    // the bibliography's entries (worked out once: every bibliography in the text shows them)
    const hasBib = Object.values(t.objects).some((o) => o.kind === 'bib');
    const entries = hasBib ? bibliography(t) : [];
    const isBib = (r: { obj?: number }) => r.obj !== undefined && t.objects[r.obj]?.kind === 'bib';
    const inline = (id: number): InlineBox | null => {
      const f = fields.get(id);
      if (f !== undefined) return { text: f };
      const s = sizes.get(id);
      return s ? { w: s.w, ascent: s.h, descent: 0 } : null;
    };

    // each paragraph's lines (from the cache when nothing about it changed)
    this.used.clear();
    const laid: TextLayout[] = [];
    for (let p = 0; p < n; p++) {
      const runs = paraRuns[p] ?? [];
      const ps = paras[p];
      const st = styleOf(t, ps);
      // runs without a font or size of their own take their paragraph style's
      const resolved = runs.map((r) => (r.font && r.size ? r : { ...r, font: r.font ?? st.font, size: r.size ?? st.size }));
      const objs = runs.filter((r) => r.obj !== undefined).map((r) => {
        const f = fields.get(r.obj!);
        const s = sizes.get(r.obj!);
        return f !== undefined ? `${r.obj}=${f}` : s ? `${r.obj}:${s.w.toFixed(3)}x${s.h.toFixed(3)}` : `${r.obj}?`;
      });
      const bib = hasBib && runs.some(isBib);
      const key = JSON.stringify([resolved, ps, markers[p], textW, objs, st.size, bib ? [t.citeStyle, t.citeOptions, entries.map((e) => [e.label, e.pieces]), st.font] : 0]);
      let lay = this.cache.get(key);
      if (!lay) {
        const frame: TextFrame = {
          runs: resolved, paras: [ps], justify: 'left', wrap: textW, boxes: true, markers: [markers[p]], inline,
        };
        lay = bib ? this.withBlocks(frame, st, entries, isBib) : layoutText(frame, st.size, this.deps.measure);
        this.cache.set(key, lay);
      }
      this.used.add(key);
      laid.push(lay);
    }
    // forget paragraphs no longer in the document
    if (this.cache.size > this.used.size * 2 + 200) for (const k of [...this.cache.keys()]) if (!this.used.has(k)) this.cache.delete(k);

    // stack the lines onto pages
    const pages: PageBox[] = [];
    const lines: LaidLine[] = [];
    const objects: PlacedObject[] = [];
    let pageIdx = 0;
    let cursor = 0;
    let hasContent = false;
    const pageTop = (i: number) => i * (page.h + PAGE_GAP);
    pages.push({ index: 0, top: 0, first: 0, end: 0, label: pageLabel(t.hf, 0) });
    const newPage = () => {
      pages[pageIdx].end = lines.length;
      pageIdx++;
      pages.push({ index: pageIdx, top: pageTop(pageIdx), first: lines.length, end: lines.length, label: pageLabel(t.hf, pageIdx) });
      cursor = 0;
      hasContent = false;
    };
    const heightOf = (l: LaidLine) => (l.above ?? l.ascent) + (l.below ?? l.descent);

    let paraStart = 0;
    for (let p = 0; p < n; p++) {
      const ps = paras[p];
      const lay = laid[p];
      const pl = lay.lines;
      const hs = pl.map(heightOf);
      if (ps.pageBreak && hasContent) newPage();
      // space above a paragraph isn't kept at the top of a page, except on the first page
      const before = () => (hasContent || pageIdx === 0 ? ps.spaceBefore ?? 0 : 0);
      // a heading moves to the next page when the start of the paragraph after it won't fit beside it
      if (ps.keepNext && hasContent && p + 1 < n) {
        const next = laid[p + 1].lines;
        const nextNeed = (paras[p + 1].spaceBefore ?? 0) + next.slice(0, Math.min(2, next.length)).reduce((a, l) => a + heightOf(l), 0);
        const need = before() + sum(hs) + (ps.spaceAfter ?? 0) + nextNeed;
        if (cursor + need > textH + 0.01 && need <= textH) newPage();
      }
      // a paragraph's first line isn't left alone at the bottom of a page
      const firstNeed = sum(hs.slice(0, pl.length >= 2 ? 2 : 1));
      if (hasContent && cursor + before() + firstNeed > textH + 0.01) newPage();
      cursor += before();

      let i = 0;
      let onPage = 0;
      while (i < pl.length) {
        if (hasContent && cursor + hs[i] > textH + 0.01) {
          // its last line isn't left alone at the top of the next page either
          if (pl.length - i === 1 && onPage >= 3) {
            i--;
            lines.pop();
            while (objects.length && objects[objects.length - 1].line === lines.length) objects.pop();
          }
          newPage();
          onPage = 0;
        }
        const l = pl[i];
        const above = l.above ?? l.ascent;
        const top = pageTop(pageIdx) + page.top + cursor;
        const placed = shiftLine(l, page.left, top + above - l.y, paraStart, p);
        lines.push(placed);
        for (const g of placed.pieces) {
          const s = g.obj !== undefined ? sizes.get(g.obj) : undefined;
          if (s && !fields.has(g.obj!)) objects.push({ id: g.obj!, page: pageIdx, x: g.x, y: placed.y - s.h, w: s.w, h: s.h, line: lines.length - 1 });
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

    // a bibliography is picked by clicking anywhere on it: its box on each page it is on
    const blocks = new Map<string, PlacedObject>();
    pages.forEach((pg) => {
      for (let i = pg.first; i < pg.end; i++) {
        const l = lines[i];
        if (l.block === undefined) continue;
        const k = `${l.block}@${pg.index}`;
        const y1 = l.y - (l.above ?? l.ascent), y2 = l.y + (l.below ?? l.descent);
        const got = blocks.get(k);
        if (!got) blocks.set(k, { id: l.block, page: pg.index, x: page.left, y: y1, w: textW, h: y2 - y1, line: i });
        else got.h = y2 - got.y;
      }
    });
    objects.push(...blocks.values());

    const last = pages[pages.length - 1];
    const box = { x1: 0, y1: 0, x2: page.w, y2: last.top + page.h };
    const textLayout: TextLayout = { lines, boxWidth: textW, box, length: text.length, measure: this.deps.measure };
    return { text: textLayout, pages, objects, fields, sizes, pageW: page.w, pageH: page.h, textW };
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

/** The paragraph style a place in the text has. */
export function paraStyleAt(t: DocText, para: number): ParaStyle {
  return fitParas(t.paras, paraCount(rt.plainText(t.runs)))[para] ?? {};
}
