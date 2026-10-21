// Saved highlight looks: ready-made ones, and your own (kept in the settings file). A look is a
// highlight's style (shape, soft edges, outline, texture…) and, for your own, its colour.

import type { HighlightStyle } from '../model';
import { highlightStyleFromTag } from '../render/highlight';

export interface HighlightLookPreset {
  name: string;
  /** Your own looks keep their colour; the ready-made ones keep the highlight's colour. */
  colour?: string;
  style: HighlightStyle;
}

export const BUILT_IN_LOOKS: HighlightLookPreset[] = [
  { name: 'Classic', style: {} },
  { name: 'Smooth band', style: { smooth: true } },
  { name: 'Straight, centred on double bonds', style: { shape: 'straight', centre: true } },
  { name: 'Soft marker', style: { smooth: true, soft: true, softAmount: 0.5 } },
  { name: 'Hollow (soft middle)', style: { smooth: true, soft: true, softSide: 'inner', softAmount: 0.7 } },
  { name: 'Outline only', style: { smooth: true, fill: 'none', line: 'solid' } },
  { name: 'Dashed outline', style: { shape: 'straight', fill: 'none', line: 'dashed' } },
  { name: 'Hatched', style: { smooth: true, transparency: 0.6, pattern: 'hatch', line: 'solid', lineWidth: 0.5 } },
  { name: 'Stippled', style: { smooth: true, fill: 'none', pattern: 'dots' } },
  { name: 'Glow', style: { smooth: true, glow: true } },
  { name: 'Neon (outline and glow)', style: { smooth: true, fill: 'none', line: 'solid', lineWidth: 1, glow: true, glowSize: 0.2, glowTransparency: 0.3 } },
  { name: 'Lifted (soft shadow)', style: { smooth: true, shadow: true, shadowBlur: 0.15, shadowDistance: 0.08 } },
  { name: 'Gradient across', style: { smooth: true, fill: 'linear' } },
  { name: 'Bright middle (gradient to the edge)', style: { smooth: true, fill: 'edge' } },
  { name: 'See-through', style: { smooth: true, transparency: 0.5 } },
];

/** Your own looks as read from the settings file, keeping only what makes sense. */
export function parseLooks(raw: unknown): HighlightLookPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: HighlightLookPreset[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const v = r as Record<string, unknown>;
    if (typeof v.name !== 'string' || !v.name.trim() || out.some((o) => o.name === v.name)) continue;
    const style = highlightStyleFromTag(JSON.stringify(v.style ?? {})) ?? {};
    const colour = typeof v.colour === 'string' && /^#[0-9a-f]{6}$/i.test(v.colour) ? v.colour.toLowerCase() : undefined;
    out.push({ name: v.name.trim().slice(0, 80), ...(colour ? { colour } : {}), style });
    if (out.length >= 100) break;
  }
  return out;
}
