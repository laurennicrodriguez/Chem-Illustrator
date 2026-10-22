// Presenter view (Alt+F5, as in PowerPoint): the slides go full screen on the second screen (the
// projector) in a window of their own, while this window shows the presenter the slide on show,
// the next one, the speaker notes, a timer and the clock. With one screen the audience window
// opens as an ordinary window that can be dragged to a projector later, or closed to rehearse.
// The keys are the slide show's: → ↓ Space Enter Page Down N for next, ← ↑ Backspace Page Up P
// for back, a number then Enter to jump, B and W for a black or white screen, Esc to end.

import { isTauri } from '@tauri-apps/api/core';
import type { Deck } from '../deck/deck';
import { Player } from '../deck/playback';
import { paintSlide } from '../deck/slide-view';
import { ShowLink, AUDIENCE, deckData, clockText, type ShowMessage } from '../deck/show-link';
import { onImageReady } from '../render/images';

/** Where the audience's slides went. */
type Audience = 'other-screen' | 'window' | 'none';

/** Open the audience window: full screen on another screen when there is one. */
async function openAudience(): Promise<{ where: Audience; win: Window | null }> {
  if (isTauri()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { availableMonitors, currentMonitor } = await import('@tauri-apps/api/window');
    (await WebviewWindow.getByLabel(AUDIENCE))?.destroy();
    const [all, here] = await Promise.all([availableMonitors(), currentMonitor()]);
    const other = all.find((m) => !here || m.name !== here.name || m.position.x !== here.position.x || m.position.y !== here.position.y);
    if (other) {
      const pos = other.position.toLogical(other.scaleFactor), sz = other.size.toLogical(other.scaleFactor);
      new WebviewWindow(AUDIENCE, { url: 'audience.html', title: 'Slide show', x: pos.x, y: pos.y, width: sz.width, height: sz.height, decorations: false, fullscreen: true, focus: false });
      return { where: 'other-screen', win: null };
    }
    new WebviewWindow(AUDIENCE, { url: 'audience.html', title: 'Slide show: drag to the projector', width: 960, height: 540 });
    return { where: 'window', win: null };
  }
  const win = window.open('audience.html', 'ci-audience', 'popup,width=960,height=560');
  return { where: win ? 'window' : 'none', win };
}

export class PresenterView {
  private root: HTMLDivElement | null = null;
  private deck: Deck | null = null;
  private player: Player | null = null;
  private link: ShowLink | null = null;
  private audience: Audience = 'none';
  private audienceWin: Window | null = null;
  private blank: 'black' | 'white' | 'end' | null = null;
  private typed = '';
  private started = 0;
  private pausedAt: number | null = null;
  private tick = 0;
  private notesSize = 20;
  private els!: { cur: HTMLDivElement; canvas: HTMLCanvasElement; next: HTMLCanvasElement; nextBox: HTMLDivElement; nextLabel: HTMLElement; notes: HTMLDivElement; count: HTMLElement; timer: HTMLElement; clock: HTMLElement; pause: HTMLButtonElement; where: HTMLElement; blank: HTMLElement };
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private sizer = new ResizeObserver(() => this.layout());
  private wasFullscreen = false;

  /** Called when the show ends (with the slide it ended on, to edit next). */
  onEnd: (index: number) => void = () => {};

  constructor() {
    onImageReady(() => { if (this.root) { this.player?.refresh(); this.paintNext(); } });
  }

  get running(): boolean {
    return this.root !== null;
  }

  async start(deck: Deck, from = 0): Promise<void> {
    if (this.root) return;
    this.deck = deck;
    this.blank = null;
    this.typed = '';
    const root = (this.root = document.createElement('div'));
    root.className = 'present presenter-view';
    root.tabIndex = -1;
    root.innerHTML = `
      <div class="pv-top">
        <span class="pv-timer" title="Time since the show started">0:00</span>
        <button type="button" data-pv="pause" title="Pause or carry on the timer">Pause</button>
        <button type="button" data-pv="reset" title="Start the timer again from 0:00">Reset</button>
        <span class="pv-clock" title="The time now"></span>
        <span class="pv-where"></span>
        <span class="pv-gap"></span>
        <button type="button" data-pv="audience" title="Open the audience's window again (full screen on the second screen when there is one)">Audience Window</button>
        <button type="button" data-pv="black" title="Black screen for the audience (B); press again to go back">Black Screen</button>
        <button type="button" data-pv="end" title="End the show (Esc)">End Show</button>
      </div>
      <div class="pv-body">
        <div class="pv-cur"><canvas></canvas><div class="pv-blank" hidden></div></div>
        <div class="pv-side">
          <div class="pv-label pv-next-label">Next</div>
          <div class="pv-next"><canvas></canvas></div>
          <div class="pv-label">Notes
            <span class="pv-gap"></span>
            <button type="button" data-pv="smaller" title="Smaller notes" aria-label="Smaller notes">A−</button>
            <button type="button" data-pv="bigger" title="Bigger notes" aria-label="Bigger notes">A+</button>
          </div>
          <div class="pv-notes"></div>
        </div>
      </div>
      <div class="pv-bottom">
        <button type="button" data-pv="prev" title="Back (←)">◀ Back</button>
        <span class="pv-count"></span>
        <button type="button" data-pv="next" title="Next (→, Space or a click on the slide)">Next ▶</button>
      </div>`;
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    this.els = {
      cur: q('.pv-cur'), canvas: q('.pv-cur canvas'), next: q('.pv-next canvas'), nextBox: q('.pv-next'), nextLabel: q('.pv-next-label'),
      notes: q('.pv-notes'), count: q('.pv-count'), timer: q('.pv-timer'), clock: q('.pv-clock'), pause: q('[data-pv="pause"]'), where: q('.pv-where'), blank: q('.pv-blank'),
    };
    this.els.notes.style.fontSize = `${this.notesSize}px`;
    document.body.append(root);
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pv]');
      if (b) { this.button(b.dataset.pv!); return; }
      if ((e.target as HTMLElement).closest('.pv-cur')) this.next();
    });
    this.els.cur.addEventListener('contextmenu', (e) => { e.preventDefault(); this.prev(); });
    const player = (this.player = new Player(this.els.canvas, deck, '#111317'));
    player.onPastEnd = () => this.setBlank('end');
    player.onChange = () => this.update();
    window.addEventListener('keydown', this.keyHandler, true);
    this.sizer.observe(this.els.cur);
    this.sizer.observe(this.els.nextBox);
    root.focus();
    await this.fullscreen(true);
    // the show may have been ended while the window went full screen
    if (this.root !== root) { void this.fullscreen(false); return; }
    this.started = performance.now();
    this.pausedAt = null;
    this.tick = window.setInterval(() => this.clock(), 500);
    this.clock();
    this.layout();
    player.show(Math.max(0, Math.min(deck.slides.length - 1, from)), { transition: true });
    const link = (this.link = new ShowLink('presenter', (m) => this.heard(m)));
    await link.open();
    if (this.root !== root) { link.close(); return; }
    await this.openAudience();
    if (this.root !== root) { this.closeAudience(); return; }
    void document.fonts?.ready.then(() => { if (this.player === player) { player.refresh(); this.paintNext(); } });
  }

  stop(): void {
    if (!this.root) return;
    window.removeEventListener('keydown', this.keyHandler, true);
    this.sizer.disconnect();
    clearInterval(this.tick);
    const i = this.player?.i ?? 0;
    this.player?.stop();
    this.player = null;
    this.link?.send({ kind: 'bye' });
    this.link?.close();
    this.link = null;
    this.closeAudience();
    this.root.remove();
    this.root = null;
    void this.fullscreen(false);
    this.onEnd(i);
  }

  private closeAudience(): void {
    this.audienceWin?.close();
    this.audienceWin = null;
    if (isTauri()) void import('@tauri-apps/api/webviewWindow').then(async ({ WebviewWindow }) => (await WebviewWindow.getByLabel(AUDIENCE))?.destroy());
  }

  private async openAudience(): Promise<void> {
    try {
      const got = await openAudience();
      this.audience = got.where;
      this.audienceWin = got.win;
    } catch {
      this.audience = 'none';
    }
    this.update();
  }

  /** A message from the audience's window. */
  private heard(m: ShowMessage): void {
    if (!this.deck || !this.player) return;
    if (m.kind === 'hello') {
      this.link?.send({ kind: 'deck', deck: deckData(this.deck), i: this.player.i, done: this.player.done });
      if (this.blank) this.link?.send({ kind: 'blank', how: this.blank });
    } else if (m.kind === 'key') {
      if (m.key === 'click') this.next();
      else this.onKey(new KeyboardEvent('keydown', { key: m.key }));
    } else if (m.kind === 'bye') {
      this.audience = 'none';
      this.audienceWin = null;
      this.update();
    }
  }

  private button(what: string): void {
    if (what === 'next') this.next();
    else if (what === 'prev') this.prev();
    else if (what === 'end') this.stop();
    else if (what === 'black') this.setBlank(this.blank === 'black' ? null : 'black');
    else if (what === 'audience') void this.openAudience();
    else if (what === 'pause') {
      if (this.pausedAt === null) this.pausedAt = performance.now();
      else { this.started += performance.now() - this.pausedAt; this.pausedAt = null; }
      this.clock();
    } else if (what === 'reset') {
      this.started = performance.now();
      if (this.pausedAt !== null) this.pausedAt = this.started;
      this.clock();
    } else if (what === 'bigger' || what === 'smaller') {
      this.notesSize = Math.max(10, Math.min(48, this.notesSize + (what === 'bigger' ? 2 : -2)));
      this.els.notes.style.fontSize = `${this.notesSize}px`;
    }
  }

  private setBlank(how: 'black' | 'white' | 'end' | null): void {
    this.blank = how;
    this.link?.send({ kind: 'blank', how });
    this.update();
  }

  private next(): void {
    if (this.blank === 'black' || this.blank === 'white') { this.setBlank(null); return; }
    if (this.blank === 'end') { this.stop(); return; }
    this.link?.send({ kind: 'next' });
    this.player?.next();
  }

  private prev(): void {
    if (this.blank) { this.setBlank(null); return; }
    this.link?.send({ kind: 'prev' });
    this.player?.prev();
  }

  private go(i: number): void {
    const n = this.deck!.slides.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (this.blank) this.setBlank(null);
    this.link?.send({ kind: 'go', i });
    this.player?.show(i);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.root) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.key;
    if (/^[0-9]$/.test(k)) { this.typed += k; return; }
    if (k === 'Enter' && this.typed) { this.go(Number(this.typed) - 1); this.typed = ''; return; }
    this.typed = '';
    if (k === 'Escape') this.stop();
    else if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'n', 'N'].includes(k)) this.next();
    else if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp', 'p', 'P'].includes(k)) this.prev();
    else if (k === 'Home') this.go(this.deck!.firstShown());
    else if (k === 'End') this.go(Math.max(0, this.deck!.shownBefore(this.deck!.slides.length)));
    else if (k === 'b' || k === 'B' || k === '.') this.setBlank(this.blank === 'black' ? null : 'black');
    else if (k === 'w' || k === 'W' || k === ',') this.setBlank(this.blank === 'white' ? null : 'white');
  }

  private clock(): void {
    if (!this.root) return;
    const now = this.pausedAt ?? performance.now();
    this.els.timer.textContent = clockText((now - this.started) / 1000);
    this.els.pause.textContent = this.pausedAt === null ? 'Pause' : 'Carry On';
    this.els.timer.classList.toggle('paused', this.pausedAt !== null);
    this.els.clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /** After a change of slide or step: the counter, the notes and the next slide. */
  private update(): void {
    if (!this.root || !this.deck || !this.player) return;
    const i = this.player.i, n = this.deck.slides.length;
    const steps = this.player.stepCount, done = this.player.done;
    this.els.count.textContent = `Slide ${i + 1} of ${n}${steps ? ` · animation ${done} of ${steps}` : ''}`;
    this.els.notes.textContent = this.deck.slides[i].notes || 'No notes for this slide.';
    this.els.notes.classList.toggle('muted', !this.deck.slides[i].notes);
    this.els.where.textContent = this.audience === 'other-screen' ? 'Audience: full screen on the second screen'
      : this.audience === 'window' ? 'Audience: in its own window (drag it to the projector; F fills the screen in a browser)'
        : 'Audience window closed';
    const b = this.els.blank;
    b.hidden = !this.blank;
    b.textContent = this.blank === 'end' ? 'End of slide show. Next ends it.' : this.blank === 'white' ? 'White screen (press W or click to go back)' : 'Black screen (press B or click to go back)';
    b.className = `pv-blank ${this.blank ?? ''}`;
    this.paintNext();
  }

  private layout(): void {
    if (!this.root || !this.deck) return;
    const r = this.els.cur.getBoundingClientRect();
    this.player?.resize(Math.max(1, r.width), Math.max(1, r.height), window.devicePixelRatio || 1);
    this.paintNext();
  }

  private paintNext(): void {
    if (!this.root || !this.deck || !this.player) return;
    // the next slide the show plays (hidden slides are skipped)
    const d = this.deck, i = d.shownAfter(this.player.i);
    const box = this.els.nextBox.getBoundingClientRect();
    const w = Math.max(1, box.width), h = Math.max(1, Math.min(box.height, (box.width * d.size.h) / d.size.w));
    const c = this.els.next;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const more = this.player.done < this.player.stepCount;
    this.els.nextLabel.textContent = more ? 'Next: more of this slide, then' : 'Next';
    if (i < 0) {
      const ctx = c.getContext('2d')!;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#bbb';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('End of slide show', 12, 24);
      return;
    }
    paintSlide(c, w, h, window.devicePixelRatio || 1, d.page(i), d.docOf(i), '#111317');
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
      }
      // in a browser the presenter's window stays as it is, so the audience window can be moved
    } catch {
      // carries on in the window as it is
    }
  }
}
