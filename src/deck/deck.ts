// A slide deck: slides of one size, each with a layout and a drawing of its own, and a slide
// master that sets the look of every slide (fonts, colours, background, logo, slide numbers,
// and the drawing style of structures).
//
// The slide being edited lives in the app's one document (see Doc.swap), so every drawing
// tool, check and chemistry feature works on slides exactly as on a drawing. The other slides
// wait in documents of their own. The deck keeps one undo history across all slides: an edit
// on a slide is undone on that slide (the deck goes back to it), and adding, deleting or
// moving slides, or changing the master, are undone too.

import { copyPinned, type PinnedComment } from '../document/comments';
import { Doc, Caption, Placeholder, TextBase, ParaStyle, Contents, applyBase } from '../model';
import { DocStyle, ACS_1996 } from '../style';
import { applyStyle, type RestyleHow } from '../drawing-styles';
import type { Rect } from '../geom';
import { ASCENT } from '../text/layout';
import { slideIdLinks } from '../links';
import type { Transition, Anim } from './animation';
import { backgroundColour, copyBackground, isPlain, sameBackground, solid, type Background } from './background';

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

/** The five layouts every deck has (PowerPoint's own, by the same names). */
export type BuiltinLayout = 'title' | 'title-content' | 'two-content' | 'title-only' | 'blank';
/** A slide's layout: one of the five built in, or one made in the slide master ('u1', 'u2'…). */
export type LayoutId = string;

export const LAYOUTS: { id: BuiltinLayout; name: string }[] = [
  { id: 'title', name: 'Title Slide' },
  { id: 'title-content', name: 'Title and Content' },
  { id: 'two-content', name: 'Two Content' },
  { id: 'title-only', name: 'Title Only' },
  { id: 'blank', name: 'Blank' },
];

export const isBuiltinLayout = (id: string): id is BuiltinLayout => LAYOUTS.some((l) => l.id === id);

/** A placeholder's box on a layout, as fractions of the slide (so it suits any slide size). */
export interface PlaceholderBox { ph: Placeholder; x: number; y: number; w: number; h: number; justify: Caption['justify'] }

/**
 * A layout as the slide master has it: its name and placeholders. The built-in layouts can be
 * renamed and their placeholders moved; layouts made here can be anything. `titleLook` gives
 * slides with it the title slide's own colours and background (always so on Title Slide).
 */
export interface LayoutDef { id: LayoutId; name: string; boxes: PlaceholderBox[]; titleLook?: boolean }

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** A picture used by the master (the logo). */
export interface Image { src: string; px: { w: number; h: number } }

export interface Master {
  /** Colour of every slide (the main colour of `fill` when there is one). */
  background: string;
  /** Every slide's background when it is more than a colour: a gradient, picture, pattern or see-through colour (Format Background > Apply to All). */
  fill?: Background;
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
  /** The design template's accent colours (its bars and lines) and the shapes it draws behind every slide. */
  accent: string;
  accent2: string;
  decor: Decor;
  /** Title slides' own background and text colours (a dark title slide); as other slides when not set. */
  titleSlide?: { background: string; titleColor: string; textColor: string; footerColor?: string; fill?: Background };
  /** The template's name, when one was used (Design > Templates). */
  template?: string;
  /** Layouts changed or made in the slide master: built-in ones (by their own ids) as edited, then new ones in the order shown. */
  layouts?: LayoutDef[];
}

/**
 * Shapes a design template draws behind every slide, in its accent colours: a bar along the top,
 * a band behind the title, a strip down the left side, a rule under the title, triangles in a
 * corner, a band along the bottom, or a frame round the slide.
 */
export type Decor = 'none' | 'top-bar' | 'title-band' | 'left-strip' | 'title-rule' | 'corner' | 'footer-band' | 'frame';

export const DECORS: { id: Decor; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'top-bar', name: 'Bar along the top' },
  { id: 'title-band', name: 'Band behind the title' },
  { id: 'left-strip', name: 'Strip down the left side' },
  { id: 'title-rule', name: 'Rule under the title' },
  { id: 'corner', name: 'Triangles in the corner' },
  { id: 'footer-band', name: 'Band along the bottom' },
  { id: 'frame', name: 'Frame round the slide' },
];

/** The colours a slide with this layout uses: title slides can have their own. */
export function slideColours(m: Master, layout: LayoutId): { background: string; titleColor: string; textColor: string; footerColor: string } {
  const t = titleLook(m, layout) ? m.titleSlide : undefined;
  return {
    background: t?.background ?? m.background,
    titleColor: t?.titleColor ?? m.titleColor,
    textColor: t?.textColor ?? m.textColor,
    footerColor: t?.footerColor ?? (t ? t.textColor : m.footerColor),
  };
}

/**
 * The background of a slide with this layout: its own (Format Background) when it has one, else
 * the title slides' own, else the master's.
 */
export function slideBackground(m: Master, layout: LayoutId, own?: Background): Background {
  if (own) return own;
  const t = titleLook(m, layout) ? m.titleSlide : undefined;
  if (t) return t.fill ?? solid(t.background);
  return m.fill ?? solid(m.background);
}

/** One of a template's shapes: a box, a line (x1,y1 to x2,y2, `width` points wide), or a filled triangle. */
export type DecorShape =
  | { kind: 'rect'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: 'frame'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: 'tri'; pts: [number, number][]; color: string };

/** Where a template's shapes go on a slide of this size and layout, in points. */
export function decorShapes(size: SlideSize, m: Master, layout: LayoutId): DecorShape[] {
  const { w, h } = size;
  const title = titleLook(m, layout);
  const a = m.accent, b = m.accent2;
  switch (m.decor) {
    case 'top-bar':
      return title
        ? [{ kind: 'rect', x1: 0, y1: 0, x2: w, y2: 0.035 * h, color: a }, { kind: 'rect', x1: 0, y1: h - 0.035 * h, x2: w, y2: h, color: a }]
        : [{ kind: 'rect', x1: 0, y1: 0, x2: w, y2: 0.022 * h, color: a }];
    case 'title-band':
      return title
        ? [{ kind: 'rect', x1: 0, y1: 0.27 * h, x2: w, y2: 0.515 * h, color: a }]
        : [{ kind: 'rect', x1: 0, y1: 0, x2: w, y2: 0.2 * h, color: a }];
    case 'left-strip':
      return [{ kind: 'rect', x1: 0, y1: 0, x2: (title ? 0.035 : 0.014) * w, y2: h, color: a }];
    case 'title-rule':
      return title
        ? [{ kind: 'line', x1: 0.3 * w, y1: 0.515 * h, x2: 0.7 * w, y2: 0.515 * h, color: a, width: 2 }]
        : [{ kind: 'line', x1: 0.05 * w, y1: 0.2 * h, x2: 0.95 * w, y2: 0.2 * h, color: a, width: 2 }];
    case 'corner': {
      const k = (title ? 0.34 : 0.2) * h;
      return [
        { kind: 'tri', pts: [[w, h - 1.6 * k], [w, h], [w - 1.6 * k, h]], color: b },
        { kind: 'tri', pts: [[w, h - k], [w, h], [w - k, h]], color: a },
      ];
    }
    case 'footer-band':
      return [{ kind: 'rect', x1: 0, y1: (title ? 0.86 : 0.905) * h, x2: w, y2: h, color: a }];
    case 'frame': {
      const d = 0.02 * Math.min(w, h) + 0.012 * w;
      return [{ kind: 'frame', x1: d, y1: d, x2: w - d, y2: h - d, color: a, width: 1.5 }];
    }
    default:
      return [];
  }
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
    accent: '#2f6fdf', accent2: '#9aa5b1', decor: 'none',
  };
}

/** A master from a saved file, with the settings newer than the file filled in. */
export function completeMaster(m: Partial<Master>): Master {
  return { ...defaultMaster(), ...m };
}

/** The look of each kind of placeholder text, from the master (on a title slide, in its own colours). */
export function textStyles(m: Master, layout?: LayoutId): Record<Placeholder, TextBase> {
  const c = layout ? slideColours(m, layout) : m;
  return {
    title: { font: m.titleFont, size: m.titleSize, color: c.titleColor, bold: m.titleBold || undefined },
    subtitle: { font: m.bodyFont, size: m.subtitleSize, color: c.textColor },
    body: { font: m.bodyFont, size: m.bodySize, color: c.textColor },
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
  return m.slideNumbers && (!titleLook(m, layout) || m.numberTitleSlides);
}

/** A box on a slide that a layout fills with a placeholder. */
export interface Frame { ph: Placeholder; x: number; y: number; w: number; h: number; justify: Caption['justify'] }

/**
 * Where each built-in layout puts its title and text, as fractions of the slide so they suit both
 * sizes. Two Content has two text boxes side by side (left first).
 */
const FRAMES: Record<BuiltinLayout, [Placeholder, number, number, number, number, Caption['justify']][]> = {
  title: [['title', 0.08, 0.3, 0.84, 0.2, 'center'], ['subtitle', 0.08, 0.53, 0.84, 0.17, 'center']],
  'title-content': [['title', 0.05, 0.05, 0.9, 0.14, 'left'], ['body', 0.05, 0.22, 0.9, 0.68, 'left']],
  'two-content': [['title', 0.05, 0.05, 0.9, 0.14, 'left'], ['body', 0.05, 0.22, 0.44, 0.68, 'left'], ['body', 0.51, 0.22, 0.44, 0.68, 'left']],
  'title-only': [['title', 0.05, 0.05, 0.9, 0.14, 'left']],
  blank: [],
};

/** A built-in layout as it comes, before any change in the slide master. */
export function builtinLayout(id: BuiltinLayout): LayoutDef {
  return {
    id, name: LAYOUTS.find((l) => l.id === id)!.name,
    boxes: FRAMES[id].map(([ph, x, y, w, h, justify]) => ({ ph, x, y, w, h, justify })),
    ...(id === 'title' ? { titleLook: true } : {}),
  };
}

export const copyLayout = (l: LayoutDef): LayoutDef => ({ ...l, boxes: l.boxes.map((b) => ({ ...b })) });

/** Every layout of a deck with this master, in the order the slide master shows them: the five built in (as edited), then the ones made here. */
export function deckLayouts(m: Master | undefined): LayoutDef[] {
  const own = m?.layouts ?? [];
  return [
    ...LAYOUTS.map((l) => own.find((x) => x.id === l.id) ?? builtinLayout(l.id)),
    ...own.filter((x) => !isBuiltinLayout(x.id)),
  ];
}

/** A layout of the deck (Title and Content in place of one the deck doesn't have). */
export function layoutDef(m: Master | undefined, id: LayoutId): LayoutDef {
  const own = m?.layouts?.find((x) => x.id === id);
  if (own) return own;
  return builtinLayout(isBuiltinLayout(id) ? id : 'title-content');
}

/** Is this one of the deck's layouts? */
export const hasLayout = (m: Master | undefined, id: LayoutId): boolean => isBuiltinLayout(id) || !!m?.layouts?.some((x) => x.id === id);

/** Does a slide with this layout have the title slide's own colours and background? */
export function titleLook(m: Master | undefined, id: LayoutId): boolean {
  const own = m?.layouts?.find((x) => x.id === id);
  return own ? (own.titleLook ?? id === 'title') : id === 'title';
}

/** A name for a new layout: its id ('u1', 'u2'…) not yet used in the deck. */
export function newLayoutId(layouts: LayoutDef[]): LayoutId {
  let n = 1;
  while (layouts.some((l) => l.id === `u${n}`)) n++;
  return `u${n}`;
}

/**
 * Where pasted and inserted things go on a slide of this layout: its text boxes' area (below the
 * title on slides with a title and no text box), the middle of a title slide, and inside the
 * margins of a slide without placeholders.
 */
export function contentArea(layout: LayoutId, size: SlideSize, m?: Master): Rect {
  const box = (x: number, y: number, w: number, h: number): Rect => ({ x1: x * size.w, y1: y * size.h, x2: (x + w) * size.w, y2: (y + h) * size.h });
  const def = layoutDef(m, layout);
  if (!def.boxes.length) return box(0.05, 0.05, 0.9, 0.9);
  if (titleLook(m, layout)) return box(0.08, 0.08, 0.84, 0.84);
  const bodies = def.boxes.filter((b) => b.ph !== 'title');
  if (!bodies.length) return box(0.05, 0.22, 0.9, 0.68);
  const x1 = Math.min(...bodies.map((b) => b.x)), y1 = Math.min(...bodies.map((b) => b.y));
  const x2 = Math.max(...bodies.map((b) => b.x + b.w)), y2 = Math.max(...bodies.map((b) => b.y + b.h));
  return box(x1, y1, x2 - x1, y2 - y1);
}

/** Where a layout's placeholders go on a slide of this size, in points (the master's own layouts when given). */
export function layoutFrames(layout: LayoutId, size: SlideSize, m?: Master): Frame[] {
  return layoutDef(m, layout).boxes.map((b) => ({ ph: b.ph, x: b.x * size.w, y: b.y * size.h, w: b.w * size.w, h: b.h * size.h, justify: b.justify }));
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
  /** How the slide comes in during the slide show. */
  transition?: Transition;
  /** Its objects' animations, in the order they play. */
  anims?: Anim[];
  /** Comments pinned to points on it (Review > New Comment). */
  comments?: PinnedComment[];
  /** Its own background (Design > Format Background); the master's when not set. */
  background?: Background;
  /** The master's shapes and logo are left off this slide (Format Background > Hide background graphics). */
  hideGraphics?: boolean;
  /** Hide Slide: skipped in the slide show, but kept (and saved) with the rest. */
  hidden?: boolean;
  /** The section it is in (Deck.sections), when the deck has sections. */
  section?: number;
}

/**
 * A section of the deck (Add Section, as in PowerPoint): a named run of slides, folded and moved
 * as one in the slide list. Once a deck has sections every slide is in one; a section can be
 * empty.
 */
export interface Section { id: number; name: string }

/** A deck's sections as saved: each one's name and how many slides it has, in order. */
export interface SectionCount { name: string; count: number }

/** How things on the slides fit a new slide size: kept as they are (centred), made as big as will fit (Ensure Fit), or as big as the slide allows (Maximize). */
export type SizeFit = 'centre' | 'fit' | 'max';

/** A slide's transition, animations, comments, own background and whether it is hidden, copied (for duplicates and the undo history). */
export interface Motion { transition?: Transition; anims?: Anim[]; comments?: PinnedComment[]; background?: Background; hideGraphics?: boolean; hidden?: boolean }
const copyMotion = (m: Motion): Motion => ({
  ...(m.transition ? { transition: { ...m.transition } } : {}),
  ...(m.anims?.length ? { anims: m.anims.map((a) => ({ ...a, target: { ...a.target } })) } : {}),
  ...(m.comments?.length ? { comments: copyPinned(m.comments) } : {}),
  ...(m.background ? { background: copyBackground(m.background) } : {}),
  ...(m.hideGraphics ? { hideGraphics: true } : {}),
  ...(m.hidden ? { hidden: true } : {}),
});

/** A slide copied out of a deck (Copy, or Reuse Slides): its layout, drawing, notes and the rest. */
export interface SlideCopy { layout: LayoutId; contents: Contents; notes: string; motion: Motion }

/** Slides copied out of a deck, with the size and master they were made for. */
export interface SlideSource { size: SlideSize; master: Master; slides: SlideCopy[] }

/** Give a slide's drawing a master's drawing style and text styles (a title slide's in its own colours), and its background's colour. */
function styleWith(d: Doc, m: Master, layout: LayoutId, own?: Background): void {
  d.style = { ...m.drawing };
  d.background = backgroundColour(slideBackground(m, layout, own));
  d.textStyles = textStyles(m, layout);
  d.allDirty = true;
  d.version++;
}

/**
 * Move what is on a slide (but its placeholders) for a new slide size: about the middle, scaled
 * by k (structures with their bond lengths and labels, arrows with their heads, shapes and the
 * places of text; text keeps its size).
 */
function scaleContents(d: Doc, from: SlideSize, to: SlideSize, k: number): void {
  const at = (x: number, y: number) => ({ x: to.w / 2 + (x - from.w / 2) * k, y: to.h / 2 + (y - from.h / 2) * k });
  if (k === 1) {
    const dx = (to.w - from.w) / 2, dy = (to.h - from.h) / 2;
    d.moveAtoms([...d.atoms.keys()], dx, dy);
  } else {
    for (const a of [...d.atoms.values()]) d.updateAtom(a.id, { ...at(a.x, a.y), s: (a.s ?? 1) * k });
    for (const b of [...d.bonds.values()]) d.updateBond(b.id, { s: (b.s ?? 1) * k });
  }
  for (const c of [...d.captions.values()]) if (!c.ph) d.updateCaption(c.id, at(c.x, c.y));
  for (const r of [...d.arrows.values()]) {
    d.updateArrow(r.id, { tail: at(r.tail.x, r.tail.y), head: at(r.head.x, r.head.y), ...(k !== 1 ? { headLength: r.headLength * k, headWidth: r.headWidth * k } : {}) });
  }
  for (const s of [...d.shapes.values()]) {
    const p1 = at(s.x1, s.y1), p2 = at(s.x2, s.y2);
    d.updateShape(s.id, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
  }
}

const sameStyle = (a: DocStyle, b: DocStyle) => JSON.stringify({ ...a, name: '' }) === JSON.stringify({ ...b, name: '' });

type HistoryEntry =
  | { kind: 'slide'; slide: Slide }
  | { kind: 'deck'; label: string; undo: () => void; redo: () => void; slide?: Slide };

export class Deck {
  size: SlideSize = { ...WIDE };
  master: Master = defaultMaster();
  slides: Slide[] = [];
  /** The deck's sections, in order (none until Add Section). Their slides are together, in this order. */
  sections: Section[] = [];
  /** Sections folded in the slide list and Slide Sorter (on screen only). */
  folded = new Set<number>();
  /** The slide being edited; its drawing is in `host`. */
  index = -1;
  /** Called whenever the deck changes in a way the slide list or title bar should show. */
  onChange: () => void = () => {};
  /** Called after the slide being edited changes (the editor clears its selection and redraws). */
  onSwitch: () => void = () => {};
  /** Called when a slide's transition or animations change (also on undo and redo). */
  onMotion: () => void = () => {};
  /** Called when a slide's comments change (also on undo and redo). */
  onComments: () => void = () => {};
  /** Counts changes (edits, undos and redos), so the file knows when it has unsaved changes. */
  edits = 0;
  /** Counts changes to slides' own backgrounds (the slide list draws them again). */
  looks = 0;
  private nextSlideId = 1;
  private nextSectionId = 1;
  private undoList: HistoryEntry[] = [];
  private redoList: HistoryEntry[] = [];
  /** True while this deck's slide is in `host` (its tab is the one showing). */
  private attached = false;

  constructor(public host: Doc) {}

  get current(): Slide | null { return this.slides[this.index] ?? null; }

  /** What slide i's page needs to be drawn: its size, master, layout, number and background. */
  page(i = this.index): { size: SlideSize; master: Master; layout: LayoutId; index: number; own?: Background; hideGraphics?: boolean } {
    const s = this.slides[i];
    return { size: this.size, master: this.master, layout: s?.layout ?? 'blank', index: i, own: s?.background, hideGraphics: s?.hideGraphics };
  }

  /** Restyle every slide's drawing after the master or backgrounds change. */
  private restyleAll(): void {
    for (let i = 0; i < this.slides.length; i++) this.styleDoc(this.docOf(i), this.slides[i].layout, this.slides[i].background);
  }

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
    this.host.onAmend = () => { this.edits++; this.onChange(); };
  }

  /** Take the current slide out of the app's document (another tab is shown). */
  detach(): void {
    if (!this.attached || !this.current) return;
    this.host.onCommit = null;
    this.host.onAmend = null;
    this.host.swap(this.current.doc);
    this.attached = false;
  }

  get isAttached(): boolean { return this.attached; }

  /** A new slide's drawing, set up from the master, with the layout's empty placeholders. */
  private newSlideDoc(layout: LayoutId): Doc {
    const d = new Doc();
    this.styleDoc(d, layout);
    const styles = textStyles(this.master, layout);
    d.bulk(() => {
      for (const f of layoutFrames(layout, this.size, this.master)) d.addCaption({ ...frameFields(f, styles), runs: [], paras: emptyParas(f.ph) });
    });
    return d;
  }

  /** Give a slide's drawing the master's drawing style and text styles (a title slide's in its own colours), and its background's colour. */
  private styleDoc(d: Doc, layout: LayoutId, own?: Background): void {
    styleWith(d, this.master, layout, own);
  }

  /** Make a slide from contents (opening a file, pasting slides). Not undoable on its own. */
  makeSlide(layout: LayoutId, contents?: Contents, notes = '', motion: Motion = {}, master = this.master): Slide {
    const doc = new Doc();
    styleWith(doc, master, layout, motion.background);
    if (contents) doc.restoreContents(contents);
    return { id: this.nextSlideId++, layout, doc, notes, ...copyMotion(motion) };
  }

  /** Start with these slides (a new deck or one read from a file), editing the first. Clears the history. */
  load(slides: Slide[], size: SlideSize, master: Master, sections?: SectionCount[]): void {
    this.detach();
    this.size = { ...size };
    this.master = master;
    this.slides = slides;
    this.sections = [];
    this.folded.clear();
    for (const s of slides) {
      delete s.section;
      if (!hasLayout(master, s.layout)) s.layout = 'title-content';
    }
    if (sections?.length) {
      let at = 0;
      for (const sc of sections) {
        const sec = { id: this.nextSectionId++, name: sc.name };
        this.sections.push(sec);
        for (const s of slides.slice(at, at + Math.max(0, sc.count))) s.section = sec.id;
        at += Math.max(0, sc.count);
      }
      // slides the file left out of its sections go in the last one
      for (const s of slides.slice(at)) s.section = this.sections[this.sections.length - 1].id;
    }
    const ids = slides.map((s) => s.id);
    for (const s of slides) {
      this.styleDoc(s.doc, s.layout, s.background);
      if (s.id >= this.nextSlideId) this.nextSlideId = s.id + 1;
      // links read from a file name slides by their place: now by their ids
      const c = s.doc.contents(), c2 = slideIdLinks(c, ids);
      if (c2 !== c) s.doc.restoreContents(c2);
    }
    if (!slides.length) this.slides.push(this.makeSlide('title', this.newSlideDoc('title').contents()));
    if (this.sections.length) for (const s of this.slides) s.section ??= this.sections[0].id;
    this.index = 0;
    this.undoList.length = 0;
    this.redoList.length = 0;
  }

  /**
   * A new design (Design mode): one blank page of the size chosen, white, without slide numbers,
   * structures drawn at a size that suits the page (ACS 1996 on a TOC graphic, larger on a poster).
   */
  static design(host: Doc, size: SlideSize, fill?: (doc: Doc) => void): Deck {
    const d = new Deck(host);
    const m = defaultMaster();
    m.slideNumbers = false;
    m.titleSize = 28; m.subtitleSize = 18; m.bodySize = 14;
    m.drawing = slideDrawingStyle(designScale(size));
    d.load([d.makeSlide('blank')], size, m);
    if (fill) {
      // a template's shapes are where the page starts, not a step to undo
      const tmp = new Doc();
      d.styleDoc(tmp, 'blank');
      tmp.edit('Template', () => fill(tmp));
      d.slides[0].doc.restoreContents(tmp.contents());
    }
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

  /** Record a change to the deck; `slide` is the one slide it changed, gone to on undo and redo so the change is seen. */
  private record(label: string, undo: () => void, redo: () => void, slide?: Slide): void {
    this.undoList.push({ kind: 'deck', label, undo, redo, slide });
    this.redoList.length = 0;
    this.edits++;
    this.onChange();
  }

  canUndo(): boolean { return this.undoList.length > 0; }
  canRedo(): boolean { return this.redoList.length > 0; }
  /** The name of the step Undo (or Redo) would take back: a slide's own step, or the deck change. */
  get undoLabel(): string { return this.labelOf(this.undoList[this.undoList.length - 1], false); }
  get redoLabel(): string { return this.labelOf(this.redoList[this.redoList.length - 1], true); }
  private labelOf(e: HistoryEntry | undefined, redo: boolean): string {
    if (!e) return '';
    return e.kind === 'deck' ? e.label : redo ? e.slide.doc.redoLabel : e.slide.doc.undoLabel;
  }

  /** Undo the last change, going to the slide it was on. */
  undo(): boolean {
    const e = this.undoList.pop();
    if (!e) return false;
    if (e.kind === 'slide') {
      const i = this.slides.indexOf(e.slide);
      if (i < 0) return this.undo(); // the slide has gone (should not happen: its removal is undone first)
      this.go(i);
      this.host.undo();
    } else {
      this.showSlide(e.slide);
      e.undo();
    }
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
    } else {
      this.showSlide(e.slide);
      e.redo();
    }
    this.undoList.push(e);
    this.edits++;
    this.onChange();
    return true;
  }

  /** Go to a slide (if it is still in the deck) before its change is undone or redone. */
  private showSlide(s: Slide | undefined): void {
    const i = s ? this.slides.indexOf(s) : -1;
    if (i >= 0 && i !== this.index) this.go(i);
  }

  // ---------------------------------------------------------------- slide operations

  /** Put slides in, at position `at`, and edit the first of them. */
  private insert(at: number, slides: Slide[], label: string, master?: Master): void {
    const beforeIndex = this.index;
    const beforeMaster = this.master;
    // new slides go in the section of the slide before them (the first section at the start)
    const sec = this.sections.length ? (this.slides[at - 1]?.section ?? this.slides[at]?.section ?? this.sections[0].id) : undefined;
    for (const s of slides) { if (sec === undefined) delete s.section; else s.section = sec; }
    const useMaster = (m: Master) => { if (this.master !== m) { this.master = m; this.restyleAll(); } };
    const doIt = () => {
      if (master) useMaster(master);
      this.detachKeep(() => this.slides.splice(at, 0, ...slides));
      this.goFresh(at);
    };
    const undoIt = () => {
      this.detachKeep(() => this.slides.splice(at, slides.length));
      if (master) useMaster(beforeMaster);
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

  /**
   * A new slide of a layout at place `at` (0 is first), filled in by `fill` (Insert > Summary
   * Zoom), as one step of the history.
   */
  insertSlide(at: number, layout: LayoutId, fill: (doc: Doc) => void, label = 'New slide'): Slide {
    const doc = this.newSlideDoc(layout);
    doc.bulk(() => fill(doc));
    const s: Slide = { id: this.nextSlideId++, layout, doc, notes: '' };
    this.insert(Math.max(0, Math.min(this.slides.length, at)), [s], label);
    return s;
  }

  /**
   * Change the drawings of slides (other than through their own undo), as one step of the deck's
   * history: ink kept from the slide show, say.
   */
  editSlides(label: string, indices: number[], fn: (doc: Doc, i: number) => void): void {
    this.contentEdit(label, indices, () => { for (const i of indices) { const d = this.docOf(i); d.bulk(() => fn(d, i)); } }, () => {}, () => {});
  }

  /** Copies of slides (the current one by default), after the last of them. */
  duplicate(indices: number[] = [this.index]): void {
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < this.slides.length).sort((a, b) => a - b);
    if (!sorted.length) return;
    const copies = sorted.map((i) => this.makeSlide(this.slides[i].layout, this.docOf(i).contents(), this.slides[i].notes, this.slides[i]));
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

  /**
   * Move slides so the first of them ends up at position `to` (counted in the list without them).
   * In a deck with sections they join the section of the slide before them, or `section` when
   * given (dropped on a section's heading: `to` is then where that section starts).
   */
  move(indices: number[], to: number, section?: number): void {
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < this.slides.length).sort((a, b) => a - b);
    if (!sorted.length) return;
    const before = this.slides.slice();
    const moving = sorted.map((i) => before[i]);
    const rest = before.filter((s) => !moving.includes(s));
    to = Math.max(0, Math.min(rest.length, to));
    const secsBefore = moving.map((s) => s.section);
    let target: number | undefined;
    if (this.sections.length) target = section ?? rest[to - 1]?.section ?? rest[to]?.section ?? this.sections[0].id;
    const secsAfter = moving.map(() => target);
    const after = this.inSectionOrder([...rest.slice(0, to), ...moving, ...rest.slice(to)], new Map(moving.map((s) => [s, target])));
    if (after.every((s, i) => s === before[i]) && secsBefore.every((x, k) => x === secsAfter[k])) return;
    const cur = this.current!;
    const put = (list: Slide[], secs: (number | undefined)[]) => {
      this.detachKeep(() => {
        this.slides = list.slice();
        moving.forEach((s, k) => { if (secs[k] === undefined) delete s.section; else s.section = secs[k]; });
      });
      this.goFresh(list.indexOf(cur));
    };
    put(after, secsAfter);
    this.record(moving.length > 1 ? 'Move slides' : 'Move slide', () => put(before, secsBefore), () => put(after, secsAfter));
  }

  /** The slides with those in `secs` given new sections, ordered by section (keeping their order within each). */
  private inSectionOrder(list: Slide[], secs = new Map<Slide, number | undefined>()): Slide[] {
    if (!this.sections.length) return list;
    const rank = new Map(this.sections.map((x, i) => [x.id, i]));
    const of = (s: Slide) => rank.get((secs.has(s) ? secs.get(s) : s.section) ?? -1) ?? 0;
    return list.map((s, i) => ({ s, i })).sort((a, b) => of(a.s) - of(b.s) || a.i - b.i).map((x) => x.s);
  }

  // ---------------------------------------------------------------- sections

  /** Each section with where its slides start and how many it has, in order. */
  sectionSpans(): { section: Section; start: number; count: number }[] {
    let at = 0;
    return this.sections.map((section) => {
      const start = at;
      while (at < this.slides.length && this.slides[at].section === section.id) at++;
      return { section, start, count: at - start };
    });
  }

  /** The section slide i is in (null in a deck without sections). */
  sectionOf(i: number): Section | null {
    const id = this.slides[i]?.section;
    return this.sections.find((x) => x.id === id) ?? null;
  }

  /** The sections as saved in a file (undefined when there are none). */
  sectionCounts(): SectionCount[] | undefined {
    return this.sections.length ? this.sectionSpans().map((x) => ({ name: x.section.name, count: x.count })) : undefined;
  }

  /** Change the slides' sections (and order) as one step of the history; `fn` works on copies it is given. */
  private sectionEdit(label: string, fn: (secs: Section[], of: Map<Slide, number | undefined>) => Slide[] | void): void {
    type State = { sections: Section[]; slides: Slide[]; of: (number | undefined)[]; folded: number[] };
    const snap = (): State => ({ sections: this.sections.map((x) => ({ ...x })), slides: this.slides.slice(), of: this.slides.map((s) => s.section), folded: [...this.folded] });
    const before = snap();
    const secs = this.sections.map((x) => ({ ...x }));
    const of = new Map(this.slides.map((s) => [s, s.section]));
    const list = fn(secs, of) ?? this.slides.slice();
    const rank = new Map(secs.map((x, i) => [x.id, i]));
    const ordered = secs.length ? list.map((s, i) => ({ s, i })).sort((a, b) => (rank.get(of.get(a.s) ?? -1) ?? 0) - (rank.get(of.get(b.s) ?? -1) ?? 0) || a.i - b.i).map((x) => x.s) : list;
    const after: State = { sections: secs, slides: ordered, of: ordered.map((s) => (secs.length ? of.get(s) : undefined)), folded: [...this.folded].filter((id) => secs.some((x) => x.id === id)) };
    const same = JSON.stringify(before.sections) === JSON.stringify(after.sections) && before.slides.every((s, i) => s === after.slides[i]) && before.slides.length === after.slides.length && before.of.every((x, i) => x === after.of[i]);
    if (same) return;
    const cur = this.current!;
    const put = (st: State) => {
      this.detachKeep(() => {
        this.sections = st.sections.map((x) => ({ ...x }));
        this.slides = st.slides.slice();
        this.slides.forEach((s, k) => { if (st.of[k] === undefined) delete s.section; else s.section = st.of[k]; });
        this.folded = new Set(st.folded);
      });
      this.goFresh(Math.max(0, this.slides.indexOf(cur)));
    };
    put(after);
    this.record(label, () => put(before), () => put(after));
  }

  /**
   * Add Section: a new section from slide `at` (the one being edited by default) to the end of
   * the section it is in. In a deck without sections, the slides before it go in a Default
   * Section, as in PowerPoint. Returns the new section's id.
   */
  addSection(at = this.index, name = 'Untitled Section'): number {
    at = Math.max(0, Math.min(this.slides.length - 1, at));
    const id = this.nextSectionId++;
    this.sectionEdit('Add section', (secs, of) => {
      const sec = { id, name };
      if (!secs.length) {
        if (at > 0) {
          const first = { id: this.nextSectionId++, name: 'Default Section' };
          secs.push(first);
          for (const s of this.slides.slice(0, at)) of.set(s, first.id);
        }
        secs.push(sec);
        for (const s of this.slides.slice(at)) of.set(s, id);
        return;
      }
      const old = of.get(this.slides[at]);
      const k = secs.findIndex((x) => x.id === old);
      secs.splice(k + 1, 0, sec);
      for (let i = at; i < this.slides.length && of.get(this.slides[i]) === old; i++) of.set(this.slides[i], id);
      // a Default Section left with no slides goes (it was only there to hold the slides before the first section)
      if (secs[k]?.name === 'Default Section' && !this.slides.some((s) => of.get(s) === old)) secs.splice(k, 1);
    });
    return id;
  }

  renameSection(id: number, name: string): void {
    name = name.trim() || 'Untitled Section';
    this.sectionEdit('Rename section', (secs) => { const x = secs.find((y) => y.id === id); if (x) x.name = name; });
  }

  /**
   * Remove Section: its slides join the section before it (the one after, for the first), or,
   * with `slides`, are deleted too. Removing the last section leaves a deck without sections.
   * False when that would delete every slide.
   */
  removeSection(id: number, slides = false): boolean {
    const span = this.sectionSpans().find((x) => x.section.id === id);
    if (!span) return false;
    if (slides && span.count >= this.slides.length) return false;
    this.sectionEdit(slides ? 'Remove section and slides' : 'Remove section', (secs, of) => {
      const k = secs.findIndex((x) => x.id === id);
      secs.splice(k, 1);
      const into = secs[k - 1] ?? secs[k];
      const mine = this.slides.filter((s) => of.get(s) === id);
      if (slides) return this.slides.filter((s) => !mine.includes(s));
      for (const s of mine) of.set(s, into?.id);
    });
    return true;
  }

  removeAllSections(): void {
    this.sectionEdit('Remove all sections', (secs, of) => { secs.length = 0; for (const s of this.slides) of.set(s, undefined); });
  }

  /** Move a section, with all its slides, up or down past its neighbours (or to place `to` among the sections). */
  moveSection(id: number, to: number): void {
    this.sectionEdit('Move section', (secs) => {
      const k = secs.findIndex((x) => x.id === id);
      if (k < 0) return;
      const [x] = secs.splice(k, 1);
      secs.splice(Math.max(0, Math.min(secs.length, to)), 0, x);
    });
  }

  /** Fold a section in the slide list and Slide Sorter (or open it again). Not part of the history. */
  fold(id: number, on: boolean): void {
    if (on === this.folded.has(id)) return;
    if (on) this.folded.add(id); else this.folded.delete(id);
    this.looks++;
    this.onChange();
  }

  /** Collapse All or Expand All. */
  foldAll(on: boolean): void {
    this.folded = new Set(on ? this.sections.map((x) => x.id) : []);
    this.looks++;
    this.onChange();
  }

  /** Change the layout of the current slide: its placeholders move to the new layout's places. */
  setLayout(layout: LayoutId, i = this.index): void {
    const slide = this.slides[i];
    if (!slide || slide.layout === layout) return;
    const old = slide.layout;
    this.contentEdit('Change layout', [i], () => {
      slide.layout = layout;
      const d = this.docOf(i);
      this.styleDoc(d, layout, slide.background);
      d.bulk(() => this.fitPlaceholders(d, layout));
    }, () => { slide.layout = old; this.styleDoc(this.docOf(this.slides.indexOf(slide)), old, slide.background); }, () => { slide.layout = layout; this.styleDoc(this.docOf(this.slides.indexOf(slide)), layout, slide.background); });
  }

  /**
   * Put a slide's placeholders in its layout's places: placeholders the layout has keep their
   * text and move there; missing ones are added empty; ones it doesn't have are removed when
   * empty and otherwise kept where they are (so no text is lost).
   */
  private fitPlaceholders(d: Doc, layout: LayoutId, master = this.master): void {
    const styles = textStyles(master, layout);
    const frames = layoutFrames(layout, this.size, master);
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
   * The slide master's layouts changed (renamed, placeholders moved, added or deleted): slides
   * with a changed layout have their placeholders moved to its places, and slides whose layout
   * was deleted get Title and Content. One undo step.
   */
  setLayouts(layouts: LayoutDef[], label = 'Edit slide layouts'): void {
    const before = this.master;
    // built-in layouts left as they come are not kept as edits
    const own = layouts.filter((l) => !isBuiltinLayout(l.id) || JSON.stringify(l) !== JSON.stringify(builtinLayout(l.id))).map(copyLayout);
    const after: Master = { ...before, layouts: own };
    if (!own.length) delete after.layouts;
    if (JSON.stringify(before.layouts ?? []) === JSON.stringify(after.layouts ?? [])) return;
    const slides = this.slides.slice();
    const laysBefore = slides.map((s) => s.layout);
    const laysAfter = slides.map((s) => (hasLayout(after, s.layout) ? s.layout : 'title-content'));
    const changed = slides.map((_, i) => i).filter((i) => JSON.stringify(layoutDef(before, laysBefore[i]).boxes) !== JSON.stringify(layoutDef(after, laysAfter[i]).boxes) || titleLook(before, laysBefore[i]) !== titleLook(after, laysAfter[i]));
    const use = (m: Master, lays: LayoutId[]) => {
      this.master = m;
      slides.forEach((s, k) => { s.layout = lays[k]; });
      this.restyleAll();
    };
    this.contentEdit(label, changed, () => {
      use(after, laysAfter);
      for (const i of changed) {
        const d = this.docOf(i);
        d.bulk(() => this.fitPlaceholders(d, slides[i].layout));
      }
    }, () => use(before, laysBefore), () => use(after, laysAfter));
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
    this.record(label, () => { undoDeck(); put(before); }, () => { redoDeck(); put(after); }, slides.length === 1 ? slides[0] : undefined);
  }

  /** Change the master (fonts, colours, background, logo, numbers, drawing style). */
  setMaster(m: Master): void {
    const before = this.master;
    const apply = (x: Master) => {
      this.master = x;
      this.restyleAll();
      this.onSwitch();
    };
    apply(m);
    this.record('Change slide master', () => apply(before), () => apply(m));
  }

  /**
   * Draw structures on every slide in another style (File > Drawing Style). 'restyle' redraws
   * what is there in it; 'new-only' keeps what is there looking as it does. One undo step.
   */
  setDrawingStyle(next: DocStyle, how: RestyleHow): void {
    const before = this.master, after = { ...before, drawing: { ...next } };
    const use = (m: Master) => {
      this.master = m;
      this.restyleAll();
    };
    const all = this.slides.map((_, i) => i);
    this.contentEdit('Change drawing style', all, () => {
      for (const i of all) {
        const d = this.docOf(i);
        d.bulk(() => applyStyle(d, next, how));
      }
      use(after);
    }, () => use(before), () => use(after));
  }

  /** Start a new deck with this master (your template for new decks). Not undoable. */
  useMaster(m: Master): void {
    this.master = m;
    this.restyleAll();
  }

  /** Start a new deck in a style (your default for new slides or designs). Not undoable. */
  useDrawingStyle(st: DocStyle): void {
    this.master = { ...this.master, drawing: { ...st } };
    this.restyleAll();
  }

  /**
   * Change the slide size. What is on the slides stays centred, as it is ('centre'), or grows or
   * shrinks with the slide: as big as fits ('fit', PowerPoint's Ensure Fit) or as big as the
   * slide allows ('max', Maximize). Placeholders move to their layout's places.
   */
  setSize(size: SlideSize, how: SizeFit = 'centre'): void {
    if (size.w === this.size.w && size.h === this.size.h) return;
    const old = { ...this.size };
    const k = how === 'centre' ? 1 : how === 'fit' ? Math.min(size.w / old.w, size.h / old.h) : Math.max(size.w / old.w, size.h / old.h);
    const all = this.slides.map((_, i) => i);
    this.contentEdit('Change slide size', all, () => {
      this.size = { ...size };
      for (const i of all) {
        const d = this.docOf(i);
        d.bulk(() => {
          scaleContents(d, old, size, k);
          this.fitPlaceholders(d, this.slides[i].layout);
        });
      }
    }, () => { this.size = old; }, () => { this.size = { ...size }; });
  }

  /**
   * Give some slides (the current one by default) their own background, or none (the master's
   * again), and show or hide the master's shapes and logo on them. One undo step.
   */
  setBackground(bg: Background | undefined, indices: number[] = [this.index], hideGraphics?: boolean): void {
    const slides = [...new Set(indices)].map((i) => this.slides[i]).filter(Boolean);
    if (!slides.length) return;
    type Look = { background?: Background; hideGraphics?: boolean };
    const before: Look[] = slides.map((s) => ({ background: s.background, hideGraphics: s.hideGraphics }));
    const after: Look[] = slides.map((s) => ({ background: bg ? copyBackground(bg) : undefined, hideGraphics: hideGraphics ?? s.hideGraphics }));
    if (before.every((b, k) => sameBackground(b.background, after[k].background) && !!b.hideGraphics === !!after[k].hideGraphics)) return;
    const put = (looks: Look[]) => {
      slides.forEach((s, k) => {
        if (looks[k].background) s.background = looks[k].background; else delete s.background;
        if (looks[k].hideGraphics) s.hideGraphics = true; else delete s.hideGraphics;
      });
      this.looks++;
      this.restyleAll();
      this.onSwitch();
    };
    put(after);
    this.record(bg ? 'Format background' : 'Reset background', () => put(before), () => put(after), slides.length === 1 ? slides[0] : undefined);
  }

  /**
   * Format Background > Apply to All: every slide (title slides too) has this background, from
   * the master; no slide keeps one of its own. One undo step.
   */
  setAllBackgrounds(bg: Background, hideGraphics?: boolean): void {
    const plain = isPlain(bg);
    const colour = backgroundColour(bg);
    const m = this.master;
    const master: Master = { ...m, background: plain ? bg.color : colour, fill: plain ? undefined : copyBackground(bg) };
    if (!master.fill) delete master.fill;
    if (m.titleSlide) {
      master.titleSlide = { ...m.titleSlide, background: plain ? bg.color : colour, fill: plain ? undefined : copyBackground(bg) };
      if (!master.titleSlide.fill) delete master.titleSlide.fill;
    }
    type Look = { background?: Background; hideGraphics?: boolean };
    const beforeMaster = m;
    const before: Look[] = this.slides.map((s) => ({ background: s.background, hideGraphics: s.hideGraphics }));
    const after: Look[] = this.slides.map((s) => ({ hideGraphics: hideGraphics ?? s.hideGraphics }));
    const slides = this.slides.slice();
    const put = (mm: Master, looks: Look[]) => {
      this.master = mm;
      slides.forEach((s, k) => {
        if (looks[k].background) s.background = looks[k].background; else delete s.background;
        if (looks[k].hideGraphics) s.hideGraphics = true; else delete s.hideGraphics;
      });
      this.looks++;
      this.restyleAll();
      this.onSwitch();
    };
    put(master, after);
    this.record('Apply background to all', () => put(beforeMaster, before), () => put(master, after));
  }

  /**
   * Hide Slide: hide some slides (the current one by default) from the slide show, or show them
   * again. They stay in the deck and in saved files. One undo step.
   */
  setHidden(hidden: boolean, indices: number[] = [this.index]): void {
    const slides = [...new Set(indices)].map((i) => this.slides[i]).filter((s) => s && !!s.hidden !== hidden);
    if (!slides.length) return;
    const put = (v: boolean) => {
      for (const s of slides) { if (v) s.hidden = true; else delete s.hidden; }
      this.looks++;
      this.onChange();
    };
    put(hidden);
    this.record(hidden ? 'Hide slide' : 'Show slide', () => put(!hidden), () => put(hidden), slides.length === 1 ? slides[0] : undefined);
  }

  /** The next slide the show plays after slide i (hidden slides are skipped), or -1 at the end. */
  shownAfter(i: number): number {
    for (let j = i + 1; j < this.slides.length; j++) if (!this.slides[j].hidden) return j;
    return -1;
  }

  /** The slide the show went through before slide i, or -1 at the start. */
  shownBefore(i: number): number {
    for (let j = Math.min(i, this.slides.length) - 1; j >= 0; j--) if (!this.slides[j].hidden) return j;
    return -1;
  }

  /** Where the show starts: the first slide that isn't hidden (the first slide when all are). */
  firstShown(): number {
    return Math.max(0, this.shownAfter(-1));
  }

  /** Copies of some slides (the current one by default), with this deck's size and master, for pasting into a deck. */
  copySlides(indices: number[] = [this.index]): SlideSource {
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < this.slides.length).sort((a, b) => a - b);
    return {
      size: { ...this.size },
      master: structuredClone(this.master),
      slides: sorted.map((i) => {
        const s = this.slides[i];
        return { layout: s.layout, contents: structuredClone(this.docOf(i).contents()), notes: s.notes, motion: copyMotion(s) };
      }),
    };
  }

  /**
   * Put copies of slides from a deck (this one or another) after slide `after` (the current
   * one by default), and edit the first of them. They take this deck's master, as PowerPoint's
   * Use Destination Theme, unless `keep` (Keep Source Formatting): then each keeps its background
   * and the fonts, sizes and colours of its titles and text. Structures drawn in another style
   * are redrawn in this deck's, or keep their look with `keep`. Slides made for another size stay
   * centred on the slide. One undo step.
   */
  pasteSlides(from: SlideSource, keep = false, after = this.index): number {
    if (!from.slides.length) return 0;
    const { slides, master } = this.adopt(from, keep);
    const at = Math.max(0, Math.min(this.slides.length, after + 1));
    this.insert(at, slides, slides.length > 1 ? 'Paste slides' : 'Paste slide', master);
    return slides.length;
  }

  /**
   * Put a copy of a slide from another deck in place of slide i (Compare's Accept on a changed
   * slide), as pasteSlides would make it, keeping slide i's section. One undo step.
   */
  replaceSlide(i: number, from: SlideSource, label = 'Accept change'): boolean {
    const old = this.slides[i];
    if (!old || from.slides.length !== 1) return false;
    const { slides: [made], master } = this.adopt(from, false);
    if (old.section !== undefined) made.section = old.section;
    const beforeMaster = this.master;
    const beforeIndex = this.index;
    const useMaster = (m: Master) => { if (this.master !== m) { this.master = m; this.restyleAll(); } };
    const put = (s: Slide, m: Master, go: number) => {
      this.detachKeep(() => { const k = this.slides.indexOf(s === made ? old : made); if (k >= 0) this.slides[k] = s; });
      useMaster(m);
      this.goFresh(go);
    };
    const doIt = () => put(made, master ?? beforeMaster, i);
    const undoIt = () => put(old, beforeMaster, beforeIndex);
    doIt();
    this.record(label, undoIt, doIt, made);
    return true;
  }

  /** Slides made from copies out of a deck, for this one (and this deck's master with any layouts they bring). */
  private adopt(from: SlideSource, keep: boolean): { slides: Slide[]; master: Master | undefined } {
    // layouts made in the other deck's master come with its slides, as in PowerPoint
    const missing = [...new Set(from.slides.map((c) => c.layout))].filter((id) => !hasLayout(this.master, id) && hasLayout(from.master, id));
    const master: Master | undefined = missing.length
      ? { ...this.master, layouts: [...(this.master.layouts ?? []).map(copyLayout), ...missing.map((id) => copyLayout(layoutDef(from.master, id)))] }
      : undefined;
    const target = master ?? this.master;
    const dx = (this.size.w - from.size.w) / 2, dy = (this.size.h - from.size.h) / 2;
    const resized = Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6;
    const restyle = !sameStyle(from.master.drawing, this.master.drawing);
    const slides = from.slides.map((c) => {
      const motion = copyMotion(c.motion);
      const d = new Doc();
      styleWith(d, from.master, c.layout, motion.background);
      d.restoreContents(c.contents);
      d.bulk(() => {
        if (keep) {
          // the look it had: its background, and its placeholders' text in the fonts and colours of its master
          if (!motion.background) {
            const bg = slideBackground(from.master, c.layout);
            if (!sameBackground(bg, slideBackground(this.master, c.layout))) motion.background = copyBackground(bg);
          }
          const styles = textStyles(from.master, c.layout);
          for (const cap of [...d.captions.values()]) if (cap.ph) d.updateCaption(cap.id, { runs: applyBase(cap.runs, styles[cap.ph]) });
        }
        if (restyle) applyStyle(d, this.master.drawing, keep ? 'new-only' : 'restyle');
        if (resized) scaleContents(d, from.size, this.size, 1);
      });
      const lay = hasLayout(target, c.layout) ? c.layout : 'title-content';
      const made = this.makeSlide(lay, d.contents(), c.notes, motion, target);
      if (resized) made.doc.bulk(() => this.fitPlaceholders(made.doc, lay, target));
      return made;
    });
    return { slides, master };
  }

  /** Change a slide's speaker notes. */
  setNotes(text: string, i = this.index): void {
    const s = this.slides[i];
    if (!s || s.notes === text) return;
    const before = s.notes;
    s.notes = text;
    this.record('Edit notes', () => { s.notes = before; this.onSwitch(); }, () => { s.notes = text; this.onSwitch(); }, s);
  }

  /** Change the transition of some slides (the current one by default). One undo step. */
  setTransition(t: Transition | undefined, indices: number[] = [this.index], label = 'Transition'): void {
    const slides = [...new Set(indices)].map((i) => this.slides[i]).filter(Boolean);
    if (!slides.length) return;
    const before = slides.map((s) => (s.transition ? { ...s.transition } : undefined));
    const put = (vals: (Transition | undefined)[]) => {
      slides.forEach((s, k) => { if (vals[k]) s.transition = { ...vals[k]! }; else delete s.transition; });
      this.onMotion();
    };
    const after = slides.map(() => (t && (t.kind !== 'none' || t.advanceAfter) ? { ...t } : undefined));
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    put(after);
    this.record(label, () => put(before), () => put(after), slides.length === 1 ? slides[0] : undefined);
  }

  /** Change a slide's comments (the current slide by default). One undo step. */
  setComments(list: PinnedComment[], label = 'Comment', i = this.index): void {
    const s = this.slides[i];
    if (!s) return;
    const before = copyPinned(s.comments);
    const after = copyPinned(list);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const put = (v: PinnedComment[]) => { if (v.length) s.comments = copyPinned(v); else delete s.comments; this.onComments(); };
    put(after);
    this.record(label, () => put(before), () => put(after), s);
  }

  /** Change a slide's animations (the current slide by default). One undo step. */
  setAnims(anims: Anim[], label = 'Animation', i = this.index): void {
    const s = this.slides[i];
    if (!s) return;
    const before = copyMotion(s).anims ?? [];
    const after = copyMotion({ anims }).anims ?? [];
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const put = (v: Anim[]) => { if (v.length) s.anims = copyMotion({ anims: v }).anims; else delete s.anims; this.onMotion(); };
    put(after);
    this.record(label, () => put(before), () => put(after), s);
  }
}
