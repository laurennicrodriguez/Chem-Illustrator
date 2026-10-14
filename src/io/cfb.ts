// Reading the streams of an OLE compound file (the "structured storage" format Windows programs
// use to embed one document in another, published by Microsoft as [MS-CFB]). Word keeps each
// embedded ChemDraw object in one of these; the ChemDraw drawing itself is one of its streams.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;

/** Is this a compound file? */
export function isCfb(b: Uint8Array): boolean {
  return b.length >= 512 && SIGNATURE.every((v, i) => b[i] === v);
}

/** Every stream in a compound file, by name (the folders they sit in are not kept). Throws when the file can't be read. */
export function cfbStreams(b: Uint8Array): Map<string, Uint8Array> {
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
