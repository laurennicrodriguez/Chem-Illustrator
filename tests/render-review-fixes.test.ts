// @vitest-environment jsdom
//
// Drawing fixes from the code review: a hash spacing of 0 in a file, a label drawn after a charged
// carbon, and the longest bond worked out again when it gets shorter.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Renderer } from '../src/render/renderer';
import { VecPath, VectorContext } from '../src/render/vector';
import { recordPicture } from '../src/render/picture';
import { readCdxml } from '../src/io/cdxml';

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
class Counted extends VecPath {
  n = 0;
  moveTo(x: number, y: number) { if (++this.n > 10000) throw new Error('runaway'); super.moveTo(x, y); }
}

describe('drawing', () => {
  it('draws hashed bonds from a file with a hash spacing of 0', () => {
    const xml = `<?xml version="1.0"?><CDXML HashSpacing="0" BondLength="14.4"><page><fragment>
<n id="1" p="100 100"/><n id="2" p="114.4 100"/><b id="3" B="1" E="2" Display="Hash"/></fragment></page></CDXML>`;
    const { doc } = readCdxml(xml);
    expect(doc.style.hashSpacing).toBeGreaterThan(0);
    const r = new Renderer(noCanvas, noCanvas);
    r.makePath = () => new Counted() as unknown as Path2D;
    expect(() => r.drawDocument(new VectorContext() as unknown as CanvasRenderingContext2D, doc)).not.toThrow();
  });

  it('draws a label after a charged carbon at its own size and the + in the carbon\'s colour', () => {
    const doc = new Doc();
    doc.edit('x', () => {
      const o = doc.addAtom(0, 0, 8, { color: '#ff0000' });
      const c = doc.addAtom(14.4, 7, 6, { charge: 1, color: '#0000ff' });
      const c2 = doc.addAtom(28.8, 0, 6);
      const n = doc.addAtom(43.2, 7, 7);
      doc.addBond(o.id, c.id); doc.addBond(c.id, c2.id); doc.addBond(c2.id, n.id);
    });
    const items = recordPicture(doc)!.items.filter((i) => i.kind === 'text') as { text: string; size: number; color?: string; fill?: string }[];
    const label = items.find((i) => i.text === 'N')!;
    expect(label.size).toBe(doc.style.labelSize);
    const plus = items.find((i) => i.text === '+')! as Record<string, unknown>;
    expect(JSON.stringify(plus)).toContain('#0000ff');
  });

  it('works out the longest bond again once a long one is undone', () => {
    const doc = new Doc();
    let id = 0;
    doc.edit('x', () => { const a = doc.addAtom(0, 0, 6); const b = doc.addAtom(14.4, 0, 6); doc.addBond(a.id, b.id); id = b.id; });
    expect(doc.maxBondLength).toBeCloseTo(14.4, 6);
    doc.edit('drag', () => doc.updateAtom(id, { x: 600 }));
    expect(doc.maxBondLength).toBeCloseTo(600, 6);
    doc.undo();
    expect(doc.maxBondLength).toBeCloseTo(14.4, 6);
  });
});
