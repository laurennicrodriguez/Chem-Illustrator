// The Analysis panel's contents for one structure, and the journal-style text it can put in the
// drawing (HRMS and elemental analysis lines, as ACS journals write them).

import type { FragmentResult } from '../worker/chem-worker';
import type { DescriptorKey, TextRun } from '../model';
import { parseAdduct, ionMz, type Adduct } from '../chem/hrms';
import { ionCounts, isotopePattern, elementalAnalysis, type IsotopePeak } from '../chem/analysis';
import { chargeText, hillFormula, withoutCharge } from '../chem/formula';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A formula with subscript counts and a superscript charge, as HTML. */
export function formulaHtml(f: string): string {
  // the charge: + or − at the end, with its size after a space (C4H12N2 2+)
  const m = /^(.*?)(?:\s+(\d+))?([+−])?$/.exec(f)!;
  return esc(m[1]).replace(/([A-Za-z])(\d+)/g, '$1<sub>$2</sub>') + (m[3] ? `<sup>${m[2] ?? ''}${m[3]}</sup>` : '');
}

/** An adduct label with its charge raised: [M+H]<sup>+</sup>. */
function adductHtml(label: string): string {
  return esc(label).replace(/\](\d*[+-])$/, (_, c) => `]<sup>${c.replace('-', '−')}</sup>`);
}

export interface IonInfo {
  adduct: Adduct;
  /** Formula of the ion, without its charge (as journals write it after "calcd for"). */
  formula: string;
  mz: number;
  pattern: IsotopePeak[] | null;
}

/** The ion of a structure for an adduct, or null when it can't be made (e.g. losing water from CH4). */
export function ionInfo(r: FragmentResult, adductText: string): IonInfo | null {
  let adduct: Adduct;
  try {
    adduct = parseAdduct(adductText);
  } catch {
    return null;
  }
  // a structure that is already charged is its own ion
  if (r.charge !== 0) adduct = { n: 1, parts: [], z: r.charge, label: '[M]' + (Math.abs(r.charge) > 1 ? Math.abs(r.charge) : '') + (r.charge > 0 ? '+' : '-') };
  const counts = r.props ? ionCounts(new Map(Object.entries(r.props.counts)), adduct) : null;
  if (!counts) return null;
  const formula = hillFormula(Object.fromEntries(counts));
  // m/z from the same masses the rest of the panel uses
  // (RDKit's exact mass of a charged structure already has its electrons added or taken away)
  const mz = r.charge !== 0 ? r.exact / Math.abs(r.charge) : ionMz(r.exact, adduct);
  return { adduct, formula, mz, pattern: isotopePattern(counts, adduct.z) };
}

/** Elemental analysis numbers for a structure, Hill order. */
export function analysisPercents(r: FragmentResult): { el: string; pct: number }[] | null {
  if (!r.props) return null;
  return elementalAnalysis(new Map(Object.entries(r.props.counts)), r.props.weights);
}

/** Elements an elemental analysis reports: C, H and N, and S or a halogen when present. */
function reported(ea: { el: string; pct: number }[]): { el: string; pct: number }[] {
  const keep = new Set(['C', 'H', 'N', 'S']);
  const out = ea.filter((x) => keep.has(x.el));
  return out.length ? out : ea;
}

/** A small bar picture of an isotope pattern. */
function patternSvg(p: IsotopePeak[]): string {
  const W = 220, H = 56, pad = 4;
  const lo = p[0].mz, hi = p[p.length - 1].mz;
  const span = Math.max(hi - lo, 4);
  const x = (mz: number) => pad + ((mz - lo) / span) * (W - 2 * pad - 30) + 10;
  const bars = p.map((q) => `<line x1="${x(q.mz).toFixed(1)}" x2="${x(q.mz).toFixed(1)}" y1="${H - 12}" y2="${(H - 12 - (q.rel / 100) * (H - 18)).toFixed(1)}" />`).join('');
  return `<svg class="iso-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Isotope pattern">
    <line class="axis" x1="${pad}" x2="${W - pad}" y1="${H - 12}" y2="${H - 12}" />${bars}
    <text x="${x(p[0].mz)}" y="${H - 1}" text-anchor="middle">${p[0].mz.toFixed(1)}</text></svg>`;
}

function deg(k: number | null): string {
  return k === null ? '' : `${Math.round(k - 273.15)} °C`;
}

/**
 * The panel's HTML for one structure. `i` numbers the structure's buttons
 * (data-insert="hrms:i" and so on), which the app wires up.
 */
export function analysisHtml(r: FragmentResult, i: number, adductText: string, extras: { stereo?: string; unknown?: string[]; pubchem?: string }): string {
  if (r.error) return `<div class="frag"><p class="warn">${esc(r.error)}</p></div>`;
  const ion = ionInfo(r, adductText);
  const ea = analysisPercents(r);
  const p = r.props;
  const rows: string[] = [
    `<tr><th>Exact mass</th><td>${r.exact.toFixed(4)}</td></tr>`,
    `<tr><th>Mol. wt.</th><td>${r.mw.toFixed(2)}</td></tr>`,
  ];
  if (ion) rows.push(`<tr><th>m/z ${adductHtml(ion.adduct.label)}</th><td>${ion.mz.toFixed(4)}</td></tr>`);
  if (ea) rows.push(`<tr><th>Elemental</th><td>${reported(ea).map((x) => `${x.el}, ${x.pct.toFixed(2)}`).join('; ')}</td></tr>`);
  if (extras.stereo) rows.push(`<tr><th>Stereo</th><td>${esc(extras.stereo)}</td></tr>`);
  let iso = '';
  if (ion?.pattern && ion.pattern.length) {
    // the peaks of 0.5 % or more (with any between), so a Br6 or Cl4 cluster shows its tallest peaks
    const pat = ion.pattern;
    const big = pat.map((q, i) => (q.rel >= 0.5 ? i : -1)).filter((i) => i >= 0);
    const first = big[0] ?? 0, last = Math.min(big[big.length - 1] ?? 5, first + 11);
    const top = pat.slice(first, last + 1);
    iso = `<details class="iso"><summary>Isotope pattern ${adductHtml(ion.adduct.label)}</summary>
      ${patternSvg(top)}
      <table class="iso-table">${top.map((q) => `<tr><td>${q.mz.toFixed(4)}</td><td>${q.rel.toFixed(1)}%</td></tr>`).join('')}</table></details>`;
  } else if (ion) iso = '<p class="muted small">No isotope pattern: an element in it isn\'t in the isotope table.</p>';
  let props = '';
  if (p) {
    const jb = p.joback;
    const groups = Object.entries(jb.groups).map(([g, n]) => `${n} × ${g}`).join(', ');
    const tip = `Joback–Reid group contributions (Chem. Eng. Commun. 1987, 57, 233). Rough: typical errors are 10–25 °C, more for large molecules.${groups ? ' Groups: ' + groups + '.' : ''}`;
    props = `<details class="props"><summary>Properties</summary><table>
      <tr><th title="Wildman–Crippen logP">cLogP</th><td>${p.clogp.toFixed(2)}</td></tr>
      <tr><th title="Wildman–Crippen molar refractivity">Molar refractivity</th><td>${p.mr.toFixed(2)}</td></tr>
      <tr><th title="Topological polar surface area (Ertl), Å²">tPSA</th><td>${p.tpsa.toFixed(1)} Å²</td></tr>
      <tr><th title="OH and NH hydrogens (Lipinski)">H-bond donors</th><td>${p.hbd}</td></tr>
      <tr><th title="N and O atoms (Lipinski)">H-bond acceptors</th><td>${p.hba}</td></tr>
      <tr><th>Rotatable bonds</th><td>${p.rotb}</td></tr>
      <tr><th>Heavy atoms</th><td>${p.heavy}</td></tr>
      <tr><th title="Fraction of carbons that are sp3">Fsp3</th><td>${p.fsp3.toFixed(2)}</td></tr>
      <tr><th title="${esc(tip)}">Boiling point (est.)</th><td>${jb.tb === null ? '<span class="muted">—</span>' : deg(jb.tb)}</td></tr>
      <tr><th title="${esc(tip)}">Melting point (est.)</th><td>${jb.tm === null ? '<span class="muted">—</span>' : deg(jb.tm)}</td></tr>
      </table>${jb.missing ? `<p class="muted small">${esc(jb.missing)}</p>` : ''}</details>`;
  }
  const buttons = `<div class="an-buttons">
      <button type="button" data-insert="formula:${i}" title="Attach the formula and masses under the structure: they follow it and update when it changes (choose what is shown in the Style panel)">Attach descriptors</button>
      ${ion ? `<button type="button" data-insert="hrms:${i}" title="Put an HRMS line under the structure (ACS style); type the found value into it">HRMS text</button>` : ''}
      ${ea ? `<button type="button" data-insert="ea:${i}" title="Put an elemental analysis line under the structure (ACS style)">Anal. text</button>` : ''}
    </div>`;
  return `<div class="frag">
    <div class="formula">${formulaHtml(r.formula)}</div>
    <table>${rows.join('')}</table>
    ${iso}${props}
    <div class="smiles" title="SMILES">${esc(r.smiles)}</div>
    ${extras.unknown?.length ? `<p class="warn">Not understood (left out): ${extras.unknown.map(esc).join(', ')}</p>` : ''}
    ${buttons}${extras.pubchem ?? ''}
  </div>`;
}

/** Runs for a formula in formula style (digits lowered). */
const f = (text: string): TextRun => ({ text, formula: true });
/** A formula with its charge raised (formula style raises a + only, and not its size). */
const fc = (formula: string, charge: number): TextRun[] =>
  charge ? [f(withoutCharge(formula, charge)), { text: chargeText(charge).trim(), sup: true }] : [f(formula)];

/** The text a button puts in the drawing, as caption runs. Null when it can't be made. */
export function analysisRuns(kind: 'formula' | 'hrms' | 'ea', r: FragmentResult, adductText: string): TextRun[] | null {
  if (kind === 'formula') {
    return [...fc(r.formula, r.charge), { text: `\nExact Mass: ${r.exact.toFixed(4)}\nMol. Wt.: ${r.mw.toFixed(2)}` }];
  }
  if (kind === 'hrms') {
    const ion = ionInfo(r, adductText);
    if (!ion) return null;
    const label = ion.adduct.label.replace(/^\[(.*)\](\d*[+-])$/, (_, body: string, c: string) => `[${body.replace(/([+-])/g, ' $1 ').replace(/-/g, '−')}]${c}`);
    const m = /^(.*\])(\d*[+-])$/.exec(label)!;
    return [
      { text: 'HRMS (ESI) ' }, { text: 'm/z', italic: true }, { text: `: ${m[1]}` }, { text: m[2].replace('-', '−'), sup: true },
      { text: ' Calcd for ' }, f(ion.formula), { text: ` ${ion.mz.toFixed(4)}; Found ${ion.mz.toFixed(4).replace(/\d/g, '0')}.` },
    ];
  }
  const ea = analysisPercents(r);
  if (!ea) return null;
  const rep = reported(ea);
  return [
    { text: 'Anal. Calcd for ' }, f(withoutCharge(r.formula, r.charge)), { text: `: ${rep.map((x) => `${x.el}, ${x.pct.toFixed(2)}`).join('; ')}. Found: ${rep.map((x) => `${x.el}, 00.00`).join('; ')}.` },
  ];
}

/** What descriptors a structure can show, in the order offered, with their names. */
export const DESCRIPTORS: { key: DescriptorKey; label: string }[] = [
  { key: 'formula', label: 'Formula' },
  { key: 'exact', label: 'Exact mass' },
  { key: 'mw', label: 'Molecular weight' },
  { key: 'mz', label: 'm/z of the ion' },
  { key: 'ea', label: 'Elemental analysis (%)' },
  { key: 'hrms', label: 'HRMS line' },
];

/** The descriptors a new descriptor caption shows: as ChemDraw's Analysis window does by default. */
export const DEFAULT_DESCRIPTORS: DescriptorKey[] = ['formula', 'exact', 'mw'];

/**
 * A structure's descriptors as caption text, one per line: its formula, exact mass, molecular
 * weight, m/z of the ion, elemental analysis and an HRMS line, as chosen.
 */
export function descriptorRuns(r: FragmentResult, show: DescriptorKey[], adductText: string): TextRun[] {
  const out: TextRun[] = [];
  const line = (runs: TextRun[]) => { if (out.length) out.push({ text: '\n' }); out.push(...runs); };
  for (const k of show) {
    if (k === 'formula') line(fc(r.formula, r.charge));
    else if (k === 'exact') line([{ text: `Exact Mass: ${r.exact.toFixed(4)}` }]);
    else if (k === 'mw') line([{ text: `Mol. Wt.: ${r.mw.toFixed(2)}` }]);
    else if (k === 'mz') {
      const ion = ionInfo(r, adductText);
      if (ion) line([{ text: 'm/z', italic: true }, { text: `: ${ion.mz.toFixed(4)} (${ion.adduct.label.replace(/\](\d*)-$/, ']$1−')})` }]);
    } else if (k === 'ea') {
      const ea = analysisPercents(r);
      if (ea) line([{ text: `Elemental Analysis: ${reported(ea).map((x) => `${x.el}, ${x.pct.toFixed(2)}`).join('; ')}` }]);
    } else if (k === 'hrms') {
      const runs = analysisRuns('hrms', r, adductText);
      if (runs) line(runs);
    }
  }
  return out.length ? out : [{ text: '' }];
}

/** A repeat group's unit, as the chemistry engine weighed it. */
export interface RepeatUnit {
  text: string;
  count: number | null;
  counts: Record<string, number>;
  exact: number;
  mw: number;
}

/**
 * A structure's numbers with its repeat groups counted. A numbered group (×3) is added that many
 * times in all, so the result is an ordinary molecule. A polymer (n) can't be weighed whole: its
 * formula is written with the unit in brackets, (C2H4)n, and `polymer` describes the parts.
 */
export function withRepeats(r: FragmentResult, units: RepeatUnit[]): { r: FragmentResult; polymer?: { ends: string; units: { text: string; formula: string; exact: number; mw: number }[]; endExact: number; endMw: number } } {
  if (!units.length || r.error || !r.props) return { r };
  let counts = { ...r.props.counts };
  let exact = r.exact, mw = r.mw;
  const add = (c: Record<string, number>, k: number) => { for (const [el, n] of Object.entries(c)) counts[el] = (counts[el] ?? 0) + k * n; };
  for (const u of units.filter((x) => x.count !== null)) {
    add(u.counts, u.count! - 1);
    exact += (u.count! - 1) * u.exact;
    mw += (u.count! - 1) * u.mw;
  }
  const letters = units.filter((x) => x.count === null);
  if (!letters.length) {
    counts = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
    const formula = hillFormula(counts, r.charge);
    return { r: { ...r, formula, exact, mw, props: { ...r.props, counts } } };
  }
  // a polymer: the end groups, then each unit in brackets with its letter
  for (const u of letters) { add(u.counts, -1); exact -= u.exact; mw -= u.mw; }
  counts = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  const ends = Object.keys(counts).length ? hillFormula(counts, r.charge) : '';
  const parts = letters.map((u) => ({ text: u.text, formula: hillFormula(u.counts), exact: u.exact, mw: u.mw }));
  const formula = ends + parts.map((p) => `(${p.formula})${p.text}`).join('');
  return { r: { ...r, formula, exact, mw, props: undefined }, polymer: { ends, units: parts, endExact: exact, endMw: mw } };
}

/** A polymer's formula as HTML: (C<sub>2</sub>H<sub>4</sub>)<i>n</i>. */
export function polymerFormulaHtml(ends: string, units: { text: string; formula: string }[]): string {
  return formulaHtml(ends) + units.map((u) => `(${formulaHtml(u.formula)})<sub><i>${esc(u.text)}</i></sub>`).join('');
}

/** The panel for a structure holding a polymer's repeat unit: its formula and the masses of the parts. */
export function polymerHtml(r: FragmentResult, p: NonNullable<ReturnType<typeof withRepeats>['polymer']>): string {
  const rows = p.units.map((u) => `<tr><th>Unit (${formulaHtml(u.formula)})<sub><i>${esc(u.text)}</i></sub></th><td>${u.exact.toFixed(4)}<br>${u.mw.toFixed(2)} g/mol</td></tr>`);
  if (p.ends) rows.push(`<tr><th>End groups ${formulaHtml(p.ends)}</th><td>${p.endExact.toFixed(4)}<br>${p.endMw.toFixed(2)} g/mol</td></tr>`);
  return `<div class="frag">
    <div class="formula">${polymerFormulaHtml(p.ends, p.units)}</div>
    <table>${rows.join('')}</table>
    <p class="muted small">A polymer: exact mass and molecular weight per repeat unit (and of the end groups). Type a number in place of ${esc(p.units[0].text)} for a molecule of that length.</p>
    <div class="smiles" title="SMILES (one repeat unit)">${esc(r.smiles)}</div>
  </div>`;
}
