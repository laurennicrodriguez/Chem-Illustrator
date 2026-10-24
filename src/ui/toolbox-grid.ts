// A toolbox's buttons on a grid of fixed cells (Customize Toolboxes): so many columns by so many
// rows, each button in the cell it was put in, and cells left empty to keep groups apart. A thin
// line can run between two rows. The toolbox on screen uses the same grid, turned on its side when
// a tall one is docked along the top or bottom (or a wide one down a side). When the window is too
// short for it, the toolbox scrolls, or wraps its rows into extra columns, as each one is set to.
// The fly-out palettes have grids of their own, of tool names.

/** A grid of buttons: `cells` row by row, null where a cell is empty. */
export interface Grid {
  cols: number;
  rows: number;
  cells: (string | null)[];
  /** Rows with a thin line above them (1 … rows − 1). */
  lines?: number[];
}

export const MAX_COLS = 20;
export const MAX_ROWS = 60;

/** Sizes offered in Customize Toolboxes (any other can be typed in). */
export const GRID_PRESETS: readonly { cols: number; rows: number; label: string }[] = [
  { cols: 2, rows: 12, label: '2 × 12 (a tall strip, like the drawing tools)' },
  { cols: 3, rows: 8, label: '3 × 8' },
  { cols: 4, rows: 4, label: '4 × 4 (square)' },
  { cols: 6, rows: 3, label: '6 × 3' },
  { cols: 8, rows: 2, label: '8 × 2 (a wide strip)' },
  { cols: 12, rows: 1, label: '12 × 1 (one row)' },
];

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));

/** An empty grid. */
export function emptyGrid(cols: number, rows: number): Grid {
  cols = clampInt(cols, 1, MAX_COLS);
  rows = clampInt(rows, 1, MAX_ROWS);
  return { cols, rows, cells: Array(cols * rows).fill(null) };
}

/**
 * A grid from a list of buttons as toolboxes used to keep them, packed in order: each group
 * (between "sep" dividers) starts a new row, with a line above it. `cols` unset: as wide as the
 * longest group (at most 8), so each group takes one row.
 */
export function listToGrid(list: readonly string[], cols?: number): Grid {
  const groups: string[][] = [[]];
  for (const k of list) { if (k === 'sep') { if (groups[groups.length - 1].length) groups.push([]); } else groups[groups.length - 1].push(k); }
  if (!groups[groups.length - 1].length && groups.length > 1) groups.pop();
  const c = clampInt(cols ?? Math.min(8, Math.max(1, ...groups.map((g) => g.length))), 1, MAX_COLS);
  const cells: (string | null)[] = [];
  const lines: number[] = [];
  groups.forEach((g, i) => {
    if (i) lines.push(cells.length / c);
    const n = Math.max(1, Math.ceil(g.length / c)) * c;
    for (let j = 0; j < n; j++) cells.push(g[j] ?? null);
  });
  const rows = Math.min(MAX_ROWS, cells.length / c);
  return { cols: c, rows, cells: cells.slice(0, rows * c), ...(lines.length ? { lines: lines.filter((r) => r < rows) } : {}) };
}

/** The buttons in a grid, in reading order. */
export function gridItems(g: Grid): string[] {
  return g.cells.filter((x): x is string => !!x);
}

/** The grid at a new size: each button stays in its cell; those beyond the new edges go (see `cutOff`). */
export function resized(g: Grid, cols: number, rows: number): Grid {
  const n = emptyGrid(cols, rows);
  for (let r = 0; r < Math.min(g.rows, n.rows); r++) for (let c = 0; c < Math.min(g.cols, n.cols); c++) n.cells[r * n.cols + c] = g.cells[r * g.cols + c] ?? null;
  const lines = g.lines?.filter((r) => r > 0 && r < n.rows);
  return lines?.length ? { ...n, lines } : n;
}

/**
 * The grid without the buttons `keep` turns away (ones the app no longer has): within each block
 * of rows between lines, the buttons after one close up into its cell, and rows left empty by
 * that go. Cells left empty on purpose stay where they are relative to their neighbours.
 */
export function withoutGone(g: Grid, keep: (k: string) => boolean): Grid {
  if (g.cells.every((k) => !k || keep(k))) return g;
  const starts = [0, ...(g.lines ?? []).filter((r) => r > 0 && r < g.rows).sort((a, b) => a - b), g.rows];
  const cells: (string | null)[] = [];
  const lines: number[] = [];
  const emptyRows = (row: (string | null)[]) => { let n = 0; for (let r = row.length / g.cols - 1; r >= 0 && row.slice(r * g.cols, (r + 1) * g.cols).every((k) => !k); r--) n++; return n; };
  for (let i = 0; i + 1 < starts.length; i++) {
    if (starts[i] === starts[i + 1]) continue;
    const block = g.cells.slice(starts[i] * g.cols, starts[i + 1] * g.cols);
    const kept = block.filter((k) => !k || keep(k));
    const after = [...kept, ...Array(block.length - kept.length).fill(null)];
    // only the rows that emptied go (a block that was empty at its end stays so)
    const drop = Math.min(emptyRows(after) - emptyRows(block), block.length / g.cols - 1);
    if (cells.length) lines.push(cells.length / g.cols);
    cells.push(...after.slice(0, after.length - drop * g.cols));
  }
  const rows = cells.length / g.cols;
  return { cols: g.cols, rows, cells, ...(lines.length ? { lines } : {}) };
}

/** The buttons a new size would cut off. */
export function cutOff(g: Grid, cols: number, rows: number): string[] {
  const out: string[] = [];
  g.cells.forEach((k, i) => { if (k && (i % g.cols >= cols || Math.floor(i / g.cols) >= rows)) out.push(k); });
  return out;
}

/** A button put in a cell. One already in the grid moves there (they swap when the cell is taken); one new pushes what is there to the next empty cell. Null when no cell is free for it. */
export function placed(g: Grid, key: string, at: number): Grid | null {
  if (at < 0 || at >= g.cells.length) return null;
  const cells = g.cells.slice();
  const from = cells.indexOf(key);
  if (from === at) return g;
  if (from >= 0) {
    cells[from] = cells[at];
    cells[at] = key;
    return { ...g, cells };
  }
  const there = cells[at];
  cells[at] = key;
  if (there) {
    const free = nextFree(cells, at);
    if (free < 0) return null;
    cells[free] = there;
  }
  return { ...g, cells };
}

/** The first empty cell from `at` on (going round to the start), or -1. */
export function nextFree(cells: readonly (string | null)[], at = 0): number {
  for (let j = 0; j < cells.length; j++) { const i = (at + j) % cells.length; if (!cells[i]) return i; }
  return -1;
}

/** A button added at the first empty cell, with a row added when the grid is full. */
export function added(g: Grid, key: string): Grid {
  if (g.cells.includes(key)) return g;
  let n = g;
  if (nextFree(n.cells) < 0) n = resized(n, n.cols, Math.min(MAX_ROWS, n.rows + 1));
  const i = nextFree(n.cells);
  if (i < 0) return g;
  const cells = n.cells.slice();
  cells[i] = key;
  return { ...n, cells };
}

/** The button in a cell taken out (the cell is left empty). */
export function emptied(g: Grid, at: number): Grid {
  const cells = g.cells.slice();
  cells[at] = null;
  return { ...g, cells };
}

/** The line above a row put in or taken away. */
export function withLine(g: Grid, row: number, on: boolean): Grid {
  const lines = new Set(g.lines ?? []);
  if (on && row > 0 && row < g.rows) lines.add(row); else lines.delete(row);
  const l = [...lines].sort((a, b) => a - b);
  const n: Grid = { ...g, lines: l };
  if (!l.length) delete n.lines;
  return n;
}

/** A grid read from the settings file, keeping only what makes sense (null when it is no grid). */
export function parseGrid(raw: unknown, valid: (key: string) => boolean): Grid | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.cols !== 'number' || typeof r.rows !== 'number' || !Array.isArray(r.cells)) return null;
  const g = emptyGrid(r.cols, r.rows);
  const seen = new Set<string>();
  (r.cells as unknown[]).slice(0, g.cells.length).forEach((k, i) => {
    if (typeof k === 'string' && valid(k) && k !== 'sep' && !seen.has(k)) { seen.add(k); g.cells[i] = k; }
  });
  const lines = Array.isArray(r.lines) ? [...new Set((r.lines as unknown[]).filter((x): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) < g.rows))].sort((a, b) => a - b) : [];
  return lines.length ? { ...g, lines } : g;
}

// ------------------------------------------------------------------ the grid on screen

/** Where a grid shows: how it is turned, and the cells' places before any wrapping. */
export interface Shown {
  /** Columns and rows on screen (swapped when turned). */
  cols: number;
  rows: number;
  /** Each cell's place on screen, in the order of the grid's cells. */
  at: { r: number; c: number }[];
  /** Turned on its side. */
  turned: boolean;
  /** Rows on screen with a line above them, and columns with one to their left (when turned). */
  lineRows: number[];
  lineCols: number[];
}

/** A grid as it shows in a dock: a tall one turned on its side along the top or bottom, a wide one down a side. */
export function shownGrid(g: Grid, dock: string): Shown {
  const turned = ((dock === 'top' || dock === 'bottom') && g.rows > g.cols) || ((dock === 'left' || dock === 'right') && g.cols > g.rows);
  const at = g.cells.map((_, i) => { const r = Math.floor(i / g.cols), c = i % g.cols; return turned ? { r: c, c: r } : { r, c }; });
  const lines = g.lines ?? [];
  return turned
    ? { cols: g.rows, rows: g.cols, at, turned, lineRows: [], lineCols: lines }
    : { cols: g.cols, rows: g.rows, at, turned, lineRows: lines, lineCols: [] };
}

/**
 * Where the blocks of a wrapped grid start, along its `n` rows (or columns) with room for `fit`:
 * each block as long as there is room for, ending before a line between groups where one falls
 * inside it, so groups stay whole.
 */
export function wrapStarts(n: number, fit: number, lines: readonly number[] = []): number[] {
  const f = Math.max(1, fit);
  const starts = [0];
  for (let at = 0; at + f < n;) {
    // (a group longer than the room is cut where the room ends)
    const breaks = lines.filter((l) => l > at && l <= at + f);
    const next = breaks.length ? Math.max(...breaks) : at + f;
    starts.push(next);
    at = next;
  }
  return starts;
}

/** Which block a row (or column) falls in, and where it is in that block. */
export function inBlock(starts: readonly number[], i: number): { b: number; i: number } {
  let b = 0;
  while (b + 1 < starts.length && starts[b + 1] <= i) b++;
  return { b, i: i - starts[b] };
}

/**
 * Where each cell goes when the grid wraps: with only `fit` rows to spare (`across` false), the
 * rows past that go into another block of columns beside the first, and so on; with only `fit`
 * columns (`across` true, docked along the top or bottom), the columns past it go into another
 * block of rows below. Blocks break between groups where they can (see wrapStarts). Places are
 * counted from 0; `start` marks a cell beginning a new block.
 */
export function wrapped(s: Shown, fit: number, across: boolean): { at: { r: number; c: number; start: boolean }[]; starts: number[] } {
  const starts = across ? wrapStarts(s.cols, fit, s.lineCols) : wrapStarts(s.rows, fit, s.lineRows);
  const at = s.at.map(({ r, c }) => {
    if (!across) { const k = inBlock(starts, r); return { r: k.i, c: k.b * s.cols + c, start: k.b > 0 && c === 0 }; }
    const k = inBlock(starts, c);
    return { r: k.b * s.rows + r, c: k.i, start: k.b > 0 && r === 0 };
  });
  return { at, starts };
}
