// The icon library: about 7,000 icons from Material Design Icons (Apache-2.0, by Pictogrammers),
// in groups, with a "Lab and science" group of their own first (glassware, molecules, hazard and
// safety signs, medicine). Each icon is one outline on a 24 × 24 grid. Placed on a page, an icon
// is a design shape (kind 'geo') whose id is "icon:<name>", so it is drawn, filled, coloured,
// sized, saved and exported like any other shape in the library (design/geo.ts).
//
// The icons' data is large, so it is loaded on its own, once, after the window opens (loadIcons).
// Until then an icon draws as nothing and is kept as it is in saved files.
//
// The data is made from the @mdi/svg package by scripts/build-icons.mjs; logos of companies and
// products are left out (they are trademarks).

import type { GeoDef, GeoStep } from './geo';

/** What an icon's id starts with. */
export const ICON_PREFIX = 'icon:';

/** The credit shown with the icons (their licence asks for it). */
export const ICON_CREDIT = 'Icons: Material Design Icons by Pictogrammers, Apache License 2.0';

/** The group of lab, chemistry, safety and medical icons, shown first. */
export const LAB_GROUP = 'Lab and science';

/** Usual size of an icon put on the page, in points (an inch, as Word and PowerPoint put them in). */
export const ICON_SIZE = 72;

export interface IconInfo {
  /** The shape id: "icon:flask". */
  id: string;
  /** Its name in words: "Flask round bottom". */
  name: string;
  /** The groups it is in, the main one first. */
  groups: string[];
  /** Words to find it by (its name, other names and groups), in lower case. */
  words: string;
}

interface IconData {
  set: string;
  version: string;
  groups: string[];
  /** name, group indices, other names (comma separated), SVG path */
  icons: [string, number[], string, string][];
}

interface Loaded {
  version: string;
  groups: string[];
  list: IconInfo[];
  byId: Map<string, { info: IconInfo; d: string }>;
}

let loaded: Loaded | null = null;
let loading: Promise<void> | null = null;
const listeners: (() => void)[] = [];

export const isIconId = (id: string | undefined): id is string => !!id && id.startsWith(ICON_PREFIX);

/** An icon's name in words, from its id or its set's name ("flask-round-bottom" → "Flask round bottom"). */
export function iconName(id: string): string {
  const n = (isIconId(id) ? id.slice(ICON_PREFIX.length) : id).replace(/-/g, ' ');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Use the icons' data (loadIcons does this; tests give it directly). */
export function setIconData(data: IconData): void {
  const list: IconInfo[] = [];
  const byId = new Map<string, { info: IconInfo; d: string }>();
  for (const [name, gs, alias, d] of data.icons) {
    const id = ICON_PREFIX + name;
    const groups = gs.map((g) => data.groups[g]);
    const info: IconInfo = { id, name: iconName(name), groups, words: `${name.replace(/-/g, ' ')} ${alias.replace(/,/g, ' ')} ${groups.join(' ')}`.toLowerCase() };
    list.push(info);
    byId.set(id, { info, d });
  }
  loaded = { version: data.version, groups: data.groups, list, byId };
  defs.clear();
  for (const f of listeners.splice(0)) f();
}

/** Load the icons (once); resolves when they can be drawn. */
export function loadIcons(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= import('./icons/mdi.json').then((m) => setIconData((m.default ?? m) as unknown as IconData)).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

export const iconsLoaded = (): boolean => loaded !== null;

/** Call `f` once the icons are loaded (straight away when they are). */
export function whenIconsLoaded(f: () => void): void {
  if (loaded) f();
  else listeners.push(f);
}

/** The version of the icon set (empty until loaded). */
export const iconSetVersion = (): string => loaded?.version ?? '';

/** The groups that have icons, the lab group first and "Other" last. */
export function iconGroups(): string[] {
  if (!loaded) return [];
  const used = new Set(loaded.list.flatMap((i) => i.groups));
  return loaded.groups.filter((g) => used.has(g));
}

/** The icon with this id, or undefined (not loaded, or not one of ours). */
export const iconInfo = (id: string): IconInfo | undefined => loaded?.byId.get(id)?.info;

/**
 * Icons matching every word of `query` (as a word's start, so "test" finds "test tube" but not
 * "latest"), in `group` when given. Those whose name starts with the query come first.
 */
export function findIcons(query: string, group?: string): IconInfo[] {
  if (!loaded) return [];
  const words = query.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  const inGroup = group ? loaded.list.filter((i) => i.groups.includes(group)) : loaded.list;
  if (!words.length) return inGroup;
  const found = inGroup.filter((i) => words.every((w) => i.words.startsWith(w) || i.words.includes(` ${w}`)));
  const q = words.join(' ');
  const rank = (i: IconInfo) => { const n = i.name.toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : 2; };
  return found.map((i, n) => ({ i, n, r: rank(i) })).sort((a, b) => a.r - b.r || a.n - b.n).map((x) => x.i);
}

/** An icon's outline as SVG path data on its 24 × 24 grid (undefined when not loaded). */
export const iconPathData = (id: string): string | undefined => loaded?.byId.get(id)?.d;

/** A small SVG picture of an icon, filled with currentColor (for menus and the library). */
export function iconSvg(id: string, px = 24): string {
  const d = iconPathData(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true">${d ? `<path fill="currentColor" d="${d}"/>` : ''}</svg>`;
}

// ---------------------------------------------------------------- icons as library shapes

const unitSteps = new Map<string, GeoStep[]>();
const defs = new Map<string, GeoDef>();

/** An icon's outline drawn to fill a w × h box (empty when the icons aren't loaded yet). */
export function iconSteps(id: string, w: number, h: number): GeoStep[] {
  let u = unitSteps.get(id);
  if (!u) {
    const d = iconPathData(id);
    if (!d) return [];
    u = svgPathSteps(d).map((s) => scaleStep(s, 1 / 24, 1 / 24));
    unitSteps.set(id, u);
  }
  return u.map((s) => scaleStep(s, w, h));
}

/**
 * The library shape for an icon. Before the icons are loaded it has no outline (and loading is
 * started); its name and size are known all the same.
 */
export function iconDef(id: string): GeoDef {
  const have = defs.get(id);
  if (have) return have;
  if (!loaded) void loadIcons().catch(() => {});
  const info = iconInfo(id);
  const def: GeoDef = {
    id,
    name: info?.name ?? iconName(id),
    group: 'Icons',
    icon: true,
    size: [ICON_SIZE, ICON_SIZE],
    keywords: info?.words,
    draw: (w, h) => ({ body: iconSteps(id, w, h) }),
    text: [0, 1.05, 1, 1.4],
  };
  // keep it only once it can be drawn
  if (info) defs.set(id, def);
  return def;
}

function scaleStep(s: GeoStep, kx: number, ky: number): GeoStep {
  if (s[0] === 'Z') return s;
  if (s[0] === 'C') return ['C', s[1] * kx, s[2] * ky, s[3] * kx, s[4] * ky, s[5] * kx, s[6] * ky];
  return [s[0], s[1] * kx, s[2] * ky];
}

// ---------------------------------------------------------------- SVG path data

/**
 * SVG path data (the `d` of a <path>) as lines and Bézier curves: every command (M L H V C S Q T
 * A Z, absolute and relative) is turned into moves, lines and cubic curves.
 */
export function svgPathSteps(d: string): GeoStep[] {
  const out: GeoStep[] = [];
  let i = 0;
  const n = d.length;
  const skip = () => { while (i < n && /[\s,]/.test(d[i])) i++; };
  const num = (): number => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 40));
    if (!m) throw new Error(`Bad path data at ${i}`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  // arc flags may be written with nothing between them ("a1 1 0 011 1")
  const flag = (): number => {
    skip();
    const c = d[i++];
    if (c !== '0' && c !== '1') throw new Error(`Bad arc flag at ${i - 1}`);
    return c === '1' ? 1 : 0;
  };
  const more = () => { skip(); return i < n && /[-+.\d]/.test(d[i]); };
  let x = 0, y = 0, sx = 0, sy = 0;
  // the last control point, for S and T
  let cx = 0, cy = 0, last = '';
  let cmd = '';
  while (true) {
    skip();
    if (i >= n) break;
    if (/[A-Za-z]/.test(d[i])) cmd = d[i++];
    else if (!cmd) throw new Error('Path data must start with a command');
    do {
      const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
      const C = cmd.toUpperCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === 'Z') {
        out.push(['Z']);
        x = sx; y = sy;
        last = 'Z';
        break;
      }
      if (C === 'M') {
        x = ox + num(); y = oy + num();
        sx = x; sy = y;
        out.push(['M', x, y]);
        last = 'M';
        // more pairs after a move are lines
        cmd = rel ? 'l' : 'L';
        continue;
      }
      if (C === 'L' || C === 'H' || C === 'V') {
        if (C !== 'V') x = (C === 'H' ? (rel ? x : 0) : ox) + num();
        if (C !== 'H') y = (C === 'V' ? (rel ? y : 0) : oy) + num();
        out.push(['L', x, y]);
        last = 'L';
        continue;
      }
      if (C === 'C' || C === 'S') {
        let x1: number, y1: number;
        if (C === 'C') { x1 = ox + num(); y1 = oy + num(); }
        else if (last === 'C') { x1 = 2 * x - cx; y1 = 2 * y - cy; }
        else { x1 = x; y1 = y; }
        const x2 = ox + num(), y2 = oy + num();
        const ex = ox + num(), ey = oy + num();
        out.push(['C', x1, y1, x2, y2, ex, ey]);
        cx = x2; cy = y2; x = ex; y = ey;
        last = 'C';
        continue;
      }
      if (C === 'Q' || C === 'T') {
        let qx: number, qy: number;
        if (C === 'Q') { qx = ox + num(); qy = oy + num(); }
        else if (last === 'Q') { qx = 2 * x - cx; qy = 2 * y - cy; }
        else { qx = x; qy = y; }
        const ex = ox + num(), ey = oy + num();
        out.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
        cx = qx; cy = qy; x = ex; y = ey;
        last = 'Q';
        continue;
      }
      if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
        const ex = ox + num(), ey = oy + num();
        out.push(...arcCurves(x, y, rx, ry, rot, large, sweep, ex, ey));
        x = ex; y = ey;
        last = 'A';
        continue;
      }
      throw new Error(`Unknown path command ${cmd}`);
    } while (more());
  }
  return out;
}

/** An SVG elliptical arc from (x1, y1) to (x2, y2) as cubic Bézier curves (SVG 1.1, appendix F.6). */
function arcCurves(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: number, sweep: number, x2: number, y2: number): GeoStep[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [['L', x2, y2]];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  // radii too small to reach are scaled up
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const da = dt / segs, k = (4 / 3) * Math.tan(da / 4);
  const pt = (t: number) => {
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
  };
  const tan = (t: number) => {
    const ex = -rx * Math.sin(t), ey = ry * Math.cos(t);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };
  const out: GeoStep[] = [];
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * da, b = a + da;
    const [ax, ay] = pt(a), [bx, by] = s === segs - 1 ? [x2, y2] : pt(b);
    const [tax, tay] = tan(a), [tbx, tby] = tan(b);
    out.push(['C', ax + k * tax, ay + k * tay, bx - k * tbx, by - k * tby, bx, by]);
  }
  return out;
}
