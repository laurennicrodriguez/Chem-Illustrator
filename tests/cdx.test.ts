// @vitest-environment jsdom
//
// CDX, ChemDraw's binary format (used on the clipboard). The byte examples are the worked
// examples in CambridgeSoft's published CDX documentation, and the layout seen in CDX files
// saved by ChemDraw 25 where the two differ. Real ChemDraw files are checked by converting them
// to CDX and back, and CDX files saved by ChemDraw against the CDXML of the same drawing (point
// CHEM_TEST_FILES at a folder of .cdxml files, with any .cdx files in it or a folder inside it).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { cdxmlToCdx, cdxToCdxml, isCdx } from '../src/io/cdx';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { Doc } from '../src/model';
import { summarize, differences } from './cdxml-compare';

const hex = (s: string) => Uint8Array.from(s.replace(/\s+/g, '').match(/../g)!.map((h) => parseInt(h, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const HEADER = '56 6A 43 44 30 31 30 30 04 03 02 01' + ' 00'.repeat(11) + ' 80 00 00 00 00';

/** CDX bytes of a one-page document holding `xml`, without the header and the final end mark. */
function body(xml: string): string {
  const out = toHex(cdxmlToCdx(`<CDXML>${xml}</CDXML>`));
  expect(out.startsWith(HEADER)).toBe(true);
  return out.slice(HEADER.length + 1, -6);
}

/** The CDXML for CDX `bytes` (one object or property list after the header). */
function xmlOf(bytes: string): string {
  return cdxToCdxml(hex(HEADER + bytes + ' 00 00'));
}

describe('the documentation examples', () => {
  it('a bond', () => {
    // bond id 29 from atom 21 to atom 22, double
    const cdx = '05 80 1D 00 00 00 04 06 04 00 15 00 00 00 05 06 04 00 16 00 00 00 00 06 02 00 02 00 00 00';
    expect(xmlOf(cdx)).toContain('<b id="29" B="21" E="22" Order="2"/>');
    expect(body('<b id="29" B="21" E="22" Order="2"/>')).toBe(cdx);
  });

  it('the side of a double bond', () => {
    // The documentation pairs DoublePosition 1 with "Right". ChemDraw 25 writes 1 and 2 for sides
    // it picked itself and leaves those out of CDXML; 0x100 marks a side the user chose.
    const auto = '05 80 1D 00 00 00 00 06 02 00 02 00 03 06 02 00 01 00 00 00';
    expect(xmlOf(auto)).toContain('<b id="29" Order="2"/>');
    const user = '05 80 1D 00 00 00 00 06 02 00 02 00 03 06 02 00 01 01 00 00';
    expect(xmlOf(user)).toContain('<b id="29" Order="2" DoublePosition="Right"/>');
    expect(body('<b id="29" Order="2" DoublePosition="Right"/>')).toBe(user);
    expect(body('<b id="29" Order="2" DoublePosition="Left"/>')).toContain('03 06 02 00 02 01');
  });

  it('coordinates: points, 3D points and boxes', () => {
    // p="72 144": y first, then x, in 1/65536 point
    expect(body('<n id="1" p="72 144"/>')).toBe('04 80 01 00 00 00 00 02 08 00 00 00 90 00 00 00 48 00 00 00');
    // 3D points are stored x, y, z in ChemDraw's files (the documentation says z, y, x)
    expect(body('<graphic id="1" Center3D="72 144 216"/>')).toBe('07 80 01 00 00 00 0D 02 0C 00 00 00 48 00 00 00 90 00 00 00 D8 00 00 00');
    // BoundingBox "left top right bottom" is stored top, left, bottom, right
    expect(body('<graphic id="1" BoundingBox="144 72 288 216"/>')).toBe('07 80 01 00 00 00 04 02 10 00 00 00 48 00 00 00 90 00 00 00 D8 00 00 00 20 01 00 00');
    expect(xmlOf('07 80 01 00 00 00 04 02 10 00 00 C0 96 00 C2 D7 74 00 2B 0C AF 00 3D 28 B4 00 00 00')).toContain('BoundingBox="116.84 150.75 180.16 175.05"');
  });

  it('drawing settings with their own units', () => {
    const doc = cdxToCdxml(hex(HEADER + ' 03 08 04 00 00 00 78 00 04 08 02 00 78 00 09 08 04 00 33 B3 02 00 19 08 00 00 00 00'));
    expect(doc).toContain('ChainAngle="120"');
    expect(doc).toContain('BondSpacing="12"');
    expect(doc).toContain('HashSpacing="2.7"');
    expect(doc).toContain('PrintTrimMarks="yes"');
    const back = toHex(cdxmlToCdx('<CDXML ChainAngle="120" BondSpacing="12" HashSpacing="2.7" PrintTrimMarks="yes"/>'));
    expect(back).toBe(HEADER + ' 03 08 04 00 00 00 78 00 04 08 02 00 78 00 09 08 04 00 33 B3 02 00 19 08 00 00 00 00');
  });

  it('a yes/no setting', () => {
    expect(xmlOf('04 80 01 00 00 00 3A 04 01 00 01 00 00')).toContain('ShowAtomQuery="yes"');
  });

  it('label and caption styles', () => {
    const doc = cdxToCdxml(hex(HEADER + ' 0A 08 08 00 03 00 60 00 C8 00 03 00 0B 08 08 00 04 00 00 00 F0 00 03 00 00 00'));
    expect(doc).toContain('LabelFont="3" LabelSize="10" LabelFace="96"');
    expect(doc).toContain('CaptionFont="4" CaptionSize="12" CaptionFace="0"');
    const back = toHex(cdxmlToCdx('<CDXML LabelFont="3" LabelSize="10" LabelFace="96" CaptionFont="4" CaptionSize="12"/>'));
    expect(back).toBe(HEADER + ' 0A 08 08 00 03 00 60 00 C8 00 03 00 0B 08 08 00 04 00 00 00 F0 00 03 00 00 00');
  });

  it('text and its style runs', () => {
    // "NH" in font 3, 10 pt, formula style
    const t = '06 80 07 00 00 00 00 07 0E 00 01 00 00 00 03 00 60 00 C8 00 03 00 4E 48 00 00';
    expect(xmlOf(t)).toContain('<t id="7"><s font="3" size="10" color="3" face="96">NH</s></t>');
    // written again as UTF-8 (tag 0x0709), as ChemDraw 25 does
    expect(body('<t id="7"><s font="3" size="10" color="3" face="96">NH</s></t>')).toBe(t.slice(0, -6) + ' 09 07 0E 00 01 00 00 00 03 00 60 00 C8 00 03 00 4E 48 00 00');
  });

  it('several runs, line breaks and line ends', () => {
    const xml = '<t id="2" LineStarts="11 12 20"><s font="3" size="10" face="0">THF, 0 °C\n\nthen </s><s font="3" size="10" face="1">H2O</s></t>';
    const cdx = toHex(cdxmlToCdx(`<CDXML>${xml}</CDXML>`));
    // single-byte text with runs at character offsets, then UTF-8 with runs at byte offsets;
    // line ends count UTF-8 bytes, as in CDXML
    expect(cdx).toContain('00 07 29 00 02 00 00 00 03 00 00 00 C8 00 03 00 10 00 03 00 01 00 C8 00 03 00 54 48 46 2C 20 30 20 B0 43 0D 0D');
    expect(cdx).toContain('09 07 2A 00 02 00 00 00 03 00 00 00 C8 00 03 00 11 00 03 00 01 00 C8 00 03 00 54 48 46 2C 20 30 20 C2 B0 43 0D 0D');
    expect(cdx).toContain('04 07 08 00 03 00 0B 00 0C 00 14 00');
    const back = cdxToCdxml(hex(cdx));
    expect(back).toContain('LineStarts="11 12 20"');
    expect(back).toContain('>THF, 0 °C\n\nthen </s><s font="3" size="10" color="3" face="1">H2O</s>');
    // the UTF-8 copy keeps characters the single-byte text cannot hold
    expect(cdxToCdxml(cdxmlToCdx('<CDXML><t id="2"><s font="3" size="10" face="0">α-Me</s></t></CDXML>'))).toContain('>α-Me</s>');
  });

  it('line ends in older CDX, which counts characters', () => {
    // "°C", a blank line and "x", with no UTF-8 copy: line ends 3, 4, 5 in characters
    const t = '06 80 02 00 00 00 00 07 11 00 01 00 00 00 03 00 00 00 C8 00 03 00 B0 43 0D 0D 78 04 07 08 00 03 00 03 00 04 00 05 00 00 00';
    const xml = xmlOf(t);
    expect(xml).toContain('LineStarts="4 5 6"');
    expect(xml).toContain('>°C\n\nx</s>');
  });

  it('the colour table', () => {
    const cdx = '00 03 32 00 08 00 FF FF FF FF FF FF 00 00 00 00 00 00 FF FF 00 00 00 00 FF FF FF FF 00 00 00 00 FF FF 00 00 00 00 FF FF FF FF 00 00 00 00 FF FF FF FF 00 00 FF FF';
    const doc = cdxToCdxml(hex(HEADER + cdx + ' 00 00'));
    expect(doc).toContain('<colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/><color r="1" g="0" b="0"/>');
    expect(doc.match(/<color /g)!.length).toBe(8);
    const back = toHex(cdxmlToCdx(doc));
    expect(back).toBe(HEADER + ' ' + cdx + ' 00 00');
  });

  it('the font table', () => {
    const doc = xmlOf('00 01 24 00 00 00 02 00 03 00 E4 04 05 00 41 72 69 61 6C 04 00 E4 04 0F 00 54 69 6D 65 73 20 4E 65 77 20 52 6F 6D 61 6E');
    expect(doc).toContain('<fonttable><font id="3" charset="iso-8859-1" name="Arial"/><font id="4" charset="iso-8859-1" name="Times New Roman"/></fonttable>');
    expect(toHex(cdxmlToCdx(doc))).toBe(HEADER + ' 00 01 24 00 00 00 02 00 03 00 E4 04 05 00 41 72 69 61 6C 04 00 E4 04 0F 00 54 69 6D 65 73 20 4E 65 77 20 52 6F 6D 61 6E 00 00');
  });

  it('a circled charge that stands for an atom charge', () => {
    const doc = xmlOf('07 80 09 00 00 00 0E 00 06 00 06 00 00 00 21 04 00 00');
    expect(doc).toContain('<graphic id="9"><represent attribute="Charge" object="6"/></graphic>');
    expect(body('<graphic id="9"><represent attribute="Charge" object="6"/></graphic>')).toBe('07 80 09 00 00 00 0E 00 06 00 06 00 00 00 21 04 00 00');
  });
});

describe('what ChemDraw 25 writes, checked against CDX files it saved', () => {
  it('the file header ends with the document object', () => {
    expect(toHex(cdxmlToCdx('<CDXML/>'))).toBe('56 6A 43 44 30 31 30 30 04 03 02 01 00 00 00 00 00 00 00 00 00 00 00 80 00 00 00 00 00 00');
  });

  it('an arrow: object 0x8021, its arrowheads, and 3D points stored x, y, z', () => {
    const xml = '<arrow id="5" BoundingBox="100 48 200 52" FillType="None" ArrowheadHead="Full" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250" Head3D="200 50 0" Tail3D="100 50 0"/>';
    const cdx = '21 80 05 00 00 00 04 02 10 00 00 00 30 00 00 00 64 00 00 00 34 00 00 00 C8 00 37 0A 02 00 01 00 35 0A 02 00 02 00 2F 0A 02 00 01 00 '
      + '20 0A 02 00 E8 03 30 0A 02 00 6B 03 31 0A 02 00 FA 00 07 02 0C 00 00 00 C8 00 00 00 32 00 00 00 00 00 08 02 0C 00 00 00 64 00 00 00 32 00 00 00 00 00 00 00';
    expect(body(xml)).toBe(cdx);
    expect(xmlOf(cdx)).toContain(xml);
  });

  it('the older line drawn for an arrow points to the arrow with tag 0x0013', () => {
    const cdx = '07 80 04 00 00 00 13 00 04 00 05 00 00 00 00 0A 02 00 01 00 02 0A 02 00 02 00 00 00';
    expect(body('<graphic id="4" SupersededBy="5" GraphicType="Line" ArrowType="FullHead"/>')).toBe(cdx);
    expect(xmlOf(cdx)).toContain('<graphic id="4" SupersededBy="5" GraphicType="Line" ArrowType="FullHead"/>');
  });

  it('a stereo label, whose name has no style-run count', () => {
    const label = '<objecttag id="2" TagType="Unknown" PositioningType="offset" PositioningOffset="-7.5 -1.5" Name="stereo"><t id="3" p="2.5 18.5"><s font="3" size="4.5" color="0" face="2">(S)</s></t></objecttag>';
    const cdx = toHex(cdxmlToCdx(`<CDXML><fragment id="9"><n id="1" p="10 20">${label}</n></fragment></CDXML>`));
    expect(cdx).toContain('11 80 02 00 00 00 00 0D 02 00 00 00 06 0D 01 00 02 08 0D 08 00 00 80 FE FF 00 80 F8 FF 08 00 06 00 73 74 65 72 65 6F 06 80 03 00 00 00');
    const back = cdxToCdxml(hex(cdx));
    expect(back).toContain(label);
    const atom = [...readCdxml(back).doc.atoms.values()][0];
    expect(atom.stereoLabel?.text).toBe('(S)');
  });

  it('atom and document settings found in its files', () => {
    // a boron radical, an atom ChemDraw wants cleaned up (no data), and tetrahedral geometry
    const atom = '04 80 01 00 00 00 02 04 02 00 05 00 22 04 01 00 01 48 04 00 00 30 04 01 00 07 00 00';
    expect(body('<n id="1" Element="5" Radical="Singlet" NeedsClean="yes" Geometry="Tetrahedral"/>')).toBe(atom);
    expect(xmlOf(atom)).toContain('<n id="1" Element="5" Radical="Singlet" NeedsClean="yes" Geometry="Tetrahedral"/>');
    // settings written with a yes/no byte, where the documentation has present-means-yes
    const doc = cdxToCdxml(hex(HEADER + ' 42 04 01 00 00 08 07 01 00 01 0D 08 01 00 01 00 00'));
    expect(doc).toContain('ShowTerminalCarbonLabels="no" InterpretChemically="yes" FractionalWidths="yes"');
    expect(toHex(cdxmlToCdx(doc))).toBe(HEADER + ' 42 04 01 00 00 08 07 01 00 01 0D 08 01 00 01 00 00');
  });

  it('an orbital (the faint highlight circles) keeps how faint it is', () => {
    const xml = '<graphic id="9" GraphicType="Orbital" OvalType="Circle" OrbitalType="s" FadePercent="300"/>';
    const cdx = '07 80 09 00 00 00 00 0A 02 00 05 00 04 0A 02 00 01 00 05 0A 02 00 00 00 03 03 02 00 2C 01 00 00';
    expect(body(xml)).toBe(cdx);
    expect(xmlOf(cdx)).toContain(xml);
  });
});

describe('reading CDX defensively', () => {
  it('reads data with or without the file header, and with the document object written out', () => {
    const bond = '05 80 1D 00 00 00 04 06 04 00 15 00 00 00 05 06 04 00 16 00 00 00 00 00';
    expect(cdxToCdxml(hex(bond + ' 00 00'))).toContain('<b id="29" B="21" E="22"/>');
    expect(cdxToCdxml(hex(HEADER + ' ' + bond + ' 00 00'))).toContain('<b id="29" B="21" E="22"/>');
    expect(cdxToCdxml(hex('00 80 01 00 00 00 ' + bond + ' 00 00'))).toContain('<b id="29" B="21" E="22"/>');
    expect(isCdx(hex(HEADER))).toBe(true);
    expect(isCdx(new TextEncoder().encode('<?xml'))).toBe(false);
  });

  it('reads a charge saved in four bytes, and long properties', () => {
    // ChemDraw 8 saved charges as 4 bytes, with the charge in the top byte
    expect(xmlOf('04 80 01 00 00 00 21 04 04 00 00 00 00 FF 00 00')).toContain('Charge="-1"');
    const long = 'x'.repeat(70000);
    const back = cdxToCdxml(cdxmlToCdx(`<CDXML><t id="1"><s font="3" size="10" face="0">${long}</s></t></CDXML>`));
    expect(back).toContain(`>${long}</s>`);
  });

  it('skips properties it does not know', () => {
    expect(xmlOf('04 80 01 00 00 00 FF 3F 02 00 01 02 02 04 02 00 07 00 00 00')).toContain('<n id="1" Element="7"/>');
  });

  it('stops with a message on cut-short data', () => {
    expect(() => cdxToCdxml(hex(HEADER + ' 04 80 01 00'))).toThrow(/cut short/);
  });
});

describe('a drawing through CDX', () => {
  function sample(): Doc {
    const doc = new Doc();
    doc.bulk(() => {
      const ring = [0, 1, 2, 3, 4, 5].map((i) => doc.addAtom(100 + 14.4 * Math.cos((Math.PI / 3) * i), 100 + 14.4 * Math.sin((Math.PI / 3) * i)));
      ring.forEach((a, i) => doc.addBond(a.id, ring[(i + 1) % 6].id, i % 2 ? 2 : 1));
      const o = doc.addAtom(128.8, 100, 8, { charge: -1 });
      doc.addBond(ring[0].id, o.id);
      const ph = doc.addAtom(78.4, 87.5, 6, { label: 'Ph' });
      doc.addBond(ring[3].id, ph.id, 1, 'wedge');
      doc.addCaption({ x: 90, y: 140, runs: [{ text: 'Yield ' }, { text: '92%', bold: true }, { text: '\n0 °C' }], justify: 'left' });
      doc.addArrow({ tail: { x: 140, y: 100 }, head: { x: 180, y: 100 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 });
      doc.addArrow({ tail: { x: 140, y: 120 }, head: { x: 160, y: 120 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'dashed', noGo: false, equilibrium: false, sweep: Math.PI / 2, headLength: 4.8, headWidth: 1.2 });
      doc.addShape({ kind: 'rect', x1: 60, y1: 70, x2: 190, y2: 150, rounded: true, shadow: true });
      doc.addShape({ kind: 'bracket', bracket: 'square', x1: 64, y1: 140, x2: 64, y2: 80 });
    });
    return doc;
  }

  it('comes back the same', () => {
    const doc = sample();
    const back = readCdxml(cdxToCdxml(cdxmlToCdx(writeCdxml(doc)))).doc;
    expect(differences(summarize(back), summarize(doc))).toEqual([]);
    expect(back.style).toEqual(readCdxml(writeCdxml(doc)).doc.style);
  });

  const dir = process.env.CHEM_TEST_FILES ?? '';
  const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cdxml')) : [];
  for (const f of files) {
    it(`${f} comes back the same`, { timeout: 60000 }, () => {
      const text = readFileSync(join(dir, f), 'utf8');
      const want = readCdxml(text).doc;
      const back = readCdxml(cdxToCdxml(cdxmlToCdx(text))).doc;
      expect(differences(summarize(back), summarize(want), 0.01).slice(0, 10)).toEqual([]);
    });
  }

  // CDX files saved by ChemDraw, next to the CDXML of the same drawing or in a folder inside
  const pairs: [string, string][] = [];
  const look = (folder: string, up: string[]) => {
    for (const f of readdirSync(folder)) {
      if (!f.toLowerCase().endsWith('.cdx')) continue;
      const base = f.slice(0, -4) + '.cdxml';
      const match = [folder, ...up].map((d) => join(d, base)).find((p) => existsSync(p));
      if (match) pairs.push([join(folder, f), match]);
    }
  };
  if (files.length) {
    look(dir, []);
    for (const sub of readdirSync(dir, { withFileTypes: true })) if (sub.isDirectory()) look(join(dir, sub.name), [dir]);
  }
  for (const [cdx, cdxml] of pairs) {
    it(`ChemDraw's ${basename(cdx)} reads as the same drawing as its CDXML`, { timeout: 60000 }, () => {
      const got = summarize(readCdxml(cdxToCdxml(new Uint8Array(readFileSync(cdx)))).doc);
      const want = summarize(readCdxml(readFileSync(cdxml, 'utf8')).doc);
      // Arrows, shapes and text must match exactly. ChemDraw checks structures again when it opens
      // a file (it may move an (R)/(S) label or add a charge), and a .cdx saved later may hold a
      // small edit, so a few atoms and bonds may differ.
      const diff = differences(got, want, 0.06);
      expect(diff.filter((d) => /^(arrows|shapes|captions)/.test(d))).toEqual([]);
      expect(diff.filter((d) => / missing: /.test(d)).length).toBeLessThanOrEqual(0.04 * (want.atoms.length + want.bonds.length));
    });
  }
});
