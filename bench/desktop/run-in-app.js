// Timing run inside the real desktop app (WebView2 on Windows, WebKitGTK on Linux). bench/desktop.mjs
// adds this file to a build's index.html with OUT set to where the results go; it waits for the app,
// times the same steps as bench/big.mjs, writes the results as JSON and leaves the app open.
(function () {
  const OUT = '__OUT__';
  const N = Number('__N__');
  const up0 = performance.now();
  const write = (obj) => window.__TAURI_INTERNALS__.invoke('write_text_file', { path: OUT, contents: JSON.stringify(obj) });
  const raf = () => new Promise((ok) => requestAnimationFrame(() => ok()));
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(1); };
  const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length * 0.95)].toFixed(1); };
  async function main() {
    while (!window.__app) await wait(5);
    const up = { appUpMs: Math.round(performance.now()), appUpEpoch: Math.round(performance.timeOrigin + performance.now()) };
    // the window is answering: a timer comes back on time once start-up work is done
    let lateMax = 0;
    for (let i = 0; i < 40; i++) { const t = performance.now(); await wait(25); lateMax = Math.max(lateMax, performance.now() - t - 25); }
    up.idleByMs = Math.round(performance.now());
    up.worstTimerLateMs = Math.round(lateMax);
    try {
      while (!window.__app.chem.ready) await wait(20);
      const { doc, renderer: r, editor, stressTest, ws } = window.__app;
      stressTest(N);
      await raf();
      const sv = [];
      let text = '';
      for (let i = 0; i < 3; i++) { const s0 = performance.now(); text = window.__app.cdxml('big'); sv.push(performance.now() - s0); }
      const bytes = new TextEncoder().encode(text);
      const op = [], paint = [], resave = [];
      for (let i = 0; i < 3; i++) {
        const s0 = performance.now();
        await ws.openBytes(bytes, `big${i}.cdxml`);
        const s1 = performance.now();
        await raf(); await raf();
        op.push(s1 - s0); paint.push(performance.now() - s1);
        // a small edit, then saving the opened file again (what AutoSave does)
        const atoms = [...doc.atoms.values()];
        doc.edit('Move', () => doc.moveAtoms([...doc.fragmentOf(atoms[Math.floor(atoms.length / 2)].id)], 1, 1));
        const s2 = performance.now();
        window.__app.cdxml('big');
        resave.push(performance.now() - s2);
      }
      editor.fit(); r.renderScene(doc);
      const atoms = [...doc.atoms.values()];
      const frag = [...doc.fragmentOf(atoms[Math.floor(atoms.length / 2)].id)];
      const mv = [];
      doc.begin('Move');
      for (let i = 0; i < 40; i++) { const s0 = performance.now(); doc.moveAtoms(frag, 0.5, 0.3); r.renderScene(doc); mv.push(performance.now() - s0); }
      doc.commit();
      const many = atoms.slice(0, 2000).map((a) => a.id);
      const mv2 = [];
      doc.begin('Move');
      for (let i = 0; i < 20; i++) { const s0 = performance.now(); doc.moveAtoms(many, 0.5, 0.3); r.renderScene(doc); mv2.push(performance.now() - s0); }
      doc.commit();
      await write({ ...up, ua: navigator.userAgent, atoms: doc.atoms.size, mb: +(bytes.length / 1e6).toFixed(2),
        saveMs: sv.map((x) => Math.round(x)), openMs: op.map((x) => Math.round(x)), paintMs: paint.map((x) => Math.round(x)), resaveMs: resave.map((x) => Math.round(x)),
        drag1: [med(mv), p95(mv)], drag2000: [med(mv2), p95(mv2)], loadedAfterMs: Math.round(up0) });
    } catch (e) {
      await write({ ...up, error: String(e && e.stack || e) });
    }
  }
  main();
})();
