// PubChem lookups: names to structures, a structure's compound number, CAS numbers, GHS hazards
// and measured values. No network: PubChem's answers are hand-made in PubChem's own format
// (PUG REST and PUG View), cut to the fields used.
import { describe, expect, it } from 'vitest';
import {
  PubChemError, casNumbers, compoundPage, isCas, pubchemCid, pubchemCompound, pubchemName, readHazards, readValues, type Fetch,
} from '../src/chem/pubchem';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A pretend PubChem: answers by the start of the address, and keeps what was asked. */
function fakePubChem(routes: [RegExp, unknown][]): { fetchFn: Fetch; asked: { url: string; init?: RequestInit }[] } {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    for (const [re, body] of routes) if (re.test(url)) return json(body);
    return json({ Fault: { Code: 'PUGREST.NotFound', Message: 'No CID found' } }, 404);
  }) as unknown as Fetch;
  return { fetchFn, asked };
}

/** PUG View's nesting for a heading: Record > Section > Section > Section > Information. */
const view = (heading: string, information: unknown[]) => ({
  Record: { RecordType: 'CID', RecordNumber: 2244, RecordTitle: 'Aspirin', Section: [{ TOCHeading: 'Safety and Hazards', Section: [{ TOCHeading: 'Hazards Identification', Section: [{ TOCHeading: heading, Information: information }] }] }] },
});

const icon = (n: string, name: string) => ({ Start: 0, Length: 1, URL: `https://pubchem.ncbi.nlm.nih.gov/images/ghs/${n}.svg`, Type: 'Icon', Extra: name });

/** Two sources for one compound, as PubChem gives them: their pictograms, signals and H statements differ. */
const GHS = view('GHS Classification', [
  { Name: 'Pictogram(s)', Value: { StringWithMarkup: [{ String: '  ', Markup: [icon('GHS07', 'Irritant')] }] } },
  { Name: 'Signal', Value: { StringWithMarkup: [{ String: 'Warning', Markup: [{ Start: 0, Length: 7, Type: 'Color', Extra: 'GHSWarning' }] }] } },
  { Name: 'GHS Hazard Statements', Value: { StringWithMarkup: [
    { String: 'H302 (88.9%): Harmful if swallowed [Warning Acute toxicity, oral]' },
    { String: 'H315 (11.2%): Causes skin irritation [Warning Skin corrosion/irritation]' },
  ] } },
  { Name: 'Precautionary Statement Codes', Value: { StringWithMarkup: [{ String: 'P264, P270, P301+P317' }] } },
  { Name: 'Pictogram(s)', Value: { StringWithMarkup: [{ String: '  ', Markup: [icon('GHS05', 'Corrosive'), icon('GHS07', 'Irritant')] }] } },
  { Name: 'Signal', Value: { StringWithMarkup: [{ String: 'Danger' }] } },
  { Name: 'GHS Hazard Statements', Value: { StringWithMarkup: [
    { String: 'H318: Causes serious eye damage [Danger Serious eye damage/eye irritation]' },
    { String: 'H302: Harmful if swallowed [Warning Acute toxicity, oral]' },
    { String: 'H300+H310: Fatal if swallowed or in contact with skin' },
  ] } },
]);

describe('CAS numbers', () => {
  it('checks the check digit', () => {
    expect(isCas('50-78-2')).toBe(true); // aspirin
    expect(isCas('7732-18-5')).toBe(true); // water
    expect(isCas('64-17-5')).toBe(true); // ethanol
    expect(isCas(' 1122-58-3 ')).toBe(true); // DMAP
    expect(isCas('50-78-3')).toBe(false);
    expect(isCas('5-78-2')).toBe(false);
    expect(isCas('aspirin')).toBe(false);
  });

  it('picks the CAS numbers out of the synonyms, once each, in PubChem\'s order', () => {
    expect(casNumbers(['aspirin', 'ACETYLSALICYLIC ACID', '50-78-2', '2-acetoxybenzoic acid', '11126-35-5', '50-78-2', '12-34-5', 'EINECS 200-064-1'])).toEqual(['50-78-2', '11126-35-5']);
  });
});

describe('GHS hazards', () => {
  it('merges the sources: every pictogram, Danger over Warning, each H statement once without PubChem\'s notes', () => {
    const h = readHazards(GHS);
    expect(h.signal).toBe('Danger');
    expect(h.pictograms).toEqual([{ name: 'Corrosive', code: 'GHS05' }, { name: 'Irritant', code: 'GHS07' }]);
    expect(h.statements).toEqual([
      { code: 'H300+H310', text: 'Fatal if swallowed or in contact with skin' },
      { code: 'H302', text: 'Harmful if swallowed' },
      { code: 'H315', text: 'Causes skin irritation' },
      { code: 'H318', text: 'Causes serious eye damage' },
    ]);
  });

  it('gives nothing for a compound with no GHS record', () => {
    expect(readHazards(null)).toEqual({ signal: null, pictograms: [], statements: [] });
    expect(readHazards({ Record: {} })).toEqual({ signal: null, pictograms: [], statements: [] });
  });
});

describe('measured values', () => {
  it('reads values written out or given as number and unit, the first few, once each', () => {
    const mp = view('Melting Point', [
      { Name: 'Melting Point', Value: { StringWithMarkup: [{ String: '275 °F (NTP, 1992)' }] } },
      { Name: 'Melting Point', Value: { Number: [135], Unit: '°C' } },
      { Name: 'Melting Point', Value: { StringWithMarkup: [{ String: '275 °F (NTP, 1992)' }] } },
      { Name: 'Melting Point', Value: { Number: [134, 136], Unit: '°C' } },
      { Name: 'Melting Point', Value: { StringWithMarkup: [{ String: '138-140 °C' }] } },
    ]);
    expect(readValues(mp)).toEqual(['275 °F (NTP, 1992)', '135 °C', '134–136 °C']);
    expect(readValues(mp, 10)).toHaveLength(4);
    expect(readValues(null)).toEqual([]);
  });
});

describe('asking PubChem', () => {
  it('looks up a name and gives the structure', async () => {
    const { fetchFn, asked } = fakePubChem([[/compound\/name\/4-%28dimethylamino%29pyridine|compound\/name\/DMAP\//, { PropertyTable: { Properties: [{ CID: 14284, SMILES: 'CN(C)C1=CC=NC=C1', Title: '4-Dimethylaminopyridine' }] } }]]);
    expect(await pubchemName('  DMAP ', fetchFn)).toEqual({ cid: 14284, smiles: 'CN(C)C1=CC=NC=C1', title: '4-Dimethylaminopyridine' });
    expect(asked[0].url).toBe('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/DMAP/property/IsomericSMILES,Title/JSON');
    // older answers name it IsomericSMILES
    const old = fakePubChem([[/name\//, { PropertyTable: { Properties: [{ CID: 2244, IsomericSMILES: 'CC(=O)OC1=CC=CC=C1C(=O)O' }] } }]]);
    expect(await pubchemName('aspirin', old.fetchFn)).toEqual({ cid: 2244, smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', title: 'aspirin' });
  });

  it('puts characters such as / and spaces safely into the address', async () => {
    const { fetchFn, asked } = fakePubChem([]);
    expect(await pubchemName('Grubbs II/catalyst', fetchFn)).toBeNull();
    expect(asked[0].url).toContain('/compound/name/Grubbs%20II%2Fcatalyst/');
    expect(await pubchemName('   ', fetchFn)).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('finds a structure\'s compound number, sending the SMILES in the body', async () => {
    const { fetchFn, asked } = fakePubChem([[/smiles\/cids/, { IdentifierList: { CID: [2244] } }]]);
    expect(await pubchemCid('CC(=O)Oc1ccccc1C(=O)O', fetchFn)).toBe(2244);
    expect(asked[0].init?.method).toBe('POST');
    expect(String(asked[0].init?.body)).toBe('smiles=CC%28%3DO%29Oc1ccccc1C%28%3DO%29O');
    // PubChem answers CID 0 for a structure it doesn't have
    const none = fakePubChem([[/smiles\/cids/, { IdentifierList: { CID: [0] } }]]);
    expect(await pubchemCid('C1CC2CC1CC2[Xe]', none.fetchFn)).toBeNull();
  });

  it('gathers a compound\'s record', async () => {
    const { fetchFn, asked } = fakePubChem([
      [/cid\/2244\/property/, { PropertyTable: { Properties: [{ CID: 2244, Title: 'Aspirin', IUPACName: '2-acetyloxybenzoic acid' }] } }],
      [/cid\/2244\/synonyms/, { InformationList: { Information: [{ CID: 2244, Synonym: ['aspirin', '50-78-2', 'Acetylsalicylic acid', '11126-35-5'] }] } }],
      [/heading=GHS/, GHS],
      [/heading=Melting/, view('Melting Point', [{ Value: { Number: [135], Unit: '°C' } }])],
    ]);
    const c = await pubchemCompound(2244, fetchFn);
    expect(c).toMatchObject({ cid: 2244, title: 'Aspirin', iupac: '2-acetyloxybenzoic acid', cas: ['50-78-2', '11126-35-5'], meltingPoint: ['135 °C'], boilingPoint: [], density: [] });
    expect(c.hazards.signal).toBe('Danger');
    expect(asked.map((a) => a.url)).toContain('https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/2244/JSON?heading=Boiling%20Point');
    expect(compoundPage(2244)).toBe('https://pubchem.ncbi.nlm.nih.gov/compound/2244');
  });

  it('explains what went wrong in plain words', async () => {
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as Fetch;
    await expect(pubchemName('aspirin', offline)).rejects.toThrow(/is this computer online/);
    const busy = (async () => new Response('', { status: 503 })) as unknown as Fetch;
    await expect(pubchemName('aspirin', busy)).rejects.toThrow(/busy/);
    const broken = (async () => new Response('<html>', { status: 200 })) as unknown as Fetch;
    await expect(pubchemName('aspirin', broken)).rejects.toBeInstanceOf(PubChemError);
    const odd = (async () => new Response('', { status: 500 })) as unknown as Fetch;
    await expect(pubchemCid('C', odd)).rejects.toThrow(/\(500\)/);
  });

  it('gives up when PubChem doesn\'t answer in time', async () => {
    const slow = ((_: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as Fetch;
    await expect(pubchemName('aspirin', slow, 20)).rejects.toThrow(/did not answer in time/);
  });
});

describe('PubChem\'s limit of 5 requests a second', () => {
  it('spaces requests out, even when many are asked for at once', async () => {
    const at: number[] = [];
    const fetchFn = (async () => { at.push(Date.now()); return json({}, 404); }) as unknown as Fetch;
    await Promise.all(['a', 'b', 'c', 'd'].map((n) => pubchemName(n, fetchFn)));
    expect(at).toHaveLength(4);
    for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(195);
  });
});

describe('the Analysis panel\'s PubChem section', async () => {
  const { pubchemHtml, pubchemRuns } = await import('../src/ui/pubchem-panel');
  const aspirin = {
    cid: 2244, title: 'Aspirin', iupac: '2-acetyloxybenzoic acid', cas: ['50-78-2', '11126-35-5'],
    hazards: readHazards(GHS), meltingPoint: ['135 °C'], boilingPoint: [], density: [],
  };

  it('asks first, since looking up sends the structure away', () => {
    expect(pubchemHtml({ kind: 'idle' }, 2)).toContain('data-pubchem="2"');
    expect(pubchemHtml({ kind: 'busy' }, 0)).toContain('Looking it up');
    expect(pubchemHtml({ kind: 'none' }, 0)).toContain('no record');
    expect(pubchemHtml({ kind: 'error', message: 'PubChem is busy <now>' }, 0)).toContain('busy &lt;now&gt;');
  });

  it('shows the record with its link and buttons', () => {
    const html = pubchemHtml({ kind: 'found', c: aspirin }, 1);
    expect(html).toContain('50-78-2, 11126-35-5');
    expect(html).toContain('data-pubchem-page="2244"');
    expect(html).toContain('pc-danger');
    expect(html).toContain('Corrosive');
    expect(html).toContain('<b>H318</b> Causes serious eye damage');
    expect(html).toContain('135 °C');
    for (const k of ['pcname:1', 'pccas:1', 'pchaz:1']) expect(html).toContain(`data-insert="${k}"`);
    const bare = pubchemHtml({ kind: 'found', c: { ...aspirin, title: '', cas: [], hazards: { signal: null, pictograms: [], statements: [] } } }, 0);
    expect(bare).not.toContain('data-insert');
    expect(bare).toContain('No GHS hazard classification');
  });

  it('makes the captions', () => {
    expect(pubchemRuns('pcname', aspirin)).toEqual([{ text: 'Aspirin' }]);
    expect(pubchemRuns('pccas', aspirin)).toEqual([{ text: 'CAS 50-78-2' }]);
    const h = pubchemRuns('pchaz', aspirin)!;
    expect(h[0]).toEqual({ text: 'Danger', bold: true });
    expect(h[1].text).toBe('\nH300+H310 Fatal if swallowed or in contact with skin\nH302 Harmful if swallowed\nH315 Causes skin irritation\nH318 Causes serious eye damage');
    expect(pubchemRuns('pccas', { ...aspirin, cas: [] })).toBeNull();
  });
});
