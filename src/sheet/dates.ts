// Dates and times as Excel holds them: a date is a count of days (1 is 1 January 1900) and a
// time is a fraction of a day, so 46317.5 is noon on 22 October 2026. Excel counts 29 February
// 1900, a day that never was (Lotus 1-2-3 did, and Excel kept it), so days 1 to 59 sit one off
// from the calendar; this follows it. Also reading dates and times typed as text, the way Excel
// in the US reads them.

/** Day, month (1–12) and year of a day number, and the time of day in seconds. */
export interface DateParts { y: number; m: number; d: number; secs: number; weekday: number }

const DAY_MS = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);

/** The calendar date of a day number (0 is Excel's "0 January 1900", 60 its 29 February 1900). */
export function serialParts(serial: number): DateParts {
  let day = Math.floor(serial);
  let secs = Math.round((serial - day) * 86400);
  if (secs >= 86400) { day++; secs -= 86400; }
  // Excel's weekdays carry on through its 29 February, so day 1 is a Sunday
  const weekday = ((day % 7) + 6) % 7;
  if (day === 0) return { y: 1900, m: 1, d: 0, secs, weekday };
  if (day === 60) return { y: 1900, m: 2, d: 29, secs, weekday };
  const dt = new Date(EPOCH + (day < 60 ? day + 1 : day) * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), secs, weekday };
}

/**
 * The day number of a year, month and day, as Excel's DATE works it out: months past 12 and
 * days past the month's end carry over, and so do zero and negative ones. Null before 1900 or
 * after 9999.
 */
export function dateSerial(y: number, m: number, d: number): number | null {
  y = Math.trunc(y); m = Math.trunc(m); d = Math.trunc(d);
  const months = y * 12 + (m - 1);
  const Y = Math.floor(months / 12), M = months - Y * 12;
  let first = (Date.UTC(Y, M, 1) - EPOCH) / DAY_MS;
  // before 1 March 1900 Excel's count is one lower (it has no 30 December 1899 to start from)
  if (first < 61) first -= 1;
  const n = first + d - 1;
  if (n < 0 || n > 2958465) return null;
  return n;
}

/** Days in a month of a year (Excel's February 1900 has 29). */
export function daysInMonth(y: number, m: number): number {
  if (y === 1900 && m === 2) return 29;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Today's day number, in the computer's own time zone. */
export function todaySerial(now = new Date()): number {
  return dateSerial(now.getFullYear(), now.getMonth() + 1, now.getDate())!;
}

/** Now as a day number with the time of day, in the computer's own time zone. */
export function nowSerial(now = new Date()): number {
  return todaySerial(now) + (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000) / 86400;
}

// ---------------------------------------------------------------- reading typed dates and times

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A month's number from its name or its first three letters ("Oct", "october"; "Sept" too). */
function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const i = MONTHS.indexOf(w.slice(0, 3));
  if (i < 0) return null;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return full.startsWith(w) || (i === 8 && w === 'sept') ? i + 1 : null;
}

/** A two-digit year as Excel reads it: 00–29 are 2000–2029, 30–99 are 1930–1999. */
const fullYear = (t: string): number => (t.length <= 2 ? (Number(t) < 30 ? 2000 : 1900) + Number(t) : Number(t));

export interface ReadDate {
  /** The day number, with the time as its fraction. */
  value: number;
  /** The number format Excel gives a cell typed like this. */
  format: string;
}

/**
 * A date, a time, or both, typed as text: 10/22/2026, 2026-10-22, 22-Oct-2026, Oct 22, 2026,
 * 22 October, 2:30 PM, 14:30:15, 10/22/2026 14:30. Null for anything else.
 *
 * `strict` is for typing into a cell, where a few things Excel reads as dates are kept as text
 * because in a lab they are more often something else: a month and day with no year (1/2 is
 * more likely a ratio than 2 January) and hours and minutes with a one-digit minute (10:1 is a
 * ratio), and a or p alone for AM or PM (2a and 3b are compound numbers). Formulas
 * (DATEVALUE, "2026-10-22"+1) read them as Excel does.
 */
export function readDateTime(text: string, strict = false): ReadDate | null {
  const s = text.trim().replace(/\s+/g, ' ');
  if (!s || s.length > 40 || !/\d/.test(s)) return null;
  // a time at the end
  let time: { secs: number; format: string } | null = null;
  let rest = s;
  const tm = /(?:^|\s)(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}(?:\.\d+)?))?\s*([ap]\.?m?\.?)?$/i.exec(s);
  if (tm && (tm[2] !== undefined || tm[4])) {
    let h = Number(tm[1]);
    const mi = Number(tm[2] ?? 0), sec = Number(tm[3] ?? 0);
    const ampm = tm[4]?.[0].toLowerCase();
    const before = s.slice(0, tm.index).trim();
    const ok = mi < 60 && sec < 60 && (ampm ? h >= 1 && h <= 12 : h < 24)
      && !(strict && !ampm && tm[3] === undefined && tm[2] !== undefined && tm[2].length < 2 && !before)
      // typed in a cell, 2a and 3b are compound numbers: AM and PM are written out
      && !(strict && tm[4] && !/^[ap]\.?m\.?$/i.test(tm[4]));
    if (ok) {
      if (ampm) h = (h % 12) + (ampm === 'p' ? 12 : 0);
      time = { secs: h * 3600 + mi * 60 + sec, format: ampm ? (tm[3] !== undefined ? 'h:mm:ss AM/PM' : 'h:mm AM/PM') : tm[3] !== undefined ? 'h:mm:ss' : 'h:mm' };
      rest = before;
    }
  }
  if (!rest) return time ? { value: time.secs / 86400, format: time.format } : null;
  const date = readDate(rest, strict);
  if (!date) return null;
  if (!time) return date;
  return { value: date.value + time.secs / 86400, format: 'm/d/yyyy h:mm' };
}

function readDate(s: string, strict: boolean): ReadDate | null {
  const thisYear = new Date().getFullYear();
  const make = (y: number, m: number, d: number, format: string): ReadDate | null => {
    if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m) || y < 1900 || y > 9999) return null;
    const n = dateSerial(y, m, d);
    return n === null ? null : { value: n, format };
  };
  let m: RegExpExecArray | null;
  // 2026-10-22, 2026/10/22
  if ((m = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/.exec(s))) return make(Number(m[1]), Number(m[3]), Number(m[4]), m[2] === '-' ? 'yyyy-mm-dd' : 'm/d/yyyy');
  // 10/22/2026, 10-22-26
  if ((m = /^(\d{1,2})([-/])(\d{1,2})\2(\d{2}|\d{4})$/.exec(s))) return make(fullYear(m[4]), Number(m[1]), Number(m[3]), 'm/d/yyyy');
  // 10/22 (this year), 10/2026 (the first of the month)
  if ((m = /^(\d{1,2})\/(\d{1,4})$/.exec(s))) {
    if (strict) return null;
    if (m[2].length === 4) return make(Number(m[2]), Number(m[1]), 1, 'mmm-yy');
    return make(thisYear, Number(m[1]), Number(m[2]), 'd-mmm');
  }
  // 22-Oct-2026, 22 October 2026, 22 Oct, 22-Oct-26
  if ((m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9}\.?)(?:[-\s/,]+(\d{2}|\d{4}))?$/.exec(s))) {
    const mon = monthOf(m[2]);
    if (!mon) return null;
    return m[3] ? make(fullYear(m[3]), mon, Number(m[1]), 'd-mmm-yy') : make(thisYear, mon, Number(m[1]), 'd-mmm');
  }
  // Oct 22, 2026; October 22 2026; Oct 22
  if ((m = /^([A-Za-z]{3,9}\.?)[-\s/](\d{1,2})(?:(?:,\s*|[-\s/])(\d{4}|\d{2}))?$/.exec(s))) {
    const mon = monthOf(m[1]);
    if (!mon) return null;
    return m[3] ? make(fullYear(m[3]), mon, Number(m[2]), 'd-mmm-yy') : make(thisYear, mon, Number(m[2]), 'd-mmm');
  }
  // October 2026: the first of the month
  if ((m = /^([A-Za-z]{3,9}\.?)[-\s/](\d{4})$/.exec(s))) {
    const mon = monthOf(m[1]);
    return mon ? make(Number(m[2]), mon, 1, 'mmm-yy') : null;
  }
  return null;
}

/** The number format a formula's answer takes when the cell has none, as Excel picks it (=TODAY() shows as a date). */
export function formulaDateFormat(formula: string): string | undefined {
  const m = /^=\s*([A-Za-z.]+)\s*\(/.exec(formula);
  if (!m) return undefined;
  const fn = m[1].toUpperCase();
  if (fn === 'NOW') return 'm/d/yyyy h:mm';
  // (EDATE, WORKDAY, DATEVALUE and the like give plain numbers in Excel until formatted)
  if (fn === 'TODAY' || fn === 'DATE') return 'm/d/yyyy';
  if (fn === 'TIME') return 'h:mm AM/PM';
  return undefined;
}
