// Slide Show > Record: narration recorded from the microphone while the slides are shown, a
// recording for each slide, put on the slide as a sound that plays by itself as the slide comes
// in, with its icon hidden in the show (as PowerPoint puts recorded narration). Recordings are
// kept as WAV, which PowerPoint and every player can play (the browser records in its own
// format, which PowerPoint can't).

/** The name a narration's sound has (in the Selection Pane and in PowerPoint), which marks it as narration. */
export const NARRATION_NAME = 'Narration';

/** Samples (−1 to 1, one channel) as a 16-bit WAV file. */
export function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // one channel
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

/** The rate narrations are kept at: clear speech, a quarter of CD size. */
export const NARRATION_RATE = 22050;

/** A recording (in the browser's own format) as WAV, one channel at NARRATION_RATE, and how long it is. */
export async function recordingToWav(blob: Blob): Promise<{ bytes: Uint8Array; seconds: number }> {
  const data = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(data);
    const frames = Math.max(1, Math.ceil(buf.duration * NARRATION_RATE));
    const off = new OfflineAudioContext(1, frames, NARRATION_RATE);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const mono = await off.startRendering();
    return { bytes: wavBytes(mono.getChannelData(0), NARRATION_RATE), seconds: buf.duration };
  } finally {
    void ctx.close();
  }
}

/** Records the microphone in pieces: one for each slide, started and finished as the slides change. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private resolveStop: ((b: Blob | null) => void) | null = null;

  /** Ask for the microphone; false when there is none or it was refused. */
  async open(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch {
      return false;
    }
  }

  get paused(): boolean { return this.rec?.state === 'paused'; }

  /** Start a new piece. */
  start(): void {
    if (!this.stream) return;
    this.chunks = [];
    const rec = (this.rec = new MediaRecorder(this.stream));
    rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    rec.onstop = () => {
      const blob = this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType }) : null;
      this.resolveStop?.(blob);
      this.resolveStop = null;
    };
    rec.start();
  }

  pause(on: boolean): void {
    if (!this.rec) return;
    if (on && this.rec.state === 'recording') this.rec.pause();
    else if (!on && this.rec.state === 'paused') this.rec.resume();
  }

  /** Finish the piece being recorded: what was said (null when nothing was). */
  finish(): Promise<Blob | null> {
    const rec = this.rec;
    this.rec = null;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => { this.resolveStop = resolve; rec.stop(); });
  }

  close(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }
}
