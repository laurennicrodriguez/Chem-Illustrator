// PowerPoint's table styles for tables on slides (and in drawings): Light, Medium and Dark
// styles, each plain or in one of the six Office accent colours, with the Table Style Options
// (header row, total row, banded rows and columns, first and last column). Each look is worked
// out here from rules as near to PowerPoint's own as plain fills and lines get, and saved to
// PowerPoint as the cells' own fills, lines and text colours, so it looks the same there.
//
// A table with no style keeps its rules (`lines`: ACS, grid or none), as before.

import type { TableData, TableLook, TextRun } from '../model';
import { applyTint } from '../colours';

type Family = 'light1' | 'light2' | 'light3' | 'medium1' | 'medium2' | 'medium3' | 'medium4' | 'dark1' | 'dark2';

const FAMILIES: { family: Family; label: string }[] = [
  { family: 'light1', label: 'Light Style 1' },
  { family: 'light2', label: 'Light Style 2' },
  { family: 'light3', label: 'Light Style 3' },
  { family: 'medium1', label: 'Medium Style 1' },
  { family: 'medium2', label: 'Medium Style 2' },
  { family: 'medium3', label: 'Medium Style 3' },
  { family: 'medium4', label: 'Medium Style 4' },
  { family: 'dark1', label: 'Dark Style 1' },
  { family: 'dark2', label: 'Dark Style 2' },
];

/** The Office colours: none (black and greys), then accents 1 to 6. */
export const ACCENTS = ['000000', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

export interface SlideTableStyle { id: string; name: string; family: Family; shade: number }

/** Every style, in the order the gallery lists them. */
export const SLIDE_TABLE_STYLES: SlideTableStyle[] = FAMILIES.flatMap((f) => ACCENTS.map((_, shade) => ({
  id: `pp-${f.family}-${shade}`, name: shade ? `${f.label} – Accent ${shade}` : f.label, family: f.family, shade,
})));

/** PowerPoint's default for a new table: Medium Style 2 – Accent 1. */
export const DEFAULT_SLIDE_TABLE_STYLE = 'pp-medium2-1';

export function slideTableStyle(id: string | undefined): SlideTableStyle | undefined {
  return id ? SLIDE_TABLE_STYLES.find((s) => s.id === id) : undefined;
}

/**
 * PowerPoint's ids of the styles PowerPoint knows by heart (the Medium Style 2 set, its default
 * and by far the most used), so a table saved with one of them comes back with its style.
 */
export const PPT_STYLE_IDS: Record<string, string> = {
  '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'pp-medium2-0',
  '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'pp-medium2-1',
  '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'pp-medium2-2',
  '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'pp-medium2-3',
  '{00A15C55-8517-42AA-B614-E9B94910E393}': 'pp-medium2-4',
  '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'pp-medium2-5',
  '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'pp-medium2-6',
};

/** A line on one side of a cell: its width in points and colour. */
export interface CellLine { w: number; color: string }
export type Side = 'top' | 'bottom' | 'left' | 'right';

/** What a table's style does to one cell. */
export interface CellLook {
  fill?: string;
  color?: string;
  bold?: boolean;
  lines: Partial<Record<Side, CellLine>>;
}

/** The style options a table has, with PowerPoint's defaults (banded rows on) where it doesn't say. */
export function lookOf(t: TableData): Required<Omit<TableLook, 'header'>> & { header: boolean } {
  const l = t.look ?? {};
  return { header: t.head > 0, total: !!l.total, bandRows: l.bandRows ?? true, firstCol: !!l.firstCol, lastCol: !!l.lastCol, bandCols: !!l.bandCols };
}

const hex = (h: string, k = 0) => '#' + (k ? applyTint(h, k) : h).toLowerCase();
const WHITE = '#ffffff', DARK = '#000000';

/**
 * How one cell of a table with a style looks: its fill, its text's colour and boldness, and its
 * lines. Null for a table without a style (or one this module doesn't know). `r` and `c` are the
 * cell's place (a joined cell takes the look of its first row and column).
 */
export function slideCellLook(t: TableData, r: number, c: number): CellLook | null {
  const st = slideTableStyle(t.style);
  if (!st) return null;
  const A = ACCENTS[st.shade];
  const o = lookOf(t);
  const n = t.rows.length, m = t.cols.length;
  const head = Math.max(0, Math.min(t.head, n));
  const isHead = r < head;
  const isTotal = o.total && r === n - 1 && !isHead;
  const firstCol = o.firstCol && c === 0, lastCol = o.lastCol && c === m - 1;
  // banded rows and columns count from the first row (and column) that isn't marked out
  const band = o.bandRows && !isHead && !isTotal && (r - head) % 2 === 0;
  const bandC = o.bandCols && !isHead && !isTotal && (c - (o.firstCol ? 1 : 0)) % 2 === 0 && !firstCol && !lastCol;
  const out: CellLook = { lines: {} };
  const line = (w: number, color: string): CellLine => ({ w, color });
  const outer = (l: CellLine) => {
    if (r === 0) out.lines.top = l;
    if (r === n - 1) out.lines.bottom = l;
    if (c === 0) out.lines.left = l;
    if (c === m - 1) out.lines.right = l;
  };
  const grid = (l: CellLine) => { out.lines.top = out.lines.bottom = out.lines.left = out.lines.right = l; };
  const strong = (fill: string, color = WHITE) => { out.fill = fill; out.color = color; out.bold = true; };
  switch (st.family) {
    case 'light1':
      if (band || bandC) out.fill = hex(A, 0.8);
      if (r === 0) out.lines.top = line(1, hex(A));
      if (r === n - 1) out.lines.bottom = line(1, hex(A));
      if (isHead) { out.bold = true; if (r === head - 1) out.lines.bottom = line(1, hex(A)); }
      if (isTotal) { out.bold = true; out.lines.top = line(1, hex(A)); }
      if (firstCol || lastCol) out.bold = true;
      break;
    case 'light2':
      outer(line(1, hex(A)));
      if (isHead) strong(hex(A));
      else if (band) { out.lines.top = line(1, hex(A)); out.lines.bottom = line(1, hex(A)); }
      if (bandC) { out.lines.left = line(1, hex(A)); out.lines.right = line(1, hex(A)); }
      if (isTotal) { out.bold = true; out.lines.top = line(2.25, hex(A)); }
      if ((firstCol || lastCol) && !isHead) out.bold = true;
      break;
    case 'light3':
      grid(line(1, hex(A)));
      if (band || bandC) out.fill = hex(A, 0.8);
      if (isHead) { out.bold = true; out.color = st.shade ? hex(A) : undefined; if (r === head - 1) out.lines.bottom = line(2.25, hex(A)); }
      if (isTotal) { out.bold = true; out.lines.top = line(2.25, hex(A)); }
      if (firstCol || lastCol) out.bold = true;
      break;
    case 'medium1':
      outer(line(1, hex(A)));
      out.lines.top ??= line(1, hex(A));
      out.lines.bottom ??= line(1, hex(A));
      if (isHead) strong(hex(A));
      else if (band || bandC) out.fill = hex(A, 0.8);
      if (isTotal) { out.bold = true; out.lines.top = line(2.25, hex(A)); }
      if ((firstCol || lastCol) && !isHead) out.bold = true;
      break;
    case 'medium2':
      out.fill = hex(A, 0.8);
      grid(line(1, WHITE));
      if (band || bandC) out.fill = hex(A, 0.6);
      if (isHead) { strong(hex(A)); if (r === head - 1) out.lines.bottom = line(3, WHITE); }
      else if (isTotal) { strong(hex(A)); out.lines.top = line(3, WHITE); }
      else if (firstCol || lastCol) strong(hex(A));
      break;
    case 'medium3':
      if (r === 0) out.lines.top = line(2.25, DARK);
      if (r === n - 1) out.lines.bottom = line(2.25, DARK);
      if (band || bandC) out.fill = '#d9d9d9';
      if (isHead) { strong(hex(A)); if (r === head - 1) out.lines.bottom = line(2.25, DARK); }
      else if (isTotal) { out.bold = true; out.lines.top = line(2.25, DARK); }
      else if (firstCol || lastCol) strong(hex(A));
      break;
    case 'medium4':
      out.fill = hex(A, 0.8);
      grid(line(1, hex(A)));
      if (band || bandC) out.fill = hex(A, 0.6);
      if (isHead) { out.fill = hex(A, 0.6); out.bold = true; out.color = st.shade ? hex(A, -0.5) : DARK; }
      else if (isTotal) { out.bold = true; out.lines.top = line(2.25, hex(A)); }
      else if (firstCol || lastCol) out.bold = true;
      break;
    case 'dark1':
      out.fill = st.shade ? hex(A, -0.25) : '#404040';
      out.color = WHITE;
      if (band || bandC) out.fill = st.shade ? hex(A, -0.5) : '#262626';
      if (isHead) { strong(DARK); if (r === head - 1) out.lines.bottom = line(2.25, WHITE); }
      else if (isTotal) { strong(DARK); out.lines.top = line(2.25, WHITE); }
      else if (firstCol || lastCol) strong(st.shade ? hex(A, -0.5) : '#262626');
      break;
    case 'dark2':
      out.fill = hex(A, 0.8);
      if (band || bandC) out.fill = hex(A, 0.6);
      if (isHead) strong(st.shade ? hex(A) : DARK);
      else if (isTotal) { out.bold = true; out.lines.top = line(2.25, DARK); }
      else if (firstCol || lastCol) out.bold = true;
      break;
  }
  return out;
}

/** A cell's text with its style's colour and boldness where its runs don't set their own. */
export function styledRuns(runs: TextRun[], look: CellLook | null): TextRun[] {
  if (!look || (!look.color && !look.bold)) return runs;
  return runs.map((x) => ({ ...x, ...(look.color && x.color === undefined ? { color: look.color } : {}), ...(look.bold && x.bold === undefined ? { bold: true } : {}) }));
}

/**
 * The opposite of styledRuns, for text coming back from PowerPoint (where the style's colours
 * and bold were written out on every run): a colour or bold the style gives anyway is dropped,
 * so the text keeps following the style.
 */
export function unstyledRuns(runs: TextRun[], look: CellLook | null): TextRun[] {
  if (!look) return runs;
  return runs.map((x) => {
    const out = { ...x };
    if (look.color && out.color?.toLowerCase() === look.color.toLowerCase()) delete out.color;
    if (look.bold && out.bold) delete out.bold;
    return out;
  });
}
