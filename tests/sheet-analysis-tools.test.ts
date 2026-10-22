// The Analysis ToolPak's reports, checked against SciPy 1.x for the same data (the layouts follow
// Excel's own reports), and the worksheet functions that go with them.

import { describe, expect, it } from 'vitest';
import {
  anovaSingle, anovaTwoNoRep, anovaTwoRep, descriptive, fTest, fourier, groupsOf, histogram, matrix, movingAverage, expSmoothing,
  rankPercentile, regression, tTest, zTest, randomNumbers, seededRandom, sample, readComplex, complexText, type Group, type ToolOutput,
} from '../src/sheet/analysis-tools';
import { Workbook } from '../src/sheet/workbook';

const A = [12.1, 13.4, 11.8, 14.2, 12.9, 13.3, 12.5];
const B = [11.2, 12.9, 11.1, 13.0, 12.2, 12.8, 11.9];
const C = [10.5, 11.0, 10.9, 11.6, 10.2];
const g = (label: string, xs: number[]): Group => ({ label, values: xs });

/** The value beside a row label in a report. */
function look(out: ToolOutput | string, label: string, col = 1): unknown {
  if (typeof out === 'string') throw new Error(out);
  // the last row with the label (ANOVA's Total comes after a summary block called Total)
  const row = out.cells.findLast((r) => r.includes(label));
  if (!row) throw new Error(`no row ${label}`);
  return row[row.indexOf(label) + col];
}

describe('Analysis ToolPak', () => {
  it('reads groups from columns or rows, with labels', () => {
    const got = groupsOf([['Yield', 'ee'], [80, 90], [null, 92]], false, true);
    expect(got).toEqual([{ label: 'Yield', values: [80, null] }, { label: 'ee', values: [90, 92] }]);
    expect(groupsOf([[1, 2], [3, 4]], true, false)).toEqual([{ label: 'Row 1', values: [1, 2] }, { label: 'Row 2', values: [3, 4] }]);
    expect(typeof groupsOf([['x'], [1]], false, false)).toBe('string');
  });

  it('t-tests match SciPy', () => {
    const p = tTest('paired', g('Column 1', A), g('Column 2', B), 0, 0.05);
    expect(look(p, 't Stat')).toBeCloseTo(7.717829066271378, 10);
    expect(look(p, 'P(T<=t) two-tail')).toBeCloseTo(0.0002481920869409264, 12);
    expect(look(p, 'df')).toBe(6);
    const e = tTest('equal', g('A', A), g('B', B), 0, 0.05);
    expect(look(e, 't Stat')).toBeCloseTo(1.6814202071592548, 10);
    expect(look(e, 'P(T<=t) two-tail')).toBeCloseTo(0.11850058170893045, 10);
    expect(look(e, 'P(T<=t) one-tail')).toBeCloseTo(0.11850058170893045 / 2, 10);
    expect(look(e, 't Critical two-tail')).toBeCloseTo(2.1788128296672284, 8);
    if (typeof e !== 'string') expect(e.cells[2]).toEqual(['', 'A', 'B']);
    const u = tTest('unequal', g('Column 1', A), g('Column 2', B), 0, 0.05);
    expect(look(u, 'df')).toBe(12);
    expect(look(u, 'P(T<=t) two-tail')).toBeCloseTo(0.11850058170893045, 10);
  });

  it('F-test, z-test', () => {
    const f = fTest(g('Column 1', A), g('Column 2', B), 0.05);
    expect(look(f, 'F')).toBeCloseTo(1.0877458396369124, 10);
    expect(look(f, 'P(F<=f) one-tail')).toBeCloseTo(0.4606442024334205, 9);
    expect(look(f, 'F Critical one-tail')).toBeCloseTo(4.283865713822639, 8);
    const z = zTest(g('Column 1', A), g('Column 2', B), 0.5, 0.5, 0, 0.05);
    const zv = (A.reduce((s, x) => s + x, 0) - B.reduce((s, x) => s + x, 0)) / 7 / Math.sqrt(1 / 7);
    expect(look(z, 'z')).toBeCloseTo(zv, 10);
    expect(look(z, 'z Critical two-tail')).toBeCloseTo(1.959963984540054, 9);
  });

  it('single-factor ANOVA matches SciPy', () => {
    const out = anovaSingle([g('A', A), g('B', B), g('C', C)], 0.05);
    expect(look(out, 'Between Groups', 4)).toBeCloseTo(10.888670253035794, 9);
    expect(look(out, 'Between Groups', 5)).toBeCloseTo(0.001035401561874107, 10);
    expect(look(out, 'Between Groups', 6)).toBeCloseTo(3.633723467591628, 8);
    expect(look(out, 'Within Groups', 2)).toBe(16);
    expect(look(out, 'C', 1)).toBe(5);
  });

  it('two-factor ANOVA without replication', () => {
    const M = [[4, 5, 6], [5, 7, 8], [6, 6, 9], [7, 8, 10]];
    const out = anovaTwoNoRep(M, ['R1', 'R2', 'R3', 'R4'], ['C1', 'C2', 'C3'], 0.05);
    expect(look(out, 'Rows', 1)).toBeCloseTo(16.91666666666667, 10);
    expect(look(out, 'Rows', 4)).toBeCloseTo(18.454545454545507, 8);
    expect(look(out, 'Rows', 5)).toBeCloseTo(0.0019683750207417244, 10);
    expect(look(out, 'Columns', 5)).toBeCloseTo(0.0011832541533909793, 10);
    expect(look(out, 'Error', 2)).toBe(6);
  });

  it('two-factor ANOVA with replication adds up', () => {
    const block = [[null, 'Pd', 'Ni'], ['Hot', 80, 70], [null, 82, 72], ['Cold', 60, 66], [null, 62, 64]];
    const out = anovaTwoRep(block, 2, 0.05);
    if (typeof out === 'string') throw new Error(out);
    const ss = (l: string) => look(out, l, 1) as number;
    expect(ss('Sample') + ss('Columns') + ss('Interaction') + ss('Within')).toBeCloseTo(ss('Total'), 9);
    expect(ss('Within')).toBeCloseTo(8, 9);
    expect(look(out, 'Within', 2)).toBe(4);
    expect(out.cells[2].slice(0, 4)).toEqual(['SUMMARY', 'Pd', 'Ni', 'Total']);
  });

  it('regression matches least squares', () => {
    const y = [3.1, 4.9, 7.2, 8.8, 11.1, 13.2, 14.8, 17.1];
    const x1 = [1, 2, 3, 4, 5, 6, 7, 8], x2 = [2.0, 1.5, 3.2, 2.2, 4.1, 3.0, 4.8, 5.5];
    const out = regression(y, [x1, x2], { residuals: true, standardResiduals: true, normalProbability: true });
    expect(look(out, 'R Square')).toBeCloseTo(0.9989452164416804, 12);
    expect(look(out, 'Adjusted R Square')).toBeCloseTo(0.9985233030183527, 12);
    expect(look(out, 'Regression', 4)).toBeCloseTo(2367.654502581512, 6);
    expect(look(out, 'Regression', 5)).toBeCloseTo(3.61333625607623e-08, 15);
    expect(look(out, 'Intercept', 1)).toBeCloseTo(0.96095684, 7);
    expect(look(out, 'Intercept', 2)).toBeCloseTo(0.18061296, 7);
    expect(look(out, 'X Variable 1', 3)).toBeCloseTo(32.91827219, 6);
    expect(look(out, 'X Variable 2', 4)).toBeCloseTo(0.510222287, 8);
    expect(look(out, 'X Variable 2', 5)).toBeCloseTo(-0.19231143, 7);
    if (typeof out === 'string') return;
    const head = out.cells.findIndex((r) => r.includes('Standard Residuals'));
    expect(out.cells[head + 6][3]).toBeCloseTo(1.6030347, 6);
    const prob = out.cells.findIndex((r) => r.includes('Percentile'));
    expect(out.cells[prob + 1].slice(5, 7)).toEqual([6.25, 3.1]);
  });

  it('descriptive statistics', () => {
    const out = descriptive([g('Yield', A)], { summary: true, confidence: 95, kLargest: 2, kSmallest: 1 });
    expect(look(out, 'Mean')).toBeCloseTo(12.885714285714286, 12);
    expect(look(out, 'Skewness')).toBeCloseTo(0.2697592532333069, 10);
    expect(look(out, 'Kurtosis')).toBeCloseTo(-0.5473085977472238, 10);
    expect(look(out, 'Largest(2)')).toBe(13.4);
    expect(look(out, 'Smallest(1)')).toBe(11.8);
    expect((look(out, 'Mode') as { code: string }).code).toBe('#N/A');
    expect(look(out, 'Count')).toBe(7);
  });

  it('histogram counts each number into the first bin at or above it', () => {
    const out = histogram([1, 2, 2, 3, 5, 8, 9], { bins: [2, 5], cumulative: true, pareto: true });
    if (typeof out === 'string') throw new Error(out);
    expect(out.cells.slice(0, 4).map((r) => r.slice(0, 3))).toEqual([['Bin', 'Frequency', 'Cumulative %'], [2, 3, 3 / 7], [5, 2, 5 / 7], ['More', 2, 1]]);
    expect(out.cells[1].slice(4, 6)).toEqual([2, 3]);
  });

  it('correlation and covariance', () => {
    const c = matrix([g('A', A), g('B', B)], 'correlation');
    if (typeof c === 'string') throw new Error(c);
    expect(c.cells[1][1]).toBeCloseTo(1, 12);
    expect(c.cells[1][2]).toBeNull();
    const cov = matrix([g('A', A), g('B', B)], 'covariance');
    if (typeof cov === 'string') throw new Error(cov);
    const ma = A.reduce((s, x) => s + x, 0) / 7;
    expect(cov.cells[1][1]).toBeCloseTo(A.reduce((s, x) => s + (x - ma) ** 2, 0) / 7, 12);
  });

  it('moving average and smoothing are formulas', () => {
    const refs = ['$B$2', '$B$3', '$B$4', '$B$5'];
    const m = movingAverage(refs, 3, false);
    if (typeof m === 'string') throw new Error(m);
    expect(m.cells.map((r) => r[0])).toMatchObject([{ code: '#N/A' }, { code: '#N/A' }, { f: '=AVERAGE($B$2:$B$4)' }, { f: '=AVERAGE($B$3:$B$5)' }]);
    const e = expSmoothing(refs, 0.3, false);
    if (typeof e === 'string') throw new Error(e);
    expect(e.cells.map((r) => r[0])).toMatchObject([{ code: '#N/A' }, { f: '=$B$2' }, { f: '=0.7*$B$3+0.3*%OUT1' }, { f: '=0.7*$B$4+0.3*%OUT2' }]);
  });

  it('rank and percentile', () => {
    const out = rankPercentile([g('Yield', [70, 90, 80, 90])]);
    if (typeof out === 'string') throw new Error(out);
    expect(out.cells.slice(1).map((r) => r.slice(0, 4))).toEqual([[2, 90, 1, 0.666], [4, 90, 1, 0.666], [3, 80, 3, 0.333], [1, 70, 4, 0]]);
  });

  it('random numbers and sampling repeat with a seed', () => {
    const a = randomNumbers({ kind: 'normal', mean: 10, sd: 2 }, 2, 500, seededRandom(42));
    const b = randomNumbers({ kind: 'normal', mean: 10, sd: 2 }, 2, 500, seededRandom(42));
    expect(a).toEqual(b);
    if (typeof a === 'string') throw new Error(a);
    const xs = a.cells.map((r) => r[0] as number);
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeGreaterThan(9.6);
    const pat = randomNumbers({ kind: 'patterned', from: 1, to: 3, step: 1, repeatEach: 2, repeatSeq: 1 }, 1, 0, seededRandom(1));
    if (typeof pat === 'string') throw new Error(pat);
    expect(pat.cells.map((r) => r[0])).toEqual([1, 1, 2, 2, 3, 3]);
    const s = sample([1, 2, 3, 4, 5, 6], { periodic: 2 }, seededRandom(1));
    if (typeof s === 'string') throw new Error(s);
    expect(s.cells.map((r) => r[0])).toEqual([2, 4, 6]);
  });

  it('Fourier analysis and its inverse', () => {
    const out = fourier([1, 2, 3, 4], false);
    if (typeof out === 'string') throw new Error(out);
    expect(out.cells.map((r) => r[0])).toEqual(['10', '-2+2i', '-2', '-2-2i']);
    const back = fourier(out.cells.map((r) => r[0] as string), true);
    if (typeof back === 'string') throw new Error(back);
    expect(back.cells.map((r) => r[0])).toEqual(['1', '2', '3', '4']);
    expect(readComplex('3-4.5j')).toEqual([3, -4.5]);
    expect(readComplex('-i')).toEqual([0, -1]);
    expect(complexText(0, 1)).toBe('i');
    expect(typeof fourier([1, 2, 3], false)).toBe('string');
  });
});

describe('the functions that go with it', () => {
  const book = () => {
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.edit('data', () => A.forEach((x, i) => { s.setInput(i, 0, String(x)); s.setInput(i, 1, String(B[i])); }));
    return { wb, s };
  };
  const calc = (f: string) => {
    const { wb, s } = book();
    wb.edit('f', () => s.setInput(0, 5, f));
    return s.value(0, 5);
  };
  it('F distribution', () => {
    expect(calc('=F.DIST(2.5,3,10,TRUE)')).toBeCloseTo(0.8809604373417219, 12);
    expect(calc('=F.DIST(2.5,3,10,FALSE)')).toBeCloseTo(0.09254817169049535, 12);
    expect(calc('=F.INV(0.9,3,10)')).toBeCloseTo(2.7276731411650688, 9);
    expect(calc('=F.INV.RT(0.05,6,6)')).toBeCloseTo(4.283865713822639, 9);
    expect(calc('=F.TEST(A1:A7,B1:B7)')).toBeCloseTo(2 * 0.4606442024334205, 9);
  });
  it('skew, kurtosis, mode, covariance, sums of squares, percent rank', () => {
    expect(calc('=SKEW(A1:A7)')).toBeCloseTo(0.2697592532333069, 10);
    expect(calc('=KURT(A1:A7)')).toBeCloseTo(-0.5473085977472238, 10);
    expect(calc('=MODE.SNGL(1,2,2,3,3)')).toBe(2);
    expect(calc('=COVARIANCE.S(A1:A7,B1:B7)')).toBeCloseTo(calc('=COVARIANCE.P(A1:A7,B1:B7)') as number * 7 / 6, 12);
    expect(calc('=SUMXMY2({1,2,3},{2,2,5})')).toBe(5);
    expect(calc('=PERCENTRANK.INC({1,2,3,4,5,6,7,8,9,10},4)')).toBe(0.333);
    expect(calc('=PERCENTRANK.INC({1,2,3,4,5,6,7,8,9,10},8.5)')).toBe(0.833);
    expect(calc('=PERCENTRANK.EXC({1,2,3,4,5,6,7,8,9,10},4)')).toBe(0.363);
  });
});
