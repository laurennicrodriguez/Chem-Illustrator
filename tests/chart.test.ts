// @vitest-environment jsdom
//
// Charts: fitted lines agree with Excel's trendlines and LINEST, the sheet functions for straight
// lines, a chart made from a block of cells reads it as Excel does, references follow inserted
// rows and renamed sheets, axes pick sensible ticks, and charts go to Excel and come back.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { fitPoints, fitAt, fitEquation, r2Text, fitNumber } from '../src/sheet/fit';
import {
  Chart, chartFromRange, chartData, refText, readRef, refValues, niceTicks, logTicks, adjustChart, sameChartData,
} from '../src/sheet/chart';
import { textRuns, clipSegment, numAxis, drawChart, chartItems, chartSvg } from '../src/render/chart-draw';
import { VectorContext } from '../src/render/vector';
import { readChartXml, chartXml } from '../src/io/xlsx-chart';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { currentRegion } from '../src/ui/sheet-chart-ui';

const r = (r1: number, c1: number, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

/** First-order kinetics: time (min) and ln([A]/[A]0) in A1:B9 with a header, a second run in C. */
function kinetics(): Workbook {
  const wb = new Workbook();
  const s = wb.sheet;
  const rows = [['Time (min)', 'ln([A]/[A]_0)', 'Run 2'], [0, 0, 0.02], [5, -0.21, -0.19], [10, -0.43, -0.45], [15, -0.62, -0.66], [20, -0.85, -0.83], [30, -1.27, -1.31], [45, -1.88, -1.95], [60, -2.55, -2.5]];
  wb.edit('fill', () => rows.forEach((row, i) => row.forEach((v, j) => s.setInput(i, j, String(v)))));
  return wb;
}

describe('fitted lines', () => {
  it('fits a straight line exactly through points on one', () => {
    const f = fitPoints('linear', [1, 2, 3, 4], [5, 7, 9, 11])!;
    close(f.coef[0], 3); close(f.coef[1], 2); close(f.r2, 1);
    expect(fitEquation(f)).toBe('y = 2x + 3');
    expect(r2Text(f)).toBe('R² = 1.0000');
  });

  it('matches Excel for a noisy line (SLOPE, INTERCEPT, RSQ)', () => {
    const xs = [0, 5, 10, 15, 20, 30, 45, 60], ys = [0, -0.21, -0.43, -0.62, -0.85, -1.27, -1.88, -2.55];
    const f = fitPoints('linear', xs, ys)!;
    // Excel: SLOPE −0.0422920, INTERCEPT 0.0017518, RSQ 0.9998238
    close(f.coef[1], -0.042292, 6); close(f.coef[0], 0.0017518, 6); close(f.r2, 0.9998238, 6);
    expect(fitEquation(f)).toBe('y = −0.04229x + 0.001752');
  });

  it('fixes the intercept when asked (R² then measured from zero, as Excel does)', () => {
    const f = fitPoints('linear', [1, 2, 3], [2.1, 3.9, 6.0], 0)!;
    expect(f.coef[0]).toBe(0);
    close(f.coef[1], (1 * 2.1 + 2 * 3.9 + 3 * 6) / 14, 9);
    expect(f.r2).toBeGreaterThan(0.99);
  });

  it('fits polynomials, exponentials, logarithms and powers', () => {
    const xs = [1, 2, 3, 4, 5];
    const p = fitPoints('poly2', xs, xs.map((x) => 2 * x * x - 3 * x + 1))!;
    close(p.coef[0], 1); close(p.coef[1], -3); close(p.coef[2], 2);
    expect(fitEquation(p)).toBe('y = 2x² − 3x + 1');
    const e = fitPoints('exp', xs, xs.map((x) => 3 * Math.exp(-0.5 * x)))!;
    close(e.coef[0], 3); close(e.coef[1], -0.5);
    expect(fitEquation(e)).toBe('y = 3e^−0.5x');
    const l = fitPoints('log', xs, xs.map((x) => 2 * Math.log(x) + 1))!;
    close(l.coef[0], 2); close(l.coef[1], 1);
    const pw = fitPoints('power', xs, xs.map((x) => 4 * Math.pow(x, 1.5)))!;
    close(pw.coef[0], 4); close(pw.coef[1], 1.5);
    close(fitAt(pw, 9), 4 * 27);
  });

  it('leaves out points a fit cannot use, and gives up with too few', () => {
    const e = fitPoints('exp', [1, 2, 3, 4], [2, -1, 8, 16])!;
    expect(e.n).toBe(3);
    expect(fitPoints('linear', [1], [2])).toBeNull();
    expect(fitPoints('log', [0, -1, 2], [1, 2, 3])).toBeNull();
    expect(fitPoints('linear', [1, NaN, 3], [1, 2, 3])!.n).toBe(2);
  });

  it('writes numbers as Excel writes them in equations', () => {
    expect(fitNumber(0.00012346)).toBe('1.235E−04');
    expect(fitNumber(123456)).toBe('1.235E+05');
    expect(fitNumber(-2.5)).toBe('−2.5');
  });
});

describe('straight-line sheet functions', () => {
  it('works out SLOPE, INTERCEPT, RSQ, CORREL, STEYX and FORECAST', () => {
    const wb = kinetics();
    const s = wb.sheet;
    wb.edit('f', () => {
      s.setInput(10, 0, '=SLOPE(B2:B9,A2:A9)');
      s.setInput(10, 1, '=INTERCEPT(B2:B9,A2:A9)');
      s.setInput(10, 2, '=RSQ(B2:B9,A2:A9)');
      s.setInput(11, 0, '=CORREL(A2:A9,B2:B9)');
      s.setInput(11, 1, '=STEYX(B2:B9,A2:A9)');
      s.setInput(11, 2, '=FORECAST(90,B2:B9,A2:A9)');
      s.setInput(12, 0, '=SLOPE(B2:B3,A2:A2)');
    });
    close(s.value(10, 0) as number, -0.042292, 6);
    close(s.value(10, 1) as number, 0.0017518, 6);
    close(s.value(10, 2) as number, 0.9998238, 6);
    close(s.value(11, 0) as number, -Math.sqrt(0.9998238), 6);
    expect(s.value(11, 1) as number).toBeGreaterThan(0);
    close(s.value(11, 2) as number, 0.0017518 - 0.042292 * 90, 4);
    expect(String(s.value(12, 0))).toMatch(/#N\/A|#DIV/);
  });
});

describe('charts of cells', () => {
  it('reads a block with a header row: first column x, the others series', () => {
    const wb = kinetics();
    const c = chartFromRange(wb.sheet, r(0, 0, 8, 2), 'scatter');
    expect(c.series).toEqual([
      { name: '=Sheet1!$B$1', x: '=Sheet1!$A$2:$A$9', y: '=Sheet1!$B$2:$B$9' },
      { name: '=Sheet1!$C$1', x: '=Sheet1!$A$2:$A$9', y: '=Sheet1!$C$2:$C$9' },
    ]);
    expect(c.x.title).toBe('Time (min)');
    expect(c.legend).toBe('right');
    expect(c.at).toEqual({ row: 0, col: 4, dx: 0, dy: 0 });
    const data = chartData(wb, wb.sheet, c);
    expect(data[0].name).toBe('ln([A]/[A]_0)');
    expect(data[0].xs).toEqual([0, 5, 10, 15, 20, 30, 45, 60]);
    expect(data[1].ys[0]).toBe(0.02);
  });

  it('uses a first column of text as category labels', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('f', () => [['Ligand', 'Yield'], ['L1', 92], ['L2', 88]].forEach((row, i) => row.forEach((v, j) => s.setInput(i, j, String(v)))));
    const c = chartFromRange(s, r(0, 0, 2, 1), 'column');
    expect(c.series).toEqual([{ name: '=Sheet1!$B$1', x: '=Sheet1!$A$2:$A$3', y: '=Sheet1!$B$2:$B$3' }]);
    expect(c.title).toBe('Yield');
    expect(chartData(wb, s, c)[0].cats).toEqual(['L1', 'L2']);
  });

  it('finds the table around one cell', () => {
    const wb = kinetics();
    expect(currentRegion(wb.sheet, 3, 1)).toEqual(r(0, 0, 8, 2));
  });

  it('reads references, and leaves out rows a filter hides unless asked', () => {
    const wb = kinetics();
    const s = wb.sheet;
    expect(refText('My data', r(1, 0, 8, 0))).toBe("='My data'!$A$2:$A$9");
    expect(readRef(wb, 'B2:B4', s)?.range).toEqual(r(1, 1, 3, 1));
    expect(readRef(wb, '=Nowhere!B2', s)).toBeNull();
    wb.edit('hide', () => s.setRowHidden(2, true));
    expect(refValues(wb, '=Sheet1!$A$2:$A$4', s)).toEqual([0, 10]);
    expect(refValues(wb, '=Sheet1!$A$2:$A$4', s, true)).toEqual([0, 5, 10]);
  });

  it('works out error bars: fixed, percent, standard deviation and from cells', () => {
    const wb = kinetics();
    const s = wb.sheet;
    const base = chartFromRange(s, r(0, 0, 8, 1), 'scatter');
    const withErr = (e: Chart['series'][0]['errors']) => chartData(wb, s, { ...base, series: [{ ...base.series[0], errors: e }] })[0];
    expect(withErr({ kind: 'fixed', value: 0.1 }).plus![3]).toBe(0.1);
    close(withErr({ kind: 'percent', value: 10 }).plus![7], 0.255);
    const sd = withErr({ kind: 'stdev', value: 1 }).plus![0];
    close(sd, 0.8751479, 6); // STDEV.S of the column, as Excel's error bars use
    const cells = withErr({ kind: 'cells', plus: '=Sheet1!$C$2:$C$9' });
    expect(cells.plus![1]).toBe(-0.19);
    expect(cells.minus).toEqual(cells.plus);
  });

  it('follows inserted rows, moved corners and renamed sheets', () => {
    const wb = kinetics();
    const s = wb.sheet;
    const c = chartFromRange(s, r(0, 0, 8, 1), 'scatter');
    wb.edit('chart', () => s.setCharts([c]));
    wb.edit('rows', () => s.insertRows(0, 2));
    expect(s.charts[0].series[0].y).toBe('=Sheet1!$B$4:$B$11');
    expect(s.charts[0].at.row).toBe(2);
    wb.edit('rename', () => s.rename('Kinetics'));
    expect(s.charts[0].series[0].x).toBe('=Kinetics!$A$4:$A$11');
    wb.undo(); wb.undo();
    expect(s.charts[0].series[0].y).toBe('=Sheet1!$B$2:$B$9');
    expect(adjustChart(c, 'Other', { sheet: 'Sheet1', axis: 'row', at: 0, count: 1 }).series[0].y).toBe('=Sheet1!$B$3:$B$10');
  });

  it('a deleted corner row leaves the chart where the rows were', () => {
    const wb = kinetics();
    const s = wb.sheet;
    wb.edit('chart', () => s.setCharts([{ ...chartFromRange(s, r(0, 0, 8, 1), 'line'), at: { row: 12, col: 4, dx: 3, dy: 4 } }]));
    wb.edit('del', () => s.deleteRows(10, 5));
    expect(s.charts[0].at).toEqual({ row: 10, col: 4, dx: 3, dy: 4 });
  });
});

describe('axes and drawing', () => {
  it('picks round ticks', () => {
    expect(niceTicks(0, 60, 6).ticks).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(niceTicks(-2.55, 0.02, 7)).toMatchObject({ min: -3, max: 0.5, step: 0.5 });
    expect(niceTicks(0, 1, 5, 0.25).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(logTicks(3, 4000).ticks).toEqual([1, 10, 100, 1000, 10000]);
  });

  it('starts columns at zero, and other charts only when the numbers are near it', () => {
    expect(numAxis(80, 95, {}, 'always').min).toBe(0);
    expect(numAxis(80, 95, {}, 'auto').min).toBeGreaterThan(0);
    expect(numAxis(10, 95, {}, 'auto').min).toBe(0);
    const set = numAxis(80, 95, { min: 70, max: 100, step: 10 }, 'always');
    expect([set.min, set.max, set.ticks]).toEqual([70, 100, [70, 80, 90, 100]]);
    expect(numAxis(0, 1, { reverse: true }, 'auto').frac(1)).toBe(0);
  });

  it('reads sub- and superscripts in titles', () => {
    expect(textRuns('k_{obs} (s^{-1})')).toEqual([{ t: 'k', pos: 'base' }, { t: 'obs', pos: 'sub' }, { t: ' (s', pos: 'base' }, { t: '-1', pos: 'sup' }, { t: ')', pos: 'base' }]);
    expect(textRuns('H_2O')).toEqual([{ t: 'H', pos: 'base' }, { t: '2', pos: 'sub' }, { t: 'O', pos: 'base' }]);
    expect(textRuns('a\\_b')).toEqual([{ t: 'a_b', pos: 'base' }]);
  });

  it('cuts lines off at the edge of the plot', () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(clipSegment(-5, 5, 15, 5, box)).toEqual([0, 5, 10, 5]);
    expect(clipSegment(-5, -5, -1, -1, box)).toBeNull();
    expect(clipSegment(2, 2, 3, 3, box)).toEqual([2, 2, 3, 3]);
  });

  it('draws a fitted line with its equation, and pictures in points', () => {
    const wb = kinetics();
    const s = wb.sheet;
    const c = chartFromRange(s, r(0, 0, 8, 1), 'scatter');
    c.series[0].fit = { kind: 'linear', showEq: true, showR2: true };
    const v = new VectorContext();
    const hits = drawChart(v, c, chartData(wb, s, c), c.w, c.h);
    expect(hits.fits[0]!.kind).toBe('linear');
    expect(hits.fitLabels).toHaveLength(1);
    const texts = v.items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
    expect(texts).toContain('y = −0.04229x + 0.001752');
    expect(texts).toContain('R² = 0.9998');
    // the dashed fitted line is there
    expect(v.items.some((i) => i.kind === 'path' && i.stroke?.color === '#4472c4' && i.segs.length > 20)).toBe(true);
    const items = chartItems(c, chartData(wb, s, c));
    const svg = chartSvg(c, chartData(wb, s, c));
    expect(svg).toContain('width="360pt" height="217.5pt"');
    expect(items.length).toBe(v.items.length);
    // an upward axis title
    const up = { ...c, y: { ...c.y, title: 'ln([A]/[A]_0)' } };
    expect(chartSvg(up, chartData(wb, s, up))).toContain('transform="rotate(-90');
  });
});

describe('charts in Excel files', () => {
  const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

  it('writes a chart part Excel reads, with its trendline, and reads it back', async () => {
    const wb = kinetics();
    const s = wb.sheet;
    const c = chartFromRange(s, r(0, 0, 8, 2), 'scatter');
    c.title = 'First-order decay';
    c.y = { ...c.y, title: 'ln([A]/[A]_0)', min: -3 };
    c.series[0].fit = { kind: 'linear', showEq: true, showR2: true, labelAt: { x: 0.5, y: 0.1 } };
    c.series[1].errors = { kind: 'percent', value: 5 };
    wb.edit('chart', () => s.setCharts([c]));
    const bytes = await writeXlsx(wb, pictures);
    const f = unzipSync(bytes);
    const part = strFromU8(f['xl/charts/chart1.xml']);
    expect(part).toContain('<c:scatterChart>');
    expect(part).toContain('<c:f>Sheet1!$A$2:$A$9</c:f>');
    expect(part).toContain('<c:trendlineType val="linear"/>');
    expect(part).toContain('<c:dispEq val="1"/>');
    expect(part).toContain('<c:errValType val="percentage"/>');
    expect(part).toContain('baseline="-25000"');
    expect(strFromU8(f['xl/drawings/drawing1.xml'])).toContain('name="Chart ' + c.id + '"');
    expect(strFromU8(f['[Content_Types].xml'])).toContain('drawingml.chart+xml');
    expect(strFromU8(f['xl/drawings/_rels/drawing1.xml.rels'])).toContain('relationships/chart');

    // our own copy comes back (it keeps where the equation was dragged to)
    const back = (await readXlsx(bytes)).book.sheet;
    expect(back.charts).toHaveLength(1);
    expect(back.charts[0].series[0].fit?.labelAt).toEqual({ x: 0.5, y: 0.1 });
    expect(back.charts[0].at).toEqual(c.at);

    // without it, Excel's chart is read
    delete f['customXml/item1.xml'];
    const fromExcel = (await readXlsx(zipSync(f))).book.sheet.charts[0];
    expect(fromExcel).toMatchObject({ kind: 'scatter', title: 'First-order decay', legend: 'right' });
    expect(fromExcel.series[0]).toMatchObject({ name: '=Sheet1!$B$1', x: '=Sheet1!$A$2:$A$9', y: '=Sheet1!$B$2:$B$9', fit: { kind: 'linear', showEq: true, showR2: true } });
    expect(fromExcel.series[1].errors).toEqual({ kind: 'percent', value: 5 });
    expect(fromExcel.y).toMatchObject({ title: 'ln([A]/[A]_{0})', min: -3 });
    expect(Math.abs(fromExcel.w - c.w)).toBeLessThan(2);
    expect(sameChartData(fromExcel, c)).toBe(true);
  });

  it('reads a column chart as Excel writes one (theme colours, stacked, bar direction)', () => {
    const xmlText = `<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>
      <c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>
        <c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Data!$B$1</c:f></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>
          <c:cat><c:strRef><c:f>Data!$A$2:$A$5</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Data!$B$2:$B$5</c:f></c:numRef></c:val></c:ser>
        <c:gapWidth val="150"/><c:overlap val="100"/><c:axId val="1"/><c:axId val="2"/></c:barChart>
      <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="2"/></c:catAx>
      <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:max val="100"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/>
        <c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Yield (%)</a:t></a:r></a:p></c:rich></c:tx></c:title><c:crossAx val="1"/></c:valAx>
      </c:plotArea><c:legend><c:legendPos val="b"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const got = readChartXml(doc, { row: 1, col: 3, dx: 0, dy: 0 }, 400, 250, 99)!;
    expect(got.chart).toMatchObject({ kind: 'bar', stacked: true, legend: 'bottom', x: { title: 'Yield (%)', max: 100, grid: true } });
    expect(got.chart.series).toEqual([{ name: '=Data!$B$1', x: '=Data!$A$2:$A$5', y: '=Data!$B$2:$B$5' }]);
    expect(got.partial).toBe(false);
  });

  it('writes every kind of chart', () => {
    const wb = kinetics();
    for (const kind of ['line', 'column', 'bar', 'area', 'pie'] as const) {
      const c = chartFromRange(wb.sheet, r(0, 0, 8, 2), kind);
      const xmlText = chartXml(c, chartData(wb, wb.sheet, c));
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
      expect(readChartXml(doc, c.at, c.w, c.h, 1)!.chart.kind).toBe(kind);
    }
  });
});
