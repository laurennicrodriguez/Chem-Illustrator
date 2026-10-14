// The Analysis panel's PubChem section: a structure looked up on PubChem (only when asked, since
// it sends the structure away) with its common name, CAS number, GHS hazards and measured
// values, and buttons that put the name, CAS number or hazards under the structure as captions
// tied to it. The captions are ordinary text afterwards, to edit or replace by hand.

import type { Compound } from '../chem/pubchem';
import type { TextRun } from '../model';

export type PubChemState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'none' } // PubChem hasn't got this structure
  | { kind: 'error'; message: string }
  | { kind: 'found'; c: Compound };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "1,1′-Bi-2-naphthol" can be long: names longer than this are folded away in the panel. */
const LONG_NAME = 60;

function values(label: string, v: string[]): string {
  return v.length ? `<tr><th>${label}</th><td>${v.map(esc).join('<br>')}</td></tr>` : '';
}

/** The section for structure i in the Analysis panel. */
export function pubchemHtml(state: PubChemState, i: number): string {
  const ask = (label: string) => `<button type="button" data-pubchem="${i}" title="Send this structure (as SMILES) to PubChem, the free NIH database, and show what it has on it: name, CAS number, hazards and measured values">${label}</button>`;
  if (state.kind === 'idle') return `<div class="pubchem an-buttons">${ask('Look up on PubChem')}</div>`;
  if (state.kind === 'busy') return '<div class="pubchem"><p class="muted small">Looking it up on PubChem…</p></div>';
  if (state.kind === 'none') return `<div class="pubchem"><p class="muted small">PubChem has no record of this exact structure (stereochemistry and charges count).</p><div class="an-buttons">${ask('Look up again')}</div></div>`;
  if (state.kind === 'error') return `<div class="pubchem"><p class="warn">${esc(state.message)}</p><div class="an-buttons">${ask('Try again')}</div></div>`;
  const c = state.c;
  const h = c.hazards;
  const iupac = c.iupac && c.iupac.toLowerCase() !== c.title.toLowerCase()
    ? `<tr><th>IUPAC name</th><td class="pc-name">${c.iupac.length > LONG_NAME ? `<details><summary>${esc(c.iupac.slice(0, 40))}…</summary>${esc(c.iupac)}</details>` : esc(c.iupac)}</td></tr>` : '';
  const hazards = h.signal || h.pictograms.length || h.statements.length
    ? `<details class="pc-hazards" open><summary>GHS hazards${h.signal ? `: <span class="pc-signal pc-${h.signal.toLowerCase()}">${h.signal}</span>` : ''}</summary>
        ${h.pictograms.length ? `<div class="pc-pictos">${h.pictograms.map((p) => `<span class="pc-picto" title="${esc(p.code)}"><span class="pc-diamond" aria-hidden="true"></span>${esc(p.name)}</span>`).join('')}</div>` : ''}
        ${h.statements.length ? `<ul class="pc-h">${h.statements.map((s) => `<li><b>${esc(s.code)}</b> ${esc(s.text)}</li>`).join('')}</ul>` : ''}
        <p class="muted small">Merged from every source PubChem collects; check the supplier's safety data sheet before use.</p>
      </details>`
    : '<p class="muted small">No GHS hazard classification on PubChem.</p>';
  const measured = values('Melting point', c.meltingPoint) + values('Boiling point', c.boilingPoint) + values('Density', c.density);
  return `<div class="pubchem">
    <details class="pc" open><summary>PubChem</summary>
    <table>
      <tr><th>Name</th><td class="pc-name">${esc(c.title) || '<span class="muted">—</span>'}</td></tr>
      ${iupac}
      <tr><th>CAS</th><td>${c.cas.length ? c.cas.slice(0, 3).map(esc).join(', ') : '<span class="muted">none listed</span>'}</td></tr>
      <tr><th>CID</th><td><a href="#" data-pubchem-page="${c.cid}" title="Open the compound's page on PubChem in the browser">${c.cid}</a></td></tr>
      ${measured}
    </table>
    ${measured ? '<p class="muted small">Measured values as each source reports them.</p>' : ''}
    ${hazards}
    <div class="an-buttons">
      ${c.title ? `<button type="button" data-insert="pcname:${i}" title="Put the name under the structure; it follows the structure and can be edited like any text">Name caption</button>` : ''}
      ${c.cas.length ? `<button type="button" data-insert="pccas:${i}" title="Put the CAS number under the structure">CAS caption</button>` : ''}
      ${h.statements.length || h.signal ? `<button type="button" data-insert="pchaz:${i}" title="Put the signal word and H statements under the structure">Hazards caption</button>` : ''}
    </div>
    </details>
  </div>`;
}

/** The caption a PubChem button puts under the structure, or null when there's nothing to put. */
export function pubchemRuns(kind: 'pcname' | 'pccas' | 'pchaz', c: Compound): TextRun[] | null {
  if (kind === 'pcname') return c.title ? [{ text: c.title }] : null;
  if (kind === 'pccas') return c.cas.length ? [{ text: `CAS ${c.cas[0]}` }] : null;
  const h = c.hazards;
  if (!h.signal && !h.statements.length) return null;
  const lines = h.statements.map((s) => `${s.code} ${s.text}`);
  return [...(h.signal ? [{ text: h.signal, bold: true }] : []), { text: (h.signal && lines.length ? '\n' : '') + lines.join('\n') }];
}
