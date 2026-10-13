// Number formats as Excel writes them, and the masses behind HRMS m/z.

import { describe, it, expect } from 'vitest';
import { formatValue, generalNumber, changeDecimals, describeFormat, decimalsOf } from '../src/sheet/numfmt';
import { CellError } from '../src/sheet/values';
import { parseAdduct, ionMz, formulaMass, ELECTRON, MONOISOTOPIC } from '../src/chem/hrms';

const show = (v: number | string | boolean | null, f?: string) => formatValue(v, f).text;

describe('number formats', () => {
  it('shows General numbers as Excel does', () => {
    expect(generalNumber(0.1 + 0.2)).toBe('0.3');
    expect(generalNumber(180.159)).toBe('180.159');
    expect(generalNumber(1 / 3)).toBe('0.333333333');
    expect(generalNumber(123456789012)).toBe('1.23457E+11');
    expect(generalNumber(0.0000001)).toBe('1E-07');
    expect(generalNumber(-42)).toBe('-42');
    expect(show(12345.678)).toBe('12345.678');
  });
  it('fixes decimal places, rounding half away from zero', () => {
    expect(show(180.159, '0.00')).toBe('180.16');
    expect(show(1.005, '0.00')).toBe('1.01');
    expect(show(2, '0.000')).toBe('2.000');
    expect(show(-0.5, '0')).toBe('-1');
    expect(show(0.5, '#.00')).toBe('.50');
    expect(show(3.1, '0.##')).toBe('3.1');
    expect(show(3, '0.##')).toBe('3.');
  });
  it('groups thousands and shows percentages', () => {
    expect(show(1234567.891, '#,##0.00')).toBe('1,234,567.89');
    expect(show(0.256, '0%')).toBe('26%');
    expect(show(0.256, '0.0%')).toBe('25.6%');
    expect(show(-0.05, '0%')).toBe('-5%');
  });
  it('shows scientific notation', () => {
    expect(show(0.00123, '0.00E+00')).toBe('1.23E-03');
    expect(show(6.02214076e23, '0.00E+00')).toBe('6.02E+23');
    expect(show(9.999, '0.00E+00')).toBe('1.00E+01');
    expect(show(0, '0.00E+00')).toBe('0.00E+00');
  });
  it('keeps literal text and uses sections for negatives and zero', () => {
    expect(show(25, '0 "mg"')).toBe('25 mg');
    expect(show(25, '0\\ °C')).toBe('25 °C');
    expect(show(-3, '0;(0)')).toBe('(3)');
    expect(show(0, '0;-0;"–"')).toBe('–');
    expect(formatValue(-3, '0;[Red]-0').color).toBe('#ff0000');
    expect(show('abc', '0.00;-0.00;0;"Note: "@')).toBe('Note: abc');
  });
  it('shows dates and times from Excel date numbers', () => {
    expect(show(45000, 'yyyy-mm-dd')).toBe('2023-03-15');
    expect(show(45000.75, 'd mmm yyyy h:mm AM/PM')).toBe('15 Mar 2023 6:00 PM');
    expect(show(45000.5, 'hh:mm:ss')).toBe('12:00:00');
  });
  it('lines up and shows text, TRUE and errors', () => {
    expect(formatValue(5).align).toBe('right');
    expect(formatValue('x').align).toBe('left');
    expect(formatValue(true)).toEqual({ text: 'TRUE', align: 'center' });
    expect(formatValue(new CellError('#DIV/0!')).text).toBe('#DIV/0!');
    expect(formatValue(new CellError('#BUSY!')).text).toBe('…');
    expect(show(5, '@')).toBe('5');
  });
  it('adds and removes decimal places as the ribbon buttons do', () => {
    expect(changeDecimals(undefined, 1, '180.159')).toBe('0.0000');
    expect(changeDecimals(undefined, -1, '180.159')).toBe('0.00');
    expect(changeDecimals('0.00', 1)).toBe('0.000');
    expect(changeDecimals('0.0', -1)).toBe('0');
    expect(changeDecimals('0', 1)).toBe('0.0');
    expect(changeDecimals('0.0%', 1)).toBe('0.00%');
    expect(changeDecimals('0.00E+00', -1)).toBe('0.0E+00');
    expect(changeDecimals('#,##0.00;[Red]-#,##0.00', 1)).toBe('#,##0.000;[Red]-#,##0.000');
    expect(changeDecimals('0 "mg"', 1)).toBe('0.0 "mg"');
  });
  it('describes formats in plain words', () => {
    expect(describeFormat(undefined)).toBe('General');
    expect(describeFormat('0.00')).toBe('Number, 2 decimal places');
    expect(describeFormat('0.0%')).toBe('Percentage, 1 decimal place');
    expect(describeFormat('0.00E+00')).toBe('Scientific, 2 decimal places');
    expect(describeFormat('@')).toBe('Text');
    expect(decimalsOf('#,##0.000')).toBe(3);
  });
});

describe('HRMS m/z', () => {
  // aspirin, C9H8O4: monoisotopic mass from the masses of its atoms
  const M = 9 * MONOISOTOPIC.C + 8 * MONOISOTOPIC.H + 4 * MONOISOTOPIC.O;
  it('weighs formulas with monoisotopic masses', () => {
    expect(M).toBeCloseTo(180.04225873, 7);
    expect(formulaMass('H2O')).toBeCloseTo(18.0105646837, 9);
    expect(formulaMass('NH4')).toBeCloseTo(18.0343741333, 9);
    expect(formulaMass('HCOO')).toBeCloseTo(44.997654, 5);
    expect(formulaMass('Xy')).toBeNull();
  });
  it('reads adducts in the usual ways', () => {
    expect(parseAdduct('[M+H]+')).toMatchObject({ n: 1, z: 1, label: '[M+H]+' });
    expect(parseAdduct('M+Na')).toMatchObject({ z: 1, label: '[M+Na]+' });
    expect(parseAdduct('[M-H]-')).toMatchObject({ z: -1 });
    expect(parseAdduct('M−H')).toMatchObject({ z: -1, label: '[M-H]-' });
    expect(parseAdduct('[M+2H]2+')).toMatchObject({ z: 2 });
    expect(parseAdduct('[2M+NH4]+')).toMatchObject({ n: 2, z: 1 });
    expect(parseAdduct('[M]+')).toMatchObject({ z: 1, parts: [] });
    expect(parseAdduct('[M+H-H2O]+').parts).toHaveLength(2);
    expect(() => parseAdduct('[M+H2O]')).toThrow(/charge/);
    expect(() => parseAdduct('hello')).toThrow(/adduct/);
  });
  it('gives m/z with the electron mass taken into account', () => {
    expect(ionMz(M, '[M+H]+')).toBeCloseTo(181.0495352, 6);
    expect(ionMz(M, '[M+Na]+')).toBeCloseTo(203.0314794, 6);
    expect(ionMz(M, '[M-H]-')).toBeCloseTo(179.0349823, 6);
    expect(ionMz(M, '[M+2H]2+')).toBeCloseTo(91.0284058, 6);
    expect(ionMz(M, '[2M+Na]+')).toBeCloseTo(2 * M + MONOISOTOPIC.Na - ELECTRON, 9);
    expect(ionMz(M, '[M]+')).toBeCloseTo(M - ELECTRON, 9);
  });
});
