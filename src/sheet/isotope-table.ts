// Sheet > Isotope Pattern: a small table of an ion's isotope peaks (worked out by ISOMZ and
// ISOABUND, so it follows the structure and the ion cell), with columns for the peaks measured
// and their error in ppm, and a chart of the peaks drawn as sticks, as a mass spectrum.
//
// Everything it writes is ordinary cells and an ordinary chart: any value can be typed over, any
// formula changed, and the chart restyled in its panel.

import { newChartId, refText, type Chart, type Series } from './chart';
import { colName } from './refs';
import type { CellStyle } from './workbook';
import { peakName } from './isotopes';

export type IsotopeChartKind = 'calc' | 'mirror' | 'overlay' | 'none';

export const ISOTOPE_CHARTS: { value: IsotopeChartKind; label: string }[] = [
  { value: 'mirror', label: 'Found above, calculated below (mirror)' },
  { value: 'overlay', label: 'Found and calculated together' },
  { value: 'calc', label: 'Calculated only' },
  { value: 'none', label: 'No chart' },
];

export interface IsotopeTableOptions {
  sheet: string;
  /** Top-left cell of the table. */
  at: { row: number; col: number };
  /** The compound as a formula argument: $B$2, Sheet1!$B$2, or "C10H12N2O" in quotes. */
  source: string;
  /** What to show beside "Compound": a formula such as =FORMULA($B$2), or text. */
  compound: string;
  ion: string;
  /** Peaks to list, by nominal offset (0 for M, 1 for M+1…). */
  peaks: number[];
  /** Add columns for the peaks measured, and the error in ppm. */
  found: boolean;
  chart: IsotopeChartKind;
}

export interface TableCell { row: number; col: number; input: string; style?: CellStyle }

/** Colours of the two series, chosen to tell apart in print and for colour-blind readers. */
export const FOUND_COLOUR = '#1a1a1a';
export const CALC_COLOUR = '#0072b2';

/** The cells and chart of the table. The chart is null for 'none'. */
export function isotopeTable(o: IsotopeTableOptions): { cells: TableCell[]; widths: Map<number, number>; chart: Chart | null; rows: number; cols: number } {
  const { row: r0, col: c0 } = o.at;
  const cells: TableCell[] = [];
  const put = (r: number, c: number, input: string, style?: CellStyle) => cells.push({ row: r0 + r, col: c0 + c, input, ...(style ? { style } : {}) });
  const bold: CellStyle = { bold: true };
  const head: CellStyle = { bold: true, borders: { bottom: { style: 'thin', color: '#000000' } } };
  const letters = (c: number) => colName(c0 + c);
  const ionCell = `$${letters(1)}$${r0 + 2}`;

  put(0, 0, 'Compound', bold);
  put(0, 1, o.compound, { chem: true });
  put(1, 0, 'Ion', bold);
  put(1, 1, o.ion);

  const H = 3; // header row
  const mirror = o.found && o.chart === 'mirror';
  const names = ['Peak', 'Calc. m/z', 'Calc. (%)', ...(o.found ? ['Found m/z', 'Found (%)', 'Error (ppm)'] : []), ...(mirror ? ['Calc. (drawn down)'] : [])];
  names.forEach((n, i) => put(H, i, n, head));
  const col = letters;
  o.peaks.forEach((k, j) => {
    const r = H + 1 + j, row = r0 + r + 1;
    put(r, 0, peakName(k));
    put(r, 1, `=ISOMZ(${o.source},${ionCell},${k})`, { numFmt: '0.0000' });
    put(r, 2, `=ISOABUND(${o.source},${ionCell},${k})`, { numFmt: '0.0' });
    if (o.found) put(r, 5, `=IF(OR(${col(3)}${row}="",${col(1)}${row}=""),"",(${col(3)}${row}-${col(1)}${row})/${col(1)}${row}*1000000)`, { numFmt: '0.0' });
    if (o.found) { put(r, 3, '', { numFmt: '0.0000' }); put(r, 4, '', { numFmt: '0.0' }); }
    if (mirror) put(r, 6, `=IF(${col(2)}${row}="","",-${col(2)}${row})`, { numFmt: '0.0', color: '#808080' });
  });

  const widths = new Map<number, number>([[c0, 76], [c0 + 1, 92], [c0 + 2, 72]]);
  if (o.found) { widths.set(c0 + 3, 92); widths.set(c0 + 4, 76); widths.set(c0 + 5, 84); }
  if (mirror) widths.set(c0 + 6, 120);

  const first = r0 + H + 1, last = r0 + H + o.peaks.length;
  const rng = (c: number) => refText(o.sheet, { r1: first, c1: c0 + c, r2: Math.max(first, last), c2: c0 + c });
  const stick = (name: string, x: number, y: number, color: string, width: number, labelled = true): Series => ({
    name, x: rng(x), y: rng(y), color, sticks: true, lineWidth: width, ...(labelled ? { labels: true, labelX: true, labelFmt: '0.0000' } : {}),
  });
  let chart: Chart | null = null;
  const kind = o.found ? o.chart : o.chart === 'none' ? 'none' : 'calc';
  if (kind !== 'none') {
    const series: Series[] =
      kind === 'calc' ? [stick('Calculated', 1, 2, CALC_COLOUR, 2)]
      : kind === 'mirror' ? [stick('Found', 3, 4, FOUND_COLOUR, 2), stick('Calculated', 1, 6, CALC_COLOUR, 2)]
      // drawn on top of each other: only the found peaks are labelled, so the labels don't collide
      : [stick('Found', 3, 4, FOUND_COLOUR, 3), stick('Calculated', 1, 2, CALC_COLOUR, 1.5, false)];
    chart = {
      id: newChartId(),
      kind: 'scatter',
      title: `Isotope pattern`,
      series,
      // a label at each whole m/z (Excel would otherwise label every half, and show each twice)
      x: { title: 'm/z', numFmt: '0', step: 1, grid: false },
      y: kind === 'mirror'
        ? { title: 'Relative abundance (%)', min: -150, max: 150, step: 50, numFmt: '0;0', grid: false }
        : { title: 'Relative abundance (%)', min: 0, max: 125, step: 25, numFmt: '0', grid: false },
      legend: series.length > 1 ? 'bottom' : 'none',
      at: { row: r0, col: c0 + names.length + 1, dx: 0, dy: 0 },
      w: 520,
      h: 320,
    };
  }
  return { cells, widths, chart, rows: H + 1 + o.peaks.length, cols: names.length };
}
