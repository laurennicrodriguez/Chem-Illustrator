// @vitest-environment jsdom
//
// The icon library: reading SVG path data, finding icons, and icons placed as library shapes
// (drawn, hit, saved to PowerPoint and ChemDraw files and read back).

import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { Deck } from '../src/deck/deck';
import { flatten, geoDef, geoShapeStyle } from '../src/design/geo';
import { svgPathSteps, loadIcons, findIcons, iconGroups, iconInfo, iconDef, iconSteps, iconSvg, iconPathData, LAB_GROUP, ICON_SIZE } from '../src/design/icons';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeCdxml } from '../src/io/cdxml-write';
import { shapeHit } from '../src/objects';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

/** The box the curves themselves cover (not their control points). */
function extent(steps: ReturnType<typeof svgPathSteps>) {
  const pts = flatten(steps, 24).flat();
  return { x1: Math.min(...pts.map((p) => p.x)), y1: Math.min(...pts.map((p) => p.y)), x2: Math.max(...pts.map((p) => p.x)), y2: Math.max(...pts.map((p) => p.y)) };
}

describe('SVG path data', () => {
  it('reads lines, relative moves, H and V, and closes back to the start', () => {
    expect(svgPathSteps('M2,2 h10 v5 H2 z m1 1 l2 0 L3 4Z')).toEqual([
      ['M', 2, 2], ['L', 12, 2], ['L', 12, 7], ['L', 2, 7], ['Z'],
      ['M', 3, 3], ['L', 5, 3], ['L', 3, 4], ['Z'],
    ]);
  });
  it('takes extra pairs after a move as lines, and numbers written without spaces', () => {
    expect(svgPathSteps('M0 0 10 0 10-10.5.5.5')).toEqual([['M', 0, 0], ['L', 10, 0], ['L', 10, -10.5], ['L', 0.5, 0.5]]);
  });
  it('turns smooth and quadratic curves into cubic ones', () => {
    const s = svgPathSteps('M0,0 C0,10 10,10 10,0 S20,-10 20,0 Q25,10 30,0 T40,0');
    expect(s[2]).toEqual(['C', 10, -10, 20, -10, 20, 0]);
    expect(s[3][0]).toBe('C');
    const q = s[3] as number[] as [string, number, number, number, number, number, number];
    expect(q[1]).toBeCloseTo(20 + (2 / 3) * 5);
    expect(q[2]).toBeCloseTo((2 / 3) * 10);
    // T reflects the last control point (25, 10) about (30, 0) to (35, -10)
    const t = s[4] as [string, number, number, number, number, number, number];
    expect(t[2]).toBeCloseTo((2 / 3) * -10);
  });
  it('draws arcs as curves through the right points, flags written together too', () => {
    // a half circle of radius 5 from (0, 5) to (10, 5), over the top
    const s = svgPathSteps('M0,5 A5,5 0 0,1 10,5');
    const e = extent(s);
    expect(e.y1).toBeCloseTo(0, 2);
    expect(e.x2).toBeCloseTo(10, 5);
    expect(svgPathSteps('M0,5a5 5 0 0110 0')).toEqual(s);
    // the large arc the other way round goes underneath
    expect(extent(svgPathSteps('M0,5 A5,5 0 1,0 10,5')).y2).toBeCloseTo(10, 2);
  });
  it('stops on path data it cannot read', () => {
    expect(() => svgPathSteps('M0,0 X1,1')).toThrow();
  });
});

describe('the icon library', () => {
  beforeAll(() => loadIcons());

  it('has thousands of icons in groups, the lab group first, and no company logos', () => {
    expect(findIcons('').length).toBeGreaterThan(6000);
    const groups = iconGroups();
    expect(groups[0]).toBe(LAB_GROUP);
    expect(groups).not.toContain('Brand / Logo');
    expect(iconInfo('icon:github')).toBeUndefined();
    expect(iconInfo('icon:microsoft-powerpoint')).toBeUndefined();
    const lab = findIcons('', LAB_GROUP).map((i) => i.id);
    for (const id of ['icon:flask', 'icon:beaker', 'icon:test-tube', 'icon:atom', 'icon:molecule', 'icon:biohazard', 'icon:radioactive', 'icon:skull-crossbones', 'icon:microscope', 'icon:dna']) {
      expect(lab, id).toContain(id);
    }
  });

  it('reads every icon, and each fits its 24-point grid', () => {
    for (const i of findIcons('')) {
      const steps = svgPathSteps(iconPathData(i.id)!);
      expect(steps[0][0], i.id).toBe('M');
      const e = extent(steps);
      expect(e.x1, i.id).toBeGreaterThan(-0.6);
      expect(e.y1, i.id).toBeGreaterThan(-0.6);
      expect(e.x2, i.id).toBeLessThan(24.6);
      expect(e.y2, i.id).toBeLessThan(24.6);
    }
  });

  it('finds icons by their words, names that start with the words first', () => {
    const found = findIcons('flask');
    expect(found[0].id).toBe('icon:flask');
    expect(found.every((i) => i.words.includes('flask'))).toBe(true);
    // a word's start: "tube" finds test tubes, "est" doesn't
    expect(findIcons('tube').map((i) => i.id)).toContain('icon:test-tube');
    expect(findIcons('est tube').map((i) => i.id)).not.toContain('icon:test-tube');
    expect(findIcons('round bottom', LAB_GROUP).map((i) => i.id)).toContain('icon:flask-round-bottom');
    expect(findIcons('no such icon anywhere')).toEqual([]);
  });

  it('makes small pictures for menus', () => {
    expect(iconSvg('icon:flask', 20)).toMatch(/^<svg [^>]*width="20"[^>]*><path fill="currentColor" d="M/);
  });
});

describe('icons as shapes', () => {
  beforeAll(() => loadIcons());

  it('are library shapes, filled in one colour with no outline', () => {
    const def = geoDef('icon:flask');
    expect(def).toBe(iconDef('icon:flask'));
    expect(def.icon).toBe(true);
    expect(def.name).toBe('Flask');
    expect(def.size).toEqual([ICON_SIZE, ICON_SIZE]);
    expect(geoShapeStyle('icon:flask')).toEqual({ kind: 'geo', geo: 'icon:flask', filled: true, color: '#000000', lineWidth: 0 });
    expect(geoShapeStyle('icon:flask', { color: '#2f5597' })?.color).toBe('#2f5597');
    // stretched to the shape's box
    const e = extent(iconSteps('icon:flask', 96, 48));
    expect(e.x2 - e.x1).toBeGreaterThan(70);
    expect(e.y2 - e.y1).toBeLessThan(48);
  });

  it('are picked up inside their outline, not in the holes round them', () => {
    const s = { id: 1, kind: 'geo', geo: 'icon:circle', x1: 0, y1: 0, x2: 48, y2: 48, filled: true, lineWidth: 0 } as Shape;
    expect(shapeHit(s, { x: 24, y: 24 }, 1)).toBe(true);
    // the corners of the box are outside the circle
    expect(shapeHit(s, { x: 1, y: 1 }, 0.5)).toBe(false);
  });

  it('go to PowerPoint as their outline and come back as the same icon', async () => {
    const host = new Doc();
    const d = Deck.design(host, { w: 504, h: 288 });
    const doc = d.docOf(0);
    doc.edit('icons', () => { doc.addShape({ ...geoShapeStyle('icon:beaker', { color: '#c00000' }), x1: 20, y1: 20, x2: 68, y2: 68 } as Omit<Shape, 'id'>); });
    const bytes = await writePptx({ size: d.size, master: d.master, slides: [{ layout: 'blank', doc, notes: '' }], design: true }, opts);
    const xml = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
    expect(xml).toContain('<a:custGeom>');
    expect(xml).toContain('name="Beaker');
    // filled red, no line
    expect(xml).toContain('<a:solidFill><a:srgbClr val="C00000">');
    expect(xml).toContain('<a:ln><a:noFill/></a:ln>');
    const back = readPptx(bytes).slides[0].contents.shapes.find((s) => s.kind === 'geo')!;
    expect(back.geo).toBe('icon:beaker');
    expect(back.color).toBe('#c00000');
    expect(back.lineWidth).toBe(0);
  });

  it('go to ChemDraw files as filled curves', () => {
    const doc = new Doc();
    doc.edit('icon', () => { doc.addShape({ ...geoShapeStyle('icon:flask'), x1: 20, y1: 20, x2: 68, y2: 68 } as Omit<Shape, 'id'>); });
    const xml = writeCdxml(doc);
    expect(xml).toMatch(/<curve [^>]*CurveType="129"/);
  });
});

describe('outline parts', () => {
  it('counts how deep each part lies, outermost first', async () => {
    const { outlineParts } = await import('../src/design/geo');
    // a square with a square hole holding a dot, and a separate square
    const parts = outlineParts(svgPathSteps('M2,2H8V8H2Z M0,0H10V10H0Z M4,4H6V6H4Z M20,0H30V10H20Z'));
    expect(parts.map((p) => [p.steps[0], p.depth])).toEqual([[['M', 0, 0], 0], [['M', 20, 0], 0], [['M', 2, 2], 1], [['M', 4, 4], 2]]);
  });
  it('paints an icon\'s holes white in ChemDraw files', () => {
    const doc = new Doc();
    doc.edit('icon', () => { doc.addShape({ ...geoShapeStyle('icon:circle-outline'), x1: 0, y1: 0, x2: 48, y2: 48 } as Omit<Shape, 'id'>); });
    const xml = writeCdxml(doc);
    const curves = xml.match(/<curve [^>]*CurveType="129"[^>]*>/g) ?? [];
    expect(curves).toHaveLength(2);
    // the ring in black (no colour given), then its middle in white
    expect(curves[0]).not.toContain('color=');
// (ChemDraw's colour 1 is white)
    expect(curves[1]).toContain('color="1"');
  });
});

describe('finding lab icons', () => {
  beforeAll(() => loadIcons());
  it('finds hazard signs and glassware by the words a chemist would use', () => {
    const hazards = findIcons('hazard').map((i) => i.id);
    for (const id of ['icon:biohazard', 'icon:radioactive', 'icon:skull-crossbones', 'icon:fire', 'icon:flash-triangle']) expect(hazards, id).toContain(id);
    expect(findIcons('rbf').map((i) => i.id)).toContain('icon:flask-round-bottom');
    expect(findIcons('pipette').map((i) => i.id)).toContain('icon:eyedropper');
    // the lab group starts with the glassware
    expect(findIcons('', LAB_GROUP)[0].id).toBe('icon:flask');
  });
});
