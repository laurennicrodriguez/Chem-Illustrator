// The chemistry a workbook asks for, worked out in the background and kept. A formula that
// needs a structure's properties gets #BUSY! the first time; the question goes to the chemistry
// engine with any others asked at the same moment, and when the answers come back the sheets
// are worked out again. Answers are kept by structure (a structure is never changed in place,
// so its id stands for its drawing), by SMILES text, and by query for substructure searches.

import type { Contents } from '../model';
import { CellError, ERR } from './values';
import type { MolProps } from './properties';
import type { ChemHost, Structure } from './workbook';

/** The chemistry engine (the worker), or a stand-in for tests. */
export interface ChemEngine {
  readonly ready: boolean;
  props(mols: string[]): Promise<(MolProps | { error: string })[]>;
  substructure(query: string, mols: string[]): Promise<{ results: (boolean | null)[]; error?: string }>;
}

type Answer = MolProps | CellError;

/** Answers kept at most (oldest go first; they're worked out again if needed). */
const KEEP = 20000;

export class SheetChem implements ChemHost {
  /** Called when answers have arrived: work the sheets out again. */
  onAnswers: () => void = () => {};
  private byStructure = new Map<number, Answer>();
  private bySmiles = new Map<string, Answer>();
  private matches = new Map<string, boolean | null>();
  private queryIds = new WeakMap<Contents, number>();
  private nextQuery = 1;
  /** Questions not sent yet. */
  private wantProps = new Map<string, { input: () => string | null; store: (a: Answer) => void }>();
  private wantMatch = new Map<number, { query: Contents; items: Map<string, { input: () => string | null; key: string }> }>();
  private scheduled = false;
  private inFlight = 0;
  private waiters: (() => void)[] = [];

  /**
   * @param engine the chemistry engine
   * @param molfile a structure's drawing as a molfile, or null (with the reason) when it has no structure in it
   */
  constructor(private engine: ChemEngine, private molfile: (c: Contents) => { molblock: string | null; problem?: string }) {}

  structure(s: Structure): Answer {
    const got = this.byStructure.get(s.id);
    if (got) return got;
    const key = `s${s.id}`;
    if (!this.wantProps.has(key)) {
      this.wantProps.set(key, {
        input: () => {
          const m = this.molfile(s.contents);
          if (!m.molblock) { this.keep(this.byStructure, s.id, ERR.value(m.problem ?? 'There is no structure in this cell')); return null; }
          return m.molblock;
        },
        store: (a) => this.keep(this.byStructure, s.id, a),
      });
      this.schedule();
    }
    return ERR.busy();
  }

  smiles(text: string): Answer {
    const got = this.bySmiles.get(text);
    if (got) return got;
    const key = `t${text}`;
    if (!this.wantProps.has(key)) {
      this.wantProps.set(key, { input: () => text, store: (a) => this.keep(this.bySmiles, text, a) });
      this.schedule();
    }
    return ERR.busy();
  }

  substructure(s: Structure, query: Contents): boolean | null {
    let qid = this.queryIds.get(query);
    if (!qid) { qid = this.nextQuery++; this.queryIds.set(query, qid); }
    const key = `${qid}|${s.id}`;
    const got = this.matches.get(key);
    if (got !== undefined) return got;
    let q = this.wantMatch.get(qid);
    if (!q) { q = { query, items: new Map() }; this.wantMatch.set(qid, q); }
    if (!q.items.has(key)) {
      q.items.set(key, { key, input: () => this.molfile(s.contents).molblock });
      this.schedule();
    }
    return null;
  }

  /** Waits until every question asked so far has its answer. */
  settled(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  get busy(): boolean {
    return this.scheduled || this.inFlight > 0 || this.wantProps.size > 0 || this.wantMatch.size > 0;
  }

  /** Send what's waiting (call when the engine has just become ready). */
  flush(): void {
    this.scheduled = false;
    if (!this.engine.ready) return;
    void this.send();
  }

  /** Forget everything (when the way properties are worked out changes). */
  clear(): void {
    this.byStructure.clear();
    this.bySmiles.clear();
    this.matches.clear();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  private keep<K>(map: Map<K, unknown>, key: K, v: unknown): void {
    map.set(key, v);
    if (map.size > KEEP) map.delete(map.keys().next().value as K);
  }

  private async send(): Promise<void> {
    const props = [...this.wantProps.values()];
    const matches = [...this.wantMatch.values()];
    this.wantProps.clear();
    this.wantMatch.clear();
    const jobs: Promise<void>[] = [];
    if (props.length) {
      const asked: { store: (a: Answer) => void }[] = [];
      const inputs: string[] = [];
      for (const p of props) {
        const input = p.input();
        if (input === null) continue;
        asked.push(p);
        inputs.push(input);
      }
      if (inputs.length) {
        jobs.push(this.engine.props(inputs).then(
          (res) => res.forEach((r, i) => asked[i].store('error' in r ? ERR.value(r.error) : r)),
          (e) => asked.forEach((p) => p.store(ERR.value(`The chemistry engine failed: ${String(e)}`))),
        ));
      }
    }
    for (const q of matches) {
      const qm = this.molfile(q.query).molblock;
      const items = [...q.items.values()];
      if (!qm) { for (const it of items) this.matches.set(it.key, false); continue; }
      const asked: string[] = [];
      const inputs: string[] = [];
      for (const it of items) {
        const input = it.input();
        if (input === null) { this.matches.set(it.key, false); continue; }
        asked.push(it.key);
        inputs.push(input);
      }
      if (!inputs.length) continue;
      jobs.push(this.engine.substructure(qm, inputs).then(
        (res) => res.results.forEach((r, i) => this.keep(this.matches, asked[i], r ?? false)),
        () => asked.forEach((k) => this.matches.set(k, false)),
      ));
    }
    this.inFlight++;
    try {
      await Promise.all(jobs);
    } finally {
      this.inFlight--;
    }
    this.onAnswers();
    if (!this.busy) {
      const w = this.waiters;
      this.waiters = [];
      for (const f of w) f();
    }
  }
}
