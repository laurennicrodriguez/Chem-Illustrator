// Reading and writing OLE compound files (the "structured storage" format Windows programs use
// to embed one document in another, published by Microsoft as [MS-CFB]). Word keeps each
// embedded object in one of these: a ChemDraw drawing is one of its streams, a file put in with
// Insert > Object another.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;

/** Is this a compound file? */
export function isCfb(b: Uint8Array): boolean {
  return b.length >= 512 && SIGNATURE.every((v, i) => b[i] === v);
}

/** Every stream in a compound file, by name (the folders they sit in are not kept). Throws when the file can't be read. */
export function cfbStreams(b: Uint8Array): Map<string, Uint8Array> {
  return read(b, 'streams') as Map<string, Uint8Array>;
}

/** The class id of the program a compound file belongs to ("{00020830-0000-0000-C000-000000000046}"), or null. Throws when the file can't be read. */
export function cfbClass(b: Uint8Array): string | null {
  return read(b, 'class') as string | null;
}

function read(b: Uint8Array, want: 'streams' | 'class'): Map<string, Uint8Array> | string | null {
  if (!isCfb(b)) throw new Error('Not a compound file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (at: number) => (at + 4 <= b.length ? dv.getUint32(at, true) : END);
  const shift = dv.getUint16(0x1e, true);
  const size = 1 << shift;
  const miniSize = 1 << dv.getUint16(0x20, true);
  const cutoff = u32(0x38);
  const sectorAt = (n: number) => (n + 1) * size;

  // the sectors holding the table of sector chains (the FAT): 109 named in the header, the rest in a chain of their own
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(0x4c + 4 * i);
    if (s !== FREE && s !== END) fatSectors.push(s);
  }
  let difat = u32(0x44);
  for (let guard = 0; difat !== END && difat !== FREE && guard < 1e5; guard++) {
    const at = sectorAt(difat);
    for (let i = 0; i < size / 4 - 1; i++) {
      const s = u32(at + 4 * i);
      if (s !== FREE && s !== END) fatSectors.push(s);
    }
    difat = u32(at + size - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const at = sectorAt(s);
    for (let i = 0; i < size / 4; i++) fat.push(u32(at + 4 * i));
  }

  /** A chain of sectors joined up (stopping at a loop or the file's end). */
  const chain = (start: number, table: number[], read: (n: number) => Uint8Array): Uint8Array => {
    const parts: Uint8Array[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== END && s !== FREE && s < table.length && !seen.has(s); s = table[s]) {
      seen.add(s);
      parts.push(read(s));
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const sector = (n: number) => b.subarray(sectorAt(n), Math.min(b.length, sectorAt(n) + size));

  const dir = chain(u32(0x30), fat, sector);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const len = Math.min(64, ddv.getUint16(at + 64, true));
    let name = '';
    for (let i = 0; i + 2 < len; i += 2) name += String.fromCharCode(ddv.getUint16(at + i, true));
    entries.push({ name, type: dir[at + 66], start: ddv.getUint32(at + 116, true), size: ddv.getUint32(at + 120, true) });
  }
  const root = entries.find((e) => e.type === 5);
  if (want === 'class') return root ? guidText(dir.subarray(80, 96)) : null;

  // small streams live in the "mini stream", in 64-byte pieces chained by the mini FAT
  const miniFat: number[] = [];
  const mf = chain(u32(0x3c), fat, sector);
  for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(new DataView(mf.buffer, mf.byteOffset + i, 4).getUint32(0, true));
  const mini = root ? chain(root.start, fat, sector) : new Uint8Array(0);

  const out = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== 2) continue;
    const data = e.size < cutoff
      ? chain(e.start, miniFat, (n) => mini.subarray(n * miniSize, (n + 1) * miniSize))
      : chain(e.start, fat, sector);
    out.set(e.name, data.subarray(0, e.size));
  }
  return out;
}

/** A class id as text, from its 16 bytes as stored (the first three parts little-endian). */
function guidText(g: Uint8Array): string | null {
  if (g.length < 16 || g.every((v) => v === 0)) return null;
  const h = (from: number, to: number, rev: boolean) => {
    const part = Array.from(g.subarray(from, to));
    return (rev ? part.reverse() : part).map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  return `{${h(0, 4, true)}-${h(4, 6, true)}-${h(6, 8, true)}-${h(8, 10, false)}-${h(10, 16, false)}}`.toUpperCase();
}

/** A class id's 16 bytes as stored, from its text. */
function guidBytes(text: string): Uint8Array {
  const hex = text.replace(/[{}-]/g, '');
  const out = new Uint8Array(16);
  if (!/^[0-9a-f]{32}$/i.test(hex)) return out;
  const byte = (i: number) => parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  [3, 2, 1, 0, 5, 4, 7, 6].forEach((from, to) => { out[to] = byte(from); });
  for (let i = 8; i < 16; i++) out[i] = byte(i);
  return out;
}

const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;

/**
 * A compound file (version 3, 512-byte sectors) holding these streams in its top folder, with
 * the program's class id on its root when given. Names are at most 31 characters.
 */
export function writeCfb(streams: [string, Uint8Array][], clsid?: string): Uint8Array {
  // small streams go in the mini stream, in 64-byte pieces chained by the mini FAT
  const miniFat: number[] = [];
  const miniParts: Uint8Array[] = [];
  type Entry = { name: string; data: Uint8Array; start: number };
  const entries: Entry[] = streams.map(([name, data]) => ({ name: name.slice(0, 31), data, start: END }));
  for (const e of entries) {
    if (e.data.length === 0 || e.data.length >= CUTOFF) continue;
    const n = Math.ceil(e.data.length / MINI);
    e.start = miniFat.length;
    for (let i = 0; i < n; i++) {
      miniParts.push(e.data.subarray(i * MINI, (i + 1) * MINI));
      miniFat.push(i < n - 1 ? e.start + i + 1 : END);
    }
  }
  const miniStream = new Uint8Array(miniParts.length * MINI);
  miniParts.forEach((p, i) => miniStream.set(p, i * MINI));
  const u32s = (xs: number[]) => {
    const out = new Uint8Array(xs.length * 4);
    const dv = new DataView(out.buffer);
    xs.forEach((x, i) => dv.setUint32(4 * i, x >>> 0, true));
    return out;
  };

  // everything that takes whole sectors, in order: big streams, the mini stream, the mini FAT, the folder
  const blocks: { data: Uint8Array; start: number }[] = [];
  let used = 0;
  const place = (data: Uint8Array): number => {
    if (!data.length) return END;
    const start = used;
    blocks.push({ data, start });
    used += Math.ceil(data.length / SECTOR);
    return start;
  };
  for (const e of entries) if (e.data.length >= CUTOFF) e.start = place(e.data);
  const miniStart = place(miniStream);
  const miniFatStart = place(u32s([...miniFat, ...new Array<number>((SECTOR / 4 - (miniFat.length % (SECTOR / 4))) % (SECTOR / 4)).fill(FREE)]));

  // the folder: the root, then each stream; the streams hang off the root as a balanced tree
  // (all black), ordered as the format says: shorter names first, then by their capitals
  const order = entries.map((_, i) => i).sort((a, b) => {
    const x = entries[a].name, y = entries[b].name;
    if (x.length !== y.length) return x.length - y.length;
    const X = x.toUpperCase(), Y = y.toUpperCase();
    return X < Y ? -1 : X > Y ? 1 : 0;
  });
  const left = new Array<number>(entries.length).fill(FREE), right = new Array<number>(entries.length).fill(FREE);
  const tree = (lo: number, hi: number): number => {
    if (lo > hi) return FREE;
    const mid = (lo + hi) >> 1;
    const i = order[mid];
    left[i] = tree(lo, mid - 1);
    right[i] = tree(mid + 1, hi);
    return i + 1;
  };
  const top = tree(0, order.length - 1);
  const count = entries.length + 1;
  const dir = new Uint8Array(128 * Math.ceil(count / 4) * 4);
  const ddv = new DataView(dir.buffer);
  for (let i = 0; i < dir.length / 128; i++) {
    const at = 128 * i;
    ddv.setUint32(at + 68, FREE, true);
    ddv.setUint32(at + 72, FREE, true);
    ddv.setUint32(at + 76, FREE, true);
    if (i >= count) continue;
    const e = i === 0 ? null : entries[i - 1];
    const name = e ? e.name : 'Root Entry';
    for (let k = 0; k < name.length; k++) ddv.setUint16(at + 2 * k, name.charCodeAt(k), true);
    ddv.setUint16(at + 64, (name.length + 1) * 2, true);
    dir[at + 66] = e ? 2 : 5;
    dir[at + 67] = 1;
    if (e) {
      ddv.setUint32(at + 68, left[i - 1], true);
      ddv.setUint32(at + 72, right[i - 1], true);
    } else {
      ddv.setUint32(at + 76, top, true);
      if (clsid) dir.set(guidBytes(clsid), at + 80);
    }
    ddv.setUint32(at + 116, e ? e.start : miniStart, true);
    ddv.setUint32(at + 120, e ? e.data.length : miniStream.length, true);
  }
  const dirStart = place(dir);

  // the FAT covers every sector, its own and the DIFAT's among them
  let fatN = 0, difN = 0;
  for (;;) {
    const f = Math.ceil((used + fatN + difN) / (SECTOR / 4));
    const d = f > 109 ? Math.ceil((f - 109) / (SECTOR / 4 - 1)) : 0;
    if (f === fatN && d === difN) break;
    fatN = f; difN = d;
  }
  const fatStart = used, difStart = used + fatN;
  const total = used + fatN + difN;
  const fat = new Array<number>(fatN * (SECTOR / 4)).fill(FREE);
  for (const b of blocks) {
    const n = Math.ceil(b.data.length / SECTOR);
    for (let i = 0; i < n; i++) fat[b.start + i] = i < n - 1 ? b.start + i + 1 : END;
  }
  for (let i = 0; i < fatN; i++) fat[fatStart + i] = FATSECT;
  for (let i = 0; i < difN; i++) fat[difStart + i] = DIFSECT;

  const out = new Uint8Array(SECTOR * (total + 1));
  const dv = new DataView(out.buffer);
  out.set(SIGNATURE);
  dv.setUint16(0x18, 0x3e, true);
  dv.setUint16(0x1a, 3, true);
  dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, 9, true);
  dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, fatN, true);
  dv.setUint32(0x30, dirStart, true);
  dv.setUint32(0x38, CUTOFF, true);
  dv.setUint32(0x3c, miniFatStart, true);
  dv.setUint32(0x40, Math.ceil((miniFat.length * 4) / SECTOR), true);
  dv.setUint32(0x44, difN ? difStart : END, true);
  dv.setUint32(0x48, difN, true);
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + 4 * i, i < fatN ? fatStart + i : FREE, true);
  const at = (sector: number) => SECTOR * (sector + 1);
  for (const b of blocks) out.set(b.data, at(b.start));
  out.set(u32s(fat), at(fatStart));
  // the FAT sectors past the first 109, listed in the DIFAT's own chain
  for (let d = 0; d < difN; d++) {
    const base = at(difStart + d);
    for (let k = 0; k < SECTOR / 4 - 1; k++) {
      const f = 109 + d * (SECTOR / 4 - 1) + k;
      dv.setUint32(base + 4 * k, f < fatN ? fatStart + f : FREE, true);
    }
    dv.setUint32(base + SECTOR - 4, d < difN - 1 ? difStart + d + 1 : END, true);
  }
  return out;
}
