import { describe, it, expect } from 'vitest';
import { axialTags } from '../src/chem/axial';

type A = [string, number, number];
type B = [number, number, number, number?]; // 1-based atoms, order, stereo (1 wedge, 6 hash) from the first atom

function mol(atoms: A[], bonds: B[]): string {
  const f = (v: number) => v.toFixed(4).padStart(10);
  const i3 = (v: number) => String(v).padStart(3);
  return ['t', '  test', '', `${i3(atoms.length)}${i3(bonds.length)}  0  0  0  0  0  0  0  0999 V2000`,
    ...atoms.map(([s, x, y]) => `${f(x)}${f(y)}${f(0)} ${s.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`),
    ...bonds.map(([a, b, o, st]) => `${i3(a)}${i3(b)}${i3(o)}${i3(st ?? 0)}`), 'M  END', ''].join('\n');
}

const mirror = (atoms: A[]): A[] => atoms.map(([s, x, y]) => [s, -x, y]);
const rotate = (atoms: A[], t: number): A[] => atoms.map(([s, x, y]) => [s, x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]);
const flipWedges = (bonds: B[]): B[] => bonds.map(([a, b, o, st]) => [a, b, o, st === 1 ? 6 : st === 6 ? 1 : st]);

// 1,3-dichloroallene: Cl in the page on the left end, Cl wedged on the right end
const alleneAtoms: A[] = [['C', 0, 0], ['C', 1, 0], ['C', 2, 0], ['Cl', -0.5, 0.87], ['Cl', 2.5, 0.87]];
const alleneBonds: B[] = [[1, 2, 2], [2, 3, 2], [1, 4, 1], [3, 5, 1, 1]];

// 2,2'-disubstituted biphenyl drawn flat: ring 1 (atoms 1-6) carries OMe at C2, ring 2 (7-12) a Me
// at C2' drawn with a wedge from the ring atom, so ring 2 stands across the page
function biaryl(): { atoms: A[]; bonds: B[] } {
  const atoms: A[] = [];
  const ring = (cx: number, cy: number, start: number) => {
    for (let k = 0; k < 6; k++) atoms.push(['C', cx + Math.cos(start + (k * Math.PI) / 3), cy + Math.sin(start + (k * Math.PI) / 3)]);
  };
  ring(0, 0, 0); // atom 1 at (1, 0): the axis end
  ring(3, 0, Math.PI); // atom 7 at (2, 0)
  atoms.push(['O', 1.5 + 0.0, 1.9], ['C', 1.2, 2.8]); // 13, 14: OMe on atom 2 (0.5, 0.87)
  atoms.push(['C', 2.5, 1.9]); // 15: Me on atom 8 (2.5, 0.87)
  const bonds: B[] = [];
  for (let k = 0; k < 6; k++) bonds.push([1 + k, 1 + ((k + 1) % 6), k % 2 ? 1 : 2]);
  for (let k = 0; k < 6; k++) bonds.push([7 + k, 7 + ((k + 1) % 6), k % 2 ? 1 : 2]);
  bonds.push([1, 7, 1], [2, 13, 1], [13, 14, 1], [8, 15, 1, 1]);
  return { atoms, bonds };
}

const label = (atoms: A[], bonds: B[]) => {
  const t = axialTags(mol(atoms, bonds));
  return [...t.bonds.map((b) => b[2]), ...t.atoms.map((a) => a[1])];
};

describe('axial chirality', () => {
  it('labels an allene, looking along the axis (near groups first)', () => {
    // seen from the left end: Cl (left of the axis), H (right), then the far Cl above: anticlockwise
    expect(axialTags(mol(alleneAtoms, alleneBonds)).atoms).toEqual([[1, 'Sa']]);
  });
  it('gives the mirror image the other label, whichever way it is mirrored', () => {
    expect(label(alleneAtoms, flipWedges(alleneBonds))).toEqual(['Ra']);
    expect(label(mirror(alleneAtoms), alleneBonds)).toEqual(['Ra']);
  });
  it('gives the same label however the drawing is turned or numbered', () => {
    for (const t of [0.4, 1.9, 3.1, 4.4]) expect(label(rotate(alleneAtoms, t), alleneBonds)).toEqual(['Sa']);
    // the same allene with its atoms listed from the other end
    const order = [3, 2, 1, 5, 4];
    const at = order.map((i) => alleneAtoms[i - 1]);
    const re = (i: number) => order.indexOf(i) + 1;
    const bonds: B[] = alleneBonds.map(([a, b, o, st]) => [re(a), re(b), o, st]);
    expect(label(at, bonds)).toEqual(['Sa']);
  });
  it('gives the same label when the wedge is on the other end instead', () => {
    // the right end in the page, the left Cl standing up toward the viewer… is a different
    // drawing of one of the two enantiomers; turning the molecule 90° about the axis maps
    // "left Cl in page, right Cl up" onto "left Cl down, right Cl in page"
    const bonds: B[] = [[1, 2, 2], [2, 3, 2], [1, 4, 1, 6], [3, 5, 1]];
    expect(label(alleneAtoms, bonds)).toEqual(['Sa']);
  });
  it('gives no label without a wedge, or when an end has two of the same group', () => {
    expect(label(alleneAtoms, alleneBonds.map(([a, b, o]) => [a, b, o]))).toEqual([]);
    const sym: A[] = [...alleneAtoms, ['Cl', -0.5, -0.87]];
    expect(label(sym, [...alleneBonds, [1, 6, 1]])).toEqual([]);
  });
  it('labels a biaryl whichever Kekulé structure is drawn, and its mirror image the other way', () => {
    const { atoms, bonds } = biaryl();
    const l = label(atoms, bonds);
    expect(l.length).toBe(1);
    const other = bonds.map(([a, b, o, st]) => (a <= 12 && b <= 12 && !(a === 1 && b === 7) ? [a, b, o === 2 ? 1 : 2, st] : [a, b, o, st]) as B);
    expect(label(atoms, other)).toEqual(l);
    expect(label(atoms, flipWedges(bonds))).toEqual([l[0] === 'Ra' ? 'Sa' : 'Ra']);
    expect(label(mirror(atoms), bonds)).toEqual([l[0] === 'Ra' ? 'Sa' : 'Ra']);
  });
  it('reads a wedge on the ring bond the same as one on the substituent', () => {
    const { atoms, bonds } = biaryl();
    const l = label(atoms, bonds);
    // wedge from the axis atom to the substituted ring atom instead (bond 7-8)
    const moved = bonds.map(([a, b, o, st]) => (a === 8 && b === 15 ? [a, b, o] : a === 7 && b === 8 ? [7, 8, o, 1] : [a, b, o, st]) as B);
    expect(label(atoms, moved)).toEqual(l);
  });
  it('gives no label to a biaryl with no group next to the axis on one ring', () => {
    const { atoms, bonds } = biaryl();
    // move the Me from C2' to C4': ring 2 is the same on both sides of the axis
    const at = atoms.map((a, i) => (i === 14 ? ['C', 4.5, 1.9] : a) as A);
    const bs = bonds.map(([a, b, o, st]) => (a === 8 && b === 15 ? [10, 15, 1] : [a, b, o, st]) as B);
    bs.push([7, 8, 1, 1]);
    expect(label(at, bs.filter((b, i, all) => !(b[0] === 7 && b[1] === 8 && !b[3] && all.some((c) => c[0] === 7 && c[1] === 8 && c[3]))))).toEqual([]);
  });
});
