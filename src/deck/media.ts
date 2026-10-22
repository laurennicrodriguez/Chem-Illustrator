// Video and sound from files on slides (Insert > Video, Insert > Audio), as PowerPoint has them:
// trimmed at either end, faded in and out, started by themselves or by a click, looped,
// rewound, at a volume, a sound's icon hidden in the show or the sound carried on across slides.
// The rules here are pure (no screen), so they can be tested; the slide show plays them with the
// browser's own video and audio players (deck/playback.ts).

import type { Media } from '../model';

/** The files Insert > Video takes, by extension, with their types. */
export const VIDEO_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
/** The files Insert > Audio takes. */
export const AUDIO_TYPES: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg' };

/** A video or sound file's type from its name, or null when it isn't one we take. */
export function mediaMime(name: string): { mime: string; audio: boolean } | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (VIDEO_TYPES[ext]) return { mime: VIDEO_TYPES[ext], audio: false };
  if (AUDIO_TYPES[ext]) return { mime: AUDIO_TYPES[ext], audio: true };
  return null;
}

/** The extension a media type is saved with in a PowerPoint file. */
export const MEDIA_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac', 'audio/ogg': 'ogg',
};

/** The part of the file that plays: from `start` to `end` seconds (end Infinity while its length isn't known). */
export function playWindow(m: Media, length = m.length): { start: number; end: number } {
  const start = Math.max(0, m.trimStart ?? 0);
  const end = length !== undefined && Number.isFinite(length) ? Math.max(start, length - Math.max(0, m.trimEnd ?? 0)) : Infinity;
  return { start, end };
}

/** The volume at `t` seconds into the file: its own volume, faded in after the start and out before the end. */
export function volumeAt(m: Media, t: number, length = m.length): number {
  if (m.mute) return 0;
  const v = Math.max(0, Math.min(1, m.vol ?? 1));
  const w = playWindow(m, length);
  let k = 1;
  if (m.fadeIn && m.fadeIn > 0) k = Math.min(k, Math.max(0, (t - w.start) / m.fadeIn));
  if (m.fadeOut && m.fadeOut > 0 && Number.isFinite(w.end)) k = Math.min(k, Math.max(0, (w.end - t) / m.fadeOut));
  return v * Math.max(0, Math.min(1, k));
}

/** Named volumes, as PowerPoint's Volume menu. */
export const VOLUMES: { name: string; vol: number; mute?: boolean }[] = [
  { name: 'Low', vol: 0.33 }, { name: 'Medium', vol: 0.66 }, { name: 'High', vol: 1 }, { name: 'Mute', vol: 1, mute: true },
];

/** A length as a clock with tenths: 75.25 → "1:15.3". */
export function mediaTime(s: number): string {
  if (!Number.isFinite(s)) return '–';
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const r = t - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

// ---------------------------------------------------------------- pictures for them (in the app)

/** A loudspeaker, as the picture a sound shows on the slide (PNG, 128 pixels). */
export function speakerPng(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return '';
  g.fillStyle = '#4a5562';
  g.beginPath();
  g.moveTo(18, 48); g.lineTo(42, 48); g.lineTo(72, 20); g.lineTo(72, 108); g.lineTo(42, 80); g.lineTo(18, 80);
  g.closePath();
  g.fill();
  g.strokeStyle = '#4a5562';
  g.lineWidth = 8;
  g.lineCap = 'round';
  for (const r of [20, 36]) {
    g.beginPath();
    g.arc(72, 64, r, -Math.PI / 4, Math.PI / 4);
    g.stroke();
  }
  try { return c.toDataURL('image/png'); } catch { return ''; }
}

/**
 * What a video file holds: its size in pixels, its length in seconds and a picture of its first
 * moments (PNG), from the browser's own player. Null when this system can't play it.
 */
export function probeVideo(url: string): Promise<{ w: number; h: number; length: number; poster: string } | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    let done = false;
    const finish = (r: { w: number; h: number; length: number; poster: string } | null) => { if (!done) { done = true; v.removeAttribute('src'); v.load(); resolve(r); } };
    const timer = window.setTimeout(() => finish(null), 15000);
    v.addEventListener('error', () => { clearTimeout(timer); finish(null); });
    v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(0.1, (v.duration || 0) / 2); });
    v.addEventListener('seeked', () => {
      clearTimeout(timer);
      const w = v.videoWidth || 640, h = v.videoHeight || 360;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      let poster = '';
      try { c.getContext('2d')?.drawImage(v, 0, 0, w, h); poster = c.toDataURL('image/png'); } catch { /* no picture: grey */ }
      finish({ w, h, length: Number.isFinite(v.duration) ? v.duration : 0, poster });
    });
    v.src = url;
  });
}

/** A sound file's length in seconds (0 when it can't be read here). */
export function probeAudio(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    const timer = window.setTimeout(() => resolve(0), 10000);
    a.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(Number.isFinite(a.duration) ? a.duration : 0); });
    a.addEventListener('error', () => { clearTimeout(timer); resolve(0); });
    a.src = url;
  });
}
