// R/S and E/Z labels for every structure in a drawing, kept up to date in the background.
// After an edit only the structures that changed are worked out again, and results are kept
// by molfile, so moving a structure, undoing or pasting a copy costs nothing.

import { Doc, AtomWatch, StereoInfo } from '../model';
import { toMolfile } from './molfile';
import { mayHaveStereo, StereoTags } from './stereo';

export interface StereoJob { molblock: string; skip: number[]; generic: [number, string][] }
/** Works out labels for some molfiles (the chemistry worker, or RDKit directly in tests). */
export type StereoRunner = (jobs: StereoJob[]) => Promise<StereoTags[]>;

/** Structures sent to the chemistry engine at a time, so edits in between are picked up quickly. */
const BATCH = 150;
const CACHE_MAX = 20000;

export class LiveStereo implements StereoInfo {
  /** Called with the atoms and bonds whose labels changed (to repaint around them). */
  onChange: (atoms: number[], bonds: number[]) => void = () => {};
  /** Incremented whenever a label changes. */
  version = 0;
  private atomLabels = new Map<number, string>();
  private bondLabels = new Map<number, { label: string; a1: number }>();
  /** Atoms whose structure has been worked out (no label there means "not a stereocentre"). */
  private known = new Set<number>();
  /** Atoms and bonds whose label the rules can't decide (an R group sets the order). */
  private undecidedAtoms = new Set<number>();
  private undecidedBonds = new Set<number>();
  private cache = new Map<string, StereoTags>();
  private watch: AtomWatch;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private doc: Doc, private run: StereoRunner) {
    this.watch = doc.watchAtoms();
  }

  atom(id: number): string | null | undefined {
    const l = this.atomLabels.get(id);
    if (l) return l;
    return this.known.has(id) ? null : undefined;
  }

  bond(id: number): string | null | undefined {
    const l = this.bondLabels.get(id);
    if (l) return l.label;
    if (this.undecidedBonds.has(id)) return undefined;
    const b = this.doc.bonds.get(id);
    return b && this.known.has(b.a1) ? null : undefined;
  }

  undecided(kind: 'a' | 'b', id: number): boolean {
    return kind === 'a' ? this.undecidedAtoms.has(id) : this.undecidedBonds.has(id);
  }

  /** All atoms with an R/S label, and all bonds with an E/Z label. */
  atomEntries(): IterableIterator<[number, string]> { return this.atomLabels.entries(); }
  bondEntries(): [number, string][] { return [...this.bondLabels].map(([id, l]) => [id, l.label]); }

  /** Bring the labels up to date with the drawing; resolves when they are. */
  update(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        do { this.again = false; await this.pass(); } while (this.again || this.watch.all || this.watch.ids.size);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async pass(): Promise<void> {
    const doc = this.doc, w = this.watch;
    const changedAtoms = new Set<number>(), changedBonds = new Set<number>();
    let frags: Set<number>[];
    if (w.all) {
      for (const id of this.atomLabels.keys()) changedAtoms.add(id);
      for (const id of this.bondLabels.keys()) changedBonds.add(id);
      for (const id of this.undecidedAtoms) changedAtoms.add(id);
      for (const id of this.undecidedBonds) changedBonds.add(id);
      this.atomLabels.clear();
      this.bondLabels.clear();
      this.known.clear();
      this.undecidedAtoms.clear();
      this.undecidedBonds.clear();
      frags = doc.fragments();
    } else {
      frags = [];
      const seen = new Set<number>();
      for (const id of w.ids) {
        if (!doc.atoms.has(id)) {
          if (this.atomLabels.delete(id)) changedAtoms.add(id);
          this.known.delete(id);
          this.undecidedAtoms.delete(id);
          continue;
        }
        if (seen.has(id)) continue;
        const f = doc.fragmentOf(id);
        for (const x of f) seen.add(x);
        frags.push(f);
      }
    }
    w.all = false;
    w.ids.clear();
    // E/Z labels of bonds that are gone
    for (const [id] of this.bondLabels) if (!doc.bonds.has(id)) { this.bondLabels.delete(id); changedBonds.add(id); }
    for (const id of this.undecidedBonds) if (!doc.bonds.has(id)) this.undecidedBonds.delete(id);

    const pending: { frag: Set<number>; map: number[]; key: string; job: StereoJob }[] = [];
    for (const frag of frags) {
      if (!mayHaveStereo(doc, frag)) { this.apply(frag, [], { ok: true, atoms: [], bonds: [] }, changedAtoms, changedBonds); continue; }
      const ex = toMolfile(doc, frag, '', { stereo: true });
      const key = ex.molblock + '|' + ex.inLabel.join(',') + '|' + ex.generic.map(([i, l]) => i + ':' + l).join(',');
      const hit = this.cache.get(key);
      if (hit) this.apply(frag, ex.map, hit, changedAtoms, changedBonds);
      else pending.push({ frag, map: ex.map, key, job: { molblock: ex.molblock, skip: ex.inLabel, generic: ex.generic } });
    }
    this.report(changedAtoms, changedBonds);

    for (let i = 0; i < pending.length; i += BATCH) {
      const part = pending.slice(i, i + BATCH);
      let results: StereoTags[];
      try {
        results = await this.run(part.map((p) => p.job));
      } catch {
        continue; // the engine failed: these structures keep showing what was saved with them
      }
      if (this.cache.size > CACHE_MAX) this.cache.clear();
      part.forEach((p, k) => {
        this.cache.set(p.key, results[k]);
        // a structure edited meanwhile is worked out again on the next pass
        if ([...p.frag].every((id) => doc.atoms.has(id))) this.apply(p.frag, p.map, results[k], changedAtoms, changedBonds);
      });
      this.report(changedAtoms, changedBonds);
    }
  }

  private apply(frag: Set<number>, map: number[], r: StereoTags, atoms: Set<number>, bonds: Set<number>): void {
    const doc = this.doc;
    const next = new Map<number, string>();
    for (const [i, l] of r.atoms) { const id = map[i]; if (id !== undefined && id >= 0) next.set(id, l); }
    const bondOf = (i: number, j: number) => (map[i] >= 0 && map[j] >= 0 ? doc.bondBetween(map[i], map[j]) : undefined);
    const nextB = new Map<number, string>();
    for (const [i, j, l] of r.bonds) {
      const b = bondOf(i, j);
      if (b) nextB.set(b.id, l);
    }
    const undA = new Set((r.undecided ?? []).map((i) => map[i]));
    const undB = new Set<number>();
    for (const [i, j] of r.undecidedBonds ?? []) { const b = bondOf(i, j); if (b) undB.add(b.id); }
    for (const id of frag) {
      const l = next.get(id);
      if (this.atomLabels.get(id) !== l) {
        if (l) this.atomLabels.set(id, l); else this.atomLabels.delete(id);
        atoms.add(id);
      }
      let knownChanged = false;
      if (r.ok && !undA.has(id)) {
        if (!this.known.has(id)) { this.known.add(id); knownChanged = true; }
      } else if (this.known.delete(id)) knownChanged = true;
      if (undA.has(id) !== this.undecidedAtoms.has(id)) {
        if (undA.has(id)) this.undecidedAtoms.add(id); else this.undecidedAtoms.delete(id);
        knownChanged = true;
      }
      if (knownChanged) atoms.add(id);
      for (const bid of doc.adj.get(id) ?? []) {
        const b = doc.bonds.get(bid)!;
        if (b.a1 !== id) continue;
        const lb = nextB.get(bid);
        const und = undB.has(bid);
        if (this.bondLabels.get(bid)?.label !== lb || und !== this.undecidedBonds.has(bid)) {
          if (lb) this.bondLabels.set(bid, { label: lb, a1: b.a1 }); else this.bondLabels.delete(bid);
          if (und) this.undecidedBonds.add(bid); else this.undecidedBonds.delete(bid);
          bonds.add(bid);
        } else if (knownChanged && (b.order === 2 || this.bondLabels.has(bid))) bonds.add(bid);
      }
    }
  }

  private report(atoms: Set<number>, bonds: Set<number>): void {
    if (!atoms.size && !bonds.size) return;
    this.version++;
    this.onChange([...atoms], [...bonds]);
    atoms.clear();
    bonds.clear();
  }
}
