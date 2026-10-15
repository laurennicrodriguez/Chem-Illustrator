// Spreadsheet fixes from the code review: Cut and Paste, Paste Values, fill series, sorting a
// filtered table, references kept right on insert/delete/rename, comparing numbers, and one bad
// formula not stopping the rest.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import { adjustFormula } from '../src/sheet/formula';
import { newCondFormat } from '../src/sheet/conditional';

const A = (s: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(s)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1] as const;
};
const type = (wb: Workbook, cells: Record<string, string>) => wb.edit('T', () => { for (const [a, v] of Object.entries(cells)) wb.sheet.setInput(...A(a), v); });
const val = (wb: Workbook, a: string) => { const v = wb.sheet.value(...A(a)); return v instanceof CellError ? v.code : v; };
const inp = (wb: Workbook, a: string) => wb.sheet.cell(...A(a))?.input;

describe('Cut and Paste', () => {
  it('keeps a moved formula pointing where it did', () => {
    const wb = new Workbook();
    type(wb, { A1: '5', B1: '=A1*2' });
    wb.edit('Move', () => wb.sheet.move({ r1: 0, c1: 1, r2: 0, c2: 1 }, { row: 8, col: 3 }));
    expect(inp(wb, 'D9')).toBe('=A1*2');
    expect(val(wb, 'D9')).toBe(10);
    expect(inp(wb, 'B1')).toBeUndefined();
  });

  it('points other formulas at the cells in their new place', () => {
    const wb = new Workbook();
    type(wb, { A1: '5', B1: '=A1*2', C1: '=A1', D1: '=SUM(A1:B1)' });
    wb.edit('Move', () => wb.sheet.move({ r1: 0, c1: 0, r2: 0, c2: 1 }, { row: 4, col: 0 }));
    expect(inp(wb, 'B5')).toBe('=A5*2');
    expect(inp(wb, 'C1')).toBe('=A5');
    expect(inp(wb, 'D1')).toBe('=SUM(A5:B5)');
    expect(val(wb, 'D1')).toBe(15);
  });
});

describe('Paste Values', () => {
  it('pastes what a formula showed, not the formula', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    type(wb, { A1: '5', B1: '=A1*2', C1: '="007"' });
    const block = s.copy({ r1: 0, c1: 1, r2: 0, c2: 2 });
    wb.edit('Paste values', () => s.paste({ row: 4, col: 3 }, block, 'values'));
    expect(inp(wb, 'D5')).toBe('10');
    expect(val(wb, 'D5')).toBe(10);
    // text that looks like a number stays text
    expect(val(wb, 'E5')).toBe('007');
  });
});

describe('filling', () => {
  it('carries on a series of names and compound numbers', () => {
    const wb = new Workbook();
    type(wb, { A1: 'S1', A2: 'S2', B1: '2a', B2: '2b' });
    wb.edit('Fill', () => wb.sheet.fill({ r1: 0, c1: 0, r2: 1, c2: 1 }, { r1: 0, c1: 0, r2: 5, c2: 1 }, true));
    expect([1, 2, 3, 4, 5, 6].map((r) => inp(wb, 'A' + r))).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect([1, 2, 3, 4, 5, 6].map((r) => inp(wb, 'B' + r))).toEqual(['2a', '2b', '2c', '2d', '2e', '2f']);
  });
});

describe('sorting a filtered table', () => {
  it('keeps the rows the filter hid hidden', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    const rows = [['Name', 'Yield'], ['a', '90'], ['b', '10'], ['c', '80'], ['d', '20']];
    wb.edit('T', () => rows.forEach((r, i) => r.forEach((v, j) => s.setInput(i, j, v))));
    wb.edit('F', () => { s.setFilter({ range: { r1: 0, c1: 0, r2: 4, c2: 1 }, conditions: {} }); s.setCondition(1, { kind: 'compare', op: '>', value: 50 }); });
    const shown = () => [1, 2, 3, 4].filter((r) => !s.hiddenRows.has(r)).map((r) => s.value(r, 0));
    expect(shown()).toEqual(['a', 'c']);
    wb.edit('Sort', () => s.sort({ r1: 1, c1: 0, r2: 4, c2: 1 }, [{ col: 0, descending: true }]));
    expect(shown()).toEqual(['c', 'a']);
  });
});

describe('references kept right', () => {
  it('moves conditional formatting formulas with inserted rows', () => {
    const wb = new Workbook();
    type(wb, { A2: 'x', A3: 'y', B2: '10', B3: '1' });
    wb.edit('CF', () => wb.sheet.setCondFormats([newCondFormat([{ r1: 1, c1: 0, r2: 2, c2: 0 }], { kind: 'formula', formula: '=$B2>5', look: { fill: '#ff0000' } })]));
    wb.edit('Ins', () => wb.sheet.insertRows(0, 1));
    expect((wb.sheet.condFormats[0].rule as { formula: string }).formula).toBe('=$B3>5');
    expect(wb.sheet.condLook(2, 0)?.fill).toBe('#ff0000');
    expect(wb.sheet.condLook(3, 0)?.fill).toBeUndefined();
  });

  it('renames a sheet in conditional formatting formulas', () => {
    const wb = new Workbook(['Sheet1', 'Data']);
    const s = wb.sheets[0];
    wb.edit('T', () => { wb.sheets[1].setInput(0, 0, '10'); s.setInput(0, 0, '1'); s.setCondFormats([newCondFormat([{ r1: 0, c1: 0, r2: 0, c2: 0 }], { kind: 'formula', formula: '=Data!$A$1>5', look: { fill: '#f00' } })]); });
    wb.edit('R', () => wb.sheets[1].rename('Results'));
    expect((s.condFormats[0].rule as { formula: string }).formula).toBe('=Results!$A$1>5');
    expect(s.condLook(0, 0)?.fill).toBe('#f00');
  });

  it('matches sheet names whatever their case', () => {
    const wb = new Workbook(['Sheet1', 'Data']);
    wb.edit('T', () => { wb.sheets[1].setInput(4, 0, '42'); wb.sheets[0].setInput(0, 0, '=data!A5'); });
    wb.edit('Ins', () => wb.sheets[1].insertRows(0, 1));
    expect(wb.sheets[0].value(0, 0)).toBe(42);
  });

  it('shrinks a block typed backwards when rows go', () => {
    expect(adjustFormula('=SUM(A10:A5)', 'Sheet1', { sheet: 'Sheet1', axis: 'row', at: 6, count: -1 })).toBe('=SUM(A5:A9)');
  });
});

describe('working out', () => {
  it('compares numbers at 15 significant figures, as Excel', () => {
    const wb = new Workbook();
    type(wb, { A1: '=0.1+0.2=0.3', A2: '=IF(SUM(0.7,0.1,0.2)=1,"ok","bad")' });
    expect(val(wb, 'A1')).toBe(true);
    expect(val(wb, 'A2')).toBe('ok');
  });

  it('takes MIN and MAX of very long columns', () => {
    const wb = new Workbook();
    wb.edit('T', () => { for (let r = 0; r < 200000; r++) wb.sheet.setInput(r, 0, String(r)); wb.sheet.setInput(0, 1, '=MAX(A:A)'); wb.sheet.setInput(1, 1, '=MIN(A1:A200000)'); });
    expect(val(wb, 'B1')).toBe(199999);
    expect(val(wb, 'B2')).toBe(0);
    // and the next edit still works
    type(wb, { C1: 'hello' });
    expect(val(wb, 'C1')).toBe('hello');
  });
});
