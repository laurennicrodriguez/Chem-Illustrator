// What a cell holds once worked out: a number, text, TRUE/FALSE, nothing, or an error such as
// #DIV/0!. Also how typed text becomes a value (as Excel reads it), and how values compare.

import { readWithUnit } from './units';

/** An error value. The codes are Excel's, plus #CIRC! for a formula that depends on itself. */
export class CellError {
  constructor(public code: string, public detail = '') {}
  toString(): string { return this.code; }
}

export const ERR = {
  div0: (detail = 'Divided by zero') => new CellError('#DIV/0!', detail),
  value: (detail = 'A value of the wrong kind') => new CellError('#VALUE!', detail),
  ref: (detail = 'A cell that no longer exists') => new CellError('#REF!', detail),
  name: (detail = 'A name this program does not know') => new CellError('#NAME?', detail),
  num: (detail = 'A number out of range') => new CellError('#NUM!', detail),
  na: (detail = 'Not available') => new CellError('#N/A', detail),
  circ: () => new CellError('#CIRC!', 'This formula uses its own result (a circular reference)'),
  /** Still being worked out (structure properties come from the chemistry engine a moment later). */
  busy: () => new CellError('#BUSY!', 'Being worked out'),
};

/** The error codes Excel itself knows (others are saved as #VALUE!). */
export const EXCEL_ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];

export type Value = number | string | boolean | null | CellError;

export const isError = (v: unknown): v is CellError => v instanceof CellError;

/** What typed text means, and a number format it suggests (typing 5% shows as a percentage). */
export interface Typed {
  value: Value;
  formula?: string;
  /** Excel picks a format for some typing: "5%" → 0%, "1.5E-3" → 0.00E+00. */
  format?: string;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

/** Read what was typed into a cell. Starting with = makes a formula; with ' keeps it as text. */
export function readTyped(input: string): Typed {
  if (input === '') return { value: null };
  if (input.length > 1 && input[0] === '=') return { value: null, formula: input };
  if (input[0] === "'") return { value: input.slice(1) };
  const s = input.trim();
  if (NUMBER.test(s)) {
    const v = Number(s);
    return { value: v, format: /e/i.test(s) ? '0.00E+00' : undefined };
  }
  if (GROUPED.test(s)) {
    const dec = s.includes('.') ? s.split('.')[1].length : 0;
    return { value: Number(s.replace(/,/g, '')), format: dec ? `#,##0.${'0'.repeat(dec)}` : '#,##0' };
  }
  const pct = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*%$/.exec(s);
  if (pct) {
    const dec = pct[1].includes('.') ? pct[1].split('.')[1].length : 0;
    return { value: Number(pct[1]) / 100, format: dec ? `0.${'0'.repeat(dec)}%` : '0%' };
  }
  // a number with a unit (-78 °C, 5 mol%): the number, shown with the unit
  const unit = readWithUnit(s);
  if (unit) return unit;
  const up = s.toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') return { value: up === 'TRUE' };
  return { value: input };
}

/** A value as a number for arithmetic (empty is 0, TRUE is 1, number-like text is read). */
export function toNumber(v: Value): number | CellError {
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof CellError) return v;
  const t = v.trim();
  if (t === '') return 0;
  const typed = readTyped(t);
  // text with a unit stays text in formulas, as in Excel ("5 M"*2 is #VALUE!); typed into a cell it is a number
  if (typeof typed.value === 'number' && !typed.formula && !readWithUnit(t)) return typed.value;
  return ERR.value(`"${v}" is not a number`);
}

/** A value as text, as Excel joins it with & (numbers written plainly). */
export function toText(v: Value): string | CellError {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof CellError) return v;
  return numberText(v);
}

/** A number written as Excel's General format writes it in a formula result: up to 15 significant figures. */
export function numberText(n: number): string {
  if (!Number.isFinite(n)) return '#NUM!';
  if (n === 0) return '0';
  const s = String(Number(n.toPrecision(15)));
  return s.includes('e') ? s.replace('e+', 'E+').replace('e-', 'E-') : s;
}

/** TRUE or FALSE for IF and the like. */
export function toBool(v: Value): boolean | CellError {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v instanceof CellError) return v;
  const u = v.trim().toUpperCase();
  if (u === 'TRUE') return true;
  if (u === 'FALSE') return false;
  return ERR.value(`"${v}" is not TRUE or FALSE`);
}

/** Excel's order when sorting and comparing: numbers, then text (ignoring case), then TRUE/FALSE. */
const rank = (v: Value): number => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);

/** Compare two values: negative, zero or positive. Empty counts as 0 against a number and "" against text. */
export function compareValues(a: Value, b: Value): number {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number') return a - (b as number);
  if (typeof a === 'string') {
    const x = a.toLowerCase(), y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'boolean') return Number(a) - Number(b as boolean);
  return 0;
}

/** Two values the same, as = compares them. */
export const sameValue = (a: Value, b: Value): boolean => compareValues(a, b) === 0;
