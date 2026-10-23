// Files in shared folders (OneDrive, SharePoint, a lab drive): noticing that a file was changed
// by someone or something else, that it is open somewhere else, and OneDrive's conflict copies.
//
// Lock files: while a file is open here, a small hidden ".~lock.<name>#" file sits beside it,
// in LibreOffice's format, so LibreOffice and other copies of this app (on this computer or,
// through OneDrive, on someone else's) can tell. Word, Excel and PowerPoint make "~$<name>"
// owner files of their own; those are read too, never written.

import type { FileStamp } from './recovery';

export function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  if (!a || !b) return a === b;
  // some network drives round times to the second or two
  return a.size === b.size && Math.abs(a.modified - b.modified) < 1000;
}

/** Split a path into its folder (with the separator) and file name. */
export function splitPath(path: string): { folder: string; name: string } {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { folder: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/** The lock file this app (and LibreOffice) puts beside a file. */
export function lockPath(path: string): string {
  const { folder, name } = splitPath(path);
  return `${folder}.~lock.${name}#`;
}

/** The owner files Word, Excel and PowerPoint might put beside a file (Word shortens longer names). */
export function officeOwnerPaths(path: string): string[] {
  const { folder, name } = splitPath(path);
  if (!/\.(docx?|docm|xlsx?|xlsm|pptx?|pptm)$/i.test(name)) return [];
  const stem = name.replace(/\.[^.]*$/, '');
  const out = new Set([`${folder}~$${name}`]);
  if (/\.doc/i.test(name)) {
    if (stem.length >= 8) out.add(`${folder}~$${name.slice(2)}`);
    else if (stem.length === 7) out.add(`${folder}~$${name.slice(1)}`);
  }
  return [...out];
}

export interface Holder {
  user: string;
  host: string;
  /** As written in the lock file. */
  since: string;
  /** Which program: 'app' (another copy of this one), 'libreoffice' or 'office'. */
  by: 'app' | 'libreoffice' | 'office';
  /** This app's session that wrote it. */
  session?: string;
}

const MARK = 'chem-illustrator:';

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** A lock file's text: "name,user,host,DD.MM.YYYY HH:MM,url;" as LibreOffice writes it. */
export function lockText(me: { user: string; host: string }, session: string, at = new Date()): string {
  const clean = (s: string) => s.replace(/[,;\r\n]/g, ' ').trim();
  const when = `${two(at.getDate())}.${two(at.getMonth() + 1)}.${at.getFullYear()} ${two(at.getHours())}:${two(at.getMinutes())}`;
  return `${clean(me.user)},${clean(me.user)},${clean(me.host)},${when},${MARK}${clean(session)};`;
}

export function parseLock(text: string): Holder | null {
  const f = text.replace(/;\s*$/, '').split(',');
  if (f.length < 4) return null;
  const url = f.slice(4).join(',').trim();
  const user = (f[1] || f[0]).trim(), host = f[2].trim();
  if (!user && !host) return null;
  const ours = url.startsWith(MARK);
  return { user, host, since: f[3].trim(), by: ours ? 'app' : 'libreoffice', ...(ours ? { session: url.slice(MARK.length) } : {}) };
}

/**
 * An Office owner file: the user name's length in the first byte, then the name (in the
 * computer's code page) padded to 54 bytes, then the length and the name again in UTF-16.
 */
export function parseOfficeOwner(bytes: Uint8Array): Holder | null {
  if (bytes.length < 2) return null;
  const n = bytes[0];
  let user = '';
  if (n > 0 && bytes.length >= 55 + 2 * n) {
    const u16 = new Uint16Array(n);
    for (let i = 0; i < n; i++) u16[i] = bytes[55 + 2 * i] | (bytes[56 + 2 * i] << 8);
    user = String.fromCharCode(...u16);
  }
  if (!/^[\p{L}\p{N} ._'@-]+$/u.test(user) && n > 0 && n < 54) user = new TextDecoder('latin1').decode(bytes.slice(1, 1 + n));
  user = user.replace(/[\0-\x1f]/g, '').trim();
  return { user: user || 'someone', host: '', since: '', by: 'office' };
}

/** Who has it open, in words: "Sam on LAB-PC (in LibreOffice)". */
export function holderText(h: Holder): string {
  const where = h.host ? ` on ${h.host}` : '';
  const app = h.by === 'office' ? ' (in Word, Excel or PowerPoint)' : h.by === 'libreoffice' ? ' (in LibreOffice)' : ' (in Chem Illustrator)';
  return `${h.user || 'someone'}${where}${app}${h.since ? `, since ${h.since}` : ''}`;
}

/**
 * The copy OneDrive makes when a file changed in two places at once: the file's name with this
 * computer's name added ("Scheme 1-LAB-PC.cdxml"), holding the changes that couldn't be merged.
 */
export function oneDriveConflictPath(path: string, host: string): string | null {
  if (!host) return null;
  const { folder, name } = splitPath(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${folder}${name.slice(0, dot)}-${host}${name.slice(dot)}` : `${folder}${name}-${host}`;
}

/** Whether a path is in a OneDrive or SharePoint folder (where the conflict copies come from). */
export function inOneDrive(path: string): boolean {
  return /[\\/](OneDrive|SharePoint)( - [^\\/]+)?[\\/]/i.test(path);
}
