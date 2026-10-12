import { launch } from './browser.mjs';
import fs from 'fs';
// usage: crop.mjs file outdir name fx fy scale  (fx, fy = fraction of the drawing's bounds to centre on)
const [file, out, ...specs] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
await page.goto(process.env.APP_URL || 'http://localhost:4173/');
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
const text = fs.readFileSync(file, 'utf8');
await page.evaluate(([t]) => window.__app.openText(t, 'x'), [text]);
for (let i = 0; i < specs.length; i += 4) {
  const [name, fx, fy, sc] = specs.slice(i, i + 4);
  await page.evaluate(([fx, fy, sc]) => {
    const { doc, renderer: r, editor } = window.__app;
    const b = doc.bounds();
    const x = b.x1 + (b.x2 - b.x1) * fx, y = b.y1 + (b.y2 - b.y1) * fy;
    r.view.scale = sc; r.view.ox = r.width / 2 - x * sc; r.view.oy = r.height / 2 - y * sc;
    editor.requestScene(); editor.frame();
  }, [Number(fx), Number(fy), Number(sc)]);
  await page.waitForTimeout(50);
  await page.locator('#canvas-host').screenshot({ path: `${out}/${name}.png` });
}
await browser.close();
