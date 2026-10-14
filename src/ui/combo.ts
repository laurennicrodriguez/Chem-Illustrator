// Drop-down lists for typed boxes (font, size, ion). The browser's own suggestion lists only
// show entries that match what is already in the box, so a size box holding "11" opened to an
// empty or flickering list. These show every choice, the current one marked, and narrow to
// what is typed only while typing.

/** The choices to show for what is typed: all of them, or those starting with the typed text once typing starts. */
export function comboChoices(all: string[], typed: string, filtering: boolean): string[] {
  if (!filtering || !typed.trim()) return all;
  const t = typed.trim().toLowerCase();
  const hits = all.filter((x) => x.toLowerCase().startsWith(t));
  const inside = all.filter((x) => !x.toLowerCase().startsWith(t) && x.toLowerCase().includes(t));
  return hits.length + inside.length ? [...hits, ...inside] : all;
}

let open: { input: HTMLInputElement; box: HTMLDivElement; close: () => void } | null = null;

/** Give a box with a suggestion list (`list` attribute) our own drop-down instead. */
export function makeCombo(input: HTMLInputElement): void {
  const listId = input.getAttribute('list');
  if (!listId || input.dataset.combo) return;
  input.dataset.combo = listId;
  input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-haspopup', 'listbox');
  input.classList.add('combo');
  const options = () => [...(document.getElementById(listId)?.querySelectorAll('option') ?? [])].map((o) => o.value || o.textContent || '').filter(Boolean);
  let filtering = false;
  let active = -1;

  const pick = (v: string) => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };
  const render = () => {
    if (open?.input !== input) return;
    const box = open.box;
    const items = comboChoices(options(), input.value, filtering);
    box.replaceChildren();
    items.forEach((v, i) => {
      const b = document.createElement('div');
      b.className = 'combo-item' + (v === input.value ? ' current' : '') + (i === active ? ' active' : '');
      b.setAttribute('role', 'option');
      b.textContent = v;
      // keep the box focused while picking
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(v); });
      box.append(b);
    });
    box.hidden = !items.length;
    const cur = box.querySelector<HTMLElement>('.active') ?? box.querySelector<HTMLElement>('.current');
    cur?.scrollIntoView({ block: 'nearest' });
  };
  const show = () => {
    if (open?.input === input) return;
    open?.close();
    const box = document.createElement('div');
    box.className = 'combo-list';
    box.setAttribute('role', 'listbox');
    document.body.append(box);
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.bottom + 2}px`;
    box.style.minWidth = `${Math.max(r.width, 60)}px`;
    filtering = false;
    active = -1;
    open = { input, box, close };
    render();
    // keep it on screen
    const b = box.getBoundingClientRect();
    if (b.bottom > window.innerHeight - 4) box.style.top = `${Math.max(4, r.top - b.height - 2)}px`;
  };
  function close() {
    if (open?.input !== input) return;
    open.box.remove();
    open = null;
  }

  input.addEventListener('mousedown', () => { if (open?.input === input) close(); else setTimeout(show, 0); });
  input.addEventListener('focus', () => setTimeout(() => { if (document.activeElement === input) show(); }, 0));
  input.addEventListener('blur', () => close());
  input.addEventListener('input', () => { filtering = true; active = -1; if (open?.input !== input) show(); render(); });
  input.addEventListener('keydown', (e) => {
    const items = comboChoices(options(), input.value, filtering);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (open?.input !== input) show();
      const cur = active >= 0 ? active : items.indexOf(input.value);
      active = Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
      e.preventDefault();
    } else if (e.key === 'Enter' && open?.input === input && active >= 0 && items[active] !== undefined) {
      pick(items[active]);
      e.preventDefault();
    } else if (e.key === 'Escape' && open?.input === input) {
      close();
      e.stopPropagation();
    } else if (e.key === 'Enter' || e.key === 'Tab') close();
  });
}

/** Turn every box with a suggestion list into one with our drop-down, now and whenever one is added. */
export function installCombos(root: HTMLElement = document.body): void {
  for (const i of root.querySelectorAll<HTMLInputElement>('input[list]')) makeCombo(i);
  new MutationObserver((changes) => {
    for (const c of changes) {
      for (const n of c.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n instanceof HTMLInputElement && n.hasAttribute('list')) makeCombo(n);
        for (const i of n.querySelectorAll<HTMLInputElement>('input[list]')) makeCombo(i);
      }
      if (c.type === 'attributes' && c.target instanceof HTMLInputElement && c.target.hasAttribute('list')) makeCombo(c.target);
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['list'] });
  // close when the page scrolls or the window changes size (the list would be left behind)
  window.addEventListener('resize', () => open?.close());
  document.addEventListener('scroll', (e) => { if (open && e.target !== open.box) open.close(); }, true);
}
