// Mass fragmentation: a dashed line drawn across bonds breaks them, and each piece gets a
// caption with its formula and exact mass, as on a mass spectrum's fragmentation scheme.
// The masses come from the chemistry engine (massFragments in props.ts); this file works out
// which bonds the line crosses and where the captions go.

import type { Doc, TextRun } from '../model';
import type { Vec, Rect } from '../geom';

/** Whether segments ab and cd cross (touching at an end doesn't count). */
function crosses(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const cross = (o: Vec, p: Vec, q: Vec) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The bonds a line from p to q crosses (dative bonds, which hold two whole molecules together, left out). */
export function crossedBonds(doc: Doc, p: Vec, q: Vec): number[] {
  const out: number[] = [];
  for (const b of doc.bonds.values()) {
    if (b.display === 'dative') continue;
    const a1 = doc.atoms.get(b.a1), a2 = doc.atoms.get(b.a2);
    if (a1 && a2 && crosses(p, q, a1, a2)) out.push(b.id);
  }
  return out;
}

/** A line across one bond, through its middle and square to it, for clicking a bond with the tool. */
export function lineAcross(doc: Doc, bondId: number): { p: Vec; q: Vec } | null {
  const b = doc.bonds.get(bondId);
  const a1 = b && doc.atoms.get(b.a1), a2 = b && doc.atoms.get(b.a2);
  if (!a1 || !a2) return null;
  const m = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  const len = Math.hypot(a2.x - a1.x, a2.y - a1.y) || 1;
  const n = { x: -(a2.y - a1.y) / len, y: (a2.x - a1.x) / len };
  const h = doc.style.bondLength * 0.6;
  // drawn top to bottom (or left to right) so captions land the same way each time
  const p = { x: m.x - n.x * h, y: m.y - n.y * h }, q = { x: m.x + n.x * h, y: m.y + n.y * h };
  return p.y < q.y || (p.y === q.y && p.x < q.x) ? { p, q } : { p: q, q: p };
}

/** A piece's caption text: its formula, then its exact mass. */
export function fragmentRuns(formula: string, exact: number): TextRun[] {
  return [{ text: formula, formula: true }, { text: `\n${exact.toFixed(4)}` }];
}

/**
 * Where each piece's caption goes: beyond the end of the line, on the piece's side of it, so the
 * two captions sit either side of the line like ChemDraw's, moved out along the line until they
 * clear the structure (`box`). `centres` are the pieces' middles and `widths` how wide each
 * caption is. Returns each caption's left baseline point.
 */
export function captionPlaces(p: Vec, q: Vec, centres: Vec[], widths: number[], size: number, box?: Rect): Vec[] {
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  const n = { x: -u.y, y: u.x };
  // the end of the line further down the page gets the captions (below a structure reads best)
  const end = q.y >= p.y ? q : p;
  const out = { x: end === q ? u.x : -u.x, y: end === q ? u.y : -u.y };
  const used = new Map<number, number>();
  return centres.map((c, i) => {
    const side = (c.x - p.x) * n.x + (c.y - p.y) * n.y >= 0 ? 1 : -1;
    const k = used.get(side) ?? 0;
    used.set(side, k + 1);
    // a caption on the left of the line ends at the line, so both captions face it
    const left = n.x * side < -1e-6;
    // a caption above the line sits with its last line by the line
    const up = n.y * side < -0.5 ? size * 2.4 : 0;
    const place = (t: number): Vec => {
      const at = { x: end.x + out.x * t + n.x * side * size * 0.6, y: end.y + out.y * t + n.y * side * size * 0.6 };
      return { x: left ? at.x - widths[i] : at.x, y: at.y + size * 0.9 + k * size * 2.6 - up };
    };
    let t = size * 0.4;
    for (let step = 0; box && step < 60; step++, t += size * 0.4) {
      const at = place(t);
      const r = { x1: at.x, y1: at.y - size, x2: at.x + widths[i], y2: at.y + size * 1.5 };
      if (r.x2 < box.x1 || r.x1 > box.x2 || r.y2 < box.y1 || r.y1 > box.y2) break;
    }
    return place(t);
  });
}
