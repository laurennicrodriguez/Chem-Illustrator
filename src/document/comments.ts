// Comments, as in Word (Review > New Comment): a note on a stretch of the text, with who wrote it
// and when, replies under it, and a Resolved mark. The text a comment is on keeps the comment's
// id on its runs ("cmt", ids joined by commas, as overlapping comments share text), so the
// comment stays on its words however the text around them changes; the comments themselves are
// kept with the document by id. A comment whose words have all been deleted is not shown, and is
// left out of saved files, but comes back with Undo.
//
// Slides use the same notes (CommentNote, a thread with replies), pinned to a point on the slide.

import type { TextRun } from '../model';
import * as rt from '../richtext';

/** One note: who wrote it, when (an ISO date and time) and what it says (plain text, lines split by \n). */
export interface CommentNote {
  author: string;
  date: string;
  text: string;
}

/** A comment: its first note, the replies under it, and whether it has been resolved. */
export interface CommentThread extends CommentNote {
  replies?: CommentNote[];
  done?: boolean;
}

/** The ids of the comments on a run. */
export function cmtIds(s: string | undefined): number[] {
  if (!s) return [];
  return s.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0);
}

/** Ids as kept on a run (sorted, so runs with the same comments join up), or undefined for none. */
export function cmtString(ids: Iterable<number>): string | undefined {
  const list = [...new Set(ids)].sort((a, b) => a - b);
  return list.length ? list.join(',') : undefined;
}

/** Where each comment is in the text: from its first marked character to the end of its last. */
export function commentRanges(runs: TextRun[]): Map<number, { start: number; end: number }> {
  const out = new Map<number, { start: number; end: number }>();
  let at = 0;
  for (const r of runs) {
    const end = at + r.text.length;
    for (const id of cmtIds(r.cmt)) {
      const got = out.get(id);
      if (got) got.end = end;
      else out.set(id, { start: at, end });
    }
    at = end;
  }
  return out;
}

/** Mark a stretch of text with a comment's id (on top of any comments already there). */
export function markComment(runs: TextRun[], start: number, end: number, id: number): TextRun[] {
  return mapRange(runs, start, end, (r) => ({ ...r, cmt: cmtString([...cmtIds(r.cmt), id]) }));
}

/** Take a comment's id off the text wherever it is. */
export function unmarkComment(runs: TextRun[], id: number): TextRun[] {
  return rt.normalizeRuns(runs.map((r) => {
    if (!r.cmt) return r;
    const ids = cmtIds(r.cmt).filter((x) => x !== id);
    const { cmt: _, ...rest } = r;
    return ids.length ? { ...rest, cmt: cmtString(ids) } : rest;
  }));
}

/** Change the runs between two offsets, splitting the runs at the ends. */
function mapRange(runs: TextRun[], start: number, end: number, fn: (r: TextRun) => TextRun): TextRun[] {
  const before = rt.sliceRuns(runs, 0, start);
  const mid = rt.sliceRuns(runs, start, end).map(fn);
  const total = runs.reduce((n, r) => n + r.text.length, 0);
  const after = rt.sliceRuns(runs, end, total);
  return rt.normalizeRuns([...before, ...mid, ...after]);
}

/** The next free id for a comment. */
export function nextCommentId(comments: Record<number, CommentThread> | undefined): number {
  let n = 0;
  for (const k of Object.keys(comments ?? {})) n = Math.max(n, Number(k) + 1);
  return n;
}

/** Comments that are on some text, in the order of the text, with where they are. */
export function placedComments(runs: TextRun[], comments: Record<number, CommentThread> | undefined): { id: number; start: number; end: number; c: CommentThread }[] {
  if (!comments) return [];
  const out: { id: number; start: number; end: number; c: CommentThread }[] = [];
  for (const [id, r] of commentRanges(runs)) {
    const c = comments[id];
    if (c) out.push({ id, ...r, c });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);
}

/**
 * What a new comment goes on: the selection, or with nothing selected the word at the caret (as
 * Word does), else the character before it. Null when there is no text to put it on.
 */
export function commentSpan(text: string, start: number, end: number): [number, number] | null {
  if (end > start) return [start, end];
  const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_'’-]/u.test(ch);
  let a = start, b = start;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  if (b > a) return [a, b];
  if (start > 0 && text[start - 1] !== '\n') return [start - 1, start];
  if (start < text.length && text[start] !== '\n') return [start, start + 1];
  return null;
}

/** Initials for a name, as Word shows on a comment (Nate O'Hare → NO). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : parts.map((p) => p[0]).join('').slice(0, 3).toUpperCase();
}

/** "14 Oct, 21:05" for a date and time (today's show the time only). */
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `${day}, ${time}`;
}

/** A comment on a slide: pinned to a point (in points from the slide's top left), as PowerPoint's are. */
export interface PinnedComment extends CommentThread {
  id: number;
  x: number;
  y: number;
}

/** A slide's comments, copied (for duplicates and the undo history). */
export function copyPinned(list: PinnedComment[] | undefined): PinnedComment[] {
  return (list ?? []).map((c) => ({ ...c, ...(c.replies ? { replies: c.replies.map((r) => ({ ...r })) } : {}) }));
}
