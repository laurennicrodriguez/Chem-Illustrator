// R-group tables: finding the R groups, putting each row's groups in place, and the table's cells.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { rGroupsOf, substituted, rowNumbers, parseRows, rGroupCells } from '../src/chem/rgroup';
import { formulaFromJson } from '../src/chem/formula';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

/** Benzene with R1 and R2 para to each other. */
function core(): { doc: Doc; ids: number[] } {
  const doc = new Doc();
  const ids: number[] = [];
  doc.edit('core', () => {
    const ring = Array.from({ length: 6 }, (_, i) => doc.addAtom(Math.cos((i * Math.PI) / 3) * 14, Math.sin((i * Math.PI) / 3) * 14));
    ring.forEach((a, i) => doc.addBond(a.id, ring[(i + 1) % 6].id, i % 2 ? 1 : 2));
    const r2 = doc.addAtom(42, 0, 0, { label: 'R2' });
    const r1 = doc.addAtom(-28, 0, 0, { label: 'R1' });
    doc.addBond(ring[0].id, r2.id);
    doc.addBond(ring[3].id, r1.id);
    ids.push(...ring.map((a) => a.id), r2.id, r1.id);
  });
  return { doc, ids };
}

const formulaOf = (molblock: string) => {
  const m = RDKit.get_mol(molblock);
  try { return formulaFromJson(m.get_json()).formula; } finally { m.delete(); }
};

describe('R-group tables', () => {
  it('finds the R groups in order', () => {
    const { doc, ids } = core();
    expect(rGroupsOf(doc, ids).map((g) => g.label)).toEqual(['R1', 'R2']);
  });

  it('puts each row\'s groups in place of the R labels', () => {
    const { doc, ids } = core();
    expect(formulaOf(substituted(doc, ids, { R1: 'OMe', R2: 'H' }).molblock)).toBe('C7H8O'); // anisole
    expect(formulaOf(substituted(doc, ids, { R1: 'Cl', R2: 'CO2Et' }).molblock)).toBe('C9H9ClO2');
    expect(formulaOf(substituted(doc, ids, { R1: 'Me', R2: 'Me' }).molblock)).toBe('C8H10');
  });

  it('flags groups it can\'t read', () => {
    const { doc, ids } = core();
    expect(substituted(doc, ids, { R1: 'Zork', R2: 'H' }).unknownLabels.length).toBeGreaterThan(0);
  });

  it('numbers the rows', () => {
    expect(rowNumbers(3, '2')).toEqual(['2a', '2b', '2c']);
    expect(rowNumbers(28, '5').slice(25)).toEqual(['5z', '5aa', '5ab']);
    expect(rowNumbers(2, '')).toEqual(['1', '2']);
  });

  it('reads typed or pasted rows', () => {
    const rows = parseRows('R1, R2\nMe, H\n#7, Ph\nOMe\tCF3\n\n', ['R1', 'R2']);
    expect(rows).toEqual([
      { number: undefined, values: ['Me', 'H'] },
      { number: '7', values: ['Ph', ''] },
      { number: undefined, values: ['OMe', 'CF3'] },
    ]);
  });

  it('builds the table cells, with ? where a mass couldn\'t be worked out', () => {
    const cells = rGroupCells(['R1'], [{ number: '2a', values: ['Me'] }, { number: '2b', values: ['Zork'] }],
      [{ formula: 'C7H8', mw: 92.1384, exact: 92.0626 }, null], { formula: true, mw: true, exact: false, extra: ['Yield (%)'] });
    expect(cells[0].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['Compound', 'R1', 'Formula', 'MW', 'Yield (%)']);
    expect(cells[1].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['2a', 'Me', 'C7H8', '92.14', '']);
    expect(cells[1][0].runs[0].bold).toBe(true);
    expect(cells[2][2].runs[0].text).toBe('?');
  });
});
