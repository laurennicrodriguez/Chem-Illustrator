// @vitest-environment jsdom
//
// Sheet mode's finishing touches: turned text and cell styles, the outline (Group, Show Detail,
// the level buttons, Auto Outline) and Subtotal, sparklines, the View tab's settings and custom
// views, and workbook themes. Everything goes to Excel's own parts of an .xlsx file and comes back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { keyOf } from '../src/sheet/refs';
import { cellStylePatch, cellStyleBorders, CELL_STYLES } from '../src/sheet/cell-styles';
import { group, ungroup, outlineGroups, setCollapsed, showLevel, maxLevel, addSubtotals, removeSubtotals, autoOutline, clearOutline } from '../src/sheet/outline';
import { makeSparklines, sparkShape, sparkSource, SparklineGroup } from '../src/sheet/sparklines';
import { captureView, applyView } from '../src/sheet/views';
import { WORKBOOK_THEMES, DEFAULT_THEME, themePalette, tintColour, mixTheme } from '../src/sheet/themes';
import { textRotation, readTextRotation } from '../src/io/xlsx-view';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

const A = (s: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(s)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1] as const;
};
const R = (s: string) => {
  const [a, b] = s.split(':');
  const [r1, c1] = A(a), [r2, c2] = A(b ?? a);
  return { r1, c1, r2, c2 };
};

function book(cells: Record<string, string> = {}): Workbook {
  const wb = new Workbook();
  wb.edit('Type', () => { for (const [addr, v] of Object.entries(cells)) wb.sheet.setInput(...A(addr), v); });
  return wb;
}
const val = (wb: Workbook, addr: string) => wb.sheet.values.get(keyOf(...A(addr))) ?? null;
const input = (wb: Workbook, addr: string) => wb.sheet.cell(...A(addr))?.input;

async function roundTrip(wb: Workbook) {
  const bytes = await writeXlsx(wb, pictures);
  const files = unzipSync(bytes);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  return { text, back: (await readXlsx(bytes)).book };
}

describe('turned text and cell styles', () => {
  it('turns text as Excel numbers it, and keeps it in the file', async () => {
    expect(textRotation(45)).toBe(45);
    expect(textRotation(-45)).toBe(135);
    expect(textRotation(-90)).toBe(180);
    expect(textRotation(255)).toBe(255);
    expect(readTextRotation('135')).toBe(-45);
    expect(readTextRotation('90')).toBe(90);
    expect(readTextRotation('0')).toBeUndefined();
    const wb = book({ A1: 'Yield', B1: 'ee' });
    wb.edit('Turn', () => { wb.sheet.patchStyle(R('A1'), { rotate: 90 }); wb.sheet.patchStyle(R('B1'), { rotate: -45, indent: 2 }); });
    const { text, back } = await roundTrip(wb);
    expect(text('xl/styles.xml')).toContain('textRotation="90"');
    expect(text('xl/styles.xml')).toContain('textRotation="135"');
    expect(back.sheet.styleAt(0, 0)?.rotate).toBe(90);
    expect(back.sheet.styleAt(0, 1)).toMatchObject({ rotate: -45, indent: 2 });
  });

  it('applies built-in cell styles from the theme, and saves them as Excel\'s named styles', async () => {
    expect(cellStylePatch('Good', null)).toMatchObject({ fill: '#c6efce', color: '#006100', cellStyle: 'Good' });
    // Heading 1 is the theme's Text 2 colour with an Accent 1 rule under it
    expect(cellStylePatch('Heading 1', null)).toMatchObject({ bold: true, size: 15, color: '#44546a' });
    expect(cellStyleBorders('Heading 1', null)?.bottom).toEqual({ style: 'thick', color: '#4472c4' });
    const harbor = WORKBOOK_THEMES.find((t) => t.name === 'Harbor')!;
    expect(cellStyleBorders('Total', harbor)?.top?.color).toBe(harbor.colors[4]);
    expect(cellStylePatch('20% - Accent1', null).fill).toBe(tintColour('#4472c4', 0.8));
    expect(cellStylePatch('Percent', null)).toEqual({ numFmt: '0%', cellStyle: 'Percent' });
    expect(new Set(CELL_STYLES.map((d) => d.builtinId)).size).toBe(CELL_STYLES.length);
    const wb = book({ A1: 'Totals', A2: '5' });
    wb.edit('Style', () => {
      wb.sheet.patchStyle(R('A1'), { ...cellStylePatch('Heading 1', null), borders: undefined });
      wb.sheet.patchStyle(R('A1'), { borders: cellStyleBorders('Heading 1', null) });
      wb.sheet.patchStyle(R('A2'), cellStylePatch('Bad', null));
    });
    const { text, back } = await roundTrip(wb);
    expect(text('xl/styles.xml')).toMatch(/<cellStyle name="Heading 1" xfId="\d+" builtinId="16"\/>/);
    expect(text('xl/styles.xml')).toMatch(/<cellStyle name="Bad" xfId="\d+" builtinId="27"\/>/);
    expect(back.sheet.styleAt(0, 0)).toMatchObject({ cellStyle: 'Heading 1', bold: true, size: 15 });
    expect(back.sheet.styleAt(1, 0)).toMatchObject({ cellStyle: 'Bad', fill: '#ffc7ce' });
  });
});

describe('the outline', () => {
  it('groups rows, folds and opens them, and shows levels', () => {
    const wb = book();
    const s = wb.sheet;
    wb.edit('Group', () => { group(s, 'row', 1, 6); group(s, 'row', 2, 3); });
    expect(maxLevel(s, 'row')).toBe(2);
    const gs = outlineGroups(s, 'row');
    expect(gs).toEqual([
      { level: 1, from: 1, to: 6, button: 7, collapsed: false },
      { level: 2, from: 2, to: 3, button: 4, collapsed: false },
    ]);
    // fold the inner group, then the outer; opening the outer keeps the inner folded
    wb.edit('Hide', () => setCollapsed(s, 'row', gs[1], true));
    wb.edit('Hide', () => setCollapsed(s, 'row', gs[0], true));
    expect([...s.hiddenRows.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    wb.edit('Show', () => setCollapsed(s, 'row', outlineGroups(s, 'row')[0], false));
    expect([...s.hiddenRows.keys()].sort()).toEqual([2, 3]);
    wb.edit('Level', () => showLevel(s, 'row', 1));
    expect(s.hiddenRows.size).toBe(6);
    wb.edit('Level', () => showLevel(s, 'row', 3));
    expect(s.hiddenRows.size).toBe(0);
    // ungrouping takes a level off; rows grouped seven deep can't go deeper
    wb.edit('Ungroup', () => ungroup(s, 'row', 2, 3));
    expect(maxLevel(s, 'row')).toBe(1);
    wb.edit('Deep', () => { for (let i = 0; i < 6; i++) group(s, 'row', 1, 1); });
    expect(s.rowLevels.get(1)).toBe(7);
    expect(wb.edit('Deeper', () => group(s, 'row', 1, 1))).toBe(false);
    wb.edit('Clear', () => clearOutline(s, 'row'));
    expect(s.rowLevels.size).toBe(0);
    // rows put in above a group move it down
    wb.edit('Group', () => group(s, 'col', 2, 4));
    wb.edit('Insert', () => s.insertCols(0, 2));
    expect([...s.colLevels.keys()]).toEqual([4, 5, 6]);
  });

  it('makes groups from the totals formulas (Auto Outline)', () => {
    const wb = book({ A1: '1', A2: '2', A3: '3', A4: '=SUM(A1:A3)', B1: '1', B2: '2', B3: '3', B4: '=SUM(B1:B3)' });
    expect(wb.edit('Auto', () => autoOutline(wb.sheet, R('A1:B4')))).toBe(1);
    expect([...wb.sheet.rowLevels]).toEqual([[0, 1], [1, 1], [2, 1]]);
  });

  it('adds subtotals under each run of the same value, with a grand total, and takes them away', () => {
    const wb = book({
      A1: 'Catalyst', B1: 'Yield', C1: 'ee',
      A2: 'Pd', B2: '80', C2: '90',
      A3: 'Pd', B3: '70', C3: '92',
      A4: 'Ni', B4: '50', C4: '85',
      A5: 'Cu', B5: '40', C5: '80',
      A6: 'Cu', B6: '30', C6: '81',
    });
    const s = wb.sheet;
    const got = wb.edit('Subtotal', () => addSubtotals(s, R('A1:C6'), { by: 0, fn: 9, cols: [1] }));
    expect(got).toEqual(R('A1:C10'));
    expect(input(wb, 'A4')).toBe('Pd Total');
    expect(input(wb, 'B4')).toBe('=SUBTOTAL(9,B2:B3)');
    expect(val(wb, 'B4')).toBe(150);
    expect(input(wb, 'A6')).toBe('Ni Total');
    expect(input(wb, 'A9')).toBe('Cu Total');
    expect(val(wb, 'B9')).toBe(70);
    expect(input(wb, 'A10')).toBe('Grand Total');
    // the grand total leaves the subtotals out
    expect(input(wb, 'B10')).toBe('=SUBTOTAL(9,B2:B9)');
    expect(val(wb, 'B10')).toBe(270);
    // details two deep, subtotals one, the grand total none
    expect(s.rowLevels.get(1)).toBe(2);
    expect(s.rowLevels.get(3)).toBe(1);
    expect(s.rowLevels.has(9)).toBe(false);
    // level 2 shows only the subtotals; SUBTOTAL(109…) leaves out rows hidden that way, 9 doesn't
    wb.edit('Type', () => s.setInput(...A('D1'), '=SUBTOTAL(109,B2:B3)'));
    wb.edit('Level', () => showLevel(s, 'row', 2));
    expect(val(wb, 'D1')).toBe(0);
    expect(val(wb, 'B10')).toBe(270);
    wb.edit('Level', () => showLevel(s, 'row', 3));
    expect(val(wb, 'D1')).toBe(150);
    // Remove All puts the table back
    wb.edit('Remove', () => removeSubtotals(s, R('A1:C10')));
    expect(input(wb, 'A4')).toBe('Ni');
    expect(input(wb, 'A7')).toBeUndefined();
    expect(s.rowLevels.size).toBe(0);
  });

  it('keeps the outline in .xlsx (levels, folded groups, summary rows above)', async () => {
    const wb = book({ A1: 'a', A5: 'b' });
    const s = wb.sheet;
    wb.edit('Group', () => { group(s, 'row', 1, 3); group(s, 'col', 1, 2); s.setOutline({ summaryAbove: true }); });
    wb.edit('Fold', () => setCollapsed(s, 'row', outlineGroups(s, 'row')[0], true));
    const { text, back } = await roundTrip(wb);
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<outlinePr summaryBelow="0"/>');
    expect(sheet).toContain('outlineLevelRow="1"');
    expect(sheet).toMatch(/<row r="1" collapsed="1"/);
    expect(sheet).toMatch(/<row r="2" hidden="1" outlineLevel="1"/);
    expect(sheet).toMatch(/<col min="2" max="2"[^>]*outlineLevel="1"/);
    expect([...back.sheet.rowLevels]).toEqual([[1, 1], [2, 1], [3, 1]]);
    expect([...back.sheet.colLevels]).toEqual([[1, 1], [2, 1]]);
    expect(back.sheet.outline).toEqual({ summaryAbove: true });
    expect(outlineGroups(back.sheet, 'row')[0]).toMatchObject({ collapsed: true, button: 0 });
  });
});

describe('sparklines', () => {
  it('makes one sparkline for each row of data, and works out what to draw', () => {
    const g = makeSparklines('line', R('B2:F4'), R('G2:G4')) as SparklineGroup;
    expect(g.items.map((i) => i.data)).toEqual(['B2:F2', 'B3:F3', 'B4:F4']);
    expect(makeSparklines('line', R('B2:F4'), R('G2:G3'))).toMatch(/one cell for each row/);
    const across = makeSparklines('column', R('B2:D6'), R('B7:D7'), 'Run data') as SparklineGroup;
    expect(across.items[1].data).toBe("'Run data'!C2:C6");
    expect(sparkSource("'Run data'!C2:C6")).toEqual({ sheet: 'Run data', range: R('C2:C6') });
    // a line through the points, with the high and low marked
    const line = sparkShape({ ...g, high: true, low: true }, [1, 3, null, 2], 100, 20);
    expect(line.line).toHaveLength(4);
    expect(line.line![2]).toBeNull();
    expect(line.dots!.map((d) => d.color)).toEqual([g.lowColor, g.highColor]);
    expect(sparkShape({ ...g, empty: 'span' }, [1, null, 2], 100, 20).line).toHaveLength(2);
    // columns stand on zero; win/loss bars go up or down, negatives in their own colour
    const cols = sparkShape({ ...g, kind: 'column', axis: true }, [2, -1, 4], 60, 20);
    expect(cols.bars).toHaveLength(3);
    expect(cols.axis).toBeDefined();
    const wl = sparkShape({ ...g, kind: 'winloss' }, [1, -2, 0, 3], 60, 20);
    expect(wl.bars!.map((b) => b.color)).toEqual([g.color, g.negColor, g.color]);
  });

  it('moves with its cells and keeps pointing at its data', () => {
    const wb = book({ B1: '1', C1: '2', D1: '3' });
    const s = wb.sheet;
    wb.edit('Sparkline', () => s.setSparklines([makeSparklines('line', R('B1:D1'), R('E1')) as SparklineGroup]));
    wb.edit('Insert', () => s.insertCols(0, 1));
    expect(s.sparklines[0].items[0]).toMatchObject({ row: 0, col: 5, data: 'C1:E1' });
    wb.edit('Delete', () => s.deleteCols(5, 1));
    expect(s.sparklines).toEqual([]);
  });

  it('keeps sparklines in .xlsx as Excel\'s own', async () => {
    const wb = book({ B1: '1', C1: '-2', D1: '3', B2: '4', C2: '5', D2: '6' });
    const s = wb.sheet;
    const g = { ...(makeSparklines('column', R('B1:D2'), R('E1:E2')) as SparklineGroup), negative: true, high: true, axis: true, minAxis: 'group' as const, maxAxis: 10, empty: 'span' as const };
    wb.edit('Sparkline', () => s.setSparklines([g]));
    const { text, back } = await roundTrip(wb);
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}"');
    expect(sheet).toContain('type="column"');
    expect(sheet).toContain('<xm:f>Sheet1!B1:D1</xm:f><xm:sqref>E1</xm:sqref>');
    expect(sheet).toContain('minAxisType="group" maxAxisType="custom" manualMax="10"');
    const bg = back.sheet.sparklines[0];
    expect(bg).toMatchObject({ kind: 'column', negative: true, high: true, axis: true, minAxis: 'group', maxAxis: 10, empty: 'span', color: g.color });
    expect(bg.items).toEqual([{ row: 0, col: 4, data: 'B1:D1' }, { row: 1, col: 4, data: 'B2:D2' }]);
  });
});

describe('views and themes', () => {
  it('keeps each sheet\'s view settings in .xlsx', async () => {
    const wb = book({ A1: '1' });
    wb.edit('View', () => wb.sheet.setViewOpts({ layout: 'pageBreakPreview', gridlines: false, headings: false, zoom: 80 }));
    const { text, back } = await roundTrip(wb);
    expect(text('xl/worksheets/sheet1.xml')).toMatch(/<sheetView showGridLines="0" showRowColHeaders="0" view="pageBreakPreview" zoomScale="80"/);
    expect(back.sheet.viewOpts).toEqual({ layout: 'pageBreakPreview', gridlines: false, headings: false, zoom: 80 });
  });

  it('saves and shows custom views', async () => {
    const wb = book({ A1: '1', A2: '2', A3: '3' });
    wb.addSheet('Notes');
    wb.edit('Hide', () => { wb.sheet.setRowHidden(1, true); wb.sheet.setViewOpts({ gridlines: false }); });
    const cv = captureView(wb, 'Summary', { printSettings: true, hiddenAndFilters: true, active: () => [2, 0] });
    wb.edit('Add view', () => wb.setCustomViews([cv]));
    wb.edit('Show all', () => { wb.sheet.setRowHidden(1, false); wb.sheet.setViewOpts(null); });
    const got = wb.edit('Show view', () => applyView(wb, cv));
    expect(got.sheet).toBe(wb.sheets[0]);
    expect(wb.sheet.hiddenRows.has(1)).toBe(true);
    expect(wb.sheet.viewOpts).toEqual({ gridlines: false });
    // renaming a sheet renames it in the views
    wb.edit('Rename', () => wb.sheets[0].rename('Data'));
    expect(wb.customViews[0].sheets[0].sheet).toBe('Data');
    const { text, back } = await roundTrip(wb);
    expect(text('xl/workbook.xml')).toContain(`<customWorkbookView name="Summary" guid="${cv.guid}"`);
    expect(text('xl/worksheets/sheet1.xml')).toContain(`<customSheetView guid="${cv.guid}" showGridLines="0" hiddenRows="1">`);
    expect(back.customViews[0]).toMatchObject({ name: 'Summary', activeSheet: 'Data', hiddenAndFilters: true });
    expect(back.customViews[0].sheets[0].hiddenRows).toEqual([1]);
  });

  it('keeps the workbook theme, and the theme\'s fonts and colours', async () => {
    expect(themePalette(DEFAULT_THEME)).toHaveLength(10);
    expect(themePalette(DEFAULT_THEME)[4].colours[0]).toBe('#4472c4');
    const lab = WORKBOOK_THEMES.find((t) => t.name === 'Lab Notebook')!;
    const mixed = mixTheme(DEFAULT_THEME, lab, null);
    expect(mixed).toMatchObject({ colors: lab.colors, minor: 'Calibri', name: 'Office (custom)' });
    const wb = book({ A1: 'x' });
    wb.edit('Theme', () => wb.setTheme(lab));
    const { text, back } = await roundTrip(wb);
    expect(text('xl/theme/theme1.xml')).toContain('<a:latin typeface="IBM Plex Sans"/>');
    expect(text('xl/styles.xml')).toContain('<name val="IBM Plex Sans"/><family val="2"/><scheme val="minor"/>');
    expect(back.theme).toEqual(lab);
    expect(back.sheet.styleAt(0, 0)?.font).toBeUndefined();
    // a workbook in Excel's default theme says nothing about it
    const plain = await roundTrip(book({ A1: 'x' }));
    expect(plain.text('xl/theme/theme1.xml')).toBe('');
    expect(plain.back.theme).toBeNull();
    wb.undo();
    expect(wb.theme).toBeNull();
  });
});
