// The sheet model: typing, formulas worked out in order, property columns, undo, fill, copy and
// paste, inserting and deleting rows, sorting and filtering.

import { describe, it, expect } from 'vitest';
import { Workbook, ChemHost, Structure, countOn, makeStructure } from '../src/sheet/workbook';
import { CellError, ERR } from '../src/sheet/values';
import { MolProps } from '../src/sheet/properties';
import { MAX_ROWS } from '../src/sheet/refs';
import type { Contents } from '../src/model';

const A = (s: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(s)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1] as const;
};

function book(): Workbook {
  return new Workbook();
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

/** A drawing standing for a molecule: one atom whose label is the SMILES, for the fake chemistry engine. */
const mol = (smiles: string): Contents => ({ atoms: [{ id: 1, x: 0, y: 0, z: 6, charge: 0, isotope: 0, label: smiles } as never], bonds: [], captions: [], arrows: [], shapes: [] });

const PROPS: Record<string, MolProps> = {
  CCO: { formula: 'C2H6O', mw: 46.069, exact: 46.0418648, charge: 0, smiles: 'CCO', inchikey: 'LFQSCWFLJHTTHZ-UHFFFAOYSA-N', clogp: -0.0014, tpsa: 20.23, hbd: 1, hba: 1, rotb: 0 },
  c1ccccc1: { formula: 'C6H6', mw: 78.114, exact: 78.04695, charge: 0, smiles: 'c1ccccc1', inchikey: 'UHOVQNZJYSORNB-UHFFFAOYSA-N', clogp: 1.6866, tpsa: 0, hbd: 0, hba: 0, rotb: 0 },
  'CC(=O)Oc1ccccc1C(=O)O': { formula: 'C9H8O4', mw: 180.159, exact: 180.0422587, charge: 0, smiles: 'CC(=O)Oc1ccccc1C(=O)O', inchikey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', clogp: 1.3101, tpsa: 63.6, hbd: 1, hba: 4, rotb: 2 },
};

/** A chemistry engine that knows three molecules, and can be made to be "still working". */
function fakeChem(): ChemHost & { busy: boolean } {
  const smilesOf = (s: Structure) => (s.contents.atoms[0] as { label?: string }).label ?? '';
  const look = (smiles: string) => PROPS[smiles] ?? ERR.value('Could not read this structure');
  const h = {
    busy: false,
    structure(s: Structure) { return h.busy ? ERR.busy() : look(smilesOf(s)); },
    smiles(t: string) { return h.busy ? ERR.busy() : look(t); },
    substructure(s: Structure, q: Contents) {
      const want = (q.atoms[0] as { label?: string }).label ?? '';
      return smilesOf(s).includes(want);
    },
  };
  return h;
}

describe('cells and formulas', () => {
  it('works out formulas after typing, in the order they depend on each other', () => {
    const wb = book();
    type(wb, { A1: '=B1*2', B1: '=C1+1', C1: '4' });
    expect(val(wb, 'A1')).toBe(10);
    type(wb, { C1: '10' });
    expect(val(wb, 'A1')).toBe(22);
  });
  it('shows #CIRC! for a formula that uses its own result', () => {
    const wb = book();
    type(wb, { A1: '=B1+1', B1: '=A1+1', C1: '=A1*2', D1: '5' });
    expect(val(wb, 'A1')).toBe('#CIRC!');
    expect(val(wb, 'C1')).toBe('#CIRC!');
    expect(val(wb, 'D1')).toBe(5);
  });
  it('copes with a long chain of formulas (a running total down 5000 rows)', () => {
    const wb = book();
    wb.edit('Type', () => {
      wb.sheet.setInput(0, 0, '1');
      for (let r = 1; r < 5000; r++) wb.sheet.setInput(r, 0, `=A${r}+1`);
    });
    expect(wb.sheet.value(4999, 0)).toBe(5000);
  });
  it('tidies typed formulas and keeps the format typing suggests', () => {
    const wb = book();
    type(wb, { A1: '=sum(b1:b3)', B1: '5%' });
    expect(wb.sheet.cell(0, 0)!.input).toBe('=SUM(B1:B3)');
    expect(wb.sheet.styleAt(0, 1)?.numFmt).toBe('0%');
    expect(wb.sheet.shownText(0, 1)).toBe('5%');
  });
  it('reads other sheets, and follows a sheet that is renamed', () => {
    const wb = book();
    const data = wb.edit('Add', () => wb.addSheet('Data'));
    wb.edit('Type', () => data.setInput(0, 0, '7'));
    type(wb, { A1: '=Data!A1*3' });
    expect(val(wb, 'A1')).toBe(21);
    wb.edit('Rename', () => data.rename('Yields 2026'));
    expect(wb.sheet.cell(0, 0)!.input).toBe("='Yields 2026'!A1*3");
    expect(val(wb, 'A1')).toBe(21);
    wb.edit('Delete', () => wb.removeSheet(data));
    expect(val(wb, 'A1')).toBe('#REF!');
  });
});

describe('undo and redo', () => {
  it('undoes and redoes whole steps, across sheets', () => {
    const wb = book();
    type(wb, { A1: '1', A2: '2' });
    type(wb, { A1: '10' });
    const s2 = wb.edit('Add sheet', () => wb.addSheet());
    expect(wb.sheets).toHaveLength(2);
    wb.undo();
    expect(wb.sheets).toHaveLength(1);
    wb.undo();
    expect(val(wb, 'A1')).toBe(1);
    wb.redo();
    expect(val(wb, 'A1')).toBe(10);
    wb.redo();
    expect(wb.sheets[1]).toBe(s2);
    expect(wb.canRedo()).toBe(false);
  });
  it('counts changes so the file knows it has unsaved work', () => {
    const wb = book();
    const e0 = wb.edits;
    type(wb, { A1: 'x' });
    wb.edit('Nothing', () => wb.sheet.setInput(0, 0, 'x'));
    expect(wb.edits).toBe(e0 + 1);
  });
  it('takes back where the selection was', () => {
    const wb = book();
    const sel = { r1: 4, c1: 2, r2: 4, c2: 2 };
    wb.edit('Type', () => wb.sheet.setInput(4, 2, 'hi'), { sheet: wb.sheet, sel });
    expect(wb.undo()!.sel).toEqual(sel);
  });
});

describe('structures and property columns', () => {
  function table(): Workbook {
    const wb = book();
    wb.chem = fakeChem();
    wb.edit('Build', () => {
      const s = wb.sheet;
      s.setInput(0, 0, 'ID');
      s.setInput(0, 1, 'Structure');
      s.setInput(0, 2, 'MW');
      s.setInput(0, 3, 'Mass (mg)');
      s.setInput(0, 4, 'mmol');
      s.setStructure(1, 1, mol('CCO'));
      s.setStructure(2, 1, mol('c1ccccc1'));
      s.setInput(1, 3, '46.069');
      s.setInput(2, 3, '156.2');
      s.setColDef(2, { formula: '=MW(B2)', firstRow: 1, style: { numFmt: '0.00' } });
      s.setColDef(4, { formula: '=D2/C2', firstRow: 1, style: { numFmt: '0.000' } });
    });
    return wb;
  }
  it('fills a property column for every structure, and uses it in formulas', () => {
    const wb = table();
    expect(val(wb, 'C2')).toBe(46.069);
    expect(val(wb, 'C3')).toBe(78.114);
    expect(wb.sheet.shownText(...A('C3'))).toBe('78.11');
    expect(val(wb, 'E2')).toBeCloseTo(1, 9);
    expect(wb.sheet.shownText(...A('E3'))).toBe('2.000');
    expect(wb.sheet.effectiveInput(...A('C3'))).toBe('=MW(B3)');
  });
  it('reaches new rows by itself', () => {
    const wb = table();
    wb.edit('Draw', () => wb.sheet.setStructure(5, 1, mol('CC(=O)Oc1ccccc1C(=O)O')));
    expect(val(wb, 'C6')).toBe(180.159);
    expect(val(wb, 'C5')).toBe(''); // a row with no structure stays empty
    wb.undo();
    expect(wb.sheet.value(5, 2)).toBeNull();
  });
  it('lets a value be typed over, and puts the calculated one back', () => {
    const wb = table();
    type(wb, { C2: '46.07' });
    expect(val(wb, 'C2')).toBe(46.07);
    expect(wb.sheet.isOverride(...A('C2'))).toBe(true);
    expect(wb.sheet.isOverride(...A('C3'))).toBe(false);
    wb.edit('Reset', () => wb.sheet.setCell(...A('C2'), { style: wb.sheet.cell(...A('C2'))?.style }));
    expect(val(wb, 'C2')).toBe(46.069);
  });
  it('updates when a structure changes', () => {
    const wb = table();
    wb.edit('Edit', () => wb.sheet.setStructure(1, 1, mol('CC(=O)Oc1ccccc1C(=O)O')));
    expect(val(wb, 'C2')).toBe(180.159);
  });
  it('shows … while the chemistry engine works, then the values', () => {
    const wb = table();
    const chem = wb.chem as ReturnType<typeof fakeChem>;
    chem.busy = true;
    wb.recalc();
    expect(wb.sheet.shownText(...A('C2'))).toBe('…');
    expect(val(wb, 'E2')).toBe('#BUSY!');
    chem.busy = false;
    wb.recalc();
    expect(val(wb, 'C2')).toBe(46.069);
  });
  it('gives a structure cell its SMILES when a formula reads it', () => {
    const wb = table();
    type(wb, { G2: '=B3' });
    expect(val(wb, 'G2')).toBe('c1ccccc1');
  });
  it('works out properties from SMILES typed in a cell', () => {
    const wb = table();
    type(wb, { G1: 'CCO', H1: '=FORMULA(G1)' });
    expect(val(wb, 'H1')).toBe('C2H6O');
  });
  it('moves with columns inserted before it, and goes when cleared whole', () => {
    const wb = table();
    wb.edit('Insert', () => wb.sheet.insertCols(1, 1));
    expect(wb.sheet.colDefs.get(3)?.formula).toBe('=MW(C2)');
    expect(val(wb, 'D3')).toBe(78.114);
    wb.edit('Clear', () => wb.sheet.clear({ r1: 0, c1: 3, r2: MAX_ROWS - 1, c2: 3 }, 'all'));
    expect(wb.sheet.colDefs.has(3)).toBe(false);
  });
  it('keeps its first row right when rows are inserted or deleted above', () => {
    const wb = table();
    wb.edit('Insert', () => wb.sheet.insertRows(0, 2));
    expect(wb.sheet.colDefs.get(2)).toMatchObject({ firstRow: 3, formula: '=MW(B4)' });
    expect(val(wb, 'C4')).toBe(46.069);
    wb.edit('Delete', () => wb.sheet.deleteRows(2, 2)); // the header row and the first row of data
    expect(wb.sheet.colDefs.get(2)).toMatchObject({ firstRow: 2, formula: '=MW(B3)' });
    expect(val(wb, 'C3')).toBe(78.114);
  });
});

describe('fill, copy and paste', () => {
  it('fills a formula down, moving its references', () => {
    const wb = book();
    type(wb, { A1: '1', A2: '2', A3: '3', B1: '=A1*10' });
    wb.edit('Fill', () => wb.sheet.fill({ r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 2, c2: 1 }));
    expect(wb.sheet.cell(2, 1)!.input).toBe('=A3*10');
    expect(val(wb, 'B3')).toBe(30);
  });
  it('continues series and compound numbers', () => {
    const wb = book();
    type(wb, { A1: '1', A2: '3', B1: 'S1', C1: '2a' });
    wb.edit('Fill', () => wb.sheet.fill({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 }, true));
    expect([2, 3, 4].map((r) => wb.sheet.value(r, 0))).toEqual([5, 7, 9]);
    wb.edit('Fill', () => wb.sheet.fill({ r1: 0, c1: 1, r2: 0, c2: 2 }, { r1: 0, c1: 1, r2: 3, c2: 2 }, true));
    expect([1, 2, 3].map((r) => wb.sheet.cell(r, 1)!.input)).toEqual(['S2', 'S3', 'S4']);
    expect([1, 2, 3].map((r) => wb.sheet.cell(r, 2)!.input)).toEqual(['2b', '2c', '2d']);
    expect(countOn('Entry 9', 1)).toBe('Entry 10');
    expect(countOn('007', 2)).toBe('009');
    expect(countOn('3z', 1)).toBe('3z');
    expect(countOn('THF', 3)).toBe('THF');
  });
  it('pastes formulas moved by the distance from where they were copied', () => {
    const wb = book();
    type(wb, { A1: '2', B1: '=A1*2', A5: '10' });
    const block = wb.sheet.copy({ r1: 0, c1: 1, r2: 0, c2: 1 });
    wb.edit('Paste', () => wb.sheet.paste({ row: 4, col: 1 }, block));
    expect(wb.sheet.cell(4, 1)!.input).toBe('=A5*2');
    expect(val(wb, 'B5')).toBe(20);
  });
});

describe('rows and columns', () => {
  it('keeps formulas pointing at the same cells when rows go in and out', () => {
    const wb = book();
    type(wb, { A1: '1', A2: '2', A3: '3', A5: '=SUM(A1:A3)' });
    wb.edit('Insert', () => wb.sheet.insertRows(1, 1));
    expect(wb.sheet.cell(5, 0)!.input).toBe('=SUM(A1:A4)');
    expect(wb.sheet.value(5, 0)).toBe(6);
    wb.edit('Delete', () => wb.sheet.deleteRows(0, 1));
    expect(wb.sheet.cell(4, 0)!.input).toBe('=SUM(A1:A3)');
    expect(wb.sheet.value(4, 0)).toBe(5);
  });
  it('moves merged cells, widths and heights with them', () => {
    const wb = book();
    wb.edit('Set', () => {
      wb.sheet.merge({ r1: 2, c1: 0, r2: 3, c2: 1 });
      wb.sheet.setRowHeight(2, 40);
      wb.sheet.setColWidth(1, 120);
    });
    wb.edit('Insert', () => { wb.sheet.insertRows(0, 1); wb.sheet.insertCols(0, 1); });
    expect(wb.sheet.merges).toEqual([{ r1: 3, c1: 1, r2: 4, c2: 2 }]);
    expect(wb.sheet.rowHeights.get(3)).toBe(40);
    expect(wb.sheet.colWidths.get(2)).toBe(120);
    wb.undo();
    expect(wb.sheet.merges).toEqual([{ r1: 2, c1: 0, r2: 3, c2: 1 }]);
  });
});

describe('sorting and filtering', () => {
  function data(): Workbook {
    const wb = book();
    wb.chem = fakeChem();
    type(wb, { A1: 'Name', B1: 'Yield', C1: 'Twice', A2: 'b', B2: '50', A3: 'a', B3: '', A4: 'c', B4: '90', A5: 'd', B5: '10' });
    wb.edit('Fill', () => {
      wb.sheet.setInput(1, 2, '=B2*2');
      wb.sheet.fill({ r1: 1, c1: 2, r2: 1, c2: 2 }, { r1: 1, c1: 2, r2: 4, c2: 2 });
    });
    return wb;
  }
  it('sorts rows, keeping empty cells last and formulas with their rows', () => {
    const wb = data();
    wb.edit('Sort', () => wb.sheet.sort({ r1: 1, c1: 0, r2: 4, c2: 2 }, [{ col: 1 }]));
    expect([1, 2, 3, 4].map((r) => wb.sheet.value(r, 0))).toEqual(['d', 'b', 'c', 'a']);
    expect([1, 2, 3, 4].map((r) => wb.sheet.value(r, 2))).toEqual([20, 100, 180, 0]);
    wb.edit('Sort', () => wb.sheet.sort({ r1: 1, c1: 0, r2: 4, c2: 2 }, [{ col: 1, descending: true }]));
    expect([1, 2, 3, 4].map((r) => wb.sheet.value(r, 0))).toEqual(['c', 'b', 'd', 'a']);
  });
  it('sorts structures by molecular weight', () => {
    const wb = book();
    wb.chem = fakeChem();
    wb.edit('Draw', () => {
      wb.sheet.setStructure(0, 0, mol('CC(=O)Oc1ccccc1C(=O)O'));
      wb.sheet.setStructure(1, 0, mol('CCO'));
      wb.sheet.setStructure(2, 0, mol('c1ccccc1'));
    });
    wb.edit('Sort', () => wb.sheet.sort({ r1: 0, c1: 0, r2: 2, c2: 0 }, [{ col: 0 }]));
    expect([0, 1, 2].map((r) => wb.sheet.value(r, 0))).toEqual(['CCO', 'c1ccccc1', 'CC(=O)Oc1ccccc1C(=O)O']);
  });
  it('hides rows that fail a filter, and shows them again', () => {
    const wb = data();
    wb.edit('Filter', () => wb.sheet.setFilter({ range: { r1: 0, c1: 0, r2: 4, c2: 2 }, conditions: { 1: { kind: 'compare', op: '<', value: 60 } } }));
    expect([...wb.sheet.hiddenRows.keys()].sort()).toEqual([2, 3]); // the empty yield and 90
    wb.edit('Filter', () => wb.sheet.setCondition(1, { kind: 'compare', op: '>=', value: 10, join: 'and', op2: '<=', value2: 50 }));
    expect([...wb.sheet.hiddenRows.keys()].sort()).toEqual([2, 3]);
    wb.edit('Filter', () => wb.sheet.setCondition(1, { kind: 'values', allowed: ['90', ''] }));
    expect([...wb.sheet.hiddenRows.keys()].sort()).toEqual([1, 4]);
    wb.edit('Filter', () => wb.sheet.setCondition(0, { kind: 'contains', text: 'C' }));
    expect([...wb.sheet.hiddenRows.keys()].sort()).toEqual([1, 2, 4]);
    wb.edit('Off', () => wb.sheet.setFilter(null));
    expect(wb.sheet.hiddenRows.size).toBe(0);
  });
  it('filters by a substructure', () => {
    const wb = book();
    wb.chem = fakeChem();
    wb.edit('Draw', () => {
      wb.sheet.setInput(0, 0, 'Structure');
      wb.sheet.setStructure(1, 0, mol('CC(=O)Oc1ccccc1C(=O)O'));
      wb.sheet.setStructure(2, 0, mol('CCO'));
      wb.sheet.setStructure(3, 0, mol('c1ccccc1'));
    });
    wb.edit('Filter', () => wb.sheet.setFilter({ range: { r1: 0, c1: 0, r2: 3, c2: 0 }, conditions: { 0: { kind: 'substructure', query: mol('c1ccccc1') } } }));
    expect([...wb.sheet.hiddenRows.keys()]).toEqual([2]);
  });
  it('finds the table around a cell', () => {
    const wb = data();
    type(wb, { F10: 'apart' });
    expect(wb.sheet.currentRegion(2, 1)).toEqual({ r1: 0, c1: 0, r2: 4, c2: 2 });
  });
});

describe('structures', () => {
  it('get new ids when made, so pictures and properties can be kept by id', () => {
    const a = makeStructure(mol('CCO')), b = makeStructure(mol('CCO'));
    expect(a.id).not.toBe(b.id);
  });
});
