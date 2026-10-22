// Dragging icons about a packed grid, as on a phone's home screen being rearranged (Customize
// Toolboxes, Customize the Ribbon): a press that moves lifts the icon to follow the pointer and
// the grid makes room where it would go, the others sliding aside. Let go over the grid to put it
// there, over an icon that takes things to put it inside, over another target (a ribbon tab) to
// send it there, or away from the grid to take it out. A press that doesn't move is a click.

import { slotAt } from './toolboxes';

export type TileDrop =
  | { kind: 'at'; at: number }
  | { kind: 'into'; el: HTMLElement }
  | { kind: 'target'; el: HTMLElement }
  | { kind: 'out' };

export interface TileDragOptions {
  /** The grid of icons (each `.tbe-tile`). */
  grid: HTMLElement;
  /** Where the dragged picture goes (the window, which is above everything else). */
  layer: HTMLElement;
  /** The icon's place in the grid, or null for something dragged in from a list. */
  from: number | null;
  /** The icon pressed (it is the one that makes room, when it is in the grid). */
  el: HTMLElement;
  /** The picture that follows the pointer. */
  ghost(): HTMLElement;
  /** A stand-in icon for something dragged in from a list. */
  stand(): HTMLElement;
  /** Whether it can be dragged now (false: say why, and the press does nothing). */
  canStart?(): boolean;
  /** An icon in the grid under the pointer that takes this inside it (a fly-out), if any. */
  into?(tiles: HTMLElement[], x: number, y: number): HTMLElement | null;
  /** Whether the grid holds still with the pointer here (over a fly-out, so it can be reached to drop into). */
  hold?(tiles: HTMLElement[], x: number, y: number): boolean;
  /** Something outside the grid under the pointer that takes it (a ribbon tab), if any. */
  target?(x: number, y: number): HTMLElement | null;
  /** The press didn't move. */
  click?(): void;
  /** Where it was let go. */
  drop(where: TileDrop): void;
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Change a grid, its icons sliding from where they were to where they go (no slide with less motion). */
export function flip(grid: HTMLElement, change: () => void): void {
  const tiles = [...grid.querySelectorAll<HTMLElement>('.tbe-tile')];
  const was = new Map(tiles.map((t) => [t, t.getBoundingClientRect()]));
  change();
  if (reduceMotion()) return;
  for (const t of grid.querySelectorAll<HTMLElement>('.tbe-tile')) {
    const a = was.get(t);
    if (!a || t.hidden) continue;
    const b = t.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    t.style.transition = 'none';
    t.style.transform = `translate(${dx}px, ${dy}px)`;
    void t.offsetWidth;
    t.style.transition = 'transform 160ms ease-out';
    t.style.transform = '';
  }
}

/** Whether a point is inside an element's middle (`inset` of its size in from each side). */
export function inside(el: Element, x: number, y: number, inset = 0): boolean {
  const r = el.getBoundingClientRect();
  const ix = r.width * inset, iy = r.height * inset;
  return x > r.left + ix && x < r.right - ix && y > r.top + iy && y < r.bottom - iy;
}

/** Follow a press on an icon or a list row until it is let go. */
export function dragTile(e: PointerEvent, o: TileDragOptions): void {
  if (e.button !== 0) return;
  const { grid, layer, from } = o;
  const x0 = e.clientX, y0 = e.clientY;
  let ghost: HTMLElement | null = null;
  /** The icon making room in the grid: the one dragged, or a stand-in for one from the list. */
  let hole: HTMLElement | null = from !== null ? o.el : null;
  let into: HTMLElement | null = null;
  let target: HTMLElement | null = null;
  let out = false;
  let refused = false;
  const tiles = () => [...grid.querySelectorAll<HTMLElement>('.tbe-tile')];
  const mark = (el: HTMLElement | null, on: boolean) => el?.classList.toggle('drop-in', on);
  const move = (m: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
      if (o.canStart && !o.canStart()) { refused = true; up(); return; }
      ghost = document.createElement('div');
      ghost.className = 'tbe-ghost';
      ghost.append(o.ghost());
      layer.append(ghost);
      layer.classList.add('dragging');
      hole?.classList.add('hole');
    }
    m.preventDefault();
    ghost.style.left = `${m.clientX}px`;
    ghost.style.top = `${m.clientY}px`;
    const g = grid.getBoundingClientRect();
    const over = m.clientX > g.left - 16 && m.clientX < g.right + 16 && m.clientY > g.top - 16 && m.clientY < g.bottom + 16;
    mark(into, false);
    mark(target, false);
    into = over && o.into ? o.into(tiles().filter((t) => t !== hole), m.clientX, m.clientY) : null;
    target = !over && o.target ? o.target(m.clientX, m.clientY) : null;
    mark(into, true);
    mark(target, true);
    out = !over;
    ghost.classList.toggle('removing', out && !target && from !== null);
    if (into) return;
    if (out) {
      if (hole && from === null) { const h = hole; flip(grid, () => h.remove()); hole = null; }
      else if (hole && !hole.hidden) { const h = hole; flip(grid, () => { h.hidden = true; }); }
      return;
    }
    if (o.hold?.(tiles().filter((t) => t !== hole), m.clientX, m.clientY)) return;
    if (!hole) {
      hole = o.stand();
      hole.classList.add('hole');
      hole.hidden = true;
      grid.querySelector('.tbe-empty')?.remove();
    }
    const h = hole;
    // where it would go, among the icons showing (the hole too, so it holds still over itself)
    const others = tiles().filter((t) => t !== h && !t.hidden);
    const showing = h.isConnected && !h.hidden;
    const all = showing ? tiles().filter((t) => !t.hidden) : others;
    let at = slotAt(all.map((t) => t.getBoundingClientRect()), m.clientX, m.clientY);
    if (showing && at > all.indexOf(h)) at--;
    const before = others[at] ?? null;
    let next = h.nextElementSibling as HTMLElement | null;
    while (next && (next.hidden || !next.classList.contains('tbe-tile'))) next = next.nextElementSibling as HTMLElement | null;
    if (showing && next === before) return;
    flip(grid, () => { h.hidden = false; grid.insertBefore(h, before); });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    layer.classList.remove('dragging');
    mark(into, false);
    mark(target, false);
    if (!ghost) { if (!refused) o.click?.(); return; }
    ghost.remove();
    if (into) o.drop({ kind: 'into', el: into });
    else if (target) o.drop({ kind: 'target', el: target });
    else if (out || !hole) o.drop({ kind: 'out' });
    else o.drop({ kind: 'at', at: tiles().indexOf(hole) });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
