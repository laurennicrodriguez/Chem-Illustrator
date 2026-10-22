// Laying out styled text: where every piece of text goes, line by line. One layout serves the
// page (captions and text boxes), the pictures made for Word and PowerPoint, and the text
// editor (caret, selection, clicking into text), so all of them agree to the point.
//
// A text has paragraphs (split at line breaks), each with its own list bullet or number,
// indent, spacing and alignment. In a text box (`wrap` set) lines also break between words to
// fit its width; a word longer than the width sticks out, as in ChemDraw. Coordinates are in points with
// the origin at the left end of the first line's baseline, as captions are placed.

import type { Justify, ParaStyle, TabStop, TextRun } from '../model';
import type { Rect } from '../geom';
import { formulaParts } from '../richtext';
import { fitParas, listMarkers, paraCount } from './paragraphs';

export const FONT_STACK = "Arial, 'Liberation Sans', Helvetica, sans-serif";

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'math']);

/**
 * A font's name as CSS can read it in a font list: quoted, unless it is already quoted, a list,
 * or a generic family. Unquoted, a name with a word starting with a digit (Source Sans 3) is not
 * valid CSS, and the browser then ignores the whole font setting.
 */
export function cssFamily(name: string): string {
  const n = name.trim();
  if (!n || /^['"]/.test(n) || n.includes(',') || GENERIC.has(n.toLowerCase())) return n;
  return `"${n.replace(/["\\]/g, '')}"`;
}

/** A font, then the usual fallbacks. */
export const withStack = (font: string): string => `${cssFamily(font)}, ${FONT_STACK}`;

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
  /**
   * Documents: room taken from a line by figures beside it (text wrapping round them). Asked
   * for each line with the top of its box (from the top of the first line's box) and its
   * height; gives how much to leave at the left and right, or how far down to move the line
   * to get past them. The tops are worked out as the lines are filled, from single spacing.
   */
  narrow?: (top: number, height: number) => Narrow | null;
  /** Columns in a text box (with `wrap` its whole width), and the room between them in points. */
  cols?: number;
  colGap?: number;
  /** A text box of fixed height (from the top of its first line): columns fill to it, and shrink-to-fit fits the text in it. */
  boxH?: number;
  /** AutoFit: 'shrink' makes the text smaller until it fits in boxH; otherwise it doesn't change size. */
  fit?: 'shrink' | 'fixed';
  /** Automatic hyphenation (documents): words that don't fit are broken where the hyphenation patterns allow. */
  hyphenate?: Hyphenation;
}

/** How words are hyphenated at the ends of lines, as Word's Hyphenation Options. */
export interface Hyphenation {
  /** Where a word may be broken: offsets into it (after the first letters, before the last). */
  points: (word: string) => number[];
  /** Hyphenation zone: a word is broken only if leaving it whole would leave more than this much room (points). */
  zone: number;
  /** At most this many lines one after another ending in a hyphen (0: no limit). */
  limit: number;
  /** Words in capitals are broken too. */
  caps: boolean;
}

/** Room a line gives up to a figure beside it, or how far it moves down past one. */
export interface Narrow { left: number; right: number; down?: number }

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
  /** A line through the piece (deleted text, while changes are tracked). */
  strike?: boolean;
  /** Background colour behind the piece (a highlighter). */
  highlight?: string;
  /** Character spacing: points added after each character. */
  spacing?: number;
  /** Extra width each space gets in a justified line. */
  spread?: number;
  /** A figure, table or field (documents): its id. Its one character isn't drawn. */
  obj?: number;
  /** What a field shows (a figure number, a page number). */
  shown?: string;
  /** Text shown that is not in the text (a bibliography's lines): drawn, but the caret passes it by. */
  decor?: boolean;
  /** A tab (its one character isn't drawn), with the dots or line that lead across it to its tab stop. */
  tab?: boolean;
  leader?: TabStop['leader'];
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
  /** Room given up at the right to a figure beside the line (documents). */
  cutRight?: number;
  /** Documents in columns: the left and right of the line's column (clicks find lines in it). */
  band?: [number, number];
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
  /** Shrunk to fit its box: the share of its size the text is drawn at. */
  fontScale?: number;
}

const NO_CUT: Narrow = { left: 0, right: 0 };

/** Word's default tab stops: every half inch from the left margin. */
export const DEFAULT_TAB = 36;
/** Small capitals' size, as a part of the text's. */
export const SMALL_CAPS = 0.8;

/** Fraction of the text size above and below the baseline (Arial). */
export const ASCENT = 0.8;
export const DESCENT = 0.25;
/** Single line spacing as a multiple of the text size. */
export const SINGLE = 1.15;

interface Seg {
  text: string; start: number; size: number; base: number; dy: number; family: string; style: string; color?: string; underline?: boolean; strike?: boolean; highlight?: string;
  /** Character spacing: points added after each character. */
  spacing?: number;
  /** A figure, table or field (documents): its id, and once laid out its width, what it shows and its height. */
  obj?: number; w?: number; shown?: string; objAscent?: number; objDescent?: number;
  /** A tab: its width (`w`) is worked out from where it starts and its tab stop. */
  tab?: boolean; leader?: TabStop['leader'];
}

/**
 * Text in capitals (all caps), or in small capitals: lower-case letters as capitals, smaller.
 * Letters whose capital is longer (ß) stay as they are, so every place in the text keeps its offset.
 */
function capsParts(text: string, small: boolean): { text: string; small: boolean }[] {
  const out: { text: string; small: boolean }[] = [];
  for (const ch of text) {
    const up = ch.toUpperCase();
    const lower = up !== ch && up.length === ch.length;
    const t = lower ? up : ch;
    const sm = small && lower;
    const last = out[out.length - 1];
    if (last && last.small === sm) last.text += t;
    else out.push({ text: t, small: sm });
  }
  return out;
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
    const family = r.font ? withStack(r.font) : FONT_STACK;
    if (r.obj !== undefined) {
      // each object character is a piece of its own (a field in superscript, a citation, shows its text raised)
      const size = r.sub || r.sup ? base * 0.75 : base;
      const dy = r.sub ? base * 0.22 : r.sup ? -base * 0.42 : 0;
      for (const ch of r.text) {
        if (ch === '\n') { off++; p++; if (p < n) sizes[p] = base; continue; }
        if (p < n) segs[p].push({ text: ch, start: off, size, base, dy, family, style, color: r.color, underline: r.underline, strike: r.strike, highlight: r.highlight, obj: r.obj });
        off += ch.length;
      }
      continue;
    }
    const from = { p, k: segs[p]?.length ?? 0 };
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
        // tabs are pieces of their own (their width depends on where they are)
        t.split('\t').forEach((piece, k) => {
          if (k > 0) {
            segs[p].push({ text: '\t', start: off, size, base, dy, family, style, color: r.color, underline: r.underline, strike: r.strike, highlight: r.highlight, tab: true, w: 0 });
            off++;
          }
          if (!piece) return;
          const caps = r.smallCaps || r.allCaps ? capsParts(piece, !!r.smallCaps && !r.allCaps) : [{ text: piece, small: false }];
          for (const c of caps) {
            segs[p].push({ text: c.text, start: off, size: c.small ? size * SMALL_CAPS : size, base, dy, family, style, color: r.color, underline: r.underline, strike: r.strike, highlight: r.highlight });
            off += c.text.length;
          }
        });
      });
    }
    // character spacing goes on every piece the run made
    if (r.spacing) for (let q = from.p; q <= Math.min(p, n - 1); q++) for (const sg of segs[q].slice(q === from.p ? from.k : 0)) sg.spacing = r.spacing;
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
  if (f.fit === 'shrink' && f.boxH && f.boxH > 0) return shrunk(f, defaultSize, measure);
  if (f.cols && f.cols > 1 && f.wrap !== undefined) return inColumns(f, defaultSize, measure);
  return layoutPlain(f, defaultSize, measure);
}

/** Height of a layout from the top of its first line to the bottom of its last. */
const heightOf = (lay: TextLayout) => lay.box.y2 - lay.box.y1;

/**
 * Shrink text on overflow: the largest size, in steps of PowerPoint's fontScale, at which the
 * text fits its box's height.
 */
function shrunk(f: TextFrame, defaultSize: number, measure: Measure): TextLayout {
  const plain = { ...f, fit: undefined };
  const full = layoutText(plain, defaultSize, measure);
  if (heightOf(full) <= f.boxH! + 0.01) return full;
  const at = (k: number) => layoutText({
    ...plain,
    runs: f.runs.map((r) => ({ ...r, size: (r.size ?? defaultSize) * k })),
    lineHeight: f.lineHeight !== undefined ? f.lineHeight * k : undefined,
  }, defaultSize * k, measure);
  let lo = 0.25, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (heightOf(at(mid)) <= f.boxH!) lo = mid; else hi = mid;
  }
  const k = Math.floor(lo * 40) / 40;
  return { ...at(k), fontScale: k };
}

/**
 * Text in columns: laid out to a column's width, then its lines shared between the columns,
 * filling each to the box's height (or evenly, in a box that grows with its text).
 */
function inColumns(f: TextFrame, defaultSize: number, measure: Measure): TextLayout {
  const n = Math.max(2, Math.min(16, Math.round(f.cols!)));
  const gap = Math.max(0, f.colGap ?? 0);
  const w = Math.max(1, (f.wrap! - gap * (n - 1)) / n);
  const lay = layoutPlain({ ...f, cols: undefined, wrap: w }, defaultSize, measure);
  const ls = lay.lines;
  const top0 = ls[0].y - (ls[0].above ?? ls[0].ascent);
  const per = Math.ceil(ls.length / n);
  let col = 0, colTop = top0, inCol = 0;
  let y2 = -Infinity;
  for (const l of ls) {
    const bottom = l.y + (l.below ?? l.descent);
    const full = f.boxH ? inCol > 0 && bottom - colTop > f.boxH + 0.01 : inCol >= per;
    if (full && col < n - 1) { col++; colTop = l.y - (l.above ?? l.ascent); inCol = 0; }
    const dx = col * (w + gap), dy = top0 - colTop;
    l.y += dy;
    l.x += dx;
    l.left += dx;
    for (const g of l.pieces) g.x += dx;
    if (l.marker) l.marker = { ...l.marker, x: l.marker.x + dx };
    l.band = [dx, dx + w];
    inCol++;
    y2 = Math.max(y2, l.y + (l.below ?? l.descent));
  }
  return { ...lay, boxWidth: f.wrap!, box: { x1: 0, y1: top0, x2: f.wrap!, y2 } };
}

function layoutPlain(f: TextFrame, defaultSize: number, measure: Measure): TextLayout {
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
      s.obj !== undefined || s.tab ? (b > a ? s.w ?? 0 : 0) : measure(s.text.slice(a, b), s.size, s.family, s.style) + (s.spacing ? s.spacing * (b - a) : 0);

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
    // tabs: each reaches to the next tab stop (a right, centre or decimal stop lines up the text
    // after it there); worked out for the paragraph as one line, then again for each line
    const stops = (ps.tabs ?? []).filter((x) => x.pos > 0).sort((x, y) => x.pos - y.pos);
    const lastStop = stops.length ? stops[stops.length - 1].pos : 0;
    const hasTabs = pSegs.some((s) => s.tab);
    /** Set the widths of the tabs between two offsets of the paragraph, the first at `lineLeft` from the margin. Gives how much wider they made the line. */
    const fitTabs = (a: number, b: number, lineLeft: number, hang: number | null): number => {
      let x = 0, delta = 0;
      for (let i = 0; i < pSegs.length; i++) {
        const s = pSegs[i];
        const s0 = s.start - paraStart, s1 = s0 + s.text.length;
        if (s1 <= a || s0 >= b) continue;
        if (!s.tab) { x += segWidth(s, Math.max(a, s0) - s0, Math.min(b, s1) - s0); continue; }
        const at = lineLeft + x;
        let stop: TabStop | undefined = stops.find((st) => st.pos > at + 0.01);
        // a hanging indent is a tab stop too (a list's or a reference's number, then a tab)
        if (hang !== null && hang > at + 0.01 && (!stop || hang < stop.pos)) stop = { pos: hang, kind: 'left' };
        if (!stop) stop = { pos: (Math.floor(Math.max(at, lastStop) / DEFAULT_TAB) + 1) * DEFAULT_TAB, kind: 'left' };
        // the text after the tab, up to the next tab or the end of the line
        let after = 0, toPoint = -1;
        for (let j = i + 1; j < pSegs.length; j++) {
          const n2 = pSegs[j];
          const t0 = n2.start - paraStart;
          if (n2.tab || t0 >= b) break;
          const t1 = Math.min(b, t0 + n2.text.length);
          if (stop.kind === 'decimal' && toPoint < 0 && n2.obj === undefined) {
            const dot = n2.text.slice(0, t1 - t0).search(/[.,·]/);
            if (dot >= 0) toPoint = after + segWidth(n2, 0, dot);
          }
          after += segWidth(n2, 0, t1 - t0);
        }
        const lead = stop.kind === 'right' ? after : stop.kind === 'center' ? after / 2 : stop.kind === 'decimal' ? (toPoint >= 0 ? toPoint : after) : 0;
        const w = Math.max(0, stop.pos - at - lead);
        delta += w - (s.w ?? 0);
        s.w = w;
        if (stop.leader) s.leader = stop.leader; else delete s.leader;
        x += w;
      }
      return delta;
    };
    if (hasTabs) fitTabs(0, pLen, left + (ps.list ? 0 : firstLine), !ps.list && firstLine < 0 ? left : null);

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

    // fill lines word by word (the first line has the first-line indent taken off its room);
    // beside a figure a line gives up room to it, or moves down past it
    type PLine = { start: number; end: number; width: number; cut: Narrow; hyphen?: Glyphs };
    const pLines: PLine[] = [];
    const step = SINGLE * pSpacing * em;
    const lineGuess = ps.linePt && ps.linePt > 0 ? (ps.lineRule === 'exact' ? ps.linePt : Math.max(ps.linePt, step)) : step;
    let top = 0;
    const cutAt = (): Narrow => {
      if (!f.narrow) return NO_CUT;
      let down = 0;
      for (let k = 0; k < 50; k++) {
        const c = f.narrow(top + down, lineGuess);
        if (!c) break;
        if (!c.down) return { left: c.left, right: c.right, down: down || undefined };
        down += c.down;
      }
      return down ? { left: 0, right: 0, down } : NO_CUT;
    };
    let cut = cutAt();
    if (cut.down) top += cut.down;
    let cur: { start: number; end: number; width: number; full: number } | null = null;
    let hyphensInRow = 0;
    const emit = (hyphen?: Glyphs) => {
      if (cur) {
        pLines.push({ start: cur.start, end: cur.end, width: cur.width, cut, ...(hyphen ? { hyphen } : {}) });
        hyphensInRow = hyphen ? hyphensInRow + 1 : 0;
        top += lineGuess;
        cut = cutAt();
        if (cut.down) top += cut.down;
      }
      cur = null;
    };
    const segAt = (at: number): Seg | undefined => pSegs.find((s) => s.start - paraStart <= at && at < s.start - paraStart + s.text.length);
    /** Where to break a word that doesn't fit on the line (`room` left after the line so far), with the hyphen to draw; null to leave it whole. */
    const hyphenBreak = (w: Word, room: number): { at: number; width: number; hyphen: Glyphs } | null => {
      const hy = f.hyphenate;
      if (!hy || room <= hy.zone || (hy.limit > 0 && hyphensInRow >= hy.limit)) return null;
      const m = /^(\p{L}+)([^\p{L}\d\s]*)\s*$/u.exec(pText.slice(w.start, w.end));
      if (!m || m[1].length < 5 || (!hy.caps && m[1] === m[1].toUpperCase())) return null;
      // the word in one plain piece of text (not a formula, figure or field)
      const s = segAt(w.start);
      if (!s || s.obj !== undefined || s.tab || s.start - paraStart + s.text.length < w.start + m[1].length) return null;
      const points = hy.points(m[1]).filter((k) => k >= 2 && k <= m[1].length - 2).sort((a, b) => b - a);
      for (const k of points) {
        const hw = measure('-', s.size, s.family, s.style);
        const width = widthOf(w.start, w.start + k) + hw;
        if (width <= room + 1e-6) return { at: w.start + k, width, hyphen: { text: '-', start: 0, x: 0, w: hw, dy: s.dy, size: s.size, family: s.family, style: s.style, color: s.color, decor: true } };
      }
      return null;
    };
    for (let w of words) {
      const lineRoom = (pLines.length ? room : room - firstLine) - cut.left - cut.right;
      // a word fits when it and the space after it do (ChemDraw counts that space too)
      if (cur && cur.full + w.body + w.spaces > lineRoom + 1e-6) {
        const hb = hyphenBreak(w, lineRoom - cur.full);
        if (hb) {
          // the start of the word, and a hyphen, end this line; the rest starts the next
          cur.end = hb.at;
          cur.width = cur.full + hb.width;
          emit(hb.hyphen);
          let be = w.end;
          while (be > hb.at && pText[be - 1] === ' ') be--;
          w = { start: hb.at, end: w.end, body: widthOf(hb.at, be), spaces: w.spaces };
        } else emit();
      }
      if (!cur) cur = { start: w.start, end: w.end, width: w.body, full: w.body + w.spaces };
      else { cur.end = w.end; cur.width = cur.full + w.body; cur.full += w.body + w.spaces; }
    }
    emit();
    if (!pLines.length) pLines.push({ start: 0, end: 0, width: 0, cut });

    // place the pieces of each line
    pLines.forEach((pl, li) => {
      // the tabs of a line after the first, from where that line starts
      if (hasTabs && li > 0) pl.width += fitTabs(pl.start, pl.end, left + pl.cut.left, null);
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
        if (s.strike) g.strike = true;
        if (s.spacing) g.spacing = s.spacing;
        if (s.tab) { g.tab = true; if (s.leader) g.leader = s.leader; }
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
      if (pl.hyphen) pieces.push({ ...pl.hyphen, start: paraStart + pl.end, x });
      if (!size) size = em;
      const last = li === pLines.length - 1;
      const lineLeft = (li === 0 ? left + firstLine : left) + pl.cut.left;
      const l: LaidLine = {
        para: p, start: paraStart + pl.start, end: paraStart + pl.end, y: 0, ascent: Math.max(ASCENT * size, objUp), descent: Math.max(DESCENT * size, objDown),
        size, left: lineLeft, room: (li === 0 ? room - firstLine : room) - pl.cut.left - pl.cut.right, x: lineLeft, width: pl.width, pieces, marker: li === 0 ? marker : undefined, last,
      };
      if (pl.cut.right) l.cutRight = pl.cut.right;
      if (l.marker && pl.cut.left) l.marker = { ...l.marker, x: l.marker.x + pl.cut.left };
      if (f.boxes) {
        // a document's line: the height of single spacing (times the line spacing), or of its tallest figure
        l.above = Math.max((SINGLE * pSpacing - DESCENT) * size, objUp);
        l.below = l.descent;
        // spacing in points: exactly (figures may then reach into the line above), or at least
        if (ps.linePt && ps.linePt > 0) l.above = ps.lineRule === 'exact' ? Math.max(0, ps.linePt - l.below) : Math.max(l.above, ps.linePt - l.below);
        // moved down past a figure
        if (pl.cut.down) l.above += pl.cut.down;
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
    const room = Math.max(0, boxWidth - l.left - (paras[l.para].indentRight ?? 0) - (l.cutRight ?? 0));
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
  if (g.spacing) w += g.spacing * k;
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
  let idx = lay.lines.map((_, i) => i);
  // text in columns: the lines of the column nearest the point (they run down it, page after page)
  if (lay.lines.some((l) => l.band)) {
    const gap = (l: LaidLine) => (l.band ? Math.max(0, l.band[0] - x, x - l.band[1]) : 0);
    const best = Math.min(...idx.map((i) => gap(lay.lines[i])));
    const band = lay.lines[idx.find((i) => gap(lay.lines[i]) === best)!].band;
    if (band) idx = idx.filter((i) => { const b = lay.lines[i].band; return !b || (b[0] === band[0] && b[1] === band[1]); });
  }
  const ls = idx.map((i) => lay.lines[i]);
  let li = ls.length - 1;
  for (let i = 0; i < ls.length; i++) {
    if (y < ls[i].y + ls[i].descent + (i + 1 < ls.length ? (ls[i + 1].y - ls[i + 1].ascent - ls[i].y - ls[i].descent) / 2 : Infinity)) { li = i; break; }
  }
  return offsetInLine(lay, idx[Math.max(0, li)], x);
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
