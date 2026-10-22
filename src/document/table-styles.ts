// Tables in documents, as Word draws them: a table style (Table Design > Table Styles) gives the
// lines, shading and text of the whole table and of its parts (the heading row, a total row,
// the first and last columns, banded rows and columns), and each cell can have its own borders
// and shading over the style's. The parts follow Word's table style model (ECMA-376 part 1,
// 17.7.6, w:tblStylePr), so a style is written to Word as Word's own and read back from any
// Word file.
//
// The styles here carry Word's names (Grid Table 4 - Accent 1…) and are drawn in the Office
// colours. They are worked out from those colours by plain rules, not copied from Word: a file
// saved here carries each style it uses, so Word draws the table as it is drawn here.
//
// A table with no style keeps its old choice of lines (grid, the ACS rules, or none), which is
// a style too: Table Grid, ACS, or none.

import type { BorderLine, BorderSide, CellBorders, CellMargins, TableData, TableLook } from '../model';
import { applyTint } from '../colours';
import { coveringCell, rowSpanOf, spanOf } from '../table';

/** The sides of a part a style can draw: its outside edges and the lines between its cells. */
export type StyleEdge = BorderSide | 'insideH' | 'insideV';

/** What a style does to a part of a table. */
export interface StylePart {
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  borders?: Partial<Record<StyleEdge, BorderLine>>;
}

/** The parts of a table a style can format (Word's names for them, w:tblStylePr's types). */
export type PartName = 'whole' | 'band1V' | 'band2V' | 'band1H' | 'band2H' | 'lastCol' | 'firstCol' | 'lastRow' | 'firstRow';

/** The parts from the weakest to the strongest: a part later in the list wins where they meet (Word's order). */
export const PART_ORDER: PartName[] = ['whole', 'band1V', 'band2V', 'band1H', 'band2H', 'lastCol', 'firstCol', 'lastRow', 'firstRow'];

export interface TableStyleDef {
  /** Word's style id ("GridTable4-Accent1"). */
  id: string;
  /** The name shown (Word's style name, "Grid Table 4 Accent 1"). */
  name: string;
  group: 'Plain' | 'Grid' | 'List' | 'Custom';
  parts: Partial<Record<PartName, StylePart>>;
}

/** Word's line widths are eighths of a point; these are the widths offered. */
export const BORDER_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
export const BORDER_STYLES: [BorderLine['style'], string][] = [['single', 'Single'], ['double', 'Double'], ['dotted', 'Dotted'], ['dashed', 'Dashed'], ['none', 'No border']];

/** Width of a table's lines: Word's half-point grid; the ACS rules a little heavier at the top and bottom. */
export const GRID_LINE = 0.5;
export const ACS_LINE = 0.75;

/** Room inside a table cell at the sides and above and below the text (Word's 0.075 in at the sides). */
export const CELL_PAD = { x: 5.4, y: 1.5 };
export const DEFAULT_MARGINS: CellMargins = { top: CELL_PAD.y, bottom: CELL_PAD.y, left: CELL_PAD.x, right: CELL_PAD.x };

/** A cell's margins: its own, else the table's, else the standard ones. */
export function cellMargins(t: TableData, r: number, c: number): CellMargins {
  const own = t.rows[r]?.[c]?.pad;
  const base = t.pad ?? DEFAULT_MARGINS;
  return own ? { ...base, ...own } : base;
}

export const line = (w: number, color = '#000000', style: BorderLine['style'] = 'single'): BorderLine => ({ style, w, color });
const all = (b: BorderLine): Partial<Record<StyleEdge, BorderLine>> => ({ top: b, bottom: b, left: b, right: b, insideH: b, insideV: b });

// ------------------------------------------------------------------ the gallery

/** The Office colours: no colour (black and greys), then accents 1 to 6. */
const ACCENTS = ['000000', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
const hex = (h: string, tint = 0) => '#' + (tint ? applyTint(h, tint) : h).toLowerCase();

/** A colour of a style family: its full colour, a lighter tint or a darker shade (greys for no colour). */
function shades(k: number) {
  const a = ACCENTS[k];
  if (k === 0) return { full: '#000000', mid: '#666666', light: '#999999', pale: '#cccccc', wash: '#e6e6e6', dark: '#000000' };
  return { full: hex(a), mid: hex(a, 0.4), light: hex(a, 0.6), pale: hex(a, 0.6), wash: hex(a, 0.8), dark: hex(a, -0.25) };
}

const WHITE = '#ffffff';

function gridStyle(n: number, k: number): Partial<Record<PartName, StylePart>> {
  const s = shades(k);
  switch (n) {
    case 1: return {
      whole: { borders: all(line(0.5, s.light)) },
      firstRow: { bold: true, borders: { bottom: line(1.5, s.mid) } },
      lastRow: { bold: true, borders: { top: line(1.5, s.mid, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
    };
    case 2: return {
      whole: { borders: { top: line(0.5, s.mid), bottom: line(0.5, s.mid), insideH: line(0.5, s.mid), insideV: line(0.5, s.mid) } },
      firstRow: { bold: true, borders: { top: line(0, WHITE, 'none'), bottom: line(1.5, s.mid) } },
      lastRow: { bold: true, borders: { top: line(1.5, s.mid, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
    case 3: return {
      whole: { borders: all(line(0.5, s.mid)) },
      firstRow: { bold: true, borders: { top: line(0, WHITE, 'none'), left: line(0, WHITE, 'none'), right: line(0, WHITE, 'none') } },
      lastRow: { bold: true, borders: { top: line(0.5, s.mid) } },
      firstCol: { italic: true }, lastCol: { italic: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
    case 4: return {
      whole: { borders: all(line(0.5, s.mid)) },
      firstRow: { bold: true, color: WHITE, fill: s.full, borders: { top: line(0.5, s.full), bottom: line(0.5, s.full), left: line(0.5, s.full), right: line(0.5, s.full), insideV: line(0, WHITE, 'none') } },
      lastRow: { bold: true, borders: { top: line(1.5, s.full, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
    case 5: return {
      whole: { fill: s.wash, borders: all(line(0.5, WHITE)) },
      firstRow: { bold: true, color: WHITE, fill: s.full },
      lastRow: { bold: true, color: WHITE, fill: s.full },
      firstCol: { bold: true, color: WHITE, fill: s.full }, lastCol: { bold: true, color: WHITE, fill: s.full },
      band1H: { fill: s.pale }, band1V: { fill: s.pale },
    };
    case 6: default: return {
      whole: { color: s.dark, borders: all(line(0.5, s.mid)) },
      firstRow: { bold: true, borders: { bottom: line(1.5, s.mid) } },
      lastRow: { bold: true, borders: { top: line(1.5, s.mid, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
  }
}

function listStyle(n: number, k: number): Partial<Record<PartName, StylePart>> {
  const s = shades(k);
  switch (n) {
    case 1: return {
      firstRow: { bold: true, borders: { bottom: line(0.5, s.mid) } },
      lastRow: { bold: true, borders: { top: line(0.5, s.mid) } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
    case 2: return {
      whole: { borders: { top: line(0.5, s.mid), bottom: line(0.5, s.mid), insideH: line(0.5, s.mid) } },
      firstRow: { bold: true },
      lastRow: { bold: true, borders: { top: line(1.5, s.mid, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
    case 3: return {
      whole: { borders: { top: line(1, s.full), bottom: line(1, s.full), left: line(1, s.full), right: line(1, s.full) } },
      firstRow: { bold: true, color: WHITE, fill: s.full },
      lastRow: { bold: true, borders: { top: line(1.5, s.full, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { borders: { top: line(1, s.full), bottom: line(1, s.full) } },
      band1V: { borders: { left: line(1, s.full), right: line(1, s.full) } },
    };
    case 4: return {
      whole: { borders: { top: line(0.5, s.mid), bottom: line(0.5, s.mid), left: line(0.5, s.mid), right: line(0.5, s.mid), insideH: line(0.5, s.mid) } },
      firstRow: { bold: true, color: WHITE, fill: s.full, borders: { top: line(0.5, s.full), bottom: line(0.5, s.full), left: line(0.5, s.full), right: line(0.5, s.full) } },
      lastRow: { bold: true, borders: { top: line(1.5, s.mid, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
    case 5: return {
      whole: { fill: s.full, color: WHITE, borders: { top: line(1.5, s.full), bottom: line(1.5, s.full), left: line(1.5, s.full), right: line(1.5, s.full) } },
      firstRow: { bold: true, borders: { bottom: line(1.5, WHITE) } },
      lastRow: { bold: true, borders: { top: line(0.5, WHITE) } },
      firstCol: { bold: true, borders: { right: line(0.5, WHITE) } }, lastCol: { bold: true, borders: { left: line(0.5, WHITE) } },
      band1V: { borders: { left: line(0.5, WHITE), right: line(0.5, WHITE) } },
      band1H: { borders: { top: line(0.5, WHITE), bottom: line(0.5, WHITE) } },
    };
    case 6: default: return {
      whole: { color: s.dark, borders: { top: line(0.5, s.full), bottom: line(0.5, s.full) } },
      firstRow: { bold: true, borders: { bottom: line(0.5, s.full) } },
      lastRow: { bold: true, borders: { top: line(1.5, s.full, 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: s.wash }, band1V: { fill: s.wash },
    };
  }
}

const PLAIN: TableStyleDef[] = [
  { id: 'TableGrid', name: 'Table Grid', group: 'Plain', parts: { whole: { borders: all(line(GRID_LINE)) } } },
  {
    id: 'PlainTable1', name: 'Plain Table 1', group: 'Plain', parts: {
      whole: { borders: all(line(0.5, '#bfbfbf')) },
      firstRow: { bold: true }, lastRow: { bold: true, borders: { top: line(1.5, '#bfbfbf', 'double') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: '#f2f2f2' }, band1V: { fill: '#f2f2f2' },
    },
  },
  {
    id: 'PlainTable2', name: 'Plain Table 2', group: 'Plain', parts: {
      whole: { borders: { top: line(0.5, '#7f7f7f'), bottom: line(0.5, '#7f7f7f') } },
      firstRow: { bold: true, borders: { bottom: line(0.5, '#7f7f7f') } }, lastRow: { bold: true, borders: { top: line(0.5, '#7f7f7f') } },
      firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { borders: { top: line(0.5, '#7f7f7f'), bottom: line(0.5, '#7f7f7f') } },
      band1V: { borders: { left: line(0.5, '#7f7f7f'), right: line(0.5, '#7f7f7f') } },
    },
  },
  {
    id: 'PlainTable3', name: 'Plain Table 3', group: 'Plain', parts: {
      firstRow: { bold: true, borders: { bottom: line(0.5, '#7f7f7f') } }, lastRow: { bold: true },
      firstCol: { bold: true, borders: { right: line(0.5, '#7f7f7f') } }, lastCol: { bold: true },
      band1H: { fill: '#f2f2f2' }, band1V: { fill: '#f2f2f2' },
    },
  },
  {
    id: 'PlainTable4', name: 'Plain Table 4', group: 'Plain', parts: {
      firstRow: { bold: true }, lastRow: { bold: true }, firstCol: { bold: true }, lastCol: { bold: true },
      band1H: { fill: '#f2f2f2' }, band1V: { fill: '#f2f2f2' },
    },
  },
  {
    id: 'PlainTable5', name: 'Plain Table 5', group: 'Plain', parts: {
      firstRow: { italic: true, borders: { bottom: line(0.5, '#7f7f7f') } }, lastRow: { italic: true, borders: { top: line(0.5, '#7f7f7f') } },
      firstCol: { italic: true, borders: { right: line(0.5, '#7f7f7f') } }, lastCol: { italic: true, borders: { left: line(0.5, '#7f7f7f') } },
      band1H: { fill: '#f2f2f2' }, band1V: { fill: '#f2f2f2' },
    },
  },
];

const COLOUR_NAMES = ['', ' Accent 1', ' Accent 2', ' Accent 3', ' Accent 4', ' Accent 5', ' Accent 6'];
const KINDS: Record<number, string> = { 1: ' Light', 5: ' Dark', 6: ' Colorful' };

function family(group: 'Grid' | 'List', make: (n: number, k: number) => Partial<Record<PartName, StylePart>>): TableStyleDef[] {
  const out: TableStyleDef[] = [];
  for (let n = 1; n <= 6; n++) {
    for (let k = 0; k < ACCENTS.length; k++) {
      const kind = KINDS[n] ?? '';
      out.push({
        id: `${group}Table${n}${kind.trim()}${k ? `-Accent${k}` : ''}`,
        name: `${group} Table ${n}${kind}${COLOUR_NAMES[k]}`,
        group, parts: make(n, k),
      });
    }
  }
  return out;
}

/** Every built-in style, in the order the gallery shows them. */
export const TABLE_STYLES: TableStyleDef[] = [...PLAIN, ...family('Grid', gridStyle), ...family('List', listStyle)];
const BY_ID = new Map(TABLE_STYLES.map((s) => [s.id, s]));

/** Our two looks that aren't Word styles: the ACS rules, and no lines (Word's Normal Table). */
export const ACS_STYLE = 'ACS';
export const NO_LINES = 'TableNormal';

/** The style a table is drawn in: its own (built in, or one the document keeps), else the one its lines stand for. */
export function styleOfTable(t: TableData, kept?: Record<string, TableStyleDef>): TableStyleDef {
  const own = t.style ? kept?.[t.style] ?? BY_ID.get(t.style) : undefined;
  if (own) return own;
  if (t.lines === 'grid') return BY_ID.get('TableGrid')!;
  if (t.lines === 'acs') {
    const n = t.rows.length, head = Math.max(0, Math.min(t.head, n));
    return {
      id: ACS_STYLE, name: 'ACS', group: 'Plain', parts: {
        whole: { borders: { top: line(ACS_LINE), bottom: line(ACS_LINE) } },
        ...(head > 0 && head < n ? { firstRow: { borders: { bottom: line(GRID_LINE) } } } : {}),
      },
    };
  }
  return { id: NO_LINES, name: 'No lines', group: 'Plain', parts: {} };
}

export function builtInStyle(id: string): TableStyleDef | undefined {
  return BY_ID.get(id);
}

/** Word's own choice of parts for a new table: the heading row, the first column and banded rows. */
export const DEFAULT_LOOK: Required<TableLook> = { header: true, total: false, bandRows: true, firstCol: true, lastCol: false, bandCols: false };

export function lookOfTable(t: TableData): Required<TableLook> {
  return { ...DEFAULT_LOOK, ...t.look };
}

// ------------------------------------------------------------------ working a table out

/** The text a style gives a cell (its own runs win). */
export interface CellText { bold?: boolean; italic?: boolean; color?: string }

/** A line on a table's edge, and whether it is the cell's own (not the style's). */
export interface Edge extends BorderLine { own?: boolean }

export interface ResolvedTable {
  /** Each cell's shading (its own, else its style's), by the cell's row and column. */
  fill: (string | undefined)[][];
  text: (CellText | undefined)[][];
  /** The line along the top of each row over each column (rows + 1 of them: the last is the bottom). */
  h: (Edge | null)[][];
  /** The line down the left of each column in each row (columns + 1: the last is the right side). */
  v: (Edge | null)[][];
}

/** Which rows are headings for the style: those marked, at least one (none when turned off). */
function headRows(t: TableData, def: TableStyleDef): number {
  const n = t.rows.length;
  if (def.id === ACS_STYLE || def.id === NO_LINES || def.id === 'TableGrid') return Math.min(t.head, n);
  return lookOfTable(t).header ? Math.min(n, Math.max(1, t.head)) : 0;
}

/** The parts of a style a cell is in, weakest first, each with the rows and columns it spans. */
function partsOf(t: TableData, def: TableStyleDef, r: number, c: number): { part: StylePart; r0: number; r1: number; c0: number; c1: number }[] {
  const n = t.rows.length, m = t.cols.length;
  const look = lookOfTable(t);
  const lastR = r + rowSpanOf(t, r, c) - 1, lastC = c + spanOf(t, r, c) - 1;
  const head = headRows(t, def);
  const builtin = def.id === ACS_STYLE || def.id === NO_LINES || def.id === 'TableGrid';
  const total = !builtin && look.total && n > head;
  const first = !builtin && look.firstCol, last = !builtin && look.lastCol && m > 1;
  const out: { part: StylePart; r0: number; r1: number; c0: number; c1: number }[] = [];
  for (const name of PART_ORDER) {
    const part = def.parts[name];
    if (!part) continue;
    switch (name) {
      case 'whole': out.push({ part, r0: 0, r1: n - 1, c0: 0, c1: m - 1 }); break;
      case 'firstRow': if (r < head) out.push({ part, r0: 0, r1: head - 1, c0: 0, c1: m - 1 }); break;
      case 'lastRow': if (total && lastR === n - 1) out.push({ part, r0: n - 1, r1: n - 1, c0: 0, c1: m - 1 }); break;
      case 'firstCol': if (first && c === 0) out.push({ part, r0: 0, r1: n - 1, c0: 0, c1: 0 }); break;
      case 'lastCol': if (last && lastC === m - 1) out.push({ part, r0: 0, r1: n - 1, c0: m - 1, c1: m - 1 }); break;
      case 'band1H': case 'band2H': {
        if (builtin || !look.bandRows || r < head || (total && lastR === n - 1)) break;
        if (((r - head) % 2 === 0) === (name === 'band1H')) out.push({ part, r0: r, r1: lastR, c0: 0, c1: m - 1 });
        break;
      }
      case 'band1V': case 'band2V': {
        if (builtin || !look.bandCols || (first && c === 0) || (last && lastC === m - 1)) break;
        if (((c - (first ? 1 : 0)) % 2 === 0) === (name === 'band1V')) out.push({ part, r0: 0, r1: n - 1, c0: c, c1: lastC });
        break;
      }
    }
  }
  return out;
}

/** The style's line on one side of a cell (null for none). */
function styleSide(t: TableData, def: TableStyleDef, r: number, c: number, side: BorderSide): BorderLine | null {
  const lastR = r + rowSpanOf(t, r, c) - 1, lastC = c + spanOf(t, r, c) - 1;
  let got: BorderLine | null = null;
  for (const p of partsOf(t, def, r, c)) {
    const b = p.part.borders;
    if (!b) continue;
    const edge: StyleEdge = side === 'top' ? (r === p.r0 ? 'top' : 'insideH')
      : side === 'bottom' ? (lastR === p.r1 ? 'bottom' : 'insideH')
        : side === 'left' ? (c === p.c0 ? 'left' : 'insideV') : (lastC === p.c1 ? 'right' : 'insideV');
    const x = b[edge];
    if (x) got = x.style === 'none' ? null : x;
  }
  return got;
}

/** How heavy a line looks (to choose between two cells' lines on the edge they share). */
const weight = (b: BorderLine) => (b.style === 'double' ? 3 : 1) * b.w;

/** The line on a shared edge: a cell's own line wins over a style's, then the heavier. */
function pick(a: Edge | null | undefined, b: Edge | null | undefined): Edge | null {
  const ownA = !!a?.own, ownB = !!b?.own;
  if (ownA !== ownB) return ownA ? norm(a!) : norm(b!);
  const na = a ? norm(a) : null, nb = b ? norm(b) : null;
  if (!na) return nb;
  if (!nb) return na;
  return weight(nb) > weight(na) ? nb : na;
}
const norm = (e: Edge): Edge | null => (e.style === 'none' ? null : e);

/** A cell's line on one side: its own (even 'none'), else its style's. */
function sideOf(t: TableData, def: TableStyleDef, r: number, c: number, side: BorderSide): Edge | null | undefined {
  const own = t.rows[r]?.[c]?.borders?.[side];
  if (own) return { ...own, own: true };
  const s = styleSide(t, def, r, c, side);
  return s ? { ...s } : null;
}

/** A table worked out: each cell's shading and text from its style, and every line drawn. */
export function resolveTable(t: TableData, kept?: Record<string, TableStyleDef>): ResolvedTable {
  const def = styleOfTable(t, kept);
  const n = t.rows.length, m = t.cols.length;
  const fill: ResolvedTable['fill'] = [], text: ResolvedTable['text'] = [];
  for (let r = 0; r < n; r++) {
    fill.push([]); text.push([]);
    for (let c = 0; c < m; c++) {
      const o = coveringCell(t, r, c);
      if (o.r !== r || o.c !== c) { fill[r].push(undefined); text[r].push(undefined); continue; }
      let f: string | undefined, tx: CellText | undefined;
      for (const p of partsOf(t, def, r, c)) {
        if (p.part.fill) f = p.part.fill;
        if (p.part.bold !== undefined || p.part.italic !== undefined || p.part.color) {
          tx = { ...tx };
          if (p.part.bold !== undefined) tx.bold = p.part.bold;
          if (p.part.italic !== undefined) tx.italic = p.part.italic;
          if (p.part.color) tx.color = p.part.color;
        }
      }
      fill[r].push(t.rows[r][c]?.fill ?? f);
      text[r].push(tx);
    }
  }
  const same = (a: { r: number; c: number }, b: { r: number; c: number }) => a.r === b.r && a.c === b.c;
  const h: ResolvedTable['h'] = [];
  for (let r = 0; r <= n; r++) {
    const row: (Edge | null)[] = [];
    for (let c = 0; c < m; c++) {
      const up = r > 0 ? coveringCell(t, r - 1, c) : null, down = r < n ? coveringCell(t, r, c) : null;
      if (up && down && same(up, down)) { row.push(null); continue; }
      row.push(pick(up ? sideOf(t, def, up.r, up.c, 'bottom') : null, down ? sideOf(t, def, down.r, down.c, 'top') : null));
    }
    h.push(row);
  }
  const v: ResolvedTable['v'] = [];
  for (let r = 0; r < n; r++) {
    const row: (Edge | null)[] = [];
    for (let c = 0; c <= m; c++) {
      const left = c > 0 ? coveringCell(t, r, c - 1) : null, right = c < m ? coveringCell(t, r, c) : null;
      if (left && right && same(left, right)) { row.push(null); continue; }
      row.push(pick(left ? sideOf(t, def, left.r, left.c, 'right') : null, right ? sideOf(t, def, right.r, right.c, 'left') : null));
    }
    v.push(row);
  }
  return { fill, text, h, v };
}

/** Does a table draw any line at all (a table with none shows faint gridlines on screen)? */
export function hasLines(res: ResolvedTable): boolean {
  return res.h.some((row) => row.some(Boolean)) || res.v.some((row) => row.some(Boolean));
}

// ------------------------------------------------------------------ cell borders

/** Word's Borders menu: which lines of the cells chosen get the pen's line. */
export type BorderPick = 'bottom' | 'top' | 'left' | 'right' | 'none' | 'all' | 'outside' | 'inside' | 'insideH' | 'insideV';

export const BORDER_PICKS: [BorderPick, string][] = [
  ['bottom', 'Bottom Border'], ['top', 'Top Border'], ['left', 'Left Border'], ['right', 'Right Border'],
  ['none', 'No Border'], ['all', 'All Borders'], ['outside', 'Outside Borders'], ['inside', 'Inside Borders'],
  ['insideH', 'Inside Horizontal Border'], ['insideV', 'Inside Vertical Border'],
];

/** A block of cells: rows r0 to r1 and columns c0 to c1. */
export interface CellBlock { r0: number; c0: number; r1: number; c1: number }

const setSide = (b: CellBorders | undefined, side: BorderSide, x: BorderLine | null): CellBorders | undefined => {
  const out: CellBorders = { ...b };
  if (x) out[side] = x; else delete out[side];
  return Object.keys(out).length ? out : undefined;
};

/**
 * Put a line on edges of a block of cells (Word's Borders menu). 'none' takes every line of
 * the block away, the style's too (a line of 'none'); the cells beside the block on an edge
 * changed take the same line, so both agree.
 */
export function applyBorders(t: TableData, block: CellBlock, pick: BorderPick, pen: BorderLine): TableData {
  const n = t.rows.length, m = t.cols.length;
  const noLine: BorderLine = { style: 'none', w: 0, color: pen.color };
  const changes = new Map<string, Map<BorderSide, BorderLine | null>>();
  const put = (r: number, c: number, side: BorderSide, x: BorderLine | null) => {
    if (r < 0 || c < 0 || r >= n || c >= m) return;
    const o = coveringCell(t, r, c);
    const k = `${o.r},${o.c}`;
    if (!changes.has(k)) changes.set(k, new Map());
    changes.get(k)!.set(side, x);
  };
  const wants = (side: BorderSide, outer: boolean): boolean => {
    switch (pick) {
      case 'all': case 'none': return true;
      case 'outside': return outer;
      case 'inside': return !outer;
      case 'insideH': return !outer && (side === 'top' || side === 'bottom');
      case 'insideV': return !outer && (side === 'left' || side === 'right');
      default: return outer && side === pick;
    }
  };
  const x = pick === 'none' ? noLine : pen;
  for (let r = block.r0; r <= block.r1; r++) {
    for (let c = block.c0; c <= block.c1; c++) {
      const o = coveringCell(t, r, c);
      if (o.r !== r && r !== block.r0) continue;
      if (o.c !== c && c !== block.c0) continue;
      const lastR = o.r + rowSpanOf(t, o.r, o.c) - 1, lastC = o.c + spanOf(t, o.r, o.c) - 1;
      const sides: [BorderSide, boolean, number, number, BorderSide][] = [
        ['top', o.r <= block.r0, o.r - 1, o.c, 'bottom'],
        ['bottom', lastR >= block.r1, lastR + 1, o.c, 'top'],
        ['left', o.c <= block.c0, o.r, o.c - 1, 'right'],
        ['right', lastC >= block.c1, o.r, lastC + 1, 'left'],
      ];
      for (const [side, outer, nr, nc, other] of sides) {
        if (!wants(side, outer)) continue;
        put(o.r, o.c, side, x);
        // the cell across the edge: the same line (an outside edge of the block is shared with it)
        if (outer) {
          if (side === 'top' || side === 'bottom') for (let k = o.c; k <= lastC; k++) put(nr, k, other, x);
          else for (let k = o.r; k <= lastR; k++) put(k, nc, other, x);
        }
      }
    }
  }
  return {
    ...t,
    rows: t.rows.map((row, r) => row.map((cell, c) => {
      const ch = changes.get(`${r},${c}`);
      if (!ch) return cell;
      let b = cell.borders;
      for (const [side, v] of ch) b = setSide(b, side, v);
      const out = { ...cell, borders: b };
      if (!b) delete out.borders;
      return out;
    })),
  };
}

/** Border Painter: one edge of a cell (and the cell across it) given the pen's line. */
export function paintEdge(t: TableData, r: number, c: number, side: BorderSide, pen: BorderLine): TableData {
  const o = coveringCell(t, r, c);
  const lastR = o.r + rowSpanOf(t, o.r, o.c) - 1, lastC = o.c + spanOf(t, o.r, o.c) - 1;
  const block = { r0: o.r, c0: o.c, r1: lastR, c1: lastC };
  return applyBorders(t, block, side, pen);
}

/** Take a block's own borders off, back to the style's lines. */
export function clearBorders(t: TableData, block: CellBlock): TableData {
  return {
    ...t,
    rows: t.rows.map((row, r) => row.map((cell, c) => {
      if (r < block.r0 || r > block.r1 || c < block.c0 || c > block.c1 || !cell.borders) return cell;
      const { borders: _, ...rest } = cell;
      return rest;
    })),
  };
}

/** The look of a line for drawing: its width (at least a hairline), dashes, and whether doubled. */
export function strokeOf(b: BorderLine): { w: number; dash: number[]; double: boolean } {
  const w = Math.max(0.25, b.w);
  if (b.style === 'double') return { w, dash: [], double: true };
  if (b.style === 'dotted') return { w, dash: [w, w * 1.5], double: false };
  if (b.style === 'dashed') return { w, dash: [w * 4, w * 2.5], double: false };
  return { w, dash: [], double: false };
}
