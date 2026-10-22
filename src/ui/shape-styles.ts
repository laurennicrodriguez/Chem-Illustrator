// Shape Styles and Shape Effects for design shapes (Slides, Design, and shapes in Documents):
// a gallery of ready-made looks, each colour in six strengths from an outline to a raised,
// shadowed fill, and the menus of effects (shadow, reflection, glow, soft edges, bevel) with
// PowerPoint's ready-made sizes. The colours are the deck's own (its text and accent colours) and a few more.

import type { Shape } from '../model';
import { tint } from '../colours';
import { mix } from '../render/fills';
import { BEVELS, GLOW_SIZES, GLOW_TRANSPARENCY, REFLECTIONS, SOFT_EDGES } from '../render/shape-fx';
import type { MenuItem } from './context-menu';

/** The six strengths of a Shape Style, lightest first. */
export const STYLE_LOOKS = [
  { id: 'outline', name: 'Coloured Outline' },
  { id: 'fill', name: 'Coloured Fill' },
  { id: 'light', name: 'Light Fill, Coloured Outline' },
  { id: 'subtle', name: 'Subtle Effect' },
  { id: 'moderate', name: 'Moderate Effect' },
  { id: 'intense', name: 'Intense Effect' },
] as const;
export type StyleLook = (typeof STYLE_LOOKS)[number]['id'];

/** The colours a style comes in: the deck's text colour and accents, then some of our own. */
export function styleColours(text: string, accent: string, accent2: string): string[] {
  const own = ['#2e7d6b', '#c27c0e', '#6a4c93', '#b23a48'];
  const out: string[] = [];
  for (const c of [text, accent, accent2, ...own]) if (/^#[0-9a-f]{6}$/i.test(c) && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  return out.slice(0, 7);
}

/** What a Shape Style changes: the fill, outline and effects (and the text colour, to show on the fill). */
export function stylePatch(look: StyleLook, c: string): Partial<Shape> & { textColor: string } {
  const clear: Partial<Shape> = {
    filled: true, fillColor: c, color: c, fill: undefined, fill2: undefined, gradAngle: undefined, gradRadial: undefined,
    pattern: undefined, transparency: undefined, picFill: undefined, dashed: undefined,
    shadow: undefined, shadowSize: undefined, shadowBlur: undefined, shadowColor: undefined, shadowOpacity: undefined, shadowAngle: undefined,
    glow: undefined, softEdge: undefined, bevel: undefined, reflection: undefined,
  };
  const dark = mix(c, '#000000', 0.25);
  switch (look) {
    case 'outline': return { ...clear, filled: false, lineWidth: 1, textColor: c };
    case 'fill': return { ...clear, lineWidth: 1, color: dark, textColor: '#ffffff' };
    case 'light': return { ...clear, fillColor: tint(c, 0.8), lineWidth: 1, textColor: dark };
    case 'subtle': return { ...clear, fill: 'gradient', fillColor: tint(c, 0.9), fill2: tint(c, 0.6), gradAngle: 90, lineWidth: 1, textColor: dark };
    case 'moderate': return { ...clear, fill: 'gradient', fillColor: tint(c, 0.35), fill2: c, gradAngle: 90, lineWidth: 0, shadow: true, shadowSize: 3, shadowBlur: 4, shadowOpacity: 0.35, shadowAngle: 90, textColor: '#ffffff' };
    case 'intense': return { ...clear, fill: 'gradient', fillColor: dark, fill2: c, gradAngle: 270, lineWidth: 0, shadow: true, shadowSize: 3, shadowBlur: 5, shadowOpacity: 0.45, shadowAngle: 90, bevel: { kind: 'circle', w: 6, h: 6 }, textColor: '#ffffff' };
  }
}

/** A swatch for the gallery: CSS that looks like the style. */
export function swatchCss(look: StyleLook, c: string): string {
  const p = stylePatch(look, c);
  const fill = !p.filled ? '#ffffff' : p.fill === 'gradient' ? `linear-gradient(${(p.gradAngle ?? 90) === 270 ? 'to top' : 'to bottom'}, ${p.fillColor}, ${p.fill2})` : p.fillColor;
  const border = p.lineWidth ? `1.5px solid ${p.color}` : '1.5px solid transparent';
  const shadow = [p.shadow ? '0 2px 4px rgba(0,0,0,0.4)' : '', p.bevel ? 'inset 2px 2px 2px rgba(255,255,255,0.45), inset -2px -2px 2px rgba(0,0,0,0.3)' : ''].filter(Boolean).join(', ');
  return `background:${fill};border:${border};color:${p.textColor};${shadow ? `box-shadow:${shadow};` : ''}`;
}

/** The Shape Effects menu: each effect's ready-made sizes, and none. Commands are shape-fx:<effect>:<choice>. */
export function effectsMenu(): MenuItem[] {
  return [
    { label: 'Shadow', items: [
      { cmd: 'shape-fx:shadow:none', label: 'No Shadow' }, null,
      { cmd: 'shape-fx:shadow:offset', label: 'Offset: Bottom Right' },
      { cmd: 'shape-fx:shadow:below', label: 'Offset: Bottom' },
      { cmd: 'shape-fx:shadow:soft', label: 'Soft, All Round' },
      { cmd: 'shape-fx:shadow:perspective', label: 'Long, Faint' },
    ] },
    { label: 'Reflection', items: [
      { cmd: 'shape-fx:reflection:none', label: 'No Reflection' }, null,
      ...REFLECTIONS.map((r, i) => ({ cmd: `shape-fx:reflection:${i}`, label: r.name })),
    ] },
    { label: 'Glow', items: [
      { cmd: 'shape-fx:glow:none', label: 'No Glow' }, null,
      ...GLOW_SIZES.map((g) => ({ cmd: `shape-fx:glow:${g}`, label: `${g} pt glow, the shape's colour` })),
      null, { cmd: 'shape-fx:glow:options', label: 'Glow Options…' },
    ] },
    { label: 'Soft Edges', items: [
      { cmd: 'shape-fx:soft:none', label: 'No Soft Edges' }, null,
      ...SOFT_EDGES.map((s) => ({ cmd: `shape-fx:soft:${s}`, label: `${s} pt` })),
    ] },
    { label: 'Bevel', items: [
      { cmd: 'shape-fx:bevel:none', label: 'No Bevel' }, null,
      ...BEVELS.map((b) => ({ cmd: `shape-fx:bevel:${b.id}`, label: b.name })),
    ] },
  ];
}

/**
 * What one of the Shape Effects menu's commands changes on a shape (null: not one of them, or
 * one that asks first, like Glow Options).
 */
export function effectPatch(cmd: string, s: Shape): Partial<Shape> | null {
  const m = /^shape-fx:(shadow|reflection|glow|soft|bevel):(.+)$/.exec(cmd);
  if (!m) return null;
  const [, fx, v] = m;
  const own = s.filled ? s.fillColor ?? s.color ?? '#000000' : s.color ?? '#000000';
  switch (fx) {
    case 'shadow': {
      const none = { shadow: undefined, shadowSize: undefined, shadowBlur: undefined, shadowColor: undefined, shadowOpacity: undefined, shadowAngle: undefined };
      if (v === 'none') return none;
      if (v === 'offset') return { ...none, shadow: true, shadowSize: 4, shadowBlur: 4, shadowOpacity: 0.4, shadowAngle: 45 };
      if (v === 'below') return { ...none, shadow: true, shadowSize: 3, shadowBlur: 4, shadowOpacity: 0.4, shadowAngle: 90 };
      if (v === 'soft') return { ...none, shadow: true, shadowSize: 0.5, shadowBlur: 10, shadowOpacity: 0.45, shadowAngle: 90 };
      if (v === 'perspective') return { ...none, shadow: true, shadowSize: 10, shadowBlur: 8, shadowOpacity: 0.2, shadowAngle: 60 };
      return null;
    }
    case 'reflection': {
      if (v === 'none') return { reflection: undefined };
      const r = REFLECTIONS[Number(v)];
      return r ? { reflection: { size: r.size, opacity: r.opacity, dist: r.dist } } : null;
    }
    case 'glow':
      if (v === 'none') return { glow: undefined };
      if (v === 'options') return null;
      return Number(v) > 0 ? { glow: { color: own, size: Number(v), transparency: GLOW_TRANSPARENCY } } : null;
    case 'soft':
      return v === 'none' ? { softEdge: undefined } : Number(v) > 0 ? { softEdge: Number(v) } : null;
    case 'bevel':
      if (v === 'none') return { bevel: undefined };
      return BEVELS.some((b) => b.id === v) ? { bevel: { kind: v as NonNullable<Shape['bevel']>['kind'], w: 6, h: 6 } } : null;
  }
  return null;
}

/**
 * The Shape Styles gallery under a button: a swatch for each colour in each strength. `pick`
 * gets the look and colour clicked.
 */
export function showStyleGallery(button: HTMLElement | { left: number; bottom: number }, colours: string[], pick: (look: StyleLook, colour: string) => void): void {
  document.querySelector('.shape-style-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'shape-style-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Shape Styles');
  const grid = document.createElement('div');
  grid.className = 'sst-grid';
  grid.style.gridTemplateColumns = `repeat(${colours.length}, 34px)`;
  for (const look of STYLE_LOOKS) {
    for (const c of colours) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sst-swatch';
      b.textContent = 'Abc';
      b.title = `${look.name}, ${c}`;
      b.setAttribute('style', swatchCss(look.id, c));
      b.addEventListener('click', () => { close(); pick(look.id, c); });
      grid.append(b);
    }
  }
  const head = document.createElement('div');
  head.className = 'sst-head';
  head.textContent = 'Shape Styles: the fill, outline and effects together';
  pop.append(head, grid);
  document.body.append(pop);
  const r = button instanceof HTMLElement ? button.getBoundingClientRect() : button;
  pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - pop.offsetWidth - 4))}px`;
  pop.style.top = `${r.bottom + 4}px`;
  pop.querySelector<HTMLButtonElement>('button')?.focus();
  const outside = (e: Event) => {
    if (e instanceof KeyboardEvent ? e.key === 'Escape' : !pop.contains(e.target as Node)) close();
  };
  const close = () => {
    pop.remove();
    removeEventListener('mousedown', outside, true);
    removeEventListener('keydown', outside, true);
  };
  setTimeout(() => { addEventListener('mousedown', outside, true); addEventListener('keydown', outside, true); });
}
