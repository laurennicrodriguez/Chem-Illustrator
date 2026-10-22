// @vitest-environment jsdom
//
// The Formulas tab's workings: help for every function (the Insert Function window), searching
// it, writing a function's call from its argument boxes, and the defined-name helpers behind the
// Name Manager, Create from Selection and the name box.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { parseCellRef } from '../src/sheet/refs';
import { CellError } from '../src/sheet/values';
import { FUNCTION_NAMES } from '../src/sheet/evaluate';
import { functionHelp, searchFunctions, syntaxOf, CATEGORIES } from '../src/sheet/fn-help';
import { nameTarget, refersTo, renameInFormula, nameFromLabel } from '../src/sheet/names';
import { callText, previewText } from '../src/ui/sheet-formulas-ui';

describe('function help', () => {
  it('has a category, a description and arguments for every function', () => {
    const help = functionHelp();
    const missing = FUNCTION_NAMES.filter((n) => !help.get(n)?.about);
    expect(missing).toEqual([]);
    for (const h of help.values()) {
      expect(CATEGORIES).toContain(h.category);
      for (const a of h.args) expect(a.help.length, `${h.name} ${a.name}`).toBeGreaterThan(3);
    }
  });

  it('writes the syntax as Excel does', () => {
    const h = functionHelp();
    expect(syntaxOf(h.get('ROUND')!)).toBe('ROUND(number, [num_digits])');
    expect(syntaxOf(h.get('NETWORKDAYS')!)).toBe('NETWORKDAYS(start_date, end_date, [holidays])');
    expect(syntaxOf(h.get('SUM')!)).toMatch(/^SUM\(number1, \[number2\], …\)$/);
  });

  it('finds functions by name first, then by what they do', () => {
    expect(searchFunctions('datedif')[0].name).toBe('DATEDIF');
    expect(searchFunctions('NETWORK').map((h) => h.name)).toContain('NETWORKDAYS.INTL');
    const days = searchFunctions('working days').map((h) => h.name);
    expect(days).toContain('NETWORKDAYS');
    expect(days).toContain('WORKDAY');
    expect(searchFunctions('', 'Date & Time').every((h) => h.category === 'Date & Time')).toBe(true);
    expect(searchFunctions('', 'Chemistry').length).toBeGreaterThan(5);
  });
});

describe('Function Arguments', () => {
  it('writes the call, leaving empty arguments at the end out', () => {
    expect(callText('ROUND', ['A1', '2'])).toBe('ROUND(A1, 2)');
    expect(callText('NETWORKDAYS', ['A1', 'B1', ''])).toBe('NETWORKDAYS(A1, B1)');
    expect(callText('IF', ['A1>0', '', '"no"'])).toBe('IF(A1>0, , "no")');
    expect(callText('TODAY', [])).toBe('TODAY()');
  });

  it('shows values and arrays briefly', () => {
    expect(previewText(3.5)).toBe('3.5');
    expect(previewText('Pd')).toBe('"Pd"');
    expect(previewText({ block: [[1, 2], [3, 4]], h: 2, w: 2 })).toBe('{1, 2, 3, 4} (2×2)');
    expect(previewText({ block: [[1], [2], [3], [4], [5], [6], [7]], h: 7, w: 1 })).toBe('{1, 2, 3, 4, 5, 6, …} (7×1)');
  });
});

describe('defined names', () => {
  it('reads and writes the cells a name stands for', () => {
    expect(refersTo('Sheet1', { r1: 1, c1: 2, r2: 39, c2: 2 })).toBe('=Sheet1!$C$2:$C$40');
    expect(refersTo('Run 2', { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe("='Run 2'!$A$1");
    expect(nameTarget('=Sheet1!$C$2:$C$40')).toEqual({ sheet: 'Sheet1', range: { r1: 1, c1: 2, r2: 39, c2: 2 } });
    expect(nameTarget("='Run 2'!$A$1")?.sheet).toBe('Run 2');
    expect(nameTarget('=0.082057')).toBeNull();
    expect(nameTarget('=LAMBDA(x, x*2)')).toBeNull();
  });

  it('renames a name in formulas, LAMBDA names called as functions too', () => {
    expect(renameInFormula('=SUM(Yields)*2', 'yields', 'Yield_pct')).toBe('=SUM(Yield_pct)*2');
    expect(renameInFormula('=Moles(B2, Mw)', 'Moles', 'Mol')).toBe('=Mol(B2, Mw)');
    expect(renameInFormula('=SUM(A1:A3)', 'A', 'B')).toBe('=SUM(A1:A3)');
    expect(renameInFormula('="Yields"&Yields2', 'Yields', 'Y')).toBe('="Yields"&Yields2');
  });

  it('makes names from headings', () => {
    expect(nameFromLabel('Yield (%)')).toBe('Yield____');
    expect(nameFromLabel('Mass mg')).toBe('Mass_mg');
    expect(nameFromLabel('2-step')).toBe('_2_step');
    expect(nameFromLabel('R')).toBe('R_');
    expect(nameFromLabel('A1')).toBe('A1_');
    expect(nameFromLabel('   ')).toBeNull();
  });

  it('carries a rename into formulas that use the name', () => {
    const wb = new Workbook();
    wb.edit('t', () => {
      for (const [k, v] of Object.entries({ A1: '1', A2: '2', A3: '3', B1: '=SUM(Data)' })) { const r = parseCellRef(k)!; wb.sheet.setInput(r.row, r.col, v); }
      wb.setNames([{ name: 'Data', formula: '=Sheet1!$A$1:$A$3' }]);
    });
    expect(wb.sheet.value(0, 1)).toBe(6);
    wb.edit('rename', () => {
      wb.setNames([{ name: 'Masses', formula: '=Sheet1!$A$1:$A$3' }]);
      wb.rewriteAllFormulas((f) => renameInFormula(f, 'Data', 'Masses'));
    });
    expect(wb.sheet.cell(0, 1)?.input).toBe('=SUM(Masses)');
    expect(wb.sheet.value(0, 1)).toBe(6);
    // deleting it leaves #NAME?
    wb.edit('delete', () => wb.setNames([]));
    expect((wb.sheet.value(0, 1) as CellError).code).toBe('#NAME?');
  });
});
