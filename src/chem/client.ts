// Main-thread side of the chemistry worker: sends requests, matches replies, and keeps
// only the latest analysis (older ones are dropped if the drawing changed meanwhile).

import type { ChemRequest, ChemResponse, FragmentResult } from '../worker/chem-worker';
import type { StereoTags } from './stereo';

export class ChemClient {
  ready = false;
  loadMs = 0;
  version = '';
  error = '';
  onReady: () => void = () => {};
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (r: ChemResponse) => void>();

  constructor(base: string) {
    try {
      // Vite's development server can only serve workers that use `import` as modules.
      this.worker = import.meta.env.DEV
        ? new Worker(new URL('../worker/chem-worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('../worker/chem-worker.ts', import.meta.url));
    } catch (e) {
      this.error = 'Background worker could not start: ' + String(e);
      return;
    }
    this.worker.onmessage = (e: MessageEvent<ChemResponse>) => this.receive(e.data);
    this.worker.onerror = (e) => { this.error = 'Chemistry engine failed to load: ' + (e.message || 'unknown error'); this.onReady(); };
    const js = new URL('RDKit_minimal.js', base).href;
    const wasm = new URL('RDKit_minimal.wasm', base).href;
    this.send({ type: 'init', js, wasm });
  }

  private send(m: ChemRequest): void {
    this.worker?.postMessage(m);
  }

  private receive(m: ChemResponse): void {
    if (m.type === 'ready') {
      this.ready = true;
      this.loadMs = m.ms;
      this.version = m.version;
      this.onReady();
      return;
    }
    if (m.type === 'error' && m.id === undefined) {
      this.error = m.message;
      this.onReady();
      return;
    }
    const id = (m as { id?: number }).id;
    if (id === undefined) return;
    const cb = this.pending.get(id);
    if (cb) { this.pending.delete(id); cb(m); }
  }

  private request<T extends ChemResponse>(build: (id: number) => ChemRequest): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (r) => (r.type === 'error' ? reject(new Error(r.message)) : resolve(r as T)));
      this.send(build(id));
    });
  }

  analyze(mols: { molblock: string; map: number[] }[]): Promise<{ results: FragmentResult[]; ms: number }> {
    return this.request<Extract<ChemResponse, { type: 'analyze' }>>((id) => ({ type: 'analyze', id, mols }));
  }

  /** R/S and E/Z labels for some molfiles (see stereoTags). */
  async stereo(mols: { molblock: string; skip: number[]; generic: [number, string][] }[]): Promise<StereoTags[]> {
    const r = await this.request<Extract<ChemResponse, { type: 'stereo' }>>((id) => ({ type: 'stereo', id, mols }));
    return r.results;
  }

  async smilesToMol(smiles: string): Promise<string | null> {
    const r = await this.request<Extract<ChemResponse, { type: 'smilesToMol' }>>((id) => ({ type: 'smilesToMol', id, smiles }));
    return r.molblock;
  }

  async molToSmiles(molblock: string): Promise<string | null> {
    const r = await this.request<Extract<ChemResponse, { type: 'molToSmiles' }>>((id) => ({ type: 'molToSmiles', id, molblock }));
    return r.smiles;
  }
}
