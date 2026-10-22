// Presenter view: the slides go to a second window (the audience's, on the projector) while the
// presenter's screen shows notes, the next slide and a timer. The two windows talk through this
// link: the presenter sends the deck once, then every click, so both play the same animations.
// In the desktop app the link is Tauri's events between windows; in a browser, a BroadcastChannel.

import { isTauri } from '@tauri-apps/api/core';
import { Doc, type Contents } from '../model';
import { Deck, type LayoutId, type Master, type SlideSize, type SlideHF } from './deck';
import type { Anim, Transition } from './animation';
import type { Background } from './background';

/** Everything the audience window needs to show the slides. */
export interface DeckData {
  size: SlideSize;
  master: Master;
  slides: { layout: LayoutId; contents: Contents; transition?: Transition; anims?: Anim[]; background?: Background; hideGraphics?: boolean; hidden?: boolean; hf?: SlideHF }[];
  /** How the show plays, as the presenter's player does (Set Up Show): its slides in order, without animations, by its timings. */
  play?: { order: number[] | null; noAnimation: boolean; useTimings: boolean };
}

export type ShowMessage =
  | { kind: 'hello' } // audience → presenter: ready, send the slides
  | { kind: 'deck'; deck: DeckData; i: number; done: number }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'go'; i: number; atEnd?: boolean }
  | { kind: 'blank'; how: 'black' | 'white' | 'end' | null }
  | { kind: 'zoom'; i: number; rect: { x1: number; y1: number; x2: number; y2: number }; out: boolean } // a zoom, its box as fractions of the slide canvas
  | { kind: 'tap'; fx: number; fy: number } // a click on a video or sound, as fractions of the canvas
  | { kind: 'ink'; i: number; strokes: { tool: 'pen' | 'highlighter'; color: string; width: number; pts: { x: number; y: number }[] }[] }
  | { kind: 'laser'; p: { x: number; y: number } | null }
  | { kind: 'key'; key: string } // audience → presenter: a key pressed or a click there
  | { kind: 'bye' }; // either way: the show is over, or the window was closed

export const AUDIENCE = 'audience';
const EVENT = 'slide-show';
const CHANNEL = 'chem-illustrator-slide-show';

/** The deck as plain data (speaker notes stay with the presenter). */
export function deckData(deck: Deck, play?: DeckData['play']): DeckData {
  return {
    size: { ...deck.size },
    master: deck.master,
    slides: deck.slides.map((s, i) => ({ layout: s.layout, contents: deck.docOf(i).contents(), transition: s.transition, anims: s.anims, background: s.background, hideGraphics: s.hideGraphics, hidden: s.hidden, hf: s.hf })),
    ...(play ? { play } : {}),
  };
}

/** A deck to play, made from the data sent. */
export function deckFromData(d: DeckData): Deck {
  const deck = new Deck(new Doc());
  deck.load(d.slides.map((s) => deck.makeSlide(s.layout, s.contents, '', { transition: s.transition, anims: s.anims, background: s.background, hideGraphics: s.hideGraphics, hidden: s.hidden, hf: s.hf })), d.size, d.master);
  return deck;
}

/** One end of the link: `side` is who this window is. */
export class ShowLink {
  private channel: BroadcastChannel | null = null;
  private unlisten: (() => void) | null = null;

  constructor(private side: 'presenter' | 'audience', private got: (m: ShowMessage) => void) {}

  async open(): Promise<void> {
    if (isTauri()) {
      const { listen } = await import('@tauri-apps/api/event');
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const me = getCurrentWebviewWindow().label;
      this.unlisten = await listen<{ to: string; m: ShowMessage }>(EVENT, (e) => { if (e.payload.to === me) this.got(e.payload.m); });
    } else if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (e: MessageEvent<{ from: string; m: ShowMessage }>) => { if (e.data.from !== this.side) this.got(e.data.m); };
    }
  }

  send(m: ShowMessage): void {
    if (isTauri()) {
      void import('@tauri-apps/api/event').then(({ emit }) => emit(EVENT, { to: this.side === 'presenter' ? AUDIENCE : 'main', m }));
    } else {
      this.channel?.postMessage({ from: this.side, m });
    }
  }

  close(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.channel?.close();
    this.channel = null;
  }
}

/** Seconds as a clock: 75 → "1:15", 3725 → "1:02:05". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
