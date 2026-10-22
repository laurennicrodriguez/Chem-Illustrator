// The Data tab's analysis tools, as Excel's: Data Analysis (the Analysis ToolPak's nineteen tools,
// each with its window), What-If Analysis (Goal Seek and Data Table) and Solver. Their windows
// float beside the sheet, so cells can be picked into them (see ToolWindow).

import type { SheetView } from './sheet-view';
import { popupMenu } from './sheet-view';
import { ToolWindow, absText } from './tool-window';
import { ask } from './ask';
import type { Sheet, Workbook, CellStyle } from '../sheet/workbook';
import { mergeStyle, valueInput } from '../sheet/workbook';
import { Range, keyOf, rowOf, colOf, cellName, quoteSheet, rangeName, rangesOverlap } from '../sheet/refs';
import { readRef, refText, newChartId, type Chart } from '../sheet/chart';
import { isError, type Value } from '../sheet/values';
import { formatValue } from '../sheet/numfmt';
import {
  type ToolOutput, type Group, type RandomDistribution, groupsOf, descriptive, histogram, regression, anovaSingle, anovaTwoNoRep, anovaTwoRep,
  tTest, fTest, zTest, matrix, movingAverage, expSmoothing, rankPercentile, sample, randomNumbers, seededRandom, fourier,
} from '../sheet/analysis-tools';
import { goalSeek, dataTableRef, newDataTableId } from '../sheet/what-if';
import { type SolverModel, type SolverRel, type SolverEngine, defaultModel, modelNames, modelFromNames, isSolverName } from '../sheet/solver';
import { runSolver, keepAnswer, answerReport, constraintText } from '../sheet/solver-sheet';

export interface AnalysisUiHost {
  readonly view: SheetView;
  /** One undoable change to the sheet showing. */
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
}

/** The ToolPak's tools, in Excel's order. */
const TOOLS = [
  'Anova: Single Factor', 'Anova: Two-Factor With Replication', 'Anova: Two-Factor Without Replication', 'Correlation', 'Covariance',
  'Descriptive Statistics', 'Exponential Smoothing', 'F-Test Two-Sample for Variances', 'Fourier Analysis', 'Histogram', 'Moving Average',
  'Random Number Generation', 'Rank and Percentile', 'Regression', 'Sampling', 't-Test: Paired Two Sample for Means',
  't-Test: Two-Sample Assuming Equal Variances', 't-Test: Two-Sample Assuming Unequal Variances', 'z-Test: Two Sample for Means',
] as const;
type Tool = (typeof TOOLS)[number];

/** Where a tool's results go. */
type Target = { sheet: Sheet; at: { row: number; col: number } } | { newSheet: string };

export class SheetAnalysis {
  /** The tool picked last (the Data Analysis list opens on it). */
  private lastTool: Tool = 'Descriptive Statistics';

  constructor(private host: AnalysisUiHost) {}

  private get view(): SheetView {
    return this.host.view;
  }

  private get wb(): Workbook {
    return this.host.view.wb!;
  }

  /** Cells were picked on the sheet: an open tool window takes them. */
  selectionChanged(): void {
    const w = ToolWindow.open;
    const s = this.view.sheet;
    if (!w || !s) return;
    w.picked(this.view.sel.range, s.name !== w.home ? s.name : null);
  }

  /** The selection as a range box shows it (empty when it's one empty cell). */
  private selText(): string {
    const s = this.view.sheet!;
    const R = this.view.sel.range;
    if (R.r1 === R.r2 && R.c1 === R.c2 && s.value(R.r1, R.c1) === null) return '';
    return absText(s.clip(R) ?? R, null);
  }

  private window(title: string, cls = ''): ToolWindow {
    const w = new ToolWindow(title, cls);
    w.home = this.view.sheet?.name ?? null;
    return w;
  }

  /** A range box's cells (on the window's sheet unless it names another). */
  private cells(text: string, what: string): { sheet: Sheet; range: Range } | string {
    const home = this.view.wb?.sheetNamed(ToolWindow.open?.home ?? '') ?? this.view.sheet!;
    if (!text.trim()) return `Give the ${what}.`;
    const got = readRef(this.wb, text.trim().startsWith('=') ? text.trim() : `=${text.trim()}`, home);
    return got ?? `The ${what} "${text}" isn't a block of cells.`;
  }

  /** The values of a block (cut at the last row and column in use). */
  private values(at: { sheet: Sheet; range: Range }): Value[][] {
    const s = at.sheet, R = at.range;
    const r2 = Math.min(R.r2, Math.max(R.r1, s.lastRow)), c2 = Math.min(R.c2, Math.max(R.c1, s.lastCol));
    const out: Value[][] = [];
    for (let r = R.r1; r <= r2; r++) {
      const row: Value[] = [];
      for (let c = R.c1; c <= c2; c++) row.push(s.value(r, c));
      out.push(row);
    }
    return out;
  }

  private numberOf(inp: HTMLInputElement, what: string, check?: (x: number) => boolean): number | string {
    const x = Number(inp.value.trim());
    if (!inp.value.trim() || !Number.isFinite(x) || (check && !check(x))) return `${what}: give a number${check ? ' in range' : ''}.`;
    return x;
  }

  // ---------------------------------------------------------------- Data Analysis

  /** Data > Data Analysis: pick a tool. */
  dataAnalysis(): void {
    const s = this.view.sheet;
    if (!s || s.dashboard) return;
    const w = this.window('Data Analysis', 'tool-picker');
    const list = document.createElement('select');
    list.size = 12;
    list.className = 'tool-list';
    for (const t of TOOLS) list.add(new Option(t, t, false, t === this.lastTool));
    w.note('Analysis Tools');
    w.body.append(list);
    list.addEventListener('dblclick', () => w.form.requestSubmit());
    w.actions('OK', () => {
      const t = list.value as Tool;
      this.lastTool = t;
      // the tool's own window takes this one's place
      setTimeout(() => this.openTool(t));
      return null;
    });
    w.show();
    list.focus();
  }

  /** The output options every tool has: Output Range or New Worksheet Ply. */
  private outputGroup(w: ToolWindow, rangeOnly = false): () => Target | string {
    const g = w.group('Output options');
    const how = rangeOnly ? null : w.radios('out', [['range', 'Output Range:'], ['sheet', 'New Worksheet Ply:']], 'sheet', g);
    const at = w.ref(rangeOnly ? 'Output Range:' : 'Output range', '', g);
    const ply = rangeOnly ? null : w.text('New sheet name', '', g);
    // typing in a box picks its option, as in Excel
    at.addEventListener('focus', () => { if (how) how.inputs[0].checked = true; });
    at.addEventListener('input', () => { if (how) how.inputs[0].checked = true; });
    ply?.addEventListener('focus', () => { if (how) how.inputs[1].checked = true; });
    return () => {
      if (how?.get() === 'sheet') {
        const name = ply!.value.trim() || this.wb.newSheetName();
        if (this.wb.sheetNamed(name)) return `There is already a sheet called "${name}".`;
        return { newSheet: name };
      }
      const c = this.cells(at.value, 'output range');
      if (typeof c === 'string') return c;
      return { sheet: c.sheet, at: { row: c.range.r1, col: c.range.c1 } };
    };
  }

  /** Input range, grouped by columns or rows, labels in the first row. */
  private inputGroup(w: ToolWindow, grouping = true, labelsText = 'Labels in first row'): { input: HTMLInputElement; byRows: () => boolean; labels: HTMLInputElement } {
    const g = w.group('Input');
    const input = w.ref('Input Range:', this.selText(), g);
    const by = grouping ? w.radios('by', [['cols', 'Columns'], ['rows', 'Rows']], 'cols', g) : null;
    if (by) by.inputs[0].parentElement!.parentElement!.prepend(Object.assign(document.createElement('span'), { textContent: 'Grouped By: ', className: 'muted' }));
    const labels = w.check(grouping ? 'Labels in first row (or column)' : labelsText, false, g);
    return { input, byRows: () => by?.get() === 'rows', labels };
  }

  /** The groups of an input range. */
  private groups(text: string, byRows: boolean, labels: boolean): Group[] | string {
    const c = this.cells(text, 'input range');
    if (typeof c === 'string') return c;
    return groupsOf(this.values(c), byRows, labels);
  }

  private openTool(t: Tool): void {
    switch (t) {
      case 'Descriptive Statistics': return this.descriptiveWindow();
      case 'Histogram': return this.histogramWindow();
      case 'Regression': return this.regressionWindow();
      case 'Anova: Single Factor': return this.anovaSingleWindow();
      case 'Anova: Two-Factor With Replication': return this.anovaRepWindow();
      case 'Anova: Two-Factor Without Replication': return this.anovaNoRepWindow();
      case 'Correlation': case 'Covariance': return this.matrixWindow(t);
      case 'Exponential Smoothing': case 'Moving Average': return this.smoothingWindow(t);
      case 'F-Test Two-Sample for Variances': case 't-Test: Paired Two Sample for Means': case 't-Test: Two-Sample Assuming Equal Variances':
      case 't-Test: Two-Sample Assuming Unequal Variances': case 'z-Test: Two Sample for Means':
        return this.twoSampleWindow(t);
      case 'Fourier Analysis': return this.fourierWindow();
      case 'Random Number Generation': return this.randomWindow();
      case 'Rank and Percentile': return this.rankWindow();
      case 'Sampling': return this.samplingWindow();
    }
  }

  private descriptiveWindow(): void {
    const w = this.window('Descriptive Statistics');
    const inp = this.inputGroup(w);
    const out = this.outputGroup(w);
    const g = w.group('Show');
    const summary = w.check('Summary statistics', true, g);
    const conf = w.check('Confidence Level for Mean:', false, g);
    const level = w.num('Level', 95, g, '%');
    const large = w.check('Kth Largest:', false, g);
    const kl = w.num('K', 1, g);
    const small = w.check('Kth Smallest:', false, g);
    const ks = w.num('K', 1, g);
    w.actions('OK', () => {
      const gs = this.groups(inp.input.value, inp.byRows(), inp.labels.checked);
      if (typeof gs === 'string') return gs;
      const lv = conf.checked ? this.numberOf(level, 'Confidence level', (x) => x > 0 && x < 100) : undefined;
      if (typeof lv === 'string') return lv;
      const r = descriptive(gs, { summary: summary.checked, confidence: lv, kLargest: large.checked ? Number(kl.value) : undefined, kSmallest: small.checked ? Number(ks.value) : undefined });
      return this.write(r, out(), 'Descriptive Statistics');
    });
    w.show();
  }

  private histogramWindow(): void {
    const w = this.window('Histogram');
    const g = w.group('Input');
    const input = w.ref('Input Range:', this.selText(), g);
    const bins = w.ref('Bin Range:', '', g);
    const labels = w.check('Labels', false, g);
    const out = this.outputGroup(w);
    const pareto = w.check('Pareto (sorted histogram)');
    const cum = w.check('Cumulative Percentage');
    const chart = w.check('Chart Output');
    w.actions('OK', () => {
      const gs = this.groups(input.value, false, labels.checked);
      if (typeof gs === 'string') return gs;
      const data = gs.flatMap((x) => x.values).filter((v): v is number => v !== null);
      let binVals: number[] | undefined, binLabel: string | undefined;
      if (bins.value.trim()) {
        const bg = this.groups(bins.value, false, labels.checked);
        if (typeof bg === 'string') return `Bin Range: ${bg}`;
        binVals = bg.flatMap((x) => x.values).filter((v): v is number => v !== null);
        if (labels.checked) binLabel = bg[0]?.label;
      }
      const r = histogram(data, { bins: binVals, binLabel, pareto: pareto.checked, cumulative: cum.checked });
      return this.write(r, out(), 'Histogram', chart.checked ? 'histogram' : undefined);
    });
    w.show();
  }

  private regressionWindow(): void {
    const w = this.window('Regression');
    const g = w.group('Input');
    const y = w.ref('Input Y Range:', '', g);
    const x = w.ref('Input X Range:', '', g);
    const labels = w.check('Labels', false, g);
    const zero = w.check('Constant is Zero', false, g);
    const conf = w.check('Confidence Level', false, g);
    const level = w.num('Level', 95, g, '%');
    const out = this.outputGroup(w);
    const rg = w.group('Residuals');
    const res = w.check('Residuals', false, rg);
    const std = w.check('Standardized Residuals', false, rg);
    const ng = w.group('Normal Probability');
    const normal = w.check('Normal Probability (the table for the plot)', false, ng);
    w.actions('OK', () => {
      const yc = this.cells(y.value, 'input Y range');
      if (typeof yc === 'string') return yc;
      const xc = this.cells(x.value, 'input X range');
      if (typeof xc === 'string') return xc;
      if (yc.range.c2 !== yc.range.c1) return 'The input Y range must be one column.';
      const yg = groupsOf(this.values(yc), false, labels.checked);
      const xg = groupsOf(this.values(xc), false, labels.checked);
      if (typeof yg === 'string') return yg;
      if (typeof xg === 'string') return xg;
      const lv = conf.checked ? this.numberOf(level, 'Confidence level', (v) => v > 0 && v < 100) : 95;
      if (typeof lv === 'string') return lv;
      const r = regression(yg[0].values, xg.map((gx) => gx.values), {
        yLabel: labels.checked ? yg[0].label : undefined, xLabels: labels.checked ? xg.map((gx) => gx.label) : undefined,
        zeroConstant: zero.checked, confidence: lv, residuals: res.checked, standardResiduals: std.checked, normalProbability: normal.checked,
      });
      return this.write(r, out(), 'Regression');
    });
    w.show();
  }

  private alpha(w: ToolWindow, into?: HTMLElement): HTMLInputElement {
    return w.num('Alpha:', 0.05, into);
  }

  private anovaSingleWindow(): void {
    const w = this.window('Anova: Single Factor');
    const inp = this.inputGroup(w);
    const a = this.alpha(w);
    const out = this.outputGroup(w);
    w.actions('OK', () => {
      const al = this.numberOf(a, 'Alpha', (v) => v > 0 && v < 1);
      if (typeof al === 'string') return al;
      const gs = this.groups(inp.input.value, inp.byRows(), inp.labels.checked);
      if (typeof gs === 'string') return gs;
      return this.write(anovaSingle(gs, al), out(), 'Anova');
    });
    w.show();
  }

  private anovaRepWindow(): void {
    const w = this.window('Anova: Two-Factor With Replication');
    const g = w.group('Input');
    const input = w.ref('Input Range:', this.selText(), g);
    const per = w.num('Rows per sample:', 2, g);
    const a = this.alpha(w, g);
    w.note('Select the column labels too (first row) and the sample labels (first column), as Excel does.');
    const out = this.outputGroup(w);
    w.actions('OK', () => {
      const al = this.numberOf(a, 'Alpha', (v) => v > 0 && v < 1);
      if (typeof al === 'string') return al;
      const p = this.numberOf(per, 'Rows per sample', (v) => v >= 2);
      if (typeof p === 'string') return p;
      const c = this.cells(input.value, 'input range');
      if (typeof c === 'string') return c;
      return this.write(anovaTwoRep(this.values(c), p, al), out(), 'Anova');
    });
    w.show();
  }

  private anovaNoRepWindow(): void {
    const w = this.window('Anova: Two-Factor Without Replication');
    const g = w.group('Input');
    const input = w.ref('Input Range:', this.selText(), g);
    const labels = w.check('Labels', false, g);
    const a = this.alpha(w, g);
    const out = this.outputGroup(w);
    w.actions('OK', () => {
      const al = this.numberOf(a, 'Alpha', (v) => v > 0 && v < 1);
      if (typeof al === 'string') return al;
      const c = this.cells(input.value, 'input range');
      if (typeof c === 'string') return c;
      let block = this.values(c);
      let colLabels: string[] = [], rowLabels: string[] = [];
      if (labels.checked) {
        colLabels = block[0].slice(1).map((v) => String(v ?? ''));
        rowLabels = block.slice(1).map((r) => String(r[0] ?? ''));
        block = block.slice(1).map((r) => r.slice(1));
      }
      if (block.some((r) => r.some((v) => typeof v !== 'number'))) return 'Every cell of the input needs a number (tick Labels if the first row and column are labels).';
      const nums = block as number[][];
      if (!labels.checked) { rowLabels = nums.map((_, i) => `Row ${i + 1}`); colLabels = nums[0].map((_, j) => `Column ${j + 1}`); }
      return this.write(anovaTwoNoRep(nums, rowLabels, colLabels, al), out(), 'Anova');
    });
    w.show();
  }

  private matrixWindow(t: 'Correlation' | 'Covariance'): void {
    const w = this.window(t);
    const inp = this.inputGroup(w);
    const out = this.outputGroup(w);
    w.actions('OK', () => {
      const gs = this.groups(inp.input.value, inp.byRows(), inp.labels.checked);
      if (typeof gs === 'string') return gs;
      return this.write(matrix(gs, t === 'Correlation' ? 'correlation' : 'covariance'), out(), t);
    });
    w.show();
  }

  private smoothingWindow(t: 'Exponential Smoothing' | 'Moving Average'): void {
    const w = this.window(t);
    const g = w.group('Input');
    const input = w.ref('Input Range:', this.selText(), g);
    const param = t === 'Moving Average' ? w.num('Interval:', 3, g) : w.num('Damping factor:', 0.3, g);
    const labels = w.check('Labels', false, g);
    const out = this.outputGroup(w, true);
    const chart = w.check('Chart Output');
    const errs = w.check('Standard Errors');
    w.actions('OK', () => {
      const c = this.cells(input.value, 'input range');
      if (typeof c === 'string') return c;
      const R = c.range;
      if (R.r1 !== R.r2 && R.c1 !== R.c2) return 'The input range must be one row or one column.';
      const target = out();
      if (typeof target === 'string') return target;
      if (!('sheet' in target)) return 'Give the output range.';
      const p = this.numberOf(param, t === 'Moving Average' ? 'Interval' : 'Damping factor');
      if (typeof p === 'string') return p;
      // a reference to each input cell, as the output's formulas read them
      const prefix = c.sheet !== target.sheet ? `${quoteSheet(c.sheet.name)}!` : '';
      const refs: string[] = [];
      const skip = labels.checked ? 1 : 0;
      if (R.c1 === R.c2) for (let r = R.r1 + skip; r <= R.r2; r++) refs.push(`${prefix}${cellName(r, R.c1)}`);
      else for (let col = R.c1 + skip; col <= R.c2; col++) refs.push(`${prefix}${cellName(R.r1, col)}`);
      const r = t === 'Moving Average' ? movingAverage(refs, p, errs.checked) : expSmoothing(refs, p, errs.checked);
      if (typeof r === 'string') return r;
      // the forecasts' own cells, for the formulas that read them
      const at = target.at;
      const own = (i: number) => cellName(at.row + i, at.col);
      for (const row of r.cells) for (let j = 0; j < row.length; j++) {
        const v = row[j];
        if (v && typeof v === 'object' && 'f' in v) row[j] = { f: v.f.replace(/%OUT(\d+)/g, (_, i: string) => own(Number(i))) };
      }
      return this.write(r, target, t, chart.checked ? { kind: 'line', actual: { sheet: c.sheet, range: skip ? (R.c1 === R.c2 ? { ...R, r1: R.r1 + 1 } : { ...R, c1: R.c1 + 1 }) : R } } : undefined);
    });
    w.show();
  }

  private twoSampleWindow(t: Tool): void {
    const w = this.window(t);
    const g = w.group('Input');
    const v1 = w.ref('Variable 1 Range:', '', g);
    const v2 = w.ref('Variable 2 Range:', '', g);
    const isF = t.startsWith('F-Test'), isZ = t.startsWith('z-Test');
    const diff = isF ? null : w.num('Hypothesized Mean Difference:', 0, g);
    const var1 = isZ ? w.num('Variable 1 Variance (known):', '', g) : null;
    const var2 = isZ ? w.num('Variable 2 Variance (known):', '', g) : null;
    const labels = w.check('Labels', false, g);
    const a = this.alpha(w, g);
    const out = this.outputGroup(w);
    w.actions('OK', () => {
      const al = this.numberOf(a, 'Alpha', (v) => v > 0 && v < 1);
      if (typeof al === 'string') return al;
      const g1 = this.groups(v1.value, false, labels.checked);
      if (typeof g1 === 'string') return `Variable 1: ${g1}`;
      const g2 = this.groups(v2.value, false, labels.checked);
      if (typeof g2 === 'string') return `Variable 2: ${g2}`;
      // each range read as one list of numbers (by columns)
      const one = (gs: Group[], i: number): Group => ({ label: labels.checked ? gs[0]?.label ?? `Variable ${i}` : `Column ${i}`, values: gs.flatMap((x) => x.values) });
      const a1 = one(g1, 1), a2 = one(g2, 2);
      const d = diff ? Number(diff.value || 0) : 0;
      let r: ToolOutput | string;
      if (isF) r = fTest(a1, a2, al);
      else if (isZ) r = zTest(a1, a2, Number(var1!.value), Number(var2!.value), d, al);
      else r = tTest(t.includes('Paired') ? 'paired' : t.includes('Unequal') ? 'unequal' : 'equal', a1, a2, d, al);
      return this.write(r, out(), t.split(':')[0]);
    });
    w.show();
  }

  private fourierWindow(): void {
    const w = this.window('Fourier Analysis');
    const g = w.group('Input');
    const input = w.ref('Input Range:', this.selText(), g);
    const labels = w.check('Labels in First Row', false, g);
    const out = this.outputGroup(w);
    const inv = w.check('Inverse');
    w.actions('OK', () => {
      const c = this.cells(input.value, 'input range');
      if (typeof c === 'string') return c;
      const vals = this.values(c).flat();
      if (labels.checked) vals.shift();
      return this.write(fourier(vals, inv.checked), out(), 'Fourier Analysis');
    });
    w.show();
  }

  private randomWindow(): void {
    const w = this.window('Random Number Generation');
    const nv = w.num('Number of Variables:', 1);
    const nn = w.num('Number of Random Numbers:', 10);
    const dist = w.select('Distribution:', [['uniform', 'Uniform'], ['normal', 'Normal'], ['bernoulli', 'Bernoulli'], ['binomial', 'Binomial'], ['poisson', 'Poisson'], ['patterned', 'Patterned'], ['discrete', 'Discrete']], 'uniform');
    const pg = w.group('Parameters');
    const seed = w.num('Random Seed:', '');
    const out = this.outputGroup(w);
    let fields: Record<string, HTMLInputElement> = {};
    const params = () => {
      pg.querySelectorAll('label').forEach((x) => x.remove());
      const d = dist.value;
      const f = (k: string, label: string, v: number | string) => (fields[k] = w.num(label, v, pg));
      fields = {};
      if (d === 'uniform') { f('a', 'Between', 0); f('b', 'and', 1); }
      if (d === 'normal') { f('a', 'Mean =', 0); f('b', 'Standard deviation =', 1); }
      if (d === 'bernoulli') f('a', 'p Value =', 0.5);
      if (d === 'binomial') { f('a', 'p Value =', 0.5); f('b', 'Number of trials =', 10); }
      if (d === 'poisson') f('a', 'Lambda =', 1);
      if (d === 'patterned') { f('a', 'From', 1); f('b', 'to', 10); f('c', 'in steps of', 1); f('d', 'repeating each number', 1); f('e', 'repeating each sequence', 1); }
      if (d === 'discrete') fields.r = w.ref('Value and Probability Input Range:', '', pg);
      nn.disabled = d === 'patterned';
    };
    dist.addEventListener('change', params);
    params();
    w.actions('OK', () => {
      const num = (k: string) => Number(fields[k]?.value);
      const d = dist.value;
      let spec: RandomDistribution;
      if (d === 'uniform') spec = { kind: 'uniform', from: num('a'), to: num('b') };
      else if (d === 'normal') spec = { kind: 'normal', mean: num('a'), sd: num('b') };
      else if (d === 'bernoulli') spec = { kind: 'bernoulli', p: num('a') };
      else if (d === 'binomial') spec = { kind: 'binomial', p: num('a'), trials: num('b') };
      else if (d === 'poisson') spec = { kind: 'poisson', lambda: num('a') };
      else if (d === 'patterned') spec = { kind: 'patterned', from: num('a'), to: num('b'), step: num('c'), repeatEach: num('d'), repeatSeq: num('e') };
      else {
        const c = this.cells(fields.r.value, 'value and probability input range');
        if (typeof c === 'string') return c;
        const rows = this.values(c);
        spec = { kind: 'discrete', values: rows.map((r) => Number(r[0])), probs: rows.map((r) => Number(r[1])) };
      }
      const sd = seed.value.trim() ? Number(seed.value) : undefined;
      return this.write(randomNumbers(spec, Number(nv.value) || 1, Number(nn.value), seededRandom(sd)), out(), 'Random numbers');
    });
    w.show();
  }

  private rankWindow(): void {
    const w = this.window('Rank and Percentile');
    const inp = this.inputGroup(w);
    const out = this.outputGroup(w);
    w.actions('OK', () => {
      const gs = this.groups(inp.input.value, inp.byRows(), inp.labels.checked);
      if (typeof gs === 'string') return gs;
      return this.write(rankPercentile(gs), out(), 'Rank and Percentile');
    });
    w.show();
  }

  private samplingWindow(): void {
    const w = this.window('Sampling');
    const g = w.group('Input');
    const input = w.ref('Input Range:', this.selText(), g);
    const labels = w.check('Labels', false, g);
    const mg = w.group('Sampling Method');
    const how = w.radios('how', [['periodic', 'Periodic'], ['random', 'Random']], 'periodic', mg);
    const period = w.num('Period:', 2, mg);
    const count = w.num('Number of Samples:', 10, mg);
    const out = this.outputGroup(w);
    w.actions('OK', () => {
      const gs = this.groups(input.value, false, labels.checked);
      if (typeof gs === 'string') return gs;
      const xs = gs.flatMap((x) => x.values).filter((v): v is number => v !== null);
      const r = sample(xs, how.get() === 'periodic' ? { periodic: Number(period.value) } : { random: Number(count.value) }, seededRandom());
      return this.write(r, out(), 'Sampling');
    });
    w.show();
  }

  // ---------------------------------------------------------------- writing results

  /**
   * Put a tool's results at the output (asking first when that would write over cells in use),
   * with a chart beside them when asked. Returns a problem to show in the window, or null.
   */
  private write(r: ToolOutput | string, target: Target | string, label: string, chart?: 'histogram' | { kind: 'line'; actual: { sheet: Sheet; range: Range } }): Promise<string | null> | string | null {
    if (typeof r === 'string') return r;
    if (typeof target === 'string') return target;
    const h = r.cells.length, w = Math.max(1, ...r.cells.map((x) => x.length));
    const go = () => this.place(r, target, label, chart);
    if ('sheet' in target) {
      const R: Range = { r1: target.at.row, c1: target.at.col, r2: target.at.row + h - 1, c2: target.at.col + w - 1 };
      const busy = target.sheet.keysIn(R).some((k) => { const c = target.sheet.cells.get(k); return !!(c?.input || c?.structure); });
      if (busy) {
        return ask('Overwrite?', [], { ok: 'Overwrite', note: `Output range ${rangeName(R)} will overwrite existing data. Press Overwrite to write over the data in it.` })
          .then((ok) => { if (!ok) return 'Pick another output range.'; go(); return null; });
      }
    }
    go();
    return null;
  }

  private place(r: ToolOutput, target: Target, label: string, chart?: 'histogram' | { kind: 'line'; actual: { sheet: Sheet; range: Range } }): void {
    const wb = this.wb;
    const v = this.view;
    v.commitEdit();
    let sheet: Sheet;
    let at: { row: number; col: number };
    const looks = new Map<number, CellStyle>();
    for (const st of r.styles) for (let rr = st.r1; rr <= st.r2; rr++) for (let cc = st.c1; cc <= st.c2; cc++) {
      looks.set(keyOf(rr, cc), mergeStyle(looks.get(keyOf(rr, cc)), st.style) ?? {});
    }
    wb.edit(label, () => {
      if ('newSheet' in target) {
        sheet = wb.addSheet(target.newSheet, wb.active + 1);
        at = { row: 0, col: 0 };
      } else ({ sheet, at } = target);
      r.cells.forEach((row, i) => row.forEach((val, j) => {
        const style = looks.get(keyOf(i, j));
        const input = val === null ? undefined : typeof val === 'object' && 'f' in val ? val.f : valueInput(val as Value);
        const had = sheet.cell(at.row + i, at.col + j);
        if (input === undefined && !style && !had?.input) return;
        sheet.setCell(at.row + i, at.col + j, { style: mergeStyle(had?.style, style && Object.keys(style).length ? style : undefined), ...(input ? { input } : {}) });
      }));
      // the label column wide enough to read, on a new sheet
      if ('newSheet' in target) {
        const widest = Math.max(...r.cells.map((row) => (typeof row[0] === 'string' ? row[0].length : 0)));
        if (widest > 10) sheet.setColWidth(0, Math.min(260, widest * 7 + 12));
      }
      if (chart) {
        const c = this.chartFor(r, sheet, at, chart);
        if (c) sheet.setCharts([...sheet.charts, c]);
      }
    }, v.place());
    if ('newSheet' in target) v.goSheet(wb.sheets.indexOf(sheet!));
    v.select({ r1: at!.row, c1: at!.col, r2: at!.row + r.cells.length - 1, c2: at!.col + Math.max(0, (r.cells[0]?.length ?? 1) - 1) });
    v.refresh();
  }

  /** The chart a tool draws beside its results: the histogram's columns, or actual values and forecasts. */
  private chartFor(r: ToolOutput, sheet: Sheet, at: { row: number; col: number }, chart: 'histogram' | { kind: 'line'; actual: { sheet: Sheet; range: Range } }): Chart | null {
    const width = Math.max(...r.cells.map((x) => x.length));
    if (chart === 'histogram') {
      if (!r.chart) return null;
      const rows = { r1: at.row + r.chart.r1, r2: at.row + r.chart.r2 };
      const series: Chart['series'] = [{ name: 'Frequency', x: refText(sheet.name, { ...rows, c1: at.col, c2: at.col }), y: refText(sheet.name, { ...rows, c1: at.col + 1, c2: at.col + 1 }) }];
      if (r.chart.cumulative) series.push({ name: 'Cumulative %', x: series[0].x, y: refText(sheet.name, { ...rows, c1: at.col + 2, c2: at.col + 2 }), as: 'line', secondary: true });
      return {
        id: newChartId(), kind: r.chart.cumulative ? 'combo' : 'column', title: 'Histogram', series, x: { title: 'Bin', grid: false }, y: { title: 'Frequency', grid: true },
        ...(r.chart.cumulative ? { y2: { numFmt: '0%', min: 0, max: 1 } } : {}), legend: r.chart.cumulative ? 'bottom' : 'none',
        at: { row: at.row, col: at.col + width + 1, dx: 0, dy: 0 }, w: 420, h: 260,
      };
    }
    const n = r.cells.length;
    return {
      id: newChartId(), kind: 'line', title: r.cells[0] && chart.actual ? 'Forecast' : '', series: [
        { name: 'Actual', y: refText(chart.actual.sheet.name, chart.actual.range) },
        { name: 'Forecast', y: refText(sheet.name, { r1: at.row, c1: at.col, r2: at.row + n - 1, c2: at.col }) },
      ],
      x: { title: 'Data Point', grid: false }, y: { title: 'Value', grid: true }, legend: 'bottom',
      at: { row: at.row, col: at.col + width + 1, dx: 0, dy: 0 }, w: 420, h: 260,
    };
  }

  // ---------------------------------------------------------------- What-If Analysis

  /** Data > What-If Analysis menu. */
  whatIfMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['Goal Seek…', () => this.goalSeekWindow()],
      ['Data Table…', () => this.dataTableWindow()],
    ]);
  }

  /** Goal Seek: find the value of one cell that makes a formula give a target. */
  goalSeekWindow(): void {
    const s = this.view.sheet;
    if (!s || s.dashboard) return;
    const w = this.window('Goal Seek');
    const set = w.ref('Set cell:', s.formulas.has(keyOf(this.view.sel.active.r, this.view.sel.active.c)) ? absText({ r1: this.view.sel.active.r, c1: this.view.sel.active.c, r2: this.view.sel.active.r, c2: this.view.sel.active.c }, null) : '');
    const to = w.num('To value:', '');
    const by = w.ref('By changing cell:', '');
    w.actions('OK', () => {
      const a = this.cells(set.value, 'set cell'), b = this.cells(by.value, 'changing cell');
      if (typeof a === 'string') return a;
      if (typeof b === 'string') return b;
      const one = (x: { range: Range }) => x.range.r1 === x.range.r2 && x.range.c1 === x.range.c2;
      if (!one(a) || !one(b)) return 'Each reference must be one cell.';
      if (a.sheet !== b.sheet) return 'The two cells must be on the same sheet.';
      const sh = a.sheet;
      const fk = keyOf(a.range.r1, a.range.c1), ck = keyOf(b.range.r1, b.range.c1);
      if (!sh.formulas.has(fk)) return 'Cell must contain a formula.';
      if (sh.formulas.has(ck)) return 'Cell must contain a value (the changing cell can\'t hold a formula).';
      const target = this.numberOf(to, 'To value');
      if (typeof target === 'string') return 'Invalid value: give the number the formula should reach.';
      const start = sh.values.get(ck);
      const x0 = typeof start === 'number' ? start : 0;
      const f = (x: number) => this.wb.whatIf([{ s: sh, key: ck, value: x }], () => { const v = sh.values.get(fk); return typeof v === 'number' ? v : NaN; });
      const res = goalSeek(f, target, x0);
      // the status window: keep the answer (OK) or put the cell back (Cancel)
      const st = this.window('Goal Seek Status');
      st.note(`Goal Seeking with Cell ${cellName(a.range.r1, a.range.c1)} ${res.found ? 'found a solution.' : 'may not have found a solution.'}`, '');
      st.note(`Target value: ${formatValue(target).text}`, '');
      st.note(`Current value: ${formatValue(res.y, sh.styleAt(a.range.r1, a.range.c1)?.numFmt).text}`, '');
      st.note(`${cellName(b.range.r1, b.range.c1)} = ${+res.x.toPrecision(15)}`, 'muted');
      st.actions('OK', () => {
        this.wb.edit('Goal Seek', () => { const c = sh.cell(b.range.r1, b.range.c1); sh.setCell(b.range.r1, b.range.c1, { ...c, input: String(+res.x.toPrecision(15)) }); }, this.view.place());
        this.view.refresh();
      });
      setTimeout(() => st.show());
      return null;
    });
    w.show();
  }

  /** Data Table: select the table (values, formulas and the result cells), then give its input cell(s). */
  dataTableWindow(): void {
    const s = this.view.sheet;
    if (!s || s.dashboard) return;
    const sel = this.view.sel.range;
    const ref = dataTableRef(sel);
    if (typeof ref === 'string') { this.host.flash(ref, 7000); return; }
    const w = this.window('Data Table');
    w.note(`The table: ${rangeName(sel)}. The values to try go along its top row (for a row input cell) or down its left column (for a column input cell); the formulas go in the other, or in the top-left corner for two input cells.`);
    const row = w.ref('Row input cell:', '');
    const col = w.ref('Column input cell:', '');
    w.actions('OK', () => {
      const read = (inp: HTMLInputElement, what: string) => {
        if (!inp.value.trim()) return null;
        const c = this.cells(inp.value, what);
        if (typeof c === 'string') return c;
        if (c.sheet !== s) return 'Input cell reference is not valid: it must be on this sheet.';
        if (c.range.r1 !== c.range.r2 || c.range.c1 !== c.range.c2) return 'Input cell reference is not valid: give one cell.';
        if (s.formulas.has(keyOf(c.range.r1, c.range.c1))) return 'The input cell must hold a value, not a formula.';
        return `=${absText(c.range, null)}`;
      };
      const ri = read(row, 'row input cell'), ci = read(col, 'column input cell');
      if (ri && !ri.startsWith('=')) return ri;
      if (ci && !ci.startsWith('=')) return ci;
      if (!ri && !ci) return 'Give a row input cell, a column input cell, or both.';
      if (s.dataTables.some((t) => rangesOverlap(t.ref, ref))) return 'This block overlaps another data table.';
      this.host.edit('Data Table', (sh) => {
        sh.clear(ref, 'contents');
        sh.setDataTables([...sh.dataTables, { id: newDataTableId(), ref, ...(ri ? { rowInput: ri } : {}), ...(ci ? { colInput: ci } : {}) }]);
      });
      return null;
    });
    w.show();
  }

  // ---------------------------------------------------------------- Solver

  /** Data > Solver: the Solver Parameters window. */
  solverWindow(): void {
    const s = this.view.sheet;
    if (!s || s.dashboard) return;
    const m: SolverModel = modelFromNames(this.wb.names, s) ?? defaultModel();
    const w = this.window('Solver Parameters', 'solver-window');
    const obj = w.ref('Set Objective:', m.objective.replace(/^=/, '') || (s.formulas.has(keyOf(this.view.sel.active.r, this.view.sel.active.c)) ? absText({ r1: this.view.sel.active.r, c1: this.view.sel.active.c, r2: this.view.sel.active.r, c2: this.view.sel.active.c }, null) : ''));
    const goal = w.radios('goal', [['max', 'Max'], ['min', 'Min'], ['value', 'Value Of:']], m.goal);
    const val = w.num('Value', m.value ?? 0);
    const vars = w.ref('By Changing Variable Cells:', m.vars.replace(/^=/, ''));
    const cg = w.group('Subject to the Constraints:');
    const list = document.createElement('select');
    list.size = 6;
    list.className = 'tool-list';
    cg.append(list);
    const constraints = m.constraints.slice();
    const fill = () => {
      list.replaceChildren(...constraints.map((c, i) => new Option(constraintText(c), String(i))));
    };
    fill();
    // the constraint being added or changed
    const lhs = w.ref('Cell Reference:', '', cg);
    const rel = w.select<SolverRel>('Relation', [['<=', '<='], ['=', '='], ['>=', '>='], ['int', 'int'], ['bin', 'bin'], ['dif', 'dif']], '<=', cg);
    const rhs = w.ref('Constraint:', '', cg);
    const conBtns = document.createElement('p');
    conBtns.className = 'tool-row-buttons';
    const btn = (t: string, f: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.addEventListener('click', f); conBtns.append(b); return b; };
    const current = (): SolverModel['constraints'][number] | string => {
      if (!lhs.value.trim()) return 'Give the constraint\'s cell reference.';
      const r = rel.value as SolverRel;
      const L = this.cells(lhs.value, 'cell reference');
      if (typeof L === 'string') return L;
      if (r === 'int' || r === 'bin' || r === 'dif') return { lhs: `=${lhs.value.trim().replace(/^=/, '')}`, rel: r };
      if (!rhs.value.trim()) return 'Give the constraint (a number, a cell or a formula).';
      return { lhs: `=${lhs.value.trim().replace(/^=/, '')}`, rel: r, rhs: `=${rhs.value.trim().replace(/^=/, '')}` };
    };
    btn('Add', () => { const c = current(); if (typeof c === 'string') { w.error(c); return; } w.error(null); constraints.push(c); fill(); lhs.value = ''; rhs.value = ''; lhs.focus(); });
    btn('Change', () => { const i = Number(list.value); const c = current(); if (!(i >= 0) || list.selectedIndex < 0) { w.error('Pick a constraint in the list first.'); return; } if (typeof c === 'string') { w.error(c); return; } constraints[i] = c; fill(); });
    btn('Delete', () => { const i = list.selectedIndex; if (i < 0) return; constraints.splice(i, 1); fill(); });
    btn('Reset All', () => { constraints.length = 0; fill(); obj.value = ''; vars.value = ''; });
    cg.append(conBtns);
    list.addEventListener('change', () => {
      const c = constraints[list.selectedIndex];
      if (!c) return;
      lhs.value = c.lhs.replace(/^=/, '');
      rel.value = c.rel;
      rhs.value = (c.rhs ?? '').replace(/^=/, '');
    });
    rel.addEventListener('change', () => { rhs.disabled = ['int', 'bin', 'dif'].includes(rel.value); });
    const nonNeg = w.check('Make Unconstrained Variables Non-Negative', m.nonNegative);
    const engine = w.select<SolverEngine>('Select a Solving Method:', [['grg', 'GRG Nonlinear'], ['simplex', 'Simplex LP'], ['evolutionary', 'Evolutionary']], m.engine);
    w.note('GRG Nonlinear for smooth models (curve fitting, yields as smooth functions); Simplex LP for linear ones (amounts, costs, mixtures); Evolutionary for models that jump (IF, LOOKUP, rounding).');
    const og = w.group('Options');
    const precision = w.num('Constraint Precision:', m.precision ?? 0.000001, og);
    const intTol = w.num('Integer Optimality (%):', (m.intTolerance ?? 0.01) * 100, og);
    const maxTime = w.num('Max Time (seconds):', m.maxTime && m.maxTime < 1e6 ? m.maxTime : 30, og);
    const seed = w.num('Random Seed (Evolutionary):', m.seed ?? 0, og);
    const ignoreInt = w.check('Ignore Integer Constraints', !!m.ignoreInt, og);
    const model = (): SolverModel => ({
      ...m,
      objective: obj.value.trim() ? `=${obj.value.trim().replace(/^=/, '')}` : '',
      goal: goal.get(), value: Number(val.value) || 0,
      vars: vars.value.trim() ? `=${vars.value.trim().replace(/^=/, '')}` : '',
      constraints: constraints.slice(), nonNegative: nonNeg.checked, engine: engine.value as SolverEngine,
      precision: Number(precision.value) || 1e-6, intTolerance: (Number(intTol.value) || 1) / 100, maxTime: Number(maxTime.value) || 30,
      seed: Number(seed.value) || 0, ignoreInt: ignoreInt.checked,
    });
    const save = (mm: SolverModel) => {
      // the model goes in the sheet's hidden names, as Excel keeps it
      const keep = this.wb.names.filter((n) => !(n.sheet === s && isSolverName(n.name)));
      const next = mm.objective || mm.vars ? [...keep, ...modelNames(mm, s)] : keep;
      if (JSON.stringify(next.map((n) => [n.name, n.formula, n.sheet === s])) !== JSON.stringify(this.wb.names.map((n) => [n.name, n.formula, n.sheet === s]))) {
        this.wb.edit('Solver model', () => this.wb.setNames(next), this.view.place());
      }
    };
    w.actions('Solve', () => {
      const mm = model();
      if (!mm.objective) return 'Give the objective cell.';
      if (!mm.vars) return 'Give the variable cells.';
      save(mm);
      const run = runSolver(this.wb, s, mm);
      if (typeof run === 'string') return run;
      setTimeout(() => this.solverResults(s, mm, run));
      return null;
    }, [['Close (keep model)', () => { save(model()); w.close(); }]]);
    w.show();
  }

  /** Solver Results: keep the answer or put the values back, and the Answer Report. */
  private solverResults(s: Sheet, m: SolverModel, run: Exclude<ReturnType<typeof runSolver>, string>): void {
    const w = this.window('Solver Results');
    w.note(run.message, run.ok ? 'tool-ok' : 'tool-error-text');
    const keep = w.radios('keep', [['keep', 'Keep Solver Solution'], ['restore', 'Restore Original Values']], run.ok ? 'keep' : 'restore');
    const report = w.check('Answer Report (on a new sheet)', false);
    const objKey = run.built.objective;
    const found = run.result.f * (run.built.sign === -1 ? -1 : 1);
    if (run.ok && m.goal !== 'value') w.note(`Objective ${cellName(rowOf(objKey), colOf(objKey))}: ${formatValue(found).text}`, 'muted');
    w.actions('OK', () => {
      const wb = this.wb;
      const v = this.view;
      if (keep.get() === 'keep') {
        wb.edit('Solver', () => keepAnswer(s, run), v.place());
      }
      if (report.checked) {
        const when = new Date();
        const rows = answerReport(s, m, run, when);
        let n = 1;
        while (wb.sheetNamed(`Answer Report ${n}`)) n++;
        let sheet: Sheet;
        wb.edit('Answer Report', () => {
          sheet = wb.addSheet(`Answer Report ${n}`, wb.sheets.indexOf(s));
          rows.forEach((row, r) => row.forEach((val, c) => {
            if (val === null || val === undefined) return;
            sheet.setCell(r, c, { input: valueInput(val), ...(r === 0 || (typeof val === 'string' && /^(Objective Cell|Variable Cells|Constraints)/.test(val)) ? { style: { bold: true } } : {}) });
          }));
          sheet.setColWidth(1, 70);
          sheet.setColWidth(2, 120);
          sheet.setColWidth(4, 110);
        }, v.place());
        v.goSheet(wb.sheets.indexOf(sheet!));
      }
      v.refresh();
    });
    w.show();
  }

  /** A short summary of an error value for messages. */
  static errText(v: Value): string {
    return isError(v) ? v.code : String(v);
  }
}

