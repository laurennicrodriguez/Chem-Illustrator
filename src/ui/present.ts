// The slide show (F5): slides full screen, one after another, as in PowerPoint, with their
// transitions and animations. Next (the next animation, else the next slide): click, →, ↓, Space,
// Enter, Page Down or N. Back: ←, ↑, Backspace, Page Up or P.
// Home and End go to the first and last slide; a number then Enter goes to that slide.
// B (or .) makes the screen black and W (or ,) white until a key is pressed. Esc ends the show.
// The laser pointer, pen and highlighter are on the bar at the bottom left (show-ink.ts); links,
// action buttons, zooms, videos and sounds take clicks on them (show-actions.ts).

import { isTauri } from '@tauri-apps/api/core';
import type { Deck } from '../deck/deck';
import { Player } from '../deck/playback';
import { onImageReady } from '../render/images';
import { followLink } from './links-ui';
import { ShowActions } from './show-actions';
import { ShowInk, type Stroke } from './show-ink';
import { ask } from './ask';

export class Presenter {
  private root: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private deck: Deck | null = null;
  private player: Player | null = null;
  /** Black or white screen, or the end-of-show screen. */
  private blank: 'black' | 'white' | 'end' | null = null;
  private typed = '';
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private resizeHandler = () => { this.size(); this.paint(); };
  private wasFullscreen = false;
  private hideCursorTimer = 0;

  private actions: ShowActions | null = null;
  private ink: ShowInk | null = null;

  /** Called when the show ends (with the slide it ended on, to edit next). */
  onEnd: (index: number) => void = () => {};
  /** Called with the ink drawn in the show, by slide, when the presenter keeps it. */
  onKeepInk: (ink: Map<number, Stroke[]>) => void = () => {};

  constructor() {
    onImageReady(() => { if (this.root) this.player?.refresh(); });
  }

  get running(): boolean {
    return this.root !== null;
  }

  async start(deck: Deck, from = 0): Promise<void> {
    if (this.root) return;
    this.deck = deck;
    this.blank = null;
    const root = document.createElement('div');
    root.className = 'present';
    root.tabIndex = -1;
    const canvas = document.createElement('canvas');
    root.append(canvas);
    document.body.append(root);
    this.root = root;
    this.canvas = canvas;
    const player = new Player(canvas, deck);
    player.onPastEnd = () => { this.blank = 'end'; this.paint(); };
    this.player = player;
    const actions = (this.actions = new ShowActions(deck, player, canvas, {
      go: (i) => this.go(i, false), next: () => this.next(), prev: () => this.prev(), end: () => this.stop(), open: (link) => void followLink(link),
    }));
    const ink = (this.ink = new ShowInk(root, canvas, { slide: () => player.i, place: () => player.slidePlace }));
    player.onChange = () => { actions.noteSlide(player.i); ink.paint(); };
    // a click on a link, action button, zoom, video or sound acts on it, as in PowerPoint's slide show; anywhere else goes on
    root.addEventListener('click', (e) => { if (!this.clickThing(e)) this.next(); });
    root.addEventListener('pointermove', (e) => { if (this.canvas) this.canvas.style.cursor = this.thingUnder(e) ? 'pointer' : ''; });
    root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.prev(); });
    root.addEventListener('wheel', (e) => { if (e.deltaY > 0) this.next(); else if (e.deltaY < 0) this.prev(); }, { passive: true });
    root.addEventListener('pointermove', () => this.showCursor());
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('resize', this.resizeHandler);
    root.focus();
    await this.fullscreen(true);
    // the show may have been ended while the window went full screen
    if (this.root !== root) { void this.fullscreen(false); return; }
    this.size();
    // the first slide comes in with its transition too, as in PowerPoint
    player.show(Math.max(0, Math.min(deck.slides.length - 1, from)), { transition: true });
    this.showCursor();
    void document.fonts?.ready.then(() => { if (this.player === player) player.refresh(); });
  }

  stop(): void {
    if (!this.root) return;
    const ink = this.ink?.any ? this.ink.all() : null;
    this.ink?.remove();
    this.ink = null;
    this.actions = null;
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('resize', this.resizeHandler);
    clearTimeout(this.hideCursorTimer);
    const i = this.player?.i ?? 0;
    this.player?.stop();
    this.player = null;
    this.root.remove();
    this.root = null;
    this.canvas = null;
    void this.fullscreen(false);
    this.onEnd(i);
    if (ink) void askKeepInk().then((keep) => { if (keep) this.onKeepInk(ink); });
  }

  private async fullscreen(on: boolean): Promise<void> {
    try {
      if (isTauri()) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const w = getCurrentWindow();
        if (on) {
          this.wasFullscreen = await w.isFullscreen();
          if (!this.wasFullscreen) await w.setFullscreen(true);
        } else if (!this.wasFullscreen) await w.setFullscreen(false);
      } else if (on) {
        await this.root?.requestFullscreen?.();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // the show still runs, filling the window
    }
  }

  private showCursor(): void {
    if (!this.root) return;
    this.root.classList.remove('no-cursor');
    clearTimeout(this.hideCursorTimer);
    this.hideCursorTimer = window.setTimeout(() => this.root?.classList.add('no-cursor'), 2500);
  }

  private point(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private thingUnder(e: MouseEvent): boolean {
    if (!this.canvas || this.blank || !this.actions) return false;
    const p = this.point(e);
    return this.actions.clickable(p.x, p.y);
  }

  /** Act on what was clicked, if anything takes a click there. */
  private clickThing(e: MouseEvent): boolean {
    if (!this.canvas || this.blank || !this.actions) return false;
    const p = this.point(e);
    return this.actions.click(p.x, p.y);
  }

  private next(): void {
    if (this.blank === 'black' || this.blank === 'white') { this.blank = null; this.paint(); return; }
    if (this.blank === 'end') { this.stop(); return; }
    this.player?.next();
  }

  private prev(): void {
    if (this.blank) { this.blank = null; this.paint(); return; }
    this.player?.prev();
  }

  /** Go to a slide; `jump` (a number typed, Home, End) forgets zooms to come back from. */
  private go(i: number, jump = true): void {
    this.blank = null;
    if (jump) this.actions?.forgetReturns();
    this.player?.show(Math.max(0, Math.min(this.deck!.slides.length - 1, i)));
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.root) return;
    // every key belongs to the show while it runs
    e.preventDefault();
    e.stopPropagation();
    if (this.ink?.key(e)) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) { this.typed += k; return; }
    if (k === 'Enter' && this.typed) { this.go(Number(this.typed) - 1); this.typed = ''; return; }
    this.typed = '';
    if (k === 'Escape') this.stop();
    else if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'n', 'N'].includes(k)) this.next();
    else if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp', 'p', 'P'].includes(k)) this.prev();
    else if (k === 'Home') this.go(this.deck!.firstShown());
    else if (k === 'End') this.go(Math.max(0, this.deck!.shownBefore(this.deck!.slides.length)));
    else if (k === 'b' || k === 'B' || k === '.') { this.blank = this.blank === 'black' ? null : 'black'; this.paint(); }
    else if (k === 'w' || k === 'W' || k === ',') { this.blank = this.blank === 'white' ? null : 'white'; this.paint(); }
  }

  private size(): void {
    const root = this.root;
    if (!root) return;
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    this.player?.resize(w, h, window.devicePixelRatio || 1);
    this.ink?.paint();
  }

  private paint(): void {
    const canvas = this.canvas, root = this.root;
    if (!canvas || !root) return;
    if (!this.blank) { this.player?.paint(); return; }
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.blank === 'white' ? '#fff' : '#000';
    ctx.fillRect(0, 0, w, h);
    if (this.blank === 'end') {
      ctx.fillStyle = '#bbb';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText('End of slide show. Click or press a key to finish.', 24, 36);
    }
  }
}

/** At the end of a show with ink: keep it on the slides, or throw it away (as PowerPoint asks). */
export async function askKeepInk(): Promise<boolean> {
  const got = await ask('Keep Ink?', [], { ok: 'Keep', note: 'Do you want to keep your ink annotations? Kept, they go on the slides as shapes you can move, recolour or delete (and they go to PowerPoint). Cancel discards them.' });
  return !!got;
}
