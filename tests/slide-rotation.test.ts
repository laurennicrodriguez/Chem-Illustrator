// @vitest-environment jsdom
//
// Turned pictures and shapes, and the Selection Pane's names and hidden objects: picked,
// resized and saved to PowerPoint as turned, and read back from PowerPoint's files.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { defaultMaster } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { shapeBox, shapeHit, dragShapeHandle, shapeCorners } from '../src/objects';
import { turnAbout } from '../src/geom';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

async function save(fill: (d: Doc) => void): Promise<Uint8Array> {
  const doc = new Doc();
  doc.style = { ...defaultMaster().drawing } as Doc['style'];
  doc.edit('things', () => fill(doc));
  return writePptx({ size: { w: 960, h: 540 }, master: defaultMaster(), slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
}
const slideXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
const withSlide = (bytes: Uint8Array, xml: string) => {
  const files = unzipSync(bytes);
  files['ppt/slides/slide1.xml'] = new Uint8Array(strToU8(xml));
  return zipSync(files);
};
const untagged = (bytes: Uint8Array) => withSlide(bytes, slideXml(bytes).replace(/<p:custDataLst>.*?<\/p:custDataLst>/gs, ''));

describe('turned shapes', () => {
  const s: Shape = { id: 1, kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 40, rot: 90 };
  it('pick and box by their turned outline', () => {
    const b = shapeBox(s);
    expect(b.x1).toBeCloseTo(30); expect(b.x2).toBeCloseTo(70);
    expect(b.y1).toBeCloseTo(-30); expect(b.y2).toBeCloseTo(70);
    expect(shapeHit({ ...s, filled: true }, { x: 50, y: -20 }, 1)).toBe(true);
    expect(shapeHit({ ...s, filled: true }, { x: 5, y: 20 }, 1)).toBe(false);
  });
  it('resize in their own frame, the opposite corner staying put', () => {
    const before = shapeCorners(s);
    // the turned shape's east handle is at the bottom; drag it 20 further down
    const e = turnAbout({ x: 100, y: 20 }, { x: 50, y: 20 }, 90);
    const after = { ...s, ...dragShapeHandle(s, 'e', { x: e.x, y: e.y + 20 }, false) };
    expect(after.x2 - after.x1).toBeCloseTo(120);
    expect(after.y2 - after.y1).toBeCloseTo(40);
    // the west side (now at the top) didn't move
    const w0 = before[0], w1 = shapeCorners(after)[0];
    expect(w1.x).toBeCloseTo(w0.x); expect(w1.y).toBeCloseTo(w0.y);
  });
});

describe('turned objects in PowerPoint files', () => {
  const fill = (d: Doc) => {
    d.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 300, y2: 200, src: DOT, px: { w: 1, h: 1 }, rot: 30, name: 'Spectrum' });
    d.addShape({ kind: 'rect', x1: 400, y1: 100, x2: 500, y2: 160, color: '#3366cc', filled: true, rot: 45, hidden: true });
  };
  it('writes PowerPoint\'s rot, names and hidden flags', async () => {
    const xml = slideXml(await save(fill));
    expect(xml).toContain('rot="1800000"');
    expect(xml).toContain('rot="2700000"');
    expect(xml).toContain('name="Spectrum"');
    expect(xml).toMatch(/hidden="1"/);
  });
  for (const [how, read] of [['as saved', (b: Uint8Array) => b], ['from PowerPoint\'s own markup', untagged]] as const) {
    it(`reads them back ${how}`, async () => {
      const back = readPptx(read(await save(fill)));
      const shapes = back.slides[0].contents.shapes;
      const pic = shapes.find((x) => x.kind === 'picture')!;
      const rect = shapes.find((x) => x.kind === 'rect')!;
      expect(pic.rot).toBeCloseTo(30, 3);
      expect(pic.name).toBe('Spectrum');
      expect([pic.x1, pic.y1, pic.x2, pic.y2].map(Math.round)).toEqual([100, 100, 300, 200]);
      expect(rect.rot).toBeCloseTo(45, 3);
      expect(rect.hidden).toBe(true);
      expect(back.warnings.some((w) => /unrotated|turned/i.test(w))).toBe(false);
    });
  }
  it('hidden text boxes stay hidden and keep their names', async () => {
    const bytes = await save((d) => { d.addCaption({ x: 100, y: 100, justify: 'left', runs: [{ text: 'secret' }], hidden: true, name: 'Note' }); });
    for (const b of [bytes, untagged(bytes)]) {
      const c = readPptx(b).slides[0].contents.captions[0];
      expect(c.hidden).toBe(true);
      expect(c.name).toBe('Note');
    }
  });
});
