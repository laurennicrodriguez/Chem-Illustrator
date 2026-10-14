// Design mode's shape library: basic shapes, block arrows, flowchart symbols, callouts and lab
// equipment, each drawn from its box (x, y, w, h) as lines and Bézier curves, so the same
// outline goes to the screen, SVG, PDF and EMF pictures, and PowerPoint. Shapes PowerPoint has
// as a preset are saved as that preset (so PowerPoint can still edit them as its own); the
// others (lab equipment, our callouts) are saved as PowerPoint custom shapes with these outlines.
// The lab equipment is drawn here, from simple outlines (no outside artwork).

import type { Rect, Vec } from '../geom';

export type GeoStep =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export type GeoGroup = 'Basic shapes' | 'Block arrows' | 'Flowchart' | 'Callouts' | 'Lab equipment';

export const GEO_GROUPS: GeoGroup[] = ['Basic shapes', 'Block arrows', 'Flowchart', 'Callouts', 'Lab equipment'];

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

export const GEO_BY_ID = new Map(GEOS.map((g) => [g.id, g]));

/** The shape with this id, or the rectangle for one not known (from a newer version). */
export const geoDef = (id: string | undefined): GeoDef => GEO_BY_ID.get(id ?? '') ?? GEO_BY_ID.get('rect')!;

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
