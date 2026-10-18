// Updates for the desktop app. Each build of main is published as a GitHub release with a small
// file (latest.json) naming its version and installer. The app reads that file, and if the version
// is newer it offers to download the installer, check its signature against the public key built
// into the app (tauri.conf.json), install it and restart. Nothing is installed without asking.

import { isTauri } from '@tauri-apps/api/core';

export interface Release {
  version: string;
  /** What changed, as written in the release on GitHub. */
  notes: string;
  date?: string;
  /** Download, check and install; reports how far the download has got (0 to 1, or null if unknown). */
  install(progress: (done: number | null) => void): Promise<void>;
}

/** Updates only exist for the desktop app; the web version is always the newest. */
export const canUpdate = isTauri();

/** A portable copy: one with a "Chem Illustrator Data" folder next to it, which holds its settings. */
export interface PortableInfo {
  folder: string;
  /** False on a locked or read-only drive: settings are then kept on the computer. */
  writable: boolean;
  /** Windows: updates replace the app in its folder instead of running the installer. */
  updatesInPlace: boolean;
}

let portableAsked: Promise<PortableInfo | null> | null = null;

/** Whether this is a portable copy (null for an installed one, and the web version). */
export function portableInfo(): Promise<PortableInfo | null> {
  if (!canUpdate) return Promise.resolve(null);
  portableAsked ??= import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<PortableInfo | null>('portable_info'))
    .catch(() => null);
  return portableAsked;
}

/** What latest.json calls the portable Windows app (src-tauri/src/portable.rs). */
export const PORTABLE_TARGET = 'windows-x86_64-portable';

/** The version of the app that is running. */
export async function appVersion(): Promise<string> {
  if (!canUpdate) return 'web';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Ask GitHub for a newer version. Null when this is the newest; throws when GitHub can't be reached. */
export async function findRelease(): Promise<Release | null> {
  if (!canUpdate) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const inPlace = (await portableInfo())?.updatesInPlace ?? false;
  const u = await check(inPlace ? { target: PORTABLE_TARGET } : undefined);
  if (!u) return null;
  return {
    version: u.version,
    notes: (u.body ?? '').trim(),
    date: u.date,
    async install(progress) {
      if (inPlace) {
        // the shell downloads the new app, checks it, swaps it for this one and starts it
        const { invoke, Channel } = await import('@tauri-apps/api/core');
        const onProgress = new Channel<number>();
        onProgress.onmessage = (done) => progress(done < 0 ? null : done);
        await invoke('portable_install_update', { onProgress });
        return;
      }
      let total = 0, got = 0;
      await u.downloadAndInstall((e) => {
        if (e.event === 'Started') { total = e.data.contentLength ?? 0; progress(total ? 0 : null); }
        else if (e.event === 'Progress') { got += e.data.chunkLength; progress(total ? Math.min(1, got / total) : null); }
        else progress(1);
      });
      // Windows closes the app itself to run the installer; elsewhere start the new version
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** Whether to tell the user about a version found when the app starts (a version they chose to skip isn't). */
export function worthOffering(version: string, skipped: string | null): boolean {
  return version.replace(/^v/, '') !== (skipped ?? '').replace(/^v/, '');
}

/** The first lines of a release's notes, for the small notice. */
export function shortNotes(notes: string, lines = 4): string {
  const ls = notes.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return ls.slice(0, lines).join('\n') + (ls.length > lines ? '\n…' : '');
}
