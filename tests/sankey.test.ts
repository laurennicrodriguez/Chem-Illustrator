// @vitest-environment jsdom
//
// Sankey charts and picking parts of dashboard charts: rows flow from one column of categories
// to the next, each node and band as big as the rows it carries; clicking a bar, slice, node or
// band filters the other tiles of a dashboard (the chart clicked shows its pick as a highlight);
// a Sankey goes to Excel as bars of the same cells and comes back as a Sankey.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { newTable } from '../src/sheet/table-styles';
import { chartData, chartFromRange, CHART_NAMES, type SeriesData } from '../src/sheet/chart';
import { sankeyFlows } from '../src/sheet/sankey';
import {
  Dashboard, KpiTile, ChartTile, newDashboard, resolveSource, kpiValue, filterMask, pickMask, unfiltered, filtered, levelsOfSource, chartOfColumns, groupSeries,
} from '../src/sheet/dashboard';
import { drawChart, partAt } from '../src/render/chart-draw';
import { VectorContext } from '../src/render/vector';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';

/** FDA-approved drugs by heterocycle (a small part of the real numbers), made a table. */
function drugs(): Workbook {
  const wb = new Workbook(['Drugs']);
  const s = wb.sheet;
  const rows: (string | number)[][] = [
    ['Aromaticity', 'Ring size', 'Heterocycle', 'Drugs'],
    ['Aromatic', 6, 'Pyridine', 54],
    ['Aromatic', 6, 'Pyrimidine', 13],
    ['Aromatic', 5, 'Imidazole', 15],
    ['Saturated', 6, 'Piperidine', 40],
    ['Saturated', 6, 'Piperazine', 36],
    ['Saturated', 5, 'Pyrrolidine', 25],
  ];
  wb.edit('fill', () => {
    rows.forEach((row, i) => row.forEach((v, j) => s.setInput(i, j, String(v))));
    s.setTables([{ ...newTable({ r1: 0, c1: 0, r2: 6, c2: 3 }, []), name: 'Drugs1' }]);
  });
  return wb;
}

const series = (...levels: string[][]): SeriesData[] => levels.map((cats, i) => ({ name: `L${i}`, cats, xs: cats.map((_, j) => j + 1), ys: [], color: '#000', index: i }));

describe('flows', () => {
  it('adds up each node and each band, largest node first', () => {
    const d = series(['A', 'A', 'B'], ['x', 'y', 'x']);
    d[0].ys = [5, 2, 4];
    const f = sankeyFlows(d);
    expect(f.levels[0]).toEqual([{ level: 0, label: 'A', value: 7 }, { level: 0, label: 'B', value: 4 }]);
    expect(f.levels[1].map((n) => [n.label, n.value])).toEqual([['x', 9], ['y', 2]]);
    expect(f.links.map((l) => [l.from, l.to, l.value])).toEqual([['A', 'x', 5], ['A', 'y', 2], ['B', 'x', 4]]);
  });

  it('counts each row once without numbers, and a blank cell ends a row there', () => {
    const f = sankeyFlows(series(['A', 'A', 'B'], ['x', '', 'x'], ['p', 'q', 'p']));
    expect(f.levels[0].map((n) => n.value)).toEqual([2, 1]);
    // the second row stops at its blank, and starts again after it with no band into it
    expect(f.links.filter((l) => l.level === 1).map((l) => [l.from, l.to, l.value])).toEqual([['x', 'p', 2]]);
    expect(f.levels[2].map((n) => [n.label, n.value])).toEqual([['p', 2], ['q', 1]]);
  });
});

describe('a Sankey chart', () => {
  it('is made from a block of cells: the last column of numbers carries, every other column is a level', () => {
    const wb = drugs();
    const c = chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'sankey');
    expect(c.kind).toBe('sankey');
    expect(c.series.map((s) => s.x)).toEqual(['=Drugs!$A$2:$A$7', '=Drugs!$B$2:$B$7', '=Drugs!$C$2:$C$7']);
    expect(c.series.every((s) => s.y === '=Drugs!$D$2:$D$7')).toBe(true);
    expect(CHART_NAMES.sankey).toMatch(/Sankey/);
  });

  it('draws a node for each category and a band for each flow, and a click picks one', () => {
    const wb = drugs();
    const c = chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'sankey');
    const hits = drawChart(new VectorContext(), c, chartData(wb, wb.sheet, c), c.w, c.h);
    const boxes = hits.parts!.filter((p) => p.shape === 'box');
    const bands = hits.parts!.filter((p) => p.shape === 'band');
    expect(boxes.length).toBe(2 + 2 + 6);
    expect(bands.length).toBe(4 + 6);
    const pyridine = boxes.find((p) => p.shape === 'box' && p.pick[0].value === 'Pyridine')!;
    if (pyridine.shape !== 'box') throw new Error();
    expect(partAt(hits, pyridine.box.x + 2, pyridine.box.y + pyridine.box.h / 2)).toEqual([{ level: 2, value: 'Pyridine' }]);
    // the middle of a band picks both its ends
    const b = bands[0];
    if (b.shape !== 'band') throw new Error();
    const x = (b.x0 + b.x1) / 2, y = ((b.top0 + b.top1) / 2 + (b.bottom0 + b.bottom1) / 2) / 2;
    expect(partAt(hits, x, y)).toEqual(b.pick);
    expect(b.pick.map((p) => p.level)).toEqual([0, 1]);
    // the tallest node is the fullest category: six-membered rings, 143 drugs
    const tall = boxes.reduce((a, p) => (p.shape === 'box' && a.shape === 'box' && p.box.h > a.box.h ? p : a));
    expect(tall.pick[0].value).toBe('6');
  });

  it('goes to Excel as bars of the same cells, and comes back a Sankey', async () => {
    const wb = drugs();
    const c = chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'sankey');
    wb.edit('chart', () => wb.sheet.setCharts([c]));
    const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
    const back = await readXlsx(await writeXlsx(wb, pictures));
    const got = back.book.sheets[0].charts[0];
    expect(got.kind).toBe('sankey');
    expect(got.series.length).toBe(3);
  });
});

describe('picking parts of dashboard charts', () => {
  const kpi = (): KpiTile => ({ id: 201, kind: 'kpi', x: 0, y: 0, w: 3, h: 2, source: { table: 'Drugs1' }, column: 'Drugs', agg: 'sum' });
  const flowTile = (wb: Workbook, pick?: ChartTile['pick']): ChartTile => {
    const res = resolveSource(wb, { table: 'Drugs1' })!;
    return { id: 202, kind: 'chart', x: 3, y: 0, w: 9, h: 6, chart: levelsOfSource(res, ['Aromaticity', 'Ring size', 'Heterocycle'], 'Drugs', 300), ...(pick ? { pick } : {}) };
  };
  const dash = (...tiles: Dashboard['tiles']): Dashboard => ({ ...newDashboard(), tiles });

  it('a picked Sankey node filters the other tiles, but not its own chart', () => {
    const wb = drugs();
    const d = dash(kpi(), flowTile(wb, [{ level: 0, value: 'Aromatic' }]));
    expect(kpiValue(wb, kpi(), filterMask(wb, d, 201))).toBe(54 + 13 + 15);
    expect(kpiValue(wb, kpi(), filterMask(wb, d, 202))).toBe(183);
    expect(filtered(d)).toBe(true);
    expect(filtered(unfiltered(d))).toBe(false);
  });

  it('a picked band filters by both its ends', () => {
    const wb = drugs();
    const d = dash(kpi(), flowTile(wb, [{ level: 1, value: '6' }, { level: 2, value: 'Piperidine' }]));
    expect(kpiValue(wb, kpi(), filterMask(wb, d, 201))).toBe(40);
  });

  it('a picked bar or slice filters by its label, and the chart highlights what is left', () => {
    const wb = drugs();
    const res = resolveSource(wb, { table: 'Drugs1' })!;
    const bars: ChartTile = { id: 203, kind: 'chart', x: 0, y: 6, w: 6, h: 5, chart: chartOfColumns(res, 'column', 'Aromaticity', ['Drugs'], 301), group: 'sum', pick: [{ level: 0, value: 'Saturated' }] };
    const d = dash(kpi(), bars);
    expect(kpiValue(wb, kpi(), filterMask(wb, d, 201))).toBe(101);
    // the chart: both bars drawn (the other faded), and a click on a bar picks its label
    const all = groupSeries(chartData(wb, wb.sheet, bars.chart, filterMask(wb, d, 203)), 'column', 'sum');
    const lit = groupSeries(chartData(wb, wb.sheet, bars.chart, pickMask(wb, d, undefined, 203)), 'column', 'sum');
    expect(all[0].cats).toEqual(['Aromatic', 'Saturated']);
    expect(lit[0].cats).toEqual(['Saturated']);
    const hits = drawChart(new VectorContext(), bars.chart, all, 480, 290, lit);
    const boxes = hits.parts!.filter((p) => p.shape === 'box');
    expect(boxes.map((p) => p.pick[0].value)).toEqual(['Aromatic', 'Saturated']);
    const pie = { ...bars.chart, kind: 'pie' as const };
    const ph = drawChart(new VectorContext(), pie, all, 480, 290);
    expect(ph.parts!.filter((p) => p.shape === 'slice').length).toBe(2);
  });

  it('keeps a pick in the file', async () => {
    const wb = drugs();
    const d = dash(kpi(), flowTile(wb, [{ level: 2, value: 'Pyridine' }]));
    wb.edit('dash', () => wb.addSheet('Dashboard').setDashboard(d));
    const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
    const back = await readXlsx(await writeXlsx(wb, pictures));
    expect(back.book.sheets[1].dashboard).toEqual(d);
  });
});
