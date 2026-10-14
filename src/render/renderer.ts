// Canvas renderer in ChemDraw's ACS 1996 style.
//
// Two stacked canvases: the scene (the document) and an overlay (hover, selection, the
// bond or ring being drawn). Hovering and drawing only repaint the overlay, so they stay
// fast however big the document is. Label layouts and bond geometry are cached per atom
// and bond and only recomputed near what changed.

import { Doc, Atom, Bond, Arrow, Caption, Shape, applyBase, enhancedText, CHIRAL_FLAGS, flagTextSize, type TextBase } from '../model';
import { isCircleRing, ringCircle, ringsThroughBond } from '../chem/aromatic';
import { crossingGaps } from '../chem/crossing';
import { FADE, tint } from '../colours';
import { Vec, Rect, sub, add, mul, norm, perp, len, dot, exitParam, angleOf, arcCenter, fromAngle } from '../geom';
import { doubleBondGap, wedgeWidth } from '../style';
import { labelSpec, layoutLabel, LabelLayout } from '../chem/labels';
import type { StructureChecks } from '../chem/warnings';
import { isGenericLabel } from '../chem/labels';
import { bracketPath, shaftOffset, type PathStep } from '../objects';
import { atomStereoText, bondStereoText, StereoPlacer, PlacedLabel } from '../chem/stereo';
import { arialWidth } from '../text-metrics';
import { attachDiamondSize, hasAttachDiamond } from './atom-marks';
import { layoutText, FONT_STACK, type TextLayout } from '../text/layout';
import { drawLayout } from '../text/draw';
import { placeholderRect, isEmptyText } from '../deck/deck';
import { imageFor } from './images';
import { layoutTable, drawTable, type TableLayout, type TablePart } from '../table';
import type { TableData } from '../model';

export { FONT_STACK };

/** Colour of the stereo labels previewed with "Show R/S" (not part of the drawing). */
const PREVIEW_COLOR = '#b4232a';


/** Something drawn under the drawing in document coordinates, such as a slide and its master. */
export interface PageDecor {
  draw(ctx: CanvasRenderingContext2D): void;
}

/** Words shown in an empty placeholder on screen. */
const PROMPTS = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text' };

/** Something that can record a picture instead of drawing it (the vector recorder). */
interface PictureSink { picture(s: Shape): void }

export interface View {
  /** Screen pixels per point. */
  scale: number;
  /** Screen position (CSS px) of document point (0,0). */
  ox: number;
  oy: number;
}

interface AtomCache {
  layout: LabelLayout | null;
  /** Knock-out boxes in document coordinates, already grown by the margin. */
  boxes: Rect[];
}

interface BondCache {
  /** Side for the second line of a double bond: +1 / −1 along the left normal, 0 = centred. */
  side: number;
  /** Interior angles at each end on the double-bond side (for trimming the inner line). */
  trim1: number;
  trim2: number;
  /** An aromatic bond drawn with a circle: the circles of the rings it is in. */
  circles?: { center: Vec; radius: number }[];
}

let mctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

export type TextMeasure = (text: string, size: number, font: string, style: string) => number;

/** Width with the fonts on this computer (measured once at 100 px for precision). */
const screenMeasure: TextMeasure = (text, size, font, style) => {
  const key = style + '|' + font + '|' + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    mctx ??= (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8).getContext('2d') : document.createElement('canvas').getContext('2d'))!;
    mctx.font = `${style} 100px ${font}`;
    w = mctx.measureText(text).width / 100;
    widthCache.set(key, w);
  }
  return w * size;
};
let measureImpl = screenMeasure;

/** Width in points of `text` at `size` points. */
export function measureText(text: string, size: number, font = FONT_STACK, style = ''): number {
  return measureImpl(text, size, font, style);
}

/** Run `fn` with another way of measuring text (pictures use Arial's published widths). */
export function withMeasure<T>(m: TextMeasure, fn: () => T): T {
  const old = measureImpl;
  measureImpl = m;
  try { return fn(); } finally { measureImpl = old; }
}

export class Renderer {
  view: View = { scale: 2, ox: 40, oy: 40 };
  dpr = 1;
  width = 0;
  height = 0;
  showWarnings = true;
  /** The drawing's chemistry warnings, drawn as red boxes when `showWarnings` is on. */
  checks: StructureChecks | null = null;
  /** Makes the paths bonds are collected in (pictures record them instead of drawing). */
  makePath: () => Path2D = () => new Path2D();
  /** Last scene paint time in ms (for the speed readout). */
  lastSceneMs = 0;
  /** Drawing on screen for editing: empty placeholders show their prompts. */
  screen = false;
  /** Drawn under everything (a slide and its master). */
  page: PageDecor | null = null;
  /** Placeholder text formatting of the document being drawn. */
  private textStyles: Doc['textStyles'] = null;

  private sctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  /** Show every R/S and E/Z label the chemistry engine found, in red (a preview; not printed). */
  previewStereo = false;
  private placer: StereoPlacer | null = null;
  private placerDoc: Doc | null = null;
  private placerKey = '';
  private atomCache = new Map<number, AtomCache>();
  private capBoxes = new WeakMap<Caption, Rect>();
  private capLayouts = new WeakMap<Caption, TextLayout>();
  /** Text size for caption runs that don't give one (the document's caption size). */
  private captionSize = 10;
  /** A caption being typed into: the text box shows it, so the page doesn't. */
  hiddenCaption: number | null = null;
  /** A table being typed into: drawn as this draft (so rows grow as the text does), without the part the text editor shows. */
  tableEdit: { id: number; table: TableData; part: TablePart } | null = null;
  private tableLayouts = new WeakMap<TableData, TableLayout>();
  private tiles = new Map<string, Tile>();
  private stale: { tiles: Map<string, Tile>; scale: number } | null = null;
  private tileScale = 0;
  private tileDpr = 0;
  private tileBg = '';
  private freeCanvases: (OffscreenCanvas | HTMLCanvasElement)[] = [];
  private shapeList: Shape[] | null = null;
  private shapeVersion = -1;
  /** True when some tiles still need painting (the caller should ask for another frame). */
  incomplete = false;
  private bondCache = new Map<number, BondCache>();

  constructor(public scene: HTMLCanvasElement, public overlay: HTMLCanvasElement) {
    this.sctx = scene.getContext('2d', { alpha: false })!;
    this.octx = overlay.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.width = w; this.height = h; this.dpr = dpr;
    for (const c of [this.scene, this.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
  }

  toDoc(sx: number, sy: number): Vec {
    return { x: (sx - this.view.ox) / this.view.scale, y: (sy - this.view.oy) / this.view.scale };
  }

  toScreen(p: Vec): Vec {
    return { x: p.x * this.view.scale + this.view.ox, y: p.y * this.view.scale + this.view.oy };
  }

  visibleRect(pad = 20): Rect {
    const a = this.toDoc(0, 0), b = this.toDoc(this.width, this.height);
    return { x1: a.x - pad, y1: a.y - pad, x2: b.x + pad, y2: b.y + pad };
  }

  // ------------------------------------------------------------------ caches

  /**
   * Drop cached layout and painted tiles near anything that changed since the last paint. Also
   * called before measuring between paints (an undo and a new layout in one go), so label sizes
   * are never those of where atoms used to be.
   */
  invalidate(doc: Doc): void {
    const warned = this.checks?.update();
    if (warned?.length && this.showWarnings && !doc.allDirty) {
      // warnings that came or went (including on atoms the edit itself didn't touch)
      for (const id of warned) {
        const a = doc.atoms.get(id);
        if (!a) continue;
        doc.dirtyRects.push({ x1: a.x, y1: a.y, x2: a.x, y2: a.y });
        for (const n of doc.neighbors(id)) doc.dirtyRects.push({ x1: Math.min(a.x, n.x), y1: Math.min(a.y, n.y), x2: Math.max(a.x, n.x), y2: Math.max(a.y, n.y) });
      }
    }
    if (doc.allDirty || doc.dirtyRects.length > 20000) {
      this.atomCache.clear();
      this.bondCache.clear();
      this.dropAllTiles();
      doc.allDirty = false;
      doc.dirtyAtoms.clear();
      doc.dirtyBonds.clear();
      doc.dirtyRects.length = 0;
      doc.dirtyCaptions.length = 0;
      return;
    }
    const rects: Rect[] = doc.dirtyRects.splice(0);
    for (const c of doc.dirtyCaptions.splice(0)) rects.push(this.captionBox(c));
    if (doc.dirtyAtoms.size || doc.dirtyBonds.size) {
      // Labels depend on neighbours; double-bond sides depend on rings up to 8 atoms,
      // so clear everything within 4 bonds of a change.
      let frontier = [...doc.dirtyAtoms];
      const seen = new Set(frontier);
      for (let d = 0; d < 4 && frontier.length; d++) {
        const next: number[] = [];
        for (const id of frontier) {
          for (const bid of doc.adj.get(id) ?? []) {
            this.bondCache.delete(bid);
            const b = doc.bonds.get(bid);
            if (!b) continue;
            const o = b.a1 === id ? b.a2 : b.a1;
            if (!seen.has(o)) { seen.add(o); next.push(o); }
          }
        }
        frontier = next;
      }
      for (const id of seen) {
        this.atomCache.delete(id);
        const a = doc.atoms.get(id);
        if (a) rects.push({ x1: a.x, y1: a.y, x2: a.x, y2: a.y });
      }
      for (const id of doc.dirtyBonds) this.bondCache.delete(id);
      doc.dirtyAtoms.clear();
      doc.dirtyBonds.clear();
    }
    if (rects.length) this.dropTiles(doc, rects);
  }

  atomInfo(doc: Doc, a: Atom): AtomCache {
    let c = this.atomCache.get(a.id);
    if (c) return c;
    const deg = doc.degree(a.id);
    const bos = doc.valenceSum(a.id);
    const spec = a.attach ? null : labelSpec(a.z, a.label, a.charge, a.isotope, bos, deg, !a.hideCharge, !!a.showCarbon);
    let layout: LabelLayout | null = null;
    const boxes: Rect[] = [];
    const k = a.s ?? 1;
    const size = doc.style.labelSize * k;
    if (spec) {
      if (a.supDigits) spec.supDigits = true;
      const dirs = doc.neighbors(a.id).map((n) => norm(sub(n, a)));
      layout = layoutLabel(spec, dirs, size, (t, s) => measureText(t, s), a.just);
      const m = doc.style.marginWidth * k;
      for (const b of layout.boxes) boxes.push({ x1: a.x + b.x1 - m, y1: a.y + b.y1 - m, x2: a.x + b.x2 + m, y2: a.y + b.y2 + m });
    }
    c = { layout, boxes };
    this.atomCache.set(a.id, c);
    return c;
  }

  private bondInfo(doc: Doc, b: Bond): BondCache {
    let c = this.bondCache.get(b.id);
    if (c) return c;
    c = { side: 0, trim1: 0, trim2: 0 };
    if (b.order === 1.5 && b.circle) {
      c.circles = ringsThroughBond(doc, b.id).filter((r) => isCircleRing(doc, r)).map((r) => ringCircle(doc, r));
    } else if (b.order === 2 || b.order === 1.5) {
      const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
      const dir = norm(sub(q, p));
      const nrm = perp(dir);
      let side = 0;
      // perp() points to the right of a1→a2 on screen (y runs down)
      if (b.dpos === 'right') side = 1;
      else if (b.dpos === 'left') side = -1;
      else if (b.dpos === 'center') side = 0;
      else {
        const ring = doc.ringThroughBond(b.id);
        if (ring) {
          let cx = 0, cy = 0;
          for (const id of ring) { const a = doc.atoms.get(id)!; cx += a.x; cy += a.y; }
          const cen = { x: cx / ring.length, y: cy / ring.length };
          side = dot(sub(cen, p), nrm) >= 0 ? 1 : -1;
        } else {
          // Outside rings: centred if an end is terminal (C=O, C=CH2), otherwise on the
          // side with more substituents.
          const n1 = doc.neighbors(p.id).filter((x) => x.id !== q.id);
          const n2 = doc.neighbors(q.id).filter((x) => x.id !== p.id);
          if (n1.length === 0 || n2.length === 0) {
            const lab1 = this.atomInfo(doc, p).layout, lab2 = this.atomInfo(doc, q).layout;
            const others = [...n1, ...n2];
            if ((lab1 || lab2 || others.length !== 1) && !(n1.length === 0 && n2.length === 0 && false)) side = 0;
            else {
              // e.g. vinyl CH=CH2 with no labels: offset toward the substituent
              let s = 0;
              for (const o of others) s += Math.sign(dot(sub(o, p), nrm));
              side = s >= 0 ? 1 : -1;
            }
            if (others.length === 0) side = 0;
          } else {
            let s = 0;
            for (const o of [...n1, ...n2]) s += Math.sign(dot(sub(o, p), nrm));
            side = s === 0 ? 1 : Math.sign(s);
          }
        }
      }
      c.side = side;
      if (side !== 0) {
        c.trim1 = this.trimAt(doc, p, q, side);
        c.trim2 = this.trimAt(doc, q, p, -side);
      }
    }
    this.bondCache.set(b.id, c);
    return c;
  }

  /** How far to pull back the inner line of a double bond at atom `at` (fraction of the gap). */
  private trimAt(doc: Doc, at: Atom, other: Atom, side: number): number {
    const dir = norm(sub(other, at));
    const nrm = mul(perp(dir), side);
    let best = 0;
    for (const n of doc.neighbors(at.id)) {
      if (n.id === other.id) continue;
      const d = norm(sub(n, at));
      if (dot(d, nrm) <= 0) continue;
      // interior angle between the bond and this neighbour
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(d, dir))));
      const t = 1 / Math.tan(ang / 2);
      if (t > best) best = t;
    }
    return best;
  }

  // ------------------------------------------------------------------ scene

  /**
   * Paint the document. The page is cut into tiles that are painted once and then reused
   * while scrolling; an edit repaints only the tiles it touches. After a zoom, the old tiles
   * are shown stretched until new ones are ready, painting as many per frame as fit in
   * `budgetMs` (the rest follow on the next frames; `incomplete` says so).
   */
  renderScene(doc: Doc, budgetMs = Infinity): void {
    const t0 = performance.now();
    this.useStyle(doc);
    this.invalidate(doc);
    const ctx = this.sctx;
    const { scale } = this.view;
    const dpr = this.dpr;
    // Keep tiles on whole device pixels so they line up without blurring.
    this.view.ox = Math.round(this.view.ox * dpr) / dpr;
    this.view.oy = Math.round(this.view.oy * dpr) / dpr;
    const { ox, oy } = this.view;
    if (scale !== this.tileScale || dpr !== this.tileDpr || doc.background !== this.tileBg) {
      if (this.tiles.size && dpr === this.tileDpr && doc.background === this.tileBg) {
        // keep the old tiles as stretched placeholders while new ones are painted
        if (!this.stale || this.tiles.size >= this.stale.tiles.size / 2) this.stale = { tiles: this.tiles, scale: this.tileScale };
      } else this.stale = null;
      this.tiles = new Map();
      this.tileScale = scale;
      this.tileDpr = dpr;
      this.tileBg = doc.background;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, this.width, this.height);
    const T = TILE;
    const tx0 = Math.floor(-ox / T), tx1 = Math.floor((this.width - ox) / T);
    const ty0 = Math.floor(-oy / T), ty1 = Math.floor((this.height - oy) / T);
    // stale placeholders first
    let missing = false;
    const need: [number, number][] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!this.tiles.has(tx + ',' + ty)) need.push([tx, ty]);
    if (need.length && this.stale && budgetMs !== Infinity) {
      const k = scale / this.stale.scale;
      ctx.imageSmoothingEnabled = true;
      for (const t of this.stale.tiles.values()) {
        const x = t.tx * T * k + ox, y = t.ty * T * k + oy, w = T * k;
        if (x + w < 0 || y + w < 0 || x > this.width || y > this.height) continue;
        ctx.drawImage(t.canvas, x, y, w, w);
      }
    }
    // paint missing tiles, nearest the middle first
    const cx = (tx0 + tx1) / 2, cy = (ty0 + ty1) / 2;
    need.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    for (const [tx, ty] of need) {
      if (performance.now() - t0 > budgetMs) { missing = true; break; }
      this.tiles.set(tx + ',' + ty, this.paintTile(doc, tx, ty));
    }
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.tiles.get(tx + ',' + ty);
        if (t) ctx.drawImage(t.canvas, tx * T + ox, ty * T + oy, T, T);
      }
    }
    if (!missing) this.stale = null;
    this.incomplete = missing;
    this.pruneTiles(tx0, tx1, ty0, ty1);
    this.lastSceneMs = performance.now() - t0;
  }

  private paintTile(doc: Doc, tx: number, ty: number): Tile {
    const T = TILE, dpr = this.dpr, scale = this.view.scale;
    const px = Math.round(T * dpr);
    const canvas = this.freeCanvases.pop() ?? (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(px, px) : Object.assign(document.createElement('canvas'), { width: px, height: px }));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, px, px);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -tx * T * dpr, -ty * T * dpr);
    const x1 = (tx * T) / scale, y1 = (ty * T) / scale;
    const pad = this.pad(doc);
    this.page?.draw(ctx);
    this.drawContent(ctx, doc, { x1: x1 - pad, y1: y1 - pad, x2: x1 + T / scale + pad, y2: y1 + T / scale + pad });
    return { canvas, tx, ty };
  }

  /** How far outside a tile an object can sit and still reach into it. */
  private pad(doc: Doc): number {
    const st = doc.style;
    return Math.max(doc.maxBondLength, 2 * st.bondLength, 8 * st.labelSize) + 4;
  }

  private dropTiles(doc: Doc, rects: Rect[]): void {
    this.stale = null;
    if (!this.tiles.size) return;
    const T = TILE, s = this.tileScale;
    const pad = this.pad(doc);
    for (const r of rects) {
      const tx0 = Math.floor(((r.x1 - pad) * s) / T), tx1 = Math.floor(((r.x2 + pad) * s) / T);
      const ty0 = Math.floor(((r.y1 - pad) * s) / T), ty1 = Math.floor(((r.y2 + pad) * s) / T);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const key = tx + ',' + ty;
          const t = this.tiles.get(key);
          if (t) { this.freeCanvases.push(t.canvas); this.tiles.delete(key); }
        }
      }
    }
  }

  private dropAllTiles(): void {
    for (const t of this.tiles.values()) this.freeCanvases.push(t.canvas);
    this.tiles.clear();
    this.stale = null;
    if (this.freeCanvases.length > 64) this.freeCanvases.length = 64;
  }

  /** Keep the tile cache to a sensible size by forgetting tiles far off screen. */
  private pruneTiles(tx0: number, tx1: number, ty0: number, ty1: number): void {
    if (this.tiles.size <= MAX_TILES) return;
    const m = 4;
    for (const [key, t] of this.tiles) {
      if (t.tx < tx0 - m || t.tx > tx1 + m || t.ty < ty0 - m || t.ty > ty1 + m) {
        this.tiles.delete(key);
        if (this.freeCanvases.length < 64) this.freeCanvases.push(t.canvas);
      }
    }
  }

  /** Forget all painted tiles (after changing how things are drawn, e.g. warnings on/off). */
  repaintAll(): void {
    this.dropAllTiles();
  }

  /**
   * R/S labels beside atoms and E/Z labels by double bonds: those that are part of the drawing
   * (shown in black, saved and printed), and with `previewStereo` on, every other one in red
   * (on screen only).
   */
  private drawStereoLabels(ctx: CanvasRenderingContext2D, doc: Doc, atoms: Atom[], bonds: Set<Bond>, curFont: string): string {
    const info = doc.stereo;
    const place = this.stereoPlacer(doc);
    const draw = (text: string, p: PlacedLabel, color: string) => {
      const f = `${p.italic ? 'italic ' : ''}${p.size}px ${FONT_STACK}`;
      if (f !== curFont) { ctx.font = f; curFont = f; }
      ctx.fillStyle = color;
      ctx.fillText(text, p.x, p.y);
    };
    for (const a of atoms) {
      if (a.attach) continue;
      const text = atomStereoText(a, info);
      if (text) draw(text, place.atom(a, text), '#000');
      else if (this.previewStereo && !a.showStereo && !a.stereoLabel) {
        const d = info?.atom(a.id);
        if (d) { const t = `(${d})`; draw(t, place.atom(a, t), PREVIEW_COLOR); }
      }
      if (a.enhStereo) { const t = enhancedText(a.enhStereo); draw(t, place.enhanced(a, t), a.color ?? '#000'); }
    }
    for (const b of bonds) {
      if (b.order !== 2 && !b.stereoLabel) continue;
      const text = bondStereoText(b, info);
      if (text) draw(text, place.bond(b, text), '#000');
      else if (this.previewStereo && !b.showStereo && !b.stereoLabel) {
        const d = info?.bond(b.id);
        if (d) { const t = `(${d})`; draw(t, place.bond(b, t), PREVIEW_COLOR); }
      }
    }
    return curFont;
  }

  /** The atom number shown with the ' key, on the open side of the atom or its label. */
  private drawAtomNumber(ctx: CanvasRenderingContext2D, doc: Doc, a: Atom, curFont: string): string {
    const p = this.stereoPlacer(doc).number(a);
    const f = `${p.size}px ${FONT_STACK}`;
    if (f !== curFont) { ctx.font = f; curFont = f; }
    ctx.fillStyle = a.color ?? '#000';
    ctx.fillText(a.atomNumber!, p.x, p.y);
    return curFont;
  }

  /** A numbered point of attachment: a black diamond with the number in white. */
  private drawAttachDiamond(ctx: CanvasRenderingContext2D, doc: Doc, a: Atom, curFont: string): string {
    const L = doc.style.labelSize * (a.s ?? 1);
    const h = attachDiamondSize(L);
    ctx.fillStyle = a.color ?? '#000';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - h);
    ctx.lineTo(a.x + h, a.y);
    ctx.lineTo(a.x, a.y + h);
    ctx.lineTo(a.x - h, a.y);
    ctx.closePath();
    ctx.fill();
    const text = String(a.attachNum);
    const size = 0.75 * L;
    const f = `${size}px ${FONT_STACK}`;
    if (f !== curFont) { ctx.font = f; curFont = f; }
    ctx.fillStyle = '#fff';
    ctx.fillText(text, a.x - measureText(text, size) / 2, a.y + 0.716 * size / 2);
    ctx.fillStyle = '#000';
    return curFont;
  }

  /**
   * Spots for stereo labels, kept until the drawing or its labels change. They are worked out
   * with Arial's published widths, as when saving, so a label sits in the file where it was seen.
   */
  private stereoPlacer(doc: Doc): StereoPlacer {
    const key = `${doc.version}|${doc.stereo?.version ?? 0}|${this.previewStereo}`;
    if (!this.placer || this.placerDoc !== doc || this.placerKey !== key) {
      this.placer = new StereoPlacer(doc, arialWidth, { preview: this.previewStereo });
      this.placerDoc = doc;
      this.placerKey = key;
    }
    return this.placer;
  }

  private sortedShapes(doc: Doc): Shape[] {
    if (this.shapeVersion !== doc.version || !this.shapeList) {
      this.shapeList = [...doc.shapes.values()].sort((a, b) => (b.filled ? 1 : 0) - (a.filled ? 1 : 0) || (a.z ?? 0) - (b.z ?? 0));
      this.shapeVersion = doc.version;
    }
    return this.shapeList;
  }

  /** Draw the whole drawing into another context (for pictures), in document coordinates. */
  drawDocument(ctx: CanvasRenderingContext2D, doc: Doc): void {
    const b = doc.bounds();
    if (!b) return;
    const pad = this.pad(doc);
    this.drawContent(ctx, doc, { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad });
  }

  /** Draw everything that falls inside `vis` (document coordinates) with the current transform. */
  private drawContent(ctx: CanvasRenderingContext2D, doc: Doc, vis: Rect): void {
    this.useStyle(doc);
    const st = doc.style;

    // Shapes behind the structures (filled boxes first).
    for (const s of this.sortedShapes(doc)) {
      const b = s.kind === 'table' ? this.tableBox(s) : { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
      if (b.x2 < vis.x1 || b.x1 > vis.x2 || b.y2 < vis.y1 || b.y1 > vis.y2) continue;
      this.drawShape(ctx, s, st.lineWidth);
    }

    // Only atoms near this area, and their bonds (found through the spatial index).
    const atoms = doc.atomsIn(vis);
    const bondSet = new Set<Bond>();
    for (const a of atoms) for (const bid of doc.adj.get(a.id) ?? []) bondSet.add(doc.bonds.get(bid)!);

    // Bonds, batched by how they are stroked (and by size, for resized structures).
    const batches = new Map<number, BondBatch>();
    const colored: Bond[] = [];
    for (const b of bondSet) {
      const p = doc.atoms.get(b.a1), q = doc.atoms.get(b.a2);
      if (!p || !q) continue;
      if ((p.x < vis.x1 && q.x < vis.x1) || (p.x > vis.x2 && q.x > vis.x2) || (p.y < vis.y1 && q.y < vis.y1) || (p.y > vis.y2 && q.y > vis.y2)) continue;
      if (b.color) { colored.push(b); continue; }
      const k = b.s ?? 1;
      let bb = batches.get(k);
      if (!bb) { bb = newBatch(this.makePath); batches.set(k, bb); }
      this.bondPaths(doc, b, p, q, bb);
    }
    for (const [k, bb] of batches) this.strokeBatch(ctx, bb, k, st.lineWidth, st.boldWidth, '#000');
    for (const b of colored) {
      const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
      const bb = newBatch(this.makePath);
      this.bondPaths(doc, b, p, q, bb);
      this.strokeBatch(ctx, bb, b.s ?? 1, st.lineWidth, st.boldWidth, b.color!);
    }
    ctx.strokeStyle = ctx.fillStyle = '#000';

    // Atom labels and warnings.
    const warns: Rect[] = [];
    const checks = this.showWarnings ? this.checks : null;
    if (checks) {
      for (const b of bondSet) {
        if (!checks.forBond(b)) continue;
        const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
        const m = 2;
        warns.push({ x1: Math.min(p.x, q.x) - m, y1: Math.min(p.y, q.y) - m, x2: Math.max(p.x, q.x) + m, y2: Math.max(p.y, q.y) + m });
      }
    }
    let curFont = '';
    ctx.textBaseline = 'alphabetic';
    for (const a of atoms) {
      const info = this.atomInfo(doc, a);
      if (info.layout) {
        ctx.fillStyle = a.color ?? '#000';
        for (const r of info.layout.runs) {
          const f = `${r.size}px ${FONT_STACK}`;
          if (f !== curFont) { ctx.font = f; curFont = f; }
          ctx.fillText(r.text, a.x + r.dx, a.y + r.dy);
        }
      } else if (a.charge && a.z === 6 && !a.hideCharge, !!a.showCarbon) {
        this.drawCarbonCharge(ctx, doc, a);
      }
      if (a.showNumber && a.atomNumber) curFont = this.drawAtomNumber(ctx, doc, a, curFont);
      if (hasAttachDiamond(a)) curFont = this.drawAttachDiamond(ctx, doc, a, curFont);
      if (checks?.forAtom(a)) warns.push(this.warningBox(doc, a, info));
    }
    curFont = this.drawStereoLabels(ctx, doc, atoms, bondSet, curFont);
    ctx.fillStyle = '#000';

    for (const r of doc.arrows.values()) {
      const lo = Math.min(r.tail.x, r.head.x), hi = Math.max(r.tail.x, r.head.x);
      const top = Math.min(r.tail.y, r.head.y), bot = Math.max(r.tail.y, r.head.y);
      const pad = r.sweep ? Math.hypot(hi - lo, bot - top) : 10;
      if (hi + pad < vis.x1 || lo - pad > vis.x2 || bot + pad < vis.y1 || top - pad > vis.y2) continue;
      this.drawArrow(ctx, r, r.lineWidth ?? st.lineWidth);
    }
    for (const c of doc.captions.values()) {
      if (c.id === this.hiddenCaption) continue;
      const r = this.captionBox(c);
      if (r.x1 > vis.x2 || r.x2 < vis.x1 || r.y1 > vis.y2 || r.y2 < vis.y1) continue;
      if (c.ph && isEmptyText(c)) { if (this.screen) this.drawPrompt(ctx, c); continue; }
      this.drawCaption(ctx, c);
    }

    if (warns.length) {
      ctx.strokeStyle = WARN_COLOR;
      ctx.lineWidth = 0.5;
      for (const w of warns) ctx.strokeRect(w.x1, w.y1, w.x2 - w.x1, w.y2 - w.y1);
    }
  }

  /** The red box around an atom with a warning: around its whole label, or a small square on a bare carbon. */
  warningBox(doc: Doc, a: Atom, info = this.atomInfo(doc, a)): Rect {
    if (!info.boxes.length) {
      const h = doc.style.labelSize * (a.s ?? 1) * 0.45;
      return { x1: a.x - h, y1: a.y - h, x2: a.x + h, y2: a.y + h };
    }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const b of info.boxes) { x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
    return { x1, y1, x2, y2 };
  }

  private strokeBatch(ctx: CanvasRenderingContext2D, bb: BondBatch, k: number, lw: number, bw: number, color: string): void {
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lw * k;
    ctx.stroke(bb.thin);
    ctx.fill(bb.fills);
    ctx.lineCap = 'butt';
    ctx.lineWidth = bw * k;
    ctx.stroke(bb.bold);
    ctx.lineWidth = lw * k;
    ctx.setLineDash([lw * k * 2.2, lw * k * 2.2]);
    ctx.stroke(bb.dashed);
    ctx.setLineDash([]);
  }

  /** Bond end points after stopping at atom labels. */
  bondEnds(doc: Doc, p: Atom, q: Atom): [Vec, Vec] {
    const ip = this.atomInfo(doc, p), iq = this.atomInfo(doc, q);
    let t1 = 0, t2 = 0;
    for (const r of ip.boxes) t1 = Math.max(t1, exitParam(p, q, r));
    for (const r of iq.boxes) t2 = Math.max(t2, exitParam(q, p, r));
    if (t1 + t2 >= 0.95) { t1 = Math.min(t1, 0.45); t2 = Math.min(t2, 0.45); }
    const d = sub(q, p);
    return [add(p, mul(d, t1)), sub(q, mul(d, t2))];
  }

  private bondPaths(doc: Doc, b: Bond, p: Atom, q: Atom, bb: BondBatch): void {
    const { thin, bold, dashed, fills } = bb;
    const k = b.s ?? 1;
    const ds = doc.style;
    const st = { ...ds, lineWidth: ds.lineWidth * k, boldWidth: ds.boldWidth * k, hashSpacing: ds.hashSpacing * k, bondLength: ds.bondLength * k };
    const [s, e] = this.bondEnds(doc, p, q);
    const d = sub(e, s);
    const l = len(d);
    if (l < 0.01) return;
    const dir = mul(d, 1 / l);
    const nrm = perp(dir);
    const gap = doubleBondGap(st);
    // a bond behind a bond that crosses it has a gap there
    const gaps = crossingGaps(doc, b, ds.marginWidth * k + ds.lineWidth);
    const pq = sub(q, p), pq2 = dot(pq, pq) || 1;
    const along = (x: Vec) => dot(sub(x, p), pq) / pq2;
    const line = (path: Path2D, a: Vec, c: Vec) => {
      if (!gaps.length) { path.moveTo(a.x, a.y); path.lineTo(c.x, c.y); return; }
      const fa = along(a), fc = along(c);
      if (Math.abs(fc - fa) < 1e-6) {
        // across the bond (a hash): left out if it falls in a gap
        if (!gaps.some(([g0, g1]) => fa > g0 && fa < g1)) { path.moveTo(a.x, a.y); path.lineTo(c.x, c.y); }
        return;
      }
      let from = 0;
      const at = (t: number) => add(a, mul(sub(c, a), t));
      for (const [g0, g1] of gaps) {
        let t0 = (g0 - fa) / (fc - fa), t1 = (g1 - fa) / (fc - fa);
        if (t0 > t1) [t0, t1] = [t1, t0];
        if (t1 <= from || t0 >= 1) continue;
        if (t0 > from) { const u = at(from), v = at(t0); path.moveTo(u.x, u.y); path.lineTo(v.x, v.y); }
        from = Math.max(from, t1);
      }
      if (from < 1) { const u = at(from); path.moveTo(u.x, u.y); path.lineTo(c.x, c.y); }
    };
    // a point of attachment: a wavy line across the end of the bond
    if (p.attach === 'Wavy') attachWave(thin, p, nrm, st.bondLength);
    if (q.attach === 'Wavy') attachWave(thin, q, nrm, st.bondLength);

    // an aromatic ring drawn with a circle: a plain line, and the stretch of each ring's circle
    // that faces this bond
    if (b.order === 1.5 && b.circle) {
      line(b.display === 'bold' ? bold : thin, s, e);
      for (const { center, radius } of this.bondInfo(doc, b).circles ?? []) {
        const a1 = angleOf(sub(p, center)), a2 = angleOf(sub(q, center));
        let da = a2 - a1;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const from = add(center, { x: Math.cos(a1) * radius, y: Math.sin(a1) * radius });
        thin.moveTo(from.x, from.y);
        thin.arc(center.x, center.y, radius, a1, a1 + da, da < 0);
      }
      return;
    }

    if (b.order === 4 && b.display !== 'dative') {
      // four lines, evenly spaced about the bond
      for (const k of [-1.5, -0.5, 0.5, 1.5]) line(thin, add(s, mul(nrm, gap * k)), add(e, mul(nrm, gap * k)));
      return;
    }

    if (b.order === 1 || b.display === 'dative') {
      switch (b.display) {
        case 'solid': line(thin, s, e); break;
        case 'dative': {
          // a line with a filled head at the acceptor (a2)
          const hl = Math.min(l * 0.45, st.lineWidth * 8), hw = st.lineWidth * 2.2;
          const base = sub(e, mul(dir, hl));
          line(thin, s, add(base, mul(dir, hl * 0.3)));
          fills.moveTo(e.x, e.y);
          fills.lineTo(base.x + nrm.x * hw, base.y + nrm.y * hw);
          fills.lineTo(base.x - nrm.x * hw, base.y - nrm.y * hw);
          fills.closePath();
          break;
        }
        case 'bold': line(bold, s, e); break;
        case 'dash': line(dashed, s, e); break;
        case 'wedge': {
          // narrow at a1, wide at a2
          const w = wedgeWidth(st) / 2;
          const ww = st.lineWidth / 2;
          fills.moveTo(s.x + nrm.x * ww, s.y + nrm.y * ww);
          fills.lineTo(e.x + nrm.x * w, e.y + nrm.y * w);
          fills.lineTo(e.x - nrm.x * w, e.y - nrm.y * w);
          fills.lineTo(s.x - nrm.x * ww, s.y - nrm.y * ww);
          fills.closePath();
          break;
        }
        case 'hashWedge': {
          const w = wedgeWidth(st) / 2;
          const n = Math.max(2, Math.floor(l / st.hashSpacing));
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const c = add(s, mul(d, t));
            const hw = st.lineWidth / 2 + (w - st.lineWidth / 2) * t;
            line(thin, add(c, mul(nrm, hw)), sub(c, mul(nrm, hw)));
          }
          break;
        }
        case 'hash': {
          const w = st.boldWidth / 2;
          const n = Math.max(2, Math.floor(l / st.hashSpacing));
          for (let i = 0; i <= n; i++) {
            const c = add(s, mul(d, i / n));
            line(thin, add(c, mul(nrm, w)), sub(c, mul(nrm, w)));
          }
          break;
        }
        case 'wavy': {
          const waves = Math.max(2, Math.round(l / (st.bondLength * 0.17)));
          const step = l / waves;
          const amp = st.bondLength * 0.09;
          thin.moveTo(s.x, s.y);
          for (let i = 0; i < waves; i++) {
            const a = add(s, mul(dir, step * i));
            const c = add(s, mul(dir, step * (i + 1)));
            const m = add(add(a, mul(dir, step / 2)), mul(nrm, (i % 2 ? -1 : 1) * amp * 2));
            thin.quadraticCurveTo(m.x, m.y, c.x, c.y);
          }
          break;
        }
      }
      return;
    }

    if (b.order === 3) {
      line(thin, s, e);
      line(thin, add(s, mul(nrm, gap)), add(e, mul(nrm, gap)));
      line(thin, sub(s, mul(nrm, gap)), sub(e, mul(nrm, gap)));
      return;
    }

    // double or aromatic
    const info = this.bondInfo(doc, b);
    const second = b.order === 1.5 ? dashed : thin;
    const main = b.display === 'bold' ? bold : b.display === 'dash' ? dashed : thin;
    if (info.side === 0) {
      const h = gap / 2;
      line(main, add(s, mul(nrm, h)), add(e, mul(nrm, h)));
      line(second, sub(s, mul(nrm, h)), sub(e, mul(nrm, h)));
      return;
    }
    // The main line runs atom to atom; the second line is inset on the chosen side.
    const off = mul(nrm, gap * info.side);
    const pLabelled = this.atomInfo(doc, p).boxes.length > 0;
    const qLabelled = this.atomInfo(doc, q).boxes.length > 0;
    const t1 = pLabelled ? 0 : Math.min(gap * info.trim1 + gap * 0.15, l * 0.3);
    const t2 = qLabelled ? 0 : Math.min(gap * info.trim2 + gap * 0.15, l * 0.3);
    line(main, s, e);
    line(second, add(add(s, off), mul(dir, t1)), sub(add(e, off), mul(dir, t2)));
  }

  private drawCarbonCharge(ctx: CanvasRenderingContext2D, doc: Doc, a: Atom): void {
    let sx = 0, sy = 0;
    for (const n of doc.neighbors(a.id)) { const d = norm(sub(n, a)); sx += d.x; sy += d.y; }
    const away = len({ x: sx, y: sy }) > 0.1 ? norm({ x: -sx, y: -sy }) : { x: 0.7, y: -0.7 };
    const size = doc.style.labelSize * 0.8;
    const t = (Math.abs(a.charge) > 1 ? String(Math.abs(a.charge)) : '') + (a.charge > 0 ? '+' : '−');
    ctx.font = `${size}px ${FONT_STACK}`;
    const w = measureText(t, size);
    ctx.fillText(t, a.x + away.x * size * 0.8 - w / 2, a.y + away.y * size * 0.8 + size * 0.35);
  }

  private drawShape(ctx: CanvasRenderingContext2D, s: Shape, lw: number): void {
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
    ctx.lineWidth = s.bold ? lw * 2.5 : lw;
    ctx.strokeStyle = s.color ?? '#000';
    ctx.fillStyle = s.color ?? '#000';
    ctx.setLineDash(s.dashed ? [lw * 3, lw * 3] : []);
    ctx.beginPath();
    switch (s.kind) {
      case 'picture': this.drawPicture(ctx, s, x, y, w, h); break;
      case 'table': {
        const ed = this.tableEdit?.id === s.id ? this.tableEdit : null;
        const t = ed?.table ?? s.table;
        if (t) drawTable(ctx, t, this.tableLayout(t), s.x1, s.y1, lw, s.color, ed?.part);
        break;
      }
      case 'line': ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); break;
      case 'rect': {
        // ChemDraw's defaults: corners of six line widths, a light grey shadow of four
        const r = s.rounded ? Math.min(s.radius ?? 6 * lw, w / 2, h / 2) : 0;
        if (s.shadow) {
          // the shadow shows only where it sticks out, so anything under the box stays visible
          const d = s.shadowSize ?? 4 * lw;
          ctx.save();
          ctx.fillStyle = '#c0c0c0';
          ctx.beginPath();
          shadowBand(ctx, x, y, w, h, r, d);
          ctx.fill();
          ctx.restore();
          ctx.beginPath();
        }
        ctx.roundRect(x, y, w, h, r);
        if (s.filled) fillShape(ctx, s, x, y, w, h); else ctx.stroke();
        if (s.picture) {
          ctx.fillStyle = '#eef1f5';
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = '#7d8794';
          ctx.font = `${Math.min(10, h * 0.3)}px ${FONT_STACK}`;
          ctx.fillText('picture', x + 2, y + Math.min(10, h * 0.3) + 1);
        }
        break;
      }
      case 'oval':
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (s.filled) fillShape(ctx, s, x, y, w, h); else ctx.stroke();
        break;
      case 'symbol': {
        const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2, r = Math.max(1.6, Math.min(w, h) / 2);
        const flag = s.symbol ? CHIRAL_FLAGS[s.symbol] : undefined;
        if (flag) {
          // a chiral flag: the word in a rounded box
          ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.2);
          ctx.stroke();
          const size = flagTextSize(s);
          ctx.font = `${size}px ${FONT_STACK}`;
          ctx.fillText(flag, cx - measureText(flag, size) / 2, cy + size * 0.36);
        } else if (s.symbol === 'CirclePlus' || s.symbol === 'CircleMinus') {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.moveTo(cx - r * 0.6, cy); ctx.lineTo(cx + r * 0.6, cy);
          if (s.symbol === 'CirclePlus') { ctx.moveTo(cx, cy - r * 0.6); ctx.lineTo(cx, cy + r * 0.6); }
          ctx.stroke();
        } else if (s.symbol === 'Plus' || s.symbol === 'Minus') {
          ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
          if (s.symbol === 'Plus') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); }
          ctx.stroke();
        } else if (s.symbol === 'LonePair') {
          // the two dots sit at the two ends
          ctx.arc(s.x1, s.y1, 0.55, 0, Math.PI * 2); ctx.moveTo(s.x2 + 0.55, s.y2); ctx.arc(s.x2, s.y2, 0.55, 0, Math.PI * 2); ctx.fill();
        } else if (s.symbol === 'Electron') {
          ctx.arc(s.x1, s.y1, 0.6, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.arc(cx, cy, 0.6, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'bracket': {
        // A bracket runs from (x1,y1) to (x2,y2) and opens to the right of that direction.
        const p = { x: s.x1, y: s.y1 }, q = { x: s.x2, y: s.y2 };
        const l = Math.hypot(q.x - p.x, q.y - p.y);
        if (l < 0.1) break;
        const trace = (steps: PathStep[]) => {
          for (const st of steps) {
            if (st[0] === 'M') ctx.moveTo(st[1].x, st[1].y);
            else if (st[0] === 'L') ctx.lineTo(st[1].x, st[1].y);
            else if (st[0] === 'Q') ctx.quadraticCurveTo(st[1].x, st[1].y, st[2].x, st[2].y);
            else ctx.arc(st[1].x, st[1].y, st[2], st[3], st[4], st[5]);
          }
        };
        trace(bracketPath(p, q, s.bracket));
        if (s.pair) {
          // the other half mirrors this one, a short distance away
          const n = perp(norm(sub(q, p)));
          const gap = l * 0.6;
          trace(bracketPath(add(q, mul(n, gap)), add(p, mul(n, gap)), s.bracket));
        }
        ctx.stroke();
        break;
      }
    }
    ctx.setLineDash([]);
  }

  /** A picture, cropped as set; a grey box until its image has loaded. */
  private drawPicture(ctx: CanvasRenderingContext2D, s: Shape, x: number, y: number, w: number, h: number): void {
    if ('picture' in ctx) { (ctx as unknown as PictureSink).picture(s); return; }
    const img = s.src ? imageFor(s.src) : null;
    if (!img) {
      ctx.fillStyle = '#eef1f5';
      ctx.fillRect(x, y, w, h);
      return;
    }
    const c = s.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const iw = img.naturalWidth || s.px?.w || w, ih = img.naturalHeight || s.px?.h || h;
    const sx = c.l * iw, sy = c.t * ih, sw = Math.max(1e-3, (1 - c.l - c.r) * iw), sh = Math.max(1e-3, (1 - c.t - c.b) * ih);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  drawArrow(ctx: CanvasRenderingContext2D, r: Arrow, lw: number): void {
    ctx.strokeStyle = ctx.fillStyle = r.color ?? '#000';
    ctx.lineWidth = r.line === 'bold' ? lw * 2.5 : lw;
    ctx.lineCap = 'butt';
    const shaft = (tail: Vec, head: Vec, headStyle: Arrow['headStyle'], tailStyle: Arrow['headStyle']) => {
      const d = sub(head, tail);
      const l = len(d);
      if (l < 0.1) return;
      if (r.sweep) { this.arcArrow(ctx, r, tail, head); return; }
      const dir = mul(d, 1 / l);
      const hl = Math.min(r.headLength, l * 0.6);
      const back = headStyle === 'none' ? 0 : hl * 0.7;
      const tback = tailStyle === 'none' ? 0 : hl * 0.7;
      ctx.setLineDash(r.line === 'dashed' ? [lw * 4, lw * 3] : []);
      ctx.beginPath();
      const s = add(tail, mul(dir, tback)), e = sub(head, mul(dir, back));
      ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
      ctx.stroke();
      ctx.setLineDash([]);
      this.arrowHead(ctx, head, dir, headStyle, r);
      this.arrowHead(ctx, tail, mul(dir, -1), tailStyle, r);
    };
    if (r.equilibrium) {
      const d = norm(sub(r.head, r.tail));
      const off = mul(perp(d), -shaftOffset(r));
      shaft(add(r.tail, off), add(r.head, off), 'halfLeft', 'none');
      shaft(sub(r.head, off), sub(r.tail, off), 'halfLeft', 'none');
    } else if (r.shaftSpacing && !r.sweep) {
      this.retroArrow(ctx, r, lw);
    } else {
      shaft(r.tail, r.head, r.headStyle, r.tailStyle);
    }
    if (r.noGo) {
      const m = mul(add(r.tail, r.head), 0.5);
      const k = 3;
      ctx.beginPath();
      ctx.moveTo(m.x - k, m.y - k); ctx.lineTo(m.x + k, m.y + k);
      ctx.moveTo(m.x + k, m.y - k); ctx.lineTo(m.x - k, m.y + k);
      ctx.stroke();
    }
  }

  /** Two shafts ending in an open head (⇒), as used for retrosynthetic steps. */
  private retroArrow(ctx: CanvasRenderingContext2D, r: Arrow, lw: number): void {
    const d = sub(r.head, r.tail);
    const l = len(d);
    if (l < 0.1) return;
    const dir = mul(d, 1 / l);
    const n = perp(dir);
    const h = shaftOffset(r);
    const hl = Math.min(r.headLength, l * 0.6);
    // the head's arms reach past the shafts by the head width
    const hw = h + r.headWidth;
    const stop = sub(r.head, mul(dir, (hl * h) / hw));
    const base = sub(r.head, mul(dir, hl));
    ctx.setLineDash(r.line === 'dashed' ? [lw * 4, lw * 3] : []);
    ctx.beginPath();
    for (const k of [h, -h]) {
      ctx.moveTo(r.tail.x + n.x * k, r.tail.y + n.y * k);
      ctx.lineTo(stop.x + n.x * k, stop.y + n.y * k);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(base.x + n.x * hw, base.y + n.y * hw);
    ctx.lineTo(r.head.x, r.head.y);
    ctx.lineTo(base.x - n.x * hw, base.y - n.y * hw);
    ctx.stroke();
  }

  private arcArrow(ctx: CanvasRenderingContext2D, r: Arrow, tail: Vec, head: Vec): void {
    // Circle through tail and head with the given sweep.
    const sweep = r.sweep;
    const { center, radius } = arcCenter(tail, head, sweep);
    const a0 = angleOf(sub(tail, center));
    const a1 = angleOf(sub(head, center));
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, a0, a1, sweep < 0);
    ctx.stroke();
    // a head points from where its base meets the arc to its tip, so on a tight curl it sits
    // across the curve instead of sticking out along the last bit of it
    const s = Math.sign(sweep);
    const back = Math.min(Math.abs(sweep) / 2, (r.headLength * 0.8) / Math.max(radius, 1e-6));
    const aim = (tip: Vec, a: number) => norm(sub(tip, add(center, fromAngle(a, radius))));
    this.arrowHead(ctx, head, aim(head, a1 - s * back), r.headStyle, r);
    this.arrowHead(ctx, tail, aim(tail, a0 + s * back), r.tailStyle, r);
  }

  private arrowHead(ctx: CanvasRenderingContext2D, tip: Vec, dir: Vec, style: Arrow['headStyle'], r: Arrow): void {
    if (style === 'none') return;
    const hl = r.headLength, hw = r.headWidth;
    const n = perp(dir);
    const base = sub(tip, mul(dir, hl));
    const inner = sub(tip, mul(dir, hl * 0.75));
    const left = add(base, mul(n, -hw)), right = add(base, mul(n, hw));
    const toLeft = style === 'full' || style === 'halfLeft', toRight = style === 'full' || style === 'halfRight';
    ctx.beginPath();
    if (r.headType === 'angle') {
      // an open head: just the barbs
      if (toLeft) { ctx.moveTo(left.x, left.y); ctx.lineTo(tip.x, tip.y); } else ctx.moveTo(tip.x, tip.y);
      if (toRight) ctx.lineTo(right.x, right.y);
      ctx.stroke();
      return;
    }
    ctx.moveTo(tip.x, tip.y);
    if (toLeft) ctx.lineTo(left.x, left.y);
    ctx.lineTo(inner.x, inner.y);
    if (toRight) ctx.lineTo(right.x, right.y);
    ctx.closePath();
    if (r.headType === 'hollow') ctx.stroke(); else ctx.fill();
  }

  drawCaption(ctx: CanvasRenderingContext2D, c: Caption): void {
    drawLayout(ctx, this.captionLayout(c), c.x, c.y);
  }

  /** Where every piece of a caption's text goes (cached per caption version). */
  captionLayout(c: Caption): TextLayout {
    let lay = this.capLayouts.get(c);
    if (!lay) {
      const base = this.baseOf(c);
      lay = layoutText(base ? { ...c, runs: applyBase(c.runs, base) } : c, base?.size ?? this.captionSize, (t, s, family, style) => measureText(t, s, family, style));
      this.capLayouts.set(c, lay);
    }
    return lay;
  }

  /** The area a table covers as it is drawn now (while it is typed into, its rows grow with the text). */
  tableBox(s: Shape): Rect {
    const t = this.tableEdit?.id === s.id ? this.tableEdit.table : s.table;
    if (!t) return { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
    const lay = this.tableLayout(t);
    return { x1: s.x1, y1: s.y1, x2: s.x1 + lay.width, y2: s.y1 + lay.height };
  }

  /** Where everything in a table goes (cached per table version). */
  tableLayout(t: TableData): TableLayout {
    let lay = this.tableLayouts.get(t);
    if (!lay) {
      lay = layoutTable(t, this.captionSize, (text, size, family, style) => measureText(text, size, family, style));
      this.tableLayouts.set(t, lay);
    }
    return lay;
  }

  /** The master formatting a placeholder's text takes. */
  baseOf(c: Caption): TextBase | undefined {
    return c.ph ? this.textStyles?.[c.ph] : undefined;
  }

  /** Take the caption size and placeholder formatting from the document being drawn. */
  useStyle(doc: Doc): void {
    if (doc.style.captionSize !== this.captionSize || doc.textStyles !== this.textStyles) {
      this.captionSize = doc.style.captionSize;
      this.textStyles = doc.textStyles;
      this.capBoxes = new WeakMap();
      this.capLayouts = new WeakMap();
      this.tableLayouts = new WeakMap();
    }
  }

  /** Bounding box of a caption in document coordinates (a placeholder's whole box, at least). */
  captionBox(c: Caption): Rect {
    let r = this.capBoxes.get(c);
    if (r) return r;
    const b = this.captionLayout(c).box;
    r = { x1: c.x + b.x1, y1: c.y + b.y1, x2: c.x + b.x2, y2: c.y + b.y2 };
    if (c.ph && c.boxH) {
      const f = placeholderRect(c, this.baseOf(c));
      r = { x1: Math.min(r.x1, f.x1), y1: Math.min(r.y1, f.y1), x2: Math.max(r.x2, f.x2), y2: Math.max(r.y2, f.y2) };
    }
    this.capBoxes.set(c, r);
    return r;
  }

  /** An empty placeholder on screen: a dashed box with a prompt in grey. */
  private drawPrompt(ctx: CanvasRenderingContext2D, c: Caption): void {
    const base = this.baseOf(c);
    const f = placeholderRect(c, base);
    const lw = 1 / this.view.scale;
    ctx.save();
    ctx.strokeStyle = '#a3a9b3';
    ctx.lineWidth = lw;
    ctx.setLineDash([4 * lw, 3 * lw]);
    ctx.strokeRect(f.x1, f.y1, f.x2 - f.x1, f.y2 - f.y1);
    ctx.setLineDash([]);
    const text = PROMPTS[c.ph!];
    const lay = layoutText({ runs: applyBase([{ text, color: '#8a909b', bold: false }], base), justify: c.justify, wrap: c.wrap, paras: c.paras }, base?.size ?? this.captionSize, (t, s, family, style) => measureText(t, s, family, style));
    drawLayout(ctx, lay, c.x, c.y);
    ctx.restore();
  }

  // ------------------------------------------------------------------ overlay

  clearOverlay(): CanvasRenderingContext2D {
    const ctx = this.octx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const { scale, ox, oy } = this.view;
    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * ox, this.dpr * oy);
    return ctx;
  }

  get overlayCtx(): CanvasRenderingContext2D { return this.octx; }
  get sceneCtx(): CanvasRenderingContext2D { return this.sctx; }

  /** Is this atom shown with a text label? */
  hasLabel(doc: Doc, a: Atom): boolean {
    return this.atomInfo(doc, a).boxes.length > 0;
  }

  isGeneric(a: Atom): boolean {
    return a.label !== null && isGenericLabel(a.label);
  }

}

/** Tile size in CSS pixels. */
const TILE = 256;
const MAX_TILES = 600;

interface Tile { canvas: OffscreenCanvas | HTMLCanvasElement; tx: number; ty: number }

/**
 * The part of a box's shadow that sticks out below and to the right: the box shifted by `d`,
 * minus the box itself (corners of radius `r`).
 */
function shadowBand(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, d: number): void {
  const R = x + w, B = y + h;
  if (r >= d && r > 0) {
    // the two rounded outlines cross near the top-right and bottom-left corners
    const t = Math.sqrt(r * r - (d * d) / 2) / Math.SQRT2;
    const c1 = { x: R - r, y: y + r }, c3 = { x: x + r, y: B - r };
    const i1 = { x: c1.x + d / 2 + t, y: c1.y + d / 2 - t }, i2 = { x: c3.x + d / 2 - t, y: c3.y + d / 2 + t };
    const ang = (p: Vec, c: Vec) => Math.atan2(p.y - c.y, p.x - c.x);
    ctx.moveTo(i1.x, i1.y);
    ctx.arc(c1.x + d, c1.y + d, r, ang(i1, { x: c1.x + d, y: c1.y + d }), 0);
    ctx.lineTo(R + d, B - r + d);
    ctx.arc(R - r + d, B - r + d, r, 0, Math.PI / 2);
    ctx.lineTo(c3.x + d, B + d);
    ctx.arc(c3.x + d, c3.y + d, r, Math.PI / 2, ang(i2, { x: c3.x + d, y: c3.y + d }));
    ctx.arc(c3.x, c3.y, r, ang(i2, c3), Math.PI / 2, true);
    ctx.lineTo(R - r, B);
    ctx.arc(R - r, B - r, r, Math.PI / 2, 0, true);
    ctx.lineTo(R, y + r);
    ctx.arc(c1.x, c1.y, r, 0, ang(i1, c1), true);
  } else {
    ctx.moveTo(R, y + d);
    ctx.lineTo(R + d - r, y + d);
    ctx.arc(R + d - r, y + d + r, r, -Math.PI / 2, 0);
    ctx.lineTo(R + d, B + d - r);
    ctx.arc(R + d - r, B + d - r, r, 0, Math.PI / 2);
    ctx.lineTo(x + d + r, B + d);
    ctx.arc(x + d + r, B + d - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x + d, B);
    ctx.lineTo(R - r, B);
    ctx.arc(R - r, B - r, r, Math.PI / 2, 0, true);
  }
  ctx.closePath();
}

interface BondBatch { thin: Path2D; bold: Path2D; dashed: Path2D; fills: Path2D }
function newBatch(mk: () => Path2D): BondBatch {
  return { thin: mk(), bold: mk(), dashed: mk(), fills: mk() };
}

/** The wavy line marking a point of attachment, centred on `at` and running along `across`. */
export function attachWave(path: Path2D, at: Vec, across: Vec, bondLength: number): void {
  const half = bondLength * ATTACH_HALF;
  const waves = ATTACH_HALF_WAVES;
  const step = (2 * half) / waves;
  const amp = bondLength * ATTACH_AMP;
  const dir = { x: -across.y, y: across.x };
  const s = { x: at.x - across.x * half, y: at.y - across.y * half };
  path.moveTo(s.x, s.y);
  for (let i = 0; i < waves; i++) {
    const c = { x: s.x + across.x * step * (i + 1), y: s.y + across.y * step * (i + 1) };
    const sgn = i % 2 ? -1 : 1;
    const m = { x: s.x + across.x * step * (i + 0.5) + dir.x * amp * 2 * sgn, y: s.y + across.y * step * (i + 0.5) + dir.y * amp * 2 * sgn };
    path.quadraticCurveTo(m.x, m.y, c.x, c.y);
  }
}

const WARN_COLOR = '#e0141e';

/**
 * Half the length and the height of the attachment wave, as fractions of the bond length, and
 * its number of half waves (measured in ChemDraw 25: 1.2 bond lengths long, about 12 small waves).
 */
const ATTACH_HALF = 0.6;
const ATTACH_AMP = 0.06;
const ATTACH_HALF_WAVES = 24;

/**
 * Fill the path just traced for a filled box or oval: evenly, with a light tint (faded), or
 * shaded from light at the top left to the full colour. A fill colour of its own gets the
 * outline drawn round it in the line colour.
 */
function fillShape(ctx: CanvasRenderingContext2D, s: Shape, x: number, y: number, w: number, h: number): void {
  const c = s.fillColor ?? s.color ?? '#000000';
  if (s.fill === 'faded') ctx.fillStyle = tint(c, FADE);
  else if (s.fill === 'shaded') {
    const g = s.kind === 'oval'
      ? ctx.createRadialGradient(x + w * 0.35, y + h * 0.3, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.6)
      : ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, tint(c, 0.85));
    g.addColorStop(1, c);
    ctx.fillStyle = g;
  } else ctx.fillStyle = c;
  ctx.fill();
  if (s.fillColor && s.fillColor.toLowerCase() !== (s.color ?? '#000000').toLowerCase()) ctx.stroke();
}
