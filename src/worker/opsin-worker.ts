// Background worker for name to structure. OPSIN (compiled to JavaScript, see opsin-js/) runs
// here so reading a name never holds up drawing. It starts only when first needed.

import { load, parse } from '../vendor/opsin/opsin.js';

export type NameRequest =
  | { type: 'init'; data: string }
  | { type: 'parse'; id: number; name: string };

export type NameResponse =
  | { type: 'ready'; ms: number }
  | { type: 'error'; message: string }
  | { type: 'parse'; id: number; json: string };

const post = (m: NameResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function init(url: string): Promise<void> {
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`could not load its data (${res.status})`);
  if (typeof DecompressionStream === 'undefined') throw new Error('this system is too old to unpack its data');
  const bytes = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const err = load(new Int8Array(bytes));
  if (err) throw new Error(err);
  parse('methane'); // OPSIN sets itself up on the first name; do it now, not when the person is waiting
  post({ type: 'ready', ms: Math.round(performance.now() - t0) });
}

self.onmessage = (e: MessageEvent<NameRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    init(m.data).catch((err) => post({ type: 'error', message: 'The name reader failed to start: ' + (err?.message ?? String(err)) }));
  } else if (m.type === 'parse') {
    let json: string;
    try {
      json = parse(m.name);
    } catch (err) {
      json = JSON.stringify({ ok: false, message: String(err) });
    }
    post({ type: 'parse', id: m.id, json });
  }
};
