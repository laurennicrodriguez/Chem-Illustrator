// File > AutoSave and Recovery Options: how often unsaved work is copied, AutoSave, how many
// earlier versions are kept, and what happens with files in shared folders (OneDrive, a lab drive).

export interface KeepPrefs {
  /** Copy every open tab with unsaved changes this often, in minutes (0: never). */
  recoveryMinutes: number;
  /** Copies left after the app stopped unexpectedly are kept this many days. */
  recoveryDays: number;
  /** AutoSave: tabs already saved as files save themselves after changes (each tab can be switched on or off). */
  autoSave: boolean;
  /** AutoSave waits this many seconds after the last change. */
  autoSaveSeconds: number;
  /** Version History: earlier versions kept of each file (0: none). */
  versionsKeep: number;
  /** Versions older than this many days are deleted (0: never). */
  versionsDays: number;
  /** While AutoSave is on, a version is added at most this often, in minutes (a Save always adds one). */
  versionMinutes: number;
  /** When a file changes outside the app: ask, reload it (when it has no unsaved changes here), or do nothing. */
  changedOnDisk: 'ask' | 'reload' | 'ignore';
  /** Put a small lock file beside each open file, as Word and LibreOffice do, so others see it is open. */
  lockFiles: boolean;
  /** Say when a file opened here is already open somewhere else (its lock file, or Office's). */
  warnOpenElsewhere: boolean;
}

export const DEFAULT_KEEP: KeepPrefs = {
  recoveryMinutes: 2, recoveryDays: 7, autoSave: false, autoSaveSeconds: 30,
  versionsKeep: 30, versionsDays: 60, versionMinutes: 10,
  changedOnDisk: 'ask', lockFiles: true, warnOpenElsewhere: true,
};

const RANGES: Record<'recoveryMinutes' | 'recoveryDays' | 'autoSaveSeconds' | 'versionsKeep' | 'versionsDays' | 'versionMinutes', [number, number]> = {
  recoveryMinutes: [0, 120], recoveryDays: [1, 365], autoSaveSeconds: [2, 3600], versionsKeep: [0, 500], versionsDays: [0, 3650], versionMinutes: [0, 1440],
};

export function parseKeepPrefs(raw: unknown): KeepPrefs {
  const p: KeepPrefs = { ...DEFAULT_KEEP };
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number]][]) {
    const v = r[k];
    if (typeof v === 'number' && isFinite(v)) p[k] = Math.min(hi, Math.max(lo, Math.round(v)));
  }
  for (const k of ['autoSave', 'lockFiles', 'warnOpenElsewhere'] as const) if (typeof r[k] === 'boolean') p[k] = r[k] as boolean;
  if (r.changedOnDisk === 'ask' || r.changedOnDisk === 'reload' || r.changedOnDisk === 'ignore') p.changedOnDisk = r.changedOnDisk;
  return p;
}
