// Document mode: pages of text to type into, with Word's ribbon, keys and styles, and the
// chemistry: structures drawn with the drawing tools sit in the text, captions number
// themselves, references follow them, formulas format themselves as they are typed, and the
// spelling check knows chemistry words. The panel on the right shows the paragraph's formatting,
// its style, the page and the figure picked, every value of which can be typed in.

import type { Contents, ParaStyle, TextRun } from '../model';
import type { DocStyle } from '../style';
import type { Tab } from '../workspace';
import type { Measure } from '../text/layout';
import { keymap, chordOf, parseAction, type KeyContext } from '../editor/keymap';
import * as rt from '../richtext';
import type { Move } from '../text/editing';
import { offsetAt, caretPos } from '../text/layout';
import { htmlToRich, richToHtml, richToPlain } from '../text/html';
import { afterTyping, typingPrefs, setTypingPrefs } from '../text/typing';
import { findIssues, type CharLook, type Issue } from '../text/chemtext';
import { loadSpeller, type Speller } from '../text/spelling';
import { paraAt, paraRange, splitParagraphs } from '../text/paragraphs';
import { DocView, ACTUAL, type Overlay } from './doc-view';
import { DocPanel, DOC_FONTS } from './doc-panel';
import { DocFind } from './doc-find';
import { ask } from './ask';
import { dataUrl, imageSize } from '../render/images';
import type { DocFile } from '../document/doc-file';
import {
  A4, COMPOUND, INCH, LETTER, OBJECT_CHAR, CAPTION_NAMES, captionRuns, nextObjectId, objectRun, runStyleOf, setParaStyle, styleOf, fieldTexts, objectOffsets,
  type DocObject, type DocText, type NumberPlace, type PageSetup,
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

/** Our own copy of document text, figures and all, for pasting back into a document. */
const OWN_KIND = 'chem-illustrator-document';

export class DocumentMode {
  readonly view: DocView;
  tab: Tab | null = null;
  private ta: HTMLTextAreaElement;
  private panel: DocPanel;
  private ribbon: HTMLElement;
  private caretOn = true;
  private blink: ReturnType<typeof setInterval> | null = null;
  private clicks = { n: 0, time: 0, at: { x: 0, y: 0 } };
  private dragging: { kind: 'text' } | { kind: 'resize'; id: number; w0: number; scale0: number; x0: number } | null = null;
  private plainPaste = false;
  private speller: Speller | null = null;
  private dictSeen: string[] | null = null;
  private checkCache = new Map<string, { spell: [number, number][]; issues: Issue[] }>();
  private checked: { t: DocText; spell: [number, number][]; issues: Issue[] } | null = null;
  private menu: HTMLDivElement | null = null;
  private finder: DocFind;
  /** The last copy made here: pasting the same text back brings its figures and fields too. */
  private clip: { text: string; runs: TextRun[]; paras: ParaStyle[]; objects: Record<number, DocObject> } | null = null;
  private readonly closeMenuOutside = (e: Event) => { if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu(); };

  constructor(private host: DocModeHost) {
    const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
    const docHost = $<HTMLDivElement>('#doc-host');
    this.view = new DocView(docHost);
    this.view.overlay = () => this.overlay();
    this.view.onMove = () => { this.placeInput(); this.showZoom(); };
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
      redraw: () => this.view.redraw(),
    });
    this.panel = new DocPanel($('#doc-body'), {
      file: () => this.file,
      run: (cmd) => this.run(cmd),
      focus: () => this.focus(),
      editFigure: (id) => this.editFigure(id),
      picked: () => this.pickedObject(),
      setScale: (id, k) => this.setScale(id, k),
    });
    this.wireInput();
    this.wirePointer();
    this.wireRibbon();
    if (typingPrefs.spelling) void loadSpeller().then((sp) => { this.speller = sp; this.checked = null; this.view.redraw(); });
  }

  get file(): DocFile | null {
    return this.tab?.document ?? null;
  }

  private get ed() {
    return this.file!.ed;
  }

  // ---------------------------------------------------------------- showing a tab

  /** A document tab came to the front (or null: another kind of tab). */
  show(tab: Tab | null): void {
    if (this.tab && this.tab !== tab) this.leave();
    this.tab = tab;
    const f = tab?.document ?? null;
    this.view.file = f;
    if (!f) {
      if (this.blink) { clearInterval(this.blink); this.blink = null; }
      return;
    }
    f.listener = (kind) => this.changed(kind);
    // chemistry as it's typed: CH2Cl2 becomes a formula, -> an arrow… (Edit > Typing and Spelling)
    f.ed.onTyped = (typed) => afterTyping(f.ed, typed);
    this.view.resize();
    const st = tab!.sheetState as { zoom: number; top: number; left: number } | null;
    if (st) {
      this.view.zoom = st.zoom;
      this.view.sizeSpace();
      this.view.scroller.scrollTop = st.top;
      this.view.scroller.scrollLeft = st.left;
    } else if (this.view.scroller.clientWidth < f.layout().pageW * ACTUAL + 48) this.view.fitWidth();
    else this.view.setZoom(ACTUAL);
    this.blink ??= setInterval(() => { this.caretOn = !this.caretOn; this.view.redraw(); }, 530);
    this.changed('selection');
    requestAnimationFrame(() => this.focus());
  }

  /** Before another tab shows: keep the zoom and scroll. */
  leave(): void {
    const t = this.tab;
    if (!t?.document) return;
    t.sheetState = { zoom: this.view.zoom, top: this.view.scroller.scrollTop, left: this.view.scroller.scrollLeft };
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
    this.view.sizeSpace();
    this.view.redraw();
  }

  // ---------------------------------------------------------------- changes

  private changed(kind: 'text' | 'selection'): void {
    const f = this.file;
    if (!f) return;
    this.caretOn = true;
    if (kind === 'text') {
      this.view.sizeSpace();
      this.host.changed();
      if (this.finder.open) this.finder.refresh();
    } else if (this.finder.open) this.finder.showCount();
    if (kind === 'text' || !this.ed.composing) this.syncInput();
    this.revealCaret();
    this.placeInput();
    this.updateRibbon();
    this.panel.update();
    this.view.redraw();
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
    const ed = f.ed;
    if (ed.end - ed.start !== 1) return null;
    const runs = rt.sliceRuns(ed.t.runs, ed.start, ed.end);
    const id = runs[0]?.obj;
    const o = id !== undefined ? f.t.objects[id] : undefined;
    return o && (o.kind === 'drawing' || o.kind === 'picture') ? id! : null;
  }

  private overlay(): Overlay {
    const f = this.file;
    if (!f) return { selection: null, caret: null, squiggles: [], picked: null, found: [] };
    const ed = f.ed;
    const picked = this.pickedObject();
    const showCaret = this.caretOn && (ed.collapsed || ed.composing !== null) && document.activeElement === this.ta;
    const c = showCaret ? ed.caret() : null;
    const squiggles: Overlay['squiggles'] = [];
    if (ed.composing === null && typingPrefs.spelling) {
      const ch = this.checks();
      for (const [a, b] of ch.spell) squiggles.push({ start: a, end: b, color: SELECTION_SQUIGGLE });
      for (const i of ch.issues) squiggles.push({ start: i.start, end: i.end, color: FORMATTING });
    }
    return {
      selection: !ed.collapsed && picked === null && !ed.composing ? [ed.start, ed.end] : null,
      caret: c,
      squiggles,
      picked,
      found: this.finder.open ? this.finder.hits : [],
    };
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
    if (!word && !issue) return false;
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
      item('Leave as written', () => { ignored.add(ed.text.slice(issue.start, issue.end).toLowerCase()); this.checkCache.clear(); this.checked = null; this.view.redraw(); });
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
      item('Ignore', () => { ignored.add(text.toLowerCase()); this.speller?.ignore(text); this.checkCache.clear(); this.checked = null; this.view.redraw(); }, 'Accept this word until the program is closed');
    }
    const host = this.view.host;
    host.appendChild(menu);
    const r = host.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(clientX - r.left, r.width - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY - r.top, r.height - menu.offsetHeight - 4))}px`;
    this.menu = menu;
    document.addEventListener('pointerdown', this.closeMenuOutside, true);
    return true;
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
    ta.addEventListener('cut', (e) => this.copy(e, true));
    ta.addEventListener('paste', (e) => { void this.paste(e); });
    ta.addEventListener('focus', () => this.view.redraw());
    ta.addEventListener('blur', () => this.view.redraw());
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
      if (action) return run(() => ed.toggle(parseAction(action).arg as rt.Toggle));
    }
    const shift = e.shiftKey;
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    const word = isMac ? e.altKey : e.ctrlKey;
    const moves: Record<string, Move> = isMac && e.metaKey
      ? { ArrowLeft: 'lineStart', ArrowRight: 'lineEnd', ArrowUp: 'textStart', ArrowDown: 'textEnd' }
      : { ArrowLeft: word ? 'wordLeft' : 'left', ArrowRight: word ? 'wordRight' : 'right', ArrowUp: 'up', ArrowDown: 'down', Home: e.ctrlKey ? 'textStart' : 'lineStart', End: e.ctrlKey ? 'textEnd' : 'lineEnd' };
    if (moves[e.key] && !e.altKey) return run(() => ed.move(moves[e.key], shift));
    if (e.key === 'PageDown' || e.key === 'PageUp') return run(() => this.pageMove(e.key === 'PageDown' ? 1 : -1, shift));
    if (!ctrl && !e.altKey) {
      switch (e.key) {
        case 'Enter': return run(() => this.enter(shift));
        case 'Backspace': return run(() => ed.backspace(word));
        case 'Delete': return run(() => ed.deleteForward(word));
        case 'Tab': return run(() => ed.indent(shift ? -1 : 1));
        case 'Escape': return run(() => { if (!ed.collapsed) ed.setCaret(ed.focus); });
      }
    }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !shift) return run(() => ed.undo());
      if (k === 'y' || (k === 'z' && shift)) return run(() => ed.redo());
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
    else if (t === 'historyUndo') ed.undo();
    else if (t === 'historyRedo') ed.redo();
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
    if (!f || f.ed.collapsed || !e.clipboardData) return;
    const ed = f.ed;
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
    for (const r of sel.runs) if (r.obj !== undefined && f.t.objects[r.obj]) objects[r.obj] = f.t.objects[r.obj];
    this.clip = { text: plain, runs: sel.runs, paras: sel.paras, objects };
    try { e.clipboardData.setData('application/x-' + OWN_KIND, JSON.stringify({ runs: sel.runs, paras: sel.paras, objects })); } catch { /* not every browser allows own types */ }
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
    let own: { runs: TextRun[]; paras: ParaStyle[]; objects: Record<number, DocObject> } | null = null;
    try {
      const j = e?.clipboardData?.getData('application/x-' + OWN_KIND);
      if (j) own = JSON.parse(j);
    } catch { own = null; }
    const html = e?.clipboardData?.getData('text/html') ?? '';
    const text0 = e?.clipboardData?.getData('text/plain') ?? '';
    if (!own && this.clip && text0 && text0.replace(/\r\n?/g, '\n') === this.clip.text) own = this.clip;
    if (own && !plain) { this.pasteOwn(own); return; }
    const got = await this.host.readPaste(e);
    const ed = f.ed;
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
  private pasteOwn(own: { runs: TextRun[]; paras: ParaStyle[]; objects: Record<number, DocObject> }): void {
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
    for (const [, id] of ids) {
      const o = objects[id];
      if (o.kind === 'ref' && ids.has(o.target)) objects[id] = { ...o, target: ids.get(o.target)! };
    }
    const runs = own.runs.map((r) => (r.obj !== undefined ? { ...r, obj: ids.get(r.obj) } : r)).filter((r) => r.obj !== undefined || !r.text.includes(OBJECT_CHAR));
    const ed = f.ed;
    ed.update({ ...f.t, objects } as DocText, 'paste');
    ed.replaceSelection(runs, own.paras.length > 1 ? own.paras : undefined);
  }

  // ---------------------------------------------------------------- the mouse

  private wirePointer(): void {
    const s = this.view.scroller;
    s.addEventListener('pointerdown', (e) => this.pointerDown(e));
    s.addEventListener('pointermove', (e) => this.pointerMove(e));
    s.addEventListener('pointerup', (e) => { this.dragging = null; try { s.releasePointerCapture(e.pointerId); } catch { /* not captured */ } });
    s.addEventListener('dblclick', (e) => {
      const id = this.objectAt(e.clientX, e.clientY);
      if (id !== null) { e.preventDefault(); this.editFigure(id); }
    });
    s.addEventListener('contextmenu', (e) => {
      if (!this.file) return;
      const p = this.view.toDoc(e.clientX, e.clientY);
      const o = offsetAt(this.file.layout().text, p.x, p.y);
      if (this.contextMenu(o, e.clientX, e.clientY)) e.preventDefault();
    });
  }

  /** The figure or picture under a point (client coordinates). */
  private objectAt(clientX: number, clientY: number): number | null {
    if (!this.file) return null;
    const p = this.view.toDoc(clientX, clientY);
    for (const o of this.file.layout().objects) if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h) return o.id;
    return null;
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
    const ed = f.ed;
    // the picked figure's corner handle resizes it
    const picked = this.pickedObject();
    if (picked !== null) {
      const o = f.layout().objects.find((x) => x.id === picked);
      const hs = 8 / this.view.zoom;
      if (o && Math.abs(p.x - (o.x + o.w)) <= hs && Math.abs(p.y - (o.y + o.h)) <= hs) {
        const obj = f.t.objects[picked];
        const scale0 = obj.kind === 'drawing' || obj.kind === 'picture' ? obj.scale ?? 1 : 1;
        this.dragging = { kind: 'resize', id: picked, w0: o.w, scale0, x0: o.x };
        s.setPointerCapture(e.pointerId);
        return;
      }
    }
    const id = this.objectAt(e.clientX, e.clientY);
    if (id !== null && !e.shiftKey) {
      const at = objectOffsets(f.t.runs).get(id);
      if (at !== undefined) { ed.select(at, at + 1); return; }
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
      this.view.scroller.style.cursor = id !== null ? 'default' : 'text';
      return;
    }
    const p = this.view.toDoc(e.clientX, e.clientY);
    if (d.kind === 'resize') {
      const w = Math.max(12, p.x - d.x0);
      this.setScale(d.id, Math.max(0.05, d.scale0 * (w / d.w0)), false);
      return;
    }
    if (this.clicks.n !== 1) return;
    // dragging past the top or bottom scrolls
    const r = this.view.scroller.getBoundingClientRect();
    if (e.clientY < r.top + 10) this.view.scroller.scrollTop -= 20;
    else if (e.clientY > r.bottom - 10) this.view.scroller.scrollTop += 20;
    f.ed.setCaret(offsetAt(f.layout().text, p.x, p.y), true);
  }

  // ---------------------------------------------------------------- figures

  /** Put an object into the text at the caret (in place of the selection), and pick it. */
  insertObject(o: DocObject, kind = 'Insert', look: Partial<rt.RunStyle> = {}): number {
    const f = this.file!;
    const ed = f.ed;
    const id = nextObjectId(f.t);
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: o } } as DocText, kind);
    const style = { ...ed.typingStyle(), ...look };
    const at = ed.start;
    ed.replace(ed.start, ed.end, [objectRun(id, style)], undefined, kind);
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

  /** Open a figure in the drawing tools; the document gets the changed drawing on Done. */
  editFigure(id: number): void {
    const f = this.file;
    const o = f?.t.objects[id];
    if (!f || !o || o.kind !== 'drawing') return;
    this.host.editDrawing(o.contents, 'Figure', (c) => {
      if (!c || this.file !== f) { this.focus(); return; }
      const cur = f.t.objects[id];
      if (cur?.kind !== 'drawing') return;
      f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...cur, contents: c } } } as DocText, 'Edit figure');
      this.focus();
    });
  }

  /** Make a figure or picture bigger or smaller (1 is its own size). */
  setScale(id: number, scale: number, record = true): void {
    const f = this.file!;
    const o = f.t.objects[id];
    if (!o || (o.kind !== 'drawing' && o.kind !== 'picture')) return;
    const next: DocObject = { ...o, scale: Math.abs(scale - 1) < 1e-6 ? undefined : scale };
    f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: next } } as DocText, record ? 'Resize' : null);
  }

  // ---------------------------------------------------------------- commands

  /** Run a command from the ribbon, the menus or a key. False when it doesn't apply here. */
  run(cmd: string): boolean {
    const f = this.file;
    if (!f) return false;
    const ed = f.ed;
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
      case 'doc-bullets': ed.list('bullet'); break;
      case 'doc-numbering': ed.list('number'); break;
      case 'doc-indent': ed.indent(1); break;
      case 'doc-outdent': ed.indent(-1); break;
      case 'page-break': this.pageBreak(); break;
      case 'select-all': ed.selectAll(); break;
      case 'undo': ed.undo(); break;
      case 'redo': ed.redo(); break;
      case 'insert-structure': this.drawNew(); break;
      case 'structure-from-name-doc': case 'name-to-structure': void this.fromName(); break;
      case 'insert-picture': void this.insertPicture(); break;
      case 'insert-table': void this.insertTable(); break;
      case 'insert-caption': void this.insertCaption(); break;
      case 'cross-reference': void this.crossReference(); break;
      case 'compound-number': void this.compoundNumber(); break;
      case 'edit-figure': { const id = this.pickedObject(); if (id === null) { this.host.flash('Click a structure or scheme first, then Edit Drawing (or double-click it).'); break; } this.editFigure(id); break; }
      case 'zoom-in': this.view.setZoom(this.view.zoom * 1.25); this.showZoom(); break;
      case 'zoom-out': this.view.setZoom(this.view.zoom * 0.8); this.showZoom(); break;
      case 'zoom-fit': this.view.fitWidth(); this.showZoom(); break;
      case 'zoom-actual': this.view.setZoom(ACTUAL); this.showZoom(); break;
      case 'find': case 'replace': this.find(cmd === 'replace'); return true;
      case 'paste': void this.paste(null); break;
      case 'copy': case 'cut': this.focus(); document.execCommand(cmd); break;
      case 'numbers-s': {
        const s = f.t.hf.prefix === 'S';
        ed.update({ ...f.t, hf: { ...f.t.hf, prefix: s ? '' : 'S', numbers: f.t.hf.numbers === 'none' ? 'footer-center' : f.t.hf.numbers } } as DocText, 'Page numbers');
        break;
      }
      default: {
        const m = /^(margins|paper|orient|numbers)-(.+)$/.exec(cmd);
        if (!m || !this.layoutCommand(m[1], m[2])) return false;
      }
    }
    this.focus();
    return true;
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

  /** Layout tab: margins, paper, orientation and page numbers. */
  private layoutCommand(what: string, v: string): boolean {
    const f = this.file!;
    const t = f.t;
    const page = (p: Partial<PageSetup>) => f.ed.update({ ...t, page: { ...t.page, ...p } } as DocText, 'Page setup');
    const land = t.page.w > t.page.h;
    if (what === 'margins') {
      const m: Record<string, [number, number]> = { normal: [1, 1], narrow: [0.5, 0.5], moderate: [1, 0.75], wide: [1, 2] };
      if (!m[v]) return false;
      page({ top: m[v][0] * INCH, bottom: m[v][0] * INCH, left: m[v][1] * INCH, right: m[v][1] * INCH });
    } else if (what === 'paper') {
      const size = v === 'a4' ? A4 : v === 'letter' ? LETTER : null;
      if (!size) return false;
      page(land ? { w: size.h, h: size.w } : { ...size });
    } else if (what === 'orient') {
      if ((v === 'landscape') !== land) page({ w: t.page.h, h: t.page.w });
    } else if (what === 'numbers') {
      f.ed.update({ ...t, hf: { ...t.hf, numbers: v as NumberPlace } } as DocText, 'Page numbers');
    } else return false;
    return true;
  }

  /** Ctrl+Enter: what follows the caret starts a new page. */
  private pageBreak(): void {
    const ed = this.ed;
    ed.enter(false);
    const p = paraAt(ed.text, ed.focus);
    ed.setParas(p, p, { pageBreak: true }, 'break');
  }

  private drawNew(): void {
    const f = this.file!;
    this.host.editDrawing(null, 'New structure', (c) => {
      if (!c || this.file !== f) { this.focus(); return; }
      this.insertObject({ kind: 'drawing', contents: c }, 'Insert structure');
      this.focus();
    });
  }

  private async fromName(): Promise<void> {
    const f = this.file!;
    const got = await ask('Structure from Name or SMILES', [{ name: 'text', label: 'Name or SMILES', value: '' }], {
      ok: 'Insert', note: 'A systematic or common name (ethyl acetate, 4-bromoanisole) or a SMILES string. The structure goes in the text at the caret.',
    });
    this.focus();
    if (!got?.text.trim() || this.file !== f) return;
    const r = await this.host.toStructure(got.text, f.t.drawingStyle);
    if ('error' in r) { this.host.flash(r.error, 8000); return; }
    this.insertObject({ kind: 'drawing', contents: r.contents }, 'Insert structure');
    if (r.notes.length) this.host.flash(r.notes.join(' '), 8000);
  }

  private async insertPicture(): Promise<void> {
    const f = this.file!;
    const pic = await this.host.pickPicture();
    if (!pic || this.file !== f) return;
    // pictures come in at 96 pixels to the inch, as in Word
    this.dropPicture(pic.bytes, pic.mime);
  }

  private async insertTable(): Promise<void> {
    const f = this.file!;
    const got = await ask('Insert Table', [
      { name: 'rows', label: 'Rows', value: '4', type: 'number' },
      { name: 'cols', label: 'Columns', value: '3', type: 'number' },
    ], { ok: 'Insert', note: 'An ACS-style table. Double-click it to type in its cells; the Style panel changes its lines, headings, rows and columns.' });
    this.focus();
    if (!got || this.file !== f) return;
    const rows = Math.max(1, Math.min(500, Math.round(Number(got.rows) || 4)));
    const cols = Math.max(1, Math.min(60, Math.round(Number(got.cols) || 3)));
    const id = this.insertObject({ kind: 'drawing', contents: this.host.newTable(rows, cols, f.t.drawingStyle) }, 'Insert table');
    this.editFigure(id);
  }

  /**
   * References > Insert Caption: a numbered caption paragraph ("Figure 2. ") under the
   * paragraph the caret is in (above it for a table, as journals set them), ready to type into.
   */
  private async insertCaption(): Promise<void> {
    const f = this.file!;
    const got = await ask('Insert Caption', [
      { name: 'name', label: 'Label', value: 'Figure', options: CAPTION_NAMES.map((n) => ({ value: n, label: n })) },
      { name: 'prefix', label: 'Before the number', value: '', options: [{ value: '', label: 'Nothing (Figure 1)' }, { value: 'S', label: 'S (Figure S1, for Supporting Information)' }] },
    ], { ok: 'Insert', note: 'Captions number themselves in order, and references to them follow when they move.' });
    this.focus();
    if (!got || this.file !== f) return;
    const ed = f.ed;
    const id = nextObjectId(f.t);
    ed.update({ ...f.t, objects: { ...f.t.objects, [id]: { kind: 'seq', name: got.name } } } as DocText, 'Insert caption');
    const text = ed.text;
    const p = paraAt(text, ed.focus);
    const r = paraRange(text, p);
    const above = got.name === 'Table';
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
      if (!this.run(cmd)) this.host.command(cmd);
    });
    // selects that run a command: margins, paper, orientation, page numbers
    for (const sel of r.querySelectorAll<HTMLSelectElement>('select[data-doc-prefix]')) {
      sel.addEventListener('change', () => { this.run(`${sel.dataset.docPrefix}-${sel.value}`); this.focus(); });
    }
    // zoom, under the pages
    for (const b of document.querySelectorAll<HTMLButtonElement>('#doc-statusbar [data-doc]')) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.run(b.dataset.doc!));
    }
    const fontList = r.querySelector('#doc-font-list');
    for (const name of DOC_FONTS) fontList?.append(new Option(name));
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
    const lineSel = r.querySelector<HTMLSelectElement>('#doc-line')!;
    lineSel.addEventListener('change', () => {
      const v = Number(lineSel.value);
      if (this.file && v > 0) this.ed.setSelectedParas({ line: Math.abs(v - 1) < 1e-6 ? undefined : v }, 'spacing');
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
    const ed = f.ed;
    const s = ed.currentStyle();
    const para = ed.currentPara();
    const st = styleOf(f.t, para);
    const press = (cmd: string, on: boolean) => {
      for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>(`[data-doc="${cmd}"]`)) b.setAttribute('aria-pressed', String(on));
    };
    press('doc-bold', !!s.bold);
    press('doc-italic', !!s.italic);
    press('doc-underline', !!s.underline);
    press('doc-sub', !!s.sub);
    press('doc-sup', !!s.sup);
    press('doc-formula', !!s.formula);
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
      const v = String(para.line ?? 1);
      lineSel.value = [...lineSel.options].some((o) => o.value === v) ? v : '';
    }
    const pick = (id: string, v: string) => {
      const el = this.ribbon.querySelector<HTMLSelectElement>(id);
      if (el && el !== active) el.value = [...el.options].some((o) => o.value === v) ? v : 'other';
    };
    const pg = f.t.page;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const margins = Object.entries({ normal: [1, 1], narrow: [0.5, 0.5], moderate: [1, 0.75], wide: [1, 2] })
      .find(([, [tb, lr]]) => near(pg.top, tb * INCH) && near(pg.bottom, tb * INCH) && near(pg.left, lr * INCH) && near(pg.right, lr * INCH));
    pick('#doc-margins', margins?.[0] ?? 'other');
    const short = Math.min(pg.w, pg.h), long = Math.max(pg.w, pg.h);
    pick('#doc-paper', near(short, LETTER.w) && near(long, LETTER.h) ? 'letter' : near(short, A4.w) && near(long, A4.h) ? 'a4' : 'other');
    pick('#doc-orient', pg.w > pg.h ? 'landscape' : 'portrait');
    pick('#doc-numbers', f.t.hf.numbers);
    press('numbers-s', f.t.hf.prefix === 'S');
    this.showZoom();
    const status = document.querySelector<HTMLElement>('#doc-status');
    if (status) {
      const lay = f.layout();
      const c = ed.caret();
      const page = lay.pages.findIndex((p) => c.line >= p.first && c.line < p.end);
      const words = ed.text.split(/[\s￼]+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length;
      status.textContent = `Page ${page + 1} of ${lay.pages.length}  ·  ${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
    }
  }
}

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
