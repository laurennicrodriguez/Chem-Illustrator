// The Font and Paragraph groups on the Slides ribbon's Home tab, as in PowerPoint: they change
// the selected text while typing, or the whole of each picked text box or shape otherwise, and
// show how that text looks now.

import type { Justify } from '../model';
import type * as rt from '../richtext';
import type { TextFormat } from '../text/format';

export interface TextLook {
  style: rt.RunStyle;
  align: Justify;
  list?: 'bullet' | 'number';
  line: number;
  defaultSize: number;
  defaultFont?: string;
}

export interface SlideTextHooks {
  /** Make the change; false when there is no text to change. */
  format(f: TextFormat): boolean;
  look(): TextLook | null;
  /** Put the keyboard back in the text being typed, if any. */
  refocus(): void;
  /** Nothing to change: tell the person what to pick. */
  nothing(): void;
}

const FORMATS: Record<string, TextFormat> = {
  grow: { kind: 'grow', by: 1 },
  shrink: { kind: 'grow', by: -1 },
  bold: { kind: 'toggle', key: 'bold' },
  italic: { kind: 'toggle', key: 'italic' },
  underline: { kind: 'toggle', key: 'underline' },
  sub: { kind: 'toggle', key: 'sub' },
  sup: { kind: 'toggle', key: 'sup' },
  formula: { kind: 'toggle', key: 'formula' },
  bullets: { kind: 'list', list: 'bullet' },
  numbering: { kind: 'list', list: 'number' },
  outdent: { kind: 'indent', by: -1 },
  indent: { kind: 'indent', by: 1 },
  'align-left': { kind: 'align', j: 'left' },
  'align-center': { kind: 'align', j: 'center' },
  'align-right': { kind: 'align', j: 'right' },
  justify: { kind: 'align', j: 'justify' },
};

const r2 = (v: number) => String(Math.round(v * 100) / 100);

export class SlideTextRibbon {
  private font: HTMLInputElement;
  private size: HTMLInputElement;
  private colour: HTMLInputElement;
  private line: HTMLSelectElement;

  constructor(private root: HTMLElement, private hooks: SlideTextHooks) {
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    this.font = q('#sl-font');
    this.size = q('#sl-size');
    this.colour = q('#sl-colour');
    this.line = q('#sl-line');
    const run = (f: TextFormat) => {
      if (!hooks.format(f)) hooks.nothing();
      hooks.refocus();
      this.refresh();
    };
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-sl-fmt]')) {
      // keep the caret (and the selection) in the text while clicking
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => run(FORMATS[b.dataset.slFmt!]));
    }
    const field = (el: HTMLInputElement, apply: () => void) => {
      el.addEventListener('change', apply);
      el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
        if (e.key === 'Escape') { e.preventDefault(); this.refresh(); hooks.refocus(); }
      });
    };
    field(this.font, () => {
      const v = this.font.value.trim();
      const look = hooks.look();
      run({ kind: 'style', patch: { font: v && v !== look?.defaultFont ? v : undefined } });
    });
    field(this.size, () => {
      const v = parseFloat(this.size.value);
      if (Number.isFinite(v) && v > 0) run({ kind: 'style', patch: { size: Math.min(400, v) } });
      else this.refresh();
    });
    this.colour.addEventListener('change', () => run({ kind: 'style', patch: { color: this.colour.value.toLowerCase() === '#000000' ? undefined : this.colour.value } }));
    this.line.addEventListener('change', () => { const v = parseFloat(this.line.value); if (v > 0) run({ kind: 'line', v }); });
  }

  /** Show how the text looks now (call after the selection or the text changes). */
  refresh(): void {
    const look = this.hooks.look();
    const s = look?.style ?? {};
    const press = (id: string, on: boolean) => {
      const b = this.root.querySelector(`[data-sl-fmt="${id}"]`);
      b?.setAttribute('aria-pressed', String(on));
      b?.classList.toggle('on', on);
    };
    for (const k of ['bold', 'italic', 'underline', 'sub', 'sup', 'formula'] as const) press(k, !!look && !!s[k]);
    for (const j of ['left', 'center', 'right'] as const) press(`align-${j}`, look?.align === j);
    press('justify', look?.align === 'justify');
    press('bullets', look?.list === 'bullet');
    press('numbering', look?.list === 'number');
    const active = this.root.ownerDocument.activeElement;
    if (active !== this.font) {
      this.font.value = s.font ?? '';
      this.font.placeholder = look ? (s.font === undefined ? look.defaultFont ?? '' : '') : 'Font';
    }
    if (active !== this.size) {
      const size = s.size ?? look?.defaultSize;
      this.size.value = size !== undefined ? r2(size) : '';
    }
    this.colour.value = s.color ?? '#000000';
    const line = look ? r2(look.line) : '1';
    this.line.value = [...this.line.options].some((o) => o.value === line) ? line : '';
    for (const g of this.root.querySelectorAll<HTMLElement>('[data-sl-text]')) g.classList.toggle('rb-idle', !look);
  }
}
