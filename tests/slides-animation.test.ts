// @vitest-environment jsdom
//
// Slide transitions and animations: their timing, and going to PowerPoint and back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { highlightParts } from '../src/deck/animation';
import {
  buildSteps, partStates, clickCount, newAnim, animName, slideParts, partOf, targetOf, transitionXml,
  type Anim, type Transition,
} from '../src/deck/animation';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

const shape = (id: number) => ({ kind: 'shape' as const, id });
const anim = (id: number, a: Partial<Anim> = {}): Anim => ({ ...newAnim(shape(id), 'fade'), ...a });

describe('animation timing', () => {
  it('starts a new click at each "On Click" animation', () => {
    const steps = buildSteps([anim(1), anim(2, { start: 'with' }), anim(3), anim(4, { start: 'after' })]);
    expect(steps.length).toBe(2);
    expect(steps[0].items.map((i) => i.start)).toEqual([0, 0]);
    // "After Previous" waits for what came before it in the click to finish
    expect(steps[1].items[1].start).toBeCloseTo(0.5);
    expect(steps[1].length).toBeCloseTo(1);
    expect(clickCount([anim(1), anim(2)])).toBe(2);
  });

  it('plays a first animation that does not wait for a click as the slide comes in', () => {
    const steps = buildSteps([anim(1, { start: 'after', delay: 0.25 }), anim(2)]);
    expect(steps[0].auto).toBe(true);
    expect(steps[0].items[0].start).toBeCloseTo(0.25);
    expect(clickCount([anim(1, { start: 'with' }), anim(2)])).toBe(1);
  });

  it('times "With Previous" from the start of its group, plus its own delay', () => {
    const steps = buildSteps([anim(1, { delay: 0.3 }), anim(2, { start: 'with', delay: 0.1 })]);
    expect(steps[0].items[1].start).toBeCloseTo(0.1);
  });

  it('hides parts that come in until their click, and shows parts that go out', () => {
    const doc = new Doc();
    let a!: { id: number }, b!: { id: number };
    doc.bulk(() => {
      a = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 50, y2: 50 });
      b = doc.addShape({ kind: 'rect', x1: 200, y1: 0, x2: 250, y2: 50 });
    });
    const parts = slideParts(doc);
    const anims = [anim(a.id), newAnim(shape(b.id), 'fade', true)];
    anims[1].start = 'click';
    const pa = partOf(parts, shape(a.id))!, pb = partOf(parts, shape(b.id))!;
    let st = partStates(parts, anims, 0, -1);
    expect(st.get(pa)!.visible).toBe(false);
    expect(st.get(pb)!.visible).toBe(true);
    st = partStates(parts, anims, 0, 0.25);
    expect(st.get(pa)!.running!.p).toBeCloseTo(0.5);
    st = partStates(parts, anims, 2, -1);
    expect(st.get(pa)!.visible).toBe(true);
    expect(st.get(pb)!.visible).toBe(false);
  });

  it('names effects as PowerPoint does', () => {
    expect(animName(newAnim(shape(1), 'fly'))).toBe('Fly In');
    expect(animName(newAnim(shape(1), 'fly', true))).toBe('Fly Out');
    expect(animName(newAnim(shape(1), 'appear', true))).toBe('Disappear');
  });

  it('moves a reagent above an arrow with its whole scheme', () => {
    const doc = new Doc();
    doc.bulk(() => {
      const a1 = doc.addAtom(100, 100, 6), a2 = doc.addAtom(114, 108, 6);
      doc.addBond(a1.id, a2.id, 1);
      doc.addArrow({ tail: { x: 122, y: 104 }, head: { x: 180, y: 104 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 });
      doc.addCaption({ x: 140, y: 96, runs: [{ text: 'NaH' }] });
    });
    const parts = slideParts(doc);
    const cap = [...doc.captions.values()][0];
    const part = partOf(parts, { kind: 'caption', id: cap.id })!;
    expect(part.kind).toBe('drawing');
    expect(targetOf(part).kind).toBe("atom");
  });
});

describe('transitions and animations in PowerPoint files', () => {
  async function roundTrip(transition: Transition | undefined, anims: (ids: number[]) => Anim[]) {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setLayout('blank');
    const ids: number[] = [];
    host.edit('Things', () => {
      ids.push(host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 200, y2: 180, src: DOT, px: { w: 1, h: 1 } }).id);
      ids.push(host.addShape({ kind: 'rect', x1: 300, y1: 100, x2: 400, y2: 180 }).id);
      ids.push(host.addCaption({ x: 100, y: 300, runs: [{ text: 'Yield 92%' }] }).id);
    });
    const list = anims(ids);
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, transition, anims: list })) }, opts);
    return { xml: strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']), back: readPptx(bytes) };
  }

  it('writes a transition with its own length and a named speed for older PowerPoint', () => {
    const x = transitionXml({ kind: 'push', dir: 'up', dur: 1.2, advanceAfter: 5 });
    expect(x).toContain('p14:dur="1200"');
    expect(x).toContain('spd="slow"');
    expect(x).toContain('<p:push dir="u"/>');
    expect(x).toContain('advTm="5000"');
    expect(transitionXml({ kind: 'none', dur: 1 })).toBe('');
  });

  it('keeps transitions through PowerPoint and back', async () => {
    for (const t of [{ kind: 'fade', dur: 0.7 }, { kind: 'wipe', dir: 'down', dur: 2 }, { kind: 'cover', dir: 'right', dur: 0.5, advanceAfter: 3 }] as Transition[]) {
      const { back } = await roundTrip(t, () => []);
      expect(back.slides[0].transition).toEqual(t);
    }
  });

  it('keeps animations through PowerPoint and back', async () => {
    const { xml, back } = await roundTrip(undefined, ([pic, box, text]) => [
      { ...newAnim({ kind: 'shape', id: pic }, 'fade'), dur: 0.8 },
      { ...newAnim({ kind: 'shape', id: box }, 'fly'), from: 'left', start: 'with', delay: 0.2 },
      { ...newAnim({ kind: 'caption', id: text }, 'wipe'), from: 'top', start: 'after' },
      { ...newAnim({ kind: 'shape', id: pic }, 'appear', true) },
    ]);
    expect(xml).toContain('nodeType="mainSeq"');
    expect(xml).toContain('presetClass="exit"');
    const got = back.slides[0].anims!;
    expect(got.map((a) => [a.effect, !!a.exit, a.start, a.from ?? null])).toEqual([
      ['fade', false, 'click', null], ['fly', false, 'with', 'left'], ['wipe', false, 'after', 'top'], ['appear', true, 'click', null],
    ]);
    expect(got[0].dur).toBeCloseTo(0.8);
    expect(got[1].delay).toBeCloseTo(0.2);
    // each animation moves the object made from its PowerPoint shape
    const doc = new Doc();
    doc.restoreContents(back.slides[0].contents);
    expect(doc.shapes.get(got[0].target.id)?.kind).toBe('picture');
    expect(doc.shapes.get(got[1].target.id)?.kind).toBe('rect');
    expect(doc.captions.get(got[2].target.id)).toBeTruthy();
    expect(got[3].target).toEqual(got[0].target);
  });

  it('writes a highlight animated on its own as a picture under its structure, and finds it again', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setLayout('blank');
    let lit: number[] = [];
    host.edit('Chain', () => {
      const a = [0, 1, 2, 3].map((i) => host.addAtom(200 + i * 26, 200 + (i % 2) * 15).id);
      for (let i = 0; i < 3; i++) host.addBond(a[i], a[i + 1]);
      lit = [a[1], a[2]];
      for (const id of lit) host.atoms.get(id)!.highlight = '#ffd400';
      for (const b of host.bonds.values()) if (lit.includes(b.a1) && lit.includes(b.a2)) b.highlight = '#ffd400';
    });
    const doc = d.docOf(0);
    const all = { atoms: new Set(doc.atoms.keys()), bonds: new Set(doc.bonds.keys()), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
    const [h] = highlightParts(doc, all);
    const target = targetOf(h);
    expect(target.kind).toBe('highlight');
    const drawn: Doc[] = [];
    const pics: PptxOptions = {
      async picture(x) {
        drawn.push(x);
        const xs = [...x.atoms.values()];
        return { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', png: PNG, box: { x1: Math.min(...xs.map((a) => a.x)) - 5, y1: Math.min(...xs.map((a) => a.y)) - 5, x2: Math.max(...xs.map((a) => a.x)) + 5, y2: Math.max(...xs.map((a) => a.y)) + 5 } };
      },
      async svgToPng() { return PNG; },
    };
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, anims: [newAnim(target, 'fade')] })) }, pics);
    const xml = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
    // the highlight's own picture comes first (under the structure), and the animation moves it
    expect(xml.indexOf('name="Highlight')).toBeGreaterThan(-1);
    expect(xml.indexOf('name="Highlight')).toBeLessThan(xml.indexOf('name="Structure'));
    const hid = xml.match(/<p:cNvPr id="(\d+)" name="Highlight/)![1];
    expect(xml).toContain(`<p:spTgt spid="${hid}"/>`);
    // the structure's picture leaves the highlight off; the highlight's picture draws only it
    expect(drawn[0].onlyHighlights).toBe(false);
    expect([...drawn[0].atoms.values()].some((a) => a.highlight)).toBe(false);
    expect(drawn[1].onlyHighlights).toBe(true);
    // back from PowerPoint: one structure with its highlight, and the animation on the highlight
    const back = readPptx(bytes).slides[0];
    const again = new Doc();
    again.restoreContents(back.contents);
    expect(again.shapes.size).toBe(0);
    expect([...again.atoms.values()].filter((a) => a.highlight).length).toBe(2);
    const t = back.anims![0].target;
    expect(t.kind).toBe('highlight');
    expect(again.atoms.get(t.id)?.highlight).toBe('#ffd400');
  });

  it('leaves out animations of objects that have been deleted', async () => {
    const { xml, back } = await roundTrip(undefined, () => [newAnim({ kind: 'shape', id: 9999 }, 'fade')]);
    expect(xml).not.toContain('<p:timing>');
    expect(back.slides[0].anims).toBeUndefined();
  });

  it('copies transitions and animations with a duplicated slide, and undoes changes to them', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setTransition({ kind: 'fade', dur: 1 });
    d.setAnims([anim(5)]);
    d.duplicate();
    expect(d.slides[1].transition).toEqual({ kind: 'fade', dur: 1 });
    expect(d.slides[1].anims).toEqual([anim(5)]);
    expect(d.slides[1].anims).not.toBe(d.slides[0].anims);
    d.undo(); // the duplicate
    d.undo(); // the animation
    expect(d.slides[0].anims).toBeUndefined();
    d.undo();
    expect(d.slides[0].transition).toBeUndefined();
    d.redo();
    expect(d.slides[0].transition?.kind).toBe('fade');
  });
});

describe('playing animations', () => {
  it('wipes in from the side it starts at', async () => {
    const { wipeRect, flyOffset } = await import('../src/deck/playback');
    const b = { x1: 100, y1: 100, x2: 200, y2: 300 };
    expect(wipeRect(b, 'bottom', 0.25)).toEqual({ x1: 100, y1: 250, x2: 200, y2: 300 });
    expect(wipeRect(b, 'left', 0.5)).toEqual({ x1: 100, y1: 100, x2: 150, y2: 300 });
    // flying in from the bottom starts just below the slide
    expect(flyOffset(b, 'bottom', { w: 960, h: 540 })).toEqual({ x: 0, y: 440 });
    expect(flyOffset(b, 'left', { w: 960, h: 540 })).toEqual({ x: -200, y: 0 });
  });
});
