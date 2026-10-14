// @vitest-environment jsdom
//
// Conditional formatting and tables: each kind of rule picks the cells Excel would, earlier rules
// win, rules and tables move with inserted rows, and both go to Excel and come back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { keyOf } from '../src/sheet/refs';
import {
  workOutLooks, percentile, scaleColour, passesOp, mixColour, cfPoint, newCondFormat, scaleRule, CfRule, CondFormat,
} from '../src/sheet/conditional';
import { tableCellLook, tableColumnNames, newTable, TABLE_STYLES, TableDef } from '../src/sheet/table-styles';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { subtract, parseRanges } from '../src/ui/sheet-format-ui';

const r = (r1: number, c1: number, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });

/** A sheet with numbers 1..10 down column A (rows 0..9) and some text in column B. */
function book(): Workbook {
  const wb = new Workbook();
  const s = wb.sheet;
  wb.edit('fill', () => {
    for (let i = 0; i < 10; i++) s.setInput(i, 0, String(i + 1));
    ['Ph', 'Cy', 'Ph', 'nBu', '', 'Bn', 'cy', 'Me', 'Et', 'Ph'].forEach((t, i) => s.setInput(i, 1, t));
  });
  return wb;
}

const looksFor = (wb: Workbook, rules: CondFormat[]) =>
  workOutLooks(rules, { value: (row, col) => wb.sheet.value(row, col), formulaAt: (f, home, row, col) => wb.formulaAt(wb.sheet, f, home, row, col) }, wb.sheet.lastRow, wb.sheet.lastCol);

const one = (rule: CfRule, range = r(0, 0, 9, 0)) => [newCondFormat([range], rule)];
const hits = (m: Map<number, unknown>, col = 0) => [...Array(10).keys()].filter((i) => m.has(keyOf(i, col))).map((i) => i + 1);

describe('numbers for scales and bars', () => {
  it('works out percentiles as Excel does', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 100)).toBe(30);
    expect(percentile([1, 2, 3, 4, 5], 25)).toBe(2);
  });
  it('finds scale ends', () => {
    const xs = [2, 4, 6, 8, 10];
    expect(cfPoint({ type: 'min' }, xs, 'min')).toBe(2);
    expect(cfPoint({ type: 'percent', value: 50 }, xs, 'min')).toBe(6);
    expect(cfPoint({ type: 'num', value: 7 }, xs, 'min')).toBe(7);
    // automatic bars start at zero for positive numbers
    expect(cfPoint({ type: 'auto' }, xs, 'min')).toBe(0);
  });
  it('mixes colours along a scale', () => {
    expect(mixColour('#000000', '#ffffff', 0.5)).toBe('#808080');
    const stops = [{ at: 0, color: '#ff0000' }, { at: 10, color: '#00ff00' }];
    expect(scaleColour(-5, stops)).toBe('#ff0000');
    expect(scaleColour(5, stops)).toBe('#808000');
    expect(scaleColour(20, stops)).toBe('#00ff00');
  });
});

describe('each kind of rule', () => {
  it('colour scales shade every number, lowest to highest', () => {
    const wb = book();
    const m = looksFor(wb, one(scaleRule(['#ff0000', '#00ff00'])));
    expect(m.get(keyOf(0, 0))?.fill).toBe('#ff0000');
    expect(m.get(keyOf(9, 0))?.fill).toBe('#00ff00');
    expect(hits(m)).toHaveLength(10);
  });
  it('data bars run from zero, with longer bars for bigger numbers', () => {
    const wb = book();
    const m = looksFor(wb, one({ kind: 'bar', color: '#638ec6' }));
    expect(m.get(keyOf(9, 0))?.bar?.to).toBeCloseTo(1);
    expect(m.get(keyOf(4, 0))?.bar?.to).toBeCloseTo(0.5);
    expect(m.get(keyOf(0, 0))?.bar?.from).toBe(0);
  });
  it('icon sets give thirds', () => {
    const wb = book();
    const m = looksFor(wb, one({ kind: 'icons', set: 'arrows' }));
    expect(m.get(keyOf(0, 0))?.icon?.level).toBe(0);
    expect(m.get(keyOf(5, 0))?.icon?.level).toBe(1);
    expect(m.get(keyOf(9, 0))?.icon?.level).toBe(2);
    const rev = looksFor(wb, one({ kind: 'icons', set: 'arrows', reverse: true }));
    expect(rev.get(keyOf(9, 0))?.icon?.level).toBe(0);
  });
  it('compares values', () => {
    const wb = book();
    const look = { fill: '#ffc7ce' };
    expect(hits(looksFor(wb, one({ kind: 'cells', op: 'gt', value: 7, look })))).toEqual([8, 9, 10]);
    expect(hits(looksFor(wb, one({ kind: 'cells', op: 'between', value: 3, value2: 5, look })))).toEqual([3, 4, 5]);
    expect(hits(looksFor(wb, one({ kind: 'cells', op: 'notBetween', value: 2, value2: 9, look })))).toEqual([1, 10]);
    expect(passesOp('Ph', 'eq', 'ph')).toBe(true);
    expect(passesOp(null, 'lt', 5)).toBe(false);
  });
  it('finds text, ignoring capitals', () => {
    const wb = book();
    const look = { color: '#9c0006' };
    expect(hits(looksFor(wb, one({ kind: 'text', op: 'contains', text: 'cy', look }, r(0, 1, 9, 1))), 1)).toEqual([2, 7]);
    expect(hits(looksFor(wb, one({ kind: 'text', op: 'begins', text: 'p', look }, r(0, 1, 9, 1))), 1)).toEqual([1, 3, 10]);
  });
  it('picks the top and bottom values, and above average', () => {
    const wb = book();
    const look = { bold: true };
    expect(hits(looksFor(wb, one({ kind: 'top', n: 3, look })))).toEqual([8, 9, 10]);
    expect(hits(looksFor(wb, one({ kind: 'top', n: 20, percent: true, bottom: true, look })))).toEqual([1, 2]);
    expect(hits(looksFor(wb, one({ kind: 'average', look })))).toEqual([6, 7, 8, 9, 10]);
    expect(hits(looksFor(wb, one({ kind: 'average', below: true, look })))).toEqual([1, 2, 3, 4, 5]);
  });
  it('finds duplicates (ignoring capitals) and empty cells', () => {
    const wb = book();
    const look = { fill: '#ffeb9c' };
    expect(hits(looksFor(wb, one({ kind: 'duplicates', look }, r(0, 1, 9, 1))), 1)).toEqual([1, 2, 3, 7, 10]);
    expect(hits(looksFor(wb, one({ kind: 'duplicates', unique: true, look }, r(0, 1, 9, 1))), 1)).toEqual([4, 6, 8, 9]);
    expect(hits(looksFor(wb, one({ kind: 'blank', look }, r(0, 1, 9, 1))), 1)).toEqual([5]);
  });
  it('works out a formula for each cell, moved as a copied formula moves', () => {
    const wb = book();
    const look = { fill: '#c6efce' };
    // whole rows where column A is even
    const m = looksFor(wb, [newCondFormat([r(0, 0, 9, 1)], { kind: 'formula', formula: '=MOD($A1,2)=0', look })]);
    expect(hits(m, 0)).toEqual([2, 4, 6, 8, 10]);
    expect(hits(m, 1)).toEqual([2, 4, 6, 8, 10]);
  });
});

describe('several rules', () => {
  it('lets the first rule win and stops where asked', () => {
    const wb = book();
    const red = { fill: '#ff0000' }, green = { fill: '#00ff00', bold: true };
    const rules = [
      newCondFormat([r(0, 0, 9, 0)], { kind: 'cells', op: 'gt', value: 8, look: red }),
      newCondFormat([r(0, 0, 9, 0)], { kind: 'cells', op: 'gt', value: 5, look: green }),
    ];
    const m = looksFor(wb, rules);
    expect(m.get(keyOf(9, 0))).toEqual({ fill: '#ff0000', bold: true });
    expect(m.get(keyOf(6, 0))).toEqual(green);
    rules[0].stop = true;
    expect(looksFor(wb, rules).get(keyOf(9, 0))).toEqual(red);
  });
  it('shows on the sheet over the cell\'s own fill, and undoes', () => {
    const wb = book();
    const s = wb.sheet;
    wb.edit('fill', () => s.patchStyle(r(0, 0), { fill: '#0000ff' }));
    wb.edit('rule', () => s.setCondFormats([newCondFormat([r(0, 0, 9, 0)], { kind: 'cells', op: 'lt', value: 2, look: { fill: '#ff0000' } })]));
    expect(s.shownStyleAt(0, 0)?.fill).toBe('#ff0000');
    expect(s.styleAt(0, 0)?.fill).toBe('#0000ff');
    wb.undo();
    expect(s.condFormats).toHaveLength(0);
    expect(s.shownStyleAt(0, 0)?.fill).toBe('#0000ff');
  });
  it('follows its cells when rows go in above', () => {
    const wb = book();
    const s = wb.sheet;
    wb.edit('rule', () => s.setCondFormats([newCondFormat([r(2, 0, 9, 0)], { kind: 'bar', color: '#000000' })]));
    wb.edit('insert', () => s.insertRows(0, 2));
    expect(s.condFormats[0].ranges[0]).toEqual(r(4, 0, 11, 0));
  });
  it('clears from part of a range', () => {
    expect(subtract(r(0, 0, 9, 0), r(3, 0, 5, 0))).toEqual([r(0, 0, 2, 0), r(6, 0, 9, 0)]);
    expect(subtract(r(0, 0, 9, 3), r(0, 1, 9, 2))).toEqual([r(0, 0, 9, 0), r(0, 3, 9, 3)]);
    expect(parseRanges('B2:B20, D2')).toEqual([r(1, 1, 19, 1), r(1, 3)]);
    expect(parseRanges('nonsense')).toBeNull();
  });
});

describe('tables', () => {
  const t: TableDef = { id: 1, name: 'Table1', range: r(0, 0, 4, 2), style: 'TableStyleMedium2', header: true, bandRows: true };
  it('has Excel\'s 56 looks in light, medium and dark', () => {
    expect(TABLE_STYLES).toHaveLength(56);
    expect(TABLE_STYLES.map((x) => x.name)).toContain('TableStyleMedium2');
    expect(TABLE_STYLES.map((x) => x.name)).toContain('TableStyleLight21');
    expect(TABLE_STYLES.map((x) => x.name)).toContain('TableStyleDark7');
  });
  it('colours the default look as Excel\'s Medium 2: a blue header, bands of pale blue (accent 1 lightened 80%)', () => {
    expect(tableCellLook(t, 0, 0)).toMatchObject({ fill: '#4472c4', color: '#ffffff', bold: true });
    expect(tableCellLook(t, 1, 0)?.fill).toBe('#dae3f3');
    expect(tableCellLook(t, 2, 0)?.fill).toBeUndefined();
    expect(tableCellLook(t, 5, 0)).toBeNull();
  });
  it('keeps its stripes when rows are hidden by a filter', () => {
    const hidden = (row: number) => row === 1;
    expect(tableCellLook(t, 2, 0, hidden)?.fill).toBe('#dae3f3');
  });
  it('takes your own colours over the style\'s', () => {
    const own = { ...t, custom: { header: '#123456', band: '#eeeeee' } };
    expect(tableCellLook(own, 0, 1)?.fill).toBe('#123456');
    expect(tableCellLook(own, 1, 1)?.fill).toBe('#eeeeee');
  });
  it('makes header names Excel accepts', () => {
    expect(tableColumnNames(['Yield', '', 'Yield', 'ee'])).toEqual(['Yield', 'Column2', 'Yield2', 'ee']);
  });
  it('names new tables Table1, Table2…', () => {
    const a = newTable(r(0, 0, 3, 3), []);
    expect(a.name).toBe('Table1');
    expect(newTable(r(10, 0, 13, 3), [a]).name).toBe('Table2');
  });
  it('moves with inserted rows and stretches when rows go in inside it', () => {
    const wb = book();
    const s = wb.sheet;
    wb.edit('table', () => s.setTables([{ ...t, range: r(2, 0, 6, 1) }]));
    wb.edit('insert', () => s.insertRows(4, 1));
    expect(s.tables[0].range).toEqual(r(2, 0, 7, 1));
    wb.edit('insert', () => s.insertRows(0, 1));
    expect(s.tables[0].range).toEqual(r(3, 0, 8, 1));
  });
  it('works out totals with SUBTOTAL', () => {
    const wb = book();
    wb.edit('t', () => wb.sheet.setInput(12, 0, '=SUBTOTAL(109,A1:A10)'));
    expect(wb.sheet.value(12, 0)).toBe(55);
    wb.edit('t', () => wb.sheet.setInput(12, 0, '=SUBTOTAL(1,A1:A10)'));
    expect(wb.sheet.value(12, 0)).toBe(5.5);
  });
});

describe('in Excel files', () => {
  const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
  const files = (bytes: Uint8Array) => unzipSync(bytes);

  it('writes rules as Excel does and reads them back', async () => {
    const wb = book();
    const s = wb.sheet;
    const rules = [
      newCondFormat([r(0, 0, 9, 0)], scaleRule(['#f8696b', '#ffeb84', '#63be7b'])),
      newCondFormat([r(0, 0, 9, 0)], { kind: 'bar', color: '#638ec6', gradient: false }),
      newCondFormat([r(0, 0, 9, 0)], { kind: 'icons', set: 'stars' }),
      newCondFormat([r(0, 0, 9, 0)], { kind: 'cells', op: 'between', value: 2, value2: 4, look: { fill: '#ffc7ce', color: '#9c0006' } }),
      newCondFormat([r(0, 1, 9, 1)], { kind: 'text', op: 'contains', text: 'Ph', look: { bold: true } }),
      newCondFormat([r(0, 0, 9, 0)], { kind: 'top', n: 10, percent: true, look: { fill: '#c6efce' } }),
      newCondFormat([r(0, 1, 9, 1)], { kind: 'duplicates', look: { fill: '#ffeb9c' } }, true),
      newCondFormat([r(0, 0, 9, 1)], { kind: 'formula', formula: '=$A1>5', look: { italic: true } }),
    ];
    wb.edit('rules', () => s.setCondFormats(rules));
    const bytes = await writeXlsx(wb, pictures);
    const f = files(bytes);
    const sheetXml = strFromU8(f['xl/worksheets/sheet1.xml']);
    expect(sheetXml).toContain('<conditionalFormatting sqref="A1:A10"><cfRule type="colorScale" priority="1">');
    expect(sheetXml).toContain('type="cellIs" operator="between"');
    expect(sheetXml).toContain('<formula>NOT(ISERROR(SEARCH(&quot;Ph&quot;,B1)))</formula>');
    expect(sheetXml).toContain('type="duplicateValues" dxfId=');
    expect(sheetXml).toContain('stopIfTrue="1"');
    expect(sheetXml).toContain('<formula>$A1&gt;5</formula>');
    // conditional formatting goes after merged cells and before the page margins (the standard's order)
    expect(sheetXml.indexOf('<conditionalFormatting')).toBeLessThan(sheetXml.indexOf('<pageMargins'));
    const styles = strFromU8(f['xl/styles.xml']);
    expect(styles).toMatch(/<dxfs count="[1-9]/);
    expect(styles).toContain('<bgColor rgb="FFFFC7CE"/>');

    // our own copy comes back whole (solid bars, stars)
    const back = (await readXlsx(bytes)).book.sheet;
    expect(back.condFormats.map((x) => x.rule)).toEqual(rules.map((x) => x.rule));
    expect(back.condFormats[6].stop).toBe(true);
  });

  it('reads rules a file from Excel holds (no copy of our own)', async () => {
    const wb = book();
    wb.edit('rules', () => wb.sheet.setCondFormats([
      newCondFormat([r(0, 0, 9, 0)], { kind: 'cells', op: 'gt', value: 5, look: { fill: '#ffc7ce', bold: true } }),
      newCondFormat([r(0, 0, 9, 0)], { kind: 'average', below: true, look: { color: '#ff0000' } }),
      newCondFormat([r(0, 1, 9, 1)], { kind: 'blank', look: { fill: '#dddddd' } }),
    ]));
    const f = files(await writeXlsx(wb, pictures));
    // drop our part, as a file made in Excel has none
    delete f['customXml/item1.xml'];
    const { zipSync } = await import('fflate');
    const back = (await readXlsx(zipSync(f))).book.sheet;
    expect(back.condFormats.map((x) => x.rule)).toEqual([
      { kind: 'cells', op: 'gt', value: 5, look: { fill: '#ffc7ce', bold: true } },
      { kind: 'average', below: true, look: { color: '#ff0000' } },
      { kind: 'blank', look: { fill: '#dddddd' } },
    ]);
  });

  it('writes a table part Excel opens, with its filter and totals', async () => {
    const wb = book();
    const s = wb.sheet;
    wb.edit('table', () => {
      s.insertRows(0, 1);
      s.setInput(0, 0, 'n');
      // a blank header: Excel needs a name, so the file says Column2
      s.setInput(11, 0, 'Total');
      s.setInput(11, 1, '=SUBTOTAL(103,B2:B11)');
      s.setTables([{ id: 7, name: 'Scope', range: r(0, 0, 11, 1), style: 'TableStyleLight9', header: true, bandRows: true, totals: true, custom: { band: '#eeeeee' } }]);
      s.setFilter({ range: r(0, 0, 10, 1), conditions: { 0: { kind: 'compare', op: '>', value: 3 } } });
    });
    const bytes = await writeXlsx(wb, pictures);
    const f = files(bytes);
    const table = strFromU8(f['xl/tables/table1.xml']);
    expect(table).toContain('name="Scope" displayName="Scope" ref="A1:B12" totalsRowCount="1"');
    expect(table).toContain('<autoFilter ref="A1:B11"><filterColumn colId="0">');
    expect(table).toContain('<tableColumn id="1" name="n" totalsRowLabel="Total"/>');
    expect(table).toContain('<tableColumn id="2" name="Column2" totalsRowFunction="custom"><totalsRowFormula>SUBTOTAL(103,B2:B11)</totalsRowFormula>');
    expect(table).toContain('<tableStyleInfo name="TableStyleLight9"');
    const sheetXml = strFromU8(f['xl/worksheets/sheet1.xml']);
    expect(sheetXml).toContain('<tableParts count="1">');
    expect(sheetXml).not.toContain('<autoFilter');
    expect(strFromU8(f['[Content_Types].xml'])).toContain('spreadsheetml.table+xml');
    // the header cell holds the name Excel will look for
    const strings = strFromU8(f['xl/sharedStrings.xml']);
    expect(strings).toContain('<t>Column2</t>');

    const back = (await readXlsx(bytes)).book.sheet;
    expect(back.tables).toHaveLength(1);
    expect(back.tables[0]).toMatchObject({ name: 'Scope', range: r(0, 0, 11, 1), style: 'TableStyleLight9', totals: true, custom: { band: '#eeeeee' } });
    expect(back.filter?.conditions[0]).toEqual({ kind: 'compare', op: '>', value: 3 });
  });
});
