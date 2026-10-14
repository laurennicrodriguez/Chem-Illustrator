// Where each element goes in the periodic table window.

import { describe, expect, it } from 'vitest';
import { tablePosition } from '../src/chem/elements';

describe('periodic table positions', () => {
  it('puts elements in their groups', () => {
    expect(tablePosition(1)).toEqual({ row: 1, col: 1 }); // H
    expect(tablePosition(2)).toEqual({ row: 1, col: 18 }); // He
    expect(tablePosition(5)).toEqual({ row: 2, col: 13 }); // B
    expect(tablePosition(17)).toEqual({ row: 3, col: 17 }); // Cl
    expect(tablePosition(26)).toEqual({ row: 4, col: 8 }); // Fe
    expect(tablePosition(46)).toEqual({ row: 5, col: 10 }); // Pd
    expect(tablePosition(56)).toEqual({ row: 6, col: 2 }); // Ba
    expect(tablePosition(57)).toEqual({ row: 9, col: 3 }); // La, first of the lanthanide row
    expect(tablePosition(71)).toEqual({ row: 9, col: 17 }); // Lu
    expect(tablePosition(72)).toEqual({ row: 6, col: 4 }); // Hf
    expect(tablePosition(86)).toEqual({ row: 6, col: 18 }); // Rn
    expect(tablePosition(92)).toEqual({ row: 10, col: 6 }); // U
    expect(tablePosition(118)).toEqual({ row: 7, col: 18 }); // Og
    expect(tablePosition(0)).toBeNull();
  });

  it('gives every element its own square', () => {
    const seen = new Set<string>();
    for (let z = 1; z <= 118; z++) {
      const p = tablePosition(z)!;
      const k = `${p.row},${p.col}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});
