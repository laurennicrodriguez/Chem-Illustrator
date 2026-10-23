// @vitest-environment jsdom
//
// Tables typed into in the text (as in Word): their rows laid out as lines of the page, the
// structures in their cells sized to the cell, numbers in cells counted in their place, and
// the tables going to and from Word files.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { cellHolding, fieldTexts, flatRuns, nestedTables, newDocument, objectRun, paraFromStyle, pruneObjects, runStyleOf, type DocObject, type DocText } from '../src/document/document';
import { CELL_PAD, DocLayouter, SINGLE_ROW } from '../src/document/doc-layout';
import { canMerge, coveringCell, deleteRow, emptyTable, insertRow, isCovered, mergeDown, mergeRight, nextCell, rowSpanOf, spanOf, splitCell } from '../src/table';
import * as rt from '../src/richtext';
import type { TableData, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, size: number) => t.length * size * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });
const EMPTY = { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] };

/** A document of "Before", a table (object 1), and "After", with more objects for the cells. */
function doc(table: TableData, objects: Record<number, DocObject> = {}): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [{ ...n, text: 'Before\n' }, objectRun(1, n), { ...n, text: '\nAfter' }];
  const N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns(runs), paras: [N, { ...N, spaceBefore: 0, spaceAfter: 0, firstLine: 0 }, N], objects: { 1: { kind: 'table', table }, ...objects } };
}

const text = (s: string): TextRun[] => (s ? [{ text: s }] : []);
const grid = (rows: string[][], cols: number[]): TableData => ({ cols, rows: rows.map((r) => r.map((s) => ({ runs: text(s) }))), head: 1, lines: 'grid' });

describe('laying out a table in the text', () => {
  it('makes a line of the page for each row, one character for the whole table', () => {
    const d = doc(grid([['Entry', 'Yield'], ['1', '92']], [100, 80]));
    const lay = layouter().layout(d);
    const rows = lay.text.lines.filter((l) => l.block === 1);
    expect(rows).toHaveLength(2);
    const N = d.styles.Normal;
    const h = SINGLE_ROW * N.size + 2 * CELL_PAD.y;
    expect(rows[0].above).toBeCloseTo(h);
    expect(rows[1].y - rows[0].y).toBeCloseTo(h);
    // the caret passes over the table as one character
    expect(rows[0].start).toBe(7);
    expect(rows[1].end).toBe(8);
    const tb = lay.tables.get(1)!;
    expect(tb.xs).toEqual([0, 100, 180]);
    expect(tb.rows.map((r) => r.page)).toEqual([0, 0]);
  });

  it('wraps a cell\'s text in its column, and the row grows to the tallest cell', () => {
    const long = 'aaaa bbbb cccc dddd eeee ffff';
    const lay = layouter().layout(doc(grid([['x', long]], [60, 60])));
    const tb = lay.tables.get(1)!;
    expect(tb.cells[0][1]!.lines.length).toBeGreaterThan(2);
    for (const l of tb.cells[0][1]!.lines) expect(l.width).toBeLessThanOrEqual(60 - 2 * CELL_PAD.x + 1e-6);
    expect(tb.hs[0]).toBeGreaterThan(tb.cells[0][0]!.box.y2 - tb.cells[0][0]!.box.y1 + 2 * CELL_PAD.y);
  });

  it('puts a short cell\'s text in the middle or at the bottom of a tall row', () => {
    const t = grid([['x', 'aaaa bbbb cccc dddd eeee ffff']], [60, 60]);
    t.rows[0][0].valign = 'center';
    const tb = layouter().layout(doc(t)).tables.get(1)!;
    const room = tb.hs[0] - 2 * CELL_PAD.y - (tb.cells[0][0]!.box.y2 - tb.cells[0][0]!.box.y1);
    expect(tb.drop[0][0]).toBeCloseTo(room / 2);
    t.rows[0][0].valign = 'bottom';
    expect(layouter().layout(doc(t)).tables.get(1)!.drop[0][0]).toBeCloseTo(room);
  });

  it('shrinks a structure in a cell to fit the cell, and places it inside the cell', () => {
    const n = runStyleOf(newDocument().styles.Normal);
    const t = grid([['Substrate', 'Yield'], ['', '92']], [150, 60]);
    t.rows[1][0] = { runs: [objectRun(2, n)] };
    const lay = layouter().layout(doc(t, { 2: { kind: 'drawing', contents: EMPTY } }));
    const fig = lay.objects.find((o) => o.id === 2)!;
    // 200 wide, held to the cell's width inside its margins
    expect(fig.w).toBeCloseTo(150 - 2 * CELL_PAD.x);
    expect(fig.h).toBeCloseTo(fig.w / 2);
    const tb = lay.tables.get(1)!;
    expect(fig.x).toBeGreaterThanOrEqual(tb.rows[1].x + CELL_PAD.x - 1e-6);
    expect(fig.y).toBeGreaterThanOrEqual(tb.rows[1].y);
    expect(fig.y + fig.h).toBeLessThanOrEqual(tb.rows[1].y + tb.hs[1] + 1e-6);
    expect(tb.hs[1]).toBeGreaterThan(fig.h);
  });

  it('carries rows on to the next page', () => {
    const rows = Array.from({ length: 80 }, (_, i) => [String(i + 1), 'row']);
    const lay = layouter().layout(doc(grid(rows, [60, 60])));
    const tb = lay.tables.get(1)!;
    expect(lay.pages.length).toBeGreaterThan(1);
    expect(tb.rows[0].page).toBe(0);
    expect(tb.rows[79].page).toBeGreaterThan(0);
    // rows only go forward, and each starts inside the page's text area
    for (let i = 1; i < 80; i++) expect(tb.rows[i].page).toBeGreaterThanOrEqual(tb.rows[i - 1].page);
  });
});

describe('objects in table cells', () => {
  const n = runStyleOf(newDocument().styles.Normal);
  const withNumbers = () => {
    const t = grid([['Compound'], ['']], [100]);
    t.rows[1][0] = { runs: [objectRun(3, n)] };
    const d = doc(t, { 3: { kind: 'seq', name: 'Compound' }, 4: { kind: 'seq', name: 'Compound' } });
    // a compound number after the table, in the text
    return { ...d, runs: rt.normalizeRuns([...d.runs, objectRun(4, n)]) };
  };

  it('numbers fields in cells in their place among the text\'s', () => {
    const d = withNumbers();
    expect(flatRuns(d).map((r) => r.obj).filter((x) => x !== undefined)).toEqual([1, 3, 4]);
    const shown = fieldTexts(d);
    expect(shown.get(3)).toBe('1');
    expect(shown.get(4)).toBe('2');
  });

  it('keeps objects in cells when unused objects are cleared away, and finds the cell holding one', () => {
    const d = withNumbers();
    const kept = pruneObjects({ ...d, objects: { ...d.objects, 9: { kind: 'seq', name: 'Compound' } } });
    expect(Object.keys(kept.objects).map(Number).sort()).toEqual([1, 3, 4]);
    expect(cellHolding(d, 3)).toEqual({ id: 1, r: 1, c: 0 });
    expect(cellHolding(d, 4)).toBeNull();
  });
});

describe('table editing', () => {
  it('merges a cell with the one to its right, joining their text', () => {
    const t = mergeRight(grid([['a', 'b', 'c']], [40, 40, 40]), 0, 0);
    expect(spanOf(t, 0, 0)).toBe(2);
    expect(rt.plainText(t.rows[0][0].runs)).toBe('a b');
    expect(t.rows[0][1].runs).toEqual([]);
    expect(mergeRight(t, 0, 0).rows[0][0].span).toBe(3);
  });

  it('starts a new table empty, with one heading row', () => {
    const t = emptyTable(3, 2, 11);
    expect(t.rows).toHaveLength(3);
    expect(t.head).toBe(1);
  });
});

describe('tables in Word files', () => {
  const body = async (d: DocText) => strFromU8(unzipSync(await writeDocx(d, deps))['word/document.xml']);

  it('writes a Word table: grid lines, shading, cell alignment, merged cells and heading rows', async () => {
    const t = grid([['Entry', 'Yield'], ['1', '92'], ['wide', '']], [100, 80]);
    t.rows[1][1].fill = '#ffd8a8';
    t.rows[1][1].valign = 'center';
    t.rows[2][0].span = 2;
    t.align = ['left', 'right'];
    const x = await body(doc(t));
    expect(x).toContain('<w:tblHeader/>');
    expect(x).toContain('<w:insideV w:val="single" w:sz="4"');
    expect(x).toContain('w:fill="FFD8A8"');
    expect(x).toContain('<w:vAlign w:val="center"/>');
    expect(x).toContain('<w:gridSpan w:val="2"/>');
    expect(x).toContain('<w:gridCol w:w="2000"/><w:gridCol w:w="1600"/>');
    expect(x).toMatch(/<w:jc w:val="right"\/><\/w:pPr><w:r>.*?92/);
  });

  it('writes the ACS rules: above, under the headings and at the bottom', async () => {
    const t = { ...grid([['Entry', 'Yield'], ['1', '92']], [100, 80]), lines: 'acs' as const };
    const x = await body(doc(t));
    expect(x).toContain('<w:top w:val="single" w:sz="6"');
    expect(x).toContain('<w:insideV w:val="nil"/>');
    expect(x).toContain('<w:tcBorders><w:bottom w:val="single" w:sz="4"');
  });

  it('opens what it saves: text, lines, shading, alignment, merged cells and structures in cells', async () => {
    const n = runStyleOf(newDocument().styles.Normal);
    const t = grid([['Substrate', 'Yield (%)'], ['', '92'], ['merged', '']], [150, 80]);
    t.rows[1][0] = { runs: [objectRun(2, n)] };
    t.rows[1][1].fill = '#ffd8a8';
    t.rows[1][1].valign = 'bottom';
    t.rows[2][0].span = 2;
    t.align = ['center', 'right'];
    const back = (await readDocx(await writeDocx(doc(t, { 2: { kind: 'drawing', contents: EMPTY } }), deps))).doc;
    const tab = Object.values(back.objects).find((o) => o.kind === 'table');
    expect(tab?.kind).toBe('table');
    if (tab?.kind !== 'table') return;
    const r = tab.table;
    expect(r.cols).toEqual([150, 80]);
    expect(r.lines).toBe('grid');
    expect(r.head).toBe(1);
    expect(r.align).toEqual(['center', 'right']);
    expect(rt.plainText(r.rows[0][1].runs)).toBe('Yield (%)');
    expect(r.rows[1][1]).toMatchObject({ fill: '#ffd8a8', valign: 'bottom' });
    expect(r.rows[2][0].span).toBe(2);
    // the structure in the cell came back as a structure there
    const inCell = r.rows[1][0].runs.find((x) => x.obj !== undefined)?.obj;
    expect(inCell).toBeDefined();
    expect(back.objects[inCell!].kind).toBe('drawing');
    // and the text round the table is as it was
    expect(rt.plainText(back.runs).replace(/￼/g, '#')).toBe('Before\n#\nAfter');
  });
});

describe('cells merged down a column', () => {
  const merged = (): TableData => {
    const t = grid([['Entry', 'Substrate', 'Yield'], ['1', 'aryl', '92'], ['2', '', '88']], [60, 80, 60]);
    t.rows[1][1] = { runs: text('aryl'), rowSpan: 2 };
    return t;
  };

  it('covers the cells under a merged cell, and merges and splits again', () => {
    const t = grid([['a', 'b'], ['c', 'd'], ['e', 'f']], [50, 50]);
    expect(canMerge(t, 0, 0, 'down')).toBe(true);
    const m = mergeDown(t, 0, 0);
    expect(rowSpanOf(m, 0, 0)).toBe(2);
    expect(isCovered(m, 1, 0)).toBe(true);
    expect(coveringCell(m, 1, 0)).toEqual({ r: 0, c: 0 });
    // the text of the cell below goes after the first's, as a new paragraph
    expect(rt.plainText(m.rows[0][0].runs)).toBe('a\nc');
    const m2 = mergeDown(m, 0, 0);
    expect(rowSpanOf(m2, 0, 0)).toBe(3);
    expect(nextCell(m2, 0, 1)).toEqual({ r: 1, c: 1 });
    const back = splitCell(m2, 0, 0);
    expect(isCovered(back, 1, 0)).toBe(false);
    expect(back.rows[0][0].rowSpan).toBeUndefined();
  });

  it('only merges cells that line up', () => {
    const t = mergeRight(grid([['a', 'b', 'c'], ['d', 'e', 'f']], [40, 40, 40]), 0, 0);
    // a two-column cell can't merge down into a one-column one
    expect(canMerge(t, 0, 0, 'down')).toBe(false);
    const m = mergeDown(grid([['a', 'b'], ['c', 'd']], [40, 40]), 0, 0);
    // nor a two-row cell right into a one-row one
    expect(canMerge(m, 0, 0, 'right')).toBe(false);
    expect(mergeRight(m, 0, 0)).toBe(m);
  });

  it('grows and shrinks with rows put in or taken out of it', () => {
    const t = merged();
    const more = insertRow(t, 2);
    expect(rowSpanOf(more, 1, 1)).toBe(3);
    expect(isCovered(more, 2, 1)).toBe(true);
    const less = deleteRow(t, 2);
    expect(rowSpanOf(less, 1, 1)).toBe(1);
    // deleting the merged cell's first row moves it (and its text) down a row
    const moved = deleteRow(t, 1);
    expect(rt.plainText(moved.rows[1][1].runs)).toBe('aryl');
    expect(rowSpanOf(moved, 1, 1)).toBe(1);
  });

  it('lays out a merged cell over its rows, and the last row grows when it needs more room', () => {
    const t = merged();
    let tb = layouter().layout(doc(t)).tables.get(1)!;
    expect(tb.cells[2][1]).toBeNull();
    const one = tb.hs[1];
    expect(tb.hs[2]).toBeCloseTo(one);
    // a merged cell with four lines of text: its two rows make room for it
    t.rows[1][1] = { runs: text('a\nb\nc\nd'), rowSpan: 2, valign: 'bottom' };
    tb = layouter().layout(doc(t)).tables.get(1)!;
    const need = tb.cells[1][1]!.box.y2 - tb.cells[1][1]!.box.y1 + 2 * CELL_PAD.y;
    expect(tb.hs[1] + tb.hs[2]).toBeCloseTo(need);
    expect(tb.hs[1]).toBeCloseTo(one);
  });

  it('saves merged cells as Word\'s vMerge, and opens them again', async () => {
    const t = merged();
    t.rows[1][1].fill = '#ffd8a8';
    const x = strFromU8(unzipSync(await writeDocx(doc(t), deps))['word/document.xml']);
    expect(x).toContain('<w:vMerge w:val="restart"/>');
    expect(x).toMatch(/<w:vMerge\/>.*?<\/w:tcPr><w:p\/><\/w:tc>/);
    const back = (await readDocx(await writeDocx(doc(t), deps))).doc;
    const tab = Object.values(back.objects).find((o) => o.kind === 'table');
    if (tab?.kind !== 'table') throw new Error('no table');
    expect(tab.table.rows[1][1]).toMatchObject({ rowSpan: 2, fill: '#ffd8a8' });
    expect(rt.plainText(tab.table.rows[1][1].runs)).toBe('aryl');
    expect(isCovered(tab.table, 2, 1)).toBe(true);
    expect(rt.plainText(tab.table.rows[2][2].runs)).toBe('88');
  });

  it('reads a merge down a column of cells that span columns, and ends it at a cell that is not merged', async () => {
    const t = grid([['a', 'b', 'c'], ['', '', 'd'], ['e', 'f', 'g']], [40, 40, 40]);
    t.rows[0][0] = { runs: text('a'), span: 2, rowSpan: 2 };
    const back = (await readDocx(await writeDocx(doc(t), deps))).doc;
    const tab = Object.values(back.objects).find((o) => o.kind === 'table');
    if (tab?.kind !== 'table') throw new Error('no table');
    expect(spanOf(tab.table, 0, 0)).toBe(2);
    expect(rowSpanOf(tab.table, 0, 0)).toBe(2);
    expect(isCovered(tab.table, 1, 1)).toBe(true);
    expect(isCovered(tab.table, 2, 0)).toBe(false);
    expect(rt.plainText(tab.table.rows[2][0].runs)).toBe('e');
  });
});

describe('tables in table cells', () => {
  /** A 2 × 2 table (object 1) whose second cell holds a 2 × 2 table (object 2). */
  const nestedDoc = (): DocText => {
    const n = runStyleOf(newDocument().styles.Normal);
    const outer = grid([['Conditions', ''], ['x', 'y']], [100, 160]);
    outer.rows[0][1] = { runs: [{ ...n, text: 'Solvents\n' }, objectRun(2, n)] };
    const inner = grid([['THF', '92'], ['DMF', '71']], [60, 40]);
    return doc(outer, { 2: { kind: 'table', table: inner } });
  };

  it('lays out the inner table in its cell, its rows placed inside the cell', () => {
    const d = nestedDoc();
    const lay = layouter().layout(d);
    const outer = lay.tables.get(1)!, inner = lay.tables.get(2)!;
    expect(outer.depth).toBe(0);
    expect(inner.depth).toBe(1);
    expect(nestedTables(d)).toEqual([{ id: 2, depth: 1, parent: 1 }]);
    // the cell holding it is tall enough for its text and the inner table
    const innerH = inner.hs.reduce((a, b) => a + b, 0);
    expect(outer.hs[0]).toBeGreaterThan(innerH);
    expect(inner.rows).toHaveLength(2);
    const cellX = outer.rows[0].x + outer.xs[1];
    expect(inner.rows[0].x).toBeGreaterThanOrEqual(cellX);
    expect(inner.rows[0].y).toBeGreaterThan(outer.rows[0].y);
    expect(inner.rows[1].y - inner.rows[0].y).toBeCloseTo(inner.hs[0]);
    expect(inner.rows[1].y + inner.hs[1]).toBeLessThanOrEqual(outer.rows[0].y + outer.hs[0] + 1e-6);
    // the inner table's cells count in their place, and are kept when unused objects are cleared
    expect(flatRuns(d).map((r) => r.text).join('')).toContain('THF92DMF71');
    expect(Object.keys(pruneObjects(d).objects)).toEqual(['1', '2']);
    expect(cellHolding(d, 2)).toEqual({ id: 1, r: 0, c: 1 });
  });

  it('saves a table in a cell as Word\'s table in the cell, and opens it as one again', async () => {
    const x = strFromU8(unzipSync(await writeDocx(nestedDoc(), deps))['word/document.xml']);
    // a table inside a cell, the cell ending with a paragraph after it
    expect(x).toMatch(/<w:tc><w:tcPr>[^]*?<w:tbl>[^]*?<\/w:tbl><w:p\/><\/w:tc>/);
    const back = (await readDocx(await writeDocx(nestedDoc(), deps))).doc;
    const tabs = Object.entries(back.objects).filter(([, o]) => o.kind === 'table');
    expect(tabs).toHaveLength(2);
    const outer = tabs.map(([, o]) => o).find((o) => o.kind === 'table' && o.table.cols.length === 2 && o.table.cols[1] === 160);
    if (outer?.kind !== 'table') throw new Error('no outer table');
    const runs = outer.table.rows[0][1].runs;
    expect(rt.plainText(runs).replace(/￼/g, '#')).toBe('Solvents\n#');
    const inner = back.objects[runs.find((r) => r.obj !== undefined)!.obj!];
    if (inner?.kind !== 'table') throw new Error('no inner table');
    expect(inner.table.cols).toEqual([60, 40]);
    expect(rt.plainText(inner.table.rows[1][0].runs)).toBe('DMF');
    // the text round the outer table is as it was
    expect(rt.plainText(back.runs).replace(/￼/g, '#')).toBe('Before\n#\nAfter');
  });
});
