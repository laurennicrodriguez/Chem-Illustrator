// A query's results in a sheet, as Excel's Close & Load puts them: a table (Format as Table)
// named after the query, the header row holding the column names. Refresh writes the new results
// over the old, growing or shrinking the table, and keeps the formatting of the cells it covers.

import type { Sheet, Workbook } from './workbook';
import { valueInput } from './workbook';
import { type Range, MAX_ROWS, MAX_COLS, inRange, rangesOverlap, rangeName } from './refs';
import { isError, type Value } from './values';
import { newTable, DEFAULT_TABLE_STYLE, type TableDef } from './table-styles';
import { tableNameFor, type QTable, type Query } from './query';

/** How a loaded date column shows (ISO dates read the same everywhere). */
export const DATE_FORMAT = 'yyyy-mm-dd';
const PERCENT_FORMAT = '0.00%';

/** The table a query loads into, and its sheet. */
export function queryTable(wb: Workbook, q: Query): { sheet: Sheet; table: TableDef } | null {
  if (!q.table) return null;
  const low = q.table.toLowerCase();
  for (const sheet of wb.sheets) {
    const table = sheet.tables.find((t) => t.name.toLowerCase() === low);
    if (table) return { sheet, table };
  }
  return null;
}

/** The query that loads into a table, if any. */
export function queryOfTable(wb: Workbook, t: TableDef): Query | undefined {
  const low = t.name.toLowerCase();
  return wb.queries.find((q) => q.table?.toLowerCase() === low);
}

/** Every table name in the workbook (table names are the workbook's, not a sheet's). */
export function tableNames(wb: Workbook): string[] {
  return [...wb.sheets.flatMap((s) => s.tables.map((t) => t.name)), ...wb.names.map((n) => n.name)];
}

/** The cells a result takes from its top left cell: a header row, then a row for each record. */
export function resultRange(at: { row: number; col: number }, t: QTable): Range {
  return { r1: at.row, c1: at.col, r2: at.row + Math.max(1, t.rows.length), c2: at.col + Math.max(1, t.cols.length) - 1 };
}

/** Why a result can't go there (another table, a PivotTable or merged cells in the way), or null. */
export function loadProblem(s: Sheet, R: Range, own: TableDef | null): string | null {
  if (R.r2 >= MAX_ROWS) return `The results have ${R.r2 - R.r1} rows: more than fit on a sheet.`;
  if (R.c2 >= MAX_COLS) return 'The results have more columns than fit on the sheet.';
  if (s.dashboard) return 'Results can\'t go on a dashboard sheet.';
  const other = s.tables.find((t) => t.id !== own?.id && rangesOverlap(t.range, R));
  if (other) return `The results (${rangeName(R)}) would run into the table ${other.name}. Move it, or load the query somewhere else.`;
  if (s.pivots.some((p) => p.last && rangesOverlap(p.last, R))) return `The results (${rangeName(R)}) would run into a PivotTable.`;
  if (s.merges.some((m) => rangesOverlap(m, R))) return `The results (${rangeName(R)}) would cover merged cells.`;
  return null;
}

/** Do the results cover cells in use outside the table they replace? */
export function wouldCover(s: Sheet, R: Range, own: TableDef | null): boolean {
  const r2 = Math.min(R.r2, s.lastRow), c2 = Math.min(R.c2, s.lastCol);
  for (let r = R.r1; r <= r2; r++) {
    for (let c = R.c1; c <= c2; c++) {
      if (own && inRange(own.range, r, c)) continue;
      const cell = s.cell(r, c);
      if (cell?.input || cell?.structure) return true;
    }
  }
  return false;
}

/**
 * Write a query's results (inside an edit): over the table it loaded into before (`own`), or as
 * a new table with its top left cell at `at`. Returns the table, and how many values were errors
 * (left blank, as Power Query loads them).
 */
export function writeResult(s: Sheet, at: { row: number; col: number }, t: QTable, own: TableDef | null, q: Query): { table: TableDef; errors: number } {
  const R = resultRange(at, t);
  let errors = 0;
  // what the old table covered and the new one doesn't is emptied
  if (own) {
    const O = own.range;
    if (O.r2 > R.r2) s.clear({ r1: R.r2 + 1, c1: O.c1, r2: O.r2, c2: O.c2 }, 'all');
    if (O.c2 > R.c2) s.clear({ r1: O.r1, c1: R.c2 + 1, r2: Math.min(O.r2, R.r2), c2: O.c2 }, 'all');
    s.clear({ r1: O.r1, c1: O.c1, r2: Math.min(O.r2, R.r2), c2: Math.min(O.c2, R.c2) }, 'contents');
  }
  const cols = t.cols.length ? t.cols : ['Column1'];
  cols.forEach((name, j) => s.setInput(R.r1, R.c1 + j, valueInput(name)));
  t.rows.forEach((row, i) => {
    for (let j = 0; j < cols.length; j++) {
      let v: Value = row[j] ?? null;
      if (isError(v)) { errors++; v = null; }
      const r = R.r1 + 1 + i, c = R.c1 + j;
      if (v === null) { if (s.cell(r, c)?.input || s.cell(r, c)?.structure) s.setInput(r, c, ''); continue; }
      s.setInput(r, c, valueInput(v));
    }
  });
  // dates and percentages show as such
  t.types.forEach((k, j) => {
    if (k !== 'date' && k !== 'percent') return;
    if (!t.rows.length) return;
    s.patchStyle({ r1: R.r1 + 1, c1: R.c1 + j, r2: R.r2, c2: R.c1 + j }, { numFmt: k === 'date' ? DATE_FORMAT : PERCENT_FORMAT });
  });
  let table: TableDef;
  if (own) {
    table = { ...own, range: R };
    s.setTables(s.tables.map((x) => (x.id === own.id ? table : x)));
    if (s.filter && JSON.stringify(s.filter.range) === JSON.stringify(own.range)) s.setFilter({ range: R, conditions: {} });
  } else {
    const name = tableNameFor(q.name, tableNames(s.wb));
    table = { ...newTable(R, s.tables, DEFAULT_TABLE_STYLE, true), name };
    s.setTables([...s.tables, table]);
    if (!s.filter) s.setFilter({ range: R, conditions: {} });
  }
  return { table, errors };
}

/** Column widths for a new load: wide enough for the header and the first rows' text, within reason. */
export function fitWidths(s: Sheet, at: { row: number; col: number }, t: QTable): void {
  t.cols.forEach((name, j) => {
    let chars = name.length + 3;
    for (const row of t.rows.slice(0, 100)) {
      const v = row[j];
      const len = typeof v === 'string' ? v.length : typeof v === 'number' ? (t.types[j] === 'date' ? 10 : String(v).length) : 5;
      chars = Math.max(chars, len);
    }
    const px = Math.min(300, Math.max(64, Math.round(chars * 7.5 + 10)));
    if (px > 70) s.setColWidth(at.col + j, px);
  });
}
