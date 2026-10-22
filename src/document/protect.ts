// Restrict Editing (Review > Restrict Editing, as in Word): a document can be opened by anyone
// but changed only in one way, chosen when protecting it: not at all (read only), only by adding
// comments, only as tracked changes, or only by filling in its form fields. A password, when one
// is set, is needed to stop the protection. It is kept as Word keeps it (settings.xml's
// w:documentProtection: a salted hash, hashed again many times over), so a document protected
// here is protected in Word and the other way round, with the same password. As in Word, this
// guards against changes made by mistake; it is not encryption, and the text can still be read.
//
// The rule is checked on every change to the text (see TextEditing.guard): a change is let
// through when the document still reads the same once the kind of change allowed is set aside
// (comments taken off, tracked changes rejected, form fields' entries left out).

import type { DocText } from './document';
import { decideEverywhere } from './revisions';
import { sha } from '../sha';
import type { TextRun } from '../model';
import * as rt from '../richtext';

/** What can still be changed: nothing, comments, tracked changes, form fields (Word's w:edit values). */
export type ProtectKind = 'readOnly' | 'comments' | 'trackedChanges' | 'forms';

export interface Protection {
  edit: ProtectKind;
  /** The password's hash and its salt, in base64, as Word keeps them; none when no password was set (anyone can stop it). */
  hash?: string;
  salt?: string;
  /** The hash's algorithm (Word's names: SHA-512 unless the file said another) and how many rounds of it. */
  alg?: string;
  spin?: number;
}

/** The kinds, as Word's Restrict Editing pane names them. */
export const PROTECT_NAMES: Record<ProtectKind, string> = {
  readOnly: 'No changes (Read only)',
  comments: 'Comments',
  trackedChanges: 'Tracked changes',
  forms: 'Filling in forms',
};

/** What is said when a change is turned away. */
export const PROTECT_REFUSED: Record<ProtectKind, string> = {
  readOnly: 'This document is protected: it can be read but not changed. Review > Restrict Editing stops the protection.',
  comments: 'This document is protected: only comments can be added (Review > New Comment). Review > Restrict Editing stops the protection.',
  trackedChanges: 'This document is protected: changes are tracked and can\'t be accepted or rejected, and formatting can\'t be changed. Review > Restrict Editing stops the protection.',
  forms: 'This document is protected: only its form fields can be filled in (click one, or press Tab to go to the next). Review > Restrict Editing stops the protection.',
};

/** Word's numbers for hash algorithms (w:cryptAlgorithmSid). */
export const ALG_SIDS: Record<string, number> = { 'SHA-1': 4, 'SHA-256': 12, 'SHA-384': 13, 'SHA-512': 14 };

// ---------------------------------------------------------------- the rule

/** Is the change from `before` to `after` one the document's protection allows? Always, when it isn't protected. */
export function allowedEdit(before: DocText, after: DocText): boolean {
  const p = before.protect;
  if (!p) return true;
  if (!sameProtection(p, after.protect)) return false;
  switch (p.edit) {
    case 'readOnly': return canon(before, {}) === canon(after, {});
    case 'comments': return canon(before, { comments: true }) === canon(after, { comments: true });
    case 'trackedChanges': return !!after.track && canon(before, { comments: true, rejected: true }) === canon(after, { comments: true, rejected: true });
    case 'forms': return canon(before, { forms: true }) === canon(after, { forms: true });
  }
}

export function sameProtection(a: Protection | undefined, b: Protection | undefined): boolean {
  if (!a || !b) return a === b;
  return a.edit === b.edit && a.hash === b.hash && a.salt === b.salt && a.alg === b.alg && a.spin === b.spin;
}

/** Figures and pictures stand for themselves (they are never changed in place), so they compare by identity, not by their (large) contents. */
const tokens = new WeakMap<object, number>();
let nextToken = 1;
const tokenOf = (o: object): number => {
  let k = tokens.get(o);
  if (!k) { k = nextToken++; tokens.set(o, k); }
  return k;
};

/**
 * The document as text to compare, with what may change set aside: comments (the marks on the
 * text and the comments themselves), tracked changes (all rejected: what was there before any
 * of them), form fields' entries. Objects no longer in the text are left out.
 */
function canon(t: DocText, how: { comments?: boolean; rejected?: boolean; forms?: boolean }): string {
  let x = how.rejected ? decideEverywhere(t, false) : t;
  // comments' marks off the text, and the runs they split joined up again
  if (how.comments) {
    const bare = (runs: TextRun[]) => (runs.some((r) => r.cmt) ? rt.normalizeRuns(runs.map(({ cmt: _c, ...r }) => r)) : runs);
    const objects: DocText['objects'] = {};
    for (const [k, o] of Object.entries(x.objects)) {
      objects[+k] = o.kind === 'textbox' || o.kind === 'note' ? { ...o, runs: bare(o.runs) }
        : o.kind === 'table' ? { ...o, table: { ...o.table, rows: o.table.rows.map((row) => row.map((c) => ({ ...c, runs: bare(c.runs) }))) } } : o;
    }
    x = { ...x, runs: bare(x.runs), objects };
  }
  const used = new Set<number>();
  const walk = (runs: { obj?: number }[]) => {
    for (const r of runs) {
      if (r.obj === undefined || used.has(r.obj)) continue;
      used.add(r.obj);
      const o = x.objects[r.obj];
      if (o?.kind === 'textbox' || o?.kind === 'note') walk(o.runs);
      else if (o?.kind === 'table') for (const row of o.table.rows) for (const c of row) walk(c.runs);
    }
  };
  walk(x.runs);
  const objects: Record<number, unknown> = {};
  for (const id of [...used].sort((a, b) => a - b)) {
    const o = x.objects[id];
    if (!o) continue;
    if (o.kind === 'drawing' || o.kind === 'picture') objects[id] = { kind: o.kind, at: tokenOf(o) };
    else if (o.kind === 'form' && how.forms) objects[id] = { kind: 'form', type: o.type, name: o.name, items: o.items };
    else objects[id] = o;
  }
  const { comments, track: _track, protect: _p, objects: _o, ...rest } = x;
  return JSON.stringify({ ...rest, objects, ...(how.comments ? {} : { comments }), ...(how.rejected ? {} : { track: !!x.track }) });
}

// ---------------------------------------------------------------- passwords

/** Word's starting values for the password's key, by its length (ECMA-376 Part 4, 2.15.1.28). */
const INITIAL = [0xE1F0, 0x1D0F, 0xCC9C, 0x84C0, 0x110C, 0x0E10, 0xF1CE, 0x313E, 0x1872, 0xE139, 0xD40F, 0x84F9, 0x280C, 0xA96A, 0x4EC3];
/** And the values each bit of each character is mixed in with. */
const MATRIX = [
  [0xAEFC, 0x4DD9, 0x9BB2, 0x2745, 0x4E8A, 0x9D14, 0x2A09], [0x7B61, 0xF6C2, 0xFDA5, 0xEB6B, 0xC6F7, 0x9DCF, 0x2BBF],
  [0x4563, 0x8AC6, 0x05AD, 0x0B5A, 0x16B4, 0x2D68, 0x5AD0], [0x0375, 0x06EA, 0x0DD4, 0x1BA8, 0x3750, 0x6EA0, 0xDD40],
  [0xD849, 0xA0B3, 0x5147, 0xA28E, 0x553D, 0xAA7A, 0x44D5], [0x6F45, 0xDE8A, 0xAD35, 0x4A4B, 0x9496, 0x390D, 0x721A],
  [0xEB23, 0xC667, 0x9CEF, 0x29FF, 0x53FE, 0xA7FC, 0x5FD9], [0x47D3, 0x8FA6, 0x0F6D, 0x1EDA, 0x3DB4, 0x7B68, 0xF6D0],
  [0xB861, 0x60E3, 0xC1C6, 0x93AD, 0x377B, 0x6EF6, 0xDDEC], [0x45A0, 0x8B40, 0x06A1, 0x0D42, 0x1A84, 0x3508, 0x6A10],
  [0xAA51, 0x4483, 0x8906, 0x022D, 0x045A, 0x08B4, 0x1168], [0x76B4, 0xED68, 0xCAF1, 0x85C3, 0x1BA7, 0x374E, 0x6E9C],
  [0x3730, 0x6E60, 0xDCC0, 0xA9A1, 0x4363, 0x86C6, 0x1DAD], [0x3331, 0x6662, 0xCCC4, 0x89A9, 0x0373, 0x06E6, 0x0DCC],
  [0x1021, 0x2042, 0x4084, 0x8108, 0x1231, 0x2462, 0x48C4],
];

/**
 * Word's older 32-bit key for a password (at most its first 15 characters, each taken as one
 * byte: its low byte, or its high byte when that is 0), as the 8 hex digits Word then hashes.
 */
export function legacyKey(password: string): string {
  const chars = Array.from(password.slice(0, 15), (ch) => {
    const c = ch.charCodeAt(0);
    return (c & 0xff) || (c >> 8) & 0xff;
  });
  const n = chars.length;
  if (!n) return '';
  let high = INITIAL[n - 1];
  chars.forEach((c, i) => {
    const row = MATRIX[15 - n + i];
    for (let bit = 0; bit < 7; bit++) if (c & (1 << bit)) high ^= row[bit];
  });
  let low = 0;
  for (let i = n - 1; i >= 0; i--) low = (((low >> 14) & 1) | ((low << 1) & 0x7fff)) ^ chars[i];
  low = (((low >> 14) & 1) | ((low << 1) & 0x7fff)) ^ n ^ 0xce4b;
  const hex = (((high << 16) | low) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  // Word takes the key's bytes the other way round
  return hex.slice(6, 8) + hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);
}

const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

/** The bytes of a string as UTF-16, low byte first (as Word hashes text). */
function utf16(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 * i] = c & 0xff; out[2 * i + 1] = c >> 8; }
  return out;
}

/**
 * The hash Word keeps for a password: the hash of the salt and the password's older key (in
 * UTF-16), then `spin` more rounds, each of the last hash and the round's number (4 bytes, low
 * first). In base64.
 */
export function wordHash(password: string, salt: string, alg = 'SHA-512', spin = 100000): string {
  const name = ALG_SIDS[alg] ? alg : 'SHA-512';
  const s = fromB64(salt), key = utf16(legacyKey(password));
  const first = new Uint8Array(s.length + key.length);
  first.set(s);
  first.set(key, s.length);
  let h = sha(name, first);
  const buf = new Uint8Array(h.length + 4);
  for (let i = 0; i < spin; i++) {
    buf.set(h);
    buf[h.length] = i & 0xff; buf[h.length + 1] = (i >>> 8) & 0xff; buf[h.length + 2] = (i >>> 16) & 0xff; buf[h.length + 3] = (i >>> 24) & 0xff;
    h = sha(name, buf);
  }
  return toB64(h);
}

/** A protection of this kind with this password (none when it is empty): a new salt, as Word makes. */
export function protection(edit: ProtectKind, password: string): Protection {
  if (!password) return { edit };
  const salt = toB64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const alg = 'SHA-512', spin = 100000;
  return { edit, hash: wordHash(password, salt, alg, spin), salt, alg, spin };
}

/** Does the password stop the protection? Any password does when none was set. */
export function passwordOpens(p: Protection, password: string): boolean {
  if (!p.hash || !p.salt) return true;
  if (!password) return false;
  return wordHash(password, p.salt, p.alg, p.spin ?? 100000) === p.hash;
}
