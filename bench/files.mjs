import { launch } from './browser.mjs';
import fs from 'fs';
import path from 'path';
const dir = process.argv[2], out = process.argv[3];
const only = process.argv[4];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.goto(process.env.APP_URL || 'http://localhost:4173/');
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.cdxml'))) {
  if (only && !f.includes(only)) continue;
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const r = await page.evaluate(([t, n]) => { const s = window.__app.openText(t, n); return { s, ms: window.__lastOpenMs, scene: window.__app.renderer.lastSceneMs }; }, [text, f]);
  console.log(f, (text.length / 1e6).toFixed(1) + 'MB', 'open', r.ms?.toFixed(0), 'ms; scene', r.scene.toFixed(1), 'ms', JSON.stringify(r.s && { a: r.s.atoms, b: r.s.bonds, c: r.s.captions, r: r.s.arrows, sh: r.s.shapes, sk: r.s.skipped, parse: Math.round(r.s.parseMs), build: Math.round(r.s.buildMs) }));
  await page.waitForTimeout(100);
  const safe = f.replace(/[^A-Za-z0-9]+/g, '_');
  await page.locator('#canvas-host').screenshot({ path: `${out}/${safe}_fit.png` });
}
console.log(logs.join('\n'));
await browser.close();
