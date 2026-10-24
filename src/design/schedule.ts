// When things happen, for the Gantt chart and the timeline with dates (diagrams.ts): a line such
// as "Ligand synthesis: Feb – Apr 2026" is a task from the start of February to the end of April,
// and "Paper submitted: Jul" a milestone. Dates can be months (Mar, March 2026, 2026-03, Q2
// 2026), days (2026-03-14, 14 Mar 2026, Mar 14), or numbered steps (Week 3, Day 10, 3); a range
// runs from the start of its first to the end of its last. Everything is put on one scale, of
// days or of steps, as the first line with a when has it.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One end of a range as written: a date (to the day or the month) or a numbered step. */
type When =
  | { kind: 'date'; y: number | null; m: number; d: number | null }
  | { kind: 'quarter'; y: number | null; q: number }
  | { kind: 'number'; n: number; word: string };

const monthOf = (s: string): number => {
  const k = s.slice(0, 3).toLowerCase();
  const i = MONTHS.indexOf(k);
  // the whole word, or a short form of it (Sept too)
  if (i < 0) return -1;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  const w = s.toLowerCase().replace(/\.$/, '');
  return full.startsWith(w) || w === 'sept' ? i : -1;
};

/** One date or step, or null when it isn't one. */
function readWhen(s: string): When | null {
  const t = s.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return { kind: 'date', y: +m[1], m: +m[2] - 1, d: +m[3] };
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(t))) return { kind: 'date', y: +m[1], m: +m[2] - 1, d: null };
  if ((m = /^Q([1-4])(?: (\d{4}))?$/i.exec(t))) return { kind: 'quarter', y: m[2] ? +m[2] : null, q: +m[1] - 1 };
  // 14 Mar 2026, Mar 14 2026, March 2026, March
  if ((m = /^(\d{1,2}) ([A-Za-z]+\.?)(?: (\d{4}))?$/.exec(t)) && monthOf(m[2]) >= 0) return { kind: 'date', y: m[3] ? +m[3] : null, m: monthOf(m[2]), d: +m[1] };
  if ((m = /^([A-Za-z]+\.?) (\d{1,2})(?: (\d{4}))?$/.exec(t)) && monthOf(m[1]) >= 0) return { kind: 'date', y: m[3] ? +m[3] : null, m: monthOf(m[1]), d: +m[2] };
  if ((m = /^([A-Za-z]+\.?)(?: (\d{4}))?$/.exec(t)) && monthOf(m[1]) >= 0) return { kind: 'date', y: m[2] ? +m[2] : null, m: monthOf(m[1]), d: null };
  // Week 3, Day 10, Month 2, Year 1, or a bare number
  if ((m = /^(?:([A-Za-z][A-Za-z ]*?) )?(\d+(?:\.\d+)?)$/.exec(t))) return { kind: 'number', n: +m[2], word: m[1] ?? '' };
  return null;
}

/** "Feb – Apr 2026", "Week 1 to Week 4", "2026-03-01 – 2026-03-14", or one date. */
function readRange(s: string): { from: When; to: When | null } | null {
  const parts = s.split(/\s+(?:–|—|-|to|until|till)\s+|\s*(?:–|—|\.\.)\s*/i);
  if (parts.length > 2 || !parts[0].trim()) return null;
  const from = readWhen(parts[0]);
  if (!from) return null;
  if (parts.length === 1) return { from, to: null };
  let to = readWhen(parts[1]);
  // "Week 1 – 4": the second takes the first's word
  if (to?.kind === 'number' && from.kind === 'number' && !to.word) to = { ...to, word: from.word };
  if (!to || (to.kind === 'number') !== (from.kind === 'number')) return null;
  return { from, to };
}

/**
 * A task's words and when it happens, from "words: when" (null when it says no when). The words
 * are everything before the last colon whose rest reads as a date, a range or a numbered step.
 */
export function splitWhen(text: string): { label: string; when: string } | null {
  for (let i = text.lastIndexOf(':'); i > 0; i = text.lastIndexOf(':', i - 1)) {
    const when = text.slice(i + 1).trim();
    if (when && readRange(when)) return { label: text.slice(0, i).trim(), when };
  }
  return null;
}

/** A task (or milestone) on the scale: from `start` to `end` (the same for a milestone). */
export interface Span { start: number; end: number; milestone: boolean }

/** The scale: days (since 1 Jan 1970) when there are dates, else numbered steps with their word. */
export interface Scale { days: boolean; years: boolean; word: string; min: number; max: number }

const dayNo = (y: number, m: number, d: number): number => Date.UTC(y, m, d) / 86400000;

/**
 * Put every line's when on one scale: the spans (null for a line with none, or one that doesn't
 * go with the rest), and the scale they are on. A date without a year takes the year of the one
 * before it (2000 when none has one), and a range that would run backwards ("Nov – Feb") runs on
 * into the next year.
 */
export function schedule(whens: (string | null)[]): { spans: (Span | null)[]; scale: Scale | null } {
  const read = whens.map((w) => (w ? readRange(w) : null));
  // the scale is the first when's kind: days, or numbered steps
  const dated = read.find((r) => r)?.from.kind !== 'number';
  const years = read.some((r) => r && [r.from, r.to].some((x) => x && x.kind !== 'number' && x.y !== null));
  let year = 2000;
  const firstYear = read.flatMap((r) => (r ? [r.from, r.to] : [])).find((x) => x && x.kind !== 'number' && x.y !== null);
  if (firstYear && firstYear.kind !== 'number') year = firstYear.y!;
  let word = '';
  // a when's first and last day (or step), the end just past it
  const bounds = (x: When, y: number): [number, number] => {
    if (x.kind === 'number') return [x.n, x.n + 1];
    if (x.kind === 'quarter') return [dayNo(y, 3 * x.q, 1), dayNo(y, 3 * x.q + 3, 1)];
    return x.d === null ? [dayNo(y, x.m, 1), dayNo(y, x.m + 1, 1)] : [dayNo(y, x.m, x.d), dayNo(y, x.m, x.d + 1)];
  };
  const spans = read.map((r): Span | null => {
    if (!r || (r.from.kind === 'number') === dated) return null;
    if (r.from.kind === 'number' && r.from.word && !word) word = r.from.word;
    const yOf = (x: When) => (x.kind !== 'number' && x.y !== null ? x.y : year);
    const y0 = yOf(r.from);
    if (r.from.kind !== 'number' && r.from.y !== null) year = r.from.y;
    const [a] = bounds(r.from, y0);
    if (!r.to) {
      const [s, e] = bounds(r.from, y0);
      // a milestone sits in the middle of a month or step, and at the start of a day
      const at = r.from.kind === 'date' && r.from.d !== null ? s : (s + e) / 2;
      return { start: at, end: at, milestone: true };
    }
    let y1 = yOf(r.to);
    if (r.to.kind !== 'number' && r.to.y !== null) year = r.to.y;
    let [, b] = bounds(r.to, y1);
    if (r.to.kind !== 'number' && r.to.y === null && b <= a) { y1 += 1; [, b] = bounds(r.to, y1); year = y1; }
    return b > a ? { start: a, end: b, milestone: false } : null;
  });
  const ends = spans.flatMap((s) => (s ? [s.start, s.end] : []));
  if (!ends.length) return { spans, scale: null };
  let min = Math.min(...ends), max = Math.max(...ends);
  if (max - min < 1) { min -= 1; max += 1; }
  return { spans, scale: { days: dated, years, word, min, max } };
}

/** Where the scale is marked, and what each mark says. */
export function scaleTicks(sc: Scale, room: number): { at: number; label: string }[] {
  const out: { at: number; label: string }[] = [];
  const most = Math.max(2, Math.floor(room));
  if (!sc.days) {
    // a mark at the start of each step, every so many so they fit
    const first = Math.floor(sc.min), last = Math.ceil(sc.max);
    const every = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((k) => (last - first) / k <= most) ?? 1000;
    for (let n = Math.ceil(first / every) * every; n < last; n += every) out.push({ at: n, label: sc.word ? `${sc.word} ${n}` : String(n) });
    return out;
  }
  const date = (d: number) => new Date(d * 86400000);
  const span = sc.max - sc.min;
  if (span <= 62) {
    // days, or the start of each week
    const step = span <= 16 ? 1 : 7;
    for (let d = Math.ceil(sc.min); d < sc.max; d += step) { const t = date(d); out.push({ at: d, label: `${t.getUTCDate()} ${SHORT[t.getUTCMonth()]}` }); }
    return thin(out, most);
  }
  const start = date(sc.min);
  let y = start.getUTCFullYear(), m = start.getUTCMonth();
  if (dayNo(y, m, 1) < sc.min) m++;
  if (span > 3 * 366) {
    // the start of each year
    for (let yy = y + (m > 0 ? 1 : 0); dayNo(yy, 0, 1) < sc.max; yy++) out.push({ at: dayNo(yy, 0, 1), label: String(yy) });
    return thin(out, most);
  }
  for (; dayNo(y, m, 1) < sc.max; m++) {
    const at = dayNo(y, m, 1), t = date(at);
    const mm = t.getUTCMonth();
    out.push({ at, label: sc.years && (mm === 0 || !out.length) ? `${SHORT[mm]} ${t.getUTCFullYear()}` : SHORT[mm] });
  }
  return thin(out, most);
}

/** Every other mark (or every third…) until there are few enough. */
function thin<T>(xs: T[], most: number): T[] {
  const k = Math.max(1, Math.ceil(xs.length / most));
  return xs.filter((_, i) => i % k === 0);
}
