// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { richToHtml, richToPlain, htmlToRich } from '../src/text/html';

describe('copying styled text as HTML', () => {
  const text = {
    runs: [{ text: 'Yield ', size: 10 }, { text: '92%', bold: true, size: 10 }, { text: '\nCH3OH', formula: true, size: 10 }, { text: '\nfirst\nsecond', size: 10 }],
    paras: [{ align: 'center' as const }, {}, { list: 'number' as const }, { list: 'number' as const }],
  };
  it('writes bold, formulas, alignment and lists the way Word reads them', () => {
    const html = richToHtml(text);
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('text-align:center');
    expect(html).toMatch(/CH<\/span><sub><span[^>]*>3<\/span><\/sub>/);
    expect(html).toMatch(/<ol[^>]*><li><p[^>]*><span[^>]*>first<\/span><\/p><\/li><li>/);
  });
  it('comes back exactly when pasted here', () => {
    expect(htmlToRich(richToHtml(text))).toEqual(text);
  });
  it('gives plain text with bullets and numbers in front of list items', () => {
    expect(richToPlain(text)).toBe('Yield 92%\nCH3OH\n1.\tfirst\n2.\tsecond');
  });
});

describe('pasting HTML from other programs', () => {
  it('reads styles and paragraphs from a web page', () => {
    const got = htmlToRich('<p>The <b>crude</b> product</p>\n<p style="text-align:right">H<sub>2</sub>O <span style="color:rgb(255,0,0)">red</span></p>');
    expect(got).toEqual({
      runs: [{ text: 'The ' }, { text: 'crude', bold: true }, { text: ' product\nH' }, { text: '2', sub: true }, { text: 'O ' }, { text: 'red', color: '#ff0000' }],
      paras: [{}, { align: 'right' }],
    });
  });
  it('reads lists, nested a level deeper', () => {
    const got = htmlToRich('<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul><ol><li>first</li></ol>');
    expect(got?.paras).toEqual([{ list: 'bullet' }, { list: 'bullet', level: 1 }, { list: 'bullet' }, { list: 'number' }]);
    expect(got?.runs.map((r) => r.text).join('')).toBe('one\ninner\ntwo\nfirst');
  });
  it('reads Word lists and blank lines, without Word\'s typed-in bullets', () => {
    const word = `<html><body><!--StartFragment-->
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Stir at <span style='mso-bidi-font-family:Calibri'>0 °C</span><o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span><span style='mso-list:Ignore'>a.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>then warm<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoNormal>Done<o:p></o:p></p>
<!--EndFragment--></body></html>`;
    const got = htmlToRich(word);
    expect(got?.runs.map((r) => r.text).join('')).toBe('Stir at 0 °C\nthen warm\n\nDone');
    expect(got?.paras).toEqual([{ list: 'bullet' }, { list: 'number', level: 1 }, {}, {}]);
  });
  it('turns Symbol-font letters into Greek letters', () => {
    expect(htmlToRich('<p><span style="font-family:Symbol">a</span>-pinene</p>')?.runs.map((r) => r.text).join('')).toBe('α-pinene');
  });
  it('keeps fonts and sizes only when asked', () => {
    const html = '<p><span style="font-family:Calibri;font-size:11pt">x</span></p>';
    expect(htmlToRich(html)?.runs).toEqual([{ text: 'x' }]);
    expect(htmlToRich(html, { keepFonts: true })?.runs).toEqual([{ text: 'x', font: 'Calibri', size: 11 }]);
  });
  it('keeps a line break inside a paragraph as a new paragraph', () => {
    expect(htmlToRich('<p>a<br>b<br></p>')?.runs.map((r) => r.text).join('')).toBe('a\nb');
  });
});
