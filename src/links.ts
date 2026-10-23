// Links in text: to web pages, DOIs, e-mail addresses, files, and places in the same file. A
// link is a run attribute (TextRun.link) holding where it goes, so it is cut, pasted, undone
// and saved with the text like any other formatting; a sheet's cell has its own (Cell.link).
//
// Where a link goes, as kept:
//   https://…, http://…, ftp://…   a web page (a DOI is kept as https://doi.org/…)
//   mailto:…                       an e-mail address
//   file:///… or a plain path      a file on this computer (or a path next to the file)
//   #name                          a bookmark in this document
//   #slide=7, #next, #prev, #first, #last, #return, #end   a slide in this deck (by its id), or one of the show's own jumps
//   #Sheet1!A1                     a cell in this workbook
// Pure functions: no screen, no files, so every rule can be tested on its own.

import type { TextRun } from './model';
import * as rt from './richtext';
import { caretPos, offsetAt, type TextLayout } from './text/layout';

/** The colour Word, PowerPoint and Excel give links (their Hyperlink style). */
export const LINK_COLOUR = '#0563c1';

export type LinkKind = 'web' | 'doi' | 'mail' | 'file' | 'place';

const DOI_HOST = /^https?:\/\/(dx\.)?doi\.org\//i;
/** A DOI on its own: 10., a registrant code, a slash, then anything but spaces. */
const BARE_DOI = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;

export function linkKind(link: string): LinkKind {
  if (link.startsWith('#')) return 'place';
  if (DOI_HOST.test(link)) return 'doi';
  if (/^mailto:/i.test(link)) return 'mail';
  if (/^(https?|ftp):\/\//i.test(link)) return 'web';
  return 'file';
}

/** The DOI a link goes to, if it is one (10.1021/…). */
export function doiOf(link: string): string | null {
  const m = BARE_DOI.exec(link.trim());
  return m ? m[1] : null;
}

/**
 * Where a link goes, from what was typed in the link window or found in the text: a DOI in any
 * of its usual forms becomes its https://doi.org/ address, www.… gets https://, an e-mail
 * address gets mailto:, and a Windows or Unix path stays a path. Null for nothing usable.
 */
export function normalizeLink(typed: string, kind?: LinkKind): string | null {
  let s = typed.trim();
  if (!s) return null;
  if (kind === 'place') return s.startsWith('#') ? s : `#${s}`;
  if (kind === 'file') return s.replace(/^"(.*)"$/, '$1');
  const doi = doiOf(s);
  if (doi) return `https://doi.org/${doi}`;
  if (kind === 'doi') return /^10\./.test(s) ? `https://doi.org/${s}` : null;
  if (kind === 'mail' || (!/^\w+:/.test(s) && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s))) return /^mailto:/i.test(s) ? s : `mailto:${s}`;
  if (s.startsWith('#')) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  if (/^[a-z][\w+.-]*:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
  // a path: C:\…, \\server\…, /…, ~/…, ./… or ../…
  if (/^([a-z]:[\\/]|\\\\|\/|~\/|\.\.?[\\/])/i.test(s)) return s;
  if (kind === 'web' || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`;
  return s;
}

/** A link as people read it: the DOI, the address without mailto:, the file's path. */
export function describeLink(link: string, places?: (place: string) => string | null): string {
  const doi = doiOf(link);
  if (doi) return `DOI ${doi}`;
  if (/^mailto:/i.test(link)) return link.slice(7);
  if (link.startsWith('#')) return places?.(link) ?? link.slice(1);
  if (/^file:\/\//i.test(link)) return filePath(link);
  return link;
}

/** A file link's path on this computer (file:///C:/x.pdf → C:/x.pdf). */
export function filePath(link: string): string {
  if (!/^file:\/\//i.test(link)) return link;
  let p = link.replace(/^file:\/\/(localhost)?/i, '');
  try { p = decodeURIComponent(p); } catch { /* left as written */ }
  // file:///C:/… is C:/… on Windows
  if (/^\/[a-z]:/i.test(p)) p = p.slice(1);
  return p;
}

/** Text that a word processor turns into a link once it is typed (Word's AutoFormat as You Type). */
export function typedLink(word: string): string | null {
  const w = word.replace(/[.,;:!?)\]'"’”]+$/, '');
  if (w.length < 4) return null;
  if (/^(https?|ftp):\/\/[^\s/$.?#].\S*$/i.test(w)) return w;
  if (/^www\.[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(w)) return `https://${w}`;
  if (/^doi:10\.\d{4,9}\/\S+$/i.test(w)) return `https://doi.org/${doiOf(w)}`;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(w) && !/^\d/.test(w)) return `mailto:${w}`;
  return null;
}

/** The length of a typed link's text, without the punctuation after it (a full stop ends the sentence, not the link). */
export function typedLinkLength(word: string): number {
  return word.replace(/[.,;:!?)\]'"’”]+$/, '').length;
}

// ------------------------------------------------------------------ links in runs

export interface LinkSpan { start: number; end: number; link: string }

/** A place in the file a link can go to, as the link window lists it. */
export interface LinkPlace {
  /** The link that goes there (#name, #slide=3, #Sheet1!A1); empty for a heading of the list. */
  link: string;
  label: string;
  /** Indent in the list (levels of headings). */
  depth?: number;
}

/** Every link in the runs, each stretch of text with one link as one span. */
export function linkSpans(runs: TextRun[]): LinkSpan[] {
  const out: LinkSpan[] = [];
  let at = 0;
  for (const r of runs) {
    const end = at + r.text.length;
    if (r.link) {
      const last = out[out.length - 1];
      if (last && last.end === at && last.link === r.link) last.end = end;
      else out.push({ start: at, end, link: r.link });
    }
    at = end;
  }
  return out;
}

/**
 * The link at a place in the text: under the selection's first character, or with nothing
 * selected, the link the caret is inside or next to (just after a link counts, as in Word).
 */
export function linkAt(runs: TextRun[], start: number, end = start): LinkSpan | null {
  const spans = linkSpans(runs);
  if (end > start) return spans.find((s) => s.start <= start && s.end > start) ?? spans.find((s) => s.start < end && s.end > start) ?? null;
  return spans.find((s) => s.start < start && s.end > start) ?? spans.find((s) => s.end === start) ?? spans.find((s) => s.start === start) ?? null;
}

/** The link of the character at an offset (not the caret's neighbour: the character itself). */
export function linkOfChar(runs: TextRun[], i: number): string | undefined {
  let at = 0;
  for (const r of runs) {
    if (i < at + r.text.length) return r.link;
    at += r.text.length;
  }
  return undefined;
}

/** The look a link takes (Word's Hyperlink style: blue, underlined). */
export const LINK_LOOK: Partial<rt.RunStyle> = { color: LINK_COLOUR, underline: true };

/**
 * Make the text between two offsets a link, in the link look; `text` replaces it first (the
 * link window's "Text to display"), keeping the look of the text it replaces.
 */
export function setLink(runs: TextRun[], start: number, end: number, link: string, text?: string): { runs: TextRun[]; end: number } {
  let out = runs;
  if (text !== undefined && text !== rt.plainText(runs).slice(start, end)) {
    const style = rt.typingStyle(runs, start, end, {});
    out = rt.replaceRange(out, start, end, text ? [{ ...style, text }] : []);
    end = start + text.length;
  }
  return { runs: rt.applyStyle(out, start, end, { link, ...LINK_LOOK }), end };
}

/** Take the links off the text between two offsets, with their blue and underline. */
export function removeLink(runs: TextRun[], start: number, end: number): TextRun[] {
  const n = rt.plainText(runs).length;
  const mid = rt.sliceRuns(runs, start, end).map((r) => (r.link ? plainLook({ ...r }) : r));
  return rt.normalizeRuns([...rt.sliceRuns(runs, 0, start), ...mid, ...rt.sliceRuns(runs, end, n)]);
}

/** A run without its link, and without the link look when it has Word's own. */
export function plainLook<T extends Partial<TextRun>>(r: T): T {
  const o = { ...r };
  delete o.link;
  if (o.color?.toLowerCase() === LINK_COLOUR) { delete o.color; delete o.underline; }
  return o;
}

/** Point every link in some runs somewhere else (a slide's id after slides are read), or drop it (null). */
export function mapLinks(runs: TextRun[], f: (link: string) => string | null): TextRun[] {
  if (!runs.some((r) => r.link)) return runs;
  return rt.normalizeRuns(runs.map((r) => {
    if (!r.link) return r;
    const to = f(r.link);
    return to === r.link ? r : to ? { ...r, link: to } : plainLook(r);
  }));
}

// ------------------------------------------------------------------ places

/** A slide link's slide id (#slide=7). */
export function slideOfLink(link: string): number | null {
  const m = /^#slide=(\d+)$/.exec(link);
  return m ? Number(m[1]) : null;
}

/** Links to slides by their place (as read from a file) made into links to their ids here. */
export function slideIdLinks<T>(contents: T, ids: number[]): T {
  const json = JSON.stringify(contents);
  if (!json.includes('"#slide-n=')) return contents;
  return JSON.parse(json.replace(/"#slide-n=(\d+)"/g, (all, i) => (ids[Number(i)] !== undefined ? `"#slide=${ids[Number(i)]}"` : all)));
}

/** The slide-show jumps PowerPoint has without naming a slide. */
export const SHOW_JUMPS: Record<string, string> = { '#first': 'First slide', '#last': 'Last slide', '#next': 'Next slide', '#prev': 'Previous slide', '#return': 'Last slide viewed', '#end': 'End show' };

/** A link to a cell (#Sheet1!B4 or #'My sheet'!B4): the sheet's name and the cell. */
export function cellOfLink(link: string): { sheet: string | null; cell: string } | null {
  const m = /^#(?:(?:'((?:[^']|'')+)'|([^!'#]+))!)?\$?([A-Za-z]{1,3})\$?(\d{1,7})(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?$/.exec(link);
  if (!m) return null;
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2] ?? null;
  return { sheet: sheet === '' ? null : sheet, cell: `${m[3].toUpperCase()}${m[4]}` };
}

/** A cell link written as Excel writes a place (Sheet1!A1, quoted when the name needs it). */
export function cellLink(sheet: string, cell: string): string {
  return `#${/^[A-Za-z_][\w.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`}!${cell}`;
}

/** A bookmark name Word accepts: a letter first, then letters, digits and underscores, up to 40. */
export function bookmarkName(typed: string): string {
  let s = typed.trim().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+/, '');
  if (!/^\p{L}/u.test(s)) s = `B_${s}`;
  return s.slice(0, 40);
}

/**
 * The link under a point of laid-out text (x and y from the text's origin), or null when the
 * point isn't on linked text.
 */
export function linkAtPoint(lay: TextLayout, runs: TextRun[], x: number, y: number): LinkSpan | null {
  if (!runs.some((r) => r.link)) return null;
  for (const l of lay.lines) {
    if (y < l.y - l.ascent || y > l.y + l.descent) continue;
    for (const g of l.pieces) {
      if (x < g.x || x > g.x + g.w || g.decor) continue;
      const off = offsetAt(lay, x, y);
      const end = g.start + g.text.length;
      // the character the point is on: before the nearest caret place when that is right of the point
      let i = off > g.start && caretPos(lay, off).x > x ? off - 1 : off;
      i = Math.max(g.start, Math.min(end - 1, i));
      const link = linkOfChar(runs, i);
      if (!link) return null;
      return linkSpans(runs).find((s) => s.start <= i && s.end > i) ?? null;
    }
  }
  return null;
}

/** Where a HYPERLINK formula links to, when its address is written in it (=HYPERLINK("https://…", "shown")). */
export function linkOfFormula(input: string | undefined): string | null {
  const m = input ? /^=\s*HYPERLINK\s*\(\s*"((?:[^"]|"")*)"/i.exec(input) : null;
  return m ? normalizeLink(m[1].replace(/""/g, '"')) : null;
}

// ------------------------------------------------------------------ links in Office files

/**
 * A link as an Office file's relationship target: web and e-mail addresses as they are, a file
 * as a file: address (a path on its own stays relative to the file, with forward slashes).
 */
export function officeTarget(link: string): string {
  if (linkKind(link) !== 'file' || /^file:/i.test(link)) return link;
  const enc = (p: string) => encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
  if (/^[a-z]:[\\/]/i.test(link)) return `file:///${enc(link)}`;
  if (/^\\\\/.test(link)) return `file:${enc(link)}`;
  if (link.startsWith('/')) return `file://${enc(link)}`;
  return enc(link);
}

/** A link from an Office file's relationship target (the other way from officeTarget). */
export function linkFromTarget(target: string): string {
  const t = target.trim();
  if (/^[a-z][\w+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) return t;
  try { return decodeURI(t).replace(/%23/gi, '#'); } catch { return t; }
}
