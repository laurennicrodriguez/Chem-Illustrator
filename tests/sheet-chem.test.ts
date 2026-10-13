// Chemistry in sheets: the properties RDKit works out for a structure, substructure search, and
// how the sheet asks for them (in batches, in the background, each answer kept).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { molProps, substructureMatches } from '../src/chem/props';
import { SheetChem, ChemEngine } from '../src/sheet/sheet-chem';
import { Workbook, makeStructure } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import type { MolProps } from '../src/sheet/properties';
import type { Contents } from '../src/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

describe('properties of a structure', () => {
  it('works out formula, masses and the drug-likeness numbers', () => {
    // caffeine
    const p = molProps(RDKit, 'Cn1c(=O)c2c(ncn2C)n(C)c1=O') as MolProps;
    expect(p.formula).toBe('C8H10N4O2');
    expect(p.mw).toBeCloseTo(194.19, 2);
    expect(p.exact).toBeCloseTo(194.0804, 4);
    expect(p.charge).toBe(0);
    expect(p.inchikey).toBe('RYYVLZVUVIJVGH-UHFFFAOYSA-N');
    expect(p.hbd).toBe(0);
    expect(p.hba).toBe(6);
    expect(p.rotb).toBe(0);
    expect(p.tpsa).toBeCloseTo(61.82, 1);
    expect(p.clogp).toBeCloseTo(-1.03, 2);
  });

  it('keeps the charge of an ion', () => {
    const p = molProps(RDKit, 'C[N+](C)(C)C') as MolProps;
    expect(p.charge).toBe(1);
    expect(p.formula).toBe('C4H12N+');
  });

  it('says what went wrong', () => {
    expect(molProps(RDKit, 'not a molecule')).toEqual({ error: 'Not a structure or a SMILES string.' });
    expect(molProps(RDKit, 'C1CC')).toHaveProperty('error');
  });
});

describe('substructure search', () => {
  it('finds a drawn part in larger structures', () => {
    const mols = ['Cc1ccccc1', 'C1CCCCC1', 'CC(=O)Oc1ccccc1C(=O)O', 'nonsense('];
    expect(substructureMatches(RDKit, 'c1ccccc1', mols).results).toEqual([true, false, true, null]);
    // as in most structure searches, the query's hydrogens are open places: a drawn CO2H finds esters too
    expect(substructureMatches(RDKit, 'C(=O)[OH]', ['CC(=O)O', 'CC(=O)OC', 'CC(=O)C']).results).toEqual([true, true, false]);
  });

  it('lets anything be attached to the query’s atoms', () => {
    // a drawn pyridine (with its hydrogens left off) finds substituted pyridines
    expect(substructureMatches(RDKit, 'c1ccncc1', ['Cc1ccncc1', 'c1ccccc1']).results).toEqual([true, false]);
  });

  it('reports a query it cannot read', () => {
    const r = substructureMatches(RDKit, 'C1CC', ['CC']);
    expect(r.error).toBeTruthy();
    expect(r.results).toEqual([null]);
  });
});

/** A stand-in for the chemistry engine that reads "molfiles" as SMILES and counts its calls. */
function fakeEngine(): ChemEngine & { calls: number; ready: boolean } {
  const e = {
    ready: true,
    calls: 0,
    async props(mols: string[]) {
      e.calls++;
      return mols.map((m) => molProps(RDKit, m));
    },
    async substructure(query: string, mols: string[]) {
      e.calls++;
      return substructureMatches(RDKit, query, mols);
    },
  };
  return e;
}

/** A "drawing" for the fake engine: its SMILES in a caption. */
const drawn = (smiles: string): Contents => ({ atoms: [], bonds: [], arrows: [], shapes: [], captions: [{ id: 1, x: 0, y: 0, runs: [{ text: smiles }] } as never] });
const smilesOf = (c: Contents) => {
  const t = (c.captions[0] as unknown as { runs: { text: string }[] } | undefined)?.runs[0].text;
  return t ? { molblock: t } : { molblock: null, problem: 'There is no structure in this cell' };
};

describe('chemistry for a workbook', () => {
  it('answers "busy" first, asks once for everything, then keeps the answers', async () => {
    const eng = fakeEngine();
    const chem = new SheetChem(eng, smilesOf);
    let answered = 0;
    chem.onAnswers = () => answered++;
    const a = makeStructure(drawn('CCO')), b = makeStructure(drawn('c1ccccc1'));
    expect((chem.structure(a) as CellError).code).toBe('#BUSY!');
    expect((chem.structure(b) as CellError).code).toBe('#BUSY!');
    expect((chem.smiles('CC(=O)C') as CellError).code).toBe('#BUSY!');
    expect(chem.busy).toBe(true);
    await chem.settled();
    expect(eng.calls).toBe(1);
    expect(answered).toBe(1);
    expect((chem.structure(a) as MolProps).formula).toBe('C2H6O');
    expect((chem.structure(b) as MolProps).formula).toBe('C6H6');
    expect((chem.smiles('CC(=O)C') as MolProps).formula).toBe('C3H6O');
    expect(eng.calls).toBe(1);
  });

  it('gives a reason for a cell without a structure, without asking the engine', async () => {
    const eng = fakeEngine();
    const chem = new SheetChem(eng, smilesOf);
    const empty = makeStructure(drawn(''));
    chem.structure(empty);
    await chem.settled();
    expect(eng.calls).toBe(0);
    expect((chem.structure(empty) as CellError).code).toBe('#VALUE!');
  });

  it('waits for the engine to load', async () => {
    const eng = fakeEngine();
    eng.ready = false;
    const chem = new SheetChem(eng, smilesOf);
    chem.smiles('CCN');
    await new Promise((r) => setTimeout(r, 5));
    expect(eng.calls).toBe(0);
    eng.ready = true;
    chem.flush();
    await chem.settled();
    expect((chem.smiles('CCN') as MolProps).formula).toBe('C2H7N');
  });

  it('searches structures for a drawn part', async () => {
    const chem = new SheetChem(fakeEngine(), smilesOf);
    const q = drawn('c1ccccc1');
    const tol = makeStructure(drawn('Cc1ccccc1')), hex = makeStructure(drawn('C1CCCCC1'));
    expect(chem.substructure(tol, q)).toBeNull();
    chem.substructure(hex, q);
    await chem.settled();
    expect(chem.substructure(tol, q)).toBe(true);
    expect(chem.substructure(hex, q)).toBe(false);
  });

  it('fills property columns in a workbook once the answers come', async () => {
    const chem = new SheetChem(fakeEngine(), smilesOf);
    const wb = new Workbook();
    wb.chem = chem;
    chem.onAnswers = () => wb.recalc();
    wb.edit('Type', () => {
      wb.sheet.setStructure(0, 0, drawn('CCO'));
      wb.sheet.setInput(0, 1, '=MW(A1)');
      wb.sheet.setInput(0, 2, '=46/MW(A1)*1000');
      wb.sheet.setInput(1, 0, 'CC(=O)O');
      wb.sheet.setInput(1, 1, '=FORMULA(A2)');
    });
    expect((wb.sheet.value(0, 1) as CellError).code).toBe('#BUSY!');
    await chem.settled();
    expect(wb.sheet.value(0, 1)).toBeCloseTo(46.069, 3);
    expect(wb.sheet.value(0, 2)).toBeCloseTo(998.5, 1);
    expect(wb.sheet.value(1, 1)).toBe('C2H4O2');
  });
});
