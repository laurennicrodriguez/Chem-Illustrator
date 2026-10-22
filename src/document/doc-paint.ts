// Drawing a document's pages for print: the same layout the screen shows (text, header and
// footer, page numbers, figures and pictures), recorded as shapes and text so the PDF keeps
// lines and letters sharp and puts every character where it is on screen.

import type { Item } from '../render/vector';
import { VectorContext } from '../render/vector';
import type { Picture } from '../render/picture';
import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { drawLayout } from '../text/draw';
import { BOX_PAD, SHADOWS, lookOf, styleOf, type DocText, type HeaderFooter, type NumberPlace } from './document';
import type { DocLayout, PageBox, TableBox } from './doc-layout';
import { ACS_LINE, CELL_PAD, GRID_LINE } from './doc-layout';
import type { TableData } from '../model';
import { coveringCell, spanOf } from '../table';
import { docMeasure } from './doc-file';
import { drawMath } from './math';
import { fxSrc, hasFx, traceShape } from '../render/picture-fx';

/** One piece of a header or footer line: its text, where it goes, and its font. */
export interface HfPart { where: 'header' | 'footer'; align: 'left' | 'center' | 'right'; text: string; font: string; size: number; w: number }

const PLACES: Record<Exclude<NumberPlace, 'none'>, ['header' | 'footer', 'left' | 'center' | 'right']> = {
  'header-left': ['header', 'left'], 'header-center': ['header', 'center'], 'header-right': ['header', 'right'],
  'footer-left': ['footer', 'left'], 'footer-center': ['footer', 'center'], 'footer-right': ['footer', 'right'],
};

/** The header and footer text of a page, with its number put in its place (after any text there). `hf` is the page's section's (the document's when left out). */
export function headerFooterText(t: DocText, label: string, hf: HeaderFooter = t.hf): HfPart[] {
  const st = styleOf(t, undefined);
  const font = st.font, size = Math.min(10, st.size);
  const out: HfPart[] = [];
  const aligns = ['left', 'center', 'right'] as const;
  const where = hf.numbers !== 'none' ? PLACES[hf.numbers] : null;
  for (const w of ['header', 'footer'] as const) {
    aligns.forEach((a, i) => {
      let text = hf[w][i] ?? '';
      if (where && where[0] === w && where[1] === a && label) text = text ? `${text} ${label}` : label;
      if (!text) return;
      out.push({ where: w, align: a, text, font, size, w: docMeasure(text, size, font, '') });
    });
  }
  return out;
}

/** Draw a page's header and footer (the page's top left corner is at `p.x`, `p.top`), in its section's margins. */
export function drawHeaderFooter(ctx: CanvasRenderingContext2D, t: DocText, p: PageBox): void {
  const pg = p.setup;
  for (const part of headerFooterText(t, p.label, p.hf)) {
    const y = part.where === 'header' ? p.top + pg.header + part.size * 0.8 : p.top + p.h - pg.footer - part.size * 0.25;
    const x = p.x + (part.align === 'left' ? pg.left : part.align === 'center' ? (pg.left + p.w - pg.right) / 2 - part.w / 2 : p.w - pg.right - part.w);
    ctx.font = `${part.size}px ${part.font}`;
    ctx.fillStyle = '#000';
    ctx.fillText(part.text, x, y);
  }
}

/** Draw a page's line numbers (Layout > Line Numbers), in grey on screen and black in print. */
export function drawLineNumbers(ctx: CanvasRenderingContext2D, lay: DocLayout, page: number, color = '#000'): void {
  ctx.fillStyle = color;
  for (const n of lay.lineNums) {
    if (n.page !== page) continue;
    ctx.font = `${n.size}px ${n.family}`;
    ctx.fillText(n.text, n.x, n.y);
  }
}

/** The short lines above a page's footnotes and above the endnotes (half a point, as Word's). */
export function drawNoteRules(ctx: CanvasRenderingContext2D, lay: DocLayout, page: number): void {
  ctx.fillStyle = '#000';
  for (const r of lay.noteRules) if (r.page === page) ctx.fillRect(r.x, r.y - 0.25, r.w, 0.5);
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
    drawHeaderFooter(c, t, p);
    drawLineNumbers(c, lay, p.index);
    // figures behind the text first
    // tables go under the figures in their cells
    // (a table in a cell after the table holding it)
    const depth = (id: number) => (t.objects[id]?.kind === 'table' ? lay.tables.get(id)?.depth ?? 0 : 1e9);
    const mine = lay.objects.filter((o) => o.page === p.index).sort((a, b) => depth(a.id) - depth(b.id));
    const order = [...mine.filter((o) => o.wrap === 'behind'), null, ...mine.filter((o) => o.wrap !== 'behind')];
    for (const o of order) {
      if (!o) { drawLayout(c, lay.text, 0, 0, p.first, p.end); drawNoteRules(c, lay, p.index); continue; }
      const obj = t.objects[o.id];
      if (obj?.kind === 'note') {
        const n = lay.notes.get(o.id);
        if (n) drawLayout(c, n.lay, 0, 0);
        continue;
      }
      const look = lookOf(obj);
      // a picture cut to a shape has the shape's outline for its shadow and frame
      const cut = obj?.kind === 'picture' ? obj.fx?.shape : undefined;
      const outline = (dx: number) => {
        c.beginPath();
        if (!cut || !traceShape(c, cut, o.x + dx, o.y + dx, o.w, o.h)) c.rect(o.x + dx, o.y + dx, o.w, o.h);
      };
      if (look?.shadow) {
        // a PDF has no blur: the shadow is a grey box, lighter when soft
        const s = SHADOWS[look.shadow];
        c.fillStyle = look.shadow === 'soft' ? '#c9c9c9' : '#8c8c8c';
        outline(s.off);
        c.fill();
        if (!(obj?.kind === 'picture' && hasFx(obj.fx))) {
          c.fillStyle = '#fff';
          c.fillRect(o.x, o.y, o.w, o.h);
        }
      }
      if (obj?.kind === 'table') {
        const tb = lay.tables.get(o.id);
        if (tb) drawDocTable(c, obj.table, tb, p.index, null);
      } else if (obj?.kind === 'textbox') {
        if (obj.fill) { c.fillStyle = obj.fill; c.fillRect(o.x, o.y, o.w, o.h); }
        const bl = lay.boxes.get(o.id);
        if (bl) drawLayout(c, bl, o.x + BOX_PAD.x, o.y + BOX_PAD.y - bl.box.y1);
      } else if (obj?.kind === 'math') {
        const m = lay.maths.get(o.id);
        if (m) drawMath(c, m, o.x, o.y + m.ascent, m.family, m.color);
      } else if (obj?.kind === 'picture') ctx.items.push({ kind: 'image', src: fxSrc(obj) ?? obj.src, x: o.x, y: o.y, w: o.w, h: o.h, px: obj.px, ...(obj.crop ? { crop: obj.crop } : {}) });
      else if (obj?.kind === 'drawing') {
        const pic = drawing(obj.contents, t.drawingStyle);
        if (pic) ctx.items.push(...placeItems(pic, o));
      }
      if (look?.frame) {
        c.strokeStyle = look.frameColor ?? '#000';
        c.lineWidth = look.frame;
        outline(0);
        c.stroke();
      }
    }
    return { w: p.w, h: p.h, items: ctx.items, origin: { x: p.x, y: p.top } };
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


/**
 * Draw the rows of a table that are on one page: cell shading, cell text, then the lines.
 * `faint` (the screen only) is the colour for the gridlines of a table drawn with no lines, so
 * its cells can be seen while typing; leave it null to draw none (print).
 */
export function drawDocTable(ctx: CanvasRenderingContext2D, t: TableData, tb: TableBox, page: number, faint: { color: string; px: number } | null): void {
  const n = t.cols.length;
  const rows = tb.rows.map((at, r) => ({ ...at, r })).filter((at) => at.page === page);
  if (!rows.length) return;
  // shading under everything (a merged cell's in each row it covers)
  for (const { r, x, y } of rows) {
    for (let c = 0; c < n; c++) {
      const o = coveringCell(t, r, c);
      const fill = t.rows[o.r]?.[o.c]?.fill;
      if (!fill || o.c !== c) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x + tb.xs[c], y, tb.xs[c + spanOf(t, o.r, o.c)] - tb.xs[c], tb.hs[r]);
    }
  }
  for (const { r, x, y } of rows) {
    tb.cells[r]?.forEach((cl, c) => {
      if (cl) drawLayout(ctx, cl, x + tb.xs[c] + CELL_PAD.x, y + CELL_PAD.y + tb.drop[r][c] - cl.box.y1);
    });
  }
  const lines: [number, number, number, number, number][] = [];
  const W = tb.xs[n];
  const head = Math.max(0, Math.min(t.head, t.rows.length));
  const last = t.rows.length - 1;
  const grid = t.lines === 'grid' || (t.lines === 'none' && faint);
  const same = (a: { r: number; c: number }, b: { r: number; c: number }) => a.r === b.r && a.c === b.c;
  // a line across the table at a row's top or bottom, broken where a merged cell carries on over it
  const across = (r: number, x: number, y: number, lw: number, bottom: boolean) => {
    let from: number | null = null;
    for (let c = 0; c <= n; c++) {
      const open = c < n && !(bottom ? r + 1 <= last && same(coveringCell(t, r, c), coveringCell(t, r + 1, c)) : r > 0 && same(coveringCell(t, r, c), coveringCell(t, r - 1, c)));
      if (open && from === null) from = c;
      if (!open && from !== null) { lines.push([x + tb.xs[from], y, x + tb.xs[c], y, lw]); from = null; }
    }
  };
  for (const { r, x, y } of rows) {
    const h = tb.hs[r];
    if (grid) {
      const lw = t.lines === 'grid' ? GRID_LINE : 0;
      across(r, x, y, lw, false);
      across(r, x, y + h, lw, true);
      for (let c = 0; c <= n; c++) {
        if (c > 0 && c < n && same(coveringCell(t, r, c), coveringCell(t, r, c - 1))) continue;
        lines.push([x + tb.xs[c], y, x + tb.xs[c], y + h, lw]);
      }
    } else if (t.lines === 'acs') {
      // the top of the table (and of each page it carries on to), under the headings, and under the last row
      if (r === 0 || r === rows[0].r) lines.push([x, y, x + W, y, ACS_LINE]);
      if (head > 0 && r === head - 1 && r < last) lines.push([x, y + h, x + W, y + h, GRID_LINE]);
      if (r === last) lines.push([x, y + h, x + W, y + h, ACS_LINE]);
    }
  }
  ctx.save();
  ctx.lineCap = 'butt';
  for (const [x1, y1, x2, y2, lw] of lines) {
    if (lw === 0 && faint) {
      ctx.strokeStyle = faint.color;
      ctx.lineWidth = faint.px;
      ctx.setLineDash([2 * faint.px, 2 * faint.px]);
    } else {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}
