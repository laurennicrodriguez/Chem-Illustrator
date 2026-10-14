// An open document: its text with the editing (caret, selection, Undo) and its layout on pages.
// The workspace keeps one for each document tab, so switching tabs keeps each document's
// Undo history and place.

import type { Measure, TextFrame } from '../text/layout';
import { TextEditing, type ChangeKind } from '../text/editing';
import { documentMeasure } from '../text/font-measure';
import { DocLayouter, movedLayout, type DocLayout } from './doc-layout';
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

export class DocFile {
  readonly ed: TextEditing;
  readonly layouter: DocLayouter;
  /** Changes made (for the unsaved mark). */
  edits = 0;
  /** Called after every change to the text or the selection. */
  listener: (kind: ChangeKind) => void = () => {};
  private memo: { frame: TextFrame; lay: DocLayout } | null = null;
  /** The text box being typed into, if any: its own editing, whose changes go back into the document. */
  box: { id: number; ed: TextEditing; recorded: boolean } | null = null;

  constructor(t: DocText = newDocument()) {
    this.layouter = new DocLayouter({ measure: docMeasure, drawingSize: (c, s) => figures.size(c, s) });
    this.ed = new TextEditing(t, runStyleOf(styleOf(t, t.paras[0])), docMeasure, t.styles.Normal?.size ?? 11);
    this.ed.anchor = this.ed.focus = 0;
    this.ed.layoutWith = (frame) => this.layoutOf(frame).text;
    this.ed.emptyParaStyle = (p) => runStyleOf(styleOf(this.t, this.t.paras[p]));
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
    if (this.memo?.frame !== frame) this.memo = { frame, lay: this.layouter.layout(frame as DocText) };
    return this.memo.lay;
  }
}
