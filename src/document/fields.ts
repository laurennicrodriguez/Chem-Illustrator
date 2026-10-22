// Fields (Insert > Quick Parts > Field, Insert > Date and Time, and cross-references to bookmarks),
// as Word's fields: a piece of text the document works out for itself. The date and time (in a
// Word date picture such as "MMMM d, yyyy"), the document's properties (title, author…), the file's
// name, the page number and the number of pages, and a bookmark's text, page or place ("above" or
// "below"). Each is saved as the Word field it is (DATE \@ "…", AUTHOR, REF Results \h…), so Word
// updates it too, and Word's come back as fields.

import type { ParaStyle, TextRun } from '../model';

/** The fields offered, by Word's names. */
export type FieldCode = 'date' | 'time' | 'createdate' | 'savedate' | 'printdate' | 'author' | 'title' | 'subject' | 'keywords' | 'company' | 'filename' | 'page' | 'numpages' | 'ref' | 'pageref' | 'abovebelow';

/** A document's properties (File > Info, Insert > Quick Parts > Document Property), saved in Word's docProps. */
export interface DocProps {
  title?: string;
  subject?: string;
  author?: string;
  company?: string;
  keywords?: string;
  /** When the document was first made and last saved (ISO dates). */
  created?: string;
  saved?: string;
}

/** A field as it sits in the text. `format` is a date picture; `target` a bookmark's name. */
export interface FieldObj { kind: 'field'; code: FieldCode; format?: string; target?: string }

/** What fields need from outside the document: the file's name and the time now. */
export const fieldEnv: { fileName: string; now: () => Date } = { fileName: '', now: () => new Date() };

/** The fields on Insert > Quick Parts > Field, with what each shows. */
export const FIELD_LIST: { code: FieldCode; name: string; word: string; help: string }[] = [
  { code: 'date', name: 'Date', word: 'DATE', help: 'Today\'s date (it changes each day the document is opened)' },
  { code: 'time', name: 'Time', word: 'TIME', help: 'The time now' },
  { code: 'createdate', name: 'Create Date', word: 'CREATEDATE', help: 'When the document was first made' },
  { code: 'savedate', name: 'Save Date', word: 'SAVEDATE', help: 'When the document was last saved' },
  { code: 'printdate', name: 'Print Date', word: 'PRINTDATE', help: 'When the document was last printed (today while it is open)' },
  { code: 'author', name: 'Author', word: 'AUTHOR', help: 'The document\'s author (File > Properties)' },
  { code: 'title', name: 'Title', word: 'TITLE', help: 'The document\'s title (File > Properties)' },
  { code: 'subject', name: 'Subject', word: 'SUBJECT', help: 'The document\'s subject' },
  { code: 'keywords', name: 'Keywords', word: 'KEYWORDS', help: 'The document\'s keywords' },
  { code: 'company', name: 'Company', word: 'DOCPROPERTY Company', help: 'The company or institution' },
  { code: 'filename', name: 'File Name', word: 'FILENAME', help: 'The name of the file' },
  { code: 'page', name: 'Page', word: 'PAGE', help: 'The number of the page it is on' },
  { code: 'numpages', name: 'Number of Pages', word: 'NUMPAGES', help: 'How many pages the document has' },
  { code: 'ref', name: 'Bookmark Text', word: 'REF', help: 'The text of a bookmarked paragraph' },
  { code: 'pageref', name: 'Bookmark Page', word: 'PAGEREF', help: 'The page a bookmark is on' },
  { code: 'abovebelow', name: 'Above or Below', word: 'REF \\p', help: '"above" or "below", where the bookmark is from here' },
];

/** Word's Date and Time window's formats (each a Word date picture). */
export const DATE_FORMATS = [
  'M/d/yyyy', 'dddd, MMMM d, yyyy', 'MMMM d, yyyy', 'M/d/yy', 'yyyy-MM-dd', 'd-MMM-yy', 'M.d.yyyy', 'MMM. d, yy',
  'd MMMM yyyy', 'MMMM yy', 'MMM-yy', 'M/d/yyyy h:mm am/pm', 'M/d/yyyy h:mm:ss am/pm', 'h:mm am/pm', 'h:mm:ss am/pm', 'HH:mm', 'HH:mm:ss',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A date in a Word date picture: d dd ddd dddd (day), M MM MMM MMMM (month), yy yyyy (year), h hh
 * H HH (hour, 12 or 24), m mm (minutes), s ss (seconds), am/pm AM/PM; text in 'quotes' as it is.
 */
export function formatDate(d: Date, picture: string): string {
  let out = '';
  const pm = /am\/pm/i.test(picture);
  for (let i = 0; i < picture.length;) {
    const ch = picture[i];
    if (ch === "'") {
      const end = picture.indexOf("'", i + 1);
      out += picture.slice(i + 1, end < 0 ? picture.length : end);
      i = end < 0 ? picture.length : end + 1;
      continue;
    }
    const ap = /^am\/pm/i.exec(picture.slice(i));
    if (ap) { const up = ap[0][0] === 'A'; out += d.getHours() < 12 ? (up ? 'AM' : 'am') : up ? 'PM' : 'pm'; i += 5; continue; }
    let n = 1;
    while (picture[i + n] === ch) n++;
    const pad = (v: number, w: number) => String(v).padStart(w, '0');
    switch (ch) {
      case 'd': out += n >= 4 ? DAYS[d.getDay()] : n === 3 ? DAYS[d.getDay()].slice(0, 3) : pad(d.getDate(), n); break;
      case 'M': out += n >= 4 ? MONTHS[d.getMonth()] : n === 3 ? MONTHS[d.getMonth()].slice(0, 3) : pad(d.getMonth() + 1, n); break;
      case 'y': out += n >= 3 ? String(d.getFullYear()) : pad(d.getFullYear() % 100, 2); break;
      case 'h': { const h = d.getHours() % 12 || 12; out += pad(pm ? h : h, Math.min(2, n)); break; }
      case 'H': out += pad(d.getHours(), Math.min(2, n)); break;
      case 'm': out += pad(d.getMinutes(), Math.min(2, n)); break;
      case 's': out += pad(d.getSeconds(), Math.min(2, n)); break;
      default: out += ch.repeat(n);
    }
    i += n;
  }
  return out;
}

/** Word's own date picture for a field when none is given. */
export function defaultPicture(code: FieldCode): string {
  return code === 'time' ? 'h:mm am/pm' : 'M/d/yyyy';
}

/** What a document needs to show its fields. */
export interface FieldDoc {
  runs: TextRun[];
  paras: ParaStyle[];
  props?: DocProps;
}

/** The paragraph each bookmark is on (lower-case names). */
function marksOf(t: FieldDoc): Map<string, number> {
  const out = new Map<string, number>();
  t.paras.forEach((p, i) => { for (const m of p?.marks ?? []) if (!out.has(m.toLowerCase())) out.set(m.toLowerCase(), i); });
  return out;
}

/** Where each paragraph starts in the text, for finding a paragraph's words. */
function paraTexts(runs: TextRun[]): string[] {
  let text = '';
  for (const r of runs) text += r.obj !== undefined ? '' : r.text;
  return text.split('\n');
}

/**
 * What a field shows. `para` is the paragraph it is in; `pages` (when laid out) each paragraph's
 * page number, and `pageCount` how many pages there are.
 */
export function fieldText(o: FieldObj, t: FieldDoc, para: number, pages?: (p: number) => string, pageCount?: number, cache?: { marks?: Map<string, number>; texts?: string[] }): string {
  const props = t.props ?? {};
  const date = (iso: string | undefined) => {
    const d = iso ? new Date(iso) : fieldEnv.now();
    return formatDate(Number.isFinite(d.getTime()) ? d : fieldEnv.now(), o.format || defaultPicture(o.code));
  };
  switch (o.code) {
    case 'date': case 'time': case 'printdate': return date(undefined);
    case 'createdate': return date(props.created);
    case 'savedate': return date(props.saved);
    case 'author': return props.author ?? '';
    case 'title': return props.title ?? '';
    case 'subject': return props.subject ?? '';
    case 'keywords': return props.keywords ?? '';
    case 'company': return props.company ?? '';
    case 'filename': return fieldEnv.fileName;
    case 'page': return pages?.(para) || '1';
    case 'numpages': return String(Math.max(1, pageCount ?? 1));
  }
  const marks = cache ? (cache.marks ??= marksOf(t)) : marksOf(t);
  const at = o.target ? marks.get(o.target.toLowerCase()) : undefined;
  if (at === undefined) return 'Error! Bookmark not defined.';
  if (o.code === 'pageref') return pages?.(at) || '1';
  if (o.code === 'abovebelow') return at < para || (at === para) ? 'above' : 'below';
  const texts = cache ? (cache.texts ??= paraTexts(t.runs)) : paraTexts(t.runs);
  return (texts[at] ?? '').trim();
}

/** Does showing this field need the pages laid out? */
export const needsPages = (o: FieldObj): boolean => o.code === 'page' || o.code === 'numpages' || o.code === 'pageref';

/** A field's Word instruction (as it goes between Word's field characters). */
export function fieldInstr(o: FieldObj): string {
  const pic = o.format && ['date', 'time', 'createdate', 'savedate', 'printdate'].includes(o.code) ? ` \\@ "${o.format}"` : '';
  switch (o.code) {
    case 'date': return ` DATE${pic} `;
    case 'time': return ` TIME${pic} `;
    case 'createdate': return ` CREATEDATE${pic} `;
    case 'savedate': return ` SAVEDATE${pic} `;
    case 'printdate': return ` PRINTDATE${pic} `;
    case 'author': return ' AUTHOR ';
    case 'title': return ' TITLE ';
    case 'subject': return ' SUBJECT ';
    case 'keywords': return ' KEYWORDS ';
    case 'company': return ' DOCPROPERTY Company ';
    case 'filename': return ' FILENAME ';
    case 'page': return ' PAGE ';
    case 'numpages': return ' NUMPAGES ';
    case 'ref': return ` REF ${o.target ?? ''} \\h `;
    case 'pageref': return ` PAGEREF ${o.target ?? ''} \\h `;
    case 'abovebelow': return ` REF ${o.target ?? ''} \\p \\h `;
  }
}

/** A Word field instruction as one of ours, or null for any other field. */
export function parseFieldInstr(instr: string): FieldObj | null {
  const s = instr.trim();
  const pic = /\\@\s*"([^"]*)"/.exec(s)?.[1] ?? /\\@\s*(\S+)/.exec(s)?.[1];
  const withPic = (code: FieldCode): FieldObj => (pic ? { kind: 'field', code, format: pic } : { kind: 'field', code });
  const word = /^(\S+)/.exec(s)?.[1]?.toUpperCase() ?? '';
  switch (word) {
    case 'DATE': return withPic('date');
    case 'TIME': return withPic('time');
    case 'CREATEDATE': return withPic('createdate');
    case 'SAVEDATE': return withPic('savedate');
    case 'PRINTDATE': return withPic('printdate');
    case 'AUTHOR': return { kind: 'field', code: 'author' };
    case 'TITLE': return { kind: 'field', code: 'title' };
    case 'SUBJECT': return { kind: 'field', code: 'subject' };
    case 'KEYWORDS': return { kind: 'field', code: 'keywords' };
    case 'FILENAME': return { kind: 'field', code: 'filename' };
    case 'PAGE': return { kind: 'field', code: 'page' };
    case 'NUMPAGES': return { kind: 'field', code: 'numpages' };
    case 'DOCPROPERTY': return /^DOCPROPERTY\s+"?Company"?/i.test(s) ? { kind: 'field', code: 'company' } : null;
    case 'PAGEREF': { const m = /^PAGEREF\s+(\S+)/i.exec(s); return m ? { kind: 'field', code: 'pageref', target: m[1] } : null; }
    case 'REF': {
      const m = /^REF\s+(\S+)/i.exec(s);
      if (!m) return null;
      return { kind: 'field', code: /\\p\b/i.test(s) && !/\\[nrw]\b/i.test(s) ? 'abovebelow' : 'ref', target: m[1] };
    }
  }
  return null;
}
