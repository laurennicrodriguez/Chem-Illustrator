// The panel on the right in Document mode: the formatting of the paragraph the caret is in,
// its named style (change it, and every paragraph in that style changes), the page (paper
// and margins), the header and footer with the page numbers, and the figure picked. Every
// value can be typed in; lengths take inches, cm, mm or pt ("2.5 cm").

import type { Justify } from '../model';
import { FloatBox, PINNED_ICON } from './float-box';
import type { DocFile } from '../document/doc-file';
import {
  A4, CM, COL_GAP, INCH, LETTER, FLOAT_GAP, defaultStyles, floatOf, modifyStyle, setParaStyle, styleOf,
  type DocText, type FigureLook, type Float, type WrapKind, type HeaderFooter, type NamedStyle, type NumberPlace, type PageSetup,
} from '../document/document';
import { changeAllSections, changeSection, pageNumText, sectionAt, sectionsOf, type Section, type SectionPatch } from '../document/sections';
import { paraAt } from '../text/paragraphs';

export interface DocPanelHost {
  file(): DocFile | null;
  run(cmd: string): boolean;
  focus(): void;
  editFigure(id: number): void;
  /** The figure or picture picked on its own. */
  picked(): number | null;
  setScale(id: number, scale: number): void;
  setLook(id: number, patch: Partial<FigureLook>): void;
  lookOf(id: number): FigureLook | undefined;
  setWrap(id: number, wrap: WrapKind | 'inline'): void;
  setFloat(id: number, fl: Float): void;
  setBoxWidth(id: number, w: number): void;
  setFill(id: number, fill: string | undefined): void;
}


const ALIGNS: [Justify, string][] = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['justify', 'Justified']];
const PLACES: [NumberPlace, string][] = [
  ['none', 'None'], ['footer-center', 'Bottom, centre'], ['footer-right', 'Bottom, right'], ['footer-left', 'Bottom, left'],
  ['header-right', 'Top, right'], ['header-center', 'Top, centre'], ['header-left', 'Top, left'],
];

/**
 * A length typed by the person, in points: "1", "1 in", '1"', "2.5 cm", "20 mm", "12 pt".
 * A bare number is in `unit`. Null when it isn't a length.
 */
export function parseLength(text: string, unit: 'in' | 'pt' | 'cm'): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(in|inch|inches|"|”|cm|mm|pt|points?)?\s*$/i.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const u = (m[2] ?? unit).toLowerCase();
  if (u === 'cm') return v * CM;
  if (u === 'mm') return (v * CM) / 10;
  if (u.startsWith('p')) return v;
  return v * INCH;
}

/** A length in points shown in a unit, without needless decimals. */
export function showLength(pt: number, unit: 'in' | 'pt' | 'cm'): string {
  const v = unit === 'in' ? pt / INCH : unit === 'cm' ? pt / CM : pt;
  return String(Math.round(v * 100) / 100);
}

type Field = HTMLInputElement | HTMLSelectElement;

/** The settings boxes: each floats (opened from its ribbon group's corner button) or is pinned in the panel. */
export type DocBoxKey = 'para' | 'style' | 'page' | 'hf';
export const DOC_BOXES: DocBoxKey[] = ['para', 'style', 'page', 'hf'];
const BOX_TITLES: Record<DocBoxKey, string> = { para: 'Paragraph', style: 'Style', page: 'Page Setup', hf: 'Header, footer and page numbers' };

/** Which boxes are pinned in the panel on the right (kept in the settings); `changed` saves them. */
export const docBoxPrefs: { pinned: DocBoxKey[]; changed?: () => void } = { pinned: [] };

export function parseDocPins(raw: unknown): DocBoxKey[] {
  return Array.isArray(raw) ? DOC_BOXES.filter((k) => raw.includes(k)) : [];
}

export class DocPanel {
  private fields = new Map<string, Field>();
  private sections: Record<'para' | 'style' | 'page' | 'hf' | 'figure', HTMLElement>;
  private styleTitle!: HTMLElement;
  private figureInfo!: HTMLElement;
  private figButtons!: HTMLElement;
  private floats = {} as Record<DocBoxKey, FloatBox>;
  private emptyNote: HTMLElement;

  constructor(private body: HTMLElement, private host: DocPanelHost) {
    const sec = (title: string, box?: DocBoxKey) => {
      const s = document.createElement('div');
      s.className = 'dp-section';
      const h = document.createElement('h3');
      const t = document.createElement('span');
      t.textContent = title;
      h.append(t);
      if (box) {
        const unpin = document.createElement('button');
        unpin.type = 'button';
        unpin.className = 'dp-unpin';
        unpin.innerHTML = PINNED_ICON;
        unpin.title = 'Unpin: it goes back to opening from its ribbon button';
        unpin.addEventListener('click', () => this.pin(box, false));
        h.append(unpin);
        this.floats[box] = new FloatBox(title, () => this.pin(box, true));
      }
      s.append(h);
      body.append(s);
      return s;
    };
    this.sections = { figure: sec('Figure'), para: sec(BOX_TITLES.para, 'para'), style: sec(BOX_TITLES.style, 'style'), page: sec(BOX_TITLES.page, 'page'), hf: sec(BOX_TITLES.hf, 'hf') };
    this.styleTitle = this.sections.style.querySelector('h3 > span')!;
    this.emptyNote = document.createElement('p');
    this.emptyNote.className = 'muted small dp-note';
    this.emptyNote.textContent = 'The Paragraph, Style, Page Setup and Header settings open from the small ⬊ buttons on the ribbon. Pin one with its pin button to keep it here.';
    body.append(this.emptyNote);
    this.buildFigure();
    this.buildPara();
    this.buildStyle();
    this.buildPage();
    this.buildHeaderFooter();
    this.placeBoxes();
  }

  // ---------------------------------------------------------------- the boxes

  /** Pinned boxes go in the panel (in a fixed order), the others into their floating windows. */
  placeBoxes(): void {
    for (const k of DOC_BOXES) {
      const pinned = docBoxPrefs.pinned.includes(k);
      const sec = this.sections[k];
      sec.classList.toggle('dp-pinned', pinned);
      if (pinned) { this.body.append(sec); this.floats[k].close(); }
      else this.floats[k].body.append(sec);
    }
    this.body.append(this.emptyNote);
    this.emptyNote.hidden = docBoxPrefs.pinned.length > 0;
  }

  /** Pin a box to the panel, or unpin it (it then floats, open, so it doesn't vanish). */
  pin(key: DocBoxKey, on: boolean): void {
    const was = this.floats[key].open;
    docBoxPrefs.pinned = on ? [...new Set([...docBoxPrefs.pinned, key])] : docBoxPrefs.pinned.filter((k) => k !== key);
    this.placeBoxes();
    if (on) this.reveal(key);
    else if (!was) this.floats[key].show();
    this.update();
    docBoxPrefs.changed?.();
  }

  /** Open a box (a ribbon group's corner button): float it, or show it in the panel when pinned there. */
  open(key: DocBoxKey, near?: HTMLElement | null, focus?: string): void {
    const sec = this.sections[key];
    if (docBoxPrefs.pinned.includes(key) && sec.offsetParent !== null) this.reveal(key);
    else {
      // pinned but the panel is folded away: float it this time
      if (sec.parentElement !== this.floats[key].body) this.floats[key].body.append(sec);
      this.update();
      this.floats[key].show(near);
    }
    if (focus) this.fields.get(focus)?.focus();
  }

  /** Close the floating boxes (another kind of tab is showing). */
  closeBoxes(): void {
    for (const k of DOC_BOXES) this.floats[k].close();
  }

  isOpen(key: DocBoxKey): boolean {
    return this.floats[key].open;
  }

  private reveal(key: DocBoxKey): void {
    const sec = this.sections[key];
    sec.scrollIntoView({ block: 'nearest' });
    sec.classList.remove('dp-flash');
    void sec.offsetWidth;
    sec.classList.add('dp-flash');
  }

  // ---------------------------------------------------------------- building

  private row(sec: HTMLElement, label: string, el: HTMLElement, title?: string): void {
    const l = document.createElement('label');
    l.className = 'style-row';
    const s = document.createElement('span');
    s.textContent = label;
    l.append(s, el);
    if (title) l.title = title;
    sec.append(l);
  }

  private check(sec: HTMLElement, key: string, label: string, on: (v: boolean) => void, title?: string): void {
    const l = document.createElement('label');
    l.className = 'style-row check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => { on(box.checked); this.host.focus(); });
    l.append(box, document.createTextNode(label));
    if (title) l.title = title;
    this.fields.set(key, box);
    sec.append(l);
  }

  /** A text field that acts on Enter or when left; Escape goes back to the document. */
  private input(key: string, on: (v: string) => void, opts: { list?: string; placeholder?: string } = {}): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'dp-input';
    el.spellcheck = false;
    if (opts.list) el.setAttribute('list', opts.list);
    if (opts.placeholder) el.placeholder = opts.placeholder;
    let before = '';
    el.addEventListener('focus', () => { before = el.value; });
    const apply = () => { if (el.value !== before) { before = el.value; on(el.value); } };
    el.addEventListener('change', apply);
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); apply(); this.host.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); el.value = before; this.host.focus(); }
    });
    this.fields.set(key, el);
    return el;
  }

  private select(key: string, options: [string, string][], on: (v: string) => void): HTMLSelectElement {
    const el = document.createElement('select');
    for (const [v, label] of options) el.append(new Option(label, v));
    el.addEventListener('change', () => { on(el.value); this.host.focus(); });
    el.addEventListener('keydown', (e) => e.stopPropagation());
    this.fields.set(key, el);
    return el;
  }

  private buttons(sec: HTMLElement, list: [string, string, () => void][]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'style-buttons';
    for (const [label, title, on] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { on(); this.host.focus(); });
      box.append(b);
    }
    sec.append(box);
    return box;
  }

  /** Change the document as one undo step. */
  private change(kind: string, f: (t: DocText) => DocText): void {
    const file = this.host.file();
    if (!file) return;
    file.ed.update(f(file.t), kind);
  }

  private buildFigure(): void {
    const s = this.sections.figure;
    this.figureInfo = document.createElement('p');
    this.figureInfo.className = 'muted small dp-note';
    s.append(this.figureInfo);
    this.row(s, 'Size (%)', this.input('fig-scale', (v) => {
      const id = this.host.picked();
      const n = Number(v.replace('%', ''));
      if (id !== null && n > 0) this.host.setScale(id, n / 100);
    }), 'Its own size is 100%. A figure wider than the space between the margins is made to fit.');
    this.row(s, 'Width (in)', this.input('fig-width', (v) => {
      const id = this.host.picked();
      const n = parseLength(v, 'in');
      if (id !== null && n !== null && n > 0) this.host.setBoxWidth(id, n);
    }), 'The text box\'s width; it grows down to fit its text');
    const fill = document.createElement('input');
    fill.type = 'color';
    fill.addEventListener('change', () => { const id = this.host.picked(); if (id !== null) this.host.setFill(id, fill.value); this.host.focus(); });
    this.fields.set('fig-fill', fill);
    this.row(s, 'Fill', fill, 'The text box\'s background');
    this.buttons(s, [['No Fill', 'A see-through text box', () => { const id = this.host.picked(); if (id !== null) this.host.setFill(id, undefined); }]]).dataset.key = 'fig-nofill';
    // where it sits: in the line, or on the page with the text wrapping round it
    this.row(s, 'Wrap text', this.select('fig-wrap', [['inline', 'In Line with Text'], ['square', 'Square'], ['topBottom', 'Top and Bottom'], ['behind', 'Behind Text'], ['front', 'In Front of Text']], (v) => {
      const id = this.host.picked();
      if (id !== null) this.host.setWrap(id, v as WrapKind | 'inline');
    }), 'In the line like a letter, or on the page with the text going round it (or under or over it). Drag it on the page to move it');
    const fl = (patch: Partial<Float>) => {
      const id = this.host.picked();
      const f = this.host.file();
      const cur = id !== null ? floatOf(f?.t.objects[id]) : undefined;
      if (id !== null && cur) this.host.setFloat(id, { ...cur, ...patch });
    };
    this.row(s, 'Across (in)', this.input('fig-x', (v) => { const n = parseLength(v, 'in'); if (n !== null) fl({ x: n }); }), 'From the left of the margin (or of the page)');
    this.row(s, '… from', this.select('fig-xfrom', [['margin', 'Margin'], ['page', 'Page']], (v) => this.refrom('x', v)));
    this.row(s, 'Down (in)', this.input('fig-y', (v) => { const n = parseLength(v, 'in'); if (n !== null) fl({ y: n }); }), 'From the top of its paragraph (it moves with that text), of the margin, or of the page');
    this.row(s, '… from', this.select('fig-yfrom', [['para', 'Paragraph'], ['margin', 'Margin'], ['page', 'Page']], (v) => this.refrom('y', v)));
    this.row(s, 'Text gap (pt)', this.input('fig-gap', (v) => { const n = parseLength(v, 'pt'); if (n !== null) fl({ gap: Math.max(0, n) }); }), `Room kept between it and the text round it (Word's is ${FLOAT_GAP} pt, 0.13 in)`);
    const look = (patch: Partial<FigureLook>) => { const id = this.host.picked(); if (id !== null) this.host.setLook(id, patch); };
    this.row(s, 'Frame (pt)', this.input('fig-frame', (v) => {
      const n = v.trim() === '' || /^none$/i.test(v.trim()) ? 0 : parseLength(v, 'pt');
      if (n !== null) look({ frame: n > 0 ? Math.min(n, 20) : undefined });
    }, { list: 'dp-frames', placeholder: 'None' }), 'A line round it, this many points wide (0.5 is a hairline, 0.75 thin, 1.5 medium, 3 thick). Clear it for none');
    const frames = document.createElement('datalist');
    frames.id = 'dp-frames';
    for (const v of ['0.5', '0.75', '1', '1.5', '2.25', '3']) frames.append(new Option(v));
    s.append(frames);
    const fc = document.createElement('input');
    fc.type = 'color';
    fc.addEventListener('change', () => { look({ frameColor: fc.value.toLowerCase() === '#000000' ? undefined : fc.value }); this.host.focus(); });
    this.fields.set('fig-frame-colour', fc);
    this.row(s, 'Frame colour', fc);
    this.row(s, 'Shadow', this.select('fig-shadow', [['none', 'None'], ['soft', 'Soft'], ['hard', 'Sharp']], (v) => look({ shadow: v === 'none' ? undefined : v as 'soft' | 'hard' })),
      'Down and to the right; the figure gets a white background so the shadow is a box\'s');
    this.figButtons = this.buttons(s, [
      ['Edit Drawing', 'Change it with the drawing tools (or double-click it)', () => { const id = this.host.picked(); if (id !== null) this.host.editFigure(id); }],
      ['Own Size', 'Back to 100%', () => { const id = this.host.picked(); if (id !== null) this.host.setScale(id, 1); }],
      ['Picture Format…', 'Brightness, contrast, sharpen, recolour, transparency, Remove Background, crop to a shape or proportions', () => this.host.run('picture-format')],
    ]);
  }

  /** Measure a floating figure's place from somewhere else, keeping it where it is on the page. */
  private refrom(axis: 'x' | 'y', from: string): void {
    const id = this.host.picked();
    const f = this.host.file();
    const cur = id !== null ? floatOf(f?.t.objects[id]) : undefined;
    if (!f || id === null || !cur) return;
    const lay = f.layout();
    const placed = lay.objects.find((o) => o.id === id);
    if (!placed) return;
    const pg = f.t.page;
    const pageTop = lay.pages[placed.page]?.top ?? 0;
    if (axis === 'x') {
      const abs = cur.xFrom === 'page' ? cur.x : cur.x + pg.left;
      this.host.setFloat(id, { ...cur, xFrom: from === 'page' ? 'page' : undefined, x: from === 'page' ? abs : abs - pg.left });
      return;
    }
    const at = [...lay.paraTops.entries()].find(([, t]) => t.page === placed.page);
    // y on the page, then from the new place
    const at0 = (() => {
      if (cur.yFrom === 'page') return cur.y;
      if (cur.yFrom === 'margin') return cur.y + pg.top;
      const para = this.anchorPara(f, id);
      const top = para !== null ? lay.paraTops[para] : at?.[1];
      return (top ? top.y - pageTop : pg.top) + cur.y;
    })();
    if (from === 'page') this.host.setFloat(id, { ...cur, yFrom: 'page', y: at0 });
    else if (from === 'margin') this.host.setFloat(id, { ...cur, yFrom: 'margin', y: at0 - pg.top });
    else {
      const para = this.anchorPara(f, id);
      const top = para !== null ? lay.paraTops[para] : null;
      this.host.setFloat(id, { ...cur, yFrom: undefined, y: at0 - (top ? top.y - pageTop : pg.top) });
    }
  }

  /** The paragraph a floating figure belongs to (where its character is). */
  private anchorPara(f: DocFile, id: number): number | null {
    let at = 0;
    for (const r of f.t.runs) {
      if (r.obj === id) return f.ed.text.slice(0, at).split('\n').length - 1;
      at += r.text.length;
    }
    return null;
  }

  private buildPara(): void {
    const s = this.sections.para;
    const paras = (patch: Parameters<DocFile['ed']['setSelectedParas']>[0], kind = 'para') => this.host.file()?.textEd.setSelectedParas(patch, kind);
    this.row(s, 'Style', this.select('p-style', [], (id) => {
      const f = this.host.file();
      if (!f) return;
      const [a, b] = f.ed.selectedParas();
      this.change('Style', (t) => setParaStyle(t, a, b, id));
    }), 'Normal, the headings and Caption (Home > Styles); change how a style looks below');
    this.row(s, 'Alignment', this.select('p-align', ALIGNS, (v) => paras({ align: v === 'left' ? undefined : (v as Justify) }, 'align')));
    this.row(s, 'Indent (in)', this.input('p-indent', (v) => { const n = parseLength(v, 'in'); if (n !== null) paras({ indent: Math.max(0, n) || undefined }, 'indent'); }), 'From the left margin');
    this.row(s, 'First line (in)', this.input('p-first', (v) => { const n = parseLength(v, 'in'); if (n !== null) paras({ firstLine: n || undefined }, 'indent'); }), 'The first line\'s indent from the rest; less than 0 hangs it out to the left');
    this.row(s, 'Space before (pt)', this.input('p-before', (v) => { const n = parseLength(v, 'pt'); if (n !== null) paras({ spaceBefore: Math.max(0, n) }, 'spacing'); }));
    this.row(s, 'Space after (pt)', this.input('p-after', (v) => { const n = parseLength(v, 'pt'); if (n !== null) paras({ spaceAfter: Math.max(0, n) }, 'spacing'); }));
    this.row(s, 'Right indent (in)', this.input('p-right', (v) => { const n = parseLength(v, 'in'); if (n !== null) paras({ indentRight: Math.max(0, n) || undefined }, 'indent'); }), 'From the right margin');
    this.row(s, 'Line spacing', this.select('p-rule', [['multiple', 'Multiple'], ['atLeast', 'At least'], ['exact', 'Exactly']], (v) => {
      const p = this.host.file()?.ed.currentPara();
      if (v === 'multiple') paras({ linePt: undefined, lineRule: undefined }, 'spacing');
      else paras({ linePt: p?.linePt ?? 12, lineRule: v as 'exact' | 'atLeast', line: undefined }, 'spacing');
    }), 'Multiple: times single spacing. At least or Exactly: a height in points (Exactly can cut off tall figures, as in Word)');
    this.row(s, 'At', this.input('p-line', (v) => {
      const p = this.host.file()?.ed.currentPara();
      if (p?.linePt) { const n = parseLength(v, 'pt'); if (n !== null && n > 0 && n <= 1584) paras({ linePt: n }, 'spacing'); return; }
      const n = Number(v);
      if (n > 0 && n <= 10) paras({ line: Math.abs(n - 1) < 1e-6 ? undefined : n }, 'spacing');
    }, { list: 'dp-lines' }), 'Times single spacing (1, 1.15, 1.5, 2…), or points for At least and Exactly');
    const lines = document.createElement('datalist');
    lines.id = 'dp-lines';
    for (const v of ['1', '1.15', '1.5', '2', '2.5', '3']) lines.append(new Option(v));
    s.append(lines);
    this.check(s, 'p-break', 'Start on a new page', (v) => paras({ pageBreak: v || undefined }, 'break'), 'A page break before this paragraph (Ctrl+Enter makes one at the caret)');
    this.check(s, 'p-colbreak', 'Start a new column', (v) => paras({ colBreak: v || undefined }, 'break'), 'In a page of columns: this paragraph starts the next column (Ctrl+Shift+Enter makes one at the caret)');
    this.check(s, 'p-keep', 'Keep with next', (v) => paras({ keepNext: v || undefined }, 'keep'), 'On the same page as the paragraph after it (headings do this)');
  }

  private buildStyle(): void {
    const s = this.sections.style;
    const note = document.createElement('p');
    note.className = 'muted small dp-note';
    note.textContent = 'Changes here change every paragraph in this style, except what was formatted by hand.';
    s.append(note);
    const set = (patch: Partial<NamedStyle>) => {
      const f = this.host.file();
      if (!f) return;
      const cur = styleOf(f.t, f.ed.currentPara());
      this.change('Change style', (t) => modifyStyle(t, { ...cur, ...patch }));
    };
    this.row(s, 'Font', this.input('s-font', (v) => { if (v.trim()) set({ font: v.trim() }); }, { list: 'ci-fonts' }));
    this.row(s, 'Size (pt)', this.input('s-size', (v) => { const n = Number(v); if (n > 0 && n <= 1638) set({ size: n }); }));
    this.check(s, 's-bold', 'Bold', (v) => set({ bold: v }));
    this.check(s, 's-italic', 'Italic', (v) => set({ italic: v }));
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.addEventListener('change', () => { set({ color: colour.value.toLowerCase() === '#000000' ? undefined : colour.value }); this.host.focus(); });
    this.fields.set('s-colour', colour);
    this.row(s, 'Colour', colour);
    this.row(s, 'Alignment', this.select('s-align', ALIGNS, (v) => set({ align: v as Justify })));
    this.row(s, 'Space before (pt)', this.input('s-before', (v) => { const n = parseLength(v, 'pt'); if (n !== null) set({ spaceBefore: Math.max(0, n) }); }));
    this.row(s, 'Space after (pt)', this.input('s-after', (v) => { const n = parseLength(v, 'pt'); if (n !== null) set({ spaceAfter: Math.max(0, n) }); }));
    this.row(s, 'Line spacing', this.input('s-line', (v) => { const n = Number(v); if (n > 0 && n <= 10) set({ line: n }); }, { list: 'dp-lines' }));
    this.row(s, 'Indent (in)', this.input('s-indent', (v) => { const n = parseLength(v, 'in'); if (n !== null) set({ indent: Math.max(0, n) }); }));
    this.row(s, 'First line (in)', this.input('s-first', (v) => { const n = parseLength(v, 'in'); if (n !== null) set({ firstLine: n }); }));
    this.check(s, 's-keep', 'Keep with next', (v) => set({ keepNext: v }));
    this.buttons(s, [
      ['Match This Paragraph', 'Make the style look like the paragraph the caret is in (and change the others in this style to match)', () => this.matchParagraph()],
      ['Reset Style', 'Put the style back as it first was', () => {
        const f = this.host.file();
        if (!f) return;
        const cur = styleOf(f.t, f.ed.currentPara());
        const orig = defaultStyles()[cur.id];
        if (orig) this.change('Reset style', (t) => modifyStyle(t, orig));
      }],
    ]);
  }

  /** Word's "Update Heading 1 to Match Selection": the style takes the look of the paragraph the caret is in. */
  private matchParagraph(): void {
    const f = this.host.file();
    if (!f) return;
    const ed = f.ed;
    const p = ed.currentPara();
    const cur = styleOf(f.t, p);
    const look = ed.currentStyle();
    const next: NamedStyle = {
      ...cur,
      font: look.font ?? cur.font,
      size: look.size ?? cur.size,
      bold: !!look.bold,
      italic: !!look.italic,
      color: look.color,
      align: p.align ?? 'left',
      spaceBefore: p.spaceBefore ?? 0,
      spaceAfter: p.spaceAfter ?? 0,
      line: p.line ?? 1,
      indent: p.indent ?? 0,
      firstLine: p.firstLine ?? 0,
      keepNext: !!p.keepNext,
    };
    this.change('Change style', (t) => modifyStyle(t, next));
  }

  /** The section the caret is in (sections have their own page setup, header and footer). */
  private section(t: DocText): Section {
    const f = this.host.file();
    return sectionAt(sectionsOf(t), f ? paraAt(f.ed.text, f.ed.focus) : 0);
  }

  /** Change the section the caret is in (or, for the page setup, every section when Apply to says so). */
  private changeSec(kind: string, patch: (s: Section) => SectionPatch, all = false): void {
    this.change(kind, (t) => (all ? changeAllSections(t, patch) : changeSection(t, this.section(t).index, patch(this.section(t)))));
  }

  /** Notes saying which section the page setup and the header and footer are for (when there are several). */
  private secNotes: HTMLElement[] = [];

  private secNote(s: HTMLElement): void {
    const p = document.createElement('p');
    p.className = 'muted small dp-note';
    p.hidden = true;
    s.append(p);
    this.secNotes.push(p);
  }

  private buildPage(): void {
    const s = this.sections.page;
    this.secNote(s);
    this.row(s, 'Apply to', this.select('pg-apply', [['section', 'This section'], ['all', 'Whole document']], () => {}), 'With section breaks, each section has its own paper, margins and columns');
    const all = () => (this.fields.get('pg-apply') as HTMLSelectElement | undefined)?.value === 'all';
    const page = (patch: Partial<PageSetup>) => this.changeSec('Page setup', (x) => ({ page: { ...x.page, ...patch } }), all());
    this.row(s, 'Paper', this.select('pg-size', [['letter', 'Letter (8.5 × 11 in)'], ['a4', 'A4 (21 × 29.7 cm)'], ['custom', 'Other size']], (v) => {
      const f = this.host.file();
      if (!f) return;
      const pg = this.section(f.t).page;
      const land = pg.w > pg.h;
      const size = v === 'a4' ? A4 : v === 'letter' ? LETTER : null;
      if (size) page(land ? { w: size.h, h: size.w } : { ...size });
    }));
    this.row(s, 'Orientation', this.select('pg-orient', [['portrait', 'Portrait'], ['landscape', 'Landscape']], (v) => {
      const f = this.host.file();
      if (!f) return;
      // (each section turned its own way, when applied to them all)
      if (all()) { this.changeSec('Page setup', (x) => ((v === 'landscape') !== (x.page.w > x.page.h) ? { page: { ...x.page, w: x.page.h, h: x.page.w } } : {}), true); return; }
      const { w, h } = this.section(f.t).page;
      if ((v === 'landscape') !== (w > h)) page({ w: h, h: w });
    }));
    const len = (key: keyof PageSetup, label: string, title?: string) =>
      this.row(s, label, this.input('pg-' + key, (v) => { const n = parseLength(v, 'in'); if (n !== null && n >= 0) page({ [key]: n }); }), title);
    len('w', 'Width (in)');
    len('h', 'Height (in)');
    len('top', 'Top margin (in)');
    len('bottom', 'Bottom margin (in)');
    len('left', 'Left margin (in)');
    len('right', 'Right margin (in)');
    len('header', 'Header from top (in)', 'How far the header sits from the top of the page');
    len('footer', 'Footer from bottom (in)', 'How far the footer and page numbers sit from the bottom of the page');
    this.row(s, 'Columns', this.select('pg-cols', [['1', 'One'], ['2', 'Two'], ['3', 'Three'], ['4', 'Four']], (v) => page({ cols: Number(v) > 1 ? Number(v) : undefined })),
      'Text runs down one column, then the next (Layout > Column Break starts the next one early)');
    this.row(s, 'Column spacing (in)', this.input('pg-colGap', (v) => { const n = parseLength(v, 'in'); if (n !== null && n >= 0) page({ colGap: Math.abs(n - COL_GAP) < 0.01 ? undefined : n }); }),
      'Space between columns (Word\'s is 0.5 in)');
  }

  private buildHeaderFooter(): void {
    const s = this.sections.hf;
    this.secNote(s);
    const hf = (f: (h: HeaderFooter) => HeaderFooter) => this.changeSec('Header and footer', (x) => ({ hf: f(x.hf) }));
    this.check(s, 'hf-link', 'Same as previous section', (v) => this.changeSec('Header and footer', (x) => ({ linked: v })),
      'Word\'s Link to Previous: this section shows the header and footer of the one before. Turn it off to give this section its own');
    this.row(s, 'Page numbers', this.select('hf-numbers', PLACES, (v) => hf((h) => ({ ...h, numbers: v as NumberPlace }))));
    this.row(s, 'Before the number', this.input('hf-prefix', (v) => hf((h) => ({ ...h, prefix: v })), { placeholder: 'S for S1, S2…' }), 'Supporting Information pages are numbered S1, S2…: type S here');
    const FORMATS = ['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter'] as const;
    this.row(s, 'Number format', this.select('hf-format', FORMATS.map((v) => [v, [1, 2, 3].map((n) => pageNumText(n, v)).join(', ')]), (v) => this.changeSec('Page numbers', () => ({ format: v as Section['format'] }))),
      'Front matter is often numbered i, ii, iii, and the text after a section break 1, 2, 3');
    this.check(s, 'hf-continue', 'Continue from previous section', (v) => this.changeSec('Page numbers', (x) => ({ restart: v ? undefined : x.restart ?? 1 })));
    this.row(s, 'First page number', this.input('hf-start', (v) => { const n = Math.round(Number(v)); if (Number.isFinite(n)) this.changeSec('Page numbers', () => ({ restart: n })); }));
    this.check(s, 'hf-first', 'Number the first page', (v) => hf((h) => ({ ...h, onFirst: v })), 'Leave off for a title page');
    const zone = (part: 'header' | 'footer', i: number, label: string) =>
      this.row(s, label, this.input(`hf-${part}${i}`, (v) => hf((h) => {
        const three = [...h[part]] as [string, string, string];
        three[i] = v;
        return { ...h, [part]: three };
      })), 'On every page; a page number placed here goes after this text');
    zone('header', 0, 'Header, left');
    zone('header', 1, 'Header, centre');
    zone('header', 2, 'Header, right');
    zone('footer', 0, 'Footer, left');
    zone('footer', 1, 'Footer, centre');
    zone('footer', 2, 'Footer, right');
  }

  // ---------------------------------------------------------------- showing the values

  /** Show the values for where the caret is (leaving alone the field being typed in). */
  update(): void {
    const f = this.host.file();
    if (!f) return;
    const t = f.t;
    const ed = f.textEd;
    const active = document.activeElement;
    const put = (key: string, v: string | boolean) => {
      const el = this.fields.get(key);
      if (!el || el === active) return;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v;
      else if (el.value !== String(v)) el.value = String(v);
    };
    // the figure picked
    const id = this.host.picked();
    this.sections.figure.hidden = id === null;
    if (id !== null) {
      const o = t.objects[id];
      const lay = f.layout();
      const sz = lay.sizes.get(id);
      const scale = o && (o.kind === 'drawing' || o.kind === 'picture') ? o.scale ?? 1 : 1;
      const isBox = o?.kind === 'textbox';
      const fl = floatOf(o);
      const show = (key: string, on: boolean) => { const el = this.fields.get(key); const row = el?.closest('label'); if (row) row.style.display = on ? '' : 'none'; };
      show('fig-scale', !isBox);
      show('fig-width', isBox);
      show('fig-fill', isBox);
      const nofill = this.sections.figure.querySelector<HTMLElement>('[data-key="fig-nofill"]');
      if (nofill) nofill.style.display = isBox ? '' : 'none';
      for (const k of ['fig-x', 'fig-xfrom', 'fig-y', 'fig-yfrom', 'fig-gap']) show(k, !!fl);
      const wrapSel = this.fields.get('fig-wrap') as HTMLSelectElement | undefined;
      const inl = wrapSel?.querySelector<HTMLOptionElement>('option[value="inline"]');
      if (inl) inl.disabled = isBox;
      put('fig-wrap', fl?.wrap ?? 'inline');
      if (isBox) { put('fig-width', showLength(o.w, 'in')); put('fig-fill', o.fill ?? '#ffffff'); }
      if (fl) {
        put('fig-x', showLength(fl.x, 'in'));
        put('fig-xfrom', fl.xFrom ?? 'margin');
        put('fig-y', showLength(fl.y, 'in'));
        put('fig-yfrom', fl.yFrom ?? 'para');
        put('fig-gap', String(Math.round((fl.gap ?? FLOAT_GAP) * 10) / 10));
      }
      const fitted = sz && o?.kind === 'drawing' ? lay.textW < sz.w + 0.01 && scale > 0 : false;
      put('fig-scale', String(Math.round(scale * 1000) / 10));
      const lk = this.host.lookOf(id);
      put('fig-frame', lk?.frame ? String(lk.frame) : '');
      put('fig-frame-colour', lk?.frameColor ?? '#000000');
      put('fig-shadow', lk?.shadow ?? 'none');
      this.figureInfo.textContent = (isBox ? 'A text box: click inside it to type, drag its edge to move it. ' : o?.kind === 'picture' ? 'A picture. ' : o?.kind === 'drawing' && o.contents.shapes.some((x) => x.diagram) ? 'A diagram: double-click it to change its text, layout or colours (Edit Drawing opens the drawing tools on it). ' : 'A drawing: double-click it to change it with the drawing tools. ')
        + (sz ? `Shown ${showLength(sz.w, 'in')} × ${showLength(sz.h, 'in')} in${fitted ? ', made smaller to fit between the margins' : ''}.` : '');
      const [edit, own, format] = this.figButtons.querySelectorAll('button');
      edit.style.display = o?.kind === 'drawing' ? '' : 'none';
      format.style.display = o?.kind === 'picture' && !o.chart ? '' : 'none';
      own.style.display = isBox ? 'none' : '';
    }
    // the paragraph
    const p = ed.currentPara();
    const st = styleOf(t, p);
    const sel = this.fields.get('p-style') as HTMLSelectElement;
    const ids = Object.keys(t.styles);
    if ([...sel.options].map((o) => o.value).join() !== ids.join()) sel.replaceChildren(...ids.map((k) => new Option(t.styles[k].name, k)));
    put('p-style', st.id);
    put('p-align', p.align ?? 'left');
    put('p-indent', showLength(p.indent ?? 0, 'in'));
    put('p-first', showLength(p.firstLine ?? 0, 'in'));
    put('p-before', showLength(p.spaceBefore ?? 0, 'pt'));
    put('p-after', showLength(p.spaceAfter ?? 0, 'pt'));
    put('p-right', showLength(p.indentRight ?? 0, 'in'));
    put('p-rule', p.linePt ? p.lineRule ?? 'atLeast' : 'multiple');
    put('p-line', p.linePt ? showLength(p.linePt, 'pt') : String(p.line ?? 1));
    put('p-break', !!p.pageBreak);
    put('p-colbreak', !!p.colBreak);
    put('p-keep', !!p.keepNext);
    // its style
    this.styleTitle.textContent = `Style: ${st.name}`;
    this.floats.style.title = `Style: ${st.name}`;
    put('s-font', st.font);
    put('s-size', String(st.size));
    put('s-bold', st.bold);
    put('s-italic', st.italic);
    put('s-colour', st.color ?? '#000000');
    put('s-align', st.align);
    put('s-before', showLength(st.spaceBefore, 'pt'));
    put('s-after', showLength(st.spaceAfter, 'pt'));
    put('s-line', String(st.line));
    put('s-indent', showLength(st.indent, 'in'));
    put('s-first', showLength(st.firstLine, 'in'));
    put('s-keep', st.keepNext);
    // the section the caret is in: its page and its header and footer
    const secs = sectionsOf(t);
    const sec = sectionAt(secs, paraAt(ed === f.ed ? ed.text : f.ed.text, f.ed.focus));
    for (const n of this.secNotes) {
      n.hidden = secs.length < 2;
      n.textContent = `Section ${sec.index + 1} of ${secs.length} (the one the caret is in).`;
    }
    const showRow = (key: string, on: boolean) => { const row = this.fields.get(key)?.closest('label'); if (row) (row as HTMLElement).style.display = on ? '' : 'none'; };
    showRow('pg-apply', secs.length > 1);
    showRow('hf-link', sec.index > 0);
    showRow('hf-continue', sec.index > 0);
    showRow('hf-start', sec.index === 0 || sec.restart !== undefined);
    const pg = sec.page;
    const same = (a: { w: number; h: number }) => (Math.abs(pg.w - a.w) < 0.5 && Math.abs(pg.h - a.h) < 0.5) || (Math.abs(pg.w - a.h) < 0.5 && Math.abs(pg.h - a.w) < 0.5);
    put('pg-size', same(LETTER) ? 'letter' : same(A4) ? 'a4' : 'custom');
    put('pg-orient', pg.w > pg.h ? 'landscape' : 'portrait');
    for (const k of ['w', 'h', 'top', 'bottom', 'left', 'right', 'header', 'footer'] as const) put('pg-' + k, showLength(pg[k], 'in'));
    put('pg-cols', String(pg.cols ?? 1));
    put('pg-colGap', showLength(pg.colGap ?? COL_GAP, 'in'));
    // header and footer
    const hf = sec.hf;
    put('hf-link', sec.linked);
    put('hf-format', sec.format);
    put('hf-continue', sec.restart === undefined);
    put('hf-numbers', hf.numbers);
    put('hf-prefix', hf.prefix);
    put('hf-start', String(sec.restart ?? 1));
    put('hf-first', hf.onFirst);
    for (let i = 0; i < 3; i++) { put(`hf-header${i}`, hf.header[i]); put(`hf-footer${i}`, hf.footer[i]); }
  }
}

