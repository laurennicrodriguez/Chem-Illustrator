// @vitest-environment jsdom
//
// Cross-mode review: Power Query refresh keeps columns added to its table by hand (a column of
// structures drawn from its SMILES); Slides' Undo/Redo name the step on the slide being edited;
// a Slide Master drawing style redraws the structures already on the slides, as one step.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { Deck, defaultMaster, slideDrawingStyle } from '../src/deck/deck';
import { Workbook } from '../src/sheet/workbook';
import type { Query, QTable } from '../src/sheet/query';
import { writeResult, addedColumns } from '../src/sheet/query-sheet';

const ethane = (): ReturnType<Doc['contents']> => {
  const d = new Doc();
  d.bulk(() => { const a = d.addAtom(0, 0), b = d.addAtom(20, 0); d.addBond(a.id, b.id); });
  return d.contents();
};

describe('refreshing a query table with columns added by hand', () => {
  const q: Query = { id: 1, name: 'Screen', source: { kind: 'text', file: 'screen.csv', delimiter: 'auto' }, steps: [], table: null };
  const t: QTable = { cols: ['Name', 'SMILES', 'Yield'], types: ['any', 'any', 'any'], rows: [['ethane', 'CC', 50], ['propane', 'CCC', 60]] };

  function loaded(): { wb: Workbook; s: Workbook['sheets'][0]; got: ReturnType<typeof writeResult>; query: Query } {
    const wb = new Workbook();
    const s = wb.sheets[0];
    const got = wb.edit('Load', () => writeResult(s, { row: 0, col: 0 }, t, null, q));
    const query = { ...q, table: got.table.name, loaded: got.cols };
    wb.edit('q', () => wb.setQueries([query]));
    // Structure from Name puts a column of structures right of SMILES, inside the table
    wb.edit('Structures from names', () => {
      s.insertCols(2, 1);
      s.setInput(0, 2, 'Structure');
      s.setStructure(1, 2, ethane());
    });
    return { wb, s, got, query };
  }

  it('keeps the structures beside the query column they followed', () => {
    const { wb, s, query } = loaded();
    const own = s.tables[0];
    expect(own.range.c2).toBe(3);
    expect(addedColumns(s, own, t, query).map((a) => a.col)).toEqual([2]);
    const again = wb.edit('Refresh', () => writeResult(s, { row: 0, col: 0 }, { ...t, rows: [['ethane', 'CC', 55], ['propane', 'CCC', 65]] }, own, query));
    expect(again.table.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 3 });
    expect(s.cell(1, 2)?.structure).toBeTruthy();
    expect(s.value(0, 2)).toBe('Structure');
    expect(s.value(1, 3)).toBe(55);
    expect(s.value(0, 3)).toBe('Yield');
  });

  it('moves them with their query column, and drops a column the query no longer loads', () => {
    const { wb, s, query } = loaded();
    const fewer: QTable = { cols: ['Yield', 'SMILES'], types: ['any', 'any'], rows: [[50, 'CC'], [60, 'CCC']] };
    const again = wb.edit('Refresh', () => writeResult(s, { row: 0, col: 0 }, fewer, s.tables[0], query));
    expect(again.table.range.c2).toBe(2);
    expect([0, 1, 2].map((c) => s.value(0, c))).toEqual(['Yield', 'SMILES', 'Structure']);
    expect(s.cell(1, 2)?.structure).toBeTruthy();
    expect(s.value(0, 3)).toBeNull();
  });

  it('keeps a structure column of a query from an older file (which does not know what it loaded)', () => {
    const { wb, s, query } = loaded();
    const again = wb.edit('Refresh', () => writeResult(s, { row: 0, col: 0 }, t, s.tables[0], { ...query, loaded: undefined }));
    expect(again.table.range.c2).toBe(3);
    expect(s.cell(1, 2)?.structure).toBeTruthy();
  });
});

describe('slides history and master', () => {
  function deck(): { host: Doc; d: Deck } {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    return { host, d };
  }

  it('names the step on the slide being edited', () => {
    const { host, d } = deck();
    host.edit('Paste', () => host.addAtom(100, 100));
    expect(d.undoLabel).toBe('Paste');
    d.undo();
    expect(d.redoLabel).toBe('Paste');
  });

  it('redraws structures on the slides at a new bond length, undone in one step', () => {
    const { host, d } = deck();
    const len = () => {
      const [a, b] = [...host.atoms.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const first = d.master.drawing.bondLength;
    host.edit('Draw', () => { const a = host.addAtom(400, 300), b = host.addAtom(400 + first, 300); host.addBond(a.id, b.id); });
    const m = { ...defaultMaster(), drawing: slideDrawingStyle(1.5) };
    expect(m.drawing.bondLength).not.toBeCloseTo(first);
    d.setMaster(m);
    expect(len()).toBeCloseTo(m.drawing.bondLength);
    expect(host.style.bondLength).toBeCloseTo(m.drawing.bondLength);
    expect(d.undoLabel).toBe('Change slide master');
    d.undo();
    expect(len()).toBeCloseTo(first);
    expect(host.style.bondLength).toBeCloseTo(first);
    expect(d.undoLabel).toBe('Draw');
  });
});
