// @vitest-environment jsdom
//
// Tables in files and on the clipboard: saved as ChemDraw tables (CDXML and CDX) with their
// rules, joined cells, title and footnotes; read back, including after ChemDraw re-saves them;
// and pasted from Excel or Word as HTML or tab-separated text.

import { describe, it, expect } from 'vitest';
import { Doc, type TableData, type TextRun } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { tableBorders, linesFromBorders, applyTableTag, gridOf, parseTableTag, TABLE_PART_TAG, type ReadCell } from '../src/io/cdxml-table';
import { parseHtmlTable, parseTextTable, pastedTable, tableHtml, tableTsv } from '../src/io/table-clip';
import { layoutTable } from '../src/table';
import { arialWidth } from '../src/text-metrics';

const R = (text: string): { runs: TextRun[] } => ({ runs: text ? [{ text }] : [] });
const measure = (t: string, s: number, _f: string, st: string) => arialWidth(t, s, /bold/.test(st));

function sample(): TableData {
  return {
    cols: [36, 70, 60, 50],
    rows: [
      [R('entry'), { runs: [{ text: 'conditions' }], span: 2 }, R(''), R('yield (%)')],
      [R(''), R('catalyst'), R('solvent'), R('')],
      [R('1'), { runs: [{ text: 'Pd(OAc)' }, { text: '2', sub: true }] }, R('THF'), R('45')],
      [R('2'), R('none'), R('DMF'), { runs: [{ text: 'NR' }, { text: 'b', sup: true, italic: true }] }],
    ],
    head: 2,
    lines: 'acs',
  };
}

function docWith(...tables: TableData[]): Doc {
  const doc = new Doc();
  doc.edit('tables', () => {
    let y = 60;
    for (const t of tables) {
      const lay = layoutTable(t, doc.style.captionSize, measure);
      doc.addShape({ kind: 'table', x1: 60, y1: y, x2: 60 + lay.width, y2: y + lay.height, table: t });
      y += lay.height + 60;
    }
  });
  return doc;
}

const tables = (doc: Doc) => [...doc.shapes.values()].filter((s) => s.kind === 'table').map((s) => s.table!);
const text = (t: TableData) => t.rows.map((row) => row.map((c) => c.runs.map((r) => r.text).join('')));

describe('cell borders', () => {
  it('ACS style: a rule over the first row, under the headings and the last row, and under a joined heading', () => {
    const b = tableBorders(sample(), 0.6);
    expect(b[0].map((x) => x.top)).toEqual([0.6, 0.6, 0.6, 0.6]);
    expect(b[1].map((x) => x.bottom)).toEqual([0.6, 0.6, 0.6, 0.6]);
    expect(b[3].map((x) => x.bottom)).toEqual([0.6, 0.6, 0.6, 0.6]);
    // only the joined "conditions" has a rule under it in the first row
    expect(b[0].map((x) => x.bottom)).toEqual([0, 0.6, 0.6, 0]);
    expect(b.flat().every((x) => x.left === 0 && x.right === 0)).toBe(true);
    expect(b[2].map((x) => x.top + x.bottom)).toEqual([0, 0, 0, 0]);
  });

  it('grid: every cell boxed, with no line inside a joined cell', () => {
    const b = tableBorders({ ...sample(), lines: 'grid' }, 0.6);
    expect(b[0][1].right).toBe(0);
    expect(b[0][2].left).toBe(0);
    expect(b[1][1].right).toBe(0.6);
    expect(b[2].every((x) => x.left && x.top && x.bottom && x.right)).toBe(true);
  });

  it('none: no borders', () => {
    expect(tableBorders({ ...sample(), lines: 'none' }, 0.6).flat().every((x) => !x.left && !x.top && !x.bottom && !x.right)).toBe(true);
  });

  it('the lines are worked out again from the borders', () => {
    expect(linesFromBorders(tableBorders(sample(), 0.6))).toEqual({ lines: 'acs', head: 2 });
    expect(linesFromBorders(tableBorders({ ...sample(), head: 1 }, 0.6))).toEqual({ lines: 'acs', head: 1 });
    expect(linesFromBorders(tableBorders({ ...sample(), lines: 'grid' }, 0.6)).lines).toBe('grid');
    expect(linesFromBorders(tableBorders({ ...sample(), lines: 'none' }, 0.6)).lines).toBe('none');
  });
});

describe('the tag kept on a table', () => {
  const plain = (): TableData => ({ ...sample(), rows: sample().rows.map((row) => row.map(({ span: _, ...c }) => c)) });

  it('puts back joined cells, alignment and size', () => {
    const t = applyTableTag(plain(), { v: 1, head: 2, lines: 'acs', spans: [[0, 1, 2]], cellAlign: [[2, 3, 'right']], align: ['left', 'center', 'center', 'right'], size: 9 }, { lines: 'acs', head: 2 });
    expect(t.rows[0][1].span).toBe(2);
    expect(t.rows[2][3].align).toBe('right');
    expect(t.align).toEqual(['left', 'center', 'center', 'right']);
    expect(t.size).toBe(9);
  });

  it('follows the borders when they were changed in ChemDraw', () => {
    const t = applyTableTag(plain(), { v: 1, head: 2, lines: 'acs' }, { lines: 'grid', head: 1 });
    expect(t.lines).toBe('grid');
    expect(t.head).toBe(1);
  });

  it('leaves out what no longer fits the table', () => {
    const t = applyTableTag(plain(), { v: 1, head: 2, lines: 'acs', spans: [[0, 3, 2], [9, 0, 2]], align: ['left'] }, { lines: 'acs', head: 2 });
    expect(t.rows.flat().some((c) => c.span)).toBe(false);
    expect(t.align).toBeUndefined();
  });

  it('reads only tags it knows', () => {
    expect(parseTableTag('{"v":1,"head":1,"lines":"acs"}')).toEqual({ v: 1, head: 1, lines: 'acs' });
    expect(parseTableTag('{"v":2,"head":1,"lines":"acs"}')).toBeNull();
    expect(parseTableTag('not json')).toBeNull();
    expect(parseTableTag(null)).toBeNull();
  });
});

describe('cells into rows and columns', () => {
  it('puts cells in place by their corners and takes column widths from them', () => {
    const none = { left: 0, top: 0, bottom: 0, right: 0 };
    const cell = (x1: number, y1: number, w: number, t: string): ReadCell => ({ x1, y1, x2: x1 + w, y2: y1 + 15, cell: R(t), borders: none });
    // stored out of order, and a little off
    const g = gridOf([cell(130.2, 100, 40, 'd'), cell(100, 100, 30, 'c'), cell(100, 85, 30, 'a'), cell(130, 85.1, 40, 'b')])!;
    expect(g.cols).toEqual([30, 40]);
    expect(g.rows.map((r) => r.map((c) => c.cell.runs[0].text))).toEqual([['a', 'b'], ['c', 'd']]);
    expect(gridOf([])).toBeNull();
  });

  it('fills a missing cell with an empty one', () => {
    const none = { left: 0, top: 0, bottom: 0, right: 0 };
    const g = gridOf([
      { x1: 0, y1: 0, x2: 20, y2: 10, cell: R('a'), borders: none },
      { x1: 20, y1: 0, x2: 50, y2: 10, cell: R('b'), borders: none },
      { x1: 0, y1: 10, x2: 20, y2: 20, cell: R('c'), borders: none },
    ])!;
    expect(g.rows[1][1].cell.runs).toEqual([]);
  });
});

describe('saving and opening tables', () => {
  it('a table with a title, footnotes and a joined heading comes back as it was (CDXML)', () => {
    const t: TableData = { ...sample(), title: [{ text: 'Table 1. ', bold: true }, { text: 'Optimization' }], notes: [{ text: 'b', sup: true, italic: true }, { text: 'No reaction.' }] };
    const x = writeCdxml(docWith(t, { ...sample(), lines: 'grid', head: 1 }), { name: 'tables.cdxml' });
    const [a, b] = tables(readCdxml(x).doc);
    expect(a.cols).toEqual(t.cols);
    expect(text(a)).toEqual(text(t));
    expect(a.rows[0][1].span).toBe(2);
    expect(a.head).toBe(2);
    expect(a.lines).toBe('acs');
    expect(a.title).toEqual(t.title);
    expect(a.notes).toEqual(t.notes);
    expect(a.rows[2][1].runs).toEqual([{ text: 'Pd(OAc)' }, { text: '2', sub: true }]);
    expect(b.lines).toBe('grid');
    expect(b.head).toBe(1);
    expect(b.rows[0][1].span).toBe(2);
  });

  it('writes ChemDraw\'s table: a page for each cell with four borders, and a joined cell\'s text beside it, drawn above it', () => {
    const x = writeCdxml(docWith(sample()), { name: 'tables.cdxml' });
    const dom = new DOMParser().parseFromString(x, 'application/xml');
    const table = dom.querySelector('table')!;
    const pages = [...table.children].filter((e) => e.nodeName === 'page');
    expect(pages).toHaveLength(16);
    for (const p of pages) expect([...p.children].filter((e) => e.nodeName === 'border').map((e) => e.getAttribute('Side'))).toEqual(['left', 'top', 'bottom', 'right']);
    // ChemDraw keeps a cell's text inside the cell, so "conditions" is a caption grouped with the table
    expect(pages[1].querySelector('t')).toBeNull();
    const group = table.parentElement!;
    expect(group.nodeName).toBe('group');
    const cap = [...group.children].find((e) => e.nodeName === 't')!;
    expect(cap.textContent).toBe('conditions');
    expect(cap.querySelector('objecttag')!.getAttribute('Name')).toBe(TABLE_PART_TAG);
    expect(cap.querySelector('objecttag')!.getAttribute('Value')).toBe('cell 0 1');
    // ChemDraw needs each to have its own place in the drawing order to show the caption
    expect(Number(cap.getAttribute('Z'))).toBeGreaterThan(Number(table.getAttribute('Z')));
  });

  it('a plain table is saved without a group', () => {
    const plain: TableData = { cols: [40, 40], rows: [[R('a'), R('b')], [R('1'), R('2')]], head: 1, lines: 'acs' };
    const x = writeCdxml(docWith(plain), { name: 't.cdxml' });
    expect(x).not.toContain('<group');
    expect(text(tables(readCdxml(x).doc)[0])).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('comes back the same through a CDX file, borders included', () => {
    const t: TableData = { ...sample(), title: [{ text: 'Table 1' }] };
    const back = cdxToCdxml(cdxmlToCdx(writeCdxml(docWith(t), { name: 't.cdxml' })));
    expect(back).toMatch(/<border[^>]*Side="top"/);
    const [a] = tables(readCdxml(back).doc);
    expect(text(a)).toEqual(text(t));
    expect(a.head).toBe(2);
    expect(a.lines).toBe('acs');
    expect(a.rows[0][1].span).toBe(2);
    expect(a.title).toEqual([{ text: 'Table 1' }]);
  });

  it('reads a table as ChemDraw re-saves it: standard-width rules left out, and reagents turned into labels', () => {
    // two rows; the rule under the heading and the ones above and below are ChemDraw's usual width, so it leaves them out
    const page = (x: number, y: number, inner: string, borders: [string, number][]) =>
      `<page BoundingBox="${x} ${y} ${x + 50} ${y + 15}">${inner}${borders.map(([s, w]) => `<border LineWidth="${w}" Side="${s}"/>`).join('')}</page>`;
    const label = (t: string) => `<fragment><n p="25 7" NodeType="Fragment"><fragment><n/></fragment><t p="25 10"><s font="3" size="10" face="0">${t}</s><s font="3" size="10" face="32">2</s></t></n></fragment>`;
    const words = (t: string) => `<t p="4 10"><s font="3" size="10" face="0">${t}</s></t>`;
    const x = `<?xml version="1.0"?><CDXML LineWidth="0.6" CaptionSize="10"><fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable><page>
      <table BoundingBox="100 100 200 130">
        ${page(100, 100, words('catalyst'), [['left', 0], ['right', 0]])}
        ${page(150, 100, words('yield'), [['left', 0], ['right', 0]])}
        ${page(100, 115, label('PdCl'), [['left', 0], ['top', 0], ['right', 0]])}
        ${page(150, 115, words('45'), [['left', 0], ['top', 0], ['right', 0]])}
      </table></page></CDXML>`;
    const { doc, stats } = readCdxml(x);
    const [t] = tables(doc);
    expect(text(t)).toEqual([['catalyst', 'yield'], ['PdCl2', '45']]);
    expect(t.rows[1][0].runs[1]).toMatchObject({ text: '2', sub: true });
    expect(t.lines).toBe('acs');
    expect(t.head).toBe(1);
    expect(stats.skipped).toEqual({});
  });
});

describe('pasting cells', () => {
  it('reads an HTML table (as Excel and Word copy it), with joined cells and subscripts', () => {
    const html = `<table><tr><td>entry</td><td colspan="2">conditions</td></tr><tr><td rowspan="2">1</td><td>Pd(OAc)<sub>2</sub></td><td><b>THF</b></td></tr><tr><td>x</td><td>y</td></tr><tr><td></td><td></td></tr></table>`;
    const rows = parseHtmlTable(html)!;
    expect(rows).toHaveLength(3);
    expect(rows[0][1]).toEqual({ runs: [{ text: 'conditions' }], span: 2 });
    expect(rows[0]).toHaveLength(3);
    expect(rows[1][1].runs).toEqual([{ text: 'Pd(OAc)' }, { text: '2', sub: true }]);
    expect(rows[1][2].runs).toEqual([{ text: 'THF', bold: true }]);
    // the cell under a cell reaching down is left empty
    expect(rows[2].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['', 'x', 'y']);
    expect(parseHtmlTable('<p>no table</p>')).toBeNull();
  });

  it('reads tab-separated text, with quoted line breaks', () => {
    expect(parseTextTable('a\tb\r\n1\t"two\nlines"\r\n')).toEqual([[R('a'), R('b')], [R('1'), R('two\nlines')]]);
    expect(parseTextTable('just words')).toBeNull();
  });

  it('a single cell pastes as text, not a table', () => {
    expect(pastedTable(null, 'one')).toBeNull();
    expect(pastedTable('<table><tr><td>one</td></tr></table>', 'one')).toBeNull();
    expect(pastedTable(null, 'a\tb')).toEqual([[R('a'), R('b')]]);
  });

  it('copies a table out as HTML and tab-separated text', () => {
    const t: TableData = { ...sample(), title: [{ text: 'Table 1' }] };
    const html = tableHtml(t);
    expect(html).toContain('<p>Table 1</p>');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('<th');
    expect(html).toContain('Pd(OAc)<sub>2</sub>');
    expect(html).toContain('border-top');
    // and reads back as the same cells
    const back = parseHtmlTable(html)!;
    expect(back.map((r) => r.map((c) => c.runs.map((x) => x.text).join('')))).toEqual(text(t));
    expect(tableTsv(t).split(/\r?\n/)[2]).toBe('1\tPd(OAc)2\tTHF\t45');
  });
});
