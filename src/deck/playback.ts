// Playing slides as in a slide show: transitions between slides, and the animations of each
// slide's objects, click by click. The slide show (F5) and the previews in the Transitions and
// Animations tabs both use this.
//
// Each slide is painted once: its page with everything that doesn't move, and each part that has
// an animation on a layer of its own. A frame of the show is then those pictures put together
// (faded, wiped or moved as the animations say), so even big slides play smoothly.

import { Doc, applyBase, captionBase, type Media, type Shape } from '../model';
import { playWindow, volumeAt } from './media';
import { layoutText } from '../text/layout';
import { measureText } from '../render/renderer';
import { linkAtPoint } from '../links';
import { turnAbout } from '../geom';
import type { Deck } from './deck';
import { paintSlide, type SlidePage } from './slide-view';
import { selectionBox, POINTS } from '../editor/arrange';
import type { Rect } from '../geom';
import type { Selection } from '../editor/editor';
import { plainText } from '../richtext';
import { buildSteps, partStates, slideParts, partOf, hostOf, type Anim, type Part, type Step, type Transition, type Side } from './animation';

const ease = (p: number) => 1 - (1 - p) ** 3;

/**
 * A copy of the slide's drawing with only some of its objects (kept with their ids), with the
 * highlights on the atoms and bonds in `strip` taken off.
 */
function subDoc(doc: Doc, keep: (kind: 'atom' | 'caption' | 'arrow' | 'shape', id: number) => boolean, strip?: Selection): Doc {
  const c = doc.contents();
  const d = new Doc();
  d.style = doc.style;
  d.background = doc.background;
  d.textStyles = doc.textStyles;
  const atoms = c.atoms.filter((a) => keep('atom', a.id)).map((a) => (strip?.atoms.has(a.id) ? { ...a, highlight: undefined, hl: undefined } : a));
  const ids = new Set(atoms.map((a) => a.id));
  d.restoreContents({
    atoms, bonds: c.bonds.filter((b) => ids.has(b.a1) && ids.has(b.a2)).map((b) => (strip?.bonds.has(b.id) ? { ...b, highlight: undefined, hl: undefined } : b)),
    captions: c.captions.filter((x) => keep('caption', x.id)), arrows: c.arrows.filter((x) => keep('arrow', x.id)), shapes: c.shapes.filter((x) => keep('shape', x.id)),
  });
  return d;
}

/** A highlight on its own: its atoms and bonds (and its bonds' atoms), drawing nothing but the highlight. */
export function highlightDoc(doc: Doc, h: Selection): Doc {
  const atoms = new Set(h.atoms);
  for (const id of h.bonds) { const b = doc.bonds.get(id); if (b) { atoms.add(b.a1); atoms.add(b.a2); } }
  const others: Selection = { atoms: new Set([...atoms].filter((id) => !h.atoms.has(id))), bonds: new Set([...doc.bonds.keys()].filter((id) => !h.bonds.has(id))), captions: new Set(), arrows: new Set(), shapes: new Set() };
  const d = subDoc(doc, (kind, id) => kind === 'atom' && atoms.has(id), others);
  d.onlyHighlights = true;
  return d;
}

const inPart = (part: Part, kind: 'atom' | 'caption' | 'arrow' | 'shape', id: number) =>
  part.kind !== 'highlight' && (kind === 'atom' ? part.sel.atoms : kind === 'caption' ? part.sel.captions : kind === 'arrow' ? part.sel.arrows : part.sel.shapes).has(id);

/** A video or sound on the slide in the show: its picture's place on the canvas, in CSS pixels. */
export interface MediaSpot { id: number; media: Media; x: number; y: number; w: number; h: number }

/** One slide, painted ready to play at one size. */
export class SlideFrames {
  readonly steps: Step[];
  private base = document.createElement('canvas');
  private layers: { part: Part; canvas: HTMLCanvasElement; box: Rect }[] = [];
  private parts: Part[] = [];
  /** Where the slide sits on the canvas: its corner and scale (CSS pixels per point). */
  private at = { x: 0, y: 0, k: 1 };

  constructor(private page: SlidePage, private doc: Doc, private anims: Anim[], private w: number, private h: number, private dpr: number, fill: string | null) {
    // a sound's icon hidden during the show isn't painted (it still plays)
    const hidden = [...doc.shapes.values()].filter((x) => x.video?.audio && x.video.hide);
    if (hidden.length) {
      const ids = new Set(hidden.map((x) => x.id));
      this.hiddenMedia = hidden;
      doc = this.doc = subDoc(doc, (kind, id) => !(kind === 'shape' && ids.has(id)));
    }
    const live = anims.length ? (() => {
      this.parts = slideParts(doc);
      return anims.filter((a) => partOf(this.parts, a.target));
    })() : [];
    this.anims = live;
    this.steps = buildSteps(live);
    const moving = new Set(live.map((a) => partOf(this.parts, a.target)!));
    // a highlight that moves on its own is drawn under its structure, so the structure comes
    // off the page too (drawn over the highlight, without it)
    const lifted = new Set(moving);
    const strip: Selection = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
    for (const p of moving) {
      if (p.kind !== 'highlight') continue;
      const host = hostOf(this.parts, p);
      if (host) lifted.add(host);
      for (const id of p.sel.atoms) strip.atoms.add(id);
      for (const id of p.sel.bonds) strip.bonds.add(id);
    }
    const out = [...lifted];
    const still = lifted.size ? subDoc(doc, (kind, id) => !out.some((p) => inPart(p, kind, id)), strip) : doc;
    this.at = paintSlide(this.base, w, h, dpr, page, still, fill);
    for (const part of this.parts.filter((p) => lifted.has(p))) {
      const canvas = document.createElement('canvas');
      const one = part.kind === 'highlight' ? highlightDoc(doc, part.sel) : subDoc(doc, (kind, id) => inPart(part, kind, id), strip);
      paintSlide(canvas, w, h, dpr, page, one, null, false);
      const b = selectionBox(doc, part.sel, POINTS) ?? { x1: 0, y1: 0, x2: page.size.w, y2: page.size.h };
      // room for frames, shadows, glows and arrowheads
      const pad = part.kind === 'highlight' ? doc.style.bondLength : 8;
      this.layers.push({ part, canvas, box: { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad } });
    }
  }

  /**
   * Videos and sounds on the slide, showing with `done` steps played: where they go, in CSS
   * pixels on the canvas (a hidden sound's icon still has its place, to be clicked).
   */
  videoSpots(done: number): MediaSpot[] {
    const states = this.layers.length ? partStates(this.parts, this.anims, done, -1) : null;
    const { x, y, k } = this.at;
    const out: MediaSpot[] = [];
    for (const sh of this.doc.shapes.values()) {
      if (sh.kind !== 'picture' || !sh.video) continue;
      const L = states && this.layers.find((l) => l.part.sel.shapes.has(sh.id));
      if (L && !(states!.get(L.part)?.visible ?? true)) continue;
      out.push({
        id: sh.id, media: sh.video,
        x: x + Math.min(sh.x1, sh.x2) * k, y: y + Math.min(sh.y1, sh.y2) * k, w: Math.abs(sh.x2 - sh.x1) * k, h: Math.abs(sh.y2 - sh.y1) * k,
      });
    }
    return out;
  }

  /** Sounds whose icons are hidden in the show (they play all the same). */
  private hiddenMedia: Shape[] = [];

  /** Media on the slide whose pictures aren't painted (hidden sounds), so they still play. */
  get hiddenSpots(): MediaSpot[] {
    const { x, y, k } = this.at;
    return this.hiddenMedia.map((sh) => ({ id: sh.id, media: sh.video!, x: x + Math.min(sh.x1, sh.x2) * k, y: y + Math.min(sh.y1, sh.y2) * k, w: 0, h: 0 }));
  }

  /** Number of animation steps (an automatic first one included). */
  get stepCount(): number { return this.steps.length; }

  /** Where the slide sits on the canvas: its corner and scale (CSS pixels per point). */
  get place(): { x: number; y: number; k: number } { return { ...this.at }; }

  /**
   * What a click at a point on the canvas (CSS pixels) does: a shape's or zoom's action (the top
   * one there), and the box of what was clicked, in CSS pixels.
   */
  shapeActionAt(px: number, py: number): { link: string; zoom?: Shape['zoom']; rect: Rect } | null {
    const { x, y, k } = this.at;
    const p = { x: (px - x) / k, y: (py - y) / k };
    const hits = [...this.doc.shapes.values()].filter((s) => s.link && !s.hidden && p.x >= Math.min(s.x1, s.x2) && p.x <= Math.max(s.x1, s.x2) && p.y >= Math.min(s.y1, s.y2) && p.y <= Math.max(s.y1, s.y2));
    const top = hits.sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).pop();
    if (!top) return null;
    const r = { x1: x + Math.min(top.x1, top.x2) * k, y1: y + Math.min(top.y1, top.y2) * k, x2: x + Math.max(top.x1, top.x2) * k, y2: y + Math.max(top.y1, top.y2) * k };
    return { link: top.link!, ...(top.zoom ? { zoom: top.zoom } : {}), rect: r };
  }

  /** The link in the slide's text at a point on the canvas (CSS pixels), if any. */
  linkAt(px: number, py: number): string | null {
    const { x, y, k } = this.at;
    const p = { x: (px - x) / k, y: (py - y) / k };
    const doc = this.doc;
    for (const c of doc.captions.values()) {
      if (!c.runs.some((r) => r.link)) continue;
      const base = c.ph ? doc.textStyles?.[c.ph] : captionBase(doc.style);
      const lay = layoutText(base ? { ...c, runs: applyBase(c.runs, base) } : c, base?.size ?? doc.style.captionSize, (t, s, family, style) => measureText(t, s, family, style));
      const q = c.rot ? turnAbout(p, c, -c.rot) : p;
      const span = linkAtPoint(lay, c.runs, q.x - c.x, q.y - c.y);
      if (span) return span.link;
    }
    return null;
  }

  /** Draw the slide with `done` steps played and `t` seconds into the next (t < 0: not started). */
  draw(ctx: CanvasRenderingContext2D, done: number, t = -1): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    if (!this.layers.length) return;
    const states = partStates(this.parts, this.anims, done, t);
    const { x, y, k } = this.at, s = this.dpr * k, size = this.page.size;
    const px = (v: number, o: number) => (o + v * k) * this.dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px(0, x), px(0, y), size.w * s, size.h * s);
    ctx.clip();
    for (const L of this.layers) {
      const st = states.get(L.part) ?? { visible: true };
      if (!st.visible) continue;
      const run = st.running;
      const e = st.emph;
      ctx.save();
      if (e) {
        // grown, turned and see-through about the middle of the part
        const cx = px((L.box.x1 + L.box.x2) / 2, x), cy = px((L.box.y1 + L.box.y2) / 2, y);
        ctx.translate(cx, cy);
        if (e.rot) ctx.rotate((e.rot * Math.PI) / 180);
        if (e.scale !== 1) ctx.scale(e.scale, e.scale);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha *= Math.max(0, Math.min(1, e.alpha));
      }
      const paint = () => {
        if (!e?.color || (e.mix <= 0 && !e.was)) { ctx.drawImage(L.canvas, 0, 0); return; }
        // changing colour: the colour it had (or its own), the new one over it
        const a0 = ctx.globalAlpha;
        ctx.drawImage(e.was && e.mix < 1 ? this.tinted(L, e.was) : L.canvas, 0, 0);
        if (e.mix > 0) {
          ctx.globalAlpha = a0 * Math.min(1, e.mix);
          ctx.drawImage(this.tinted(L, e.color), 0, 0);
          ctx.globalAlpha = a0;
        }
      };
      if (!run) { paint(); ctx.restore(); continue; }
      const a = run.anim, p = a.exit ? 1 - run.p : run.p;
      ctx.save();
      if (a.effect === 'appear') { if (a.exit) { ctx.restore(); continue; } }
      else if (a.effect === 'fade') ctx.globalAlpha = p;
      else if (a.effect === 'wipe') {
        const r = wipeRect(L.box, a.from ?? 'bottom', p);
        ctx.beginPath();
        ctx.rect(px(r.x1, x), px(r.y1, y), (r.x2 - r.x1) * s, (r.y2 - r.y1) * s);
        ctx.clip();
      } else if (a.effect === 'fly') {
        const off = flyOffset(L.box, a.from ?? 'bottom', size);
        // coming in: from off the slide to its place; going out: from its place off the slide
        const f = a.exit ? ease(run.p) : 1 - ease(run.p);
        ctx.translate(off.x * f * s, off.y * f * s);
      }
      paint();
      ctx.restore();
      ctx.restore();
    }
    ctx.restore();
  }

  private tints = new Map<string, HTMLCanvasElement>();

  /**
   * A part in another colour (Colour Change): a shape's fill, text's colour, and anything else
   * (structures, pictures) coloured all over, as a stamp.
   */
  private tinted(L: { part: Part; canvas: HTMLCanvasElement }, colour: string): HTMLCanvasElement {
    const key = `${this.layers.indexOf(L as never)}|${colour}`;
    let c = this.tints.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = L.canvas.width;
    c.height = L.canvas.height;
    const part = L.part;
    const own = part.kind === 'shape' || part.kind === 'text' ? recoloured(this.doc, part, colour) : null;
    if (own) paintSlide(c, this.w, this.h, this.dpr, this.page, own, null, false);
    else {
      const g = c.getContext('2d');
      if (g) {
        g.drawImage(L.canvas, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = colour;
        g.fillRect(0, 0, c.width, c.height);
      }
    }
    this.tints.set(key, c);
    return c;
  }
}

/** A shape's fill, or a text box's text, in another colour: the part on its own, ready to paint. */
function recoloured(doc: Doc, part: Part, colour: string): Doc {
  const d = subDoc(doc, (kind, id) => inPart(part, kind, id));
  d.bulk(() => {
    if (part.kind === 'shape') {
      for (const sh of [...d.shapes.values()]) {
        if (sh.kind === 'picture' || sh.kind === 'table') continue;
        d.updateShape(sh.id, { filled: true, fillColor: colour, fill: undefined });
      }
    } else {
      for (const c of [...d.captions.values()]) d.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, color: colour })) });
    }
  });
  return d;
}

/** The part of a box shown `p` of the way through a wipe that starts at `side`. */
export function wipeRect(b: Rect, side: Side, p: number): Rect {
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  switch (side) {
    case 'bottom': return { ...b, y1: b.y2 - h * p };
    case 'top': return { ...b, y2: b.y1 + h * p };
    case 'left': return { ...b, x2: b.x1 + w * p };
    case 'right': return { ...b, x1: b.x2 - w * p };
  }
}

/** How far a part moves to be just off the slide at `side`. */
export function flyOffset(b: Rect, side: Side, size: { w: number; h: number }): { x: number; y: number } {
  switch (side) {
    case 'bottom': return { x: 0, y: size.h - b.y1 };
    case 'top': return { x: 0, y: -b.y2 };
    case 'left': return { x: -b.x2, y: 0 };
    case 'right': return { x: size.w - b.x1, y: 0 };
  }
}

// ---------------------------------------------------------------- Morph

/** A part painted on its own, cut to its box: where it is (points) and its pixels. */
interface Piece { part: Part; key: string; kind: string; box: Rect; canvas: HTMLCanvasElement }

/** What a part is, to find the same thing on the next slide: its kind and what it holds. */
export function morphKey(doc: Doc, part: Part): { kind: string; key: string; role: string } {
  const s = part.sel;
  switch (part.kind) {
    case 'text': {
      const c = doc.captions.get(Math.min(...s.captions));
      return { kind: 'text', key: c ? plainText(c.runs).trim() : '', role: c?.ph ?? '' };
    }
    case 'picture': {
      const sh = doc.shapes.get(Math.min(...s.shapes));
      return { kind: 'picture', key: (sh?.src ?? '').slice(-64), role: '' };
    }
    case 'shape': {
      const sh = doc.shapes.get(Math.min(...s.shapes));
      return { kind: `shape ${sh?.kind}${sh?.geo ? ` ${sh.geo.slice(0, 24)}` : ''}`, key: sh?.text ? plainText(sh.text.runs).trim() : '', role: '' };
    }
    case 'drawing': {
      // a structure: its atoms (by element) and bonds
      const zs = [...s.atoms].map((id) => { const a = doc.atoms.get(id); return a ? `${a.z}${a.label ?? ''}` : ''; }).sort();
      return { kind: 'drawing', key: `${zs.join(',')}|${s.bonds.size}|${s.arrows.size}|${s.captions.size}`, role: '' };
    }
    default: return { kind: part.kind, key: '', role: '' };
  }
}

/**
 * Pairs of the same thing on two slides, for Morph: the same text, picture, structure or shape
 * (the same placeholder for titles and text), else the nearest of the same kind for shapes and
 * pictures. Returns [index on the first slide, index on the second] pairs.
 */
export function morphPairs(a: { kind: string; key: string; role: string; box: Rect }[], b: { kind: string; key: string; role: string; box: Rect }[]): [number, number][] {
  const used = new Set<number>();
  const out: [number, number][] = [];
  const centre = (r: Rect) => ({ x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 });
  const dist = (p: Rect, q: Rect) => { const u = centre(p), v = centre(q); return Math.hypot(u.x - v.x, u.y - v.y); };
  const pass = (ok: (x: typeof a[0], y: typeof b[0]) => boolean) => {
    b.forEach((y, j) => {
      if (out.some((pr) => pr[1] === j)) return;
      let best = -1, bd = Infinity;
      a.forEach((x, i) => {
        if (used.has(i) || x.kind !== y.kind || !ok(x, y)) return;
        const d = dist(x.box, y.box);
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0) { used.add(best); out.push([best, j]); }
    });
  };
  pass((x, y) => x.key === y.key && x.role === y.role);
  pass((x, y) => x.key === y.key);
  pass((x, y) => !!x.role && x.role === y.role);
  pass((x) => x.kind.startsWith('shape') || x.kind === 'picture' || x.kind === 'table' || x.kind === 'connector');
  return out;
}

/** Two slides ready to morph from one to the other at one size. */
export class MorphFrames {
  private base0 = document.createElement('canvas');
  private base1 = document.createElement('canvas');
  private from: Piece[];
  private to: Piece[];
  private pairs: [number, number][];
  private at = { x: 0, y: 0, k: 1 };

  /** `gone`: parts of the first slide its animations took off by its end. */
  constructor(page0: SlidePage, doc0: Doc, gone: Set<Part>, page1: SlidePage, doc1: Doc, w: number, h: number, private dpr: number, fill: string | null) {
    const scratch = document.createElement('canvas');
    const empty = (d: Doc) => subDoc(d, () => false);
    paintSlide(this.base0, w, h, dpr, page0, empty(doc0), fill);
    this.at = paintSlide(this.base1, w, h, dpr, page1, empty(doc1), fill);
    const pieces = (page: SlidePage, doc: Doc, skip: Set<Part>): Piece[] =>
      slideParts(doc).filter((p) => p.kind !== 'highlight' && !skip.has(p)).map((part) => {
        const one = subDoc(doc, (kind, id) => inPart(part, kind, id));
        const at = paintSlide(scratch, w, h, dpr, page, one, null, false);
        const b0 = selectionBox(doc, part.sel, POINTS) ?? { x1: 0, y1: 0, x2: page.size.w, y2: page.size.h };
        const pad = 8;
        const box = { x1: b0.x1 - pad, y1: b0.y1 - pad, x2: b0.x2 + pad, y2: b0.y2 + pad };
        const c = document.createElement('canvas');
        const sx = Math.floor((at.x + box.x1 * at.k) * dpr), sy = Math.floor((at.y + box.y1 * at.k) * dpr);
        const sw = Math.max(1, Math.ceil((box.x2 - box.x1) * at.k * dpr)), sh = Math.max(1, Math.ceil((box.y2 - box.y1) * at.k * dpr));
        c.width = sw; c.height = sh;
        c.getContext('2d')?.drawImage(scratch, sx, sy, sw, sh, 0, 0, sw, sh);
        const k = morphKey(doc, part);
        return { part, key: k.key + '\u0000' + k.role, kind: k.kind, box, canvas: c };
      });
    this.from = pieces(page0, doc0, gone);
    this.to = pieces(page1, doc1, new Set());
    const info = (ps: Piece[]) => ps.map((p) => { const [key, role] = p.key.split('\u0000'); return { kind: p.kind, key, role, box: p.box }; });
    this.pairs = morphPairs(info(this.from), info(this.to));
  }

  /** One frame, `p` of the way from the first slide to the second. */
  draw(ctx: CanvasRenderingContext2D, p: number): void {
    const e = ease(p) * 0.5 + p * 0.5;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.base0, 0, 0);
    ctx.globalAlpha = e;
    ctx.drawImage(this.base1, 0, 0);
    const { x, y, k } = this.at, d = this.dpr;
    const put = (c: HTMLCanvasElement, r: Rect, alpha: number) => {
      if (alpha <= 0) return;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(c, (x + r.x1 * k) * d, (y + r.y1 * k) * d, Math.max(1e-3, (r.x2 - r.x1) * k * d), Math.max(1e-3, (r.y2 - r.y1) * k * d));
    };
    const pairedA = new Set(this.pairs.map((q) => q[0])), pairedB = new Set(this.pairs.map((q) => q[1]));
    this.from.forEach((pc, i) => { if (!pairedA.has(i)) put(pc.canvas, pc.box, 1 - e); });
    for (const [i, j] of this.pairs) {
      const A = this.from[i], B = this.to[j];
      const r = { x1: A.box.x1 + (B.box.x1 - A.box.x1) * e, y1: A.box.y1 + (B.box.y1 - A.box.y1) * e, x2: A.box.x2 + (B.box.x2 - A.box.x2) * e, y2: A.box.y2 + (B.box.y2 - A.box.y2) * e };
      if (A.key === B.key) put(e < 0.5 ? A.canvas : B.canvas, r, 1);
      else { put(A.canvas, r, 1 - e); put(B.canvas, r, e); }
    }
    this.to.forEach((pc, j) => { if (!pairedB.has(j)) put(pc.canvas, pc.box, e); });
    ctx.globalAlpha = 1;
  }
}

/**
 * One frame of a zoom, `p` of the way: in, the old slide grows about the box (CSS pixels × dpr)
 * until the new slide, drawn in the box as it grows, fills the screen; out, the reverse.
 */
export function drawZoom(ctx: CanvasRenderingContext2D, from: CanvasImageSource, to: CanvasImageSource, box: Rect, p: number, out: boolean, W: number, H: number): void {
  const e = ease(out ? 1 - p : p);
  const lerp = (a: number, b: number) => a + (b - a) * e;
  // the box now: from the zoom's box to the whole screen
  const r = { x1: lerp(box.x1, 0), y1: lerp(box.y1, 0), x2: lerp(box.x2, W), y2: lerp(box.y2, H) };
  const k = (r.x2 - r.x1) / Math.max(1, box.x2 - box.x1);
  // the slide the zoom is on, moved and grown with its box, then the zoomed slide in the box
  const outer = out ? to : from, inner = out ? from : to;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, r.x1 - box.x1 * k, r.y1 - box.y1 * k);
  ctx.drawImage(outer, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(inner, r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
}

const DIR_VEC = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;

/** One frame of a transition, `p` of the way from the old slide to the new (whole canvases). */
export function drawTransition(ctx: CanvasRenderingContext2D, from: CanvasImageSource | null, to: CanvasImageSource, t: Transition, p: number, W: number, H: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const old = () => { if (from) ctx.drawImage(from, 0, 0); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); } };
  const [dx, dy] = DIR_VEC[t.dir ?? 'left'];
  const e = ease(p);
  switch (t.kind) {
    case 'none': ctx.drawImage(to, 0, 0); return;
    // Morph without a slide before it (the first slide of the show) fades in
    case 'morph':
    case 'fade':
      old();
      ctx.globalAlpha = p;
      ctx.drawImage(to, 0, 0);
      ctx.globalAlpha = 1;
      return;
    case 'push':
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (from) ctx.drawImage(from, dx * e * W, dy * e * H);
      ctx.drawImage(to, dx * (e - 1) * W, dy * (e - 1) * H);
      return;
    case 'cover':
      old();
      ctx.drawImage(to, dx * (e - 1) * W, dy * (e - 1) * H);
      return;
    case 'wipe': {
      old();
      ctx.save();
      ctx.beginPath();
      // the new slide is uncovered from the side it comes from
      if (dx < 0) ctx.rect(W * (1 - p), 0, W * p, H);
      else if (dx > 0) ctx.rect(0, 0, W * p, H);
      else if (dy < 0) ctx.rect(0, H * (1 - p), W, H * p);
      else ctx.rect(0, 0, W, H * p);
      ctx.clip();
      ctx.drawImage(to, 0, 0);
      ctx.restore();
    }
  }
}

/**
 * Plays a deck on a canvas: a click plays the slide's next animations, or goes on to the next
 * slide with its transition. A click while something is moving finishes it at once.
 */
export class Player {
  i = 0;
  /** Steps of the slide's animations played so far. */
  done = 0;
  private frames: SlideFrames | null = null;
  private moving: { kind: 'transition'; from: HTMLCanvasElement | null; to?: HTMLCanvasElement; t: Transition; t0: number; morph?: MorphFrames | null; was?: number; zoom?: { rect: Rect; out: boolean } } | { kind: 'step'; t0: number } | null = null;
  private raf = 0;
  private loops = 0;
  private timer = 0;
  private timeUp = false;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** Steps played on the slide before a change of slide (what a morph starts from). */
  private wasDone = 0;
  /** Called when a click goes past the last slide. */
  onPastEnd: () => void = () => {};
  /** Called after each change of slide or step (to update a counter, say). */
  onChange: () => void = () => {};
  /** Called when everything has stopped moving. */
  onIdle: () => void = () => {};

  /** Something is moving (a transition or animations). */
  get busy(): boolean { return this.moving !== null; }
  /** Steps of animations the slide has. */
  get stepCount(): number { return this.current.stepCount; }
  /** Where the slide showing sits on the canvas (CSS pixels; k is pixels per point). */
  get slidePlace(): { x: number; y: number; k: number } { return this.current.place; }

  /** The link at a point on the canvas (CSS pixels from its corner), if any. */
  linkAt(px: number, py: number): string | null {
    return this.moving ? null : this.current.linkAt(px, py);
  }

  /** What a click at a point does: a shape's action or zoom (with its box), else a link in the text. */
  actionAt(px: number, py: number): { link: string; zoom?: Shape['zoom']; rect?: Rect } | null {
    if (this.moving) return null;
    const sh = this.current.shapeActionAt(px, py);
    if (sh) return sh;
    const link = this.current.linkAt(px, py);
    return link ? { link } : null;
  }

  /**
   * Called when a click would go on to the next slide: true when the show has dealt with it
   * (coming back from a zoom).
   */
  beforeNextSlide: () => boolean = () => false;

  /**
   * Zoom into slide i from a box on the canvas (CSS pixels), or (`out`) back out of the slide
   * showing to slide i, shrinking into its box there.
   */
  zoom(i: number, rect: Rect, out = false): void {
    this.stop();
    const from = document.createElement('canvas');
    from.width = this.canvas.width;
    from.height = this.canvas.height;
    from.getContext('2d')?.drawImage(this.canvas, 0, 0);
    this.wasDone = this.done;
    this.i = i;
    this.frames = null;
    this.done = out ? this.current.stepCount : 0;
    this.timeUp = false;
    const d = this.dpr;
    this.moving = { kind: 'transition', from, t: { kind: 'fade', dur: 1 }, t0: performance.now(), zoom: { rect: { x1: rect.x1 * d, y1: rect.y1 * d, x2: rect.x2 * d, y2: rect.y2 * d }, out } };
    this.paint();
    this.loop();
    this.onChange();
  }

  constructor(private canvas: HTMLCanvasElement, private deck: Deck, private fill = '#000') {}

  resize(w: number, h: number, dpr: number): void {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.frames = null;
    this.paint();
  }

  /** Paint the slide again from scratch (a picture or font has loaded). */
  refresh(): void {
    this.frames = null;
    this.paint();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.moving = null;
    this.videos(false);
  }

  private vids = new Map<number, { el: HTMLMediaElement; media: Media; tick: number }>();
  /** Sounds playing on from slides before (Play Across Slides). */
  private carried: { el: HTMLMediaElement; media: Media; tick: number }[] = [];
  /** Media on the slides play without sound (presenter view: the audience's window has it). */
  quiet = false;

  /**
   * Videos play over the canvas, each in its picture's place (or the whole screen when it plays
   * full screen), and sounds unseen, while the slide is shown (not during a transition). They let
   * clicks through to the show; a click on one starts or pauses it (clickMedia). Each plays the
   * part of its file between its trims, at its volume, faded in and out, round and round unless
   * it plays once.
   */
  private videos(on: boolean): void {
    const host = this.canvas.parentElement;
    const spots = on && host ? [...this.current.videoSpots(this.done), ...this.current.hiddenSpots] : [];
    const keep = new Set(spots.map((s) => s.id));
    for (const [id, v] of this.vids) {
      if (keep.has(id)) continue;
      this.vids.delete(id);
      // a sound playing across slides goes on (not when the show stops)
      if (on && v.media.audio && v.media.across && !v.el.paused) { this.carried.push(v); continue; }
      this.drop(v);
    }
    if (!on) { for (const v of this.carried) this.drop(v); this.carried = []; }
    if (!host || !spots.length) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    for (const s of spots) {
      let v = this.vids.get(s.id);
      if (!v) {
        const m = s.media;
        const el = document.createElement(m.audio ? 'audio' : 'video');
        if (el instanceof HTMLVideoElement) el.playsInline = true;
        el.muted = this.quiet || !!m.mute;
        el.preload = 'auto';
        el.src = m.src;
        el.style.position = 'absolute';
        el.style.pointerEvents = 'none';
        el.style.objectFit = 'fill';
        if (m.audio) el.style.display = 'none';
        host.append(el);
        const win = () => playWindow(m, Number.isFinite(el.duration) ? el.duration : m.length);
        el.addEventListener('loadedmetadata', () => { if (el.currentTime < win().start) el.currentTime = win().start; });
        // trims, fades and looping, checked often while it plays
        const tick = window.setInterval(() => {
          if (el.paused) return;
          const w = win();
          if (el.currentTime < w.start - 0.05) el.currentTime = w.start;
          if (el.currentTime >= w.end - 0.03 || el.ended) {
            if (!m.once) { el.currentTime = w.start; void el.play().catch(() => {}); }
            else { el.pause(); if (m.rewind) el.currentTime = w.start; this.fullScreen(v!, false); }
          }
          if (!el.muted) el.volume = volumeAt(m, el.currentTime, Number.isFinite(el.duration) ? el.duration : m.length);
        }, 40);
        el.addEventListener('ended', () => { if (m.once) { if (m.rewind) el.currentTime = win().start; this.fullScreen(v!, false); } });
        v = { el, media: m, tick };
        this.vids.set(s.id, v);
        if (m.start !== 'click') this.play(v);
      }
      if (!v.media.audio) this.place(v.el, s);
    }
  }

  private place(el: HTMLMediaElement, s: { x: number; y: number; w: number; h: number }): void {
    const full = el.dataset.full === '1';
    el.style.left = `${this.canvas.offsetLeft + (full ? 0 : s.x)}px`;
    el.style.top = `${this.canvas.offsetTop + (full ? 0 : s.y)}px`;
    el.style.width = `${full ? this.w : s.w}px`;
    el.style.height = `${full ? this.h : s.h}px`;
    el.style.objectFit = full ? 'contain' : 'fill';
    el.style.background = full ? '#000' : '';
  }

  private play(v: { el: HTMLMediaElement; media: Media }): void {
    const el = v.el;
    if (!el.muted) el.volume = volumeAt(v.media, Math.max(el.currentTime, playWindow(v.media).start));
    this.fullScreen(v, true);
    void el.play().catch(() => {
      // sound may not play without a click in this window: play it silently instead
      if (el.muted) return;
      el.muted = true;
      void el.play().catch(() => { /* the still picture under it shows instead */ });
    });
  }

  /** A video that plays full screen fills the show while it plays. */
  private fullScreen(v: { el: HTMLMediaElement; media: Media }, on: boolean): void {
    if (v.media.audio || !v.media.full) return;
    v.el.dataset.full = on ? '1' : '';
    const s = this.current.videoSpots(this.done).find((x) => this.vids.get(x.id) === v);
    if (s) this.place(v.el, s);
  }

  private drop(v: { el: HTMLMediaElement; tick: number }): void {
    clearInterval(v.tick);
    v.el.pause();
    v.el.remove();
  }

  /** A click in the show on a video or a sound's icon starts or pauses it; false when there is none there. */
  clickMedia(px: number, py: number): boolean {
    if (this.moving) return false;
    for (const s of this.current.videoSpots(this.done)) {
      if (px < s.x || px > s.x + s.w || py < s.y || py > s.y + s.h) continue;
      const v = this.vids.get(s.id);
      if (!v) continue;
      if (v.el.paused) {
        const w = playWindow(v.media, Number.isFinite(v.el.duration) ? v.el.duration : v.media.length);
        if (v.el.currentTime >= w.end - 0.05) v.el.currentTime = w.start;
        this.play(v);
      } else { v.el.pause(); this.fullScreen(v, false); }
      return true;
    }
    return false;
  }

  /** Whether there is a video or sound to click at a point (for the pointer). */
  mediaAt(px: number, py: number): boolean {
    return !this.moving && this.current.videoSpots(this.done).some((s) => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h);
  }

  /** A morph from slide `was` (as it was left) to the slide now showing. */
  private morphFrom(was: number): MorphFrames | undefined {
    const s = this.deck.slides[was];
    if (!s) return undefined;
    const doc0 = this.deck.docOf(was), anims = s.anims ?? [];
    const parts = anims.length ? slideParts(doc0) : [];
    const states = anims.length ? partStates(parts, anims, this.wasDone, -1) : new Map();
    const gone = new Set<Part>([...states].filter(([, st]) => !st.visible).map(([p]) => p));
    try {
      return new MorphFrames(this.deck.page(was), doc0, gone, this.deck.page(this.i), this.deck.docOf(this.i), this.w, this.h, this.dpr, this.fill);
    } catch {
      return undefined;
    }
  }

  private framesFor(i: number): SlideFrames {
    const s = this.deck.slides[i];
    const page: SlidePage = this.deck.page(i);
    return new SlideFrames(page, this.deck.docOf(i), s.anims ?? [], this.w, this.h, this.dpr, this.fill);
  }

  private get current(): SlideFrames {
    if (!this.frames) this.frames = this.framesFor(this.i);
    return this.frames;
  }

  /** Show slide `i`: with its transition (from what is on screen now), or straight away; at its start or with everything played. */
  show(i: number, how: { transition?: boolean; atEnd?: boolean } = {}): void {
    this.stop();
    let from: HTMLCanvasElement | null = null;
    const t = this.deck.slides[i].transition;
    if (how.transition && t && t.kind !== 'none') {
      from = document.createElement('canvas');
      from.width = this.canvas.width;
      from.height = this.canvas.height;
      from.getContext('2d')?.drawImage(this.canvas, 0, 0);
    }
    const was = this.frames && this.i !== i ? this.i : undefined;
    this.wasDone = this.done;
    this.i = i;
    this.frames = null;
    this.done = how.atEnd ? this.current.stepCount : 0;
    this.timeUp = false;
    if (from && t) this.moving = { kind: 'transition', from, t, t0: performance.now(), ...(t.kind === 'morph' && was !== undefined ? { was, morph: null } : {}) };
    else this.arrived();
    this.paint();
    if (this.moving) this.loop();
    this.onChange();
  }

  /** The slide is fully in: start its automatic animations and its timer. */
  private arrived(): void {
    const st = this.current.steps[this.done];
    if (st?.auto && this.done === 0) this.moving = { kind: 'step', t0: performance.now() };
    const adv = this.deck.slides[this.i].transition?.advanceAfter;
    if (adv) {
      const i = this.i;
      this.timer = window.setTimeout(() => { if (this.i === i) { this.timeUp = true; this.idle(); } }, adv * 1000);
    }
  }

  /** Nothing moving: go on by itself if the slide's time is up and its animations have played. */
  private idle(): void {
    if (this.moving) return;
    this.onIdle();
    if (!this.timeUp) return;
    if (this.done < this.current.stepCount) this.playStep();
    else this.next();
  }

  private playStep(): void {
    this.moving = { kind: 'step', t0: performance.now() };
    this.loop();
  }

  /** A click: finish what is moving, else play the next animations, else go on to the next slide that isn't hidden. */
  next(): void {
    if (this.moving) { this.finish(); return; }
    if (this.done < this.current.stepCount) { this.playStep(); return; }
    if (this.beforeNextSlide()) return;
    // hidden slides (Hide Slide) are skipped
    const j = this.deck.shownAfter(this.i);
    if (j >= 0) this.show(j, { transition: true });
    else this.onPastEnd();
  }

  /** Back: undo the last animations, else the previous slide with everything played. */
  prev(): void {
    if (this.moving) this.finish();
    if (this.done > 0 && !(this.done === 1 && this.current.steps[0]?.auto)) {
      this.done--;
      this.paint();
      this.onChange();
      return;
    }
    const j = this.deck.shownBefore(this.i);
    if (j >= 0) this.show(j, { atEnd: true });
  }

  private finish(): void {
    const m = this.moving;
    this.moving = null;
    if (m?.kind === 'step') this.done = Math.min(this.current.stepCount, this.done + 1);
    // the slide is in: its automatic animations still play
    else if (m?.kind === 'transition') this.arrived();
    if (this.moving) { this.loop(); return; }
    this.paint();
    this.onChange();
    this.idle();
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    // one loop at a time: a paint that starts the next animation starts a new loop, and this one stops
    const gen = ++this.loops;
    const tick = () => {
      if (gen !== this.loops) return;
      this.paint();
      if (this.moving && gen === this.loops) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  paint(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const now = performance.now();
    const m = this.moving;
    if (m?.kind === 'transition') {
      this.videos(false);
      const p = Math.min(1, (now - m.t0) / 1000 / Math.max(0.01, m.t.dur));
      if (!m.to) {
        m.to = document.createElement('canvas');
        m.to.width = this.canvas.width;
        m.to.height = this.canvas.height;
        this.current.draw(m.to.getContext('2d')!, this.done);
      }
      if (m.morph === null && m.was !== undefined) m.morph = this.morphFrom(m.was);
      if (m.zoom) drawZoom(ctx, m.from!, m.to, m.zoom.rect, p, m.zoom.out, this.canvas.width, this.canvas.height);
      else if (m.morph) m.morph.draw(ctx, p);
      else drawTransition(ctx, m.from, m.to, m.t, p, this.canvas.width, this.canvas.height);
      if (p >= 1) {
        this.moving = null;
        this.arrived();
        this.videos(true);
        if (this.moving) this.loop();
        else this.idle();
      }
      return;
    }
    if (m?.kind === 'step') {
      const st = this.current.steps[this.done];
      const t = (now - m.t0) / 1000;
      if (!st || t >= st.length) {
        this.moving = null;
        this.done = Math.min(this.current.stepCount, this.done + 1);
        this.current.draw(ctx, this.done);
        this.videos(true);
        this.onChange();
        this.idle();
        return;
      }
      this.current.draw(ctx, this.done, t);
      return;
    }
    this.current.draw(ctx, this.done);
    this.videos(true);
  }
}
