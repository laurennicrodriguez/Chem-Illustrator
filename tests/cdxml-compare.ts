// A position-based summary of a drawing, for checking that saving and re-reading keeps it.
// Ids are left out because a file written from scratch numbers objects afresh. Numbers are
// compared with a small tolerance, since files store coordinates to two decimals.

import { Doc } from '../src/model';

export interface Item { key: string; nums: number[] }
export type Summary = Record<'atoms' | 'bonds' | 'captions' | 'arrows' | 'shapes', Item[]>;

export function summarize(doc: Doc): Summary {
  const at = (id: number) => { const a = doc.atoms.get(id)!; return [a.x, a.y]; };
  const lw = doc.style.lineWidth;
  return {
    atoms: [...doc.atoms.values()].map((a) => ({
      key: `z${a.z} ${a.label ?? ''} q${a.charge}${a.hideCharge ? 'h' : ''} i${a.isotope} ${a.color ?? ''} ${a.stereoLabel?.text ?? ''}`,
      nums: a.stereoLabel ? [a.x, a.y, a.x + a.stereoLabel.dx, a.y + a.stereoLabel.dy] : [a.x, a.y],
    })),
    bonds: [...doc.bonds.values()].map((b) => ({ key: `o${b.order} ${b.display} ${b.dpos} ${b.color ?? ''}`, nums: [...at(b.a1), ...at(b.a2)] })),
    captions: [...doc.captions.values()].map((c) => ({ key: `${c.justify} ${c.runs.map((x) => x.text).join('')}`, nums: [c.x, c.y] })),
    arrows: [...doc.arrows.values()].map((a) => ({
      key: `${a.headStyle}/${a.tailStyle} ${a.headType} ${a.line} ${a.noGo} ${a.equilibrium}`,
      nums: [a.tail.x, a.tail.y, a.head.x, a.head.y, a.sweep * 10],
    })),
    shapes: [...doc.shapes.values()].filter((s) => !s.picture).map((s) => ({
      key: `${s.kind} ${s.symbol ?? ''}${s.bracket ?? ''}${s.pair ? 'P' : ''} ${!!s.dashed}${!!s.filled}${!!s.rounded}${!!s.shadow}${!!s.bold}`,
      nums: [s.x1, s.y1, s.x2, s.y2, s.rounded ? s.radius ?? 6 * lw : 0, s.shadow ? s.shadowSize ?? 4 * lw : 0],
    })),
  };
}

/** Items of `want` with no match in `got`, and items of `got` left over, as readable lines. */
export function differences(got: Summary, want: Summary, tol = 0.05): string[] {
  const out: string[] = [];
  for (const k of Object.keys(want) as (keyof Summary)[]) {
    const pool = new Map<string, Item[]>();
    for (const it of got[k]) pool.set(it.key, [...(pool.get(it.key) ?? []), it]);
    for (const w of want[k]) {
      const cands = pool.get(w.key) ?? [];
      const i = cands.findIndex((g) => g.nums.every((x, j) => Math.abs(x - w.nums[j]) <= tol));
      if (i >= 0) cands.splice(i, 1);
      else out.push(`${k} missing: ${w.key} @ ${w.nums.map((x) => x.toFixed(2)).join(',')}`);
    }
    for (const rest of pool.values()) for (const g of rest) out.push(`${k} extra: ${g.key} @ ${g.nums.map((x) => x.toFixed(2)).join(',')}`);
  }
  return out;
}

/** Object ids used more than once in a CDXML file (font ids are a separate list in ChemDraw). */
export function duplicateIds(text: string): string[] {
  const root = new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml').documentElement;
  const seen = new Set<string>(), dups: string[] = [];
  const visit = (e: Element) => {
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) {
      if (c.nodeName === 'fonttable' || c.nodeName === 'colortable') continue;
      const id = c.getAttribute('id');
      if (id) { if (seen.has(id)) dups.push(`${c.nodeName} ${id}`); seen.add(id); }
      visit(c);
    }
  };
  visit(root);
  return dups;
}
