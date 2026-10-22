// Document mode's Insert > Cover Page, Blank Page, Quick Parts and Date and Time, the document's
// properties (title, author… that fields and cover pages show), and Cross-reference to captions,
// headings and bookmarks.

import type { ParaStyle } from '../model';
import * as rt from '../richtext';
import type { TextEditing } from '../text/editing';
import { paraAt } from '../text/paragraphs';
import type { DocFile } from '../document/doc-file';
import { COMPOUND, OBJECT_CHAR, fieldTexts, nextObjectId, objectOffsets, type DocObject, type DocText } from '../document/document';
import { DATE_FORMATS, FIELD_LIST, defaultPicture, fieldEnv, formatDate, type DocProps, type FieldCode, type FieldObj } from '../document/fields';
import { COVER_PAGES, coverParas, insertCover, partFromSelection, removeCover, type QuickPart } from '../document/quick-parts';
import { addBookmark, bookmarksOf, placeLink } from '../document/bookmarks';
import { tocEntries } from '../document/toc';
import { ask } from './ask';
import { popupMenu } from './sheet-view';

export interface DocInsertHost {
  file(): DocFile | null;
  /** Where typing goes now (the text box or cell typed into, or the body). */
  ed(): TextEditing;
  insertObject(o: DocObject, kind?: string): number;
  /** Leave a text box or table cell, back to the body. */
  stopBox(): void;
  flash(msg: string, ms?: number): void;
  focus(): void;
  /** The person's saved Quick Parts, and saving them. */
  quickParts(): QuickPart[];
  setQuickParts(list: QuickPart[]): void;
  /** The name changes are tracked under (the author a new document's properties start with). */
  author(): string;
}

/** A Word date picture holds a date (not only a time). */
const hasDate = (pic: string) => /[dMy]/.test(pic.replace(/'[^']*'/g, ''));

/** The accent colours offered for cover pages. */
const ACCENTS: [string, string][] = [['#1f4e79', 'Dark blue'], ['#2e75b6', 'Blue'], ['#0c7c59', 'Green'], ['#8b1e3f', 'Burgundy'], ['#404040', 'Charcoal'], ['#c55a11', 'Orange']];

export class DocInsertUI {
  constructor(private host: DocInsertHost) {}

  private get f(): DocFile | null {
    return this.host.file();
  }

  /** A field put in where the caret is. */
  insertField(o: FieldObj, kind = 'Insert field'): void {
    this.host.insertObject(o, kind);
  }

  // ---------------------------------------------------------------- date and time

  /** Insert > Date and Time: today's date (or the time) in a format picked from Word's list, as text or a field that keeps itself up to date. */
  async dateTime(): Promise<void> {
    const f = this.f;
    if (!f) return;
    const now = fieldEnv.now();
    const got = await ask('Date and Time', [
      { name: 'format', label: 'Available formats', value: DATE_FORMATS[0], options: DATE_FORMATS.map((p) => ({ value: p, label: formatDate(now, p) })) },
      { name: 'own', label: 'Or your own format', value: '', placeholder: "d MMMM yyyy, 'at' HH:mm", help: 'Word\'s letters: d dd ddd dddd (day), M MM MMM MMMM (month), yy yyyy, h H (hour), mm (minutes), ss, am/pm; words in \'quotes\'.' },
      { name: 'update', label: 'Update automatically (a field, saved as Word\'s DATE field)', value: 'false', type: 'checkbox' },
    ], { ok: 'Insert' });
    this.host.focus();
    if (!got || this.f !== f) return;
    const pic = got.own.trim() || got.format;
    if (got.update === 'true') {
      this.insertField(hasDate(pic) ? { kind: 'field', code: 'date', format: pic } : { kind: 'field', code: 'time', format: pic }, 'Insert date');
      return;
    }
    const ed = this.host.ed();
    ed.replace(ed.start, ed.end, [{ ...ed.typingStyle(), text: formatDate(now, pic) }], undefined, 'Insert date');
  }

  // ---------------------------------------------------------------- fields and properties

  /** Insert > Quick Parts > Field: any of the fields, with a date format or a bookmark where the field needs one. */
  async field(): Promise<void> {
    const f = this.f;
    if (!f) return;
    const marks = bookmarksOf(f.t).filter((b) => !b.name.startsWith('_')).map((b) => b.name);
    const got = await ask('Field', [
      { name: 'code', label: 'Field', value: 'date', options: FIELD_LIST.map((x) => ({ value: x.code, label: `${x.name}: ${x.help}` })) },
      { name: 'format', label: 'Date format (date fields)', value: 'M/d/yyyy', suggestions: DATE_FORMATS },
      { name: 'target', label: 'Bookmark (bookmark fields)', value: marks[0] ?? '', suggestions: marks },
    ], { ok: 'Insert', note: 'A field shows something the document works out: it changes by itself and is saved as the Word field it is, so Word keeps it up to date too.' });
    this.host.focus();
    if (!got || this.f !== f) return;
    const code = got.code as FieldCode;
    if (code === 'ref' || code === 'pageref' || code === 'abovebelow') {
      const target = got.target.trim();
      if (!target) { this.host.flash('Name the bookmark the field refers to (Insert > Bookmark adds one).'); return; }
      this.insertField({ kind: 'field', code, target });
      return;
    }
    const dated = ['date', 'time', 'createdate', 'savedate', 'printdate'].includes(code);
    const fmt = got.format.trim();
    this.insertField(dated && fmt && fmt !== defaultPicture(code) ? { kind: 'field', code, format: fmt } : { kind: 'field', code });
  }

  /** Quick Parts > Document Property: one of the document's properties, as a field. */
  async property(): Promise<void> {
    const f = this.f;
    if (!f) return;
    const props: [FieldCode, string][] = [['title', 'Title'], ['subject', 'Subject'], ['author', 'Author'], ['company', 'Company'], ['keywords', 'Keywords']];
    const got = await ask('Document Property', [
      { name: 'code', label: 'Property', value: 'title', options: props.map(([v, label]) => ({ value: v, label: `${label}${f.t.props?.[v as keyof DocProps] ? `: ${f.t.props[v as keyof DocProps]}` : ' (not set yet)'}` })) },
    ], { ok: 'Insert', note: 'Shows the property as it is now and whenever it changes (Quick Parts > Document Properties… sets them).' });
    this.host.focus();
    if (!got || this.f !== f) return;
    this.insertField({ kind: 'field', code: got.code as FieldCode });
  }

  /** The document's properties: title, subject, author, company and keywords. Resolves to false when cancelled. */
  async properties(note = 'Fields and cover pages show these, and Word and Windows list them with the file.'): Promise<boolean> {
    const f = this.f;
    if (!f) return false;
    const p = f.t.props ?? {};
    const got = await ask('Document Properties', [
      { name: 'title', label: 'Title', value: p.title ?? '' },
      { name: 'subject', label: 'Subject or subtitle', value: p.subject ?? '' },
      { name: 'author', label: 'Author', value: p.author ?? this.host.author() },
      { name: 'company', label: 'Company or institution', value: p.company ?? '' },
      { name: 'keywords', label: 'Keywords', value: p.keywords ?? '' },
    ], { ok: 'OK', note });
    this.host.focus();
    if (!got || this.f !== f) return false;
    const props: DocProps = { ...p };
    for (const k of ['title', 'subject', 'author', 'company', 'keywords'] as const) {
      const v = got[k].trim();
      if (v) props[k] = v; else delete props[k];
    }
    if (JSON.stringify(props) !== JSON.stringify(p)) f.ed.update({ ...f.t, props } as DocText, 'Document Properties');
    return true;
  }

  // ---------------------------------------------------------------- quick parts

  /** Insert > Quick Parts: the saved parts, fields and properties, and saving the selection as a part. */
  quickPartsMenu(x: number, y: number): void {
    const parts = this.host.quickParts();
    const items: ([string, () => void, boolean?] | null)[] = parts.map((p) => [p.name, () => this.insertPart(p)] as [string, () => void]);
    if (parts.length) items.push(null);
    items.push(
      ['Document Property…', () => void this.property()],
      ['Field…', () => void this.field()],
      ['Document Properties…', () => void this.properties()],
      null,
      ['Save Selection to Quick Part Gallery…', () => void this.savePart(), !(this.f && this.host.ed().start < this.host.ed().end)],
      ['Delete a Quick Part…', () => void this.deletePart(), parts.length > 0],
    );
    popupMenu(x, y, items);
  }

  private insertPart(p: QuickPart): void {
    const ed = this.host.ed();
    // the part's text in its own look (bold, a style's font…), its paragraphs' settings with it
    ed.replace(ed.start, ed.end, p.runs.map((r) => ({ ...r })), p.paras.length > 1 ? p.paras.map((q) => ({ ...q })) : undefined, 'Insert Quick Part');
    this.host.focus();
  }

  private async savePart(): Promise<void> {
    const f = this.f;
    if (!f) return;
    const ed = this.host.ed();
    const text = ed.text.slice(ed.start, ed.end).replace(/\s+/g, ' ').trim();
    const got = await ask('Create New Building Block', [{ name: 'name', label: 'Name', value: text.slice(0, 30) }], {
      ok: 'Save', note: 'The selected text is kept with your settings and offered under Insert > Quick Parts in every document (structures and fields in it are left out).',
    });
    this.host.focus();
    if (!got || this.f !== f) return;
    const box = f.box?.ed === ed;
    const part = box ? { name: got.name.trim() || 'Quick Part', runs: ed.selected().runs.filter((r) => r.obj === undefined), paras: [] as ParaStyle[] } : partFromSelection(f.t, ed.start, ed.end, got.name);
    if (!part || !part.runs.some((r) => r.text.trim())) { this.host.flash('Select some text first (structures and fields can\'t be saved as a Quick Part).'); return; }
    const list = this.host.quickParts().filter((p) => p.name.toLowerCase() !== part.name.toLowerCase());
    this.host.setQuickParts([...list, part].sort((a, b) => a.name.localeCompare(b.name)));
    this.host.flash(`Saved "${part.name}" to Insert > Quick Parts.`);
  }

  private async deletePart(): Promise<void> {
    const parts = this.host.quickParts();
    if (!parts.length) return;
    const got = await ask('Delete a Quick Part', [{ name: 'name', label: 'Quick Part', value: parts[0].name, options: parts.map((p) => ({ value: p.name, label: p.name })) }], { ok: 'Delete' });
    this.host.focus();
    if (!got) return;
    this.host.setQuickParts(parts.filter((p) => p.name !== got.name));
  }

  // ---------------------------------------------------------------- pages

  /** Insert > Cover Page: the designs, and taking the cover page out. */
  coverMenu(x: number, y: number): void {
    const f = this.f;
    const has = !!f && !!coverParas(f.t);
    popupMenu(x, y, [
      ...COVER_PAGES.map((d) => [`${d.name}: ${d.help}`, () => void this.cover(d.id)] as [string, () => void]),
      null,
      ['Remove Current Cover Page', () => this.removeCover(), has],
    ]);
  }

  /** A cover page of a design put in front of the document, after asking for what goes on it. */
  async cover(id: string): Promise<void> {
    const f = this.f;
    const design = COVER_PAGES.find((d) => d.id === id);
    if (!f || !design) return;
    this.host.stopBox();
    const p = f.t.props ?? {};
    const got = await ask(`Cover Page: ${design.name}`, [
      { name: 'title', label: 'Title', value: p.title ?? '' },
      { name: 'subject', label: 'Subtitle', value: p.subject ?? '' },
      { name: 'author', label: 'Author', value: p.author ?? this.host.author() },
      { name: 'company', label: 'Institution or group', value: p.company ?? '' },
      { name: 'accent', label: 'Colour', value: ACCENTS[0][0], options: ACCENTS.map(([v, label]) => ({ value: v, label })) },
    ], { ok: 'Insert', note: 'These are the document\'s properties: the cover shows them as fields, so changing them (Quick Parts > Document Properties…) changes the cover. The date is today\'s, kept up to date. The first page gets no page number.' });
    this.host.focus();
    if (!got || this.file() !== f) return;
    const props: DocProps = { ...p };
    for (const k of ['title', 'subject', 'author', 'company'] as const) { const v = got[k].trim(); if (v) props[k] = v; else delete props[k]; }
    let next = nextObjectId(f.t);
    const N = f.t.styles.Normal;
    const base = rt.cleanStyle({ font: N?.font, size: N?.size });
    const t = insertCover({ ...f.t, props }, design, got.accent, base, (code, format) => ({ id: next++, o: format ? { kind: 'field', code, format } : { kind: 'field', code } }));
    f.ed.update(t, 'Cover Page', 0, 0);
    this.host.flash(`Cover page added. Its text comes from the document's properties (Insert > Quick Parts > Document Properties…).`, 6000);
  }

  private file(): DocFile | null {
    return this.host.file();
  }

  removeCover(): void {
    const f = this.f;
    if (!f || !coverParas(f.t)) { this.host.flash('This document has no cover page.'); return; }
    this.host.stopBox();
    f.ed.update(removeCover(f.t), 'Remove Cover Page', 0, 0);
  }

  /** Insert > Blank Page: an empty page at the caret (a page break, an empty paragraph on a page of its own, and another page break). */
  blankPage(): void {
    const f = this.f;
    if (!f) return;
    this.host.stopBox();
    const ed = f.ed;
    ed.enter(false);
    let p = paraAt(ed.text, ed.focus);
    ed.setParas(p, p, { pageBreak: true }, 'Blank Page');
    ed.enter(false);
    p = paraAt(ed.text, ed.focus);
    ed.setParas(p, p, { pageBreak: true }, null);
    this.host.focus();
  }

  // ---------------------------------------------------------------- cross-references

  /**
   * References > Cross-reference: a caption's label and number, a heading's words or a bookmark's
   * text; or the page any of them is on, or "above" or "below". Each follows what it refers to.
   */
  async crossReference(): Promise<void> {
    const f = this.f;
    if (!f) return;
    const shown = fieldTexts(f.t);
    const at = objectOffsets(f.t.runs);
    const text = f.ed.text;
    const short = (s: string) => (s.length > 70 ? s.slice(0, 68) + '…' : s);
    const targets: { value: string; label: string }[] = [];
    const caps = [...at.entries()].filter(([id]) => { const o = f.t.objects[id]; return o?.kind === 'seq' && o.name !== COMPOUND; }).sort((a, b) => a[1] - b[1]);
    for (const [id, off] of caps) {
      const start = text.lastIndexOf('\n', off - 1) + 1;
      const end = text.indexOf('\n', off);
      targets.push({ value: `c:${id}`, label: `Caption: ${short(text.slice(start, end < 0 ? text.length : end).replace(OBJECT_CHAR, shown.get(id) ?? ''))}` });
    }
    for (const h of tocEntries(f.t, 9)) targets.push({ value: `h:${h.para}`, label: `Heading: ${short(h.text)}` });
    for (const b of bookmarksOf(f.t).filter((x) => !x.name.startsWith('_'))) targets.push({ value: `b:${b.name}`, label: `Bookmark: ${b.name}` });
    if (!targets.length) { this.host.flash('There is nothing to refer to yet: add a caption (References > Insert Caption), a heading or a bookmark (Insert > Bookmark).', 7000); return; }
    const got = await ask('Cross-reference', [
      { name: 'target', label: 'Refer to', value: targets[0].value, options: targets },
      { name: 'what', label: 'Insert reference to', value: 'text', options: [
        { value: 'text', label: 'Its text (a caption\'s label and number, a heading\'s words, a bookmark\'s text)' },
        { value: 'page', label: 'Page number' },
        { value: 'above', label: 'Above or below' },
      ] },
    ], { ok: 'Insert', note: 'The reference changes by itself when what it refers to changes or moves. It is saved as Word\'s own cross-reference.' });
    this.host.focus();
    if (!got || this.f !== f) return;
    const [kind, key] = [got.target.slice(0, 1), got.target.slice(2)];
    if (kind === 'c' && got.what === 'text') { this.host.insertObject({ kind: 'ref', target: Number(key) }, 'Insert cross-reference'); return; }
    // the place gets a hidden bookmark (as Word's _Ref ones) for the field to find it by
    let name = key;
    if (kind === 'h') {
      const placed = placeLink(f.t, `#heading:${key}`);
      name = placed.link.slice(1);
      if (placed.t !== f.t) f.ed.update({ ...f.t, paras: placed.t.paras }, 'Bookmark');
    } else if (kind === 'c') {
      const off = at.get(Number(key)) ?? 0;
      const para = paraAt(text, off);
      const have = f.t.paras[para]?.marks?.find((m) => m.startsWith('_Cap'));
      name = have ?? `_Cap${key}`;
      if (!have) f.ed.update({ ...f.t, paras: addBookmark(f.t, para, name).paras }, 'Bookmark');
    }
    const code: FieldCode = got.what === 'page' ? 'pageref' : got.what === 'above' ? 'abovebelow' : 'ref';
    this.host.insertObject({ kind: 'field', code, target: name }, 'Insert cross-reference');
  }
}
