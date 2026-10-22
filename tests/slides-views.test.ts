// @vitest-environment jsdom
//
// Office wave 5, Slides views and looks: Shape Styles and Shape Effects (glow, soft edges,
// bevel, reflection, picture fills), the guides and grid, notes pages, handouts and their
// masters, and the outline; in the app and through PowerPoint files and back.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { offsetArea, shapeFx } from '../src/render/shape-fx';
import { polysMP, regionOf } from '../src/render/highlight-fx';
import { shapePolygons } from '../src/render/fills';
import { effectPatch, stylePatch, styleColours } from '../src/ui/shape-styles';
import { defaultView, guideNear, readViewProps, rulerSteps, rulerText, snapMove, viewPropsXml } from '../src/deck/guides';
import { handoutLayout, notesLayout, notesLines, pageTexts, readMasterHF } from '../src/deck/notes-pages';
import { applyOutline, outlineText, parseOutline, slideOutline } from '../src/deck/outline';

// a 2 × 2 PNG, all one colour
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwnwEJMBJmAQA4aQX7LEdMmgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

/** A one-slide deck with these shapes, written as PowerPoint and read back. */
async function roundTrip(shapes: Omit<Shape, 'id'>[], strip = false) {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.setLayout('blank');
  host.edit('Shapes', () => { for (const s of shapes) host.addShape(s); });
  let bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
  const files = unzipSync(bytes);
  const xml = strFromU8(files['ppt/slides/slide1.xml']);
  if (strip) {
    // as PowerPoint would leave a file of its own: no tags of ours
    // (in the bytes' own kind of array, which the zip library checks for)
    const U8 = files['ppt/slides/slide1.xml'].constructor as Uint8ArrayConstructor;
    files['ppt/slides/slide1.xml'] = U8.from(strToU8(xml.replace(/<p:custDataLst>.*?<\/p:custDataLst>/g, '')));
    bytes = zipSync(files);
  }
  const back = readPptx(bytes);
  const got = back.slides[0].contents.shapes.filter((s) => s.kind === 'geo');
  return { xml, got };
}

const box = (extra: Partial<Shape> = {}): Omit<Shape, 'id'> => ({ kind: 'geo', geo: 'rect', x1: 100, y1: 100, x2: 300, y2: 200, filled: true, fillColor: '#3366cc', color: '#3366cc', ...extra });

describe('shape effects', () => {
  it('grows and shrinks any outline', () => {
    const sq = polysMP([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]]);
    const big = regionOf(offsetArea(sq, 10))[0];
    expect(Math.min(...big.map((p) => p.x))).toBeCloseTo(-10, 0);
    expect(Math.max(...big.map((p) => p.y))).toBeCloseTo(60, 0);
    const small = regionOf(offsetArea(sq, -10))[0];
    expect(Math.min(...small.map((p) => p.x))).toBeCloseTo(10, 0);
    expect(Math.max(...small.map((p) => p.y))).toBeCloseTo(40, 0);
  });

  it('works out a glow, soft edges, a bevel and a reflection as areas', () => {
    const s = { id: 1, ...box({ glow: { color: '#ff0000', size: 8, transparency: 0.4 }, softEdge: 5, bevel: { kind: 'circle', w: 6, h: 6 }, reflection: { size: 0.5, opacity: 0.5, dist: 4 } }) } as Shape;
    const fx = shapeFx(s, shapePolygons(s), '#3366cc');
    // the glow reaches 8 pt out and is in its own colour, the reflection hangs below
    const under = fx.under.flatMap((p) => p.region.flat());
    expect(Math.min(...under.map((p) => p.x))).toBeCloseTo(92, 0);
    expect(Math.max(...under.map((p) => p.y))).toBeCloseTo(204 + 50, 0);
    expect(fx.under.some((p) => p.colour.startsWith('rgba(255,0,0'))).toBe(true);
    // the soft edge fades: clearest at the edge, solid in the middle
    expect(fx.fill!.length).toBeGreaterThan(5);
    expect(fx.fill![0].colour).toMatch(/^rgba\(51,102,204,0\.05/);
    expect(fx.fill![fx.fill!.length - 1].colour).toBe('#3366cc');
    // the bevel: white at the top left, black at the bottom right
    expect(fx.over.some((p) => p.colour.startsWith('rgba(255,255,255'))).toBe(true);
    expect(fx.over.some((p) => p.colour.startsWith('rgba(0,0,0'))).toBe(true);
  });

  it('writes PowerPoint\'s own effects and reads them back', async () => {
    const look = { glow: { color: '#ff0000', size: 8, transparency: 0.4 }, softEdge: 5, bevel: { kind: 'angle' as const, w: 4, h: 3 }, reflection: { size: 0.35, opacity: 0.5, dist: 4 } };
    const { xml, got } = await roundTrip([box(look)]);
    expect(xml).toContain('<a:glow rad="101600"><a:srgbClr val="FF0000"><a:alpha val="60000"/>');
    expect(xml).toContain('<a:softEdge rad="63500"/>');
    expect(xml).toMatch(/<a:reflection stA="50000" stPos="0" endA="0" endPos="35000" dist="50800"/);
    expect(xml).toContain('<a:bevelT w="50800" h="38100" prst="angle"/>');
    // the effects come in the order the format wants: glow, shadow, reflection, soft edges
    expect(xml.indexOf('<a:glow')).toBeLessThan(xml.indexOf('<a:reflection'));
    expect(xml.indexOf('<a:reflection')).toBeLessThan(xml.indexOf('<a:softEdge'));
    expect(got[0]).toMatchObject(look);
    // a file PowerPoint saved (no tags of ours) gives the same effects
    const theirs = await roundTrip([box({ ...look, shadow: true, shadowSize: 4, shadowBlur: 3, shadowAngle: 90, shadowOpacity: 0.4 })], true);
    expect(theirs.got[0].glow?.size).toBeCloseTo(8);
    expect(theirs.got[0].glow?.transparency).toBeCloseTo(0.4);
    expect(theirs.got[0].softEdge).toBeCloseTo(5);
    expect(theirs.got[0].bevel).toEqual({ kind: 'angle', w: 4, h: 3 });
    expect(theirs.got[0].reflection).toMatchObject({ size: 0.35, opacity: 0.5, dist: 4 });
    expect(theirs.got[0]).toMatchObject({ shadow: true, shadowSize: 4, shadowBlur: 3, shadowAngle: 90, shadowOpacity: 0.4 });
  });

  it('fills a shape with a picture, kept in the file once', async () => {
    const { xml, got } = await roundTrip([box({ picFill: { src: PNG_URL, px: { w: 2, h: 2 }, transparency: 0.25 } })]);
    expect(xml).toMatch(/<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId\d+"><a:alphaModFix amt="75000"\/><\/a:blip>/);
    expect(got[0].picFill?.src).toBe(PNG_URL);
    expect(got[0].picFill?.px).toEqual({ w: 2, h: 2 });
    expect(got[0].picFill?.transparency).toBe(0.25);
    const theirs = await roundTrip([box({ picFill: { src: PNG_URL, px: { w: 2, h: 2 } } })], true);
    expect(theirs.got[0].picFill?.src).toBe(PNG_URL);
  });

  it('reads a PowerPoint gradient as a gradient', async () => {
    const { got } = await roundTrip([box({ fill: 'gradient', fillColor: '#ff0000', fill2: '#0000ff', gradAngle: 45 })], true);
    expect(got[0]).toMatchObject({ fill: 'gradient', fillColor: '#ff0000', fill2: '#0000ff', gradAngle: 45 });
  });
});

describe('shape styles', () => {
  it('offers the deck\'s colours and six strengths of each', () => {
    const cs = styleColours('#222222', '#2f6fb0', '#2f6fb0');
    expect(cs[0]).toBe('#222222');
    expect(cs.filter((c) => c === '#2f6fb0')).toHaveLength(1);
    expect(cs.length).toBe(6);
    expect(stylePatch('outline', '#2f6fb0')).toMatchObject({ filled: false, color: '#2f6fb0', textColor: '#2f6fb0' });
    expect(stylePatch('intense', '#2f6fb0')).toMatchObject({ fill: 'gradient', shadow: true, textColor: '#ffffff' });
    expect(stylePatch('intense', '#2f6fb0').bevel?.kind).toBe('circle');
    // a style takes away effects set before
    expect(stylePatch('fill', '#2f6fb0')).toHaveProperty('glow', undefined);
  });

  it('applies the effects menu\'s choices', () => {
    const s = { id: 1, ...box() } as Shape;
    expect(effectPatch('shape-fx:glow:8', s)).toEqual({ glow: { color: '#3366cc', size: 8, transparency: 0.4 } });
    expect(effectPatch('shape-fx:soft:none', s)).toEqual({ softEdge: undefined });
    expect(effectPatch('shape-fx:bevel:divot', s)).toEqual({ bevel: { kind: 'divot', w: 6, h: 6 } });
    expect(effectPatch('shape-fx:reflection:0', s)?.reflection).toMatchObject({ size: 0.35 });
    expect(effectPatch('shape-fx:shadow:below', s)).toMatchObject({ shadow: true, shadowAngle: 90 });
    expect(effectPatch('shape-fx:bevel:nonsense', s)).toBeNull();
  });
});


describe('guides and grid', () => {
  const size = { w: 960, h: 540 };
  it('snaps a move to the grid, or an edge or middle to a guide', () => {
    const view = { ...defaultView(size), grid: 18 };
    const box = { x1: 10, y1: 10, x2: 110, y2: 60 };
    // to the grid: the top left lands on a multiple of 18
    expect(snapMove(box, { x: 30, y: 5 }, view, 4)).toEqual({ x: 26, y: 8 });
    // a guide close by wins (its middle on the slide's middle guide)
    const g = { ...view, showGuides: true };
    const to = snapMove(box, { x: 418, y: 0 }, g, 4);
    expect(to.x + 60).toBe(480);
    // no settings: no snapping
    expect(snapMove(box, { x: 3.3, y: 1.1 }, null, 4)).toEqual({ x: 3.3, y: 1.1 });
    expect(guideNear(g, { x: 482, y: 100 }, 4)).toEqual({ axis: 'x', i: 0 });
    expect(guideNear(g, { x: 100, y: 100 }, 4)).toBeNull();
  });

  it('writes the rulers\' numbers from the middle of the slide or its corner', () => {
    expect(rulerText(480 + 72, size, 'x', { units: 'in', from: 'centre' })).toBe('1.00"');
    expect(rulerText(480 - 36, size, 'x', { units: 'in', from: 'centre' })).toBe('0.50"');
    expect(rulerText(72, size, 'y', { units: 'cm', from: 'corner' })).toBe('2.54 cm');
    const s = rulerSteps({ units: 'in', from: 'centre' }, 1);
    expect(s.major).toBe(72);
    expect(s.minor).toBe(8);
  });

  it('keeps the guides, snapping and spacing in PowerPoint\'s view settings', async () => {
    const view = { guides: { x: [100, 480], y: [270] }, showGuides: true, snapToGrid: false, grid: 9 };
    const xml = viewPropsXml(view, 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"');
    expect(xml).toContain('<p:guide orient="horz" pos="2160"/>');
    expect(xml).toContain('<p:guide pos="800"/>');
    expect(xml).toContain('snapToGrid="0" showGuides="1"');
    expect(xml).toContain('<p:gridSpacing cx="114300" cy="114300"/>');
    const back = readViewProps(new DOMParser().parseFromString(xml, 'application/xml').documentElement);
    expect(back).toEqual(view);
    // and through a whole file
    const host = new Doc();
    const d = Deck.blank(host);
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })), settings: { view } }, opts);
    expect(readPptx(bytes).settings?.view).toEqual(view);
  });
});

describe('notes pages and handouts', () => {
  const size = { w: 960, h: 540 };
  it('lays out a notes page: the slide in the top half, the notes under it', () => {
    const L = notesLayout(size);
    expect(L.page).toEqual({ w: 540, h: 720 });
    expect(L.slide.w / L.slide.h).toBeCloseTo(960 / 540);
    expect(L.notes.y).toBeGreaterThan(L.slide.y + L.slide.h);
    expect(L.notes.y + L.notes.h).toBeLessThanOrEqual(720);
    const land = notesLayout(size, { landscape: true, slide: 0.6 });
    expect(land.page).toEqual({ w: 720, h: 540 });
    expect(land.slide.h).toBeGreaterThan(L.slide.h * 0.9);
  });

  it('lays out handouts, three to a page with lines beside them', () => {
    const three = handoutLayout(size, { perPage: 3 });
    expect(three.cells).toHaveLength(3);
    expect(three.lines).toHaveLength(3);
    expect(three.lines[0].x).toBeGreaterThan(three.cells[0].x + three.cells[0].w);
    const six = handoutLayout(size, { perPage: 6, landscape: true });
    expect(six.page.w).toBeGreaterThan(six.page.h);
    expect(new Set(six.cells.map((c) => Math.round(c.y))).size).toBe(2);
  });

  it('wraps the notes and fills in the header, footer, date and number', () => {
    const lines = notesLines('one two three four five\n\nsix', { x: 0, y: 0, w: 60, h: 500 }, 10, (s) => s.length * 5);
    expect(lines.map((l) => l.text)).toEqual(['one two', 'three four', 'five', '', 'six']);
    const t = pageTexts({ header: 'Group meeting', footer: 'N. O.', date: true, dateFixed: 'Oct 2026', pageNumbers: false }, 4);
    expect(t).toEqual({ header: 'Group meeting', date: 'Oct 2026', footer: 'N. O.', number: '' });
  });

  it('writes the notes and handout masters as PowerPoint\'s own, and reads their header and footer back', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    const master = { ...d.master, notesHF: { header: 'Group meeting', footer: 'Lab', date: true, dateFormat: 'datetime4' as const, pageNumbers: true }, notesPage: { landscape: true, size: 14 }, handout: { perPage: 6 as const, frame: true } };
    const bytes = await writePptx({ size: d.size, master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: '' })) }, opts);
    const files = unzipSync(bytes);
    const pres = strFromU8(files['ppt/presentation.xml']);
    expect(pres).toMatch(/<p:notesMasterIdLst>.*<p:handoutMasterIdLst>.*<p:sldIdLst>/);
    expect(pres).toContain('<p:notesSz cx="9144000" cy="6858000"/>');
    const nm = strFromU8(files['ppt/notesMasters/notesMaster1.xml']);
    expect(nm).toContain('<p:hf/>');
    expect(nm).toContain('<a:defRPr sz="1400"');
    expect(nm).toContain('type="datetime4"');
    const hm = strFromU8(files['ppt/handoutMasters/handoutMaster1.xml']);
    expect(hm).toContain('<a:t>Group meeting</a:t>');
    expect(strFromU8(files['[Content_Types].xml'])).toContain('handoutMaster+xml');
    // ours come back from our settings; PowerPoint's from the masters
    const back = readPptx(bytes);
    expect(back.master.notesPage).toEqual({ landscape: true, size: 14 });
    expect(back.master.handout).toEqual({ perPage: 6, frame: true });
    expect(readMasterHF(new DOMParser().parseFromString(hm, 'application/xml').documentElement)).toEqual(master.notesHF);
  });
});

describe('outline view', () => {
  it('reads a slide\'s title and bullet lines, and writes changes back', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setLayout('title-content');
    const doc = d.docOf(0);
    expect(slideOutline(doc)).toEqual({ title: '', body: [] });
    doc.edit('Outline', () => { applyOutline(doc, 'Aldol reactions', parseOutline('Enolates\n\tLithium\n\tBoron\nSelectivity')); });
    const o = slideOutline(doc);
    expect(o.title).toBe('Aldol reactions');
    expect(o.body).toEqual([{ text: 'Enolates', level: 0 }, { text: 'Lithium', level: 1 }, { text: 'Boron', level: 1 }, { text: 'Selectivity', level: 0 }]);
    const body = [...doc.captions.values()].find((c) => c.ph === 'body')!;
    expect(body.paras?.[1]).toEqual({ list: 'bullet', level: 1 });
    expect(outlineText(o.body!)).toBe('Enolates\n\tLithium\n\tBoron\nSelectivity');
    // nothing changed: nothing written
    let changed = true;
    doc.edit('Outline', () => { changed = applyOutline(doc, 'Aldol reactions', o.body); });
    expect(changed).toBe(false);
    expect(parseOutline('    four spaces')).toEqual([{ text: 'four spaces', level: 1 }]);
  });
});
