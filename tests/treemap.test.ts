// @vitest-environment jsdom
//
// Treemaps and decomposition trees: rows broken down by one column of categories after another,
// each box or node as big as the rows under it. A treemap is drilled into (and back up its trail
// of categories); a decomposition tree is expanded a node at a time. On a dashboard their boxes
// and nodes filter the other tiles; in Excel they are bars of the same cells, and come back as
// themselves.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { newTable } from '../src/sheet/table-styles';
import { chartData, chartFromRange, sameChartData, CHART_NAMES, isLevelled, type Chart, type SeriesData } from '../src/sheet/chart';
import { hierarchy, nodeAt, validPath, squarify } from '../src/sheet/hierarchy';
import { Dashboard, KpiTile, ChartTile, newDashboard, resolveSource, kpiValue, filterMask, levelsOfSource } from '../src/sheet/dashboard';
import { drawChart, partHit, type ChartPart, type ChartHits } from '../src/render/chart-draw';
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
const boxes = (hits: ChartHits) => (hits.parts ?? []).filter((p): p is Extract<ChartPart, { shape: 'box' }> => p.shape === 'box');
const middle = (p: Extract<ChartPart, { shape: 'box' }>) => [p.box.x + p.box.w / 2, p.box.y + p.box.h / 2] as const;
const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

describe('the tree of a chart of levels', () => {
  it('adds up each node under its parent, largest first', () => {
    const d = series(['A', 'A', 'B'], ['x', 'y', 'x']);
    d[0].ys = [5, 2, 4];
    const root = hierarchy(d);
    expect(root.value).toBe(11);
    expect(root.children.map((n) => [n.label, n.value])).toEqual([['A', 7], ['B', 4]]);
    // the same category under two parents is two nodes
    expect(nodeAt(root, ['A'])!.children.map((n) => [n.label, n.value, n.path])).toEqual([['x', 5, ['A', 'x']], ['y', 2, ['A', 'y']]]);
    expect(nodeAt(root, ['B', 'x'])!.value).toBe(4);
    expect(nodeAt(root, ['B', 'y'])).toBeNull();
  });

  it('counts each row once without numbers, and a blank cell ends a row there', () => {
    const root = hierarchy(series(['A', 'A', 'B'], ['x', '', 'x'], ['p', 'q', 'p']));
    expect(root.children.map((n) => n.value)).toEqual([2, 1]);
    // the second row counts in A, and in nothing under it
    expect(nodeAt(root, ['A'])!.children.map((n) => n.label)).toEqual(['x']);
    expect(nodeAt(root, ['A', 'x', 'p'])!.value).toBe(1);
  });

  it('keeps as much of a path as still leads somewhere', () => {
    const root = hierarchy(series(['A', 'B'], ['x', 'y']));
    expect(validPath(root, ['A', 'x'])).toEqual(['A', 'x']);
    expect(validPath(root, ['A', 'y'])).toEqual(['A']);
    expect(validPath(root, ['C'])).toEqual([]);
    expect(validPath(root, undefined)).toEqual([]);
  });

  it('squarifies boxes in proportion to their values, filling the space', () => {
    const vals = [6, 6, 4, 3, 2, 2, 1];
    const r = squarify(vals, { x: 0, y: 0, w: 6, h: 4 });
    r.forEach((b, i) => expect(b.w * b.h).toBeCloseTo(vals[i], 6));
    // none spills out, none overlaps
    for (const b of r) { expect(b.x).toBeGreaterThanOrEqual(-1e-9); expect(b.y).toBeGreaterThanOrEqual(-1e-9); expect(b.x + b.w).toBeLessThanOrEqual(6 + 1e-9); expect(b.y + b.h).toBeLessThanOrEqual(4 + 1e-9); }
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(ox > 1e-9 && oy > 1e-9).toBe(false);
    }
    // near square: the worst no more stretched than 3 to 1 for these
    expect(Math.max(...r.map((b) => Math.max(b.w / b.h, b.h / b.w)))).toBeLessThan(3);
    // zero gets no room
    expect(squarify([3, 0, 1], { x: 0, y: 0, w: 2, h: 2 })[1]).toMatchObject({ w: 0, h: 0 });
  });
});

describe('a treemap', () => {
  it('is made from a block of cells as a Sankey chart is', () => {
    const wb = drugs();
    const c = chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'treemap');
    expect(c.kind).toBe('treemap');
    expect(c.series.map((s) => s.x)).toEqual(['=Drugs!$A$2:$A$7', '=Drugs!$B$2:$B$7', '=Drugs!$C$2:$C$7']);
    expect(c.series.every((s) => s.y === '=Drugs!$D$2:$D$7')).toBe(true);
    expect(CHART_NAMES.treemap).toBe('Treemap');
    expect(isLevelled('treemap') && isLevelled('decomp') && isLevelled('sankey') && !isLevelled('pie')).toBe(true);
  });

  it('draws a box for each category holding the next level, each as big as its rows', () => {
    const wb = drugs();
    const c = chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'treemap');
    const hits = drawChart(new VectorContext(), c, chartData(wb, wb.sheet, c), c.w, c.h);
    const b = boxes(hits);
    // two groups (their bands across the top), each holding its two ring sizes
    const heads = b.filter((p) => p.pick.length === 1);
    const kids = b.filter((p) => p.pick.length === 2);
    expect(heads.map((p) => p.pick[0].value)).toEqual(['Saturated', 'Aromatic']);
    expect(kids.map((p) => p.pick.map((q) => q.value))).toEqual([['Saturated', '6'], ['Saturated', '5'], ['Aromatic', '6'], ['Aromatic', '5']]);
    // areas in proportion: six-membered aromatic (67) against five-membered (15)
    const area = (p: Extract<ChartPart, { shape: 'box' }>) => p.box.w * p.box.h;
    expect(area(kids[2]) / area(kids[3])).toBeGreaterThan(3);
    // a click picks a box's whole path, and leads into the box it is in
    const [x, y] = middle(kids[0]);
    expect(partHit(hits, x, y)).toMatchObject({ pick: [{ level: 0, value: 'Saturated' }, { level: 1, value: '6' }], drill: ['Saturated'] });
  });

  it('drilled in, shows what is under the category, with a trail back up', () => {
    const wb = drugs();
    const c: Chart = { ...chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'treemap'), path: ['Aromatic'] };
    const hits = drawChart(new VectorContext(), c, chartData(wb, wb.sheet, c), c.w, c.h);
    const b = boxes(hits);
    // the trail: "All" leads back to the whole
    const all = b.find((p) => !p.pick.length)!;
    expect(all.drill).toEqual([]);
    // the ring sizes of aromatic rings, holding their heterocycles
    const heads = b.filter((p) => p.pick.length === 2);
    expect(heads.map((p) => p.pick[1].value)).toEqual(['6', '5']);
    const leaves = b.filter((p) => p.pick.length === 3).map((p) => p.pick[2].value);
    expect(leaves).toEqual(['Pyridine', 'Pyrimidine', 'Imidazole']);
    // a path no longer there shows the whole
    const gone = drawChart(new VectorContext(), { ...c, path: ['Fused'] }, chartData(wb, wb.sheet, c), c.w, c.h);
    expect(boxes(gone).some((p) => !p.pick.length)).toBe(false);
  });

  it('drilled to the last level, its boxes go no further', () => {
    const wb = drugs();
    const c: Chart = { ...chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'treemap'), path: ['Saturated', '6'] };
    const b = boxes(drawChart(new VectorContext(), c, chartData(wb, wb.sheet, c), c.w, c.h));
    const leaves = b.filter((p) => p.pick.length === 3);
    expect(leaves.map((p) => p.pick[2].value)).toEqual(['Piperidine', 'Piperazine']);
    expect(leaves.every((p) => !p.drill)).toBe(true);
  });
});

describe('a decomposition tree', () => {
  const tree = (path?: string[]): { wb: Workbook; c: Chart } => {
    const wb = drugs();
    const c = chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, 'decomp');
    return { wb, c: path ? { ...c, path } : c };
  };

  it('shows the total and the first level until a node is expanded', () => {
    const { wb, c } = tree();
    expect(c.kind).toBe('decomp');
    const b = boxes(drawChart(new VectorContext(), c, chartData(wb, wb.sheet, c), c.w, c.h));
    expect(b.map((p) => p.pick.map((q) => q.value).join('/'))).toEqual(['', 'Saturated', 'Aromatic']);
    // the total closes everything up; a node expands
    expect(b[0].drill).toEqual([]);
    expect(b[2].drill).toEqual(['Aromatic']);
  });

  it('expanded, splits the node by the next level, and clicking it again closes it up', () => {
    const { wb, c } = tree(['Saturated', '6']);
    const hits = drawChart(new VectorContext(), c, chartData(wb, wb.sheet, c), c.w, c.h);
    const b = boxes(hits);
    expect(b.map((p) => p.pick.map((q) => q.value).join('/'))).toEqual(['', 'Saturated', 'Aromatic', 'Saturated/6', 'Saturated/5', 'Saturated/6/Piperidine', 'Saturated/6/Piperazine']);
    const sat = b[1], six = b[3], other = b[4], leaf = b[5];
    // open nodes close up to their parent; others open; the last level can't
    expect(sat.drill).toEqual([]);
    expect(six.drill).toEqual(['Saturated']);
    expect(other.drill).toEqual(['Saturated', '5']);
    expect(leaf.drill).toBeUndefined();
    const [x, y] = middle(other);
    expect(partHit(hits, x, y)?.pick).toEqual([{ level: 0, value: 'Saturated' }, { level: 1, value: '5' }]);
  });

  it('a long column shows the largest, and how many more', () => {
    const wb = new Workbook(['S']);
    wb.edit('fill', () => { for (let i = 0; i < 40; i++) { wb.sheet.setInput(i, 0, `C${i}`); wb.sheet.setInput(i, 1, String(40 - i)); } });
    const c = { ...chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 39, c2: 1 }, 'decomp'), h: 300 };
    const b = boxes(drawChart(new VectorContext(), c, chartData(wb, wb.sheet, c), c.w, c.h));
    expect(b.length).toBeGreaterThan(3);
    expect(b.length).toBeLessThan(41);
    expect(b[1].pick[0].value).toBe('C0');
  });
});

describe('on a dashboard, and in Excel', () => {
  const kpi = (): KpiTile => ({ id: 201, kind: 'kpi', x: 0, y: 0, w: 3, h: 2, source: { table: 'Drugs1' }, column: 'Drugs', agg: 'sum' });
  const tile = (wb: Workbook, kind: Chart['kind'], pick?: ChartTile['pick']): ChartTile => {
    const res = resolveSource(wb, { table: 'Drugs1' })!;
    return { id: 202, kind: 'chart', x: 3, y: 0, w: 9, h: 6, chart: levelsOfSource(res, ['Aromaticity', 'Ring size', 'Heterocycle'], 'Drugs', 300, kind), ...(pick ? { pick } : {}) };
  };
  const dash = (...tiles: Dashboard['tiles']): Dashboard => ({ ...newDashboard(), tiles });

  it('a picked treemap box filters the other tiles by its whole path', () => {
    const wb = drugs();
    const d = dash(kpi(), tile(wb, 'treemap', [{ level: 0, value: 'Saturated' }, { level: 1, value: '6' }]));
    expect(kpiValue(wb, kpi(), filterMask(wb, d, 201))).toBe(76);
    expect(kpiValue(wb, kpi(), filterMask(wb, d, 202))).toBe(183);
  });

  it('a decomposition tree tile, expanded, filters by the node it expanded', () => {
    const wb = drugs();
    const t = tile(wb, 'decomp', [{ level: 0, value: 'Aromatic' }, { level: 1, value: '5' }]);
    t.chart = { ...t.chart, path: ['Aromatic', '5'] };
    const d = dash(kpi(), t);
    expect(kpiValue(wb, kpi(), filterMask(wb, d, 201))).toBe(15);
  });

  it('go to Excel as bars of the same cells, and come back as themselves, drilled and expanded as they were', async () => {
    for (const kind of ['treemap', 'decomp'] as const) {
      const wb = drugs();
      const c: Chart = { ...chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 6, c2: 3 }, kind), path: ['Aromatic'] };
      expect(sameChartData(c, { ...c, kind: 'column' })).toBe(true);
      wb.edit('chart', () => wb.sheet.setCharts([c]));
      const back = await readXlsx(await writeXlsx(wb, pictures));
      const got = back.book.sheets[0].charts[0];
      expect(got.kind).toBe(kind);
      expect(got.path).toEqual(['Aromatic']);
      expect(got.series.length).toBe(3);
    }
  });

  it('keeps a treemap tile drilled in, in the file', async () => {
    const wb = drugs();
    const t = tile(wb, 'treemap');
    t.chart = { ...t.chart, path: ['Saturated'] };
    const d = dash(kpi(), t);
    wb.edit('dash', () => wb.addSheet('Dashboard').setDashboard(d));
    const back = await readXlsx(await writeXlsx(wb, pictures));
    expect(back.book.sheets[1].dashboard).toEqual(d);
  });
});
