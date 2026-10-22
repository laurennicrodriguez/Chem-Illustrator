// AutoSave: a tab already saved as a file saves itself a little while after the last change
// (File > AutoSave and Recovery Options sets how long), and also every few minutes during long
// stretches of steady work, so it is never far behind. This decides when; the app does the saving.

export interface AutoSaveTab {
  id: number;
  /** Changes whenever the tab's contents change. */
  token: number;
  dirty: boolean;
  /** AutoSave is on for it and it can be saved in place. */
  on: boolean;
}

export class AutoSaveClock {
  private seen = new Map<number, { token: number; changedAt: number; firstAt: number }>();

  /** The tabs that should save now. */
  due(tabs: AutoSaveTab[], now: number, delayMs: number): number[] {
    const out: number[] = [];
    const ids = new Set<number>();
    for (const t of tabs) {
      ids.add(t.id);
      if (!t.on || !t.dirty) { this.seen.delete(t.id); continue; }
      let s = this.seen.get(t.id);
      if (!s) this.seen.set(t.id, s = { token: t.token, changedAt: now, firstAt: now });
      else if (s.token !== t.token) { s.token = t.token; s.changedAt = now; }
      if (now - s.changedAt >= delayMs || now - s.firstAt >= Math.max(4 * delayMs, 120_000)) out.push(t.id);
    }
    for (const id of [...this.seen.keys()]) if (!ids.has(id)) this.seen.delete(id);
    return out;
  }

  /** The tab has been saved (or its save failed): start counting again from its next change. */
  done(id: number): void {
    this.seen.delete(id);
  }
}
