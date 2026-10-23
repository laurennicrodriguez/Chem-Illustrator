// Shared helpers for scripts/screenshots.mjs and scripts/animations.mjs: start Chromium on the
// running program, take still pictures, draw a mouse pointer (headless Chromium has none), and
// record short animations as GIFs (needs ffmpeg).

import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const out = new URL('../docs/images/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
mkdirSync(out, { recursive: true });

export async function open(url = 'http://localhost:5173/', { width = 1440, height = 900, scale = 1.5, navigator = false } = {}) {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  // SHOT_THEME=dark shows the program's own dark interface (as Windows' dark setting does)
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: process.env.SHOT_THEME === 'dark' ? 'dark' : 'light' });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  // a clean start each time: no settings left from an earlier run
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('shots')) { localStorage.clear(); sessionStorage.setItem('shots', '1'); } } catch { /* none */ } });
  await page.goto(url);
  await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });
  // the navigator map (on by default) only where a picture is about getting round a drawing
  if (!navigator) await page.evaluate(() => window.__app.command('navigator'));
  return { browser, page, problems };
}

/** A drawn mouse pointer that follows the mouse (pointer-events: none, so it never gets in the way). */
export async function pointer(page, on = true) {
  await page.evaluate((on) => {
    let p = document.getElementById('shot-pointer');
    if (!on) { p?.remove(); return; }
    if (p) return;
    p = document.createElement('div');
    p.id = 'shot-pointer';
    p.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:30px;pointer-events:none;z-index:2147483647;transform:translate(-2px,-1px)';
    p.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 1 L2 23 L7.5 17.8 L11.6 27.2 L15.4 25.5 L11.4 16.4 L19 16.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(p);
    const move = (e) => { p.style.left = e.clientX + 'px'; p.style.top = e.clientY + 'px'; };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('mousemove', move, true);
  }, on);
}

/** Move the mouse smoothly from where it is to (x, y). */
let last = { x: 2, y: 400 };
export async function glide(page, x, y, steps = 18) {
  await page.mouse.move(x, y, { steps });
  last = { x, y };
}

export async function calm(page) {
  await page.evaluate(() => document.querySelector('#flash')?.classList.remove('show'));
}

/** A still picture of the window, or of a part of it (clip in CSS pixels). */
export async function shot(page, name, { clip, mouseAway = true } = {}) {
  if (mouseAway) await page.mouse.move(2, 400);
  await calm(page);
  await page.waitForTimeout(500);
  // SHOT_SUFFIX names a second set (such as -dark-ui) beside the usual pictures
  const file = `${name}${process.env.SHOT_SUFFIX ?? ''}.png`;
  await page.screenshot({ path: `${out}${file}`, ...(clip ? { clip } : {}) });
  console.log(`docs/images/${file}`);
}

/** Screen position (CSS pixels) of a drawing point in the active canvas. */
export async function screenOf(page, p) {
  return page.evaluate((p) => {
    const a = window.__app; const s = a.renderer.toScreen(p);
    const r = document.querySelector('#overlay').getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }, p);
}

/**
 * Record an animation: frames are captured with the DevTools screencast while `act` runs, then
 * put together into a GIF (cropped to `clip`, CSS pixels, scaled to `width`).
 */
export async function record(page, name, act, { clip, width = 900, fps = 12, hold = 1500 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gif-'));
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* closed */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.waitForTimeout(300);
  await act();
  await page.waitForTimeout(hold);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  if (!frames.length) throw new Error('no frames');
  // write the frames with how long each stays on screen
  let list = '';
  frames.forEach((f, i) => {
    const file = join(dir, `f${String(i).padStart(5, '0')}.png`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    const next = frames[i + 1]?.t ?? f.t + hold / 1000;
    list += `file '${file}'\nduration ${Math.max(0.02, next - f.t).toFixed(3)}\n`;
  });
  list += `file '${join(dir, `f${String(frames.length - 1).padStart(5, '0')}.png`)}'\n`;
  writeFileSync(join(dir, 'list.txt'), list);
  const dpr = await page.evaluate(() => devicePixelRatio);
  const vw = await page.evaluate(() => innerWidth);
  // screencast frames come at the window size in CSS pixels times the device scale, but may be smaller
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', join(dir, 'f00000.png')]).toString().trim();
  const k = Number(probe) / vw;
  const crop = clip ? `crop=${Math.round(clip.width * k)}:${Math.round(clip.height * k)}:${Math.round(clip.x * k)}:${Math.round(clip.y * k)},` : '';
  const vf = `${crop}fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', vf, '-loop', '0', `${out}${name}.gif`]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`docs/images/${name}.gif (${frames.length} frames, device scale ${dpr})`);
}

/**
 * The README's two-step scheme (Suzuki coupling, then a Horner–Wadsworth–Emmons olefination),
 * drawn the way a person would: structures and arrows, the text typed above and below each arrow
 * (the arrows fit it), then Clean Up Reaction and Number Compounds.
 */
export async function drawScheme(page, { select = false, xs = [140, 400, 700], y = 260, fit = true } = {}) {
  await page.evaluate(async ([select, xs, y, fit]) => {
    const a = window.__app, doc = a.doc;
    // roomier spacing than the defaults, set as Scheme > Scheme Settings would
    const sl = await import('/src/chem/scheme-layout.ts');
    sl.setSchemePrefs({ structGap: 17, lead: 8, headGap: 13 });
    const smiles = ['O=Cc1ccc(Br)cc1', 'O=Cc1ccc(-c2ccccc2)cc1', 'CCOC(=O)/C=C/c1ccc(-c2ccccc2)cc1'];
    const mols = await Promise.all(smiles.map((s) => a.chem.smilesToMol(s)));
    let last = [];
    const ids = [];
    doc.edit('Scheme', () => {
      mols.forEach((m, i) => { last = a.addMolfile(doc, m, xs[i], y); });
      for (const i of [0, 1]) {
        const x1 = xs[i] + (xs[i + 1] - xs[i]) * 0.25, x2 = xs[i] + (xs[i + 1] - xs[i]) * 0.6;
        ids.push(doc.addArrow({ tail: { x: x1, y }, head: { x: x2, y }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 3 }).id);
      }
    });
    a.command('clean-up-reaction');
    const e = a.editor;
    e.setArrowSideText(ids[0], 'above', 'PhB(OH)2, Pd(PPh3)4');
    e.setArrowSideText(ids[0], 'below', 'K2CO3, dioxane/H2O\n90 °C, 92%');
    e.setArrowSideText(ids[1], 'above', '(EtO)2P(O)CH2CO2Et');
    e.setArrowSideText(ids[1], 'below', 'NaH, THF, 0 °C\n88%, E/Z > 20:1');
    a.command('clean-up-reaction');
    e.numberCompounds({ start: 1, style: 'numbers', prefix: '', suffix: '', bold: true });
    e.clearSelection();
    if (fit) e.fit();
    if (select) e.selectThese({ atoms: new Set(last), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });
  }, [select, xs, y, fit]);
}

/** Select these atoms (and the bonds between them), captions, arrows and shapes. */
export async function select(page, { atoms = [], captions = [], arrows = [], shapes = [] } = {}) {
  await page.evaluate(([atoms, captions, arrows, shapes]) => {
    const a = window.__app, doc = a.doc, set = new Set(atoms);
    const bonds = new Set([...doc.bonds.values()].filter((b) => set.has(b.a1) && set.has(b.a2)).map((b) => b.id));
    a.editor.selectThese({ atoms: set, bonds, captions: new Set(captions), arrows: new Set(arrows), shapes: new Set(shapes) });
  }, [atoms, captions, arrows, shapes]);
}

/** Show the drawing at `scale` screen pixels per point, centred on drawing point (cx, cy). */
export async function look(page, scale, cx, cy) {
  await page.evaluate(([scale, cx, cy]) => {
    const a = window.__app, r = a.renderer;
    r.view.scale = scale;
    r.view.ox = r.width / 2 - cx * scale;
    r.view.oy = r.height / 2 - cy * scale;
    a.editor.requestScene();
  }, [scale, cx, cy]);
  await page.waitForTimeout(100);
}

/** The canvas area on screen (CSS pixels). */
export async function canvasBox(page) {
  return page.evaluate(() => { const r = document.querySelector('#overlay').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
}

/** Add a structure from SMILES centred at (x, y); returns its atom ids. */
export async function addSmiles(page, smiles, x, y) {
  return page.evaluate(async ([smiles, x, y]) => {
    const a = window.__app; const m = await a.chem.smilesToMol(smiles);
    let ids = [];
    a.doc.edit('Add', () => { ids = a.addMolfile(a.doc, m, x, y); });
    a.editor.changed?.();
    return ids;
  }, [smiles, x, y]);
}

/** Type keys one at a time, as a person would. */
export async function keys(page, list, gap = 350) {
  for (const k of list) { await page.keyboard.press(k); await page.waitForTimeout(gap); }
}

/** The newest atom's screen position. */
export async function newestAtom(page) {
  return page.evaluate(() => {
    const a = window.__app; const t = [...a.doc.atoms.values()].at(-1);
    const s = a.renderer.toScreen(t); const r = document.querySelector('#overlay').getBoundingClientRect();
    return { id: t.id, x: s.x + r.left, y: s.y + r.top };
  });
}

/** Screen position of an atom by id. */
export async function atomAt(page, id) {
  return page.evaluate((id) => {
    const a = window.__app; const t = a.doc.atoms.get(id);
    const s = a.renderer.toScreen(t); const r = document.querySelector('#overlay').getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }, id);
}

/** Drag with the mouse, smoothly. */
export async function drag(page, from, to, steps = 30) {
  await page.mouse.move(from.x, from.y, { steps: 12 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Screen centre of the "+" box above or below an arrow. */
export async function helperSpot(page, arrowId, side) {
  return page.evaluate(async ([id, side]) => {
    const a = window.__app; const at = await import('/src/chem/arrow-text.ts');
    const b = at.helperBox(a.doc, a.doc.arrows.get(id), side);
    const s = a.renderer.toScreen({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }); const r = document.querySelector('#overlay').getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }, [arrowId, side]);
}

/** Click a toolbar tool by name. */
export async function tool(page, name, glideThere = true) {
  const b = await page.locator(`[data-tool="${name}"]`).first().boundingBox();
  // up and left of the middle: a tool with more like it has a "more" corner button over its lower right
  const p = { x: b.x + b.width * 0.35, y: b.y + b.height * 0.35 };
  if (glideThere) await glide(page, p.x, p.y, 20);
  await page.mouse.click(p.x, p.y);
}

/** Screen spot of a word in a caption (one run of plain Arial text): line number, and the text before it on that line. */
export async function wordSpot(page, captionId, line, before, word) {
  return page.evaluate(async ([id, line, before, word]) => {
    const a = window.__app; const tm = await import('/src/text-metrics.ts');
    const c = a.doc.captions.get(id); const b = a.renderer.captionBox(c);
    const lines = c.runs.map((r) => r.text).join('').split('\n').length;
    const size = c.runs[0].size ?? a.doc.style.captionSize;
    const x = b.x1 + tm.arialWidth(before, size) + tm.arialWidth(word, size) / 2;
    const y = b.y1 + (b.y2 - b.y1) * (line + 0.5) / lines;
    const s = a.renderer.toScreen({ x, y }); const r = document.querySelector('#overlay').getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }, [captionId, line, before, word]);
}

/**
 * On a slide: make what was drawn (everything but the placeholders) fit `width` of the slide,
 * smaller if need be, centred at (cx, cy) of it.
 */
export async function fitOnSlide(page, { width = 0.88, cx = 0.5, cy = 0.66 } = {}) {
  await page.evaluate(([width, cx, cy]) => {
    const a = window.__app, doc = a.doc, e = a.editor, size = a.ws.active.deck.size;
    const all = () => e.selectThese({ atoms: new Set(doc.atoms.keys()), bonds: new Set(doc.bonds.keys()), captions: new Set([...doc.captions.values()].filter((c) => !c.ph).map((c) => c.id)), arrows: new Set(doc.arrows.keys()), shapes: new Set() });
    all();
    let b = e.selBox();
    const f = Math.min(1, (size.w * width) / (b.x2 - b.x1));
    if (f < 1) {
      // everything smaller together, the text too, so it keeps its place on the arrows
      e.scaleSelection(f);
      const cs = doc.style.captionSize;
      doc.edit('Text size', () => { for (const c of doc.captions.values()) if (!c.ph) doc.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, size: Math.round((r.size ?? cs) * f * 10) / 10 })) }); });
      e.clearSelection(); all(); b = e.selBox();
    }
    e.nudge(size.w * cx - (b.x1 + b.x2) / 2, size.h * cy - (b.y1 + b.y2) / 2);
    e.clearSelection();
    a.command('zoom-fit');
  }, [width, cx, cy]);
  await page.waitForTimeout(300);
}

/** A clip (CSS pixels) round everything drawn, with a margin. */
export async function contentClip(page, margin = 30) {
  return page.evaluate((margin) => {
    const a = window.__app, b = a.doc.bounds(); const r = document.querySelector('#overlay').getBoundingClientRect();
    const p = a.renderer.toScreen({ x: b.x1, y: b.y1 }), q = a.renderer.toScreen({ x: b.x2, y: b.y2 });
    return { x: r.left + p.x - margin, y: r.top + p.y - margin, width: q.x - p.x + 2 * margin, height: q.y - p.y + 2 * margin };
  }, margin);
}

/** Pick a tool from a palette: open it with its small arrow (the palette's button shows `first` until another is picked), then click the one named `label`. */
export async function paletteTool(page, first, label) {
  const m = await page.locator(`.palette-wrap:has([data-tool="${first}"]) .more`).boundingBox();
  await glide(page, m.x + m.width / 2, m.y + m.height / 2, 20);
  await page.mouse.click(m.x + m.width / 2, m.y + m.height / 2);
  await page.waitForTimeout(450);
  const b = await page.locator(`.flyout button[aria-label="${label}"]`).boundingBox();
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, 15);
  await page.waitForTimeout(350);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Pick the n-th tool (from 0) in a palette's flyout, for palettes whose items share one long title style. */
export async function paletteItem(page, first, n) {
  const m = await page.locator(`.palette-wrap:has([data-tool="${first}"]) .more`).boundingBox();
  await glide(page, m.x + m.width / 2, m.y + m.height / 2, 20);
  await page.mouse.click(m.x + m.width / 2, m.y + m.height / 2);
  await page.waitForTimeout(450);
  const b = await page.locator('.flyout button').nth(n).boundingBox();
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, 15);
  await page.waitForTimeout(350);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/**
 * A caption at the foot of the window saying which keys and mouse buttons are held and what they do,
 * since a screen recording shows neither. `keys` are keycaps, `button` lights part of a mouse drawing
 * ('left', 'middle', 'right', 'wheel'), and `text` says what happens. Null takes it away.
 */
export async function inputBadge(page, spec) {
  await page.evaluate((spec) => {
    document.getElementById('shot-badge')?.remove();
    if (!spec) return;
    const b = document.createElement('div');
    b.id = 'shot-badge';
    b.style.cssText = 'position:fixed;left:0;right:0;margin:0 auto;width:max-content;bottom:46px;display:flex;align-items:center;gap:12px;padding:10px 18px;border-radius:14px;background:rgba(24,26,32,0.88);color:#fff;font:600 19px/1.2 system-ui,sans-serif;white-space:nowrap;z-index:2147483646;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.25)';
    const cap = (k) => `<span style="display:inline-block;min-width:22px;padding:4px 9px;border-radius:7px;background:#fff;color:#111;border-bottom:3px solid #9aa0aa;font:700 16px/1 system-ui,sans-serif;text-align:center">${k}</span>`;
    const lit = (part) => (spec.button === part ? '#4f9dff' : 'none');
    const mouse = spec.button ? `<svg width="30" height="42" viewBox="0 0 30 42"><rect x="2" y="2" width="26" height="38" rx="13" fill="#fff" stroke="#fff" stroke-width="2"/><path d="M15 2 V16" stroke="#555" stroke-width="1.5"/><path d="M2 16 H28" stroke="#555" stroke-width="1.5"/><path d="M15 2 A13 13 0 0 0 2 15 V16 H15 Z" fill="${lit('left')}"/><path d="M15 2 A13 13 0 0 1 28 15 V16 H15 Z" fill="${lit('right')}"/><rect x="12" y="6" width="6" height="9" rx="3" fill="${spec.button === 'middle' || spec.button === 'wheel' ? '#4f9dff' : '#888'}"/></svg>` : '';
    const what = spec.label ?? { left: 'drag', right: 'Right-drag', middle: 'Middle-drag', wheel: 'Wheel' }[spec.button] ?? '';
    const parts = [...(spec.keys ?? []).map(cap), ...(spec.button ? [`<span style="display:flex;align-items:center;gap:8px">${mouse}<span>${what}</span></span>`] : [])];
    b.innerHTML = parts.join('<span style="opacity:.7">+</span>') + `<span style="opacity:.6;margin:0 2px">→</span><span style="font-weight:500">${spec.text}</span>`;
    // in a full-screen slide show only the full-screen element is drawn
    (document.fullscreenElement ?? document.body).appendChild(b);
  }, spec);
}
