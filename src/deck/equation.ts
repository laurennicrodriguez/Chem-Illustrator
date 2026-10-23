// Equations on slides and designs (Insert > Equation): typed as LaTeX in the equation window
// Document mode uses, laid out live in a picture's box so they stay sharp at any zoom and grow
// or shrink with the box. PowerPoint gets its own equation (Office Math), with a picture of it
// for older programs.

import type { ShapeMath } from '../model';
import { layoutMath, drawMath, mathSvg, type MathBox } from '../document/math';
import { withStack, type Measure } from '../text/layout';
import { dataUrl } from '../render/images';

/** An equation's font as CSS (the text font, with stand-ins). */
export const mathFamily = (m: ShapeMath): string => withStack(m.font ?? 'Arial');

/** The equation laid out at its own size. */
export function shapeMathBox(m: ShapeMath, measure: Measure): MathBox {
  return layoutMath(m.tex, m.size, mathFamily(m), measure);
}

/** How big the equation is at its own size, in points. */
export function shapeMathSize(m: ShapeMath, measure: Measure): { w: number; h: number } {
  const b = shapeMathBox(m, measure);
  return { w: Math.max(1, b.w), h: Math.max(1, b.ascent + b.descent) };
}

/** How much larger than its own size the equation shows in a box this size (the box resized by hand). */
export function shapeMathScale(m: ShapeMath, w: number, h: number, measure: Measure): number {
  const s = shapeMathSize(m, measure);
  return Math.max(0.05, Math.min(Math.abs(w) / s.w, Math.abs(h) / s.h));
}

/** Draw the equation in its box (x, y the top left corner), as large as fits, centred. */
export function paintShapeMath(ctx: CanvasRenderingContext2D, m: ShapeMath, x: number, y: number, w: number, h: number, measure: Measure): void {
  const b = shapeMathBox(m, measure);
  const bw = Math.max(1, b.w), bh = Math.max(1, b.ascent + b.descent);
  const k = Math.max(0.05, Math.min(w / bw, h / bh));
  ctx.save();
  ctx.translate(x + (w - bw * k) / 2, y + (h - bh * k) / 2);
  ctx.scale(k, k);
  drawMath(ctx, b, 0, b.ascent, mathFamily(m), m.color ?? '#000000');
  ctx.restore();
}

/** The equation as an SVG picture (a data URL), for exports and for programs that can't lay it out. */
export function shapeMathPicture(m: ShapeMath, measure: Measure): string {
  const svg = mathSvg(shapeMathBox(m, measure), mathFamily(m), m.color ?? '#000000');
  return dataUrl(new TextEncoder().encode(svg), 'image/svg+xml');
}
