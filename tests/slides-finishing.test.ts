// @vitest-environment jsdom
//
// Office wave 5, Slides finishing touches: motion paths, triggers, the Animation Painter's
// copies and text that comes in a paragraph at a time, in the app and through PowerPoint
// files and back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import {
  newAnim, partStates, slideParts, partOf, presetPath, pathAt, pathPoints, reversePath, pathThrough, expandParas, splitParas, buildSteps, mainAnims, triggerSeqs, clickCount,
  type Anim,
} from '../src/deck/animation';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

/** A one-slide deck with a box, a button and a text box of three paragraphs, through PowerPoint and back. */
async function roundTrip(anims: (ids: { box: number; button: number; text: number }) => Anim[]) {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.setLayout('blank');
  const ids = { box: 0, button: 0, text: 0 };
  host.edit('Things', () => {
    ids.box = host.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 200, y2: 180, filled: true }).id;
    ids.button = host.addShape({ kind: 'oval', x1: 600, y1: 400, x2: 680, y2: 450, filled: true }).id;
    ids.text = host.addCaption({ x: 100, y: 300, runs: [{ text: 'Step one\nStep two\n\nStep three' }] }).id;
  });
  const list = anims(ids);
  const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, anims: list })) }, opts);
  const back = readPptx(bytes);
  return { xml: strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']), back, anims: back.slides[0].anims ?? [] };
}

describe('motion paths', () => {
  it('reads PowerPoint paths, and finds the point a part of the way along', () => {
    const pts = pathPoints('M 0 0 L 0.25 0 L 0.25 0.5 E');
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.25, y: 0.5 }]);
    const size = { w: 960, h: 540 };
    // 240 pt across then 270 down: half way (255 pt) is just round the corner
    const mid = pathAt('M 0 0 L 0.25 0 L 0.25 0.5 E', 0.5, size);
    expect(mid.x).toBeCloseTo(0.25);
    expect(mid.y * 540).toBeCloseTo(15, 0);
    expect(pathAt('M 0 0 L 0.25 0 L 0.25 0.5 E', 1, size)).toEqual({ x: 0.25, y: 0.5 });
    // curves are followed
    const arc = pathPoints(presetPath('arc', size));
    expect(arc.length).toBeGreaterThan(10);
    expect(Math.max(...arc.map((p) => p.y))).toBeGreaterThan(0.1);
    // a circle comes back to where it started
    const circle = pathPoints(presetPath('circle', size));
    expect(circle[circle.length - 1].x).toBeCloseTo(0);
    expect(circle[circle.length - 1].y).toBeCloseTo(0);
  });

  it('reverses a path and makes one through clicked points', () => {
    const r = pathPoints(reversePath('M 0 0 L 0.1 0 L 0.1 0.2 E'));
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[r.length - 1].x).toBeCloseTo(-0.1);
    expect(r[r.length - 1].y).toBeCloseTo(-0.2);
    expect(pathThrough([{ x: 100, y: 100 }, { x: 196, y: 154 }], { w: 960, h: 540 })).toBe('M 0 0 L 0.1 0.1 E');
  });

  it('leaves a part showing, moved along and kept where the path ends', () => {
    const doc = new Doc();
    let a!: { id: number };
    doc.bulk(() => { a = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 50, y2: 50 }); });
    const parts = slideParts(doc);
    const t = { kind: 'shape' as const, id: a.id };
    const go: Anim = { ...newAnim(t, 'path'), path: 'M 0 0 L 0.5 0 E', dur: 2 };
    const p = partOf(parts, t)!;
    const size = { w: 960, h: 540 };
    expect(partStates(parts, [go], 0, -1, undefined, size).get(p)?.visible ?? true).toBe(true);
    expect(partStates(parts, [go], 0, 1, undefined, size).get(p)!.emph!.dx).toBeCloseTo(0.25);
    // a second path goes on from where the first ended
    const more: Anim = { ...go, path: 'M 0 0 L 0 0.5 E' };
    const end = partStates(parts, [go, more], 2, -1, undefined, size).get(p)!.emph!;
    expect(end.dx).toBeCloseTo(0.5);
    expect(end.dy).toBeCloseTo(0.5);
  });

  it('keeps motion paths through PowerPoint and back', async () => {
    const { xml, anims } = await roundTrip(({ box }) => [{ ...newAnim({ kind: 'shape', id: box }, 'path'), path: 'M 0 0 L 0.2 0.1 E', dur: 1.5 }]);
    expect(xml).toContain('presetClass="path"');
    expect(xml).toContain('<p:animMotion origin="layout" path="M 0 0 L 0.2 0.1 E" pathEditMode="relative"');
    expect(anims).toHaveLength(1);
    expect(anims[0].effect).toBe('path');
    expect(anims[0].path).toBe('M 0 0 L 0.2 0.1 E');
    expect(anims[0].dur).toBeCloseTo(1.5);
  });
});

describe('triggers', () => {
  it('plays triggered animations only when their object is clicked', () => {
    const doc = new Doc();
    let box!: { id: number }, button!: { id: number };
    doc.bulk(() => {
      box = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 50, y2: 50 });
      button = doc.addShape({ kind: 'oval', x1: 100, y1: 0, x2: 150, y2: 50 });
    });
    const parts = slideParts(doc);
    const t = { kind: 'shape' as const, id: box.id };
    const anims: Anim[] = [{ ...newAnim(t, 'fade'), trigger: { kind: 'shape', id: button.id } }];
    // no clicks in the slide's own order
    expect(clickCount(anims)).toBe(0);
    expect(buildSteps(mainAnims(anims))).toHaveLength(0);
    expect(triggerSeqs(anims).size).toBe(1);
    const p = partOf(parts, t)!;
    expect(partStates(parts, anims, 0, -1).get(p)!.visible).toBe(false);
    const fired = new Map([[`shape ${button.id}`, { done: 1, t: -1 }]]);
    expect(partStates(parts, anims, 0, -1, fired).get(p)!.visible).toBe(true);
  });

  it('keeps triggers through PowerPoint and back', async () => {
    const { xml, anims } = await roundTrip(({ box, button }) => [
      newAnim({ kind: 'shape', id: box }, 'fly'),
      { ...newAnim({ kind: 'shape', id: box }, 'spin'), trigger: { kind: 'shape', id: button } },
    ]);
    expect(xml).toContain('nodeType="interactiveSeq"');
    expect(xml).toMatch(/<p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="\d+"\/><\/p:tgtEl><\/p:cond>/);
    expect(anims).toHaveLength(2);
    expect(anims[0].trigger).toBeUndefined();
    expect(anims[1].effect).toBe('spin');
    expect(anims[1].trigger?.kind).toBe('shape');
  });
});

describe('text a paragraph at a time', () => {
  it('makes an animation for each paragraph with text, and a part for each', () => {
    const doc = new Doc();
    let c!: { id: number };
    doc.bulk(() => { c = doc.addCaption({ x: 0, y: 20, runs: [{ text: 'One\nTwo\n\nThree' }] }); });
    const paras = (id: number) => { const x = doc.captions.get(id); return x ? x.runs.map((r) => r.text).join('').split('\n') : null; };
    const list = expandParas([{ ...newAnim({ kind: 'caption', id: c.id }, 'fade'), byPara: true }], paras);
    expect(list.map((a) => a.target.para)).toEqual([0, 1, 3]);
    expect(list.every((a) => a.start === 'click')).toBe(true);
    const parts = splitParas(slideParts(doc), list, () => 4);
    expect(parts.filter((p) => p.kind === 'text')).toHaveLength(4);
    const states = partStates(parts, list, 1, -1);
    expect(states.get(partOf(parts, list[0].target)!)!.visible).toBe(true);
    expect(states.get(partOf(parts, list[1].target)!)!.visible).toBe(false);
  });

  it('keeps it through PowerPoint and back', async () => {
    const { xml, anims } = await roundTrip(({ text }) => [{ ...newAnim({ kind: 'caption', id: text }, 'wipe'), byPara: true }]);
    expect(xml).toContain('<p:txEl><p:pRg st="0" end="0"/></p:txEl>');
    expect(xml).toContain('<p:pRg st="3" end="3"/>');
    expect(xml).not.toContain('<p:pRg st="2" end="2"/>');
    expect(xml).toMatch(/<p:bldP spid="\d+" grpId="0" build="p"\/>/);
    expect(anims).toHaveLength(1);
    expect(anims[0].byPara).toBe(true);
    expect(anims[0].effect).toBe('wipe');
  });
});

import { formatDate, showsDate, showsNumber, showsFooter, dateText } from '../src/deck/deck';
import { showOrder, showPrXml, readShowPr, type ShowSetup } from '../src/deck/show-setup';
import { wavBytes } from '../src/deck/narration';

describe('header and footer', () => {
  it('writes dates in PowerPoint\'s forms', () => {
    const d = new Date(2026, 9, 22, 15, 45, 12);
    expect(formatDate(d, 'datetime1')).toBe('10/22/2026');
    expect(formatDate(d, 'datetime2')).toBe('Thursday, October 22, 2026');
    expect(formatDate(d, 'datetime3')).toBe('22 October 2026');
    expect(formatDate(d, 'datetime5')).toBe('22-Oct-26');
    expect(formatDate(d, 'datetime8')).toBe('10/22/2026 3:45 PM');
    expect(formatDate(d, 'datetime10')).toBe('15:45');
    expect(dateText({ dateFixed: 'Group meeting' })).toBe('Group meeting');
  });

  it('shows what Apply and Apply to All say, title slides left out', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('title-content');
    expect(d.slides).toHaveLength(2);
    const m = { ...d.master, footer: 'Smith group', dateOn: true, dateFormat: 'datetime3' as const };
    d.setHeaderFooter(m, { number: true, footer: true, date: true });
    expect(showsDate(d.master, 'title-content')).toBe(true);
    expect(showsFooter(d.master, 'title-content')).toBe(true);
    // Apply: only the second slide loses its number
    d.setHeaderFooter(d.master, { number: false, footer: true, date: true }, [1]);
    expect(d.slides[1].hf).toEqual({ number: false, footer: true, date: true });
    expect(showsNumber(d.master, d.slides[1].layout, d.slides[1].hf)).toBe(false);
    d.undo();
    expect(d.slides[1].hf).toBeUndefined();
    // Don't show on title slide
    d.setHeaderFooter({ ...d.master, footerOffTitle: true, numberTitleSlides: false }, { number: true, footer: true, date: true });
    expect(showsDate(d.master, 'title')).toBe(false);
    expect(showsFooter(d.master, 'title')).toBe(false);
  });

  it('keeps the date, number and footer through PowerPoint and back, a slide\'s own say too', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('title-content');
    d.setHeaderFooter({ ...d.master, footer: 'Smith group', dateFormat: 'datetime2' }, { number: true, footer: true, date: true });
    d.setHeaderFooter(d.master, { number: false, footer: true, date: false }, [1]);
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, hf: s.hf })) }, opts);
    const files = unzipSync(bytes);
    const s2 = strFromU8(files['ppt/slides/slide2.xml']);
    const master = strFromU8(files['ppt/slideMasters/slideMaster1.xml']);
    expect(master).toContain('<p:ph type="dt" sz="half" idx="2"/>');
    expect(master).toContain('type="datetime2"');
    expect(s2).toContain('type="ftr"');
    expect(s2).not.toContain('type="sldNum"');
    expect(s2).not.toContain('type="dt"');
    const back = readPptx(bytes);
    expect(back.master.dateOn).toBe(true);
    expect(back.master.dateFormat).toBe('datetime2');
    expect(back.slides[1].hf).toEqual({ number: false, date: false });
    expect(back.slides[0].hf).toBeUndefined();
  });
});

describe('set up show and custom shows', () => {
  const slides = [{ id: 1 }, { id: 2, hidden: true }, { id: 3 }, { id: 4 }];
  it('plays a range, or a custom show in its order', () => {
    expect(showOrder(slides, { type: 'speaker' }, [])).toBeNull();
    expect(showOrder(slides, { type: 'speaker', from: 1, to: 3 }, [])).toEqual([0, 2]);
    expect(showOrder(slides, { type: 'speaker', custom: 7 }, [{ id: 7, name: 'Short', slides: [4, 1] }])).toEqual([3, 0]);
  });

  it('reads back the show settings PowerPoint keeps', () => {
    const setup: ShowSetup = { type: 'kiosk', noAnimation: true, from: 2, to: 3 };
    const xml = showPrXml(setup, []);
    expect(xml).toContain('<p:kiosk/>');
    expect(xml).toContain('loop="1"');
    expect(xml).toContain('<p:sldRg st="2" end="3"/>');
    expect(showPrXml({ type: 'speaker' }, [])).toBe('');
    const doc = new DOMParser().parseFromString(`<p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${xml}</p:presentationPr>`, 'application/xml');
    expect(readShowPr(doc.documentElement)).toEqual(setup);
  });

  it('keeps custom shows and Set Up Show through PowerPoint and back', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('title-content');
    d.addSlide('title-content');
    const ids = d.slides.map((s) => s.id);
    d.setSettings({ show: { type: 'window', manual: true, custom: 0 }, customShows: [{ id: 0, name: 'Short talk', slides: [ids[2], ids[0]] }] });
    const bytes = await writePptx({ size: d.size, master: d.master, settings: d.settings, slides: d.slides.map((s, i) => ({ id: s.id, layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
    const files = unzipSync(bytes);
    expect(strFromU8(files['ppt/presentation.xml'])).toContain('<p:custShowLst><p:custShow name="Short talk" id="0"><p:sldLst><p:sld r:id=');
    expect(strFromU8(files['ppt/presProps.xml'])).toContain('<p:browse/><p:custShow id="0"/>');
    const back = readPptx(bytes);
    expect(back.settings?.show).toEqual({ type: 'window', manual: true, custom: 0 });
    expect(back.settings?.customShows).toEqual([{ id: 0, name: 'Short talk', slides: [2, 0] }]);
    // a deck made from the file names the slides by their ids again
    const e = new Deck(new Doc());
    e.load(back.slides.map((s) => e.makeSlide(s.layout, s.contents, s.notes, s, back.master)), back.size, back.master, back.sections, back.settings);
    expect(e.settings.customShows![0].slides).toEqual([e.slides[2].id, e.slides[0].id]);
  });
});

describe('narration', () => {
  it('keeps recordings as WAV', () => {
    const w = wavBytes(new Float32Array([0, 0.5, -0.5, 1]), 22050);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE');
    expect(w.length).toBe(44 + 8);
    const v = new DataView(w.buffer);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getInt16(46, true)).toBe(16383);
  });

  it('marks a narration and leaves it out when the show is set up without narration', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    const wav = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...wavBytes(new Float32Array(10), 22050)));
    host.edit('Narration', () => {
      host.addShape({ kind: 'picture', x1: 900, y1: 500, x2: 924, y2: 524, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', px: { w: 1, h: 1 }, name: 'Narration', video: { src: wav, audio: true, start: 'auto', once: true, hide: true, narration: true } });
    });
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
    const back = readPptx(bytes);
    const sh = back.slides[0].contents.shapes.find((x) => x.video);
    expect(sh?.video?.narration).toBe(true);
    expect(sh?.video?.audio).toBe(true);
  });
});
