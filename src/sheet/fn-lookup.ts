// Looking values up in a table: VLOOKUP, HLOOKUP, XLOOKUP, INDEX, MATCH and XMATCH, matching as
// Excel does (text ignoring case, wildcards in exact matches, sorted data searched by halving).
// CHOOSE, OFFSET and INDIRECT need the formula itself, so they live with the formula engine.

import { Block, FnDef, Vec, asBlock, at, isBlock, numArg, omitted, optBool, optNumber, scalar, vector } from './args';
import { hasWildcards, wildcardRegex } from './fn-criteria';
import { CellError, ERR, Value, compareValues, isError, toNumber } from './values';

/** Values of one kind compare: numbers with numbers, text with text, TRUE/FALSE with TRUE/FALSE. */
const kind = (v: Value): string => (v === null ? 'empty' : isError(v) ? 'error' : typeof v);

/** A test for an exact match of x (text ignores case; with `wild`, text may use * ? ~). */
function exactTest(x: Value, wild: boolean): (v: Value) => boolean {
  if (typeof x === 'string' && wild && hasWildcards(x)) {
    const re = wildcardRegex(x);
    return (v) => typeof v === 'string' && re.test(v);
  }
  const k = kind(x);
  return (v) => kind(v) === k && compareValues(v, x) === 0;
}

/** The first (or, from the end, the last) position holding x; −1 when none. */
function exactIndex(v: Vec, x: Value, wild: boolean, fromEnd = false): number {
  const test = exactTest(x, wild);
  if (fromEnd) { for (let i = v.held - 1; i >= 0; i--) if (test(v.get(i))) return i; }
  else for (let i = 0; i < v.held; i++) if (test(v.get(i))) return i;
  return -1;
}

/**
 * Searching data sorted ascending (or descending) by halving, as Excel does for an approximate
 * match: the last position whose value is at or below x (at or above, descending). Only values
 * of x's kind take part. −1 when none.
 */
function sortedIndex(v: Vec, x: Value, descending: boolean): number {
  const k = kind(x);
  const idx: number[] = [];
  for (let i = 0; i < v.held; i++) if (kind(v.get(i)) === k) idx.push(i);
  let lo = 0, hi = idx.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = compareValues(v.get(idx[mid]), x);
    if (descending ? c >= 0 : c <= 0) lo = mid + 1; else hi = mid;
  }
  return lo > 0 ? idx[lo - 1] : -1;
}

/** The first position, in sorted data, whose value is at or above x (at or below, descending). */
function sortedIndexAbove(v: Vec, x: Value, descending: boolean): number {
  const k = kind(x);
  const idx: number[] = [];
  for (let i = 0; i < v.held; i++) if (kind(v.get(i)) === k) idx.push(i);
  let lo = 0, hi = idx.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = compareValues(v.get(idx[mid]), x);
    if (descending ? c > 0 : c < 0) lo = mid + 1; else hi = mid;
  }
  return lo < idx.length ? idx[lo] : -1;
}

/**
 * XMATCH's search. mode: 0 exact, −1 exact or next smaller, 1 exact or next larger, 2 wildcard.
 * search: 1 first to last, −1 last to first, 2 halving through ascending data, −2 descending.
 */
function xmatch(v: Vec, x: Value, mode: number, search: number): number {
  if (search === 2 || search === -2) {
    const desc = search === -2;
    if (mode === 2) return exactIndex(v, x, true);
    const below = desc ? sortedIndexAbove(v, x, true) : sortedIndex(v, x, false);
    const above = desc ? sortedIndex(v, x, true) : sortedIndexAbove(v, x, false);
    // `below` holds the nearest value at or below x, `above` the nearest at or above it
    const exact = [below, above].find((i) => i >= 0 && compareValues(v.get(i), x) === 0);
    if (exact !== undefined) return exact;
    if (mode === -1) return below;
    if (mode === 1) return above;
    return -1;
  }
  const fromEnd = search === -1;
  if (mode === 0 || mode === 2) return exactIndex(v, x, mode === 2, fromEnd);
  const k = kind(x);
  let best = -1;
  for (let s = 0; s < v.held; s++) {
    const i = fromEnd ? v.held - 1 - s : s;
    const val = v.get(i);
    if (kind(val) !== k) continue;
    const c = compareValues(val, x);
    if (c === 0) return i;
    if (mode === -1 ? c > 0 : c < 0) continue;
    if (best < 0 || (mode === -1 ? compareValues(val, v.get(best)) > 0 : compareValues(val, v.get(best)) < 0)) best = i;
  }
  return best;
}

/** Whole numbers from an argument, as Excel cuts them (2.9 → 2). */
const whole = (x: number): number => Math.trunc(x);

/** Row (or column) i of a block, as an array. */
function line(b: Block, i: number, byRow: boolean): Block {
  if (byRow) return { block: [b.block[i] ? [...b.block[i]] : []], h: 1, w: b.w, array: b.array };
  return { block: b.block.map((r) => [r[i] ?? null]), h: b.h, w: 1, array: b.array };
}

/** VLOOKUP and HLOOKUP. */
const tableLookup = (byRow: boolean): FnDef => ({
  min: 3, max: 4,
  fn: (args) => {
    const x = scalar(args[0]);
    if (isError(x)) return x;
    const t = asBlock(args[1]);
    const k = numArg(args, 2);
    if (isError(k)) return k;
    const approx = optBool(args, 3, true);
    if (isError(approx)) return approx;
    const n = whole(k);
    if (n < 1) return ERR.value(`The ${byRow ? 'row' : 'column'} number must be 1 or more`);
    if (n > (byRow ? t.h : t.w)) return ERR.ref(`The table has only ${byRow ? t.h : t.w} ${byRow ? 'rows' : 'columns'}`);
    const first: Vec = byRow
      ? { n: t.w, held: Math.min(t.w, t.block[0]?.length ?? 0), get: (j) => at(t, 0, j) }
      : { n: t.h, held: Math.min(t.h, t.block.length), get: (i) => at(t, i, 0) };
    const i = approx ? sortedIndex(first, x, false) : exactIndex(first, x, true);
    if (i < 0) return ERR.na(`${typeof x === 'string' ? `"${x}"` : String(x)} was not found`);
    return byRow ? at(t, n - 1, i) : at(t, i, n - 1);
  },
});

export const LOOKUP_FUNCTIONS: Record<string, FnDef> = {
  VLOOKUP: tableLookup(false),
  HLOOKUP: tableLookup(true),
  // MATCH(x, row or column, [1 sorted ascending | 0 exact | −1 sorted descending]): the position found
  MATCH: {
    min: 2, max: 3,
    fn: (args) => {
      const x = scalar(args[0]);
      if (isError(x)) return x;
      const v = vector(args[1]);
      if (!v) return ERR.na('MATCH looks in one row or one column');
      const t = optNumber(args, 2, 1);
      if (isError(t)) return t;
      const type = Math.sign(whole(t));
      const i = type === 0 ? exactIndex(v, x, true) : sortedIndex(v, x, type < 0);
      return i < 0 ? ERR.na('Not found') : i + 1;
    },
  },
  XMATCH: {
    min: 2, max: 4,
    fn: (args) => {
      const x = scalar(args[0]);
      if (isError(x)) return x;
      const v = vector(args[1]);
      if (!v) return ERR.value('XMATCH looks in one row or one column');
      const mode = optNumber(args, 2, 0), search = optNumber(args, 3, 1);
      if (isError(mode)) return mode;
      if (isError(search)) return search;
      if (![0, -1, 1, 2].includes(whole(mode)) || ![1, -1, 2, -2].includes(whole(search))) return ERR.value('Match mode is 0, −1, 1 or 2; search mode 1, −1, 2 or −2');
      const i = xmatch(v, x, whole(mode), whole(search));
      return i < 0 ? ERR.na('Not found') : i + 1;
    },
  },
  // XLOOKUP(x, look in, return from, [if not found], [match mode], [search mode])
  XLOOKUP: {
    min: 3, max: 6,
    fn: (args) => {
      const x = scalar(args[0]);
      if (isError(x)) return x;
      const v = vector(args[1]);
      if (!v) return ERR.value('XLOOKUP looks in one row or one column');
      const ret = asBlock(args[2]);
      const byCol = asBlock(args[1]).w === 1 && asBlock(args[1]).h > 1;
      if ((byCol ? ret.h : ret.w) !== v.n) return ERR.value('The range to return from must be as long as the range looked in');
      const mode = optNumber(args, 4, 0), search = optNumber(args, 5, 1);
      if (isError(mode)) return mode;
      if (isError(search)) return search;
      if (![0, -1, 1, 2].includes(whole(mode)) || ![1, -1, 2, -2].includes(whole(search))) return ERR.value('Match mode is 0, −1, 1 or 2; search mode 1, −1, 2 or −2');
      const i = xmatch(v, x, whole(mode), whole(search));
      if (i < 0) return omitted(args, 3) ? ERR.na('Not found') : args[3];
      // a single row or column to return from gives one value; a wider block gives the whole row (or column)
      if (byCol) return ret.w === 1 ? at(ret, i, 0) : line(ret, i, true);
      return ret.h === 1 ? at(ret, 0, i) : line(ret, i, false);
    },
  },
  // INDEX(block, row, [column]): one value, or with 0 a whole column (or row)
  INDEX: {
    min: 2, max: 3,
    fn: (args) => {
      const b = asBlock(args[0]);
      const r0 = numArg(args, 1);
      if (isError(r0)) return r0;
      const c0 = optNumber(args, 2, NaN);
      if (isError(c0)) return c0;
      let r = whole(r0), c = Number.isNaN(c0) ? NaN : whole(c0);
      // one index into a single row picks the column
      if (Number.isNaN(c)) {
        if (b.h === 1 && b.w > 1) { c = r; r = 1; }
        else c = b.w === 1 ? 1 : 0;
      }
      if (r < 0 || c < 0) return ERR.value('INDEX needs row and column numbers of 0 or more');
      if (r > b.h || c > b.w) return ERR.ref('Outside the block');
      if (r === 0 && c === 0) return b;
      if (r === 0) return b.w === 1 ? b : line(b, c - 1, false);
      if (c === 0) return b.h === 1 ? b : line(b, r - 1, true);
      return at(b, r - 1, c - 1);
    },
  },
  ROWS: { min: 1, max: 1, fn: (args) => (isBlock(args[0]) ? args[0].h : 1) },
  COLUMNS: { min: 1, max: 1, fn: (args) => (isBlock(args[0]) ? args[0].w : 1) },
};

/** CHOOSE's index: a whole number from 1 to the number of choices. */
export function chooseIndex(v: Value, count: number): number | CellError {
  const n = toNumber(v);
  if (isError(n)) return n;
  const i = whole(n);
  return i < 1 || i > count ? ERR.value(`CHOOSE picks from 1 to ${count}`) : i;
}
