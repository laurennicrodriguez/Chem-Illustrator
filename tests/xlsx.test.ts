// @vitest-environment jsdom
//
// Excel files: what Excel can show for itself (values, its own formulas, formatting, sizes,
// merged cells, frozen rows, the filter) is written as Excel writes it, and comes back; structures
// go in as pictures with their SMILES in the cell, property columns and chemistry formulas as
// their values; and the hidden part brings all of it back, except where Excel changed a cell.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeXlsx, readXlsx, usesChemistry, applyTint, XlsxPictures } from '../src/io/xlsx';
import { Workbook, Structure } from '../src/sheet/workbook';
import { SheetChem } from '../src/sheet/sheet-chem';
import { structureMolfile } from '../src/sheet/structure-doc';
import { molblockContents } from '../src/io/sheet-files';
import { molProps, substructureMatches } from '../src/chem/props';
import { CellError } from '../src/sheet/values';
import { ACS_1996 } from '../src/style';
import { Package, REL } from '../src/io/ooxml';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

/** A white dot: a real PNG, for programs that look inside. */
const DOT = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));

/** Pictures stand-in: every structure 60 × 40 points; the cells pictures were asked for are noted. */
const asked: { w: number; h: number; fill?: string }[] = [];
const pictures: XlsxPictures = {
  box: () => ({ w: 60, h: 40 }),
  async picture(_s: Structure, _style, cell) {
    asked.push(cell);
    return DOT;
  },
};

function chemBook(names?: string[]): Workbook {
  const wb = new Workbook(names);
  const chem = new SheetChem(
    {
      ready: true,
      props: async (mols) => mols.map((m) => molProps(RDKit, m)),
      substructure: async (q, mols) => substructureMatches(RDKit, q, mols),
    },
    (c) => structureMolfile(c, ACS_1996),
  );
  wb.chem = chem;
  chem.onAnswers = () => wb.recalc();
  return wb;
}

async function settle(wb: Workbook) {
  wb.recalc();
  await (wb.chem as SheetChem).settled();
  wb.recalc();
}

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
const ETHANOL = molblockContents(molfile('ethanol', [['C', 0, 0], ['C', 1.299, 0.75], ['O', 2.598, 0]], [[1, 2, 1], [2, 3, 1]]), ACS_1996)!;
const ACETONE = molblockContents(molfile('acetone', [['C', 0, 0], ['C', 1.299, 0.75], ['C', 2.598, 0], ['O', 1.299, 2.25]], [[1, 2, 1], [2, 3, 1], [2, 4, 2]]), ACS_1996)!;

const parts = (bytes: Uint8Array) => unzipSync(bytes);
const part = (bytes: Uint8Array, name: string) => strFromU8(parts(bytes)[name]);
const xmlOf = (text: string) => new DOMParser().parseFromString(text, 'application/xml');

/** A file made the way Excel writes it, with its own parts. */
function excelFile(sheet: string, extra: { styles?: string; strings?: string[]; theme?: string; workbook?: string } = {}): Uint8Array {
  const pkg = new Package();
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  pkg.relate('', REL.officeDocument, 'xl/workbook.xml');
  pkg.add('xl/workbook.xml', extra.workbook ?? `<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
  pkg.relate('xl/workbook.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml');
  pkg.add('xl/worksheets/sheet1.xml', `<worksheet xmlns="${MAIN}" xmlns:r="${R}">${sheet}</worksheet>`);
  if (extra.styles) {
    pkg.relate('xl/workbook.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', 'styles.xml');
    pkg.add('xl/styles.xml', `<styleSheet xmlns="${MAIN}">${extra.styles}</styleSheet>`);
  }
  if (extra.strings) {
    pkg.relate('xl/workbook.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings', 'sharedStrings.xml');
    pkg.add('xl/sharedStrings.xml', `<sst xmlns="${MAIN}">${extra.strings.join('')}</sst>`);
  }
  if (extra.theme) {
    pkg.relate('xl/workbook.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', 'theme/theme1.xml');
    pkg.add('xl/theme/theme1.xml', extra.theme);
  }
  return pkg.build();
}

/** Change a part of a zip. */
function patch(bytes: Uint8Array, name: string, fn: (text: string) => string): Uint8Array {
  const files = parts(bytes);
  files[name] = strToU8(fn(strFromU8(files[name])));
  // the zip library tells files from folders by their type: bytes from another window are copied into this one's
  for (const k of Object.keys(files)) files[k] = new Uint8Array(files[k]);
  return zipSync(files);
}

describe('saving for Excel', () => {
  it('writes values, formulas, formatting and sizes as Excel does, and reads them back', async () => {
    const wb = new Workbook(['Results', 'Notes 2']);
    const s = wb.sheets[0];
    wb.edit('Type', () => {
      s.setInput(0, 0, 'Compound');
      s.setInput(0, 1, 'Yield');
      s.setInput(0, 2, 'Mass (mg)');
      s.setInput(1, 0, "'007");
      s.setInput(1, 1, '85%');
      s.setInput(1, 2, '12.5');
      s.setInput(2, 0, "'0.5");
      s.setInput(2, 1, '0.62');
      s.setInput(2, 2, '=C2*2');
      s.setInput(3, 2, '=SUM(C2:C3)');
      s.setInput(4, 2, '=1/0');
      s.setInput(4, 0, 'TRUE');
      s.setInput(5, 0, 'two\nlines');
      s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 2 }, { bold: true, fill: '#dde8f0' });
      s.setBorders({ r1: 0, c1: 0, r2: 0, c2: 2 }, 'thick-bottom');
      s.patchStyle({ r1: 1, c1: 2, r2: 3, c2: 2 }, { numFmt: '0.00', align: 'center' });
      s.patchStyle({ r1: 5, c1: 0, r2: 5, c2: 0 }, { wrap: true, valign: 'top', italic: true, color: '#c00000' });
      s.setColWidth(0, 120);
      s.setRowHeight(6, 33);
      s.setInput(7, 0, 'Merged');
      s.merge({ r1: 7, c1: 0, r2: 8, c2: 1 });
      s.setFrozen(1, 0);
      wb.sheets[1].setInput(0, 0, 'see Results');
      wb.sheets[1].setInput(1, 0, "='Results'!C2+1");
    });
    wb.active = 1;
    const bytes = await writeXlsx(wb, pictures);

    // every part is XML a reader takes
    for (const [name, data] of Object.entries(parts(bytes))) {
      if (!/\.(xml|rels)$/.test(name)) continue;
      expect(xmlOf(strFromU8(data)).getElementsByTagName('parsererror').length, name).toBe(0);
    }
    const sheet1 = part(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet1).toContain('<c r="C3" s="');
    expect(sheet1).toMatch(/<c r="C3" s="\d+"><f>C2\*2<\/f><v>25<\/v><\/c>/);
    expect(sheet1).toMatch(/<c r="C5"[^>]* t="e"><f>1\/0<\/f><v>#DIV\/0!<\/v>/);
    expect(sheet1).toMatch(/<c r="A5"[^>]* t="b"><v>1<\/v>/);
    expect(sheet1).toContain('<col min="1" max="1" width="17.140625" customWidth="1"/>');
    expect(sheet1).toContain('<row r="7" ht="24.75" customHeight="1">');
    expect(sheet1).toContain('<mergeCell ref="A8:B9"/>');
    expect(sheet1).toContain('ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"');
    expect(part(bytes, 'xl/workbook.xml')).toContain('<workbookView activeTab="1"/>');
    expect(part(bytes, 'xl/workbook.xml')).toContain('fullCalcOnLoad="1"');
    expect(part(bytes, 'xl/sharedStrings.xml')).toContain('<t xml:space="preserve">two\nlines</t>');

    const { book, warnings } = await readXlsx(bytes);
    expect(warnings).toEqual([]);
    const r = book.sheets[0];
    expect(book.sheets.map((x) => x.name)).toEqual(['Results', 'Notes 2']);
    expect(book.active).toBe(1);
    expect(r.value(1, 0)).toBe('007');
    expect(r.cell(1, 0)?.input).toBe("'007");
    expect(r.value(1, 1)).toBeCloseTo(0.85);
    expect(r.styleAt(1, 1)?.numFmt).toBe('0%');
    expect(r.value(2, 0)).toBe('0.5');
    expect(r.cell(2, 2)?.input).toBe('=C2*2');
    expect(r.value(2, 2)).toBe(25);
    expect(r.value(3, 2)).toBe(37.5);
    expect((r.value(4, 2) as CellError).code).toBe('#DIV/0!');
    expect(r.value(4, 0)).toBe(true);
    expect(r.value(5, 0)).toBe('two\nlines');
    expect(r.styleAt(0, 0)).toMatchObject({ bold: true, fill: '#dde8f0', borders: { bottom: { style: 'medium' } } });
    expect(r.styleAt(2, 2)).toMatchObject({ numFmt: '0.00', align: 'center' });
    expect(r.styleAt(5, 0)).toMatchObject({ wrap: true, valign: 'top', italic: true, color: '#c00000' });
    expect(r.colWidths.get(0)).toBe(120);
    expect(r.rowHeights.get(6)).toBe(33);
    expect(r.merges).toEqual([{ r1: 7, c1: 0, r2: 8, c2: 1 }]);
    expect(r.frozen).toEqual({ rows: 1, cols: 0 });
    expect(book.sheets[1].value(1, 0)).toBe(13.5);
    // opening is not an edit
    expect(book.undo()).toBeNull();
  });

  it('keeps a split window, and frozen columns', async () => {
    const wb = new Workbook(['Split', 'Frozen']);
    wb.edit('Panes', () => {
      wb.sheets[0].setColWidth(0, 100);
      wb.sheets[0].setSplit({ rows: 3, cols: 2 });
      wb.sheets[1].setFrozen(0, 1);
    });
    const bytes = await writeXlsx(wb, pictures);
    // (100 + 64) pixels across and 3 × 20 down, in twentieths of a point
    expect(part(bytes, 'xl/worksheets/sheet1.xml')).toContain('<pane xSplit="2460" ySplit="900" topLeftCell="C4" activePane="bottomRight"/>');
    expect(part(bytes, 'xl/worksheets/sheet2.xml')).toContain('<pane xSplit="1" topLeftCell="B1" activePane="topRight" state="frozen"/>');
    const { book } = await readXlsx(bytes);
    expect(book.sheets[0].split).toEqual({ rows: 3, cols: 2 });
    expect(book.sheets[0].frozen).toEqual({ rows: 0, cols: 0 });
    expect(book.sheets[1].frozen).toEqual({ rows: 0, cols: 1 });
    expect(book.sheets[1].split).toBeNull();
  });

  it('keeps the filter and the rows it hides', async () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      ['Name', 'MW'].forEach((t, c) => s.setInput(0, c, t));
      [['a', '120'], ['b', '480'], ['c', '650']].forEach((row, r) => row.forEach((t, c) => s.setInput(r + 1, c, t)));
    });
    wb.edit('Filter', () => s.setFilter({ range: { r1: 0, c1: 0, r2: 3, c2: 1 }, conditions: { 1: { kind: 'compare', op: '<', value: 500 } } }));
    expect([...s.hiddenRows.keys()]).toEqual([3]);
    const bytes = await writeXlsx(wb, pictures);
    const xml = part(bytes, 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<autoFilter ref="A1:B4"><filterColumn colId="1"><customFilters><customFilter operator="lessThan" val="500"/></customFilters></filterColumn></autoFilter>');
    expect(xml).toContain('<row r="4" hidden="1">');
    expect(part(bytes, 'xl/workbook.xml')).toContain('<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Sheet1!$A$1:$B$4</definedName>');

    const back = (await readXlsx(bytes)).book.sheet;
    expect(back.filter?.conditions[1]).toEqual({ kind: 'compare', op: '<', value: 500 });
    expect([...back.hiddenRows.keys()]).toEqual([3]);
  });
});

describe('structures and chemistry in Excel files', () => {
  async function compounds() {
    const wb = chemBook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      s.setInput(0, 0, 'Structure');
      s.setInput(0, 1, 'MW');
      s.setInput(0, 2, 'Formula');
      s.setInput(0, 3, 'Mass (mg)');
      s.setInput(0, 4, 'mmol');
      s.setInput(0, 5, 'Double');
      s.setStructure(1, 0, ETHANOL);
      s.setStructure(2, 0, ACETONE);
      s.setColDef(1, { formula: '=MW(A2)', firstRow: 1, style: { numFmt: '0.00' } });
      s.setColDef(2, { formula: '=FORMULA(A2)', firstRow: 1, style: { chem: true } });
      s.setInput(1, 3, '46');
      s.setInput(2, 3, '58');
      s.setInput(1, 4, '=D2/MW(A2)*1000');
      s.setInput(1, 5, '=D2*2');
      // a value typed over a calculated one
      s.setInput(2, 1, '60');
      s.setColWidth(0, 150);
    });
    await settle(wb);
    return wb;
  }

  it('gives Excel pictures, SMILES and values', async () => {
    asked.length = 0;
    const wb = await compounds();
    expect(wb.sheet.value(1, 1)).toBeCloseTo(46.07, 2);
    const bytes = await writeXlsx(wb, pictures);
    const xml = part(bytes, 'xl/worksheets/sheet1.xml');
    const strings = part(bytes, 'xl/sharedStrings.xml');
    // the structure's SMILES, in the cell under its picture, with a format that hides it
    expect(strings).toContain('<t>CCO</t>');
    expect(part(bytes, 'xl/styles.xml')).toMatch(/<numFmt numFmtId="\d+" formatCode=";;;"\/>/);
    expect(strings).toContain('<t>CC(C)=O</t>');
    // calculated values and chemistry formulas as numbers; Excel's own formulas as formulas
    expect(xml).toMatch(/<c r="B2" s="\d+"><v>46\.0\d+<\/v><\/c>/);
    expect(xml).toMatch(/<c r="E2"[^>]*><v>998\.\d+<\/v><\/c>/);
    expect(xml).toMatch(/<c r="F2"[^>]*><f>D2\*2<\/f><v>92<\/v><\/c>/);
    // the formula's numbers lowered
    expect(strings).toContain('<r><t>C</t></r><r><rPr><vertAlign val="subscript"/></rPr><t>2</t></r>');
    // pictures over the structure cells, the cells' size
    const drawing = part(bytes, 'xl/drawings/drawing1.xml');
    expect(drawing.match(/<xdr:pic>/g)).toHaveLength(2);
    expect(drawing).toContain('name="Structure A2" descr="CCO"');
    expect(drawing).toMatch(/<xdr:from><xdr:col>0<\/xdr:col><xdr:colOff>9525<\/xdr:colOff><xdr:row>1<\/xdr:row><xdr:rowOff>9525<\/xdr:rowOff><\/xdr:from><xdr:to><xdr:col>0<\/xdr:col><xdr:colOff>1419225<\/xdr:colOff><xdr:row>1<\/xdr:row><xdr:rowOff>447675<\/xdr:rowOff><\/xdr:to>/);
    // rows grew to fit: 40 pt structures and padding
    expect(xml).toContain('<row r="2" ht="36" customHeight="1">');
    expect(asked[0]).toEqual({ w: 148, h: 46, fill: undefined, align: undefined, valign: undefined });
    // the same picture is kept once
    expect(Object.keys(parts(bytes)).filter((n) => n.startsWith('xl/media/'))).toHaveLength(2);
    expect(part(bytes, '[Content_Types].xml')).toContain('<Default Extension="png" ContentType="image/png"/>');
  });

  it('brings everything back from its own file', async () => {
    const wb = await compounds();
    const bytes = await writeXlsx(wb, pictures);
    const { book, warnings } = await readXlsx(bytes);
    expect(warnings).toEqual([]);
    const chem = chemBook();
    book.chem = chem.chem;
    (chem.chem as SheetChem).onAnswers = () => book.recalc();
    await settle(book);
    const s = book.sheet;
    expect(s.cell(1, 0)?.structure?.contents.atoms).toHaveLength(3);
    expect(s.cell(2, 0)?.structure?.contents.atoms).toHaveLength(4);
    // the format that hid the SMILES in Excel is not kept
    expect(s.cell(1, 0)?.style).toBeUndefined();
    expect(s.colDefs.get(1)).toEqual({ formula: '=MW(A2)', firstRow: 1, style: { numFmt: '0.00' } });
    // worked out again, not a value typed in
    expect(s.cell(1, 1)?.input).toBeUndefined();
    expect(s.value(1, 1)).toBeCloseTo(46.07, 2);
    expect(s.isOverride(2, 1)).toBe(true);
    expect(s.value(2, 1)).toBe(60);
    expect(s.value(1, 2)).toBe('C2H6O');
    expect(s.styleAt(1, 2)?.chem).toBe(true);
    expect(s.cell(1, 4)?.input).toBe('=D2/MW(A2)*1000');
    expect(s.value(1, 4)).toBeCloseTo(998.5, 1);
    expect(s.colWidths.get(0)).toBe(150);
    // rows grown to fit their structures keep fitting (Excel was given their heights)
    expect(s.rowHeights.size).toBe(0);
    expect(book.undo()).toBeNull();
  });

  it('keeps what Excel changed', async () => {
    const wb = await compounds();
    const bytes = await writeXlsx(wb, pictures);
    // in Excel: ethanol's SMILES typed over with methanol's, and a calculated MW typed over
    let edited = patch(bytes, 'xl/sharedStrings.xml', (t) => t.replace('<t>CCO</t>', '<t>CO</t>'));
    edited = patch(edited, 'xl/worksheets/sheet1.xml', (t) => t.replace(/(<c r="B2" s="\d+"><v>)[^<]+/, '$1999'));
    const { book, warnings } = await readXlsx(edited);
    const s = book.sheet;
    expect(s.cell(1, 0)?.structure).toBeUndefined();
    expect(s.cell(1, 0)?.input).toBe('CO');
    expect(s.cell(2, 0)?.structure).toBeTruthy();
    expect(s.cell(1, 1)?.input).toBe('999');
    expect(warnings).toEqual(['2 structure or calculated cells were changed in another program: they show what that program saved.']);
  });

  it('reads the hidden part only when it is ours', async () => {
    const wb = await compounds();
    const bytes = patch(await writeXlsx(wb, pictures), 'customXml/item1.xml', (t) => t.replace('&quot;version&quot;:1', '&quot;version&quot;:99'));
    const { book } = await readXlsx(bytes);
    expect(book.sheet.cell(1, 0)?.structure).toBeUndefined();
    expect(book.sheet.value(1, 0)).toBe('CCO');
  });

  it('tells which formulas use chemistry', () => {
    expect(usesChemistry('=D2/MW(B2)*1000')).toBe(true);
    expect(usesChemistry('=hrms(B2,"[M+Na]+")')).toBe(true);
    expect(usesChemistry('=SUM(C2:C9)')).toBe(false);
    expect(usesChemistry('=CONCAT("MW(",A1,")")')).toBe(false);
  });
});

describe('opening files made in Excel', () => {
  it('reads shared formulas, inline text, rows without numbers and column widths', async () => {
    const sheet =
      '<sheetFormatPr defaultRowHeight="15"/><cols><col min="2" max="3" width="20.7109375" customWidth="1"/></cols><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>n</t></is></c><c r="B1" t="s"><v>0</v></c></row>' +
      '<row><c r="A2"><v>1</v></c><c r="B2"><f t="shared" ref="B2:B4" si="0">A2*10</f><v>10</v></c></row>' +
      '<row><c><v>2</v></c><c><f t="shared" si="0"/><v>20</v></c></row>' +
      '<row r="4"><c r="A4"><v>3</v></c><c r="B4"><f t="shared" si="0"/><v>30</v></c><c r="C4"><f>_xlfn.CONCAT("x",A4)</f><v>x3</v></c><c r="D4"><f>_xlfn.RANDARRAY(3)</f><v>1</v></c></row>' +
      '</sheetData>';
    const { book, warnings } = await readXlsx(excelFile(sheet, { strings: ['<si><t>ten times</t></si>'] }));
    const s = book.sheet;
    expect(s.name).toBe('Data');
    expect(s.value(0, 0)).toBe('n');
    expect(s.value(0, 1)).toBe('ten times');
    expect(s.cell(2, 0)?.input).toBe('2');
    expect(s.cell(2, 1)?.input).toBe('=A3*10');
    expect(s.cell(3, 1)?.input).toBe('=A4*10');
    expect(s.value(3, 1)).toBe(30);
    expect(s.cell(3, 2)?.input).toBe('=CONCAT("x",A4)');
    expect(s.value(3, 2)).toBe('x3');
    expect(s.colWidths.get(1)).toBe(145);
    expect(s.colWidths.get(2)).toBe(145);
    // CONCAT is worked out here; RANDARRAY isn't
    expect(warnings).toEqual(['1 formula uses newer Excel functions this program can\'t work out yet.']);
  });

  it('works out theme colours and their tints as Excel does', async () => {
    // Office's blue accent made 80% lighter (its lightness taken 80% of the way to white), and 25% darker;
    // Excel's own colour picker can differ from this by one step in a colour, which no one can see
    expect(applyTint('4472C4', 0.7999816888943144)).toBe('DAE3F3');
    expect(applyTint('4472C4', -0.249977111117893)).toBe('2F5597');
    const theme = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="t">' +
      '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="112233"/></a:accent1>' +
      '</a:clrScheme></a:themeElements></a:theme>';
    const styles = '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color theme="4"/><name val="Arial"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.5"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/></border></borders>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="10" fontId="1" fillId="2" borderId="0"><alignment horizontal="center" vertical="center"/></xf></cellXfs>';
    const { book } = await readXlsx(excelFile('<sheetData><row r="1"><c r="A1" s="1"><v>0.5</v></c></row></sheetData>', { styles, theme }));
    expect(book.sheet.styleAt(0, 0)).toEqual({ bold: true, size: 14, color: '#112233', font: 'Arial', fill: '#' + applyTint('112233', 0.5).toLowerCase(), numFmt: '0.00%', align: 'center', valign: 'middle' });
  });

  it('says what it could not keep', async () => {
    const sheet = '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><conditionalFormatting sqref="A1"><cfRule type="timePeriod" timePeriod="today" priority="1"/></conditionalFormatting>';
    const { warnings } = await readXlsx(excelFile(sheet));
    expect(warnings).toEqual(['Not shown here, and left out if you save over this file: some conditional formatting rules.']);
  });

  it('refuses files that are not workbooks', async () => {
    await expect(readXlsx(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not an Excel workbook/);
  });
});

describe('a file to check in other programs', () => {
  it('is written when asked for', async () => {
    const out = process.env.XLSX_OUT;
    if (!out) return;
    const wb = await (async () => {
      const w = chemBook(['Compounds', 'Plain']);
      const s = w.sheets[0];
      w.edit('Type', () => {
        ['Structure', 'MW', 'Formula', 'HRMS [M+H]+', 'Mass (mg)', 'mmol', 'Total'].forEach((t, c) => s.setInput(0, c, t));
        s.setStructure(1, 0, ETHANOL);
        s.setStructure(2, 0, ACETONE);
        s.setColDef(1, { formula: '=MW(A2)', firstRow: 1, style: { numFmt: '0.00' } });
        s.setColDef(2, { formula: '=FORMULA(A2)', firstRow: 1, style: { chem: true } });
        s.setColDef(3, { formula: '=HRMS(A2)', firstRow: 1, style: { numFmt: '0.0000' } });
        s.setInput(1, 4, '46');
        s.setInput(2, 4, '58');
        s.setInput(1, 5, '=E2/MW(A2)*1000');
        s.setInput(1, 6, '=SUM(E2:E3)');
        s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 6 }, { bold: true, fill: '#e2efda' });
        s.setBorders({ r1: 0, c1: 0, r2: 0, c2: 6 }, 'bottom');
        s.setColWidth(0, 140);
        s.setFrozen(1, 0);
        w.sheets[1].setInput(0, 0, 'Plain sheet');
        w.sheets[1].setInput(1, 0, '=Compounds!E2*2');
      });
      await settle(w);
      return w;
    })();
    writeFileSync(out, await writeXlsx(wb, pictures));
  });
});

describe('links in Excel files', () => {
  it('saves cell links as Excel\'s own and reads them back: web pages, files and places in the workbook', async () => {
    const wb = new Workbook(['Data', 'My runs']);
    const s = wb.sheets[0];
    wb.edit('Type', () => {
      s.setInput(0, 0, 'paper');
      s.setLink(0, 0, 'https://doi.org/10.1021/ja00001');
      s.setInput(1, 0, 'spectrum');
      s.setLink(1, 0, 'spectra/run 4.mnova');
      s.setInput(2, 0, 'runs');
      s.setLink(2, 0, "#'My runs'!B4");
    });
    const bytes = await writeXlsx(wb, pictures);
    const sheet1 = part(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet1).toMatch(/<hyperlinks><hyperlink ref="A1" r:id="rId\d+"\/><hyperlink ref="A2" r:id="rId\d+"\/><hyperlink ref="A3" location="'My runs'!B4" display="runs"\/><\/hyperlinks><pageMargins/);
    const rels = part(bytes, 'xl/worksheets/_rels/sheet1.xml.rels');
    expect(rels).toContain('Target="https://doi.org/10.1021/ja00001" TargetMode="External"');
    expect(rels).toContain('Target="spectra/run%204.mnova" TargetMode="External"');

    const { book, warnings } = await readXlsx(bytes);
    expect(warnings.join(' ')).not.toMatch(/link/i);
    const r = book.sheets[0];
    expect([0, 1, 2].map((i) => r.cell(i, 0)?.link)).toEqual(['https://doi.org/10.1021/ja00001', 'spectra/run 4.mnova', "#'My runs'!B4"]);
    expect(r.value(2, 0)).toBe('runs');
  });

  it('reads a link Excel put on a range of cells onto each of them', async () => {
    const bytes = excelFile('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c></row></sheetData><hyperlinks><hyperlink ref="A1:B1" location="Data!C9"/></hyperlinks>');
    const { book } = await readXlsx(bytes);
    expect([book.sheets[0].cell(0, 0)?.link, book.sheets[0].cell(0, 1)?.link]).toEqual(['#Data!C9', '#Data!C9']);
  });
});
