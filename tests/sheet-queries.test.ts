// @vitest-environment jsdom
//
// Data > Get Data (Power Query lite): reading CSV, JSON, web tables and workbooks, the steps,
// loading into a table and refreshing it; and the Compound data type with FIELDVALUE.

import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import {
  textTable, jsonTable, jsonPaths, htmlTables, firstSteps, runSteps, detectType, convert, stepName, newQueryName, tableNameFor,
  type Query, type QueryStep, type QTable,
} from '../src/sheet/query';
import { writeResult, queryTable, resultRange, loadProblem, wouldCover } from '../src/sheet/query-sheet';
import { fieldName, type CompoundCard } from '../src/sheet/compound';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';

const CSV = 'Entry,Catalyst,Temp,Yield,Date\n1,Pd(OAc)2,80,72%,2026-10-01\n2,Pd2(dba)3,100,85%,2026-10-02\n3,NiCl2,80,,2026-10-03\n';

function run(t: QTable, steps: QueryStep[]): QTable {
  const got = runSteps(t, steps);
  if ('error' in got) throw new Error(got.error);
  return got.table;
}

describe('reading sources', () => {
  it('reads CSV with headers and types worked out', () => {
    const raw = textTable(CSV, 'auto');
    expect(raw.cols).toEqual(['Column1', 'Column2', 'Column3', 'Column4', 'Column5']);
    const steps = firstSteps(raw, false);
    expect(steps.map((s) => s.op)).toEqual(['promoteHeaders', 'changeType']);
    const t = run(raw, steps);
    expect(t.cols).toEqual(['Entry', 'Catalyst', 'Temp', 'Yield', 'Date']);
    expect(t.types).toEqual(['whole', 'text', 'whole', 'percent', 'date']);
    expect(t.rows[0]).toEqual([1, 'Pd(OAc)2', 80, 0.72, expect.any(Number)]);
    expect(t.rows[2][3]).toBeNull();
  });

  it('splits at other characters, keeping quoted fields whole', () => {
    const t = textTable('a|b\n"x|y"|2', '|');
    expect(t.rows).toEqual([['a', 'b'], ['x|y', '2']]);
  });

  it('reads JSON records, nested objects as columns of their own', () => {
    const text = JSON.stringify({ meta: { n: 2 }, data: [{ name: 'THF', bp: { value: 66, unit: '°C' }, tags: ['ether', 'aprotic'] }, { name: 'DCM', bp: { value: 39.6 } }] });
    expect(jsonPaths(JSON.parse(text))).toEqual(['data']);
    const t = jsonTable(text, 'data');
    expect(t.cols).toEqual(['name', 'bp.value', 'bp.unit', 'tags']);
    expect(t.rows[0]).toEqual(['THF', 66, '°C', 'ether, aprotic']);
    expect(t.rows[1]).toEqual(['DCM', 39.6, null, null]);
    expect(t.types[1]).toBe('number');
  });

  it('reads the tables of a web page, spans filled in', () => {
    const html = `<table id="t1"><caption>Solvents</caption><thead><tr><th>Name</th><th>bp</th></tr></thead>
      <tbody><tr><td>THF</td><td>66</td></tr><tr><td>Toluene</td><td>110.6</td></tr></tbody></table>
      <table><tr><td colspan="2">A</td></tr><tr><td>1</td><td>2</td></tr></table>`;
    const got = htmlTables(html);
    expect(got.map((g) => g.name)).toEqual(['Solvents', 'Table 2']);
    expect(got[0].table.cols).toEqual(['Name', 'bp']);
    expect(got[0].table.rows).toEqual([['THF', 66], ['Toluene', 110.6]]);
    expect(got[1].table.rows[0]).toEqual(['A', 'A']);
  });
});

describe('steps', () => {
  const base = () => run(textTable(CSV, 'auto'), firstSteps(textTable(CSV, 'auto'), false));

  it('removes, keeps and renames columns', () => {
    expect(run(base(), [{ op: 'removeColumns', cols: ['Date', 'Temp'] }]).cols).toEqual(['Entry', 'Catalyst', 'Yield']);
    expect(run(base(), [{ op: 'keepColumns', cols: ['Yield', 'Entry'] }]).cols).toEqual(['Yield', 'Entry']);
    expect(run(base(), [{ op: 'rename', from: 'Temp', to: 'T (°C)' }]).cols[2]).toBe('T (°C)');
    const bad = runSteps(base(), [{ op: 'removeColumns', cols: ['Nope'] }]);
    expect('error' in bad && bad.error).toMatch(/Nope/);
  });

  it('filters as the column type compares', () => {
    expect(run(base(), [{ op: 'filter', col: 'Temp', test: 'gt', value: '90' }]).rows.map((r) => r[0])).toEqual([2]);
    expect(run(base(), [{ op: 'filter', col: 'Catalyst', test: 'begins', value: 'pd' }]).rows.length).toBe(2);
    expect(run(base(), [{ op: 'filter', col: 'Yield', test: 'notBlank' }]).rows.length).toBe(2);
  });

  it('splits a column by a delimiter into typed columns', () => {
    const t = textTable('Sample,Shift\nA,7.26;CHCl3\nB,2.50;DMSO\n', 'auto');
    const got = run(t, [...firstSteps(t, false), { op: 'split', col: 'Shift', by: ';', mode: 'each' }]);
    expect(got.cols).toEqual(['Sample', 'Shift.1', 'Shift.2']);
    expect(got.rows[0]).toEqual(['A', 7.26, 'CHCl3']);
    expect(got.types[1]).toBe('number');
  });

  it('unpivots columns, and the other columns', () => {
    const t = run(textTable('Entry,Run 1,Run 2\n1,70,72\n2,80,\n', 'auto'), [{ op: 'promoteHeaders' }, { op: 'changeType', types: { 'Run 1': 'whole', 'Run 2': 'whole' } }]);
    const a = run(t, [{ op: 'unpivot', cols: ['Run 1', 'Run 2'], attr: 'Run', value: 'Yield' }]);
    expect(a.cols).toEqual(['Entry', 'Run', 'Yield']);
    expect(a.rows).toEqual([['1', 'Run 1', 70], ['1', 'Run 2', 72], ['2', 'Run 1', 80]]);
    const b = run(t, [{ op: 'unpivot', cols: ['Entry'], other: true, attr: 'Attribute', value: 'Value' }]);
    expect(b.rows).toEqual(a.rows);
    expect(b.types[2]).toBe('whole');
  });

  it('changes types, with errors for values that cannot be', () => {
    expect(convert('12', 'whole')).toBe(12);
    expect(convert('12', 'percent')).toBeCloseTo(0.12);
    expect(convert('yes', 'logical')).toBe(true);
    expect(convert('abc', 'number')).toBeInstanceOf(CellError);
    expect(detectType(['1', '2.5', ''])).toBe('number');
    expect(detectType(['007'])).toBe('text');
  });

  it('sorts, removes duplicates, replaces values, trims', () => {
    const t = base();
    expect(run(t, [{ op: 'sort', col: 'Temp', desc: true }]).rows.map((r) => r[0])).toEqual([2, 1, 3]);
    expect(run(t, [{ op: 'removeDuplicates', cols: ['Temp'] }]).rows.length).toBe(2);
    expect(run(t, [{ op: 'replace', col: 'Catalyst', find: 'Pd', with: 'Pt' }]).rows[0][1]).toBe('Pt(OAc)2');
    expect(stepName({ op: 'filter', col: 'Temp', test: 'gt', value: '90' })).toBe('Filtered Rows (Temp is greater than 90)');
  });

  it('names queries and their tables as Excel allows', () => {
    expect(newQueryName('C:\\data\\Screen 1.csv', ['screen 1'])).toBe('Screen 1 (2)');
    expect(tableNameFor('Screen 1 (2)', [])).toBe('Screen_1_2');
    expect(tableNameFor('A1', [])).toBe('_A1');
  });
});

describe('loading and refreshing', () => {
  const q: Query = { id: 1, name: 'Screen', source: { kind: 'text', file: 'screen.csv', delimiter: 'auto' }, steps: [], table: null };

  it('loads results as a table, and refresh grows and shrinks it', () => {
    const wb = new Workbook();
    const s = wb.sheets[0];
    const t = run(textTable(CSV, 'auto'), firstSteps(textTable(CSV, 'auto'), false));
    const got = wb.edit('Load', () => writeResult(s, { row: 0, col: 0 }, t, null, q));
    wb.edit('q', () => wb.setQueries([{ ...q, table: got.table.name }]));
    expect(got.table.name).toBe('Screen');
    expect(got.table.range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 4 });
    expect(s.value(1, 3)).toBeCloseTo(0.72);
    expect(s.styleAt(1, 4)?.numFmt).toBe('yyyy-mm-dd');
    expect(queryTable(wb, wb.queries[0])?.table.id).toBe(got.table.id);

    // fewer rows: the old ones are emptied
    const fewer = run(t, [{ op: 'filter', col: 'Temp', test: 'equals', value: '80' }, { op: 'removeColumns', cols: ['Date'] }]);
    const again = wb.edit('Refresh', () => writeResult(s, { row: 0, col: 0 }, fewer, got.table, q));
    expect(again.table.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 3 });
    expect(s.value(3, 0)).toBeNull();
    expect(s.value(1, 4)).toBeNull();
    expect(s.tables.length).toBe(1);
    wb.undo();
    expect(s.tables[0].range.r2).toBe(3);
  });

  it('tells when results would run into something', () => {
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.edit('x', () => s.setInput(2, 1, 'note'));
    const t: QTable = { cols: ['A', 'B'], types: ['any', 'any'], rows: [[1, 2], [3, 4]] };
    const R = resultRange({ row: 0, col: 0 }, t);
    expect(wouldCover(s, R, null)).toBe(true);
    expect(loadProblem(s, R, null)).toBeNull();
  });
});

describe('the Compound data type', () => {
  const card: CompoundCard = { cid: 2244, name: 'Aspirin', fields: { Name: 'Aspirin', Formula: 'C9H8O4', 'Molecular weight': 180.16, CAS: '50-78-2' } };

  it('reads fields with FIELDVALUE, by any of their names', () => {
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.edit('x', () => {
      s.setCompound(0, 0, card);
      s.setInput(0, 1, '=FIELDVALUE(A1,"MW")');
      s.setInput(0, 2, '=FIELDVALUE(A1,"Boiling point")');
      s.setInput(0, 3, '=FIELDVALUE(B1,"Formula")');
      s.setInput(1, 1, '=FIELDVALUE(A1:A1,"cas")');
    });
    expect(s.value(0, 0)).toBe('Aspirin');
    expect(s.value(0, 1)).toBe(180.16);
    expect((s.value(0, 2) as CellError).code).toBe('#FIELD!');
    expect((s.value(0, 3) as CellError).code).toBe('#FIELD!');
    expect(s.value(1, 1)).toBe('50-78-2');
    expect(fieldName('molecular weight')).toBe('Molecular weight');
    // a new card works the formulas out again
    wb.edit('y', () => s.setCompound(0, 0, { ...card, fields: { ...card.fields, 'Molecular weight': 180.158 } }));
    expect(s.value(0, 1)).toBe(180.158);
    // typing over it makes it plain text
    wb.edit('z', () => s.setInput(0, 0, 'Aspirin'));
    expect(s.cell(0, 0)?.compound).toBeUndefined();
  });

  it('keeps compounds and queries in .xlsx, with FIELDVALUE saved as its value for Excel', async () => {
    const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.edit('x', () => {
      s.setCompound(0, 0, card);
      s.setInput(0, 1, '=FIELDVALUE(A1,"Molecular weight")');
      wb.setQueries([{ id: 7, name: 'Screen', source: { kind: 'text', file: 'C:\\data\\screen.csv', delimiter: ',' }, steps: [{ op: 'promoteHeaders' }], table: 'Screen' }]);
    });
    const bytes = await writeXlsx(wb, pictures);
    const { unzipSync, strFromU8 } = await import('fflate');
    const sheetXml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(sheetXml).not.toMatch(/FIELDVALUE/);
    const { book } = await readXlsx(bytes);
    const b = book.sheets[0];
    expect(b.cell(0, 0)?.compound?.cid).toBe(2244);
    expect(b.cell(0, 1)?.input).toBe('=FIELDVALUE(A1,"Molecular weight")');
    expect(b.value(0, 1)).toBe(180.16);
    expect(book.queries).toEqual(wb.queries);
  });
});
