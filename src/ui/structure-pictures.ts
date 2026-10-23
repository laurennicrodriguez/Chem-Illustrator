// Pictures of the structures in cells. Each structure is recorded once (its shapes and size);
// bitmaps are made at the sizes the grid shows them, a little larger than needed so zooming a
// step doesn't make them again, and the least recently used are let go.

import type { Doc } from '../model';
import type { DocStyle } from '../style';
import type { Structure } from '../sheet/workbook';
import { structureDoc } from '../sheet/structure-doc';
import { recordPicture, pictureCanvas, Picture } from '../render/picture';

/** Bitmaps kept at most. */
const KEEP = 400;
/** Sizes are rounded up to steps of this ratio. */
const STEP = 1.25;

export class StructurePictures {
  private recorded = new Map<number, { doc: Doc; pic: Picture | null }>();
  private bitmaps = new Map<string, HTMLCanvasElement>();

  constructor(private style: () => DocStyle) {}

  /** The style the pictures were made in: when it changes (a new style, or one undone), they are made again. */
  private madeIn: DocStyle | null = null;

  private fresh(): void {
    if (this.madeIn === this.style()) return;
    this.clear();
    this.madeIn = this.style();
  }

  private record(s: Structure): { doc: Doc; pic: Picture | null } {
    this.fresh();
    let r = this.recorded.get(s.id);
    if (!r) {
      const doc = structureDoc(s.contents, this.style());
      r = { doc, pic: recordPicture(doc, 1.5) };
      this.recorded.set(s.id, r);
      if (this.recorded.size > KEEP * 4) this.recorded.delete(this.recorded.keys().next().value as number);
    }
    return r;
  }

  /** The picture's size in points. */
  box(s: Structure): { w: number; h: number } {
    const p = this.record(s).pic;
    return p ? { w: p.box.x2 - p.box.x1, h: p.box.y2 - p.box.y1 } : { w: 1, h: 1 };
  }

  /** The picture as a bitmap at `scale` pixels per point (or a little more). Null when it isn't made yet, unless `make`. */
  bitmap(s: Structure, scale: number, make: boolean): HTMLCanvasElement | null {
    this.fresh();
    const step = Math.pow(STEP, Math.ceil(Math.log(Math.max(0.05, scale)) / Math.log(STEP)));
    const key = `${s.id}@${step.toFixed(3)}`;
    const got = this.bitmaps.get(key);
    if (got) {
      // used again: to the end of the queue
      this.bitmaps.delete(key);
      this.bitmaps.set(key, got);
      return got;
    }
    if (!make) return null;
    const r = this.record(s);
    if (!r.pic) return null;
    const { canvas } = pictureCanvas(r.doc, r.pic, step * 72);
    this.bitmaps.set(key, canvas);
    if (this.bitmaps.size > KEEP) this.bitmaps.delete(this.bitmaps.keys().next().value as string);
    return canvas;
  }

  /** Forget everything (the drawing style changed). */
  clear(): void {
    this.recorded.clear();
    this.bitmaps.clear();
  }
}
