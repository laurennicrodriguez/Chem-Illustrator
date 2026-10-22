// PivotTables, as Excel makes them: a summary of a table of records (a header row of field names,
// then a row per record), with fields dragged to Rows, Columns, Values and Filters. The report
// is written into the sheet's cells, as Excel's is, and refreshed from the source on request.
// Each value field adds up (or counts, averages, …) the records that fall under its row and
// column, with subtotals and grand totals, and can show its numbers as a share of the grand total,
// of its row or of its column. A PivotChart charts the report and follows it when it refreshes.

import type { Value } from './values';
import { ERR, isError } from './values';
import type { CellStyle } from './workbook';
import type { Range } from './refs';

export type PivotFn = 'sum' | 'count' | 'average' | 'max' | 'min' | 'product' | 'countNums' | 'stdDev' | 'stdDevp' | 'var' | 'varp';
export type ShowAs = 'normal' | 'percentOfTotal' | 'percentOfRow' | 'percentOfCol';

/** Excel's names for each summary, as the value fields' captions use them ("Sum of Yield"). */
export const PIVOT_FN_NAMES: Record<PivotFn, string> = {
  sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min', product: 'Product', countNums: 'Count',
  stdDev: 'StdDev', stdDevp: 'StdDevp', var: 'Var', varp: 'Varp',
};

/** What each summary is called in menus. */
export const PIVOT_FN_LABELS: Record<PivotFn, string> = {
  sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min', product: 'Product', countNums: 'Count Numbers',
  stdDev: 'StdDev', stdDevp: 'StdDevp', var: 'Var', varp: 'Varp',
};

export const SHOW_AS_LABELS: Record<ShowAs, string> = {
  normal: 'No Calculation', percentOfTotal: '% of Grand Total', percentOfRow: '% of Row Total', percentOfCol: '% of Column Total',
};

export interface PivotValueField {
  field: string;
  fn: PivotFn;
  /** Its caption (unset: "Sum of Yield"). */
  name?: string;
  showAs?: ShowAs;
  numFmt?: string;
}

export type PivotLayout = 'compact' | 'outline' | 'tabular';

export interface PivotTable {
  id: number;
  /** "PivotTable1". */
  name: string;
  /** The records, as a reference with its header row ("=Sheet1!$A$1:$D$40"), or a table's or defined name's name. */
  source: string;
  /** The report's top-left cell (its filters sit at the top, with a blank row under them). */
  at: { row: number; col: number };
  rows: string[];
  cols: string[];
  values: PivotValueField[];
  filters: string[];
  /** Items left out, by field (unticked in a filter or the field's drop-down). */
  hidden: Record<string, string[]>;
  layout: PivotLayout;
  /** Subtotals for each group of an outer row or column field. */
  subtotals: boolean;
  /** A Grand Total row at the bottom, and a column at the right. */
  grandRows: boolean;
  grandCols: boolean;
  /** With two or more value fields, list them down the rows instead of across the columns. */
  valuesOnRows?: boolean;
  /** Items in descending order, by field (ascending when unset). */
  descending?: string[];
  /** Shown in empty cells (unset: nothing). */
  emptyText?: string;
  /** The cells the report filled last time (cleared before it is written again). */
  last?: Range;
}

let nextId = 1;
export const newPivotId = (): number => nextId++;
export const seenPivotId = (id: number): void => { if (id >= nextId) nextId = id + 1; };

/** A value field's caption: its own name, or "Sum of Yield". */
export const valueCaption = (v: PivotValueField): string => v.name || `${PIVOT_FN_NAMES[v.fn]} of ${v.field}`;

/** The label an item shows (an empty cell is "(blank)"). */
export function itemText(v: Value): string {
  if (v === null || v === '') return '(blank)';
  if (isError(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/** The records of a source block: field names from its header row, and the values of each record. */
export interface PivotSource {
  fields: string[];
  records: Value[][];
}

/** Read a block of cells as records; an error when a header is empty, as Excel refuses. */
export function sourceOf(block: Value[][]): PivotSource | string {
  const head = block[0] ?? [];
  if (!head.length) return 'Select a table of records with a header row.';
  const fields: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const h = head[i];
    if (h === null || h === '') return 'The PivotTable field name is not valid: every column of the source needs a heading in its first row.';
    let name = itemText(h);
    // repeated headings are told apart as Excel does (Yield, Yield2)
    if (fields.includes(name)) { let n = 2; while (fields.includes(`${name}${n}`)) n++; name = `${name}${n}`; }
    fields.push(name);
  }
  if (block.length < 2) return 'The source needs at least one record below its header row.';
  return { fields, records: block.slice(1) };
}

/** Sort items as Excel does: numbers, then text (ignoring case), then TRUE/FALSE, then errors, with blanks last. */
export function compareItems(a: Value, b: Value): number {
  const rank = (v: Value) => (v === null || v === '' ? 5 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, undefined, { sensitivity: 'accent' });
  return itemText(a).localeCompare(itemText(b));
}

/** The different items of a field, in order (each by its label). */
export function fieldItems(src: PivotSource, field: string, descending = false): { text: string; value: Value }[] {
  const i = src.fields.indexOf(field);
  if (i < 0) return [];
  const seen = new Map<string, Value>();
  for (const r of src.records) {
    const v = r[i] ?? null;
    const t = itemText(v);
    if (!seen.has(t)) seen.set(t, v === '' ? null : v);
  }
  const list = [...seen].map(([text, value]) => ({ text, value }));
  list.sort((a, b) => compareItems(a.value, b.value));
  if (descending) list.reverse();
  return list;
}

// ---------------------------------------------------------------- summarising

function summarise(fn: PivotFn, vs: Value[]): Value {
  if (fn === 'count') return vs.filter((v) => v !== null && v !== '').length;
  const xs = vs.filter((v): v is number => typeof v === 'number');
  const err = vs.find(isError);
  if (err && fn !== 'countNums') return err;
  const n = xs.length;
  const mean = () => xs.reduce((s, x) => s + x, 0) / n;
  const ss = () => { const m = mean(); return xs.reduce((s, x) => s + (x - m) ** 2, 0); };
  switch (fn) {
    case 'sum': return xs.reduce((s, x) => s + x, 0);
    case 'countNums': return n;
    case 'average': return n ? mean() : divZero();
    case 'max': return n ? Math.max(...xs) : 0;
    case 'min': return n ? Math.min(...xs) : 0;
    case 'product': return n ? xs.reduce((s, x) => s * x, 1) : 0;
    case 'stdDev': return n > 1 ? Math.sqrt(ss() / (n - 1)) : divZero();
    case 'stdDevp': return n ? Math.sqrt(ss() / n) : divZero();
    case 'var': return n > 1 ? ss() / (n - 1) : divZero();
    case 'varp': return n ? ss() / n : divZero();
  }
}

const divZero = () => ERR.div0();

// ---------------------------------------------------------------- laying out the report

/** One line along an axis: a group's items (outer field first), and what kind of line it is. */
interface Line {
  /** Item labels for the fields so far (a subtotal's path stops at its field). */
  path: string[];
  kind: 'item' | 'subtotal' | 'grand' | 'header';
  /** For Σ Values on this axis: which value field. */
  value?: number;
}

/** A report laid out in cells, from its top-left corner. */
export interface PivotReport {
  cells: Value[][];
  styles: { r1: number; c1: number; r2: number; c2: number; style: CellStyle }[];
  /** Where the body sits (the first row and column of numbers), and its size. */
  body: { row: number; col: number; rows: number; cols: number };
  /** Row and column header lines of the body (for PivotCharts and Excel's file). */
  rowLines: Line[];
  colLines: Line[];
  /** How many rows the filters take at the top (with the blank row under them). */
  filterRows: number;
  /** The rows the column headings take above the body. */
  headRows: number;
  /** The columns the row labels take to the left of the body. */
  labelCols: number;
}

const VALUES = 'Σ Values';

/**
 * Lay out a PivotTable's report from its records. Records whose items are hidden (in any field,
 * the filters included) are left out before anything is added up.
 */
export function layoutPivot(pt: PivotTable, src: PivotSource): PivotReport | string {
  const idx = (f: string) => src.fields.indexOf(f);
  // no fields yet: Excel's placeholder, until fields are picked
  if (!pt.rows.length && !pt.cols.length && !pt.values.length && !pt.filters.length) {
    return {
      cells: [[pt.name, null, null], ['Pick fields in the', null, null], ['PivotTable Fields window', null, null]],
      styles: [{ r1: 0, c1: 0, r2: 2, c2: 2, style: { fill: '#f2f2f2', color: '#595959' } }, { r1: 0, c1: 0, r2: 0, c2: 2, style: { bold: true } }],
      body: { row: 3, col: 0, rows: 0, cols: 0 }, rowLines: [], colLines: [], filterRows: 0, headRows: 0, labelCols: 1,
    };
  }
  for (const f of [...pt.rows, ...pt.cols, ...pt.filters, ...pt.values.map((v) => v.field)]) {
    if (idx(f) < 0) return `The source has no field called "${f}" any more.`;
  }
  // the records that pass every hidden list
  const hidden = Object.entries(pt.hidden).filter(([, list]) => list.length).map(([f, list]) => [idx(f), new Set(list)] as const).filter(([i]) => i >= 0);
  const records = src.records.filter((r) => hidden.every(([i, set]) => !set.has(itemText(r[i] ?? null))));
  const nv = pt.values.length;
  // Σ Values sits on the columns (or rows) as the innermost field when there are two or more value fields
  const onRows = nv > 1 && !!pt.valuesOnRows, onCols = nv > 1 && !pt.valuesOnRows;
  const rowFields = pt.rows.map(idx), colFields = pt.cols.map(idx);
  const desc = new Set(pt.descending ?? []);
  const order = (f: number) => {
    const items = fieldItems(src, src.fields[f], desc.has(src.fields[f])).map((x) => x.text);
    return new Map(items.map((t, i) => [t, i]));
  };
  const orders = new Map<number, Map<string, number>>();
  for (const f of [...rowFields, ...colFields]) orders.set(f, order(f));

  /** The lines along an axis: groups of the records by each field in turn. */
  const linesFor = (fields: number[], withValues: boolean, isRow: boolean): Line[] => {
    const lines: Line[] = [];
    const tabularRows = isRow && pt.layout === 'tabular';
    const walk = (recs: Value[][], depth: number, path: string[]) => {
      if (depth === fields.length) {
        if (withValues) for (let v = 0; v < nv; v++) lines.push({ path, kind: 'item', value: v });
        else lines.push({ path, kind: 'item' });
        return;
      }
      const f = fields[depth];
      const groups = new Map<string, Value[][]>();
      for (const r of recs) {
        const t = itemText(r[f] ?? null);
        let g = groups.get(t);
        if (!g) groups.set(t, (g = []));
        g.push(r);
      }
      const ord = orders.get(f)!;
      const keys = [...groups.keys()].sort((a, b) => ord.get(a)! - ord.get(b)!);
      const inner = depth < fields.length - 1 || withValues;
      for (const k of keys) {
        const p = [...path, k];
        // rows of an outer field: in compact and outline form the group's own line comes first (its subtotal, if any)
        if (isRow && inner && !tabularRows) lines.push({ path: p, kind: pt.subtotals && depth < fields.length - 1 ? 'subtotal' : 'header' });
        walk(groups.get(k)!, depth + 1, p);
        if ((!isRow || tabularRows) && pt.subtotals && depth < fields.length - 1) {
          if (withValues) for (let v = 0; v < nv; v++) lines.push({ path: p, kind: 'subtotal', value: v });
          else lines.push({ path: p, kind: 'subtotal' });
        }
      }
    };
    if (fields.length) walk(records, 0, []);
    else if (withValues) for (let v = 0; v < nv; v++) lines.push({ path: [], kind: 'item', value: v });
    else lines.push({ path: [], kind: 'item' });
    const grand = isRow ? pt.grandRows : pt.grandCols;
    if (grand && fields.length) {
      if (withValues) for (let v = 0; v < nv; v++) lines.push({ path: [], kind: 'grand', value: v });
      else lines.push({ path: [], kind: 'grand' });
    }
    return lines;
  };
  // Σ Values on rows adds its own lines inside the innermost row group
  const rowLines = linesFor(rowFields, onRows, true);
  const colLines = linesFor(colFields, onCols, false);

  // the records under a line: those whose items match its path
  const matching = (recs: Value[][], fields: number[], path: string[]) => (path.length ? recs.filter((r) => path.every((t, i) => itemText(r[fields[i]] ?? null) === t)) : recs);
  const cache = new Map<string, Value[][]>();
  const recsFor = (rl: Line, cl: Line) => {
    const key = `${rl.path.join('\u0001')}\u0002${cl.path.join('\u0001')}`;
    let got = cache.get(key);
    if (!got) cache.set(key, (got = matching(matching(records, rowFields, rl.path), colFields, cl.path)));
    return got;
  };
  const valueAt = (rl: Line, cl: Line): Value => {
    if (rl.kind === 'header') return null;
    const vi = rl.value ?? cl.value ?? 0;
    const vf = pt.values[vi];
    if (!vf) return null;
    const recs = recsFor(rl, cl);
    if (!recs.length && rl.kind === 'item' && cl.kind === 'item') return null;
    const fi = idx(vf.field);
    const v = summarise(vf.fn, recs.map((r) => r[fi] ?? null));
    const show = vf.showAs ?? 'normal';
    if (show === 'normal' || typeof v !== 'number') return v;
    const total = (r: Line, c: Line) => summarise(vf.fn, recsFor(r, c).map((x) => x[fi] ?? null));
    const all: Line = { path: [], kind: 'grand' };
    const base = show === 'percentOfTotal' ? total(all, all) : show === 'percentOfRow' ? total(rl, all) : total(all, cl);
    return typeof base === 'number' && base !== 0 ? v / base : divZero();
  };

  // ---------------------------------------------------------------- cells
  const out: Value[][] = [];
  const styles: PivotReport['styles'] = [];
  const put = (r: number, c: number, v: Value) => {
    while (out.length <= r) out.push([]);
    out[r][c] = v;
  };
  // filters at the top: field name, then (All), (Multiple Items) or the one item shown
  let top = 0;
  for (const f of pt.filters) {
    const items = fieldItems(src, f);
    const hid = new Set(pt.hidden[f] ?? []);
    const shown = items.filter((x) => !hid.has(x.text));
    put(top, 0, f);
    put(top, 1, !hid.size ? '(All)' : shown.length === 1 ? shown[0].text : '(Multiple Items)');
    styles.push({ r1: top, c1: 0, r2: top, c2: 1, style: { bold: true, fill: '#dde6f4' } });
    top++;
  }
  const filterRows = pt.filters.length ? top + 1 : 0;
  top = filterRows;

  const tabular = pt.layout !== 'compact';
  const rowAxis = [...pt.rows, ...(onRows ? [VALUES] : [])];
  const labelCols = tabular ? Math.max(1, rowAxis.length) : 1;
  const colAxisLevels = colFields.length + (onCols ? 1 : 0);
  // column heading rows: a caption row when there are column fields, then one row per column level
  const captionRow = colFields.length > 0 || (onCols && pt.rows.length === 0);
  const headRows = (captionRow ? 1 : 0) + Math.max(1, colAxisLevels);
  const bodyRow = top + headRows, bodyCol = labelCols;
  const headerFill: CellStyle = { bold: true, fill: '#dde6f4' };
  // the corner: the value caption (one value field) and "Column Labels" over the columns
  if (captionRow) {
    put(top, 0, nv === 1 ? valueCaption(pt.values[0]) : null);
    put(top, bodyCol, colFields.length ? (tabular ? pt.cols[0] : 'Column Labels') : 'Values');
    styles.push({ r1: top, c1: 0, r2: top, c2: bodyCol + colLines.length - 1, style: headerFill });
  }
  const labelRow = bodyRow - 1;
  // the row labels' heading(s)
  if (tabular) rowAxis.forEach((f, i) => put(labelRow, i, f === VALUES ? 'Values' : f));
  else put(labelRow, 0, pt.rows.length || onRows ? 'Row Labels' : null);
  // column headings: each level's item where its group starts
  const levelRow = (lvl: number) => (captionRow ? top + 1 + lvl : top + lvl);
  colLines.forEach((cl, j) => {
    const c = bodyCol + j;
    if (cl.kind === 'grand') {
      put(levelRow(0), c, nv > 1 && onCols ? `Total ${valueCaption(pt.values[cl.value ?? 0])}` : 'Grand Total');
      return;
    }
    if (cl.kind === 'subtotal') {
      const lvl = cl.path.length - 1;
      put(levelRow(lvl), c, onCols ? `${cl.path[lvl]} ${valueCaption(pt.values[cl.value ?? 0])}` : `${cl.path[lvl]} Total`);
      return;
    }
    const prev = colLines[j - 1];
    cl.path.forEach((t, lvl) => {
      const same = prev && prev.kind === 'item' && prev.path.slice(0, lvl + 1).join('\u0001') === cl.path.slice(0, lvl + 1).join('\u0001');
      if (!same) put(levelRow(lvl), c, t);
    });
    if (onCols) put(levelRow(colFields.length), c, valueCaption(pt.values[cl.value ?? 0]));
    else if (!colFields.length && nv) put(levelRow(0), c, valueCaption(pt.values[0]));
  });
  styles.push({ r1: labelRow, c1: 0, r2: labelRow, c2: bodyCol + colLines.length - 1, style: { ...headerFill, borders: { bottom: { style: 'thin', color: '#8ea9db' } } } });
  // the rows: labels, then numbers
  rowLines.forEach((rl, i) => {
    const r = bodyRow + i;
    const bold = rl.kind !== 'item';
    if (rl.kind === 'grand') {
      put(r, 0, onRows ? `Total ${valueCaption(pt.values[rl.value ?? 0])}` : 'Grand Total');
      styles.push({ r1: r, c1: 0, r2: r, c2: bodyCol + colLines.length - 1, style: { bold: true, fill: '#dde6f4', borders: { top: { style: 'thin', color: '#8ea9db' } } } });
    } else if (tabular) {
      const prev = rowLines[i - 1];
      if (rl.kind === 'subtotal' && pt.layout === 'tabular') put(r, rl.path.length - 1, `${rl.path[rl.path.length - 1]} Total`);
      else rl.path.forEach((t, lvl) => {
        const same = prev && prev.kind !== 'grand' && prev.path.slice(0, lvl + 1).join('\u0001') === rl.path.slice(0, lvl + 1).join('\u0001') && !(prev.kind === 'subtotal' && pt.layout === 'tabular');
        if (!same) put(r, lvl, t);
      });
      if (onRows && rl.value !== undefined) put(r, rowAxis.length - 1, valueCaption(pt.values[rl.value]));
      if (bold) styles.push({ r1: r, c1: 0, r2: r, c2: bodyCol + colLines.length - 1, style: { bold: true } });
    } else {
      // compact: one column, each level indented
      const depth = rl.path.length;
      const label = onRows && rl.value !== undefined && rl.kind === 'item' ? valueCaption(pt.values[rl.value]) : rl.path[depth - 1] ?? (captionRow && nv === 1 ? valueCaption(pt.values[0]) : '');
      const indent = onRows && rl.value !== undefined && rl.kind === 'item' ? depth : Math.max(0, depth - 1);
      put(r, 0, label);
      const st: CellStyle = { ...(indent ? { indent } : {}), ...(bold ? { bold: true } : {}), align: 'left' };
      styles.push({ r1: r, c1: 0, r2: r, c2: 0, style: st });
      if (bold) styles.push({ r1: r, c1: 1, r2: r, c2: bodyCol + colLines.length - 1, style: { bold: true } });
    }
    colLines.forEach((cl, j) => {
      const v = valueAt(rl, cl);
      put(r, bodyCol + j, v === null && pt.emptyText !== undefined && rl.kind !== 'header' ? pt.emptyText : v);
    });
  });
  // number formats: each value field's own, and percentages for its share
  colLines.forEach((cl, j) => {
    rowLines.forEach((rl, i) => {
      const vf = pt.values[rl.value ?? cl.value ?? 0];
      if (!vf) return;
      const fmt = vf.numFmt ?? ((vf.showAs ?? 'normal') !== 'normal' ? '0.00%' : undefined);
      if (fmt) styles.push({ r1: bodyRow + i, c1: bodyCol + j, r2: bodyRow + i, c2: bodyCol + j, style: { numFmt: fmt } });
    });
  });
  const width = bodyCol + colLines.length;
  for (const row of out) for (let c = 0; c < width; c++) if (row[c] === undefined) row[c] = null;
  return {
    cells: out, styles, body: { row: bodyRow, col: bodyCol, rows: rowLines.length, cols: colLines.length },
    rowLines, colLines, filterRows, headRows, labelCols,
  };
}

/** A new PivotTable's name: PivotTable1, PivotTable2… not yet used in the workbook. */
export function newPivotName(used: string[]): string {
  let n = 1;
  while (used.includes(`PivotTable${n}`)) n++;
  return `PivotTable${n}`;
}

/**
 * The series a PivotChart draws from a report laid out at (row, col): the categories are the
 * row labels of the item lines (subtotals and grand totals left out), and each column of numbers
 * (again without totals) is a series. References are to cells, as Excel's PivotCharts keep them.
 */
export function pivotChartSeries(rep: PivotReport, at: { row: number; col: number }, sheet: string, pt: PivotTable): { name: string; x: string; y: string }[] {
  const q = /^[A-Za-z_][\w.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  const col = (c: number) => { let s = '', n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const items = rep.rowLines.map((l, i) => ({ l, i })).filter((x) => x.l.kind === 'item');
  if (!items.length) return [];
  // the item lines in one run (a chart series is one block of cells)
  const r1 = at.row + rep.body.row + items[0].i, r2 = at.row + rep.body.row + items[items.length - 1].i;
  const labelCol = at.col + (pt.layout === 'compact' ? 0 : rep.labelCols - 1);
  const out: { name: string; x: string; y: string }[] = [];
  rep.colLines.forEach((cl, j) => {
    if (cl.kind !== 'item') return;
    const c = at.col + rep.body.col + j;
    const name = [...cl.path, ...(cl.value !== undefined && pt.values.length > 1 ? [valueCaption(pt.values[cl.value])] : [])].join(' - ') || valueCaption(pt.values[0]);
    out.push({ name, x: `=${q}!$${col(labelCol)}$${r1 + 1}:$${col(labelCol)}$${r2 + 1}`, y: `=${q}!$${col(c)}$${r1 + 1}:$${col(c)}$${r2 + 1}` });
  });
  return out;
}

/**
 * The records behind one number of a report (Excel's Show Details): those that pass the hidden
 * lists and fall under the number's row and column items. Returned with the header row first.
 */
export function detailRecords(pt: PivotTable, src: PivotSource, rep: PivotReport, i: number, j: number): Value[][] | null {
  const rl = rep.rowLines[i], cl = rep.colLines[j];
  if (!rl || !cl || rl.kind === 'header' || cl.kind === 'header') return null;
  const idx = (f: string) => src.fields.indexOf(f);
  const hidden = Object.entries(pt.hidden).filter(([, list]) => list.length).map(([f, list]) => [idx(f), new Set(list)] as const).filter(([k]) => k >= 0);
  const under = (path: string[], fields: string[]) => (r: Value[]) => path.every((t, k) => itemText(r[idx(fields[k])] ?? null) === t);
  const rows = src.records.filter((r) => hidden.every(([k, set]) => !set.has(itemText(r[k] ?? null)))).filter(under(rl.path, pt.rows)).filter(under(cl.path, pt.cols));
  return [src.fields, ...rows];
}
