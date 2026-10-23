// @vitest-environment jsdom
//
// Picture Format: the pixel work (brightness and contrast, recolouring, see-through, sharpening,
// Remove Background), and the settings saved as PowerPoint's and Word's own and read back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc, type PictureFx } from '../src/model';
import { Deck } from '../src/deck/deck';
import { brightContrast, clearColour, fade, recolor, removeBackground, sharpen, tidyFx, bakedPart, SEPIA_LIGHT, knownShape } from '../src/render/picture-fx';
import { blipEffectsXml, imgPropsXml, readPictureFx } from '../src/io/picture-xml';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, runStyleOf } from '../src/document/document';
import { aspectCrop } from '../src/ui/picture-dialog';

const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 3]);

/** w × h pixels of one colour. */
function pixels(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4);
  return d;
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('changing the pixels', () => {
  it('brightens, darkens and stretches contrast round the middle', () => {
    const d = new Uint8ClampedArray([100, 128, 200, 255]);
    brightContrast(d, 0.2, 0);
    expect(Array.from(d)).toEqual([151, 179, 251, 255]);
    const e = new Uint8ClampedArray([100, 128, 200, 255]);
    brightContrast(e, 0, 0.5);
    // further from the middle grey, the middle itself stays
    expect(e[0]).toBeLessThan(100);
    expect(Math.abs(e[1] - 128)).toBeLessThanOrEqual(1);
    expect(e[2]).toBe(255);
    const f = new Uint8ClampedArray([0, 255, 128, 255]);
    brightContrast(f, 0, -1);
    expect(Array.from(f.slice(0, 3))).toEqual([128, 128, 128]);
  });

  it('recolours: greys, black and white, two colours, sepia', () => {
    const red = () => new Uint8ClampedArray([200, 40, 40, 255]);
    const g = red();
    recolor(g, { kind: 'grey' });
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    const bw = red();
    recolor(bw, { kind: 'bw' });
    expect(Array.from(bw)).toEqual([0, 0, 0, 255]);
    const bw2 = red();
    recolor(bw2, { kind: 'bw', level: 0.2 });
    expect(Array.from(bw2)).toEqual([255, 255, 255, 255]);
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    recolor(white, { kind: 'tint', dark: '#000080', light: '#ffcc00' });
    expect(Array.from(white)).toEqual([255, 204, 0, 255]);
    const s = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    recolor(s, { kind: 'sepia' });
    expect(Array.from(s.slice(4, 7))).toEqual([0, 0, 0]);
    expect('#' + Array.from(s.slice(0, 3)).map((v) => v.toString(16).padStart(2, '0')).join('')).toBe(SEPIA_LIGHT);
  });

  it('makes the picture, or one colour of it, see-through', () => {
    const d = new Uint8ClampedArray([10, 20, 30, 200, 255, 255, 255, 255, 250, 252, 255, 255]);
    fade(d, 0.5);
    expect([d[3], d[7]]).toEqual([100, 128]);
    expect(clearColour(d, '#ffffff')).toBe(2);
    expect([d[3], d[7], d[11]]).toEqual([100, 0, 0]);
  });

  it('sharpens an edge and softens it', () => {
    const row = () => { const d = pixels(6, 3, [50, 50, 50, 255]); for (let y = 0; y < 3; y++) for (let x = 3; x < 6; x++) d.set([200, 200, 200, 255], (y * 6 + x) * 4); return d; };
    const sharp = row();
    sharpen(sharp, 6, 3, 1);
    expect(px(sharp, 6, 2, 1)[0]).toBeLessThan(50);
    expect(px(sharp, 6, 3, 1)[0]).toBeGreaterThan(200);
    const soft = row();
    sharpen(soft, 6, 3, -1);
    expect(px(soft, 6, 2, 1)[0]).toBeGreaterThan(50);
    expect(px(soft, 6, 3, 1)[0]).toBeLessThan(200);
  });
});

describe('Remove Background', () => {
  /** A white picture with a red square in the middle and a white hole inside a black ring at the right. */
  function scene(): { d: Uint8ClampedArray; w: number; h: number } {
    const w = 30, h = 20;
    const d = pixels(w, h, [255, 255, 255, 255]);
    for (let y = 5; y < 15; y++) for (let x = 3; x < 12; x++) d.set([220, 30, 30, 255], (y * w + x) * 4);
    for (let y = 4; y < 16; y++) for (let x = 16; x < 28; x++) if (y === 4 || y === 15 || x === 16 || x === 27) d.set([0, 0, 0, 255], (y * w + x) * 4);
    return { d, w, h };
  }

  it('takes out what joins the edges, keeping the subject and enclosed white', () => {
    const { d, w, h } = scene();
    const n = removeBackground(d, w, h, {});
    expect(n).toBeGreaterThan(200);
    expect(px(d, w, 0, 0)[3]).toBe(0);
    expect(px(d, w, 7, 10)[3]).toBe(255);
    expect(px(d, w, 22, 10)[3]).toBe(255); // inside the ring
    expect(px(d, w, 16, 10)[3]).toBeGreaterThan(0); // the ring stays (softened at its edge)
  });

  it('removes what is marked to go, and keeps what is marked to stay', () => {
    const { d, w, h } = scene();
    removeBackground(d, w, h, { drop: [[22 / w, 10 / h]] });
    expect(px(d, w, 22, 10)[3]).toBe(0);
    const s = scene();
    // a mark to keep protects white joined to the edges
    removeBackground(s.d, s.w, s.h, { keep: [[0.5 / s.w, 0.5 / s.h]], tol: 0.05 });
    expect(px(s.d, s.w, 0, 0)[3]).toBe(255);
  });

  it('only works inside the part shown', () => {
    const { d, w, h } = scene();
    removeBackground(d, w, h, {}, { x0: 0, y0: 0, x1: 14, y1: h });
    expect(px(d, w, 1, 1)[3]).toBe(0);
    expect(px(d, w, 29, 1)[3]).toBe(255);
  });
});

describe('settings', () => {
  it('drops settings at rest and keeps the ones Office works into the picture apart', () => {
    expect(tidyFx({ bright: 0, contrast: 0, shape: 'rect' })).toBeUndefined();
    expect(tidyFx({ bright: 0.3, alpha: 0 })).toEqual({ bright: 0.3 });
    expect(bakedPart({ bright: 0.3, sharpen: 0.5, bg: {} })).toEqual({ sharpen: 0.5, bg: {} });
    expect(bakedPart({ bright: 0.3 })).toBeUndefined();
    expect(knownShape('ellipse')).toBe(true);
    expect(knownShape('star32')).toBe(false);
  });

  it('crops to proportions, centred', () => {
    expect(aspectCrop(400, 200, 1)).toEqual({ l: 0.25, t: 0, r: 0.25, b: 0 });
    expect(aspectCrop(200, 400, 1)).toEqual({ l: 0, t: 0.25, r: 0, b: 0.25 });
    const c = aspectCrop(400, 300, 16 / 9);
    expect((400 * (1 - c.l - c.r)) / (300 * (1 - c.t - c.b))).toBeCloseTo(16 / 9, 5);
  });
});

/** An a:blip with these children, as an element. */
function blip(inner: string): Element {
  const doc = new DOMParser().parseFromString(`<a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1">${inner}</a:blip>`, 'application/xml');
  return doc.documentElement;
}
function spPr(prst: string): Element {
  return new DOMParser().parseFromString(`<p:spPr xmlns:p="p" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="${prst}"/></p:spPr>`, 'application/xml').documentElement;
}

describe('as Office keeps them', () => {
  const live: PictureFx[] = [
    { bright: 0.2, contrast: -0.4 },
    { recolor: { kind: 'grey' }, alpha: 0.35 },
    { recolor: { kind: 'sepia' } },
    { recolor: { kind: 'washout' }, bright: 0.1 },
    { recolor: { kind: 'bw', level: 0.3 } },
    { recolor: { kind: 'bw' } },
    { recolor: { kind: 'tint', dark: '#1f3864', light: '#ddebf7' }, clear: '#ffffff' },
  ];
  for (const fx of live) {
    it(`writes and reads ${JSON.stringify(fx)}`, () => {
      const got = readPictureFx(blip(blipEffectsXml(fx)), null);
      expect(got.fx).toEqual(fx);
      expect(got.dropped).toBe(false);
    });
  }

  it('lists sharpening and Remove Background on the original layer, and the shape as the geometry', () => {
    const fx: PictureFx = { sharpen: -0.25, bg: { keep: [[0.5, 0.25]], drop: [[0.1, 0.9]] } };
    const xml = `<a:extLst>${imgPropsXml(fx, 'rId7', { l: 0.1, t: 0, r: 0, b: 0 })}</a:extLst>`;
    expect(xml).toContain('backgroundRemoval t="0" b="100000" l="10000" r="100000"');
    const got = readPictureFx(blip(xml), spPr('ellipse'));
    expect(got.layer).toBe('rId7');
    expect(got.fx).toEqual({ ...fx, shape: 'ellipse' });
  });

  it('notes effects it does not keep', () => {
    expect(readPictureFx(blip('<a:hsl sat="20000"/>'), null).dropped).toBe(true);
    expect(readPictureFx(blip('<a:grayscl/>'), spPr('roundRect')).fx).toEqual({ recolor: { kind: 'grey' } });
  });
});

describe('PowerPoint files', () => {
  const opts: PptxOptions = {
    async picture() { return null; },
    async svgToPng() { return PNG; },
    // stands in for the picture with its sharpening and background worked in
    async bakePicture() { return PNG; },
  };

  it('keep the settings, the shape and the original picture', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('blank');
    const fx: PictureFx = { bright: 0.25, recolor: { kind: 'grey' }, alpha: 0.2, shape: 'ellipse', sharpen: 0.5, bg: { tol: 0.2, keep: [[0.5, 0.5]] } };
    host.edit('Picture', () => host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 300, y2: 200, src: DOT, px: { w: 1, h: 1 }, crop: { l: 0.1, t: 0, r: 0, b: 0 }, fx }));
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
    const files = unzipSync(bytes);
    const slide = strFromU8(files['ppt/slides/slide2.xml']);
    expect(slide).toContain('<a:lum bright="25000"/>');
    expect(slide).toContain('<a:grayscl/>');
    expect(slide).toContain('<a:alphaModFix amt="80000"/>');
    expect(slide).toContain('<a:prstGeom prst="ellipse">');
    // PowerPoint refuses a PNG as the blip's layer, so the original is kept beside the picture
    expect(slide).not.toContain('a14:imgProps');
    const back = readPptx(bytes);
    const pic = back.slides[1].contents.shapes.find((s) => s.kind === 'picture')!;
    expect(pic.fx).toEqual(fx);
    // the original came back, not the one with the effects worked in
    expect(pic.src).toBe(DOT);
    expect(pic.crop).toEqual({ l: 0.1, t: 0, r: 0, b: 0 });
  });

  it('leave worked-in effects alone when the original is missing', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    host.edit('Picture', () => host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 300, y2: 200, src: DOT, px: { w: 1, h: 1 }, fx: { sharpen: 0.5, contrast: 0.1 } }));
    // no way to work them in: the live ones are still saved
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, { ...opts, bakePicture: undefined });
    const pic = readPptx(bytes).slides[0].contents.shapes.find((s) => s.kind === 'picture')!;
    expect(pic.fx).toEqual({ contrast: 0.1 });
  });
});

describe('Word files', () => {
  const deps: DocxDeps = {
    async picture() { return null; },
    async svgToPng() { return PNG; },
    async bakePicture() { return PNG; },
  };

  it('keep a picture\'s crop and settings', async () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const fx: PictureFx = { contrast: 0.3, recolor: { kind: 'tint', dark: '#102030', light: '#f0e0d0' }, clear: '#ffffff', shape: 'hexagon', bg: { tol: 0.3 } };
    d.objects = { 1: { kind: 'picture', src: DOT, w: 40, h: 30, px: { w: 1, h: 1 }, crop: { l: 0, t: 0.2, r: 0, b: 0.1 }, fx } };
    d.runs = [objectRun(1, n)];
    const bytes = await writeDocx(d, deps);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('<a:srcRect l="0" t="20000" r="0" b="10000"/>');
    expect(xml).toContain('<a:prstGeom prst="hexagon">');
    expect(xml).toContain('a14:backgroundRemoval');
    const { doc, warnings } = await readDocx(bytes);
    expect(warnings).toEqual([]);
    const pic = Object.values(doc.objects).find((o) => o.kind === 'picture');
    expect(pic).toMatchObject({ kind: 'picture', src: DOT, w: 40, h: 30, crop: { l: 0, t: 0.2, r: 0, b: 0.1 }, fx });
  });
});
