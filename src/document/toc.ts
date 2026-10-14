// A table of contents (References > Table of Contents, as in Word): the headings of the document
// (paragraphs in the Heading 1, 2 or 3 style, down to the level chosen), each with its page
// number at the right after a line of dots. It sits in the text as one character, like the
// bibliography, and is worked out again whenever the text changes, so it never needs updating
// by hand. Its page numbers come from laying the document out: see DocLayouter.layout.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { FONT_STACK, layoutText, type Glyphs, type LaidLine, type Measure } from '../text/layout';
import { fitParas, paraCount, splitParagraphs } from '../text/paragraphs';
import { styleOf, type DocText, type NamedStyle } from './document';

export interface TocEntry {
  /** 1 for Heading 1, and so on. */
  level: number;
  text: string;
  /** The heading's paragraph. */
  para: number;
}

/** What the contents show when there are no headings yet (on screen and in the PDF only). */
export const EMPTY_TOC = 'Table of contents: no headings yet. Give paragraphs the Heading 1, 2 or 3 style and they appear here.';

/** The headings down to `levels` (1 to 3) deep, in order, as plain text. */
export function tocEntries(t: DocText, levels = 3): TocEntry[] {
  const runs = splitParagraphs(t.runs);
  const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
  const out: TocEntry[] = [];
  paras.forEach((ps, p) => {
    const level = styleOf(t, ps).outline;
    if (!level || level > levels) return;
    // figures and fields in a heading are left out; a line break is a space
    const text = (runs[p] ?? []).filter((r) => r.obj === undefined).map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ level, text, para: p });
  });
  return out;
}

/** How far each level of the contents is indented (Word's 0.15 in a level). */
export const TOC_INDENT = 11;

/**
 * The contents' lines, laid out `wrap` wide from the origin: each heading's text (wrapping short
 * of the page numbers), then dots and its page number at the right of its last line.
 */
export function tocLines(entries: TocEntry[], pageOf: (para: number) => string, st: NamedStyle, line: number | undefined, wrap: number, measure: Measure): LaidLine[] {
  const base = { font: st.font, size: st.size };
  const family = `${st.font}, ${FONT_STACK}`;
  if (!entries.length) {
    return layoutText({ runs: [{ ...base, italic: true, color: '#8a8f98', text: EMPTY_TOC }], paras: [{ line }], justify: 'left', wrap, boxes: true }, st.size, measure).lines;
  }
  const labels = entries.map((e) => pageOf(e.para));
  const numW = Math.max(0, ...labels.map((l) => measure(l, st.size, family, '')));
  // room kept at the right for the dots and the number
  const keep = numW + 2 * st.size;
  const runs: TextRun[] = [];
  entries.forEach((e, i) => {
    if (i) runs.push({ ...base, text: '\n' });
    runs.push({ ...base, text: e.text });
  });
  const paras: ParaStyle[] = entries.map((e) => ({ indent: (e.level - 1) * TOC_INDENT, indentRight: keep, line, spaceBefore: e.level === 1 && entries.length > 1 ? 0.25 * st.size : 0 }));
  const lay = layoutText({ runs, paras, justify: 'left', wrap, boxes: true }, st.size, measure);
  const unit = '. ';
  const unitW = measure(unit, st.size, family, '');
  const lines = lay.lines.map((l) => ({ ...l, pieces: [...l.pieces] }));
  for (const l of lines) {
    if (!l.last) continue;
    const label = labels[l.para] ?? '';
    const w = measure(label, st.size, family, '');
    const numX = wrap - w;
    const from = l.x + l.width + 0.4 * st.size;
    const to = numX - 0.3 * st.size;
    const n = unitW > 0 ? Math.floor((to - from) / unitW) : 0;
    const piece = (text: string, x: number, pw: number): Glyphs => ({ text, start: l.end, x, w: pw, dy: 0, size: st.size, family, style: '', decor: true });
    if (n > 0) {
      const dots = unit.repeat(n).trimEnd();
      const dw = measure(dots, st.size, family, '');
      l.pieces.push(piece(dots, to - dw, dw));
    }
    l.pieces.push(piece(label, numX, w));
    l.width = wrap - l.x;
  }
  return lines;
}

/** The contents as plain text, a line each ("Synthesis\t4"): for Word files and finding text. */
export function tocText(entries: TocEntry[], pageOf: (para: number) => string): string {
  return entries.map((e) => `${e.text}\t${pageOf(e.para)}`).join('\n');
}

/** Is this run the contents? */
export const isToc = (t: Pick<DocText, 'objects'>, r: { obj?: number }): boolean => r.obj !== undefined && t.objects[r.obj]?.kind === 'toc';

