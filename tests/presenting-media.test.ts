// @vitest-environment jsdom
//
// Office wave 4, presenting and media: emphasis effects, the Morph transition, video and audio
// from files, action buttons and zooms, and ink from the slide show, in the app and through
// PowerPoint files and back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { newAnim, partStates, slideParts, partOf, transitionXml, readTransition, animName, type Anim, type Transition } from '../src/deck/animation';
import { morphPairs } from '../src/deck/playback';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
export const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
export const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

/** A one-slide deck holding a picture, a box and a text box, through PowerPoint and back. */
async function roundTrip(transition: Transition | undefined, anims: (ids: number[]) => Anim[]) {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.setLayout('blank');
  const ids: number[] = [];
  host.edit('Things', () => {
    ids.push(host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 200, y2: 180, src: DOT, px: { w: 1, h: 1 } }).id);
    ids.push(host.addShape({ kind: 'rect', x1: 300, y1: 100, x2: 400, y2: 180, filled: true }).id);
    ids.push(host.addCaption({ x: 100, y: 300, runs: [{ text: 'Yield 92%' }] }).id);
  });
  const list = anims(ids);
  const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, transition, anims: list })) }, opts);
  return { xml: strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']), back: readPptx(bytes) };
}

describe('emphasis effects', () => {
  it('leaves an emphasised part showing, and keeps what the effect did', () => {
    const doc = new Doc();
    let a!: { id: number };
    doc.bulk(() => { a = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 50, y2: 50 }); });
    const parts = slideParts(doc);
    const t = { kind: 'shape' as const, id: a.id };
    const anims = [newAnim(t, 'grow'), newAnim(t, 'spin'), { ...newAnim(t, 'transparency'), opacity: 0.25 }];
    const p = partOf(parts, t)!;
    expect(partStates(parts, anims, 0, -1).get(p)?.visible ?? true).toBe(true);
    // half way through growing
    const mid = partStates(parts, anims, 0, 1).get(p)!;
    expect(mid.emph!.scale).toBeCloseTo(1.25);
    // all three played: half as big again, a whole turn, a quarter see-through
    const end = partStates(parts, anims, 3, -1).get(p)!.emph!;
    expect(end.scale).toBeCloseTo(1.5);
    expect(end.rot).toBeCloseTo(360);
    expect(end.alpha).toBeCloseTo(0.75);
  });

  it('pulses and comes back to its size', () => {
    const doc = new Doc();
    let a!: { id: number };
    doc.bulk(() => { a = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 50, y2: 50 }); });
    const parts = slideParts(doc);
    const t = { kind: 'shape' as const, id: a.id };
    const p = partOf(parts, t)!;
    expect(partStates(parts, [newAnim(t, 'pulse')], 0, 0.25).get(p)!.emph!.scale).toBeGreaterThan(1.05);
    expect(partStates(parts, [newAnim(t, 'pulse')], 1, -1).get(p)!.emph!.scale).toBeCloseTo(1);
    expect(animName(newAnim(t, 'grow'))).toBe('Grow/Shrink');
  });

  it('keeps emphasis effects through PowerPoint and back', async () => {
    const { xml, back } = await roundTrip(undefined, ([pic, box, text]) => [
      newAnim({ kind: 'shape', id: pic }, 'pulse'),
      { ...newAnim({ kind: 'shape', id: box }, 'grow'), scale: 0.5, start: 'after' },
      { ...newAnim({ kind: 'shape', id: box }, 'spin'), turn: -90 },
      { ...newAnim({ kind: 'shape', id: pic }, 'transparency'), opacity: 0.7 },
      { ...newAnim({ kind: 'shape', id: box }, 'colour'), color: '#1e88e5' },
      { ...newAnim({ kind: 'caption', id: text }, 'colour'), color: '#43a047', start: 'with' },
    ]);
    expect(xml).toContain('presetClass="emph"');
    expect(xml).toContain('<p:animRot by="-5400000">');
    expect(xml).toContain('<p:by x="50000" y="50000"/>');
    expect(xml).toContain('<p:attrName>fillcolor</p:attrName>');
    expect(xml).toContain('<p:attrName>style.color</p:attrName>');
    const got = back.slides[0].anims!;
    expect(got.map((a) => a.effect)).toEqual(['pulse', 'grow', 'spin', 'transparency', 'colour', 'colour']);
    expect(got[1].scale).toBeCloseTo(0.5);
    expect(got[1].start).toBe('after');
    expect(got[2].turn).toBeCloseTo(-90);
    expect(got[3].opacity).toBeCloseTo(0.7);
    expect(got[4].color).toBe('#1e88e5');
    expect(got[5].color).toBe('#43a047');
    expect(got[5].start).toBe('with');
    expect(got[2].dur).toBeCloseTo(2);
    expect(got[0].dur).toBeCloseTo(0.5);
  });
});

describe('Morph', () => {
  it('writes Morph for PowerPoint 2019 and later, with a fade for older ones, and reads it back', async () => {
    const x = transitionXml({ kind: 'morph', dur: 2 });
    expect(x).toContain('<p159:morph option="byObject"/>');
    expect(x).toContain('Requires="p159"');
    expect(x).toContain('<mc:Fallback><p:transition spd="slow"><p:fade/>');
    const { back } = await roundTrip({ kind: 'morph', dur: 1.5 }, () => []);
    expect(back.slides[0].transition).toEqual({ kind: 'morph', dur: 1.5 });
  });

  it('pairs the same things on two slides, the title with the title', () => {
    const box = (x: number) => ({ x1: x, y1: 0, x2: x + 10, y2: 10 });
    const a = [
      { kind: 'text', key: 'Route A', role: 'title', box: box(0) },
      { kind: 'drawing', key: '6,6,8|2|0|0', role: '', box: box(100) },
      { kind: 'shape geo', key: '', role: '', box: box(300) },
    ];
    const b = [
      { kind: 'shape geo', key: '', role: '', box: box(50) },
      { kind: 'text', key: 'Route B', role: 'title', box: box(0) },
      { kind: 'drawing', key: '6,6,8|2|0|0', role: '', box: box(400) },
      { kind: 'drawing', key: '7,6|1|0|0', role: '', box: box(110) },
    ];
    const pairs = morphPairs(a, b);
    expect(pairs).toContainEqual([1, 2]);
    expect(pairs).toContainEqual([0, 1]);
    expect(pairs).toContainEqual([2, 0]);
    // a new structure fades in
    expect(pairs.some((p) => p[1] === 3)).toBe(false);
  });

  it('reads a slide with no transition as none', () => {
    const doc = new DOMParser().parseFromString('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>', 'application/xml');
    expect(readTransition(doc.documentElement, () => {})).toBeUndefined();
  });
});
