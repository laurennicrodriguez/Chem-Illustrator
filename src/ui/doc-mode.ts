// Document mode: pages of text to type into, with Word's ribbon, keys and styles, and the
// chemistry: structures drawn with the drawing tools sit in the text, captions number
// themselves, references follow them, formulas format themselves as they are typed, and the
// spelling check knows chemistry words. The panel on the right shows the paragraph's formatting,
// its style, the page and the figure picked, every value of which can be typed in.

import { Doc, type Contents, type ParaStyle, type Shape, type TextRun } from '../model';
import { geoDef, geoShapeStyle } from '../design/geo';
import type { DocStyle } from '../style';
import type { Tab } from '../workspace';
import type { Measure } from '../text/layout';
import { keymap, chordOf, parseAction, type KeyContext } from '../editor/keymap';
import * as rt from '../richtext';
import type { Move } from '../text/editing';
import { offsetAt, caretPos, selectionRects } from '../text/layout';
import { htmlToRich, richToHtml, richToPlain } from '../text/html';
import { afterTyping, typingPrefs, setTypingPrefs } from '../text/typing';
import { findIssues, type CharLook, type Issue } from '../text/chemtext';
import { loadSpeller, type Speller } from '../text/spelling';
import { fitParas, paraAt, paraCount, paraRange, splitParagraphs } from '../text/paragraphs';
import { DocView, ACTUAL, type Overlay } from './doc-view';
import {
  PRINT_VIEW, VIEW_NAMES as VIEW_LABEL, changeLevel, withHeadings, continuous, foldHeadings, moveParas, newOutline, outlineLevel, shiftFolds, subtreeEnd, toggleFold,
  type DocViewKind, type OutlineOp, type OutlineState, type ScreenView,
} from '../document/doc-views';
import { DocPanel, parseLength, showLength, type DocBoxKey } from './doc-panel';
import { WORD_HIGHLIGHTS } from '../io/docx';
import { DocFind } from './doc-find';
import { askLink, followLink, linkTip } from './links-ui';
import { bookmarkName, linkAtPoint } from '../links';
import { addBookmark, bookmarkPara, bookmarksOf, docPlaces, placeLink, placeName, removeBookmark } from '../document/bookmarks';
import { DocComments } from './doc-comments';
import { TOF_NAMES, tocEntries, tofEntries } from '../document/toc';
import { changesIn, countChanges, decide, decideEverywhere, reviewAuthor, setReviewAuthor } from '../document/revisions';
import { ask } from './ask';
import { askEquation } from './equation-dialog';
import { ReferencesDialog, chooseReferences } from './references-dialog';
import { citeSuper, formatOf, type Reference } from '../document/references';
import { dataUrl, imageSize } from '../render/images';
import { editChart, chartPoints } from './chart-editor';
import { pictureFormat } from './picture-dialog';
import { newChartBox, sizedBox } from '../sheet/chart-box';
import { chartBoxPng } from '../render/chart-box-paint';
import type { DocFile } from '../document/doc-file';
import type { TableData } from '../model';
import {
  canMerge, coveringCell, deleteColumn, deleteRow, emptyTable, insertColumn, insertRow, isCovered, mergeDown, mergeRight, nextCell, rowSpanOf, setColumnAlign, setColumnWidth, setPart, splitCell, spanOf,
} from '../table';
import { CELL_PAD } from '../document/doc-layout';
import { BREAK_NAMES, changeSection, newBreak, pageNumText, sectionAt, sectionsOf, type Section, type SectionPatch } from '../document/sections';
import {
  A4, COMPOUND, INCH, LETTER, OBJECT_CHAR, CAPTION_NAMES, END_FORMAT, FOOT_FORMAT, captionRuns, noteLabel, noteStyle, nextObjectId, objectRun, objectsInText, runStyleOf, setParaStyle, styleOf, fieldTexts, objectOffsets, inlineMove,
  floatOf, lookExtent, lookOf, cellHolding, innerObjects,
  type BreakKind, type DocObject, type DocText, type FigureLook, type Float, type LineNumbers, type NoteFormat, type NumberPlace, type PageNumFormat, type PageSetup, type WrapKind,
} from '../document/document';

export interface DocModeHost {
  flash(msg: string, ms?: number): void;
  /** A key the document doesn't use itself (menu commands). True when it did something. */
  key(e: KeyboardEvent): boolean;
  /** One of the app's commands (a ribbon button the document doesn't run itself). */
  command(name: string): boolean;
  /** The document changed (for the unsaved mark on its tab). */
  changed(): void;
  /** Open the drawing tools on a drawing (null to draw a new one); `done` gets it, or null when cancelled. */
  editDrawing(contents: Contents | null, title: string, done: (c: Contents | null) => void): void;
  /** The diagram window (Insert > Diagram) on a figure's diagram, or for a new one (null); resolves to the drawing, or null when cancelled. */
  editDiagram?(contents: Contents | null): Promise<Contents | null>;
  /** Put a drawing on the clipboard, for ChemDraw and Word. */
  copyDrawing(contents: Contents, style: DocStyle): Promise<string>;
  /** What a paste brings: a drawing (from ChemDraw or a drawing here), a picture, or text. */
  readPaste(e: ClipboardEvent | null): Promise<DocPaste>;
  /** A name or SMILES as a drawing. */
  toStructure(text: string, style: DocStyle): Promise<{ contents: Contents; notes: string[] } | { error: string }>;
  /** Choose a picture file. */
  pickPicture(): Promise<{ bytes: Uint8Array; mime: string; name: string } | null>;
  /** An empty ACS-style table as a drawing. */
  newTable(rows: number, cols: number, style: DocStyle): Contents;
  /** Choose a BibTeX or RIS file and read its text (References > Manage References > Import). */
  pickReferenceFile(): Promise<{ name: string; text: string } | null>;
  /** The person chose a reference style for new documents (save settings). */
  preferredChanged?(): void;
  /** The name put on tracked changes was changed (save settings). */
  reviewNameChanged?(): void;
  measure: Measure;
}

export interface DocPaste {
  drawing?: Contents;
  picture?: { bytes: Uint8Array; mime: string };
  html?: string;
  text?: string;
}

const SELECTION_SQUIGGLE = '#e0302f';
const FORMATTING = '#2f6fdf';
/** Words ignored with "Ignore" while the program is open (lower case). */
const ignored = new Set<string>();
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Commands that, in a text box, work on its text (others leave the box first). */
const BOX_COMMANDS = /^(doc-(align-|justify|bold|italic|underline|sub|sup|formula|highlight|bullets|numbering|indent|outdent)|line-|font-|select-all$|undo$|redo$|zoom-|copy$|cut$|paste$|box-|find$|replace$|wrap-)/;

/** Commands that, in a table cell, work there too (others leave the cell first). */
const CELL_COMMANDS = /^(table-|tbl-|insert-table$|insert-structure$|structure-from-name-doc$|name-to-structure$|insert-picture$|edit-figure$|compound-number$|cross-reference$|insert-citation$)/;

/** A new table's look: Word's grid, the ACS rules in the text, or the ACS table drawn as a figure. */
export const TABLE_KINDS: [string, string][] = [
  ['grid', 'Plain table (grid lines, as in Word)'],
  ['acs', 'ACS table in the text (rules above, under the headings and at the bottom)'],
  ['none', 'No lines'],
  ['drawing', 'ACS table as a drawing (edited in the drawing tools)'],
];

/** Word's Wrap Text choices. */
export const WRAPS: [WrapKind | 'inline', string, string][] = [
  ['inline', 'In Line with Text', 'In the line, moving with the text as a letter does'],
  ['square', 'Square', 'On the page, with text down its wider side'],
  ['topBottom', 'Top and Bottom', 'On the page, with text above and below it only'],
  ['behind', 'Behind Text', 'On the page, under the text'],
  ['front', 'In Front of Text', 'On the page, over the text'],
];

const lookExtentOf = (o: DocObject) => lookExtent(lookOf(o));

/** A document tab's place while another tab shows: zoom and scroll, its view (View > Views), and the split pane's. */
interface DocPlace {
  zoom: number;
  top: number;
  left: number;
  screen?: ScreenView;
  perRow?: number;
  sideways?: boolean;
  split?: { zoom: number; top: number; left: number };
}

/** The view commands: View > Views. */
const VIEW_COMMANDS: Record<string, DocViewKind> = {
  'view-print': 'print', 'view-read': 'read', 'view-web': 'web', 'view-outline': 'outline', 'view-draft': 'draft',
};

/** Our own copy of document text, figures and all, for pasting back into a document. */
const OWN_KIND = 'chem-illustrator-document';

export class DocumentMode {
  /** The pane being worked in: the document's view, or with View > Split, the one clicked last. */
  view: DocView;
  /** Every pane on the document (two while split). */
  private views: DocView[] = [];
  /** View > Split: the second pane, under the first, and the bar between them. */
  private split: { view: DocView; host: HTMLDivElement; bar: HTMLDivElement } | null = null;
  /** Where the caret was last in Outline view (to step over folded text in the direction it went). */
  private lastFocus = 0;
  /** How many paragraphs the text had (Outline's folded headings move with the text). */
  private paraCountWas = 0;
  /** Read Mode is showing, from this page (the left of the two). */
  private reading = false;
  private readPage = 0;
  /** The arrangement and zoom before Read Mode, to go back to. */
  private readWas: { zoom: number; perRow: number; sideways: boolean } | null = null;
  /** The Outlining tab was put in front for Outline view (it goes when Outline does). */
  private outlineTabFor: DocFile | null = null;
  tab: Tab | null = null;
  private ta: HTMLTextAreaElement;
  private panel: DocPanel;
  private ribbon: HTMLElement;
  private caretOn = true;
  private blink: ReturnType<typeof setInterval> | null = null;
  private clicks = { n: 0, time: 0, at: { x: 0, y: 0 } };
  private dragging:
    | { kind: 'text' }
    | { kind: 'box' }
    | { kind: 'resize'; id: number; w0: number; scale0: number; x0: number }
    | { kind: 'move'; id: number; from: { x: number; y: number }; float: Float; moved: boolean }
    | { kind: 'inline'; id: number; from: { x: number; y: number }; to: number | null }
    | null = null;
  private plainPaste = false;
  private speller: Speller | null = null;
  private dictSeen: string[] | null = null;
  private checkCache = new Map<string, { spell: [number, number][]; issues: Issue[] }>();
  private checked: { t: DocText; spell: [number, number][]; issues: Issue[] } | null = null;
  private menu: HTMLDivElement | null = null;
  private finder: DocFind;
  /** The last copy made here: pasting the same text back brings its figures and fields too (and the references its citations cite). */
  private clip: (OwnCopy & { text: string }) | null = null;
  private refs: ReferencesDialog;
  /** Review > New Comment: comments beside the page. */
  readonly comments: DocComments;
  private readonly closeMenuOutside = (e: Event) => { if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu(); };

  constructor(private host: DocModeHost) {
    const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
    const docHost = $<HTMLDivElement>('#doc-host');
    this.view = new DocView(docHost);
    this.setupView(this.view);
    this.ribbon = $('#doc-ribbon');
    this.ta = document.createElement('textarea');
    this.ta.className = 'text-input doc-input';
    this.ta.setAttribute('aria-label', 'Document text');
    this.ta.spellcheck = false;
    this.ta.autocomplete = 'off';
    this.ta.setAttribute('autocorrect', 'off');
    this.ta.setAttribute('autocapitalize', 'off');
    this.ta.wrap = 'off';
    docHost.append(this.ta);
    this.finder = new DocFind(docHost, {
      file: () => this.file,
      focus: () => this.focus(),
      flash: (msg, ms) => this.host.flash(msg, ms),
      redraw: () => this.redraw(),
    });
    this.panel = new DocPanel($('#doc-body'), {
      file: () => this.file,
      run: (cmd) => this.run(cmd),
      focus: () => this.focus(),
      editFigure: (id) => this.editFigure(id),
      picked: () => this.pickedObject() ?? (this.file?.box && !this.file.box.cell ? this.file.box.id : null),
      setScale: (id, k) => this.setScale(id, k),
      setWrap: (id, w) => this.setWrap(id, w),
      setFloat: (id, fl) => this.setFloat(id, fl),
      setBoxWidth: (id, w) => this.setBoxWidth(id, w),
      setFill: (id, c) => this.setFill(id, c),
      setLook: (id, patch) => this.setLook(id, patch),
      lookOf: (id) => this.lookOf(id),
    });
    this.comments = new DocComments(docHost, this.view, {
      file: () => this.file,
      focus: () => this.focus(),
      flash: (msg, ms) => this.host.flash(msg, ms),
      askName: () => this.askReviewName(),
    });
    this.refs = new ReferencesDialog({
      file: () => this.file,
      flash: (msg, ms) => this.host.flash(msg, ms),
      pickFile: () => this.host.pickReferenceFile(),
      preferredChanged: () => this.host.preferredChanged?.(),
    });
    this.wireInput();
    this.wirePointer(this.view);
    this.wireRibbon();
    if (typingPrefs.spelling) void loadSpeller().then((sp) => { this.speller = sp; this.checked = null; this.redraw(); });
  }

  get file(): DocFile | null {
    return this.tab?.document ?? null;
  }

  /** Where typing goes: the text box being typed into, or the document. */
  private get ed() {
    return this.file!.textEd;
  }

  /** Start typing into a text box (the caret at the end of its text, or at a point on it). */
  private startBox(id: number, at?: { x: number; y: number }): boolean {
    const f = this.file;
    if (!f) return false;
    const ed = f.editBox(id);
    if (!ed) return false;
    ed.onTyped = (typed) => afterTyping(ed, typed);
    if (at) ed.setCaret(offsetAt(ed.layout(), at.x, at.y));
    else ed.setCaret(ed.text.length);
    this.changed('selection');
    return true;
  }

  /** Start typing into a table cell (the caret at a point in it, or at its start or end). */
  private startCell(id: number, r: number, c: number, at: { x: number; y: number } | 'start' | 'end' = 'end'): boolean {
    const f = this.file;
    if (!f) return false;
    if (f.box && (f.box.id !== id || f.box.cell?.r !== r || f.box.cell?.c !== c)) f.endBox();
    const ed = f.editCell(id, r, c);
    if (!ed) return false;
    ed.onTyped = (typed) => afterTyping(ed, typed);
    if (at === 'start') ed.setCaret(0);
    else if (at === 'end') ed.setCaret(ed.text.length);
    else ed.setCaret(offsetAt(ed.layout(), at.x, at.y));
    this.changed('selection');
    return true;
  }

  /** The table cell under a point (in the document's coordinates), if any. */
  private cellAt(p: { x: number; y: number }): { id: number; r: number; c: number } | null {
    const f = this.file;
    if (!f) return null;
    const lay = f.layout();
    // (in a table inside a cell, its own cell)
    let best: { id: number; r: number; c: number; depth: number } | null = null;
    for (const [id, tb] of lay.tables) {
      const o = f.t.objects[id];
      if (o?.kind !== 'table' || (best && best.depth >= tb.depth)) continue;
      const W = tb.xs[tb.xs.length - 1];
      for (let r = 0; r < tb.rows.length; r++) {
        const at = tb.rows[r];
        if (p.x < at.x || p.x > at.x + W || p.y < at.y || p.y > at.y + tb.hs[r]) continue;
        let c = 0;
        while (c < tb.xs.length - 2 && p.x > at.x + tb.xs[c + 1]) c++;
        const cv = coveringCell(o.table, r, c);
        best = { id, r: cv.r, c: cv.c, depth: tb.depth };
        break;
      }
    }
    return best && { id: best.id, r: best.r, c: best.c };
  }

  /** The table picked on its own (a selection of just its character), if any. */
  private pickedTable(): number | null {
    const f = this.file;
    if (!f || f.box) return null;
    const ed = f.ed;
    if (ed.end - ed.start !== 1) return null;
    const id = rt.sliceRuns(ed.t.runs, ed.start, ed.end)[0]?.obj;
    return id !== undefined && f.t.objects[id]?.kind === 'table' ? id : null;
  }

  /** The table and cell the Table tab works on: the cell typed into, or the last cell of the table picked. */
  private tableTarget(): { id: number; r: number; c: number; t: TableData } | null {
    const f = this.file;
    if (!f) return null;
    if (f.box?.cell) {
      const o = f.t.objects[f.box.id];
      return o?.kind === 'table' ? { id: f.box.id, ...f.box.cell, t: o.table } : null;
    }
    const id = this.pickedTable();
    const o = id !== null ? f.t.objects[id] : undefined;
    if (id === null || o?.kind !== 'table') return null;
    const r = o.table.rows.length - 1;
    return { id, ...coveringCell(o.table, r, o.table.cols.length - 1), t: o.table };
  }

  /** Where the caret is in a table cell (to come back to after the drawing tools or a dialog). */
  private cellSpot(): { id: number; r: number; c: number; start: number; end: number } | null {
    const b = this.file?.box;
    return b?.cell ? { id: b.id, ...b.cell, start: b.ed.start, end: b.ed.end } : null;
  }

  private backToCell(s: { id: number; r: number; c: number; start: number; end: number } | null): void {
    const f = this.file;
    if (!s || !f) return;
    if (f.box?.id === s.id && f.box.cell?.r === s.r && f.box.cell.c === s.c) return;
    if (!this.startCell(s.id, s.r, s.c)) return;
    const ed = f.box!.ed;
    const n = ed.text.length;
    ed.select(Math.min(s.start, n), Math.min(s.end, n));
  }

  /** Arrow keys past the edge of a cell: on to the next cell, or out of the table. */
  private cellStep(dir: 'up' | 'down' | 'left' | 'right'): void {
    const tg = this.tableTarget();
    const f = this.file!;
    if (!tg || !f.box?.cell) return;
    const back = dir === 'up' || dir === 'left';
    let to: { r: number; c: number } | null;
    if (dir === 'left' || dir === 'right') to = nextCell(tg.t, tg.r, tg.c, back);
    else {
      const r = tg.r + (back ? -1 : rowSpanOf(tg.t, tg.r, tg.c));
      to = r >= 0 && r < tg.t.rows.length ? coveringCell(tg.t, r, tg.c) : null;
    }
    if (to) { this.startCell(tg.id, to.r, to.c, back ? 'end' : 'start'); return; }
    // out of a table inside a cell: into that cell, before or after the table
    const holder = cellHolding(f.t, tg.id);
    const ho = holder ? f.t.objects[holder.id] : undefined;
    if (holder && ho?.kind === 'table' && this.startCell(holder.id, holder.r, holder.c)) {
      const k = objectOffsets(ho.table.rows[holder.r][holder.c].runs).get(tg.id);
      if (k !== undefined) f.box?.ed.setCaret(back ? k : k + 1);
      this.changed('selection');
      return;
    }
    this.stopBox();
    const at = objectOffsets(f.t.runs).get(tg.id);
    if (at !== undefined) f.ed.setCaret(back ? at : at + 1);
  }

  /** Tab in a table: the next cell (its text selected, as in Word); in the last cell, a new row. */
  private tabCell(back: boolean): void {
    const tg = this.tableTarget();
    if (!tg) return;
    const to = nextCell(tg.t, tg.r, tg.c, back);
    if (to) {
      this.startCell(tg.id, to.r, to.c);
      this.file!.box?.ed.selectAll();
      this.changed('selection');
      return;
    }
    if (!back) this.setTable(tg.id, insertRow(tg.t, tg.t.rows.length), 'Insert row', { r: tg.t.rows.length, c: 0 });
  }

  /** Change a table in the text (one undo step), and go back into a cell of it (the same one, or `go`). */
  setTable(id: number, table: TableData, kind: string, go?: { r: number; c: number } | null): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'table') return;
    const keep = go !== undefined ? go : f.box?.id === id ? f.box.cell ?? null : null;
    f.endBox();
    // (the Table tab stays up while the table changes)
    this.keepTableTab = true;
    try {
      f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...o, table } } } as DocText, kind);
    } finally { this.keepTableTab = false; }
    if (keep && table.rows.length) {
      const cv = coveringCell(table, Math.min(keep.r, table.rows.length - 1), Math.min(keep.c, table.cols.length - 1));
      this.startCell(id, cv.r, cv.c);
    } else this.changed('selection');
  }

  /** The Table tab's commands (and the table part of the right-click menu). */
  private tableCommand(cmd: string): void {
    const tg = this.tableTarget();
    if (!tg) { this.host.flash('Click in a table first.'); return; }
    const { id, r, c, t } = tg;
    const f = this.file!;
    const span = spanOf(t, r, c);
    const lay = f.layout();
    switch (cmd) {
      case 'table-row-above': this.setTable(id, insertRow(t, r), 'Insert row', { r, c }); break;
      case 'table-row-below': this.setTable(id, insertRow(t, r + rowSpanOf(t, r, c)), 'Insert row', { r: r + rowSpanOf(t, r, c), c }); break;
      case 'table-col-left': this.setTable(id, insertColumn(t, c), 'Insert column', { r, c }); break;
      case 'table-col-right': this.setTable(id, insertColumn(t, c + span), 'Insert column', { r, c: c + span }); break;
      case 'table-del-row':
        if (t.rows.length <= 1) { this.tableCommand('table-delete'); return; }
        this.setTable(id, deleteRow(t, r), 'Delete row', { r: Math.min(r, t.rows.length - 2), c });
        break;
      case 'table-del-col':
        if (t.cols.length <= 1) { this.tableCommand('table-delete'); return; }
        this.setTable(id, deleteColumn(t, c), 'Delete column', { r, c: Math.min(c, t.cols.length - 2) });
        break;
      case 'table-delete': {
        // a table inside a cell: out of the cell's text
        const holder = cellHolding(f.t, id);
        const ho = holder ? f.t.objects[holder.id] : undefined;
        if (holder && ho?.kind === 'table') {
          const cell = ho.table.rows[holder.r][holder.c];
          this.stopBox();
          this.setTable(holder.id, setPart(ho.table, holder, { runs: cell.runs.filter((x) => x.obj !== id), paras: cell.paras }), 'Delete table', holder);
          break;
        }
        this.stopBox();
        const at = objectOffsets(f.t.runs).get(id);
        if (at !== undefined) { f.ed.select(at, at + 1); f.ed.replaceSelection([], undefined, 'Delete table'); }
        break;
      }
      case 'table-select': this.stopBox(true); break;
      case 'table-merge':
        if (!canMerge(t, r, c, 'right')) { this.host.flash(c + span >= t.cols.length ? 'There is no cell to the right to merge with.' : 'The cell to the right covers other rows: merge cells that line up.'); return; }
        this.setTable(id, mergeRight(t, r, c), 'Merge cells', { r, c });
        break;
      case 'table-merge-down':
        if (!canMerge(t, r, c, 'down')) { this.host.flash(r + rowSpanOf(t, r, c) >= t.rows.length ? 'There is no cell below to merge with.' : 'The cell below is a different width: merge cells that line up.'); return; }
        this.setTable(id, mergeDown(t, r, c), 'Merge cells', { r, c });
        break;
      case 'table-split': this.setTable(id, splitCell(t, r, c), 'Split cells', { r, c }); break;
      case 'table-nest': void this.insertTable(true); break;
      case 'table-lines-grid': case 'table-lines-acs': case 'table-lines-none':
        this.setTable(id, { ...t, lines: cmd.slice(12) as TableData['lines'] }, 'Table lines');
        break;
      case 'table-valign-top': case 'table-valign-center': case 'table-valign-bottom': {
        const v = cmd.slice(13);
        this.setTable(id, mapCells(t, (cell, rr, cc) => (this.inChosen(tg, rr, cc) ? { ...cell, valign: v === 'top' ? undefined : v as 'center' | 'bottom' } : cell)), 'Cell alignment');
        break;
      }
      case 'table-shade-none': this.shade(undefined); break;
      case 'table-align-left': case 'table-align-center': case 'table-align-right': this.alignColumn(cmd.slice(12) as 'left' | 'center' | 'right'); break;
      case 'table-fit': this.setTable(id, fitDocColumns(t, f, lay.textW), 'Fit columns'); break;
      case 'table-even': this.setTable(id, { ...t, cols: t.cols.map(() => Math.floor((Math.min(lay.textW, t.cols.reduce((a, b) => a + b, 0)) / t.cols.length) * 100) / 100) }, 'Even columns'); break;
      case 'table-fill-width': this.setTable(id, { ...t, cols: t.cols.map((w) => (w * lay.textW) / t.cols.reduce((a, b) => a + b, 0)) }, 'Fit to page'); break;
      case 'table-head-more': this.setTable(id, { ...t, head: Math.min(t.rows.length, t.head + 1) }, 'Heading rows'); break;
      case 'table-head-less': this.setTable(id, { ...t, head: Math.max(0, t.head - 1) }, 'Heading rows'); break;
      default: this.host.flash(`Unknown table command ${cmd}`);
    }
  }

  /** Whether a cell is one the cell commands change: the cell typed into, or every cell of a picked table. */
  private inChosen(tg: { r: number; c: number }, r: number, c: number): boolean {
    return !this.file?.box?.cell || (r === tg.r && c === tg.c);
  }

  /** Shade the cell typed into (or the whole table picked) with a colour, or take the shading off. */
  shade(fill: string | undefined): void {
    const tg = this.tableTarget();
    if (!tg) return;
    this.setTable(tg.id, mapCells(tg.t, (cell, r, c) => {
      if (!this.inChosen(tg, r, c)) return cell;
      const out = { ...cell, fill };
      if (!fill) delete out.fill;
      return out;
    }), 'Shading');
  }

  /** Set the width of the column of the cell typed into (or of every column of a picked table). */
  setColumnWidthOf(w: number): void {
    const tg = this.tableTarget();
    if (!tg || !(w > 0)) return;
    let t = tg.t;
    if (this.file?.box?.cell) t = setColumnWidth(t, tg.c, w);
    else t = { ...t, cols: t.cols.map(() => Math.max(4, w)) };
    this.setTable(tg.id, t, 'Column width');
  }

  /** Line up the text of the column of the cell typed into (or every column of a picked table). */
  alignColumn(a: 'left' | 'center' | 'right'): void {
    const tg = this.tableTarget();
    if (!tg) return;
    let t = tg.t;
    if (this.file?.box?.cell) t = setColumnAlign(t, tg.c, a);
    else for (let c = 0; c < t.cols.length; c++) t = setColumnAlign(t, c, a);
    this.setTable(tg.id, t, 'Column alignment');
  }

  /** Is there something for Undo (or Redo) to take back, in the cell being typed in or the document. */
  canUndo(redo = false): boolean {
    const f = this.file;
    if (!f) return false;
    const has = (ed: { canUndo: boolean; canRedo: boolean }) => (redo ? ed.canRedo : ed.canUndo);
    return has(this.ed) || (!!f.box?.cell && has(f.ed));
  }

  /** Undo and Redo: in a table cell, its typing first, then the document's changes (rows added…). */
  private undo(redo: boolean): void {
    const f = this.file!;
    const b = f.box;
    if (b?.cell && !(redo ? b.ed.canRedo : b.ed.canUndo)) {
      const { id, cell } = b;
      f.endBox();
      if (redo) f.ed.redo(); else f.ed.undo();
      const o = f.t.objects[id];
      if (o?.kind === 'table' && o.table.rows[cell.r]?.[cell.c] && !isCovered(o.table, cell.r, cell.c)) this.startCell(id, cell.r, cell.c);
      else this.changed('selection');
      return;
    }
    if (redo) this.ed.redo(); else this.ed.undo();
  }

  /** Stop typing into the text box (`pick`: and pick the box, as Escape does in Word). */
  private stopBox(pick = false): void {
    const f = this.file;
    if (!f?.box) return;
    const id = f.box.id;
    f.endBox();
    if (pick) {
      const at = objectOffsets(f.t.runs).get(id);
      // a footnote goes back to its number in the text (Word's Shift+F5)
      if (at !== undefined && f.t.objects[id]?.kind === 'note') {
        f.ed.setCaret(at + 1);
        // what is typed after the number isn't raised like it
        f.ed.setStyle({ sup: undefined });
      }
      else if (at !== undefined) f.ed.select(at, at + 1);
    }
    this.changed('selection');
  }

  // ---------------------------------------------------------------- showing a tab

  /** A document tab came to the front (or null: another kind of tab). */
  show(tab: Tab | null): void {
    if (this.tab && this.tab !== tab) this.leave();
    this.tab?.document?.endBox();
    this.tab = tab;
    const f = tab?.document ?? null;
    for (const v of this.views) v.file = f;
    if (!f) {
      if (this.blink) { clearInterval(this.blink); this.blink = null; }
      this.panel.closeBoxes();
      this.comments.update();
      return;
    }
    f.listener = (kind) => this.changed(kind);
    // chemistry as it's typed: CH2Cl2 becomes a formula, -> an arrow… (Edit > Typing and Spelling)
    f.ed.onTyped = (typed) => afterTyping(f.ed, typed);
    const st = tab!.sheetState as DocPlace | null;
    // each tab (each window of a document) has its own view of it
    f.view = st?.screen ?? PRINT_VIEW;
    this.activate(this.views[0]);
    this.view.perRow = st?.perRow ?? 1;
    this.view.sideways = st?.sideways ?? false;
    this.setSplit(!!st?.split && f.view.kind !== 'read');
    this.view.resize();
    if (st) {
      this.view.zoom = st.zoom;
      this.view.sizeSpace();
      this.view.scroller.scrollTop = st.top;
      this.view.scroller.scrollLeft = st.left;
      if (this.split && st.split) {
        const v = this.split.view;
        v.zoom = st.split.zoom;
        v.sizeSpace();
        v.scroller.scrollTop = st.split.top;
        v.scroller.scrollLeft = st.split.left;
      }
    } else if (this.view.scroller.clientWidth < f.layout().pageW * ACTUAL + 48) this.view.fitWidth();
    else this.view.setZoom(ACTUAL);
    this.paraCountWas = paraCount(f.ed.text);
    this.showViewKind();
    if (f.view.kind === 'read') this.startReading();
    this.blink ??= setInterval(() => { this.caretOn = !this.caretOn; this.redraw(); }, 530);
    this.changed('selection');
    requestAnimationFrame(() => this.focus());
  }

  /** Before another tab shows: keep the zoom and scroll. */
  leave(): void {
    const t = this.tab;
    if (!t?.document) return;
    const main = this.views[0], sp = this.split?.view;
    const was = this.readWas;
    t.sheetState = {
      zoom: was?.zoom ?? main.zoom, top: main.scroller.scrollTop, left: main.scroller.scrollLeft,
      screen: t.document.view, perRow: was?.perRow ?? main.perRow, sideways: was?.sideways ?? main.sideways,
      split: sp ? { zoom: sp.zoom, top: sp.scroller.scrollTop, left: sp.scroller.scrollLeft } : undefined,
    } satisfies DocPlace;
    this.stopReading();
    t.document.listener = () => {};
    this.closeMenu();
    this.finder.close(false);
  }

  focus(): void {
    if (this.file) this.ta.focus({ preventScroll: true });
  }

  /** Fonts finished loading: measure again. */
  fontsChanged(): void {
    this.file?.relayout();
    this.sizeSpaces();
    this.redraw();
  }

  // ---------------------------------------------------------------- changes

  private changed(kind: 'text' | 'selection'): void {
    const f = this.file;
    if (!f) return;
    // the text box being typed into was taken away (Undo, Cut)
    if (f.box) {
      const bo = f.t.objects[f.box.id];
      const cell = f.box.cell;
      const ok = cell ? bo?.kind === 'table' && !!bo.table.rows[cell.r]?.[cell.c] && !isCovered(bo.table, cell.r, cell.c) : bo?.kind === 'textbox' || bo?.kind === 'note';
      if (!ok) f.endBox();
    }
    this.caretOn = true;
    if (kind === 'text') this.keepFolds();
    // Outline: off text folded out of sight (this comes back here once moved)
    if (this.snapShown()) {
      if (kind === 'text') { this.sizeSpaces(); this.host.changed(); }
      return;
    }
    if (kind === 'text') {
      this.sizeSpaces();
      this.host.changed();
      if (this.finder.open) this.finder.refresh();
    } else if (this.finder.open) this.finder.showCount();
    if (kind === 'text' || !this.ed.composing) this.syncInput();
    this.revealCaret();
    this.placeInput();
    this.updateRibbon();
    this.panel.update();
    this.comments.followCaret();
    this.comments.update();
    this.updateOutlineRibbon();
    this.redraw();
  }

  /** Keep the caret in view after it moves. */
  private revealCaret(): void {
    if (!this.file || this.dragging?.kind === 'resize') return;
    const c = this.ed.caret();
    this.view.reveal({ x1: c.x, y1: c.y1, x2: c.x, y2: c.y2 });
  }

  /** The hidden text field sits at the caret, so an input method's word list shows there. */
  private placeInput(): void {
    if (!this.file) return;
    const c = this.ed.caret();
    const p = this.view.toScreen(c.x, c.y1);
    this.ta.style.left = `${p.x}px`;
    this.ta.style.top = `${p.y}px`;
    this.ta.style.height = `${Math.max(8, (c.y2 - c.y1) * this.view.zoom)}px`;
  }

  /** The figure picked on its own (a selection of just its character), if any. */
  pickedObject(): number | null {
    const f = this.file;
    if (!f) return null;
    // a structure or picture in a table cell is picked in the cell's text
    const ed = f.textEd;
    if (ed.end - ed.start !== 1) return null;
    const runs = rt.sliceRuns(ed.t.runs, ed.start, ed.end);
    const id = runs[0]?.obj;
    const o = id !== undefined ? f.t.objects[id] : undefined;
    return o && (o.kind === 'drawing' || o.kind === 'picture' || o.kind === 'textbox') ? id! : null;
  }

  private overlay(pane: DocView = this.view): Overlay {
    const f = this.file;
    if (!f) return { selection: null, caret: null, squiggles: [], picked: null, found: [], framed: null };
    const ov = this.overlayNow(f);
    // the caret shows in the pane being worked in, and not in Read Mode
    if (pane !== this.view || f.view.kind === 'read') ov.caret = null;
    if (f.view.kind === 'read') ov.squiggles = [];
    return ov;
  }

  private overlayNow(f: DocFile): Overlay {
    if (f.box) {
      // typing into a text box: its caret and selection
      const ed = f.box.ed;
      const showCaret = this.caretOn && (ed.collapsed || ed.composing !== null) && document.activeElement === this.ta;
      const lay = ed.layout();
      const picked = this.pickedObject();
      return {
        selection: null, caret: showCaret ? ed.caret() : null, squiggles: [], picked, framed: null,
        found: this.finder.open ? this.finder.hits : [],
        editing: { id: f.box.id, cell: !!f.box.cell, selection: ed.collapsed || ed.composing || picked !== null ? [] : selectionRects(lay, ed.start, ed.end) },
      };
    }
    const ed = f.ed;
    const picked = this.pickedObject();
    const framed = this.pickedField('bib')?.id ?? this.pickedField('toc')?.id ?? this.pickedField('tof')?.id ?? this.pickedTable();
    const showCaret = this.caretOn && (ed.collapsed || ed.composing !== null) && document.activeElement === this.ta;
    const c = showCaret ? ed.caret() : null;
    const squiggles: Overlay['squiggles'] = [];
    if (ed.composing === null && typingPrefs.spelling) {
      const ch = this.checks();
      for (const [a, b] of ch.spell) squiggles.push({ start: a, end: b, color: SELECTION_SQUIGGLE });
      for (const i of ch.issues) squiggles.push({ start: i.start, end: i.end, color: FORMATTING });
    }
    return {
      selection: !ed.collapsed && picked === null && framed === null && !ed.composing ? [ed.start, ed.end] : null,
      caret: c,
      squiggles,
      picked,
      found: this.finder.open ? this.finder.hits : [],
      framed,
      comments: this.comments.shading(),
    };
  }

  /** A citation or bibliography picked on its own (a selection of just its character). */
  private pickedField<K extends 'cite' | 'bib' | 'toc' | 'tof' | 'note'>(kind: K): { id: number; o: Extract<DocObject, { kind: K }> } | null {
    const f = this.file;
    if (!f || f.ed.end - f.ed.start !== 1) return null;
    const id = rt.sliceRuns(f.ed.t.runs, f.ed.start, f.ed.end)[0]?.obj;
    const o = id !== undefined ? f.t.objects[id] : undefined;
    return o?.kind === kind ? { id: id!, o: o as Extract<DocObject, { kind: K }> } : null;
  }

  // ---------------------------------------------------------------- spelling and chemistry checks

  /** Misspelled words and chemistry formatting slips (not the word being typed), paragraph by paragraph. */
  private checks(): { spell: [number, number][]; issues: Issue[] } {
    const f = this.file!;
    const sp = this.speller;
    if (sp && this.dictSeen !== typingPrefs.dictionary) {
      sp.setPersonal(typingPrefs.dictionary);
      for (const w of ignored) sp.ignore(w);
      this.dictSeen = typingPrefs.dictionary;
      this.checkCache.clear();
      this.checked = null;
    }
    if (!this.checked || this.checked.t !== f.t) {
      const leave = new Set([...ignored, ...typingPrefs.dictionary.map((w) => w.toLowerCase())]);
      const spell: [number, number][] = [];
      const issues: Issue[] = [];
      let at = 0;
      const used = new Set<string>();
      for (const runs of splitParagraphs(f.t.runs)) {
        const text = runs.map((r) => r.text).join('');
        const key = (sp ? 's' : '') + JSON.stringify(runs.map((r) => [r.text, r.sub, r.sup, r.formula, r.italic]));
        let got = this.checkCache.get(key);
        if (!got) {
          const looks = runLooks(runs);
          got = { spell: sp ? sp.misspelled(text) : [], issues: findIssues(text, (i) => looks[i] ?? { pos: 'base', italic: false }, leave) };
          this.checkCache.set(key, got);
        }
        used.add(key);
        for (const [a, b] of got.spell) spell.push([a + at, b + at]);
        for (const i of got.issues) issues.push({ ...i, start: i.start + at, end: i.end + at, edits: i.edits.map((e) => ({ ...e, start: e.start + at, end: e.end + at })) });
        at += text.length + 1;
      }
      if (this.checkCache.size > used.size * 2 + 500) for (const k of [...this.checkCache.keys()]) if (!used.has(k)) this.checkCache.delete(k);
      this.checked = { t: f.t, spell, issues };
    }
    // the word the caret is at the end of is still being typed
    const ed = f.ed;
    const at = ed.collapsed ? ed.focus : -1;
    const typing = ([a, b]: [number, number]) => at > a && at <= b;
    return { spell: this.checked.spell.filter((s) => !typing(s)), issues: this.checked.issues.filter((i) => !typing([i.start, i.end])) };
  }

  private contextMenu(offset: number, clientX: number, clientY: number): boolean {
    this.closeMenu();
    const c = this.checks();
    const near = (a: number, b: number) => offset >= a && offset <= b;
    const word = c.spell.find(([a, b]) => near(a, b));
    const issue = c.issues.find((i) => near(i.start, i.end));
    const ed = this.ed;
    const menu = document.createElement('div');
    menu.className = 'text-menu';
    menu.setAttribute('role', 'menu');
    const item = (label: string, on: (() => void) | null, title?: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      if (title) b.title = title;
      b.disabled = !on;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { this.closeMenu(); on?.(); this.focus(); });
      menu.appendChild(b);
    };
    if (issue) {
      item(`${issue.message}: change to ${issue.fixed}`, () => ed.fix(issue.edits, 'fix'));
      item('Leave as written', () => { ignored.add(ed.text.slice(issue.start, issue.end).toLowerCase()); this.checkCache.clear(); this.checked = null; this.redraw(); });
    }
    if (word) {
      if (issue) menu.appendChild(document.createElement('hr'));
      const [a, b] = word;
      const text = ed.text.slice(a, b);
      const sugg = this.speller?.suggestions(text) ?? [];
      for (const w of sugg) item(w, () => ed.fix([{ start: a, end: b, text: w }], 'spell'));
      if (!sugg.length) item('No suggestions', null);
      menu.appendChild(document.createElement('hr'));
      item('Add to Dictionary', () => setTypingPrefs({ dictionary: [...typingPrefs.dictionary, text] }), 'Accept this word from now on (Edit > Typing and Spelling lists your words)');
      item('Ignore', () => { ignored.add(text.toLowerCase()); this.speller?.ignore(text); this.checkCache.clear(); this.checked = null; this.redraw(); }, 'Accept this word until the program is closed');
    }
    // a link here
    const linkHere = rt.sliceRuns(ed.t.runs, offset, offset + 1)[0]?.link ?? (offset > 0 ? rt.sliceRuns(ed.t.runs, offset - 1, offset)[0]?.link : undefined);
    if (linkHere) {
      if (word || issue) menu.appendChild(document.createElement('hr'));
      if (ed.collapsed || !ed.linkHere()) ed.setCaret(offset);
      item('Edit Link…', () => void this.editLink());
      item('Open Link', () => void followLink(linkHere), 'Or Ctrl+click the link');
      item('Copy Link', () => void navigator.clipboard?.writeText(linkHere).catch(() => {}));
      item('Remove Link', () => ed.removeLink());
    }
    // the usual commands, as on the ribbon
    if (word || issue || linkHere) menu.appendChild(document.createElement('hr'));
    const cmd = (label: string, name: string, title?: string) => item(label, () => { if (!this.run(name)) this.host.command(name); }, title);
    // an equation here
    const mathHere = [offset, offset - 1].map((at) => (at >= 0 ? rt.sliceRuns(ed.t.runs, at, at + 1)[0]?.obj : undefined)).find((x) => x !== undefined && this.file?.t.objects[x]?.kind === 'math');
    if (mathHere !== undefined) {
      item('Edit Equation…', () => void this.editEquation(mathHere), 'Change it in the equation window (or double-click it)');
      menu.appendChild(document.createElement('hr'));
    }
    // a tracked change here (Review tab)
    const change = this.file ? changesIn(this.file.t.runs).find((x) => x.start <= offset && offset <= x.end) : undefined;
    if (change) {
      const what = `${change.kind === 'ins' ? 'Insertion' : 'Deletion'} by ${change.author || 'unknown'}`;
      const pick = (accept: boolean) => () => { if (ed.collapsed || ed.end <= change.start || ed.start >= change.end) ed.select(change.start, change.start); this.decideChange(accept); };
      item(`Accept ${what}`, pick(true));
      item(`Reject ${what}`, pick(false));
      menu.appendChild(document.createElement('hr'));
    }
    cmd('Cut', 'cut');
    cmd('Copy', 'copy');
    cmd('Paste', 'paste');
    menu.appendChild(document.createElement('hr'));
    // a footnote's number, or typing in a note: to the other end, or the other kind
    const fb = this.file?.box && !this.file.box.cell && this.file.t.objects[this.file.box.id]?.kind === 'note' ? this.file.box.id : null;
    const note = fb ?? (this.file?.box ? null : this.noteAt(offset));
    const no = note !== null ? this.file?.t.objects[note] : undefined;
    if (note !== null && no?.kind === 'note') {
      const what = no.end ? 'Endnote' : 'Footnote';
      if (fb !== null) item(`Go to ${what} Reference`, () => this.stopBox(true), 'Back to its number in the text (Escape)');
      else item(`Go to ${what}`, () => this.startBox(note), 'Its text, to type into');
      item(no.end ? 'Convert to Footnote' : 'Convert to Endnote', () => { if (fb !== null) this.stopBox(); this.convertNote(note); });
      cmd('Note Options…', 'note-options', 'How footnotes and endnotes are numbered');
      menu.appendChild(document.createElement('hr'));
    }
    cmd('New Comment', 'new-comment', 'A comment on the selection, or on the word here (Review tab)');
    const commented = this.comments.placed().filter((x) => x.start <= offset && offset <= x.end);
    if (commented.length) {
      const last = commented[commented.length - 1];
      item('Delete Comment', () => this.comments.remove(last.id));
      item(last.c.done ? 'Reopen Comment' : 'Resolve Comment', () => { this.comments.active = last.id; this.comments.toggleResolved(); });
    }
    menu.appendChild(document.createElement('hr'));
    const picked = this.pickedObject();
    if (picked !== null) {
      if (this.file?.t.objects[picked]?.kind === 'drawing') cmd('Edit Drawing', 'edit-figure');
      const po = this.file?.t.objects[picked];
      if (po?.kind === 'picture' && po.chart) cmd('Edit Chart…', 'edit-chart');
      if (po?.kind === 'picture' && !po.chart) cmd('Picture Format…', 'picture-format', 'Brightness, contrast, sharpen, recolour, transparency, Remove Background, crop to a shape or proportions');
      cmd('Insert Caption…', 'insert-caption');
      const look = this.lookOf(picked);
      item(look?.frame ? 'Remove Frame' : 'Add Frame', () => this.setLook(picked, { frame: look?.frame ? undefined : 0.75, frameColor: undefined }), 'A thin black line round it (Format in the panel sets its width and colour)');
      item(look?.shadow ? 'Remove Shadow' : 'Add Shadow', () => this.setLook(picked, { shadow: look?.shadow ? undefined : 'soft' }), 'A soft shadow down and to the right');
      menu.appendChild(document.createElement('hr'));
      const nested = this.file ? cellHolding(this.file.t, picked) !== null : false;
      const now = floatOf(this.file?.t.objects[picked])?.wrap ?? 'inline';
      const head = document.createElement('div');
      head.className = 'menu-head';
      head.textContent = 'Wrap Text';
      menu.appendChild(head);
      for (const [v, label, title] of WRAPS) {
        if (v === 'inline' && this.file?.t.objects[picked]?.kind === 'textbox') continue;
        if (nested && v !== 'inline') continue;
        item(`${now === v ? '✓ ' : '   '}${label}`, () => this.setWrap(picked, v), title);
      }
      menu.appendChild(document.createElement('hr'));
    }
    const tg = this.tableTarget();
    if (tg) {
      const head = document.createElement('div');
      head.className = 'menu-head';
      head.textContent = 'Table';
      menu.appendChild(head);
      cmd('Insert Row Above', 'table-row-above');
      cmd('Insert Row Below', 'table-row-below');
      cmd('Insert Column Left', 'table-col-left');
      cmd('Insert Column Right', 'table-col-right');
      cmd('Delete Row', 'table-del-row');
      cmd('Delete Column', 'table-del-col');
      cmd('Delete Table', 'table-delete');
      if (canMerge(tg.t, tg.r, tg.c, 'right')) cmd('Merge with Cell to the Right', 'table-merge');
      if (canMerge(tg.t, tg.r, tg.c, 'down')) cmd('Merge with Cell Below', 'table-merge-down', 'Join the cell with the one under it (down a column)');
      if (spanOf(tg.t, tg.r, tg.c) > 1 || rowSpanOf(tg.t, tg.r, tg.c) > 1) cmd('Split Cells', 'table-split', 'Undo a merge: the cell goes back to single cells');
      cmd('Insert Table in Cell…', 'table-nest', 'A table inside this cell (a nested table, kept as one in Word)');
      cmd('Fit Columns to Contents', 'table-fit', 'Each column as wide as its widest cell (structures at their own size)');
      for (const [v, label] of [['grid', 'Grid Lines'], ['acs', 'ACS Rules'], ['none', 'No Lines']] as const) cmd(`${tg.t.lines === v ? '✓ ' : '   '}${label}`, `table-lines-${v}`);
      cmd('Select Table', 'table-select', 'Pick the whole table (to copy, cut or delete it)');
      menu.appendChild(document.createElement('hr'));
    }
    cmd('Paragraph…', 'box-para', 'Indents, spacing and line spacing');
    cmd('Style…', 'box-style', 'Change how this paragraph\'s style looks');
    cmd('Page Setup…', 'box-page', 'Paper, orientation and margins');
    cmd('Header and Footer…', 'box-hf', 'Header, footer and page numbers');
    const host = this.view.host;
    host.appendChild(menu);
    const r = host.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(clientX - r.left, r.width - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY - r.top, r.height - menu.offsetHeight - 4))}px`;
    this.menu = menu;
    document.addEventListener('pointerdown', this.closeMenuOutside, true);
    return true;
  }

  /** The highlighter's colour (the bar under "ab"); yellow to start with, as in Word. */
  private highlighter = '#ffff00';
  /** The style chosen for the last table inserted (offered first next time). */
  private lastTableKind = 'grid';
  private keepTableTab = false;

  /** Word's highlighter colours, then no colour and any other colour. */
  private highlightMenu(): void {
    this.closeMenu();
    const anchor = this.ribbon.querySelector<HTMLElement>('[data-doc="doc-highlight-menu"]')!;
    const menu = document.createElement('div');
    menu.className = 'hl-menu';
    menu.setAttribute('role', 'menu');
    const grid = document.createElement('div');
    grid.className = 'hl-grid';
    const cur = this.file?.ed.currentStyle().highlight;
    const use = (c: string | undefined) => {
      this.closeMenu();
      if (c) this.highlighter = c;
      this.paintHighlighter();
      this.file?.ed.setStyle({ highlight: c });
      this.focus();
    };
    for (const [name, c] of Object.entries(WORD_HIGHLIGHTS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.title = name.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (x) => x.toUpperCase());
      b.setAttribute('aria-pressed', String(cur === c));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => use(c));
      grid.append(b);
    }
    const row = document.createElement('div');
    row.className = 'hl-row';
    const none = document.createElement('button');
    none.type = 'button';
    none.textContent = 'No Colour';
    none.title = 'Take the highlight off the selected text';
    none.addEventListener('mousedown', (e) => e.preventDefault());
    none.addEventListener('click', () => use(undefined));
    const other = document.createElement('input');
    other.type = 'color';
    other.value = this.highlighter;
    other.title = 'Any other colour (saved to Word as shading, which it shows the same way)';
    other.addEventListener('change', () => use(other.value));
    row.append(none, other);
    menu.append(grid, row);
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(r.left - 60, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${r.bottom + 4}px`;
    this.menu = menu;
    document.addEventListener('pointerdown', this.closeMenuOutside, true);
  }

  private paintHighlighter(): void {
    const bar = this.ribbon.querySelector<HTMLElement>('#doc-hl-bar');
    if (bar) bar.style.background = this.highlighter;
  }

  private closeMenu(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    document.removeEventListener('pointerdown', this.closeMenuOutside, true);
  }

  // ---------------------------------------------------------------- keys and typing

  private wireInput(): void {
    const ta = this.ta;
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('beforeinput', (e) => this.beforeInput(e));
    ta.addEventListener('input', () => this.onInput());
    ta.addEventListener('compositionstart', () => this.ed.compositionStart());
    ta.addEventListener('compositionupdate', (e) => this.ed.compositionUpdate(e.data ?? ''));
    ta.addEventListener('compositionend', (e) => { this.ed.compositionEnd(e.data ?? ''); this.syncInput(); });
    ta.addEventListener('copy', (e) => this.copy(e, false));
    ta.addEventListener('cut', (e) => { if (this.reading) { this.copy(e, false); return; } this.copy(e, true); });
    ta.addEventListener('paste', (e) => { if (this.reading) { e.preventDefault(); return; } void this.paste(e); });
    ta.addEventListener('focus', () => this.redraw());
    ta.addEventListener('blur', () => this.redraw());
  }

  /** Keep the selected text in the hidden field, selected, for the system's copy, screen readers and input methods. */
  private syncInput(): void {
    if (!this.file || this.ed.composing !== null) return;
    const ed = this.ed;
    const sel = ed.collapsed ? '' : richToPlain(ed.selected());
    if (this.ta.value !== sel) this.ta.value = sel;
    this.ta.setSelectionRange(0, sel.length);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.file) return;
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (this.menu && e.key === 'Escape') { e.preventDefault(); this.closeMenu(); return; }
    this.closeMenu();
    if (this.reading) { this.readingKey(e); return; }
    const ed = this.ed;
    const run = (f: () => void) => { e.preventDefault(); f(); };
    const chord = chordOf(e);
    // Word's keys first, then the text styling keys, both from the key map (Edit > Hotkeys)
    if (chord) {
      const docAction = keymap.lookup('document' as KeyContext, chord);
      if (docAction) {
        const cmd = parseAction(docAction).arg;
        if (this.run(cmd) || this.host.command(cmd)) { e.preventDefault(); return; }
      }
      const action = keymap.lookup('text', chord);
      if (action && parseAction(action).arg === 'link') return run(() => void this.editLink());
      if (action) return run(() => ed.toggle(parseAction(action).arg as rt.Toggle));
    }
    const shift = e.shiftKey;
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    const word = isMac ? e.altKey : e.ctrlKey;
    const moves: Record<string, Move> = isMac && e.metaKey
      ? { ArrowLeft: 'lineStart', ArrowRight: 'lineEnd', ArrowUp: 'textStart', ArrowDown: 'textEnd' }
      : { ArrowLeft: word ? 'wordLeft' : 'left', ArrowRight: word ? 'wordRight' : 'right', ArrowUp: 'up', ArrowDown: 'down', Home: e.ctrlKey ? 'textStart' : 'lineStart', End: e.ctrlKey ? 'textEnd' : 'lineEnd' };
    if (moves[e.key] && !e.altKey) {
      return run(() => {
        const before = ed.collapsed ? ed.focus : -1;
        ed.move(moves[e.key], shift);
        // past the edge of a table cell: the next cell
        const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'];
        if (this.file?.box?.cell && !shift && !word && dir && ed.focus === before) this.cellStep(dir);
      });
    }
    if (e.key === 'PageDown' || e.key === 'PageUp') return run(() => this.pageMove(e.key === 'PageDown' ? 1 : -1, shift));
    if (!ctrl && !e.altKey) {
      switch (e.key) {
        case 'Enter': return run(() => this.enter(shift));
        case 'Backspace': return run(() => ed.backspace(word));
        case 'Delete': return run(() => ed.deleteForward(word));
        case 'Tab': return run(() => (this.file?.box?.cell ? this.tabCell(shift) : ed.indent(shift ? -1 : 1)));
        case 'Escape': return run(() => { if (this.file?.box) this.stopBox(true); else if (!ed.collapsed) ed.setCaret(ed.focus); });
      }
    }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !shift) return run(() => this.undo(false));
      if (k === 'y' || (k === 'z' && shift)) return run(() => this.undo(true));
      if (k === 'a') return run(() => ed.selectAll());
      if (k === 'backspace') return run(() => ed.backspace(true));
      if (k === 'delete') return run(() => ed.deleteForward(true));
      // Ctrl+Shift+V pastes the text without its formatting
      if (k === 'v' && shift) { this.plainPaste = true; return; }
      // copying and pasting are done by the text field's own events
      if (k === 'c' || k === 'x' || k === 'v') return;
    }
    // anything else with Ctrl, Alt or a function key: the app's commands (Save, Open, New…)
    if ((e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) && this.host.key(e)) e.preventDefault();
  }

  private beforeInput(e: InputEvent): void {
    if (!this.file || e.isComposing) return;
    if (this.reading) { e.preventDefault(); return; }
    const t = e.inputType;
    const ed = this.ed;
    if (t === 'insertCompositionText') return;
    e.preventDefault();
    if (t === 'insertText' || t === 'insertReplacementText') { if (e.data) ed.type(e.data); }
    else if (t === 'insertLineBreak' || t === 'insertParagraph') this.enter(t === 'insertLineBreak');
    else if (t === 'deleteContentBackward') ed.backspace();
    else if (t === 'deleteContentForward') ed.deleteForward();
    else if (t === 'deleteWordBackward') ed.backspace(true);
    else if (t === 'deleteWordForward') ed.deleteForward(true);
    else if (t === 'historyUndo') this.undo(false);
    else if (t === 'historyRedo') this.undo(true);
    else if (t.startsWith('format')) {
      const f = ({ formatBold: 'bold', formatItalic: 'italic', formatUnderline: 'underline', formatSubscript: 'sub', formatSuperscript: 'sup' } as Record<string, rt.Toggle>)[t];
      if (f) ed.toggle(f);
    }
  }

  private onInput(): void {
    if (!this.file || this.ed.composing !== null) return;
    const v = this.ta.value;
    const sel = this.ed.collapsed ? '' : richToPlain(this.ed.selected());
    if (v !== sel) this.ed.type(v);
    this.syncInput();
  }

  /**
   * Enter: a new paragraph. At the end of a heading (or a title or caption) the new paragraph
   * is Normal, as in Word; in a list it carries the list on.
   */
  private enter(soft: boolean): void {
    const ed = this.ed;
    if (this.file?.box) { ed.enter(soft); return; }
    const before = ed.text;
    const p = paraAt(before, ed.start);
    const r = paraRange(before, p);
    const atEnd = ed.collapsed && ed.focus === r.end && r.end > r.start;
    const st = styleOf(this.file!.t, this.file!.t.paras[p]);
    ed.enter(soft);
    if (atEnd && st.next && st.next !== st.id && this.file!.t.styles[st.next]) {
      const q = paraAt(ed.text, ed.focus);
      const t = setParaStyle(this.file!.t, q, q, st.next);
      ed.update(t, null);
    }
  }

  /** Page Up and Page Down: the caret moves by a window's height. */
  private pageMove(dir: 1 | -1, extend: boolean): void {
    this.stopBox();
    const ed = this.ed;
    const lay = this.file!.layout().text;
    const c = caretPos(lay, ed.focus);
    const l = lay.lines[c.line];
    const dy = (this.view.scroller.clientHeight / this.view.zoom) * 0.9 * dir;
    this.view.scroller.scrollTop += dy * this.view.zoom;
    ed.setCaret(offsetAt(lay, c.x, l.y + dy), extend);
  }

  // ---------------------------------------------------------------- clipboard

  private copy(e: ClipboardEvent, cut: boolean): void {
    e.preventDefault();
    const f = this.file;
    if (!f || !e.clipboardData) return;
    if (f.box && !f.box.cell) {
      // text from a text box: as text only
      const ed = f.box.ed;
      if (ed.collapsed) return;
      const sel = ed.selected();
      e.clipboardData.setData('text/plain', richToPlain(sel));
      e.clipboardData.setData('text/html', richToHtml(sel, { defaultSize: 11 }));
      if (cut) ed.replaceSelection([], undefined, 'cut');
      return;
    }
    // the document's text, or a table cell's
    const ed = f.textEd;
    if (ed.collapsed) return;
    const picked = this.pickedObject();
    if (picked !== null) {
      // a figure on its own goes as a drawing, for ChemDraw and Word
      const o = f.t.objects[picked];
      if (o.kind === 'drawing') {
        void this.host.copyDrawing(o.contents, f.t.drawingStyle).then((m) => this.host.flash(m));
        if (cut) ed.replaceSelection([], undefined, 'cut');
        return;
      }
    }
    const sel = ed.selected();
    const shown = fieldTexts(f.t);
    // fields show their text in other programs; figures are left out of plain text
    const plainRuns = sel.runs.map((r) => (r.obj !== undefined ? { ...r, obj: undefined, text: shown.get(r.obj) ?? '' } : r));
    const plain = richToPlain({ runs: plainRuns, paras: sel.paras });
    e.clipboardData.setData('text/plain', plain);
    e.clipboardData.setData('text/html', richToHtml({ runs: plainRuns, paras: sel.paras }, { defaultSize: 11 }));
    const objects: Record<number, DocObject> = {};
    // with the structures in any table's cells
    const add = (id: number) => {
      const o = f.t.objects[id];
      if (!o || objects[id]) return;
      objects[id] = o;
      for (const x of innerObjects(o)) add(x);
    };
    for (const r of sel.runs) if (r.obj !== undefined) add(r.obj);
    // citations bring the references they cite, so they work when pasted into another document
    const cited = new Set(Object.values(objects).flatMap((o) => (o.kind === 'cite' ? o.refs : [])));
    const references = (f.t.references ?? []).filter((r) => cited.has(r.id));
    // (comments stay with the words they are on: a copy doesn't bring them)
    const runs = sel.runs.map((r) => { if (!r.cmt) return r; const { cmt: _, ...rest } = r; return rest; });
    this.clip = { text: plain, runs, paras: sel.paras, objects, references };
    try { e.clipboardData.setData('application/x-' + OWN_KIND, JSON.stringify({ runs, paras: sel.paras, objects, references })); } catch { /* not every browser allows own types */ }
    if (cut) ed.replaceSelection([], undefined, 'cut');
  }

  /** Paste (from the text field's paste event, or from a menu with null). */
  async paste(e: ClipboardEvent | null): Promise<void> {
    e?.preventDefault();
    e?.stopPropagation();
    const f = this.file;
    if (!f) return;
    const plain = this.plainPaste;
    this.plainPaste = false;
    // our own copy (with figures and fields): in the event in a browser, else the last copy made here
    let own: OwnCopy | null = null;
    try {
      const j = e?.clipboardData?.getData('application/x-' + OWN_KIND);
      if (j) own = JSON.parse(j);
    } catch { own = null; }
    const html = e?.clipboardData?.getData('text/html') ?? '';
    const text0 = e?.clipboardData?.getData('text/plain') ?? '';
    if (!own && this.clip && text0 && text0.replace(/\r\n?/g, '\n') === this.clip.text) own = this.clip;
    if (f.box && !f.box.cell) {
      // into a text box: text only (figures go in the page's text)
      const r = !plain && html ? htmlToRich(html) : null;
      if (r) f.box.ed.replaceSelection(rt.normalizeRuns(r.runs.map((x) => ({ ...x, obj: undefined }))), r.paras.length > 1 ? r.paras : undefined);
      else if (text0) f.box.ed.pastePlain(text0);
      return;
    }
    if (own && !plain) { this.pasteOwn(own); return; }
    const got = await this.host.readPaste(e);
    const ed = f.textEd;
    if (got.drawing) { this.insertObject({ kind: 'drawing', contents: got.drawing }, 'Paste structure'); return; }
    if (got.picture && !got.text && !got.html && !html) { this.dropPicture(got.picture.bytes, got.picture.mime); return; }
    const h = plain ? '' : html || got.html || '';
    const rich = h ? htmlToRich(h) : null;
    if (rich) {
      // pasted text takes the font and size of the text it goes into, unless it brings its own
      const base = ed.typingStyle();
      const runs = rich.runs.map((r) => ({ ...r, size: r.size ?? base.size, font: r.font ?? base.font }));
      const style = styleOf(f.t, ed.currentPara());
      const paras = rich.paras.length > 1 ? rich.paras.map((p) => ({ ...p, align: p.align ?? (style.align === 'left' ? undefined : style.align), spaceAfter: p.spaceAfter ?? style.spaceAfter })) : undefined;
      ed.replaceSelection(rt.normalizeRuns(runs), paras);
      return;
    }
    const text = text0 || got.text || '';
    if (text) ed.pastePlain(text);
  }

  /** Paste text copied in a document here, with new ids for its figures and fields. */
  private pasteOwn(own: OwnCopy): void {
    const f = this.file!;
    let next = nextObjectId(f.t);
    const ids = new Map<number, number>();
    const objects = { ...f.t.objects };
    for (const [k, o] of Object.entries(own.objects)) {
      const id = next++;
      ids.set(Number(k), id);
      objects[id] = o;
    }
    // a pasted reference keeps pointing at its pasted caption, or at the caption it pointed to here
    const remap = (runs: TextRun[]) => runs.map((r) => (r.obj !== undefined ? { ...r, obj: ids.get(r.obj) } : r)).filter((r) => r.obj !== undefined || !r.text.includes(OBJECT_CHAR));
    for (const [, id] of ids) {
      const o = objects[id];
      if (o.kind === 'ref' && ids.has(o.target)) objects[id] = { ...o, target: ids.get(o.target)! };
      // the structures in a pasted table's cells are its own copies
      if (o.kind === 'table') objects[id] = { ...o, table: { ...o.table, rows: o.table.rows.map((row) => row.map((cell) => ({ ...cell, runs: remap(cell.runs) }))) } };
    }
    const b = f.box?.cell ? f.box : null;
    // into a table cell: no text boxes, bibliographies or notes inside it (a table goes in as a table in the cell)
    const runs = remap(own.runs).filter((r) => !b || r.obj === undefined || !['textbox', 'bib', 'toc', 'tof', 'note'].includes(objects[r.obj]?.kind));
    // references cited by pasted citations join the list (unless it has them)
    const have = new Set((f.t.references ?? []).map((r) => r.id));
    const adding = (own.references ?? []).filter((r) => !have.has(r.id));
    f.ed.update({ ...f.t, objects, ...(adding.length ? { references: [...(f.t.references ?? []), ...adding] } : {}) } as DocText, 'paste');
    if (b) {
      b.recorded = true;
      b.ed.replace(b.ed.start, b.ed.end, runs, own.paras.length > 1 ? own.paras : undefined, 'edit');
      b.recorded = false;
      return;
    }
    const ed = f.ed;
    ed.replace(ed.start, ed.end, runs, own.paras.length > 1 ? own.paras : undefined, null);
  }

  // ---------------------------------------------------------------- views (View > Views, Split, Read Mode)

  private setupView(v: DocView): void {
    v.overlay = () => this.overlay(v);
    v.onMove = () => {
      if (v === this.view) this.placeInput();
      this.showZoom();
      if (v === this.views[0]) this.comments?.place();
      if (this.reading) this.showReadPages();
    };
    v.onResize = () => { if (v === this.views[0]) this.fitSheet(); };
    this.views.push(v);
  }

  /** Work in this pane (the other one of a split keeps its place). */
  private activate(v: DocView): void {
    if (this.view === v) return;
    this.view = v;
    // the hidden text field goes with the caret
    const focused = document.activeElement === this.ta;
    v.host.append(this.ta);
    if (focused) this.focus();
    this.placeInput();
    this.showZoom();
    this.redraw();
  }

  /** Draw every pane again. */
  redraw(): void {
    for (const v of this.views) v.redraw();
  }

  private sizeSpaces(): void {
    for (const v of this.views) v.sizeSpace();
  }

  /** Web Layout and Outline wrap the text to the window: keep the width they wrap to the window's. */
  private fitSheet(): void {
    const f = this.file;
    if (!f) return;
    const v = f.view;
    if (v.kind !== 'web' && v.kind !== 'outline') return;
    const w = this.views[0].sheetWidth();
    if (Math.abs((v.width ?? 0) - w) < 1) return;
    f.view = { ...v, width: w };
  }

  /** View > Views: show the document another way (the text is the same in every view). */
  private setViewKind(kind: DocViewKind): void {
    const f = this.file;
    if (!f) return;
    this.stopBox();
    const was = f.view;
    if (was.kind === 'read' && kind !== 'read') this.stopReading();
    if (was.kind === kind) {
      // Read Mode's button again: back to Print Layout
      if (kind === 'read') this.setViewKind('print');
      return;
    }
    f.view = { kind, outline: was.outline ?? (kind === 'outline' ? newOutline() : undefined) };
    this.fitSheet();
    if (kind === 'read') this.startReading();
    else {
      for (const v of this.views) {
        // the views without pages start at a size to read (Multiple Pages may have left the zoom small)
        if (continuous(kind) && v.zoom < ACTUAL * 0.75) v.setZoom(ACTUAL);
        v.sizeSpace();
        v.redraw();
      }
      if (continuous(kind)) this.view.scroller.scrollLeft = 0;
    }
    this.lastFocus = f.ed.focus;
    this.showViewKind();
    this.changed('selection');
  }

  /** The view buttons and menu items show the view and the page arrangement; the Outlining tab shows in Outline. */
  private showViewKind(): void {
    const f = this.file;
    if (!f) return;
    const kind = f.view.kind;
    const set = (cmd: string, on: boolean) => {
      for (const b of document.querySelectorAll<HTMLElement>(`[data-doc="${cmd}"]`)) if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
      for (const b of document.querySelectorAll<HTMLElement>(`[data-cmd="${cmd}"]`)) b.setAttribute('aria-checked', String(on));
    };
    for (const [cmd, k] of Object.entries(VIEW_COMMANDS)) set(cmd, k === kind);
    const pages = !continuous(kind) && kind !== 'read';
    set('view-vertical', pages && !this.view.sideways);
    set('view-sideways', pages && this.view.sideways);
    set('view-multiple', pages && this.view.perRow > 1);
    set('view-split', !!this.split);
    const tab = this.ribbon.querySelector<HTMLButtonElement>('[data-doc-tab="outlining"]');
    if (tab) {
      tab.hidden = kind !== 'outline';
      if (kind === 'outline' && this.outlineTabFor !== f) { this.outlineTabFor = f; tab.click(); }
      if (kind !== 'outline') {
        if (this.outlineTabFor && tab.getAttribute('aria-selected') === 'true') this.ribbon.querySelector<HTMLButtonElement>('[data-doc-tab="home"]')?.click();
        this.outlineTabFor = null;
      }
    }
    for (const x of this.views) x.host.classList.toggle('doc-endless', continuous(kind));
    this.updateOutlineRibbon();
  }

  /** Vertical, Side to Side, Multiple Pages and One Page: how the pages are laid out (in Print Layout). */
  private arrange(sideways: boolean, perRow: number, fit: boolean): void {
    const f = this.file;
    if (!f) return;
    if (f.view.kind !== 'print') this.setViewKind('print');
    const v = this.view;
    const page = v.currentPage();
    v.sideways = sideways;
    v.perRow = sideways ? 1 : perRow;
    v.sizeSpace();
    if (fit) v.fitPages();
    v.scrollToPage(sideways ? page - (page % 2) : page);
    v.redraw();
    this.showViewKind();
    this.changed('selection');
  }

  /** View > Split: a second pane under the first, on the same document, scrolled on its own. */
  private setSplit(on: boolean): void {
    if (on === !!this.split) return;
    const main = this.views[0];
    if (on) {
      const bar = document.createElement('div');
      bar.className = 'doc-split-bar';
      bar.title = 'Drag to move the split; double-click to remove it';
      const host = document.createElement('div');
      host.className = 'doc-host doc-host-2';
      main.host.after(bar, host);
      const v = new DocView(host);
      v.file = this.file;
      this.setupView(v);
      this.wirePointer(v);
      this.split = { view: v, host, bar };
      bar.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        const pane = bar.parentElement!.getBoundingClientRect();
        const move = (ev: PointerEvent) => {
          const below = Math.max(60, Math.min(pane.height - 100, pane.bottom - ev.clientY - 28));
          host.style.flexBasis = `${below}px`;
        };
        const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); this.focus(); };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
      });
      bar.addEventListener('dblclick', () => this.setSplit(false));
      main.resize();
      v.resize();
      v.zoom = main.zoom;
      v.sizeSpace();
      v.scroller.scrollTop = main.scroller.scrollTop;
      v.scroller.scrollLeft = main.scroller.scrollLeft;
      v.redraw();
    } else {
      const sp = this.split!;
      if (this.view === sp.view) this.activate(main);
      this.views = this.views.filter((x) => x !== sp.view);
      sp.view.file = null;
      sp.bar.remove();
      sp.host.remove();
      this.split = null;
      main.resize();
    }
    this.showViewKind();
  }

  // Read Mode: the pages two at a time, filling the window with nothing else, turned with the keys or the wheel

  private startReading(): void {
    const f = this.file;
    if (!f) return;
    this.setSplit(false);
    const v = this.views[0];
    this.activate(v);
    this.readWas ??= { zoom: v.zoom, perRow: v.perRow, sideways: v.sideways };
    const page = v.currentPage();
    this.reading = true;
    document.body.classList.add('doc-reading');
    document.querySelector<HTMLElement>('#doc-readbar')!.hidden = false;
    v.scroller.classList.add('doc-turning');
    v.sideways = true;
    v.perRow = 1;
    v.turnPages = (dir) => this.turn(dir);
    v.resize();
    v.fitPages();
    this.readPage = page - (page % 2);
    v.scrollToPage(this.readPage);
    this.showReadPages();
    this.focus();
  }

  private stopReading(): void {
    if (!this.reading) return;
    const v = this.views[0];
    this.reading = false;
    document.body.classList.remove('doc-reading');
    document.querySelector<HTMLElement>('#doc-readbar')!.hidden = true;
    v.scroller.classList.remove('doc-turning');
    v.turnPages = null;
    const w = this.readWas;
    this.readWas = null;
    const page = this.readPage;
    if (w) {
      v.perRow = w.perRow;
      v.sideways = w.sideways;
      v.resize();
      v.setZoom(w.zoom);
    }
    v.scrollToPage(page);
  }

  /** Read Mode: the next two pages, or the two before (-1). */
  private turn(dir: 1 | -1 | 'first' | 'last'): void {
    const lay = this.file?.layout();
    if (!lay) return;
    const n = lay.pages.length;
    const step = n > 1 ? 2 : 1;
    let p = dir === 'first' ? 0 : dir === 'last' ? n - 1 : this.readPage + dir * step;
    p = Math.max(0, Math.min(n - 1, p));
    p -= p % step;
    this.readPage = p;
    this.views[0].scrollToPage(p);
    this.showReadPages();
  }

  private showReadPages(): void {
    const lay = this.file?.layout();
    const el = document.querySelector<HTMLElement>('#doc-read-pages');
    if (!lay || !el) return;
    const n = lay.pages.length;
    const a = this.readPage + 1, b = Math.min(n, this.readPage + 2);
    el.textContent = n > 1 && b > a ? `Pages ${a}–${b} of ${n}` : `Page ${a} of ${n}`;
  }

  /** Read Mode's keys: the arrows, Page Up and Down, Space, Home and End turn the pages; Esc goes back to Print Layout. */
  private readingKey(e: KeyboardEvent): void {
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key;
    if (ctrl && (k.toLowerCase() === 'c' || k.toLowerCase() === 'a')) {
      if (k.toLowerCase() === 'a') { e.preventDefault(); this.ed.selectAll(); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); this.setViewKind('print'); return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(k)) { e.preventDefault(); this.turn(1); return; }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k)) { e.preventDefault(); this.turn(-1); return; }
    if (k === 'Home' || k === 'End') { e.preventDefault(); this.turn(k === 'Home' ? 'first' : 'last'); return; }
    // the app's own keys (Save, Print…) still work; typing doesn't
    if ((e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(k)) && this.host.key(e)) { e.preventDefault(); return; }
    if (k.length === 1 || k === 'Enter' || k === 'Backspace' || k === 'Delete' || k === 'Tab') e.preventDefault();
  }

  // Outline: headings by level, folded and moved as blocks

  private outline(): OutlineState {
    return this.file?.view.outline ?? newOutline();
  }

  private setOutline(o: OutlineState): void {
    const f = this.file;
    if (!f) return;
    f.view = { ...f.view, outline: o };
    this.sizeSpaces();
    this.changed('selection');
  }

  private levels(): number[] {
    const t = this.file!.t;
    return fitParas(t.paras, paraCount(rt.plainText(t.runs))).map((ps) => outlineLevel(t, ps));
  }

  /** A click on a heading's mark: the heading and everything under it picked; on body text, its paragraph. */
  private pickOutline(p: number): void {
    const f = this.file!;
    const text = f.ed.text;
    const last = Math.max(p, subtreeEnd(this.levels(), p) - 1);
    f.ed.select(paraRange(text, p).start, paraRange(text, last).end);
  }

  /** A double-click on a heading's mark: fold it, or unfold it. */
  private outlineFold(p: number): void {
    const levels = this.levels();
    if (!levels[p] || subtreeEnd(levels, p) <= p + 1) return;
    const text = this.file!.ed.text;
    this.file!.ed.setCaret(paraRange(text, p).end);
    this.setOutline(toggleFold(this.outline(), p));
  }

  /** The Outlining tab's Level: the paragraphs picked become headings of a level, or body text (0). */
  private setOutlineLevel(L: number): void {
    const f = this.file;
    if (!f) return;
    const [a, b] = this.ed.selectedParas();
    const id = L ? `Heading${L}` : 'Normal';
    this.ed.update(setParaStyle(withHeadings(f.t), a, b, id), 'Outline level');
  }

  private outlineCommand(cmd: string): void {
    const f = this.file;
    if (!f) return;
    this.stopBox();
    const ed = f.ed;
    const [a, b] = ed.selectedParas();
    const o = this.outline();
    const level = /^outline-level-(\d)$/.exec(cmd);
    if (level) { this.setOutline({ ...o, level: Number(level[1]) }); return; }
    switch (cmd) {
      case 'outline-promote': case 'outline-demote': case 'outline-heading1': case 'outline-body': {
        const op = cmd.slice('outline-'.length) as OutlineOp;
        const names: Record<OutlineOp, string> = { promote: 'Promote', demote: 'Demote', heading1: 'Promote to Heading 1', body: 'Demote to Body Text' };
        ed.update(changeLevel(f.t, o, a, b, op), names[op]);
        break;
      }
      case 'outline-up': case 'outline-down': {
        const r = moveParas(f.t, o, a, b, cmd === 'outline-up' ? -1 : 1);
        if (!r) break;
        const before = paraRange(ed.text, a).start;
        const anchor = ed.anchor - before, focus = ed.focus - before;
        const text = rt.plainText(r.t.runs);
        const start = paraRange(text, r.first).start;
        // the folded headings move with their paragraphs
        f.view = { ...f.view, outline: { ...o, collapsed: o.collapsed.map(r.moved).sort((x, y) => x - y) } };
        ed.update(r.t, cmd === 'outline-up' ? 'Move Up' : 'Move Down', start + anchor, start + focus);
        break;
      }
      case 'outline-expand': case 'outline-collapse':
        this.setOutline(foldHeadings(f.t, o, a, b, cmd === 'outline-collapse'));
        break;
      case 'outline-all': this.setOutline({ ...o, level: 0, collapsed: [] }); break;
      case 'outline-first': this.setOutline({ ...o, firstLine: !o.firstLine }); break;
      case 'outline-format': this.setOutline({ ...o, formatting: !o.formatting }); break;
    }
  }

  private updateOutlineRibbon(): void {
    const f = this.file;
    if (!f || f.view.kind !== 'outline') return;
    const o = this.outline();
    const r = this.ribbon;
    const level = r.querySelector<HTMLSelectElement>('#doc-outline-level');
    const L = outlineLevel(f.t, f.ed.currentPara());
    if (level && document.activeElement !== level) level.value = String(L);
    const show = r.querySelector<HTMLSelectElement>('#doc-outline-show');
    if (show && document.activeElement !== show) show.value = String(o.level);
    const fmt = r.querySelector<HTMLInputElement>('#doc-outline-format');
    if (fmt) fmt.checked = o.formatting;
    const first = r.querySelector<HTMLInputElement>('#doc-outline-first');
    if (first) first.checked = o.firstLine;
  }

  /**
   * Outline: the caret never stays in text folded out of sight. It steps over it in the
   * direction it was going (to the next paragraph shown, or the end of the one before).
   * True when it moved.
   */
  private snapShown(): boolean {
    const f = this.file;
    if (!f || f.box || f.view.kind !== 'outline') return false;
    const ed = f.ed;
    if (ed.composing !== null) return false;
    const lines = f.layout().text.lines;
    const at = ed.focus;
    if (!lines.length || lines.some((l) => at >= l.start && at <= l.end)) { this.lastFocus = at; return false; }
    const fwd = at >= this.lastFocus;
    let to: number;
    if (fwd) { const l = lines.find((x) => x.start > at); to = l ? l.start : lines[lines.length - 1].end; }
    else { const l = [...lines].reverse().find((x) => x.end < at); to = l ? l.end : lines[0].start; }
    this.lastFocus = to;
    ed.select(ed.collapsed ? to : ed.anchor, to);
    return true;
  }

  /** Outline: folded headings stay on their paragraphs when paragraphs are added or taken away before them. */
  private keepFolds(): void {
    const f = this.file;
    if (!f) return;
    const n = paraCount(f.ed.text);
    const d = n - this.paraCountWas;
    this.paraCountWas = n;
    const o = f.view.outline;
    if (!d || !o?.collapsed.length) return;
    const at = paraAt(f.ed.text, f.ed.start) - Math.max(d, 0);
    f.view = { ...f.view, outline: shiftFolds(o, at, d) };
  }

  // ---------------------------------------------------------------- links and bookmarks

  /** The link under a point of the page: in the text box or cell being typed into, else in the body. */
  private linkAtPoint(p: { x: number; y: number }): string | null {
    const f = this.file;
    if (!f) return null;
    if (f.box) {
      const s = linkAtPoint(f.box.ed.layout(), f.box.ed.t.runs, p.x, p.y);
      if (s) return s.link;
    }
    return linkAtPoint(f.layout().text, f.t.runs, p.x, p.y)?.link ?? null;
  }

  /** Insert > Link (Ctrl+K): link the selection, change the link the caret is in, or type a new one. */
  private async editLink(): Promise<void> {
    const f = this.file;
    if (!f || this.reading) return;
    const ed = this.ed;
    const here = ed.linkHere();
    const range = here && ed.collapsed ? here : { start: ed.start, end: ed.end };
    const shown = ed.text.slice(range.start, range.end);
    const got = await askLink({
      text: /[\n\uFFFC]/.test(shown) ? null : shown, link: here?.link,
      places: docPlaces(f.t), placeTitle: 'Place in this document',
    });
    this.focus();
    if (!got || this.file !== f) return;
    if ('remove' in got) { ed.removeLink(); return; }
    let link = got.link;
    // a heading gets a hidden bookmark for the link to find it by
    if (link.startsWith('#heading:')) {
      const placed = placeLink(f.t, link);
      link = placed.link;
      f.ed.update({ ...f.t, paras: placed.t.paras }, 'Bookmark');
    }
    ed.setLink(link, got.text);
  }

  /** Go to a place in the document a link points to (#name); false when there is no such bookmark. */
  goToPlace(link: string): boolean {
    const f = this.file;
    if (!f || !link.startsWith('#')) return false;
    const para = bookmarkPara(f.t, link.slice(1));
    if (para < 0) return false;
    if (f.box) this.stopBox();
    const at = paraRange(f.ed.text, para).start;
    f.ed.setCaret(at);
    this.revealCaret();
    this.focus();
    return true;
  }

  /** A place's name for a link's tooltip. */
  placeName(link: string): string | null {
    return this.file ? placeName(this.file.t, link) : null;
  }

  /** Insert > Bookmark: name the paragraph the caret is in, or go to or delete a bookmark. */
  private async bookmarkDialog(): Promise<void> {
    const f = this.file;
    if (!f || this.reading) return;
    if (f.box) { this.host.flash('Bookmarks go in the body of the document: click outside the text box or table first.'); return; }
    const marks = bookmarksOf(f.t).filter((b) => !b.name.startsWith('_'));
    const para = paraAt(f.ed.text, f.ed.start);
    const here = marks.find((b) => b.para === para);
    const got = await ask('Bookmark', [
      { name: 'name', label: 'Bookmark name', value: here?.name ?? '', placeholder: 'Results', suggestions: marks.map((b) => b.name),
        help: 'Names the paragraph the caret is in, so a link (Insert > Link > Place in this document) can go to it. Type a name already used to go to it or delete it.' },
      { name: 'what', label: 'Then', value: 'add', options: [{ value: 'add', label: 'Add the bookmark here' }, { value: 'go', label: 'Go to the bookmark' }, { value: 'delete', label: 'Delete the bookmark' }] },
    ], { ok: 'OK' });
    this.focus();
    if (!got || this.file !== f) return;
    const name = bookmarkName(got.name);
    if (!got.name.trim()) return;
    if (got.what === 'go') { if (!this.goToPlace(`#${name}`)) this.host.flash(`There is no bookmark called ${name}.`); return; }
    if (got.what === 'delete') {
      if (bookmarkPara(f.t, name) < 0) { this.host.flash(`There is no bookmark called ${name}.`); return; }
      f.ed.update(removeBookmark(f.t, name), 'Delete Bookmark');
      this.host.flash(`Bookmark ${name} deleted (links to it no longer go anywhere).`);
      return;
    }
    f.ed.update(addBookmark(f.t, para, name), 'Bookmark');
    this.host.flash(name === got.name.trim() ? `Bookmark ${name} added.` : `Bookmark ${name} added (a bookmark's name is letters, digits and underscores).`);
  }

  // ---------------------------------------------------------------- the mouse

  private wirePointer(v: DocView): void {
    const s = v.scroller;
    s.addEventListener('pointerdown', (e) => { if (e.button === 0) this.activate(v); this.pointerDown(e); });
    s.addEventListener('pointermove', (e) => {
      // the mouse over the other pane: its own cursor (the pane being worked in stays the same)
      if (this.dragging || v === this.view) { this.pointerMove(e); return; }
      const was = this.view;
      this.view = v;
      try { this.pointerMove(e); } finally { this.view = was; }
    });
    s.addEventListener('pointerup', (e) => {
      const d = this.dragging;
      this.dragging = null;
      try { s.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (d?.kind === 'move' && d.moved) this.reanchor(d.id);
      if (d?.kind === 'inline') this.dropInline(d.id, d.to);
    });
    s.addEventListener('dblclick', (e) => {
      const f = this.file;
      if (!f || this.reading) return;
      this.activate(v);
      const id = this.objectAt(e.clientX, e.clientY);
      if (id !== null && f.t.objects[id]?.kind === 'bib') { e.preventDefault(); void this.manageReferences(); return; }
      if (id !== null && f.t.objects[id]?.kind === 'toc') { e.preventDefault(); void this.tocOptions(id); return; }
      if (id !== null && f.t.objects[id]?.kind === 'tof') { e.preventDefault(); void this.tofOptions(id); return; }
      if (id !== null && f.t.objects[id]?.kind === 'math') { e.preventDefault(); void this.editEquation(id); return; }
      if (f.box?.cell && id !== null && id !== f.box.id && f.t.objects[id]?.kind === 'drawing') { e.preventDefault(); this.editFigure(id); return; }
      if (f.box) { e.preventDefault(); return; }
      if (id !== null && f.t.objects[id]?.kind === 'textbox') { e.preventDefault(); this.startBox(id, this.view.toDoc(e.clientX, e.clientY)); return; }
      if (id !== null) { e.preventDefault(); this.editFigure(id); return; }
      // a citation: change what it cites
      const p = this.view.toDoc(e.clientX, e.clientY);
      const o = offsetAt(f.layout().text, p.x, p.y);
      for (const at of [o, o - 1]) {
        const obj = at >= 0 ? rt.sliceRuns(f.t.runs, at, at + 1)[0]?.obj : undefined;
        if (obj !== undefined && f.t.objects[obj]?.kind === 'cite') {
          e.preventDefault();
          f.ed.select(at, at + 1);
          void this.insertCitation();
          return;
        }
        // a footnote's number: to its text, as in Word
        if (obj !== undefined && f.t.objects[obj]?.kind === 'note') {
          e.preventDefault();
          this.startBox(obj);
          return;
        }
      }
    });
    s.addEventListener('contextmenu', (e) => {
      if (!this.file) return;
      this.activate(v);
      if (this.reading) return;
      const p = this.view.toDoc(e.clientX, e.clientY);
      // in a table: into the cell clicked (unless a structure in the cell typed into is picked)
      const cell = this.cellAt(p);
      const b = this.file.box;
      if (cell && !(b?.cell && b.id === cell.id && b.cell.r === cell.r && b.cell.c === cell.c)) this.startCell(cell.id, cell.r, cell.c, p);
      // in a footnote: typing there, so the menu is about it
      const hit = this.objectAt(e.clientX, e.clientY);
      if (hit !== null && hit !== b?.id && this.file.t.objects[hit]?.kind === 'note') this.startBox(hit, p);
      const o = offsetAt(this.file.layout().text, p.x, p.y);
      if (this.contextMenu(o, e.clientX, e.clientY)) e.preventDefault();
    });
  }

  /** The figure or picture under a point (client coordinates). */
  private objectAt(clientX: number, clientY: number): number | null {
    if (!this.file) return null;
    const p = this.view.toDoc(clientX, clientY);
    const lay = this.file.layout();
    const hit = lay.objects.filter((o) => p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h);
    // floating ones are on top of the text; one behind the text is picked only away from any text
    const top = hit.filter((o) => o.wrap && o.wrap !== 'behind').pop() ?? hit.find((o) => !o.wrap);
    if (top) return top.id;
    const behind = hit.find((o) => o.wrap === 'behind');
    if (behind && !lay.text.lines.some((l) => p.y >= l.y - (l.above ?? l.ascent) && p.y <= l.y + (l.below ?? l.descent) && p.x >= l.x && p.x <= l.x + l.width)) return behind.id;
    return null;
  }

  /** Near the edge of a placed object (where a text box is picked or moved rather than typed into). */
  private nearEdge(id: number, p: { x: number; y: number }): boolean {
    const o = this.file?.layout().objects.find((x) => x.id === id);
    if (!o || this.file?.t.objects[id]?.kind === 'note') return false;
    const m = 5 / this.view.zoom;
    return p.x - o.x < m || o.x + o.w - p.x < m || p.y - o.y < m || o.y + o.h - p.y < m;
  }

  private pointerDown(e: PointerEvent): void {
    const f = this.file;
    if (!f || e.button !== 0) return;
    // the scroll bars are part of the scrolling area: leave clicks on them alone
    const s = this.view.scroller;
    const r = s.getBoundingClientRect();
    if (e.clientX - r.left >= s.clientWidth || e.clientY - r.top >= s.clientHeight) return;
    e.preventDefault();
    this.closeMenu();
    this.focus();
    const p = this.view.toDoc(e.clientX, e.clientY);
    // a link: Ctrl+click follows it, as in Word (a plain click in Read Mode)
    if (((isMac ? e.metaKey : e.ctrlKey) || this.reading) && !e.shiftKey && !e.altKey) {
      const link = this.linkAtPoint(p);
      if (link) { void followLink(link); return; }
    }
    const now0 = performance.now();
    const c0 = this.clicks;
    const n = now0 - c0.time < 450 && Math.hypot(e.clientX - c0.at.x, e.clientY - c0.at.y) < 4 ? c0.n + 1 : 1;
    // Outline: a heading's mark picks it with everything under it; a double-click folds or unfolds it
    const mark = this.view.markAt(e.clientX, e.clientY);
    if (mark !== null) {
      Object.assign(c0, { n, time: now0, at: { x: e.clientX, y: e.clientY } });
      this.stopBox();
      if (n === 2) this.outlineFold(mark);
      else this.pickOutline(mark);
      return;
    }
    // Read Mode: text can be picked (to copy) but nothing is moved or typed into
    if (this.reading) {
      Object.assign(c0, { n, time: now0, at: { x: e.clientX, y: e.clientY } });
      const o = offsetAt(f.layout().text, p.x, p.y);
      if (n === 2) f.ed.selectWord(o);
      else if (n >= 3) f.ed.selectParagraph(o);
      else f.ed.setCaret(o, e.shiftKey);
      this.dragging = { kind: 'text' };
      s.setPointerCapture(e.pointerId);
      return;
    }
    // the picked figure's corner handle resizes it (one in a table cell too)
    const picked = this.pickedObject();
    if (picked !== null) {
      const o = f.layout().objects.find((x) => x.id === picked);
      const hs = 8 / this.view.zoom;
      if (o && Math.abs(p.x - (o.x + o.w)) <= hs && Math.abs(p.y - (o.y + o.h)) <= hs) {
        const obj = f.t.objects[picked];
        const scale0 = obj.kind === 'drawing' || obj.kind === 'picture' ? obj.scale ?? 1 : obj.kind === 'textbox' ? obj.w : 1;
        this.dragging = { kind: 'resize', id: picked, w0: o.w, scale0, x0: o.x };
        s.setPointerCapture(e.pointerId);
        return;
      }
    }
    // in a text box or table cell: clicks inside place its caret (or pick a structure in the cell)
    const inBox = () => {
      Object.assign(c0, { n, time: now0, at: { x: e.clientX, y: e.clientY } });
      const bed = f.box!.ed;
      const under = this.objectAt(e.clientX, e.clientY);
      const at = under !== null && under !== f.box!.id ? objectOffsets(bed.t.runs).get(under) : undefined;
      if (at !== undefined) { bed.select(at, at + 1); this.changed('selection'); return; }
      const o = offsetAt(bed.layout(), p.x, p.y);
      if (n === 2) bed.selectWord(o);
      else if (n >= 3) bed.selectParagraph(o);
      else bed.setCaret(o, e.shiftKey);
      this.dragging = { kind: 'box' };
      s.setPointerCapture(e.pointerId);
    };
    const cell = e.shiftKey ? null : this.cellAt(p);
    if (f.box) {
      const id = f.box.id;
      if (f.box.cell && cell?.id === id) {
        if (cell.r !== f.box.cell.r || cell.c !== f.box.cell.c) this.startCell(cell.id, cell.r, cell.c);
        inBox();
        return;
      }
      if (!f.box.cell && this.objectAt(e.clientX, e.clientY) === id && !this.nearEdge(id, p)) { inBox(); return; }
      this.stopBox();
    }
    // a click in a table types into the cell clicked
    if (cell) {
      this.startCell(cell.id, cell.r, cell.c);
      inBox();
      return;
    }
    const ed = f.ed;
    const id = this.objectAt(e.clientX, e.clientY);
    if (id !== null && !e.shiftKey) {
      const obj = f.t.objects[id];
      // a click inside a text box types into it; its edge picks it, to move it or change its look
      if ((obj?.kind === 'textbox' || obj?.kind === 'note') && !this.nearEdge(id, p)) { this.startBox(id, p); this.dragging = { kind: 'box' }; s.setPointerCapture(e.pointerId); return; }
      const at = objectOffsets(f.t.runs).get(id);
      if (at !== undefined) {
        ed.select(at, at + 1);
        // a floating figure is moved by dragging it
        const fl = floatOf(obj);
        if (fl) { this.dragging = { kind: 'move', id, from: p, float: fl, moved: false }; s.setPointerCapture(e.pointerId); }
        // one in line with the text is dragged to another place in the text, as in Word
        else if (obj?.kind !== 'table' && !f.box) { this.dragging = { kind: 'inline', id, from: p, to: null }; s.setPointerCapture(e.pointerId); }
        return;
      }
    }
    const now = performance.now();
    const c = this.clicks;
    c.n = now - c.time < 450 && Math.hypot(e.clientX - c.at.x, e.clientY - c.at.y) < 4 ? c.n + 1 : 1;
    c.time = now;
    c.at = { x: e.clientX, y: e.clientY };
    const o = offsetAt(f.layout().text, p.x, p.y);
    if (c.n === 2) ed.selectWord(o);
    else if (c.n >= 3) ed.selectParagraph(o);
    else ed.setCaret(o, e.shiftKey);
    this.dragging = { kind: 'text' };
    s.setPointerCapture(e.pointerId);
  }

  private pointerMove(e: PointerEvent): void {
    const f = this.file;
    const d = this.dragging;
    if (!f) return;
    if (!d) {
      const id = this.objectAt(e.clientX, e.clientY);
      const p = this.view.toDoc(e.clientX, e.clientY);
      const o = id !== null ? f.t.objects[id] : undefined;
      // the picked figure's corner handle resizes it
      const picked = this.pickedObject();
      const box = picked !== null ? f.layout().objects.find((x) => x.id === picked) : undefined;
      const hs = 8 / this.view.zoom;
      const corner = !!box && Math.abs(p.x - (box.x + box.w)) <= hs && Math.abs(p.y - (box.y + box.h)) <= hs;
      // a structure: a hand, since a double-click opens it for drawing (and a click picks it)
      const link = id === null || o?.kind === 'table' || o?.kind === 'textbox' ? this.linkAtPoint(p) : null;
      const tip = link ? linkTip(link, !this.reading) : '';
      if (this.view.scroller.title !== tip) this.view.scroller.title = tip;
      if (link && (this.reading || (isMac ? e.metaKey : e.ctrlKey))) { this.view.scroller.style.cursor = 'pointer'; return; }
      this.view.scroller.style.cursor = corner ? 'nwse-resize' : id === null || o?.kind === 'table' ? 'text'
        : o?.kind === 'textbox' ? (this.nearEdge(id, p) ? 'move' : 'text') : o?.kind === 'note' ? 'text'
        : floatOf(o) ? 'move' : o?.kind === 'drawing' ? 'pointer' : 'default';
      return;
    }
    const p = this.view.toDoc(e.clientX, e.clientY);
    if (d.kind === 'resize') {
      const w = Math.max(12, p.x - d.x0);
      const o = f.t.objects[d.id];
      if (o?.kind === 'textbox') this.setBoxWidth(d.id, Math.max(18, d.scale0 + (w - d.w0)), false);
      else this.setScale(d.id, Math.max(0.05, d.scale0 * (w / d.w0)), false);
      return;
    }
    if (d.kind === 'move') {
      const dx = p.x - d.from.x, dy = p.y - d.from.y;
      if (!d.moved && Math.hypot(dx, dy) * this.view.zoom < 3) return;
      this.setFloat(d.id, { ...d.float, x: d.float.x + dx, y: d.float.y + dy }, d.moved ? null : 'Move');
      d.moved = true;
      return;
    }
    if (d.kind === 'inline') {
      if (d.to === null && Math.hypot(p.x - d.from.x, p.y - d.from.y) * this.view.zoom < 3) return;
      // the caret shows where it will go
      d.to = offsetAt(f.layout().text, p.x, p.y);
      f.ed.setCaret(d.to);
      this.view.scroller.style.cursor = 'move';
      return;
    }
    if (d.kind === 'box') {
      if (this.clicks.n !== 1 || !f.box) return;
      f.box.ed.setCaret(offsetAt(f.box.ed.layout(), p.x, p.y), true);
      return;
    }
    if (this.clicks.n !== 1) return;
    // dragging past the top or bottom scrolls
    const r = this.view.scroller.getBoundingClientRect();
    if (e.clientY < r.top + 10) this.view.scroller.scrollTop -= 20;
    else if (e.clientY > r.bottom - 10) this.view.scroller.scrollTop += 20;
    f.ed.setCaret(offsetAt(f.layout().text, p.x, p.y), true);
  }

  /** An in-line figure dragged to another place in the text: move it there (one undo step) and keep it picked. */
  private dropInline(id: number, to: number | null): void {
    const f = this.file;
    const at = f ? objectOffsets(f.t.runs).get(id) : undefined;
    if (!f || at === undefined) return;
    const back = () => f.ed.select(objectOffsets(f.t.runs).get(id) ?? at, (objectOffsets(f.t.runs).get(id) ?? at) + 1);
    const plan = inlineMove(at, to);
    if (!plan) { back(); return; }
    if (f.t.track) { this.host.flash('Moving a figure isn\'t tracked: turn off Track Changes to drag it, or cut and paste it.'); back(); return; }
    const run = rt.sliceRuns(f.t.runs, at, at + 1);
    f.ed.replace(plan.insertAt, plan.insertAt, run, undefined, 'Move');
    f.ed.replace(plan.removeAt, plan.removeAt + 1, [], undefined, null);
    back();
  }

  // ---------------------------------------------------------------- figures

  /** Put an object into the text at the caret (in place of the selection), and pick it. */
  insertObject(o: DocObject, kind = 'Insert', look: Partial<rt.RunStyle> = {}): number {
    const f = this.file!;
    const b = f.box?.cell ? f.box : null;
    if (b && (o.kind === 'table' || o.kind === 'textbox' || o.kind === 'bib' || o.kind === 'toc' || o.kind === 'tof')) this.stopBox();
    else if (b) {
      // into the table cell typed into: the object joins the document, its character the cell's text
      const id = nextObjectId(f.t);
      f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: o } } as DocText, kind);
      const bed = b.ed;
      const at = bed.start;
      b.recorded = true;
      bed.replace(bed.start, bed.end, [objectRun(id, { ...bed.typingStyle(), ...look })], undefined, 'edit');
      b.recorded = false;
      if (o.kind === 'drawing' || o.kind === 'picture') bed.select(at, at + 1);
      return id;
    }
    const ed = f.ed;
    const id = nextObjectId(f.t);
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: o } } as DocText, kind);
    const style = { ...ed.typingStyle(), ...look };
    const at = ed.start;
    ed.replace(ed.start, ed.end, [objectRun(id, style)], undefined, null);
    // a figure alone in its paragraph is centred, as journals set them
    if (o.kind === 'drawing' || o.kind === 'picture') {
      const text = ed.text;
      const p = paraAt(text, at);
      const r = paraRange(text, p);
      if (r.end - r.start === 1) ed.setParas(p, p, { align: 'center', firstLine: undefined }, 'align');
      ed.select(at, at + 1);
    }
    return id;
  }

  /** Split view's Insert: a drawing as a figure at the caret, with the caret after it so typing carries on. */
  insertDrawing(contents: Contents): void {
    if (!this.file) return;
    this.insertObject({ kind: 'drawing', contents }, 'Insert structure');
    const ed = this.file.ed;
    ed.setCaret(ed.end, false);
    this.focus();
  }

  /** The window got narrower or wider (split view): fit the page width if the page no longer fits. */
  refit(): void {
    const f = this.file;
    if (!f) return;
    this.view.resize();
    const room = this.view.scroller.clientWidth - 48, page = f.layout().pageW;
    if (room < page * this.view.zoom) this.view.fitWidth();
    else if (this.view.zoom < ACTUAL) { if (room >= page * ACTUAL) this.view.setZoom(ACTUAL); else this.view.fitWidth(); }
    else this.redraw();
  }

  /** Open a figure in the drawing tools; the document gets the changed drawing on Done. */
  /** A drawing tool picked from a toolbox: the picked structure opens for it, else a new one starts at the cursor. */
  drawWithTool(): void {
    if (!this.file) return;
    const id = this.pickedObject();
    if (id !== null && this.file.t.objects[id]?.kind === 'drawing') this.editFigure(id);
    else this.drawNew();
  }

  editFigure(id: number, tools = false): void {
    const f = this.file;
    const o = f?.t.objects[id];
    if (o?.kind === 'picture' && o.chart) { void this.editChart(id); return; }
    if (!f || !o || o.kind !== 'drawing') return;
    // a diagram opens its text and look (Edit Drawing still opens the drawing tools on it)
    if (!tools && this.host.editDiagram && o.contents.shapes.some((s) => s.diagram)) {
      void this.host.editDiagram(o.contents).then((c) => {
        const cur = this.file === f ? f.t.objects[id] : undefined;
        if (!c || cur?.kind !== 'drawing') return;
        f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...cur, contents: c } } } as DocText, 'Edit diagram');
        this.focus();
      });
      return;
    }
    const spot = this.cellSpot();
    this.host.editDrawing(o.contents, 'Figure', (c) => {
      if (this.file === f) this.backToCell(spot);
      if (!c || this.file !== f) { this.focus(); return; }
      const cur = f.t.objects[id];
      if (cur?.kind !== 'drawing') return;
      if (f.box?.cell) f.box.recorded = false;
      f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...cur, contents: c } } } as DocText, 'Edit figure');
      this.focus();
    });
  }

  /** Insert > Chart: a chart with its own data, at the caret. */
  private async insertChart(): Promise<void> {
    const f = this.file!;
    const spot = this.cellSpot();
    const room = f.layout().textW;
    const w = Math.min(360, room), h = w * 0.6;
    const got = await editChart(newChartBox('column', w, h), true, (m, ms) => this.host.flash(m, ms));
    if (this.file !== f) return;
    this.backToCell(spot);
    if (!got || got === 'delete') { this.focus(); return; }
    const size = chartPoints(got.chart);
    this.insertObject({ kind: 'picture', src: chartBoxPng(got, size.w, size.h), w: size.w, h: size.h, px: { w: got.chart.w, h: got.chart.h }, chart: got }, 'Insert chart');
    this.focus();
  }

  /** A chart's data and settings (double-click it); it keeps the size it is shown at unless changed there. */
  private async editChart(id: number): Promise<void> {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'picture' || !o.chart) return;
    const spot = this.cellSpot();
    const k = o.scale ?? 1;
    const got = await editChart(sizedBox(o.chart, o.w * k, o.h * k), false, (m, ms) => this.host.flash(m, ms));
    if (this.file !== f) return;
    this.backToCell(spot);
    const cur = f.t.objects[id];
    if (!got || cur?.kind !== 'picture' || !cur.chart) { this.focus(); return; }
    if (f.box?.cell) f.box.recorded = false;
    if (got === 'delete') {
      const at = objectOffsets(f.t.runs).get(id);
      if (at !== undefined && !f.box) { f.ed.select(at, at + 1); f.ed.replaceSelection([], undefined, 'Delete chart'); }
      else this.host.flash('Click the chart and press Delete to take it out.');
      this.focus();
      return;
    }
    const size = chartPoints(got.chart);
    const next: DocObject = { ...cur, chart: got, src: chartBoxPng(got, size.w, size.h), w: size.w, h: size.h, px: { w: got.chart.w, h: got.chart.h }, scale: undefined };
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, 'Edit chart');
    this.focus();
  }

  /**
   * Picture Format…: a picture's corrections, colours, see-through, Remove Background and crop
   * (to a shape or proportions). Cropping to proportions keeps its width and changes its height.
   */
  async formatPicture(id: number): Promise<void> {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'picture' || o.chart) return;
    const spot = this.cellSpot();
    const got = await pictureFormat({ src: o.src, fx: o.fx, crop: o.crop, w: o.w, h: o.h });
    if (this.file !== f) return;
    this.backToCell(spot);
    const cur = f.t.objects[id];
    if (!got || cur?.kind !== 'picture') { this.focus(); return; }
    if (f.box?.cell) f.box.recorded = false;
    const next: DocObject = { ...cur, fx: got.fx };
    if (!got.fx) delete next.fx;
    if (got.crop) {
      const c = got.crop;
      if (c.l || c.t || c.r || c.b) next.crop = c; else delete next.crop;
      if (got.aspect) next.h = Math.round((cur.w / got.aspect) * 100) / 100;
    }
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, 'Picture format');
    this.focus();
  }

  /** Make a figure or picture bigger or smaller (1 is its own size). */
  setScale(id: number, scale: number, record = true): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (!o || (o.kind !== 'drawing' && o.kind !== 'picture')) return;
    const next: DocObject = { ...o, scale: Math.abs(scale - 1) < 1e-6 ? undefined : scale };
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, record ? 'Resize' : null);
  }

  /** Change a figure's or picture's frame and shadow (undefined values take them off). */
  setLook(id: number, patch: Partial<FigureLook>): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (!o || (o.kind !== 'drawing' && o.kind !== 'picture' && o.kind !== 'textbox')) return;
    const look: FigureLook = { ...o.look, ...patch };
    for (const k of Object.keys(look) as (keyof FigureLook)[]) if (look[k] === undefined) delete look[k];
    const next: DocObject = { ...o, look: Object.keys(look).length ? look : undefined };
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, 'Picture format');
  }

  /** The frame and shadow of the figure picked. */
  lookOf(id: number): FigureLook | undefined {
    return lookOf(this.file?.t.objects[id]);
  }

  /** A text box's width (it grows down to fit its text). */
  setBoxWidth(id: number, w: number, record = true): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'textbox') return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...o, w } } } as DocText, record ? 'Resize' : null);
  }

  /** Change a figure's or text box's background colour (text boxes only). */
  setFill(id: number, fill: string | undefined): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'textbox') return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...o, fill } } } as DocText, 'Fill');
  }

  /** Put a figure on the page at a place (or back in its line with null). Text boxes always float. */
  setFloat(id: number, fl: Float | null, kind: string | null = 'Wrap text'): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (!o || (o.kind !== 'drawing' && o.kind !== 'picture' && o.kind !== 'textbox')) return;
    if (!fl && o.kind === 'textbox') return;
    if (fl && cellHolding(f.t, id)) { this.host.flash('A structure or picture in a table cell stays in its line.'); return; }
    const next = { ...o, float: fl ?? undefined } as DocObject;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, kind);
  }

  /**
   * Wrap Text: in line with the text, or floating with text round it (square, top and bottom),
   * or behind or in front of the text. A figure taken out of its line stays where it was shown.
   */
  setWrap(id: number, wrap: WrapKind | 'inline'): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (!o) return;
    const cur = floatOf(o);
    if (wrap === 'inline') { if (cur) this.setFloat(id, null); return; }
    if (cur) { this.setFloat(id, { ...cur, wrap }); return; }
    // from its line: keep it where it is, measured from the top of its paragraph and the left margin
    const lay = f.layout();
    const placed = lay.objects.find((x) => x.id === id);
    const at = objectOffsets(f.t.runs).get(id);
    const para = at !== undefined ? paraAt(f.ed.text, at) : 0;
    const [el, et] = lookExtentOf(o);
    const top = lay.paraTops[para];
    const x = placed ? placed.x - el - f.t.page.left : 0;
    const y = placed && top ? placed.y - et - top.y : 0;
    this.setFloat(id, { wrap, x, y });
  }

  /**
   * After a floating figure is dragged: it belongs to the paragraph it was dropped beside
   * (its character moves to the start of that paragraph), so it moves with that text from now on.
   */
  private reanchor(id: number): void {
    const f = this.file!;
    const o = f.t.objects[id];
    const fl = floatOf(o);
    if (!fl || (fl.yFrom && fl.yFrom !== 'para')) return;
    const lay = f.layout();
    const placed = lay.objects.find((x) => x.id === id);
    const at = objectOffsets(f.t.runs).get(id);
    if (!placed || at === undefined) return;
    const text = f.ed.text;
    const from = paraAt(text, at);
    const [, et] = lookExtentOf(o!);
    const topY = placed.y - et;
    // the paragraph whose top is the last one above the figure's top on its page
    let to = from;
    let best = -Infinity;
    lay.paraTops.forEach((pt, i) => { if (pt.page === placed.page && pt.y <= topY + 0.5 && pt.y > best) { best = pt.y; to = i; } });
    if (best === -Infinity) {
      // above every paragraph's top on its page: the first paragraph on the page
      const first = lay.paraTops.findIndex((pt) => pt.page === placed.page);
      if (first >= 0) to = first;
    }
    if (to === from) return;
    const run = rt.sliceRuns(f.t.runs, at, at + 1);
    let runs = rt.replaceRange(f.t.runs, at, at + 1, []);
    const target = paraRange(rt.plainText(runs), to > from ? to : to).start;
    runs = rt.replaceRange(runs, target, target, run);
    const y = topY - lay.paraTops[to].y;
    f.ed.update({ ...f.t, runs, objects: { ...f.t.objects, [id]: { ...o, float: { ...fl, y } } as DocObject } } as DocText, null, target, target + 1);
  }

  /** Insert > Shapes: a shape from the library, as a drawing in the text at the caret (double-click to change it). */
  insertShape(geo: string): void {
    const look = geoShapeStyle(geo);
    if (!this.file || !look) return;
    const d = new Doc();
    const [w, h] = geoDef(geo).size;
    d.edit('Shape', () => d.addShape({ ...look, x1: 0, y1: 0, x2: w, y2: h } as Omit<Shape, 'id'>));
    this.insertObject({ kind: 'drawing', contents: d.contents() }, 'Insert shape');
    this.focus();
  }

  /** Insert > Diagram: a SmartArt-style diagram from text, as a drawing in the text at the caret (double-click to change it). */
  async insertDiagram(): Promise<void> {
    if (!this.file || !this.host.editDiagram) return;
    const f = this.file;
    const c = await this.host.editDiagram(null);
    if (!c || this.file !== f) { this.focus(); return; }
    this.insertObject({ kind: 'drawing', contents: c }, 'Insert diagram');
    this.focus();
  }

  /** Insert > Text Box: a box of text on the page, at the left margin beside the paragraph the caret is in. */
  insertTextBox(): void {
    const f = this.file!;
    this.stopBox();
    const ed = f.ed;
    const text = ed.text;
    const p = paraAt(text, ed.start);
    const start = paraRange(text, p).start;
    const id = nextObjectId(f.t);
    const N = styleOf(f.t, {});
    const box: DocObject = {
      kind: 'textbox', runs: [{ ...runStyleOf(N), text: '' }], w: 2 * INCH, fill: '#ffffff', look: { frame: 0.75 },
      float: { wrap: 'square', x: 0, y: 0 },
    };
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: box } } as DocText, 'Insert text box');
    ed.replace(start, start, [objectRun(id, ed.typingStyle())], undefined, null);
    this.startBox(id);
  }

  // ---------------------------------------------------------------- commands

  /** Run a command from the ribbon, the menus or a key. False when it doesn't apply here. */
  run(cmd: string): boolean {
    const f = this.file;
    if (!f) return false;
    // in a text box, the text buttons work on its text; other commands leave it first
    if (f.box && !BOX_COMMANDS.test(cmd) && !(f.box.cell && CELL_COMMANDS.test(cmd))) this.stopBox();
    if (/^table-/.test(cmd)) { this.tableCommand(cmd); return true; }
    if (/^outline-/.test(cmd)) { this.outlineCommand(cmd); return true; }
    const kind = VIEW_COMMANDS[cmd];
    if (kind) { this.setViewKind(kind); return true; }
    const ed = this.ed;
    const style = (id: string) => {
      const [a, b] = ed.selectedParas();
      ed.update(setParaStyle(f.t, a, b, id), 'Style');
    };
    const line = (v: number) => ed.setSelectedParas({ line: Math.abs(v - 1) < 1e-6 ? undefined : v }, 'spacing');
    const align = (j: 'left' | 'center' | 'right' | 'justify') => ed.setSelectedParas({ align: j === 'left' ? undefined : j }, 'align');
    switch (cmd) {
      case 'doc-align-left': align('left'); break;
      case 'doc-align-center': align('center'); break;
      case 'doc-align-right': align('right'); break;
      case 'doc-justify': align('justify'); break;
      case 'style-normal': style('Normal'); break;
      case 'style-title': style('Title'); break;
      case 'style-h1': style('Heading1'); break;
      case 'style-h2': style('Heading2'); break;
      case 'style-h3': style('Heading3'); break;
      case 'style-caption': style('Caption'); break;
      case 'line-single': line(1); break;
      case 'line-1-5': line(1.5); break;
      case 'line-double': line(2); break;
      case 'font-bigger': case 'font-smaller': {
        const cur = ed.currentStyle().size ?? styleOf(f.t, ed.currentPara()).size;
        const sizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
        const next = cmd === 'font-bigger' ? sizes.find((s) => s > cur + 1e-6) ?? cur + 2 : [...sizes].reverse().find((s) => s < cur - 1e-6) ?? Math.max(1, cur - 1);
        ed.setStyle({ size: next });
        break;
      }
      case 'doc-bold': ed.toggle('bold'); break;
      case 'doc-italic': ed.toggle('italic'); break;
      case 'doc-underline': ed.toggle('underline'); break;
      case 'doc-sub': ed.toggle('sub'); break;
      case 'doc-sup': ed.toggle('sup'); break;
      case 'doc-formula': ed.toggle('formula'); break;
      case 'doc-highlight': {
        const on = ed.currentStyle().highlight;
        ed.setStyle({ highlight: on && on === this.highlighter ? undefined : this.highlighter });
        break;
      }
      case 'doc-highlight-menu': this.highlightMenu(); return true;
      case 'doc-bullets': ed.list('bullet'); break;
      case 'doc-numbering': ed.list('number'); break;
      case 'doc-indent': ed.indent(1); break;
      case 'doc-outdent': ed.indent(-1); break;
      case 'page-break': this.pageBreak(); break;
      case 'col-break': this.pageBreak(true); break;
      case 'select-all': ed.selectAll(); break;
      case 'undo': this.undo(false); break;
      case 'redo': this.undo(true); break;
      case 'insert-structure': this.drawNew(); break;
      case 'structure-from-name-doc': case 'name-to-structure': void this.fromName(); break;
      case 'insert-picture': void this.insertPicture(); break;
      case 'insert-text-box': this.insertTextBox(); break;
      case 'wrap-inline': case 'wrap-square': case 'wrap-topBottom': case 'wrap-behind': case 'wrap-front': {
        const id = this.pickedObject() ?? f.box?.id ?? null;
        if (id === null) { this.host.flash('Click a structure, picture or text box first, then choose how text wraps round it.'); break; }
        this.setWrap(id, cmd.slice(5) as WrapKind | 'inline');
        break;
      }
      case 'insert-table': void this.insertTable(); break;
      case 'insert-chart': void this.insertChart(); break;
      case 'edit-chart': { const id = this.pickedObject(); const o = id !== null ? f.t.objects[id] : undefined; if (id === null || o?.kind !== 'picture' || !o.chart) { this.host.flash('Click a chart first (or double-click it).'); break; } void this.editChart(id); break; }
      case 'picture-format': { const id = this.pickedObject(); const o = id !== null ? f.t.objects[id] : undefined; if (id === null || o?.kind !== 'picture' || o.chart) { this.host.flash('Click a picture first.'); break; } void this.formatPicture(id); break; }
      case 'insert-caption': void this.insertCaption(); break;
      case 'cross-reference': void this.crossReference(); break;
      case 'compound-number': void this.compoundNumber(); break;
      case 'insert-citation': void this.insertCitation(); break;
      case 'insert-bibliography': this.insertBibliography(); break;
      case 'insert-toc': void this.insertToc(); break;
      case 'insert-tof': void this.insertTof(); break;
      case 'insert-footnote': this.insertNote(false); break;
      case 'insert-endnote': this.insertNote(true); break;
      case 'note-options': void this.noteOptions(); break;
      case 'insert-equation': void this.insertEquation(); break;
      case 'insert-link': void this.editLink(); break;
      case 'remove-link': if (!ed.linkHere()) { this.host.flash('Put the caret in a link first.'); break; } ed.removeLink(); break;
      case 'open-link': { const l = ed.linkHere(); if (!l) { this.host.flash('Put the caret in a link first.'); break; } void followLink(l.link); break; }
      case 'insert-bookmark': void this.bookmarkDialog(); break;
      case 'edit-equation': { const m = this.pickedMath(); if (m === null) { this.host.flash('Click an equation first (or double-click it).'); break; } void this.editEquation(m); break; }
      case 'track-changes': void this.toggleTracking(); break;
      case 'review-name': void this.askReviewName(); break;
      case 'new-comment': void this.comments.add(); return true;
      case 'delete-comment': this.comments.remove(); break;
      case 'delete-all-comments': this.comments.removeAll(); break;
      case 'resolve-comment': this.comments.toggleResolved(); break;
      case 'next-comment': case 'prev-comment': this.comments.step(cmd === 'next-comment'); return true;
      case 'show-comments': this.comments.toggleShown(); this.updateRibbon(); break;
      case 'accept-change': case 'reject-change': this.decideChange(cmd === 'accept-change'); break;
      case 'accept-all': case 'reject-all': this.decideAll(cmd === 'accept-all'); break;
      case 'next-change': case 'prev-change': this.goToChange(cmd === 'next-change'); break;
      case 'manage-references': void this.manageReferences(); break;
      case 'edit-figure': { const id = this.pickedObject(); if (id === null) { this.host.flash('Click a structure or scheme first, then Edit Drawing (or double-click it).'); break; } this.editFigure(id, true); break; }
      case 'view-vertical': this.arrange(false, 1, false); break;
      case 'view-sideways': if (this.view.sideways) this.arrange(false, 1, false); else this.arrange(true, 1, true); break;
      case 'view-multiple': this.arrange(false, this.view.perRow > 1 ? 1 : 2, true); break;
      case 'view-one-page': this.arrange(this.view.sideways, 1, true); break;
      case 'view-split': this.setSplit(!this.split); this.focus(); break;
      case 'read-next': this.turn(1); break;
      case 'read-prev': this.turn(-1); break;
      case 'zoom-in': this.view.setZoom(this.view.zoom * 1.25); this.showZoom(); break;
      case 'zoom-out': this.view.setZoom(this.view.zoom * 0.8); this.showZoom(); break;
      case 'zoom-fit': this.view.fitWidth(); this.showZoom(); break;
      case 'zoom-actual': this.view.setZoom(ACTUAL); this.showZoom(); break;
      case 'find': case 'replace': this.find(cmd === 'replace'); return true;
      case 'paste': void this.paste(null); break;
      case 'copy': case 'cut': this.focus(); document.execCommand(cmd); break;
      case 'box-para': case 'box-style': case 'box-page': case 'box-hf':
        this.panel.open(cmd.slice(4) as DocBoxKey);
        return true;
      case 'margins-custom': case 'paper-custom':
        this.panel.open('page', this.ribbon.querySelector<HTMLElement>(cmd === 'paper-custom' ? '#doc-paper' : '#doc-margins'), cmd === 'paper-custom' ? 'pg-w' : 'pg-top');
        this.updateRibbon();
        return true;
      case 'header-edit': this.panel.open('hf', null, 'hf-header0'); return true;
      case 'footer-edit': this.panel.open('hf', null, 'hf-footer1'); return true;
      case 'numbers-s': {
        const hf = this.section().hf;
        const s = hf.prefix === 'S';
        this.setSection({ hf: { ...hf, prefix: s ? '' : 'S', numbers: hf.numbers === 'none' ? 'footer-center' : hf.numbers } }, 'Page numbers');
        break;
      }
      case 'page-number-format': void this.pageNumberFormat(); return true;
      default: {
        const m = /^(margins|paper|orient|numbers|columns|breaks|linenums)-(.*)$/.exec(cmd);
        if (!m || !this.layoutCommand(m[1], m[2])) return false;
      }
    }
    this.focus();
    return true;
  }

  /** The pinned settings boxes were read from the settings. */
  boxesChanged(): void {
    this.panel.placeBoxes();
  }

  /** Find, and Find and Replace (Ctrl+F, Ctrl+H). */
  find(replace: boolean): void {
    this.finder.show(replace);
  }

  /** A picture dropped on the pages: it goes in the text at the caret. */
  dropPicture(bytes: Uint8Array, mime: string): void {
    const f = this.file;
    if (!f) return;
    const src = dataUrl(bytes, mime);
    const px = imageSize(bytes, mime) ?? { w: 400, h: 300 };
    this.insertObject({ kind: 'picture', src, w: px.w * 0.75, h: px.h * 0.75, px }, 'Insert picture');
    this.focus();
  }

  /** The section the caret is in (its page setup, header and footer, numbering and line numbers). */
  private section(): Section {
    const f = this.file!;
    return sectionAt(sectionsOf(f.t), paraAt(f.ed.text, f.ed.focus));
  }

  /** Change the section the caret is in. */
  private setSection(patch: SectionPatch, label: string): void {
    const f = this.file!;
    f.ed.update(changeSection(f.t, this.section().index, patch), label);
  }

  /** Layout tab: margins, paper, orientation, columns and page numbers (of the section the caret is in), breaks and line numbers. */
  private layoutCommand(what: string, v: string): boolean {
    const f = this.file!;
    const sec = this.section();
    const pg = sec.page;
    const page = (p: Partial<PageSetup>) => this.setSection({ page: { ...pg, ...p } }, 'Page setup');
    const land = pg.w > pg.h;
    if (what === 'margins') {
      const m: Record<string, [number, number]> = { normal: [1, 1], narrow: [0.5, 0.5], moderate: [1, 0.75], wide: [1, 2] };
      if (!m[v]) return false;
      page({ top: m[v][0] * INCH, bottom: m[v][0] * INCH, left: m[v][1] * INCH, right: m[v][1] * INCH });
    } else if (what === 'paper') {
      const size = v === 'a4' ? A4 : v === 'letter' ? LETTER : null;
      if (!size) return false;
      page(land ? { w: size.h, h: size.w } : { ...size });
    } else if (what === 'orient') {
      if ((v === 'landscape') !== land) page({ w: pg.h, h: pg.w });
    } else if (what === 'columns') {
      if (v === 'more') { this.panel.open('page', this.ribbon.querySelector<HTMLElement>('#doc-columns'), 'pg-cols'); return true; }
      const n = Number(v);
      if (!(n >= 1 && n <= 4)) return false;
      page({ cols: n > 1 ? n : undefined });
    } else if (what === 'numbers') {
      this.setSection({ hf: { ...sec.hf, numbers: v as NumberPlace } }, 'Page numbers');
    } else if (what === 'breaks') {
      if (v === 'page' || v === 'column') this.pageBreak(v === 'column');
      else if (v in BREAK_NAMES) this.sectionBreak(v as BreakKind);
      else if (v !== '') return false;
      this.updateRibbon();
    } else if (what === 'linenums') {
      const L = sec.lines;
      if (v === 'none') this.setSection({ lines: undefined }, 'Line numbers');
      else if (v === 'continuous' || v === 'page' || v === 'section') this.setSection({ lines: { start: 1, countBy: 1, ...L, restart: v } }, 'Line numbers');
      else if (v === 'suppress') {
        const [a, b] = f.ed.selectedParas();
        const off = !fitParas(f.t.paras, paraCount(f.ed.text))[a]?.noLineNumbers;
        f.ed.setParas(a, b, { noLineNumbers: off || undefined }, 'spacing');
        this.updateRibbon();
      } else if (v === 'options') { void this.lineNumberOptions(); return true; }
      else return false;
    } else return false;
    return true;
  }

  /**
   * A section break at the caret: what follows starts a new section (on a new page, the next
   * even or odd page, or the same page), with this section's page setup and line numbers, its
   * header and footer linked to this one's and its page numbers carrying on, as in Word.
   */
  private sectionBreak(kind: BreakKind): void {
    const ed = this.ed;
    const s = this.section();
    ed.enter(false);
    const p = paraAt(ed.text, ed.focus);
    ed.setParas(p, p, { section: newBreak(s, kind), pageBreak: undefined, colBreak: undefined }, 'break');
    this.host.flash(`Section break (${BREAK_NAMES[kind]}): the text after it is section ${s.index + 2}, with its own page setup, header and footer, and page and line numbers.`);
  }

  /** Line Numbers > Line Numbering Options: where they start, every how many, how far from the text, and when they start again. */
  private async lineNumberOptions(): Promise<void> {
    const f = this.file!;
    const sec = this.section();
    const L = sec.lines;
    const got = await ask('Line Numbers', [
      { name: 'on', label: 'Add line numbering', type: 'checkbox', value: 'true' },
      { name: 'start', label: 'Start at', type: 'number', value: String(L?.start ?? 1) },
      { name: 'countBy', label: 'Count by', type: 'number', value: String(L?.countBy ?? 1), help: 'Show every nth number (5: 5, 10, 15…); every line is still counted' },
      { name: 'distance', label: 'From text', value: L?.distance !== undefined ? showLength(L.distance, 'in') : '', placeholder: 'Auto (0.25 in)', unit: 'in' },
      { name: 'restart', label: 'Numbering', value: L?.restart ?? 'page', options: [
        { value: 'page', label: 'Restart each page' }, { value: 'section', label: 'Restart each section' }, { value: 'continuous', label: 'Continuous' },
      ] },
    ], { ok: 'Apply', note: sectionsOf(f.t).length > 1 ? `For section ${sec.index + 1} (the one the caret is in). Turn them off for a paragraph with Line Numbers > Suppress for Current Paragraph.` : 'Numbers down the left margin, as journals ask for in manuscripts under review. Turn them off for a paragraph with Line Numbers > Suppress for Current Paragraph.' });
    this.focus();
    if (!got || this.file !== f) return;
    if (got.on !== 'true') { this.setSection({ lines: undefined }, 'Line numbers'); return; }
    const num = (v: string, d: number, min: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min ? n : d; };
    const dist = got.distance.trim() ? parseLength(got.distance, 'in') : null;
    const lines: LineNumbers = { start: num(got.start, 1, 0), countBy: num(got.countBy, 1, 1), restart: got.restart as LineNumbers['restart'] };
    if (dist !== null && dist >= 0) lines.distance = dist;
    this.setSection({ lines }, 'Line numbers');
  }

  /** Insert > Page Number > Format: 1, 2, 3 or i, ii, iii, and where this section's numbering starts. */
  private async pageNumberFormat(): Promise<void> {
    const f = this.file!;
    const sec = this.section();
    const FORMATS: PageNumFormat[] = ['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter'];
    const first = sec.index === 0;
    const got = await ask('Page Number Format', [
      { name: 'format', label: 'Number format', value: sec.format, options: FORMATS.map((v) => ({ value: v, label: [1, 2, 3].map((n) => pageNumText(n, v)).join(', ') })) },
      ...(first ? [] : [{ name: 'cont', label: 'Continue from previous section', type: 'checkbox' as const, value: String(sec.restart === undefined) }]),
      { name: 'start', label: first ? 'Start at' : 'Or start at', type: 'number', value: String(sec.restart ?? 1) },
    ], { ok: 'Apply', note: first ? (sectionsOf(f.t).length > 1 ? 'For the first section. Front matter is often numbered i, ii, iii, with a section break (Layout > Breaks) before the text, numbered 1, 2, 3 from its first page.' : 'Front matter is often numbered i, ii, iii: put a section break (Layout > Breaks > Next Page) before the text and number that section 1, 2, 3 from its first page.') : `For section ${sec.index + 1} (the one the caret is in).` });
    this.focus();
    if (!got || this.file !== f) return;
    const n = Math.round(Number(got.start));
    const start = Number.isFinite(n) ? n : 1;
    this.setSection({ format: got.format as PageNumFormat, restart: first || got.cont !== 'true' ? start : undefined }, 'Page numbers');
  }

  /** Ctrl+Enter: what follows the caret starts a new page. */
  private pageBreak(column = false): void {
    const ed = this.ed;
    ed.enter(false);
    const p = paraAt(ed.text, ed.focus);
    ed.setParas(p, p, column ? { colBreak: true } : { pageBreak: true }, 'break');
  }

  private drawNew(): void {
    const f = this.file!;
    const spot = this.cellSpot();
    this.host.editDrawing(null, 'New structure', (c) => {
      if (this.file === f) this.backToCell(spot);
      if (!c || this.file !== f) { this.focus(); return; }
      this.insertObject({ kind: 'drawing', contents: c }, 'Insert structure');
      this.focus();
    });
  }

  private async fromName(): Promise<void> {
    const f = this.file!;
    const spot = this.cellSpot();
    const got = await ask('Structure from Name or SMILES', [{ name: 'text', label: 'Name or SMILES', value: '' }], {
      ok: 'Insert', note: 'A systematic or common name (ethyl acetate, 4-bromoanisole) or a SMILES string. The structure goes in the text at the caret.',
    });
    this.focus();
    if (!got?.text.trim() || this.file !== f) return;
    const r = await this.host.toStructure(got.text, f.t.drawingStyle);
    if ('error' in r) { this.host.flash(r.error, 8000); return; }
    this.backToCell(spot);
    this.insertObject({ kind: 'drawing', contents: r.contents }, 'Insert structure');
    if (r.notes.length) this.host.flash(r.notes.join(' '), 8000);
  }

  private async insertPicture(): Promise<void> {
    const f = this.file!;
    const spot = this.cellSpot();
    const pic = await this.host.pickPicture();
    if (!pic || this.file !== f) return;
    this.backToCell(spot);
    // pictures come in at 96 pixels to the inch, as in Word
    this.dropPicture(pic.bytes, pic.mime);
  }

  private async insertTable(nest = false): Promise<void> {
    const f = this.file!;
    // typing in a table cell: the new table goes inside the cell
    const host = this.tableTarget();
    const inCell = !!(f.box?.cell && host) || nest;
    if (nest && !f.box?.cell) { this.host.flash('Click in a table cell first.'); return; }
    const got = await ask('Insert Table', [
      { name: 'rows', label: 'Rows', value: '4', type: 'number' },
      { name: 'cols', label: 'Columns', value: '3', type: 'number' },
      { name: 'kind', label: 'Style', value: this.lastTableKind, options: TABLE_KINDS.map(([value, label]) => ({ value, label })) },
    ], { ok: 'Insert', note: 'A table in the text is typed into where it is, like a table in Word: click a cell to type, Tab goes to the next cell, and the Table tab adds rows and columns. Structures and pictures can go in its cells. The drawing kind is edited in the drawing tools.' });
    this.focus();
    if (!got || this.file !== f) return;
    const rows = Math.max(1, Math.min(500, Math.round(Number(got.rows) || 4)));
    const cols = Math.max(1, Math.min(60, Math.round(Number(got.cols) || 3)));
    this.lastTableKind = got.kind;
    if (inCell && host && got.kind !== 'drawing' && f.box?.cell) {
      // as wide as the cell inside its margins, the columns sharing it
      const room = host.t.cols.slice(host.c, host.c + spanOf(host.t, host.r, host.c)).reduce((a, b) => a + b, 0) - 2 * CELL_PAD.x;
      const N = styleOf(f.t, {});
      const lines = got.kind === 'acs' ? 'acs' : got.kind === 'none' ? 'none' : 'grid';
      const t0 = emptyTable(rows, cols, N.size);
      const w = Math.max(6, Math.floor((room / cols) * 100) / 100);
      this.insertNestedTable({ ...t0, cols: Array(cols).fill(w), lines, head: lines === 'grid' ? 0 : t0.head, align: Array(cols).fill('left') });
      return;
    }
    if (got.kind === 'drawing') {
      const id = this.insertObject({ kind: 'drawing', contents: this.host.newTable(rows, cols, f.t.drawingStyle) }, 'Insert table');
      this.editFigure(id);
      return;
    }
    this.stopBox();
    const lay = f.layout();
    const N = styleOf(f.t, {});
    const lines = got.kind === 'acs' ? 'acs' : got.kind === 'none' ? 'none' : 'grid';
    // columns share the width of the text, as Word's do
    const t0 = emptyTable(rows, cols, N.size);
    const w = Math.floor((lay.textW / cols) * 100) / 100;
    const table: TableData = { ...t0, cols: Array(cols).fill(w), lines, head: lines === 'grid' ? 0 : t0.head, align: Array(cols).fill('left') };
    this.insertTableObject(table);
  }

  /** Put a table into the cell typed into, as a paragraph of its own in the cell, and type into its first cell. */
  private insertNestedTable(table: TableData): void {
    const f = this.file!;
    const b = f.box;
    if (!b?.cell) return;
    const id = nextObjectId(f.t);
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'table', table } } } as DocText, 'Insert table');
    const bed = b.ed;
    const style = bed.typingStyle();
    const text = bed.text;
    const nl = { ...style, text: '\n' };
    const runs = [...(bed.start > 0 && text[bed.start - 1] !== '\n' ? [nl] : []), objectRun(id, style), ...(bed.end < text.length && text[bed.end] !== '\n' ? [nl] : [])];
    b.recorded = true;
    bed.replace(bed.start, bed.end, runs, undefined, 'edit');
    b.recorded = false;
    this.startCell(id, 0, 0, 'start');
  }

  /** Put a table in the text as a paragraph of its own (after the caret's paragraph text), and type into its first cell. */
  private insertTableObject(table: TableData): void {
    const f = this.file!;
    const ed = f.ed;
    const id = nextObjectId(f.t);
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'table', table } } } as DocText, 'Insert table');
    const text = ed.text;
    const p = paraAt(text, ed.start);
    const r = paraRange(text, p);
    const style = ed.typingStyle();
    if (r.end === r.start) ed.replace(r.start, r.end, [objectRun(id, style)], undefined, null);
    else {
      // a table is a paragraph of its own: after this one, with an empty paragraph to carry on typing in
      ed.replace(r.end, r.end, [{ ...style, text: '\n' }, objectRun(id, style)], undefined, null);
    }
    if (!rt.plainText(f.t.runs).slice(objectOffsets(f.t.runs).get(id)! + 1).startsWith('\n')) {
      const at = objectOffsets(f.t.runs).get(id)! + 1;
      ed.replace(at, at, [{ ...style, text: '\n' }], undefined, null);
    }
    // a table's paragraph has no spacing or indent of its own (as in Word)
    const tp = paraAt(ed.text, objectOffsets(f.t.runs).get(id)!);
    ed.setParas(tp, tp, { spaceBefore: 0, spaceAfter: 0, firstLine: 0, indent: undefined, list: undefined }, null);
    this.startCell(id, 0, 0, 'start');
  }

  /**
   * References > Insert Caption: a numbered caption paragraph ("Figure 2. ") under the
   * paragraph the caret is in, or above it (for a scheme or table, as journals set them, or
   * when asked), ready to type into.
   */
  /** Where the last caption went (kept while the program is open). */
  private captionPlace: 'usual' | 'above' | 'below' = 'usual';

  private async insertCaption(): Promise<void> {
    const f = this.file!;
    const got = await ask('Insert Caption', [
      { name: 'name', label: 'Label', value: 'Figure', options: CAPTION_NAMES.map((n) => ({ value: n, label: n })) },
      { name: 'prefix', label: 'Before the number', value: '', options: [{ value: '', label: 'Nothing (Figure 1)' }, { value: 'S', label: 'S (Figure S1, for Supporting Information)' }] },
      { name: 'place', label: 'Position', value: this.captionPlace, options: [{ value: 'usual', label: 'As journals set them (Scheme and Table above, others below)' }, { value: 'above', label: 'Above the selected item' }, { value: 'below', label: 'Below the selected item' }] },
    ], { ok: 'Insert', note: 'Captions number themselves in order, and references to them follow when they move.' });
    this.focus();
    if (!got || this.file !== f) return;
    const ed = f.ed;
    const id = nextObjectId(f.t);
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'seq', name: got.name } } } as DocText, 'Insert caption');
    const text = ed.text;
    const p = paraAt(text, ed.focus);
    const r = paraRange(text, p);
    this.captionPlace = got.place === 'above' || got.place === 'below' ? got.place : 'usual';
    const above = got.place === 'above' || (got.place !== 'below' && (got.name === 'Table' || got.name === 'Scheme'));
    const cap = runStyleOf(f.t.styles.Caption);
    const runs = captionRuns(got.name, got.prefix, id, cap);
    const len = runs.reduce((a, x) => a + x.text.length, 0);
    const empty = r.start === r.end;
    if (empty) {
      ed.replace(r.start, r.end, runs, undefined, 'Insert caption');
      ed.update(setParaStyle(f.t, p, p, 'Caption'), 'Insert caption');
      ed.setCaret(r.start + len);
    } else if (above) {
      ed.replace(r.start, r.start, [...runs, { ...cap, text: '\n' }], undefined, 'Insert caption');
      ed.update(setParaStyle(f.t, p, p, 'Caption'), 'Insert caption');
      ed.setCaret(r.start + len);
    } else {
      ed.replace(r.end, r.end, [{ ...cap, text: '\n' }, ...runs], undefined, 'Insert caption');
      ed.update(setParaStyle(f.t, p + 1, p + 1, 'Caption'), 'Insert caption');
      ed.setCaret(r.end + 1 + len);
    }
  }

  /** References > Cross-reference: "Figure 2" in the text, following that caption's number. */
  private async crossReference(): Promise<void> {
    const f = this.file!;
    const shown = fieldTexts(f.t);
    const at = objectOffsets(f.t.runs);
    const text = f.ed.text;
    const isCaption = (id: number) => { const o = f.t.objects[id]; return o?.kind === 'seq' && o.name !== COMPOUND; };
    const caps = [...at.entries()].filter(([id]) => isCaption(id)).sort((a, b) => a[1] - b[1]).map(([id, off]) => {
      const start = text.lastIndexOf('\n', off - 1) + 1;
      const end = text.indexOf('\n', off);
      const words = text.slice(start, end < 0 ? text.length : end).replace(OBJECT_CHAR, shown.get(id) ?? '');
      return { id, label: words.length > 70 ? words.slice(0, 68) + '…' : words };
    });
    if (!caps.length) { this.host.flash('There are no captions to refer to yet: References > Insert Caption adds one.', 6000); return; }
    const got = await ask('Cross-reference', [{ name: 'target', label: 'Refer to', value: String(caps[0].id), options: caps.map((c) => ({ value: String(c.id), label: c.label })) }], {
      ok: 'Insert', note: 'Puts the caption\'s label and number in the text ("Figure 2"). It changes by itself when captions are added, removed or moved.',
    });
    this.focus();
    if (!got || this.file !== f) return;
    this.insertObject({ kind: 'ref', target: Number(got.target) }, 'Insert cross-reference');
  }

  /**
   * References > Compound Number: a new compound's number (the next one, in bold), or another
   * mention of a compound already numbered. Numbers follow the order compounds are first
   * mentioned in, so they change by themselves when text is added or moved.
   */
  private async compoundNumber(): Promise<void> {
    const f = this.file!;
    const shown = fieldTexts(f.t);
    const at = objectOffsets(f.t.runs);
    const text = f.ed.text;
    const ed = f.ed;
    const compounds = [...at.entries()].filter(([id]) => { const o = f.t.objects[id]; return o?.kind === 'seq' && o.name === COMPOUND; })
      .sort((a, b) => a[1] - b[1]);
    // where each is first mentioned, to tell them apart: the words before its number, with the numbers in them
    const idAt = new Map([...at.entries()].map(([id, off]) => [off, id]));
    const options = compounds.map(([id, off]) => {
      const start = Math.max(text.lastIndexOf('\n', off - 1) + 1, off - 40);
      let before = '';
      for (let i = start; i < off; i++) before += text[i] === OBJECT_CHAR ? shown.get(idAt.get(i) ?? -1) ?? '' : text[i];
      before = before.trim();
      return { value: String(id), label: `${shown.get(id)}${before ? `: …${before} ${shown.get(id)}` : ''}` };
    });
    // the number the new compound would get: one more than the compounds before the caret
    const next = compounds.filter(([, off]) => off < ed.start).length + 1;
    const got = await ask('Compound Number', [{
      name: 'which', label: 'Compound', value: 'new',
      options: [{ value: 'new', label: `A new compound (${next})` }, ...options],
    }], {
      ok: 'Insert',
      note: 'Compounds are numbered in the order they are first mentioned, in bold. Choose one already numbered to mention it again: '
        + 'its number follows if the numbers change. Type a letter after a number for a series (2a, 2b).',
    });
    this.focus();
    if (!got || this.file !== f) return;
    const before = ed.typingStyle();
    if (got.which === 'new') this.insertObject({ kind: 'seq', name: COMPOUND }, 'Insert compound number', { bold: true });
    else this.insertObject({ kind: 'ref', target: Number(got.which) }, 'Insert compound number', { bold: true });
    // what is typed next looks as it did before the number
    ed.setStyle({ bold: before.bold });
  }

  // ---------------------------------------------------------------- references

  /** References > Manage References: the document's reference list and citation style. */
  async manageReferences(): Promise<void> {
    if (!this.file) return;
    await this.refs.open();
    this.focus();
  }

  /**
   * References > Insert Citation: the numbers of the references chosen, in superscript, which
   * follow the order references are first cited in. With a citation picked (or double-clicked),
   * changes what it cites.
   */
  private async insertCitation(): Promise<void> {
    const f = this.file!;
    const ed = f.ed;
    const cur = this.pickedField('cite');
    const refs = await chooseReferences(f.t, cur?.o.refs ?? [], async () => {
      await this.refs.open();
      return this.file === f ? f.t : null;
    });
    this.focus();
    if (!refs || this.file !== f) return;
    if (cur && f.t.objects[cur.id]?.kind === 'cite') {
      ed.update({ ...f.t, objects: { ...f.t.objects, [cur.id]: { kind: 'cite', refs } } } as DocText, 'Edit citation');
      ed.setCaret(ed.end);
      return;
    }
    const before = ed.typingStyle();
    this.insertObject({ kind: 'cite', refs }, 'Insert citation', { sup: citeSuper(formatOf(f.t)) || undefined, sub: undefined });
    // what is typed next looks as it did before the citation
    ed.setStyle({ sup: before.sup });
  }

  /**
   * References > Bibliography: a "References" heading and the bibliography after the paragraph
   * the caret is in. It lists the references cited, in citation order, in the citation style,
   * and changes by itself as citations are added, moved or removed.
   */
  private insertBibliography(): void {
    const f = this.file!;
    const ed = f.ed;
    const used = new Set(objectsInText(f.t.runs));
    if (Object.entries(f.t.objects).some(([k, o]) => o.kind === 'bib' && used.has(Number(k)))) {
      this.host.flash('This document has a bibliography already; this adds another (both show the same list).', 6000);
    }
    const id = nextObjectId(f.t);
    const kind = 'Insert bibliography';
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'bib' } } } as DocText, kind);
    const text = ed.text;
    const p = paraAt(text, ed.focus);
    const r = paraRange(text, p);
    const head = runStyleOf(f.t.styles.Heading1 ?? styleOf(f.t, undefined));
    const normal = runStyleOf(styleOf(f.t, undefined));
    const empty = r.start === r.end;
    const runs: TextRun[] = [...(empty ? [] : [{ ...normal, text: '\n' }]), { ...head, text: 'References' }, { ...head, text: '\n' }, objectRun(id, normal)];
    ed.replace(empty ? r.start : r.end, empty ? r.start : r.end, runs, undefined, null);
    const h = empty ? p : p + 1;
    ed.update(setParaStyle(setParaStyle(f.t, h, h, f.t.styles.Heading1 ? 'Heading1' : 'Normal'), h + 1, h + 1, 'Normal'), null);
    const at = objectOffsets(f.t.runs).get(id);
    if (at !== undefined) ed.setCaret(at + 1);
    if (!(f.t.references ?? []).length) this.host.flash('The bibliography lists the references cited. Add references with References > Manage References, and cite them with Insert Citation.', 8000);
  }

  /**
   * References > Table of Contents: the headings and their page numbers, in a paragraph of their
   * own after the one the caret is in, with a Contents heading (in a style the contents leave
   * out). It changes by itself as headings are added, renamed or moved to other pages.
   * Double-click it to choose how many heading levels it shows.
   */
  private async insertToc(): Promise<void> {
    const f = this.file!;
    const levels = await this.askTocLevels(3, 'Insert');
    if (!levels) return;
    const ed = f.ed;
    const id = nextObjectId(f.t);
    const kind = 'Insert table of contents';
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'toc', levels } } } as DocText, kind);
    const text = ed.text;
    const p = paraAt(text, ed.focus);
    const r = paraRange(text, p);
    const head = { ...runStyleOf(f.t.styles.Heading1 ?? styleOf(f.t, undefined)) };
    const normal = runStyleOf(styleOf(f.t, undefined));
    const empty = r.start === r.end;
    const runs: TextRun[] = [...(empty ? [] : [{ ...normal, text: '\n' }]), { ...head, text: 'Contents' }, { ...head, text: '\n' }, objectRun(id, normal)];
    ed.replace(empty ? r.start : r.end, empty ? r.start : r.end, runs, undefined, null);
    const h = empty ? p : p + 1;
    // the Contents heading looks like a heading but is in Normal, so it isn't listed in itself
    let t = setParaStyle(f.t, h, h + 1, 'Normal');
    const hr = paraRange(rt.plainText(t.runs), h);
    t = { ...t, runs: rt.applyStyle(t.runs, hr.start, hr.end, head), paras: t.paras.map((x, i) => (i === h ? { ...x, keepNext: true, spaceBefore: 0, spaceAfter: 8 } : x)) };
    ed.update(t, null);
    const at = objectOffsets(f.t.runs).get(id);
    if (at !== undefined) ed.setCaret(at + 1);
    if (!tocEntries(f.t, levels).length) this.host.flash('The contents list paragraphs in the Heading 1, 2 and 3 styles (Home > Styles). Give your headings those styles and they appear here with their page numbers.', 9000);
  }

  private async askTocLevels(now: number, ok: string): Promise<number | null> {
    const got = await ask('Table of Contents', [
      { name: 'levels', label: 'Show headings down to', value: String(now), options: [{ value: '1', label: 'Heading 1' }, { value: '2', label: 'Heading 2' }, { value: '3', label: 'Heading 3' }] },
    ], { ok, note: 'The contents update by themselves as headings change or move to other pages. In Word, right-click them and choose Update Field after editing there.' });
    return got ? Math.max(1, Math.min(3, Number(got.levels) || 3)) : null;
  }

  /** Double-click on the contents: how many levels they show. */
  private async tocOptions(id: number): Promise<void> {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'toc') return;
    const levels = await this.askTocLevels(o.levels, 'Apply');
    if (!levels || levels === o.levels) return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'toc', levels } } } as DocText, 'Table of contents levels');
  }

  /**
   * References > Insert Table of Figures: the captions of one label (Figure, Scheme, Table,
   * Chart, or all of them) with their page numbers, in a paragraph of its own after the one the
   * caret is in, with a heading. Like the contents it changes by itself; double-click it to
   * choose another label.
   */
  private async insertTof(): Promise<void> {
    const f = this.file!;
    const name = await this.askTofName('Figure', 'Insert');
    if (name === null || this.file !== f) return;
    const ed = f.ed;
    const id = nextObjectId(f.t);
    const kind = 'Insert table of figures';
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'tof', name } } } as DocText, kind);
    const text = ed.text;
    const p = paraAt(text, ed.focus);
    const r = paraRange(text, p);
    const head = { ...runStyleOf(f.t.styles.Heading1 ?? styleOf(f.t, undefined)) };
    const normal = runStyleOf(styleOf(f.t, undefined));
    const empty = r.start === r.end;
    const title = name ? `List of ${name === 'Chart' ? 'Charts' : `${name}s`}` : 'List of Figures, Schemes and Tables';
    const runs: TextRun[] = [...(empty ? [] : [{ ...normal, text: '\n' }]), { ...head, text: title }, { ...head, text: '\n' }, objectRun(id, normal)];
    ed.replace(empty ? r.start : r.end, empty ? r.start : r.end, runs, undefined, null);
    const h = empty ? p : p + 1;
    // the heading looks like a heading but is in Normal, so the contents leave it out
    let t = setParaStyle(f.t, h, h + 1, 'Normal');
    const hr = paraRange(rt.plainText(t.runs), h);
    t = { ...t, runs: rt.applyStyle(t.runs, hr.start, hr.end, head), paras: t.paras.map((x, i) => (i === h ? { ...x, keepNext: true, spaceBefore: 0, spaceAfter: 8 } : x)) };
    ed.update(t, null);
    const at = objectOffsets(f.t.runs).get(id);
    if (at !== undefined) ed.setCaret(at + 1);
    if (!tofEntries(f.t, name).length) this.host.flash(`The table of figures lists the ${name ? `${name} ` : ''}captions made with References > Insert Caption. Add captions and they appear here with their page numbers.`, 9000);
  }

  private async askTofName(now: string, ok: string): Promise<string | null> {
    const got = await ask('Table of Figures', [
      { name: 'name', label: 'Captions listed', value: now, options: TOF_NAMES.map((n) => ({ value: n, label: n ? `${n} captions` : 'All captions (figures, schemes, tables, charts)' })) },
    ], { ok, note: 'It lists each caption with its page number and updates by itself as captions change or move. In Word, right-click it and choose Update Field after editing there.' });
    return got ? got.name : null;
  }

  /** Double-click on a table of figures: the captions it lists. */
  private async tofOptions(id: number): Promise<void> {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'tof') return;
    const name = await this.askTofName(o.name, 'Apply');
    if (name === null || name === o.name || this.file !== f) return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'tof', name } } } as DocText, 'Table of figures captions');
  }

  // ---------------------------------------------------------------- footnotes and endnotes

  /**
   * References > Insert Footnote (Ctrl+Alt+F) or Insert Endnote (Ctrl+Alt+D): the next number in
   * superscript at the caret, and the caret in the note's own text (at the foot of the page, or
   * after the text), as in Word. Escape goes back to the number; deleting the number deletes the note.
   */
  private insertNote(end: boolean): void {
    const f = this.file!;
    if (f.box) {
      this.host.flash(`${end ? 'Endnotes' : 'Footnotes'} go in the document's text: click in the text first (not in a text box, table cell or note).`, 6000);
      return;
    }
    const st = noteStyle(f.t);
    const id = this.insertObject({ kind: 'note', end: end || undefined, runs: [{ ...runStyleOf(st), text: '' }] }, end ? 'Insert endnote' : 'Insert footnote', { sup: true, sub: undefined });
    // what is typed next in the text isn't in superscript
    f.ed.setStyle({ sup: undefined });
    this.startBox(id);
  }

  /** The footnote or endnote whose number is at an offset in the text (or just before it). */
  private noteAt(offset: number): number | null {
    const f = this.file;
    if (!f) return null;
    for (const at of [offset, offset - 1]) {
      const obj = at >= 0 ? rt.sliceRuns(f.t.runs, at, at + 1)[0]?.obj : undefined;
      if (obj !== undefined && f.t.objects[obj]?.kind === 'note') return obj;
    }
    return null;
  }

  /** A footnote made an endnote, or an endnote a footnote. */
  private convertNote(id: number): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'note') return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...o, end: o.end ? undefined : true } } } as DocText, o.end ? 'Convert to footnote' : 'Convert to endnote');
  }

  /**
   * References > Footnote Options (Word's Footnote and Endnote dialog): how footnotes and endnotes
   * are numbered, and turning all of one kind into the other.
   */
  private async noteOptions(): Promise<void> {
    const f = this.file!;
    const FORMATS: NoteFormat[] = ['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter', 'chicago'];
    const options = FORMATS.map((v) => ({ value: v, label: [1, 2, 3].map((n) => noteLabel(n, v)).join(', ') }));
    const notes = Object.values(f.t.objects).filter((o) => o.kind === 'note');
    const feet = notes.filter((o) => o.kind === 'note' && !o.end).length, ends = notes.length - feet;
    const got = await ask('Footnotes and Endnotes', [
      { name: 'foot', label: 'Footnotes numbered', value: f.t.notes?.foot ?? FOOT_FORMAT, options },
      { name: 'end', label: 'Endnotes numbered', value: f.t.notes?.end ?? END_FORMAT, options },
      { name: 'convert', label: 'Convert', value: '', options: [
        { value: '', label: 'Leave them as they are' },
        { value: 'toEnd', label: `All footnotes to endnotes (${feet})` },
        { value: 'toFoot', label: `All endnotes to footnotes (${ends})` },
        { value: 'swap', label: 'Swap footnotes and endnotes' },
      ] },
    ], { ok: 'Apply', note: 'Footnotes sit at the foot of their page, endnotes after the text. Insert them with References > Insert Footnote (Ctrl+Alt+F) or Insert Endnote (Ctrl+Alt+D); delete one by deleting its number in the text.' });
    this.focus();
    if (!got || this.file !== f) return;
    const foot = got.foot as NoteFormat, end = got.end as NoteFormat;
    const objects = { ...f.t.objects };
    for (const [k, o] of Object.entries(objects)) {
      if (o.kind !== 'note') continue;
      const toEnd = got.convert === 'toEnd' ? true : got.convert === 'toFoot' ? false : got.convert === 'swap' ? !o.end : !!o.end;
      if (toEnd !== !!o.end) objects[Number(k)] = { ...o, end: toEnd || undefined };
    }
    const fmts = { ...(foot !== FOOT_FORMAT ? { foot } : {}), ...(end !== END_FORMAT ? { end } : {}) };
    f.ed.update({ ...f.t, objects, notes: Object.keys(fmts).length ? fmts : undefined } as DocText, 'Footnote options');
  }

  // ---------------------------------------------------------------- equations

  /** The equation picked (a selection of just its character), or the one just before the caret. */
  private pickedMath(): number | null {
    const f = this.file;
    if (!f) return null;
    const ed = f.ed;
    const at = ed.end - ed.start === 1 ? ed.start : ed.collapsed ? ed.focus - 1 : -1;
    const id = at >= 0 ? rt.sliceRuns(ed.t.runs, at, at + 1)[0]?.obj : undefined;
    return id !== undefined && f.t.objects[id]?.kind === 'math' ? id : null;
  }

  /**
   * Insert > Equation: typed as LaTeX in the equation window. On a line of its own it gets a
   * centred paragraph of its own (after the one the caret is in, unless that one is empty).
   */
  private async insertEquation(): Promise<void> {
    const f = this.file!;
    const ed = f.ed;
    const style = ed.typingStyle();
    const font = style.font ?? styleOf(f.t, undefined).font;
    const text0 = ed.text;
    const r0 = paraRange(text0, paraAt(text0, ed.focus));
    const got = await askEquation({ tex: '', display: r0.start === r0.end || /[:：]\s*$/.test(text0.slice(r0.start, ed.focus)), font, ok: 'Insert' });
    if (!got) return;
    const id = nextObjectId(f.t);
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'math', tex: got.tex } } } as DocText, 'Insert equation');
    const run = objectRun(id, rt.cleanStyle({ ...style, sub: undefined, sup: undefined }));
    if (!got.display) {
      ed.replace(ed.start, ed.end, [run], undefined, null);
    } else {
      const text = ed.text;
      const p = paraAt(text, ed.focus);
      const r = paraRange(text, p);
      const empty = r.start === r.end;
      const before = f.t.paras[p] ?? {};
      // the text goes on below it in a paragraph like the one before, not centred
      ed.replace(empty ? r.start : r.end, empty ? r.start : r.end, [...(empty ? [] : [{ ...style, text: '\n' }]), run, { ...style, text: '\n' }], undefined, null);
      const h = empty ? p : p + 1;
      ed.setParas(h, h, { align: 'center', list: undefined, level: undefined, firstLine: undefined }, null);
      ed.setParas(h + 1, h + 1, { align: undefined, list: undefined, level: undefined, ...before, pageBreak: undefined, colBreak: undefined }, null);
      const at = objectOffsets(f.t.runs).get(id);
      if (at !== undefined) ed.setCaret(at + 2);
      return;
    }
    const at = objectOffsets(f.t.runs).get(id);
    if (at !== undefined) ed.setCaret(at + 1);
  }

  /** Change an equation (double-click it). Emptying it leaves it as it was; delete it like a letter. */
  private async editEquation(id: number): Promise<void> {
    const f = this.file!;
    const o = f.t.objects[id];
    if (o?.kind !== 'math') return;
    const run = f.t.runs.find((r) => r.obj === id);
    const got = await askEquation({ tex: o.tex, font: run?.font ?? styleOf(f.t, undefined).font, ok: 'Apply' });
    if (!got || got.tex === o.tex) return;
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'math', tex: got.tex } } } as DocText, 'Change equation');
  }

  // ---------------------------------------------------------------- tracked changes

  /** Review > Track Changes: on or off for this document (the first time, ask for the name to put on changes). */
  private async toggleTracking(): Promise<void> {
    const f = this.file!;
    if (!f.t.track && !reviewAuthor() && !(await this.askReviewName())) return;
    const on = !f.t.track;
    f.ed.update({ ...f.t, track: on || undefined } as DocText, on ? 'Track changes on' : 'Track changes off');
    this.host.flash(on ? `Tracking changes as ${reviewAuthor()}: what you type is underlined and what you delete is struck through, until accepted or rejected (Review tab).` : 'Changes are no longer tracked. Changes already marked stay until accepted or rejected.', 7000);
  }

  /** The name put on your changes (kept in your settings). */
  async askReviewName(): Promise<boolean> {
    const got = await ask('Your Name', [{ name: 'name', label: 'Name shown on your changes', value: reviewAuthor() }], { ok: 'Save', note: 'Word shows this name on your changes too. Change it any time here or in Edit > Settings.' });
    if (!got || !got.name.trim()) return false;
    setReviewAuthor(got.name);
    this.host.reviewNameChanged?.();
    return true;
  }

  /** Accept or reject the changes in the selection, or the one at the caret, then go to the next. */
  private decideChange(accept: boolean): void {
    const f = this.file!;
    // in a text box or table cell being typed in, its own changes
    const ed = f.textEd;
    const all = changesIn(ed.t.runs);
    let start = ed.start, end = ed.end;
    if (start === end) {
      const c = all.find((x) => x.start <= start && start < x.end) ?? all.find((x) => x.start === start || x.end === start);
      if (!c) { this.goToChange(true); return; }
      start = c.start; end = c.end;
    }
    if (!all.some((x) => x.start < end && x.end > start)) { this.goToChange(true); return; }
    // the caret stays where the change was; what follows moved up by what was taken away
    ed.update(decide(ed.t, accept, start, end), accept ? 'Accept change' : 'Reject change', start, start);
    this.goToChange(true, start);
  }

  private decideAll(accept: boolean): void {
    const f = this.file!;
    const n = countChanges(f.t);
    if (!n) { this.host.flash('There are no tracked changes in this document.'); return; }
    // text boxes and table cells too, so stop typing in one first (its text is about to change)
    if (f.box) this.stopBox();
    f.ed.update(decideEverywhere(f.t, accept), accept ? 'Accept all changes' : 'Reject all changes', f.ed.start, f.ed.start);
    this.host.flash(`${accept ? 'Accepted' : 'Rejected'} ${n} change${n === 1 ? '' : 's'}.`);
  }

  /** Select the next (or previous) change after the caret, starting again from the top at the end. */
  private goToChange(forward: boolean, from?: number): void {
    const f = this.file!;
    const ed = f.textEd;
    const all = changesIn(ed.t.runs);
    if (!all.length) { this.host.flash(f.box ? 'There are no tracked changes here. Click outside to see the rest of the document.' : countChanges(f.t) ? 'The other tracked changes are in text boxes or table cells: click into one to go through them.' : 'There are no tracked changes in this document.'); return; }
    const at = from ?? (forward ? ed.end : ed.start);
    const c = forward ? all.find((x) => x.start >= at) ?? all[0] : [...all].reverse().find((x) => x.end <= at) ?? all[all.length - 1];
    ed.select(c.start, c.end);
    this.revealCaret();
    const when = c.date ? new Date(c.date) : null;
    this.host.flash(`${c.kind === 'ins' ? 'Inserted' : 'Deleted'} by ${c.author || 'unknown'}${when && !isNaN(+when) ? `, ${when.toLocaleString()}` : ''}.`, 5000);
  }

  // ---------------------------------------------------------------- the ribbon

  private wireRibbon(): void {
    const r = this.ribbon;
    // tabs: Home, Insert, Layout, References
    for (const b of r.querySelectorAll<HTMLButtonElement>('[data-doc-tab]')) {
      b.addEventListener('click', () => {
        for (const x of r.querySelectorAll<HTMLButtonElement>('[data-doc-tab]')) x.setAttribute('aria-selected', String(x === b));
        for (const p of r.querySelectorAll<HTMLElement>('[data-doc-panel]')) p.hidden = p.dataset.docPanel !== b.dataset.docTab;
        this.focus();
      });
    }
    r.addEventListener('mousedown', (e) => {
      // buttons keep the caret where it is
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    r.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-doc]');
      if (!b) return;
      const cmd = b.dataset.doc!;
      const box = /^box-(para|style|page|hf)$/.exec(cmd);
      if (box) { this.panel.open(box[1] as DocBoxKey, b); return; }
      if (!this.run(cmd)) this.host.command(cmd);
    });
    // selects that run a command: margins, paper, orientation, page numbers
    for (const sel of r.querySelectorAll<HTMLSelectElement>('select[data-doc-prefix]')) {
      sel.addEventListener('change', () => { const v = sel.value; this.run(`${sel.dataset.docPrefix}-${v}`); if (v !== 'custom' && v !== 'more') this.focus(); });
    }
    // Outlining: the paragraph's level, the levels shown, and how body text shows
    const level = r.querySelector<HTMLSelectElement>('#doc-outline-level')!;
    level.addEventListener('change', () => { this.setOutlineLevel(Number(level.value)); this.focus(); });
    const show = r.querySelector<HTMLSelectElement>('#doc-outline-show')!;
    show.addEventListener('change', () => { this.run(show.value === '0' ? 'outline-all' : `outline-level-${show.value}`); this.focus(); });
    r.querySelector<HTMLInputElement>('#doc-outline-format')!.addEventListener('change', () => { this.run('outline-format'); this.focus(); });
    r.querySelector<HTMLInputElement>('#doc-outline-first')!.addEventListener('change', () => { this.run('outline-first'); this.focus(); });
    // zoom and the views, under the pages; turning the pages in Read Mode
    for (const b of document.querySelectorAll<HTMLButtonElement>('#doc-statusbar [data-doc], #doc-readbar [data-doc]')) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.run(b.dataset.doc!));
    }
    const font = r.querySelector<HTMLInputElement>('#doc-font')!;
    const size = r.querySelector<HTMLInputElement>('#doc-size')!;
    const colour = r.querySelector<HTMLInputElement>('#doc-colour')!;
    const go = (el: HTMLInputElement, f: () => void) => {
      el.addEventListener('change', () => { f(); this.focus(); });
      el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); f(); this.focus(); }
        if (e.key === 'Escape') { e.preventDefault(); this.focus(); }
      });
    };
    go(font, () => { if (font.value.trim() && this.file) this.ed.setStyle({ font: font.value.trim() }); });
    go(size, () => { const v = Number(size.value); if (v > 0 && v <= 1638 && this.file) this.ed.setStyle({ size: v }); });
    colour.addEventListener('change', () => { if (this.file) this.ed.setStyle({ color: colour.value.toLowerCase() === '#000000' ? undefined : colour.value }); this.focus(); });
    // Layout > Paragraph: indents (inches) and spacing (points); any unit can be typed
    const para = (id: string, unit: 'in' | 'pt', patch: (n: number) => Partial<ParaStyle>) => {
      const el = r.querySelector<HTMLInputElement>(id)!;
      go(el, () => { const n = parseLength(el.value, unit); if (n !== null && this.file) this.ed.setSelectedParas(patch(Math.max(0, n)), unit === 'in' ? 'indent' : 'spacing'); });
    };
    para('#doc-ind-left', 'in', (n) => ({ indent: n || undefined }));
    para('#doc-ind-right', 'in', (n) => ({ indentRight: n || undefined }));
    para('#doc-sp-before', 'pt', (n) => ({ spaceBefore: n }));
    para('#doc-sp-after', 'pt', (n) => ({ spaceAfter: n }));
    // the Table tab: heading rows, shading and column width
    const head = r.querySelector<HTMLInputElement>('#doc-tbl-head')!;
    go(head, () => {
      const tg = this.tableTarget();
      const n = Math.round(Number(head.value));
      if (tg && Number.isFinite(n)) this.setTable(tg.id, { ...tg.t, head: Math.max(0, Math.min(tg.t.rows.length, n)) }, 'Heading rows');
    });
    const shade = r.querySelector<HTMLInputElement>('#doc-tbl-shade')!;
    shade.addEventListener('change', () => { this.shade(shade.value.toLowerCase() === '#ffffff' ? undefined : shade.value); this.focus(); });
    const width = r.querySelector<HTMLInputElement>('#doc-tbl-width')!;
    go(width, () => { const n = parseLength(width.value, 'in'); if (n !== null) this.setColumnWidthOf(n); });
    const lineSel = r.querySelector<HTMLSelectElement>('#doc-line')!;
    lineSel.addEventListener('change', () => {
      if (lineSel.value === 'more') { this.panel.open('para', lineSel, 'p-rule'); this.updateRibbon(); return; }
      const v = Number(lineSel.value);
      if (this.file && v > 0) this.ed.setSelectedParas({ line: Math.abs(v - 1) < 1e-6 ? undefined : v, linePt: undefined, lineRule: undefined }, 'spacing');
      this.focus();
    });
  }

  private showZoom(): void {
    const zoom = document.querySelector<HTMLElement>('#doc-zoom');
    const z = `${Math.round((this.view.zoom / ACTUAL) * 100)}%`;
    if (zoom && zoom.textContent !== z) zoom.textContent = z;
  }

  private updateRibbon(): void {
    const f = this.file;
    if (!f) return;
    const ed = f.textEd;
    const s = ed.currentStyle();
    const para = ed.currentPara();
    const st = f.box ? styleOf(f.t, {}) : styleOf(f.t, para);
    const press = (cmd: string, on: boolean) => {
      for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>(`[data-doc="${cmd}"]`)) b.setAttribute('aria-pressed', String(on));
    };
    press('doc-bold', !!s.bold);
    press('doc-italic', !!s.italic);
    press('doc-underline', !!s.underline);
    press('doc-sub', !!s.sub);
    press('doc-sup', !!s.sup);
    press('doc-formula', !!s.formula);
    press('doc-highlight', !!s.highlight);
    const align = para.align ?? 'left';
    press('doc-align-left', align === 'left');
    press('doc-align-center', align === 'center');
    press('doc-align-right', align === 'right');
    press('doc-justify', align === 'justify');
    press('doc-bullets', para.list === 'bullet');
    press('doc-numbering', para.list === 'number');
    const ids: Record<string, string> = { Normal: 'style-normal', Title: 'style-title', Heading1: 'style-h1', Heading2: 'style-h2', Heading3: 'style-h3', Caption: 'style-caption' };
    for (const [id, cmd] of Object.entries(ids)) press(cmd, st.id === id);
    const active = document.activeElement;
    const font = this.ribbon.querySelector<HTMLInputElement>('#doc-font')!;
    const size = this.ribbon.querySelector<HTMLInputElement>('#doc-size')!;
    const colour = this.ribbon.querySelector<HTMLInputElement>('#doc-colour')!;
    const lineSel = this.ribbon.querySelector<HTMLSelectElement>('#doc-line')!;
    if (active !== font) font.value = s.font ?? '';
    if (active !== size) size.value = s.size !== undefined ? String(Math.round(s.size * 100) / 100) : '';
    if (active !== colour) colour.value = s.color ?? '#000000';
    if (active !== lineSel) {
      const v = para.linePt ? '' : String(para.line ?? 1);
      lineSel.value = [...lineSel.options].some((o) => o.value === v) ? v : '';
    }
    // Layout > Paragraph: indents and spacing
    for (const [id, v] of [['#doc-ind-left', para.indent ?? 0, 'in'], ['#doc-ind-right', para.indentRight ?? 0, 'in'], ['#doc-sp-before', para.spaceBefore ?? 0, 'pt'], ['#doc-sp-after', para.spaceAfter ?? 0, 'pt']] as const) {
      const el = this.ribbon.querySelector<HTMLInputElement>(id);
      if (el && el !== active) el.value = showLength(v, id.includes('ind') ? 'in' : 'pt');
    }
    const pick = (id: string, v: string) => {
      const el = this.ribbon.querySelector<HTMLSelectElement>(id);
      if (el && el !== active) el.value = [...el.options].some((o) => o.value === v) ? v : 'other';
    };
    const sec = this.section();
    const pg = sec.page;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const margins = Object.entries({ normal: [1, 1], narrow: [0.5, 0.5], moderate: [1, 0.75], wide: [1, 2] })
      .find(([, [tb, lr]]) => near(pg.top, tb * INCH) && near(pg.bottom, tb * INCH) && near(pg.left, lr * INCH) && near(pg.right, lr * INCH));
    pick('#doc-margins', margins?.[0] ?? 'other');
    const short = Math.min(pg.w, pg.h), long = Math.max(pg.w, pg.h);
    pick('#doc-paper', near(short, LETTER.w) && near(long, LETTER.h) ? 'letter' : near(short, A4.w) && near(long, A4.h) ? 'a4' : 'other');
    pick('#doc-orient', pg.w > pg.h ? 'landscape' : 'portrait');
    pick('#doc-numbers', sec.hf.numbers);
    pick('#doc-columns', String(pg.cols ?? 1));
    press('numbers-s', sec.hf.prefix === 'S');
    const breaks = this.ribbon.querySelector<HTMLSelectElement>('#doc-breaks');
    if (breaks && breaks !== active) breaks.value = '';
    pick('#doc-linenums', sec.lines?.restart ?? 'none');
    press('track-changes', !!f.t.track);
    press('show-comments', this.comments.shown);
    const fig = this.pickedObject() ?? f.box?.id ?? null;
    const wrapSel = this.ribbon.querySelector<HTMLSelectElement>('#doc-wrap');
    if (wrapSel) {
      wrapSel.disabled = fig === null;
      pick('#doc-wrap', fig === null ? 'inline' : floatOf(f.t.objects[fig])?.wrap ?? 'inline');
      const inl = wrapSel.querySelector<HTMLOptionElement>('option[value="inline"]');
      if (inl) inl.disabled = fig !== null && f.t.objects[fig]?.kind === 'textbox';
    }
    // the Table tab shows while the caret is in a table (or a table is picked)
    const tg = this.tableTarget();
    const tabBtn = this.ribbon.querySelector<HTMLButtonElement>('[data-doc-tab="table"]');
    if (tabBtn) {
      tabBtn.hidden = !tg && !this.keepTableTab;
      if (!tg && !this.keepTableTab && tabBtn.getAttribute('aria-selected') === 'true') this.ribbon.querySelector<HTMLButtonElement>('[data-doc-tab="home"]')?.click();
    }
    if (tg) {
      pick('#doc-tbl-lines', tg.t.lines);
      const head = this.ribbon.querySelector<HTMLInputElement>('#doc-tbl-head');
      if (head && head !== active) head.value = String(tg.t.head);
      const w = this.ribbon.querySelector<HTMLInputElement>('#doc-tbl-width');
      if (w && w !== active) w.value = showLength(f.box?.cell ? tg.t.cols[tg.c] : tg.t.cols[0], 'in');
      const shade = this.ribbon.querySelector<HTMLInputElement>('#doc-tbl-shade');
      if (shade && shade !== active) shade.value = tg.t.rows[tg.r]?.[tg.c]?.fill ?? '#ffffff';
      const al = tg.t.rows[tg.r]?.[tg.c]?.align ?? tg.t.align?.[tg.c] ?? 'left';
      for (const a of ['left', 'center', 'right']) press(`table-align-${a}`, al === a);
      const v = tg.t.rows[tg.r]?.[tg.c]?.valign ?? 'top';
      for (const a of ['top', 'center', 'bottom']) press(`table-valign-${a}`, v === a);
    }
    this.showZoom();
    const status = document.querySelector<HTMLElement>('#doc-status');
    if (status) {
      const lay = f.layout();
      const c = f.ed.caret();
      const page = lay.pages.findIndex((p) => c.line >= p.first && c.line < p.end);
      const words = f.ed.text.split(/[\s￼]+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length;
      const wordCount = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
      // the views without pages have no page numbers to show
      const where = lay.pages.some((p) => p.section > 0) ? `  ·  Section ${(lay.pages[page]?.section ?? 0) + 1}` : '';
      status.textContent = continuous(f.view.kind) ? `${VIEW_LABEL[f.view.kind]}  ·  ${wordCount}` : `Page ${page + 1} of ${lay.pages.length}${where}  ·  ${wordCount}`;
    }
  }
}

/** Our own copy of document text: its runs, paragraphs, figures and fields, and the references its citations cite. */
interface OwnCopy { runs: TextRun[]; paras: ParaStyle[]; objects: Record<number, DocObject>; references?: Reference[] }

/** How each character of some runs looks (its position, formula style worked out, and italics). */
function runLooks(runs: TextRun[]): CharLook[] {
  const looks: CharLook[] = [];
  for (const r of runs) {
    const italic = !!r.italic;
    if (r.sub || r.sup) for (let i = 0; i < r.text.length; i++) looks.push({ pos: r.sub ? 'sub' : 'sup', italic });
    else if (r.formula) for (const p of rt.formulaParts(r.text)) for (let i = 0; i < p.text.length; i++) looks.push({ pos: p.pos, italic });
    else for (let i = 0; i < r.text.length; i++) looks.push({ pos: 'base', italic });
  }
  return looks;
}

/** How many rows a cell reaches down (always one: cells join across, not down). */
/** A table with each cell changed by a function. */
function mapCells(t: TableData, f: (cell: TableData['rows'][number][number], r: number, c: number) => TableData['rows'][number][number]): TableData {
  return { ...t, rows: t.rows.map((row, r) => row.map((cell, c) => f(cell, r, c))) };
}

/**
 * Columns as wide as their widest cell (text unwrapped, structures at their own size), the
 * table no wider than the text: Word's AutoFit to Contents.
 */
export function fitDocColumns(t: TableData, f: DocFile, textW: number): TableData {
  const cols = t.cols.map((_, c) => {
    let w = 18;
    t.rows.forEach((row, r) => {
      if (!row[c] || isCovered(t, r, c) || spanOf(t, r, c) > 1) return;
      w = Math.max(w, f.layouter.naturalWidth(f.t, row[c].runs, row[c].paras));
    });
    return Math.ceil(w);
  });
  const total = cols.reduce((a, b) => a + b, 0);
  return { ...t, cols: total > textW ? cols.map((w) => (w * textW) / total) : cols };
}
