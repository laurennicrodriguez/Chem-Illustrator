// @vitest-environment jsdom
//
// The structure of a deck: sections (folded and moved as a block, kept in PowerPoint's own
// section list), the slide master's layouts (built-in ones changed, new ones made, deleted, and
// PowerPoint's custom layouts read in), themes of your own, and slides of any size, with what is
// on them scaled to fit.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc } from '../src/model';
import {
  Deck, WIDE, STANDARD, defaultMaster, deckLayouts, layoutDef, layoutFrames, builtinLayout, contentArea, titleLook, slideColours,
  type LayoutDef,
} from '../src/deck/deck';
import { applyTemplate, themeFromMaster, parseThemes, SLIDE_TEMPLATES, newThemeId } from '../src/deck/templates';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

function deck(n = 4): Deck {
  const d = Deck.blank(new Doc());
  d.attach();
  for (let i = 1; i < n; i++) d.addSlide('title-content');
  return d;
}

const save = (d: Deck) => writePptx({
  size: d.size, master: d.master, sections: d.sectionCounts(),
  slides: d.slides.map((s, i) => ({ id: s.id, layout: s.layout, doc: d.docOf(i), notes: s.notes })),
}, opts);

const files = async (d: Deck) => unzipSync(await save(d));
/** Text as bytes this test's zip writer takes (jsdom's own arrays are not). */
const u8 = (t: string): Uint8Array => { const b = strToU8(t), out = new Uint8Array(b.length); out.set(b); return out; };

/** Open a saved deck as the app does. */
function reopen(bytes: Uint8Array): Deck {
  const got = readPptx(bytes);
  const d = new Deck(new Doc());
  d.load(got.slides.map((s) => d.makeSlide(s.layout, s.contents, s.notes, s, got.master)), got.size, got.master, got.sections);
  return d;
}

const ids = (d: Deck) => d.slides.map((s) => s.id);
const spans = (d: Deck) => d.sectionSpans().map((x) => `${x.section.name}:${x.count}`);

describe('sections', () => {
  it('puts the slides before the first section in a Default Section, as PowerPoint does', () => {
    const d = deck(5);
    d.addSection(2, 'Results');
    expect(spans(d)).toEqual(['Default Section:2', 'Results:3']);
    expect(d.sectionOf(1)?.name).toBe('Default Section');
    expect(d.sectionOf(4)?.name).toBe('Results');
    d.undo();
    expect(d.sections).toEqual([]);
    expect(d.slides.every((s) => s.section === undefined)).toBe(true);
    d.redo();
    expect(spans(d)).toEqual(['Default Section:2', 'Results:3']);
  });

  it('splits a section, renames it, and new slides join the section of the slide before them', () => {
    const d = deck(6);
    d.addSection(0, 'Intro');
    d.addSection(3, 'Scope');
    expect(spans(d)).toEqual(['Intro:3', 'Scope:3']);
    d.go(1);
    d.addSlide();
    expect(spans(d)).toEqual(['Intro:4', 'Scope:3']);
    d.duplicate([5]);
    expect(spans(d)).toEqual(['Intro:4', 'Scope:4']);
    const scope = d.sections[1].id;
    d.renameSection(scope, '  Substrate scope ');
    expect(d.sections[1].name).toBe('Substrate scope');
    d.undo();
    expect(d.sections[1].name).toBe('Scope');
  });

  it('moves a section with all its slides as one step', () => {
    const d = deck(6);
    d.addSection(0, 'A');
    d.addSection(2, 'B');
    d.addSection(4, 'C');
    const before = ids(d);
    const c = d.sections[2].id;
    d.moveSection(c, 0);
    expect(d.sections.map((x) => x.name)).toEqual(['C', 'A', 'B']);
    expect(ids(d)).toEqual([...before.slice(4), ...before.slice(0, 4)]);
    d.undo();
    expect(ids(d)).toEqual(before);
    expect(d.sections.map((x) => x.name)).toEqual(['A', 'B', 'C']);
  });

  it('moves slides into another section: after a slide, or onto its heading', () => {
    const d = deck(6);
    d.addSection(0, 'A');
    d.addSection(3, 'B');
    const [s0, , , s3] = d.slides;
    // the first slide dropped after the fourth (in B)
    d.move([0], 3);
    expect(d.slides[3]).toBe(s0);
    expect(d.sectionOf(3)?.name).toBe('B');
    expect(spans(d)).toEqual(['A:2', 'B:4']);
    d.undo();
    expect(d.slides[0]).toBe(s0);
    expect(spans(d)).toEqual(['A:3', 'B:3']);
    // B's first slide dropped on B's heading stays in B; onto A's heading it goes to the start of A
    d.move([3], 0, d.sections[0].id);
    expect(d.slides[0]).toBe(s3);
    expect(spans(d)).toEqual(['A:4', 'B:2']);
  });

  it('removes a section (its slides join the one before), or a section and its slides', () => {
    const d = deck(6);
    d.addSection(0, 'A');
    d.addSection(2, 'B');
    d.addSection(4, 'C');
    d.removeSection(d.sections[1].id);
    expect(spans(d)).toEqual(['A:4', 'C:2']);
    d.removeSection(d.sections[0].id, true);
    expect(d.slides.length).toBe(2);
    expect(spans(d)).toEqual(['C:2']);
    // the last slides can't all go
    expect(d.removeSection(d.sections[0].id, true)).toBe(false);
    d.removeSection(d.sections[0].id);
    expect(d.sections).toEqual([]);
    d.undo(); d.undo();
    expect(d.slides.length).toBe(6);
    expect(spans(d)).toEqual(['A:4', 'C:2']);
  });

  it('folds sections on screen only, and never the one being edited', () => {
    const d = deck(4);
    d.addSection(2, 'B');
    const edits = d.edits;
    d.foldAll(true);
    expect(d.folded.size).toBe(2);
    expect(d.edits).toBe(edits);
    expect(d.canUndo()).toBe(true);
    d.undo(); // the fold is not a step: Undo takes back Add Section
    expect(d.sections).toEqual([]);
  });

  it('saves sections as PowerPoint\'s own section list and reads them back', async () => {
    const d = deck(5);
    d.addSection(0, 'Intro & aims');
    d.addSection(3, 'Results');
    const f = await files(d);
    const pres = strFromU8(f['ppt/presentation.xml']);
    expect(pres).toContain('{521415D9-36F7-43E2-AB2F-B90AF26B5E84}');
    expect(pres).toContain('<p14:section name="Intro &amp; aims"');
    expect(pres).toMatch(/<p14:section name="Results" id="\{[0-9A-F-]+\}"><p14:sldIdLst><p14:sldId id="259"\/><p14:sldId id="260"\/><\/p14:sldIdLst>/);
    // the section list comes last in the presentation, as the schema has it
    expect(pres.indexOf('<p:extLst>')).toBeGreaterThan(pres.indexOf('</p:defaultTextStyle>'));
    const back = reopen(await save(d));
    expect(spans(back)).toEqual(['Intro & aims:3', 'Results:2']);
  });

  it('reads PowerPoint\'s sections, an empty one too', async () => {
    const d = deck(3);
    const f = await files(d);
    const pres = strFromU8(f['ppt/presentation.xml']).replace('</p:presentation>',
      '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">' +
      '<p14:section name="One" id="{11111111-0000-0000-0000-000000000001}"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section>' +
      '<p14:section name="Empty" id="{11111111-0000-0000-0000-000000000002}"><p14:sldIdLst/></p14:section>' +
      '<p14:section name="Two" id="{11111111-0000-0000-0000-000000000003}"><p14:sldIdLst><p14:sldId id="257"/><p14:sldId id="258"/></p14:sldIdLst></p14:section>' +
      '</p14:sectionLst></p:ext></p:extLst></p:presentation>');
    f['ppt/presentation.xml'] = u8(pres);
    const back = reopen(zipSync(f));
    expect(spans(back)).toEqual(['One:1', 'Empty:0', 'Two:2']);
  });
});

describe('layouts in the slide master', () => {
  it('lists the five built-in layouts, then the deck\'s own', () => {
    const m = defaultMaster();
    expect(deckLayouts(m).map((l) => l.id)).toEqual(['title', 'title-content', 'two-content', 'title-only', 'blank']);
    m.layouts = [{ id: 'u1', name: 'Scheme', boxes: [] }, { ...builtinLayout('blank'), name: 'Empty' }];
    expect(deckLayouts(m).map((l) => l.name)).toEqual(['Title Slide', 'Title and Content', 'Two Content', 'Title Only', 'Empty', 'Scheme']);
    // a layout the deck doesn't have is drawn as Title and Content
    expect(layoutDef(m, 'u9').id).toBe('title-content');
  });

  it('moves the placeholders of slides with a changed layout, in one undo step', () => {
    const d = deck(3);
    const edited = deckLayouts(d.master).map((l) => (l.id === 'title-content' ? { ...l, boxes: [{ ph: 'title' as const, x: 0.1, y: 0.7, w: 0.8, h: 0.2, justify: 'center' as const }, { ph: 'body' as const, x: 0.1, y: 0.1, w: 0.8, h: 0.55, justify: 'left' as const }] } : l));
    d.setLayouts(edited);
    const title = [...d.docOf(1).captions.values()].find((c) => c.ph === 'title')!;
    expect(title.x).toBeCloseTo(0.1 * WIDE.w);
    expect(title.justify).toBe('center');
    expect(title.wrap).toBeCloseTo(0.8 * WIDE.w);
    // the title slide is as it was
    const t0 = [...d.docOf(0).captions.values()].find((c) => c.ph === 'title')!;
    expect(t0.justify).toBe('center');
    expect(t0.x).toBeCloseTo(0.08 * WIDE.w);
    d.undo();
    expect([...d.docOf(1).captions.values()].find((c) => c.ph === 'title')!.x).toBeCloseTo(0.05 * WIDE.w);
    expect(d.master.layouts).toBeUndefined();
  });

  it('makes a layout of its own, uses it, and deleting it gives its slides Title and Content', () => {
    const d = deck(2);
    const scheme: LayoutDef = { id: 'u1', name: 'Scheme with Caption', boxes: [{ ph: 'title', x: 0.05, y: 0.04, w: 0.9, h: 0.1, justify: 'left' }, { ph: 'body', x: 0.05, y: 0.8, w: 0.9, h: 0.15, justify: 'center' }] };
    d.setLayouts([...deckLayouts(d.master), scheme]);
    d.setLayout('u1', 1);
    expect(d.slides[1].layout).toBe('u1');
    const caps = [...d.docOf(1).captions.values()].filter((c) => c.ph);
    expect(caps.map((c) => c.ph).sort()).toEqual(['body', 'title']);
    expect(caps.find((c) => c.ph === 'body')!.justify).toBe('center');
    // things pasted go where the layout's text is
    expect(contentArea('u1', d.size, d.master).y1).toBeCloseTo(0.8 * d.size.h);
    d.setLayouts(deckLayouts(d.master).filter((l) => l.id !== 'u1'));
    expect(d.slides[1].layout).toBe('title-content');
    d.undo();
    expect(d.slides[1].layout).toBe('u1');
  });

  it('gives a layout the title slide\'s own colours when asked', () => {
    const m = { ...defaultMaster(), titleSlide: { background: '#101820', titleColor: '#ffffff', textColor: '#cccccc' }, layouts: [{ id: 'u1', name: 'Section Header', boxes: [], titleLook: true }] };
    expect(titleLook(m, 'u1')).toBe(true);
    expect(slideColours(m, 'u1').background).toBe('#101820');
    expect(slideColours(m, 'title-content').background).toBe('#ffffff');
  });

  it('saves its layouts as PowerPoint layouts, named, with their placeholders, and opens them again', async () => {
    const d = deck(2);
    d.setLayouts([...deckLayouts(d.master).map((l) => (l.id === 'blank' ? { ...l, name: 'Nothing' } : l)),
      { id: 'u1', name: 'Two Schemes', boxes: [{ ph: 'title', x: 0.05, y: 0.05, w: 0.9, h: 0.12, justify: 'left' }, { ph: 'body', x: 0.05, y: 0.2, w: 0.43, h: 0.7, justify: 'left' }, { ph: 'subtitle', x: 0.52, y: 0.2, w: 0.43, h: 0.1, justify: 'right' }] }]);
    d.setLayout('u1', 1);
    const f = await files(d);
    const layout6 = strFromU8(f['ppt/slideLayouts/slideLayout6.xml']);
    expect(layout6).toContain('type="cust"');
    expect(layout6).toContain('name="Two Schemes"');
    expect(layout6).toContain('<p:ph type="title"/>');
    expect(layout6).toContain('<p:ph idx="1"/>');
    expect(layout6).toContain('<p:ph type="subTitle" idx="2"/>');
    expect(strFromU8(f['ppt/slideLayouts/slideLayout5.xml'])).toContain('name="Nothing"');
    expect(strFromU8(f['ppt/slideMasters/slideMaster1.xml']).match(/<p:sldLayoutId /g)).toHaveLength(6);
    expect(strFromU8(f['ppt/slides/_rels/slide2.xml.rels'])).toContain('slideLayout6.xml');
    const back = reopen(await save(d));
    expect(back.slides[1].layout).toBe('u1');
    expect(layoutDef(back.master, 'u1').name).toBe('Two Schemes');
    expect(layoutDef(back.master, 'blank').name).toBe('Nothing');
  });

  it('reads PowerPoint\'s own custom layouts as layouts of the master', async () => {
    const d = deck(2);
    d.setLayouts([...deckLayouts(d.master), { id: 'u1', name: 'Picture Caption', boxes: [{ ph: 'title', x: 0.1, y: 0.75, w: 0.8, h: 0.1, justify: 'center' }, { ph: 'body', x: 0.1, y: 0.1, w: 0.8, h: 0.6, justify: 'left' }] }]);
    d.setLayout('u1', 1);
    const f = await files(d);
    // as PowerPoint would have it: none of our own notes on the presentation or the slides
    f['ppt/presentation.xml'] = u8(strFromU8(f['ppt/presentation.xml']).replace(/<p:custDataLst>.*?<\/p:custDataLst>/, ''));
    for (const k of Object.keys(f)) if (/^ppt\/slides\/slide\d+\.xml$/.test(k)) f[k] = u8(strFromU8(f[k]).replace(/<p:custDataLst><p:tags r:id="[^"]+"\/><\/p:custDataLst><\/p:cSld>/, '</p:cSld>'));
    const got = readPptx(zipSync(f));
    const own = got.master.layouts?.find((l) => l.name === 'Picture Caption');
    expect(own).toBeTruthy();
    expect(got.slides[1].layout).toBe(own!.id);
    const t = own!.boxes.find((b) => b.ph === 'title')!;
    expect(t.y).toBeCloseTo(0.75, 2);
    expect(t.justify).toBe('center');
    expect(got.slides[0].layout).toBe('title');
  });

  it('brings a pasted slide\'s own layout with it into another deck', () => {
    const a = deck(2);
    a.setLayouts([...deckLayouts(a.master), { id: 'u1', name: 'Mine', boxes: [{ ph: 'title', x: 0.2, y: 0.2, w: 0.6, h: 0.1, justify: 'left' }] }]);
    a.setLayout('u1', 1);
    const b = Deck.blank(new Doc());
    b.pasteSlides(a.copySlides([1]));
    expect(b.slides[1].layout).toBe('u1');
    expect(layoutDef(b.master, 'u1').name).toBe('Mine');
    b.undo();
    expect(b.slides.length).toBe(1);
    expect(b.master.layouts).toBeUndefined();
  });

  it('puts placeholders where the layout says on any slide size', () => {
    const f = layoutFrames('two-content', STANDARD);
    expect(f[2].x).toBeCloseTo(0.51 * 720);
  });
});

describe('slide size', () => {
  it('scales what is on the slides to fit a new size, or keeps it as it is, centred', () => {
    const d = deck(2);
    d.go(1);
    let a = 0;
    d.host.edit('Atom', () => { a = d.host.addAtom(480, 270).id; d.host.addAtom(520, 270); });
    d.setSize({ w: 480, h: 540 }, 'fit');
    const at = d.docOf(1).atoms.get(a)!;
    expect(at.x).toBeCloseTo(240);
    expect(at.y).toBeCloseTo(270);
    expect(at.s).toBeCloseTo(0.5);
    d.undo();
    expect(d.size).toEqual(WIDE);
    expect(d.docOf(1).atoms.get(a)!.x).toBeCloseTo(480);
    d.setSize({ w: 720, h: 540 });
    expect(d.docOf(1).atoms.get(a)!.x).toBeCloseTo(360);
    expect(d.docOf(1).atoms.get(a)!.s ?? 1).toBe(1);
  });

  it('saves any size, named Custom', async () => {
    const d = deck(1);
    d.setSize({ w: 576, h: 72 });
    const f = await files(d);
    expect(strFromU8(f['ppt/presentation.xml'])).toContain('<p:sldSz cx="7315200" cy="914400"/>');
    expect(strFromU8(f['docProps/app.xml'])).toContain('<PresentationFormat>Custom</PresentationFormat>');
    expect(readPptx(await save(d)).size).toEqual({ w: 576, h: 72 });
  });
});

describe('themes of your own', () => {
  it('makes a theme from a deck\'s look and applies it to another deck', () => {
    const m = applyTemplate(defaultMaster(), SLIDE_TEMPLATES.find((t) => t.id === 'midnight')!);
    const mine = themeFromMaster({ ...m, accent: '#123456' }, 'Group look', newThemeId([]));
    expect(mine).toMatchObject({ id: 'mine-1', group: 'Mine', accent: '#123456', titleFont: 'Inter' });
    expect(mine.titleSlide?.background).toBe('#0f1b2d');
    const n = applyTemplate(defaultMaster(), mine);
    expect(n.template).toBe('Group look');
    expect(n.accent).toBe('#123456');
    expect(n.titleSlide?.titleColor).toBe('#ffffff');
  });

  it('reads themes back from the settings, leaving out what it cannot read', () => {
    const got = parseThemes([{ id: 'mine-2', name: 'X', background: 'red', decor: 'zigzag', titleBold: false }, { name: 'no id' }, 7]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: 'mine-2', background: '#ffffff', decor: 'none', titleBold: false, group: 'Mine' });
  });

  it('names the PowerPoint theme after the theme used', async () => {
    const d = deck(1);
    d.setMaster(applyTemplate(d.master, SLIDE_TEMPLATES.find((t) => t.id === 'harbor')!));
    const f = await files(d);
    expect(strFromU8(f['ppt/theme/theme1.xml'])).toContain('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Harbor">');
  });
});
