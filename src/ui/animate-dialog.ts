// Scheme > Animate Reaction: the reaction animation window. A preview of the clip with play,
// pause and a scrubber; the timing; each step's pairing, with an editor to pair atoms by hand;
// and saving the clip as an animated GIF or a folder of PNG frames (in a zip).
//
// The animation itself is a port of cdxmorph by Ryan Shenvi (MIT, used with permission); see
// src/morph.

import type { Doc, MorphStep } from '../model';
import type { Rect, Vec } from '../geom';
import type { Renderer } from '../render/renderer';
import { planOf, buildSteps, stepSummary, Clip, DEFAULT_TIMING, gifDelayMs, type Plan, type Step, type Timing } from '../morph/clip';
import { frame } from '../morph/frame';
import { paintFrame, framesBox } from '../morph/paint';
import { atomNumbers, readMapping, writeMapping, MappingFileError } from '../morph/numbers';
import { resolve, MappingError } from '../morph/mapping';
import { configOf } from '../morph/clip';
import { encodeGif } from '../morph/gif';
import { saveFileDialog, openFileDialog, writeFile, showError, withExtension, type FileType } from '../io/files';
import { zipSync } from 'fflate';

export interface AnimateHooks {
  doc(): Doc;
  renderer(): Renderer;
  /** Atoms selected in the drawing (the animation keeps to their structures when there are any). */
  selectedAtoms(): Set<number>;
  /** Save a step's pairing on its arrow, as one Undo step. */
  setMorph(arrow: number, m: MorphStep | undefined): void;
  /** Name of the drawing, for suggested file names. */
  name(): string;
  flash(msg: string): void;
}

const GIF: FileType = { description: 'Animated GIF', extension: 'gif', mime: 'image/gif' };
const ZIP: FileType = { description: 'PNG frames (zip)', extension: 'zip', mime: 'application/zip' };
const MAPPING: FileType = { description: 'cdxmorph pairing', extension: 'json', mime: 'application/json' };
const TIMING_KEY = 'ci-animate-timing';

function savedTiming(): Timing & { width: number } {
  try {
    const v = JSON.parse(localStorage.getItem(TIMING_KEY) ?? '{}');
    return { ...DEFAULT_TIMING, width: 720, ...v };
  } catch { return { ...DEFAULT_TIMING, width: 720 }; }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (text: string, title?: string): HTMLButtonElement => {
  const b = el('button', undefined, text);
  b.type = 'button';
  if (title) b.title = title;
  return b;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

export class AnimateDialog {
  private d: HTMLDialogElement | null = null;
  private plan: Plan = { groups: [], arrows: [], kinds: [], poses: [] };
  /** Each step's settings, as saved on its arrow or changed here. */
  private morphs: (MorphStep | undefined)[] = [];
  private steps: Step[] = [];
  private clip: Clip | null = null;
  private timing = savedTiming();
  private frameNo = 0;
  private playing = false;
  private raf = 0;
  private started = 0;
  private startFrame = 0;
  private nums = new Map<number, string>();

  // pieces of the window
  private canvas!: HTMLCanvasElement;
  private scrub!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  private counter!: HTMLSpanElement;
  private stepsList!: HTMLDivElement;
  private status!: HTMLParagraphElement;
  private previewPane!: HTMLDivElement;
  private pairPane!: HTMLDivElement;
  private side!: HTMLDivElement;

  constructor(private hooks: AnimateHooks) {}

  /** Open on the whole scheme (or the selected structures), or on one arrow's step. */
  open(opts: { arrow?: number } = {}): void {
    const doc = this.hooks.doc();
    const sel = this.hooks.selectedAtoms();
    this.plan = planOf(doc, { arrow: opts.arrow, atoms: opts.arrow === undefined && sel.size ? sel : undefined });
    if (this.plan.groups.length < 2) {
      this.hooks.flash(opts.arrow !== undefined
        ? 'This arrow needs a structure on each side to animate.'
        : 'Draw at least two structures (with a reaction arrow or an equivalency sign between them) to animate.');
      return;
    }
    this.morphs = this.plan.arrows.map((a) => (a !== null ? doc.arrows.get(a)?.morph : undefined));
    this.nums = atomNumbers(doc);
    this.build();
    this.d!.showModal();
    this.rebuild();
  }

  // ---------------------------------------------------------------- the window

  private build(): void {
    this.close();
    const d = el('dialog', 'ask animate-dialog');
    d.setAttribute('aria-label', 'Animate Reaction');
    const h = el('h2', undefined, 'Animate Reaction');
    const credit = el('p', 'muted animate-credit', 'Based on cdxmorph by Ryan Shenvi (Shenvi Lab), used with permission.');

    // preview
    this.previewPane = el('div', 'animate-preview');
    this.canvas = el('canvas', 'animate-canvas');
    this.canvas.setAttribute('aria-label', 'Animation preview');
    const bar = el('div', 'animate-bar');
    this.playBtn = button('Play');
    this.playBtn.addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    this.scrub = el('input');
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.setAttribute('aria-label', 'Frame');
    this.scrub.addEventListener('input', () => { this.pause(); this.show(Number(this.scrub.value)); });
    this.counter = el('span', 'animate-counter');
    bar.append(this.playBtn, this.scrub, this.counter);
    this.previewPane.append(this.canvas, bar);

    // pairing editor (in place of the preview while open)
    this.pairPane = el('div', 'animate-pairing');
    this.pairPane.hidden = true;

    // settings
    const side = (this.side = el('div', 'animate-side'));
    const timing = el('fieldset', 'animate-timing');
    timing.append(el('legend', undefined, 'Timing'));
    const num = (label: string, key: 'duration' | 'fps' | 'hold' | 'pause' | 'width', step: number, min: number, max: number, title: string) => {
      const row = el('label', 'ask-row');
      const input = el('input');
      input.type = 'number';
      input.step = String(step);
      input.min = String(min);
      input.max = String(max);
      input.value = String(this.timing[key]);
      input.title = title;
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        (this.timing[key] as number) = Math.max(min, Math.min(max, v));
        input.value = String(this.timing[key]);
        this.remember();
        if (key !== 'width') this.remake();
      });
      row.append(el('span', undefined, label), input);
      return row;
    };
    const ease = el('select');
    for (const [v, t] of [['smoothstep', 'Smooth (ease in and out)'], ['linear', 'Steady']] as const) {
      const o = el('option', undefined, t);
      o.value = v;
      ease.append(o);
    }
    ease.value = this.timing.ease;
    ease.addEventListener('change', () => { this.timing.ease = ease.value as Timing['ease']; this.remember(); this.remake(); });
    const easeRow = el('label', 'ask-row');
    easeRow.append(el('span', undefined, 'Movement'), ease);
    const bounce = el('input');
    bounce.type = 'checkbox';
    bounce.checked = this.timing.bounce;
    bounce.addEventListener('change', () => { this.timing.bounce = bounce.checked; this.remember(); this.remake(); });
    const bounceRow = el('label', 'ask-row ask-check');
    bounceRow.append(bounce, el('span', undefined, 'Play back to the start (a seamless loop)'));
    timing.append(
      num('Moving (s)', 'duration', 0.1, 0.2, 60, 'Seconds of movement, shared between the steps'),
      num('Frames per second', 'fps', 1, 5, 60, 'GIFs store whole hundredths of a second, so 24 plays at 25'),
      num('Hold at ends (s)', 'hold', 0.1, 0, 10, 'Seconds held still on the first and last structures'),
      num('Pause between (s)', 'pause', 0.1, 0, 10, 'Seconds held on each structure in between'),
      easeRow, bounceRow,
      num('Width (pixels)', 'width', 10, 100, 4000, 'Width of the saved GIF or PNG frames'),
    );

    const stepsBox = el('fieldset', 'animate-steps');
    stepsBox.append(el('legend', undefined, 'Steps'));
    this.stepsList = el('div');
    stepsBox.append(this.stepsList);
    side.append(timing, stepsBox);

    this.status = el('p', 'animate-status');
    this.status.setAttribute('role', 'status');

    const body = el('div', 'animate-body');
    body.append(this.previewPane, this.pairPane, side);

    const actions = el('div', 'ask-buttons animate-actions');
    const imp = button('Import Pairing…', 'Read a cdxmorph .mapping.json (atoms by ChemDraw atom number)');
    imp.addEventListener('click', () => void this.importMapping());
    const exp = button('Export Pairing…', 'Save the pairing as a cdxmorph .mapping.json');
    exp.addEventListener('click', () => void this.exportMapping());
    const png = button('Save PNG Frames…', 'Every frame as a PNG picture, in one zip');
    png.addEventListener('click', () => void this.savePngs());
    const gif = button('Save GIF…');
    gif.classList.add('primary');
    gif.addEventListener('click', () => void this.saveGif());
    const close = button('Close');
    close.addEventListener('click', () => this.close());
    actions.append(imp, exp, el('span', 'spacer'), png, gif, close);

    d.append(h, credit, body, this.status, actions);
    d.addEventListener('close', () => this.teardown());
    d.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (this.playing) this.pause(); else this.play();
      }
    });
    document.body.append(d);
    this.d = d;
  }

  private remember(): void {
    try { localStorage.setItem(TIMING_KEY, JSON.stringify(this.timing)); } catch { /* not kept: fine */ }
  }

  close(): void {
    if (this.d?.open) this.d.close();
    else this.teardown();
  }

  private teardown(): void {
    this.pause();
    this.d?.remove();
    this.d = null;
  }

  // ---------------------------------------------------------------- building the clip

  /** Pair the structures again (a pairing changed). */
  private rebuild(): void {
    this.steps = buildSteps(this.hooks.doc(), this.plan, this.hooks.renderer(), this.morphs);
    this.remake();
    this.listSteps();
  }

  /** Make the clip again (the timing changed). */
  private remake(): void {
    this.clip = new Clip(this.steps, this.timing);
    this.scrub.max = String(Math.max(0, this.clip.length - 1));
    this.frameNo = Math.min(this.frameNo, this.clip.length - 1);
    this.sizeCanvas();
    this.show(this.frameNo);
  }

  private sizeCanvas(): void {
    if (!this.clip) return;
    const box = this.clip.box;
    const cssW = Math.max(240, this.previewPane.clientWidth || 560);
    const k = cssW / Math.max(1, box.x2 - box.x1);
    const cssH = Math.min(440, Math.max(140, (box.y2 - box.y1) * k));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  private show(i: number): void {
    const clip = this.clip;
    if (!clip) return;
    this.frameNo = i;
    this.scrub.value = String(i);
    this.counter.textContent = `${i + 1} / ${clip.length} · ${clip.seconds.toFixed(1)} s`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const box = clip.box;
    const scale = Math.min(this.canvas.width / (box.x2 - box.x1), this.canvas.height / (box.y2 - box.y1));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const ox = (this.canvas.width - (box.x2 - box.x1) * scale) / 2, oy = (this.canvas.height - (box.y2 - box.y1) * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, ox - box.x1 * scale, oy - box.y1 * scale);
    const [step, t] = clip.frames[i] ?? [0, 0];
    clip.paintAt(ctx, step, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private play(): void {
    if (!this.clip || this.playing) return;
    this.playing = true;
    this.playBtn.textContent = 'Pause';
    this.started = performance.now();
    this.startFrame = this.frameNo >= this.clip.length - 1 ? 0 : this.frameNo;
    const step = (now: number) => {
      if (!this.playing || !this.clip) return;
      const i = (this.startFrame + Math.floor(((now - this.started) / 1000) * this.clip.rate)) % this.clip.length;
      if (i !== this.frameNo) this.show(i);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    if (this.playBtn) this.playBtn.textContent = 'Play';
  }

  // ---------------------------------------------------------------- steps

  private listSteps(): void {
    this.stepsList.replaceChildren();
    const n = (k: string) => this.nums.get(Number(k)) ?? k;
    const bondText = (l: [string, string][]) => (l.length ? l.map(([a, b]) => `${n(a)}–${n(b)}`).join(', ') : 'none');
    this.steps.forEach((s, i) => {
      const sm = stepSummary(s);
      const row = el('div', 'animate-step');
      const head = el('div', 'animate-step-head');
      const title = el('strong', undefined, (this.steps.length > 1 ? `Step ${i + 1}` : 'The step') + (s.kind === 'turn' ? ' (turn)' : ''));
      const how = el('span', 'muted', this.morphs[i]?.pairs?.length ? (this.morphs[i]!.exact ? ' · your pairs only' : ' · your pairs + automatic') : ' · automatic');
      const edit = button('Edit Pairing…', 'Choose which atom becomes which; see the bonds that break and form');
      edit.addEventListener('click', () => this.editPairing(i));
      head.append(title, how, edit);
      const facts = el('div', 'animate-step-facts');
      facts.textContent = `${sm.paired} of ${sm.startAtoms} atoms paired. Breaking: ${bondText(sm.breaking)}. Forming: ${bondText(sm.forming)}.`;
      if (s.kind === 'turn') {
        const t = s.turn;
        facts.textContent = (t
          ? `Turns ${t.degrees.toFixed(1)}° in 3-D, measured from ${t.mode === 'guided' ? 'the 3-D structures drawn above' : 'the structures\' own 3-D coordinates'} (${t.measured}).`
          : 'The same molecule redrawn. With no 3-D structure above each drawing, the atoms move across the page.')
          + ` ${sm.paired} of ${sm.startAtoms} atoms paired.`;
        if (t?.reflected) row.append(el('div', 'animate-error', 'The two 3-D structures are mirror images, so no turn takes one to the other; this turn is the closest one.'));
      }
      row.append(head, facts);
      if (s.error) row.append(el('div', 'animate-error', s.kind === 'turn' && !s.turn ? `This turn couldn't be measured in 3-D (${s.error}), so the atoms move across the page instead.` : `The saved pairing no longer fits (${s.error}), so this step is paired automatically.`));
      this.stepsList.append(row);
    });
  }

  // ---------------------------------------------------------------- the pairing editor

  private editPairing(i: number): void {
    this.pause();
    const base = this.steps[i];
    const A = base.A, B = base.B;
    const m: MorphStep = structuredClone(this.morphs[i] ?? {});
    let pending: string | null = null;
    let hover: { side: 'A' | 'B'; key: string } | null = null;
    const pane = this.pairPane;
    pane.replaceChildren();
    const intro = el('p', 'muted', 'Click an atom on the left, then the atom it becomes on the right. Click a paired atom on the left again to unpair it. Your pairs are kept; the rest is matched automatically unless you tick the box. Red bonds break and green bonds form. Numbers are blue for pairs you chose, grey for pairs matched automatically and orange for atoms with no partner.');
    const row = el('div', 'animate-pair-canvases');
    const cA = el('canvas', 'animate-pair-canvas');
    const cB = el('canvas', 'animate-pair-canvas');
    cA.setAttribute('aria-label', 'Starting structure');
    cB.setAttribute('aria-label', 'Product');
    row.append(cA, cB);
    const exact = el('input');
    exact.type = 'checkbox';
    exact.checked = !!m.exact;
    const exactRow = el('label', 'ask-row ask-check');
    exactRow.append(exact, el('span', undefined, 'Use only my pairs (no automatic matching)'));
    const nn = (id: number) => this.nums.get(id) ?? String(id);
    const shiftIn = el('input');
    shiftIn.placeholder = 'e.g. 14-17>21';
    shiftIn.title = '1,2-shifts, in the starting structure\'s numbers: bond 14–17 keeps its 14 end and walks its 17 end onto atom 21. Separate several with commas.';
    shiftIn.value = (m.shifts ?? []).map(([u, v, d]) => `${nn(u)}-${nn(v)}>${nn(d)}`).join(', ');
    const shiftRow = el('label', 'ask-row');
    shiftRow.append(el('span', undefined, '1,2-shifts'), shiftIn);
    const slideIn = el('input');
    slideIn.placeholder = 'e.g. 7-8>4-7';
    slideIn.title = 'A double bond\'s second line that moves to another bond, in the starting structure\'s numbers. Separate several with commas.';
    slideIn.value = (m.slides ?? []).map(([[a, b], [c, e]]) => `${nn(a)}-${nn(b)}>${nn(c)}-${nn(e)}`).join(', ');
    const slideRow = el('label', 'ask-row');
    slideRow.append(el('span', undefined, 'Moving lines'), slideIn);
    const facts = el('p', 'animate-step-facts');
    const err = el('p', 'animate-error');
    const actions = el('div', 'ask-buttons');
    const clear = button('Clear My Pairs');
    const cancel = button('Cancel');
    const save = button(this.plan.arrows[i] !== null ? 'Save Pairing' : 'Use Pairing', this.plan.arrows[i] !== null ? 'Kept with the arrow when the drawing is saved' : 'These structures have no arrow between them, so the pairing lasts while this window is open');
    save.classList.add('primary');
    actions.append(clear, el('span', 'spacer'), cancel, save);
    pane.append(el('h3', undefined, this.steps.length > 1 ? `Pairing for step ${i + 1}` : 'Pairing'), intro, row, exactRow, shiftRow, slideRow, facts, err, actions);
    this.previewPane.hidden = true;
    this.side.hidden = true;
    pane.hidden = false;

    const byNum = new Map<string, number>();
    for (const [id, v] of this.nums) byNum.set(v, id);
    const parseList = (text: string, parts: number): number[][] => {
      const out: number[][] = [];
      for (const item of text.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        const xs = item.split(/[>\-–→\s]+/).filter(Boolean);
        if (xs.length !== parts) throw new MappingError(`“${item}” should look like ${parts === 3 ? '14-17>21' : '7-8>4-7'}.`);
        out.push(xs.map((x) => {
          const id = byNum.get(x);
          if (id === undefined) throw new MappingError(`There is no atom ${x}.`);
          return id;
        }));
      }
      return out;
    };
    /** The pairing as typed so far, and what it does (or why it can't be). */
    const current = () => {
      const mm: MorphStep = {};
      if (m.pairs?.length) mm.pairs = m.pairs;
      if (exact.checked && m.pairs?.length) mm.exact = true;
      const sh = parseList(shiftIn.value, 3);
      if (sh.length) mm.shifts = sh as [number, number, number][];
      const sl = parseList(slideIn.value, 4);
      if (sl.length) mm.slides = sl.map(([a, b, c, d]) => [[a, b], [c, d]]);
      return mm;
    };
    let map = base.map;
    const forced = () => new Map((m.pairs ?? []).map(([a, b]) => [String(a), String(b)]));
    const refresh = () => {
      err.textContent = '';
      try {
        map = resolve(configOf(current(), A, B), A, B, base.kind === 'turn');
      } catch (e) {
        if (!(e instanceof MappingError)) throw e;
        err.textContent = e.message;
      }
      const sm = stepSummary({ ...base, map });
      const n = (k: string) => nn(Number(k));
      const bt = (l: [string, string][]) => (l.length ? l.map(([a, b]) => `${n(a)}–${n(b)}`).join(', ') : 'none');
      facts.textContent = `${sm.paired} of ${sm.startAtoms} atoms paired (${m.pairs?.length ?? 0} by you). Breaking: ${bt(sm.breaking)}. Forming: ${bt(sm.forming)}.`;
      draw();
    };

    // drawing the two structures, with numbers and what changes
    const views = { A: { c: cA, box: null as Rect | null, k: 1, ox: 0, oy: 0 }, B: { c: cB, box: null as Rect | null, k: 1, ox: 0, oy: 0 } };
    const draw = () => {
      const breaking = new Set<string>(), forming = new Set<string>();
      const sm = stepSummary({ ...base, map });
      for (const [a, b] of sm.breaking) breaking.add(A.bondBetween(a, b) ?? '');
      for (const [a, b] of sm.forming) forming.add(B.bondBetween(a, b) ?? '');
      const unA = new Set(sm.unpairedStart), unB = new Set(sm.unpairedProduct);
      const mine = forced();
      const mineB = new Set(mine.values());
      for (const side of ['A', 'B'] as const) {
        const v = views[side];
        const sc = side === 'A' ? A : B;
        const F = frame(A, B, map, side === 'A' ? 0 : 1, base.opt);
        const box = framesBox([F], 10);
        const cssW = Math.max(160, (pane.clientWidth - 8) / 2 || 300), cssH = Math.round(cssW * 0.9);
        const dpr = window.devicePixelRatio || 1;
        v.c.width = Math.round(cssW * dpr);
        v.c.height = Math.round(cssH * dpr);
        const k = Math.min(v.c.width / (box.x2 - box.x1), v.c.height / (box.y2 - box.y1));
        v.box = box; v.k = k;
        v.ox = (v.c.width - (box.x2 - box.x1) * k) / 2 - box.x1 * k;
        v.oy = (v.c.height - (box.y2 - box.y1) * k) / 2 - box.y1 * k;
        const ctx = v.c.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, v.c.width, v.c.height);
        ctx.setTransform(k, 0, 0, k, v.ox, v.oy);
        // what changes, underneath
        ctx.lineCap = 'round';
        for (const [key, b] of sc.bonds) {
          const hit = side === 'A' ? breaking.has(key) : forming.has(key);
          if (!hit) continue;
          const p = sc.nodes.get(b.b)!.p, q = sc.nodes.get(b.e)!.p;
          ctx.strokeStyle = side === 'A' ? 'rgba(220, 40, 40, 0.35)' : 'rgba(30, 160, 60, 0.35)';
          ctx.lineWidth = sc.style.bondLength * 0.3;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
        paintFrame(ctx, F, sc.style, side === 'A' ? 0 : 1);
        // atoms: numbers, and rings for the unpaired, the ones you paired and the one picked
        const size = sc.style.labelSize * 0.62;
        ctx.font = `${size}px ${sc.style.font}`;
        ctx.textBaseline = 'middle';
        for (const [key, node] of sc.nodes) {
          const p = node.p;
          const partner = side === 'A' ? map.nmap.get(key) : [...map.nmap].find(([, b]) => b === key)?.[0];
          const lit = hover && ((hover.side === side && hover.key === key) || (hover.side !== side && (hover.side === 'A' ? map.nmap.get(hover.key) === key : map.nmap.get(key) === hover.key)));
          const r = sc.style.bondLength * 0.22;
          if ((side === 'A' ? unA : unB).has(key)) ring(ctx, p, r, 'rgba(235, 130, 0, 0.9)');
          if (pending === key && side === 'A') ring(ctx, p, r * 1.5, 'rgba(40, 90, 220, 1)');
          if (lit) ring(ctx, p, r * 1.5, 'rgba(120, 60, 200, 0.9)');
          // numbers: orange with no partner, blue for a pair you chose, grey for one matched automatically
          ctx.fillStyle = partner === undefined ? 'rgba(235, 130, 0, 1)' : (side === 'A' ? mine.has(key) : mineB.has(key)) ? 'rgba(40, 90, 220, 1)' : 'rgba(110, 110, 110, 1)';
          ctx.fillText(nn(Number(key)), p.x + r * 0.9, p.y - r * 1.1);
        }
      }
    };
    const ring = (ctx: CanvasRenderingContext2D, p: Vec, r: number, colour: string) => {
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = r * 0.22;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    };
    const atomAt = (side: 'A' | 'B', e: MouseEvent): string | null => {
      const v = views[side];
      const rect = v.c.getBoundingClientRect();
      const dpr = v.c.width / rect.width;
      const x = ((e.clientX - rect.left) * dpr - v.ox) / v.k, y = ((e.clientY - rect.top) * dpr - v.oy) / v.k;
      const sc = side === 'A' ? A : B;
      let best: string | null = null, bd = sc.style.bondLength * 0.45;
      for (const [key, n] of sc.nodes) { const d = Math.hypot(n.p.x - x, n.p.y - y); if (d < bd) { bd = d; best = key; } }
      return best;
    };
    cA.addEventListener('click', (e) => {
      const k = atomAt('A', e);
      if (!k) { pending = null; draw(); return; }
      if (pending === k) { pending = null; draw(); return; }
      const has = (m.pairs ?? []).findIndex(([a]) => String(a) === k);
      if (has >= 0 && pending === null) { m.pairs!.splice(has, 1); refresh(); return; }
      pending = k;
      draw();
    });
    cB.addEventListener('click', (e) => {
      const k = atomAt('B', e);
      if (!k || pending === null) return;
      const pairs = (m.pairs ?? []).filter(([a, b]) => String(a) !== pending && String(b) !== k);
      pairs.push([Number(pending), Number(k)]);
      m.pairs = pairs;
      pending = null;
      refresh();
    });
    for (const side of ['A', 'B'] as const) {
      views[side].c.addEventListener('mousemove', (e) => {
        const k = atomAt(side, e);
        const next = k ? { side, key: k } : null;
        if (JSON.stringify(next) !== JSON.stringify(hover)) { hover = next; draw(); }
      });
    }
    exact.addEventListener('change', refresh);
    shiftIn.addEventListener('change', refresh);
    slideIn.addEventListener('change', refresh);
    clear.addEventListener('click', () => { m.pairs = []; pending = null; refresh(); });
    const leave = () => { pane.hidden = true; this.previewPane.hidden = false; this.side.hidden = false; this.show(this.frameNo); };
    cancel.addEventListener('click', leave);
    save.addEventListener('click', () => {
      let mm: MorphStep;
      try {
        mm = current();
        resolve(configOf(mm, A, B), A, B);
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : String(e);
        return;
      }
      const empty = !mm.pairs?.length && !mm.shifts?.length && !mm.slides?.length;
      this.morphs[i] = empty ? undefined : mm;
      const arrow = this.plan.arrows[i];
      if (arrow !== null) this.hooks.setMorph(arrow, this.morphs[i]);
      leave();
      this.rebuild();
    });
    refresh();
  }

  // ---------------------------------------------------------------- files

  private async importMapping(): Promise<void> {
    const got = await openFileDialog([MAPPING]).catch(async (e) => { await showError(String(e)); return null; });
    if (!got) return;
    let morphs: MorphStep[];
    try {
      morphs = readMapping(this.hooks.doc(), got.text, this.steps.length);
    } catch (e) {
      this.say(e instanceof MappingFileError ? e.message : String(e), true);
      return;
    }
    this.morphs = morphs.map((m) => (Object.keys(m).length ? m : undefined));
    morphs.forEach((_, i) => { const a = this.plan.arrows[i]; if (a !== null) this.hooks.setMorph(a, this.morphs[i]); });
    this.rebuild();
    const bad = this.steps.filter((s) => s.error).length;
    this.say(bad ? `Read ${got.name}, but ${bad} step${bad > 1 ? 's' : ''} could not use it.` : `Read the pairing from ${got.name}.`, bad > 0);
  }

  private async exportMapping(): Promise<void> {
    const name = withExtension(this.hooks.name(), 'mapping.json');
    const target = await saveFileDialog(name, MAPPING).catch(async (e) => { await showError(String(e)); return null; });
    if (!target) return;
    // the full pairing each step uses, so cdxmorph animates it the same way
    const full: MorphStep[] = this.steps.map((s, i) => ({
      ...(this.morphs[i] ?? {}),
      pairs: [...s.map.nmap].map(([a, b]) => [Number(a), Number(b)] as [number, number]),
      exact: true,
    }));
    await writeFile(target.ref, target.name, writeMapping(this.hooks.doc(), full), MAPPING).catch((e) => showError(String(e)));
    this.say(`Saved ${target.name}.`);
  }

  /** Frames at the chosen width, one at a time. */
  private frames(): { n: number; w: number; h: number; at: (i: number) => { data: Uint8ClampedArray; width: number; height: number; canvas: HTMLCanvasElement } } | null {
    const clip = this.clip;
    if (!clip) return null;
    const scale = this.timing.width / (clip.box.x2 - clip.box.x1);
    const { w, h } = clip.size(scale);
    const c = el('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    return {
      n: clip.length, w, h,
      at: (i) => {
        clip.draw(ctx, i, scale);
        return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, canvas: c };
      },
    };
  }

  private async saveGif(): Promise<void> {
    this.pause();
    const target = await saveFileDialog(withExtension(this.hooks.name(), 'gif'), GIF).catch(async (e) => { await showError(String(e)); return null; });
    if (!target) return;
    // GIFs keep delays in hundredths of a second: count frames at the rate they will really play at
    const steps = this.steps;
    const clip = new Clip(steps, this.timing, true);
    const keep = this.clip;
    this.clip = clip;
    const f = this.frames();
    this.clip = keep;
    if (!f) return;
    this.say('Making the GIF…');
    let shown = 0;
    const bytes = await encodeGif(f.n, async (i) => {
      if (i - shown > 8) { shown = i; await tick(); }
      return f.at(i);
    }, gifDelayMs(this.timing.fps));
    await writeFile(target.ref, target.name, bytes, GIF).catch((e) => showError(String(e)));
    this.say(`Saved ${target.name} (${f.w} × ${f.h}, ${(bytes.length / 1024).toFixed(0)} KB).`);
  }

  private async savePngs(): Promise<void> {
    this.pause();
    const target = await saveFileDialog(withExtension(this.hooks.name(), 'zip'), ZIP).catch(async (e) => { await showError(String(e)); return null; });
    if (!target) return;
    const f = this.frames();
    if (!f) return;
    this.say('Making the frames…');
    const files: Record<string, [Uint8Array, { level: 0 }]> = {};
    const stem = this.hooks.name().replace(/\.[^.]+$/, '') || 'frame';
    for (let i = 0; i < f.n; i++) {
      const { canvas } = f.at(i);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) continue;
      files[`${stem}_${String(i).padStart(4, '0')}.png`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    }
    const bytes = zipSync(files);
    await writeFile(target.ref, target.name, bytes, ZIP).catch((e) => showError(String(e)));
    this.say(`Saved ${f.n} frames in ${target.name}.`);
  }

  private say(text: string, bad = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('animate-error', bad);
  }
}
