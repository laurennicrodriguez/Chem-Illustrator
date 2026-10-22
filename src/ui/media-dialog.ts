// The Playback window for a video or sound on a slide (double-click it, or Playback… in the
// right-hand panel), as PowerPoint's Playback tab: trim it (type the times, or play it and set
// the start or end where it is), fade it in and out, its volume, when it starts in the show, and
// whether it loops, rewinds, fills the screen, hides its icon or plays on across slides.

import type { Media } from '../model';
import { VOLUMES, mediaTime, playWindow } from '../deck/media';

/** Resolves with the media's new settings, or null when cancelled. */
export function editMedia(m: Media): Promise<Media | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask media-dialog';
    d.setAttribute('aria-label', m.audio ? 'Audio Playback' : 'Video Playback');
    const h = document.createElement('h2');
    h.textContent = m.audio ? 'Audio Playback' : 'Video Playback';
    const player = document.createElement(m.audio ? 'audio' : 'video');
    player.controls = true;
    player.preload = 'auto';
    player.src = m.src;
    player.className = 'md-player';
    const length = () => (Number.isFinite(player.duration) && player.duration > 0 ? player.duration : m.length ?? 0);

    const row = (label: string, control: HTMLElement, help?: string, extra?: HTMLElement) => {
      const r = document.createElement('label');
      r.className = 'ask-row';
      const span = document.createElement('span');
      span.textContent = label;
      r.append(span, control);
      if (extra) r.append(extra);
      if (help) r.title = help;
      return r;
    };
    const num = (v: number | undefined, step = 0.1) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = '0';
      i.step = String(step);
      i.value = String(+(v ?? 0).toFixed(2));
      i.style.width = '6em';
      return i;
    };
    const check = (label: string, on: boolean, help: string) => {
      const r = document.createElement('label');
      r.className = 'ask-row ask-check';
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = on;
      r.append(i, document.createTextNode(label));
      r.title = help;
      return { r, i };
    };
    const here = (label: string, act: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', act);
      return b;
    };

    const trimStart = num(m.trimStart), trimEnd = num(m.trimEnd);
    const plays = document.createElement('p');
    plays.className = 'muted small';
    const say = () => {
      const w = playWindow({ ...m, trimStart: Number(trimStart.value) || 0, trimEnd: Number(trimEnd.value) || 0 }, length() || undefined);
      plays.textContent = length() ? `Plays ${mediaTime(w.start)} to ${mediaTime(w.end)} of ${mediaTime(length())} (${mediaTime(Math.max(0, w.end - w.start))} long).` : 'Trim cuts seconds off the start and the end.';
    };
    trimStart.addEventListener('input', say);
    trimEnd.addEventListener('input', say);
    player.addEventListener('loadedmetadata', say);
    const setStart = here('Start here', () => { trimStart.value = player.currentTime.toFixed(2); say(); });
    const setEnd = here('End here', () => { if (length()) trimEnd.value = Math.max(0, length() - player.currentTime).toFixed(2); say(); });
    setStart.title = 'Play or move the player to where it should start, then click';
    setEnd.title = 'Play or move the player to where it should stop, then click';

    const fadeIn = num(m.fadeIn), fadeOut = num(m.fadeOut);
    const vol = document.createElement('select');
    for (const v of VOLUMES) vol.add(new Option(v.name, v.name));
    vol.value = m.mute ? 'Mute' : (VOLUMES.filter((v) => !v.mute).reduce((a, b) => (Math.abs(b.vol - (m.vol ?? 1)) < Math.abs(a.vol - (m.vol ?? 1)) ? b : a)).name);
    const start = document.createElement('select');
    start.add(new Option('Automatically, as the slide comes in', 'auto'));
    start.add(new Option('When Clicked On', 'click'));
    start.value = m.start ?? 'auto';
    const loop = check('Loop until stopped', !m.once, 'Play round and round until the slide changes (or it is clicked)');
    const rewind = check('Rewind after playing', !!m.rewind, 'Go back to the start when it has played');
    const full = check('Play full screen', !!m.full, 'Fill the screen while it plays');
    const hide = check('Hide during show', !!m.hide, 'The loudspeaker isn\'t shown in the slide show (the sound still plays)');
    const across = check('Play across slides', !!m.across, 'Keep playing when the show goes on to the next slides, as background music');

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = here('Cancel', () => d.close());
    let result: Media | null = null;
    const ok = here('OK', () => {
      const v = VOLUMES.find((x) => x.name === vol.value)!;
      const n = (i: HTMLInputElement) => Math.max(0, Number(i.value) || 0);
      const next: Media = { src: m.src, ...(m.audio ? { audio: true } : {}), ...(length() ? { length: +length().toFixed(3) } : m.length ? { length: m.length } : {}) };
      if (n(trimStart)) next.trimStart = n(trimStart);
      if (n(trimEnd)) next.trimEnd = n(trimEnd);
      if (n(fadeIn)) next.fadeIn = n(fadeIn);
      if (n(fadeOut)) next.fadeOut = n(fadeOut);
      if (start.value === 'click') next.start = 'click';
      if (v.mute) next.mute = true;
      else if (v.vol !== 1) next.vol = v.vol;
      if (!loop.i.checked) next.once = true;
      if (rewind.i.checked) next.rewind = true;
      if (!m.audio && full.i.checked) next.full = true;
      if (m.audio && hide.i.checked) next.hide = true;
      if (m.audio && across.i.checked) next.across = true;
      result = next;
      d.close();
    });
    ok.className = 'primary';
    buttons.append(cancel, ok);
    const pair = document.createElement('span');
    pair.append(setStart, ' ', setEnd);
    d.append(h, player,
      row('Trim start (s)', trimStart, 'Seconds cut off the start'), row('Trim end (s)', trimEnd, 'Seconds cut off the end', pair), plays,
      row('Fade in (s)', fadeIn, 'Seconds the sound takes to come up at the start'), row('Fade out (s)', fadeOut, 'Seconds the sound takes to die away at the end'),
      row('Volume', vol), row('Start', start, 'When it starts in the slide show: by itself, or when you click it (a click on it pauses it too)'),
      loop.r, rewind.r, ...(m.audio ? [hide.r, across.r] : [full.r]), buttons);
    d.addEventListener('close', () => { player.pause(); d.remove(); resolve(result); });
    document.body.append(d);
    say();
    d.showModal();
  });
}
