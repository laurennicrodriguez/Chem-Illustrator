// What a label stands for, for the tooltip shown when the mouse rests on it: the group written
// out as SMILES (with * where it joins the structure), its formula and, for the common
// abbreviations, its full name.

import { SYMBOLS, hasImplicitH, implicitHydrogens } from './elements';
import { hillFormula } from './formula';
import { isGenericLabel, kekulize, labelGraph, type MiniGraph } from './labels';
import { graphSmiles } from './group-smiles';

/** Full names of the common abbreviations (IUPAC substituent names where there is one). */
export const GROUP_NAMES: Record<string, string> = {
  Me: 'methyl', Et: 'ethyl', Pr: 'propyl', 'n-Pr': 'propyl', 'i-Pr': 'propan-2-yl (isopropyl)', iPr: 'propan-2-yl (isopropyl)',
  Bu: 'butyl', 'n-Bu': 'butyl', nBu: 'butyl', 'i-Bu': '2-methylpropyl (isobutyl)', iBu: '2-methylpropyl (isobutyl)',
  's-Bu': 'butan-2-yl (sec-butyl)', sBu: 'butan-2-yl (sec-butyl)', 't-Bu': 'tert-butyl', tBu: 'tert-butyl',
  Ph: 'phenyl', Bn: 'benzyl', Bz: 'benzoyl', Ac: 'acetyl', Piv: 'pivaloyl (2,2-dimethylpropanoyl)', Pv: 'pivaloyl (2,2-dimethylpropanoyl)',
  Boc: 'tert-butoxycarbonyl', Cbz: 'benzyloxycarbonyl', Fmoc: '9-fluorenylmethoxycarbonyl',
  Troc: '2,2,2-trichloroethoxycarbonyl', Alloc: 'allyloxycarbonyl', Allyl: 'allyl (prop-2-en-1-yl)',
  Ts: 'tosyl (4-methylbenzenesulfonyl)', Tos: 'tosyl (4-methylbenzenesulfonyl)', Ms: 'mesyl (methanesulfonyl)',
  Tf: 'triflyl (trifluoromethanesulfonyl)', Ns: 'nosyl (4-nitrobenzenesulfonyl)', TMS: 'trimethylsilyl', TES: 'triethylsilyl',
  TBS: 'tert-butyldimethylsilyl', TBDMS: 'tert-butyldimethylsilyl', TIPS: 'triisopropylsilyl', TBDPS: 'tert-butyldiphenylsilyl',
  PMB: '4-methoxybenzyl', MPM: '4-methoxybenzyl', MOM: 'methoxymethyl', MEM: '(2-methoxyethoxy)methyl',
  SEM: '[2-(trimethylsilyl)ethoxy]methyl', THP: 'tetrahydropyran-2-yl', Tr: 'trityl (triphenylmethyl)', Trt: 'trityl (triphenylmethyl)',
  MDP: '3,4-methylenedioxyphenyl', '3,4-MDP': '3,4-methylenedioxyphenyl', '(3,4)-MDP': '3,4-methylenedioxyphenyl',
  Cy: 'cyclohexyl', cHx: 'cyclohexyl', Mes: 'mesityl (2,4,6-trimethylphenyl)', Tol: '4-methylphenyl (p-tolyl)', 'p-Tol': '4-methylphenyl (p-tolyl)',
  Np: 'naphthalen-1-yl', CN: 'cyano', NO2: 'nitro', CF3: 'trifluoromethyl', CCl3: 'trichloromethyl', N3: 'azido',
  CO2H: 'carboxy', COOH: 'carboxy', CO2Me: 'methoxycarbonyl', CO2Et: 'ethoxycarbonyl', CO2tBu: 'tert-butoxycarbonyl',
  CO2Bn: 'benzyloxycarbonyl', CHO: 'formyl', COMe: 'acetyl', OAc: 'acetoxy', OTf: 'triflate (trifluoromethanesulfonyloxy)',
  SO2Ph: 'phenylsulfonyl', SO2Me: 'methylsulfonyl', Bpin: 'pinacolatoboryl', BPin: 'pinacolatoboryl', Cp: 'cyclopentadienyl',
  THF: 'tetrahydrofuran', DMF: 'N,N-dimethylformamide', DMSO: 'dimethyl sulfoxide',
  OMe: 'methoxy', OEt: 'ethoxy', OH: 'hydroxy', NH2: 'amino', NHBoc: 'tert-butoxycarbonylamino', OTBS: 'tert-butyldimethylsilyloxy',
  OTIPS: 'triisopropylsilyloxy', OTES: 'triethylsilyloxy', OTMS: 'trimethylsilyloxy', OTBDPS: 'tert-butyldiphenylsilyloxy',
  OBn: 'benzyloxy', OPMB: '4-methoxybenzyloxy', OMOM: 'methoxymethoxy', OBz: 'benzoyloxy', OPiv: 'pivaloyloxy',
  OTs: 'tosyloxy', OMs: 'mesyloxy', SPh: 'phenylsulfanyl', SMe: 'methylsulfanyl', NMe2: 'dimethylamino', NHAc: 'acetamido',
};

export interface LabelTip {
  /** The group as SMILES, each bond to the structure written as a * atom (first atom of the label first). */
  smiles: string;
  /** Formula of the group alone (C5H9O2 for Boc), in Hill order. */
  formula: string;
  /** The full name, for labels in the list above. */
  name?: string;
}

/**
 * The tooltip for a label, or null when there is nothing to show: a single atom (OH, Cl, NH2
 * still counts as one heavy atom), a group that stands for anything (R, Ar), or text that
 * can't be read as chemistry. `ext` lists the order of each bond the label makes to the
 * structure (all join at the label's first atom).
 */
export function labelTip(label: string, ext: number[] = [1]): LabelTip | null {
  const text = label.trim();
  if (!text || isGenericLabel(text)) return null;
  const sum = ext.reduce((s, o) => s + o, 0) || 1;
  const g = labelGraph(text, Math.round(sum));
  if (!g || !g.atoms.length) return null;
  const heavy = g.atoms.filter((a) => !a.dummy && a.z !== 1).length;
  if (heavy < 2) return null;
  const formula = groupFormula(g, sum);
  // the bonds to the structure, as * atoms on the label's first atom
  const withStar: MiniGraph = { atoms: g.atoms.map((a) => ({ ...a })), bonds: g.bonds.map((b) => ({ ...b })) };
  for (const o of ext.length ? ext : [1]) {
    withStar.atoms.push({ z: 0, charge: 0, aromatic: false, dummy: true });
    withStar.bonds.push({ a: 0, b: withStar.atoms.length - 1, order: o === 1.5 ? 1 : o });
  }
  // start the SMILES at a * so the drawing shows where the group joins
  const star = withStar.atoms.length - 1;
  const order = [star, ...withStar.atoms.map((_, i) => i).filter((i) => i !== star)];
  const at = new Map(order.map((old, i) => [old, i]));
  const reordered: MiniGraph = {
    atoms: order.map((i) => withStar.atoms[i]),
    bonds: withStar.bonds.map((b) => ({ a: at.get(b.a)!, b: at.get(b.b)!, order: b.order })),
  };
  return { smiles: graphSmiles(reordered), formula, name: GROUP_NAMES[text] };
}

/** Formula of the group's own atoms, with hydrogens worked out as for a drawn atom. */
export function groupFormula(g: MiniGraph, ext = 1): string {
  const bonds = kekulize(g);
  const used = g.atoms.map(() => 0);
  for (const b of bonds) { used[b.a] += b.order; used[b.b] += b.order; }
  used[0] += ext;
  const counts: Record<string, number> = {};
  let charge = 0;
  g.atoms.forEach((a, i) => {
    if (a.dummy) return;
    const sym = a.iso === 2 && a.z === 1 ? 'D' : SYMBOLS[a.z];
    if (!sym) return;
    counts[sym] = (counts[sym] ?? 0) + 1;
    charge += a.charge;
    const h = a.hCount ?? (hasImplicitH(a.z) ? implicitHydrogens(a.z, used[i], a.charge) : 0);
    if (h) counts.H = (counts.H ?? 0) + h;
  });
  return hillFormula(counts, charge);
}

/** Positions (in SMILES atom order, which the molfile keeps) of the * atoms in a SMILES string. */
export function starAtoms(smiles: string): number[] {
  const out: number[] = [];
  let i = 0;
  for (const m of smiles.matchAll(/\[[^\]]*\]|Br|Cl|[BCNOPSFIbcnops*]/g)) {
    if (m[0] === '*' || /^\[\d*\*/.test(m[0])) out.push(i);
    i++;
  }
  return out;
}
