// PubChem (pubchem.ncbi.nlm.nih.gov, the US National Library of Medicine's free database):
// names OPSIN can't read (trade names, common names, abbreviations such as DMAP or DIPEA),
// and for a drawn structure its common name, CAS number, GHS hazards and measured properties.
// Only the name typed or the structure's SMILES is sent. It needs the internet; everything else
// in the app works without it. Requests go one after another, inside PubChem's limit of 5 a second, even when a
// whole column of names in a sheet is looked up at once.

const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const VIEW = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound';
export const PUBCHEM_HOST = 'pubchem.ncbi.nlm.nih.gov';

import type { CompoundCard } from '../sheet/compound';

export type Fetch = typeof fetch;

/** A compound's page on PubChem, to open in the browser. */
export const compoundPage = (cid: number): string => `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;

export class PubChemError extends Error {}

/** PubChem asks for no more than 5 requests a second: each waits its turn, a fifth of a second apart. */
const GAP_MS = 210;
let queue: Promise<void> = Promise.resolve();
function turn(): Promise<void> {
  const mine = queue.then(() => new Promise<void>((r) => setTimeout(r, GAP_MS)));
  const go = queue;
  queue = mine;
  return go;
}

async function get(url: string, fetchFn: Fetch, init?: RequestInit, timeoutMs = 15000): Promise<unknown | null> {
  await turn();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: ctl.signal });
  } catch (e) {
    throw new PubChemError(ctl.signal.aborted ? 'PubChem did not answer in time. Try again in a moment.' : 'Could not reach PubChem: is this computer online?');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null; // PubChem's "not found"
  if (res.status === 503) throw new PubChemError('PubChem is busy just now. Try again in a few seconds.');
  if (!res.ok) throw new PubChemError(`PubChem answered with an error (${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new PubChemError('PubChem\'s answer could not be read. Try again in a moment.');
  }
}

/** The SMILES in a PubChem property record (named SMILES since 2025, IsomericSMILES before). */
function smilesOf(p: Record<string, unknown>): string | null {
  for (const k of ['SMILES', 'IsomericSMILES', 'CanonicalSMILES', 'ConnectivitySMILES']) if (typeof p[k] === 'string' && p[k]) return p[k] as string;
  return null;
}

/** A name, trade name or abbreviation looked up on PubChem: its best match, or null when PubChem doesn't know it. */
export async function pubchemName(name: string, fetchFn: Fetch = fetch, timeoutMs?: number): Promise<{ cid: number; smiles: string; title: string } | null> {
  const q = name.trim();
  if (!q) return null;
  const data = (await get(`${PUG}/compound/name/${encodeURIComponent(q)}/property/IsomericSMILES,Title/JSON`, fetchFn, undefined, timeoutMs)) as
    { PropertyTable?: { Properties?: Record<string, unknown>[] } } | null;
  const p = data?.PropertyTable?.Properties?.[0];
  const smiles = p && smilesOf(p);
  if (!p || !smiles || typeof p.CID !== 'number') return null;
  return { cid: p.CID, smiles, title: typeof p.Title === 'string' ? p.Title : q };
}

/** PubChem's compound number for a structure, or null when it isn't in PubChem. */
export async function pubchemCid(smiles: string, fetchFn: Fetch = fetch): Promise<number | null> {
  // sent in the body: SMILES has characters (#, /, \) that don't travel well in an address
  const data = (await get(`${PUG}/compound/smiles/cids/JSON`, fetchFn, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ smiles }).toString(),
  })) as { IdentifierList?: { CID?: number[] } } | null;
  const cid = data?.IdentifierList?.CID?.[0];
  return cid && cid > 0 ? cid : null;
}

/** Is this a CAS Registry Number with the right check digit? ("50-78-2" for aspirin.) */
export function isCas(text: string): boolean {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(text.trim());
  if (!m) return false;
  const digits = (m[1] + m[2]).split('').reverse();
  const sum = digits.reduce((s, d, i) => s + Number(d) * (i + 1), 0);
  return sum % 10 === Number(m[3]);
}

/** The CAS numbers among PubChem's synonyms, most used first (PubChem lists the main one first). */
export function casNumbers(synonyms: string[]): string[] {
  return [...new Set(synonyms.map((s) => s.trim()).filter(isCas))];
}

export interface Hazards {
  signal: 'Danger' | 'Warning' | null;
  /** Pictograms: name (Flammable, Corrosive, Irritant, Acute Toxic…) and GHS number ("GHS02"). */
  pictograms: { name: string; code: string }[];
  /** H statements, each once: code and wording. */
  statements: { code: string; text: string }[];
}

// PUG View's nested sections
interface ViewInfo {
  Name?: string;
  Value?: { StringWithMarkup?: { String?: string; Markup?: { Extra?: string; Type?: string; URL?: string }[] }[]; Number?: number[]; Unit?: string };
}
interface ViewSection { TOCHeading?: string; Section?: ViewSection[]; Information?: ViewInfo[] }

function infos(s: ViewSection | undefined, out: ViewInfo[] = []): ViewInfo[] {
  if (!s) return out;
  out.push(...(s.Information ?? []));
  for (const c of s.Section ?? []) infos(c, out);
  return out;
}

/** The GHS hazard summary from PubChem's "GHS Classification" section (all the sources it collects, merged). */
export function readHazards(view: unknown): Hazards {
  const info = infos((view as { Record?: ViewSection })?.Record);
  const out: Hazards = { signal: null, pictograms: [], statements: [] };
  for (const i of info) {
    const strings = i.Value?.StringWithMarkup ?? [];
    if (i.Name === 'Pictogram(s)') {
      for (const s of strings) {
        for (const m of s.Markup ?? []) {
          if (!m.Extra || out.pictograms.some((p) => p.name === m.Extra)) continue;
          out.pictograms.push({ name: m.Extra, code: /GHS\d{2}/.exec(m.URL ?? '')?.[0] ?? '' });
        }
      }
    } else if (i.Name === 'Signal') {
      const w = strings[0]?.String?.trim();
      // Danger wins over Warning when the sources differ
      if (w === 'Danger' || (w === 'Warning' && out.signal !== 'Danger')) out.signal = w;
    } else if (i.Name === 'GHS Hazard Statements') {
      for (const s of strings) {
        const m = /^(H\d{3}[A-Za-z]*(?:\+H\d{3}[A-Za-z]*)*)\s*(?:\([^)]*\))?\s*:?\s*(.*)$/.exec(s.String?.trim() ?? '');
        if (!m || out.statements.some((x) => x.code === m[1])) continue;
        // drop PubChem's notes on the end: "[Warning Acute toxicity, oral]"
        out.statements.push({ code: m[1], text: m[2].replace(/\s*\[[^\]]*\]\s*$/, '').trim() });
      }
    }
  }
  out.statements.sort((a, b) => a.code.localeCompare(b.code));
  out.pictograms.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

/** The first few values reported under a PUG View heading such as "Melting Point" (as written by each source). */
export function readValues(view: unknown, max = 3): string[] {
  const out: string[] = [];
  for (const i of infos((view as { Record?: ViewSection })?.Record)) {
    // a value is written out ("275 °F (NTP, 1992)") or given as a number and unit
    const texts = (i.Value?.StringWithMarkup ?? []).map((s) => s.String);
    if (i.Value?.Number?.length) texts.push(`${i.Value.Number.join('–')}${i.Value.Unit ? ` ${i.Value.Unit}` : ''}`);
    for (const raw of texts) {
      const t = raw?.trim();
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export interface Compound {
  cid: number;
  /** PubChem's name for it (often the common name). */
  title: string;
  iupac: string;
  cas: string[];
  hazards: Hazards;
  meltingPoint: string[];
  boilingPoint: string[];
  density: string[];
}

/** Everything the Analysis panel shows for a compound, by its PubChem number. */
export async function pubchemCompound(cid: number, fetchFn: Fetch = fetch): Promise<Compound> {
  const props = (await get(`${PUG}/compound/cid/${cid}/property/Title,IUPACName/JSON`, fetchFn)) as { PropertyTable?: { Properties?: Record<string, unknown>[] } } | null;
  const p = props?.PropertyTable?.Properties?.[0] ?? {};
  const syn = (await get(`${PUG}/compound/cid/${cid}/synonyms/JSON`, fetchFn)) as { InformationList?: { Information?: { Synonym?: string[] }[] } } | null;
  const view = (heading: string) => get(`${VIEW}/${cid}/JSON?heading=${encodeURIComponent(heading)}`, fetchFn);
  const ghs = await view('GHS Classification');
  const mp = await view('Melting Point');
  const bp = await view('Boiling Point');
  const density = await view('Density');
  return {
    cid,
    title: typeof p.Title === 'string' ? p.Title : '',
    iupac: typeof p.IUPACName === 'string' ? p.IUPACName : '',
    cas: casNumbers(syn?.InformationList?.Information?.[0]?.Synonym ?? []),
    hazards: readHazards(ghs),
    meltingPoint: readValues(mp),
    boilingPoint: readValues(bp),
    density: readValues(density),
  };
}

const CARD_PROPS = 'Title,IUPACName,MolecularFormula,MolecularWeight,ExactMass,IsomericSMILES,InChI,InChIKey,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,HeavyAtomCount,Charge,Complexity';

/** A number PubChem sends as text ("180.16") or as a number. */
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

/**
 * A compound's card for the Compound data type (sheets): looked up by name, SMILES or CID.
 * With `measured`, also its melting and boiling points, density and GHS hazards (four more
 * requests, so slower). Null when PubChem doesn't know it.
 */
export async function pubchemCard(q: { name: string } | { smiles: string } | { cid: number }, measured: boolean, fetchFn: Fetch = fetch): Promise<CompoundCard | null> {
  let data: { PropertyTable?: { Properties?: Record<string, unknown>[] } } | null;
  if ('smiles' in q) {
    data = (await get(`${PUG}/compound/smiles/property/${CARD_PROPS}/JSON`, fetchFn, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ smiles: q.smiles }).toString(),
    })) as typeof data;
  } else {
    const where = 'cid' in q ? `cid/${q.cid}` : `name/${encodeURIComponent(q.name.trim())}`;
    if ('name' in q && !q.name.trim()) return null;
    data = (await get(`${PUG}/compound/${where}/property/${CARD_PROPS}/JSON`, fetchFn)) as typeof data;
  }
  const p = data?.PropertyTable?.Properties?.[0];
  if (!p || typeof p.CID !== 'number' || p.CID <= 0) return null;
  const cid = p.CID;
  const fields: Record<string, string | number> = {};
  const put = (k: string, v: string | number | undefined) => { if (v !== undefined && v !== '') fields[k] = v; };
  const title = typeof p.Title === 'string' && p.Title ? p.Title : 'name' in q ? q.name.trim() : `CID ${cid}`;
  put('Name', title);
  put('IUPAC name', typeof p.IUPACName === 'string' ? p.IUPACName : undefined);
  put('Formula', typeof p.MolecularFormula === 'string' ? p.MolecularFormula : undefined);
  put('Molecular weight', num(p.MolecularWeight));
  put('Exact mass', num(p.ExactMass));
  put('PubChem CID', cid);
  put('SMILES', smilesOf(p) ?? undefined);
  put('InChI', typeof p.InChI === 'string' ? p.InChI : undefined);
  put('InChIKey', typeof p.InChIKey === 'string' ? p.InChIKey : undefined);
  put('XLogP', num(p.XLogP));
  put('TPSA', num(p.TPSA));
  put('H-bond donors', num(p.HBondDonorCount));
  put('H-bond acceptors', num(p.HBondAcceptorCount));
  put('Rotatable bonds', num(p.RotatableBondCount));
  put('Heavy atoms', num(p.HeavyAtomCount));
  put('Charge', num(p.Charge));
  put('Complexity', num(p.Complexity));
  const syn = (await get(`${PUG}/compound/cid/${cid}/synonyms/JSON`, fetchFn)) as { InformationList?: { Information?: { Synonym?: string[] }[] } } | null;
  put('CAS', casNumbers(syn?.InformationList?.Information?.[0]?.Synonym ?? [])[0]);
  if (measured) {
    const view = (heading: string) => get(`${VIEW}/${cid}/JSON?heading=${encodeURIComponent(heading)}`, fetchFn);
    put('Melting point', readValues(await view('Melting Point'), 1)[0]);
    put('Boiling point', readValues(await view('Boiling Point'), 1)[0]);
    put('Density', readValues(await view('Density'), 1)[0]);
    const hz = readHazards(await view('GHS Classification'));
    put('GHS signal', hz.signal ?? undefined);
    put('Hazard statements', hz.statements.map((s) => s.code).join(', '));
  }
  put('PubChem page', compoundPage(cid));
  return { cid, name: title, fields, looked: new Date().toISOString() };
}
