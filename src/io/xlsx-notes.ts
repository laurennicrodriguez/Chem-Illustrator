// Notes, comments and data validation in Excel files (ECMA-376 part 1, SpreadsheetML 18.7 and
// 18.3.1.32; Microsoft's [MS-XLSX] for threaded comments).
//
// A note is Excel's standard comment: its text in the sheet's comments part, and its yellow box
// in a VML drawing (the old drawing format Excel still uses for them), which says where it shows
// and whether it stays shown. A comment with replies is Excel 365's threaded comment: the
// conversation in a part of its own, its people in the workbook's list of persons, and a plain
// note of the whole conversation in the comments part for programs that know only notes (Excel
// links the two by giving that note the author "tc={the comment's id}").
//
// Data validation rules go in the sheet's dataValidations; Excel's newer copy in an extension
// (x14, used for lists on other sheets by Excel 2010) is read too.

import { kid, kids, xml } from './ooxml';
import type { Sheet } from '../sheet/workbook';
import type { CellNote } from '../sheet/notes';
import { noteText } from '../sheet/notes';
import type { CommentNote } from '../document/comments';
import { cellName, colOf, parseRange, rangeName, rowOf, Range, keyOf } from '../sheet/refs';
import { Validation, ValidationKind, ValidationOp, AlertStyle, limitNumber, limitText, newValidation } from '../sheet/validation';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const TC_NS = 'http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments';
const X14_NS = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const XM_NS = 'http://schemas.microsoft.com/office/excel/2006/main';

export const NOTES_CT = {
  comments: 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml',
  vml: 'application/vnd.openxmlformats-officedocument.vmlDrawing',
  threaded: 'application/vnd.ms-excel.threadedcomments+xml',
  persons: 'application/vnd.ms-excel.person+xml',
};

export const NOTES_REL = {
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  vml: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing',
  threaded: 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment',
  persons: 'http://schemas.microsoft.com/office/2017/10/relationships/person',
};

/** A new id in braces, as Excel writes its ids ({8C3A…}). */
export function newGuid(): string {
  const c = globalThis.crypto;
  const hex = c?.randomUUID ? c.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 3) | 8).toString(16);
  });
  return `{${hex.toUpperCase()}}`;
}

/** A date as a threaded comment holds it (no time zone letter: it is UTC, as Excel 365 writes it). */
const tcDate = (iso: string): string => {
  const d = new Date(iso);
  return (isNaN(d.getTime()) ? new Date() : d).toISOString().replace(/(\.\d{2})\dZ$/, '$1');
};

/** A threaded comment's date read back as an ISO date (UTC unless it says otherwise). */
const readTcDate = (s: string | null): string => {
  if (!s) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
  return isNaN(d.getTime()) ? '' : d.toISOString();
};

/** Text for a <t>, keeping spaces and line breaks. */
const tText = (s: string) => `<t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${xml(s)}</t>`;

// ---------------------------------------------------------------- writing notes and comments

/** The workbook's people (for threaded comments), shared by every sheet. */
export class Persons {
  private byName = new Map<string, string>();
  id(name: string): string {
    const key = name || 'Author';
    let id = this.byName.get(key);
    if (!id) this.byName.set(key, (id = newGuid()));
    return id;
  }
  get size(): number { return this.byName.size; }
  toXml(): string {
    const people = [...this.byName].map(([name, id]) => `<person displayName="${xml(name)}" id="${id}" userId="${xml(name)}" providerId="None"/>`).join('');
    return `<personList xmlns="${TC_NS}" xmlns:x="${MAIN}">${people}</personList>`;
  }
}

/** The parts for a sheet's notes and comments (null when it has none). */
export function notesParts(s: Sheet, sheetNo: number, persons: Persons): { comments: string; vml: string; threaded: string | null } | null {
  if (!s.notes.size) return null;
  const list = [...s.notes].sort((a, b) => rowOf(a[0]) - rowOf(b[0]) || colOf(a[0]) - colOf(b[0]));
  const authors: string[] = [];
  const authorNo = (name: string) => {
    let i = authors.indexOf(name);
    if (i < 0) { authors.push(name); i = authors.length - 1; }
    return i;
  };
  const comments: string[] = [];
  const threads: string[] = [];
  const shapes: string[] = [];
  list.forEach(([k, n], i) => {
    const r = rowOf(k), c = colOf(k);
    const ref = cellName(r, c);
    const bold = '<rPr><b/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr>';
    const plain = '<rPr><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr>';
    if (n.kind === 'comment') {
      const id = newGuid();
      const one = (note: CommentNote, extra: string) =>
        `<threadedComment ref="${ref}" dT="${tcDate(note.date)}" personId="${persons.id(note.author)}" id="${extra === '' ? id : newGuid()}"${extra}><text>${xml(note.text)}</text></threadedComment>`;
      threads.push(one(n, '').replace('><text>', `${n.done ? ' done="1"' : ''}><text>`));
      for (const rep of n.replies ?? []) threads.push(one(rep, ` parentId="${id}"`));
      const body = ['[Threaded comment]', '', 'Your version of Excel shows this comment as a note: changes made to it here are lost in newer versions.', '',
        'Comment:', `    ${n.text}`, ...(n.replies ?? []).flatMap((rep) => ['Reply:', `    ${rep.author ? rep.author + ': ' : ''}${rep.text}`])].join('\n');
      comments.push(`<comment ref="${ref}" authorId="${authorNo(`tc=${id}`)}"><text><r>${plain}${tText(body)}</r></text></comment>`);
    } else {
      const head = n.author ? `<r>${bold}${tText(n.author + ':')}</r><r>${plain}${tText('\n' + noteText(n))}</r>` : `<r>${plain}${tText(noteText(n))}</r>`;
      comments.push(`<comment ref="${ref}" authorId="${authorNo(n.author)}"><text>${head}</text></comment>`);
    }
    // the box, beside the cell, a little up (as Excel places a new note)
    const top = Math.max(0, r - 1);
    const visible = n.kind === 'note' && n.shown;
    shapes.push(
      `<v:shape id="_x0000_s${sheetNo * 1024 + 1 + i}" type="#_x0000_t202" style="position:absolute;margin-left:0;margin-top:0;width:108pt;height:59.25pt;z-index:${i + 1};visibility:${visible ? 'visible' : 'hidden'}" fillcolor="#ffffe1" o:insetmode="auto">` +
      '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
      '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
      `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${c + 1}, 15, ${top}, 10, ${c + 3}, 15, ${top + 4}, 4</x:Anchor>` +
      `<x:AutoFill>False</x:AutoFill><x:Row>${r}</x:Row><x:Column>${c}</x:Column>${visible ? '<x:Visible/>' : ''}</x:ClientData></v:shape>`,
    );
  });
  const commentsXml = `<comments xmlns="${MAIN}"><authors>${authors.map((a) => `<author>${xml(a)}</author>`).join('')}</authors><commentList>${comments.join('')}</commentList></comments>`;
  const vml = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${sheetNo}"/></o:shapelayout>` +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    `${shapes.join('')}</xml>`;
  const threaded = threads.length ? `<ThreadedComments xmlns="${TC_NS}" xmlns:x="${MAIN}">${threads.join('')}</ThreadedComments>` : null;
  return { comments: commentsXml, vml, threaded };
}

// ---------------------------------------------------------------- reading notes and comments

/** A comment's text (all its runs). */
function richText(el: Element | null): string {
  if (!el) return '';
  const t = kid(el, 't');
  if (t) return t.textContent ?? '';
  return kids(el, 'r').map((r) => kid(r, 't')?.textContent ?? '').join('');
}

/** Cells whose note Excel shows all the time, from the VML drawing (read as text: Excel's VML isn't always well-formed XML). */
export function shownNotes(vml: string | null): Set<number> {
  const out = new Set<number>();
  if (!vml) return out;
  for (const m of vml.matchAll(/<v:shape\b([^>]*)>([\s\S]*?)<\/v:shape>/g)) {
    const row = /<x:Row>\s*(\d+)\s*<\/x:Row>/.exec(m[2]), col = /<x:Column>\s*(\d+)\s*<\/x:Column>/.exec(m[2]);
    if (!row || !col) continue;
    if (/<x:Visible\s*\/?>/.test(m[2]) || /visibility:\s*visible/.test(m[1])) out.add(keyOf(Number(row[1]), Number(col[1])));
  }
  return out;
}

/**
 * The notes and comments of a sheet: its comments part, the cells whose notes stay shown, and
 * its threaded comments with the workbook's people.
 */
export function readNotes(comments: Document | null, shown: Set<number>, threaded: Document | null, persons: Document | null): Map<number, CellNote> {
  const out = new Map<number, CellNote>();
  const people = new Map<string, string>();
  if (persons) for (const p of Array.from(persons.getElementsByTagNameNS(TC_NS, 'person'))) people.set(p.getAttribute('id') ?? '', p.getAttribute('displayName') ?? '');
  // threaded comments: each top one with the replies that name it as their parent
  if (threaded) {
    const all = Array.from(threaded.getElementsByTagNameNS(TC_NS, 'threadedComment'));
    const tops = new Map<string, { key: number; note: CellNote }>();
    for (const t of all) {
      if (t.getAttribute('parentId')) continue;
      const R = parseRange(t.getAttribute('ref') ?? '');
      if (!R) continue;
      const note: CellNote = {
        kind: 'comment', author: people.get(t.getAttribute('personId') ?? '') ?? '', date: readTcDate(t.getAttribute('dT')),
        text: kid(t, 'text')?.textContent ?? '', ...(t.getAttribute('done') === '1' || t.getAttribute('done') === 'true' ? { done: true } : {}),
      };
      tops.set(t.getAttribute('id') ?? '', { key: keyOf(R.r1, R.c1), note });
    }
    for (const t of all) {
      const top = tops.get(t.getAttribute('parentId') ?? '');
      if (!top) continue;
      (top.note.replies ??= []).push({ author: people.get(t.getAttribute('personId') ?? '') ?? '', date: readTcDate(t.getAttribute('dT')), text: kid(t, 'text')?.textContent ?? '' });
    }
    for (const { key, note } of tops.values()) if (!out.has(key)) out.set(key, note);
  }
  if (comments) {
    const root = comments.documentElement;
    const authors = kids(kid(root, 'authors'), 'author').map((a) => a.textContent ?? '');
    for (const c of kids(kid(root, 'commentList'), 'comment')) {
      const R = parseRange(c.getAttribute('ref') ?? '');
      if (!R) continue;
      const key = keyOf(R.r1, R.c1);
      const author = authors[Number(c.getAttribute('authorId') ?? 0)] ?? '';
      // a threaded comment's plain copy: the comment itself is read above
      if (out.has(key) || author.startsWith('tc=')) continue;
      let text = richText(kid(c, 'text')).replace(/\r\n?/g, '\n');
      // Excel starts a note with its author's name in bold: that is the note's author, not its text
      if (author && text.startsWith(author + ':')) text = text.slice(author.length + 1).replace(/^\n/, '');
      out.set(key, { kind: 'note', author, date: '', text, ...(shown.has(key) ? { shown: true } : {}) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- data validation

const KIND_TO_XL: Record<ValidationKind, string> = { any: 'none', whole: 'whole', decimal: 'decimal', list: 'list', date: 'date', time: 'time', length: 'textLength', custom: 'custom' };
const XL_TO_KIND: Record<string, ValidationKind> = { none: 'any', whole: 'whole', decimal: 'decimal', list: 'list', date: 'date', time: 'time', textLength: 'length', custom: 'custom' };
const OPS: ValidationOp[] = ['between', 'notBetween', 'equal', 'notEqual', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual'];

/** A limit or list as Excel writes it in formula1/formula2 (null when it can't be written). */
function formulaFor(kind: ValidationKind, text: string | undefined, fn: (f: string) => string): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (t.startsWith('=')) return t.length > 1 ? fn(t.slice(1)) : null;
  if (kind === 'list') return `"${t.replace(/"/g, '""')}"`;
  if (kind === 'custom') return fn(t);
  const n = limitNumber(kind, t);
  return n === null ? null : String(n);
}

/** A sheet's data validation rules as Excel writes them ('' for none). `fn` puts Excel's prefixes on newer functions. */
export function validationsXml(list: Validation[], fn: (f: string) => string): string {
  const rules: string[] = [];
  for (const v of list) {
    if (!v.ranges.length) continue;
    const f1 = v.kind === 'any' ? null : formulaFor(v.kind, v.value1, fn);
    if (v.kind !== 'any' && f1 === null) continue;
    const comparing = v.kind !== 'any' && v.kind !== 'list' && v.kind !== 'custom';
    const op = v.op ?? 'between';
    const f2 = comparing && (op === 'between' || op === 'notBetween') ? formulaFor(v.kind, v.value2, fn) : null;
    if (comparing && (op === 'between' || op === 'notBetween') && f2 === null) continue;
    const attrs = [
      v.kind !== 'any' ? `type="${KIND_TO_XL[v.kind]}"` : '',
      v.alertStyle && v.alertStyle !== 'stop' ? `errorStyle="${v.alertStyle}"` : '',
      comparing && op !== 'between' ? `operator="${op}"` : '',
      v.noBlank ? '' : 'allowBlank="1"',
      // (Excel's showDropDown is the other way round: 1 hides the drop-down)
      v.kind === 'list' && v.noDropDown ? 'showDropDown="1"' : '',
      v.hidePrompt ? '' : 'showInputMessage="1"',
      v.noAlert ? '' : 'showErrorMessage="1"',
      v.alertTitle ? `errorTitle="${xml(v.alertTitle)}"` : '',
      v.alert ? `error="${xml(v.alert)}"` : '',
      v.promptTitle ? `promptTitle="${xml(v.promptTitle)}"` : '',
      v.prompt ? `prompt="${xml(v.prompt)}"` : '',
      `sqref="${v.ranges.map(rangeName).join(' ')}"`,
    ].filter(Boolean).join(' ');
    rules.push(`<dataValidation ${attrs}>${f1 !== null ? `<formula1>${xml(f1)}</formula1>` : ''}${f2 !== null ? `<formula2>${xml(f2)}</formula2>` : ''}</dataValidation>`);
  }
  return rules.length ? `<dataValidations count="${rules.length}">${rules.join('')}</dataValidations>` : '';
}

/** A formula1/formula2 back as the dialog has it typed. */
function readLimit(kind: ValidationKind, f: string | null | undefined): string | undefined {
  if (f === null || f === undefined) return undefined;
  const t = f.trim().replace(/_xlfn\.|_xlws\./g, '');
  if (kind === 'list') {
    const lit = /^"((?:[^"]|"")*)"$/.exec(t);
    return lit ? lit[1].replace(/""/g, '"') : '=' + t;
  }
  if (kind === 'custom') return '=' + t;
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? limitText(kind, n) : '=' + t;
}

const ranges = (sqref: string): Range[] => sqref.split(/\s+/).map((p) => parseRange(p)).filter((r): r is Range => !!r);
const on = (v: string | null) => v === '1' || v === 'true';

function readRule(el: Element, sqref: string, f1: string | null | undefined, f2: string | null | undefined): Validation | null {
  const R = ranges(sqref);
  if (!R.length) return null;
  const kind = XL_TO_KIND[el.getAttribute('type') ?? 'none'] ?? 'any';
  const opAttr = el.getAttribute('operator') as ValidationOp | null;
  const op = opAttr && OPS.includes(opAttr) ? opAttr : 'between';
  const style = el.getAttribute('errorStyle');
  const rule: Omit<Validation, 'id' | 'ranges'> = {
    kind,
    ...(kind !== 'any' && kind !== 'list' && kind !== 'custom' && op !== 'between' ? { op } : {}),
    ...(kind !== 'any' && f1 !== undefined && f1 !== null ? { value1: readLimit(kind, f1) } : {}),
    ...(f2 !== undefined && f2 !== null && (op === 'between' || op === 'notBetween') ? { value2: readLimit(kind, f2) } : {}),
    ...(on(el.getAttribute('allowBlank')) ? {} : { noBlank: true }),
    ...(kind === 'list' && on(el.getAttribute('showDropDown')) ? { noDropDown: true } : {}),
    ...(on(el.getAttribute('showInputMessage')) ? {} : { hidePrompt: true }),
    ...(on(el.getAttribute('showErrorMessage')) ? {} : { noAlert: true }),
    ...(style === 'warning' || style === 'information' ? { alertStyle: style as AlertStyle } : {}),
    ...(el.getAttribute('promptTitle') ? { promptTitle: el.getAttribute('promptTitle')! } : {}),
    ...(el.getAttribute('prompt') ? { prompt: el.getAttribute('prompt')! } : {}),
    ...(el.getAttribute('errorTitle') ? { alertTitle: el.getAttribute('errorTitle')! } : {}),
    ...(el.getAttribute('error') ? { alert: el.getAttribute('error')! } : {}),
  };
  return newValidation(R, rule);
}

/** A sheet's data validation rules: the standard ones, and Excel 2010's in the sheet's extensions. */
export function readValidations(ws: Element): Validation[] {
  const out: Validation[] = [];
  for (const el of kids(kid(ws, 'dataValidations'), 'dataValidation')) {
    const v = readRule(el, el.getAttribute('sqref') ?? '', kid(el, 'formula1')?.textContent, kid(el, 'formula2')?.textContent);
    if (v) out.push(v);
  }
  for (const el of Array.from(ws.getElementsByTagNameNS(X14_NS, 'dataValidation'))) {
    const sq = el.getElementsByTagNameNS(XM_NS, 'sqref')[0]?.textContent ?? '';
    const f = (name: string) => kid(el, name)?.getElementsByTagNameNS(XM_NS, 'f')[0]?.textContent;
    const v = readRule(el, sq, f('formula1'), f('formula2'));
    if (v) out.push(v);
  }
  return out;
}
