// The panel on the right in Document mode: the formatting of the paragraph the caret is in,
// its named style (change it, and every paragraph in that style changes), the page (paper
// and margins), the header and footer with the page numbers, and the figure picked. Every
// value can be typed in; lengths take inches, cm, mm or pt ("2.5 cm").

import type { Justify } from '../model';
import { FloatBox, PINNED_ICON } from './float-box';
import type { DocFile } from '../document/doc-file';
import {
  A4, CM, INCH, LETTER, defaultStyles, modifyStyle, setParaStyle, styleOf,
  type DocText, type HeaderFooter, type NamedStyle, type NumberPlace, type PageSetup,
} from '../document/document';

export interface DocPanelHost {
  file(): DocFile | null;
  run(cmd: string): boolean;
  focus(): void;
  editFigure(id: number): void;
  /** The figure or picture picked on its own. */
  picked(): number | null;
  setScale(id: number, scale: number): void;
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
    this.buttons(s, [
      ['Edit Drawing', 'Change it with the drawing tools (or double-click it)', () => { const id = this.host.picked(); if (id !== null) this.host.editFigure(id); }],
      ['Own Size', 'Back to 100%', () => { const id = this.host.picked(); if (id !== null) this.host.setScale(id, 1); }],
    ]);
  }

  private buildPara(): void {
    const s = this.sections.para;
    const paras = (patch: Parameters<DocFile['ed']['setSelectedParas']>[0], kind = 'para') => this.host.file()?.ed.setSelectedParas(patch, kind);
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
    this.row(s, 'Line spacing', this.input('p-line', (v) => { const n = Number(v); if (n > 0 && n <= 10) paras({ line: Math.abs(n - 1) < 1e-6 ? undefined : n }, 'spacing'); }, { list: 'dp-lines' }), 'Times single spacing: 1, 1.15, 1.5, 2…');
    const lines = document.createElement('datalist');
    lines.id = 'dp-lines';
    for (const v of ['1', '1.15', '1.5', '2', '2.5', '3']) lines.append(new Option(v));
    s.append(lines);
    this.check(s, 'p-break', 'Start on a new page', (v) => paras({ pageBreak: v || undefined }, 'break'), 'A page break before this paragraph (Ctrl+Enter makes one at the caret)');
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

  private buildPage(): void {
    const s = this.sections.page;
    const page = (patch: Partial<PageSetup>) => this.change('Page setup', (t) => ({ ...t, page: { ...t.page, ...patch } }));
    this.row(s, 'Paper', this.select('pg-size', [['letter', 'Letter (8.5 × 11 in)'], ['a4', 'A4 (21 × 29.7 cm)'], ['custom', 'Other size']], (v) => {
      const f = this.host.file();
      if (!f) return;
      const land = f.t.page.w > f.t.page.h;
      const size = v === 'a4' ? A4 : v === 'letter' ? LETTER : null;
      if (size) page(land ? { w: size.h, h: size.w } : { ...size });
    }));
    this.row(s, 'Orientation', this.select('pg-orient', [['portrait', 'Portrait'], ['landscape', 'Landscape']], (v) => {
      const f = this.host.file();
      if (!f) return;
      const { w, h } = f.t.page;
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
  }

  private buildHeaderFooter(): void {
    const s = this.sections.hf;
    const hf = (f: (h: HeaderFooter) => HeaderFooter) => this.change('Header and footer', (t) => ({ ...t, hf: f(t.hf) }));
    this.row(s, 'Page numbers', this.select('hf-numbers', PLACES, (v) => hf((h) => ({ ...h, numbers: v as NumberPlace }))));
    this.row(s, 'Before the number', this.input('hf-prefix', (v) => hf((h) => ({ ...h, prefix: v })), { placeholder: 'S for S1, S2…' }), 'Supporting Information pages are numbered S1, S2…: type S here');
    this.row(s, 'First page number', this.input('hf-start', (v) => { const n = Math.round(Number(v)); if (Number.isFinite(n)) hf((h) => ({ ...h, start: n })); }));
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
    const ed = f.ed;
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
      const fitted = sz && o?.kind === 'drawing' ? lay.textW < sz.w + 0.01 && scale > 0 : false;
      put('fig-scale', String(Math.round(scale * 1000) / 10));
      this.figureInfo.textContent = (o?.kind === 'picture' ? 'A picture. ' : 'A drawing: double-click it to change it with the drawing tools. ')
        + (sz ? `Shown ${showLength(sz.w, 'in')} × ${showLength(sz.h, 'in')} in${fitted ? ', made smaller to fit between the margins' : ''}.` : '');
      const edit = this.sections.figure.querySelector('button');
      if (edit) edit.hidden = o?.kind !== 'drawing';
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
    put('p-line', String(p.line ?? 1));
    put('p-break', !!p.pageBreak);
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
    // the page
    const pg = t.page;
    const same = (a: { w: number; h: number }) => (Math.abs(pg.w - a.w) < 0.5 && Math.abs(pg.h - a.h) < 0.5) || (Math.abs(pg.w - a.h) < 0.5 && Math.abs(pg.h - a.w) < 0.5);
    put('pg-size', same(LETTER) ? 'letter' : same(A4) ? 'a4' : 'custom');
    put('pg-orient', pg.w > pg.h ? 'landscape' : 'portrait');
    for (const k of ['w', 'h', 'top', 'bottom', 'left', 'right', 'header', 'footer'] as const) put('pg-' + k, showLength(pg[k], 'in'));
    // header and footer
    const hf = t.hf;
    put('hf-numbers', hf.numbers);
    put('hf-prefix', hf.prefix);
    put('hf-start', String(hf.start));
    put('hf-first', hf.onFirst);
    for (let i = 0; i < 3; i++) { put(`hf-header${i}`, hf.header[i]); put(`hf-footer${i}`, hf.footer[i]); }
  }
}

