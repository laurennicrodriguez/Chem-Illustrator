// Chemistry engine running off the main thread so drawing never waits for it.
// Loads RDKit (WebAssembly) and answers requests: formula and masses, R/S and E/Z labels,
// SMILES in and out, and the properties and substructure searches of Sheet mode.

/// <reference lib="webworker" />
import { formulaFromJson } from '../chem/formula';
import { stereoTags, StereoTags } from '../chem/stereo';
import { molProps, substructureMatches, panelProps, massFragments, type PanelProps, type MassFragment } from '../chem/props';
import type { MolProps } from '../sheet/properties';
type InitRDKit = (opts: { locateFile: () => string }) => Promise<any>;

export type ChemRequest =
  | { type: 'init'; js: string; wasm: string }
  | { type: 'analyze'; id: number; mols: { molblock: string; map: number[] }[] }
  | { type: 'stereo'; id: number; mols: { molblock: string; skip: number[]; generic: [number, string][] }[] }
  | { type: 'smilesToMol'; id: number; smiles: string }
  | { type: 'molToSmiles'; id: number; molblock: string }
  /** Sheet properties of molecules, each given as a molfile or a SMILES string. */
  | { type: 'props'; id: number; mols: string[] }
  /** Which molecules (molfiles or SMILES) contain the query (a molfile): its atoms and bonds, with anything else attached. */
  | { type: 'substructure'; id: number; query: string; mols: string[] }
  /** The pieces a molfile falls into when bonds (pairs of molfile atoms, 0-based) are broken. */
  | { type: 'fragments'; id: number; molblock: string; cuts: [number, number][] };

export interface FragmentResult {
  formula: string;
  exact: number;
  mw: number;
  charge: number;
  smiles: string;
  /** Properties, elemental analysis and estimates for the Analysis panel. */
  props?: PanelProps;
  error?: string;
}

export type ChemResponse =
  | { type: 'ready'; ms: number; version: string }
  | { type: 'error'; id?: number; message: string }
  | { type: 'analyze'; id: number; results: FragmentResult[]; ms: number }
  | { type: 'stereo'; id: number; results: StereoTags[]; ms: number }
  | { type: 'smilesToMol'; id: number; molblock: string | null }
  | { type: 'molToSmiles'; id: number; smiles: string | null }
  | { type: 'props'; id: number; results: (MolProps | { error: string })[] }
  | { type: 'substructure'; id: number; results: (boolean | null)[]; error?: string }
  | { type: 'fragments'; id: number; results: MassFragment[] | { error: string } };

let RDKit: any = null;
const post = (m: ChemResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function analyzeOne(molblock: string): FragmentResult {
  const mol = RDKit.get_mol(molblock);
  if (!mol || !mol.is_valid()) {
    mol?.delete?.();
    return { formula: '', exact: 0, mw: 0, charge: 0, smiles: '', error: 'Could not read this structure (check valences).' };
  }
  try {
    const { formula, charge } = formulaFromJson(mol.get_json());
    const d = JSON.parse(mol.get_descriptors());
    let props: PanelProps | undefined;
    try {
      props = panelProps(RDKit, mol);
    } catch {
      props = undefined;
    }
    return { formula, exact: d.exactmw, mw: d.amw, charge, smiles: mol.get_smiles(), props };
  } finally {
    mol.delete();
  }
}

// The built app runs this worker as a classic script, where importScripts loads RDKit.
// The development server runs it as a module, where importScripts is not allowed, so
// RDKit's loader is imported instead and its CommonJS export caught on a stand-in `module`.
async function loadRDKitScript(url: string): Promise<InitRDKit> {
  const g = self as any;
  try {
    g.importScripts(url);
    return g.initRDKitModule;
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    g.module = { exports: {} };
    g.exports = g.module.exports;
    try {
      await import(/* @vite-ignore */ url);
      return g.module.exports;
    } finally {
      delete g.module;
      delete g.exports;
    }
  }
}

self.onmessage = async (e: MessageEvent<ChemRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const t0 = performance.now();
      const initRDKitModule = await loadRDKitScript(m.js);
      RDKit = await initRDKitModule({ locateFile: () => m.wasm });
      post({ type: 'ready', ms: performance.now() - t0, version: RDKit.version() });
      return;
    }
    if (!RDKit) { post({ type: 'error', id: 'id' in m ? m.id : undefined, message: 'Chemistry engine not loaded yet' }); return; }
    if (m.type === 'analyze') {
      const t0 = performance.now();
      const results = m.mols.map((x) => analyzeOne(x.molblock));
      post({ type: 'analyze', id: m.id, results, ms: performance.now() - t0 });
    } else if (m.type === 'stereo') {
      const t0 = performance.now();
      const results = m.mols.map((x) => stereoTags(RDKit, x.molblock, x.skip, undefined, x.generic));
      post({ type: 'stereo', id: m.id, results, ms: performance.now() - t0 });
    } else if (m.type === 'smilesToMol') {
      const mol = RDKit.get_mol(m.smiles);
      if (!mol || !mol.is_valid()) { post({ type: 'smilesToMol', id: m.id, molblock: null }); return; }
      mol.set_new_coords(true);
      const mb = mol.get_molblock();
      mol.delete();
      post({ type: 'smilesToMol', id: m.id, molblock: mb });
    } else if (m.type === 'molToSmiles') {
      const mol = RDKit.get_mol(m.molblock);
      const smiles = mol && mol.is_valid() ? mol.get_smiles() : null;
      mol?.delete();
      post({ type: 'molToSmiles', id: m.id, smiles });
    } else if (m.type === 'props') {
      post({ type: 'props', id: m.id, results: m.mols.map((x) => molProps(RDKit, x)) });
    } else if (m.type === 'substructure') {
      post({ type: 'substructure', id: m.id, ...substructureMatches(RDKit, m.query, m.mols) });
    } else if (m.type === 'fragments') {
      post({ type: 'fragments', id: m.id, results: massFragments(RDKit, m.molblock, m.cuts) });
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in m ? (m as { id: number }).id : undefined, message: String(err) });
  }
};
