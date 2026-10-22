// Comments on slides in PowerPoint files. They are written as PowerPoint's comments of the
// standard (ECMA-376) kind, which every version of PowerPoint, Keynote, LibreOffice and Google
// Slides opens: a list of the people who wrote them (ppt/commentAuthors.xml) and each slide's
// comments in a part of its own, pinned to a point. Replies use PowerPoint 2013's threading, and
// the Resolved mark (which that kind of comment has no place for) goes in an extension of ours
// that other programs pass over. Files from PowerPoint 365, whose newer comments are kept
// elsewhere (ppt/comments/modernComment_*.xml), are read too.

import { initials, type CommentNote, type PinnedComment } from '../document/comments';
import { kid, kids, xml } from './ooxml';

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const P15_NS = 'http://schemas.microsoft.com/office/powerpoint/2012/main';
/** PowerPoint 2013's extension saying which comment a reply answers. */
const THREADING = '{C676402C-5697-4E1C-873F-D02D1690AC5C}';
/** Ours, marking a resolved comment. */
const DONE_EXT = '{4F3C2A7E-1D5B-4C8E-9A61-3B0E7D2F5C14}';
const CI_NS = 'urn:chem-illustrator:slides';

export const COMMENT_CT = {
  authors: 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml',
  comments: 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml',
};
export const COMMENT_REL = {
  authors: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  /** PowerPoint 365's. */
  modernAuthors: 'http://schemas.microsoft.com/office/2018/10/relationships/authors',
  modernComments: 'http://schemas.microsoft.com/office/2018/10/relationships/comments',
};

/** Comment positions are in PowerPoint's old "master units", eight to a point. */
const UNITS = 8;

/** A date as PowerPoint writes it on a comment (no time zone letter: it is read as UTC here). */
const pptDate = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(0).toISOString().slice(0, -1) : d.toISOString().slice(0, -1);
};

/**
 * The comment parts for a deck: the authors' list (null when no slide has comments) and each
 * slide's list of comments (null for a slide without).
 */
export function writeSlideComments(slides: (PinnedComment[] | undefined)[]): { authors: string | null; slides: (string | null)[] } {
  const authors = new Map<string, { id: number; last: number }>();
  const author = (name: string) => {
    const key = name || 'Author';
    let a = authors.get(key);
    if (!a) authors.set(key, (a = { id: authors.size, last: 0 }));
    return a;
  };
  const out = slides.map((list) => {
    if (!list?.length) return null;
    const cms: string[] = [];
    for (const c of list) {
      const pos = `<p:pos x="${Math.round(c.x * UNITS)}" y="${Math.round(c.y * UNITS)}"/>`;
      const note = (n: CommentNote, ext: string) => {
        const a = author(n.author);
        const idx = ++a.last;
        cms.push(`<p:cm authorId="${a.id}" dt="${pptDate(n.date)}" idx="${idx}">${pos}<p:text>${xml(n.text)}</p:text>${ext ? `<p:extLst>${ext}</p:extLst>` : ''}</p:cm>`);
        return { authorId: a.id, idx };
      };
      const done = c.done ? `<p:ext uri="${DONE_EXT}"><ci:done xmlns:ci="${CI_NS}"/></p:ext>` : '';
      // Without a time-zone bias PowerPoint reads dt as local time, so say it is UTC.
      const top = note(c, `<p:ext uri="${THREADING}"><p15:threadingInfo xmlns:p15="${P15_NS}" timeZoneBias="0"/></p:ext>${done}`);
      for (const r of c.replies ?? []) {
        note(r, `<p:ext uri="${THREADING}"><p15:threadingInfo xmlns:p15="${P15_NS}" timeZoneBias="0"><p15:parentCm authorId="${top.authorId}" idx="${top.idx}"/></p15:threadingInfo></p:ext>`);
      }
    }
    return `${HEAD}<p:cmLst xmlns:p="${P_NS}">${cms.join('')}</p:cmLst>`;
  });
  if (!authors.size) return { authors: null, slides: out };
  const list = [...authors].map(([name, a]) => `<p:cmAuthor id="${a.id}" name="${xml(name)}" initials="${xml(initials(name) || 'A')}" lastIdx="${a.last}" clrIdx="${a.id % 8}"/>`);
  return { authors: `${HEAD}<p:cmAuthorLst xmlns:p="${P_NS}">${list.join('')}</p:cmAuthorLst>`, slides: out };
}

/** PowerPoint's comment authors by id (from either kind of authors' list). */
export function readCommentAuthors(doc: Document | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of doc ? [...doc.documentElement.children] : []) {
    if (a.localName === 'cmAuthor' || a.localName === 'author') out.set(a.getAttribute('id') ?? '', a.getAttribute('name') ?? '');
  }
  return out;
}

/**
 * A date read from a comment, as an ISO date. PowerPoint's have no time zone letter: they are
 * local time when `bias` (its timeZoneBias, minutes to add to reach UTC) is given, else UTC.
 */
const isoDate = (s: string | null, bias = 0): string => {
  if (!s) return '';
  const zoned = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
  const d = new Date(zoned ? s : `${s}Z`);
  if (!zoned) d.setTime(d.getTime() + bias * 60000);
  return isNaN(d.getTime()) ? '' : d.toISOString();
};

/** A slide's comments of the standard kind (replies under their comment). */
export function readLegacyComments(doc: Document | null, authors: Map<string, string>, firstId = 0): PinnedComment[] {
  if (!doc) return [];
  const out: PinnedComment[] = [];
  const byKey = new Map<string, PinnedComment>();
  let id = firstId;
  for (const cm of kids(doc.documentElement, 'cm')) {
    const aid = cm.getAttribute('authorId') ?? '';
    const ext = kids(kid(cm, 'extLst'), 'ext');
    const threading = ext.map((e) => kid(e, 'threadingInfo')).find(Boolean);
    const bias = Number(threading?.getAttribute('timeZoneBias') ?? 0) || 0;
    const note: CommentNote = { author: authors.get(aid) ?? '', date: isoDate(cm.getAttribute('dt'), bias), text: kid(cm, 'text')?.textContent ?? '' };
    const parent = threading ? kid(threading, 'parentCm') : null;
    const up = parent ? byKey.get(`${parent.getAttribute('authorId')} ${parent.getAttribute('idx')}`) : undefined;
    if (up) { (up.replies ??= []).push(note); continue; }
    const pos = kid(cm, 'pos');
    const c: PinnedComment = { id: id++, x: Number(pos?.getAttribute('x') ?? 0) / UNITS || 0, y: Number(pos?.getAttribute('y') ?? 0) / UNITS || 0, ...note };
    if (ext.some((e) => e.getAttribute('uri') === DONE_EXT)) c.done = true;
    byKey.set(`${aid} ${cm.getAttribute('idx')}`, c);
    out.push(c);
  }
  return out;
}

/** The plain text of PowerPoint 365's comment text (its paragraphs on lines of their own). */
const bodyText = (el: Element | null): string => kids(kid(el, 'txBody'), 'p').map((p) => [...p.getElementsByTagName('*')].filter((e) => e.localName === 't').map((e) => e.textContent ?? '').join('')).join('\n');

/**
 * A slide's comments of PowerPoint 365's kind. They hang on the slide or an object rather than a
 * point; each is put at its own point if it has one, else down the slide's left edge.
 */
export function readModernComments(doc: Document | null, authors: Map<string, string>, firstId = 0): PinnedComment[] {
  if (!doc) return [];
  let id = firstId;
  return kids(doc.documentElement, 'cm').map((cm, i) => {
    const pos = kid(cm, 'pos');
    // (positions there are in EMUs, 12700 to a point)
    const at = pos ? { x: Number(pos.getAttribute('x') ?? 0) / 12700 || 0, y: Number(pos.getAttribute('y') ?? 0) / 12700 || 0 } : { x: 6, y: 6 + 24 * i };
    const replies = kids(kid(cm, 'replyLst'), 'reply').map((r) => ({ author: authors.get(r.getAttribute('authorId') ?? '') ?? '', date: isoDate(r.getAttribute('created')), text: bodyText(r) }));
    const c: PinnedComment = { id: id++, ...at, author: authors.get(cm.getAttribute('authorId') ?? '') ?? '', date: isoDate(cm.getAttribute('created')), text: bodyText(cm) };
    if (replies.length) c.replies = replies;
    if (cm.getAttribute('status') === 'resolved') c.done = true;
    return c;
  });
}
