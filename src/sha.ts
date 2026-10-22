// SHA-1, SHA-256, SHA-384 and SHA-512 (FIPS 180-4), worked out here rather than with the
// browser's crypto.subtle: Word's protection passwords are hashed 100 000 times over, and each
// call to crypto.subtle waits on its own, which takes seconds; done here it takes a fraction of
// one. The constants are worked out from the primes as the standard defines them (the first
// bits of the fractional parts of their square and cube roots), not typed in.

const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 80; n++) if (PRIMES.every((p) => n % p)) PRIMES.push(n);

/** The whole part of the k-th root of n (n a BigInt). */
function iroot(n: bigint, k: 2n | 3n): bigint {
  let x = BigInt(Math.floor(Math.pow(Number(n), 1 / Number(k)))) + 1n;
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) break;
    x = y;
  }
  while (x ** k > n) x--;
  while ((x + 1n) ** k <= n) x++;
  return x;
}

/** The first `bits` bits of the fractional part of each prime's k-th root, from the `from`th prime. */
function fractions(from: number, count: number, k: 2n | 3n, bits: number): bigint[] {
  const mask = (1n << BigInt(bits)) - 1n;
  return PRIMES.slice(from, from + count).map((p) => iroot(BigInt(p) << BigInt(bits * Number(k)), k) & mask);
}

/** 64-bit values as high and low 32-bit words, one after the other. */
const words64 = (vs: bigint[]): Uint32Array => Uint32Array.from(vs.flatMap((v) => [Number(v >> 32n), Number(v & 0xffffffffn)]));

const K512 = words64(fractions(0, 80, 3n, 64));
const IV512 = words64(fractions(0, 8, 2n, 64));
const IV384 = words64(fractions(8, 8, 2n, 64));
const K256 = Uint32Array.from(fractions(0, 64, 3n, 32).map(Number));
const IV256 = Uint32Array.from(fractions(0, 8, 2n, 32).map(Number));

/** The message padded to whole blocks, with its length in bits at the end. */
function padded(data: Uint8Array, block: number, lenBytes: number): { buf: Uint8Array; dv: DataView } {
  const len = data.length;
  const buf = new Uint8Array(Math.ceil((len + 1 + lenBytes) / block) * block);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, (len * 8) >>> 0);
  dv.setUint32(buf.length - 8, Math.floor(len / 0x20000000));
  return { buf, dv };
}

// (64-bit rotations are written out on the high and low words: right by n < 32 is (h >>> n) | (l << 32 - n)
// for the high word, the other way round for the low; by n ≥ 32, the words swap and turn by n - 32)

/** Buffers kept for the short messages hashed over and over (Word's password rounds), so a round makes nothing new but its hash. */
const W512 = new Uint32Array(160);
const H512 = new Uint32Array(16);
const SHORT = new Uint8Array(256);
const SHORT_DV = new DataView(SHORT.buffer);

function sha512Core(data: Uint8Array, iv: Uint32Array, outBytes: number): Uint8Array {
  let buf: Uint8Array, dv: DataView;
  const blocks = Math.ceil((data.length + 17) / 128);
  if (blocks <= 2) {
    buf = SHORT.subarray(0, blocks * 128);
    buf.fill(0);
    buf.set(data);
    buf[data.length] = 0x80;
    dv = SHORT_DV;
    dv.setUint32(buf.length - 4, (data.length * 8) >>> 0);
  } else ({ buf, dv } = padded(data, 128, 16));
  const H = H512;
  H.set(iv);
  const W = W512;
  for (let b = 0; b < buf.length; b += 128) {
    for (let i = 0; i < 32; i++) W[i] = dv.getUint32(b + i * 4);
    for (let i = 16; i < 80; i++) {
      const xh = W[2 * i - 30], xl = W[2 * i - 29];
      const s0h = (((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7)) >>> 0;
      const s0l = (((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25))) >>> 0;
      const yh = W[2 * i - 4], yl = W[2 * i - 3];
      const s1h = (((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6)) >>> 0;
      const s1l = (((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26))) >>> 0;
      const lo = W[2 * i - 31] + s0l + W[2 * i - 13] + s1l;
      W[2 * i] = W[2 * i - 32] + s0h + W[2 * i - 14] + s1h + Math.floor(lo / 0x100000000);
      W[2 * i + 1] = lo;
    }
    let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
    let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
    for (let i = 0; i < 80; i++) {
      const S1h = (((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23))) >>> 0;
      const S1l = (((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23))) >>> 0;
      const chh = ((eh & fh) ^ (~eh & gh)) >>> 0, chl = ((el & fl) ^ (~el & gl)) >>> 0;
      const t1l = hl + S1l + chl + K512[2 * i + 1] + W[2 * i + 1];
      const t1h = hh + S1h + chh + K512[2 * i] + W[2 * i] + Math.floor(t1l / 0x100000000);
      const S0h = (((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25))) >>> 0;
      const S0l = (((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25))) >>> 0;
      const mjh = ((ah & bh) ^ (ah & ch) ^ (bh & ch)) >>> 0, mjl = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0;
      const t2l = S0l + mjl, t2h = S0h + mjh + Math.floor(t2l / 0x100000000);
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      const nel = (dl + t1l) >>> 0;
      eh = (dh + t1h + Math.floor(((dl + (t1l >>> 0)) / 0x100000000))) >>> 0;
      el = nel;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      const nal = ((t1l >>> 0) + (t2l >>> 0));
      ah = (t1h + t2h + Math.floor(nal / 0x100000000)) >>> 0;
      al = nal >>> 0;
    }
    const add = (k: number, h: number, l: number) => {
      const lo = H[k + 1] + l;
      H[k] = H[k] + h + Math.floor(lo / 0x100000000);
      H[k + 1] = lo;
    };
    add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
  }
  const out = new Uint8Array(64);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) ov.setUint32(i * 4, H[i]);
  return out.slice(0, outBytes);
}

const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n));

function sha256(data: Uint8Array): Uint8Array {
  const { buf, dv } = padded(data, 64, 8);
  const H = Uint32Array.from(IV256);
  const W = new Uint32Array(64);
  for (let b = 0; b < buf.length; b += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(b + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = W[i - 16] + s0 + W[i - 7] + s1;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

function sha1(data: Uint8Array): Uint8Array {
  const { buf, dv } = padded(data, 64, 8);
  const H = Uint32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0);
  const W = new Uint32Array(80);
  for (let b = 0; b < buf.length; b += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(b + i * 4);
    for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
    let [a, bb, c, d, e] = H;
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(bb & c) | (~bb & d), 0x5a827999] : i < 40 ? [bb ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(bb & c) | (bb & d) | (c & d), 0x8f1bbcdc] : [bb ^ c ^ d, 0xca62c1d6];
      const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) >>> 0;
      e = d; d = c; c = ((bb << 30) | (bb >>> 2)) >>> 0; bb = a; a = t;
    }
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

/** The hash of some bytes, by its standard name: SHA-1, SHA-256, SHA-384 or SHA-512. */
export function sha(name: string, data: Uint8Array): Uint8Array {
  switch (name) {
    case 'SHA-1': return sha1(data);
    case 'SHA-256': return sha256(data);
    case 'SHA-384': return sha512Core(data, IV384, 48);
    default: return sha512Core(data, IV512, 64);
  }
}
