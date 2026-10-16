// The equation window (Insert > Equation, or double-click an equation): type LaTeX and see it
// laid out as you type, with buttons for the usual pieces and symbols, and a few equations
// chemists use often to start from.

import { drawMath, layoutMath } from '../document/math';
import { docMeasure } from '../document/doc-file';
import { withStack } from '../text/layout';

export interface EquationChoice { tex: string; display: boolean }

/** Pieces put in at the caret. `|` marks where the caret goes after. */
const PIECES: { label: string; tex: string; title: string }[] = [
  { label: 'a⁄b', tex: '\\frac{|}{}', title: 'Fraction: \\frac{top}{bottom}' },
  { label: 'xⁿ', tex: '^{|}', title: 'Superscript: x^2, or x^{10} for more than one character' },
  { label: 'xₙ', tex: '_{|}', title: 'Subscript: k_{obs}' },
  { label: '√x', tex: '\\sqrt{|}', title: 'Square root (\\sqrt[3]{x} for a cube root)' },
  { label: '( )', tex: '\\left(|\\right)', title: 'Brackets that grow to fit what is in them ([ ], \\{ \\} and | | too)' },
  { label: '∑', tex: '\\sum_{i=1}^{n}|', title: 'Sum with limits' },
  { label: '∫', tex: '\\int_{|}^{}', title: 'Integral with limits' },
  { label: '→ᵃ', tex: '\\xrightarrow{|}', title: 'Arrow with conditions over it (\\xrightarrow[under]{over}; also \\xrightleftharpoons)' },
  { label: 'x̄', tex: '\\bar{|}', title: 'Bar over (also \\hat, \\vec, \\dot, \\tilde)' },
  { label: 'abc', tex: '\\text{|}', title: 'Upright words and units: \\text{mol L}^{-1}, \\mathrm{Pd} for symbols' },
];
const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'theta', 'kappa', 'lambda', 'mu', 'nu', 'pi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega'];
const GREEK_CH: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
const SIGNS: [string, string][] = [
  ['times', '×'], ['cdot', '⋅'], ['pm', '±'], ['leq', '≤'], ['geq', '≥'], ['neq', '≠'], ['approx', '≈'], ['propto', '∝'],
  ['rightarrow', '→'], ['rightleftharpoons', '⇌'], ['leftrightarrow', '↔'], ['infty', '∞'], ['partial', '∂'], ['degree', '°'], ['ddagger', '‡'], ['circ', '∘'],
];

/** Equations chemists use often, to start from. */
export const EXAMPLES: { name: string; tex: string }[] = [
  { name: 'Gibbs energy', tex: '\\Delta G = \\Delta H - T\\Delta S' },
  { name: 'Standard free energy and K', tex: '\\Delta G^{\\circ} = -RT\\ln K' },
  { name: 'Arrhenius equation', tex: 'k = A\\exp\\left(-\\frac{E_{a}}{RT}\\right)' },
  { name: 'Eyring equation', tex: 'k = \\frac{k_{B}T}{h}\\exp\\left(-\\frac{\\Delta G^{\\ddagger}}{RT}\\right)' },
  { name: 'Rate law', tex: '\\text{rate} = k[\\mathrm{A}]^{m}[\\mathrm{B}]^{n}' },
  { name: 'First-order decay', tex: '[\\mathrm{A}]_{t} = [\\mathrm{A}]_{0}e^{-kt}' },
  { name: 'Half-life (first order)', tex: 't_{1/2} = \\frac{\\ln 2}{k}' },
  { name: 'Beer–Lambert law', tex: 'A = \\varepsilon c l' },
  { name: 'Enantiomeric excess', tex: '\\text{ee} = \\frac{|R - S|}{R + S} \\times 100\\%' },
  { name: 'Selectivity from ΔΔG‡', tex: '\\frac{k_{1}}{k_{2}} = \\exp\\left(\\frac{\\Delta\\Delta G^{\\ddagger}}{RT}\\right)' },
  { name: 'Henderson–Hasselbalch', tex: '\\mathrm{pH} = \\mathrm{p}K_{a} + \\log\\frac{[\\mathrm{A^{-}}]}{[\\mathrm{HA}]}' },
  { name: 'Yield', tex: '\\text{yield} = \\frac{n_{\\text{product}}}{n_{\\text{limiting reagent}}} \\times 100\\%' },
  { name: 'Turnover frequency', tex: '\\mathrm{TOF} = \\frac{\\mathrm{TON}}{t}' },
  { name: 'Equilibrium', tex: '\\mathrm{A} + \\mathrm{B} \\xrightleftharpoons{K_{eq}} \\mathrm{C}' },
];

/**
 * Ask for an equation. `display` is offered when inserting (an equation on a line of its own,
 * centred, as against one in the line of text); leave it undefined when changing one.
 */
export function askEquation(opts: { tex: string; display?: boolean; font: string; ok: string }): Promise<EquationChoice | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask equation-dialog';
    d.setAttribute('aria-label', 'Equation');
    const form = document.createElement('form');
    form.innerHTML = `<h2>Equation</h2>
      <p class="muted">Type it as LaTeX, as in journal templates: <code>x^2</code>, <code>k_{obs}</code>, <code>\\frac{a}{b}</code>, <code>\\alpha</code>. Letters come out in italic; use <code>\\mathrm{…}</code> for element symbols and <code>\\text{…}</code> for words and units. Word opens it as its own equation.</p>
      <div class="eq-palette" role="toolbar" aria-label="Pieces"></div>
      <div class="eq-palette eq-symbols" role="toolbar" aria-label="Greek letters and signs"></div>
      <textarea name="tex" rows="3" spellcheck="false" aria-label="Equation (LaTeX)"></textarea>
      <div class="eq-preview" aria-label="How it looks"><canvas></canvas></div>
      <label class="ask-row"><span>Start from</span><select name="example"><option value="">An equation chemists use often…</option></select></label>
      <label class="ask-row ask-check" data-display><input type="checkbox" name="display"><span>On a line of its own, centred</span></label>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="submit" class="primary"></button></p>`;
    d.append(form);
    const ta = form.querySelector<HTMLTextAreaElement>('textarea')!;
    const canvas = form.querySelector<HTMLCanvasElement>('canvas')!;
    const sel = form.querySelector<HTMLSelectElement>('select')!;
    const disp = form.querySelector<HTMLInputElement>('input[name=display]')!;
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.textContent = opts.ok;
    ta.value = opts.tex;
    if (opts.display === undefined) form.querySelector<HTMLElement>('[data-display]')!.hidden = true;
    else disp.checked = opts.display;
    for (const ex of EXAMPLES) sel.add(new Option(ex.name, ex.tex));

    const family = withStack(opts.font);
    const draw = () => {
      const size = 20;
      const m = layoutMath(ta.value, size, family, docMeasure);
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(60, Math.ceil(m.w + 8)), h = Math.ceil(m.ascent + m.descent + 8);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // the preview is on white like the page, whatever the theme
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      if (ta.value.trim()) drawMath(ctx, m, 4, 4 + m.ascent, family, '#000');
    };

    /** Put LaTeX in at the caret (in place of any selection), the caret going to its `|`. */
    const put = (tex: string) => {
      const a = ta.selectionStart, b = ta.selectionEnd;
      const picked = ta.value.slice(a, b);
      // a selection goes inside the first braces of a piece
      let text = tex.replace('|', picked ? `${picked}|` : '|');
      const caret = text.indexOf('|');
      text = text.replace('|', '');
      ta.setRangeText(text, a, b, 'end');
      const at = a + (caret >= 0 ? caret : text.length);
      ta.setSelectionRange(at, at);
      ta.focus();
      draw();
    };
    const button = (parent: Element, label: string, title: string, tex: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => put(tex));
      parent.append(btn);
    };
    const [pieces, symbols] = form.querySelectorAll('.eq-palette');
    for (const p of PIECES) button(pieces, p.label, p.title, p.tex);
    for (const g of GREEK) button(symbols, GREEK_CH[g], `\\${g}`, `\\${g} `);
    for (const [name, ch] of SIGNS) button(symbols, ch, `\\${name}`, `\\${name} `);

    sel.addEventListener('change', () => {
      if (!sel.value) return;
      ta.value = sel.value;
      sel.value = '';
      draw();
      ta.focus();
    });
    ta.addEventListener('input', draw);
    // Enter puts it in (Shift+Enter for a new line in the box)
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

    let finished = false;
    const done = (v: EquationChoice | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const tex = ta.value.trim();
      done(tex ? { tex, display: disp.checked } : null);
    });
    form.querySelector('[data-act=cancel]')!.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    d.showModal();
    draw();
    ta.focus();
    ta.select();
  });
}
