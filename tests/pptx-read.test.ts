// @vitest-environment jsdom
//
// Opening PowerPoint files: our own files come back as they were saved, and files made in
// PowerPoint come in as editable text, pictures, shapes and arrows, formatted as PowerPoint
// shows them.

import { describe, it, expect } from 'vitest';
import { Doc, Caption } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx, imageSize } from '../src/io/pptx-read';
import { Package, NS, REL } from '../src/io/ooxml';
import { boxOf } from '../src/objects';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const opts: PptxOptions = {
  async picture(doc) {
    const pts = [...doc.atoms.values()];
    if (!pts.length) return null;
    const b = boxOf(pts);
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', png: PNG, box: { x1: b.x1 - 5, y1: b.y1 - 5, x2: b.x2 + 5, y2: b.y2 + 5 } };
  },
  async svgToPng() { return PNG; },
};

const text = (c: Caption) => c.runs.map((r) => r.text).join('');

describe('opening files saved here', () => {
  it('gives back the slides, master, text, structures, pictures and notes as they were', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setMaster({ ...d.master, titleSize: 40, footer: 'Group meeting', logo: { src: DOT, px: { w: 1, h: 1 } } });
    const title = [...host.captions.values()].find((c) => c.ph === 'title')!;
    host.edit('Type', () => host.updateCaption(title.id, { runs: [{ text: 'Route to ' }, { text: 'taxol', italic: true }] }));
    d.addSlide('title-content');
    host.edit('Draw', () => {
      const L = host.style.bondLength;
      const a = host.addAtom(300, 300), b = host.addAtom(300 + L, 300), c = host.addAtom(300 + 1.5 * L, 300 + 0.87 * L, 8);
      host.addBond(a.id, b.id);
      host.addBond(b.id, c.id, 2);
      host.addShape({ kind: 'picture', x1: 600, y1: 300, x2: 700, y2: 380, src: DOT, px: { w: 1, h: 1 }, crop: { l: 0, t: 0.25, r: 0, b: 0 } });
    });
    const body = [...host.captions.values()].find((c) => c.ph === 'body')!;
    host.edit('Type', () => host.updateCaption(body.id, { runs: [{ text: 'One\nTwo' }], paras: [{ list: 'bullet' }, { list: 'bullet', level: 1 }] }));
    d.setNotes('Say hello');
    const before = d.slides.map((s, i) => d.docOf(i).contents());
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);

    const back = readPptx(bytes);
    expect(back.warnings).toEqual([]);
    expect(back.size).toEqual(d.size);
    expect(back.slides.map((s) => s.layout)).toEqual(['title', 'title-content']);
    expect(back.master.titleSize).toBe(40);
    expect(back.master.footer).toBe('Group meeting');
    expect(back.master.logo?.src).toBe(DOT);
    expect(back.slides[1].notes).toBe('Say hello');
    // text: the same captions, in the same places
    for (let i = 0; i < 2; i++) {
      const a = before[i].captions.map((c) => ({ ...c, id: 0 })).sort((p, q) => p.y - q.y);
      const b = back.slides[i].contents.captions.map((c) => ({ ...c, id: 0 })).sort((p, q) => p.y - q.y);
      expect(b.length).toBe(a.length);
      b.forEach((c, k) => {
        expect(text(c)).toBe(text(a[k]));
        expect(c.x).toBeCloseTo(a[k].x, 1);
        expect(c.y).toBeCloseTo(a[k].y, 1);
        expect(c.ph).toBe(a[k].ph);
        expect(c.runs).toEqual(a[k].runs);
        expect(c.paras).toEqual(a[k].paras);
      });
    }
    // the structure, where it was
    const atoms = back.slides[1].contents.atoms.sort((p, q) => p.x - q.x);
    const was = before[1].atoms.sort((p, q) => p.x - q.x);
    expect(atoms.map((a) => a.z)).toEqual([6, 6, 8]);
    atoms.forEach((a, k) => {
      expect(a.x).toBeCloseTo(was[k].x, 1);
      expect(a.y).toBeCloseTo(was[k].y, 1);
    });
    expect(back.slides[1].contents.bonds.map((b) => b.order).sort()).toEqual([1, 2]);
    // the picture with its cropping
    const pic = back.slides[1].contents.shapes.find((s) => s.kind === 'picture')!;
    expect(pic.crop).toEqual({ l: 0, t: 0.25, r: 0, b: 0 });
    expect([pic.x1, pic.y1, pic.x2, pic.y2]).toEqual([600, 300, 700, 380]);
  });
});

// ---------------------------------------------------------------- a file shaped like PowerPoint's own

const X = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const E = 12700;
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const xf = (x: number, y: number, w: number, h: number, extra = '') => `<a:xfrm${extra}><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/></a:xfrm>`;

function powerPointFile(): Uint8Array {
  const pkg = new Package();
  const ct = (t: string) => `application/vnd.openxmlformats-officedocument.${t}+xml`;
  pkg.defaultType('png', 'image/png');
  pkg.relate('', REL.officeDocument, 'ppt/presentation.xml');
  const P = 'ppt/presentation.xml';
  const mRel = pkg.relate(P, REL.slideMaster, 'slideMasters/slideMaster1.xml');
  const sRel = pkg.relate(P, REL.slide, 'slides/slide1.xml');
  pkg.add(P, `${H}<p:presentation ${X}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${mRel}"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="${sRel}"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/>` +
    `<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`, ct('presentationml.presentation.main'));
  // theme: Calibri fonts, a dark-blue text colour and a blue accent
  pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.theme, '../theme/theme1.xml');
  pkg.add('ppt/theme/theme1.xml', `${H}<a:theme xmlns:a="${NS.a}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2></a:clrScheme>` +
    `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`, ct('theme'));
  // master: title 44 (theme title font), body 28 with bullets, smaller on level 2
  const lRel = pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  pkg.add('ppt/slideMasters/slideMaster1.xml', `${H}<p:sldMaster ${X}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xf(36, 29, 648, 104)}</p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:t>Click</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xf(36, 144, 648, 343)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Click</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="${lRel}"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
    `<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>` +
    `<a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl2pPr></p:bodyStyle>` +
    `<p:otherStyle/></p:txStyles></p:sldMaster>`, ct('presentationml.slideMaster'));
  pkg.relate('ppt/slideLayouts/slideLayout1.xml', REL.slideMaster, '../slideMasters/slideMaster1.xml');
  pkg.add('ppt/slideLayouts/slideLayout1.xml', `${H}<p:sldLayout ${X} type="obj"><p:cSld name="Title and Content"><p:spTree>${GRP}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sldLayout>`, ct('presentationml.slideLayout'));
  // the slide
  const S = 'ppt/slides/slide1.xml';
  pkg.relate(S, REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  const img = pkg.relate(S, REL.image, '../media/image1.png');
  pkg.add('ppt/media/image1.png', PNG);
  pkg.add(S, `${H}<p:sld ${X}><p:cSld><p:spTree>${GRP}` +
    // title and body: no position of their own, so the layout's (and the master's) is used
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Results</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US"/><a:t>Yield </a:t></a:r><a:r><a:rPr lang="en-US" b="1"/><a:t>92%</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>after workup</a:t></a:r></a:p></p:txBody></p:sp>` +
    // a text box with a formula and a coloured word
    `<p:sp><p:nvSpPr><p:cNvPr id="4" name="TextBox 3"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xf(100, 400, 200, 30)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US" sz="1400"/><a:t>H</a:t></a:r><a:r><a:rPr lang="en-US" sz="1400" baseline="-25000"/><a:t>2</a:t></a:r><a:r><a:rPr lang="en-US" sz="1400"/><a:t>O </a:t></a:r><a:r><a:rPr lang="en-US" sz="1400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>wet</a:t></a:r></a:p></p:txBody></p:sp>` +
    // a filled box in the theme's accent colour (from its style), and an arrow
    `<p:sp><p:nvSpPr><p:cNvPr id="5" name="Rectangle 4"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(400, 400, 100, 50)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>` +
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Arrow 5"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xf(300, 300, 100, 0, ' flipH="1"')}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>` +
    // a group, half size, holding a cropped picture
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="Group 6"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${600 * E}" y="${100 * E}"/><a:ext cx="${50 * E}" cy="${50 * E}"/><a:chOff x="0" y="0"/><a:chExt cx="${100 * E}" cy="${100 * E}"/></a:xfrm></p:grpSpPr>` +
    `<p:pic><p:nvPicPr><p:cNvPr id="8" name="Picture 7"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${img}"/><a:srcRect l="10000" b="5000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xf(20, 20, 80, 60)}</p:spPr></p:pic></p:grpSp>` +
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table 8"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl/></a:graphicData></a:graphic></p:graphicFrame>` +
    `</p:spTree></p:cSld></p:sld>`, ct('presentationml.slide'));
  return pkg.build();
}

describe('opening files made in PowerPoint', () => {
  const back = readPptx(powerPointFile());
  const caps = back.slides[0].contents.captions;

  it('reads the size, layout and master from PowerPoint\'s master and theme', () => {
    expect(back.size).toEqual({ w: 720, h: 540 });
    expect(back.slides[0].layout).toBe('title-content');
    expect(back.master.titleFont).toBe('Calibri Light');
    expect(back.master.bodyFont).toBe('Calibri');
    expect(back.master.titleSize).toBe(44);
    expect(back.master.bodySize).toBe(28);
    expect(back.master.titleColor).toBe('#44546a');
    expect(back.master.background).toBe('#ffffff');
    expect(back.master.slideNumbers).toBe(false);
  });

  it('makes titles and text placeholders, placed by the layout and master', () => {
    const title = caps.find((c) => c.ph === 'title')!;
    expect(text(title)).toBe('Results');
    // formatted by the master, so nothing of its own
    expect(title.runs).toEqual([{ text: 'Results' }]);
    expect(title.x).toBeCloseTo(36 + 7.2);
    expect(title.wrap).toBeCloseTo(648 - 14.4);
    // centred up and down in its box, as the master says
    expect(title.y).toBeGreaterThan(29 + 30);
    const body = caps.find((c) => c.ph === 'body')!;
    expect(body.runs).toEqual([{ text: 'Yield ' }, { text: '92%\n', bold: true }, { text: 'after workup', size: 24 }]);
    expect(body.paras).toEqual([{ list: 'bullet' }, { list: 'bullet', level: 1 }]);
  });

  it('keeps text box formatting: sizes, subscripts and colours', () => {
    const box = caps.find((c) => !c.ph)!;
    expect(box.runs).toEqual([
      { text: 'H', size: 14, font: 'Calibri' }, { text: '2', size: 14, font: 'Calibri', sub: true },
      { text: 'O ', size: 14, font: 'Calibri' }, { text: 'wet', size: 14, font: 'Calibri', color: '#ff0000' },
    ]);
    expect(box.x).toBeCloseTo(107.2);
    expect(box.wrap).toBeUndefined();
  });

  it('brings in shapes, arrows and grouped pictures where PowerPoint shows them', () => {
    const shapes = back.slides[0].contents.shapes;
    const rect = shapes.find((s) => s.kind === 'rect')!;
    expect(rect.filled).toBe(true);
    expect(rect.color).toBe('#4472c4');
    const arrow = back.slides[0].contents.arrows[0];
    // flipped: drawn from right to left, the head at its end
    expect(arrow.tail).toEqual({ x: 400, y: 300 });
    expect(arrow.head).toEqual({ x: 300, y: 300 });
    expect(arrow.lineWidth).toBeCloseTo(1.5);
    const pic = shapes.find((s) => s.kind === 'picture')!;
    expect([pic.x1, pic.y1, pic.x2, pic.y2]).toEqual([610, 110, 650, 140]);
    expect(pic.crop).toEqual({ l: 0.1, t: 0, r: 0, b: 0.05 });
    expect(pic.px).toEqual({ w: 40, h: 30 });
    expect(back.warnings.some((w) => /Tables/.test(w))).toBe(true);
  });
});

describe('picture sizes', () => {
  it('reads the size from PNG, GIF and SVG headers', () => {
    expect(imageSize(PNG, 'image/png')).toEqual({ w: 40, h: 30 });
    expect(imageSize(new Uint8Array([71, 73, 70, 56, 57, 97, 3, 0, 2, 0, 0]), 'image/gif')).toEqual({ w: 3, h: 2 });
    expect(imageSize(new TextEncoder().encode('<svg viewBox="0 0 120 80"></svg>'), 'image/svg+xml')).toEqual({ w: 120, h: 80 });
  });
});
