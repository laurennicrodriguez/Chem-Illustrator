// The tree of a treemap or decomposition tree (chart.ts): each level is a column of categories,
// and each row of the sheet carries its amount down from its category at the first level to its
// category at the next, and so on. A category is a node, as big as all the rows under it. A blank
// cell ends a row there: it counts in the nodes above, and in none below.
//
// Also the squarified layout of a treemap (Bruls, Huizing and van Wijk, 2000): boxes as near
// square as can be, each as big as its node.

import type { SeriesData } from './chart';

export interface HierNode {
  label: string;
  value: number;
  /** Its level (the root, the whole, is −1). */
  level: number;
  /** The categories from the first level down to it (the root's is empty). */
  path: string[];
  /** The nodes under it, largest first (the order they came in where they are the same size). */
  children: HierNode[];
}

/** The tree of a chart's levels, its root the whole. Without any numbers, each row counts once. */
export function hierarchy(data: SeriesData[]): HierNode {
  const n = Math.max(0, ...data.map((d) => d.cats.length));
  const ys = data[0]?.ys ?? [];
  const counted = !ys.some(Number.isFinite);
  const root: HierNode = { label: '', value: 0, level: -1, path: [], children: [] };
  const index = new Map<HierNode, Map<string, HierNode>>();
  for (let j = 0; j < n; j++) {
    const v = counted ? 1 : ys[j];
    if (!(Number.isFinite(v) && v > 0)) continue;
    root.value += v;
    let at = root;
    for (let i = 0; i < data.length; i++) {
      const label = data[i].cats[j] ?? '';
      if (!label) break;
      let kids = index.get(at);
      if (!kids) index.set(at, (kids = new Map()));
      let node = kids.get(label);
      if (!node) {
        node = { label, value: 0, level: i, path: [...at.path, label], children: [] };
        kids.set(label, node);
        at.children.push(node);
      }
      node.value += v;
      at = node;
    }
  }
  const sort = (node: HierNode): void => {
    node.children = node.children.map((x, k) => ({ x, k })).sort((a, b) => b.x.value - a.x.value || a.k - b.k).map(({ x }) => x);
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

/** The node at the end of a path from the root (null if the path leads nowhere). */
export function nodeAt(root: HierNode, path: readonly string[]): HierNode | null {
  let at: HierNode | undefined = root;
  for (const label of path) {
    at = at.children.find((c) => c.label === label);
    if (!at) return null;
  }
  return at;
}

/** As much of a path as leads somewhere (a treemap drilled into a category no longer there shows what is left). */
export function validPath(root: HierNode, path: readonly string[] | undefined): string[] {
  const out: string[] = [];
  let at = root;
  for (const label of path ?? []) {
    const next = at.children.find((c) => c.label === label);
    if (!next) break;
    out.push(label);
    at = next;
  }
  return out;
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Squarified boxes filling `box`, one for each value (largest first works best), in the order
 * given: each box's area is in proportion to its value. Values of zero or less get no room.
 */
export function squarify(values: number[], box: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const items = values.map((v, i) => ({ v: Number.isFinite(v) && v > 0 ? v : 0, i })).filter((t) => t.v > 0);
  const total = items.reduce((a, t) => a + t.v, 0);
  if (!total || box.w <= 0 || box.h <= 0) return out;
  const scale = (box.w * box.h) / total;
  let free = { ...box };
  // the worst (most stretched) box of a row laid along a side of length `side`
  const worst = (row: number[], side: number): number => {
    const sum = row.reduce((a, b) => a + b, 0);
    const big = Math.max(...row), small = Math.min(...row);
    return Math.max((side * side * big) / (sum * sum), (sum * sum) / (side * side * small));
  };
  let k = 0;
  while (k < items.length) {
    const side = Math.min(free.w, free.h);
    const row: number[] = [items[k].v * scale];
    let end = k + 1;
    while (end < items.length) {
      const next = [...row, items[end].v * scale];
      if (worst(next, side) > worst(row, side)) break;
      row.push(items[end].v * scale);
      end++;
    }
    // lay the row along the shorter side, taking a strip off the free space
    const sum = row.reduce((a, b) => a + b, 0);
    const last = end >= items.length;
    if (free.w >= free.h) {
      const stripW = last ? free.w : Math.min(free.w, sum / free.h);
      let y = free.y;
      row.forEach((a, j) => {
        const h = j === row.length - 1 ? free.y + free.h - y : a / stripW;
        out[items[k + j].i] = { x: free.x, y, w: stripW, h };
        y += h;
      });
      free = { x: free.x + stripW, y: free.y, w: free.w - stripW, h: free.h };
    } else {
      const stripH = last ? free.h : Math.min(free.h, sum / free.w);
      let x = free.x;
      row.forEach((a, j) => {
        const w = j === row.length - 1 ? free.x + free.w - x : a / stripH;
        out[items[k + j].i] = { x, y: free.y, w, h: stripH };
        x += w;
      });
      free = { x: free.x, y: free.y + stripH, w: free.w, h: free.h - stripH };
    }
    k = end;
  }
  return out;
}
