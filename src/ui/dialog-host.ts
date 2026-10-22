// Where a settings window opens. Normally each one floats over the program on its own; the
// Settings window can instead ask for the next one to open inside its page area, so Hotkeys,
// Colour Palettes, Scheme Settings and the rest are pages of one window while their menu items
// still open them.

let host: HTMLElement | null = null;

/** Open the next settings window inside `el` (once), rather than over the program. */
export function hostNextDialog(el: HTMLElement | null): void {
  host = el;
}

/** Show a window: inside the Settings window's page area when it asked for it, or over the program. */
export function showDialog(d: HTMLDialogElement): void {
  const h = host;
  host = null;
  if (h?.isConnected) {
    d.classList.add('embedded');
    h.replaceChildren(d);
    if (!d.open) d.show();
    return;
  }
  if (d.classList.contains('embedded')) {
    if (d.open) d.close();
    d.classList.remove('embedded');
    document.body.append(d);
  } else if (!d.isConnected) document.body.append(d);
  if (!d.open) d.showModal();
}
