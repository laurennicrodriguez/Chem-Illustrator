// Tracked changes (Review > Track Changes, as in Word). While tracking is on, text typed or
// pasted is kept marked as inserted, and text deleted stays in place marked as deleted (shown
// struck through) until someone accepts or rejects the change. Each mark says who made the
// change and when. The marks are saved as Word's own (w:ins and w:del), so Word shows them as
// tracked changes too, and Word's come back here the same way.
//
// A mark is stored on the text run as a short string, "ins|Nate|2026-10-14T21:00:00Z", so runs
// with the same mark join up and compare simply.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { editParas, fitParas, paraCount } from '../text/paragraphs';

export type RevKind = 'ins' | 'del';

export interface Revision {
  kind: RevKind;
  author: string;
  /** When, as an ISO date and time (Word's w:date). */
  date: string;
}

/** The name put on changes made here (Edit > Preferences, or asked the first time tracking is turned on). */
let author = '';
export const reviewAuthor = (): string => author;
export function setReviewAuthor(name: string): void {
  author = name.trim();
}

/** Now, as Word writes it on a change (to the second, in UTC). */
export const revisionDate = (d = new Date()): string => d.toISOString().replace(/\.\d+Z$/, 'Z');

/** A revision as stored on a run. */
export function revText(r: Revision): string {
  return `${r.kind}|${r.author.replace(/\|/g, '/')}|${r.date}`;
}

/** A run's revision, or null. */
export function parseRev(s: string | undefined): Revision | null {
  if (!s) return null;
  const [kind, author = '', date = ''] = s.split('|');
  return kind === 'ins' || kind === 'del' ? { kind, author, date } : null;
}

/** Something with text in runs and a style for each paragraph (a document, or a part of one). */
export interface Revisable { runs: TextRun[]; paras: ParaStyle[] }

/** Every change, in order: where it is, what kind, who and when, and its text. Neighbouring runs with the same mark are one change. */
export interface Change extends Revision { start: number; end: number; text: string }

export function changesIn(runs: TextRun[]): Change[] {
  const out: Change[] = [];
  let at = 0;
  for (const r of runs) {
    const v = parseRev(r.rev);
    const end = at + r.text.length;
    if (v) {
      const last = out[out.length - 1];
      if (last && last.end === at && last.kind === v.kind && last.author === v.author) { last.end = end; last.text += r.text; }
      else out.push({ ...v, start: at, end, text: r.text });
    }
    at = end;
  }
  return out;
}

/** Delete text between two places for real, keeping the paragraphs' styles in step. */
function cut<T extends Revisable>(t: T, start: number, end: number): T {
  if (end <= start) return t;
  const text = rt.plainText(t.runs);
  return { ...t, runs: rt.replaceRange(t.runs, start, end, []), paras: editParas(t.paras, text, start, end, '') };
}

/** Put runs in at a place for real. */
function put<T extends Revisable>(t: T, at: number, runs: TextRun[], paras?: ParaStyle[]): T {
  const text = rt.plainText(t.runs);
  return { ...t, runs: rt.replaceRange(t.runs, at, at, runs), paras: editParas(t.paras, text, at, at, rt.plainText(runs), paras) };
}

/** The pieces of the text between two places, each with its offset. */
function pieces(runs: TextRun[], start: number, end: number): { start: number; end: number; rev: Revision | null }[] {
  const out: { start: number; end: number; rev: Revision | null }[] = [];
  let at = 0;
  for (const r of runs) {
    const a = Math.max(start, at), b = Math.min(end, at + r.text.length);
    if (b > a) out.push({ start: a, end: b, rev: parseRev(r.rev) });
    at += r.text.length;
  }
  return out;
}

/**
 * An edit made while changes are tracked: the text between `start` and `end` is marked deleted
 * (text already inserted while tracking just goes, and text already deleted stays as it was),
 * and `runs` go in after it, marked inserted. Returns the new text, where the caret goes (after
 * what was put in), and how much of the range stayed (as deleted text).
 */
export function trackedReplace<T extends Revisable>(t: T, start: number, end: number, runs: TextRun[], paras: ParaStyle[] | undefined, who: { author: string; date: string }): { t: T; caret: number; kept: number } {
  t = { ...t, paras: fitParas(t.paras, paraCount(rt.plainText(t.runs))) };
  const ps = pieces(t.runs, start, end);
  // inserted text goes for real (from the end back, so earlier places stay put)
  for (const p of [...ps].reverse()) if (p.rev?.kind === 'ins') t = cut(t, p.start, p.end);
  const kept = ps.filter((p) => p.rev?.kind !== 'ins').reduce((a, p) => a + p.end - p.start, 0);
  // the rest is marked deleted, keeping the marks of text deleted before
  if (kept) {
    const del = revText({ kind: 'del', ...who });
    const n = rt.plainText(t.runs).length;
    const mid = rt.sliceRuns(t.runs, start, start + kept).map((r) => (parseRev(r.rev)?.kind === 'del' ? r : { ...r, rev: del }));
    t = { ...t, runs: rt.normalizeRuns([...rt.sliceRuns(t.runs, 0, start), ...mid, ...rt.sliceRuns(t.runs, start + kept, n)]) };
  }
  const at = start + kept;
  const insert = runs.filter((r) => r.text).map((r) => ({ ...r, rev: revText({ kind: 'ins', ...who }) }));
  if (insert.length) t = put(t, at, insert, paras);
  return { t, caret: at + rt.plainText(insert).length, kept };
}

/**
 * Accept (or reject) the changes between two places (all of them when not given): accepting
 * keeps inserted text and takes deleted text away; rejecting does the opposite. A change only
 * partly inside the range is decided for the part inside.
 */
export function decide<T extends Revisable>(t: T, accept: boolean, start = 0, end = Infinity): T {
  t = { ...t, paras: fitParas(t.paras, paraCount(rt.plainText(t.runs))) };
  const n = rt.plainText(t.runs).length;
  const ps = pieces(t.runs, Math.max(0, start), Math.min(n, end)).filter((p) => p.rev);
  // marks taken off first (offsets don't change), then text taken away from the end back
  const goes = (p: { rev: Revision | null }) => (p.rev!.kind === 'del') === accept;
  for (const p of ps) {
    if (goes(p)) continue;
    const len = rt.plainText(t.runs).length;
    const mid = rt.sliceRuns(t.runs, p.start, p.end).map((r) => ({ ...r, rev: undefined }));
    t = { ...t, runs: rt.normalizeRuns([...rt.sliceRuns(t.runs, 0, p.start), ...mid, ...rt.sliceRuns(t.runs, p.end, len)]) };
  }
  for (const p of [...ps].reverse()) if (goes(p)) t = cut(t, p.start, p.end);
  return t;
}

/** The text with every change accepted (as it will read). */
export const accepted = <T extends Revisable>(t: T): T => decide(t, true);

/** Does the text have tracked changes? */
export const hasChanges = (runs: TextRun[]): boolean => runs.some((r) => r.rev);

/** Colours for each person's changes (Word's order: the first person red, then blue, green…). */
export const REVIEW_COLOURS = ['#c00000', '#1f5fbf', '#2e7d32', '#8e24aa', '#ef6c00', '#00838f', '#ad1457', '#5d4037'];

/** Each author's colour, in the order they first appear in the text. */
export function authorColours(runs: TextRun[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of runs) {
    const v = parseRev(r.rev);
    if (v && !out.has(v.author)) out.set(v.author, REVIEW_COLOURS[out.size % REVIEW_COLOURS.length]);
  }
  return out;
}

/** The runs as shown with changes marked: inserted text underlined, deleted text struck through, each in its author's colour. */
export function markedRuns(runs: TextRun[], colours = authorColours(runs)): TextRun[] {
  return runs.map((r) => {
    const v = parseRev(r.rev);
    if (!v) return r;
    const color = colours.get(v.author) ?? REVIEW_COLOURS[0];
    // a figure keeps its own look; its line still shows the change
    if (r.obj !== undefined) return r;
    return v.kind === 'ins' ? { ...r, color, underline: true } : { ...r, color, strike: true };
  });
}
