// Arranging the figures, pictures and text boxes that float on the page (Picture Format and
// Layout > Arrange, as in Word): Position (nine places on the page, with the text round them),
// Rotate and Flip, Group, Bring Forward and Send Backward, and the Selection Pane's names and
// hidden figures.

import { floatOf, objectOffsets, type DocObject, type DocText, type Float, type PageSetup } from './document';

/** Position's nine places, as Word's gallery has them: row (top, middle, bottom) then column (left, centre, right). */
export type PositionPlace = `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}`;

export const POSITION_PLACES: PositionPlace[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

/** A place's name, as a menu shows it. */
export function placeName(p: PositionPlace): string {
  const [row, col] = p.split('-');
  return `${row[0].toUpperCase()}${row.slice(1)} ${col === 'center' ? 'Center' : col[0].toUpperCase() + col.slice(1)}`;
}

/**
 * A figure put at one of the nine places inside the margins (its frame and shadow `extent`
 * included), with the text wrapping round it on its wider side, as Word's Position does.
 */
export function positioned(fl: Float | undefined, place: PositionPlace, size: { w: number; h: number }, page: PageSetup, extent: [number, number, number, number] = [0, 0, 0, 0]): Float {
  const [row, col] = place.split('-');
  const [el, et, er, eb] = extent;
  const w = size.w + el + er, h = size.h + et + eb;
  const roomW = page.w - page.left - page.right, roomH = page.h - page.top - page.bottom;
  const x = col === 'left' ? 0 : col === 'center' ? (roomW - w) / 2 : roomW - w;
  const y = row === 'top' ? 0 : row === 'middle' ? (roomH - h) / 2 : roomH - h;
  const keep = fl && fl.wrap !== 'behind' && fl.wrap !== 'front' ? fl.wrap : 'square';
  return { ...fl, wrap: keep, x, y, xFrom: 'margin', yFrom: 'margin' };
}

export type Turn = 'right' | 'left' | 'flipH' | 'flipV';

/** A picture turned a quarter right or left, or flipped across or up and down. */
export function turned<T extends Extract<DocObject, { kind: 'picture' }>>(o: T, how: Turn | number): T {
  let rot = o.rot ?? 0;
  let flipH = !!o.flipH, flipV = !!o.flipV;
  if (typeof how === 'number') rot = how;
  else if (how === 'right') rot += 90;
  else if (how === 'left') rot -= 90;
  else if (how === 'flipH') flipH = !flipH;
  else flipV = !flipV;
  rot = ((rot % 360) + 360) % 360;
  const { rot: _r, flipH: _h, flipV: _v, ...rest } = o;
  return { ...rest, ...(rot ? { rot } : {}), ...(flipH ? { flipH } : {}), ...(flipV ? { flipV } : {}) } as T;
}

/** How a picture is turned and flipped (null when it isn't). */
export function turnOf(o: DocObject | undefined): { rot: number; flipH: boolean; flipV: boolean } | null {
  if (o?.kind !== 'picture' || (!o.rot && !o.flipH && !o.flipV)) return null;
  return { rot: o.rot ?? 0, flipH: !!o.flipH, flipV: !!o.flipV };
}

/** The floating figures of a document, in the order of the text. */
export function floatingIds(t: Pick<DocText, 'runs' | 'objects'>): number[] {
  return [...objectOffsets(t.runs).entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).filter((id) => floatOf(t.objects[id]) !== undefined);
}

/** The floating figures from back to front (as drawn): by `z`, else in the order of the text. */
export function stackOrder(t: Pick<DocText, 'runs' | 'objects'>): number[] {
  const ids = floatingIds(t);
  const z = (id: number, i: number) => floatOf(t.objects[id])?.z ?? i;
  return ids.map((id, i) => ({ id, z: z(id, i), i })).sort((a, b) => a.z - b.z || a.i - b.i).map((x) => x.id);
}

export type Restack = 'front' | 'back' | 'forward' | 'backward';

/** Bring to Front, Send to Back, Bring Forward or Send Backward: every floating figure numbered again from the back. */
export function restacked(t: DocText, id: number, how: Restack): DocText {
  const order = stackOrder(t);
  const at = order.indexOf(id);
  if (at < 0) return t;
  order.splice(at, 1);
  const to = how === 'front' ? order.length : how === 'back' ? 0 : how === 'forward' ? Math.min(order.length, at + 1) : Math.max(0, at - 1);
  order.splice(to, 0, id);
  return withFloats(t, order.map((x, z) => [x, { z }]));
}

/** The figures grouped with this one (itself included), in the order of the text. */
export function groupOf(t: Pick<DocText, 'runs' | 'objects'>, id: number): number[] {
  const g = floatOf(t.objects[id])?.group;
  if (g === undefined) return [id];
  return floatingIds(t).filter((x) => floatOf(t.objects[x])?.group === g);
}

/** Group floating figures (two or more): they move together. Grouping figures already in groups joins the groups. */
export function grouped(t: DocText, ids: number[]): DocText {
  const all = [...new Set(ids.flatMap((id) => groupOf(t, id)))].filter((id) => floatOf(t.objects[id]));
  if (all.length < 2) return t;
  const used = new Set(floatingIds(t).map((id) => floatOf(t.objects[id])?.group).filter((g): g is number => g !== undefined));
  let g = 1;
  while (used.has(g) && !all.some((id) => floatOf(t.objects[id])?.group === g)) g++;
  return withFloats(t, all.map((id) => [id, { group: g }]));
}

/** Ungroup the group a figure is in. */
export function ungrouped(t: DocText, id: number): DocText {
  return withFloats(t, groupOf(t, id).map((x) => [x, { group: undefined }]));
}

/** Changes to some figures' Float. */
export function withFloats(t: DocText, changes: [number, Partial<Float>][]): DocText {
  const objects = { ...t.objects };
  for (const [id, patch] of changes) {
    const o = objects[id];
    const fl = floatOf(o);
    if (!o || !fl) continue;
    const next: Float = { ...fl, ...patch };
    for (const k of Object.keys(next) as (keyof Float)[]) if (next[k] === undefined) delete next[k];
    objects[id] = { ...o, float: next } as DocObject;
  }
  return { ...t, objects };
}

/** A figure's name in the Selection Pane: its own, or its kind and number. */
export function objectName(t: Pick<DocText, 'objects'>, id: number): string {
  const o = t.objects[id];
  const own = floatOf(o)?.name;
  if (own) return own;
  if (o?.kind === 'textbox') return `Text Box ${id}`;
  if (o?.kind === 'picture') return o.chart ? `Chart ${id}` : `Picture ${id}`;
  return `Drawing ${id}`;
}
