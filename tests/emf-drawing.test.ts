// @vitest-environment jsdom
//
// The drawing that rides inside a copied picture: Word and PowerPoint keep a pasted metafile as
// it was, so a structure copied from here comes back as a structure (copied back out of them, or
// in a file saved by them), and still looks the same everywhere else.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { itemsToEmf, withDrawing, drawingInEmf } from '../src/render/emf';
import { emfToSvg } from '../src/render/emf-read';
import { VecPath } from '../src/render/vector';
import { dataUrl } from '../src/render/images';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { pictureDrawing, isOwnPicture } from '../src/io/clipboard';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf } from '../src/document/document';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { Deck } from '../src/deck/deck';

/** Ethanol with a charged O and a caption, as CDXML. */
function ethanol(): string {
  const doc = new Doc();
  doc.bulk(() => {
    const c1 = doc.addAtom(100, 100), c2 = doc.addAtom(112.5, 92.8), o = doc.addAtom(125, 100, 8, { charge: -1 });
    doc.addBond(c1.id, c2.id);
    doc.addBond(c2.id, o.id);
    doc.addCaption({ x: 95, y: 120, runs: [{ text: 'Ethoxide – 92 % ' }, { text: 'é', bold: true }], justify: 'left' });
  });
  return writeCdxml(doc, { name: 'Clipboard.cdxml' });
}

/** A small picture of a line and some text, as copied from here. */
function picture(): Uint8Array {
  const p = new VecPath();
  p.moveTo(10, 10); p.lineTo(40, 10);
  return itemsToEmf([
    { kind: 'path', segs: p.segs, stroke: { color: '#000000', width: 0.6, cap: 'round', join: 'round' } },
    { kind: 'text', text: 'OH', x: 42, y: 14, size: 10, family: 'Arial', bold: false, italic: false, color: '#000000', widths: [7.8, 7.2] },
  ], { x1: 0, y1: 0, x2: 60, y2: 20 });
}

describe('the drawing inside a copied picture', () => {
  it('comes back out exactly, and the picture looks the same', () => {
    const plain = picture(), cdxml = ethanol();
    const emf = withDrawing(plain, cdxml);
    expect(drawingInEmf(emf)).toBe(cdxml);
    expect(emfToSvg(emf)!.svg).toBe(emfToSvg(plain)!.svg);
    // the header still gives the file's size and one more record
    const v = new DataView(emf.buffer), w = new DataView(plain.buffer);
    expect(v.getUint32(48, true)).toBe(emf.length);
    expect(v.getUint32(52, true)).toBe(w.getUint32(52, true) + 1);
    expect(emf.length % 4).toBe(0);
  });

  it('finds nothing in other pictures, or in damaged ones', () => {
    const emf = withDrawing(picture(), ethanol());
    expect(drawingInEmf(picture())).toBeNull();
    expect(drawingInEmf(new Uint8Array(200))).toBeNull();
    expect(drawingInEmf(emf.slice(0, 200))).toBeNull();
    // not a metafile at all: left as it was
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(withDrawing(png, ethanol())).toBe(png);
  });

  it('pastes as the drawing, not a picture', () => {
    const doc = pictureDrawing(withDrawing(picture(), ethanol()), 'image/x-emf')!;
    expect(doc.atoms.size).toBe(3);
    expect([...doc.atoms.values()].find((a) => a.charge === -1)?.z).toBe(8);
    expect(doc.captions.size).toBe(1);
    expect(pictureDrawing(picture(), 'image/x-emf')).toBeNull();
    // a picture from somewhere else, with nothing copied here yet
    expect(isOwnPicture(new Uint8Array(24), 'image/png')).toBe(false);
  });
});

describe('Word and PowerPoint files', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
  const deps: DocxDeps = {
    async picture() { return { png: PNG, w: 80, h: 40 }; },
    async smiles(contents) { return contents.atoms.length ? 'CC[O-]' : null; },
  };

  it('opens a picture pasted into Word from here as a structure', async () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    d.objects = { 1: { kind: 'picture', src: dataUrl(withDrawing(picture(), ethanol()), 'image/x-emf'), w: 60, h: 20, px: { w: 80, h: 27 } } };
    d.runs = [objectRun(1, n)];
    d.paras = [paraFromStyle(d.styles.Normal, {})];
    const { doc } = await readDocx(await writeDocx(d, deps), { cdxml: (text) => readCdxml(text).doc.contents() });
    const o = Object.values(doc.objects)[0];
    expect(o.kind).toBe('drawing');
    if (o.kind === 'drawing') expect(o.contents.atoms.length).toBe(3);
    // without a way to read drawings it stays the picture it was
    const plain = await readDocx(await writeDocx(d, deps));
    expect(Object.values(plain.doc.objects)[0].kind).toBe('picture');
  });

  it('puts the SMILES in the alt text of structures', async () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    d.objects = { 1: { kind: 'drawing', contents: readCdxml(ethanol()).doc.contents() } };
    d.runs = [objectRun(1, n)];
    d.paras = [paraFromStyle(d.styles.Normal, {})];
    const xml = strFromU8(unzipSync(await writeDocx(d, deps))['word/document.xml']);
    expect(xml).toContain('descr="Chemical structure (SMILES): CC[O-]"');
    const none = strFromU8(unzipSync(await writeDocx(d, { picture: deps.picture }))['word/document.xml']);
    expect(none).toContain('descr="Chemical structure or scheme"');
  });

  it('does the same on slides', async () => {
    const host = new Doc();
    const deck = Deck.blank(host);
    deck.attach();
    deck.addSlide('blank');
    host.edit('Paste', () => host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 160, y2: 120, src: dataUrl(withDrawing(picture(), ethanol()), 'image/x-emf'), px: { w: 80, h: 27 } }));
    deck.addSlide('blank');
    const drawn = readCdxml(ethanol()).doc;
    host.edit('Draw', () => { for (const a of drawn.atoms.values()) host.addAtom(a.x, a.y, a.z); });
    const opts: PptxOptions = {
      async picture(doc) { return doc.atoms.size ? { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', png: PNG, box: { x1: 90, y1: 80, x2: 140, y2: 110 } } : null; },
      async svgToPng() { return PNG; },
      async smiles() { return 'CCO'; },
    };
    const bytes = await writePptx({ size: deck.size, master: deck.master, slides: deck.slides.map((s, i) => ({ layout: s.layout, doc: deck.docOf(i), notes: '' })) }, opts);
    const files = unzipSync(bytes);
    const slides = Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort();
    expect(strFromU8(files[slides[2]])).toContain('descr="Chemical structure (SMILES): CCO"');
    const back = readPptx(bytes);
    const pasted = back.slides[1].contents;
    expect(pasted.atoms.length).toBe(3);
    expect(pasted.shapes.some((s) => s.kind === 'picture')).toBe(false);
  });
});
