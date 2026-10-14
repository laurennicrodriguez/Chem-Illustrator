import { launch } from './browser.mjs';
import fs from 'fs';
const out = process.argv[2] || 'test-results';
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'log') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.goto(process.env.APP_URL || 'http://localhost:4173/');
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__app.file.newDrawing());
const box = await page.locator('#overlay').boundingBox();
const toScreen = (p) => page.evaluate((p) => { const s = window.__app.renderer.toScreen(p); return s; }, p);
const atomScreen = async (id) => { const s = await page.evaluate((id) => { const a = window.__app.doc.atoms.get(id); return window.__app.renderer.toScreen(a); }, id); return { x: box.x + s.x, y: box.y + s.y }; };
const bondScreen = async (id) => { const s = await page.evaluate((id) => { const d = window.__app.doc; const b = d.bonds.get(id); const p = d.atoms.get(b.a1), q = d.atoms.get(b.a2); return window.__app.renderer.toScreen({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }); }, id); return { x: box.x + s.x, y: box.y + s.y }; };
// zoom to 300%
await page.evaluate(() => { const r = window.__app.renderer; r.view.scale = 4; r.view.ox = 100; r.view.oy = 100; window.__app.editor.requestScene(); });
// benzene by click
await page.click('[data-tool="ring-benzene"]');
await page.mouse.click(box.x + 330, box.y + 300);
await page.waitForTimeout(50);
let ids = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
console.log('benzene atoms', ids.length);
// fuse cyclohexane on a bond by hovering bond and pressing 6
const bonds = await page.evaluate(() => [...window.__app.doc.bonds.keys()]);
let p = await bondScreen(bonds[1]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('6');
// hover atom 0 (top) and press 1 1 then o
p = await atomScreen(ids[0]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('1');
await page.keyboard.press('1');
await page.keyboard.press('2');
// another atom: wedge + OMe
p = await atomScreen(ids[4]);
await page.mouse.move(p.x + 1, p.y);
await page.keyboard.press('4');
await page.keyboard.press('Shift+O');
// N in the fused ring
let all = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
const ring2 = all.filter((x) => !ids.includes(x)).slice(0, 4);
p = await atomScreen(ring2[2]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('n');
p = await atomScreen(ring2[1]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('9');
// chain drag
await page.click('[data-tool="chain"]');
await page.mouse.move(box.x + 120, box.y + 640);
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 640, { steps: 5 });
await page.mouse.move(box.x + 420, box.y + 640, { steps: 5 });
await page.mouse.up();
// bond tool: click blank, then drag from atom
await page.click('[data-tool="bond-single"]');
await page.mouse.click(box.x + 700, box.y + 600);
// text tool label: click atom, type CO2Et, enter
all = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
const last = all[all.length - 1];
p = await atomScreen(last);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('Enter');
await page.keyboard.type('CO2Et');
await page.keyboard.press('Enter');
await page.mouse.move(box.x + 900, box.y + 100);
await page.click('#btn-view');
await page.click('[data-cmd="show-stereo"]');
await page.waitForTimeout(300);
await page.screenshot({ path: out + '/interact.png' });
const lat = await page.evaluate(() => window.__app.editor.latencies.slice(-30));
console.log('latencies', lat.map((x) => x.toFixed(1)).join(' '));
console.log(await page.locator('#analysis-body').innerText());
console.log(logs.join('\n'));
await browser.close();
