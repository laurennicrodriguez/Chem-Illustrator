// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/deck/slide-view', () => ({
  paintSlide: () => ({ x: 0, y: 0, k: 1 }),
}));

import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { Player } from '../src/deck/playback';
import { newAnim } from '../src/deck/animation';

const noop = () => undefined;
const ctx = new Proxy({}, { get: () => noop, set: () => true });
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;

describe('Player rAF chains', () => {
  it('runs a single requestAnimationFrame chain after a transition into an auto animation', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let queue: (() => void)[] = [];
    let ids = 0;
    const cancelled = new Set<number>();
    const pending = new Map<number, () => void>();
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { const id = ++ids; pending.set(id, cb); return id; };
    (globalThis as any).cancelAnimationFrame = (id: number) => { pending.delete(id); cancelled.add(id); };
    const frame = () => { const cbs = [...pending.values()]; pending.clear(); for (const cb of cbs) cb(); return cbs.length; };

    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide();
    // slide 2: a fade transition and a shape that fades in by itself as the slide comes in
    const sh = host.edit('s', () => host.addShape({ kind: 'rect', x1: 10, y1: 10, x2: 60, y2: 40 } as never)) as { id: number };
    d.slides[1].transition = { kind: 'fade', dur: 0.5 };
    d.slides[1].anims = [{ ...newAnim({ kind: 'shape', id: sh.id }, 'fade'), start: 'with', dur: 1 }];
    d.go(0);
    const canvas = document.createElement('canvas');
    const p = new Player(canvas, d);
    p.resize(100, 60, 1);
    p.show(0);
    p.next(); // to slide 2 with its transition
    expect(p.i).toBe(1);
    const counts: number[] = [];
    for (let k = 0; k < 6; k++) { now += 200; counts.push(frame()); }
    // while one thing is moving there should only ever be one callback per frame
    expect(Math.max(...counts)).toBe(1);
  });
});
