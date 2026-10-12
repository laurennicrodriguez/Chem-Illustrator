// Chemistry engine running off the main thread so drawing never waits for it.
// Loads RDKit (WebAssembly) and answers requests: formula and masses, R/S and E/Z labels,
// SMILES in and out.

/// <reference lib="webworker" />
import { formulaFromJson } from '../chem/formula';
type InitRDKit = (opts: { locateFile: () => string }) => Promise<any>;

export type ChemRequest =
  | { type: 'init'; js: string; wasm: string }
  | { type: 'analyze'; id: number; mols: { molblock: string; map: number[] }[] }
  | { type: 'smilesToMol'; id: number; smiles: string }
  | { type: 'molToSmiles'; id: number; molblock: string };

export interface FragmentResult {
  formula: string;
  exact: number;
  mw: number;
  charge: number;
  smiles: string;
  cip: [number, string][];
  error?: string;
}

export type ChemResponse =
  | { type: 'ready'; ms: number; version: string }
  | { type: 'error'; id?: number; message: string }
  | { type: 'analyze'; id: number; results: FragmentResult[]; ms: number }
  | { type: 'smilesToMol'; id: number; molblock: string | null }
  | { type: 'molToSmiles'; id: number; smiles: string | null };

let RDKit: any = null;
const post = (m: ChemResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function analyzeOne(molblock: string, map: number[]): FragmentResult {
  const mol = RDKit.get_mol(molblock);
  if (!mol || !mol.is_valid()) {
    mol?.delete?.();
    return { formula: '', exact: 0, mw: 0, charge: 0, smiles: '', cip: [], error: 'Could not read this structure (check valences).' };
  }
  try {
    const { formula, charge } = formulaFromJson(mol.get_json());
    const d = JSON.parse(mol.get_descriptors());
    const tags = JSON.parse(mol.get_stereo_tags());
    const cip: [number, string][] = [];
    for (const [idx, label] of tags.CIP_atoms ?? []) {
      const id = map[idx];
      if (id !== undefined && id >= 0) cip.push([id, String(label).replace(/[()]/g, '')]);
    }
    for (const [i1, i2, label] of tags.CIP_bonds ?? []) {
      // put E/Z on the first atom of the double bond
      const id = map[i1] >= 0 ? map[i1] : map[i2];
      if (id !== undefined && id >= 0) cip.push([id, String(label).replace(/[()]/g, '')]);
    }
    return { formula, exact: d.exactmw, mw: d.amw, charge, smiles: mol.get_smiles(), cip };
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
      const results = m.mols.map((x) => analyzeOne(x.molblock, x.map));
      post({ type: 'analyze', id: m.id, results, ms: performance.now() - t0 });
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
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in m ? (m as { id: number }).id : undefined, message: String(err) });
  }
};
