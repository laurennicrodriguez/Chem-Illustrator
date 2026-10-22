// @vitest-environment jsdom
//
// Live citations from Zotero, Mendeley and EndNote: their Word field codes read into the
// document's references, and written back in the same form when the document is saved.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { citationTexts } from '../src/document/references';
import { cslFromRef, endNoteRecord, fromBase64, readCiteField, refFromCsl, styleFromCsl, toBase64, writeCite } from '../src/document/live-cites';
import type { DocText } from '../src/document/document';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const u8 = (s: string): Uint8Array => { const b = strToU8(s); const o = new Uint8Array(b.length); o.set(b); return o; };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wordFile(body: string, custom?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': u8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/>${custom ? `<Relationship Id="rId9" Type="${R}custom-properties" Target="docProps/custom.xml"/>` : ''}</Relationships>`),
    'word/document.xml': u8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
  };
  if (custom) files['docProps/custom.xml'] = u8(custom);
  return zipSync(files);
}
const parts = (bytes: Uint8Array): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(unzipSync(bytes))) if (/\.(xml|rels)$/.test(k)) out[k] = strFromU8(v);
  return out;
};

/** A field as Word writes it: begin, the instruction in pieces, separate, the result, end. */
const field = (instr: string, result: string, sup = true, data?: string) => {
  const pr = sup ? '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' : '';
  const begin = data ? `<w:fldChar w:fldCharType="begin"><w:fldData xml:space="preserve">${data}</w:fldData></w:fldChar>` : '<w:fldChar w:fldCharType="begin"/>';
  const pieces = esc(instr).match(/(?:&[a-z]+;|[^&]){1,100}/g)!.map((p) => `<w:r>${pr}<w:instrText xml:space="preserve">${p}</w:instrText></w:r>`).join('');
  const inner = data ? `<w:r>${begin}</w:r><w:r><w:instrText xml:space="preserve"> ADDIN EN.CITE.DATA </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>` : '';
  return `<w:r>${pr}${begin}</w:r>${pieces}${inner}<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${pr}<w:t>${result}</w:t></w:r><w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`;
};
const para = (...xs: string[]) => `<w:p>${xs.join('')}</w:p>`;
const text = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

const FULMER = { id: 1234, type: 'article-journal', title: 'NMR Chemical Shifts of Trace Impurities', 'container-title': 'Organometallics', 'container-title-short': 'Organometallics', author: [{ family: 'Fulmer', given: 'Gregory R.' }, { family: 'Miller', given: 'Alexander J. M.' }], issued: { 'date-parts': [[2010, 5, 10]] }, volume: '29', issue: '9', page: '2176-2179', DOI: '10.1021/om100106e', ISSN: '0276-7333' };
const SMITH = { id: 77, type: 'article-journal', title: 'A second paper', 'container-title': 'Journal of the American Chemical Society', journalAbbreviation: 'J. Am. Chem. Soc.', author: [{ family: 'Smith', given: 'Jane' }], issued: { 'date-parts': [['2021']] }, volume: '143', page: '1-10', DOI: '10.1021/jacs.0c00001' };

const zoteroCite = (items: object[], shown: string, id = 'abc123') => ` ADDIN ZOTERO_ITEM CSL_CITATION ${JSON.stringify({ citationID: id, properties: { formattedCitation: shown, plainCitation: shown, noteIndex: 0 }, citationItems: items, schema: 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json' })} `;
const PREFS = '<data data-version="3" zotero-version="6.0.30"><session id="Q1w2E3r4"/><style id="http://www.zotero.org/styles/royal-society-of-chemistry" hasBibliography="1" bibliographyStyleHasBeenSet="1"/><prefs><pref name="fieldType" value="Field"/></prefs></data>';
const customXml = (prefs: string) => `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${[prefs.slice(0, 255), prefs.slice(255)].filter(Boolean).map((v, i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="ZOTERO_PREF_${i + 1}"><vt:lpwstr>${esc(v)}</vt:lpwstr></property>`).join('')}</Properties>`;

function zoteroDoc(): Uint8Array {
  const c1 = zoteroCite([{ id: 1234, uris: ['http://zotero.org/users/1/items/ABCD1234'], itemData: FULMER }], '1');
  const c2 = zoteroCite([{ id: 77, uris: ['http://zotero.org/users/1/items/EFGH5678'], itemData: SMITH, locator: '5', label: 'page' }, { id: 1234, uris: ['http://zotero.org/users/1/items/ABCD1234'], itemData: FULMER }], '1,2', 'def456');
  const bib = ' ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY ';
  return wordFile(
    para(text('Impurities were assigned'), field(c1, '1'), text(' as before'), field(c2, '1,2'), text('.')) +
    para(text('References')) +
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${esc(bib)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>(1)	Fulmer, G. R. et al. Organometallics 2010.</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>(2)	Smith, J. J. Am. Chem. Soc. 2021.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
    para(text('After.')),
    customXml(PREFS),
  );
}

const ENDNOTE = '<EndNote><Cite><Author>Fulmer</Author><Year>2010</Year><RecNum>12</RecNum><DisplayText><style face="superscript">1</style></DisplayText><record><rec-number>12</rec-number><foreign-keys><key app="EN" db-id="x0d2fdsr3">12</key></foreign-keys><ref-type name="Journal Article">17</ref-type><contributors><authors><author>Fulmer, Gregory R.</author><author>Miller, Alexander J. M.</author></authors></contributors><titles><title>NMR Chemical Shifts of Trace Impurities</title><secondary-title>Organometallics</secondary-title></titles><periodical><full-title>Organometallics</full-title></periodical><pages>2176-2179</pages><volume>29</volume><number>9</number><dates><year>2010</year></dates><electronic-resource-num>10.1021/om100106e</electronic-resource-num></record></Cite></EndNote>';

describe('reading reference managers\' citations', () => {
  it('reads CSL-JSON items as references', () => {
    const r = refFromCsl(FULMER);
    expect(r.authors).toEqual(['Fulmer, Gregory R.', 'Miller, Alexander J. M.']);
    expect(r.journal).toBe('Organometallics');
    expect(r.year).toBe('2010');
    expect(r.pages).toBe('2176–2179');
    expect(r.doi).toBe('10.1021/om100106e');
    expect(refFromCsl(SMITH).journal).toBe('J. Am. Chem. Soc.');
  });

  it('opens a Zotero document with live citations, its bibliography and its style', async () => {
    const { doc, warnings } = await readDocx(zoteroDoc());
    expect(warnings.join(' ')).not.toMatch(/reference manager/);
    expect(doc.citeManager).toBe('zotero');
    expect(doc.citeStyle).toBe('rsc');
    expect(doc.zoteroPrefs).toBe(PREFS);
    expect(doc.references?.map((r) => r.live?.id)).toEqual(['1234', '77']);
    const cites = Object.values(doc.objects).filter((o) => o.kind === 'cite');
    expect(cites.length).toBe(2);
    expect(cites[1]).toMatchObject({ refs: [doc.references![1].id, doc.references![0].id], live: { app: 'zotero', id: 'def456' } });
    expect((cites[1] as { live: { items: Record<string, unknown> } }).live.items[doc.references![1].id]).toEqual({ locator: '5', label: 'page' });
    expect(Object.values(doc.objects).filter((o) => o.kind === 'bib').length).toBe(1);
    // the bibliography's text from Word is replaced by ours; the text after it stays
    const plain = doc.runs.map((r) => r.text).join('');
    expect(plain).not.toMatch(/Fulmer/);
    expect(plain).toMatch(/After\./);
    expect([...citationTexts(doc).values()]).toEqual(['1', '1,2']);
  });

  it('reads EndNote citations from the field data, and inline', async () => {
    const data = toBase64(ENDNOTE);
    expect(fromBase64(data)).toBe(ENDNOTE);
    const { doc } = await readDocx(wordFile(para(text('Shifts'), field(' ADDIN EN.CITE ', '1', true, data), text(' and again'), field(` ADDIN EN.CITE ${ENDNOTE}`, '1')) + para(field(' ADDIN EN.REFLIST ', '1. Fulmer', false))));
    expect(doc.citeManager).toBe('endnote');
    expect(doc.references?.length).toBe(1);
    const r = doc.references![0];
    expect(r).toMatchObject({ title: 'NMR Chemical Shifts of Trace Impurities', journal: 'Organometallics', volume: '29', issue: '9', doi: '10.1021/om100106e', live: { app: 'endnote', id: '12', db: 'x0d2fdsr3' } });
    expect(Object.values(doc.objects).filter((o) => o.kind === 'cite').length).toBe(2);
    expect(Object.values(doc.objects).some((o) => o.kind === 'bib')).toBe(true);
  });

  it('reads Mendeley Desktop fields and Mendeley Cite content controls', async () => {
    const legacy = ` ADDIN CSL_CITATION ${JSON.stringify({ citationID: 'MENDELEY_CITATION_x', properties: { noteIndex: 0 }, citationItems: [{ id: 'ITEM-1', uris: ['http://www.mendeley.com/documents/?uuid=aaaa'], itemData: { ...FULMER, id: 'ITEM-1' } }], mendeley: { formattedCitation: '<sup>1</sup>' }, schema: 'x' })} `;
    const v3 = toBase64(JSON.stringify({ citationID: 'MENDELEY_CITATION_y', properties: { noteIndex: 0 }, isEdited: false, manualOverride: { isManuallyOverridden: false, citeprocText: '2', manualOverrideText: '' }, citationItems: [{ id: 'bbbb-cccc', itemData: { ...SMITH, id: 'bbbb-cccc' }, isTemporary: false }] }));
    const sdt = `<w:sdt><w:sdtPr><w:tag w:val="MENDELEY_CITATION_v3_${v3}"/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r></w:sdtContent></w:sdt>`;
    const bib = '<w:sdt><w:sdtPr><w:tag w:val="MENDELEY_BIBLIOGRAPHY"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>(1) Fulmer</w:t></w:r></w:p></w:sdtContent></w:sdt>';
    const { doc } = await readDocx(wordFile(para(text('One'), field(legacy, '1'), text(' two'), sdt) + bib));
    expect(doc.citeManager).toBe('mendeley');
    expect(doc.references?.map((r) => r.live?.app)).toEqual(['mendeley', 'mendeley-cite']);
    expect(Object.values(doc.objects).filter((o) => o.kind === 'cite').length).toBe(2);
    expect(Object.values(doc.objects).some((o) => o.kind === 'bib')).toBe(true);
    expect(doc.runs.map((r) => r.text).join('')).not.toMatch(/Fulmer/);
  });

  it('keeps an unreadable citation as text, with a warning', async () => {
    const { doc, warnings } = await readDocx(wordFile(para(text('See'), field(' ADDIN ZOTERO_ITEM CSL_CITATION {broken ', '[1]', false))));
    expect(warnings.join(' ')).toMatch(/reference manager/);
    expect(doc.runs.map((r) => r.text).join('')).toBe('See[1]');
  });

  it('maps journal styles', () => {
    expect(styleFromCsl('http://www.zotero.org/styles/american-chemical-society')).toBe('acs');
    expect(styleFromCsl('http://www.zotero.org/styles/angewandte-chemie')).toBe('angewandte');
    expect(styleFromCsl('http://www.zotero.org/styles/apa')).toBeNull();
  });
});

describe('writing citations back for the reference manager', () => {
  it('saves a Zotero document as Zotero fields, keeping Zotero\'s ids, details and preferences', async () => {
    const { doc } = await readDocx(zoteroDoc());
    const p = parts(await writeDocx(doc, deps));
    const body = p['word/document.xml'];
    const instr = [...body.matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/g)].map((m) => m[1]).join('').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    expect(instr).toMatch(/ADDIN ZOTERO_ITEM CSL_CITATION \{"citationID":"abc123"/);
    expect(instr).toMatch(/"uris":\["http:\/\/zotero.org\/users\/1\/items\/ABCD1234"\]/);
    expect(instr).toMatch(/"ISSN":"0276-7333"/);
    expect(instr).toMatch(/"locator":"5"/);
    expect(instr).toMatch(/ADDIN ZOTERO_BIBL/);
    expect(body).not.toMatch(/CHEMILLUSTRATOR_CITE/);
    expect(p['docProps/custom.xml']).toMatch(/ZOTERO_PREF_1/);
    expect(p['_rels/.rels']).toMatch(/custom-properties/);
    // and open again the same
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    expect(again.references?.length).toBe(2);
    expect(again.references?.map((r) => r.id)).toEqual(doc.references?.map((r) => r.id));
    expect(again.zoteroPrefs).toBe(PREFS);
    expect([...citationTexts(again).values()]).toEqual([...citationTexts(doc).values()]);
    expect(Object.values(again.objects).filter((o) => o.kind === 'bib').length).toBe(1);
  });

  it('puts changes made here over Zotero\'s item, and writes new references as embedded items', () => {
    const r = refFromCsl(FULMER, 'r-1');
    r.live = { app: 'zotero', id: '1234', item: FULMER };
    expect(cslFromRef(r)).toEqual(FULMER);
    const changed = { ...r, volume: '30' };
    expect(cslFromRef(changed)).toEqual({ ...FULMER, volume: '30' });
    const fresh = { ...refFromCsl(SMITH, 'r-2'), live: undefined };
    const out = writeCite('zotero', [fresh], undefined, '2');
    const json = JSON.parse(out.instr.replace(/^ ADDIN ZOTERO_ITEM CSL_CITATION /, ''));
    expect(json.citationItems[0]).toMatchObject({ id: 'r-2', itemData: { title: 'A second paper', DOI: '10.1021/jacs.0c00001' } });
    expect(json.citationItems[0].uris).toBeUndefined();
    expect(json.properties.plainCitation).toBe('2');
  });

  it('saves EndNote citations with their records in the field data', async () => {
    const { doc } = await readDocx(wordFile(para(text('Shifts'), field(` ADDIN EN.CITE ${ENDNOTE}`, '1'))));
    const r = doc.references![0];
    expect(endNoteRecord(r)).toBe(r.live!.record);
    expect(endNoteRecord({ ...r, volume: '31' })).toMatch(/<volume>31<\/volume>/);
    const body = parts(await writeDocx(doc, deps))['word/document.xml'];
    const data = /<w:fldData[^>]*>([^<]+)<\/w:fldData>/.exec(body)![1];
    expect(fromBase64(data)).toMatch(/<RecNum>12<\/RecNum>.*<rec-number>12<\/rec-number>/);
    expect(body).toMatch(/ADDIN EN\.CITE\.DATA/);
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    expect(again.references?.length).toBe(1);
    expect(Object.values(again.objects).filter((o) => o.kind === 'cite').length).toBe(1);
  });

  it('saves Mendeley Cite citations as tagged content controls', async () => {
    const v3 = toBase64(JSON.stringify({ citationID: 'MENDELEY_CITATION_y', citationItems: [{ id: 'bbbb', itemData: { ...SMITH, id: 'bbbb' } }] }));
    const { doc } = await readDocx(wordFile(para(text('Two'), `<w:sdt><w:sdtPr><w:tag w:val="MENDELEY_CITATION_v3_${v3}"/></w:sdtPr><w:sdtContent><w:r><w:t>1</w:t></w:r></w:sdtContent></w:sdt>`)));
    const body = parts(await writeDocx(doc, deps))['word/document.xml'];
    const tag = /w:tag w:val="MENDELEY_CITATION_v3_([^"]+)"/.exec(body)![1];
    expect(JSON.parse(fromBase64(tag))).toMatchObject({ citationID: 'MENDELEY_CITATION_y', citationItems: [{ id: 'bbbb' }] });
  });

  it('writes a document made here for a chosen manager', async () => {
    const { doc } = await readDocx(zoteroDoc());
    const ours: DocText = { ...doc, citeManager: undefined, zoteroPrefs: undefined, references: doc.references!.map(({ live: _l, ...r }) => r) };
    const forZotero: DocText = { ...ours, citeManager: 'zotero', citeStyle: 'acs' };
    const p = parts(await writeDocx(forZotero, deps));
    expect(p['docProps/custom.xml']).toMatch(/american-chemical-society/);
    const again = (await readDocx(await writeDocx(forZotero, deps))).doc;
    expect(again.references?.map((r) => r.id)).toEqual(ours.references?.map((r) => r.id));
    // without a manager: our own fields, as before
    expect(parts(await writeDocx(ours, deps))['word/document.xml']).toMatch(/CHEMILLUSTRATOR_CITE/);
  });

  it('round-trips the instruction parser on what it writes', () => {
    const r = refFromCsl(FULMER, 'r-9');
    for (const app of ['zotero', 'mendeley', 'endnote'] as const) {
      const out = writeCite(app, [r], undefined, '1');
      const got = readCiteField(out.instr, out.data);
      expect(got?.items[0].ref.title).toBe(FULMER.title);
    }
  });
});
