// Sheet formulas: reading them, working them out as Excel does, and moving their references
// when cells are copied or rows and columns are inserted or deleted.

import { describe, it, expect } from 'vitest';
import { tokenize, parseFormula, shiftFormula, adjustFormula, normalizeFormula, renameSheetInFormula, FormulaSyntaxError } from '../src/sheet/formula';
import { colName, colIndex, parseCellRef, cellName, parseRange, rangeName, quoteSheet } from '../src/sheet/refs';
import { evaluate, EvalHost, roundTo } from '../src/sheet/evaluate';
import { Value, CellError, readTyped, compareValues } from '../src/sheet/values';
import { MolProps } from '../src/sheet/properties';

describe('cell addresses', () => {
  it('names columns as Excel does', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(colName(701)).toBe('ZZ');
    expect(colName(702)).toBe('AAA');
    expect(colName(16383)).toBe('XFD');
    for (const c of [0, 25, 26, 51, 52, 701, 702, 16383]) expect(colIndex(colName(c))).toBe(c);
    expect(colIndex('XFE')).toBe(-1);
  });
  it('reads A1 references with $', () => {
    expect(parseCellRef('$B$3')).toEqual({ row: 2, col: 1, absRow: true, absCol: true });
    expect(parseCellRef('c10')).toEqual({ row: 9, col: 2, absRow: false, absCol: false });
    expect(parseCellRef('A0')).toBeNull();
    expect(cellName(0, 0)).toBe('A1');
    expect(parseRange('C5:A1')).toEqual({ r1: 0, c1: 0, r2: 4, c2: 2 });
    expect(rangeName({ r1: 1, c1: 1, r2: 1, c2: 1 })).toBe('B2');
    expect(quoteSheet('Sheet1')).toBe('Sheet1');
    expect(quoteSheet('My data')).toBe("'My data'");
    expect(quoteSheet("Nate's")).toBe("'Nate''s'");
  });
});

describe('reading formulas', () => {
  it('splits a formula into pieces', () => {
    const t = tokenize('SUM(A1:B2, $C$3)*2+Sheet2!D4&"x"').filter((x) => x.t !== 'ws').map((x) => x.t);
    expect(t).toEqual(['fn', '(', 'ref', ',', 'ref', ')', 'op', 'num', 'op', 'ref', 'op', 'str']);
  });
  it('tells function names from cell addresses', () => {
    const toks = tokenize('LOG10(A1)+ABC1');
    expect(toks[0]).toMatchObject({ t: 'fn', v: 'LOG10' });
    expect(toks.find((x) => x.s === 'ABC1')).toMatchObject({ t: 'ref' });
  });
  it('reads quoted sheet names and whole columns', () => {
    const toks = tokenize("SUM('My data'!A:A)");
    const ref = toks.find((x) => x.t === 'ref');
    expect(ref).toMatchObject({ t: 'ref', v: { sheet: 'My data', kind: 'cols' } });
  });
  it('says what is wrong with a formula it cannot read', () => {
    expect(() => parseFormula('=SUM(A1')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('="abc')).toThrow(/closing/);
    expect(() => parseFormula('=1+')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('=A1 B1')).toThrow(FormulaSyntaxError);
  });
  it('tidies formulas as Excel does', () => {
    expect(normalizeFormula('=sum(a1:b2)+if(true,1,2)')).toBe('=SUM(A1:B2)+IF(TRUE,1,2)');
    expect(normalizeFormula('="mixed Case"&a1')).toBe('="mixed Case"&A1');
  });
});

/** A small sheet for working formulas out: cells by address, structures by SMILES. */
function host(cells: Record<string, Value>, mols: Record<string, MolProps | CellError> = {}): EvalHost {
  const at = (row: number, col: number) => cells[cellName(row, col)] ?? null;
  return {
    value: (_s, row, col) => at(row, col),
    block: (_s, r) => {
      const out: Value[][] = [];
      for (let row = r.r1; row <= Math.min(r.r2, 50); row++) {
        const line: Value[] = [];
        for (let col = r.c1; col <= Math.min(r.c2, 10); col++) line.push(at(row, col));
        out.push(line);
      }
      return out;
    },
    hasSheet: (n) => n === 'Sheet1' || n === 'Data',
    molecule: (src) => {
      const key = 'smiles' in src ? src.smiles : String(at(src.row, src.col) ?? '');
      if (!key) return null;
      return mols[key] ?? new CellError('#VALUE!', 'unreadable');
    },
  };
}

const calc = (f: string, cells: Record<string, Value> = {}, mols: Record<string, MolProps | CellError> = {}) => {
  const v = evaluate(parseFormula(f), host(cells, mols));
  return v instanceof CellError ? v.code : v;
};

describe('working out formulas', () => {
  it('does arithmetic in Excel order', () => {
    expect(calc('=1+2*3')).toBe(7);
    expect(calc('=(1+2)*3')).toBe(9);
    expect(calc('=2^3^2')).toBe(64); // left to right, as Excel
    expect(calc('=-2^2')).toBe(4); // the minus first, as Excel
    expect(calc('=10/4')).toBe(2.5);
    expect(calc('=50%*8')).toBe(4);
    expect(calc('=1/0')).toBe('#DIV/0!');
    expect(calc('=0^0')).toBe('#NUM!');
  });
  it('reads cells, with empty cells as 0 and number text as numbers', () => {
    const cells = { A1: 5, A2: '3', A3: 'abc' };
    expect(calc('=A1*2', cells)).toBe(10);
    expect(calc('=A1+A2', cells)).toBe(8);
    expect(calc('=A1+A3', cells)).toBe('#VALUE!');
    expect(calc('=B9+1', cells)).toBe(1);
  });
  it('compares and joins', () => {
    expect(calc('=A1>4', { A1: 5 })).toBe(true);
    expect(calc('="abc"="ABC"')).toBe(true);
    expect(calc('=1<"a"')).toBe(true); // numbers before text
    expect(calc('="mol "&A1&" g"', { A1: 2.5 })).toBe('mol 2.5 g');
    expect(calc('=1&TRUE')).toBe('1TRUE');
  });
  it('has SUM, AVERAGE, MIN, MAX, COUNT, ROUND and IF', () => {
    const cells = { A1: 1, A2: 2, A3: 'x', A4: null, A5: 4, B1: true };
    expect(calc('=SUM(A1:A5)', cells)).toBe(7); // text and blanks in a block are skipped
    expect(calc('=SUM(A1:A5,10,"5")', cells)).toBe(22);
    expect(calc('=AVERAGE(A1:A5)', cells)).toBeCloseTo(7 / 3, 12);
    expect(calc('=MIN(A1:A5)', cells)).toBe(1);
    expect(calc('=MAX(A1:A5)', cells)).toBe(4);
    expect(calc('=COUNT(A1:A5)', cells)).toBe(3);
    expect(calc('=COUNTA(A1:A5)', cells)).toBe(4);
    expect(calc('=AVERAGE(C1:C3)', cells)).toBe('#DIV/0!');
    expect(calc('=ROUND(2.675,2)')).toBe(2.68); // not 2.67, despite binary fractions
    expect(calc('=ROUND(-1.5,0)')).toBe(-2); // half away from zero
    expect(calc('=ROUND(1234.5,-2)')).toBe(1200);
    expect(calc('=IF(A1>0,"yes","no")', cells)).toBe('yes');
    expect(calc('=IF(A1>5,"yes")', cells)).toBe(false);
    expect(calc('=IF(A1>0,1,1/0)', cells)).toBe(1); // only the branch taken is worked out
    expect(calc('=IFERROR(1/0,"none")')).toBe('none');
  });
  it('passes errors through, and knows unknown names', () => {
    expect(calc('=A1+1', { A1: new CellError('#N/A') })).toBe('#N/A');
    expect(calc('=SUM(A1:A2)', { A1: 1, A2: new CellError('#DIV/0!') })).toBe('#DIV/0!');
    expect(calc('=FOO(1)')).toBe('#NAME?');
    expect(calc('=bar+1')).toBe('#NAME?');
    expect(calc('=Nowhere!A1')).toBe('#REF!');
    expect(calc('=A1:A3')).toBe('#VALUE!');
  });
  it('rounds the way Excel does', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(0.1 + 0.2, 10)).toBe(0.3);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(1.234, 1, 'up')).toBe(1.3);
    expect(roundTo(-1.234, 1, 'down')).toBe(-1.2);
  });
});

describe('chemistry in formulas', () => {
  const aspirin: MolProps = {
    formula: 'C9H8O4', mw: 180.159, exact: 180.042258736, charge: 0, smiles: 'CC(=O)Oc1ccccc1C(=O)O',
    inchikey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', clogp: 1.3101, tpsa: 63.6, hbd: 1, hba: 4, rotb: 2,
  };
  const mols = { 'CC(=O)Oc1ccccc1C(=O)O': aspirin, busy: new CellError('#BUSY!') };
  const cells = { B2: 'CC(=O)Oc1ccccc1C(=O)O', C2: 250 };
  it('works out properties of a structure', () => {
    expect(calc('=MW(B2)', cells, mols)).toBe(180.159);
    expect(calc('=FORMULA(B2)', cells, mols)).toBe('C9H8O4');
    expect(calc('=INCHIKEY(B2)', cells, mols)).toBe('BSYNRYMUTXBXSQ-UHFFFAOYSA-N');
    expect(calc('=HBD(B2)+HBA(B2)', cells, mols)).toBe(5);
    expect(calc('=MW("CC(=O)Oc1ccccc1C(=O)O")', {}, mols)).toBe(180.159);
  });
  it('uses properties in formulas: mass ÷ MW gives mmol', () => {
    expect(calc('=C2/MW(B2)', cells, mols)).toBeCloseTo(1.38766, 4);
  });
  it('gives HRMS m/z for an adduct', () => {
    expect(calc('=HRMS(B2)', cells, mols)).toBeCloseTo(181.0495, 4);
    expect(calc('=HRMS(B2,"[M+Na]+")', cells, mols)).toBeCloseTo(203.0315, 4);
    expect(calc('=HRMS(B2,"[M+Xx]+")', cells, mols)).toBe('#VALUE!');
  });
  it('leaves rows without a structure empty, and waits for the chemistry engine', () => {
    expect(calc('=MW(B9)', cells, mols)).toBe('');
    expect(calc('=MW(B2)', { B2: 'busy' }, mols)).toBe('#BUSY!');
    expect(calc('=MW(B2)*2', { B2: 'busy' }, mols)).toBe('#BUSY!');
    expect(calc('=IFERROR(MW(B2),0)', { B2: 'busy' }, mols)).toBe('#BUSY!');
    expect(calc('=MW(C2)', cells, mols)).toBe('#VALUE!');
  });
});

describe('moving formulas', () => {
  it('moves relative references when copied, and keeps $ ones', () => {
    expect(shiftFormula('=A1+$B$1+B$2+$C3', 2, 1)).toBe('=B3+$B$1+C$2+$C5');
    expect(shiftFormula('=SUM(A1:A3)', 1, 0)).toBe('=SUM(A2:A4)');
    expect(shiftFormula('=SUM(A:A)', 5, 1)).toBe('=SUM(B:B)');
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
    expect(shiftFormula('=Data!A1*2', 1, 0)).toBe('=Data!A2*2');
  });
  it('follows rows inserted and deleted', () => {
    const ins = { sheet: 'Sheet1', axis: 'row' as const, at: 2, count: 2 };
    expect(adjustFormula('=A1+A3+A5', 'Sheet1', ins)).toBe('=A1+A5+A7');
    expect(adjustFormula('=SUM(A1:A5)', 'Sheet1', ins)).toBe('=SUM(A1:A7)'); // grows
    expect(adjustFormula('=A3', 'Data', ins)).toBe('=A3'); // another sheet's own cells
    expect(adjustFormula('=Sheet1!A3', 'Data', ins)).toBe('=Sheet1!A5');
    const del = { sheet: 'Sheet1', axis: 'row' as const, at: 2, count: -2 };
    expect(adjustFormula('=A1+A3+A6', 'Sheet1', del)).toBe('=A1+#REF!+A4');
    expect(adjustFormula('=SUM(A1:A6)', 'Sheet1', del)).toBe('=SUM(A1:A4)'); // shrinks
    expect(adjustFormula('=SUM(A3:A4)', 'Sheet1', del)).toBe('=SUM(#REF!)');
  });
  it('follows columns inserted and deleted', () => {
    const ins = { sheet: 'Sheet1', axis: 'col' as const, at: 1, count: 1 };
    expect(adjustFormula('=A1+B1+SUM(C:D)', 'Sheet1', ins)).toBe('=A1+C1+SUM(D:E)');
    const del = { sheet: 'Sheet1', axis: 'col' as const, at: 1, count: -1 };
    expect(adjustFormula('=A1+B1+C1', 'Sheet1', del)).toBe('=A1+#REF!+B1');
  });
  it('follows a sheet that is renamed', () => {
    expect(renameSheetInFormula("=Data!A1+'Data'!B2", 'Data', 'My data')).toBe("='My data'!A1+'My data'!B2");
  });
});

describe('typed values', () => {
  it('reads typing as Excel does', () => {
    expect(readTyped('12.5')).toEqual({ value: 12.5, format: undefined });
    expect(readTyped('5%')).toEqual({ value: 0.05, format: '0%' });
    expect(readTyped('2.5%')).toEqual({ value: 0.025, format: '0.0%' });
    expect(readTyped('1.5E-3')).toEqual({ value: 0.0015, format: '0.00E+00' });
    expect(readTyped('1,234.5')).toEqual({ value: 1234.5, format: '#,##0.0' });
    expect(readTyped('true').value).toBe(true);
    expect(readTyped("'123").value).toBe('123');
    expect(readTyped('=A1').formula).toBe('=A1');
    expect(readTyped('2a').value).toBe('2a');
    expect(readTyped('-').value).toBe('-');
  });
  it('orders values as Excel sorts them', () => {
    const vals: Value[] = ['b', 3, true, 'A', 1];
    expect(vals.sort(compareValues)).toEqual([1, 3, 'A', 'b', true]);
  });
});
