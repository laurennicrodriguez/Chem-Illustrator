// @vitest-environment jsdom
//
// Document tables, Word's Table Design and Layout tabs: table styles (and their parts),
// cell borders and the Border Painter, cell margins, Convert Text to Table and back, Split
// Table, Merge Cells; the Navigation pane's headings and search; and all of it in Word files.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectOffsets, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { ACS_LINE, CELL_PAD, GRID_LINE, applyBorders, builtInStyle, cellMargins, paintEdge, resolveTable, TABLE_STYLES } from '../src/document/table-styles';
import { blockOf, canMergeBlock, mergeBlock, splitTable, tableToText, textToTable } from '../src/document/table-convert';
import { headingsOf, moveHeading, searchDocument, shownHeadings } from '../src/document/navigation';
import { isCovered, rowSpanOf, spanOf } from '../src/table';
import * as rt from '../src/richtext';
import type { BorderLine, TableData, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, size: number) => t.length * size * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });

const text = (s: string): TextRun[] => (s ? [{ text: s }] : []);
const table = (rows: string[][], patch: Partial<TableData> = {}): TableData => ({
  cols: rows[0].map(() => 80), rows: rows.map((r) => r.map((s) => ({ runs: text(s) }))), head: 1, lines: 'grid', ...patch,
});

/** A document of "Before", a table (object 1), and "After". */
function doc(t: TableData): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [{ ...n, text: 'Before\n' }, objectRun(1, n), { ...n, text: '\nAfter' }];
  const N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns(runs), paras: [N, { ...N, spaceBefore: 0, spaceAfter: 0, firstLine: 0 }, N], objects: { 1: { kind: 'table', table: t } } };
}

/** A document of plain paragraphs, the ones starting "# " as Heading 1 and "## " as Heading 2. */
function textDoc(lines: string[]): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const paras = lines.map((l) => paraFromStyle(l.startsWith('## ') ? d.styles.Heading2 : l.startsWith('# ') ? d.styles.Heading1 : d.styles.Normal, {}));
  return { ...d, runs: [{ ...n, text: lines.map((l) => l.replace(/^#+ /, '')).join('\n') }], paras };
}

const tableOf = (d: DocText, id = 1): TableData => {
  const o = d.objects[id];
  if (o?.kind !== 'table') throw new Error('no table');
  return o.table;
};
const firstTable = (d: DocText): TableData => {
  const o = Object.values(d.objects).find((x) => x.kind === 'table');
  if (o?.kind !== 'table') throw new Error('no table');
  return o.table;
};

describe('table styles', () => {
  it('draws a table with no style in its lines, as before: grid, ACS rules, or none', () => {
    const t = table([['a', 'b'], ['1', '2'], ['3', '4']]);
    const g = resolveTable(t);
    expect(g.h.flat().every((e) => e && e.w === GRID_LINE)).toBe(true);
    expect(g.v.flat().every((e) => e && e.w === GRID_LINE)).toBe(true);
    const a = resolveTable({ ...t, lines: 'acs' });
    expect(a.h[0].every((e) => e?.w === ACS_LINE)).toBe(true);
    expect(a.h[1].every((e) => e?.w === GRID_LINE)).toBe(true);
    expect(a.h[2].every((e) => e === null)).toBe(true);
    expect(a.h[3].every((e) => e?.w === ACS_LINE)).toBe(true);
    expect(a.v.flat().every((e) => e === null)).toBe(true);
    const n = resolveTable({ ...t, lines: 'none' });
    expect([...n.h.flat(), ...n.v.flat()].every((e) => e === null)).toBe(true);
  });

  it('shades the heading row and every other row, with the heading in white bold (Grid Table 4)', () => {
    const t = table([['h1', 'h2'], ['1', '2'], ['3', '4'], ['5', '6']], { style: 'GridTable4-Accent1' });
    const r = resolveTable(t);
    expect(r.fill[0][0]).toBe('#4472c4');
    expect(r.text[0][1]).toMatchObject({ bold: true, color: '#ffffff' });
    // banded rows: the first body row shaded, the next not
    expect(r.fill[1][1]).toBeDefined();
    expect(r.fill[2][1]).toBeUndefined();
    expect(r.fill[3][1]).toBe(r.fill[1][1]);
    // the first column is bold (Word's default options)
    expect(r.text[2][0]?.bold).toBe(true);
    expect(r.text[2][1]?.bold).toBeUndefined();
  });

  it('follows the style options: no banding, a total row, no first column', () => {
    const t = table([['h1', 'h2'], ['1', '2'], ['3', '4'], ['Total', '6']], { style: 'GridTable4-Accent1', look: { bandRows: false, total: true, firstCol: false } });
    const r = resolveTable(t);
    expect(r.fill[1][1]).toBeUndefined();
    expect(r.text[3][1]?.bold).toBe(true);
    expect(r.h[3][0]?.style).toBe('double');
    expect(r.text[2][0]?.bold).toBeUndefined();
  });

  it('has the gallery Word has: plain, grid and list tables in seven colours', () => {
    expect(TABLE_STYLES.filter((s) => s.group === 'Grid')).toHaveLength(42);
    expect(TABLE_STYLES.filter((s) => s.group === 'List')).toHaveLength(42);
    expect(builtInStyle('ListTable3-Accent2')?.name).toBe('List Table 3 Accent 2');
    expect(builtInStyle('GridTable1Light')?.name).toBe('Grid Table 1 Light');
    expect(new Set(TABLE_STYLES.map((s) => s.id)).size).toBe(TABLE_STYLES.length);
  });

  it('makes the style\'s text bold in the layout, unless the text says otherwise', () => {
    const t = table([['Entry', 'Yield'], ['1', '92']], { style: 'GridTable4-Accent1' });
    t.rows[0][1].runs = [{ text: 'Yield', bold: false }];
    const tb = layouter().layout(doc(t)).tables.get(1)!;
    const style = (r: number, c: number) => tb.cells[r][c]!.lines[0].pieces[0].style;
    expect(style(0, 0)).toContain('bold');
    expect(style(0, 1)).not.toContain('bold');
    expect(style(1, 1)).not.toContain('bold');
  });
});

describe('cell borders', () => {
  const pen: BorderLine = { style: 'double', w: 1.5, color: '#c00000' };

  it('puts a line round the outside of a block of cells, and the cells beside it share it', () => {
    const t = table([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']], { lines: 'none' });
    const out = applyBorders(t, { r0: 0, c0: 0, r1: 1, c1: 1 }, 'outside', pen);
    const r = resolveTable(out);
    expect(r.h[0][0]).toMatchObject({ style: 'double', color: '#c00000' });
    expect(r.h[2][1]).toMatchObject({ style: 'double' });
    expect(r.v[1][2]).toMatchObject({ style: 'double' });
    // inside the block and outside it: no lines
    expect(r.h[1][0]).toBeNull();
    expect(r.v[0][1]).toBeNull();
    expect(r.h[2][2]).toBeNull();
    // the cell to the right has the same line on its left
    expect(out.rows[0][2].borders?.left).toMatchObject(pen);
  });

  it('takes the style\'s lines away with No Border, and puts them back', () => {
    const t = table([['a', 'b'], ['c', 'd']]);
    const out = applyBorders(t, { r0: 0, c0: 0, r1: 0, c1: 0 }, 'none', pen);
    const r = resolveTable(out);
    expect(r.h[0][0]).toBeNull();
    expect(r.v[0][1]).toBeNull();
    expect(r.h[0][1]).not.toBeNull();
  });

  it('paints one edge (Border Painter), the cell across it agreeing', () => {
    const t = table([['a', 'b'], ['c', 'd']], { lines: 'none' });
    const out = paintEdge(t, 0, 0, 'bottom', pen);
    expect(out.rows[0][0].borders?.bottom).toMatchObject(pen);
    expect(out.rows[1][0].borders?.top).toMatchObject(pen);
    const r = resolveTable(out);
    expect(r.h[1][0]).toMatchObject({ style: 'double' });
    expect(r.h[1][1]).toBeNull();
  });

  it('draws inside lines only inside the block', () => {
    const t = table([['a', 'b', 'c'], ['d', 'e', 'f']], { lines: 'none' });
    const r = resolveTable(applyBorders(t, { r0: 0, c0: 0, r1: 1, c1: 2 }, 'insideV', pen));
    expect(r.v[0][1]).not.toBeNull();
    expect(r.v[1][2]).not.toBeNull();
    expect(r.v[0][0]).toBeNull();
    expect(r.h.flat().every((e) => e === null)).toBe(true);
  });
});

describe('cell margins', () => {
  it('lays a cell\'s text out inside the table\'s margins, or the cell\'s own', () => {
    const long = 'aaaa bbbb cccc dddd eeee ffff';
    const t = table([['x', long]], { cols: [60, 100] });
    const plain = layouter().layout(doc(t)).tables.get(1)!;
    const roomy = { ...t, rows: t.rows.map((r) => [...r]), pad: { top: 10, bottom: 10, left: 20, right: 20 } };
    const wide = layouter().layout(doc(roomy)).tables.get(1)!;
    for (const l of wide.cells[0][1]!.lines) expect(l.width).toBeLessThanOrEqual(100 - 40 + 1e-6);
    expect(wide.hs[0]).toBeGreaterThan(plain.hs[0]);
    expect(wide.pads[0][0].left).toBe(20);
    // a cell's own margin wins over the table's
    roomy.rows[0][0] = { runs: text('x'), pad: { left: 2 } };
    expect(cellMargins(roomy, 0, 0)).toEqual({ top: 10, bottom: 10, left: 2, right: 20 });
    expect(cellMargins(t, 0, 0)).toEqual({ top: CELL_PAD.y, bottom: CELL_PAD.y, left: CELL_PAD.x, right: CELL_PAD.x });
  });
});

describe('text to table and back', () => {
  it('cuts paragraphs at tabs into a table that takes their place', () => {
    const d = textDoc(['Intro', 'Entry\tYield', '1\t92', '2\t85', 'End']);
    const { t, id } = textToTable(d, 1, 3, { sep: 'tab', width: 400 });
    expect(rt.plainText(t.runs)).toBe('Intro\n￼\nEnd');
    const tab = tableOf(t, id);
    expect(tab.cols).toHaveLength(2);
    expect(tab.rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['Entry', 'Yield'], ['1', '92'], ['2', '85']]);
    expect(t.paras).toHaveLength(3);
  });

  it('puts each paragraph in a cell, so many to a row', () => {
    const d = textDoc(['a', 'b', 'c', 'd', 'e']);
    const tab = tableOf(textToTable(d, 0, 4, { sep: 'para', cols: 2, width: 300 }).t, 1);
    expect(tab.rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['a', 'b'], ['c', 'd'], ['e', '']]);
  });

  it('turns a table back into text, cells joined by the separator', () => {
    const d = doc(table([['Entry', 'Yield'], ['1', '92']]));
    const back = tableToText(d, 1, 'comma')!;
    expect(rt.plainText(back.t.runs)).toBe('Before\nEntry,Yield\n1,92\nAfter');
    expect(back.t.objects[1]).toBeUndefined();
    expect(back.t.paras).toHaveLength(4);
    expect(rt.plainText(back.t.runs).slice(back.start, back.end)).toBe('Entry,Yield\n1,92');
    // and back again
    const again = textToTable(back.t, 1, 2, { sep: 'comma', width: 300 });
    expect(tableOf(again.t, again.id).rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['Entry', 'Yield'], ['1', '92']]);
  });

  it('keeps the columns lined up where a cell is merged down', () => {
    const t = table([['a', 'b'], ['', 'c']]);
    t.rows[0][0].rowSpan = 2;
    expect(rt.plainText(tableToText(doc(t), 1, 'tab')!.t.runs)).toBe('Before\na\tb\n\tc\nAfter');
  });
});

describe('split table and merge cells', () => {
  it('splits a table above a row, with an empty paragraph between', () => {
    const d = doc(table([['h', 'h2'], ['1', '2'], ['3', '4']]));
    const got = splitTable(d, 1, 2)!;
    expect(rt.plainText(got.t.runs)).toBe('Before\n￼\n\n￼\nAfter');
    expect(tableOf(got.t, 1).rows).toHaveLength(2);
    expect(tableOf(got.t, got.id).rows.map((r) => rt.plainText(r[0].runs))).toEqual(['3']);
    expect(tableOf(got.t, got.id).head).toBe(0);
    expect(got.t.paras).toHaveLength(5);
    expect(objectOffsets(got.t.runs).get(got.id)).toBe(10);
    expect(splitTable(d, 1, 0)).toBeNull();
  });

  it('splits a cell merged down across the split', () => {
    const t = table([['a', 'b'], ['', 'c'], ['', 'd']]);
    t.rows[0][0] = { runs: text('a'), rowSpan: 3, fill: '#eeeeee' };
    const got = splitTable(doc(t), 1, 2)!;
    const top = tableOf(got.t, 1), bottom = tableOf(got.t, got.id);
    expect(rowSpanOf(top, 0, 0)).toBe(2);
    expect(rowSpanOf(bottom, 0, 0)).toBe(1);
    expect(bottom.rows[0][0].fill).toBe('#eeeeee');
    expect(isCovered(bottom, 0, 0)).toBe(false);
  });

  it('merges a block of cells into one, their text as paragraphs', () => {
    const t = table([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']]);
    const b = { r0: 0, c0: 0, r1: 1, c1: 1 };
    expect(canMergeBlock(t, b)).toBe(true);
    const m = mergeBlock(t, b);
    expect(spanOf(m, 0, 0)).toBe(2);
    expect(rowSpanOf(m, 0, 0)).toBe(2);
    expect(rt.plainText(m.rows[0][0].runs)).toBe('a\nb\nd\ne');
    expect(isCovered(m, 1, 1)).toBe(true);
    // a block cutting through the merged cell grows to take it in
    expect(blockOf(m, { r: 1, c: 1 }, { r: 2, c: 2 })).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 });
    expect(canMergeBlock(m, { r0: 1, c0: 1, r1: 2, c1: 2 })).toBe(false);
  });
});

describe('the Navigation pane', () => {
  const d = textDoc(['# Intro', 'text one', '## Detail', 'more', '# Results', 'yields', '# End', 'bye']);

  it('lists the headings by level', () => {
    expect(headingsOf(d).map((h) => [h.level, h.text, h.para])).toEqual([[1, 'Intro', 0], [2, 'Detail', 2], [1, 'Results', 4], [1, 'End', 6]]);
    const folded = shownHeadings(headingsOf(d), new Set([0]));
    expect(folded.map((h) => h.text)).toEqual(['Intro', 'Results', 'End']);
  });

  it('moves a heading with everything under it', () => {
    const r = moveHeading(d, 4, 0)!;
    expect(rt.plainText(r.t.runs)).toBe('Results\nyields\nIntro\ntext one\nDetail\nmore\nEnd\nbye');
    expect(r.para).toBe(0);
    expect(headingsOf(r.t).map((h) => h.text)).toEqual(['Results', 'Intro', 'Detail', 'End']);
    // to the end; the moved block brings its subheading
    const e = moveHeading(d, 0, 8)!;
    expect(rt.plainText(e.t.runs)).toBe('Results\nyields\nEnd\nbye\nIntro\ntext one\nDetail\nmore');
    expect(e.para).toBe(4);
    // not into itself
    expect(moveHeading(d, 0, 2)).toBeNull();
  });

  it('finds words in the text and in the tables, in order, with the words round them', () => {
    const t = doc(table([['Yield of ester', 'b'], ['1', 'ester 2']]));
    t.runs = rt.normalizeRuns([{ text: 'Before the ester\n' }, ...rt.sliceRuns(t.runs, 7, 8), { text: '\nAfter ester' }]);
    const hits = searchDocument(t, 'ester');
    expect(hits).toHaveLength(4);
    expect(hits[0].cell).toBeUndefined();
    expect(hits[1].cell).toEqual({ id: 1, r: 0, c: 0 });
    expect(hits[2].cell).toEqual({ id: 1, r: 1, c: 1 });
    expect(hits[3].cell).toBeUndefined();
    expect(hits[1]).toMatchObject({ before: 'Yield of ', match: 'ester', after: '' });
  });
});

// ---------------------------------------------------------------- Word files

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** (copied into this test's own kind of array: jsdom's isn't the one the zip library checks for) */
const u8 = (s: string) => new Uint8Array(strToU8(s));
function wordFile(body: string, styles: string): Uint8Array {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': u8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`),
    'word/document.xml': u8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    'word/styles.xml': u8(`<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles}</w:styles>`),
  }).map(([k, v]) => [k, new Uint8Array(v)])));
}
const row = (cells: string[], pr = '') => `<w:tr>${cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/>${pr}</w:tcPr><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;

describe('tables in Word files', () => {
  it('writes a style as Word\'s own, with its parts, and the table picks it with its options', async () => {
    const t = table([['Entry', 'Yield'], ['1', '92'], ['2', '85']], { style: 'GridTable4-Accent1', look: { bandRows: false } });
    const files = unzipSync(await writeDocx(doc(t), deps));
    const styles = strFromU8(files['word/styles.xml']);
    expect(styles).toContain('w:styleId="GridTable4-Accent1"');
    expect(styles).toContain('<w:tblStylePr w:type="firstRow">');
    expect(styles).toContain('w:fill="4472C4"');
    const body = strFromU8(files['word/document.xml']);
    expect(body).toContain('<w:tblStyle w:val="GridTable4-Accent1"/>');
    expect(body).toMatch(/<w:tblLook [^>]*w:noHBand="1"/);
    expect(body).not.toMatch(/<w:tbl>.*<w:tblBorders>/s);
    const back = firstTable((await readDocx(await writeDocx(doc(t), deps))).doc);
    expect(back.style).toBe('GridTable4-Accent1');
    expect(back.look).toMatchObject({ header: true, bandRows: false, firstCol: true });
  });

  it('keeps cell borders, the table\'s cell margins and a cell\'s own', async () => {
    const pen: BorderLine = { style: 'dashed', w: 1, color: '#2f5496' };
    let t = table([['a', 'b'], ['c', 'd']], { lines: 'acs', pad: { top: 4, bottom: 4, left: 9, right: 9 } });
    t = applyBorders(t, { r0: 1, c0: 1, r1: 1, c1: 1 }, 'outside', pen);
    t.rows[0][0].pad = { left: 1 };
    const body = strFromU8(unzipSync(await writeDocx(doc(t), deps))['word/document.xml']);
    expect(body).toContain('<w:right w:val="dashed" w:sz="8" w:space="0" w:color="2F5496"/>');
    expect(body).toContain('<w:tcMar><w:left w:w="20" w:type="dxa"/></w:tcMar>');
    const back = firstTable((await readDocx(await writeDocx(doc(t), deps))).doc);
    expect(back.lines).toBe('acs');
    expect(back.pad).toEqual({ top: 4, bottom: 4, left: 9, right: 9 });
    expect(back.rows[0][0].pad).toEqual({ left: 1 });
    const r = resolveTable(back);
    expect(r.v[1][1]).toMatchObject({ style: 'dashed', w: 1, color: '#2f5496' });
    expect(r.h[1][1]).toMatchObject({ style: 'dashed' });
    expect([back.head, back.rows[0][0].borders, r.h[1][0]]).toEqual([1, undefined, expect.objectContaining({ w: GRID_LINE })]);
    expect(r.v[0][1]).toBeNull();
  });

  it('reads a style made in Word: kept with the document and drawn as Word draws it', async () => {
    const style = `<w:style w:type="table" w:styleId="MyLabStyle"><w:name w:val="My Lab Style"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="12" w:color="00B050"/><w:bottom w:val="single" w:sz="12" w:color="00B050"/></w:tblBorders></w:tblPr>` +
      `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="00B050"/></w:tcPr></w:tblStylePr></w:style>`;
    const body = `<w:tbl><w:tblPr><w:tblStyle w:val="MyLabStyle"/><w:tblW w:w="3000" w:type="dxa"/><w:tblLook w:val="0420"/></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>${row(['Entry', 'Yield'])}${row(['1', '92'])}</w:tbl><w:p/>`;
    const { doc: d } = await readDocx(wordFile(body, style));
    const t = firstTable(d);
    expect(t.style).toBe('MyLabStyle');
    expect(d.tableStyles?.MyLabStyle?.name).toBe('My Lab Style');
    expect(t.look).toMatchObject({ header: true, firstCol: false, bandRows: true });
    const r = resolveTable(t, d.tableStyles);
    expect(r.fill[0][0]).toBe('#00b050');
    expect(r.text[0][0]).toMatchObject({ bold: true, color: '#ffffff' });
    expect(r.h[0][0]).toMatchObject({ w: 1.5, color: '#00b050' });
    expect(r.fill[1][0]).toBeUndefined();
    // and written back out as the same style
    const styles = strFromU8(unzipSync(await writeDocx(d, deps))['word/styles.xml']);
    expect(styles).toContain('w:styleId="MyLabStyle"');
    expect(styles).toContain('<w:name w:val="My Lab Style"/>');
  });

  it('keeps a Word table\'s own coloured lines, and its plain grid as a grid', async () => {
    const red = '<w:tcBorders><w:bottom w:val="double" w:sz="12" w:color="FF0000"/></w:tcBorders>';
    const body = `<w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid>${row(['a', 'b'], red)}${row(['c', 'd'])}</w:tbl><w:p/>`;
    const t = firstTable((await readDocx(wordFile(body, ''))).doc);
    expect(t.lines).toBe('grid');
    expect(t.style).toBeUndefined();
    // the cells under them agree; the other lines stay the grid's
    expect(t.rows[1][0].borders).toEqual({ top: expect.objectContaining({ style: 'double' }) });
    expect(t.rows[1][1].borders).toEqual({ top: expect.objectContaining({ style: 'double' }) });
    expect(t.rows[0][0].borders?.bottom).toMatchObject({ style: 'double', w: 1.5, color: '#ff0000' });
    expect(t.rows[0][0].borders?.top).toBeUndefined();
  });
});
