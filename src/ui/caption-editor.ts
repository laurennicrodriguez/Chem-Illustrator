// Typing a caption in place: a text box over the drawing that shows the caption as it will
// look, with a bar of buttons above it for bold, italic, subscript, formula style, size,
// colour, line-up and symbols. The text is kept as styled runs; the box is redrawn from them
// after every change, so what is on screen always matches what will be saved.

import type { Caption, TextRun } from '../model';
import type { Vec } from '../geom';
import { FONT_STACK } from '../render/renderer';
import { keymap, chordOf, parseAction } from '../editor/keymap';
import * as rt from '../richtext';

export interface CaptionText {
  runs: TextRun[];
  justify: Caption['justify'];
}

export interface Placement {
  /** Left end of the first line's baseline, in document points. */
  at: Vec;
  /** Width of the text box when the caption has one (centred and right-aligned text). */
  width?: number;
}

/** Where the screen is: points to pixels (the renderer). */
export interface View {
  view: { scale: number };
  toScreen(p: Vec): Vec;
}

const SIZES = [5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

// Greek letters and signs chemists put in captions; all of them can be saved for ChemDraw.
const SYMBOLS = [
  'αβγδεζηθικλμνξπρστυφχψω',
  'ΓΔΘΛΞΠΣΦΨΩ',
  '°±×÷·•→←↑↓↔⇒≤≥≠≈≡∞′″…–—‡†‰Å',
].map((row) => [...row].filter(rt.savableChar));

// ------------------------------------------------------------------ runs ⇄ text box

/** Show runs in the text box at the given zoom. */
export function renderRuns(box: HTMLElement, runs: TextRun[], scale: number, defaultSize: number): void {
  box.textContent = '';
  const doc = box.ownerDocument;
  const span = (style: rt.RunStyle, text: string, pos: rt.Part['pos']) => {
    const el = doc.createElement('span');
    el.dataset.s = JSON.stringify(style);
    const size = (style.size ?? defaultSize) * scale;
    const st = el.style;
    st.fontFamily = style.font ? `${style.font}, ${FONT_STACK}` : FONT_STACK;
    st.fontSize = `${pos === 'base' ? size : size * 0.75}px`;
    if (style.bold) st.fontWeight = 'bold';
    if (style.italic) st.fontStyle = 'italic';
    if (style.underline) st.textDecoration = 'underline';
    if (style.color) st.color = style.color;
    if (pos !== 'base') {
      st.verticalAlign = `${pos === 'sub' ? -0.22 * size : 0.42 * size}px`;
      st.lineHeight = '0';
    }
    el.textContent = text;
    box.appendChild(el);
  };
  for (const r of runs) {
    const style = rt.styleOf(r);
    r.text.split('\n').forEach((line, i) => {
      if (i > 0) {
        const br = doc.createElement('br');
        br.dataset.s = JSON.stringify(style);
        box.appendChild(br);
      }
      if (!line) return;
      if (style.formula) for (const p of rt.formulaParts(line)) span(style, p.text, p.pos);
      else span(style, line, style.sub ? 'sub' : style.sup ? 'sup' : 'base');
    });
  }
  // a line break at the very end needs something after it to show the empty line
  if (rt.plainText(runs).endsWith('\n')) {
    const br = doc.createElement('br');
    br.dataset.end = '1';
    box.appendChild(br);
  }
}

/** Read runs back from the text box, including anything the browser typed into it itself. */
export function readRuns(box: HTMLElement, fallback: rt.RunStyle): TextRun[] {
  const out: TextRun[] = [];
  let last = fallback;
  const styleFor = (n: Node): rt.RunStyle => {
    const el = n.nodeType === 1 ? (n as HTMLElement) : n.parentElement;
    const owner = el?.closest<HTMLElement>('[data-s]');
    if (owner && box.contains(owner)) {
      try { return JSON.parse(owner.dataset.s!) as rt.RunStyle; } catch { /* use the last style */ }
    }
    return last;
  };
  const walk = (n: Node) => {
    for (const ch of n.childNodes) {
      if (ch.nodeType === 3) {
        const text = (ch as Text).data;
        if (!text) continue;
        last = styleFor(ch);
        out.push({ ...last, text });
      } else if (ch.nodeName === 'BR') {
        if (!(ch as HTMLElement).dataset.end) out.push({ ...styleFor(ch), text: '\n' });
      } else if (ch.nodeName === 'DIV' || ch.nodeName === 'P') {
        // a browser may start a new line as a block of its own
        if (out.length) out.push({ ...last, text: '\n' });
        walk(ch);
      } else walk(ch);
    }
  };
  walk(box);
  return rt.normalizeRuns(out);
}

const nodeLength = (n: Node): number => {
  if (n.nodeType === 3) return (n as Text).data.length;
  if (n.nodeName === 'BR') return (n as HTMLElement).dataset.end ? 0 : 1;
  let t = 0;
  for (const c of n.childNodes) t += nodeLength(c);
  return t;
};

/** A place in the text box as a count of characters from the start (line breaks count one). */
export function offsetOf(box: Node, node: Node, offset: number): number {
  if (node !== box && !box.contains(node)) return 0;
  let t = 0;
  for (let cur: Node | null = node; cur && cur !== box; cur = cur.parentNode) {
    for (let s = cur.previousSibling; s; s = s.previousSibling) t += nodeLength(s);
  }
  if (node.nodeType === 3) return t + offset;
  for (let i = 0; i < offset && i < node.childNodes.length; i++) t += nodeLength(node.childNodes[i]);
  return t;
}

/** The place in the text box a character count points to. */
export function pointAt(box: Node, offset: number): { node: Node; offset: number } {
  let left = offset;
  const visit = (n: Node): { node: Node; offset: number } | null => {
    const kids = [...n.childNodes];
    for (let i = 0; i < kids.length; i++) {
      const ch = kids[i];
      if (ch.nodeType === 3) {
        const len = (ch as Text).data.length;
        if (left <= len) return { node: ch, offset: left };
        left -= len;
      } else if (ch.nodeName === 'BR') {
        if (left === 0) return { node: n, offset: i };
        if (!(ch as HTMLElement).dataset.end) left -= 1;
      } else {
        const r = visit(ch);
        if (r) return r;
      }
    }
    return null;
  };
  return visit(box) ?? { node: box, offset: box.childNodes.length };
}

// ------------------------------------------------------------------ the editor

type Snapshot = { runs: TextRun[]; start: number; end: number; justify: Caption['justify'] };

export class CaptionEditor {
  readonly box: HTMLDivElement;
  private bar: HTMLDivElement;
  private symbols: HTMLDivElement;
  private runs: TextRun[];
  private justify: Caption['justify'];
  private sel = { start: 0, end: 0 };
  /** Style picked with nothing selected: it applies to what is typed next. */
  private pending: Partial<rt.RunStyle> | null = null;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastPush = { kind: '', time: 0 };
  private shownScale = 0;
  private closed = false;
  private settingSel = false;
  private readonly onSelChange = () => this.selectionChanged();
  private buttons = new Map<string, HTMLButtonElement>();
  private sizeInput!: HTMLInputElement;
  private colorInput!: HTMLInputElement;

  constructor(
    private host: HTMLElement,
    private view: View,
    private place0: Placement,
    initial: CaptionText,
    private defaults: rt.RunStyle,
    private done: (result: CaptionText) => void,
  ) {
    this.runs = rt.normalizeRuns(initial.runs.map((r) => ({ ...r })));
    this.justify = initial.justify;
    const d = host.ownerDocument;
    this.box = d.createElement('div');
    this.box.className = 'caption-editor';
    this.box.contentEditable = 'true';
    this.box.spellcheck = false;
    this.box.setAttribute('role', 'textbox');
    this.box.setAttribute('aria-multiline', 'true');
    this.box.setAttribute('aria-label', 'Caption text');
    this.bar = d.createElement('div');
    this.bar.className = 'caption-bar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Caption style');
    this.symbols = d.createElement('div');
    this.symbols.className = 'caption-symbols';
    this.symbols.hidden = true;
    this.buildBar();
    host.append(this.box, this.bar);

    this.box.addEventListener('beforeinput', (e) => this.beforeInput(e));
    this.box.addEventListener('input', () => this.resync());
    this.box.addEventListener('compositionend', () => this.resync());
    this.box.addEventListener('keydown', (e) => this.onKey(e));
    this.box.addEventListener('paste', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text) this.insert(text.replace(/\r\n?/g, '\n'), 'paste');
    });
    this.box.addEventListener('dragover', (e) => e.preventDefault());
    this.box.addEventListener('drop', (e) => e.preventDefault());
    for (const el of [this.box, this.bar]) {
      el.addEventListener('focusout', (e) => {
        const to = e.relatedTarget as Node | null;
        if (to && (this.box.contains(to) || this.bar.contains(to))) return;
        // a click on a bar button keeps the focus; anything else outside ends the editing
        setTimeout(() => { if (!this.closed && !this.box.contains(d.activeElement) && !this.bar.contains(d.activeElement)) this.finish(); }, 0);
      });
    }
    d.addEventListener('selectionchange', this.onSelChange);

    this.render();
    this.place();
    this.box.focus();
    const end = rt.plainText(this.runs).length;
    this.setSelection(end, end);
  }

  /** Put the caret where the screen was clicked, when the browser can tell. */
  caretAt(clientX: number, clientY: number): void {
    const d = this.box.ownerDocument as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    let node: Node | null = null, off = 0;
    if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(clientX, clientY);
      if (p) { node = p.offsetNode; off = p.offset; }
    } else if (d.caretRangeFromPoint) {
      const r = d.caretRangeFromPoint(clientX, clientY);
      if (r) { node = r.startContainer; off = r.startOffset; }
    }
    if (!node || !(node === this.box || this.box.contains(node))) return;
    const o = offsetOf(this.box, node, off);
    this.setSelection(o, o);
  }

  /** Keep the box over its caption when the drawing is scrolled or zoomed. */
  place(): void {
    if (this.closed) return;
    const s = this.view.view.scale;
    if (s !== this.shownScale) {
      const { start, end } = this.sel;
      this.render();
      if (this.box.ownerDocument.activeElement === this.box) this.setSelection(start, end);
    }
    const p = this.view.toScreen(this.place0.at);
    const first = this.firstLineSize() * s;
    const bs = this.box.style;
    bs.left = `${p.x}px`;
    // Arial's baseline sits about 0.92 of the font size below the top of a 1.15-high line
    bs.top = `${p.y - first * 0.92}px`;
    bs.minWidth = this.place0.width ? `${this.place0.width * s}px` : '';
    bs.fontSize = `${(this.defaults.size ?? 10) * s}px`;
    bs.textAlign = this.justify;
    // the bar sits above the text, or below it near the top of the window
    const hb = this.bar.offsetHeight || 32;
    const top = p.y - first * 0.92;
    const below = top - hb - 6 < 0;
    const left = Math.max(4, Math.min(p.x, this.host.clientWidth - (this.bar.offsetWidth || 420) - 4));
    this.bar.style.left = `${left}px`;
    this.bar.style.top = `${below ? top + this.box.offsetHeight + 6 : top - hb - 6}px`;
  }

  /** Stop editing and hand back the text. */
  finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.box.ownerDocument.removeEventListener('selectionchange', this.onSelChange);
    this.box.remove();
    this.bar.remove();
    this.done({ runs: rt.normalizeRuns(this.runs), justify: this.justify });
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  // ------------------------------------------------------------------ changes

  private firstLineSize(): number {
    let size = 0;
    for (const r of this.runs) {
      const nl = r.text.indexOf('\n');
      if (nl !== 0) size = Math.max(size, r.size ?? this.defaults.size ?? 10);
      if (nl >= 0) break;
    }
    return size || (this.pending?.size ?? this.defaults.size ?? 10);
  }

  private render(): void {
    this.shownScale = this.view.view.scale;
    renderRuns(this.box, this.runs, this.shownScale, this.defaults.size ?? 10);
  }

  private snapshot(kind: string): void {
    const now = performance.now();
    // a burst of typing undoes in one step
    if (kind === 'type' && this.lastPush.kind === 'type' && now - this.lastPush.time < 1000) { this.lastPush.time = now; return; }
    this.lastPush = { kind, time: now };
    this.undoStack.push({ runs: this.runs, start: this.sel.start, end: this.sel.end, justify: this.justify });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private change(kind: string, runs: TextRun[], start: number, end = start): void {
    this.snapshot(kind);
    this.runs = runs;
    this.render();
    this.setSelection(start, end);
    this.place();
  }

  private restore(from: Snapshot[], to: Snapshot[]): void {
    const s = from.pop();
    if (!s) return;
    to.push({ runs: this.runs, start: this.sel.start, end: this.sel.end, justify: this.justify });
    this.runs = s.runs;
    this.justify = s.justify;
    this.lastPush = { kind: '', time: 0 };
    this.render();
    this.setSelection(s.start, s.end);
    this.place();
  }

  private insert(text: string, kind = 'type', range = this.readSelection()): void {
    const style = { ...rt.typingStyle(this.runs, range.start, range.end, this.defaults), ...this.pending };
    this.pending = null;
    const runs = rt.replaceRange(this.runs, range.start, range.end, [{ ...rt.cleanStyle(style), text }]);
    this.change(text === '\n' ? 'line' : kind, runs, range.start + text.length);
  }

  /** Pick up whatever the browser changed in the box by itself (accented letters, for example). */
  private resync(): void {
    if (this.closed) return;
    const sel = this.readSelection();
    const runs = readRuns(this.box, this.defaults);
    if (rt.plainText(runs) === rt.plainText(this.runs) && runs.length === this.runs.length) return;
    this.snapshot('type');
    this.runs = runs;
    this.render();
    this.setSelection(sel.start, sel.end);
    this.place();
  }

  private beforeInput(e: InputEvent): void {
    if (e.isComposing) return;
    const t = e.inputType;
    if (t === 'historyUndo' || t === 'historyRedo') {
      e.preventDefault();
      if (t === 'historyUndo') this.restore(this.undoStack, this.redoStack);
      else this.restore(this.redoStack, this.undoStack);
      return;
    }
    if (t.startsWith('format')) { e.preventDefault(); return; }
    const target = this.targetRange(e);
    if (t === 'insertParagraph' || t === 'insertLineBreak') {
      e.preventDefault();
      this.insert('\n', 'line', target ?? undefined);
      return;
    }
    if (t.startsWith('insert')) {
      const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
      e.preventDefault();
      if (text) this.insert(text.replace(/\r\n?/g, '\n'), t === 'insertText' ? 'type' : 'paste', target ?? undefined);
      return;
    }
    if (t.startsWith('delete') && target) {
      e.preventDefault();
      if (target.end > target.start) this.change('delete', rt.deleteRange(this.runs, target.start, target.end), target.start);
    }
  }

  private targetRange(e: InputEvent): { start: number; end: number } | null {
    const r = e.getTargetRanges?.()[0];
    if (!r) return null;
    const a = offsetOf(this.box, r.startContainer, r.startOffset), b = offsetOf(this.box, r.endContainer, r.endOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' || (e.key === 'Enter' && ctrl)) { e.preventDefault(); this.finish(); return; }
    // styling keys come from the key map (Edit > Hotkeys), so they can be changed
    const chord = chordOf(e);
    const action = chord ? keymap.lookup('text', chord) : undefined;
    if (action) {
      e.preventDefault();
      this.toggle(parseAction(action).arg as rt.Toggle);
      return;
    }
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    const run = (f: () => void) => { e.preventDefault(); f(); };
    if (k === 'z' && !e.shiftKey) run(() => this.restore(this.undoStack, this.redoStack));
    else if (k === 'y' || (k === 'z' && e.shiftKey)) run(() => this.restore(this.redoStack, this.undoStack));
  }

  // ------------------------------------------------------------------ styling

  private toggle(key: rt.Toggle): void {
    const { start, end } = this.readSelection();
    if (start === end) {
      const cur = { ...rt.typingStyle(this.runs, start, end, this.defaults), ...this.pending };
      this.pending = { ...this.pending, ...rt.togglePatch(cur, key, this.defaults) };
      this.updateBar();
      return;
    }
    this.change('style', rt.toggleStyle(this.runs, start, end, key, this.defaults), start, end);
  }

  private setStyle(patch: Partial<rt.RunStyle>): void {
    const { start, end } = this.sel;
    if (start === end) {
      this.pending = { ...this.pending, ...patch };
      this.updateBar();
      this.box.focus();
      this.setSelection(start, end);
      return;
    }
    this.box.focus();
    this.change('style', rt.applyStyle(this.runs, start, end, patch), start, end);
  }

  private setJustify(j: Caption['justify']): void {
    if (j === this.justify) return;
    this.snapshot('justify');
    this.justify = j;
    this.place();
    this.updateBar();
  }

  /** The style shown on the bar: what the selection has in common, or what typing will use. */
  private currentStyle(): rt.RunStyle {
    const { start, end } = this.sel;
    if (start === end) return { ...rt.typingStyle(this.runs, start, end, this.defaults), ...this.pending };
    return rt.commonStyle(this.runs, start, end);
  }

  // ------------------------------------------------------------------ selection

  private readSelection(): { start: number; end: number } {
    const s = this.box.ownerDocument.getSelection();
    if (s && s.rangeCount && this.box.contains(s.anchorNode) && this.box.contains(s.focusNode)) {
      const a = offsetOf(this.box, s.anchorNode!, s.anchorOffset), b = offsetOf(this.box, s.focusNode!, s.focusOffset);
      this.sel = { start: Math.min(a, b), end: Math.max(a, b) };
    }
    return { ...this.sel };
  }

  private setSelection(start: number, end: number): void {
    this.sel = { start, end };
    const s = this.box.ownerDocument.getSelection();
    if (s) {
      const a = pointAt(this.box, start), b = pointAt(this.box, end);
      this.settingSel = true;
      s.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
      // selectionchange arrives later; let it through once without clearing the typing style
      setTimeout(() => { this.settingSel = false; }, 0);
    }
    this.updateBar();
  }

  private selectionChanged(): void {
    if (this.closed) return;
    const s = this.box.ownerDocument.getSelection();
    if (!s || !this.box.contains(s.anchorNode)) return;
    const before = this.sel;
    const now = this.readSelection();
    if (!this.settingSel && (now.start !== before.start || now.end !== before.end)) this.pending = null;
    this.updateBar();
  }

  // ------------------------------------------------------------------ the bar

  private buildBar(): void {
    const d = this.host.ownerDocument;
    const group = () => { const g = d.createElement('span'); g.className = 'cb-group'; this.bar.appendChild(g); return g; };
    const button = (g: HTMLElement, id: string, html: string, title: string, on: () => void) => {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'cb-btn';
      b.innerHTML = html;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.setAttribute('aria-pressed', 'false');
      // keep the caret in the text while clicking
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', on);
      g.appendChild(b);
      this.buttons.set(id, b);
      return b;
    };
    let g = group();
    button(g, 'bold', '<b>B</b>', 'Bold (Ctrl+B)', () => this.toggle('bold'));
    button(g, 'italic', '<i>I</i>', 'Italic (Ctrl+I)', () => this.toggle('italic'));
    button(g, 'underline', '<u>U</u>', 'Underline (Ctrl+U)', () => this.toggle('underline'));
    g = group();
    button(g, 'sub', 'x<sub>2</sub>', 'Subscript (Ctrl+=)', () => this.toggle('sub'));
    button(g, 'sup', 'x<sup>2</sup>', 'Superscript (Ctrl+Shift+=)', () => this.toggle('sup'));
    button(g, 'formula', 'CH<sub>3</sub>', 'Formula: numbers after letters go down, charges go up', () => this.toggle('formula'));

    g = group();
    const size = d.createElement('input');
    size.type = 'number';
    size.min = '1';
    size.max = '400';
    size.step = '0.5';
    size.className = 'cb-size';
    size.title = 'Text size (points)';
    size.setAttribute('aria-label', 'Text size in points');
    const list = d.createElement('datalist');
    list.id = `cb-sizes-${Math.random().toString(36).slice(2)}`;
    for (const v of SIZES) { const o = d.createElement('option'); o.value = String(v); list.appendChild(o); }
    size.setAttribute('list', list.id);
    const applySize = () => {
      const v = Number(size.value);
      if (size.value.trim() !== '' && Number.isFinite(v) && v > 0) this.setStyle({ size: Math.min(400, v) });
    };
    size.addEventListener('change', applySize);
    size.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); applySize(); }
      if (e.key === 'Escape') { e.preventDefault(); this.box.focus(); this.setSelection(this.sel.start, this.sel.end); }
    });
    g.append(size, list);
    this.sizeInput = size;
    const color = d.createElement('input');
    color.type = 'color';
    color.className = 'cb-color';
    color.title = 'Text colour';
    color.setAttribute('aria-label', 'Text colour');
    color.addEventListener('change', () => this.setStyle({ color: color.value.toLowerCase() === '#000000' ? undefined : color.value }));
    g.appendChild(color);
    this.colorInput = color;

    g = group();
    const lineIcon = (j: string) => {
      const rows = [[0, 14], [0, 9], [0, 14], [0, 9]].map(([x, w], i) => {
        const left = j === 'left' ? x : j === 'center' ? (14 - w) / 2 : 14 - w;
        return `<rect x="${left + 1}" y="${2 + i * 3.5}" width="${w}" height="1.6"/>`;
      });
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${rows.join('')}</svg>`;
    };
    button(g, 'left', lineIcon('left'), 'Line up on the left', () => this.setJustify('left'));
    button(g, 'center', lineIcon('center'), 'Centre the lines', () => this.setJustify('center'));
    button(g, 'right', lineIcon('right'), 'Line up on the right', () => this.setJustify('right'));

    g = group();
    button(g, 'symbols', 'αΩ', 'Greek letters and symbols', () => { this.symbols.hidden = !this.symbols.hidden; this.updateBar(); });
    for (const row of SYMBOLS) {
      const r = d.createElement('div');
      r.className = 'cs-row';
      for (const ch of row) {
        const b = d.createElement('button');
        b.type = 'button';
        b.textContent = ch;
        b.title = `Insert ${ch}`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => this.insert(ch, 'symbol'));
        r.appendChild(b);
      }
      this.symbols.appendChild(r);
    }
    this.bar.appendChild(this.symbols);
    const hint = d.createElement('span');
    hint.className = 'cb-hint';
    hint.textContent = 'Enter: new line · Esc: done';
    this.bar.appendChild(hint);
  }

  private updateBar(): void {
    if (this.closed) return;
    const s = this.currentStyle();
    for (const k of ['bold', 'italic', 'underline', 'sub', 'sup', 'formula'] as const) this.press(k, !!s[k]);
    for (const j of ['left', 'center', 'right'] as const) this.press(j, this.justify === j);
    this.press('symbols', !this.symbols.hidden);
    const d = this.box.ownerDocument;
    if (d.activeElement !== this.sizeInput) this.sizeInput.value = s.size !== undefined ? String(Math.round(s.size * 100) / 100) : '';
    this.sizeInput.placeholder = s.size === undefined ? '—' : '';
    if (d.activeElement !== this.colorInput) this.colorInput.value = s.color ?? '#000000';
  }

  private press(id: string, on: boolean): void {
    const b = this.buttons.get(id);
    if (!b) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
