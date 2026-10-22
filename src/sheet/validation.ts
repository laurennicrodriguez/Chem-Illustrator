// Data validation, as in Excel (Data > Data Validation): a rule on some cells saying what may be
// typed in them (a number within limits, a date, a length of text, one of a list, or anything a
// formula allows), with a message shown when one of the cells is selected and an alert when
// something else is typed. A list rule gives the cells a drop-down to pick from.
//
// The rule is kept as Excel's dialog shows it: the limits as typed ("10", "=B1", "2026-01-31"),
// and a list as its items ("Pd(OAc)2,PdCl2") or a reference to cells holding them ("=$H$2:$H$9").

import type { Sheet } from './workbook';
import { Range, inRange, parseRange, rangeName } from './refs';
import { Value, isError, readTyped } from './values';
import { formatValue } from './numfmt';

export type ValidationKind = 'any' | 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'length' | 'custom';
export type ValidationOp = 'between' | 'notBetween' | 'equal' | 'notEqual' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual';
export type AlertStyle = 'stop' | 'warning' | 'information';

export interface Validation {
  id: number;
  /** The cells the rule is on. Formulas in it are written for the first cell of the first range. */
  ranges: Range[];
  kind: ValidationKind;
  /** How the value compares with the limits (between, when unset). */
  op?: ValidationOp;
  /** The first limit, the list, or the formula, as typed in the dialog. */
  value1?: string;
  /** The second limit (between and not between). */
  value2?: string;
  /** Empty cells pass (Excel's "Ignore blank", on unless turned off). */
  noBlank?: boolean;
  /** A list rule without the drop-down in its cells. */
  noDropDown?: boolean;
  /** The message shown beside a selected cell. */
  promptTitle?: string;
  prompt?: string;
  /** Keep the message without showing it (Excel's "Show input message" turned off). */
  hidePrompt?: boolean;
  /** The alert when something else is typed. */
  alertStyle?: AlertStyle;
  alertTitle?: string;
  alert?: string;
  /** Let anything be typed without an alert (the rule still circles what breaks it). */
  noAlert?: boolean;
}

let nextId = 1;
export function newValidation(ranges: Range[], rule: Omit<Validation, 'id' | 'ranges'>): Validation {
  return { id: nextId++, ranges: ranges.map((r) => ({ ...r })), ...rule };
}
/** Ids read from a file are kept, so new rules don't reuse them. */
export function seenValidationId(id: number): void {
  if (id >= nextId) nextId = id + 1;
}

/** The rule on a cell (the first, if rules overlap, as Excel keeps only one per cell). */
export function validationAt(list: Validation[], row: number, col: number): Validation | undefined {
  return list.find((v) => v.ranges.some((r) => inRange(r, row, col)));
}

export const KIND_NAMES: Record<ValidationKind, string> = {
  any: 'Any value', whole: 'Whole number', decimal: 'Decimal', list: 'List', date: 'Date', time: 'Time', length: 'Text length', custom: 'Custom',
};

export const OP_NAMES: Record<ValidationOp, string> = {
  between: 'between', notBetween: 'not between', equal: 'equal to', notEqual: 'not equal to',
  greaterThan: 'greater than', lessThan: 'less than', greaterThanOrEqual: 'greater than or equal to', lessThanOrEqual: 'less than or equal to',
};

/** Does the rule compare with two limits? */
export const twoLimits = (v: Pick<Validation, 'op'>): boolean => (v.op ?? 'between') === 'between' || v.op === 'notBetween';

// ---------------------------------------------------------------- dates and times typed as limits

/** 2026-01-31, 1/31/2026 or 31 Jan 2026 as Excel's day number; null when it isn't a date. */
export function readDate(text: string): number | null {
  const s = text.trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [m, d, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else {
    const t = Date.parse(s + ' UTC');
    if (!/[a-z]/i.test(s) || isNaN(t)) return null;
    const dt = new Date(t);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** 13:30 or 1:30 PM as a fraction of a day; null when it isn't a time. */
export function readTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[4]) h = (h % 12) + (/pm/i.test(m[4]) ? 12 : 0);
  if (h > 23 || Number(m[2]) > 59) return null;
  return (h * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400;
}

/** A limit as a number, as typed for a rule of this kind (null when it doesn't read). */
export function limitNumber(kind: ValidationKind, text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (kind === 'date') { const d = readDate(t); if (d !== null) return d; }
  if (kind === 'time') { const d = readTime(t); if (d !== null) return d; }
  const v = readTyped(t).value;
  return typeof v === 'number' ? v : null;
}

/** A number from a file shown as the dialog would have it typed (a date as 2026-01-31). */
export function limitText(kind: ValidationKind, n: number): string {
  if (kind === 'date' && Number.isInteger(n)) return formatValue(n, 'yyyy-mm-dd').text;
  if (kind === 'time' && n >= 0 && n < 1) return formatValue(n, 'hh:mm').text;
  return String(n);
}

// ---------------------------------------------------------------- checking a value

/** What the rule needs from the workbook: a formula worked out for a cell, and a sheet by name. */
export interface ValidationHost {
  formulaAt(formula: string, home: { row: number; col: number }, row: number, col: number): Value;
  sheetNamed(name: string): Sheet | undefined;
}

const homeOf = (v: Validation) => ({ row: v.ranges[0]?.r1 ?? 0, col: v.ranges[0]?.c1 ?? 0 });

/** A limit worked out for a cell (a formula moves with the cell, as in a copied formula). */
function limit(v: Validation, text: string | undefined, host: ValidationHost, row: number, col: number): number | null {
  if (text === undefined) return null;
  if (text.trim().startsWith('=')) {
    const got = host.formulaAt(text.trim(), homeOf(v), row, col);
    return typeof got === 'number' ? got : typeof got === 'boolean' ? Number(got) : null;
  }
  return limitNumber(v.kind, text);
}

function compare(op: ValidationOp, x: number, a: number | null, b: number | null): boolean {
  if (a === null) return false;
  switch (op) {
    case 'between': return b !== null && x >= Math.min(a, b) && x <= Math.max(a, b);
    case 'notBetween': return b !== null && (x < Math.min(a, b) || x > Math.max(a, b));
    case 'equal': return x === a;
    case 'notEqual': return x !== a;
    case 'greaterThan': return x > a;
    case 'lessThan': return x < a;
    case 'greaterThanOrEqual': return x >= a;
    default: return x <= a;
  }
}

/** A sheet-qualified reference ("Sheet2!$A$1:$A$5" or "'Reagent list'!A:A"), split. */
function splitRef(text: string): { sheet?: string; range: Range } | null {
  const t = text.trim().replace(/^=/, '');
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(t);
  const sheet = m ? (m[1] ?? m[2]).replace(/''/g, "'") : undefined;
  const ref = m ? m[3] : t;
  // whole columns ($H:$H) reach to the end of what's in use
  const col = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(ref);
  const range = col ? parseRange(`${col[1]}1:${col[2]}1048576`) : parseRange(ref);
  return range ? { sheet, range } : null;
}

/** The items of a list rule, as the drop-down shows them (cells' items as they show). */
export function listItems(v: Validation, sheet: Sheet, host: ValidationHost): string[] {
  const src = (v.value1 ?? '').trim();
  if (!src) return [];
  if (!src.startsWith('=')) return src.split(',').map((x) => x.trim()).filter((x) => x !== '');
  const ref = splitRef(src);
  if (!ref) return [];
  const s = ref.sheet ? host.sheetNamed(ref.sheet) : sheet;
  if (!s) return [];
  const out: string[] = [];
  const R = ref.range;
  for (let r = R.r1; r <= Math.min(R.r2, s.lastRow); r++) {
    for (let c = R.c1; c <= Math.min(R.c2, s.lastCol); c++) {
      const t = s.shownText(r, c);
      if (t !== '') out.push(t);
    }
  }
  return out;
}

/** Does a cell's value pass the rule? (`shown` is the value as the cell shows it.) */
export function passes(v: Validation, value: Value, shown: string, sheet: Sheet, host: ValidationHost, row: number, col: number): boolean {
  if (v.kind === 'any') return true;
  if (value === null || value === '') return !v.noBlank;
  if (isError(value)) return false;
  const op = v.op ?? 'between';
  switch (v.kind) {
    case 'whole':
      return typeof value === 'number' && Number.isInteger(value) && compare(op, value, limit(v, v.value1, host, row, col), limit(v, v.value2, host, row, col));
    case 'decimal': case 'date':
      return typeof value === 'number' && compare(op, value, limit(v, v.value1, host, row, col), limit(v, v.value2, host, row, col));
    case 'time':
      // a time compares by its time of day
      return typeof value === 'number' && compare(op, value - Math.floor(value), limit(v, v.value1, host, row, col), limit(v, v.value2, host, row, col));
    case 'length':
      return compare(op, shown.length, limit(v, v.value1, host, row, col), limit(v, v.value2, host, row, col));
    case 'list': {
      // Excel matches list items without minding capitals
      const want = shown.trim().toLowerCase();
      return listItems(v, sheet, host).some((x) => x.toLowerCase() === want);
    }
    case 'custom': {
      if (!v.value1?.trim()) return true;
      const got = host.formulaAt(v.value1.trim().startsWith('=') ? v.value1.trim() : '=' + v.value1.trim(), homeOf(v), row, col);
      return got === true || (typeof got === 'number' && got !== 0);
    }
  }
  return true;
}

/** "a whole number between 1 and 10", for alerts and the panel. */
export function describeValidation(v: Validation): string {
  const op = v.op ?? 'between';
  const lim = twoLimits(v) ? `${OP_NAMES[op]} ${v.value1 ?? ''} and ${v.value2 ?? ''}` : `${OP_NAMES[op]} ${v.value1 ?? ''}`;
  switch (v.kind) {
    case 'any': return 'any value';
    case 'whole': return `a whole number ${lim}`;
    case 'decimal': return `a number ${lim}`;
    case 'date': return `a date ${lim}`;
    case 'time': return `a time ${lim}`;
    case 'length': return `text with a length ${lim}`;
    case 'list': {
      const src = (v.value1 ?? '').trim();
      return src.startsWith('=') ? `one of the items in ${src.slice(1)}` : `one of: ${src.split(',').map((x) => x.trim()).filter(Boolean).join(', ')}`;
    }
    case 'custom': return `a value for which ${v.value1 ?? ''} is TRUE`;
  }
}

/** The rule's ranges as text ("B2:B20, D2"). */
export const validationRangesText = (v: Validation): string => v.ranges.map(rangeName).join(', ');

/** Every cell in use that breaks a rule (for Circle Invalid Data). */
export function invalidCells(sheet: Sheet, host: ValidationHost): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (const v of sheet.validations) {
    if (v.kind === 'any') continue;
    for (const R of v.ranges) {
      for (let r = R.r1; r <= Math.min(R.r2, sheet.lastRow); r++) {
        for (let c = R.c1; c <= Math.min(R.c2, sheet.lastCol); c++) {
          if (validationAt(sheet.validations, r, c) !== v) continue;
          const val = sheet.value(r, c);
          // empty cells aren't circled, even where blanks aren't allowed (as in Excel)
          if (val === null || val === '') continue;
          if (!passes(v, val, sheet.shownText(r, c), sheet, host, r, c)) out.push({ row: r, col: c });
        }
      }
    }
  }
  return out;
}
