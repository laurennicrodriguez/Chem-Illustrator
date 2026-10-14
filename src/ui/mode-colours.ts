// View > Mode Colours…: each kind of file has its own colour (blue for drawings, orange for
// slides, green for sheets, a deeper blue for documents, purple for designs), so you can tell at a glance which mode you are in. By default only the accent
// colour changes (buttons, highlights, tab icons); "Whole window" also colours the menu bar.
// Every colour can be changed, and the choice is saved in the settings file.

export type ColourMode = 'drawing' | 'slides' | 'sheet' | 'document' | 'design';
export type ModeColourStyle = 'accent' | 'window' | 'off';
export interface ModeColours {
  /** accent: buttons and highlights only; window: the menu bar too; off: the drawing colour everywhere. */
  style: ModeColourStyle;
  drawing: string;
  slides: string;
  sheet: string;
  document: string;
  design: string;
}

export const DEFAULT_MODE_COLOURS: ModeColours = { style: 'accent', drawing: '#2f6fdf', slides: '#c8572a', sheet: '#1e8a50', document: '#2647a8', design: '#7b3fbf' };
const STYLES: ModeColourStyle[] = ['accent', 'window', 'off'];
const HEX = /^#[0-9a-f]{6}$/i;

/** Read saved mode colours, keeping only what makes sense. */
export function parseModeColours(raw: unknown): ModeColours {
  const c = { ...DEFAULT_MODE_COLOURS };
  if (!raw || typeof raw !== 'object') return c;
  const r = raw as Record<string, unknown>;
  if (STYLES.includes(r.style as ModeColourStyle)) c.style = r.style as ModeColourStyle;
  for (const k of ['drawing', 'slides', 'sheet', 'document', 'design'] as const) if (typeof r[k] === 'string' && HEX.test(r[k] as string)) c[k] = (r[k] as string).toLowerCase();
  return c;
}

// ---------------------------------------------------------------- colour arithmetic

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
/** The window's panels and background in the dark theme (app.css). */
const DARK_PANEL: RGB = [0x25, 0x2a, 0x32];
const DARK_BG: RGB = [0x1b, 0x1e, 0x24];

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const hex = (c: RGB): string => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
/** a with fraction t of b mixed in. */
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

function luminance(c: RGB): number {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How readable one colour is on another (WCAG contrast ratio, 1 to 21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Move c towards `to` in small steps until it reads at `ratio` against `on`. */
function until(c: RGB, to: RGB, on: RGB, ratio: number): RGB {
  for (let t = 0; t <= 1; t += 0.02) {
    const m = mix(c, to, t);
    if (contrast(hex(m), hex(on)) >= ratio) return m;
  }
  return to;
}

function toHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export interface Palette {
  /** Buttons, highlights and text in the accent colour, light theme (readable on white). */
  accent: string;
  /** Pale background for hovered and chosen items, light theme. */
  soft: string;
  accentDark: string;
  softDark: string;
  /** The menu bar in "Whole window", with white text on it. */
  bar: string;
  barDark: string;
}

/** Everything the window needs from one chosen colour, in both themes, keeping text readable. */
export function modePalette(colour: string): Palette {
  const c = rgb(HEX.test(colour) ? colour : DEFAULT_MODE_COLOURS.drawing);
  const accent = until(c, BLACK, WHITE, 4.5);
  const [h, s, l] = toHsl(c);
  // the dark theme's accent: the same hue, lighter and stronger (blue #2f6fdf gives #7babff)
  const lighter = fromHsl(h, Math.min(1, s + 0.27), l + (1 - l) * 0.45);
  const accentDark = until(lighter, WHITE, DARK_PANEL, 4.5);
  return {
    accent: hex(accent),
    soft: hex(mix(WHITE, c, 0.14)),
    accentDark: hex(accentDark),
    softDark: hex(mix(DARK_PANEL, c, 0.28)),
    bar: hex(until(c, BLACK, WHITE, 4.5)),
    barDark: hex(until(mix(DARK_BG, c, 0.55), BLACK, WHITE, 4.5)),
  };
}

/** The colour a mode uses, as chosen (Off: every mode uses the drawing colour). */
export function modeColour(mode: ColourMode, c: ModeColours): string {
  return c.style === 'off' ? c.drawing : c[mode];
}

/** Colour the window for a mode: sets the colour variables app.css reads, and the whole-window look. */
export function applyModeColours(mode: ColourMode, c: ModeColours, root: HTMLElement = document.documentElement): void {
  const p = modePalette(modeColour(mode, c));
  const vars: Record<string, string> = {
    '--mode-accent': p.accent, '--mode-soft': p.soft, '--mode-accent-dark': p.accentDark, '--mode-soft-dark': p.softDark,
    '--mode-bar': p.bar, '--mode-bar-dark': p.barDark, '--mode-drawing': c.drawing, '--mode-slides': c.style === 'off' ? c.drawing : c.slides,
    '--mode-sheet': c.style === 'off' ? c.drawing : c.sheet, '--mode-document': c.style === 'off' ? c.drawing : c.document, '--mode-design': c.style === 'off' ? c.drawing : c.design,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  document.body.classList.toggle('mode-window', c.style === 'window');
}

// ---------------------------------------------------------------- the window

export interface ModeColoursDialogOptions {
  get(): ModeColours;
  /** Called on every change, so the window shows it at once. */
  set(c: ModeColours): void;
}

const NAMES: Record<ColourMode, string> = { drawing: 'Drawings', slides: 'Slides', sheet: 'Sheets', document: 'Documents', design: 'Designs' };

export class ModeColoursDialog {
  private d: HTMLDialogElement;

  constructor(private opts: ModeColoursDialogOptions) {
    const d = (this.d = document.createElement('dialog'));
    d.className = 'mode-dialog';
    d.setAttribute('aria-label', 'Mode colours');
    d.innerHTML = `
      <h2>Mode colours</h2>
      <p class="muted">Each kind of file has its own colour, so you can see at a glance whether you are working on a drawing, slides, a sheet or a document.</p>
      <fieldset class="mc-styles">
        <legend>Use the colour for</legend>
        <label class="hk-opt"><input type="radio" name="mc-style" value="accent" /><span>Buttons, highlights and tab icons (the window keeps its usual look)</span></label>
        <label class="hk-opt"><input type="radio" name="mc-style" value="window" /><span>The whole window: the menu bar and tab strip too</span></label>
        <label class="hk-opt"><input type="radio" name="mc-style" value="off" /><span>Nothing: every mode uses the drawing colour</span></label>
      </fieldset>
      <div class="mc-colours"></div>
      <div class="hk-foot">
        <button type="button" data-act="reset">Use the standard colours</button>
        <span class="hk-buttons"><button type="button" data-act="close" class="primary">Close</button></span>
      </div>`;
    const box = d.querySelector('.mc-colours')!;
    for (const mode of ['drawing', 'slides', 'sheet', 'document', 'design'] as ColourMode[]) {
      const row = document.createElement('label');
      row.className = 'md-row';
      const name = document.createElement('span');
      name.textContent = NAMES[mode];
      const controls = document.createElement('span');
      controls.className = 'md-controls';
      const input = document.createElement('input');
      input.type = 'color';
      input.dataset.mode = mode;
      input.setAttribute('aria-label', `${NAMES[mode]} colour`);
      input.addEventListener('input', () => this.change({ [mode]: input.value.toLowerCase() }));
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'Standard';
      reset.addEventListener('click', (e) => { e.preventDefault(); this.change({ [mode]: DEFAULT_MODE_COLOURS[mode] }); this.fill(); });
      controls.append(input, reset);
      row.append(name, controls);
      box.append(row);
    }
    for (const r of d.querySelectorAll<HTMLInputElement>('input[name=mc-style]')) {
      r.addEventListener('change', () => { if (r.checked) this.change({ style: r.value as ModeColourStyle }); });
    }
    d.querySelector('[data-act=reset]')!.addEventListener('click', () => { opts.set({ ...DEFAULT_MODE_COLOURS }); this.fill(); });
    d.querySelector('[data-act=close]')!.addEventListener('click', () => d.close());
    // keys typed here are for the window, not the drawing
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.body.append(d);
  }

  open(): void {
    this.fill();
    this.d.showModal();
  }

  private change(part: Partial<ModeColours>): void {
    this.opts.set({ ...this.opts.get(), ...part });
  }

  private fill(): void {
    const c = this.opts.get();
    for (const r of this.d.querySelectorAll<HTMLInputElement>('input[name=mc-style]')) r.checked = r.value === c.style;
    for (const i of this.d.querySelectorAll<HTMLInputElement>('input[type=color]')) i.value = c[i.dataset.mode as ColourMode];
  }
}
