// View > Outline View: each slide's title and the lines of its body text (or a title slide's
// subtitle), as an outline. Reading a slide into it and writing an edited outline back; a
// line's level is how far in it is (tabs at its start in the outline's text).

import type { Caption, Doc, ParaStyle } from '../model';

export interface OutlineLine { text: string; level: number }
export interface SlideOutline {
  /** The title (null: the slide has no title placeholder). */
  title: string | null;
  /** The body's lines (null: no body or subtitle placeholder). */
  body: OutlineLine[] | null;
}

const plain = (c: Caption) => c.runs.map((r) => r.text).join('');
const titleOf = (doc: Doc) => [...doc.captions.values()].find((c) => c.ph === 'title');
/** The body placeholder, or the subtitle on a title slide; the first, top left first, when there are two. */
const bodyOf = (doc: Doc) => [...doc.captions.values()].filter((c) => c.ph === 'body' || c.ph === 'subtitle').sort((a, b) => a.x - b.x || a.y - b.y)[0];

/** A slide's title and body lines. */
export function slideOutline(doc: Doc): SlideOutline {
  const t = titleOf(doc), b = bodyOf(doc);
  const body = b ? plain(b).split('\n').map((text, i) => ({ text, level: b.paras?.[i]?.level ?? 0 })) : null;
  // an empty body is no lines (not one empty line)
  return { title: t ? plain(t).replace(/\n/g, ' ') : null, body: body && body.length === 1 && !body[0].text ? [] : body };
}

/** Body lines as the outline's text: one a line, a tab in for each level. */
export const outlineText = (lines: OutlineLine[]): string => lines.map((l) => '\t'.repeat(l.level) + l.text).join('\n');

/** The outline's text back into lines (tabs, or four spaces, at a line's start are its level; at most eight levels). */
export function parseOutline(text: string): OutlineLine[] {
  if (!text) return [];
  return text.split('\n').map((line) => {
    const m = /^((?:\t| {4})*)/.exec(line)![1];
    const level = Math.min(8, (m.match(/\t/g)?.length ?? 0) + (m.match(/ {4}/g)?.length ?? 0));
    return { text: line.slice(m.length), level };
  });
}

/**
 * Write a title and body lines into a slide's placeholders (inside an edit of `doc`). Only what
 * changed is written, so a placeholder's own formatting stays when its text did not change.
 * Returns whether anything changed.
 */
export function applyOutline(doc: Doc, title: string | null, body: OutlineLine[] | null): boolean {
  const was = slideOutline(doc);
  let changed = false;
  const t = titleOf(doc);
  if (t && title !== null && title !== was.title) {
    doc.updateCaption(t.id, { runs: title ? [{ ...(t.runs[0] ?? {}), text: title }] : [] });
    changed = true;
  }
  const b = bodyOf(doc);
  if (b && body !== null && outlineText(body) !== outlineText(was.body ?? [])) {
    const style = b.runs[0] ? { ...b.runs[0] } : {};
    const text = body.map((l) => l.text).join('\n');
    // each line keeps its old paragraph's look (a bullet, for body text), at its new level
    const paras: ParaStyle[] = body.map((l, i) => {
      const old = b.paras?.[i] ?? b.paras?.[b.paras.length - 1] ?? (b.ph === 'body' ? { list: 'bullet' as const } : {});
      const p: ParaStyle = { ...old };
      if (l.level) p.level = l.level; else delete p.level;
      return p;
    });
    doc.updateCaption(b.id, { runs: text ? [{ ...style, text }] : [], paras: paras.length ? paras : b.ph === 'body' ? [{ list: 'bullet' }] : undefined });
    changed = true;
  }
  return changed;
}
