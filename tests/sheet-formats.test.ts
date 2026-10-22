// @vitest-environment jsdom
//
// Opening other spreadsheet formats: old Excel workbooks (.xls, BIFF8), OpenDocument
// spreadsheets (.ods), and macro-enabled workbooks (.xlsm), whose VBA project is kept byte for
// byte (and never run). The .xls and .ods files were made by LibreOffice from one .xlsx.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

/** Text as bytes fflate takes as a file (strToU8's own array can come from another realm under jsdom). */
const u8 = (s: string) => Uint8Array.from(strToU8(s));
import { Workbook } from '../src/sheet/workbook';
import { readXls, isXls } from '../src/io/xls';
import { readOds, isOds, excelFromOpenFormula, lengthPx } from '../src/io/ods';
import { readSheetFile, writeSheetFile } from '../src/io/sheet-files';
import { writeXlsx, XlsxPictures } from '../src/io/xlsx';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const deps = { ...pictures, settled: async () => {} };
const fixture = (name: string) => new Uint8Array(readFileSync(`${process.cwd()}/tests/fixtures/${name}`));

/** What both files hold (see the header). */
function checkReagents(book: Workbook): void {
  expect(book.sheets.map((s) => s.name)).toEqual(['Data', 'Other']);
  book.recalc();
  const s = book.sheets[0];
  expect(s.cell(0, 0)?.input).toBe('Reagent');
  expect(s.cell(0, 0)?.style?.bold).toBe(true);
  expect(s.cell(1, 1)?.input).toBe('106.12');
  expect(s.cell(4, 0)?.input).toBe('Ünïcode é');
  expect(s.cell(1, 3)?.input).toBe('=B2*C2');
  expect(s.cell(4, 3)?.input).toBe('=B5*C5');
  expect(s.cell(6, 3)?.input).toBe('=SUM(D2:D5)');
  expect(s.value(6, 3)).toBeCloseTo(106.12 + 58.08 * 1.5 + 39.997 * 0.2 + 36, 6);
  expect(s.shownText(7, 1)).toBe('2024-03-01');
  expect(s.value(8, 1)).toBe(true);
  expect(s.cell(9, 1)?.input).toBe('=Other!A1*2');
  expect(s.value(9, 1)).toBe(42);
  expect(s.value(9, 2)).toBe('yes');
  expect(s.cell(9, 3)?.input).toBe('=ROUND(AVERAGE(B2:B5),2)');
  expect(s.shownText(10, 1)).toBe('25%');
  expect(s.merges).toEqual([{ r1: 11, c1: 0, r2: 11, c2: 2 }]);
  expect(s.colWidths.get(0)).toBeGreaterThan(120);
  expect(book.sheets[1].cell(0, 1)?.input).toBe('=VLOOKUP("Acetone",Data!A2:B5,2,FALSE)');
  expect(book.sheets[1].value(0, 1)).toBe(58.08);
}

describe('old Excel workbooks (.xls)', () => {
  it('opens cells, formulas, formats, merges and widths', () => {
    const bytes = fixture('reagents.xls');
    expect(isXls(bytes)).toBe(true);
    const { book, warnings } = readXls(bytes);
    checkReagents(book);
    expect(warnings.some((w) => /save as \.xlsx/.test(w))).toBe(true);
  });

  it('reads formulas filled down (shared formulas) for each cell', () => {
    const { book, warnings } = readXls(fixture('filled-down.xls'));
    book.recalc();
    const s = book.sheet;
    expect(s.cell(0, 2)?.input).toBe('=A1*B1+$A$1');
    expect(s.cell(39, 2)?.input).toBe('=A40*B40+$A$1');
    expect(s.value(39, 2)).toBe(40 * 20 + 1);
    expect(warnings.some((w) => /could not be read/.test(w))).toBe(false);
  });

  it('opens through the sheet files, and is not mistaken for other files', async () => {
    const { book } = await readSheetFile(fixture('reagents.xls'), 'reagents.xls', deps);
    expect(book.sheets[0].cell(0, 0)?.input).toBe('Reagent');
    expect(isXls(fixture('reagents.ods'))).toBe(false);
  });
});

describe('OpenDocument spreadsheets (.ods)', () => {
  it('opens cells, formulas, formats, merges and widths', () => {
    const bytes = fixture('reagents.ods');
    expect(isOds(bytes)).toBe(true);
    checkReagents(readOds(bytes).book);
  });

  it('turns OpenFormula into Excel formulas', () => {
    expect(excelFromOpenFormula('of:=SUM([.A1:.B3];[$Sheet2.$C$1])')).toBe('=SUM(A1:B3,Sheet2!$C$1)');
    expect(excelFromOpenFormula("of:=['My data'.A1]&\"a;[b]\"")).toBe("='My data'!A1&\"a;[b]\"");
    expect(excelFromOpenFormula('of:=COM.MICROSOFT.IFS([.A1]>1;1;1;2)')).toBe('=IFS(A1>1,1,1,2)');
    expect(lengthPx('1in')).toBe(96);
    expect(lengthPx('2.54cm')).toBe(96);
  });
});

describe('macro-enabled workbooks (.xlsm)', () => {
  /** An .xlsm as Excel writes one: the workbook's macro type, and a VBA project related to it. */
  async function xlsm(): Promise<{ bytes: Uint8Array; vba: Uint8Array }> {
    const wb = new Workbook(['Sheet1']);
    wb.build(() => wb.sheet.setInput(0, 0, '5'));
    const files = unzipSync(await writeXlsx(wb, pictures));
    const vba = new Uint8Array(600).map((_, i) => (i * 7) % 256);
    files['xl/vbaProject.bin'] = vba;
    files['[Content_Types].xml'] = u8(strFromU8(files['[Content_Types].xml'])
      .replace('spreadsheetml.sheet.main+xml', 'XXX').replace('application/vnd.openxmlformats-officedocument.XXX', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml')
      .replace('</Types>', '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'));
    files['xl/_rels/workbook.xml.rels'] = u8(strFromU8(files['xl/_rels/workbook.xml.rels'])
      .replace('</Relationships>', '<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'));
    files['xl/workbook.xml'] = u8(strFromU8(files['xl/workbook.xml']).replace('<workbookPr/>', '<workbookPr codeName="ThisWorkbook"/>'));
    files['xl/worksheets/sheet1.xml'] = u8(strFromU8(files['xl/worksheets/sheet1.xml']).replace('<dimension', '<sheetPr codeName="Sheet1"/><dimension'));
    return { bytes: zipSync(files), vba };
  }

  it('keeps the VBA project byte for byte when saved as .xlsm', async () => {
    const { bytes, vba } = await xlsm();
    const { book, warnings } = await readSheetFile(bytes, 'macros.xlsm', deps);
    expect(book.macros?.project).toEqual(vba);
    expect(book.macros?.codeName).toBe('ThisWorkbook');
    expect(warnings[0]).toMatch(/never run/);
    const out = unzipSync(await writeSheetFile(book, 'macros.xlsm', deps) as Uint8Array);
    expect(out['xl/vbaProject.bin']).toEqual(vba);
    const types = strFromU8(out['[Content_Types].xml']);
    expect(types).toContain('application/vnd.ms-excel.sheet.macroEnabled.main+xml');
    expect(types).toContain('/xl/vbaProject.bin');
    expect(strFromU8(out['xl/_rels/workbook.xml.rels'])).toContain('relationships/vbaProject');
    expect(strFromU8(out['xl/workbook.xml'])).toContain('codeName="ThisWorkbook"');
    expect(strFromU8(out['xl/worksheets/sheet1.xml'])).toContain('<sheetPr codeName="Sheet1"');
    // and opened again, the macros are still there
    const again = await readSheetFile(await writeSheetFile(book, 'macros.xlsm', deps) as Uint8Array, 'macros.xlsm', deps);
    expect(again.book.macros?.project).toEqual(vba);
  });

  it('leaves the macros out of an .xlsx', async () => {
    const { bytes } = await xlsm();
    const { book } = await readSheetFile(bytes, 'macros.xlsm', deps);
    const out = unzipSync(await writeSheetFile(book, 'plain.xlsx', deps) as Uint8Array);
    expect(out['xl/vbaProject.bin']).toBeUndefined();
    expect(strFromU8(out['[Content_Types].xml'])).not.toContain('macroEnabled');
  });
});
