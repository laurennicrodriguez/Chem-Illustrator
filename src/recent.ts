// File > Recent: the files and workspaces opened or saved lately (desktop app), newest first.


/** How many are kept and listed. */
export const RECENT_MAX = 10;

/** Windows paths are the same file whatever their capitals. */
function sameFile(a: string, b: string): boolean {
  const win = /^[a-zA-Z]:[\\/]|^\\\\/.test(a);
  return win ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The list with `path` at the top (moved there if it was already in it). */
export function addRecent(list: readonly string[], path: string, max = RECENT_MAX): string[] {
  return [path, ...list.filter((p) => !sameFile(p, path))].slice(0, max);
}

export function removeRecent(list: readonly string[], path: string): string[] {
  return list.filter((p) => !sameFile(p, path));
}

/** What the menu shows: the file's name, and its folder (shortened) to tell same-named files apart. */
export function recentLabel(path: string): { name: string; folder: string } {
  const name = path.split(/[\\/]/).pop() || path;
  const folder = path.slice(0, path.length - name.length).replace(/[\\/]$/, '');
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return { name, folder: parts.length > 3 ? '…' + (folder.includes('\\') ? '\\' : '/') + parts.slice(-2).join(folder.includes('\\') ? '\\' : '/') : folder };
}
