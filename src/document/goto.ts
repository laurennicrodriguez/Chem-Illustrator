// Home > Find > Go To (Ctrl+G, F5) and Home > Select, as in Word. Go To finds a page, section, line,
// bookmark, comment, footnote, endnote, field, table, picture, equation or heading by its number
// (3), a step from where the caret is (+2, −1), or for a bookmark its name. Select Text with
// Similar Formatting finds every stretch of text that looks like the text at the caret.

import type { TextRun } from '../model';
import * as rt from '../richtext';
import { paraRange } from '../text/paragraphs';
import type { DocLayout } from './doc-layout';
import { objectOffsets, objectsInText, type DocText } from './document';
import { bookmarkPara } from './bookmarks';
import { sectionsOf } from './sections';
import { tocEntries } from './toc';

export type GoToKind = 'page' | 'section' | 'line' | 'bookmark' | 'comment' | 'footnote' | 'endnote' | 'field' | 'table' | 'graphic' | 'equation' | 'heading';

export const GO_TO_KINDS: [GoToKind, string][] = [
  ['page', 'Page'], ['section', 'Section'], ['line', 'Line'], ['bookmark', 'Bookmark'], ['comment', 'Comment'], ['footnote', 'Footnote'], ['endnote', 'Endnote'],
  ['field', 'Field'], ['table', 'Table'], ['graphic', 'Graphic'], ['equation', 'Equation'], ['heading', 'Heading'],
];

/** The places of one kind in the document, in order (offsets into the text). */
export function placesOf(kind: GoToKind, t: DocText, lay: DocLayout | null): number[] {
  const text = rt.plainText(t.runs);
  const at = objectOffsets(t.runs);
  const objs = (f: (o: DocText['objects'][number]) => boolean) => [...new Set(objectsInText(t.runs))].filter((id) => { const o = t.objects[id]; return !!o && f(o); }).map((id) => at.get(id)!).sort((a, b) => a - b);
  switch (kind) {
    case 'page': return lay ? lay.pages.map((p) => lay.text.lines[p.first]?.start ?? text.length) : [0];
    case 'line': return lay ? lay.text.lines.map((l) => l.start) : [0];
    case 'section': return sectionsOf(t).map((s) => paraRange(text, s.first).start);
    case 'heading': return tocEntries(t, 9).map((h) => paraRange(text, h.para).start);
    case 'comment': {
      const out: number[] = [];
      let off = 0, prev = '';
      for (const r of t.runs) { if (r.cmt && r.cmt !== prev) out.push(off); prev = r.cmt ?? ''; off += r.text.length; }
      return out;
    }
    case 'footnote': return objs((o) => o.kind === 'note' && !o.end);
    case 'endnote': return objs((o) => o.kind === 'note' && !!o.end);
    case 'field': return objs((o) => ['field', 'seq', 'ref', 'cite', 'toc', 'tof', 'bib'].includes(o.kind));
    case 'table': return objs((o) => o.kind === 'table');
    case 'graphic': return objs((o) => o.kind === 'drawing' || o.kind === 'picture' || o.kind === 'textbox');
    case 'equation': return objs((o) => o.kind === 'math');
    case 'bookmark': return [];
  }
}

/**
 * Where Go To goes: for a number, that one (from 1); for +n or −n, n on from the caret (the next or
 * the one before when just + or −); for a bookmark, the name. Null when there is no such place.
 */
export function goToOffset(kind: GoToKind, input: string, t: DocText, lay: DocLayout | null, caret: number): number | null {
  const s = input.trim();
  if (kind === 'bookmark') {
    const p = bookmarkPara(t, s);
    return p < 0 ? null : paraRange(rt.plainText(t.runs), p).start;
  }
  const places = placesOf(kind, t, lay);
  if (!places.length) return null;
  // the one the caret is in (or the last before it)
  let here = -1;
  for (let i = 0; i < places.length; i++) if (places[i] <= caret) here = i;
  const rel = /^([+\-−])\s*(\d*)$/.exec(s);
  let i: number;
  if (!s) i = kind === 'page' || kind === 'line' || kind === 'section' ? here : places.findIndex((p) => p > caret);
  else if (rel) {
    const n = rel[2] ? Number(rel[2]) : 1;
    // stepping back from inside one counts from the start of it
    i = rel[1] === '+' ? here + n : (here >= 0 && places[here] === caret ? here - n : here - n + (kind === 'page' || kind === 'line' || kind === 'section' ? 0 : 1));
  } else if (/^\d+$/.test(s)) i = Number(s) - 1;
  else return null;
  if (i < 0 || i >= places.length) return null;
  return places[i];
}

/** The look of text compared by Select Text with Similar Formatting. */
const LOOK = ['font', 'size', 'bold', 'italic', 'underline', 'color', 'highlight', 'strike', 'sub', 'sup', 'smallCaps', 'allCaps', 'cstyle', 'formula'] as const;

function lookKey(r: Partial<TextRun>, base: { font?: string; size?: number }): string {
  return LOOK.map((k) => {
    const v = r[k] ?? (k === 'font' ? base.font : k === 'size' ? base.size : undefined);
    return v === undefined || v === false ? '' : String(v);
  }).join('|');
}

/**
 * Home > Select > Select Text with Similar Formatting: the stretches of text (not figures or line
 * breaks) that look like the text at `at`, joined where they touch. `base` fills in what a run
 * leaves to its paragraph style.
 */
export function similarRanges(runs: TextRun[], at: number, base: (para: number) => { font?: string; size?: number }): [number, number][] {
  let off = 0, para = 0;
  let want: string | null = null;
  const pieces: { a: number; b: number; key: string }[] = [];
  for (const r of runs) {
    for (const piece of r.text.split(/(\n)/)) {
      if (!piece) continue;
      if (piece === '\n') { off += 1; para++; continue; }
      const key = r.obj !== undefined ? '' : lookKey(r, base(para));
      if (key) pieces.push({ a: off, b: off + piece.length, key });
      if (want === null && at >= off && at <= off + piece.length && key) want = key;
      off += piece.length;
    }
  }
  if (want === null) want = pieces.find((p) => p.a >= at)?.key ?? null;
  const out: [number, number][] = [];
  for (const p of pieces) {
    if (p.key !== want) continue;
    const last = out[out.length - 1];
    if (last && (last[1] === p.a || last[1] + 1 === p.a)) last[1] = p.b;
    else out.push([p.a, p.b]);
  }
  return out;
}
