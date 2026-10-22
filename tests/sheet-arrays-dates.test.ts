// @vitest-environment jsdom
//
// Office wave 4 in Sheet mode: date and time functions, arrays that spill (FILTER, SORT, UNIQUE,
// SEQUENCE…, and LINEST, LOGEST and TEXTSPLIT), LET and LAMBDA, and defined names, as Excel
// works them out, and as Excel saves them in .xlsx. Date results were worked out by LibreOffice
// Calc from the same cells (it follows Excel for these); the array and LAMBDA examples are
// Microsoft's own from its function reference.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { parseCellRef } from '../src/sheet/refs';
import { CellError, Value, readTyped } from '../src/sheet/values';
import { formatValue } from '../src/sheet/numfmt';
import { dateSerial, serialParts, readDateTime } from '../src/sheet/dates';
import { legacyFormula, needsDynamic, fileFormula, readFileFormula } from '../src/sheet/array-formulas';
import { nameProblem } from '../src/sheet/names';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

/** A workbook with cells typed in (A1-style keys). */
function book(cells: Record<string, string | number>): Workbook {
  const wb = new Workbook();
  type(wb, cells);
  return wb;
}

function type(wb: Workbook, cells: Record<string, string | number>): void {
  wb.edit('type', () => {
    for (const [k, v] of Object.entries(cells)) { const r = parseCellRef(k)!; wb.sheet.setInput(r.row, r.col, String(v)); }
  });
}

/** A cell's value (errors as their codes). */
function val(wb: Workbook, ref: string, sheet = wb.sheet): Value | string {
  const r = parseCellRef(ref)!;
  const v = sheet.value(r.row, r.col);
  return v instanceof CellError ? v.code : v;
}

/** The values of a block, row by row. */
function block(wb: Workbook, from: string, to: string): (Value | string)[][] {
  const a = parseCellRef(from)!, b = parseCellRef(to)!;
  const out: (Value | string)[][] = [];
  for (let r = a.row; r <= b.row; r++) {
    const line: (Value | string)[] = [];
    for (let c = a.col; c <= b.col; c++) { const v = wb.sheet.value(r, c); line.push(v instanceof CellError ? v.code : v); }
    out.push(line);
  }
  return out;
}

function check(cases: [string, Value | string][], data: Record<string, string | number> = {}): void {
  const wb = book({ ...data, ...Object.fromEntries(cases.map(([f], i) => [`Z${i + 1}`, f])) });
  cases.forEach(([f, want], i) => {
    const got = val(wb, `Z${i + 1}`);
    if (typeof want === 'number' && typeof got === 'number') expect(got, f).toBeCloseTo(want, 9);
    else expect(got, f).toEqual(want);
  });
}

describe('dates', () => {
  it('counts days as Excel does, 29 February 1900 and all', () => {
    expect(dateSerial(1900, 1, 1)).toBe(1);
    expect(dateSerial(1900, 2, 28)).toBe(59);
    expect(dateSerial(1900, 2, 29)).toBe(60);
    expect(dateSerial(1900, 3, 1)).toBe(61);
    expect(dateSerial(2026, 10, 22)).toBe(46317);
    expect(dateSerial(2026, 14, 1)).toBe(dateSerial(2027, 2, 1));
    expect(dateSerial(2026, 3, 0)).toBe(dateSerial(2026, 2, 28));
    expect(serialParts(60)).toMatchObject({ y: 1900, m: 2, d: 29 });
    expect(serialParts(46317.75)).toMatchObject({ y: 2026, m: 10, d: 22, secs: 18 * 3600, weekday: 4 });
    expect(formatValue(46317, 'm/d/yyyy').text).toBe('10/22/2026');
    expect(formatValue(46317.5625, 'dddd, mmmm d, yyyy h:mm AM/PM').text).toBe('Thursday, October 22, 2026 1:30 PM');
    expect(formatValue(59, 'yyyy-mm-dd').text).toBe('1900-02-28');
  });

  it('reads dates and times typed into cells, keeping compound numbers and ratios as text', () => {
    expect(readTyped('10/22/2026')).toEqual({ value: 46317, format: 'm/d/yyyy' });
    expect(readTyped('2026-10-22')).toEqual({ value: 46317, format: 'yyyy-mm-dd' });
    expect(readTyped('22-Oct-2026')).toEqual({ value: 46317, format: 'd-mmm-yy' });
    expect(readTyped('Oct 22, 2026')).toEqual({ value: 46317, format: 'd-mmm-yy' });
    expect(readTyped('2:30 PM')).toEqual({ value: 14.5 / 24, format: 'h:mm AM/PM' });
    expect(readTyped('14:30')).toEqual({ value: 14.5 / 24, format: 'h:mm' });
    expect(readTyped('10/22/2026 14:30').value).toBeCloseTo(46317 + 14.5 / 24, 9);
    for (const t of ['2a', '3b', '10:1', '4:1', '1/2', 'Pd(OAc)2', 'Oct', '1-2']) expect(readTyped(t).value, t).toBe(t);
    expect(readTyped('2a').value).toBe('2a');
    expect(readTyped('10:1').value).toBe('10:1');
    expect(readTyped('1/2').value).toBe('1/2');
    // in formulas, as in Excel
    expect(readDateTime('1/2')).not.toBeNull();
    expect(readDateTime('10:1')!.value).toBeCloseTo((10 * 60 + 1) / 1440, 9);
  });

  it('gives a date format to =TODAY() and =DATE(), as Excel does', () => {
    const wb = book({ A1: '=DATE(2026,10,22)', A2: '=TODAY()', A3: '=NOW()', A4: '=TIME(14,30,0)', A5: '=A1+1' });
    expect(wb.sheet.cell(0, 0)!.style?.numFmt).toBe('m/d/yyyy');
    expect(wb.sheet.shownText(0, 0)).toBe('10/22/2026');
    expect(wb.sheet.cell(2, 0)!.style?.numFmt).toBe('m/d/yyyy h:mm');
    expect(wb.sheet.shownText(3, 0)).toBe('2:30 PM');
    expect(wb.sheet.cell(4, 0)!.style?.numFmt).toBeUndefined();
    const now = new Date();
    expect(val(wb, 'A2')).toBe(dateSerial(now.getFullYear(), now.getMonth() + 1, now.getDate()));
  });

  // worked out by LibreOffice Calc 24.2 from the same formulas, except DATE with a year below 1900
  // (Microsoft's reference: 126 is 2026) and the .INTL forms, which it reads only without a prefix
  const DATES: [string, Value | string][] = [
    ['=DATE(2026,10,22)', 46317],
    ['=DATE(126,1,1)', 46023],
    ['=DATE(2026,13,1)', 46388],
    ['=DATE(2026,1,0)', 46022],
    ['=DATE(-1,1,1)', '#NUM!'],
    ['=TIME(14,30,15)', 0.604340277777778],
    ['=TIME(25,0,0)', 0.0416666666666667],
    ['=YEAR(46317)', 2026],
    ['=MONTH("2026-10-22")', 10],
    ['=DAY(46317.9)', 22],
    ['=HOUR(0.604340277777778)', 14],
    ['=MINUTE(0.604340277777778)', 30],
    ['=SECOND(0.604340277777778)', 15],
    ['=WEEKDAY(46317)', 5],
    ['=WEEKDAY(46317,2)', 4],
    ['=WEEKDAY(46317,3)', 3],
    ['=WEEKDAY(46317,16)', 6],
    ['=WEEKNUM(46317)', 43],
    ['=WEEKNUM(46317,2)', 43],
    ['=WEEKNUM(DATE(2026,1,1))', 1],
    ['=WEEKNUM(DATE(2026,1,4),2)', 1],
    ['=WEEKNUM(DATE(2026,1,5),2)', 2],
    ['=WEEKNUM(DATE(2027,1,1),21)', 53],
    ['=ISOWEEKNUM(DATE(2027,1,1))', 53],
    ['=ISOWEEKNUM(46317)', 43],
    ['=DATEDIF(DATE(2020,2,29),DATE(2026,10,22),"Y")', 6],
    ['=DATEDIF(DATE(2020,2,29),DATE(2026,10,22),"M")', 79],
    ['=DATEDIF(DATE(2020,2,29),DATE(2026,10,22),"D")', 2427],
    ['=DATEDIF(DATE(2020,2,29),DATE(2026,10,22),"YM")', 7],
    ['=DATEDIF(DATE(2020,2,29),DATE(2026,10,22),"MD")', 23],
    ['=DATEDIF(DATE(2020,2,29),DATE(2026,10,22),"YD")', 235],
    // (Microsoft warns that "MD" can come out negative like this)
    ['=DATEDIF(DATE(2026,1,31),DATE(2026,3,1),"MD")', -2],
    ['=DATEDIF(DATE(2026,5,10),DATE(2026,2,1),"D")', '#NUM!'],
    ['=DAYS("2026-12-25","2026-10-22")', 64],
    ['=EDATE(DATE(2026,1,31),1)', 46081],
    ['=EDATE(DATE(2026,3,31),-1)', 46081],
    ['=EOMONTH(DATE(2026,10,22),0)', 46326],
    ['=EOMONTH(DATE(2026,10,22),-10)', 46022],
    ['=NETWORKDAYS(DATE(2026,10,1),DATE(2026,10,31))', 22],
    ['=NETWORKDAYS(DATE(2026,10,31),DATE(2026,10,1))', -22],
    ['=NETWORKDAYS(DATE(2026,11,1),DATE(2026,11,30),B1:B2)', 19],
    ['=NETWORKDAYS.INTL(DATE(2026,10,1),DATE(2026,10,31),7)', 21],
    ['=NETWORKDAYS.INTL(DATE(2026,10,1),DATE(2026,10,31),"0000011")', 22],
    ['=NETWORKDAYS.INTL(DATE(2026,10,1),DATE(2026,10,31),11)', 27],
    ['=WORKDAY(DATE(2026,10,22),10)', 46331],
    ['=WORKDAY(DATE(2026,10,22),-10)', 46303],
    ['=WORKDAY(DATE(2026,11,20),5,B1:B2)', 46357],
    ['=WORKDAY.INTL(DATE(2026,10,22),10,7)', 46331],
    ['=DATEVALUE("10/22/2026")', 46317],
    ['=DATEVALUE("22-Oct-2026")', 46317],
    ['=TIMEVALUE("2:30 PM")', 0.604166666666667],
    ['=DATEVALUE(46317)', '#VALUE!'],
    ['="2026-10-22"+7', 46324],
  ];
  it('works out the date and time functions as Excel does', () => {
    check(DATES, { B1: '2026-11-26', B2: '2026-11-27' });
  });
});

describe('arrays that spill', () => {
  const PEOPLE = { A1: 'Fritz', A2: 'Fritz', A3: 'Bob', A4: 'Bob', A5: 'Bob', A6: 'Hank', A7: 'Hank', A8: 'Rose', B1: 38, B2: 12, B3: 22, B4: 31, B5: 9, B6: 45, B7: 27, B8: 19 };

  it('spills FILTER, SORT, SORTBY, UNIQUE and SEQUENCE into the cells below and to the right', () => {
    const wb = book({
      ...PEOPLE,
      D1: '=UNIQUE(A1:A8)', E1: '=UNIQUE(A1:A8,,TRUE)', F1: '=SEQUENCE(2,3,10,-1)', I1: '=FILTER(A1:B8,B1:B8>30)',
      K1: '=SORT(B1:B8,,-1)', L1: '=SORTBY(A1:A8,B1:B8)', M1: '=SORT(A1:B8,{1,2},{1,-1})', P1: '=FILTER(A1:A8,B1:B8>100,"none")',
    });
    expect(block(wb, 'D1', 'D5')).toEqual([['Fritz'], ['Bob'], ['Hank'], ['Rose'], [null]]);
    expect(block(wb, 'E1', 'E2')).toEqual([['Rose'], [null]]);
    expect(block(wb, 'F1', 'H2')).toEqual([[10, 9, 8], [7, 6, 5]]);
    expect(block(wb, 'I1', 'J4')).toEqual([['Fritz', 38], ['Bob', 31], ['Hank', 45], [null, null]]);
    expect(block(wb, 'K1', 'K8').flat()).toEqual([45, 38, 31, 27, 22, 19, 12, 9]);
    expect(block(wb, 'L1', 'L8').flat()).toEqual(['Bob', 'Fritz', 'Rose', 'Bob', 'Hank', 'Bob', 'Fritz', 'Hank']);
    expect(block(wb, 'M1', 'N4')).toEqual([['Bob', 31], ['Bob', 22], ['Bob', 9], ['Fritz', 38]]);
    expect(val(wb, 'P1')).toBe('none');
    // the cells it spilled into belong to the formula
    expect(wb.sheet.spillAt(2, 3)).toMatchObject({ row: 0, col: 3, range: { r1: 0, c1: 3, r2: 3, c2: 3 } });
    expect(wb.sheet.cell(2, 3)).toBeUndefined();
  });

  it('spills LINEST, LOGEST and TEXTSPLIT, which used to show only their first value', () => {
    const wb = book({ A1: 1, A2: 9, A3: 5, A4: 7, B1: 0, B2: 4, B3: 2, B4: 3, D1: '=LINEST(A1:A4,B1:B4)', D3: '=TEXTSPLIT("Dakota Lennon Sanchez"," ")', D5: '=TEXTSPLIT("1,2;3,4",",",";")' });
    expect(block(wb, 'D1', 'E1')).toEqual([[2, 1]]);
    expect(block(wb, 'D3', 'F3')).toEqual([['Dakota', 'Lennon', 'Sanchez']]);
    expect(block(wb, 'D5', 'E6')).toEqual([['1', '2'], ['3', '4']]);
  });

  it('works out arithmetic and functions for each value of an array (=A1:A3*2, =LEN(…))', () => {
    const wb = book({ A1: 1, A2: 2, A3: 3, B1: 'Pd', B2: 'PPh3', B3: '', C1: '=A1:A3*10', D1: '=LEN(B1:B3)', E1: '=IF(A1:A3>1,"big","small")', F1: '=SUM(A1:A3*A1:A3)', G1: '=SUMPRODUCT(A1:A3,A1:A3)', H1: '=A1:A3', I1: '={1,2;3,4}*A1' });
    expect(block(wb, 'C1', 'C3').flat()).toEqual([10, 20, 30]);
    expect(block(wb, 'D1', 'D3').flat()).toEqual([2, 4, 0]);
    expect(block(wb, 'E1', 'E3').flat()).toEqual(['small', 'big', 'big']);
    expect(val(wb, 'F1')).toBe(14);
    expect(val(wb, 'G1')).toBe(14);
    expect(block(wb, 'H1', 'H3').flat()).toEqual([1, 2, 3]);
    expect(block(wb, 'I1', 'J2')).toEqual([[1, 2], [3, 4]]);
  });

  it('shows #SPILL! when something is in the way, and spills again once it is gone', () => {
    const wb = book({ A1: '=SEQUENCE(3)', B1: '=A3*10' });
    expect(val(wb, 'B1')).toBe(30);
    type(wb, { A2: 'note' });
    expect(val(wb, 'A1')).toBe('#SPILL!');
    expect(val(wb, 'A3')).toBeNull();
    expect(val(wb, 'B1')).toBe(0);
    wb.undo();
    expect(block(wb, 'A1', 'A3').flat()).toEqual([1, 2, 3]);
    expect(val(wb, 'B1')).toBe(30);
    // two arrays can't fill the same cells
    type(wb, { C2: '=SEQUENCE(1,3)', D1: '=SEQUENCE(3)' });
    expect([val(wb, 'C2'), val(wb, 'D1')].sort()).toEqual(['#SPILL!', 1].sort());
    // nor run off the sheet
    type(wb, { F1048575: '=SEQUENCE(3)' });
    expect(val(wb, 'F1048575')).toBe('#SPILL!');
  });

  it('follows an array as it grows and shrinks, with A1# for all of it', () => {
    const wb = book({ A1: 3, A2: 1, A3: 2, C1: '=SORT(A1:A10)', D1: '=SUM(C1#)', E1: '=ROWS(C1#)', F1: '=C2*100', G1: '=COUNT(C1:C10)' });
    expect(block(wb, 'C1', 'C3').flat()).toEqual([1, 2, 3]);
    expect([val(wb, 'D1'), val(wb, 'F1')]).toEqual([6, 200]);
    // (A1:A10 holds its empty cells too: SORT puts them last, as zeros)
    expect(val(wb, 'E1')).toBe(10);
    type(wb, { A4: 0.5 });
    expect(val(wb, 'C1')).toBe(0.5);
    expect([val(wb, 'D1'), val(wb, 'F1')]).toEqual([6.5, 100]);
    type(wb, { C1: '=SORT(FILTER(A1:A10,A1:A10<>""))' });
    expect(val(wb, 'E1')).toBe(4);
    type(wb, { A4: '' });
    expect([val(wb, 'E1'), val(wb, 'D1'), val(wb, 'C4'), val(wb, 'G1')]).toEqual([3, 6, null, 3]);
  });

  it('takes one value with @, as Excel shows formulas from before spilling', () => {
    const wb = book({ A1: 1, A2: 2, A3: 3, B2: '=@A1:A3*10', B5: '=@A1:A3', C1: '=@SEQUENCE(3)' });
    expect(val(wb, 'B2')).toBe(20);
    expect(val(wb, 'B5')).toBe('#VALUE!');
    expect(val(wb, 'C1')).toBe(1);
    expect(legacyFormula('=A1:A3*10')).toBe('=@A1:A3*10');
    expect(legacyFormula('=SUM(A1:A3*B1:B3)')).toBe('=SUM(@A1:A3*@B1:B3)');
    expect(legacyFormula('=SUM(A1:A3)+VLOOKUP(B1,C:D,2,FALSE)')).toBe('=SUM(A1:A3)+VLOOKUP(B1,C:D,2,FALSE)');
    expect(legacyFormula('=IF(A1:A3>1,B1:B3,0)')).toBe('=IF(@A1:A3>1,@B1:B3,0)');
    expect(needsDynamic('=SUM(A1:A3*B1:B3)')).toBe(true);
    expect(needsDynamic('=SUM(A1:A3)*2')).toBe(false);
    expect(needsDynamic('=UNIQUE(A1:A3)')).toBe(true);
  });
});

describe('LET and LAMBDA', () => {
  it('works out Microsoft\'s examples', () => {
    check([
      ['=LET(x, 1, x+1)', 2],
      ['=LET(x, 5, y, x*2, x+y)', 15],
      ['=LET(total, SUM(A1:A3), total/COUNT(A1:A3))', 2.5],
      ['=LAMBDA(x, x+1)(1)', 2],
      ['=LAMBDA(a, b, a*b)(3, 4)', 12],
      ['=LET(sq, LAMBDA(n, n*n), sq(4)+sq(3))', 25],
      ['=LAMBDA(x, x+1)', '#CALC!'],
      ['=LAMBDA(x, x+1)(1, 2)', '#VALUE!'],
      ['=LET(x, 1)', '#VALUE!'],
      ['=LET(A1, 1, A1)', '#VALUE!'],
      ['=REDUCE(0, A1:C2, LAMBDA(a, b, a+b^2))', 91],
      ['=SUM(MAP(A1:C2, LAMBDA(a, IF(a>4, a*a, a))))', 6 + 25 + 36 + 4],
      ['=INDEX(SCAN(1, A1:C1, LAMBDA(a, b, a*b)), 1, 3)', 6],
      ['=SUM(BYROW(A1:C2, LAMBDA(r, MAX(r))))', 9],
      ['=SUM(BYCOL(A1:C2, LAMBDA(c, MIN(c))))', 6],
      ['=SUM(MAKEARRAY(3, 3, LAMBDA(r, c, r*c)))', 36],
      ['=MAP(A1:C2, 5)', '#VALUE!'],
    ], { A1: 1, B1: 2, C1: 3, A2: 4, B2: 5, C2: 6 });
  });

  it('spills what the LAMBDA helpers give', () => {
    const wb = book({ A1: 1, B1: 2, C1: 3, E1: '=SCAN(0, A1:C1, LAMBDA(t, v, t+v))', E2: '=MAKEARRAY(2, 2, LAMBDA(r, c, r&"-"&c))' });
    expect(block(wb, 'E1', 'G1')).toEqual([[1, 3, 6]]);
    expect(block(wb, 'E2', 'F3')).toEqual([['1-1', '1-2'], ['2-1', '2-2']]);
  });
});

describe('defined names', () => {
  it('checks names as Excel does', () => {
    for (const ok of ['Yields', 'R_gas', '_total', 'Run.2', 'ABCD1']) expect(nameProblem(ok), ok).toBeNull();
    for (const bad of ['A1', 'xfd9', 'R1C1', 'R', 'c', '1st', 'two words', 'TRUE', '', 'a-b']) expect(nameProblem(bad), bad).not.toBeNull();
  });

  it('works names out in formulas, for blocks, values and LAMBDAs, the sheet\'s own first', () => {
    const wb = book({ A1: 10, A2: 20, A3: 30, B1: '=SUM(Yields)', B2: '=R*2', B3: '=Moles(5, 2)', B4: '=ROWS(Yields)', B5: '=OFFSET(Yields,1,0,1,1)', B6: '=Missing+1' });
    const s2 = wb.addSheet('Run 2');
    wb.edit('names', () => wb.setNames([
      { name: 'Yields', formula: '=Sheet1!$A$1:$A$3' },
      { name: 'R', formula: '=0.082057' },
      { name: 'R', formula: '=1', sheet: s2 },
      { name: 'Moles', formula: '=LAMBDA(mass, mw, mass/mw)' },
    ]));
    expect([val(wb, 'B1'), val(wb, 'B2'), val(wb, 'B3'), val(wb, 'B4'), val(wb, 'B5'), val(wb, 'B6')]).toEqual([60, 0.164114, 2.5, 3, 20, '#NAME?']);
    wb.edit('t', () => s2.setInput(0, 0, '=R*2'));
    expect(val(wb, 'A1', s2)).toBe(2);
    // a change to the cells a name stands for reaches the formulas using it
    type(wb, { A2: 25 });
    expect(val(wb, 'B1')).toBe(65);
    // inserting rows moves what the name stands for
    wb.edit('rows', () => wb.adjustAllFormulas({ sheet: 'Sheet1', axis: 'row', at: 0, count: 2 }));
    expect(wb.names[0].formula).toBe('=Sheet1!$A$3:$A$5');
    // and undo takes a change of names back
    wb.edit('names', () => wb.setNames([]));
    expect(val(wb, 'B1')).toBe('#NAME?');
    wb.undo();
    expect(wb.names.length).toBe(4);
  });
});

describe('Excel files', () => {
  async function roundTrip(wb: Workbook): Promise<{ book: Workbook; files: Record<string, string> }> {
    const bytes = await writeXlsx(wb, pictures);
    const zip = unzipSync(bytes);
    const files: Record<string, string> = {};
    for (const [k, v] of Object.entries(zip)) if (/\.(xml|rels)$/.test(k)) files[k] = strFromU8(v);
    const { book } = await readXlsx(bytes);
    return { book, files };
  }

  it('saves spilling formulas as Excel\'s dynamic array formulas, and opens them again', async () => {
    const wb = book({ A1: 3, A2: 1, A3: 2, B1: '=SORT(A1:A3)', C1: '=SUM(B1#)', D1: '=LET(x, A1, x*2)', E1: '=@A1:A3', F1: '=SUM(A1:A3)', G1: '=SUM(A1:A3*2)' });
    const { book: back, files } = await roundTrip(wb);
    // (style numbers aside)
    const sheet = files['xl/worksheets/sheet1.xml'].replace(/ s="\d+"/g, '');
    expect(sheet).toContain('<c r="B1" cm="1"><f t="array" ref="B1:B3">_xlfn._xlws.SORT(A1:A3)</f><v>1</v></c>');
    expect(sheet).toContain('<c r="B2"><v>2</v></c>');
    expect(sheet).toContain('<f t="array" ref="C1">SUM(_xlfn.ANCHORARRAY(B1))</f>');
    expect(sheet).toContain('<f t="array" ref="D1">_xlfn.LET(_xlpm.x, A1, _xlpm.x*2)</f>');
    // @ is how Excel works out an old-style formula, so it isn't written
    expect(sheet).toContain('<c r="E1"><f>A1:A3</f>');
    expect(sheet).toContain('<c r="F1"><f>SUM(A1:A3)</f>');
    expect(sheet).toContain('<c r="G1" cm="1"><f t="array" ref="G1">SUM(A1:A3*2)</f>');
    expect(files['xl/metadata.xml']).toContain('XLDAPR');
    expect(files['xl/_rels/workbook.xml.rels']).toContain('relationships/sheetMetadata');
    expect(files['[Content_Types].xml']).toContain('sheetMetadata+xml');
    const s = back.sheet;
    expect(['B1', 'C1', 'D1', 'E1', 'G1'].map((k) => s.cell(parseCellRef(k)!.row, parseCellRef(k)!.col)?.input)).toEqual(['=SORT(A1:A3)', '=SUM(B1#)', '=LET(x, A1, x*2)', '=@A1:A3', '=SUM(A1:A3*2)']);
    // the spilled cells come back empty, for the array to fill
    expect(s.cell(1, 1)?.input).toBeUndefined();
    expect(block(back, 'B1', 'B3').flat()).toEqual([1, 2, 3]);
    expect(val(back, 'C1')).toBe(6);
  });

  it('opens old-style formulas with @ where Excel would show it, and legacy array formulas as arrays', async () => {
    const wb = book({ A1: 1, A2: 2, A3: 3 });
    const bytes = await writeXlsx(wb, pictures);
    const zip = unzipSync(bytes);
    const path = 'xl/worksheets/sheet1.xml';
    const x = strFromU8(zip[path]).replace(/<c r="A3"[^>]*><v>3<\/v><\/c>/, '<c r="A3"><v>3</v></c><c r="B3"><f>A1:A3*10</f><v>30</v></c><c r="C3"><f t="array" ref="C3:C4">TRANSPOSE(A1:B1)</f><v>1</v></c>')
      .replace('</sheetData>', '<row r="4"><c r="C4"><v>0</v></c></row></sheetData>');
    // (a Uint8Array of this window's, for fflate to tell it from a folder)
    zip[path] = Uint8Array.from(strToU8(x));
    const { book: back } = await readXlsx(zipSync(zip));
    expect(back.sheet.cell(2, 1)?.input).toBe('=@A1:A3*10');
    expect(val(back, 'B3')).toBe(30);
    expect(back.sheet.cell(3, 2)).toBeUndefined();
    expect(back.sheet.cell(2, 2)?.input).toBe('=TRANSPOSE(A1:B1)');
  });

  it('keeps defined names, with their sheet, comment, and LAMBDAs', async () => {
    const wb = book({ A1: 10, A2: 20, B1: '=SUM(Yields)', B2: '=Twice(A1)' });
    wb.edit('names', () => wb.setNames([
      { name: 'Yields', formula: '=Sheet1!$A$1:$A$2', comment: 'Isolated yields' },
      { name: 'Local', formula: '=Sheet1!$B$1', sheet: wb.sheet },
      { name: 'Twice', formula: '=LAMBDA(x, x*2)' },
    ]));
    const { book: back, files } = await roundTrip(wb);
    const w = files['xl/workbook.xml'];
    expect(w).toContain('<definedName name="Yields" comment="Isolated yields">Sheet1!$A$1:$A$2</definedName>');
    expect(w).toContain('<definedName name="Local" localSheetId="0">Sheet1!$B$1</definedName>');
    expect(w).toContain('<definedName name="Twice">_xlfn.LAMBDA(_xlpm.x, _xlpm.x*2)</definedName>');
    expect(back.names.map((n) => [n.name, n.formula, n.sheet === back.sheet, n.comment])).toEqual([
      ['Yields', '=Sheet1!$A$1:$A$2', false, 'Isolated yields'],
      ['Local', '=Sheet1!$B$1', true, undefined],
      ['Twice', '=LAMBDA(x, x*2)', false, undefined],
    ]);
    expect([val(back, 'B1'), val(back, 'B2')]).toEqual([30, 20]);
  });

  it('writes and reads Excel\'s spellings', () => {
    expect(fileFormula('=LET(rate, 2, MAP(A1:A3, LAMBDA(v, v*rate)))', true)).toBe('LET(_xlpm.rate, 2, MAP(A1:A3, LAMBDA(_xlpm.v, _xlpm.v*_xlpm.rate)))');
    expect(fileFormula('=@INDEX(A1:B2,1,0)+1', true)).toBe('_xlfn.SINGLE(INDEX(A1:B2,1,0))+1');
    expect(readFileFormula('SUM(_xlfn.ANCHORARRAY(Sheet2!B1))+_xlfn.SINGLE(A1:A3)')).toBe('=SUM(Sheet2!B1#)+@(A1:A3)');
  });
});
