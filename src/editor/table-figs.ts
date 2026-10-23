// Structures in the cells of a table in a drawing. A structure dropped so its middle is in a
// cell belongs to that cell: the cell keeps room for it at its top (its text goes underneath),
// the column widens to fit it, and it is centred there. It moves with the table, and dragging
// it out of the table takes it out of the cell. Worked out from where things are as each change
// finishes, so nothing but the room kept needs saving.

import type { Doc, Entity, Shape, TableData } from '../model';
import type { Rect, Vec } from '../geom';
import { partAt, spanOf, type TableLayout } from '../table';
import { selectionBox, type Measure, type Selection } from './arrange';
import { followPins, hasPins } from '../chem/pins';

const atomsOnly = (atoms: Set<number>): Selection => ({ atoms, bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });
const mid = (b: Rect): Vec => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });

/** The middle of a structure's atoms (what decides which cell it is in). */
function atomsMiddle(doc: Doc, f: Set<number>): Vec {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of f) { const a = doc.atoms.get(id); if (!a) continue; x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y); x2 = Math.max(x2, a.x); y2 = Math.max(y2, a.y); }
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/** The structures whose middles lie in a table's body cells, as `r,c` → atoms (the first one found in each cell). */
function inCells(doc: Doc, t: TableData, lay: TableLayout, at: Vec, frags: Set<number>[], pick: (f: Set<number>) => boolean): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const f of frags) {
    if (!pick(f)) continue;
    const c = atomsMiddle(doc, f);
    const part = partAt(t, lay, { x: c.x - at.x, y: c.y - at.y });
    if (!part || typeof part === 'string') continue;
    const k = `${part.r},${part.c}`;
    if (!out.has(k)) out.set(k, f);
  }
  return out;
}

/** The structures sitting in a table's cells now (to move with it). */
export function tableContents(doc: Doc, s: Shape, layoutOf: (t: TableData) => TableLayout): number[] {
  if (s.kind !== 'table' || !s.table) return [];
  const lay = layoutOf(s.table);
  const out: number[] = [];
  for (const f of inCells(doc, s.table, lay, { x: s.x1, y: s.y1 }, doc.fragments(), () => true).values()) out.push(...f);
  return out;
}

/**
 * After a change: each table's structures held in their cells (room kept, column widened,
 * centred), and room let go where a structure has left. Call inside the edit.
 */
export function refitTableFigures(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure, layoutOf: (t: TableData) => TableLayout): void {
  const tables = [...doc.shapes.values()].filter((s) => s.kind === 'table' && s.table);
  if (!tables.length) return;
  let atomsChanged = false;
  for (const k of before.keys()) if (k[0] === 'a') { atomsChanged = true; break; }
  const L = doc.style.bondLength;
  let frags: Set<number>[] | null = null;
  let moved = false;
  for (const s of tables) {
    const was = before.get('s' + s.id) as Shape | null | undefined;
    if (!atomsChanged && !was && !s.table!.rows.some((r) => r.some((c) => c.fig))) continue;
    frags ??= doc.fragments();
    const t = s.table!;
    const lay = layoutOf(t);
    // a structure that moved is placed by where it is now; one that stayed put, by where the table was
    const oldT = was && was.kind === 'table' && was.table ? was.table : t;
    const oldAt = was && was.kind === 'table' ? { x: was.x1, y: was.y1 } : { x: s.x1, y: s.y1 };
    const movedNow = (f: Set<number>) => [...f].some((id) => before.has('a' + id));
    const held = new Map([
      ...inCells(doc, oldT, layoutOf(oldT), oldAt, frags, (f) => !movedNow(f)),
      ...inCells(doc, t, lay, { x: s.x1, y: s.y1 }, frags, movedNow),
    ]);
    // the room each cell needs now
    const pad = 0.15 * L;
    let next: TableData = t;
    const rows = t.rows.map((row, r) => row.map((cell, c) => {
      const f = held.get(`${r},${c}`);
      const b = f && selectionBox(doc, atomsOnly(f), m);
      const fig = b ? { w: Math.round((b.x2 - b.x1 + 2 * pad) * 100) / 100, h: Math.round((b.y2 - b.y1 + 2 * pad) * 100) / 100 } : undefined;
      if (!fig && !cell.fig) return cell;
      if (fig && cell.fig && Math.abs(fig.w - cell.fig.w) < 0.5 && Math.abs(fig.h - cell.fig.h) < 0.5) return cell;
      const { fig: _, ...rest } = cell;
      return fig ? { ...rest, fig } : rest;
    }));
    if (rows.some((row, r) => row.some((cell, c) => cell !== t.rows[r][c]))) next = { ...t, rows };
    // columns widen to fit their structures
    const cols = [...next.cols];
    next.rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell.fig) return;
      const span = spanOf(next, r, c);
      const have = cols.slice(c, c + span).reduce((x, y) => x + y, 0);
      const want = cell.fig.w + 2 * lay.padX;
      if (want > have + 0.01) cols[c + span - 1] += want - have;
    }));
    if (cols.some((w, i) => w !== next.cols[i])) next = { ...next, cols };
    const fin = layoutOf(next);
    if (next !== t) doc.updateShape(s.id, { table: next, x2: s.x1 + fin.width, y2: s.y1 + fin.height });
    // each structure centred in its room
    for (const fig of fin.figs) {
      const f = held.get(`${fig.r},${fig.c}`);
      const b = f && selectionBox(doc, atomsOnly(f), m);
      if (!f || !b) continue;
      const want = { x: s.x1 + (fig.box.x1 + fig.box.x2) / 2, y: s.y1 + (fig.box.y1 + fig.box.y2) / 2 };
      const now = mid(b);
      const dx = want.x - now.x, dy = want.y - now.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      for (const id of f) { const a = doc.atoms.get(id)!; doc.updateAtom(id, { x: a.x + dx, y: a.y + dy }); }
      moved = true;
    }
  }
  if (moved && hasPins(doc)) followPins(doc);
}
