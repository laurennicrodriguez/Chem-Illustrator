// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// Animated GIFs. Line art seldom uses more than 256 colours, so the palette is usually exact
// (no drifting off-white paper, no dither speckle on the greys); when it does use more, the
// most-used colours are kept, white always among them, and the rest go to their nearest. Frames
// that repeat the one before (the holds) are merged into one longer frame.

export interface RgbaFrame { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

const WHITE = 0xffffff;
const pack = (d: ArrayLike<number>, i: number) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];

/** Colour (packed RGB) → palette index, and the palette, from how often each colour is used. */
function palette(counts: Map<number, number>): { pal: number[]; index: (c: number) => number } {
  if (counts.size <= 256) {
    const pal = [WHITE, ...[...counts.keys()].filter((c) => c !== WHITE).sort((a, b) => a - b)].slice(0, 256);
    const at = new Map(pal.map((c, i) => [c, i]));
    return { pal, index: (c) => at.get(c) ?? 0 };
  }
  const ranked = [...counts.keys()].filter((c) => c !== WHITE).sort((a, b) => counts.get(b)! - counts.get(a)!);
  const pal = [WHITE, ...ranked.slice(0, 255)];
  const at = new Map(pal.map((c, i) => [c, i]));
  const index = (c: number) => {
    const hit = at.get(c);
    if (hit !== undefined) return hit;
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const p = pal[i];
      const dr = r - (p >> 16), dg = g - ((p >> 8) & 255), db = b - (p & 255);
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    at.set(c, best);
    return best;
  };
  return { pal, index };
}

class Bytes {
  buf = new Uint8Array(1 << 16);
  n = 0;
  byte(b: number) {
    if (this.n === this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
    this.buf[this.n++] = b;
  }
  word(w: number) { this.byte(w & 255); this.byte((w >> 8) & 255); }
  str(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  out() { return this.buf.slice(0, this.n); }
}

// LZW dictionary: (prefix code, next index) → code, without clearing a big table each time
const TABLE = 4096 * 256;
let codes: Int16Array | null = null;
let stamps: Int32Array | null = null;
let generation = 0;

/** GIF's LZW, written as data sub-blocks. */
function lzw(out: Bytes, px: Uint8Array, minSize: number): void {
  codes ??= new Int16Array(TABLE);
  stamps ??= new Int32Array(TABLE);
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1;
  let acc = 0, bits = 0;
  const block: number[] = [];
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
      if (block.length === 255) { out.byte(255); for (const b of block) out.byte(b); block.length = 0; }
    }
  };
  const reset = () => { generation++; size = minSize + 1; next = eoi + 1; };
  out.byte(minSize);
  reset();
  emit(clear);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i];
    const key = prefix * 256 + k;
    if (stamps[key] === generation) { prefix = codes[key]; continue; }
    emit(prefix);
    if (next < 4096) {
      stamps[key] = generation;
      codes[key] = next;
      if (next === 1 << size && size < 12) size++;
      next++;
    } else {
      emit(clear);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) block.push(acc & 255);
  if (block.length) { out.byte(block.length); for (const b of block) out.byte(b); }
  out.byte(0);
}

/**
 * An animated GIF of `n` frames all the same size, each shown for `delayMs` (stored in hundredths
 * of a second), looping for ever (`loop` 0) or that many times. Frames are asked for twice (once
 * to choose the colours, once to write them), so a long clip never has to sit in memory whole.
 */
export async function encodeGif(n: number, frameAt: (i: number) => RgbaFrame | Promise<RgbaFrame>, delayMs: number, loop = 0): Promise<Uint8Array> {
  if (!n) throw new Error('No frames to save.');
  const counts = new Map<number, number>();
  let w = 0, h = 0;
  for (let k = 0; k < n; k++) {
    const f = await frameAt(k);
    if (!k) { w = f.width; h = f.height; }
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) { const c = pack(d, i); counts.set(c, (counts.get(c) ?? 0) + 1); }
  }
  const { pal, index } = palette(counts);
  let bitsPer = 1;
  while (1 << bitsPer < pal.length) bitsPer++;
  const out = new Bytes();
  out.str('GIF89a');
  out.word(w); out.word(h);
  out.byte(0x80 | ((bitsPer - 1) << 4) | (bitsPer - 1));
  out.byte(0); out.byte(0);
  for (let i = 0; i < 1 << bitsPer; i++) { const c = pal[i] ?? 0; out.byte(c >> 16); out.byte((c >> 8) & 255); out.byte(c & 255); }
  out.byte(0x21); out.byte(0xff); out.byte(11); out.str('NETSCAPE2.0'); out.byte(3); out.byte(1); out.word(loop); out.byte(0);

  const cs = Math.max(1, Math.round(delayMs / 10));
  // each run of identical frames (the holds) becomes one longer frame
  let held: Uint8Array | null = null;
  let delay = 0;
  const flush = () => {
    if (!held) return;
    out.byte(0x21); out.byte(0xf9); out.byte(4); out.byte(0); out.word(delay); out.byte(0); out.byte(0);
    out.byte(0x2c); out.word(0); out.word(0); out.word(w); out.word(h); out.byte(0);
    lzw(out, held, Math.max(2, bitsPer));
  };
  for (let k = 0; k < n; k++) {
    const d = (await frameAt(k)).data;
    const px = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < px.length; i += 4, j++) px[j] = index(pack(d, i));
    if (held && delay + cs <= 0xffff && sameBytes(held, px)) { delay += cs; continue; }
    flush();
    held = px;
    delay = cs;
  }
  flush();
  out.byte(0x3b);
  return out.out();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
