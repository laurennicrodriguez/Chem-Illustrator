// Printing a sheet as Excel does: the print area (or everything in use) cut into pages by the
// sheet's page setup, each page with its margins, the rows and columns repeated as titles, the
// gridlines and headings if asked for, the charts, pictures and shapes over the cells, and the
// header and footer. Pages are HTML at the paper's size, for the system's Print window and for
// Print Preview.

import type { Sheet, Workbook } from '../sheet/workbook';
import { colName } from '../sheet/refs';
import { PageSetup, paginate, HeaderFooter, headerRuns, HfContext, DEFAULT_MARGINS, PrintPage, Pagination } from '../sheet/page-setup';
import { printedRange, sheetSizes } from '../sheet/print-range';
import type { SheetSizes } from '../sheet/page-setup';
import { objectSvg, objectLook, isLine } from '../sheet/sheet-objects';
import { chartData } from '../sheet/chart';
import { chartCanvas } from '../render/chart-draw';
import { defaultPaper } from '../print-layout';

export interface SheetPrintDeps {
  /** A cell's contents and look as a <td> (without the tag's span), for the cells printed. */
  cellHtml(s: Sheet, r: number, c: number): { attrs: string; body: string };
  /** Heights of rows grown to fit structures and wrapped text, as the grid shows them. */
  rowHeight(r: number): number;
}

export interface PrintedSheet {
  /** Each page as HTML, `w` × `h` points. */
  pages: string[];
  w: number;
  h: number;
  scale: number;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/**
 * The pages of a sheet. `selection`: print only these cells (in place of the print area);
 * `ignoreArea`: print everything in use.
 */
export function printSheet(wb: Workbook, s: Sheet, deps: SheetPrintDeps, opts: { selection?: { r1: number; c1: number; r2: number; c2: number }; ignoreArea?: boolean; file: string; date?: Date }): PrintedSheet | null {
  const sizes = sheetSizes(s, (r) => deps.rowHeight(r));
  let ps: PageSetup | null = s.pageSetup;
  if (opts.selection) ps = { ...ps, printArea: [opts.selection] };
  else if (opts.ignoreArea && ps) ps = { ...ps, printArea: undefined };
  const used = printedRange(s, sizes);
  const pag = paginate(ps, sizes, used, defaultPaper(navigator.language));
  if (!pag.pages.length) return null;
  const date = opts.date ?? new Date();
  const first = ps?.firstPage ?? 1;
  const pages = pag.pages.map((p, i) => pageHtml(wb, s, ps, pag, p, sizes, deps, { page: first + i, pages: first + pag.pages.length - 1, sheet: s.name, file: opts.file, date }, i === 0));
  return { pages, w: pag.paper.w, h: pag.paper.h, scale: pag.scale };
}

/** Where a column (or row) starts, in pixels at 100%, counting from the first. */
class Positions {
  private cache: number[] = [0];
  constructor(private size: (i: number) => number) {}
  at(i: number): number {
    while (this.cache.length <= i) this.cache.push(this.cache[this.cache.length - 1] + this.size(this.cache.length - 1));
    return this.cache[i];
  }
}

function pageHtml(wb: Workbook, s: Sheet, ps: PageSetup | null, pag: Pagination, p: PrintPage, sizes: SheetSizes, deps: SheetPrintDeps, ctx: HfContext, isFirst: boolean): string {
  const tr = ps?.titleRows, tc = ps?.titleCols;
  // titles print on the pages after the ones they are on
  const titleRows = tr && p.rows[0] > tr[1] ? range(tr[0], tr[1]) : [];
  const titleCols = tc && p.cols[0] > tc[1] ? range(tc[0], tc[1]) : [];
  const rows = [...titleRows, ...range(p.rows[0], p.rows[1])].filter((r) => sizes.rowH(r) > 0);
  const cols = [...titleCols, ...range(p.cols[0], p.cols[1])].filter((c) => sizes.colW(c) > 0);
  const headings = !!ps?.headings;
  const headW = headings ? 32 : 0, headH = headings ? 20 : 0;
  const grid = !!ps?.gridlines;
  const out: string[] = [];
  out.push(`<table class="sp-table${grid ? ' sp-grid' : ''}" style="table-layout:fixed;border-collapse:collapse;width:${headW + cols.reduce((a, c) => a + sizes.colW(c), 0)}px"><colgroup>`);
  if (headings) out.push(`<col style="width:${headW}px">`);
  for (const c of cols) out.push(`<col style="width:${sizes.colW(c)}px">`);
  out.push('</colgroup>');
  if (headings) out.push(`<tr style="height:${headH}px"><td class="sp-head"></td>${cols.map((c) => `<td class="sp-head">${colName(c)}</td>`).join('')}</tr>`);
  for (const r of rows) {
    const tds: string[] = [];
    if (headings) tds.push(`<td class="sp-head">${r + 1}</td>`);
    for (const c of cols) {
      const m = s.mergeAt(r, c);
      if (m) {
        // a merged block split by the page prints the part on it, from its first cell here
        const mr = rows.filter((x) => x >= m.r1 && x <= m.r2), mc = cols.filter((x) => x >= m.c1 && x <= m.c2);
        if (mr[0] !== r || mc[0] !== c) continue;
        const span = `${mc.length > 1 ? ` colspan="${mc.length}"` : ''}${mr.length > 1 ? ` rowspan="${mr.length}"` : ''}`;
        const cell = m.r1 === r && m.c1 === c ? deps.cellHtml(s, r, c) : { attrs: '', body: '' };
        tds.push(`<td${span}${cell.attrs}>${cell.body}</td>`);
        continue;
      }
      const cell = deps.cellHtml(s, r, c);
      tds.push(`<td${cell.attrs}>${cell.body}</td>`);
    }
    out.push(`<tr style="height:${sizes.rowH(r)}px">${tds.join('')}</tr>`);
  }
  out.push('</table>');

  // charts, pictures and shapes over the cells of the page's block
  const colPos = new Positions(sizes.colW), rowPos = new Positions(sizes.rowH);
  const titleW = titleCols.reduce((a, c) => a + sizes.colW(c), 0) + headW, titleH = titleRows.reduce((a, r) => a + sizes.rowH(r), 0) + headH;
  const bx = colPos.at(p.cols[0]), by = rowPos.at(p.rows[0]);
  const bw = colPos.at(p.cols[1] + 1) - bx, bh = rowPos.at(p.rows[1] + 1) - by;
  const floats: string[] = [];
  const place = (f: { at: { row: number; col: number; dx: number; dy: number }; w: number; h: number }) => {
    const x = colPos.at(f.at.col) + f.at.dx - bx, y = rowPos.at(f.at.row) + f.at.dy - by;
    return x + f.w <= 0 || y + f.h <= 0 || x >= bw || y >= bh ? null : { x, y };
  };
  for (const ch of s.charts) {
    const at = place(ch);
    if (!at) continue;
    try {
      const png = chartCanvas(ch, chartData(wb, s, ch), 3).toDataURL('image/png');
      floats.push(`<img src="${png}" alt="" style="position:absolute;left:${at.x}px;top:${at.y}px;width:${ch.w}px;height:${ch.h}px">`);
    } catch { /* a chart that can't be drawn is left off */ }
  }
  for (const o of s.objects) {
    const at = place(o);
    if (!at) continue;
    const look = objectLook(o);
    let inner = objectSvg(o);
    if (o.text && o.kind !== 'picture' && !isLine(o)) {
      const align = o.align ?? (o.kind === 'text' ? 'left' : 'center'), valign = o.valign ?? (o.kind === 'text' ? 'top' : 'middle');
      inner += `<div style="position:absolute;inset:0;padding:3.6pt 7.2pt;box-sizing:border-box;display:flex;flex-direction:column;justify-content:${valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center'};text-align:${align};` +
        `font:${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size ?? 11}pt ${o.font ? `'${esc(o.font)}', ` : ''}Calibri, Carlito, Arial, sans-serif;color:${look.color};white-space:pre-wrap;overflow:hidden${o.rot ? `;transform:rotate(${o.rot}deg)` : ''}">${esc(o.text)}</div>`;
    }
    floats.push(`<div style="position:absolute;left:${at.x}px;top:${at.y}px;width:${o.w}px;height:${Math.max(1, o.h)}px">${inner}</div>`);
  }
  const body = floats.length ? `<div style="position:absolute;left:${titleW}px;top:${titleH}px;width:${bw}px;height:${bh}px;overflow:hidden">${floats.join('')}</div>` : '';

  // the block, scaled, inside the margins (centred if asked)
  const k = pag.scale;
  const W = (headW + cols.reduce((a, c) => a + sizes.colW(c), 0)) * k * 0.75, H = (headH + rows.reduce((a, r) => a + sizes.rowH(r), 0)) * k * 0.75;
  const left = pag.inner.x + (ps?.centerH ? Math.max(0, (pag.inner.w - W) / 2) : 0);
  const top = pag.inner.y + (ps?.centerV ? Math.max(0, (pag.inner.h - H) / 2) : 0);
  const content = `<div class="sp-block" style="position:absolute;left:${left}pt;top:${top}pt;transform:scale(${k});transform-origin:0 0">${out.join('')}${body}</div>`;

  // header and footer
  const m = ps?.margins ?? DEFAULT_MARGINS;
  const firstHf = isFirst && ps?.differentFirst;
  const header = firstHf ? ps?.firstHeader : ps?.header, footer = firstHf ? ps?.firstFooter : ps?.footer;
  const band = (h: HeaderFooter | undefined, where: 'top' | 'bottom', at: number) => {
    if (!h) return '';
    const parts = (['left', 'center', 'right'] as const).map((side) => {
      const runs = headerRuns(h[side], ctx).map((r) => {
        const css = [r.bold ? 'font-weight:700' : '', r.italic ? 'font-style:italic' : '', r.underline ? 'text-decoration:underline' : '', r.size ? `font-size:${r.size}pt` : '', r.font ? `font-family:'${esc(r.font)}', Calibri, Carlito, Arial, sans-serif` : '', r.sub ? 'vertical-align:sub;font-size:smaller' : '', r.sup ? 'vertical-align:super;font-size:smaller' : ''].filter(Boolean).join(';');
        return `<span${css ? ` style="${css}"` : ''}>${esc(r.text)}</span>`;
      }).join('');
      return `<div style="flex:1;text-align:${side};white-space:pre-wrap">${runs}</div>`;
    }).join('');
    return `<div class="sp-hf" style="position:absolute;left:${m.left * 72}pt;right:${m.right * 72}pt;${where}:${at * 72}pt;display:flex;gap:8pt;font:11pt Calibri, Carlito, Arial, sans-serif;color:#000">${parts}</div>`;
  };
  return `<div class="sp-page" style="position:relative;width:${pag.paper.w}pt;height:${pag.paper.h}pt;overflow:hidden;background:#fff">${content}${band(header, 'top', m.header)}${band(footer, 'bottom', m.footer)}</div>`;
}

/** The pages in a window to look through before printing (Print Preview). */
export function previewPages(printed: PrintedSheet, title: string, onPrint: () => void): void {
  const d = document.createElement('dialog');
  d.className = 'sheet-preview';
  d.setAttribute('aria-label', 'Print Preview');
  const bar = document.createElement('div');
  bar.className = 'sp-bar';
  const name = document.createElement('strong');
  name.textContent = `${title}: ${printed.pages.length} page${printed.pages.length > 1 ? 's' : ''}${printed.scale !== 1 ? `, printed at ${Math.round(printed.scale * 100)}%` : ''}`;
  const print = document.createElement('button');
  print.type = 'button';
  print.textContent = 'Print…';
  print.addEventListener('click', () => { d.close(); onPrint(); });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => d.close());
  bar.append(name, print, close);
  const list = document.createElement('div');
  list.className = 'sp-list';
  // pages drawn at about 60% of their size
  const k = Math.min(0.75, 560 / printed.w);
  printed.pages.forEach((html, i) => {
    const frame = document.createElement('div');
    frame.className = 'sp-frame';
    frame.style.width = `${printed.w * k}pt`;
    frame.style.height = `${printed.h * k}pt`;
    const inner = document.createElement('div');
    inner.style.transform = `scale(${k})`;
    inner.style.transformOrigin = '0 0';
    inner.innerHTML = html;
    const label = document.createElement('div');
    label.className = 'sp-label';
    label.textContent = `Page ${i + 1}`;
    frame.append(inner);
    list.append(frame, label);
  });
  d.append(bar, list);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

