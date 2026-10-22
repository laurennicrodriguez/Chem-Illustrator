// A design shape's Shape Effects in PowerPoint's own words: the effect list (glow, shadow,
// reflection, soft edges, in the order the format wants them) and a bevel as a 3-D top edge.

import type { BevelKind, Shape } from '../model';
import { BEVELS } from '../render/shape-fx';

const EMU = 12700;
const emu = (pt: number) => Math.round(pt * EMU);
const hex6 = (c: string) => c.replace('#', '').slice(0, 6).toUpperCase().padEnd(6, '0');
const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100000);

/**
 * The effect list (with the shadow's own XML, already written, in its place) and the bevel's
 * 3-D settings, to follow a shape's line in its spPr. Empty when it has none.
 */
export function effectsXml(s: Shape, outerShdw: string): string {
  const parts: string[] = [];
  if (s.glow && s.glow.size > 0) parts.push(`<a:glow rad="${emu(s.glow.size)}"><a:srgbClr val="${hex6(s.glow.color)}"><a:alpha val="${pct(1 - s.glow.transparency)}"/></a:srgbClr></a:glow>`);
  if (outerShdw) parts.push(outerShdw);
  if (s.reflection && s.reflection.size > 0) {
    const r = s.reflection;
    parts.push(`<a:reflection${r.blur ? ` blurRad="${emu(r.blur)}"` : ''} stA="${pct(r.opacity)}" stPos="0" endA="0" endPos="${pct(r.size)}" dist="${emu(r.dist)}" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/>`);
  }
  if (s.softEdge && s.softEdge > 0) parts.push(`<a:softEdge rad="${emu(s.softEdge)}"/>`);
  const list = parts.length ? `<a:effectLst>${parts.join('')}</a:effectLst>` : '';
  const bevel = s.bevel && s.bevel.w > 0
    ? `<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d><a:bevelT w="${emu(s.bevel.w)}" h="${emu(s.bevel.h)}" prst="${s.bevel.kind}"/></a:sp3d>`
    : '';
  return list + bevel;
}

const kid = (el: Element | null | undefined, name: string): Element | null => {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.localName === name) return c;
  return null;
};
const num = (el: Element | null, attr: string, dflt: number): number => {
  const v = el?.getAttribute(attr);
  return v === null || v === undefined || v === '' || isNaN(Number(v)) ? dflt : Number(v);
};
const BEVEL_IDS = new Set<string>(BEVELS.map((b) => b.id));

/**
 * A PowerPoint shape's glow, soft edges, reflection and bevel, read from its spPr. `colour`
 * reads a colour element (with the theme's colours); `alphaOf` its see-through amount (1 solid).
 */
export function readEffects(spPr: Element | null, colour: (el: Element | null) => string | null, alphaOf: (el: Element | null) => number): Pick<Shape, 'glow' | 'softEdge' | 'reflection' | 'bevel'> {
  const out: Pick<Shape, 'glow' | 'softEdge' | 'reflection' | 'bevel'> = {};
  const fx = kid(spPr, 'effectLst');
  const glow = kid(fx, 'glow');
  if (glow) {
    const c = Array.from(glow.children)[0] ?? null;
    out.glow = { color: colour(glow) ?? '#ffc000', size: num(glow, 'rad', 0) / EMU, transparency: +(1 - alphaOf(c)).toFixed(3) };
  }
  const soft = kid(fx, 'softEdge');
  if (soft) out.softEdge = num(soft, 'rad', 0) / EMU;
  const refl = kid(fx, 'reflection');
  if (refl) {
    const blur = num(refl, 'blurRad', 0) / EMU;
    out.reflection = { size: num(refl, 'endPos', 100000) / 100000, opacity: num(refl, 'stA', 100000) / 100000, dist: num(refl, 'dist', 0) / EMU, ...(blur ? { blur } : {}) };
  }
  const top = kid(kid(spPr, 'sp3d'), 'bevelT');
  if (top) {
    const prst = top.getAttribute('prst') ?? 'circle';
    out.bevel = { kind: (BEVEL_IDS.has(prst) ? prst : 'circle') as BevelKind, w: num(top, 'w', 76200) / EMU, h: num(top, 'h', 76200) / EMU };
  }
  return out;
}
