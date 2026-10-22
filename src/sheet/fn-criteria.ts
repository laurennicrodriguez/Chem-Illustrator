// SUMIF(S), COUNTIF(S), AVERAGEIF(S), MAXIFS and MINIFS: totals of the cells that meet a
// condition, written as Excel writes it (">5", "<>done", "Pd*", 7, TRUE). Also the wildcard
// matching (* ? and ~) shared with the lookups and SEARCH.

import { Arg, Block, FnDef, asBlock, at, isBlock, scalar } from './args';
import { CellError, ERR, Value, compareValues, isError, readTyped, sigFigs15 } from './values';

/** A pattern with Excel's wildcards: * any run of characters, ? any one, ~ before either (or ~) takes it as itself. */
export function wildcardRegex(pattern: string, anchored = true): RegExp {
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length && '*?~'.includes(pattern[i + 1])) { src += '\\' + pattern[++i]; continue; }
    if (ch === '*') src += '[\\s\\S]*';
    else if (ch === '?') src += '[\\s\\S]';
    else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(anchored ? `^${src}$` : src, 'i');
}

export const hasWildcards = (s: string): boolean => /[*?~]/.test(s);

/** A number written in criteria text ("5", "1.5E3", "25%"), or null. */
function criteriaNumber(s: string): number | null {
  if (s.trim() === '') return null;
  const t = readTyped(s.trim());
  return typeof t.value === 'number' && !t.formula ? t.value : null;
}

/** A cell value as a number for an equality test: numbers, and text that reads as one ("1" matches 1, as in Excel). */
function asNumber(v: Value): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return criteriaNumber(v);
  return null;
}

const sameNumber = (a: number, b: number): boolean => sigFigs15(a) === sigFigs15(b);

/** A condition as Excel's *IF functions read it. */
export function criterion(c: Value): (v: Value) => boolean {
  // a reference to an empty cell means 0
  if (c === null) c = 0;
  if (typeof c === 'number') { const x = c; return (v) => { const n = asNumber(v); return n !== null && sameNumber(n, x); }; }
  if (typeof c === 'boolean') { const x = c; return (v) => v === x; }
  if (isError(c)) { const code = c.code; return (v) => isError(v) && v.code === code; }
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!;
  const op = m[1] ?? '', operand = m[2];
  const negate = (f: (v: Value) => boolean) => (op === '<>' ? (v: Value) => !f(v) : f);
  if (operand === '') {
    if (op === '') return (v) => v === null || v === '';
    if (op === '=') return (v) => v === null;
    if (op === '<>') return (v) => v !== null;
    return () => false;
  }
  const n = criteriaNumber(operand);
  if (n !== null) {
    if (op === '' || op === '=' || op === '<>') return negate((v) => { const x = asNumber(v); return x !== null && sameNumber(x, n); });
    return (v) => typeof v === 'number' && compares(op, compareValues(v, n));
  }
  const up = operand.toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') {
    const b = up === 'TRUE';
    if (op === '' || op === '=' || op === '<>') return negate((v) => v === b);
    return (v) => typeof v === 'boolean' && compares(op, compareValues(v, b));
  }
  if (/^#/.test(operand)) {
    if (op === '' || op === '=' || op === '<>') return negate((v) => isError(v) && v.code === up);
  }
  if (op === '' || op === '=' || op === '<>') {
    const re = wildcardRegex(operand);
    return negate((v) => typeof v === 'string' && re.test(v));
  }
  return (v) => typeof v === 'string' && compares(op, compareValues(v, operand));
}

function compares(op: string, c: number): boolean {
  switch (op) {
    case '<': return c < 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    default: return c >= 0;
  }
}

/**
 * The cells (row, column within the blocks) where every condition holds, for ranges the same
 * size. `blankRest` counts the cells past what any block holds (all empty) when the conditions
 * hold for empty cells, as COUNTIFS counts them.
 */
function matching(ranges: Block[], tests: ((v: Value) => boolean)[]): { cells: [number, number][]; blankRest: number } {
  const h = ranges[0].h, w = ranges[0].w;
  const hr = Math.min(h, Math.max(...ranges.map((r) => r.block.length))), wr = Math.min(w, Math.max(...ranges.map((r) => r.block[0]?.length ?? 0)));
  const cells: [number, number][] = [];
  for (let i = 0; i < hr; i++) for (let j = 0; j < wr; j++) {
    if (tests.every((t, k) => t(at(ranges[k], i, j)))) cells.push([i, j]);
  }
  const blankRest = tests.every((t) => t(null)) ? h * w - hr * wr : 0;
  return { cells, blankRest };
}

/** The (range, condition) pairs of a *IFS function from its arguments, checking every range is the size of the first. */
function conditionPairs(args: Arg[], from: number, size: Block | null): { ranges: Block[]; tests: ((v: Value) => boolean)[] } | CellError {
  if ((args.length - from) % 2 !== 0 || args.length - from < 2) return ERR.value('Give each range with its condition: range, condition, range, condition…');
  const ranges: Block[] = [], tests: ((v: Value) => boolean)[] = [];
  for (let i = from; i < args.length; i += 2) {
    const r = asBlock(args[i]);
    const c = scalar(args[i + 1]);
    const ref = size ?? ranges[0];
    if (ref && (r.h !== ref.h || r.w !== ref.w)) return ERR.value('The ranges must all be the same size');
    ranges.push(r);
    tests.push(criterion(c));
  }
  return { ranges, tests };
}

type Total = 'sum' | 'average' | 'max' | 'min';

/** The total of the target cells at the given positions (only numbers count; an error among them is the result). */
function total(kind: Total, target: Block, cells: [number, number][]): Value {
  let sum = 0, n = 0, best = kind === 'max' ? -Infinity : Infinity;
  for (const [i, j] of cells) {
    const v = at(target, i, j);
    if (isError(v)) return v;
    if (typeof v !== 'number') continue;
    sum += v; n++;
    if (kind === 'max' ? v > best : v < best) best = v;
  }
  if (kind === 'sum') return sum;
  if (kind === 'average') return n ? sum / n : ERR.div0('No cells meet the condition');
  return n ? best : 0;
}

/** SUMIF(range, condition, [sum range]) and AVERAGEIF: the target is lined up with the range from its top-left cell. */
const oneCondition = (kind: Total): FnDef => ({
  min: 2, max: 3,
  fn: (args) => {
    if (!isBlock(args[0])) return ERR.value('The first argument must be a range of cells');
    const range = args[0];
    const c = scalar(args[1]);
    const target = args.length > 2 && args[2] !== '' ? asBlock(args[2]) : range;
    const { cells } = matching([range], [criterion(c)]);
    return total(kind, target, cells);
  },
});

/** SUMIFS(sum range, range1, condition1, …), and the like. */
const manyConditions = (kind: Total): FnDef => ({
  min: 3, max: 255,
  fn: (args) => {
    const target = asBlock(args[0]);
    const p = conditionPairs(args, 1, target);
    if (isError(p)) return p;
    return total(kind, target, matching(p.ranges, p.tests).cells);
  },
});

export const CRITERIA_FUNCTIONS: Record<string, FnDef> = {
  COUNTIF: {
    min: 2, max: 2,
    fn: (args) => {
      if (!isBlock(args[0])) return ERR.value('The first argument must be a range of cells');
      const m = matching([args[0]], [criterion(scalar(args[1]))]);
      return m.cells.length + m.blankRest;
    },
  },
  COUNTIFS: {
    min: 2, max: 254,
    fn: (args) => {
      const p = conditionPairs(args, 0, null);
      if (isError(p)) return p;
      const m = matching(p.ranges, p.tests);
      return m.cells.length + m.blankRest;
    },
  },
  SUMIF: oneCondition('sum'),
  AVERAGEIF: oneCondition('average'),
  SUMIFS: manyConditions('sum'),
  AVERAGEIFS: manyConditions('average'),
  MAXIFS: manyConditions('max'),
  MINIFS: manyConditions('min'),
};
