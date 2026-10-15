// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/deck/slide-view', () => ({ paintSlide: () => ({ x: 0, y: 0, k: 1 }) }));
(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
const noop = () => undefined;
const ctx = new Proxy({}, { get: () => noop, set: () => true });
(HTMLCanvasElement.prototype as any).getContext = () => ctx;
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { PresenterView } from '../src/ui/presenter-view';

describe('presenter view ended while starting', () => {
  it('leaves no timer running and opens no audience window', async () => {
    const opened: string[] = [];
    window.open = ((u: string) => { opened.push(u); return null; }) as never;
    const intervals = new Set<number>();
    const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
    window.setInterval = ((f: () => void, ms: number) => { const id = si(f, ms); intervals.add(id); return id; }) as never;
    window.clearInterval = ((id: number) => { intervals.delete(id); ci(id); }) as never;
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    const pv = new PresenterView();
    const started = pv.start(d, 0);
    pv.stop(); // Esc pressed while the window was going full screen
    await started;
    expect(intervals.size).toBe(0);
    expect(opened).toEqual([]);
  });
});
