// PivotTables on sheets: finding a PivotTable's records in the workbook, and writing its report
// into the cells (taking away the last one first), with the PivotCharts that chart it following.

import type { Sheet, Workbook, CellStyle } from './workbook';
import { mergeStyle, valueInput } from './workbook';
import { Range, rangesOverlap, inRange, rangeName, keyOf, rowOf, colOf } from './refs';
import { nameTarget, resolveName, refersTo } from './names';
import { PivotTable, PivotSource, PivotReport, layoutPivot, sourceOf, pivotChartSeries } from './pivot';
import type { Value } from './values';
import type { Chart } from './chart';

/** The sheet and block a PivotTable's source names (a reference, a table's name or a defined name). */
export function sourceRange(wb: Workbook, source: string, home: Sheet): { sheet: Sheet; range: Range } | string {
  const text = source.trim().replace(/^=/, '');
  const t = nameTarget(text);
  if (t) {
    const sheet = t.sheet ? wb.sheetNamed(t.sheet) : home;
    return sheet ? { sheet, range: t.range } : `There is no sheet called "${t.sheet}".`;
  }
  for (const s of wb.sheets) {
    const table = s.tables.find((x) => x.name.toLowerCase() === text.toLowerCase());
    if (table) return { sheet: s, range: { ...table.range, r2: table.totals ? table.range.r2 - 1 : table.range.r2 } };
  }
  const n = resolveName(wb.names, text, home);
  const nt = n ? nameTarget(n.formula) : null;
  if (nt) {
    const sheet = nt.sheet ? wb.sheetNamed(nt.sheet) : n?.sheet ?? home;
    if (sheet) return { sheet, range: nt.range };
  }
  return `The source "${source}" isn't a block of cells, a table or a name for one.`;
}

/** A PivotTable's records, read from its source. */
export function readSource(wb: Workbook, pt: PivotTable, home: Sheet): PivotSource | string {
  const at = sourceRange(wb, pt.source, home);
  if (typeof at === 'string') return at;
  return sourceOf(blockValues(at.sheet, at.range));
}

/** The values of a block of cells (stopping at the last row in use). */
export function blockValues(s: Sheet, R: Range): Value[][] {
  const r2 = Math.min(R.r2, Math.max(s.lastRow, R.r1));
  const out: Value[][] = [];
  for (let r = R.r1; r <= r2; r++) {
    const row: Value[] = [];
    for (let c = R.c1; c <= R.c2; c++) row.push(s.value(r, c));
    out.push(row);
  }
  return out;
}

/** The source of a selection, as a PivotTable keeps it: the block, with its sheet's name. */
export const sourceText = (sheet: Sheet, r: Range): string => refersTo(sheet.name, r);

/** Lay a PivotTable out from its source (or say why it can't be). */
export function reportOf(wb: Workbook, s: Sheet, pt: PivotTable): PivotReport | string {
  const src = readSource(wb, pt, s);
  if (typeof src === 'string') return src;
  return layoutPivot(pt, src);
}

/** The cells a report fills at a PivotTable's place. */
export function reportRange(pt: PivotTable, rep: PivotReport): Range {
  const h = rep.cells.length, w = Math.max(1, ...rep.cells.map((r) => r.length));
  return { r1: pt.at.row, c1: pt.at.col, r2: pt.at.row + Math.max(1, h) - 1, c2: pt.at.col + w - 1 };
}

/**
 * Why a report can't go where it would (null when it can): it would run into another
 * PivotTable, or over the cells of its own source. Cells with something in them are the
 * caller's to ask about (see `wouldCover`).
 */
export function placeProblem(s: Sheet, pt: PivotTable, R: Range): string | null {
  for (const other of s.pivots) {
    if (other.id === pt.id || !other.last) continue;
    if (rangesOverlap(other.last, R)) return `A PivotTable can't overlap another PivotTable (${other.name} is in ${rangeName(other.last)}).`;
  }
  const src = sourceRange(s.wb, pt.source, s);
  if (typeof src !== 'string' && src.sheet === s && rangesOverlap(src.range, R)) return 'The PivotTable would cover its own source data: put it somewhere else.';
  return null;
}

/** Do cells the report would fill (beyond its last report) have something in them? */
export function wouldCover(s: Sheet, pt: PivotTable, R: Range): boolean {
  for (const k of s.keysIn(R)) {
    const c = s.cells.get(k);
    if (!c?.input && !c?.structure) continue;
    if (pt.last && inRange(pt.last, rowOf(k), colOf(k))) continue;
    return true;
  }
  return false;
}

/**
 * Write a PivotTable's report into its sheet (inside an edit), taking away the last one, and
 * point its PivotCharts at the new cells. Returns the PivotTable as kept (with where the report
 * now is), or why it couldn't be laid out.
 */
export function writePivot(s: Sheet, pt: PivotTable): PivotTable | string {
  const rep = reportOf(s.wb, s, pt);
  if (typeof rep === 'string') return rep;
  const R = reportRange(pt, rep);
  if (pt.last) s.clear(pt.last, 'all');
  // each cell's look: the styles that cover it, in order
  const looks = new Map<number, CellStyle>();
  for (const st of rep.styles) {
    for (let r = st.r1; r <= st.r2; r++) for (let c = st.c1; c <= st.c2; c++) {
      const k = keyOf(r, c);
      looks.set(k, mergeStyle(looks.get(k), st.style) ?? {});
    }
  }
  rep.cells.forEach((row, r) => row.forEach((v, c) => {
    const style = looks.get(keyOf(r, c));
    const input = v === null ? undefined : valueInput(v);
    if (input === undefined && !style) return;
    s.setCell(pt.at.row + r, pt.at.col + c, { input: input || undefined, style: style && Object.keys(style).length ? style : undefined });
  }));
  const kept: PivotTable = { ...pt, last: R };
  s.setPivots(s.pivots.some((p) => p.id === pt.id) ? s.pivots.map((p) => (p.id === pt.id ? kept : p)) : [...s.pivots, kept]);
  // PivotCharts on any sheet that chart this report (PivotTable ids are the workbook's own)
  const series = pivotChartSeries(rep, pt.at, s.name, kept);
  for (const sh of s.wb.sheets) {
    if (!sh.charts.some((c) => c.pivot === pt.id)) continue;
    sh.setCharts(sh.charts.map((c) => (c.pivot === pt.id ? pivotChart(c, series) : c)));
  }
  return kept;
}

/** A PivotChart with its series pointed at the report's cells (keeping each series' own look where it matches). */
export function pivotChart(c: Chart, series: { name: string; x: string; y: string }[]): Chart {
  return {
    ...c,
    series: series.map((sr, i) => {
      const was = c.series.find((x) => x.name === sr.name) ?? c.series[i];
      return { ...(was ?? {}), name: sr.name, x: sr.x, y: sr.y };
    }),
  };
}

/** Take a PivotTable away (Clear All): its report's cells and itself. PivotCharts become ordinary charts. */
export function removePivot(s: Sheet, pt: PivotTable): void {
  if (pt.last) s.clear(pt.last, 'all');
  s.setPivots(s.pivots.filter((p) => p.id !== pt.id));
  for (const sh of s.wb.sheets) {
    if (!sh.charts.some((c) => c.pivot === pt.id)) continue;
    sh.setCharts(sh.charts.map((c) => {
      if (c.pivot !== pt.id) return c;
      const { pivot: _p, ...rest } = c;
      return rest;
    }));
  }
}

/** The PivotTable whose report includes a cell. */
export function pivotAt(s: Sheet, row: number, col: number): PivotTable | undefined {
  return s.pivots.find((p) => p.last && inRange(p.last, row, col));
}
