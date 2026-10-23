// @vitest-environment jsdom
//
// A charge sign in CDXML: ChemDraw stores the sign's centre then a point its width away, and paints
// a fragment's graphics in file order, so a + set inside an aromatic ring goes after the ring's circle.

import { describe, it, expect } from 'vitest';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';

const ring = '<n id="85" p="267.97 163.56" Charge="1"/><n id="86" p="280.87 157.17"/><n id="87" p="283.92 143.10"/><n id="88" p="274.83 131.94"/><n id="89" p="260.43 132.10"/><n id="90" p="251.58 143.44"/><n id="91" p="254.93 157.46"/>'
  + '<b id="92" B="85" E="86" Order="1.5"/><b id="93" B="86" E="87" Order="1.5"/><b id="94" B="87" E="88" Order="1.5"/><b id="95" B="88" E="89" Order="1.5"/><b id="96" B="89" E="90" Order="1.5"/><b id="97" B="90" E="91" Order="1.5"/><b id="98" B="91" E="85" Order="1.5"/>';
const circle = '<graphic id="101" BoundingBox="277.06 146.97 267.79 146.97" GraphicType="Orbital" OvalType="Circle" OrbitalType="s" Center3D="267.79 146.97 0" MajorAxisEnd3D="277.06 146.97 0" MinorAxisEnd3D="267.79 156.23 0"/>';
const file = (program: string, plusBox: string) => `<?xml version="1.0" encoding="UTF-8" ?><CDXML CreationProgram="${program}" BondLength="14.40"><page id="102"><fragment id="100">${ring}`
  + `<graphic id="99" GraphicType="Symbol" SymbolType="Plus" BoundingBox="${plusBox}"><represent attribute="Charge" object="85"/></graphic>${circle}</fragment></page></CDXML>`;

const plusOf = (text: string) => [...readCdxml(text).doc.shapes.values()].find((s) => s.symbol === 'Plus')!;
const centre = (s: { x1: number; y1: number; x2: number; y2: number }) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });

describe('charge signs in CDXML', () => {
  it('reads ChemDraw\'s form and this program\'s older form to the same place', () => {
    const old = plusOf(file('Chem Illustrator', '270.85 150.63 265.09 150.63'));
    const cd = plusOf(file('ChemDraw 25.0', '267.97 147.75 267.97 153.51'));
    for (const s of [old, cd]) {
      expect(centre(s).x).toBeCloseTo(267.97, 2);
      expect(centre(s).y).toBeCloseTo(147.75, 2);
      expect(s.x2 - s.x1).toBeCloseTo(5.76, 2);
    }
  });

  it('writes the + after the ring circle, as its centre then a point its width below', () => {
    const { doc } = readCdxml(file('Chem Illustrator', '270.85 150.63 265.09 150.63'));
    // a new document, so every object is written afresh
    doc.source = null;
    const out = writeCdxml(doc);
    const dom = new DOMParser().parseFromString(out.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml');
    const gs = [...dom.getElementsByTagName('graphic')];
    const plus = gs.findIndex((g) => g.getAttribute('SymbolType') === 'Plus');
    const orb = gs.findIndex((g) => g.getAttribute('GraphicType') === 'Orbital');
    expect(orb).toBeGreaterThanOrEqual(0);
    expect(plus).toBeGreaterThan(orb);
    expect(gs[plus].getAttribute('BoundingBox')).toBe('267.97 147.75 267.97 153.51');
    // and it reads back where it was
    expect(centre(plusOf(out)).y).toBeCloseTo(147.75, 2);
  });

  it('moves the + after the circle when re-saving a file that had it before', () => {
    const { doc } = readCdxml(file('Chem Illustrator', '270.85 150.63 265.09 150.63'));
    const s = [...doc.shapes.values()].find((x) => x.symbol === 'Plus')!;
    doc.edit('Move', () => doc.updateShape(s.id, { x1: s.x1 + 1, x2: s.x2 + 1 }));
    const out = writeCdxml(doc);
    expect(out.indexOf('SymbolType="Plus"')).toBeGreaterThan(out.indexOf('GraphicType="Orbital"'));
  });
});
