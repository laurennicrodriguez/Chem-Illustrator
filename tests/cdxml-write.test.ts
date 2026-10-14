// @vitest-environment jsdom
//
// Saving CDXML: new drawings are written in ChemDraw's form, and drawings opened from a file
// are saved by changing only what was edited.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml, lineEnds } from '../src/io/cdxml-write';
import { summarize, differences, duplicateIds } from './cdxml-compare';

// A small file in the shape ChemDraw writes: ethanol (with an O label), a caption, an arrow
// with ChemDraw's older copy of it, a reaction step, and parts this program does not read.
const FILE = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >
<CDXML
 CreationProgram="ChemDraw 25.5.0.5789"
 Name="test.cdxml"
 BoundingBox="100 100 220 130"
 LabelFont="3"
 LabelSize="10"
 LabelFace="96"
 CaptionFont="3"
 CaptionSize="10"
 LineWidth="0.60"
 BoldWidth="2"
 BondLength="14.40"
 BondSpacing="18"
 color="0"
 bgcolor="1"
><colortable>
<color r="1" g="1" b="1"/>
<color r="0" g="0" b="0"/>
<color r="1" g="0" b="0"/>
</colortable><fonttable>
<font id="3" charset="iso-8859-1" name="Arial"/>
</fonttable><page
 id="1"
 BoundingBox="0 0 540 720"
><fragment
 id="10"
 BoundingBox="100 100 130 110"
><n
 id="11"
 p="100 110"
 AS="N"
/><n
 id="12"
 p="112.47 102.80"
 AS="N"
/><n
 id="13"
 p="124.94 110"
 Element="8"
 NumHydrogens="1"
 NeedsClean="yes"
 AS="N"
><t
 p="121.33 113.90"
 BoundingBox="121.33 105.55 136.20 113.90"
 LabelJustification="Left"
 LabelAlignment="Left"
><s font="3" size="10" color="0" face="96">OH</s></t></n><b
 id="14"
 B="11"
 E="12"
 BS="N"
/><b
 id="15"
 B="12"
 E="13"
 BS="N"
/></fragment><t
 id="20"
 p="150 120"
 BoundingBox="150 113 190 122"
 LineHeight="auto"
><s font="3" size="10" color="4" face="1">heat</s></t><graphic
 id="30"
 SupersededBy="31"
 BoundingBox="200 105 160 105"
 GraphicType="Line"
 ArrowType="FullHead"
 HeadSize="1000"
/><arrow
 id="31"
 BoundingBox="160 103.50 200 106.50"
 FillType="None"
 ArrowheadHead="Full"
 ArrowheadType="Solid"
 HeadSize="1000"
 ArrowheadCenterSize="875"
 ArrowheadWidth="250"
 Head3D="200 105 0"
 Tail3D="160 105 0"
 Center3D="180 105 0"
 MajorAxisEnd3D="220 105 0"
 MinorAxisEnd3D="180 145 0"
/><chemicalproperty
 id="40"
 ChemicalPropertyDisplayID="20"
 ChemicalPropertyIsActive="yes"
 BasisObjects="10"
/><scheme
 id="50"
><step
 id="51"
 ReactionStepReactants="10"
 ReactionStepArrows="30"
 ReactionStepObjectsBelowArrow="20"
/></scheme></page></CDXML>
`;

function open(text = FILE) {
  return readCdxml(text).doc;
}

function attr(xml: string, tag: string, id: string, name: string): string | null {
  const root = new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml').documentElement;
  for (const e of Array.from(root.getElementsByTagName(tag))) if (e.getAttribute('id') === id) return e.getAttribute(name);
  return null;
}

function has(xml: string, tag: string, id: string): boolean {
  return new RegExp(`<${tag}\\s+id="${id}"`).test(xml);
}

describe('saving a file that was opened', () => {
  it('gives back the same bytes when nothing changed', () => {
    expect(writeCdxml(open())).toBe(FILE);
  });

  it('gives back the same bytes after an edit is undone', () => {
    const doc = open();
    doc.edit('move', () => doc.moveAtoms([11, 12, 13], 5, 5));
    doc.undo();
    expect(writeCdxml(doc)).toBe(FILE);
  });

  it('moves a structure and its label, keeping everything else', () => {
    const doc = open();
    doc.edit('move', () => doc.moveAtoms([11, 12, 13], 10, -5));
    const out = writeCdxml(doc);
    expect(attr(out, 'n', '11', 'p')).toBe('110.00 105.00');
    expect(attr(out, 'n', '13', 'p')).toBe('134.94 105.00');
    // the label moves with its atom and is otherwise untouched
    const t = /<t\s+p="([\d. ]+)"\s+BoundingBox="([\d. ]+)"/.exec(out)!;
    expect(t[1]).toBe('131.33 108.90');
    expect(t[2]).toBe('131.33 100.55 146.20 108.90');
    // ChemDraw's own details stay
    expect(attr(out, 'n', '13', 'AS')).toBe('N');
    expect(attr(out, 'b', '14', 'BS')).toBe('N');
    expect(has(out, 'chemicalproperty', '40')).toBe(true);
    expect(attr(out, 'step', '51', 'ReactionStepArrows')).toBe('30');
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM')).toBe(true);
  });

  it('keeps the older copy of an arrow in step with the arrow', () => {
    const doc = open();
    doc.edit('stretch', () => doc.updateArrow(31, { head: { x: 210, y: 105 } }));
    const out = writeCdxml(doc);
    expect(attr(out, 'arrow', '31', 'Head3D')).toBe('210.00 105.00 0');
    expect(attr(out, 'graphic', '30', 'BoundingBox')).toBe('210.00 105.00 160.00 105.00');
    expect(attr(out, 'step', '51', 'ReactionStepArrows')).toBe('30');
  });

  it('removes deleted objects and references to them', () => {
    const doc = open();
    doc.edit('delete', () => { doc.removeArrow(31); doc.removeCaption(20); });
    const out = writeCdxml(doc);
    expect(has(out, 'arrow', '31')).toBe(false);
    expect(has(out, 'graphic', '30')).toBe(false);
    expect(has(out, 't', '20')).toBe(false);
    // the reaction step had nothing left without its arrow
    expect(has(out, 'step', '51')).toBe(false);
    expect(has(out, 'scheme', '50')).toBe(false);
  });

  it('rewrites a changed atom label and drops stale stereo marks', () => {
    const doc = open();
    doc.edit('to N', () => doc.updateAtom(13, { z: 7 }));
    const out = writeCdxml(doc);
    expect(attr(out, 'n', '13', 'Element')).toBe('7');
    expect(attr(out, 'n', '13', 'NumHydrogens')).toBe('2');
    expect(attr(out, 'n', '13', 'AS')).toBe(null);
    expect(out).toContain('face="96">NH2</s>');
    const back = open(out);
    expect(differences(summarize(back), summarize(doc))).toEqual([]);
  });

  it('keeps a stereo label with its atom', () => {
    // ChemDraw's "(S)" beside atom 12
    const text = FILE.replace(/(id="12"\n p="112.47 102.80"\n AS="N"\n)\/>/, '$1 ShowAtomStereo="yes"\n><objecttag\n TagType="Unknown"\n Name="stereo"\n><t\n p="114.47 98.80"\n BoundingBox="114.47 95.58 120.47 99.70"\n CaptionLineHeight="variable"\n><s font="3" size="4.5" color="0" face="2">(S)</s></t></objecttag></n>');
    expect(text).not.toBe(FILE);
    const doc = open(text);
    expect(doc.atoms.get(12)!.stereoLabel).toEqual({ text: '(S)', dx: 2, dy: -4, size: 4.5, italic: true });
    doc.edit('move', () => doc.moveAtoms([11, 12, 13], 10, -5));
    const out = writeCdxml(doc);
    expect(out).toContain('p="124.47 93.80"');
    expect(open(out).atoms.get(12)!.stereoLabel).toEqual({ text: '(S)', dx: 2, dy: -4, size: 4.5, italic: true });
  });

  it('adds new objects with fresh ids', () => {
    const doc = open();
    doc.edit('add', () => {
      const a = doc.addAtom(124.94, 124.4);
      doc.addBond(13, a.id, 1);
      const b = doc.addAtom(300, 300, 17);
      doc.addCaption({ x: 300, y: 330, runs: [{ text: 'new' }], justify: 'left' });
      void b;
    });
    const out = writeCdxml(doc);
    expect(duplicateIds(out)).toEqual([]);
    const back = open(out);
    expect(differences(summarize(back), summarize(doc))).toEqual([]);
    // the new bond joins the existing structure; the lone Cl gets its own
    expect(out.match(/<fragment/g)!.length).toBe(2);
  });

  it('writes colours through the file colour table', () => {
    const doc = open();
    expect(doc.captions.get(20)!.runs[0].color).toBe('#ff0000');
    doc.edit('colour', () => doc.updateAtom(11, { color: '#0000ff' }));
    const out = writeCdxml(doc);
    expect(out).toContain('<color r="0.0000" g="0.0000" b="1.0000"/>');
    expect(attr(out, 'n', '11', 'color')).toBe('5');
    expect(open(out).atoms.get(11)!.color).toBe('#0000ff');
  });
});

describe('saving a new drawing', () => {
  function sample(): Doc {
    const doc = new Doc();
    doc.bulk(() => {
      // phenol, an ester label, a charge, a caption, arrows and shapes
      const ring = [0, 1, 2, 3, 4, 5].map((i) => doc.addAtom(100 + 14.4 * Math.cos((Math.PI / 3) * i), 100 + 14.4 * Math.sin((Math.PI / 3) * i)));
      ring.forEach((a, i) => doc.addBond(a.id, ring[(i + 1) % 6].id, i % 2 ? 2 : 1));
      const o = doc.addAtom(128.8, 100, 8);
      doc.addBond(ring[0].id, o.id);
      const est = doc.addAtom(78.4, 87.5, 6, { label: 'CO2Et' });
      doc.addBond(ring[3].id, est.id);
      const n = doc.addAtom(200, 100, 7, { charge: 1 });
      const m = doc.addAtom(214.4, 100);
      doc.addBond(n.id, m.id, 1, 'wedge');
      doc.addCaption({ x: 100, y: 150, runs: [{ text: 'Yield ' }, { text: '92%', bold: true }], justify: 'left' });
      doc.addArrow({ tail: { x: 140, y: 100 }, head: { x: 180, y: 100 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 });
      doc.addArrow({ tail: { x: 140, y: 120 }, head: { x: 160, y: 120 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: Math.PI / 2, headLength: 6, headWidth: 1.5 });
      doc.addCaption({ x: 100, y: 190, runs: [{ text: 'THF, 0 °C\n\nthen H' }, { text: '2', sub: true }, { text: 'O' }], justify: 'left' });
      doc.updateAtom(m.id, { stereoLabel: { text: '(R)', dx: 2, dy: -4, size: 7.5, italic: true } });
      doc.addShape({ kind: 'rect', x1: 60, y1: 60, x2: 240, y2: 170, rounded: true });
      doc.addShape({ kind: 'rect', x1: 60, y1: 200, x2: 90, y2: 230, rounded: true, radius: 1.8, shadow: true });
      doc.addShape({ kind: 'oval', x1: 190, y1: 90, x2: 196, y2: 96 });
      doc.addShape({ kind: 'bracket', bracket: 'square', x1: 70, y1: 80, x2: 75, y2: 120 });
    });
    return doc;
  }

  it('reads back the same drawing', () => {
    const doc = sample();
    const out = writeCdxml(doc, { name: 'new.cdxml' });
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n<CDXML ')).toBe(true);
    expect(differences(summarize(open(out)), summarize(doc))).toEqual([]);
    expect(duplicateIds(out)).toEqual([]);
  });

  it('writes structures the way ChemDraw does', () => {
    const out = writeCdxml(sample());
    // automatic labels carry the element and hydrogen count; abbreviations their meaning
    expect(out).toMatch(/<n id="\d+" p="128\.80 100\.00" Element="8" NumHydrogens="1" NeedsClean="yes"><t [^>]*><s font="3" size="10" color="0" face="96">OH<\/s><\/t><\/n>/);
    expect(out).toMatch(/NodeType="Fragment"/);
    expect(out).toContain('face="96">CO2Et</s>');
    expect(out).toMatch(/Charge="1" NumHydrogens="3"[^>]*><t [^>]*><s [^>]*>NH3\+<\/s>/);
    expect(out).toMatch(/Display="WedgeBegin"/);
    expect(out).toMatch(/<font id="3" charset="iso-8859-1" name="Arial"\/>/);
    expect(out).toMatch(/<page id="\d+" BoundingBox="0 0 540.00 720.00"/);
  });

  it('lists line ends so ChemDraw keeps blank lines', () => {
    expect(lineEnds('ab\n\nc°')).toEqual([3, 4, 7]);
    expect(lineEnds('one line')).toEqual([8]);
    const out = writeCdxml(sample());
    // "THF, 0 °C" is 10 bytes (° takes two), then the blank line, then "then H2O"
    expect(out).toMatch(/LineHeight="auto" LineStarts="11 12 20"><s [^>]*>THF, 0 °C/);
    expect(out).not.toMatch(/LineStarts="[^"]*"><s [^>]*>Yield/);
  });

  it('writes stereo labels and box styles as ChemDraw does', () => {
    const out = writeCdxml(sample());
    expect(out).toMatch(/ShowAtomStereo="yes" AS="R"><objecttag TagType="Unknown" Name="stereo"><t p="([\d.]+) ([\d.]+)"[^>]*><s [^>]*face="2">\(R\)<\/s>/);
    // corner radius and shadow in hundredths of the line width (0.6 here)
    expect(out).toMatch(/RectangleType="RoundEdge" CornerRadius="600"/);
    expect(out).toMatch(/RectangleType="RoundEdge Shadow" CornerRadius="300" ShadowSize="400"/);
    // the shadow falls toward the corner stored first, so the bottom-right corner goes first
    expect(out).toMatch(/BoundingBox="90.00 230.00 60.00 200.00" RectangleType="RoundEdge Shadow"/);
  });

  it('writes the rings in abbreviations with alternating double bonds', () => {
    // ChemDraw ranks groups for R/S from these; 1.5 bonds in a phenyl can flip a label
    const doc = new Doc();
    doc.bulk(() => {
      const c = doc.addAtom(100, 100), ph = doc.addAtom(114.4, 100, 6, { label: 'Ph' });
      doc.addBond(c.id, ph.id);
    });
    const root = new DOMParser().parseFromString(writeCdxml(doc).replace(/<!DOCTYPE[^>]*>/, ''), 'application/xml').documentElement;
    const inner = [...root.getElementsByTagName('n')].find((n) => n.getAttribute('NodeType') === 'Nickname')!.getElementsByTagName('fragment')[0];
    const orders = [...inner.getElementsByTagName('b')].map((b) => b.getAttribute('Order') ?? '1');
    expect(orders.filter((o) => o === '2').length).toBe(3);
    expect(orders).not.toContain('1.5');
  });

  it('places labels where ChemDraw would', () => {
    const out = writeCdxml(sample());
    // OH to the right of its bond: left-justified, baseline 0.39 × size below the atom
    const m = /p="128\.80 100\.00"[^>]*><t p="([\d.]+) ([\d.]+)"[^>]*LabelJustification="Left"/.exec(out)!;
    expect(Number(m[2])).toBeCloseTo(103.9, 1);
    expect(Number(m[1])).toBeLessThan(128.8);
  });

  it('a curved arrow keeps its bend', () => {
    const doc = sample();
    const back = open(writeCdxml(doc));
    const curved = [...back.arrows.values()].find((a) => a.sweep)!;
    expect(curved.sweep).toBeCloseTo(Math.PI / 2, 3);
  });

  it('keeps the styles of the arrow and shape tools', () => {
    const doc = new Doc();
    const base = { headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 } as const;
    doc.bulk(() => {
      doc.addArrow({ ...base, tail: { x: 0, y: 0 }, head: { x: 40, y: 0 }, headType: 'angle', shaftSpacing: 3.6, headLength: 3.6, headWidth: 0.9 });
      doc.addArrow({ ...base, tail: { x: 0, y: 20 }, head: { x: 40, y: 20 }, headStyle: 'halfLeft', tailStyle: 'halfLeft', equilibrium: true });
      doc.addArrow({ ...base, tail: { x: 0, y: 40 }, head: { x: 40, y: 40 }, headStyle: 'halfRight', sweep: (-120 * Math.PI) / 180 });
      doc.addArrow({ ...base, tail: { x: 0, y: 60 }, head: { x: 40, y: 60 }, tailStyle: 'full', headType: 'hollow', line: 'dashed', noGo: true });
      doc.addShape({ kind: 'line', x1: 60, y1: 0, x2: 90, y2: 10, dashed: true, bold: true });
      doc.addShape({ kind: 'oval', x1: 60, y1: 20, x2: 70, y2: 30, filled: true });
      doc.addShape({ kind: 'bracket', bracket: 'curly', x1: 60, y1: 80, x2: 60, y2: 40 });
    });
    const back = open(writeCdxml(doc));
    const arrows = [...back.arrows.values()].sort((a, b) => a.tail.y - b.tail.y);
    expect(arrows[0]).toMatchObject({ headType: 'angle', equilibrium: false });
    expect(arrows[0].shaftSpacing).toBeCloseTo(3.6, 5);
    expect(arrows[1]).toMatchObject({ equilibrium: true, headStyle: 'halfLeft', tailStyle: 'halfLeft' });
    expect(arrows[1].shaftSpacing).toBeUndefined();
    expect(arrows[2].headStyle).toBe('halfRight');
    expect(arrows[2].sweep).toBeCloseTo((-120 * Math.PI) / 180, 3);
    expect(arrows[3]).toMatchObject({ tailStyle: 'full', headType: 'hollow', line: 'dashed', noGo: true });
    const shapes = [...back.shapes.values()];
    expect(shapes.find((s) => s.kind === 'line')).toMatchObject({ dashed: true, bold: true });
    expect(shapes.find((s) => s.kind === 'oval')).toMatchObject({ filled: true, x1: 60, x2: 70 });
    expect(shapes.find((s) => s.kind === 'bracket')).toMatchObject({ bracket: 'curly', x1: 60, y1: 80, x2: 60, y2: 40 });
  });
});

describe('saving again after a save', () => {
  it('writes the same bytes, and later edits get fresh ids', async () => {
    const { adoptSaved } = await import('../src/io/document-file');
    const doc = new Doc();
    doc.bulk(() => {
      const a = doc.addAtom(100, 100), b = doc.addAtom(114.4, 100, 6, { label: 'OMe' });
      doc.addBond(a.id, b.id);
    });
    const first = writeCdxml(doc, { name: 'a.cdxml' });
    adoptSaved(doc, first);
    expect(doc.source).not.toBeNull();
    expect(writeCdxml(doc, { name: 'a.cdxml' })).toBe(first);
    // the OMe abbreviation's own atoms used ids; a new atom must not reuse them
    doc.edit('add', () => { const c = doc.addAtom(90, 110); doc.addBond(1, c.id); });
    const second = writeCdxml(doc, { name: 'a.cdxml' });
    expect(duplicateIds(second)).toEqual([]);
    expect(differences(summarize(open(second)), summarize(doc))).toEqual([]);
  });
});

describe('atom numbers and numbered points of attachment', () => {
  // as ChemDraw 25 wrote them after the ' and . keys (label size 6)
  const CHEMDRAW = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML LabelSize="6" BondLength="10.80"><page id="1"><fragment id="10"
><n id="11" p="14.25 252.84"/><n id="12" p="23.60 247.44" ShowAtomNumber="yes" AS="N" AtomNumber="1"
><objecttag TagType="Unknown" Name="number"><t p="25.05 247.09" BoundingBox="25.05 243.29 27.56 247.09" CaptionLineHeight="variable"
><s font="3" size="4.5" color="0">1</s></t></objecttag></n
><b id="13" B="11" E="12"/></fragment><fragment id="20"
><n id="21" p="57.47 252.84"/><n id="22" p="66.82 247.44" NodeType="ExternalConnectionPoint" ExternalConnectionNum="1"/>
<b id="23" B="21" E="22"/></fragment></page></CDXML>`;

  it("reads ChemDraw's atom number and attachment number", () => {
    const doc = readCdxml(CHEMDRAW).doc;
    const n = doc.atoms.get(12)!;
    expect(n).toMatchObject({ showNumber: true, atomNumber: '1' });
    expect(n.numberLabel!.dx).toBeCloseTo(1.45, 2);
    expect(n.numberLabel!.dy).toBeCloseTo(-0.35, 2);
    expect(n.numberLabel!.size).toBe(4.5);
    expect(doc.atoms.get(22)).toMatchObject({ attach: 'Unspecified', attachNum: 1 });
  });

  it('writes them as ChemDraw does in a new drawing, where ChemDraw puts the number', () => {
    const doc = new Doc();
    doc.style = { ...doc.style, labelSize: 6, bondLength: 10.8 };
    doc.bulk(() => {
      const a = doc.addAtom(14.25, 252.84), b = doc.addAtom(23.6, 247.44, 6, { showNumber: true, atomNumber: '1' });
      doc.addBond(a.id, b.id);
      const c = doc.addAtom(57.47, 252.84), d = doc.addAtom(66.82, 247.44, 0, { attach: 'Unspecified', attachNum: 2 });
      doc.addBond(c.id, d.id);
    });
    const text = writeCdxml(doc);
    expect(text).toMatch(/ShowAtomNumber="yes"/);
    expect(text).toMatch(/AtomNumber="1"/);
    expect(text).toMatch(/NodeType="ExternalConnectionPoint"[^>]*ExternalConnectionNum="2"/);
    const tag = /<objecttag[^>]*Name="number"[^>]*>\s*<t\s+p="([\d.]+) ([\d.]+)"[\s\S]*?size="([\d.]+)"/.exec(text)!;
    expect(Number(tag[1])).toBeCloseTo(25.04, 1);
    expect(Number(tag[2])).toBeCloseTo(247.08, 1);
    expect(Number(tag[3])).toBe(4.5);
    const back = readCdxml(text).doc;
    expect([...back.atoms.values()].find((a) => a.atomNumber)).toMatchObject({ showNumber: true, atomNumber: '1' });
    expect([...back.atoms.values()].find((a) => a.attach)).toMatchObject({ attachNum: 2 });
  });

  it('changes them in a file that was opened, and takes them away', () => {
    const doc = readCdxml(CHEMDRAW).doc;
    doc.edit('number', () => {
      doc.updateAtom(12, { atomNumber: '7' });
      doc.updateAtom(11, { showNumber: true, atomNumber: '2' });
      doc.updateAtom(22, { attachNum: 3 });
    });
    let text = writeCdxml(doc);
    let back = readCdxml(text).doc;
    expect(back.atoms.get(12)).toMatchObject({ showNumber: true, atomNumber: '7' });
    expect(back.atoms.get(11)).toMatchObject({ showNumber: true, atomNumber: '2' });
    expect(back.atoms.get(22)).toMatchObject({ attachNum: 3 });
    expect(text.match(/Name="number"/g)).toHaveLength(2);
    doc.edit('hide', () => { doc.updateAtom(12, { showNumber: false }); doc.updateAtom(22, { attach: undefined, attachNum: undefined, z: 6 }); });
    text = writeCdxml(doc);
    back = readCdxml(text).doc;
    expect(back.atoms.get(12)!.showNumber).toBeUndefined();
    expect(back.atoms.get(22)).toMatchObject({ z: 6 });
    expect(back.atoms.get(22)!.attach).toBeUndefined();
    expect(text.match(/Name="number"/g)).toHaveLength(1);
  });
});
