// Design mode's shape library: basic shapes, block arrows, flowchart symbols, callouts and lab
// equipment, each drawn from its box (x, y, w, h) as lines and Bézier curves, so the same
// outline goes to the screen, SVG, PDF and EMF pictures, and PowerPoint. Shapes PowerPoint has
// as a preset are saved as that preset (so PowerPoint can still edit them as its own); the
// others (lab equipment, our callouts) are saved as PowerPoint custom shapes with these outlines.
// The lab equipment is drawn here, from simple outlines (no outside artwork).

import type { Rect, Vec } from '../geom';
import type { Shape } from '../model';
import { iconDef, isIconId } from './icons';

export type GeoStep =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export type GeoGroup = 'Basic shapes' | 'Block arrows' | 'Flowchart' | 'Callouts' | 'Action buttons' | 'Lab equipment' | 'Icons' | 'Ink';

export const GEO_GROUPS: GeoGroup[] = ['Basic shapes', 'Block arrows', 'Flowchart', 'Callouts', 'Action buttons', 'Lab equipment'];

export interface GeoOutline {
  /** The shape's outline, filled and stroked. */
  body: GeoStep[];
  /** Details drawn as lines only, on top (a cylinder's rim, a flask's graduation marks). */
  lines?: GeoStep[];
}

export interface GeoDef {
  id: string;
  name: string;
  group: GeoGroup;
  /** PowerPoint's preset with the same look, when there is one. */
  prst?: string;
  /** Size a shape is when clicked onto the page (points). */
  size: [number, number];
  /** Drawn as an outline with no fill unless one is chosen (glassware). */
  outline?: boolean;
  /** An icon (design/icons.ts): filled in one colour with no outline unless one is chosen. */
  icon?: boolean;
  /** Words to find it by in the library's search box. */
  keywords?: string;
  draw(w: number, h: number): GeoOutline;
  /** Where text inside goes, as fractions of the box (left, top, right, bottom). */
  text?: [number, number, number, number];
}

// ---------------------------------------------------------------- building outlines

/** Bézier constant for a quarter circle. */
const K = 0.5522847498;

/** Points joined by lines, closed. */
function poly(pts: [number, number][], closed = true): GeoStep[] {
  const out: GeoStep[] = pts.map(([x, y], i) => [i ? 'L' : 'M', x, y] as GeoStep);
  if (closed) out.push(['Z']);
  return out;
}

/** An arc of an ellipse from angle a0 to a1 (radians, clockwise on the screen as y points down), as Bézier curves; starts with a line to its first point unless `move`. */
export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, move = false): GeoStep[] {
  const out: GeoStep[] = [];
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const da = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(da / 4);
  let x0 = cx + rx * Math.cos(a0), y0 = cy + ry * Math.sin(a0);
  out.push([move ? 'M' : 'L', x0, y0]);
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * da, t1 = t0 + da;
    const x3 = cx + rx * Math.cos(t1), y3 = cy + ry * Math.sin(t1);
    out.push(['C', x0 - k * rx * Math.sin(t0), y0 + k * ry * Math.cos(t0), x3 + k * rx * Math.sin(t1), y3 - k * ry * Math.cos(t1), x3, y3]);
    x0 = x3; y0 = y3;
  }
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): GeoStep[] {
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + K * ry, cx + K * rx, cy + ry, cx, cy + ry],
    ['C', cx - K * rx, cy + ry, cx - rx, cy + K * ry, cx - rx, cy],
    ['C', cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry],
    ['C', cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy],
    ['Z'],
  ];
}

function roundRect(x: number, y: number, w: number, h: number, r: number): GeoStep[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    ['M', x + r, y], ['L', x + w - r, y], ...arc(x + w - r, y + r, r, r, -Math.PI / 2, 0).slice(1),
    ['L', x + w, y + h - r], ...arc(x + w - r, y + h - r, r, r, 0, Math.PI / 2).slice(1),
    ['L', x + r, y + h], ...arc(x + r, y + h - r, r, r, Math.PI / 2, Math.PI).slice(1),
    ['L', x, y + r], ...arc(x + r, y + r, r, r, Math.PI, 1.5 * Math.PI).slice(1),
    ['Z'],
  ];
}

/** Points of a regular star or polygon fitted to the box. */
function star(w: number, h: number, n: number, inner: number | null): [number, number][] {
  const pts: [number, number][] = [];
  const m = inner === null ? n : 2 * n;
  for (let i = 0; i < m; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / m;
    const r = inner !== null && i % 2 ? inner : 1;
    pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  // fill the box from top to bottom (a five-pointed star's lowest points are above the bottom of a circle)
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return pts.map(([x, y]) => [x, ((y - lo) / Math.max(1e-6, hi - lo)) * h]);
}

/** Scale an outline drawn in a 0…1 square to w × h. */
function scaled(steps: GeoStep[], w: number, h: number): GeoStep[] {
  return steps.map((s) => {
    if (s[0] === 'Z') return s;
    if (s[0] === 'C') return ['C', s[1] * w, s[2] * h, s[3] * w, s[4] * h, s[5] * w, s[6] * h];
    return [s[0], s[1] * w, s[2] * h];
  });
}

// ---------------------------------------------------------------- the library

const ss = (w: number, h: number) => Math.min(w, h);

export const GEOS: GeoDef[] = [
  // ---- basic shapes
  { id: 'rect', name: 'Rectangle', group: 'Basic shapes', prst: 'rect', size: [108, 72], keywords: 'box square', draw: (w, h) => ({ body: poly([[0, 0], [w, 0], [w, h], [0, h]]) }) },
  { id: 'roundRect', name: 'Rounded rectangle', group: 'Basic shapes', prst: 'roundRect', size: [108, 72], keywords: 'box rounded', draw: (w, h) => ({ body: roundRect(0, 0, w, h, 0.16667 * ss(w, h)) }) },
  { id: 'ellipse', name: 'Oval', group: 'Basic shapes', prst: 'ellipse', size: [90, 72], keywords: 'circle ellipse round', draw: (w, h) => ({ body: ellipse(w / 2, h / 2, w / 2, h / 2) }), text: [0.15, 0.15, 0.85, 0.85] },
  { id: 'triangle', name: 'Triangle', group: 'Basic shapes', prst: 'triangle', size: [86, 72], draw: (w, h) => ({ body: poly([[w / 2, 0], [w, h], [0, h]]) }), text: [0.25, 0.5, 0.75, 0.95] },
  { id: 'rtTriangle', name: 'Right triangle', group: 'Basic shapes', prst: 'rtTriangle', size: [72, 72], draw: (w, h) => ({ body: poly([[0, 0], [w, h], [0, h]]) }), text: [0.06, 0.55, 0.55, 0.95] },
  { id: 'diamond', name: 'Diamond', group: 'Basic shapes', prst: 'diamond', size: [90, 72], keywords: 'rhombus', draw: (w, h) => ({ body: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }), text: [0.25, 0.25, 0.75, 0.75] },
  { id: 'parallelogram', name: 'Parallelogram', group: 'Basic shapes', prst: 'parallelogram', size: [108, 64], draw: (w, h) => { const o = 0.25 * ss(w, h); return { body: poly([[o, 0], [w, 0], [w - o, h], [0, h]]) }; }, text: [0.2, 0.08, 0.8, 0.92] },
  { id: 'trapezoid', name: 'Trapezoid', group: 'Basic shapes', prst: 'trapezoid', size: [108, 64], draw: (w, h) => { const o = 0.25 * ss(w, h); return { body: poly([[o, 0], [w - o, 0], [w, h], [0, h]]) }; }, text: [0.2, 0.08, 0.8, 0.92] },
  { id: 'pentagon', name: 'Pentagon', group: 'Basic shapes', prst: 'pentagon', size: [76, 72], draw: (w, h) => ({ body: poly(star(w, h, 5, null)) }), text: [0.2, 0.25, 0.8, 0.85] },
  { id: 'hexagon', name: 'Hexagon', group: 'Basic shapes', prst: 'hexagon', size: [86, 72], draw: (w, h) => { const o = 0.25 * ss(w, h); return { body: poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]) }; }, text: [0.18, 0.1, 0.82, 0.9] },
  { id: 'octagon', name: 'Octagon', group: 'Basic shapes', prst: 'octagon', size: [72, 72], keywords: 'stop', draw: (w, h) => { const o = 0.29289 * ss(w, h); return { body: poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]) }; }, text: [0.15, 0.15, 0.85, 0.85] },
  { id: 'star5', name: 'Star', group: 'Basic shapes', prst: 'star5', size: [76, 72], draw: (w, h) => ({ body: poly(star(w, h, 5, 0.382)) }), text: [0.3, 0.38, 0.7, 0.75] },
  { id: 'plus', name: 'Cross', group: 'Basic shapes', prst: 'plus', size: [72, 72], keywords: 'plus', draw: (w, h) => { const o = 0.25 * ss(w, h); return { body: poly([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]) }; }, text: [0.25, 0.25, 0.75, 0.75] },
  {
    id: 'can', name: 'Cylinder', group: 'Basic shapes', prst: 'can', size: [72, 90], keywords: 'database drum',
    draw: (w, h) => {
      const ry = 0.125 * ss(w, h);
      return {
        body: [['M', 0, ry], ['L', 0, h - ry], ...arc(w / 2, h - ry, w / 2, ry, Math.PI, 0).slice(1), ['L', w, ry], ...arc(w / 2, ry, w / 2, ry, 0, -Math.PI).slice(1), ['Z']],
        lines: arc(w / 2, ry, w / 2, ry, Math.PI, 0, true),
      };
    },
    text: [0.05, 0.3, 0.95, 0.9],
  },
  {
    id: 'cloud', name: 'Cloud', group: 'Basic shapes', prst: 'cloud', size: [108, 72], keywords: 'thought idea',
    draw: (w, h) => {
      // bumps round an oval
      const n = 9, out: GeoStep[] = [];
      const pts: Vec[] = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push({ x: w / 2 + 0.42 * w * Math.cos(a), y: h / 2 + 0.38 * h * Math.sin(a) });
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        // push the middle of each bump out from the centre
        const dx = mx - w / 2, dy = my - h / 2, d = Math.hypot(dx / w, dy / h) || 1;
        const bx = mx + (dx / d) * 0.17, by = my + (dy / d) * 0.17;
        const cx1 = p.x + (bx - p.x) * 1.1, cy1 = p.y + (by - p.y) * 1.1;
        const cx2 = q.x + (bx - q.x) * 1.1, cy2 = q.y + (by - q.y) * 1.1;
        if (!i) out.push(['M', p.x, p.y]);
        out.push(['C', cx1 + (dx / d) * 0.12, cy1 + (dy / d) * 0.12, cx2 + (dx / d) * 0.12, cy2 + (dy / d) * 0.12, q.x, q.y]);
      }
      out.push(['Z']);
      // keep it inside its box
      return { body: fitSteps(out, w, h) };
    },
    text: [0.2, 0.2, 0.8, 0.8],
  },
  {
    id: 'heart', name: 'Heart', group: 'Basic shapes', prst: 'heart', size: [76, 72],
    draw: (w, h) => ({ body: scaled([['M', 0.5, 0.25], ['C', 0.5, 0.05, 0.15, -0.05, 0.03, 0.2], ['C', -0.08, 0.45, 0.25, 0.7, 0.5, 1], ['C', 0.75, 0.7, 1.08, 0.45, 0.97, 0.2], ['C', 0.85, -0.05, 0.5, 0.05, 0.5, 0.25], ['Z']], w, h) }),
    text: [0.2, 0.2, 0.8, 0.7],
  },
  // ---- block arrows
  { id: 'rightArrow', name: 'Right arrow', group: 'Block arrows', prst: 'rightArrow', size: [108, 54], draw: (w, h) => { const a = Math.min(w, 0.5 * ss(w, h) * 2) / 2; return { body: poly([[0, h / 4], [w - a, h / 4], [w - a, 0], [w, h / 2], [w - a, h], [w - a, 3 * h / 4], [0, 3 * h / 4]]) }; }, text: [0.05, 0.25, 0.75, 0.75] },
  { id: 'leftArrow', name: 'Left arrow', group: 'Block arrows', prst: 'leftArrow', size: [108, 54], draw: (w, h) => { const a = Math.min(w, 0.5 * ss(w, h) * 2) / 2; return { body: poly([[w, h / 4], [a, h / 4], [a, 0], [0, h / 2], [a, h], [a, 3 * h / 4], [w, 3 * h / 4]]) }; }, text: [0.25, 0.25, 0.95, 0.75] },
  { id: 'upArrow', name: 'Up arrow', group: 'Block arrows', prst: 'upArrow', size: [54, 108], draw: (w, h) => { const a = Math.min(h, ss(w, h)) / 2; return { body: poly([[w / 4, h], [w / 4, a], [0, a], [w / 2, 0], [w, a], [3 * w / 4, a], [3 * w / 4, h]]) }; }, text: [0.25, 0.25, 0.75, 0.95] },
  { id: 'downArrow', name: 'Down arrow', group: 'Block arrows', prst: 'downArrow', size: [54, 108], draw: (w, h) => { const a = Math.min(h, ss(w, h)) / 2; return { body: poly([[w / 4, 0], [3 * w / 4, 0], [3 * w / 4, h - a], [w, h - a], [w / 2, h], [0, h - a], [w / 4, h - a]]) }; }, text: [0.25, 0.05, 0.75, 0.75] },
  { id: 'leftRightArrow', name: 'Left-right arrow', group: 'Block arrows', prst: 'leftRightArrow', size: [126, 54], keywords: 'double', draw: (w, h) => { const a = ss(w, h) / 2; return { body: poly([[0, h / 2], [a, 0], [a, h / 4], [w - a, h / 4], [w - a, 0], [w, h / 2], [w - a, h], [w - a, 3 * h / 4], [a, 3 * h / 4], [a, h]]) }; }, text: [0.2, 0.25, 0.8, 0.75] },
  { id: 'chevron', name: 'Chevron', group: 'Block arrows', prst: 'chevron', size: [90, 54], keywords: 'step process', draw: (w, h) => { const o = 0.5 * ss(w, h); return { body: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]) }; }, text: [0.3, 0.1, 0.75, 0.9] },
  { id: 'homePlate', name: 'Pentagon arrow', group: 'Block arrows', prst: 'homePlate', size: [108, 54], keywords: 'step tag', draw: (w, h) => { const o = 0.5 * ss(w, h); return { body: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]) }; }, text: [0.05, 0.1, 0.75, 0.9] },
  // ---- flowchart
  { id: 'fcProcess', name: 'Process', group: 'Flowchart', prst: 'flowChartProcess', size: [108, 64], keywords: 'step', draw: (w, h) => ({ body: poly([[0, 0], [w, 0], [w, h], [0, h]]) }) },
  { id: 'fcAltProcess', name: 'Alternate process', group: 'Flowchart', prst: 'flowChartAlternateProcess', size: [108, 64], draw: (w, h) => ({ body: roundRect(0, 0, w, h, ss(w, h) / 6) }) },
  { id: 'fcDecision', name: 'Decision', group: 'Flowchart', prst: 'flowChartDecision', size: [108, 72], keywords: 'if question', draw: (w, h) => ({ body: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }), text: [0.25, 0.25, 0.75, 0.75] },
  { id: 'fcTerminator', name: 'Start or end', group: 'Flowchart', prst: 'flowChartTerminator', size: [108, 44], keywords: 'terminator begin finish', draw: (w, h) => ({ body: roundRect(0, 0, w, h, h / 2) }), text: [0.15, 0.1, 0.85, 0.9] },
  { id: 'fcData', name: 'Data (input or output)', group: 'Flowchart', prst: 'flowChartInputOutput', size: [108, 64], keywords: 'input output', draw: (w, h) => ({ body: poly([[w / 5, 0], [w, 0], [4 * w / 5, h], [0, h]]) }), text: [0.2, 0.08, 0.8, 0.92] },
  { id: 'fcPredefined', name: 'Predefined process', group: 'Flowchart', prst: 'flowChartPredefinedProcess', size: [108, 64], keywords: 'subroutine procedure', draw: (w, h) => ({ body: poly([[0, 0], [w, 0], [w, h], [0, h]]), lines: [['M', w / 8, 0], ['L', w / 8, h], ['M', 7 * w / 8, 0], ['L', 7 * w / 8, h]] }), text: [0.14, 0.05, 0.86, 0.95] },
  { id: 'fcDocument', name: 'Document', group: 'Flowchart', prst: 'flowChartDocument', size: [108, 72], keywords: 'report paper', draw: (w, h) => ({ body: scaled([['M', 0, 0], ['L', 1, 0], ['L', 1, 0.802], ['C', 0.5, 0.802, 0.5, 1.1075, 0, 0.9339], ['Z']], w, h) }), text: [0.05, 0.05, 0.95, 0.78] },
  { id: 'fcManualInput', name: 'Manual input', group: 'Flowchart', prst: 'flowChartManualInput', size: [108, 64], draw: (w, h) => ({ body: poly([[0, 0.2 * h], [w, 0], [w, h], [0, h]]) }), text: [0.05, 0.25, 0.95, 0.95] },
  { id: 'fcManualOperation', name: 'Manual operation', group: 'Flowchart', prst: 'flowChartManualOperation', size: [108, 64], draw: (w, h) => ({ body: poly([[0, 0], [w, 0], [0.8 * w, h], [0.2 * w, h]]) }), text: [0.2, 0.05, 0.8, 0.95] },
  { id: 'fcPreparation', name: 'Preparation', group: 'Flowchart', prst: 'flowChartPreparation', size: [108, 64], draw: (w, h) => ({ body: poly([[w / 5, 0], [4 * w / 5, 0], [w, h / 2], [4 * w / 5, h], [w / 5, h], [0, h / 2]]) }), text: [0.2, 0.05, 0.8, 0.95] },
  { id: 'fcDatabase', name: 'Stored data (database)', group: 'Flowchart', prst: 'flowChartMagneticDisk', size: [72, 86], keywords: 'database disk', draw: (w, h) => { const ry = h / 6; return { body: [['M', 0, ry], ['L', 0, h - ry], ...arc(w / 2, h - ry, w / 2, ry, Math.PI, 0).slice(1), ['L', w, ry], ...arc(w / 2, ry, w / 2, ry, 0, -Math.PI).slice(1), ['Z']], lines: arc(w / 2, ry, w / 2, ry, Math.PI, 0, true) }; }, text: [0.05, 0.38, 0.95, 0.9] },
  { id: 'fcDelay', name: 'Delay', group: 'Flowchart', prst: 'flowChartDelay', size: [90, 64], keywords: 'wait', draw: (w, h) => ({ body: [['M', 0, 0], ['L', w / 2, 0], ...arc(w / 2, h / 2, w / 2, h / 2, -Math.PI / 2, Math.PI / 2).slice(1), ['L', 0, h], ['Z']] }), text: [0.05, 0.15, 0.85, 0.85] },
  { id: 'fcConnector', name: 'Connector', group: 'Flowchart', prst: 'flowChartConnector', size: [36, 36], keywords: 'circle junction', draw: (w, h) => ({ body: ellipse(w / 2, h / 2, w / 2, h / 2) }), text: [0.15, 0.15, 0.85, 0.85] },
  { id: 'fcMerge', name: 'Merge', group: 'Flowchart', prst: 'flowChartMerge', size: [72, 60], keywords: 'triangle', draw: (w, h) => ({ body: poly([[0, 0], [w, 0], [w / 2, h]]) }), text: [0.25, 0.05, 0.75, 0.5] },
  // ---- callouts
  {
    id: 'calloutRect', name: 'Speech box', group: 'Callouts', size: [120, 72], keywords: 'callout note bubble speech',
    draw: (w, h) => {
      // a rounded box with a tail from its bottom edge (the box's steps: top, corner, right, corner, then the bottom edge)
      const b = 0.78 * h, box = roundRect(0, 0, w, b, 0.1 * ss(w, b));
      return { body: [...box.slice(0, 5), ['L', 0.38 * w, b], ['L', 0.2 * w, h], ['L', 0.24 * w, b], ...box.slice(5)] };
    },
    text: [0.05, 0.06, 0.95, 0.72],
  },
  {
    id: 'calloutOval', name: 'Speech bubble', group: 'Callouts', size: [120, 76], keywords: 'callout bubble speech',
    draw: (w, h) => {
      const b = 0.8 * h, rx = w / 2, ry = b / 2;
      // the oval, with a tail from its lower left
      const a0 = 0.62 * Math.PI, a1 = 0.72 * Math.PI;
      return { body: [...arc(rx, ry, rx, ry, a1, a0 + 2 * Math.PI, true), ['L', 0.18 * w, h], ['Z']] };
    },
    text: [0.15, 0.12, 0.85, 0.68],
  },
  {
    id: 'calloutThought', name: 'Thought bubble', group: 'Callouts', size: [120, 80], keywords: 'callout think idea',
    draw: (w, h) => {
      const main = GEO_BY_ID.get('cloud')!.draw(w, 0.78 * h).body;
      return { body: [...main, ...ellipse(0.2 * w, 0.86 * h, 0.05 * w, 0.045 * h), ...ellipse(0.1 * w, 0.96 * h, 0.03 * w, 0.03 * h)] };
    },
    text: [0.2, 0.15, 0.8, 0.65],
  },
  // ---- action buttons: a click in the slide show goes where the button says (Shape.link)
  ...actionButtons(),
  // ---- lab equipment (outlines; text goes beside them more often than in them)
  {
    id: 'labRbf', name: 'Round-bottom flask', group: 'Lab equipment', outline: true, size: [54, 72], keywords: 'rbf flask reaction',
    draw: (w, h) => {
      // a neck, and a round bulb from where the neck meets it on the left, round the bottom, to the right
      // the bulb is as wide as the box and round at the usual size (54 × 72)
      const rx = 0.48, ry = 0.36, cy = 1 - ry - 0.005, nx = 0.11;
      const t = Math.asin(nx / rx);
      const y0 = cy - ry * Math.cos(t);
      return {
        body: scaled([['M', 0.5 - nx, 0], ['L', 0.5 - nx, y0], ...arc(0.5, cy, rx, ry, -Math.PI / 2 - t, -Math.PI / 2 + t - 2 * Math.PI).slice(1), ['L', 0.5 + nx, 0]], w, h),
        lines: scaled([['M', 0.5 - nx - 0.04, 0], ['L', 0.5 + nx + 0.04, 0]], w, h),
      };
    },
    text: [0.2, 0.5, 0.8, 0.9],
  },
  {
    id: 'labErlenmeyer', name: 'Erlenmeyer flask', group: 'Lab equipment', outline: true, size: [54, 72], keywords: 'conical flask',
    draw: (w, h) => ({
      body: scaled([['M', 0.39, 0], ['L', 0.39, 0.33], ['L', 0.04, 0.92], ['C', 0.0, 0.99, 0.03, 1, 0.1, 1], ['L', 0.9, 1], ['C', 0.97, 1, 1.0, 0.99, 0.96, 0.92], ['L', 0.61, 0.33], ['L', 0.61, 0]], w, h),
      lines: scaled([['M', 0.35, 0], ['L', 0.65, 0], ['M', 0.3, 0.7], ['L', 0.42, 0.7], ['M', 0.25, 0.8], ['L', 0.37, 0.8]], w, h),
    }),
    text: [0.2, 0.6, 0.8, 0.95],
  },
  {
    id: 'labBeaker', name: 'Beaker', group: 'Lab equipment', outline: true, size: [54, 64], keywords: 'glass',
    draw: (w, h) => ({
      body: scaled([['M', 0.02, 0], ['L', 0.1, 0.06], ['L', 0.1, 0.95], ['C', 0.1, 0.99, 0.12, 1, 0.16, 1], ['L', 0.84, 1], ['C', 0.88, 1, 0.9, 0.99, 0.9, 0.95], ['L', 0.9, 0]], w, h),
      lines: scaled([['M', 0.72, 0.3], ['L', 0.9, 0.3], ['M', 0.78, 0.45], ['L', 0.9, 0.45], ['M', 0.72, 0.6], ['L', 0.9, 0.6], ['M', 0.78, 0.75], ['L', 0.9, 0.75]], w, h),
    }),
    text: [0.15, 0.4, 0.7, 0.95],
  },
  {
    id: 'labVial', name: 'Vial', group: 'Lab equipment', outline: true, size: [30, 64], keywords: 'sample bottle',
    draw: (w, h) => ({
      body: scaled([['M', 0.12, 0.22], ['L', 0.12, 0.95], ['C', 0.12, 0.99, 0.16, 1, 0.22, 1], ['L', 0.78, 1], ['C', 0.84, 1, 0.88, 0.99, 0.88, 0.95], ['L', 0.88, 0.22], ['Z']], w, h),
      lines: scaled([['M', 0.2, 0.22], ['L', 0.2, 0], ['L', 0.8, 0], ['L', 0.8, 0.22], ['M', 0.2, 0.07], ['L', 0.8, 0.07], ['M', 0.2, 0.14], ['L', 0.8, 0.14]], w, h),
    }),
    text: [0.15, 0.4, 0.85, 0.9],
  },
  {
    id: 'labTestTube', name: 'Test tube', group: 'Lab equipment', outline: true, size: [22, 72], keywords: 'tube',
    draw: (w, h) => ({
      body: [['M', 0.1 * w, 0], ['L', 0.1 * w, h - 0.4 * w], ...arc(w / 2, h - 0.4 * w, 0.4 * w, 0.4 * w, Math.PI, 0).slice(1), ['L', 0.9 * w, 0]],
      lines: [['M', 0, 0], ['L', w, 0]],
    }),
    text: [0.1, 0.4, 0.9, 0.9],
  },
  {
    id: 'labSepFunnel', name: 'Separatory funnel', group: 'Lab equipment', outline: true, size: [44, 90], keywords: 'extraction workup',
    draw: (w, h) => ({
      body: scaled([['M', 0.42, 0], ['L', 0.42, 0.08], ['C', 0.1, 0.12, 0.0, 0.3, 0.12, 0.45], ['L', 0.46, 0.78], ['L', 0.46, 1], ['L', 0.54, 1], ['L', 0.54, 0.78], ['L', 0.88, 0.45], ['C', 1.0, 0.3, 0.9, 0.12, 0.58, 0.08], ['L', 0.58, 0]], w, h),
      lines: scaled([['M', 0.36, 0], ['L', 0.64, 0], ['M', 0.3, 0.86], ['L', 0.7, 0.86], ['M', 0.3, 0.84], ['L', 0.3, 0.88], ['M', 0.7, 0.84], ['L', 0.7, 0.88]], w, h),
    }),
    text: [0.2, 0.2, 0.8, 0.5],
  },
  {
    id: 'labCondenser', name: 'Condenser', group: 'Lab equipment', outline: true, size: [36, 108], keywords: 'reflux water jacket liebig',
    draw: (w, h) => ({
      body: scaled([['M', 0.3, 0.12], ['L', 0.7, 0.12], ['L', 0.7, 0.88], ['L', 0.3, 0.88], ['Z']], w, h),
      lines: scaled([['M', 0.42, 0], ['L', 0.42, 1], ['M', 0.58, 0], ['L', 0.58, 1], ['M', 0.7, 0.2], ['L', 1, 0.2], ['M', 0.7, 0.25], ['L', 1, 0.25], ['M', 0.3, 0.75], ['L', 0, 0.75], ['M', 0.3, 0.8], ['L', 0, 0.8]], w, h),
    }),
    text: [0.3, 0.3, 0.7, 0.7],
  },
  {
    id: 'labColumn', name: 'Chromatography column', group: 'Lab equipment', outline: true, size: [30, 108], keywords: 'flash silica purification',
    draw: (w, h) => ({
      body: scaled([['M', 0.2, 0], ['L', 0.2, 0.82], ['L', 0.44, 0.88], ['L', 0.44, 1], ['L', 0.56, 1], ['L', 0.56, 0.88], ['L', 0.8, 0.82], ['L', 0.8, 0]], w, h),
      lines: scaled([['M', 0.1, 0], ['L', 0.9, 0], ['M', 0.2, 0.4], ['L', 0.8, 0.4], ['M', 0.2, 0.78], ['L', 0.8, 0.78], ['M', 0.25, 0.92], ['L', 0.75, 0.92]], w, h),
    }),
    text: [0.2, 0.45, 0.8, 0.75],
  },
  {
    id: 'labTlc', name: 'TLC plate', group: 'Lab equipment', size: [44, 72], keywords: 'thin layer chromatography rf',
    draw: (w, h) => ({
      body: poly([[0, 0], [w, 0], [w, h], [0, h]]),
      lines: [['M', 0.08 * w, 0.85 * h], ['L', 0.92 * w, 0.85 * h], ['M', 0.08 * w, 0.1 * h], ['L', 0.92 * w, 0.1 * h], ...ellipse(0.3 * w, 0.35 * h, 0.07 * w, 0.04 * h), ...ellipse(0.7 * w, 0.55 * h, 0.07 * w, 0.04 * h)],
    }),
    text: [0.1, 0.12, 0.9, 0.83],
  },
  {
    id: 'labSyringe', name: 'Syringe', group: 'Lab equipment', outline: true, size: [108, 24], keywords: 'needle addition',
    draw: (w, h) => ({
      body: scaled([['M', 0.15, 0.25], ['L', 0.72, 0.25], ['L', 0.72, 0.75], ['L', 0.15, 0.75], ['Z']], w, h),
      lines: scaled([['M', 0.72, 0.4], ['L', 0.8, 0.4], ['L', 0.8, 0.6], ['L', 0.72, 0.6], ['M', 0.8, 0.5], ['L', 1, 0.5], ['M', 0.03, 0.5], ['L', 0.15, 0.5], ['M', 0.03, 0.1], ['L', 0.03, 0.9], ['M', 0.15, 0.1], ['L', 0.15, 0.9], ['M', 0.3, 0.25], ['L', 0.3, 0.45], ['M', 0.4, 0.25], ['L', 0.4, 0.45], ['M', 0.5, 0.25], ['L', 0.5, 0.45], ['M', 0.6, 0.25], ['L', 0.6, 0.45]], w, h),
    }),
    text: [0.17, 0.27, 0.7, 0.73],
  },
  {
    id: 'labStirPlate', name: 'Stirrer hot plate', group: 'Lab equipment', size: [90, 40], keywords: 'heat stir hotplate',
    draw: (w, h) => ({
      body: scaled([['M', 0.0, 0.3], ['L', 1, 0.3], ['L', 1, 1], ['L', 0, 1], ['Z']], w, h),
      lines: [...scaled([['M', 0.05, 0.3], ['L', 0.05, 0.12], ['L', 0.95, 0.12], ['L', 0.95, 0.3]], w, h), ...ellipse(0.25 * w, 0.65 * h, 0.07 * w, 0.14 * h), ...ellipse(0.75 * w, 0.65 * h, 0.07 * w, 0.14 * h)],
    }),
    text: [0.38, 0.4, 0.62, 0.9],
  },
  {
    id: 'labBath', name: 'Bath (dish)', group: 'Lab equipment', outline: true, size: [90, 40], keywords: 'ice oil water bath crystallising dish',
    draw: (w, h) => ({ body: scaled([['M', 0, 0], ['L', 0, 0.9], ['C', 0, 0.97, 0.02, 1, 0.06, 1], ['L', 0.94, 1], ['C', 0.98, 1, 1, 0.97, 1, 0.9], ['L', 1, 0]], w, h), lines: scaled([['M', 0, 0.3], ['L', 1, 0.3]], w, h) }),
    text: [0.05, 0.35, 0.95, 0.95],
  },
  {
    id: 'labFunnel', name: 'Funnel', group: 'Lab equipment', outline: true, size: [54, 64], keywords: 'filter filtration',
    draw: (w, h) => ({ body: scaled([['M', 0, 0], ['L', 0.44, 0.55], ['L', 0.44, 1], ['L', 0.56, 1], ['L', 0.56, 0.55], ['L', 1, 0]], w, h), lines: scaled([['M', 0, 0], ['L', 1, 0]], w, h) }),
    text: [0.2, 0.05, 0.8, 0.4],
  },
];

/** Scale an outline so it just fits a w × h box. */
function fitSteps(steps: GeoStep[], w: number, h: number): GeoStep[] {
  const b = stepsBox(steps);
  const sx = w / Math.max(1e-6, b.x2 - b.x1), sy = h / Math.max(1e-6, b.y2 - b.y1);
  return steps.map((s) => {
    if (s[0] === 'Z') return s;
    if (s[0] === 'C') return ['C', (s[1] - b.x1) * sx, (s[2] - b.y1) * sy, (s[3] - b.x1) * sx, (s[4] - b.y1) * sy, (s[5] - b.x1) * sx, (s[6] - b.y1) * sy];
    return [s[0], (s[1] - b.x1) * sx, (s[2] - b.y1) * sy];
  });
}

// ---------------------------------------------------------------- pyramid layers (diagrams)

const SLICE = 'slice:';

/** A pyramid's layer: a trapezium cut in from each side by `a` of its width (at its narrow end: the top when a > 0, the bottom when a < 0). */
export function sliceId(a: number): string {
  return SLICE + (Math.round(a * 10000) / 10000);
}

export const isSliceId = (id: string | undefined): id is string => !!id && id.startsWith(SLICE);

/** The library shape for a layer of a pyramid. */
export function sliceDef(id: string): GeoDef {
  const v = Number(id.slice(SLICE.length));
  const a = Math.max(0, Math.min(0.5, Math.abs(isFinite(v) ? v : 0)));
  const up = !(v < 0);
  // the text where the layer is widest enough: lower down in a narrow top layer
  // (a pointed layer, the top of a pyramid, has its words in its lower half, a little past its sloping sides)
  const t = a > 0.45 ? 0.5 : a > 0.3 ? 0.4 : 0.08;
  const side = a > 0.45 ? 0.2 : a * (1 - t) + 0.03;
  return {
    id, name: 'Pyramid layer', group: 'Basic shapes', size: [120, 40],
    draw: (w, h) => ({
      body: up
        ? [['M', a * w, 0], ['L', (1 - a) * w, 0], ['L', w, h], ['L', 0, h], ['Z']]
        : [['M', 0, 0], ['L', w, 0], ['L', (1 - a) * w, h], ['L', a * w, h], ['Z']],
    }),
    text: up ? [side, t, 1 - side, 0.94] : [side, 0.06, 1 - side, 1 - t],
  };
}

// ---------------------------------------------------------------- ring pieces and honeycomb cells (diagrams)

const SECTOR = 'sector:';

/**
 * A piece of a ring (a segmented ring's segment, a bending band's half turn): from angle `a0` to
 * `a1` (degrees, clockwise on the screen from three o'clock), its inner radius `k` of its outer
 * (0 for a slice of a pie). It is drawn to fill its box, which is the piece's own bounding box.
 */
export function sectorId(a0: number, a1: number, k: number): string {
  const q = (v: number) => Math.round(v * 100) / 100;
  return `${SECTOR}${q(a0)}:${q(a1)}:${Math.round(Math.max(0, Math.min(0.95, k)) * 1000) / 1000}`;
}

export const isSectorId = (id: string | undefined): id is string => !!id && id.startsWith(SECTOR);

/** A sector's angles (radians) and inner radius from its id. */
function sectorParts(id: string): { a0: number; a1: number; k: number } {
  const [a, b, c] = id.slice(SECTOR.length).split(':').map(Number);
  const a0 = isFinite(a) ? a : 0;
  const a1 = isFinite(b) && b > a0 ? Math.min(b, a0 + 359.9) : a0 + 90;
  return { a0: (a0 * Math.PI) / 180, a1: (a1 * Math.PI) / 180, k: isFinite(c) ? Math.max(0, Math.min(0.95, c)) : 0.5 };
}

/** The bounding box of a ring piece round (0, 0) with outer radius 1. */
export function sectorBox(a0: number, a1: number, k: number): Rect {
  const pts: Vec[] = [];
  const at = (r: number, a: number) => pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  at(1, a0); at(1, a1);
  if (k > 0) { at(k, a0); at(k, a1); } else pts.push({ x: 0, y: 0 });
  // the outer arc's furthest points left, right, up and down, where it passes them
  for (let q = Math.ceil(a0 / (Math.PI / 2) - 1e-9); q * (Math.PI / 2) <= a1 + 1e-9; q++) at(1, q * (Math.PI / 2));
  return {
    x1: Math.min(...pts.map((p) => p.x)), y1: Math.min(...pts.map((p) => p.y)),
    x2: Math.max(...pts.map((p) => p.x)), y2: Math.max(...pts.map((p) => p.y)),
  };
}

/** The library shape for a ring piece. */
export function sectorDef(id: string): GeoDef {
  const { a0, a1, k } = sectorParts(id);
  const b = sectorBox(a0, a1, k);
  const bw = Math.max(1e-6, b.x2 - b.x1), bh = Math.max(1e-6, b.y2 - b.y1);
  // the words (or a structure) round the middle of the piece: along the ring as far as it is long,
  // across it as far as it is thick, turned to whichever way the piece runs
  const am = (a0 + a1) / 2, rm = (1 + k) / 2;
  const along = Math.min(rm * (a1 - a0), 2 * rm), across = (1 - k) || 1;
  const s = Math.abs(Math.sin(am)), c = Math.abs(Math.cos(am));
  let hx = 0.45 * (s * along + c * across) / (s + c), hy = 0.45 * (c * along + s * across) / (s + c);
  const cx = rm * Math.cos(am), cy = rm * Math.sin(am);
  // made smaller until its corners are all inside the piece (a piece running slantwise holds less)
  const inside = (x: number, y: number) => {
    const r = Math.hypot(x, y);
    let a = Math.atan2(y, x);
    while (a < a0) a += 2 * Math.PI;
    return r <= 0.98 && r >= k + 0.02 && a <= a1;
  };
  for (let i = 0; i < 20 && ![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([u, v]) => inside(cx + u * hx, cy + v * hy)); i++) { hx *= 0.9; hy *= 0.9; }
  hx = Math.max(0.03, hx); hy = Math.max(0.03, hy);
  const fx = (x: number) => Math.max(0, Math.min(1, (x - b.x1) / bw)), fy = (y: number) => Math.max(0, Math.min(1, (y - b.y1) / bh));
  return {
    id, name: 'Ring segment', group: 'Basic shapes', size: [100, 100],
    draw: (w, h) => {
      const sx = w / bw, sy = h / bh;
      const outer = arc(-b.x1 * sx, -b.y1 * sy, sx, sy, a0, a1, true);
      const inner: GeoStep[] = k > 0 ? arc(-b.x1 * sx, -b.y1 * sy, k * sx, k * sy, a1, a0) : [['L', -b.x1 * sx, -b.y1 * sy]];
      return { body: [...outer, ...inner, ['Z']] };
    },
    text: [fx(cx - hx), fy(cy - hy), fx(cx + hx), fy(cy + hy)],
  };
}

/** A honeycomb cell: a regular hexagon with flat top and bottom when its box is 2 wide to √3 high. */
export const HEX_CELL = 'cell:hex';

const hexCellDef: GeoDef = {
  id: HEX_CELL, name: 'Honeycomb cell', group: 'Basic shapes', size: [80, 69],
  draw: (w, h) => ({ body: poly([[0.25 * w, 0], [0.75 * w, 0], [w, h / 2], [0.75 * w, h], [0.25 * w, h], [0, h / 2]]) }),
  text: [0.17, 0.08, 0.83, 0.92],
};

export const GEO_BY_ID = new Map(GEOS.map((g) => [g.id, g]));

// ---------------------------------------------------------------- action buttons

/** Where each action button goes in the slide show when it is put on a slide (a link, see links.ts). */
export const ACTION_LINKS: Record<string, string> = {
  actBack: '#prev', actNext: '#next', actFirst: '#first', actLast: '#last', actHome: '#first', actReturn: '#return',
};

function actionButtons(): GeoDef[] {
  const box = (w: number, h: number) => poly([[0, 0], [w, 0], [w, h], [0, h]]);
  // the glyph in the middle, in a square of side g at (cx - g/2, cy - g/2)
  const glyph = (w: number, h: number, pts: [number, number][][]): GeoStep[] => {
    const g = 0.56 * Math.min(w, h), x0 = (w - g) / 2, y0 = (h - g) / 2;
    return pts.flatMap((p) => poly(p.map(([x, y]) => [x0 + x * g, y0 + y * g] as [number, number]), true));
  };
  const def = (id: string, name: string, prst: string, keywords: string, shape: [number, number][][]): GeoDef => ({
    id, name, group: 'Action buttons', prst, size: [54, 54], keywords: `action button slide show ${keywords}`,
    draw: (w, h) => ({ body: box(w, h), ...(shape.length ? { lines: glyph(w, h, shape) } : {}) }),
  });
  return [
    def('actBack', 'Back or previous', 'actionButtonBackPrevious', 'previous back left', [[[0.85, 0], [0.85, 1], [0.1, 0.5]]]),
    def('actNext', 'Forward or next', 'actionButtonForwardNext', 'next forward right', [[[0.15, 0], [0.9, 0.5], [0.15, 1]]]),
    def('actFirst', 'Beginning', 'actionButtonBeginning', 'first start', [[[0.95, 0], [0.95, 1], [0.3, 0.5]], [[0.08, 0], [0.2, 0], [0.2, 1], [0.08, 1]]]),
    def('actLast', 'End', 'actionButtonEnd', 'last end', [[[0.05, 0], [0.7, 0.5], [0.05, 1]], [[0.8, 0], [0.92, 0], [0.92, 1], [0.8, 1]]]),
    def('actHome', 'Home', 'actionButtonHome', 'home first house', [[[0.5, 0.02], [1, 0.5], [0.84, 0.5], [0.84, 1], [0.16, 1], [0.16, 0.5], [0, 0.5]]]),
    def('actReturn', 'Return', 'actionButtonReturn', 'return back last viewed', [[[0.15, 0.25], [0.45, 0], [0.45, 0.15], [0.75, 0.15], [0.95, 0.35], [0.95, 0.8], [0.75, 1], [0.35, 1], [0.35, 0.82], [0.72, 0.82], [0.78, 0.76], [0.78, 0.4], [0.72, 0.33], [0.45, 0.33], [0.45, 0.5]]]),
    def('actBlank', 'Blank action button', 'actionButtonBlank', 'blank custom', []),
  ];
}

// ---------------------------------------------------------------- ink

/**
 * Ink drawn with the pen or highlighter in the slide show and kept: a design shape whose id holds
 * its line, `ink:<width in points>:<x,y,x,y…>` with the points as ten-thousandths of the box, so it
 * moves and stretches with its box like any shape, and goes to PowerPoint as a freeform.
 */
export const isInkId = (id: string | undefined): id is string => !!id && id.startsWith('ink:');

/** The id for a line of ink: its points (in points on the slide) as fractions of its box. */
export function inkId(width: number, pts: Vec[], box: Rect): string {
  const w = Math.max(1e-6, box.x2 - box.x1), h = Math.max(1e-6, box.y2 - box.y1);
  const q = (v: number) => Math.max(0, Math.min(10000, Math.round(v * 10000)));
  return `ink:${+width.toFixed(2)}:${pts.map((p) => `${q((p.x - box.x1) / w)},${q((p.y - box.y1) / h)}`).join(',')}`;
}

/** A line `width` wide along points, as an outline to fill: round at its ends and turns. */
export function inkOutline(pts: Vec[], width: number): GeoStep[] {
  const r = width / 2;
  if (!pts.length) return [];
  const disc = (c: Vec): GeoStep[] => ellipse(c.x, c.y, r, r);
  if (pts.length === 1) return disc(pts[0]);
  const left: Vec[] = [], right: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    left.push({ x: pts[i].x + nx * r, y: pts[i].y + ny * r });
    right.push({ x: pts[i].x - nx * r, y: pts[i].y - ny * r });
  }
  const band = poly([...left, ...right.reverse()].map((p) => [p.x, p.y] as [number, number]));
  // round ends (and round over its own turns: a disc at each sharp corner)
  const sharp: GeoStep[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const u = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y }, v = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y };
    const cos = (u.x * v.x + u.y * v.y) / ((Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) || 1);
    if (cos < 0.5) sharp.push(...disc(pts[i]));
  }
  return [...band, ...disc(pts[0]), ...disc(pts[pts.length - 1]), ...sharp];
}

const inkDefs = new Map<string, GeoDef>();

/** The library shape for a line of ink. */
export function inkDef(id: string): GeoDef {
  let d = inkDefs.get(id);
  if (d) return d;
  const [, wTxt = '2', ptsTxt = ''] = id.split(':');
  const width = Math.max(0.1, Number(wTxt) || 2);
  const n = ptsTxt.split(',').map(Number);
  const rel: Vec[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) rel.push({ x: n[i] / 10000, y: n[i + 1] / 10000 });
  d = { id, name: 'Ink', group: 'Ink', size: [72, 72], draw: (w, h) => ({ body: inkOutline(rel.map((p) => ({ x: p.x * w, y: p.y * h })), width) }) };
  if (inkDefs.size > 500) inkDefs.clear();
  inkDefs.set(id, d);
  return d;
}

/** The shape with this id (an icon for "icon:…"), or the rectangle for one not known (from a newer version). */
export const geoDef = (id: string | undefined): GeoDef => (isIconId(id) ? iconDef(id) : isSliceId(id) ? sliceDef(id) : isSectorId(id) ? sectorDef(id) : id === HEX_CELL ? hexCellDef : isInkId(id) ? inkDef(id) : GEO_BY_ID.get(id ?? '')) ?? GEO_BY_ID.get('rect')!;

/** The box of an outline's points (control points included: a little generous on curves). */
export function stepsBox(steps: GeoStep[]): Rect {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const at = (x: number, y: number) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
  for (const s of steps) {
    if (s[0] === 'M' || s[0] === 'L') at(s[1], s[2]);
    else if (s[0] === 'C') { at(s[1], s[2]); at(s[3], s[4]); at(s[5], s[6]); }
  }
  return x1 === Infinity ? { x1: 0, y1: 0, x2: 0, y2: 0 } : { x1, y1, x2, y2 };
}

/** The outline as polygons (curves cut into short lines), for hit testing. */
export function flatten(steps: GeoStep[], parts = 12): Vec[][] {
  const out: Vec[][] = [];
  let cur: Vec[] = [];
  let px = 0, py = 0;
  for (const s of steps) {
    if (s[0] === 'M') { if (cur.length) out.push(cur); cur = [{ x: s[1], y: s[2] }]; px = s[1]; py = s[2]; }
    else if (s[0] === 'L') { cur.push({ x: s[1], y: s[2] }); px = s[1]; py = s[2]; }
    else if (s[0] === 'C') {
      for (let i = 1; i <= parts; i++) {
        const t = i / parts, u = 1 - t;
        cur.push({
          x: u * u * u * px + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5],
          y: u * u * u * py + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6],
        });
      }
      px = s[5]; py = s[6];
    } else if (cur.length) { cur.push({ ...cur[0] }); out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Is p inside the outline (even-odd)? */
export function insideOutline(polys: Vec[][], p: Vec): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * An outline's separate parts (each from a move to the next), outermost first, with how many
 * other parts each lies inside: an even count is filled, an odd one is a hole (even-odd). For
 * formats that fill each part on its own (ChemDraw curves), holes are painted over in white.
 * Each part comes back closed.
 */
export function outlineParts(steps: GeoStep[]): { steps: GeoStep[]; depth: number }[] {
  const parts: GeoStep[][] = [];
  for (const s of steps) {
    if (s[0] === 'M' || !parts.length) parts.push([]);
    parts[parts.length - 1].push(s);
  }
  // filled parts are closed
  for (const p of parts) if (p[p.length - 1][0] !== 'Z') p.push(['Z']);
  const polys = parts.map((p) => flatten(p, 6)[0] ?? []);
  const depth = polys.map((poly, i) => {
    if (!poly.length) return 0;
    // (the parts don't cross, so any point of this one will do)
    return polys.filter((o, j) => j !== i && o.length > 2 && insideOutline([o], poly[0])).length;
  });
  return parts.map((p, i) => ({ steps: p, depth: depth[i] })).sort((a, b) => a.depth - b.depth);
}

/** How far p is from the outline's lines. */
export function distToOutline(polys: Vec[][], p: Vec): number {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
  }
  return best;
}

/** Steps moved by (dx, dy). */
export function moveSteps(steps: GeoStep[], dx: number, dy: number): GeoStep[] {
  return steps.map((s) => {
    if (s[0] === 'Z') return s;
    if (s[0] === 'C') return ['C', s[1] + dx, s[2] + dy, s[3] + dx, s[4] + dy, s[5] + dx, s[6] + dy];
    return [s[0], s[1] + dx, s[2] + dy];
  });
}

/** Trace steps on a canvas (or the vector recorder, which records the same calls). */
export function traceSteps(ctx: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; closePath(): void }, steps: GeoStep[]): void {
  for (const s of steps) {
    if (s[0] === 'M') ctx.moveTo(s[1], s[2]);
    else if (s[0] === 'L') ctx.lineTo(s[1], s[2]);
    else if (s[0] === 'C') ctx.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
    else ctx.closePath();
  }
}

/** Where a shape's text goes (its box inside the shape), from the shape's corners. */
export function textArea(def: GeoDef, x1: number, y1: number, x2: number, y2: number): Rect {
  const [l, t, r, b] = def.text ?? [0.06, 0.06, 0.94, 0.94];
  const w = x2 - x1, h = y2 - y1;
  return { x1: x1 + l * w, y1: y1 + t * h, x2: x1 + r * w, y2: y1 + b * h };
}

/** The points connectors join to: the middles of the box's sides (top, right, bottom, left). */
export function ports(x1: number, y1: number, x2: number, y2: number): Vec[] {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return [{ x: mx, y: y1 }, { x: x2, y: my }, { x: mx, y: y2 }, { x: x1, y: my }];
}

/** The usual line widths of new design shapes, in points. */
export const CLIP_ART_LINE = 1.75, SHAPE_LINE = 1;

/** How a new shape from the library looks (null for a shape that isn't in it). */
export function geoShapeStyle(id: string, look: Partial<Shape> = {}): Partial<Shape> | null {
  const def = isIconId(id) ? iconDef(id) : GEO_BY_ID.get(id);
  if (!def) return null;
  // icons in the outline colour of new shapes (or black), with no outline
  if (def.icon) return { kind: 'geo', geo: id, filled: true, color: look.color ?? '#000000', lineWidth: 0 };
  // lines in proportion to the shape: clip art (glassware…) at 1.75 pt, as it is drawn about 60 pt
  // across; other shapes at PowerPoint's 1 pt. Change it in the Style panel.
  const base: Partial<Shape> = def.outline ? { color: '#000000', lineWidth: CLIP_ART_LINE } : { filled: true, fillColor: '#dae3f3', color: '#2f5597', lineWidth: SHAPE_LINE, ...look };
  return { ...base, kind: 'geo', geo: id, ...(ACTION_LINKS[id] ? { link: ACTION_LINKS[id] } : {}) };
}

