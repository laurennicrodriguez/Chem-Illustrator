// Links on screen: the Insert Link window (Ctrl+K, as in Word, PowerPoint and Excel), following
// a link (Ctrl+click), and the tooltip that says where one goes. Every mode uses the same
// window and the same way of following a link; what "a place in this file" means (a bookmark,
// a slide, a cell) comes from the mode, through the LinkHost the app sets up.

import { showDialog } from './dialog-host';
import { describeLink, doiOf, filePath, linkKind, normalizeLink, type LinkKind, type LinkPlace } from '../links';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type { LinkPlace } from '../links';

/** What the app does for links: going to places in the file, and opening files. */
export interface LinkHost {
  /** Go to a place in the file being shown; false when it isn't there any more. */
  goTo(place: string): boolean;
  /** The name of a place, for tooltips (Slide 3, Heading "Results"). */
  placeName?(place: string): string | null;
  /** Open a file in this program when it is one it opens; false to leave it to the computer. */
  openHere?(path: string): Promise<boolean>;
  /** The folder of the file being shown, so paths written next to it can be found. */
  folder?(): string | null;
  /** A short message at the bottom of the window. */
  flash(text: string): void;
}

let host: LinkHost = { goTo: () => false, flash: () => {} };

export function setLinkHost(h: LinkHost): void {
  host = h;
}

/** Text for a link's tooltip: where it goes, and how to follow it. */
export function linkTip(link: string, ctrl: boolean): string {
  const where = describeLink(link, (p) => host.placeName?.(p) ?? null);
  return `${where}\n${ctrl ? 'Ctrl+click to follow the link' : 'Click to follow the link'}`;
}

/** A path written relative to the file being shown, made whole. */
function wholePath(p: string): string {
  if (/^([a-z]:[\\/]|\\\\|\/)/i.test(p)) return p;
  const dir = host.folder?.();
  if (!dir) return p;
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${p.replace(/^\.[\\/]/, '').replace(/[\\/]/g, sep)}`;
}

/** Follow a link: a web page or DOI in the browser, an e-mail in the mail program, a file, or a place here. */
export async function followLink(link: string): Promise<void> {
  const kind = linkKind(link);
  if (kind === 'place') {
    if (!host.goTo(link)) host.flash(`The place this link goes to (${describeLink(link, (p) => host.placeName?.(p) ?? null)}) isn't in the file any more.`);
    return;
  }
  if (kind === 'file') {
    const path = wholePath(filePath(link));
    if (host.openHere && await host.openHere(path).catch(() => false)) return;
    if (!isTauri()) { window.open(/^file:/i.test(link) ? link : `file:///${path.replace(/\\/g, '/')}`, '_blank', 'noopener'); return; }
    // a file could be a program: the person says yes first, as Word asks
    if (!window.confirm(`Open ${path}?\n\nIt opens in the program your computer uses for it. Only open files you trust.`)) return;
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(path);
    } catch (e) {
      host.flash(`Couldn't open ${path}: ${e}`);
    }
    return;
  }
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(link);
    } catch (e) {
      host.flash(`Couldn't open ${link}: ${e}`);
    }
  } else window.open(link, '_blank', 'noopener');
}

// ------------------------------------------------------------------ the window

export interface LinkAsk {
  /** The text the link shows; null when there is no text to change (a sheet's cell with a formula). */
  text: string | null;
  /** The link being changed, if there is one. */
  link?: string;
  /** Places in this file the link can go to (none: no "Place in this file"). */
  places?: LinkPlace[];
  /** What "Place in this file" is called here (Place in this document, Slide in this deck). */
  placeTitle?: string;
  /**
   * A place is the item picked plus something typed (a sheet and a cell, as in Excel's "Type
   * the cell reference"): the box's label, what it starts with, and how the two make the link.
   */
  placeTyped?: { label: string; value: string; make(picked: string, typed: string): string | null };
}

export type LinkAnswer = { link: string; text?: string } | { remove: true };

const KINDS: { id: LinkKind; label: string }[] = [
  { id: 'web', label: 'Web page or DOI' },
  { id: 'place', label: 'Place in this file' },
  { id: 'file', label: 'File' },
  { id: 'mail', label: 'E-mail address' },
];

/** Pick a file for a file link (the desktop app's Open window). */
async function browse(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const p = await open({ multiple: false, directory: false });
  return typeof p === 'string' ? p : null;
}

/**
 * Insert Link / Edit Link: where the link goes (a web page or DOI, a place in this file, a file,
 * or an e-mail address) and the text it shows. Resolves with the link, with remove for Remove
 * Link, or null when cancelled.
 */
export function askLink(q: LinkAsk): Promise<LinkAnswer | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask link-dialog';
    const form = document.createElement('form');
    const h = document.createElement('h2');
    h.textContent = q.link ? 'Edit Link' : 'Insert Link';
    form.append(h);

    const row = (label: string, input: HTMLElement, after?: HTMLElement) => {
      const r = document.createElement('label');
      r.className = 'ask-row';
      const s = document.createElement('span');
      s.textContent = label;
      r.append(s, input);
      if (after) r.append(after);
      return r;
    };
    const textIn = document.createElement('input');
    textIn.value = q.text ?? '';
    textIn.placeholder = 'The link shows its address';
    if (q.text !== null) form.append(row('Text to display', textIn));

    // what kind of place it goes to, as Word's "Link to" buttons
    const places = q.places ?? [];
    const kinds = KINDS.filter((k) => k.id !== 'place' || places.length);
    const bar = document.createElement('div');
    bar.className = 'link-kinds';
    bar.setAttribute('role', 'radiogroup');
    bar.setAttribute('aria-label', 'Link to');
    const panes = new Map<LinkKind, HTMLElement>();
    const buttons = new Map<LinkKind, HTMLButtonElement>();
    for (const k of kinds) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = k.id === 'place' && q.placeTitle ? q.placeTitle : k.label;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => show(k.id));
      buttons.set(k.id, b);
      bar.append(b);
    }
    form.append(bar);

    const start = q.link ?? '';
    const startKind: LinkKind = start ? (linkKind(start) === 'doi' ? 'web' : linkKind(start)) : 'web';

    // a web page or a DOI
    const web = document.createElement('div');
    const addr = document.createElement('input');
    addr.placeholder = 'https://… or a DOI, such as 10.1021/acs.orglett.5b00001';
    addr.value = startKind === 'web' ? (doiOf(start) ?? start) : '';
    const webHelp = document.createElement('p');
    webHelp.className = 'ask-help muted';
    webHelp.textContent = 'A DOI links through doi.org, so it finds the paper wherever the journal moves it.';
    web.append(row('Address', addr), webHelp);
    panes.set('web', web);

    // a place here
    const place = document.createElement('div');
    const list = document.createElement('select');
    list.size = Math.min(10, Math.max(4, places.length));
    list.className = 'link-places';
    for (const p of places) {
      const o = new Option(`${'\u2003'.repeat(p.depth ?? 0)}${p.label}`, p.link, false, !!p.link && p.link === start);
      // a heading of the list (Headings, Bookmarks) can't be picked
      if (!p.link) { o.disabled = true; o.className = 'link-group'; }
      list.add(o);
    }
    if (list.selectedIndex < 0) list.selectedIndex = places.findIndex((p) => p.link);
    const typed = document.createElement('input');
    if (q.placeTyped) {
      typed.value = q.placeTyped.value;
      place.append(row(q.placeTyped.label, typed));
    }
    place.append(row('Go to', list));
    panes.set('place', place);

    // a file
    const file = document.createElement('div');
    const pathIn = document.createElement('input');
    pathIn.placeholder = 'C:\\Users\\…\\Spectra\\4a 1H.mnova';
    pathIn.value = startKind === 'file' ? filePath(start) : '';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.textContent = 'Browse…';
    pick.hidden = !isTauri();
    pick.addEventListener('click', () => void browse().then((p) => { if (p) { pathIn.value = p; if (!textIn.value) textIn.value = p.split(/[\\/]/).pop() ?? p; } }));
    const fileHelp = document.createElement('p');
    fileHelp.className = 'ask-help muted';
    fileHelp.textContent = 'Drawings, documents, slides and sheets open here; other files open in the program your computer uses for them. A path without a drive or folder at the start is next to this file.';
    file.append(row('File', pathIn, pick), fileHelp);
    panes.set('file', file);

    // an e-mail address
    const mail = document.createElement('div');
    const mailIn = document.createElement('input');
    mailIn.type = 'email';
    mailIn.placeholder = 'name@university.edu';
    const subj = document.createElement('input');
    if (startKind === 'mail') {
      const m = /^mailto:([^?]*)(?:\?subject=(.*))?$/i.exec(start);
      mailIn.value = decodeURIComponent(m?.[1] ?? '');
      try { subj.value = decodeURIComponent(m?.[2] ?? ''); } catch { subj.value = m?.[2] ?? ''; }
    }
    mail.append(row('E-mail address', mailIn), row('Subject', subj));
    panes.set('mail', mail);

    for (const p of panes.values()) { p.hidden = true; form.append(p); }
    let kind: LinkKind = kinds.some((k) => k.id === startKind) ? startKind : 'web';
    const show = (k: LinkKind) => {
      kind = k;
      for (const [id, p] of panes) p.hidden = id !== k;
      for (const [id, b] of buttons) { b.classList.toggle('on', id === k); b.setAttribute('aria-checked', String(id === k)); }
      const focus = k === 'web' ? addr : k === 'place' ? list : k === 'file' ? pathIn : mailIn;
      setTimeout(() => focus.focus(), 0);
    };

    const note = document.createElement('p');
    note.className = 'ask-help link-error';
    note.hidden = true;
    form.append(note);

    const buttonsRow = document.createElement('p');
    buttonsRow.className = 'ask-buttons';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove Link';
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'OK';
    if (q.link) buttonsRow.append(remove, spacer);
    buttonsRow.append(cancel, ok);
    form.append(buttonsRow);
    d.append(form);

    let finished = false;
    const done = (v: LinkAnswer | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    const target = (): string | null => {
      switch (kind) {
        case 'web': return normalizeLink(addr.value, 'web');
        case 'place': return !list.value ? null : q.placeTyped ? q.placeTyped.make(list.value, typed.value) : list.value;
        case 'file': return normalizeLink(pathIn.value, 'file');
        case 'mail': {
          const to = normalizeLink(mailIn.value, 'mail');
          return to && subj.value.trim() ? `${to}?subject=${encodeURIComponent(subj.value.trim())}` : to;
        }
        default: return null;
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const link = target();
      if (!link) {
        note.textContent = kind === 'place' ? 'Pick a place for the link to go to.' : kind === 'file' ? 'Type or browse to the file the link opens.' : kind === 'mail' ? 'Type the e-mail address.' : 'Type the address or DOI the link goes to.';
        note.hidden = false;
        return;
      }
      done(q.text === null ? { link } : { link, text: textIn.value });
    });
    remove.addEventListener('click', () => done({ remove: true }));
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    // keys typed here are for the window, not the drawing or the text behind it
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    showDialog(d);
    show(kind);
  });
}
