// Drawing a document's pages for print: the same layout the screen shows (text, header and
// footer, page numbers, figures and pictures), recorded as shapes and text so the PDF keeps
// lines and letters sharp and puts every character where it is on screen.

import type { Item } from '../render/vector';
import { VectorContext } from '../render/vector';
import type { Picture } from '../render/picture';
import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { drawLayout } from '../text/draw';
import { BOX_PAD, SHADOWS, borderRect, lookOf, styleOf, watermarkPlace, type DocText, type HeaderFooter, type NumberPlace, type PageBorder, type Watermark } from './document';
import { withStack } from '../text/layout';
import type { DocLayout, PageBox, TableBox } from './doc-layout';
import type { BorderLine, TableData } from '../model';
import { coveringCell, spanOf } from '../table';
import { DEFAULT_MARGINS, hasLines, resolveTable, strokeOf, type TableStyleDef } from './table-styles';
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

/** A colour mixed part of the way into another (`k` 0: the first, 1: the second). */
function mix(a: string, b: string, k: number): string {
  const rgb = (c: string) => { const h = c.replace('#', ''); const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0'); return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0); };
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

/**
 * Design > Page Color, Watermark and Page Borders on a page (its top left corner at `p.x`,
 * `p.top`), under the text. The watermark is as Word lays one out: in the middle of the
 * margins, as big as fits, corner to corner (turned 45°) or straight across.
 */
export function drawPageLook(ctx: CanvasRenderingContext2D, t: DocText, p: PageBox): void {
  if (t.pageColor) {
    ctx.fillStyle = t.pageColor;
    ctx.fillRect(p.x, p.top, p.w, p.h);
  }
  if (t.watermark?.text) drawWatermark(ctx, t.watermark, p, t.pageColor ?? '#ffffff');
  if (t.pageBorder) drawPageBorder(ctx, t.pageBorder, p);
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: Watermark, p: PageBox, paper: string): void {
  const at = watermarkPlace(w, p, docMeasure);
  ctx.save();
  ctx.translate(at.cx, at.cy);
  if (at.angle) ctx.rotate(at.angle);
  ctx.font = `bold ${at.size}px ${withStack(w.font)}`;
  // semitransparent: half way into the paper (printed pages can't be see-through)
  ctx.fillStyle = w.faded ? mix(w.color, paper, 0.5) : w.color;
  ctx.fillText(w.text, -at.width / 2, at.size * 0.35);
  ctx.restore();
}

function drawPageBorder(ctx: CanvasRenderingContext2D, b: PageBorder, p: PageBox): void {
  const r = borderRect(b, p);
  ctx.save();
  ctx.strokeStyle = b.color;
  ctx.lineCap = b.style === 'dotted' ? 'round' : 'butt';
  const box = (inset: number, lw: number) => { ctx.lineWidth = lw; ctx.strokeRect(r.x + inset, r.y + inset, r.w - 2 * inset, r.h - 2 * inset); };
  if (b.style === 'double') { box(-b.width, b.width * 0.6); box(b.width, b.width * 0.6); }
  else if (b.style === 'thick') { box(-b.width * 0.6, b.width * 1.4); box(b.width * 1.2, Math.max(0.25, b.width * 0.4)); }
  else {
    if (b.style === 'dotted') ctx.setLineDash([0.01, b.width * 2.5]);
    if (b.style === 'dashed') ctx.setLineDash([b.width * 4, b.width * 2.5]);
    box(0, b.width);
  }
  ctx.restore();
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
    drawPageLook(c, t, p);
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
        if (tb) drawDocTable(c, obj.table, tb, p.index, null, t.tableStyles);
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
 * `faint` (the screen only) is the colour for gridlines where no line is drawn, so the cells
 * can be seen while typing (always, or only in a table with no lines at all); leave it null to
 * draw none (print). `kept` is the document's own table styles.
 */
export function drawDocTable(ctx: CanvasRenderingContext2D, t: TableData, tb: TableBox, page: number, faint: { color: string; px: number; always?: boolean } | null, kept?: Record<string, TableStyleDef>): void {
  const n = t.cols.length;
  const rows = tb.rows.map((at, r) => ({ ...at, r })).filter((at) => at.page === page);
  if (!rows.length) return;
  const res = resolveTable(t, kept);
  // shading under everything (a merged cell's in each row it covers)
  for (const { r, x, y } of rows) {
    for (let c = 0; c < n; c++) {
      const o = coveringCell(t, r, c);
      const fill = res.fill[o.r]?.[o.c];
      if (!fill || o.c !== c) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x + tb.xs[c], y, tb.xs[c + spanOf(t, o.r, o.c)] - tb.xs[c], tb.hs[r]);
    }
  }
  for (const { r, x, y } of rows) {
    tb.cells[r]?.forEach((cl, c) => {
      const m = tb.pads[r]?.[c] ?? DEFAULT_MARGINS;
      if (cl) drawLayout(ctx, cl, x + tb.xs[c] + m.left, y + m.top + tb.drop[r][c] - cl.box.y1);
    });
  }
  const lines: { x1: number; y1: number; x2: number; y2: number; e: BorderLine | null }[] = [];
  const showFaint = !!faint && (faint.always || !hasLines(res));
  const add = (x1: number, y1: number, x2: number, y2: number, e: BorderLine | null) => {
    if (!e && !showFaint) return;
    // joined to the line before when it carries straight on in the same look
    const last = lines[lines.length - 1];
    if (last && last.x2 === x1 && last.y2 === y1 && (last.y1 === last.y2) === (y1 === y2) && sameLine(last.e, e)) {
      last.x2 = x2; last.y2 = y2;
      return;
    }
    lines.push({ x1, y1, x2, y2, e });
  };
  const same = (a: { r: number; c: number }, b: { r: number; c: number }) => a.r === b.r && a.c === b.c;
  // inside a merged cell: no line, not even a faint one
  const insideH = (r: number, c: number) => r > 0 && r < t.rows.length && same(coveringCell(t, r - 1, c), coveringCell(t, r, c));
  rows.forEach(({ r, x, y }, i) => {
    const h = tb.hs[r];
    // the top of each row; on a page the table carries on to, the table's own top line where the row has none
    for (let c = 0; c < n; c++) {
      let e = res.h[r][c];
      if (i === 0 && r > 0 && !e) e = res.h[0][c];
      if (!e && insideH(r, c)) continue;
      add(x + tb.xs[c], y, x + tb.xs[c + 1], y, e);
    }
    // the bottom: the next row draws its top, unless it is on another page (or this is the last)
    const next = rows[i + 1];
    if (!next || next.r !== r + 1) {
      const last = r === t.rows.length - 1;
      for (let c = 0; c < n; c++) {
        let e = res.h[r + 1][c];
        if (!last && !e) e = res.h[t.rows.length][c];
        if (!e && insideH(r + 1, c)) continue;
        add(x + tb.xs[c], y + h, x + tb.xs[c + 1], y + h, e);
      }
    }
    for (let c = 0; c <= n; c++) {
      const e = res.v[r][c];
      if (c > 0 && c < n && same(coveringCell(t, r, c - 1), coveringCell(t, r, c))) continue;
      add(x + tb.xs[c], y, x + tb.xs[c], y + h, e);
    }
  });
  ctx.save();
  ctx.lineCap = 'butt';
  for (const { x1, y1, x2, y2, e } of lines) {
    if (!e) {
      if (!faint) continue;
      ctx.strokeStyle = faint.color;
      ctx.lineWidth = faint.px;
      ctx.setLineDash([2 * faint.px, 2 * faint.px]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      continue;
    }
    const s = strokeOf(e);
    ctx.strokeStyle = e.color || '#000';
    ctx.setLineDash(s.dash);
    if (s.double) {
      // two lines, as far apart as each is wide, centred on the edge
      ctx.lineWidth = s.w;
      const d = s.w;
      const across = y1 === y2;
      for (const k of [-d, d]) {
        ctx.beginPath();
        ctx.moveTo(x1 + (across ? 0 : k), y1 + (across ? k : 0));
        ctx.lineTo(x2 + (across ? 0 : k), y2 + (across ? k : 0));
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = s.w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  ctx.restore();
}

const sameLine = (a: BorderLine | null, b: BorderLine | null) => (!a && !b) || (!!a && !!b && a.style === b.style && a.w === b.w && a.color === b.color);
