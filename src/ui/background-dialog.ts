// Design > Format Background…: a slide's background, as PowerPoint's Format Background pane
// offers it: a colour, a gradient, a picture or a pattern, each see-through to the amount
// chosen, with the master's shapes and logo shown or hidden. It applies to the slides picked,
// or to every slide (Apply to All), and Reset Background gives the slides the master's again.
// A preview shows the slide as it will look; nothing changes until Apply, and Undo puts it back.

import type { Image } from '../deck/deck';
import {
  type Background, type GradientStop, type PatternId, type TileAlign, type TileMirror,
  GRADIENT_PRESETS, LINEAR_DIRECTIONS, FOCUS_POINTS, PATTERN_LIST, PATTERN_CELL, backgroundColour, copyBackground, paintBackground, sortedStops, clamp01,
} from '../deck/background';

export interface BackgroundDialogOptions {
  /** The background the slides show now (their own, or the master's). */
  current: Background;
  /** The first slide picked has a background of its own (Reset Background gives it the master's). */
  own: boolean;
  hideGraphics: boolean;
  /** How many slides it applies to; a design's page has no Apply to All or Reset. */
  count: number;
  design?: boolean;
  /** The colour the slides' text is, for a new pattern's lines. */
  textColour: string;
  /** Draw the first slide picked with this background on the canvas (CSS pixels w × h). */
  preview(canvas: HTMLCanvasElement, w: number, h: number, bg: Background, hideGraphics: boolean): void;
  /** The slide's proportions, for the preview. */
  aspect: number;
  pickPicture(): Promise<Image | null>;
}

export type BackgroundResult = { action: 'apply' | 'all'; bg: Background; hideGraphics: boolean } | { action: 'reset'; hideGraphics: boolean };

type Kind = Background['kind'];
type Gradient = Extract<Background, { kind: 'gradient' }>;
type Picture = Extract<Background, { kind: 'picture' }>;
type Pattern = Extract<Background, { kind: 'pattern' }>;

const KINDS: [Kind, string][] = [['solid', 'Solid colour'], ['gradient', 'Gradient'], ['picture', 'Picture or texture'], ['pattern', 'Pattern']];
const FITS: [Picture['fit'], string][] = [['stretch', 'Stretch to the slide'], ['fill', 'Fill the slide (keep proportions, cut the edges)'], ['fit', 'Fit in the slide (keep proportions, whole picture)'], ['tile', 'Tile as a texture']];
const ALIGNS: [TileAlign, string][] = [['tl', 'Top left'], ['t', 'Top'], ['tr', 'Top right'], ['l', 'Left'], ['ctr', 'Centre'], ['r', 'Right'], ['bl', 'Bottom left'], ['b', 'Bottom'], ['br', 'Bottom right']];
const MIRRORS: [TileMirror, string][] = [['none', 'None'], ['x', 'Side to side'], ['y', 'Top to bottom'], ['xy', 'Both']];
const SHAPES: [Gradient['shape'], string][] = [['linear', 'Linear'], ['radial', 'Radial'], ['rect', 'Rectangular']];

const hex = (v: string) => (/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000');

export function formatBackground(o: BackgroundDialogOptions): Promise<BackgroundResult | null> {
  return new Promise((resolve) => {
    // each kind keeps its own settings while the person tries the others
    const cur = copyBackground(o.current);
    const main = backgroundColour(cur);
    let solid: Extract<Background, { kind: 'solid' }> = cur.kind === 'solid' ? cur : { kind: 'solid', color: main };
    let gradient: Gradient = cur.kind === 'gradient' ? cur : { kind: 'gradient', shape: 'linear', angle: 90, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: main.toLowerCase() === '#ffffff' ? '#d6e4f5' : main }] };
    let picture: Picture | null = cur.kind === 'picture' ? cur : null;
    let pattern: Pattern = cur.kind === 'pattern' ? cur : { kind: 'pattern', pattern: 'pct10', fg: o.textColour, bg: main };
    let kind: Kind = cur.kind;
    let hide = o.hideGraphics;

    const d = document.createElement('dialog');
    d.className = 'master-dialog bg-dialog';
    const form = document.createElement('form');
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = 'Format background';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = o.design ? 'The background of the page.' : o.count > 1 ? `For the ${o.count} slides picked in the slide list, or every slide with Apply to All.` : 'For this slide, or every slide with Apply to All.';
    const preview = document.createElement('canvas');
    preview.className = 'bg-preview';
    const PW = 280, PH = Math.round(PW / Math.max(0.2, o.aspect));
    preview.style.width = `${PW}px`;
    preview.style.height = `${PH}px`;
    form.append(h, note, preview);

    const grid = document.createElement('div');
    grid.className = 'md-grid';
    form.append(grid);
    const row = (parent: HTMLElement, label: string, ...els: HTMLElement[]) => {
      const l = document.createElement('label');
      l.className = 'md-row';
      const span = document.createElement('span');
      span.textContent = label;
      const box = document.createElement('span');
      box.className = 'md-controls';
      box.append(...els);
      l.append(span, box);
      parent.append(l);
      return l;
    };
    const unit = (s: string) => {
      const u = document.createElement('span');
      u.className = 'muted';
      u.textContent = s;
      return u;
    };
    const color = (v: string, on: (v: string) => void) => {
      const i = document.createElement('input');
      i.type = 'color';
      i.value = hex(v);
      i.addEventListener('input', () => on(i.value));
      return i;
    };
    const num = (v: number, min: number, max: number, on: (v: number) => void, step = 1) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(+v.toFixed(2));
      i.className = 'md-num';
      i.addEventListener('input', () => { const x = parseFloat(i.value); if (Number.isFinite(x)) on(Math.max(min, Math.min(max, x))); });
      return i;
    };
    /** A transparency slider with its percentage beside it (0 solid, 100 clear). */
    const clear = (v: number | undefined, on: (v: number) => void) => {
      const box = document.createElement('span');
      box.className = 'bg-slider';
      const r = document.createElement('input');
      r.type = 'range';
      r.min = '0';
      r.max = '100';
      r.value = String(Math.round(clamp01(v) * 100));
      const n = num(Math.round(clamp01(v) * 100), 0, 100, (x) => { r.value = String(x); on(x / 100); });
      r.addEventListener('input', () => { n.value = r.value; on(Number(r.value) / 100); });
      box.append(r, n, unit('%'));
      return box;
    };
    const select = <T extends string>(options: [T, string][], v: T, on: (v: T) => void) => {
      const s = document.createElement('select');
      for (const [id, name] of options) s.add(new Option(name, id, false, id === v));
      s.addEventListener('change', () => on(s.value as T));
      return s;
    };
    const section = () => {
      const s = document.createElement('div');
      s.className = 'bg-section';
      grid.append(s);
      return s;
    };

    // ------------------------------------------------ the kind of fill
    const kinds = document.createElement('div');
    kinds.className = 'bg-kinds';
    kinds.setAttribute('role', 'radiogroup');
    kinds.setAttribute('aria-label', 'Fill');
    for (const [k, name] of KINDS) {
      const l = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'bg-kind';
      r.value = k;
      r.checked = k === kind;
      r.addEventListener('change', () => { if (r.checked) { kind = k; show(); if (k === 'picture' && !picture) void choose(); } });
      l.append(r, name);
      kinds.append(l);
    }
    grid.append(kinds);

    // ------------------------------------------------ solid colour
    const solidBox = section();
    row(solidBox, 'Colour', color(solid.color, (v) => { solid = { ...solid, color: v }; draw(); }));
    row(solidBox, 'Transparency', clear(solid.transparency, (v) => { solid = { ...solid, transparency: v || undefined }; draw(); }));

    // ------------------------------------------------ gradient
    const gradBox = section();
    const preset = document.createElement('select');
    preset.add(new Option('Choose a ready-made gradient…', ''));
    for (const p of GRADIENT_PRESETS) preset.add(new Option(p.name, p.name));
    preset.addEventListener('change', () => {
      const p = GRADIENT_PRESETS.find((x) => x.name === preset.value);
      if (p) { gradient = copyBackground(p.bg) as Gradient; buildGradient(); draw(); }
      preset.value = '';
    });
    row(gradBox, 'Preset', preset);
    const gradControls = document.createElement('div');
    gradBox.append(gradControls);
    const buildGradient = () => {
      gradControls.replaceChildren();
      row(gradControls, 'Type', select(SHAPES, gradient.shape, (v) => { gradient = { ...gradient, shape: v, focus: v === 'linear' ? gradient.focus : gradient.focus ?? { x: 0.5, y: 0.5 } }; buildGradient(); draw(); }));
      if (gradient.shape === 'linear') {
        const dir = document.createElement('select');
        dir.add(new Option('Other angle', ''));
        for (const x of LINEAR_DIRECTIONS) dir.add(new Option(x.name, String(x.angle), false, !gradient.scaled && x.angle === ((gradient.angle % 360) + 360) % 360));
        const angle = num(gradient.angle, -360, 360, (v) => { gradient = { ...gradient, angle: v }; dir.value = String(LINEAR_DIRECTIONS.find((x) => x.angle === ((v % 360) + 360) % 360)?.angle ?? ''); draw(); });
        dir.addEventListener('change', () => { if (dir.value) { gradient = { ...gradient, angle: Number(dir.value), scaled: undefined }; angle.value = dir.value; draw(); } });
        row(gradControls, 'Direction', dir);
        row(gradControls, 'Angle', angle, unit('° clockwise from left to right'));
      } else {
        const f = gradient.focus ?? { x: 0.5, y: 0.5 };
        const at = FOCUS_POINTS.find((p) => Math.abs(p.x - f.x) < 1e-3 && Math.abs(p.y - f.y) < 1e-3);
        const dir = document.createElement('select');
        if (!at) dir.add(new Option('From the point set in the file', ''));
        for (const p of FOCUS_POINTS) dir.add(new Option(p.name, p.name, false, p === at));
        dir.addEventListener('change', () => { const p = FOCUS_POINTS.find((x) => x.name === dir.value); if (p) { gradient = { ...gradient, focus: { x: p.x, y: p.y } }; draw(); } });
        row(gradControls, 'Direction', dir);
      }
      const head = document.createElement('div');
      head.className = 'bg-stops-head muted';
      head.textContent = 'Colour stops: colour, how far along the gradient, and transparency';
      gradControls.append(head);
      gradient.stops.forEach((s, k) => {
        const put = (v: Partial<GradientStop>) => { gradient = { ...gradient, stops: gradient.stops.map((x, j) => (j === k ? { ...x, ...v } : x)) }; draw(); };
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '✕';
        remove.title = 'Remove this stop';
        remove.disabled = gradient.stops.length <= 2;
        remove.addEventListener('click', () => { gradient = { ...gradient, stops: gradient.stops.filter((_, j) => j !== k) }; buildGradient(); draw(); });
        row(gradControls, `Stop ${k + 1}`,
          color(s.color, (v) => put({ color: v })),
          num(Math.round(s.pos * 100), 0, 100, (v) => put({ pos: v / 100 })), unit('% along'),
          clear(s.transparency, (v) => put({ transparency: v || undefined })), remove).classList.add('bg-stop');
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = 'Add stop';
      add.title = 'A new colour stop between the two farthest apart';
      add.addEventListener('click', () => {
        const st = sortedStops(gradient.stops);
        let best = 0;
        for (let i = 1; i < st.length - 1; i++) if (st[i + 1].pos - st[i].pos > st[best + 1].pos - st[best].pos) best = i;
        const a = st[best], b = st[best + 1];
        gradient = { ...gradient, stops: [...st.slice(0, best + 1), { pos: (a.pos + b.pos) / 2, color: a.color }, ...st.slice(best + 1)] };
        buildGradient();
        draw();
      });
      row(gradControls, '', add);
    };
    buildGradient();

    // ------------------------------------------------ picture
    const picBox = section();
    const thumb = document.createElement('img');
    thumb.className = 'md-logo';
    thumb.alt = 'Picture';
    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.textContent = 'Choose picture…';
    const choose = async () => {
      const got = await o.pickPicture();
      if (got) {
        picture = picture ? { ...picture, src: got.src, px: got.px } : { kind: 'picture', src: got.src, px: got.px, fit: 'stretch' };
        buildPicture();
      }
      draw();
    };
    chooseBtn.addEventListener('click', () => void choose());
    row(picBox, 'Picture', thumb, chooseBtn);
    const picControls = document.createElement('div');
    picBox.append(picControls);
    const buildPicture = () => {
      picControls.replaceChildren();
      thumb.hidden = !picture;
      if (!picture) return;
      thumb.src = picture.src;
      const p = picture;
      const set = (v: Partial<Picture>) => { picture = { ...picture!, ...v }; draw(); };
      row(picControls, 'Transparency', clear(p.transparency, (v) => set({ transparency: v || undefined })));
      row(picControls, 'Size', select(FITS, p.fit, (v) => { picture = { ...picture!, fit: v }; buildPicture(); draw(); }));
      if (p.fit === 'stretch') {
        const off = p.offsets ?? { l: 0, t: 0, r: 0, b: 0 };
        const side = (k: 'l' | 't' | 'r' | 'b') => num(Math.round(off[k] * 1000) / 10, -100, 90, (v) => set({ offsets: { ...(picture!.offsets ?? off), [k]: v / 100 } }), 0.5);
        row(picControls, 'Offset left, right', side('l'), side('r'), unit('% of the slide'));
        row(picControls, 'Offset top, bottom', side('t'), side('b'), unit('% (negative goes past the edge)'));
      } else if (p.fit === 'tile') {
        const t = { sx: 1, sy: 1, tx: 0, ty: 0, align: 'tl' as TileAlign, mirror: 'none' as TileMirror, ...p.tile };
        const put = (v: Partial<typeof t>) => set({ tile: { ...t, ...picture!.tile, ...v } });
        row(picControls, 'Scale across, down', num(t.sx * 100, 1, 1000, (v) => put({ sx: v / 100 })), num(t.sy * 100, 1, 1000, (v) => put({ sy: v / 100 })), unit('%'));
        row(picControls, 'Move across, down', num(t.tx, -2000, 2000, (v) => put({ tx: v })), num(t.ty, -2000, 2000, (v) => put({ ty: v })), unit('pt'));
        row(picControls, 'Tiles start at', select(ALIGNS, t.align, (v) => put({ align: v })));
        row(picControls, 'Mirror tiles', select(MIRRORS, t.mirror, (v) => put({ mirror: v })));
      }
    };
    buildPicture();

    // ------------------------------------------------ pattern
    const patBox = section();
    const swatches = document.createElement('div');
    swatches.className = 'bg-patterns';
    swatches.setAttribute('role', 'listbox');
    swatches.setAttribute('aria-label', 'Patterns');
    const SW = 30;
    const paintSwatches = () => {
      for (const b of swatches.querySelectorAll<HTMLButtonElement>('button')) {
        const id = b.dataset.pattern as PatternId;
        b.setAttribute('aria-selected', String(id === pattern.pattern));
        const c = b.firstElementChild as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        c.width = c.height = Math.round(SW * dpr);
        const g = c.getContext('2d');
        if (!g) continue;
        // one pattern dot to a screen pixel
        const k = (8 * dpr) / PATTERN_CELL;
        g.setTransform(k, 0, 0, k, 0, 0);
        paintBackground(g, { ...pattern, pattern: id }, (SW * dpr) / k, (SW * dpr) / k);
      }
    };
    for (const p of PATTERN_LIST) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bg-pattern';
      b.dataset.pattern = p.id;
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.setAttribute('role', 'option');
      const c = document.createElement('canvas');
      c.style.width = c.style.height = `${SW}px`;
      b.append(c);
      b.addEventListener('click', () => { pattern = { ...pattern, pattern: p.id }; paintSwatches(); draw(); });
      swatches.append(b);
    }
    patBox.append(swatches);
    row(patBox, 'Foreground', color(pattern.fg, (v) => { pattern = { ...pattern, fg: v }; paintSwatches(); draw(); }));
    row(patBox, 'Background', color(pattern.bg, (v) => { pattern = { ...pattern, bg: v }; paintSwatches(); draw(); }));

    // ------------------------------------------------ for every kind
    const hideBox = document.createElement('input');
    hideBox.type = 'checkbox';
    hideBox.checked = hide;
    hideBox.addEventListener('change', () => { hide = hideBox.checked; draw(); });
    const hideRow = row(grid, 'Hide background graphics', hideBox, unit('(the template\'s shapes and the logo)'));
    hideRow.classList.add('bg-hide');

    const chosen = (): Background | null => (kind === 'solid' ? solid : kind === 'gradient' ? gradient : kind === 'picture' ? picture : pattern);

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons bg-buttons';
    const btn = (label: string, title: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      return b;
    };
    const reset = btn('Reset Background', 'Give the slides the master\'s background again');
    reset.hidden = !!o.design;
    reset.disabled = !o.own;
    const all = btn('Apply to All', 'Give every slide this background (through the slide master), title slides too');
    all.hidden = !!o.design;
    const cancel = btn('Cancel', 'Close without changing anything');
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = o.design ? 'Apply' : o.count > 1 ? `Apply to ${o.count} slides` : 'Apply to this slide';
    const spacer = document.createElement('span');
    spacer.className = 'bg-spacer';
    buttons.append(reset, all, spacer, cancel, ok);
    form.append(buttons);

    const show = () => {
      solidBox.hidden = kind !== 'solid';
      gradBox.hidden = kind !== 'gradient';
      picBox.hidden = kind !== 'picture';
      patBox.hidden = kind !== 'pattern';
      if (kind === 'pattern') paintSwatches();
      draw();
    };
    function draw(): void {
      const bg = chosen();
      ok.disabled = all.disabled = !bg;
      o.preview(preview, PW, PH, bg ?? { kind: 'solid', color: '#ffffff' }, hide);
    }

    let finished = false;
    const done = (v: BackgroundResult | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    const tidy = (bg: Background): Background => (bg.kind === 'gradient' ? { ...bg, stops: sortedStops(bg.stops) } : bg);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const bg = chosen();
      if (bg) done({ action: 'apply', bg: tidy(bg), hideGraphics: hide });
    });
    all.addEventListener('click', () => { const bg = chosen(); if (bg) done({ action: 'all', bg: tidy(bg), hideGraphics: hide }); });
    reset.addEventListener('click', () => done({ action: 'reset', hideGraphics: hide }));
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    d.showModal();
    show();
  });
}
