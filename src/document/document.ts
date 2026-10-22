// A document (Document mode, as in Word): one long styled text, each paragraph with its own
// formatting, plus the named styles (Normal, Heading 1…), the page setup, the header and
// footer, and the figures, tables and fields that sit in the text. It is a RichText, so the
// text editing every other mode uses works on it, and it is plain data changed by making new
// copies, so Undo can put back any earlier state.
//
// Every paragraph and run holds its formatting in full (a Heading 1 paragraph's runs say
// bold, 13 pt). A named style is applied by changing the runs and paragraphs that look the
// way the style did into the way it looks now, so changing a style once changes the whole
// document, while anything formatted by hand (an italic word, a paragraph centred on its
// own) keeps its own look.

import type { CommentThread } from './comments';
import type { Contents, Justify, ParaStyle, TableData, TextRun } from '../model';
import type { RichText } from '../text/editing';
import { ACS_1996, type DocStyle } from '../style';
import * as rt from '../richtext';
import { cleanPara, fitParas, paraCount, paraRange } from '../text/paragraphs';
import { citationTexts, type CiteStyle, type Reference } from './references';
import type { CiteFormat } from './cite-styles';
import type { ChartBox } from '../sheet/chart-box';

/** The character that stands for a figure, table or field in the text (Unicode's object replacement character). */
export const OBJECT_CHAR = '￼';

/** A named paragraph style: the look of its text and of its paragraphs. */
export interface NamedStyle {
  /** Word's style id (Normal, Heading1…), so files keep their styles. */
  id: string;
  /** The name shown (Heading 1). */
  name: string;
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color?: string;
  align: Justify;
  /** Space above and below, in points. */
  spaceBefore: number;
  spaceAfter: number;
  /** Line spacing as a multiple of single. */
  line: number;
  /** Left indent, and the first line's indent from it, in points. */
  indent: number;
  firstLine: number;
  /** Kept on the page with the next paragraph (headings). */
  keepNext: boolean;
  /** The style a new paragraph gets after Enter at the end of one of these (Normal after a heading). */
  next?: string;
  /** A heading's level (1 to 3). */
  outline?: number;
}

/** Page size and margins, in points. */
export interface PageSetup {
  w: number;
  h: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** How far the header is from the top of the page, and the footer from the bottom. */
  header: number;
  footer: number;
  /** Columns of text (one when left out), and the space between them in points. */
  cols?: number;
  colGap?: number;
}

/** The space between columns unless set (Word's half inch). */
export const COL_GAP = 36;

/** The number of columns and the width of each, for a page whose text is `textW` wide. */
export function columnsOf(page: PageSetup, textW: number): { n: number; gap: number; w: number } {
  const n = Math.max(1, Math.min(4, Math.round(page.cols ?? 1)));
  const gap = n > 1 ? Math.max(0, page.colGap ?? COL_GAP) : 0;
  return { n, gap, w: Math.max(36, (textW - gap * (n - 1)) / n) };
}

export type NumberPlace = 'none' | 'footer-left' | 'footer-center' | 'footer-right' | 'header-left' | 'header-center' | 'header-right';

/** The header and footer: text at the left, centre and right, and where the page number goes. */
export interface HeaderFooter {
  header: [string, string, string];
  footer: [string, string, string];
  numbers: NumberPlace;
  /** Before each page number ("S" for S1, S2… in Supporting Information). */
  prefix: string;
  /** The first page's number. */
  start: number;
  /** Shown on the first page (often left off a cover or title page). */
  onFirst: boolean;
}

/** A figure's or picture's frame and shadow (Word's Picture Format). */
export interface FigureLook {
  /** A line round it, this many points wide, in `frameColor` (black when not set). */
  frame?: number;
  frameColor?: string;
  /** A shadow down and to the right (the figure then gets a white background, so the shadow is a box's). */
  shadow?: 'soft' | 'hard';
}

/** The two shadows: how far down and right, how blurred and how dark, in points. */
export const SHADOWS: Record<'soft' | 'hard', { off: number; blur: number; alpha: number }> = {
  soft: { off: 3, blur: 6, alpha: 0.35 },
  hard: { off: 3, blur: 0, alpha: 0.5 },
};

/** How far a frame and shadow reach outside a figure's box: left, top, right, bottom, in points. */
export function lookExtent(look: FigureLook | undefined): [number, number, number, number] {
  const f = (look?.frame ?? 0) / 2;
  const s = look?.shadow ? SHADOWS[look.shadow] : null;
  const r = s ? s.off + s.blur : 0;
  return [f, f, Math.max(f, r), Math.max(f, r)];
}

/**
 * How text goes round a figure taken out of the line (Word's Wrap Text): beside it on its wider
 * side (square), above and below only (top and bottom), or not at all, with the figure behind or
 * in front of the text.
 */
export type WrapKind = 'square' | 'topBottom' | 'behind' | 'front';

/**
 * A figure placed on the page instead of in a line. Its character stays in the text where it is
 * anchored (its paragraph). `x` is from the left margin (or the page's edge), `y` from the top of
 * the anchor paragraph (or of the margin, or the page), in points.
 */
export interface Float {
  wrap: WrapKind;
  x: number;
  y: number;
  xFrom?: 'margin' | 'page';
  yFrom?: 'para' | 'margin' | 'page';
  /** Room kept between the figure and the text round it, in points (Word's is 0.13 in). */
  gap?: number;
}

/** The room text keeps from a floating figure unless set (Word's 0.13 inch). */
export const FLOAT_GAP = 9;

/** A text box's inner margins, in points (Word's: 0.1 in at the sides, 0.05 in above and below). */
export const BOX_PAD = { x: 7.2, y: 3.6 };

/** A figure's, picture's or text box's frame and shadow (none for other objects). */
export function lookOf(o: DocObject | undefined): FigureLook | undefined {
  return o && (o.kind === 'drawing' || o.kind === 'picture' || o.kind === 'textbox') ? o.look : undefined;
}

/** Where a figure, picture or text box floats on the page (none when it sits in its line). */
export function floatOf(o: DocObject | undefined): Float | undefined {
  return o && (o.kind === 'drawing' || o.kind === 'picture' || o.kind === 'textbox') ? o.float : undefined;
}

/** Something that sits in the text in place of one character. */
export type DocObject =
  /** A structure, scheme or table: a drawing, edited with the drawing tools. `scale` 1 is the drawing's own size. */
  | { kind: 'drawing'; contents: Contents; scale?: number; look?: FigureLook; float?: Float }
  /**
   * A picture: its own size is w × h points (`px` its pixels); `scale` 1 is that size. A chart
   * (Insert > Chart) is a picture with its chart and data: drawn from them, saved as Word's chart.
   */
  | { kind: 'picture'; src: string; w: number; h: number; px?: { w: number; h: number }; scale?: number; look?: FigureLook; float?: Float; chart?: ChartBox }
  /**
   * A text box: text of its own (typed into in place), `w` wide; it grows to fit its text, and is
   * at least `h` tall when that is set. Always placed on the page. `fill` is its background.
   */
  | { kind: 'textbox'; runs: TextRun[]; paras?: ParaStyle[]; w: number; h?: number; fill?: string; look?: FigureLook; float: Float }
  /**
   * A table in the text, typed into in place as in Word: its own paragraph, cells of text that
   * can hold structures and pictures (objects of the document, like those in the text), and
   * grid lines, the ACS rules, or none.
   */
  | { kind: 'table'; table: TableData }
  /** A caption's number (Figure 1, Scheme 2): it counts the captions of its name. */
  | { kind: 'seq'; name: string }
  /** A reference to a caption ("see Figure 2"), which follows its number. */
  | { kind: 'ref'; target: number }
  /** A citation of references in the document's list (by their ids): numbers in order of first citation. */
  | { kind: 'cite'; refs: string[] }
  /** The bibliography: the references cited, in citation order, in the citation style (a block of its own). */
  | { kind: 'bib' }
  /** A table of contents: the headings down to `levels` (1 to 3) deep with their page numbers (a block of its own). */
  | { kind: 'toc'; levels: number }
  /** An equation, typed as LaTeX and shown laid out as maths (see math.ts); a Word equation in .docx files. */
  | { kind: 'math'; tex: string };

export interface DocText extends RichText {
  styles: Record<string, NamedStyle>;
  page: PageSetup;
  hf: HeaderFooter;
  objects: Record<number, DocObject>;
  /** How structures are drawn (bond length, line widths, label fonts). */
  drawingStyle: DocStyle;
  /** The document's references (References > Manage References), cited or not. */
  references?: Reference[];
  /** How citations and the bibliography are printed (when not chosen, the person's own style: ACS unless changed). */
  citeStyle?: CiteStyle;
  /** Details of that style changed for this document (References > Manage References > Style Options). */
  citeOptions?: Partial<CiteFormat>;
  /** Changes are being tracked (Review > Track Changes): edits are marked, not made outright. */
  track?: boolean;
  /** Comments (Review > New Comment), by id; the text they are on carries the id (see comments.ts). */
  comments?: Record<number, CommentThread>;
}

// ---------------------------------------------------------------- defaults

/** Paper sizes in points. */
export const LETTER = { w: 612, h: 792 };
export const A4 = { w: 595.3, h: 841.9 };
export const INCH = 72;
export const CM = 72 / 2.54;

const FONT = 'Times New Roman';

/**
 * The standard styles, as in a journal's Supporting Information (taken from SI Assistant's ACS
 * style): Times New Roman 11 pt, justified, headings in bold, captions 10 pt. All can be changed.
 */
export function defaultStyles(): Record<string, NamedStyle> {
  const base = { font: FONT, bold: false, italic: false, indent: 0, firstLine: 0, line: 1, keepNext: false };
  const list: NamedStyle[] = [
    { ...base, id: 'Normal', name: 'Normal', size: 11, align: 'justify', spaceBefore: 0, spaceAfter: 8 },
    { ...base, id: 'Title', name: 'Title', size: 16, bold: true, align: 'center', spaceBefore: 0, spaceAfter: 12, next: 'Normal' },
    { ...base, id: 'Heading1', name: 'Heading 1', size: 13, bold: true, align: 'left', spaceBefore: 18, spaceAfter: 8, keepNext: true, next: 'Normal', outline: 1 },
    { ...base, id: 'Heading2', name: 'Heading 2', size: 11.5, bold: true, align: 'left', spaceBefore: 12, spaceAfter: 6, keepNext: true, next: 'Normal', outline: 2 },
    { ...base, id: 'Heading3', name: 'Heading 3', size: 11, bold: true, italic: true, align: 'left', spaceBefore: 10, spaceAfter: 4, keepNext: true, next: 'Normal', outline: 3 },
    { ...base, id: 'Caption', name: 'Caption', size: 10, align: 'justify', spaceBefore: 4, spaceAfter: 12, next: 'Normal' },
  ];
  return Object.fromEntries(list.map((s) => [s.id, s]));
}

export function defaultPage(): PageSetup {
  return { ...LETTER, top: INCH, bottom: INCH, left: INCH, right: INCH, header: 0.5 * INCH, footer: 0.5 * INCH };
}

export function defaultHeaderFooter(): HeaderFooter {
  return { header: ['', '', ''], footer: ['', '', ''], numbers: 'footer-center', prefix: '', start: 1, onFirst: true };
}

/** A new, empty document. */
export function newDocument(): DocText {
  const styles = defaultStyles();
  return {
    runs: [],
    paras: [paraFromStyle(styles.Normal, {})],
    justify: 'left',
    styles,
    page: defaultPage(),
    hf: defaultHeaderFooter(),
    objects: {},
    drawingStyle: { ...ACS_1996 },
  };
}

// ---------------------------------------------------------------- styles

/** The named style of a paragraph (Normal when it names none, or one the document doesn't have). */
export function styleOf(t: Pick<DocText, 'styles'>, p: ParaStyle | undefined): NamedStyle {
  return t.styles[p?.style ?? 'Normal'] ?? t.styles.Normal ?? defaultStyles().Normal;
}

/** The text formatting a style gives. */
export function runStyleOf(s: NamedStyle): rt.RunStyle {
  return rt.cleanStyle({ font: s.font, size: s.size, bold: s.bold, italic: s.italic, color: s.color });
}

/** A paragraph in a style: the style's spacing, indents and alignment, keeping its list, level and page break. */
export function paraFromStyle(s: NamedStyle, keep: ParaStyle): ParaStyle {
  return cleanPara({
    list: keep.list, level: keep.level, cont: keep.cont, pageBreak: keep.pageBreak, colBreak: keep.colBreak,
    style: s.id === 'Normal' ? undefined : s.id,
    align: s.align === 'left' ? undefined : s.align,
    spaceBefore: s.spaceBefore, spaceAfter: s.spaceAfter,
    line: s.line === 1 ? undefined : s.line,
    indent: s.indent, firstLine: s.firstLine, keepNext: s.keepNext,
  });
}

/** A paragraph's own value of a style setting (as stored: missing means 0, left, single, off). */
function paraValue(p: ParaStyle, k: 'align' | 'spaceBefore' | 'spaceAfter' | 'line' | 'indent' | 'firstLine' | 'keepNext'): unknown {
  switch (k) {
    case 'align': return p.align ?? 'left';
    case 'line': return p.line ?? 1;
    case 'keepNext': return !!p.keepNext;
    default: return p[k] ?? 0;
  }
}

const PARA_KEYS = ['align', 'spaceBefore', 'spaceAfter', 'line', 'indent', 'firstLine', 'keepNext'] as const;

/** A paragraph after its style changed from `from` to `to`: what looked like `from` now looks like `to`. */
export function restylePara(p: ParaStyle, from: NamedStyle, to: NamedStyle): ParaStyle {
  const want = paraFromStyle(to, p);
  const out: ParaStyle = { ...p, style: want.style };
  for (const k of PARA_KEYS) {
    const fromV = k === 'align' ? from.align : k === 'keepNext' ? from.keepNext : from[k];
    if (paraValue(p, k) === fromV) (out as Record<string, unknown>)[k] = (want as Record<string, unknown>)[k];
  }
  return cleanPara(out);
}

/** A run after its paragraph's style changed: each setting that matched the old style takes the new one. */
export function restyleRun(r: TextRun, from: NamedStyle, to: NamedStyle): TextRun {
  const out: TextRun = { ...r };
  if ((r.font ?? from.font) === from.font) out.font = to.font;
  if ((r.size ?? from.size) === from.size) out.size = to.size;
  if (!!r.bold === from.bold) out.bold = to.bold || undefined;
  if (!!r.italic === from.italic) out.italic = to.italic || undefined;
  if ((r.color ?? undefined) === (from.color ?? undefined)) out.color = to.color;
  return out;
}

/** Runs of the text, each paragraph's runs changed by `f` (which gets the paragraph's index). */
function mapParagraphRuns(runs: TextRun[], f: (r: TextRun, para: number) => TextRun): TextRun[] {
  const out: TextRun[] = [];
  let p = 0;
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((text, i) => {
      // a line break takes the look of the paragraph it ends
      if (i > 0) { out.push(f({ ...r, text: '\n' }, p)); p++; }
      if (text) out.push(f({ ...r, text }, p));
    });
  }
  return rt.normalizeRuns(out);
}

/** Give paragraphs `first` to `last` a named style (Normal, Heading 1…). */
export function setParaStyle(t: DocText, first: number, last: number, id: string): DocText {
  const to = t.styles[id];
  if (!to) return t;
  const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
  const from = paras.map((p) => styleOf(t, p));
  const runs = mapParagraphRuns(t.runs, (r, p) => (p < first || p > last ? r : restyleRun(r, from[p], to)));
  return { ...t, runs, paras: paras.map((p, i) => (i < first || i > last ? p : paraFromStyle(to, p))) };
}

/** Change a named style: every paragraph in it changes too (except what was formatted by hand). */
export function modifyStyle(t: DocText, s: NamedStyle): DocText {
  const old = t.styles[s.id];
  const styles = { ...t.styles, [s.id]: s };
  if (!old) return { ...t, styles };
  const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
  const mine = paras.map((p) => (p.style ?? 'Normal') === s.id);
  const runs = mapParagraphRuns(t.runs, (r, p) => (mine[p] ? restyleRun(r, old, s) : r));
  return { ...t, styles, runs, paras: paras.map((p, i) => (mine[i] ? restylePara(p, old, s) : p)) };
}

// ---------------------------------------------------------------- objects and fields

/** Ids of the objects in the text, in order. */
export function objectsInText(runs: TextRun[]): number[] {
  const out: number[] = [];
  for (const r of runs) if (r.obj !== undefined) for (let i = 0; i < r.text.length; i++) out.push(r.obj);
  return out;
}

export function nextObjectId(t: Pick<DocText, 'objects'>): number {
  let max = 0;
  for (const k of Object.keys(t.objects)) max = Math.max(max, Number(k));
  return max + 1;
}

/** The runs that put an object in the text, in the formatting of the text around it. */
export function objectRun(id: number, style: rt.RunStyle): TextRun {
  return { ...style, obj: id, text: OBJECT_CHAR };
}

/** The objects inside an object (structures in a table's cells), in order. */
export function innerObjects(o: DocObject | undefined): number[] {
  if (o?.kind === 'table') return o.table.rows.flatMap((row) => row.flatMap((c) => objectsInText(c.runs)));
  return [];
}

/**
 * The text with each table's cells' text after its character, cell by cell: the order the
 * objects come in, for numbering captions and compounds wherever they are.
 */
export function flatRuns(t: Pick<DocText, 'runs' | 'objects'>): TextRun[] {
  if (!Object.values(t.objects).some((o) => o.kind === 'table')) return t.runs;
  const out: TextRun[] = [];
  const seen = new Set<number>();
  const add = (runs: TextRun[]) => {
    for (const r of runs) {
      out.push(r);
      const o = r.obj !== undefined ? t.objects[r.obj] : undefined;
      // a table's cells (and those of any table inside them)
      if (o?.kind === 'table' && !seen.has(r.obj!)) { seen.add(r.obj!); for (const row of o.table.rows) for (const c of row) add(c.runs); }
    }
  };
  add(t.runs);
  return out;
}

/**
 * The tables inside table cells, the innermost first (each laid out before the cell holding
 * it), with how deep each one is (1 for a table in a cell of a table in the text).
 */
export function nestedTables(t: Pick<DocText, 'objects'>): { id: number; depth: number; parent: number }[] {
  const out: { id: number; depth: number; parent: number }[] = [];
  const seen = new Set<number>();
  const held = new Set<number>();
  for (const o of Object.values(t.objects)) {
    if (o.kind === 'table') for (const row of o.table.rows) for (const c of row) for (const r of c.runs) if (r.obj !== undefined && t.objects[r.obj]?.kind === 'table') held.add(r.obj);
  }
  const visit = (id: number, depth: number) => {
    const o = t.objects[id];
    if (o?.kind !== 'table') return;
    for (const row of o.table.rows) for (const c of row) for (const r of c.runs) {
      if (r.obj === undefined || t.objects[r.obj]?.kind !== 'table' || seen.has(r.obj)) continue;
      seen.add(r.obj);
      visit(r.obj, depth + 1);
      out.push({ id: r.obj, depth: depth + 1, parent: id });
    }
  };
  for (const [k, o] of Object.entries(t.objects)) {
    const id = Number(k);
    if (o.kind === 'table' && !held.has(id)) { seen.add(id); visit(id, 0); }
  }
  return out;
}

/** The table cell an object sits in (a structure or picture in a table), or null for one in the text. */
export function cellHolding(t: Pick<DocText, 'objects'>, id: number): { id: number; r: number; c: number } | null {
  for (const [k, o] of Object.entries(t.objects)) {
    if (o.kind !== 'table') continue;
    for (let r = 0; r < o.table.rows.length; r++) {
      const c = o.table.rows[r].findIndex((cell) => cell.runs.some((x) => x.obj === id));
      if (c >= 0) return { id: Number(k), r, c };
    }
  }
  return null;
}

/** Every object the text uses, with those inside tables. */
export function usedObjects(t: Pick<DocText, 'runs' | 'objects'>): Set<number> {
  return new Set(objectsInText(flatRuns(t)));
}

/** Keep only the objects the text still uses (before saving). */
export function pruneObjects(t: DocText): DocText {
  const used = usedObjects(t);
  const objects: Record<number, DocObject> = {};
  for (const [k, v] of Object.entries(t.objects)) if (used.has(Number(k))) objects[Number(k)] = v;
  return { ...t, objects };
}

/** Where each object's character is in the text. */
/**
 * Moving an in-line figure (the one character at `at`) to the text place `to`: where to put the copy
 * first and then where the old one is left to delete. Null when the drop is on or beside itself.
 */
export function inlineMove(at: number, to: number | null): { insertAt: number; removeAt: number } | null {
  if (to === null || to === at || to === at + 1) return null;
  return to > at ? { insertAt: to, removeAt: at } : { insertAt: to, removeAt: at + 1 };
}

export function objectOffsets(runs: TextRun[]): Map<number, number> {
  const out = new Map<number, number>();
  let at = 0;
  for (const r of runs) {
    if (r.obj !== undefined) for (let i = 0; i < r.text.length; i++) if (!out.has(r.obj)) out.set(r.obj, at + i);
    at += r.text.length;
  }
  return out;
}

/** What compound numbers count: each new compound gets the next number, in order of first mention. */
export const COMPOUND = 'Compound';

/**
 * What each field shows: a caption's number counts the captions of its name before it (the
 * third Figure caption shows 3); a reference shows its caption's label and number, as Word's
 * "label and number" does: the caption's text from its start up to the number ("Figure S3").
 * A reference to a compound shows just its number. A citation shows the numbers of the
 * references it cites (in the order references are first cited).
 */
export function fieldTexts(t: Pick<DocText, 'runs' | 'objects'> & Partial<Pick<DocText, 'references' | 'citeStyle' | 'citeOptions'>>): Map<number, string> {
  const shown = new Map<number, string>();
  const counts = new Map<string, number>();
  // numbers inside tables count in their place too
  t = { ...t, runs: flatRuns(t) };
  const order = objectsInText(t.runs);
  for (const id of order) {
    const o = t.objects[id];
    if (o?.kind !== 'seq') continue;
    const n = (counts.get(o.name) ?? 0) + 1;
    counts.set(o.name, n);
    shown.set(id, String(n));
  }
  if (order.some((id) => t.objects[id]?.kind === 'ref')) {
    const text = rt.plainText(t.runs);
    const at = objectOffsets(t.runs);
    for (const id of order) {
      const o = t.objects[id];
      if (o?.kind !== 'ref') continue;
      const target = at.get(o.target);
      if (target === undefined || !shown.has(o.target)) { shown.set(id, 'Error! Reference source not found.'); continue; }
      const seq = t.objects[o.target];
      if (seq?.kind === 'seq' && seq.name === COMPOUND) { shown.set(id, shown.get(o.target)!); continue; }
      shown.set(id, labelText(text, target, (i) => objectAtChar(t.runs, i), shown).trim());
    }
  }
  if (order.some((id) => t.objects[id]?.kind === 'cite')) for (const [id, s] of citationTexts(t)) shown.set(id, s);
  return shown;
}

/** The object whose character is at an offset. */
function objectAtChar(runs: TextRun[], offset: number): number | undefined {
  let at = 0;
  for (const r of runs) {
    if (offset < at + r.text.length) return r.obj;
    at += r.text.length;
  }
  return undefined;
}

/** A caption's label and number: its paragraph's text from the start through the number at `at`. */
function labelText(text: string, at: number, objAt: (i: number) => number | undefined, shown: Map<number, string>): string {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  let out = '';
  for (let i = start; i <= at; i++) {
    if (text[i] === OBJECT_CHAR) {
      const id = objAt(i);
      out += id !== undefined ? shown.get(id) ?? '' : '';
    } else out += text[i];
  }
  return out;
}

/** The kinds of caption, with what each counts. */
export const CAPTION_NAMES = ['Figure', 'Scheme', 'Table', 'Chart', 'Equation'] as const;

/**
 * A new caption paragraph's runs: "Figure 1. " with the label and number in bold, as journals
 * set them, then a space for the caption itself. `prefix` goes before the number (S for S1).
 */
export function captionRuns(name: string, prefix: string, seqId: number, style: rt.RunStyle): TextRun[] {
  const bold = { ...style, bold: true };
  return [
    { ...bold, text: `${name} ${prefix}` },
    objectRun(seqId, bold),
    { ...bold, text: '.' },
    { ...style, text: ' ' },
  ];
}

// ---------------------------------------------------------------- paragraphs

/** The paragraph range around an offset (start, end, index). */
export function paragraphAt(t: Pick<RichText, 'runs'>, offset: number): { index: number; start: number; end: number } {
  const text = rt.plainText(t.runs);
  let index = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) index++;
  return { index, ...paraRange(text, index) };
}

/** Text of a document without objects (for word counts, searching and plain copies). */
export function documentPlainText(t: Pick<DocText, 'runs' | 'objects'> & Partial<Pick<DocText, 'references' | 'citeStyle' | 'citeOptions'>>): string {
  const shown = fieldTexts(t);
  let out = '';
  for (const r of t.runs) {
    if (r.obj === undefined) { out += r.text; continue; }
    const s = shown.get(r.obj);
    if (s !== undefined) out += s;
  }
  return out;
}
