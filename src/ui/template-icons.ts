// Small pictures of the templates for the tool palettes, drawn as SVG from the template data.
// Labels are laid out the way the drawing lays them out (H2N on the left, HO pointing away from
// the bonds), at the drawing's own label size for the bond length, so a picture looks like the
// structure you get.

import type { Template } from '../chem/templates';
import { labelSpec, layoutLabel, type LabelLayout } from '../chem/labels';
import { elementNumber, isMetal, lowestValence } from '../chem/elements';
import { arialWidth } from '../text-metrics';
import { exitParam, type Rect } from '../geom';
import { ACS_1996 } from '../style';
import { circleIn, ellipseAxes } from '../chem/aromatic';

const SHORT: Record<string, string> = {};

/** Three-letter code for an amino acid, from its name "L-Alanine (Ala, A)". */
const codeOf = (t: Template) => (SHORT[t.id] ??= /\((\w{3}),/.exec(t.name)?.[1] ?? '');

/** Label size and clearance as fractions of the bond length (ACS Document 1996: 10 pt labels on 14.4 pt bonds). */
const FONT = ACS_1996.labelSize / ACS_1996.bondLength;
const MARGIN = ACS_1996.marginWidth / ACS_1996.bondLength;
/** Height of the three-letter code under an amino acid. */
const CODE_H = 12;

const f = (v: number) => v.toFixed(1);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function svg(size: number, body: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" font-family="Arial, Helvetica, sans-serif" aria-hidden="true">${body}</svg>`;
}

export function templateIcon(t: Template, size = 44): string {
  const small = size < 40;
  // A tool bar button is too small for a whole amino acid: it shows the three-letter code.
  if (small && t.group === 'amino') {
    return svg(size, `<text x="${size / 2}" y="${size / 2 + 4}" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">${codeOf(t)}</text>`);
  }
  const showCode = t.group === 'amino';
  // ...and a sugar shows its ring, with only the ring oxygen labelled.
  const ringOnly = small && t.group === 'sugars';

  const n = t.atoms.length;
  const order = new Array(n).fill(0);
  const nbrs: number[][] = t.atoms.map(() => []);
  // bonds to a metal count only as far as the atom's usual valence allows (PPh3 on M is no PH)
  const metal = t.atoms.map(([, , el, , text]) => text === 'M' || (!text && isMetal(elementNumber(el) ?? 0)));
  const toMetal = new Array(n).fill(0);
  for (const [a, b, o] of t.bonds) {
    nbrs[a].push(b); nbrs[b].push(a);
    if (metal[b]) toMetal[a] += o; else order[a] += o;
    if (metal[a]) toMetal[b] += o; else order[b] += o;
  }
  t.atoms.forEach(([, , el, charge, text], i) => {
    if (!toMetal[i]) return;
    const low = text || metal[i] ? undefined : lowestValence(elementNumber(el) ?? 6, charge ?? 0);
    order[i] += low === undefined ? toMetal[i] : Math.min(toMetal[i], Math.max(0, low - Math.ceil(order[i] - 1e-6)));
  });

  // Labels in bond-length units, relative to their atom.
  const layouts: (LabelLayout | null)[] = t.atoms.map(([x, y, el, charge, text], i) => {
    if (ringOnly && nbrs[i].length < 2) return null;
    const z = elementNumber(el) ?? 6;
    const spec = labelSpec(z, text ?? null, charge ?? 0, 0, order[i], nbrs[i].length);
    if (!spec) return null;
    const dirs = nbrs[i].map((j) => {
      const dx = t.atoms[j][0] - x, dy = t.atoms[j][1] - y, d = Math.hypot(dx, dy) || 1;
      return { x: dx / d, y: dy / d };
    });
    return layoutLabel(spec, dirs, FONT, (s, sz) => arialWidth(s, sz));
  });

  // Fit bonds, labels and drawn lines together, keeping their proportions.
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [, ax, ay, bx, by] of t.shapes ?? []) { x1 = Math.min(x1, ax, bx); x2 = Math.max(x2, ax, bx); y1 = Math.min(y1, ay, by); y2 = Math.max(y2, ay, by); }
  t.atoms.forEach(([x, y], i) => {
    x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y);
    for (const b of layouts[i]?.boxes ?? []) {
      x1 = Math.min(x1, x + b.x1); x2 = Math.max(x2, x + b.x2); y1 = Math.min(y1, y + b.y1); y2 = Math.max(y2, y + b.y2);
    }
  });
  const pad = small ? 2 : 3;
  const h = showCode ? size - CODE_H : size;
  const k = Math.min((size - 2 * pad) / Math.max(1, x2 - x1), (h - 2 * pad) / Math.max(1, y2 - y1), t.z && !small ? size / 3.4 : small ? 13 : 12);
  const ox = size / 2 - ((x1 + x2) / 2) * k, oy = h / 2 - ((y1 + y2) / 2) * k;
  const P = (i: number) => ({ x: t.atoms[i][0] * k + ox, y: t.atoms[i][1] * k + oy });

  // Bonds stop short of labels, with the drawing's clearance.
  const clear: Rect[][] = t.atoms.map((_, i) => {
    const p = P(i), m = MARGIN * k;
    return (layouts[i]?.boxes ?? []).map((b) => ({ x1: p.x + b.x1 * k - m, y1: p.y + b.y1 * k - m, x2: p.x + b.x2 * k + m, y2: p.y + b.y2 * k + m }));
  });
  const ends = (a: number, b: number) => {
    const p = P(a), q = P(b);
    let t1 = 0, t2 = 0;
    for (const r of clear[a]) t1 = Math.max(t1, exitParam(p, q, r));
    for (const r of clear[b]) t2 = Math.max(t2, exitParam(q, p, r));
    if (t1 + t2 >= 0.95) { t1 = Math.min(t1, 0.45); t2 = Math.min(t2, 0.45); }
    return [{ x: p.x + (q.x - p.x) * t1, y: p.y + (q.y - p.y) * t1 }, { x: q.x + (p.x - q.x) * t2, y: q.y + (p.y - q.y) * t2 }];
  };

  const parts: string[] = [];
  const line = (p: { x: number; y: number }, q: { x: number; y: number }, w = 1, dash = false) =>
    parts.push(`<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" stroke-width="${w}"${dash ? ' stroke-dasharray="2 1.6"' : ''}/>`);
  const off = Math.max(1.8, (ACS_1996.bondSpacing / 100) * k);
  const wedge = Math.max(1.6, 0.12 * k);
  for (const [a, b, o, disp] of t.bonds) {
    const [p, q] = ends(a, b);
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    if (disp === 'wedge' || disp === 'hashWedge') {
      if (disp === 'wedge') parts.push(`<polygon points="${f(p.x)},${f(p.y)} ${f(q.x + nx * wedge)},${f(q.y + ny * wedge)} ${f(q.x - nx * wedge)},${f(q.y - ny * wedge)}" fill="currentColor" stroke="none"/>`);
      else for (let s = 1; s <= 4; s++) { const u = s / 4, c = { x: p.x + dx * u, y: p.y + dy * u }; line({ x: c.x + nx * wedge * u, y: c.y + ny * wedge * u }, { x: c.x - nx * wedge * u, y: c.y - ny * wedge * u }, 0.8); }
      continue;
    }
    if (disp === 'bold') { line(p, q, Math.max(2.4, 0.14 * k)); continue; }
    if (disp === 'dash' || disp === 'hash') { line(p, q, 1, true); continue; }
    if (o === 4) {
      // a metal–metal quadruple bond: four lines
      for (const u of [-1.5, -0.5, 0.5, 1.5]) line({ x: p.x + nx * off * u, y: p.y + ny * off * u }, { x: q.x + nx * off * u, y: q.y + ny * off * u });
      continue;
    }
    if (o === 2 && !nbrs[a].some((i) => i !== b) !== !nbrs[b].some((i) => i !== a)) {
      // C=O and the like: two lines either side of the bond line, as in a drawing
      line({ x: p.x + (nx * off) / 2, y: p.y + (ny * off) / 2 }, { x: q.x + (nx * off) / 2, y: q.y + (ny * off) / 2 });
      line({ x: p.x - (nx * off) / 2, y: p.y - (ny * off) / 2 }, { x: q.x - (nx * off) / 2, y: q.y - (ny * off) / 2 });
      continue;
    }
    line(p, q);
    if (o < 2) continue;
    // the second line goes on the side where the neighbours are (inside a ring)
    const others = [...nbrs[a], ...nbrs[b]].filter((i) => i !== a && i !== b);
    let side = 0;
    for (const i of others) { const r = P(i); side += (r.x - p.x) * nx + (r.y - p.y) * ny; }
    const sgn = side >= 0 ? 1 : -1;
    if (o === 3 || !others.length) {
      line({ x: p.x + nx * off, y: p.y + ny * off }, { x: q.x + nx * off, y: q.y + ny * off });
      if (o === 3) line({ x: p.x - nx * off, y: p.y - ny * off }, { x: q.x - nx * off, y: q.y - ny * off });
    } else {
      // inner line shortened at ring atoms (not at a labelled end, which is already cut back)
      const sa = clear[a].length ? 0 : 0.16, sb = clear[b].length ? 0 : 0.16;
      line({ x: p.x + dx * sa + nx * off * sgn, y: p.y + dy * sa + ny * off * sgn }, { x: q.x - dx * sb + nx * off * sgn, y: q.y - dy * sb + ny * off * sgn });
    }
  }
  // hapto bonds: from the metal (clear of its label) to the middle of the ring or π-bond
  for (const [m, members, disp] of t.hapto ?? []) {
    const c = members.reduce((acc, i) => ({ x: acc.x + P(i).x / members.length, y: acc.y + P(i).y / members.length }), { x: 0, y: 0 });
    const p = P(m);
    let u = 0;
    for (const r of clear[m]) u = Math.max(u, exitParam(p, c, r));
    line({ x: p.x + (c.x - p.x) * u, y: p.y + (c.y - p.y) * u }, c, 1, disp === 'dash');
  }
  // a Newman projection's circle and back bonds
  for (const [kind, ax, ay, bx, by] of t.shapes ?? []) {
    const p = { x: ax * k + ox, y: ay * k + oy }, q = { x: bx * k + ox, y: by * k + oy };
    if (kind === 'oval') parts.push(`<circle cx="${f((p.x + q.x) / 2)}" cy="${f((p.y + q.y) / 2)}" r="${f(Math.abs(q.x - p.x) / 2)}" stroke-width="1"/>`);
    else line(p, q);
  }
  // aromatic rings drawn with a circle (an ellipse when the ring is seen at an angle)
  for (const ring of t.circle ?? []) {
    const c = circleIn(ring.map(P));
    if (c.ellipse) {
      const ax = ellipseAxes(c.ellipse);
      const rx = Math.hypot(ax.major.x, ax.major.y), ry = Math.hypot(ax.minor.x, ax.minor.y);
      parts.push(`<ellipse cx="${f(c.center.x)}" cy="${f(c.center.y)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f((Math.atan2(ax.major.y, ax.major.x) * 180) / Math.PI)} ${f(c.center.x)} ${f(c.center.y)})" stroke-width="1"/>`);
    } else {
      parts.push(`<circle cx="${f(c.center.x)}" cy="${f(c.center.y)}" r="${f(c.radius)}" stroke-width="1"/>`);
    }
  }
  layouts.forEach((lay, i) => {
    if (!lay) return;
    const p = P(i);
    for (const r of lay.runs) {
      parts.push(`<text x="${f(p.x + r.dx * k)}" y="${f(p.y + r.dy * k)}" font-size="${f(r.size * k)}" fill="currentColor" stroke="none">${esc(r.text)}</text>`);
    }
  });
  if (showCode) parts.push(`<text x="${size / 2}" y="${size - 2}" font-size="10" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">${codeOf(t)}</text>`);
  return svg(size, parts.join(''));
}
