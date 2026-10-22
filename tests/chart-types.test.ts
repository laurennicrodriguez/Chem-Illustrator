// @vitest-environment jsdom
//
// The newer kinds of chart: combo (columns and lines, with a second axis), histogram, box and
// whisker, bubble and radar. Their numbers are worked out as Excel works them out, they draw, and
// they go to Excel, Word and PowerPoint as those programs' own chart types and come back.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { Chart, ChartKind, chartFromRange, chartData, CHART_NAMES, sameChartData } from '../src/sheet/chart';
import { histogram, quartile, boxStats, boxGroups } from '../src/sheet/chart-stats';
import { drawChart, chartSvg } from '../src/render/chart-draw';
import { VectorContext } from '../src/render/vector';
import { readChartXml, chartXml } from '../src/io/xlsx-chart';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { ChartBox, boxData, newChartBox, sameBoxData } from '../src/sheet/chart-box';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import { Doc, type TextRun } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const r = (r1: number, c1: number, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const parse = (t: string) => new DOMParser().parseFromString(t, 'application/xml');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

function sheetOf(rows: (string | number)[][]): Workbook {
  const wb = new Workbook();
  wb.edit('fill', () => rows.forEach((row, i) => row.forEach((v, j) => wb.sheet.setInput(i, j, String(v)))));
  return wb;
}

describe('histograms', () => {
  const xs = [1, 2, 2, 3, 3, 3, 4, 4, 5, 10];

  it('puts numbers in bins of a set width, each holding up to and including its end', () => {
    const h = histogram(xs, { width: 2 });
    expect(h.labels).toEqual(['[1, 3]', '(3, 5]', '(5, 7]', '(7, 9]', '(9, 11]']);
    expect(h.counts).toEqual([6, 3, 0, 0, 1]);
  });

  it('takes a number of bins, or an overflow and underflow bin', () => {
    expect(histogram(xs, { count: 3 }).counts).toEqual([8, 1, 1]);
    const h = histogram(xs, { width: 2, overflow: 5, underflow: 1.5 });
    expect(h.labels).toEqual(['≤ 1.5', '(1.5, 3.5]', '(3.5, 5.5]', '> 5']);
    expect(h.counts).toEqual([1, 5, 3, 1]);
  });

  it('chooses the width by Scott\'s rule when none is given, as Excel does', () => {
    const mean = xs.reduce((a, b) => a + b) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
    const h = histogram(xs);
    expect(h.width).toBeCloseTo((3.5 * sd) / Math.cbrt(xs.length), 9);
    expect(h.counts.reduce((a, b) => a + b)).toBe(xs.length);
  });
});

describe('box and whisker', () => {
  it('works out quartiles as QUARTILE.EXC and QUARTILE.INC', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quartile(s, 0.25, 'exclusive')).toBeCloseTo(2.75);
    expect(quartile(s, 0.75, 'exclusive')).toBeCloseTo(8.25);
    expect(quartile(s, 0.25, 'inclusive')).toBeCloseTo(3.25);
    expect(quartile(s, 0.75, 'inclusive')).toBeCloseTo(7.75);
  });

  it('draws whiskers to the furthest points within 1.5 × the box, the rest as outliers', () => {
    const b = boxStats([100, 1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(b.median).toBeCloseTo(5.5);
    expect(b.outliers).toEqual([100]);
    expect([b.lo, b.hi]).toEqual([1, 9]);
    expect(b.mean).toBeCloseTo(14.5);
  });

  it('makes one box for each label in the first column', () => {
    const g = boxGroups([{ cats: ['A', 'B', 'A', 'B'], ys: [1, 10, 3, 12] }], true);
    expect(g.cats).toEqual(['A', 'B']);
    expect(g.stats[0].map((b) => b!.median)).toEqual([2, 11]);
    expect(boxGroups([{ cats: ['1', '2'], ys: [1, 2] }], false).cats).toEqual(['']);
  });
});

describe('charts of cells', () => {
  it('takes a bubble chart\'s columns as x, then heights and sizes in pairs', () => {
    const wb = sheetOf([['T', 'Yield', 'Scale'], [25, 42, 0.5], [40, 61, 1], [60, 78, 2]]);
    const c = chartFromRange(wb.sheet, r(0, 0, 3, 2), 'bubble');
    expect(c.series).toEqual([{ name: '=Sheet1!$B$1', x: '=Sheet1!$A$2:$A$4', y: '=Sheet1!$B$2:$B$4', size: '=Sheet1!$C$2:$C$4' }]);
    expect(chartData(wb, wb.sheet, c)[0].sizes).toEqual([0.5, 1, 2]);
  });

  it('takes one column for a histogram, and labels for a box chart', () => {
    const wb = sheetOf([['Catalyst', 'Yield', 'ee'], ['A', 70, 50], ['A', 72, 52], ['B', 80, 60]]);
    const h = chartFromRange(wb.sheet, r(0, 0, 3, 2), 'histogram');
    expect(h.series).toEqual([{ name: '=Sheet1!$B$1', y: '=Sheet1!$B$2:$B$4' }]);
    const b = chartFromRange(wb.sheet, r(0, 0, 3, 2), 'box');
    expect(b.series.map((s) => s.x)).toEqual(['=Sheet1!$A$2:$A$4', '=Sheet1!$A$2:$A$4']);
  });

  it('draws every new kind', () => {
    for (const kind of ['combo', 'histogram', 'box', 'bubble', 'radar'] as ChartKind[]) {
      const b = newChartBox(kind);
      const v = new VectorContext();
      drawChart(v, b.chart, boxData(b), b.chart.w, b.chart.h);
      expect(v.items.length, kind).toBeGreaterThan(10);
      expect(chartSvg(b.chart, boxData(b))).toContain('<svg');
      expect(CHART_NAMES[kind]).toBeTruthy();
    }
    // the combo chart's second axis is labelled on the right
    const b = newChartBox('combo');
    const v = new VectorContext();
    const hits = drawChart(v, b.chart, boxData(b), b.chart.w, b.chart.h);
    const texts = v.items.filter((i) => i.kind === 'text') as { text: string; x: number }[];
    expect(texts.some((t) => t.text === '1750' && t.x > hits.plot.x + hits.plot.w)).toBe(true);
  });
});

describe('in Excel files', () => {
  const back = (c: Chart, wb: Workbook) => readChartXml(parse(chartXml(c, chartData(wb, wb.sheet, c))), c.at, c.w, c.h, 7)!;

  it('writes a combo chart as columns and a line on a second axis, and reads it back', () => {
    const b = newChartBox('combo');
    const { chart } = b;
    const xmlText = chartXml(chart, boxData(b));
    expect(xmlText).toContain('<c:barChart>');
    expect(xmlText).toContain('<c:lineChart>');
    expect(xmlText).toMatch(/<c:valAx><c:axId val="104"\/>.*<c:axPos val="r"\/>.*<c:crosses val="max"\/>/);
    expect(xmlText).toMatch(/<c:catAx><c:axId val="103"\/><c:scaling><c:orientation val="minMax"\/><\/c:scaling><c:delete val="1"\/>/);
    const got = readChartXml(parse(xmlText), chart.at, chart.w, chart.h, 7)!;
    expect(got.partial).toBe(false);
    expect(got.chart.kind).toBe('combo');
    expect(got.chart.y2?.title).toBe('TON');
    expect(got.chart.series.map((s) => [s.y, s.as, s.secondary])).toEqual([['=Sheet1!$B$2:$B$5', undefined, undefined], ['=Sheet1!$C$2:$C$5', undefined, undefined]]);
    // a line on the left axis and columns on the right
    const flipped: Chart = { ...chart, series: [{ ...chart.series[0], as: 'line' }, { ...chart.series[1], as: 'column', secondary: false }] };
    const got2 = readChartXml(parse(chartXml(flipped, boxData({ ...b, chart: flipped }))), chart.at, chart.w, chart.h, 7)!;
    expect(got2.chart.series.map((s) => [s.as, s.secondary])).toEqual([['line', undefined], ['column', false]]);
  });

  it('writes bubble and radar charts as Excel\'s own', () => {
    const wb = sheetOf([['T', 'Yield', 'Scale'], [25, 42, 0.5], [40, 61, 1], [60, 78, 2]]);
    const bubble = chartFromRange(wb.sheet, r(0, 0, 3, 2), 'bubble');
    expect(chartXml(bubble, chartData(wb, wb.sheet, bubble))).toContain('<c:bubbleSize><c:numRef><c:f>Sheet1!$C$2:$C$4</c:f>');
    const got = back(bubble, wb);
    expect(got.chart.kind).toBe('bubble');
    expect(got.chart.series[0].size).toBe('=Sheet1!$C$2:$C$4');
    expect(sameChartData(got.chart, bubble)).toBe(true);
    const radar = { ...chartFromRange(wb.sheet, r(0, 0, 3, 2), 'radar'), filled: true };
    expect(chartXml(radar, chartData(wb, wb.sheet, radar))).toContain('<c:radarStyle val="filled"/>');
    expect(back(radar, wb).chart).toMatchObject({ kind: 'radar', filled: true });
  });

  it('writes histograms and box charts in Excel 2016\'s newer chart part, and reads them back', () => {
    const hb = newChartBox('histogram');
    const hist = { ...hb.chart, bins: { width: 5, overflow: 85 } };
    const hx = chartXml(hist, boxData({ ...hb, chart: hist }));
    expect(parse(hx).getElementsByTagName('parsererror')).toHaveLength(0);
    expect(hx).toContain('layoutId="clusteredColumn"');
    expect(hx).toContain('<cx:binning intervalClosed="r" overflow="85"><cx:binSize val="5"/></cx:binning>');
    expect(hx).toContain('<cx:f>Sheet1!$A$2:$A$21</cx:f>');
    const gh = readChartXml(parse(hx), hist.at, hist.w, hist.h, 3)!;
    expect(gh.chart).toMatchObject({ kind: 'histogram', bins: { width: 5, overflow: 85 } });
    expect(sameChartData(gh.chart, hist)).toBe(true);

    const bb = newChartBox('box');
    const box = { ...bb.chart, boxes: { points: true, quartiles: 'inclusive' as const } };
    const bx = chartXml(box, boxData({ ...bb, chart: box }));
    expect(bx).toContain('layoutId="boxWhisker"');
    expect(bx).toContain('<cx:strDim type="cat"><cx:f>Sheet1!$A$2:$A$19</cx:f>');
    expect(bx).toContain('<cx:statistics quartileMethod="inclusive"/>');
    const gb = readChartXml(parse(bx), box.at, box.w, box.h, 4)!;
    expect(gb.chart).toMatchObject({ kind: 'box', boxes: { points: true, quartiles: 'inclusive' } });
    expect(gb.chart.series[0]).toMatchObject({ x: '=Sheet1!$A$2:$A$19', y: '=Sheet1!$B$2:$B$19', name: '=Sheet1!$B$1' });
  });

  it('saves a workbook with a box chart in the newer part, behind a note for older programs', async () => {
    const wb = sheetOf([['Catalyst', 'Yield'], ['A', 70], ['A', 72], ['A', 75], ['B', 80], ['B', 83], ['B', 79]]);
    const c = chartFromRange(wb.sheet, r(0, 0, 6, 1), 'box');
    wb.edit('chart', () => wb.sheet.setCharts([c]));
    const f = unzipSync(await writeXlsx(wb, pictures));
    expect(f['xl/charts/chartEx1.xml']).toBeTruthy();
    expect(strFromU8(f['[Content_Types].xml'])).toContain('PartName="/xl/charts/chartEx1.xml" ContentType="application/vnd.ms-office.chartex+xml"');
    expect(strFromU8(f['xl/drawings/_rels/drawing1.xml.rels'])).toContain('http://schemas.microsoft.com/office/2014/relationships/chartEx');
    const drawing = strFromU8(f['xl/drawings/drawing1.xml']);
    expect(drawing).toMatch(/<mc:AlternateContent [^>]*><mc:Choice xmlns:cx1="[^"]+" Requires="cx1"><xdr:graphicFrame/);
    expect(drawing).toContain('<mc:Fallback><xdr:sp');
    // Excel's chart is read when our own copy isn't there
    delete f['customXml/item1.xml'];
    const got = await readXlsx(zipSync(f));
    expect(got.book.sheet.charts).toHaveLength(1);
    expect(got.book.sheet.charts[0].kind).toBe('box');
    expect(got.warnings.join(' ')).not.toMatch(/picture/);
  });
});

/** A document of "Before", a chart (object 1), and "After". */
function docWith(box: ChartBox): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [{ ...n, text: 'Before\n' }, objectRun(1, n), { ...n, text: '\nAfter' }];
  const N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns(runs), paras: [N, N, N], objects: { 1: { kind: 'picture', src: PNG_URL, w: 360, h: 216, chart: box } } };
}
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

describe('in Word and PowerPoint files', () => {
  it('saves a histogram as Word\'s own, with a picture for older programs, and reads it back from what Word cached', async () => {
    const box = newChartBox('histogram');
    const f = unzipSync(await writeDocx(docWith(box), deps));
    const doc = strFromU8(f['word/document.xml']);
    expect(doc).toMatch(/<mc:AlternateContent><mc:Choice xmlns:cx1="[^"]+" Requires="cx1"><w:drawing>.*<cx:chart xmlns:cx="http:\/\/schemas.microsoft.com\/office\/drawing\/2014\/chartex" r:id="rId\d+"\/>/);
    expect(doc).toMatch(/<mc:Fallback><w:drawing>.*<pic:pic>/);
    const ex = strFromU8(f['word/charts/chartEx1.xml']);
    expect(ex).toMatch(/<cx:chartData><cx:externalData r:id="rId1" cx:autoUpdate="0"\/>/);
    expect(f['word/embeddings/Microsoft_Excel_Worksheet1.xlsx']).toBeTruthy();
    // without our own copy: the chart comes from Word's part and the numbers it cached
    delete f['customXml/item1.xml'];
    const back = (await readDocx(zipSync(f))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'picture');
    if (o?.kind !== 'picture' || !o.chart) throw new Error('no chart');
    expect(o.chart.chart.kind).toBe('histogram');
    expect(sameBoxData(o.chart, box)).toBe(true);
  });

  it('saves a box chart as PowerPoint\'s own and reads it back', async () => {
    const box = newChartBox('box');
    const d = Deck.design(new Doc(), { w: 960, h: 540 });
    const doc = d.docOf(0);
    doc.edit('chart', () => doc.addShape({ kind: 'picture', x1: 100, y1: 80, x2: 460, y2: 296, src: PNG_URL, chart: box }));
    const bytes = await writePptx({ size: d.size, master: d.master, slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
    const f = unzipSync(bytes);
    const slide = strFromU8(f['ppt/slides/slide1.xml']);
    expect(slide).toMatch(/<mc:AlternateContent [^>]*><mc:Choice xmlns:cx1="[^"]+" Requires="cx1"><p:graphicFrame>/);
    expect(slide).toMatch(/<mc:Fallback><p:pic>/);
    expect(strFromU8(f['ppt/charts/chartEx1.xml'])).toContain('layoutId="boxWhisker"');
    const shape = readPptx(bytes).slides[0].contents.shapes.find((s) => s.chart);
    expect(shape?.chart?.chart.kind).toBe('box');
    expect(shape?.chart?.cells).toEqual(box.cells);
  });

  it('saves combo, bubble and radar charts as Word charts', async () => {
    for (const kind of ['combo', 'bubble', 'radar'] as ChartKind[]) {
      const box = newChartBox(kind);
      const f = unzipSync(await writeDocx(docWith(box), deps));
      delete f['customXml/item1.xml'];
      const back = (await readDocx(zipSync(f))).doc;
      const o = Object.values(back.objects).find((x) => x.kind === 'picture');
      if (o?.kind !== 'picture' || !o.chart) throw new Error(`no ${kind} chart`);
      expect(o.chart.chart.kind).toBe(kind);
      expect(sameBoxData(o.chart, box), kind).toBe(true);
    }
  });
});
