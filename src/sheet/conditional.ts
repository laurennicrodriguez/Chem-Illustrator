// Conditional formatting, as in Excel: cells change their look by their values. Colour scales
// shade from one colour to another across the values, data bars draw a bar as long as the value,
// icon sets put an arrow or light by each value, and highlight rules fill or colour the cells
// that pass a test (greater than, contains, top 10, above average, duplicates, blank, or any
// formula). Rules apply in list order: where two rules set the same thing, the first one wins,
// and a rule marked "stop" keeps the rules below it off the cells it matches.

import type { Range } from './refs';
import { keyOf, inRange } from './refs';
import { Value, isError, compareValues, sigFigs15 } from './values';

/** How one end (or the middle) of a scale or bar is set. */
export interface CfValue {
  type: 'min' | 'max' | 'num' | 'percent' | 'percentile' | 'auto';
  value?: number;
}

/** The look a highlight rule gives. */
export interface CfLook {
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type CfOp = 'gt' | 'ge' | 'lt' | 'le' | 'eq' | 'ne' | 'between' | 'notBetween';
export type IconSetName = 'arrows' | 'lights' | 'marks' | 'flags' | 'stars';

export type CfRule =
  /** Two or three colours spread over the values. */
  | { kind: 'scale'; stops: { at: CfValue; color: string }[] }
  /** A bar as long as the value. */
  | { kind: 'bar'; color: string; gradient?: boolean; min?: CfValue; max?: CfValue; barOnly?: boolean }
  /** Three icons: the top third, middle and bottom (or by the limits given). */
  | { kind: 'icons'; set: IconSetName; reverse?: boolean; limits?: [CfValue, CfValue]; iconOnly?: boolean }
  /** Cells whose value passes a comparison. */
  | { kind: 'cells'; op: CfOp; value: number | string; value2?: number | string; look: CfLook }
  /** Cells whose text contains, starts or ends with some text (ignoring capitals). */
  | { kind: 'text'; op: 'contains' | 'notContains' | 'begins' | 'ends'; text: string; look: CfLook }
  /** The highest or lowest values (a number of them, or a percentage). */
  | { kind: 'top'; n: number; percent?: boolean; bottom?: boolean; look: CfLook }
  /** Values above (or below) the average. */
  | { kind: 'average'; below?: boolean; look: CfLook }
  /** Values that appear more than once (or only once). */
  | { kind: 'duplicates'; unique?: boolean; look: CfLook }
  /** Empty cells (or cells with something in them). */
  | { kind: 'blank'; not?: boolean; look: CfLook }
  /** Cells where a formula, written for the range's top-left cell, is true. */
  | { kind: 'formula'; formula: string; look: CfLook };

export interface CondFormat {
  id: number;
  /** The cells it applies to. */
  ranges: Range[];
  rule: CfRule;
  /** Rules below this one don't apply to the cells it matches. */
  stop?: boolean;
}

/** What conditional formatting does to one cell. */
export interface CellLook extends CfLook {
  /** A data bar: where it starts and ends across the cell (0 to 1), and its colour. */
  bar?: { from: number; to: number; color: string; gradient: boolean; negative: boolean };
  /** An icon: the set and its level (0 the lowest, 2 the highest). */
  icon?: { set: IconSetName; level: number };
  /** Show only the bar or icon, not the value. */
  hideValue?: boolean;
}

/** What the rules need from the sheet. */
export interface CfHost {
  value(row: number, col: number): Value;
  /** The value of a formula for a cell (formula rules), or null when it can't be worked out. */
  formulaAt(formula: string, home: { row: number; col: number }, row: number, col: number): Value;
}

let nextId = 1;
export function newCondFormat(ranges: Range[], rule: CfRule, stop?: boolean): CondFormat {
  return { id: nextId++, ranges: ranges.map((r) => ({ ...r })), rule, ...(stop ? { stop } : {}) };
}

/** Keep new ids clear of ones read from a file. */
export function seenCondFormatId(id: number): void {
  if (id >= nextId) nextId = id + 1;
}

// ---------------------------------------------------------------- colours

const hex = (c: string): [number, number, number] => {
  const h = c.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
};
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** A colour part-way between two (t from 0 to 1). */
export function mixColour(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

// ---------------------------------------------------------------- numbers

const numOf = (v: Value): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The p-th percentile (0 to 100) of sorted numbers, as Excel's PERCENTILE.INC works it out. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const pos = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The number a scale end stands for, among the range's numbers. */
export function cfPoint(v: CfValue, sorted: number[], fallback: 'min' | 'max'): number {
  const min = sorted[0] ?? 0, max = sorted[sorted.length - 1] ?? 0;
  switch (v.type) {
    case 'min': return min;
    case 'max': return max;
    case 'num': return v.value ?? 0;
    case 'percent': return min + ((v.value ?? 0) / 100) * (max - min);
    case 'percentile': return percentile(sorted, v.value ?? 0);
    default:
      // automatic: bars start at zero where the numbers are all positive (or all negative)
      if (fallback === 'min') return Math.min(0, min);
      return Math.max(0, max);
  }
}

/** The colour of a value on a scale of stops (already worked out as numbers). */
export function scaleColour(x: number, stops: { at: number; color: string }[]): string {
  if (x <= stops[0].at) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (x <= b.at) return b.at === a.at ? b.color : mixColour(a.color, b.color, (x - a.at) / (b.at - a.at));
  }
  return stops[stops.length - 1].color;
}

/** Does a value pass a comparison? Text compares as text, ignoring capitals. */
export function passesOp(v: Value, op: CfOp, a: number | string, b?: number | string): boolean {
  if (v === null || v === '' || isError(v)) return false;
  const cmp = (x: number | string) => {
    if (typeof x === 'number' && typeof v === 'number') return sigFigs15(v) - sigFigs15(x);
    if (typeof x === 'number' || typeof v === 'number') return typeof v === 'number' ? -1 : 1; // numbers sort before text
    return compareValues(v, x);
  };
  switch (op) {
    case 'gt': return cmp(a) > 0;
    case 'ge': return cmp(a) >= 0;
    case 'lt': return cmp(a) < 0;
    case 'le': return cmp(a) <= 0;
    case 'eq': return cmp(a) === 0;
    case 'ne': return cmp(a) !== 0;
    case 'between': case 'notBetween': {
      const lo = b === undefined ? a : (typeof a === 'number' && typeof b === 'number' ? Math.min(a, b) : a);
      const hi = b === undefined ? a : (typeof a === 'number' && typeof b === 'number' ? Math.max(a, b) : b);
      const inside = cmp(lo) >= 0 && cmp(hi) <= 0;
      return op === 'between' ? inside : !inside;
    }
  }
}

const textOf = (v: Value): string => (v === null || isError(v) ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
const truthy = (v: Value): boolean => v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && /^true$/i.test(v));

// ---------------------------------------------------------------- working it out

/** The cells of a list of ranges, cut to the cells in use. */
function* cellsOf(ranges: Range[], lastRow: number, lastCol: number): Generator<[number, number]> {
  const seen = new Set<number>();
  for (const r of ranges) {
    for (let row = r.r1; row <= Math.min(r.r2, lastRow); row++) {
      for (let col = r.c1; col <= Math.min(r.c2, lastCol); col++) {
        const k = keyOf(row, col);
        if (seen.has(k)) continue;
        seen.add(k);
        yield [row, col];
      }
    }
  }
}

/**
 * What every rule does to every cell, worked out once for the sheet's values. Keyed by cell.
 * `lastRow` and `lastCol` bound the cells in use (rules on whole columns stop there).
 */
export function workOutLooks(rules: CondFormat[], host: CfHost, lastRow: number, lastCol: number): Map<number, CellLook> {
  const out = new Map<number, CellLook>();
  const stopped = new Set<number>();
  for (const cf of rules) {
    const cells = [...cellsOf(cf.ranges, lastRow, lastCol)];
    if (!cells.length) continue;
    const values = cells.map(([r, c]) => host.value(r, c));
    const nums = values.map(numOf);
    const sorted = nums.filter((x): x is number => x !== null).sort((a, b) => a - b);
    const home = { row: Math.min(...cf.ranges.map((r) => r.r1)), col: Math.min(...cf.ranges.map((r) => r.c1)) };
    const rule = cf.rule;

    // what the rule gives each cell (null: nothing)
    let lookFor: (i: number) => CellLook | null;
    switch (rule.kind) {
      case 'scale': {
        const stops = rule.stops.map((s, i) => ({ at: cfPoint(s.at, sorted, i === 0 ? 'min' : 'max'), color: s.color }));
        lookFor = (i) => (nums[i] === null ? null : { fill: scaleColour(nums[i]!, stops) });
        break;
      }
      case 'bar': {
        const lo = cfPoint(rule.min ?? { type: 'auto' }, sorted, 'min');
        const hi = cfPoint(rule.max ?? { type: 'auto' }, sorted, 'max');
        const span = hi - lo || 1;
        // the axis: where zero falls when the bars reach both sides of it
        const zero = lo < 0 && hi > 0 ? -lo / span : lo >= 0 ? 0 : 1;
        lookFor = (i) => {
          const x = nums[i];
          if (x === null) return null;
          const at = Math.max(0, Math.min(1, (x - lo) / span));
          const from = Math.min(zero, at), to = Math.max(zero, at);
          return { bar: { from, to: Math.max(to, from + 0.02), color: rule.color, gradient: rule.gradient !== false, negative: x < 0 }, hideValue: rule.barOnly };
        };
        break;
      }
      case 'icons': {
        const [a, b] = rule.limits ?? [{ type: 'percent', value: 33 }, { type: 'percent', value: 67 }];
        const t1 = cfPoint(a, sorted, 'min'), t2 = cfPoint(b, sorted, 'max');
        lookFor = (i) => {
          const x = nums[i];
          if (x === null) return null;
          let level = x >= t2 ? 2 : x >= t1 ? 1 : 0;
          if (rule.reverse) level = 2 - level;
          return { icon: { set: rule.set, level }, hideValue: rule.iconOnly };
        };
        break;
      }
      case 'cells':
        lookFor = (i) => (passesOp(values[i], rule.op, rule.value, rule.value2) ? rule.look : null);
        break;
      case 'text': {
        const t = rule.text.toLowerCase();
        lookFor = (i) => {
          const s = textOf(values[i]).toLowerCase();
          const hit = rule.op === 'contains' ? s.includes(t) : rule.op === 'notContains' ? !s.includes(t) : rule.op === 'begins' ? s.startsWith(t) : s.endsWith(t);
          return hit ? rule.look : null;
        };
        break;
      }
      case 'top': {
        const count = rule.percent ? Math.max(1, Math.floor((sorted.length * rule.n) / 100)) : Math.max(1, Math.floor(rule.n));
        const cut = rule.bottom ? sorted[Math.min(count, sorted.length) - 1] : sorted[Math.max(0, sorted.length - count)];
        lookFor = (i) => (nums[i] !== null && cut !== undefined && (rule.bottom ? nums[i]! <= cut : nums[i]! >= cut) ? rule.look : null);
        break;
      }
      case 'average': {
        const mean = sorted.reduce((s, x) => s + x, 0) / (sorted.length || 1);
        lookFor = (i) => (nums[i] !== null && (rule.below ? nums[i]! < mean : nums[i]! > mean) ? rule.look : null);
        break;
      }
      case 'duplicates': {
        const counts = new Map<string, number>();
        const keyOfValue = (v: Value) => (v === null || v === '' || isError(v) ? null : typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v));
        for (const v of values) { const k = keyOfValue(v); if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1); }
        lookFor = (i) => {
          const k = keyOfValue(values[i]);
          if (k === null) return null;
          const dup = counts.get(k)! > 1;
          return (rule.unique ? !dup : dup) ? rule.look : null;
        };
        break;
      }
      case 'blank':
        lookFor = (i) => {
          const empty = values[i] === null || (typeof values[i] === 'string' && !(values[i] as string).trim());
          return (rule.not ? !empty : empty) ? rule.look : null;
        };
        break;
      case 'formula':
        lookFor = (i) => (truthy(host.formulaAt(rule.formula, home, cells[i][0], cells[i][1])) ? rule.look : null);
        break;
    }

    cells.forEach(([r, c], i) => {
      const k = keyOf(r, c);
      if (stopped.has(k)) return;
      const look = lookFor(i);
      if (!look) return;
      const had = out.get(k);
      // earlier rules win where both set the same thing
      out.set(k, had ? { ...look, ...had } : { ...look });
      if (cf.stop) stopped.add(k);
    });
  }
  return out;
}

/** The rules that apply to a cell. */
export function rulesAt(rules: CondFormat[], row: number, col: number): CondFormat[] {
  return rules.filter((cf) => cf.ranges.some((r) => inRange(r, row, col)));
}

// ---------------------------------------------------------------- ready-made rules, as Excel offers them

/** Excel's ready-made highlight looks. */
export const PRESET_LOOKS: { name: string; look: CfLook }[] = [
  { name: 'Light red fill with dark red text', look: { fill: '#ffc7ce', color: '#9c0006' } },
  { name: 'Yellow fill with dark yellow text', look: { fill: '#ffeb9c', color: '#9c5700' } },
  { name: 'Green fill with dark green text', look: { fill: '#c6efce', color: '#006100' } },
  { name: 'Light red fill', look: { fill: '#ffc7ce' } },
  { name: 'Red text', look: { color: '#9c0006' } },
  { name: 'Red border-free bold text', look: { color: '#c00000', bold: true } },
];

/** Excel's ready-made colour scales (low, middle, high). */
export const PRESET_SCALES: { name: string; colors: string[] }[] = [
  { name: 'Green – yellow – red', colors: ['#63be7b', '#ffeb84', '#f8696b'] },
  { name: 'Red – yellow – green', colors: ['#f8696b', '#ffeb84', '#63be7b'] },
  { name: 'Green – white – red', colors: ['#63be7b', '#fcfcff', '#f8696b'] },
  { name: 'Red – white – green', colors: ['#f8696b', '#fcfcff', '#63be7b'] },
  { name: 'Blue – white – red', colors: ['#5a8ac6', '#fcfcff', '#f8696b'] },
  { name: 'Red – white – blue', colors: ['#f8696b', '#fcfcff', '#5a8ac6'] },
  { name: 'White – red', colors: ['#fcfcff', '#f8696b'] },
  { name: 'White – green', colors: ['#fcfcff', '#63be7b'] },
  { name: 'White – blue', colors: ['#fcfcff', '#5a8ac6'] },
  { name: 'Yellow – green', colors: ['#ffef9c', '#63be7b'] },
];

/** Excel's ready-made data bar colours. */
export const PRESET_BARS: { name: string; color: string }[] = [
  { name: 'Blue', color: '#638ec6' },
  { name: 'Green', color: '#63c384' },
  { name: 'Red', color: '#ff555a' },
  { name: 'Orange', color: '#ffb628' },
  { name: 'Light blue', color: '#008aef' },
  { name: 'Purple', color: '#d6007b' },
];

/** A colour scale rule from a list of two or three colours. */
export function scaleRule(colors: string[]): CfRule {
  const stops = colors.length >= 3
    ? [{ at: { type: 'min' as const }, color: colors[0] }, { at: { type: 'percentile' as const, value: 50 }, color: colors[1] }, { at: { type: 'max' as const }, color: colors[2] }]
    : [{ at: { type: 'min' as const }, color: colors[0] }, { at: { type: 'max' as const }, color: colors[1] }];
  return { kind: 'scale', stops };
}

/** A short description of a rule, for the rules list. */
export function describeRule(rule: CfRule): string {
  const OPS: Record<CfOp, string> = { gt: 'greater than', ge: 'at least', lt: 'less than', le: 'at most', eq: 'equal to', ne: 'not equal to', between: 'between', notBetween: 'not between' };
  switch (rule.kind) {
    case 'scale': return `Colour scale (${rule.stops.length} colours)`;
    case 'bar': return 'Data bar';
    case 'icons': return `Icons: ${rule.set}`;
    case 'cells': return `Value ${OPS[rule.op]} ${rule.value}${rule.value2 !== undefined && (rule.op === 'between' || rule.op === 'notBetween') ? ` and ${rule.value2}` : ''}`;
    case 'text': return `Text ${rule.op === 'contains' ? 'contains' : rule.op === 'notContains' ? 'does not contain' : rule.op === 'begins' ? 'begins with' : 'ends with'} "${rule.text}"`;
    case 'top': return `${rule.bottom ? 'Bottom' : 'Top'} ${rule.n}${rule.percent ? '%' : ''}`;
    case 'average': return `${rule.below ? 'Below' : 'Above'} average`;
    case 'duplicates': return rule.unique ? 'Unique values' : 'Duplicate values';
    case 'blank': return rule.not ? 'Cells with something in them' : 'Empty cells';
    case 'formula': return `Formula: ${rule.formula}`;
  }
}

/** Is this cell's value a number the rule is about? (For hiding values that aren't shown.) */
export const lookHidesValue = (l: CellLook | undefined): boolean => !!l?.hideValue;

// re-exported for the view's icon drawing
export const ICON_SETS: Record<IconSetName, string> = {
  arrows: '3 arrows', lights: '3 traffic lights', marks: '3 symbols (✓ ! ✗)', flags: '3 flags', stars: '3 stars',
};
