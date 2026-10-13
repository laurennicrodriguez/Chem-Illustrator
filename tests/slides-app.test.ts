// @vitest-environment jsdom
//
// The pieces of Slides mode around the deck: tabs for open files, pictures (their type, size
// and cropping), pasted drawings fitted to the slide master, and pictures kept in CDX files.

import { describe, it, expect } from 'vitest';
import { Doc, Shape } from '../src/model';
import { Workspace, WorkspaceHooks } from '../src/workspace';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { fitPasted, typicalBondLength, looksLikeChemistry, dibToBmp } from '../src/io/clipboard';
import { pictureMime, imageSize } from '../src/render/images';
import { cropTo } from '../src/objects';
import { ACS_1996 } from '../src/style';
import { slideDrawingStyle } from '../src/deck/deck';

// a 1×1 PNG
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0x2c, 0, 0, 0, 0xc8]);
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('picture files', () => {
  it('knows a picture by its first bytes, or else by its name', () => {
    expect(pictureMime('x', PNG_HEAD)).toBe('image/png');
    expect(pictureMime('x', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(pictureMime('x', new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(pictureMime('x', new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('image/bmp');
    const emf = new Uint8Array(88);
    emf[0] = 1;
    emf.set([0x20, 0x45, 0x4d, 0x46], 40);
    expect(pictureMime('spectrum', emf)).toBe('image/x-emf');
    expect(pictureMime('x', new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(pictureMime('photo.JPG', new Uint8Array(4))).toBe('image/jpeg');
    expect(pictureMime('notes.txt', new TextEncoder().encode('hello'))).toBeNull();
  });
  it('reads sizes from picture headers', () => {
    expect(imageSize(PNG_HEAD, 'image/png')).toEqual({ w: 300, h: 200 });
    const svg = new TextEncoder().encode('<svg viewBox="0 0 120.5 80" xmlns="http://www.w3.org/2000/svg"/>');
    expect(imageSize(svg, 'image/svg+xml')).toEqual({ w: 120.5, h: 80 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 40, 0, 30, 0, 0]);
    expect(imageSize(gif, 'image/gif')).toEqual({ w: 40, h: 30 });
  });
  it('turns a clipboard bitmap into a .bmp file', () => {
    // a 2×1 24-bit bitmap: header (40 bytes) and one row padded to 8 bytes
    const dib = new Uint8Array(48);
    const v = new DataView(dib.buffer);
    v.setUint32(0, 40, true);
    v.setInt32(4, 2, true);
    v.setInt32(8, 1, true);
    v.setUint16(12, 1, true);
    v.setUint16(14, 24, true);
    const bmp = dibToBmp(dib);
    const b = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe('BM');
    expect(b.getUint32(2, true)).toBe(14 + 48);
    expect(b.getUint32(10, true)).toBe(14 + 40);
  });
  it('tells structure text from other text', () => {
    expect(looksLikeChemistry('c1ccccc1O')).toBe(true);
    expect(looksLikeChemistry('C[C@H](N)C(=O)O')).toBe(true);
    expect(looksLikeChemistry('\n  RDKit\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END')).toBe(true);
    expect(looksLikeChemistry('Group meeting notes')).toBe(false);
    expect(looksLikeChemistry('')).toBe(false);
  });
});

describe('cropping a picture by numbers', () => {
  const pic = (extra: Partial<Shape> = {}): Shape => ({ id: 1, kind: 'picture', x1: 0, y1: 0, x2: 100, y2: 50, src: DOT, px: { w: 200, h: 100 }, ...extra });
  it('cuts an edge off and leaves the rest where it was', () => {
    const p = cropTo(pic(), { l: 0.25, t: 0, r: 0, b: 0.1 });
    expect(p.x1).toBeCloseTo(25);
    expect(p.x2).toBeCloseTo(100);
    expect(p.y1).toBeCloseTo(0);
    expect(p.y2).toBeCloseTo(45);
    expect(p.crop).toEqual({ l: 0.25, t: 0, r: 0, b: 0.1 });
  });
  it('uncrops back to the whole picture', () => {
    const cropped = { ...pic(), ...cropTo(pic(), { l: 0.25, t: 0.2, r: 0.1, b: 0 }) } as Shape;
    const back = cropTo(cropped, { l: 0, t: 0, r: 0, b: 0 });
    expect([back.x1, back.y1, back.x2, back.y2].map((v) => Math.round(v! * 1e6) / 1e6)).toEqual([0, 0, 100, 50]);
    expect(back.crop).toBeUndefined();
  });
  it('never crops a picture away completely', () => {
    const p = cropTo(pic(), { l: 0.7, t: 0, r: 0.7, b: 0 });
    expect(p.x2! - p.x1!).toBeGreaterThan(1);
  });
});

/** An ACS 1996 drawing as ChemDraw would paste it: ethane, a caption, an arrow. */
function acsDrawing(): Doc {
  const d = new Doc();
  d.style = { ...ACS_1996 };
  d.bulk(() => {
    const a = d.addAtom(0, 0), b = d.addAtom(14.4, 0, 8, { label: 'OH' });
    d.addBond(a.id, b.id);
    d.addCaption({ x: 0, y: 30, runs: [{ text: 'rt, ' }, { text: '2 h', size: 12 }], justify: 'left' });
    d.addArrow({ tail: { x: 30, y: 0 }, head: { x: 60, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 });
  });
  return d;
}

describe('pasting a drawing onto a slide', () => {
  const slide = slideDrawingStyle(2);
  it('measures the usual bond length', () => {
    expect(typicalBondLength(acsDrawing())).toBeCloseTo(14.4);
    expect(typicalBondLength(new Doc())).toBeNull();
  });
  it('resizes it to the slide master’s bond length, text and arrowheads with it', () => {
    const d = acsDrawing();
    fitPasted(d, slide, slide.bondLength);
    expect(typicalBondLength(d)).toBeCloseTo(28.8);
    const [o] = [...d.atoms.values()].filter((a) => a.label === 'OH');
    // labels and lines were drawn at the drawing's sizes, and are now at the slide's
    expect(o.s).toBeUndefined();
    const cap = [...d.captions.values()][0];
    expect(cap.y).toBeCloseTo(60);
    expect(cap.runs[0].size).toBeUndefined(); // 10 pt doubled is the slide's 20 pt
    expect(cap.runs[1].size).toBeCloseTo(24);
    const r = [...d.arrows.values()][0];
    expect(r.headLength).toBeCloseTo(12);
    expect(r.lineWidth).toBeUndefined();
    expect(d.style.bondLength).toBeCloseTo(28.8);
  });
  it('keeps its own size when asked to', () => {
    const d = acsDrawing();
    fitPasted(d, slide);
    expect(typicalBondLength(d)).toBeCloseTo(14.4);
    const [o] = [...d.atoms.values()].filter((a) => a.label === 'OH');
    expect(o.s).toBeCloseTo(0.5); // 10 pt labels in a 20 pt style
    const cap = [...d.captions.values()][0];
    expect(cap.runs[0].size).toBeCloseTo(10);
    expect([...d.arrows.values()][0].lineWidth).toBeCloseTo(0.6);
  });
  it('changes nothing between drawings in the same style', () => {
    const d = acsDrawing();
    const before = JSON.stringify(d.contents());
    fitPasted(d, { ...ACS_1996 });
    expect(JSON.stringify(d.contents())).toBe(before);
  });
});

describe('pictures in ChemDraw files', () => {
  it('come back from a CDX file', () => {
    const d = new Doc();
    d.bulk(() => d.addShape({ kind: 'picture', x1: 10, y1: 20, x2: 110, y2: 70, src: DOT, px: { w: 1, h: 1 } }));
    const text = writeCdxml(d, { name: 'x.cdxml', textMeasure: (t, s) => t.length * s * 0.5 });
    const back = readCdxml(cdxToCdxml(cdxmlToCdx(text))).doc;
    const pics = [...back.shapes.values()].filter((s) => s.kind === 'picture');
    expect(pics.length).toBe(1);
    expect(pics[0].src).toBe(DOT);
    expect([pics[0].x1, pics[0].y1, pics[0].x2, pics[0].y2]).toEqual([10, 20, 110, 70]);
  });
});

// ---------------------------------------------------------------- tabs

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const pptxOpts: Omit<PptxOptions, 'title'> = { async picture() { return null; }, async svgToPng() { return PNG; } };

function workspace() {
  const host = new Doc();
  const seen: string[] = [];
  const hooks: WorkspaceHooks = {
    leave: (t) => seen.push('leave ' + t.name),
    enter: (t) => seen.push('enter ' + t.name),
    changed: () => {},
    flash: () => {},
    pptx: pptxOpts,
    measure: (t, s) => t.length * s * 0.5,
  };
  return { host, ws: new Workspace(host, hooks), seen };
}

const titles = (doc: Doc) => [...doc.captions.values()].map((c) => c.runs.map((r) => r.text).join('')).filter(Boolean);

describe('tabs for open files', () => {
  it('starts with an empty drawing, which new slides replace', () => {
    const { ws } = workspace();
    expect(ws.tabs.map((t) => t.name)).toEqual(['Untitled.cdxml']);
    ws.newSlides();
    expect(ws.tabs.map((t) => [t.mode, t.name])).toEqual([['slides', 'Untitled.pptx']]);
  });
  it('keeps each tab’s drawing while another shows', () => {
    const { host, ws } = workspace();
    host.edit('Draw', () => host.addAtom(0, 0));
    ws.noteChange();
    const drawing = ws.active;
    expect(drawing.dirty).toBe(true);
    const slides = ws.newSlides();
    // the first drawing has changes, so it stays
    expect(ws.tabs.length).toBe(2);
    expect(host.atoms.size).toBe(0);
    expect(slides.deck!.isAttached).toBe(true);
    ws.activate(drawing);
    expect(host.atoms.size).toBe(1);
    expect(slides.deck!.isAttached).toBe(false);
    ws.cycle(1);
    expect(ws.active).toBe(slides);
    expect(host.captions.size).toBe(2); // the title slide's placeholders
  });
  it('marks a slide deck unsaved after an edit, and saved again after undoing it', () => {
    const { host, ws } = workspace();
    const t = ws.newSlides();
    host.edit('Draw', () => host.addAtom(5, 5));
    ws.noteChange();
    expect(t.dirty).toBe(true);
    t.savedEdits = t.deck!.edits; // as after saving
    ws.noteChange();
    expect(t.dirty).toBe(false);
  });
  it('opens PowerPoint and ChemDraw files in tabs of their own', async () => {
    const { ws } = workspace();
    // a deck saved by this program
    const host = new Doc();
    const deck = Deck.blank(host);
    deck.attach();
    const title = [...host.captions.values()].find((c) => c.ph === 'title')!;
    host.edit('Title', () => host.updateCaption(title.id, { runs: [{ text: 'Strychnine' }] }));
    deck.detach();
    const bytes = await writePptx({ size: deck.size, master: deck.master, slides: deck.slides.map((s, i) => ({ layout: s.layout, doc: deck.docOf(i), notes: 'Say hello' })) }, pptxOpts);
    expect(await ws.openBytes(bytes, 'Talk.pptx')).toBe(true);
    // the untouched drawing made way for it
    expect(ws.tabs.map((t) => t.name)).toEqual(['Talk.pptx']);
    expect(titles(ws.host)).toEqual(['Strychnine']);
    expect(ws.active.deck!.slides[0].notes).toBe('Say hello');
    expect(ws.active.dirty).toBe(false);
    // a drawing opens beside it
    const cd = new Doc();
    cd.bulk(() => { const a = cd.addAtom(0, 0); const b = cd.addAtom(14.4, 0); cd.addBond(a.id, b.id); });
    const text = writeCdxml(cd, { name: 'x.cdxml', textMeasure: (t, s) => t.length * s * 0.5 });
    expect(await ws.openBytes(new TextEncoder().encode(text), 'Ethane.cdxml')).toBe(true);
    expect(ws.tabs.map((t) => t.name)).toEqual(['Talk.pptx', 'Ethane.cdxml']);
    expect(ws.active.mode).toBe('drawing');
    expect(ws.host.atoms.size).toBe(2);
  });
  it('closes tabs, and keeps one drawing open when the last goes', async () => {
    const { ws } = workspace();
    ws.newDrawing();
    expect(ws.tabs.length).toBe(2);
    expect(await ws.close()).toBe(true);
    expect(ws.tabs.length).toBe(1);
    expect(await ws.close()).toBe(true);
    expect(ws.tabs.map((t) => [t.mode, t.name])).toEqual([['drawing', 'Untitled.cdxml']]);
  });
  it('names new tabs so they can be told apart', () => {
    const { host, ws } = workspace();
    host.edit('Draw', () => host.addAtom(0, 0));
    ws.noteChange();
    ws.newDrawing();
    host.edit('Draw', () => host.addAtom(0, 0));
    ws.noteChange();
    ws.newSlides();
    // a new deck that hasn't been touched yet stays when another is made
    ws.newSlides();
    expect(ws.tabs.map((t) => t.name).sort()).toEqual(['Untitled 2.cdxml', 'Untitled 2.pptx', 'Untitled.cdxml', 'Untitled.pptx']);
  });
});
