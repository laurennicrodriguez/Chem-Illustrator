// @vitest-environment jsdom
//
// Slide backgrounds (Design > Format Background): a slide's own colour, gradient, picture or
// pattern, see-through as set, or every slide's through the master; saved as PowerPoint's own
// backgrounds, and PowerPoint's backgrounds (the theme's included) opened as they were.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { Deck, slideBackground } from '../src/deck/deck';
import { backgroundColour, linearEnds, patternBit, pictureFrame, PATTERN_LIST, type Background } from '../src/deck/background';
import { applyTemplate, SLIDE_TEMPLATES } from '../src/deck/templates';
import { writePptx, masterSettings, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { Package, NS, REL } from '../src/io/ooxml';

// a 40 × 30 PNG (its header is enough to know its size)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const PIC = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

const GRAD: Background = { kind: 'gradient', shape: 'linear', angle: 90, stops: [{ pos: 0, color: '#ffffff' }, { pos: 0.6, color: '#d6e4f5', transparency: 0.25 }, { pos: 1, color: '#2f5d8a' }] };
const RADIAL: Background = { kind: 'gradient', shape: 'radial', angle: 0, focus: { x: 0, y: 1 }, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }] };
const TILE: Background = { kind: 'picture', src: PIC, px: { w: 40, h: 30 }, fit: 'tile', transparency: 0.4, tile: { sx: 0.5, sy: 0.5, tx: 12, ty: -6, align: 'ctr', mirror: 'xy' } };
const FILLED: Background = { kind: 'picture', src: PIC, px: { w: 40, h: 30 }, fit: 'fill' };
const PATTERN: Background = { kind: 'pattern', pattern: 'dkUpDiag', fg: '#1f5fbf', bg: '#f4f6f8' };

function deck(): { d: Deck; host: Doc } {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.addSlide('title-content');
  d.addSlide('title-content');
  d.addSlide('blank');
  return { d, host };
}

const save = (d: Deck) => writePptx({
  size: d.size, master: d.master,
  slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, background: s.background, hideGraphics: s.hideGraphics })),
}, opts);

describe('backgrounds on slides', () => {
  it('gives the slides picked their own background, undoes it in one step, and resets it to the master\'s', () => {
    const { d, host } = deck();
    d.setBackground(GRAD, [1, 2]);
    expect(d.slides[1].background).toEqual(GRAD);
    expect(d.slides[2].background).toEqual(GRAD);
    expect(d.slides[0].background).toBeUndefined();
    // the drawing behind the slide takes the background's main colour
    expect(d.docOf(1).background).toBe('#ffffff');
    expect(d.page(1).own).toEqual(GRAD);
    d.undo();
    expect(d.slides[1].background).toBeUndefined();
    expect(d.slides[2].background).toBeUndefined();
    d.redo();
    d.setBackground(undefined, [1]);
    expect(d.slides[1].background).toBeUndefined();
    expect(d.slides[2].background).toEqual(GRAD);
    expect(host).toBeTruthy();
  });

  it('applies to every slide through the master, title slides too, with no slide keeping its own', () => {
    const { d } = deck();
    d.setMaster(applyTemplate(d.master, SLIDE_TEMPLATES.find((t) => t.titleSlide)!));
    d.setBackground(PATTERN, [2]);
    d.setAllBackgrounds(RADIAL, true);
    expect(d.slides.every((s) => !s.background && s.hideGraphics)).toBe(true);
    expect(d.master.fill).toEqual(RADIAL);
    expect(d.master.titleSlide?.fill).toEqual(RADIAL);
    expect(slideBackground(d.master, 'title')).toEqual(RADIAL);
    expect(slideBackground(d.master, 'blank')).toEqual(RADIAL);
    d.undo();
    expect(d.slides[2].background).toEqual(PATTERN);
    expect(d.master.fill).toBeUndefined();
    // a plain colour for all is the master's colour, as before
    d.setAllBackgrounds({ kind: 'solid', color: '#fdfdfb' });
    expect(d.master.fill).toBeUndefined();
    expect(d.master.background).toBe('#fdfdfb');
    // and a template's colours take the place of a gradient
    d.setAllBackgrounds(GRAD);
    expect(applyTemplate(d.master, SLIDE_TEMPLATES[0]).fill).toBeUndefined();
  });

  it('keeps a slide\'s background when it is duplicated', () => {
    const { d } = deck();
    d.setBackground(TILE, [1], true);
    d.duplicate([1]);
    expect(d.slides[2].background).toEqual(TILE);
    expect(d.slides[2].hideGraphics).toBe(true);
    expect(d.slides[2].background).not.toBe(d.slides[1].background);
  });

  it('works out where gradients run, where pictures go, and what a see-through colour looks like', () => {
    // top to bottom on a 960 × 540 slide: from the top edge to the bottom one
    const e = linearEnds(90, 960, 540);
    expect(e.x0).toBeCloseTo(480); expect(e.y0).toBeCloseTo(0); expect(e.y1).toBeCloseTo(540);
    // a 4:3 picture filling a 16:9 slide loses some of its top and bottom; fitting it leaves room at the sides
    const fill = pictureFrame({ kind: 'picture', src: PIC, px: { w: 400, h: 300 }, fit: 'fill' }, 960, 540);
    expect(fill.crop.t).toBeCloseTo(0.125); expect(fill.crop.l).toBe(0);
    const fit = pictureFrame({ kind: 'picture', src: PIC, px: { w: 400, h: 300 }, fit: 'fit' }, 960, 540);
    expect(fit.offsets.l).toBeCloseTo(0.125); expect(fit.offsets.t).toBe(0);
    expect(backgroundColour({ kind: 'solid', color: '#000000', transparency: 0.75 })).toBe('#bfbfbf');
    // every pattern has some of each colour, except where it is meant to be nearly solid
    for (const p of PATTERN_LIST) {
      let on = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (patternBit(p.id, x, y)) on++;
      expect(on, p.id).toBeGreaterThan(0);
      expect(on, p.id).toBeLessThan(64);
    }
  });
});

describe('backgrounds in PowerPoint files', () => {
  it('saves each slide\'s background as PowerPoint\'s own, and hidden background graphics', async () => {
    const { d } = deck();
    d.setBackground(GRAD, [1]);
    d.setBackground(TILE, [2], true);
    d.setBackground(PATTERN, [3]);
    const files = unzipSync(await save(d));
    const slide = (i: number) => strFromU8(files[`ppt/slides/slide${i}.xml`]);
    expect(slide(1)).not.toContain('<p:bg>');
    expect(slide(2)).toContain('<p:bg><p:bgPr><a:gradFill');
    expect(slide(2)).toContain('<a:gs pos="60000"><a:srgbClr val="D6E4F5"><a:alpha val="75000"/></a:srgbClr></a:gs>');
    expect(slide(2)).toContain('<a:lin ang="5400000" scaled="0"/>');
    expect(slide(3)).toContain('showMasterSp="0"');
    expect(slide(3)).toMatch(/<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId\d+"><a:alphaModFix amt="60000"\/><\/a:blip><a:srcRect\/><a:tile tx="152400" ty="-76200" sx="50000" sy="50000" flip="xy" algn="ctr"\/>/);
    // the picture is in the file, linked from the slide
    const rels = strFromU8(files['ppt/slides/_rels/slide3.xml.rels']);
    const target = /Target="\.\.\/media\/(image\d+\.png)"/.exec(rels)![1];
    expect(files[`ppt/media/${target}`]).toBeTruthy();
    expect(slide(4)).toContain('<a:pattFill prst="dkUpDiag"><a:fgClr><a:srgbClr val="1F5FBF"/></a:fgClr><a:bgClr><a:srgbClr val="F4F6F8"/></a:bgClr></a:pattFill>');
  });

  it('opens its own files with every background as it was', async () => {
    const { d } = deck();
    d.setBackground(GRAD, [1]);
    d.setBackground(TILE, [2], true);
    d.setBackground(FILLED, [3]);
    const back = readPptx(await save(d));
    expect(back.warnings).toEqual([]);
    expect(back.slides[0].background).toBeUndefined();
    expect(back.slides[1].background).toEqual(GRAD);
    expect(back.slides[2].background).toEqual(TILE);
    expect(back.slides[2].hideGraphics).toBe(true);
    // a picture filling the slide is cut to fit when saved, and comes back as filling it
    expect(back.slides[3].background).toEqual(FILLED);
  });

  it('keeps the master\'s and title slides\' backgrounds in PowerPoint\'s master and layout, not in its settings tag', async () => {
    const { d } = deck();
    d.setMaster(applyTemplate(d.master, SLIDE_TEMPLATES.find((t) => t.titleSlide)!));
    d.setAllBackgrounds(FILLED);
    expect(masterSettings(d.master).fill).toBeUndefined();
    expect(masterSettings(d.master).titleSlide?.fill).toBeUndefined();
    const bytes = await save(d);
    const files = unzipSync(bytes);
    expect(strFromU8(files['ppt/slideMasters/slideMaster1.xml'])).toContain('<p:bg><p:bgPr><a:blipFill');
    const back = readPptx(bytes);
    expect(back.master.fill).toEqual(FILLED);
    expect(back.master.titleSlide?.fill).toEqual(FILLED);
    expect(back.slides.every((s) => !s.background)).toBe(true);
  });
});

// ---------------------------------------------------------------- a file shaped like PowerPoint's own

const X = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const ct = (t: string) => `application/vnd.openxmlformats-officedocument.${t}+xml`;

/**
 * A theme whose third background style is a gradient in the colour it's used with (as PowerPoint's
 * built-in themes have); a master using it; a Title Slide layout with a tiled picture; and slides:
 * a title slide, one with a pattern and the master's graphics hidden, one with nothing of its own.
 */
function powerPointFile(): Uint8Array {
  const pkg = new Package();
  pkg.defaultType('png', 'image/png');
  pkg.relate('', REL.officeDocument, 'ppt/presentation.xml');
  const P = 'ppt/presentation.xml';
  const mRel = pkg.relate(P, REL.slideMaster, 'slideMasters/slideMaster1.xml');
  const sRels = [1, 2, 3].map((i) => pkg.relate(P, REL.slide, `slides/slide${i}.xml`));
  pkg.add(P, `${H}<p:presentation ${X}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${mRel}"/></p:sldMasterIdLst><p:sldIdLst>${sRels.map((r, i) => `<p:sldId id="${256 + i}" r:id="${r}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`, ct('presentationml.presentation.main'));
  const M = 'ppt/slideMasters/slideMaster1.xml';
  pkg.relate(M, REL.theme, '../theme/theme1.xml');
  const phFill = (inner: string) => `<a:solidFill><a:schemeClr val="phClr">${inner}</a:schemeClr></a:solidFill>`;
  pkg.add('ppt/theme/theme1.xml', `${H}<a:theme xmlns:a="${NS.a}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3552"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>` +
    `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Office"><a:fillStyleLst>${phFill('')}${phFill('')}${phFill('')}</a:fillStyleLst><a:lnStyleLst/><a:effectStyleLst/>` +
    `<a:bgFillStyleLst>${phFill('')}${phFill('<a:tint val="95000"/>')}<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>` +
    `</a:themeElements></a:theme>`, ct('theme'));
  const lRels = [1, 2].map((i) => pkg.relate(M, REL.slideLayout, `../slideLayouts/slideLayout${i}.xml`));
  pkg.add(M, `${H}<p:sldMaster ${X}><p:cSld><p:bg><p:bgRef idx="1003"><a:schemeClr val="bg2"/></p:bgRef></p:bg><p:spTree>${GRP}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>${lRels.map((r, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="${r}"/>`).join('')}</p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`, ct('presentationml.slideMaster'));
  const L1 = 'ppt/slideLayouts/slideLayout1.xml';
  pkg.relate(L1, REL.slideMaster, '../slideMasters/slideMaster1.xml');
  const img = pkg.relate(L1, REL.image, '../media/image1.png');
  pkg.add('ppt/media/image1.png', PNG);
  pkg.add(L1, `${H}<p:sldLayout ${X} type="title"><p:cSld name="Title Slide"><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${img}"><a:alphaModFix amt="80000"/></a:blip><a:srcRect/><a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/></a:blipFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}</p:spTree></p:cSld></p:sldLayout>`, ct('presentationml.slideLayout'));
  const L2 = 'ppt/slideLayouts/slideLayout2.xml';
  pkg.relate(L2, REL.slideMaster, '../slideMasters/slideMaster1.xml');
  pkg.add(L2, `${H}<p:sldLayout ${X} type="obj"><p:cSld name="Title and Content"><p:spTree>${GRP}</p:spTree></p:cSld></p:sldLayout>`, ct('presentationml.slideLayout'));
  const slide = (i: number, layout: string, attrs: string, bg: string) => {
    const S = `ppt/slides/slide${i}.xml`;
    pkg.relate(S, REL.slideLayout, `../slideLayouts/${layout}`);
    pkg.add(S, `${H}<p:sld ${X}${attrs}><p:cSld>${bg}<p:spTree>${GRP}</p:spTree></p:cSld></p:sld>`, ct('presentationml.slide'));
  };
  slide(1, 'slideLayout1.xml', '', '');
  slide(2, 'slideLayout2.xml', ' showMasterSp="0"', '<p:bg><p:bgPr><a:pattFill prst="smGrid"><a:fgClr><a:schemeClr val="accent1"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill><a:effectLst/></p:bgPr></p:bg>');
  slide(3, 'slideLayout2.xml', '', '');
  return pkg.build();
}

describe('backgrounds from PowerPoint', () => {
  const back = readPptx(powerPointFile());

  it('reads the theme\'s background gradient used by the master, in the colour it is used with', () => {
    const fill = back.master.fill!;
    expect(fill.kind).toBe('gradient');
    if (fill.kind !== 'gradient') return;
    expect(fill.shape).toBe('linear');
    expect(fill.angle).toBe(90);
    expect(fill.scaled).toBe(true);
    // E7E6E6 (the theme's lt2, for bg2) at full strength at the bottom, tinted lighter at the top
    expect(fill.stops[1].color).toBe('#e7e6e6');
    expect(fill.stops[0].color).toBe('#f3f3f3');
    expect(back.master.background).toBe('#f3f3f3');
    expect(back.slides[2].background).toBeUndefined();
  });

  it('gives slides their layout\'s picture background, and their own patterns, with background graphics hidden', () => {
    expect(back.slides[0].layout).toBe('title');
    expect(back.slides[0].background).toEqual({ kind: 'picture', src: PIC, px: { w: 40, h: 30 }, fit: 'tile', transparency: expect.closeTo(0.2, 6), tile: { sx: 1, sy: 1, tx: 0, ty: 0, align: 'tl', mirror: 'none' } });
    expect(back.slides[1].background).toEqual({ kind: 'pattern', pattern: 'smGrid', fg: '#4472c4', bg: '#ffffff' });
    expect(back.slides[1].hideGraphics).toBe(true);
    expect(back.warnings).toEqual([]);
  });
});
