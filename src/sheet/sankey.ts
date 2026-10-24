// The flows of a Sankey chart (chart.ts): each level is a column of categories, and each row of
// the sheet carries its amount from its category at one level to its category at the next. A
// category is a node, as tall as all the rows through it; the rows between two nodes are a band.
// A blank cell ends a row's flow at that level.

import type { SeriesData } from './chart';

export interface SankeyNode { level: number; label: string; value: number }
export interface SankeyLink { level: number; from: string; to: string; value: number }
export interface SankeyFlows {
  /** The nodes of each level, largest first. */
  levels: SankeyNode[][];
  /** The bands from one level to the next (`level` is where they start), in the order of their nodes. */
  links: SankeyLink[];
}

/** The nodes and bands of a Sankey chart's series. Without any numbers, each row counts once. */
export function sankeyFlows(data: SeriesData[]): SankeyFlows {
  const n = Math.max(0, ...data.map((d) => d.cats.length));
  const ys = data[0]?.ys ?? [];
  const counted = !ys.some(Number.isFinite);
  const nodes = data.map(() => new Map<string, SankeyNode>());
  const links = data.slice(1).map(() => new Map<string, SankeyLink>());
  for (let j = 0; j < n; j++) {
    const v = counted ? 1 : ys[j];
    if (!(Number.isFinite(v) && v > 0)) continue;
    let prev: string | null = null;
    data.forEach((d, i) => {
      const label = d.cats[j] ?? '';
      if (!label) { prev = null; return; }
      const node = nodes[i].get(label);
      if (node) node.value += v; else nodes[i].set(label, { level: i, label, value: v });
      if (prev !== null) {
        const k = `${prev}\u0000${label}`;
        const link = links[i - 1].get(k);
        if (link) link.value += v; else links[i - 1].set(k, { level: i - 1, from: prev, to: label, value: v });
      }
      prev = label;
    });
  }
  // largest first (the order they came in where they are the same size)
  const levels = nodes.map((m) => [...m.values()].map((x, k) => ({ x, k })).sort((a, b) => b.x.value - a.x.value || a.k - b.k).map(({ x }) => x));
  const rank = levels.map((l) => new Map(l.map((x, k) => [x.label, k])));
  const out = links.flatMap((m, i) => [...m.values()].sort((a, b) => rank[i].get(a.from)! - rank[i].get(b.from)! || rank[i + 1].get(a.to)! - rank[i + 1].get(b.to)!));
  return { levels, links: out };
}
