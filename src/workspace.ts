// The open files, one tab each: drawings (ChemDraw files), slide decks (PowerPoint files),
// sheets (Excel workbooks, CSV and SD files) and documents (Word files).
// The tab showing has its drawing, or its current slide, in the app's one document, so every
// tool works the same everywhere; the other tabs wait in documents of their own (Doc.swap).
// New, Open, Save, Save As, Close and the unsaved-changes questions go through here.

import { Doc, keepOnPage, type PageSetup } from './model';
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
  showError, withExtension, extensionOf, baseName, readPath, pathExists, stampOf,
} from './io/files';
import type { FileStamp } from './keep/recovery';
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
  /** View > New Window: the tab whose document this tab shows too (null for the tab that owns its file). */
  windowOf: Tab | null;
  /** When its file on disk last changed and its size, as last opened or saved here (to notice changes made elsewhere). */
  stamp: FileStamp | null;
  /** AutoSave switched on or off for this tab (File > AutoSave), or null to follow AutoSave and Recovery Options. */
  autoSave: boolean | null;
  /** Drawings: counts changes, so AutoSave and recovery copies know when there is something new. */
  changes: number;
  /** When it was last saved here, and whether AutoSave did it (shown on the tab). */
  savedAt: number;
  savedHow: SaveHow | null;
}

/** A save the person asked for, or one AutoSave made. */
export type SaveHow = 'saved' | 'autosaved';

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
  /** The page a new drawing starts with (File > Page Setup's default). */
  newPage?(): PageSetup | null;
  /** A file or workspace was opened from or saved to this path (File > Recent). */
  remember?(path: string): void;
  /** The master new slide decks start with (your template), or null for the plain one. */
  newMaster?(m: Master): Master | null;
  /**
   * Just before a file is written: the chance to keep what is there now (Version History) and to
   * stop when the file has been changed elsewhere since it was opened ('save-as' asks for another place).
   */
  beforeWrite?(tab: Tab, ref: FileRef, name: string, how: SaveHow): Promise<'go' | 'stop' | 'save-as'>;
  /** A file was written (`was`: where the tab's file was before, which Save As changes). */
  saved?(tab: Tab, data: Uint8Array, how: SaveHow, was: FileRef): void;
  /** AutoSave couldn't write a file (no window is shown for it). */
  autoSaveFailed?(tab: Tab, message: string): void;
  /** A file was opened from disk into this tab. */
  opened?(tab: Tab): void;
  /** A tab was closed. */
  dropped?(tab: Tab): void;
}

/** File types AutoSave leaves alone: they keep only the values of one sheet, so saving loses the rest. */
const NO_AUTOSAVE = new Set(['csv', 'tsv', 'txt', 'sdf', 'sd']);

/** What each kind of tab saves as (the first is the default). */
const SAVE_TYPES: Record<Mode, FileType[]> = { drawing: [CDXML, CDX], slides: [PPTX], design: [PPTX], sheet: [XLSX, CSV, SDF], document: [DOCX] };

/** Tabs already told, this session, how their structures look in Office (said once, not on every save). */
const officeNoted = new WeakSet<Tab>();

/** What the structures in a Word or PowerPoint file are outside the app, said the first time a tab is saved. */
function officeNote(tab: Tab, program: 'Word' | 'PowerPoint'): string {
  if (officeNoted.has(tab)) return '';
  officeNoted.add(tab);
  return `. In ${program} the structures are pictures (their SMILES are in the alt text); open the file here to edit them, or copy them from here into ChemDraw`;
}

/** What a new, unsaved file of each kind is called ("Drawing 1"). */
export const MODE_NAMES: Record<Mode, string> = { drawing: 'Drawing', slides: 'Slides', sheet: 'Sheet', document: 'Document', design: 'Design' };

/** Is this the name a new tab was given (not a file's own)? */
export const isNewName = (name: string): boolean => /^(Drawing|Slides|Sheet|Document|Design) \d+\.[a-z]+$/.test(name) || /^Untitled/.test(name);

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
  /** While a workspace saves or opens: its files don't each go on the recent list (the workspace does). */
  private quiet = false;
  private nextId = 1;

  constructor(public host: Doc, private hooks: WorkspaceHooks) {
    const t = this.makeTab('drawing', this.untitled('drawing'));
    this.tabs.push(t);
    this.active = t;
    t.seen = host.version;
  }

  private makeTab(mode: Mode, name: string, ref: FileRef = { kind: 'none' }): Tab {
    return { id: this.nextId++, mode, name, ref, stash: new Doc(), deck: null, book: null, document: null, view: null, sheetState: null, dirty: false, seen: 0, savedEdits: 0, partner: null, windowOf: null,
      stamp: null, autoSave: null, changes: 0, savedAt: 0, savedHow: null };
  }

  /** "Drawing 1", "Slides 2", "Design 1"… with the right extension, not already used by an open tab. */
  private untitled(mode: Mode, going?: Tab): string {
    const ext = SAVE_TYPES[mode][0].extension;
    for (let n = 1; ; n++) {
      const name = `${MODE_NAMES[mode]} ${n}.${ext}`;
      if (!this.tabs.some((t) => t !== going && t.name === name)) return name;
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
    else if (t.mode === 'document') dirty = t.document!.edits !== this.mainOf(t).savedEdits;
    else if (this.host.version !== t.seen) {
      t.seen = this.host.version;
      t.changes++;
      dirty = true;
    }
    if (dirty !== t.dirty) {
      t.dirty = dirty;
      if (t.document) {
        // the other windows of the document, and the tab owning its file
        const main = this.mainOf(t);
        main.dirty = dirty;
        this.syncWindows(main);
      }
      this.hooks.changed();
    }
    const p = this.pane;
    if (p && this.host.version !== p.seen) {
      p.seen = this.host.version;
      p.changes++;
      if (!p.dirty) { p.dirty = true; this.hooks.changed(); }
    }
  }

  // ---------------------------------------------------------------- windows of a document

  /** The tabs that own their files (not the extra windows of a document): saved, AutoSaved, kept for recovery. */
  get fileTabs(): Tab[] {
    return this.tabs.filter((t) => !t.windowOf);
  }

  /** The tab that owns the file a tab shows. */
  mainOf(t: Tab): Tab {
    return t.windowOf ?? t;
  }

  /** As Word names the windows of a document: "Report.docx:1", "Report.docx:2"; just the name with one window. */
  label(t: Tab): string {
    if (!t.document) return t.name;
    const all = this.tabs.filter((x) => x.document === t.document);
    return all.length > 1 ? `${this.mainOf(t).name}:${all.indexOf(t) + 1}` : t.name;
  }

  /**
   * View > New Window: the document showing in another tab too, each with its own view and
   * place in the text. Typing in either shows in both; Save in either saves the one file.
   */
  newWindow(): Tab | null {
    const from = this.active;
    if (!from.document) return null;
    const main = this.mainOf(from);
    const t = this.makeTab('document', main.name, main.ref);
    t.document = from.document;
    t.windowOf = main;
    t.dirty = main.dirty;
    t.savedEdits = main.savedEdits;
    // after the last window of this document
    const last = Math.max(...this.tabs.map((x, i) => (x.document === from.document ? i : -1)));
    this.tabs.splice(last + 1, 0, t);
    this.activate(t, true);
    return t;
  }

  /** After a save (or a change): every window of the document shows what its file's tab shows. */
  private syncWindows(main: Tab): void {
    for (const w of this.tabs) {
      if (w.windowOf !== main) continue;
      w.dirty = main.dirty;
      w.savedEdits = main.savedEdits;
      w.ref = main.ref;
      w.name = main.name;
    }
  }

  /** The tab owning a file is closing while other windows of its document are open: the next window takes over the file. */
  private handOver(main: Tab): Tab | null {
    const next = this.tabs.find((w) => w.windowOf === main);
    if (!next) return null;
    next.windowOf = null;
    Object.assign(next, { ref: main.ref, name: main.name, stamp: main.stamp, autoSave: main.autoSave, savedAt: main.savedAt, savedHow: main.savedHow, savedEdits: main.savedEdits, dirty: main.dirty, partner: next.partner ?? main.partner });
    for (const w of this.tabs) if (w.windowOf === main) w.windowOf = next;
    return next;
  }

  // ---------------------------------------------------------------- new and open

  newDrawing(): Tab {
    const t = this.makeTab('drawing', this.untitled('drawing'));
    const st = this.hooks.newStyle?.('drawing');
    if (st) t.stash.style = { ...st };
    t.stash.page = this.hooks.newPage?.() ?? null;
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
    t.stash.page = this.hooks.newPage?.() ?? null;
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
  async openBytes(bytes: Uint8Array, name: string, ref: FileRef = { kind: 'none' }, file = name): Promise<boolean> {
    // the same file again: go to its tab
    const same = ref.kind === 'path' ? this.tabs.find((t) => t.ref.kind === 'path' && t.ref.path === ref.path) : null;
    if (same) {
      this.activate(same);
      if (same.dirty) this.hooks.flash(`${name} is already open (with changes not saved yet).`);
      return true;
    }
    const ext = extensionOf(file);
    if (ext === WORKSPACE.extension) {
      // a workspace lists files by where they are, so it needs its own place on disk
      if (ref.kind === 'path') await this.openWorkspace(new TextDecoder().decode(bytes), ref.path);
      else await showError(`${name} is a workspace: open it with File > Open Workspace in the desktop app.`);
      return ref.kind === 'path';
    }
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    try {
      let ok: boolean;
      if (ext === 'xlsx' || (zip && zipHas(bytes, 'xl/workbook.xml')) || ext === 'sdf' || ext === 'sd' || TABLE_TEXT_EXTENSIONS.includes(ext)) ok = await this.openSheet(bytes, name, ref, file);
      else if (ext === 'docx' || (zip && zipHas(bytes, 'word/document.xml'))) ok = await this.openDocument(bytes, name, ref, file);
      else if (ext === 'pptx' || zip) ok = this.openSlides(bytes, name, ref);
      else ok = this.openDrawing(isCdx(bytes) ? cdxToCdxml(bytes) : new TextDecoder().decode(bytes), name, ref);
      if (ok && ref.kind === 'path' && !this.quiet) this.hooks.remember?.(ref.path);
      if (ok && ref.kind !== 'none') {
        const t = this.active;
        t.stamp = await stampOf(ref);
        this.hooks.opened?.(t);
      }
      return ok;
    } catch (e) {
      await showError(`Could not open ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** The tab showing, when it is new and untouched (an opened file takes its place). */
  private spare(): Tab | null {
    const t = this.active;
    if (t.dirty || t.ref.kind !== 'none' || !isNewName(t.name)) return null;
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

  private async openSheet(bytes: Uint8Array, name: string, ref: FileRef, file: string): Promise<boolean> {
    const { book, warnings } = await this.hooks.sheets.read(bytes, file);
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

  private async openDocument(bytes: Uint8Array, name: string, ref: FileRef, file: string): Promise<boolean> {
    const { doc, warnings } = await this.hooks.documents.read(bytes, file);
    const spare = this.spare();
    const t = this.makeTab('document', name, ref);
    t.document = new DocFile(doc);
    this.tabs.splice(this.tabs.indexOf(this.active) + 1, 0, t);
    this.activate(t, true);
    if (spare) this.drop(spare);
    this.hooks.flash(`Opened ${name}.${warnings.length ? ' ' + warnings.join(' ') : ''}`, warnings.length ? 12000 : 3500);
    return true;
  }

  /**
   * Open a copy (a recovery copy, an earlier version, the file as changed on disk) in a tab that
   * takes the given name and file, unsaved if `dirty`. `file` is the copy's own name, which says
   * how to read it. With `replace`, the new tab takes that tab's place, which closes without asking.
   */
  async openAs(bytes: Uint8Array, file: string, as: { name: string; ref: FileRef; dirty: boolean; stamp: FileStamp | null; replace?: Tab }): Promise<Tab | null> {
    const before = this.active;
    if (!(await this.openBytes(bytes, as.name, { kind: 'none' }, file))) return null;
    const t = this.active;
    if (t === before) return null;
    t.ref = as.ref;
    t.stamp = as.stamp;
    if (as.dirty) {
      t.dirty = true;
      // decks, sheets and documents work out their unsaved mark from their change counts
      t.savedEdits = -1;
    }
    const old = as.replace;
    if (old && this.tabs.includes(old)) {
      t.autoSave = old.autoSave;
      for (const o of this.tabs) if (o.partner === old) o.partner = t;
      this.tabs.splice(this.tabs.indexOf(t), 1);
      this.tabs.splice(this.tabs.indexOf(old), 0, t);
      this.drop(old);
    }
    if (t.ref.kind !== 'none') this.hooks.opened?.(t);
    this.hooks.changed();
    return t;
  }

  // ---------------------------------------------------------------- closing

  /** Close a tab, offering to save changes first. False when the user chose to keep it open. */
  async close(tab: Tab = this.active): Promise<boolean> {
    // another window of a document: closing it closes nothing else (the document stays open in its other tabs)
    if (tab.windowOf) { this.drop(tab); return true; }
    if (this.handOver(tab)) { this.drop(tab); return true; }
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
        const t = this.makeTab('drawing', this.untitled('drawing', tab));
        this.tabs.push(t);
        this.activate(t, true);
      }
    }
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    tab.deck?.detach();
    this.hooks.dropped?.(tab);
    this.hooks.changed();
  }

  /** Before the window closes: offer to save each tab with changes. False to keep the window open. */
  async closeAll(): Promise<boolean> {
    for (const t of [...this.tabs]) {
      if (!t.dirty || t.windowOf) continue;
      this.activate(t);
      const answer = await askSaveChanges(t.name);
      if (answer === 'cancel') return false;
      if (answer === 'save' && !(await this.save(t))) return false;
    }
    return true;
  }

  get anyDirty(): boolean {
    return this.fileTabs.some((t) => t.dirty);
  }

  // ---------------------------------------------------------------- saving

  /** The tab's drawing (its document wherever it is). */
  docOf(tab: Tab): Doc {
    return tab === this.active || tab === this.pane ? this.host : tab.stash;
  }

  async save(tab: Tab = this.active, how: SaveHow = 'saved'): Promise<boolean> {
    // another window of a document saves the document's file
    tab = this.mainOf(tab);
    // a file of a kind this tab can't write (a drawing opened from an old file) goes through Save As
    if (!this.savesInPlace(tab)) return how === 'autosaved' ? false : this.saveAs(tab);
    return this.writeTo(tab, tab.ref, tab.name, how);
  }

  /** Whether Save writes straight back to the tab's file. */
  savesInPlace(tab: Tab): boolean {
    const ext = extensionOf(tab.name);
    return canSaveInPlace(tab.ref) && SAVE_TYPES[tab.mode].some((t) => t.extension === ext);
  }

  /** Whether AutoSave can keep this tab saved: it has a file it saves to without losing anything. */
  canAutoSave(tab: Tab): boolean {
    return this.savesInPlace(tab) && !NO_AUTOSAVE.has(extensionOf(tab.name));
  }

  /** Changes whenever the tab's contents change (for AutoSave and recovery copies). */
  token(tab: Tab): number {
    return tab.deck?.edits ?? tab.book?.edits ?? tab.document?.edits ?? tab.changes;
  }

  /** A copy of the tab in its own file type (drawings as .cdxml, sheets as .xlsx), changing nothing. */
  async copyOf(tab: Tab): Promise<{ name: string; data: Uint8Array }> {
    const name = withExtension(tab.name, SAVE_TYPES[tab.mode][0].extension);
    const { data } = await this.encode(tab, name);
    return { name, data: typeof data === 'string' ? new TextEncoder().encode(data) : data };
  }

  /** The tab's contents as the file `name` says (by its extension), without changing anything. */
  async encode(tab: Tab, name: string): Promise<{ data: string | Uint8Array; type: FileType; note: string }> {
    const ext = extensionOf(name);
    if (tab.deck) {
      const deck = tab.deck;
      const bytes = await writePptx({
        size: deck.size, master: deck.master, design: tab.mode === 'design',
        slides: deck.slides.map((s, i) => ({ layout: s.layout, doc: deck.docOf(i), notes: s.notes, transition: s.transition, anims: s.anims, comments: s.comments, background: s.background, hideGraphics: s.hideGraphics })),
      }, { ...this.hooks.pptx, title: name.replace(/\.[^.]+$/, '') });
      return { data: bytes, type: PPTX, note: '' };
    }
    if (tab.mode === 'sheet') {
      const book = tab.book!;
      const data = await this.hooks.sheets.write(book, name);
      // CSV and SD files keep only the values of the sheet showing: said, not stopped (as Excel does)
      const note = ext !== 'xlsx' ? ` (${book.sheets.length > 1 ? `only the sheet "${book.sheet.name}", ` : ''}values only: save as .xlsx to keep formulas and formatting)` : '';
      return { data, type: ext === 'csv' ? CSV : ext === 'sdf' || ext === 'sd' ? SDF : XLSX, note };
    }
    if (tab.mode === 'document') {
      // the contents' page numbers come from the printed pages, whatever view shows
      tab.document!.printLayout();
      return { data: await this.hooks.documents.write(tab.document!.t, name), type: DOCX, note: '' };
    }
    keepOnPage(this.docOf(tab));
    const text = writeCdxml(this.docOf(tab), { name, textMeasure: this.hooks.measure });
    return ext === 'cdx' ? { data: cdxmlToCdx(text), type: CDX, note: '' } : { data: text, type: CDXML, note: '' };
  }

  /** Said once per tab after a Word or PowerPoint save that holds structures. */
  private officeNoteFor(tab: Tab): string {
    if (tab.deck && tab.mode !== 'design' && tab.deck.slides.some((_, i) => tab.deck!.docOf(i).atoms.size)) return officeNote(tab, 'PowerPoint');
    if (tab.mode === 'document' && Object.values(tab.document!.t.objects).some((o) => o.kind === 'drawing')) return officeNote(tab, 'Word');
    return '';
  }

  async saveAs(tab: Tab = this.active): Promise<boolean> {
    tab = this.mainOf(tab);
    const types = SAVE_TYPES[tab.mode];
    const ext = extensionOf(tab.name);
    const first = types.find((t) => t.extension === ext) ?? types[0];
    const target = await saveFileDialog(withExtension(tab.name, first.extension), [first, ...types.filter((t) => t !== first)]).catch(async (e) => { await showError(String(e)); return null; });
    if (!target) return false;
    return this.writeTo(tab, target.ref, target.name);
  }

  private async writeTo(tab: Tab, ref: FileRef, name: string, how: SaveHow = 'saved'): Promise<boolean> {
    const auto = how === 'autosaved';
    // what the tab holds now: changes made while the file is being written stay unsaved
    const edits = tab.deck?.edits ?? tab.book?.edits ?? tab.document?.edits ?? 0;
    const live = tab === this.active || tab === this.pane;
    const version = this.host.version;
    const was = tab.ref;
    let enc;
    try {
      const go = (await this.hooks.beforeWrite?.(tab, ref, name, how)) ?? 'go';
      if (go === 'stop') return false;
      if (go === 'save-as') return this.saveAs(tab);
      enc = await this.encode(tab, name);
      await writeFile(ref, name, enc.data, enc.type);
      if (!auto) enc.note += this.officeNoteFor(tab);
      // later saves of a ChemDraw file rewrite only what changed since this one (unless it changed while being written)
      if (enc.type === CDXML && (!live || this.host.version === version)) adoptSaved(this.docOf(tab), enc.data as string);
    } catch (e) {
      const msg = `Could not save ${name}: ${e instanceof Error ? e.message : String(e)}`;
      if (auto) this.hooks.autoSaveFailed?.(tab, msg);
      else await showError(msg);
      return false;
    }
    if (tab.deck || tab.book || tab.document) {
      tab.savedEdits = edits;
      tab.dirty = (tab.deck?.edits ?? tab.book?.edits ?? tab.document?.edits) !== edits;
    } else if (live && this.host.version !== version) {
      tab.seen = this.host.version;
      tab.changes++;
      tab.dirty = true;
    } else {
      if (live) tab.seen = this.host.version;
      tab.dirty = false;
    }
    tab.ref = ref;
    tab.name = name;
    tab.savedAt = Date.now();
    tab.savedHow = how;
    tab.stamp = await stampOf(ref);
    this.syncWindows(tab);
    this.hooks.saved?.(tab, typeof enc.data === 'string' ? new TextEncoder().encode(enc.data) : enc.data, how, was);
    if (ref.kind === 'path' && !this.quiet) this.hooks.remember?.(ref.path);
    this.hooks.changed();
    if (!auto) this.hooks.flash((ref.kind === 'none' ? `Downloaded ${name}` : `Saved ${name}`) + enc.note, enc.note ? 8000 : 3500);
    return true;
  }

  // ---------------------------------------------------------------- workspaces

  /** Tabs with no file on disk yet (new, or downloaded in a browser): Save Workspace puts them in its folder. */
  get unsavedTabs(): Tab[] {
    return this.fileTabs.filter((t) => t.ref.kind !== 'path');
  }

  /**
   * File > Save Workspace: save the tabs and a list of them to `path`. Tabs that were never saved
   * go into the workspace file's folder; with `copyIn`, so do copies of files kept in other folders
   * (their tabs then save to the copies). With `saveChanges`, unsaved changes to files already on
   * disk are saved too. False if a file couldn't be written (the error has been shown).
   */
  async saveWorkspace(path: string, opts: { copyIn: boolean; saveChanges: boolean }): Promise<boolean> {
    this.quiet = true;
    try { return await this.saveWorkspaceFiles(path, opts); } finally { this.quiet = false; }
  }

  private async saveWorkspaceFiles(path: string, opts: { copyIn: boolean; saveChanges: boolean }): Promise<boolean> {
    const folder = folderOf(path);
    this.noteChange();
    const taken = new Set<string>();
    const own = this.fileTabs;
    for (const t of own) {
      const inFolder = t.ref.kind === 'path' && !/[\\/]/.test(relativeTo(folder, t.ref.path));
      if (t.ref.kind === 'path' && inFolder) taken.add(baseName(t.ref.path));
    }
    for (const t of own) {
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
    const index = new Map(own.map((t, i) => [t, i]));
    const tabs: WorkspaceEntry[] = own.map((t) => {
      const p = t.partner && index.has(t.partner) ? index.get(t.partner)! : undefined;
      return { file: relativeTo(folder, (t.ref as { path: string }).path), ...(p !== undefined ? { beside: p } : {}) };
    });
    try {
      await writeFile({ kind: 'path', path }, baseName(path), workspaceText({ tabs, active: own.indexOf(this.mainOf(this.active)) }), WORKSPACE);
    } catch (e) {
      await showError(`Could not save the workspace: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    this.workspacePath = path;
    this.hooks.remember?.(path);
    this.hooks.flash(`Saved workspace ${baseName(path)} with ${tabs.length} tab${tabs.length === 1 ? '' : 's'}.`);
    return true;
  }

  /**
   * File > Open Workspace: open every file a workspace lists, in order, beside the tabs already
   * open (a file already open just goes to its tab). Files that can't be found are named, not stopped for.
   */
  async openWorkspace(text: string, path: string): Promise<void> {
    this.quiet = true;
    try { await this.openWorkspaceFiles(text, path); } finally { this.quiet = false; }
  }

  private async openWorkspaceFiles(text: string, path: string): Promise<void> {
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
    this.hooks.remember?.(path);
    const n = opened.filter((t) => t).length;
    this.hooks.flash(`Opened workspace ${baseName(path)}: ${n} file${n === 1 ? '' : 's'}.` + (missing.length ? ` Not found: ${missing.join(', ')}.` : ''), missing.length ? 15000 : 4000);
  }
}
