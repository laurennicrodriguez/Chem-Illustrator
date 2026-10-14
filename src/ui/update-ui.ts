// Checking for a newer version (desktop app only): a quiet check a few seconds after the app
// starts, which shows a small notice in the corner if there is one, and File > Check for Updates…,
// which always says what it found. Installing asks first when some tabs aren't saved.

import { appVersion, findRelease, shortNotes, worthOffering, type Release } from '../updates';
import { ask } from './ask';

export interface UpdateHost {
  /** Names of the open tabs with changes that aren't saved. */
  unsaved(): string[];
  /** The version the user chose not to hear about again, if any. */
  skipped(): string | null;
  skip(version: string | null): void;
}

export class UpdateUI {
  private box: HTMLElement | null = null;
  private busy = false;

  constructor(private host: UpdateHost) {}

  /** The check when the app starts: says nothing unless there is a version worth offering. */
  async quietCheck(): Promise<void> {
    let r: Release | null = null;
    try { r = await findRelease(); } catch { return; } // offline, or GitHub unreachable: try again next time
    if (r && worthOffering(r.version, this.host.skipped())) this.offer(r);
  }

  /** File > Check for Updates…: always says what it found. */
  async check(): Promise<void> {
    const mine = await appVersion();
    let r: Release | null;
    try {
      r = await findRelease();
    } catch (e) {
      await ask('Check for Updates', [], { ok: 'OK', noCancel: true, note: `Couldn’t reach GitHub to check for a newer version (${String(e)}). You have version ${mine}.` });
      return;
    }
    if (!r) {
      await ask('Check for Updates', [], { ok: 'OK', noCancel: true, note: `You have the newest version (${mine}).` });
      return;
    }
    this.offer(r);
  }

  private offer(r: Release): void {
    this.box?.remove();
    const box = document.createElement('div');
    box.className = 'update-box';
    box.setAttribute('role', 'status');
    const h = document.createElement('strong');
    h.textContent = `Chem Illustrator ${r.version} is ready`;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = r.notes ? shortNotes(r.notes) : 'A newer version is available.';
    const bar = document.createElement('div');
    bar.className = 'update-progress';
    bar.hidden = true;
    const row = document.createElement('div');
    row.className = 'update-buttons';
    const button = (label: string, fn: () => void, main = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (main) b.className = 'primary';
      b.addEventListener('click', fn);
      row.append(b);
      return b;
    };
    button('Install and Restart', () => void this.install(r, bar, row), true);
    button('Later', () => box.remove());
    button('Skip This Version', () => { this.host.skip(r.version); box.remove(); });
    box.append(h, p, bar, row);
    document.body.append(box);
    this.box = box;
  }

  private async install(r: Release, bar: HTMLElement, row: HTMLElement): Promise<void> {
    if (this.busy) return;
    const open = this.host.unsaved();
    if (open.length) {
      const ok = await ask('Install the Update?', [], {
        ok: 'Install Anyway',
        note: `The app restarts to install version ${r.version}. These tabs have changes that aren’t saved and will lose them: ${open.join(', ')}. Choose Cancel to save them first.`,
      });
      if (!ok) return;
    }
    this.busy = true;
    row.hidden = true;
    bar.hidden = false;
    bar.textContent = 'Downloading…';
    try {
      await r.install((done) => {
        bar.textContent = done === null ? 'Downloading…' : done >= 1 ? 'Installing…' : `Downloading… ${Math.round(done * 100)}%`;
      });
    } catch (e) {
      bar.textContent = `The update didn’t install: ${String(e)}`;
      row.hidden = false;
    } finally {
      this.busy = false;
    }
  }
}
