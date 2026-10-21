import { describe, it, expect } from 'vitest';
import { Doc, HIGHLIGHT_DEFAULTS, type HighlightStyle } from '../src/model';
import { softAlpha, fillSteps, highlightFx, needsFx, shapeShadow, layerPaints, type Region } from '../src/render/highlight-fx';
import { highlightStyleFromTag } from '../src/render/highlight';
import { parseLooks, BUILT_IN_LOOKS } from '../src/ui/highlight-looks';
import { highlightParts, partHolds, targetOf } from '../src/deck/animation';

const style = (s: HighlightStyle = {}) => ({ ...HIGHLIGHT_DEFAULTS, ...s }) as Required<HighlightStyle>;
const area = (r: Region) => r.reduce((t, ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; }
  return t + a / 2;
}, 0);
const square = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

describe('soft edges', () => {
  it('fades only the part it is told to, smoothly', () => {
    // outer quarter: solid inside 75 %, clear at the edge
    expect(softAlpha(0.5, 0.25, 'outer')).toBe(1);
    expect(softAlpha(0.75, 0.25, 'outer')).toBeCloseTo(1);
    expect(softAlpha(0.875, 0.25, 'outer')).toBeCloseTo(0.5);
    expect(softAlpha(1, 0.25, 'outer')).toBeCloseTo(0);
    // inner quarter: clear on the bonds, solid from 25 % out
    expect(softAlpha(0, 0.25, 'inner')).toBeCloseTo(0);
    expect(softAlpha(0.3, 0.25, 'inner')).toBe(1);
    // both: an eighth at each side
    expect(softAlpha(0.5, 0.25, 'both')).toBe(1);
    expect(softAlpha(1, 0.25, 'both')).toBeCloseTo(0);
    expect(softAlpha(0, 0.25, 'both')).toBeCloseTo(0);
    expect(softAlpha(0.2, 0.25, 'both')).toBe(1);
    expect(softAlpha(0.1, 0.25, 'both')).toBeLessThan(1);
  });

  it('steps finely through the fading part only', () => {
    const at = fillSteps(style({ soft: true, softAmount: 0.25, softSide: 'outer' }));
    expect(at[0]).toBe(1);
    expect(at.every((t) => t >= 0.75)).toBe(true);
    expect(at.length).toBe(17);
    expect(fillSteps(style({ soft: true, softAmount: 0.5, softSide: 'both' })).length).toBeGreaterThan(30);
  });

  it('needs the slower drawing only for effects', () => {
    expect(needsFx(style())).toBe(false);
    expect(needsFx(style({ shadow: true }))).toBe(false);
    expect(needsFx(style({ shadow: true, shadowBlur: 0.1 }))).toBe(true);
    expect(needsFx(style({ glow: true }))).toBe(true);
    expect(needsFx(style({ line: 'dashed' }))).toBe(true);
  });
});

describe('highlight effects', () => {
  it('makes an outline only highlight with no fill but a line', () => {
    const fx = highlightFx(style({ fill: 'none', line: 'dashed' }), '#ffd400', 10);
    expect(fx.body).toBeNull();
    expect(fx.outline?.dash.length).toBe(2);
  });

  it('makes see-through fills and cuts the shadow out from under them', () => {
    const fx = highlightFx(style({ transparency: 0.5, shadow: true }), '#ffd400', 10);
    expect(fx.body!.steps[0].alpha).toBeCloseTo(0.5);
    expect(fx.shadow!.cut).toBe(true);
  });

  it('paints each ring of a fade once, without overlaps', () => {
    // a square highlight that grows by 1 for each step
    const level = (_t: number, grow: number) => [[[[-grow, -grow], [10 + grow, -grow], [10 + grow, 10 + grow], [-grow, 10 + grow], [-grow, -grow]]]] as [number, number][][][];
    const paints = layerPaints({ steps: [{ t: 1, grow: 2, colour: '#000000', alpha: 0.3 }, { t: 1, grow: 0, colour: '#000000', alpha: 1 }] }, level, []);
    expect(paints.length).toBe(2);
    expect(Math.abs(area(paints[0].region))).toBeCloseTo(14 * 14 - 100);
    expect(Math.abs(area(paints[1].region))).toBeCloseTo(100);
  });

  it('gives shapes a blurred shadow that adds up to the shape and only sticks out when cut', () => {
    const sq = [square(0, 0, 10)];
    const hard = shapeShadow(sq, { colour: '#000000', opacity: 0.4, angle: 0, distance: 3, blur: 0 }, false);
    expect(hard.length).toBe(1);
    expect(Math.abs(area(hard[0].region))).toBeCloseTo(100);
    const cut = shapeShadow(sq, { colour: '#000000', opacity: 0.4, angle: 0, distance: 3, blur: 0 }, true);
    expect(Math.abs(area(cut[0].region))).toBeCloseTo(30);
    const soft = shapeShadow(sq, { colour: '#000000', opacity: 0.4, angle: 45, distance: 2, blur: 2 }, false);
    expect(soft.length).toBeGreaterThan(5);
  });
});

describe('highlight settings in files', () => {
  it('keeps the new settings and drops what makes no sense', () => {
    const s = highlightStyleFromTag(JSON.stringify({ softAmount: 0.25, softSide: 'both', fill: 'linear', colour2: '#FF0000', pattern: 'crosshatch', line: 'dotted', glow: true, glowSize: 0.2, shadowBlur: 0.1, transparency: 0.3 }));
    expect(s).toEqual({ softAmount: 0.25, softSide: 'both', fill: 'linear', colour2: '#ff0000', pattern: 'crosshatch', line: 'dotted', glow: true, glowSize: 0.2, shadowBlur: 0.1, transparency: 0.3 });
    expect(highlightStyleFromTag(JSON.stringify({ softSide: 'sideways', fill: 'plaid', transparency: 4, lineColour: 'red' }))).toBeUndefined();
  });

  it('reads saved looks, keeping only sensible ones', () => {
    const got = parseLooks([{ name: ' Mine ', colour: '#ABCDEF', style: { glow: true } }, { name: 'Mine', style: {} }, { name: '', style: {} }, 'junk', { name: 'Plain', colour: 'blue' }]);
    expect(got).toEqual([{ name: 'Mine', colour: '#abcdef', style: { glow: true } }, { name: 'Plain', style: {} }]);
    expect(parseLooks(null)).toEqual([]);
    expect(BUILT_IN_LOOKS.length).toBeGreaterThan(10);
    expect(BUILT_IN_LOOKS.every((l) => highlightStyleFromTag(JSON.stringify(l.style)) !== undefined || !Object.keys(l.style).length)).toBe(true);
  });
});

describe('highlights as animation parts', () => {
  it('splits highlights into runs of one colour and look, apart from the structure', () => {
    const doc = new Doc();
    let a: number[] = [], b: number[] = [];
    doc.edit('Chain', () => {
      a = [0, 1, 2, 3, 4].map((i) => doc.addAtom(i * 20, 0).id);
      b = [0, 1, 2, 3].map((i) => doc.addBond(a[i], a[i + 1]).id);
    });
    // two yellow atoms joined by a yellow bond, and a blue bond on its own
    doc.atoms.get(a[0])!.highlight = '#ffd400';
    doc.atoms.get(a[1])!.highlight = '#ffd400';
    doc.bonds.get(b[0])!.highlight = '#ffd400';
    doc.bonds.get(b[3])!.highlight = '#4488ff';
    const all = { atoms: new Set(a), bonds: new Set(b), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
    const parts = highlightParts(doc, all);
    expect(parts.length).toBe(2);
    const yellow = parts.find((p) => p.sel.atoms.size)!;
    expect([...yellow.sel.atoms].sort()).toEqual([a[0], a[1]].sort());
    expect([...yellow.sel.bonds]).toEqual([b[0]]);
    const blue = parts.find((p) => !p.sel.atoms.size)!;
    expect(targetOf(blue)).toEqual({ kind: 'highlight', id: b[3], bond: true });
    // a highlight's target is not the structure's, and the other way round
    expect(partHolds(yellow, targetOf(yellow))).toBe(true);
    expect(partHolds(yellow, { kind: 'atom', id: a[0] })).toBe(false);
    expect(partHolds({ kind: 'drawing', sel: all }, targetOf(yellow))).toBe(false);
  });
});
