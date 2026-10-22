// Slide Show > Set Up Show (how the show runs, which slides it plays, how it goes on) and Custom
// Slide Show > Custom Shows (named lists of slides, in any order, played as shows of their own).

import { SHOW_TYPES, defaultShow, type CustomShow, type ShowSetup, type ShowType } from '../deck/show-setup';
import { showDialog } from './dialog-host';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text !== undefined) x.textContent = text;
  return x;
};

function radio(name: string, label: string, on: boolean, title = ''): { l: HTMLLabelElement; i: HTMLInputElement } {
  const l = el('label', 'hf-radio');
  const i = el('input');
  i.type = 'radio';
  i.name = name;
  i.checked = on;
  l.append(i, ` ${label}`);
  if (title) l.title = title;
  return { l, i };
}

function check(label: string, on: boolean, title = ''): { l: HTMLLabelElement; i: HTMLInputElement } {
  const l = el('label', 'hf-check');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = on;
  l.append(i, ` ${label}`);
  if (title) l.title = title;
  return { l, i };
}

function frame(title: string): { d: HTMLDialogElement; form: HTMLFormElement; buttons: HTMLParagraphElement } {
  const d = el('dialog', 'ask show-setup');
  const form = el('form');
  form.method = 'dialog';
  form.append(el('h2', undefined, title));
  const buttons = el('p', 'ask-buttons');
  d.append(form);
  return { d, form, buttons };
}

/** Set Up Show: resolves with the settings, or null when cancelled. `slides` is how many the deck has. */
export function setUpShow(setup: ShowSetup | undefined, shows: CustomShow[], slides: number): Promise<ShowSetup | null> {
  const s = setup ?? defaultShow();
  return new Promise((resolve) => {
    const { d, form, buttons } = frame('Set Up Show');
    const grid = el('div', 'ss-grid');
    // show type
    const type = el('fieldset');
    type.append(el('legend', undefined, 'Show type'));
    const types = new Map<ShowType, HTMLInputElement>();
    for (const t of SHOW_TYPES) { const r = radio('ss-type', t.name, s.type === t.id, t.tip); types.set(t.id, r.i); type.append(r.l); }
    // options
    const opt = el('fieldset');
    opt.append(el('legend', undefined, 'Show options'));
    const loop = check('Loop continuously until Esc', !!s.loop || s.type === 'kiosk', 'After the last slide the show starts again from the first');
    const noNarr = check('Show without narration', !!s.noNarration, 'Narration recorded with Record is not played');
    const noAnim = check('Show without animation', !!s.noAnimation, 'Each slide comes in with everything on it');
    opt.append(loop.l, noNarr.l, noAnim.l);
    // slides
    const which = el('fieldset');
    which.append(el('legend', undefined, 'Show slides'));
    const all = radio('ss-which', 'All', s.from === undefined && s.to === undefined && s.custom === undefined);
    const range = radio('ss-which', 'From', s.custom === undefined && (s.from !== undefined || s.to !== undefined));
    const num = (v: number) => { const i = el('input'); i.type = 'number'; i.min = '1'; i.max = String(slides); i.value = String(v); i.className = 'md-num'; return i; };
    const from = num(s.from ?? 1), to = num(s.to ?? slides);
    range.l.append(' ', from, ' to ', to);
    const cust = radio('ss-which', 'Custom show', s.custom !== undefined && shows.some((c) => c.id === s.custom), 'A custom show made in Custom Slide Show > Custom Shows');
    const pick = el('select');
    for (const c of shows) pick.add(new Option(c.name, String(c.id)));
    if (s.custom !== undefined) pick.value = String(s.custom);
    cust.l.append(' ', pick);
    if (!shows.length) { cust.i.disabled = true; pick.disabled = true; cust.l.title = 'Make a custom show first (Custom Slide Show > Custom Shows)'; }
    for (const x of [from, to]) x.addEventListener('focus', () => { range.i.checked = true; });
    pick.addEventListener('change', () => { cust.i.checked = true; });
    which.append(all.l, range.l, cust.l);
    // advance
    const adv = el('fieldset');
    adv.append(el('legend', undefined, 'Advance slides'));
    const manual = radio('ss-adv', 'Manually', !!s.manual, 'Only clicks and keys go on');
    const timed = radio('ss-adv', 'Using timings, if present', !s.manual, 'Each slide goes on by itself after its time (Rehearse Timings, or Transitions > After)');
    adv.append(manual.l, timed.l);
    grid.append(type, opt, which, adv);
    const kioskNote = el('p', 'muted small', 'At a kiosk the show goes round by itself, by the slides\' times; clicks only follow links and action buttons, and Esc ends it.');
    const sync = () => {
      const kiosk = types.get('kiosk')!.checked;
      loop.i.disabled = kiosk;
      if (kiosk) { loop.i.checked = true; timed.i.checked = true; }
      manual.i.disabled = kiosk;
      kioskNote.hidden = !kiosk;
    };
    form.addEventListener('change', sync);
    sync();
    const cancel = el('button', undefined, 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'primary', 'OK');
    ok.type = 'submit';
    buttons.append(cancel, ok);
    form.append(grid, kioskNote, buttons);
    let finished = false;
    const done = (v: ShowSetup | null) => { if (finished) return; finished = true; if (d.open) d.close(); d.remove(); resolve(v); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = [...types].find(([, i]) => i.checked)?.[0] ?? 'speaker';
      const out: ShowSetup = { type: t };
      if (loop.i.checked && t !== 'kiosk') out.loop = true;
      if (noNarr.i.checked) out.noNarration = true;
      if (noAnim.i.checked) out.noAnimation = true;
      if (manual.i.checked && t !== 'kiosk') out.manual = true;
      if (range.i.checked) {
        const a = Math.max(1, Math.min(slides, Math.round(Number(from.value) || 1))), b = Math.max(a, Math.min(slides, Math.round(Number(to.value) || slides)));
        if (a > 1 || b < slides) { out.from = a; out.to = b; }
      } else if (cust.i.checked && pick.value) out.custom = Number(pick.value);
      done(out);
    });
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    showDialog(d);
  });
}

/** A slide as the custom show windows list it: its number and title. */
export interface SlideName { id: number; name: string }

/**
 * Custom Shows: make, change, copy and remove custom shows. Resolves with the new list (and the
 * show to play, when Show was pressed), or null when closed without changes.
 */
export function editCustomShows(shows: CustomShow[], slides: SlideName[]): Promise<{ shows: CustomShow[]; play?: number } | null> {
  let list = shows.map((c) => ({ ...c, slides: [...c.slides] }));
  return new Promise((resolve) => {
    const { d, form, buttons } = frame('Custom Shows');
    const body = el('div', 'cs-body');
    const box = el('select', 'cs-list');
    box.size = 8;
    const side = el('div', 'cs-side');
    const b = (text: string, title: string) => { const x = el('button', undefined, text); x.type = 'button'; x.title = title; side.append(x); return x; };
    const add = b('New…', 'Make a custom show: name it and pick its slides');
    const edit = b('Edit…', 'Change the custom show picked');
    const remove = b('Remove', 'Delete the custom show picked (the slides stay in the deck)');
    const copy = b('Copy', 'A copy of the custom show picked, to change');
    body.append(box, side);
    const fill = (pickId?: number) => {
      box.replaceChildren(...list.map((c) => new Option(`${c.name} (${c.slides.length} slide${c.slides.length === 1 ? '' : 's'})`, String(c.id))));
      if (pickId !== undefined) box.value = String(pickId);
      else if (list.length && !box.value) box.value = String(list[0].id);
      for (const x of [edit, remove, copy, play]) x.disabled = !box.value;
    };
    const picked = () => list.find((c) => String(c.id) === box.value);
    const nextId = () => Math.max(-1, ...list.map((c) => c.id)) + 1;
    add.addEventListener('click', async () => {
      const got = await editCustomShow({ id: nextId(), name: `Custom Show ${list.length + 1}`, slides: [] }, slides);
      if (got) { list = [...list, got]; fill(got.id); }
    });
    edit.addEventListener('click', async () => {
      const c = picked();
      if (!c) return;
      const got = await editCustomShow(c, slides);
      if (got) { list = list.map((x) => (x.id === c.id ? got : x)); fill(got.id); }
    });
    box.addEventListener('dblclick', () => edit.click());
    remove.addEventListener('click', () => { const c = picked(); if (c) { list = list.filter((x) => x !== c); box.value = ''; fill(); } });
    copy.addEventListener('click', () => {
      const c = picked();
      if (!c) return;
      const id = nextId();
      list = [...list, { id, name: `Copy of ${c.name}`, slides: [...c.slides] }];
      fill(id);
    });
    const close = el('button', 'primary', 'Close');
    close.type = 'submit';
    const play = el('button', undefined, 'Show');
    play.type = 'button';
    play.title = 'Play the custom show picked';
    buttons.append(play, close);
    form.append(body, buttons);
    fill();
    let finished = false;
    const done = (v: { shows: CustomShow[]; play?: number } | null) => { if (finished) return; finished = true; if (d.open) d.close(); d.remove(); resolve(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); done({ shows: list }); });
    play.addEventListener('click', () => { const c = picked(); done({ shows: list, ...(c ? { play: c.id } : {}) }); });
    d.addEventListener('close', () => done({ shows: list }));
    showDialog(d);
  });
}

/** Name a custom show and pick its slides, in order. */
function editCustomShow(c: CustomShow, slides: SlideName[]): Promise<CustomShow | null> {
  let picked = c.slides.filter((id) => slides.some((s) => s.id === id));
  return new Promise((resolve) => {
    const { d, form, buttons } = frame('Define Custom Show');
    const name = el('input');
    name.type = 'text';
    name.value = c.name;
    const nameRow = el('label', 'ask-row');
    nameRow.append(el('span', undefined, 'Slide show name'), name);
    const body = el('div', 'cs-pick');
    const inDeck = el('select', 'cs-list');
    inDeck.multiple = true;
    inDeck.size = 10;
    for (const s of slides) inDeck.add(new Option(s.name, String(s.id)));
    const mid = el('div', 'cs-side');
    const addB = el('button', undefined, 'Add ▶');
    addB.type = 'button';
    addB.title = 'Put the slides picked on the left into the show, at its end';
    mid.append(addB);
    const inShow = el('select', 'cs-list');
    inShow.size = 10;
    const right = el('div', 'cs-side');
    const up = el('button', undefined, '▲');
    const down = el('button', undefined, '▼');
    const out = el('button', undefined, '✕ Remove');
    for (const x of [up, down, out]) { x.type = 'button'; right.append(x); }
    up.title = 'Earlier in the show';
    down.title = 'Later in the show';
    out.title = 'Take the slide picked out of the show';
    const col = (label: string, list: HTMLElement) => { const x = el('div', 'cs-col'); x.append(el('div', 'muted small', label), list); return x; };
    body.append(col('Slides in the deck', inDeck), mid, col('Slides in the custom show', inShow), right);
    const fill = (at?: number) => {
      inShow.replaceChildren(...picked.map((id, k) => new Option(slides.find((s) => s.id === id)?.name ?? '?', String(k))));
      if (at !== undefined && at >= 0 && at < picked.length) inShow.value = String(at);
    };
    addB.addEventListener('click', () => { picked = [...picked, ...[...inDeck.selectedOptions].map((o) => Number(o.value))]; fill(picked.length - 1); });
    inDeck.addEventListener('dblclick', () => addB.click());
    const move = (by: number) => {
      const k = Number(inShow.value);
      if (!Number.isFinite(k) || inShow.value === '' || k + by < 0 || k + by >= picked.length) return;
      const next = picked.slice();
      [next[k], next[k + by]] = [next[k + by], next[k]];
      picked = next;
      fill(k + by);
    };
    up.addEventListener('click', () => move(-1));
    down.addEventListener('click', () => move(1));
    out.addEventListener('click', () => { const k = Number(inShow.value); if (inShow.value === '') return; picked = picked.filter((_, j) => j !== k); fill(Math.min(k, picked.length - 1)); });
    fill();
    const cancel = el('button', undefined, 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'primary', 'OK');
    ok.type = 'submit';
    buttons.append(cancel, ok);
    form.append(nameRow, body, buttons);
    let finished = false;
    const done = (v: CustomShow | null) => { if (finished) return; finished = true; if (d.open) d.close(); d.remove(); resolve(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); done({ id: c.id, name: name.value.trim() || c.name, slides: picked }); });
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    showDialog(d);
  });
}
