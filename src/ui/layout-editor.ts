// Slide Master > Edit Layouts…: the deck's layouts, as in PowerPoint's Slide Master view. Pick a
// layout on the left to see it on the slide; drag its placeholders to move them, drag a corner to
// size them, or type their place in per cent. Add title, text and subtitle placeholders, rename a
// layout, give it the title slide's colours, make new layouts (or copies), delete the ones made
// here, and put a built-in layout back as it came. Slides with a changed layout follow it when
// the window is closed with Apply; Undo puts everything back.

import { Doc, type Placeholder } from '../model';
import {
  type Master, type SlideSize, type LayoutDef, type LayoutId, type PlaceholderBox,
  deckLayouts, copyLayout, isBuiltinLayout, builtinLayout, newLayoutId,
} from '../deck/deck';
import { paintSlide } from '../deck/slide-view';

export interface LayoutEditorInput {
  master: Master;
  size: SlideSize;
  /** The layout to show first (the slide being edited's). */
  current: LayoutId;
  /** How many slides use each layout (deleting one in use says so). */
  used: Map<LayoutId, number>;
}

const PH_NAME: Record<Placeholder, string> = { title: 'Title', subtitle: 'Subtitle', body: 'Text' };
const PROMPT: Record<Placeholder, string> = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: '• Click to add text' };

/** Fractions kept to a tidy step (a quarter of a per cent) and inside the slide. */
const tidy = (v: number) => Math.round(v * 400) / 400;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Resolves with the deck's layouts as changed, or null when cancelled. */
export function editLayouts(input: LayoutEditorInput): Promise<LayoutDef[] | null> {
  return new Promise((resolve) => {
    const { size } = input;
    let layouts = deckLayouts(input.master).map(copyLayout);
    let sel = Math.max(0, layouts.findIndex((l) => l.id === input.current));
    let box = -1;

    const d = document.createElement('dialog');
    d.className = 'layout-editor';
    const form = document.createElement('form');
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = 'Slide Layouts';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Drag a placeholder to move it and its corner to size it. Slides with a layout follow it when you apply; text already typed is kept.';
    form.append(h, note);

    const body = document.createElement('div');
    body.className = 'le-body';
    form.append(body);

    // ---------------- the list of layouts
    const side = document.createElement('div');
    side.className = 'le-side';
    const list = document.createElement('div');
    list.className = 'le-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Layouts');
    const sideButtons = document.createElement('div');
    sideButtons.className = 'le-side-buttons';
    const btn = (label: string, title: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', run);
      return b;
    };
    const newBtn = btn('New Layout', 'A new layout with a title and a text box', () => {
      const id = newLayoutId(layouts);
      layouts.push({ id, name: uniqueName('Custom Layout'), boxes: builtinLayout('title-content').boxes });
      sel = layouts.length - 1; box = -1; render();
    });
    const dupBtn = btn('Duplicate', 'A copy of this layout, to change', () => {
      const l = layouts[sel];
      layouts.push({ ...copyLayout(l), id: newLayoutId(layouts), name: uniqueName(`${l.name} copy`) });
      sel = layouts.length - 1; box = -1; render();
    });
    const delBtn = btn('Delete', 'Delete this layout (only layouts made here)', () => {
      const l = layouts[sel];
      if (isBuiltinLayout(l.id)) return;
      layouts.splice(sel, 1);
      sel = Math.min(sel, layouts.length - 1); box = -1; render();
    });
    const resetBtn = btn('Reset', 'Put this built-in layout back as it came', () => {
      const l = layouts[sel];
      if (!isBuiltinLayout(l.id)) return;
      layouts[sel] = builtinLayout(l.id);
      box = -1; render();
    });
    sideButtons.append(newBtn, dupBtn, delBtn, resetBtn);
    side.append(list, sideButtons);

    // ---------------- the layout picked
    const main = document.createElement('div');
    main.className = 'le-main';
    const top = document.createElement('div');
    top.className = 'le-top';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name ';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'le-name';
    nameLabel.append(name);
    const lookLabel = document.createElement('label');
    lookLabel.className = 'le-check';
    const look = document.createElement('input');
    look.type = 'checkbox';
    lookLabel.append(look, ' Title slide colours and background');
    lookLabel.title = 'Slides with this layout use the title slide\'s own colours (Slide Master > Title slides), and leave the slide number off unless title slides show it';
    top.append(nameLabel, lookLabel);
    name.addEventListener('input', () => { layouts[sel].name = name.value; paintList(); });
    look.addEventListener('change', () => { layouts[sel].titleLook = look.checked; paintStage(); paintList(); });

    const tools = document.createElement('div');
    tools.className = 'le-tools';
    const add = (ph: Placeholder) => btn(`+ ${PH_NAME[ph]}`, `Put a ${PH_NAME[ph].toLowerCase()} placeholder on this layout`, () => {
      const l = layouts[sel];
      if (ph === 'title' && l.boxes.some((b) => b.ph === 'title')) { flashNote('A layout has one title.'); return; }
      const nb: PlaceholderBox = ph === 'title'
        ? { ph, x: 0.05, y: 0.05, w: 0.9, h: 0.14, justify: 'left' }
        : { ph, x: 0.1 + 0.03 * (l.boxes.length % 5), y: 0.3 + 0.03 * (l.boxes.length % 5), w: 0.4, h: ph === 'subtitle' ? 0.12 : 0.4, justify: ph === 'subtitle' ? 'center' : 'left' };
      l.boxes.push(nb);
      box = l.boxes.length - 1;
      render();
    });
    const delPh = btn('Delete Placeholder', 'Take the placeholder picked off this layout (Delete)', () => removeBox());
    const align = document.createElement('select');
    align.title = 'How the placeholder\'s text lines up';
    for (const [v, l] of [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]) align.add(new Option(l, v));
    align.addEventListener('change', () => {
      const b = layouts[sel].boxes[box];
      if (b) { b.justify = align.value as PlaceholderBox['justify']; paintStage(); }
    });
    const pos: Record<'x' | 'y' | 'w' | 'h', HTMLInputElement> = {} as never;
    const posBox = document.createElement('span');
    posBox.className = 'le-pos';
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = '0';
      i.max = '100';
      i.step = 'any';
      i.title = { x: 'Left edge, per cent of the slide width', y: 'Top edge, per cent of the slide height', w: 'Width, per cent of the slide width', h: 'Height, per cent of the slide height' }[k];
      i.addEventListener('change', () => {
        const b = layouts[sel].boxes[box];
        const v = parseFloat(i.value);
        if (!b || !Number.isFinite(v)) return;
        b[k] = clamp(tidy(v / 100), k === 'w' || k === 'h' ? 0.02 : 0, 1);
        b.x = clamp(b.x, 0, 1 - b.w); b.y = clamp(b.y, 0, 1 - b.h);
        showBox(); paintStage();
      });
      const lab = document.createElement('label');
      lab.textContent = `${k.toUpperCase()} `;
      lab.append(i);
      posBox.append(lab);
      pos[k] = i;
    }
    tools.append(add('title'), add('body'), add('subtitle'), delPh, align, posBox);

    const stageWrap = document.createElement('div');
    stageWrap.className = 'le-stage-wrap';
    const stage = document.createElement('div');
    stage.className = 'le-stage';
    stage.tabIndex = 0;
    const SW = 560, SH = Math.round((SW * size.h) / size.w);
    stage.style.width = `${SW}px`;
    stage.style.height = `${SH}px`;
    const canvas = document.createElement('canvas');
    canvas.className = 'le-canvas';
    canvas.style.width = `${SW}px`;
    canvas.style.height = `${SH}px`;
    stage.append(canvas);
    stageWrap.append(stage);
    const status = document.createElement('p');
    status.className = 'muted le-status';
    main.append(top, tools, stageWrap, status);
    body.append(side, main);

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = btn('Cancel', '', () => done(null));
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Apply';
    buttons.append(cancel, ok);
    form.append(buttons);

    function uniqueName(base: string): string {
      let n = base, k = 2;
      while (layouts.some((l) => l.name === n)) n = `${base} ${k++}`;
      return n;
    }
    let noteTimer = 0;
    function flashNote(s: string): void {
      status.textContent = s;
      clearTimeout(noteTimer);
      noteTimer = window.setTimeout(showStatus, 3000);
    }
    function showStatus(): void {
      const l = layouts[sel];
      const n = input.used.get(l.id) ?? 0;
      status.textContent = `${n ? `${n} slide${n === 1 ? ' uses' : 's use'} this layout.` : 'No slide uses this layout yet.'}${isBuiltinLayout(l.id) ? ' Built-in layouts can be changed and reset, not deleted.' : n ? ' Deleting it gives those slides Title and Content.' : ''}`;
    }

    /** The master as it would be, for painting (the layouts changed so far). */
    const masterNow = (): Master => ({ ...input.master, layouts: layouts.map(copyLayout) });

    function paintList(): void {
      const m = masterNow();
      list.querySelectorAll<HTMLElement>('.le-item').forEach((it, i) => {
        const l = layouts[i];
        if (!l) return;
        it.querySelector('.le-item-name')!.textContent = l.name || '(no name)';
        const c = it.querySelector('canvas')!;
        const dpr = window.devicePixelRatio || 1;
        const at = paintSlide(c, 96, Math.round((96 * size.h) / size.w), dpr, { size, master: m, layout: l.id, index: 0 }, new Doc());
        // the placeholders' outlines
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.setTransform(at.k * dpr, 0, 0, at.k * dpr, at.x * dpr, at.y * dpr);
          ctx.lineWidth = 1 / at.k;
          ctx.strokeStyle = 'rgba(90, 100, 120, 0.8)';
          for (const b of l.boxes) ctx.strokeRect(b.x * size.w, b.y * size.h, b.w * size.w, b.h * size.h);
        }
      });
    }

    function render(): void {
      list.replaceChildren(...layouts.map((l, i) => {
        const it = document.createElement('button');
        it.type = 'button';
        it.className = i === sel ? 'le-item current' : 'le-item';
        it.setAttribute('role', 'option');
        it.setAttribute('aria-selected', String(i === sel));
        const c = document.createElement('canvas');
        c.style.width = '96px';
        c.style.height = `${Math.round((96 * size.h) / size.w)}px`;
        const n = document.createElement('span');
        n.className = 'le-item-name';
        it.append(c, n);
        it.addEventListener('click', () => { sel = i; box = -1; render(); });
        return it;
      }));
      paintList();
      const l = layouts[sel];
      name.value = l.name;
      look.checked = l.titleLook ?? l.id === 'title';
      delBtn.disabled = isBuiltinLayout(l.id);
      resetBtn.disabled = !isBuiltinLayout(l.id) || JSON.stringify(l) === JSON.stringify(builtinLayout(l.id));
      showStatus();
      paintStage();
    }

    function showBox(): void {
      const b = layouts[sel].boxes[box];
      delPh.disabled = align.disabled = !b;
      for (const k of ['x', 'y', 'w', 'h'] as const) {
        pos[k].disabled = !b;
        pos[k].value = b ? String(+(b[k] * 100).toFixed(2)) : '';
      }
      if (b) align.value = b.justify === 'justify' ? 'left' : b.justify;
    }

    function paintStage(): void {
      const l = layouts[sel];
      const m = masterNow();
      paintSlide(canvas, SW, SH, window.devicePixelRatio || 1, { size, master: m, layout: l.id, index: 0 }, new Doc());
      for (const old of stage.querySelectorAll('.le-ph')) old.remove();
      l.boxes.forEach((b, i) => {
        const el = document.createElement('div');
        el.className = i === box ? 'le-ph picked' : 'le-ph';
        el.style.left = `${b.x * SW}px`;
        el.style.top = `${b.y * SH}px`;
        el.style.width = `${b.w * SW}px`;
        el.style.height = `${b.h * SH}px`;
        el.style.textAlign = b.justify === 'center' ? 'center' : b.justify === 'right' ? 'right' : 'left';
        el.title = `${PH_NAME[b.ph]} placeholder: drag to move, drag the corner to size`;
        const t = document.createElement('span');
        t.className = `le-ph-text le-ph-${b.ph}`;
        t.textContent = PROMPT[b.ph];
        el.append(t);
        for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
          const hd = document.createElement('span');
          hd.className = `le-handle ${corner}`;
          hd.addEventListener('pointerdown', (e) => drag(e, i, corner));
          el.append(hd);
        }
        el.addEventListener('pointerdown', (e) => drag(e, i, null));
        stage.append(el);
      });
      showBox();
      resetBtn.disabled = !isBuiltinLayout(l.id) || JSON.stringify(l) === JSON.stringify(builtinLayout(l.id));
    }

    /** Move (or, by a corner, size) placeholder i with the mouse. */
    function drag(e: PointerEvent, i: number, corner: 'nw' | 'ne' | 'sw' | 'se' | null): void {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      box = i;
      const b = layouts[sel].boxes[i];
      const start = { ...b }, x0 = e.clientX, y0 = e.clientY;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture?.(e.pointerId);
      paintStage();
      stage.focus();
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - x0) / SW, dy = (ev.clientY - y0) / SH;
        if (!corner) {
          b.x = clamp(tidy(start.x + dx), 0, 1 - b.w);
          b.y = clamp(tidy(start.y + dy), 0, 1 - b.h);
        } else {
          let x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h;
          if (corner.includes('w')) x1 = clamp(tidy(x1 + dx), 0, x2 - 0.02); else x2 = clamp(tidy(x2 + dx), x1 + 0.02, 1);
          if (corner.includes('n')) y1 = clamp(tidy(y1 + dy), 0, y2 - 0.02); else y2 = clamp(tidy(y2 + dy), y1 + 0.02, 1);
          Object.assign(b, { x: x1, y: y1, w: tidy(x2 - x1), h: tidy(y2 - y1) });
        }
        const ph = stage.querySelectorAll<HTMLElement>('.le-ph')[i];
        if (ph) Object.assign(ph.style, { left: `${b.x * SW}px`, top: `${b.y * SH}px`, width: `${b.w * SW}px`, height: `${b.h * SH}px` });
        showBox();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        paintStage();
        paintList();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    function removeBox(): void {
      const l = layouts[sel];
      if (!l.boxes[box]) return;
      l.boxes.splice(box, 1);
      box = -1;
      paintStage();
      paintList();
    }

    stage.addEventListener('pointerdown', () => { box = -1; paintStage(); });
    stage.addEventListener('keydown', (e) => {
      const b = layouts[sel].boxes[box];
      if (!b) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { removeBox(); e.preventDefault(); return; }
      const step = e.shiftKey ? 0.01 : 0.0025;
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = mv[e.key];
      if (!v) return;
      e.preventDefault();
      b.x = clamp(tidy(b.x + v[0]), 0, 1 - b.w);
      b.y = clamp(tidy(b.y + v[1]), 0, 1 - b.h);
      paintStage();
    });

    let finished = false;
    const done = (v: LayoutDef[] | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      layouts = layouts.map((l) => ({ ...l, name: l.name.trim() || (isBuiltinLayout(l.id) ? builtinLayout(l.id).name : 'Custom Layout') }));
      done(layouts);
    });
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    render();
    d.showModal();
  });
}
