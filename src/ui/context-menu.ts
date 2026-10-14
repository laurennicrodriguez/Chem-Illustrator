// Right-click menus: commands from the menus at the top (with their own names, keys and ticks),
// in groups that open to the side, so people used to finding things on the right-click menu in
// ChemDraw find them there too.

/** A command (named as in the top menus unless `label` says otherwise), a group, or a line. */
export type MenuItem =
  | { cmd: string; label?: string }
  | { label: string; items: MenuItem[] }
  | null;

export interface MenuHooks {
  run(cmd: string): void;
  /** The key that runs a command, to show beside it. */
  key(cmd: string): string | undefined;
}

let open: HTMLDivElement[] = [];

export function closeContextMenu(): void {
  for (const m of open) m.remove();
  open = [];
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', escape, true);
  window.removeEventListener('blur', closeContextMenu);
}

const outside = (e: Event) => { if (!open.some((m) => m.contains(e.target as Node))) closeContextMenu(); };
const escape = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  // Esc closes the innermost group first
  const last = open.pop();
  last?.remove();
  if (!open.length) closeContextMenu();
  else open[open.length - 1].querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus();
};

/** The name and tick of a command as the top menus show it. */
function topMenuEntry(cmd: string): { label: string; checked: boolean | null } | null {
  const b = document.querySelector<HTMLButtonElement>(`.menu-wrap [data-cmd="${cmd}"]`);
  if (!b) return null;
  const span = b.querySelector('span');
  const text = (span ?? b).cloneNode(true) as HTMLElement;
  text.querySelector('kbd')?.remove();
  const checked = b.getAttribute('role') === 'menuitemcheckbox' ? b.getAttribute('aria-checked') === 'true' : null;
  return { label: text.textContent!.trim(), checked };
}

/** Drop lines at the ends and doubled lines, and empty groups. */
export function tidyItems(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it && 'items' in it) {
      const sub = tidyItems(it.items);
      if (sub.length) out.push({ ...it, items: sub });
    } else if (it || (out.length && out[out.length - 1])) out.push(it);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** Show a menu at (x, y) in the window. */
export function showContextMenu(x: number, y: number, items: MenuItem[], hooks: MenuHooks): void {
  closeContextMenu();
  const m = build(tidyItems(items), hooks, 0);
  if (!m) return;
  place(m, x, y, null);
  m.querySelector<HTMLButtonElement>('button')?.focus();
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', closeContextMenu);
  });
}

function build(items: MenuItem[], hooks: MenuHooks, depth: number): HTMLDivElement | null {
  if (!items.length) return null;
  const m = document.createElement('div');
  m.className = 'menu context-menu';
  m.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) { m.append(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    const name = document.createElement('span');
    b.append(name);
    if ('items' in it) {
      name.textContent = it.label;
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.classList.add('has-sub');
      const openSub = (focus: boolean) => {
        // close any deeper group, then open this one beside its row
        while (open.length > depth + 1) open.pop()!.remove();
        for (const o of m.querySelectorAll('[aria-expanded="true"]')) o.setAttribute('aria-expanded', 'false');
        const sub = build(it.items, hooks, depth + 1);
        if (!sub) return;
        b.setAttribute('aria-expanded', 'true');
        const r = b.getBoundingClientRect();
        place(sub, r.right - 2, r.top - 5, r);
        if (focus) sub.querySelector<HTMLButtonElement>('button')?.focus();
      };
      b.addEventListener('pointerenter', () => openSub(false));
      b.addEventListener('click', () => openSub(true));
      b.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); openSub(true); } });
    } else {
      const top = topMenuEntry(it.cmd);
      name.textContent = it.label ?? top?.label ?? it.cmd;
      if (top?.checked != null) {
        b.setAttribute('role', 'menuitemcheckbox');
        b.setAttribute('aria-checked', String(top.checked));
      } else b.setAttribute('role', 'menuitem');
      const k = hooks.key(it.cmd);
      if (k) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        b.append(kbd);
      }
      b.addEventListener('pointerenter', () => { while (open.length > depth + 1) open.pop()!.remove(); });
      b.addEventListener('click', () => { closeContextMenu(); hooks.run(it.cmd); });
    }
    m.append(b);
  }
  m.addEventListener('keydown', (e) => {
    const list = [...m.querySelectorAll<HTMLButtonElement>(':scope > button')];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    if (e.key === 'ArrowLeft' && depth > 0) {
      e.preventDefault();
      open.pop()?.remove();
      open[open.length - 1]?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus();
    }
  });
  open.push(m);
  return m;
}

/** Put a menu at (x, y), kept on screen; a group that would run off the right opens to the left of its row. */
function place(m: HTMLDivElement, x: number, y: number, row: DOMRect | null): void {
  m.style.left = '0px';
  m.style.top = '0px';
  document.body.append(m);
  const r = m.getBoundingClientRect();
  let left = x;
  if (left + r.width > innerWidth - 4) left = row ? row.left - r.width + 2 : innerWidth - r.width - 4;
  m.style.left = `${Math.max(4, left)}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
}
