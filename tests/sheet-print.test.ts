// @vitest-environment jsdom
//
// Sheet mode's page setup (print area, print titles, page breaks, margins, fit to pages, headers
// and footers) and the pictures, shapes and text boxes floating over the cells: pages are cut as
// Excel cuts them, everything moves with inserted rows, and all of it goes to Excel's own parts in
// .xlsx files and comes back.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { paginate, PageSetup, headerRuns, readHeaderFooter, headerFooterText, codesToWords, wordsToCodes, withSetup, toggleBreak } from '../src/sheet/page-setup';
import { SheetObject, shapePath, newObjectId } from '../src/sheet/sheet-objects';
import { readBlock, drawingColour } from '../src/io/xlsx-print';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function roundTrip(wb: Workbook) {
  const bytes = await writeXlsx(wb, pictures);
  return { files: unzipSync(bytes), back: await readXlsx(bytes) };
}

const u8copy = (b: Uint8Array) => { const o = new Uint8Array(b.length); o.set(b); return o; };
const sizes = (colW = 64, rowH = 20) => ({ colW: () => colW, rowH: () => rowH });

describe('pagination', () => {
  it('cuts pages down then across, with titles on every page and manual breaks', () => {
    // letter, 0.7 in side margins: 7.1 in = 511.2 pt = 681.6 px across; 9.5 in = 684 pt = 912 px down
    const used = { r1: 0, c1: 0, r2: 99, c2: 19 };
    const p = paginate(null, sizes(), used);
    expect(p.scale).toBe(1);
    // 10 columns of 64 px to a page across, 45 rows of 20 px down
    expect(p.pages[0]).toMatchObject({ rows: [0, 44], cols: [0, 9] });
    expect(p.pages[1]).toMatchObject({ rows: [45, 89], cols: [0, 9] });
    expect(p.pages[3]).toMatchObject({ rows: [0, 44], cols: [10, 19] });
    expect(p.pages).toHaveLength(6);
    // across then down
    const over = paginate({ order: 'over' }, sizes(), used);
    expect(over.pages[1]).toMatchObject({ rows: [0, 44], cols: [10, 19] });
    // title rows take room on every page; a break by hand starts a page
    const t = paginate({ titleRows: [0, 4], rowBreaks: [20] }, sizes(), used);
    expect(t.pages[0].rows).toEqual([0, 19]);
    expect(t.pages[1].rows).toEqual([20, 59]);
  });

  it('fits to pages wide by shrinking, ignoring manual breaks, and keeps a print area to itself', () => {
    const used = { r1: 0, c1: 0, r2: 99, c2: 19 };
    const p = paginate({ fit: { wide: 1, tall: 0 }, colBreaks: [5] }, sizes(), used);
    expect(new Set(p.pages.map((x) => x.cols.join()))).toEqual(new Set(['0,19']));
    expect(p.scale).toBeLessThan(0.54);
    expect(p.scale).toBeGreaterThan(0.5);
    const one = paginate({ fit: { wide: 1, tall: 1 } }, sizes(), used);
    expect(one.pages).toHaveLength(1);
    // two blocks print on pages of their own
    const areas = paginate({ printArea: [{ r1: 0, c1: 0, r2: 2, c2: 2 }, { r1: 10, c1: 5, r2: 12, c2: 6 }] }, sizes(), used);
    expect(areas.pages.map((x) => [x.rows, x.cols])).toEqual([[[0, 2], [0, 2]], [[10, 12], [5, 6]]]);
    // landscape A4 is wider
    expect(paginate({ paper: 'a4', orientation: 'landscape' }, sizes(), used).paper.w).toBeCloseTo(841.89);
  });
});

describe('headers and footers', () => {
  it('reads and writes Excel\'s three parts and fills in the codes', () => {
    const h = readHeaderFooter('&L&"Arial,Bold"Lab notebook&CPage &P of &N&R&A');
    expect(h).toEqual({ left: '&"Arial,Bold"Lab notebook', center: 'Page &P of &N', right: '&A' });
    expect(headerFooterText(h)).toBe('&L&"Arial,Bold"Lab notebook&CPage &P of &N&R&A');
    const ctx = { page: 2, pages: 5, sheet: 'Yields', file: 'run.xlsx', date: new Date(2026, 9, 22) };
    expect(headerRuns(h!.center, ctx).map((r) => r.text).join('')).toBe('Page 2 of 5');
    expect(headerRuns(h!.right, ctx)[0].text).toBe('Yields');
    const runs = headerRuns(h!.left, ctx);
    expect(runs[0]).toMatchObject({ text: 'Lab notebook', font: 'Arial', bold: true });
    expect(headerRuns('&12&BBig&B small &&', ctx)).toEqual([{ text: 'Big', size: 12, bold: true }, { text: ' small &', size: 12, bold: false }]);
    expect(codesToWords('Page &P of &N, &F')).toBe('Page &[Page] of &[Pages], &[File]');
    expect(wordsToCodes('Page &[Page] of &[Pages], &[File]')).toBe('Page &P of &N, &F');
  });
});

describe('page setup in a sheet', () => {
  it('moves the print area, titles and breaks with inserted and deleted rows, and undoes', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('setup', () => s.setPageSetup({ printArea: [{ r1: 2, c1: 0, r2: 20, c2: 4 }], titleRows: [0, 1], rowBreaks: [10, 15] }));
    wb.edit('insert', () => s.insertRows(5, 3));
    expect(s.pageSetup).toMatchObject({ printArea: [{ r1: 2, c1: 0, r2: 23, c2: 4 }], titleRows: [0, 1], rowBreaks: [13, 18] });
    wb.edit('delete', () => s.deleteRows(13, 1));
    // the row with a break goes, and its break with it
    expect(s.pageSetup!.rowBreaks).toEqual([17]);
    wb.undo(); wb.undo();
    expect(s.pageSetup!.rowBreaks).toEqual([10, 15]);
    expect(withSetup({ gridlines: true }, { gridlines: undefined })).toBeNull();
    expect(toggleBreak([4], 4, false)).toBeUndefined();
    expect(toggleBreak(undefined, 7, true)).toEqual([7]);
  });

  it('goes to Excel\'s page setup and defined names, and comes back', async () => {
    const wb = new Workbook(['Data', 'Other sheet']);
    const s = wb.sheet;
    const ps: PageSetup = {
      paper: 'a4', orientation: 'landscape', margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
      fit: { wide: 1, tall: 0 }, printArea: [{ r1: 0, c1: 0, r2: 30, c2: 6 }, { r1: 40, c1: 0, r2: 45, c2: 2 }],
      titleRows: [0, 0], titleCols: [0, 1], rowBreaks: [12], colBreaks: [4],
      header: { center: '&"Arial,Bold"Screening' }, footer: { left: '&F', right: 'Page &P of &N' },
      differentFirst: true, firstFooter: { center: 'Draft' }, gridlines: true, headings: true, centerH: true, order: 'over',
    };
    wb.edit('fill', () => { s.setInput(0, 0, 'Entry'); s.setInput(1, 0, '1'); s.setPageSetup(ps); });
    const other = wb.sheets[1];
    wb.edit('other', () => { other.setInput(0, 0, 'x'); other.setPageSetup({ scale: 75, firstPage: 3 }); });
    const { files, back } = await roundTrip(wb);
    const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheetXml).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(sheetXml).toContain('<printOptions headings="1" gridLines="1" horizontalCentered="1"/><pageMargins left="0.25"');
    expect(sheetXml).toContain('<pageSetup paperSize="9" fitToWidth="1" fitToHeight="0" pageOrder="overThenDown" orientation="landscape"/>');
    expect(sheetXml).toContain('<headerFooter differentFirst="1"><oddHeader>&amp;C&amp;&quot;Arial,Bold&quot;Screening</oddHeader>');
    expect(sheetXml).toContain('<rowBreaks count="1" manualBreakCount="1"><brk id="12" max="16383" man="1"/></rowBreaks>');
    // the schema's order: … hyperlinks, printOptions, pageMargins, pageSetup, headerFooter, rowBreaks, colBreaks, drawing …
    expect(sheetXml.indexOf('<printOptions')).toBeLessThan(sheetXml.indexOf('<pageSetup '));
    expect(sheetXml.indexOf('<headerFooter')).toBeLessThan(sheetXml.indexOf('<rowBreaks'));
    const book = strFromU8(files['xl/workbook.xml']);
    expect(book).toContain('<definedName name="_xlnm.Print_Area" localSheetId="0">Data!$A$1:$G$31,Data!$A$41:$C$46</definedName>');
    expect(book).toContain('<definedName name="_xlnm.Print_Titles" localSheetId="0">Data!$A:$B,Data!$1:$1</definedName>');
    expect(back.book.sheets[0].pageSetup).toEqual(ps);
    expect(back.book.sheets[1].pageSetup).toEqual({ scale: 75, firstPage: 3 });
    expect(back.warnings.join(' ')).not.toMatch(/named ranges/);
  });

  it('reads blocks and quoted sheet names as Excel writes them', () => {
    expect(readBlock('$B$2:$D$9')).toEqual({ r1: 1, c1: 1, r2: 8, c2: 3 });
    expect(readBlock('$3:$4')).toMatchObject({ r1: 2, r2: 3, c1: 0 });
    expect(readBlock('$C:$C')).toMatchObject({ r1: 0, c1: 2, c2: 2 });
  });
});

describe('pictures, shapes and text boxes', () => {
  const obj = (o: Partial<SheetObject>): SheetObject => ({ id: newObjectId(), kind: 'shape', at: { row: 2, col: 1, dx: 5, dy: 3 }, w: 120, h: 60, ...o });

  it('move with inserted columns unless set to stay put', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    const a = obj({ shape: 'ellipse' }), b = obj({ kind: 'text', text: 'note', placement: 'absolute' });
    wb.edit('add', () => s.setObjects([a, b]));
    wb.edit('insert', () => s.insertCols(0, 2));
    expect(s.objects[0].at.col).toBe(3);
    expect(s.objects[1].at.col).toBe(1);
    wb.undo();
    expect(s.objects[0].at.col).toBe(1);
  });

  it('go to Excel as its own pictures, shapes, text boxes and arrows, and come back', async () => {
    const wb = new Workbook();
    const s = wb.sheet;
    const list = [
      obj({ kind: 'picture', src: PNG, descr: 'TLC plate', name: 'TLC' }),
      obj({ shape: 'roundRect', fill: '#ffc000', line: 'none', text: 'Hot spot\nsecond line', bold: true, size: 14, color: '#000000', align: 'right' }),
      obj({ kind: 'text', shape: 'rect', text: 'Run at 0 °C', italic: true, font: 'Arial', rot: 30 }),
      obj({ shape: 'arrow', line: '#c00000', lineW: 2.25, flipV: true, h: 40 }),
      obj({ shape: 'star5', placement: 'oneCell' }),
    ];
    wb.edit('add', () => { s.setInput(0, 0, 'x'); s.setObjects(list); });
    const { files, back } = await roundTrip(wb);
    const dr = strFromU8(files['xl/drawings/drawing1.xml']);
    expect(dr).toContain('<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="TLC" descr="TLC plate"/>');
    expect(dr).toContain('<xdr:cNvSpPr txBox="1"/>');
    expect(dr).toContain('<a:prstGeom prst="straightConnector1">');
    expect(dr).toContain('<a:tailEnd type="triangle"/>');
    expect(dr).toContain('rot="1800000"');
    expect(dr).toContain('<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>1</xdr:col><xdr:colOff>47625</xdr:colOff>');
    expect(files['xl/media/image1.png']).toBeDefined();
    const got = back.book.sheet.objects;
    expect(got).toHaveLength(5);
    const strip = (o: SheetObject) => { const { id: _, name: __, ...rest } = o; return rest; };
    expect(got.map(strip)).toEqual(list.map((o) => { const r = strip(o); if (o.kind !== 'picture') delete r.name; return r; }));
    expect(got[0].name).toBe('TLC');
    expect(back.warnings.join(' ')).not.toMatch(/picture/);
  });

  it('reads shapes drawn in Excel, with theme colours and Excel\'s own anchors', async () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('add', () => { s.setInput(0, 0, 'x'); s.setObjects([obj({ shape: 'rect' })]); });
    // (copied into this realm's arrays, which zipSync needs)
    const files: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(unzipSync(await writeXlsx(wb, pictures)))) files[k] = u8copy(v);
    // a shape as Excel writes one: colours from the theme through its style, a oneCellAnchor
    files['xl/drawings/drawing1.xml'] = u8copy(strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1905000" cy="952500"/>
      <xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Oval 1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></xdr:spPr>
      <xdr:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style>
      <xdr:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:t>Hi</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor>
      <xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:grpSp/><xdr:clientData/></xdr:twoCellAnchor>
      </xdr:wsDr>`));
    const back = await readXlsx(zipSync(files));
    const o = back.book.sheet.objects[0];
    expect(o).toMatchObject({ kind: 'shape', shape: 'ellipse', at: { row: 3, col: 2, dx: 0, dy: 0 }, w: 200, h: 100, text: 'Hi', placement: 'oneCell' });
    // accent2 of the Office theme
    expect(o.fill).toBe('#ed7d31');
    // the group isn't shown, and the warning says so
    expect(back.warnings.join(' ')).toMatch(/1 picture or chart/);
  });

  it('draws the outline of each shape', () => {
    expect(shapePath('rect', 10, 5)).toBe('M0 0H10V5H0Z');
    expect(shapePath('triangle', 10, 10)).toBe('M5 0L10 10L0 10Z');
    expect(shapePath('line', 10, 4, true)).toBe('M0 4L10 0');
    expect(drawingColour(new DOMParser().parseFromString('<a:schemeClr xmlns:a="x" val="accent1"><a:lumMod val="75000"/></a:schemeClr>', 'application/xml').documentElement, ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4'])).toBe('#2f5597');
  });
});
