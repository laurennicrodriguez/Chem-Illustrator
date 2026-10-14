// @vitest-environment jsdom
//
// Tables typed into in the text (as in Word): their rows laid out as lines of the page, the
// structures in their cells sized to the cell, numbers in cells counted in their place, and
// the tables going to and from Word files.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { cellHolding, fieldTexts, flatRuns, newDocument, objectRun, paraFromStyle, pruneObjects, runStyleOf, type DocObject, type DocText } from '../src/document/document';
import { CELL_PAD, DocLayouter, SINGLE_ROW } from '../src/document/doc-layout';
import { emptyTable, mergeRight, spanOf } from '../src/table';
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
