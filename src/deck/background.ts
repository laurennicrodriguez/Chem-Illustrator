// Slide backgrounds (Design > Format Background, as in PowerPoint): a colour, a gradient, a
// picture (stretched, filling, fitting or tiled) or a pattern, each see-through over white to the
// amount chosen. A slide can have its own background or use the master's; title slides can
// have their own too. Everything here maps onto PowerPoint's own background settings, so a
// background made here is PowerPoint's background in the saved file, and one made in PowerPoint
// comes in as it was.

import { mix } from '../render/fills';
import { imageFor } from '../render/images';

/** A colour stop of a gradient: where it is (0 to 1 along the gradient), its colour, and how see-through it is (0 to 1). */
export interface GradientStop { pos: number; color: string; transparency?: number }

/** Where a picture's tiles start, as PowerPoint names the points of the slide. */
export type TileAlign = 'tl' | 't' | 'tr' | 'l' | 'ctr' | 'r' | 'bl' | 'b' | 'br';
export type TileMirror = 'none' | 'x' | 'y' | 'xy';

/** The four sides of a box, as fractions of its width (l, r) and height (t, b). */
export interface Sides { l: number; t: number; r: number; b: number }

export type Background =
  | { kind: 'solid'; color: string; transparency?: number }
  | {
    kind: 'gradient';
    /** Along a line, in circles out from a point, or in rectangles out from a point. */
    shape: 'linear' | 'radial' | 'rect';
    /** A linear gradient's direction, in degrees clockwise from left-to-right. */
    angle: number;
    /** A linear gradient's angle is in the slide stretched to a square (PowerPoint's "scaled"), so 45° runs corner to corner. */
    scaled?: boolean;
    /** Where a radial or rectangular gradient starts, as fractions of the slide (0.5, 0.5 is the middle). */
    focus?: { x: number; y: number };
    stops: GradientStop[];
  }
  | {
    kind: 'picture';
    src: string;
    px: { w: number; h: number };
    /**
     * Stretch to the slide (PowerPoint's own), fill it keeping the picture's proportions (the
     * edges that stick out are cut off), fit it whole (white shows at the sides), or tile it.
     */
    fit: 'stretch' | 'fill' | 'fit' | 'tile';
    transparency?: number;
    /** Stretch: the part of the picture used (fractions cut off each side). */
    crop?: Sides;
    /** Stretch: how far in from each edge of the slide the picture stops (fractions; negative goes past the edge). */
    offsets?: Sides;
    /** Tile: the size of each tile (1 is the picture's own size), where tiling starts, and mirrored tiles. */
    tile?: { sx: number; sy: number; tx: number; ty: number; align: TileAlign; mirror: TileMirror };
  }
  | { kind: 'pattern'; pattern: PatternId; fg: string; bg: string };

/** A plain colour. */
export const solid = (color: string): Background => ({ kind: 'solid', color });

/** The one colour that stands for a background (behind the drawing, in files that keep only a colour). */
export function backgroundColour(bg: Background): string {
  switch (bg.kind) {
    case 'solid': return bg.transparency ? mix('#ffffff', bg.color, 1 - clamp01(bg.transparency)) : bg.color;
    case 'gradient': {
      const s = bg.stops[0];
      return s ? (s.transparency ? mix('#ffffff', s.color, 1 - clamp01(s.transparency)) : s.color) : '#ffffff';
    }
    case 'pattern': return bg.bg;
    default: return '#ffffff';
  }
}

/** True for a background that is just a colour (which older settings keep as a colour). */
export const isPlain = (bg: Background): bg is { kind: 'solid'; color: string } => bg.kind === 'solid' && !bg.transparency;

export const clamp01 = (v: number | undefined) => Math.max(0, Math.min(1, v ?? 0));

/** A copy (for undo and for slides copied from others). */
export function copyBackground(bg: Background): Background {
  return JSON.parse(JSON.stringify(bg));
}

export const sameBackground = (a: Background | undefined, b: Background | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------- gradients

/** Gradient directions offered, as PowerPoint offers them. */
export const LINEAR_DIRECTIONS: { name: string; angle: number }[] = [
  { name: 'Top to bottom', angle: 90 }, { name: 'Bottom to top', angle: 270 },
  { name: 'Left to right', angle: 0 }, { name: 'Right to left', angle: 180 },
  { name: 'Top left to bottom right', angle: 45 }, { name: 'Top right to bottom left', angle: 135 },
  { name: 'Bottom left to top right', angle: 315 }, { name: 'Bottom right to top left', angle: 225 },
];

export const FOCUS_POINTS: { name: string; x: number; y: number }[] = [
  { name: 'From the centre', x: 0.5, y: 0.5 },
  { name: 'From the top left corner', x: 0, y: 0 }, { name: 'From the top right corner', x: 1, y: 0 },
  { name: 'From the bottom left corner', x: 0, y: 1 }, { name: 'From the bottom right corner', x: 1, y: 1 },
  { name: 'From the top', x: 0.5, y: 0 }, { name: 'From the bottom', x: 0.5, y: 1 },
];

/** Ready-made gradients to start from (light ones keep black structures easy to read). */
export const GRADIENT_PRESETS: { name: string; bg: Background }[] = [
  { name: 'White to light grey', bg: { kind: 'gradient', shape: 'linear', angle: 90, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#e3e6ea' }] } },
  { name: 'Pale blue', bg: { kind: 'gradient', shape: 'linear', angle: 90, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#d6e4f5' }] } },
  { name: 'Mint', bg: { kind: 'gradient', shape: 'linear', angle: 45, stops: [{ pos: 0, color: '#f7fbf8' }, { pos: 1, color: '#d3eadb' }] } },
  { name: 'Warm paper', bg: { kind: 'gradient', shape: 'linear', angle: 90, stops: [{ pos: 0, color: '#fffdf8' }, { pos: 1, color: '#efe6d6' }] } },
  { name: 'Soft spotlight', bg: { kind: 'gradient', shape: 'radial', angle: 0, focus: { x: 0.5, y: 0.5 }, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#d9dde3' }] } },
  { name: 'Corner glow', bg: { kind: 'gradient', shape: 'radial', angle: 0, focus: { x: 0, y: 0 }, stops: [{ pos: 0, color: '#e8f0fb' }, { pos: 0.6, color: '#ffffff' }, { pos: 1, color: '#ffffff' }] } },
  { name: 'Navy to blue', bg: { kind: 'gradient', shape: 'linear', angle: 90, stops: [{ pos: 0, color: '#0f1b2d' }, { pos: 1, color: '#2f5d8a' }] } },
  { name: 'Charcoal vignette', bg: { kind: 'gradient', shape: 'radial', angle: 0, focus: { x: 0.5, y: 0.5 }, stops: [{ pos: 0, color: '#3a414b' }, { pos: 1, color: '#15181d' }] } },
  { name: 'Sunrise', bg: { kind: 'gradient', shape: 'linear', angle: 90, stops: [{ pos: 0, color: '#fff3e0' }, { pos: 0.55, color: '#ffe0c2' }, { pos: 1, color: '#f9c6c9' }] } },
  { name: 'Frame', bg: { kind: 'gradient', shape: 'rect', angle: 0, focus: { x: 0.5, y: 0.5 }, stops: [{ pos: 0, color: '#ffffff' }, { pos: 0.75, color: '#ffffff' }, { pos: 1, color: '#cfd6df' }] } },
];

/** The stops in order, at least two. */
export function sortedStops(stops: GradientStop[]): GradientStop[] {
  const s = stops.map((x) => ({ ...x, pos: clamp01(x.pos) })).sort((a, b) => a.pos - b.pos);
  if (!s.length) return [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#ffffff' }];
  if (s.length === 1) return [s[0], { ...s[0], pos: 1 }];
  return s;
}

const rgba = (hex: string, transparency?: number): string => {
  const n = parseInt(hex.replace('#', '').padStart(6, '0').slice(-6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${1 - clamp01(transparency)})`;
};

/**
 * Where a linear gradient runs on a w × h box: from p0 (0) to p1 (1), so the first and last
 * colours just touch opposite corners, as in PowerPoint.
 */
export function linearEnds(angle: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const half = (Math.abs(w * c) + Math.abs(h * s)) / 2;
  return { x0: w / 2 - c * half, y0: h / 2 - s * half, x1: w / 2 + c * half, y1: h / 2 + s * half };
}

function addStops(g: CanvasGradient, stops: GradientStop[]): void {
  for (const s of sortedStops(stops)) g.addColorStop(s.pos, rgba(s.color, s.transparency));
}

/** How far (in points) each part of a rectangular gradient reaches into the next. */
const SEAM = 0.6;

function paintGradient(ctx: CanvasRenderingContext2D, bg: Extract<Background, { kind: 'gradient' }>, w: number, h: number): void {
  const fx = (bg.focus?.x ?? 0.5) * w, fy = (bg.focus?.y ?? 0.5) * h;
  if (bg.shape === 'linear') {
    ctx.save();
    // a scaled angle is in the slide squashed to a square: work there and stretch back
    const sw = bg.scaled ? 1 : w, sh = bg.scaled ? 1 : h;
    if (bg.scaled) ctx.scale(w, h);
    const e = linearEnds(bg.angle, sw, sh);
    const g = ctx.createLinearGradient(e.x0, e.y0, e.x1, e.y1);
    addStops(g, bg.stops);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sw, sh);
    ctx.restore();
  } else if (bg.shape === 'radial') {
    const r = Math.max(Math.hypot(fx, fy), Math.hypot(w - fx, fy), Math.hypot(fx, h - fy), Math.hypot(w - fx, h - fy)) || 1;
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
    addStops(g, bg.stops);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    // rectangles growing from the focus to the slide's edges: four triangles, each a linear gradient towards its edge
    const sides: [number, number, number, number, number, number, number, number][] = [
      [0, 0, w, 0, fx, fy, fx, 0], // top: from the focus up to the top edge
      [w, 0, w, h, fx, fy, w, fy],
      [w, h, 0, h, fx, fy, fx, h],
      [0, h, 0, 0, fx, fy, 0, fy],
    ];
    // each triangle reaches a little past its two diagonals, so no seam shows where they meet
    const out = (px: number, py: number, qx: number, qy: number) => {
      let nx = -(py - fy), ny = px - fx;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      if (nx * (qx - fx) + ny * (qy - fy) > 0) { nx = -nx; ny = -ny; }
      return { x: nx * SEAM, y: ny * SEAM };
    };
    for (const [ax, ay, bx, by, gx0, gy0, gx1, gy1] of sides) {
      if (Math.hypot(gx1 - gx0, gy1 - gy0) < 1e-6) continue;
      const na = out(ax, ay, bx, by), nb = out(bx, by, ax, ay);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(fx + na.x, fy + na.y);
      ctx.lineTo(ax + na.x, ay + na.y);
      ctx.lineTo(bx + nb.x, by + nb.y);
      ctx.lineTo(fx + nb.x, fy + nb.y);
      ctx.closePath();
      ctx.clip();
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      addStops(g, bg.stops);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------- pictures

/** Points per pixel of a picture at its own size (96 pixels to the inch, as PowerPoint takes it). */
export const PT_PER_PX = 0.75;

/** Stretch, fill and fit as the part of the picture used and where it goes (fractions), as PowerPoint keeps them. */
export function pictureFrame(bg: Extract<Background, { kind: 'picture' }>, w: number, h: number): { crop: Sides; offsets: Sides } {
  const none: Sides = { l: 0, t: 0, r: 0, b: 0 };
  const pr = bg.px.w / Math.max(1, bg.px.h), sr = w / Math.max(1e-6, h);
  if (bg.fit === 'fill') {
    // cut the sides (or top and bottom) that stick out, equally
    if (pr > sr) { const c = (1 - sr / pr) / 2; return { crop: { l: c, t: 0, r: c, b: 0 }, offsets: none }; }
    const c = (1 - pr / sr) / 2;
    return { crop: { l: 0, t: c, r: 0, b: c }, offsets: none };
  }
  if (bg.fit === 'fit') {
    if (pr > sr) { const o = (1 - sr / pr) / 2; return { crop: none, offsets: { l: 0, t: o, r: 0, b: o } }; }
    const o = (1 - pr / sr) / 2;
    return { crop: none, offsets: { l: o, t: 0, r: o, b: 0 } };
  }
  return { crop: bg.crop ?? none, offsets: bg.offsets ?? none };
}

/** Where tiling starts on a w × h slide, for a tile tw × th. */
export function tileOrigin(align: TileAlign, w: number, h: number, tw: number, th: number): { x: number; y: number } {
  const x = align.endsWith('l') ? 0 : align.endsWith('r') ? w - tw : (w - tw) / 2;
  const y = align.startsWith('t') ? 0 : align.startsWith('b') ? h - th : (h - th) / 2;
  return { x, y };
}

const DEFAULT_TILE = { sx: 1, sy: 1, tx: 0, ty: 0, align: 'tl' as TileAlign, mirror: 'none' as TileMirror };

function paintPicture(ctx: CanvasRenderingContext2D, bg: Extract<Background, { kind: 'picture' }>, w: number, h: number): void {
  const img = imageFor(bg.src);
  if (!img) return; // drawn once it has loaded
  ctx.save();
  ctx.globalAlpha = 1 - clamp01(bg.transparency);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  const iw = img.naturalWidth || bg.px.w, ih = img.naturalHeight || bg.px.h;
  if (bg.fit === 'tile') {
    const t = { ...DEFAULT_TILE, ...bg.tile };
    const tw = bg.px.w * PT_PER_PX * t.sx, th = bg.px.h * PT_PER_PX * t.sy;
    if (tw > 0.5 && th > 0.5) {
      let source: CanvasImageSource = img;
      if (t.mirror !== 'none' && typeof document !== 'undefined') {
        // one tile and its mirror images, side by side and one above the other
        const mx = t.mirror === 'x' || t.mirror === 'xy', my = t.mirror === 'y' || t.mirror === 'xy';
        const c = document.createElement('canvas');
        c.width = iw * (mx ? 2 : 1);
        c.height = ih * (my ? 2 : 1);
        const g = c.getContext('2d');
        if (g) {
          for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            if ((fx && !mx) || (fy && !my)) continue;
            g.setTransform(fx ? -1 : 1, 0, 0, fy ? -1 : 1, fx ? 2 * iw : 0, fy ? 2 * ih : 0);
            g.drawImage(img, 0, 0, iw, ih);
          }
          source = c;
        }
      }
      const pat = ctx.createPattern(source, 'repeat');
      if (pat) {
        const o = tileOrigin(t.align, w, h, tw, th);
        pat.setTransform(new DOMMatrix([tw / iw, 0, 0, th / ih, o.x + t.tx, o.y + t.ty]));
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, w, h);
      }
    }
  } else {
    const { crop, offsets } = pictureFrame(bg, w, h);
    const sx = crop.l * iw, sy = crop.t * ih, sw = Math.max(1e-3, (1 - crop.l - crop.r) * iw), sh = Math.max(1e-3, (1 - crop.t - crop.b) * ih);
    const dx = offsets.l * w, dy = offsets.t * h, dw = (1 - offsets.l - offsets.r) * w, dh = (1 - offsets.t - offsets.b) * h;
    if (dw > 0 && dh > 0) ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- patterns

/** PowerPoint's patterns, by its own names (ECMA-376 ST_PresetPatternVal). */
export type PatternId =
  | 'pct5' | 'pct10' | 'pct20' | 'pct25' | 'pct30' | 'pct40' | 'pct50' | 'pct60' | 'pct70' | 'pct75' | 'pct80' | 'pct90'
  | 'horz' | 'vert' | 'ltHorz' | 'ltVert' | 'dkHorz' | 'dkVert' | 'narHorz' | 'narVert' | 'dashHorz' | 'dashVert'
  | 'cross' | 'dnDiag' | 'upDiag' | 'ltDnDiag' | 'ltUpDiag' | 'dkDnDiag' | 'dkUpDiag' | 'wdDnDiag' | 'wdUpDiag' | 'dashDnDiag' | 'dashUpDiag'
  | 'diagCross' | 'smCheck' | 'lgCheck' | 'smGrid' | 'lgGrid' | 'dotGrid' | 'smConfetti' | 'lgConfetti' | 'horzBrick' | 'diagBrick'
  | 'solidDmnd' | 'openDmnd' | 'dotDmnd' | 'plaid' | 'sphere' | 'weave' | 'divot' | 'shingle' | 'wave' | 'trellis' | 'zigZag';

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];
type Bits = (x: number, y: number) => boolean;
const pct = (p: number): Bits => (x, y) => BAYER[y][x] < Math.round((p / 100) * 64);
const rows = (...r: string[]): Bits => (x, y) => r[y][x] === '#';
const mod = (v: number, p: number) => ((v % p) + p) % p;
const down = (p: number, wd: number): Bits => (x, y) => mod(x - y, p) < wd;
const up = (p: number, wd: number): Bits => (x, y) => mod(x + y, p) < wd;
const turn = (b: Bits): Bits => (x, y) => b(y, x);
const horzLines = (every: number, wd: number): Bits => (_x, y) => mod(y, every) < wd;

const PATTERN_BITS: Record<PatternId, Bits> = {
  pct5: pct(5), pct10: pct(10), pct20: pct(20), pct25: pct(25), pct30: pct(30), pct40: pct(40), pct50: pct(50),
  pct60: pct(60), pct70: pct(70), pct75: pct(75), pct80: pct(80), pct90: pct(90),
  horz: horzLines(8, 1), ltHorz: horzLines(4, 1), narHorz: horzLines(2, 1), dkHorz: horzLines(4, 2),
  vert: turn(horzLines(8, 1)), ltVert: turn(horzLines(4, 1)), narVert: turn(horzLines(2, 1)), dkVert: turn(horzLines(4, 2)),
  dashHorz: rows('####....', '........', '........', '........', '....####', '........', '........', '........'),
  dashVert: turn(rows('####....', '........', '........', '........', '....####', '........', '........', '........')),
  dnDiag: down(8, 1), upDiag: up(8, 1), ltDnDiag: down(4, 1), ltUpDiag: up(4, 1), dkDnDiag: down(4, 2), dkUpDiag: up(4, 2),
  wdDnDiag: down(8, 3), wdUpDiag: up(8, 3),
  dashDnDiag: (x, y) => mod(x - y, 4) === 0 && mod(y, 8) < 4,
  dashUpDiag: (x, y) => mod(x + y, 4) === 0 && mod(y, 8) < 4,
  cross: (x, y) => x === 0 || y === 0, smGrid: (x, y) => x % 4 === 0 || y % 4 === 0, lgGrid: (x, y) => x === 0 || y === 0,
  dotGrid: (x, y) => (y === 0 && x % 2 === 0) || (x === 0 && y % 2 === 0),
  diagCross: (x, y) => mod(x - y, 8) === 0 || mod(x + y, 8) === 0,
  smCheck: (x, y) => ((x >> 1) + (y >> 1)) % 2 === 0, lgCheck: (x, y) => ((x >> 2) + (y >> 2)) % 2 === 0,
  smConfetti: rows('#.......', '....#...', '..#.....', '......#.', '.#......', '.....#..', '...#....', '.......#'),
  lgConfetti: rows('##......', '##..##..', '....##..', '.##...##', '.##...##', '....##..', '#...##..', '#......#'),
  horzBrick: rows('########', '#.......', '#.......', '#.......', '########', '....#...', '....#...', '....#...'),
  diagBrick: rows('.......#', '......#.', '.....#..', '....#...', '...##...', '..#..#..', '.#....#.', '#......#'),
  solidDmnd: rows('...#....', '..###...', '.#####..', '#######.', '.#####..', '..###...', '...#....', '........'),
  openDmnd: rows('...#....', '..#.#...', '.#...#..', '#.....#.', '.#...#..', '..#.#...', '...#....', '........'),
  dotDmnd: (x, y) => (mod(x - y, 8) === 0 || mod(x + y, 8) === 0) && x % 2 === 0,
  plaid: rows('#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#', '####....', '####....', '####....', '####....'),
  sphere: rows('.######.', '#..##..#', '#.#..#.#', '##....##', '##....##', '#.#..#.#', '#..##..#', '.######.'),
  weave: rows('#...#...', '.#.#.#..', '..#...#.', '.#.#...#', '#...#...', '...#.#.#', '..#...#.', '.#...#.#'),
  divot: rows('........', '...#....', '....#...', '...#....', '........', '#.......', '.......#', '#.......'),
  shingle: rows('##.....#', '..#.....', '...#....', '...#....', '....#...', '.....##.', '#.....#.', '.#.....#'),
  wave: rows('........', '...##...', '..#..#.#', '##....#.', '........', '...##...', '..#..#.#', '##....#.'),
  trellis: rows('#..##..#', '.##..##.', '.##..##.', '#..##..#', '#..##..#', '.##..##.', '.##..##.', '#..##..#'),
  zigZag: rows('#......#', '.#....#.', '..#..#..', '...##...', '#......#', '.#....#.', '..#..#..', '...##...'),
};

/** The patterns offered, in PowerPoint's order, with plain names. */
export const PATTERN_LIST: { id: PatternId; name: string }[] = [
  ...([5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90] as const).map((p) => ({ id: `pct${p}` as PatternId, name: `${p}% dots` })),
  { id: 'ltDnDiag', name: 'Light downward diagonal' }, { id: 'ltUpDiag', name: 'Light upward diagonal' },
  { id: 'dkDnDiag', name: 'Dark downward diagonal' }, { id: 'dkUpDiag', name: 'Dark upward diagonal' },
  { id: 'wdDnDiag', name: 'Wide downward diagonal' }, { id: 'wdUpDiag', name: 'Wide upward diagonal' },
  { id: 'dnDiag', name: 'Downward diagonal' }, { id: 'upDiag', name: 'Upward diagonal' },
  { id: 'dashDnDiag', name: 'Dashed downward diagonal' }, { id: 'dashUpDiag', name: 'Dashed upward diagonal' },
  { id: 'ltHorz', name: 'Light horizontal' }, { id: 'ltVert', name: 'Light vertical' },
  { id: 'narHorz', name: 'Narrow horizontal' }, { id: 'narVert', name: 'Narrow vertical' },
  { id: 'dkHorz', name: 'Dark horizontal' }, { id: 'dkVert', name: 'Dark vertical' },
  { id: 'horz', name: 'Horizontal' }, { id: 'vert', name: 'Vertical' },
  { id: 'dashHorz', name: 'Dashed horizontal' }, { id: 'dashVert', name: 'Dashed vertical' },
  { id: 'smGrid', name: 'Small grid' }, { id: 'lgGrid', name: 'Large grid' }, { id: 'cross', name: 'Cross' }, { id: 'dotGrid', name: 'Dotted grid' },
  { id: 'smCheck', name: 'Small checkerboard' }, { id: 'lgCheck', name: 'Large checkerboard' },
  { id: 'diagCross', name: 'Diagonal cross' }, { id: 'openDmnd', name: 'Outlined diamond' }, { id: 'solidDmnd', name: 'Solid diamond' }, { id: 'dotDmnd', name: 'Dotted diamond' },
  { id: 'smConfetti', name: 'Small confetti' }, { id: 'lgConfetti', name: 'Large confetti' },
  { id: 'horzBrick', name: 'Horizontal brick' }, { id: 'diagBrick', name: 'Diagonal brick' },
  { id: 'plaid', name: 'Plaid' }, { id: 'sphere', name: 'Sphere' }, { id: 'weave', name: 'Weave' }, { id: 'divot', name: 'Divot' },
  { id: 'shingle', name: 'Shingle' }, { id: 'wave', name: 'Wave' }, { id: 'trellis', name: 'Trellis' }, { id: 'zigZag', name: 'Zig zag' },
];

export const isPatternId = (s: string): s is PatternId => s in PATTERN_BITS;

/** Does the pattern's 8 × 8 cell have its foreground colour at (x, y)? */
export const patternBit = (p: PatternId, x: number, y: number): boolean => (PATTERN_BITS[p] ?? PATTERN_BITS.pct50)(mod(x, 8), mod(y, 8));

/** A pattern cell is 8 pixels at 96 to the inch: 6 points on the slide. */
export const PATTERN_CELL = 6;

const patternCanvases = new Map<string, HTMLCanvasElement>();

/** One cell of the pattern, drawn large so it stays sharp when zoomed in. */
function patternCanvas(p: PatternId, fg: string, bg: string): HTMLCanvasElement | null {
  const key = `${p} ${fg} ${bg}`;
  let c = patternCanvases.get(key);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  const K = 8; // device pixels per pattern pixel
  c = document.createElement('canvas');
  c.width = c.height = 8 * K;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = bg;
  g.fillRect(0, 0, 8 * K, 8 * K);
  g.fillStyle = fg;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (patternBit(p, x, y)) g.fillRect(x * K, y * K, K, K);
  if (patternCanvases.size > 64) patternCanvases.clear();
  patternCanvases.set(key, c);
  return c;
}

function paintPattern(ctx: CanvasRenderingContext2D, bg: Extract<Background, { kind: 'pattern' }>, w: number, h: number): void {
  const c = patternCanvas(bg.pattern, bg.fg, bg.bg);
  const pat = c ? ctx.createPattern(c, 'repeat') : null;
  if (!pat) { ctx.fillStyle = bg.bg; ctx.fillRect(0, 0, w, h); return; }
  pat.setTransform(new DOMMatrix([PATTERN_CELL / c!.width, 0, 0, PATTERN_CELL / c!.height, 0, 0]));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------- drawing

/** A vector picture being recorded (PDF pages, printing) rather than a canvas. */
interface Recorder { picture(s: { src: string; px?: { w: number; h: number }; x1: number; y1: number; x2: number; y2: number; crop?: Sides }): void }
const recording = (ctx: CanvasRenderingContext2D): Recorder | null => ('picture' in ctx ? (ctx as unknown as Recorder) : null);

/** A background on a canvas (in slide points), a w × h slide from (0, 0). See-through backgrounds are over white. */
export function paintBackground(ctx: CanvasRenderingContext2D, bg: Background, w: number, h: number): void {
  const rec = recording(ctx);
  if (rec) { recordBackground(ctx, rec, bg, w, h); return; }
  if (bg.kind !== 'solid' || bg.transparency) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  switch (bg.kind) {
    case 'solid':
      ctx.fillStyle = bg.transparency ? rgba(bg.color, bg.transparency) : bg.color;
      ctx.fillRect(0, 0, w, h);
      break;
    case 'gradient': paintGradient(ctx, bg, w, h); break;
    case 'picture': paintPicture(ctx, bg, w, h); break;
    case 'pattern': paintPattern(ctx, bg, w, h); break;
  }
}

const rendered = new Map<string, string>();

/**
 * A background in a vector picture: a colour stays a colour and a plain stretched picture stays
 * the picture; gradients, patterns, tiles and see-through pictures go in as a picture of
 * themselves (where nothing can draw them, as their main colour).
 */
function recordBackground(ctx: CanvasRenderingContext2D, rec: Recorder, bg: Background, w: number, h: number): void {
  ctx.fillStyle = backgroundColour(bg);
  ctx.fillRect(0, 0, w, h);
  if (bg.kind === 'solid') return;
  if (bg.kind === 'picture' && bg.fit !== 'tile' && !bg.transparency) {
    const { crop, offsets } = pictureFrame(bg, w, h);
    const x1 = offsets.l * w, y1 = offsets.t * h, x2 = w - offsets.r * w, y2 = h - offsets.b * h;
    // a picture past the slide's edges is cut back to the slide
    const cut = (a: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, a));
    const cx1 = cut(x1, 0, w), cy1 = cut(y1, 0, h), cx2 = cut(x2, 0, w), cy2 = cut(y2, 0, h);
    if (cx2 <= cx1 || cy2 <= cy1) return;
    const fw = (1 - crop.l - crop.r) / Math.max(1e-6, x2 - x1), fh = (1 - crop.t - crop.b) / Math.max(1e-6, y2 - y1);
    rec.picture({
      src: bg.src, px: bg.px, x1: cx1, y1: cy1, x2: cx2, y2: cy2,
      crop: { l: crop.l + (cx1 - x1) * fw, t: crop.t + (cy1 - y1) * fh, r: crop.r + (x2 - cx2) * fw, b: crop.b + (y2 - cy2) * fh },
    });
    return;
  }
  const png = backgroundPicture(bg, w, h);
  if (png) rec.picture({ src: png.src, px: png.px, x1: 0, y1: 0, x2: w, y2: h });
}

/** A background drawn as a PNG picture (about 2000 pixels across), or null where there is no canvas. */
export function backgroundPicture(bg: Background, w: number, h: number): { src: string; px: { w: number; h: number } } | null {
  if (typeof document === 'undefined') return null;
  const k = Math.min(4, 2000 / Math.max(w, h, 1));
  const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
  const key = `${pw}x${ph} ${JSON.stringify(bg)}`;
  const had = rendered.get(key);
  if (had) return { src: had, px: { w: pw, h: ph } };
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  const g = c.getContext('2d');
  if (!g) return null;
  if (bg.kind === 'picture' && !imageFor(bg.src)) return null; // not loaded yet
  g.setTransform(k, 0, 0, k, 0, 0);
  paintBackground(g, bg, w, h);
  let src: string;
  try { src = c.toDataURL('image/png'); } catch { return null; }
  if (!src.startsWith('data:image/png')) return null;
  if (rendered.size > 24) rendered.clear();
  rendered.set(key, src);
  return { src, px: { w: pw, h: ph } };
}
