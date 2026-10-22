// Slides' drawing guides and grid (View > Guides, Gridlines, Grid and Guides): lines across the
// slide to line things up by, dragged where they are wanted, and a grid things moved can snap
// to. They are saved as PowerPoint keeps them, in the file's view settings (viewProps.xml): the
// guides in eighths of a point from the slide's top left, the grid's spacing in EMUs.

import type { SlideSize } from './deck';

export interface SlideView {
  /** The guides: where the up-and-down ones cross (x) and the across ones (y), in points from the slide's top left. */
  guides: { x: number[]; y: number[] };
  showGuides: boolean;
  /** Things moved snap to the grid; its spacing in points. */
  snapToGrid: boolean;
  grid: number;
}

/** PowerPoint's first guides: one down the middle and one across it. */
export function defaultView(size: SlideSize): SlideView {
  return { guides: { x: [size.w / 2], y: [size.h / 2] }, showGuides: false, snapToGrid: true, grid: 7.2 };
}

/** The grid spacings PowerPoint offers (in points): 1/12, 1/8, 1/6, 1/5, 1/4, 1/2 inch and 1 inch, and the metric ones. */
export const GRID_SPACINGS: { pt: number; name: string }[] = [
  { pt: 6, name: '1/12"' }, { pt: 9, name: '1/8"' }, { pt: 12, name: '1/6"' }, { pt: 14.4, name: '1/5"' }, { pt: 18, name: '1/4"' }, { pt: 36, name: '1/2"' }, { pt: 72, name: '1"' },
  { pt: 7.2, name: '0.1"' },
  { pt: 72 / 2.54 / 10, name: '1 mm' }, { pt: 72 / 2.54 / 5, name: '2 mm' }, { pt: 72 / 2.54 / 2, name: '5 mm' }, { pt: 72 / 2.54, name: '1 cm' },
];

/** The rulers' and guides' units and where they count from: the middle of the slide (as PowerPoint) or its top left. */
export interface RulerPrefs { units: 'in' | 'cm'; from: 'centre' | 'corner' }

/** A place along a ruler, written as the rulers count it (a guide's label as it is dragged). */
export function rulerText(v: number, size: SlideSize, axis: 'x' | 'y', prefs: RulerPrefs): string {
  const zero = prefs.from === 'centre' ? (axis === 'x' ? size.w : size.h) / 2 : 0;
  const pt = v - zero;
  const n = prefs.units === 'in' ? pt / 72 : (pt / 72) * 2.54;
  const shown = Math.abs(n) < 0.005 ? 0 : Math.abs(n);
  return `${shown.toFixed(2)}${prefs.units === 'in' ? '"' : ' cm'}`;
}

/** The step between the rulers' numbered marks, and how many smaller marks between them, at a zoom (screen pixels to a point). */
export function rulerSteps(prefs: RulerPrefs, zoom: number): { major: number; minor: number } {
  const unit = prefs.units === 'in' ? 72 : 72 / 2.54;
  // numbers at least 40 px apart
  let major = unit;
  while (major * zoom < 40) major *= 2;
  while (major * zoom > 160 && major > unit / 8) major /= 2;
  const minor = prefs.units === 'in' ? 8 : 10;
  return { major, minor: major * zoom / minor >= 4 ? minor : major * zoom / 4 >= 4 ? 4 : 2 };
}

/**
 * Where a moved box lands with the grid and guides: its top left on the grid (when snapping
 * to it), else an edge or its middle on a guide within `tol`. `raw` is how far it has been
 * dragged; returns how far it goes.
 */
export function snapMove(box: { x1: number; y1: number; x2: number; y2: number }, raw: { x: number; y: number }, view: SlideView | null, tol: number): { x: number; y: number } {
  if (!view) return raw;
  const one = (lo: number, hi: number, d: number, guides: number[]) => {
    if (view.showGuides) {
      let best: number | null = null;
      for (const g of guides) for (const at of [lo, (lo + hi) / 2, hi]) {
        const off = g - (at + d);
        if (Math.abs(off) <= tol && (best === null || Math.abs(off) < Math.abs(best))) best = off;
      }
      if (best !== null) return d + best;
    }
    if (view.snapToGrid && view.grid > 0) return Math.round((lo + d) / view.grid) * view.grid - lo;
    return d;
  };
  return { x: one(box.x1, box.x2, raw.x, view.guides.x), y: one(box.y1, box.y2, raw.y, view.guides.y) };
}

/** The guide (if any) within `tol` of a point on the slide: which way it runs and which it is. */
export function guideNear(view: SlideView, p: { x: number; y: number }, tol: number): { axis: 'x' | 'y'; i: number } | null {
  let best: { axis: 'x' | 'y'; i: number; d: number } | null = null;
  view.guides.x.forEach((x, i) => { const d = Math.abs(p.x - x); if (d <= tol && (!best || d < best.d)) best = { axis: 'x', i, d }; });
  view.guides.y.forEach((y, i) => { const d = Math.abs(p.y - y); if (d <= tol && (!best || d < best.d)) best = { axis: 'y', i, d }; });
  return best ? { axis: (best as { axis: 'x' | 'y' }).axis, i: (best as { i: number }).i } : null;
}

const EMU = 12700;

/** The view settings part (ppt/viewProps.xml): Normal view's guides, snapping and grid. */
export function viewPropsXml(view: SlideView | undefined, ns: string): string {
  const v = view;
  const guides = v ? [...v.guides.y.map((y) => `<p:guide orient="horz" pos="${Math.round(y * 8)}"/>`), ...v.guides.x.map((x) => `<p:guide pos="${Math.round(x * 8)}"/>`)].join('') : '';
  return `<p:viewPr ${ns}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>` +
    `<p:slideViewPr><p:cSldViewPr snapToGrid="${v && !v.snapToGrid ? 0 : 1}"${v?.showGuides ? ' showGuides="1"' : ''}><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr>` +
    `${guides ? `<p:guideLst>${guides}</p:guideLst>` : '<p:guideLst/>'}</p:cSldViewPr></p:slideViewPr>` +
    `<p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="1" d="1"/><a:sy n="1" d="1"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr>` +
    `<p:gridSpacing cx="${Math.round((v?.grid ?? 7.2) * EMU)}" cy="${Math.round((v?.grid ?? 7.2) * EMU)}"/></p:viewPr>`;
}

/** The guides, snapping and grid from a file's view settings (null when it has none). */
export function readViewProps(root: Element | null | undefined): SlideView | null {
  if (!root) return null;
  const find = (el: Element | null | undefined, name: string): Element | null => {
    if (!el) return null;
    for (const c of Array.from(el.children)) if (c.localName === name) return c;
    return null;
  };
  const csld = find(find(root, 'slideViewPr'), 'cSldViewPr');
  const grid = find(root, 'gridSpacing');
  if (!csld && !grid) return null;
  const view: SlideView = { guides: { x: [], y: [] }, showGuides: csld?.getAttribute('showGuides') === '1', snapToGrid: csld?.getAttribute('snapToGrid') !== '0', grid: 7.2 };
  for (const g of Array.from(find(csld, 'guideLst')?.children ?? [])) {
    const pos = Number(g.getAttribute('pos') ?? 0) / 8;
    if (g.getAttribute('orient') === 'horz') view.guides.y.push(pos); else view.guides.x.push(pos);
  }
  const cx = Number(grid?.getAttribute('cx') ?? 0);
  if (cx > 0) view.grid = +(cx / EMU).toFixed(4);
  return view;
}
