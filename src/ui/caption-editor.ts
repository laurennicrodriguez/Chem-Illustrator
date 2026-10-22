// Typing a caption or text box in place. The text is drawn on the drawing's top layer by the
// same layout that draws it on the page, so it looks exactly as it will once done, and the
// caret, selection and clicks all come from that layout. Keys arrive in a hidden text field
// (which is also how input methods for accents and other scripts, and the clipboard, work).
// A bar above the text has the buttons for character and paragraph styles.

import type { Caption, TextRun } from '../model';
import { turnAbout, type Rect, type Vec } from '../geom';
import { keymap, chordOf, parseAction } from '../editor/keymap';
import * as rt from '../richtext';
import { TextEditing, type Move, type RichText } from '../text/editing';
import { drawLayout } from '../text/draw';
import { layoutText, selectionRects, type Measure } from '../text/layout';
import { htmlToRich, richToHtml, richToPlain } from '../text/html';
import { afterTyping, finishWord, setTypingPrefs, typingPrefs } from '../text/typing';
import { findIssues, type Issue } from '../text/chemtext';
import { loadSpeller, type Speller } from '../text/spelling';
import { linkAtPoint } from '../links';
import { askLink, followLink, linkTip, type LinkPlace } from './links-ui';

/** What the editor needs from the drawing it sits on. */
export interface EditorHost {
  /** The element the bar and the hidden text field go in (over the drawing). */
  host: HTMLElement;
  view: { scale: number };
  toScreen(p: Vec): Vec;
  measure: Measure;
  /** Text size for runs that don't give one (the document's caption size). */
  defaultSize: number;
  /** Font for runs that don't give one (the document's caption font). */
  defaultFont?: string;
  /** Ask for the top layer to be drawn again. */
  redraw(): void;
  /** Keys the place being typed into handles itself (Tab moves between table cells); true when it did. */
  keys?(e: KeyboardEvent): boolean;
  /** The text has changed (a table's row grows with the text typed into a cell). */
  typed?(t: RichText): void;
  /** What the keys do, shown at the end of the bar (Tab moves between table cells). */
  hint?: string;
  /** An area the bar keeps clear of, besides the text (the whole table, for a cell). */
  around?(): Rect;
}

/** A finished caption: the text and where it now starts. */
export interface CaptionResult extends Omit<RichText, 'paras'> {
  paras?: Caption['paras'];
  x: number;
  y: number;
}

const SIZES = [5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

// Greek letters and signs chemists put in captions; all of them can be saved for ChemDraw.
const SYMBOLS = [
  'αβγδεζηθικλμνξπρστυφχψω',
  'ΓΔΘΛΞΠΣΦΨΩ',
  '°±×÷·•→←↑↓↔⇒≤≥≠≈≡∞′″…–—‡†‰Å',
].map((row) => [...row].filter(rt.savableChar));

/** In a window marked to type into the text being edited (Insert > Symbol): moving there doesn't end the editing. */
const keepsTyping = (n: Node | null): boolean => !!(n instanceof Element && n.closest('[data-keeps-typing]'));

const SELECTION = 'rgba(40, 120, 255, 0.25)';
const MISSPELLED = '#e0302f';
const FORMATTING = '#2f6fdf';
/** Words ignored with "Ignore" or "Leave as written" while the program is open (lower case). */
const ignored = new Set<string>();
const FRAME = 'rgba(47, 111, 223, 0.6)';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export class CaptionEditor {
  readonly ed: TextEditing;
  private ta: HTMLTextAreaElement;
  private bar: HTMLDivElement;
  private symbols: HTMLDivElement;
  private spacing: HTMLDivElement;
  private closed = false;
  private caretOn = true;
  private blink: ReturnType<typeof setInterval> | null = null;
  private buttons = new Map<string, HTMLButtonElement>();
  private inputs: Record<'font' | 'size' | 'color' | 'line' | 'before' | 'after' | 'wrap', HTMLInputElement> = {} as never;
  private plainPaste = false;
  private clicks = { n: 0, time: 0, at: { x: 0, y: 0 } };
  private dragging: 'text' | 'wrap' | null = null;
  private wrapDragged = false;
  private speller: Speller | null = null;
  private dictSeen: string[] | null = null;
  private checked: { t: RichText; spell: [number, number][]; issues: Issue[] } | null = null;
  private menu: HTMLDivElement | null = null;
  /** The link window is open: the text stays open while it is. */
  private asking = false;
  /** Places in the file a link can go to (slides in a deck), set up by the app. */
  static linkPlaces: (() => { places: LinkPlace[]; title?: string } | null) | null = null;
  private readonly closeMenuOutside = (e: Event) => { if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu(); };

  constructor(
    private h: EditorHost,
    /** Left end of the first line's baseline, in document points. */
    private at: Vec,
    initial: Partial<RichText> & { runs: TextRun[] },
    defaults: rt.RunStyle,
    private done: (result: CaptionResult) => void,
    /** Turned text: degrees clockwise about `at`. It is typed turned, as it shows on the page. */
    private turn = 0,
  ) {
    this.ed = new TextEditing(initial, defaults, h.measure, h.defaultSize);
    this.ed.onChange = (kind) => this.changed(kind);
    this.ed.onTyped = (typed) => afterTyping(this.ed, typed);
    if (typingPrefs.spelling) void loadSpeller().then((sp) => { this.speller = sp; this.checked = null; this.h.redraw(); });
    const d = h.host.ownerDocument;
    this.ta = d.createElement('textarea');
    this.ta.className = 'text-input';
    this.ta.setAttribute('aria-label', 'Caption text');
    this.ta.spellcheck = false;
    this.ta.autocomplete = 'off';
    this.ta.setAttribute('autocorrect', 'off');
    this.ta.setAttribute('autocapitalize', 'off');
    this.ta.wrap = 'off';
    this.bar = d.createElement('div');
    this.bar.className = 'caption-bar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Text style');
    this.symbols = d.createElement('div');
    this.symbols.className = 'caption-symbols';
    this.symbols.hidden = true;
    this.spacing = d.createElement('div');
    this.spacing.className = 'caption-spacing';
    this.spacing.hidden = true;
    this.buildBar();
    // View > Text Formatting Bar: along the top of the drawing (so it never covers what is
    // drawn), floating by the text, or hidden (the keys still work)
    this.bar.classList.toggle('docked', CaptionEditor.barPlace === 'docked');
    this.bar.hidden = CaptionEditor.barPlace === 'hidden';
    h.host.append(this.ta, this.bar);

    const ta = this.ta;
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('beforeinput', (e) => this.beforeInput(e));
    ta.addEventListener('input', () => this.onInput());
    ta.addEventListener('compositionstart', () => this.ed.compositionStart());
    ta.addEventListener('compositionupdate', (e) => this.ed.compositionUpdate(e.data ?? ''));
    ta.addEventListener('compositionend', (e) => { this.ed.compositionEnd(e.data ?? ''); this.syncInput(); });
    ta.addEventListener('copy', (e) => this.copy(e, false));
    ta.addEventListener('cut', (e) => this.copy(e, true));
    ta.addEventListener('paste', (e) => this.paste(e));
    for (const el of [ta, this.bar] as HTMLElement[]) {
      el.addEventListener('focusout', (e) => {
        const to = e.relatedTarget as Node | null;
        if (this.asking || (to && (to === ta || this.bar.contains(to) || keepsTyping(to)))) return;
        // a click on the bar (or in a window that types here, such as Insert Symbol) keeps the text open; anything else outside ends the editing
        setTimeout(() => { if (!this.closed && !this.asking && d.activeElement !== ta && !this.bar.contains(d.activeElement) && !keepsTyping(d.activeElement)) this.finish(); }, 0);
      });
    }
    this.blink = setInterval(() => { this.caretOn = !this.caretOn; this.h.redraw(); }, 530);
    ta.focus({ preventScroll: true });
    this.changed('text');
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  // ------------------------------------------------------------------ screen

  /** The text's box in document points (with a little room round it for clicking). */
  box(): Rect {
    const b = this.ed.layout().box;
    return { x1: this.at.x + b.x1, y1: this.at.y + b.y1, x2: this.at.x + b.x2, y2: this.at.y + b.y2 };
  }

  /** Where the handle that sets the text box width is. */
  private wrapHandle(): Vec {
    const b = this.box();
    const lay = this.ed.layout();
    return { x: this.at.x + Math.max(lay.boxWidth, b.x2 - this.at.x), y: (b.y1 + b.y2) / 2 };
  }

  /** A point on the page as the text sees it (turned back, for turned text). */
  private local(p: Vec): Vec {
    return this.turn ? turnAbout(p, this.at, -this.turn) : p;
  }

  /** What is at a point: the text, the width handle, or nothing of this editor. */
  hit(p: Vec): 'text' | 'wrap' | null {
    if (this.closed) return null;
    p = this.local(p);
    const px = 1 / this.h.view.scale;
    const w = this.wrapHandle();
    if (Math.abs(p.x - w.x) <= 6 * px && Math.abs(p.y - w.y) <= 8 * px) return 'wrap';
    const b = this.box();
    const pad = 4 * px;
    return p.x >= b.x1 - pad && p.x <= b.x2 + pad && p.y >= b.y1 - pad && p.y <= b.y2 + pad ? 'text' : null;
  }

  /** The link under a point of the page, if any. */
  linkAt(p: Vec): string | null {
    p = this.local(p);
    return linkAtPoint(this.ed.layout(), this.ed.t.runs, p.x - this.at.x, p.y - this.at.y)?.link ?? null;
  }

  /** What to show when the mouse rests on a point: where a link goes. */
  tip(p: Vec): string {
    const link = this.linkAt(p);
    return link ? linkTip(link, true) : '';
  }

  /**
   * A press on the text (put the caret there, or select a word or paragraph) or on the handle.
   * Ctrl+click on a link follows it (true), as in Word.
   */
  pointerDown(p: Vec, shift: boolean, ctrl = false): boolean {
    const where = this.hit(p);
    if (!where) return false;
    if (ctrl && where === 'text') {
      const link = this.linkAt(p);
      if (link) { void followLink(link); return true; }
    }
    p = this.local(p);
    this.ta.focus({ preventScroll: true });
    if (where === 'wrap') { this.dragging = 'wrap'; this.wrapDragged = false; return false; }
    this.dragging = 'text';
    const now = performance.now();
    const c = this.clicks;
    const px = 1 / this.h.view.scale;
    c.n = now - c.time < 450 && Math.hypot(p.x - c.at.x, p.y - c.at.y) < 4 * px ? c.n + 1 : 1;
    c.time = now;
    c.at = p;
    const o = this.ed.offsetAt(p.x - this.at.x, p.y - this.at.y);
    if (c.n === 2) this.ed.selectWord(o);
    else if (c.n >= 3) this.ed.selectParagraph(o);
    else this.ed.setCaret(o, shift);
    return false;
  }

  // ------------------------------------------------------------------ links

  /** Insert > Link (Ctrl+K): link the selection, change the link the caret is in, or type a new one. */
  async editLink(): Promise<void> {
    if (this.closed || this.asking) return;
    const ed = this.ed;
    const here = ed.linkHere();
    const range = here && ed.collapsed ? here : { start: ed.start, end: ed.end };
    const shown = ed.text.slice(range.start, range.end);
    const places = CaptionEditor.linkPlaces?.();
    this.asking = true;
    try {
      const got = await askLink({ text: shown.includes('\n') ? null : shown, link: here?.link, places: places?.places, placeTitle: places?.title });
      if (this.closed) return;
      if (!got) return;
      if ('remove' in got) ed.removeLink();
      else ed.setLink(got.link, got.text);
    } finally {
      this.asking = false;
      if (!this.closed) this.ta.focus({ preventScroll: true });
    }
  }

  /** Copy where the link the caret is in goes. */
  private copyLink(link: string): void {
    void navigator.clipboard?.writeText(link).catch(() => {});
  }

  pointerMove(p: Vec): void {
    p = this.local(p);
    if (this.dragging === 'text' && this.clicks.n === 1) this.ed.setCaret(this.ed.offsetAt(p.x - this.at.x, p.y - this.at.y), true);
    else if (this.dragging === 'wrap') {
      this.ed.setWrap(Math.max(4, p.x - this.at.x), !this.wrapDragged);
      this.wrapDragged = true;
    }
  }

  pointerUp(): void {
    this.dragging = null;
  }

  /** The mouse pointer to show over a point. */
  cursor(p: Vec): string {
    const w = this.hit(p);
    return w === 'wrap' ? 'ew-resize' : w === 'text' ? 'text' : '';
  }

  /** Draw the text, the selection, the caret and the box (on the top layer, in document points). */
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.closed) return;
    const px = 1 / this.h.view.scale;
    const { x, y } = this.at;
    const lay = this.ed.layout();
    const b = this.box();
    // the box, and its width handle
    ctx.save();
    if (this.turn) { ctx.translate(x, y); ctx.rotate((this.turn * Math.PI) / 180); ctx.translate(-x, -y); }
    ctx.lineWidth = px;
    ctx.strokeStyle = FRAME;
    ctx.setLineDash([3 * px, 2 * px]);
    ctx.strokeRect(b.x1 - 2 * px, b.y1 - 2 * px, b.x2 - b.x1 + 4 * px, b.y2 - b.y1 + 4 * px);
    ctx.setLineDash([]);
    const w = this.wrapHandle();
    ctx.fillStyle = this.ed.t.wrap !== undefined ? FRAME : '#fff';
    ctx.fillRect(w.x - 2.5 * px, w.y - 5 * px, 5 * px, 10 * px);
    ctx.strokeRect(w.x - 2.5 * px, w.y - 5 * px, 5 * px, 10 * px);
    // selection under the text
    ctx.fillStyle = SELECTION;
    for (const r of this.ed.selectionRects()) ctx.fillRect(x + r.x1, y + r.y1, r.x2 - r.x1, r.y2 - r.y1);
    drawLayout(ctx, lay, x, y);
    if (this.ed.composing === null) {
      const c = this.checks();
      for (const [a, b] of c.spell) this.squiggle(ctx, a, b, MISSPELLED);
      for (const i of c.issues) this.squiggle(ctx, i.start, i.end, FORMATTING);
    }
    if (this.caretOn && (this.ed.collapsed || this.ed.composing !== null)) {
      const c = this.ed.caret();
      ctx.fillStyle = '#000';
      ctx.fillRect(x + c.x - 0.6 * px, y + c.y1, 1.2 * px, c.y2 - c.y1);
    }
    ctx.restore();
  }

  /** A wavy underline under the text between two places. */
  private squiggle(ctx: CanvasRenderingContext2D, a: number, b: number, color: string): void {
    const px = 1 / this.h.view.scale;
    const lay = this.ed.layout();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1 * px;
    for (const r of selectionRects(lay, a, b)) {
      const y = this.at.y + r.y2 - (r.y2 - r.y1) * 0.12;
      const step = 2 * px;
      ctx.beginPath();
      for (let x = this.at.x + r.x1, k = 0; x <= this.at.x + r.x2 + 1e-9; x += step, k++) {
        const yy = y + (k % 2 ? step * 0.6 : 0);
        if (k) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
  }

  /** Misspelled words and chemistry formatting slips (not the word being typed). */
  private checks(): { spell: [number, number][]; issues: Issue[] } {
    if (!typingPrefs.spelling) return { spell: [], issues: [] };
    const sp = this.speller;
    if (sp && this.dictSeen !== typingPrefs.dictionary) {
      sp.setPersonal(typingPrefs.dictionary);
      for (const w of ignored) sp.ignore(w);
      this.dictSeen = typingPrefs.dictionary;
      this.checked = null;
    }
    if (!this.checked || this.checked.t !== this.ed.t) {
      const text = this.ed.text;
      const looks = this.ed.looks();
      const leave = new Set([...ignored, ...typingPrefs.dictionary.map((w) => w.toLowerCase())]);
      this.checked = {
        t: this.ed.t,
        spell: sp ? sp.misspelled(text) : [],
        issues: findIssues(text, (i) => looks[i] ?? { pos: 'base', italic: false }, leave),
      };
    }
    // the word the caret is at the end of is still being typed
    const at = this.ed.collapsed ? this.ed.focus : -1;
    const typing = ([a, b]: [number, number]) => at > a && at <= b;
    return { spell: this.checked.spell.filter((s) => !typing(s)), issues: this.checked.issues.filter((i) => !typing([i.start, i.end])) };
  }

  /** Right-click on the text: suggestions for a misspelled word, or the fix for a formatting slip. */
  contextMenu(p: Vec, clientX: number, clientY: number): void {
    this.closeMenu();
    const o = this.ed.offsetAt(p.x - this.at.x, p.y - this.at.y);
    const c = this.checks();
    const near = (a: number, b: number) => o >= a && o <= b;
    const word = c.spell.find(([a, b]) => near(a, b));
    const issue = c.issues.find((i) => near(i.start, i.end));
    const link = this.linkAt(p) ?? (this.ed.collapsed ? null : this.ed.linkHere()?.link ?? null);
    if (!word && !issue && !link) return;
    const d = this.h.host.ownerDocument;
    const menu = d.createElement('div');
    menu.className = 'text-menu';
    menu.setAttribute('role', 'menu');
    const item = (label: string, on: (() => void) | null, title?: string) => {
      const b = d.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      if (title) b.title = title;
      b.disabled = !on;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { this.closeMenu(); on?.(); this.ta.focus({ preventScroll: true }); });
      menu.appendChild(b);
    };
    if (issue) {
      item(`${issue.message}: change to ${issue.fixed}`, () => this.ed.fix(issue.edits, 'fix'));
      item('Leave as written', () => { ignored.add(this.ed.text.slice(issue.start, issue.end).toLowerCase()); this.checked = null; this.h.redraw(); });
    }
    if (word) {
      if (issue) menu.appendChild(d.createElement('hr'));
      const [a, b] = word;
      const text = this.ed.text.slice(a, b);
      const sugg = this.speller?.suggestions(text) ?? [];
      for (const w of sugg) item(w, () => this.ed.fix([{ start: a, end: b, text: w }], 'spell'));
      if (!sugg.length) item('No suggestions', null);
      menu.appendChild(d.createElement('hr'));
      item('Add to Dictionary', () => setTypingPrefs({ dictionary: [...typingPrefs.dictionary, text] }), 'Accept this word from now on (Edit > Typing and Spelling lists your words)');
      item('Ignore', () => { ignored.add(text.toLowerCase()); this.speller?.ignore(text); this.checked = null; this.h.redraw(); }, 'Accept this word until the program is closed');
    }
    if (link) {
      if (word || issue) menu.appendChild(d.createElement('hr'));
      // the caret goes into the link, so the commands below act on all of it
      if (this.ed.collapsed || !this.ed.linkHere()) this.ed.setCaret(o);
      item('Edit Link…', () => void this.editLink());
      item('Open Link', () => void followLink(link));
      item('Copy Link', () => this.copyLink(link));
      item('Remove Link', () => this.ed.removeLink());
    }
    this.h.host.appendChild(menu);
    const host = this.h.host.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(clientX - host.left, host.width - mw - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY - host.top, host.height - mh - 4))}px`;
    this.menu = menu;
    d.addEventListener('pointerdown', this.closeMenuOutside, true);
  }

  private closeMenu(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.h.host.ownerDocument.removeEventListener('pointerdown', this.closeMenuOutside, true);
  }

  /** Keep the bar and the hidden text field by the text when the drawing is scrolled or zoomed. */
  place(): void {
    if (this.closed) return;
    let b = this.box();
    const a = this.h.around?.();
    if (a) b = { x1: Math.min(b.x1, a.x1), y1: Math.min(b.y1, a.y1), x2: Math.max(b.x2, a.x2), y2: Math.max(b.y2, a.y2) };
    const tl = this.h.toScreen({ x: b.x1, y: b.y1 }), br = this.h.toScreen({ x: b.x2, y: b.y2 });
    // the hidden field sits at the caret, so an input method's word list shows there
    const c = this.ed.caret();
    const cp = this.h.toScreen({ x: this.at.x + c.x, y: this.at.y + c.y1 });
    const ts = this.ta.style;
    ts.left = `${cp.x}px`;
    ts.top = `${cp.y}px`;
    ts.height = `${Math.max(8, (c.y2 - c.y1) * this.h.view.scale)}px`;
    if (CaptionEditor.barPlace !== 'floating') return;
    // the bar sits above the text, or below it near the top of the window
    const hb = this.bar.offsetHeight || 32;
    const below = tl.y - hb - 8 < 0;
    const left = Math.max(4, Math.min(tl.x, this.h.host.clientWidth - (this.bar.offsetWidth || 420) - 4));
    this.bar.style.left = `${left}px`;
    this.bar.style.top = `${below ? br.y + 8 : tl.y - hb - 8}px`;
  }

  /** Where the bar goes (View > Text Formatting Bar). */
  static barPlace: 'docked' | 'floating' | 'hidden' = 'docked';

  /** Called whenever the text or the selection changes (the Slides ribbon shows how it looks). */
  static onState: (() => void) | null = null;

  /** Put the keyboard back in the text (after a ribbon button or box). */
  focusText(): void {
    if (!this.closed) this.ta.focus({ preventScroll: true });
  }

  /** Stop editing and hand back the text. */
  finish(): void {
    if (this.closed) return;
    // the last word gets its chemistry formatting (CH2Cl2 typed in a table cell, then Tab)
    finishWord(this.ed);
    this.closed = true;
    this.closeMenu();
    if (this.blink) clearInterval(this.blink);
    this.ta.remove();
    this.bar.remove();
    const r = this.ed.result();
    let x = this.at.x;
    // a centred or right-aligned caption without a text box keeps its centre or right end
    if (r.wrap === undefined && r.width !== undefined) {
      const free = { ...r, width: undefined };
      const widest = layoutText(free, this.h.defaultSize, this.h.measure).boxWidth;
      if (r.justify === 'center') x += (r.width - widest) / 2;
      else if (r.justify === 'right') x += r.width - widest;
      r.width = r.justify === 'left' ? undefined : widest;
    }
    this.done({ ...r, x, y: this.at.y });
    this.h.redraw();
  }

  // ------------------------------------------------------------------ changes

  private changed(kind: 'text' | 'selection'): void {
    if (this.closed) return;
    this.caretOn = true;
    if (kind === 'text' || !this.ed.composing) this.syncInput();
    if (kind === 'text') this.h.typed?.(this.ed.t);
    this.updateBar();
    this.place();
    this.h.redraw();
    CaptionEditor.onState?.();
  }

  /**
   * Keep the selected text in the hidden field, selected, so the system's copy, screen readers
   * and input methods see what is selected here.
   */
  private syncInput(): void {
    if (this.ed.composing !== null) return;
    const sel = this.ed.collapsed ? '' : richToPlain(this.ed.selected());
    if (this.ta.value !== sel) this.ta.value = sel;
    this.ta.setSelectionRange(0, sel.length);
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (this.menu && e.key === 'Escape') { e.preventDefault(); this.closeMenu(); return; }
    this.closeMenu();
    if (this.h.keys?.(e)) { e.preventDefault(); return; }
    const ed = this.ed;
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    const run = (f: () => void) => { e.preventDefault(); f(); };
    if (e.key === 'Escape' || (e.key === 'Enter' && ctrl)) return run(() => this.finish());
    // styling keys come from the key map (Edit > Hotkeys), so they can be changed
    const chord = chordOf(e);
    const action = chord ? keymap.lookup('text', chord) : undefined;
    if (action && parseAction(action).arg === 'link') return run(() => void this.editLink());
    if (action) return run(() => ed.toggle(parseAction(action).arg as rt.Toggle));
    const shift = e.shiftKey;
    const word = isMac ? e.altKey : e.ctrlKey;
    const moves: Record<string, Move> = isMac && e.metaKey
      ? { ArrowLeft: 'lineStart', ArrowRight: 'lineEnd', ArrowUp: 'textStart', ArrowDown: 'textEnd' }
      : { ArrowLeft: word ? 'wordLeft' : 'left', ArrowRight: word ? 'wordRight' : 'right', ArrowUp: 'up', ArrowDown: 'down', Home: e.ctrlKey ? 'textStart' : 'lineStart', End: e.ctrlKey ? 'textEnd' : 'lineEnd' };
    if (moves[e.key]) return run(() => ed.move(moves[e.key], shift));
    switch (e.key) {
      case 'Enter': return run(() => ed.enter(shift));
      case 'Backspace': return run(() => ed.backspace(word));
      case 'Delete': return run(() => ed.deleteForward(word));
      case 'Tab': return run(() => ed.indent(shift ? -1 : 1));
    }
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !shift) run(() => ed.undo());
    else if (k === 'y' || (k === 'z' && shift)) run(() => ed.redo());
    else if (k === 'a') run(() => ed.selectAll());
    // Ctrl+Shift+V pastes the text without its styles
    else if (k === 'v' && shift) this.plainPaste = true;
  }

  private beforeInput(e: InputEvent): void {
    if (e.isComposing) return;
    const t = e.inputType;
    const ed = this.ed;
    if (t === 'insertCompositionText') return;
    e.preventDefault();
    if (t === 'insertText' || t === 'insertReplacementText') { if (e.data) ed.type(e.data); }
    else if (t === 'insertLineBreak' || t === 'insertParagraph') ed.enter(t === 'insertLineBreak');
    else if (t === 'deleteContentBackward') ed.backspace();
    else if (t === 'deleteContentForward') ed.deleteForward();
    else if (t === 'deleteWordBackward') ed.backspace(true);
    else if (t === 'deleteWordForward') ed.deleteForward(true);
    else if (t === 'historyUndo') ed.undo();
    else if (t === 'historyRedo') ed.redo();
    else if (t.startsWith('format')) {
      const f = ({ formatBold: 'bold', formatItalic: 'italic', formatUnderline: 'underline', formatSubscript: 'sub', formatSuperscript: 'sup' } as Record<string, rt.Toggle>)[t];
      if (f) ed.toggle(f);
    }
    // pasting and dropping arrive as their own events
  }

  /** Typing a browser didn't announce first (older ones): the field holds what was typed. */
  private onInput(): void {
    if (this.ed.composing !== null) return;
    const v = this.ta.value;
    const sel = this.ed.collapsed ? '' : richToPlain(this.ed.selected());
    if (v !== sel) this.ed.type(v);
    this.syncInput();
  }

  private copy(e: ClipboardEvent, cut: boolean): void {
    e.preventDefault();
    if (this.ed.collapsed || !e.clipboardData) return;
    const sel = this.ed.selected();
    e.clipboardData.setData('text/plain', richToPlain(sel));
    e.clipboardData.setData('text/html', richToHtml(sel, { justify: this.ed.t.justify, defaultSize: this.h.defaultSize }));
    if (cut) this.ed.replaceSelection([], undefined, 'cut');
  }

  private paste(e: ClipboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const plain = this.plainPaste;
    this.plainPaste = false;
    const data = e.clipboardData;
    if (!data) return;
    const html = plain ? '' : data.getData('text/html');
    const rich = html ? htmlToRich(html) : null;
    if (rich) {
      // pasted text takes the font and size of the text it goes into, unless it brings its own
      const base = this.ed.typingStyle();
      const runs = rich.runs.map((r) => ({ ...r, size: r.size ?? base.size, ...(r.font || !base.font ? {} : { font: base.font }) }));
      this.ed.replaceSelection(rt.normalizeRuns(runs), rich.paras.length > 1 ? rich.paras : undefined);
      return;
    }
    const text = data.getData('text/plain');
    if (text) this.ed.pastePlain(text);
  }

  // ------------------------------------------------------------------ the bar

  private buildBar(): void {
    const d = this.h.host.ownerDocument;
    const ed = this.ed;
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
      b.addEventListener('click', () => { on(); this.ta.focus({ preventScroll: true }); });
      g.appendChild(b);
      this.buttons.set(id, b);
      return b;
    };
    const number = (g: HTMLElement, id: keyof CaptionEditor['inputs'], title: string, opts: { min: number; max: number; step: number; list?: number[]; cls: string; blank?: string }, apply: (v: number | null) => void) => {
      const input = d.createElement('input');
      input.type = 'number';
      input.min = String(opts.min);
      input.max = String(opts.max);
      input.step = String(opts.step);
      input.className = opts.cls;
      input.title = title;
      input.setAttribute('aria-label', title);
      if (opts.blank) input.placeholder = opts.blank;
      if (opts.list) {
        const list = d.createElement('datalist');
        list.id = `cb-${id}-${Math.random().toString(36).slice(2)}`;
        for (const v of opts.list) { const o = d.createElement('option'); o.value = String(v); list.appendChild(o); }
        input.setAttribute('list', list.id);
        g.appendChild(list);
      }
      const go = () => {
        const v = input.value.trim() === '' ? null : Number(input.value);
        if (v === null || (Number.isFinite(v) && v >= opts.min)) apply(v === null ? null : Math.min(opts.max, v));
      };
      input.addEventListener('change', go);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); go(); this.ta.focus({ preventScroll: true }); }
        if (e.key === 'Escape') { e.preventDefault(); this.ta.focus({ preventScroll: true }); }
      });
      g.appendChild(input);
      this.inputs[id] = input;
      return input;
    };
    const svg = (body: string) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${body}</svg>`;

    let g = group();
    button(g, 'bold', '<b>B</b>', 'Bold (Ctrl+B)', () => ed.toggle('bold'));
    button(g, 'italic', '<i>I</i>', 'Italic (Ctrl+I)', () => ed.toggle('italic'));
    button(g, 'underline', '<u>U</u>', 'Underline (Ctrl+U)', () => ed.toggle('underline'));
    g = group();
    button(g, 'sub', 'x<sub>2</sub>', 'Subscript (Ctrl+=)', () => ed.toggle('sub'));
    button(g, 'sup', 'x<sup>2</sup>', 'Superscript (Ctrl+Shift+=)', () => ed.toggle('sup'));
    button(g, 'formula', 'CH<sub>3</sub>', 'Formula: numbers after letters go down, charges go up', () => ed.toggle('formula'));

    g = group();
    const font = d.createElement('input');
    font.type = 'text';
    font.className = 'cb-font font-box';
    font.title = 'Font: free fonts that come with the app, or any font on this computer';
    font.setAttribute('aria-label', 'Font');
    font.setAttribute('list', 'ci-fonts');
    font.spellcheck = false;
    const setFont = () => { const v = font.value.trim(); ed.setStyle({ font: v && v !== this.h.defaultFont ? v : undefined }); };
    font.addEventListener('change', setFont);
    font.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); setFont(); this.ta.focus({ preventScroll: true }); }
      if (e.key === 'Escape') { e.preventDefault(); this.ta.focus({ preventScroll: true }); }
    });
    g.appendChild(font);
    this.inputs.font = font;
    number(g, 'size', 'Text size (points)', { min: 1, max: 400, step: 0.5, list: SIZES, cls: 'cb-size' }, (v) => { if (v) ed.setStyle({ size: v }); });
    const color = d.createElement('input');
    color.type = 'color';
    color.className = 'cb-color';
    color.title = 'Text colour';
    color.setAttribute('aria-label', 'Text colour');
    color.addEventListener('change', () => { ed.setStyle({ color: color.value.toLowerCase() === '#000000' ? undefined : color.value }); this.ta.focus({ preventScroll: true }); });
    g.appendChild(color);
    this.inputs.color = color;

    g = group();
    const lineIcon = (j: string) => {
      const rows = [14, 9, 14, 9].map((w0, i) => {
        const w = j === 'justify' ? 14 : w0;
        const left = j === 'left' || j === 'justify' ? 0 : j === 'center' ? (14 - w) / 2 : 14 - w;
        return `<rect x="${left + 1}" y="${2 + i * 3.5}" width="${w}" height="1.6"/>`;
      });
      return svg(rows.join(''));
    };
    button(g, 'left', lineIcon('left'), 'Line up on the left', () => ed.align('left'));
    button(g, 'center', lineIcon('center'), 'Centre the lines', () => ed.align('center'));
    button(g, 'right', lineIcon('right'), 'Line up on the right', () => ed.align('right'));
    button(g, 'justify', lineIcon('justify'), 'Stretch lines to both edges of the text box', () => ed.align('justify'));

    g = group();
    const listIcon = (marks: string[]) => svg(marks.map((m, i) => `${m.replace(/Y/g, String(3 + i * 5))}<rect x="6" y="${2 + i * 5}" width="9" height="1.6"/>`).join(''));
    button(g, 'bullet', listIcon(['<circle cx="2.5" cy="Y" r="1.4"/>', '<circle cx="2.5" cy="Y" r="1.4"/>', '<circle cx="2.5" cy="Y" r="1.4"/>']),
      'Bullets', () => ed.list('bullet'));
    button(g, 'number', svg('<text x="0" y="5" font-size="5.5" font-family="Arial">1</text><text x="0" y="10" font-size="5.5" font-family="Arial">2</text><text x="0" y="15" font-size="5.5" font-family="Arial">3</text><rect x="6" y="2" width="9" height="1.6"/><rect x="6" y="7" width="9" height="1.6"/><rect x="6" y="12" width="9" height="1.6"/>'),
      'Numbering', () => ed.list('number'));
    button(g, 'outdent', svg('<rect x="1" y="2" width="14" height="1.6"/><rect x="7" y="6" width="8" height="1.6"/><rect x="7" y="10" width="8" height="1.6"/><rect x="1" y="14" width="14" height="1.6"/><path d="M5 6.5v4.5L1.5 8.75z"/>'),
      'Less indent (Shift+Tab)', () => ed.indent(-1));
    button(g, 'indent', svg('<rect x="1" y="2" width="14" height="1.6"/><rect x="7" y="6" width="8" height="1.6"/><rect x="7" y="10" width="8" height="1.6"/><rect x="1" y="14" width="14" height="1.6"/><path d="M1.5 6.5v4.5L5 8.75z"/>'),
      'More indent (Tab)', () => ed.indent(1));
    button(g, 'spacing', svg('<rect x="7" y="2" width="8" height="1.6"/><rect x="7" y="7.2" width="8" height="1.6"/><rect x="7" y="12.4" width="8" height="1.6"/><path d="M3 1l2.5 3h-5zM3 15l2.5-3h-5z"/><rect x="2.4" y="3.5" width="1.2" height="9"/>'),
      'Line and paragraph spacing, text box width', () => { this.spacing.hidden = !this.spacing.hidden; this.symbols.hidden = true; this.updateBar(); this.place(); });

    g = group();
    button(g, 'link', svg('<path d="M6.6 9.4a.8.8 0 0 1 0-1.1l1.7-1.7a.8.8 0 1 1 1.1 1.1L7.7 9.4a.8.8 0 0 1-1.1 0z"/><path d="M8.9 3.2a3 3 0 0 1 4.2 4.2l-1.6 1.6a.8.8 0 1 1-1.1-1.1L12 6.3a1.4 1.4 0 0 0-2-2L8.4 5.9a.8.8 0 1 1-1.1-1.1zM4 9.7l1.6-1.6a.8.8 0 1 1 1.1 1.1L5.1 10.8a1.4 1.4 0 0 0 2 2l1.6-1.6a.8.8 0 1 1 1.1 1.1l-1.6 1.6a3 3 0 0 1-4.2-4.2z"/>'),
      'Link to a web page, DOI, file or slide (Ctrl+K)', () => void this.editLink());
    button(g, 'symbols', 'αΩ', 'Greek letters and symbols', () => { this.symbols.hidden = !this.symbols.hidden; this.spacing.hidden = true; this.updateBar(); this.place(); });
    for (const row of SYMBOLS) {
      const r = d.createElement('div');
      r.className = 'cs-row';
      for (const ch of row) {
        const b = d.createElement('button');
        b.type = 'button';
        b.textContent = ch;
        b.title = `Insert ${ch}`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { ed.type(ch); this.ta.focus({ preventScroll: true }); });
        r.appendChild(b);
      }
      this.symbols.appendChild(r);
    }

    // the spacing panel: every value here can be typed in
    const row = (label: string) => {
      const l = d.createElement('label');
      l.className = 'csp-row';
      const s = d.createElement('span');
      s.textContent = label;
      l.appendChild(s);
      this.spacing.appendChild(l);
      return l;
    };
    number(row('Line spacing'), 'line', 'Line spacing (1 = single)', { min: 0.5, max: 10, step: 0.05, list: SPACINGS, cls: 'cb-num' }, (v) => ed.lineSpacing(v ?? 1));
    number(row('Space before (pt)'), 'before', 'Space before the selected paragraphs, in points', { min: 0, max: 200, step: 1, cls: 'cb-num' }, (v) => ed.paraSpacing({ spaceBefore: v ?? 0 }));
    number(row('Space after (pt)'), 'after', 'Space after the selected paragraphs, in points', { min: 0, max: 200, step: 1, cls: 'cb-num' }, (v) => ed.paraSpacing({ spaceAfter: v ?? 0 }));
    number(row('Box width (pt)'), 'wrap', 'Width the lines wrap to, in points (blank: lines break only where you press Enter)', { min: 4, max: 5000, step: 1, cls: 'cb-num', blank: 'none' }, (v) => ed.setWrap(v ?? undefined));
    this.bar.append(this.symbols, this.spacing);

    const hint = d.createElement('span');
    hint.className = 'cb-hint';
    hint.textContent = this.h.hint ?? 'Enter: new paragraph · Tab: indent · Esc: done';
    this.bar.appendChild(hint);
  }

  private updateBar(): void {
    if (this.closed) return;
    const ed = this.ed;
    const s = ed.currentStyle();
    for (const k of ['bold', 'italic', 'underline', 'sub', 'sup', 'formula'] as const) this.press(k, !!s[k]);
    this.press('link', !!ed.linkHere());
    const align = ed.currentAlign();
    for (const j of ['left', 'center', 'right', 'justify'] as const) this.press(j, align === j);
    const p = ed.currentPara();
    this.press('bullet', p.list === 'bullet');
    this.press('number', p.list === 'number');
    this.press('symbols', !this.symbols.hidden);
    this.press('spacing', !this.spacing.hidden);
    const active = this.h.host.ownerDocument.activeElement;
    const show = (k: keyof CaptionEditor['inputs'], v: string) => { if (active !== this.inputs[k]) this.inputs[k].value = v; };
    const r2 = (v: number) => String(Math.round(v * 100) / 100);
    show('font', s.font ?? '');
    this.inputs.font.placeholder = s.font === undefined ? this.h.defaultFont ?? 'Font' : '';
    show('size', s.size !== undefined ? r2(s.size) : '');
    this.inputs.size.placeholder = s.size === undefined ? '—' : '';
    show('color', s.color ?? '#000000');
    show('line', r2(ed.t.lineSpacing ?? 1));
    show('before', r2(p.spaceBefore ?? 0));
    show('after', r2(p.spaceAfter ?? 0));
    show('wrap', ed.t.wrap !== undefined ? r2(ed.t.wrap) : '');
  }

  private press(id: string, on: boolean): void {
    const b = this.buttons.get(id);
    if (!b) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
