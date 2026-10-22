// Text functions as Excel has them: LEFT, RIGHT, MID, FIND, SEARCH, SUBSTITUTE, REPLACE, TEXT,
// VALUE, CONCAT, TEXTJOIN and TEXTSPLIT.

import { Arg, FnDef, array, flat, numArg, omitted, optBool, optNumber, scalar, textArg } from './args';
import { wildcardRegex } from './fn-criteria';
import { formatValue } from './numfmt';
import { ERR, Value, isError, toNumber, toText } from './values';

/** Excel's longest text in a cell. */
const MAX_TEXT = 32767;

const cut = (args: Arg[], from: 'left' | 'right'): Value => {
  const s = textArg(args, 0);
  if (isError(s)) return s;
  const n = optNumber(args, 1, 1);
  if (isError(n)) return n;
  if (n < 0) return ERR.value('The number of characters can\'t be negative');
  const k = Math.trunc(n);
  return from === 'left' ? s.slice(0, k) : k === 0 ? '' : s.slice(-k);
};

/** FIND (case matters, no wildcards) and SEARCH (case ignored, wildcards). */
const finder = (search: boolean): FnDef => ({
  min: 2, max: 3,
  fn: (args) => {
    const what = textArg(args, 0), within = textArg(args, 1);
    if (isError(what)) return what;
    if (isError(within)) return within;
    const st = optNumber(args, 2, 1);
    if (isError(st)) return st;
    const start = Math.trunc(st);
    if (start < 1 || start > within.length + (what === '' ? 1 : 0)) return ERR.value('The start is outside the text');
    if (what === '') return start;
    let i: number;
    if (search) {
      const re = wildcardRegex(what, false);
      const m = re.exec(within.slice(start - 1));
      i = m ? m.index + start - 1 : -1;
    } else i = within.indexOf(what, start - 1);
    return i < 0 ? ERR.value(`"${what}" is not in the text`) : i + 1;
  },
});

/** Text as a number as VALUE reads it: numbers, percentages, thousands commas, a currency sign, (brackets) for negatives. */
function textValue(v: Value): Value {
  if (typeof v === 'number' || isError(v)) return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return ERR.value('VALUE needs text');
  let s = v.trim();
  let sign = 1;
  const br = /^\((.*)\)$/.exec(s);
  if (br) { s = br[1].trim(); sign = -1; }
  s = s.replace(/^([+-]?)\s*[$€£¥]\s*/, '$1');
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM)?$/i.exec(s);
  if (time) {
    let h = Number(time[1]);
    if (time[4]) h = (h % 12) + (time[4].toUpperCase() === 'PM' ? 12 : 0);
    return sign * (h * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0)) / 86400;
  }
  const x = toNumber(s);
  return isError(x) || s === '' ? ERR.value(`"${v}" is not a number`) : sign * x;
}

/** TEXTSPLIT's delimiters: one text or a block of them. */
function delimiters(a: Arg): string[] | null {
  if (a === '' || a === null) return null;
  const out = flat(a).map((v) => (v === null ? '' : String(v))).filter((d) => d !== '');
  return out.length ? out : null;
}

function splitOn(s: string, delims: string[] | null, caseless: boolean): string[] {
  if (!delims) return [s];
  const re = new RegExp(delims.sort((a, b) => b.length - a.length).map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), caseless ? 'gi' : 'g');
  return s.split(re);
}

export const TEXT_FUNCTIONS: Record<string, FnDef> = {
  LEFT: { min: 1, max: 2, fn: (args) => cut(args, 'left') },
  RIGHT: { min: 1, max: 2, fn: (args) => cut(args, 'right') },
  MID: {
    min: 3, max: 3,
    fn: (args) => {
      const s = textArg(args, 0), st = numArg(args, 1), n = numArg(args, 2);
      if (isError(s)) return s;
      if (isError(st)) return st;
      if (isError(n)) return n;
      if (st < 1) return ERR.value('The start must be 1 or more');
      if (n < 0) return ERR.value('The number of characters can\'t be negative');
      const a = Math.trunc(st) - 1;
      return s.slice(a, a + Math.trunc(n));
    },
  },
  FIND: finder(false),
  SEARCH: finder(true),
  // SUBSTITUTE(text, old, new, [which one]): every match, or only the n-th
  SUBSTITUTE: {
    min: 3, max: 4,
    fn: (args) => {
      const s = textArg(args, 0), from = textArg(args, 1), to = textArg(args, 2);
      if (isError(s)) return s;
      if (isError(from)) return from;
      if (isError(to)) return to;
      if (from === '') return s;
      if (omitted(args, 3)) return s.split(from).join(to);
      const k = numArg(args, 3);
      if (isError(k)) return k;
      if (k < 1) return ERR.value('Which one must be 1 or more');
      let i = -1;
      for (let n = 0; n < Math.trunc(k); n++) {
        i = s.indexOf(from, i + (n ? from.length : 1));
        if (i < 0) return s;
      }
      return s.slice(0, i) + to + s.slice(i + from.length);
    },
  },
  // REPLACE(text, start, how many, new text)
  REPLACE: {
    min: 4, max: 4,
    fn: (args) => {
      const s = textArg(args, 0), st = numArg(args, 1), n = numArg(args, 2), to = textArg(args, 3);
      if (isError(s)) return s;
      if (isError(st)) return st;
      if (isError(n)) return n;
      if (isError(to)) return to;
      if (st < 1) return ERR.value('The start must be 1 or more');
      if (n < 0) return ERR.value('The number of characters can\'t be negative');
      const a = Math.trunc(st) - 1;
      return s.slice(0, a) + to + s.slice(a + Math.trunc(n));
    },
  },
  // TEXT(value, format): the value written in a number format, as a cell would show it
  TEXT: {
    min: 2, max: 2,
    fn: (args) => {
      let v = scalar(args[0]);
      const code = textArg(args, 1);
      if (isError(v)) return v;
      if (isError(code)) return code;
      if (v === null) v = 0;
      if (typeof v === 'string') { const n = toNumber(v); if (!isError(n) && v.trim() !== '') v = n; }
      return formatValue(v, code || 'General').text;
    },
  },
  VALUE: { min: 1, max: 1, fn: (args) => textValue(scalar(args[0])) },
  CONCAT: {
    min: 1, max: 253,
    fn: (args) => {
      let s = '';
      for (const a of args) for (const v of flat(a)) {
        const t = toText(v);
        if (isError(t)) return t;
        s += t;
      }
      return s.length > MAX_TEXT ? ERR.value('The text is longer than a cell can hold') : s;
    },
  },
  // TEXTJOIN(between, skip empty, text1, …)
  TEXTJOIN: {
    min: 3, max: 252,
    fn: (args) => {
      const seps: string[] = [];
      for (const v of flat(args[0])) {
        const t = toText(v);
        if (isError(t)) return t;
        seps.push(t);
      }
      const skip = optBool(args, 1, true);
      if (isError(skip)) return skip;
      const parts: string[] = [];
      for (const a of args.slice(2)) for (const v of flat(a)) {
        const t = toText(v);
        if (isError(t)) return t;
        if (skip && t === '') continue;
        parts.push(t);
      }
      let s = '';
      parts.forEach((p, i) => { s += (i ? seps[(i - 1) % seps.length] ?? '' : '') + p; });
      return s.length > MAX_TEXT ? ERR.value('The text is longer than a cell can hold') : s;
    },
  },
  // TEXTSPLIT(text, column delimiter, [row delimiter], [skip empty], [ignore case], [pad with])
  TEXTSPLIT: {
    min: 2, max: 6,
    fn: (args) => {
      const s = textArg(args, 0);
      if (isError(s)) return s;
      const colD = delimiters(args[1]), rowD = args.length > 2 ? delimiters(args[2]) : null;
      if (!colD && !rowD) return ERR.value('TEXTSPLIT needs a column or row delimiter');
      const skip = optBool(args, 3, false);
      if (isError(skip)) return skip;
      const mode = optNumber(args, 4, 0);
      if (isError(mode)) return mode;
      const pad: Value = omitted(args, 5) ? ERR.na('Nothing here to fill the row') : scalar(args[5]);
      const caseless = Math.trunc(mode) === 1;
      let rows = splitOn(s, rowD, caseless).map((r) => splitOn(r, colD, caseless));
      if (skip) rows = rows.map((r) => r.filter((x) => x !== '')).filter((r) => r.length);
      if (!rows.length) return ERR.value('Nothing is left after splitting');
      const w = Math.max(...rows.map((r) => r.length));
      return array(rows.map((r) => [...r, ...new Array<Value>(w - r.length).fill(pad)]));
    },
  },
};
