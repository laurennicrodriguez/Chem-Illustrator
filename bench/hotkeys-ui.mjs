// Checks the editable key map in a real browser: menus show the keys, the Hotkeys window
// changes a key and remembers it after a reload, and the new ChemDraw keys work.
// Run with the preview server going: node bench/hotkeys-ui.mjs [output folder]
import { launch } from './browser.mjs';
import fs from 'fs';
const out = process.argv[2] || 'test-results';
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'log') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
const url = process.env.APP_URL || 'http://localhost:4173/';
await page.goto(url);
await page.evaluate(() => localStorage.removeItem('chem-illustrator.settings'));
await page.reload();
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };

const setup = async () => {
  await page.evaluate(() => { const A = window.__app; A.doc.loadFrom(new A.Doc()); A.editor.clearSelection(); const r = window.__app.renderer; r.view.scale = 4; r.view.ox = 100; r.view.oy = 100; window.__app.editor.requestScene(); });
};
await setup();
const box = await page.locator('#overlay').boundingBox();
const atomScreen = async (id) => { const s = await page.evaluate((id) => window.__app.renderer.toScreen(window.__app.doc.atoms.get(id)), id); return { x: box.x + s.x, y: box.y + s.y }; };
const counts = () => page.evaluate(() => ({ atoms: window.__app.doc.atoms.size, bonds: window.__app.doc.bonds.size, arrows: window.__app.doc.arrows.size }));

// menus show the keys from the key map
await page.click('#btn-file');
check('File menu shows Ctrl+N', (await page.locator('[data-cmd="new"] kbd').textContent()) === 'Ctrl+N');
await page.keyboard.press('Escape');
await page.click('#btn-structure');
check('Fixed Bond Lengths is ticked', (await page.locator('[data-cmd="fixed-length"]').getAttribute('aria-checked')) === 'true');
await page.keyboard.press('Escape');

// one bond to work on
await page.click('[data-tool="bond-single"]');
await page.mouse.click(box.x + 300, box.y + 300);
let ids = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
check('click draws a bond', ids.length === 2);

// k on an end atom makes a sulfonyl
let p = await atomScreen(ids[1]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('k');
let st = await page.evaluate((id) => ({ z: window.__app.doc.atoms.get(id).z, n: window.__app.doc.atoms.size }), ids[1]);
check('k makes SO2 with a methyl', st.z === 16 && st.n === 5, JSON.stringify(st));

// ' shows the atom number; . makes an attachment point
p = await atomScreen(ids[0]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press("'");
st = await page.evaluate((id) => { const a = window.__app.doc.atoms.get(id); return { show: a.showNumber, n: a.atomNumber }; }, ids[0]);
check("' shows atom number 1", st.show === true && st.n === '1', JSON.stringify(st));

// = opens the nickname list; typing narrows it and Enter uses the first
await page.keyboard.press('=');
await page.waitForSelector('dialog.nicknames[open]');
await page.keyboard.type('Bo');
await page.keyboard.press('Enter');
st = await page.evaluate((id) => window.__app.doc.atoms.get(id).label, ids[0]);
check('= then Bo, Enter labels the atom Boc', st === 'Boc', String(st));

// how a shown atom number and a numbered point of attachment look
await setup();
await page.click('[data-tool="bond-single"]');
await page.mouse.click(box.x + 300, box.y + 300);
ids = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
p = await atomScreen(ids[1]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('1');
await page.keyboard.press("'");
const mid = await page.evaluate(() => [...window.__app.doc.atoms.values()].find((a) => a.showNumber)?.id);
check("' after 1 numbers the new atom", mid !== undefined);
p = await atomScreen(ids[0]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('.');
st = await page.evaluate((id) => { const a = window.__app.doc.atoms.get(id); return { attach: a.attach, n: a.attachNum }; }, ids[0]);
check('. makes attachment point 1', st.attach === 'Unspecified' && st.n === 1, JSON.stringify(st));
await page.mouse.move(box.x + 900, box.y + 700);
await page.waitForTimeout(100);
await page.screenshot({ path: `${out}/number-and-attachment.png`, clip: { x: box.x + 200, y: box.y + 200, width: 300, height: 200 } });
// / selects the atom and shows it in the Style panel, where the number can be changed
p = await atomScreen(mid);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('/');
await page.waitForTimeout(150);
check('/ shows the atom in the Style panel', (await page.locator('#style-section h3').first().textContent()) === 'Atom');
await page.locator('#style-body .style-row', { hasText: /^Atom number/ }).locator('input').fill('2a');
await page.keyboard.press('Enter');
check('the number can be typed', (await page.evaluate((id) => window.__app.doc.atoms.get(id).atomNumber, mid)) === '2a');
await page.screenshot({ path: `${out}/atom-panel.png` });

// the Hotkeys window: give "Grow a bond" the key q
await page.click('#btn-edit');
await page.click('[data-cmd="hotkeys"]');
await page.waitForSelector('dialog.hotkeys[open]');
await page.screenshot({ path: `${out}/hotkeys-window.png` });
await page.fill('dialog.hotkeys input[type=search]', 'grow a bond');
const row = page.locator('section[data-ctx="atom"] tr[data-action="atom bond"]');
await row.locator('button.hk-add').click();
await page.keyboard.press('q');
const status = await page.locator('.hk-status').textContent();
check('q now grows a bond', /q now does/.test(status) && /Label O/.test(status), status);
check('the row shows q', (await row.locator('kbd').allTextContents()).includes('q'));
await page.screenshot({ path: `${out}/hotkeys-changed.png` });
await page.click('dialog.hotkeys [data-act=close]');

// the new key works over an atom
await setup();
await page.mouse.click(box.x + 300, box.y + 300);
ids = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
p = await atomScreen(ids[1]);
await page.mouse.move(p.x, p.y);
await page.keyboard.press('q');
check('q over an atom grows a bond', (await counts()).atoms === 3);

// saved, and still there after a reload
await page.waitForTimeout(500);
const saved = await page.evaluate(() => localStorage.getItem('chem-illustrator.settings'));
check('settings saved', !!saved && saved.includes('"q": "atom bond"'), saved ?? 'nothing');
await page.reload();
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
await page.waitForTimeout(200);
check('q still grows a bond after a reload', (await page.evaluate(() => window.__app.keymap.lookup('atom', 'q'))) === 'atom bond');

// Ctrl+arrow: reaction arrow plus a copy
await setup();
await page.click('[data-tool="ring-benzene"]');
await page.mouse.click(box.x + 300, box.y + 300);
await page.evaluate(() => window.__app.editor.selectAll());
await page.mouse.move(box.x + 900, box.y + 700);
await page.keyboard.press('Control+ArrowRight');
let c = await counts();
check('Ctrl+→ adds an arrow and a copy', c.arrows === 1 && c.atoms === 12, JSON.stringify(c));
const arrowLen = await page.evaluate(() => { const a = [...window.__app.doc.arrows.values()][0]; return Math.hypot(a.head.x - a.tail.x, a.head.y - a.tail.y); });
check('the arrow is 90 pt long', Math.abs(arrowLen - 90) < 0.01, arrowLen.toFixed(2));

// Ctrl+J joins two atoms of different structures
await setup();
await page.click('[data-tool="bond-single"]');
await page.mouse.click(box.x + 300, box.y + 300);
await page.mouse.click(box.x + 600, box.y + 300);
ids = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
await page.evaluate((ids) => { const e = window.__app.editor; e.sel = { atoms: new Set([ids[1], ids[2]]), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }; e.requestOverlay(); }, ids);
await page.mouse.move(box.x + 900, box.y + 700);
await page.keyboard.press('Control+j');
c = await counts();
check('Ctrl+J joins two atoms into one', c.atoms === 3 && c.bonds === 2, JSON.stringify(c));

// Ctrl+L turns fixed bond lengths off, and the menu shows it
await page.keyboard.press('Control+l');
check('Ctrl+L turns fixed lengths off', (await page.evaluate(() => window.__app.editor.options.fixedLength)) === false);
await page.click('#btn-structure');
check('the menu tick follows', (await page.locator('[data-cmd="fixed-length"]').getAttribute('aria-checked')) === 'false');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+l');

// zoom keys
const s0 = await page.evaluate(() => window.__app.renderer.view.scale);
await page.keyboard.press('F7');
const s1 = await page.evaluate(() => window.__app.renderer.view.scale);
check('F7 zooms in', s1 > s0, `${s0} -> ${s1}`);
await page.keyboard.press('F5');
const s2 = await page.evaluate(() => window.__app.renderer.view.scale);
check('F5 is actual size', Math.abs(s2 - 96 / 72) < 1e-6, String(s2));

// Help lists keys from the key map
await page.click('#btn-help');
await page.waitForSelector('#help[open]');
const helpAtom = await page.locator('#help-atom').textContent();
check('Help shows q for growing a bond', /q.*Grow a bond/.test(helpAtom), helpAtom.slice(0, 80));
await page.screenshot({ path: `${out}/help-window.png` });
await page.click('#help-close');

// back to ChemDraw's keys
await page.click('#btn-edit');
await page.click('[data-cmd="hotkeys"]');
await page.click('dialog.hotkeys [data-act=reset-all]');
await page.click('dialog.hotkeys [data-act=reset-all]');
check('Reset all puts 1 back', (await page.evaluate(() => window.__app.keymap.lookup('atom', 'q'))) === 'label O');
await page.click('dialog.hotkeys [data-act=close]');

console.log(logs.length ? 'Console:\n' + logs.join('\n') : 'No console errors.');
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length || logs.some((l) => l.startsWith('PAGEERROR')) ? 1 : 0);
