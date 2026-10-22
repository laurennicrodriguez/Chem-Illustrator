// What-If Analysis (trying values, Goal Seek, data tables) and PivotTables.

import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { keyOf } from '../src/sheet/refs';
import { goalSeek, newDataTableId } from '../src/sheet/what-if';
import { layoutPivot, sourceOf, newPivotId, type PivotTable } from '../src/sheet/pivot';
import { writePivot, removePivot, pivotAt } from '../src/sheet/pivot-sheet';

function book(cells: Record<string, string>) {
  const wb = new Workbook();
  const s = wb.sheets[0];
  wb.edit('set', () => {
    for (const [ref, v] of Object.entries(cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
      const col = m[1].charCodeAt(0) - 65;
      s.setInput(Number(m[2]) - 1, col, v);
    }
  });
  return { wb, s };
}

describe('What-If Analysis', () => {
  it('tries values and puts everything back', () => {
    const { wb, s } = book({ A1: '2', B1: '=A1*10', C1: '=B1+1', D1: '=SUM(C1:C1)' });
    expect(s.value(0, 3)).toBe(21);
    const got = wb.whatIf([{ s, key: keyOf(0, 0), value: 5 }], () => [s.value(0, 1), s.value(0, 3)]);
    expect(got).toEqual([50, 51]);
    expect(s.value(0, 0)).toBe(2);
    expect(s.value(0, 1)).toBe(20);
    expect(s.value(0, 3)).toBe(21);
    expect(wb.canUndo()).toBe(true);
    wb.undo();
    expect(wb.canUndo()).toBe(false);
  });

  it('Goal Seek finds the input', () => {
    // moles needed for 5.00 g of a compound of molar mass 180.16
    const r = goalSeek((x) => x * 180.16, 5, 1);
    expect(r.found).toBe(true);
    expect(r.x * 180.16).toBeCloseTo(5, 3);
    const sq = goalSeek((x) => x * x - 2, 0, 1, 1e-9);
    expect(sq.x).toBeCloseTo(Math.SQRT2, 8);
    const none = goalSeek((x) => x * x + 1, 0, 3);
    expect(none.found).toBe(false);
  });

  it('a one-input data table down a column', () => {
    // B1 is the input (equivalents); the formula in C3 reads it; values tried in B4:B6
    const { wb, s } = book({ B1: '1', B3: '', C3: '=B1*2+1', B4: '1', B5: '2', B6: '3' });
    wb.edit('table', () => s.setDataTables([{ id: newDataTableId(), ref: { r1: 3, c1: 2, r2: 5, c2: 2 }, colInput: '=$B$1' }]));
    expect([s.value(3, 2), s.value(4, 2), s.value(5, 2)]).toEqual([3, 5, 7]);
    expect(s.value(2, 2)).toBe(3);
    // the table follows the formula
    wb.edit('change', () => s.setInput(2, 2, '=B1*10'));
    expect([s.value(3, 2), s.value(4, 2), s.value(5, 2)]).toEqual([10, 20, 30]);
    // and a formula reading its results is worked out after it
    wb.edit('sum', () => s.setInput(8, 2, '=SUM(C4:C6)'));
    expect(s.value(8, 2)).toBe(60);
  });

  it('a two-input data table', () => {
    const { wb, s } = book({ A1: '1', B1: '1', A3: '=A1*B1', B3: '2', C3: '3', A4: '10', A5: '20' });
    wb.edit('table', () => s.setDataTables([{ id: newDataTableId(), ref: { r1: 3, c1: 1, r2: 4, c2: 2 }, rowInput: '=$A$1', colInput: '=$B$1' }]));
    expect([[s.value(3, 1), s.value(3, 2)], [s.value(4, 1), s.value(4, 2)]]).toEqual([[20, 30], [40, 60]]);
    wb.edit('insert', () => s.insertRows(0, 1));
    expect(s.dataTables[0].ref).toEqual({ r1: 4, c1: 1, r2: 5, c2: 2 });
    expect(s.dataTables[0].rowInput).toBe('=$A$2');
    expect(s.value(5, 2)).toBe(60);
  });
});

const RUNS: (string | number | null)[][] = [
  ['Catalyst', 'Solvent', 'Yield', 'ee'],
  ['Pd', 'THF', 80, 90],
  ['Pd', 'DMF', 70, 85],
  ['Ni', 'THF', 60, 70],
  ['Ni', 'THF', 64, 72],
  ['Cu', 'DMF', 50, null],
];

const pivot = (over: Partial<PivotTable>): PivotTable => ({
  id: newPivotId(), name: 'PivotTable1', source: '=Sheet1!$A$1:$D$6', at: { row: 0, col: 6 },
  rows: [], cols: [], values: [], filters: [], hidden: {}, layout: 'compact', subtotals: true, grandRows: true, grandCols: true, ...over,
});

describe('PivotTables', () => {
  const src = sourceOf(RUNS);
  if (typeof src === 'string') throw new Error(src);

  it('sums by rows, with a grand total', () => {
    const rep = layoutPivot(pivot({ rows: ['Catalyst'], values: [{ field: 'Yield', fn: 'sum' }] }), src);
    if (typeof rep === 'string') throw new Error(rep);
    expect(rep.cells).toEqual([['Row Labels', 'Sum of Yield'], ['Cu', 50], ['Ni', 124], ['Pd', 150], ['Grand Total', 324]]);
  });

  it('rows and columns, averages, and hidden items', () => {
    const rep = layoutPivot(pivot({ rows: ['Catalyst'], cols: ['Solvent'], values: [{ field: 'Yield', fn: 'average' }], hidden: { Catalyst: ['Cu'] } }), src);
    if (typeof rep === 'string') throw new Error(rep);
    expect(rep.cells).toEqual([
      ['Average of Yield', 'Column Labels', null, null],
      ['Row Labels', 'DMF', 'THF', 'Grand Total'],
      ['Ni', null, 62, 62],
      ['Pd', 70, 80, 75],
      ['Grand Total', 70, 68, 68.5],
    ]);
  });

  it('two value fields across, counts, and shares of the total', () => {
    const rep = layoutPivot(pivot({ rows: ['Solvent'], values: [{ field: 'Yield', fn: 'count' }, { field: 'Yield', fn: 'sum', showAs: 'percentOfTotal', name: 'Share' }] }), src);
    if (typeof rep === 'string') throw new Error(rep);
    expect(rep.cells[0]).toEqual(['Row Labels', 'Count of Yield', 'Share']);
    expect(rep.cells[1][1]).toBe(2);
    expect(rep.cells[1][2]).toBeCloseTo(120 / 324, 12);
    expect(rep.cells[3]).toEqual(['Grand Total', 5, 1]);
  });

  it('nested rows: compact with subtotals on the group line, tabular with them below', () => {
    const pt = pivot({ rows: ['Catalyst', 'Solvent'], values: [{ field: 'Yield', fn: 'sum' }] });
    const c = layoutPivot(pt, src);
    if (typeof c === 'string') throw new Error(c);
    expect(c.cells.map((r) => r[0])).toEqual(['Row Labels', 'Cu', 'DMF', 'Ni', 'THF', 'Pd', 'DMF', 'THF', 'Grand Total']);
    expect(c.cells[3][1]).toBe(124);
    const t = layoutPivot({ ...pt, layout: 'tabular' }, src);
    if (typeof t === 'string') throw new Error(t);
    expect(t.cells.slice(0, 4)).toEqual([['Catalyst', 'Solvent', 'Sum of Yield'], ['Cu', 'DMF', 50], ['Cu Total', null, 50], ['Ni', 'THF', 124]]);
  });

  it('filters sit on top and leave records out', () => {
    const rep = layoutPivot(pivot({ rows: ['Catalyst'], filters: ['Solvent'], hidden: { Solvent: ['DMF'] }, values: [{ field: 'ee', fn: 'max' }] }), src);
    if (typeof rep === 'string') throw new Error(rep);
    expect(rep.cells[0]).toEqual(['Solvent', 'THF']);
    expect(rep.cells[2]).toEqual(['Row Labels', 'Max of ee']);
    expect(rep.cells.slice(3).map((r) => r.slice(0, 2))).toEqual([['Ni', 72], ['Pd', 90], ['Grand Total', 90]]);
  });

  it('is written into the sheet, refreshed, and taken away', () => {
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.edit('data', () => RUNS.forEach((row, r) => row.forEach((v, c) => { if (v !== null) s.setInput(r, c, String(v)); })));
    const pt = pivot({ rows: ['Catalyst'], values: [{ field: 'Yield', fn: 'sum' }] });
    let kept: PivotTable | string = '';
    wb.edit('pivot', () => { kept = writePivot(s, pt); });
    expect(typeof kept).toBe('object');
    expect(s.value(3, 7)).toBe(150);
    expect(s.cell(1, 6)?.style?.align).toBe('left');
    expect(pivotAt(s, 2, 6)?.id).toBe(pt.id);
    // the data changes; a refresh picks it up
    wb.edit('more', () => s.setInput(1, 2, '90'));
    expect(s.value(3, 7)).toBe(150);
    wb.edit('refresh', () => writePivot(s, s.pivots[0]));
    expect(s.value(3, 7)).toBe(160);
    wb.edit('remove', () => removePivot(s, s.pivots[0]));
    expect(s.value(3, 7)).toBe(null);
    expect(s.pivots).toEqual([]);
    wb.undo();
    expect(s.value(3, 7)).toBe(160);
  });
});
