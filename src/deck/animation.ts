// Slide transitions and animations, as in PowerPoint but only the calm, basic ones:
// transitions Fade, Push, Wipe, Cover and Morph; animations Appear, Fade, Wipe and Fly In (and the
// same four going out), and the emphasis effects Pulse, Grow/Shrink, Spin, Transparency and
// Colour Change, which act on something already showing and leave it changed. Each has its own
// speed (how long it takes) and delay, and an animation starts on a click, with the one before
// it, or after the one before it.
//
// What moves is one of the parts a slide is saved to PowerPoint as (see splitSlide): a title or
// text box, a picture, a shape, a table, or a structure or scheme with everything round it. So an
// animation on a reagent written above an arrow moves the whole scheme, in the app and in
// PowerPoint alike.
//
// Both are saved in the PowerPoint file as PowerPoint's own transitions and animations, so they
// play there too, and they are read back from PowerPoint files (other kinds come in as Fade).

import type { Doc } from '../model';
import type { Selection } from '../editor/editor';
import { splitSlide } from '../io/pptx-write';
import { plainText } from '../richtext';

// ---------------------------------------------------------------- transitions

/** Which way a transition moves: the new slide comes in travelling this way (left: in from the right). */
export type Dir = 'left' | 'right' | 'up' | 'down';

/** Morph: things on both slides move, grow and shrink from where they were to where they are now; the rest fade. */
export type TransitionKind = 'none' | 'fade' | 'push' | 'wipe' | 'cover' | 'morph';

export interface Transition {
  kind: TransitionKind;
  /** Push, Wipe and Cover: the way the new slide travels. */
  dir?: Dir;
  /** How long it takes, in seconds. */
  dur: number;
  /** Go on to the next slide by itself after this many seconds (as well as on a click). */
  advanceAfter?: number;
}

export const TRANSITIONS: { id: TransitionKind; name: string; dirs: boolean }[] = [
  { id: 'none', name: 'None', dirs: false },
  { id: 'fade', name: 'Fade', dirs: false },
  { id: 'push', name: 'Push', dirs: true },
  { id: 'wipe', name: 'Wipe', dirs: true },
  { id: 'cover', name: 'Cover', dirs: true },
  { id: 'morph', name: 'Morph', dirs: false },
];

/** The directions, named as PowerPoint's Effect Options name them (by where the new slide comes from). */
export const DIRS: { id: Dir; name: string }[] = [
  { id: 'left', name: 'From Right' },
  { id: 'right', name: 'From Left' },
  { id: 'up', name: 'From Bottom' },
  { id: 'down', name: 'From Top' },
];

/** Speeds offered by name; any other number of seconds can be typed. */
export const SPEEDS: { name: string; dur: number }[] = [
  { name: 'Very fast', dur: 0.25 },
  { name: 'Fast', dur: 0.5 },
  { name: 'Medium', dur: 1 },
  { name: 'Slow', dur: 2 },
  { name: 'Very slow', dur: 3 },
];

export const DEFAULT_TRANSITION_DUR = 0.7;

// ---------------------------------------------------------------- animations

export type Effect = 'appear' | 'fade' | 'wipe' | 'fly' | Emphasis;
/** Effects that change something already showing (PowerPoint's Emphasis effects). */
export type Emphasis = 'pulse' | 'grow' | 'spin' | 'transparency' | 'colour';
export type Side = 'left' | 'right' | 'top' | 'bottom';

export const EFFECTS: { id: Effect; name: string; sides: boolean; emph?: boolean }[] = [
  { id: 'appear', name: 'Appear', sides: false },
  { id: 'fade', name: 'Fade', sides: false },
  { id: 'wipe', name: 'Wipe', sides: true },
  { id: 'fly', name: 'Fly', sides: true },
  { id: 'pulse', name: 'Pulse', sides: false, emph: true },
  { id: 'grow', name: 'Grow/Shrink', sides: false, emph: true },
  { id: 'spin', name: 'Spin', sides: false, emph: true },
  { id: 'transparency', name: 'Transparency', sides: false, emph: true },
  { id: 'colour', name: 'Colour Change', sides: false, emph: true },
];

export const isEmphasis = (e: Effect): e is Emphasis => e === 'pulse' || e === 'grow' || e === 'spin' || e === 'transparency' || e === 'colour';

/** What an emphasis effect does when its settings aren't given: half as big again, a whole turn, half see-through, red. */
export const EMPH_DEFAULTS = { scale: 1.5, turn: 360, opacity: 0.5, color: '#e53935' };

export const SIDES: { id: Side; name: string }[] = [
  { id: 'bottom', name: 'From Bottom' },
  { id: 'left', name: 'From Left' },
  { id: 'right', name: 'From Right' },
  { id: 'top', name: 'From Top' },
];

/**
 * What an animation moves: any object of the part (a structure is named by one of its atoms). A
 * highlight is named by one of its atoms (or, with `bond`, one of its bonds when it has no atoms).
 */
export interface AnimTarget { kind: 'caption' | 'shape' | 'atom' | 'arrow' | 'highlight'; id: number; bond?: boolean }

export interface Anim {
  target: AnimTarget;
  effect: Effect;
  /** Going out (the object disappears) rather than coming in. */
  exit?: boolean;
  /** Wipe and Fly: the side it comes in from (or goes out to). */
  from?: Side;
  /** On a click, with the animation before it, or after the one before it has finished. */
  start: 'click' | 'with' | 'after';
  /** How long it takes, in seconds (Appear takes none). */
  dur: number;
  /** Seconds to wait before it starts. */
  delay: number;
  /** Grow/Shrink: the size it ends at, as a multiple (1.5 grows by half, 0.5 shrinks to half). */
  scale?: number;
  /** Spin: degrees it turns, clockwise (negative: anticlockwise). */
  turn?: number;
  /** Transparency: how see-through it ends, 0 (solid) to 1 (gone). */
  opacity?: number;
  /** Colour Change: the colour it ends (a shape's fill, text's colour, a structure's lines and labels). */
  color?: string;
}

export const DEFAULT_ANIM_DUR = 0.5;

/** A new animation on a target: on a click, half a second, as PowerPoint starts one. */
export function newAnim(target: AnimTarget, effect: Effect, exit = false): Anim {
  if (isEmphasis(effect)) {
    // PowerPoint's own lengths: a quick pulse, two seconds for the rest
    const extra = effect === 'grow' ? { scale: EMPH_DEFAULTS.scale } : effect === 'spin' ? { turn: EMPH_DEFAULTS.turn } : effect === 'transparency' ? { opacity: EMPH_DEFAULTS.opacity } : effect === 'colour' ? { color: EMPH_DEFAULTS.color } : {};
    return { target, effect, start: 'click', dur: effect === 'pulse' ? DEFAULT_ANIM_DUR : 2, delay: 0, ...extra };
  }
  return { target, effect, ...(exit ? { exit } : {}), ...(effect === 'wipe' || effect === 'fly' ? { from: 'bottom' as Side } : {}), start: 'click', dur: effect === 'appear' ? 0 : DEFAULT_ANIM_DUR, delay: 0 };
}

export function animName(a: Anim): string {
  const e = EFFECTS.find((x) => x.id === a.effect)!.name;
  if (isEmphasis(a.effect)) return e;
  if (a.exit) return a.effect === 'appear' ? 'Disappear' : a.effect === 'fly' ? 'Fly Out' : `${e} Out`;
  return a.effect === 'fly' ? 'Fly In' : e;
}

// ---------------------------------------------------------------- what moves

/** One thing on a slide that moves as a whole (and is one shape or picture in PowerPoint). */
export interface Part {
  kind: 'text' | 'picture' | 'shape' | 'table' | 'connector' | 'drawing' | 'highlight';
  /** A highlight: its highlighted atoms and bonds (its structure is a part of its own). */
  sel: Selection;
}

const sel = (p: Partial<Selection>): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set(), ...p });

/**
 * A slide's parts, back to front, as they are saved for PowerPoint. Each highlight on a structure
 * (each joined run of atoms and bonds of one colour and look) is a part too, just behind its
 * structure, so it can be animated on its own, as a shape can.
 */
export function slideParts(doc: Doc): Part[] {
  const p = splitSlide(doc);
  return [
    ...p.pictures.map((s): Part => ({ kind: 'picture', sel: sel({ shapes: new Set([s.id]) }) })),
    ...p.shapes.map((s): Part => ({ kind: 'shape', sel: sel({ shapes: new Set([s.id]) }) })),
    ...p.connectors.map((r): Part => ({ kind: 'connector', sel: sel({ arrows: new Set([r.id]) }) })),
    ...p.diagrams.map((g): Part => ({ kind: 'shape', sel: sel({ shapes: new Set([g.frame.id, ...g.shapes.map((x) => x.id)]), arrows: new Set(g.connectors.map((x) => x.id)) }) })),
    ...p.tables.map((s): Part => ({ kind: 'table', sel: sel({ shapes: new Set([s.id]) }) })),
    ...p.drawings.flatMap((s): Part[] => [...highlightParts(doc, s), { kind: 'drawing', sel: s }]),
    ...p.texts.map((c): Part => ({ kind: 'text', sel: sel({ captions: new Set([c.id]) }) })),
  ];
}

/** The highlights in part of a drawing: each run of highlighted atoms and bonds, joined by highlighted bonds, of one colour and look. */
export function highlightParts(doc: Doc, within: Selection): Part[] {
  const look = (x: { highlight?: string; hl?: object }) => (x.highlight ? x.highlight + JSON.stringify(x.hl ?? {}) : null);
  const parent = new Map<string, string>();
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(k, r); return r; };
  const node = (k: string) => { if (!parent.has(k)) parent.set(k, k); return k; };
  const join = (a: string, b: string) => { parent.set(find(node(a)), find(node(b))); };
  for (const id of within.atoms) { const a = doc.atoms.get(id); if (a && look(a)) node(`a${id}`); }
  for (const id of within.bonds) {
    const b = doc.bonds.get(id);
    const k = b && look(b);
    if (!b || !k) continue;
    node(`b${id}`);
    // a bond joins its atoms when they have its look; else bonds of one look meet at the atom
    for (const end of [b.a1, b.a2]) {
      const a = doc.atoms.get(end);
      join(`b${id}`, a && look(a) === k ? `a${end}` : `e${end}|${k}`);
    }
  }
  const groups = new Map<string, Part>();
  for (const k of parent.keys()) {
    if (k[0] === 'e') continue;
    const r = find(k);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = { kind: 'highlight', sel: sel({}) }));
    (k[0] === 'a' ? g.sel.atoms : g.sel.bonds).add(Number(k.slice(1)));
  }
  return [...groups.values()];
}

export function partHolds(part: Part, t: AnimTarget): boolean {
  const s = part.sel;
  if ((t.kind === 'highlight') !== (part.kind === 'highlight')) return false;
  if (t.kind === 'highlight') return t.bond ? s.bonds.has(t.id) : s.atoms.has(t.id);
  return t.kind === 'atom' ? s.atoms.has(t.id) : t.kind === 'caption' ? s.captions.has(t.id) : t.kind === 'shape' ? s.shapes.has(t.id) : s.arrows.has(t.id);
}

/** The part an animation moves (none when its object has been deleted). */
export function partOf(parts: Part[], t: AnimTarget): Part | undefined {
  return parts.find((p) => partHolds(p, t));
}

/** The structure a highlight is on. */
export function hostOf(parts: Part[], h: Part): Part | undefined {
  return parts.find((p) => p.kind === 'drawing' && ([...h.sel.bonds].some((id) => p.sel.bonds.has(id)) || [...h.sel.atoms].some((id) => p.sel.atoms.has(id))));
}

/** The target that names a part: a structure by its first atom, else its text, shape or arrow. */
export function targetOf(part: Part): AnimTarget {
  const first = (s: Set<number>) => Math.min(...s);
  const s = part.sel;
  if (part.kind === 'highlight') return s.atoms.size ? { kind: 'highlight', id: first(s.atoms) } : { kind: 'highlight', id: first(s.bonds), bond: true };
  if (s.atoms.size) return { kind: 'atom', id: first(s.atoms) };
  if (s.captions.size && part.kind === 'text') return { kind: 'caption', id: first(s.captions) };
  if (s.shapes.size) return { kind: 'shape', id: first(s.shapes) };
  if (s.arrows.size) return { kind: 'arrow', id: first(s.arrows) };
  return { kind: 'caption', id: first(s.captions) };
}

/** The part's name in the Animation pane: "Title: Route to taxol", "Structure", "Picture"… */
export function partName(doc: Doc, part: Part | undefined): string {
  if (!part) return '(deleted)';
  const s = part.sel;
  switch (part.kind) {
    case 'text': {
      const c = doc.captions.get(Math.min(...s.captions));
      const words = c ? plainText(c.runs).replace(/\s+/g, ' ').trim() : '';
      const what = c?.ph === 'title' ? 'Title' : c?.ph === 'subtitle' ? 'Subtitle' : c?.ph ? 'Text' : 'Text box';
      return words ? `${what}: ${words.length > 28 ? words.slice(0, 27) + '…' : words}` : what;
    }
    case 'picture': return 'Picture';
    case 'table': return 'Table';
    case 'connector': return 'Connector';
    case 'shape': {
      const sh = doc.shapes.get(Math.min(...s.shapes));
      const words = sh?.text ? plainText(sh.text.runs).trim() : '';
      return words ? `Shape: ${words.length > 24 ? words.slice(0, 23) + '…' : words}` : 'Shape';
    }
    case 'highlight': {
      const x = s.atoms.size ? doc.atoms.get(Math.min(...s.atoms)) : doc.bonds.get(Math.min(...s.bonds));
      return `Highlight${x?.highlight ? ` (${colourName(x.highlight)})` : ''}`;
    }
    case 'drawing': return s.arrows.size ? 'Scheme' : s.atoms.size > 0 && countFragments(doc, s) > 1 ? 'Structures' : s.atoms.size ? 'Structure' : 'Drawing';
  }
}

/** A colour as a word when it is near one, else as written (#9ED9A8). */
function colourName(hex: string): string {
  const v = parseInt(hex.replace('#', ''), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const names: [string, number, number, number][] = [['yellow', 255, 230, 128], ['green', 158, 217, 168], ['blue', 169, 200, 255], ['pink', 242, 167, 195], ['orange', 246, 179, 138], ['teal', 26, 163, 163], ['red', 230, 80, 80], ['purple', 180, 140, 220], ['grey', 190, 190, 190]];
  let best = '', d = Infinity;
  for (const [n, R, G, B] of names) { const e = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (e < d) { d = e; best = n; } }
  return d < 2500 ? best : hex.toUpperCase();
}

function countFragments(doc: Doc, s: Selection): number {
  let n = 0;
  for (const f of doc.fragments()) if ([...f].some((id) => s.atoms.has(id))) n++;
  return n;
}

// ---------------------------------------------------------------- timing

/** An animation placed in time within its click: when it starts and ends, in seconds from the click. */
export interface Timed { anim: Anim; index: number; start: number; end: number; group: number }

/**
 * The clicks of a slide's animations, in order: each click starts the animations up to the next
 * one that waits for a click. When the first animation doesn't wait for a click, the first group
 * plays by itself as the slide comes in (`auto`).
 */
export interface Step { items: Timed[]; length: number; auto: boolean }

export function buildSteps(anims: Anim[]): Step[] {
  const steps: Step[] = [];
  let cur: Step | null = null;
  let groupStart = 0, maxEnd = 0, group = 0;
  anims.forEach((anim, index) => {
    if (!cur || anim.start === 'click') {
      cur = { items: [], length: 0, auto: !cur && anim.start !== 'click' };
      steps.push(cur);
      groupStart = 0; maxEnd = 0; group = 0;
    }
    let start: number;
    if (!cur.items.length) start = anim.delay;
    else if (anim.start === 'with') start = groupStart + anim.delay;
    else if (anim.start === 'after') { groupStart = maxEnd; group++; start = groupStart + anim.delay; }
    else start = anim.delay;
    const dur = anim.effect === 'appear' ? 0 : Math.max(0, anim.dur);
    const end = start + dur;
    cur.items.push({ anim, index, start, end, group });
    maxEnd = Math.max(maxEnd, end);
    cur.length = Math.max(cur.length, end);
  });
  return steps;
}

/**
 * How far along each animated part is, after `done` whole clicks and `t` seconds into the next
 * (t < 0: the next click hasn't happened). For each part: visible or not, and, while an effect
 * is running, which one and how far through (0 to 1).
 */
export interface PartState { visible: boolean; running?: { anim: Anim; p: number }; emph?: Emph }

/**
 * What emphasis effects have done to a part so far: its size (a multiple), its turn in degrees,
 * how solid it is (0 to 1), and a colour it is changing to (`mix` of the way; `was` the colour it
 * had changed to before, if any).
 */
export interface Emph { scale: number; rot: number; alpha: number; color?: string; mix: number; was?: string }

export const NO_EMPH: Emph = { scale: 1, rot: 0, alpha: 1, mix: 0 };

/** An emphasis effect `p` of the way through (1: finished, as it stays), from what came before. */
export function emphAt(held: Emph, a: Anim, p: number): Emph {
  switch (a.effect) {
    case 'pulse': return { ...held, scale: held.scale * (1 + 0.1 * Math.sin(Math.PI * p)) };
    case 'grow': return { ...held, scale: held.scale * (1 + ((a.scale ?? EMPH_DEFAULTS.scale) - 1) * p) };
    case 'spin': return { ...held, rot: held.rot + (a.turn ?? EMPH_DEFAULTS.turn) * p };
    case 'transparency': return { ...held, alpha: held.alpha + (1 - (a.opacity ?? EMPH_DEFAULTS.opacity) - held.alpha) * p };
    case 'colour': {
      const was = held.mix >= 1 ? held.color : held.was;
      return { ...held, color: a.color ?? EMPH_DEFAULTS.color, mix: p, ...(was ? { was } : {}) };
    }
    default: return held;
  }
}

export function partStates(parts: Part[], anims: Anim[], done: number, t: number): Map<Part, PartState> {
  const steps = buildSteps(anims);
  const out = new Map<Part, PartState>();
  // before anything plays, parts that first come in are hidden (emphasis leaves them showing)
  const firstOf = new Map<Part, Anim>();
  for (const a of anims) {
    if (isEmphasis(a.effect)) continue;
    const p = partOf(parts, a.target);
    if (p && !firstOf.has(p)) firstOf.set(p, a);
  }
  for (const [p, a] of firstOf) out.set(p, { visible: !!a.exit });
  const emph = new Map<Part, Emph>();
  const apply = (it: Timed, at: number) => {
    const p = partOf(parts, it.anim.target);
    if (!p || at < it.start) return;
    if (isEmphasis(it.anim.effect)) {
      const held = emph.get(p) ?? NO_EMPH;
      const prog = at >= it.end ? 1 : Math.max(0, Math.min(1, (at - it.start) / Math.max(1e-6, it.end - it.start)));
      emph.set(p, emphAt(held, it.anim, prog));
      return;
    }
    if (at >= it.end && !(it.end === it.start && at === it.start && it.anim.effect !== 'appear')) {
      out.set(p, { visible: !it.anim.exit });
    } else {
      const span = Math.max(1e-6, it.end - it.start);
      out.set(p, { visible: true, running: { anim: it.anim, p: Math.max(0, Math.min(1, (at - it.start) / span)) } });
    }
  };
  steps.forEach((st, k) => {
    if (k < done) for (const it of st.items) apply(it, Infinity);
    else if (k === done && t >= 0) for (const it of [...st.items].sort((a, b) => a.start - b.start)) apply(it, t);
  });
  for (const [p, e] of emph) out.set(p, { ...(out.get(p) ?? { visible: true }), emph: e });
  return out;
}

/** Number of clicks the slide's animations need (an automatic first group needs none). */
export function clickCount(anims: Anim[]): number {
  return buildSteps(anims).filter((s) => !s.auto).length;
}

// ---------------------------------------------------------------- PowerPoint: transitions

const P_DIR: Record<Dir, string> = { left: 'l', right: 'r', up: 'u', down: 'd' };
const DIR_P: Record<string, Dir> = { l: 'left', r: 'right', u: 'up', d: 'down' };
const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const NS_P159 = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';

/** A slide's transition as PowerPoint writes it: its own duration for PowerPoint 2010 and later, a named speed for older ones. */
export function transitionXml(t: Transition | undefined): string {
  if (!t || (t.kind === 'none' && !t.advanceAfter)) return '';
  const spd = t.dur <= 0.5 ? 'fast' : t.dur <= 0.75 ? 'med' : 'slow';
  const adv = t.advanceAfter ? ` advTm="${Math.round(t.advanceAfter * 1000)}"` : '';
  if (t.kind === 'morph') {
    // PowerPoint 2019 and 365 morph; older ones fade
    return `<mc:AlternateContent xmlns:mc="${NS_MC}"><mc:Choice xmlns:p159="${NS_P159}" xmlns:p14="${NS_P14}" Requires="p159">` +
      `<p:transition spd="${spd}" p14:dur="${Math.round(t.dur * 1000)}"${adv}><p159:morph option="byObject"/></p:transition></mc:Choice>` +
      `<mc:Fallback><p:transition spd="${spd}"${adv}><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
  }
  const body = t.kind === 'none' ? '' : t.kind === 'fade' ? '<p:fade/>' : `<p:${t.kind} dir="${P_DIR[t.dir ?? 'left']}"/>`;
  return `<mc:AlternateContent xmlns:mc="${NS_MC}"><mc:Choice xmlns:p14="${NS_P14}" Requires="p14">` +
    `<p:transition spd="${spd}" p14:dur="${Math.round(t.dur * 1000)}"${adv}>${body}</p:transition></mc:Choice>` +
    `<mc:Fallback><p:transition spd="${spd}"${adv}>${body}</p:transition></mc:Fallback></mc:AlternateContent>`;
}

/** A slide's transition from a PowerPoint file (other kinds of transition come in as Fade). */
export function readTransition(sld: Element, warn: (s: string) => void): Transition | undefined {
  const all = Array.from(sld.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'transition'));
  const el = all[0];
  if (!el) return undefined;
  const ms = el.getAttributeNS(NS_P14, 'dur') ?? el.getAttribute('p14:dur');
  const spd = el.getAttribute('spd') ?? 'fast';
  const dur = ms ? Number(ms) / 1000 : spd === 'slow' ? 1 : spd === 'med' ? 0.75 : 0.5;
  const adv = el.getAttribute('advTm');
  const kid = Array.from(el.children).find((k) => k.localName !== 'sndAc' && k.localName !== 'extLst');
  let kind: TransitionKind = 'none';
  let dir: Dir | undefined;
  if (kid) {
    if (kid.localName === 'fade') kind = 'fade';
    else if (kid.localName === 'morph') kind = 'morph';
    else if (kid.localName === 'push' || kid.localName === 'wipe' || kid.localName === 'cover') {
      kind = kid.localName;
      dir = DIR_P[kid.getAttribute('dir') ?? 'l'] ?? 'left';
    } else {
      kind = 'fade';
      warn('Slide transitions other than Fade, Push, Wipe, Cover and Morph came in as Fade.');
    }
  }
  return { kind, ...(dir ? { dir } : {}), dur: +dur.toFixed(3), ...(adv ? { advanceAfter: Number(adv) / 1000 } : {}) };
}

// ---------------------------------------------------------------- PowerPoint: animations

const PRESET: Record<Effect, number> = { appear: 1, fly: 2, fade: 10, wipe: 22, pulse: 26, grow: 6, spin: 8, transparency: 9, colour: 1 };
/** Colour Change on text is PowerPoint's Font Color (on anything else, its Fill Color). */
const PRESET_FONT_COLOR = 3;
const SUBTYPE: Record<Side, number> = { top: 1, right: 2, bottom: 4, left: 8 };
const SUBTYPE_SIDE: Record<number, Side> = { 1: 'top', 2: 'right', 4: 'bottom', 8: 'left' };
/** Wipe's filter: it reveals moving away from the side it starts at. */
const WIPE_FILTER: Record<Side, string> = { bottom: 'wipe(up)', left: 'wipe(right)', right: 'wipe(left)', top: 'wipe(down)' };

/**
 * A slide's animations as PowerPoint's timing tree: a sequence of clicks, each holding groups that
 * start one after another, each holding effects that start together (with their own delays).
 * `spidsOf` gives the PowerPoint shapes each animation moves (a table can be three: its title,
 * the table and its footnotes); animations of objects that weren't saved are left out.
 */
export function timingXml(anims: Anim[], spidsOf: (a: Anim) => number[]): string {
  const live = anims.filter((a) => spidsOf(a).length);
  if (!live.length) return '';
  let id = 3;
  const ms = (s: number) => Math.max(0, Math.round(s * 1000));
  const steps = buildSteps(live);
  const target = (spid: number) => `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
  const visibility = (spid: number, val: 'visible' | 'hidden', at: number) =>
    `<p:set><p:cBhvr><p:cTn id="${id++}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${at}"/></p:stCondLst></p:cTn>${target(spid)}` +
    `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
  const bhvr = (spid: number, d: number, attr?: string, extra = '') =>
    `<p:cBhvr${extra}><p:cTn id="${id++}" dur="${d}" fill="hold"/>${target(spid)}${attr ? `<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst>` : ''}</p:cBhvr>`;
  const emphasis = (a: Anim, spid: number): string => {
    const d = Math.max(1, ms(a.dur));
    switch (a.effect) {
      case 'pulse': return `<p:animScale><p:cBhvr><p:cTn id="${id++}" dur="${Math.max(1, Math.round(d / 2))}" autoRev="1" fill="hold"/>${target(spid)}</p:cBhvr><p:by x="110000" y="110000"/></p:animScale>`;
      case 'grow': {
        const k = Math.round((a.scale ?? EMPH_DEFAULTS.scale) * 100000);
        return `<p:animScale>${bhvr(spid, d)}<p:by x="${k}" y="${k}"/></p:animScale>`;
      }
      case 'spin': return `<p:animRot by="${Math.round((a.turn ?? EMPH_DEFAULTS.turn) * 60000)}">${bhvr(spid, d, 'r')}</p:animRot>`;
      case 'transparency': {
        const v = +(1 - (a.opacity ?? EMPH_DEFAULTS.opacity)).toFixed(3);
        return `<p:set>${bhvr(spid, d, 'style.opacity')}<p:to><p:strVal val="${v}"/></p:to></p:set>` +
          `<p:animEffect filter="image" prLst="opacity: ${v}">${bhvr(spid, d, undefined, ' rctx="IE"')}</p:animEffect>`;
      }
      case 'colour': {
        const c = (a.color ?? EMPH_DEFAULTS.color).replace('#', '').toUpperCase();
        if (a.target.kind === 'caption') return `<p:animClr clrSpc="rgb" dir="cw">${bhvr(spid, d, 'style.color')}<p:to><a:srgbClr val="${c}"/></p:to></p:animClr>`;
        return `<p:animClr clrSpc="rgb" dir="cw">${bhvr(spid, d, 'fillcolor')}<p:to><a:srgbClr val="${c}"/></p:to></p:animClr>` +
          `<p:set>${bhvr(spid, d, 'fill.type')}<p:to><p:strVal val="solid"/></p:to></p:set>` +
          `<p:set>${bhvr(spid, d, 'fill.on')}<p:to><p:strVal val="true"/></p:to></p:set>`;
      }
      default: return '';
    }
  };
  const behaviours = (a: Anim, spid: number): string => {
    if (isEmphasis(a.effect)) return emphasis(a, spid);
    const d = ms(a.dur);
    const out = !!a.exit;
    const parts: string[] = [];
    if (!out) parts.push(visibility(spid, 'visible', 0));
    if (a.effect === 'fade' || a.effect === 'wipe') {
      const filter = a.effect === 'fade' ? 'fade' : WIPE_FILTER[a.from ?? 'bottom'];
      parts.push(`<p:animEffect transition="${out ? 'out' : 'in'}" filter="${filter}"><p:cBhvr><p:cTn id="${id++}" dur="${d}"/>${target(spid)}</p:cBhvr></p:animEffect>`);
    } else if (a.effect === 'fly') {
      const side = a.from ?? 'bottom';
      const away = side === 'left' ? ['0-#ppt_w/2', '#ppt_y'] : side === 'right' ? ['1+#ppt_w/2', '#ppt_y'] : side === 'top' ? ['#ppt_x', '0-#ppt_h/2'] : ['#ppt_x', '1+#ppt_h/2'];
      const home = ['#ppt_x', '#ppt_y'];
      const [from, to] = out ? [home, away] : [away, home];
      ['ppt_x', 'ppt_y'].forEach((attr, k) => {
        parts.push(`<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${id++}" dur="${d}" fill="hold"/>${target(spid)}` +
          `<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>` +
          `<p:tav tm="0"><p:val><p:strVal val="${from[k]}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to[k]}"/></p:val></p:tav></p:tavLst></p:anim>`);
      });
    }
    if (out) parts.push(visibility(spid, 'hidden', a.effect === 'appear' ? 0 : Math.max(0, d - 1)));
    return parts.join('');
  };
  const clicks = steps.map((st) => {
    const groups = new Map<number, Timed[]>();
    for (const it of st.items) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
    const cond = st.auto ? `<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>` : '<p:cond delay="indefinite"/>';
    const inner = [...groups.values()].map((items) => {
      const g0 = Math.min(...items.map((it) => it.start - it.anim.delay));
      const effects = items.map((it, j) => {
        const a = it.anim;
        const first = j === 0 && it.group === 0 ? (st.auto ? (a.start === 'after' ? 'afterEffect' : 'withEffect') : 'clickEffect') : a.start === 'after' ? 'afterEffect' : a.start === 'with' ? 'withEffect' : 'clickEffect';
        const sub = (a.effect === 'wipe' || a.effect === 'fly') ? SUBTYPE[a.from ?? 'bottom'] : 0;
        // more shapes than one: the others move with the first
        const preset = a.effect === 'colour' && a.target.kind === 'caption' ? PRESET_FONT_COLOR : PRESET[a.effect];
        const cls = isEmphasis(a.effect) ? 'emph' : a.exit ? 'exit' : 'entr';
        return spidsOf(a).map((spid, k) => `<p:par><p:cTn id="${id++}" presetID="${preset}" presetClass="${cls}" presetSubtype="${sub}" fill="hold" grpId="0" nodeType="${k ? 'withEffect' : first}">` +
          `<p:stCondLst><p:cond delay="${ms(it.start - g0)}"/></p:stCondLst><p:childTnLst>${behaviours(a, spid)}</p:childTnLst></p:cTn></p:par>`).join('');
      }).join('');
      return `<p:par><p:cTn id="${id++}" fill="hold"><p:stCondLst><p:cond delay="${ms(g0)}"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>`;
    }).join('');
    return `<p:par><p:cTn id="${id++}" fill="hold"><p:stCondLst>${cond}</p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
  }).join('');
  const spids = [...new Set(live.flatMap((a) => spidsOf(a)))];
  const xml = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clicks}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${spids.map((s) => `<p:bldP spid="${s}" grpId="0"/>`).join('')}</p:bldLst></p:timing>`;
  // number the timing nodes in the order they are written, as PowerPoint does
  let n = 0;
  return xml.replace(/<p:cTn id="\d+"/g, () => `<p:cTn id="${++n}"`);
}

/**
 * A slide's animations from PowerPoint's timing tree. `targetOfSpid` gives the object made from
 * each PowerPoint shape. Effects other than Appear, Fade, Wipe and Fly come in as Fade, and
 * animations of single paragraphs move the whole text box.
 */
export function readTiming(sld: Element, targetOfSpid: (spid: number) => AnimTarget | null, warn: (s: string) => void): Anim[] {
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const kidsOf = (el: Element | null | undefined, name: string) => el ? Array.from(el.children).filter((c) => c.localName === name) : [];
  const kid = (el: Element | null | undefined, ...path: string[]) => {
    let cur: Element | null | undefined = el;
    for (const p of path) cur = cur ? kidsOf(cur, p)[0] : undefined;
    return cur ?? null;
  };
  const timing = kidsOf(sld, 'timing')[0];
  if (!timing) return [];
  const main = Array.from(timing.getElementsByTagNameNS(P, 'cTn')).find((c) => c.getAttribute('nodeType') === 'mainSeq');
  if (!main) return [];
  const out: Anim[] = [];
  const delayOf = (cTn: Element | null) => {
    const v = kid(cTn, 'stCondLst', 'cond')?.getAttribute('delay');
    return v && v !== 'indefinite' ? Number(v) / 1000 : 0;
  };
  for (const click of kidsOf(kid(main, 'childTnLst'), 'par')) {
    const clickTn = kid(click, 'cTn');
    for (const group of kidsOf(kid(clickTn, 'childTnLst'), 'par')) {
      const groupTn = kid(group, 'cTn');
      for (const eff of kidsOf(kid(groupTn, 'childTnLst'), 'par')) {
        const tn = kid(eff, 'cTn');
        if (!tn) continue;
        const cls = tn.getAttribute('presetClass');
        if (cls === 'path') { warn('Motion-path animations were left out.'); continue; }
        if (cls !== 'entr' && cls !== 'exit' && cls !== 'emph') continue; // media calls and the like
        const spTgt = tn.getElementsByTagNameNS(P, 'spTgt')[0];
        const spid = Number(spTgt?.getAttribute('spid'));
        const target = Number.isFinite(spid) ? targetOfSpid(spid) : null;
        if (!target) continue;
        if (spTgt && spTgt.children.length) warn('Animations of single paragraphs now move the whole text box.');
        const preset = Number(tn.getAttribute('presetID'));
        const node = tn.getAttribute('nodeType');
        if (cls === 'emph') {
          const e = readEmphasis(tn, preset, warn);
          const durs = Array.from(tn.getElementsByTagNameNS(P, 'cTn')).map((c) => Number(c.getAttribute('dur')) * (c.getAttribute('autoRev') === '1' ? 2 : 1)).filter((d) => Number.isFinite(d) && d > 1);
          const prev = out[out.length - 1];
          if (prev && node === 'withEffect' && prev.target.kind === target.kind && prev.target.id === target.id && prev.effect === e.effect) continue;
          out.push({ target, ...e, start: node === 'withEffect' ? 'with' : node === 'afterEffect' ? 'after' : 'click', dur: (durs[0] ?? 2000) / 1000, delay: delayOf(tn) });
          continue;
        }
        const effect: Effect = preset === 1 ? 'appear' : preset === 2 ? 'fly' : preset === 22 ? 'wipe' : preset === 10 ? 'fade' : 'fade';
        if (![1, 2, 10, 22].includes(preset)) warn('Animations other than Appear, Fade, Wipe and Fly came in as Fade.');
        const start: Anim['start'] = node === 'withEffect' ? 'with' : node === 'afterEffect' ? 'after' : 'click';
        // how long: the first behaviour that takes time
        const durs = Array.from(tn.getElementsByTagNameNS(P, 'cTn')).slice(1).map((c) => Number(c.getAttribute('dur'))).filter((d) => Number.isFinite(d) && d > 1);
        const sub = Number(tn.getAttribute('presetSubtype'));
        const prev = out[out.length - 1];
        const same = prev && start === 'with' && prev.target.kind === target.kind && prev.target.id === target.id && prev.effect === effect && !!prev.exit === (cls === 'exit');
        if (same) continue; // the same object moving in two PowerPoint shapes (a table and its title)
        out.push({
          target, effect, ...(cls === 'exit' ? { exit: true } : {}),
          ...(effect === 'wipe' || effect === 'fly' ? { from: SUBTYPE_SIDE[sub] ?? 'bottom' } : {}),
          start, dur: effect === 'appear' ? 0 : (durs[0] ?? 500) / 1000, delay: delayOf(tn),
        });
      }
    }
  }
  return out;
}

/**
 * An emphasis effect from PowerPoint: Pulse, Grow/Shrink, Spin and Transparency as they are,
 * any change of colour (fill, text or line) as Colour Change, and the others as Pulse.
 */
function readEmphasis(tn: Element, preset: number, warn: (s: string) => void): Pick<Anim, 'effect' | 'scale' | 'turn' | 'opacity' | 'color'> {
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const first = (name: string) => tn.getElementsByTagNameNS(P, name)[0];
  const clr = first('animClr');
  if (clr || [1, 3, 7, 19].includes(preset)) {
    const rgb = clr?.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'srgbClr')[0]?.getAttribute('val');
    return { effect: 'colour', color: rgb && /^[0-9a-f]{6}$/i.test(rgb) ? `#${rgb.toLowerCase()}` : EMPH_DEFAULTS.color };
  }
  if (preset === 8 || (first('animRot') && preset !== 26)) {
    const by = Number(first('animRot')?.getAttribute('by'));
    return { effect: 'spin', turn: Number.isFinite(by) && by ? +(by / 60000).toFixed(2) : EMPH_DEFAULTS.turn };
  }
  if (preset === 9) {
    const sets = Array.from(tn.getElementsByTagNameNS(P, 'set')).find((x) => x.textContent?.includes('style.opacity') || /opacity/.test(x.getElementsByTagNameNS(P, 'attrName')[0]?.textContent ?? ''));
    const v = Number(sets?.getElementsByTagNameNS(P, 'strVal')[0]?.getAttribute('val'));
    return { effect: 'transparency', opacity: Number.isFinite(v) ? +(1 - v).toFixed(3) : EMPH_DEFAULTS.opacity };
  }
  if (preset === 6) {
    const by = first('by');
    const x = Number(by?.getAttribute('x')), y = Number(by?.getAttribute('y'));
    const k = Number.isFinite(x) && x ? (Number.isFinite(y) && y ? (x + y) / 2 : x) : NaN;
    return { effect: 'grow', scale: Number.isFinite(k) ? +(k / 100000).toFixed(3) : EMPH_DEFAULTS.scale };
  }
  if (preset !== 26) warn('Emphasis effects other than Pulse, Grow/Shrink, Spin, Transparency and colour changes came in as Pulse.');
  return { effect: 'pulse' };
}
