// View > Interface Size: the whole window (menus, ribbons, toolboxes, panels, the drawing too)
// bigger or smaller. The desktop app zooms its web view as a browser's zoom does, which keeps text
// and drawings sharp and clicks in the right place. A web page cannot set the browser's zoom (and
// CSS zoom puts clicks on the drawings in the wrong place), so there the browser's own zoom does
// it. The drawing's own zoom (Ctrl+= / Ctrl+-) is separate; these keys are Ctrl+Alt+= / - / 0.

import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

/** The sizes offered in View > Interface Size, as fractions of normal. */
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const UI_SCALE_MIN = 0.5;
export const UI_SCALE_MAX = 2;

let scale = 1;

/** The interface size now (1 is normal). */
export function uiScale(): number { return scale; }

/** A saved or typed size kept to what the window can use, to the nearest 5%. */
export function clampUiScale(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v)) * 20) / 20;
}

/** The next size up or down the list (from a size between two, the nearest one that way). */
export function stepUiScale(from: number, dir: 1 | -1): number {
  const next = dir > 0 ? UI_SCALES.find((s) => s > from + 1e-6) : [...UI_SCALES].reverse().find((s) => s < from - 1e-6);
  return next ?? from;
}

/** The desktop app can size its interface; a web page leaves it to the browser's zoom. */
export const canScaleUi = (): boolean => isTauri();

/** Size the interface, and tick its size in the menu. */
export async function setUiScale(v: number): Promise<void> {
  if (!canScaleUi()) return;
  scale = clampUiScale(v);
  for (const s of UI_SCALES) document.querySelector(`[data-cmd="ui-scale-${Math.round(s * 100)}"]`)?.setAttribute('aria-checked', String(Math.abs(s - scale) < 1e-6));
  const custom = document.querySelector('[data-ui-scale-now]');
  if (custom) custom.textContent = `${Math.round(scale * 100)}%`;
  await getCurrentWebview().setZoom(scale).catch(() => {});
}
