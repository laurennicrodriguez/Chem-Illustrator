// Ready-made designs to start from (File > New Design): a TOC graphic, a graphical abstract, a
// poster, a flowchart, a workup scheme and a timeline. Each is ordinary shapes, text and
// connectors on a page of the right size, so everything in it can be moved, retyped, recoloured
// or deleted; the dashed boxes mark where structures or pictures go.

import type { Doc, Shape, TextRun, Arrow } from '../model';
import { DESIGN_SIZES, type SlideSize } from '../deck/deck';
import { gluePoint } from '../objects';

/** A shape in a template: where it goes on the page (points) and what it says. */
interface Box {
  geo: string;
  x: number; y: number; w: number; h: number;
  /** Paragraphs are separated by \n; the first can be set bold. */
  text?: string;
  size?: number;
  bold?: boolean;
  /** Text colour. */
  ink?: string;
  fill?: string | null;
  line?: string | null;
  dashed?: boolean;
  align?: Shape['textAlign'];
  valign?: Shape['textValign'];
  name?: string;
}

/** A connector from one box's side to another's (sides: 0 top, 1 right, 2 bottom, 3 left). */
interface Link { from: number; fp: number; to: number; tp: number; elbow?: boolean }

export interface DesignTemplate {
  id: string;
  name: string;
  /** What it is for, in a line. */
  blurb: string;
  /** The page size it is laid out for (DESIGN_SIZES id). */
  sizeId: string;
  boxes: Box[];
  links: Link[];
  /** Plain arrows, not stuck to anything: [x1, y1, x2, y2] from tail to head. */
  arrows?: [number, number, number, number][];
}

const BLUE = { fill: '#dae3f3', line: '#2f5597' };
const DARK = '#2f5597';
const GREY = '#7f7f7f';

/** A dashed box marking where a structure or picture goes. */
const spot = (x: number, y: number, w: number, h: number, text: string, size: number): Box =>
  ({ geo: 'rect', x, y, w, h, text, size, ink: GREY, fill: null, line: GREY, dashed: true, name: `Placeholder: ${text}` });
/** Text with no box around it. */
const words = (x: number, y: number, w: number, h: number, text: string, size: number, more: Partial<Box> = {}): Box =>
  ({ geo: 'rect', x, y, w, h, text, size, fill: null, line: null, ...more });

function poster(): Box[] {
  const W = 3456, M = 72, gap = 72, col = (W - 2 * M - 2 * gap) / 3;
  const x = (i: number) => M + i * (col + gap);
  const head = (i: number, y: number, t: string): Box => ({ geo: 'roundRect', x: x(i), y, w: col, h: 110, text: t, size: 60, bold: true, ink: '#ffffff', fill: DARK, line: null });
  const body = (i: number, y: number, h: number, t: string): Box =>
    ({ geo: 'rect', x: x(i), y, w: col, h, text: t, size: 36, fill: '#f2f2f2', line: null, align: 'left', valign: 'top' });
  return [
    { geo: 'rect', x: 0, y: 0, w: W, h: 380, text: 'Poster title: what you found, in one line\nAuthor One, Author Two, Author Three\nDepartment of Chemistry, University', size: 96, bold: true, ink: '#ffffff', fill: DARK, line: null, name: 'Title banner' },
    spot(M, 60, 260, 260, 'Logo', 36), spot(W - M - 260, 60, 260, 260, 'Logo', 36),
    head(0, 452, 'Introduction'), body(0, 590, 900, 'Why this matters, and what was known before.'),
    head(0, 1562, 'Approach'), body(0, 1700, 820, 'The plan, with the key reaction or scheme.'),
    head(1, 452, 'Results'), body(1, 590, 1930, 'Schemes, tables and figures. Drag structures in from a drawing tab or paste them here.'),
    head(2, 452, 'Conclusions'), body(2, 590, 820, '• First conclusion\n• Second conclusion\n• What comes next'),
    head(2, 1482, 'References'), body(2, 1620, 520, '1. Reference one.\n2. Reference two.'),
    head(2, 2212, 'Acknowledgements'), body(2, 2350, 170, 'Funding and thanks.'),
  ];
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'toc', name: 'TOC graphic', blurb: 'Starting material, arrow, product and a one-line message (ACS size).', sizeId: 'toc-acs',
    boxes: [
      spot(8, 14, 88, 72, 'Starting material', 8),
      words(98, 34, 36, 18, 'conditions', 7),
      spot(138, 14, 88, 72, 'Product', 8),
      { geo: 'roundRect', x: 8, y: 96, w: 218, h: 22, text: 'One line on what is new', size: 9, bold: true, ...BLUE },
    ],
    links: [{ from: 0, fp: 1, to: 2, tp: 3 }],
  },
  {
    id: 'abstract', name: 'Graphical abstract', blurb: 'Three panels: the challenge, your approach and the outcome (Elsevier size).', sizeId: 'ga-elsevier',
    boxes: [
      { geo: 'homePlate', x: 8, y: 8, w: 116, h: 26, text: 'Challenge', size: 10, bold: true, ...BLUE },
      { geo: 'chevron', x: 126, y: 8, w: 118, h: 26, text: 'Approach', size: 10, bold: true, ...BLUE },
      { geo: 'chevron', x: 246, y: 8, w: 116, h: 26, text: 'Outcome', size: 10, bold: true, fill: '#e2f0d9', line: '#548235' },
      spot(8, 42, 112, 92, 'Structure or picture', 8),
      spot(128, 42, 112, 92, 'Key reaction', 8),
      spot(248, 42, 112, 92, 'Product or result', 8),
    ],
    links: [],
  },
  { id: 'poster', name: 'Conference poster', blurb: 'Title banner with logos and three columns of sections (48 × 36 in).', sizeId: 'poster-48x36', boxes: poster(), links: [] },
  {
    id: 'flowchart', name: 'Flowchart', blurb: 'A reaction run as steps with a decision and a loop back, joined by connectors.', sizeId: 'letter',
    boxes: [
      { geo: 'fcTerminator', x: 226, y: 48, w: 160, h: 44, text: 'Start', size: 12, ...BLUE },
      { geo: 'fcProcess', x: 216, y: 132, w: 180, h: 60, text: 'Set up the reaction', size: 12, ...BLUE },
      { geo: 'fcDecision', x: 206, y: 232, w: 200, h: 100, text: 'Complete by TLC?', size: 12, fill: '#fff2cc', line: '#bf9000' },
      { geo: 'fcProcess', x: 216, y: 382, w: 180, h: 60, text: 'Work up', size: 12, ...BLUE },
      { geo: 'fcProcess', x: 216, y: 482, w: 180, h: 60, text: 'Purify', size: 12, ...BLUE },
      { geo: 'fcTerminator', x: 226, y: 582, w: 160, h: 44, text: 'Characterise', size: 12, ...BLUE },
      { geo: 'fcProcess', x: 446, y: 252, w: 130, h: 60, text: 'Stir longer or add more reagent', size: 11, ...BLUE },
      words(410, 256, 36, 18, 'No', 11, { bold: true }),
      words(312, 340, 36, 18, 'Yes', 11, { bold: true }),
    ],
    links: [
      { from: 0, fp: 2, to: 1, tp: 0 }, { from: 1, fp: 2, to: 2, tp: 0 }, { from: 2, fp: 2, to: 3, tp: 0 },
      { from: 3, fp: 2, to: 4, tp: 0 }, { from: 4, fp: 2, to: 5, tp: 0 },
      { from: 2, fp: 1, to: 6, tp: 3 }, { from: 6, fp: 0, to: 1, tp: 1, elbow: true },
    ],
  },
  {
    id: 'workup', name: 'Workup scheme', blurb: 'Glassware from reaction to pure product, with a label under each step.', sizeId: 'letter-wide',
    boxes: [
      { geo: 'labRbf', x: 40, y: 220, w: 81, h: 108, line: '#000000', fill: null },
      { geo: 'labSepFunnel', x: 170, y: 184, w: 66, h: 144, line: '#000000', fill: null },
      { geo: 'labErlenmeyer', x: 285, y: 220, w: 81, h: 108, line: '#000000', fill: null },
      { geo: 'labRbf', x: 415, y: 220, w: 81, h: 108, line: '#000000', fill: null },
      { geo: 'labColumn', x: 562, y: 166, w: 45, h: 162, line: '#000000', fill: null },
      { geo: 'labVial', x: 680, y: 232, w: 45, h: 96, line: '#000000', fill: null },
      words(20, 340, 121, 40, 'Reaction', 11),
      words(143, 340, 120, 40, 'Quench and extract', 11),
      words(265, 340, 121, 40, 'Dry over Na2SO4 and filter', 11),
      words(395, 340, 121, 40, 'Concentrate', 11),
      words(524, 340, 121, 40, 'Column', 11),
      words(642, 340, 121, 40, 'Pure product', 11),
      words(40, 60, 712, 36, 'Workup and purification', 20, { bold: true }),
    ],
    links: [],
    // level arrows between the glassware (glued ones would slope, the glassware being of different heights)
    arrows: [[129, 290, 162, 290], [244, 290, 277, 290], [374, 290, 407, 290], [504, 290, 554, 290], [615, 290, 672, 290]],
  },
  {
    id: 'timeline', name: 'Timeline', blurb: 'A project from route scouting to submission, as five milestones on a line.', sizeId: 'slide-wide',
    boxes: [
      words(60, 40, 840, 50, 'Project timeline', 32, { bold: true }),
      { geo: 'rect', x: 60, y: 287, w: 840, h: 6, fill: GREY, line: null, name: 'Time line' },
      ...[0, 1, 2, 3, 4].flatMap((i): Box[] => {
        const cx = 120 + i * 180;
        const up = i % 2 === 0;
        const label = ['Route scouting', 'Key step optimised', 'Scale-up', 'Analogue scope', 'Paper submitted'][i];
        return [
          { geo: 'ellipse', x: cx - 16, y: 274, w: 32, h: 32, ...BLUE, name: `Milestone ${i + 1}` },
          words(cx - 80, up ? 170 : 326, 160, 84, `Month ${i * 3 + 1}\n${label}`, 16, { valign: up ? 'bottom' : 'top' }),
        ];
      }),
    ],
    links: [],
  },
];

export function templateSize(t: DesignTemplate): SlideSize {
  return DESIGN_SIZES.find((s) => s.id === t.sizeId)!.size;
}

/** Put a template's shapes and connectors on an empty design page. */
export function fillTemplate(doc: Doc, t: DesignTemplate): void {
  const ids: number[] = [];
  t.boxes.forEach((b, i) => {
    const text = b.text ? { runs: runs(b) } : undefined;
    const s: Omit<Shape, 'id'> = {
      kind: 'geo', geo: b.geo, x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h,
      filled: !!b.fill, ...(b.fill ? { fillColor: b.fill } : {}),
      color: b.line ?? '#000000', ...(b.line === null ? { lineWidth: 0 } : {}),
      ...(b.dashed ? { dashed: true } : {}), ...(text ? { text } : {}),
      ...(b.align ? { textAlign: b.align } : {}), ...(b.valign ? { textValign: b.valign } : {}),
      ...(b.name ? { name: b.name } : {}), z: i + 1,
    };
    ids.push(doc.addShape(s).id);
  });
  const lw = doc.style.lineWidth;
  for (const l of t.links) {
    const a = doc.shapes.get(ids[l.from])!, b = doc.shapes.get(ids[l.to])!;
    const arrow: Omit<Arrow, 'id'> = {
      tail: gluePoint(a, l.fp), head: gluePoint(b, l.tp), headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
      noGo: false, equilibrium: false, sweep: 0, headLength: lw * 10, headWidth: lw * 2.5,
      from: { shape: a.id, port: l.fp }, to: { shape: b.id, port: l.tp }, ...(l.elbow ? { elbow: true } : {}),
    };
    doc.addArrow(arrow);
  }
  for (const [x1, y1, x2, y2] of t.arrows ?? []) {
    doc.addArrow({ tail: { x: x1, y: y1 }, head: { x: x2, y: y2 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: lw * 10, headWidth: lw * 2.5 });
  }
}

function runs(b: Box): TextRun[] {
  const paras = b.text!.split('\n');
  const ink = b.ink ? { color: b.ink } : {};
  // bold text over several lines (a poster title) is a bold heading with smaller lines under it
  const sub = b.bold && paras.length > 1;
  return paras.flatMap((p, i): TextRun[] => {
    const size = sub && i > 0 ? Math.round((b.size ?? 12) * 0.55) : b.size;
    const run: TextRun = { text: p, ...(size ? { size } : {}), ...(b.bold && i === 0 ? { bold: true } : {}), ...ink };
    return i ? [{ text: '\n', ...(size ? { size } : {}) }, run] : [run];
  });
}
