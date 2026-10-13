// @vitest-environment jsdom
//
// Saving slides as PowerPoint files: a complete, well-formed package, text PowerPoint can
// edit, structures as pictures that carry their drawing, and pictures with their cropping.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck, WIDE } from '../src/deck/deck';
import { writePptx, splitSlide, TAG, type DeckData, type PptxOptions } from '../src/io/pptx-write';
import { PackageReader, NS, REL, kid, rAttr, fromEmu } from '../src/io/ooxml';
import { readCdxml } from '../src/io/cdxml';
import { boxOf } from '../src/objects';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// a 1×1 PNG as a data URL, for pictures on slides
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Stand-ins for the app's drawing: a picture covering the drawing. */
const opts: PptxOptions = {
  async picture(doc) {
    const pts = [...doc.atoms.values()];
    if (!pts.length && !doc.arrows.size) return null;
    const b = pts.length ? boxOf(pts) : { x1: 0, y1: 0, x2: 10, y2: 10 };
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', png: PNG, box: { x1: b.x1 - 5, y1: b.y1 - 5, x2: b.x2 + 5, y2: b.y2 + 5 } };
  },
  async svgToPng() { return PNG; },
};

const ARROW = { headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 } as const;

/** Benzene-ish ring of six carbons centred at (x, y). */
function ring(doc: Doc, x: number, y: number): void {
  const L = doc.style.bondLength;
  const ids = Array.from({ length: 6 }, (_, i) => doc.addAtom(x + L * Math.cos((i * Math.PI) / 3), y + L * Math.sin((i * Math.PI) / 3)).id);
  ids.forEach((a, i) => doc.addBond(a, ids[(i + 1) % 6], i % 2 ? 2 : 1));
}

/** A small deck: a title slide, a slide with a scheme and a text box, and a picture slide with notes. */
function sample(): DeckData {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  const title = [...host.captions.values()].find((c) => c.ph === 'title')!;
  host.edit('Type', () => host.updateCaption(title.id, { runs: [{ text: 'Total synthesis & more' }] }));
  d.addSlide('title-only');
  host.edit('Scheme', () => {
    ring(host, 200, 300);
    host.addArrow({ tail: { x: 260, y: 300 }, head: { x: 340, y: 300 }, ...ARROW });
    ring(host, 400, 300);
    host.addCaption({ x: 270, y: 290, runs: [{ text: 'H2O', formula: true }], justify: 'left' }); // over the arrow
    host.addCaption({ x: 600, y: 450, runs: [{ text: 'A note far away' }], justify: 'left' });
    host.addShape({ kind: 'rect', x1: 700, y1: 100, x2: 800, y2: 160 });
  });
  d.addSlide('blank');
  host.edit('Picture', () => host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 300, y2: 200, src: DOT, px: { w: 1, h: 1 }, crop: { l: 0.1, t: 0, r: 0.2, b: 0 } }));
  d.setNotes('Mention the yield.\nThen the next step.');
  return { size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
}

const P = 'ppt/presentation.xml';
const els = (doc: Document, ns: string, name: string) => Array.from(doc.getElementsByTagNameNS(ns, name));

describe('PowerPoint files', () => {
  it('makes a complete package: every part readable, typed and reachable', async () => {
    const r = new PackageReader(await writePptx(sample(), opts));
    const ct = r.xml('[Content_Types].xml')!;
    const overrides = new Set(Array.from(ct.getElementsByTagName('Override')).map((o) => o.getAttribute('PartName')!.slice(1)));
    const defaults = new Set(Array.from(ct.getElementsByTagName('Default')).map((o) => o.getAttribute('Extension')!));
    // follow every relationship from the start, checking each target exists
    const seen = new Set<string>();
    const walk = (from: string) => {
      for (const rel of r.rels(from).values()) {
        if (rel.external) continue;
        expect(r.has(rel.target), `${from} → ${rel.target}`).toBe(true);
        if (seen.has(rel.target)) continue;
        seen.add(rel.target);
        const ext = rel.target.split('.').pop()!;
        expect(overrides.has(rel.target) || defaults.has(ext), `${rel.target} has a content type`).toBe(true);
        if (rel.target.endsWith('.xml')) {
          r.xml(rel.target); // throws if not well-formed
          walk(rel.target);
        }
      }
    };
    walk('');
    expect(seen.has(P)).toBe(true);
    // every slide, layout and the master are reachable
    for (const part of ['ppt/slides/slide1.xml', 'ppt/slides/slide3.xml', 'ppt/slideLayouts/slideLayout5.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/theme/theme1.xml', 'ppt/notesSlides/notesSlide3.xml']) {
      expect(seen.has(part), part).toBe(true);
    }
    // every content-type override names a real part
    for (const o of overrides) expect(r.has(o), o).toBe(true);
  });

  it('gives the slide size, slide list and master', async () => {
    const r = new PackageReader(await writePptx(sample(), opts));
    const pres = r.xml(P)!;
    const sz = els(pres, NS.p, 'sldSz')[0];
    expect(fromEmu(sz.getAttribute('cx'))).toBeCloseTo(WIDE.w);
    expect(fromEmu(sz.getAttribute('cy'))).toBeCloseTo(WIDE.h);
    const ids = els(pres, NS.p, 'sldId');
    expect(ids.length).toBe(3);
    expect(r.rels(P).get(rAttr(ids[1], 'id')!)!.target).toBe('ppt/slides/slide2.xml');
    // the master's settings travel in a tag for this program
    const tagsPart = r.rels(P).get(rAttr(els(pres, NS.p, 'tags')[0], 'id')!)!.target;
    const tag = els(r.xml(tagsPart)!, NS.p, 'tag')[0];
    expect(tag.getAttribute('name')).toBe(TAG.master);
    expect(JSON.parse(tag.getAttribute('val')!).titleSize).toBe(36);
  });

  it('writes titles as PowerPoint placeholders with their text', async () => {
    const r = new PackageReader(await writePptx(sample(), opts));
    const s1 = r.xml('ppt/slides/slide1.xml')!;
    const phs = els(s1, NS.p, 'ph').map((p) => p.getAttribute('type'));
    expect(phs).toContain('ctrTitle');
    expect(phs).toContain('subTitle');
    const text = els(s1, NS.a, 't').map((t) => t.textContent).join('|');
    expect(text).toContain('Total synthesis & more');
    // the slide uses the Title Slide layout
    expect(r.relOfType('ppt/slides/slide1.xml', REL.slideLayout)).toBe('ppt/slideLayouts/slideLayout1.xml');
    const layout = r.xml('ppt/slideLayouts/slideLayout1.xml')!;
    expect(layout.documentElement.getAttribute('type')).toBe('title');
  });

  it('saves a scheme as one picture carrying its drawing, and far text and boxes as PowerPoint shapes', async () => {
    const r = new PackageReader(await writePptx(sample(), opts));
    const path = 'ppt/slides/slide2.xml';
    const s2 = r.xml(path)!;
    const pics = els(s2, NS.p, 'pic');
    expect(pics.length).toBe(1);
    // PNG with an SVG PowerPoint shows instead
    const blip = els(pics[0], NS.a, 'blip')[0];
    expect(r.rels(path).get(rAttr(blip, 'embed')!)!.target).toMatch(/\.png$/);
    const svgBlip = blip.getElementsByTagNameNS('http://schemas.microsoft.com/office/drawing/2016/SVG/main', 'svgBlip')[0];
    expect(r.rels(path).get(rAttr(svgBlip, 'embed')!)!.target).toMatch(/\.svg$/);
    // the drawing comes back from the tag: two rings, the arrow and the formula over it
    const tagPart = r.rels(path).get(rAttr(els(pics[0], NS.p, 'tags')[0], 'id')!)!.target;
    const tags = Object.fromEntries(els(r.xml(tagPart)!, NS.p, 'tag').map((t) => [t.getAttribute('name'), t.getAttribute('val')]));
    const back = readCdxml(tags[TAG.cdxml]!).doc;
    expect(back.atoms.size).toBe(12);
    expect(back.bonds.size).toBe(12);
    expect(back.arrows.size).toBe(1);
    expect([...back.captions.values()].map((c) => c.runs.map((x) => x.text).join(''))).toEqual(['H2O']);
    expect(tags[TAG.box]!.split(' ').length).toBe(4);
    // the far caption is a PowerPoint text box, the rectangle a PowerPoint shape
    const sps = els(s2, NS.p, 'sp');
    const boxes = sps.filter((sp) => kid(sp, 'nvSpPr', 'cNvSpPr')?.getAttribute('txBox') === '1');
    expect(boxes.length).toBe(1);
    expect(els(boxes[0], NS.a, 't').map((t) => t.textContent).join('')).toBe('A note far away');
    expect(sps.some((sp) => els(sp, NS.a, 'prstGeom')[0]?.getAttribute('prst') === 'rect' && !kid(sp, 'txBody'))).toBe(true);
  });

  it('keeps a picture with its cropping, and the speaker notes', async () => {
    const r = new PackageReader(await writePptx(sample(), opts));
    const path = 'ppt/slides/slide3.xml';
    const s3 = r.xml(path)!;
    const pic = els(s3, NS.p, 'pic')[0];
    const src = els(pic, NS.a, 'srcRect')[0];
    expect(src.getAttribute('l')).toBe('10000');
    expect(src.getAttribute('r')).toBe('20000');
    const off = els(pic, NS.a, 'off')[0];
    expect(fromEmu(off.getAttribute('x'))).toBeCloseTo(100);
    const media = r.rels(path).get(rAttr(els(pic, NS.a, 'blip')[0], 'embed')!)!.target;
    expect(Array.from(r.bytes(media)!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const notes = r.relOfType(path, REL.notesSlide)!;
    const paras = els(r.xml(notes)!, NS.a, 'p').map((p) => els(p, NS.a, 't').map((t) => t.textContent).join(''));
    expect(paras).toContain('Mention the yield.');
    expect(paras).toContain('Then the next step.');
    // blank slides are numbered too
    expect(els(s3, NS.p, 'ph').some((p) => p.getAttribute('type') === 'sldNum')).toBe(true);
    // but not the title slide
    expect(els(r.xml('ppt/slides/slide1.xml')!, NS.p, 'ph').some((p) => p.getAttribute('type') === 'sldNum')).toBe(false);
  });

  it('writes formulas with real subscripts, and bullets as PowerPoint bullets', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('title-content');
    const body = [...host.captions.values()].find((c) => c.ph === 'body')!;
    host.edit('Type', () => host.updateCaption(body.id, { runs: [{ text: 'Made CO2\nThen ', }, { text: 'more', bold: true }], paras: [{ list: 'bullet' }, { list: 'bullet', level: 1 }] }));
    host.edit('Box', () => host.addCaption({ x: 50, y: 500, runs: [{ text: 'CH3CO2H', formula: true }], justify: 'left' }));
    const deckData: DeckData = { size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
    const r = new PackageReader(await writePptx(deckData, opts));
    const s2 = r.xml('ppt/slides/slide2.xml')!;
    const bodySp = els(s2, NS.p, 'sp').find((sp) => els(sp, NS.p, 'ph')[0]?.getAttribute('idx') === '1')!;
    const ps = els(bodySp, NS.a, 'p');
    expect(ps.length).toBe(2);
    expect(els(ps[0], NS.a, 'buChar').length).toBe(1);
    expect(els(ps[1], NS.a, 'pPr')[0].getAttribute('lvl')).toBe('1');
    expect(els(ps[1], NS.a, 'rPr').some((rp) => rp.getAttribute('b') === '1')).toBe(true);
    // the formula's digits are subscripts
    const box = els(s2, NS.p, 'sp').find((sp) => kid(sp, 'nvSpPr', 'cNvSpPr')?.getAttribute('txBox') === '1')!;
    const runs = els(box, NS.a, 'r').map((x) => [els(x, NS.a, 't')[0].textContent, els(x, NS.a, 'rPr')[0].getAttribute('baseline')]);
    expect(runs).toEqual([['CH', null], ['3', '-25000'], ['CO', null], ['2', '-25000'], ['H', null]]);
    // and its exact settings ride along for this program
    const tagPart = r.rels('ppt/slides/slide2.xml').get(rAttr(els(box, NS.p, 'tags')[0], 'id')!)!.target;
    const tag = els(r.xml(tagPart)!, NS.p, 'tag')[0];
    expect(tag.getAttribute('name')).toBe(TAG.text);
    expect(JSON.parse(tag.getAttribute('val')!).plain).toBe('CH3CO2H');
  });
});

describe('sorting a slide for PowerPoint', () => {
  it('groups structures with what touches them, and leaves the rest for PowerPoint', () => {
    const doc = new Doc();
    doc.bulk(() => {
      ring(doc, 100, 100);
      doc.addCaption({ x: 97, y: 100 + doc.style.bondLength + 12, runs: [{ text: '1' }], justify: 'left' }); // a compound number under it
      ring(doc, 400, 100); // a second, separate structure
      doc.addCaption({ x: 100, y: 400, runs: [{ text: 'Conditions' }], justify: 'left' });
      doc.addShape({ kind: 'oval', x1: 500, y1: 300, x2: 560, y2: 340 });
      doc.addShape({ kind: 'bracket', x1: 600, y1: 300, x2: 640, y2: 340, bracket: 'square' });
    });
    const parts = splitSlide(doc);
    expect(parts.drawings.length).toBe(3); // two structures (one with its number), and the bracket
    const withNumber = parts.drawings.find((s) => s.captions.size)!;
    expect(withNumber.atoms.size).toBe(6);
    expect(parts.texts.map((c) => c.runs[0].text)).toEqual(['Conditions']);
    expect(parts.shapes.map((s) => s.kind)).toEqual(['oval']);
  });

  it('keeps titles and text boxes as text even when they touch a structure', () => {
    const doc = new Doc();
    doc.bulk(() => {
      ring(doc, 100, 100);
      doc.addCaption({ x: 90, y: 110, runs: [{ text: 'Over it' }], justify: 'left', wrap: 100 });
    });
    const parts = splitSlide(doc);
    expect(parts.texts.length).toBe(1);
    expect(parts.drawings[0].captions.size).toBe(0);
  });
});

