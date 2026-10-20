// Catalytic cycles from scratch (Insert ▸ Catalytic Cycle): the species round a loop, an arrow
// for each step with its name inside the loop, and what comes in and goes out on small curved
// arrows outside it. Two loops can turn together where they meet at a step (a Pd and a Cu cycle,
// a photocatalyst and a nickel cycle), share a species (two pathways from one resting state),
// or sit side by side. The loops are laid out by Scheme ▸ Arrange's catalytic cycle, and every
// step keeps its roles, so a single loop can be arranged again after its text is swapped for
// structures.

import type { Arrow, Caption, Doc, StepRoles } from '../model';
import type { Rect, Vec } from '../geom';
import { chemRuns } from '../text/chemtext';
import { selectionBox, type Measure } from '../editor/arrange';
import { applyArrange, planArrange, type Scope } from './scheme-arrange';
import { spacing } from './scheme-layout';
import { arrowMid } from '../objects';

/** One step, from a species to the next: its name, short and in full, and what comes in and goes out. */
export interface CycleStep { short: string; name: string; inn: string; out: string }

export interface CycleLoop {
  /** The species, in order round the loop (text with _ and ^ markup). */
  stations: string[];
  /** Step k goes from station k to station k + 1 (the last back to the first). */
  steps: CycleStep[];
  /** Written in the middle (the catalyst). */
  middle?: string;
}

/**
 * How a second loop goes with the first. mesh: step `a` of the first and step `b` of the second
 * face each other and the loops turn opposite ways, like gears; share: station `a` of the first
 * is station `b` of the second, drawn once where the loops touch (a figure of eight); beside:
 * the second loop to the right of the first.
 */
export interface CycleJoin { kind: 'mesh' | 'share' | 'beside'; a: number; b: number }

export interface CycleSpec {
  loops: CycleLoop[];
  join?: CycleJoin;
}

export interface CycleLook {
  /** The first loop runs anticlockwise (clockwise by default). */
  anticlockwise?: boolean;
  /** Step names: short (OA), in full (oxidative addition), or none. */
  names: 'short' | 'full' | 'none';
  /** What comes in and goes out on small curved arrows (otherwise beside the step, outside the loop). */
  reagentArrows: boolean;
}

export interface CyclePreset { id: string; name: string; group: 'classic' | 'two' | 'blank'; blurb: string; spec: CycleSpec }

const st = (short: string, name: string, inn = '', out = ''): CycleStep => ({ short, name, inn, out });
const OA = (inn = 'Ar–X') => st('OA', 'oxidative addition', inn);
const RE = (out: string) => st('RE', 'reductive elimination', '', out);

/** The test set: classic cycles, then ones with two loops or two pathways drawn together. */
export const CYCLE_PRESETS: CyclePreset[] = [
  {
    id: 'suzuki', name: 'Suzuki–Miyaura coupling', group: 'classic', blurb: 'Pd(0)/Pd(II): oxidative addition, base exchange, transmetalation, reductive elimination.',
    spec: { loops: [{
      stations: ['L_nPd^0', 'L_nPd^{II}(Ar)X', 'L_nPd^{II}(Ar)OR', 'L_nPd^{II}(Ar)Ar′'],
      steps: [OA(), st('LE', 'ligand exchange', '^−OR', 'X^−'), st('TM', 'transmetalation', 'Ar′B(OH)2', 'ROB(OH)2'), RE('Ar–Ar′')],
      middle: 'Pd catalyst',
    }] },
  },
  {
    id: 'heck', name: 'Mizoroki–Heck reaction', group: 'classic', blurb: 'Neutral pathway: alkene binding, migratory insertion, β-hydride elimination, base.',
    spec: { loops: [{
      stations: ['Pd^0L_2', 'ArPd^{II}XL_2', 'ArPd^{II}XL(alkene)', 'RCH(Ar)CH_2Pd^{II}XL', 'HPd^{II}XL_2'],
      steps: [OA(), st('—', 'alkene coordination', 'RCH=CH_2', 'L'), st('MI', 'migratory insertion'), st('β-H', 'β-hydride elimination', 'L', 'ArCH=CHR'), st('—', 'base', 'base', 'base·HX')],
    }] },
  },
  {
    id: 'buchwald', name: 'Buchwald–Hartwig amination', group: 'classic', blurb: 'Oxidative addition, amine binding and deprotonation, reductive elimination.',
    spec: { loops: [{
      stations: ['LPd^0', 'LPd^{II}(Ar)X', 'LPd^{II}(Ar)NR_2'],
      steps: [OA(), st('—', 'amine binding, deprotonation', 'HNR_2, base', 'base·HX'), RE('Ar–NR_2')],
    }] },
  },
  {
    id: 'wilkinson', name: 'Wilkinson hydrogenation', group: 'classic', blurb: 'Rh(I)/Rh(III): H₂ addition, alkene binding, insertion, reductive elimination.',
    spec: { loops: [{
      stations: ['RhCl(PPh_3)_2', 'RhH_2Cl(PPh_3)_2', 'RhH_2Cl(PPh_3)_2(alkene)', 'RhHCl(alkyl)(PPh_3)_2'],
      steps: [OA('H_2'), st('—', 'alkene coordination', 'alkene'), st('MI', 'migratory insertion'), RE('alkane')],
      middle: 'RhCl(PPh3)3',
    }] },
  },
  {
    id: 'metathesis', name: 'Olefin metathesis (Chauvin)', group: 'classic', blurb: 'Metal alkylidene and metallacyclobutane, by [2+2] and retro-[2+2] steps.',
    spec: { loops: [{
      stations: ['[M]=CHR^1', 'metallacyclobutane', '[M]=CH_2', 'metallacyclobutane′'],
      steps: [st('[2+2]', '[2+2] cycloaddition', 'CH_2=CHR^2'), st('r[2+2]', 'retro-[2+2]', '', 'R^1CH=CHR^2'), st('[2+2]', '[2+2] cycloaddition', 'CH_2=CHR^1'), st('r[2+2]', 'retro-[2+2]', '', 'CH_2=CH_2')],
    }] },
  },
  {
    id: 'monsanto', name: 'Monsanto acetic acid process', group: 'classic', blurb: 'Rh(I)/Rh(III) carbonylation of methanol (Cativa uses Ir in the same way).',
    spec: { loops: [{
      stations: ['[Rh(CO)_2I_2]^−', '[CH_3Rh(CO)_2I_3]^−', '[CH_3CORh(CO)I_3]^−', '[CH_3CORh(CO)_2I_3]^−'],
      steps: [OA('CH_3I'), st('MI', 'migratory insertion'), st('—', 'CO binding', 'CO'), RE('CH_3COI')],
    }] },
  },
  {
    id: 'sonogashira', name: 'Sonogashira coupling (Pd and Cu)', group: 'two', blurb: 'The palladium and copper cycles turn together at transmetalation.',
    spec: {
      loops: [
        { stations: ['Pd^0L_2', 'ArPd^{II}XL_2', 'ArPd^{II}(C≡CR)L_2'], steps: [OA(), st('TM', 'transmetalation'), RE('Ar–C≡CR')], middle: 'Pd' },
        { stations: ['CuX', 'CuC≡CR'], steps: [st('—', 'π-complex, deprotonation', 'H–C≡CR, base', 'base·HX'), st('TM', 'transmetalation')], middle: 'Cu' },
      ],
      join: { kind: 'mesh', a: 1, b: 1 },
    },
  },
  {
    id: 'wacker', name: 'Wacker oxidation (Pd and Cu)', group: 'two', blurb: 'Palladium oxidises ethylene; copper(II) reoxidises Pd(0), and O₂ reoxidises copper.',
    spec: {
      loops: [
        {
          stations: ['PdCl_4^{2−}', '[PdCl_3(C_2H_4)]^−', 'PdCl_2(H_2O)(C_2H_4)', '[PdCl_2(CH_2CH_2OH)]^−', 'Pd^0'],
          steps: [st('—', 'alkene coordination', 'C_2H_4', 'Cl^−'), st('—', 'ligand exchange', 'H_2O', 'Cl^−'), st('—', 'hydroxypalladation', 'H_2O', 'H_3O^+'), st('β-H', 'β-hydride elimination', '', 'CH_3CHO, HCl, Cl^−'), st('—', 'reoxidation', '', '')],
          middle: 'Pd',
        },
        { stations: ['2 CuCl_2', '2 CuCl'], steps: [st('—', 'reoxidation'), st('—', 'air oxidation', '½ O_2, 2 HCl', 'H_2O')], middle: 'Cu' },
      ],
      join: { kind: 'mesh', a: 4, b: 0 },
    },
  },
  {
    id: 'photoredox', name: 'Ni/Ir metallaphotoredox', group: 'two', blurb: 'Decarboxylative arylation: the iridium photocatalyst and the nickel cycle meet at electron transfer.',
    spec: {
      loops: [
        {
          stations: ['Ni^0L_n', 'ArNi^{II}(X)L_n', 'ArNi^{III}(R)(X)L_n', 'Ni^IXL_n'],
          steps: [OA(), st('—', 'radical capture', 'R•'), RE('Ar–R'), st('SET', 'single-electron transfer')],
          middle: 'Ni',
        },
        {
          stations: ['Ir^{III}', '*Ir^{III}', 'Ir^{II}'],
          steps: [st('hν', 'excitation', 'hν'), st('SET', 'single-electron transfer', 'RCO_2^−', 'CO_2, R•'), st('SET', 'single-electron transfer')],
          middle: 'photocatalyst',
        },
      ],
      join: { kind: 'mesh', a: 3, b: 2 },
    },
  },
  {
    id: 'heck-two', name: 'Neutral vs cationic Heck', group: 'two', blurb: 'Two pathways from Pd(0): losing L (aryl halides) or losing X⁻ (aryl triflates).',
    spec: {
      loops: [
        {
          stations: ['Pd^0L_2', 'ArPdXL_2', 'ArPdXL(alkene)', 'RPdXL', 'HPdXL_2'],
          steps: [OA('Ar–X'), st('—', 'alkene binding', 'alkene', 'L'), st('MI', 'migratory insertion'), st('β-H', 'β-hydride elimination', 'L', 'product'), st('—', 'base', 'base', 'base·HX')],
          middle: 'neutral',
        },
        {
          stations: ['Pd^0L_2', 'ArPd(OTf)L_2', '[ArPdL_2(alkene)]^+', '[RPdL_2]^+', '[HPdL_2]^+'],
          steps: [OA('Ar–OTf'), st('—', 'alkene binding', 'alkene', 'TfO^−'), st('MI', 'migratory insertion'), st('β-H', 'β-hydride elimination', '', 'product'), st('—', 'base', 'base', 'base·H^+')],
          middle: 'cationic',
        },
      ],
      join: { kind: 'share', a: 0, b: 0 },
    },
  },
  {
    id: 'ch-two', name: 'Pd(0)/Pd(II) vs Pd(II)/Pd(IV) C–H arylation', group: 'two', blurb: 'Two ways to arylate a C–H bond, side by side for comparison.',
    spec: {
      loops: [
        {
          stations: ['Pd^0L_n', 'ArPd^{II}X', 'ArPd^{II}Ar′'],
          steps: [OA(), st('CMD', 'C–H activation (CMD)', 'Ar′–H, base', 'base·HX'), RE('Ar–Ar′')],
          middle: 'Pd(0)/Pd(II)',
        },
        {
          stations: ['Pd^{II}X_2', 'Ar′Pd^{II}X', 'Ar′(Ar)Pd^{IV}X_2'],
          steps: [st('C–H', 'C–H activation', 'Ar′–H', 'HX'), st('Ox', 'oxidation', '[Ar_2I]^+X^−', 'ArI'), RE('Ar–Ar′')],
          middle: 'Pd(II)/Pd(IV)',
        },
      ],
      join: { kind: 'beside', a: 0, b: 0 },
    },
  },
  {
    id: 'blank', name: 'Blank cycle', group: 'blank', blurb: 'Four species and four steps to fill in.',
    spec: { loops: [{ stations: ['Catalyst', 'Intermediate 1', 'Intermediate 2', 'Intermediate 3'], steps: [st('', 'Step 1'), st('', 'Step 2'), st('', 'Step 3'), st('', 'Step 4')], middle: '' }] },
  },
];

/** Common step names, offered while typing one. */
export const STEP_NAMES = [
  'oxidative addition', 'reductive elimination', 'transmetalation', 'migratory insertion', 'β-hydride elimination',
  'ligand exchange', 'ligand dissociation', 'alkene coordination', 'deprotonation', 'protonation', 'single-electron transfer',
  'C–H activation (CMD)', '[2+2] cycloaddition', 'retro-[2+2]', 'σ-bond metathesis', 'hydroxypalladation', 'excitation',
];

const SHORT: Record<string, string> = {
  'oxidative addition': 'OA', 'reductive elimination': 'RE', transmetalation: 'TM', 'migratory insertion': 'MI',
  'β-hydride elimination': 'β-H', 'single-electron transfer': 'SET', 'ligand exchange': 'LE',
};
/** The usual short form of a step's name (OA for oxidative addition), or the name itself. */
export function shortName(name: string): string {
  return SHORT[name.trim().toLowerCase()] ?? name;
}

export interface BuiltCycle {
  captions: number[];
  arrows: number[];
  /** The box round all of it. */
  box: Rect | null;
}

/**
 * Draw the cycle with its middle at `at`. Selected structures (or captions) in `stations`
 * stand for the first loop's species, in order, instead of new text. One undoable step.
 */
export function buildCycle(doc: Doc, m: Measure, spec: CycleSpec, look: CycleLook, at: Vec, stations: { atoms: number[]; caption?: number }[] = []): BuiltCycle {
  const L = doc.style.bondLength;
  const made: BuiltCycle = { captions: [], arrows: [], box: null };
  doc.edit('Catalytic Cycle', () => {
    const caption = (text: string, x: number, y: number): Caption => {
      const c = doc.addCaption({ x, y, runs: chemRuns(text), justify: 'center' });
      made.captions.push(c.id);
      return c;
    };
    const arrowLook = (): Omit<Arrow, 'id' | 'tail' | 'head'> => ({
      headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0,
      headLength: doc.style.lineWidth * 10, headWidth: doc.style.lineWidth * 2.5,
    });
    const scopes: Scope[] = [];
    const refs: string[][] = [];
    // the shared species of a figure of eight is the first loop's
    const shared = spec.join?.kind === 'share' ? spec.join : null;
    spec.loops.forEach((loop, li) => {
      const y = li * 12 * L;
      const scope: Scope = { atoms: new Set(), captions: new Set(), shapes: new Set(), arrows: new Set() };
      // the species in a row to start with (the layout puts them round the loop)
      const ref: string[] = loop.stations.map((text, k) => {
        if (li === 1 && shared && k === shared.b) return refs[0][shared.a];
        const given = li === 0 ? stations[k] : undefined;
        if (given?.atoms.length) { for (const a of given.atoms) scope.atoms.add(a); return 'a' + Math.min(...given.atoms); }
        if (given?.caption !== undefined) { scope.captions.add(given.caption); return 'c' + given.caption; }
        const c = caption(text.trim() || '…', k * 6 * L, y);
        return 'c' + c.id;
      });
      if (li === 1 && shared) { const r = refs[0][shared.a]; if (r[0] === 'c') scope.captions.add(Number(r.slice(1))); else for (const a of doc.fragmentOf(Number(r.slice(1)))) scope.atoms.add(a); }
      for (const r of ref) if (r[0] === 'c') scope.captions.add(Number(r.slice(1)));
      const n = ref.length;
      loop.steps.slice(0, n).forEach((s, k) => {
        const x = k * 6 * L + 3 * L;
        const roles: StepRoles = { reactants: [ref[k]], products: [ref[(k + 1) % n]], above: [], below: [] };
        const word = look.names === 'short' ? s.short || shortName(s.name) : look.names === 'full' ? s.name : '';
        // a dash stands for a step with no short name
        if (word && word !== '—') { const c = caption(word, x, y + L); roles.inside = ['c' + c.id]; scope.captions.add(c.id); }
        // beside a species two loops share, outside the loop is the other loop: what comes in
        // and goes out there is written inside with the step's name, as + and −
        const own = shared && (k === (li ? shared.b : shared.a) || (k + 1) % n === (li ? shared.b : shared.a));
        if (own) {
          for (const t of [s.inn && '+ ' + s.inn, s.out && '− ' + s.out]) {
            if (!t) continue;
            const c = caption(t, x, y + 3 * L);
            (roles.inside ??= []).push('c' + c.id);
            scope.captions.add(c.id);
          }
        } else {
          if (s.inn) { const c = caption(s.inn, x, y - L); roles.above.push('c' + c.id); scope.captions.add(c.id); }
          if (s.out) { const c = caption(s.out, x, y + 2 * L); roles.below.push('c' + c.id); scope.captions.add(c.id); }
        }
        const r = doc.addArrow({ ...arrowLook(), tail: { x: x - 1.5 * L, y }, head: { x: x + 1.5 * L, y }, step: roles });
        made.arrows.push(r.id);
        scope.arrows.add(r.id);
      });
      if (loop.middle) scope.captions.add(caption(loop.middle, 0, y - 3 * L).id);
      scopes.push(scope);
      refs.push(ref);
    });

    // lay out each loop: the first clockwise (or as asked), a second the other way when meshed or shared
    const sign = look.anticlockwise ? -1 : 1;
    const turn = (loopSign: number, k: number, n: number) => loopSign * (2 * Math.PI * k) / n;
    const n0 = refs[0].length;
    const j = spec.join, second = spec.loops.length > 1 && j;
    let start0 = -Math.PI / 2;
    // meshed: loop 1's step a faces right; shared: loop 1's species a sits at the right
    if (second && j.kind === 'mesh') start0 = -turn(sign, j.a + 0.5, n0);
    if (second && j.kind === 'share') start0 = -turn(sign, j.a, n0);
    const arrange = (li: number, start: number, anticlockwise: boolean) => {
      const plan = planArrange(doc, m, scopes[li], { kind: 'cycle', anticlockwise, reagentArrows: look.reagentArrows, start: refs[li][0], startAngle: start });
      if (!plan) return;
      const added = applyArrange(doc, m, plan, 'Catalytic Cycle');
      made.arrows.push(...added);
      for (const id of added) scopes[li].arrows.add(id);
    };
    arrange(0, start0, !!look.anticlockwise);
    if (second) {
      const n1 = refs[1].length;
      const other = j.kind === 'beside' ? sign : -sign;
      const start1 = j.kind === 'mesh' ? Math.PI - turn(other, j.b + 0.5, n1) : j.kind === 'share' ? Math.PI - turn(other, j.b, n1) : -Math.PI / 2;
      const where = (ref: string) => centreOf(doc, m, ref);
      const sharedAt = j.kind === 'share' ? where(refs[0][j.a]) : null;
      const c0 = loopCentre(doc, m, refs[0]), r0 = loopRadius(doc, m, refs[0], c0);
      arrange(1, start1, other < 0);
      let d: Vec;
      if (sharedAt) {
        // the shared species goes back where the first loop put it
        const now = where(refs[1][j.b]);
        d = { x: sharedAt.x - now.x, y: sharedAt.y - now.y };
      } else if (j.kind === 'mesh') {
        const c1 = loopCentre(doc, m, refs[1]), r1 = loopRadius(doc, m, refs[1], c1);
        d = { x: c0.x + r0 + r1 + 1.6 * L - c1.x, y: c0.y - c1.y };
      } else {
        const b0 = selectionBox(doc, scopeSel(scopes[0]), m), b1 = selectionBox(doc, scopeSel(scopes[1]), m);
        d = b0 && b1 ? { x: b0.x2 + 3 * L - b1.x1, y: (b0.y1 + b0.y2) / 2 - (b1.y1 + b1.y2) / 2 } : { x: 0, y: 0 };
      }
      moveScope(doc, scopes[1], d);
      if (sharedAt) spreadShared(doc, m, scopes, refs[0][j.a]);
    }
    // the whole thing, with its middle where it was asked for
    const all = scopeSel(mergeScopes(scopes));
    const b = selectionBox(doc, all, m);
    if (b) {
      const d = { x: at.x - (b.x1 + b.x2) / 2, y: at.y - (b.y1 + b.y2) / 2 };
      moveScope(doc, mergeScopes(scopes), d);
      made.box = { x1: b.x1 + d.x, y1: b.y1 + d.y, x2: b.x2 + d.x, y2: b.y2 + d.y };
    }
  });
  made.captions = made.captions.filter((id) => doc.captions.has(id));
  made.arrows = made.arrows.filter((id) => doc.arrows.has(id));
  return made;
}

const scopeSel = (s: Scope) => {
  const bonds = new Set<number>();
  return { atoms: s.atoms, bonds, captions: s.captions, arrows: s.arrows, shapes: s.shapes };
};

function mergeScopes(ss: Scope[]): Scope {
  const out: Scope = { atoms: new Set(), captions: new Set(), shapes: new Set(), arrows: new Set() };
  for (const s of ss) for (const k of ['atoms', 'captions', 'shapes', 'arrows'] as const) for (const x of s[k]) out[k].add(x);
  return out;
}

function moveScope(doc: Doc, s: Scope, d: Vec): void {
  if (Math.hypot(d.x, d.y) < 1e-9) return;
  doc.moveAtoms(s.atoms, d.x, d.y);
  for (const id of s.captions) { const c = doc.captions.get(id); if (c) doc.updateCaption(id, { x: c.x + d.x, y: c.y + d.y }); }
  for (const id of s.arrows) {
    const r = doc.arrows.get(id);
    if (r) doc.updateArrow(id, { tail: { x: r.tail.x + d.x, y: r.tail.y + d.y }, head: { x: r.head.x + d.x, y: r.head.y + d.y } });
  }
}

/** The middle of a species' box (a structure by any atom, 'a12', or a caption, 'c5'). */
function centreOf(doc: Doc, m: Measure, ref: string): Vec {
  const id = Number(ref.slice(1));
  const sel = ref[0] === 'a'
    ? { atoms: doc.fragmentOf(id), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() }
    : { atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set([id]), arrows: new Set<number>(), shapes: new Set<number>() };
  const b = selectionBox(doc, sel, m);
  return b ? { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 } : { x: 0, y: 0 };
}

/** A loop's middle: the species sit evenly round it, so it is their average. */
function loopCentre(doc: Doc, m: Measure, refs: string[]): Vec {
  const ps = refs.map((r) => centreOf(doc, m, r));
  return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
}

function loopRadius(doc: Doc, m: Measure, refs: string[], c: Vec): number {
  const p = centreOf(doc, m, refs[0]);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

/**
 * Two loops that share a species touch there, and the steps on either side of it crowd each
 * other: move the second loop off to the right and the shared species halfway, then bring the
 * four steps that start or end at it back to its box (their names and reagents go with them).
 */
function spreadShared(doc: Doc, m: Measure, scopes: Scope[], ref: string): void {
  const L = doc.style.bondLength, G = 2 * L;
  const id = Number(ref.slice(1));
  const rest: Scope = { ...scopes[1], captions: new Set([...scopes[1].captions].filter((c) => ref !== 'c' + c)), atoms: new Set([...scopes[1].atoms].filter((a) => !(ref[0] === 'a' && doc.fragmentOf(id).has(a)))) };
  moveScope(doc, rest, { x: G, y: 0 });
  const self: Scope = ref[0] === 'c'
    ? { atoms: new Set(), captions: new Set([id]), shapes: new Set(), arrows: new Set() }
    : { atoms: new Set(doc.fragmentOf(id)), captions: new Set(), shapes: new Set(), arrows: new Set() };
  moveScope(doc, self, { x: G / 2, y: 0 });
  const b = selectionBox(doc, scopeSel(self), m);
  if (!b) return;
  const g = spacing(L).gap;
  const box = { x1: b.x1 - g, y1: b.y1 - g, x2: b.x2 + g, y2: b.y2 + g };
  const c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  for (const r of [...doc.arrows.values()]) {
    const into = r.step?.products.includes(ref), from = r.step?.reactants.includes(ref);
    if (!into && !from) continue;
    const far = into ? r.tail : r.head;
    const near = edgeToward(c, far, box);
    const was = arrowMid(r);
    const next = into ? { ...r, head: near } : { ...r, tail: near };
    doc.updateArrow(r.id, { tail: next.tail, head: next.head });
    const now = arrowMid(next);
    const d = { x: now.x - was.x, y: now.y - was.y };
    // what goes with the step: its reagent arrows, and its names and reagents
    const st = r.step!;
    const caps = new Set([...st.above, ...st.below, ...(st.inside ?? [])].filter((x) => x[0] === 'c').map((x) => Number(x.slice(1))));
    const arrows = new Set([...doc.arrows.values()].filter((x) => x.reagentFor === r.id).map((x) => x.id));
    moveScope(doc, { atoms: new Set(), captions: caps, shapes: new Set(), arrows }, d);
  }
}

/** Where the line from `p` (inside box r) towards `q` leaves r. */
function edgeToward(p: Vec, q: Vec, r: Rect): Vec {
  const d = { x: q.x - p.x, y: q.y - p.y };
  let t = 1;
  if (d.x > 0) t = Math.min(t, (r.x2 - p.x) / d.x); else if (d.x < 0) t = Math.min(t, (r.x1 - p.x) / d.x);
  if (d.y > 0) t = Math.min(t, (r.y2 - p.y) / d.y); else if (d.y < 0) t = Math.min(t, (r.y1 - p.y) / d.y);
  t = Math.max(0, t);
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}
