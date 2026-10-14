// Working out a formula: arithmetic, comparisons, joining text, and the functions, following
// Excel's rules (empty cells count as 0 in sums, text in a block is skipped by SUM, errors
// pass through, and so on). The chemistry functions (MW, FORMULA, HRMS…) ask the sheet for the
// properties of a structure cell, or of SMILES text.

import type { Node, RefToken } from './formula';
import { cellName, type Range } from './refs';
import { CellError, ERR, Value, compareValues, isError, toBool, toNumber, toText } from './values';
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
}

/** A block of cells given to a function (SUM(A1:A9)). */
interface Block { block: Value[][] }
type Arg = Value | Block;
const isBlock = (a: Arg): a is Block => typeof a === 'object' && a !== null && 'block' in a;

/** Work out a formula's tree. */
export function evaluate(n: Node, host: EvalHost): Value {
  const v = scalar(evalNode(n, host));
  if (typeof v === 'number') return Number.isFinite(v) ? (v === 0 ? 0 : v) : ERR.num();
  return v;
}

/** A block used where one value is wanted: a single cell gives its value, a larger block #VALUE!. */
function scalar(a: Arg): Value {
  if (!isBlock(a)) return a;
  const b = a.block;
  if (b.length === 1 && b[0].length === 1) return b[0][0];
  return ERR.value('A block of cells where one value was wanted');
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
    case 'name': return ERR.name(`"${n.v}" is not a function or cell this program knows`);
    case 'ref': {
      const r = n.v;
      if (r.broken) return ERR.ref();
      if (r.sheet !== undefined && !host.hasSheet(r.sheet)) return ERR.ref(`There is no sheet called "${r.sheet}"`);
      if (r.kind === 'cell') return host.value(r.sheet, r.a.row, r.a.col);
      return { block: host.block(r.sheet, refRange(r)) };
    }
    case 'neg': {
      const x = toNumber(scalar(evalNode(n.x, host)));
      return isError(x) ? x : -x;
    }
    case 'pct': {
      const x = toNumber(scalar(evalNode(n.x, host)));
      return isError(x) ? x : x / 100;
    }
    case 'bin': return binary(n.op, scalar(evalNode(n.l, host)), scalar(evalNode(n.r, host)));
    case 'fn': return call(n.name, n.args, host);
  }
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

type Fn = (args: Arg[], host: EvalHost) => Value;

interface FnDef {
  min: number;
  max: number;
  fn: Fn;
}

/** The numbers among the arguments, as SUM sees them: in blocks only numbers count; typed arguments are read as numbers. */
function numbers(args: Arg[], skipErrors = false): number[] | CellError {
  const out: number[] = [];
  for (const a of args) {
    if (isBlock(a)) {
      for (const row of a.block) for (const v of row) {
        if (typeof v === 'number') out.push(v);
        else if (isError(v) && !skipErrors) return v;
      }
    } else {
      if (a === null) continue;
      const x = toNumber(a);
      if (isError(x)) { if (!skipErrors) return x; continue; }
      out.push(x);
    }
  }
  return out;
}

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
  STDEV: {
    min: 1, max: 255,
    fn: agg((xs) => {
      if (xs.length < 2) return ERR.div0();
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
    }),
  },
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
  // Excel's SUBTOTAL (as a table's totals row writes it): 1 average, 2 count, 3 count filled, 4 max, 5 min, 6 product, 7 standard deviation, 9 sum (101… the same)
  SUBTOTAL: {
    min: 2, max: 255,
    fn: (args, host) => {
      const k = toNumber(scalar(args[0]));
      if (isError(k)) return k;
      const name = ({ 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 9: 'SUM' } as Record<number, string>)[Math.trunc(k) % 100];
      return name ? FUNCTIONS[name].fn(args.slice(1), host) : ERR.value('SUBTOTAL works out 1 to 7 and 9 (101 to 107 and 109)');
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
};

/** Functions that only work out the arguments they need. */
const LAZY = new Set(['IF', 'IFERROR']);

/** Every function name, for the formula bar's suggestions. */
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), ...LAZY, ...Object.keys(PROPERTIES), ...Object.keys(ISOTOPE_FUNCTIONS)].sort();

function call(name: string, argNodes: Node[], host: EvalHost): Arg {
  if (name === 'IF') {
    if (argNodes.length < 2 || argNodes.length > 3) return ERR.value('IF needs 2 or 3 arguments: IF(test, if true, if false)');
    const c = toBool(scalar(evalNode(argNodes[0], host)));
    if (isError(c)) return c;
    if (c) return evalNode(argNodes[1], host);
    return argNodes.length > 2 ? evalNode(argNodes[2], host) : false;
  }
  if (name === 'IFERROR') {
    if (argNodes.length !== 2) return ERR.value('IFERROR needs 2 arguments');
    const v = scalar(evalNode(argNodes[0], host));
    return isError(v) && v.code !== '#BUSY!' ? evalNode(argNodes[1], host) : v;
  }
  if (name === 'DUPLICATE') return duplicate(argNodes, host);
  if (ISOTOPE_FUNCTIONS[name]) return isotope(name, argNodes, host);
  const prop = PROPERTIES[name];
  if (prop) return chemistry(name, argNodes, host);
  const def = FUNCTIONS[name];
  if (!def) return ERR.name(`${name} is not a function this program knows`);
  if (argNodes.length < def.min || argNodes.length > def.max) {
    return ERR.value(def.min === def.max ? `${name} needs ${def.min} argument${def.min === 1 ? '' : 's'}` : `${name} needs ${def.min} to ${def.max} arguments`);
  }
  const args = argNodes.map((a) => evalNode(a, host));
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
