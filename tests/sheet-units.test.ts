// @vitest-environment jsdom
//
// Units for reaction conditions: a cell formatted as a temperature shows −78 as "−78 °C" and
// keeps the number, typing "-78 °C" gives the cell that format, and Excel files keep it.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { formatValue, describeFormat, changeDecimals } from '../src/sheet/numfmt';
import { UNITS, unitFormat, unitOfFormat, readWithUnit } from '../src/sheet/units';
import { readTyped, toNumber, CellError } from '../src/sheet/values';
import { writeXlsx, readXlsx, XlsxPictures } from '../src/io/xlsx';

const unit = (u: string) => UNITS.find((x) => x.unit === u)!;
const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => new Uint8Array() };

describe('unit formats', () => {
  it('shows a number with its unit and a true minus sign', () => {
    const temp = unitFormat(unit('°C'));
    expect(temp).toBe('0" °C";"−"0" °C"');
    expect(formatValue(-78, temp).text).toBe('−78 °C');
    expect(formatValue(25, temp).text).toBe('25 °C');
    expect(formatValue(0, temp).text).toBe('0 °C');
    expect(formatValue(5, unitFormat(unit('mol%'))).text).toBe('5 mol%');
    expect(formatValue(1.2, unitFormat(unit('equiv'))).text).toBe('1.2 equiv');
    expect(formatValue(0.1, unitFormat(unit('M'))).text).toBe('0.10 M');
    expect(formatValue(0.789, unitFormat(unit('g/mL'))).text).toBe('0.79 g/mL');
    expect(formatValue(95, unitFormat(unit('% ee'))).text).toBe('95% ee');
  });

  it('describes the format and changes its decimal places', () => {
    const temp = unitFormat(unit('°C'));
    expect(unitOfFormat(temp)?.name).toBe('Temperature');
    expect(describeFormat(temp)).toBe('Temperature (°C), 0 decimal places');
    const more = changeDecimals(temp, 1);
    expect(more).toBe('0.0" °C";"−"0.0" °C"');
    expect(formatValue(-78.5, more).text).toBe('−78.5 °C');
    expect(describeFormat(more)).toBe('Temperature (°C), 1 decimal place');
    // a format typed by hand with some other unit is just a number format
    expect(unitOfFormat('0.0" mg/kg"')).toBeNull();
  });

  it('reads a number typed with a unit', () => {
    expect(readWithUnit('-78 °C')).toEqual({ value: -78, format: unitFormat(unit('°C')) });
    expect(readWithUnit('-78C')?.value).toBe(-78);
    expect(readWithUnit('−78 oC')?.value).toBe(-78);
    expect(readWithUnit('5 mol %')).toEqual({ value: 5, format: unitFormat(unit('mol%')) });
    expect(readWithUnit('1.50 eq.')).toEqual({ value: 1.5, format: unitFormat(unit('equiv'), 2) });
    expect(readWithUnit('0.5 uL')?.format).toBe(unitFormat(unit('µL'), 1));
    expect(readWithUnit('12 hours')?.value).toBe(12);
    // not a unit we know, or not a number first: stays text
    expect(readWithUnit('3 kg')).toBeNull();
    expect(readWithUnit('C 12')).toBeNull();
    expect(readTyped('3 kg').value).toBe('3 kg');
    // text with a unit is still text inside formulas, as in Excel
    expect(toNumber('5 M')).toBeInstanceOf(CellError);
  });
});

describe('unit formats in a sheet', () => {
  it('formats a typed temperature, and a plain number typed into a temperature cell', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      s.setInput(0, 0, '-78 °C');
      s.patchStyle({ r1: 1, c1: 0, r2: 1, c2: 0 }, { numFmt: unitFormat(unit('°C')) });
      s.setInput(1, 0, '-40');
      s.setInput(2, 0, '=A1+A2');
    });
    expect(s.value(0, 0)).toBe(-78);
    expect(s.shownText(0, 0)).toBe('−78 °C');
    expect(s.value(1, 0)).toBe(-40);
    expect(s.shownText(1, 0)).toBe('−40 °C');
    expect(s.value(2, 0)).toBe(-118);
  });

  it('keeps the unit in an Excel file', async () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => { s.setInput(0, 0, 'Temp'); s.setInput(1, 0, '-78 °C'); s.setInput(1, 1, '5 mol%'); });
    const bytes = await writeXlsx(wb, pictures);
    const styles = strFromU8(unzipSync(bytes)['xl/styles.xml']);
    expect(styles).toContain('formatCode="0&quot; °C&quot;;&quot;−&quot;0&quot; °C&quot;"');
    const sheet1 = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(sheet1).toMatch(/<c r="A2"[^>]*><v>-78<\/v>/);
    const back = (await readXlsx(bytes)).book.sheets[0];
    expect(back.value(1, 0)).toBe(-78);
    expect(back.shownText(1, 0)).toBe('−78 °C');
    expect(back.shownText(1, 1)).toBe('5 mol%');
  });
});
