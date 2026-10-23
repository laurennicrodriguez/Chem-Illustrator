// Slide Zoom and Summary Zoom (Insert > Zoom), as in PowerPoint: a picture of another slide that,
// clicked in the slide show, zooms into that slide; with Return to Zoom the show comes back to the
// zoom's slide afterwards. A Summary Zoom is a new slide of zooms, one for each part of the
// deck (a part runs from its first slide to the slide before the next part), each coming back.
// A zoom is a picture with `link` (the slide) and `zoom` (see Shape.zoom).

import type { Doc, Shape } from '../model';
import type { Rect } from '../geom';
import type { Deck, SlideSize } from './deck';
import { paintSlide } from './slide-view';
import { slideOfLink } from '../links';

/** Where `n` zoom pictures go in an area: a grid of slide-shaped boxes, a gap between them, centred. */
export function zoomGrid(n: number, size: SlideSize, area: Rect, gap = 16): Rect[] {
  if (n <= 0) return [];
  const aw = area.x2 - area.x1, ah = area.y2 - area.y1, ratio = size.h / size.w;
  let best = { cols: 1, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((aw - gap * (cols - 1)) / cols, (ah - gap * (rows - 1)) / rows / ratio);
    if (w > best.w) best = { cols, w };
  }
  // not bigger than a third of the slide, as PowerPoint puts them
  const w = Math.min(best.w, size.w / 3), h = w * ratio, cols = best.cols, rows = Math.ceil(n / cols);
  const totalH = rows * h + (rows - 1) * gap;
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * w + (inRow - 1) * gap;
    const x0 = area.x1 + (aw - rowW) / 2, y = area.y1 + (ah - totalH) / 2 + r * (h + gap);
    for (let c = 0; c < inRow; c++) out.push({ x1: x0 + c * (w + gap), y1: y, x2: x0 + c * (w + gap) + w, y2: y + h });
  }
  return out;
}

/** The parts of a Summary Zoom: each starts at one of the slides picked and runs to the slide before the next (by place in the deck). */
export function summaryParts(starts: number[], count: number): { first: number; last: number }[] {
  const s = [...new Set(starts)].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
  return s.map((first, k) => ({ first, last: (k + 1 < s.length ? s[k + 1] : count) - 1 }));
}

/** A picture of slide i for a zoom (a PNG, `w` pixels wide). */
export function zoomPicture(deck: Deck, i: number, w = 480): { src: string; px: { w: number; h: number } } | null {
  const h = Math.round((w * deck.size.h) / deck.size.w);
  const c = document.createElement('canvas');
  try {
    paintSlide(c, w, h, 1, deck.page(i), deck.docOf(i));
    return { src: c.toDataURL('image/png'), px: { w, h } };
  } catch {
    return null;
  }
}

/** A zoom picture for slide i, in a box. */
export function zoomShape(deck: Deck, i: number, box: Rect, zoom: Shape['zoom']): Omit<Shape, 'id'> | null {
  const pic = zoomPicture(deck, i);
  if (!pic) return null;
  return { kind: 'picture', ...box, src: pic.src, px: pic.px, link: `#slide=${deck.slides[i].id}`, zoom: { ...zoom }, look: { line: 0.5, lineColor: '#bfbfbf' } };
}

/** The zooms on a drawing (pictures that zoom to a slide). */
export function zoomsOn(doc: Doc): Shape[] {
  return [...doc.shapes.values()].filter((s) => s.kind === 'picture' && s.zoom && s.link && slideOfLink(s.link) !== null);
}

/**
 * Bring every zoom's picture up to date with the slide it shows (before a show, and on going to
 * a slide with zooms). Not a change to undo: the zoom is the same, only its picture is fresh.
 */
export function refreshZooms(deck: Deck, only?: number): void {
  const pics = new Map<number, ReturnType<typeof zoomPicture>>();
  for (let i = 0; i < deck.slides.length; i++) {
    if (only !== undefined && i !== only) continue;
    const doc = deck.docOf(i);
    const zs = zoomsOn(doc);
    if (!zs.length) continue;
    doc.bulk(() => {
      for (const z of zs) {
        const id = slideOfLink(z.link!)!;
        const j = deck.slides.findIndex((s) => s.id === id);
        if (j < 0 || j === i) continue;
        if (!pics.has(j)) pics.set(j, zoomPicture(deck, j));
        const p = pics.get(j);
        if (p && p.src !== z.src) doc.updateShape(z.id, { src: p.src, px: p.px });
      }
    });
  }
}
