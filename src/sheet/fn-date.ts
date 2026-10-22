// Date and time functions as Excel has them: TODAY, NOW, DATE, TIME, YEAR, MONTH, DAY, HOUR,
// MINUTE, SECOND, WEEKDAY, WEEKNUM, ISOWEEKNUM, DATEDIF, DAYS, EDATE, EOMONTH, NETWORKDAYS,
// WORKDAY (and their .INTL forms with other weekends), DATEVALUE and TIMEVALUE. Dates are
// Excel's day numbers (see dates.ts); dates written as text ("2026-10-22") are read too.

import { Arg, FnDef, flat, numArg, omitted, scalar } from './args';
import { dateSerial, daysInMonth, nowSerial, readDateTime, serialParts, todaySerial } from './dates';
import { CellError, ERR, Value, isError, toNumber } from './values';

/** The last day number Excel has (31 December 9999). */
const LAST_DAY = 2958465;

/** Argument i as a day number (the time of day kept): #NUM! before 1900 or after 9999. */
function dateArg(args: Arg[], i: number): number | CellError {
  const x = toNumber(scalar(args[i]));
  if (isError(x)) return x;
  if (x < 0 || x >= LAST_DAY + 1) return ERR.num('Not a date Excel can hold (1900 to 9999)');
  return x;
}

/** Argument i as a whole day number. */
function dayArg(args: Arg[], i: number): number | CellError {
  const x = dateArg(args, i);
  return isError(x) ? x : Math.floor(x);
}

const part = (f: (p: ReturnType<typeof serialParts>) => number): FnDef => ({
  min: 1, max: 1,
  fn: (args) => {
    const x = dateArg(args, 0);
    return isError(x) ? x : f(serialParts(x));
  },
});

/** Weekday of a day number with Sunday 0 … Saturday 6 (Excel's own count, so 1 January 1900 is a Sunday). */
const dow = (day: number): number => serialParts(day).weekday;

/** Which weekdays (Sunday 0 … Saturday 6) are the weekend, from NETWORKDAYS.INTL's weekend argument. */
function weekendOf(args: Arg[], i: number): boolean[] | CellError {
  if (omitted(args, i)) return [true, false, false, false, false, false, true];
  const v = scalar(args[i]);
  if (isError(v)) return v;
  if (typeof v === 'string' && /^[01]{7}$/.test(v)) {
    // seven 0s and 1s, Monday first
    if (v === '1111111') return ERR.value('Every day can\'t be the weekend');
    const out = new Array<boolean>(7).fill(false);
    for (let k = 0; k < 7; k++) out[(k + 1) % 7] = v[k] === '1';
    return out;
  }
  const n = toNumber(v);
  if (isError(n)) return ERR.value('The weekend is a number (1 Saturday and Sunday … 17 Saturday only) or seven 0s and 1s from Monday');
  const k = Math.trunc(n);
  const out = new Array<boolean>(7).fill(false);
  if (k >= 1 && k <= 7) { out[(k + 5) % 7] = true; out[(k + 6) % 7] = true; return out; }
  if (k >= 11 && k <= 17) { out[(k - 11) % 7] = true; return out; }
  return ERR.num('The weekend is 1 to 7 or 11 to 17');
}

/** The holidays given to NETWORKDAYS and WORKDAY, as whole day numbers. */
function holidaysOf(args: Arg[], i: number): Set<number> | CellError {
  const out = new Set<number>();
  if (omitted(args, i)) return out;
  for (const v of flat(args[i])) {
    if (v === null || v === '') continue;
    const x = toNumber(v);
    if (isError(x)) return x;
    if (x < 0) return ERR.num('A holiday is not a date');
    out.add(Math.floor(x));
  }
  return out;
}

/** NETWORKDAYS(.INTL): the working days from start to end, counting both; negative when end comes first. */
const networkdays = (intl: boolean): FnDef => ({
  min: 2, max: intl ? 4 : 3,
  fn: (args) => {
    const a = dayArg(args, 0), b = dayArg(args, 1);
    if (isError(a)) return a;
    if (isError(b)) return b;
    const weekend = intl ? weekendOf(args, 2) : weekendOf([], 0);
    if (isError(weekend)) return weekend;
    const hol = holidaysOf(args, intl ? 3 : 2);
    if (isError(hol)) return hol;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const working = 7 - weekend.filter(Boolean).length;
    // whole weeks at once, then the days left over
    const days = hi - lo + 1;
    let n = Math.floor(days / 7) * working;
    for (let d = lo + Math.floor(days / 7) * 7; d <= hi; d++) if (!weekend[dow(d)]) n++;
    for (const h of hol) if (h >= lo && h <= hi && !weekend[dow(h)]) n--;
    return a <= b ? n : -n;
  },
});

/** WORKDAY(.INTL): the working day `days` working days after (or before) start. */
const workday = (intl: boolean): FnDef => ({
  min: 2, max: intl ? 4 : 3,
  fn: (args) => {
    const start = dayArg(args, 0);
    if (isError(start)) return start;
    const k = numArg(args, 1);
    if (isError(k)) return k;
    const weekend = intl ? weekendOf(args, 2) : weekendOf([], 0);
    if (isError(weekend)) return weekend;
    const hol = holidaysOf(args, intl ? 3 : 2);
    if (isError(hol)) return hol;
    let left = Math.trunc(k);
    const step = left < 0 ? -1 : 1;
    let d = start;
    // whole weeks at once while no holiday is near
    const working = 7 - weekend.filter(Boolean).length;
    while (left) {
      if (Math.abs(left) > working + 1 && ![...hol].some((h) => (step > 0 ? h > d && h <= d + 7 : h < d && h >= d - 7))) {
        d += 7 * step;
        left -= working * step;
        continue;
      }
      d += step;
      if (d < 0 || d > LAST_DAY) return ERR.num('The day falls outside the dates Excel can hold');
      if (!weekend[dow(d)] && !hol.has(d)) left -= step;
    }
    return d < 0 || d > LAST_DAY ? ERR.num('The day falls outside the dates Excel can hold') : d;
  },
});

/** EDATE and EOMONTH: a date some months on, on the same day (or the month's last day). */
const monthsOn = (end: boolean): FnDef => ({
  min: 2, max: 2,
  fn: (args) => {
    const x = dayArg(args, 0);
    if (isError(x)) return x;
    const k = numArg(args, 1);
    if (isError(k)) return k;
    const p = serialParts(x);
    const months = p.y * 12 + (p.m - 1) + Math.trunc(k);
    const y = Math.floor(months / 12), m = months - y * 12 + 1;
    if (y < 1900 || y > 9999) return ERR.num('The date falls outside the dates Excel can hold');
    const d = end ? daysInMonth(y, m) : Math.min(p.d, daysInMonth(y, m));
    const n = dateSerial(y, m, d);
    return n === null ? ERR.num() : n;
  },
});

/** DATEDIF(start, end, unit): whole years, months or days between two dates, as Excel counts them. */
function datedif(args: Arg[]): Value {
  const a = dayArg(args, 0), b = dayArg(args, 1);
  if (isError(a)) return a;
  if (isError(b)) return b;
  const u = scalar(args[2]);
  if (isError(u)) return u;
  if (a > b) return ERR.num('The start date is after the end date');
  const s = serialParts(a), e = serialParts(b);
  switch (String(u ?? '').trim().toUpperCase()) {
    case 'Y': return e.y - s.y - (e.m < s.m || (e.m === s.m && e.d < s.d) ? 1 : 0);
    case 'M': return (e.y - s.y) * 12 + e.m - s.m - (e.d < s.d ? 1 : 0);
    case 'D': return b - a;
    case 'YM': return (((e.m - s.m - (e.d < s.d ? 1 : 0)) % 12) + 12) % 12;
    case 'MD': {
      if (e.d >= s.d) return e.d - s.d;
      // from the start's day in the month before the end's month (Excel's count, which can come out odd near month ends)
      const pm = e.m === 1 ? 12 : e.m - 1, py = e.m === 1 ? e.y - 1 : e.y;
      return daysInMonth(py, pm) - s.d + e.d;
    }
    case 'YD': {
      // the start moved to the end's year, or the year before when that comes after the end (29 February becomes 1 March)
      let y = e.y;
      if (s.m > e.m || (s.m === e.m && s.d > e.d)) y--;
      const from = dateSerial(y, s.m, s.d);
      return from === null ? ERR.num() : b - from;
    }
    default: return ERR.num('The unit is "Y", "M", "D", "MD", "YM" or "YD"');
  }
}

/** WEEKNUM(date, [type]): the week of the year, weeks starting on the type's day (1 Sunday, 2 Monday, 11–17 Monday–Sunday, 21 ISO). */
function weeknum(args: Arg[]): Value {
  const x = dayArg(args, 0);
  if (isError(x)) return x;
  const t = omitted(args, 1) ? 1 : numArg(args, 1);
  if (isError(t)) return t;
  const type = Math.trunc(t);
  if (type === 21) return isoWeek(x);
  const start = type === 1 ? 0 : type === 2 ? 1 : type >= 11 && type <= 17 ? (type - 10) % 7 : -1;
  if (start < 0) return ERR.num('The type is 1, 2, 11 to 17 or 21');
  const jan1 = dateSerial(serialParts(x).y, 1, 1)!;
  const offset = (dow(jan1) - start + 7) % 7;
  return Math.floor((x - jan1 + offset) / 7) + 1;
}

/** The ISO 8601 week (weeks start on Monday; week 1 holds the year's first Thursday). */
function isoWeek(x: number): number {
  const wd = (dow(x) + 6) % 7; // Monday 0
  const thursday = x - wd + 3;
  const jan1 = dateSerial(serialParts(thursday).y, 1, 1)!;
  return Math.floor((thursday - jan1) / 7) + 1;
}

/** WEEKDAY(date, [type]): 1 Sunday–7 Saturday (type 1), 1 Monday–7 Sunday (2), 0 Monday–6 Sunday (3), or 1 for the type's day (11–17). */
function weekday(args: Arg[]): Value {
  const x = dayArg(args, 0);
  if (isError(x)) return x;
  const t = omitted(args, 1) ? 1 : numArg(args, 1);
  if (isError(t)) return t;
  const type = Math.trunc(t), d = dow(x);
  if (type === 1 || type === 17) return d + 1;
  if (type === 2 || type === 11) return ((d + 6) % 7) + 1;
  if (type === 3) return (d + 6) % 7;
  if (type >= 12 && type <= 16) return ((d - (type - 10) + 7) % 7) + 1;
  return ERR.num('The type is 1, 2, 3 or 11 to 17');
}

/** Text read as a date or time (DATEVALUE and TIMEVALUE need text). */
function readText(args: Arg[], what: 'date' | 'time'): Value {
  const v = scalar(args[0]);
  if (isError(v)) return v;
  if (typeof v !== 'string') return ERR.value(`${what === 'date' ? 'DATEVALUE' : 'TIMEVALUE'} needs a date written as text`);
  const d = readDateTime(v);
  if (!d) return ERR.value(`"${v}" doesn't read as a ${what}`);
  return what === 'date' ? Math.floor(d.value) : d.value - Math.floor(d.value);
}

export const DATE_FUNCTIONS: Record<string, FnDef> = {
  TODAY: { min: 0, max: 0, fn: () => todaySerial() },
  NOW: { min: 0, max: 0, fn: () => nowSerial() },
  DATE: {
    min: 3, max: 3,
    fn: (args) => {
      const [y, m, d] = [0, 1, 2].map((i) => numArg(args, i));
      for (const x of [y, m, d]) if (isError(x)) return x;
      let Y = Math.trunc(y as number);
      if (Y < 0 || Y > 9999) return ERR.num('The year is 1900 to 9999 (0 to 1899 count from 1900)');
      if (Y < 1900) Y += 1900;
      const n = dateSerial(Y, m as number, d as number);
      return n === null ? ERR.num('The date falls outside the dates Excel can hold') : n;
    },
  },
  TIME: {
    min: 3, max: 3,
    fn: (args) => {
      const [h, m, s] = [0, 1, 2].map((i) => numArg(args, i));
      for (const x of [h, m, s]) if (isError(x)) return x;
      const [H, M, S] = [h, m, s].map((x) => Math.trunc(x as number));
      if (H > 32767 || M > 32767 || S > 32767) return ERR.num('Hours, minutes and seconds go up to 32767');
      const secs = H * 3600 + M * 60 + S;
      if (secs < 0) return ERR.num('The time comes out below zero');
      return (secs % 86400) / 86400;
    },
  },
  YEAR: part((p) => p.y),
  MONTH: part((p) => p.m),
  DAY: part((p) => p.d),
  HOUR: part((p) => Math.floor(p.secs / 3600)),
  MINUTE: part((p) => Math.floor(p.secs / 60) % 60),
  SECOND: part((p) => p.secs % 60),
  WEEKDAY: { min: 1, max: 2, fn: weekday },
  WEEKNUM: { min: 1, max: 2, fn: weeknum },
  ISOWEEKNUM: { min: 1, max: 1, fn: (args) => { const x = dayArg(args, 0); return isError(x) ? x : isoWeek(x); } },
  DATEDIF: { min: 3, max: 3, fn: datedif },
  DAYS: {
    min: 2, max: 2,
    fn: (args) => {
      const e = dayArg(args, 0), s = dayArg(args, 1);
      if (isError(e)) return e;
      if (isError(s)) return s;
      return e - s;
    },
  },
  EDATE: monthsOn(false),
  EOMONTH: monthsOn(true),
  NETWORKDAYS: networkdays(false),
  'NETWORKDAYS.INTL': networkdays(true),
  WORKDAY: workday(false),
  'WORKDAY.INTL': workday(true),
  DATEVALUE: { min: 1, max: 1, fn: (args) => readText(args, 'date') },
  TIMEVALUE: { min: 1, max: 1, fn: (args) => readText(args, 'time') },
};

/** How many leading arguments of each date function take one value each, and are worked out for each value of an array given there. */
export const DATE_LIFTED: Record<string, number> = {
  DATE: 3, TIME: 3, YEAR: 1, MONTH: 1, DAY: 1, HOUR: 1, MINUTE: 1, SECOND: 1, WEEKDAY: 2, WEEKNUM: 2, ISOWEEKNUM: 1, DATEDIF: 3,
  DAYS: 2, EDATE: 2, EOMONTH: 2, NETWORKDAYS: 2, 'NETWORKDAYS.INTL': 3, WORKDAY: 2, 'WORKDAY.INTL': 3, DATEVALUE: 1, TIMEVALUE: 1,
};
