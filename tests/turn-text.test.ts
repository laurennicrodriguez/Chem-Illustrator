// @vitest-environment jsdom
//
// Turned text boxes: they turn with the selection (in Slides, or when only text is selected),
// keep their turn in CDXML and PowerPoint files, and come out turned in vector pictures.

import { describe, it, expect } from 'vitest';
import { Doc, Caption } from '../src/model';
import { Deck } from '../src/deck/deck';
import { turnAbout, turnedCorners, normDegrees } from '../src/geom';
import { POINTS, snapshot, transform, rotation } from '../src/editor/arrange';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { PackageReader, NS } from '../src/io/ooxml';
import { VectorContext } from '../src/render/vector';
import { DEG } from '../src/geom';

const sel = (captions: number[]) => ({ atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set(captions), arrows: new Set<number>(), shapes: new Set<number>() });

describe('turning points', () => {
  it('turns clockwise on the page (y down)', () => {
    const p = turnAbout({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
    expect(turnedCorners({ x1: 0, y1: 0, x2: 10, y2: 0 }, { x: 0, y: 0 }, 180)[1].x).toBeCloseTo(-10);
    expect(normDegrees(270)).toBe(-90);
    expect(normDegrees(-180)).toBe(180);
  });
});

describe('turning the selection', () => {
  it('turns text that turns about its start, and moves text that stays level', () => {
    const doc = new Doc();
    let a = 0, b = 0;
    doc.edit('add', () => {
      a = doc.addCaption({ x: 10, y: 0, runs: [{ text: 'turns' }], justify: 'left' }).id;
      b = doc.addCaption({ x: -10, y: 0, runs: [{ text: 'level' }], justify: 'left', attach: { atom: 1, side: 'below' } } as unknown as Omit<Caption, 'id'>).id;
    });
    const snap = snapshot(doc, sel([a, b]), POINTS);
    doc.edit('turn', () => transform(doc, snap, rotation({ x: 0, y: 0 }, 90 * DEG), false, { deg: 90, which: (c) => !c.attach }));
    const ca = doc.captions.get(a)!, cb = doc.captions.get(b)!;
    expect(ca.rot).toBe(90);
    expect(ca.x).toBeCloseTo(0);
    expect(ca.y).toBeCloseTo(10);
    expect(cb.rot).toBeUndefined();
    // turning back to level leaves no turn behind
    const snap2 = snapshot(doc, sel([a]), POINTS);
    doc.edit('turn', () => transform(doc, snap2, rotation({ x: 0, y: 0 }, -90 * DEG), false, { deg: -90, which: () => true }));
    expect(doc.captions.get(a)!.rot).toBeUndefined();
  });

  it('leans the other way in a mirror image', () => {
    const doc = new Doc();
    let a = 0;
    doc.edit('add', () => { a = doc.addCaption({ x: 0, y: 0, runs: [{ text: 'x' }], justify: 'left', rot: 30 }).id; });
    const snap = snapshot(doc, sel([a]), POINTS);
    doc.edit('flip', () => transform(doc, snap, (p) => ({ x: -p.x, y: p.y }), true));
    expect(doc.captions.get(a)!.rot).toBe(-30);
  });
});

describe('files', () => {
  it('keeps the turn in CDXML (a hidden tag; ChemDraw shows the text level)', () => {
    const doc = new Doc();
    doc.edit('add', () => doc.addCaption({ x: 50, y: 60, runs: [{ text: 'Pd/C, H2' }], justify: 'left', rot: -45 }));
    const xml = writeCdxml(doc);
    expect(xml).toContain('Name="Chem Illustrator turn" Value="-45"');
    const back = [...readCdxml(xml).doc.captions.values()][0];
    expect(back.rot).toBe(-45);
    expect(back.x).toBeCloseTo(50, 1);
    expect(back.y).toBeCloseTo(60, 1);
  });

  const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };

  it('turns the text box in PowerPoint and reads it back where it was', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('blank');
    host.edit('Text', () => host.addCaption({ x: 300, y: 200, runs: [{ text: 'Turned note' }], justify: 'left', rot: 30 }));
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
    const xml = new PackageReader(bytes).xml('ppt/slides/slide2.xml')!;
    const xf = Array.from(xml.getElementsByTagNameNS(NS.a, 'xfrm')).find((x) => x.getAttribute('rot'));
    expect(xf?.getAttribute('rot')).toBe(String(30 * 60000));
    const back = readPptx(bytes);
    expect(back.warnings).toEqual([]);
    const c = back.slides[1].contents.captions.find((k) => k.runs.some((r) => r.text === 'Turned note'))!;
    expect(c.rot).toBe(30);
    expect(c.x).toBeCloseTo(300, 1);
    expect(c.y).toBeCloseTo(200, 1);

    // turned further in PowerPoint (its tag no longer matches the turn): the text follows
    const pkg = new PackageReader(bytes);
    const slide = pkg.text('ppt/slides/slide2.xml')!.replace(`rot="${30 * 60000}"`, `rot="${120 * 60000}"`);
    const { Package } = await import("../src/io/ooxml");
    const p2 = new Package();
    for (const name of pkg.names()) p2.add(name, name === 'ppt/slides/slide2.xml' ? new TextEncoder().encode(slide) : pkg.bytes(name)!);
    const again = readPptx(p2.build());
    const c2 = again.slides[1].contents.captions.find((k) => k.runs.some((r) => r.text === 'Turned note'))!;
    expect(c2.rot).toBe(120);
    // the box's middle stays put, so the text's start goes round it: the same distance from it
    const off = xf!.getElementsByTagNameNS(NS.a, 'off')[0], ext = xf!.getElementsByTagNameNS(NS.a, 'ext')[0];
    const emu = (e: Element, k: string) => Number(e.getAttribute(k)) / 12700;
    const mid = { x: emu(off, 'x') + emu(ext, 'cx') / 2, y: emu(off, 'y') + emu(ext, 'cy') / 2 };
    expect(Math.hypot(c2.x - mid.x, c2.y - mid.y)).toBeCloseTo(Math.hypot(c.x - mid.x, c.y - mid.y), 1);
    // and has gone a further 90° round it
    const back90 = turnAbout(c2, mid, -90);
    expect(back90.x).toBeCloseTo(c.x, 1);
    expect(back90.y).toBeCloseTo(c.y, 1);
  });
});

describe('vector pictures', () => {
  it('records turned text turned, at the turned place', () => {
    const v = new VectorContext();
    v.save();
    v.translate(10, 0);
    v.rotate(90 * DEG);
    v.translate(-10, 0);
    v.fillText('A', 20, 0);
    v.fillRect(10, 0, 10, 0);
    v.restore();
    v.fillText('B', 0, 0);
    const [a, r, b] = v.items;
    expect(a.kind === 'text' && a.x).toBeCloseTo(10);
    expect(a.kind === 'text' && a.y).toBeCloseTo(10);
    // (anticlockwise degrees: a clockwise turn of 90 reads downwards)
    expect(a.kind === 'text' && a.angle).toBeCloseTo(-90);
    expect(r.kind === 'path' && r.segs[2].k === 'L' && r.segs[2].y).toBeCloseTo(10);
    expect(b.kind === 'text' && b.angle).toBeUndefined();
  });
});
