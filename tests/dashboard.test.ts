// @vitest-environment jsdom
//
// Dashboards: tiles read a table or a block of cells, slicers filter every tile fed by the same
// cells, headline numbers aggregate what's left, references follow inserted rows and renamed
// sheets, new tiles find a free spot, and a dashboard goes to Excel as a stand-in and comes back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { newTable } from '../src/sheet/table-styles';
import {
  Dashboard, KpiTile, SlicerTile, TableTile, ChartTile, newDashboard, resolveSource, slicerMask, shownRows, kpiValue,
  aggregate, distinctValues, freeSpot, adjustDashboard, renameInDashboard, chartOfColumns, slicerText,
} from '../src/sheet/dashboard';
import { chartData } from '../src/sheet/chart';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { tileBox } from '../src/io/xlsx-dashboard';

/** A catalyst screen: catalyst, solvent, yield (%) and ee (%) in A1:D7, made a table. */
function screen(): Workbook {
  const wb = new Workbook(['Screen']);
  const s = wb.sheet;
  const rows = [
    ['Catalyst', 'Solvent', 'Yield', 'ee'],
    ['Pd(OAc)2', 'THF', 72, 88],
    ['Pd(OAc)2', 'Toluene', 81, 91],
    ['NiCl2', 'THF', 45, 60],
    ['NiCl2', 'Toluene', 52, 64],
    ['CuI', 'THF', 30, ''],
    ['Pd(OAc)2', 'DMF', 90, 95],
  ];
  wb.edit('fill', () => {
    rows.forEach((row, i) => row.forEach((v, j) => s.setInput(i, j, String(v))));
    s.setTables([{ ...newTable({ r1: 0, c1: 0, r2: 6, c2: 3 }, []), name: 'Screen1' }]);
  });
  return wb;
}

const kpi = (over: Partial<KpiTile> = {}): KpiTile => ({ id: 101, kind: 'kpi', x: 0, y: 0, w: 3, h: 2, source: { table: 'Screen1' }, column: 'Yield', agg: 'average', ...over });
const slicer = (selected?: string[], column = 'Catalyst'): SlicerTile => ({ id: 102, kind: 'slicer', x: 3, y: 0, w: 3, h: 4, source: { table: 'Screen1' }, column, selected });
const dash = (...tiles: Dashboard['tiles']): Dashboard => ({ ...newDashboard(), tiles });

describe('sources', () => {
  it('reads a table by name, or a block of cells, leaving out the header', () => {
    const wb = screen();
    const t = resolveSource(wb, { table: 'screen1' })!;
    expect(t.names).toEqual(['Catalyst', 'Solvent', 'Yield', 'ee']);
    expect(t.rows).toEqual([1, 2, 3, 4, 5, 6]);
    const b = resolveSource(wb, { range: 'Screen!A1:C4' })!;
    expect(b.names).toEqual(['Catalyst', 'Solvent', 'Yield']);
    expect(b.rows).toEqual([1, 2, 3]);
    expect(resolveSource(wb, { table: 'Gone' })).toBeNull();
  });

  it('leaves out a totals row and stops a whole column at the last row in use', () => {
    const wb = screen();
    wb.edit('totals', () => wb.sheet.setTables([{ ...wb.sheet.tables[0], range: { r1: 0, c1: 0, r2: 7, c2: 3 }, totals: true }]));
    expect(resolveSource(wb, { table: 'Screen1' })!.rows).toEqual([1, 2, 3, 4, 5, 6]);
    expect(resolveSource(wb, { range: 'Screen!A:B' })!.rows.at(-1)).toBe(6);
  });

  it('lists the different values of a column in sheet order (numbers sorted)', () => {
    const wb = screen();
    expect(distinctValues(wb, { table: 'Screen1' }, 'Catalyst')).toEqual(['Pd(OAc)2', 'NiCl2', 'CuI']);
    expect(distinctValues(wb, { table: 'Screen1' }, 'Yield')).toEqual(['30', '45', '52', '72', '81', '90']);
    expect(distinctValues(wb, { table: 'Screen1' }, 'ee')).toContain('(blank)');
    expect(slicerText(0.1 + 0.2)).toBe('0.3');
  });
});

describe('slicers and headline numbers', () => {
  it('aggregates like Excel', () => {
    const v = [72, 81, 45, '', 'x', null];
    expect(aggregate('sum', v)).toBe(198);
    expect(aggregate('average', v)).toBe(66);
    expect(aggregate('median', [3, 1, 2, 10])).toBe(2.5);
    expect(aggregate('min', v)).toBe(45);
    expect(aggregate('max', v)).toBe(81);
    expect(aggregate('count', v)).toBe(6);
    expect(aggregate('countValues', v)).toBe(4);
    expect(aggregate('distinct', ['a', 'b', 'a', ''])).toBe(2);
    // STDEV.S of 72, 81, 45
    expect(aggregate('stdev', [72, 81, 45]) as number).toBeCloseTo(18.734994, 5);
    expect(aggregate('average', [])).toBeNull();
  });

  it('filters every tile fed by the same table, and slicers combine', () => {
    const wb = screen();
    const res = resolveSource(wb, { table: 'Screen1' })!;
    expect(kpiValue(wb, kpi(), slicerMask(wb, dash(kpi())))).toBeCloseTo(370 / 6, 9);
    const one = dash(kpi(), slicer(['Pd(OAc)2']));
    const mask = slicerMask(wb, one);
    expect(shownRows(res, mask)).toEqual([1, 2, 6]);
    expect(kpiValue(wb, kpi(), mask)).toBeCloseTo(81, 9);
    expect(kpiValue(wb, kpi({ agg: 'count' }), mask)).toBe(3);
    const two = dash(kpi(), slicer(['Pd(OAc)2', 'NiCl2']), { ...slicer(['THF'], 'Solvent'), id: 103 });
    expect(shownRows(res, slicerMask(wb, two))).toEqual([1, 3]);
    // nothing picked: everything shows
    expect(shownRows(res, slicerMask(wb, dash(slicer([]))))).toEqual(res.rows);
  });

  it('a formula headline ignores the slicers', () => {
    const wb = screen();
    const mask = slicerMask(wb, dash(slicer(['CuI'])));
    expect(kpiValue(wb, kpi({ formula: '=MAX(Screen!C2:C7)' }), mask)).toBe(90);
  });

  it('charts drawn on a dashboard leave out the rows a slicer hides', () => {
    const wb = screen();
    const res = resolveSource(wb, { table: 'Screen1' })!;
    const c = chartOfColumns(res, 'column', 'Catalyst', ['Yield'], 7);
    expect(c.series[0].y).toBe('=Screen!$C$2:$C$7');
    expect(c.title).toBe('Yield');
    const all = chartData(wb, wb.sheet, c);
    const some = chartData(wb, wb.sheet, c, slicerMask(wb, dash(slicer(['NiCl2']))));
    expect(all[0].ys.length).toBe(6);
    expect(some[0].ys).toEqual([45, 52]);
  });
});

describe('keeping references right', () => {
  it('follows inserted rows and renamed sheets', () => {
    const wb = screen();
    const d = dash({ ...kpi({ source: { range: '=Screen!A1:D7' }, formula: '=AVERAGE(Screen!C2:C7)' }) });
    const moved = adjustDashboard(d, 'Dash', { sheet: 'Screen', axis: 'row', at: 0, count: 2 });
    const k = moved.tiles[0] as KpiTile;
    expect(k.source.range).toBe('=Screen!A3:D9');
    expect(k.formula).toBe('=AVERAGE(Screen!C4:C9)');
    const renamed = renameInDashboard(d, 'Screen', 'Run 2').tiles[0] as KpiTile;
    expect(renamed.source.range).toBe("='Run 2'!A1:D7");
    // a table source is by name, so it needs no change
    expect((adjustDashboard(dash(kpi()), 'Dash', { sheet: 'Screen', axis: 'row', at: 0, count: 2 }).tiles[0] as KpiTile).source).toEqual({ table: 'Screen1' });
  });

  it('a dashboard sheet keeps its references when rows are inserted on the data sheet', () => {
    const wb = screen();
    const dsh = wb.edit('dash', () => {
      const s = wb.addSheet('Dashboard');
      s.setDashboard(dash(kpi({ source: { range: '=Screen!A1:D7' } })));
      return s;
    });
    wb.edit('rows', () => wb.sheets[0].insertRows(0, 1));
    expect((dsh.dashboard!.tiles[0] as KpiTile).source.range).toBe('=Screen!A2:D8');
    wb.undo();
    expect((dsh.dashboard!.tiles[0] as KpiTile).source.range).toBe('=Screen!A1:D7');
  });
});

describe('placing tiles', () => {
  it('finds the first free spot, left to right then down', () => {
    const d = dash(kpi(), slicer());
    expect(freeSpot(d, 3, 2)).toEqual({ x: 6, y: 0 });
    // 7 wide clashes with the slicer (columns 4–6, rows 1–4) until row 5
    expect(freeSpot(d, 7, 2)).toEqual({ x: 0, y: 4 });
    expect(freeSpot(d, 6, 2)).toEqual({ x: 6, y: 0 });
    expect(freeSpot(dash(), 12, 1)).toEqual({ x: 0, y: 0 });
  });

  it('lays tiles out on the Excel page in pixels', () => {
    const d = dash();
    // 12 columns of (1200 − 13×10)/12 px with 10 px gaps
    const b = tileBox(d, { ...kpi(), x: 1, y: 1, w: 2, h: 2 });
    expect(b.x).toBeCloseTo(10 + (1070 / 12 + 10), 6);
    expect(b.y).toBe(80);
    expect(b.w).toBeCloseTo(2 * 1070 / 12 + 10, 6);
    expect(b.h).toBe(130);
  });
});

describe('saving to Excel', () => {
  const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

  it('gives Excel a stand-in of charts and cells, and comes back as the dashboard', async () => {
    const wb = screen();
    const res = resolveSource(wb, { table: 'Screen1' })!;
    const chart: ChartTile = { id: 104, kind: 'chart', x: 6, y: 0, w: 6, h: 5, chart: chartOfColumns(res, 'column', 'Catalyst', ['Yield'], 105) };
    const table: TableTile = { id: 106, kind: 'table', x: 0, y: 5, w: 6, h: 5, source: { table: 'Screen1' }, columns: ['Catalyst', 'Yield'], sortBy: 'Yield', descending: true };
    const d = dash(kpi({ title: 'Mean yield', numFmt: '0.0', suffix: ' %' }), slicer(['Pd(OAc)2']), chart, table, { id: 107, kind: 'text', x: 0, y: 10, w: 12, h: 1, text: 'Screen of 14 Oct', bold: true });
    wb.edit('dash', () => wb.addSheet('Dashboard').setDashboard(d));
    const bytes = await writeXlsx(wb, pictures);
    const f = unzipSync(bytes);
    // the stand-in: an Excel chart and the values as they show (slicer applied)
    expect(Object.keys(f)).toContain('xl/charts/chart1.xml');
    expect(strFromU8(f['xl/charts/chart1.xml'])).toContain('<c:barChart>');
    const strings = strFromU8(f['xl/sharedStrings.xml']);
    expect(strings).toContain('Mean yield');
        expect(strings).toContain('Showing Catalyst: Pd(OAc)2');
    expect(strings).toContain('Screen of 14 Oct');
    const sheet2 = strFromU8(f['xl/worksheets/sheet2.xml']);
    // the headline number spans its tile in Excel (no ####)
    expect(sheet2).toMatch(/<mergeCell ref="A2:[D-F]2"\/>/);
    // the headline number is a number in Excel, with the suffix in its format
    expect(sheet2).toMatch(/<c r="A2" s="\d+"><v>81<\/v><\/c>/);
    expect(strFromU8(f['xl/styles.xml'])).toContain('formatCode="0.0&quot; %&quot;"');
    // the table tile (title in row 19, headings in 20): the slicer's rows, sorted largest first
    const at = (ref: string) => sheet2.match(new RegExp(`<c r="${ref}"[^>]*>(?:<f>[^<]*</f>)?<v>([^<]*)</v>`))?.[1];
    expect([at('B21'), at('B22'), at('B23'), at('B24')]).toEqual(['90', '81', '72', undefined]);
    // the chart reads cells under itself holding what the tile shows (only Pd(OAc)2 rows)
    const part = strFromU8(f['xl/charts/chart1.xml']);
    expect(part).toMatch(/<c:f>Dashboard!\$[A-Z]+\$2:\$[A-Z]+\$4<\/c:f>/);
    expect(part).not.toContain('Screen!');

    const back = await readXlsx(bytes);
    const s = back.book.sheets[1];
    expect(s.dashboard).toEqual(d);
    expect(s.charts).toEqual([]);
    expect(s.lastRow).toBeLessThan(0);
    expect(back.warnings.join(' ')).not.toMatch(/picture|chart/i);
  });
});

describe('combining rows with the same label', () => {
  it('averages each catalyst, in first-seen order, with the spread as error bars', async () => {
    const { groupSeries, labelsRepeat } = await import('../src/sheet/dashboard');
    const wb = screen();
    const res = resolveSource(wb, { table: 'Screen1' })!;
    const c = chartOfColumns(res, 'column', 'Catalyst', ['Yield'], 9);
    const data = chartData(wb, wb.sheet, c);
    expect(labelsRepeat(data)).toBe(true);
    const g = groupSeries(data, 'column', 'average');
    expect(g[0].cats).toEqual(['Pd(OAc)2', 'NiCl2', 'CuI']);
    expect(g[0].ys[0]).toBeCloseTo((72 + 81 + 90) / 3, 9);
    expect(g[0].ys[1]).toBeCloseTo(48.5, 9);
    expect(g[0].plus).toBeUndefined();
    const withBars = groupSeries(data.map((d) => ({ ...d, plus: d.ys.map(() => 1), minus: d.ys.map(() => 1) })), 'column', 'average');
    expect(withBars[0].plus![0]).toBeCloseTo(9, 9); // SD of 72, 81, 90
    expect(withBars[0].plus![2]).toBe(0); // one run only
    expect(groupSeries(data, 'column', 'count')[0].ys).toEqual([3, 2, 1]);
    expect(groupSeries(data, 'scatter', 'average')).toBe(data);
    expect(groupSeries(data, 'column', undefined)).toBe(data);
  });

  it('gives Excel the combined numbers, in cells under the chart', async () => {
    const { dashboardStandIn } = await import('../src/io/xlsx-dashboard');
    const wb = screen();
    const res = resolveSource(wb, { table: 'Screen1' })!;
    const tile: ChartTile = { id: 120, kind: 'chart', x: 0, y: 0, w: 6, h: 5, chart: chartOfColumns(res, 'column', 'Catalyst', ['Yield'], 121), group: 'average' };
    const dsh = wb.edit('d', () => { const x = wb.addSheet('Dash'); x.setDashboard(dash(tile)); return x; });
    const { sheet, data } = dashboardStandIn(wb, dsh);
    expect(data.get(121)![0].cats).toEqual(['Pd(OAc)2', 'NiCl2', 'CuI']);
    expect(sheet.charts[0].series[0].y).toBe('=Dash!$B$2:$B$4');
    expect(sheet.charts[0].series[0].x).toBe('=Dash!$A$2:$A$4');
    expect(sheet.shownText(1, 0)).toBe('Pd(OAc)2');
    expect(sheet.value(2, 1)).toBe(48.5);
  });
});
