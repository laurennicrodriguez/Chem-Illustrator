// @vitest-environment jsdom
//
// File fixes from the code review: characters XML can't hold in CDXML captions, Excel's newer
// function names and _xHHHH_ escapes in .xlsx, and tabs kept in PowerPoint tags.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { readXlsx, writeXlsx, excelFunctionNames, type XlsxPictures } from '../src/io/xlsx';
import { Workbook } from '../src/sheet/workbook';
import { xmlAttr } from '../src/io/ooxml';

const pictures: XlsxPictures = { box: () => ({ w: 1, h: 1 }), picture: async () => null };
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const enc = (x: string) => Uint8Array.from(Buffer.from(x, 'utf8'));

function xlsx(strings: string, cells: string): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${H}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `${H}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings}</sst>`,
    'xl/worksheets/sheet1.xml': `${H}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`,
  }).map(([k, v]) => [k, enc(v)])));
}

describe('CDXML', () => {
  it('saves captions holding characters XML can\'t, so the file opens again', () => {
    const doc = new Doc();
    doc.edit('x', () => { doc.addCaption({ x: 0, y: 0, runs: [{ text: 'first\u000Bsecond\u0002' }], justify: 'left' }); });
    const text = writeCdxml(doc);
    const back = readCdxml(text).doc;
    expect([...back.captions.values()].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['first\nsecond']);
  });
});

describe('Excel files', () => {
  it('puts the _xlfn. prefix back on newer functions', async () => {
    const { book } = await readXlsx(xlsx('', '<c r="B1"><f>_xlfn.STDEV.S(C1:C3)+_xlfn.CONCAT("a","b")</f><v>1</v></c>'));
    expect(book.sheet.cell(0, 1)?.input).toBe('=STDEV.S(C1:C3)+CONCAT("a","b")');
    const out = strFromU8(unzipSync(await writeXlsx(book, pictures))['xl/worksheets/sheet1.xml']);
    expect(out).toContain('<f>_xlfn.STDEV.S(C1:C3)+_xlfn.CONCAT(&quot;a&quot;,&quot;b&quot;)</f>');
    expect(excelFunctionNames('SUM(A1)+FILTER(A1:A3,B1:B3)&"STDEV.S(x)"')).toBe('SUM(A1)+_xlfn._xlws.FILTER(A1:A3,B1:B3)&"STDEV.S(x)"');
  });

  it('reads and writes Excel\'s _xHHHH_ escapes', async () => {
    const { book } = await readXlsx(xlsx('<si><t>line1_x000D_\nline2</t></si>', '<c r="A1" t="s"><v>0</v></c>'));
    expect(book.sheet.cell(0, 0)?.input).toBe('line1\r\nline2');
    const wb = new Workbook(['S']);
    wb.build(() => wb.sheet.setCell(0, 0, { input: 'file_x0041_name' }));
    const written = strFromU8(unzipSync(await writeXlsx(wb, pictures))['xl/sharedStrings.xml']);
    expect(written).toContain('file_x005F_x0041_name');
    expect((await readXlsx(await writeXlsx(wb, pictures))).book.sheet.cell(0, 0)?.input).toBe('file_x0041_name');
  });
});

describe('PowerPoint tags', () => {
  it('keeps tabs and line breaks in attribute values', () => {
    const p = new DOMParser().parseFromString(`<a v="${xmlAttr('one\ntwo\tthree')}"/>`, 'application/xml');
    expect(p.documentElement.getAttribute('v')).toBe('one\ntwo\tthree');
  });
});

describe('pictures used more than once', () => {
  it('are stored once in a .pptx or .docx', async () => {
    const { MediaFiles } = await import('../src/io/ooxml');
    const m = new MediaFiles();
    const a = new Uint8Array([1, 2, 3, 4]), same = new Uint8Array([1, 2, 3, 4]), other = new Uint8Array([1, 2, 3, 5]);
    expect(m.find(a, 'png')).toBeNull();
    m.note(a, 'png', 'media/image1.png');
    expect(m.find(same, 'png')).toBe('media/image1.png');
    expect(m.find(other, 'png')).toBeNull();
    expect(m.find(same, 'jpeg')).toBeNull();
  });
});
