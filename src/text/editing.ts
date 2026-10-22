// Editing styled text: the caret, the selection, and every change typing, the keys and the
// buttons make. It knows nothing about the screen, so the caption editor, and later slides
// and documents, all edit text the same way, and every rule here can be tested on its own.
//
// Offsets count characters of the plain text, with each line break (between paragraphs)
// counting as one. `anchor` is where a selection started and `focus` where it ends (the caret).

import type { Justify, ParaStyle, TextRun } from '../model';
import type { Rect } from '../geom';
import * as rt from '../richtext';
import { caretPos, layoutText, lineOf, offsetAt, offsetInLine, selectionRects, wordAt, type Measure, type TextFrame, type TextLayout } from './layout';
import { cleanPara, editParas, fitParas, paraAt, paraCount, paraRange, storedParas } from './paragraphs';
import type { CharLook, FixEdit } from './chemtext';
import { trackedReplace } from '../document/revisions';

/** A styled text with its paragraph formatting: what a caption, a text box or a slide holds. */
export interface RichText {
  runs: TextRun[];
  /** One per paragraph. */
  paras: ParaStyle[];
  justify: Justify;
  wrap?: number;
  width?: number;
  lineHeight?: number;
  lineSpacing?: number;
}

/** Indent added by each press of Tab in a paragraph that isn't in a list (points). */
export const INDENT_STEP = 18;
const MAX_LEVEL = 8;

interface Snap { t: RichText; anchor: number; focus: number }

export type Move = 'left' | 'right' | 'wordLeft' | 'wordRight' | 'up' | 'down' | 'lineStart' | 'lineEnd' | 'textStart' | 'textEnd';

/** What changed, for whoever is listening (the screen redraws, the bar updates). */
export type ChangeKind = 'text' | 'selection';

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_'’]/u.test(ch);
const isLow = (ch: string | undefined) => !!ch && ch.charCodeAt(0) >= 0xdc00 && ch.charCodeAt(0) <= 0xdfff;

export class TextEditing {
  t: RichText;
  anchor = 0;
  focus = 0;
  /** A style picked with nothing selected: it applies to what is typed next. */
  pending: Partial<rt.RunStyle> | null = null;
  /** Text being put together by an input method (Chinese, Japanese, accents): shown, not yet typed. */
  composing: string | null = null;
  /** Called after every change. */
  onChange: (kind: ChangeKind) => void = () => {};
  /** Called after text is typed (chemistry formatting hooks in here). */
  onTyped: (typed: string) => void = () => {};
  /** The clock, for joining a burst of typing into one undo step (replaceable in tests). */
  now: () => number = () => performance.now();
  /** Lays the text out in place of layoutText (a document lays it out on pages). */
  layoutWith: ((frame: TextFrame) => TextLayout) | null = null;
  /** The look typing takes in an empty paragraph (a document's: that of the paragraph's style). */
  emptyParaStyle: ((para: number) => rt.RunStyle) | null = null;
  /** Indent added by Tab outside a list, in points. */
  indentStep = INDENT_STEP;
  /**
   * Tracked changes (documents): while set, typing, pasting and deleting mark the text as
   * inserted or deleted by this person instead of changing it outright (see document/revisions).
   */
  track: (() => { author: string; date: string } | null) | null = null;
  /** How much of the last tracked deletion stayed in place, struck through. */
  private keptLast = 0;

  private goalX: number | null = null;
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  private lastKind = { kind: '', time: 0, at: -1 };
  private lay: TextLayout | null = null;

  constructor(initial: Partial<RichText> & { runs: TextRun[] }, public defaults: rt.RunStyle, public measure: Measure, public defaultSize: number) {
    const runs = rt.normalizeRuns(initial.runs.map((r) => ({ ...r })));
    this.t = {
      ...initial,
      runs,
      paras: fitParas(initial.paras, paraCount(rt.plainText(runs))),
      justify: initial.justify ?? 'left',
    };
    this.anchor = this.focus = this.text.length;
  }

  // ------------------------------------------------------------------ reading

  get text(): string {
    // asked for many times per key press, and the text only changes with a new `t`
    if (this.textCache?.t !== this.t) this.textCache = { t: this.t, text: rt.plainText(this.t.runs) };
    return this.textCache.text;
  }
  private textCache: { t: RichText; text: string } | null = null;
  get start(): number { return Math.min(this.anchor, this.focus); }
  get end(): number { return Math.max(this.anchor, this.focus); }
  get collapsed(): boolean { return this.anchor === this.focus; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** The text as it is to be stored (paragraph styles only when some paragraph has one). */
  result(): Omit<RichText, 'paras'> & { paras?: ParaStyle[] } {
    return { ...this.t, runs: rt.normalizeRuns(this.t.runs), paras: storedParas(fitParas(this.t.paras, paraCount(this.text))) };
  }

  /** What is laid out and drawn: the text, with any input-method text shown at the caret. */
  frame(): TextFrame {
    if (this.composing === null || !this.composing) return this.t;
    const style = { ...this.typingStyle(), underline: true };
    const runs = rt.replaceRange(this.t.runs, this.focus, this.focus, [{ ...style, text: this.composing }]);
    return { ...this.t, runs, paras: editParas(this.t.paras, this.text, this.focus, this.focus, this.composing) };
  }

  layout(): TextLayout {
    this.lay ??= this.layoutWith ? this.layoutWith(this.frame()) : layoutText(this.frame(), this.defaultSize, this.measure);
    return this.lay;
  }

  /** Lay the text out again next time (something the layout depends on changed, such as the page size). */
  relayout(): void {
    this.lay = null;
  }

  /** The caret: x, top and bottom of its line, relative to the text's origin. */
  caret(): { x: number; y1: number; y2: number; line: number } {
    const lay = this.layout();
    const at = this.focus + (this.composing?.length ?? 0);
    const c = caretPos(lay, at);
    const l = lay.lines[c.line];
    return { x: c.x, y1: l.y - l.ascent, y2: l.y + l.descent, line: c.line };
  }

  /** Rectangles covering the selection, relative to the text's origin. */
  selectionRects(): Rect[] {
    return this.collapsed || this.composing ? [] : selectionRects(this.layout(), this.start, this.end);
  }

  /** The style new typing takes. */
  typingStyle(): rt.RunStyle {
    if (this.emptyParaStyle && this.collapsed) {
      const text = this.text;
      const p = paraAt(text, this.focus);
      const r = paraRange(text, p);
      if (r.start === r.end) return rt.cleanStyle({ ...this.emptyParaStyle(p), ...this.pending });
    }
    return rt.cleanStyle({ ...rt.typingStyle(this.t.runs, this.start, this.end, this.defaults), ...this.pending });
  }

  /** The style shown on the bar: what the selection has in common, or what typing will use. */
  currentStyle(): rt.RunStyle {
    return this.collapsed ? this.typingStyle() : rt.commonStyle(this.t.runs, this.start, this.end);
  }

  /** First and last paragraph the selection touches. */
  selectedParas(): [number, number] {
    const text = this.text;
    return [paraAt(text, this.start), paraAt(text, this.end)];
  }

  /** The style of the paragraph the caret is in. */
  currentPara(): ParaStyle {
    return this.t.paras[paraAt(this.text, this.focus)] ?? {};
  }

  /** How the caret's paragraph is lined up. */
  currentAlign(): Justify {
    return this.currentPara().align ?? this.t.justify;
  }

  // ------------------------------------------------------------------ changing the text

  private snapshot(kind: string, at: number): void {
    const now = this.now();
    const l = this.lastKind;
    // a burst of typing in one place undoes in one step
    if (kind === 'type' && l.kind === 'type' && now - l.time < 1000 && l.at === this.start && this.collapsed) {
      l.time = now;
      l.at = at;
      return;
    }
    this.lastKind = { kind, time: now, at };
    this.undoStack.push({ t: this.t, anchor: this.anchor, focus: this.focus });
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Make a change (kind null: part of the change before, as while dragging, so no new undo step). */
  private commit(kind: string | null, t: RichText, anchor: number, focus = anchor): void {
    if (kind !== null) this.snapshot(kind, focus);
    this.t = t;
    this.anchor = anchor;
    this.focus = focus;
    this.pending = null;
    this.goalX = null;
    this.lay = null;
    this.onChange('text');
  }

  /** Put a changed text in place as one undo step (a document's style or a figure changed); kind null adds to the last step. */
  update(t: RichText, kind: string | null = 'edit', anchor = this.anchor, focus = this.focus): void {
    const n = rt.plainText(t.runs).length;
    this.commit(kind, { ...t, paras: fitParas(t.paras, paraCount(rt.plainText(t.runs))) }, Math.min(anchor, n), Math.min(focus, n));
  }

  /** Put runs (and their paragraph styles, when they bring their own) in place of the selection. */
  replaceSelection(runs: TextRun[], paras?: ParaStyle[], kind = 'paste'): void {
    this.replace(this.start, this.end, runs, paras, kind);
  }

  /** Put runs in place of the text between two places, leaving the caret after them (kind null: part of the change before). */
  replace(start: number, end: number, runs: TextRun[], paras?: ParaStyle[], kind: string | null = 'edit'): void {
    // tracked whether a step of its own or part of the one before (a paste puts its objects in first)
    const who = this.track?.();
    if (who) {
      const got = trackedReplace(this.t, start, end, runs, paras, who);
      this.keptLast = got.kept;
      this.commit(kind, got.t, got.caret);
      return;
    }
    const text = this.text;
    const inserted = rt.plainText(runs);
    const t: RichText = {
      ...this.t,
      runs: rt.replaceRange(this.t.runs, start, end, runs),
      paras: editParas(this.t.paras, text, start, end, inserted, paras),
    };
    this.commit(kind, t, start + inserted.length);
  }

  /** Type text at the caret, in the typing style. */
  type(text: string): void {
    if (!text) return;
    text = text.replace(/\r\n?/g, '\n');
    if (text === '\n') { this.enter(false); return; }
    this.replace(this.start, this.end, [{ ...this.typingStyle(), text }], undefined, text.includes('\n') ? 'paste' : 'type');
    this.onTyped(text);
  }

  /** Paste plain text: it takes the style of the text it goes into. */
  pastePlain(text: string): void {
    text = text.replace(/\r\n?/g, '\n');
    if (text) this.replaceSelection([{ ...this.typingStyle(), text }], undefined, 'paste');
  }

  /**
   * Enter: a new paragraph, carrying on a list. In an empty list item it ends the list instead,
   * as in Word. With Shift, a list item goes on in a new paragraph without a bullet of its own.
   */
  enter(soft: boolean): void {
    const text = this.text;
    const p = paraAt(text, this.start);
    const ps = this.t.paras[p] ?? {};
    const range = paraRange(text, p);
    if (!soft && this.collapsed && ps.list && range.start === range.end) {
      this.setParas(p, p, { list: undefined, level: undefined, cont: undefined }, 'list');
      return;
    }
    const style = this.typingStyle();
    this.replace(this.start, this.end, [{ ...style, text: '\n' }], undefined, 'line');
    if (soft && ps.list) {
      const paras = this.t.paras.slice();
      paras[p + 1] = cleanPara({ ...paras[p + 1], cont: true });
      this.t = { ...this.t, paras };
      this.lay = null;
      this.onChange('text');
    }
    this.onTyped('\n');
  }

  /**
   * Backspace (Ctrl: the word before). At the start of a list item it takes the bullet off
   * first, and at the start of an indented paragraph the indent, before joining paragraphs.
   */
  backspace(word = false): void {
    if (!this.collapsed) { this.replace(this.start, this.end, [], undefined, 'delete'); return; }
    const at = this.focus;
    const p0 = this.t.paras[0];
    if (at === 0 && !p0?.list && !p0?.indent && !p0?.firstLine && !p0?.pageBreak && !p0?.colBreak) return;
    const text = this.text;
    const p = paraAt(text, at);
    if (paraRange(text, p).start === at) {
      const ps = this.t.paras[p] ?? {};
      // (a section break first: the text joins the section before)
      if (ps.section) { this.setParas(p, p, { section: undefined }, 'break'); return; }
      if (ps.pageBreak || ps.colBreak) { this.setParas(p, p, { pageBreak: undefined, colBreak: undefined }, 'break'); return; }
      if (ps.list) { this.setParas(p, p, { list: undefined, level: undefined, cont: undefined }, 'list'); return; }
      if (ps.firstLine && ps.firstLine > 0) { this.setParas(p, p, { firstLine: undefined }, 'indent'); return; }
      if (ps.indent) { this.setParas(p, p, { indent: undefined }, 'indent'); return; }
    }
    const from = Math.max(0, word ? wordStart(text, at) : at - (isLow(text[at - 1]) ? 2 : 1));
    this.keptLast = 0;
    this.replace(from, at, [], undefined, 'delete');
    // tracked: the deleted text stays, struck through, and the caret goes before it
    if (this.keptLast) this.setCaret(from);
  }

  /** Delete (Ctrl: the word after). */
  deleteForward(word = false): void {
    if (!this.collapsed) { this.replace(this.start, this.end, [], undefined, 'delete'); return; }
    const text = this.text;
    const at = this.focus;
    if (at >= text.length) return;
    const to = word ? wordEnd(text, at) : at + (isLow(text[at + 1]) ? 2 : 1);
    this.keptLast = 0;
    this.replace(at, Math.min(text.length, to), [], undefined, 'delete');
    // tracked: the deleted text stays, struck through, and the caret goes past it
    if (this.keptLast) this.setCaret(at + this.keptLast);
  }

  // ------------------------------------------------------------------ the caret and selection

  /** Put the caret somewhere (Shift: stretch the selection there). */
  setCaret(at: number, extend = false): void {
    at = Math.max(0, Math.min(this.text.length, at));
    if (!extend) this.anchor = at;
    this.focus = at;
    this.pending = null;
    this.goalX = null;
    this.onChange('selection');
  }

  select(anchor: number, focus: number): void {
    const n = this.text.length;
    this.anchor = Math.max(0, Math.min(n, anchor));
    this.focus = Math.max(0, Math.min(n, focus));
    this.pending = null;
    this.goalX = null;
    this.onChange('selection');
  }

  selectAll(): void { this.select(0, this.text.length); }

  /** The word at a place (double-click). */
  selectWord(at: number): void {
    const [a, b] = wordAt(this.text, at);
    this.select(a, b);
  }

  /** The paragraph at a place (triple-click). */
  selectParagraph(at: number): void {
    const text = this.text;
    const r = paraRange(text, paraAt(text, at));
    this.select(r.start, r.end);
  }

  /** The place nearest a point (relative to the text's origin). */
  offsetAt(x: number, y: number): number {
    return offsetAt(this.layout(), x, y);
  }

  /** Move the caret with the arrow keys, Home and End (Shift: stretch the selection). */
  move(how: Move, extend: boolean): void {
    const text = this.text;
    const n = text.length;
    if (!extend && !this.collapsed && (how === 'left' || how === 'right')) {
      // an arrow key on a selection goes to its start or end
      this.setCaret(how === 'left' ? this.start : this.end);
      return;
    }
    const at = this.focus;
    let to = at;
    let keepGoal = false;
    switch (how) {
      case 'left': to = at - (isLow(text[at - 1]) ? 2 : 1); break;
      case 'right': to = at + (isLow(text[at + 1]) ? 2 : 1); break;
      case 'wordLeft': to = wordStart(text, at); break;
      case 'wordRight': to = nextWord(text, at); break;
      case 'textStart': to = 0; break;
      case 'textEnd': to = n; break;
      case 'lineStart':
      case 'lineEnd': {
        const lay = this.layout();
        const l = lay.lines[lineOf(lay, at)];
        to = how === 'lineStart' ? l.start : l.last ? l.end : Math.max(l.start, l.end - 1);
        break;
      }
      case 'up':
      case 'down': {
        const lay = this.layout();
        const li = lineOf(lay, at);
        const goal = this.goalX ?? caretPos(lay, at).x;
        const target = li + (how === 'up' ? -1 : 1);
        to = target < 0 ? 0 : target >= lay.lines.length ? n : offsetInLine(lay, target, goal);
        this.goalX = goal;
        keepGoal = true;
        break;
      }
    }
    const goal = this.goalX;
    this.setCaret(to, extend);
    if (keepGoal) this.goalX = goal;
  }

  // ------------------------------------------------------------------ styles

  /** Bold, italic and so on: on the selection, or for what is typed next. */
  toggle(key: rt.Toggle): void {
    if (this.collapsed) {
      this.pending = { ...this.pending, ...rt.togglePatch(this.typingStyle(), key, this.defaults) };
      this.onChange('selection');
      return;
    }
    this.commit('style', { ...this.t, runs: rt.toggleStyle(this.t.runs, this.start, this.end, key, this.defaults) }, this.anchor, this.focus);
  }

  /** Size, font or colour: on the selection, or for what is typed next. */
  setStyle(patch: Partial<rt.RunStyle>): void {
    if (this.collapsed) {
      this.pending = { ...this.pending, ...patch };
      this.onChange('selection');
      return;
    }
    this.commit('style', { ...this.t, runs: rt.applyStyle(this.t.runs, this.start, this.end, patch) }, this.anchor, this.focus);
  }

  /** Change the selected paragraphs' formatting (one undo step). */
  setSelectedParas(patch: Partial<ParaStyle>, kind = 'para'): void {
    const [a, b] = this.selectedParas();
    this.setParas(a, b, patch, kind);
  }

  /** Change the paragraphs from `first` to `last`. */
  setParas(first: number, last: number, patch: Partial<ParaStyle>, kind: string | null): void {
    const paras = fitParas(this.t.paras, paraCount(this.text)).map((p, i) => (i < first || i > last ? p : cleanPara({ ...p, ...patch })));
    this.commit(kind, { ...this.t, paras }, this.anchor, this.focus);
  }

  /**
   * Line up the selected paragraphs. When that is all of them, the whole text is lined up that
   * way (which is also what ChemDraw can show); otherwise just those paragraphs.
   */
  align(j: Justify): void {
    const n = paraCount(this.text);
    const [a, b] = this.selectedParas();
    let paras = fitParas(this.t.paras, n);
    let justify = this.t.justify;
    if (a === 0 && b === n - 1) {
      justify = j;
      paras = paras.map((p) => cleanPara({ ...p, align: undefined }));
    } else {
      paras = paras.map((p, i) => (i < a || i > b ? p : cleanPara({ ...p, align: j === justify ? undefined : j })));
      // every paragraph lined up the same way is the same as lining up the whole text
      const aligns = new Set(paras.map((p) => p.align ?? justify));
      if (aligns.size === 1) { justify = [...aligns][0]; paras = paras.map((p) => cleanPara({ ...p, align: undefined })); }
    }
    this.commit('align', { ...this.t, justify, paras }, this.anchor, this.focus);
  }

  /** Bullets or numbers on the selected paragraphs; off again if they all have them already. */
  list(kind: 'bullet' | 'number'): void {
    const [a, b] = this.selectedParas();
    const paras = fitParas(this.t.paras, paraCount(this.text));
    const all = paras.slice(a, b + 1).every((p) => p.list === kind && !p.cont);
    this.setParas(a, b, all ? { list: undefined, level: undefined, cont: undefined } : { list: kind, cont: undefined }, 'list');
  }

  /** Tab and Shift+Tab: a list item goes a level deeper or back out; other paragraphs indent. */
  indent(delta: 1 | -1): void {
    const [a, b] = this.selectedParas();
    const paras = fitParas(this.t.paras, paraCount(this.text)).map((p, i) => {
      if (i < a || i > b) return p;
      if (p.list) return cleanPara({ ...p, level: Math.max(0, Math.min(MAX_LEVEL, (p.level ?? 0) + delta)) });
      return cleanPara({ ...p, indent: Math.max(0, (p.indent ?? 0) + delta * this.indentStep) });
    });
    this.commit('indent', { ...this.t, paras }, this.anchor, this.focus);
  }

  /** Space before and after the selected paragraphs (points). */
  paraSpacing(patch: { spaceBefore?: number; spaceAfter?: number }): void {
    const [a, b] = this.selectedParas();
    this.setParas(a, b, patch, 'spacing');
  }

  /** Line spacing for the whole text, as a multiple of single spacing. */
  lineSpacing(v: number): void {
    const t = { ...this.t, lineSpacing: v > 0 && Math.abs(v - 1) > 1e-6 ? v : undefined };
    delete t.lineHeight;
    this.commit('spacing', t, this.anchor, this.focus);
  }

  /**
   * The width lines wrap to (undefined: lines only break where Enter was pressed). While a
   * handle is dragged, only the first change starts an undo step (`record` false after that).
   */
  setWrap(w: number | undefined, record = true): void {
    const t = { ...this.t, wrap: w !== undefined ? Math.max(4, w) : undefined };
    if (t.wrap !== undefined) delete t.width;
    else delete t.wrap;
    this.commit(record ? 'wrap' : null, t, this.anchor, this.focus);
  }

  // ------------------------------------------------------------------ chemistry fixes

  private lookCache: { t: RichText; looks: CharLook[] } | null = null;

  /** How each character looks: its position (formula style worked out) and italics. */
  /** The looks of the characters from `from` up to `to` (a few words, without going through the whole text). */
  looksBetween(from: number, to: number): CharLook[] {
    if (this.lookCache?.t === this.t) return this.lookCache.looks.slice(from, to);
    const out: CharLook[] = [];
    let at = 0;
    for (const r of this.t.runs) {
      const n = r.text.length;
      if (at + n > from && at < to) {
        const italic = !!r.italic;
        const parts = r.formula && !r.sub && !r.sup ? rt.formulaParts(r.text) : null;
        const pos: CharLook['pos'][] = [];
        if (parts) for (const p of parts) for (let i = 0; i < p.text.length; i++) pos.push(p.pos);
        for (let i = Math.max(0, from - at); i < Math.min(n, to - at); i++) out.push({ pos: r.sub ? 'sub' : r.sup ? 'sup' : parts ? pos[i] : 'base', italic });
      }
      at += n;
      if (at >= to) break;
    }
    return out;
  }

  looks(): CharLook[] {
    if (this.lookCache?.t === this.t) return this.lookCache.looks;
    const looks: CharLook[] = [];
    for (const r of this.t.runs) {
      const italic = !!r.italic;
      if (r.sub || r.sup) for (let i = 0; i < r.text.length; i++) looks.push({ pos: r.sub ? 'sub' : 'sup', italic });
      else if (r.formula) for (const p of rt.formulaParts(r.text)) for (let i = 0; i < p.text.length; i++) looks.push({ pos: p.pos, italic });
      else for (let i = 0; i < r.text.length; i++) looks.push({ pos: 'base', italic });
    }
    this.lookCache = { t: this.t, looks };
    return looks;
  }

  /**
   * Make changes found by the chemistry rules (subscripts, superscripts, italics, replaced
   * text) as one undo step, keeping the caret where it was in the text.
   */
  fix(edits: FixEdit[], kind = 'format'): void {
    if (!edits.length) return;
    let runs = this.t.runs;
    let paras = this.t.paras;
    for (const e of edits) {
      const patch: Partial<rt.RunStyle> = {};
      if (e.pos) Object.assign(patch, { sub: e.pos === 'sub' || undefined, sup: e.pos === 'sup' || undefined, formula: undefined });
      if (e.italic !== undefined) patch.italic = e.italic || undefined;
      if (Object.keys(patch).length) runs = rt.applyStyle(runs, e.start, e.end, patch);
    }
    let anchor = this.anchor, focus = this.focus;
    const moved = (at: number, e: FixEdit, len: number) => (at >= e.end ? at + len - (e.end - e.start) : at > e.start ? e.start + len : at);
    const who = this.track?.();
    for (const e of [...edits].filter((x) => x.text !== undefined).sort((a, b) => b.start - a.start)) {
      const text = rt.plainText(runs);
      const style = rt.typingStyle(runs, e.start, e.end, this.defaults);
      if (who) {
        // tracked: what was there is marked deleted (or just goes, if it was typed while tracking) and the fix inserted
        const got = trackedReplace({ ...this.t, runs, paras }, e.start, e.end, [{ ...style, text: e.text! }], undefined, who);
        const delta = rt.plainText(got.t.runs).length - text.length;
        const shift = (at: number) => (at >= e.end ? at + delta : at > e.start ? got.caret : at);
        runs = got.t.runs;
        paras = got.t.paras;
        anchor = shift(anchor);
        focus = shift(focus);
        continue;
      }
      paras = editParas(paras, text, e.start, e.end, e.text!);
      runs = rt.replaceRange(runs, e.start, e.end, [{ ...style, text: e.text! }]);
      anchor = moved(anchor, e, e.text!.length);
      focus = moved(focus, e, e.text!.length);
    }
    this.commit(kind, { ...this.t, runs, paras }, anchor, focus);
  }

  // ------------------------------------------------------------------ undo

  undo(): void { this.restore(this.undoStack, this.redoStack); }
  redo(): void { this.restore(this.redoStack, this.undoStack); }

  private restore(from: Snap[], to: Snap[]): void {
    const s = from.pop();
    if (!s) return;
    to.push({ t: this.t, anchor: this.anchor, focus: this.focus });
    this.t = s.t;
    this.anchor = s.anchor;
    this.focus = s.focus;
    this.lastKind = { kind: '', time: 0, at: -1 };
    this.pending = null;
    this.goalX = null;
    this.lay = null;
    this.onChange('text');
  }

  // ------------------------------------------------------------------ input methods

  compositionStart(): void {
    if (!this.collapsed) this.replace(this.start, this.end, [], undefined, 'delete');
    this.composing = '';
  }

  compositionUpdate(text: string): void {
    this.composing = text;
    this.lay = null;
    this.onChange('selection');
  }

  compositionEnd(text: string): void {
    this.composing = null;
    this.lay = null;
    if (text) this.type(text);
    else this.onChange('selection');
  }

  // ------------------------------------------------------------------ copying

  /** The selected text with the styles of the paragraphs it touches. */
  selected(): { runs: TextRun[]; paras: ParaStyle[] } {
    const [a, b] = this.selectedParas();
    return {
      runs: rt.sliceRuns(this.t.runs, this.start, this.end),
      paras: fitParas(this.t.paras, paraCount(this.text)).slice(a, b + 1),
    };
  }
}

// ------------------------------------------------------------------ words

/** Start of the word before a place (Ctrl+Left, Ctrl+Backspace): back over spaces, then the word. */
export function wordStart(text: string, at: number): number {
  let i = at;
  while (i > 0 && !isWordChar(text[i - 1]) && text[i - 1] !== '\n') i--;
  if (i === at && text[i - 1] === '\n') return i - 1;
  while (i > 0 && isWordChar(text[i - 1])) i--;
  return i;
}

/** End of the word after a place (Ctrl+Delete): the word, then the spaces after it. */
export function wordEnd(text: string, at: number): number {
  let i = at;
  if (text[i] === '\n') return i + 1;
  while (i < text.length && isWordChar(text[i])) i++;
  if (i === at) while (i < text.length && !isWordChar(text[i]) && text[i] !== '\n' && text[i] !== ' ') i++;
  while (i < text.length && text[i] === ' ') i++;
  return i;
}

/** Start of the next word (Ctrl+Right), as on Windows. */
export function nextWord(text: string, at: number): number {
  return wordEnd(text, at);
}
