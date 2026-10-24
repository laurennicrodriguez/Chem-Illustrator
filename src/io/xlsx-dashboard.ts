// A dashboard sheet as Excel sees it. Excel has no tiles or slicers like ours, so the sheet is
// saved as a stand-in that still reads well there: each chart tile becomes an Excel chart in the
// same place, and headline numbers, tables, slicers, galleries and text become cells (the values
// as they show now, with the slicers applied). The dashboard itself is kept in our own part of the
// file and comes back whole when the file is opened here.

import { Workbook, Sheet, CellStyle } from '../sheet/workbook';
import type { Range } from '../sheet/refs';
import { DEFAULT_COL_W, DEFAULT_ROW_H } from '../sheet/layout';
import { formatValue } from '../sheet/numfmt';
import { isError } from '../sheet/values';
import { Chart, Series, SeriesData, chartData, refText } from '../sheet/chart';
import {
  Dashboard, Tile, AGGREGATE_NAMES, groupSeries, filterMask, kpiValue, resolveSource, shownRows, columnOf, sourceName,
} from '../sheet/dashboard';

/** How wide the dashboard is laid out for Excel, in pixels (about a laptop screen). */
export const EXCEL_DASH_WIDTH = 1200;

/** A tile's box in pixels on a page EXCEL_DASH_WIDTH wide. */
export function tileBox(d: Dashboard, t: Tile, width = EXCEL_DASH_WIDTH): { x: number; y: number; w: number; h: number } {
  const colW = (width - d.gap * (d.cols + 1)) / d.cols;
  return {
    x: d.gap + t.x * (colW + d.gap),
    y: d.gap + t.y * (d.rowH + d.gap),
    w: t.w * colW + (t.w - 1) * d.gap,
    h: t.h * d.rowH + (t.h - 1) * d.gap,
  };
}

/** Text written so it is never read as a formula or a number. */
const asText = (s: string) => (/^[=+\-@]/.test(s) || (s.trim() !== '' && Number.isFinite(Number(s))) ? ` ${s}` : s);

/** The sheet Excel is given for a dashboard (not part of the workbook: only written out). */
export function dashboardStandIn(book: Workbook, s: Sheet): { sheet: Sheet; data: Map<number, SeriesData[]> } {
  const d = s.dashboard!;
  const tmp = new Workbook([s.name]);
  const out = tmp.sheet;
  // what shows now: the slicers and the charts' picks applied
  const mask = filterMask(book, d);
  const charts: Chart[] = [];
  /** What each chart shows, as worked out here (the stand-in's cells aren't in the workbook). */
  const data = new Map<number, SeriesData[]>();
  /** Chart numbers go in last, so cells of other tiles win where they meet. */
  const later: (() => void)[] = [];
  const merges: Range[] = [];
  const cellAt = (px: number, size: number) => Math.max(0, Math.floor(px / size));
  tmp.build(() => {
    const put = (r: number, c: number, text: string | number, style?: CellStyle) => {
      if (out.cell(r, c)?.input) return; // tiles that overlap in cells: the first one wins
      out.setCell(r, c, { input: typeof text === 'number' ? String(text) : asText(text), style });
    };
    for (const t of d.tiles) {
      const b = tileBox(d, t);
      const r0 = cellAt(b.y, DEFAULT_ROW_H), c0 = cellAt(b.x, DEFAULT_COL_W);
      const rows = Math.max(1, Math.floor(b.h / DEFAULT_ROW_H));
      const title = (text: string) => { if (text) put(r0, c0, text, { bold: true, color: '#4a5263' }); };
      switch (t.kind) {
        case 'chart': {
          // the numbers as the tile shows them (slicers applied, same labels combined) go in the
          // cells under the chart, and the Excel chart reads those
          const shown = groupSeries(chartData(book, book.sheet, t.chart, mask), t.chart.kind, t.group);
          const scatter = t.chart.kind === 'scatter';
          const n = Math.max(0, ...shown.map((d) => d.ys.length));
          const ref = (c: number, r1: number, r2: number) => refText(s.name, { r1, c1: c, r2, c2: c });
          const series: Series[] = [];
          later.push(() => {
            for (let j = 0; j < n; j++) {
              const first = shown[0];
              if (scatter) { if (Number.isFinite(first?.xs[j])) put(r0 + 1 + j, c0, first.xs[j]); }
              else if (first?.cats[j]) put(r0 + 1 + j, c0, first.cats[j]);
            }
          });
          let col = c0 + 1;
          shown.forEach((d, i) => {
            const yc = col++;
            const ec = d.plus ? col++ : null;
            later.push(() => {
              put(r0, yc, d.name);
              d.ys.forEach((y, j) => { if (Number.isFinite(y)) put(r0 + 1 + j, yc, y); });
              if (ec !== null) { put(r0, ec, `${d.name} ±`); d.plus!.forEach((e, j) => { if (Number.isFinite(e)) put(r0 + 1 + j, ec, e); }); }
            });
            const own = t.chart.series[i];
            series.push({
              ...own,
              name: ref(yc, r0, r0),
              ...(n ? { x: ref(c0, r0 + 1, r0 + n), y: ref(yc, r0 + 1, r0 + n) } : { y: ref(yc, r0 + 1, r0 + 1) }),
              ...(own?.errors && ec !== null && n ? { errors: { kind: 'cells' as const, plus: ref(ec, r0 + 1, r0 + n) } } : {}),
            });
          });
          const chart: Chart = {
            ...t.chart,
            series,
            ...(t.title ? { title: t.title } : {}),
            at: { row: r0, col: c0, dx: Math.round(b.x - c0 * DEFAULT_COL_W), dy: Math.round(b.y - r0 * DEFAULT_ROW_H) },
            w: Math.round(b.w), h: Math.round(b.h),
          };
          charts.push(chart);
          data.set(chart.id, shown);
          break;
        }
        case 'kpi': {
          title(t.title ?? (t.formula ? 'Formula' : `${AGGREGATE_NAMES[t.agg]}${t.column ? ` of ${t.column}` : ''}`));
          const v = kpiValue(book, t, mask);
          // a number stays a number in Excel: the text after it goes in its format
          const fmt = t.numFmt ?? (typeof v === 'number' && !Number.isInteger(v) ? '0.0' : undefined);
          const withSuffix = t.suffix ? `${fmt ?? 'General'}"${t.suffix.replace(/"/g, '')}"` : fmt;
          const style: CellStyle = { bold: true, size: 20, ...(withSuffix ? { numFmt: withSuffix } : {}) };
          if (typeof v === 'number' && t.target !== undefined) style.color = (t.higherIsBetter === false ? v <= t.target : v >= t.target) ? '#18794e' : '#b4232a';
          // the big number spans the tile's width, so Excel has room for it (no ####)
          const span = Math.max(1, Math.floor(b.w / DEFAULT_COL_W));
          if (span > 1) merges.push({ r1: r0 + 1, c1: c0, r2: r0 + 1, c2: c0 + span - 1 });
          style.align = 'center';
          if (typeof v === 'number') put(r0 + 1, c0, v, style);
          else if (v !== null) put(r0 + 1, c0, isError(v) ? formatValue(v).text : String(v), { bold: true, size: 20, align: 'center' });
          break;
        }
        case 'text':
          put(r0, c0, t.text, { bold: t.bold || undefined, size: t.size ? Math.round(t.size * 0.75) : undefined, ...(t.color ? { color: t.color } : {}) });
          break;
        case 'slicer': {
          title(t.title ?? t.column);
          put(r0 + 1, c0, t.selected?.length ? `Showing ${t.column}: ${t.selected.join(', ')}` : `Showing every ${t.column}`);
          break;
        }
        case 'table': case 'gallery': {
          title(t.title ?? sourceName(t.source));
          const res = resolveSource(book, t.source);
          if (!res) break;
          const names = t.kind === 'table' ? (t.columns?.length ? t.columns : res.names) : [t.structure, ...(t.labels ?? [])];
          const cols = names.map((n) => ({ n, c: columnOf(res, n) })).filter((x): x is { n: string; c: number } => x.c !== null);
          cols.forEach(({ n }, i) => put(r0 + 1, c0 + i, n, { bold: true, borders: { bottom: { style: 'thin', color: '#9aa3b5' } } }));
          let list = shownRows(res, mask);
          if (t.kind === 'table') {
            const sc = columnOf(res, t.sortBy);
            if (sc !== null) {
              list = [...list].sort((a, b) => {
                const va = res.sheet.value(a, sc), vb = res.sheet.value(b, sc);
                const k = typeof va === 'number' && typeof vb === 'number' ? va - vb : res.sheet.shownText(a, sc).localeCompare(res.sheet.shownText(b, sc), undefined, { numeric: true });
                return t.descending ? -k : k;
              });
            }
          }
          list.slice(0, Math.max(1, rows - 2)).forEach((r, j) => cols.forEach(({ c }, i) => {
            const v = res.sheet.value(r, c);
            const st = res.sheet.cell(r, c)?.structure;
            if (st) put(r0 + 2 + j, c0 + i, typeof v === 'string' && v ? v : '(structure)');
            else if (typeof v === 'number') put(r0 + 2 + j, c0 + i, v, res.sheet.styleAt(r, c)?.numFmt ? { numFmt: res.sheet.styleAt(r, c)!.numFmt } : undefined);
            else { const text = res.sheet.shownText(r, c); if (text) put(r0 + 2 + j, c0 + i, text); }
          }));
          break;
        }
      }
    }
    for (const f of later) f();
    if (!d.tiles.length) put(0, 0, 'An empty dashboard (made in Chem Illustrator).');
    out.setCharts(charts);
    // merged blocks that would overlap an earlier one are left out
    const kept: Range[] = [];
    for (const m of merges) if (!kept.some((k) => k.r1 <= m.r2 && m.r1 <= k.r2 && k.c1 <= m.c2 && m.c1 <= k.c2)) kept.push(m);
    if (kept.length) out.setMerges(kept);
  });
  return { sheet: out, data };
}
