// Takes the screenshots in docs/images/ for the README and the user guide.
// Start the program first (npm run dev), then: node scripts/screenshots.mjs [address]
// Needs Playwright with Chromium (npm install --no-save playwright; npx playwright install chromium),
// or set CHROMIUM to a Chromium program to use instead.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = new URL('../docs/images/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });

const shot = async (name) => {
  await page.mouse.move(2, 400);
  // no passing messages in the pictures
  await page.evaluate(() => document.querySelector('#flash')?.classList.remove('show'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`docs/images/${name}.png`);
};

// a two-step scheme: Suzuki coupling, then a Horner–Wadsworth–Emmons olefination
await page.evaluate(async () => {
  const a = window.__app, doc = a.doc;
  const smiles = ['O=Cc1ccc(Br)cc1', 'O=Cc1ccc(-c2ccccc2)cc1', 'CCOC(=O)/C=C/c1ccc(-c2ccccc2)cc1'];
  const mols = await Promise.all(smiles.map((s) => a.chem.smilesToMol(s)));
  const xs = [140, 400, 700];
  let last = [];
  doc.edit('Scheme', () => {
    mols.forEach((m, i) => { last = a.addMolfile(doc, m, xs[i], 260); });
    for (const [x1, x2] of [[200, 300], [480, 570]]) {
      doc.addArrow({ tail: { x: x1, y: 260 }, head: { x: x2, y: 260 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 3 });
    }
    const cap = (x, y, text) => doc.addCaption({ x, y, runs: [{ text, formula: !/°C/.test(text) }], justify: 'center' });
    cap(250, 240, 'PhB(OH)2, Pd(PPh3)4'); cap(250, 280, 'K2CO3, dioxane/H2O'); cap(250, 292, '90 °C, 92%');
    cap(525, 240, '(EtO)2P(O)CH2CO2Et'); cap(525, 280, 'NaH, THF, 0 °C'); cap(525, 292, '88%, E/Z > 20:1');
  });
  a.command('clean-up-reaction');
  a.editor.numberCompounds({ start: 1, style: 'numbers', prefix: '', suffix: '', bold: true });
  a.editor.fit();
  // the product selected, so the Analysis panel shows its formula and masses
  a.editor.selectThese({ atoms: new Set(last), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });
});
await shot('drawing');

// the same page dark (screen only)
await page.evaluate(() => window.__app.command('dark-page'));
await shot('dark-page');
await page.evaluate(() => window.__app.command('dark-page'));

// Slides: a title slide and a slide with the scheme, in one of the design templates
await page.evaluate(async () => {
  const a = window.__app; a.ws.newSlides();
  const t = await import('/src/deck/templates.ts');
  const d = a.ws.active.deck; d.setMaster(t.applyTemplate(d.master, t.SLIDE_TEMPLATES.find((x) => x.id === 'harbor')));
});
await page.waitForTimeout(600);
const phs = async () => page.evaluate(() => { const a = window.__app; return [...a.doc.captions.values()].filter(c => c.ph).map(c => { const b = a.renderer.captionBox(c); const s = a.renderer.toScreen({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }); const r = document.querySelector('#overlay').getBoundingClientRect(); return [s.x + r.left, s.y + r.top]; }); });
let p = await phs();
await page.mouse.click(...p[0]); await page.keyboard.type('Asymmetric Hydrogenation of Profens'); await page.keyboard.press('Escape');
await page.mouse.click(...p[1]); await page.keyboard.type('Group meeting, 16 October'); await page.keyboard.press('Escape');
await page.evaluate(() => window.__app.command('new-slide')); await page.waitForTimeout(600);
p = await phs();
await page.mouse.click(...p[0]); await page.keyboard.type('Route to the enoate'); await page.keyboard.press('Escape');
await page.mouse.click(...p[1]); await page.keyboard.type('Suzuki coupling, then Horner-Wadsworth-Emmons olefination'); await page.keyboard.press('Enter'); await page.keyboard.type('Both steps run on a 10 g scale'); await page.keyboard.press('Escape');
await page.evaluate(async () => {
  const a = window.__app, doc = a.doc;
  const body = [...doc.captions.values()].find((c) => c.ph === 'body'); const bb = a.renderer.captionBox(body);
  const smiles = ['O=Cc1ccc(Br)cc1', 'O=Cc1ccc(-c2ccccc2)cc1', 'CCOC(=O)/C=C/c1ccc(-c2ccccc2)cc1'];
  const mols = await Promise.all(smiles.map((s) => a.chem.smilesToMol(s)));
  const y = 330, L = 120;
  const xs = [160, 430, 750];
  doc.edit('Scheme', () => {
    mols.forEach((m, i) => a.addMolfile(doc, m, xs[i], y));
    for (const [x1, x2] of [[230, 320], [525, 615]]) doc.addArrow({ tail: { x: x1, y }, head: { x: x2, y }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 14, headWidth: 4.5 });
  });
  a.editor.clearSelection();
});
await shot('slides');

// Sheet: a table of products with structures, worked-out formula and MW, and a chart
await page.evaluate(() => window.__app.ws.newSheet());
await page.waitForTimeout(800);
const rows = [['Entry', 'Product', 'Yield (%)', 'ee (%)'], ['1', 'CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O', '78', '92'], ['2', 'COc1ccc2cc(ccc2c1)[C@H](C)C(=O)O', '85', '96'], ['3', 'C[C@H](C(=O)O)c1ccc(c(F)c1)-c1ccccc1', '64', '88'], ['4', 'C[C@H](C(=O)O)c1cccc(c1)C(=O)c1ccccc1', '71', '90']];
await page.evaluate(async (rows) => {
  const sm = window.__app.sheetMode, v = sm.view;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    v.select({ r1: r, c1: c, r2: r, c2: c });
    if (r > 0 && c === 1) await sm.structureFromText(rows[r][c]);
  }
}, rows);
// type values
for (let r = 0; r < rows.length; r++) {
  await page.evaluate(([r]) => window.__app.sheetMode.view.select({ r1: r, c1: 0, r2: r, c2: 0 }), [r]);
  for (let c = 0; c < rows[r].length; c++) {
    if (r > 0 && c === 1) { await page.keyboard.press('Tab'); continue; }
    await page.keyboard.type(rows[r][c]); await page.keyboard.press('Tab');
  }
}
await page.waitForTimeout(500);
await page.evaluate(async () => { const sm = window.__app.sheetMode; sm.view.select({ r1: 1, c1: 1, r2: 1, c2: 1 }); await sm.propertyColumns({ col: 1, props: [{ name: 'FORMULA' }, { name: 'MW' }] }); });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const sm = window.__app.sheetMode, v = sm.view;
  sm.edit('Sizes', (sh) => { sh.setColWidth(1, 150); sh.setColWidth(4, 110); for (let r = 1; r <= 4; r++) sh.setRowHeight(r, 92); });
  v.select({ r1: 0, c1: 0, r2: 4, c2: 5 });
  sm.run('insert-table');
});
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const sm = window.__app.sheetMode;
  sm.view.select({ r1: 0, c1: 2, r2: 4, c2: 3 });
  sm.run('chart-column');
  sm.edit('Chart', (sh) => sh.setCharts(sh.charts.map((c) => ({ ...c, title: 'Yield and ee by entry', palette: 'safe', at: { row: 0, col: 6, dx: 16, dy: 4 }, w: 420, h: 300 }))));
  sm.view.select({ r1: 2, c1: 1, r2: 2, c2: 1 });
});
await page.waitForTimeout(1500);
await page.mouse.click(300, 760);
await page.waitForTimeout(4000);
await shot('sheet');

// Document: an experimental paragraph with a structure in the text
await page.evaluate(() => window.__app.ws.newDocument()); await page.waitForTimeout(800);
await page.mouse.click(700, 330); await page.waitForTimeout(200);
await page.keyboard.press('Control+Alt+1');
await page.keyboard.type('Ethyl (E)-3-([1,1\'-biphenyl]-4-yl)acrylate'); await page.keyboard.press('Enter');
await page.keyboard.type('Sodium hydride (60% in oil, 0.48 g, 12.0 mmol) was suspended in THF (30 mL) at 0 °C, and triethyl phosphonoacetate (2.4 mL, 12.0 mmol) was added dropwise. After 20 min, a solution of 4-phenylbenzaldehyde (1.82 g, 10.0 mmol) in THF (10 mL) was added. The mixture was stirred for 2 h, quenched with saturated aqueous NH4Cl and extracted with EtOAc. Chromatography gave the enoate as a white solid (2.22 g, 88%, E/Z > 20:1).');
await page.keyboard.press('Enter');
await page.keyboard.press('Control+e');
await page.evaluate(async () => { const dm = window.__app.docMode; const r = await dm.host.toStructure('CCOC(=O)/C=C/c1ccc(-c2ccccc2)cc1', dm.file.t.drawingStyle); dm.insertDrawing(r.contents); });
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.keyboard.press('Control+l');
await page.keyboard.type('1H NMR (400 MHz, CDCl3): δ 7.73 (d, J = 16.0 Hz, 1H), 7.64–7.58 (m, 6H), 7.46 (t, J = 7.5 Hz, 2H), 7.38 (t, J = 7.3 Hz, 1H), 6.49 (d, J = 16.0 Hz, 1H), 4.28 (q, J = 7.1 Hz, 2H), 1.35 (t, J = 7.1 Hz, 3H).');
await page.waitForTimeout(600);
await shot('document');

// Split view: the drawing beside the document
await page.evaluate(() => window.__app.command('split-view'));
await page.waitForTimeout(1200);
await page.evaluate(() => window.__app.editor.fit());
await shot('split-view');

// Design: the ready-made workup scheme, with the shape library open
await page.evaluate(() => window.__app.command('new-design'));
await page.waitForTimeout(800);
await page.locator('dialog[open] button', { hasText: 'Workup scheme' }).click();
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__app.editor.clearSelection(); window.__app.editor.fit(); });
await shot('design');

// Help > Send Feedback
await page.evaluate(() => window.__app.command('send-feedback'));
await page.waitForTimeout(300);
await page.keyboard.type('Number compounds in the order the text mentions them');
await page.keyboard.press('Tab');
await page.keyboard.type('In Document mode, it would help if compound numbers followed the order the compounds are first mentioned in the text, as journals ask.');
await shot('feedback');
await page.keyboard.press('Escape');

if (problems.length) console.log('Errors on the page:', problems);
await browser.close();
