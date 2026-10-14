// @vitest-environment jsdom
//
// A radical's dot is saved the way ChemDraw keeps it: with the structure, naming its atom.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

describe('radical dots in saved files', () => {
  it('names the radical atom and sits with its structure', () => {
    const doc = new Doc();
    doc.edit('d', () => {
      const a = doc.addAtom(100, 100, 6, { radical: 'doublet' });
      const b = doc.addAtom(114.4, 100, 6);
      doc.addBond(a.id, b.id, 1);
      doc.addShape({ kind: 'symbol', symbol: 'Electron', x1: 95, y1: 100, x2: 95, y2: 100 });
    });
    const dom = new DOMParser().parseFromString(writeCdxml(doc), 'text/xml');
    const g = [...dom.getElementsByTagName('graphic')].find((e) => e.getAttribute('SymbolType') === 'Electron')!;
    expect(g.parentElement!.nodeName).toBe('fragment');
    const rep = g.getElementsByTagName('represent')[0];
    expect(rep.getAttribute('attribute')).toBe('Radical');
    const node = [...dom.getElementsByTagName('n')].find((n) => n.getAttribute('id') === rep.getAttribute('object'))!;
    expect(node.getAttribute('Radical')).toBe('Doublet');
    // the dot, then a point 4.5 pt further out from the atom (ChemDraw sizes the dot from it)
    expect(g.getAttribute('BoundingBox')).toBe('95.00 100.00 90.50 100.00');
  });

  it('reads a radical dot from ChemDraw as just the dot', () => {
    const xml = `<?xml version="1.0"?><CDXML><page id="1"><fragment id="2"><n id="3" p="113.18 222.38" Radical="Doublet"/>`
      + `<graphic id="4" BoundingBox="110.74 222.35 106.24 222.35" GraphicType="Symbol" SymbolType="Electron"><represent attribute="Radical" object="3"/></graphic></fragment></page></CDXML>`;
    const s = [...readCdxml(xml).doc.shapes.values()][0];
    expect([s.x1, s.y1, s.x2, s.y2]).toEqual([110.74, 222.35, 110.74, 222.35]);
  });
});
