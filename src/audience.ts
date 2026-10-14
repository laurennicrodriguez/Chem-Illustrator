// The audience's window in presenter view (audience.html): the slides, full screen on the
// projector, moving on as the presenter clicks. Keys and clicks here go back to the presenter,
// so the presenter's window always leads.

import { isTauri } from '@tauri-apps/api/core';
import { Player } from './deck/playback';
import { ShowLink, deckFromData, type ShowMessage } from './deck/show-link';
import { registerBundledFonts } from './fonts';
import { onImageReady } from './render/images';

const canvas = document.createElement('canvas');
document.body.append(canvas);
const wait = document.getElementById('wait')!;
let player: Player | null = null;
let blank: 'black' | 'white' | 'end' | null = null;

registerBundledFonts(() => player?.refresh());
onImageReady(() => player?.refresh());

function size(): void {
  player?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  paint();
}

function paint(): void {
  if (!blank) { player?.paint(); return; }
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = blank === 'white' ? '#fff' : '#000';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

async function end(): Promise<void> {
  link.close();
  if (isTauri()) {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWebviewWindow().destroy();
  } else window.close();
}

const link = new ShowLink('audience', (m: ShowMessage) => {
  if (m.kind === 'deck') {
    player?.stop();
    player = new Player(canvas, deckFromData(m.deck));
    wait.hidden = true;
    size();
    player.show(m.i, { atEnd: false });
    for (let k = 0; k < m.done; k++) player.next();
  } else if (m.kind === 'next') player?.next();
  else if (m.kind === 'prev') player?.prev();
  else if (m.kind === 'go') player?.show(m.i, { atEnd: m.atEnd });
  else if (m.kind === 'blank') { blank = m.how; paint(); }
  else if (m.kind === 'bye') void end();
});

window.addEventListener('resize', size);
window.addEventListener('keydown', (e) => {
  e.preventDefault();
  // in a browser, F11 or F fills the screen (the projector) from here
  if (!isTauri() && (e.key === 'f' || e.key === 'F')) { void document.documentElement.requestFullscreen?.(); return; }
  link.send({ kind: 'key', key: e.key });
});
canvas.addEventListener('click', () => link.send({ kind: 'key', key: 'click' }));
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); link.send({ kind: 'key', key: 'ArrowLeft' }); });
let hide = 0;
window.addEventListener('pointermove', () => {
  document.body.classList.remove('no-cursor');
  clearTimeout(hide);
  hide = window.setTimeout(() => document.body.classList.add('no-cursor'), 2500);
});
window.addEventListener('beforeunload', () => link.send({ kind: 'bye' }));

void link.open().then(() => link.send({ kind: 'hello' }));
