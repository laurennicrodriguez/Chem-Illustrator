// @vitest-environment jsdom
//
// Text boxes, lists and spacing saved in ChemDraw files and read back. ChemDraw has no lists, so
// the bullets and numbers are saved as text it shows, with a hidden tag that lets Chem Illustrator
// read the list back. Checked in ChemDraw 25: it shows the bullets, numbers and line spacing, and
// keeps the tag when it saves the file again as CDXML or CDX.

import { describe, it, expect } from 'vitest';
import { Doc, type Caption } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';

function saved(c: Omit<Caption, 'id'>): string {
  const doc = new Doc();
  doc.bulk(() => doc.addCaption(c));
  return writeCdxml(doc);
}
const back = (xml: string) => [...readCdxml(xml).doc.captions.values()][0];
const viaCdx = (xml: string) => cdxToCdxml(cdxmlToCdx(xml));
const plain = (c: Caption) => c.runs.map((r) => r.text).join('');

const LIST: Omit<Caption, 'id'> = {
  x: 40, y: 50, justify: 'left',
  runs: [{ text: 'Conditions\nPd(PPh3)4\nTHF, 65 °C\nthen 12 h' }],
  paras: [{}, { list: 'bullet' }, { list: 'number' }, { list: 'number', level: 1 }],
};

describe('lists in ChemDraw files', () => {
  it('saves bullets and numbers as text ChemDraw shows, with a hidden tag', () => {
    const xml = saved(LIST);
    expect(xml).toContain('Conditions\n•\tPd(PPh3)4\n1.\tTHF, 65 °C\n\ta.\tthen 12 h');
    expect(xml).toMatch(/<objecttag TagType="String" Name="Chem Illustrator text" Value="[^"]+" Visible="no"\/>/);
  });
  it('reads the list back from CDXML and from CDX', () => {
    for (const xml of [saved(LIST), viaCdx(saved(LIST))]) {
      const c = back(xml);
      expect(plain(c)).toBe('Conditions\nPd(PPh3)4\nTHF, 65 °C\nthen 12 h');
      expect(c.paras).toEqual(LIST.paras);
    }
  });
  it('keeps the bullets as plain text when the words were changed in ChemDraw', () => {
    const xml = saved(LIST).replace('THF, 65 °C', 'THF, 70 °C');
    const c = back(xml);
    expect(plain(c)).toBe('Conditions\n•\tPd(PPh3)4\n1.\tTHF, 70 °C\n\ta.\tthen 12 h');
    expect(c.paras).toBeUndefined();
  });
});

describe('spacing and text boxes in ChemDraw files', () => {
  it('saves a set line spacing as ChemDraw does, in both line-height settings', () => {
    const xml = saved({ x: 40, y: 260, justify: 'left', lineSpacing: 1.5, runs: [{ text: 'one\ntwo\nthree' }] });
    // 1.5 × single spacing (1.15 × 10 pt)
    expect(xml).toContain('LineHeight="17.25"');
    expect(xml).toContain('CaptionLineHeight="17.25"');
    for (const x of [xml, viaCdx(xml)]) expect(back(x).lineSpacing).toBe(1.5);
  });
  it('keeps a text box width and justified text through CDX', () => {
    const c = back(viaCdx(saved({ x: 40, y: 50, justify: 'justify', wrap: 230, runs: [{ text: 'The crude product was purified by flash chromatography on silica gel.' }] })));
    expect(c.wrap).toBe(230);
    expect(c.justify).toBe('justify');
  });
});
