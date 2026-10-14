// A slide deck: slides of one size, each with a layout and a drawing of its own, and a slide
// master that sets the look of every slide (fonts, colours, background, logo, slide numbers,
// and the drawing style of structures).
//
// The slide being edited lives in the app's one document (see Doc.swap), so every drawing
// tool, check and chemistry feature works on slides exactly as on a drawing. The other slides
// wait in documents of their own. The deck keeps one undo history across all slides: an edit
// on a slide is undone on that slide (the deck goes back to it), and adding, deleting or
// moving slides, or changing the master, are undone too.

import { Doc, Caption, Placeholder, TextBase, ParaStyle, Contents } from '../model';
import { DocStyle, ACS_1996 } from '../style';
import type { Rect } from '../geom';
import { ASCENT } from '../text/layout';

export interface SlideSize { w: number; h: number }
/** PowerPoint's two standard sizes, in points: widescreen 13.33 × 7.5 in, and 10 × 7.5 in. */
export const WIDE: SlideSize = { w: 960, h: 540 };
export const STANDARD: SlideSize = { w: 720, h: 540 };

export function sizeName(s: SlideSize): string {
  if (s.w === WIDE.w && s.h === WIDE.h) return 'Widescreen (16:9)';
  if (s.w === STANDARD.w && s.h === STANDARD.h) return 'Standard (4:3)';
  return `${+(s.w / 72).toFixed(2)} × ${+(s.h / 72).toFixed(2)} in`;
}

/** Design mode's page sizes, in points (1 in = 72 pt). */
export const DESIGN_SIZES: { id: string; name: string; group: string; size: SlideSize }[] = [
  { id: 'toc-acs', name: 'TOC graphic, ACS', group: 'Journal graphics', size: { w: 234, h: 126 } },
  { id: 'ga-elsevier', name: 'Graphical abstract, Elsevier', group: 'Journal graphics', size: { w: 368.5, h: 141.7 } },
  { id: 'toc-wiley', name: 'TOC graphic, Wiley', group: 'Journal graphics', size: { w: 155.9, h: 141.7 } },
  { id: 'toc-rsc', name: 'Graphical abstract, RSC', group: 'Journal graphics', size: { w: 226.8, h: 113.4 } },
  { id: 'figure-1', name: 'Journal figure, one column', group: 'Journal graphics', size: { w: 240, h: 216 } },
  { id: 'figure-2', name: 'Journal figure, two columns', group: 'Journal graphics', size: { w: 504, h: 288 } },
  { id: 'poster-36x48', name: 'Poster 36 × 48 in, portrait', group: 'Posters', size: { w: 2592, h: 3456 } },
  { id: 'poster-48x36', name: 'Poster 48 × 36 in, landscape', group: 'Posters', size: { w: 3456, h: 2592 } },
  { id: 'poster-a0', name: 'Poster A0', group: 'Posters', size: { w: 2384, h: 3370 } },
  { id: 'slide-wide', name: 'Slide 16:9', group: 'Screens', size: { w: 960, h: 540 } },
  { id: 'letter', name: 'Letter', group: 'Paper', size: { w: 612, h: 792 } },
  { id: 'letter-wide', name: 'Letter, landscape', group: 'Paper', size: { w: 792, h: 612 } },
  { id: 'a4', name: 'A4', group: 'Paper', size: { w: 595.3, h: 841.9 } },
];

/** How much larger than ACS 1996 structures are drawn on a design page: 1× on journal graphics and paper, 2× on slides, 4× on posters. */
export function designScale(size: SlideSize): number {
  const big = Math.max(size.w, size.h);
  return big <= 900 ? 1 : big <= 1300 ? 2 : 4;
}

export type LayoutId = 'title' | 'title-content' | 'two-content' | 'title-only' | 'blank';

export const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: 'title', name: 'Title Slide' },
  { id: 'title-content', name: 'Title and Content' },
  { id: 'two-content', name: 'Two Content' },
  { id: 'title-only', name: 'Title Only' },
  { id: 'blank', name: 'Blank' },
];

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** A picture used by the master (the logo). */
export interface Image { src: string; px: { w: number; h: number } }

export interface Master {
  /** Colour of every slide. */
  background: string;
  titleFont: string;
  bodyFont: string;
  titleSize: number;
  subtitleSize: number;
  bodySize: number;
  titleColor: string;
  textColor: string;
  titleBold: boolean;
  logo: Image | null;
  logoCorner: Corner;
  /** Width of the logo on the slide, in points. */
  logoWidth: number;
  slideNumbers: boolean;
  /** Numbers on Title Slide layouts too (PowerPoint leaves them off there). */
  numberTitleSlides: boolean;
  footer: string;
  /** Size and colour of the slide numbers and footer. */
  footerSize: number;
  footerColor: string;
  /** How structures are drawn on every slide: bond length, line widths, label size. */
  drawing: DocStyle;
  /** Structures pasted onto a slide are resized to the drawing style's bond length. */
  fitPasted: boolean;
}

/** ACS Document 1996 at twice the size: structures that read well on a projector. */
export function slideDrawingStyle(k = 2): DocStyle {
  const a = ACS_1996;
  return {
    ...a, name: `ACS Document 1996 × ${k}`,
    bondLength: a.bondLength * k, lineWidth: a.lineWidth * k, boldWidth: a.boldWidth * k, marginWidth: a.marginWidth * k,
    hashSpacing: a.hashSpacing * k, labelSize: a.labelSize * k, captionSize: a.captionSize * k,
  };
}

export function defaultMaster(): Master {
  return {
    background: '#ffffff',
    titleFont: 'Arial', bodyFont: 'Arial',
    titleSize: 36, subtitleSize: 24, bodySize: 24,
    titleColor: '#000000', textColor: '#000000', titleBold: true,
    logo: null, logoCorner: 'bottom-right', logoWidth: 72,
    slideNumbers: true, numberTitleSlides: false, footer: '', footerSize: 12, footerColor: '#7f7f7f',
    drawing: slideDrawingStyle(),
    fitPasted: true,
  };
}

/** The look of each kind of placeholder text, from the master. */
export function textStyles(m: Master): Record<Placeholder, TextBase> {
  return {
    title: { font: m.titleFont, size: m.titleSize, color: m.titleColor, bold: m.titleBold || undefined },
    subtitle: { font: m.bodyFont, size: m.subtitleSize, color: m.textColor },
    body: { font: m.bodyFont, size: m.bodySize, color: m.textColor },
  };
}

/** Where the slide number, footer and logo go on every slide (in points), as on screen and in saved files. */
export function decorFrames(size: SlideSize, m: Master): { number: Rect; footer: Rect; logo: Rect | null } {
  const mx = 0.05 * size.w, h = Math.max(m.footerSize * 1.6, 0.05 * size.h);
  const y1 = size.h - 0.035 * size.h - h;
  const number = { x1: size.w - mx - 0.18 * size.w, y1, x2: size.w - mx, y2: y1 + h };
  const footer = { x1: 0.3 * size.w, y1, x2: 0.7 * size.w, y2: y1 + h };
  let logo: Rect | null = null;
  if (m.logo) {
    const w = m.logoWidth, lh = (w * m.logo.px.h) / Math.max(1, m.logo.px.w);
    const pad = 0.025 * size.w;
    const x1 = m.logoCorner.endsWith('left') ? pad : size.w - pad - w;
    const top = m.logoCorner.startsWith('top') ? pad : size.h - pad - lh;
    logo = { x1, y1: top, x2: x1 + w, y2: top + lh };
  }
  return { number, footer, logo };
}

/** Does this slide show its number? */
export function showsNumber(m: Master, layout: LayoutId): boolean {
  return m.slideNumbers && (layout !== 'title' || m.numberTitleSlides);
}

/** A box on a slide that a layout fills with a placeholder. */
export interface Frame { ph: Placeholder; x: number; y: number; w: number; h: number; justify: Caption['justify'] }

/**
 * Where each layout puts its title and text, as fractions of the slide so they suit both sizes.
 * Two Content has two text boxes side by side (left first).
 */
const FRAMES: Record<LayoutId, [Placeholder, number, number, number, number, Caption['justify']][]> = {
  title: [['title', 0.08, 0.3, 0.84, 0.2, 'center'], ['subtitle', 0.08, 0.53, 0.84, 0.17, 'center']],
  'title-content': [['title', 0.05, 0.05, 0.9, 0.14, 'left'], ['body', 0.05, 0.22, 0.9, 0.68, 'left']],
  'two-content': [['title', 0.05, 0.05, 0.9, 0.14, 'left'], ['body', 0.05, 0.22, 0.44, 0.68, 'left'], ['body', 0.51, 0.22, 0.44, 0.68, 'left']],
  'title-only': [['title', 0.05, 0.05, 0.9, 0.14, 'left']],
  blank: [],
};

export function layoutFrames(layout: LayoutId, size: SlideSize): Frame[] {
  return FRAMES[layout].map(([ph, x, y, w, h, justify]) => ({ ph, x: x * size.w, y: y * size.h, w: w * size.w, h: h * size.h, justify }));
}

/** Text a placeholder starts with: body text is a bulleted list. */
function emptyParas(ph: Placeholder): ParaStyle[] | undefined {
  return ph === 'body' ? [{ list: 'bullet' }] : undefined;
}

/** Caption fields that put a placeholder in a frame (its first baseline sits one ascent below the top). */
export function frameFields(f: Frame, styles: Record<Placeholder, TextBase>): Pick<Caption, 'x' | 'y' | 'wrap' | 'boxH' | 'justify' | 'ph'> {
  const size = styles[f.ph].size ?? 18;
  return { ph: f.ph, x: f.x, y: f.y + ASCENT * size, wrap: f.w, boxH: f.h, justify: f.justify };
}

/** The box of a placeholder (its top-left corner and size), from its caption. */
export function placeholderRect(c: Caption, base: TextBase | undefined): Rect {
  const size = base?.size ?? 18;
  const top = c.y - ASCENT * size;
  return { x1: c.x, y1: top, x2: c.x + (c.wrap ?? 0), y2: top + (c.boxH ?? 0) };
}

export const isEmptyText = (c: Caption): boolean => !c.runs.some((r) => r.text.trim());

export interface Slide {
  /** Unique within the deck (for the slide list and the undo history). */
  id: number;
  layout: LayoutId;
  /** The slide's drawing while another slide is being edited. */
  doc: Doc;
  /** Speaker notes. */
  notes: string;
}

type HistoryEntry =
  | { kind: 'slide'; slide: Slide }
  | { kind: 'deck'; label: string; undo: () => void; redo: () => void };

export class Deck {
  size: SlideSize = { ...WIDE };
  master: Master = defaultMaster();
  slides: Slide[] = [];
  /** The slide being edited; its drawing is in `host`. */
  index = -1;
  /** Called whenever the deck changes in a way the slide list or title bar should show. */
  onChange: () => void = () => {};
  /** Called after the slide being edited changes (the editor clears its selection and redraws). */
  onSwitch: () => void = () => {};
  /** Counts changes (edits, undos and redos), so the file knows when it has unsaved changes. */
  edits = 0;
  private nextSlideId = 1;
  private undoList: HistoryEntry[] = [];
  private redoList: HistoryEntry[] = [];
  /** True while this deck's slide is in `host` (its tab is the one showing). */
  private attached = false;

  constructor(public host: Doc) {}

  get current(): Slide | null { return this.slides[this.index] ?? null; }

  /** The drawing of slide i, wherever it is. */
  docOf(i: number): Doc {
    return i === this.index && this.attached ? this.host : this.slides[i].doc;
  }

  /** Put the current slide into the app's document (its tab is shown). */
  attach(): void {
    if (this.attached || !this.current) return;
    this.host.swap(this.current.doc);
    this.attached = true;
    this.host.onCommit = () => this.noteSlideEdit();
  }

  /** Take the current slide out of the app's document (another tab is shown). */
  detach(): void {
    if (!this.attached || !this.current) return;
    this.host.onCommit = null;
    this.host.swap(this.current.doc);
    this.attached = false;
  }

  get isAttached(): boolean { return this.attached; }

  /** A new slide's drawing, set up from the master, with the layout's empty placeholders. */
  private newSlideDoc(layout: LayoutId): Doc {
    const d = new Doc();
    this.styleDoc(d);
    const styles = textStyles(this.master);
    d.bulk(() => {
      for (const f of layoutFrames(layout, this.size)) d.addCaption({ ...frameFields(f, styles), runs: [], paras: emptyParas(f.ph) });
    });
    return d;
  }

  /** Give a slide's drawing the master's drawing style and text styles. */
  private styleDoc(d: Doc): void {
    d.style = { ...this.master.drawing };
    d.background = this.master.background;
    d.textStyles = textStyles(this.master);
    d.allDirty = true;
    d.version++;
  }

  /** Make a slide from contents (opening a file, pasting slides). Not undoable on its own. */
  makeSlide(layout: LayoutId, contents?: Contents, notes = ''): Slide {
    const doc = new Doc();
    this.styleDoc(doc);
    if (contents) doc.restoreContents(contents);
    return { id: this.nextSlideId++, layout, doc, notes };
  }

  /** Start with these slides (a new deck or one read from a file), editing the first. Clears the history. */
  load(slides: Slide[], size: SlideSize, master: Master): void {
    this.detach();
    this.size = { ...size };
    this.master = master;
    this.slides = slides;
    for (const s of slides) {
      this.styleDoc(s.doc);
      if (s.id >= this.nextSlideId) this.nextSlideId = s.id + 1;
    }
    if (!slides.length) this.slides.push(this.makeSlide('title', this.newSlideDoc('title').contents()));
    this.index = 0;
    this.undoList.length = 0;
    this.redoList.length = 0;
  }

  /**
   * A new design (Design mode): one blank page of the size chosen, white, without slide numbers,
   * structures drawn at a size that suits the page (ACS 1996 on a TOC graphic, larger on a poster).
   */
  static design(host: Doc, size: SlideSize): Deck {
    const d = new Deck(host);
    const m = defaultMaster();
    m.slideNumbers = false;
    m.titleSize = 28; m.subtitleSize = 18; m.bodySize = 14;
    m.drawing = slideDrawingStyle(designScale(size));
    d.load([d.makeSlide('blank')], size, m);
    return d;
  }

  /** A new deck: one Title Slide. */
  static blank(host: Doc): Deck {
    const d = new Deck(host);
    d.load([], WIDE, defaultMaster());
    return d;
  }

  // ---------------------------------------------------------------- moving between slides

  /** Edit slide i. */
  go(i: number): void {
    i = Math.max(0, Math.min(this.slides.length - 1, i));
    if (i === this.index) return;
    const was = this.attached;
    this.detach();
    this.index = i;
    if (was) this.attach();
    this.onSwitch();
    this.onChange();
  }

  // ---------------------------------------------------------------- undo across slides

  /** The app's document recorded an edit on the current slide. */
  private noteSlideEdit(): void {
    const s = this.current;
    if (!s) return;
    this.undoList.push({ kind: 'slide', slide: s });
    if (this.undoList.length > 2000) this.undoList.shift();
    this.redoList.length = 0;
    this.edits++;
    this.onChange();
  }

  private record(label: string, undo: () => void, redo: () => void): void {
    this.undoList.push({ kind: 'deck', label, undo, redo });
    this.redoList.length = 0;
    this.edits++;
    this.onChange();
  }

  canUndo(): boolean { return this.undoList.length > 0; }
  canRedo(): boolean { return this.redoList.length > 0; }

  /** Undo the last change, going to the slide it was on. */
  undo(): boolean {
    const e = this.undoList.pop();
    if (!e) return false;
    if (e.kind === 'slide') {
      const i = this.slides.indexOf(e.slide);
      if (i < 0) return this.undo(); // the slide has gone (should not happen: its removal is undone first)
      this.go(i);
      this.host.undo();
    } else e.undo();
    this.redoList.push(e);
    this.edits++;
    this.onChange();
    return true;
  }

  redo(): boolean {
    const e = this.redoList.pop();
    if (!e) return false;
    if (e.kind === 'slide') {
      const i = this.slides.indexOf(e.slide);
      if (i < 0) return this.redo();
      this.go(i);
      this.host.redo();
    } else e.redo();
    this.undoList.push(e);
    this.edits++;
    this.onChange();
    return true;
  }

  // ---------------------------------------------------------------- slide operations

  /** Put slides in, at position `at`, and edit the first of them. */
  private insert(at: number, slides: Slide[], label: string): void {
    const beforeIndex = this.index;
    const doIt = () => {
      this.detachKeep(() => this.slides.splice(at, 0, ...slides));
      this.goFresh(at);
    };
    const undoIt = () => {
      this.detachKeep(() => this.slides.splice(at, slides.length));
      this.goFresh(beforeIndex);
    };
    doIt();
    this.record(label, undoIt, doIt);
  }

  /**
   * Change the list of slides with the current one taken out of the app's document, so its
   * drawing is safe in its own document whatever happens to the list.
   */
  private detachKeep(fn: () => void): void {
    const was = this.attached;
    this.detach();
    fn();
    this.index = Math.max(0, Math.min(this.index, this.slides.length - 1));
    if (was) this.attach();
  }

  /** Edit slide i after the list changed (even when its number is the same). */
  private goFresh(i: number): void {
    const was = this.attached;
    this.detach();
    this.index = Math.max(0, Math.min(i, this.slides.length - 1));
    if (was) this.attach();
    this.onSwitch();
    this.onChange();
  }

  /** A new slide after the current one. */
  addSlide(layout?: LayoutId): void {
    // as in PowerPoint, a new slide after the title slide gets Title and Content, otherwise the current layout
    const cur = this.current?.layout;
    const lay = layout ?? (!cur || cur === 'title' ? 'title-content' : cur);
    const s: Slide = { id: this.nextSlideId++, layout: lay, doc: this.newSlideDoc(lay), notes: '' };
    this.insert(this.index + 1, [s], 'New slide');
  }

  /** Copies of slides (the current one by default), after the last of them. */
  duplicate(indices: number[] = [this.index]): void {
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < this.slides.length).sort((a, b) => a - b);
    if (!sorted.length) return;
    const copies = sorted.map((i) => this.makeSlide(this.slides[i].layout, this.docOf(i).contents(), this.slides[i].notes));
    this.insert(sorted[sorted.length - 1] + 1, copies, sorted.length > 1 ? 'Duplicate slides' : 'Duplicate slide');
  }

  /** Delete slides (the current one by default). The last slide can't be deleted. */
  remove(indices: number[] = [this.index]): boolean {
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < this.slides.length).sort((a, b) => a - b);
    if (!sorted.length || sorted.length >= this.slides.length) return false;
    const before = this.slides.slice();
    const beforeIndex = this.index;
    const gone = new Set(sorted.map((i) => this.slides[i]));
    const after = before.filter((s) => !gone.has(s));
    const afterIndex = Math.min(sorted[0], after.length - 1);
    const doIt = () => { this.detachKeep(() => { this.slides = after.slice(); }); this.goFresh(afterIndex); };
    const undoIt = () => { this.detachKeep(() => { this.slides = before.slice(); }); this.goFresh(beforeIndex); };
    doIt();
    this.record(sorted.length > 1 ? 'Delete slides' : 'Delete slide', undoIt, doIt);
    return true;
  }

  /** Move slides so the first of them ends up at position `to` (counted in the list without them). */
  move(indices: number[], to: number): void {
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < this.slides.length).sort((a, b) => a - b);
    if (!sorted.length) return;
    const before = this.slides.slice();
    const moving = sorted.map((i) => before[i]);
    const rest = before.filter((s) => !moving.includes(s));
    to = Math.max(0, Math.min(rest.length, to));
    const after = [...rest.slice(0, to), ...moving, ...rest.slice(to)];
    if (after.every((s, i) => s === before[i])) return;
    const cur = this.current!;
    const doIt = () => { this.detachKeep(() => { this.slides = after.slice(); }); this.goFresh(after.indexOf(cur)); };
    const undoIt = () => { this.detachKeep(() => { this.slides = before.slice(); }); this.goFresh(before.indexOf(cur)); };
    doIt();
    this.record(moving.length > 1 ? 'Move slides' : 'Move slide', undoIt, doIt);
  }

  /** Change the layout of the current slide: its placeholders move to the new layout's places. */
  setLayout(layout: LayoutId, i = this.index): void {
    const slide = this.slides[i];
    if (!slide || slide.layout === layout) return;
    const old = slide.layout;
    this.contentEdit('Change layout', [i], () => {
      slide.layout = layout;
      const d = this.docOf(i);
      d.bulk(() => this.fitPlaceholders(d, layout));
    }, () => { slide.layout = old; }, () => { slide.layout = layout; });
  }

  /**
   * Put a slide's placeholders in its layout's places: placeholders the layout has keep their
   * text and move there; missing ones are added empty; ones it doesn't have are removed when
   * empty and otherwise kept where they are (so no text is lost).
   */
  private fitPlaceholders(d: Doc, layout: LayoutId): void {
    const styles = textStyles(this.master);
    const frames = layoutFrames(layout, this.size);
    const have = [...d.captions.values()].filter((c) => c.ph);
    const used = new Set<Caption>();
    for (const f of frames) {
      // the same kind of placeholder, in reading order (two text boxes: left, then right)
      const c = have.filter((x) => x.ph === f.ph && !used.has(x)).sort((a, b) => a.x - b.x || a.y - b.y)[0]
        ?? (f.ph === 'subtitle' || f.ph === 'body' ? have.filter((x) => (x.ph === 'subtitle' || x.ph === 'body') && !used.has(x)).sort((a, b) => a.x - b.x || a.y - b.y)[0] : undefined);
      const fields = frameFields(f, styles);
      if (c) {
        used.add(c);
        const paras = c.ph !== f.ph && isEmptyText(c) ? emptyParas(f.ph) : c.paras;
        d.updateCaption(c.id, { ...fields, paras });
      } else d.addCaption({ ...fields, runs: [], paras: emptyParas(f.ph) });
    }
    for (const c of have) if (!used.has(c) && isEmptyText(c)) d.removeCaption(c.id);
  }

  /**
   * Change the drawings of some slides outside their own undo histories, as one step of the
   * deck's history (for changes that go with deck settings, such as a slide's layout).
   */
  private contentEdit(label: string, indices: number[], fn: () => void, undoDeck: () => void, redoDeck: () => void): void {
    const slides = indices.map((i) => this.slides[i]);
    const before = indices.map((i) => this.docOf(i).contents());
    fn();
    const after = indices.map((i) => this.docOf(i).contents());
    const put = (states: Contents[]) => {
      slides.forEach((s, k) => {
        const i = this.slides.indexOf(s);
        if (i >= 0) this.docOf(i).restoreContents(states[k]);
      });
      this.onSwitch();
    };
    this.onSwitch();
    this.record(label, () => { undoDeck(); put(before); }, () => { redoDeck(); put(after); });
  }

  /** Change the master (fonts, colours, background, logo, numbers, drawing style). */
  setMaster(m: Master): void {
    const before = this.master;
    const apply = (x: Master) => {
      this.master = x;
      for (let i = 0; i < this.slides.length; i++) this.styleDoc(this.docOf(i));
      this.onSwitch();
    };
    apply(m);
    this.record('Change slide master', () => apply(before), () => apply(m));
  }

  /** Change the slide size: everything stays centred, and placeholders move to the layout's places. */
  setSize(size: SlideSize): void {
    if (size.w === this.size.w && size.h === this.size.h) return;
    const old = { ...this.size };
    const dx = (size.w - old.w) / 2, dy = (size.h - old.h) / 2;
    const all = this.slides.map((_, i) => i);
    this.contentEdit('Change slide size', all, () => {
      this.size = { ...size };
      for (const i of all) {
        const d = this.docOf(i);
        d.bulk(() => {
          d.moveAtoms([...d.atoms.keys()], dx, dy);
          for (const c of [...d.captions.values()]) if (!c.ph) d.updateCaption(c.id, { x: c.x + dx, y: c.y + dy });
          for (const r of [...d.arrows.values()]) d.updateArrow(r.id, { tail: { x: r.tail.x + dx, y: r.tail.y + dy }, head: { x: r.head.x + dx, y: r.head.y + dy } });
          for (const s of [...d.shapes.values()]) d.updateShape(s.id, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
          this.fitPlaceholders(d, this.slides[i].layout);
        });
      }
    }, () => { this.size = old; }, () => { this.size = { ...size }; });
  }

  /** Change a slide's speaker notes. */
  setNotes(text: string, i = this.index): void {
    const s = this.slides[i];
    if (!s || s.notes === text) return;
    const before = s.notes;
    s.notes = text;
    this.record('Edit notes', () => { s.notes = before; this.onSwitch(); }, () => { s.notes = text; this.onSwitch(); });
  }
}
