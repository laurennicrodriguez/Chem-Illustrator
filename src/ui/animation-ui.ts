// The Transitions and Animations tabs of the Slides ribbon, the Animation pane (in the right-hand
// panel) and the preview window.
//
// Transitions: pick how the slide comes in, the way it moves, how long it takes, and whether the
// show goes on by itself after a time. Animations: select something on the slide and pick an
// effect; each animation has its start (on a click, with or after the one before), its length
// and a delay, and the pane lists them in the order they play.

import type { Doc } from '../model';
import type { Deck } from '../deck/deck';
import type { Selection } from '../editor/editor';
import { selectionBox, POINTS } from '../editor/arrange';
import {
  TRANSITIONS, DIRS, SPEEDS, EFFECTS, SIDES, PATHS, DEFAULT_TRANSITION_DUR, EMPH_DEFAULTS, isEmphasis, newAnim, animName, slideParts, partOf, partName, targetOf, buildSteps,
  mainAnims, targetKey, presetPath, pathPoints, reversePath, pathThrough,
  type Anim, type AnimTarget, type Effect, type Part, type PathKind, type Transition, type TransitionKind,
} from '../deck/animation';
import type { View } from '../render/renderer';
import { Player } from '../deck/playback';
import { onImageReady } from '../render/images';

export interface AnimationHooks {
  /** The deck showing in Slides mode (null in other modes). */
  deck(): Deck | null;
  /** The slide being edited. */
  doc(): Doc;
  /** What is selected on the slide (a text box being typed in counts). */
  selection(): Selection;
  select(sel: Selection): void;
  finishTyping(): void;
  flash(msg: string, ms?: number): void;
  /** Draw the slide again (the numbers beside animated objects changed). */
  repaint(): void;
  /** The element the slide is drawn in (for drawing a custom path over it), and how the slide sits in it. */
  host(): HTMLElement;
  view(): View;
}

const svg = (body: string, size = 22) => `<svg viewBox="0 0 22 22" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const TRANSITION_ICONS: Record<TransitionKind, string> = {
  none: svg('<rect x="3" y="5" width="16" height="12" rx="1"/><path d="M5 15L17 7" opacity=".6"/>'),
  fade: svg('<rect x="3" y="5" width="10" height="9" rx="1" opacity=".35" fill="currentColor"/><rect x="9" y="8" width="10" height="9" rx="1" fill="currentColor" opacity=".8"/>'),
  push: svg('<rect x="2" y="6" width="8" height="10" rx="1" opacity=".5"/><rect x="11" y="6" width="9" height="10" rx="1" fill="currentColor" opacity=".8"/><path d="M8 3h7m-2-2l2 2-2 2"/>'),
  wipe: svg('<rect x="3" y="5" width="16" height="12" rx="1"/><path d="M11 5v12" stroke-width="2"/><rect x="11" y="5" width="8" height="12" fill="currentColor" opacity=".8"/>'),
  cover: svg('<rect x="2" y="5" width="13" height="12" rx="1" opacity=".5"/><rect x="8" y="5" width="12" height="12" rx="1" fill="currentColor" opacity=".8"/>'),
  morph: svg('<circle cx="7" cy="9" r="3.5" opacity=".45" fill="currentColor"/><rect x="11" y="9" width="8" height="8" rx="1" fill="currentColor" opacity=".85"/><path d="M9.5 7.5c3-3 6-2 7 1m0 0l.3-2.4M16.5 8.5l-2.3-.6"/>'),
};

const EFFECT_ICONS: Record<Effect, string> = {
  appear: svg('<path d="M11 3l2 5.5 5.5.5-4.2 3.6 1.4 5.4L11 15l-4.7 3 1.4-5.4L3.5 9l5.5-.5z" fill="currentColor"/>'),
  fade: svg('<path d="M11 3l2 5.5 5.5.5-4.2 3.6 1.4 5.4L11 15l-4.7 3 1.4-5.4L3.5 9l5.5-.5z" fill="currentColor" opacity=".45"/>'),
  wipe: svg('<path d="M11 3l2 5.5 5.5.5-4.2 3.6 1.4 5.4L11 15l-4.7 3 1.4-5.4L3.5 9l5.5-.5z"/><path d="M3 12h16v7H3z" fill="currentColor" stroke="none" opacity=".75"/>'),
  fly: svg('<path d="M13 3l1.6 4.5 4.4.4-3.4 2.9 1.1 4.3L13 12.7l-3.7 2.4 1.1-4.3L7 7.9l4.4-.4z" fill="currentColor"/><path d="M2 17h7M3 20h6M5 14h3"/>'),
  pulse: svg('<path d="M11 5l1.5 4 4 .4-3 2.6 1 4L11 13.8 7.5 16l1-4-3-2.6 4-.4z" fill="currentColor"/><path d="M11 1.5v1.5M3 11H1.5M20.5 11H19M4.5 4.5l1 1M17.5 4.5l-1 1"/>'),
  grow: svg('<path d="M11 6l1.2 3.2 3.3.3-2.5 2.2.8 3.3L11 13.2 8.2 15l.8-3.3-2.5-2.2 3.3-.3z" fill="currentColor"/><path d="M2 2h5M2 2v5M20 2h-5M20 2v5M2 20h5M2 20v-5M20 20h-5M20 20v-5"/>'),
  spin: svg('<path d="M11 6l1.2 3.2 3.3.3-2.5 2.2.8 3.3L11 13.2 8.2 15l.8-3.3-2.5-2.2 3.3-.3z" fill="currentColor"/><path d="M18.5 8A8 8 0 1 0 19 13m-.5-5l.4-3.2M18.5 8l-3.1-.6"/>'),
  transparency: svg('<path d="M11 3l2 5.5 5.5.5-4.2 3.6 1.4 5.4L11 15l-4.7 3 1.4-5.4L3.5 9l5.5-.5z" fill="currentColor" opacity=".25"/><path d="M11 3l2 5.5 5.5.5-4.2 3.6 1.4 5.4L11 15l-4.7 3 1.4-5.4L3.5 9l5.5-.5z"/>'),
  colour: svg('<path d="M11 3l2 5.5 5.5.5-4.2 3.6 1.4 5.4L11 15l-4.7 3 1.4-5.4L3.5 9l5.5-.5z" fill="currentColor"/><path d="M3 20h16" stroke-width="2.5" stroke="#e53935"/>'),
  path: svg('<path d="M4 17C7 4 15 18 18 5" stroke-dasharray="2 2"/><circle cx="4" cy="17" r="2" fill="#2e8b57" stroke="none"/><circle cx="18" cy="5" r="2" fill="#c0392b" stroke="none"/>'),
};

const ICONS = {
  preview: svg('<path d="M7 5l10 6-10 6z" fill="currentColor"/>'),
  pane: svg('<rect x="3" y="3" width="16" height="16" rx="1"/><path d="M12 3v16M14 7h3M14 10h3M14 13h3"/>'),
  painter: svg('<rect x="4" y="3" width="13" height="5" rx="1"/><path d="M17 5.5h2v5h-8v3"/><rect x="9.5" y="13.5" width="3" height="6" rx="1" fill="currentColor"/><path d="M2 12l1.5 1.5M2 16h2M5 19l1-1.5" stroke-width="1.1"/>'),
  click: svg('<path d="M7 3l9 7-4 1 2.5 5-2 1-2.5-5L7 15z"/>', 14),
  after: svg('<circle cx="11" cy="11" r="7"/><path d="M11 6v5l3 2"/>', 14),
};

const ENTRANCE = '#2e8b57', EXIT = '#c0392b', EMPHASIS = '#c99700', PATH = '#5b6b84';
const effectColour = (a: Anim) => (a.effect === 'path' ? PATH : isEmphasis(a.effect) ? EMPHASIS : a.exit ? EXIT : ENTRANCE);

/**
 * The parts of the slide the selection touches. A selection of highlighted atoms and bonds only
 * (as Select Highlight, or clicking a highlight in the Animation pane, makes) is their
 * highlights, not the whole structure, so a highlight can be animated on its own.
 */
function selectedParts(parts: Part[], sel: Selection): Part[] {
  const hl = parts.filter((p) => p.kind === 'highlight');
  const onlyLit = (sel.atoms.size || sel.bonds.size) && !sel.captions.size && !sel.arrows.size && !sel.shapes.size
    && [...sel.atoms].every((id) => hl.some((p) => p.sel.atoms.has(id))) && [...sel.bonds].every((id) => hl.some((p) => p.sel.bonds.has(id)));
  if (onlyLit) {
    const lit = hl.filter((p) => [...sel.bonds].some((id) => p.sel.bonds.has(id)) || [...sel.atoms].some((id) => p.sel.atoms.has(id)));
    // a whole structure selected is the structure, even when all of it is highlighted (unless
    // its highlight was picked as such)
    const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((x) => b.has(x));
    const picked = highlightPick && same(highlightPick.atoms, sel.atoms) && same(highlightPick.bonds, sel.bonds);
    const whole = parts.some((p) => p.kind === 'drawing' && p.sel.atoms.size && [...p.sel.atoms].every((id) => sel.atoms.has(id)));
    if (lit.length && (picked || !whole)) return lit;
  }
  const hit = (p: Part) => p.kind !== 'highlight' && (
    [...sel.atoms].some((id) => p.sel.atoms.has(id)) || [...sel.captions].some((id) => p.sel.captions.has(id))
    || [...sel.arrows].some((id) => p.sel.arrows.has(id)) || [...sel.shapes].some((id) => p.sel.shapes.has(id)));
  return parts.filter(hit);
}

/** The highlight last picked as an object (Select Highlight, or the Animation pane's list): its atoms and bonds. */
let highlightPick: Selection | null = null;

/** Remember that this selection is a highlight picked as an object (to animate it rather than its structure). */
export function pickHighlight(sel: Selection): void { highlightPick = sel; }

export class AnimationUI {
  /** The animation picked in the pane (its place in the slide's list), or null. */
  private picked: number | null = null;
  private paneOn = false;
  private list: HTMLDivElement;
  private paneKey = '';
  private kinds = new Map<TransitionKind, HTMLButtonElement>();
  private effectBtns: HTMLButtonElement[] = [];
  private $ = <T extends HTMLElement>(s: string) => this.ribbon.querySelector<T>(s)!;

  constructor(private ribbon: HTMLElement, private section: HTMLElement, private hooks: AnimationHooks) {
    for (const el of ribbon.querySelectorAll<HTMLElement>('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon as keyof typeof ICONS] ?? '';
    // tabs
    for (const b of ribbon.querySelectorAll<HTMLButtonElement>('[data-sl-tab]')) b.addEventListener('click', () => this.showTab(b.dataset.slTab!));
    // transitions
    const kinds = this.$('#tr-kinds');
    for (const t of TRANSITIONS) {
      const b = document.createElement('button');
      b.className = 'rb-big';
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.title = t.id === 'none' ? 'No transition: the slide just appears' : `${t.name}: ${t.id === 'fade' ? 'the new slide fades in over the old one' : t.id === 'push' ? 'the new slide pushes the old one off' : t.id === 'wipe' ? 'the new slide is uncovered across the old one' : t.id === 'morph' ? 'things on both slides glide, grow and shrink to their new places; the rest fade (give the next slide the same title, structures, shapes or pictures, moved or resized)' : 'the new slide slides in over the old one'}`;
      b.innerHTML = `<span class="rb-icon">${TRANSITION_ICONS[t.id]}</span>${t.name}`;
      b.addEventListener('click', () => this.setTransition({ kind: t.id, ...(t.dirs ? { dir: this.transition()?.dir ?? 'left' } : {}) }));
      this.kinds.set(t.id, b);
      kinds.append(b);
    }
    const dirSel = this.$<HTMLSelectElement>('#tr-dir');
    for (const d of DIRS) dirSel.add(new Option(d.name, d.id));
    dirSel.addEventListener('change', () => this.setTransition({ dir: dirSel.value as Transition['dir'] }));
    const fillSpeeds = (sel: HTMLSelectElement) => {
      for (const s of SPEEDS) sel.add(new Option(`${s.name} (${s.dur} s)`, String(s.dur)));
      sel.add(new Option('Your own', 'own'));
    };
    const trSpeed = this.$<HTMLSelectElement>('#tr-speed');
    fillSpeeds(trSpeed);
    trSpeed.addEventListener('change', () => { if (trSpeed.value !== 'own') this.setTransition({ dur: Number(trSpeed.value) }); });
    const trDur = this.$<HTMLInputElement>('#tr-dur');
    trDur.addEventListener('change', () => { const v = Number(trDur.value); if (v > 0) this.setTransition({ dur: v }); else this.refresh(); });
    const afterOn = this.$<HTMLInputElement>('#tr-after-on'), after = this.$<HTMLInputElement>('#tr-after');
    afterOn.addEventListener('change', () => this.setTransition({ advanceAfter: afterOn.checked ? Number(after.value) || 5 : undefined }));
    after.addEventListener('change', () => { const v = Number(after.value); this.setTransition({ advanceAfter: v >= 0 ? v : undefined }); });
    ribbon.querySelector('[data-tr="apply-all"]')!.addEventListener('click', () => {
      const deck = hooks.deck();
      if (!deck) return;
      deck.setTransition(this.transition(), deck.slides.map((_, i) => i), 'Apply transition to all slides');
      hooks.flash(`Every slide now has this slide's transition.`);
    });
    ribbon.querySelector('[data-tr="preview"]')!.addEventListener('click', () => this.preview());
    // animations
    const effects = this.$('#an-effects');
    const gallery = document.createElement('div');
    gallery.className = 'an-gallery';
    const EMPH_TIPS: Record<string, string> = {
      pulse: 'the selected objects swell a little and back, to draw the eye',
      grow: 'the selected objects grow (or shrink) and stay that size; set the size in Effect Options',
      spin: 'the selected objects turn round; set how far in Effect Options',
      transparency: 'the selected objects become see-through and stay so; set how much in Effect Options',
      colour: 'a shape\'s fill, or text\'s colour, changes (a structure or picture is coloured all over); pick the colour in Effect Options. PowerPoint can\'t recolour a structure or picture',
    };
    for (const exit of [false, true, null]) {
      for (const e of EFFECTS) {
        // entrance and exit effects, then emphasis (null) in a row of its own
        if ((exit === null) !== !!e.emph) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'an-effect';
        const name = animName(newAnim({ kind: 'shape', id: 0 }, e.id, !!exit));
        b.innerHTML = `<span style="color: ${exit === null ? EMPHASIS : exit ? EXIT : ENTRANCE}">${EFFECT_ICONS[e.id]}</span>${name}`;
        b.title = exit === null ? `${name} (emphasis): ${EMPH_TIPS[e.id]}` : `${name}: ${exit ? 'the selected objects go' : 'the selected objects come in'}${e.id === 'appear' ? ' at once' : e.id === 'fade' ? ' by fading' : e.id === 'wipe' ? ', uncovered from one side' : exit ? ' off the slide' : ' from off the slide'}`;
        b.dataset.effect = e.id;
        b.dataset.exit = String(!!exit);
        b.addEventListener('click', () => this.applyEffect(e.id, !!exit));
        this.effectBtns.push(b);
        gallery.append(b);
      }
      if (exit !== null) gallery.append(document.createElement('span'));
    }
    effects.append(gallery);
    const from = this.$<HTMLSelectElement>('#an-from');
    for (const sd of SIDES) from.add(new Option(sd.name, sd.id));
    from.addEventListener('change', () => this.changePicked({ from: from.value as Anim['from'] }, 'Effect options'));
    // emphasis settings: how big, how far round, how see-through, what colour
    const amount = this.$<HTMLInputElement>('#an-amount');
    amount.addEventListener('change', () => {
      const v = Number(amount.value);
      const a = this.anims()[this.current()[0]];
      if (!a || !Number.isFinite(v)) { this.refresh(); return; }
      if (a.effect === 'grow' && v > 0) this.changePicked({ scale: v / 100 }, 'Grow/Shrink size');
      else if (a.effect === 'spin') this.changePicked({ turn: v }, 'Spin amount');
      else if (a.effect === 'transparency' && v >= 0 && v <= 100) this.changePicked({ opacity: v / 100 }, 'Transparency amount');
      else this.refresh();
    });
    const colour = this.$<HTMLInputElement>('#an-colour');
    colour.addEventListener('change', () => this.changePicked({ color: colour.value }, 'Colour Change colour'));
    const start = this.$<HTMLSelectElement>('#an-start');
    start.addEventListener('change', () => this.changePicked({ start: start.value as Anim['start'] }, 'Animation start'));
    const anSpeed = this.$<HTMLSelectElement>('#an-speed');
    fillSpeeds(anSpeed);
    anSpeed.addEventListener('change', () => { if (anSpeed.value !== 'own') this.changePicked({ dur: Number(anSpeed.value) }, 'Animation speed'); });
    const anDur = this.$<HTMLInputElement>('#an-dur');
    anDur.addEventListener('change', () => { const v = Number(anDur.value); if (v >= 0) this.changePicked({ dur: v }, 'Animation duration'); else this.refresh(); });
    const delay = this.$<HTMLInputElement>('#an-delay');
    delay.addEventListener('change', () => { const v = Number(delay.value); if (v >= 0) this.changePicked({ delay: v }, 'Animation delay'); else this.refresh(); });
    // motion paths
    const pathSel = this.$<HTMLSelectElement>('#an-path');
    for (const p of PATHS) {
      const o = new Option(p.name, p.id);
      o.title = `The selected objects move ${p.tip}`;
      pathSel.add(o);
    }
    pathSel.addEventListener('change', () => { const k = pathSel.value as PathKind; if (k) this.applyPath(k); });
    ribbon.querySelector('[data-an="reverse-path"]')!.addEventListener('click', () => {
      const a = this.anims()[this.current()[0]];
      if (a?.effect === 'path') this.changePicked({ path: reversePath(a.path ?? 'M 0 0 E') }, 'Reverse path direction');
    });
    // by paragraph, and triggers
    const seq = this.$<HTMLSelectElement>('#an-seq');
    seq.addEventListener('change', () => this.changePicked({ byPara: seq.value === 'para' ? true : undefined }, seq.value === 'para' ? 'Animate by paragraph' : 'Animate as one object'));
    const trig = this.$<HTMLSelectElement>('#an-trigger');
    trig.addEventListener('change', () => {
      const t = this.triggerChoices.get(trig.value);
      this.changePicked({ trigger: t ? { ...t } : undefined }, t ? 'Trigger' : 'Remove trigger');
    });
    // the Animation Painter: one click paints once, a double-click keeps painting
    const painter = ribbon.querySelector<HTMLButtonElement>('[data-an="painter"]')!;
    let clickWait = 0;
    painter.addEventListener('click', () => {
      clearTimeout(clickWait);
      if (this.painter) { this.stopPainter(); return; }
      clickWait = window.setTimeout(() => this.startPainter(false), 220);
    });
    painter.addEventListener('dblclick', () => { clearTimeout(clickWait); this.startPainter(true); });
    ribbon.querySelector('[data-an="remove"]')!.addEventListener('click', () => this.removePicked());
    ribbon.querySelector('[data-an="earlier"]')!.addEventListener('click', () => this.move(-1));
    ribbon.querySelector('[data-an="later"]')!.addEventListener('click', () => this.move(1));
    ribbon.querySelector('[data-an="pane"]')!.addEventListener('click', () => this.showPane(!this.paneOn));
    ribbon.querySelector('[data-an="preview"]')!.addEventListener('click', () => this.preview(false));
    // the pane
    const h = document.createElement('h2');
    h.textContent = 'Animation Pane';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'an-close';
    close.textContent = '×';
    close.title = 'Close the Animation pane';
    close.setAttribute('aria-label', 'Close the Animation pane');
    close.addEventListener('click', () => this.showPane(false));
    h.append(close);
    const bar = document.createElement('div');
    bar.className = 'an-bar';
    const play = document.createElement('button');
    play.type = 'button';
    play.innerHTML = `${svg('<path d="M7 5l10 6-10 6z" fill="currentColor"/>', 12)} Play All`;
    play.title = 'Play this slide\'s animations';
    play.addEventListener('click', () => this.preview(false));
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '▲';
    up.title = 'Play the selected animation earlier';
    up.addEventListener('click', () => this.move(-1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '▼';
    down.title = 'Play the selected animation later';
    down.addEventListener('click', () => this.move(1));
    bar.append(play, up, down);
    this.list = document.createElement('div');
    this.list.className = 'an-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Animations on this slide');
    this.list.tabIndex = 0;
    this.list.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.removePicked(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const n = this.anims().length;
        if (!n) return;
        this.pick(Math.max(0, Math.min(n - 1, (this.picked ?? -1) + (e.key === 'ArrowUp' ? -1 : 1))));
      }
    });
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = 'Numbers are clicks. Drag a row, or use ▲ ▼, to change the order.';
    // the slide's highlights, to pick one as an object (it is part of its structure on the slide)
    this.highlights = document.createElement('div');
    this.highlights.className = 'an-highlights';
    section.replaceChildren(h, bar, this.list, this.highlights, note);
  }

  private highlights!: HTMLDivElement;
  /** The objects a trigger can be (the slide's parts), by key, as the Trigger list offers them. */
  private triggerChoices = new Map<string, AnimTarget>();
  /** The Animation Painter's animations (copied from an object), and whether it keeps painting. */
  private painter: { anims: Anim[]; from: Part; sticky: boolean } | null = null;
  private painterKeys = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.painter) { e.preventDefault(); e.stopPropagation(); this.stopPainter(); } };

  /** Pick up the selected object's animations, to give to the next object clicked. */
  private startPainter(sticky: boolean): void {
    const doc = this.hooks.doc();
    const parts = slideParts(doc);
    const chosen = selectedParts(parts, this.hooks.selection());
    const from = chosen[0];
    const anims = from ? this.anims().filter((a) => partOf(parts, a.target) === from) : [];
    if (!from || !anims.length) { this.hooks.flash('Select an object that has animations first, then click Animation Painter.'); return; }
    this.painter = { anims: anims.map((a) => structuredClone(a)), from, sticky };
    this.ribbon.querySelector('[data-an="painter"]')?.setAttribute('aria-pressed', 'true');
    window.addEventListener('keydown', this.painterKeys, true);
    this.hooks.flash(sticky ? 'Animation Painter: click each object to give it these animations; Esc when done.' : 'Animation Painter: click an object to give it these animations.');
  }

  private stopPainter(): void {
    this.painter = null;
    this.ribbon.querySelector('[data-an="painter"]')?.setAttribute('aria-pressed', 'false');
    window.removeEventListener('keydown', this.painterKeys, true);
  }

  /** Give the objects now selected the painter's animations (in place of their own). True when it painted. */
  private paint(): boolean {
    const pt = this.painter;
    if (!pt) return false;
    const doc = this.hooks.doc();
    const parts = slideParts(doc);
    const to = selectedParts(parts, this.hooks.selection()).filter((p) => p !== pt.from);
    if (!to.length) return false;
    const kept = this.anims().filter((a) => !to.includes(partOf(parts, a.target)!));
    const added = to.flatMap((p, k) => pt.anims.map((a, j) => {
      const t = targetOf(p);
      const copy: Anim = { ...structuredClone(a), target: t, ...(k && !j ? { start: 'with' as const } : {}) };
      if (t.kind !== 'caption') delete copy.byPara;
      return copy;
    }));
    this.setAnims([...kept, ...added], 'Animation Painter');
    if (!pt.sticky) this.stopPainter();
    return true;
  }

  /** Give the selected objects a motion path (or change the path of the animation picked). */
  applyPath(kind: PathKind): void {
    if (kind === 'custom') { this.drawPath(); return; }
    this.addOrChange('path', { pathKind: kind, path: presetPath(kind, this.hooks.deck()?.size ?? { w: 960, h: 540 }) });
  }

  /** Click out a path on the slide (double-click or Enter to finish, Esc to stop), for the selected objects. */
  private drawPath(): void {
    const doc = this.hooks.doc();
    if (!selectedParts(slideParts(doc), this.hooks.selection()).length && this.picked === null) {
      this.hooks.flash('Select an object on the slide first, then pick Custom Path and click out its path.');
      this.refresh();
      return;
    }
    const host = this.hooks.host();
    const over = document.createElement('div');
    over.className = 'an-path-draw';
    over.tabIndex = -1;
    const ns = 'http://www.w3.org/2000/svg';
    const pic = document.createElementNS(ns, 'svg');
    const line = document.createElementNS(ns, 'polyline');
    pic.append(line);
    over.append(pic);
    host.append(over);
    over.focus();
    this.hooks.flash('Custom path: click each point it goes through; double-click (or Enter) to finish, Esc to stop.', 8000);
    const pts: { x: number; y: number }[] = [];
    let hover: { x: number; y: number } | null = null;
    const toSlide = (e: MouseEvent) => {
      const r = host.getBoundingClientRect(), v = this.hooks.view();
      return { x: (e.clientX - r.left - v.ox) / v.scale, y: (e.clientY - r.top - v.oy) / v.scale };
    };
    const show = () => {
      const v = this.hooks.view();
      line.setAttribute('points', [...pts, ...(hover ? [hover] : [])].map((p) => `${p.x * v.scale + v.ox},${p.y * v.scale + v.oy}`).join(' '));
    };
    const done = (keep: boolean) => {
      over.remove();
      if (keep && pts.length > 1) this.addOrChange('path', { pathKind: 'custom', path: pathThrough(pts, this.hooks.deck()?.size ?? { w: 960, h: 540 }) });
      else this.refresh();
    };
    over.addEventListener('pointermove', (e) => { hover = toSlide(e); show(); });
    over.addEventListener('click', (e) => { pts.push(toSlide(e)); show(); });
    over.addEventListener('dblclick', (e) => { e.preventDefault(); done(true); });
    over.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); done(true); }
    });
  }

  /** The animation picked (or the selected objects') becomes `effect` with these settings, else the selected objects get it. */
  private addOrChange(effect: Effect, extra: Partial<Anim>): void {
    const doc = this.hooks.doc();
    const parts = slideParts(doc);
    let anims = this.anims().map((a) => ({ ...a }));
    const chosen = selectedParts(parts, this.hooks.selection());
    const picked = this.picked !== null ? anims[this.picked] : undefined;
    const pickedPart = picked ? partOf(parts, picked.target) : undefined;
    if (picked && picked.effect === effect && (!chosen.length || (pickedPart && chosen.length === 1 && chosen[0] === pickedPart))) {
      anims[this.picked!] = { ...picked, ...extra };
      this.setAnims(anims, `${animName(anims[this.picked!])}`);
      return;
    }
    if (!chosen.length) { this.hooks.flash('Select a picture, text box, shape or structure on the slide first, then pick a path.'); this.refresh(); return; }
    const added = chosen.map((p, k) => ({ ...newAnim(targetOf(p), effect), ...extra, ...(k ? { start: 'with' as const } : {}) }));
    anims = [...anims, ...added];
    this.picked = anims.length - added.length;
    this.setAnims(anims, `${animName(added[0])} animation`);
  }

  /** The slide's highlights as buttons: one selects that highlight, ready for an effect. */
  private refreshHighlights(): void {
    const doc = this.hooks.doc();
    const hl = slideParts(doc).filter((p) => p.kind === 'highlight');
    if (!hl.length) { this.highlights.replaceChildren(); return; }
    const head = document.createElement('div');
    head.className = 'muted small';
    head.textContent = 'Highlights (pick one, then an effect):';
    this.highlights.replaceChildren(head, ...hl.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'an-hl';
      const x = p.sel.atoms.size ? doc.atoms.get(Math.min(...p.sel.atoms)) : doc.bonds.get(Math.min(...p.sel.bonds));
      const dot = document.createElement('span');
      dot.className = 'tb-look-dot';
      dot.style.background = x?.highlight ?? '#ccc';
      b.append(dot, partName(doc, p));
      b.title = 'Select this highlight on its own, to animate it as a shape';
      b.addEventListener('click', () => this.selectHighlight(p.sel));
      return b;
    }));
  }

  /** Select a highlight as an object of its own (Select Highlight, or the pane's list). */
  selectHighlight(sel: Selection): void {
    const pick: Selection = { atoms: new Set(sel.atoms), bonds: new Set(sel.bonds), captions: new Set(), arrows: new Set(), shapes: new Set() };
    pickHighlight(pick);
    this.picked = null;
    this.hooks.select(pick);
    this.paneKey = '';
    this.refresh();
  }

  // ---------------------------------------------------------------- state

  private slideIndex(): number { return this.hooks.deck()?.index ?? 0; }
  private transition(): Transition | undefined { return this.hooks.deck()?.current?.transition; }
  private anims(): Anim[] { return this.hooks.deck()?.current?.anims ?? []; }

  /** The ribbon tab showing ('home', 'transitions' or 'animations'). */
  tab = 'home';

  showTab(name: string): void {
    this.tab = name;
    for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>('[data-sl-tab]')) b.setAttribute('aria-selected', String(b.dataset.slTab === name));
    for (const p of this.ribbon.querySelectorAll<HTMLElement>('[data-sl-panel]')) p.hidden = p.dataset.slPanel !== name;
    this.refresh();
    this.hooks.repaint();
  }

  get paneShown(): boolean { return this.paneOn; }

  showPane(on: boolean): void {
    this.paneOn = on;
    this.ribbon.querySelector('[data-an="pane"]')?.setAttribute('aria-pressed', String(on));
    document.querySelector('[data-cmd="animation-pane"]')?.setAttribute('aria-checked', String(on));
    this.update();
    this.hooks.repaint();
  }

  /** Show or hide everything for the mode (only Slides mode has transitions and animations). */
  update(): void {
    this.section.hidden = !(this.hooks.deck() && this.paneOn);
    this.paneKey = '';
    this.refresh();
  }

  /** Whether the slide shows numbers beside its animated objects (the Animations tab or the pane is open). */
  get showsMarkers(): boolean {
    return !!this.hooks.deck() && (this.tab === 'animations' || this.paneOn);
  }

  /** The slide changed (another slide, or an undo): the pane's pick no longer means anything. */
  slideChanged(): void {
    this.picked = null;
    this.paneKey = '';
    this.refresh();
  }

  /** Bring the ribbon and pane up to date (cheap to call every frame). */
  refresh(): void {
    const deck = this.hooks.deck();
    if (!deck?.current) return;
    if (this.tab === 'transitions') this.showTransition();
    if (this.tab === 'animations') this.showAnimation();
    this.refreshPane();
  }

  private showTransition(): void {
    const t = this.transition();
    const kind = t?.kind ?? 'none';
    for (const [k, b] of this.kinds) b.setAttribute('aria-pressed', String(k === kind));
    const dirs = TRANSITIONS.find((x) => x.id === kind)?.dirs ?? false;
    const dirSel = this.$<HTMLSelectElement>('#tr-dir');
    dirSel.disabled = !dirs;
    dirSel.value = t?.dir ?? 'left';
    const dur = t?.dur ?? DEFAULT_TRANSITION_DUR;
    this.showSpeed('#tr-speed', '#tr-dur', dur, kind === 'none');
    const afterOn = this.$<HTMLInputElement>('#tr-after-on'), after = this.$<HTMLInputElement>('#tr-after');
    afterOn.checked = !!t?.advanceAfter;
    if (document.activeElement !== after) after.value = String(t?.advanceAfter ?? 5);
  }

  private showSpeed(selId: string, inputId: string, dur: number, disabled: boolean): void {
    const sel = this.$<HTMLSelectElement>(selId), input = this.$<HTMLInputElement>(inputId);
    const named = SPEEDS.find((s) => Math.abs(s.dur - dur) < 1e-6);
    sel.value = named ? String(named.dur) : 'own';
    sel.disabled = disabled;
    input.disabled = disabled;
    if (document.activeElement !== input) input.value = String(+dur.toFixed(3));
  }

  /** The animations the ribbon's settings change: the one picked in the pane, else those of the selected objects. */
  private current(): number[] {
    const anims = this.anims();
    if (this.picked !== null && this.picked < anims.length) return [this.picked];
    const doc = this.hooks.doc();
    const parts = slideParts(doc);
    const chosen = selectedParts(parts, this.hooks.selection());
    if (!chosen.length) return [];
    return anims.map((a, i) => (chosen.includes(partOf(parts, a.target)!) ? i : -1)).filter((i) => i >= 0);
  }

  private showAnimation(): void {
    const anims = this.anims();
    const cur = this.current();
    const a = cur.length ? anims[cur[0]] : null;
    for (const b of this.effectBtns) b.setAttribute('aria-pressed', String(!!a && cur.length === 1 && a.effect === b.dataset.effect && !!a.exit === (b.dataset.exit === 'true')));
    const from = this.$<HTMLSelectElement>('#an-from');
    from.disabled = !a || !(a.effect === 'wipe' || a.effect === 'fly');
    from.value = a?.from ?? 'bottom';
    const amount = this.$<HTMLInputElement>('#an-amount'), unit = this.$<HTMLElement>('#an-amount-unit'), amountBox = this.$<HTMLElement>('#an-amount-box');
    const colour = this.$<HTMLInputElement>('#an-colour'), colourBox = this.$<HTMLElement>('#an-colour-box');
    const amt = a?.effect === 'grow' ? { v: Math.round((a.scale ?? EMPH_DEFAULTS.scale) * 100), u: '% size', tip: 'The size it grows or shrinks to: 150 is half as big again, 50 half the size' }
      : a?.effect === 'spin' ? { v: a.turn ?? EMPH_DEFAULTS.turn, u: '°', tip: 'How far it turns, in degrees (negative turns anticlockwise)' }
        : a?.effect === 'transparency' ? { v: Math.round((a.opacity ?? EMPH_DEFAULTS.opacity) * 100), u: '% clear', tip: 'How see-through it becomes: 0 solid, 100 gone' } : null;
    amountBox.style.display = amt ? '' : 'none';
    if (amt) {
      amountBox.title = amt.tip;
      unit.textContent = amt.u;
      if (document.activeElement !== amount) amount.value = String(amt.v);
    }
    colourBox.style.display = a?.effect === 'colour' ? '' : 'none';
    if (a?.effect === 'colour' && document.activeElement !== colour) colour.value = a.color ?? EMPH_DEFAULTS.color;
    (from.closest('label') ?? from).style.display = a && isEmphasis(a.effect) ? 'none' : '';
    const start = this.$<HTMLSelectElement>('#an-start');
    start.disabled = !a;
    start.value = a?.start ?? 'click';
    this.showSpeed('#an-speed', '#an-dur', a?.dur ?? 0.5, !a || a.effect === 'appear');
    const delay = this.$<HTMLInputElement>('#an-delay');
    delay.disabled = !a;
    if (document.activeElement !== delay) delay.value = String(a?.delay ?? 0);
    for (const k of ['remove', 'earlier', 'later']) (this.ribbon.querySelector(`[data-an="${k}"]`) as HTMLButtonElement).disabled = !a;
    // motion path, paragraphs, trigger
    const pathSel = this.$<HTMLSelectElement>('#an-path');
    if (document.activeElement !== pathSel) pathSel.value = a?.effect === 'path' ? a.pathKind ?? 'custom' : '';
    (this.ribbon.querySelector('[data-an="reverse-path"]') as HTMLButtonElement).disabled = a?.effect !== 'path';
    const seq = this.$<HTMLSelectElement>('#an-seq');
    seq.disabled = !a || a.target.kind !== 'caption';
    seq.value = a?.byPara ? 'para' : 'one';
    const trig = this.$<HTMLSelectElement>('#an-trigger');
    const doc = this.hooks.doc();
    const parts = slideParts(doc).filter((p) => p.kind !== 'highlight');
    const names = parts.map((p) => ({ key: targetKey(targetOf(p)), t: targetOf(p), name: partName(doc, p) }));
    const sig = names.map((n) => n.key + n.name).join('|');
    if (trig.dataset.sig !== sig) {
      trig.dataset.sig = sig;
      this.triggerChoices = new Map(names.map((n) => [n.key, n.t]));
      trig.replaceChildren(new Option('On Click Sequence', ''), ...names.map((n) => new Option(`On Click of ${n.name}`, n.key)));
    }
    trig.disabled = !a;
    const tp = a?.trigger ? partOf(parts, a.trigger) : undefined;
    trig.value = tp ? targetKey(targetOf(tp)) : '';
  }

  // ---------------------------------------------------------------- changes

  private setTransition(change: Partial<Transition>): void {
    const deck = this.hooks.deck();
    if (!deck) return;
    const was = this.transition() ?? { kind: 'none' as TransitionKind, dur: DEFAULT_TRANSITION_DUR };
    const next: Transition = { ...was, ...change };
    if (!TRANSITIONS.find((t) => t.id === next.kind)?.dirs) delete next.dir;
    else next.dir ??= 'left';
    if (next.advanceAfter === undefined) delete next.advanceAfter;
    deck.setTransition(next);
    this.refresh();
  }

  private setAnims(anims: Anim[], label: string): void {
    this.hooks.deck()?.setAnims(anims, label);
    this.paneKey = '';
    this.refresh();
    this.hooks.repaint();
  }

  /** Give the selected objects an effect (or change the animation picked in the pane). */
  applyEffect(effect: Effect, exit: boolean): void {
    if (effect === 'path') { this.applyPath('down'); return; }
    const doc = this.hooks.doc();
    const parts = slideParts(doc);
    let anims = this.anims().map((a) => ({ ...a }));
    // the animation picked in the pane, when it belongs to the selection (or nothing is selected), changes
    const chosen = selectedParts(parts, this.hooks.selection());
    const picked = this.picked !== null ? anims[this.picked] : undefined;
    const pickedPart = picked ? partOf(parts, picked.target) : undefined;
    if (picked && (!chosen.length || (pickedPart && chosen.length === 1 && chosen[0] === pickedPart))) {
      const fresh = newAnim(picked.target, effect, exit);
      anims[this.picked!] = { ...fresh, start: picked.start, delay: picked.delay, dur: effect === 'appear' ? 0 : picked.dur || fresh.dur, ...(fresh.from ? { from: picked.from ?? fresh.from } : {}) };
      this.setAnims(anims, `${animName(anims[this.picked!])} animation`);
      return;
    }
    if (!chosen.length) {
      this.hooks.flash('Select a picture, text box, shape or structure on the slide first, then pick an effect.');
      return;
    }
    // several objects at once: the first on a click, the rest with it
    const added = chosen.map((p, k) => ({ ...newAnim(targetOf(p), effect, exit), ...(k ? { start: 'with' as const } : {}) }));
    anims = [...anims, ...added];
    this.picked = anims.length - added.length;
    this.setAnims(anims, `${animName(added[0])} animation`);
  }

  private changePicked(change: Partial<Anim>, label: string): void {
    const cur = this.current();
    if (!cur.length) return;
    const anims = this.anims().map((a, i) => (cur.includes(i) ? { ...a, ...change } : a));
    this.setAnims(anims, label);
  }

  /** Take off the animation picked in the pane, else those of the selected objects. */
  removePicked(): void {
    const cur = this.current();
    if (!cur.length) return;
    const anims = this.anims().filter((_, i) => !cur.includes(i));
    this.picked = anims.length ? Math.min(cur[0], anims.length - 1) : null;
    this.setAnims(anims, cur.length > 1 ? 'Remove animations' : 'Remove animation');
  }

  private move(by: number): void {
    const cur = this.current();
    if (cur.length !== 1) return;
    this.moveTo(cur[0], cur[0] + by);
  }

  private moveTo(from: number, to: number): void {
    const anims = this.anims().slice();
    if (to < 0 || to >= anims.length || to === from) return;
    const [a] = anims.splice(from, 1);
    anims.splice(to, 0, a);
    this.picked = to;
    this.setAnims(anims, 'Reorder animations');
  }

  private pick(i: number): void {
    this.picked = i;
    const a = this.anims()[i];
    const doc = this.hooks.doc();
    const part = a ? partOf(slideParts(doc), a.target) : undefined;
    if (part?.kind === 'highlight') pickHighlight(part.sel);
    if (part) this.hooks.select(part.sel);
    this.paneKey = '';
    this.refresh();
  }

  /** Forget the pane's pick when something else is selected on the slide. */
  selectionChanged(): void {
    if (this.painter && this.paint()) return;
    if (this.picked === null) { this.refresh(); return; }
    const a = this.anims()[this.picked];
    const sel = this.hooks.selection();
    const doc = this.hooks.doc();
    const part = a ? partOf(slideParts(doc), a.target) : undefined;
    const empty = !sel.atoms.size && !sel.captions.size && !sel.arrows.size && !sel.shapes.size;
    if (!part || (!empty && !selectedParts([part], sel).length)) { this.picked = null; this.paneKey = ''; }
    this.refresh();
  }

  // ---------------------------------------------------------------- the pane

  private refreshPane(): void {
    if (this.section.hidden) return;
    const anims = this.anims();
    const doc = this.hooks.doc();
    const cur = this.current();
    const key = `${this.slideIndex()}|${doc.version}|${JSON.stringify(anims)}|${cur.join(',')}`;
    if (key === this.paneKey) return;
    this.paneKey = key;
    this.refreshHighlights();
    if (!anims.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No animations on this slide. Select something on the slide, then pick an effect in the Animations tab.';
      this.list.replaceChildren(p);
      return;
    }
    const parts = slideParts(doc);
    const steps = buildSteps(mainAnims(anims));
    const mainIndex = anims.map((a, i) => (a.trigger ? -1 : i)).filter((i) => i >= 0);
    const clickOf = new Map<number, number>();
    let n = 0;
    for (const st of steps) {
      if (!st.auto) n++;
      for (const it of st.items) clickOf.set(mainIndex[it.index], st.auto ? 0 : n);
    }
    this.list.replaceChildren(...anims.map((a, i) => {
      const part = partOf(parts, a.target);
      const row = document.createElement('div');
      row.className = 'an-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(cur.includes(i)));
      row.classList.toggle('picked', cur.includes(i));
      row.classList.toggle('gone', !part);
      row.draggable = true;
      const num = document.createElement('span');
      num.className = 'an-num';
      num.textContent = a.trigger ? '⚡' : a.start === 'click' ? String(clickOf.get(i)) : '';
      if (a.trigger) num.title = `Trigger: plays when ${partName(doc, partOf(parts, a.trigger))} is clicked in the show`;
      const when = document.createElement('span');
      when.className = 'an-when';
      when.innerHTML = a.start === 'click' ? ICONS.click : a.start === 'after' ? ICONS.after : '';
      when.title = a.start === 'click' ? 'On Click' : a.start === 'after' ? 'After Previous' : 'With Previous';
      const icon = document.createElement('span');
      icon.className = 'an-icon';
      icon.style.color = effectColour(a);
      icon.innerHTML = EFFECT_ICONS[a.effect].replace(/width="22" height="22"/, 'width="16" height="16"');
      const name = document.createElement('span');
      name.className = 'an-name';
      name.textContent = partName(doc, part) + (a.byPara ? ' (by paragraph)' : '');
      name.title = `${animName(a)}${a.trigger ? `, when ${partName(doc, partOf(parts, a.trigger))} is clicked` : ''}${a.effect !== 'appear' ? `, ${a.dur} s` : ''}${a.delay ? `, after a ${a.delay} s delay` : ''}${part ? '' : '. Its object has been deleted: this animation is left out when saving'}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'an-del';
      del.textContent = '×';
      del.title = 'Remove this animation';
      del.setAttribute('aria-label', 'Remove this animation');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.picked = i;
        this.removePicked();
      });
      row.append(num, when, icon, name, del);
      row.addEventListener('click', () => this.pick(i));
      row.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/x-anim', String(i)); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-anim')) { e.preventDefault(); row.classList.add('drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop');
        const from = Number(e.dataTransfer?.getData('text/x-anim'));
        if (Number.isFinite(from)) this.moveTo(from, i);
      });
      return row;
    }));
  }

  // ---------------------------------------------------------------- numbers beside animated objects

  /** Small numbered tags at the top left of each animated object (on screen only), as PowerPoint shows them. */
  drawMarkers(ctx: CanvasRenderingContext2D, scale: number): void {
    if (!this.showsMarkers) return;
    const anims = this.anims();
    if (!anims.length) return;
    const doc = this.hooks.doc();
    const parts = slideParts(doc);
    const steps = buildSteps(mainAnims(anims));
    const labels = new Map<Part, string[]>();
    let n = 0;
    for (const st of steps) {
      if (!st.auto) n++;
      for (const it of st.items) {
        const p = partOf(parts, it.anim.target);
        if (!p) continue;
        const l = labels.get(p) ?? [];
        const s = String(st.auto ? 0 : n);
        if (!l.includes(s)) l.push(s);
        labels.set(p, l);
      }
    }
    for (const a of anims) {
      const p = a.trigger ? partOf(parts, a.target) : undefined;
      if (!p) continue;
      const l = labels.get(p) ?? [];
      if (!l.includes('⚡')) l.push('⚡');
      labels.set(p, l);
    }
    const k = 1 / scale;
    // motion paths, from the middle of what moves: dotted, green where they start and red where they end
    const size = this.hooks.deck()?.size ?? { w: 960, h: 540 };
    const held = new Map<Part, { x: number; y: number }>();
    ctx.save();
    for (const a of anims) {
      if (a.effect !== 'path') continue;
      const p = partOf(parts, a.target);
      const b = p && selectionBox(doc, p.sel, POINTS);
      if (!p || !b) continue;
      const o = held.get(p) ?? { x: 0, y: 0 };
      const cx = (b.x1 + b.x2) / 2 + o.x, cy = (b.y1 + b.y2) / 2 + o.y;
      const pts = pathPoints(a.path ?? 'M 0 0 E').map((q) => ({ x: cx + q.x * size.w, y: cy + q.y * size.h }));
      const end = pts[pts.length - 1];
      held.set(p, { x: end.x - (b.x1 + b.x2) / 2, y: end.y - (b.y1 + b.y2) / 2 });
      const picked = this.current().includes(anims.indexOf(a));
      ctx.lineWidth = (picked ? 2 : 1.2) * k;
      ctx.strokeStyle = picked ? '#2f6fdf' : '#5b6b84';
      ctx.setLineDash([4 * k, 3 * k]);
      ctx.beginPath();
      pts.forEach((q, j) => (j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [q, col] of [[pts[0], ENTRANCE], [end, EXIT]] as const) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.5 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.save();
    ctx.font = `${11 * k}px system-ui, sans-serif`;
    for (const [p, l] of labels) {
      const b = selectionBox(doc, p.sel, POINTS);
      if (!b) continue;
      const text = l.join(', ');
      const w = ctx.measureText(text).width + 8 * k, h = 15 * k;
      const x = b.x1 - w - 3 * k, y = b.y1;
      ctx.fillStyle = '#ffffffee';
      ctx.strokeStyle = '#7a7f87';
      ctx.lineWidth = k;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#30343a';
      ctx.fillText(text, x + 4 * k, y + 11 * k);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- preview

  /** Play the slide in a small window: its transition (from the slide before) and then its animations, click by click. */
  preview(withTransition = true): void {
    const deck = this.hooks.deck();
    if (!deck?.current) return;
    this.hooks.finishTyping();
    const i = deck.index;
    const d = document.createElement('dialog');
    d.className = 'ask an-preview';
    const h = document.createElement('h2');
    h.textContent = `Preview: slide ${i + 1}`;
    const canvas = document.createElement('canvas');
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = 'Each click plays as it would in the slide show, one after another.';
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'Play Again';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.className = 'primary';
    buttons.append(again, close);
    d.append(h, canvas, note, buttons);
    document.body.append(d);
    const w = Math.min(720, window.innerWidth - 80), ht = w * deck.size.h / deck.size.w;
    const player = new Player(canvas, deck, '#30343a');
    let wait = 0;
    const clickOn = () => {
      clearTimeout(wait);
      if (player.busy || player.done >= player.stepCount) return;
      wait = window.setTimeout(() => player.next(), 700);
    };
    player.onChange = clickOn;
    player.onIdle = clickOn;
    player.onPastEnd = () => {};
    player.resize(w, ht, window.devicePixelRatio || 1);
    const play = () => {
      clearTimeout(wait);
      if (withTransition && i > 0) player.show(i - 1, { atEnd: true });
      player.show(i, { transition: withTransition });
    };
    const unwatch = onImageReady(() => { if (!player.busy) player.refresh(); });
    again.addEventListener('click', play);
    close.addEventListener('click', () => d.close());
    d.addEventListener('close', () => { clearTimeout(wait); player.stop(); unwatch(); d.remove(); });
    d.showModal();
    play();
  }
}
