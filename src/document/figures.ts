// Pictures of the drawings in a document (structures, schemes, tables). Each drawing is
// recorded once, for its size and for the pictures Word and the PDF get; bitmaps for the
// screen are made at the sizes shown, a little larger than needed so zooming a step doesn't
// make them again, and the least recently used are let go.

import type { Contents, Doc } from '../model';
import type { DocStyle } from '../style';
import { structureDoc } from '../sheet/structure-doc';
import { recordPicture, pictureCanvas, type Picture } from '../render/picture';

/** Space round a drawing's picture, in points (as for structures in sheet cells). */
export const FIGURE_MARGIN = 1.5;
const KEEP = 120;
const STEP = 1.25;

export interface Recorded { doc: Doc; pic: Picture | null }

export class FigurePictures {
  private recorded = new WeakMap<Contents, { style: DocStyle; r: Recorded }>();
  private bitmaps = new Map<string, HTMLCanvasElement>();
  private ids = new WeakMap<Contents, number>();
  private nextId = 1;

  /** The drawing as a document, and its recording (made once for each drawing and style). */
  record(contents: Contents, style: DocStyle): Recorded {
    const got = this.recorded.get(contents);
    if (got && got.style === style) return got.r;
    const doc = structureDoc(contents, style);
    const r = { doc, pic: recordPicture(doc, FIGURE_MARGIN) };
    this.recorded.set(contents, { style, r });
    return r;
  }

  /** The drawing's own size in points. */
  size(contents: Contents, style: DocStyle): { w: number; h: number } {
    const p = this.record(contents, style).pic;
    return p ? { w: p.box.x2 - p.box.x1, h: p.box.y2 - p.box.y1 } : { w: 24, h: 24 };
  }

  /** A bitmap of the drawing at `scale` pixels per point (or a little more); null when not made yet, unless `make`. */
  bitmap(contents: Contents, style: DocStyle, scale: number, make: boolean): HTMLCanvasElement | null {
    let id = this.ids.get(contents);
    if (!id) { id = this.nextId++; this.ids.set(contents, id); }
    const step = Math.pow(STEP, Math.ceil(Math.log(Math.max(0.05, scale)) / Math.log(STEP)));
    const key = `${id}@${step.toFixed(3)}`;
    const got = this.bitmaps.get(key);
    if (got) {
      this.bitmaps.delete(key);
      this.bitmaps.set(key, got);
      return got;
    }
    if (!make) return null;
    const r = this.record(contents, style);
    if (!r.pic) return null;
    const { canvas } = pictureCanvas(r.doc, r.pic, step * 72);
    this.bitmaps.set(key, canvas);
    if (this.bitmaps.size > KEEP) this.bitmaps.delete(this.bitmaps.keys().next().value as string);
    return canvas;
  }
}
