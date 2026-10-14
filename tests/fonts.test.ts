// @vitest-environment jsdom
//
// Free fonts that come with the app: which they are, and putting them inside saved Word and
// PowerPoint files (WOFF back to TrueType, Word's obfuscation, PowerPoint's EOT wrapper).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';
import { BUNDLED_GROUPS, isBundled, packageName, readFontFile } from '../src/fonts';
import { woffToSfnt, fontInfo, obfuscate, toEot, fontsNamed, facesToEmbed, newGuid, embeddable, type FontSource } from '../src/io/font-embed';
import { writeDocx } from '../src/io/docx-write';
import { newDocument } from '../src/document/document';

const woff = (pkg: string, file: string) => new Uint8Array(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`));
const INTER = () => woffToSfnt(woff('inter', 'inter-latin-400-normal.woff'));

describe('the bundled fonts', () => {
  it('are grouped and recognised whatever the case', () => {
    expect(BUNDLED_GROUPS.map((g) => g.name)).toEqual(['Sans', 'Serif', 'Poster', 'Monospace']);
    expect(isBundled('source sans 3')).toBe(true);
    expect(isBundled('Arial')).toBe(false);
    expect(packageName('Source Sans 3')).toBe('source-sans-3');
  });

  it('each has its package installed, with a Latin regular file', () => {
    for (const g of BUNDLED_GROUPS) for (const f of g.fonts) {
      const pkg = packageName(f);
      expect(() => woff(pkg, `${pkg}-latin-400-normal.woff`), f).not.toThrow();
    }
  });

  it('reads a file name into its font, letters, weight and style', () => {
    expect(readFontFile('/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-700-italic.woff2'))
      .toEqual({ pkg: 'ibm-plex-sans', subset: 'latin-ext', weight: 700, style: 'italic' });
    expect(readFontFile('/node_modules/@fontsource/inter/files/inter-cyrillic-400-normal.woff2')).toBeNull();
  });
});

describe('putting fonts inside Office files', () => {
  it('turns WOFF back into TrueType that names itself', () => {
    const ttf = INTER();
    expect(new DataView(ttf.buffer).getUint32(0)).toBe(0x00010000);
    const f = fontInfo(ttf);
    expect(f.family).toBe('Inter');
    expect(f.weight).toBe(400);
    expect(f.italic).toBe(false);
    expect(embeddable(ttf)).toBe(true);
    const bold = fontInfo(woffToSfnt(woff('inter', 'inter-latin-700-italic.woff')));
    expect(bold.weight).toBe(700);
    expect(bold.italic).toBe(true);
  });

  it("obfuscates Word's way: only the first 32 bytes change, and doing it twice undoes it", () => {
    const ttf = INTER();
    const key = '{6C1D3E72-0F44-4B8A-9A1B-2E3F4A5B6C7D}';
    const o = obfuscate(ttf, key);
    expect(o.slice(32)).toEqual(ttf.slice(32));
    expect(o.slice(0, 32)).not.toEqual(ttf.slice(0, 32));
    // the key is the GUID's bytes from its end: the first byte is XORed with 0x7D
    expect(o[0] ^ ttf[0]).toBe(0x7d);
    expect(o[16] ^ ttf[16]).toBe(0x7d);
    expect(obfuscate(o, key)).toEqual(ttf);
    expect(newGuid()).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
  });

  it("wraps PowerPoint's font in an EOT header that ends where the font starts", () => {
    const ttf = INTER();
    const eot = toEot(ttf);
    const v = new DataView(eot.buffer);
    expect(v.getUint32(0, true)).toBe(eot.length);
    expect(v.getUint32(4, true)).toBe(ttf.length);
    expect(v.getUint32(8, true)).toBe(0x00020000);
    expect(v.getUint16(34, true)).toBe(0x504c);
    expect(eot.slice(eot.length - ttf.length)).toEqual(ttf);
    // the family name, in UTF-16, right after the fixed part
    expect(v.getUint16(82, true)).toBe('Inter'.length * 2);
    expect(String.fromCharCode(...[0, 1, 2, 3, 4].map((i) => v.getUint16(84 + i * 2, true)))).toBe('Inter');
  });

  it('finds the fonts that Word and PowerPoint text names', () => {
    expect([...fontsNamed('<w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/></w:rPr></w:r><w:rFonts w:ascii="Arial"/>')]).toEqual(['Inter', 'Arial']);
    expect([...fontsNamed('<a:rPr><a:latin typeface="Oswald"/><a:cs typeface="+mn-cs"/></a:rPr>')]).toEqual(['Oswald']);
  });

  it('embeds only fonts the source can supply', async () => {
    const source: FontSource = async (f) => (f === 'Inter' ? [{ bold: false, italic: false, data: INTER() }] : []);
    const got = await facesToEmbed(['<w:rFonts w:ascii="Inter"/><w:rFonts w:ascii="Arial"/>'], source);
    expect(got.map((g) => g.family)).toEqual(['Inter']);
  });

  it('puts a used free font inside a Word file, with its font table and setting', async () => {
    const d = newDocument();
    d.runs = [{ text: 'Hello', font: 'Inter' }];
    const fonts: FontSource = async (f) => (f === 'Inter' ? [{ bold: false, italic: false, data: INTER() }] : []);
    const files = unzipSync(await writeDocx(d, { picture: async () => null, fonts }));
    const table = strFromU8(files['word/fontTable.xml']);
    expect(table).toContain('<w:font w:name="Inter">');
    const key = /w:fontKey="([^"]+)"/.exec(table)![1];
    expect(obfuscate(files['word/fonts/font1.odttf'], key)).toEqual(INTER());
    expect(strFromU8(files['word/settings.xml'])).toContain('<w:embedTrueTypeFonts/>');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('fontTable.xml');
    expect(strFromU8(files['[Content_Types].xml'])).toContain('obfuscatedFont');
  });

  it('leaves Word files alone when no free font is used', async () => {
    const d = newDocument();
    d.runs = [{ text: 'Hello' }];
    const files = unzipSync(await writeDocx(d, { picture: async () => null, fonts: async () => [] }));
    expect(files['word/fontTable.xml']).toBeUndefined();
    expect(strFromU8(files['word/settings.xml'])).not.toContain('embedTrueTypeFonts');
  });
});

describe('fonts inside PowerPoint files', () => {
  it('lists a used free font and keeps it as EOT', async () => {
    const { Doc } = await import('../src/model');
    const { Deck } = await import('../src/deck/deck');
    const { writePptx } = await import('../src/io/pptx-write');
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    host.edit('t', () => host.addCaption({ x: 100, y: 100, runs: [{ text: 'Poster', font: 'Oswald' }], justify: 'left' }));
    const oswald = woffToSfnt(woff('oswald', 'oswald-latin-400-normal.woff'));
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, {
      picture: async () => null, svgToPng: async () => new Uint8Array(), fonts: async (f) => (f === 'Oswald' ? [{ bold: false, italic: false, data: oswald }] : []),
    });
    const files = unzipSync(bytes);
    const pres = strFromU8(files['ppt/presentation.xml']);
    expect(pres).toContain('embedTrueTypeFonts="1"');
    expect(pres).toMatch(/<p:embeddedFontLst><p:embeddedFont><p:font typeface="Oswald"[^>]*\/><p:regular r:id="rId\d+"\/><\/p:embeddedFont><\/p:embeddedFontLst>/);
    // the list sits between the notes size and the custom data, as the schema orders them
    expect(pres.indexOf('<p:notesSz')).toBeLessThan(pres.indexOf('<p:embeddedFontLst>'));
    expect(pres.indexOf('</p:embeddedFontLst>')).toBeLessThan(pres.indexOf('<p:custDataLst>'));
    const eot = files['ppt/fonts/font1.fntdata'];
    expect(eot.slice(eot.length - oswald.length)).toEqual(oswald);
    expect(strFromU8(files['[Content_Types].xml'])).toContain('Extension="fntdata"');
  });
});
