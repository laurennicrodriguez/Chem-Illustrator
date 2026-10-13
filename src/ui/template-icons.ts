// Small pictures of the templates for the tool palettes, drawn as SVG from the template data.

import type { Template } from '../chem/templates';

const VALENCE: Record<string, number> = { N: 3, O: 2, S: 2, P: 3, B: 3 };
const SHORT: Record<string, string> = {};

/** Three-letter code for an amino acid, from its name "L-Alanine (Ala, A)". */
const codeOf = (t: Template) => (SHORT[t.id] ??= /\((\w{3}),/.exec(t.name)?.[1] ?? '');

export function templateIcon(t: Template, size = 44): string {
  const showCode = t.group === 'amino';
  const pad = 4;
  // long labels (CH2OH) need room on either side
  const xs = t.atoms.flatMap((a) => (a[4] ? [a[0] - 0.9, a[0] + 0.9] : [a[0]])), ys = t.atoms.map((a) => a[1]);
  const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
  const h = showCode ? size - 11 : size;
  const k = Math.min((size - 2 * pad) / Math.max(1, x2 - x1), (h - 2 * pad) / Math.max(1, y2 - y1), 12);
  const ox = size / 2 - ((x1 + x2) / 2) * k, oy = h / 2 - ((y1 + y2) / 2) * k;
  const P = (i: number) => ({ x: t.atoms[i][0] * k + ox, y: t.atoms[i][1] * k + oy });
  const f = (v: number) => v.toFixed(1);

  const order = new Array(t.atoms.length).fill(0);
  const nbrs: number[][] = t.atoms.map(() => []);
  for (const [a, b, o] of t.bonds) { order[a] += o; order[b] += o; nbrs[a].push(b); nbrs[b].push(a); }
  const label = (i: number): string | null => {
    const [, , el, , text] = t.atoms[i];
    if (text) return text;
    if (el === 'C') return null;
    const hs = Math.max(0, (VALENCE[el] ?? 0) - order[i]);
    return el + (hs ? 'H' : '') + (hs > 1 ? String(hs) : '');
  };
  const labelled = t.atoms.map((_, i) => label(i));
  // pull bond ends back from labels
  const end = (i: number, j: number) => {
    const p = P(i), q = P(j);
    if (!labelled[i]) return p;
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const r = Math.min(4.2, d * 0.35);
    return { x: p.x + ((q.x - p.x) / d) * r, y: p.y + ((q.y - p.y) / d) * r };
  };

  const parts: string[] = [];
  const line = (p: { x: number; y: number }, q: { x: number; y: number }, w = 1) =>
    parts.push(`<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" stroke-width="${w}"/>`);
  for (const [a, b, o, disp] of t.bonds) {
    const p = end(a, b), q = end(b, a);
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    if (disp === 'wedge' || disp === 'hashWedge') {
      const w = 2.2;
      if (disp === 'wedge') parts.push(`<polygon points="${f(p.x)},${f(p.y)} ${f(q.x + nx * w)},${f(q.y + ny * w)} ${f(q.x - nx * w)},${f(q.y - ny * w)}" fill="currentColor" stroke="none"/>`);
      else for (let s = 1; s <= 4; s++) { const u = s / 4, c = { x: p.x + dx * u, y: p.y + dy * u }; line({ x: c.x + nx * w * u, y: c.y + ny * w * u }, { x: c.x - nx * w * u, y: c.y - ny * w * u }, 0.8); }
      continue;
    }
    if (disp === 'bold') { line(p, q, 2.6); continue; }
    line(p, q);
    if (o < 2) continue;
    // the second line goes on the side where the neighbours are (inside a ring)
    const others = [...nbrs[a], ...nbrs[b]].filter((i) => i !== a && i !== b);
    let side = 0;
    for (const i of others) { const r = P(i); side += (r.x - p.x) * nx + (r.y - p.y) * ny; }
    const off = 2.3, sh = o === 3 || !others.length ? 0 : 0.18;
    const sgn = side >= 0 ? 1 : -1;
    if (o === 3 || !others.length) {
      line({ x: p.x + nx * off, y: p.y + ny * off }, { x: q.x + nx * off, y: q.y + ny * off });
      if (o === 3) line({ x: p.x - nx * off, y: p.y - ny * off }, { x: q.x - nx * off, y: q.y - ny * off });
    } else {
      line({ x: p.x + dx * sh + nx * off * sgn, y: p.y + dy * sh + ny * off * sgn }, { x: q.x - dx * sh + nx * off * sgn, y: q.y - dy * sh + ny * off * sgn });
    }
  }
  labelled.forEach((text, i) => {
    if (!text) return;
    const p = P(i);
    const fs = text.length > 3 ? 6 : 7.5;
    // numbers in labels (NH2, CH2OH) are subscripts
    let body = '', down = false;
    for (const m of text.matchAll(/(\d+)|(\D+)/g)) {
      if (m[1]) { body += `<tspan font-size="${fs * 0.7}" dy="${down ? 0 : 1.5}">${m[1]}</tspan>`; down = true; }
      else { body += `<tspan dy="${down ? -1.5 : 0}">${m[2]}</tspan>`; down = false; }
    }
    parts.push(`<text x="${f(p.x)}" y="${f(p.y + fs * 0.36)}" font-size="${fs}" text-anchor="middle" fill="currentColor" stroke="none">${body}</text>`);
  });
  if (showCode) parts.push(`<text x="${size / 2}" y="${size - 2}" font-size="9" text-anchor="middle" fill="currentColor" stroke="none" font-weight="600">${codeOf(t)}</text>`);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor" stroke-linecap="round" font-family="Arial, sans-serif" aria-hidden="true">${parts.join('')}</svg>`;
}
