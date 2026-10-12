// ChemDraw's default hotkeys (User Guide pp. 67–75). Keys are KeyboardEvent.key values,
// so Shift+F arrives as "F".

/** Pointing at an atom: keys that set its label. */
export const ATOM_LABEL_KEYS: Record<string, string> = {
  f: 'F', F: 'CF3', p: 'P', P: 'Ph', A: 'Ac', h: 'H', b: 'Br', B: 'B', i: 'I', r: 'R', k: 'K',
  s: 'S', S: 'Si', m: 'Me', n: 'N', w: 'N', N: 'NO2', c: 'C', l: 'Cl', C: 'Cl', x: 'X',
  o: 'O', q: 'O', d: 'D', e: 'Et', E: 'CO2Me', Z: 'N3', M: 'MgBr', L: 'Li', O: 'OMe',
  Q: 'Fmoc', H: 'Cbz', Y: 'Boc',
};

/** Pointing at an atom: keys that grow something from it. */
export type AtomAction =
  | 'bond' | 'carbonyl' | 'phenyl' | 'wedge' | 'hashWedge' | 'cyclohexane' | 'cyclopentane'
  | 'methylidene' | 'dimethyl' | 'alkyne' | 'cyclopropane' | 'cyclobutane' | 'tBu'
  | 'plus' | 'minus' | 'label' | 'select' | 'clear';

export const ATOM_ACTION_KEYS: Record<string, AtomAction> = {
  '0': 'bond', '1': 'bond', '2': 'carbonyl', '3': 'phenyl', a: 'phenyl', '4': 'wedge', '5': 'hashWedge',
  '6': 'cyclohexane', '7': 'cyclopentane', '8': 'methylidene', '9': 'dimethyl', z: 'alkyne',
  v: 'cyclopropane', u: 'cyclobutane', K: 'tBu', '+': 'plus', '-': 'minus',
  Enter: 'label', g: 'select', Backspace: 'clear', Delete: 'clear',
};

/** Pointing at a bond. */
export type BondAction =
  | { set: { order?: number; display?: string; dpos?: string } }
  | { fuse: number; aromatic?: boolean }
  | { flip: 'wedge' | 'hashWedge' }
  | 'select' | 'delete';

export const BOND_KEYS: Record<string, BondAction> = {
  '1': { set: { order: 1, display: 'solid' } },
  '2': { set: { order: 2, display: 'solid' } },
  '3': { set: { order: 3, display: 'solid' } },
  d: { set: { order: 1, display: 'dash' } },
  D: { set: { order: 1.5, display: 'solid' } },
  B: { set: { order: 2, display: 'bold' } },
  y: { set: { order: 1, display: 'wavy' } },
  l: { set: { dpos: 'left' } },
  c: { set: { dpos: 'center' } },
  r: { set: { dpos: 'right' } },
  b: { set: { order: 1, display: 'bold' } },
  w: { flip: 'wedge' },
  H: { set: { order: 1, display: 'hash' } },
  h: { flip: 'hashWedge' },
  a: { fuse: 6, aromatic: true },
  z: { fuse: 5, aromatic: true },
  '4': { fuse: 4 }, '5': { fuse: 5 }, '6': { fuse: 6 }, '7': { fuse: 7 }, '8': { fuse: 8 },
  '9': { fuse: 6 }, '0': { fuse: 6 },
  g: 'select', Delete: 'delete', Backspace: 'delete',
};

/** Pointing at empty space: keys that switch tools. */
export const TOOL_KEYS: Record<string, string> = {
  ' ': 'select', x: 'bond-single', X: 'chain', t: 'text', e: 'arrow', j: 'ring-benzene', J: 'ring-cp',
  // not ChemDraw defaults, but free keys in empty space
  w: 'bond-wedge', h: 'bond-hashWedge', '2': 'bond-double', '3': 'ring-3', '4': 'ring-4', '5': 'ring-5',
  '6': 'ring-6', '7': 'ring-7', '8': 'ring-8',
};
