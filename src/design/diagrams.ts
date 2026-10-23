// SmartArt-style diagrams (Insert ▸ Diagram): a list, process, cycle, hierarchy, relationship,
// matrix or pyramid drawn from lines of text, one item per line and Tab (or two spaces) for each
// level below. Everything is drawn as ordinary library shapes (with their text inside them) and
// connectors, inside an invisible frame that keeps the text and the look; changing either draws
// it again. PowerPoint and Word files get the shapes as one group, so they can be moved, resized
// and retyped there as well.
//
// A structure dropped so its middle is in an item's shape belongs to that item, as a structure in
// a table's cell does: the item keeps room for it (its words go underneath), the whole diagram
// grows so every item's structure fits, and the structure is centred in its room. It stays an
// ordinary structure, edited with the drawing tools, and moves with the diagram.

import { Doc, type Arrow, type Contents, type Entity, type Frame, type ParaStyle, type Shape, type TextRun } from '../model';
import { POINTS, selectionBox, type Selection } from '../editor/arrange';
import type { Rect, Vec } from '../geom';
import type { Measure } from '../editor/arrange';
import type { Measure as TextMeasure } from '../text/layout';
import { layoutText } from '../text/layout';
import { chemRuns } from '../text/chemtext';
import { arialWidth } from '../text-metrics';
import { tint } from '../colours';
import { frameBox } from '../editor/frames';
import { followPins, hasPins } from '../chem/pins';
import { gluePoint, shapeBox } from '../objects';
import { geoDef, HEX_CELL, sectorBox, sectorId, sliceId, textArea } from './geo';
import { findIcons, isIconId, ICON_PREFIX } from './icons';

// ---------------------------------------------------------------- the data

export type DiagramColours = 'accent' | 'shades' | 'colourful' | 'light' | 'outline' | 'mono' | 'grey';

export interface DiagramData {
  /** Which layout (DIAGRAM_LAYOUTS). */
  layout: string;
  /** The items, one per line; a Tab (or two spaces) in front for each level down. */
  text: string;
  colours: DiagramColours;
  /** The colour the colours are made from. */
  accent: string;
  /** Rounded corners on boxes. */
  rounded: boolean;
  /** A soft shadow under the main shapes. */
  shadow: boolean;
  /** Text size in points; left out, the text is made as big as fits (the same size in every shape). */
  size?: number;
  /** The box it is drawn in, in points. */
  w: number;
  h: number;
  /** Room kept for the structure in an item: the item's line (from 1) → the structure's size in points. */
  figs?: Record<string, { w: number; h: number }>;
}

export type DiagramCategory = 'List' | 'Process' | 'Cycle' | 'Hierarchy' | 'Relationship' | 'Matrix' | 'Pyramid';

export interface DiagramLayout {
  id: string;
  name: string;
  category: DiagramCategory;
  blurb: string;
  /** Text to start from. */
  sample: string;
  /** Its size when first put on a slide (points); documents take it smaller. */
  size: [number, number];
}

export const DIAGRAM_CATEGORIES: DiagramCategory[] = ['List', 'Process', 'Cycle', 'Hierarchy', 'Relationship', 'Matrix', 'Pyramid'];

const STEPS = 'Starting material\nReaction\nWork-up\nPurification\nAnalysis';

export const DIAGRAM_LAYOUTS: DiagramLayout[] = [
  { id: 'blocks', name: 'Block list', category: 'List', blurb: 'Boxes in rows, one for each item; lines below an item are listed in its box.', sample: 'Synthesis\nCharacterisation\nKinetics\nComputation\nApplications', size: [480, 260] },
  { id: 'vertical-list', name: 'Vertical bullet list', category: 'List', blurb: 'A bar for each item with the lines below it as bullets underneath.', sample: 'Aims\n\tMake the ligand in three steps\n\tScreen the catalysts\nResults\n\tFive new complexes\n\tUp to 96% ee', size: [480, 300] },
  { id: 'horizontal-list', name: 'Horizontal bullet list', category: 'List', blurb: 'A heading for each item with its lines as bullets in a column below.', sample: 'NMR\n\t¹H and ¹³C\n\tNOESY\nMass spec\n\tHRMS (ESI)\nX-ray\n\tSingle crystal', size: [480, 280] },
  { id: 'honeycomb', name: 'Honeycomb', category: 'List', blurb: 'Hexagons fitted together, one for each item; lines below an item are listed in its hexagon.', sample: 'Bench-stable salts\nBroad scope\nC2 and C6 selective\nScope is limited\nMade in situ\nEWG removal', size: [480, 340] },
  { id: 'icon-list', name: 'Icon list', category: 'List', blurb: 'An icon over each item, picked to match its words. Put an icon\'s name in square brackets in front to choose it: [flask] Synthesis.', sample: '[flask-round-bottom] Synthesis\n[microscope] Analysis\n[chart-line] Data\n[file-document] Paper', size: [480, 240] },
  { id: 'process', name: 'Basic process', category: 'Process', blurb: 'Boxes joined by arrows, left to right.', sample: STEPS, size: [560, 180] },
  { id: 'chevrons', name: 'Chevron process', category: 'Process', blurb: 'Chevrons pointing on; lines below an item are listed under its chevron.', sample: 'Design\n\tRetrosynthesis\nMake\n\tSix steps\nTest\n\tBioassay', size: [560, 200] },
  { id: 'vertical-process', name: 'Vertical process', category: 'Process', blurb: 'Boxes joined by arrows, top to bottom.', sample: 'Quench\nExtract\nDry\nConcentrate', size: [280, 380] },
  { id: 'steps', name: 'Staircase', category: 'Process', blurb: 'Steps rising from left to right.', sample: 'Hit\nLead\nCandidate\nDrug', size: [480, 300] },
  { id: 'arch', name: 'Bending process', category: 'Process', blurb: 'Circles along a band that bends over one and under the next; lines below an item are its caption, on the open side. A line of just [] is a circle with no words, for a structure.', sample: 'Metal\n\tIridium and rhodium\nLigands\n\tPhosphines\nAdditives\nSolvent\n\tEthers', size: [600, 260] },
  { id: 'arrow-circles', name: 'Circles on an arrow', category: 'Process', blurb: 'Circles along a broad arrow; lines below an item are its caption, above and below in turn.', sample: 'Step 1\n\tMost reactive\nStep 2\n\tLess reactive\nStep 3\n\tLeast reactive', size: [560, 240] },
  { id: 'timeline', name: 'Timeline', category: 'Process', blurb: 'Points along a line, labelled above and below in turn.', sample: '1828\n\tWöhler: urea\n1856\n\tPerkin: mauveine\n1912\n\tGrignard\n1990\n\tCorey', size: [560, 240] },
  { id: 'equation', name: 'Equation', category: 'Process', blurb: 'Items joined by plus signs, with an arrow to the last.', sample: 'Aryl halide\nBoronic acid\nBiaryl', size: [520, 160] },
  { id: 'cycle', name: 'Basic cycle', category: 'Cycle', blurb: 'Circles round a loop, joined by curved arrows.', sample: 'Oxidative addition\nTransmetalation\nReductive elimination', size: [380, 380] },
  { id: 'ring', name: 'Segmented ring', category: 'Cycle', blurb: 'A ring cut into a segment for each item. Indent the others under a first item to put it in the middle.', sample: 'Electrochemical\nPhotoredox\nZincke type\nChan–Lam coupling', size: [380, 380] },
  { id: 'radial', name: 'Radial', category: 'Cycle', blurb: 'The first item in the middle, the others round it. Indent the outer ones under the first to make it clear.', sample: 'Catalyst\n\tLigand\n\tMetal\n\tBase\n\tSolvent', size: [400, 400] },
  { id: 'org', name: 'Hierarchy', category: 'Hierarchy', blurb: 'A tree from the top down (an organisation chart). Indent an item under the one it comes from.', sample: 'PI\n\tPostdoc\n\t\tGrad student\n\t\tGrad student\n\tLab manager\n\t\tUndergraduate', size: [520, 320] },
  { id: 'tree-h', name: 'Horizontal hierarchy', category: 'Hierarchy', blurb: 'A tree from left to right.', sample: 'Hydrocarbons\n\tAliphatic\n\t\tAlkanes\n\t\tAlkenes\n\tAromatic\n\t\tBenzenoid\n\t\tHeteroaromatic', size: [520, 320] },
  { id: 'venn', name: 'Venn', category: 'Relationship', blurb: 'Circles that overlap, see-through so the overlaps show.', sample: 'Yield\nSelectivity\nCost', size: [380, 360] },
  { id: 'target', name: 'Target', category: 'Relationship', blurb: 'Rings inside rings, the first item outermost.', sample: 'Natural products\nAlkaloids\nIndole alkaloids\nStrychnine', size: [380, 380] },
  { id: 'matrix', name: 'Matrix', category: 'Matrix', blurb: 'Four quarters. Indent four items under a first one to put it in the middle.', sample: 'Fast and cheap\nFast and costly\nSlow and cheap\nSlow and costly', size: [400, 360] },
  { id: 'pyramid', name: 'Pyramid', category: 'Pyramid', blurb: 'Layers of a pyramid, the first at the top.', sample: 'Total synthesis\nMethods\nMechanism\nFundamentals', size: [420, 340] },
  { id: 'funnel', name: 'Funnel', category: 'Pyramid', blurb: 'Layers narrowing downwards, the first at the top (an upside-down pyramid).', sample: 'Library (10,000)\nHits (300)\nLeads (12)\nCandidate (1)', size: [420, 340] },
];

export const DIAGRAM_BY_ID = new Map(DIAGRAM_LAYOUTS.map((l) => [l.id, l]));

export const DIAGRAM_COLOURS: [DiagramColours, string][] = [
  ['accent', 'Accent colour'], ['shades', 'Shades of the accent'], ['colourful', 'Colourful'], ['light', 'Light fill, coloured line'],
  ['outline', 'Outline only'], ['mono', 'Black and white (journals)'], ['grey', 'Greys'],
];

/** Office's accent colours, in turn, for the colourful look. */
export const COLOURFUL = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];

export const DIAGRAM_DEFAULTS: Omit<DiagramData, 'layout' | 'text' | 'w' | 'h'> = { colours: 'accent', accent: '#4472c4', rounded: true, shadow: false };

// ---------------------------------------------------------------- the text

export interface DiagramItem {
  text: string;
  /** An icon chosen in square brackets in front ("icon:…"). */
  icon?: string;
  kids: DiagramItem[];
  /** Its line among the lines with something on them, from 1. */
  n: number;
  /** How far down the outline it is: 0 for the items at the top. */
  depth: number;
}

const LEAD = /^[\t ]*/;
const BULLET = /^[•\-*–·▪◦]\s+/;
const ICON = /^\[([a-z0-9-]+)\]\s*/i;

/** A line's level (Tabs, or two spaces each) and its text without a bullet typed in front. */
function lineParts(line: string): { level: number; text: string; icon?: string } {
  const lead = LEAD.exec(line)![0];
  let level = 0;
  for (const ch of lead) level += ch === '\t' ? 1 : 0.5;
  let text = line.slice(lead.length).trim().replace(BULLET, '');
  let icon: string | undefined;
  const m = ICON.exec(text);
  if (m) { icon = ICON_PREFIX + m[1].toLowerCase(); text = text.slice(m[0].length); }
  // [] on its own: an item with no words (room for a structure only)
  if (text === '[]') text = '';
  return { level: Math.floor(level + 1e-9), text, ...(icon ? { icon } : {}) };
}

/** The items as a tree: each line under the nearest line above it that is less indented. */
export function parseOutline(text: string): DiagramItem[] {
  const roots: DiagramItem[] = [];
  const stack: { level: number; item: DiagramItem }[] = [];
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = lineParts(line);
    while (stack.length && stack[stack.length - 1].level >= p.level) stack.pop();
    const item: DiagramItem = { text: p.text, kids: [], n: ++n, depth: stack.length, ...(p.icon ? { icon: p.icon } : {}) };
    if (stack.length) stack[stack.length - 1].item.kids.push(item);
    else roots.push(item);
    stack.push({ level: p.level, item });
  }
  return roots;
}

/** The text with item `n`'s words changed (its indent and icon kept). */
export function setItemText(text: string, n: number, words: string): string {
  let k = 0;
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim() || ++k !== n) return line;
    const lead = LEAD.exec(line)![0];
    const rest = line.slice(lead.length);
    const icon = ICON.exec(rest.replace(BULLET, ''))?.[0] ?? '';
    return lead + icon + words;
  }).join('\n');
}

/** Item and every item below it, in order (the lines n…). */
function withKids(it: DiagramItem): DiagramItem[] {
  return [it, ...it.kids.flatMap(withKids)];
}

/** Plain words of a typed line, as they show (markup for sub- and superscripts taken out). */
export const shownText = (t: string): string => chemRuns(t).map((r) => r.text).join('');

// ---------------------------------------------------------------- layouts

/** What a role is drawn as: the main shapes, boxes of lines under them, text only, small marks (arrows, plus signs, dots), icons, and a solid band (a bending process's). */
type Role = 'item' | 'sub' | 'label' | 'deco' | 'icon' | 'band';

/** A shape of a diagram as laid out, before it is coloured: its box from the diagram's top left. */
export interface PartShape {
  geo: string;
  box: Rect;
  role: Role;
  /** What it says: its first paragraph (absent for a box of lines only), then lines as bullets. */
  head?: DiagramItem;
  lines?: DiagramItem[];
  /** Which colour of the scheme (0 … tones - 1). */
  tone: number;
  align?: Shape['textAlign'];
  valign?: Shape['textValign'];
  /** See-through (Venn circles). */
  clear?: number;
  /** Text of this role group sized on its own (a target's rings). */
  group?: string;
  /** Only this much of the text area's width is used for fitting (Venn circles, clear of the overlaps). */
  fitW?: number;
  /** The size of the structure put in it (DiagramData.figs): it takes the top of the text area, the words go underneath. */
  fig?: { w: number; h: number };
}

/** A line or arrow of a diagram, from the diagram's top left; `from`/`to` stick it to shapes (index, side). */
export interface PartLine {
  tail: Vec;
  head: Vec;
  sweep?: number;
  elbow?: boolean;
  arrow?: boolean;
  from?: [number, number];
  to?: [number, number];
  tone: number;
}

export interface DiagramLaid { shapes: PartShape[]; lines: PartLine[]; tones: number }

const R = (x: number, y: number, w: number, h: number): Rect => ({ x1: x, y1: y, x2: x + w, y2: y + h });

/** The best rows × columns for n boxes in a w × h area (boxes near 1.6 wide to 1 high). */
function grid(n: number, w: number, h: number, g: number, aspect = 1.6): { c: number; r: number; bw: number; bh: number } {
  let best = { c: 1, r: n, bw: w, bh: h, score: Infinity };
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const bw = (w - (c - 1) * g) / c, bh = (h - (r - 1) * g) / r;
    if (bw <= 0 || bh <= 0) continue;
    const score = Math.abs(Math.log(bw / bh / aspect));
    if (score < best.score - 1e-9) best = { c, r, bw, bh, score };
  }
  return best;
}

/** Leaves under an item (1 for an item with none). */
const leaves = (it: DiagramItem): number => (it.kids.length ? it.kids.reduce((a, k) => a + leaves(k), 0) : 1);
const depth = (it: DiagramItem): number => 1 + Math.max(0, ...it.kids.map(depth));

/** The layout's shapes, with the room each item keeps for its structure. */
function lay(d: DiagramData): DiagramLaid {
  const laid = layOut(d);
  if (d.figs) for (const [n, p] of itemShapes(laid)) { const f = d.figs[String(n)]; if (f) p.fig = f; }
  return laid;
}

/** The shape showing each item's words (where a structure for the item goes), by the item's line. */
function itemShapes(laid: DiagramLaid): Map<number, PartShape> {
  const out = new Map<number, PartShape>();
  for (const p of laid.shapes) if (p.head && (p.role === 'item' || p.role === 'label') && !out.has(p.head.n)) out.set(p.head.n, p);
  return out;
}

function layOut(d: DiagramData): DiagramLaid {
  const items = parseOutline(d.text);
  const w = Math.max(20, d.w), h = Math.max(20, d.h);
  const g = Math.max(3, 0.03 * Math.min(w, h));
  const box = d.rounded ? 'roundRect' : 'rect';
  const shapes: PartShape[] = [];
  const lines: PartLine[] = [];
  const n = items.length;
  const out = (tones: number): DiagramLaid => ({ shapes, lines, tones: Math.max(1, tones) });
  if (!n) return out(1);
  const kidsOf = (it: DiagramItem) => it.kids.flatMap(withKids);
  switch (d.layout) {
    default:
    case 'blocks': {
      const q = grid(n, w, h, g);
      items.forEach((it, i) => {
        const r = Math.floor(i / q.c), inRow = Math.min(q.c, n - r * q.c);
        const x0 = (w - (inRow * q.bw + (inRow - 1) * g)) / 2;
        shapes.push({ geo: box, box: R(x0 + (i % q.c) * (q.bw + g), r * (q.bh + g), q.bw, q.bh), role: 'item', head: it, lines: kidsOf(it), tone: i });
      });
      return out(n);
    }
    case 'vertical-list': {
      const rows = items.map((it) => kidsOf(it).length);
      const units = rows.reduce((a, k) => a + 1 + (k ? 0.15 + 0.55 * k : 0), 0);
      const u = (h - (n - 1) * g) / units;
      let y = 0;
      items.forEach((it, i) => {
        const bar = Math.min(u, 0.35 * w);
        shapes.push({ geo: box, box: R(0, y, w, bar), role: 'item', head: it, tone: i, align: 'left' });
        y += bar;
        const k = rows[i];
        if (k) {
          const sh = u * (0.15 + 0.55 * k);
          shapes.push({ geo: 'rect', box: R(0.04 * w, y, 0.92 * w, sh), role: 'sub', lines: kidsOf(it), tone: i, align: 'left', valign: 'top' });
          y += sh;
        }
        y += g + (u - bar);
      });
      return out(n);
    }
    case 'horizontal-list': {
      const any = items.some((it) => it.kids.length);
      const bw = (w - (n - 1) * g) / n;
      const hh = any ? Math.min(0.3 * h, Math.max(0.18 * h, bw * 0.45)) : h;
      items.forEach((it, i) => {
        const x = i * (bw + g);
        shapes.push({ geo: box, box: R(x, 0, bw, hh), role: 'item', head: it, tone: i });
        if (any) shapes.push({ geo: 'rect', box: R(x + 0.04 * bw, hh, 0.92 * bw, h - hh), role: 'sub', lines: kidsOf(it), tone: i, align: 'left', valign: 'top' });
      });
      return out(n);
    }
    case 'honeycomb': {
      // flat-topped hexagons fitted together in columns, every other column half a cell down;
      // as many columns as make the cells biggest. A cell of radius r is 2r wide and √3 r high
      const r3 = Math.sqrt(3);
      // rows high, and half a cell more when a lower column has a cell in the last row
      const high = (c: number) => { const rows = Math.ceil(n / c); return rows + (c > 1 && n - (rows - 1) * c >= 2 ? 0.5 : 0); };
      let best = { c: 1, r: 0 };
      for (let c = 1; c <= n; c++) {
        const r = Math.min(w / (1.5 * c + 0.5), h / (r3 * high(c)));
        if (r > best.r + 1e-9) best = { c, r };
      }
      const { c, r } = best;
      const gw = r * (1.5 * c + 0.5), gh = r3 * r * high(c);
      const x0 = (w - gw) / 2, y0 = (h - gh) / 2;
      const q = Math.max(0.5 * r, r - g / 2);
      items.forEach((it, i) => {
        const col = i % c, row = Math.floor(i / c);
        const cx = x0 + r + 1.5 * r * col, cy = y0 + r3 * r * (row + 0.5 + (col % 2 ? 0.5 : 0));
        shapes.push({ geo: HEX_CELL, box: R(cx - q, cy - (r3 / 2) * q, 2 * q, r3 * q), role: 'item', head: it, lines: kidsOf(it), tone: i });
      });
      return out(n);
    }
    case 'icon-list': {
      const bw = (w - (n - 1) * g) / n;
      const s = Math.min(0.7 * bw, 0.45 * h);
      items.forEach((it, i) => {
        const x = i * (bw + g);
        shapes.push({ geo: iconFor(it), box: R(x + (bw - s) / 2, 0, s, s), role: 'icon', tone: i });
        shapes.push({ geo: 'rect', box: R(x, s + g, bw, h - s - g), role: 'label', head: it, lines: kidsOf(it), tone: i, valign: 'top' });
      });
      return out(n);
    }
    case 'process': {
      // boxes, and an arrow 0.3 of a box wide between each two
      const p = 0.12 * g + 2;
      const bw = (w - (n - 1) * 2 * p) / (n + 0.3 * (n - 1));
      const aw = 0.3 * bw;
      const any = items.some((it) => it.kids.length);
      const bh = Math.min(h, bw * (any ? 1.1 : 0.7));
      const y = (h - bh) / 2;
      items.forEach((it, i) => {
        const x = i * (bw + aw + 2 * p);
        shapes.push({ geo: box, box: R(x, y, bw, bh), role: 'item', head: it, lines: kidsOf(it), tone: i });
        if (i < n - 1) {
          const ah = Math.min(aw * 1.2, bh * 0.45);
          shapes.push({ geo: 'rightArrow', box: R(x + bw + p, h / 2 - ah / 2, aw, ah), role: 'deco', tone: i });
        }
      });
      return out(n);
    }
    case 'chevrons': {
      const any = items.some((it) => it.kids.length);
      const hc = any ? 0.38 * h : h;
      const gap = Math.max(1.5, 0.4 * g);
      let cw = (w - (n - 1) * gap) / (n - 0.275 * (n - 1));
      let ch = 0.55 * cw;
      if (ch > hc) { ch = hc; cw = (w + (n - 1) * (ch / 2 - gap)) / n; }
      const y = any ? 0 : (h - ch) / 2;
      items.forEach((it, i) => {
        const x = i * (cw - ch / 2 + gap);
        shapes.push({ geo: i ? 'chevron' : 'homePlate', box: R(x, y, cw, ch), role: 'item', head: it, tone: i });
        if (any) shapes.push({ geo: 'rect', box: R(x + (i ? ch / 2 : 0), ch + g, cw - ch / 2, h - ch - g), role: 'label', lines: kidsOf(it), tone: i, align: 'left', valign: 'top' });
      });
      return out(n);
    }
    case 'vertical-process': {
      const bh = (h) / (n + 0.45 * (n - 1));
      const ah = 0.45 * bh;
      const bw = Math.min(w, Math.max(bh * 4, 0.6 * w));
      const x = (w - bw) / 2;
      items.forEach((it, i) => {
        const y = i * (bh + ah);
        shapes.push({ geo: box, box: R(x, y, bw, bh), role: 'item', head: it, lines: kidsOf(it), tone: i });
        if (i < n - 1) {
          const aw = Math.min(ah * 1.2, bw * 0.3);
          shapes.push({ geo: 'downArrow', box: R(w / 2 - aw / 2, y + bh + ah * 0.1, aw, ah * 0.8), role: 'deco', tone: i });
        }
      });
      return out(n);
    }
    case 'steps': {
      const bw = (w - (n - 1) * g) / n;
      const rise = n > 1 ? h / (n + 1) : 0;
      const bh = h - rise * (n - 1);
      items.forEach((it, i) => {
        const top = (n - 1 - i) * rise;
        shapes.push({ geo: box, box: R(i * (bw + g), top, bw, Math.min(bh, h - top)), role: 'item', head: it, lines: kidsOf(it), tone: i, valign: 'top' });
      });
      return out(n);
    }
    case 'arch': {
      // circles in a row, each half wrapped by a band that bends over one and under the next, the
      // half turns meeting end to end; in circle diameters, the band runs from ri to ro round each middle
      const any = items.some((it) => it.kids.length);
      const ri = 0.6, ro = 0.76, s = ri + ro;
      const cap = any ? 1 : 0;
      const span = (n - 1) * s + 2 * ro;
      const u = Math.min(w / span, h / (2 * ro + 2 * cap));
      const x0 = (w - span * u) / 2 + ro * u, cy = h / 2;
      items.forEach((it, i) => {
        const cx = x0 + i * s * u;
        const over = i % 2 === 0;
        shapes.push({ geo: sectorId(over ? 180 : 0, over ? 360 : 180, ri / ro), box: R(cx - ro * u, over ? cy - ro * u : cy, 2 * ro * u, ro * u), role: 'band', tone: 0 });
        shapes.push({ geo: 'ellipse', box: R(cx - u / 2, cy - u / 2, u, u), role: 'item', head: it, tone: i });
        if (!any) return;
        // the caption on the open side, past the ends of the bands either side
        const lw = Math.min(2 * s * u - g, 2 * Math.min(cx, w - cx));
        const ch = Math.max(1, cap * u - g / 2);
        shapes.push({ geo: 'rect', box: R(cx - lw / 2, over ? cy + ro * u + g / 2 : cy - ro * u - g / 2 - ch, lw, ch), role: 'label', lines: kidsOf(it), tone: i, valign: over ? 'top' : 'bottom' });
      });
      return out(n);
    }
    case 'arrow-circles': {
      // circles along a broad arrow, room for its head after the last; captions above and below in turn
      const any = items.some((it) => it.kids.length);
      const step = w / (n + 0.35);
      const D = Math.min(0.8 * step, any ? h / 2.6 : h / 1.05);
      const cy = h / 2;
      shapes.push({ geo: 'rightArrow', box: R(0, cy - 0.45 * D, w, 0.9 * D), role: 'deco', tone: 0 });
      items.forEach((it, i) => {
        const cx = (i + 0.5) * step;
        shapes.push({ geo: 'ellipse', box: R(cx - D / 2, cy - D / 2, D, D), role: 'item', head: it, tone: i });
        if (!any) return;
        const lw = Math.min(2 * step - g, 2 * Math.min(cx, w - cx));
        const above = i % 2 === 0;
        const ch = cy - D / 2 - g;
        shapes.push({ geo: 'rect', box: R(cx - lw / 2, above ? 0 : cy + D / 2 + g, lw, ch), role: 'label', lines: kidsOf(it), tone: i, valign: above ? 'bottom' : 'top' });
      });
      return out(n);
    }
    case 'timeline': {
      const y = h / 2;
      const step = w / n;
      const r = Math.max(3, Math.min(0.05 * h, 0.12 * step));
      lines.push({ tail: { x: 0, y }, head: { x: w, y }, arrow: true, tone: 0 });
      items.forEach((it, i) => {
        const cx = (i + 0.5) * step;
        shapes.push({ geo: 'ellipse', box: R(cx - r, y - r, 2 * r, 2 * r), role: 'deco', tone: i });
        const lh = y - r - g;
        // labels above and below in turn, each with twice the room across
        // centred on its point: as wide as the room to the next label on its side, less at the ends
        const lw = Math.min(2 * step - g, 2 * Math.min(cx, w - cx));
        const lx = cx - lw / 2;
        const above = i % 2 === 0;
        shapes.push({ geo: 'rect', box: R(lx, above ? 0 : y + r + g, lw, lh), role: 'label', head: it, lines: kidsOf(it), tone: i, valign: above ? 'bottom' : 'top' });
      });
      return out(n);
    }
    case 'equation': {
      const k = 0.45;
      const s = Math.min(h, (w - (n - 1) * 2 * g) / (n + k * (n - 1)));
      const total = n * s + (n - 1) * (k * s + 2 * g);
      let x = (w - total) / 2;
      const y = (h - s) / 2;
      items.forEach((it, i) => {
        shapes.push({ geo: 'ellipse', box: R(x, y, s, s), role: 'item', head: it, lines: kidsOf(it), tone: i });
        x += s + g;
        if (i < n - 1) {
          const ow = k * s;
          const last = i === n - 2;
          const oh = last ? ow * 0.75 : ow;
          shapes.push({ geo: last ? 'rightArrow' : 'plus', box: R(x, h / 2 - oh / 2, ow, oh), role: 'deco', tone: i });
          x += ow + g;
        }
      });
      return out(n);
    }
    case 'cycle': {
      const S = Math.min(w, h) / 2;
      const c = { x: w / 2, y: h / 2 };
      const sn = n > 1 ? Math.sin(Math.PI / n) : 1;
      const dia = Math.min(0.8 * S, (1.3 * S * sn) / (1 + 0.65 * sn));
      const rad = n > 1 ? S - dia / 2 : 0;
      const at = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
      items.forEach((it, i) => {
        const p = { x: c.x + rad * Math.cos(at(i)), y: c.y + rad * Math.sin(at(i)) };
        shapes.push({ geo: 'ellipse', box: R(p.x - dia / 2, p.y - dia / 2, dia, dia), role: 'item', head: it, lines: kidsOf(it), tone: i });
      });
      if (n > 1) {
        // arcs along the loop from one circle to the next, clear of both
        const off = 2 * Math.asin(Math.min(1, (dia / 2 + g) / (2 * rad)));
        for (let i = 0; i < n; i++) {
          const a0 = at(i) + off, a1 = at(i + 1) - off;
          if (a1 - a0 < 0.05) continue;
          lines.push({
            tail: { x: c.x + rad * Math.cos(a0), y: c.y + rad * Math.sin(a0) },
            head: { x: c.x + rad * Math.cos(a1), y: c.y + rad * Math.sin(a1) },
            sweep: a1 - a0, arrow: true, tone: i,
          });
        }
      }
      return out(n);
    }
    case 'ring': {
      // a ring cut into a segment for each item, the first centred at twelve o'clock (so the segments
      // at the top and bottom run across, with room for words); the first in the middle when the others are indented under it
      const { hub, outer } = items.length === 1 && items[0].kids.length ? hubAndOuter(items) : { hub: null as DiagramItem | null, outer: items };
      const m = outer.length;
      const S = Math.min(w, h) / 2;
      const c = { x: w / 2, y: h / 2 };
      const k = hub ? 0.5 : 0.45;
      const gap = m > 1 ? Math.min(0.2, (2 * g) / (S * (1 + k))) : 0;
      const deg = (a: number) => (a * 180) / Math.PI;
      outer.forEach((it, i) => {
        const start = -Math.PI / 2 - Math.PI / m;
        const a0 = start + (i * 2 * Math.PI) / m + gap / 2;
        const a1 = m > 1 ? start + ((i + 1) * 2 * Math.PI) / m - gap / 2 : a0 + (359.9 * Math.PI) / 180;
        const b = sectorBox(a0, a1, k);
        shapes.push({ geo: sectorId(deg(a0), deg(a1), k), box: R(c.x + S * b.x1, c.y + S * b.y1, S * (b.x2 - b.x1), S * (b.y2 - b.y1)), role: 'item', head: it, lines: kidsOf(it), tone: i });
      });
      if (hub) {
        const rc = Math.max(1, k * S - g);
        shapes.push({ geo: 'ellipse', box: R(c.x - rc, c.y - rc, 2 * rc, 2 * rc), role: 'item', head: hub, tone: m, group: 'hub' });
      }
      return out(m + (hub ? 1 : 0));
    }
    case 'radial': {
      const { hub, outer } = hubAndOuter(items);
      const m = outer.length;
      const S = Math.min(w, h) / 2;
      const c = { x: w / 2, y: h / 2 };
      const sn = m > 1 ? Math.sin(Math.PI / m) : 0.5;
      const k = Math.min(0.3, (0.9 * sn) / (1 + 0.9 * sn));
      const rs = k * S, dist = S - rs;
      const rc = Math.max(rs, Math.min(0.36 * S, dist - rs - g));
      shapes.push({ geo: 'ellipse', box: R(c.x - rc, c.y - rc, 2 * rc, 2 * rc), role: 'item', head: hub, tone: 0 });
      outer.forEach((it, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / m;
        const u = { x: Math.cos(a), y: Math.sin(a) };
        const p = { x: c.x + dist * u.x, y: c.y + dist * u.y };
        shapes.push({ geo: 'ellipse', box: R(p.x - rs, p.y - rs, 2 * rs, 2 * rs), role: 'item', head: it, lines: kidsOf(it), tone: i + 1 });
        lines.push({ tail: { x: c.x + rc * u.x, y: c.y + rc * u.y }, head: { x: p.x - rs * u.x, y: p.y - rs * u.y }, tone: i + 1 });
      });
      return out(m + 1);
    }
    case 'org': case 'tree-h': {
      const across = d.layout === 'tree-h';
      const total = items.reduce((a, it) => a + leaves(it), 0);
      const levels = Math.max(...items.map(depth));
      // each level a band along the way the tree grows (down, or to the right); each leaf a slot across it
      const k = across ? 0.35 : 0.55;
      const band = (across ? w : h) / (levels + k * (levels - 1));
      const slot = (across ? h : w) / total;
      let bw: number, bh: number;
      if (across) { bw = band; bh = Math.min(slot * 0.8, band * 0.6); }
      else { bw = Math.min(slot * 0.88, band * 2.4); bh = Math.min(band, Math.max(bw * 0.75, band * 0.5)); }
      const index = new Map<DiagramItem, number>();
      const place = (it: DiagramItem, level: number, from: number): void => {
        const mid = from + (leaves(it) * slot) / 2;
        const a = level * band * (1 + k);
        index.set(it, shapes.length);
        shapes.push({ geo: box, box: across ? R(a, mid - bh / 2, bw, bh) : R(mid - bw / 2, a + (band - bh) / 2, bw, bh), role: 'item', head: it, tone: level });
        let at = from;
        for (const kid of it.kids) {
          const kidIndex = shapes.length;
          place(kid, level + 1, at);
          at += leaves(kid) * slot;
          lines.push({ tail: { x: 0, y: 0 }, head: { x: 0, y: 0 }, elbow: true, from: [index.get(it)!, across ? 1 : 2], to: [kidIndex, across ? 3 : 0], tone: level });
        }
      };
      let at = 0;
      for (const it of items) { place(it, 0, at); at += leaves(it) * slot; }
      return out(levels);
    }
    case 'venn': {
      const m = Math.min(n, 7);
      const c = { x: w / 2, y: h / 2 };
      if (m === 1) {
        const r = Math.min(w, h) / 2;
        shapes.push({ geo: 'ellipse', box: R(c.x - r, c.y - r, 2 * r, 2 * r), role: 'item', head: items[0], lines: kidsOf(items[0]), tone: 0, clear: 0.35 });
        return out(1);
      }
      let r: number, q: number;
      if (m === 2) { r = Math.min(h / 2, w / 3.2); q = 0.6 * r; } else { r = Math.min(w, h) / 2 / 1.62; q = 0.62 * r; }
      for (let i = 0; i < m; i++) {
        const a = m === 2 ? (i ? 0 : Math.PI) : -Math.PI / 2 + (i * 2 * Math.PI) / m;
        const u = { x: Math.cos(a), y: Math.sin(a) };
        const p = { x: c.x + q * u.x, y: c.y + q * u.y };
        // the words towards the outside, away from the overlaps
        const align: Shape['textAlign'] = u.x < -0.45 ? 'left' : u.x > 0.45 ? 'right' : 'center';
        const valign: Shape['textValign'] = u.y < -0.45 ? 'top' : u.y > 0.45 ? 'bottom' : 'middle';
        shapes.push({ geo: 'ellipse', box: R(p.x - r, p.y - r, 2 * r, 2 * r), role: 'item', head: items[i], lines: kidsOf(items[i]), tone: i, clear: 0.35, align, valign, fitW: 0.62 });
      }
      return out(m);
    }
    case 'target': {
      const S = Math.min(w, h) / 2;
      const c = { x: w / 2, y: h / 2 };
      const radii = items.map((_, i) => (S * (n - i)) / n);
      items.forEach((_, i) => shapes.push({ geo: 'ellipse', box: R(c.x - radii[i], c.y - radii[i], 2 * radii[i], 2 * radii[i]), role: 'deco', tone: i }));
      // each item's words in its ring's top band (the last in the middle circle)
      items.forEach((it, i) => {
        const inner = i < n - 1 ? radii[i + 1] : 0;
        const band = i < n - 1 ? radii[i] - inner : 2 * radii[i];
        const top = c.y - radii[i];
        const lw = i < n - 1 ? 2 * Math.sqrt(Math.max(0, radii[i] * radii[i] - (radii[i] - band * 0.75) ** 2)) * 0.9 : 1.4 * radii[i];
        shapes.push({ geo: 'rect', box: R(c.x - lw / 2, i < n - 1 ? top + band * 0.08 : c.y - band * 0.35, lw, band * (i < n - 1 ? 0.84 : 0.7)), role: 'label', head: it, lines: kidsOf(it), tone: i, group: 'ring' });
      });
      return out(n);
    }
    case 'matrix': {
      const { hub, outer } = items.length === 1 && items[0].kids.length ? hubAndOuter(items) : { hub: null as DiagramItem | null, outer: items };
      const four = outer.slice(0, 4);
      const side = Math.min(w, h);
      const x0 = (w - side) / 2, y0 = (h - side) / 2;
      const q = (side - g) / 2;
      four.forEach((it, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        // the words in each quarter's outer corner, clear of the middle
        shapes.push({
          geo: box, box: R(x0 + col * (q + g), y0 + row * (q + g), q, q), role: 'item', head: it, lines: kidsOf(it), tone: i,
          ...(hub ? { align: col ? 'right' : 'left', valign: row ? 'bottom' : 'top' } as const : {}),
        });
      });
      if (hub) {
        const rc = 0.2 * side;
        shapes.push({ geo: 'ellipse', box: R(w / 2 - rc, h / 2 - rc, 2 * rc, 2 * rc), role: 'item', head: hub, tone: 4, group: 'hub' });
      }
      return out(Math.max(four.length, hub ? 5 : 1));
    }
    case 'pyramid': case 'funnel': {
      const up = d.layout === 'pyramid';
      const base = Math.min(w, 1.25 * h);
      const sh = (h - (n - 1) * g) / n;
      items.forEach((it, i) => {
        const y0 = i * (sh + g), y1 = y0 + sh;
        // widths of the whole triangle at this slice's top and bottom
        const at = (y: number) => (base * (up ? y : h - y)) / h;
        const wide = Math.max(at(y0), at(y1)), narrow = Math.min(at(y0), at(y1));
        const a = wide > 0 ? (wide - narrow) / (2 * wide) : 0;
        shapes.push({ geo: sliceId(up ? a : -a), box: R((w - wide) / 2, y0, wide, sh), role: 'item', head: it, lines: kidsOf(it), tone: i });
      });
      return out(n);
    }
  }
}

/** The middle of a radial diagram (or a matrix) and the items round it. */
function hubAndOuter(items: DiagramItem[]): { hub: DiagramItem; outer: DiagramItem[] } {
  if (items.length === 1) return { hub: { ...items[0], kids: [] }, outer: items[0].kids };
  return { hub: { ...items[0], kids: [] }, outer: [...items[0].kids, ...items.slice(1)] };
}

/** The icon over an icon list's item: the one named in brackets, else the best match for its words. */
function iconFor(it: DiagramItem): string {
  if (it.icon) return it.icon;
  const words = shownText(it.text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((x) => x.length > 2);
  for (const q of [words.join(' '), ...words]) {
    if (!q) continue;
    const hit = findIcons(q)[0];
    if (hit) return hit.id;
  }
  return ICON_PREFIX + 'checkbox-blank-circle';
}

// ---------------------------------------------------------------- colours and text

/** The colour of tone i of n. */
function toneColour(d: DiagramData, i: number, n: number): string {
  const f = n > 1 ? i / (n - 1) : 0;
  switch (d.colours) {
    case 'colourful': return COLOURFUL[i % COLOURFUL.length];
    case 'shades': return tint(d.accent, 0.6 * f);
    case 'grey': return tint('#3a3a3a', 0.65 * f);
    case 'mono': return '#000000';
    default: return d.accent;
  }
}

/** Black or white, whichever reads better on this fill. */
export function inkOn(fill: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(fill);
  if (!m) return '#000000';
  const v = parseInt(m[1], 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return L > 0.4 ? '#000000' : '#ffffff';
}

/** A shape's fill, outline and text colour for its role and tone. */
function looks(d: DiagramData, p: PartShape, c: string, f: number): { fill: string | null; line: string | null; lw: number; ink: string } {
  const solid = d.colours === 'accent' || d.colours === 'shades' || d.colours === 'colourful' || d.colours === 'grey';
  switch (p.role) {
    case 'item':
      if (solid) return { fill: c, line: p.clear ? null : '#ffffff', lw: 1, ink: inkOn(c) };
      if (d.colours === 'light') return { fill: tint(c, 0.8), line: c, lw: 1, ink: '#000000' };
      return { fill: p.clear ? null : '#ffffff', line: c, lw: 1.5, ink: '#000000' };
    case 'sub':
      if (d.colours === 'mono' || d.colours === 'outline') return { fill: '#ffffff', line: d.colours === 'mono' ? '#000000' : tint(c, 0.4), lw: 0.75, ink: '#000000' };
      return { fill: tint(c, 0.85), line: tint(c, 0.5), lw: 0.75, ink: '#000000' };
    case 'label': return { fill: null, line: null, lw: 0, ink: '#000000' };
    case 'icon': return { fill: c, line: null, lw: 0, ink: '#000000' };
    case 'band': return { fill: c, line: null, lw: 0, ink: '#000000' };
    case 'deco':
      // the broad arrow under circles: pale, so the circles stand out on it
      if (d.layout === 'arrow-circles') return { fill: d.colours === 'mono' ? '#d9d9d9' : tint(c, 0.7), line: null, lw: 0, ink: '#000000' };
      if (d.layout === 'target') {
        // rings from the accent's palest at the outside to darker in the middle
        if (solid) return { fill: d.colours === 'colourful' ? tint(c, 0.35) : tint(c, 0.75 - 0.5 * f), line: '#ffffff', lw: 1, ink: '#000000' };
        return { fill: d.colours === 'light' ? tint(c, 0.9 - 0.25 * f) : '#ffffff', line: c, lw: 1, ink: '#000000' };
      }
      if (d.colours === 'mono') return { fill: '#7f7f7f', line: null, lw: 0, ink: '#000000' };
      return { fill: tint(c, 0.45), line: null, lw: 0, ink: '#000000' };
  }
}

const textMeasure: TextMeasure = (t, size, _family, style) => arialWidth(t, size, /bold/.test(style));

/** A shape's text as runs and paragraphs: the item's words at `head` (bold above lines of its own), then its lines as bullets at `size`. */
function textOf(p: PartShape, size: number, ink: string, head: number | null): { runs: TextRun[]; paras: ParaStyle[] } | null {
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  const lines = p.lines ?? [];
  const put = (t: string, s: number, bold: boolean) => {
    if (runs.length) runs.push({ text: '\n', size: s, color: ink });
    for (const r of chemRuns(t)) runs.push({ ...r, size: s, color: ink, ...(bold ? { bold: true } : {}) });
  };
  if (p.head?.text) { put(p.head.text, head ?? size, lines.length > 0); paras.push({}); }
  const base = Math.min(...lines.map((x) => x.depth));
  for (const it of lines) {
    put(it.text, size, false);
    // lines under an item are bullets; in centred text on its own (a timeline's labels) just lines
    if (p.role === 'label' && p.align !== 'left') paras.push({});
    else paras.push({ list: 'bullet', align: 'left', ...(it.depth > base ? { level: it.depth - base } : {}) });
  }
  if (!runs.length) return null;
  return { runs, paras: paras.some((x) => Object.keys(x).length) ? paras : [] };
}

/** Where a shape's words go: its library shape's text area (a box of text only, all but a small margin). */
function textBox(p: PartShape): Rect {
  return p.geo === 'rect' && p.role !== 'item' ? { x1: p.box.x1 + 2, y1: p.box.y1 + 2, x2: p.box.x2 - 2, y2: p.box.y2 - 2 } : textArea(geoDef(p.geo), p.box.x1, p.box.y1, p.box.x2, p.box.y2);
}

/** How much of an item's text area its structure takes when it has words too (they go underneath). */
const FIG_SHARE = 0.7;

const hasWords = (p: PartShape) => !!p.head?.text || !!p.lines?.length;

/** Where the structure in a shape goes: the top of its text area when it has words too, else all of it. */
function figRoom(p: PartShape): Rect {
  const a = textBox(p);
  return hasWords(p) ? { ...a, y2: a.y1 + (a.y2 - a.y1) * FIG_SHARE } : a;
}

/** Whether a shape's text fits its text area at `size` (below its structure, when it has one). */
function fits(p: PartShape, size: number, head: number | null): boolean {
  const t = textOf(p, size, '#000000', head);
  if (!t) return true;
  const a = textBox(p);
  if (p.fig) a.y1 += (a.y2 - a.y1) * FIG_SHARE;
  const aw = (a.x2 - a.x1) * 0.94 * (p.fitW ?? 1), ah = (a.y2 - a.y1) * 0.96;
  if (aw <= 2 || ah <= 2) return false;
  const lay = layoutText({ runs: t.runs, paras: t.paras.length ? t.paras : undefined, justify: p.align ?? 'center', wrap: aw }, size, textMeasure);
  if (lay.box.y2 - lay.box.y1 > ah) return false;
  return lay.lines.every((l) => l.width <= l.room + 0.5);
}

/** The biggest size (in half points, up to `max`) at which every shape's text fits. */
function fitSize(parts: PartShape[], max: number, head: (s: number) => number | null = () => null): number {
  let lo = 4, hi = Math.max(4, max);
  if (parts.every((p) => fits(p, hi, head(hi)))) return hi;
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    if (parts.every((p) => fits(p, mid, head(mid)))) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 2) / 2;
}

/** The text sizes: the main shapes' words, and the lines under them (a little smaller). */
function sizes(d: DiagramData, laid: DiagramLaid): Map<PartShape, { size: number; head: number | null }> {
  const out = new Map<PartShape, { size: number; head: number | null }>();
  const max = d.size ?? Math.max(8, Math.min(28, Math.min(d.w, d.h) / 9));
  const groups = new Map<string, PartShape[]>();
  for (const p of laid.shapes) {
    if (!p.head && !p.lines?.length) continue;
    const k = p.group ?? (p.head ? 'items' : 'lines');
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  // shapes holding their item and its lines: the item at the main size, its lines a little smaller
  const mixed = (p: PartShape) => !!p.head && !!p.lines?.length;
  const main = d.size ?? fitSize(groups.get('items') ?? [], max, (s) => s);
  for (const [k, ps] of groups) {
    if (k === 'lines') {
      const s = d.size ? d.size * 0.85 : fitSize(ps, Math.max(6, main * 0.85));
      for (const p of ps) out.set(p, { size: s, head: null });
      continue;
    }
    const head = k === 'items' ? main : d.size ?? fitSize(ps, max, (s) => s);
    // with lines under the item in the same shape, those lines shrink first, down to 0.6 of the item
    for (const p of ps) {
      if (!mixed(p)) { out.set(p, { size: head, head }); continue; }
      let s = head * 0.85;
      if (!d.size) { const f = fitSize([p], s, () => head); s = Math.max(f, Math.min(s, head * 0.6)); }
      out.set(p, { size: s, head });
    }
  }
  // all mixed shapes in a group take the smallest line size, so they match
  const mixedSizes = [...out].filter(([p]) => mixed(p)).map(([, v]) => v.size);
  if (mixedSizes.length) { const s = Math.min(...mixedSizes); for (const [p, v] of out) if (mixed(p)) v.size = s; }
  // if a mixed shape still doesn't fit, everything comes down together
  if (!d.size) {
    for (let tries = 0; tries < 40; tries++) {
      const bad = [...out].some(([p, v]) => !fits(p, v.size, v.head));
      if (!bad) break;
      for (const v of out.values()) { v.size = Math.max(4, v.size - 0.5); if (v.head) v.head = Math.max(4, v.head - 0.5); }
    }
  }
  return out;
}

// ---------------------------------------------------------------- drawing it

/** The diagram made big enough for the structures in it: grown, keeping its shape, until every item's room holds its structure. */
function grown(d: DiagramData): DiagramData {
  if (!d.figs || !Object.keys(d.figs).length) return d;
  for (let tries = 0; tries < 8; tries++) {
    let k = 1;
    for (const p of lay(d).shapes) {
      if (!p.fig) continue;
      const r = figRoom(p);
      k = Math.max(k, p.fig.w / Math.max(1, r.x2 - r.x1), p.fig.h / Math.max(1, r.y2 - r.y1));
    }
    if (k <= 1.001) break;
    // a little over, as the gaps between shapes don't grow with them
    d = { ...d, w: d.w * k * 1.02, h: d.h * k * 1.02 };
  }
  return d;
}

/** The layout's shapes and lines, coloured, with text sized to fit, from the diagram's top left (tests and previews). */
export function diagramParts(d: DiagramData): { shapes: Omit<Shape, 'id'>[]; lines: (Omit<Arrow, 'id'> & { fromIndex?: number; toIndex?: number })[] } {
  d = grown(d);
  const laid = lay(d);
  const sz = sizes(d, laid);
  const shapes: Omit<Shape, 'id'>[] = laid.shapes.map((p) => {
    const c = toneColour(d, p.tone, laid.tones);
    const lk = looks(d, p, c, laid.tones > 1 ? p.tone / (laid.tones - 1) : 0);
    const s = sz.get(p);
    const text = s ? textOf(p, s.size, lk.ink, s.head) : null;
    const held = [...(p.head ? [p.head] : []), ...(p.lines ?? [])].map((x) => x.n);
    const sh: Omit<Shape, 'id'> = {
      kind: 'geo', geo: p.geo, ...p.box,
      filled: !!lk.fill, color: lk.line ?? lk.fill ?? '#000000', lineWidth: lk.line ? lk.lw : 0,
      ...(lk.fill && lk.line ? { fillColor: lk.fill } : {}),
      ...(p.role === 'icon' && lk.fill ? { color: lk.fill } : {}),
      ...(p.clear && lk.fill ? { transparency: p.clear } : {}),
      ...(d.shadow && (p.role === 'item' || p.role === 'icon') ? { shadow: true } : {}),
      ...(text ? { text: text.paras.length ? text : { runs: text.runs } } : {}),
      ...(p.align && p.align !== 'center' ? { textAlign: p.align } : {}),
      ...(p.fig && hasWords(p) ? { textValign: 'bottom' as const } : p.valign && p.valign !== 'middle' ? { textValign: p.valign } : {}),
      // which lines of the text it shows, so text changed in it (or in PowerPoint) goes back into the diagram's text
      ...(held.length ? { name: held.length === 1 ? `Item ${held[0]}` : `Items ${held[0]}-${held[held.length - 1]}` } : {}),
    };
    return sh;
  });
  const lw = Math.max(1, Math.min(3, Math.min(d.w, d.h) / 160));
  const lines = laid.lines.map((l) => {
    const c = toneColour(d, l.tone, laid.tones);
    const ink = d.colours === 'mono' ? '#000000' : d.colours === 'outline' || d.colours === 'light' ? c : l.arrow ? tint(c, 0.35) : tint(c, 0.25);
    const width = l.arrow ? lw * 1.6 : lw;
    const a: Omit<Arrow, 'id'> & { fromIndex?: number; toIndex?: number } = {
      tail: l.tail, head: l.head, headStyle: l.arrow ? 'full' : 'none', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false,
      sweep: l.sweep ?? 0, headLength: width * 5, headWidth: width * 2, color: ink, lineWidth: width,
      ...(l.elbow ? { elbow: true } : {}),
      ...(l.from ? { fromIndex: l.from[0], from: { shape: l.from[0], port: l.from[1] } } : {}),
      ...(l.to ? { toIndex: l.to[0], to: { shape: l.to[0], port: l.to[1] } } : {}),
    };
    return a;
  });
  return { shapes, lines };
}

/**
 * Draw a diagram in a frame of its own with its top left at `at`, or draw the diagram in frame
 * `id` again (what it drew before goes; structures and pictures put on it stay). Returns the
 * frame's id. Call inside an edit.
 */
export function putDiagram(doc: Doc, m: Measure, d: DiagramData, at: Vec, id?: number): number {
  const old = id !== undefined ? doc.shapes.get(id) : undefined;
  const kept: Pick<Frame, 'atoms' | 'shapes'> = { atoms: [], shapes: [] };
  if (old?.frame) {
    const f = old.frame;
    for (const c of f.captions) doc.removeCaption(c);
    for (const r of f.arrows) doc.removeArrow(r);
    for (const s of f.shapes) { const x = doc.shapes.get(s); if (x?.kind === 'picture') kept.shapes.push(s); else if (x) doc.removeShape(s); }
    kept.atoms = f.atoms.filter((a) => doc.atoms.has(a));
  }
  const parts = diagramParts(d);
  const move = (p: Vec) => ({ x: p.x + at.x, y: p.y + at.y });
  const made = parts.shapes.map((s) => doc.addShape({ ...s, x1: s.x1 + at.x, y1: s.y1 + at.y, x2: s.x2 + at.x, y2: s.y2 + at.y }).id);
  const arrows = parts.lines.map(({ fromIndex, toIndex, ...l }) => {
    const a: Omit<Arrow, 'id'> = { ...l, tail: move(l.tail), head: move(l.head) };
    if (fromIndex !== undefined) { a.from = { shape: made[fromIndex], port: l.from!.port }; a.tail = gluePoint(doc.shapes.get(made[fromIndex])!, l.from!.port); }
    if (toIndex !== undefined) { a.to = { shape: made[toIndex], port: l.to!.port }; a.head = gluePoint(doc.shapes.get(made[toIndex])!, l.to!.port); }
    return doc.addArrow(a).id;
  });
  const frame: Frame = { atoms: kept.atoms, captions: [], arrows, shapes: [...made, ...kept.shapes], padX: 0, padY: 0, fit: true };
  // round its shapes: its structures are placed in them afterwards (refitDiagramFigures)
  const b = frameBox(doc, { ...frame, atoms: [] }, m) ?? { x1: at.x, y1: at.y, x2: at.x + d.w, y2: at.y + d.h };
  const r = (v: number) => Math.round(v * 100) / 100;
  const diagram: DiagramData = { ...d, w: r(b.x2 - b.x1), h: r(b.y2 - b.y1) };
  if (old) { doc.updateShape(old.id, { ...b, frame, diagram }); return old.id; }
  return doc.addShape({ kind: 'geo', geo: 'rect', ...b, filled: false, lineWidth: 0, color: '#000000', frame, diagram, name: 'Diagram' }).id;
}

/** The diagram a thing belongs to (its frame's id), if any. */
export function diagramFrameOf(doc: Doc, kind: 'atom' | 'bond' | 'caption' | 'arrow' | 'shape', id: number): number | null {
  if (kind === 'shape' && doc.shapes.get(id)?.diagram) return id;
  if (kind !== 'shape' && kind !== 'arrow' && kind !== 'caption') return null;
  for (const s of doc.shapes.values()) {
    if (!s.diagram || !s.frame) continue;
    const f = s.frame;
    if (kind === 'caption' && f.captions.includes(id)) return s.id;
    if (kind === 'arrow' && f.arrows.includes(id)) return s.id;
    if (kind === 'shape' && f.shapes.includes(id)) return s.id;
  }
  return null;
}

/** The lines of the diagram's text a shape of it shows (from its name), or null. */
export function heldLines(s: Pick<Shape, 'name'>): number[] | null {
  const m = /^Items? (\d+)(?:-(\d+))?$/.exec(s.name ?? '');
  if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  return b >= a ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : null;
}

/**
 * The diagram's text with what its shapes now say (typed into one of them, here or in
 * PowerPoint or Word): each paragraph of a shape goes back to its line.
 */
export function textFromShapes(doc: Doc, frame: Shape): string {
  const d = frame.diagram!;
  let text = d.text;
  for (const id of frame.frame?.shapes ?? []) {
    const s = doc.shapes.get(id);
    const held = s && heldLines(s);
    if (!s || !held) continue;
    const paras = (s.text?.runs.map((r) => r.text).join('') ?? '').split('\n');
    if (paras.length !== held.length) continue;
    const lines = linesOf(text);
    held.forEach((n, i) => {
      const was = lines[n - 1];
      if (was === undefined) return;
      const now = paras[i].trim();
      if (now && now !== shownText(lineParts(was).text)) text = setItemText(text, n, now);
    });
  }
  return text;
}

const linesOf = (text: string) => text.split(/\r?\n/).filter((l) => l.trim());

/**
 * At the end of a change: a diagram whose frame was resized by hand (nothing inside it moved)
 * is drawn again to fill its new box; one whose shapes were typed into takes their words.
 */
export function refitDiagrams(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure): void {
  for (const s of [...doc.shapes.values()]) {
    if (!s.diagram || !s.frame) continue;
    const f = s.frame;
    // words typed into its shapes
    const typed = f.shapes.some((id) => { const was = before.get('s' + id) as Shape | null | undefined; return !!was && was.text !== doc.shapes.get(id)?.text; });
    if (typed) {
      const text = textFromShapes(doc, s);
      if (text !== s.diagram.text) doc.updateShape(s.id, { diagram: { ...s.diagram, text } });
      continue;
    }
    const old = before.get('s' + s.id) as Shape | null | undefined;
    if (!old) continue;
    const a = shapeBox(old), b = shapeBox(s);
    if (Math.abs(a.x1 - b.x1) + Math.abs(a.y1 - b.y1) + Math.abs(a.x2 - b.x2) + Math.abs(a.y2 - b.y2) < 1e-6) continue;
    const moved = f.captions.some((id) => before.has('c' + id)) || f.arrows.some((id) => before.has('r' + id)) || f.shapes.some((id) => before.has('s' + id));
    if (moved) continue;
    putDiagram(doc, m, { ...s.diagram, w: b.x2 - b.x1, h: b.y2 - b.y1 }, { x: b.x1, y: b.y1 }, s.id);
  }
}

// ---------------------------------------------------------------- structures in the items

const atomsOnly = (atoms: Set<number>): Selection => ({ atoms, bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });
const topLeft = (s: Shape): Vec => ({ x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2) });

/** The middle of a structure's atoms (what decides which item it is in). */
function atomsMiddle(doc: Doc, f: Set<number>): Vec {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of f) { const a = doc.atoms.get(id); if (!a) continue; x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y); x2 = Math.max(x2, a.x); y2 = Math.max(y2, a.y); }
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/**
 * Each item's shape as drawn (`get` finds a shape, as it is now or was) and the room in it for a
 * structure, by the item's line. Read from the drawn shapes, so it holds for a diagram opened
 * from a file as well.
 */
function itemRooms(s: Shape, get: (id: number) => Shape | null | undefined): Map<number, { box: Rect; room: Rect }> {
  const parts = itemShapes(lay(s.diagram!));
  const out = new Map<number, { box: Rect; room: Rect }>();
  for (const id of s.frame?.shapes ?? []) {
    const sh = get(id);
    const n = sh && heldLines(sh)?.[0];
    const p = n !== undefined && n !== null ? parts.get(n) : undefined;
    if (!sh || !p || out.has(n!)) continue;
    const box = shapeBox(sh);
    out.set(n!, { box, room: figRoom({ ...p, box }) });
  }
  return out;
}

/** The structures whose middles lie in a diagram's items, as item → atoms (the first found in each; where items' boxes overlap, the nearest). */
function inItems(doc: Doc, rooms: Map<number, { box: Rect; room: Rect }>, frags: Set<number>[], pick: (f: Set<number>) => boolean): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const f of frags) {
    if (!pick(f)) continue;
    const c = atomsMiddle(doc, f);
    let best: number | null = null, near = Infinity;
    for (const [n, { box, room }] of rooms) {
      if (c.x < box.x1 || c.x > box.x2 || c.y < box.y1 || c.y > box.y2) continue;
      const dist = Math.hypot(c.x - (room.x1 + room.x2) / 2, c.y - (room.y1 + room.y2) / 2);
      if (dist < near) { near = dist; best = n; }
    }
    if (best !== null && !out.has(best)) out.set(best, f);
  }
  return out;
}

/** The structures sitting in a diagram's items now (to move with it). */
export function diagramContents(doc: Doc, s: Shape): number[] {
  if (!s.diagram || !s.frame) return [];
  const out: number[] = [];
  for (const f of inItems(doc, itemRooms(s, (id) => doc.shapes.get(id)), doc.fragments(), () => true).values()) out.push(...f);
  return out;
}

const sameFigs = (a: DiagramData['figs'], b: Record<string, { w: number; h: number }>): boolean => {
  const ka = Object.keys(a ?? {}), kb = Object.keys(b);
  return ka.length === kb.length && kb.every((k) => a?.[k] && Math.abs(a[k].w - b[k].w) < 0.5 && Math.abs(a[k].h - b[k].h) < 0.5);
};

/**
 * After a change: each diagram's structures held in their items. The room each item keeps is
 * updated (the diagram drawn again, bigger if a structure needs it), and each structure is
 * centred in its room. A structure that moved is placed by where it is now; one that stayed put,
 * by where the diagram's shapes were. Call inside the edit.
 */
export function refitDiagramFigures(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure): void {
  const diagrams = [...doc.shapes.values()].filter((s) => s.diagram && s.frame);
  if (!diagrams.length) return;
  let atomsChanged = false;
  for (const k of before.keys()) if (k[0] === 'a') { atomsChanged = true; break; }
  const pad = 0.15 * doc.style.bondLength;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  let frags: Set<number>[] | null = null;
  let moved = false;
  for (const s of diagrams) {
    const was = before.get('s' + s.id) as Shape | null | undefined;
    if (!atomsChanged && !was && !s.diagram!.figs) continue;
    frags ??= doc.fragments();
    const movedNow = (f: Set<number>) => [...f].some((id) => before.has('a' + id));
    const old = was?.diagram && was.frame ? was : s;
    const wasShape = (id: number) => (before.has('s' + id) ? before.get('s' + id) as Shape | null : doc.shapes.get(id));
    const held = new Map([
      ...inItems(doc, itemRooms(old, wasShape), frags, (f) => !movedNow(f)),
      ...inItems(doc, itemRooms(s, (id) => doc.shapes.get(id)), frags, movedNow),
    ]);
    // the room each item needs now, and the diagram drawn again when that changed
    const figs: Record<string, { w: number; h: number }> = {};
    for (const [n, f] of held) {
      const b = selectionBox(doc, atomsOnly(f), m);
      if (b) figs[String(n)] = { w: r2(b.x2 - b.x1 + 2 * pad), h: r2(b.y2 - b.y1 + 2 * pad) };
    }
    if (!sameFigs(s.diagram!.figs, figs)) {
      const { figs: _, ...rest } = s.diagram!;
      putDiagram(doc, m, Object.keys(figs).length ? { ...rest, figs } : rest, topLeft(s), s.id);
    }
    // the structures belong to it (they move with it), each centred in its room
    const now = doc.shapes.get(s.id)!;
    const atoms = [...held.values()].map((f) => f.values().next().value!).sort((a, b) => a - b);
    const had = [...now.frame!.atoms].sort((a, b) => a - b);
    if (atoms.length !== had.length || atoms.some((a, i) => a !== had[i])) doc.updateShape(s.id, { frame: { ...now.frame!, atoms } });
    const rooms = itemRooms(now, (id) => doc.shapes.get(id));
    for (const [n, f] of held) {
      const room = rooms.get(n)?.room;
      const b = room && selectionBox(doc, atomsOnly(f), m);
      if (!room || !b) continue;
      const dx = (room.x1 + room.x2) / 2 - (b.x1 + b.x2) / 2, dy = (room.y1 + room.y2) / 2 - (b.y1 + b.y2) / 2;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      doc.moveAtoms(f, dx, dy);
      moved = true;
    }
  }
  if (moved && hasPins(doc)) followPins(doc);
}

/** A drawing in a document as a Doc of its own (to redraw a diagram in it). */
function docOf(c: Contents): Doc {
  const d = new Doc();
  d.restoreContents(structuredClone(c));
  let max = 0;
  for (const list of [c.atoms, c.bonds, c.captions, c.arrows, c.shapes]) for (const x of list) max = Math.max(max, x.id);
  d.reserveIds(max);
  return d;
}

/**
 * A document's diagram with the words its shapes have in Word (`said`: each shape's name → its
 * paragraphs, joined by line breaks), drawn again when any were changed there.
 */
export function retypedDiagram(c: Contents, said: Map<string, string>): Contents {
  const frame = c.shapes.find((s) => s.diagram && s.frame);
  if (!frame || !said.size) return c;
  const typed = docOf({ ...c, shapes: c.shapes.map((s) => (s.name && said.has(s.name) ? { ...s, text: { runs: [{ text: said.get(s.name)! }] } } : s)) });
  const text = textFromShapes(typed, typed.shapes.get(frame.id)!);
  if (text === frame.diagram!.text) return c;
  const d = docOf(c);
  d.edit('Diagram', () => putDiagram(d, POINTS, { ...frame.diagram!, text }, { x: Math.min(frame.x1, frame.x2), y: Math.min(frame.y1, frame.y2) }, frame.id));
  return d.contents();
}

/** Make a diagram plain shapes (Convert to Shapes): the frame goes, its shapes stay. */
export function ungroupDiagram(doc: Doc, id: number): number[] {
  const s = doc.shapes.get(id);
  if (!s?.diagram || !s.frame) return [];
  const ids = s.frame.shapes.filter((x) => doc.shapes.has(x));
  doc.removeShape(id);
  return ids;
}

/** A new diagram's data at its layout's usual size (smaller in documents: `scale`). */
export function newDiagram(layout: string, text: string | null, look: Partial<DiagramData> = {}, scale = 1): DiagramData {
  const l = DIAGRAM_BY_ID.get(layout) ?? DIAGRAM_LAYOUTS[0];
  return { ...DIAGRAM_DEFAULTS, ...look, layout: l.id, text: text ?? l.sample, w: Math.round(l.size[0] * scale), h: Math.round(l.size[1] * scale) };
}

/** A diagram's data read from a file, made safe (null when it can't be used). */
export function cleanDiagram(v: unknown): DiagramData | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<DiagramData>;
  if (typeof o.layout !== 'string' || typeof o.text !== 'string') return null;
  const num = (x: unknown, dflt: number) => (typeof x === 'number' && isFinite(x) && x > 0 ? x : dflt);
  return {
    layout: DIAGRAM_BY_ID.has(o.layout) ? o.layout : 'blocks',
    text: o.text,
    colours: DIAGRAM_COLOURS.some(([k]) => k === o.colours) ? o.colours! : 'accent',
    accent: typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : DIAGRAM_DEFAULTS.accent,
    rounded: o.rounded !== false,
    shadow: !!o.shadow,
    ...(typeof o.size === 'number' && isFinite(o.size) && o.size > 0 ? { size: o.size } : {}),
    w: num(o.w, 400), h: num(o.h, 300),
    ...cleanFigs(o.figs),
  };
}

/** Rooms kept for structures, read from a file: item lines with sensible sizes only. */
function cleanFigs(v: unknown): Pick<DiagramData, 'figs'> {
  if (!v || typeof v !== 'object') return {};
  const figs: Record<string, { w: number; h: number }> = {};
  for (const [k, f] of Object.entries(v as Record<string, unknown>)) {
    const x = f as { w?: unknown; h?: unknown } | null;
    if (!/^\d+$/.test(k) || !x || typeof x.w !== 'number' || typeof x.h !== 'number') continue;
    if (!(x.w > 0 && x.h > 0 && x.w < 1e5 && x.h < 1e5)) continue;
    figs[k] = { w: x.w, h: x.h };
  }
  return Object.keys(figs).length ? { figs } : {};
}

export { isIconId };
