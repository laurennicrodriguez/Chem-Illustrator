// Paragraph borders and shading (Home > Borders and Shading, as in Word). A paragraph can have
// a line on any of its four sides and a background colour. Paragraphs one after another with the
// same borders and indents share one box (Word's way), with the "between" line, if any, drawn
// between them. A border keeps a little room from the text: a point above and below, four points
// at the sides (Word's spacing), and the space above and below is taken from the page.

import type { BorderLine, ParaBorders, ParaStyle } from '../model';

/** Room between a border and the text it is round (Word's defaults): above and below, and at the sides. */
export const BORDER_SPACE = { y: 1, x: 4 };

/** The sides a paragraph's box can have. */
export const PARA_SIDES = ['top', 'bottom', 'left', 'right', 'between'] as const;
export type ParaSide = (typeof PARA_SIDES)[number];

const on = (b: BorderLine | undefined): b is BorderLine => !!b && b.style !== 'none' && b.w > 0;

/** A paragraph's borders with only the lines actually drawn (undefined when none are). */
export function cleanBorders(b: ParaBorders | undefined): ParaBorders | undefined {
  if (!b) return undefined;
  const out: ParaBorders = {};
  for (const k of PARA_SIDES) if (on(b[k])) out[k] = { ...b[k]! };
  return Object.keys(out).length ? out : undefined;
}

/** Whether two paragraphs share one box: the same borders and the same indents. */
export function sameBox(a: ParaStyle | undefined, b: ParaStyle | undefined): boolean {
  if (!a?.border || !b?.border) return false;
  return JSON.stringify(cleanBorders(a.border)) === JSON.stringify(cleanBorders(b.border)) &&
    (a.indent ?? 0) === (b.indent ?? 0) && (a.indentRight ?? 0) === (b.indentRight ?? 0) && (a.firstLine ?? 0) === (b.firstLine ?? 0);
}

/**
 * The room borders take above and below each paragraph's text: the top line (with its space) on the
 * first paragraph of a box, the bottom one on its last, and a between line above each paragraph after
 * the first.
 */
export function borderRoom(paras: ParaStyle[]): { above: number[]; below: number[] } {
  const above = paras.map(() => 0), below = paras.map(() => 0);
  paras.forEach((p, i) => {
    const b = cleanBorders(p.border);
    if (!b) return;
    const joinsPrev = i > 0 && sameBox(paras[i - 1], p);
    const joinsNext = i + 1 < paras.length && sameBox(p, paras[i + 1]);
    if (!joinsPrev && b.top) above[i] = b.top.w + BORDER_SPACE.y;
    if (joinsPrev && b.between) above[i] = b.between.w + 2 * BORDER_SPACE.y;
    if (!joinsNext && b.bottom) below[i] = b.bottom.w + BORDER_SPACE.y;
  });
  return { above, below };
}

/** A paragraph's part on one page (or column) as placed: the top and bottom of its text, with the border's room, and its left and right edges. */
export interface ParaSpan { para: number; page: number; col: number; y1: number; y2: number; x1: number; x2: number }

/** A box or shading drawn on a page round paragraphs, in the document's coordinates. */
export interface ParaFrame {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The background, when the paragraphs are shaded (each shaded stretch is a frame of its own). */
  shade?: string;
  /** The lines to draw: top and bottom only where the box starts and ends (not where it runs onto the next page). */
  top?: BorderLine;
  bottom?: BorderLine;
  left?: BorderLine;
  right?: BorderLine;
  /** Between paragraphs in the box: the line and where it goes. */
  between?: { line: BorderLine; ys: number[] };
}

/**
 * The boxes and shading round paragraphs, from where each paragraph's text went (its spans, in
 * order). A box takes in the border room above and below its text (already in the spans) and
 * reaches four points past the text at the sides.
 */
export function paraFrames(spans: ParaSpan[], paras: ParaStyle[]): ParaFrame[] {
  const out: ParaFrame[] = [];
  // borders: runs of spans in one box, on one page and column
  let i = 0;
  while (i < spans.length) {
    const s = spans[i];
    const b = cleanBorders(paras[s.para]?.border);
    if (!b) { i++; continue; }
    let j = i + 1;
    while (j < spans.length && spans[j].page === s.page && spans[j].col === s.col &&
      (spans[j].para === spans[j - 1].para || (spans[j].para === spans[j - 1].para + 1 && sameBox(paras[spans[j - 1].para], paras[spans[j].para])))) j++;
    const run = spans.slice(i, j);
    const first = run[0], last = run[run.length - 1];
    const startsBox = isFirstSpan(spans, i) && (first.para === 0 || !sameBox(paras[first.para - 1], paras[first.para]));
    const endsBox = !boxGoesOn(spans, j - 1, paras);
    const f: ParaFrame = {
      page: s.page,
      x1: Math.min(...run.map((r) => r.x1)) - BORDER_SPACE.x,
      x2: Math.max(...run.map((r) => r.x2)) + BORDER_SPACE.x,
      y1: first.y1, y2: last.y2,
    };
    if (b.top && startsBox) f.top = b.top;
    if (b.bottom && endsBox) f.bottom = b.bottom;
    if (b.left) f.left = b.left;
    if (b.right) f.right = b.right;
    if (b.between) {
      const ys: number[] = [];
      for (let k = 1; k < run.length; k++) if (run[k].para !== run[k - 1].para) ys.push(run[k].y1 + b.between.w / 2 + BORDER_SPACE.y / 2);
      if (ys.length) f.between = { line: b.between, ys };
    }
    // the line's middle on the box's edge, so it sits outside the room kept for the text
    if (f.top) f.y1 += f.top.w / 2;
    if (f.bottom) f.y2 -= f.bottom.w / 2;
    out.push(f);
    i = j;
  }
  // shading: each run of shaded spans of one colour, side by side on a page
  i = 0;
  while (i < spans.length) {
    const s = spans[i];
    const fill = paras[s.para]?.shade;
    if (!fill) { i++; continue; }
    let j = i + 1;
    while (j < spans.length && spans[j].page === s.page && spans[j].col === s.col && paras[spans[j].para]?.shade === fill &&
      (spans[j].para === spans[j - 1].para || spans[j].para === spans[j - 1].para + 1)) j++;
    const run = spans.slice(i, j);
    const boxed = cleanBorders(paras[s.para]?.border);
    out.unshift({
      page: s.page, shade: fill,
      x1: Math.min(...run.map((r) => r.x1)) - (boxed ? BORDER_SPACE.x : 0),
      x2: Math.max(...run.map((r) => r.x2)) + (boxed ? BORDER_SPACE.x : 0),
      y1: run[0].y1, y2: run[run.length - 1].y2,
    });
    i = j;
  }
  return out;
}

/** Is this span the first of its paragraph (not the paragraph carried on from the page before)? */
function isFirstSpan(spans: ParaSpan[], i: number): boolean {
  return i === 0 || spans[i - 1].para !== spans[i].para;
}

/** Does the box carry on after this span (more of the paragraph, or another paragraph in the same box)? */
function boxGoesOn(spans: ParaSpan[], i: number, paras: ParaStyle[]): boolean {
  const next = spans[i + 1];
  if (!next) return false;
  return next.para === spans[i].para || (next.para === spans[i].para + 1 && sameBox(paras[spans[i].para], paras[next.para]));
}

/** Draw the shading of the frames on a page (under the text). */
export function drawParaShading(ctx: CanvasRenderingContext2D, frames: ParaFrame[], page: number): void {
  for (const f of frames) {
    if (f.page !== page || !f.shade) continue;
    ctx.fillStyle = f.shade;
    ctx.fillRect(f.x1, f.y1, f.x2 - f.x1, f.y2 - f.y1);
  }
}

/** Draw the borders of the frames on a page (over the text). */
export function drawParaBorders(ctx: CanvasRenderingContext2D, frames: ParaFrame[], page: number): void {
  ctx.save();
  ctx.lineCap = 'butt';
  const line = (b: BorderLine, x1: number, y1: number, x2: number, y2: number) => {
    const w = Math.max(0.25, b.w);
    ctx.strokeStyle = b.color || '#000';
    ctx.setLineDash(b.style === 'dotted' ? [w, w * 1.5] : b.style === 'dashed' ? [w * 4, w * 2.5] : []);
    const across = y1 === y2;
    const offs = b.style === 'double' ? [-w, w] : [0];
    ctx.lineWidth = w;
    for (const k of offs) {
      ctx.beginPath();
      ctx.moveTo(x1 + (across ? 0 : k), y1 + (across ? k : 0));
      ctx.lineTo(x2 + (across ? 0 : k), y2 + (across ? k : 0));
      ctx.stroke();
    }
  };
  for (const f of frames) {
    if (f.page !== page || f.shade) continue;
    if (f.top) line(f.top, f.x1, f.y1, f.x2, f.y1);
    if (f.bottom) line(f.bottom, f.x1, f.y2, f.x2, f.y2);
    if (f.left) line(f.left, f.x1, f.y1, f.x1, f.y2);
    if (f.right) line(f.right, f.x2, f.y1, f.x2, f.y2);
    if (f.between) for (const y of f.between.ys) line(f.between.line, f.x1, y, f.x2, y);
  }
  ctx.restore();
}

/** Word's Borders menu: what each choice does to the paragraphs' borders. */
export type BorderChoice = 'bottom' | 'top' | 'left' | 'right' | 'none' | 'all' | 'outside' | 'inside' | 'horizontal';

export const BORDER_CHOICES: [BorderChoice, string][] = [
  ['bottom', 'Bottom Border'], ['top', 'Top Border'], ['left', 'Left Border'], ['right', 'Right Border'],
  ['none', 'No Border'], ['all', 'All Borders'], ['outside', 'Outside Borders'], ['inside', 'Inside Borders'], ['horizontal', 'Horizontal Line'],
];

/** A half-point black line (Word's default border). */
export const DEFAULT_LINE: BorderLine = { style: 'single', w: 0.5, color: '#000000' };

/**
 * Borders after a choice on the Borders menu: a side is turned on (or off when every paragraph
 * picked has it already, as Word's buttons toggle), Outside is the four sides, All adds the line
 * between, and Inside the between line alone.
 */
export function chooseBorder(cur: ParaBorders | undefined, choice: BorderChoice, line: BorderLine = DEFAULT_LINE, allHave = false): ParaBorders | undefined {
  const b: ParaBorders = { ...(cur ?? {}) };
  const sides: ParaSide[] = choice === 'all' ? ['top', 'bottom', 'left', 'right', 'between'] : choice === 'outside' ? ['top', 'bottom', 'left', 'right'] : choice === 'inside' ? ['between'] : choice === 'horizontal' ? ['bottom'] : choice === 'none' ? [] : [choice];
  if (choice === 'none') return undefined;
  if (choice === 'horizontal') return cleanBorders({ ...b, bottom: { style: 'single', w: 1.5, color: '#a0a0a0' } });
  for (const s of sides) {
    if (allHave) delete b[s];
    else b[s] = { ...line };
  }
  return cleanBorders(b);
}

/** Do the borders have every side a choice turns on? (The menu shows such a choice as on.) */
export function hasChoice(b: ParaBorders | undefined, choice: BorderChoice): boolean {
  const c = cleanBorders(b);
  if (choice === 'none') return !c;
  if (!c) return false;
  if (choice === 'all') return !!(c.top && c.bottom && c.left && c.right && c.between);
  if (choice === 'outside') return !!(c.top && c.bottom && c.left && c.right);
  if (choice === 'inside') return !!c.between;
  if (choice === 'horizontal') return !!c.bottom;
  return !!c[choice];
}
