// Home > Sort, as in Word: the paragraphs picked (or a table's rows) put in order by their text,
// by the first number in them, or by a date, up or down, with up to three keys (Sort by, Then
// by…). Paragraphs can be cut into fields at tabs or commas to sort by one of them; a table
// sorts by a column. A heading row stays at the top. The sort is stable, so rows that tie keep
// their order.

import type { ParaStyle, TableData, TextRun } from '../model';
import * as rt from '../richtext';
import { fitParas, paraCount, splitParagraphs } from '../text/paragraphs';
import { OBJECT_CHAR, type DocText } from './document';

export type SortType = 'text' | 'number' | 'date';

export interface SortKey {
  /** Which field (paragraphs cut at `sep`) or column (tables), from 0; the whole paragraph when left out. */
  field?: number;
  type: SortType;
  descending?: boolean;
}

export interface SortOptions {
  keys: SortKey[];
  /** The first row (or paragraph) is a heading and stays where it is. */
  header?: boolean;
  /** What cuts a paragraph into fields (Word's Options > Separate fields at). */
  sep?: '\t' | ',' | string;
  /** Capitals before small letters when the letters are the same (Word's Case sensitive). */
  caseSensitive?: boolean;
}

/** The first number in some text (with its sign and decimals; thousands commas skipped), or null. */
export function firstNumber(s: string): number | null {
  const m = /[-−+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?|[-−+]?\.\d+/.exec(s);
  if (!m) return null;
  const v = Number(m[0].replace(/,/g, '').replace('−', '-'));
  return Number.isFinite(v) ? v : null;
}

/** A date in some text (2026-10-22, 10/22/2026, 22 Oct 2026, October 22, 2026), as a time, or null. */
export function dateValue(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (us) { const y = +us[3] < 100 ? 2000 + +us[3] : +us[3]; return Date.UTC(y, +us[1] - 1, +us[2]); }
  const v = Date.parse(t);
  return Number.isFinite(v) ? v : null;
}

/** A row's (or paragraph's) text for one key: its field, or all of it. */
function keyText(text: string, field: number | undefined, sep: string | undefined): string {
  if (field === undefined || !sep) return text;
  return text.split(sep)[field] ?? '';
}

/**
 * Compare two texts as a key says. Empty texts (and, for numbers and dates, those with none) go
 * last going up and first going down, as in Word.
 */
export function compareBy(a: string, b: string, key: SortKey, caseSensitive = false): number {
  const sign = key.descending ? -1 : 1;
  const value = (s: string): number | string | null => {
    if (key.type === 'number') return firstNumber(s);
    if (key.type === 'date') return dateValue(s);
    const v = s.trim();
    return v ? v : null;
  };
  const x = value(a), y = value(b);
  if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1) * sign;
  if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
  const c = String(x).localeCompare(String(y), undefined, { sensitivity: caseSensitive ? 'case' : 'base', numeric: false });
  if (c || !caseSensitive) return c * sign;
  // the same letters: capitals first
  return (String(x) < String(y) ? 1 : String(x) > String(y) ? -1 : 0) * sign;
}

/** The order the rows go in (indexes), by the keys in turn, ties keeping their order. */
export function sortOrder(texts: string[], o: SortOptions): number[] {
  const idx = texts.map((_, i) => i);
  const keys = o.keys.length ? o.keys : [{ type: 'text' as const }];
  return idx.sort((i, j) => {
    for (const k of keys) {
      const c = compareBy(keyText(texts[i], k.field, o.sep), keyText(texts[j], k.field, o.sep), k, o.caseSensitive);
      if (c) return c;
    }
    return i - j;
  });
}

/** A paragraph's text as sorted on: what it reads (a figure counts for nothing). */
const sortText = (runs: TextRun[]) => rt.plainText(runs).split(OBJECT_CHAR).join('');

/**
 * Paragraphs `first` to `last` of a document put in order, each with its own formatting and
 * paragraph settings. Bookmarks, page breaks and section breaks stay where they were (with the
 * place, not the text), as Word keeps a section's start where it is.
 */
export function sortParagraphs(t: DocText, first: number, last: number, o: SortOptions): DocText {
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  const runsOf = splitParagraphs(t.runs);
  const from = Math.max(0, first + (o.header ? 1 : 0)), to = Math.min(n - 1, last);
  if (to <= from) return t;
  const span = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  // empty paragraphs (none to sort on) stay out of the way at the end, as Word drops them to the bottom
  const order = sortOrder(span.map((p) => sortText(runsOf[p] ?? [])), o).map((k) => span[k]);
  const kept = (p: ParaStyle): Partial<ParaStyle> => ({ pageBreak: p.pageBreak, colBreak: p.colBreak, section: p.section, marks: p.marks });
  const moved = (p: ParaStyle): ParaStyle => { const { pageBreak: _a, colBreak: _b, section: _c, marks: _d, ...rest } = p; return rest; };
  const newParas = paras.slice();
  const newRuns = runsOf.slice();
  order.forEach((src, k) => {
    const at = span[k];
    newParas[at] = { ...moved(paras[src]), ...Object.fromEntries(Object.entries(kept(paras[at])).filter(([, v]) => v !== undefined)) };
    newRuns[at] = runsOf[src] ?? [];
  });
  // the line breaks between paragraphs take the look of the text before them
  const runs: TextRun[] = [];
  newRuns.forEach((rs, i) => {
    if (i > 0) {
      const prev = newRuns[i - 1];
      const look = prev.length ? rt.styleOf(prev[prev.length - 1]) : rs.length ? rt.styleOf(rs[0]) : {};
      runs.push({ ...look, text: '\n' });
    }
    runs.push(...rs.filter((r) => r.obj === undefined || r.text).map((r) => ({ ...r })));
  });
  return { ...t, runs: rt.normalizeRuns(runs), paras: newParas };
}

/** A table's rows in order by their cells (a key's field is its column); the heading rows stay at the top. */
export function sortTableRows(tb: TableData, o: SortOptions): TableData {
  const head = Math.max(o.header ? 1 : 0, tb.head ?? 0);
  // rows with cells merged down can't be moved apart
  if (tb.rows.some((row) => row.some((c) => (c.rowSpan ?? 1) > 1))) return tb;
  const body = tb.rows.slice(head);
  const texts = body.map((row) => row.map((c) => sortText(c.runs)).join('\u0001'));
  const order = sortOrder(texts, { ...o, sep: '\u0001' });
  return { ...tb, rows: [...tb.rows.slice(0, head), ...order.map((i) => body[i])] };
}
