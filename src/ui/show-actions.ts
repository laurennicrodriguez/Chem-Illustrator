// What clicks on things do in the slide show (the slide show and presenter view both use this):
// a link or an action button goes to its slide, to one of the show's jumps (next, previous,
// first, last, the last slide viewed, the end of the show) or opens a page or file outside the
// show; a zoom zooms into its slide, and comes back afterwards when it is set to; a click on a
// video or sound starts or pauses it.

import type { Deck } from '../deck/deck';
import type { Player } from '../deck/playback';
import type { Rect } from '../geom';
import { slideOfLink, SHOW_JUMPS } from '../links';

/** A zoom to come back from: the zoom's slide and box, and the last slide before coming back. */
interface Return { slide: number; rect: Rect; until: number }

export interface ShowActionHooks {
  /** Go to slide i (without its transition, as a link does). */
  go(i: number): void;
  /** The show's own next and back (the next animation or slide). */
  next(): void;
  prev(): void;
  /** End the show. */
  end(): void;
  /** Open something outside the show (a web page, a file, an e-mail). */
  open(link: string): void;
  /** A zoom in or out was played here (presenter view tells the audience's window). */
  zoomed?(i: number, rect: Rect, out: boolean): void;
  /** A video or sound was clicked (presenter view tells the audience's window), as fractions of the canvas. */
  tapped?(fx: number, fy: number): void;
}

export class ShowActions {
  private returns: Return[] = [];
  /** Slides shown, most recent last (for "Last slide viewed"). */
  private seen: number[] = [];

  constructor(private deck: Deck, private player: Player, private canvas: HTMLCanvasElement, private hooks: ShowActionHooks) {
    player.beforeNextSlide = () => this.comeBack();
  }

  /** Note the slide showing now (after each change of slide). */
  noteSlide(i: number): void {
    if (this.seen[this.seen.length - 1] !== i) this.seen.push(i);
    if (this.seen.length > 200) this.seen.shift();
  }

  /** Whether something there takes a click (for the pointer). */
  clickable(px: number, py: number): boolean {
    return !!this.player.actionAt(px, py) || this.player.mediaAt(px, py);
  }

  /** A click at a point on the canvas (CSS pixels): true when something there took it. */
  click(px: number, py: number): boolean {
    const a = this.player.actionAt(px, py);
    if (a) { this.follow(a.link, a.zoom ? { back: !!a.zoom.back, to: a.zoom.to, rect: a.rect } : undefined); return true; }
    if (this.player.clickMedia(px, py)) {
      const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
      this.hooks.tapped?.(px / w, py / h);
      return true;
    }
    return false;
  }

  /** Follow a link or action; with `zoom`, as a zoom from a box on the slide. */
  follow(link: string, zoom?: { back: boolean; to?: string; rect?: Rect }): void {
    const d = this.deck, cur = this.player.i;
    const id = slideOfLink(link);
    if (id !== null) {
      const i = d.slides.findIndex((s) => s.id === id);
      if (i < 0) return;
      if (zoom?.rect) {
        if (zoom.back) {
          const to = zoom.to ? slideOfLink(zoom.to) : null;
          const until = to !== null ? d.slides.findIndex((s) => s.id === to) : i;
          this.returns.push({ slide: cur, rect: zoom.rect, until: until >= i ? until : i });
        }
        this.player.zoom(i, zoom.rect);
        this.hooks.zoomed?.(i, zoom.rect, false);
      } else this.hooks.go(i);
      return;
    }
    if (link in SHOW_JUMPS) {
      if (link === '#next') this.hooks.next();
      else if (link === '#prev') this.hooks.prev();
      else if (link === '#first') this.hooks.go(d.firstShown());
      else if (link === '#last') this.hooks.go(Math.max(0, d.shownBefore(d.slides.length)));
      else if (link === '#end') this.hooks.end();
      else if (link === '#return') {
        // the slide before this one in the order they were shown
        const before = [...this.seen].reverse().find((i) => i !== cur);
        if (before !== undefined) this.hooks.go(before);
      }
      return;
    }
    if (!link.startsWith('#')) this.hooks.open(link);
  }

  /** Whether the next click comes back out of a zoom (the zoom's last slide has all played). */
  get returnDue(): boolean {
    const r = this.returns[this.returns.length - 1];
    return !!r && !this.player.busy && this.player.i >= r.until && this.player.done >= this.player.stepCount;
  }

  /** Going on from the last slide of a zoom that comes back: back out to the zoom's slide. */
  private comeBack(): boolean {
    const r = this.returns[this.returns.length - 1];
    if (!r || this.player.i < r.until) return false;
    this.returns.pop();
    this.player.zoom(r.slide, r.rect, true);
    this.hooks.zoomed?.(r.slide, r.rect, true);
    return true;
  }

  /** Forget zooms to come back from (the show jumped somewhere else by number, Home or End). */
  forgetReturns(): void { this.returns = []; }
}
