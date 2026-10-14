// Tables formatted as Excel's "Format as Table" does: a header row, banded rows, and optionally
// banded columns, a stronger first or last column and a totals row. The looks carry Excel's own
// names (TableStyleMedium2…), so Excel draws a saved table in its version of the same style;
// here each is worked out from the Office colours, as near to Excel's as plain rules get.
// A table can also set its own header and band colours.

import type { Range } from './refs';
import type { Border, Side } from './workbook';
import { applyTint } from '../colours';

export interface TableDef {
  id: number;
  /** Excel's name for the table (Table1…): formulas don't use it here yet, but Excel needs one. */
  name: string;
  /** The whole table, header row (and totals row) included. */
  range: Range;
  /** The look's name, as Excel names it ("TableStyleMedium2"), or "none". */
  style: string;
  header: boolean;
  totals?: boolean;
  bandRows: boolean;
  bandCols?: boolean;
  firstCol?: boolean;
  lastCol?: boolean;
  /** Our own colours over the style's. */
  custom?: { header?: string; headerText?: string; band?: string };
}

/** The Office colours a style family is made in: none (black and greys), then accents 1 to 6. */
const SHADES = ['000000', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
const SHADE_NAMES = ['Black', 'Blue', 'Orange', 'Grey', 'Gold', 'Light blue', 'Green'];

type Family = 'light' | 'lightHeader' | 'lightGrid' | 'medium' | 'mediumBands' | 'mediumGrid' | 'mediumPlain' | 'dark';
const FAMILIES: { family: Family; prefix: 'Light' | 'Medium' | 'Dark'; first: number; label: string }[] = [
  { family: 'light', prefix: 'Light', first: 1, label: 'Light' },
  { family: 'lightHeader', prefix: 'Light', first: 8, label: 'Light, coloured header' },
  { family: 'lightGrid', prefix: 'Light', first: 15, label: 'Light, lines' },
  { family: 'medium', prefix: 'Medium', first: 1, label: 'Medium' },
  { family: 'mediumBands', prefix: 'Medium', first: 8, label: 'Medium, strong bands' },
  { family: 'mediumGrid', prefix: 'Medium', first: 15, label: 'Medium, lines' },
  { family: 'mediumPlain', prefix: 'Medium', first: 22, label: 'Medium, shaded' },
  { family: 'dark', prefix: 'Dark', first: 1, label: 'Dark' },
];

export interface TableStyleInfo { name: string; family: Family; shade: number; label: string; group: string }

/** Every built-in look, in the order the gallery shows them. */
export const TABLE_STYLES: TableStyleInfo[] = FAMILIES.flatMap((f) =>
  SHADES.map((_, shade) => ({ name: `TableStyle${f.prefix}${f.first + shade}`, family: f.family, shade, label: `${f.label}, ${SHADE_NAMES[shade].toLowerCase()}`, group: f.prefix })));

export const DEFAULT_TABLE_STYLE = 'TableStyleMedium2';

export function tableStyleInfo(name: string): TableStyleInfo | undefined {
  return TABLE_STYLES.find((s) => s.name === name);
}

const c = (hex: string, tint = 0) => '#' + (tint ? applyTint(hex, tint) : hex).toLowerCase();

/** What a table's style does to one of its cells. */
export interface TableCellLook {
  fill?: string;
  color?: string;
  bold?: boolean;
  borders?: Partial<Record<Side, Border>>;
}

/** The colours of one look. */
interface Palette {
  header: { fill?: string; color?: string; line?: string };
  band?: string;
  band2?: string;
  body?: { fill?: string; color?: string };
  /** Lines between rows, between all cells, and round the outside. */
  rowLine?: string;
  gridLine?: string;
  outline?: string;
  strong: string;
}

function palette(info: TableStyleInfo): Palette {
  const base = SHADES[info.shade];
  const none = info.shade === 0;
  switch (info.family) {
    case 'light':
      return { header: { color: none ? '#000000' : c(base, -0.25), line: c(base) }, band: none ? '#d9d9d9' : c(base, 0.8), body: { color: none ? undefined : c(base, -0.25) }, outline: c(base), strong: c(base) };
    case 'lightHeader':
      return { header: { fill: c(base), color: '#ffffff' }, rowLine: c(base), outline: c(base), strong: c(base) };
    case 'lightGrid':
      return { header: { line: c(base) }, band: none ? '#d9d9d9' : c(base, 0.8), gridLine: c(base), outline: c(base), strong: c(base) };
    case 'medium':
      return { header: { fill: none ? '#000000' : c(base), color: '#ffffff' }, band: none ? '#d9d9d9' : c(base, 0.8), rowLine: none ? '#666666' : c(base, 0.4), outline: none ? '#666666' : c(base, 0.4), strong: c(base) };
    case 'mediumBands':
      return { header: { fill: none ? '#000000' : c(base), color: '#ffffff' }, band: none ? '#a6a6a6' : c(base, 0.6), band2: none ? '#d9d9d9' : c(base, 0.8), gridLine: '#ffffff', strong: c(base) };
    case 'mediumGrid':
      return { header: { fill: none ? '#d9d9d9' : c(base, 0.8), color: '#000000' }, band: none ? '#d9d9d9' : c(base, 0.8), gridLine: '#000000', outline: '#000000', strong: '#000000' };
    case 'mediumPlain':
      return { header: { fill: none ? '#bfbfbf' : c(base, 0.6) }, band: none ? '#bfbfbf' : c(base, 0.6), body: { fill: none ? '#d9d9d9' : c(base, 0.8) }, gridLine: '#ffffff', strong: c(base) };
    case 'dark':
      return { header: { fill: '#000000', color: '#ffffff' }, band: none ? '#404040' : c(base, -0.5), band2: none ? '#737373' : c(base, -0.25), body: { color: '#ffffff' }, gridLine: undefined, strong: '#ffffff' };
  }
}

const thin = (color?: string): Border | undefined => (color ? { style: 'thin', color } : undefined);

/** The look a table gives one of its cells (null when the cell is outside the table or the table has no style). */
export function tableCellLook(t: TableDef, row: number, col: number, hiddenRow?: (r: number) => boolean): TableCellLook | null {
  const R = t.range;
  if (row < R.r1 || row > R.r2 || col < R.c1 || col > R.c2) return null;
  const info = tableStyleInfo(t.style);
  if (!info && !t.custom) return null;
  const p = info ? palette(info) : { header: {}, strong: '#000000' } as Palette;
  if (t.custom?.header) p.header = { ...p.header, fill: t.custom.header, color: t.custom.headerText ?? p.header.color ?? '#ffffff' };
  if (t.custom?.headerText) p.header.color = t.custom.headerText;
  if (t.custom?.band) { p.band = t.custom.band; p.band2 = undefined; }
  const out: TableCellLook = {};
  const borders: Partial<Record<Side, Border>> = {};
  const isHeader = t.header && row === R.r1;
  const isTotal = !!t.totals && row === R.r2;
  // the outline
  if (p.outline) {
    if (row === R.r1) borders.top = thin(p.outline);
    if (row === R.r2) borders.bottom = thin(p.outline);
    if (p.gridLine || info?.family === 'lightHeader') {
      if (col === R.c1) borders.left = thin(p.outline);
      if (col === R.c2) borders.right = thin(p.outline);
    }
  }
  if (p.gridLine) {
    borders.top ??= thin(p.gridLine); borders.bottom ??= thin(p.gridLine);
    borders.left ??= thin(p.gridLine); borders.right ??= thin(p.gridLine);
  }
  if (isHeader) {
    out.bold = true;
    if (p.header.fill) out.fill = p.header.fill;
    if (p.header.color) out.color = p.header.color;
    if (p.header.line) borders.bottom = thin(p.header.line);
  } else if (isTotal) {
    out.bold = true;
    borders.top = { style: 'double', color: p.strong === '#ffffff' ? '#000000' : p.strong };
    if (p.body?.fill) out.fill = p.body.fill;
    if (info?.family === 'dark') { out.fill = '#000000'; out.color = '#ffffff'; }
  } else {
    if (p.body?.fill) out.fill = p.body.fill;
    if (p.body?.color) out.color = p.body.color;
    // bands count the rows showing (a filtered table keeps its stripes)
    let i = 0;
    const first = R.r1 + (t.header ? 1 : 0);
    if (hiddenRow) { for (let r = first; r < row; r++) if (!hiddenRow(r)) i++; } else i = row - first;
    const colBand = (col - R.c1) % 2 === 0;
    if (t.bandRows && i % 2 === 0 && p.band) out.fill = p.band;
    else if (t.bandRows && p.band2) out.fill = p.band2;
    else if (t.bandCols && colBand && p.band) out.fill = p.band;
    if (p.rowLine) { borders.top ??= thin(p.rowLine); borders.bottom ??= thin(p.rowLine); }
    if ((t.firstCol && col === R.c1) || (t.lastCol && col === R.c2)) out.bold = true;
  }
  for (const k of Object.keys(borders) as Side[]) if (!borders[k]) delete borders[k];
  if (Object.keys(borders).length) out.borders = borders;
  return out;
}

let nextTableId = 1;
export function seenTableId(id: number): void {
  if (id >= nextTableId) nextTableId = id + 1;
}

/** A new table over a range. */
export function newTable(range: Range, existing: TableDef[], style = DEFAULT_TABLE_STYLE, header = true): TableDef {
  const taken = new Set(existing.map((t) => t.name.toLowerCase()));
  let n = 1;
  while (taken.has(`table${n}`)) n++;
  return { id: nextTableId++, name: `Table${n}`, range: { ...range }, style, header, bandRows: true };
}

/**
 * Header names Excel accepts: every header filled and different (Excel requires both). Blank
 * ones become Column1, Column2…, repeats get a number added.
 */
export function tableColumnNames(headers: string[]): string[] {
  const seen = new Set<string>();
  return headers.map((h, i) => {
    let name = h.replace(/[\r\n]+/g, ' ').trim() || `Column${i + 1}`;
    if (seen.has(name.toLowerCase())) {
      let k = 2;
      while (seen.has(`${name}${k}`.toLowerCase())) k++;
      name = `${name}${k}`;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}
