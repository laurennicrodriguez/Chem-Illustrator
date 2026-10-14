// @vitest-environment jsdom
//
// Slides round 2: picture frames, corners and shadows; design templates; going to PowerPoint and back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc, PICTURE_STYLES, pictureRadius, type Shape } from '../src/model';
import { Deck, WIDE, defaultMaster, decorShapes, slideColours, textStyles } from '../src/deck/deck';
import { SLIDE_TEMPLATES, applyTemplate } from '../src/deck/templates';
import { writePptx, pictureLookXml, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { shapeBox } from '../src/objects';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

/** A deck of one blank slide holding these pictures, saved and opened again. */
async function roundTrip(pics: Partial<Shape>[]): Promise<{ xml: string; back: ReturnType<typeof readPptx> }> {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.setLayout('blank');
  host.edit('Pictures', () => {
    pics.forEach((p, i) => host.addShape({ kind: 'picture', x1: 100 + 150 * i, y1: 100, x2: 200 + 150 * i, y2: 180, src: DOT, px: { w: 1, h: 1 }, ...p }));
  });
  const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
  return { xml: strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']), back: readPptx(bytes) };
}

describe('picture frames, corners and shadows', () => {
  it('measures rounded corners from the shorter side, at most half of it', () => {
    expect(pictureRadius({ round: 0.1 }, 200, 80)).toBeCloseTo(8);
    expect(pictureRadius({ round: 0.9 }, 200, 80)).toBeCloseTo(40);
    expect(pictureRadius(undefined, 200, 80)).toBe(0);
  });

  it('counts the frame and shadow in the space a picture takes up', () => {
    const b = shapeBox({ id: 1, kind: 'picture', x1: 0, y1: 0, x2: 100, y2: 50, look: { line: 4, shadow: 'soft' } });
    expect(b.x1).toBeCloseTo(-2);
    expect(b.y1).toBeCloseTo(-2);
    // the soft shadow: 3 pt down and right, blurred 6 pt
    expect(b.x2).toBeCloseTo(109);
    expect(b.y2).toBeCloseTo(59);
  });

  it('writes them as PowerPoint picture formatting', () => {
    const x = pictureLookXml({ line: 2, lineColor: '#7f7f7f', round: 0.1, shadow: 'soft' });
    expect(x).toContain('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/>');
    expect(x).toContain('<a:ln w="25400"><a:solidFill><a:srgbClr val="7F7F7F"/>');
    expect(x).toContain('<a:outerShdw blurRad="76200" dist="53882" dir="2700000"');
    expect(x).toContain('<a:alpha val="35000"/>');
    expect(pictureLookXml(undefined)).toBe('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>');
  });

  it('opens every ready-made style as it was saved', async () => {
    const styles = PICTURE_STYLES.filter((p) => p.look);
    const { xml, back } = await roundTrip(styles.map((p) => ({ look: p.look })));
    expect(xml).toContain('prst="roundRect"');
    expect(back.warnings).toEqual([]);
    const pics = back.slides[0].contents.shapes.filter((s) => s.kind === 'picture').sort((a, b) => a.x1 - b.x1);
    expect(pics.map((p) => p.look)).toEqual(styles.map((p) => p.look));
  });
});

describe('slide templates', () => {
  it('has about twenty, with distinct names, all on light content slides', () => {
    expect(SLIDE_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SLIDE_TEMPLATES.map((t) => t.name)).size).toBe(SLIDE_TEMPLATES.length);
    // structures are drawn in black: content slides stay light
    const light = (c: string) => { const n = parseInt(c.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 200; };
    for (const t of SLIDE_TEMPLATES) expect(light(t.background)).toBe(true);
  });

  it('changes only the look, keeping the logo, footer, numbers and drawing style', () => {
    const m = { ...defaultMaster(), footer: 'Group meeting', slideNumbers: false };
    const t = SLIDE_TEMPLATES.find((x) => x.id === 'midnight')!;
    const n = applyTemplate(m, t);
    expect(n.footer).toBe('Group meeting');
    expect(n.slideNumbers).toBe(false);
    expect(n.drawing).toEqual(m.drawing);
    expect(n.titleFont).toBe('Inter');
    expect(slideColours(n, 'title').background).toBe('#0f1b2d');
    expect(slideColours(n, 'title-content').background).toBe('#ffffff');
    expect(textStyles(n, 'title').title.color).toBe('#ffffff');
    expect(textStyles(n, 'title-content').title.color).toBe('#0f1b2d');
  });

  it('places each kind of shape inside the slide', () => {
    for (const decor of ['top-bar', 'title-band', 'left-strip', 'title-rule', 'corner', 'footer-band', 'frame'] as const) {
      for (const layout of ['title', 'title-content'] as const) {
        const shapes = decorShapes(WIDE, { ...defaultMaster(), decor }, layout);
        expect(shapes.length).toBeGreaterThan(0);
        for (const sh of shapes) {
          const pts = sh.kind === 'tri' ? sh.pts : [[sh.x1, sh.y1], [sh.x2, sh.y2]];
          for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(WIDE.w); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(WIDE.h); }
        }
      }
    }
    expect(decorShapes(WIDE, defaultMaster(), 'title')).toEqual([]);
  });

  it('saves the shapes and title slide colours in the layouts, and opens the deck as it was', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setMaster(applyTemplate(d.master, SLIDE_TEMPLATES.find((x) => x.id === 'midnight')!));
    const title = [...host.captions.values()].find((c) => c.ph === 'title')!;
    host.edit('Type', () => host.updateCaption(title.id, { runs: [{ text: 'Total synthesis' }] }));
    d.addSlide('title-content');
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
    const files = unzipSync(bytes);
    const titleLayout = strFromU8(files['ppt/slideLayouts/slideLayout1.xml']);
    expect(titleLayout).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0F1B2D"/>');
    expect(titleLayout).toContain('name="Rectangle');
    const contentLayout = strFromU8(files['ppt/slideLayouts/slideLayout2.xml']);
    expect(contentLayout).not.toContain('<p:bg>');
    expect(strFromU8(files['ppt/theme/theme1.xml'])).toContain('<a:accent1><a:srgbClr val="4C8BF5"/>');
    const back = readPptx(bytes);
    expect(back.warnings).toEqual([]);
    expect(back.master.template).toBe('Midnight');
    expect(back.master.titleSlide).toEqual(d.master.titleSlide);
    expect(back.master.decor).toBe('top-bar');
    // the title keeps no colour of its own: it takes the title slide's
    const t = back.slides[0].contents.captions.find((c) => c.ph === 'title')!;
    expect(t.runs).toEqual([{ text: 'Total synthesis' }]);
  });
});
