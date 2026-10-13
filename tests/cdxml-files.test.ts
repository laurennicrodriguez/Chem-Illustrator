// @vitest-environment jsdom
//
// Save tests against real ChemDraw files. The files are private, so they are not in the
// repository: point CHEM_TEST_FILES at a folder of .cdxml files to run these locally.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { summarize, differences, duplicateIds } from './cdxml-compare';

const dir = process.env.CHEM_TEST_FILES ?? '';
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cdxml')) : [];

describe.skipIf(!files.length)('saving real ChemDraw files', { timeout: 120000 }, () => {
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');

    it(`${f}: unchanged save gives back the same file`, () => {
      const { doc } = readCdxml(text);
      expect(writeCdxml(doc) === text).toBe(true);
    });

    it(`${f}: written from scratch reads back the same`, () => {
      const { doc } = readCdxml(text);
      const before = summarize(doc);
      doc.source = null;
      const out = writeCdxml(doc);
      const back = readCdxml(out).doc;
      expectSame(summarize(back), before);
    });

    it(`${f}: labels in a rebuilt file sit where ChemDraw put them`, () => {
      const { doc } = readCdxml(text);
      doc.source = null;
      const was = labelBoxes(text), now = labelBoxes(writeCdxml(doc));
      let close = 0, total = 0;
      for (const [id, a] of was) {
        const b = now.get(id);
        if (!b) continue;
        total++;
        // left, top and right edges (ChemDraw's box bottom varies between versions)
        if ([0, 1, 2].every((i) => Math.abs(a[i] - b[i]) < 1.5)) close++;
      }
      expect(close / Math.max(1, total)).toBeGreaterThan(0.9);
    });

    it(`${f}: a rebuilt file lists the same lines in each caption`, () => {
      // ChemDraw drops blank lines unless the file lists where each line ends
      const { doc } = readCdxml(text);
      doc.source = null;
      const was = captionLines(text), now = captionLines(writeCdxml(doc));
      const diff = [...was].filter(([id, n]) => now.has(id) && now.get(id) !== n).map(([id, n]) => `caption ${id}: ${n} lines, now ${now.get(id)}`);
      expect(diff.slice(0, 10)).toEqual([]);
    });

    it(`${f}: edited save keeps the edits and everything else`, () => {
      const { doc } = readCdxml(text);
      const frags = doc.fragments().sort((a, b) => b.size - a.size);
      doc.edit('test edits', () => {
        // move the largest structure, delete an atom of the second, relabel an atom of the third
        if (frags[0]) doc.moveAtoms(frags[0], 20, 10);
        const second = frags[1] ? [...frags[1]] : [];
        if (second.length > 2) doc.removeAtom(second[second.length - 1]);
        const third = frags[2] ? [...frags[2]] : [];
        if (third.length) doc.updateAtom(third[0], { label: 'OMe', z: 6 });
        const cap = doc.captions.values().next().value;
        if (cap) doc.updateCaption(cap.id, { x: cap.x + 5, y: cap.y + 5 });
        const arrow = doc.arrows.values().next().value;
        if (arrow) doc.updateArrow(arrow.id, { tail: { x: arrow.tail.x - 3, y: arrow.tail.y }, head: { x: arrow.head.x + 3, y: arrow.head.y } });
        // a new structure off to the side
        const a = doc.addAtom(-200, -200), b = doc.addAtom(-187.5, -192.8, 8);
        doc.addBond(a.id, b.id, 2);
      });
      const before = summarize(doc);
      const out = writeCdxml(doc);
      const back = readCdxml(out).doc;
      expectSame(summarize(back), before);
      expect(duplicateIds(out)).toEqual([]);
    });
  }
});

function expectSame(got: ReturnType<typeof summarize>, want: ReturnType<typeof summarize>): void {
  expect(differences(got, want).slice(0, 20)).toEqual([]);
}

/** Atom label boxes by node id. */
function labelBoxes(text: string): Map<string, number[]> {
  const root = new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml').documentElement;
  const out = new Map<string, number[]>();
  const visit = (e: Element) => {
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) {
      if (c.nodeName === 'n') {
        let t = c.firstElementChild;
        while (t && t.nodeName !== 't') t = t.nextElementSibling;
        const bb = t?.getAttribute('BoundingBox');
        if (bb) out.set(c.getAttribute('id')!, bb.trim().split(/\s+/).map(Number));
      } else visit(c);
    }
  };
  visit(root);
  return out;
}

/** Number of lines ChemDraw will show for each caption, by id (1 when no line ends are listed). */
function captionLines(text: string): Map<string, number> {
  const fonts = new Map<string, string>();
  const arialOnly = (t: Element) => [...t.getElementsByTagName('s')].every((s) => /^(arial|symbol)$/i.test(fonts.get(s.getAttribute('font') ?? '') ?? ''));
  const root = new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml').documentElement;
  const out = new Map<string, number>();
  const visit = (e: Element) => {
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) {
      if (c.nodeName === 'n') continue;
      // (text boxes in fonts other than Arial wrap with that font's widths, which Node doesn't have)
      if (c.nodeName === 't' && c.getAttribute('id') && !(c.getAttribute('WordWrapWidth') && !arialOnly(c))) out.set(c.getAttribute('id')!, (c.getAttribute('LineStarts') ?? '0').trim().split(/\s+/).length);
      else visit(c);
    }
  };
  for (const f of root.getElementsByTagName('font')) fonts.set(f.getAttribute('id') ?? '', f.getAttribute('name') ?? '');
  visit(root);
  return out;
}
