// Tables: layout, the ACS rules, joined cells, and changing rows and columns.

import { describe, it, expect } from 'vitest';
import type { TableData, TextRun } from '../src/model';
import {
  layoutTable, tableRules, spanOf, isCovered, coveringCell, cellAlign, partAt, cellRect, setPart, insertRow, deleteRow,
  insertColumn, deleteColumn, setSpan, setColumnWidth, setColumnAlign, nextCell, emptyTable, tableFromText, fitColumns,
  tableText, NOTE_SCALE,
} from '../src/table';

// every character half the text size wide, so widths are easy to work out
const measure = (t: string, size: number) => t.length * size * 0.5;
const R = (text: string): { runs: TextRun[] } => ({ runs: text ? [{ text }] : [] });

/** entry | conditions (over two columns) | yield, then a row of subheadings and two rows of results. */
function sample(): TableData {
  return {
    cols: [30, 60, 50, 40],
    rows: [
      [R('entry'), { runs: [{ text: 'conditions' }], span: 2 }, R(''), R('yield')],
      [R(''), R('catalyst'), R('solvent'), R('')],
      [R('1'), R('Pd'), R('THF'), R('45')],
      [R('2'), R('Ni'), R('DMF'), R('78')],
    ],
    head: 2,
    lines: 'acs',
  };
}

describe('joined cells', () => {
  it('a cell spans the columns to its right, which it covers', () => {
    const t = sample();
    expect(spanOf(t, 0, 1)).toBe(2);
    expect(isCovered(t, 0, 2)).toBe(true);
    expect(spanOf(t, 0, 2)).toBe(1);
    expect(coveringCell(t, 0, 2)).toEqual({ r: 0, c: 1 });
    expect(isCovered(t, 1, 2)).toBe(false);
  });

  it('a span never runs past the last column', () => {
    const t = setSpan(sample(), 2, 2, 9);
    expect(spanOf(t, 2, 2)).toBe(2);
    expect(t.rows[2][2].span).toBe(2);
    // a span of 1 is the same as none
    expect(setSpan(t, 2, 2, 1).rows[2][2].span).toBeUndefined();
  });
});

describe('layout', () => {
  it('stacks the title, the rows and the footnotes, with columns side by side', () => {
    const t = { ...sample(), title: [{ text: 'Table 1' }], notes: [{ text: 'a Isolated' }] };
    const lay = layoutTable(t, 10, measure);
    expect(lay.xs).toEqual([0, 30, 90, 140, 180]);
    expect(lay.width).toBe(180);
    expect(lay.size).toBe(10);
    expect(lay.padX).toBeCloseTo(4);
    expect(lay.padY).toBeCloseTo(2.5);
    // the title comes first and the first row starts below it
    expect(lay.title).not.toBeNull();
    expect(lay.ys[0]).toBeGreaterThan(0);
    // one row of text is a line high plus the room above and below
    expect(lay.ys[2] - lay.ys[1]).toBeGreaterThanOrEqual(10.5 + 5 - 1e-9);
    expect(lay.ys).toHaveLength(5);
    // footnotes are set smaller, under the last row
    expect(lay.notes!.y).toBeGreaterThan(lay.ys[4]);
    expect(lay.height).toBeGreaterThan(lay.notes!.y);
    expect(NOTE_SCALE).toBeLessThan(1);
  });

  it('places text inside its cell, and a joined cell over all its columns', () => {
    const lay = layoutTable(sample(), 10, measure);
    expect(lay.cells[0][1]!.x).toBeCloseTo(30 + 4);
    expect(lay.cells[0][2]).toBeNull();
    expect(cellRect(sample(), lay, 0, 1)).toEqual({ x1: 30, y1: lay.ys[0], x2: 140, y2: lay.ys[1] });
  });

  it('wraps a long cell to its column, making the row taller', () => {
    const t = sample();
    const one = layoutTable(t, 10, measure);
    const long = setPart(t, { r: 2, c: 1 }, { runs: [{ text: 'tetrakis triphenylphosphine palladium' }] });
    const two = layoutTable(long, 10, measure);
    expect(two.ys[3] - two.ys[2]).toBeGreaterThan(one.ys[3] - one.ys[2]);
  });

  it('uses the table\'s own text size when it has one', () => {
    expect(layoutTable({ ...sample(), size: 8 }, 10, measure).size).toBe(8);
  });

  it('lines up the first column on the left and the rest in the middle, unless set', () => {
    const t = sample();
    expect(cellAlign(t, 2, 0)).toBe('left');
    expect(cellAlign(t, 2, 1)).toBe('center');
    const right = setColumnAlign(t, 1, 'right');
    expect(cellAlign(right, 2, 1)).toBe('right');
    expect(cellAlign({ ...t, rows: t.rows.map((row, r) => r === 2 ? row.map((c, k) => k === 3 ? { ...c, align: 'right' as const } : c) : row) }, 2, 3)).toBe('right');
  });
});

describe('rules', () => {
  const horizontal = (t: TableData) => {
    const lay = layoutTable(t, 10, measure);
    return { lay, rules: tableRules(t, lay) };
  };

  it('ACS style: rules above and below the headings, under the last row, and under a joined heading', () => {
    const { lay, rules } = horizontal(sample());
    const full = rules.filter((l) => l.x1 === 0 && l.x2 === 180 && l.y1 === l.y2).map((l) => l.y1);
    expect(full).toEqual([lay.ys[0], lay.ys[2], lay.ys[4]]);
    // the straddle rule under "conditions" runs over its two columns, a little in from each side
    const straddle = rules.filter((l) => !(l.x1 === 0 && l.x2 === 180));
    expect(straddle).toEqual([{ x1: 34, y1: lay.ys[1], x2: 136, y2: lay.ys[1] }]);
    expect(rules.every((l) => l.y1 === l.y2)).toBe(true);
  });

  it('a grid boxes every cell, with no line through a joined cell', () => {
    const t = { ...sample(), lines: 'grid' as const };
    const { lay, rules } = horizontal(t);
    const vertical = rules.filter((l) => l.x1 === l.x2);
    // 4 rows × 5 lines, less the one inside "conditions"
    expect(vertical).toHaveLength(19);
    expect(vertical.some((l) => l.x1 === 90 && l.y1 === lay.ys[0])).toBe(false);
    expect(rules.filter((l) => l.y1 === l.y2)).toHaveLength(5);
  });

  it('no lines when none are wanted', () => {
    expect(horizontal({ ...sample(), lines: 'none' }).rules).toEqual([]);
  });
});

describe('finding the part under a point', () => {
  it('finds cells, a joined cell, the title and the footnotes', () => {
    const t = { ...sample(), title: [{ text: 'Table 1' }], notes: [{ text: 'a Isolated' }] };
    const lay = layoutTable(t, 10, measure);
    expect(partAt(t, lay, { x: 5, y: lay.ys[0] - 1 })).toBe('title');
    expect(partAt(t, lay, { x: 100, y: lay.ys[0] + 1 })).toEqual({ r: 0, c: 1 });
    expect(partAt(t, lay, { x: 150, y: lay.ys[3] + 1 })).toEqual({ r: 3, c: 3 });
    expect(partAt(t, lay, { x: 5, y: lay.height - 1 })).toBe('notes');
    expect(partAt(t, lay, { x: -1, y: 5 })).toBeNull();
  });
});

describe('changing tables', () => {
  it('sets the text of a cell, the title and the footnotes', () => {
    let t = setPart(sample(), { r: 2, c: 1 }, { runs: [{ text: 'Pd(OAc)' }, { text: '2', sub: true }, { text: '' }] });
    expect(t.rows[2][1].runs).toEqual([{ text: 'Pd(OAc)' }, { text: '2', sub: true }]);
    t = setPart(t, 'title', { runs: [{ text: 'Table 2' }] });
    expect(t.title).toEqual([{ text: 'Table 2' }]);
    t = setPart(t, 'title', { runs: [] });
    expect(t.title).toBeUndefined();
  });

  it('a row put in among the headings is a heading', () => {
    expect(insertRow(sample(), 1).head).toBe(3);
    expect(insertRow(sample(), 3).head).toBe(2);
    const t = insertRow(sample(), 4);
    expect(t.rows).toHaveLength(5);
    expect(t.rows[4].every((c) => c.runs.length === 0)).toBe(true);
  });

  it('deleting a heading row leaves one heading row fewer; the last row stays', () => {
    expect(deleteRow(sample(), 0).head).toBe(1);
    expect(deleteRow(sample(), 3).head).toBe(2);
    const one = { ...sample(), rows: [sample().rows[0]] };
    expect(deleteRow(one, 0)).toBe(one);
  });

  it('a column put inside a joined cell widens it', () => {
    const t = insertColumn(sample(), 2);
    expect(t.cols).toEqual([30, 60, 50, 50, 40]);
    expect(t.rows[0][1].span).toBe(3);
    expect(t.rows[2][2].runs).toEqual([]);
    expect(t.rows[2][3].runs[0].text).toBe('THF');
  });

  it('deleting a column a cell spans narrows it; deleting the joined cell passes its text on', () => {
    const a = deleteColumn(sample(), 2);
    expect(a.cols).toEqual([30, 60, 40]);
    expect(a.rows[0][1].span).toBeUndefined();
    expect(a.rows[0][1].runs[0].text).toBe('conditions');
    const b = deleteColumn(sample(), 1);
    expect(b.rows[0][1].runs[0].text).toBe('conditions');
    expect(b.rows[0][1].span).toBeUndefined();
    expect(b.rows[2].map((c) => c.runs[0]?.text)).toEqual(['1', 'THF', '45']);
  });

  it('column widths have a floor', () => {
    expect(setColumnWidth(sample(), 0, 1).cols[0]).toBe(4);
    expect(setColumnWidth(sample(), 0, 72).cols[0]).toBe(72);
  });

  it('Tab goes cell by cell, row by row, past covered cells', () => {
    const t = sample();
    expect(nextCell(t, 0, 0)).toEqual({ r: 0, c: 1 });
    expect(nextCell(t, 0, 1)).toEqual({ r: 0, c: 3 });
    expect(nextCell(t, 0, 3)).toEqual({ r: 1, c: 0 });
    expect(nextCell(t, 0, 3, true)).toEqual({ r: 0, c: 1 });
    expect(nextCell(t, 3, 3)).toBeNull();
    expect(nextCell(t, 0, 0, true)).toBeNull();
  });
});

describe('making tables', () => {
  it('an empty table has one heading row and the ACS style', () => {
    const t = emptyTable(4, 3, 10);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toHaveLength(3);
    expect(t.cols).toEqual([60, 60, 60]);
    expect(t.head).toBe(1);
    expect(t.lines).toBe('acs');
    expect(emptyTable(1, 2, 10).head).toBe(0);
  });

  it('columns fit their longest text, plus the room either side', () => {
    const t = tableFromText([['a', 'longer text'], ['bb', 'x']], measure, 10);
    expect(t.cols[0]).toBe(Math.ceil(20 + 8));
    expect(t.cols[1]).toBe(Math.ceil(55 + 8));
    expect(tableText(t)).toEqual([['a', 'longer text'], ['bb', 'x']]);
    // very long text is held to a sensible width
    const wide = fitColumns({ ...t, rows: [[R('a'.repeat(400)), R('')]] }, measure, 10);
    expect(wide.cols[0]).toBe(400 + 8);
  });
});
