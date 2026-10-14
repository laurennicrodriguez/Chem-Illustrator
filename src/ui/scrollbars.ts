// Scroll bars along the bottom and right of the drawing, so the endless drawing area has a sense
// of where you are: the bars cover everything drawn (with room around it) and the part on
// screen. Drag a thumb to move across, click the track to move a screenful, or use the wheel as
// before. They sit over the drawing's edges and can be switched off (View > Scroll Bars).

import type { Rect } from '../geom';

export interface ScrollView {
  view: { ox: number; oy: number; scale: number };
  width: number;
  height: number;
}

/** The thumb's start and length along a track `track` px long, for a range and the part on screen (both in points). */
export function thumbFor(range: [number, number], seen: [number, number], track: number, min = 24): { start: number; size: number } {
  const span = Math.max(1e-6, range[1] - range[0]);
  const size = Math.min(track, Math.max(min, ((seen[1] - seen[0]) / span) * track));
  const room = track - size;
  const along = span - (seen[1] - seen[0]);
  const start = along > 1e-6 ? ((seen[0] - range[0]) / along) * room : 0;
  return { start: Math.max(0, Math.min(room, start)), size };
}

/** What the bars cover: the drawing (with half a screen of room round it) and the part on screen. */
export function scrollRange(content: Rect | null, seen: Rect): Rect {
  const w = seen.x2 - seen.x1, h = seen.y2 - seen.y1;
  // with nothing drawn, a screen either way, so there is somewhere to go
  const c = content
    ? { x1: content.x1 - w / 2, y1: content.y1 - h / 2, x2: content.x2 + w / 2, y2: content.y2 + h / 2 }
    : { x1: seen.x1 - w, y1: seen.y1 - h, x2: seen.x2 + w, y2: seen.y2 + h };
  return { x1: Math.min(c.x1, seen.x1), y1: Math.min(c.y1, seen.y1), x2: Math.max(c.x2, seen.x2), y2: Math.max(c.y2, seen.y2) };
}

export class Scrollbars {
  private h: HTMLDivElement;
  private v: HTMLDivElement;
  private hThumb: HTMLDivElement;
  private vThumb: HTMLDivElement;
  private key = '';
  /** Kept still while a thumb is dragged, so the thumb stays under the pointer. */
  private frozen: Rect | null = null;
  private range: Rect = { x1: 0, y1: 0, x2: 1, y2: 1 };
  shown = true;

  constructor(host: HTMLElement, private r: ScrollView, private content: () => Rect | null, private moved: () => void) {
    const make = (axis: 'h' | 'v') => {
      const bar = document.createElement('div');
      bar.className = `scrollbar scrollbar-${axis}`;
      bar.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('div');
      thumb.className = 'scroll-thumb';
      bar.append(thumb);
      host.append(bar);
      return [bar, thumb] as const;
    };
    [this.h, this.hThumb] = make('h');
    [this.v, this.vThumb] = make('v');
    this.drag(this.hThumb, 'h');
    this.drag(this.vThumb, 'v');
    this.page(this.h, 'h');
    this.page(this.v, 'v');
  }

  /** Called every frame: redraws the bars when the view, the window or the drawing changed. */
  update(version: number): void {
    const { ox, oy, scale } = this.r.view;
    const key = `${ox}|${oy}|${scale}|${this.r.width}|${this.r.height}|${version}|${this.shown}`;
    if (key === this.key) return;
    this.key = key;
    this.h.hidden = this.v.hidden = !this.shown;
    if (!this.shown || !this.r.width || !this.r.height) return;
    const seen = this.seen();
    const range = this.frozen ?? scrollRange(this.content(), seen);
    this.range = range;
    const ht = thumbFor([range.x1, range.x2], [seen.x1, seen.x2], this.h.clientWidth);
    const vt = thumbFor([range.y1, range.y2], [seen.y1, seen.y2], this.v.clientHeight);
    this.hThumb.style.transform = `translateX(${ht.start}px)`;
    this.hThumb.style.width = `${ht.size}px`;
    this.vThumb.style.transform = `translateY(${vt.start}px)`;
    this.vThumb.style.height = `${vt.size}px`;
  }

  private seen(): Rect {
    const { ox, oy, scale } = this.r.view;
    return { x1: -ox / scale, y1: -oy / scale, x2: (this.r.width - ox) / scale, y2: (this.r.height - oy) / scale };
  }

  private drag(thumb: HTMLElement, axis: 'h' | 'v'): void {
    thumb.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      thumb.setPointerCapture(e.pointerId);
      this.frozen = this.range;
      thumb.classList.add('dragging');
      let last = axis === 'h' ? e.clientX : e.clientY;
      const move = (ev: PointerEvent) => {
        const now = axis === 'h' ? ev.clientX : ev.clientY;
        const bar = axis === 'h' ? this.h : this.v;
        const track = axis === 'h' ? bar.clientWidth : bar.clientHeight;
        const thumbLen = axis === 'h' ? thumb.offsetWidth : thumb.offsetHeight;
        const seen = this.seen();
        const span = axis === 'h' ? this.range.x2 - this.range.x1 - (seen.x2 - seen.x1) : this.range.y2 - this.range.y1 - (seen.y2 - seen.y1);
        const room = Math.max(1, track - thumbLen);
        // points of drawing per pixel of thumb travel
        const k = Math.max(0, span) / room;
        this.scrollBy(axis, (now - last) * k);
        last = now;
      };
      const up = () => {
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        thumb.classList.remove('dragging');
        this.frozen = null;
        this.key = '';
        this.moved();
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });
  }

  /** A click on the track moves most of a screenful toward the click. */
  private page(bar: HTMLElement, axis: 'h' | 'v'): void {
    bar.addEventListener('pointerdown', (e) => {
      if (e.target !== bar || e.button !== 0) return;
      e.preventDefault();
      const thumb = axis === 'h' ? this.hThumb : this.vThumb;
      const t = thumb.getBoundingClientRect();
      const before = axis === 'h' ? e.clientX < t.left : e.clientY < t.top;
      const seen = this.seen();
      const screen = axis === 'h' ? seen.x2 - seen.x1 : seen.y2 - seen.y1;
      this.scrollBy(axis, (before ? -1 : 1) * 0.9 * screen);
    });
  }

  /** Move what is on screen by `d` points along an axis. */
  private scrollBy(axis: 'h' | 'v', d: number): void {
    if (!d) return;
    if (axis === 'h') this.r.view.ox -= d * this.r.view.scale;
    else this.r.view.oy -= d * this.r.view.scale;
    this.moved();
  }
}
