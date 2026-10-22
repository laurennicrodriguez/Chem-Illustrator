# Writes src/text/symbol-table.ts, the characters of Insert > Symbol with their Unicode names.
# Run with: python3 scripts/symbol-table.py
import unicodedata as u, json
cats = [
 ('greek', 'Greek', 'αβγδεζηθικλμνξοπρστυφχψωϑϕϵςϖϰΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'),
 ('arrows', 'Arrows', '→←↑↓↔↕⇌⇋⇄⇆⇉⇇⇀↼⇁↽⟶⟵⟷⇒⇐⇔⇑⇓⟹⟸⟺↗↘↙↖↻↺⟳⟲↝↜⇢⇠↯↦↪↩⤳⇥⇤⇨⇦⇧⇩➔➜'),
 ('maths', 'Maths', '±∓×÷·∙−≤≥≠≈≅≃∼≡≢∝∞√∛∜∑∏∫∬∮∂∇∆∈∉∋⊂⊃⊆⊇∪∩∧∨¬∀∃∄∴∵⟨⟩⌈⌉⌊⌋‖⊥∥∠∡⊕⊗⊖⊙∘∅ℏℓℕℤℚℝℂ≪≫≲≳≺≻′″‴⁄%‰‱'),
 ('chem', 'Chemistry and units', '°‡†⦵⊕⊖•∙⇌⇋⇄Å℃℉µΩ℧ℓ≡═‖⌬⏣☢☣⚠⚗⚛⏚⁺⁻'),
 ('scripts', 'Superscripts and subscripts', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ'),
 ('numbers', 'Numbers and fractions', '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅐⅑⅒ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳❶❷❸❹❺❻❼❽❾❿'),
 ('punct', 'Punctuation', '–—‒…‘’‚“”„«»‹›§¶©®™℗¡¿·•‣◦※‽⁂¦¨´¸ˆ˜'),
 ('letters', 'Accented letters', 'áàâäãåāăąçćčďđéèêëēėęěğíìîïīįıłľĺñńňóòôöõøōőœŕřśšşșťţțúùûüūůűųýÿźżžßæðþÁÀÂÄÃÅĀĂĄÇĆČĎĐÉÈÊËĒĖĘĚĞÍÌÎÏĪĮİŁĽĹÑŃŇÓÒÔÖÕØŌŐŒŔŘŚŠŞȘŤŢȚÚÙÛÜŪŮŰŲÝŸŹŻŽÆÐÞ'),
 ('currency', 'Currency', '€£¥¢$₹₽₩₺₿¤'),
 ('shapes', 'Shapes and marks', '●○◉◎■□▪▫▲△▼▽◀▶◆◇◊★☆✓✔✗✘☐☑☒♠♣♥♦♪♫☀☁☂☎✉✂✎✏⌘⌥⏎⌫⎋'),
]
alias = {
 '°':'degree','µ':'micro mu','Å':'angstrom','‡':'double dagger transition state','†':'dagger','⇌':'equilibrium reversible','⇋':'equilibrium reversible',
 '⊕':'positive charge plus circled','⊖':'negative charge minus circled','•':'radical bullet dot','∙':'radical dot','±':'plus minus','∓':'minus plus',
 '→':'reaction arrow right yields','⟶':'reaction arrow long','⦵':'standard state plimsoll naught','℃':'degree celsius','℉':'degree fahrenheit','ℏ':'h bar planck reduced',
 '‰':'per mille thousand','×':'times multiply','÷':'divide','·':'middle dot times','−':'minus','≈':'approximately','≡':'triple bond identical','═':'double bond',
 '⌬':'benzene ring','⏣':'benzene ring circle aromatic','☢':'radioactive','☣':'biohazard','⚠':'warning hazard','⚗':'alembic flask','⚛':'atom',
 '–':'en dash range','—':'em dash','…':'ellipsis dots','∆':'heat delta increment','Δ':'delta heat','ν':'nu frequency','λ':'lambda wavelength','η':'eta hapto','κ':'kappa',
 '∞':'infinity','√':'square root','∑':'sum sigma','∫':'integral','∂':'partial','∇':'nabla del','′':'prime minute','″':'double prime second','ℓ':'script l litre',
 '½':'half','¼':'quarter','¾':'three quarters','€':'euro','£':'pound sterling','¥':'yen','✓':'tick check','✔':'tick check heavy','✗':'cross x','✘':'cross x heavy',
 '®':'registered','©':'copyright','™':'trademark','§':'section','¶':'pilcrow paragraph','Ω':'ohm omega','℧':'mho siemens','⁺':'plus superscript charge','⁻':'minus superscript charge',
 '↑':'gas evolved up arrow','↓':'precipitate down arrow','↻':'clockwise','↺':'anticlockwise counterclockwise','↯':'lightning electrolysis','⊥':'perpendicular','∥':'parallel',
 '∝':'proportional','≪':'much less','≫':'much greater','∠':'angle','ß':'sharp s eszett','ø':'o slash','æ':'ae ash','œ':'oe ligature','ϑ':'theta variant','ϕ':'phi variant','ς':'final sigma',
}
seen=set(); out=[]
for key,title,chars in cats:
  for ch in chars:
    try: n=u.name(ch).lower()
    except ValueError: n=''
    n = n.replace('greek small letter ','').replace('greek capital letter ','capital ') if key=='greek' else n
    a = alias.get(ch,'')
    words=[]
    for w in (n+' '+a).split():
      if w not in words: words.append(w)
    out.append([ch, ' '.join(words), key])

lines=["// Characters for Insert > Symbol, by group, with their Unicode names (written out by scripts/symbol-table.py",
"// from Python's unicodedata, plus the words chemists look for: degree, angstrom, equilibrium).",
"// A character can be in more than one group.","",
"/** The groups, in the order the window lists them. */",
"export const SYMBOL_GROUPS: { id: string; title: string }[] = " + json.dumps([{'id':k,'title':t} for k,t,_ in cats], ensure_ascii=False).replace('"id"','id').replace('"title"','title').replace('"',"'") + ";",
"","/** [character, name, group]. */","export const SYMBOL_TABLE: [string, string, string][] = ["]
for ch,n,k in out:
  lines.append("  [" + json.dumps(ch, ensure_ascii=False).replace("'", "\\'").replace('"',"'") + ", '" + n.replace("'","\\'") + "', '" + k + "'],")
lines.append("];")
open(__import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'src', 'text', 'symbol-table.ts'),'w').write('\n'.join(lines)+'\n')
