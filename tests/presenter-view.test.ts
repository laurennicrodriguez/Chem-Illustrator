// @vitest-environment jsdom
//
// Presenter view: the slides sent to the audience's window, and the timer's clock.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { newAnim } from '../src/deck/animation';
import { deckData, deckFromData, clockText } from '../src/deck/show-link';

describe('presenter view', () => {
  it('sends the slides, transitions and animations as plain data, without the notes', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    host.edit('t', () => host.addCaption({ x: 100, y: 100, runs: [{ text: 'Results' }], justify: 'left' }));
    const shape = host.edit('s', () => host.addShape({ kind: 'rect', x: 10, y: 10, w: 50, h: 30 } as never));
    d.slides[0].notes = 'Mention the yields';
    d.slides[0].transition = { kind: 'fade', duration: 0.7 } as never;
    d.slides[0].anims = [newAnim({ kind: 'shape', id: (shape as { id: number } | undefined)?.id ?? 1 }, 'fade')];
    // what goes between the windows is text (JSON)
    const sent = JSON.parse(JSON.stringify(deckData(d)));
    const got = deckFromData(sent);
    expect(got.slides).toHaveLength(d.slides.length);
    expect(got.size).toEqual(d.size);
    expect(got.slides[0].transition).toEqual(d.slides[0].transition);
    expect(got.slides[0].anims).toEqual(d.slides[0].anims);
    expect(got.slides[0].notes).toBe('');
    const caps = [...got.docOf(0).captions.values()].map((c) => c.runs.map((r) => r.text).join(''));
    expect(caps).toContain('Results');
  });

  it('shows the time as minutes and seconds, with hours when it runs long', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(75.9)).toBe('1:15');
    expect(clockText(3725)).toBe('1:02:05');
    expect(clockText(-3)).toBe('0:00');
  });
});
