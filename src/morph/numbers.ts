// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// cdxmorph's .mapping.json files name atoms by ChemDraw's atom numbers (the AtomID each node
// carries in a CDXML file). Reading and writing them here lets a pairing made in either program
// be used in the other.

import type { Doc, MorphStep } from '../model';
import { descendants } from '../io/xml';

/** An attribute of each atom's node in the file the drawing was read from (atoms drawn since have none). */
export function sourceAttr(doc: Doc, name: string): Map<number, string> {
  const out = new Map<number, string>();
  const src = doc.source;
  if (!src) return out;
  const xml = new DOMParser().parseFromString(src.text.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml');
  const all = xml.documentElement ? descendants(xml.documentElement) : [];
  for (const id of doc.atoms.keys()) {
    const i = src.ord.get('a' + id);
    const v = i !== undefined ? all[i]?.getAttribute(name) : null;
    if (v) out.set(id, v);
  }
  return out;
}

/**
 * Each atom's number as cdxmorph names it: the AtomID from the file it was read from, and for
 * atoms drawn since, numbers after the highest one in use.
 */
export function atomNumbers(doc: Doc): Map<number, string> {
  const out = sourceAttr(doc, 'AtomID');
  let next = Math.max(0, ...[...out.values()].map(Number).filter(Number.isFinite)) + 1;
  for (const id of [...doc.atoms.keys()].sort((a, b) => a - b)) if (!out.has(id)) out.set(id, String(next++));
  return out;
}

/** One step's block of a .mapping.json, in atom numbers. */
interface Block {
  pairs?: Record<string, string>;
  exact?: boolean;
  shifts?: [string, string][];
  slides?: [string, string][];
}

/** Steps' settings as a .mapping.json (flat for one step, a "stages" list for more). */
export function writeMapping(doc: Doc, steps: (MorphStep | undefined)[]): string {
  const num = atomNumbers(doc);
  const n = (id: number) => num.get(id) ?? String(id);
  const blocks: Block[] = steps.map((m) => {
    const b: Block = {};
    if (!m) return b;
    if (m.pairs?.length) b.pairs = Object.fromEntries(m.pairs.map(([x, y]) => [n(x), n(y)]));
    if (m.exact) b.exact = true;
    if (m.shifts?.length) b.shifts = m.shifts.map(([u, v, d]) => [`${n(u)}-${n(v)}`, n(d)]);
    if (m.slides?.length) b.slides = m.slides.map(([[a, b2], [c, d]]) => [`${n(a)}-${n(b2)}`, `${n(c)}-${n(d)}`]);
    return b;
  });
  return JSON.stringify(blocks.length === 1 ? blocks[0] : { stages: blocks }, null, 1) + '\n';
}

export class MappingFileError extends Error {}

/** A .mapping.json read back into each step's settings (atom ids of this drawing). */
export function readMapping(doc: Doc, text: string, steps: number): MorphStep[] {
  let cfg: Block & { stages?: Block[] };
  try { cfg = JSON.parse(text); } catch { throw new MappingFileError('This is not a mapping file (it is not JSON).'); }
  if (!cfg || typeof cfg !== 'object') throw new MappingFileError('This is not a mapping file.');
  let blocks: Block[];
  if (Array.isArray(cfg.stages)) {
    if (cfg.stages.length !== steps) throw new MappingFileError(`The file has ${cfg.stages.length} steps but this scheme has ${steps}.`);
    blocks = cfg.stages;
  } else {
    if (steps > 1 && (cfg.pairs || cfg.shifts)) throw new MappingFileError(`The file pairs one step but this scheme has ${steps}.`);
    blocks = steps === 1 ? [cfg] : Array.from({ length: steps }, () => ({}));
  }
  const byNum = new Map<string, number>();
  for (const [id, v] of atomNumbers(doc)) byNum.set(v, id);
  const at = (v: string) => {
    const id = byNum.get(String(v).trim());
    if (id === undefined) throw new MappingFileError(`The drawing has no atom numbered ${v}.`);
    return id;
  };
  const pair = (s: string): [number, number] => {
    const [u, v] = String(s).split('-');
    if (v === undefined) throw new MappingFileError(`"${s}" should name a bond as two atom numbers, like "7-8".`);
    return [at(u), at(v)];
  };
  return blocks.map((b) => {
    const m: MorphStep = {};
    if (b.pairs && Object.keys(b.pairs).length) m.pairs = Object.entries(b.pairs).map(([x, y]) => [at(x), at(y)]);
    if (b.exact) m.exact = true;
    if (b.shifts?.length) m.shifts = b.shifts.map(([bond, d]) => [...pair(bond), at(d)] as [number, number, number]);
    if (b.slides?.length) m.slides = b.slides.map(([s, t]) => [pair(s), pair(t)]);
    return m;
  });
}
