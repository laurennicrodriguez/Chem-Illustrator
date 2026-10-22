// Excel's dynamic array functions: FILTER, SORT, SORTBY, UNIQUE and SEQUENCE, and the ones
// that reshape arrays (TRANSPOSE, VSTACK, HSTACK, TAKE, DROP, CHOOSEROWS, CHOOSECOLS, TOCOL,
// TOROW). Their answers are arrays, which spill from the formula's cell into the cells below
// and to the right (see Workbook.recalc).

import { Arg, FnDef, array, isBlock, numArg, omitted, optBool, optNumber, rowsOf, MAX_ARRAY } from './args';
import { CellError, ERR, Value, compareValues, isError, toBool, toNumber } from './values';

/** A key for telling values apart as Excel's UNIQUE does: text whatever its case, numbers to 15 figures. */
function valueKey(v: Value): string {
  if (v === null) return 'e';
  if (typeof v === 'number') return 'n' + Number(v.toPrecision(15));
  if (typeof v === 'string') return 's' + v.toLowerCase();
  if (typeof v === 'boolean') return 'b' + v;
  return 'x' + v.code;
}

const transpose = (rows: Value[][]): Value[][] => (rows[0] ?? []).map((_, j) => rows.map((r) => r[j]));

/** An argument as a whole number. */
function wholeArg(args: Arg[], i: number, dflt: number): number | CellError {
  const x = optNumber(args, i, dflt);
  return isError(x) ? x : Math.trunc(x);
}

/** Sort order for SORT and SORTBY: numbers, then text, then TRUE/FALSE, then errors, with empty cells last. */
function sortCompare(a: Value, b: Value): number {
  const rank = (v: Value) => (v === null ? 4 : isError(v) ? 3 : typeof v === 'boolean' ? 2 : typeof v === 'string' ? 1 : 0);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra >= 3) return 0;
  return compareValues(a, b);
}

/** The numbers of an index argument that may be one number or an array of them ({1,2}). */
function indexList(a: Arg): number[] | CellError {
  const out: number[] = [];
  for (const row of rowsOf(a)) for (const v of row) {
    const x = toNumber(v);
    if (isError(x)) return x;
    out.push(Math.trunc(x));
  }
  return out;
}

/** CHOOSEROWS's and CHOOSECOLS's picks: 1 is the first, −1 the last. */
function picks(args: Arg[], from: number, n: number): number[] | CellError {
  const out: number[] = [];
  for (const a of args.slice(from)) {
    const list = indexList(a);
    if (isError(list)) return list;
    for (const k of list) {
      if (k === 0 || Math.abs(k) > n) return ERR.value(`There are only ${n} to choose from`);
      out.push(k > 0 ? k - 1 : n + k);
    }
  }
  return out;
}

/** VSTACK and HSTACK: arrays one after another, short ones padded with #N/A. */
const stack = (down: boolean): FnDef => ({
  min: 1, max: 254,
  fn: (args) => {
    const parts = args.map((a) => (down ? rowsOf(a) : transpose(rowsOf(a))));
    for (const a of args) if (isError(a) && !isBlock(a)) return a;
    const w = Math.max(...parts.map((p) => p[0]?.length ?? 0));
    const rows: Value[][] = [];
    for (const p of parts) for (const r of p) rows.push(r.length < w ? [...r, ...new Array<Value>(w - r.length).fill(ERR.na())] : r);
    if (rows.length * w > MAX_ARRAY) return ERR.num('The array would be too large');
    return array(down ? rows : transpose(rows));
  },
});

/** TAKE and DROP: the first (or, counted negative, last) rows and columns, or all but those. */
const takeDrop = (take: boolean): FnDef => ({
  min: 2, max: 3,
  fn: (args) => {
    const rows = rowsOf(args[0]);
    const h = rows.length, w = rows[0]?.length ?? 0;
    const r = omitted(args, 1) ? null : wholeArg(args, 1, 0), c = omitted(args, 2) ? null : wholeArg(args, 2, 0);
    if (isError(r)) return r;
    if (isError(c)) return c;
    const span = (k: number | null, n: number): [number, number] => {
      if (k === null) return [0, n];
      if (take) return k >= 0 ? [0, Math.min(k, n)] : [Math.max(0, n + k), n];
      return k >= 0 ? [Math.min(k, n), n] : [0, Math.max(0, n + k)];
    };
    const [r1, r2] = span(r, h), [c1, c2] = span(c, w);
    if (r2 <= r1 || c2 <= c1) return ERR.calc('Nothing is left');
    return array(rows.slice(r1, r2).map((row) => row.slice(c1, c2)));
  },
});

export const ARRAY_FUNCTIONS: Record<string, FnDef> = {
  // FILTER(array, include, [if empty]): the rows (or columns) whose include value is TRUE
  FILTER: {
    min: 2, max: 3,
    fn: (args) => {
      const rows = rowsOf(args[0]);
      const inc = rowsOf(args[1]);
      const h = rows.length, w = rows[0]?.length ?? 0;
      const ih = inc.length, iw = inc[0]?.length ?? 0;
      let byRow: boolean;
      const test = (v: Value): boolean | CellError => {
        if (isError(v)) return v;
        if (v === null) return false;
        if (typeof v === 'string') return ERR.value('FILTER\'s include needs TRUE/FALSE or numbers, not text');
        return toBool(v);
      };
      if (iw === 1 && ih === h) byRow = true;
      else if (ih === 1 && iw === w) byRow = false;
      else return ERR.value('The include argument must be one column as tall as the array (or one row as wide)');
      const keep: boolean[] = [];
      for (let k = 0; k < (byRow ? h : w); k++) {
        const b = test(byRow ? inc[k][0] : inc[0][k]);
        if (isError(b)) return b;
        keep.push(b);
      }
      const out = byRow ? rows.filter((_, i) => keep[i]) : rows.map((r) => r.filter((_, j) => keep[j]));
      if (!out.length || !out[0].length) return omitted(args, 2) ? ERR.calc('Nothing passes the filter') : args[2];
      return array(out);
    },
  },
  // SORT(array, [index], [order 1 up / −1 down], [by column]): sorted by a column (or row)
  SORT: {
    min: 1, max: 4,
    fn: (args) => {
      let rows = rowsOf(args[0]);
      const byCol = optBool(args, 3, false);
      if (isError(byCol)) return byCol;
      if (byCol) rows = transpose(rows);
      const idx = omitted(args, 1) ? [1] : indexList(args[1]);
      if (isError(idx)) return idx;
      const ord = omitted(args, 2) ? [1] : indexList(args[2]);
      if (isError(ord)) return ord;
      const w = rows[0]?.length ?? 0;
      for (const k of idx) if (k < 1 || k > w) return ERR.value(`The sort index is 1 to ${w}`);
      for (const o of ord) if (o !== 1 && o !== -1) return ERR.value('The sort order is 1 (smallest first) or −1 (largest first)');
      const keys = idx.map((k, n) => ({ k: k - 1, o: ord[Math.min(n, ord.length - 1)] }));
      const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => {
        for (const { k, o } of keys) { const c = sortCompare(a.r[k], b.r[k]); if (c) return o * c; }
        return a.i - b.i;
      }).map((x) => x.r);
      return array(byCol ? transpose(sorted) : sorted);
    },
  },
  // SORTBY(array, by array 1, [order 1], …): sorted by other rows or columns of the same length
  SORTBY: {
    min: 2, max: 255,
    fn: (args) => {
      const rows = rowsOf(args[0]);
      const h = rows.length, w = rows[0]?.length ?? 0;
      const keys: { v: Value[]; o: number }[] = [];
      let byRow: boolean | null = null;
      for (let i = 1; i < args.length; i += 2) {
        const b = rowsOf(args[i]);
        const rowWise = b[0]?.length === 1 && b.length === h;
        const colWise = !rowWise && b.length === 1 && b[0].length === w;
        if (!rowWise && !colWise) return ERR.value('Each "by" array is one column as tall as the array to sort (or one row as wide)');
        const v = rowWise ? b.map((r) => r[0]) : b[0];
        if (byRow !== null && byRow !== rowWise) return ERR.value('The "by" arrays must all be rows or all columns');
        byRow = rowWise;
        const o = i + 1 < args.length && !omitted(args, i + 1) ? numArg(args, i + 1) : 1;
        if (isError(o)) return o;
        if (Math.trunc(o) !== 1 && Math.trunc(o) !== -1) return ERR.value('The sort order is 1 (smallest first) or −1 (largest first)');
        keys.push({ v, o: Math.trunc(o) });
      }
      const n = byRow ? h : w;
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
        for (const k of keys) { const c = sortCompare(k.v[a], k.v[b]); if (c) return k.o * c; }
        return a - b;
      });
      return array(byRow ? order.map((i) => rows[i]) : rows.map((r) => order.map((j) => r[j])));
    },
  },
  // UNIQUE(array, [by column], [exactly once]): the rows (or columns) without repeats
  UNIQUE: {
    min: 1, max: 3,
    fn: (args) => {
      let rows = rowsOf(args[0]);
      const byCol = optBool(args, 1, false), once = optBool(args, 2, false);
      if (isError(byCol)) return byCol;
      if (isError(once)) return once;
      if (byCol) rows = transpose(rows);
      const count = new Map<string, number>();
      const keyOf = (r: Value[]) => r.map(valueKey).join('\u0000');
      for (const r of rows) count.set(keyOf(r), (count.get(keyOf(r)) ?? 0) + 1);
      const seen = new Set<string>();
      const out: Value[][] = [];
      for (const r of rows) {
        const k = keyOf(r);
        if (seen.has(k) || (once && count.get(k)! > 1)) continue;
        seen.add(k);
        out.push(r);
      }
      if (!out.length) return ERR.calc('No value appears exactly once');
      return array(byCol ? transpose(out) : out);
    },
  },
  // SEQUENCE(rows, [columns], [start], [step]): numbers counting on across, then down
  SEQUENCE: {
    min: 1, max: 4,
    fn: (args) => {
      const r = wholeArg(args, 0, 1), c = wholeArg(args, 1, 1);
      if (isError(r)) return r;
      if (isError(c)) return c;
      const start = optNumber(args, 2, 1), step = optNumber(args, 3, 1);
      if (isError(start)) return start;
      if (isError(step)) return step;
      if (r < 1 || c < 1) return r === 0 || c === 0 ? ERR.calc('SEQUENCE of no rows or columns') : ERR.value('Rows and columns must be 1 or more');
      if (r * c > MAX_ARRAY) return ERR.num('The array would be too large');
      return array(Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => start + (i * c + j) * step)));
    },
  },
  TRANSPOSE: { min: 1, max: 1, fn: (args) => (isBlock(args[0]) ? array(transpose(rowsOf(args[0]))) : args[0]) },
  VSTACK: stack(true),
  HSTACK: stack(false),
  TAKE: takeDrop(true),
  DROP: takeDrop(false),
  CHOOSEROWS: {
    min: 2, max: 255,
    fn: (args) => {
      const rows = rowsOf(args[0]);
      const p = picks(args, 1, rows.length);
      return isError(p) ? p : array(p.map((i) => rows[i]));
    },
  },
  CHOOSECOLS: {
    min: 2, max: 255,
    fn: (args) => {
      const rows = rowsOf(args[0]);
      const p = picks(args, 1, rows[0]?.length ?? 0);
      return isError(p) ? p : array(rows.map((r) => p.map((j) => r[j])));
    },
  },
  // TOCOL and TOROW(array, [ignore: 0 nothing, 1 blanks, 2 errors, 3 both], [by column])
  TOCOL: { min: 1, max: 3, fn: (args) => toLine(args, true) },
  TOROW: { min: 1, max: 3, fn: (args) => toLine(args, false) },
  // SUMPRODUCT(array1, array2, …): the products of matching values, added up (anything not a number counts as 0)
  SUMPRODUCT: {
    min: 1, max: 255,
    fn: (args) => {
      const all = args.map(rowsOf);
      const h = all[0].length, w = all[0][0]?.length ?? 0;
      if (all.some((r) => r.length !== h || (r[0]?.length ?? 0) !== w)) return ERR.value('The arrays must be the same size');
      let sum = 0;
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
        let p = 1;
        for (const r of all) {
          const v = r[i][j];
          if (isError(v)) return v;
          p *= typeof v === 'number' ? v : 0;
        }
        sum += p;
      }
      return sum;
    },
  },
};

function toLine(args: Arg[], down: boolean): Arg {
  let rows = rowsOf(args[0]);
  const ig = wholeArg(args, 1, 0);
  if (isError(ig)) return ig;
  const byCol = optBool(args, 2, false);
  if (isError(byCol)) return byCol;
  if (byCol) rows = transpose(rows);
  const vals = rows.flat().filter((v) => !((ig === 1 || ig === 3) && v === null) && !((ig === 2 || ig === 3) && isError(v)));
  if (!vals.length) return ERR.calc('Nothing is left');
  return array(down ? vals.map((v) => [v]) : [vals]);
}
