// @vitest-environment jsdom
//
// Building decks in Slides: Hide Slide (skipped in the show, kept in PowerPoint files), copying
// and pasting slides between decks (in the deck's look, or keeping their own), Reuse Slides'
// copies from a file, and equations on slides saved as PowerPoint's own equations.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc, applyBase } from '../src/model';
import { Deck, STANDARD, defaultMaster, slideBackground, textStyles } from '../src/deck/deck';
import { shapeMathPicture, shapeMathScale, shapeMathSize } from '../src/deck/equation';
import { layoutMath, mathSvg, toOmml } from '../src/document/math';
import { writePptx, arialMeasure, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

function deck(n = 4): { d: Deck; host: Doc } {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  for (let i = 1; i < n; i++) d.addSlide('title-content');
  return { d, host };
}

const save = (d: Deck) => writePptx({
  size: d.size, master: d.master,
  slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, background: s.background, hideGraphics: s.hideGraphics, hidden: s.hidden })),
}, opts);

const titleOf = (doc: Doc) => [...doc.captions.values()].find((c) => c.ph === 'title')!;

/** Type a title on slide i. */
function title(d: Deck, i: number, text: string): void {
  d.go(i);
  const c = titleOf(d.host);
  d.host.edit('Title', () => d.host.updateCaption(c.id, { runs: [{ text }] }));
}

describe('Hide Slide', () => {
  it('hides the slides picked in one undoable step, and the show skips them', () => {
    const { d } = deck(5);
    d.setHidden(true, [1, 2]);
    expect(d.slides.map((s) => !!s.hidden)).toEqual([false, true, true, false, false]);
    expect(d.shownAfter(0)).toBe(3);
    expect(d.shownBefore(3)).toBe(0);
    expect(d.shownAfter(4)).toBe(-1);
    d.undo();
    expect(d.slides.some((s) => s.hidden)).toBe(false);
    d.redo();
    expect(d.slides[2].hidden).toBe(true);
    d.setHidden(false, [2]);
    expect(d.slides.map((s) => !!s.hidden)).toEqual([false, true, false, false, false]);
  });

  it('starts the show at the first slide that is not hidden, and a copy of a hidden slide is hidden too', () => {
    const { d } = deck(3);
    d.setHidden(true, [0]);
    expect(d.firstShown()).toBe(1);
    d.duplicate([0]);
    expect(d.slides[1].hidden).toBe(true);
    d.setHidden(true, [0, 1, 2, 3]);
    // every slide hidden: the show still has somewhere to start
    expect(d.firstShown()).toBe(0);
  });

  it('saves hidden slides as PowerPoint does (show="0") and reads them back', async () => {
    const { d } = deck(3);
    d.setHidden(true, [1]);
    const bytes = await save(d);
    const files = unzipSync(bytes);
    expect(strFromU8(files['ppt/slides/slide2.xml'])).toMatch(/<p:sld [^>]*show="0"/);
    expect(strFromU8(files['ppt/slides/slide1.xml'])).not.toMatch(/show="0"/);
    const back = readPptx(bytes);
    expect(back.slides.map((s) => !!s.hidden)).toEqual([false, true, false]);
  });
});

describe('copying and pasting slides', () => {
  it('pastes copies after the slide picked, in one undo step, leaving the copied slides as they were', () => {
    const a = deck(3), b = deck(2);
    title(a.d, 1, 'Copied');
    const clip = a.d.copySlides([1]);
    // changing the slide after copying doesn't change the copy
    title(a.d, 1, 'Changed');
    expect(b.d.pasteSlides(clip, false, 0)).toBe(1);
    expect(b.d.slides.length).toBe(3);
    expect(b.d.index).toBe(1);
    expect(titleOf(b.d.docOf(1)).runs.map((r) => r.text).join('')).toBe('Copied');
    b.d.undo();
    expect(b.d.slides.length).toBe(2);
  });

  it('gives pasted slides the deck\'s look, or keeps their own background and text look', () => {
    const a = deck(2), b = deck(1);
    a.d.useMaster({ ...defaultMaster(), titleFont: 'Georgia', titleColor: '#1f3552', background: '#fdf6e3' });
    title(a.d, 1, 'From the other deck');
    const clip = a.d.copySlides([1]);

    b.d.pasteSlides(clip, false, 0);
    const plain = titleOf(b.d.docOf(1));
    expect(b.d.slides[1].background).toBeUndefined();
    expect(plain.runs[0].font).toBeUndefined();

    b.d.pasteSlides(clip, true, 1);
    const kept = titleOf(b.d.docOf(2));
    const theirs = textStyles(a.d.master, 'title-content').title;
    expect(kept.runs).toEqual(applyBase([{ text: 'From the other deck' }], theirs));
    expect(b.d.slides[2].background).toEqual(slideBackground(a.d.master, 'title-content'));
    expect(b.d.docOf(2).background).toBe('#fdf6e3');
  });

  it('keeps slides made for another size centred, with their text boxes in this deck\'s places', () => {
    const a = deck(2), b = deck(1);
    b.d.setSize(STANDARD);
    a.d.go(1);
    a.d.host.edit('Atom', () => a.d.host.addAtom(480, 270));
    const clip = a.d.copySlides([1]);
    b.d.pasteSlides(clip, false, 0);
    const doc = b.d.docOf(1);
    const atom = [...doc.atoms.values()][0];
    expect(atom.x).toBeCloseTo(360, 6);
    expect(atom.y).toBeCloseTo(270, 6);
    // the title fits the 4:3 slide (its box ends inside it)
    const t = titleOf(doc);
    expect(t.x + (t.wrap ?? 0)).toBeLessThanOrEqual(720);
  });

  it('copies slides from a PowerPoint file for Reuse Slides, with their notes and hidden state', async () => {
    const a = deck(3);
    title(a.d, 2, 'Reused');
    a.d.setNotes('Say this', 2);
    a.d.setHidden(true, [2]);
    const got = readPptx(await save(a.d));
    const from = new Deck(new Doc());
    from.load(got.slides.map((s) => from.makeSlide(s.layout, s.contents, s.notes, s)), got.size, got.master);
    const b = deck(1);
    b.d.pasteSlides(from.copySlides([2]), false, 0);
    expect(titleOf(b.d.docOf(1)).runs.map((r) => r.text).join('')).toBe('Reused');
    expect(b.d.slides[1].notes).toBe('Say this');
    expect(b.d.slides[1].hidden).toBe(true);
  });
});

describe('equations on slides', () => {
  const math = { tex: 'k = A\\exp\\left(-\\frac{E_{a}}{RT}\\right)', size: 24, color: '#1f3552', font: 'Arial' };

  it('lays out as an SVG picture and as Office Math with each run\'s look', () => {
    const svg = mathSvg(layoutMath(math.tex, 24, 'Arial', arialMeasure), 'Arial', '#1f3552');
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(svg).toContain('<text');
    expect(svg).toContain('fill="#1f3552"');
    const look = '<a:rPr sz="2400"/>';
    const omml = toOmml('x^2', look);
    expect(omml).toContain(`<m:r>${look}<m:t xml:space="preserve">x</m:t></m:r>`);
    expect(toOmml('x^2')).not.toContain('a:rPr');
  });

  it('saves as PowerPoint\'s own equation with a picture for older programs, and comes back as typed', async () => {
    const { d, host } = deck(1);
    const nat = shapeMathSize(math, arialMeasure);
    // shown 1.5 times its own size
    host.edit('Equation', () => host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 100 + nat.w * 1.5, y2: 100 + nat.h * 1.5, src: shapeMathPicture(math, arialMeasure), px: { w: 10, h: 10 }, math }));
    const bytes = await save(d);
    const xml = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
    expect(xml).toContain('<mc:AlternateContent');
    expect(xml).toMatch(/<mc:Choice [^>]*Requires="a14"><p:sp>.*<a14:m><m:oMathPara/);
    expect(xml).toContain('<m:f><m:num>');
    // the text size is the size it shows at
    expect(xml).toContain('sz="3600"');
    expect(xml).toContain('val="1F3552"');
    expect(xml).toMatch(/<mc:Fallback><p:pic>/);
    const back = readPptx(bytes);
    const shapes = back.slides[0].contents.shapes.filter((s) => s.math);
    expect(shapes.length).toBe(1);
    const s = shapes[0];
    expect(s.math).toEqual(math);
    expect(s.x1).toBeCloseTo(100, 3);
    expect(shapeMathScale(s.math!, s.x2 - s.x1, s.y2 - s.y1, arialMeasure)).toBeCloseTo(1.5, 3);
    // nothing else came in from the picture for older programs
    expect(back.slides[0].contents.shapes.filter((x) => x.kind === 'picture').length).toBe(1);
  });

  it('reads an equation changed or made in PowerPoint from its Office Math, at its text size', async () => {
    const { d, host } = deck(1);
    const nat = shapeMathSize(math, arialMeasure);
    host.edit('Equation', () => host.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 100 + nat.w, y2: 100 + nat.h, src: shapeMathPicture(math, arialMeasure), px: { w: 10, h: 10 }, math }));
    const files = unzipSync(await save(d));
    // as PowerPoint would leave it after an edit there: R became R', 28 pt, and no tag of ours
    let xml = strFromU8(files['ppt/slides/slide1.xml']);
    xml = xml.replace(/<p:custDataLst><p:tags r:id="[^"]+"\/><\/p:custDataLst><\/p:nvPr><\/p:nvSpPr><p:spPr>/, '</p:nvPr></p:nvSpPr><p:spPr>')
      .replace(/sz="2400"/g, 'sz="2800"').replace('>R</m:t>', '>Q</m:t>');
    // (a Uint8Array of this window's, which the zip writer knows as bytes)
    files['ppt/slides/slide1.xml'] = new Uint8Array(strToU8(xml));
    const back = readPptx(zipSync(files));
    const s = back.slides[0].contents.shapes.find((x) => x.math)!;
    expect(s.math!.tex).toContain('Q');
    expect(s.math!.tex).toContain('\\frac');
    expect(s.math!.size).toBe(28);
    expect(s.math!.color).toBe('#1f3552');
    // centred where PowerPoint's text box was, at the equation's own size
    const cx = 100 + nat.w / 2;
    expect((s.x1 + s.x2) / 2).toBeCloseTo(cx, 1);
    expect(shapeMathScale(s.math!, s.x2 - s.x1, s.y2 - s.y1, arialMeasure)).toBeCloseTo(1, 3);
  });
});
