// Records the short animations (GIFs) in docs/images/ for the README.
// Start the program first (npm run dev), then: node scripts/animations.mjs [address] [name …]
// Needs Playwright with Chromium (as scripts/screenshots.mjs does) and ffmpeg. Give names
// (smart-arrows, frames, catalytic-cycle, id-labels, spelling, name-to-structure, dark-mode) to
// record only those.

import { open, pointer, glide, look, addSmiles, record, canvasBox, screenOf, helperSpot, tool, drag, keys, newestAtom, atomAt, wordSpot, select } from './shot-lib.mjs';

const args = process.argv.slice(2);
const url = args[0]?.startsWith('http') ? args.shift() : 'http://localhost:5173/';
const want = (name) => !args.length || args.includes(name);

/** Click a menu command: the menu's button, then the command in it, with the mouse going there. */
async function menu(page, button, cmd) {
  const b = await page.locator(`#btn-${button}`).boundingBox();
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, 20);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(350);
  const i = await page.locator(`#${button}-menu [data-cmd="${cmd}"]`).boundingBox();
  await glide(page, i.x + 40, i.y + i.height / 2, 12);
  await page.waitForTimeout(250);
  await page.mouse.click(i.x + 40, i.y + i.height / 2);
}

/** Click a button in the open window. */
async function press(page, text) {
  const b = await page.locator('dialog[open] button', { hasText: text }).first().boundingBox();
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, 15);
  await page.waitForTimeout(200);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Roomier scheme spacing than the defaults, as Scheme > Scheme Settings would set it. */
const roomy = (page, p = { structGap: 17, lead: 8, headGap: 13 }) => page.evaluate(async (p) => { (await import('/src/chem/scheme-layout.ts')).setSchemePrefs(p); }, p);

// ---------------------------------------------------------------- reagents typed onto an arrow
if (want('smart-arrows')) {
  const { browser, page } = await open(url);
  await roomy(page);
  await addSmiles(page, 'O=Cc1ccc(Br)cc1', 150, 250);
  await addSmiles(page, 'O=Cc1ccc(-c2ccccc2)cc1', 300, 250);
  await page.evaluate(() => window.__app.command('fold-side'));
  await page.waitForTimeout(300);
  await look(page, 3.6, 265, 250);
  await pointer(page);
  const c = await canvasBox(page);
  await page.mouse.move(c.x + c.width * 0.55, c.y + c.height * 0.85);
  const clip = { x: c.x + c.width / 2 - 580, y: c.y + c.height / 2 - 220, width: 1160, height: 440 };
  await record(page, 'smart-arrows', async () => {
    await tool(page, 'arrow');
    await page.waitForTimeout(300);
    const t = await screenOf(page, { x: 182, y: 250 }), h = await screenOf(page, { x: 248, y: 250 });
    await glide(page, t.x, t.y, 25);
    await drag(page, t, h, 25);
    await page.waitForTimeout(500);
    const id = await page.evaluate(() => [...window.__app.doc.arrows.keys()].at(-1));
    // the "+" box above the new arrow: click it and type
    let s = await helperSpot(page, id, 'above');
    await glide(page, s.x, s.y, 15); await page.waitForTimeout(250);
    await page.mouse.click(s.x, s.y); await page.waitForTimeout(250);
    await page.keyboard.type('PhB(OH)2, Pd(PPh3)4', { delay: 70 });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    // and below it: the box shows again when the mouse comes near
    s = await helperSpot(page, id, 'below');
    await glide(page, s.x, s.y, 20); await page.waitForTimeout(600);
    await page.mouse.click(s.x, s.y); await page.waitForTimeout(250);
    await page.keyboard.type('K2CO3, dioxane/H2O, 90 °C', { delay: 70 });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await glide(page, c.x + c.width * 0.55, c.y + c.height * 0.85, 20);
  }, { clip, width: 960, hold: 2500 });
  await browser.close();
}

// ---------------------------------------------------------------- a frame that follows its structure
if (want('frames')) {
  const { browser, page } = await open(url);
  const ids = await addSmiles(page, 'OC(=O)c1ccccc1', 300, 250);
  await select(page, { atoms: ids });
  await page.evaluate(() => { window.__app.command('add-frame'); window.__app.editor.clearSelection(); });
  await look(page, 5.5, 305, 262);
  await pointer(page);
  const c = await canvasBox(page);
  await page.mouse.move(c.x + c.width * 0.8, c.y + c.height * 0.85);
  const clip = { x: c.x + c.width / 2 - 380, y: c.y + c.height / 2 - 330, width: 760, height: 660 };
  await record(page, 'frames', async () => {
    // point at the ring's far carbon and press 1 for a bond, twice, then o for an O
    const para = await atomAt(page, ids[6]);
    await glide(page, para.x, para.y, 25);
    await page.waitForTimeout(400);
    await keys(page, ['1'], 700);
    let n = await newestAtom(page); await glide(page, n.x, n.y, 12); await page.waitForTimeout(200);
    await keys(page, ['1'], 700);
    n = await newestAtom(page); await glide(page, n.x, n.y, 12); await page.waitForTimeout(200);
    await keys(page, ['o'], 900);
    // move the structure: the frame comes along
    await tool(page, 'select');
    await page.waitForTimeout(400);
    const ring = await atomAt(page, ids[4]);
    await page.mouse.move(ring.x, ring.y, { steps: 25 });
    await page.mouse.dblclick(ring.x, ring.y);
    await page.waitForTimeout(400);
    await drag(page, ring, { x: ring.x + 110, y: ring.y + 30 }, 30);
    await page.waitForTimeout(300);
    await glide(page, c.x + c.width / 2 - 330, c.y + c.height / 2 + 270, 15);
    await page.mouse.click(c.x + c.width / 2 - 330, c.y + c.height / 2 + 270);
  }, { clip, width: 640, hold: 2200 });
  await browser.close();
}

// ---------------------------------------------------------------- a scheme turned into a catalytic cycle
if (want('catalytic-cycle')) {
  const { browser, page } = await open(url, { width: 1180, height: 760 });
  await roomy(page, { structGap: 14, lead: 8, headGap: 12 });
  const sm = ['[Pd]', 'Br[Pd]c1ccccc1', 'O[Pd]c1ccccc1', 'COc1ccc(cc1)[Pd]c1ccccc1'];
  const xs = [100, 230, 380, 560];
  for (let i = 0; i < sm.length; i++) await addSmiles(page, sm[i], xs[i], 250);
  await page.evaluate(() => {
    const a = window.__app, doc = a.doc, e = a.editor;
    doc.edit('Ligands', () => { for (const t of doc.atoms.values()) if (t.z === 46) doc.updateAtom(t.id, { label: 'PdL2' }); });
    const ar = (x1, x2) => doc.addArrow({ tail: { x: x1, y: 250 }, head: { x: x2, y: 250 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 3 });
    doc.edit('Arrows', () => { ar(130, 180); ar(280, 330); ar(430, 490); });
    doc.edit('Title', () => doc.addCaption({ x: 330, y: 330, runs: [{ text: 'Suzuki–Miyaura\ncatalytic cycle', bold: true }], justify: 'center' }));
    a.command('clean-up-reaction');
    const ids = [...doc.arrows.keys()];
    e.setArrowSideText(ids[0], 'above', 'PhBr'); e.setArrowSideText(ids[0], 'below', 'oxidative\naddition');
    e.setArrowSideText(ids[1], 'above', 'NaOH'); e.setArrowSideText(ids[1], 'below', 'ligand\nexchange');
    e.setArrowSideText(ids[2], 'above', 'ArB(OH)2'); e.setArrowSideText(ids[2], 'below', 'trans-\nmetalation');
    a.command('clean-up-reaction');
    e.clearSelection();
  });
  await page.evaluate(() => window.__app.command('fold-side'));
  await page.waitForTimeout(300);
  // room for the cycle, which is taller than the row it starts as
  await look(page, 1.6, 335, 300);
  await pointer(page);
  const c = await canvasBox(page);
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.9);
  await record(page, 'catalytic-cycle', async () => {
    await menu(page, 'scheme', 'arrange-scheme');
    await page.waitForTimeout(500);
    // the window to one side, so the scheme shows as each layout is tried
    await page.evaluate(() => { const d = document.querySelector('dialog.arrange-dialog'); d.style.margin = '0'; d.style.left = 'auto'; d.style.right = '12px'; d.style.top = '70px'; });
    await page.waitForTimeout(300);
    const tile = async (name) => {
      const b = await page.locator('dialog[open] .arrange-tile', { hasText: name }).boundingBox();
      await glide(page, b.x + b.width / 2, b.y + b.height / 2, 15); await page.waitForTimeout(200);
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(1300);
    };
    await tile('Catalytic cycle');
    await press(page, 'Done');
    await page.waitForTimeout(400);
    await glide(page, c.x + c.width * 0.5, c.y + c.height * 0.95, 15);
    await page.evaluate(() => window.__app.editor.clearSelection());
  }, { width: 1000, hold: 3000 });
  await browser.close();
}

// ---------------------------------------------------------------- compound numbers that stay with their structures
if (want('id-labels')) {
  const { browser, page } = await open(url);
  await roomy(page);
  const a1 = await addSmiles(page, 'O=Cc1ccc(Br)cc1', 140, 250);
  const a2 = await addSmiles(page, 'O=Cc1ccc(-c2ccccc2)cc1', 330, 250);
  const a3 = await addSmiles(page, 'OB(O)c1ccccc1', 230, 330);
  await page.evaluate(() => {
    const a = window.__app;
    a.editor.numberCompounds({ start: 1, style: 'numbers', prefix: '', suffix: '', bold: true });
    a.editor.clearSelection();
  });
  await page.evaluate(() => window.__app.command('fold-side'));
  await page.waitForTimeout(300);
  await look(page, 3.0, 232, 280);
  await pointer(page);
  const c = await canvasBox(page);
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.92);
  const clip = { x: c.x + c.width / 2 - 460, y: c.y + c.height / 2 - 320, width: 920, height: 640 };
  await record(page, 'id-labels', async () => {
    await tool(page, 'select');
    await page.waitForTimeout(300);
    // drag the boronic acid up between the others: its number comes along
    const b = await atomAt(page, a3[3]);
    await page.mouse.move(b.x, b.y, { steps: 20 });
    await page.mouse.dblclick(b.x, b.y);
    await page.waitForTimeout(300);
    await drag(page, b, { x: b.x + 10, y: b.y - 230 }, 30);
    await page.waitForTimeout(600);
    // grow the product with a hotkey: its number moves out of the way
    await tool(page, 'bond-single');
    const low = await page.evaluate((ids) => {
      // the lowest ring CH of the product: a bond grown there points down, at the number
      const doc = window.__app.doc, deg = (id) => [...doc.bonds.values()].filter((b) => b.a1 === id || b.a2 === id).length;
      return ids.filter((id) => deg(id) === 2 && doc.atoms.get(id).z === 6).sort((p, q) => doc.atoms.get(q).y - doc.atoms.get(p).y)[0];
    }, a2);
    const p = await atomAt(page, low);
    await glide(page, p.x, p.y, 20);
    await page.waitForTimeout(300);
    await keys(page, ['1'], 700);
    const n = await newestAtom(page); await glide(page, n.x, n.y, 12); await page.waitForTimeout(200);
    await keys(page, ['o'], 1000);
    // flip the starting material over: the number stays underneath
    await tool(page, 'select');
    const s = await atomAt(page, a1[4]);
    await glide(page, s.x, s.y, 20);
    await page.mouse.dblclick(s.x, s.y);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__app.command('flip-v'));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__app.command('rotate-cw'));
    await page.waitForTimeout(800);
    await glide(page, c.x + 60, c.y + c.height - 60, 15);
    await page.mouse.click(c.x + 60, c.y + c.height - 60);
  }, { clip, width: 860, hold: 2200 });
  await browser.close();
}

// ---------------------------------------------------------------- spelling and chemistry checks
if (want('spelling')) {
  const { browser, page } = await open(url);
  const id = await page.evaluate(() => {
    const a = window.__app, doc = a.doc; let id;
    doc.edit('Text', () => { id = doc.addCaption({ x: 200, y: 200, runs: [{ text: 'The crude solid was recrystalized from\nCH2Cl2/hexanes (5mL) at 10-15 °C;\n1H NMR in CDCl3 matched the litterature.' }], justify: 'left' }).id; });
    a.editor.changed(); return id;
  });
  await page.evaluate(() => window.__app.command('fold-side'));
  await look(page, 3.2, 248, 205);
  await pointer(page);
  const c = await canvasBox(page);
  await tool(page, 'text', false);
  await page.waitForTimeout(500);
  await page.mouse.move(c.x + c.width * 0.7, c.y + c.height * 0.8);
  const clip = { x: c.x + c.width / 2 - 450, y: c.y + c.height / 2 - 190, width: 900, height: 380 };
  // right-click a marked word and pick the first fix or suggestion
  const fix = async (line, before, word) => {
    const s = await wordSpot(page, id, line, before, word);
    await glide(page, s.x, s.y, 18); await page.waitForTimeout(250);
    await page.mouse.click(s.x, s.y, { button: 'right' }); await page.waitForTimeout(900);
    const b = await page.locator('.text-menu button').first().boundingBox();
    const x = b.x + Math.min(60, b.width / 2), y = b.y + b.height / 2;
    await glide(page, x, y, 12); await page.waitForTimeout(400);
    await page.mouse.click(x, y); await page.waitForTimeout(700);
  };
  await record(page, 'spelling', async () => {
    const s = await wordSpot(page, id, 0, 'The crude ', 'solid');
    await glide(page, s.x, s.y, 20);
    await page.mouse.click(s.x, s.y); await page.waitForTimeout(1500);
    await fix(1, '', 'CH2Cl2');
    await fix(1, 'CH₂Cl₂/hexanes (', '5mL');
    await fix(1, 'CH₂Cl₂/hexanes (5 mL) at ', '10-15');
    await fix(0, 'The crude solid was ', 'recrystalized');
    await fix(2, '1H NMR in CDCl3 matched the ', 'litterature');
    await fix(2, '', '1H');
    await fix(2, '1H NMR in ', 'CDCl3');
    await page.keyboard.press('Escape');
    await glide(page, c.x + c.width * 0.7, c.y + c.height * 0.8, 15);
  }, { clip, width: 900, hold: 2500 });
  await browser.close();
}

// ---------------------------------------------------------------- Name to Structure
if (want('name-to-structure')) {
  const { browser, page } = await open(url, { width: 1180, height: 760 });
  await pointer(page);
  const c = await canvasBox(page);
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.7);
  await record(page, 'name-to-structure', async () => {
    await menu(page, 'structure', 'name-to-structure');
    await page.waitForTimeout(500);
    await page.keyboard.type('(2S)-2-[4-(2-methylpropyl)phenyl]propanoic acid', { delay: 45 });
    await page.waitForTimeout(400);
    await press(page, 'Insert');
    await page.waitForFunction(() => window.__app.doc.atoms.size > 0, null, { timeout: 60000 });
    await page.waitForTimeout(700);
    await page.evaluate(() => { const a = window.__app; a.editor.fit(); });
    await page.waitForTimeout(400);
    // select it: the side panel works out its formula, masses and stereo
    await tool(page, 'select');
    const ids = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
    const p = await atomAt(page, ids[4]);
    await glide(page, p.x, p.y, 20);
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(1200);
  }, { width: 1000, hold: 2500 });
  await browser.close();
}

// ---------------------------------------------------------------- the dark page and its colours
if (want('dark-mode')) {
  const { browser, page } = await open(url, { width: 1180, height: 760 });
  const { drawScheme } = await import('./shot-lib.mjs');
  await drawScheme(page);
  await pointer(page);
  const c = await canvasBox(page);
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.8);
  await record(page, 'dark-mode', async () => {
    const b = await page.locator('#btn-dark').boundingBox();
    await glide(page, b.x + b.width / 2, b.y + b.height / 2, 25); await page.waitForTimeout(300);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(1200);
    for (const name of ['Slate', 'Warm dark']) {
      await menu(page, 'view', 'dark-colours');
      await page.waitForTimeout(500);
      const s = await page.locator('dialog[open] select').first().boundingBox();
      await glide(page, s.x + s.width / 2, s.y + s.height / 2, 12);
      await page.locator('dialog[open] select').first().selectOption(name);
      await page.waitForTimeout(500);
      await press(page, 'Use');
      await page.waitForTimeout(1300);
    }
    await glide(page, c.x + c.width * 0.5, c.y + c.height * 0.8, 15);
  }, { width: 1000, hold: 2000 });
  await browser.close();
}
