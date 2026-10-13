// The slide show (F5): slides full screen, one after another, as in PowerPoint.
// Next: click, →, ↓, Space, Enter, Page Down or N. Back: ←, ↑, Backspace, Page Up or P.
// Home and End go to the first and last slide; a number then Enter goes to that slide.
// B (or .) makes the screen black and W (or ,) white until a key is pressed. Esc ends the show.

import { isTauri } from '@tauri-apps/api/core';
import type { Deck } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';
import { onImageReady } from '../render/images';

export class Presenter {
  private root: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private deck: Deck | null = null;
  private i = 0;
  /** Black or white screen, or the end-of-show screen. */
  private blank: 'black' | 'white' | 'end' | null = null;
  private typed = '';
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private resizeHandler = () => this.paint();
  private wasFullscreen = false;
  private hideCursorTimer = 0;

  /** Called when the show ends (with the slide it ended on, to edit next). */
  onEnd: (index: number) => void = () => {};

  constructor() {
    onImageReady(() => { if (this.root) this.paint(); });
  }

  get running(): boolean {
    return this.root !== null;
  }

  async start(deck: Deck, from = 0): Promise<void> {
    if (this.root) return;
    this.deck = deck;
    this.i = Math.max(0, Math.min(deck.slides.length - 1, from));
    this.blank = null;
    const root = document.createElement('div');
    root.className = 'present';
    root.tabIndex = -1;
    const canvas = document.createElement('canvas');
    root.append(canvas);
    document.body.append(root);
    this.root = root;
    this.canvas = canvas;
    root.addEventListener('click', () => this.next());
    root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.prev(); });
    root.addEventListener('wheel', (e) => { if (e.deltaY > 0) this.next(); else if (e.deltaY < 0) this.prev(); }, { passive: true });
    root.addEventListener('pointermove', () => this.showCursor());
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('resize', this.resizeHandler);
    root.focus();
    await this.fullscreen(true);
    this.paint();
    this.showCursor();
  }

  stop(): void {
    if (!this.root) return;
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('resize', this.resizeHandler);
    clearTimeout(this.hideCursorTimer);
    this.root.remove();
    this.root = null;
    this.canvas = null;
    void this.fullscreen(false);
    this.onEnd(this.i);
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

  private next(): void {
    const deck = this.deck!;
    if (this.blank === 'black' || this.blank === 'white') { this.blank = null; this.paint(); return; }
    if (this.blank === 'end') { this.stop(); return; }
    if (this.i < deck.slides.length - 1) this.i++;
    else this.blank = 'end';
    this.paint();
  }

  private prev(): void {
    if (this.blank) { this.blank = null; this.paint(); return; }
    if (this.i > 0) this.i--;
    this.paint();
  }

  private go(i: number): void {
    this.blank = null;
    this.i = Math.max(0, Math.min(this.deck!.slides.length - 1, i));
    this.paint();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.root) return;
    // every key belongs to the show while it runs
    e.preventDefault();
    e.stopPropagation();
    const k = e.key;
    if (/^[0-9]$/.test(k)) { this.typed += k; return; }
    if (k === 'Enter' && this.typed) { this.go(Number(this.typed) - 1); this.typed = ''; return; }
    this.typed = '';
    if (k === 'Escape') this.stop();
    else if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'n', 'N'].includes(k)) this.next();
    else if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp', 'p', 'P'].includes(k)) this.prev();
    else if (k === 'Home') this.go(0);
    else if (k === 'End') this.go(this.deck!.slides.length - 1);
    else if (k === 'b' || k === 'B' || k === '.') { this.blank = this.blank === 'black' ? null : 'black'; this.paint(); }
    else if (k === 'w' || k === 'W' || k === ',') { this.blank = this.blank === 'white' ? null : 'white'; this.paint(); }
  }

  private paint(): void {
    const deck = this.deck, canvas = this.canvas, root = this.root;
    if (!deck || !canvas || !root) return;
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (this.blank) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = this.blank === 'white' ? '#fff' : '#000';
      ctx.fillRect(0, 0, w, h);
      if (this.blank === 'end') {
        ctx.fillStyle = '#bbb';
        ctx.font = '16px system-ui, sans-serif';
        ctx.fillText('End of slide show. Click or press a key to finish.', 24, 36);
      }
      return;
    }
    const s = deck.slides[this.i];
    paintSlide(canvas, w, h, dpr, { size: deck.size, master: deck.master, layout: s.layout, index: this.i }, deck.docOf(this.i), '#000');
  }
}
