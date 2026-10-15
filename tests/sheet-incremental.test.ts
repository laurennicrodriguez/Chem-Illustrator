// Working out only what an edit affects: after every edit, the values must be exactly those a
// full recalculation gives. Random workbooks and random edits (values, formulas, clearing,
// property columns, other sheets, undo and redo) check this.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';

/** A small random number generator, so a failure can be run again. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const snapshot = (wb: Workbook) => wb.sheets.map((s) => JSON.stringify([...s.values.entries()].sort((a, b) => a[0] - b[0]), (_, v) => (v instanceof Object && 'code' in v ? v.code : v)));

describe('recalculating only what an edit changes', () => {
  it('gives the same values as working out everything', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rand = rng(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
      const wb = new Workbook(['Data', 'Calc']);
      const [d, c] = wb.sheets;
      const cell = () => `${'ABCDE'[Math.floor(rand() * 5)]}${1 + Math.floor(rand() * 12)}`;
      const formulas = () => pick([
        `=${cell()}*2`, `=${cell()}+${cell()}`, `=SUM(A1:${cell()})`, `=AVERAGE(B1:B12)`, `=Data!${cell()}-1`,
        `=IF(${cell()}>5,"big","small")`, `=MAX(A:A)`, `=COUNT(C1:E12)`, `=${cell()}&"x"`, `=${cell()}`,
      ]);
      wb.edit('fill', () => {
        for (let r = 0; r < 12; r++) for (let col = 0; col < 5; col++) {
          if (rand() < 0.6) d.setInput(r, col, rand() < 0.75 ? String(Math.floor(rand() * 20)) : formulas());
          if (rand() < 0.4) c.setInput(r, col, formulas());
        }
      });
      for (let step = 0; step < 60; step++) {
        const what = rand();
        const s = rand() < 0.7 ? d : c;
        const r = Math.floor(rand() * 14), col = Math.floor(rand() * 6);
        if (what < 0.55) wb.edit('type', () => s.setInput(r, col, String(Math.floor(rand() * 30))));
        else if (what < 0.7) wb.edit('clear', () => s.setInput(r, col, ''));
        else if (what < 0.8) wb.edit('formula', () => s.setInput(r, col, formulas()));
        else if (what < 0.85) wb.edit('style', () => s.patchStyle({ r1: r, c1: col, r2: r, c2: col }, { bold: rand() < 0.5 }));
        else if (what < 0.88) wb.edit('column', () => s.setColDef(5, rand() < 0.5 ? { formula: '=A2*10', firstRow: 1 } as never : undefined));
        else if (what < 0.94) wb.undo();
        else wb.redo();
        const got = snapshot(wb);
        wb.recalc();
        expect(got, `seed ${seed}, step ${step}`).toEqual(snapshot(wb));
      }
    }
  });

  it('is quick on a large sheet', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    const N = 20000;
    wb.edit('fill', () => {
      for (let r = 0; r < N; r++) { s.setInput(r, 0, String(r)); s.setInput(r, 1, `=A${r + 1}*2+1`); }
      s.setInput(0, 3, `=SUM(B1:B${N})`);
    });
    const t = performance.now();
    for (let k = 0; k < 10; k++) wb.edit('e', () => s.setInput(5, 0, String(100 + k)));
    const each = (performance.now() - t) / 10;
    expect(s.values.get(3)).toBe(N * (N - 1) + N + 2 * (109 - 5));
    // a full recalculation took about 120 ms here
    expect(each).toBeLessThan(40);
  });
});
