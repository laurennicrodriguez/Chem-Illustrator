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

describe('formatting as you type in a long document', () => {
  it('formats the word just finished without going through the whole text', async () => {
    const { TextEditing } = await import('../src/text/editing');
    const { afterTyping, DEFAULT_TYPING } = await import('../src/text/typing');
    const long = 'The crude product was purified by flash chromatography on silica gel (CH2Cl2/MeOH). '.repeat(700);
    const ed = new TextEditing({ runs: [{ text: long }], justify: 'left' }, { size: 10 }, (t, s) => t.length * s * 0.5, 10);
    ed.onTyped = (t) => afterTyping(ed, t, DEFAULT_TYPING);
    ed.setCaret(ed.text.length);
    const t = performance.now();
    for (const ch of 'Dried over MgSO4 in DMSO-d6 under N2 atmosphere ') ed.type(ch);
    const ms = performance.now() - t;
    const subs = ed.t.runs.filter((r) => r.sub).map((r) => r.text).join('');
    // MgSO4, DMSO-d6 (d italic, 6 down) and N2 formatted; the old text is left as it was
    expect(subs).toBe('462');
    expect(ed.t.runs.some((r) => r.italic && r.text === 'd')).toBe(true);
    expect(ms).toBeLessThan(400);
  });

  it('reads the looks of a stretch the same as of the whole text', async () => {
    const { TextEditing } = await import('../src/text/editing');
    const ed = new TextEditing({ runs: [{ text: 'a CH' }, { text: '2', sub: true }, { text: 'Cl2', formula: true }, { text: ' x', italic: true }, { text: '13', sup: true }], justify: 'left' }, { size: 10 }, (t, s) => t.length * s * 0.5, 10);
    const all = ed.looks();
    for (let a = 0; a < all.length; a++) for (let b = a; b <= all.length; b++) expect(ed.looksBetween(a, b)).toEqual(all.slice(a, b));
  });
});
