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

import { Doc, Caption, Shape, TextRun, ParaStyle, Arrow, applyBase, type Pattern } from '../model';
import type { Rect } from '../geom';
import { layoutText, ASCENT, FONT_STACK, type Measure } from '../text/layout';
import { fitParas, listMarkers, splitParagraphs } from '../text/paragraphs';
import { formulaParts } from '../richtext';
import { arialWidth } from '../text-metrics';
import { arrowPoints, shapeBox, boxOf, shapeOrder, elbowRoute } from '../objects';
import { geoDef, textArea, type GeoStep } from '../design/geo';
import { layoutTable, cellAlign, spanOf, isCovered, tableText, NOTE_SCALE } from '../table';
import { tableBorders } from './cdxml-table';
import { writeCdxml } from './cdxml-write';
import { extractDrawing } from './clipboard';
import type { Selection } from '../editor/editor';
import { Package, NS, REL, emu, xml, hex6 } from './ooxml';
import { facesToEmbed, toEot, type FontSource } from './font-embed';
import { fromDataUrl } from '../render/images';
import { patternInk } from '../render/fills';
import { FADE, tint } from '../colours';
import {
  Master, SlideSize, LayoutId, LAYOUTS, layoutFrames, decorFrames, showsNumber, textStyles, isEmptyText,
} from '../deck/deck';

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
};

/** A picture of part of a slide (structures, schemes): SVG and PNG, and the area it shows, in points. */
export interface DrawingPicture { svg: string; png: Uint8Array; box: Rect }

export interface PptxOptions {
  /** A picture of a drawing (made by the app, which can draw). Null when there is nothing to show. */
  picture(doc: Doc): Promise<DrawingPicture | null>;
  /** A PNG of an SVG picture, for programs that can't show SVG (w × h pixels). */
  svgToPng(svg: string, w: number, h: number): Promise<Uint8Array>;
  /** Text widths, for laying out text boxes (Arial's widths by default). */
  measure?: Measure;
  title?: string;
  /** The free fonts that come with the app, to put inside the file when the slides use them. */
  fonts?: FontSource;
}

export interface DeckData {
  size: SlideSize;
  master: Master;
  slides: { layout: LayoutId; doc: Doc; notes: string }[];
  /** A design (Design mode): marked so it opens in Design mode again. */
  design?: boolean;
}

/**
 * Where PowerPoint puts the first baseline below the top of a text box, as a fraction of the
 * text size (Arial's ascent). Our layout keeps 0.8 of the size above the baseline, so text
 * boxes are moved up by the difference to keep the text where it was.
 */
export const PPT_ASCENT = 0.905;

const SVG_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const NS_SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const XMLNS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  notes: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  tags: 'application/vnd.openxmlformats-officedocument.presentationml.tags+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};

/** Picture types a PowerPoint file can hold (EMF and WMF come from Windows programs; kept as they are). */
export const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'image/tiff': 'tiff', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf',
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
  const connectors: Arrow[] = [];
  for (const r of doc.arrows.values()) if (r.from || r.to || r.elbow) connectors.push(r);
  for (const r of doc.arrows.values()) if (!(r.from || r.to || r.elbow)) items.push({ box: boxOf(arrowPoints(r, 12)), chem: true, add: (s) => s.arrows.add(r.id) });
  for (const sh of doc.shapes.values()) {
    if (sh.picture) continue; // a stand-in for a picture from a ChemDraw file
    if (sh.kind === 'picture') { pictures.push(sh); continue; }
    if (sh.kind === 'table') { if (sh.table) tables.push(sh); continue; }
    // design shapes stay PowerPoint shapes even beside structures (boxes round a structure, flasks under one)
    if (sh.kind === 'geo') { geos.push(sh); continue; }
    // ring fills sit under their structure, in its picture
    const chem = sh.kind === 'bracket' || sh.kind === 'symbol' || sh.kind === 'ring';
    items.push({ box: shapeBox(sh), chem, add: (s) => s.shapes.add(sh.id), shape: sh });
  }
  for (const c of doc.captions.values()) {
    // titles, text placeholders and text boxes are always PowerPoint text
    if (c.ph || c.wrap !== undefined) { texts.push(c); continue; }
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
  return { texts, pictures, shapes: shapeOrder([...shapes, ...geos]), tables, drawings, connectors };
}

export const arialMeasure: Measure = (t, size, _family, style) => arialWidth(t, size, /bold/.test(style));

// ---------------------------------------------------------------- text

const lang = 'lang="en-US"';

/** One run as PowerPoint runs (formula style turns into subscripts and superscripts). */
function runXml(r: TextRun, explicit: { size: number; font: string } | null): string {
  const parts = r.formula && !r.sub && !r.sup ? formulaParts(r.text) : [{ text: r.text, pos: r.sub ? 'sub' : r.sup ? 'sup' : 'base' }];
  return parts.map((p) => {
    const size = r.size ?? explicit?.size;
    const font = r.font ?? explicit?.font;
    const attrs = [lang];
    if (size) attrs.push(`sz="${Math.round(size * 100)}"`);
    if (r.bold !== undefined) attrs.push(`b="${r.bold ? 1 : 0}"`);
    if (r.italic !== undefined) attrs.push(`i="${r.italic ? 1 : 0}"`);
    if (r.underline) attrs.push('u="sng"');
    if (p.pos === 'sub') attrs.push('baseline="-25000"');
    else if (p.pos === 'sup') attrs.push('baseline="30000"');
    attrs.push('dirty="0"');
    const color = r.color ?? (explicit ? '#000000' : undefined);
    const fill = color ? `<a:solidFill><a:srgbClr val="${hex6(color)}"/></a:solidFill>` : '';
    const latin = font ? `<a:latin typeface="${xml(font)}"/><a:cs typeface="${xml(font)}"/>` : '';
    return `<a:r><a:rPr ${attrs.join(' ')}>${fill}${latin}</a:rPr><a:t>${xml(p.text)}</a:t></a:r>`;
  }).join('');
}

const NUMBER_TYPES = ['arabicPeriod', 'alphaLcPeriod', 'romanLcPeriod'];

/** A caption's paragraphs as PowerPoint paragraphs. */
export function paragraphsXml(c: Caption, explicit: { size: number; font: string } | null, defaultSize: number, measure: Measure): string {
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
    const body = runs.map((r) => runXml(r, explicit)).join('');
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

const PH_XML: Record<LayoutId, ((i: number) => string)[]> = {
  title: [() => '<p:ph type="ctrTitle"/>', () => '<p:ph type="subTitle" idx="1"/>'],
  'title-content': [() => '<p:ph type="title"/>', () => '<p:ph idx="1"/>'],
  'two-content': [() => '<p:ph type="title"/>', () => '<p:ph sz="half" idx="1"/>', () => '<p:ph sz="half" idx="2"/>'],
  'title-only': [() => '<p:ph type="title"/>'],
  blank: [],
};

const LAYOUT_TYPE: Record<LayoutId, string> = { title: 'title', 'title-content': 'obj', 'two-content': 'twoObj', 'title-only': 'titleOnly', blank: 'blank' };

/** A part in ppt/ as seen from another part in ppt/ or a folder in it. */
const fromPpt = (from: string, path: string) => (from.split('/').length > 2 ? '../' : '') + path.slice(4);

const xfrm = (r: Rect, extra = '') => `<a:xfrm${extra}><a:off x="${emu(r.x1)}" y="${emu(r.y1)}"/><a:ext cx="${Math.max(0, emu(r.x2 - r.x1))}" cy="${Math.max(0, emu(r.y2 - r.y1))}"/></a:xfrm>`;
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

class Writer {
  pkg = new Package();
  private media = 0;
  private tags = 0;
  private tableKeys = 0;
  private measure: Measure;

  constructor(private deck: DeckData, private opts: PptxOptions) {
    this.measure = opts.measure ?? arialMeasure;
    for (const [mime, ext] of Object.entries(MIME_EXT)) this.pkg.defaultType(ext, mime);
  }

  /** A picture file in ppt/media; returns its relationship id from `from`. */
  private addMedia(from: string, bytes: Uint8Array, ext: string): string {
    const path = `ppt/media/image${++this.media}.${ext}`;
    this.pkg.add(path, bytes);
    return this.pkg.relate(from, REL.image, fromPpt(from, path));
  }

  /** A set of tags in ppt/tags; returns its relationship id from `from`. */
  private addTags(from: string, tags: Record<string, string>): string {
    const path = `ppt/tags/tag${++this.tags}.xml`;
    const list = Object.entries(tags).map(([k, v]) => `<p:tag name="${xml(k)}" val="${xml(v)}"/>`).join('');
    this.pkg.add(path, `${HEAD}<p:tagLst ${XMLNS}>${list}</p:tagLst>`, CT.tags);
    return this.pkg.relate(from, REL.tags, fromPpt(from, path));
  }

  async build(): Promise<Uint8Array> {
    const { pkg, deck } = this;
    const n = deck.slides.length;
    const hasNotes = deck.slides.some((s) => s.notes.trim());
    pkg.add('ppt/presentation.xml', '', CT.presentation); // filled in below, once the ids are known
    pkg.relate('', REL.officeDocument, 'ppt/presentation.xml');
    pkg.relate('', REL.coreProps, 'docProps/core.xml');
    pkg.relate('', REL.extendedProps, 'docProps/app.xml');
    pkg.add('docProps/core.xml', this.core(), CT.core);
    pkg.add('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Chem Illustrator</Application><Slides>${n}</Slides><Notes>${deck.slides.filter((s) => s.notes.trim()).length}</Notes><PresentationFormat>${deck.size.w === 960 ? 'Widescreen' : 'On-screen Show (4:3)'}</PresentationFormat></Properties>`, CT.app);

    const P = 'ppt/presentation.xml';
    const masterRel = pkg.relate(P, REL.slideMaster, 'slideMasters/slideMaster1.xml');
    pkg.add('ppt/theme/theme1.xml', theme(deck.master, 'Chem Illustrator'), CT.theme);
    pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.theme, '../theme/theme1.xml');
    // layouts first, so the master can list them
    const layoutRels: string[] = [];
    LAYOUTS.forEach((l, i) => {
      const path = `ppt/slideLayouts/slideLayout${i + 1}.xml`;
      pkg.add(path, this.layout(l.id, l.name), CT.layout);
      pkg.relate(path, REL.slideMaster, '../slideMasters/slideMaster1.xml');
      layoutRels.push(pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.slideLayout, `../slideLayouts/slideLayout${i + 1}.xml`));
    });
    pkg.add('ppt/slideMasters/slideMaster1.xml', await this.master(layoutRels), CT.master);

    let notesMasterRel = '';
    if (hasNotes) {
      notesMasterRel = pkg.relate(P, REL.notesMaster, 'notesMasters/notesMaster1.xml');
      pkg.add('ppt/theme/theme2.xml', theme(deck.master, 'Notes'), CT.theme);
      pkg.relate('ppt/notesMasters/notesMaster1.xml', REL.theme, '../theme/theme2.xml');
      pkg.add('ppt/notesMasters/notesMaster1.xml', this.notesMaster(), CT.notesMaster);
    }
    const slideRels: string[] = [];
    for (let i = 0; i < n; i++) {
      const path = `ppt/slides/slide${i + 1}.xml`;
      slideRels.push(pkg.relate(P, REL.slide, `slides/slide${i + 1}.xml`));
      const s = deck.slides[i];
      pkg.relate(path, REL.slideLayout, `../slideLayouts/slideLayout${LAYOUTS.findIndex((l) => l.id === s.layout) + 1}.xml`);
      pkg.add(path, await this.slide(path, i), CT.slide);
      if (s.notes.trim()) {
        const np = `ppt/notesSlides/notesSlide${i + 1}.xml`;
        pkg.add(np, this.notesSlide(s.notes), CT.notes);
        pkg.relate(np, REL.notesMaster, '../notesMasters/notesMaster1.xml');
        pkg.relate(np, REL.slide, `../slides/slide${i + 1}.xml`);
        pkg.relate(path, REL.notesSlide, `../notesSlides/notesSlide${i + 1}.xml`);
      }
    }
    pkg.add('ppt/presProps.xml', `${HEAD}<p:presentationPr ${XMLNS}/>`, CT.presProps);
    pkg.relate(P, REL.presProps, 'presProps.xml');
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
      `<p:sldIdLst>${slideRels.map((r, i) => `<p:sldId id="${256 + i}" r:id="${r}"/>`).join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${emu(w)}" cy="${emu(h)}"${w === 720 && h === 540 ? ' type="screen4x3"' : ''}/>` +
      `<p:notesSz cx="6858000" cy="9144000"/>` + fontList +
      `<p:custDataLst><p:tags r:id="${masterTags}"/></p:custDataLst>` +
      `<p:defaultTextStyle>${defaultLevels(this.deck.master)}</p:defaultTextStyle>` +
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
      logo,
    ].join('');
    return `${HEAD}<p:sldMaster ${XMLNS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex6(m.background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
      `<p:spTree>${GROUP}${tree}</p:spTree></p:cSld>` +
      `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
      `<p:sldLayoutIdLst>${layoutRels.map((r, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="${r}"/>`).join('')}</p:sldLayoutIdLst>` +
      `<p:txStyles><p:titleStyle>${titleLevel(m)}</p:titleStyle><p:bodyStyle>${bodyLevels(m)}</p:bodyStyle><p:otherStyle>${defaultLevels(m)}</p:otherStyle></p:txStyles>` +
      `</p:sldMaster>`;
  }

  private layout(id: LayoutId, name: string): string {
    const size = this.deck.size;
    const m = this.deck.master;
    const frames = layoutFrames(id, size);
    const d = decorFrames(size, m);
    const shapes = frames.map((f, i) => {
      const prompt = f.ph === 'title' ? 'Click to edit Master title style' : f.ph === 'subtitle' ? 'Click to edit Master subtitle style' : 'Click to edit Master text styles';
      const algn = f.justify === 'center' ? 'ctr' : 'l';
      const lst = f.ph === 'subtitle'
        ? `<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="${Math.round(m.subtitleSize * 100)}"/></a:lvl1pPr>`
        : f.ph === 'title' ? `<a:lvl1pPr algn="${algn}"><a:defRPr/></a:lvl1pPr>` : '';
      return phShape(i + 2, `${f.ph === 'title' ? 'Title' : f.ph === 'subtitle' ? 'Subtitle' : 'Content Placeholder'} ${i + 1}`, PH_XML[id][i](i),
        f, prompt, 'anchor="t"', lst);
    });
    shapes.push(footerShape(frames.length + 2, `Footer Placeholder ${frames.length + 1}`, '<p:ph type="ftr" sz="quarter" idx="11"/>', d.footer, m, ''));
    shapes.push(footerShape(frames.length + 3, `Slide Number Placeholder ${frames.length + 2}`, '<p:ph type="sldNum" sz="quarter" idx="12"/>', d.number, m, '‹#›'));
    return `${HEAD}<p:sldLayout ${XMLNS} type="${LAYOUT_TYPE[id]}" preserve="1"><p:cSld name="${xml(name)}"><p:spTree>${GROUP}${shapes.join('')}</p:spTree></p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  }

  // ---------------------------------------------------------------- slides

  private async slide(path: string, index: number): Promise<string> {
    const s = this.deck.slides[index];
    const doc = s.doc;
    const parts = splitSlide(doc, this.measure);
    const out: string[] = [];
    let id = 2;
    const styles = textStyles(this.deck.master);
    // pictures and shapes at the back, as on screen
    for (const p of parts.pictures) out.push(await this.picture(path, p.src!, { x1: Math.min(p.x1, p.x2), y1: Math.min(p.y1, p.y2), x2: Math.max(p.x1, p.x2), y2: Math.max(p.y1, p.y2) }, `Picture ${id - 1}`, id++, p.crop ?? null));
    for (const sh of parts.shapes) out.push(sh.kind === 'geo' ? this.geo(path, sh, id++, doc, styles.body?.size ?? doc.style.captionSize) : shapeXml(sh, id++, doc.style.lineWidth));
    for (const r of parts.connectors) out.push(this.connector(path, r, id++, doc.style.lineWidth));
    const phCount: Record<string, number> = {};
    for (const tb of parts.tables) out.push(this.table(path, tb, () => id++, s.layout, styles, phCount, doc));
    // structures and schemes
    for (const sel of parts.drawings) {
      const part = extractDrawing(doc, sel);
      const pic = await this.opts.picture(part);
      if (!pic) continue;
      const cdxml = writeCdxml(part, { name: 'Slide drawing.cdxml', textMeasure: this.measure });
      const tags = this.addTags(path, { [TAG.cdxml]: cdxml, [TAG.box]: [pic.box.x1, pic.box.y1, pic.box.x2, pic.box.y2].map((v) => +v.toFixed(3)).join(' ') });
      const png = this.addMedia(path, pic.png, 'png');
      const svg = this.addMedia(path, new TextEncoder().encode(pic.svg), 'svg');
      out.push(picXml(id, `Structure ${id - 1}`, png, svg, pic.box, null, tags));
      id++;
    }
    // text on top
    for (const c of parts.texts) {
      out.push(this.text(path, c, id++, s.layout, styles, phCount, doc));
    }
    // slide number and footer, when the master shows them
    const m = this.deck.master;
    const d = decorFrames(this.deck.size, m);
    if (showsNumber(m, s.layout)) out.push(footerShape(id++, 'Slide Number', '<p:ph type="sldNum" sz="quarter" idx="12"/>', d.number, m, String(index + 1), true));
    if (m.footer.trim()) out.push(footerShape(id++, 'Footer', '<p:ph type="ftr" sz="quarter" idx="11"/>', d.footer, m, m.footer, true));
    const tags = this.addTags(path, { [TAG.layout]: s.layout });
    return `${HEAD}<p:sld ${XMLNS}><p:cSld><p:spTree>${GROUP}${out.join('')}</p:spTree><p:custDataLst><p:tags r:id="${tags}"/></p:custDataLst></p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  /**
   * A design shape: PowerPoint's own shape where it has one (so PowerPoint can change it), else
   * the outline itself; its text inside, wrapped. A tag keeps the shape as it was.
   */
  private geo(path: string, s: Shape, id: number, doc: Doc, textSize: number): string {
    const def = geoDef(s.geo);
    const box = { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
    const w = box.x2 - box.x1, h = box.y2 - box.y1;
    const lw = doc.style.lineWidth;
    const width = s.lineWidth ?? (s.bold ? lw * 2.5 : lw);
    let geom: string;
    if (def.prst) geom = `<a:prstGeom prst="${def.prst}"><a:avLst/></a:prstGeom>`;
    else {
      const o = def.draw(w, h);
      const ta = textArea(def, 0, 0, w, h);
      geom = '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>' +
        `<a:rect l="${emu(ta.x1)}" t="${emu(ta.y1)}" r="${emu(ta.x2)}" b="${emu(ta.y2)}"/>` +
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
    const shadow = s.shadow ? `<a:effectLst><a:outerShdw dist="${emu(s.shadowSize ?? Math.max(2, 0.04 * Math.min(w, h)))}" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="25000"/></a:srgbClr></a:outerShdw></a:effectLst>` : '';
    const justify = s.textAlign ?? 'center';
    const algn = justify === 'center' ? 'ctr' : justify === 'right' ? 'r' : justify === 'justify' ? 'just' : 'l';
    const hasText = !!s.text?.runs.some((r) => r.text);
    const body = hasText
      ? paragraphsXml({ id: 0, x: 0, y: 0, runs: s.text!.runs, paras: s.text!.paras, justify }, { size: textSize, font: doc.style.captionFont || 'Arial' }, textSize, this.measure)
      : `<a:p><a:pPr algn="${algn}"/><a:endParaRPr ${lang} sz="${Math.round(textSize * 100)}" dirty="0"/></a:p>`;
    const anchor = s.textValign === 'top' ? 't' : s.textValign === 'bottom' ? 'b' : 'ctr';
    const ins = def.prst ? 3.6 : 0;
    const bodyPr = `<a:bodyPr wrap="square" lIns="${emu(ins)}" tIns="${emu(ins)}" rIns="${emu(ins)}" bIns="${emu(ins)}" rtlCol="0" anchor="${anchor}"><a:noAutofit/></a:bodyPr>`;
    const { id: _, x1: _a, y1: _b, x2: _c, y2: _d, ...look } = s;
    const plain = s.text?.runs.map((r) => r.text).join('') ?? '';
    const tag = this.addTags(path, { [TAG.geo]: JSON.stringify({ v: 1, s: look, plain, sid: s.id }) });
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(def.name)} ${id - 1}"/><p:cNvSpPr/><p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvSpPr>` +
      `<p:spPr>${xfrm(box)}${geom}${fill}${ln}${shadow}</p:spPr><p:txBody>${bodyPr}<a:lstStyle/>${body}</p:txBody></p:sp>`;
  }

  /**
   * A connector: PowerPoint's straight connector, or a bent line for an elbow, with its heads.
   * A tag keeps the arrow (and which shapes it is stuck to).
   */
  private connector(path: string, r: Arrow, id: number, lw: number): string {
    const pts = r.elbow ? elbowRoute(r) : [r.tail, r.head];
    const b = boxOf(pts);
    const w = Math.max(b.x2 - b.x1, 0), h = Math.max(b.y2 - b.y1, 0);
    let geom: string, frame: string;
    if (r.elbow) {
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
    const { id: _, ...keep } = r;
    const tag = this.addTags(path, { [TAG.connector]: JSON.stringify({ v: 1, a: keep }) });
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${r.elbow ? 'Elbow Connector' : 'Straight Arrow Connector'} ${id - 1}"/><p:cNvCxnSpPr/><p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvCxnSpPr>` +
      `<p:spPr>${frame}${geom}${ln}</p:spPr></p:cxnSp>`;
  }

  /** A picture from image data, cropped as given. */
  private async picture(from: string, src: string, box: Rect, name: string, id: number, crop: Shape['crop'] | null): Promise<string> {
    let mime: string, bytes: Uint8Array;
    try {
      ({ mime, bytes } = fromDataUrl(src));
    } catch {
      return '';
    }
    const ext = MIME_EXT[mime];
    if (!ext) return '';
    if (ext === 'svg') {
      // PowerPoint shows the SVG; older programs the PNG beside it (300 dots per inch)
      const k = 300 / 72;
      const png = await this.opts.svgToPng(new TextDecoder().decode(bytes), Math.max(1, Math.round((box.x2 - box.x1) * k)), Math.max(1, Math.round((box.y2 - box.y1) * k)));
      return picXml(id, name, this.addMedia(from, png, 'png'), this.addMedia(from, bytes, 'svg'), box, crop, null);
    }
    return picXml(id, name, this.addMedia(from, bytes, ext), null, box, crop, null);
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
    const height = c.ph && c.boxH ? Math.max(c.boxH, lay.box.y2 - lay.box.y1) : (lay.box.y2 - (lay.lines[0]?.y ?? 0)) + PPT_ASCENT * firstSize + 0.1 * firstSize;
    const box = { x1: c.x, y1: top, x2: c.x + Math.max(width, 1), y2: top + height };
    const explicit = c.ph ? null : { size: doc.style.captionSize, font: doc.style.captionFont || 'Arial' };
    const body = isEmptyText(c) && c.ph ? `<a:p><a:endParaRPr ${lang} dirty="0"/></a:p>` : paragraphsXml(c, explicit, base?.size ?? doc.style.captionSize, this.measure);
    const wrap = c.wrap !== undefined || c.ph ? 'square' : 'none';
    const fit = c.ph ? '<a:noAutofit/>' : '<a:spAutoFit/>';
    const bodyPr = `<a:bodyPr wrap="${wrap}" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t">${fit}</a:bodyPr>`;
    // the caption's exact settings, used when it comes back unchanged from PowerPoint
    const plain = c.runs.map((r) => r.text).join('');
    const at = [box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1].map((v) => +v.toFixed(2));
    const tag = this.addTags(path, { [TAG.text]: JSON.stringify({ c: { ...c, id: undefined }, plain, at }), ...more });
    let ph = '';
    if (c.ph) {
      const k = c.ph === 'title' ? 'title' : 'body';
      const i = (phCount[k] = (phCount[k] ?? 0) + 1) - 1;
      const forms = PH_XML[layout];
      const which = k === 'title' ? 0 : 1 + i;
      ph = forms[which] ? forms[which](which) : (c.ph === 'title' ? '<p:ph type="title"/>' : `<p:ph idx="${10 + i}"/>`);
      if (which >= forms.length && c.ph !== 'title') ph = ''; // more text boxes than the layout has: plain text boxes
    }
    const name = c.ph === 'title' ? `Title ${id - 1}` : c.ph ? `Text Placeholder ${id - 1}` : `TextBox ${id - 1}`;
    const nvSp = ph
      ? `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}<p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvSpPr>`
      : `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvSpPr>`;
    const geom = ph ? '' : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>';
    return `<p:sp>${nvSp}<p:spPr>${xfrm(box)}${geom}</p:spPr><p:txBody>${bodyPr}<a:lstStyle/>${body}</p:txBody></p:sp>`;
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
    const color = hex6(s.color ?? '#000000');
    // PowerPoint puts the first baseline its font's ascent below the cell's top margin
    const marT = Math.max(0, lay.padY - (PPT_ASCENT - ASCENT) * size), marB = Math.max(0, lay.padY - 0.05 * size);
    const ln = (side: string, w: number) => w > 0
      ? `<a:${side} w="${emu(w)}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:${side}>`
      : `<a:${side} w="${emu(lw)}" cmpd="sng"><a:noFill/></a:${side}>`;
    const empty = (algn: string) => `<a:p><a:pPr algn="${algn}"/><a:endParaRPr ${lang} sz="${Math.round(size * 100)}" dirty="0"/></a:p>`;
    const algnOf = (j: string) => (j === 'center' ? 'ctr' : j === 'right' ? 'r' : j === 'justify' ? 'just' : 'l');
    const rows: string[] = [];
    for (let r = 0; r < n; r++) {
      const tcs: string[] = [];
      for (let c = 0; c < m; c++) {
        const x = b[r][c];
        // a line between two cells shows when either cell has it, so both say so
        const left = x.left || (c > 0 ? b[r][c - 1].right : 0), right = x.right || (c < m - 1 ? b[r][c + 1].left : 0);
        const top = x.top || (r > 0 ? b[r - 1][c].bottom : 0), bottom = x.bottom || (r < n - 1 ? b[r + 1][c].top : 0);
        const tcPr = `<a:tcPr marL="${emu(lay.padX)}" marR="${emu(lay.padX)}" marT="${emu(marT)}" marB="${emu(marB)}" anchor="t">${ln('lnL', left)}${ln('lnR', right)}${ln('lnT', top)}${ln('lnB', bottom)}<a:noFill/></a:tcPr>`;
        const align = cellAlign(t, r, c);
        if (isCovered(t, r, c)) {
          tcs.push(`<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/>${empty(algnOf(align))}</a:txBody>${tcPr}</a:tc>`);
          continue;
        }
        const cell = t.rows[r][c] ?? { runs: [] };
        const span = spanOf(t, r, c);
        const body = cell.runs.some((x) => x.text)
          ? paragraphsXml({ id: 0, x: 0, y: 0, runs: cell.runs, paras: cell.paras, justify: align }, { size, font }, size, this.measure)
          : empty(algnOf(align));
        tcs.push(`<a:tc${span > 1 ? ` gridSpan="${span}"` : ''}><a:txBody><a:bodyPr/><a:lstStyle/>${body}</a:txBody>${tcPr}</a:tc>`);
      }
      rows.push(`<a:tr h="${emu(lay.ys[r + 1] - lay.ys[r])}">${tcs.join('')}</a:tr>`);
    }
    const grid = t.cols.map((w) => `<a:gridCol w="${emu(w)}"/>`).join('');
    const id = next();
    const tag = this.addTags(path, { [TAG.table]: JSON.stringify({ v: 1, key, table: t, plain: tableText(t) }) });
    const frame = { x1: s.x1, y1: s.y1 + lay.ys[0], x2: s.x1 + lay.width, y2: s.y1 + lay.ys[n] };
    // "No Style, No Grid": the cells show only the rules given here
    out.push(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id - 1}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
      `<p:nvPr><p:custDataLst><p:tags r:id="${tag}"/></p:custDataLst></p:nvPr></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="${emu(frame.x1)}" y="${emu(frame.y1)}"/><a:ext cx="${emu(frame.x2 - frame.x1)}" cy="${emu(frame.y2 - frame.y1)}"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${t.head > 0 ? ' firstRow="1"' : ''}><a:tableStyleId>{2D5ABB26-0587-4C30-8999-92F81FD0307C}</a:tableStyleId></a:tblPr>` +
      `<a:tblGrid>${grid}</a:tblGrid>${rows.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
    if (lay.notes) part('notes', lay.notes, t.notes!, size * NOTE_SCALE);
    return out.join('');
  }

  // ---------------------------------------------------------------- notes

  private notesMaster(): string {
    return `${HEAD}<p:notesMaster ${XMLNS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
      `<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr ${lang}/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
      `<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
  }

  private notesSlide(text: string): string {
    const paras = text.split('\n').map((t) => (t ? `<a:p><a:r><a:rPr ${lang} dirty="0"/><a:t>${xml(t)}</a:t></a:r></a:p>` : `<a:p><a:endParaRPr ${lang} dirty="0"/></a:p>`)).join('');
    return `${HEAD}<p:notes ${XMLNS}><p:cSld><p:spTree>${GROUP}` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
  }
}

/** A picture element: PNG (or another bitmap), optionally with an SVG PowerPoint shows instead. */
function picXml(id: number, name: string, blipId: string, svgId: string | null, box: Rect, crop: Shape['crop'] | null, tagsId: string | null): string {
  const ext = svgId ? `<a:extLst><a:ext uri="${SVG_EXT}"><asvg:svgBlip xmlns:asvg="${NS_SVG}" r:embed="${svgId}"/></a:ext></a:extLst>` : '';
  const src = crop && (crop.l || crop.t || crop.r || crop.b)
    ? `<a:srcRect l="${Math.round(crop.l * 100000)}" t="${Math.round(crop.t * 100000)}" r="${Math.round(crop.r * 100000)}" b="${Math.round(crop.b * 100000)}"/>` : '';
  const nvPr = tagsId ? `<p:nvPr><p:custDataLst><p:tags r:id="${tagsId}"/></p:custDataLst></p:nvPr>` : '<p:nvPr/>';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>${nvPr}</p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${blipId}">${ext}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
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
    const bg = s.filled ? `<a:srgbClr val="${s.fill === 'faded' ? hex6(tint('#' + fc, FADE)) : fc}">${alpha}</a:srgbClr>` : '<a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr>';
    return `<a:pattFill prst="${PPT_PATTERN[s.pattern]}"><a:fgClr><a:srgbClr val="${fg}"/></a:fgClr><a:bgClr>${bg}</a:bgClr></a:pattFill>`;
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
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id - 1}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
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
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${s.kind === 'oval' ? 'Oval' : 'Rectangle'} ${id - 1}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(box)}${geom}${fill}${ln}${shadow}</p:spPr></p:sp>`;
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
  const isNum = ph.includes('sldNum');
  const run = isNum
    ? `<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr ${lang}/><a:t>${xml(text || '‹#›')}</a:t></a:fld>`
    : text ? `<a:r><a:rPr ${lang}/><a:t>${xml(text)}</a:t></a:r>` : '';
  const algn = isNum ? 'r' : 'ctr';
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
  const accents = ['2F6FDF', 'C0504D', '4F9A55', '8064A2', 'D9822B', '4BACC6'];
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
  const { logo: _logo, ...rest } = m;
  void _logo;
  return rest;
}

/** The deck as a PowerPoint file. */
export function writePptx(deck: DeckData, opts: PptxOptions): Promise<Uint8Array> {
  return new Writer(deck, opts).build();
}
