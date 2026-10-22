// Pictures, shapes and text boxes floating over a sheet's cells (Excel's Insert > Pictures,
// Shapes and Text Box). Each sits at a cell corner plus an offset, like a chart, and is saved in
// .xlsx as Excel's own drawing objects.

import type { Chart } from './chart';

export type ShapeKind = 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow' | 'diamond' | 'pentagon' | 'hexagon' | 'star5' | 'line' | 'arrow';

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle', roundRect: 'Rounded rectangle', ellipse: 'Oval', triangle: 'Triangle', diamond: 'Diamond', pentagon: 'Pentagon', hexagon: 'Hexagon', star5: 'Star',
  rightArrow: 'Right arrow', leftArrow: 'Left arrow', upArrow: 'Up arrow', downArrow: 'Down arrow', line: 'Line', arrow: 'Line arrow',
};

/** How an object moves when the cells under it change size (Excel's Format > Properties). */
export type Placement = 'twoCell' | 'oneCell' | 'absolute';

export interface SheetObject {
  id: number;
  kind: 'picture' | 'shape' | 'text';
  /** Its top-left corner: a cell and an offset into it, in pixels at 100%. */
  at: Chart['at'];
  w: number;
  h: number;
  /** Turned clockwise, in degrees. */
  rot?: number;
  /** Lines: from the bottom-left to the top-right (unset: top-left to bottom-right). */
  flipV?: boolean;
  flipH?: boolean;
  /** Shapes (a text box is a rectangle). */
  shape?: ShapeKind;
  /** Pictures: a data: URL (PNG, JPEG, GIF or BMP). */
  src?: string;
  name?: string;
  /** Alt text. */
  descr?: string;
  /** Colours ('none' for none); unset: the default look of its kind. */
  fill?: string;
  line?: string;
  /** Line width in points. */
  lineW?: number;
  text?: string;
  font?: string;
  /** Points. */
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  placement?: Placement;
}

let nextId = 1;
export function newObjectId(): number { return nextId++; }
export function seenObjectId(id: number): void { if (id >= nextId) nextId = id + 1; }

/** Office's default look for new shapes (blue with a darker outline) and text boxes (white, thin black). */
export function objectLook(o: SheetObject): { fill: string; line: string; lineW: number; color: string } {
  const lineish = o.shape === 'line' || o.shape === 'arrow';
  if (o.kind === 'text') return { fill: o.fill ?? '#ffffff', line: o.line ?? '#000000', lineW: o.lineW ?? 0.75, color: o.color ?? '#000000' };
  if (o.kind === 'picture') return { fill: o.fill ?? 'none', line: o.line ?? 'none', lineW: o.lineW ?? 0.75, color: o.color ?? '#000000' };
  return { fill: lineish ? 'none' : o.fill ?? '#4472c4', line: o.line ?? (lineish ? '#4472c4' : '#2f528f'), lineW: o.lineW ?? (lineish ? 1.5 : 1), color: o.color ?? '#ffffff' };
}

export function isLine(o: SheetObject): boolean {
  return o.kind === 'shape' && (o.shape === 'line' || o.shape === 'arrow');
}

const n = (v: number) => Math.round(v * 100) / 100;

/** The outline of a shape `w` × `h` as an SVG path (also drawn on the canvas with Path2D). */
export function shapePath(kind: ShapeKind, w: number, h: number, flipV = false): string {
  const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${n(x * w)} ${n(y * h)}`).join('L')}Z`;
  switch (kind) {
    case 'ellipse': {
      const rx = w / 2, ry = h / 2;
      return `M0 ${n(ry)}A${n(rx)} ${n(ry)} 0 1 0 ${n(w)} ${n(ry)}A${n(rx)} ${n(ry)} 0 1 0 0 ${n(ry)}Z`;
    }
    case 'roundRect': {
      // Office's default corner: a sixth of the shorter side
      const r = Math.min(w, h) / 6;
      return `M${n(r)} 0H${n(w - r)}Q${n(w)} 0 ${n(w)} ${n(r)}V${n(h - r)}Q${n(w)} ${n(h)} ${n(w - r)} ${n(h)}H${n(r)}Q0 ${n(h)} 0 ${n(h - r)}V${n(r)}Q0 0 ${n(r)} 0Z`;
    }
    case 'triangle': return poly([[0.5, 0], [1, 1], [0, 1]]);
    case 'diamond': return poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case 'pentagon': return poly([[0.5, 0], [1, 0.382], [0.809, 1], [0.191, 1], [0, 0.382]]);
    case 'hexagon': return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    case 'star5': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.38 : 1;
        pts.push([0.5 + 0.5 * r * Math.cos(a), 0.53 + 0.5 * r * Math.sin(a)]);
      }
      return poly(pts);
    }
    case 'rightArrow': return poly([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]]);
    case 'leftArrow': return poly([[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]]);
    case 'upArrow': return poly([[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]]);
    case 'downArrow': return poly([[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]]);
    case 'line': case 'arrow':
      return flipV ? `M0 ${n(h)}L${n(w)} 0` : `M0 0L${n(w)} ${n(h)}`;
    default: return `M0 0H${n(w)}V${n(h)}H0Z`;
  }
}

/** A line arrow's head at its end, as a filled path. */
export function arrowHead(o: SheetObject, w: number, h: number, lineW: number): string | null {
  if (o.shape !== 'arrow') return null;
  const [x1, y1, x2, y2] = lineEnds(o, w, h);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const L = Math.max(6, lineW * 4), W = Math.max(3, lineW * 2.2);
  const bx = x2 - ux * L, by = y2 - uy * L;
  return `M${n(x2)} ${n(y2)}L${n(bx - uy * W)} ${n(by + ux * W)}L${n(bx + uy * W)} ${n(by - ux * W)}Z`;
}

/** Where a line starts and ends in its box (the arrow head is at the end). */
export function lineEnds(o: SheetObject, w: number, h: number): [number, number, number, number] {
  let [x1, y1, x2, y2] = o.flipV ? [0, h, w, 0] : [0, 0, w, h];
  if (o.flipH) [x1, x2] = [x2, x1];
  return [x1, y1, x2, y2];
}

/** A shape (with its text) or picture as SVG, at its own size (for printing and pictures). */
export function objectSvg(o: SheetObject): string {
  const look = objectLook(o);
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const parts: string[] = [];
  const lw = (look.lineW * 4) / 3;
  if (o.kind === 'picture' && o.src) parts.push(`<image href="${esc(o.src)}" x="0" y="0" width="${o.w}" height="${o.h}" preserveAspectRatio="none"/>`);
  const shape = o.kind === 'picture' ? 'rect' : o.shape ?? 'rect';
  if (o.kind !== 'picture' || look.line !== 'none') {
    const d = shapePath(shape, o.w, o.h, o.flipV);
    const lineish = isLine(o);
    parts.push(`<path d="${lineish ? lineD(o) : d}" fill="${lineish || o.kind === 'picture' ? 'none' : look.fill}" stroke="${look.line}" stroke-width="${n(lw)}"/>`);
    const head = arrowHead(o, o.w, o.h, lw);
    if (head) parts.push(`<path d="${head}" fill="${look.line}"/>`);
  }
  const rot = o.rot ? ` transform="rotate(${o.rot} ${o.w / 2} ${o.h / 2})"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.w}" height="${o.h}" viewBox="0 0 ${o.w} ${o.h}" overflow="visible"><g${rot}>${parts.join('')}</g></svg>`;
}

function lineD(o: SheetObject): string {
  const [x1, y1, x2, y2] = lineEnds(o, o.w, o.h);
  return `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;
}

/** Bytes and type of a data: URL (pictures saved to .xlsx). */
export function dataUrlBytes(src: string): { bytes: Uint8Array; ext: string; mime: string } | null {
  const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(src);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = mime === 'image/jpeg' ? 'jpeg' : mime === 'image/gif' ? 'gif' : mime === 'image/bmp' ? 'bmp' : mime === 'image/svg+xml' ? 'svg' : 'png';
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext, mime };
}

/** A picture file's bytes as a data: URL (by its name's extension); null for a kind a page can't show. */
export function bytesDataUrl(bytes: Uint8Array, name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'svg' ? 'image/svg+xml' : null;
  if (!mime) return null;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}
