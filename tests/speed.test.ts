// Speed improvements from the code review: each keeps its answers exactly as before.

import { describe, it, expect } from 'vitest';
import { isotopePattern, formulaCounts } from '../src/chem/analysis';
import { parseFormula, shiftFormula, shiftTree } from '../src/sheet/formula';

describe('isotope pattern', () => {
  it('works out a protein-sized ion quickly (it took over 2 s)', () => {
    const t = performance.now();
    const p = isotopePattern(formulaCounts('C1500H2400N400O450S20')!, 1)!;
    expect(performance.now() - t).toBeLessThan(200);
    // the tallest peak is well above the monoisotopic one for an ion this big
    expect(p.reduce((best, q, i) => (q.rel > p[best].rel ? i : best), 0)).toBeGreaterThan(10);
  });
  it('gives the same peaks for a bromine cluster', () => {
    const p = isotopePattern(formulaCounts('CH2Br2')!, 1)!;
    expect(p.slice(0, 5).map((q) => Math.round(q.rel))).toEqual([51, 1, 100, 1, 49]);
  });
});

describe('formula rules moved as a tree', () => {
  it('match moving the text and reading it again', () => {
    const fs = ['=A1*2', '=$A1+B$2', '=SUM(A1:B3)', '=Sheet2!C4', '=SUM(A:A)', '=IF(A1>5,"x",-B2%)', '=A1&$B$1', '=MAX(A1,B1:C2)'];
    for (const f of fs) for (const [dr, dc] of [[0, 0], [3, 1], [-1, 0], [10, -1]]) {
      expect(shiftTree(parseFormula(f), dr, dc), `${f} ${dr},${dc}`).toEqual(parseFormula(shiftFormula(f, dr, dc)));
    }
  });
});
