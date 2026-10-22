// @vitest-environment jsdom
// Links (Insert > Link): what can be typed, links in styled text, and how they are saved.

import { describe, it, expect } from 'vitest';
import {
  normalizeLink, describeLink, linkKind, typedLink, setLink, removeLink, linkSpans, linkAt, mapLinks,
  cellOfLink, cellLink, bookmarkName, linkOfFormula, officeTarget, linkFromTarget, slideIdLinks, filePath, LINK_COLOUR,
} from '../src/links';
import { TextEditing } from '../src/text/editing';
import { afterTyping, DEFAULT_TYPING } from '../src/text/typing';
import { runsForChemDraw, runsFromChemDraw } from '../src/text/chemdraw-text';
import { richToHtml, htmlToRich } from '../src/text/html';
import { arialWidth } from '../src/text-metrics';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

describe('what a link goes to', () => {
  it('makes what was typed into an address: DOIs, www., e-mail, paths', () => {
    expect(normalizeLink('10.1021/jacs.5b01234', 'doi')).toBe('https://doi.org/10.1021/jacs.5b01234');
    expect(normalizeLink('doi:10.1021/ja00001')).toBe('https://doi.org/10.1021/ja00001');
    expect(normalizeLink('https://dx.doi.org/10.1002/anie.1')).toBe('https://doi.org/10.1002/anie.1');
    expect(normalizeLink('www.acs.org')).toBe('https://www.acs.org');
    expect(normalizeLink('nate@auburn.example')).toBe('mailto:nate@auburn.example');
    expect(normalizeLink('C:\\Data\\run 4.mnova')).toBe('C:\\Data\\run 4.mnova');
    expect(normalizeLink('"C:\\a b.pdf"', 'file')).toBe('C:\\a b.pdf');
    expect(normalizeLink('Results', 'place')).toBe('#Results');
    expect(normalizeLink('   ')).toBeNull();
  });

  it('tells the kinds apart and says where a link goes in words', () => {
    expect(['#x', 'https://doi.org/10.1/x', 'mailto:a@b.c', 'https://a.org', 'C:/x.pdf'].map(linkKind)).toEqual(['place', 'doi', 'mail', 'web', 'file']);
    expect(describeLink('https://doi.org/10.1021/x')).toBe('DOI 10.1021/x');
    expect(describeLink('mailto:a@b.c')).toBe('a@b.c');
    expect(describeLink('#Intro', (p) => (p === '#Intro' ? 'Bookmark Intro' : null))).toBe('Bookmark Intro');
    expect(filePath('file:///C:/My%20data/x.pdf')).toBe('C:/My data/x.pdf');
  });

  it('turns typed addresses into links as Word does, leaving the full stop out', () => {
    expect(typedLink('https://www.rsc.org/journals.')).toBe('https://www.rsc.org/journals');
    expect(typedLink('www.nature.com')).toBe('https://www.nature.com');
    expect(typedLink('doi:10.1021/acs.orglett.0c01234')).toBe('https://doi.org/10.1021/acs.orglett.0c01234');
    expect(typedLink('chem@uni.edu')).toBe('mailto:chem@uni.edu');
    expect(typedLink('CH2Cl2')).toBeNull();
    expect(typedLink('www')).toBeNull();
  });

  it('reads cell places and HYPERLINK formulas, and makes bookmark names Word takes', () => {
    expect(cellOfLink('#Sheet1!B4')).toEqual({ sheet: 'Sheet1', cell: 'B4' });
    expect(cellOfLink("#'My runs'!$c$12")).toEqual({ sheet: 'My runs', cell: 'C12' });
    expect(cellOfLink('#A1')).toEqual({ sheet: null, cell: 'A1' });
    expect(cellOfLink('#Sheet2')).toBeNull();
    expect(cellLink('My runs', 'B4')).toBe("#'My runs'!B4");
    expect(cellLink('Data', 'B4')).toBe('#Data!B4');
    expect(linkOfFormula('=HYPERLINK("www.acs.org","ACS")')).toBe('https://www.acs.org');
    expect(linkOfFormula('=HYPERLINK(A1)')).toBeNull();
    expect(bookmarkName('Results and discussion')).toBe('Results_and_discussion');
    expect(bookmarkName('2nd try')).toBe('B_2nd_try');
  });

  it('writes file links as Office targets and reads them back', () => {
    expect(officeTarget('C:\\Data\\run 4.mnova')).toBe('file:///C:/Data/run%204.mnova');
    expect(officeTarget('spectra/run #4.pdf')).toBe('spectra/run%20%234.pdf');
    expect(officeTarget('https://a.org/?q=1')).toBe('https://a.org/?q=1');
    expect(linkFromTarget('spectra/run%20%234.pdf')).toBe('spectra/run #4.pdf');
    expect(linkFromTarget('https://a.org/x%20y')).toBe('https://a.org/x%20y');
  });
});

describe('links in text', () => {
  const runs: TextRun[] = [{ text: 'See the paper here.' }];

  it('links a stretch of text in the link colour, and takes it off again', () => {
    const { runs: out } = setLink(runs, 8, 13, 'https://doi.org/10.1/x');
    expect(linkSpans(out)).toEqual([{ start: 8, end: 13, link: 'https://doi.org/10.1/x' }]);
    const linked = out.find((r) => r.link)!;
    expect([linked.text, linked.color, linked.underline]).toEqual(['paper', LINK_COLOUR, true]);
    expect(linkAt(out, 10)?.link).toBe('https://doi.org/10.1/x');
    expect(linkAt(out, 13)?.link).toBe('https://doi.org/10.1/x'); // just after counts, as in Word
    const plain = removeLink(out, 0, rt.plainText(out).length);
    expect(plain).toEqual(runs);
  });

  it('can change the text a link shows, and change or drop links by address', () => {
    const { runs: out, end } = setLink(runs, 8, 13, 'https://a.org', 'article');
    expect(rt.plainText(out)).toBe('See the article here.');
    expect(end).toBe(15);
    expect(linkSpans(mapLinks(out, () => 'https://b.org'))[0].link).toBe('https://b.org');
    expect(mapLinks(out, () => null).some((r) => r.link || r.color)).toBe(false);
  });

  it('does not carry a link on to text typed after it', () => {
    const { runs: out } = setLink([{ text: 'go' }], 0, 2, 'https://a.org');
    const style = rt.typingStyle(out, 2, 2, {});
    expect(style.link).toBeUndefined();
    expect(style.color).toBeUndefined();
    expect(style.underline).toBeFalsy();
  });

  it('makes an address typed into a link when a space ends it, without chemistry inside it', () => {
    const measure = (t: string, s: number) => arialWidth(t, s, false);
    const ed = new TextEditing({ runs: [{ text: '' }], justify: 'left' }, { size: 10 }, measure, 10);
    let clock = 0;
    ed.now = () => (clock += 2000);
    ed.onTyped = (t) => afterTyping(ed, t, DEFAULT_TYPING);
    for (const ch of 'see www.h2o.org/CH2Cl2 now') ed.type(ch);
    expect(ed.text).toBe('see www.h2o.org/CH2Cl2 now');
    expect(linkSpans(ed.t.runs)).toEqual([{ start: 4, end: 22, link: 'https://www.h2o.org/CH2Cl2' }]);
    expect(ed.t.runs.some((r) => r.sub)).toBe(false);
    // turned off: plain text
    const off = new TextEditing({ runs: [{ text: '' }], justify: 'left' }, { size: 10 }, measure, 10);
    off.onTyped = (t) => afterTyping(off, t, { ...DEFAULT_TYPING, links: false });
    for (const ch of 'www.acs.org ') off.type(ch);
    expect(linkSpans(off.t.runs)).toEqual([]);
  });
});

describe('links kept in files and on the clipboard', () => {
  const linked = setLink([{ text: 'Data in the SI.' }], 12, 14, 'https://doi.org/10.1/si').runs;

  it('keeps links in ChemDraw files in our tag, ChemDraw showing just the text', () => {
    const { runs, tag } = runsForChemDraw({ runs: linked, paras: [{ list: 'bullet' }] });
    expect(runs.some((r) => r.link)).toBe(false);
    expect(tag?.links?.length).toBe(1);
    const back = runsFromChemDraw(runs, JSON.parse(JSON.stringify(tag)));
    expect(linkSpans(back.runs)).toEqual(linkSpans(linked));
    // edited in ChemDraw: read as it shows there
    expect(runsFromChemDraw([{ text: 'Changed' }], tag).runs.some((r) => r.link)).toBe(false);
  });

  it('copies links as HTML links and pastes them from other programs, never scripts', () => {
    const html = richToHtml({ runs: linked });
    expect(html).toMatch(/<a href="https:\/\/doi.org\/10.1\/si"><span[^>]*>SI<\/span><\/a>/);
    expect(linkSpans(htmlToRich(html)!.runs)).toEqual(linkSpans(linked));
    const pasted = htmlToRich('<p>Read <a href="https://www.acs.org/">this</a> and <a href="javascript:alert(1)">that</a></p>')!;
    expect(pasted.runs.filter((r) => r.link).map((r) => [r.text, r.link])).toEqual([['this', 'https://www.acs.org/']]);
  });

  it('turns slide links read from a file (by place) into links to the slides\' ids', () => {
    const c = { captions: [{ runs: [{ text: 'a', link: '#slide-n=1' }, { text: 'b', link: '#next' }] }] };
    expect(slideIdLinks(c, [7, 9]).captions[0].runs.map((r) => r.link)).toEqual(['#slide=9', '#next']);
    expect(slideIdLinks({ x: 1 }, [1])).toEqual({ x: 1 });
  });
});
