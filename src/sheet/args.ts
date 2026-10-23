// What a function is given: single values, and blocks of cells (A1:C9) or arrays worked out by
// another function (LINEST, TEXTSPLIT…). Shared by the formula engine and its function tables.

import type { EvalHost } from './evaluate';
import type { Node } from './formula';
import { MAX_COLS, MAX_ROWS } from './refs';
import { CellError, ERR, Value, isError, toBool, toNumber, toText } from './values';

/**
 * A block of cells given to a function (SUM(A1:A9)), or an array a function worked out. `h`
 * and `w` are its full size; `block` may stop short of that (whole columns are cut to the rows
 * in use), and the cells past its end are empty.
 */
export interface Block {
  block: Value[][];
  h: number;
  w: number;
  /** Worked out by a function rather than read from cells: where one value is wanted, its first is taken. */
  array?: boolean;
  /** Read from cells: the row and column of its top left cell (for @, which picks the cell in the formula's own row or column). */
  at?: { r: number; c: number };
  /** Read from cells on another sheet: its name (unset: the formula's own sheet). */
  sheet?: string;
}
export type Arg = Value | Block;

export type Fn = (args: Arg[], host: EvalHost) => Arg;

export interface FnDef {
  min: number;
  max: number;
  fn: Fn;
}

export const isBlock = (a: Arg): a is Block => typeof a === 'object' && a !== null && 'block' in a;

/**
 * A LAMBDA: its parameters' names, the calculation, and the names it can see where it was
 * written. Carried as an error value, so a LAMBDA that ends up in a cell without being called
 * shows #CALC!, as in Excel, and anything that isn't expecting one passes it on as an error.
 */
export class LambdaValue extends CellError {
  constructor(public params: string[], public body: Node, public host: EvalHost) {
    super('#CALC!', 'A LAMBDA needs calling with its values, as in LAMBDA(x, x*2)(5)');
  }
}

/** More than one value: a block of cells, or an array. */
export const isMulti = (a: Arg): a is Block => isBlock(a) && (a.h > 1 || a.w > 1);

/** The size a block is worked over at: a whole column (or row) stops at the cells in use. */
export function extent(b: Block): { h: number; w: number } {
  return {
    h: b.h >= MAX_ROWS ? Math.max(1, b.block.length) : b.h,
    w: b.w >= MAX_COLS ? Math.max(1, ...b.block.map((r) => r.length)) : b.w,
  };
}

/** Every row of a block, filled out to its full size (empty past the cells it holds). */
export function rowsOf(a: Arg): Value[][] {
  if (!isBlock(a)) return [[a]];
  const { h, w } = extent(a);
  const out: Value[][] = [];
  for (let i = 0; i < h; i++) {
    const src = a.block[i];
    const row: Value[] = new Array<Value>(w);
    for (let j = 0; j < w; j++) row[j] = src?.[j] ?? null;
    out.push(row);
  }
  return out;
}

/** The most values an array worked out in a formula may hold. */
export const MAX_ARRAY = 4_000_000;

/**
 * Work `f` out for each value of the arrays among `args`, as Excel does when an array is given
 * where one value is wanted (=A1:A5*2, =LEN(B2:B9)): an array of one row or column stretches
 * to fit the others, and past the end of a smaller one the answer is #N/A.
 */
export function lift(args: Arg[], f: (vals: Value[]) => Value): Arg {
  const ext = args.map((a) => (isBlock(a) ? extent(a) : null));
  let H = 1, W = 1;
  ext.forEach((e) => { if (e) { H = Math.max(H, e.h); W = Math.max(W, e.w); } });
  if (H * W > MAX_ARRAY) return ERR.num('The array would be too large');
  const rows: Value[][] = [];
  const vals = new Array<Value>(args.length);
  for (let i = 0; i < H; i++) {
    const row: Value[] = new Array<Value>(W);
    for (let j = 0; j < W; j++) {
      for (let k = 0; k < args.length; k++) {
        const a = args[k], e = ext[k];
        if (!e) { vals[k] = a as Value; continue; }
        const ii = e.h === 1 ? 0 : i, jj = e.w === 1 ? 0 : j;
        vals[k] = ii < e.h && jj < e.w ? at(a as Block, ii, jj) : ERR.na('Outside the smaller array');
      }
      row[j] = f(vals);
    }
    rows.push(row);
  }
  return array(rows);
}

/** An array worked out by a function, from its rows. */
export const array = (rows: Value[][]): Block => ({ block: rows, h: rows.length, w: rows[0]?.length ?? 0, array: true });

/** A value as a 1×1 block. */
export const asBlock = (a: Arg): Block => (isBlock(a) ? a : { block: [[a]], h: 1, w: 1 });

/** The value at row i, column j of a block (empty past the cells it holds). */
export const at = (b: Block, i: number, j: number): Value => b.block[i]?.[j] ?? null;

/** A block used where one value is wanted: a single cell gives its value, a worked-out array its first, a larger block of cells #VALUE!. */
export function scalar(a: Arg): Value {
  if (!isBlock(a)) return a;
  if ((a.h === 1 && a.w === 1) || a.array) return at(a, 0, 0);
  return ERR.value('A block of cells where one value was wanted');
}

/** One row or column of values: its length, how many of them are held, and each value. Null for a block of more than one row and column. */
export interface Vec { n: number; held: number; get: (i: number) => Value }
export function vector(a: Arg): Vec | null {
  const b = asBlock(a);
  if (b.h === 1) return { n: b.w, held: Math.min(b.w, b.block[0]?.length ?? 0), get: (i) => at(b, 0, i) };
  if (b.w === 1) return { n: b.h, held: Math.min(b.h, b.block.length), get: (i) => at(b, i, 0) };
  return null;
}

/** Every value of an argument, row by row (only the cells a block holds). */
export function flat(a: Arg): Value[] {
  return isBlock(a) ? a.block.flat() : [a];
}

/** The numbers among the arguments, as SUM sees them: in blocks only numbers count; typed arguments are read as numbers. */
export function numbers(args: Arg[], skipErrors = false): number[] | CellError {
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

/** Whether optional argument i was left out (missing, or an empty slot as in ROUND(A1,)). */
export const omitted = (args: Arg[], i: number): boolean => i >= args.length || args[i] === '';

/** Optional number argument i, `dflt` when left out. */
export function optNumber(args: Arg[], i: number, dflt: number): number | CellError {
  return omitted(args, i) ? dflt : toNumber(scalar(args[i]));
}

/** Optional TRUE/FALSE argument i: `dflt` when missing; an empty slot is FALSE, as Excel reads VLOOKUP(x,A:B,2,). */
export function optBool(args: Arg[], i: number, dflt: boolean): boolean | CellError {
  if (i >= args.length) return dflt;
  const v = scalar(args[i]);
  return v === '' || v === null ? false : toBool(v);
}

/** Argument i as a number. */
export const numArg = (args: Arg[], i: number): number | CellError => toNumber(scalar(args[i]));

/** Argument i as text. */
export const textArg = (args: Arg[], i: number): string | CellError => toText(scalar(args[i]));

/** The first error among some worked-out values, if any. */
export function firstError(...vs: unknown[]): CellError | null {
  for (const v of vs) if (isError(v)) return v;
  return null;
}
