// Number formats, written as Excel writes them ("0.00", "0.0%", "0.00E+00", "#,##0", "@"), so
// a sheet saved as .xlsx keeps them exactly. This turns a value and a format into the text a
// cell shows, and changes formats for the ribbon's buttons (more or fewer decimal places).

import { CellError, Value, isError } from './values';
import { roundTo } from './evaluate';

export interface Shown {
  text: string;
  /** A colour the format asks for ([Red]). */
  color?: string;
  /** Where the text sits when the cell doesn't say: numbers right, text left, TRUE/FALSE and errors centred. */
  align: 'left' | 'right' | 'center';
}

const COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00a000', blue: '#0000ff', yellow: '#c0a000', magenta: '#ff00ff', cyan: '#00a0a0',
};

/** Excel's General format: up to about 11 characters, switching to powers of ten for very large or small numbers. */
export function generalNumber(n: number): string {
  if (!Number.isFinite(n)) return '#NUM!';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e11 || abs < 1e-6) {
    const [m, e] = n.toExponential(5).split('e');
    const mant = m.replace(/\.?0+$/, '');
    const exp = Number(e);
    return `${mant}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  // as many decimals as fit in about 11 characters
  const intDigits = Math.max(1, Math.floor(Math.log10(abs)) + 1);
  const dec = Math.max(0, 10 - intDigits);
  const r = roundTo(n, dec);
  let s = r.toFixed(dec);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * A number in the General format, shortened to fit its column as Excel does: fewer decimals
 * first, then a power of ten. Null when even that doesn't fit (the cell then shows ###).
 */
export function generalFitting(n: number, fits: (text: string) => boolean): string | null {
  const full = generalNumber(n);
  if (fits(full)) return full;
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  // a small number rounded to one significant figure, kept in case a power of ten doesn't fit either
  let coarse: string | null = null;
  if (abs >= 1e-6 && abs < 1e11) {
    const intDigits = Math.max(1, Math.floor(Math.log10(abs)) + 1);
    for (let dec = Math.max(0, 10 - intDigits) - 1; dec >= 0; dec--) {
      let t = roundTo(n, dec).toFixed(dec);
      if (t.includes('.')) t = t.replace(/\.?0+$/, '');
      // rounded away to nothing: a power of ten says more
      if (/^-?0$/.test(t)) break;
      if (!fits(t)) continue;
      if (abs < 0.1 && t.replace(/^-?[0.]+/, '').replace('.', '').length < 2 && Number(t) !== n) { coarse = t; break; }
      return t;
    }
  }
  for (let d = 5; d >= 0; d--) {
    const [m, e] = n.toExponential(d).split('e');
    const exp = Number(e);
    const t = `${m.replace(/\.?0+$/, '')}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    if (fits(t)) return t;
  }
  return coarse;
}

interface Section {
  /** Literal text and placeholders, in order. */
  parts: Part[];
  color?: string;
  condition?: { op: string; value: number };
}

type Part = { k: 'lit'; s: string } | { k: 'code'; s: string };

/** Split a format into its sections (positive; negative; zero; text) and each into literal and code parts. */
function parseSections(code: string): Section[] {
  const sections: Section[] = [];
  let cur: Section = { parts: [] };
  const pushLit = (s: string) => {
    const last = cur.parts[cur.parts.length - 1];
    if (last?.k === 'lit') last.s += s;
    else cur.parts.push({ k: 'lit', s });
  };
  const pushCode = (s: string) => {
    const last = cur.parts[cur.parts.length - 1];
    if (last?.k === 'code') last.s += s;
    else cur.parts.push({ k: 'code', s });
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === ';') { sections.push(cur); cur = { parts: [] }; continue; }
    if (ch === '"') {
      const j = code.indexOf('"', i + 1);
      pushLit(code.slice(i + 1, j < 0 ? code.length : j));
      i = j < 0 ? code.length : j;
      continue;
    }
    if (ch === '\\') { pushLit(code[i + 1] ?? ''); i++; continue; }
    if (ch === '_') { pushLit(' '); i++; continue; } // space the width of the next character
    if (ch === '*') { i++; continue; } // repeat to fill the cell: left out
    if (ch === '[') {
      const j = code.indexOf(']', i);
      const inner = code.slice(i + 1, j < 0 ? code.length : j);
      i = j < 0 ? code.length : j;
      const c = COLORS[inner.toLowerCase()];
      if (c) cur.color = c;
      const cond = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner);
      if (cond) cur.condition = { op: cond[1], value: Number(cond[2]) };
      const cur$ = /^\$([^-\]]*)/.exec(inner);
      if (cur$) pushLit(cur$[1]);
      if (/^(h+|m+|s+)$/i.test(inner)) pushCode(`[${inner}]`); // elapsed time
      continue;
    }
    if ('0#?.,%Ee+-@'.includes(ch) || /[ymdhsAP/:]/i.test(ch)) {
      // E+ / E- belong to the number; on their own + and - are text
      if ((ch === '+' || ch === '-') && !/[Ee]$/.test(lastCode(cur))) { pushLit(ch); continue; }
      if (ch === '/' || ch === ':') { if (isDateCode(lastCode(cur)) || /[hms]/i.test(code.slice(i + 1, i + 2))) { pushCode(ch); continue; } pushLit(ch); continue; }
      if ((ch === 'A' || ch === 'a') && /^AM\/PM/i.test(code.slice(i))) { pushCode('AM/PM'); i += 4; continue; }
      if ((ch === 'A' || ch === 'a') && /^A\/P/i.test(code.slice(i))) { pushCode('A/P'); i += 2; continue; }
      if (/[AaPp]/.test(ch)) { pushLit(ch); continue; }
      pushCode(ch);
      continue;
    }
    pushLit(ch);
  }
  sections.push(cur);
  return sections;
}

const lastCode = (s: Section): string => {
  for (let i = s.parts.length - 1; i >= 0; i--) if (s.parts[i].k === 'code') return s.parts[i].s;
  return '';
};

const isDateCode = (s: string): boolean => /[ymdhs]/i.test(s.replace(/E[+-]/gi, ''));

function sectionIsDate(sec: Section): boolean {
  return sec.parts.some((p) => p.k === 'code' && isDateCode(p.s) && !/[0#?]/.test(p.s));
}

/** Show a value in a format. Undefined or "General" shows it as Excel's General does. */
export function formatValue(v: Value, code?: string): Shown {
  if (v === null) return { text: '', align: 'left' };
  if (isError(v)) return { text: (v as CellError).code === '#BUSY!' ? '…' : (v as CellError).code, align: 'center' };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', align: 'center' };
  const fmt = code && code.toLowerCase() !== 'general' ? code : '';
  if (typeof v === 'string') {
    if (!fmt) return { text: v, align: 'left' };
    const secs = parseSections(fmt);
    const textSec = secs.length >= 4 ? secs[3] : secs.find((s) => s.parts.some((p) => p.k === 'code' && p.s.includes('@')));
    if (!textSec) return { text: v, align: 'left' };
    const text = textSec.parts.map((p) => (p.k === 'lit' ? p.s : p.s.replace(/@/g, v))).join('');
    return { text, color: textSec.color, align: 'left' };
  }
  if (!fmt) return { text: generalNumber(v), align: 'right' };
  if (fmt === '@') return { text: generalNumber(v), align: 'left' };
  const secs = parseSections(fmt);
  let sec: Section;
  let abs = false;
  if (secs.some((s) => s.condition)) {
    sec = secs.find((s) => s.condition && test(v, s.condition)) ?? secs.find((s) => !s.condition) ?? secs[0];
  } else if (v < 0 && secs.length >= 2 && secs[1].parts.length) { sec = secs[1]; abs = true; }
  else if (v === 0 && secs.length >= 3 && secs[2].parts.length) sec = secs[2];
  else sec = secs[0];
  if (sectionIsDate(sec)) return { text: formatDate(v, sec), color: sec.color, align: 'right' };
  const text = formatNumber(abs ? Math.abs(v) : v, sec);
  return { text, color: sec.color, align: 'right' };
}

function test(v: number, c: { op: string; value: number }): boolean {
  switch (c.op) {
    case '<': return v < c.value;
    case '<=': return v <= c.value;
    case '>': return v > c.value;
    case '>=': return v >= c.value;
    case '=': return v === c.value;
    default: return v !== c.value;
  }
}

/** A number in one section of a format: placeholders 0 # ?, decimal point, thousands commas, % and E+00. */
function formatNumber(v: number, sec: Section): string {
  const code = sec.parts.filter((p) => p.k === 'code').map((p) => p.s).join('');
  if (!/[0#?]/.test(code)) {
    // only text: the number isn't shown (as in a "-" for zero)
    return (v < 0 ? '-' : '') + sec.parts.map((p) => (p.k === 'lit' ? p.s : p.s.replace(/[^@]/g, ''))).join('');
  }
  const pct = (code.match(/%/g) ?? []).length;
  let x = Math.abs(v) * Math.pow(100, pct);
  const sci = /E([+-])([0#]+)/i.exec(code);
  const mant = sci ? code.slice(0, sci.index) : code;
  const dot = mant.indexOf('.');
  const intCode = (dot < 0 ? mant : mant.slice(0, dot)).replace(/[^0#?,]/g, '');
  const fracCode = dot < 0 ? '' : mant.slice(dot + 1).replace(/[^0#?]/g, '');
  const intMin = (intCode.match(/0/g) ?? []).length;
  const group = /[0#?],[0#?]/.test(intCode);
  // commas at the end of the number divide by 1000
  const scale = (/(,+)$/.exec(intCode.replace(/[^0#?,]/g, ''))?.[1].length ?? 0);
  if (scale && dot < 0) x /= Math.pow(1000, scale);
  let exp = 0;
  if (sci) {
    if (x !== 0) {
      exp = Math.floor(Math.log10(x));
      const step = Math.max(1, (intCode.match(/[0#?]/g) ?? []).length);
      // engineering formats (##0.0E+0) keep the power a multiple of the digits before the point
      if (step > 1) exp = Math.floor(exp / step) * step;
      x /= Math.pow(10, exp);
      if (roundTo(x, fracCode.length) >= Math.pow(10, step)) { x /= Math.pow(10, step); exp += step; }
    }
  }
  const r = roundTo(x, fracCode.length);
  let [ip, fp = ''] = r.toFixed(fracCode.length).split('.');
  // optional decimals (#) drop trailing zeros; ? leaves a space instead
  if (fracCode) {
    const chars = fp.split('');
    for (let i = fracCode.length - 1; i >= 0; i--) {
      if (fracCode[i] === '0' || chars[i] !== '0') break;
      chars[i] = fracCode[i] === '?' ? ' ' : '';
    }
    fp = chars.join('');
  }
  if (ip === '0' && intMin === 0) ip = '';
  ip = ip.padStart(intMin, '0');
  if (group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Excel keeps the point even when no decimals follow ("0.##" shows 5 as "5.")
  let num = ip + (dot >= 0 ? '.' + fp : '');
  if (sci) {
    const ed = sci[2].length;
    num += `E${exp < 0 ? '-' : sci[1] === '+' ? '+' : ''}${String(Math.abs(exp)).padStart(ed, '0')}`;
  }
  // put the number where its code was, literals around it
  let out = '';
  let placed = false;
  for (const p of sec.parts) {
    if (p.k === 'lit') out += p.s;
    else {
      const extra = p.s.replace(/[0#?.,%Ee+-]/g, '');
      if (!placed) { out += num; placed = true; }
      if (p.s.includes('%')) out += '%'.repeat((p.s.match(/%/g) ?? []).length);
      out += extra;
    }
  }
  const negative = v < 0 && roundTo(Math.abs(v) * Math.pow(100, pct), fracCode.length + (sci ? 10 : 0)) !== 0;
  return (negative ? '-' : '') + out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Excel's date numbers count days from 30 December 1899 (so 1 is 1 January 1900, with its 1900 leap-year slip). */
export function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
}

function formatDate(v: number, sec: Section): string {
  const d = serialToDate(v);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), wd = d.getUTCDay();
  const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  const ampm = sec.parts.some((p) => p.k === 'code' && /AM\/PM|A\/P/i.test(p.s));
  let out = '';
  for (const p of sec.parts) {
    if (p.k === 'lit') { out += p.s; continue; }
    const toks = p.s.match(/AM\/PM|A\/P|\[[hms]+\]|y+|m+|d+|h+|s+|\.0+|[^ymdhs]/gi) ?? [];
    toks.forEach((t, i) => {
      const low = t.toLowerCase();
      const prev = toks.slice(0, i).reverse().find((x) => /^[a-z]/i.test(x))?.toLowerCase() ?? '';
      const next = toks.slice(i + 1).find((x) => /^[a-z]/i.test(x))?.toLowerCase() ?? '';
      if (/^y+$/.test(low)) out += low.length <= 2 ? String(Y % 100).padStart(2, '0') : String(Y);
      else if (/^m+$/.test(low)) {
        const minutes = prev.startsWith('h') || next.startsWith('s');
        if (minutes) out += low.length >= 2 ? String(mi).padStart(2, '0') : String(mi);
        else out += low.length === 1 ? String(M + 1) : low.length === 2 ? String(M + 1).padStart(2, '0') : low.length === 3 ? MONTHS[M].slice(0, 3) : low.length === 5 ? MONTHS[M][0] : MONTHS[M];
      } else if (/^d+$/.test(low)) out += low.length === 1 ? String(D) : low.length === 2 ? String(D).padStart(2, '0') : low.length === 3 ? DAYS[wd].slice(0, 3) : DAYS[wd];
      else if (/^h+$/.test(low)) { const hh = ampm ? ((h + 11) % 12) + 1 : h; out += low.length >= 2 ? String(hh).padStart(2, '0') : String(hh); }
      else if (/^s+$/.test(low)) out += low.length >= 2 ? String(s).padStart(2, '0') : String(s);
      else if (/^\[h+\]$/.test(low)) out += String(Math.floor(v * 24));
      else if (/^\[m+\]$/.test(low)) out += String(Math.floor(v * 1440));
      else if (/^\[s+\]$/.test(low)) out += String(Math.floor(v * 86400));
      else if (low === 'am/pm') out += h < 12 ? (t[0] === 'a' ? 'am' : 'AM') : (t[0] === 'a' ? 'pm' : 'PM');
      else if (low === 'a/p') out += h < 12 ? 'A' : 'P';
      else if (/^\.0+$/.test(low)) out += (d.getUTCMilliseconds() / 1000).toFixed(low.length - 1).slice(1);
      else out += t;
    });
  }
  return out;
}

// ---------------------------------------------------------------- changing formats

/** The formats behind the ribbon's buttons and list. */
export const FORMATS = {
  general: 'General',
  number: '0.00',
  percent: '0%',
  scientific: '0.00E+00',
  text: '@',
  thousands: '#,##0',
};

/** One more or one fewer decimal place, as Excel's buttons do. `shown` is the cell's text, used when the format is General. */
export function changeDecimals(code: string | undefined, delta: 1 | -1, shown = ''): string {
  let fmt = code && code.toLowerCase() !== 'general' ? code : '';
  if (!fmt) {
    // from General: start from the decimals the cell shows now
    const dec = /\.(\d+)/.exec(shown)?.[1].length ?? 0;
    const e = /E[+-]\d+$/.test(shown);
    const n = Math.max(0, dec + delta);
    return e ? `0${n ? '.' + '0'.repeat(n) : ''}E+00` : `0${n ? '.' + '0'.repeat(n) : ''}`;
  }
  // change each section's number the same way
  return fmt.split(';').map((sec) => {
    const m = /([0#?](?:[0#?,]*))(\.([0#?]*))?/.exec(sec.replace(/"[^"]*"/g, (q) => '\u0000'.repeat(q.length)));
    if (!m) return sec;
    const start = m.index, end = start + m[0].length;
    const ip = m[1], fp = m[3] ?? '';
    const nf = delta > 0 ? fp + '0' : fp.slice(0, -1);
    return sec.slice(0, start) + ip + (nf ? '.' + nf : '') + sec.slice(end);
  }).join(';');
}

/** Decimal places a format shows (for the side panel). */
export function decimalsOf(code: string | undefined): number | null {
  if (!code || code.toLowerCase() === 'general') return null;
  const m = /[0#?]\.([0#?]+)/.exec(code.split(';')[0]);
  return m ? m[1].length : 0;
}

/** A short description of a format, for the side panel and the ribbon's list. */
export function describeFormat(code: string | undefined): string {
  if (!code || code.toLowerCase() === 'general') return 'General';
  if (code === '@') return 'Text';
  const first = code.split(';')[0];
  const d = decimalsOf(code) ?? 0;
  const dp = `${d} decimal place${d === 1 ? '' : 's'}`;
  if (/E[+-]/i.test(first)) return `Scientific, ${dp}`;
  if (first.includes('%')) return `Percentage, ${dp}`;
  if (/[ymdhs]/i.test(first.replace(/"[^"]*"/g, '')) && !/[0#]/.test(first)) return 'Date or time';
  if (/[0#],[0#]/.test(first)) return `Number with thousands commas, ${dp}`;
  return `Number, ${dp}`;
}
