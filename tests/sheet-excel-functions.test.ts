// Excel's lookup, conditional, text and statistics functions in Sheet mode. The expected
// results were worked out by LibreOffice Calc from the same cells (it follows Excel for these
// functions), and agree with the examples in Microsoft's function reference; where the two give
// different error codes the test expects the one Microsoft documents.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { parseCellRef } from '../src/sheet/refs';
import { CellError, Value } from '../src/sheet/values';

const DATA: Record<string, string | number> = { A1: 1345, A2: 1301, A3: 1368, A4: 1322, A5: 1310, A6: 1370, A7: 1318, A8: 1350, A9: 1303, A10: 1299, B1: 3, B2: 4, B3: 5, B4: 8, B5: 9, B6: 1, B7: 2, B8: 4, B9: 5, C1: 6, C2: 19, C3: 3, C4: 2, C5: 14, C6: 4, C7: 5, C8: 17, C9: 1, D1: 11, D2: 12, D3: 13, D4: 14, D5: 15, D6: 16, E1: 33100, E2: 47300, E3: 69000, E4: 102000, E5: 150000, E6: 220000, F1: "Pd(OAc)2", F2: "PPh3", F3: "Cs2CO3", F4: "Toluene", F5: "Ph-Br", G1: 224.51, G2: 262.29, G3: 325.82, G4: 92.14, G5: 157.01, H1: 0.05, H2: 0.1, H3: 2, H5: 1, I1: 1, I2: 2, I3: 4, I4: 7, I5: 8, I6: 9, I7: 10, I8: 12, J1: 7, J2: 3.5, J3: 3.5, J4: 1, J5: 2, K1: "Pd-catalysed Suzuki coupling", K2: "a,b;c,d", K3: "1,234.5", K4: "25%", K5: 0.125, L1: 1, L2: 9, L3: 5, L4: 7, M1: 0, M2: 4, M3: 2, M4: 3, N1: 3.1, N2: 4.9, N3: 7.2, N4: 8.8, N5: 11.1, N6: 13.2, O1: 1, O2: 2, O3: 3, O4: 4, O5: 5, O6: 6, P1: 2, P2: 1, P3: 4, P4: 3, P5: 6, P6: 5, Q1: "Ph", Q2: "Me", Q3: "Ph", Q4: "Et", Q5: "ph", Q7: "Bn", Q8: "Ph*", R1: 10, R2: 20, R3: 30, R4: 40, R5: 50, R6: 60, R7: 70, R8: 80, S1: 0.5, S2: 0.9, S3: 0.7, S4: "n/a", S5: 0.8, S6: 0.3, S7: 0.95, S8: 0.6, T1: "a", U1: "b", V1: "c", W1: "d", T2: 1, U2: 2, V2: 3, W2: 4, T3: 10, U3: 20, V3: 30, W3: 40, X1: 10, X2: 20, X3: 30, X4: 40, X5: 50, Y1: "ten", Y2: "twenty", Y3: "thirty", Y4: "forty", Y5: "fifty", Z1: 50, Z2: 40, Z3: 30, Z4: 20, Z5: 10 };

/** A workbook with DATA typed in, and each formula in column AB. */
function book(formulas: string[], data: Record<string, string | number> = DATA): { wb: Workbook; result: (i: number) => Value | string } {
  const wb = new Workbook();
  const s = wb.sheet;
  wb.edit('fill', () => {
    for (const [k, v] of Object.entries(data)) { const r = parseCellRef(k)!; s.setInput(r.row, r.col, String(v)); }
    formulas.forEach((f, i) => s.setInput(i, 27, f));
  });
  return { wb, result: (i) => { const v = s.value(i, 27); return v instanceof CellError ? v.code : v; } };
}

function check(cases: [string, Value | string][], data?: Record<string, string | number>): void {
  const { result } = book(cases.map((c) => c[0]), data);
  cases.forEach(([f, want], i) => {
    const got = result(i);
    if (typeof want === 'number' && typeof got === 'number') expect(got, f).toBeCloseTo(want, Math.max(0, 12 - Math.ceil(Math.log10(Math.abs(want) + 1))));
    else expect(got, f).toEqual(want);
  });
}

const CASES: [string, Value | string][] = [
  ["=STDEV.S(A1:A10)", 27.4639157198435],
  ["=STDEV.P(A1:A10)", 26.0545581424825],
  ["=STDEVP(A1:A10)", 26.0545581424825],
  ["=VAR(A1:A10)", 754.266666666667],
  ["=VAR.S(A1:A10)", 754.266666666667],
  ["=VAR.P(A1:A10)", 678.84],
  ["=VARP(A1:A10)", 678.84],
  ["=STDEV(B1:B9)", 2.60341655863555],
  ["=T.TEST(B1:B9,C1:C9,2,1)", 0.196015784925282],
  ["=T.TEST(B1:B9,C1:C9,2,2)", 0.191995886760397],
  ["=T.TEST(B1:B9,C1:C9,2,3)", 0.202293923368678],
  ["=T.TEST(B1:B9,C1:C9,1,3)", 0.101146961684339],
  ["=TTEST(B1:B9,C1:C9,1,2)", 0.0959979433801984],
  ["=T.INV(0.75,2)", 0.816496580927726],
  ["=T.INV(0.025,10)", -2.22813885198628],
  ["=T.INV(0.0001,3)", -22.2037422732016],
  ["=T.INV(0.999,1)", 318.308838985542],
  ["=T.INV.2T(0.546449,60)", 0.606533075825754],
  ["=T.INV.2T(0.05,4)", 2.77644510519779],
  ["=TINV(0.05,30)", 2.04227245630124],
  ["=T.DIST(60,1,TRUE)", 0.994695326367377],
  ["=T.DIST(8,3,FALSE)", 0.000736906520946927],
  ["=T.DIST.2T(1.959999998,60)", 0.0546449299759211],
  ["=T.DIST.RT(1.959999998,60)", 0.0273224649879605],
  ["=TDIST(1.5,7,1)", 0.0886492434949852],
  ["=CONFIDENCE.NORM(0.05,2.5,50)", 0.692951912174839],
  ["=CONFIDENCE(0.05,2.5,50)", 0.692951912174839],
  ["=CONFIDENCE.T(0.05,1,50)", 0.28419685549573],
  ["=CONFIDENCE.T(0.01,0.3,5)", 0.617704146431804],
  ["=NORM.S.INV(0.908789)", 1.33333467304411],
  ["=NORM.S.INV(0.000001)", -4.7534243088229],
  ["=NORM.INV(0.908789,40,1.5)", 42.0000020095662],
  ["=NORM.DIST(42,40,1.5,TRUE)", 0.908788780274132],
  ["=NORM.DIST(42,40,1.5,FALSE)", 0.109340049783996],
  ["=NORM.S.DIST(1.333333,TRUE)", 0.908788725604095],
  ["=LINEST(L1:L4,M1:M4)", 2],
  ["=INDEX(LINEST(L1:L4,M1:M4),1,2)", 1],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),1,1)", 0.102083333333333],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),1,2)", 1.93541666666667],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),1,3)", 0.918749999999999],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),2,1)", 0.0656057070405942],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),2,2)", 0.0656057070405942],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),2,3)", 0.148365906223868],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),3,1)", 0.999009808718343],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),3,2)", 0.153659074288214],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),3,3)", "#N/A"],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),4,1)", 1513.35882352942],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),4,2)", 3],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),5,1)", 71.4641666666667],
  ["=INDEX(LINEST(N1:N6,O1:P6,TRUE,TRUE),5,2)", 0.0708333333333329],
  ["=INDEX(LINEST(N1:N6,O1:O6,FALSE,TRUE),1,1)", 2.24615384615385],
  ["=INDEX(LINEST(N1:N6,O1:O6,FALSE,TRUE),2,1)", 0.0521231391984267],
  ["=INDEX(LINEST(N1:N6,O1:O6,FALSE,TRUE),3,1)", 0.997314752153462],
  ["=INDEX(LINEST(N1:N6,O1:O6,FALSE,TRUE),4,1)", 1857.02551337897],
  ["=INDEX(LINEST(N1:N6),1,1)", 2.02],
  ["=LOGEST(E1:E6,D1:D6)", 1.46327562811618],
  ["=INDEX(LOGEST(E1:E6,D1:D6),1,2)", 495.304770158729],
  ["=INDEX(LOGEST(E1:E6,D1:D6,TRUE,TRUE),2,1)", 0.00263340289142511],
  ["=INDEX(LOGEST(E1:E6,D1:D6,TRUE,TRUE),3,1)", 0.999808619775818],
  ["=PERCENTILE(I1:I8,0.3)", 4.3],
  ["=PERCENTILE.INC(I1:I8,0.95)", 11.3],
  ["=PERCENTILE.EXC(I1:I8,0.25)", 2.5],
  ["=PERCENTILE.EXC(I1:I8,0.05)", "#NUM!"],
  ["=QUARTILE(I1:I8,1)", 3.5],
  ["=QUARTILE.INC(I1:I8,3)", 9.25],
  ["=QUARTILE.EXC(I1:I8,1)", 2.5],
  ["=QUARTILE.EXC(I1:I8,3)", 9.75],
  ["=QUARTILE(I1:I8,5)", "#NUM!"],
  ["=RANK(J2,J1:J5,1)", 3],
  ["=RANK(J1,J1:J5)", 1],
  ["=RANK.EQ(3.5,J1:J5)", 2],
  ["=RANK.AVG(3.5,J1:J5)", 2.5],
  ["=RANK.AVG(3.5,J1:J5,1)", 3.5],
  ["=RANK(5,J1:J5)", "#N/A"],
  ["=LARGE(I1:I8,3)", 9],
  ["=SMALL(I1:I8,4)", 7],
  ["=LARGE(I1:I8,9)", "#NUM!"],
  ["=LARGE(I1:I8,2.5)", 9],
  ["=SMALL(I1:I8,1.2)", 1],
  ["=SUMIF(Q1:Q8,\"Ph\",R1:R8)", 90],
  ["=SUMIF(Q1:Q8,\"Ph*\",R1:R8)", 170],
  ["=SUMIF(Q1:Q8,\"Ph~*\",R1:R8)", 80],
  ["=SUMIF(R1:R8,\">30\")", 300],
  ["=SUMIF(R1:R8,\"<>30\")", 330],
  ["=SUMIF(Q1:Q8,\"\",R1:R8)", 60],
  ["=SUMIF(Q1:Q8,\"<>Ph\",R1:R8)", 270],
  ["=SUMIF(Q1:Q8,\"?h\",R1:R8)", 90],
  ["=SUMIF(Q1:Q8,\">=M\",R1:R8)", 190],
  ["=COUNTIF(Q1:Q8,\"Ph\")", 3],
  ["=COUNTIF(Q1:Q8,\"*\")", 7],
  ["=COUNTIF(Q1:Q8,\"<>\")", 7],
  ["=COUNTIF(Q1:Q8,\"\")", 1],
  ["=COUNTIF(S1:S8,\">0.6\")", 4],
  ["=COUNTIF(R1:R8,30)", 1],
  ["=COUNTIF(R1:R8,\"30\")", 1],
  ["=COUNTIF(H1:H5,\"=\")", 1],
  ["=COUNTIFS(Q1:Q8,\"Ph*\",R1:R8,\">20\")", 3],
  ["=SUMIFS(R1:R8,Q1:Q8,\"Ph\",S1:S8,\">0.6\")", 80],
  ["=AVERAGEIF(Q1:Q8,\"Ph\",S1:S8)", 0.666666666666667],
  ["=AVERAGEIF(Q1:Q8,\"zz\",S1:S8)", "#DIV/0!"],
  ["=AVERAGEIFS(R1:R8,S1:S8,\">=0.7\",R1:R8,\"<80\")", 42.5],
  ["=MAXIFS(R1:R8,Q1:Q8,\"Ph\")", 50],
  ["=MINIFS(R1:R8,Q1:Q8,\"ph\",S1:S8,\">0.6\")", 30],
  ["=MAXIFS(R1:R8,Q1:Q8,\"zz\")", 0],
  ["=IFS(R1>50,\"big\",R1>5,\"mid\",TRUE,\"small\")", "mid"],
  ["=IFS(R1>50,\"big\")", "#N/A"],
  ["=SWITCH(Q2,\"Ph\",\"phenyl\",\"Me\",\"methyl\",\"other\")", "methyl"],
  ["=SWITCH(Q4,\"Ph\",\"phenyl\",\"Me\",\"methyl\",\"other\")", "other"],
  ["=SWITCH(Q4,\"Ph\",\"phenyl\")", "#N/A"],
  ["=VLOOKUP(\"cs2co3\",F1:H5,2,FALSE)", 325.82],
  ["=VLOOKUP(\"Tol*\",F1:H5,2,FALSE)", 92.14],
  ["=VLOOKUP(\"Zn\",F1:H5,2,FALSE)", "#N/A"],
  ["=VLOOKUP(35,X1:Y5,2)", "thirty"],
  ["=VLOOKUP(35,X1:Y5,2,TRUE)", "thirty"],
  ["=VLOOKUP(5,X1:Y5,2,TRUE)", "#N/A"],
  ["=VLOOKUP(50,X1:Y5,2)", "fifty"],
  ["=VLOOKUP(99,X1:Y5,2)", "fifty"],
  ["=VLOOKUP(\"PPh3\",F1:H5,4,FALSE)", "#REF!"],
  ["=VLOOKUP(\"PPh3\",F1:H5,0,FALSE)", "#VALUE!"],
  ["=HLOOKUP(\"c\",T1:W3,3,FALSE)", 30],
  ["=HLOOKUP(\"c\",T1:W3,2)", 3],
  ["=MATCH(35,X1:X5)", 3],
  ["=MATCH(35,X1:X5,1)", 3],
  ["=MATCH(40,X1:X5,0)", 4],
  ["=MATCH(35,Z1:Z5,-1)", 2],
  ["=MATCH(\"p*\",F1:F5,0)", 1],
  ["=MATCH(5,X1:X5)", "#N/A"],
  ["=INDEX(F1:H5,3,2)", 325.82],
  ["=INDEX(X1:X5,2)", 20],
  ["=INDEX(T1:W1,3)", "c"],
  ["=INDEX(F1:H5,6,1)", "#REF!"],
  ["=SUM(INDEX(F1:H5,0,2))", 1061.77],
  ["=SUM(INDEX(T1:W3,2,0))", 10],
  ["=INDEX(F1:H5,MATCH(\"Toluene\",F1:F5,0),2)", 92.14],
  ["=CHOOSE(2,\"a\",\"b\",\"c\")", "b"],
  ["=CHOOSE(4,\"a\",\"b\",\"c\")", "#VALUE!"],
  ["=CHOOSE(2.9,\"a\",\"b\",\"c\")", "b"],
  ["=SUM(OFFSET(X1,1,0,3,1))", 90],
  ["=OFFSET(X1,2,1)", "thirty"],
  ["=OFFSET(X1,-1,0)", "#REF!"],
  ["=SUM(OFFSET(T1:W3,1,0,1))", 10],
  ["=INDIRECT(\"G2\")", 262.29],
  ["=SUM(INDIRECT(\"X1:X5\"))", 150],
  ["=INDIRECT(\"R3C7\",FALSE)", 325.82],
  ["=INDIRECT(\"nonsense\")", "#REF!"],
  ["=LEFT(K1,2)", "Pd"],
  ["=LEFT(K1)", "P"],
  ["=RIGHT(K1,8)", "coupling"],
  ["=RIGHT(K1,100)", "Pd-catalysed Suzuki coupling"],
  ["=MID(K1,4,9)", "catalysed"],
  ["=MID(K1,40,3)", ""],
  ["=FIND(\"S\",K1)", 14],
  ["=FIND(\"s\",K1)", 10],
  ["=FIND(\"z\",K1)", 16],
  ["=SEARCH(\"s\",K1)", 10],
  ["=SEARCH(\"c?t\",K1)", 4],
  ["=SEARCH(\"u*k\",K1,5)", 15],
  ["=SUBSTITUTE(K1,\"u\",\"U\")", "Pd-catalysed SUzUki coUpling"],
  ["=SUBSTITUTE(K1,\"u\",\"U\",2)", "Pd-catalysed SuzUki coupling"],
  ["=SUBSTITUTE(K1,\"u\",\"U\",9)", "Pd-catalysed Suzuki coupling"],
  ["=REPLACE(K1,1,2,\"Ni\")", "Ni-catalysed Suzuki coupling"],
  ["=TEXT(K5,\"0.00%\")", "12.50%"],
  ["=TEXT(1234.567,\"#,##0.0\")", "1,234.6"],
  ["=TEXT(0.000123,\"0.00E+00\")", "1.23E-04"],
  ["=TEXT(-5,\"0.0;(0.0)\")", "(5.0)"],
  ["=TEXT(\"12.5\",\"0.000\")", "12.500"],
  ["=VALUE(K3)", 1234.5],
  ["=VALUE(K4)", 0.25],
  ["=VALUE(\"$12.50\")", 12.5],
  ["=VALUE(\"abc\")", "#VALUE!"],
  ["=VALUE(\"12:30\")", 0.520833333333333],
  ["=TEXTJOIN(\", \",TRUE,F1:F3,\"x\")", "Pd(OAc)2, PPh3, Cs2CO3, x"],
  ["=TEXTJOIN(\"-\",FALSE,H1:H5)", "0.05-0.1-2--1"],
  ["=TEXTJOIN(\"-\",TRUE,H1:H5)", "0.05-0.1-2-1"],
  ["=CONCAT(F1:F2,1)", "Pd(OAc)2PPh31"],
  ["=LEFT(1234.5,3)", "123"],
];

describe('Excel functions in sheets', () => {
  it('give the results Excel gives', () => check(CASES));
  it('look up with XLOOKUP and XMATCH as Microsoft describes them', () => check([
    ['=XLOOKUP("PPh3",F1:F5,G1:G5)', 262.29],
    ['=XLOOKUP("Zn",F1:F5,G1:G5,"none")', 'none'],
    ['=XLOOKUP("Zn",F1:F5,G1:G5)', '#N/A'],
    ['=XLOOKUP(35,X1:X5,Y1:Y5,,-1)', 'thirty'],
    ['=XLOOKUP(35,X1:X5,Y1:Y5,,1)', 'forty'],
    ['=XLOOKUP("Ph",Q1:Q8,R1:R8,,0,-1)', 50], // from the end; text ignores case
    ['=XLOOKUP("P*",F1:F5,G1:G5,,2)', 224.51],
    ['=SUM(XLOOKUP("PPh3",F1:F5,G1:H5))', 262.39], // a wider block gives the whole row
    ['=XLOOKUP("c",T1:W1,T3:W3)', 30],
    ['=XLOOKUP(35,X1:X5,Y1:Y4)', '#VALUE!'],
    ['=XMATCH(35,X1:X5,1)', 4],
    ['=XMATCH(35,X1:X5,-1)', 3],
    ['=XMATCH(30,Z1:Z5,0,-2)', 3],
    ['=XMATCH(35,Z1:Z5,1,-2)', 2],
    ['=XMATCH(35,X1:X5,-1,2)', 3],
    ['=XMATCH("ph",Q1:Q8,0,-1)', 5],
    ['=XMATCH("Ph*",Q1:Q8)', 8], // no wildcards unless match mode is 2
    ['=XMATCH("P?",Q1:Q8,2)', 1],
    ['=XMATCH(35,X1:X5)', '#N/A'],
  ]));
  it('split text with TEXTSPLIT', () => check([
    ['=INDEX(TEXTSPLIT(K2,",",";"),2,2)', 'd'],
    ['=TEXTSPLIT("a,b,,c",",")', 'a'], // one cell shows the first piece
    ['=COLUMNS(TEXTSPLIT("a,b,,c",","))', 4],
    ['=COLUMNS(TEXTSPLIT("a,b,,c",",",,TRUE))', 3],
    ['=INDEX(TEXTSPLIT("a,b;c",",",";"),2,2)', '#N/A'],
    ['=INDEX(TEXTSPLIT("a,b;c",",",";",,,"-"),2,2)', '-'],
    ['=COLUMNS(TEXTSPLIT("aXbxc","x"))', 2],
    ['=COLUMNS(TEXTSPLIT("aXbxc","x",,,1))', 3],
    ['=ROWS(TEXTSPLIT("1;2;3",,";"))', 3],
  ]));
  it('count the empty cells of whole columns, and handle #N/A', () => check([
    ['=COUNTIF(A:A,"")', 1048576 - 10],
    ['=COUNTIFS(A:A,">1300",B:B,"<5")', 5],
    ['=IFNA(VLOOKUP("Zn",F1:G5,2,FALSE),"missing")', 'missing'],
    ['=IFNA(1/0,"missing")', '#DIV/0!'],
    ['=ISNA(MATCH(5,X1:X5))', true],
    ['=SUMIF(F1:F5,"P*",H1:H5)', 1.15],
    ['=VLOOKUP("pph3",F1:H5,2,)', 262.29], // an empty last argument means an exact match
  ]));
  it('work out INDIRECT and OFFSET after the cells they reach, and again when those change', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      s.setInput(0, 1, '=INDIRECT("C1")'); // B1, read before C1 is worked out
      s.setInput(0, 3, '=SUM(OFFSET(A1,0,2,2,1))'); // D1: C1 + C2
      s.setInput(0, 4, 'C1'); // E1
      s.setInput(0, 5, '=INDIRECT(E1)*1'); // F1
      s.setInput(0, 6, '=B1+1'); // G1 reads a volatile cell
      s.setInput(0, 0, '5');
      s.setInput(0, 2, '=A1*2');
      s.setInput(1, 2, '=C1+1');
    });
    expect([s.value(0, 1), s.value(0, 3), s.value(0, 5), s.value(0, 6)]).toEqual([10, 21, 10, 11]);
    wb.edit('type', () => s.setInput(0, 0, '7'));
    expect([s.value(0, 1), s.value(0, 3), s.value(0, 5), s.value(0, 6)]).toEqual([14, 29, 14, 15]);
    wb.edit('type', () => s.setInput(0, 4, 'A1'));
    expect(s.value(0, 5)).toBe(7);
    wb.edit('sheet', () => { const t = wb.addSheet('Data'); t.setInput(1, 1, '42'); });
    wb.edit('type', () => s.setInput(2, 0, "=INDIRECT(\"'Data'!B2\")+INDIRECT(\"Data!R2C2\",FALSE)"));
    expect(s.value(2, 0)).toBe(84);
    wb.edit('type', () => s.setInput(3, 0, '=INDIRECT("Nowhere!A1")'));
    expect((s.value(3, 0) as CellError).code).toBe('#REF!');
  });
});
