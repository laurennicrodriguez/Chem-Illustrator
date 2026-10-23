// Speed of the big-drawing paths: launch, save, open, drag. `node bench/big.mjs` with `npm run preview` running.
import { launch } from './browser.mjs';
const N = Number(process.env.N || 2000);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
const g0 = Date.now();
await page.goto(process.env.APP_URL || 'http://localhost:4173/');
const dom = Date.now() - g0;
await page.waitForFunction(() => window.__app, null, { timeout: 30000 });
const appUp = Date.now() - g0;
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 30000 });
const chemReady = Date.now() - g0;
const res = await page.evaluate(async (n) => {
  const { doc, renderer: r, editor, stressTest, ws } = window.__app;
  const raf = () => new Promise((ok) => requestAnimationFrame(() => ok()));
  stressTest(n);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(1); };
  const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length * 0.95)].toFixed(1); };
  // save: the CDXML text (what Save and AutoSave write)
  const sv = [];
  let text = '';
  for (let i = 0; i < 3; i++) { const s0 = performance.now(); text = window.__app.cdxml('big'); sv.push(performance.now() - s0); }
  // open through the real path (File > Open), then the first paint
  const bytes = new TextEncoder().encode(text);
  const op = [], paint = [];
  for (let i = 0; i < 3; i++) {
    const s0 = performance.now();
    await ws.openBytes(bytes, `big${i}.cdxml`);
    const s1 = performance.now();
    await raf(); await raf();
    op.push(s1 - s0); paint.push(performance.now() - s1);
  }
  // drag one structure at fit zoom: edit + full redraw, as the select tool does
  editor.fit(); r.renderScene(doc);
  const atoms = [...doc.atoms.values()];
  const frag = [...doc.fragmentOf(atoms[Math.floor(atoms.length / 2)].id)];
  const mv = [];
  doc.begin('Move');
  for (let i = 0; i < 40; i++) { const s0 = performance.now(); doc.moveAtoms(frag, 0.5, 0.3); r.renderScene(doc); mv.push(performance.now() - s0); }
  doc.commit();
  // whole selection drag (many atoms)
  const many = atoms.slice(0, 2000).map((a) => a.id);
  const mv2 = [];
  doc.begin('Move');
  for (let i = 0; i < 20; i++) { const s0 = performance.now(); doc.moveAtoms(many, 0.5, 0.3); r.renderScene(doc); mv2.push(performance.now() - s0); }
  doc.commit();
  return { atoms: doc.atoms.size, mb: +(bytes.length / 1e6).toFixed(2), saveMs: sv.map((x) => +x.toFixed(0)), openMs: op.map((x) => +x.toFixed(0)), paintMs: paint.map((x) => +x.toFixed(0)),
    drag1: [med(mv), p95(mv)], drag2000: [med(mv2), p95(mv2)] };
}, N);
console.log(JSON.stringify({ dom, appUp, chemReady, ...res }));
await browser.close();
