// View > Touch Mode, for tablets and touch screens (an iPad with Apple Pencil, a Surface):
//
// - Bigger menus, ribbon buttons and toolbox buttons (html.touch-ui in app.css).
// - Holding a finger or the pen still for half a second is a right-click, anywhere in the window.
// - Two quick taps are a double-click where the browser doesn't send one (Safari on iPad).
// - The atom keypad along the bottom of the drawing: the keys a keyboard would give (labels,
//   charges, a new bond, rings, bond orders) for the atom or bond last drawn or selected.
//
// Automatic (the default) turns it on when the screen is a touch screen or once a pen or finger
// is used, and leaves it on for the rest of the session.


/** A place that takes typing (where the system's own long press selects and pastes). */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes((el as HTMLInputElement).type);
}

export type TouchMode = 'auto' | 'on' | 'off';

const HOLD_MS = 500, HOLD_SLOP = 8;
const DOUBLE_MS = 350, DOUBLE_SLOP = 14;

let mode: TouchMode = 'auto';
let used = false;
let onChange: (on: boolean) => void = () => {};

export function touchMode(): TouchMode { return mode; }

/** Touch mode is on now (set on, or automatic on a touch screen or after a touch). */
export function touchOn(): boolean {
  if (mode !== 'auto') return mode === 'on';
  return used || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
}

function apply(): void {
  const on = touchOn();
  document.documentElement.classList.toggle('touch-ui', on);
  for (const v of ['auto', 'on', 'off'] as const) document.querySelector(`[data-cmd="touch-mode-${v}"]`)?.setAttribute('aria-checked', String(v === mode));
  onChange(on);
}

export function setTouchMode(m: TouchMode): void { mode = m; apply(); }

/** One key on the keypad: its face, a tooltip, and what it does on an atom and on a bond. */
export interface PadKey { face: string; title: string; atom?: string; bond?: string; cmd?: string; cls?: string }

export const PAD_KEYS: PadKey[][] = [
  [
    ...['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'H'].map((el) => ({ face: el, title: `Make it ${el}`, atom: `label ${el}` })),
    { face: 'Me', title: 'Methyl', atom: 'label Me' },
    { face: 'Ph', title: 'Phenyl', atom: 'label Ph' },
    { face: 'OMe', title: 'Methoxy', atom: 'label OMe' },
    { face: 'R', title: 'R group', atom: 'label R' },
  ],
  [
    { face: '+', title: 'Charge +1', atom: 'atom plus' },
    { face: '−', title: 'Charge −1', atom: 'atom minus' },
    { face: '╱', title: 'Grow a bond (on a bond: make it single)', atom: 'atom bond', bond: 'bond single' },
    { face: '═', title: 'Double bond (on an atom: C=O)', atom: 'atom carbonyl', bond: 'bond double' },
    { face: '≡', title: 'Triple bond (on an atom: alkyne)', atom: 'atom alkyne', bond: 'bond triple' },
    { face: '◀', title: 'Wedge', atom: 'atom wedge', bond: 'bond wedge' },
    { face: '⋯', title: 'Hashed wedge', atom: 'atom hash-wedge', bond: 'bond hash-wedge' },
    { face: '⬡', title: 'Ring: cyclohexyl on an atom, fused ring on a bond', atom: 'atom cyclohexyl', bond: 'fuse 6' },
    { face: '⬠', title: 'Five-membered ring', atom: 'atom cyclopentyl', bond: 'fuse 5' },
    { face: '⌫', title: 'Clear the atom’s label, or delete the bond', atom: 'atom clear', bond: 'bond delete' },
    { face: '✎', title: 'Sketch: draw bonds, rings and letters freehand with the pen', cmd: 'tool-sketch', cls: 'pad-sketch' },
    { face: '↶', title: 'Undo', cmd: 'undo' },
    { face: '↷', title: 'Redo', cmd: 'redo' },
  ],
];

export interface TouchUiHost {
  /** Where the keypad goes (over the drawing). */
  canvasHost: HTMLElement;
  keypad(atom: string | null, bond: string | null): boolean;
  command(cmd: string): void;
  say(msg: string): void;
  /** Touch mode came on or went off (the keypad shows or hides with it). */
  changed?(on: boolean): void;
}

export function installTouchUi(h: TouchUiHost, initial: TouchMode): void {
  mode = initial;
  const pad = buildKeypad(h);
  h.canvasHost.append(pad);
  onChange = (on) => { pad.hidden = !on || pad.dataset.closed === '1'; h.changed?.(on); };

  // automatic: the first pen or finger turns it on
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || used) return;
    used = true;
    if (mode === 'auto') apply();
  }, true);

  installLongPress();
  installDoubleTap();
  apply();
}

function buildKeypad(h: TouchUiHost): HTMLElement {
  const pad = document.createElement('div');
  pad.className = 'atom-pad';
  pad.setAttribute('role', 'toolbar');
  pad.setAttribute('aria-label', 'Atom keypad');
  pad.hidden = true;
  for (const row of PAD_KEYS) {
    const r = document.createElement('div');
    r.className = 'pad-row';
    for (const k of row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = k.face;
      b.title = k.title;
      if (k.cls) b.classList.add(k.cls);
      if (k.cmd) b.dataset.padCmd = k.cmd;
      // the drawing keeps its highlight: a press on a key doesn't take the focus or the pointer
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (k.cmd) { h.command(k.cmd); return; }
        if (!h.keypad(k.atom ?? null, k.bond ?? null)) h.say('Draw or tap an atom or bond first, then press a key for it.');
      });
      r.append(b);
    }
    pad.append(r);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pad-close';
  close.textContent = '×';
  close.title = 'Hide the keypad (View > Atom Keypad shows it again)';
  close.addEventListener('click', () => { pad.dataset.closed = '1'; pad.hidden = true; });
  pad.append(close);
  return pad;
}

/** View > Atom Keypad: show the keypad again after it was hidden (touch mode only). */
export function showKeypad(show: boolean): void {
  const pad = document.querySelector<HTMLElement>('.atom-pad');
  if (!pad) return;
  pad.dataset.closed = show ? '' : '1';
  pad.hidden = !show || !touchOn();
}

export function keypadShowing(): boolean {
  const pad = document.querySelector<HTMLElement>('.atom-pad');
  return !!pad && !pad.hidden;
}

/** The keypad's Sketch key looks pressed while the sketch tool is picked. */
export function markSketch(on: boolean): void {
  document.querySelector('.atom-pad .pad-sketch')?.setAttribute('aria-pressed', String(on));
}

// ------------------------------------------------------------------ long press = right-click

function installLongPress(): void {
  let hold: { id: number; x: number; y: number; target: Element; timer: number } | null = null;
  // the press that opened a menu, until it lifts, and a moment after
  let swallowId: number | null = null, swallowUntil = 0;
  const end = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
  window.addEventListener('pointerdown', (e) => {
    end();
    if (e.pointerType === 'mouse' || !touchOn() || e.button !== 0 || !e.isPrimary) return;
    const target = e.target as Element;
    // typing places keep the system's own long press (select, paste, Scribble)
    if (isTyping(target)) return;
    const id = e.pointerId, x = e.clientX, y = e.clientY, pointerType = e.pointerType;
    hold = {
      id, x, y, target,
      timer: window.setTimeout(() => {
        hold = null;
        swallowId = id;
        // whatever the press started ends where it is (one that hadn't moved is forgotten)
        target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType, clientX: x, clientY: y, bubbles: true }));
        const under = document.elementFromPoint(x, y) ?? target;
        under.dispatchEvent(new MouseEvent('contextmenu', { clientX: x, clientY: y, button: 2, buttons: 0, bubbles: true, cancelable: true }));
      }, HOLD_MS),
    };
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (hold && hold.id === e.pointerId && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) end();
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (hold?.id === e.pointerId) end();
    if (swallowId === e.pointerId) { swallowId = null; swallowUntil = e.timeStamp + 400; }
  }, true);
  window.addEventListener('pointercancel', (e) => { if (e.isTrusted && hold?.id === e.pointerId) end(); }, true);
  // the lift after a long press isn't also a click on what was under it
  window.addEventListener('click', (e) => {
    if (swallowId === null && e.timeStamp > swallowUntil) return;
    swallowUntil = 0;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
}

// ------------------------------------------------------------------ double tap = double-click

function installDoubleTap(): void {
  let last: { t: number; x: number; y: number; target: Element } | null = null;
  let pending: number | null = null;
  // the browser sent its own: no need to make one
  window.addEventListener('dblclick', (e) => { if (e.isTrusted && pending !== null) { clearTimeout(pending); pending = null; } }, true);
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || !touchOn() || !e.isPrimary) return;
    const now = e.timeStamp, target = e.target as Element;
    if (last && now - last.t < DOUBLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_SLOP) {
      const x = e.clientX, y = e.clientY;
      last = null;
      // wait a moment for the browser's own double-click (Chrome sends one; Safari on iPad doesn't)
      pending = window.setTimeout(() => {
        pending = null;
        target.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, detail: 2, bubbles: true, cancelable: true }));
      }, 60);
      return;
    }
    last = { t: now, x: e.clientX, y: e.clientY, target };
  }, true);
}
