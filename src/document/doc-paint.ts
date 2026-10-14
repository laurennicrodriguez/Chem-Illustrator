// Drawing a document's pages for print: the same layout the screen shows (text, header and
// footer, page numbers, figures and pictures), recorded as shapes and text so the PDF keeps
// lines and letters sharp and puts every character where it is on screen.

import type { Item } from '../render/vector';
import { VectorContext } from '../render/vector';
import type { Picture } from '../render/picture';
import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { drawLayout } from '../text/draw';
import { styleOf, type DocText, type NumberPlace } from './document';
import type { DocLayout, PageBox } from './doc-layout';
import { docMeasure } from './doc-file';

/** One piece of a header or footer line: its text, where it goes, and its font. */
export interface HfPart { where: 'header' | 'footer'; align: 'left' | 'center' | 'right'; text: string; font: string; size: number; w: number }

const PLACES: Record<Exclude<NumberPlace, 'none'>, ['header' | 'footer', 'left' | 'center' | 'right']> = {
  'header-left': ['header', 'left'], 'header-center': ['header', 'center'], 'header-right': ['header', 'right'],
  'footer-left': ['footer', 'left'], 'footer-center': ['footer', 'center'], 'footer-right': ['footer', 'right'],
};

/** The header and footer text of a page, with its number put in its place (after any text there). */
export function headerFooterText(t: DocText, label: string): HfPart[] {
  const st = styleOf(t, undefined);
  const font = st.font, size = Math.min(10, st.size);
  const out: HfPart[] = [];
  const aligns = ['left', 'center', 'right'] as const;
  const where = t.hf.numbers !== 'none' ? PLACES[t.hf.numbers] : null;
  for (const w of ['header', 'footer'] as const) {
    aligns.forEach((a, i) => {
      let text = t.hf[w][i] ?? '';
      if (where && where[0] === w && where[1] === a && label) text = text ? `${text} ${label}` : label;
      if (!text) return;
      out.push({ where: w, align: a, text, font, size, w: docMeasure(text, size, font, '') });
    });
  }
  return out;
}

/** Draw a page's header and footer (the page's top is at `p.top`). */
export function drawHeaderFooter(ctx: CanvasRenderingContext2D, t: DocText, p: PageBox, lay: DocLayout): void {
  for (const part of headerFooterText(t, p.label)) {
    const y = part.where === 'header' ? p.top + t.page.header + part.size * 0.8 : p.top + lay.pageH - t.page.footer - part.size * 0.25;
    const x = part.align === 'left' ? t.page.left : part.align === 'center' ? (t.page.left + lay.pageW - t.page.right) / 2 - part.w / 2 : lay.pageW - t.page.right - part.w;
    ctx.font = `${part.size}px ${part.font}`;
    ctx.fillStyle = '#000';
    ctx.fillText(part.text, x, y);
  }
}

/** A page for a PDF: its size, and what is drawn on it with the page's top left corner at `origin`. */
export interface PrintPage { w: number; h: number; items: Item[]; origin: { x: number; y: number } }

/**
 * Every page of a document as shapes and text. `drawing` records a structure or table (its
 * picture's own coordinates and the box it shows); each is scaled into the place it has on
 * its page.
 */
export function recordPages(t: DocText, lay: DocLayout, drawing: (c: Contents, style: DocStyle) => Picture | null): PrintPage[] {
  const width = (ch: string, size: number, family: string, bold: boolean, italic: boolean) =>
    docMeasure(ch, size, family, `${italic ? 'italic ' : ''}${bold ? 'bold' : ''}`);
  return lay.pages.map((p) => {
    const ctx = new VectorContext(width);
    const c = ctx as unknown as CanvasRenderingContext2D;
    drawHeaderFooter(c, t, p, lay);
    drawLayout(c, lay.text, 0, 0, p.first, p.end);
    for (const o of lay.objects) {
      if (o.page !== p.index) continue;
      const obj = t.objects[o.id];
      if (obj?.kind === 'picture') ctx.items.push({ kind: 'image', src: obj.src, x: o.x, y: o.y, w: o.w, h: o.h, px: obj.px });
      else if (obj?.kind === 'drawing') {
        const pic = drawing(obj.contents, t.drawingStyle);
        if (pic) ctx.items.push(...placeItems(pic, o));
      }
    }
    return { w: lay.pageW, h: lay.pageH, items: ctx.items, origin: { x: 0, y: p.top } };
  });
}

/** A recorded picture's shapes and text scaled and moved to fill a box. */
export function placeItems(pic: Picture, at: { x: number; y: number; w: number; h: number }): Item[] {
  const b = pic.box;
  const kx = at.w / Math.max(1e-9, b.x2 - b.x1), ky = at.h / Math.max(1e-9, b.y2 - b.y1);
  const k = Math.min(kx, ky);
  const X = (x: number) => at.x + (x - b.x1) * kx;
  const Y = (y: number) => at.y + (y - b.y1) * ky;
  return pic.items.map((it): Item => {
    if (it.kind === 'text') return { ...it, x: X(it.x), y: Y(it.y), size: it.size * k, widths: it.widths.map((w) => w * k) };
    if (it.kind === 'image') return { ...it, x: X(it.x), y: Y(it.y), w: it.w * kx, h: it.h * ky };
    return {
      ...it,
      ...(it.stroke ? { stroke: { ...it.stroke, width: it.stroke.width * k } } : {}),
      segs: it.segs.map((s) => (s.k === 'Z' ? s : s.k === 'C'
        ? { k: 'C', x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), x: X(s.x), y: Y(s.y) }
        : { k: s.k, x: X(s.x), y: Y(s.y) })),
    };
  });
}
