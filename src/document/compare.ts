// Review > Compare, as in Word: two versions of a document, and a new document showing what
// changed between them as tracked changes (what the revised version took out struck through,
// what it put in underlined), which can then be accepted or rejected one by one.
//
// Review > Combine puts two reviewers' copies of one document together: the changes each
// tracked keep their own names, and anything one of them changed without tracking is marked
// as that reviewer's change too.
//
// The text is compared word by word (or letter by letter), Word's "Show changes at" choice.
// Paragraphs are matched first, so a long document with a few changes compares quickly. A
// structure, picture, table or field counts as one word: one that changed shows as the old one
// deleted and the new one inserted. Changes of formatting alone are not marked: the revised
// version's formatting is kept.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { fitParas, paraCount } from '../text/paragraphs';
import { innerObjects, nextObjectId, type DocObject, type DocText } from './document';
import { changesIn, decide, parseRev, revText, revisionDate } from './revisions';
import { findDuplicate, newRefId, normaliseDoi, type Reference } from './references';

export type CompareLevel = 'word' | 'char';

export interface CompareOptions {
  /** The name put on the changes found (Word's "Label changes with"). */
  author: string;
  /** When, as an ISO date and time (now when left out). */
  date?: string;
  /** Show changes at the word level (Word's default) or letter by letter. */
  level?: CompareLevel;
}

/** One character of a document, with its formatting, where it came from, and the paragraph it is in. */
interface Cell { ch: string; run: TextRun; doc: 0 | 1; para: number }

/** A stretch of characters that compares as one: a word, a space, a mark, a line end or an object. */
interface Token { key: string; start: number; end: number }

function cellsOf(t: Pick<DocText, 'runs'>, doc: 0 | 1): Cell[] {
  const out: Cell[] = [];
  let para = 0;
  for (const r of t.runs) {
    const { text, ...style } = r;
    for (const ch of text) {
      // a character outside the first plane is two code units, as everywhere else in the text
      for (let i = 0; i < ch.length; i++) out.push({ ch: ch[i], run: style as TextRun, doc, para });
      if (ch === '\n') para++;
    }
  }
  return out;
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_'’\-]/u;

/** How an object compares: what it is, with citations naming their references by DOI or title, not by id. */
function objectKeys(t: DocText): Map<number, string> {
  const refs = new Map((t.references ?? []).map((r) => [r.id, refKey(r)]));
  const out = new Map<number, string>();
  for (const [k, o] of Object.entries(t.objects)) {
    const plain = o.kind === 'cite' ? { kind: 'cite', refs: o.refs.map((id) => refs.get(id) ?? id) } : o;
    out.set(Number(k), JSON.stringify(plain, (key, v) => (key === 'rev' || key === 'cmt' ? undefined : v)));
  }
  return out;
}

const refKey = (r: Reference): string => (r.doi ? 'doi:' + normaliseDoi(r.doi).toLowerCase() : `t:${r.title.trim().toLowerCase()}|${r.year}`);

function tokensOf(cells: Cell[], keys: Map<number, string>, level: CompareLevel): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < cells.length;) {
    const c = cells[i];
    if (c.run.obj !== undefined) { out.push({ key: '\u0000' + (keys.get(c.run.obj) ?? ''), start: i, end: i + 1 }); i++; continue; }
    let j = i + 1;
    if (level === 'word' && WORD_CHAR.test(c.ch)) while (j < cells.length && cells[j].run.obj === undefined && WORD_CHAR.test(cells[j].ch)) j++;
    else if (c.ch === ' ' || c.ch === '\t') while (j < cells.length && cells[j].ch === c.ch && cells[j].run.obj === undefined) j++;
    out.push({ key: cells.slice(i, j).map((x) => x.ch).join(''), start: i, end: j });
    i = j;
  }
  return out;
}

type Op = 'eq' | 'del' | 'ins';

/**
 * The shortest way from `a` to `b` (Myers' algorithm): each step keeps an item of both, deletes
 * one of `a` or inserts one of `b`. Gives up (everything deleted, then everything inserted)
 * after `limit` differences, so a block rewritten from top to bottom stays quick.
 */
export function diff(a: string[], b: string[], limit = 2000): Op[] {
  // the same at the start and end: kept without searching
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let post = 0;
  while (post < a.length - pre && post < b.length - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
  const A = a.slice(pre, a.length - post), B = b.slice(pre, b.length - post);
  const mid = middle(A, B, limit);
  return [...Array<Op>(pre).fill('eq'), ...mid, ...Array<Op>(post).fill('eq')];
}

function middle(a: string[], b: string[], limit: number): Op[] {
  const n = a.length, m = b.length;
  if (!n) return Array<Op>(m).fill('ins');
  if (!m) return Array<Op>(n).fill('del');
  const max = Math.min(n + m, limit);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      next[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    v = next;
  }
  if (found < 0) return [...Array<Op>(n).fill('del'), ...Array<Op>(m).fill('ins')];
  // back from the end through the saved rows
  const ops: Op[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const row = trace[d];
    const at = (k: number) => row[k + d + 1];
    const k = x - y;
    const up = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = up ? k + 1 : k - 1;
    const px = at(pk), py = px - pk;
    while (x > px + (up ? 0 : 1) && y > py + (up ? 1 : 0)) { ops.push('eq'); x--; y--; }
    ops.push(up ? 'ins' : 'del');
    if (up) y--; else x--;
  }
  while (x > 0 && y > 0) { ops.push('eq'); x--; y--; }
  return ops.reverse();
}

/** The steps from tokens `a` to tokens `b`: paragraphs that match are kept whole, and the words of the rest compared. */
function tokenDiff(a: Token[], b: Token[]): Op[] {
  const paras = (ts: Token[]) => {
    const out: { key: string; from: number; to: number }[] = [];
    let from = 0;
    for (let i = 0; i < ts.length; i++) if (ts[i].key === '\n' || i === ts.length - 1) { out.push({ key: ts.slice(from, i + 1).map((t) => t.key).join('\u0001'), from, to: i + 1 }); from = i + 1; }
    return out;
  };
  const pa = paras(a), pb = paras(b);
  const top = diff(pa.map((p) => p.key), pb.map((p) => p.key));
  const ops: Op[] = [];
  let i = 0, j = 0;
  for (let s = 0; s < top.length;) {
    if (top[s] === 'eq') { for (let k = pa[i].from; k < pa[i].to; k++) ops.push('eq'); i++; j++; s++; continue; }
    // a block of changed paragraphs: its words compared
    const i0 = i, j0 = j;
    while (s < top.length && top[s] !== 'eq') { if (top[s] === 'del') i++; else j++; s++; }
    const ta = a.slice(i0 < pa.length ? pa[i0].from : a.length, i > i0 ? pa[i - 1].to : (i0 < pa.length ? pa[i0].from : a.length));
    const tb = b.slice(j0 < pb.length ? pb[j0].from : b.length, j > j0 ? pb[j - 1].to : (j0 < pb.length ? pb[j0].from : b.length));
    ops.push(...diff(ta.map((t) => t.key), tb.map((t) => t.key)));
  }
  return ops;
}

/** Put the deletions of each changed stretch before its insertions, as Word shows them. */
function tidy(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (let i = 0; i < ops.length;) {
    if (ops[i] === 'eq') { out.push('eq'); i++; continue; }
    let d = 0, n = 0;
    while (i < ops.length && ops[i] !== 'eq') { if (ops[i] === 'del') d++; else n++; i++; }
    for (let k = 0; k < d; k++) out.push('del');
    for (let k = 0; k < n; k++) out.push('ins');
  }
  return out;
}

/** The text with every change accepted (main text only: what Compare compares). */
const acceptedText = (t: DocText): DocText => (t.runs.some((r) => r.rev) ? decide(t, true) : t);

/**
 * The result's references: the base document's, then those only the other one has (with a new
 * id if theirs is taken). Gives the other document's reference ids mapped to the result's.
 */
function joinReferences(base: Reference[], other: Reference[]): { refs: Reference[]; map: Map<string, string> } {
  const refs = [...base];
  const map = new Map<string, string>();
  for (const r of other) {
    const same = findDuplicate(refs, r) ?? refs.find((x) => x.id === r.id && x.title === r.title);
    if (same) { map.set(r.id, same.id); continue; }
    const id = refs.some((x) => x.id === r.id) ? newRefId(refs.map((x) => x.id)) : r.id;
    refs.push({ ...r, id });
    map.set(r.id, id);
  }
  return { refs, map };
}

/** Builds the result: characters from either document, objects from the other copied in with new ids. */
class Builder {
  cells: Cell[] = [];
  objects: Record<number, DocObject>;
  private next: number;
  private copied = new Map<number, number>();

  constructor(base: DocText, private other: DocText, private refMap: Map<string, string>, private baseDoc: 0 | 1) {
    this.objects = { ...base.objects };
    this.next = nextObjectId(base);
  }

  /** A character, marked as inserted or deleted (or with its own mark when `rev` is null). */
  push(c: Cell, rev: string | undefined | null): void {
    let run: TextRun = c.run;
    if (rev !== null) run = { ...run, rev };
    if (c.doc !== this.baseDoc) {
      // the other document's comments aren't brought over
      if (run.cmt) { const { cmt: _c, ...r } = run; run = r; }
      if (run.obj !== undefined) run = { ...run, obj: this.copy(run.obj) };
    }
    if (!run.rev) { const { rev: _r, ...r } = run; run = r; }
    this.cells.push({ ...c, run });
  }

  /** The other document's object `id` as one of the result's (with what it holds). */
  private copy(id: number): number {
    const had = this.copied.get(id);
    if (had !== undefined) return had;
    const o = this.other.objects[id];
    const nid = this.next++;
    this.copied.set(id, nid);
    if (!o) return nid;
    let c: DocObject = structuredClone(o);
    if (c.kind === 'cite') c = { ...c, refs: c.refs.map((r) => this.refMap.get(r) ?? r) };
    if (c.kind === 'table') {
      for (const inner of innerObjects(o)) this.copy(inner);
      c = { ...c, table: { ...c.table, rows: c.table.rows.map((row) => row.map((cell) => ({ ...cell, runs: cell.runs.map((r) => (r.obj !== undefined ? { ...r, obj: this.copied.get(r.obj) ?? r.obj } : r)) }))) } };
    }
    this.objects[nid] = c;
    return nid;
  }

  /** The runs and paragraphs: each paragraph takes the settings of the paragraph its end came from. */
  text(docs: [DocText, DocText], lastPara: ParaStyle): { runs: TextRun[]; paras: ParaStyle[] } {
    const runs = rt.normalizeRuns(this.cells.map((c) => ({ ...c.run, text: c.ch })));
    const paras: ParaStyle[] = [];
    for (const c of this.cells) if (c.ch === '\n' && c.run.obj === undefined) paras.push({ ...(docs[c.doc].paras[c.para] ?? {}) });
    paras.push({ ...lastPara });
    return { runs, paras: fitParas(paras, paraCount(rt.plainText(runs))) };
  }
}

/**
 * Review > Compare: the revised document, with what changed since the original marked as
 * tracked changes by `author`. Both are compared as they read with their own tracked changes
 * accepted. Gives the new document and how many changes were found.
 */
export function compareDocuments(original: DocText, revised: DocText, opts: CompareOptions): { doc: DocText; changes: number } {
  const level = opts.level ?? 'word';
  const A = acceptedText(original), B = acceptedText(revised);
  const ca = cellsOf(A, 0), cb = cellsOf(B, 1);
  const ta = tokensOf(ca, objectKeys(A), level), tb = tokensOf(cb, objectKeys(B), level);
  const ops = tidy(tokenDiff(ta, tb));
  const { refs, map } = joinReferences(B.references ?? [], A.references ?? []);
  const out = new Builder(B, A, map, 1);
  const who = { author: opts.author, date: opts.date ?? revisionDate() };
  const ins = revText({ kind: 'ins', ...who }), del = revText({ kind: 'del', ...who });
  let i = 0, j = 0;
  for (const op of ops) {
    if (op === 'eq') { const t = tb[j++]; i++; for (let k = t.start; k < t.end; k++) out.push(cb[k], undefined); }
    else if (op === 'del') { const t = ta[i++]; for (let k = t.start; k < t.end; k++) out.push(ca[k], del); }
    else { const t = tb[j++]; for (let k = t.start; k < t.end; k++) out.push(cb[k], ins); }
  }
  const { runs, paras } = out.text([A, B], B.paras[B.paras.length - 1] ?? {});
  const doc: DocText = { ...B, runs, paras, objects: out.objects, track: undefined };
  if (refs.length) doc.references = refs;
  return { doc, changes: changesIn(runs).length };
}

/** A document as the text before any of its tracked changes (its base), with what each change did there. */
interface Slots {
  /** The base text's characters (some marked deleted). */
  base: Cell[];
  /** What was inserted (tracked) before each base character, and after the last (one more than base). */
  gaps: Cell[][];
}

function slotsOf(cells: Cell[]): Slots {
  const base: Cell[] = [];
  const gaps: Cell[][] = [[]];
  for (const c of cells) {
    if (parseRev(c.run.rev)?.kind === 'ins') gaps[gaps.length - 1].push(c);
    else { base.push(c); gaps.push([]); }
  }
  return { base, gaps };
}

const gapText = (g: Cell[]) => g.map((c) => c.ch).join('');

/**
 * Review > Combine: the original with its tracked changes, and the revised copy's put in with
 * theirs. The revised copy's changes made without tracking are marked as `author`'s. Gives the
 * new document and how many changes it has.
 */
export function combineDocuments(original: DocText, revised: DocText, opts: CompareOptions): { doc: DocText; changes: number } {
  const level = opts.level ?? 'word';
  const ca = cellsOf(original, 0), cb = cellsOf(revised, 1);
  const so = slotsOf(ca), sr = slotsOf(cb);
  const ta = tokensOf(so.base, objectKeys(original), level), tb = tokensOf(sr.base, objectKeys(revised), level);
  const ops = tidy(tokenDiff(ta, tb));
  const { refs, map } = joinReferences(original.references ?? [], revised.references ?? []);
  const out = new Builder(original, revised, map, 0);
  const who = { author: opts.author, date: opts.date ?? revisionDate() };
  const ins = revText({ kind: 'ins', ...who }), del = revText({ kind: 'del', ...who });
  const isDel = (c: Cell) => parseRev(c.run.rev)?.kind === 'del';
  // what each copy inserted before a base character: both, unless they inserted the same
  const gaps = (go: Cell[] | null, gr: Cell[] | null) => {
    for (const c of go ?? []) out.push(c, null);
    if (gr && (!go || gapText(gr) !== gapText(go))) for (const c of gr) out.push(c, null);
  };
  let i = 0, j = 0;
  for (const op of ops) {
    if (op === 'eq') {
      const t = ta[i++], u = tb[j++];
      for (let k = 0; k < t.end - t.start; k++) {
        const co = so.base[t.start + k], cr = sr.base[u.start + k];
        gaps(so.gaps[t.start + k], sr.gaps[u.start + k]);
        // deleted by either: the original's mark first
        if (isDel(co)) out.push(co, null);
        else if (isDel(cr)) out.push(co, cr.run.rev);
        else out.push(co, null);
      }
    } else if (op === 'del') {
      // taken out of the revised copy without tracking: deleted by its reviewer
      const t = ta[i++];
      for (let k = t.start; k < t.end; k++) { gaps(so.gaps[k], null); out.push(so.base[k], isDel(so.base[k]) ? null : del); }
    } else {
      // put in without tracking: inserted by its reviewer (gone again if they then deleted it)
      const u = tb[j++];
      for (let k = u.start; k < u.end; k++) { gaps(null, sr.gaps[k]); if (!isDel(sr.base[k])) out.push(sr.base[k], ins); }
    }
  }
  gaps(so.gaps[so.base.length], sr.gaps[sr.base.length]);
  const { runs, paras } = out.text([original, revised], original.paras[original.paras.length - 1] ?? {});
  const doc: DocText = { ...original, runs, paras, objects: out.objects };
  if (refs.length) doc.references = refs;
  return { doc, changes: changesIn(runs).length };
}
