// An open document: its text with the editing (caret, selection, Undo) and its layout on pages.
// The workspace keeps one for each document tab, so switching tabs keeps each document's
// Undo history and place.

import type { Measure, TextFrame } from '../text/layout';
import { TextEditing, type ChangeKind } from '../text/editing';
import { documentMeasure } from '../text/font-measure';
import { CELL_PAD, DocLayouter, movedLayout, pageNumber, type DocLayout } from './doc-layout';
import { reviewAuthor, revisionDate } from './revisions';
import { setPart } from '../table';
import { FigurePictures } from './figures';
import { BOX_PAD, newDocument, runStyleOf, styleOf, type DocText } from './document';
import { storedParas } from '../text/paragraphs';

let screenMeasure: Measure = (t, s) => t.length * s * 0.5;

/** How fonts without published widths are measured (the app sets this to the screen's fonts). */
export function setScreenMeasure(m: Measure): void {
  screenMeasure = m;
}

/** Text widths for documents: published widths for Times New Roman, Arial and Courier New, the screen's for other fonts. */
export const docMeasure: Measure = documentMeasure((t, s, f, st) => screenMeasure(t, s, f, st));

/** Pictures of every document's drawings (shared, so a drawing pasted into two documents is drawn once). */
export const figures = new FigurePictures();

/** Indent added by Tab outside a list, as Word's Increase Indent (half an inch). */
const INDENT = 36;

/** Each paragraph's page number as last laid out, by document (for the contents' page numbers in Word files). */
export const paragraphPages = new WeakMap<DocText, string[]>();

export class DocFile {
  readonly ed: TextEditing;
  readonly layouter: DocLayouter;
  /** Changes made (for the unsaved mark). */
  edits = 0;
  /** Called after every change to the text or the selection. */
  listener: (kind: ChangeKind) => void = () => {};
  private memo: { frame: TextFrame; lay: DocLayout } | null = null;
  /**
   * The text box or table cell being typed into, if any: its own editing, whose changes go back
   * into the document.
   */
  box: { id: number; cell?: { r: number; c: number }; ed: TextEditing; recorded: boolean } | null = null;

  constructor(t: DocText = newDocument()) {
    this.layouter = new DocLayouter({ measure: docMeasure, drawingSize: (c, s) => figures.size(c, s) });
    this.ed = new TextEditing(t, runStyleOf(styleOf(t, t.paras[0])), docMeasure, t.styles.Normal?.size ?? 11);
    this.ed.anchor = this.ed.focus = 0;
    this.ed.layoutWith = (frame) => this.layoutOf(frame).text;
    this.ed.emptyParaStyle = (p) => runStyleOf(styleOf(this.t, this.t.paras[p]));
    // Review > Track Changes: edits to the text are marked with who made them and when
    this.ed.track = () => (this.t.track ? { author: reviewAuthor() || 'Author', date: revisionDate() } : null);
    this.ed.indentStep = INDENT;
    this.ed.onChange = (kind) => {
      if (kind === 'text') this.edits++;
      this.listener(kind);
    };
  }

  /** Where typing and the text buttons go: the text box being typed into, or the document. */
  get textEd(): TextEditing {
    return this.box?.ed ?? this.ed;
  }

  /**
   * Start typing into a text box. Its text is edited on its own (its caret and selection, laid
   * out where the box is on its page), and each change goes back into the document, all of
   * one session as one step of the document's Undo.
   */
  editBox(id: number): TextEditing | null {
    const o = this.t.objects[id];
    if (o?.kind !== 'textbox') return null;
    if (this.box?.id === id) return this.box.ed;
    const N = styleOf(this.t, {});
    const ed = new TextEditing({ runs: o.runs, paras: o.paras ?? [], justify: 'left', wrap: o.w - 2 * BOX_PAD.x }, runStyleOf(N), docMeasure, N.size);
    ed.anchor = ed.focus = ed.text.length;
    ed.layoutWith = (frame) => {
      const cur = this.t.objects[id];
      const lay = this.layouter.boxText(this.t, frame.runs, frame.paras, cur?.kind === 'textbox' ? cur.w : o.w);
      const at = this.layout().objects.find((x) => x.id === id);
      return at ? movedLayout(lay, at.x + BOX_PAD.x, at.y + BOX_PAD.y - lay.box.y1) : lay;
    };
    // tracked like the document's own text
    ed.track = this.ed.track;
    const box = { id, ed, recorded: false };
    ed.onChange = (kind) => {
      if (kind === 'text') {
        const cur = this.t.objects[id];
        if (cur?.kind === 'textbox') {
          this.ed.update({ ...this.t, objects: { ...this.t.objects, [id]: { ...cur, runs: ed.t.runs, paras: storedParas(ed.t.paras) } } } as DocText, box.recorded ? null : 'Edit text box');
          box.recorded = true;
        }
        ed.relayout();
      }
      this.listener(kind);
    };
    this.box = box;
    return ed;
  }

  /**
   * Start typing into a cell of a table in the text, as editBox does for a text box: the cell's
   * text laid out where the cell is, every change going back into the table.
   */
  editCell(id: number, r: number, c: number): TextEditing | null {
    const o = this.t.objects[id];
    if (o?.kind !== 'table') return null;
    const cell = o.table.rows[r]?.[c];
    if (!cell) return null;
    if (this.box?.id === id && this.box.cell?.r === r && this.box.cell.c === c) return this.box.ed;
    const N = styleOf(this.t, {});
    const ed = new TextEditing({ runs: cell.runs, paras: cell.paras ?? [], justify: 'left', wrap: 100 }, runStyleOf(N), docMeasure, N.size);
    ed.anchor = ed.focus = ed.text.length;
    ed.layoutWith = (frame) => {
      const cur = this.t.objects[id];
      const lay = this.layout();
      const tb = lay.tables.get(id);
      const tab = cur?.kind === 'table' ? cur.table : o.table;
      const cl = this.layouter.cellNow(tab, r, c, frame.runs, frame.paras) ?? tb?.cells[r]?.[c];
      const at = tb?.rows[r];
      if (!cl) return this.layouter.boxText(this.t, frame.runs, frame.paras, 100);
      return at && tb ? movedLayout(cl, at.x + tb.xs[c] + CELL_PAD.x, at.y + CELL_PAD.y + (tb.drop[r]?.[c] ?? 0) - cl.box.y1) : cl;
    };
    // tracked like the document's own text
    ed.track = this.ed.track;
    const box = { id, cell: { r, c }, ed, recorded: false };
    ed.onChange = (kind) => {
      if (kind === 'text') {
        const cur = this.t.objects[id];
        if (cur?.kind === 'table' && cur.table.rows[r]?.[c]) {
          const table = setPart(cur.table, { r, c }, { runs: ed.t.runs, paras: storedParas(ed.t.paras) });
          this.ed.update({ ...this.t, objects: { ...this.t.objects, [id]: { ...cur, table } } } as DocText, box.recorded ? null : 'Edit table');
          box.recorded = true;
        }
        ed.relayout();
      }
      this.listener(kind);
    };
    this.box = box;
    return ed;
  }

  /** Stop typing into the text box. */
  endBox(): void {
    this.box = null;
  }

  get t(): DocText {
    return this.ed.t as DocText;
  }

  /** The pages as they are now (with any text an input method is putting together). */
  layout(): DocLayout {
    this.ed.layout();
    return this.memo!.lay;
  }

  /** Lay out again from scratch (fonts finished loading). */
  relayout(): void {
    this.layouter.clear();
    this.memo = null;
    this.ed.relayout();
  }

  private layoutOf(frame: TextFrame): DocLayout {
    if (this.memo?.frame !== frame) {
      const lay = this.layouter.layout(frame as DocText);
      this.memo = { frame, lay };
      paragraphPages.set(frame as DocText, lay.paraTops.map((pt) => pageNumber((frame as DocText).hf, pt.page)));
    }
    return this.memo.lay;
  }
}
