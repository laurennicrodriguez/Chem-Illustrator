// @vitest-environment jsdom
//
// The Data tab's work in Excel files: a data table is Excel's TABLE() formula on its first result
// cell, a PivotTable is Excel's pivot cache and pivot table parts (refreshed when Excel opens it),
// the Solver model is Excel's hidden solver_ names, and an indent is the cell's own. Each comes
// back from our own copy, and from Excel's parts alone.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { Workbook } from '../src/sheet/workbook';
import { newDataTableId } from '../src/sheet/what-if';
import { newPivotId, type PivotTable } from '../src/sheet/pivot';
import { writePivot } from '../src/sheet/pivot-sheet';
import { modelNames, defaultModel } from '../src/sheet/solver';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const part = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[name]);
/** The file as another program that keeps only Excel's parts would save it. */
const withoutOurs = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  for (const k of Object.keys(files)) { if (k.startsWith('customXml/')) delete files[k]; else files[k] = new Uint8Array(files[k]); }
  return zipSync(files);
};

const RUNS = [
  ['Catalyst', 'Solvent', 'Yield'],
  ['Pd', 'THF', 80], ['Pd', 'DMF', 70], ['Ni', 'THF', 60], ['Ni', 'THF', 64], ['Cu', 'DMF', 50],
];

function book(): { wb: Workbook; pt: PivotTable } {
  const wb = new Workbook(['Runs', 'Model']);
  const [s, m] = wb.sheets;
  const pt: PivotTable = {
    id: newPivotId(), name: 'PivotTable1', source: '=Runs!$A$1:$C$6', at: { row: 0, col: 5 },
    rows: ['Catalyst'], cols: [], values: [{ field: 'Yield', fn: 'average' }], filters: ['Solvent'], hidden: { Solvent: ['DMF'] },
    layout: 'compact', subtotals: true, grandRows: true, grandCols: true,
  };
  wb.edit('data', () => {
    RUNS.forEach((row, r) => row.forEach((v, c) => s.setInput(r, c, String(v))));
    s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 0 }, { indent: 2 });
    // a data table: B1 tried at 1, 2, 3 down B4:B6, the formula in C3
    m.setInput(0, 1, '1');
    m.setInput(2, 2, '=B1*2+1');
    for (const [r, v] of [[3, 1], [4, 2], [5, 3]]) m.setInput(r, 1, String(v));
    m.setDataTables([{ id: newDataTableId(), ref: { r1: 3, c1: 2, r2: 5, c2: 2 }, colInput: '=$B$1' }]);
  });
  // (a report reads the values its records have once they're worked out)
  wb.edit('pivot', () => {
    writePivot(s, pt);
    wb.setNames([...wb.names, ...modelNames({ ...defaultModel(), objective: '=$C$3', vars: '=$B$1', goal: 'max', constraints: [{ lhs: '=$B$1', rel: '<=', rhs: '=5' }] }, m)]);
  });
  return { wb, pt };
}

describe('the Data tab in Excel files', () => {
  it('writes Excel\'s own data table, pivot parts and Solver names', async () => {
    const { wb } = book();
    const bytes = await writeXlsx(wb, pictures);
    const sheet2 = part(bytes, 'xl/worksheets/sheet2.xml');
    expect(sheet2).toContain('<f t="dataTable" ref="C4:C6" dt2D="0" dtr="0" r1="B1"/>');
    expect(sheet2).toMatch(/<c r="C5"[^>]*><v>5<\/v><\/c>/);
    const table = part(bytes, 'xl/pivotTables/pivotTable1.xml');
    expect(table).toContain('<location ref="F3:G6"');
    expect(table).toContain('<rowFields count="1"><field x="0"/></rowFields>');
    expect(table).toContain('<pageFields count="1"><pageField fld="1" item="1" hier="-1"/></pageFields>');
    expect(table).toContain('<dataField name="Average of Yield" fld="2" subtotal="average"');
    // items in Excel's order, the one left out hidden
    expect(table).toMatch(/<pivotField axis="axisPage"[^>]*><items count="3"><item h="1" x="0"\/><item x="1"\/><item t="default"\/>/);
    const cache = part(bytes, 'xl/pivotCache/pivotCacheDefinition1.xml');
    expect(cache).toContain('refreshOnLoad="1"');
    expect(cache).toContain('<worksheetSource ref="A1:C6" sheet="Runs"/>');
    expect(cache).toContain('<cacheField name="Yield" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="50" maxValue="80" count="5">');
    expect(part(bytes, 'xl/pivotCache/pivotCacheRecords1.xml')).toContain('<r><x v="2"/><x v="1"/><x v="4"/></r>');
    const wbXml = part(bytes, 'xl/workbook.xml');
    expect(wbXml).toMatch(/<\/calcPr>|<calcPr[^>]*\/><pivotCaches><pivotCache cacheId="1" r:id="rId\d+"\/><\/pivotCaches><\/workbook>/);
    expect(wbXml).toContain('<definedName name="solver_opt" localSheetId="1" hidden="1">Model!$C$3</definedName>');
    expect(part(bytes, '[Content_Types].xml')).toContain('pivotCacheRecords+xml');
    expect(part(bytes, 'xl/styles.xml')).toContain('indent="2"');
  });

  it('comes back from our own copy', async () => {
    const { wb, pt } = book();
    const { book: back } = await readXlsx(await writeXlsx(wb, pictures));
    const [s, m] = back.sheets;
    expect(s.pivots).toHaveLength(1);
    expect(s.pivots[0].id).toBe(pt.id);
    expect(s.pivots[0].hidden).toEqual({ Solvent: ['DMF'] });
    expect(m.dataTables).toHaveLength(1);
    back.recalc();
    expect([m.value(3, 2), m.value(4, 2), m.value(5, 2)]).toEqual([3, 5, 7]);
    // the results are worked out, not typed
    expect(m.cell(4, 2)?.input).toBeUndefined();
    expect(s.styleAt(0, 0)?.indent).toBe(2);
    expect(back.names.filter((n) => n.name.startsWith('solver_') && n.sheet === m).length).toBeGreaterThan(5);
  });

  it('comes back from Excel\'s parts alone', async () => {
    const { wb } = book();
    const { book: back, warnings } = await readXlsx(withoutOurs(await writeXlsx(wb, pictures)));
    expect(warnings.join(' ')).not.toContain('PivotTable');
    const [s, m] = back.sheets;
    const p = s.pivots[0];
    expect(p).toMatchObject({ name: 'PivotTable1', source: '=Runs!$A$1:$C$6', at: { row: 0, col: 5 }, rows: ['Catalyst'], filters: ['Solvent'], layout: 'compact', subtotals: true, grandRows: true, grandCols: true });
    expect(p.values).toEqual([{ field: 'Yield', fn: 'average' }]);
    expect(p.hidden).toEqual({ Solvent: ['DMF'] });
    expect(p.last).toEqual({ r1: 0, c1: 5, r2: 5, c2: 6 });
    expect(m.dataTables[0]).toMatchObject({ ref: { r1: 3, c1: 2, r2: 5, c2: 2 }, colInput: '=$B$1' });
    back.recalc();
    expect(m.value(5, 2)).toBe(7);
  });

  it('keeps two-input data tables and tabular PivotTables', async () => {
    const wb = new Workbook(['A']);
    const s = wb.sheets[0];
    wb.edit('data', () => {
      RUNS.forEach((row, r) => row.forEach((v, c) => s.setInput(r, c, String(v))));
      s.setInput(10, 0, '1'); s.setInput(10, 1, '2');
      s.setInput(12, 1, '=A11*B11');
      s.setInput(12, 2, '1'); s.setInput(12, 3, '2'); s.setInput(13, 1, '3'); s.setInput(14, 1, '4');
      s.setDataTables([{ id: newDataTableId(), ref: { r1: 13, c1: 2, r2: 14, c2: 3 }, rowInput: '=$A$11', colInput: '=$B$11' }]);
    });
    wb.edit('pivot', () => {
      writePivot(s, { id: newPivotId(), name: 'Yields', source: '=A!$A$1:$C$6', at: { row: 20, col: 0 }, rows: ['Catalyst', 'Solvent'], cols: [], values: [{ field: 'Yield', fn: 'sum' }, { field: 'Yield', fn: 'max', showAs: 'percentOfTotal' }], filters: [], hidden: {}, layout: 'tabular', subtotals: false, grandRows: false, grandCols: true, descending: ['Catalyst'] });
    });
    const bytes = await writeXlsx(wb, pictures);
    expect(part(bytes, 'xl/worksheets/sheet1.xml')).toContain('<f t="dataTable" ref="C14:D15" dt2D="1" dtr="1" r1="A11" r2="B11"/>');
    const { book: back } = await readXlsx(withoutOurs(bytes));
    const b = back.sheets[0];
    expect(b.dataTables[0]).toMatchObject({ rowInput: '=$A$11', colInput: '=$B$11' });
    back.recalc();
    expect([b.value(13, 2), b.value(13, 3), b.value(14, 2), b.value(14, 3)]).toEqual([3, 6, 4, 8]);
    expect(b.pivots[0]).toMatchObject({ name: 'Yields', rows: ['Catalyst', 'Solvent'], layout: 'tabular', subtotals: false, grandRows: false, grandCols: true, descending: ['Catalyst'] });
    expect(b.pivots[0].values).toEqual([{ field: 'Yield', fn: 'sum' }, { field: 'Yield', fn: 'max', showAs: 'percentOfTotal' }]);
  });
});
