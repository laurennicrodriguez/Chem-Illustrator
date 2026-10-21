// Saving an animation as an MP4 video: frames are encoded as H.264 by the system's own video
// encoder (WebCodecs) and packed into an MP4 file here. Where the system has no H.264 encoder
// (some Linux builds), `mp4Codec` says so and the window offers a GIF instead.

/** One encoded frame. */
export interface Sample { data: Uint8Array; key: boolean }

/** H.264 profiles to try, best first (High, Main, Baseline), with a level that fits the size. */
function candidates(w: number, h: number): string[] {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  // level: 3.1 to 1280×720, 4.0 to 2048×1024, 5.1 beyond (4K)
  const level = mbs <= 3600 ? '1f' : mbs <= 8192 ? '28' : '33';
  return ['avc1.6400' + level, 'avc1.4d00' + level, 'avc1.4200' + level];
}

/** Bits per second for line art at this size and rate: crisp edges, mostly white. */
const bitrate = (w: number, h: number, fps: number) => Math.round(Math.min(40e6, Math.max(1e6, w * h * fps * 0.12)));

/** The codec string this system can encode an MP4 of this size with, or null when it can't. */
export async function mp4Codec(w: number, h: number, fps: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of candidates(w, h)) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: bitrate(w, h, fps), framerate: fps, avc: { format: 'avc' } });
      if (r.supported) return codec;
    } catch { /* not this one */ }
  }
  return null;
}

/**
 * An MP4 of `n` frames at `fps`, each drawn onto `canvas` by `draw(i)` (width and height even).
 * `progress` hears how many frames are done.
 */
export async function encodeMp4(n: number, canvas: HTMLCanvasElement | OffscreenCanvas, draw: (i: number) => void, fps: number, progress?: (done: number) => void): Promise<Uint8Array> {
  const w = canvas.width, h = canvas.height;
  const codec = await mp4Codec(w, h, fps);
  if (!codec) throw new Error('This system has no H.264 video encoder.');
  const samples: Sample[] = [];
  let avcC: Uint8Array | null = null;
  let failure: Error | null = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const desc = meta?.decoderConfig?.description;
      if (desc && !avcC) avcC = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as ArrayBufferView).buffer.slice((desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteOffset + (desc as ArrayBufferView).byteLength));
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
    },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  enc.configure({ codec, width: w, height: h, bitrate: bitrate(w, h, fps), framerate: fps, avc: { format: 'avc' } });
  const keyEvery = Math.max(1, Math.round(fps * 2));
  for (let i = 0; i < n; i++) {
    if (failure) break;
    draw(i);
    const f = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(f, { keyFrame: i % keyEvery === 0 });
    f.close();
    // let the encoder catch up, and the window repaint
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    progress?.(i + 1);
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  if (!avcC) throw new Error('The video encoder gave no stream description.');
  return muxMp4(w, h, fps, avcC, samples);
}

// ------------------------------------------------------------------ the MP4 container

const TIMESCALE = 90000;

class Out {
  parts: Uint8Array[] = [];
  size = 0;
  push(b: Uint8Array) { this.parts.push(b); this.size += b.length; }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

const u32 = (v: number) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u16 = (v: number) => new Uint8Array([(v >>> 8) & 255, v & 255]);
const u8 = (v: number) => new Uint8Array([v & 255]);
const zeros = (n: number) => new Uint8Array(n);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function cat(parts: Uint8Array[]): Uint8Array {
  const o = new Out();
  for (const p of parts) o.push(p);
  return o.bytes();
}

/** A box: size, type, then its contents. */
const box = (type: string, ...body: Uint8Array[]): Uint8Array => {
  const inner = cat(body);
  return cat([u32(8 + inner.length), ascii(type), inner]);
};
/** A full box: a box with a version and flags first. */
const full = (type: string, version: number, flags: number, ...body: Uint8Array[]) => box(type, u8(version), new Uint8Array([(flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...body);

const MATRIX = cat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

/** One H.264 track's samples in an MP4 file (ftyp, mdat, moov), every frame lasting 1/fps. */
export function muxMp4(w: number, h: number, fps: number, avcC: Uint8Array, samples: Sample[]): Uint8Array {
  const dur = Math.round(TIMESCALE / fps);
  const total = dur * samples.length;
  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const payload = cat(samples.map((s) => s.data));
  const mdatHead = cat([u32(8 + payload.length), ascii('mdat')]);
  const chunkOffset = ftyp.length + mdatHead.length;

  const avc1 = box('avc1',
    zeros(6), u16(1), // reserved, data reference index
    zeros(16), u16(w), u16(h),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    zeros(32), u16(0x18), u16(0xffff),
    box('avcC', avcC),
  );
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), avc1),
    full('stts', 0, 0, u32(1), u32(samples.length), u32(dur)),
    full('stss', 0, 0, u32(samples.filter((s) => s.key).length), ...samples.flatMap((s, i) => (s.key ? [u32(i + 1)] : []))),
    full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    full('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.data.length))),
    full('stco', 0, 0, u32(1), u32(chunkOffset)),
  );
  const minf = box('minf',
    full('vmhd', 0, 1, zeros(8)),
    box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
    stbl,
  );
  const mdia = box('mdia',
    full('mdhd', 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(total), u16(0x55c4), u16(0)), // language "und"
    full('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('Chem Illustrator animation\0')),
    minf,
  );
  const trak = box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(total), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w << 16), u32(h << 16)),
    mdia,
  );
  const moov = box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(total), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
    trak,
  );
  return cat([ftyp, mdatHead, payload, moov]);
}
