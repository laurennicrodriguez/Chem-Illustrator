// An open document: its text with the editing (caret, selection, Undo) and its layout on pages.
// The workspace keeps one for each document tab, so switching tabs keeps each document's
// Undo history and place.

import type { Measure, TextFrame } from '../text/layout';
import { TextEditing, type ChangeKind } from '../text/editing';
import { documentMeasure } from '../text/font-measure';
import { DocLayouter, type DocLayout } from './doc-layout';
import { FigurePictures } from './figures';
import { newDocument, runStyleOf, styleOf, type DocText } from './document';

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
