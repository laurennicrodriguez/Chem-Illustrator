// @vitest-environment jsdom
//
// Sheet > Isotope Pattern: the table it writes (peaks worked out by ISOMZ and ISOABUND, found
// columns, ppm errors), its chart of the peaks drawn as sticks, and that chart in Excel files.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { chartData } from '../src/sheet/chart';
import { isotopeTable, type IsotopeTableOptions } from '../src/sheet/isotope-table';
import { listedPeaks } from '../src/sheet/isotopes';
import { drawChart } from '../src/render/chart-draw';
import { VectorContext } from '../src/render/vector';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

/** The table for aspirin's [M+H]+ written into a new workbook at B1 (the compound given as a formula). */
function aspirin(chart: IsotopeTableOptions['chart'], found = true) {
  const wb = new Workbook();
  const s = wb.sheet;
  const peaks = listedPeaks({ formula: 'C9H8O4' }, '[M+H]+', 0.5) as number[];
  const t = isotopeTable({ sheet: s.name, at: { row: 0, col: 1 }, source: '"C9H8O4"', compound: 'C9H8O4', ion: '[M+H]+', peaks, found, chart });
  wb.edit('table', () => {
    for (const x of t.cells) {
      if (x.input) s.setInput(x.row, x.col, x.input);
      if (x.style) s.patchStyle({ r1: x.row, c1: x.col, r2: x.row, c2: x.col }, x.style);
    }
    if (t.chart) s.setCharts([t.chart]);
  });
  return { wb, s, t, peaks };
}

describe('the isotope pattern table', () => {
  it('lists each peak, worked out from the compound and the ion in its cell', () => {
    const { s, peaks } = aspirin('mirror');
    // M+3 of C9H9O4 is under 0.5 %
    expect(peaks).toEqual([0, 1, 2]);
    expect(s.value(0, 1)).toBe('Compound');
    expect(s.value(1, 2)).toBe('[M+H]+');
    expect([0, 1, 2, 3, 4, 5, 6].map((c) => s.value(3, 1 + c))).toEqual(['Peak', 'Calc. m/z', 'Calc. (%)', 'Found m/z', 'Found (%)', 'Error (ppm)', 'Calc. (drawn down)']);
    expect(s.value(4, 1)).toBe('M');
    expect(s.value(6, 1)).toBe('M+2');
    expect(s.cell(4, 2)?.input).toBe('=ISOMZ("C9H8O4",$C$2,0)');
    expect(s.value(4, 2) as number).toBeCloseTo(181.0495, 4);
    expect(s.value(4, 3) as number).toBeCloseTo(100, 6);
    expect(s.value(4, 7) as number).toBeCloseTo(-100, 6);
    expect(s.styleAt(4, 2)?.numFmt).toBe('0.0000');
  });

  it('follows the ion cell, and works out the error of the peaks found', () => {
    const { wb, s } = aspirin('mirror');
    expect(s.value(4, 6)).toBe('');
    wb.edit('found', () => { s.setInput(4, 4, '181.0491'); s.setInput(4, 5, '100'); });
    expect(s.value(4, 6) as number).toBeCloseTo(((181.0491 - s.value(4, 2)) as number) / (s.value(4, 2) as number) * 1e6, 6);
    expect(s.value(4, 6) as number).toBeCloseTo(-2.5, 0);
    wb.edit('ion', () => s.setInput(1, 2, '[M+Na]+'));
    expect(s.value(4, 2) as number).toBeCloseTo(203.0315, 4);
  });

  it('leaves out the found columns when not wanted, and charts the calculated peaks only', () => {
    const { s, t } = aspirin('mirror', false);
    expect(t.cols).toBe(3);
    expect(s.value(3, 4)).toBeNull();
    expect(t.chart!.series.map((x) => x.name)).toEqual(['Calculated']);
  });
});

describe('the isotope pattern chart', () => {
  it('draws found peaks up and calculated peaks down from zero, labelled with their m/z', () => {
    const { wb, s } = aspirin('mirror');
    wb.edit('found', () => { s.setInput(4, 4, '181.0491'); s.setInput(4, 5, '100'); s.setInput(5, 4, '182.0526'); s.setInput(5, 5, '10.4'); });
    const c = s.charts[0];
    expect(c.series.map((x) => [x.name, x.sticks, x.labelX])).toEqual([['Found', true, true], ['Calculated', true, true]]);
    expect(c.series[1].y).toBe('=Sheet1!$H$5:$H$7');
    const v = new VectorContext();
    drawChart(v, c, chartData(wb, s, c), c.w, c.h);
    const texts = v.items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
    expect(texts).toContain('181.0491');
    expect(texts).toContain('181.0495');
    // the axis shows heights without a minus below zero
    expect(texts).toContain('100');
    expect(texts.some((t) => /^[−-]100$/.test(t))).toBe(false);
    // straight up-and-down lines in each series' colour, from the zero line
    const sticks = (color: string) => {
      const upright = (segs: { k: string; x: number; y: number }[]) => segs.length >= 2 && segs.every((g, k) => (k % 2 ? g.k === 'L' && Math.abs(g.x - segs[k - 1].x) < 1e-6 : g.k === 'M'));
      const p = v.items.find((i) => i.kind === 'path' && i.stroke?.color === color && upright(i.segs as never)) as { segs: unknown[] } | undefined;
      return p ? p.segs.length / 2 : 0;
    };
    // found: the two typed in (the empty rows are gaps); calculated: all three
    expect(sticks(c.series[0].color!)).toBe(2);
    expect(sticks(c.series[1].color!)).toBe(3);
  });

  it('goes to Excel as error bars running to zero, and comes back as sticks', async () => {
    const { wb, s } = aspirin('mirror');
    const bytes = await writeXlsx(wb, pictures);
    const f = unzipSync(bytes);
    const part = strFromU8(f['xl/charts/chart1.xml']);
    expect(part).toContain('<c:errBarType val="minus"/><c:errValType val="percentage"/><c:noEndCap val="1"/><c:val val="100"/>');
    // the calculated peaks, all below zero, run up to it
    expect(part).toContain('<c:errBarType val="plus"/>');
    expect(part).toContain('<c:showCatName val="1"/>');
    expect(part).toContain('<c:numFmt formatCode="0.0000" sourceLinked="0"/>');
    expect(part).toContain('<c:symbol val="none"/>');
    // the peaks are saved as their values (Excel has no ISOMZ)
    const sheetXml = strFromU8(f['xl/worksheets/sheet1.xml']);
    expect(sheetXml).not.toContain('ISOMZ');
    // our own copy comes back as it was
    const back = (await readXlsx(bytes)).book.sheet;
    expect(back.charts[0].series[0]).toMatchObject({ sticks: true, labelX: true, labelFmt: '0.0000' });
    expect(back.cell(4, 2)?.input).toBe('=ISOMZ("C9H8O4",$C$2,0)');
    // Excel's chart read on its own gives the same sticks
    delete f['customXml/item1.xml'];
    const fromExcel = (await readXlsx(zipSync(f))).book.sheet.charts[0];
    expect(fromExcel.series.map((x) => [x.sticks, x.labelX, x.labelFmt, x.errors])).toEqual([[true, true, '0.0000', undefined], [true, true, '0.0000', undefined]]);
    expect(fromExcel.y).toMatchObject({ min: -125, max: 125, numFmt: '0;0' });
  });
});
