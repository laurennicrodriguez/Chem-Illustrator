// Word's ways of looking at a document (View > Views): Print Layout, the pages as they print;
// Read Mode, the pages two at a time to read and turn; Web Layout, the text wrapped to the
// window with no pages; Draft, the text on one long page at its printed width with the page
// breaks shown as dotted lines; and Outline, the headings indented by level, each with the text
// under it, which can be folded away, shown down to a level, and moved or promoted as a block.
//
// None of them changes the document: each lays out a copy of it changed for the screen (other
// page sizes, no breaks, outline indents), with the same text, so the caret, selection and
// typing work as in Print Layout. Saving, printing and PDFs always use Print Layout's pages.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { fitParas, paraCount, paraRange } from '../text/paragraphs';
import { defaultStyles, setParaStyle, styleOf, type DocText } from './document';

export type DocViewKind = 'print' | 'read' | 'web' | 'outline' | 'draft';

/** Outline view's choices: the levels shown, the headings folded, and how body text is shown. */
export interface OutlineState {
  /** Show Level: headings down to this level (1 to 3), or 0 for every level and the body text. */
  level: number;
  /** Headings folded (by paragraph), their text and lower headings out of sight. */
  collapsed: number[];
  /** Show First Line Only: one line of each paragraph of body text. */
  firstLine: boolean;
  /** Show Text Formatting: off shows everything in the Normal style's font. */
  formatting: boolean;
}

export interface ScreenView {
  kind: DocViewKind;
  /** Web Layout and Outline: the width the text wraps to (the window's, in points). */
  width?: number;
  outline?: OutlineState;
}

export const PRINT_VIEW: ScreenView = { kind: 'print' };

export const VIEW_NAMES: Record<DocViewKind, string> = {
  print: 'Print Layout', read: 'Read Mode', web: 'Web Layout', outline: 'Outline', draft: 'Draft',
};

export function newOutline(): OutlineState {
  return { level: 0, collapsed: [], firstLine: false, formatting: true };
}

/** Views that show the text on one long sheet, without pages. */
export function continuous(kind: DocViewKind): boolean {
  return kind === 'web' || kind === 'draft' || kind === 'outline';
}

/** Height of the one long page of the views without pages (as good as endless). */
export const ENDLESS = 4e6;
/** Room round the text in the views without pages, in points. */
export const SHEET_MARGIN = 18;
/** Outline: how far each level is indented, and the room at the left for the level marks. */
export const OUTLINE_STEP = 24;
export const OUTLINE_LEFT = 36;
/** Narrowest text Web Layout and Outline wrap to, in points. */
const NARROWEST = 144;

/** A paragraph's outline level: 1 to 3 for headings, 0 for body text. */
export function outlineLevel(t: Pick<DocText, 'styles'>, ps: ParaStyle | undefined): number {
  return styleOf(t, ps).outline ?? 0;
}

function allParas(t: DocText): ParaStyle[] {
  return fitParas(t.paras, paraCount(rt.plainText(t.runs)));
}

/** The paragraph after a heading's last paragraph (its text and the lower headings under it). */
export function subtreeEnd(levels: number[], p: number): number {
  const L = levels[p];
  if (!L) return p + 1;
  let q = p + 1;
  while (q < levels.length && !(levels[q] && levels[q] <= L)) q++;
  return q;
}

/** Paragraphs Outline view leaves out: below the level shown, or under a folded heading. */
export function hiddenParas(t: DocText, o: OutlineState): Set<number> {
  const levels = allParas(t).map((ps) => outlineLevel(t, ps));
  const out = new Set<number>();
  if (o.level > 0) levels.forEach((L, p) => { if (!L || L > o.level) out.add(p); });
  for (const p of o.collapsed) {
    if (p >= levels.length || !levels[p] || out.has(p)) continue;
    for (let q = p + 1; q < subtreeEnd(levels, p); q++) out.add(q);
  }
  return out;
}

/** Whether a heading has anything under it (text or lower headings), so it can fold. */
export function hasContent(levels: number[], p: number): boolean {
  return !!levels[p] && subtreeEnd(levels, p) > p + 1;
}

/**
 * The document as a view lays it out: the same text, on other pages. Web Layout: as wide as the
 * window, one endless page; Draft: one endless page at the printed width; Outline: as Web
 * Layout, each paragraph indented by its level. Page and column breaks and headers are left out.
 */
export function screenText(t: DocText, v: ScreenView): DocText {
  if (!continuous(v.kind)) return t;
  const m = SHEET_MARGIN;
  const textW = Math.max(36, t.page.w - t.page.left - t.page.right);
  const left = v.kind === 'outline' ? OUTLINE_LEFT : m;
  const w = v.kind === 'draft' ? textW + 2 * m : Math.max(NARROWEST, v.width ?? textW + 2 * m);
  const page = { ...t.page, w: Math.max(w, left + m + 36), h: ENDLESS, top: m, bottom: m, left, right: m, cols: 1 };
  const hf = { ...t.hf, header: ['', '', ''] as [string, string, string], footer: ['', '', ''] as [string, string, string], numbers: 'none' as const };
  let paras = allParas(t).map((ps) => {
    const { pageBreak: _p, colBreak: _c, keepNext: _k, ...rest } = ps;
    return rest as ParaStyle;
  });
  let runs = t.runs;
  if (v.kind === 'outline') {
    const o = v.outline ?? newOutline();
    let level = 0;
    paras = paras.map((ps) => {
      const L = outlineLevel(t, ps);
      if (L) level = L;
      const depth = L ? L - 1 : level;
      const out: ParaStyle = { ...ps, indent: depth * OUTLINE_STEP, firstLine: undefined, indentRight: undefined, align: 'left', spaceBefore: L ? 6 : 2, spaceAfter: L ? 3 : 2 };
      return o.formatting ? out : { ...out, style: undefined, line: undefined, linePt: undefined, lineRule: undefined };
    });
    if (!o.formatting) runs = runs.map((r) => plainRun(r));
  }
  return { ...t, page, hf, paras, runs };
}

/** A run with its look taken away (Outline without text formatting), keeping what it is. */
function plainRun(r: TextRun): TextRun {
  const { font: _f, size: _s, bold: _b, italic: _i, color: _c, underline: _u, highlight: _h, ...rest } = r;
  return rest as TextRun;
}

// ---------------------------------------------------------------- Outline's commands

const HEADING = (L: number) => `Heading${L}`;

/** A document with Word's three heading styles (one read from a file may lack some). */
export function withHeadings(t: DocText): DocText {
  const d = defaultStyles();
  if ([1, 2, 3].every((L) => t.styles[HEADING(L)])) return t;
  const styles = { ...t.styles };
  for (const L of [1, 2, 3]) styles[HEADING(L)] ??= d[HEADING(L)];
  return { ...t, styles };
}

/** Paragraphs `first` to `last`, with everything folded under the last of them. */
function block(t: DocText, o: OutlineState, first: number, last: number): [number, number] {
  const hidden = hiddenParas(t, o);
  const n = allParas(t).length;
  let end = last + 1;
  while (end < n && hidden.has(end)) end++;
  return [first, end - 1];
}

export type OutlineOp = 'promote' | 'demote' | 'heading1' | 'body';

/**
 * Promote, Demote, Promote to Heading 1 or Demote to Body Text: paragraphs `first` to `last`
 * change level, and with a folded heading everything folded under it moves with it.
 * Promoting body text makes it a heading at the level of the heading above it.
 */
export function changeLevel(t: DocText, o: OutlineState, first: number, last: number, op: OutlineOp): DocText {
  t = withHeadings(t);
  const paras = allParas(t);
  const levels = paras.map((ps) => outlineLevel(t, ps));
  const [a, b] = block(t, o, first, last);
  const folded = new Set(o.collapsed);
  // a folded heading's hidden lower headings move with it (by promote and demote)
  const moving = new Set<number>();
  for (let p = first; p <= last; p++) moving.add(p);
  for (let p = a; p <= b; p++) if (levels[p] && [...moving].some((q) => folded.has(q) && q < p)) moving.add(p);
  let out = t;
  for (const p of [...moving].sort((x, y) => x - y)) {
    const L = levels[p];
    let to: number | null = null;
    if (op === 'heading1') to = p >= first && p <= last ? 1 : null;
    else if (op === 'body') to = p >= first && p <= last ? 0 : null;
    else if (op === 'promote') {
      if (L > 1) to = L - 1;
      else if (!L) {
        let above = 0;
        for (let q = p - 1; q >= 0 && !above; q--) above = levels[q];
        to = Math.max(1, above);
      }
    } else if (op === 'demote' && L && L < 3) to = L + 1;
    if (to === null || to === L) continue;
    out = setParaStyle(out, p, p, to ? HEADING(to) : 'Normal');
  }
  return out;
}

/**
 * Move Up or Move Down: paragraphs `first` to `last` (with anything folded under them) change
 * places with the paragraph before or after them as shown (a folded heading with all under it).
 * Gives the new document, where the moved paragraphs now start and end, and where every
 * paragraph went (to keep the folded headings folded). Null when there is nowhere to go.
 */
export function moveParas(t: DocText, o: OutlineState, first: number, last: number, dir: -1 | 1): { t: DocText; first: number; last: number; moved: (p: number) => number } | null {
  const paras = allParas(t);
  const n = paras.length;
  const hidden = hiddenParas(t, o);
  const [a, b] = block(t, o, first, last);
  let x0: number, x1: number;
  if (dir < 0) {
    let q = a - 1;
    while (q >= 0 && hidden.has(q)) q--;
    if (q < 0) return null;
    [x0, x1] = [q, a - 1];
  } else {
    if (b + 1 >= n) return null;
    [x0, x1] = block(t, o, b + 1, b + 1);
  }
  // the two blocks, in their new order
  const [p0, p1, q0, q1] = dir < 0 ? [a, b, x0, x1] : [x0, x1, a, b];
  // p0..p1 goes in front of q0..q1 (which comes first now)
  const text = rt.plainText(t.runs);
  const start = (p: number) => paraRange(text, p).start;
  const end = (p: number) => paraRange(text, p).end;
  const sep = rt.sliceRuns(t.runs, end(q1), end(q1) + 1);
  const nl = sep.length ? sep : [{ text: '\n' }];
  const region = [
    ...rt.sliceRuns(t.runs, start(p0), end(p1)),
    ...nl,
    ...rt.sliceRuns(t.runs, start(q0), end(q1)),
  ];
  const runs = rt.normalizeRuns([...rt.sliceRuns(t.runs, 0, start(q0)), ...region, ...rt.sliceRuns(t.runs, end(p1), text.length)]);
  const order = [...range(0, q0), ...range(p0, p1 + 1), ...range(q0, q1 + 1), ...range(p1 + 1, n)];
  const where = new Map<number, number>();
  order.forEach((old, i) => where.set(old, i));
  const out = { ...t, runs, paras: order.map((p) => paras[p]) };
  return { t: out, first: where.get(first)!, last: where.get(last)!, moved: (p) => where.get(p) ?? p };
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/** Expand or Collapse: fold or unfold the headings in paragraphs `first` to `last` (one level at a time, as Word does). */
export function foldHeadings(t: DocText, o: OutlineState, first: number, last: number, fold: boolean): OutlineState {
  const levels = allParas(t).map((ps) => outlineLevel(t, ps));
  const set = new Set(o.collapsed.filter((p) => p < levels.length && levels[p]));
  const heads: number[] = [];
  for (let p = first; p <= last; p++) if (hasContent(levels, p)) heads.push(p);
  // on body text: its heading folds (or unfolds) at once
  if (!heads.length) {
    let q = first;
    while (q >= 0 && !levels[q]) q--;
    if (q >= 0 && hasContent(levels, q)) {
      if (fold) set.add(q); else set.delete(q);
    }
  }
  for (const p of heads) {
    if (fold) {
      // fold the deepest headings still open first, then each level up to this one
      const open = range(p, subtreeEnd(levels, p)).filter((q) => hasContent(levels, q) && !set.has(q) && !hiddenBy(set, levels, q));
      const deepest = Math.max(0, ...open.map((q) => levels[q]));
      for (const q of open) if (levels[q] === deepest) set.add(q);
    } else {
      // unfold the heading, then the headings under it one level at a time
      if (set.has(p)) set.delete(p);
      else {
        const shut = range(p + 1, subtreeEnd(levels, p)).filter((q) => set.has(q) && !hiddenBy(set, levels, q));
        for (const q of shut) set.delete(q);
      }
    }
  }
  return { ...o, collapsed: [...set].sort((a, b) => a - b) };
}

/** Whether paragraph `q` is out of sight under another folded heading. */
function hiddenBy(set: Set<number>, levels: number[], q: number): boolean {
  for (const p of set) if (p < q && subtreeEnd(levels, p) > q) return true;
  return false;
}

/** Fold or unfold one heading (a click on its mark). */
export function toggleFold(o: OutlineState, p: number): OutlineState {
  const set = new Set(o.collapsed);
  if (set.has(p)) set.delete(p); else set.add(p);
  return { ...o, collapsed: [...set].sort((a, b) => a - b) };
}

/**
 * Keep the folded headings with their paragraphs after the text changed: paragraphs added or
 * taken away before a heading move it (`at` the paragraph where the change was, `delta` how
 * many paragraphs were added, negative when taken away).
 */
export function shiftFolds(o: OutlineState, at: number, delta: number): OutlineState {
  if (!delta || !o.collapsed.length) return o;
  const collapsed = o.collapsed.filter((p) => delta > 0 || p <= at || p > at - delta).map((p) => (p > at ? p + delta : p));
  return { ...o, collapsed };
}

/** The marks at the left of each paragraph shown in Outline view. */
export interface OutlineMark {
  para: number;
  /** A heading with something under it (⊕, a line under it when folded), one with nothing (⊖), or body text (a dot). */
  kind: 'open' | 'folded' | 'empty' | 'body';
}

export function outlineMarks(t: DocText, o: OutlineState): OutlineMark[] {
  const levels = allParas(t).map((ps) => outlineLevel(t, ps));
  const hidden = hiddenParas(t, o);
  const folded = new Set(o.collapsed);
  const out: OutlineMark[] = [];
  levels.forEach((L, p) => {
    if (hidden.has(p)) return;
    const kind = !L ? 'body' : !hasContent(levels, p) ? 'empty' : folded.has(p) || (o.level > 0 && L >= o.level) ? 'folded' : 'open';
    out.push({ para: p, kind });
  });
  return out;
}

/** Paragraphs that start a new page or column in print (shown as dotted lines in Draft). */
export function breaksIn(t: DocText): { para: number; kind: 'page' | 'column' }[] {
  const out: { para: number; kind: 'page' | 'column' }[] = [];
  allParas(t).forEach((ps, p) => {
    if (p > 0 && ps.pageBreak) out.push({ para: p, kind: 'page' });
    else if (p > 0 && ps.colBreak) out.push({ para: p, kind: 'column' });
  });
  return out;
}
