// A chart with its own little table of data, for Document and Slides modes (Insert > Chart), as
// Word and PowerPoint keep one: the chart is Sheet mode's chart, and its series point at cells of
// a one-sheet workbook that travels with it. Editing the data opens that workbook in a grid, so
// formulas, pasting from Excel and everything else a sheet does work there too. Saved in Word and
// PowerPoint files as their own charts, with the workbook embedded for their Edit Data.

import { Workbook, type Sheet } from './workbook';
import { Chart, ChartKind, SeriesData, chartData, chartFromRange, newChartId, mapChartRefs, isXY } from './chart';
import { MAX_COLS } from './refs';
import { renameSheetInFormula } from './formula';

export interface ChartBox {
  chart: Chart;
  /** What is typed in each cell of the data sheet, row by row ('' for an empty cell). */
  cells: string[][];
  /** The data sheet's name, when it is not Sheet1 (a chart from Word or PowerPoint may name another). */
  sheet?: string;
}

/** The data sheet's name. */
export const boxSheetName = (b: ChartBox): string => b.sheet ?? 'Sheet1';

/** Points to the chart's own pixels (96 to the inch), and back. */
export const PX_PER_PT = 96 / 72;

const books = new WeakMap<ChartBox, { wb: Workbook; sheet: Sheet }>();

/** The chart's data as a workbook (worked out once for each box: boxes are never changed in place). */
export function boxBook(b: ChartBox): { wb: Workbook; sheet: Sheet } {
  let got = books.get(b);
  if (!got) {
    const wb = new Workbook([boxSheetName(b)]);
    const sheet = wb.sheet;
    wb.build(() => b.cells.forEach((row, r) => row.forEach((t, c) => { if (t !== '') sheet.setInput(r, c, t); })));
    got = { wb, sheet };
    books.set(b, got);
  }
  return got;
}

/** The series made ready to draw. */
export function boxData(b: ChartBox): SeriesData[] {
  const { wb, sheet } = boxBook(b);
  return chartData(wb, sheet, b.chart);
}

/** What is typed in each cell of a sheet, as a box keeps it (trailing empty rows and cells left off). */
export function sheetCells(sheet: Sheet): string[][] {
  const out: string[][] = [];
  for (const [key, cell] of sheet.cells) {
    const text = cell.input ?? '';
    if (!text) continue;
    const r = Math.floor(key / MAX_COLS), c = key % MAX_COLS;
    while (out.length <= r) out.push([]);
    const row = out[r];
    while (row.length < c) row.push('');
    row[c] = text;
  }
  for (const row of out) for (let i = 0; i < row.length; i++) row[i] ??= '';
  return out;
}

/** The sample data a new chart starts with (to be typed over), as Word and PowerPoint give one. */
export function sampleCells(kind: ChartKind): string[][] {
  if (kind === 'scatter') {
    return [
      ['Time (min)', 'Conversion (%)'],
      ['0', '0'], ['10', '22'], ['20', '41'], ['30', '55'], ['45', '71'], ['60', '82'], ['90', '93'],
    ];
  }
  if (kind === 'pie') return [['Product', 'Yield'], ['Major', '72'], ['Minor', '18'], ['Recovered', '10']];
  if (kind === 'histogram') {
    return [['Yield (%)'], ...['62', '71', '68', '75', '80', '66', '73', '78', '84', '70', '77', '69', '74', '81', '72', '65', '79', '76', '88', '58'].map((v) => [v])];
  }
  if (kind === 'box') {
    const runs: [string, string[]][] = [['Pd(OAc)₂', ['78', '81', '74', '80', '76', '62']], ['Pd₂(dba)₃', ['85', '88', '83', '86', '90', '84']], ['PdCl₂', ['41', '45', '38', '50', '43', '44']]];
    return [['Catalyst', 'Yield (%)'], ...runs.flatMap(([cat, ys]) => ys.map((y) => [cat, y]))];
  }
  if (kind === 'bubble') {
    return [
      ['Temperature (°C)', 'Yield (%)', 'Scale (mmol)'],
      ['25', '42', '0.5'], ['40', '61', '1'], ['60', '78', '2'], ['80', '85', '5'], ['100', '71', '10'],
    ];
  }
  if (kind === 'combo') {
    return [
      ['Catalyst', 'Yield (%)', 'TON'],
      ['Pd(OAc)₂', '78', '780'],
      ['Pd₂(dba)₃', '85', '1700'],
      ['Pd(PPh₃)₄', '62', '620'],
      ['PdCl₂', '41', '410'],
    ];
  }
  if (kind === 'sankey') {
    return [
      ['Ring', 'Size', 'Heterocycle', 'Drugs'],
      ['Aromatic', '6-membered', 'Pyridine', '54'], ['Aromatic', '6-membered', 'Pyrimidine', '13'], ['Aromatic', '5-membered', 'Imidazole', '15'],
      ['Saturated', '6-membered', 'Piperidine', '40'], ['Saturated', '6-membered', 'Piperazine', '36'], ['Saturated', '5-membered', 'Pyrrolidine', '25'],
    ];
  }
  if (kind === 'radar') {
    return [
      ['Property', 'Ligand A', 'Ligand B'],
      ['Yield', '8', '6'], ['ee', '9', '5'], ['Rate', '5', '9'], ['Stability', '7', '8'], ['Cost', '4', '7'],
    ];
  }
  return [
    ['Catalyst', 'Yield (%)', 'ee (%)'],
    ['Pd(OAc)₂', '78', '64'],
    ['Pd₂(dba)₃', '85', '71'],
    ['Pd(PPh₃)₄', '62', '55'],
    ['PdCl₂', '41', '38'],
  ];
}

/** A new chart of the sample data, `w` × `h` points. */
export function newChartBox(kind: ChartKind, w = 360, h = 216): ChartBox {
  const cells = sampleCells(kind);
  const wb = new Workbook(['Sheet1']);
  const sheet = wb.sheet;
  wb.build(() => cells.forEach((row, r) => row.forEach((t, c) => sheet.setInput(r, c, t))));
  const chart = chartFromRange(sheet, { r1: 0, c1: 0, r2: cells.length - 1, c2: cells[0].length - 1 }, kind);
  chart.at = { row: 0, col: 0, dx: 0, dy: 0 };
  chart.w = Math.round(w * PX_PER_PT);
  chart.h = Math.round(h * PX_PER_PT);
  if (kind === 'histogram') chart.y = { ...chart.y, title: 'Count' };
  else if (kind === 'combo') { chart.y = { ...chart.y, title: 'Yield (%)' }; chart.y2 = { title: 'TON' }; }
  else if (kind !== 'pie' && !isXY(kind) && kind !== 'radar' && kind !== 'sankey' && !chart.y.title) chart.y = { ...chart.y, title: '%' };
  return { chart, cells };
}

/** A box whose chart is `w` × `h` points (the size it is shown at). */
export function sizedBox(b: ChartBox, w: number, h: number): ChartBox {
  const cw = Math.max(40, Math.round(w * PX_PER_PT)), ch = Math.max(40, Math.round(h * PX_PER_PT));
  return cw === b.chart.w && ch === b.chart.h ? b : { ...b, chart: { ...b.chart, w: cw, h: ch } };
}

/** A copy with a fresh chart id (a chart pasted or read from a file). */
export function freshBox(b: ChartBox): ChartBox {
  return { ...structuredClone(b), chart: { ...structuredClone(b.chart), id: newChartId() } };
}

/**
 * A box from a chart and the numbers and labels Word, PowerPoint or Excel cached beside its
 * references: each cached value is put back in its cell, so the chart reads the same data. A
 * chart naming several sheets has them all put on one.
 */
export function boxFromCaches(chart: Chart, caches: { ref: string; values: string[] }[]): ChartBox {
  const cells: string[][] = [];
  let sheetName: string | undefined;
  const put = (r: number, c: number, t: string) => {
    while (cells.length <= r) cells.push([]);
    const row = cells[r];
    while (row.length <= c) row.push('');
    if (!row[c]) row[c] = t;
  };
  const others = new Set<string>();
  for (const { ref, values } of caches) {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(ref.replace(/^=/, ''));
    if (!m) continue;
    const name = (m[1] ?? m[2]).replace(/''/g, "'");
    if (sheetName === undefined) sheetName = name;
    else if (name !== sheetName) others.add(name);
    const col = (s: string) => [...s.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const c1 = col(m[3]), r1 = Number(m[4]) - 1;
    const c2 = m[5] ? col(m[5]) : c1, r2 = m[6] ? Number(m[6]) - 1 : r1;
    const down = c1 === c2;
    values.forEach((v, k) => {
      const r = down ? r1 + k : r1, c = down ? c1 : c1 + k;
      if (r <= r2 && c <= c2) put(r, c, v);
    });
  }
  for (const row of cells) for (let i = 0; i < row.length; i++) row[i] ??= '';
  const name = sheetName ?? 'Sheet1';
  let c = chart;
  for (const o of others) c = mapChartRefs(c, (f) => renameSheetInFormula(f, o, name));
  return { chart: { ...c, at: { row: 0, col: 0, dx: 0, dy: 0 } }, cells, ...(name !== 'Sheet1' ? { sheet: name } : {}) };
}

/** Do two boxes chart the same numbers (so our own copy can stand in for what Word or PowerPoint saved)? */
export function sameBoxData(a: ChartBox, b: ChartBox): boolean {
  const da = boxData(a), db = boxData(b);
  if (da.length !== db.length) return false;
  const same = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => (Number.isNaN(v) && Number.isNaN(y[i])) || Math.abs(v - y[i]) <= 1e-9 * Math.max(1, Math.abs(v)));
  return da.every((s, i) => same(s.ys, db[i].ys) && (!isXY(a.chart.kind) || same(s.xs, db[i].xs)) && same(s.sizes ?? [], db[i].sizes ?? []) && s.cats.join('\u0001') === db[i].cats.join('\u0001'));
}

