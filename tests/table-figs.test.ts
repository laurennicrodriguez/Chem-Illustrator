// @vitest-environment jsdom
//
// Structures dropped into the cells of a table in a drawing: the cell keeps room for them, they
// sit centred there, go with the table, and leave the cell when dragged out.

import { describe, expect, it } from 'vitest';
import { Doc, type Entity, type TableData } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { emptyTable, layoutTable } from '../src/table';
import { refitTableFigures } from '../src/editor/table-figs';
import { arialWidth } from '../src/text-metrics';

const layoutOf = (t: TableData) => layoutTable(t, 10, (s, size) => arialWidth(s, size));

/** An edit followed by the refit, as the editor runs it when each change finishes. */
function change(doc: Doc, f: () => void): void {
  doc.edit('change', () => {
    f();
    const before = new Map<string, Entity | null>((doc as unknown as { tx: { before: Map<string, Entity | null> } }).tx.before);
    refitTableFigures(doc, before, plainMeasure(doc), layoutOf);
  });
}

describe('structures in table cells', () => {
  it('keeps room for a structure dropped in a cell, centres it, and lets it go when dragged out', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const t = { ...emptyTable(2, 2, 10), align: ['center', 'center'] as ('center')[] };
    const lay = layoutOf(t);
    let tid = 0, a = 0, b = 0;
    doc.edit('build', () => {
      tid = doc.addShape({ kind: 'table', x1: 0, y1: 0, x2: lay.width, y2: lay.height, table: t }).id;
      a = doc.addAtom(300, 300, 6).id; b = doc.addAtom(300 + L, 300, 6).id;
      doc.addBond(a, b, 1);
    });
    // dropped so its middle is in the second row, second column
    const cell = { x: (lay.xs[1] + lay.xs[2]) / 2, y: (lay.ys[1] + lay.ys[2]) / 2 };
    change(doc, () => doc.moveAtoms(new Set([a, b]), cell.x - (300 + L / 2), cell.y - 300));
    const s = doc.shapes.get(tid)!;
    const fig = s.table!.rows[1][1].fig;
    expect(fig).toBeDefined();
    const fl = layoutOf(s.table!);
    const room = fl.figs[0].box;
    const mid = { x: (doc.atoms.get(a)!.x + doc.atoms.get(b)!.x) / 2, y: doc.atoms.get(a)!.y };
    expect(mid.x).toBeCloseTo(s.x1 + (room.x1 + room.x2) / 2, 1);
    expect(fl.height).toBeGreaterThanOrEqual(lay.height);

    // the table moved: the structure goes with it
    change(doc, () => doc.updateShape(tid, { x1: s.x1 + 50, x2: s.x2 + 50 }));
    expect((doc.atoms.get(a)!.x + doc.atoms.get(b)!.x) / 2).toBeCloseTo(mid.x + 50, 1);

    // dragged out: the room goes
    change(doc, () => doc.moveAtoms(new Set([a, b]), 0, 500));
    expect(doc.shapes.get(tid)!.table!.rows[1][1].fig).toBeUndefined();
  });
});
