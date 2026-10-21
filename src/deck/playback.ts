// Playing slides as in a slide show: transitions between slides, and the animations of each
// slide's objects, click by click. The slide show (F5) and the previews in the Transitions and
// Animations tabs both use this.
//
// Each slide is painted once: its page with everything that doesn't move, and each part that has
// an animation on a layer of its own. A frame of the show is then those pictures put together
// (faded, wiped or moved as the animations say), so even big slides play smoothly.

import { Doc } from '../model';
import type { Deck } from './deck';
import { paintSlide, type SlidePage } from './slide-view';
import { selectionBox, POINTS } from '../editor/arrange';
import type { Rect } from '../geom';
import { buildSteps, partStates, slideParts, partOf, type Anim, type Part, type Step, type Transition, type Side } from './animation';

const ease = (p: number) => 1 - (1 - p) ** 3;

/** A copy of the slide's drawing with only some of its objects (kept with their ids). */
function subDoc(doc: Doc, keep: (kind: 'atom' | 'caption' | 'arrow' | 'shape', id: number) => boolean): Doc {
  const c = doc.contents();
  const d = new Doc();
  d.style = doc.style;
  d.background = doc.background;
  d.textStyles = doc.textStyles;
  const atoms = c.atoms.filter((a) => keep('atom', a.id));
  const ids = new Set(atoms.map((a) => a.id));
  d.restoreContents({
    atoms, bonds: c.bonds.filter((b) => ids.has(b.a1) && ids.has(b.a2)),
    captions: c.captions.filter((x) => keep('caption', x.id)), arrows: c.arrows.filter((x) => keep('arrow', x.id)), shapes: c.shapes.filter((x) => keep('shape', x.id)),
  });
  return d;
}

const inPart = (part: Part, kind: 'atom' | 'caption' | 'arrow' | 'shape', id: number) =>
  (kind === 'atom' ? part.sel.atoms : kind === 'caption' ? part.sel.captions : kind === 'arrow' ? part.sel.arrows : part.sel.shapes).has(id);

/** One slide, painted ready to play at one size. */
export class SlideFrames {
  readonly steps: Step[];
  private base = document.createElement('canvas');
  private layers: { part: Part; canvas: HTMLCanvasElement; box: Rect }[] = [];
  private parts: Part[] = [];
  /** Where the slide sits on the canvas: its corner and scale (CSS pixels per point). */
  private at = { x: 0, y: 0, k: 1 };

  constructor(private page: SlidePage, private doc: Doc, private anims: Anim[], w: number, h: number, private dpr: number, fill: string | null) {
    const live = anims.length ? (() => {
      this.parts = slideParts(doc);
      return anims.filter((a) => partOf(this.parts, a.target));
    })() : [];
    this.anims = live;
    this.steps = buildSteps(live);
    const moving = [...new Set(live.map((a) => partOf(this.parts, a.target)!))];
    const still = moving.length ? subDoc(doc, (kind, id) => !moving.some((p) => inPart(p, kind, id))) : doc;
    this.at = paintSlide(this.base, w, h, dpr, page, still, fill);
    for (const part of this.parts.filter((p) => moving.includes(p))) {
      const canvas = document.createElement('canvas');
      const one = subDoc(doc, (kind, id) => inPart(part, kind, id));
      paintSlide(canvas, w, h, dpr, page, one, null, false);
      const b = selectionBox(doc, part.sel, POINTS) ?? { x1: 0, y1: 0, x2: page.size.w, y2: page.size.h };
      const pad = 8; // room for frames, shadows and arrowheads
      this.layers.push({ part, canvas, box: { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad } });
    }
  }

  /** Videos on the slide, showing with `done` steps played: where they go, in CSS pixels on the canvas. */
  videoSpots(done: number): { id: number; src: string; once: boolean; x: number; y: number; w: number; h: number }[] {
    const states = this.layers.length ? partStates(this.parts, this.anims, done, -1) : null;
    const { x, y, k } = this.at;
    const out: { id: number; src: string; once: boolean; x: number; y: number; w: number; h: number }[] = [];
    for (const sh of this.doc.shapes.values()) {
      if (sh.kind !== 'picture' || !sh.video) continue;
      const L = states && this.layers.find((l) => l.part.sel.shapes.has(sh.id));
      if (L && !(states!.get(L.part)?.visible ?? true)) continue;
      out.push({
        id: sh.id, src: sh.video.src, once: !!sh.video.once,
        x: x + Math.min(sh.x1, sh.x2) * k, y: y + Math.min(sh.y1, sh.y2) * k, w: Math.abs(sh.x2 - sh.x1) * k, h: Math.abs(sh.y2 - sh.y1) * k,
      });
    }
    return out;
  }

  /** Number of animation steps (an automatic first one included). */
  get stepCount(): number { return this.steps.length; }

  /** Draw the slide with `done` steps played and `t` seconds into the next (t < 0: not started). */
  draw(ctx: CanvasRenderingContext2D, done: number, t = -1): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    if (!this.layers.length) return;
    const states = partStates(this.parts, this.anims, done, t);
    const { x, y, k } = this.at, s = this.dpr * k, size = this.page.size;
    const px = (v: number, o: number) => (o + v * k) * this.dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px(0, x), px(0, y), size.w * s, size.h * s);
    ctx.clip();
    for (const L of this.layers) {
      const st = states.get(L.part) ?? { visible: true };
      if (!st.visible) continue;
      const run = st.running;
      if (!run) { ctx.drawImage(L.canvas, 0, 0); continue; }
      const a = run.anim, p = a.exit ? 1 - run.p : run.p;
      ctx.save();
      if (a.effect === 'appear') { if (a.exit) { ctx.restore(); continue; } }
      else if (a.effect === 'fade') ctx.globalAlpha = p;
      else if (a.effect === 'wipe') {
        const r = wipeRect(L.box, a.from ?? 'bottom', p);
        ctx.beginPath();
        ctx.rect(px(r.x1, x), px(r.y1, y), (r.x2 - r.x1) * s, (r.y2 - r.y1) * s);
        ctx.clip();
      } else if (a.effect === 'fly') {
        const off = flyOffset(L.box, a.from ?? 'bottom', size);
        // coming in: from off the slide to its place; going out: from its place off the slide
        const f = a.exit ? ease(run.p) : 1 - ease(run.p);
        ctx.translate(off.x * f * s, off.y * f * s);
      }
      ctx.drawImage(L.canvas, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** The part of a box shown `p` of the way through a wipe that starts at `side`. */
export function wipeRect(b: Rect, side: Side, p: number): Rect {
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  switch (side) {
    case 'bottom': return { ...b, y1: b.y2 - h * p };
    case 'top': return { ...b, y2: b.y1 + h * p };
    case 'left': return { ...b, x2: b.x1 + w * p };
    case 'right': return { ...b, x1: b.x2 - w * p };
  }
}

/** How far a part moves to be just off the slide at `side`. */
export function flyOffset(b: Rect, side: Side, size: { w: number; h: number }): { x: number; y: number } {
  switch (side) {
    case 'bottom': return { x: 0, y: size.h - b.y1 };
    case 'top': return { x: 0, y: -b.y2 };
    case 'left': return { x: -b.x2, y: 0 };
    case 'right': return { x: size.w - b.x1, y: 0 };
  }
}

const DIR_VEC = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;

/** One frame of a transition, `p` of the way from the old slide to the new (whole canvases). */
export function drawTransition(ctx: CanvasRenderingContext2D, from: CanvasImageSource | null, to: CanvasImageSource, t: Transition, p: number, W: number, H: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const old = () => { if (from) ctx.drawImage(from, 0, 0); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); } };
  const [dx, dy] = DIR_VEC[t.dir ?? 'left'];
  const e = ease(p);
  switch (t.kind) {
    case 'none': ctx.drawImage(to, 0, 0); return;
    case 'fade':
      old();
      ctx.globalAlpha = p;
      ctx.drawImage(to, 0, 0);
      ctx.globalAlpha = 1;
      return;
    case 'push':
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (from) ctx.drawImage(from, dx * e * W, dy * e * H);
      ctx.drawImage(to, dx * (e - 1) * W, dy * (e - 1) * H);
      return;
    case 'cover':
      old();
      ctx.drawImage(to, dx * (e - 1) * W, dy * (e - 1) * H);
      return;
    case 'wipe': {
      old();
      ctx.save();
      ctx.beginPath();
      // the new slide is uncovered from the side it comes from
      if (dx < 0) ctx.rect(W * (1 - p), 0, W * p, H);
      else if (dx > 0) ctx.rect(0, 0, W * p, H);
      else if (dy < 0) ctx.rect(0, H * (1 - p), W, H * p);
      else ctx.rect(0, 0, W, H * p);
      ctx.clip();
      ctx.drawImage(to, 0, 0);
      ctx.restore();
    }
  }
}

/**
 * Plays a deck on a canvas: a click plays the slide's next animations, or goes on to the next
 * slide with its transition. A click while something is moving finishes it at once.
 */
export class Player {
  i = 0;
  /** Steps of the slide's animations played so far. */
  done = 0;
  private frames: SlideFrames | null = null;
  private moving: { kind: 'transition'; from: HTMLCanvasElement | null; to?: HTMLCanvasElement; t: Transition; t0: number } | { kind: 'step'; t0: number } | null = null;
  private raf = 0;
  private loops = 0;
  private timer = 0;
  private timeUp = false;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** Called when a click goes past the last slide. */
  onPastEnd: () => void = () => {};
  /** Called after each change of slide or step (to update a counter, say). */
  onChange: () => void = () => {};
  /** Called when everything has stopped moving. */
  onIdle: () => void = () => {};

  /** Something is moving (a transition or animations). */
  get busy(): boolean { return this.moving !== null; }
  /** Steps of animations the slide has. */
  get stepCount(): number { return this.current.stepCount; }

  constructor(private canvas: HTMLCanvasElement, private deck: Deck, private fill = '#000') {}

  resize(w: number, h: number, dpr: number): void {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.frames = null;
    this.paint();
  }

  /** Paint the slide again from scratch (a picture or font has loaded). */
  refresh(): void {
    this.frames = null;
    this.paint();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.moving = null;
    this.videos(false);
  }

  private vids = new Map<number, HTMLVideoElement>();

  /**
   * Videos play over the canvas, each in its picture's place, while the slide is shown (not
   * during a transition). They are muted and let clicks through to the show.
   */
  private videos(on: boolean): void {
    const host = this.canvas.parentElement;
    const spots = on && host ? this.current.videoSpots(this.done) : [];
    const keep = new Set(spots.map((s) => s.id));
    for (const [id, v] of this.vids) if (!keep.has(id)) { v.pause(); v.remove(); this.vids.delete(id); }
    if (!host || !spots.length) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    for (const s of spots) {
      let v = this.vids.get(s.id);
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.loop = !s.once;
        v.src = s.src;
        v.style.position = 'absolute';
        v.style.pointerEvents = 'none';
        v.style.objectFit = 'fill';
        host.append(v);
        this.vids.set(s.id, v);
        void v.play().catch(() => { /* the still picture under it shows instead */ });
      }
      v.style.left = `${this.canvas.offsetLeft + s.x}px`;
      v.style.top = `${this.canvas.offsetTop + s.y}px`;
      v.style.width = `${s.w}px`;
      v.style.height = `${s.h}px`;
    }
  }

  private framesFor(i: number): SlideFrames {
    const s = this.deck.slides[i];
    const page: SlidePage = { size: this.deck.size, master: this.deck.master, layout: s.layout, index: i };
    return new SlideFrames(page, this.deck.docOf(i), s.anims ?? [], this.w, this.h, this.dpr, this.fill);
  }

  private get current(): SlideFrames {
    if (!this.frames) this.frames = this.framesFor(this.i);
    return this.frames;
  }

  /** Show slide `i`: with its transition (from what is on screen now), or straight away; at its start or with everything played. */
  show(i: number, how: { transition?: boolean; atEnd?: boolean } = {}): void {
    this.stop();
    let from: HTMLCanvasElement | null = null;
    const t = this.deck.slides[i].transition;
    if (how.transition && t && t.kind !== 'none') {
      from = document.createElement('canvas');
      from.width = this.canvas.width;
      from.height = this.canvas.height;
      from.getContext('2d')?.drawImage(this.canvas, 0, 0);
    }
    this.i = i;
    this.frames = null;
    this.done = how.atEnd ? this.current.stepCount : 0;
    this.timeUp = false;
    if (from && t) this.moving = { kind: 'transition', from, t, t0: performance.now() };
    else this.arrived();
    this.paint();
    if (this.moving) this.loop();
    this.onChange();
  }

  /** The slide is fully in: start its automatic animations and its timer. */
  private arrived(): void {
    const st = this.current.steps[this.done];
    if (st?.auto && this.done === 0) this.moving = { kind: 'step', t0: performance.now() };
    const adv = this.deck.slides[this.i].transition?.advanceAfter;
    if (adv) {
      const i = this.i;
      this.timer = window.setTimeout(() => { if (this.i === i) { this.timeUp = true; this.idle(); } }, adv * 1000);
    }
  }

  /** Nothing moving: go on by itself if the slide's time is up and its animations have played. */
  private idle(): void {
    if (this.moving) return;
    this.onIdle();
    if (!this.timeUp) return;
    if (this.done < this.current.stepCount) this.playStep();
    else this.next();
  }

  private playStep(): void {
    this.moving = { kind: 'step', t0: performance.now() };
    this.loop();
  }

  /** A click: finish what is moving, else play the next animations, else go on to the next slide. */
  next(): void {
    if (this.moving) { this.finish(); return; }
    if (this.done < this.current.stepCount) { this.playStep(); return; }
    if (this.i < this.deck.slides.length - 1) this.show(this.i + 1, { transition: true });
    else this.onPastEnd();
  }

  /** Back: undo the last animations, else the previous slide with everything played. */
  prev(): void {
    if (this.moving) this.finish();
    if (this.done > 0 && !(this.done === 1 && this.current.steps[0]?.auto)) {
      this.done--;
      this.paint();
      this.onChange();
      return;
    }
    if (this.i > 0) this.show(this.i - 1, { atEnd: true });
  }

  private finish(): void {
    const m = this.moving;
    this.moving = null;
    if (m?.kind === 'step') this.done = Math.min(this.current.stepCount, this.done + 1);
    // the slide is in: its automatic animations still play
    else if (m?.kind === 'transition') this.arrived();
    if (this.moving) { this.loop(); return; }
    this.paint();
    this.onChange();
    this.idle();
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    // one loop at a time: a paint that starts the next animation starts a new loop, and this one stops
    const gen = ++this.loops;
    const tick = () => {
      if (gen !== this.loops) return;
      this.paint();
      if (this.moving && gen === this.loops) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  paint(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const now = performance.now();
    const m = this.moving;
    if (m?.kind === 'transition') {
      this.videos(false);
      const p = Math.min(1, (now - m.t0) / 1000 / Math.max(0.01, m.t.dur));
      if (!m.to) {
        m.to = document.createElement('canvas');
        m.to.width = this.canvas.width;
        m.to.height = this.canvas.height;
        this.current.draw(m.to.getContext('2d')!, this.done);
      }
      drawTransition(ctx, m.from, m.to, m.t, p, this.canvas.width, this.canvas.height);
      if (p >= 1) {
        this.moving = null;
        this.arrived();
        this.videos(true);
        if (this.moving) this.loop();
        else this.idle();
      }
      return;
    }
    if (m?.kind === 'step') {
      const st = this.current.steps[this.done];
      const t = (now - m.t0) / 1000;
      if (!st || t >= st.length) {
        this.moving = null;
        this.done = Math.min(this.current.stepCount, this.done + 1);
        this.current.draw(ctx, this.done);
        this.videos(true);
        this.onChange();
        this.idle();
        return;
      }
      this.current.draw(ctx, this.done, t);
      return;
    }
    this.current.draw(ctx, this.done);
    this.videos(true);
  }
}
