// Start-up: when the app is up, and how long the window is busy in its first 5 s (long tasks).
// `node bench/launch.mjs` with `npm run preview` running.
import { launch } from './browser.mjs';
const runs = Number(process.env.RUNS || 5);
const browser = await launch();
const out = [];
for (let i = 0; i < runs; i++) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    const t = setInterval(() => { if (window.__app) { window.__up = performance.now(); clearInterval(t); } }, 5);
  });
  await page.goto(process.env.APP_URL || 'http://localhost:4173/');
  await page.waitForTimeout(5000);
  out.push(await page.evaluate(() => {
    const l = window.__long;
    const busy = l.reduce((s, [, d]) => s + d, 0);
    const last = l.length ? Math.max(...l.map(([s, d]) => s + d)) : 0;
    return { up: Math.round(window.__up), quiet: Math.round(last), longest: Math.round(Math.max(0, ...l.map(([, d]) => d))), busy: Math.round(busy) };
  }));
  await page.close();
}
const med = (k) => out.map((o) => o[k]).sort((a, b) => a - b)[Math.floor(out.length / 2)];
console.log(JSON.stringify({ up: med('up'), quiet: med('quiet'), longest: med('longest'), busy: med('busy'), runs: out }));
await browser.close();
