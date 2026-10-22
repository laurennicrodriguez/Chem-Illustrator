// The Font and Paragraph buttons of a ribbon (Slides' Home tab), as changes to styled text:
// to the selection while typing, or to the whole of each picked text box when not typing, as
// PowerPoint's buttons do.

import type { Justify } from '../model';
import type * as rt from '../richtext';
import { TextEditing, type RichText } from './editing';
import type { Measure } from './layout';

export type TextFormat =
  | { kind: 'toggle'; key: rt.Toggle }
  | { kind: 'style'; patch: Partial<rt.RunStyle> }
  | { kind: 'grow'; by: 1 | -1 }
  | { kind: 'align'; j: Justify }
  | { kind: 'list'; list: 'bullet' | 'number' }
  | { kind: 'indent'; by: 1 | -1 }
  | { kind: 'line'; v: number }
  | { kind: 'case'; mode: rt.CaseMode }
  | { kind: 'clear' };

/** PowerPoint's steps for Increase and Decrease Font Size. */
export const FONT_STEPS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

/** The next size up (or down) the steps; past the ends, 10% more or less. */
export function stepSize(size: number, by: 1 | -1): number {
  if (by > 0) return FONT_STEPS.find((s) => s > size + 1e-6) ?? Math.round(size * 1.1);
  const below = FONT_STEPS.filter((s) => s < size - 1e-6);
  return below.length ? below[below.length - 1] : Math.max(1, Math.round(size * 0.9 * 2) / 2);
}

/** Make the change in a text being typed in: to the selection, or to what is typed next. */
export function applyFormat(ed: TextEditing, f: TextFormat): void {
  switch (f.kind) {
    case 'toggle': ed.toggle(f.key); break;
    case 'style': ed.setStyle(f.patch); break;
    case 'grow': ed.setStyle({ size: stepSize(ed.currentStyle().size ?? ed.defaultSize, f.by) }); break;
    case 'align': ed.align(f.j); break;
    case 'list': ed.list(f.list); break;
    case 'indent': ed.indent(f.by); break;
    case 'line': ed.lineSpacing(f.v); break;
    case 'case': ed.changeCase(f.mode); break;
    case 'clear': ed.clearFormatting(); break;
  }
}

/**
 * The same change made to the whole of a text (a picked text box or shape): every run, every
 * paragraph. Each run's size steps on its own, so a box's big and small text both grow.
 */
export function formatWhole<T extends Partial<RichText> & Pick<RichText, 'runs'>>(t: T, f: TextFormat, defaults: rt.RunStyle, defaultSize: number, measure: Measure = (s) => s.length): T & ReturnType<TextEditing['result']> {
  const ed = new TextEditing(t, defaults, measure, defaultSize);
  ed.select(0, ed.text.length);
  if (f.kind === 'grow') {
    const runs = ed.t.runs.map((r) => ({ ...r, size: stepSize(r.size ?? defaultSize, f.by) }));
    ed.update({ ...ed.t, runs }, 'style');
  } else applyFormat(ed, f);
  return { ...t, ...ed.result() };
}
