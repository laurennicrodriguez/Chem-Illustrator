// Tables in drawings and on slides: a grid of text cells, with a title above and footnotes
// below, drawn in the ACS style unless chosen otherwise (a rule above and below the heading
// rows and one under the last row, no vertical lines; ACS Style Guide, 3rd ed., ch. 15). Every
// cell is laid out by the same text engine as captions, so it wraps, takes subscripts and
// lists, and is typed into the same way.
//
// Positions in a layout are in points from the table's top left corner (the top of its title,
// or of its first rule when it has no title).

import type { Justify, TableCell, TableData, TextRun } from './model';
import { layoutText, type Measure, type TextLayout } from './text/layout';
import { drawLayout } from './text/draw';
import type { Rect, Vec } from './geom';

/** Some text of the table and where its origin (the left end of the first baseline) is. */
export interface PlacedText { lay: TextLayout; x: number; y: number }

export interface TableLayout {
  /** Text size for runs that don't give one. */
  size: number;
  /** Room left and right of the text in a cell, and above and below it. */
  padX: number;
  padY: number;
  /** Left edge of each column, and the right edge of the last one. */
  xs: number[];
  /** Top of each row, and the bottom of the last one. */
  ys: number[];
  /** Each cell's text (null for the cells a spanning cell covers). */
  cells: (PlacedText | null)[][];
  title: PlacedText | null;
  notes: PlacedText | null;
  width: number;
  height: number;
}

/** Which part of a table: a cell, the title or the footnotes. */
export type TablePart = { r: number; c: number } | 'title' | 'notes';

/** Room round the text of a cell, as fractions of the text size. */
const PAD_X = 0.4;
const PAD_Y = 0.25;
/** Space between the title or the footnotes and the rules. */
const GAP = 0.35;
/** Footnotes are set a little smaller than the table, as journals print them. */
export const NOTE_SCALE = 0.8;

export const tableSize = (t: TableData, defaultSize: number): number => t.size ?? defaultSize;

/** How a cell lines up: its own choice, its column's, or left for the first column and centred for the rest. */
export function cellAlign(t: TableData, r: number, c: number): Justify {
  return t.rows[r]?.[c]?.align ?? t.align?.[c] ?? (c === 0 ? 'left' : 'center');
}

/** For each column of a row, the column of the cell that shows there (a spanning cell covers the ones to its right). */
export function rowOwners(t: TableData, r: number): number[] {
  const n = t.cols.length;
  const out: number[] = [];
  for (let c = 0; c < n;) {
    const s = Math.max(1, Math.min(Math.floor(t.rows[r]?.[c]?.span ?? 1), n - c));
    for (let k = 0; k < s; k++) out.push(c);
    c += s;
  }
  return out;
}

/** How many columns a cell covers (never past the last column; 1 for a covered cell). */
export function spanOf(t: TableData, r: number, c: number): number {
  const o = rowOwners(t, r);
  if (o[c] !== c) return 1;
  let k = c + 1;
  while (k < o.length && o[k] === c) k++;
  return k - c;
}

/** The cell that shows at a place: itself, or the spanning cell that covers it. */
export function coveringCell(t: TableData, r: number, c: number): { r: number; c: number } {
  return { r, c: rowOwners(t, r)[c] ?? c };
}

/** Is this cell hidden under a spanning cell to its left? */
export function isCovered(t: TableData, r: number, c: number): boolean {
  return (rowOwners(t, r)[c] ?? c) !== c;
}

export function layoutTable(t: TableData, defaultSize: number, measure: Measure): TableLayout {
  const size = tableSize(t, defaultSize);
  const padX = PAD_X * size, padY = PAD_Y * size;
  const xs = [0];
  for (const w of t.cols) xs.push(xs[xs.length - 1] + w);
  const width = xs[xs.length - 1];
  const gap = GAP * size;

  let y = 0;
  let title: PlacedText | null = null;
  if (t.title?.some((r) => r.text)) {
    const lay = layoutText({ runs: t.title, justify: 'left', wrap: width }, size, measure);
    title = { lay, x: 0, y: -lay.box.y1 };
    y = lay.box.y2 - lay.box.y1 + gap;
  }
  const ys = [y];
  const cells: (PlacedText | null)[][] = [];
  t.rows.forEach((row, r) => {
    const out: (PlacedText | null)[] = [];
    let h = 1.05 * size;
    for (let c = 0; c < t.cols.length; c++) {
      if (isCovered(t, r, c)) { out.push(null); continue; }
      const cell = row[c] ?? { runs: [] };
      const span = spanOf(t, r, c);
      const wrap = Math.max(1, xs[c + span] - xs[c] - 2 * padX);
      const lay = layoutText({ runs: cell.runs, paras: cell.paras, justify: cellAlign(t, r, c), wrap }, size, measure);
      out.push({ lay, x: xs[c] + padX, y: 0 });
      h = Math.max(h, lay.box.y2 - lay.box.y1);
    }
    // every cell's first line starts at the top of its row
    for (const p of out) if (p) p.y = y + padY - p.lay.box.y1;
    cells.push(out);
    y += h + 2 * padY;
    ys.push(y);
  });
  let notes: PlacedText | null = null;
  if (t.notes?.some((r) => r.text)) {
    const lay = layoutText({ runs: t.notes, justify: 'left', wrap: width }, size * NOTE_SCALE, measure);
    y += gap;
    notes = { lay, x: 0, y: y - lay.box.y1 };
    y += lay.box.y2 - lay.box.y1;
  }
  return { size, padX, padY, xs, ys, cells, title, notes, width, height: y };
}

/** The rules of a table, as lines from (x1, y) to (x2, y) or (x, y1) to (x, y2), in layout points. */
export function tableRules(t: TableData, lay: TableLayout): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const { xs, ys } = lay;
  const left = 0, right = lay.width;
  const n = t.rows.length;
  const h = (y: number, x1 = left, x2 = right) => out.push({ x1, y1: y, x2, y2: y });
  if (t.lines === 'none' || !n) return out;
  if (t.lines === 'grid') {
    for (let r = 0; r <= n; r++) h(ys[r]);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c <= t.cols.length; c++) {
        if (c > 0 && c < t.cols.length && isCovered(t, r, c)) continue;
        out.push({ x1: xs[c], y1: ys[r], x2: xs[c], y2: ys[r + 1] });
      }
    }
    return out;
  }
  // ACS: above the headings, below them, and under the last row
  h(ys[0]);
  const head = Math.max(0, Math.min(t.head, n));
  if (head > 0 && head < n) h(ys[head]);
  h(ys[n]);
  // a heading that spans several columns gets a short rule under it (a straddle rule)
  for (let r = 0; r < head; r++) {
    for (let c = 0; c < t.cols.length; c++) {
      const span = spanOf(t, r, c);
      if (span < 2 || isCovered(t, r, c) || r + 1 === head) continue;
      h(ys[r + 1], xs[c] + lay.padX, xs[c + span] - lay.padX);
    }
  }
  return out;
}

/**
 * Draw a table with its top left corner at (ox, oy). `hide` leaves out the part being typed
 * into (the text editor draws it); `lw` is the drawing's line width.
 */
export function drawTable(ctx: CanvasRenderingContext2D, t: TableData, lay: TableLayout, ox: number, oy: number, lw: number, color: string | undefined, hide?: TablePart | null): void {
  ctx.save();
  ctx.strokeStyle = color ?? '#000';
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const l of tableRules(t, lay)) {
    ctx.moveTo(ox + l.x1, oy + l.y1);
    ctx.lineTo(ox + l.x2, oy + l.y2);
  }
  ctx.stroke();
  ctx.restore();
  const same = (p: TablePart) => hide && (typeof hide === 'string' ? hide === p : typeof p !== 'string' && hide.r === p.r && hide.c === p.c);
  if (lay.title && !same('title')) drawLayout(ctx, lay.title.lay, ox + lay.title.x, oy + lay.title.y);
  lay.cells.forEach((row, r) => row.forEach((p, c) => {
    if (p && !same({ r, c })) drawLayout(ctx, p.lay, ox + p.x, oy + p.y);
  }));
  if (lay.notes && !same('notes')) drawLayout(ctx, lay.notes.lay, ox + lay.notes.x, oy + lay.notes.y);
}

/** Which part of the table a point (in layout points) is on, if any. */
export function partAt(t: TableData, lay: TableLayout, p: Vec): TablePart | null {
  if (p.x < 0 || p.x > lay.width || p.y < 0 || p.y > lay.height) return null;
  const { xs, ys } = lay;
  if (p.y < ys[0]) return lay.title ? 'title' : t.rows.length ? { r: 0, c: colAt(xs, p.x) } : null;
  if (p.y >= ys[ys.length - 1]) return lay.notes ? 'notes' : t.rows.length ? { r: t.rows.length - 1, c: colAt(xs, p.x) } : null;
  let r = 0;
  while (r < t.rows.length - 1 && p.y >= ys[r + 1]) r++;
  return coveringCell(t, r, colAt(xs, p.x));
}

function colAt(xs: number[], x: number): number {
  let c = 0;
  while (c < xs.length - 2 && x >= xs[c + 1]) c++;
  return c;
}

/** The area of a cell (with any columns it spans), in layout points. */
export function cellRect(t: TableData, lay: TableLayout, r: number, c: number): Rect {
  return { x1: lay.xs[c], y1: lay.ys[r], x2: lay.xs[c + spanOf(t, r, c)], y2: lay.ys[r + 1] };
}

/** The runs of a part of the table. */
export function partRuns(t: TableData, part: TablePart): { runs: TextRun[]; paras?: TableCell['paras'] } {
  if (part === 'title') return { runs: t.title ?? [] };
  if (part === 'notes') return { runs: t.notes ?? [] };
  const cell = t.rows[part.r]?.[part.c];
  return { runs: cell?.runs ?? [], paras: cell?.paras };
}

// ------------------------------------------------------------------ making and changing tables

const emptyCell = (): TableCell => ({ runs: [] });
const cleanRuns = (runs: TextRun[]): TextRun[] => runs.filter((r) => r.text);

/** A table of plain text, with the first row as its headings; columns fit their text. */
export function tableFromText(rows: string[][], measure: Measure, size: number, opts: { head?: number } = {}): TableData {
  const n = Math.max(1, ...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: n }, (_, c): TableCell => ({ runs: r[c] ? [{ text: r[c] }] : [] })));
  return fitColumns({ cols: Array(n).fill(size * 4), rows: cells, head: opts.head ?? (rows.length > 1 ? 1 : 0), lines: 'acs' }, measure, size);
}

/** A table of rich-text cells (as pasted), with the first row as its headings. */
export function tableFromCells(rows: { runs: TextRun[]; span?: number }[][], measure: Measure, size: number, opts: { head?: number } = {}): TableData {
  const n = Math.max(1, ...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: n }, (_, c): TableCell => {
    const x = r[c];
    return x?.span && x.span > 1 ? { runs: cleanRuns(x.runs), span: x.span } : { runs: cleanRuns(x?.runs ?? []) };
  }));
  return fitColumns({ cols: Array(n).fill(size * 4), rows: cells, head: opts.head ?? (rows.length > 1 ? 1 : 0), lines: 'acs' }, measure, size);
}

/** An empty table of a number of rows and columns, with one heading row. */
export function emptyTable(rows: number, cols: number, size: number): TableData {
  return {
    cols: Array(cols).fill(Math.round(size * 6)),
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, emptyCell)),
    head: rows > 1 ? 1 : 0,
    lines: 'acs',
  };
}

/** Columns as wide as their longest line (a long text is held to a sensible width and wraps). */
export function fitColumns(t: TableData, measure: Measure, defaultSize: number, maxWidth = 40 * tableSize(t, defaultSize)): TableData {
  const size = tableSize(t, defaultSize);
  const pad = 2 * PAD_X * size;
  const cols = t.cols.map((_, c) => {
    let w = size * 2;
    t.rows.forEach((row, r) => {
      const cell = row[c];
      if (!cell || isCovered(t, r, c) || spanOf(t, r, c) > 1) return;
      const lay = layoutText({ runs: cell.runs, paras: cell.paras, justify: 'left' }, size, measure);
      w = Math.max(w, lay.boxWidth);
    });
    return Math.ceil(Math.min(w, maxWidth) + pad);
  });
  return { ...t, cols };
}

export function setPart(t: TableData, part: TablePart, text: { runs: TextRun[]; paras?: TableCell['paras'] }): TableData {
  const runs = cleanRuns(text.runs);
  if (part === 'title') return { ...t, title: runs.length ? runs : undefined };
  if (part === 'notes') return { ...t, notes: runs.length ? runs : undefined };
  const rows = t.rows.map((row, r) => r !== part.r ? row : row.map((cell, c) => {
    if (c !== part.c) return cell;
    const out: TableCell = { ...cell, runs };
    if (text.paras?.some((p) => Object.keys(p).length)) out.paras = text.paras; else delete out.paras;
    return out;
  }));
  return { ...t, rows };
}

export function insertRow(t: TableData, at: number): TableData {
  const rows = [...t.rows];
  rows.splice(at, 0, t.cols.map(emptyCell));
  // a row put in among the headings is a heading too
  return { ...t, rows, head: at < t.head ? t.head + 1 : t.head };
}

export function deleteRow(t: TableData, r: number): TableData {
  if (t.rows.length <= 1) return t;
  const rows = t.rows.filter((_, k) => k !== r);
  return { ...t, rows, head: r < t.head ? t.head - 1 : t.head };
}

export function insertColumn(t: TableData, at: number, width = t.cols[Math.max(0, Math.min(at, t.cols.length - 1))] ?? 60): TableData {
  const cols = [...t.cols];
  cols.splice(at, 0, width);
  const rows = t.rows.map((row) => {
    const out = [...row];
    // a spanning cell the new column falls inside stretches over it
    for (let c = 0; c < at && c < out.length; c++) {
      const s = out[c].span ?? 1;
      if (s > 1 && c + s > at) out[c] = { ...out[c], span: s + 1 };
    }
    out.splice(at, 0, emptyCell());
    return out;
  });
  const align = t.align ? [...t.align] : undefined;
  align?.splice(at, 0, 'center');
  return { ...t, cols, rows, align };
}

export function deleteColumn(t: TableData, c: number): TableData {
  if (t.cols.length <= 1) return t;
  const rows = t.rows.map((row) => {
    const out = [...row];
    for (let k = 0; k < c && k < out.length; k++) {
      const s = out[k].span ?? 1;
      if (s > 1 && k + s > c) out[k] = { ...out[k], span: s - 1 > 1 ? s - 1 : undefined };
    }
    // a spanning cell that is deleted hands its text to the next one
    const gone = out[c];
    if (gone?.span && gone.span > 1 && out[c + 1]) out[c + 1] = { ...gone, span: gone.span - 1 > 1 ? gone.span - 1 : undefined };
    out.splice(c, 1);
    return out.map((cell) => (cell.span === undefined ? cell : tidySpan(cell)));
  });
  const align = t.align?.filter((_, k) => k !== c);
  return { ...t, cols: t.cols.filter((_, k) => k !== c), rows, align };
}

function tidySpan(cell: TableCell): TableCell {
  if (cell.span && cell.span > 1) return cell;
  const { span: _, ...rest } = cell;
  return rest;
}

/** Join a cell with the next ones to its right (or split it again with span 1). */
export function setSpan(t: TableData, r: number, c: number, span: number): TableData {
  const s = Math.max(1, Math.min(Math.floor(span), t.cols.length - c));
  const rows = t.rows.map((row, k) => k !== r ? row : row.map((cell, j) => j === c ? tidySpan({ ...cell, span: s }) : cell));
  return { ...t, rows };
}

export function setColumnWidth(t: TableData, c: number, w: number): TableData {
  const cols = [...t.cols];
  cols[c] = Math.max(4, w);
  return { ...t, cols };
}

export function setColumnAlign(t: TableData, c: number, a: Justify): TableData {
  const align = t.cols.map((_, k) => t.align?.[k] ?? (k === 0 ? 'left' : 'center'));
  align[c] = a;
  // the cells of the column take it too
  const rows = t.rows.map((row) => row.map((cell, k) => {
    if (k !== c || !cell.align) return cell;
    const { align: _, ...rest } = cell;
    return rest;
  }));
  return { ...t, align, rows };
}

/** The table's text as rows of plain text (for copying as tab-separated text). */
export function tableText(t: TableData): string[][] {
  return t.rows.map((row) => row.map((cell) => cell.runs.map((r) => r.text).join('')));
}

/** The next cell after (or before) one, row by row, skipping covered cells; null past either end. */
export function nextCell(t: TableData, r: number, c: number, back = false): { r: number; c: number } | null {
  const n = t.cols.length;
  let i = r * n + c;
  for (;;) {
    i += back ? -1 : 1;
    if (i < 0 || i >= t.rows.length * n) return null;
    const rr = Math.floor(i / n), cc = i % n;
    if (!isCovered(t, rr, cc)) return { r: rr, c: cc };
  }
}
