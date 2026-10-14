// The open files, one tab each: drawings (ChemDraw files), slide decks (PowerPoint files),
// sheets (Excel workbooks, CSV and SD files) and documents (Word files).
// The tab showing has its drawing, or its current slide, in the app's one document, so every
// tool works the same everywhere; the other tabs wait in documents of their own (Doc.swap).
// New, Open, Save, Save As, Close and the unsaved-changes questions go through here.

import { Doc } from './model';
import { Deck, type SlideSize, type Master } from './deck/deck';
import { Workbook } from './sheet/workbook';
import { DocFile } from './document/doc-file';
import { newDocument, type DocText } from './document/document';
import type { DocStyle } from './style';
import type { View } from './render/renderer';
import { readCdxml } from './io/cdxml';
import { writeCdxml, WriteOptions } from './io/cdxml-write';
import { cdxToCdxml, cdxmlToCdx, isCdx } from './io/cdx';
import { readPptx } from './io/pptx-read';
import { writePptx, PptxOptions } from './io/pptx-write';
import { zipHas } from './io/ooxml';
import { adoptSaved } from './io/document-file';
import {
  FileRef, FileType, CDXML, CDX, PPTX, XLSX, CSV, SDF, DOCX, TABLE_TEXT_EXTENSIONS, openBytesDialog, saveFileDialog, writeFile, canSaveInPlace, askSaveChanges,
  showError, withExtension, extensionOf, baseName, readPath, pathExists,
} from './io/files';
import { WORKSPACE, workspaceText, parseWorkspace, folderOf, joinPath, relativeTo, resolveIn, freeName, safeFileName, type WorkspaceEntry } from './io/workspace-file';

/** Design is a deck of one page (a TOC graphic, poster or diagram) with design tools. */
export type Mode = 'drawing' | 'slides' | 'sheet' | 'document' | 'design';

export interface Tab {
  id: number;
  mode: Mode;
  /** File name shown on the tab. */
  name: string;
  ref: FileRef;
  /** A drawing's document while another tab is showing. */
  stash: Doc;
  deck: Deck | null;
  book: Workbook | null;
  document: DocFile | null;
  /** Zoom and scroll, kept while another tab shows. */
  view: View | null;
  /** Sheets and documents: the selection and scroll, kept while another tab shows. */
  sheetState: unknown;
  dirty: boolean;
  /** Drawings: the app document's version last seen while this tab showed. */
  seen: number;
  /** Slides, sheets and documents: the change count when last saved. */
  savedEdits: number;
  /** Split view: the drawing shown beside this document, sheet or slide deck. */
  partner: Tab | null;
}

export interface WorkspaceHooks {
  /** Before another tab shows: finish any typing, remember the view. */
  leave(tab: Tab): void;
  /** After a tab shows. `opened` is true for a file just opened or a new tab. */
  enter(tab: Tab, opened: boolean): void;
  /** Tabs were added, closed, renamed, or their unsaved marks changed. */
  changed(): void;
  flash(msg: string, ms?: number): void;
  /** Pictures of drawings for PowerPoint files (the app draws them). */
  pptx: Omit<PptxOptions, 'title'>;
  /** Text widths for saving ChemDraw files. */
  measure: WriteOptions['textMeasure'];
  /** Reading and writing sheet files (.xlsx, .csv, .sdf). */
  sheets: {
    read(bytes: Uint8Array, name: string): Promise<{ book: Workbook; warnings: string[] }>;
    write(book: Workbook, name: string): Promise<Uint8Array | string>;
  };
  /** Reading and writing Word files. */
  documents: {
    read(bytes: Uint8Array, name: string): Promise<{ doc: DocText; warnings: string[] }>;
    write(doc: DocText, name: string): Promise<Uint8Array>;
  };
  /** The drawing style a new tab of this kind starts with, when you have chosen one (File > Drawing Style). */
  newStyle?(mode: Mode): DocStyle | null;
  /** The master new slide decks start with (your template), or null for the plain one. */
  newMaster?(m: Master): Master | null;
}

/** What each kind of tab saves as (the first is the default). */
const SAVE_TYPES: Record<Mode, FileType[]> = { drawing: [CDXML, CDX], slides: [PPTX], design: [PPTX], sheet: [XLSX, CSV, SDF], document: [DOCX] };

export class Workspace {
  tabs: Tab[] = [];
  active!: Tab;
  /**
   * Split view beside a document or sheet: the drawing tab whose drawing is in the app's document
   * while the document or sheet shows (they don't use it), so both can be worked on side by side.
   */
  pane: Tab | null = null;
  /** The workspace file last saved or opened, so File > Save Workspace saves there again. */
  workspacePath: string | null = null;
  private nextId = 1;

  constructor(public host: Doc, private hooks: WorkspaceHooks) {
    const t = this.makeTab('drawing', this.untitled('drawing'));
    this.tabs.push(t);
    this.active = t;
    t.seen = host.version;
  }

  private makeTab(mode: Mode, name: string, ref: FileRef = { kind: 'none' }): Tab {
    return { id: this.nextId++, mode, name, ref, stash: new Doc(), deck: null, book: null, document: null, view: null, sheetState: null, dirty: false, seen: 0, savedEdits: 0, partner: null };
  }

  /** "Untitled", "Untitled 2"… with the right extension, not already used by an open tab. */
  private untitled(mode: Mode): string {
    const ext = SAVE_TYPES[mode][0].extension;
    for (let n = 1; ; n++) {
      const name = `${n === 1 ? 'Untitled' : `Untitled ${n}`}.${ext}`;
      if (!this.tabs.some((t) => t.name === name)) return name;
    }
  }

  // ---------------------------------------------------------------- switching

  /** Show another tab. */
  activate(tab: Tab, opened = false): void {
    if (tab === this.active && !opened) return;
    if (tab !== this.active) {
      this.putAway(this.active);
      this.active = tab;
      if (tab.deck) tab.deck.attach();
      else this.host.swap(tab.stash);
      tab.seen = this.host.version;
      this.paneIn();
    }
    this.hooks.enter(tab, opened);
    this.hooks.changed();
  }

  private putAway(tab: Tab): void {
    this.hooks.leave(tab);
    this.paneOut();
    if (tab.deck) tab.deck.detach();
    else this.host.swap(tab.stash);
  }

  /** A document's or sheet's split-view drawing comes into the app's document. */
  private paneIn(): void {
    const t = this.active, p = t.partner;
    if (this.pane || !p || (t.mode !== 'document' && t.mode !== 'sheet')) return;
    if (!this.tabs.includes(p)) { t.partner = null; return; }
    this.host.swap(p.stash);
    p.seen = this.host.version;
    this.pane = p;
  }

  private paneOut(): void {
    const p = this.pane;
    if (!p) return;
    this.pane = null;
    this.host.swap(p.stash);
  }

  /** Split view: show this drawing beside the document, sheet or slides showing (null: no split). */
  setPartner(p: Tab | null): void {
    const t = this.active;
    if (t.mode === 'drawing') return;
    this.paneOut();
    t.partner = p;
    this.paneIn();
    this.hooks.changed();
  }

  /** The tab after (or before) the one showing, round the end. */
  cycle(step: 1 | -1): void {
    if (this.tabs.length < 2) return;
    const i = this.tabs.indexOf(this.active);
    this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length]);
  }

  /** Call after anything changes, to keep the unsaved marks right. */
  noteChange(): void {
    const t = this.active;
    let dirty = t.dirty;
    if (t.deck) dirty = t.deck.edits !== t.savedEdits;
    else if (t.mode === 'sheet') dirty = t.book!.edits !== t.savedEdits;
    else if (t.mode === 'document') dirty = t.document!.edits !== t.savedEdits;
    else if (this.host.version !== t.seen) {
      t.seen = this.host.version;
      dirty = true;
    }
    if (dirty !== t.dirty) {
      t.dirty = dirty;
      this.hooks.changed();
    }
    const p = this.pane;
    if (p && this.host.version !== p.seen) {
      p.seen = this.host.version;
      if (!p.dirty) { p.dirty = true; this.hooks.changed(); }
    }
  }

  // ---------------------------------------------------------------- new and open

  newDrawing(): Tab {
    const t = this.makeTab('drawing', this.untitled('drawing'));
    const st = this.hooks.newStyle?.('drawing');
    if (st) t.stash.style = { ...st };
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    t.seen = this.host.version;
    return t;
  }

  /** A new drawing tab beside the one showing, without showing it (for split view). */
  /** Move a tab to another place in the tab strip (dragged there). */
  moveTab(t: Tab, to: number): void {
    const from = this.tabs.indexOf(t);
    if (from < 0) return;
    to = Math.max(0, Math.min(this.tabs.length - 1, to));
    if (to === from) return;
    this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, t);
    this.hooks.changed();
  }

  addDrawing(): Tab {
    const t = this.makeTab('drawing', this.untitled('drawing'));
    const st = this.hooks.newStyle?.('drawing');
    if (st) t.stash.style = { ...st };
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.hooks.changed();
    return t;
  }

  /** New slides, in place of an untouched new drawing (as when the app has just started). */
  newSlides(): Tab {
    const spare = this.active.mode === 'drawing' ? this.spare() : null;
    const t = this.makeTab('slides', this.untitled('slides'));
    t.deck = Deck.blank(this.host);
    const m = this.hooks.newMaster?.(t.deck.master);
    if (m) t.deck.useMaster(m);
    const st = this.hooks.newStyle?.('slides');
    if (st) t.deck.useDrawingStyle(st);
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    return t;
  }

  /** A new design (Design mode) of a size, in place of an untouched new drawing. */
  newDesign(size: SlideSize, fill?: (doc: Doc) => void): Tab {
    const spare = this.active.mode === 'drawing' ? this.spare() : null;
    const t = this.makeTab('design', this.untitled('design'));
    t.deck = Deck.design(this.host, size, fill);
    const st = this.hooks.newStyle?.('design');
    if (st) t.deck.useDrawingStyle(st);
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    return t;
  }

  /** New sheet, in place of an untouched new drawing. */
  newSheet(): Tab {
    const spare = this.active.mode === 'drawing' ? this.spare() : null;
    const t = this.makeTab('sheet', this.untitled('sheet'));
    t.book = new Workbook();
    const st = this.hooks.newStyle?.('sheet');
    if (st) t.book.drawingStyle = { ...st };
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    return t;
  }

  /** New document, in place of an untouched new drawing. */
  newDocument(): Tab {
    const spare = this.active.mode === 'drawing' ? this.spare() : null;
    const t = this.makeTab('document', this.untitled('document'));
    const st = this.hooks.newStyle?.('document');
    t.document = new DocFile(st ? { ...newDocument(), drawingStyle: { ...st } } : undefined);
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    return t;
  }

  /** File > Open: drawings, slide decks, sheets and documents. */
  async open(): Promise<void> {
    let f;
    try {
      f = await openBytesDialog('Drawings, slides, sheets and documents', [CDXML, CDX, PPTX, XLSX, DOCX, CSV, SDF], ['sd', ...TABLE_TEXT_EXTENSIONS]);
    } catch (e) {
      await showError('Could not open the file: ' + String(e));
      return;
    }
    if (f) await this.openBytes(f.bytes, f.name, f.ref);
  }

  /** Open a file's contents (picked, dropped, or given) in a tab of its own. */
  async openBytes(bytes: Uint8Array, name: string, ref: FileRef = { kind: 'none' }): Promise<boolean> {
    // the same file again: go to its tab
    const same = ref.kind === 'path' ? this.tabs.find((t) => t.ref.kind === 'path' && t.ref.path === ref.path) : null;
    if (same) {
      this.activate(same);
      if (same.dirty) this.hooks.flash(`${name} is already open (with changes not saved yet).`);
      return true;
    }
    const ext = extensionOf(name);
    if (ext === WORKSPACE.extension) {
      // a workspace lists files by where they are, so it needs its own place on disk
      if (ref.kind === 'path') await this.openWorkspace(new TextDecoder().decode(bytes), ref.path);
      else await showError(`${name} is a workspace: open it with File > Open Workspace in the desktop app.`);
      return ref.kind === 'path';
    }
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    try {
      if (ext === 'xlsx' || (zip && zipHas(bytes, 'xl/workbook.xml')) || ext === 'sdf' || ext === 'sd' || TABLE_TEXT_EXTENSIONS.includes(ext)) return await this.openSheet(bytes, name, ref);
      if (ext === 'docx' || (zip && zipHas(bytes, 'word/document.xml'))) return await this.openDocument(bytes, name, ref);
      if (ext === 'pptx' || zip) return this.openSlides(bytes, name, ref);
      const text = isCdx(bytes) ? cdxToCdxml(bytes) : new TextDecoder().decode(bytes);
      return this.openDrawing(text, name, ref);
    } catch (e) {
      await showError(`Could not open ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** The tab showing, when it is new and untouched (an opened file takes its place). */
  private spare(): Tab | null {
    const t = this.active;
    if (t.dirty || t.ref.kind !== 'none' || !/^Untitled/.test(t.name)) return null;
    if (t.mode === 'drawing') return this.host.atoms.size || this.host.captions.size || this.host.arrows.size || this.host.shapes.size ? null : t;
    if (t.mode === 'sheet') return t.book!.edits === 0 ? t : null;
    if (t.mode === 'document') return t.document!.edits === 0 ? t : null;
    return t.deck!.edits === 0 ? t : null;
  }

  private openDrawing(text: string, name: string, ref: FileRef): boolean {
    const { doc, stats } = readCdxml(text);
    const spare = this.spare();
    const t = this.makeTab('drawing', name, ref);
    t.stash = doc;
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    t.seen = this.host.version;
    if (spare) this.drop(spare);
    const sk = Object.entries(stats.skipped).map(([k, v]) => `${v} ${k}`).join(', ');
    this.hooks.flash(`Opened ${name}: ${stats.atoms} atoms, ${stats.bonds} bonds, ${stats.captions} captions, ${stats.arrows} arrows${sk ? `. Not shown yet: ${sk}` : ''}`);
    return true;
  }

  private openSlides(bytes: Uint8Array, name: string, ref: FileRef): boolean {
    const got = readPptx(bytes);
    const spare = this.spare();
    const t = this.makeTab(got.design ? 'design' : 'slides', name, ref);
    const deck = new Deck(this.host);
    deck.master = got.master;
    deck.size = got.size;
    deck.load(got.slides.map((s) => deck.makeSlide(s.layout, s.contents, s.notes, s)), got.size, got.master);
    t.deck = deck;
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    const n = got.slides.length;
    if (got.design) this.hooks.flash(`Opened ${name}.${got.warnings.length ? ' ' + got.warnings.join(' ') : ''}`, got.warnings.length ? 12000 : 3500);
    else this.hooks.flash(`Opened ${name}: ${n} slide${n === 1 ? '' : 's'}.${got.warnings.length ? ' ' + got.warnings.join(' ') : ''}`, got.warnings.length ? 12000 : 3500);
    return true;
  }

  private async openSheet(bytes: Uint8Array, name: string, ref: FileRef): Promise<boolean> {
    const { book, warnings } = await this.hooks.sheets.read(bytes, name);
    const spare = this.spare();
    const t = this.makeTab('sheet', name, ref);
    t.book = book;
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    const n = book.sheets.length;
    this.hooks.flash(`Opened ${name}${n > 1 ? `: ${n} sheets` : ''}.${warnings.length ? ' ' + warnings.join(' ') : ''}`, warnings.length ? 12000 : 3500);
    return true;
  }

  private async openDocument(bytes: Uint8Array, name: string, ref: FileRef): Promise<boolean> {
    const { doc, warnings } = await this.hooks.documents.read(bytes, name);
    const spare = this.spare();
    const t = this.makeTab('document', name, ref);
    t.document = new DocFile(doc);
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    this.hooks.flash(`Opened ${name}.${warnings.length ? ' ' + warnings.join(' ') : ''}`, warnings.length ? 12000 : 3500);
    return true;
  }

  // ---------------------------------------------------------------- closing

  /** Close a tab, offering to save changes first. False when the user chose to keep it open. */
  async close(tab: Tab = this.active): Promise<boolean> {
    if (tab.dirty) {
      if (tab !== this.active && tab !== this.pane) this.activate(tab);
      const answer = await askSaveChanges(tab.name);
      if (answer === 'cancel') return false;
      if (answer === 'save' && !(await this.save(tab))) return false;
    }
    this.drop(tab);
    return true;
  }

  /** Take a tab away (without asking). The last tab is replaced by a new drawing. */
  private drop(tab: Tab): void {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    // a drawing shown in split view: the split closes
    if (tab === this.pane) this.paneOut();
    for (const t of this.tabs) if (t.partner === tab) t.partner = null;
    if (tab === this.active) {
      const next = this.tabs[i + 1] ?? this.tabs[i - 1];
      if (next) this.activate(next);
      else {
        // the last tab: a fresh drawing takes its place
        const t = this.makeTab('drawing', 'Untitled.cdxml');
        this.tabs.push(t);
        this.activate(t, true);
      }
    }
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    tab.deck?.detach();
    this.hooks.changed();
  }

  /** Before the window closes: offer to save each tab with changes. False to keep the window open. */
  async closeAll(): Promise<boolean> {
    for (const t of [...this.tabs]) {
      if (!t.dirty) continue;
      this.activate(t);
      const answer = await askSaveChanges(t.name);
      if (answer === 'cancel') return false;
      if (answer === 'save' && !(await this.save(t))) return false;
    }
    return true;
  }

  get anyDirty(): boolean {
    return this.tabs.some((t) => t.dirty);
  }

  // ---------------------------------------------------------------- saving

  /** The tab's drawing (its document wherever it is). */
  docOf(tab: Tab): Doc {
    return tab === this.active || tab === this.pane ? this.host : tab.stash;
  }

  async save(tab: Tab = this.active): Promise<boolean> {
    const ext = extensionOf(tab.name);
    // a file of a kind this tab can't write (a drawing opened from an old file) goes through Save As
    if (!canSaveInPlace(tab.ref) || !SAVE_TYPES[tab.mode].some((t) => t.extension === ext)) return this.saveAs(tab);
    return this.writeTo(tab, tab.ref, tab.name);
  }

  async saveAs(tab: Tab = this.active): Promise<boolean> {
    const types = SAVE_TYPES[tab.mode];
    const ext = extensionOf(tab.name);
    const first = types.find((t) => t.extension === ext) ?? types[0];
    const target = await saveFileDialog(withExtension(tab.name, first.extension), [first, ...types.filter((t) => t !== first)]).catch(async (e) => { await showError(String(e)); return null; });
    if (!target) return false;
    return this.writeTo(tab, target.ref, target.name);
  }

  private async writeTo(tab: Tab, ref: FileRef, name: string): Promise<boolean> {
    let note = '';
    try {
      if (tab.deck) {
        const deck = tab.deck;
        const bytes = await writePptx({
          size: deck.size, master: deck.master, design: tab.mode === 'design',
          slides: deck.slides.map((s, i) => ({ layout: s.layout, doc: deck.docOf(i), notes: s.notes, transition: s.transition, anims: s.anims })),
        }, { ...this.hooks.pptx, title: name.replace(/\.[^.]+$/, '') });
        await writeFile(ref, name, bytes, PPTX);
        tab.savedEdits = deck.edits;
      } else if (tab.mode === 'sheet') {
        const book = tab.book!;
        const ext = extensionOf(name);
        const data = await this.hooks.sheets.write(book, name);
        await writeFile(ref, name, data, ext === 'csv' ? CSV : ext === 'sdf' || ext === 'sd' ? SDF : XLSX);
        // CSV and SD files keep only the values of the sheet showing: said, not stopped (as Excel does)
        if (ext !== 'xlsx') note = ` (${book.sheets.length > 1 ? `only the sheet "${book.sheet.name}", ` : ''}values only: save as .xlsx to keep formulas and formatting)`;
        tab.savedEdits = book.edits;
      } else if (tab.mode === 'document') {
        const f = tab.document!;
        await writeFile(ref, name, await this.hooks.documents.write(f.t, name), DOCX);
        tab.savedEdits = f.edits;
      } else {
        const doc = this.docOf(tab);
        const text = writeCdxml(doc, { name, textMeasure: this.hooks.measure });
        if (extensionOf(name) === 'cdx') await writeFile(ref, name, cdxmlToCdx(text), CDX);
        else await writeFile(ref, name, text, CDXML);
        adoptSaved(doc, text);
      }
    } catch (e) {
      await showError(`Could not save ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    tab.ref = ref;
    tab.name = name;
    tab.dirty = false;
    if (tab === this.active || tab === this.pane) tab.seen = this.host.version;
    this.hooks.changed();
    this.hooks.flash((ref.kind === 'none' ? `Downloaded ${name}` : `Saved ${name}`) + note, note ? 8000 : 3500);
    return true;
  }

  // ---------------------------------------------------------------- workspaces

  /** Tabs with no file on disk yet (new, or downloaded in a browser): Save Workspace puts them in its folder. */
  get unsavedTabs(): Tab[] {
    return this.tabs.filter((t) => t.ref.kind !== 'path');
  }

  /**
   * File > Save Workspace: save the tabs and a list of them to `path`. Tabs that were never saved
   * go into the workspace file's folder; with `copyIn`, so do copies of files kept in other folders
   * (their tabs then save to the copies). With `saveChanges`, unsaved changes to files already on
   * disk are saved too. False if a file couldn't be written (the error has been shown).
   */
  async saveWorkspace(path: string, opts: { copyIn: boolean; saveChanges: boolean }): Promise<boolean> {
    const folder = folderOf(path);
    this.noteChange();
    const taken = new Set<string>();
    for (const t of this.tabs) {
      const inFolder = t.ref.kind === 'path' && !/[\\/]/.test(relativeTo(folder, t.ref.path));
      if (t.ref.kind === 'path' && inFolder) taken.add(baseName(t.ref.path));
    }
    for (const t of this.tabs) {
      const onDisk = t.ref.kind === 'path';
      const outside = onDisk && relativeTo(folder, (t.ref as { path: string }).path) === (t.ref as { path: string }).path;
      if (!onDisk || (opts.copyIn && outside)) {
        // into the workspace folder, under a name no other file there has
        const ext = SAVE_TYPES[t.mode].some((x) => x.extension === extensionOf(t.name)) ? extensionOf(t.name) : SAVE_TYPES[t.mode][0].extension;
        let name = freeName(safeFileName(withExtension(t.name, ext)), taken);
        while (await pathExists(joinPath(folder, name))) { taken.add(name); name = freeName(name, taken); }
        taken.add(name);
        if (!(await this.writeTo(t, { kind: 'path', path: joinPath(folder, name) }, name))) return false;
      } else if (t.dirty && opts.saveChanges) {
        if (!(await this.save(t))) return false;
      }
    }
    const index = new Map(this.tabs.map((t, i) => [t, i]));
    const tabs: WorkspaceEntry[] = this.tabs.map((t) => {
      const p = t.partner && index.has(t.partner) ? index.get(t.partner)! : undefined;
      return { file: relativeTo(folder, (t.ref as { path: string }).path), ...(p !== undefined ? { beside: p } : {}) };
    });
    try {
      await writeFile({ kind: 'path', path }, baseName(path), workspaceText({ tabs, active: this.tabs.indexOf(this.active) }), WORKSPACE);
    } catch (e) {
      await showError(`Could not save the workspace: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    this.workspacePath = path;
    this.hooks.flash(`Saved workspace ${baseName(path)} with ${tabs.length} tab${tabs.length === 1 ? '' : 's'}.`);
    return true;
  }

  /**
   * File > Open Workspace: open every file a workspace lists, in order, beside the tabs already
   * open (a file already open just goes to its tab). Files that can't be found are named, not stopped for.
   */
  async openWorkspace(text: string, path: string): Promise<void> {
    let list;
    try {
      list = parseWorkspace(text);
    } catch (e) {
      await showError(`Could not open ${baseName(path)}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const folder = folderOf(path);
    const opened: (Tab | null)[] = [];
    const missing: string[] = [];
    for (const e of list.tabs) {
      const full = resolveIn(folder, e.file);
      let bytes: Uint8Array;
      try {
        bytes = await readPath(full);
      } catch {
        missing.push(e.file);
        opened.push(null);
        continue;
      }
      opened.push((await this.openBytes(bytes, baseName(full), { kind: 'path', path: full })) ? this.active : null);
    }
    // split views, then the tab that was showing
    list.tabs.forEach((e, i) => {
      const t = opened[i], p = e.beside !== undefined ? opened[e.beside] : null;
      if (t && p && p.mode === 'drawing' && t.mode !== 'drawing') t.partner = p;
    });
    const show = opened[list.active] ?? opened.find((t) => t);
    if (show) {
      if (show === this.active && show.partner && (show.mode === 'document' || show.mode === 'sheet')) {
        // the partner was set after the tab came in: bring its drawing in now
        const p = show.partner;
        show.partner = null;
        this.setPartner(p);
      } else this.activate(show);
    }
    this.workspacePath = path;
    const n = opened.filter((t) => t).length;
    this.hooks.flash(`Opened workspace ${baseName(path)}: ${n} file${n === 1 ? '' : 's'}.` + (missing.length ? ` Not found: ${missing.join(', ')}.` : ''), missing.length ? 15000 : 4000);
  }
}
