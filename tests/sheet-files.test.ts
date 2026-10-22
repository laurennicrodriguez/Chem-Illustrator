// Sheet files and the clipboard: CSV and tab-separated text, SD files, how a file's text is
// decoded, telling an Excel file from other zips, and the HTML Windows puts on the clipboard.

import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseDelimited, detectSeparator, toDelimited } from '../src/sheet/csv';
import { bookFromText, csvText, decodeText, safeSheetName, parseSdf, readSdf, sdfText, molblockContents } from '../src/io/sheet-files';
import { zipHas } from '../src/io/ooxml';
import { cfHtml, fromCfHtml } from '../src/io/clipboard';
import { generalFitting } from '../src/sheet/numfmt';
import { Workbook } from '../src/sheet/workbook';
import { ACS_1996 } from '../src/style';

/** A V2000 molfile from atoms (symbol, x, y) and bonds (from, to, order), numbered from 1. */
function molfile(title: string, atoms: [string, number, number][], bonds: [number, number, number][]): string {
  const n = (v: number, w: number) => String(v).padStart(w);
  const f = (v: number) => v.toFixed(4).padStart(10);
  return [
    title, '  test', '',
    `${n(atoms.length, 3)}${n(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`,
    ...atoms.map(([el, x, y]) => `${f(x)}${f(y)}${f(0)} ${el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`),
    ...bonds.map(([a, b, o]) => `${n(a, 3)}${n(b, 3)}${n(o, 3)}  0`),
    'M  END',
  ].join('\n');
}

const ETHANOL = molfile('ethanol', [['C', 0, 0], ['C', 1.299, 0.75], ['O', 2.598, 0]], [[1, 2, 1], [2, 3, 1]]);
const ACETONE = molfile('acetone', [['C', 0, 0], ['C', 1.299, 0.75], ['C', 2.598, 0], ['O', 1.299, 2.25]], [[1, 2, 1], [2, 3, 1], [2, 4, 2]]);

describe('CSV and tab-separated text', () => {
  it('reads fields with quotes, separators and line breaks in them', () => {
    const text = '﻿Name,Note,Mass\r\n"Smith, J.","He said ""yes""",12.5\r\n"two\nlines",,3\r\n';
    expect(parseDelimited(text, ',')).toEqual([
      ['Name', 'Note', 'Mass'],
      ['Smith, J.', 'He said "yes"', '12.5'],
      ['two\nlines', '', '3'],
    ]);
  });

  it('works out the separator', () => {
    expect(detectSeparator('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectSeparator('a;b;c\n1,5;2,5;3')).toBe(';');
    expect(detectSeparator('a,b,c\n"x;y",2,3')).toBe(',');
  });

  it('writes what it reads, quoting only where needed', () => {
    const rows = [['a', 'b,c', 'd"e'], ['', ' padded ', 'line\nbreak']];
    const text = toDelimited(rows, ',');
    expect(text).toBe('a,"b,c","d""e"\r\n," padded ","line\nbreak"\r\n');
    expect(parseDelimited(text, ',')).toEqual(rows);
    expect(toDelimited([['x', 'y z']], '\t')).toBe('x\ty z\r\n');
  });

  it('opens as a sheet with numbers as numbers, and saves what each cell shows', () => {
    const wb = bookFromText('Compound,Yield,Mass\nA,85%,12.50\nB,0.5,=C2*2\n', 'My results');
    const s = wb.sheet;
    expect(s.name).toBe('My results');
    expect(s.value(1, 1)).toBeCloseTo(0.85);
    expect(s.value(1, 2)).toBe(12.5);
    expect(s.value(2, 2)).toBe(25);
    // opening a file is not something to undo
    expect(wb.undo()).toBeNull();
    expect(wb.edits).toBe(0);
    expect(csvText(s)).toBe('Compound,Yield,Mass\r\nA,85%,12.5\r\nB,0.5,25\r\n');
  });

  it('decodes UTF-8, UTF-16 and older Windows text', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe('café');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x63, 0, 0xe9, 0]))).toBe('cé');
    // é as one byte, as Excel saves "CSV" on Western European Windows
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0xb0]))).toBe('café°');
  });

  it('keeps sheet names to Excel’s rules', () => {
    expect(safeSheetName('Results [batch 2]: final?')).toBe('Results _batch 2__ final_');
    expect(safeSheetName('A very long name that goes on and on')).toHaveLength(31);
    expect(safeSheetName('')).toBe('Sheet1');
  });
});

describe('SD files', () => {
  const sdf = `${ETHANOL}\n> <Yield>\n85%\n\n> <Notes>\nfirst line\nsecond line\n\n$$$$\n${ACETONE}\n> <Yield>\n0.62\n\n$$$$\n`;

  it('reads each record: its molfile, title and data', () => {
    const recs = parseSdf(sdf.replace(/\n/g, '\r\n'));
    expect(recs).toHaveLength(2);
    expect(recs[0].title).toBe('ethanol');
    expect(recs[0].molblock.endsWith('M  END')).toBe(true);
    expect(recs[0].data).toEqual([['Yield', '85%'], ['Notes', 'first line\nsecond line']]);
    expect(recs[1].data).toEqual([['Yield', '0.62']]);
  });

  it('keeps a first record whose title line is empty', () => {
    const blank = (m: string) => '\n' + m.split('\n').slice(1).join('\n');
    const recs = parseSdf(`${blank(ETHANOL)}\n$$$$\n${blank(ACETONE)}\n$$$$\n`);
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.molblock.split('\n').length)).toEqual([ETHANOL.split('\n').length, ACETONE.split('\n').length]);
    expect(recs[0].title).toBe('');
  });

  it('opens as a sheet: structures, names, and a column for each data item', () => {
    const { book, warnings } = readSdf(sdf, 'compounds');
    const s = book.sheet;
    expect(warnings).toEqual([]);
    expect([0, 1, 2, 3].map((c) => s.value(0, c))).toEqual(['Structure', 'Name', 'Yield', 'Notes']);
    expect(s.cell(1, 0)?.structure?.contents.atoms).toHaveLength(3);
    expect(s.cell(2, 0)?.structure?.contents.atoms).toHaveLength(4);
    expect(s.value(1, 1)).toBe('ethanol');
    expect(s.value(1, 2)).toBeCloseTo(0.85);
    expect(s.value(1, 3)).toBe('first line\nsecond line');
    expect(s.styleAt(0, 0)?.bold).toBe(true);
    expect(book.undo()).toBeNull();
  });

  it('saves what it opened', () => {
    const { book } = readSdf(sdf, 'compounds');
    const back = parseSdf(sdfText(book.sheet, book.drawingStyle));
    expect(back.map((r) => r.title)).toEqual(['ethanol', 'acetone']);
    expect(back[0].data).toEqual([['Yield', '85%'], ['Notes', 'first line\nsecond line']]);
    expect(back[1].data).toEqual([['Yield', '0.62']]);
    // the same atoms and bonds
    const counts = (mb: string) => mb.split('\n')[3].slice(0, 6);
    expect(counts(back[0].molblock)).toBe('  3  2');
    expect(counts(back[1].molblock)).toBe('  4  3');
    expect(back[1].molblock).toMatch(/^\s+\d+\s+\d+\s+2\s/m);
  });

  it('says how many structures it could not read', () => {
    const v3000 = 'x\n  test\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 1 0 0 0 0\nM  END';
    const { book, warnings } = readSdf(`${v3000}\n$$$$\n${ETHANOL}\n$$$$\n`, 'mixed');
    expect(warnings[0]).toMatch(/^1 structure could not be read/);
    expect(book.sheet.cell(2, 0)?.structure).toBeTruthy();
  });

  it('needs a structure to save as an SD file', () => {
    const wb = new Workbook();
    wb.edit('Type', () => wb.sheet.setInput(0, 0, 'no structures'));
    expect(() => sdfText(wb.sheet, ACS_1996)).toThrow(/no structures/);
  });

  it('draws a molfile in the drawing style', () => {
    const c = molblockContents(ACETONE, ACS_1996)!;
    const o = c.atoms.find((a) => a.z === 8)!;
    const mid = c.atoms.find((a) => c.bonds.filter((b) => b.a1 === a.id || b.a2 === a.id).length === 3)!;
    expect(Math.hypot(o.x - mid.x, o.y - mid.y)).toBeCloseTo(ACS_1996.bondLength, 1);
    expect(molblockContents('not a molfile', ACS_1996)).toBeNull();
  });
});

describe('telling an Excel file from other zips', () => {
  it('looks for the workbook in the zip’s list of contents', () => {
    const xlsx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8('<workbook/>') });
    const pptx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'ppt/presentation.xml': strToU8('<p/>') });
    expect(zipHas(xlsx, 'xl/workbook.xml')).toBe(true);
    expect(zipHas(pptx, 'xl/workbook.xml')).toBe(false);
    expect(zipHas(pptx, 'ppt/presentation.xml')).toBe(true);
  });
});

describe('HTML on the Windows clipboard', () => {
  it('gives the byte offsets of the page and the copied part', () => {
    const fragment = '<table><tr><td>µg</td><td x:num="1.5">1.5</td></tr></table>';
    const bytes = cfHtml(fragment);
    const text = new TextDecoder().decode(bytes);
    const at = (name: string) => Number(new RegExp(`${name}:(\\d{10})`).exec(text)![1]);
    const dec = (a: number, b: number) => new TextDecoder().decode(bytes.subarray(a, b));
    expect(dec(at('StartFragment'), at('EndFragment'))).toBe(fragment);
    expect(at('EndHTML')).toBe(bytes.length);
    expect(dec(at('StartHTML'), at('StartHTML') + 6)).toBe('<html>');
    expect(fromCfHtml(bytes)).toContain(fragment);
    expect(fromCfHtml(bytes).startsWith('<html>')).toBe(true);
  });
});

describe('numbers too wide for their column', () => {
  const upTo = (n: number) => (t: string) => t.length <= n;
  it('lose decimals first, as in Excel', () => {
    expect(generalFitting(128.73724213930402, upTo(20))).toBe('128.7372421');
    expect(generalFitting(128.73724213930402, upTo(8))).toBe('128.7372');
    expect(generalFitting(128.73724213930402, upTo(3))).toBe('129');
  });
  it('then go to powers of ten', () => {
    expect(generalFitting(0.000012345, upTo(7))).toBe('1.2E-05');
    expect(generalFitting(123456789, upTo(7))).toBe('1.2E+08');
    expect(generalFitting(123456789, upTo(2))).toBeNull();
    // too narrow for a power of ten: one figure is better than nothing
    expect(generalFitting(0.0456, upTo(4))).toBe('0.05');
  });
});

describe('opening text files that start like a zip', () => {
  it('opens a CSV whose first column is PK', async () => {
    const deps = { pictures: undefined as never, settled: async () => {} } as never;
    const { readSheetFile } = await import('../src/io/sheet-files');
    const { book } = await readSheetFile(new TextEncoder().encode('PK,Dose,Conc\n1,5,0.2\n'), 'pk.csv', deps);
    expect(book.sheets[0].cell(0, 0)?.input).toBe('PK');
  });
});
