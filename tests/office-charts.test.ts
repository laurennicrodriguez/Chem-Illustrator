// @vitest-environment jsdom
//
// Charts in Document and Slides modes: a chart keeps its own little table of data, goes to Word
// and PowerPoint as their own chart (with the data as a workbook inside, for Edit Data), and
// comes back the same; charts made in Word or PowerPoint come in from the numbers they cached.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { ChartBox, boxData, boxFromCaches, newChartBox, sameBoxData, sheetCells, sizedBox } from '../src/sheet/chart-box';
import { Workbook } from '../src/sheet/workbook';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { readXlsx } from '../src/io/xlsx';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import type { TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

/** A document of "Before", a chart (object 1), and "After". */
function docWith(box: ChartBox): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [{ ...n, text: 'Before\n' }, objectRun(1, n), { ...n, text: '\nAfter' }];
  const N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns(runs), paras: [N, N, N], objects: { 1: { kind: 'picture', src: 'data:image/png;base64,AA==', w: 360, h: 216, chart: box } } };
}

/** A deck of one blank slide with a chart on it. */
async function deckWith(box: ChartBox): Promise<Uint8Array> {
  const d = Deck.design(new Doc(), { w: 960, h: 540 });
  const doc = d.docOf(0);
  doc.edit('chart', () => doc.addShape({ kind: 'picture', x1: 100, y1: 80, x2: 460, y2: 296, src: 'data:image/png;base64,AA==', chart: box }));
  return writePptx({ size: d.size, master: d.master, slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
}

const files = (bytes: Uint8Array) => unzipSync(bytes);
/** Zip changed parts again (copied into this window's byte arrays, which the zip library needs). */
const rezip = (f: Record<string, Uint8Array>) => zipSync(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, new Uint8Array(v)])));

describe('a chart with its own data', () => {
  it('starts with sample data to type over, charted as Word charts a table', () => {
    const b = newChartBox('column');
    const data = boxData(b);
    expect(data.map((s) => s.name)).toEqual(['Yield (%)', 'ee (%)']);
    expect(data[0].ys).toEqual([78, 85, 62, 41]);
    expect(data[0].cats[0]).toBe('Pd(OAc)₂');
    expect(b.chart.w).toBe(480);
    const sc = boxData(newChartBox('scatter'));
    expect(sc).toHaveLength(1);
    expect(sc[0].xs.slice(0, 3)).toEqual([0, 10, 20]);
  });

  it('keeps what is typed in each cell, formulas too', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => { s.setInput(0, 0, 'x'); s.setInput(1, 0, '2'); s.setInput(1, 2, '=A2*3'); });
    expect(sheetCells(s)).toEqual([['x'], ['2', '', '=A2*3']]);
  });

  it('is laid out at the size it is shown', () => {
    const b = newChartBox('line');
    const big = sizedBox(b, 540, 300);
    expect(big.chart.w).toBe(720);
    expect(big.chart.h).toBe(400);
    expect(sizedBox(b, 360, 216)).toBe(b);
  });

  it('puts the numbers a chart cached back in their cells', () => {
    const b = newChartBox('column');
    const back = boxFromCaches(b.chart, [
      { ref: 'Sheet1!$A$2:$A$5', values: ['Pd(OAc)₂', 'Pd₂(dba)₃', 'Pd(PPh₃)₄', 'PdCl₂'] },
      { ref: 'Sheet1!$B$1', values: ['Yield (%)'] },
      { ref: 'Sheet1!$B$2:$B$5', values: ['78', '85', '62', '41'] },
      { ref: 'Sheet1!$C$1', values: ['ee (%)'] },
      { ref: 'Sheet1!$C$2:$C$5', values: ['64', '71', '55', '38'] },
    ]);
    expect(back.cells[2]).toEqual(['Pd₂(dba)₃', '85', '71']);
    expect(sameBoxData(back, b)).toBe(true);
  });
});

describe('charts in Word files', () => {
  it('are saved as Word charts with their data as a workbook inside', async () => {
    const box = newChartBox('column');
    const f = files(await writeDocx(docWith(box), deps));
    const xml = strFromU8(f['word/document.xml']);
    expect(xml).toMatch(/<a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/chart"><c:chart [^>]*r:id="rId\d+"\/>/);
    expect(xml).toContain('name="Chart 1"');
    const chart = strFromU8(f['word/charts/chart1.xml']);
    expect(chart).toContain('<c:barChart>');
    expect(chart).toContain('<c:f>Sheet1!$B$2:$B$5</c:f>');
    expect(chart).toMatch(/<c:externalData r:id="rId1"><c:autoUpdate val="0"\/><\/c:externalData><\/c:chartSpace>$/);
    expect(strFromU8(f['word/charts/_rels/chart1.xml.rels'])).toContain('Target="../embeddings/Microsoft_Excel_Worksheet1.xlsx"');
    expect(strFromU8(f['word/_rels/document.xml.rels'])).toContain('Target="charts/chart1.xml"');
    const types = strFromU8(f['[Content_Types].xml']);
    expect(types).toContain('PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"');
    expect(types).toContain('Extension="xlsx"');
    // the workbook Word opens for Edit Data holds the numbers
    const { book } = await readXlsx(f['word/embeddings/Microsoft_Excel_Worksheet1.xlsx']);
    expect(book.sheet.name).toBe('Sheet1');
    expect(book.sheet.value(1, 1)).toBe(78);
    expect(book.sheet.value(4, 0)).toBe('PdCl₂');
  });

  it('come back as they were', async () => {
    const box = newChartBox('scatter');
    box.chart = { ...box.chart, title: 'Kinetics', series: box.chart.series.map((s) => ({ ...s, fit: { kind: 'linear', showEq: true, showR2: true, labelAt: { x: 0.2, y: 0.3 } } })) };
    const back = (await readDocx(await writeDocx(docWith(box), deps))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'picture');
    expect(o?.kind === 'picture' && o.chart).toBeTruthy();
    if (o?.kind !== 'picture' || !o.chart) return;
    expect(o.w).toBeCloseTo(360);
    expect(o.chart.chart.title).toBe('Kinetics');
    // our own settings (where the equation was dragged) ride in our part
    expect(o.chart.chart.series[0].fit?.labelAt).toEqual({ x: 0.2, y: 0.3 });
    expect(o.chart.cells).toEqual(box.cells);
  });

  it('read a chart Word saved (without our part) from the numbers it cached', async () => {
    const box = newChartBox('line');
    const f = files(await writeDocx(docWith(box), deps));
    delete f['customXml/item1.xml'];
    // Word changed a number in the table: our copy no longer stands in for it
    const chart = strFromU8(f['word/charts/chart1.xml']).replace('<c:pt idx="1"><c:v>85</c:v>', '<c:pt idx="1"><c:v>90</c:v>');
    f['word/charts/chart1.xml'] = strToU8(chart);
    const back = (await readDocx(rezip(f))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'picture');
    if (o?.kind !== 'picture' || !o.chart) throw new Error('no chart');
    expect(o.chart.chart.kind).toBe('line');
    expect(boxData(o.chart)[0].ys).toEqual([78, 90, 62, 41]);
    expect(boxData(o.chart)[0].cats).toEqual(['Pd(OAc)₂', 'Pd₂(dba)₃', 'Pd(PPh₃)₄', 'PdCl₂']);
  });
});

describe('charts in PowerPoint files', () => {
  it('are saved as PowerPoint charts with their data inside', async () => {
    const f = files(await deckWith(newChartBox('pie')));
    const slide = strFromU8(f['ppt/slides/slide1.xml']);
    expect(slide).toContain('<p:graphicFrame>');
    expect(slide).toMatch(/<a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/chart"><c:chart [^>]*r:id="rId\d+"\/>/);
    expect(slide).toContain('<a:off x="1270000" y="1016000"/><a:ext cx="4572000" cy="2743200"/>');
    expect(strFromU8(f['ppt/charts/chart1.xml'])).toContain('<c:pieChart>');
    expect(strFromU8(f['ppt/slides/_rels/slide1.xml.rels'])).toContain('Target="../charts/chart1.xml"');
    expect(f['ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx']).toBeTruthy();
  });

  it('come back as they were, and PowerPoint\'s own come in from their cached numbers', async () => {
    const box = newChartBox('bar');
    box.chart = { ...box.chart, palette: 'safe' };
    const bytes = await deckWith(box);
    const shape = readPptx(bytes).slides[0].contents.shapes.find((s) => s.chart);
    expect(shape?.chart?.chart.kind).toBe('bar');
    expect(shape?.chart?.chart.palette).toBe('safe');
    expect([shape!.x1, shape!.y1, shape!.x2, shape!.y2].map((v) => Math.round(v))).toEqual([100, 80, 460, 296]);
    // without our tag (a chart made in PowerPoint)
    const f = files(bytes);
    for (const k of Object.keys(f)) if (/^ppt\/tags\//.test(k)) f[k] = strToU8(strFromU8(f[k]).replace(/<p:tag name="CHEMILLUSTRATOR_CHART"[^>]*\/>/, ''));
    const theirs = readPptx(rezip(f)).slides[0].contents.shapes.find((s) => s.chart);
    expect(theirs?.chart?.chart.palette).toBeUndefined();
    expect(sameBoxData(theirs!.chart!, box)).toBe(true);
  });
});

describe('charts copied as CDXML', () => {
  it('keep their data in a tag on the picture', () => {
    const doc = new Doc();
    const box = newChartBox('area');
    doc.edit('chart', () => doc.addShape({ kind: 'picture', x1: 0, y1: 0, x2: 360, y2: 216, src: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`, chart: box }));
    const back = readCdxml(writeCdxml(doc, { name: 'x.cdxml' })).doc;
    const s = [...back.shapes.values()].find((x) => x.chart);
    expect(s?.chart?.chart.kind).toBe('area');
    expect(s?.chart?.cells).toEqual(box.cells);
  });
});
