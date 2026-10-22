// @vitest-environment jsdom
//
// Notes, comments and data validation in Sheet mode: they move with their cells, are checked as
// Excel checks them, and go to Excel's own parts in .xlsx files and come back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';
import { newValidation, passes, listItems, invalidCells, readDate, readTime, describeValidation, Validation } from '../src/sheet/validation';
import { readNotes, shownNotes, readValidations } from '../src/io/xlsx-notes';
import type { CellNote } from '../src/sheet/notes';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const r = (r1: number, c1: number, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

const note = (text: string, author = 'Nate'): CellNote => ({ kind: 'note', author, date: '', text });
const thread = (text: string): CellNote => ({
  kind: 'comment', author: 'Nate', date: '2026-10-22T09:30:00.000Z', text,
  replies: [{ author: 'Sam', date: '2026-10-22T10:00:00.000Z', text: 'Run it again at 0 °C' }],
});

function check(wb: Workbook, v: Validation, row: number, col: number): boolean {
  const s = wb.sheet;
  return passes(v, s.value(row, col), s.shownText(row, col), s, wb.validationHost(s), row, col);
}

describe('notes on cells', () => {
  it('move with inserted and deleted rows, sorting, and cut and paste', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      ['3', '1', '2'].forEach((t, i) => s.setInput(i, 0, t));
      s.setNote(0, 0, note('three'));
      s.setNote(2, 1, thread('two'));
    });
    wb.edit('insert', () => s.insertRows(0, 2));
    expect(s.noteAt(2, 0)?.text).toBe('three');
    expect(s.noteAt(4, 1)?.text).toBe('two');
    wb.edit('sort', () => s.sort(r(2, 0, 4, 1), [{ col: 0 }]));
    // 1, 2, 3: the note on 3 goes to the bottom, the comment on 2's row to the middle
    expect(s.noteAt(4, 0)?.text).toBe('three');
    expect(s.noteAt(3, 1)?.text).toBe('two');
    wb.edit('delete', () => s.deleteRows(3, 1));
    expect(s.noteAt(3, 1)).toBeUndefined();
    expect(s.noteAt(3, 0)?.text).toBe('three');
    wb.edit('move', () => s.move(r(3, 0), { row: 10, col: 5 }));
    expect(s.noteAt(3, 0)).toBeUndefined();
    expect(s.noteAt(10, 5)?.text).toBe('three');
    // copy and paste brings the note too; Clear All takes it away, Clear Contents doesn't
    wb.edit('paste', () => s.paste({ row: 0, col: 0 }, s.copy(r(10, 5))));
    expect(s.noteAt(0, 0)?.text).toBe('three');
    wb.edit('clear', () => s.clear(r(0, 0), 'contents'));
    expect(s.noteAt(0, 0)).toBeDefined();
    wb.edit('clear', () => s.clear(r(0, 0), 'all'));
    expect(s.noteAt(0, 0)).toBeUndefined();
    wb.undo();
    expect(s.noteAt(0, 0)?.text).toBe('three');
  });
});

describe('data validation', () => {
  it('checks numbers, dates, text lengths, lists and formulas as Excel does', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      s.setInput(0, 0, '5');
      s.setInput(1, 0, '5.5');
      s.setInput(2, 0, '12');
      s.setInput(0, 1, 'pd(oac)2');
      s.setInput(1, 1, 'NiCl2');
      ['Pd(OAc)2', 'PdCl2', '', 'Pd2(dba)3'].forEach((t, i) => s.setInput(i, 7, t));
      s.setInput(0, 3, 'abcdef');
    });
    const whole = newValidation([r(0, 0, 9, 0)], { kind: 'whole', value1: '1', value2: '10' });
    expect(check(wb, whole, 0, 0)).toBe(true);
    expect(check(wb, whole, 1, 0)).toBe(false);
    expect(check(wb, whole, 2, 0)).toBe(false);
    expect(check(wb, whole, 5, 0)).toBe(true); // empty, and blanks are allowed
    expect(check(wb, { ...whole, noBlank: true }, 5, 0)).toBe(false);
    const dec = newValidation([r(0, 0, 9, 0)], { kind: 'decimal', op: 'lessThanOrEqual', value1: '=$A$1+1' });
    expect(check(wb, dec, 1, 0)).toBe(true);
    expect(check(wb, dec, 2, 0)).toBe(false);
    const list = newValidation([r(0, 1, 9, 1)], { kind: 'list', value1: 'Pd(OAc)2, PdCl2' });
    expect(listItems(list, s, wb.validationHost(s))).toEqual(['Pd(OAc)2', 'PdCl2']);
    expect(check(wb, list, 0, 1)).toBe(true); // capitals don't matter
    expect(check(wb, list, 1, 1)).toBe(false);
    const fromCells = newValidation([r(0, 1, 9, 1)], { kind: 'list', value1: '=$H$1:$H$10' });
    expect(listItems(fromCells, s, wb.validationHost(s))).toEqual(['Pd(OAc)2', 'PdCl2', 'Pd2(dba)3']);
    const len = newValidation([r(0, 3)], { kind: 'length', op: 'lessThan', value1: '5' });
    expect(check(wb, len, 0, 3)).toBe(false);
    const custom = newValidation([r(0, 0, 9, 0)], { kind: 'custom', value1: '=MOD(A1,2)=1' });
    expect(check(wb, custom, 0, 0)).toBe(true);
    expect(check(wb, custom, 2, 0)).toBe(false);
    expect(readDate('2026-01-31')).toBe(46053);
    expect(readDate('1/31/2026')).toBe(46053);
    expect(readTime('13:30')).toBeCloseTo(0.5625);
    expect(describeValidation(whole)).toBe('a whole number between 1 and 10');
    // Circle Invalid Data finds the cells that break the rules
    wb.edit('rules', () => s.setValidations([whole, list]));
    expect(invalidCells(s, wb.validationHost(s))).toEqual([{ row: 1, col: 0 }, { row: 2, col: 0 }, { row: 1, col: 1 }]);
  });

  it('moves rules and their references with inserted rows', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('rules', () => s.setValidations([newValidation([r(2, 1, 5, 1)], { kind: 'list', value1: '=$H$3:$H$6' })]));
    wb.edit('insert', () => s.insertRows(0, 1));
    expect(s.validations[0].ranges[0]).toEqual(r(3, 1, 6, 1));
    expect(s.validations[0].value1).toBe('=$H$4:$H$7');
    expect(s.validationAt(3, 1)).toBeDefined();
    expect(s.validationAt(2, 1)).toBeUndefined();
  });
});

describe('in Excel files', () => {
  it('writes notes, threaded comments and validation to Excel\'s parts and reads them back', async () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      s.setInput(0, 0, 'Catalyst');
      s.setNote(0, 0, { ...note('Dried over P2O5\nfor 2 h'), shown: true });
      s.setNote(3, 2, { ...thread('Is this yield right?'), done: true });
      s.setValidations([
        newValidation([r(1, 0, 20, 0)], { kind: 'list', value1: 'Pd(OAc)2,"Pd" black', promptTitle: 'Catalyst', prompt: 'Pick one', alertStyle: 'warning', alert: 'Not one we stock' }),
        newValidation([r(1, 1, 20, 1), r(1, 3, 20, 3)], { kind: 'decimal', op: 'greaterThan', value1: '0', noBlank: true }),
        newValidation([r(1, 2, 20, 2)], { kind: 'date', value1: '2026-01-01', value2: '=TODAY()', noDropDown: true }),
        newValidation([r(1, 4, 20, 4)], { kind: 'list', value1: '=$H$1:$H$5', noDropDown: true, hidePrompt: true, noAlert: true }),
      ]);
    });
    const bytes = await writeXlsx(wb, pictures);
    const files = unzipSync(bytes);
    const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
    // the parts Excel needs, in the order its schema wants them
    expect(sheetXml).toMatch(/<\/sheetData>.*<dataValidations count="4">.*<\/dataValidations><pageMargins.*<legacyDrawing r:id="rId\d+"\/><\/worksheet>/);
    expect(sheetXml).toContain('<formula1>&quot;Pd(OAc)2,&quot;&quot;Pd&quot;&quot; black&quot;</formula1>');
    expect(sheetXml).toContain('sqref="B2:B21 D2:D21"');
    expect(sheetXml).toContain('showDropDown="1"');
    expect(sheetXml).toContain('<formula1>46023</formula1><formula2>TODAY()</formula2>');
    const comments = strFromU8(files['xl/comments1.xml']);
    expect(comments).toContain('<author>Nate</author>');
    expect(comments).toMatch(/<author>tc=\{[0-9A-F-]+\}<\/author>/);
    expect(strFromU8(files['xl/threadedComments/threadedComment1.xml'])).toMatch(/done="1"/);
    expect(strFromU8(files['xl/persons/person.xml'])).toContain('displayName="Sam"');
    const vml = strFromU8(files['xl/drawings/vmlDrawing1.vml']);
    expect(vml).toContain('<x:Visible/>');
    expect(strFromU8(files['[Content_Types].xml'])).toContain('Extension="vml"');

    const back = (await readXlsx(bytes)).book.sheet;
    expect(back.noteAt(0, 0)).toEqual({ kind: 'note', author: 'Nate', date: '', text: 'Dried over P2O5\nfor 2 h', shown: true });
    const c = back.noteAt(3, 2)!;
    expect(c.kind).toBe('comment');
    expect(c.done).toBe(true);
    expect(c.date).toBe('2026-10-22T09:30:00.000Z');
    expect(c.replies).toEqual([{ author: 'Sam', date: '2026-10-22T10:00:00.000Z', text: 'Run it again at 0 °C' }]);
    const v = back.validations.map(({ id: _, ...rest }) => rest);
    expect(v).toEqual([
      { ranges: [r(1, 0, 20, 0)], kind: 'list', value1: 'Pd(OAc)2,"Pd" black', promptTitle: 'Catalyst', prompt: 'Pick one', alertStyle: 'warning', alert: 'Not one we stock' },
      { ranges: [r(1, 1, 20, 1), r(1, 3, 20, 3)], kind: 'decimal', op: 'greaterThan', value1: '0', noBlank: true },
      { ranges: [r(1, 2, 20, 2)], kind: 'date', value1: '2026-01-01', value2: '=TODAY()' },
      { ranges: [r(1, 4, 20, 4)], kind: 'list', value1: '=$H$1:$H$5', noDropDown: true, hidePrompt: true, noAlert: true },
    ]);
  });

  it('reads notes as Excel writes them, and Excel 2010\'s list rules', () => {
    const comments = parse(`<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Jo Smith</author></authors><commentList>
      <comment ref="B3" authorId="0" shapeId="0"><text><r><rPr><b/></rPr><t>Jo Smith:</t></r><r><t xml:space="preserve">
Check the mass</t></r></text></comment></commentList></comments>`);
    // Excel's VML isn't always well-formed XML (<br> without its end)
    const vml = '<xml><v:shape id="_x0000_s1025" style="visibility:visible"><v:textbox><div><br></div></v:textbox><x:ClientData ObjectType="Note"><x:Row>2</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>';
    const notes = readNotes(comments, shownNotes(vml), null, null);
    expect([...notes.values()]).toEqual([{ kind: 'note', author: 'Jo Smith', date: '', text: 'Check the mass', shown: true }]);
    const ws = parse(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">
      <extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1"><x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">
      <x14:formula1><xm:f>Reagents!$A$2:$A$40</xm:f></x14:formula1><xm:sqref>C2:C100</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst></worksheet>`).documentElement;
    const [rule] = readValidations(ws);
    expect(rule.kind).toBe('list');
    expect(rule.value1).toBe('=Reagents!$A$2:$A$40');
    expect(rule.ranges).toEqual([r(1, 2, 99, 2)]);
  });
});
