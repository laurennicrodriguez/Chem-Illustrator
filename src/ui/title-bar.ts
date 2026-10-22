// The window's title bar (desktop app only). By default the system's title bar is taken away and
// its buttons (minimise, maximise, close) sit at the right end of the menu bar, which also moves
// the window when dragged by an empty part and maximises it on a double-click, so the program
// gains a row of height. View > Title Bar in Menu Row puts the system's title bar back.

import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Where the window's title and buttons are: in the menu row ('app') or the system's own bar. */
export type TitleBarPlace = 'app' | 'system';

const svg = (body: string) => `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">${body}</svg>`;
const ICONS = {
  min: svg('<path d="M0 5.5h10"/>'),
  max: svg('<rect x="0.5" y="0.5" width="9" height="9"/>'),
  restore: svg('<rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V0.5h7v7h-2"/>'),
  close: svg('<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>'),
};

let controls: HTMLElement | null = null;
let place: TitleBarPlace = 'system';

/** The window buttons, made the first time they are needed. */
function windowButtons(header: HTMLElement): HTMLElement {
  if (controls) return controls;
  const w = getCurrentWindow();
  const box = document.createElement('div');
  box.className = 'win-controls';
  const button = (cls: string, label: string, icon: string, act: () => Promise<unknown>) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `win-btn ${cls}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    b.addEventListener('click', () => { act().catch(() => {}); });
    box.append(b);
    return b;
  };
  button('win-min', 'Minimise', ICONS.min, () => w.minimize());
  const max = button('win-max', 'Maximise', ICONS.max, () => w.toggleMaximize());
  // closing asks about unsaved work as the system's close button does (onCloseRequested)
  button('win-close', 'Close', ICONS.close, () => w.close());
  const showMax = async () => {
    const big = await w.isMaximized().catch(() => false);
    max.innerHTML = big ? ICONS.restore : ICONS.max;
    max.title = big ? 'Restore Down' : 'Maximise';
    max.setAttribute('aria-label', max.title);
  };
  void w.onResized(() => { void showMax(); });
  void showMax();
  header.append(box);
  controls = box;
  return box;
}

/** Put the title bar where it goes. Only the desktop app has one; the web page leaves it alone. */
export async function placeTitleBar(where: TitleBarPlace): Promise<void> {
  place = where;
  const header = document.querySelector('header');
  document.querySelector('[data-cmd="title-bar-in-menu"]')?.setAttribute('aria-checked', String(where === 'app'));
  if (!isTauri() || !header) return;
  const own = where === 'app';
  document.body.classList.toggle('own-title-bar', own);
  // the empty parts of the menu bar (and the program's name) move the window
  for (const el of [header, header.querySelector('h1.app-name')]) {
    if (!el) continue;
    if (own) el.setAttribute('data-tauri-drag-region', '');
    else el.removeAttribute('data-tauri-drag-region');
  }
  windowButtons(header).hidden = !own;
  await getCurrentWindow().setDecorations(!own).catch(() => {});
}

export const titleBarPlace = (): TitleBarPlace => place;
