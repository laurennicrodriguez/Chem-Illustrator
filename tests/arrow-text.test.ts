// Text above and below a reaction arrow: the "+" boxes, the side panel's fields, fitting the
// arrow to its text, and the scheme settings that steer them.

import { afterEach, describe, it, expect } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { plainMeasure, inFrame, arrowFrame } from '../src/chem/reaction';
import { arrowTexts, helperBox, setSideText, takesHelpers, textRuns } from '../src/chem/arrow-text';
import { DEFAULT_SCHEME_PREFS, SPACING, fittedLength, lineStart, parseSchemePrefs, setSchemePrefs, spacing } from '../src/chem/scheme-layout';
import { plainText } from '../src/richtext';

const arrow = (doc: Doc, tail = { x: 100, y: 100 }, head = { x: 160, y: 100 }, extra: Partial<Arrow> = {}): Arrow =>
  doc.edit('arrow', () => doc.addArrow({ tail, head, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5, ...extra }));

afterEach(() => setSchemePrefs(DEFAULT_SCHEME_PREFS));

describe('text above and below a reaction arrow', () => {
  it('adds a line above, clear of the arrow, and fits the arrow to it', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => setSideText(doc, m, r, 'above', 'Pd(PPh3)4, K2CO3'));
    const now = doc.arrows.get(r.id)!;
    const t = arrowTexts(doc, m, now);
    expect(t.above.length).toBe(1);
    expect(t.below.length).toBe(0);
    const c = t.above[0];
    expect(plainText(c.runs)).toBe('Pd(PPh3)4, K2CO3');
    const f = arrowFrame(now);
    const q = inFrame(f, m.captionBox(c));
    const bond = doc.style.bondLength;
    const sp = spacing(bond);
    expect(q.s1).toBeCloseTo(sp.conditions, 3);
    // the arrow starts `lead` before the text and ends `headGap` plus its head after it
    expect(q.t1).toBeCloseTo(sp.lead, 3);
    expect(f.length).toBeCloseTo(fittedLength(q.t2 - q.t1, 6, bond), 3);
    expect(now.tail).toEqual({ x: 100, y: 100 });
  });
  it('without fitting, centres the text on the shaft and leaves the arrow alone', () => {
    setSchemePrefs({ fit: false });
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => setSideText(doc, m, r, 'above', 'NaH'));
    const now = doc.arrows.get(r.id)!;
    expect(now.head).toEqual({ x: 160, y: 100 });
    const q = inFrame(arrowFrame(now), m.captionBox(arrowTexts(doc, m, now).above[0]));
    expect((q.t1 + q.t2) / 2).toBeCloseTo((60 - 6) / 2, 3);
  });
  it('moves the products and their number along when the arrow grows', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    let p = 0, n = 0;
    doc.edit('product', () => {
      const a = doc.addAtom(180, 100), b = doc.addAtom(192, 100);
      doc.addBond(a.id, b.id);
      p = a.id;
      n = doc.addCaption({ x: 186, y: 118, runs: [{ text: '1' }], justify: 'center' }).id;
    });
    doc.edit('t', () => setSideText(doc, m, r, 'above', 'Pd2(dba)3, XPhos, Cs2CO3'));
    const dl = arrowFrame(doc.arrows.get(r.id)!).length - 60;
    expect(dl).toBeGreaterThan(10);
    expect(doc.atoms.get(p)!.x).toBeCloseTo(180 + dl, 3);
    expect(doc.captions.get(n)!.x).toBeCloseTo(186 + dl, 3);
  });
  it('uses the text gap, size and alignment from the settings', () => {
    setSchemePrefs({ textGap: 4, textSize: 14, textAlign: 'left' });
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => setSideText(doc, m, r, 'below', 'THF\n−78 °C to rt'));
    const now = doc.arrows.get(r.id)!;
    const c = arrowTexts(doc, m, now).below[0];
    expect(c.justify).toBe('left');
    expect(c.runs.every((x) => x.size === 14)).toBe(true);
    expect(inFrame(arrowFrame(now), m.captionBox(c)).s2).toBeCloseTo(-4, 3);
  });
  it('puts formulas’ digits in subscript and leaves other numbers alone', () => {
    const runs = textRuns('K2CO3, 80 °C');
    const subs = runs.filter((x) => x.sub).map((x) => x.text).join('');
    expect(subs).toBe('23');
    expect(plainText(runs)).toBe('K2CO3, 80 °C');
  });
  it('adds a line below, changes it, and removes it when emptied', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => setSideText(doc, m, r, 'below', 'THF, 0 °C'));
    const now = () => doc.arrows.get(r.id)!;
    const c = arrowTexts(doc, m, now()).below[0];
    expect(inFrame(arrowFrame(now()), m.captionBox(c)).s2).toBeCloseTo(-SPACING.conditions * doc.style.bondLength, 3);
    doc.edit('t', () => setSideText(doc, m, now(), 'below', 'THF, rt'));
    expect(arrowTexts(doc, m, now()).below.map((x) => plainText(x.runs))).toEqual(['THF, rt']);
    doc.edit('t', () => setSideText(doc, m, now(), 'below', ''));
    expect(arrowTexts(doc, m, now()).below.length).toBe(0);
    expect(doc.captions.size).toBe(0);
  });
  it('keeps roles kept with the arrow up to date', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc, undefined, undefined, { step: { reactants: [], products: [], above: [], below: [] } });
    doc.edit('t', () => setSideText(doc, m, r, 'above', 'NaBH4'));
    expect(doc.arrows.get(r.id)!.step!.above.length).toBe(1);
  });
  it('offers "+" boxes on level straight reaction arrows only', () => {
    const doc = new Doc();
    expect(takesHelpers(arrow(doc))).toBe(true);
    expect(takesHelpers(arrow(doc, { x: 0, y: 0 }, { x: 0, y: 60 }))).toBe(false);
    expect(takesHelpers(arrow(doc, undefined, undefined, { sweep: 1 }))).toBe(false);
    expect(takesHelpers(arrow(doc, undefined, undefined, { tailStyle: 'full' }))).toBe(false); // resonance
    const r = arrow(doc);
    const up = helperBox(doc, r, 'above'), down = helperBox(doc, r, 'below');
    expect(up.y2).toBeLessThan(100);
    expect(down.y1).toBeGreaterThan(100);
    // centred on the shaft (the arrow less its 6 pt head)
    expect((up.x1 + up.x2) / 2).toBeCloseTo(127, 6);
  });
});

describe('scheme settings', () => {
  it('reads saved settings, dropping nonsense', () => {
    expect(parseSchemePrefs(undefined)).toEqual(DEFAULT_SCHEME_PREFS);
    const p = parseSchemePrefs({ structGap: 12, plusGap: -3, textGap: 'x', textSize: 0, textAlign: 'right', helpers: false, fit: 'yes', lead: 4, headGap: 1e6 });
    expect(p).toEqual({ ...DEFAULT_SCHEME_PREFS, structGap: 12, textAlign: 'right', helpers: false, lead: 4 });
  });
  it('uses distances given in points, else scales with the bond length', () => {
    const auto = spacing(20, DEFAULT_SCHEME_PREFS);
    expect(auto.gap).toBeCloseTo(SPACING.gap * 20, 6);
    expect(auto.lead).toBeCloseTo(SPACING.overhang * 20, 6);
    const own = spacing(20, { ...DEFAULT_SCHEME_PREFS, structGap: 15, plusGap: 5, textGap: 3, lead: 2, headGap: 8 });
    expect([own.gap, own.plus, own.conditions, own.lead, own.headGap]).toEqual([15, 5, 3, 2, 8]);
  });
  it('fits the arrow to lead + text + head gap + head, never shorter than the minimum', () => {
    const p = { ...DEFAULT_SCHEME_PREFS, lead: 3, headGap: 5 };
    expect(fittedLength(100, 6, 14, p)).toBeCloseTo(114, 6);
    expect(fittedLength(0, 6, 14, p)).toBeCloseTo(SPACING.minArrow * 14, 6);
  });
  it('lines lines up left, centre or right within the text block', () => {
    const base = { ...DEFAULT_SCHEME_PREFS, lead: 4 };
    expect(lineStart(20, 50, 80, 6, 14, { ...base, textAlign: 'left' })).toBeCloseTo(4, 6);
    expect(lineStart(20, 50, 80, 6, 14, { ...base, textAlign: 'center' })).toBeCloseTo(19, 6);
    expect(lineStart(20, 50, 80, 6, 14, { ...base, textAlign: 'right' })).toBeCloseTo(34, 6);
    // not fitting: the block is centred on the shaft
    expect(lineStart(50, 50, 80, 6, 14, { ...base, fit: false })).toBeCloseTo(12, 6);
  });
});
