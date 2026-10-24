// Pen and touch on the drawing, for tablets (an iPad with Apple Pencil, a Surface pen):
//
// - Two fingers pan and pinch-zoom the drawing, whatever the tool.
// - Once a pen has touched the drawing, a single finger pans instead of drawing, so a palm or
//   a resting finger never leaves a bond behind (as in Notes and GoodNotes). Before that, a
//   finger draws, for touchscreens with no pen.
//
// The pen itself already works as a mouse: the editor takes pointer events, so this only takes
// the touches away from it before they reach its own listeners. A long press is a right-click
// everywhere in the window (ui/touch-ui.ts).

import type { Vec } from '../geom';

export interface View { ox: number; oy: number; scale: number }

/** Where the view goes when two fingers that were at a0, b0 (with the view at v0) are now at a1, b1. */
export function pinchView(v0: View, a0: Vec, b0: Vec, a1: Vec, b1: Vec, min = 0.05, max = 64): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const scale = Math.min(max, Math.max(min, v0.scale * (d0 > 1 ? d1 / d0 : 1)));
  // the point of the drawing under the fingers' midpoint stays under their midpoint
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const k = scale / v0.scale;
  return { scale, ox: m1.x - (m0.x - v0.ox) * k, oy: m1.y - (m0.y - v0.oy) * k };
}

export interface TouchHost {
  overlay: HTMLElement;
  view: View;
  requestScene(ts?: number): void;
}

export function installPenAndTouch(h: TouchHost): void {
  const el = h.overlay;
  // no text selection, magnifier or callout from a long press on the canvas (iPadOS)
  el.style.setProperty('-webkit-user-select', 'none');
  el.style.setProperty('-webkit-touch-callout', 'none');

  let penSeen = false;
  /** Touches taken from the editor, where they are now (screen px, relative to the canvas). */
  const fingers = new Map<number, Vec>();
  /** A touch the editor was given (before a pen was seen), taken back if a second finger lands. */
  let given: { id: number; at: Vec; client: Vec } | null = null;
  let gesture: { v0: View; a0: Vec; b0: Vec; ids: [number, number] } | null = null;
  let pan: { v0: View; p0: Vec; id: number } | null = null;

  const local = (e: PointerEvent): Vec => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const take = (e: PointerEvent) => { e.stopImmediatePropagation(); e.preventDefault(); };
  const startGesture = () => {
    const [ia, ib] = [...fingers.keys()];
    gesture = { v0: { ...h.view }, a0: fingers.get(ia)!, b0: fingers.get(ib)!, ids: [ia, ib] };
    pan = null;
  };

  // capture phase, so these run before the editor's own listeners on the same element
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType !== 'touch') return;
    const p = local(e);
    if (!penSeen && fingers.size === 0 && given === null) {
      // the first finger on a screen with no pen draws, like a mouse
      const client = { x: e.clientX, y: e.clientY };
      given = { id: e.pointerId, at: p, client };
      return;
    }
    take(e);
    el.setPointerCapture?.(e.pointerId);
    if (given !== null) {
      // a second finger: the first one's press was the start of a pinch, not a drawing
      const g = given;
      given = null;
      cancelInEditor(g.id, g.client);
      fingers.set(g.id, g.at);
    }
    fingers.set(e.pointerId, p);
    if (fingers.size >= 2) startGesture();
    else pan = { v0: { ...h.view }, p0: p, id: e.pointerId };
  }, true);

  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === given?.id) { given.at = local(e); given.client = { x: e.clientX, y: e.clientY }; return; }
    if (!fingers.has(e.pointerId)) return;
    take(e);
    const p = local(e);
    fingers.set(e.pointerId, p);
    if (gesture) {
      const a1 = fingers.get(gesture.ids[0]), b1 = fingers.get(gesture.ids[1]);
      if (!a1 || !b1) return;
      Object.assign(h.view, pinchView(gesture.v0, gesture.a0, gesture.b0, a1, b1));
      h.requestScene(e.timeStamp);
    } else if (pan && pan.id === e.pointerId) {
      h.view.ox = pan.v0.ox + (p.x - pan.p0.x);
      h.view.oy = pan.v0.oy + (p.y - pan.p0.y);
      h.requestScene(e.timeStamp);
    }
  }, true);

  const up = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === given?.id) { given = null; return; }
    if (!fingers.has(e.pointerId)) return;
    take(e);
    fingers.delete(e.pointerId);
    gesture = null;
    // the finger left behind after a pinch carries on panning from where it is
    const [rest] = [...fingers.entries()];
    pan = rest ? { v0: { ...h.view }, p0: rest[1], id: rest[0] } : null;
    h.requestScene(e.timeStamp);
  };
  el.addEventListener('pointerup', up, true);
  // a long press (ui/touch-ui.ts) ends the finger's pan; the editor's own cancels pass by
  el.addEventListener('pointercancel', (e) => { if (e.isTrusted || fingers.has(e.pointerId)) up(e); else if (e.pointerId === given?.id) given = null; }, true);

  // the editor's press ends where the pointer is now (it forgets one that hadn't moved)
  function cancelInEditor(id: number, client: Vec) {
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch', clientX: client.x, clientY: client.y, bubbles: true }));
  }
}
