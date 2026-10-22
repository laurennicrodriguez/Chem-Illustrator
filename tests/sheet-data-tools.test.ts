// Sheet mode's tools for cleaning and arranging data: Find and Replace, Go To Special, the Series
// window, Paste Special, Text to Columns, Remove Duplicates, Flash Fill, multi-level sort,
// Advanced Filter, and the split window.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import {
  findCells, findPattern, replaceCell, replaceIn, goToSpecial, cellsToAreas, fillSeries, addDate, pasteSpecial,
  splitText, textToColumns, removeDuplicates, advancedRows, applyAdvancedFilter, criterionTest,
} from '../src/sheet/data-tools';
import { flashFill } from '../src/sheet/flash-fill';
import { keyOf } from '../src/sheet/refs';
import { formatValue } from '../src/sheet/numfmt';

const A = (s: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(s)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1] as const;
};
const R = (s: string) => {
  const [a, b] = s.split(':');
  const [r1, c1] = A(a), [r2, c2] = A(b ?? a);
  return { r1, c1, r2, c2 };
};

function book(cells: Record<string, string> = {}): Workbook {
  const wb = new Workbook();
  type(wb, cells);
  return wb;
}

function type(wb: Workbook, cells: Record<string, string>): void {
  wb.edit('Type', () => {
    for (const [addr, v] of Object.entries(cells)) wb.sheet.setInput(...A(addr), v);
  });
}

const val = (wb: Workbook, addr: string) => {
  const v = wb.sheet.value(...A(addr));
  return v instanceof CellError ? v.code : v;
};
const input = (wb: Workbook, addr: string) => wb.sheet.cell(...A(addr))?.input;
const col = (wb: Workbook, c: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => val(wb, `${c}${from + i}`));

describe('Find and Replace', () => {
  const wb = book({ A1: 'Pd(OAc)2', B1: '=LEN(A1)', A2: 'pd2(dba)3', A3: 'PdCl2', B3: '5', C3: 'Ni(COD)2' });

  it('finds in formulas or in values, by rows or by columns', () => {
    const s = wb.sheet;
    expect(findCells(s, { text: 'pd' }).map((x) => [x.r, x.c])).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(findCells(s, { text: 'pd', matchCase: true }).map((x) => x.r)).toEqual([1]);
    // the formula's text has LEN; its value 8 doesn't
    expect(findCells(s, { text: 'LEN' }).length).toBe(1);
    expect(findCells(s, { text: 'LEN', lookIn: 'values' }).length).toBe(0);
    expect(findCells(s, { text: '8', lookIn: 'values' }).map((x) => x.c)).toEqual([1]);
    expect(findCells(s, { text: '2', byColumns: true }).map((x) => `${x.c}${x.r}`)).toEqual(['00', '01', '02', '22']);
  });

  it('uses wildcards and whole-cell matches', () => {
    const s = wb.sheet;
    expect(findPattern({ text: 'P?Cl*' }).test('PdCl2')).toBe(true);
    expect(findCells(s, { text: 'pd*2', whole: true }).length).toBe(2);
    expect(findCells(s, { text: '5', whole: true }).map((x) => x.c)).toEqual([1]);
    // ~ makes a wildcard its own character
    expect(findPattern({ text: '~*' }).test('a*b')).toBe(true);
    expect(findPattern({ text: '~*' }).test('ab')).toBe(false);
    expect(replaceIn('a-b-c', { text: '-' }, '–')).toBe('a–b–c');
    expect(replaceIn('$1 a', { text: 'a' }, '$&$&')).toBe('$1 $&$&');
  });

  it('replaces what was typed, as one step, and formulas work out again', () => {
    const w = book({ A1: 'THF', A2: 'thf/water', B1: '=A1&"!"' });
    w.edit('Replace', () => {
      for (const at of findCells(w.sheet, { text: 'thf' })) replaceCell(w.sheet, at.r, at.c, { text: 'thf' }, 'MeCN');
    });
    expect(val(w, 'A1')).toBe('MeCN');
    expect(val(w, 'A2')).toBe('MeCN/water');
    expect(val(w, 'B1')).toBe('MeCN!');
    w.undo();
    expect(val(w, 'A2')).toBe('thf/water');
  });
});

describe('Go To Special', () => {
  const wb = book({ A1: 'Entry', B1: 'Yield', A2: '1', B2: '85', A3: '2', A4: '3', B4: '=B2*2', B5: '#N/A', C2: 'TRUE' });
  const s = wb.sheet;
  const one = R('A1');

  it('finds blanks, constants and formulas of some kinds', () => {
    expect(goToSpecial(s, one, { r: 0, c: 0 }, { kind: 'blanks' })).toEqual(cellsToAreas([keyOf(0, 2), keyOf(2, 1), keyOf(2, 2), keyOf(3, 2), keyOf(4, 0), keyOf(4, 2)]));
    const nums = goToSpecial(s, one, { r: 0, c: 0 }, { kind: 'constants', types: { numbers: true } })!;
    expect(nums).toEqual([R('A2:B2'), R('A3:A4')]);
    expect(goToSpecial(s, one, { r: 0, c: 0 }, { kind: 'constants', types: { logicals: true } })).toEqual([R('C2')]);
    expect(goToSpecial(s, one, { r: 0, c: 0 }, { kind: 'formulas' })).toEqual([R('B4')]);
    expect(goToSpecial(s, one, { r: 0, c: 0 }, { kind: 'formulas', types: { text: true } })).toBeNull();
  });

  it('looks only within a selection of several cells', () => {
    expect(goToSpecial(s, R('A1:B3'), { r: 0, c: 0 }, { kind: 'blanks' })).toEqual([R('B3')]);
  });

  it('finds precedents and dependents', () => {
    expect(goToSpecial(s, R('B4'), { r: 3, c: 1 }, { kind: 'precedents' })).toEqual([R('B2')]);
    expect(goToSpecial(s, R('B2'), { r: 1, c: 1 }, { kind: 'dependents' })).toEqual([R('B4')]);
  });

  it('finds row differences and the last cell', () => {
    const w = book({ A1: '1', B1: '1', C1: '2', A2: 'x', B2: 'X', C2: 'y' });
    expect(goToSpecial(w.sheet, R('A1:C2'), { r: 0, c: 0 }, { kind: 'rowdiff' })).toEqual([R('C1:C2')]);
    expect(goToSpecial(w.sheet, R('A1'), { r: 0, c: 0 }, { kind: 'lastcell' })).toEqual([R('C2')]);
  });

  it('gives only the shown cells of a block with hidden rows', () => {
    const w = book({ A1: '1', A2: '2', A3: '3', A4: '4', B4: '5' });
    w.edit('Hide', () => w.sheet.setRowHidden(1, true));
    expect(goToSpecial(w.sheet, R('A1:B4'), { r: 0, c: 0 }, { kind: 'visible' })).toEqual([R('A1:B1'), R('A3:B4')]);
  });

  it('joins cells into few blocks', () => {
    expect(cellsToAreas([keyOf(0, 0), keyOf(0, 1), keyOf(1, 0), keyOf(1, 1), keyOf(2, 0)])).toEqual([R('A1:B2'), R('A3')]);
  });
});

describe('Series', () => {
  it('fills linear and growth series with a step and a stop value', () => {
    const wb = book({ A1: '1', B1: '2' });
    wb.edit('Series', () => fillSeries(wb.sheet, R('A1:A6'), { by: 'cols', type: 'linear', step: 2.5, stop: 10 }));
    expect(col(wb, 'A', 1, 6)).toEqual([1, 3.5, 6, 8.5, null, null]);
    wb.edit('Series', () => fillSeries(wb.sheet, R('B1'), { by: 'cols', type: 'growth', step: 3, stop: 200 }));
    expect(col(wb, 'B', 1, 6)).toEqual([2, 6, 18, 54, 162, null]);
  });

  it('fills dates by day, weekday, month and year', () => {
    // 2026-01-30 is a Friday
    const fri = (Date.UTC(2026, 0, 30) - Date.UTC(1899, 11, 30)) / 86400000;
    expect(addDate(fri, 1, 'weekday') - fri).toBe(3);
    expect(formatValue(addDate(fri, 1, 'month'), 'yyyy-mm-dd').text).toBe('2026-02-28');
    expect(formatValue(addDate(fri, 2, 'year'), 'yyyy-mm-dd').text).toBe('2028-01-30');
    const wb = book({ A1: String(fri) });
    wb.edit('Series', () => fillSeries(wb.sheet, R('A1:A4'), { by: 'cols', type: 'date', unit: 'weekday', step: 1 }));
    expect(col(wb, 'A', 1, 4)).toEqual([fri, fri + 3, fri + 4, fri + 5]);
  });

  it('fits a trend through the values already there', () => {
    const wb = book({ A1: '1', B1: '3', C1: '4' });
    wb.edit('Series', () => fillSeries(wb.sheet, R('A1:E1'), { by: 'rows', type: 'linear', step: 1, trend: true }));
    // least squares through 1, 3, 4: 1.1667 + 1.5x, the values there replaced too (as in Excel)
    expect(val(wb, 'A1')).toBeCloseTo(1.1667, 3);
    expect(val(wb, 'D1')).toBeCloseTo(5.6667, 3);
    expect(val(wb, 'E1')).toBeCloseTo(7.1667, 3);
  });

  it('AutoFill continues text with numbers', () => {
    const wb = book({ A1: 'S1' });
    wb.edit('Series', () => fillSeries(wb.sheet, R('A1:A3'), { by: 'cols', type: 'auto', step: 1 }));
    expect(col(wb, 'A', 1, 3)).toEqual(['S1', null, null]);
    const w2 = book({ A1: '2', A2: '4' });
    w2.edit('Series', () => fillSeries(w2.sheet, R('A1:A4'), { by: 'cols', type: 'auto', step: 1 }));
    expect(col(w2, 'A', 1, 4)).toEqual([2, 4, 6, 8]);
  });
});

describe('Paste Special', () => {
  it('transposes, moving each formula to its new cell', () => {
    const wb = book({ A1: '1', B1: '2', C1: '=A1+B1' });
    const block = wb.sheet.copy(R('A1:C1'));
    wb.edit('Paste', () => pasteSpecial(wb.sheet, { row: 2, col: 0 }, block, { what: 'all', transpose: true }));
    // A1 and B1, left of C1, are above A5 once turned
    expect(input(wb, 'A5')).toBe('=A3+A4');
    expect(col(wb, 'A', 3, 5)).toEqual([1, 2, 3]);
    const w2 = book({ A1: '1', A2: '2', B1: '=A1*10', B2: '=A2*10' });
    w2.edit('Paste', () => pasteSpecial(w2.sheet, { row: 4, col: 0 }, w2.sheet.copy(R('A1:B2')), { what: 'all', transpose: true }));
    expect(input(w2, 'A6')).toBe('=A5*10');
    expect(input(w2, 'B6')).toBe('=B5*10');
    expect(val(w2, 'B6')).toBe(20);
    expect(input(w2, 'A1')).toBe('1');
  });

  it('adds, subtracts, multiplies and divides, skipping blanks', () => {
    const wb = book({ A1: '10', A2: '20', A3: '30', A4: '=A1', C1: '2', C3: '3', C4: '2' });
    const block = wb.sheet.copy(R('C1:C4'));
    wb.edit('Paste', () => pasteSpecial(wb.sheet, { row: 0, col: 0 }, block, { what: 'values', op: 'multiply', skipBlanks: true }));
    expect(col(wb, 'A', 1, 3)).toEqual([20, 20, 90]);
    expect(input(wb, 'A4')).toBe('=(A1)*2');
    expect(val(wb, 'A4')).toBe(40);
    const w2 = book({ A1: '10', C1: '0' });
    w2.edit('Paste', () => pasteSpecial(w2.sheet, { row: 0, col: 0 }, w2.sheet.copy(R('C1')), { what: 'values', op: 'divide' }));
    expect(val(w2, 'A1')).toBe('#DIV/0!');
  });

  it('pastes only formats, notes or values with their number format', () => {
    const wb = book({ A1: '0.5', B1: 'x' });
    wb.edit('Fmt', () => wb.sheet.patchStyle(R('A1'), { numFmt: '0%', bold: true }));
    const block = wb.sheet.copy(R('A1'));
    wb.edit('Paste', () => pasteSpecial(wb.sheet, { row: 0, col: 1 }, block, { what: 'formats' }));
    expect(val(wb, 'B1')).toBe('x');
    expect(wb.sheet.styleAt(0, 1)?.bold).toBe(true);
    wb.edit('Paste', () => pasteSpecial(wb.sheet, { row: 0, col: 2 }, block, { what: 'values-numfmt' }));
    expect(wb.sheet.shownText(0, 2)).toBe('50%');
    expect(wb.sheet.styleAt(0, 2)?.bold).toBeUndefined();
  });
});

describe('Text to Columns', () => {
  it('splits on separators, keeping quoted text whole', () => {
    expect(splitText('a,"b,c",d', { mode: 'delimited', delimiters: ',', qualifier: '"' })).toEqual(['a', 'b,c', 'd']);
    expect(splitText('a  b', { mode: 'delimited', delimiters: ' ' })).toEqual(['a', '', 'b']);
    expect(splitText('a  b', { mode: 'delimited', delimiters: ' ', consecutive: true })).toEqual(['a', 'b']);
    expect(splitText('2026-01-05', { mode: 'delimited', delimiters: '-' })).toEqual(['2026', '01', '05']);
    expect(splitText('ABC123xyz', { mode: 'fixed', breaks: [3, 6] })).toEqual(['ABC', '123', 'xyz']);
  });

  it('puts the pieces in the columns to the right, as typed or as text, skipping some', () => {
    const wb = book({ A1: 'Pd(OAc)2;5;mol%', A2: 'XPhos;10;mol%', D1: 'old' });
    wb.edit('Split', () => textToColumns(wb.sheet, R('A1:A2'), { mode: 'delimited', delimiters: ';', formats: ['general', 'text', 'skip'] }));
    expect(col(wb, 'A', 1, 2)).toEqual(['Pd(OAc)2', 'XPhos']);
    expect(col(wb, 'B', 1, 2)).toEqual(['5', '10']);
    expect(val(wb, 'C1')).toBeNull();
    expect(val(wb, 'D1')).toBe('old');
    const w2 = book({ A1: '1,2' });
    w2.edit('Split', () => textToColumns(w2.sheet, R('A1'), { mode: 'delimited', delimiters: ',' }, { row: 0, col: 3 }));
    expect([val(w2, 'A1'), val(w2, 'D1'), val(w2, 'E1')]).toEqual(['1,2', 1, 2]);
  });
});

describe('Remove Duplicates', () => {
  it('keeps the first of rows alike in the chosen columns, ignoring capitals', () => {
    const wb = book({ A1: 'Ligand', B1: 'Yield', A2: 'XPhos', B2: '80', A3: 'SPhos', B3: '72', A4: 'xphos', B4: '81', A5: 'SPhos', B5: '72', D4: 'keep' });
    let got = { removed: 0, kept: 0 };
    wb.edit('Remove', () => { got = removeDuplicates(wb.sheet, R('A1:B5'), [0], true); });
    expect(got).toEqual({ removed: 2, kept: 2 });
    expect(col(wb, 'A', 1, 5)).toEqual(['Ligand', 'XPhos', 'SPhos', null, null]);
    expect(col(wb, 'B', 2, 3)).toEqual([80, 72]);
    // cells outside the block stay where they were
    expect(val(wb, 'D4')).toBe('keep');
    wb.undo();
    const w2 = wb;
    w2.edit('Remove', () => { got = removeDuplicates(w2.sheet, R('A1:B5'), [0, 1], true); });
    expect(got).toEqual({ removed: 1, kept: 3 });
  });

  it('moves formulas up with their rows', () => {
    const wb = book({ A1: 'a', B1: '=ROW()', A2: 'a', B2: '=ROW()', A3: 'b', B3: '=A3&"!"' });
    wb.edit('Remove', () => removeDuplicates(wb.sheet, R('A1:B3'), [0], false));
    expect(input(wb, 'B2')).toBe('=A2&"!"');
    expect(val(wb, 'B2')).toBe('b!');
  });
});

describe('Flash Fill', () => {
  const fill = (rows: string[][], outs: string[]) => {
    const ex = outs.map((out, i) => ({ row: rows[i], out }));
    return flashFill(ex, rows.slice(outs.length))?.values;
  };

  it('takes words, initials and parts of the row', () => {
    const names = [['John Smith'], ['Ada King Lovelace'], ['Marie Curie'], ['Rosalind Franklin']];
    expect(fill(names, ['Smith'])).toEqual(['Lovelace', 'Curie', 'Franklin']);
    expect(fill(names, ['Smith, J.'])).toEqual(['Lovelace, A.', 'Curie, M.', 'Franklin, R.']);
    expect(fill(names, ['JS', 'AKL'])).toBeUndefined();
    expect(fill([['john smith'], ['marie curie']], ['John Smith'])).toEqual(['Marie Curie']);
  });

  it('joins cells of the row with fixed text', () => {
    const rows = [['Smith', 'John'], ['Curie', 'Marie'], ['Franklin', 'Rosalind']];
    expect(fill(rows, ['john.smith@lab.edu'])).toEqual(['marie.curie@lab.edu', 'rosalind.franklin@lab.edu']);
  });

  it('pulls numbers and codes out of text', () => {
    const rows = [['Entry 12: 85% yield'], ['Entry 3: 47% yield'], ['Entry 7: 91% yield']];
    expect(fill(rows, ['85'])).toEqual(['47', '91']);
    expect(fill([['CAS 64-17-5'], ['CAS 67-64-1']], ['64-17-5'])).toEqual(['67-64-1']);
  });

  it('uses every example to choose', () => {
    // one example could be the second word or the last; the second example settles it
    const rows = [['a b c'], ['d e'], ['f g h i']];
    expect(fill(rows, ['b', 'e'])).toEqual(['g']);
  });
});

describe('Sort with several levels', () => {
  it('sorts by one column then another, and by a custom order', () => {
    const wb = book({ A1: 'High', B1: '2', A2: 'Low', B2: '1', A3: 'High', B3: '1', A4: 'Medium', B4: '5' });
    wb.edit('Sort', () => wb.sheet.sort(R('A1:B4'), [{ col: 0, custom: ['Low', 'Medium', 'High'] }, { col: 1, descending: true }]));
    expect(col(wb, 'A', 1, 4)).toEqual(['Low', 'Medium', 'High', 'High']);
    expect(col(wb, 'B', 1, 4)).toEqual([1, 5, 2, 1]);
  });

  it('puts lowercase first with Case Sensitive', () => {
    const wb = book({ A1: 'B', A2: 'a', A3: 'b', A4: 'A' });
    wb.edit('Sort', () => wb.sheet.sort(R('A1:A4'), [{ col: 0 }], { caseSensitive: true }));
    expect(col(wb, 'A', 1, 4)).toEqual(['a', 'A', 'b', 'B']);
  });

  it('sorts left to right', () => {
    const wb = book({ A1: '3', B1: '1', C1: '2', A2: '=A1*10', B2: 'x', C2: 'y' });
    wb.edit('Sort', () => wb.sheet.sort(R('A1:C2'), [{ col: 0 }], { byColumns: true }));
    expect([val(wb, 'A1'), val(wb, 'B1'), val(wb, 'C1')]).toEqual([1, 2, 3]);
    expect([val(wb, 'A2'), val(wb, 'B2'), input(wb, 'C2')]).toEqual(['x', 'y', '=C1*10']);
    expect(val(wb, 'C2')).toBe(30);
  });
});

describe('Advanced Filter', () => {
  const data = {
    A1: 'Ligand', B1: 'Yield', C1: 'Solvent',
    A2: 'XPhos', B2: '85', C2: 'THF',
    A3: 'SPhos', B3: '62', C3: 'Toluene',
    A4: 'XPhos', B4: '91', C4: 'Toluene',
    A5: 'PPh3', B5: '20', C5: 'THF',
    A6: 'XPhos', B6: '85', C6: 'THF',
  };

  it('reads criteria as Excel does', () => {
    expect(criterionTest('>50')(62, '62')).toBe(true);
    expect(criterionTest('>50')('x', 'x')).toBe(false);
    expect(criterionTest('X')('XPhos', 'XPhos')).toBe(true);
    expect(criterionTest('=X')('XPhos', 'XPhos')).toBe(false);
    expect(criterionTest('<>THF')('Toluene', 'Toluene')).toBe(true);
    expect(criterionTest('=')(null, '')).toBe(true);
    expect(criterionTest('*hos')('SPhos', 'SPhos')).toBe(true);
  });

  it('joins tests along a row with AND and rows with OR', () => {
    const wb = book({ ...data, E1: 'Ligand', F1: 'Yield', E2: 'XPhos', F2: '>=90', E3: 'PPh3' });
    const rows = advancedRows(wb.sheet, { list: R('A1:C6'), criteria: R('E1:F3') });
    expect(rows).toEqual([3, 4]);
  });

  it('filters in place, copies elsewhere, and keeps unique records', () => {
    const wb = book({ ...data, E1: 'Solvent', E2: 'THF' });
    wb.edit('Filter', () => applyAdvancedFilter(wb.sheet, { list: R('A1:C6'), criteria: R('E1:E2') }));
    expect([...wb.sheet.hiddenRows.keys()].sort()).toEqual([2, 3]);
    wb.undo();
    wb.edit('Filter', () => applyAdvancedFilter(wb.sheet, { list: R('A1:C6'), criteria: R('E1:E2'), unique: true, copyTo: { row: 9, col: 0 } }));
    expect(col(wb, 'A', 10, 13)).toEqual(['Ligand', 'XPhos', 'PPh3', null]);
    expect(wb.sheet.hiddenRows.size).toBe(0);
  });

  it('takes a computed criterion (a formula about the first row)', () => {
    const wb = book({ ...data, E1: 'Good', E2: '=B2>AVERAGE($B$2:$B$6)' });
    expect(advancedRows(wb.sheet, { list: R('A1:C6'), criteria: R('E1:E2') })).toEqual([1, 3, 5]);
  });
});

describe('Split window', () => {
  it('is kept on the sheet and undone like any change', () => {
    const wb = book();
    wb.edit('Split', () => wb.sheet.setSplit({ rows: 5, cols: 2 }));
    expect(wb.sheet.split).toEqual({ rows: 5, cols: 2 });
    wb.edit('Split', () => wb.sheet.setSplit({ rows: 0, cols: 0 }));
    expect(wb.sheet.split).toBeNull();
    wb.undo();
    expect(wb.sheet.split).toEqual({ rows: 5, cols: 2 });
  });
});
