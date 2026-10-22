// What a function is given: single values, and blocks of cells (A1:C9) or arrays worked out by
// another function (LINEST, TEXTSPLIT…). Shared by the formula engine and its function tables.

import type { EvalHost } from './evaluate';
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
  /** Worked out by a function rather than read from cells: one cell shows its first value, as Excel does without spilling. */
  array?: boolean;
}
export type Arg = Value | Block;

export type Fn = (args: Arg[], host: EvalHost) => Arg;

export interface FnDef {
  min: number;
  max: number;
  fn: Fn;
}

export const isBlock = (a: Arg): a is Block => typeof a === 'object' && a !== null && 'block' in a;

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
