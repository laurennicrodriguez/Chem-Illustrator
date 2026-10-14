// Drawing laid-out text on a canvas (or on the recording canvas that makes pictures for Word
// and PowerPoint).

import type { Glyphs, LaidLine, TextLayout } from './layout';
import { pieceX } from './layout';

export const fontOf = (g: Glyphs): string => `${g.style}${g.size}px ${g.family}`;

/** Draw a text laid out by layoutText with its origin at (ox, oy) (or only its lines from `from` up to `to`). */
export function drawLayout(ctx: CanvasRenderingContext2D, lay: TextLayout, ox: number, oy: number, from = 0, to = lay.lines.length): void {
  for (let i = from; i < to; i++) {
    const l = lay.lines[i];
    if (l.marker) drawGlyphs(ctx, lay, l, l.marker, ox, oy);
    for (const g of l.pieces) drawGlyphs(ctx, lay, l, g, ox, oy);
  }
  ctx.fillStyle = '#000';
}

function drawGlyphs(ctx: CanvasRenderingContext2D, lay: TextLayout, l: LaidLine, g: Glyphs, ox: number, oy: number): void {
  // figures are drawn by the document itself; a field shows its text
  if (g.obj !== undefined && g.shown === undefined) return;
  ctx.font = fontOf(g);
  ctx.fillStyle = g.color ?? '#000';
  const y = oy + l.y + g.dy;
  if (g.shown !== undefined) ctx.fillText(g.shown, ox + g.x, y);
  else if (g.spread) {
    // justified: each word goes where the stretched spaces put it
    let k = 0;
    for (const word of g.text.split(' ')) {
      if (word) ctx.fillText(word, ox + g.x + pieceX(lay, g, k), y);
      k += word.length + 1;
    }
  } else ctx.fillText(g.text, ox + g.x, y);
  if (g.underline) {
    const base = l.ascent / 0.8;
    ctx.fillRect(ox + g.x, oy + l.y + Math.max(1, base * 0.1), g.w, Math.max(0.5, base * 0.05));
  }
}
