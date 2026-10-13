import { launch } from './browser.mjs';
import fs from 'fs';
const [file] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: Number(process.env.DPR || 1) });
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
await page.goto(process.env.APP_URL || 'http://localhost:4173/');
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
const text = file === 'stress' ? null : fs.readFileSync(file, 'utf8');
const res = await page.evaluate(async ([t]) => {
  const { doc, renderer: r, editor, openText, stressTest } = window.__app;
  const t0 = performance.now();
  if (t) openText(t, 'x'); else stressTest(2000);
  const open = performance.now() - t0;
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(2); };
  const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length * 0.95)].toFixed(2); };
  const frames = (n, step) => { const xs = []; r.renderScene(doc); for (let i = 0; i < n; i++) { step(i); r.renderScene(doc); xs.push(r.lastSceneMs); } return xs; };
  const first = (fn) => { fn(); const s0 = performance.now(); r.renderScene(doc); return +(performance.now() - s0).toFixed(1); };
  editor.fit();
  const fitScale = r.view.scale;
  const firstFit = first(() => r.repaintAll());
  const panFit = frames(40, (i) => { r.view.ox += (i % 2 ? 3 : -3); });
  // 100% zoom (1 pt = 1.333 px), centred
  const b = doc.bounds();
  r.view.scale = 96 / 72; r.view.ox = r.width / 2 - ((b.x1 + b.x2) / 2) * r.view.scale; r.view.oy = r.height / 2 - ((b.y1 + b.y2) / 2) * r.view.scale;
  const pan100 = frames(40, (i) => { r.view.ox += (i % 2 ? 3 : -3); });
  r.view.scale = 4;
  r.view.ox = r.width / 2 - ((b.x1 + b.x2) / 2) * r.view.scale; r.view.oy = r.height / 2 - ((b.y1 + b.y2) / 2) * r.view.scale;
  const pan300 = frames(40, (i) => { r.view.ox += (i % 2 ? 3 : -3); });
  // overlay-only (hover): time the overlay paint
  editor.fit();
  r.renderScene(doc);
  const atoms = [...doc.atoms.values()];
  const hov = [];
  for (let i = 0; i < 200; i++) {
    const a = atoms[(i * 37) % atoms.length];
    const s0 = performance.now();
    editor.hover = editor.hitTest(a);
    editor.requestOverlay(); editor.frame();
    hov.push(performance.now() - s0);
  }
  // moving one structure (edit + full redraw) at fit zoom
  const frag = [...doc.fragmentOf(atoms[Math.floor(atoms.length / 2)].id)];
  const mv = [];
  doc.begin('Move');
  for (let i = 0; i < 40; i++) {
    const s0 = performance.now();
    doc.moveAtoms(frag, 0.5, 0.3);
    r.renderScene(doc);
    mv.push(performance.now() - s0);
  }
  doc.commit();
  // hotkey on an atom: add a bond (edit + redraw)
  const hk = [];
  for (let i = 0; i < 30; i++) {
    const a = atoms[(i * 53) % atoms.length];
    const s0 = performance.now();
    editor.atomKey(a.id, 'bond');
    r.renderScene(doc);
    hk.push(performance.now() - s0);
  }
  // undo all
  const s1 = performance.now(); for (let i = 0; i < 31; i++) doc.undo(); r.renderScene(doc); const undoMs = performance.now() - s1;
  return { open: +open.toFixed(0), firstFit, atoms: doc.atoms.size, bonds: doc.bonds.size, captions: doc.captions.size, fitScale: +fitScale.toFixed(3),
    panFit: [med(panFit), p95(panFit)], pan100: [med(pan100), p95(pan100)], pan300: [med(pan300), p95(pan300)],
    hover: [med(hov), p95(hov)], move: [med(mv), p95(mv)], hotkey: [med(hk), p95(hk)], undo31: +undoMs.toFixed(1) };
}, [text]);
console.log(file.split('/').pop(), JSON.stringify(res));
await browser.close();
