// Opening PowerPoint files (.pptx) as slides, from the published Office Open XML standard
// (ECMA-376, PresentationML).
//
// Files saved here come back exactly: structures from the drawing each picture carries, text
// from the settings each text box carries (unless it was changed in PowerPoint, when the
// PowerPoint text is used), and the slide master from its settings. Files from PowerPoint
// come in as editable text (with its formatting, worked out the way PowerPoint does, through
// the slide's layout, master and theme), pictures (with their cropping), and boxes, ovals,
// lines, arrows and tables. What has no place here yet (charts, rotated things) is noted in
// warnings, never refused.

import type { PinnedComment } from '../document/comments';
import { COMMENT_REL, readCommentAuthors, readLegacyComments, readModernComments } from './pptx-comments';
import { Doc, Caption, Shape, TextRun, ParaStyle, Arrow, Contents, Placeholder, Justify, stripBase, type TableCell, type TableData, type PictureFx, type PictureLook, type Frame, type ShapeMath, type Media } from '../model';
import { layoutTable, NOTE_SCALE } from '../table';
import { PPT_STYLE_IDS, slideCellLook, unstyledRuns } from '../deck/table-styles';
import { linesFromBorders, type Borders } from './cdxml-table';
import { turnAbout, normDegrees, DEG, type Vec, type Rect } from '../geom';
import { POINTS, rotation, snapshot, transform } from '../editor/arrange';
import { PackageReader, NS, REL, kids, kid, rAttr, fromEmu } from './ooxml';
import { linkFromTarget } from '../links';
import { readCdxml } from './cdxml';
import { drawingInEmf } from '../render/emf';
import { dataUrl, imageSize } from '../render/images';
import { knownShape, tidyFx } from '../render/picture-fx';
import { readPictureFx } from './picture-xml';
import { layoutText, ASCENT } from '../text/layout';
import { Master, SlideSize, LayoutId, defaultMaster, textStyles, slideDrawingStyle, slideBackground, slideColours, hasLayout, newLayoutId, deckLayouts, type LayoutDef, type PlaceholderBox, type SectionCount, type DeckSettings, type SlideHF, type DateFormat, showsNumber, showsFooter, showsDate } from '../deck/deck';
import { backgroundColour, isPlain, sameBackground, type Background } from '../deck/background';
import { readFill, readOneFill, type FillContext } from './pptx-background';
import { TAG, PPT_ASCENT, MIME_EXT, arialMeasure, NS_A14, NS_M, swapBox } from './pptx-write';
import { ommlToTex, toOmml } from '../document/math';
import { shapeMathPicture, shapeMathSize } from '../deck/equation';
import { GEOS } from '../design/geo';
import { cleanDiagram, textFromShapes } from '../design/diagrams';
import { gluePoint, arrowPoints, boxOf as pointsBox } from '../objects';
import { readShowPr, readCustShows } from '../deck/show-setup';
import { NARRATION_NAME } from '../deck/narration';
import { readTransition, readTiming, readMediaTiming, type Transition, type Anim, type AnimTarget } from '../deck/animation';
import { mediaMime } from '../deck/media';
import { readChart } from './office-chart';
import { freshBox, sameBoxData, sizedBox, type ChartBox } from '../sheet/chart-box';
import { chartBoxPng } from '../render/chart-box-paint';

/** PowerPoint's shapes that are shapes in the library, by PowerPoint's name. */
const GEO_BY_PRST = new Map(GEOS.filter((g) => g.prst).map((g) => [g.prst!, g.id]));
/** PowerPoint shapes that come into slides as plain boxes and ovals (with their text beside them as text boxes). */
const PLAIN_PRST = new Set(['rect', 'roundRect', 'ellipse', 'snip1Rect', 'flowChartProcess', 'flowChartAlternateProcess']);

export interface PptxSlide { layout: LayoutId; contents: Contents; notes: string; transition?: Transition; anims?: Anim[]; comments?: PinnedComment[]; background?: Background; hideGraphics?: boolean; hidden?: boolean; hf?: SlideHF }
export interface PptxRead {
  size: SlideSize;
  master: Master;
  slides: PptxSlide[];
  /** Things that came in differently or not at all (shown to the person, never blocking). */
  warnings: string[];
  /** Saved from Design mode (opens there again). */
  design: boolean;
  /** The deck's sections, in order (none when the file has none). */
  sections?: SectionCount[];
  /** Set Up Show, and custom shows (naming their slides by their places in the deck). */
  settings?: DeckSettings;
}

const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
EXT_MIME.jpg = 'image/jpeg';
EXT_MIME.tif = 'image/tiff';

/** Picture types a web page can show. */
export { imageSize };

/** Picture types a web page can show. */
export const SHOWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/webp', 'image/x-emf']);

// ---------------------------------------------------------------- positions

/** Where a shape's own coordinates land on the slide (groups scale and move what they hold). */
interface Xf { sx: number; sy: number; tx: number; ty: number }
const IDENTITY: Xf = { sx: 1, sy: 1, tx: 0, ty: 0 };
const apply = (t: Xf, x: number, y: number): Vec => ({ x: t.tx + t.sx * x, y: t.ty + t.sy * y });

/** The box of a shape (its a:xfrm or p:xfrm), in points on the slide. */
function boxOf(xfrmEl: Element | null, t: Xf): (Rect & { rot: number; flipH: boolean; flipV: boolean }) | null {
  const off = kid(xfrmEl, 'off'), ext = kid(xfrmEl, 'ext');
  if (!off || !ext) return null;
  const a = apply(t, fromEmu(off.getAttribute('x')), fromEmu(off.getAttribute('y')));
  const w = fromEmu(ext.getAttribute('cx')) * t.sx, h = fromEmu(ext.getAttribute('cy')) * t.sy;
  return {
    x1: a.x, y1: a.y, x2: a.x + w, y2: a.y + h,
    rot: Number(xfrmEl!.getAttribute('rot') ?? 0) / 60000,
    flipH: xfrmEl!.getAttribute('flipH') === '1', flipV: xfrmEl!.getAttribute('flipV') === '1',
  };
}

// ---------------------------------------------------------------- colours

interface Theme { colors: Record<string, string>; major: string; minor: string }

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080',
};

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.padStart(6, '0').slice(-6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** The colour in a fill or colour element (srgbClr, schemeClr…, with PowerPoint's lighter/darker changes). */
function colorIn(el: Element | null, theme: Theme, clrMap: Record<string, string>, ph: string | null = null): string | null {
  if (!el) return null;
  const c = kids(el).find((k) => /Clr$/.test(k.localName));
  if (!c) return null;
  const v = c.getAttribute('val') ?? '';
  let hex: string | null = null;
  switch (c.localName) {
    case 'srgbClr': hex = v; break;
    // (phClr: the colour a theme's fill style is used with)
    case 'schemeClr': hex = v === 'phClr' ? ph : theme.colors[clrMap[v] ?? v] ?? null; break;
    case 'prstClr': hex = PRESET[v] ?? '000000'; break;
    case 'sysClr': hex = c.getAttribute('lastClr') ?? (v === 'window' ? 'FFFFFF' : '000000'); break;
    case 'scrgbClr': hex = ['r', 'g', 'b'].map((k) => Math.round(Math.pow(Number(c.getAttribute(k) ?? 0) / 100000, 1 / 2.2) * 255).toString(16).padStart(2, '0')).join(''); break;
    default: return null;
  }
  if (!hex) return null;
  let [r, g, b] = hexToRgb(hex);
  for (const m of kids(c)) {
    const f = Number(m.getAttribute('val') ?? 100000) / 100000;
    if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const [h, s, l] = toHsl(r, g, b);
      [r, g, b] = fromHsl(h, s, Math.max(0, Math.min(1, m.localName === 'lumMod' ? l * f : l + f)));
    } else if (m.localName === 'tint') {
      [r, g, b] = [r, g, b].map((x) => x + (255 - x) * (1 - f)) as [number, number, number];
    } else if (m.localName === 'shade') {
      [r, g, b] = [r, g, b].map((x) => x * f) as [number, number, number];
    }
  }
  return rgbHex(r, g, b);
}

/** A styled table read back: cell fills and text colours that only repeat its style are dropped. */
function unstyle(t: TableData): TableData {
  if (!slideCellLook(t, 0, 0)) return t;
  const rows = t.rows.map((row, r) => row.map((cell, c) => {
    const look = slideCellLook(t, r, c);
    const out: TableCell = { ...cell, runs: unstyledRuns(cell.runs, look) };
    if (out.fill && look?.fill && out.fill.toLowerCase() === look.fill.toLowerCase()) delete out.fill;
    return out;
  }));
  return { ...t, rows };
}

// ---------------------------------------------------------------- text formatting, as PowerPoint inherits it

/** List styles to look through, most specific first (the shape's own, its layout's, its master's, the defaults). */
type Chain = (Element | null)[];

const lvlOf = (lst: Element | null, lvl: number) => kid(lst, `lvl${lvl + 1}pPr`);

/** The first value an attribute has along the chain (the run or paragraph first, then each level). */
function inherit(own: Element | null, chain: Chain, lvl: number, get: (el: Element) => string | null, deep = false): string | null {
  const v = own ? get(own) : null;
  if (v !== null) return v;
  for (const lst of chain) {
    const l = lvlOf(lst, lvl);
    if (!l) continue;
    const x = get(deep ? kid(l, 'defRPr') ?? l : l);
    if (x !== null) return x;
  }
  return null;
}

/** The first element of a kind along the chain (bullet, spacing). */
function inheritEl(own: Element | null, chain: Chain, lvl: number, names: string[], deep = false): Element | null {
  const find = (el: Element | null) => kids(el).find((k) => names.includes(k.localName)) ?? null;
  const v = find(own);
  if (v) return v;
  for (const lst of chain) {
    const l = lvlOf(lst, lvl);
    if (!l) continue;
    const x = find(deep ? kid(l, 'defRPr') : l);
    if (x) return x;
  }
  return null;
}

// ---------------------------------------------------------------- the reader

const SKIP_PH = new Set(['dt', 'ftr', 'sldNum', 'hdr', 'sldImg']);

interface PhInfo { type: string; idx: string | null }
const phOf = (sp: Element): PhInfo | null => {
  const ph = kid(sp, sp.localName === 'pic' ? 'nvPicPr' : 'nvSpPr', 'nvPr', 'ph');
  return ph ? { type: ph.getAttribute('type') ?? 'obj', idx: ph.getAttribute('idx') } : null;
};
const isTitle = (t: string) => t === 'title' || t === 'ctrTitle';
const isBody = (t: string) => !isTitle(t) && !SKIP_PH.has(t);

/** Our placeholder kind for PowerPoint's. */
const phKind = (t: string): Placeholder => (isTitle(t) ? 'title' : t === 'subTitle' ? 'subtitle' : 'body');

interface Part { path: string; doc: Document; tree: Element | null }

class Reader {
  private r: PackageReader;
  warnings = new Set<string>();
  private theme: Theme = { colors: {}, major: 'Arial', minor: 'Arial' };
  /** The theme's fill styles (backgrounds can use them) and where the theme is (for its pictures). */
  private themeFills: Element | null = null;
  private themePath: string | null = null;
  private clrMap: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  private master!: Part;
  private defaultText: Element | null = null;
  private ourMaster: Partial<Master> | null = null;
  /** The layout of the slide being read, when the file says (files saved here). */
  private curLayout: LayoutId | undefined;
  private design = false;
  /** The slides' parts, the one being read, and the ids slides had here (files saved here), for links. */
  private slidePaths: string[] = [];
  private curPath = '';
  private slideIds = new Map<number, number>();
  private masterOut!: Master;
  private size: SlideSize = { w: 960, h: 540 };
  /** The slide's tables, placed once their titles and footnotes (separate text boxes) are known. */
  private tables: { key: string | null; table: TableData; frame: Rect; color?: string }[] = [];
  private tableParts = new Map<string, { title?: Omit<Caption, 'id'>; notes?: Omit<Caption, 'id'> }>();
  /** For a slide with animations: the object made from each PowerPoint shape (by its id). */
  private spidTargets: Map<number, AnimTarget> | null = null;
  /** …and the PowerPoint shape each of the slide's tables came from (by the table's place in `tables`). */
  private tableSpids = new Map<number, number>();
  /** The slide's structures (their box tags, where they went and the ids they got)… */
  private drawn: { box: string; map: (p: Vec) => Vec; from: number; to: number }[] = [];
  /** …and its highlight pictures, matched to their highlights once the structures are in. */
  private highlightPics: { spid: number; x: number; y: number; bond: boolean; box: string }[] = [];

  constructor(bytes: Uint8Array) {
    this.r = new PackageReader(bytes);
  }

  private part(path: string | null): Part | null {
    if (!path) return null;
    const doc = this.r.xml(path);
    if (!doc) return null;
    const cSld = kids(doc.documentElement).find((k) => k.localName === 'cSld') ?? null;
    return { path, doc, tree: kid(cSld, 'spTree') };
  }

  private tagsOf(from: string, holder: Element | null): Record<string, string> {
    const out: Record<string, string> = {};
    for (const t of kids(kid(holder, 'custDataLst'), 'tags')) {
      const rel = this.r.rels(from).get(rAttr(t, 'id') ?? '');
      const doc = rel ? this.r.xml(rel.target) : null;
      if (!doc) continue;
      for (const tag of Array.from(doc.getElementsByTagNameNS(NS.p, 'tag'))) out[tag.getAttribute('name') ?? ''] = tag.getAttribute('val') ?? '';
    }
    return out;
  }

  read(): PptxRead {
    const main = this.r.relOfType('', REL.officeDocument);
    const pres = main ? this.r.xml(main) : null;
    if (!main || !pres) throw new Error('This is not a PowerPoint file (it has no presentation in it).');
    const root = pres.documentElement;
    const sz = kid(root, 'sldSz');
    if (sz) this.size = { w: Math.round(fromEmu(sz.getAttribute('cx'))), h: Math.round(fromEmu(sz.getAttribute('cy'))) };
    this.defaultText = kid(root, 'defaultTextStyle');
    const tags = this.tagsOf(main, root);
    const ours = tags[TAG.master];
    this.design = tags[TAG.design] === '1';
    if (ours) {
      try { this.ourMaster = JSON.parse(ours); } catch { /* use PowerPoint's master */ }
    }
    const rels = this.r.rels(main);
    const slidePaths = kids(kid(root, 'sldIdLst'), 'sldId').map((s) => rels.get(rAttr(s, 'id') ?? '')?.target).filter((p): p is string => !!p && this.r.has(p));
    // the master of the first slide (PowerPoint files can have several; the first one sets the look)
    const firstLayout = slidePaths[0] ? this.r.relOfType(slidePaths[0], REL.slideLayout) : null;
    const masterPath = (firstLayout && this.r.relOfType(firstLayout, REL.slideMaster)) ?? kids(kid(root, 'sldMasterIdLst'), 'sldMasterId').map((m) => rels.get(rAttr(m, 'id') ?? '')?.target)[0] ?? null;
    const master = this.part(masterPath);
    if (!master) throw new Error('This PowerPoint file has no slide master.');
    this.master = master;
    this.readTheme();
    this.masterOut = this.readMaster(slidePaths);
    this.slidePaths = slidePaths;
    const slides = slidePaths.map((p) => this.slide(p));
    placeSlideLinks(slides, this.slideIds);
    // the slides' ids in the file (as PowerPoint's sections name them)
    const sldIds = kids(kid(root, 'sldIdLst'), 'sldId').filter((x) => { const t = rels.get(rAttr(x, 'id') ?? '')?.target; return !!t && this.r.has(t); }).map((x) => x.getAttribute('id') ?? '');
    const sections = readSections(root, sldIds);
    // Set Up Show, and custom shows
    const props = this.r.relOfType(main, REL.presProps);
    const show = readShowPr(props ? this.r.xml(props)?.documentElement ?? null : null);
    const customShows = readCustShows(root, (rid) => { const t = rels.get(rid)?.target; return t ? slidePaths.indexOf(t) : -1; }, (el) => rAttr(el, 'id'));
    const settings: DeckSettings = { ...(show ? { show } : {}), ...(customShows.length ? { customShows } : {}) };
    return { size: this.size, master: this.masterOut, slides, warnings: [...this.warnings], design: this.design, ...(sections ? { sections } : {}), ...(Object.keys(settings).length ? { settings } : {}) };
  }

  private readTheme(): void {
    const map = kid(this.master.doc.documentElement, 'clrMap');
    if (map) for (const a of Array.from(map.attributes)) this.clrMap[a.name] = a.value;
    const themePath = this.r.relOfType(this.master.path, REL.theme);
    const th = themePath ? this.r.xml(themePath) : null;
    const el = kid(th?.documentElement, 'themeElements');
    for (const c of kids(kid(el, 'clrScheme'))) {
      const v = kids(c)[0];
      if (!v) continue;
      this.theme.colors[c.localName] = v.localName === 'sysClr' ? v.getAttribute('lastClr') ?? '000000' : v.getAttribute('val') ?? '000000';
    }
    this.themeFills = kid(el, 'fmtScheme');
    this.themePath = themePath;
    const fonts = kid(el, 'fontScheme');
    this.theme.major = kid(fonts, 'majorFont', 'latin')?.getAttribute('typeface') || 'Arial';
    this.theme.minor = kid(fonts, 'minorFont', 'latin')?.getAttribute('typeface') || 'Arial';
  }

  private color(el: Element | null, ph: Element | null = null): string | null {
    const p = ph ? colorIn(ph, this.theme, this.clrMap)?.slice(1) ?? null : null;
    return colorIn(el, this.theme, this.clrMap, p);
  }

  /** A typeface, with the theme's title and body fonts filled in. */
  private font(face: string | null, title: boolean): string {
    if (!face) return title ? this.theme.major : this.theme.minor;
    if (face.startsWith('+mj')) return this.theme.major;
    if (face.startsWith('+mn')) return this.theme.minor;
    return face;
  }

  /** The slide master, from our settings when this program saved the file, else from PowerPoint's. */
  private readMaster(slidePaths: string[]): Master {
    const m = defaultMaster();
    const root = this.master.doc.documentElement;
    const logo = this.masterLogo();
    if (this.ourMaster) {
      const out: Master = { ...m, ...this.ourMaster, logo, drawing: { ...m.drawing, ...(this.ourMaster.drawing ?? {}) } };
      // gradients and pictures are PowerPoint's own backgrounds, on the master and the title slide's layout
      const fill = this.background(this.master);
      if (fill && !isPlain(fill)) out.fill = fill;
      const title = out.titleSlide && this.layoutPart('title');
      // (a title slide layout with no background of its own has the master's)
      const tfill = title ? this.background(title) ?? out.fill ?? null : null;
      if (out.titleSlide && tfill && !isPlain(tfill)) out.titleSlide = { ...out.titleSlide, fill: tfill };
      return out;
    }
    const tx = kid(root, 'txStyles');
    const title = lvlOf(kid(tx, 'titleStyle'), 0), body = lvlOf(kid(tx, 'bodyStyle'), 0);
    const tR = kid(title, 'defRPr'), bR = kid(body, 'defRPr');
    m.titleFont = this.font(kid(tR, 'latin')?.getAttribute('typeface') ?? null, true);
    m.bodyFont = this.font(kid(bR, 'latin')?.getAttribute('typeface') ?? null, false);
    if (tR?.getAttribute('sz')) m.titleSize = Number(tR.getAttribute('sz')) / 100;
    if (bR?.getAttribute('sz')) m.bodySize = Number(bR.getAttribute('sz')) / 100;
    m.titleBold = tR?.getAttribute('b') === '1';
    m.titleColor = this.color(kid(tR, 'solidFill')) ?? m.titleColor;
    m.textColor = this.color(kid(bR, 'solidFill')) ?? m.textColor;
    const bg = this.background(this.master);
    if (bg) {
      m.background = backgroundColour(bg);
      if (!isPlain(bg)) m.fill = bg;
    }
    // numbers, footer and date: as the slides show them
    let numbers = false, footer = '', date: Element | null = null;
    for (const p of slidePaths) {
      const s = this.part(p);
      for (const sp of kids(s?.tree, 'sp')) {
        const ph = phOf(sp);
        if (ph?.type === 'sldNum') numbers = true;
        if (ph?.type === 'ftr' && !footer) footer = this.plain(sp);
        if (ph?.type === 'dt' && !date) date = sp;
      }
    }
    m.slideNumbers = numbers;
    m.footer = footer;
    if (date) {
      // today's date in one of PowerPoint's forms, or fixed text
      m.dateOn = true;
      const fld = date.getElementsByTagNameNS(NS.a, 'fld')[0];
      const type = fld?.getAttribute('type') ?? '';
      if (/^datetime([1-9]|1[0-3])$/.test(type)) m.dateFormat = type as DateFormat;
      else if (fld) m.dateFormat = 'datetime1';
      else m.dateFixed = this.plain(date);
    }
    m.drawing = slideDrawingStyle();
    m.logo = logo;
    return m;
  }

  /** A slide, layout or master's own background (null when it uses the one behind it). */
  private background(part: Part): Background | null {
    const bg = kid(part.doc.documentElement, 'cSld', 'bg');
    if (!bg) return null;
    const ctx = (from: string): FillContext => ({
      color: (el, ph) => this.color(el, ph),
      picture: (blipFill) => this.blipImage(from, blipFill),
      warn: (w) => this.warnings.add(w),
    });
    const pr = kid(bg, 'bgPr');
    if (pr) return readFill(pr, this.size, ctx(part.path));
    const ref = kid(bg, 'bgRef');
    if (!ref) return null;
    // one of the theme's fill styles, in the colour given
    const idx = Number(ref.getAttribute('idx') ?? 0);
    if (!idx || idx === 1000) return { kind: 'solid', color: '#ffffff' };
    const list = kid(this.themeFills, idx > 1000 ? 'bgFillStyleLst' : 'fillStyleLst');
    const style = kids(list)[(idx > 1000 ? idx - 1001 : idx - 1)];
    const got = style ? readOneFill(style, this.size, ctx(this.themePath ?? part.path), ref) : null;
    if (got) return got;
    const c = this.color(ref);
    return c ? { kind: 'solid', color: c } : null;
  }

  /** The layout part used by slides of one of our layouts (files saved here have one of each). */
  private layoutPart(id: LayoutId): Part | null {
    for (const rel of this.r.rels(this.master.path).values()) {
      const p = this.part(rel.target);
      if (p && p.doc.documentElement.localName === 'sldLayout' && p.doc.documentElement.getAttribute('type') === ({ title: 'title', 'title-content': 'obj', 'two-content': 'twoObj', 'title-only': 'titleOnly', blank: 'blank' } as const)[id]) return p;
    }
    return null;
  }

  /** The logo: a picture on the master (the one named Logo in files saved here, else the first). */
  private masterLogo(): Master['logo'] {
    const pics = kids(this.master.tree, 'pic');
    const pic = pics.find((p) => kid(p, 'nvPicPr', 'cNvPr')?.getAttribute('name') === 'Logo') ?? (this.ourMaster ? null : pics[0]);
    if (!pic) return null;
    const img = this.image(this.master.path, pic);
    if (!img) return null;
    return { src: img.src, px: img.px };
  }

  /** The text of a shape as plain text (paragraphs on lines of their own). */
  private plain(sp: Element): string {
    return kids(kid(sp, 'txBody'), 'p').map((p) => kids(p).filter((k) => k.localName === 'r' || k.localName === 'fld' || k.localName === 'br').map((k) => (k.localName === 'br' ? '\n' : kid(k, 't')?.textContent ?? '')).join('')).join('\n');
  }

  // ---------------------------------------------------------------- slides

  private slide(path: string): PptxSlide {
    const s = this.part(path)!;
    const layoutPath = this.r.relOfType(path, REL.slideLayout);
    const layout = this.part(layoutPath);
    const tags = this.tagsOf(path, kid(s.doc.documentElement, 'cSld'));
    this.curPath = path;
    if (tags[TAG.slideId]) this.slideIds.set(Number(tags[TAG.slideId]), this.slidePaths.indexOf(path));
    const doc = new Doc();
    doc.style = { ...this.masterOut.drawing };
    // files saved here say which layout each slide has; a title slide can have its own colours
    this.curLayout = tags[TAG.layout] as LayoutId | undefined;
    this.tables = [];
    this.tableParts.clear();
    this.geoIds.clear();
    const root = s.doc.documentElement;
    this.spidTargets = kids(root, 'timing').length ? new Map() : null;
    this.tableSpids.clear();
    this.drawn = [];
    this.highlightPics = [];
    doc.bulk(() => {
      this.tree(s, layout, s.tree, IDENTITY, doc);
      this.placeTables(doc);
    });
    const id = (tags[TAG.layout] as LayoutId | undefined) ?? this.layoutId(layout, doc);
    const warn = (w: string) => this.warnings.add(w);
    const transition = readTransition(root, warn);
    const targets = this.spidTargets;
    if (targets) {
      this.findHighlights(doc, targets);
      // how the videos and sounds play
      const how = readMediaTiming(root);
      doc.bulk(() => {
        for (const [spid, m] of how) {
          const t = targets.get(spid);
          const sh = t?.kind === 'shape' ? doc.shapes.get(t.id) : undefined;
          if (!sh?.video) continue;
          const next: Media = { ...sh.video, ...m };
          if (next.once === false) delete next.once;
          doc.updateShape(sh.id, { video: next });
        }
      });
    }
    const anims = targets ? readTiming(root, (spid) => targets.get(spid) ?? null, warn) : [];
    this.spidTargets = null;
    const comments = this.comments(path);
    const lay: LayoutId = hasLayout(this.masterOut, id) ? id : 'title-content';
    // the background PowerPoint shows (the slide's, else its layout's, else the master's): the slide's own when ours would differ
    const shown = this.background(s) ?? (layout ? this.background(layout) : null) ?? slideBackground(this.masterOut, lay);
    const background = sameBackground(shown, slideBackground(this.masterOut, lay)) ? undefined : shown;
    const hideGraphics = /^(0|false)$/.test(root.getAttribute('showMasterSp') ?? '');
    // Hide Slide: PowerPoint's show="0"
    const hidden = /^(0|false)$/.test(root.getAttribute('show') ?? '');
    // the slide number, footer and date it shows, where they differ from what the master says
    const has = (t: string) => kids(s.tree, 'sp').some((sp) => phOf(sp)?.type === t);
    const m = this.masterOut;
    const own: SlideHF = {};
    if (has('sldNum') !== showsNumber(m, lay)) own.number = has('sldNum');
    if (m.footer.trim() && has('ftr') !== showsFooter(m, lay)) own.footer = has('ftr');
    if (has('dt') !== showsDate(m, lay)) own.date = has('dt');
    const hf = Object.keys(own).length ? own : undefined;
    return {
      layout: lay, contents: doc.contents(), notes: this.notes(path),
      ...(background ? { background } : {}), ...(hideGraphics ? { hideGraphics } : {}), ...(hidden ? { hidden } : {}), ...(hf ? { hf } : {}),
      ...(transition && (transition.kind !== 'none' || transition.advanceAfter) ? { transition } : {}), ...(anims.length ? { anims } : {}),
      ...(comments.length ? { comments } : {}),
    };
  }

  /** The slide's comments (PowerPoint's of either kind). */
  private authors: Map<string, string> | null = null;
  private comments(path: string): PinnedComment[] {
    const main = this.r.relOfType('', REL.officeDocument) ?? '';
    if (!this.authors) {
      this.authors = new Map();
      try {
        this.authors = readCommentAuthors(this.r.xml(this.r.relOfType(main, COMMENT_REL.authors) ?? ''));
        for (const [k, v] of readCommentAuthors(this.r.xml(this.r.relOfType(main, COMMENT_REL.modernAuthors) ?? ''))) this.authors.set(k, v);
      } catch { /* names left blank */ }
    }
    try {
      const legacy = this.r.relOfType(path, COMMENT_REL.comments);
      const modern = this.r.relOfType(path, COMMENT_REL.modernComments);
      const out = readLegacyComments(legacy ? this.r.xml(legacy) : null, this.authors);
      return [...out, ...readModernComments(modern ? this.r.xml(modern) : null, this.authors, out.length)];
    } catch {
      this.warnings.add('Some comments could not be read and were left out.');
      return [];
    }
  }

  /** PowerPoint's custom layouts read so far (by their part), as layouts of the deck's master. */
  private ownLayouts = new Map<string, LayoutId>();

  /**
   * One of PowerPoint's custom layouts as a layout of the master: its name and its title and text
   * placeholders where it puts them (or where the master does). Null when it has none.
   */
  private customLayout(layout: Part): LayoutId | null {
    const got = this.ownLayouts.get(layout.path);
    if (got !== undefined) return got;
    const boxes: PlaceholderBox[] = [];
    for (const sp of kids(layout.tree, 'sp')) {
      const ph = phOf(sp);
      if (!ph || SKIP_PH.has(ph.type) || !(isTitle(ph.type) || ph.type === 'subTitle' || ph.type === 'body' || ph.type === 'obj')) continue;
      const own = kid(sp, 'spPr', 'xfrm');
      const xf = own ?? this.inherited(null, ph).map((e) => kid(e, 'spPr', 'xfrm')).find((x) => x) ?? null;
      const b = boxOf(xf, IDENTITY);
      if (!b) continue;
      const kind = phKind(ph.type);
      if (kind === 'title' && boxes.some((x) => x.ph === 'title')) continue;
      const algn = kid(sp, 'txBody', 'lstStyle', 'lvl1pPr')?.getAttribute('algn') ?? kid(sp, 'txBody', 'p', 'pPr')?.getAttribute('algn');
      const r = (v: number) => +v.toFixed(4);
      boxes.push({ ph: kind, x: r(b.x1 / this.size.w), y: r(b.y1 / this.size.h), w: r((b.x2 - b.x1) / this.size.w), h: r((b.y2 - b.y1) / this.size.h), justify: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left' });
    }
    if (!boxes.length && !kids(layout.tree, 'sp').length) { this.ownLayouts.set(layout.path, 'blank'); return 'blank'; }
    if (!boxes.length) return null;
    const m = this.masterOut;
    const list = [...deckLayouts(m), ...(m.layouts ?? [])];
    const def: LayoutDef = { id: newLayoutId(list), name: kid(layout.doc.documentElement, 'cSld')?.getAttribute('name') || 'Custom Layout', boxes };
    m.layouts = [...(m.layouts ?? []), def];
    this.ownLayouts.set(layout.path, def.id);
    return def.id;
  }

  /** Our layout for PowerPoint's, by its type or else by the text boxes on the slide. */
  private layoutId(layout: Part | null, doc: Doc): LayoutId {
    const t = layout?.doc.documentElement.getAttribute('type') ?? '';
    // PowerPoint's own custom layouts become layouts of the master, with their names and placeholders
    if (layout && (t === 'cust' || t === '') && !this.ourMaster) {
      const own = this.customLayout(layout);
      if (own) return own;
    }
    const known: Record<string, LayoutId> = {
      title: 'title', secHead: 'title', obj: 'title-content', tx: 'title-content', txAndObj: 'two-content', objAndTx: 'two-content',
      twoObj: 'two-content', twoTxTwoObj: 'two-content', twoColTx: 'two-content', titleOnly: 'title-only', blank: 'blank',
    };
    if (known[t]) return known[t];
    const phs = [...doc.captions.values()].map((c) => c.ph);
    const bodies = phs.filter((p) => p === 'body').length;
    if (phs.includes('subtitle')) return 'title';
    if (bodies >= 2) return 'two-content';
    if (bodies === 1) return 'title-content';
    return phs.includes('title') ? 'title-only' : 'blank';
  }

  private notes(path: string): string {
    const np = this.r.relOfType(path, REL.notesSlide);
    const n = this.part(np);
    if (!n) return '';
    const body = kids(n.tree, 'sp').find((sp) => phOf(sp)?.type === 'body');
    return body ? this.plain(body).replace(/\s+$/, '') : '';
  }

  /** Everything in a shape tree (a slide, or a group). */
  private tree(s: Part, layout: Part | null, tree: Element | null, t: Xf, doc: Doc): void {
    for (const el of kids(tree)) this.element(s, layout, el, t, doc);
  }

  private element(s: Part, layout: Part | null, el: Element, t: Xf, doc: Doc): void {
    if (el.localName === 'AlternateContent') { this.elementOnly(s, layout, el, t, doc); return; }
    // note what each PowerPoint shape became, for the slide's animations
    const mark = doc.idMark, tables = this.tables.length;
    this.elementOnly(s, layout, el, t, doc);
    this.nameNew(el, doc, mark);
    if (!this.spidTargets) return;
    const spid = Number(el.getElementsByTagNameNS(NS.p, 'cNvPr')[0]?.getAttribute('id'));
    if (!Number.isFinite(spid)) return;
    if (this.tables.length > tables) { this.tableSpids.set(tables, spid); return; }
    let first: AnimTarget | null = null;
    const look = (kind: AnimTarget['kind'], ids: Iterable<number>) => { for (const id of ids) if (id >= mark && (!first || id < first.id)) first = { kind, id }; };
    look('atom', doc.atoms.keys());
    look('caption', doc.captions.keys());
    look('arrow', doc.arrows.keys());
    look('shape', doc.shapes.keys());
    if (first && !this.spidTargets.has(spid)) this.spidTargets.set(spid, first);
  }

  private elementOnly(s: Part, layout: Part | null, el: Element, t: Xf, doc: Doc): void {
    switch (el.localName) {
      case 'sp': if (!this.ourConnector(s, el, t, doc) && !this.equation(s, el, t, doc)) this.shape(s, layout, el, t, doc); break;
      case 'pic': this.pictureEl(s, el, t, doc); break;
      case 'cxnSp': if (!this.ourConnector(s, el, t, doc)) this.line(el, kid(el, 'spPr'), t, doc); break;
      case 'grpSp': {
        const x = kid(el, 'grpSpPr', 'xfrm');
        const off = kid(x, 'off'), ext = kid(x, 'ext'), chOff = kid(x, 'chOff'), chExt = kid(x, 'chExt');
        let inner = t;
        if (off && ext && chOff && chExt) {
          const k = (a: Element, b: Element, attr: string) => (Number(b.getAttribute(attr)) ? Number(a.getAttribute(attr)) / Number(b.getAttribute(attr)) : 1);
          const sx = t.sx * k(ext, chExt, 'cx'), sy = t.sy * k(ext, chExt, 'cy');
          const o = apply(t, fromEmu(off.getAttribute('x')), fromEmu(off.getAttribute('y')));
          inner = { sx, sy, tx: o.x - sx * fromEmu(chOff.getAttribute('x')), ty: o.y - sy * fromEmu(chOff.getAttribute('y')) };
        }
        const turned = Number(x?.getAttribute('rot') ?? 0) / 60000, gb = boxOf(x, t), before = doc.idMark;
        // one of our diagrams: its shapes come in as they are, then the frame that keeps its text goes round them
        const diagramTag = this.tagsOf(s.path, kid(el, 'nvGrpSpPr', 'nvPr'))[TAG.diagram];
        const hadShapes = new Set(doc.shapes.keys()), hadArrows = new Set(doc.arrows.keys());
        this.tree(s, layout, el, inner, doc);
        if (diagramTag && off && ext) this.diagramFrame(diagramTag, off, ext, t, doc, hadShapes, hadArrows);
        // a turned group: everything in it turned together about the group's middle
        if (turned && gb) turnNew(doc, before, { x: (gb.x1 + gb.x2) / 2, y: (gb.y1 + gb.y2) / 2 }, turned);
        break;
      }
      case 'graphicFrame': this.frame(s, el, t, doc); break;
      case 'AlternateContent': {
        // the version for programs that don't know the newer form, else the newer one; but an
        // equation (Office Math in a text box) comes in from the newer form, to edit here
        const fb = kids(el, 'Fallback')[0];
        const choices = kids(el, 'Choice');
        // an equation (a14:m) and PowerPoint 2016's newer charts (histograms, box charts) are read from their choice: their fallback is only a picture
        const choice = choices.find((c) => c.getElementsByTagNameNS(NS_A14, 'm').length || Array.from(c.getElementsByTagNameNS('*', 'graphicData')).some((g) => /chartex/.test(g.getAttribute('uri') ?? '')));
        const branch = choice ?? (fb && kids(fb).length ? fb : choices[0]);
        // a zoom PowerPoint made: its picture (the fallback) is read as a zoom, coming back or not
        const zm = choices.map((c) => c.getElementsByTagNameNS('*', 'zmPr')[0]).find((z) => z);
        this.zoomBack = zm ? /^(1|true)$/.test(zm.getAttribute('returnToParent') ?? '') : null;
        if (choices.some((c) => c.getElementsByTagNameNS('*', 'sumZm').length || c.getElementsByTagNameNS('*', 'secZm').length)) this.warnings.add('Summary and section zooms came in as pictures that go to their first slides.');
        for (const k of kids(branch)) this.element(s, layout, k, t, doc);
        this.zoomBack = null;
        break;
      }
      default: break;
    }
  }

  /**
   * The name PowerPoint's Selection Pane shows for a shape (when it isn't one PowerPoint made up,
   * "Picture 3"), and whether it is hidden, given to what the shape became here.
   */
  private nameNew(el: Element, doc: Doc, mark: number): void {
    const nv = kids(el).find((k) => /^nv/.test(k.localName));
    const c = kid(nv ?? null, 'cNvPr');
    if (!c) return;
    const name = c.getAttribute('name')?.trim() ?? '';
    const hidden = c.getAttribute('hidden') === '1' || c.getAttribute('hidden') === 'true';
    const shapes = [...doc.shapes.values()].filter((x) => x.id >= mark);
    const caps = [...doc.captions.values()].filter((x) => x.id >= mark);
    if (hidden) {
      for (const x of shapes) doc.updateShape(x.id, { hidden: true });
      for (const x of caps) doc.updateCaption(x.id, { hidden: true });
    }
    if (!name || el.localName === 'grpSp' || PPT_NAME.test(name)) return;
    if (shapes.length === 1) doc.updateShape(shapes[0].id, { name });
    else if (!shapes.length && caps.length === 1) doc.updateCaption(caps[0].id, { name });
  }

  /**
   * An equation (PowerPoint's Office Math in a text box): one to change in the equation window,
   * its LaTeX as typed here when PowerPoint has not changed it. Its box is the equation's own size,
   * where PowerPoint shows it in the text box. False when the text box holds no equation.
   */
  private equation(s: Part, sp: Element, t: Xf, doc: Doc): boolean {
    const m = sp.getElementsByTagNameNS(NS_A14, 'm')[0];
    const maths = m ? Array.from(m.getElementsByTagNameNS(NS_M, 'oMath')) : [];
    const frame = boxOf(kid(sp, 'spPr', 'xfrm'), t);
    if (!maths.length || !frame) return false;
    const fromFile = maths.map((x) => ommlToTex(x)).join(' \\quad ');
    if (!fromFile.trim()) return false;
    const rPr = m.getElementsByTagNameNS(NS.a, 'rPr')[0] ?? null;
    const sz = Number(rPr?.getAttribute('sz'));

    let ours: ShapeMath | null = null;
    try {
      const tag = this.tagsOf(s.path, kid(sp, 'nvSpPr', 'nvPr'))[TAG.math];
      ours = tag ? JSON.parse(tag) as ShapeMath : null;
    } catch { ours = null; }
    // the LaTeX typed here, unless PowerPoint's copy says something else now
    const same = !!ours?.tex && texOfOmml(ours.tex) === fromFile;
    const math: ShapeMath = {
      tex: same ? ours!.tex : fromFile,
      size: same ? ours!.size : sz > 0 ? sz / 100 : 18,
      color: this.color(kid(rPr, 'solidFill')) ?? ours?.color ?? slideColours(this.masterOut, this.curLayout ?? 'title-content').textColor,
      font: ours?.font ?? this.masterOut.bodyFont,
    };
    // saved here: the box it had; made or changed in PowerPoint: the equation's own size at its text size, in the middle of its text box
    const nat = shapeMathSize(math, arialMeasure);
    const k = sz > 0 ? sz / 100 / math.size : 1;
    const cx = (frame.x1 + frame.x2) / 2, cy = (frame.y1 + frame.y2) / 2;
    const box: Rect = same ? frame : { x1: cx - (nat.w * k) / 2, y1: cy - (nat.h * k) / 2, x2: cx + (nat.w * k) / 2, y2: cy + (nat.h * k) / 2 };
    doc.addShape({ kind: 'picture', x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, src: shapeMathPicture(math, arialMeasure), px: { w: Math.round(nat.w), h: Math.round(nat.h) }, math, ...turn(frame) });
    return true;
  }

  /** The invisible frame of a diagram saved here, round the shapes its group brought in, keeping its text (with any words changed in PowerPoint). */
  private diagramFrame(tag: string, off: Element, ext: Element, t: Xf, doc: Doc, hadShapes: Set<number>, hadArrows: Set<number>): void {
    let saved: { s?: Partial<Shape> } | null;
    try { saved = JSON.parse(tag); } catch { return; }
    const diagram = cleanDiagram(saved?.s?.diagram);
    if (!diagram) return;
    const shapes = [...doc.shapes.keys()].filter((id) => !hadShapes.has(id));
    const arrows = [...doc.arrows.keys()].filter((id) => !hadArrows.has(id));
    const o = apply(t, fromEmu(off.getAttribute('x')), fromEmu(off.getAttribute('y')));
    const box = { x1: o.x, y1: o.y, x2: o.x + t.sx * fromEmu(ext.getAttribute('cx')), y2: o.y + t.sy * fromEmu(ext.getAttribute('cy')) };
    const frame: Frame = { atoms: [], captions: [], arrows, shapes, padX: 0, padY: 0, fit: true };
    const made = doc.addShape({ kind: 'geo', geo: 'rect', ...box, filled: false, lineWidth: 0, color: '#000000', name: 'Diagram', frame, diagram: { ...diagram, w: box.x2 - box.x1, h: box.y2 - box.y1 } });
    const text = textFromShapes(doc, made);
    if (text !== diagram.text) doc.updateShape(made.id, { diagram: { ...made.diagram!, text } });
  }

  /** Tables, charts, and objects from other programs (ChemDraw) in PowerPoint. */
  private frame(s: Part, el: Element, t: Xf, doc: Doc): void {
    const data = kid(el, 'graphic', 'graphicData');
    const uri = data?.getAttribute('uri') ?? '';
    if (/table$/.test(uri)) { this.table(s, el, t); return; }
    if (/chart/.test(uri)) { this.chart(s, el, data!, t, doc); return; }
    // an object from another program: PowerPoint keeps a picture of it, which comes in as a picture
    const find = (e: Element | null): Element | null => {
      if (!e) return null;
      if (e.localName === 'pic') return e;
      for (const k of kids(e)) {
        const f = find(k);
        if (f) return f;
      }
      return null;
    };
    const ole = data ? Array.from(data.getElementsByTagNameNS(NS.p, 'oleObj'))[0] : undefined;
    const pic = find(data);
    if (!pic) { this.warnings.add('Some objects from other programs had no picture and were left out.'); return; }
    const box = boxOf(kid(el, 'xfrm'), t);
    const img = this.image(s.path, pic);
    if (!img || !box) return;
    if (/ChemDraw/i.test(ole?.getAttribute('progId') ?? '')) this.warnings.add('ChemDraw objects came in as pictures.');
    doc.addShape({ kind: 'picture', x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, src: img.src, px: img.px, ...(img.crop ? { crop: img.crop } : {}), ...turn(box) });
  }

  /** A chart: PowerPoint's own (its numbers from what PowerPoint cached), or ours when it charts the same numbers. */
  private chart(s: Part, el: Element, data: Element, t: Xf, doc: Doc): void {
    const box = boxOf(kid(el, 'xfrm'), t);
    const ref = kid(data, 'chart');
    const path = ref ? this.r.rels(s.path).get(rAttr(ref, 'id') ?? '')?.target : undefined;
    if (!box || !path) return;
    const w = box.x2 - box.x1, h = box.y2 - box.y1;
    const got = readChart(this.r, path, w, h);
    if (!got) { this.warnings.add('Some charts could not be read and were left out.'); return; }
    let kept: ChartBox | null = null;
    try {
      const tag = this.tagsOf(s.path, kid(el, 'nvGraphicFramePr', 'nvPr'))[TAG.chart];
      kept = tag ? JSON.parse(tag) as ChartBox : null;
    } catch { kept = null; }
    const chosen = sizedBox(kept?.chart && Array.isArray(kept.cells) && sameBoxData(kept, got.box) ? freshBox(kept) : got.box, w, h);
    if (chosen === got.box && got.partial) this.warnings.add('Some charts mix chart types (a line over columns, a second axis): they show as one type.');
    doc.addShape({ kind: 'picture', x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, src: chartBoxPng(chosen, w, h), px: { w: chosen.chart.w, h: chosen.chart.h }, chart: chosen });
  }

  /** A picture's image (as a data URL), its size in pixels and its cropping. */
  private image(from: string, pic: Element): { src: string; px: { w: number; h: number }; crop: Shape['crop'] | null; mime: string } | null {
    const fill = kid(pic, 'blipFill');
    return fill ? this.blipImage(from, fill) : null;
  }

  /** The picture of a blipFill (a picture's, or a background's). */
  private blipImage(from: string, fill: Element): { src: string; px: { w: number; h: number }; crop: Shape['crop'] | null; mime: string } | null {
    const blip = kid(fill, 'blip');
    if (!blip) return null;
    const rels = this.r.rels(from);
    // PowerPoint shows the SVG when there is one; so do we
    const svg = blip.getElementsByTagNameNS('http://schemas.microsoft.com/office/drawing/2016/SVG/main', 'svgBlip')[0];
    const target = (svg && rels.get(rAttr(svg, 'embed') ?? '')?.target) || rels.get(rAttr(blip, 'embed') ?? '')?.target;
    if (!target) {
      if (rAttr(blip, 'link')) this.warnings.add('Pictures linked to files outside the PowerPoint file were left out.');
      return null;
    }
    const bytes = this.r.bytes(target);
    if (!bytes) return null;
    const mime = EXT_MIME[target.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
    if (!SHOWABLE.has(mime)) this.warnings.add('Some pictures (old Windows WMF metafiles, or TIFF) can\'t be shown here yet; they are kept and saved back as they were.');
    const src = kid(fill, 'srcRect');
    const f = (k: string) => Math.max(0, Number(src?.getAttribute(k) ?? 0) / 100000);
    const crop = src ? { l: f('l'), t: f('t'), r: f('r'), b: f('b') } : null;
    return { src: dataUrl(bytes, mime), px: imageSize(bytes, mime) ?? { w: 100, h: 100 }, crop: crop && (crop.l || crop.t || crop.r || crop.b) ? crop : null, mime };
  }

  /** The drawing inside a picture (a metafile) copied from Chem Illustrator, with the area it covered. */
  private emfDrawing(from: string, pic: Element): { cdxml: string; box: string } | null {
    const target = this.r.rels(from).get(rAttr(kid(pic, 'blipFill', 'blip'), 'embed') ?? '')?.target;
    if (!target || !/\.emf$/i.test(target)) return null;
    const bytes = this.r.bytes(target);
    const cdxml = bytes ? drawingInEmf(bytes) : null;
    if (!cdxml) return null;
    try {
      const b = readCdxml(cdxml).doc.bounds();
      return b ? { cdxml, box: [b.x1, b.y1, b.x2, b.y2].join(' ') } : null;
    } catch {
      return null;
    }
  }

  private pictureEl(s: Part, el: Element, t: Xf, doc: Doc): void {
    const box = boxOf(kid(el, 'spPr', 'xfrm'), t);
    if (!box) return;
    const tags = this.tagsOf(s.path, kid(el, 'nvPicPr', 'nvPr'));
    if (tags[TAG.highlight]) {
      // a highlight's own picture: the structure's drawing has the highlight, so only its animation is wanted
      const spid = Number(kid(el, 'nvPicPr', 'cNvPr')?.getAttribute('id'));
      try {
        const h = JSON.parse(tags[TAG.highlight]);
        if (Number.isFinite(spid) && Number.isFinite(h.x) && Number.isFinite(h.y)) this.highlightPics.push({ spid, x: h.x, y: h.y, bond: !!h.bond, box: String(h.box ?? '') });
        return;
      } catch { /* not ours after all: read it as a picture */ }
    }
    if (tags[TAG.cdxml] && this.drawing(tags[TAG.cdxml], tags[TAG.box], box, doc)) return;
    // a picture pasted into PowerPoint from Chem Illustrator: the drawing rides inside it
    const inside = this.emfDrawing(s.path, el);
    if (inside && this.drawing(inside.cdxml, inside.box, box, doc)) return;
    const img = this.image(s.path, el);
    if (!img) return;
    const look = this.pictureLook(kid(el, 'spPr'));
    const video0 = this.videoOf(s.path, kid(el, 'nvPicPr', 'nvPr'));
    // recorded narration (Slide Show > Record), as we name it
    const video = video0?.audio && kid(el, 'nvPicPr', 'cNvPr')?.getAttribute('name') === NARRATION_NAME ? { ...video0, narration: true } : video0;
    const fx = this.pictureFx(s.path, el, img, tags[TAG.picture]);
    // a picture cut to a shape has the shape's outline, not rounded corners
    if (fx?.shape && look) delete look.round;
    // a click on it in the show: a zoom (ours, or PowerPoint's, from its fallback picture) or a link
    const click = video ? null : this.hlinkOf(kid(el, 'nvPicPr', 'cNvPr', 'hlinkClick'));
    let zoom: Shape['zoom'] | undefined;
    if (tags[TAG.zoom]) {
      try { const z = JSON.parse(tags[TAG.zoom]); if (z && typeof z === 'object' && z.zoom) zoom = { ...(z.zoom.back ? { back: true } : {}), ...(typeof z.zoom.to === 'string' ? { to: z.zoom.to } : {}) }; } catch { /* a plain link */ }
    } else if (this.zoomBack !== null && click) zoom = this.zoomBack ? { back: true } : {};
    doc.addShape({
      kind: 'picture', x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, src: img.src, px: img.px, ...(img.crop ? { crop: img.crop } : {}), ...(look && Object.keys(look).length ? { look } : {}), ...(fx ? { fx } : {}), ...(video ? { video } : {}),
      ...(click ? { link: click } : {}), ...(zoom && click ? { zoom } : {}), ...turn(box),
    });
  }

  /**
   * A picture's Picture Format settings. When PowerPoint worked sharpening or Remove Background
   * into the picture and kept the original as its layer, the original comes in (`img` changed to
   * it) with the settings; without the original they stay worked in, and are not done again.
   */
  private pictureFx(from: string, pic: Element, img: { src: string; px: { w: number; h: number }; mime: string }, tag: string | undefined): PictureFx | undefined {
    const blip = kid(pic, 'blipFill', 'blip');
    const got = readPictureFx(blip, kid(pic, 'spPr'));
    if (got.dropped) this.warnings.add('Some picture effects (artistic effects, saturation, colour temperature) were left off.');
    const fx = got.fx;
    if (!fx) return undefined;
    const target = got.layer ? this.r.rels(from).get(got.layer)?.target : undefined;
    const bytes = target ? this.r.bytes(target) : null;
    const mime = target ? EXT_MIME[target.split('.').pop()!.toLowerCase()] : undefined;
    if (bytes && mime && SHOWABLE.has(mime) && !img.mime.includes('svg')) {
      img.src = dataUrl(bytes, mime);
      img.px = imageSize(bytes, mime) ?? img.px;
      img.mime = mime;
    } else {
      delete fx.sharpen;
      delete fx.bg;
    }
    if (fx.bg && tag) {
      try {
        const t = JSON.parse(tag) as { tol?: unknown };
        if (typeof t.tol === 'number' && t.tol > 0 && t.tol <= 1) fx.bg.tol = t.tol;
      } catch { /* not ours */ }
    }
    return tidyFx(fx);
  }

  /**
   * The video or sound a picture stands for (PowerPoint's media link, else its video or audio
   * link), with its trim and fades, if the file is inside the PowerPoint file and plays here.
   * Until the slide's timing says otherwise it starts when clicked and plays once, as
   * PowerPoint's own.
   */
  private videoOf(from: string, nvPr: Element | null): Shape['video'] | undefined {
    if (!nvPr) return undefined;
    const media = nvPr.getElementsByTagNameNS('http://schemas.microsoft.com/office/powerpoint/2010/main', 'media')[0];
    const vf = kid(nvPr, 'videoFile'), af = kid(nvPr, 'audioFile');
    if (!media && !vf && !af) return undefined;
    const audio = !!af && !vf;
    const rels = this.r.rels(from);
    const target = (media && rels.get(rAttr(media, 'embed') ?? '')?.target) || (vf && rels.get(rAttr(vf, 'link') ?? '')?.target) || (af && rels.get(rAttr(af, 'link') ?? '')?.target);
    const bytes = target ? this.r.bytes(target) : null;
    const type = target ? mediaMime(target) : null;
    if (!target || !bytes || !type) {
      this.warnings.add(audio ? 'Sounds other than MP3, M4A, WAV, AAC and OGG files inside the PowerPoint file came in as their icons.' : 'Videos other than MP4, MOV and WebM files inside the PowerPoint file came in as their first picture.');
      return undefined;
    }
    const m: Media = { src: dataUrl(bytes, type.mime), ...(type.audio ? { audio: true } : {}), start: 'click', once: true };
    const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
    const trim = media?.getElementsByTagNameNS(P14, 'trim')[0], fade = media?.getElementsByTagNameNS(P14, 'fade')[0];
    const sec = (el: Element | undefined, a: string) => { const v = Number(el?.getAttribute(a)); return Number.isFinite(v) && v > 0 ? +(v / 1000).toFixed(3) : undefined; };
    const parts = { trimStart: sec(trim, 'st'), trimEnd: sec(trim, 'end'), fadeIn: sec(fade, 'inDur'), fadeOut: sec(fade, 'outDur') };
    for (const [k, v] of Object.entries(parts)) if (v !== undefined) (m as unknown as Record<string, number>)[k] = v;
    return m;
  }

  /**
   * A picture's border, rounded corners and shadow. A shadow is read as soft or hard by its blur;
   * PowerPoint's other picture effects (glow, bevels, reflections) are left off.
   */
  private pictureLook(spPr: Element | null): PictureLook | undefined {
    if (!spPr) return undefined;
    const look: PictureLook = {};
    const geom = kid(spPr, 'prstGeom');
    if (geom?.getAttribute('prst') === 'roundRect') {
      const gd = kids(kid(geom, 'avLst')).find((g) => g.getAttribute('name') === 'adj');
      const v = /val\s+(-?\d+)/.exec(gd?.getAttribute('fmla') ?? '');
      look.round = Math.max(0, Math.min(0.5, (v ? Number(v[1]) : 16667) / 100000));
    } else if (geom && geom.getAttribute('prst') !== 'rect' && !knownShape(geom.getAttribute('prst') ?? '')) this.warnings.add('Pictures cut to shapes other than the usual ones came in as rectangles.');
    const ln = kid(spPr, 'ln');
    if (ln && !kid(ln, 'noFill')) {
      const c = this.color(kid(ln, 'solidFill'));
      if (c) {
        look.line = +fromEmu(Number(ln.getAttribute('w') ?? 9525)).toFixed(2);
        look.lineColor = c;
      }
    }
    const fx = kid(spPr, 'effectLst');
    const sh = kid(fx, 'outerShdw');
    if (sh) look.shadow = fromEmu(Number(sh.getAttribute('blurRad') ?? 0)) >= 1 ? 'soft' : 'hard';
    if (fx && kids(fx).some((k) => k.localName !== 'outerShdw')) this.warnings.add('Picture effects other than shadows (glow, soft edges, reflections) were left off.');
    return Object.keys(look).length ? look : undefined;
  }

  /** A structure or scheme saved here: its drawing, moved and sized as the picture now is. */
  private drawing(cdxml: string, boxTag: string | undefined, now: Rect, doc: Doc): boolean {
    let src: Doc;
    try {
      src = readCdxml(cdxml).doc;
    } catch {
      return false;
    }
    const was = (boxTag ?? '').split(' ').map(Number);
    let map = (p: Vec): Vec => p;
    if (was.length === 4 && was.every(Number.isFinite)) {
      const [x1, y1, x2, y2] = was;
      const sx = (now.x2 - now.x1) / Math.max(1e-6, x2 - x1), sy = (now.y2 - now.y1) / Math.max(1e-6, y2 - y1);
      // resized in PowerPoint: keep the proportions, centred where the picture is
      const k = Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01 ? 1 : Math.min(sx, sy);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, nx = (now.x1 + now.x2) / 2, ny = (now.y1 + now.y2) / 2;
      map = (p) => ({ x: nx + (p.x - cx) * k, y: ny + (p.y - cy) * k });
    }
    const from = doc.idMark;
    mergeDrawing(doc, src, map);
    this.drawn.push({ box: boxTag ?? '', map, from, to: doc.idMark });
    return true;
  }

  /** Each highlight picture's highlight: the highlighted atom (or bond) nearest where it was, in its structure. */
  private findHighlights(doc: Doc, targets: Map<number, AnimTarget>): void {
    for (const h of this.highlightPics) {
      const d = this.drawn.find((x) => x.box === h.box);
      if (!d) continue;
      const at = d.map({ x: h.x, y: h.y });
      let best: AnimTarget | null = null, far = Infinity;
      const near = (x: number, y: number, t: AnimTarget) => { const r = Math.hypot(x - at.x, y - at.y); if (r < far) { far = r; best = t; } };
      if (h.bond) {
        for (const b of doc.bonds.values()) {
          const p = doc.atoms.get(b.a1), q = doc.atoms.get(b.a2);
          if (b.highlight && b.id >= d.from && b.id < d.to && p && q) near((p.x + q.x) / 2, (p.y + q.y) / 2, { kind: 'highlight', id: b.id, bond: true });
        }
      } else for (const a of doc.atoms.values()) if (a.highlight && a.id >= d.from && a.id < d.to) near(a.x, a.y, { kind: 'highlight', id: a.id });
      if (best) targets.set(h.spid, best);
    }
  }

  // ---------------------------------------------------------------- shapes and text

  /** The layout's and master's matching placeholders, for a placeholder on a slide. */
  private inherited(layout: Part | null, ph: PhInfo): Element[] {
    const out: Element[] = [];
    const match = (tree: Element | null, byIdx: boolean) => kids(tree, 'sp').find((sp) => {
      const p = phOf(sp);
      if (!p) return false;
      if (byIdx && ph.idx !== null && p.idx === ph.idx) return true;
      return isTitle(ph.type) ? isTitle(p.type) : p.type === ph.type || (ph.type === 'subTitle' && p.type === 'body' && !byIdx) || (isBody(ph.type) && p.type === 'body' && !byIdx);
    });
    const l = match(layout?.tree ?? null, true) ?? match(layout?.tree ?? null, false);
    if (l) out.push(l);
    const lp = l ? phOf(l)! : ph;
    const m = kids(this.master.tree, 'sp').find((sp) => {
      const p = phOf(sp);
      return !!p && (isTitle(lp.type) ? isTitle(p.type) : SKIP_PH.has(lp.type) ? p.type === lp.type : p.type === 'body');
    });
    if (m) out.push(m);
    return out;
  }

  private shape(s: Part, layout: Part | null, sp: Element, t: Xf, doc: Doc): void {
    const ph = phOf(sp);
    if (ph && SKIP_PH.has(ph.type)) return; // slide numbers, footers and dates come from the master
    const from = ph ? this.inherited(layout, ph) : [];
    const spPr = kid(sp, 'spPr');
    const xfrm = kid(spPr, 'xfrm') ?? from.map((e) => kid(e, 'spPr', 'xfrm')).find((x) => x) ?? null;
    const box = boxOf(xfrm, xfrm && kid(spPr, 'xfrm') ? t : IDENTITY);
    if (!box) return;
    const prst = kid(spPr, 'prstGeom')?.getAttribute('prst') ?? (kid(spPr, 'custGeom') ? 'cust' : 'rect');
    if (!ph && /line|Connector/i.test(prst)) { this.line(sp, spPr, t, doc); return; }
    if (!ph) {
      // a design shape saved here, or a PowerPoint shape that is one (in designs, boxes and ovals too)
      const geoTag = this.tagsOf(s.path, kid(sp, 'nvSpPr', 'nvPr'))[TAG.geo];
      if (geoTag || (GEO_BY_PRST.has(prst) && (this.design || !PLAIN_PRST.has(prst)))) {
        if (this.geoShape(sp, spPr, prst, box, geoTag, doc)) return;
      }
    }
    const hasText = !!this.plain(sp).trim();
    if (!ph) {
      const look = this.look(sp, spPr);
      if (look.fill || look.line) {
        if (!['rect', 'roundRect', 'ellipse', 'snip1Rect', 'flowChartProcess', 'flowChartAlternateProcess'].includes(prst)) this.warnings.add('Some PowerPoint shapes came in as boxes.');
        const sh: Omit<Shape, 'id'> = {
          kind: prst === 'ellipse' ? 'oval' : 'rect', x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2,
          color: look.fill ?? look.line ?? '#000000', ...turn(box),
        };
        if (look.fill) sh.filled = true;
        if (look.fill && look.shaded) sh.fill = 'shaded';
        // a filled shape with an outline of another colour keeps both
        if (look.fill && look.line && look.line.toLowerCase() !== look.fill.toLowerCase()) { sh.color = look.line; sh.fillColor = look.fill; }
        if (look.dashed && !look.fill) sh.dashed = true;
        if (!look.fill && look.width > 1.75 * doc.style.lineWidth) sh.bold = true;
        if (prst === 'roundRect') {
          sh.rounded = true;
          const adj = kid(spPr, 'prstGeom', 'avLst', 'gd')?.getAttribute('fmla')?.match(/val\s+(-?\d+)/);
          sh.radius = (Number(adj?.[1] ?? 16667) / 100000) * Math.min(box.x2 - box.x1, box.y2 - box.y1);
        }
        doc.addShape(sh);
      }
      if (!hasText) return;
    }
    const tags = this.tagsOf(s.path, kid(sp, 'nvSpPr', 'nvPr'));
    // text running down or up: read as text in the box the other way round, turned a quarter more
    const vert = kid(sp, 'txBody', 'bodyPr')?.getAttribute('vert');
    const quarter = vert === 'vert' || vert === 'eaVert' ? 90 : vert === 'vert270' ? -90 : 0;
    const tbox = quarter ? { ...box, ...swapBox(box), rot: box.rot + quarter } : box;
    let c = this.ourText(tags[TAG.text], sp, tbox) ?? turned(this.text(sp, tbox, ph, from), tbox);
    if (c && quarter) c = { ...c, dir: quarter > 0 ? 'vert' : 'vert270' };
    // a table's title or footnotes, saved here as a text box beside it
    const part = (() => {
      try { return tags[TAG.tablePart] ? JSON.parse(tags[TAG.tablePart]) as { key: string; part: 'title' | 'notes' } : null; } catch { return null; }
    })();
    if (c && part && (part.part === 'title' || part.part === 'notes')) {
      const got = this.tableParts.get(String(part.key)) ?? {};
      got[part.part] = c;
      this.tableParts.set(String(part.key), got);
      return;
    }
    if (c) doc.addCaption(c);
  }

  /**
   * A design shape: as saved here (moved and sized as it now is, with PowerPoint's text if that
   * was changed there), or made from a PowerPoint shape of the same kind.
   */
  /** The design shapes read on this slide: their number when saved → their number now (for connectors). */
  private geoIds = new Map<number, number>();
  /** Reading a zoom PowerPoint made: whether the show comes back from it (null: not a zoom). */
  private zoomBack: boolean | null = null;

  /** A connector saved here: the arrow, stuck to the same shapes, where PowerPoint now has it. */
  private ourConnector(s: Part, el: Element, t: Xf, doc: Doc): boolean {
    const tag = this.tagsOf(s.path, kid(el, el.localName === 'sp' ? 'nvSpPr' : 'nvCxnSpPr', 'nvPr'))[TAG.connector];
    if (!tag) return false;
    let saved: { a?: Omit<Arrow, 'id'> } | null;
    try { saved = JSON.parse(tag); } catch { return false; }
    const a = saved?.a;
    if (!a || !a.tail || !a.head) return false;
    const arrow: Omit<Arrow, 'id'> = { ...a };
    // a straight one moved in PowerPoint goes where it is now
    const box = boxOf(kid(kid(el, 'spPr'), 'xfrm'), t);
    if (box && a.sweep && !a.elbow) {
      // a curved one: its ends go where the curve's box now is
      const was = pointsBox(arrowPoints(a, 32));
      const at = (p: { x: number; y: number }) => ({
        x: box.x1 + (was.x2 > was.x1 ? ((p.x - was.x1) / (was.x2 - was.x1)) * (box.x2 - box.x1) : 0),
        y: box.y1 + (was.y2 > was.y1 ? ((p.y - was.y1) / (was.y2 - was.y1)) * (box.y2 - box.y1) : 0),
      });
      arrow.tail = at(a.tail);
      arrow.head = at(a.head);
    } else if (box && !a.elbow) {
      arrow.tail = { x: box.flipH ? box.x2 : box.x1, y: box.flipV ? box.y2 : box.y1 };
      arrow.head = { x: box.flipH ? box.x1 : box.x2, y: box.flipV ? box.y1 : box.y2 };
    }
    const glue = (g: Arrow['from']) => {
      const id = g ? this.geoIds.get(g.shape) : undefined;
      return g && id !== undefined ? { shape: id, port: g.port } : undefined;
    };
    arrow.from = glue(a.from);
    arrow.to = glue(a.to);
    if (!arrow.from) delete arrow.from;
    if (!arrow.to) delete arrow.to;
    const r = doc.addArrow(arrow);
    // stuck ends sit on their shapes' connection points
    const patch: Partial<Arrow> = {};
    const at = (g: NonNullable<Arrow['from']>) => { const sh = doc.shapes.get(g.shape); return sh ? gluePoint(sh, g.port) : null; };
    if (arrow.from) { const p = at(arrow.from); if (p) patch.tail = p; }
    if (arrow.to) { const p = at(arrow.to); if (p) patch.head = p; }
    if (patch.tail || patch.head) doc.updateArrow(r.id, patch);
    return true;
  }

  private geoShape(sp: Element, spPr: Element | null, prst: string, box: Rect & { rot: number }, tag: string | undefined, doc: Doc): boolean {
    let saved: { s: Partial<Shape>; plain: string } | null = null;
    try { saved = tag ? JSON.parse(tag) : null; } catch { saved = null; }
    const where = { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, rot: turn(box).rot };
    const now = this.plain(sp);
    const theirText = () => {
      if (!now.trim()) return undefined;
      const c = this.text(sp, box, null, []);
      return c ? { runs: c.runs, ...(c.paras ? { paras: c.paras } : {}) } : undefined;
    };
    if (saved?.s && saved.s.kind === 'geo') {
      const sh = { ...saved.s, ...where, kind: 'geo' } as Omit<Shape, 'id'>;
      if (now !== saved.plain) {
        const t = theirText();
        if (t) sh.text = t; else delete sh.text;
      }
      const made = doc.addShape(sh);
      const sid = (saved as { sid?: unknown }).sid;
      if (typeof sid === 'number') this.geoIds.set(sid, made.id);
      return true;
    }
    const geo = GEO_BY_PRST.get(prst);
    if (!geo) return false;
    const look = this.look(sp, spPr);
    const sh: Omit<Shape, 'id'> = { kind: 'geo', geo, ...where, color: look.line ?? look.fill ?? '#000000' };
    // an action button, or any shape with an action on a click
    const click = this.hlinkOf(kid(sp, 'nvSpPr', 'cNvPr', 'hlinkClick'));
    if (click) sh.link = click;
    if (look.fill) { sh.filled = true; sh.fillColor = look.fill; }
    if (look.shaded) sh.fill = 'shaded';
    sh.lineWidth = look.line ? +look.width.toFixed(2) : 0;
    if (look.dashed) sh.dashed = true;
    const t = theirText();
    if (t) {
      sh.text = t;
      const c = this.text(sp, box, null, []);
      if (c?.justify && c.justify !== 'center') sh.textAlign = c.justify;
      const anchor = kid(sp, 'txBody', 'bodyPr')?.getAttribute('anchor');
      if (!anchor || anchor === 't') sh.textValign = 'top';
      else if (anchor === 'b') sh.textValign = 'bottom';
    }
    doc.addShape(sh);
    return true;
  }

  /**
   * A PowerPoint table: its cells (with their text, joined cells and rules) and column widths.
   * A table saved here comes back as it was when PowerPoint has not changed its text.
   */
  private table(s: Part, el: Element, t: Xf): void {
    const frame = boxOf(kid(el, 'xfrm'), t);
    const tbl = kid(el, 'graphic', 'graphicData', 'tbl');
    if (!frame || !tbl) return;
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => fromEmu(g.getAttribute('w')) * t.sx);
    const m = cols.length;
    if (!m) return;
    const rows: TableCell[][] = [];
    const borders: Borders[][] = [];
    let lines = false;
    let color: string | undefined;
    const width = (tcPr: Element | null, side: string): number => {
      const e = kid(tcPr, side);
      if (!e || kid(e, 'noFill')) return 0;
      const fill = kid(e, 'solidFill');
      if (!fill) return 0;
      lines = true;
      color ??= this.color(fill) ?? undefined;
      return fromEmu(e.getAttribute('w') ?? 12700);
    };
    for (const tr of kids(tbl, 'tr')) {
      const tcs = kids(tr, 'tc');
      const row: TableCell[] = [];
      const bs: Borders[] = [];
      for (let c = 0; c < m; c++) {
        const tc = tcs[c];
        const tcPr = kid(tc ?? null, 'tcPr');
        bs.push({ left: width(tcPr, 'lnL'), top: width(tcPr, 'lnT'), bottom: width(tcPr, 'lnB'), right: width(tcPr, 'lnR') });
        if (!tc || tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') { row.push({ runs: [] }); continue; }
        const cap = this.text(tc, { x1: 0, y1: 0, x2: cols[c], y2: 100 }, null, []);
        const cell: TableCell = { runs: cap?.runs ?? [] };
        const down = Number(tc.getAttribute('rowSpan') ?? 1);
        if (down > 1) cell.rowSpan = down;
        const fill = this.color(kid(tcPr, 'solidFill'));
        if (fill) cell.fill = fill;
        if (cap?.paras) cell.paras = cap.paras;
        if (cap && kid(kid(tc, 'txBody'), 'p', 'pPr')?.getAttribute('algn')) cell.align = cap.justify;
        const span = Number(tc.getAttribute('gridSpan') ?? 1);
        if (span > 1) cell.span = Math.min(span, m - c);
        row.push(cell);
      }
      rows.push(row);
      borders.push(bs);
    }
    if (!rows.length) return;
    rows.forEach((row, r) => row.forEach((c) => { if (c.rowSpan !== undefined) { if (c.rowSpan > rows.length - r) c.rowSpan = rows.length - r; if (c.rowSpan < 2) delete c.rowSpan; } }));
    // the size most of the text is in becomes the table's
    const sizes = new Map<number, number>();
    for (const row of rows) for (const c of row) for (const r of c.runs) if (r.size !== undefined && r.text.trim()) sizes.set(r.size, (sizes.get(r.size) ?? 0) + r.text.length);
    const size = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const plainRows = rows.map((row) => row.map((c) => ({ ...c, runs: c.runs.map((r) => { if (r.size !== size) return r; const { size: _, ...rest } = r; return rest; }) })));
    const style = kid(tbl, 'tblPr', 'tableStyleId')?.textContent?.trim() ?? '';
    const pr = kid(tbl, 'tblPr');
    const flag = (k: string) => pr?.getAttribute(k) === '1' || pr?.getAttribute(k) === 'true';
    const head = flag('firstRow') ? 1 : 0;
    let read: TableData = { cols, rows: plainRows, head, lines: 'acs' };
    if (size !== undefined) read.size = size;
    const ours = PPT_STYLE_IDS[style];
    if (ours) {
      // one of the styles kept here: the cells' fills and text colours that only repeat it go
      read = unstyle({ ...read, style: ours, look: { total: flag('lastRow'), bandRows: flag('bandRow'), firstCol: flag('firstCol'), lastCol: flag('lastCol'), bandCols: flag('bandCol') } });
    } else if (lines) read = { ...read, ...linesFromBorders(borders) };
    else if (style === '{5940675A-B579-460E-94D1-54222C63F5DA}') read.lines = 'grid';
    else if (style && style !== '{2D5ABB26-0587-4C30-8999-92F81FD0307C}') read = this.bakeStyle(read, style, { firstRow: !!head, lastRow: flag('lastRow'), band1H: flag('bandRow'), band1V: flag('bandCol'), firstCol: flag('firstCol'), lastCol: flag('lastCol') });
    // what was saved here, when the table still has its rows and columns (and its text, for its formatting)
    const tags = this.tagsOf(s.path, kid(el, 'nvGraphicFramePr', 'nvPr'));
    let saved: { key: string; table: TableData; plain: string[][] } | null = null;
    try { saved = tags[TAG.table] ? JSON.parse(tags[TAG.table]) : null; } catch { saved = null; }
    if (saved?.table && saved.table.rows.length === rows.length && saved.table.cols.length === m) {
      const same = JSON.stringify(rows.map((row) => row.map((c) => c.runs.map((r) => r.text).join('')))) === JSON.stringify(saved.plain);
      // columns PowerPoint has resized keep their new widths
      const widths = saved.table.cols.map((w, k) => (Math.abs(w - cols[k]) > 0.5 ? cols[k] : w));
      const own = same ? saved.table.rows : rows.map((row) => row.map((c) => ({ ...c, runs: c.runs.map((r) => { if (r.size !== (saved!.table.size ?? undefined)) return r; const { size: _, ...rest } = r; return rest; }) })));
      const { title: _t, notes: _n, ...rest } = saved.table;
      const table = { ...rest, cols: widths, rows: own };
      // text changed in PowerPoint carries the style's colours written out on it
      this.tables.push({ key: String(saved.key), table: same ? table : unstyle(table), frame, color });
      return;
    }
    this.tables.push({ key: saved ? String(saved.key) : null, table: read, frame, color });
  }

  /**
   * A table in a PowerPoint style not kept here: the style's fills and text colours (from the
   * file's table styles) written onto the cells, and its inside lines as a grid.
   */
  private bakeStyle(t: TableData, id: string, on: Record<string, boolean>): TableData {
    const def = kids(this.r.xml(this.r.relOfType(this.r.relOfType('', REL.officeDocument) ?? '', REL.tableStyles) ?? '')?.documentElement ?? null, 'tblStyle')
      .find((e) => e.getAttribute('styleId') === id);
    if (!def) {
      this.warnings.add('A table\'s PowerPoint style wasn\'t in the file, so its colours were left out (pick a style in the Style panel).');
      return t;
    }
    const n = t.rows.length, m = t.cols.length;
    const head = on.firstRow ? 1 : 0;
    // PowerPoint's order: the whole table, bands, then the marked-out columns and rows on top
    const partsAt = (r: number, c: number): string[] => {
      const out = ['wholeTbl'];
      const body = r >= head && !(on.lastRow && r === n - 1);
      if (on.band1H && body) out.push((r - head) % 2 === 0 ? 'band1H' : 'band2H');
      const k = c - (on.firstCol ? 1 : 0);
      if (on.band1V && body && !(on.firstCol && c === 0) && !(on.lastCol && c === m - 1)) out.push(k % 2 === 0 ? 'band1V' : 'band2V');
      if (on.lastCol && c === m - 1) out.push('lastCol');
      if (on.firstCol && c === 0) out.push('firstCol');
      if (on.lastRow && r === n - 1) out.push('lastRow');
      if (head && r === 0) out.push('firstRow');
      return out;
    };
    const inside = kid(def, 'wholeTbl', 'tcStyle', 'tcBdr');
    const grid = ['insideH', 'insideV'].some((k) => { const l = kid(inside, k, 'ln'); return !!l && !kid(l, 'noFill') && !!kid(l, 'solidFill'); });
    const rows = t.rows.map((row, r) => row.map((cell, c) => {
      let fill: string | undefined, color: string | undefined, bold: boolean | undefined;
      for (const name of partsAt(r, c)) {
        const p = kid(def, name);
        if (!p) continue;
        const f = this.color(kid(p, 'tcStyle', 'fill', 'solidFill'));
        if (f) fill = f;
        const tx = kid(p, 'tcTxStyle');
        if (tx) {
          const tc = this.color(tx);
          if (tc) color = tc;
          if (tx.getAttribute('b') === 'on') bold = true;
          else if (tx.getAttribute('b') === 'off') bold = undefined;
        }
      }
      const out: TableCell = { ...cell };
      if (fill && out.fill === undefined) out.fill = fill;
      if (color || bold) out.runs = cell.runs.map((x) => ({ ...x, ...(color && x.color === undefined ? { color } : {}), ...(bold && x.bold === undefined ? { bold: true } : {}) }));
      return out;
    }));
    return { ...t, rows, lines: grid ? 'grid' : 'none' };
  }

  /** Put the slide's tables on it, with the titles and footnotes saved beside them. */
  private placeTables(doc: Doc): void {
    const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
    const runsOf = (c: Omit<Caption, 'id'> | undefined, size: number) =>
      c?.runs.filter((r) => r.text).map((r) => { if (r.size === undefined || !near(r.size, size)) return r; const { size: _, ...rest } = r; return rest; });
    for (const tb of this.tables) {
      const table = { ...tb.table };
      const parts = tb.key !== null ? this.tableParts.get(tb.key) : undefined;
      if (tb.key !== null) this.tableParts.delete(tb.key);
      const size = table.size ?? doc.style.captionSize;
      const title = runsOf(parts?.title, size), notes = runsOf(parts?.notes, size * NOTE_SCALE);
      if (title?.length) table.title = title;
      if (notes?.length) table.notes = notes;
      const lay = layoutTable(table, doc.style.captionSize, arialMeasure);
      const x1 = tb.frame.x1, y1 = tb.frame.y1 - lay.ys[0];
      const sh: Omit<Shape, 'id'> = { kind: 'table', x1, y1, x2: x1 + lay.width, y2: y1 + lay.height, table };
      if (tb.color && tb.color.toLowerCase() !== '#000000') sh.color = tb.color;
      const made = doc.addShape(sh);
      const spid = this.tableSpids.get(this.tables.indexOf(tb));
      if (spid !== undefined) this.spidTargets?.set(spid, { kind: 'shape', id: made.id });
    }
    // titles and footnotes whose table was deleted in PowerPoint stay as text
    for (const p of this.tableParts.values()) for (const c of [p.title, p.notes]) if (c) doc.addCaption(c);
  }

  /** Text saved here, when PowerPoint has not changed it, moved to where its box now is. */
  /**
   * A PowerPoint link as ours: a web page, e-mail or file; a jump to a slide (as #slide-n=its
   * place, made into the slide's id once the deck has its slides); first/last/next/previous.
   * Links that run programs or macros are left out.
   */
  private hlinkOf(el: Element | null): string | null {
    if (!el) return null;
    const action = el.getAttribute('action') ?? '';
    const jump = /^ppaction:\/\/hlinkshowjump\?jump=(\w+)/.exec(action)?.[1];
    if (jump) return ({ firstslide: '#first', lastslide: '#last', nextslide: '#next', previousslide: '#prev', lastslideviewed: '#return', endshow: '#end' } as Record<string, string>)[jump] ?? null;
    const rel = this.r.rels(this.curPath).get(rAttr(el, 'id') ?? '');
    if (!rel) return null;
    if (action.startsWith('ppaction://hlinksldjump')) {
      const i = this.slidePaths.indexOf(rel.target);
      return i < 0 ? null : `#slide-n=${i}`;
    }
    if (action && !action.startsWith('ppaction://hlinkfile')) {
      this.warnings.add('Links that run programs or macros were left out.');
      return null;
    }
    return rel.external ? linkFromTarget(rel.target) : null;
  }

  private ourText(tag: string | undefined, sp: Element, box: Rect & { rot?: number }): Omit<Caption, 'id'> | null {
    if (!tag) return null;
    let saved: { c: Caption; plain: string; at?: number[]; o?: number[] };
    try {
      saved = JSON.parse(tag);
    } catch {
      return null;
    }
    const now = this.plain(sp);
    if (now !== saved.plain) return null;
    const c: Omit<Caption, 'id'> & { id?: number } = { ...saved.c };
    delete c.id;
    if (saved.at?.length === 4 && saved.o?.length === 2) {
      // where the text starts in its box, turned with the box about the box's middle (as PowerPoint turns it)
      const [, , w, h] = saved.at;
      const mid = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
      const a = turnAbout({ x: box.x1 + saved.o[0], y: box.y1 + saved.o[1] }, mid, box.rot ?? 0);
      c.x = a.x;
      c.y = a.y;
      const rot = normDegrees(box.rot ?? 0);
      if (rot) c.rot = rot; else delete c.rot;
      const nw = box.x2 - box.x1, nh = box.y2 - box.y1;
      if (c.wrap !== undefined && Math.abs(nw - w) > 0.5) c.wrap = nw;
      if ((c.ph || c.fit) && Math.abs(nh - h) > 0.5) c.boxH = nh;
    } else if (saved.at?.length === 4) {
      const [x, y, w, h] = saved.at;
      c.x += box.x1 - x;
      c.y += box.y1 - y;
      const nw = box.x2 - box.x1, nh = box.y2 - box.y1;
      if (c.wrap !== undefined && Math.abs(nw - w) > 0.5) c.wrap = nw;
      if ((c.ph || c.fit) && Math.abs(nh - h) > 0.5) c.boxH = nh;
    }
    return c;
  }

  /** How a shape is filled and outlined (its own settings, else its theme style). */
  private look(sp: Element, spPr: Element | null): { fill: string | null; line: string | null; width: number; dashed: boolean; shaded: boolean } {
    const style = kid(sp, 'style');
    let fill: string | null = null;
    let shaded = false;
    if (kid(spPr, 'solidFill')) fill = this.color(kid(spPr, 'solidFill'));
    else if (kid(spPr, 'gradFill')) {
      // shaded: light to the full colour (the last stop)
      const stops = [...(kid(spPr, 'gradFill', 'gsLst')?.children ?? [])];
      fill = this.color(stops[stops.length - 1] ?? null);
      shaded = true;
    } else if (kid(spPr, 'pattFill')) {
      fill = this.color(kid(spPr, 'pattFill', 'fgClr'));
      this.warnings.add('Patterned fills came in as plain colours.');
    } else if (!kid(spPr, 'noFill') && !kid(spPr, 'blipFill')) {
      const ref = kid(style, 'fillRef');
      if (ref && ref.getAttribute('idx') !== '0') fill = this.color(ref);
    }
    const ln = kid(spPr, 'ln');
    let line: string | null = null;
    if (kid(ln, 'solidFill')) line = this.color(kid(ln, 'solidFill'));
    else if (!kid(ln, 'noFill')) {
      const ref = kid(style, 'lnRef');
      if (ref && ref.getAttribute('idx') !== '0') line = this.color(ref);
    }
    const w = ln?.getAttribute('w');
    const dash = kid(ln, 'prstDash')?.getAttribute('val');
    return { fill, line, width: w ? fromEmu(w) : 0.75, dashed: !!dash && dash !== 'solid', shaded };
  }

  /** A line or connector: an arrow when it has a head, else a line. */
  private line(el: Element, spPr: Element | null, t: Xf, doc: Doc): void {
    const box = boxOf(kid(spPr, 'xfrm'), t);
    if (!box) return;
    const look = this.look(el, spPr);
    if (!look.line) return;
    const prst = kid(spPr, 'prstGeom')?.getAttribute('prst') ?? 'line';
    if (!/^(line|straightConnector1)$/.test(prst)) this.warnings.add('Bent and curved connectors came in straight.');
    const mid = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
    // a turned line: its ends turned about the middle of its box
    const a = turnAbout({ x: box.flipH ? box.x2 : box.x1, y: box.flipV ? box.y2 : box.y1 }, mid, box.rot);
    const b = turnAbout({ x: box.flipH ? box.x1 : box.x2, y: box.flipV ? box.y1 : box.y2 }, mid, box.rot);
    const ln = kid(spPr, 'ln');
    const end = (n: string) => {
      const e = kid(ln, n);
      const type = e?.getAttribute('type');
      return type && type !== 'none' ? e : null;
    };
    // PowerPoint's "head end" is the start of the line and its "tail end" the end
    const atStart = end('headEnd'), atEnd = end('tailEnd');
    if (atStart || atEnd) {
      const lw = look.width;
      const head = atEnd ?? atStart!;
      const len = { sm: 0.6, med: 1, lg: 1.5 }[head.getAttribute('len') ?? 'med'] ?? 1;
      const wid = { sm: 0.6, med: 1, lg: 1.5 }[head.getAttribute('w') ?? 'med'] ?? 1;
      const [tail, tip] = atEnd ? [a, b] : [b, a];
      const arrow: Omit<Arrow, 'id'> = {
        tail, head: tip, headStyle: 'full', tailStyle: atStart && atEnd ? 'full' : 'none',
        headType: head.getAttribute('type') === 'arrow' ? 'angle' : 'solid',
        line: look.dashed ? 'dashed' : 'solid', noGo: false, equilibrium: false, sweep: 0,
        headLength: Math.max(lw, 0.5) * 10 * len, headWidth: Math.max(lw, 0.5) * 2.5 * wid,
      };
      if (look.line.toLowerCase() !== '#000000') arrow.color = look.line;
      if (Math.abs(lw - doc.style.lineWidth) > 0.05) arrow.lineWidth = lw;
      doc.addArrow(arrow);
      return;
    }
    const sh: Omit<Shape, 'id'> = { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    if (look.line.toLowerCase() !== '#000000') sh.color = look.line;
    if (look.dashed) sh.dashed = true;
    if (look.width > 1.75 * doc.style.lineWidth) sh.bold = true;
    doc.addShape(sh);
  }

  /** PowerPoint text as a caption, with the formatting PowerPoint would show. */
  private text(sp: Element, box: Rect, ph: PhInfo | null, from: Element[]): Omit<Caption, 'id'> | null {
    const body = kid(sp, 'txBody');
    const title = !!ph && isTitle(ph.type);
    const txStyles = kid(this.master.doc.documentElement, 'txStyles');
    const chain: Chain = [kid(body, 'lstStyle'), ...from.map((e) => kid(e, 'txBody', 'lstStyle'))];
    if (ph) chain.push(kid(txStyles, title ? 'titleStyle' : 'bodyStyle'));
    else chain.push(this.defaultText, kid(txStyles, 'otherStyle'));
    const bodyPrs = [kid(body, 'bodyPr'), ...from.map((e) => kid(e, 'txBody', 'bodyPr'))];
    const bp = (k: string) => bodyPrs.map((b) => b?.getAttribute(k) ?? null).find((v) => v !== null) ?? null;
    // a text box that shrinks its text to fit keeps its own sizes (it is shrunk here as there);
    // a placeholder's text comes in at the size PowerPoint shrank it to
    const shrinks = !ph && !!kid(bodyPrs[0], 'normAutofit');
    const scale = shrinks ? 1 : Number(kid(bodyPrs[0], 'normAutofit')?.getAttribute('fontScale') ?? 100000) / 100000;
    const kind = ph ? phKind(ph.type) : null;
    const base = kind ? textStyles(this.masterOut, this.curLayout)[kind] : undefined;

    const runs: TextRun[] = [];
    const paras: ParaStyle[] = [];
    let lineSpacing: number | undefined, lineHeight: number | undefined;
    const ps = kids(body, 'p');
    ps.forEach((p, pi) => {
      const pPr = kid(p, 'pPr');
      const lvl = Math.max(0, Math.min(8, Number(pPr?.getAttribute('lvl') ?? 0)));
      const para: ParaStyle = {};
      const algn = inherit(pPr, chain, lvl, (e) => e.getAttribute('algn'));
      const align: Justify = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' ? 'justify' : 'left';
      para.align = align;
      const bullet = inheritEl(pPr, chain, lvl, ['buNone', 'buChar', 'buAutoNum', 'buBlip']);
      const list = bullet?.localName === 'buChar' || bullet?.localName === 'buBlip' ? 'bullet' : bullet?.localName === 'buAutoNum' ? 'number' : undefined;
      if (list) {
        para.list = list;
        if (lvl) para.level = lvl;
      }
      const pts = (names: string[]) => {
        const el = inheritEl(pPr, chain, lvl, names);
        const v = kid(el, 'spcPts')?.getAttribute('val');
        return v ? Number(v) / 100 : null;
      };
      const before = pts(['spcBef']), after = pts(['spcAft']);
      if (before) para.spaceBefore = before;
      if (after) para.spaceAfter = after;
      if (pi === 0) {
        const ls = inheritEl(pPr, chain, lvl, ['lnSpc']);
        const pct = kid(ls, 'spcPct')?.getAttribute('val'), fixed = kid(ls, 'spcPts')?.getAttribute('val');
        if (fixed) lineHeight = Number(fixed) / 100;
        else if (pct && Number(pct) !== 100000) lineSpacing = Number(pct) / 100000;
        const red = shrinks ? 0 : Number(kid(bodyPrs[0], 'normAutofit')?.getAttribute('lnSpcReduction') ?? 0) / 100000;
        if (red) lineSpacing = (lineSpacing ?? 1) * (1 - red);
      }
      const marL = fromEmu(inherit(pPr, chain, lvl, (e) => e.getAttribute('marL')));
      const indent = fromEmu(inherit(pPr, chain, lvl, (e) => e.getAttribute('indent')));
      // our lists put the marker one step in per level; anything further in is extra indent
      const pieces = kids(p).filter((k) => k.localName === 'r' || k.localName === 'fld' || k.localName === 'br');
      const firstSize = (() => {
        const rPr = kid(pieces.find((k) => k.localName !== 'br'), 'rPr');
        const v = inherit(rPr, chain, lvl, (e) => e.getAttribute('sz'), true) ?? kid(p, 'endParaRPr')?.getAttribute('sz') ?? null;
        return (v ? Number(v) / 100 : 18) * scale;
      })();
      const extra = (list ? marL + indent : marL) - (list ? lvl * 1.6 * firstSize : 0);
      if (extra > 1) para.indent = +extra.toFixed(2);
      if (pi > 0) runs.push({ text: '\n' });
      paras.push(para);
      for (const k of pieces) {
        if (k.localName === 'br') {
          runs.push({ text: '\n' });
          paras.push(list ? { ...para, cont: true } : { ...para });
          continue;
        }
        const rPr = kid(k, 'rPr');
        const get = (a: string) => inherit(rPr, chain, lvl, (e) => e.getAttribute(a), true);
        const r: TextRun = { text: kid(k, 't')?.textContent ?? '' };
        const sz = get('sz');
        r.size = (sz ? Number(sz) / 100 : 18) * scale;
        r.size = Math.round(r.size * 10) / 10;
        if (get('b') === '1' || get('b') === 'true') r.bold = true;
        if (get('i') === '1' || get('i') === 'true') r.italic = true;
        const u = get('u');
        if (u && u !== 'none') r.underline = true;
        const strike = get('strike');
        if (strike && strike !== 'noStrike') r.strike = true;
        const spc = Number(get('spc') ?? 0);
        if (spc) r.spacing = spc / 100;
        const bl = Number(get('baseline') ?? 0);
        if (bl < 0) r.sub = true;
        else if (bl > 0) r.sup = true;
        const fillEl = inheritEl(rPr, chain, lvl, ['solidFill'], true);
        r.color = this.color(fillEl) ?? '#000000';
        r.font = this.font(inheritEl(rPr, chain, lvl, ['latin'], true)?.getAttribute('typeface') ?? null, title);
        const link = this.hlinkOf(kid(rPr, 'hlinkClick'));
        if (link) r.link = link;
        runs.push(r);
      }
    });
    if (!ph && !runs.some((r) => r.text.trim())) return null;
    // formatting the master gives is left to the master; plain text keeps what it needs
    let out = merge(runs);
    if (base) out = stripBase(out, base);
    else out = out.map((r) => {
      const x = { ...r };
      if (x.color === '#000000') delete x.color;
      if (x.font === 'Arial') delete x.font;
      return x;
    });
    // the box: inside its margins
    const ins = (k: string, d: number) => {
      const v = bp(k);
      return v === null ? d : fromEmu(v);
    };
    const l = ins('lIns', 7.2), tI = ins('tIns', 3.6), rI = ins('rIns', 7.2), bI = ins('bIns', 3.6);
    const w = box.x2 - box.x1 - l - rI;
    const justify: Justify = paras[0]?.align ?? 'left';
    for (const p of paras) if (p.align === justify) delete p.align;
    const c: Omit<Caption, 'id'> = { x: box.x1 + l, y: 0, runs: out, justify };
    if (paras.some((p) => Object.keys(p).length)) c.paras = paras;
    if (lineHeight) c.lineHeight = lineHeight;
    else if (lineSpacing) c.lineSpacing = +lineSpacing.toFixed(3);
    const wrapNone = bp('wrap') === 'none';
    const sizeFor = base?.size ?? this.masterOut.drawing.captionSize;
    const full = base ? { ...c, runs: out.map((r) => ({ ...base, ...dropUndefined(r) }) as TextRun) } : c;
    if (!wrapNone || ph) c.wrap = Math.max(1, w);
    else {
      const natural = layoutText(full, sizeFor, arialMeasure).boxWidth;
      if (justify !== 'left' || natural > w) c.wrap = Math.max(w, natural);
    }
    const numCol = Number(bp('numCol') ?? 1);
    if (numCol > 1 && c.wrap !== undefined) {
      c.cols = Math.min(16, Math.round(numCol));
      const gap = fromEmu(bp('spcCol') ?? 0);
      if (gap > 0) c.colGap = +gap.toFixed(2);
    }
    if (!kind) {
      if (shrinks) c.fit = 'shrink';
      else if (kid(bodyPrs[0], 'noAutofit')) c.fit = 'fixed';
      if (c.fit) c.boxH = Math.max(1, box.y2 - box.y1 - tI - bI);
    }
    if (kind) {
      c.ph = kind;
      c.boxH = box.y2 - box.y1;
      if (!c.runs.some((r) => r.text.trim())) {
        c.runs = [];
        c.paras = kind === 'body' ? [{ list: 'bullet' }] : undefined;
        if (!c.paras) delete c.paras;
      }
    }
    const lay = layoutText({ ...full, wrap: c.wrap }, sizeFor, arialMeasure);
    const first = lay.lines[0] ? lay.lines[0].ascent / ASCENT : sizeFor;
    const anchor = bp('anchor') ?? 't';
    const room = box.y2 - box.y1 - tI - bI;
    const height = lay.lines.length ? lay.box.y2 - lay.box.y1 : 0;
    const shift = anchor === 'ctr' ? (room - height) / 2 : anchor === 'b' ? room - height : 0;
    c.y = box.y1 + tI + shift + PPT_ASCENT * first;
    return c;
  }
}

const dropUndefined = (r: TextRun): Partial<TextRun> => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));

/** Join neighbouring runs formatted alike (a paragraph break joins the run before it). */
/**
 * Links to slides as their places (#slide-n=2): links PowerPoint made are read that way, and links
 * kept in our own tags name the slide's id when it was saved (#slide=7), turned into its place here.
 */
function placeSlideLinks(slides: PptxSlide[], ids: Map<number, number>): void {
  for (const s of slides) {
    const json = JSON.stringify(s.contents);
    if (!json.includes('"#slide=')) continue;
    s.contents = JSON.parse(json.replace(/"#slide=(\d+)"/g, (all, id) => {
      const i = ids.get(Number(id));
      return i === undefined || i < 0 ? all : `"#slide-n=${i}"`;
    }));
  }
}

function merge(runs: TextRun[]): TextRun[] {
  const same = (a: TextRun, b: TextRun) => {
    const ka = Object.keys(a).filter((k) => k !== 'text'), kb = Object.keys(b).filter((k) => k !== 'text');
    return ka.length === kb.length && ka.every((k) => (a as unknown as Record<string, unknown>)[k] === (b as unknown as Record<string, unknown>)[k]);
  };
  const out: TextRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (r.text === '\n' && last) last.text += '\n';
    else if (last && same(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out.filter((r) => r.text !== '');
}

/** Add a drawing to `doc`, with every position passed through `map`. */
export function mergeDrawing(doc: Doc, src: Doc, map: (p: Vec) => Vec): void {
  const ids = new Map<number, number>();
  // (multicentre points after the atoms they stand for)
  const atoms = [...src.atoms.values()];
  for (const a of [...atoms.filter((x) => !x.multi), ...atoms.filter((x) => x.multi)]) {
    const { id, ...rest } = structuredClone(a);
    if (rest.multi) rest.multi = rest.multi.map((m) => ids.get(m)).filter((m): m is number => m !== undefined);
    const p = map(a);
    ids.set(id, doc.addAtom(p.x, p.y, a.z, { ...rest, x: p.x, y: p.y }).id);
  }
  for (const b of src.bonds.values()) {
    const a1 = ids.get(b.a1), a2 = ids.get(b.a2);
    if (a1 === undefined || a2 === undefined) continue;
    const { id: _id, ...rest } = structuredClone(b);
    doc.addBond(a1, a2, b.order, b.display, { ...rest, a1, a2 });
  }
  for (const c of src.captions.values()) {
    const { id: _id, ...rest } = structuredClone(c);
    const p = map(c);
    doc.addCaption({ ...rest, x: p.x, y: p.y });
  }
  for (const r of src.arrows.values()) {
    const { id: _id, ...rest } = structuredClone(r);
    doc.addArrow({ ...rest, tail: map(r.tail), head: map(r.head) });
  }
  for (const s of src.shapes.values()) {
    const { id: _id, ...rest } = structuredClone(s);
    const a = map({ x: s.x1, y: s.y1 }), b = map({ x: s.x2, y: s.y2 });
    doc.addShape({ ...rest, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
}

/** Read a PowerPoint file. Throws only when the file is not a PowerPoint file at all. */
/** LaTeX as it comes back from the Office Math written for it (to tell whether PowerPoint has changed an equation). */
function texOfOmml(tex: string): string {
  const doc = new DOMParser().parseFromString(`<m:oMath xmlns:m="${NS_M}">${toOmml(tex)}</m:oMath>`, 'application/xml');
  return ommlToTex(doc.documentElement);
}

export function readPptx(bytes: Uint8Array): PptxRead {
  return new Reader(bytes).read();
}

/** The names PowerPoint (and this program) give shapes on their own: "Picture 3", "TextBox 12". */
const PPT_NAME = /^(Picture|Rectangle|Oval|Line|TextBox|Text Box|Title|Text Placeholder|Content Placeholder|Subtitle|Table|Chart|Equation|Animation|Straight Connector|Straight Arrow Connector|Elbow Connector|Curved Arrow|Connector|Freeform|Group|Diagram|Structure|Highlight|Graphic|Object|Shape|Google Shape|Footer|Slide Number|Date|Rounded Rectangle|Ellipse|Isosceles Triangle|Right Arrow|Arrow)( Placeholder)? \d+$/i;

/** Everything added to a drawing since `mark` turned `deg` degrees clockwise about `c`, text and shapes included. */
function turnNew(doc: Doc, mark: number, c: Vec, deg: number): void {
  const ids = <T extends { id: number }>(m: Map<number, T>) => new Set([...m.values()].filter((x) => x.id >= mark).map((x) => x.id));
  const sel = { atoms: ids(doc.atoms), bonds: ids(doc.bonds), captions: ids(doc.captions), arrows: ids(doc.arrows), shapes: ids(doc.shapes) };
  const snap = snapshot(doc, sel, POINTS);
  transform(doc, snap, rotation(c, deg * DEG), false, { deg, which: () => true, shapes: true });
}

/** A shape's turn as ours keeps it (left out when it isn't turned). */
function turn(box: { rot: number }): { rot?: number } {
  const rot = normDegrees(box.rot);
  return Math.abs(rot) > 1e-6 ? { rot } : {};
}

/** A PowerPoint text box turned in its box: the text starts where the turn takes its first line. */
function turned(c: Omit<Caption, 'id'> | null, box: Rect & { rot: number }): Omit<Caption, 'id'> | null {
  const rot = normDegrees(box.rot);
  if (!c || !rot) return c;
  const a = turnAbout(c, { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 }, rot);
  return { ...c, x: a.x, y: a.y, rot };
}

/** PowerPoint 2010's sections (p14:sectionLst in presentation.xml), as runs of slides in order. */
function readSections(root: Element, sldIds: string[]): SectionCount[] | undefined {
  const lst = Array.from(root.getElementsByTagNameNS('*', 'sectionLst'))[0];
  if (!lst) return undefined;
  const at = new Map(sldIds.map((id, i) => [id, i]));
  const out: SectionCount[] = [];
  for (const sec of kids(lst, 'section')) {
    const ids = kids(kid(sec, 'sldIdLst'), 'sldId').map((x) => at.get(x.getAttribute('id') ?? '')).filter((i): i is number => i !== undefined);
    out.push({ name: sec.getAttribute('name') ?? 'Untitled Section', count: ids.length });
  }
  return out.length ? out : undefined;
}
