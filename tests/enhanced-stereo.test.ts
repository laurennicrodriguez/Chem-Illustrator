// @vitest-environment jsdom
//
// Enhanced stereo groups (abs, &1, or1) and chiral flags (Abs, Rel, Rac), saved and read the way
// ChemDraw 25 keeps them (checked by re-saving a test file in ChemDraw).

import { describe, expect, it } from 'vitest';
import { Doc, enhancedText, flagTextSize } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

function butanol(): { doc: Doc; c2: number; c3: number } {
  const doc = new Doc();
  let c2 = 0, c3 = 0;
  doc.edit('d', () => {
    const a = doc.addAtom(60, 100), b = doc.addAtom(72.47, 92.8, 6, { enhStereo: { type: 'and', group: 2 } });
    const c = doc.addAtom(84.94, 100, 6, { enhStereo: { type: 'or', group: 1 } }), d = doc.addAtom(97.41, 92.8);
    const o = doc.addAtom(72.47, 78.4, 8), cl = doc.addAtom(84.94, 114.4, 17);
    doc.addBond(a.id, b.id, 1); doc.addBond(b.id, c.id, 1); doc.addBond(c.id, d.id, 1);
    doc.addBond(b.id, o.id, 1, 'wedge'); doc.addBond(c.id, cl.id, 1, 'hashWedge');
    doc.addShape({ kind: 'symbol', symbol: 'Racemic', x1: 80, y1: 120, x2: 102, y2: 135.5 });
    c2 = b.id; c3 = c.id;
  });
  return { doc, c2, c3 };
}

describe('enhanced stereo', () => {
  it('labels groups as ChemDraw does', () => {
    expect(enhancedText({ type: 'abs' })).toBe('abs');
    expect(enhancedText({ type: 'and', group: 3 })).toBe('&3');
    expect(enhancedText({ type: 'or' })).toBe('or1');
  });

  it('saves the group on the node with a tag holding its label', () => {
    const { doc, c2, c3 } = butanol();
    const dom = new DOMParser().parseFromString(writeCdxml(doc), 'text/xml');
    const node = (id: number) => [...dom.getElementsByTagName('n')].find((n) => n.getAttribute('id') === String(id))!;
    expect(node(c2).getAttribute('EnhancedStereoType')).toBe('And');
    expect(node(c2).getAttribute('EnhancedStereoGroupNum')).toBe('2');
    expect(node(c3).getAttribute('EnhancedStereoType')).toBe('Or');
    const tag = [...node(c2).getElementsByTagName('objecttag')].find((t) => t.getAttribute('Name') === 'enhancedstereo')!;
    expect(tag.textContent).toBe('&2');
  });

  it('reads groups and flags back', () => {
    const { doc, c2, c3 } = butanol();
    const back = readCdxml(writeCdxml(doc)).doc;
    const enh = [...back.atoms.values()].map((a) => a.enhStereo).filter(Boolean);
    expect(enh).toEqual([{ type: 'and', group: 2 }, { type: 'or', group: 1 }]);
    expect(c2).not.toBe(c3);
    const flag = [...back.shapes.values()].find((s) => s.symbol === 'Racemic')!;
    expect(flag).toBeTruthy();
    // the box comes back the same size, so the word is the same size
    expect(flagTextSize(flag)).toBeCloseTo(flagTextSize({ y1: 120, y2: 135.5 }), 0);
  });

  it('reads an absolute centre without a group number', () => {
    const xml = `<?xml version="1.0"?><CDXML><page><fragment><n id="1" p="10 10" EnhancedStereoType="Absolute"/><n id="2" p="24 10"/><b id="3" B="1" E="2"/></fragment></page></CDXML>`;
    const a = [...readCdxml(xml).doc.atoms.values()][0];
    expect(a.enhStereo).toEqual({ type: 'abs' });
  });
});
