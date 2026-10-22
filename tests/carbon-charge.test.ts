// @vitest-environment jsdom
//
// A charge on a carbon drawn without its letter shows beside the carbon (CH2⁻, a carbocation).

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { recordSlide } from '../src/deck/slide-view';
import { defaultMaster, WIDE } from '../src/deck/deck';
import { applyCharge, freeCharge } from '../src/editor/editor';

function signs(charge: number, hideCharge = false): string[] {
  const d = new Doc();
  const L = d.style.bondLength;
  d.edit('Draw', () => {
    const a = d.addAtom(100, 100), b = d.addAtom(100 + L, 100);
    d.addBond(a.id, b.id);
    d.updateAtom(b.id, { charge, ...(hideCharge ? { hideCharge } : {}) });
  });
  const m = { ...defaultMaster(), slideNumbers: false };
  return recordSlide({ size: WIDE, master: m, layout: 'blank', index: 0 }, d).flatMap((it) => (it.kind === 'text' ? [it.text] : []));
}

describe('charges on carbons', () => {
  it('draws a minus or plus beside a carbon without its letter', () => {
    expect(signs(-1)).toContain('−');
    expect(signs(1)).toContain('+');
    expect(signs(-2)).toContain('2−');
  });

  it('leaves the sign off when a circled charge shows it', () => {
    expect(signs(1, true)).toEqual([]);
  });
});

describe('charges from the + and − keys', () => {
  const setup = () => {
    const d = new Doc();
    let id = 0;
    d.edit('Draw', () => { const a = d.addAtom(100, 100, 7); id = a.id; });
    return { d, id };
  };
  const spot = (a: { x: number; y: number }) => ({ x: a.x + 6, y: a.y - 6 });
  const circles = (d: Doc) => [...d.shapes.values()].filter((s) => s.kind === 'symbol').map((s) => s.symbol);

  it('gives a plain sign unless circled charges are chosen', () => {
    const { d, id } = setup();
    d.edit('+', () => applyCharge(d, id, 1, false, spot));
    expect(d.atoms.get(id)!.charge).toBe(1);
    expect(d.atoms.get(id)!.hideCharge).toBeUndefined();
    expect(circles(d)).toEqual([]);
  });

  it('puts a charge of one in a circle, and goes back to a plain sign for two', () => {
    const { d, id } = setup();
    d.edit('+', () => applyCharge(d, id, 1, true, spot));
    expect(circles(d)).toEqual(['CirclePlus']);
    expect(d.atoms.get(id)!.hideCharge).toBe(true);
    d.edit('+', () => applyCharge(d, id, 2, true, spot));
    expect(circles(d)).toEqual([]);
    expect(d.atoms.get(id)!.hideCharge).toBeUndefined();
    d.edit('-', () => applyCharge(d, id, 1, true, spot));
    d.edit('-', () => applyCharge(d, id, 0, true, spot));
    d.edit('-', () => applyCharge(d, id, -1, true, spot));
    expect(circles(d)).toEqual(['CircleMinus']);
    expect(d.atoms.get(id)!.charge).toBe(-1);
  });

  it('keeps a circled charge circled when the setting is off', () => {
    const { d, id } = setup();
    d.edit('+', () => applyCharge(d, id, 1, true, spot));
    d.edit('-', () => applyCharge(d, id, 0, false, spot));
    expect(circles(d)).toEqual([]);
    d.edit('-', () => applyCharge(d, id, -1, false, spot));
    expect(circles(d)).toEqual([]);
    expect(d.atoms.get(id)!.hideCharge).toBeUndefined();
  });
});

describe('moving a charge off its atom', () => {
  it('takes the sign off as a + of its own, stuck to the atom, and keeps it plain when the charge changes', () => {
    const d = new Doc();
    let id = 0;
    d.edit('Draw', () => {
      const a = d.addAtom(100, 100), b = d.addAtom(114, 100);
      d.addBond(a.id, b.id);
      d.updateAtom(b.id, { charge: 1 });
      id = b.id;
    });
    let s = 0;
    d.edit('Move Charge', () => { s = freeCharge(d, id, { x1: 117, y1: 97, x2: 123, y2: 103 }); });
    expect(d.shapes.get(s)!.symbol).toBe('Plus');
    expect(d.shapes.get(s)!.pin?.ref[0]).toBe(id);
    expect(d.atoms.get(id)!.hideCharge).toBe(true);
    // no sign drawn by the atom any more, only the symbol
    expect(signs(1, true)).not.toContain('+');
    d.edit('Charge', () => applyCharge(d, id, -1, false, (a) => ({ x: a.x + 5, y: a.y })));
    const left = [...d.shapes.values()].filter((x) => x.kind === 'symbol');
    expect(left.map((x) => x.symbol)).toEqual(['Minus']);
    d.edit('Charge', () => applyCharge(d, id, 0, false, (a) => ({ x: a.x + 5, y: a.y })));
    expect([...d.shapes.values()].filter((x) => x.kind === 'symbol')).toHaveLength(0);
    expect(d.atoms.get(id)!.hideCharge).toBeUndefined();
  });
});
