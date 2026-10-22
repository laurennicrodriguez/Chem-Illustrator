// Saving slides as a PowerPoint file (.pptx), from the published Office Open XML standard
// (ECMA-376, PresentationML).
//
// What PowerPoint can edit stays editable there: titles, text boxes and lists become
// PowerPoint text, pictures become PowerPoint pictures (with their cropping), and boxes,
// ovals and lines away from structures become PowerPoint shapes. Structures and schemes
// become sharp pictures (SVG, with a PNG for older programs), each carrying its drawing as
// CDXML in a hidden tag, so opening the file here again gives back editable structures. Text
// boxes carry their exact settings the same way, used when PowerPoint has not changed the text.
// The slide master's fonts, colours, background, logo, slide numbers and footer become the
// file's slide master and theme, so PowerPoint's own placeholders follow them too.

import type { PinnedComment } from '../document/comments';
import { COMMENT_CT, COMMENT_REL, writeSlideComments } from './pptx-comments';
import { Doc, Caption, Shape, TextRun, ParaStyle, Arrow, applyBase, PICTURE_SHADOWS, type Pattern, type PictureFx, type PictureLook, type Media } from '../model';
import { bakedPart, tidyFx } from '../render/picture-fx';
import { blipEffectsXml, imgPropsXml, pictureGeomXml } from './picture-xml';
import { turnAbout, type Rect } from '../geom';
import { layoutText, ASCENT, FONT_STACK, type Measure } from '../text/layout';
import { fitParas, listMarkers, splitParagraphs } from '../text/paragraphs';
import { formulaParts, plainText } from '../richtext';
import { officeTarget, slideOfLink } from '../links';
import { arialWidth } from '../text-metrics';
import { arrowPoints, shapeBox, boxOf, shapeOrder, elbowRoute } from '../objects';
import { geoDef, textArea, type GeoStep } from '../design/geo';
import { layoutTable, cellAlign, spanOf, rowSpanOf, coveringCell, tableText, NOTE_SCALE } from '../table';
import { PPT_STYLE_IDS, lookOf, slideCellLook, styledRuns, type CellLine, type Side } from '../deck/table-styles';
import { tableBorders } from './cdxml-table';
import { writeCdxml } from './cdxml-write';
import { extractDrawing } from './clipboard';
import { contentsAlt, titleOverlaps, roughCaptionBox } from '../accessibility';
import type { Selection } from '../editor/editor';
import { Package, NS, REL, emu, xml, xmlAttr, hex6, MediaFiles, structureAltText } from './ooxml';
import { facesToEmbed, toEot, type FontSource } from './font-embed';
import { fromDataUrl } from '../render/images';
import { patternClear, patternInk, shadowLook } from '../render/fills';
import { FADE, tint } from '../colours';
import { transitionXml, timingXml, highlightParts, partHolds, expandParas, targetKey, type Transition, type Anim, type MediaTiming } from '../deck/animation';
import { MEDIA_EXT } from '../deck/media';
import { effectsXml } from './pptx-effects';
import { viewPropsXml } from '../deck/guides';
import { handoutMasterXml, notesMasterXml } from '../deck/notes-pages';
import { showPrXml, custShowsXml } from '../deck/show-setup';
import {
  Master, SlideSize, LayoutId, layoutFrames, deckLayouts, layoutDef, titleLook, isBuiltinLayout, type LayoutDef, type SectionCount, decorFrames, showsNumber, showsFooter, showsDate, dateText, type SlideHF, type DeckSettings, textStyles, isEmptyText, slideColours, slideBackground, decorShapes, type DecorShape,
} from '../deck/deck';
import { sameBackground, type Background } from '../deck/background';
import { bgXml, type BlipIds } from './pptx-background';
import { addChart, C_NS } from './office-chart';
import { CX_NS, CX1_NS } from './xlsx-chart';
import { isChartEx } from '../sheet/chart';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
import type { ChartBox } from '../sheet/chart-box';
import { toOmml, mathText } from '../document/math';
import { shapeMathPicture, shapeMathScale } from '../deck/equation';

/** Tag names (PowerPoint keeps tags when it saves). */
export const TAG = {
  cdxml: 'CHEMILLUSTRATOR_CDXML',
  box: 'CHEMILLUSTRATOR_BOX',
  text: 'CHEMILLUSTRATOR_TEXT',
  master: 'CHEMILLUSTRATOR_MASTER',
  layout: 'CHEMILLUSTRATOR_LAYOUT',
  table: 'CHEMILLUSTRATOR_TABLE',
  tablePart: 'CHEMILLUSTRATOR_TABLE_PART',
  /** The file is a design (Design mode), not slides: it opens in Design mode again. */
  design: 'CHEMILLUSTRATOR_DESIGN',
  /** A design shape (Design mode): which shape and how it looks, used when it comes back. */
  geo: 'CHEMILLUSTRATOR_GEO',
  /** A connector (an arrow stuck to design shapes, or bent square): the arrow as it was. */
  connector: 'CHEMILLUSTRATOR_CONNECTOR',
  /**
   * A highlight animated on its own, as a picture under its structure: where one of its atoms (or
   * bond middles) was, and the structure picture's box tag, so it finds its highlight again.
   */
  highlight: 'CHEMILLUSTRATOR_HIGHLIGHT',
  /** A Slide Zoom or a Summary Zoom's part: whether the show comes back, and where the part ends. */
  zoom: 'CHEMILLUSTRATOR_ZOOM',
  /** The slide's id here, so links kept in our own tags find their slide again. */
  slideId: 'CHEMILLUSTRATOR_SLIDE_ID',
  /** A SmartArt-style diagram (a group of shapes): its text and look, kept on the group. */
  diagram: 'CHEMILLUSTRATOR_DIAGRAM',
  /** A chart: the chart and its data as made here. */
  chart: 'CHEMILLUSTRATOR_CHART',
  /** A picture's Picture Format settings PowerPoint has no place for (how near a colour Remove Background takes). */
  picture: 'CHEMILLUSTRATOR_PICTURE',
  /** An equation: its LaTeX, size, colour and font as made here, used when PowerPoint has not changed it. */
  math: 'CHEMILLUSTRATOR_MATH',
};

/** Where a highlight is, for finding it again: one of its atoms, else the middle of one of its bonds. */
function highlightSpot(doc: Doc, h: Selection): { x: number; y: number; bond?: true } | null {
  for (const id of h.atoms) { const a = doc.atoms.get(id); if (a) return { x: +a.x.toFixed(3), y: +a.y.toFixed(3) }; }
  for (const id of h.bonds) {
    const b = doc.bonds.get(id), p = b && doc.atoms.get(b.a1), q = b && doc.atoms.get(b.a2);
    if (p && q) return { x: +((p.x + q.x) / 2).toFixed(3), y: +((p.y + q.y) / 2).toFixed(3), bond: true };
  }
  return null;
}

/** A picture of part of a slide (structures, schemes): SVG and PNG, and the area it shows, in points. */
export interface DrawingPicture { svg: string; png: Uint8Array; box: Rect }

export interface PptxOptions {
  /** A picture of a drawing (made by the app, which can draw). Null when there is nothing to show. */
  picture(doc: Doc): Promise<DrawingPicture | null>;
  /** A PNG of an SVG picture, for programs that can't show SVG (w × h pixels). */
  svgToPng(svg: string, w: number, h: number): Promise<Uint8Array>;
  /**
   * A picture with its sharpening and Remove Background worked in, as PNG (PowerPoint keeps
   * those worked in, with the original beside it). Without it they are left off.
   */
  bakePicture?(p: Pick<Shape, 'src' | 'fx' | 'crop' | 'px'>): Promise<Uint8Array | null>;
  /** A drawing's structures as SMILES, for the picture's alt text (null when there are none, or no chemistry engine). */
  smiles?(doc: Doc): Promise<string | null>;
  /** Text widths, for laying out text boxes (Arial's widths by default). */
  measure?: Measure;
  title?: string;
  /** The free fonts that come with the app, to put inside the file when the slides use them. */
  fonts?: FontSource;
}

export interface DeckData {
  size: SlideSize;
  master: Master;
  /** `id` is the slide's id in the deck, for links to it (#slide=id). */
  slides: { id?: number; layout: LayoutId; doc: Doc; notes: string; transition?: Transition; anims?: Anim[]; comments?: PinnedComment[]; background?: Background; hideGraphics?: boolean; hidden?: boolean; hf?: SlideHF }[];
  /** A design (Design mode): marked so it opens in Design mode again. */
  design?: boolean;
  /** The deck's sections, in order (none when left out). */
  sections?: SectionCount[];
  /** Set Up Show and custom shows. */
  settings?: DeckSettings;
}

/**
 * Where PowerPoint puts the first baseline below the top of a text box, as a fraction of the
 * text size (Arial's ascent). Our layout keeps 0.8 of the size above the baseline, so text
 * boxes are moved up by the difference to keep the text where it was.
 */
export const PPT_ASCENT = 0.905;

const SVG_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const NS_SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const REL_MEDIA = 'http://schemas.microsoft.com/office/2007/relationships/media';
const REL_VIDEO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video';
const REL_AUDIO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio';
const NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
/** Markup compatibility (a newer form with a fallback), Office 2010's drawing additions (equations in text), and Office Math. */
export const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
export const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/**
 * A slide's videos starting by themselves when the slide comes in (PowerPoint's "Start:
 * Automatically"), and repeating unless they play once (a slide without animations).
 */
export function videoTimingXml(videos: { spid: number; once: boolean }[]): string {
  return timingXml([], () => [], videos.map((v) => ({ spid: v.spid, media: { src: '', ...(v.once ? { once: true } : {}) } })));
}

/** PowerPoint's zooms. */
export const NS_SLIDEZOOM = 'http://schemas.microsoft.com/office/powerpoint/2016/slidezoom';

/** A slide's creation number in the file (PowerPoint's p14:creationId), by its place. */
export const creationId = (i: number): number => 1000000000 + i * 7919;

const XMLNS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  handoutMaster: 'application/vnd.openxmlformats-officedocument.presentationml.handoutMaster+xml',
  notes: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  tags: 'application/vnd.openxmlformats-officedocument.presentationml.tags+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};

/** Picture types a PowerPoint file can hold (EMF and WMF come from Windows programs; kept as they are). */
export const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'image/tiff': 'tiff', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf', 'video/mp4': 'mp4',
};

// ---------------------------------------------------------------- what goes where

/** A slide's contents sorted for PowerPoint. */
export interface SlideParts {
  /** Titles, text placeholders and text boxes: PowerPoint text. */
  texts: Caption[];
  /** Pictures. */
  pictures: Shape[];
  /** Boxes, ovals and lines away from structures: PowerPoint shapes. */
  shapes: Shape[];
  /** Tables: PowerPoint tables. */
  tables: Shape[];
  /** Connectors between design shapes (and elbow arrows): PowerPoint connectors. */
  connectors: Arrow[];
  /** Structures and schemes, each with the captions, arrows and shapes around it: one picture each. */
  drawings: Selection[];
  /** SmartArt-style diagrams: their frame (which keeps the text), shapes and connectors, each saved as one group. */
  diagrams: SlideDiagram[];
}

export interface SlideDiagram { frame: Shape; shapes: Shape[]; connectors: Arrow[] }

/** A slide's diagrams, and what belongs to them (which is saved in their groups, not on its own). */
export function slideDiagrams(doc: Doc): { diagrams: SlideDiagram[]; shapes: Set<number>; arrows: Set<number> } {
  const diagrams: SlideDiagram[] = [];
  const shapes = new Set<number>(), arrows = new Set<number>();
  for (const sh of doc.shapes.values()) {
    if (!sh.diagram || !sh.frame) continue;
    const members = sh.frame.shapes.map((id) => doc.shapes.get(id)).filter((x): x is Shape => !!x && x.kind === 'geo');
    const links = sh.frame.arrows.map((id) => doc.arrows.get(id)).filter((x): x is Arrow => !!x);
    shapes.add(sh.id);
    for (const x of members) shapes.add(x.id);
    for (const x of links) arrows.add(x.id);
    diagrams.push({ frame: sh, shapes: shapeOrder(members), connectors: links });
  }
  return { diagrams, shapes, arrows };
}

const emptySel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

/**
 * Sort a slide's drawing: structures, arrows, brackets and anything close to them group into
 * schemes (each saved as one picture); titles, text boxes, pictures and lone shapes stay
 * separate so PowerPoint can edit them.
 */
export function splitSlide(doc: Doc, measure: Measure = arialMeasure): SlideParts {
  const L = doc.style.bondLength;
  const gap = 0.75 * L;
  type Item = { box: Rect; chem: boolean; add: (s: Selection) => void; text?: Caption; shape?: Shape };
  const items: Item[] = [];
  const texts: Caption[] = [];
  const pictures: Shape[] = [];
  const tables: Shape[] = [];
  const geos: Shape[] = [];
  for (const frag of doc.fragments()) {
    const pts = [...frag].map((id) => doc.atoms.get(id)!);
    const b = boxOf(pts);
    const pad = doc.style.labelSize * 0.6;
    items.push({
      box: { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad }, chem: true,
      add: (s) => {
        for (const id of frag) {
          s.atoms.add(id);
          for (const bid of doc.adj.get(id) ?? []) s.bonds.add(bid);
        }
      },
    });
  }
  const dia = slideDiagrams(doc);
  const connectors: Arrow[] = [];
  for (const r of doc.arrows.values()) if (!dia.arrows.has(r.id) && (r.from || r.to || r.elbow)) connectors.push(r);
  for (const r of doc.arrows.values()) if (!dia.arrows.has(r.id) && !(r.from || r.to || r.elbow)) items.push({ box: boxOf(arrowPoints(r, 12)), chem: true, add: (s) => s.arrows.add(r.id) });
  for (const sh of doc.shapes.values()) {
    if (sh.picture) continue; // a stand-in for a picture from a ChemDraw file
    if (dia.shapes.has(sh.id)) continue;
    if (sh.kind === 'picture') { pictures.push(sh); continue; }
    if (sh.kind === 'table') { if (sh.table) tables.push(sh); continue; }
    // design shapes stay PowerPoint shapes even beside structures (boxes round a structure, flasks under one)
    if (sh.kind === 'geo') { geos.push(sh); continue; }
    // ring fills sit under their structure, in its picture
    const chem = sh.kind === 'bracket' || sh.kind === 'symbol' || sh.kind === 'ring';
    if (sh.hidden && !chem) { geos.push(sh); continue; }
    items.push({ box: shapeBox(sh), chem, add: (s) => s.shapes.add(sh.id), shape: sh });
  }
  for (const c of doc.captions.values()) {
    // titles, text placeholders and text boxes are always PowerPoint text
    // (and hidden text, kept hidden in PowerPoint rather than left out of a structure's picture)
    if (c.ph || c.wrap !== undefined || c.hidden) { texts.push(c); continue; }
    const lay = layoutText(c, doc.style.captionSize, measure);
    items.push({ box: { x1: c.x + lay.box.x1, y1: c.y + lay.box.y1, x2: c.x + lay.box.x2, y2: c.y + lay.box.y2 }, chem: false, add: (s) => s.captions.add(c.id), text: c });
  }
  // group things that touch (within the gap), by joining groups
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a: Rect, b: Rect) => a.x1 - gap <= b.x2 && b.x1 - gap <= a.x2 && a.y1 - gap <= b.y2 && b.y1 - gap <= a.y2;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (near(items[i].box, items[j].box)) parent[find(i)] = find(j);
  }
  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => {
    const g = groups.get(find(i)) ?? [];
    g.push(it);
    groups.set(find(i), g);
  });
  const drawings: Selection[] = [];
  const shapes: Shape[] = [];
  for (const g of groups.values()) {
    if (g.some((it) => it.chem)) {
      const s = emptySel();
      for (const it of g) it.add(s);
      drawings.push(s);
    } else {
      for (const it of g) {
        if (it.text) texts.push(it.text);
        else if (it.shape) shapes.push(it.shape);
      }
    }
  }
  // top to bottom, then left to right, as people read (and as PowerPoint tabs through them)
  const top = (s: Selection) => Math.min(...[...s.atoms].map((id) => doc.atoms.get(id)!.y), ...[...s.arrows].map((id) => doc.arrows.get(id)!.tail.y), ...[...s.shapes].map((id) => doc.shapes.get(id)!.y1));
  drawings.sort((a, b) => top(a) - top(b));
  return { texts, pictures, shapes: shapeOrder([...shapes, ...geos]), tables, drawings, connectors, diagrams: dia.diagrams };
}

export const arialMeasure: Measure = (t, size, _family, style) => arialWidth(t, size, /bold/.test(style));

// ---------------------------------------------------------------- text

const lang = 'lang="en-US"';

/** A link as PowerPoint's own (a:hlinkClick), or '' when it can't be kept. */
export type LinkXml = (link: string) => string;

/** One run as PowerPoint runs (formula style turns into subscripts and superscripts). */
function runXml(r: TextRun, explicit: { size: number; font: string } | null, hlink?: LinkXml): string {
  const click = r.link && hlink ? hlink(r.link) : '';
  const parts = r.formula && !r.sub && !r.sup ? formulaParts(r.text) : [{ text: r.text, pos: r.sub ? 'sub' : r.sup ? 'sup' : 'base' }];
  return parts.map((p) => {
    const size = r.size ?? explicit?.size;
    const font = r.font ?? explicit?.font;
    const attrs = [lang];
    if (size) attrs.push(`sz="${Math.round(size * 100)}"`);
    if (r.bold !== undefined) attrs.push(`b="${r.bold ? 1 : 0}"`);
    if (r.italic !== undefined) attrs.push(`i="${r.italic ? 1 : 0}"`);
    if (r.underline) attrs.push('u="sng"');
    if (r.strike) attrs.push('strike="sngStrike"');
    if (r.spacing) attrs.push(`spc="${Math.round(r.spacing * 100)}"`);
    if (p.pos === 'sub') attrs.push('baseline="-25000"');
    else if (p.pos === 'sup') attrs.push('baseline="30000"');
    attrs.push('dirty="0"');
    const color = r.color ?? (explicit ? '#000000' : undefined);
    const fill = color ? `<a:solidFill><a:srgbClr val="${hex6(color)}"/></a:solidFill>` : '';
    const latin = font ? `<a:latin typeface="${xml(font)}"/><a:cs typeface="${xml(font)}"/>` : '';
    return `<a:r><a:rPr ${attrs.join(' ')}>${fill}${latin}${click}</a:rPr><a:t>${xml(p.text)}</a:t></a:r>`;
  }).join('');
}

const NUMBER_TYPES = ['arabicPeriod', 'alphaLcPeriod', 'romanLcPeriod'];

/** A box turned a quarter about its middle: as wide as it was high. */
export function swapBox(b: Rect): Rect {
  const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2, hw = (b.y2 - b.y1) / 2, hh = (b.x2 - b.x1) / 2;
  return { x1: mx - hw, y1: my - hh, x2: mx + hw, y2: my + hh };
}

/** A caption's paragraphs as PowerPoint paragraphs. */
export function paragraphsXml(c: Caption, explicit: { size: number; font: string } | null, defaultSize: number, measure: Measure, hlink?: LinkXml): string {
  const paras = splitParagraphs(c.runs);
  const styles = fitParas(c.paras, paras.length);
  const markers = listMarkers(styles);
  return paras.map((runs, i) => {
    const ps: ParaStyle = styles[i];
    const em = runs[0]?.size ?? explicit?.size ?? defaultSize;
    const attrs: string[] = [];
    const align = ps.align ?? c.justify;
    attrs.push(`algn="${align === 'center' ? 'ctr' : align === 'right' ? 'r' : align === 'justify' ? 'just' : 'l'}"`);
    let inner = '';
    if (c.lineHeight) inner += `<a:lnSpc><a:spcPts val="${Math.round(c.lineHeight * 100)}"/></a:lnSpc>`;
    else if (c.lineSpacing && c.lineSpacing !== 1) inner += `<a:lnSpc><a:spcPct val="${Math.round(c.lineSpacing * 100000)}"/></a:lnSpc>`;
    if (ps.spaceBefore) inner += `<a:spcBef><a:spcPts val="${Math.round(ps.spaceBefore * 100)}"/></a:spcBef>`;
    if (ps.spaceAfter) inner += `<a:spcAft><a:spcPts val="${Math.round(ps.spaceAfter * 100)}"/></a:spcAft>`;
    const indent = ps.indent ?? 0;
    if (ps.list) {
      // the same places as on screen: the marker one step in per level, the text after it
      const level = Math.max(0, Math.min(8, ps.level ?? 0));
      const markLeft = indent + level * 1.6 * em;
      const m = markers[i];
      const markW = m ? measure(m, em, FONT_STACK, '') : 0;
      const textLeft = Math.max(markLeft + (ps.list === 'number' ? 1.6 : 1.1) * em, markLeft + markW + 0.3 * em);
      attrs.push(`marL="${emu(textLeft)}"`, `indent="${ps.cont ? 0 : emu(markLeft - textLeft)}"`);
      if (level) attrs.push(`lvl="${level}"`);
      if (ps.cont) inner += '<a:buNone/>';
      else if (ps.list === 'bullet') inner += `<a:buFont typeface="Arial"/><a:buChar char="${xml(m ?? '•')}"/>`;
      else {
        const n = parseInt(m ?? '1', 10);
        const start = Number.isFinite(n) && n > 1 ? ` startAt="${n}"` : m && /^[a-z]+\./.test(m) ? ` startAt="${letterValue(m)}"` : m && /^[ivxlcdm]+\./.test(m) ? ` startAt="${romanValue(m)}"` : '';
        inner += `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${NUMBER_TYPES[level % 3]}"${start === ' startAt="1"' ? '' : start}/>`;
      }
    } else {
      attrs.push(`marL="${emu(indent)}"`, 'indent="0"');
      inner += '<a:buNone/>';
    }
    const body = runs.map((r) => runXml(r, explicit, hlink)).join('');
    const end = `<a:endParaRPr ${lang}${explicit ? ` sz="${Math.round(em * 100)}"` : ''} dirty="0"/>`;
    return `<a:p><a:pPr ${attrs.join(' ')}>${inner}</a:pPr>${body}${end}</a:p>`;
  }).join('');
}

function letterValue(m: string): number {
  let n = 0;
  for (const ch of m.replace('.', '')) n = n * 26 + (ch.charCodeAt(0) - 96);
  return n;
}

function romanValue(m: string): number {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const s = m.replace('.', '');
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]], b = v[s[i + 1]] ?? 0;
    n += a < b ? -a : a;
  }
  return n;
}

// ---------------------------------------------------------------- the file

/**
 * How a layout's placeholders are named in PowerPoint: its title (a centred title on Title
 * Slide), then its other boxes by number (subtitles as subtitles; halves on Two Content).
 */
function layoutPh(def: LayoutDef): { title: string | null; bodies: string[] } {
  const others = def.boxes.filter((b) => b.ph !== 'title');
  const half = def.id === 'two-content' && others.length === 2;
  return {
    title: def.boxes.some((b) => b.ph === 'title') ? (def.id === 'title' ? '<p:ph type="ctrTitle"/>' : '<p:ph type="title"/>') : null,
    bodies: others.map((b, i) => (b.ph === 'subtitle' ? `<p:ph type="subTitle" idx="${i + 1}"/>` : `<p:ph${half ? ' sz="half"' : ''} idx="${i + 1}"/>`)),
  };
}

/** PowerPoint's kind of layout for each built-in one; layouts made here are its custom ones. */
const LAYOUT_TYPE: Record<string, string> = { title: 'title', 'title-content': 'obj', 'two-content': 'twoObj', 'title-only': 'titleOnly', blank: 'blank' };
const layoutType = (id: LayoutId) => (isBuiltinLayout(id) ? LAYOUT_TYPE[id] : 'cust');

/** The id PowerPoint 2010 gives its sections' list in presentation.xml. */
const SECTIONS_EXT = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';

/** A section's id as PowerPoint writes one: a GUID (made from its place, so the same deck saves the same). */
const sectionGuid = (i: number) => `{${(0x5ec70000 + i).toString(16).toUpperCase().padStart(8, '0')}-0000-4000-8000-${(i + 1).toString(16).toUpperCase().padStart(12, '0')}}`;

/** The deck's sections as PowerPoint's own (p14:sectionLst), naming the slides by their ids in sldIdLst. */
export function sectionsXml(sections: SectionCount[] | undefined, n: number): string {
  if (!sections?.length) return '';
  let at = 0;
  const list = sections.map((sec, k) => {
    const ids = Array.from({ length: Math.max(0, Math.min(sec.count, n - at)) }, (_, j) => `<p14:sldId id="${256 + at + j}"/>`).join('');
    at += Math.max(0, sec.count);
    return `<p14:section name="${xmlAttr(sec.name)}" id="${sectionGuid(k)}"><p14:sldIdLst>${ids}</p14:sldIdLst></p14:section>`;
  }).join('');
  return `<p:extLst><p:ext uri="${SECTIONS_EXT}"><p14:sectionLst xmlns:p14="${NS_P14}">${list}</p14:sectionLst></p:ext></p:extLst>`;
}

/** A part in ppt/ as seen from another part in ppt/ or a folder in it. */
const fromPpt = (from: string, path: string) => (from.split('/').length > 2 ? '../' : '') + path.slice(4);

/** A turn as PowerPoint's xfrm keeps it (60000ths of a degree, clockwise), or nothing. */
export const rotAttr = (deg: number | undefined): string => (deg ? ` rot="${Math.round((((deg % 360) + 360) % 360) * 60000)}"` : '');
/** A shape's name and whether it is hidden, as PowerPoint's Selection Pane shows them (cNvPr attributes after the id). */
const nameAttrs = (name: string, hidden?: boolean): string => ` name="${xml(name)}"${hidden ? ' hidden="1"' : ''}`;
export const xfrm = (r: Rect, extra = '') => `<a:xfrm${extra}><a:off x="${emu(r.x1)}" y="${emu(r.y1)}"/><a:ext cx="${Math.max(0, emu(r.x2 - r.x1))}" cy="${Math.max(0, emu(r.y2 - r.y1))}"/></a:xfrm>`;
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

class Writer {
  pkg = new Package();
  private media = 0;
  private mediaFiles = new MediaFiles();
  private tags = 0;
  private tableKeys = 0;
  private measure: Measure;
  /** The slide being written (links are related from it). */
  private curPath = '';

  constructor(private deck: DeckData, private opts: PptxOptions) {
    this.measure = opts.measure ?? arialMeasure;
    for (const [mime, ext] of Object.entries(MIME_EXT)) this.pkg.defaultType(ext, mime);
  }

  /** A picture file in ppt/media; returns its relationship id from `from`. */
  private addMedia(from: string, bytes: Uint8Array, ext: string): string {
    let path = this.mediaFiles.find(bytes, ext);
    if (!path) {
      path = `ppt/media/image${++this.media}.${ext}`;
      this.pkg.add(path, bytes);
      this.mediaFiles.note(bytes, ext, path);
    }
    return this.pkg.relate(from, REL.image, fromPpt(from, path));
  }

  /** A background as PowerPoint's own (p:bg), its picture (if any) in the package. */
  private async background(from: string, bg: Background): Promise<string> {
    let blip: BlipIds | null = null;
    if (bg.kind === 'picture') {
      try {
        const { mime, bytes } = fromDataUrl(bg.src);
        const ext = MIME_EXT[mime];
        if (ext === 'svg') {
          // PowerPoint shows the SVG; older programs the PNG beside it
          const k = Math.min(4, 3000 / Math.max(1, bg.px.w, bg.px.h));
          const png = await this.opts.svgToPng(new TextDecoder().decode(bytes), Math.max(1, Math.round(bg.px.w * k)), Math.max(1, Math.round(bg.px.h * k)));
          blip = { id: this.addMedia(from, png, 'png'), svg: this.addMedia(from, bytes, 'svg') };
        } else if (ext) blip = { id: this.addMedia(from, bytes, ext), svg: null };
      } catch { /* a picture that can't be read: a white background */ }
    }
    return bgXml(bg, this.deck.size.w, this.deck.size.h, blip);
  }

  /** A set of tags in ppt/tags; returns its relationship id from `from`. */
  private addTags(from: string, tags: Record<string, string>): string {
    const path = `ppt/tags/tag${++this.tags}.xml`;
    const list = Object.entries(tags).map(([k, v]) => `<p:tag name="${xml(k)}" val="${xmlAttr(v)}"/>`).join('');
    this.pkg.add(path, `${HEAD}<p:tagLst ${XMLNS}>${list}</p:tagLst>`, CT.tags);
    return this.pkg.relate(from, REL.tags, fromPpt(from, path));
  }

  /**
   * A link as PowerPoint's: web pages, e-mail and files through a relationship, a slide as a
   * jump to that slide's part, and first/last/next/previous as PowerPoint's show jumps.
   */
  private hlink: LinkXml = (link) => {
    const from = this.curPath;
    if (!from) return '';
    const jump = ({ '#first': 'firstslide', '#last': 'lastslide', '#next': 'nextslide', '#prev': 'previousslide', '#return': 'lastslideviewed', '#end': 'endshow' } as Record<string, string>)[link];
    if (jump) return `<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=${jump}"/>`;
    const id = slideOfLink(link);
    if (id !== null) {
      const i = this.deck.slides.findIndex((s) => s.id === id);
      return i < 0 ? '' : `<a:hlinkClick r:id="${this.pkg.relate(from, REL.slide, `slide${i + 1}.xml`)}" action="ppaction://hlinksldjump"/>`;
    }
    if (link.startsWith('#')) return '';
    return `<a:hlinkClick r:id="${this.pkg.relate(from, REL.hyperlink, officeTarget(link), true)}"/>`;
  };

  async build(): Promise<Uint8Array> {
    const { pkg, deck } = this;
    const n = deck.slides.length;
    // (a notes master too when notes pages have a look of their own, and a handout master for handouts')
    const hasNotes = deck.slides.some((s) => s.notes.trim()) || !!deck.master.notesHF || !!deck.master.notesPage;
    const hasHandout = !!deck.master.handout || !!deck.master.notesHF;
    pkg.add('ppt/presentation.xml', '', CT.presentation); // filled in below, once the ids are known
    pkg.relate('', REL.officeDocument, 'ppt/presentation.xml');
    pkg.relate('', REL.coreProps, 'docProps/core.xml');
    pkg.relate('', REL.extendedProps, 'docProps/app.xml');
    pkg.add('docProps/core.xml', this.core(), CT.core);
    pkg.add('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Chem Illustrator</Application><Slides>${n}</Slides><Notes>${deck.slides.filter((s) => s.notes.trim()).length}</Notes><PresentationFormat>${deck.size.w === 960 && deck.size.h === 540 ? 'Widescreen' : deck.size.w === 720 && deck.size.h === 540 ? 'On-screen Show (4:3)' : 'Custom'}</PresentationFormat></Properties>`, CT.app);

    const P = 'ppt/presentation.xml';
    const masterRel = pkg.relate(P, REL.slideMaster, 'slideMasters/slideMaster1.xml');
    pkg.add('ppt/theme/theme1.xml', theme(deck.master, deck.master.template || 'Chem Illustrator'), CT.theme);
    pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.theme, '../theme/theme1.xml');
    // layouts first, so the master can list them
    const layoutRels: string[] = [];
    const layouts = deckLayouts(deck.master);
    for (const [i, l] of layouts.entries()) {
      const path = `ppt/slideLayouts/slideLayout${i + 1}.xml`;
      pkg.add(path, await this.layout(path, l), CT.layout);
      pkg.relate(path, REL.slideMaster, '../slideMasters/slideMaster1.xml');
      layoutRels.push(pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.slideLayout, `../slideLayouts/slideLayout${i + 1}.xml`));
    }
    pkg.add('ppt/slideMasters/slideMaster1.xml', await this.master(layoutRels), CT.master);

    let notesMasterRel = '';
    if (hasNotes) {
      notesMasterRel = pkg.relate(P, REL.notesMaster, 'notesMasters/notesMaster1.xml');
      pkg.add('ppt/theme/theme2.xml', theme(deck.master, 'Notes'), CT.theme);
      pkg.relate('ppt/notesMasters/notesMaster1.xml', REL.theme, '../theme/theme2.xml');
      pkg.add('ppt/notesMasters/notesMaster1.xml', notesMasterXml(deck.master, deck.size, HEAD, XMLNS, GROUP, lang), CT.notesMaster);
    }
    let handoutRel = '';
    if (hasHandout) {
      handoutRel = pkg.relate(P, REL.handoutMaster, 'handoutMasters/handoutMaster1.xml');
      pkg.add('ppt/theme/theme3.xml', theme(deck.master, 'Handout'), CT.theme);
      pkg.relate('ppt/handoutMasters/handoutMaster1.xml', REL.theme, '../theme/theme3.xml');
      pkg.add('ppt/handoutMasters/handoutMaster1.xml', handoutMasterXml(deck.master, deck.size, HEAD, XMLNS, GROUP, lang), CT.handoutMaster);
    }
    const slideRels: string[] = [];
    const cmts = writeSlideComments(deck.slides.map((s) => s.comments));
    if (cmts.authors) {
      pkg.add('ppt/commentAuthors.xml', cmts.authors, COMMENT_CT.authors);
      pkg.relate(P, COMMENT_REL.authors, 'commentAuthors.xml');
    }
    for (let i = 0; i < n; i++) {
      const path = `ppt/slides/slide${i + 1}.xml`;
      slideRels.push(pkg.relate(P, REL.slide, `slides/slide${i + 1}.xml`));
      const s = deck.slides[i];
      pkg.relate(path, REL.slideLayout, `../slideLayouts/slideLayout${Math.max(0, layouts.findIndex((l) => l.id === s.layout)) + 1}.xml`);
      pkg.add(path, await this.slide(path, i), CT.slide);
      const cm = cmts.slides[i];
      if (cm) {
        pkg.add(`ppt/comments/comment${i + 1}.xml`, cm, COMMENT_CT.comments);
        pkg.relate(path, COMMENT_REL.comments, `../comments/comment${i + 1}.xml`);
      }
      if (s.notes.trim()) {
        const np = `ppt/notesSlides/notesSlide${i + 1}.xml`;
        pkg.add(np, this.notesSlide(s.notes), CT.notes);
        pkg.relate(np, REL.notesMaster, '../notesMasters/notesMaster1.xml');
        pkg.relate(np, REL.slide, `../slides/slide${i + 1}.xml`);
        pkg.relate(path, REL.notesSlide, `../notesSlides/notesSlide${i + 1}.xml`);
      }
    }
    pkg.add('ppt/presProps.xml', `${HEAD}<p:presentationPr ${XMLNS}>${showPrXml(deck.settings?.show, deck.settings?.customShows ?? [])}</p:presentationPr>`, CT.presProps);
    pkg.relate(P, REL.presProps, 'presProps.xml');
    // the guides and grid, where PowerPoint keeps them
    pkg.add('ppt/viewProps.xml', `${HEAD}${viewPropsXml(deck.settings?.view, XMLNS)}`, CT.viewProps);
    pkg.relate(P, REL.viewProps, 'viewProps.xml');
    pkg.add('ppt/tableStyles.xml', `${HEAD}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`, CT.tableStyles);
    pkg.relate(P, REL.tableStyles, 'tableStyles.xml');
    pkg.relate(P, REL.theme, 'theme/theme1.xml');
    const masterTags = this.addTags(P, { [TAG.master]: JSON.stringify(masterSettings(deck.master)), ...(deck.design ? { [TAG.design]: '1' } : {}) });
    const { w, h } = deck.size;
    // the free fonts the slides use go inside the file, so they look the same where they aren't installed
    const embed = await facesToEmbed(pkg.xmlTexts(), this.opts.fonts);
    let fontList = '';
    if (embed.length) {
      pkg.defaultType('fntdata', 'application/x-fontdata');
      let n = 0;
      fontList = '<p:embeddedFontLst>' + embed.map(({ family, faces }) => {
        const ids = new Map<string, string>();
        for (const f of faces) {
          const name = `fonts/font${++n}.fntdata`;
          pkg.add(`ppt/${name}`, toEot(f.data));
          ids.set(f.bold ? (f.italic ? 'boldItalic' : 'bold') : f.italic ? 'italic' : 'regular', pkg.relate(P, REL.font, name));
        }
        const kinds = ['regular', 'bold', 'italic', 'boldItalic'].filter((k) => ids.has(k));
        return `<p:embeddedFont><p:font typeface="${xml(family)}" charset="0"/>${kinds.map((k) => `<p:${k} r:id="${ids.get(k)}"/>`).join('')}</p:embeddedFont>`;
      }).join('') + '</p:embeddedFontLst>';
    }
    pkg.add(P, `${HEAD}<p:presentation ${XMLNS} saveSubsetFonts="1"${embed.length ? ' embedTrueTypeFonts="1"' : ''}>` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRel}"/></p:sldMasterIdLst>` +
      (hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterRel}"/></p:notesMasterIdLst>` : '') +
      (hasHandout ? `<p:handoutMasterIdLst><p:handoutMasterId r:id="${handoutRel}"/></p:handoutMasterIdLst>` : '') +
      `<p:sldIdLst>${slideRels.map((r, i) => `<p:sldId id="${256 + i}" r:id="${r}"/>`).join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${emu(w)}" cy="${emu(h)}"${w === 720 && h === 540 ? ' type="screen4x3"' : ''}/>` +
      (deck.master.notesPage?.landscape ? `<p:notesSz cx="9144000" cy="6858000"/>` : `<p:notesSz cx="6858000" cy="9144000"/>`) + fontList +
      custShowsXml(deck.settings?.customShows ?? [], (sid) => slideRels[deck.slides.findIndex((x) => x.id === sid)], xml) +
      `<p:custDataLst><p:tags r:id="${masterTags}"/></p:custDataLst>` +
      `<p:defaultTextStyle>${defaultLevels(this.deck.master)}</p:defaultTextStyle>` +
      sectionsXml(deck.sections, n) +
      `</p:presentation>`, CT.presentation);
    return pkg.build();
  }

  private core(): string {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xml(this.opts.title ?? 'Slides')}</dc:title><cp:revision>1</cp:revision>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  }

  // ---------------------------------------------------------------- master and layouts

  private async master(layoutRels: string[]): Promise<string> {
    const m = this.deck.master;
    const size = this.deck.size;
    const frames = layoutFrames('title-content', size);
    const d = decorFrames(size, m);
    const P = 'ppt/slideMasters/slideMaster1.xml';
    const logo = m.logo && d.logo ? await this.picture(P, m.logo.src, d.logo, 'Logo', 90, null) : '';
    const tree = [
      phShape(2, 'Title Placeholder 1', '<p:ph type="title"/>', frames[0], 'Click to edit Master title style', 'anchor="t"'),
      phShape(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', frames[1], 'Click to edit Master text styles', 'anchor="t"'),
      footerShape(4, 'Footer Placeholder 3', '<p:ph type="ftr" sz="quarter" idx="3"/>', d.footer, m, ''),
      footerShape(5, 'Slide Number Placeholder 4', '<p:ph type="sldNum" sz="quarter" idx="4"/>', d.number, m, '‹#›'),
      footerShape(6, 'Date Placeholder 5', '<p:ph type="dt" sz="half" idx="2"/>', d.date, m, dateText(m)),
      logo,
    ].join('');
    const bg = await this.background(P, m.fill ?? { kind: 'solid', color: m.background });
    return `${HEAD}<p:sldMaster ${XMLNS}><p:cSld>${bg}` +
      `<p:spTree>${GROUP}${tree}</p:spTree></p:cSld>` +
      `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
      `<p:sldLayoutIdLst>${layoutRels.map((r, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="${r}"/>`).join('')}</p:sldLayoutIdLst>` +
      `<p:txStyles><p:titleStyle>${titleLevel(m)}</p:titleStyle><p:bodyStyle>${bodyLevels(m)}</p:bodyStyle><p:otherStyle>${defaultLevels(m)}</p:otherStyle></p:txStyles>` +
      `</p:sldMaster>`;
  }

  private async layout(path: string, def: LayoutDef): Promise<string> {
    const { id, name } = def;
    const size = this.deck.size;
    const m = this.deck.master;
    const frames = layoutFrames(id, size, m);
    const phs = layoutPh(def);
    let other = 0;
    const d = decorFrames(size, m);
    const c = slideColours(m, id);
    // a title slide with its own colours: they go in its layout's text styles and background
    const own = titleLook(m, id) && !!m.titleSlide;
    const fill = (col: string) => own ? `<a:solidFill><a:srgbClr val="${hex6(col)}"/></a:solidFill>` : '';
    // the template's shapes first, behind the placeholders
    const decor = decorShapes(size, m, id);
    const first = frames.length + 4;
    const shapes = decor.map((sh, k) => decorXml(sh, first + k));
    shapes.push(...frames.map((f, i) => {
      const prompt = f.ph === 'title' ? 'Click to edit Master title style' : f.ph === 'subtitle' ? 'Click to edit Master subtitle style' : 'Click to edit Master text styles';
      const algn = f.justify === 'center' ? 'ctr' : 'l';
      const lst = f.ph === 'subtitle'
        ? `<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="${Math.round(m.subtitleSize * 100)}">${fill(c.textColor)}</a:defRPr></a:lvl1pPr>`
        : f.ph === 'title' ? `<a:lvl1pPr algn="${algn}"><a:defRPr>${fill(c.titleColor)}</a:defRPr></a:lvl1pPr>` : '';
      return phShape(i + 2, `${f.ph === 'title' ? 'Title' : f.ph === 'subtitle' ? 'Subtitle' : 'Content Placeholder'} ${i + 1}`, f.ph === 'title' ? phs.title! : phs.bodies[other++],
        f, prompt, 'anchor="t"', lst);
    }));
    const fm = { ...m, footerColor: c.footerColor };
    shapes.push(footerShape(frames.length + 2, `Footer Placeholder ${frames.length + 1}`, '<p:ph type="ftr" sz="quarter" idx="11"/>', d.footer, fm, ''));
    shapes.push(footerShape(frames.length + 3, `Slide Number Placeholder ${frames.length + 2}`, '<p:ph type="sldNum" sz="quarter" idx="12"/>', d.number, fm, '‹#›'));
    shapes.push(footerShape(first + decor.length, `Date Placeholder ${frames.length + 3}`, '<p:ph type="dt" sz="half" idx="10"/>', d.date, fm, dateText(m)));
    // a title slide's own background goes on its layout
    const ownBg = slideBackground(m, id), base: Background = m.fill ?? { kind: 'solid', color: m.background };
    const bg = own && !sameBackground(ownBg, base) ? await this.background(path, ownBg) : '';
    return `${HEAD}<p:sldLayout ${XMLNS} type="${layoutType(id)}" preserve="1"><p:cSld name="${xml(name)}">${bg}<p:spTree>${GROUP}${shapes.join('')}</p:spTree></p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  }

  // ---------------------------------------------------------------- slides

  private async slide(path: string, index: number): Promise<string> {
    const s = this.deck.slides[index];
    const doc = s.doc;
    this.curPath = path;
    const parts = splitSlide(doc, this.measure);
    const out: string[] = [];
    let id = 2;
    // which PowerPoint shapes each object went into, for the animations
    const spids = new Map<string, number[]>();
    const mark = (sel: Partial<Selection>, ...ids: number[]) => {
      const add = (k: string) => spids.set(k, [...(spids.get(k) ?? []), ...ids]);
      for (const a of sel.atoms ?? []) add(`atom ${a}`);
      for (const c of sel.captions ?? []) add(`caption ${c}`);
      for (const r of sel.arrows ?? []) add(`arrow ${r}`);
      for (const x of sel.shapes ?? []) add(`shape ${x}`);
    };
    const styles = textStyles(this.deck.master, s.layout);
    const phCount: Record<string, number> = {};
    // the title first, so screen readers read it first (things are read in the order they are
    // stacked), unless it overlaps something it must stay in front of
    const title = parts.texts.find((c) => c.ph === 'title' && c.runs.some((r) => r.text.trim()));
    if (title && !titleOverlaps(doc, title, roughCaptionBox(title, styles.title?.size ?? 32))) {
      parts.texts.splice(parts.texts.indexOf(title), 1);
      mark({ captions: new Set([title.id]) }, id);
      out.push(this.text(path, title, id++, s.layout, styles, phCount, doc));
    }
    // pictures and shapes at the back, as on screen
    const videos: MediaTiming[] = [];
    // pictures and shapes in their order front to back (the Selection Pane's), back first
    for (const p of shapeOrder([...parts.pictures, ...parts.shapes])) {
      mark({ shapes: new Set([p.id]) }, id);
      if (p.kind !== 'picture') {
        out.push(p.kind === 'geo' ? this.geo(path, p, id++, doc, styles.body?.size ?? doc.style.captionSize) : shapeXml(p, id++, doc.style.lineWidth));
        continue;
      }
      const box = { x1: Math.min(p.x1, p.x2), y1: Math.min(p.y1, p.y2), x2: Math.max(p.x1, p.x2), y2: Math.max(p.y1, p.y2) };
      if (p.chart) { out.push(await this.chart(path, p.chart, box, id++, p.src, p.alt)); continue; }
      if (p.math) { out.push(await this.equation(path, p, box, id++)); continue; }
      if (p.zoom && p.link) { const z = this.zoomXml(path, p, box, id); if (z) { out.push(z); id++; continue; } }
      const v = p.video ? this.video(path, p.video, p.src!, box, id, p) : '';
      if (v) { videos.push({ spid: id, media: p.video! }); out.push(v); id++; continue; }
      out.push(await this.picture(path, p.src!, box, p.name?.trim() || `Picture ${id - 1}`, id++, p.crop ?? null, p.look, p));
    }
    for (const r of parts.connectors) {
      mark({ arrows: new Set([r.id]) }, id);
      out.push(this.connector(path, r, id++, doc.style.lineWidth));
    }
    // diagrams: a group each, which animates as one
    for (const g of parts.diagrams) {
      const gid = id++;
      mark({ shapes: new Set([g.frame.id, ...g.shapes.map((x) => x.id)]), arrows: new Set(g.connectors.map((x) => x.id)) }, gid);
      const kids = [
        ...g.shapes.map((sh) => this.geo(path, sh, id++, doc, styles.body?.size ?? doc.style.captionSize)),
        ...g.connectors.map((r) => this.connector(path, r, id++, doc.style.lineWidth)),
      ];
      const { id: _, x1: _a, y1: _b, x2: _c, y2: _d, frame: _f, ...look } = g.frame;
      const tag = this.addTags(path, { [TAG.diagram]: JSON.stringify({ v: 1, s: look }) });
      out.push(groupXml(gid, `Diagram ${gid - 1}`, shapeBox(g.frame), kids.join(''), `<p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst>`));
    }
    for (const tb of parts.tables) {
      const used: number[] = [];
      out.push(this.table(path, tb, () => { used.push(id); return id++; }, s.layout, styles, phCount, doc));
      mark({ shapes: new Set([tb.id]) }, ...used);
    }
    // structures and schemes
    for (const sel of parts.drawings) {
      const part = extractDrawing(doc, sel);
      // highlights animated on their own go in pictures of their own, under the structure
      const moving = highlightParts(doc, sel).filter((h) => (s.anims ?? []).some((a) => partHolds(h, a.target)));
      const bare = moving.length ? extractDrawing(doc, sel) : part;
      for (const h of moving) {
        for (const a of h.sel.atoms) { const x = bare.atoms.get(a); if (x) { delete x.highlight; delete x.hl; } }
        for (const b of h.sel.bonds) { const x = bare.bonds.get(b); if (x) { delete x.highlight; delete x.hl; } }
      }
      const pic = await this.opts.picture(bare);
      if (!pic) continue;
      const cdxml = writeCdxml(part, { name: 'Slide drawing.cdxml', textMeasure: this.measure });
      const box = [pic.box.x1, pic.box.y1, pic.box.x2, pic.box.y2].map((v) => +v.toFixed(3)).join(' ');
      for (const h of moving) {
        const only = extractDrawing(doc, sel);
        only.onlyHighlights = true;
        for (const a of only.atoms.values()) if (!h.sel.atoms.has(a.id)) { delete a.highlight; delete a.hl; }
        for (const b of only.bonds.values()) if (!h.sel.bonds.has(b.id)) { delete b.highlight; delete b.hl; }
        const hp = await this.opts.picture(only);
        if (!hp) continue;
        const at = highlightSpot(doc, h.sel);
        if (!at) continue;
        const htags = this.addTags(path, { [TAG.highlight]: JSON.stringify({ ...at, box }) });
        const hpng = this.addMedia(path, hp.png, 'png');
        const hsvg = this.addMedia(path, new TextEncoder().encode(hp.svg), 'svg');
        for (const a of h.sel.atoms) spids.set(`highlight ${a}`, [...(spids.get(`highlight ${a}`) ?? []), id]);
        for (const b of h.sel.bonds) spids.set(`highlight b${b}`, [...(spids.get(`highlight b${b}`) ?? []), id]);
        out.push(picXml(id, `Highlight ${id - 1}`, hpng, hsvg, hp.box, null, htags));
        id++;
      }
      const tags = this.addTags(path, { [TAG.cdxml]: cdxml, [TAG.box]: box });
      const png = this.addMedia(path, pic.png, 'png');
      const svg = this.addMedia(path, new TextEncoder().encode(pic.svg), 'svg');
      mark(sel, id);
      const smiles = await this.opts.smiles?.(part).catch(() => null) ?? null;
      out.push(picXml(id, `Structure ${id - 1}`, png, svg, pic.box, null, tags, undefined, contentsAlt(part.contents()) ?? structureAltText(smiles)));
      id++;
    }
    // text on top
    for (const c of parts.texts) {
      mark({ captions: new Set([c.id]) }, id);
      out.push(this.text(path, c, id++, s.layout, styles, phCount, doc));
    }
    // slide number and footer, when the master shows them
    const m = this.deck.master;
    const d = decorFrames(this.deck.size, m);
    if (showsNumber(m, s.layout, s.hf)) out.push(footerShape(id++, 'Slide Number', '<p:ph type="sldNum" sz="quarter" idx="12"/>', d.number, m, String(index + 1), true));
    if (showsFooter(m, s.layout, s.hf)) out.push(footerShape(id++, 'Footer', '<p:ph type="ftr" sz="quarter" idx="11"/>', d.footer, m, m.footer, true));
    if (showsDate(m, s.layout, s.hf)) out.push(footerShape(id++, 'Date', '<p:ph type="dt" sz="half" idx="10"/>', d.date, m, dateText(m), true));
    const tags = this.addTags(path, { [TAG.layout]: s.layout, ...(s.id !== undefined ? { [TAG.slideId]: String(s.id) } : {}) });
    const bg = s.background ? await this.background(path, s.background) : '';
    return `${HEAD}<p:sld ${XMLNS}${s.hideGraphics ? ' showMasterSp="0"' : ''}${s.hidden ? ' show="0"' : ''}><p:cSld>${bg}<p:spTree>${GROUP}${out.join('')}</p:spTree><p:custDataLst><p:tags r:id="${tags}"/></p:custDataLst></p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(s.transition)}${timingXml(expandParas(s.anims ?? [], (cid) => { const c = doc.captions.get(cid); return c ? plainText(c.runs).split('\n') : null; }), (a) => spids.get(targetKey(a.target)) ?? [], videos, (t) => spids.get(targetKey(t))?.[0])}` +
      // the slide's creation number, which zooms name it by
      `<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="${NS_P14}" val="${creationId(index)}"/></p:ext></p:extLst></p:sld>`;
  }

  /**
   * A chart: PowerPoint's own chart, with its data as a workbook inside (for Edit Data); a tag
   * keeps it as made here, used when PowerPoint's copy charts the same numbers.
   */
  private charts = 0;
  private async chart(path: string, box0: ChartBox, box: Rect, id: number, src?: string, alt?: string): Promise<string> {
    const w = box.x2 - box.x1, h = box.y2 - box.y1;
    const rid = await addChart(this.pkg, path, 'ppt', ++this.charts, box0, w, h);
    const tags = this.addTags(path, { [TAG.chart]: JSON.stringify(box0) });
    const ex = isChartEx(box0.chart.kind);
    const uri = ex ? CX_NS : C_NS, tag = ex ? 'cx' : 'c';
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id - 1}"${alt?.trim() ? ` descr="${xml(alt.trim())}"` : ''}/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
      `<p:nvPr><p:custDataLst><p:tags r:id="${tags}"/></p:custDataLst></p:nvPr></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="${emu(box.x1)}" y="${emu(box.y1)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="${uri}"><${tag}:chart xmlns:${tag}="${uri}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
    if (!ex) return frame;
    // PowerPoint 2016's newer chart, with a picture of it for older programs
    const pic = src ? await this.picture(path, src, box, `Chart ${id - 1}`, id, null, undefined, undefined, alt) : '';
    return `<mc:AlternateContent xmlns:mc="${MC_NS}"><mc:Choice xmlns:cx1="${CX1_NS}" Requires="cx1">${frame}</mc:Choice><mc:Fallback>${pic}</mc:Fallback></mc:AlternateContent>`;
  }

  /**
   * An equation: PowerPoint's own (Office Math in a text box, the way PowerPoint saves one), at
   * the size it shows here, with a picture of it for programs that don't know equations. A tag
   * keeps the LaTeX as typed here.
   */
  private async equation(path: string, s: Shape, box: Rect, id: number): Promise<string> {
    const m = s.math!;
    const w = box.x2 - box.x1, h = box.y2 - box.y1;
    const size = m.size * shapeMathScale(m, w, h, this.measure);
    const sz = Math.max(100, Math.round(size * 100));
    const look = `<a:rPr ${lang} sz="${sz}" dirty="0"><a:solidFill><a:srgbClr val="${hex6(m.color)}"/></a:solidFill><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr>`;
    const tags = this.addTags(path, { [TAG.math]: JSON.stringify(m) });
    const name = s.name?.trim() || `Equation ${id - 1}`;
    const choice = `<p:sp><p:nvSpPr><p:cNvPr id="${id}"${nameAttrs(name, s.hidden)}/><p:cNvSpPr txBox="1"/><p:nvPr><p:custDataLst><p:tags r:id="${tags}"/></p:custDataLst></p:nvPr></p:nvSpPr>` +
      `<p:spPr>${xfrm(box, rotAttr(s.rot))}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
      `<a:p><a:pPr algn="ctr"/><a14:m><m:oMathPara xmlns:m="${NS_M}"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr><m:oMath>${toOmml(m.tex, look)}</m:oMath></m:oMathPara></a14:m>` +
      `<a:endParaRPr ${lang} sz="${sz}" dirty="0"/></a:p></p:txBody></p:sp>`;
    // programs without equations show its picture (300 dots per inch)
    let fallback = '';
    try {
      const svg = new TextDecoder().decode(fromDataUrl(shapeMathPicture(m, this.measure)).bytes);
      const k = 300 / 72;
      const png = await this.opts.svgToPng(svg, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
      fallback = picXml(id, name, this.addMedia(path, png, 'png'), null, box, null, null, undefined, mathText(m.tex), undefined, undefined, { rot: s.rot, hidden: s.hidden });
    } catch { /* PowerPoint shows the equation itself */ }
    return `<mc:AlternateContent xmlns:mc="${NS_MC}"><mc:Choice xmlns:a14="${NS_A14}" Requires="a14">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
  }

  /**
   * A Slide Zoom: PowerPoint 2019 and 365's own zoom, with a picture that goes to the slide when
   * clicked for older ones (and other programs). A tag keeps how it comes back and where a
   * Summary Zoom's part ends.
   */
  private zoomXml(from: string, p: Shape, box: Rect, id: number): string {
    const target = slideOfLink(p.link ?? '');
    const i = target === null ? -1 : this.deck.slides.findIndex((s) => s.id === target);
    if (i < 0 || !p.src) return '';
    let still: { mime: string; bytes: Uint8Array };
    try { still = fromDataUrl(p.src); } catch { return ''; }
    const ext = MIME_EXT[still.mime];
    if (!ext || ext === 'svg') return '';
    const blip = this.addMedia(from, still.bytes, ext);
    const rel = this.pkg.relate(from, REL.slide, `slide${i + 1}.xml`);
    const tags = this.addTags(from, { [TAG.zoom]: JSON.stringify({ v: 1, zoom: p.zoom, link: p.link }) });
    const w = box.x2 - box.x1, h = box.y2 - box.y1;
    const name = `Slide Zoom ${id - 1}`;
    const guid = `{${(0x5a00 + id).toString(16).padStart(8, '0').toUpperCase()}-0000-4000-8000-${(1000000 + i).toString(16).padStart(12, '0').toUpperCase()}}`;
    const line = '<a:ln w="3175"><a:solidFill><a:prstClr val="ltGray"/></a:solidFill></a:ln>';
    const P166 = 'http://schemas.microsoft.com/office/powerpoint/2016/6/main';
    const choice = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr>` +
      `<p:nvPr><p:custDataLst><p:tags r:id="${tags}"/></p:custDataLst></p:nvPr></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="${emu(box.x1)}" y="${emu(box.y1)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="${NS_SLIDEZOOM}"><pslz:sldZm><pslz:sldZmObj sldId="${256 + i}" cId="${creationId(i)}">` +
      `<pslz:zmPr id="${guid}" returnToParent="${p.zoom?.back ? 1 : 0}" transitionDur="1000">` +
      `<p166:blipFill xmlns:p166="${P166}"><a:blip r:embed="${blip}"/><a:stretch><a:fillRect/></a:stretch></p166:blipFill>` +
      `<p166:spPr xmlns:p166="${P166}"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${line}</p166:spPr>` +
      `</pslz:zmPr></pslz:sldZmObj></pslz:sldZm></a:graphicData></a:graphic></p:graphicFrame>`;
    const fallback = `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"><a:hlinkClick r:id="${rel}" action="ppaction://hlinksldjump"/></p:cNvPr><p:cNvPicPr><a:picLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvPicPr>` +
      `<p:nvPr><p:custDataLst><p:tags r:id="${tags}"/></p:custDataLst></p:nvPr></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${blip}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${line}</p:spPr></p:pic>`;
    return `<mc:AlternateContent xmlns:mc="${NS_MC}"><mc:Choice xmlns:pslz="${NS_SLIDEZOOM}" Requires="pslz">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
  }

  /**
   * A video or sound with the picture PowerPoint shows until it plays (a video's first frame, a
   * sound's loudspeaker): the file is linked both ways PowerPoint looks for it (PowerPoint 2010's
   * media link, with its trim and fades, and the older video or audio link).
   */
  private video(from: string, m: Media, poster: string, box: Rect, id: number, s?: Shape): string {
    let file: { mime: string; bytes: Uint8Array }, still: { mime: string; bytes: Uint8Array };
    try {
      file = fromDataUrl(m.src);
      still = fromDataUrl(poster);
    } catch {
      return '';
    }
    const ext = MIME_EXT[still.mime];
    const mext = MEDIA_EXT[file.mime];
    if (!ext || ext === 'svg' || !mext) return '';
    const path = `ppt/media/media${++this.media}.${mext}`;
    this.pkg.add(path, file.bytes);
    this.pkg.defaultType(mext, file.mime);
    const media = this.pkg.relate(from, REL_MEDIA, fromPpt(from, path));
    const link = this.pkg.relate(from, m.audio ? REL_AUDIO : REL_VIDEO, fromPpt(from, path));
    const blip = this.addMedia(from, still.bytes, ext);
    const ms = (v: number | undefined) => String(Math.round(Math.max(0, v ?? 0) * 1000 * 10) / 10);
    const trim = m.trimStart || m.trimEnd ? `<p14:trim${m.trimStart ? ` st="${ms(m.trimStart)}"` : ''}${m.trimEnd ? ` end="${ms(m.trimEnd)}"` : ''}/>` : '';
    const fade = m.fadeIn || m.fadeOut ? `<p14:fade${m.fadeIn ? ` inDur="${ms(m.fadeIn)}"` : ''}${m.fadeOut ? ` outDur="${ms(m.fadeOut)}"` : ''}/>` : '';
    const p14 = trim || fade ? `<p14:media xmlns:p14="${NS_P14}" r:embed="${media}">${trim}${fade}</p14:media>` : `<p14:media xmlns:p14="${NS_P14}" r:embed="${media}"/>`;
    const name = m.audio ? `Audio ${id - 1}` : `Video ${id - 1}`;
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}"${nameAttrs(s?.name?.trim() || name, s?.hidden)}><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
      `<p:nvPr>${m.audio ? `<a:audioFile r:link="${link}"/>` : `<a:videoFile r:link="${link}"/>`}<p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}">${p14}</p:ext></p:extLst></p:nvPr></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${blip}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr>${xfrm(box, rotAttr(s?.rot))}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }

  /**
   * A design shape: PowerPoint's own shape where it has one (so PowerPoint can change it), else
   * the outline itself; its text inside, wrapped. A tag keeps the shape as it was.
   */
  private geo(path: string, s: Shape, id: number, doc: Doc, textSize: number): string {
    const def = geoDef(s.geo);
    const { box, geom, fill: plainFill, ln, shadow } = geoSpPr(s, doc.style.lineWidth);
    // a picture fill: the picture stretched to the shape (the tag keeps the rest of the look, not the picture again)
    const fill = s.picFill ? this.picFillXml(path, s.picFill) ?? plainFill : plainFill;
    const justify = s.textAlign ?? 'center';
    const algn = justify === 'center' ? 'ctr' : justify === 'right' ? 'r' : justify === 'justify' ? 'just' : 'l';
    const hasText = !!s.text?.runs.some((r) => r.text);
    const body = hasText
      ? paragraphsXml({ id: 0, x: 0, y: 0, runs: s.text!.runs, paras: s.text!.paras, justify }, { size: textSize, font: doc.style.captionFont || 'Arial' }, textSize, this.measure, this.hlink)
      : `<a:p><a:pPr algn="${algn}"/><a:endParaRPr ${lang} sz="${Math.round(textSize * 100)}" dirty="0"/></a:p>`;
    const anchor = s.textValign === 'top' ? 't' : s.textValign === 'bottom' ? 'b' : 'ctr';
    const ins = def.prst ? 3.6 : 0;
    const bodyPr = `<a:bodyPr wrap="square" lIns="${emu(ins)}" tIns="${emu(ins)}" rIns="${emu(ins)}" bIns="${emu(ins)}" rtlCol="0" anchor="${anchor}"><a:noAutofit/></a:bodyPr>`;
    const { id: _, x1: _a, y1: _b, x2: _c, y2: _d, ...look } = s;
    if (look.picFill) look.picFill = { ...look.picFill, src: '' };
    const plain = s.text?.runs.map((r) => r.text).join('') ?? '';
    const tag = this.addTags(path, { [TAG.geo]: JSON.stringify({ v: 1, s: look, plain, sid: s.id }) });
    const click = s.link ? this.hlink(s.link) : '';
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}"${nameAttrs(s.name?.trim() || `${def.name} ${id - 1}`, s.hidden)}${click ? `>${click}</p:cNvPr>` : '/>'}<p:cNvSpPr/><p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvSpPr>` +
      `<p:spPr>${xfrm(box, rotAttr(s.rot))}${geom}${fill}${ln}${shadow}</p:spPr><p:txBody>${bodyPr}<a:lstStyle/>${body}</p:txBody></p:sp>`;
  }

  /** A shape's picture fill as PowerPoint's blipFill, the picture added to the file (null when it can't be read). */
  private picFillXml(path: string, f: NonNullable<Shape['picFill']>): string | null {
    const m = /^data:image\/(png|jpeg|jpg|gif);base64,(.*)$/i.exec(f.src);
    if (!m) return null;
    const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
    const id = this.addMedia(path, bytes, m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase());
    const clear = Math.max(0, Math.min(1, f.transparency ?? 0));
    const alpha = clear ? `<a:alphaModFix amt="${Math.round((1 - clear) * 100000)}"/>` : '';
    return `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${id}">${alpha}</a:blip><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
  }

  /**
   * A connector: PowerPoint's straight connector, or a bent line for an elbow, with its heads.
   * A tag keeps the arrow (and which shapes it is stuck to).
   */
  private connector(path: string, r: Arrow, id: number, lw: number): string {
    const { frame, geom, ln, curved } = connectorSpPr(r, lw);
    const { id: _, ...keep } = r;
    const tag = this.addTags(path, { [TAG.connector]: JSON.stringify({ v: 1, a: keep }) });
    const nvPr = `<p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr>`;
    // a curved arrow is a shape drawn along the curve (programs route a connector afresh, square)
    if (curved) return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Curved Arrow ${id - 1}"/><p:cNvSpPr/>${nvPr}</p:nvSpPr><p:spPr>${frame}${geom}${ln}</p:spPr></p:sp>`;
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${r.elbow ? 'Elbow Connector' : 'Straight Arrow Connector'} ${id - 1}"/><p:cNvCxnSpPr/>${nvPr}</p:nvCxnSpPr>` +
      `<p:spPr>${frame}${geom}${ln}</p:spPr></p:cxnSp>`;
  }

  /** A picture from image data, cropped as given, with its Picture Format settings (`pic`) as PowerPoint's, and its alt text. */
  private async picture(from: string, src: string, box: Rect, name: string, id: number, crop: Shape['crop'] | null, look?: PictureLook, pic?: Shape, alt = pic?.alt): Promise<string> {
    let mime: string, bytes: Uint8Array;
    try {
      ({ mime, bytes } = fromDataUrl(src));
    } catch {
      return '';
    }
    const ext = MIME_EXT[mime];
    if (!ext) return '';
    const fx = tidyFx(pic?.fx);
    const more: PicMore = { rot: pic?.rot, hidden: pic?.hidden };
    const descr = alt?.trim() || undefined;
    // what Office can't show live goes in worked in, with the original as the picture's layer
    let baked: Uint8Array | null = null;
    if (pic && bakedPart(fx) && this.opts.bakePicture) baked = await this.opts.bakePicture(pic).catch(() => null);
    const tags = fx?.bg?.tol !== undefined ? this.addTags(from, { [TAG.picture]: JSON.stringify({ v: 1, tol: fx.bg.tol }) }) : null;
    if (ext === 'svg') {
      // PowerPoint shows the SVG; older programs the PNG beside it (300 dots per inch)
      const k = 300 / 72;
      const png = await this.opts.svgToPng(new TextDecoder().decode(bytes), Math.max(1, Math.round((box.x2 - box.x1) * k)), Math.max(1, Math.round((box.y2 - box.y1) * k)));
      if (baked) return picXml(id, name, this.addMedia(from, baked, 'png'), null, box, crop, tags, look, descr, fx, this.addMedia(from, png, 'png'), more);
      return picXml(id, name, this.addMedia(from, png, 'png'), this.addMedia(from, bytes, 'svg'), box, crop, tags, look, descr, fx, undefined, more);
    }
    const own = this.addMedia(from, bytes, ext);
    if (baked) return picXml(id, name, this.addMedia(from, baked, 'png'), null, box, crop, tags, look, descr, fx, own, more);
    return picXml(id, name, own, null, box, crop, tags, look, descr, fx, undefined, more);
  }

  /** A title, text placeholder or text box. */
  private text(path: string, c: Caption, id: number, layout: LayoutId, styles: ReturnType<typeof textStyles>, phCount: Record<string, number>, doc: Doc, more: Record<string, string> = {}): string {
    const base = c.ph ? styles[c.ph] : undefined;
    const size0 = c.runs[0]?.size ?? base?.size ?? doc.style.captionSize;
    const lay = layoutText(c.ph ? { ...c, runs: applyBase(c.runs, base) } : c, base?.size ?? doc.style.captionSize, this.measure);
    const firstSize = lay.lines[0] ? lay.lines[0].ascent / ASCENT : size0;
    // the box: the placeholder's own, or around the text, moved so PowerPoint's first baseline is ours
    const top = c.y - PPT_ASCENT * firstSize;
    const width = c.wrap ?? lay.boxWidth;
    const grown = (lay.box.y2 - (lay.lines[0]?.y ?? 0)) + PPT_ASCENT * firstSize + 0.1 * firstSize;
    const height = c.ph && c.boxH ? Math.max(c.boxH, lay.box.y2 - lay.box.y1) : c.fit && c.boxH ? Math.max(c.boxH, c.fit === 'shrink' ? 0 : grown) : grown;
    let box = { x1: c.x, y1: top, x2: c.x + Math.max(width, 1), y2: top + height };
    // where the text starts in its box; turned text: the box moved so that PowerPoint, turning it
    // about its middle, puts the text where it is here (turned about where it starts)
    const o = [+(c.x - box.x1).toFixed(3), +(c.y - box.y1).toFixed(3)];
    if (c.rot) {
      const mid = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
      const to = turnAbout(mid, c, c.rot);
      box = { x1: box.x1 + to.x - mid.x, y1: box.y1 + to.y - mid.y, x2: box.x2 + to.x - mid.x, y2: box.y2 + to.y - mid.y };
    }
    const explicit = c.ph ? null : { size: doc.style.captionSize, font: doc.style.captionFont || 'Arial' };
    const body = isEmptyText(c) && c.ph ? `<a:p><a:endParaRPr ${lang} dirty="0"/></a:p>` : paragraphsXml(c, explicit, base?.size ?? doc.style.captionSize, this.measure, this.hlink);
    const wrap = c.wrap !== undefined || c.ph ? 'square' : 'none';
    // AutoFit: shrink text on overflow (at the size it is shrunk to here), a box that keeps its
    // size, or one that grows with its text
    const fit = c.ph || c.fit === 'fixed' ? '<a:noAutofit/>'
      : c.fit === 'shrink' ? `<a:normAutofit${lay.fontScale && lay.fontScale < 1 ? ` fontScale="${Math.round(lay.fontScale * 100000)}"` : ''}/>`
      : '<a:spAutoFit/>';
    const cols = c.cols && c.cols > 1 && c.wrap !== undefined ? ` numCol="${Math.round(c.cols)}"${c.colGap ? ` spcCol="${emu(c.colGap)}"` : ''}` : '';
    const vert = c.dir ? ` vert="${c.dir}"` : '';
    const bodyPr = `<a:bodyPr wrap="${wrap}"${vert} lIns="0" tIns="0" rIns="0" bIns="0"${cols} rtlCol="0" anchor="t">${fit}</a:bodyPr>`;
    // the caption's exact settings, used when it comes back unchanged from PowerPoint
    const plain = c.runs.map((r) => r.text).join('');
    const at = [box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1].map((v) => +v.toFixed(2));
    const tag = this.addTags(path, { [TAG.text]: JSON.stringify({ c: { ...c, id: undefined }, plain, at, o }), ...more });
    let ph = '';
    if (c.ph) {
      const k = c.ph === 'title' ? 'title' : 'body';
      const i = (phCount[k] = (phCount[k] ?? 0) + 1) - 1;
      const forms = layoutPh(layoutDef(this.deck.master, layout));
      ph = k === 'title' ? (i === 0 && forms.title) || '<p:ph type="title"/>' : forms.bodies[i] ?? ''; // more text boxes than the layout has: plain text boxes
    }
    const name = c.name?.trim() || (c.ph === 'title' ? `Title ${id - 1}` : c.ph ? `Text Placeholder ${id - 1}` : `TextBox ${id - 1}`);
    const nvSp = ph
      ? `<p:nvSpPr><p:cNvPr id="${id}"${nameAttrs(name, c.hidden)}/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}<p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvSpPr>`
      : `<p:nvSpPr><p:cNvPr id="${id}"${nameAttrs(name, c.hidden)}/><p:cNvSpPr txBox="1"/><p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvSpPr>`;
    const geom = ph ? '' : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>';
    // text running down or up: PowerPoint's box is the other way round, turned a quarter less,
    // with the text turned in it
    const quarter = c.dir === 'vert' ? 90 : c.dir === 'vert270' ? -90 : 0;
    const shape = quarter ? swapBox(box) : box;
    const rot = rotAttr((c.rot ?? 0) - quarter);
    return `<p:sp>${nvSp}<p:spPr>${xfrm(shape, rot)}${geom}</p:spPr><p:txBody>${bodyPr}<a:lstStyle/>${body}</p:txBody></p:sp>`;
  }

  /**
   * A table as a PowerPoint table: its cells, joined cells and rules (the same per-cell borders
   * as a ChemDraw table), with its title and footnotes as text boxes above and below it. A tag
   * keeps the table as it was, used when PowerPoint has not changed its text.
   */
  private table(path: string, s: Shape, next: () => number, layout: LayoutId, styles: ReturnType<typeof textStyles>, phCount: Record<string, number>, doc: Doc): string {
    const t = s.table!;
    const lay = layoutTable(t, doc.style.captionSize, this.measure);
    const size = lay.size;
    const key = String(++this.tableKeys);
    const font = doc.style.captionFont || 'Arial';
    const sized = (runs: TextRun[], sz: number) => runs.map((r) => (r.size === undefined ? { ...r, size: sz } : r));
    const out: string[] = [];
    const part = (which: 'title' | 'notes', at: { x: number; y: number }, runs: TextRun[], sz: number) => {
      const c: Caption = { id: 0, x: s.x1 + at.x, y: s.y1 + at.y, runs: sized(runs, sz), justify: 'left', wrap: lay.width };
      out.push(this.text(path, c, next(), layout, styles, phCount, doc, { [TAG.tablePart]: JSON.stringify({ key, part: which }) }));
    };
    if (lay.title) part('title', lay.title, t.title!, size);

    const n = t.rows.length, m = t.cols.length;
    const lw = doc.style.lineWidth;
    const b = tableBorders(t, lw);
    const color = s.color ?? '#000000';
    // PowerPoint puts the first baseline its font's ascent below the cell's top margin
    const marT = Math.max(0, lay.padY - (PPT_ASCENT - ASCENT) * size), marB = Math.max(0, lay.padY - 0.05 * size);
    const solid = (c: string) => `<a:solidFill><a:srgbClr val="${hex6(c)}"/></a:solidFill>`;
    const ln = (side: string, l: CellLine | undefined) => l && l.w > 0
      ? `<a:${side} w="${emu(l.w)}" cap="flat" cmpd="sng" algn="ctr">${solid(l.color)}<a:prstDash val="solid"/><a:round/></a:${side}>`
      : `<a:${side} w="${emu(lw)}" cmpd="sng"><a:noFill/></a:${side}>`;
    const empty = (algn: string) => `<a:p><a:pPr algn="${algn}"/><a:endParaRPr ${lang} sz="${Math.round(size * 100)}" dirty="0"/></a:p>`;
    const algnOf = (j: string) => (j === 'center' ? 'ctr' : j === 'right' ? 'r' : j === 'justify' ? 'just' : 'l');
    // each cell's lines: the table style's (with their colours), or the rules in the drawing's colour
    const styled = !!slideCellLook(t, 0, 0);
    const linesAt = (r: number, c: number): Partial<Record<Side, CellLine>> => {
      const o = coveringCell(t, r, c);
      if (styled) return slideCellLook(t, o.r, o.c)!.lines;
      const x = b[r][c];
      const out: Partial<Record<Side, CellLine>> = {};
      for (const k of ['left', 'right', 'top', 'bottom'] as Side[]) if (x[k] > 0) out[k] = { w: x[k], color };
      return out;
    };
    const lines = t.rows.map((_, r) => t.cols.map((__, c) => linesAt(r, c)));
    const heavier = (a?: CellLine, z?: CellLine) => (!a ? z : !z ? a : z.w > a.w ? z : a);
    const rows: string[] = [];
    for (let r = 0; r < n; r++) {
      const tcs: string[] = [];
      for (let c = 0; c < m; c++) {
        const x = lines[r][c];
        // a line between two cells shows when either cell has it, so both say so
        const left = heavier(x.left, c > 0 ? lines[r][c - 1].right : undefined), right = heavier(x.right, c < m - 1 ? lines[r][c + 1].left : undefined);
        const top = heavier(x.top, r > 0 ? lines[r - 1][c].bottom : undefined), bottom = heavier(x.bottom, r < n - 1 ? lines[r + 1][c].top : undefined);
        const o = coveringCell(t, r, c);
        const look = styled ? slideCellLook(t, o.r, o.c) : null;
        const fill = t.rows[o.r][o.c]?.fill ?? look?.fill;
        const tcPr = `<a:tcPr marL="${emu(lay.padX)}" marR="${emu(lay.padX)}" marT="${emu(marT)}" marB="${emu(marB)}" anchor="t">${ln('lnL', left)}${ln('lnR', right)}${ln('lnT', top)}${ln('lnB', bottom)}${fill ? solid(fill) : '<a:noFill/>'}</a:tcPr>`;
        const align = cellAlign(t, r, c);
        if (o.r !== r || o.c !== c) {
          // a place covered by a joined cell: across (hMerge), down (vMerge) or both
          tcs.push(`<a:tc${o.c !== c ? ' hMerge="1"' : ''}${o.r !== r ? ' vMerge="1"' : ''}><a:txBody><a:bodyPr/><a:lstStyle/>${empty(algnOf(align))}</a:txBody>${tcPr}</a:tc>`);
          continue;
        }
        const cell = t.rows[r][c] ?? { runs: [] };
        const span = spanOf(t, r, c), down = rowSpanOf(t, r, c);
        // the style's text colour and bold are written on the runs, as PowerPoint shows them
        const runs = styledRuns(cell.runs, look);
        const body = runs.some((x) => x.text)
          ? paragraphsXml({ id: 0, x: 0, y: 0, runs, paras: cell.paras, justify: align }, { size, font }, size, this.measure, this.hlink)
          : empty(algnOf(align));
        tcs.push(`<a:tc${down > 1 ? ` rowSpan="${down}"` : ''}${span > 1 ? ` gridSpan="${span}"` : ''}><a:txBody><a:bodyPr/><a:lstStyle/>${body}</a:txBody>${tcPr}</a:tc>`);
      }
      rows.push(`<a:tr h="${emu(lay.ys[r + 1] - lay.ys[r])}">${tcs.join('')}</a:tr>`);
    }
    const grid = t.cols.map((w) => `<a:gridCol w="${emu(w)}"/>`).join('');
    const id = next();
    const tag = this.addTags(path, { [TAG.table]: JSON.stringify({ v: 1, key, table: t, plain: tableText(t) }) });
    const frame = { x1: s.x1, y1: s.y1 + lay.ys[0], x2: s.x1 + lay.width, y2: s.y1 + lay.ys[n] };
    // the cells carry every fill and line themselves, so PowerPoint shows the same whatever the
    // style id; a style PowerPoint knows by id is named so its gallery and options show it,
    // otherwise "No Style, No Grid"
    const look = lookOf(t);
    const styleId = Object.keys(PPT_STYLE_IDS).find((g) => PPT_STYLE_IDS[g] === t.style) ?? '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';
    const flags = styled
      ? `${look.header ? ' firstRow="1"' : ''}${look.firstCol ? ' firstCol="1"' : ''}${look.lastCol ? ' lastCol="1"' : ''}${look.total ? ' lastRow="1"' : ''}${look.bandRows ? ' bandRow="1"' : ''}${look.bandCols ? ' bandCol="1"' : ''}`
      : t.head > 0 ? ' firstRow="1"' : '';
    out.push(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}"${nameAttrs(s.name?.trim() || `Table ${id - 1}`, s.hidden)}/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
      `<p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="${emu(frame.x1)}" y="${emu(frame.y1)}"/><a:ext cx="${emu(frame.x2 - frame.x1)}" cy="${emu(frame.y2 - frame.y1)}"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${flags}><a:tableStyleId>${styleId}</a:tableStyleId></a:tblPr>` +
      `<a:tblGrid>${grid}</a:tblGrid>${rows.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
    if (lay.notes) part('notes', lay.notes, t.notes!, size * NOTE_SCALE);
    return out.join('');
  }

  // ---------------------------------------------------------------- notes

  private notesSlide(text: string): string {
    const paras = text.split('\n').map((t) => (t ? `<a:p><a:r><a:rPr ${lang} dirty="0"/><a:t>${xml(t)}</a:t></a:r></a:p>` : `<a:p><a:endParaRPr ${lang} dirty="0"/></a:p>`)).join('');
    return `${HEAD}<p:notes ${XMLNS}><p:cSld><p:spTree>${GROUP}` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
  }
}

/** One of a design template's shapes, as a plain PowerPoint shape in a slide layout. */
/** A connector's place, path and line with its heads, as PowerPoint and Word (in groups) both write them. */
export function connectorSpPr(r: Arrow, lw: number): { frame: string; geom: string; ln: string; curved: boolean } {
  const curved = !r.elbow && !!r.sweep;
  const pts = r.elbow ? elbowRoute(r) : curved ? arrowPoints(r, 32) : [r.tail, r.head];
  const b = boxOf(pts);
  const w = Math.max(b.x2 - b.x1, 0), h = Math.max(b.y2 - b.y1, 0);
  let geom: string, frame: string;
  if (r.elbow || curved) {
    const steps = pts.map((p, i) => [i ? 'L' : 'M', p.x - b.x1, p.y - b.y1] as GeoStep);
    geom = `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${geoPath(steps, Math.max(w, 0.01), Math.max(h, 0.01), ' fill="none"')}</a:pathLst></a:custGeom>`;
    frame = xfrm(b);
  } else {
    geom = '<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>';
    frame = xfrm(b, `${r.head.x < r.tail.x ? ' flipH="1"' : ''}${r.head.y < r.tail.y ? ' flipV="1"' : ''}`);
  }
  const width = r.lineWidth ?? lw;
  const end = (style: Arrow['headStyle']) => (style === 'none' ? '' : r.headType === 'angle' ? 'arrow' : 'triangle');
  // PowerPoint's "head end" is where the line starts, its "tail end" where it finishes
  const headEnd = end(r.tailStyle), tailEnd = end(r.headStyle);
  const ln = `<a:ln w="${emu(r.line === 'bold' ? width * 2.5 : width)}"><a:solidFill><a:srgbClr val="${hex6(r.color ?? '#000000')}"/></a:solidFill>${r.line === 'dashed' ? '<a:prstDash val="dash"/>' : ''}<a:miter lim="800000"/>` +
    `${headEnd ? `<a:headEnd type="${headEnd}"/>` : ''}${tailEnd ? `<a:tailEnd type="${tailEnd}"/>` : ''}</a:ln>`;
  return { frame, geom, ln, curved };
}

/** A design shape's place, outline, fill, line and effects (shadow, glow, reflection, soft edges, bevel), as PowerPoint and Word (in groups) both write them. */
export function geoSpPr(s: Shape, lw: number): { box: Rect; geom: string; fill: string; ln: string; shadow: string } {
  const def = geoDef(s.geo);
  const box = { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
  const w = box.x2 - box.x1, h = box.y2 - box.y1;
  const width = s.lineWidth ?? (s.bold ? lw * 2.5 : lw);
  let geom: string;
  if (def.prst) geom = `<a:prstGeom prst="${def.prst}"><a:avLst/></a:prstGeom>`;
  else {
    const o = def.draw(w, h);
    const ta = textArea(def, 0, 0, w, h);
    // the text's box through guides (LibreOffice ignores a text box given as plain numbers)
    const f = (v: number, of: number) => Math.round((of > 0 ? v / of : 0) * 100000);
    geom = `<a:custGeom><a:avLst/><a:gdLst><a:gd name="txL" fmla="*/ w ${f(ta.x1, w)} 100000"/><a:gd name="txT" fmla="*/ h ${f(ta.y1, h)} 100000"/><a:gd name="txR" fmla="*/ w ${f(ta.x2, w)} 100000"/><a:gd name="txB" fmla="*/ h ${f(ta.y2, h)} 100000"/></a:gdLst><a:ahLst/><a:cxnLst/>` +
      '<a:rect l="txL" t="txT" r="txR" b="txB"/>' +
      `<a:pathLst>${geoPath(o.body, w, h, '')}${o.lines?.length ? geoPath(o.lines, w, h, ' fill="none"') : ''}</a:pathLst></a:custGeom>`;
  }
  const fc = hex6(s.fillColor ?? s.color ?? '#000000');
  const clear = Math.max(0, Math.min(1, s.transparency ?? 0));
  const alpha = clear ? `<a:alpha val="${Math.round((1 - clear) * 100000)}"/>` : '';
  const fill = patternOrGradient(s, fc, alpha) ?? (!s.filled ? '<a:noFill/>'
    : s.fill === 'faded' ? `<a:solidFill><a:srgbClr val="${hex6(tint('#' + fc, FADE))}">${alpha}</a:srgbClr></a:solidFill>`
    : s.fill === 'shaded' ? `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${hex6(tint('#' + fc, 0.85))}">${alpha}</a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="${fc}">${alpha}</a:srgbClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`
    : `<a:solidFill><a:srgbClr val="${fc}">${alpha}</a:srgbClr></a:solidFill>`);
  const dash = s.dashed ? '<a:prstDash val="dash"/>' : '';
  const ln = width > 0 ? `<a:ln w="${emu(width)}"><a:solidFill><a:srgbClr val="${hex6(s.color ?? '#000000')}"/></a:solidFill>${dash}<a:round/></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  const sl = shadowLook(s, s.shadowSize ?? Math.max(2, 0.04 * Math.min(w, h)));
  const outer = s.shadow ? `<a:outerShdw${sl.blur ? ` blurRad="${emu(sl.blur)}"` : ''} dist="${emu(sl.distance)}" dir="${Math.round((((sl.angle % 360) + 360) % 360) * 60000)}" algn="tl" rotWithShape="0"><a:srgbClr val="${hex6(sl.colour)}"><a:alpha val="${Math.round(sl.opacity * 100000)}"/></a:srgbClr></a:outerShdw>` : '';
  // (the shadow with the glow, reflection and soft edges, and the bevel)
  const shadow = effectsXml(s, outer);
  return { box, geom, fill, ln, shadow };
}

/** A group of shapes, its box the same inside as out (so the shapes keep their places). */
export function groupXml(id: number, name: string, box: Rect, kids: string, nvPr = ''): string {
  const off = `<a:off x="${emu(box.x1)}" y="${emu(box.y1)}"/>`, ext = `<a:ext cx="${Math.max(0, emu(box.x2 - box.x1))}" cy="${Math.max(0, emu(box.y2 - box.y1))}"/>`;
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvGrpSpPr/><p:nvPr>${nvPr}</p:nvPr></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm>${off}${ext}<a:chOff x="${emu(box.x1)}" y="${emu(box.y1)}"/><a:chExt cx="${Math.max(0, emu(box.x2 - box.x1))}" cy="${Math.max(0, emu(box.y2 - box.y1))}"/></a:xfrm></p:grpSpPr>${kids}</p:grpSp>`;
}

function decorXml(sh: DecorShape, id: number): string {
  const nv = (name: string) => `<p:nvSpPr><p:cNvPr id="${id}" name="${name} ${id}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr>`;
  const solid = (c: string) => `<a:solidFill><a:srgbClr val="${hex6(c)}"/></a:solidFill>`;
  if (sh.kind === 'tri') {
    const xs = sh.pts.map((q) => q[0]), ys = sh.pts.map((q) => q[1]);
    const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    const W = box.x2 - box.x1, H = box.y2 - box.y1;
    const pt = ([x, y]: [number, number]) => `<a:pt x="${emu(x - box.x1)}" y="${emu(y - box.y1)}"/>`;
    const path = `<a:moveTo>${pt(sh.pts[0])}</a:moveTo>${sh.pts.slice(1).map((q) => `<a:lnTo>${pt(q)}</a:lnTo>`).join('')}<a:close/>`;
    return `<p:sp>${nv('Triangle')}<p:spPr>${xfrm(box)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>` +
      `<a:pathLst><a:path w="${emu(W)}" h="${emu(H)}">${path}</a:path></a:pathLst></a:custGeom>${solid(sh.color)}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  }
  if (sh.kind === 'line') {
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr userDrawn="1"/></p:nvCxnSpPr>` +
      `<p:spPr>${xfrm({ x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2 })}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${emu(sh.width)}">${solid(sh.color)}</a:ln></p:spPr></p:cxnSp>`;
  }
  const fill = sh.kind === 'rect' ? solid(sh.color) : '<a:noFill/>';
  const ln = sh.kind === 'rect' ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${emu(sh.width)}">${solid(sh.color)}</a:ln>`;
  return `<p:sp>${nv('Rectangle')}<p:spPr>${xfrm(sh)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${ln}</p:spPr></p:sp>`;
}

/** A picture's turn and whether it is hidden (Selection Pane). */
interface PicMore { rot?: number; hidden?: boolean }

/**
 * A picture element: PNG (or another bitmap), optionally with an SVG PowerPoint shows instead,
 * and its Picture Format settings; with `layerId`, the blip has sharpening or Remove Background
 * worked in and the layer is the original.
 */
function picXml(id: number, name: string, blipId: string, svgId: string | null, box: Rect, crop: Shape['crop'] | null, tagsId: string | null, look?: PictureLook, descr?: string, fx?: PictureFx, layerId?: string, more: PicMore = {}): string {
  const exts = (svgId ? `<a:ext uri="${SVG_EXT}"><asvg:svgBlip xmlns:asvg="${NS_SVG}" r:embed="${svgId}"/></a:ext>` : '') + (layerId ? imgPropsXml(fx, layerId, crop) : '');
  const ext = exts ? `<a:extLst>${exts}</a:extLst>` : '';
  const src = crop && (crop.l || crop.t || crop.r || crop.b)
    ? `<a:srcRect l="${Math.round(crop.l * 100000)}" t="${Math.round(crop.t * 100000)}" r="${Math.round(crop.r * 100000)}" b="${Math.round(crop.b * 100000)}"/>` : '';
  const nvPr = tagsId ? `<p:nvPr><p:custDataLst><p:tags r:id="${tagsId}"/></p:custDataLst></p:nvPr>` : '<p:nvPr/>';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}"${nameAttrs(name, more.hidden)}${descr ? ` descr="${xml(descr)}"` : ''}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>${nvPr}</p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${blipId}">${blipEffectsXml(fx)}${ext}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(box, rotAttr(more.rot))}${pictureLookXml(look, fx)}</p:spPr></p:pic>`;
}

/** A picture's outline (rounded, or the shape it is cut to), border line and shadow, as PowerPoint's picture formatting. */
export function pictureLookXml(look: PictureLook | undefined, fx?: PictureFx): string {
  const round = Math.max(0, Math.min(0.5, look?.round ?? 0));
  // PowerPoint's roundRect corner: its adjustment is the radius over the shorter side, in 1/100000ths
  const geom = pictureGeomXml(fx, round ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(round * 100000)}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>');
  const ln = look?.line ? `<a:ln w="${emu(look.line)}"><a:solidFill><a:srgbClr val="${hex6(look.lineColor ?? '#000000')}"/></a:solidFill></a:ln>` : '';
  const sh = look?.shadow ? PICTURE_SHADOWS[look.shadow] : null;
  // down and to the right: the distance along 45 degrees
  const fxl = sh ? `<a:effectLst><a:outerShdw blurRad="${emu(sh.blur)}" dist="${emu(sh.off * Math.SQRT2)}" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="${Math.round(sh.alpha * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>` : '';
  return geom + ln + fxl;
}

/** A design shape's outline as a PowerPoint path, in its own box (w × h points). */
function geoPath(steps: GeoStep[], w: number, h: number, attrs: string): string {
  const pt = (x: number, y: number) => `<a:pt x="${emu(x)}" y="${emu(y)}"/>`;
  const out = steps.map((st) => {
    switch (st[0]) {
      case 'M': return `<a:moveTo>${pt(st[1], st[2])}</a:moveTo>`;
      case 'L': return `<a:lnTo>${pt(st[1], st[2])}</a:lnTo>`;
      case 'C': return `<a:cubicBezTo>${pt(st[1], st[2])}${pt(st[3], st[4])}${pt(st[5], st[6])}</a:cubicBezTo>`;
      default: return '<a:close/>';
    }
  });
  return `<a:path w="${emu(w)}" h="${emu(h)}"${attrs}>${out.join('')}</a:path>`;
}

/** PowerPoint's own patterns for ours (its pattern spacing is fixed). */
const PPT_PATTERN: Record<Pattern, string> = {
  hatch: 'wdUpDiag', backhatch: 'wdDnDiag', crosshatch: 'diagCross', horizontal: 'horz', vertical: 'vert', grid: 'cross', dots: 'pct20', 'dense-dots': 'pct50',
};

/**
 * A pattern (PowerPoint's nearest, over the fill colour, or over nothing) or a two-colour
 * gradient as PowerPoint fill XML; null for the other fills. PowerPoint can't put a pattern
 * over a gradient, so a pattern goes over the gradient's first colour.
 */
function patternOrGradient(s: Shape, fc: string, alpha: string): string | null {
  if (s.pattern) {
    const fg = hex6(patternInk(s));
    const pc = patternClear(s);
    const fgAlpha = pc ? `<a:alpha val="${Math.round((1 - pc) * 100000)}"/>` : '';
    const bg = s.filled ? `<a:srgbClr val="${s.fill === 'faded' ? hex6(tint('#' + fc, FADE)) : fc}">${alpha}</a:srgbClr>` : '<a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr>';
    return `<a:pattFill prst="${PPT_PATTERN[s.pattern]}"><a:fgClr><a:srgbClr val="${fg}">${fgAlpha}</a:srgbClr></a:fgClr><a:bgClr>${bg}</a:bgClr></a:pattFill>`;
  }
  if (s.filled && s.fill === 'gradient') {
    const to = hex6(s.fill2 ?? '#ffffff');
    const ang = ((((s.gradAngle ?? 90) % 360) + 360) % 360);
    const dir = s.gradRadial ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>' : `<a:lin ang="${Math.round(ang * 60000)}" scaled="0"/>`;
    return `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${fc}">${alpha}</a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="${to}">${alpha}</a:srgbClr></a:gs></a:gsLst>${dir}</a:gradFill>`;
  }
  return null;
}

/** A box, oval or line as a PowerPoint shape. */
function shapeXml(s: Shape, id: number, lw: number): string {
  const width = (s.bold ? lw * 2.5 : lw);
  const color = hex6(s.color ?? '#000000');
  const dash = s.dashed ? '<a:prstDash val="dash"/>' : '';
  if (s.kind === 'line') {
    const flips = `${s.x2 < s.x1 ? ' flipH="1"' : ''}${s.y2 < s.y1 ? ' flipV="1"' : ''}`;
    const box = { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}"${nameAttrs(s.name?.trim() || `Line ${id - 1}`, s.hidden)}/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
      `<p:spPr>${xfrm(box, flips)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${emu(width)}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash}</a:ln></p:spPr></p:cxnSp>`;
  }
  const box = { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
  let geom = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  if (s.kind === 'oval') geom = '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
  else if (s.rounded) {
    const r = Math.min(s.radius ?? 6 * lw, (box.x2 - box.x1) / 2, (box.y2 - box.y1) / 2);
    const adj = Math.round((r / Math.max(1e-6, Math.min(box.x2 - box.x1, box.y2 - box.y1))) * 100000);
    geom = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
  }
  // a fill of its own colour, faded (a light tint) or shaded (light to full colour)
  const fc = (s.fillColor ?? s.color ?? '#000000').replace('#', '').toUpperCase();
  const fill = patternOrGradient(s, fc, '') ?? (!s.filled ? '<a:noFill/>'
    : s.fill === 'faded' ? `<a:solidFill><a:srgbClr val="${tint('#' + fc, FADE).slice(1).toUpperCase()}"/></a:solidFill>`
    : s.fill === 'shaded' ? `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${tint('#' + fc, 0.85).slice(1).toUpperCase()}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${fc}"/></a:gs></a:gsLst>${s.kind === 'oval' ? '<a:path path="circle"><a:fillToRect l="35000" t="30000" r="65000" b="70000"/></a:path>' : '<a:lin ang="2700000" scaled="0"/>'}</a:gradFill>`
    : `<a:solidFill><a:srgbClr val="${fc}"/></a:solidFill>`);
  const outlined = !s.filled || (!!s.fillColor && s.fillColor.toLowerCase() !== (s.color ?? '#000000').toLowerCase());
  const ln = !outlined ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${emu(width)}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash}</a:ln>`;
  const shadow = s.shadow ? `<a:effectLst><a:outerShdw dist="${emu(s.shadowSize ?? 4 * lw)}" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="C0C0C0"/></a:outerShdw></a:effectLst>` : '';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}"${nameAttrs(s.name?.trim() || `${s.kind === 'oval' ? 'Oval' : 'Rectangle'} ${id - 1}`, s.hidden)}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(box, rotAttr(s.rot))}${geom}${fill}${ln}${shadow}</p:spPr></p:sp>`;
}

/** A placeholder in a master or layout, with the prompt PowerPoint shows. */
function phShape(id: number, name: string, ph: string, f: { x: number; y: number; w: number; h: number }, prompt: string, bodyAttrs: string, lst = ''): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrm({ x1: f.x, y1: f.y, x2: f.x + f.w, y2: f.y + f.h })}${ph.includes('type="title"') || ph.includes('type="body"') ? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' : ''}</p:spPr>` +
    `<p:txBody><a:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" ${bodyAttrs}><a:noAutofit/></a:bodyPr><a:lstStyle>${lst}</a:lstStyle>` +
    `<a:p><a:r><a:rPr ${lang}/><a:t>${xml(prompt)}</a:t></a:r><a:endParaRPr ${lang}/></a:p></p:txBody></p:sp>`;
}

/** The footer or slide number box (in the master and layouts, and on each slide that shows it). */
function footerShape(id: number, name: string, ph: string, r: Rect, m: Master, text: string, onSlide = false): string {
  const isNum = ph.includes('sldNum'), isDate = ph.includes('type="dt"');
  // today's date as a field PowerPoint keeps up to date, in the form picked; a fixed date as text
  const run = isNum
    ? `<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr ${lang}/><a:t>${xml(text || '‹#›')}</a:t></a:fld>`
    : isDate && !m.dateFixed?.trim() ? `<a:fld id="{3E1A4C2B-7D9F-4B8E-9C61-2F0A5D7E8B13}" type="${m.dateFormat ?? 'datetime1'}"><a:rPr ${lang}/><a:t>${xml(text)}</a:t></a:fld>`
      : text ? `<a:r><a:rPr ${lang}/><a:t>${xml(text)}</a:t></a:r>` : '';
  const algn = isNum ? 'r' : isDate ? 'l' : 'ctr';
  const lst = onSlide ? '' : `<a:lvl1pPr algn="${algn}"><a:defRPr sz="${Math.round(m.footerSize * 100)}"><a:solidFill><a:srgbClr val="${hex6(m.footerColor)}"/></a:solidFill></a:defRPr></a:lvl1pPr>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${onSlide ? '' : xfrm(r)}</p:spPr>` +
    `<p:txBody><a:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"/><a:lstStyle>${lst}</a:lstStyle>` +
    `<a:p><a:pPr algn="${algn}"/>${run}<a:endParaRPr ${lang}/></a:p></p:txBody></p:sp>`;
}

/** The master's title style. */
function titleLevel(m: Master): string {
  return `<a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>` +
    `<a:defRPr sz="${Math.round(m.titleSize * 100)}" b="${m.titleBold ? 1 : 0}" kern="1200"><a:solidFill><a:srgbClr val="${hex6(m.titleColor)}"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr>`;
}

/** The master's body text: bullets on every level, placed as on screen. */
function bodyLevels(m: Master): string {
  const em = m.bodySize;
  const out: string[] = [];
  const bullets = ['•', '–', '•', '–', '»'];
  for (let l = 0; l < 9; l++) {
    const markLeft = l * 1.6 * em, textLeft = markLeft + 1.1 * em;
    out.push(`<a:lvl${l + 1}pPr marL="${emu(textLeft)}" indent="${emu(markLeft - textLeft)}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">` +
      `<a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="${bullets[l % bullets.length]}"/>` +
      `<a:defRPr sz="${Math.round(em * 100)}" kern="1200"><a:solidFill><a:srgbClr val="${hex6(m.textColor)}"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${l + 1}pPr>`);
  }
  return out.join('');
}

/** Text that is not a title or placeholder (and the file's default). */
function defaultLevels(m: Master): string {
  const out = ['<a:defPPr><a:defRPr lang="en-US"/></a:defPPr>'];
  for (let l = 0; l < 9; l++) {
    out.push(`<a:lvl${l + 1}pPr marL="${l * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:srgbClr val="${hex6(m.textColor)}"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${l + 1}pPr>`);
  }
  return out.join('');
}

/** The theme: colours and the two fonts (titles and body). */
function theme(m: Master, name: string): string {
  // the template's two accent colours first, so PowerPoint's own shapes and charts pick them up
  const accents = [hex6(m.accent), hex6(m.accent2), '4F9A55', '8064A2', 'D9822B', '4BACC6'];
  const fmt = (inner: string) => `<a:solidFill><a:schemeClr val="phClr">${inner}</a:schemeClr></a:solidFill>`;
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return `${HEAD}<a:theme xmlns:a="${NS.a}" name="${xml(name)}"><a:themeElements>` +
    `<a:clrScheme name="Chem Illustrator"><a:dk1><a:srgbClr val="${hex6(m.textColor)}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="1D2330"/></a:dk2><a:lt2><a:srgbClr val="EEF0F3"/></a:lt2>` +
    accents.map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join('') +
    `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Chem Illustrator"><a:majorFont><a:latin typeface="${xml(m.titleFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${xml(m.bodyFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Chem Illustrator"><a:fillStyleLst>${fmt('')}${fmt('<a:tint val="50000"/>')}${fmt('<a:shade val="80000"/>')}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fmt('')}${fmt('<a:tint val="95000"/>')}${fmt('<a:shade val="90000"/>')}</a:bgFillStyleLst></a:fmtScheme>` +
    `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

/** Master settings PowerPoint has no place for, kept in a tag (the logo is in the master itself). */
export function masterSettings(m: Master): Partial<Master> {
  // (backgrounds that are more than a colour are PowerPoint's own, in the master and title layout)
  const { logo: _logo, fill: _fill, ...rest } = m;
  void _logo;
  void _fill;
  if (rest.titleSlide?.fill) {
    const { fill: _f, ...ts } = rest.titleSlide;
    void _f;
    rest.titleSlide = ts;
  }
  return rest;
}

/** The deck as a PowerPoint file. */
export function writePptx(deck: DeckData, opts: PptxOptions): Promise<Uint8Array> {
  return new Writer(deck, opts).build();
}
