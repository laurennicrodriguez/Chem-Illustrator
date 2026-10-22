// Working out a formula: arithmetic, comparisons, joining text, and the functions, following
// Excel's rules (empty cells count as 0 in sums, text in a block is skipped by SUM, errors
// pass through, and so on). The chemistry functions (MW, FORMULA, HRMS…) ask the sheet for the
// properties of a structure cell, or of SMILES text.

import { tokenize, type Node, type RefToken } from './formula';
import { MAX_COLS, MAX_ROWS, cellName, type Range } from './refs';
import { CellError, ERR, Value, compareValues, isError, toBool, toNumber, toText } from './values';
import { Arg, Block, FnDef, Fn, LambdaValue, array, at, isBlock, isMulti, lift, numbers, rowsOf, scalar } from './args';
import { ARRAY_FUNCTIONS } from './fn-array';
import { DATE_FUNCTIONS, DATE_LIFTED } from './fn-date';
import { CRITERIA_FUNCTIONS } from './fn-criteria';
import { LOOKUP_FUNCTIONS, chooseIndex } from './fn-lookup';
import { TEXT_FUNCTIONS } from './fn-text';
import { STATS_FUNCTIONS } from './fn-stats';
import { ANALYSIS_FUNCTIONS } from './fn-analysis';
import { MolProps, PROPERTIES, propertyValue } from './properties';
import { ISOTOPE_FUNCTIONS, isotopeValue, readsAsFormula, type IsotopeSource } from './isotopes';

/** Where a formula reads its cells and structures from. */
export interface EvalHost {
  /** The value of one cell (sheet undefined: the formula's own sheet). */
  value(sheet: string | undefined, row: number, col: number): Value;
  /** The values of a block of cells, row by row. Whole columns are cut to the rows in use. */
  block(sheet: string | undefined, r: Range): Value[][];
  /** False when a formula names a sheet that isn't there. */
  hasSheet(name: string): boolean;
  /**
   * The properties of the molecule in a cell (a drawn structure, or SMILES typed in it), or of
   * SMILES given as text. Errors: #BUSY! while the chemistry engine is working them out,
   * #VALUE! when the structure can't be read. Null for an empty cell.
   */
  molecule(src: { sheet: string | undefined; row: number; col: number } | { smiles: string }): MolProps | CellError | null;
  /**
   * Which molecule each cell of a block holds (its InChIKey, or SMILES when it has none), row by
   * row, for finding the same structure twice: null for a cell with none, #BUSY! while being
   * worked out. Whole columns are cut to the rows in use.
   */
  identities?(sheet: string | undefined, r: Range): (string | CellError | null)[][];
  /** A name defined in the workbook (Formulas > Name Manager), worked out; undefined when there is no such name. */
  name?(name: string): Arg | undefined;
  /** The reference a defined name stands for, when it is one (for OFFSET, ROW and the like). */
  nameRef?(name: string): RefToken | undefined;
  /** The block an array spills into from its formula's cell (A1#); #REF! when that cell's formula doesn't spill. */
  spill?(sheet: string | undefined, row: number, col: number): Range | CellError;
  /** The cell the formula is in (for ROW(), COLUMN() and @). */
  home?: { row: number; col: number };
  /** Names given by LET, and a LAMBDA's parameters, upper case. */
  vars?: Map<string, Arg>;
  /**
   * Is a cell left out of SUBTOTAL: one holding SUBTOTAL or AGGREGATE itself (so subtotals
   * aren't counted twice), a row a filter hides, or with `hidden` any hidden row (109 and so on)?
   */
  subtotalSkip?(sheet: string | undefined, row: number, col: number, hidden: boolean): boolean;
  /** A field of the compound card in a cell (Data > Data Types > Compound): undefined for a cell with no card, null for a field it doesn't have. */
  field?(sheet: string | undefined, row: number, col: number, name: string): Value | null | undefined;
}

/** A number as a cell holds it: −0 is 0, infinities and NaN are #NUM!. */
export const tidyValue = (v: Value): Value => (typeof v === 'number' ? (Number.isFinite(v) ? (v === 0 ? 0 : v) : ERR.num()) : v);

/** Work out a formula's tree, to one value. */
export function evaluate(n: Node, host: EvalHost): Value {
  return tidyValue(scalar(evalNode(n, host)));
}

/** Work out a formula's tree, keeping an array (or block of cells) whole, to spill. */
export function evaluateArg(n: Node, host: EvalHost): Arg {
  const a = evalNode(n, host);
  return isBlock(a) ? a : tidyValue(a);
}

function refRange(r: RefToken): Range {
  const b = r.b ?? r.a;
  return { r1: Math.min(r.a.row, b.row), c1: Math.min(r.a.col, b.col), r2: Math.max(r.a.row, b.row), c2: Math.max(r.a.col, b.col) };
}

function evalNode(n: Node, host: EvalHost): Arg {
  switch (n.t) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'bool': return n.v;
    case 'err': return new CellError(n.v);
    case 'name': return nameValue(n.v, host);
    case 'ref': {
      const r = n.v;
      if (r.broken) return ERR.ref();
      if (r.sheet !== undefined && !host.hasSheet(r.sheet)) return ERR.ref(`There is no sheet called "${r.sheet}"`);
      if (r.spill) {
        const sp = host.spill ? host.spill(r.sheet, r.a.row, r.a.col) : ERR.ref();
        return isError(sp) ? sp : blockOf(host, r.sheet, sp);
      }
      if (r.kind === 'cell') return host.value(r.sheet, r.a.row, r.a.col);
      return blockOf(host, r.sheet, refRange(r));
    }
    case 'neg': return unary(evalNode(n.x, host), (x) => -x);
    case 'pct': return unary(evalNode(n.x, host), (x) => x / 100);
    case 'at': return intersect(evalNode(n.x, host), host);
    case 'arr': return array(n.rows.map((r) => r.map((x) => scalar(evalNode(x, host)))));
    case 'bin': {
      const l = evalNode(n.l, host), r = evalNode(n.r, host);
      if (isMulti(l) || isMulti(r)) return lift([l, r], ([a, b]) => binary(n.op, a, b));
      return binary(n.op, scalar(l), scalar(r));
    }
    case 'fn': return call(n.name, n.args, host);
    case 'call': {
      const f = evalNode(n.f, host);
      if (!(f instanceof LambdaValue)) return isError(f) ? f : ERR.value('Only a LAMBDA can be called like this');
      return applyLambda(f, n.args.map((a) => evalNode(a, host)));
    }
  }
}

/** The cells of a block, as a function is given them. */
function blockOf(host: EvalHost, sheet: string | undefined, range: Range): Block {
  return { block: host.block(sheet, range), h: range.r2 - range.r1 + 1, w: range.c2 - range.c1 + 1, at: { r: range.r1, c: range.c1 }, ...(sheet !== undefined ? { sheet } : {}) };
}

/** A leading minus or a trailing %, for each value of an array too. */
function unary(a: Arg, f: (x: number) => number): Arg {
  const one = (v: Value): Value => {
    const x = toNumber(v);
    return isError(x) ? x : f(x);
  };
  return isMulti(a) ? lift([a], ([v]) => one(v)) : one(scalar(a));
}

/**
 * @x: one value. A worked-out array gives its first; a block of cells gives the cell in the
 * formula's own row (a column) or column (a row), as Excel did before arrays spilled.
 */
function intersect(a: Arg, host: EvalHost): Arg {
  if (!isBlock(a)) return a;
  if ((a.h === 1 && a.w === 1) || a.array || !a.at) return at(a, 0, 0);
  const home = host.home;
  if (home && a.w === 1 && home.row >= a.at.r && home.row < a.at.r + a.h) return at(a, home.row - a.at.r, 0);
  if (home && a.h === 1 && home.col >= a.at.c && home.col < a.at.c + a.w) return at(a, 0, home.col - a.at.c);
  return ERR.value('@ found no cell of the block in this formula\'s row or column');
}

/** A name in a formula: one given by LET or LAMBDA, or one defined in the workbook. */
function nameValue(name: string, host: EvalHost): Arg {
  const local = host.vars?.get(name.toUpperCase());
  if (local !== undefined) return local;
  const defined = host.name?.(name);
  if (defined !== undefined) return defined;
  return ERR.name(`"${name}" is not a name, function or cell this program knows (Formulas > Name Manager lists the names)`);
}

/** A host that also knows some names (LET's, or a LAMBDA's parameters). */
function withVars(host: EvalHost, add: Map<string, Arg>): EvalHost {
  const child = Object.create(host) as EvalHost;
  child.vars = new Map([...(host.vars ?? []), ...add]);
  return child;
}

let lambdaDepth = 0;

/** Call a LAMBDA with its values. */
export function applyLambda(f: LambdaValue, args: Arg[]): Arg {
  if (args.length !== f.params.length) return ERR.value(`This LAMBDA takes ${f.params.length} value${f.params.length === 1 ? '' : 's'}, not ${args.length}`);
  if (lambdaDepth > 300) return ERR.num('Too many LAMBDA calls inside each other (one that calls itself without stopping?)');
  lambdaDepth++;
  try {
    return evalNode(f.body, withVars(f.host, new Map(f.params.map((p, i) => [p, args[i]]))));
  } finally {
    lambdaDepth--;
  }
}

/** A LAMBDA's answer where one value is wanted (MAP, BYROW…): an array there is #CALC!, as in Excel. */
function lambdaValue(f: LambdaValue, args: Arg[]): Value {
  const r = applyLambda(f, args);
  if (isMulti(r)) return ERR.calc('The LAMBDA must give one value here, not an array');
  return scalar(r);
}

function binary(op: string, a: Value, b: Value): Value {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === '&') {
    const x = toText(a), y = toText(b);
    return isError(x) ? x : isError(y) ? y : x + y;
  }
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    const c = compareValues(a, b);
    switch (op) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      default: return c >= 0;
    }
  }
  const x = toNumber(a), y = toNumber(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': return y === 0 ? ERR.div0() : x / y;
    case '^': {
      if (x === 0 && y === 0) return ERR.num('0 to the power 0');
      const r = Math.pow(x, y);
      return Number.isFinite(r) ? r : ERR.num();
    }
  }
  return ERR.value();
}

// ---------------------------------------------------------------- functions

const agg = (f: (xs: number[]) => Value): Fn => (args) => {
  const xs = numbers(args);
  return isError(xs) ? xs : f(xs);
};

const num1 = (f: (x: number) => Value): Fn => (args) => {
  const x = toNumber(scalar(args[0]));
  return isError(x) ? x : f(x);
};

/** Round half away from zero to `digits` places, without binary fractions getting in the way (2.675 → 2.68, as Excel gives). */
export function roundTo(x: number, digits: number, mode: 'near' | 'up' | 'down' = 'near'): number {
  const k = Math.pow(10, Math.trunc(digits));
  const s = Number((Math.abs(x) * k).toPrecision(15));
  const r = mode === 'near' ? Math.round(s) : mode === 'up' ? Math.ceil(s) : Math.floor(s);
  const out = (Math.sign(x) * r) / k;
  return out === 0 ? 0 : Number(out.toPrecision(15));
}

const roundFn = (mode: 'near' | 'up' | 'down'): Fn => (args) => {
  const x = toNumber(scalar(args[0]));
  const d = args.length > 1 ? toNumber(scalar(args[1])) : 0;
  if (isError(x)) return x;
  if (isError(d)) return d;
  return roundTo(x, d, mode);
};

const median = (xs: number[]): Value => {
  if (!xs.length) return ERR.num('No numbers');
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const text1 = (f: (s: string) => Value): Fn => (args) => {
  const s = toText(scalar(args[0]));
  return isError(s) ? s : f(s);
};

const is = (test: (v: Value) => boolean): Fn => (args) => test(scalar(args[0]));

/** Pairs of numbers from two blocks the same size (known y's, known x's), skipping pairs where either isn't a number, as Excel does. */
function pairs(ya: Arg, xa: Arg): { xs: number[]; ys: number[] } | CellError {
  const flat = (a: Arg): Value[] => (isBlock(a) ? a.block.flat() : [a]);
  const ys = flat(ya), xs = flat(xa);
  if (ys.length !== xs.length) return ERR.na('The two ranges are different sizes');
  const out = { xs: [] as number[], ys: [] as number[] };
  for (let i = 0; i < ys.length; i++) {
    if (isError(ys[i])) return ys[i] as CellError;
    if (isError(xs[i])) return xs[i] as CellError;
    if (typeof ys[i] === 'number' && typeof xs[i] === 'number') { out.ys.push(ys[i] as number); out.xs.push(xs[i] as number); }
  }
  return out;
}

/** Straight-line statistics of known y's against known x's (SLOPE, INTERCEPT, RSQ, CORREL, STEYX, FORECAST). */
const lineStat = (f: (p: { xs: number[]; ys: number[]; slope: number; intercept: number; sxx: number; syy: number; sxy: number }) => Value, yArg = 0, xArg = 1): Fn => (args) => {
  const p = pairs(args[yArg], args[xArg]);
  if (isError(p)) return p;
  const n = p.xs.length;
  if (n < 2) return ERR.div0('Needs at least two pairs of numbers');
  const mx = p.xs.reduce((s, x) => s + x, 0) / n, my = p.ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (p.xs[i] - mx) ** 2; syy += (p.ys[i] - my) ** 2; sxy += (p.xs[i] - mx) * (p.ys[i] - my); }
  if (sxx === 0) return ERR.div0('The x values are all the same');
  const slope = sxy / sxx;
  return f({ ...p, slope, intercept: my - slope * mx, sxx, syy, sxy });
};

const FUNCTIONS: Record<string, FnDef> = {
  SLOPE: { min: 2, max: 2, fn: lineStat((p) => p.slope) },
  INTERCEPT: { min: 2, max: 2, fn: lineStat((p) => p.intercept) },
  RSQ: { min: 2, max: 2, fn: lineStat((p) => (p.syy === 0 ? ERR.div0() : (p.sxy * p.sxy) / (p.sxx * p.syy))) },
  CORREL: { min: 2, max: 2, fn: lineStat((p) => (p.syy === 0 ? ERR.div0() : p.sxy / Math.sqrt(p.sxx * p.syy))) },
  STEYX: { min: 2, max: 2, fn: lineStat((p) => (p.xs.length < 3 ? ERR.div0() : Math.sqrt((p.syy - (p.sxy * p.sxy) / p.sxx) / (p.xs.length - 2)))) },
  // FORECAST(x, known y's, known x's): the line's value at x
  FORECAST: {
    min: 3, max: 3,
    fn: (args, host) => {
      const x = toNumber(scalar(args[0]));
      if (isError(x)) return x;
      return lineStat((p) => p.intercept + p.slope * x)([args[1], args[2]], host);
    },
  },
  SUM: { min: 1, max: 255, fn: agg((xs) => xs.reduce((s, x) => s + x, 0)) },
  PRODUCT: { min: 1, max: 255, fn: agg((xs) => (xs.length ? xs.reduce((s, x) => s * x, 1) : 0)) },
  AVERAGE: { min: 1, max: 255, fn: agg((xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : ERR.div0())) },
  MIN: { min: 1, max: 255, fn: agg((xs) => (xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : 0)) },
  MAX: { min: 1, max: 255, fn: agg((xs) => (xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : 0)) },
  MEDIAN: { min: 1, max: 255, fn: agg(median) },
  STDEV: STATS_FUNCTIONS['STDEV.S'],
  COUNT: {
    min: 1, max: 255,
    fn: (args) => {
      let n = 0;
      for (const a of args) {
        if (isBlock(a)) { for (const row of a.block) for (const v of row) if (typeof v === 'number') n++; }
        else if (typeof a === 'number' || typeof a === 'boolean' || (typeof a === 'string' && !isError(toNumber(a)) && a.trim() !== '')) n++;
      }
      return n;
    },
  },
  COUNTA: {
    min: 1, max: 255,
    fn: (args) => {
      let n = 0;
      for (const a of args) {
        if (isBlock(a)) { for (const row of a.block) for (const v of row) if (v !== null && v !== '') n++; }
        else if (a !== null) n++;
      }
      return n;
    },
  },
  COUNTBLANK: {
    min: 1, max: 1,
    fn: (args) => {
      const a = args[0];
      if (!isBlock(a)) return a === null || a === '' ? 1 : 0;
      let n = 0;
      for (const row of a.block) for (const v of row) if (v === null || v === '') n++;
      return n;
    },
  },
  // Excel's SUBTOTAL (as a table's totals row writes it): 1 average, 2 count, 3 count filled, 4 max, 5 min, 6 product, 7 and 8 standard deviation, 9 sum, 10 and 11 variance (101… the same)
  SUBTOTAL: {
    min: 2, max: 255,
    fn: (args, host) => {
      const k = toNumber(scalar(args[0]));
      if (isError(k)) return k;
      const name = ({ 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 8: 'STDEVP', 9: 'SUM', 10: 'VAR', 11: 'VARP' } as Record<number, string>)[Math.trunc(k) % 100];
      if (!name) return ERR.value('SUBTOTAL works out 1 to 11 (101 to 111)');
      // other subtotals in the block, and rows filtered out (any hidden row, for 101 to 111), are left out
      const hidden = Math.trunc(k) > 100;
      const skip = host.subtotalSkip;
      const cells = skip ? args.slice(1).map((a) => (isBlock(a) && a.at ? { ...a, block: a.block.map((row, i) => row.map((v, j) => (skip(a.sheet, a.at!.r + i, a.at!.c + j, hidden) ? null : v))) } : a)) : args.slice(1);
      return scalar(FUNCTIONS[name].fn(cells, host));
    },
  },
  ROUND: { min: 1, max: 2, fn: roundFn('near') },
  ROUNDUP: { min: 1, max: 2, fn: roundFn('up') },
  ROUNDDOWN: { min: 1, max: 2, fn: roundFn('down') },
  INT: { min: 1, max: 1, fn: num1((x) => Math.floor(x)) },
  ABS: { min: 1, max: 1, fn: num1((x) => Math.abs(x)) },
  SQRT: { min: 1, max: 1, fn: num1((x) => (x < 0 ? ERR.num('Square root of a negative number') : Math.sqrt(x))) },
  EXP: { min: 1, max: 1, fn: num1((x) => Math.exp(x)) },
  LN: { min: 1, max: 1, fn: num1((x) => (x <= 0 ? ERR.num('Logarithm of zero or a negative number') : Math.log(x))) },
  LOG10: { min: 1, max: 1, fn: num1((x) => (x <= 0 ? ERR.num('Logarithm of zero or a negative number') : Math.log10(x))) },
  LOG: {
    min: 1, max: 2,
    fn: (args) => {
      const x = toNumber(scalar(args[0]));
      const b = args.length > 1 ? toNumber(scalar(args[1])) : 10;
      if (isError(x)) return x;
      if (isError(b)) return b;
      if (x <= 0 || b <= 0 || b === 1) return ERR.num();
      return Math.log(x) / Math.log(b);
    },
  },
  POWER: { min: 2, max: 2, fn: (args) => binary('^', scalar(args[0]), scalar(args[1])) },
  MOD: {
    min: 2, max: 2,
    fn: (args) => {
      const x = toNumber(scalar(args[0])), d = toNumber(scalar(args[1]));
      if (isError(x)) return x;
      if (isError(d)) return d;
      if (d === 0) return ERR.div0();
      return x - d * Math.floor(x / d);
    },
  },
  PI: { min: 0, max: 0, fn: () => Math.PI },
  AND: {
    min: 1, max: 255,
    fn: (args) => {
      for (const a of args) for (const v of isBlock(a) ? a.block.flat().filter((x) => typeof x === 'boolean' || typeof x === 'number' || isError(x)) : [a]) {
        const b = toBool(v);
        if (isError(b)) return b;
        if (!b) return false;
      }
      return true;
    },
  },
  OR: {
    min: 1, max: 255,
    fn: (args) => {
      for (const a of args) for (const v of isBlock(a) ? a.block.flat().filter((x) => typeof x === 'boolean' || typeof x === 'number' || isError(x)) : [a]) {
        const b = toBool(v);
        if (isError(b)) return b;
        if (b) return true;
      }
      return false;
    },
  },
  NOT: { min: 1, max: 1, fn: (args) => { const b = toBool(scalar(args[0])); return isError(b) ? b : !b; } },
  CONCATENATE: {
    min: 1, max: 255,
    fn: (args) => {
      let s = '';
      for (const a of args) {
        const t = toText(scalar(a));
        if (isError(t)) return t;
        s += t;
      }
      return s;
    },
  },
  LEN: { min: 1, max: 1, fn: text1((s) => s.length) },
  UPPER: { min: 1, max: 1, fn: text1((s) => s.toUpperCase()) },
  LOWER: { min: 1, max: 1, fn: text1((s) => s.toLowerCase()) },
  TRIM: { min: 1, max: 1, fn: text1((s) => s.trim().replace(/ {2,}/g, ' ')) },
  ISBLANK: { min: 1, max: 1, fn: is((v) => v === null) },
  ISNUMBER: { min: 1, max: 1, fn: is((v) => typeof v === 'number') },
  ISTEXT: { min: 1, max: 1, fn: is((v) => typeof v === 'string') },
  ISERROR: { min: 1, max: 1, fn: is((v) => isError(v)) },
  ISNA: { min: 1, max: 1, fn: is((v) => isError(v) && v.code === '#N/A') },
  NA: { min: 0, max: 0, fn: () => ERR.na() },
  ...CRITERIA_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...STATS_FUNCTIONS,
  ...ANALYSIS_FUNCTIONS,
  ...DATE_FUNCTIONS,
  ...ARRAY_FUNCTIONS,
  // LAMBDA helpers: the LAMBDA comes last
  // MAP(array1, …, LAMBDA): the LAMBDA worked out for each value (of each array together)
  MAP: {
    min: 2, max: 254,
    fn: (args) => {
      const f = args[args.length - 1];
      if (!(f instanceof LambdaValue)) return needLambda('MAP', f);
      return lift(args.slice(0, -1), (vals) => lambdaValue(f, [...vals]));
    },
  },
  // REDUCE(start, array, LAMBDA(total, value)): one total carried through every value
  REDUCE: { min: 3, max: 3, fn: (args) => scan(args, false) },
  // SCAN(start, array, LAMBDA(total, value)): the running totals
  SCAN: { min: 3, max: 3, fn: (args) => scan(args, true) },
  // BYROW(array, LAMBDA(row)) and BYCOL(array, LAMBDA(column)): one answer per row (column)
  BYROW: { min: 2, max: 2, fn: (args) => byLine(args, true) },
  BYCOL: { min: 2, max: 2, fn: (args) => byLine(args, false) },
  // MAKEARRAY(rows, columns, LAMBDA(row, column))
  MAKEARRAY: {
    min: 3, max: 3,
    fn: (args) => {
      const r = toNumber(scalar(args[0])), c = toNumber(scalar(args[1]));
      if (isError(r)) return r;
      if (isError(c)) return c;
      const f = args[2];
      if (!(f instanceof LambdaValue)) return needLambda('MAKEARRAY', f);
      const R = Math.trunc(r), C = Math.trunc(c);
      if (R < 1 || C < 1) return ERR.value('Rows and columns must be 1 or more');
      if (R * C > 1_000_000) return ERR.num('The array would be too large');
      return array(Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => lambdaValue(f, [i + 1, j + 1]))));
    },
  },
};

const needLambda = (name: string, got: Arg): CellError => (isError(got) && !(got instanceof LambdaValue) && !isBlock(got) ? got : ERR.value(`${name}'s last argument is a LAMBDA, such as LAMBDA(x, x*2)`));

/** REDUCE and SCAN. */
function scan(args: Arg[], keepAll: boolean): Arg {
  const f = args[2];
  if (!(f instanceof LambdaValue)) return needLambda(keepAll ? 'SCAN' : 'REDUCE', f);
  let acc: Arg = args[0] === '' ? 0 : args[0];
  const rows = rowsOf(args[1]);
  const out: Value[][] = [];
  for (const row of rows) {
    const line: Value[] = [];
    for (const v of row) {
      acc = applyLambda(f, [acc, v]);
      if (keepAll) line.push(isMulti(acc) ? ERR.calc('The LAMBDA must give one value here, not an array') : scalar(acc));
    }
    out.push(line);
  }
  return keepAll ? array(out) : acc;
}

/** BYROW and BYCOL. */
function byLine(args: Arg[], byRow: boolean): Arg {
  const f = args[1];
  if (!(f instanceof LambdaValue)) return needLambda(byRow ? 'BYROW' : 'BYCOL', f);
  const rows = rowsOf(args[0]);
  if (byRow) return array(rows.map((r) => [lambdaValue(f, [array([r])])]));
  const w = rows[0]?.length ?? 0;
  return array([Array.from({ length: w }, (_, j) => lambdaValue(f, [array(rows.map((r) => [r[j]]))]))]);
}

/** How many leading arguments of a function take one value each (0 for those that take blocks). */
export const liftedArgs = (name: string): number => LIFTED[name] ?? 0;

/**
 * Functions that take one value in their first few arguments: given an array there, they are
 * worked out for each of its values and give an array (=LEN(A2:A9), =YEAR(B2:B20)), as in Excel.
 * The number says how many leading arguments.
 */
const LIFTED: Record<string, number> = {
  ROUND: 2, ROUNDUP: 2, ROUNDDOWN: 2, INT: 1, ABS: 1, SQRT: 1, EXP: 1, LN: 1, LOG10: 1, LOG: 2, POWER: 2, MOD: 2, NOT: 1,
  LEN: 1, UPPER: 1, LOWER: 1, TRIM: 1, LEFT: 2, RIGHT: 2, MID: 3, FIND: 3, SEARCH: 3, SUBSTITUTE: 4, REPLACE: 4, TEXT: 2, VALUE: 1,
  CONCATENATE: 255, ISBLANK: 1, ISNUMBER: 1, ISTEXT: 1, ISERROR: 1, ISNA: 1,
  ...DATE_LIFTED,
};

/** Functions that only work out the arguments they need, or need a reference rather than the values in it. */
const LAZY: Record<string, (argNodes: Node[], host: EvalHost) => Arg> = {
  FIELDVALUE: (argNodes, host) => fieldValue(argNodes, host),
  IF: (argNodes, host) => {
    if (argNodes.length < 2 || argNodes.length > 3) return ERR.value('IF needs 2 or 3 arguments: IF(test, if true, if false)');
    const test = evalNode(argNodes[0], host);
    if (isMulti(test)) {
      // a test for each value of an array: both answers are needed
      const t = evalNode(argNodes[1], host), f = argNodes.length > 2 ? evalNode(argNodes[2], host) : false;
      return lift([test, t, f], ([c, x, y]) => { const b = toBool(c); return isError(b) ? b : b ? x : y; });
    }
    const c = toBool(scalar(test));
    if (isError(c)) return c;
    if (c) return evalNode(argNodes[1], host);
    return argNodes.length > 2 ? evalNode(argNodes[2], host) : false;
  },
  IFERROR: (argNodes, host) => {
    if (argNodes.length !== 2) return ERR.value('IFERROR needs 2 arguments');
    const a = evalNode(argNodes[0], host);
    if (isMulti(a)) return lift([a, evalNode(argNodes[1], host)], ([x, y]) => (isError(x) && x.code !== '#BUSY!' ? y : x));
    const v = scalar(a);
    return isError(v) && v.code !== '#BUSY!' ? evalNode(argNodes[1], host) : v;
  },
  IFNA: (argNodes, host) => {
    if (argNodes.length !== 2) return ERR.value('IFNA needs 2 arguments');
    const a = evalNode(argNodes[0], host);
    if (isMulti(a)) return lift([a, evalNode(argNodes[1], host)], ([x, y]) => (isError(x) && x.code === '#N/A' ? y : x));
    const v = scalar(a);
    return isError(v) && v.code === '#N/A' ? evalNode(argNodes[1], host) : v;
  },
  // LET(name1, value1, …, calculation): names for values, used in the calculation
  LET: (argNodes, host) => {
    if (argNodes.length < 3 || argNodes.length % 2 === 0) return ERR.value('LET needs names and values in pairs, then the calculation: LET(x, A1*2, x+1)');
    let h = host;
    for (let i = 0; i + 1 < argNodes.length; i += 2) {
      const nm = argNodes[i];
      if (nm.t !== 'name') return ERR.value('LET\'s names are plain names such as x or total (not cell addresses or numbers)');
      h = withVars(h, new Map([[nm.v.toUpperCase(), evalNode(argNodes[i + 1], h)]]));
    }
    return evalNode(argNodes[argNodes.length - 1], h);
  },
  // LAMBDA(parameter1, …, calculation): a function of your own, called with its values
  LAMBDA: (argNodes, host) => {
    if (!argNodes.length || argNodes.length > 254) return ERR.value('LAMBDA needs its parameters, then the calculation: LAMBDA(x, x*2)');
    const names: string[] = [];
    for (const p of argNodes.slice(0, -1)) {
      if (p.t !== 'name') return ERR.value('A LAMBDA\'s parameters are plain names such as x or rate, and the calculation comes last');
      names.push(p.v.toUpperCase());
    }
    if (new Set(names).size !== names.length) return ERR.value('A LAMBDA\'s parameters need different names');
    return new LambdaValue(names, argNodes[argNodes.length - 1], host);
  },
  // ROW([reference]) and COLUMN([reference]): row and column numbers (of the formula's own cell when left out)
  ROW: (argNodes, host) => rowCol(argNodes, host, true),
  COLUMN: (argNodes, host) => rowCol(argNodes, host, false),
  // IFS(test1, value1, test2, value2, …): the value of the first test that is TRUE
  IFS: (argNodes, host) => {
    if (argNodes.length < 2 || argNodes.length % 2) return ERR.value('IFS needs pairs: IFS(test1, value1, test2, value2, …)');
    for (let i = 0; i < argNodes.length; i += 2) {
      const c = toBool(scalar(evalNode(argNodes[i], host)));
      if (isError(c)) return c;
      if (c) return evalNode(argNodes[i + 1], host);
    }
    return ERR.na('None of the tests is TRUE');
  },
  // SWITCH(value, match1, result1, …, [otherwise])
  SWITCH: (argNodes, host) => {
    if (argNodes.length < 3) return ERR.value('SWITCH needs a value, then pairs of match and result: SWITCH(A1, 1, "one", 2, "two", "other")');
    const v = scalar(evalNode(argNodes[0], host));
    if (isError(v)) return v;
    let i = 1;
    for (; i + 1 < argNodes.length; i += 2) {
      const m = scalar(evalNode(argNodes[i], host));
      if (isError(m)) return m;
      if (typeof m === typeof v && compareValues(m, v) === 0) return evalNode(argNodes[i + 1], host);
    }
    return i < argNodes.length ? evalNode(argNodes[i], host) : ERR.na('No match, and no value for otherwise');
  },
  CHOOSE: (argNodes, host) => {
    if (argNodes.length < 2) return ERR.value('CHOOSE needs a number and the values to pick from');
    const i = chooseIndex(scalar(evalNode(argNodes[0], host)), argNodes.length - 1);
    return isError(i) ? i : evalNode(argNodes[i], host);
  },
  OFFSET: (argNodes, host) => {
    const r = offsetRef(argNodes, host);
    return isError(r) ? r : evalNode({ t: 'ref', v: r }, host);
  },
  INDIRECT: (argNodes, host) => {
    const r = indirectRef(argNodes, host);
    return isError(r) ? r : evalNode({ t: 'ref', v: r }, host);
  },
};

/**
 * FIELDVALUE(A2,"Molecular weight"): a field of the compound card in A2, or of each cell of a
 * block (an array). #FIELD! for a cell that isn't a compound, or a field its card doesn't have.
 */
function fieldValue(argNodes: Node[], host: EvalHost): Arg {
  if (argNodes.length !== 2) return ERR.value('FIELDVALUE needs a compound cell and a field: FIELDVALUE(A2,"Molecular weight")');
  const name = scalar(evalNode(argNodes[1], host));
  if (isError(name)) return name;
  const r = refOf(argNodes[0], host);
  if (isError(r)) return ERR.field('FIELDVALUE needs a cell holding a compound (Data > Data Types > Compound)');
  if (r.sheet !== undefined && !host.hasSheet(r.sheet)) return ERR.ref(`There is no sheet called "${r.sheet}"`);
  const one = (row: number, col: number): Value => {
    const v = host.field?.(r.sheet, row, col, String(name ?? ''));
    if (v === undefined) return ERR.field('The cell isn\'t a compound (Data > Data Types > Compound)');
    if (v === null) return ERR.field(`The compound has no field "${String(name ?? '')}"`);
    return v;
  };
  const R = refRange(r);
  if (R.r1 === R.r2 && R.c1 === R.c2) return one(R.r1, R.c1);
  if ((R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1) > 100000) return ERR.value('FIELDVALUE takes a block of up to 100,000 cells');
  return array(Array.from({ length: R.r2 - R.r1 + 1 }, (_, i) => Array.from({ length: R.c2 - R.c1 + 1 }, (_, j) => one(R.r1 + i, R.c1 + j))));
}

/** ROW and COLUMN. */
function rowCol(argNodes: Node[], host: EvalHost, row: boolean): Arg {
  if (argNodes.length > 1) return ERR.value(`${row ? 'ROW' : 'COLUMN'} takes one reference, or none for its own cell`);
  if (!argNodes.length || (argNodes[0].t === 'str' && argNodes[0].v === '')) {
    const h = host.home;
    return h ? (row ? h.row : h.col) + 1 : ERR.value('No cell to number');
  }
  const r = refOf(argNodes[0], host);
  if (isError(r)) return r;
  let R = refRange(r);
  if (r.spill) {
    const sp = host.spill ? host.spill(r.sheet, r.a.row, r.a.col) : ERR.ref();
    if (isError(sp)) return sp;
    R = sp;
  }
  if (row) {
    if (R.r1 === R.r2 || R.r2 - R.r1 >= 100000) return R.r1 + 1;
    return array(Array.from({ length: R.r2 - R.r1 + 1 }, (_, i) => [R.r1 + i + 1]));
  }
  if (R.c1 === R.c2) return R.c1 + 1;
  return array([Array.from({ length: R.c2 - R.c1 + 1 }, (_, j) => R.c1 + j + 1)]);
}

/** Functions whose cells can't be known from the formula's text, or whose answers change by themselves, so they are worked out again after the others and after every change. */
export const VOLATILE_FUNCTIONS = ['OFFSET', 'INDIRECT', 'TODAY', 'NOW'];

/** Every function name, for the formula bar's suggestions. */
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), ...Object.keys(LAZY), ...Object.keys(PROPERTIES), ...Object.keys(ISOTOPE_FUNCTIONS)].sort();

/** A reference worked out in a formula: as written, or made by INDIRECT or OFFSET. */
function refOf(n: Node, host: EvalHost): RefToken | CellError {
  if (n.t === 'ref') return n.v.broken ? ERR.ref() : n.v;
  if (n.t === 'fn' && n.name === 'INDIRECT') return indirectRef(n.args, host);
  if (n.t === 'fn' && n.name === 'OFFSET') return offsetRef(n.args, host);
  if (n.t === 'err') return new CellError(n.v);
  if (n.t === 'name') {
    const r = host.nameRef?.(n.v);
    if (r) return r;
    const v = host.vars?.get(n.v.toUpperCase());
    if (isBlock(v as Arg) && (v as Block).at) {
      const b = v as Block;
      return blockRef(undefined, b.at!.r, b.at!.c, b.at!.r + b.h - 1, b.at!.c + b.w - 1);
    }
  }
  return ERR.value('A cell reference is needed here');
}

/** A reference to the block r1:c1 to r2:c2 of a sheet; #REF! when it runs off the sheet. */
function blockRef(sheet: string | undefined, r1: number, c1: number, r2: number, c2: number): RefToken | CellError {
  if (r1 < 0 || c1 < 0 || r2 >= MAX_ROWS || c2 >= MAX_COLS || r2 < r1 || c2 < c1) return ERR.ref('The reference runs off the sheet');
  const a = { row: r1, col: c1, absRow: true, absCol: true };
  if (r1 === r2 && c1 === c2) return { sheet, kind: 'cell', a };
  return { sheet, kind: 'range', a, b: { row: r2, col: c2, absRow: true, absCol: true } };
}

/** OFFSET(reference, rows, columns, [height], [width]): the block moved, and sized. */
function offsetRef(argNodes: Node[], host: EvalHost): RefToken | CellError {
  if (argNodes.length < 3 || argNodes.length > 5) return ERR.value('OFFSET needs a reference, rows and columns, then optionally height and width');
  const base = refOf(argNodes[0], host);
  if (isError(base)) return base;
  const r = refRange(base);
  const num = (i: number, dflt: number): number | CellError => {
    if (i >= argNodes.length) return dflt;
    const v = scalar(evalNode(argNodes[i], host));
    return v === '' ? dflt : toNumber(v);
  };
  const dr = num(1, 0), dc = num(2, 0), h = num(3, r.r2 - r.r1 + 1), w = num(4, r.c2 - r.c1 + 1);
  for (const x of [dr, dc, h, w]) if (isError(x)) return x;
  const [DR, DC, H, W] = [dr, dc, h, w].map((x) => Math.trunc(x as number));
  if (H < 1 || W < 1) return ERR.ref('Height and width must be 1 or more');
  return blockRef(base.sheet, r.r1 + DR, r.c1 + DC, r.r1 + DR + H - 1, r.c1 + DC + W - 1);
}

/** INDIRECT("B2"), INDIRECT("Sheet2!A1:C5"), or with FALSE as the second argument "R2C3" (R1C1 style, rows and columns from 1). */
function indirectRef(argNodes: Node[], host: EvalHost): RefToken | CellError {
  if (argNodes.length < 1 || argNodes.length > 2) return ERR.value('INDIRECT needs the reference as text, and optionally FALSE for R1C1 style');
  const t = scalar(evalNode(argNodes[0], host));
  if (isError(t)) return t;
  if (typeof t !== 'string' || !t.trim()) return ERR.ref('INDIRECT needs a reference written as text');
  let a1: boolean | CellError = true;
  if (argNodes.length > 1) {
    const v = scalar(evalNode(argNodes[1], host));
    a1 = v === '' || v === null ? false : toBool(v);
    if (isError(a1)) return a1;
  }
  const text = t.trim();
  const bad = () => ERR.ref(`"${text}" is not a reference`);
  if (a1) {
    let toks;
    try { toks = tokenize(text).filter((x) => x.t !== 'ws'); } catch { return bad(); }
    if (toks.length !== 1 || toks[0].t !== 'ref') return bad();
    const ref = toks[0].v;
    // a single address written with a sheet but checked here, so a missing sheet is #REF!
    if (ref.sheet !== undefined && !host.hasSheet(ref.sheet)) return ERR.ref(`There is no sheet called "${ref.sheet}"`);
    return ref;
  }
  const bang = text.lastIndexOf('!');
  let sheet: string | undefined;
  if (bang >= 0) {
    sheet = text.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    if (!host.hasSheet(sheet)) return ERR.ref(`There is no sheet called "${sheet}"`);
  }
  const m = /^R(\d+)C(\d+)(?::R(\d+)C(\d+))?$/i.exec(text.slice(bang + 1));
  if (!m) return bad();
  const r1 = Number(m[1]) - 1, c1 = Number(m[2]) - 1, r2 = m[3] ? Number(m[3]) - 1 : r1, c2 = m[4] ? Number(m[4]) - 1 : c1;
  return blockRef(sheet, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2));
}

/** The functions that add up, average, rank or spread the numbers they are given. */
const BY_REFERENCE = new Set(['SUM', 'PRODUCT', 'AVERAGE', 'MIN', 'MAX', 'MEDIAN', 'SKEW', 'KURT', 'MODE', 'STDEV', 'STDEVP', 'VAR', 'VARP', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P']);

function call(name: string, argNodes: Node[], host: EvalHost): Arg {
  // a LAMBDA named by LET
  const local = host.vars?.get(name);
  if (local instanceof LambdaValue) return applyLambda(local, argNodes.map((a) => evalNode(a, host)));
  const lazy = LAZY[name];
  if (lazy) return lazy(argNodes, host);
  if (name === 'DUPLICATE') return duplicate(argNodes, host);
  if (ISOTOPE_FUNCTIONS[name]) return isotope(name, argNodes, host);
  const prop = PROPERTIES[name];
  if (prop) return chemistry(name, argNodes, host);
  const def = FUNCTIONS[name];
  if (!def) {
    // a LAMBDA given a name in the Name Manager
    const named = host.name?.(name);
    if (named instanceof LambdaValue) return applyLambda(named, argNodes.map((a) => evalNode(a, host)));
    return ERR.name(`${name} is not a function this program knows`);
  }
  if (argNodes.length < def.min || argNodes.length > def.max) {
    return ERR.value(def.min === def.max ? `${name} needs ${def.min} argument${def.min === 1 ? '' : 's'}` : `${name} needs ${def.min} to ${def.max} arguments`);
  }
  const args = argNodes.map((a) => {
    const v = evalNode(a, host);
    // text in a single cell that is named is left out of a sum, as in a range (only typed text is read as a number)
    if (BY_REFERENCE.has(name) && a.t === 'ref' && a.v.kind === 'cell' && !isBlock(v) && !isError(v)) return { block: [[v]], h: 1, w: 1 } as Block;
    return v;
  });
  const k = Math.min(LIFTED[name] ?? 0, args.length);
  if (k && args.slice(0, k).some(isMulti)) {
    const rest = args.slice(k);
    return lift(args.slice(0, k), (vals) => {
      const r = def.fn([...vals, ...rest], host);
      return isMulti(r) ? ERR.calc('An array where one value was wanted') : scalar(r);
    });
  }
  return def.fn(args, host);
}

/** MW(B2), FORMULA("CCO"), HRMS(B2,"[M+Na]+")…: the first argument is a structure cell or SMILES. */
function chemistry(name: string, argNodes: Node[], host: EvalHost): Value {
  const def = PROPERTIES[name];
  if (argNodes.length < 1 || argNodes.length > 1 + def.extra) {
    return ERR.value(def.extra ? `${name} needs a structure and up to ${def.extra} more argument${def.extra === 1 ? '' : 's'}` : `${name} needs one structure: ${name}(B2)`);
  }
  const first = argNodes[0];
  let mol: MolProps | CellError | null;
  if (first.t === 'ref' && first.v.kind === 'cell' && !first.v.broken) {
    if (first.v.sheet !== undefined && !host.hasSheet(first.v.sheet)) return ERR.ref(`There is no sheet called "${first.v.sheet}"`);
    mol = host.molecule({ sheet: first.v.sheet, row: first.v.a.row, col: first.v.a.col });
  } else {
    const v = scalar(evalNode(first, host));
    if (isError(v)) return v;
    if (v === null || v === '') return '';
    if (typeof v !== 'string') return ERR.value(`${name} needs a structure or SMILES, not a number`);
    mol = host.molecule({ smiles: v });
  }
  if (mol === null) return '';
  if (isError(mol)) return mol;
  const extra: Value[] = argNodes.slice(1).map((a) => scalar(evalNode(a, host)));
  return propertyValue(name, mol, extra);
}

/**
 * ISOMZ(B2,"[M+H]+",2) and ISOABUND(B2,"[M+H]+",2): a peak of the isotope pattern of an ion. B2
 * can hold a structure, SMILES or a formula (C10H12N2O); text can be given in place of B2.
 */
function isotope(name: string, argNodes: Node[], host: EvalHost): Value {
  if (argNodes.length < 1 || argNodes.length > 3) return ERR.value(`${name} needs a structure, then the ion and the peak: ${name}(B2,"[M+H]+",2)`);
  const first = argNodes[0];
  const v = scalar(evalNode(first, host));
  if (isError(v)) return v;
  if (v === null || v === '') return '';
  let src: IsotopeSource;
  if (typeof v === 'string' && readsAsFormula(v)) src = { formula: v };
  else {
    let mol: MolProps | CellError | null;
    if (first.t === 'ref' && first.v.kind === 'cell' && !first.v.broken) mol = host.molecule({ sheet: first.v.sheet, row: first.v.a.row, col: first.v.a.col });
    else if (typeof v === 'string') mol = host.molecule({ smiles: v });
    else return ERR.value(`${name} needs a structure, SMILES or formula, not a number`);
    if (mol === null) return '';
    if (isError(mol)) return mol;
    src = { mol };
  }
  const ion = argNodes[1] ? scalar(evalNode(argNodes[1], host)) : '';
  if (isError(ion)) return ion;
  const k = argNodes[2] ? scalar(evalNode(argNodes[2], host)) : 0;
  if (isError(k)) return k;
  const n = k === null || k === '' ? 0 : toNumber(k);
  if (isError(n)) return n;
  return isotopeValue(name, src, ion === null ? '' : String(ion), n);
}

/**
 * DUPLICATE(B2, B:B): the first other cell of the block holding the same molecule as B2 (the
 * same InChIKey, so the same compound however it was drawn), or "" when there is none.
 */
function duplicate(argNodes: Node[], host: EvalHost): Value {
  const usage = 'DUPLICATE needs a structure cell and the cells to look in: DUPLICATE(B2,B:B)';
  if (argNodes.length !== 2) return ERR.value(usage);
  const [a, b] = argNodes;
  if (a.t !== 'ref' || a.v.kind !== 'cell' || a.v.broken || b.t !== 'ref' || b.v.broken) return ERR.value(usage);
  for (const r of [a.v, b.v]) if (r.sheet !== undefined && !host.hasSheet(r.sheet)) return ERR.ref(`There is no sheet called "${r.sheet}"`);
  const mol = host.molecule({ sheet: a.v.sheet, row: a.v.a.row, col: a.v.a.col });
  if (mol === null) return '';
  if (isError(mol)) return mol;
  if (!host.identities) return '';
  const me = mol.inchikey || mol.smiles;
  const range = refRange(b.v);
  const ids = host.identities(b.v.sheet, range);
  const sameSheet = (a.v.sheet ?? '').toLowerCase() === (b.v.sheet ?? '').toLowerCase();
  let busy = false;
  for (let i = 0; i < ids.length; i++) {
    for (let j = 0; j < ids[i].length; j++) {
      const row = range.r1 + i, col = range.c1 + j;
      if (sameSheet && row === a.v.a.row && col === a.v.a.col) continue;
      const id = ids[i][j];
      if (id === me) return (b.v.sheet !== undefined && !sameSheet ? `${b.v.sheet}!` : '') + cellName(row, col);
      if (isError(id) && id.code === '#BUSY!') busy = true;
    }
  }
  return busy ? ERR.busy() : '';
}
