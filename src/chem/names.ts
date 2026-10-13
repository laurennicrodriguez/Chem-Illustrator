// Name to structure. OPSIN reads the name (offline, in its own worker) and gives SMILES; RDKit
// then lays the structure out like a pasted SMILES. The structure is ordinary drawing, so
// anything OPSIN or RDKit decided can be changed by hand afterwards.

import type { NameRequest, NameResponse } from '../worker/opsin-worker';

export interface NameResult {
  ok: boolean;
  /** SMILES, possibly with CXSMILES extras (attachment points, polymer brackets, and/or groups). */
  smiles: string;
  /** Things OPSIN wants the person to know, such as ignored stereochemistry. */
  warnings: string[];
  /** Why the name could not be read. */
  message: string;
}

/** OPSIN's JSON reply as a NameResult; anything unexpected becomes a failure. */
export function parseReply(json: string): NameResult {
  try {
    const r = JSON.parse(json);
    if (r && r.ok === true && typeof r.smiles === 'string' && r.smiles) {
      const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w: unknown) => typeof w === 'string' && w) : [];
      return { ok: true, smiles: r.smiles, warnings, message: '' };
    }
    return { ok: false, smiles: '', warnings: [], message: typeof r?.message === 'string' && r.message ? r.message : 'The name could not be read.' };
  } catch {
    return { ok: false, smiles: '', warnings: [], message: 'The name reader gave an answer that could not be understood.' };
  }
}

/**
 * Tidies a name typed or pasted from elsewhere: typographic dashes and quotes become plain ones,
 * odd spaces become ordinary spaces, and runs of spaces become one. Primes (′ ″) are kept, since
 * OPSIN reads them.
 */
export function cleanName(text: string): string {
  return text
    .replace(/[­​‌‍﻿]/g, '') // soft hyphen, zero-width characters
    .replace(/[‐‑‒–—−﹣－]/g, '-') // hyphens, dashes, minus sign
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\s  -   　]+/g, ' ')
    .trim();
}

/**
 * The name in a caption. A long name wrapped over several lines is put back together: a line
 * ending in a hyphen or comma (where names are usually broken) joins the next directly,
 * otherwise with a space.
 */
export function captionName(text: string): string {
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  let out = '';
  for (const l of lines) out += !out || /[-,‐‑]$/.test(out) ? l : ' ' + l;
  return cleanName(out);
}

/**
 * Which atoms, counted in SMILES order, OPSIN marked as points of attachment: a substituent name
 * such as "4-methoxyphenyl" gives a * atom labelled _AP1 in the CXSMILES label layer
 * (`|$_AP1;;;$|`). RDKit keeps SMILES order, so these are also the molfile's atom positions.
 */
export function attachmentAtoms(smiles: string): number[] {
  const bar = smiles.indexOf('|');
  if (bar < 0) return [];
  // the label layer is the one starting "$" (atom values start "$_AV:")
  const m = /(?:^\||,)\$(?!_AV:)([^$]*)\$/.exec(smiles.slice(bar));
  if (!m) return [];
  const out: number[] = [];
  m[1].split(';').forEach((label, i) => { if (/^_AP\d*$/.test(label)) out.push(i); });
  return out;
}

/**
 * Things in OPSIN's CXSMILES extras that a plain drawing can't show yet, as notes for the
 * person: racemic (rac) and relative (rel) stereochemistry, which are drawn as the wedges of one
 * enantiomer, and polymer brackets.
 */
export function cxNotes(smiles: string): string[] {
  const bar = smiles.indexOf('|');
  if (bar < 0) return [];
  // the layers, without the label layer (whose text could contain anything)
  const layers = smiles.slice(bar + 1, smiles.lastIndexOf('|')).replace(/\$[^$]*\$/g, '').split(',');
  const notes: string[] = [];
  if (layers.some((l) => l === 'r' || /^&\d/.test(l))) notes.push('The name says racemic (rac): the wedges show one enantiomer, so add "rac" or (±) to the drawing if needed.');
  if (layers.some((l) => /^o\d/.test(l))) notes.push('The name gives relative stereochemistry (rel): the wedges show one enantiomer, so add "rel" to the drawing if needed.');
  if (layers.some((l) => l.startsWith('Sg:'))) notes.push('Polymer brackets are not drawn yet; the repeat unit\'s ends are shown as R.');
  return notes;
}

/** Talks to the name worker, starting it on first use. */
export class NameReader {
  private worker: Worker | null = null;
  private started: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, (json: string) => void>();
  /** How long starting took (download, unpack and set-up), once ready. */
  loadMs = 0;

  constructor(private dataUrl: string) {}

  /** Starts the reader if needed; resolves when it is ready, or rejects with a readable reason. */
  start(): Promise<void> {
    if (this.started) return this.started;
    this.started = new Promise<void>((resolve, reject) => {
      try {
        this.worker = import.meta.env.DEV
          ? new Worker(new URL('../worker/opsin-worker.ts', import.meta.url), { type: 'module' })
          : new Worker(new URL('../worker/opsin-worker.ts', import.meta.url));
      } catch (e) {
        reject(new Error('The name reader could not start: ' + String(e)));
        return;
      }
      this.worker.onmessage = (e: MessageEvent<NameResponse>) => {
        const m = e.data;
        if (m.type === 'ready') { this.loadMs = m.ms; resolve(); }
        else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === 'parse') {
          const cb = this.pending.get(m.id);
          if (cb) { this.pending.delete(m.id); cb(m.json); }
        }
      };
      this.worker.onerror = (e) => reject(new Error('The name reader failed: ' + (e.message || 'unknown error')));
      this.send({ type: 'init', data: this.dataUrl });
    });
    // let a later call try again after a failure
    this.started.catch(() => { this.worker?.terminate(); this.worker = null; this.started = null; });
    return this.started;
  }

  private send(m: NameRequest): void {
    this.worker?.postMessage(m);
  }

  /** Reads one name. Never rejects: problems come back as a failed NameResult. */
  async read(name: string): Promise<NameResult> {
    const clean = cleanName(name);
    if (!clean) return { ok: false, smiles: '', warnings: [], message: 'Type a chemical name.' };
    try {
      await this.start();
    } catch (e) {
      return { ok: false, smiles: '', warnings: [], message: (e as Error).message };
    }
    const id = this.nextId++;
    const json = await new Promise<string>((resolve) => {
      this.pending.set(id, resolve);
      this.send({ type: 'parse', id, name: clean });
    });
    return parseReply(json);
  }
}
