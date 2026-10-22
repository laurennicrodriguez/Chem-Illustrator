// The Navigation pane (View > Navigation Pane, as in Word): the document's headings, to jump to
// and to drag into another order (each heading taking the text and lower headings under it),
// and the places a search finds, each shown with the words round it.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { fitParas, paraCount, paraRange, splitParagraphs } from '../text/paragraphs';
import { coveringCell } from '../table';
import { cellHolding, objectOffsets, styleOf, type DocText } from './document';
import { subtreeEnd } from './doc-views';
import { findAll, withoutDeleted, type FindOptions } from './find';

export interface NavHeading {
  /** The heading's paragraph. */
  para: number;
  /** 1 for Heading 1, and so on. */
  level: number;
  text: string;
}

function allParas(t: Pick<DocText, 'runs' | 'paras'>): ParaStyle[] {
  return fitParas(t.paras, paraCount(rt.plainText(t.runs)));
}

/** Each paragraph's outline level (0 for body text). */
export function levelsOf(t: DocText): number[] {
  return allParas(t).map((ps) => styleOf(t, ps).outline ?? 0);
}

/** Every heading, in order, as plain text (figures and fields left out; an empty heading as Word shows it). */
export function headingsOf(t: DocText): NavHeading[] {
  const parts = splitParagraphs(t.runs);
  const out: NavHeading[] = [];
  levelsOf(t).forEach((level, p) => {
    if (!level) return;
    const text = (parts[p] ?? []).filter((r) => r.obj === undefined && !r.rev?.startsWith('del')).map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
    out.push({ para: p, level, text });
  });
  return out;
}

/** The heading the caret is under (the last heading at or before its paragraph), or null. */
export function headingAt(heads: NavHeading[], para: number): number | null {
  let got: number | null = null;
  for (const h of heads) { if (h.para <= para) got = h.para; else break; }
  return got;
}

/** Which headings have headings under them (to show a fold arrow). */
export function hasChildren(heads: NavHeading[], i: number): boolean {
  return i + 1 < heads.length && heads[i + 1].level > heads[i].level;
}

/** The headings shown when some are folded: none of those under a folded one. */
export function shownHeadings(heads: NavHeading[], folded: Set<number>): NavHeading[] {
  const out: NavHeading[] = [];
  let hideBelow = Infinity;
  for (const h of heads) {
    if (h.level > hideBelow) continue;
    hideBelow = Infinity;
    out.push(h);
    if (folded.has(h.para)) hideBelow = h.level;
  }
  return out;
}

/**
 * Move a heading with everything under it (its text and lower headings) to just before
 * paragraph `to` (the number of paragraphs for the end). Null when it would land inside itself
 * or not move. Gives the new text and where the heading now is.
 */
export function moveHeading(t: DocText, from: number, to: number): { t: DocText; para: number } | null {
  const levels = levelsOf(t);
  const n = levels.length;
  const end = subtreeEnd(levels, from);
  if (to >= from && to <= end) return null;
  const text = rt.plainText(t.runs);
  const paras = allParas(t);
  // each paragraph's runs, and the break after it (the last has none)
  const body = (p: number) => { const r = paraRange(text, p); return rt.sliceRuns(t.runs, r.start, r.end); };
  const brk = (p: number): TextRun[] => {
    const r = paraRange(text, p);
    const got = rt.sliceRuns(t.runs, r.end, r.end + 1);
    return got.length ? got : [{ ...(body(p).length ? rt.styleOf(body(p)[body(p).length - 1]) : {}), text: '\n' }];
  };
  const order: number[] = [];
  for (let p = 0; p < n; p++) {
    if (p === to) for (let q = from; q < end; q++) order.push(q);
    if (p >= from && p < end) continue;
    order.push(p);
  }
  if (to >= n) for (let q = from; q < end; q++) order.push(q);
  const runs: TextRun[] = [];
  order.forEach((p, i) => {
    runs.push(...body(p));
    if (i < order.length - 1) runs.push(...brk(p).map((r) => ({ ...r, text: '\n' })));
  });
  return { t: { ...t, runs: rt.normalizeRuns(runs), paras: order.map((p) => paras[p]) }, para: order.indexOf(from) };
}

/** Where a search found something: in the text, or in a table cell. */
export interface NavHit {
  /** In the text (`cell` left out), or in this cell of this table. */
  cell?: { id: number; r: number; c: number };
  start: number;
  end: number;
  /** Words before the find, the find itself and words after it (to show in the list). */
  before: string;
  match: string;
  after: string;
}

const AROUND = 28;

function snip(text: string, a: number, b: number): Pick<NavHit, 'before' | 'match' | 'after'> {
  const lineStart = text.lastIndexOf('\n', a - 1) + 1;
  let lineEnd = text.indexOf('\n', b);
  if (lineEnd < 0) lineEnd = text.length;
  let s = Math.max(lineStart, a - AROUND), e = Math.min(lineEnd, b + AROUND);
  // start and end on a word
  if (s > lineStart) { const sp = text.indexOf(' ', s); if (sp >= 0 && sp < a) s = sp + 1; }
  if (e < lineEnd) { const sp = text.lastIndexOf(' ', e); if (sp > b) e = sp; }
  const clean = (x: string) => x.replace(/￼/g, '').replace(/\s+/g, ' ');
  return { before: (s > lineStart ? '…' : '') + clean(text.slice(s, a)), match: clean(text.slice(a, b)), after: clean(text.slice(b, e)) + (e < lineEnd ? '…' : '') };
}

/** Every place the words are found, in the text and in its tables' cells, in the order they come. */
export function searchDocument(t: DocText, query: string, opts: FindOptions = {}): NavHit[] {
  if (!query.trim()) return [];
  const text = rt.plainText(t.runs);
  const offs = objectOffsets(t.runs);
  const keyed: { key: number; sub: number; hit: NavHit }[] = [];
  for (const [a, b] of withoutDeleted(t.runs, findAll(text, query, opts))) keyed.push({ key: a, sub: 0, hit: { start: a, end: b, ...snip(text, a, b) } });
  // a cell's finds come where its table is in the text (a table in a cell, where the outer one is)
  const placeOf = (id: number): number => {
    const at = offs.get(id);
    if (at !== undefined) return at;
    const holder = cellHolding(t, id);
    return holder ? placeOf(holder.id) : Infinity;
  };
  let sub = 0;
  for (const [k, o] of Object.entries(t.objects)) {
    if (o.kind !== 'table') continue;
    const id = Number(k);
    const key = placeOf(id);
    if (key === Infinity) continue;
    o.table.rows.forEach((row, r) => row.forEach((cell, c) => {
      const own = coveringCell(o.table, r, c);
      if (own.r !== r || own.c !== c) return;
      const ct = rt.plainText(cell.runs);
      for (const [a, b] of withoutDeleted(cell.runs, findAll(ct, query, opts))) keyed.push({ key, sub: ++sub, hit: { cell: { id, r, c }, start: a, end: b, ...snip(ct, a, b) } });
    }));
  }
  keyed.sort((x, y) => x.key - y.key || x.sub - y.sub);
  return keyed.map((x) => x.hit);
}
