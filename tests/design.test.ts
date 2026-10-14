// @vitest-environment jsdom
//
// Design mode: the shape library's outlines, the design page, and designs saved as PowerPoint
// coming back as they were (and PowerPoint's own shapes coming in as library shapes).

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { Deck, DESIGN_SIZES, designScale } from '../src/deck/deck';
import { GEOS, GEO_BY_ID, geoDef, flatten, insideOutline, textArea } from '../src/design/geo';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { shapeHit, shapeOrder } from '../src/objects';
import { writeCdxml, chemDrawCurves } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

describe('the shape library', () => {
  it('has unique names, and every outline stays inside its box', () => {
    expect(new Set(GEOS.map((g) => g.id)).size).toBe(GEOS.length);
    for (const g of GEOS) {
      for (const [w, h] of [g.size, [100, 50], [30, 120]] as [number, number][]) {
        const o = g.draw(w, h);
        // (the curve itself, not its control points)
        const pts = [...flatten(o.body), ...(o.lines ? flatten(o.lines) : [])].flat();
        const b = { x1: Math.min(...pts.map((p) => p.x)), y1: Math.min(...pts.map((p) => p.y)), x2: Math.max(...pts.map((p) => p.x)), y2: Math.max(...pts.map((p) => p.y)) };
        const slack = 0.02 * Math.max(w, h) + 0.01;
        expect(b.x1, `${g.id} left`).toBeGreaterThanOrEqual(-slack);
        expect(b.y1, `${g.id} top`).toBeGreaterThanOrEqual(-slack);
        expect(b.x2, `${g.id} right`).toBeLessThanOrEqual(w + slack);
        expect(b.y2, `${g.id} bottom`).toBeLessThanOrEqual(h + slack);
        expect(o.body[0][0], `${g.id} starts with a move`).toBe('M');
      }
    }
  });

  it('puts text inside the shape', () => {
    for (const g of GEOS) {
      const a = textArea(g, 0, 0, 100, 80);
      expect(a.x1).toBeGreaterThanOrEqual(0);
      expect(a.y1).toBeGreaterThanOrEqual(0);
      expect(a.x2).toBeLessThanOrEqual(100);
      expect(a.y2).toBeLessThanOrEqual(80);
      expect(a.x2).toBeGreaterThan(a.x1);
    }
  });

  it('knows what is inside a shape and picks it there', () => {
    const polys = flatten(geoDef('fcDecision').draw(100, 60).body);
    expect(insideOutline(polys, { x: 50, y: 30 })).toBe(true);
    // a diamond's corners are outside it
    expect(insideOutline(polys, { x: 5, y: 5 })).toBe(false);
    const s: Shape = { id: 1, kind: 'geo', geo: 'fcDecision', x1: 0, y1: 0, x2: 100, y2: 60, filled: true };
    expect(shapeHit(s, { x: 50, y: 30 }, 2)).toBe(true);
    expect(shapeHit(s, { x: 4, y: 4 }, 2)).toBe(false);
  });

  it('falls back to a box for a shape it does not know', () => {
    expect(geoDef('no-such-shape').id).toBe('rect');
  });
});

describe('the design page', () => {
  it('has one blank page of the size chosen, with no slide numbers', () => {
    const host = new Doc();
    const d = Deck.design(host, { w: 234, h: 126 });
    expect(d.size).toEqual({ w: 234, h: 126 });
    expect(d.slides).toHaveLength(1);
    expect(d.slides[0].layout).toBe('blank');
    expect(d.master.slideNumbers).toBe(false);
  });

  it('draws structures larger on slides and posters', () => {
    expect(designScale(DESIGN_SIZES.find((s) => s.id === 'toc-acs')!.size)).toBe(1);
    expect(designScale(DESIGN_SIZES.find((s) => s.id === 'slide-wide')!.size)).toBe(2);
    expect(designScale(DESIGN_SIZES.find((s) => s.id === 'poster-a0')!.size)).toBe(4);
  });

  it('stacks shapes in the order chosen', () => {
    const a: Shape = { id: 1, kind: 'rect', x1: 0, y1: 0, x2: 1, y2: 1 };
    const b: Shape = { id: 2, kind: 'rect', x1: 0, y1: 0, x2: 1, y2: 1, filled: true };
    // as before: filled shapes behind outlines
    expect(shapeOrder([a, b]).map((s) => s.id)).toEqual([2, 1]);
    // brought to the front
    expect(shapeOrder([a, { ...b, z: 2 }, { ...a, z: 1 }].slice(1)).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('designs saved as PowerPoint', () => {
  async function save(shapes: Omit<Shape, 'id'>[]): Promise<Uint8Array> {
    const host = new Doc();
    const d = Deck.design(host, { w: 504, h: 288 });
    const doc = d.docOf(0);
    doc.edit('shapes', () => { for (const s of shapes) doc.addShape(s); });
    return writePptx({ size: d.size, master: d.master, slides: [{ layout: 'blank', doc, notes: '' }], design: true }, opts);
  }
  const slideXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
  const geos = (bytes: Uint8Array) => readPptx(bytes).slides[0].contents.shapes.filter((s) => s.kind === 'geo');

  const box: Omit<Shape, 'id'> = {
    kind: 'geo', geo: 'fcDecision', x1: 40, y1: 30, x2: 160, y2: 100, filled: true, fillColor: '#dae3f3', color: '#2f5597',
    text: { runs: [{ text: 'Pure by ' }, { text: 'TLC', bold: true }, { text: '?' }] }, transparency: 0.3, shadow: true,
  };
  const flask: Omit<Shape, 'id'> = { kind: 'geo', geo: 'labRbf', x1: 200, y1: 30, x2: 254, y2: 102, color: '#000000', lineWidth: 1.5 };

  it('uses PowerPoint\'s own shapes where it has them, and the outline for the others', async () => {
    const xml = slideXml(await save([box, flask]));
    expect(xml).toContain('prst="flowChartDecision"');
    expect(xml).toContain('<a:custGeom>');
    expect(xml).toContain('<a:alpha val="70000"/>');
    expect(xml).toContain('Pure by');
  });

  it('opens in Design mode with the shapes as they were', async () => {
    const bytes = await save([box, flask]);
    const back = readPptx(bytes);
    expect(back.design).toBe(true);
    expect(back.size).toEqual({ w: 504, h: 288 });
    const got = geos(bytes);
    expect(got).toHaveLength(2);
    const d = got.find((s) => s.geo === 'fcDecision')!;
    expect(d.text?.runs.map((r) => r.text).join('')).toBe('Pure by TLC?');
    expect(d.text?.runs[1].bold).toBe(true);
    expect(d.transparency).toBe(0.3);
    expect(d.shadow).toBe(true);
    expect([d.x1, d.y1, d.x2, d.y2].map((v) => Math.round(v))).toEqual([40, 30, 160, 100]);
    const f = got.find((s) => s.geo === 'labRbf')!;
    expect(f.lineWidth).toBe(1.5);
    expect(f.filled).toBeFalsy();
  });

  it('keeps text typed in PowerPoint, and where the shape was moved to', async () => {
    const bytes = await save([box]);
    const xml = slideXml(bytes)
      .replace('Pure by ', 'Clean by ')
      .replace(/<a:off x="508000" y="381000"\/>/, '<a:off x="1270000" y="381000"/>');
    const files = unzipSync(bytes);
    files['ppt/slides/slide1.xml'] = new Uint8Array(strToU8(xml));
    const got = geos(zipSync(files));
    expect(got[0].text?.runs.map((r) => r.text).join('')).toBe('Clean by TLC?');
    expect(Math.round(got[0].x1)).toBe(100);
    expect(got[0].transparency).toBe(0.3);
  });

  it('brings in PowerPoint\'s shapes as library shapes, with their text inside', async () => {
    const bytes = await save([]);
    const xml = slideXml(bytes).replace('</p:spTree>',
      '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Can"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="127000" y="127000"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="can"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr>' +
      '<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US"/><a:t>Waste</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>');
    const files = unzipSync(bytes);
    files['ppt/slides/slide1.xml'] = new Uint8Array(strToU8(xml));
    const got = geos(zipSync(files));
    expect(got).toHaveLength(1);
    expect(got[0].geo).toBe('can');
    expect(got[0].fillColor?.toLowerCase()).toBe('#ff0000');
    expect(got[0].text?.runs.map((r) => r.text).join('')).toBe('Waste');
    expect(got[0].textValign).toBeUndefined();
    expect(GEO_BY_ID.get('can')?.prst).toBe('can');
  });
});

describe('designs saved for ChemDraw', () => {
  it('draws a shape as ChemDraw curves, with its handles either side of each point', () => {
    const [c] = chemDrawCurves([['M', 0, 0], ['L', 10, 0], ['C', 12, 0, 14, 2, 14, 4], ['L', 0, 4], ['Z']]);
    expect(c.closed).toBe(true);
    expect(c.points).toHaveLength(12);
    // the corner where the curve starts: handle in on the point, handle out toward the curve
    expect(c.points.slice(3, 6)).toEqual([{ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 0 }]);
    expect(c.points.slice(6, 9)).toEqual([{ x: 14, y: 2 }, { x: 14, y: 4 }, { x: 14, y: 4 }]);
  });

  it('comes back from a ChemDraw file as the same shape, where it was moved to', () => {
    const doc = new Doc();
    doc.edit('shape', () => { doc.addShape({ kind: 'geo', geo: 'labBeaker', x1: 10, y1: 20, x2: 60, y2: 80, color: '#000000', text: { runs: [{ text: 'H2O', formula: true }] } }); });
    const xml = writeCdxml(doc);
    expect(xml).toContain('<curve');
    expect(xml).toContain('H');
    const back = readCdxml(xml).doc;
    const [s] = [...back.shapes.values()];
    expect(s.kind).toBe('geo');
    expect(s.geo).toBe('labBeaker');
    expect(s.text?.runs[0].text).toBe('H2O');
    expect(back.captions.size).toBe(0);
    // moved in ChemDraw: the group's box moves
    const moved = xml.replace(/(<group[^>]*BoundingBox=")([\d.]+) ([\d.]+)/, (_m, a, x, y) => `${a}${+x + 30} ${+y + 5}`);
    const [m] = [...readCdxml(moved).doc.shapes.values()];
    expect(Math.round(m.x1)).toBe(40);
    expect(Math.round(m.y1)).toBe(25);
  });
});
