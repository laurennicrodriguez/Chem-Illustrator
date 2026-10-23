// The windows for Review > Restrict Editing and form fields, and for References > Mark Entry,
// Insert Index, Mark Citation and Insert Table of Authorities (see document/protect.ts and
// document/index-toa.ts for what they do to the document).

import type { DocFile } from '../document/doc-file';
import type { TextRun } from '../model';
import * as rt from '../richtext';
import { paraAt, paraRange } from '../text/paragraphs';
import { wordEnd, wordStart } from '../text/editing';
import { nextObjectId, objectOffsets, objectRun, runStyleOf, setParaStyle, styleOf, type DocObject, type DocText, type FormType } from '../document/document';
import { sectionAt, sectionsOf } from '../document/sections';
import { PROTECT_NAMES, PROTECT_REFUSED, passwordOpens, protection, type ProtectKind } from '../document/protect';
import { TOA_CATEGORIES, authorities, categoryName, indexItems, markAuthority, markIndex, setAuthority, toaItems, unmark } from '../document/index-toa';
import { ask } from './ask';

export interface DocIndexHost {
  file(): DocFile | null;
  flash(msg: string, ms?: number): void;
  focus(): void;
  /** Put an object into the text at the caret, in place of the selection. */
  insertObject(o: DocObject, kind: string): number;
}

type FormObject = Extract<DocObject, { kind: 'form' }>;

export class DocIndexUI {
  private lastRefused = 0;

  constructor(private host: DocIndexHost) {}

  /** A change turned away by the protection: say why (not more than once every few seconds). */
  refused(f: DocFile): void {
    const now = performance.now();
    if (now - this.lastRefused < 4000 || !f.t.protect) return;
    this.lastRefused = now;
    this.host.flash(PROTECT_REFUSED[f.t.protect.edit], 7000);
  }

  // ---------------------------------------------------------------- Restrict Editing

  /**
   * Review > Restrict Editing: protect the document so it can only be read, commented on,
   * changed with changes tracked, or filled in, with a password if wanted; or, when it is
   * protected, stop the protection (with its password).
   */
  async restrictEditing(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    const p = f.t.protect;
    if (p) {
      const got = await ask('Stop Protection', p.hash ? [{ name: 'pw', label: 'Password', type: 'password', value: '' }] : [], {
        ok: 'Stop Protection',
        note: `This document is protected: ${p.edit === 'readOnly' ? 'it can be read but not changed' : `only ${PROTECT_NAMES[p.edit].toLowerCase()} can be made`}.${p.hash ? ' Type its password to stop the protection.' : ' It has no password.'}`,
      });
      this.host.focus();
      if (!got || this.host.file() !== f) return;
      if (!passwordOpens(p, got.pw ?? '')) { this.host.flash('That isn\'t the password. The document is still protected.', 6000); return; }
      f.unprotected(() => f.ed.update({ ...f.t, protect: undefined } as DocText, 'Stop protection'));
      this.host.flash('The document can be changed again.');
      return;
    }
    const got = await ask('Restrict Editing', [
      { name: 'edit', label: 'Allow only this type of editing', value: 'readOnly', options: (Object.keys(PROTECT_NAMES) as ProtectKind[]).map((k) => ({ value: k, label: PROTECT_NAMES[k] })) },
      { name: 'pw', label: 'Password (optional)', type: 'password', value: '', help: 'Needed to stop the protection. Without one, anyone can stop it from here or in Word.' },
      { name: 'pw2', label: 'Type the password again', type: 'password', value: '' },
    ], {
      ok: 'Start Enforcing Protection',
      note: 'As in Word: the document opens for anyone, but can only be changed in the way chosen, here and in Word. This guards against changes by mistake; it does not encrypt the file.',
    });
    this.host.focus();
    if (!got || this.host.file() !== f) return;
    if (got.pw !== got.pw2) { this.host.flash('The passwords don\'t match. The document is not protected.', 6000); return; }
    const edit = got.edit as ProtectKind;
    if (edit === 'forms' && !Object.values(f.t.objects).some((o) => o.kind === 'form')) {
      this.host.flash('There are no form fields to fill in yet: add them with Review > Text Field, Check Box or Drop-Down first. The document is not protected.', 8000);
      return;
    }
    const prot = protection(edit, got.pw);
    f.ed.update({ ...f.t, protect: prot, ...(edit === 'trackedChanges' ? { track: true } : {}) } as DocText, 'Restrict editing');
    this.host.flash(`Protected: ${edit === 'readOnly' ? 'no changes can be made' : `only ${PROTECT_NAMES[edit].toLowerCase()} can be made`}${prot.hash ? '' : ' (no password)'}. Review > Restrict Editing stops it.`, 7000);
  }

  // ---------------------------------------------------------------- form fields

  /** Review > Text Field, Check Box or Drop-Down (Word's legacy form fields): set it up and put it at the caret. */
  async insertFormField(type: FormType): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    const o = await this.askForm({ kind: 'form', type }, 'Insert');
    if (!o || this.host.file() !== f) return;
    this.host.insertObject(o, type === 'check' ? 'Insert check box' : type === 'drop' ? 'Insert drop-down' : 'Insert text field');
    f.ed.setCaret(f.ed.end);
  }

  /** A form field's settings: its name, its entry (or ticked, or chosen item), the drop-down's items, and its help text. */
  private async askForm(o: FormObject, ok: string): Promise<FormObject | null> {
    const title = o.type === 'check' ? 'Check Box Form Field' : o.type === 'drop' ? 'Drop-Down Form Field' : 'Text Form Field';
    const got = await ask(title, [
      ...(o.type === 'text' ? [{ name: 'value', label: 'Default text', value: o.value ?? '' }] : []),
      ...(o.type === 'check' ? [{ name: 'checked', label: 'Checked', type: 'checkbox' as const, value: String(!!o.checked) }] : []),
      ...(o.type === 'drop' ? [{ name: 'items', label: 'Items in the list (one a line)', type: 'textarea' as const, value: (o.items ?? []).join('\n') }] : []),
      { name: 'name', label: 'Name (bookmark)', value: o.name ?? '', placeholder: 'Text1, Check1…', help: 'Letters and digits; Word refers to the field by it' },
      { name: 'help', label: 'Help text', value: o.help ?? '', help: 'Shown while the field is filled in' },
    ], { ok, note: 'Form fields are filled in by whoever has the document, also when it is protected for filling in forms (Review > Restrict Editing): click one to fill it in, or press Tab to go to the next.' });
    if (!got) return null;
    const out: FormObject = { kind: 'form', type: o.type };
    const name = got.name.replace(/[^\w]/g, '').slice(0, 20);
    if (name) out.name = name;
    if (got.help.trim()) out.help = got.help.trim();
    if (o.type === 'text' && got.value) out.value = got.value;
    if (o.type === 'check' && got.checked === 'true') out.checked = true;
    if (o.type === 'drop') {
      out.items = got.items.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 25);
      if (o.value && out.items.includes(o.value)) out.value = o.value;
    }
    return out;
  }

  /** Double-click on a form field: fill it in when the document is protected for forms, else change its settings. */
  async formOptions(id: number): Promise<void> {
    const f = this.host.file();
    const o = f?.t.objects[id];
    if (!f || o?.kind !== 'form') return;
    if (f.t.protect) { await this.fill(id); return; }
    const next = await this.askForm(o, 'Apply');
    this.host.focus();
    if (!next || this.host.file() !== f) return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, 'Form field options');
  }

  /** Fill in a form field: a check box is ticked or not at once; a text field or drop-down asks. */
  async fill(id: number): Promise<void> {
    const f = this.host.file();
    const o = f?.t.objects[id];
    if (!f || o?.kind !== 'form') return;
    let next: FormObject | null = null;
    if (o.type === 'check') next = { ...o, checked: !o.checked || undefined };
    else {
      const got = await ask(o.name || (o.type === 'drop' ? 'Choose' : 'Fill In'), [
        o.type === 'drop'
          ? { name: 'value', label: 'Choose', value: o.value ?? o.items?.[0] ?? '', options: (o.items ?? []).map((x) => ({ value: x, label: x })) }
          : { name: 'value', label: 'Entry', value: o.value ?? '' },
      ], { ok: 'OK', ...(o.help ? { note: o.help } : {}) });
      this.host.focus();
      if (!got || this.host.file() !== f) return;
      next = { ...o, value: got.value || undefined };
    }
    const cur = f.t.objects[id];
    if (cur?.kind !== 'form') return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...cur, value: next.value, checked: next.checked } } } as DocText, 'Fill in form field');
    const at = objectOffsets(f.t.runs).get(id);
    if (at !== undefined) f.ed.select(at, at + 1);
  }

  /** Tab in a document protected for forms: the next form field (Shift: the one before), picked. True when there is one. */
  nextField(back: boolean): boolean {
    const f = this.host.file();
    if (!f) return false;
    const at = [...objectOffsets(f.t.runs)].filter(([id]) => f.t.objects[id]?.kind === 'form').map(([, o]) => o).sort((a, b) => a - b);
    if (!at.length) return false;
    const here = back ? f.ed.start : f.ed.end;
    const go = back ? [...at].reverse().find((o) => o < here) ?? at[at.length - 1] : at.find((o) => o >= here && !(f.ed.end - f.ed.start === 1 && o === f.ed.start)) ?? at[0];
    f.ed.select(go, go + 1);
    return true;
  }

  /** The form field picked on its own (its one character selected), if any. */
  pickedForm(): number | null {
    const f = this.host.file();
    if (!f || f.box || f.ed.end - f.ed.start !== 1) return null;
    const id = rt.sliceRuns(f.ed.t.runs, f.ed.start, f.ed.end)[0]?.obj;
    return id !== undefined && f.t.objects[id]?.kind === 'form' ? id : null;
  }

  // ---------------------------------------------------------------- the index

  /** The selected text, or the word at the caret, with the paragraph it is in. */
  private selection(f: DocFile): { text: string; para: number } {
    const ed = f.ed;
    const text = ed.text;
    let a = ed.start, b = ed.end;
    if (a === b) { a = wordStart(text, a); b = wordEnd(text, b); }
    const shown = rt.plainText(rt.sliceRuns(ed.t.runs, a, b).filter((r) => r.obj === undefined)).replace(/\s+/g, ' ').trim();
    return { text: shown, para: paraAt(text, ed.start) };
  }

  /**
   * References > Mark Entry (Alt+Shift+X): the selected word or phrase (or one typed) as an index
   * entry, or a subentry under one, here or (Mark All) in every paragraph where it comes up; with
   * its page number, in bold or italic if wanted, or a cross-reference instead.
   */
  async markEntry(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    if (f.box) { this.host.flash('Index entries are marked in the document\'s own text (not in text boxes, table cells or notes). Click outside first.'); return; }
    const { text, para } = this.selection(f);
    const here = f.t.paras[para]?.xe ?? [];
    const got = await ask('Mark Index Entry', [
      { name: 'main', label: 'Main entry', value: text, placeholder: 'Aldol reaction' },
      { name: 'sub', label: 'Subentry', value: '', placeholder: 'asymmetric (optional)' },
      { name: 'kind', label: 'Options', value: 'page', options: [{ value: 'page', label: 'Current page' }, { value: 'see', label: 'Cross-reference' }] },
      { name: 'see', label: 'Cross-reference', value: 'See ', help: 'Shown in place of the page number, for Cross-reference' },
      { name: 'bold', label: 'Page number in bold', type: 'checkbox', value: 'false' },
      { name: 'italic', label: 'Page number in italic', type: 'checkbox', value: 'false' },
      { name: 'all', label: 'Mark All: every paragraph where the main entry\'s text comes up', type: 'checkbox', value: 'false' },
      ...(here.length ? [{ name: 'remove', label: 'Take this paragraph\'s entries off instead', type: 'checkbox' as const, value: 'false', help: `Marked here: ${here.map((x) => x.sub ? `${x.main}: ${x.sub}` : x.main).join('; ')}` }] : []),
    ], { ok: 'Mark', note: 'The entry is kept on its paragraph, so it moves with the text; References > Insert Index lists the entries A to Z with their pages, and updates by itself.' });
    this.host.focus();
    if (!got || this.host.file() !== f) return;
    if (got.remove === 'true') {
      let t = f.t;
      for (const x of here) t = unmark(t, para, { xe: x });
      f.ed.update(t, 'Remove index entries');
      this.host.flash(`${here.length} index entr${here.length === 1 ? 'y' : 'ies'} taken off this paragraph.`);
      return;
    }
    const main = got.main.trim();
    if (!main) { this.host.flash('Type the main entry: the word or phrase the index lists.'); return; }
    const see = got.kind === 'see' ? got.see.trim() : '';
    if (got.kind === 'see' && (!see || see === 'See')) { this.host.flash('Type the cross-reference: "See Enolates", say.'); return; }
    const m = { main, ...(got.sub.trim() ? { sub: got.sub.trim() } : {}), ...(see ? { see } : {}), ...(got.bold === 'true' ? { bold: true } : {}), ...(got.italic === 'true' ? { italic: true } : {}) };
    const out = markIndex(f.t, para, m, got.all === 'true', text && got.all === 'true' && main.toLowerCase() !== text.toLowerCase() ? text : main);
    if (!out.count) { this.host.flash(got.all === 'true' ? `No paragraph with "${main}" that isn't marked already.` : 'This paragraph has that entry already.'); return; }
    f.ed.update(out.t, 'Mark index entry');
    const indexed = Object.values(f.t.objects).some((o) => o.kind === 'index');
    this.host.flash(`Marked ${out.count === 1 ? 'here' : `in ${out.count} paragraphs`}.${indexed ? '' : ' Insert the index with References > Insert Index.'}`, 6000);
  }

  /** The heading and the object's paragraph after the caret's, as Insert Table of Contents puts them; gives the object's paragraph. */
  private insertBlock(f: DocFile, o: DocObject, title: string, kind: string, after = false): number {
    const ed = f.ed;
    const id = nextObjectId(f.t);
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: o } } as DocText, kind);
    const text = ed.text;
    const p = paraAt(text, ed.focus);
    const r = paraRange(text, p);
    const head = { ...runStyleOf(f.t.styles.Heading1 ?? styleOf(f.t, undefined)) };
    const normal = runStyleOf(styleOf(f.t, undefined));
    const empty = r.start === r.end;
    const runs: TextRun[] = [...(empty ? [] : [{ ...normal, text: '\n' }]), { ...head, text: title }, { ...head, text: '\n' }, objectRun(id, normal), ...(after ? [{ ...normal, text: '\n' }] : [])];
    ed.replace(empty ? r.start : r.end, empty ? r.start : r.end, runs, undefined, null);
    const h = empty ? p : p + 1;
    // the heading looks like a heading but is in Normal, so the contents leave it out
    let t = setParaStyle(f.t, h, h + 1, 'Normal');
    const hr = paraRange(rt.plainText(t.runs), h);
    t = { ...t, runs: rt.applyStyle(t.runs, hr.start, hr.end, head), paras: t.paras.map((x, i) => (i === h ? { ...x, keepNext: true, spaceBefore: 0, spaceAfter: 8 } : x)) };
    ed.update(t, null);
    const at = objectOffsets(f.t.runs).get(id);
    if (at !== undefined) ed.setCaret(at + 1);
    return h + 1;
  }

  private async askIndex(now: Extract<DocObject, { kind: 'index' }>, ok: string): Promise<Extract<DocObject, { kind: 'index' }> | null> {
    const got = await ask('Index', [
      { name: 'cols', label: 'Columns', value: String(now.cols ?? 2), options: ['1', '2', '3', '4'].map((v) => ({ value: v, label: v })) },
      { name: 'right', label: 'Right align page numbers (after dots)', type: 'checkbox', value: String(!!now.right) },
      { name: 'letters', label: 'A letter over each letter\'s entries', type: 'checkbox', value: String(!!now.letters) },
    ], { ok, note: 'It lists the entries marked with References > Mark Entry, A to Z, and updates by itself as entries are marked or move to other pages. In Word, right-click it and choose Update Field after editing there.' });
    if (!got) return null;
    const cols = Math.max(1, Math.min(4, Number(got.cols) || 1));
    return { kind: 'index', ...(cols > 1 ? { cols } : {}), ...(got.right === 'true' ? { right: true } : {}), ...(got.letters === 'true' ? { letters: true } : {}) };
  }

  /**
   * References > Insert Index: the entries A to Z with their pages, under an Index heading after
   * the caret's paragraph; in columns, as Word sets it, in a section of its own (continuous
   * section breaks before and after it).
   */
  async insertIndex(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    if (f.box) { this.host.flash('An index goes in the document\'s own text. Click outside the text box or table first.'); return; }
    const o = await this.askIndex({ kind: 'index', cols: 2 }, 'Insert');
    this.host.focus();
    if (!o || this.host.file() !== f) return;
    const para = this.insertBlock(f, o, 'Index', 'Insert index', (o.cols ?? 1) > 1);
    if ((o.cols ?? 1) > 1) this.setColumns(f, para, o.cols!);
    if (!indexItems(f.t, () => '').length) this.host.flash('The index lists the entries marked with References > Mark Entry (Alt+Shift+X). Mark some and they appear here with their page numbers.', 9000);
  }

  /**
   * The index's columns: its paragraph starts a section of its own (a continuous break) in that
   * many columns, and the paragraph after it goes back to the page as it was.
   */
  private setColumns(f: DocFile, para: number, cols: number): void {
    const t = f.t;
    const secs = sectionsOf(t);
    const here = sectionAt(secs, para);
    const own = here.first === para && t.paras[para]?.section?.kind === 'continuous';
    const before = own ? sectionAt(secs, para - 1) : here;
    const paras = t.paras.slice();
    const n = paras.length;
    if (cols <= 1 && own) {
      // back to one column: the breaks go when the sections round it are alike
      paras[para] = { ...paras[para], section: undefined };
      const next = paras[para + 1]?.section;
      if (next?.kind === 'continuous' && next.page && JSON.stringify(next.page) === JSON.stringify(before.page)) paras[para + 1] = { ...paras[para + 1], section: undefined };
    } else if (cols > 1) {
      paras[para] = { ...paras[para], section: { kind: 'continuous', page: { ...before.page, cols } } };
      if (para + 1 < n && !paras[para + 1]?.section) paras[para + 1] = { ...paras[para + 1], section: { kind: 'continuous', page: before.page } };
    }
    f.ed.update({ ...t, paras }, null);
  }

  /** Double-click on an index: its columns and how it looks. */
  async indexOptions(id: number): Promise<void> {
    const f = this.host.file();
    const o = f?.t.objects[id];
    if (!f || o?.kind !== 'index') return;
    const next = await this.askIndex(o, 'Apply');
    this.host.focus();
    if (!next || this.host.file() !== f) return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, 'Index options');
    if ((next.cols ?? 1) !== (o.cols ?? 1)) {
      const at = objectOffsets(f.t.runs).get(id);
      if (at === undefined) return;
      let para = paraAt(f.ed.text, at);
      // a paragraph after it to go back to the page's columns
      if ((next.cols ?? 1) > 1 && para === f.t.paras.length - 1) {
        const end = f.ed.text.length;
        f.ed.replace(end, end, [{ ...runStyleOf(styleOf(f.t, undefined)), text: '\n' }], undefined, null);
        para = paraAt(f.ed.text, at);
      }
      this.setColumns(f, para, next.cols ?? 1);
    }
  }

  // ---------------------------------------------------------------- the table of authorities

  /**
   * References > Mark Citation (Alt+Shift+I): the selected citation for the table of authorities,
   * with its long form (as listed), its short form (which later mentions share) and its category;
   * Mark All marks every paragraph where the short form comes up.
   */
  async markCitation(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    if (f.box) { this.host.flash('Citations are marked in the document\'s own text (not in text boxes, table cells or notes). Click outside first.'); return; }
    const { text, para } = this.selection(f);
    const known = authorities(f.t);
    const same = known.find((a) => a.short.toLowerCase() === text.toLowerCase() || a.long.toLowerCase() === text.toLowerCase());
    const got = await ask('Mark Citation', [
      { name: 'long', label: 'Long citation (as listed)', value: same?.long ?? text, placeholder: 'Brown v. Board of Education, 347 U.S. 483 (1954)' },
      { name: 'short', label: 'Short citation', value: same?.short ?? text, suggestions: known.map((a) => a.short), help: 'Later mentions are marked by it' },
      { name: 'cat', label: 'Category', value: String(same?.cat ?? 1), options: TOA_CATEGORIES.map((c, i) => ({ value: String(i + 1), label: c })) },
      { name: 'all', label: 'Mark All: every paragraph where the short citation comes up', type: 'checkbox', value: 'false' },
    ], { ok: 'Mark', note: 'References > Insert Table of Authorities lists the citations marked, by category, each with the pages it is cited on.' });
    this.host.focus();
    if (!got || this.host.file() !== f) return;
    const short = got.short.trim() || got.long.trim();
    if (!short) { this.host.flash('Type the citation.'); return; }
    let t = f.t;
    const cat = Number(got.cat) || 1;
    const had = known.find((a) => a.short.toLowerCase() === short.toLowerCase());
    // a citation marked before: its long form and category change where they are kept
    if (had && (got.long.trim() !== had.long || cat !== had.cat)) t = setAuthority(t, had.short, { long: got.long.trim() || undefined, cat });
    const out = markAuthority(t, para, { short, long: got.long.trim(), cat }, got.all === 'true');
    if (!out.count && t === f.t) { this.host.flash('This paragraph has that citation marked already.'); return; }
    f.ed.update(out.t, 'Mark citation');
    const listed = Object.values(f.t.objects).some((o) => o.kind === 'toa');
    this.host.flash(`${out.count > 1 ? `Marked in ${out.count} paragraphs` : 'Marked'} under ${categoryName(cat)}.${listed ? '' : ' Insert the table with References > Insert Table of Authorities.'}`, 6000);
  }

  private async askToa(now: Extract<DocObject, { kind: 'toa' }>, ok: string): Promise<Extract<DocObject, { kind: 'toa' }> | null> {
    const got = await ask('Table of Authorities', [
      { name: 'cat', label: 'Category', value: String(now.cat), options: [{ value: '0', label: 'All' }, ...TOA_CATEGORIES.map((c, i) => ({ value: String(i + 1), label: c }))] },
      { name: 'passim', label: 'Use passim (for citations on five pages or more)', type: 'checkbox', value: String(!!now.passim) },
    ], { ok, note: 'It lists the citations marked with References > Mark Citation, each category under its heading, and updates by itself. In Word, right-click it and choose Update Field after editing there.' });
    if (!got) return null;
    return { kind: 'toa', cat: Math.max(0, Number(got.cat) || 0), ...(got.passim === 'true' ? { passim: true } : {}) };
  }

  /** References > Insert Table of Authorities: the marked citations by category, after the caret's paragraph. */
  async insertToa(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    if (f.box) { this.host.flash('A table of authorities goes in the document\'s own text. Click outside the text box or table first.'); return; }
    const o = await this.askToa({ kind: 'toa', cat: 0 }, 'Insert');
    this.host.focus();
    if (!o || this.host.file() !== f) return;
    this.insertBlock(f, o, 'Table of Authorities', 'Insert table of authorities');
    if (!toaItems(f.t, o.cat, () => '').some((i) => i.level)) this.host.flash('The table lists the citations marked with References > Mark Citation (Alt+Shift+I). Mark some and they appear here with their pages.', 9000);
  }

  /** Double-click on a table of authorities: its category and passim. */
  async toaOptions(id: number): Promise<void> {
    const f = this.host.file();
    const o = f?.t.objects[id];
    if (!f || o?.kind !== 'toa') return;
    const next = await this.askToa(o, 'Apply');
    this.host.focus();
    if (!next || this.host.file() !== f) return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, 'Table of authorities options');
  }
}
