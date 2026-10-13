// After a drawing is saved, the saved file becomes what later saves are compared with, so
// saving again writes only what changed (see cdxml-write.ts).

import { Doc, Entity, Kind } from '../model';
import { readCdxml } from './cdxml';

/**
 * After a save, the saved text becomes the file the drawing is compared with next time, so
 * saving again without changes writes the same bytes and later saves only touch new edits.
 */
export function adoptSaved(doc: Doc, text: string): void {
  let back: Doc;
  try {
    back = readCdxml(text).doc;
  } catch {
    return;
  }
  const src = back.source;
  if (!src) return;
  const maps: [Kind, Map<number, Entity>][] = [['a', doc.atoms], ['b', doc.bonds], ['c', doc.captions], ['r', doc.arrows], ['s', doc.shapes]];
  let count = 0;
  for (const [kind, m] of maps) {
    for (const id of m.keys()) {
      if (!src.ord.has(kind + id)) return; // the file numbers things differently; keep comparing with the old one
      count++;
    }
  }
  if (count !== src.ord.size) return;
  const orig = new Map<string, Entity>();
  for (const [kind, m] of maps) for (const e of m.values()) orig.set(kind + e.id, structuredClone(e));
  doc.source = { text, ord: src.ord, orig, maxId: src.maxId };
  doc.reserveIds(src.maxId); // ids the file uses inside abbreviations stay taken
}
