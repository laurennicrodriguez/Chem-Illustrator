// Bookmarks (Insert > Bookmark, as in Word): named places in a document that links go to. Each is
// kept on its paragraph (ParaStyle.marks). A link to a heading puts a hidden bookmark on the
// heading (its name starts with an underscore, as Word's own do), so the link still finds the
// heading after its words change. Word's "_top" is the start of the document.

import type { ParaStyle } from '../model';
import * as rt from '../richtext';
import { fitParas, paraCount } from '../text/paragraphs';
import type { LinkPlace } from '../links';
import type { DocText } from './document';
import { tocEntries } from './toc';

/** Word's built-in bookmark for the start of the document. */
export const TOP = '_top';
/** The start of a hidden bookmark put on a heading for a link. */
const HEADING_MARK = '_Heading';

export interface Bookmark { name: string; para: number }

/** Every bookmark, in the order of the text. */
export function bookmarksOf(t: Pick<DocText, 'paras'>): Bookmark[] {
  const out: Bookmark[] = [];
  t.paras.forEach((p, i) => { for (const name of p?.marks ?? []) out.push({ name, para: i }); });
  return out;
}

/** The paragraph a bookmark is on (0 for _top), or -1 if there is no such bookmark. */
export function bookmarkPara(t: Pick<DocText, 'paras'>, name: string): number {
  if (name.toLowerCase() === TOP) return 0;
  const low = name.toLowerCase();
  return t.paras.findIndex((p) => p?.marks?.some((m) => m.toLowerCase() === low));
}

/** The paragraphs with one bookmark more or fewer. */
function withMarks(t: DocText, para: number, f: (marks: string[]) => string[]): ParaStyle[] {
  const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
  const p = { ...paras[para] };
  const marks = f(p.marks ?? []);
  if (marks.length) p.marks = marks; else delete p.marks;
  paras[para] = p;
  return paras;
}

/** Add a bookmark to a paragraph (one of the same name elsewhere moves here, as in Word). */
export function addBookmark(t: DocText, para: number, name: string): DocText {
  const t2 = removeBookmark(t, name);
  return { ...t2, paras: withMarks(t2, para, (m) => [...m, name]) };
}

export function removeBookmark(t: DocText, name: string): DocText {
  const low = name.toLowerCase();
  if (!t.paras.some((p) => p?.marks?.some((m) => m.toLowerCase() === low))) return t;
  return { ...t, paras: t.paras.map((p) => {
    if (!p?.marks?.some((m) => m.toLowerCase() === low)) return p;
    const marks = p.marks.filter((m) => m.toLowerCase() !== low);
    const { marks: _m, ...rest } = p;
    return marks.length ? { ...rest, marks } : rest;
  }) };
}

/** The places in a document a link can go to: the top, the headings, and the bookmarks you named. */
export function docPlaces(t: DocText): LinkPlace[] {
  const out: LinkPlace[] = [{ link: `#${TOP}`, label: 'Top of the document' }];
  const heads = tocEntries(t, 3);
  if (heads.length) {
    out.push({ link: '', label: 'Headings' });
    for (const h of heads) {
      const hidden = t.paras[h.para]?.marks?.find((m) => m.startsWith(HEADING_MARK));
      out.push({ link: hidden ? `#${hidden}` : `#heading:${h.para}`, label: h.text.length > 70 ? `${h.text.slice(0, 68)}…` : h.text, depth: h.level });
    }
  }
  const named = bookmarksOf(t).filter((b) => !b.name.startsWith('_'));
  if (named.length) {
    out.push({ link: '', label: 'Bookmarks' });
    for (const b of named) out.push({ link: `#${b.name}`, label: b.name, depth: 1 });
  }
  return out;
}

/**
 * A place picked in the link window, as a link to keep: a heading gets its hidden bookmark
 * (the document comes back with it when one was added).
 */
export function placeLink(t: DocText, picked: string): { link: string; t: DocText } {
  const m = /^#heading:(\d+)$/.exec(picked);
  if (!m) return { link: picked, t };
  const para = Number(m[1]);
  const used = new Set(bookmarksOf(t).map((b) => b.name));
  let n = 1;
  while (used.has(`${HEADING_MARK}${n}`)) n++;
  const name = `${HEADING_MARK}${n}`;
  return { link: `#${name}`, t: addBookmark(t, para, name) };
}

/** A place's name for tooltips: the heading's words, or the bookmark's name. */
export function placeName(t: DocText, link: string): string | null {
  const name = link.slice(1);
  if (name.toLowerCase() === TOP) return 'Top of the document';
  const para = bookmarkPara(t, name);
  if (para < 0) return null;
  if (!name.startsWith('_')) return `Bookmark ${name}`;
  const h = tocEntries(t, 9).find((e) => e.para === para);
  return h ? `Heading “${h.text}”` : name;
}
