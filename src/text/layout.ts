// Laying out styled text: where every piece of text goes, line by line. One layout serves the
// page (captions and text boxes), the pictures made for Word and PowerPoint, and the text
// editor (caret, selection, clicking into text), so all of them agree to the point.
//
// A text has paragraphs (split at line breaks), each with its own list bullet or number,
// indent, spacing and alignment. In a text box (`wrap` set) lines also break between words to
// fit its width; a word longer than the width sticks out, as in ChemDraw. Coordinates are in points with
// the origin at the left end of the first line's baseline, as captions are placed.

import type { Justify, ParaStyle, TextRun } from '../model';
import type { Rect } from '../geom';
import { formulaParts } from '../richtext';
import { fitParas, listMarkers, paraCount } from './paragraphs';

export const FONT_STACK = "Arial, 'Liberation Sans', Helvetica, sans-serif";

/** Width in points of text in a font: (text, size in points, CSS font family, 'bold '/'italic '). */
export type Measure = (text: string, size: number, family: string, style: string) => number;

/** What a text needs for its layout (a caption has all of these). */
export interface TextFrame {
  runs: TextRun[];
  paras?: ParaStyle[];
  justify: Justify;
  wrap?: number;
  width?: number;
  lineHeight?: number;
  lineSpacing?: number;
  /** Bullets and numbers worked out elsewhere (a document lays out one paragraph at a time). */
  markers?: (string | null)[];
  /**
   * Lines stack as boxes of single spacing (times the line spacing), as in Word. Without it a
   * line steps down by the size of the line above, as ChemDraw's captions do.
   */
  boxes?: boolean;
  /** How big a figure is, or what a field shows, given the room the line has (documents). */
  inline?: (id: number, room: number) => InlineBox | null;
}

/** A figure in a line (sitting on the baseline), or a field's text. */
export type InlineBox = { w: number; ascent: number; descent?: number } | { text: string };

/** A piece of a line in one style. */
export interface Glyphs {
  text: string;
  /** Where its first character is in the whole text (line breaks count one). */
  start: number;
  /** Left end of the piece and its width, in points from the origin. */
  x: number;
  w: number;
  /** Shift of the baseline (down for subscripts, up for superscripts). */
  dy: number;
  /** Size the piece is drawn at (subscripts are smaller than their run). */
  size: number;
  /** CSS font family list, and 'italic ' / 'bold ' for the style. */
  family: string;
  style: string;
  color?: string;
  underline?: boolean;
  /** Background colour behind the piece (a highlighter). */
  highlight?: string;
  /** Extra width each space gets in a justified line. */
  spread?: number;
  /** A figure, table or field (documents): its id. Its one character isn't drawn. */
  obj?: number;
  /** What a field shows (a figure number, a page number). */
  shown?: string;
  /** Text shown that is not in the text (a bibliography's lines): drawn, but the caret passes it by. */
  decor?: boolean;
}

export interface LaidLine {
  /** Paragraph this line belongs to. */
  para: number;
  /** Its text in the whole text: from `start` up to `end` (after any spaces it ends with). */
  start: number;
  end: number;
  /** Baseline, and how far the text reaches above and below it. */
  y: number;
  ascent: number;
  descent: number;
  /** The size of the largest text on the line (not counting sub- and superscripts' smaller size). */
  size: number;
  /** Documents: the line's box above and below the baseline (with the line spacing). */
  above?: number;
  below?: number;
  /** Where the text of the line starts (after its indent) and the room it has. */
  left: number;
  room: number;
  /** Where the line's text begins once lined up (left, centred or right). */
  x: number;
  /** Width of the text, not counting spaces at the end. */
  width: number;
  pieces: Glyphs[];
  /** The bullet or number in front of a list item's first line. */
  marker?: Glyphs;
  /** The last line of its paragraph. */
  last: boolean;
  /** A line of a block that a field shows (a bibliography): the field's id. */
  block?: number;
}

export interface TextLayout {
  lines: LaidLine[];
  /** Width of the text box: the wrap width, the width from a file, or the longest line. */
  boxWidth: number;
  /** The area the text covers, from the origin (a text box covers its whole width). */
  box: Rect;
  /** Number of characters in the text, line breaks included. */
  length: number;
  measure: Measure;
}

/** Fraction of the text size above and below the baseline (Arial). */
export const ASCENT = 0.8;
export const DESCENT = 0.25;
/** Single line spacing as a multiple of the text size. */
export const SINGLE = 1.15;

interface Seg {
  text: string; start: number; size: number; base: number; dy: number; family: string; style: string; color?: string; underline?: boolean; highlight?: string;
  /** A figure, table or field (documents): its id, and once laid out its width, what it shows and its height. */
  obj?: number; w?: number; shown?: string; objAscent?: number; objDescent?: number;
}

/** Cut runs into pieces of one look, with formula style worked out, paragraph by paragraph. */
function segments(runs: TextRun[], defaultSize: number, n: number): { segs: Seg[][]; sizes: number[] } {
  const segs: Seg[][] = Array.from({ length: n }, () => []);
  // the size an empty paragraph takes: that of the text its line break was typed in
  const sizes: number[] = Array.from({ length: n }, () => 0);
  let p = 0, off = 0;
  if (runs.length) sizes[0] = runs[0].size ?? defaultSize;
  for (const r of runs) {
    const base = r.size ?? defaultSize;
    const style = `${r.italic ? 'italic ' : ''}${r.bold ? 'bold ' : ''}`;
    const family = r.font ? `${r.font}, ${FONT_STACK}` : FONT_STACK;
    if (r.obj !== undefined) {
      // each object character is a piece of its own (a field in superscript, a citation, shows its text raised)
      const size = r.sub || r.sup ? base * 0.75 : base;
      const dy = r.sub ? base * 0.22 : r.sup ? -base * 0.42 : 0;
      for (const ch of r.text) {
        if (ch === '\n') { off++; p++; if (p < n) sizes[p] = base; continue; }
        if (p < n) segs[p].push({ text: ch, start: off, size, base, dy, family, style, color: r.color, underline: r.underline, highlight: r.highlight, obj: r.obj });
        off += ch.length;
      }
      continue;
    }
    const parts = r.formula && !r.sub && !r.sup ? formulaParts(r.text) : [{ text: r.text, pos: r.sub ? 'sub' : r.sup ? 'sup' : 'base' }];
    for (const part of parts) {
      const small = part.pos !== 'base';
      const size = small ? base * 0.75 : base;
      const dy = part.pos === 'sub' ? base * 0.22 : part.pos === 'sup' ? -base * 0.42 : 0;
      const chunks = part.text.split('\n');
      chunks.forEach((t, i) => {
        if (i > 0) {
          off++;
          p++;
          if (p < n) sizes[p] = base;
        }
        if (!t || p >= n) { off += t.length; return; }
        segs[p].push({ text: t, start: off, size, base, dy, family, style, color: r.color, underline: r.underline, highlight: r.highlight });
        off += t.length;
      });
    }
  }
  return { segs, sizes };
}

/**
 * Places a line may break before (offsets into the paragraph): after spaces, and after a hyphen
 * or slash inside a word, as ChemDraw breaks lines; and either side of a figure (`around`).
 */
function breakPoints(text: string, around: ReadonlySet<number> = new Set()): number[] {
  const out: number[] = [];
  for (let i = 1; i < text.length; i++) {
    const prev = text[i - 1], ch = text[i];
    if (prev === ' ' && ch !== ' ') out.push(i);
    else if ((around.has(i) || around.has(i - 1)) && ch !== ' ') out.push(i);
    else if ((prev === '-' || prev === '–' || prev === '—' || prev === '/') && ch !== ' ' && i >= 2 && /[\p{L}\p{N})\]]/u.test(text[i - 2])) out.push(i);
    // ChemDraw also breaks between a degree sign and a letter ("−78 °" | "C")
    else if (prev === '°' && /\p{L}/u.test(ch)) out.push(i);
  }
  out.push(text.length);
  return out;
}

interface Word { start: number; end: number; body: number; spaces: number }

export function layoutText(f: TextFrame, defaultSize: number, measure: Measure): TextLayout {
  const text = f.runs.map((r) => r.text).join('');
  const n = paraCount(text);
  const paras = fitParas(f.paras, n);
  const markers = f.markers ?? listMarkers(paras);
  const { segs, sizes } = segments(f.runs, defaultSize, n);
  const spacing = f.lineSpacing && f.lineSpacing > 0 ? f.lineSpacing : 1;
  const lines: LaidLine[] = [];
  let paraStart = 0;
  let y = 0;
  for (let p = 0; p < n; p++) {
    const ps = paras[p];
    const pSegs = segs[p];
    const pText = pSegs.map((s) => s.text).join('');
    const pLen = pText.length;
    const em = pSegs.length ? pSegs[0].base : sizes[p] || defaultSize;
    const pSpacing = ps.line && ps.line > 0 ? ps.line : spacing;
    // indents: list items hang their bullet or number in front of the text
    let left = ps.indent ?? 0;
    let firstLine = 0;
    let marker: Glyphs | undefined;
    if (ps.list) {
      const level = Math.max(0, Math.min(8, ps.level ?? 0));
      const step = 1.6 * em;
      const markLeft = left + level * step;
      left = markLeft + (ps.list === 'number' ? 1.6 : 1.1) * em;
      const m = markers[p];
      if (m) {
        const first = pSegs[0];
        const family = first?.family ?? FONT_STACK;
        // bullets and numbers are plain (not bold or italic), in the colour of the text
        marker = { text: m, start: paraStart, x: markLeft, w: measure(m, em, family, ''), dy: 0, size: em, family, style: '', color: first?.color };
        left = Math.max(left, markLeft + marker.w + 0.3 * em);
      }
    } else firstLine = ps.firstLine ?? 0;
    const right = ps.indentRight ?? 0;
    const room = f.wrap !== undefined ? Math.max(1, f.wrap - left - right) : Infinity;

    // figures and fields: their size, and what a field shows
    const around = new Set<number>();
    for (const s of pSegs) {
      if (s.obj === undefined) continue;
      const box = f.inline?.(s.obj, room) ?? null;
      if (box && 'text' in box) {
        s.shown = box.text;
        s.w = measure(box.text, s.size, s.family, s.style);
      } else {
        s.w = box?.w ?? 0;
        s.objAscent = box?.ascent ?? 0;
        s.objDescent = box?.descent ?? 0;
        around.add(s.start - paraStart);
      }
    }
    const segWidth = (s: Seg, a: number, b: number): number =>
      s.obj !== undefined ? (b > a ? s.w ?? 0 : 0) : measure(s.text.slice(a, b), s.size, s.family, s.style);

    // the width of part of the paragraph (offsets within it), piece by piece
    const widthOf = (a: number, b: number): number => {
      let w = 0;
      for (const s of pSegs) {
        const s0 = s.start - paraStart, s1 = s0 + s.text.length;
        const x0 = Math.max(a, s0), x1 = Math.min(b, s1);
        if (x1 > x0) w += segWidth(s, x0 - s0, x1 - s0);
      }
      return w;
    };
    // words: from one break point to the next, with the spaces after them
    const words: Word[] = [];
    let ws = 0;
    for (const bp of breakPoints(pText, around)) {
      let be = bp;
      while (be > ws && pText[be - 1] === ' ') be--;
      words.push({ start: ws, end: bp, body: widthOf(ws, be), spaces: widthOf(be, bp) });
      ws = bp;
    }
    if (!words.length) words.push({ start: 0, end: 0, body: 0, spaces: 0 });

    // fill lines word by word (the first line has the first-line indent taken off its room)
    const pLines: { start: number; end: number; width: number }[] = [];
    let cur: { start: number; end: number; width: number; full: number } | null = null;
    const emit = () => { if (cur) pLines.push({ start: cur.start, end: cur.end, width: cur.width }); cur = null; };
    for (const w of words) {
      const lineRoom = pLines.length ? room : room - firstLine;
      // a word fits when it and the space after it do (ChemDraw counts that space too)
      if (cur && cur.full + w.body + w.spaces > lineRoom + 1e-6) emit();
      if (!cur) cur = { start: w.start, end: w.end, width: w.body, full: w.body + w.spaces };
      else { cur.end = w.end; cur.width = cur.full + w.body; cur.full += w.body + w.spaces; }
    }
    emit();
    if (!pLines.length) pLines.push({ start: 0, end: 0, width: 0 });

    // place the pieces of each line
    pLines.forEach((pl, li) => {
      const pieces: Glyphs[] = [];
      let x = 0;
      let size = 0;
      let objUp = 0, objDown = 0;
      for (const s of pSegs) {
        const s0 = s.start - paraStart, s1 = s0 + s.text.length;
        const a = Math.max(pl.start, s0), b = Math.min(pl.end, s1);
        if (b <= a) continue;
        const t = s.text.slice(a - s0, b - s0);
        const w = segWidth(s, a - s0, b - s0);
        const g: Glyphs = { text: t, start: paraStart + a, x, w, dy: s.dy, size: s.size, family: s.family, style: s.style, color: s.color, underline: s.underline };
        if (s.highlight) g.highlight = s.highlight;
        if (s.obj !== undefined) {
          g.obj = s.obj;
          if (s.shown !== undefined) g.shown = s.shown;
          objUp = Math.max(objUp, s.objAscent ?? 0);
          objDown = Math.max(objDown, s.objDescent ?? 0);
        }
        pieces.push(g);
        x += w;
        size = Math.max(size, s.base);
      }
      if (!size) size = em;
      const last = li === pLines.length - 1;
      const lineLeft = li === 0 ? left + firstLine : left;
      const l: LaidLine = {
        para: p, start: paraStart + pl.start, end: paraStart + pl.end, y: 0, ascent: Math.max(ASCENT * size, objUp), descent: Math.max(DESCENT * size, objDown),
        size, left: lineLeft, room: li === 0 ? room - firstLine : room, x: lineLeft, width: pl.width, pieces, marker: li === 0 ? marker : undefined, last,
      };
      if (f.boxes) {
        // a document's line: the height of single spacing (times the line spacing), or of its tallest figure
        l.above = Math.max((SINGLE * pSpacing - DESCENT) * size, objUp);
        l.below = l.descent;
        // spacing in points: exactly (figures may then reach into the line above), or at least
        if (ps.linePt && ps.linePt > 0) l.above = ps.lineRule === 'exact' ? Math.max(0, ps.linePt - l.below) : Math.max(l.above, ps.linePt - l.below);
      }
      lines.push(l);
    });
    paraStart += pLen + 1;
  }

  // box width, then line positions
  let widest = 0;
  for (const l of lines) widest = Math.max(widest, l.left + l.width, l.marker ? l.marker.x + l.marker.w : 0);
  const boxWidth = f.wrap ?? f.width ?? widest;
  let prev: LaidLine | null = null;
  for (const l of lines) {
    if (prev) {
      if (f.boxes) y += prev.below! + l.above!;
      else {
        const sp = paras[prev.para].line && paras[prev.para].line! > 0 ? paras[prev.para].line! : spacing;
        y += f.lineHeight ?? SINGLE * sp * prev.size;
      }
      if (prev.para !== l.para) y += (paras[prev.para].spaceAfter ?? 0) + (paras[l.para].spaceBefore ?? 0);
    }
    l.y = y;
    prev = l;
    const room = Math.max(0, boxWidth - l.left - (paras[l.para].indentRight ?? 0));
    const align = paras[l.para].align ?? f.justify;
    let shift = 0;
    if (align === 'center') shift = (room - l.width) / 2;
    else if (align === 'right') shift = room - l.width;
    else if (align === 'justify' && !l.last && f.wrap !== undefined) spread(l, room, text);
    l.x = l.left + shift;
    for (const g of l.pieces) g.x += l.x;
    // a bullet or number moves with its centred or right-aligned text, as in Word
    if (l.marker && shift > 0) l.marker.x += shift;
  }
  // the area covered
  let x1 = Infinity, x2 = -Infinity;
  for (const l of lines) {
    if (l.pieces.length) { x1 = Math.min(x1, l.pieces[0].x); x2 = Math.max(x2, l.pieces[0].x + l.width); }
    if (l.marker) { x1 = Math.min(x1, l.marker.x); x2 = Math.max(x2, l.marker.x + l.marker.w); }
  }
  if (x1 > x2) { x1 = x2 = 0; }
  if (f.wrap !== undefined) { x1 = Math.min(x1, 0); x2 = Math.max(x2, f.wrap); }
  const first = lines[0], lastLine = lines[lines.length - 1];
  const box = { x1, y1: first.y - (first.above ?? first.ascent), x2, y2: lastLine.y + (lastLine.below ?? lastLine.descent) };
  return { lines, boxWidth, box, length: text.length, measure };
}

function trailingSpaces(text: string, a: number, b: number): number {
  let k = 0;
  while (b - k > a && text[b - k - 1] === ' ') k++;
  return k;
}

/** Stretch the spaces of a line so it fills its room (justified text). */
function spread(l: LaidLine, room: number, text: string): void {
  const extra = room - l.width;
  if (extra <= 0) return;
  // spaces inside the line (not the ones it ends with)
  let inner = 0;
  const end = l.end - trailingSpaces(text, l.start, l.end);
  for (let i = l.start; i < end; i++) if (text[i] === ' ') inner++;
  if (!inner) return;
  const each = extra / inner;
  let added = 0;
  for (const g of l.pieces) {
    g.x += added;
    let k = 0;
    for (let i = 0; i < g.text.length; i++) if (g.text[i] === ' ' && g.start + i < end) k++;
    if (k) { g.spread = each; g.w += each * k; added += each * k; }
  }
  l.width += added;
}

// ------------------------------------------------------------------ caret and selection

/** Distance from a piece's left end to the place before its k-th character. */
export function pieceX(lay: TextLayout, g: Glyphs, k: number): number {
  if (k <= 0) return 0;
  if (k >= g.text.length) return g.w;
  const t = g.text.slice(0, k);
  let w = lay.measure(t, g.size, g.family, g.style);
  if (g.spread) for (const ch of t) if (ch === ' ') w += g.spread;
  return w;
}

/** The line a place in the text is on (a place where a line wraps belongs to the next line). */
export function lineOf(lay: TextLayout, offset: number): number {
  const ls = lay.lines;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (offset < l.start) return Math.max(0, i - 1);
    if (offset < l.end || (offset === l.end && (l.last || i === ls.length - 1))) return i;
  }
  return ls.length - 1;
}

/** Where the caret goes for a place in the text: x and the line it is on. */
export function caretPos(lay: TextLayout, offset: number): { x: number; line: number } {
  const li = lineOf(lay, offset);
  const l = lay.lines[li];
  const pieces = textPieces(l);
  for (const g of pieces) {
    if (offset >= g.start && offset <= g.start + g.text.length) return { x: g.x + pieceX(lay, g, offset - g.start), line: li };
  }
  // an empty line, or past the end: after the last piece or where the text would start
  const lastPiece = pieces[pieces.length - 1];
  if (lastPiece && offset > lastPiece.start) return { x: lastPiece.x + lastPiece.w, line: li };
  return { x: pieces[0]?.x ?? l.x, line: li };
}

/** The place in the text nearest a point (relative to the origin). */
export function offsetAt(lay: TextLayout, x: number, y: number): number {
  const ls = lay.lines;
  let li = ls.length - 1;
  for (let i = 0; i < ls.length; i++) {
    if (y < ls[i].y + ls[i].descent + (i + 1 < ls.length ? (ls[i + 1].y - ls[i + 1].ascent - ls[i].y - ls[i].descent) / 2 : Infinity)) { li = i; break; }
  }
  return offsetInLine(lay, li, x);
}

/** The place on a line nearest an x position. */
export function offsetInLine(lay: TextLayout, li: number, x: number): number {
  const l = lay.lines[li];
  // a wrapped line's trailing spaces belong to it, but the caret can't sit after them
  const lastPos = l.last ? l.end : Math.max(l.start, l.end - 1);
  let best = l.start, bestD = Infinity;
  const consider = (o: number, ox: number) => {
    const d = Math.abs(ox - x);
    if (d < bestD && o <= lastPos) { bestD = d; best = o; }
  };
  const pieces = textPieces(l);
  if (!pieces.length) return l.start;
  for (const g of pieces) {
    for (let k = 0; k <= g.text.length; k++) consider(g.start + k, g.x + pieceX(lay, g, k));
  }
  return best;
}

/** Rectangles covering the text between two places (relative to the origin), one per line. */
export function selectionRects(lay: TextLayout, a: number, b: number): Rect[] {
  if (b <= a) return [];
  const out: Rect[] = [];
  lay.lines.forEach((l, i) => {
    const s = Math.max(a, l.start), e = Math.min(b, l.end);
    const crossesBreak = l.last && b > l.end && a <= l.end && i < lay.lines.length - 1;
    if (e < s || (e === s && !crossesBreak)) return;
    const x1 = caretPos(lay, s).x;
    let x2 = e === s ? x1 : xAt(lay, i, e);
    // a selected line break shows as a little space at the end of the line
    if (crossesBreak) x2 += l.ascent * 0.35;
    out.push({ x1, y1: l.y - l.ascent, x2, y2: l.y + l.descent });
  });
  return out;
}

/** x of a place on a given line (the end of a wrapped line stays on that line). */
function xAt(lay: TextLayout, li: number, offset: number): number {
  const pieces = textPieces(lay.lines[li]);
  for (const g of pieces) if (offset >= g.start && offset <= g.start + g.text.length) return g.x + pieceX(lay, g, offset - g.start);
  const last = pieces[pieces.length - 1];
  return last ? last.x + last.w : lay.lines[li].x;
}

/** A line's pieces that hold its text (not the ones only shown, as a bibliography's). */
function textPieces(l: LaidLine): Glyphs[] {
  return l.pieces.some((g) => g.decor) ? l.pieces.filter((g) => !g.decor) : l.pieces;
}

/** Start and end of the word around a place (for double-click). */
export function wordAt(text: string, offset: number): [number, number] {
  const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_'’\-]/u.test(ch);
  let a = offset, b = offset;
  if (!isWord(text[offset]) && isWord(text[offset - 1])) a = b = offset - 1;
  if (!isWord(text[a])) return [offset, Math.min(text.length, offset + (text[offset] && text[offset] !== '\n' ? 1 : 0))];
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return [a, b];
}
