// Drawing laid-out text on a canvas (or on the recording canvas that makes pictures for Word
// and PowerPoint).

import type { Glyphs, LaidLine, TextLayout } from './layout';
import { pieceX } from './layout';

export const fontOf = (g: Glyphs): string => `${g.style}${g.size}px ${g.family}`;

/** Draw a text laid out by layoutText with its origin at (ox, oy) (or only its lines from `from` up to `to`). */
export function drawLayout(ctx: CanvasRenderingContext2D, lay: TextLayout, ox: number, oy: number, from = 0, to = lay.lines.length): void {
  for (let i = from; i < to; i++) {
    const l = lay.lines[i];
    // highlighter colours go under all the line's text
    for (const g of l.pieces) {
      if (!g.highlight || g.hidden) continue;
      ctx.fillStyle = g.highlight;
      const h = l.above !== undefined ? Math.min(l.above, l.ascent * 1.12) : l.ascent;
      ctx.fillRect(ox + g.x, oy + l.y - h, g.w, h + l.descent);
    }
    if (l.marker) drawGlyphs(ctx, lay, l, l.marker, ox, oy);
    for (const g of l.pieces) drawGlyphs(ctx, lay, l, g, ox, oy);
  }
  ctx.fillStyle = '#000';
}

function drawGlyphs(ctx: CanvasRenderingContext2D, lay: TextLayout, l: LaidLine, g: Glyphs, ox: number, oy: number): void {
  // figures are drawn by the document itself; a field shows its text
  if ((g.obj !== undefined && g.shown === undefined) || g.hidden) return;
  ctx.font = fontOf(g);
  ctx.fillStyle = g.color ?? '#000';
  const y = oy + l.y + g.dy;
  if (g.tab) {
    // a tab shows nothing but its leader: dots, a dashed or a solid line along the baseline
    if (g.leader === 'underscore') ctx.fillRect(ox + g.x, oy + l.y + Math.max(1, g.size * 0.1), g.w, Math.max(0.5, g.size * 0.05));
    else if (g.leader) {
      const mark = g.leader === 'dot' ? '.' : '-';
      const step = Math.max(1, lay.measure(mark, g.size, g.family, g.style) * (g.leader === 'dot' ? 1.6 : 1.3));
      // dots line up from one line to the next (on a grid from the margin), as Word's do
      for (let x = Math.ceil((g.x + 0.5) / step) * step; x + step <= g.x + g.w + 0.01; x += step) ctx.fillText(mark, ox + x, y);
    }
  } else if (g.shown !== undefined) ctx.fillText(g.shown, ox + g.x, y);
  else if (g.spacing) {
    // spaced out (or condensed): each character where the spacing puts it
    for (let k = 0; k < g.text.length; k++) if (g.text[k] !== ' ') ctx.fillText(g.text[k], ox + g.x + pieceX(lay, g, k), y);
  } else if (g.spread) {
    // justified: each word goes where the stretched spaces put it
    let k = 0;
    for (const word of g.text.split(' ')) {
      if (word) ctx.fillText(word, ox + g.x + pieceX(lay, g, k), y);
      k += word.length + 1;
    }
  } else ctx.fillText(g.text, ox + g.x, y);
  if (g.underline) {
    // from the text's own size (the line's height also takes in pictures set in the line)
    const base = g.size;
    ctx.fillRect(ox + g.x, oy + l.y + Math.max(1, base * 0.1), g.w, Math.max(0.5, base * 0.05));
  }
  if (g.strike) {
    // through the middle of the small letters
    ctx.fillRect(ox + g.x, oy + l.y + g.dy - g.size * 0.27, g.w, Math.max(0.5, g.size * 0.05));
  }
}
