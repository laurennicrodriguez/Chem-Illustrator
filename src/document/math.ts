// Equations (Insert > Equation, as in Word). An equation is typed as a line of LaTeX, the way
// most scientists already write maths (\frac{a}{b}, x^2, k_{obs}, \sqrt{x}, \alpha, \Delta G^\ddagger,
// \xrightarrow{h\nu}), and shown laid out as maths: fractions stacked, scripts raised and lowered,
// letters in italic and numbers, functions and units upright (the ISO convention Word follows).
// It sits in the text as one character. In Word files it is saved as Word's own equation
// (Office Math, OMML), so it stays editable there, and Word's equations open here as LaTeX.
//
// Only a subset of LaTeX is understood: what equations in chemistry papers use. Anything else is
// shown as it was typed, so nothing is lost.

import type { Measure } from '../text/layout';

// ---------------------------------------------------------------- the equation as a tree

export type MathNode =
  | { t: 'row'; kids: MathNode[] }
  /** A character or word. `it`: a variable (italic); `up`: upright (numbers, functions, Greek capitals); `op`: an operator or relation, with space round it; `text`: words. */
  | { t: 'sym'; s: string; style: 'it' | 'up' | 'op' | 'text' }
  | { t: 'frac'; num: MathNode; den: MathNode }
  | { t: 'scr'; base: MathNode; sub?: MathNode; sup?: MathNode }
  | { t: 'sqrt'; body: MathNode; index?: MathNode }
  /** Brackets that grow to fit what is inside them (\left( … \right)). '' for none. */
  | { t: 'delim'; open: string; close: string; body: MathNode }
  /** A big operator (∑, ∏, ∫) with its limits. */
  | { t: 'big'; op: string; sub?: MathNode; sup?: MathNode }
  /** A mark over something: a bar, hat, arrow, dot or tilde. */
  | { t: 'acc'; mark: Accent; body: MathNode }
  /** Something with a smaller thing over or under it (\overset, \underset). */
  | { t: 'over'; body: MathNode; over?: MathNode; under?: MathNode }
  /** A reaction or long arrow with conditions over (and under) it (\xrightarrow[under]{over}). */
  | { t: 'arrow'; ch: string; over?: MathNode; under?: MathNode }
  /** Space (in ems). */
  | { t: 'space'; em: number };

export type Accent = 'bar' | 'hat' | 'vec' | 'dot' | 'ddot' | 'tilde';

/** Named symbols: Greek letters, operators, relations and arrows. */
const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
  varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', ell: 'ℓ', AA: 'Å', degree: '°', circ: '∘', prime: '′', ddagger: '‡', dagger: '†',
  ldots: '…', cdots: '⋯', angle: '∠', emptyset: '∅', bullet: '•', ominus: '⊖', oplus: '⊕',
};
const OPERATORS: Record<string, string> = {
  times: '×', cdot: '⋅', pm: '±', mp: '∓', div: '÷', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  sim: '∼', simeq: '≃', equiv: '≡', propto: '∝', ll: '≪', gg: '≫', in: '∈', cdotp: '⋅', ast: '∗',
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', rightleftharpoons: '⇌', leftrightharpoons: '⇋',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', longrightarrow: '⟶', uparrow: '↑', downarrow: '↓', mapsto: '↦',
};
const BIG: Record<string, string> = { sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮' };
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'ln', 'log', 'lg', 'exp', 'lim', 'max', 'min', 'det', 'deg', 'arg', 'dim', 'gcd', 'Pr']);
const ACCENTS: Record<string, Accent> = { bar: 'bar', overline: 'bar', hat: 'hat', widehat: 'hat', vec: 'vec', overrightarrow: 'vec', dot: 'dot', ddot: 'ddot', tilde: 'tilde', widetilde: 'tilde' };
const SPACES: Record<string, number> = { ',': 3 / 18, ':': 4 / 18, '>': 4 / 18, ';': 5 / 18, '!': -3 / 18, quad: 1, qquad: 2, ' ': 0.25 };
const LONG_ARROWS: Record<string, string> = { xrightarrow: '→', xleftarrow: '←', xrightleftharpoons: '⇌', xleftrightarrow: '↔', xLeftrightarrow: '⇔', xRightarrow: '⇒' };
/** Characters that are operators or relations when typed as they are. */
const OP_CHARS = new Set([...'+−-=<>×÷±∓⋅≤≥≠≈∼≡∝→←↔⇌⇋⇒⇐⇔⟶↑↓∈∗']);
const UPRIGHT_CHARS = /[0-9.ΓΔΘΛΞΠΣΥΦΨΩ∞∂∇°′‡†…⋯∠∅()[\]{}|,;:!?'/%@&]/;

/** All the names understood after a backslash (for the help in the equation box). */
export const MATH_NAMES = [...Object.keys(SYMBOLS), ...Object.keys(OPERATORS), ...Object.keys(BIG), ...FUNCTIONS, ...Object.keys(ACCENTS), ...Object.keys(LONG_ARROWS), 'frac', 'dfrac', 'tfrac', 'sqrt', 'left', 'right', 'text', 'mathrm', 'mathit', 'overset', 'underset', 'quad', 'qquad'];

// ---------------------------------------------------------------- reading LaTeX

type Tok = { k: 'cmd'; v: string } | { k: 'ch'; v: string } | { k: 'open' } | { k: 'close' } | { k: '^' } | { k: '_' } | { k: 'lbr' } | { k: 'rbr' };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  const chars = [...src];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '\\') {
      const rest = chars.slice(i + 1);
      const m = /^[A-Za-z]+/.exec(rest.join(''));
      if (m) { out.push({ k: 'cmd', v: m[0] }); i += m[0].length; }
      else if (rest.length) { out.push({ k: 'cmd', v: rest[0] }); i += 1; }
      continue;
    }
    if (c === '{') out.push({ k: 'open' });
    else if (c === '}') out.push({ k: 'close' });
    else if (c === '^') out.push({ k: '^' });
    else if (c === '_') out.push({ k: '_' });
    else if (c === '[') out.push({ k: 'lbr' });
    else if (c === ']') out.push({ k: 'rbr' });
    else out.push({ k: 'ch', v: c });
  }
  return out;
}

class Reader {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined { return this.toks[this.i]; }

  /** Read until a closing brace (or `stop`), or the end. */
  row(stop?: (t: Tok) => boolean): MathNode {
    const kids: MathNode[] = [];
    while (this.i < this.toks.length) {
      const t = this.toks[this.i];
      if (t.k === 'close' || stop?.(t)) break;
      if (t.k === '^' || t.k === '_') {
        this.i++;
        const arg = this.arg();
        const last = kids.pop();
        if (last?.t === 'big') { kids.push({ ...last, [t.k === '^' ? 'sup' : 'sub']: arg }); continue; }
        const s: Extract<MathNode, { t: 'scr' }> = last?.t === 'scr' && !(t.k === '^' ? last.sup : last.sub) ? last : { t: 'scr', base: last ?? { t: 'row', kids: [] } };
        kids.push({ ...s, [t.k === '^' ? 'sup' : 'sub']: arg });
        continue;
      }
      const a = this.atom();
      if (a) kids.push(a);
    }
    return joinNumbers(kids);
  }

  /** One argument: a braced group, or the next single thing. */
  arg(): MathNode {
    const t = this.peek();
    if (!t) return { t: 'row', kids: [] };
    if (t.k === 'open') {
      this.i++;
      const r = this.row();
      if (this.peek()?.k === 'close') this.i++;
      return r;
    }
    return this.atom() ?? { t: 'row', kids: [] };
  }

  /** An optional [argument]. */
  optional(): MathNode | undefined {
    if (this.peek()?.k !== 'lbr') return undefined;
    this.i++;
    const r = this.row((t) => t.k === 'rbr');
    if (this.peek()?.k === 'rbr') this.i++;
    return r;
  }

  /** The raw text of a braced group (for \text). */
  rawGroup(): string {
    if (this.peek()?.k !== 'open') { const a = this.peek(); this.i++; return a && 'v' in a ? a.v : ''; }
    this.i++;
    let depth = 1, s = '';
    while (this.i < this.toks.length) {
      const t = this.toks[this.i++];
      if (t.k === 'open') { depth++; s += '{'; continue; }
      if (t.k === 'close') { if (--depth === 0) break; s += '}'; continue; }
      s += t.k === 'cmd' ? (t.v.length === 1 ? t.v : `\\${t.v}`) : t.k === 'ch' ? t.v : t.k === '^' ? '^' : t.k === '_' ? '_' : t.k === 'lbr' ? '[' : ']';
    }
    return s;
  }

  atom(): MathNode | null {
    const t = this.toks[this.i++];
    if (!t) return null;
    switch (t.k) {
      case 'open': {
        const r = this.row();
        if (this.peek()?.k === 'close') this.i++;
        // {-} is a plain dash (a bond, Ar{-}Ar), not a minus with space round it
        return r.t === 'sym' && r.style === 'op' ? { ...r, style: 'up' } : r;
      }
      case 'close': return null;
      case 'lbr': return { t: 'sym', s: '[', style: 'up' };
      case 'rbr': return { t: 'sym', s: ']', style: 'up' };
      case 'ch': return charNode(t.v);
      case 'cmd': return this.command(t.v);
      default: return null;
    }
  }

  command(name: string): MathNode {
    if (name in SPACES) return { t: 'space', em: SPACES[name] };
    if (name === '{' || name === '}' || name === '%' || name === '$' || name === '#' || name === '&' || name === '_' || name === '|') return { t: 'sym', s: name === '|' ? '‖' : name, style: 'up' };
    if (name === '\\') return { t: 'space', em: 1 };
    if (name in SYMBOLS) { const s = SYMBOLS[name]; return { t: 'sym', s, style: /[α-ωϵϑϖϱςϕ]/.test(s) || s === 'ℓ' || s === 'ℏ' ? 'it' : 'up' }; }
    if (name in OPERATORS) return { t: 'sym', s: OPERATORS[name], style: 'op' };
    if (name in BIG) return { t: 'big', op: BIG[name] };
    if (FUNCTIONS.has(name)) return { t: 'sym', s: name, style: 'up' };
    if (name in ACCENTS) return { t: 'acc', mark: ACCENTS[name], body: this.arg() };
    if (name in LONG_ARROWS) { const under = this.optional(); return { t: 'arrow', ch: LONG_ARROWS[name], over: this.arg(), under }; }
    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': { const num = this.arg(); return { t: 'frac', num, den: this.arg() }; }
      case 'sqrt': { const index = this.optional(); return { t: 'sqrt', body: this.arg(), index }; }
      case 'mathrm': case 'operatorname': case 'mathbf': return upright(this.arg());
      case 'text': case 'textrm': case 'mbox': case 'textbf': return { t: 'sym', s: this.rawGroup(), style: 'text' };
      case 'mathit': return { t: 'sym', s: this.rawGroup(), style: 'it' };
      case 'overset': { const over = this.arg(); return { t: 'over', body: this.arg(), over }; }
      case 'underset': { const under = this.arg(); return { t: 'over', body: this.arg(), under }; }
      case 'left': {
        const open = this.delimiter();
        const body = this.row((x) => x.k === 'cmd' && x.v === 'right');
        let close = '';
        if (this.peek()?.k === 'cmd') { this.i++; close = this.delimiter(); }
        return { t: 'delim', open, close, body };
      }
      case 'right': return { t: 'row', kids: [] };
      // unknown: shown as typed
      default: return { t: 'sym', s: `\\${name}`, style: 'up' };
    }
  }

  /** The bracket after \left or \right ('.' for none). */
  delimiter(): string {
    const t = this.toks[this.i++];
    if (!t) return '';
    if (t.k === 'lbr') return '[';
    if (t.k === 'rbr') return ']';
    if (t.k === 'ch') return t.v === '.' ? '' : t.v;
    if (t.k === 'cmd') return t.v === '{' ? '{' : t.v === '}' ? '}' : t.v === '|' ? '‖' : t.v === 'langle' ? '⟨' : t.v === 'rangle' ? '⟩' : '';
    return '';
  }
}

function charNode(c: string): MathNode | null {
  if (/\s/.test(c)) return null;
  if (c === '-') return { t: 'sym', s: '−', style: 'op' };
  if (c === '*') return { t: 'sym', s: '∗', style: 'op' };
  if (c === "'") return { t: 'sym', s: '′', style: 'up' };
  if (OP_CHARS.has(c)) return { t: 'sym', s: c, style: 'op' };
  if (UPRIGHT_CHARS.test(c)) return { t: 'sym', s: c, style: 'up' };
  return { t: 'sym', s: c, style: /[A-Za-zα-ω]/.test(c) ? 'it' : 'up' };
}

/** Everything in italic made upright (\mathrm), letters next to each other joined into one word. */
function upright(n: MathNode): MathNode {
  switch (n.t) {
    case 'sym': return n.style === 'it' ? { ...n, style: 'up' } : n;
    case 'row': {
      const kids: MathNode[] = [];
      for (const k of n.kids.map(upright)) {
        const last = kids[kids.length - 1];
        if (k.t === 'sym' && k.style === 'up' && last?.t === 'sym' && last.style === 'up' && /^[A-Za-z]+$/.test(k.s) && /^[A-Za-z]+$/.test(last.s)) kids[kids.length - 1] = { ...last, s: last.s + k.s };
        else kids.push(k);
      }
      return kids.length === 1 ? kids[0] : { t: 'row', kids };
    }
    case 'scr': return { ...n, base: upright(n.base), sub: n.sub && upright(n.sub), sup: n.sup && upright(n.sup) };
    case 'frac': return { ...n, num: upright(n.num), den: upright(n.den) };
    case 'delim': case 'sqrt': case 'acc': return { ...n, body: upright(n.body) };
    case 'over': return { ...n, body: upright(n.body), over: n.over && upright(n.over), under: n.under && upright(n.under) };
    default: return n;
  }
}

/** Digits next to each other are one number (so 1.25 keeps together). */
function joinNumbers(kids: MathNode[]): MathNode {
  const out: MathNode[] = [];
  for (const k of kids) {
    const last = out[out.length - 1];
    if (k.t === 'sym' && /^[0-9.]+$/.test(k.s) && last?.t === 'sym' && /^[0-9.]+$/.test(last.s) && last.style === 'up') out[out.length - 1] = { ...last, s: last.s + k.s };
    else out.push(k);
  }
  return out.length === 1 ? out[0] : { t: 'row', kids: out };
}

/** An equation's tree from its LaTeX. Never fails: anything not understood is shown as typed. */
export function parseMath(src: string): MathNode {
  const r = new Reader(tokens(src));
  const kids: MathNode[] = [];
  // a stray closing brace is shown, and reading goes on
  for (;;) {
    const part = r.row();
    kids.push(part);
    if (r.peek()?.k !== 'close') break;
    r.i++;
    kids.push({ t: 'sym', s: '}', style: 'up' });
  }
  return kids.length === 1 ? kids[0] : { t: 'row', kids };
}

// ---------------------------------------------------------------- laying it out

/** A piece of a laid-out equation. Places are from its left end, on its baseline (y down). */
export type MathItem =
  | { k: 'text'; s: string; x: number; y: number; size: number; italic: boolean }
  /** A line (fraction bars, the top of a root) or a path of lines and curves (brackets, arrows, roots). */
  | { k: 'path'; d: PathCmd[]; width: number; fill?: boolean };
export type PathCmd = ['M' | 'L', number, number] | ['Q', number, number, number, number] | ['Z'];

export interface MathBox {
  w: number;
  /** Height above and below the baseline. */
  ascent: number;
  descent: number;
  items: MathItem[];
}

const SCRIPT = 0.7;
const empty = (): MathBox => ({ w: 0, ascent: 0, descent: 0, items: [] });

function shift(b: MathBox, dx: number, dy: number): MathItem[] {
  return b.items.map((it) => (it.k === 'text' ? { ...it, x: it.x + dx, y: it.y + dy } : { ...it, d: it.d.map((c) => moveCmd(c, dx, dy)) }));
}
function moveCmd(c: PathCmd, dx: number, dy: number): PathCmd {
  if (c[0] === 'Z') return c;
  if (c[0] === 'Q') return ['Q', c[1] + dx, c[2] + dy, c[3] + dx, c[4] + dy];
  return [c[0], c[1] + dx, c[2] + dy];
}

/** Lays equations out with one font and measure. */
export class MathLayout {
  constructor(private measure: Measure, private family: string) {}

  box(n: MathNode, size: number): MathBox {
    switch (n.t) {
      case 'row': return this.row(n.kids, size);
      case 'sym': return this.sym(n.s, n.style, size);
      case 'space': return { w: n.em * size, ascent: 0, descent: 0, items: [] };
      case 'frac': return this.frac(n, size);
      case 'scr': return this.scripts(this.box(n.base, size), n.sub, n.sup, size);
      case 'sqrt': return this.sqrt(n, size);
      case 'delim': return this.delim(n, size);
      case 'big': return this.big(n, size);
      case 'acc': return this.accent(n, size);
      case 'over': return this.stack(this.box(n.body, size), n.over, n.under, size, 0.08 * size);
      case 'arrow': return this.arrow(n, size);
    }
  }

  private text(s: string, size: number, italic: boolean): MathBox {
    const w = this.measure(s, size, this.family, italic ? 'italic' : '');
    // a little room after a sloping letter, so a script or bracket after it doesn't touch it
    return { w: w + (italic ? 0.03 * size : 0), ascent: 0.72 * size, descent: 0.22 * size, items: [{ k: 'text', s, x: 0, y: 0, size, italic }] };
  }

  private sym(s: string, style: 'it' | 'up' | 'op' | 'text', size: number): MathBox {
    if (style === 'op') {
      const b = this.text(s, size, false);
      const pad = 0.22 * size;
      return { ...b, w: b.w + 2 * pad, items: shift(b, pad, 0) };
    }
    return this.text(s, size, style === 'it');
  }

  private row(kids: MathNode[], size: number): MathBox {
    const out = empty();
    kids.forEach((k, i) => {
      // a sign at the start (or after another operator or an opening bracket) is a sign, not an operation: no space round it
      const unary = k.t === 'sym' && k.style === 'op' && (k.s === '−' || k.s === '+' || k.s === '±') && (i === 0 || isOp(kids[i - 1]));
      const b = unary ? this.text(k.s, size, false) : this.box(k, size);
      // a function name (sin, ln) is followed by a thin space
      const gap = k.t === 'sym' && k.style === 'up' && FUNCTIONS.has(k.s) && i < kids.length - 1 ? size / 6 : 0;
      out.items.push(...shift(b, out.w, 0));
      out.w += b.w + gap;
      out.ascent = Math.max(out.ascent, b.ascent);
      out.descent = Math.max(out.descent, b.descent);
    });
    return out;
  }

  /** Where fraction bars and arrows sit, above the baseline (the middle of a minus sign). */
  private axis(size: number): number { return 0.26 * size; }
  private rule(size: number): number { return Math.max(0.4, 0.05 * size); }

  private frac(n: Extract<MathNode, { t: 'frac' }>, size: number): MathBox {
    const s = Math.max(size * 0.85, 6);
    const num = this.box(n.num, s), den = this.box(n.den, s);
    const gap = 0.14 * size, th = this.rule(size), axis = this.axis(size);
    const w = Math.max(num.w, den.w) + 0.24 * size;
    const numY = -axis - th / 2 - gap - num.descent;
    const denY = -axis + th / 2 + gap + den.ascent;
    return {
      w,
      ascent: -numY + num.ascent,
      descent: denY + den.descent,
      items: [
        ...shift(num, (w - num.w) / 2, numY),
        ...shift(den, (w - den.w) / 2, denY),
        { k: 'path', d: [['M', 0.06 * size, -axis], ['L', w - 0.06 * size, -axis]], width: th },
      ],
    };
  }

  private scripts(base: MathBox, sub: MathNode | undefined, sup: MathNode | undefined, size: number): MathBox {
    const s = Math.max(size * SCRIPT, 5);
    const out: MathBox = { ...base, items: [...base.items] };
    let w = base.w;
    const x = base.w + 0.04 * size;
    if (sup) {
      const b = this.box(sup, s);
      const y = -Math.max(0.42 * size, base.ascent - 0.32 * size);
      out.items.push(...shift(b, x, y));
      out.ascent = Math.max(out.ascent, -y + b.ascent);
      w = Math.max(w, x + b.w);
    }
    if (sub) {
      const b = this.box(sub, s);
      const y = Math.max(0.2 * size, base.descent - 0.06 * size, sup ? b.ascent * 0.4 : 0);
      out.items.push(...shift(b, x, y));
      out.descent = Math.max(out.descent, y + b.descent);
      w = Math.max(w, x + b.w);
    }
    out.w = w + 0.03 * size;
    return out;
  }

  private sqrt(n: Extract<MathNode, { t: 'sqrt' }>, size: number): MathBox {
    const body = this.box(n.body, size);
    const th = this.rule(size);
    const gap = 0.12 * size;
    const top = -(body.ascent + gap);
    const bottom = body.descent;
    const sign = 0.55 * size;
    let lead = 0;
    const items: MathItem[] = [];
    let ascent = -top + th;
    if (n.index) {
      const ix = this.box(n.index, Math.max(size * 0.55, 5));
      lead = Math.max(0, ix.w - 0.3 * size);
      const y = top * 0.45 - ix.descent;
      items.push(...shift(ix, lead + 0.3 * size - ix.w, y));
      ascent = Math.max(ascent, -y + ix.ascent);
    }
    const mid = (top + bottom) * 0.35;
    items.push({ k: 'path', d: [['M', lead, mid + 0.06 * size], ['L', lead + 0.12 * size, mid], ['L', lead + 0.3 * size, bottom], ['L', lead + sign, top], ['L', lead + sign + body.w + 0.08 * size, top]], width: th });
    items.push(...shift(body, lead + sign + 0.04 * size, 0));
    return { w: lead + sign + body.w + 0.12 * size, ascent, descent: bottom + th, items };
  }

  /** A bracket drawn to span from `top` to `bottom` (y down), `w` wide, at x. */
  private bracket(ch: string, x: number, top: number, bottom: number, w: number, th: number): MathItem[] {
    const mid = (top + bottom) / 2;
    switch (ch) {
      case '(': case ')': {
        const out = ch === '(' ? x + w * 0.15 : x + w * 0.85, inn = ch === '(' ? x + w * 0.85 : x + w * 0.15;
        return [{ k: 'path', d: [['M', inn, top], ['Q', out, mid, inn, bottom]], width: th * 1.4 }];
      }
      case '[': case ']': {
        const out = ch === '[' ? x + w * 0.3 : x + w * 0.7, inn = ch === '[' ? x + w * 0.85 : x + w * 0.15;
        return [{ k: 'path', d: [['M', inn, top], ['L', out, top], ['L', out, bottom], ['L', inn, bottom]], width: th * 1.2 }];
      }
      case '{': case '}': {
        const out = ch === '{' ? x + w * 0.15 : x + w * 0.85, inn = ch === '{' ? x + w * 0.85 : x + w * 0.15, c = (inn + out) / 2;
        return [{ k: 'path', d: [['M', inn, top], ['Q', c, top, c, top + (mid - top) * 0.4], ['L', c, mid - (mid - top) * 0.25], ['Q', c, mid, out, mid], ['Q', c, mid, c, mid + (bottom - mid) * 0.25], ['L', c, bottom - (bottom - mid) * 0.4], ['Q', c, bottom, inn, bottom]], width: th * 1.2 }];
      }
      case '|': case '‖': {
        const xs = ch === '|' ? [x + w / 2] : [x + w * 0.35, x + w * 0.65];
        return xs.map((cx) => ({ k: 'path' as const, d: [['M', cx, top], ['L', cx, bottom]] as PathCmd[], width: th * 1.2 }));
      }
      case '⟨': case '⟩': {
        const out = ch === '⟨' ? x + w * 0.2 : x + w * 0.8, inn = ch === '⟨' ? x + w * 0.8 : x + w * 0.2;
        return [{ k: 'path', d: [['M', inn, top], ['L', out, mid], ['L', inn, bottom]], width: th * 1.2 }];
      }
      default: return [];
    }
  }

  private delim(n: Extract<MathNode, { t: 'delim' }>, size: number): MathBox {
    const body = this.box(n.body, size);
    const th = this.rule(size);
    const top = -Math.max(body.ascent, 0.75 * size) - 0.05 * size;
    const bottom = Math.max(body.descent, 0.22 * size) + 0.05 * size;
    // the brackets are as tall as what is in them, and get wider as they get taller
    const bw = Math.min(0.5 * size, 0.3 * size + 0.04 * (bottom - top));
    const items: MathItem[] = [];
    let x = 0;
    if (n.open) { items.push(...this.bracket(n.open, 0, top, bottom, bw, th)); x = bw + 0.04 * size; }
    items.push(...shift(body, x, 0));
    x += body.w;
    if (n.close) { items.push(...this.bracket(n.close, x + 0.04 * size, top, bottom, bw, th)); x += bw + 0.08 * size; }
    return { w: x, ascent: -top + th, descent: bottom + th, items };
  }

  private big(n: Extract<MathNode, { t: 'big' }>, size: number): MathBox {
    const integral = n.op === '∫' || n.op === '∬' || n.op === '∮';
    const s = size * (integral ? 1.6 : 1.4);
    const op = this.text(n.op, s, false);
    // centred on the axis
    const dy = -this.axis(size) + (op.ascent - op.descent) / 2 - 0.05 * size;
    const sym: MathBox = { w: op.w, ascent: op.ascent - dy, descent: op.descent + dy, items: shift(op, 0, dy) };
    const pad = (b: MathBox): MathBox => ({ ...b, w: b.w + 0.15 * size });
    if (integral) return pad(this.scripts(sym, n.sub, n.sup, size));
    return pad(this.stack(sym, n.sup, n.sub, size, 0.06 * size));
  }

  /** Something with smaller things over and under it, centred. */
  private stack(body: MathBox, over: MathNode | undefined, under: MathNode | undefined, size: number, gap: number): MathBox {
    const s = Math.max(size * SCRIPT, 5);
    const ob = over ? this.box(over, s) : null, ub = under ? this.box(under, s) : null;
    const w = Math.max(body.w, ob?.w ?? 0, ub?.w ?? 0);
    const out: MathBox = { w, ascent: body.ascent, descent: body.descent, items: shift(body, (w - body.w) / 2, 0) };
    if (ob) {
      const y = -body.ascent - gap - ob.descent;
      out.items.push(...shift(ob, (w - ob.w) / 2, y));
      out.ascent = -y + ob.ascent;
    }
    if (ub) {
      const y = body.descent + gap + ub.ascent;
      out.items.push(...shift(ub, (w - ub.w) / 2, y));
      out.descent = y + ub.descent;
    }
    return out;
  }

  private accent(n: Extract<MathNode, { t: 'acc' }>, size: number): MathBox {
    const body = this.box(n.body, size);
    const th = this.rule(size);
    const y = -body.ascent - 0.08 * size;
    const x1 = 0.08 * size, x2 = Math.max(x1 + 0.25 * size, body.w - 0.02 * size), cx = (x1 + x2) / 2;
    let mark: MathItem[];
    switch (n.mark) {
      case 'bar': mark = [{ k: 'path', d: [['M', x1, y], ['L', x2, y]], width: th }]; break;
      case 'vec': mark = [{ k: 'path', d: [['M', x1, y], ['L', x2, y], ['M', x2 - 0.15 * size, y - 0.09 * size], ['L', x2, y], ['L', x2 - 0.15 * size, y + 0.09 * size]], width: th }]; break;
      case 'hat': { const h = 0.12 * size, hw = Math.min(0.25 * size, (x2 - x1) / 2); mark = [{ k: 'path', d: [['M', cx - hw, y], ['L', cx, y - h], ['L', cx + hw, y]], width: th }]; break; }
      case 'tilde': { const h = 0.06 * size, hw = Math.min(0.25 * size, (x2 - x1) / 2); mark = [{ k: 'path', d: [['M', cx - hw, y], ['Q', cx - hw / 2, y - 2 * h, cx, y - h], ['Q', cx + hw / 2, y, cx + hw, y - 2 * h]], width: th }]; break; }
      case 'dot': case 'ddot': {
        const r = 0.05 * size, xs = n.mark === 'dot' ? [cx] : [cx - 0.1 * size, cx + 0.1 * size];
        mark = xs.map((px) => ({ k: 'path' as const, d: [['M', px - r, y - r], ['L', px + r, y - r], ['L', px + r, y + r], ['L', px - r, y + r], ['Z']] as PathCmd[], width: 0, fill: true }));
        break;
      }
    }
    return { w: body.w, ascent: body.ascent + 0.26 * size, descent: body.descent, items: [...body.items, ...mark] };
  }

  private arrow(n: Extract<MathNode, { t: 'arrow' }>, size: number): MathBox {
    const s = Math.max(size * SCRIPT, 5);
    const ob = n.over ? this.box(n.over, s) : null, ub = n.under ? this.box(n.under, s) : null;
    const len = Math.max(1.6 * size, (ob?.w ?? 0) + 0.6 * size, (ub?.w ?? 0) + 0.6 * size);
    const th = this.rule(size) * 1.1;
    const y = -this.axis(size), head = 0.2 * size, pad = 0.2 * size;
    const x1 = pad, x2 = pad + len;
    const d: PathCmd[] = [];
    const right = (yy: number) => d.push(['M', x1, yy], ['L', x2, yy], ['M', x2 - head, yy - head * 0.55], ['L', x2, yy]);
    const left = (yy: number) => d.push(['M', x2, yy], ['L', x1, yy], ['M', x1 + head, yy + head * 0.55], ['L', x1, yy]);
    switch (n.ch) {
      case '←': d.push(['M', x2, y], ['L', x1, y], ['M', x1 + head, y - head * 0.55], ['L', x1, y], ['L', x1 + head, y + head * 0.55]); break;
      case '⇌': right(y - 0.08 * size); left(y + 0.08 * size); break;
      case '↔': d.push(['M', x1, y], ['L', x2, y], ['M', x2 - head, y - head * 0.55], ['L', x2, y], ['L', x2 - head, y + head * 0.55], ['M', x1 + head, y - head * 0.55], ['L', x1, y], ['L', x1 + head, y + head * 0.55]); break;
      case '⇒': case '⇔': {
        const g = 0.07 * size;
        d.push(['M', n.ch === '⇔' ? x1 + head * 0.6 : x1, y - g], ['L', x2 - head * 0.6, y - g], ['M', n.ch === '⇔' ? x1 + head * 0.6 : x1, y + g], ['L', x2 - head * 0.6, y + g]);
        d.push(['M', x2 - head, y - head * 0.75], ['L', x2, y], ['L', x2 - head, y + head * 0.75]);
        if (n.ch === '⇔') d.push(['M', x1 + head, y - head * 0.75], ['L', x1, y], ['L', x1 + head, y + head * 0.75]);
        break;
      }
      default: d.push(['M', x1, y], ['L', x2, y], ['M', x2 - head, y - head * 0.55], ['L', x2, y], ['L', x2 - head, y + head * 0.55]);
    }
    const w = len + 2 * pad;
    const items: MathItem[] = [{ k: 'path', d, width: th }];
    let ascent = -y + 0.2 * size, descent = 0.22 * size;
    if (ob) { const oy = y - 0.18 * size - ob.descent; items.push(...shift(ob, (w - ob.w) / 2, oy)); ascent = Math.max(ascent, -oy + ob.ascent); }
    if (ub) { const uy = y + 0.18 * size + ub.ascent; items.push(...shift(ub, (w - ub.w) / 2, uy)); descent = Math.max(descent, uy + ub.descent); }
    return { w, ascent, descent, items };
  }
}

function isOp(n: MathNode): boolean {
  return (n.t === 'sym' && (n.style === 'op' || n.s === '(' || n.s === '[' || n.s === '{' || n.s === ',')) || n.t === 'arrow';
}

/** An equation laid out (with a little room either side, as in Word). */
export function layoutMath(src: string, size: number, family: string, measure: Measure): MathBox {
  const b = new MathLayout(measure, family).box(parseMath(src), size);
  const pad = 0.08 * size;
  return { w: b.w + 2 * pad, ascent: Math.max(b.ascent, 0.72 * size), descent: Math.max(b.descent, 0.22 * size), items: shift(b, pad, 0) };
}

/** Draw a laid-out equation with its baseline's left end at (x, y). */
export function drawMath(ctx: CanvasRenderingContext2D, b: MathBox, x: number, y: number, family: string, color = '#000'): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const it of b.items) {
    if (it.k === 'text') {
      ctx.font = `${it.italic ? 'italic ' : ''}${it.size}px ${family}`;
      ctx.fillText(it.s, x + it.x, y + it.y);
      continue;
    }
    ctx.beginPath();
    for (const c of it.d) {
      if (c[0] === 'M') ctx.moveTo(x + c[1], y + c[2]);
      else if (c[0] === 'L') ctx.lineTo(x + c[1], y + c[2]);
      else if (c[0] === 'Q') ctx.quadraticCurveTo(x + c[1], y + c[2], x + c[3], y + c[4]);
      else ctx.closePath();
    }
    if (it.fill) ctx.fill();
    else { ctx.lineWidth = it.width; ctx.stroke(); }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- Word's equations (OMML)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ACCENT_CHARS: Record<Accent, string> = { bar: '̅', hat: '̂', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃' };

function ommlRun(s: string, style: 'it' | 'up' | 'op' | 'text'): string {
  // Word shows letters in italic by itself; upright text says so, and words are "normal text"
  const pr = style === 'text' ? '<m:rPr><m:nor/></m:rPr>' : style === 'up' && /[A-Za-z]/.test(s) ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : '';
  return `<m:r>${pr}<m:t xml:space="preserve">${esc(s)}</m:t></m:r>`;
}

/** An equation as Word's Office Math (the inside of m:oMath). */
export function toOmml(src: string): string {
  return omml(parseMath(src));
}

function omml(n: MathNode): string {
  const e = (x: MathNode | undefined) => (x ? omml(x) : '');
  switch (n.t) {
    case 'row': {
      // a big operator takes what comes after it as what it acts on
      let out = '';
      for (let i = 0; i < n.kids.length; i++) {
        const k = n.kids[i];
        if (k.t === 'big') {
          const next = n.kids[i + 1];
          if (next) i++;
          out += nary(k, next);
        } else out += omml(k);
      }
      return out;
    }
    case 'sym': return ommlRun(n.s, n.style);
    case 'space': return n.em > 0 ? ommlRun(n.em >= 1 ? ' '.repeat(Math.round(n.em)) : n.em >= 0.25 ? ' ' : ' ', 'up') : '';
    case 'frac': return `<m:f><m:num>${e(n.num)}</m:num><m:den>${e(n.den)}</m:den></m:f>`;
    case 'scr':
      if (n.sub && n.sup) return `<m:sSubSup><m:e>${e(n.base)}</m:e><m:sub>${e(n.sub)}</m:sub><m:sup>${e(n.sup)}</m:sup></m:sSubSup>`;
      if (n.sub) return `<m:sSub><m:e>${e(n.base)}</m:e><m:sub>${e(n.sub)}</m:sub></m:sSub>`;
      return `<m:sSup><m:e>${e(n.base)}</m:e><m:sup>${e(n.sup)}</m:sup></m:sSup>`;
    case 'sqrt':
      return n.index ? `<m:rad><m:deg>${e(n.index)}</m:deg><m:e>${e(n.body)}</m:e></m:rad>` : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${e(n.body)}</m:e></m:rad>`;
    case 'delim': return `<m:d><m:dPr><m:begChr m:val="${esc(n.open)}"/><m:endChr m:val="${esc(n.close)}"/></m:dPr><m:e>${e(n.body)}</m:e></m:d>`;
    case 'big': return nary(n, undefined);
    case 'acc':
      if (n.mark === 'bar') return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${e(n.body)}</m:e></m:bar>`;
      return `<m:acc><m:accPr><m:chr m:val="${ACCENT_CHARS[n.mark]}"/></m:accPr><m:e>${e(n.body)}</m:e></m:acc>`;
    case 'over': {
      let x = e(n.body);
      if (n.under) x = `<m:limLow><m:e>${x}</m:e><m:lim>${e(n.under)}</m:lim></m:limLow>`;
      if (n.over) x = `<m:limUpp><m:e>${x}</m:e><m:lim>${e(n.over)}</m:lim></m:limUpp>`;
      return x;
    }
    case 'arrow': {
      // Word's way: the arrow as a stretching group character, with the conditions as limits
      let x = `<m:groupChr><m:groupChrPr><m:chr m:val="${n.ch}"/><m:pos m:val="top"/><m:vertJc m:val="bot"/></m:groupChrPr><m:e>${n.over ? e(n.over) : ommlRun(' ', 'up')}</m:e></m:groupChr>`;
      if (n.under) x = `<m:limLow><m:e>${x}</m:e><m:lim>${e(n.under)}</m:lim></m:limLow>`;
      return x;
    }
  }
}

function nary(k: Extract<MathNode, { t: 'big' }>, body: MathNode | undefined): string {
  const pr = `<m:naryPr><m:chr m:val="${k.op}"/>${k.op === '∫' || k.op === '∬' || k.op === '∮' ? '' : '<m:limLoc m:val="undOvr"/>'}${k.sub ? '' : '<m:subHide m:val="1"/>'}${k.sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>`;
  return `<m:nary>${pr}<m:sub>${k.sub ? omml(k.sub) : ''}</m:sub><m:sup>${k.sup ? omml(k.sup) : ''}</m:sup><m:e>${body ? omml(body) : ''}</m:e></m:nary>`;
}

// ---------------------------------------------------------------- Word's equations, read back as LaTeX

const NAME_OF = new Map<string, string>([...Object.entries(SYMBOLS), ...Object.entries(OPERATORS)].reverse().map(([k, v]) => [v, k]));
NAME_OF.set('→', 'rightarrow');
NAME_OF.set('≤', 'leq');
NAME_OF.set('≥', 'geq');
NAME_OF.set('≠', 'neq');
NAME_OF.set('ϵ', 'epsilon');
const ACCENT_OF = new Map<string, Accent>(Object.entries(ACCENT_CHARS).map(([k, v]) => [v, k as Accent]));
ACCENT_OF.set('^', 'hat').set('ˆ', 'hat').set('→', 'vec').set('˙', 'dot').set('¨', 'ddot').set('~', 'tilde').set('˜', 'tilde').set('¯', 'bar').set('̄', 'bar');
const LONG_OF = new Map(Object.entries(LONG_ARROWS).map(([k, v]) => [v, k]));

/** Text typed in an equation, as LaTeX (special characters escaped, symbols by name). */
function texChars(s: string): string {
  let out = '';
  for (const c of s) {
    if ('{}_%$#&'.includes(c)) out += `\\${c}`;
    else if (c === '\\') out += '\\backslash ';
    else if (c === '^') out += '\\hat{}';
    else if (c === '−') out += '-';
    else if (c === ' ') out += '\\quad ';
    else if (c === ' ') out += '\\ ';
    else if (c === ' ') out += '\\,';
    else if (NAME_OF.has(c)) out += `\\${NAME_OF.get(c)} `;
    else out += c;
  }
  return out;
}

const group = (s: string) => (s.length === 1 || /^\\[A-Za-z]+ ?$/.test(s) ? s.trim() : `{${s.trim()}}`);
const local = (e: Element) => e.localName;
const kidsOf = (e: Element | null | undefined) => (e ? Array.from(e.children) : []);
const childOf = (e: Element, name: string) => kidsOf(e).find((k) => local(k) === name) ?? null;
const val = (e: Element | null, name: string): string | null => {
  const c = e ? childOf(e, name) : null;
  if (!c) return null;
  for (const a of Array.from(c.attributes)) if (a.localName === 'val') return a.value;
  return '';
};

/** A Word equation (m:oMath, or m:oMathPara holding them) as LaTeX. */
export function ommlToTex(el: Element): string {
  return texOf(kidsOf(el)).replace(/\s+/g, ' ').trim();
}

function texOf(els: Element[]): string {
  let out = '';
  for (const k of els) {
    const s = texEl(k);
    // keep a command name apart from the letter after it
    if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(s)) out += ' ';
    out += s;
  }
  return out;
}

function texEl(e: Element): string {
  const part = (name: string) => texOf(kidsOf(childOf(e, name)));
  switch (local(e)) {
    case 'oMath': case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim': case 'fName': return texOf(kidsOf(e));
    case 'oMathParaPr': case 'rPr': case 'ctrlPr': case 'argPr': return '';
    case 'oMathPara': return kidsOf(e).filter((k) => local(k) === 'oMath').map((k) => texOf(kidsOf(k))).join(' \\quad ');
    case 'r': {
      const t = kidsOf(e).filter((k) => local(k) === 't').map((k) => k.textContent ?? '').join('');
      const pr = childOf(e, 'rPr');
      if (pr && childOf(pr, 'nor')) return `\\text{${t.replace(/[{}]/g, '')}}`;
      const sty = val(pr, 'sty');
      // upright words (units, element symbols) keep upright
      if ((sty === 'p' || sty === 'b') && /[A-Za-z]/.test(t)) {
        const fn = t.trim();
        if (FUNCTIONS.has(fn)) return `\\${fn} `;
        return `\\mathrm{${t.replace(/[{}]/g, '')}}`;
      }
      return texChars(t);
    }
    case 'f': return `\\frac{${part('num')}}{${part('den')}}`;
    case 'sSub': return `${group(part('e'))}_${group(part('sub'))}`;
    case 'sSup': return `${group(part('e'))}^${group(part('sup'))}`;
    case 'sSubSup': return `${group(part('e'))}_${group(part('sub'))}^${group(part('sup'))}`;
    case 'sPre': return `{}_${group(part('sub'))}^${group(part('sup'))}${group(part('e'))}`;
    case 'rad': {
      const hide = val(childOf(e, 'radPr'), 'degHide');
      const deg = part('deg');
      return hide === '1' || hide === 'on' || hide === 'true' || !deg ? `\\sqrt{${part('e')}}` : `\\sqrt[${deg}]{${part('e')}}`;
    }
    case 'd': {
      const pr = childOf(e, 'dPr');
      const beg = val(pr, 'begChr') ?? '(', end = val(pr, 'endChr') ?? ')';
      const sep = val(pr, 'sepChr') ?? '|';
      const inner = kidsOf(e).filter((k) => local(k) === 'e').map((k) => texOf(kidsOf(k))).join(texChars(sep));
      const side = (c: string) => (c === '' ? '.' : c === '{' || c === '}' ? `\\${c}` : c === '‖' ? '\\|' : c === '⟨' ? '\\langle ' : c === '⟩' ? '\\rangle ' : c);
      return `\\left${side(beg)}${inner}\\right${side(end)}`;
    }
    case 'nary': {
      const pr = childOf(e, 'naryPr');
      const chr = val(pr, 'chr') ?? '∫';
      const name = [...Object.entries(BIG)].find(([, v]) => v === chr)?.[0];
      const sub = part('sub'), sup = part('sup');
      return `${name ? `\\${name}` : texChars(chr)}${sub ? `_${group(sub)}` : ''}${sup ? `^${group(sup)}` : ''} ${part('e')}`;
    }
    case 'acc': {
      const chr = val(childOf(e, 'accPr'), 'chr') ?? '̂';
      return `\\${ACCENT_OF.get(chr) ?? 'hat'}{${part('e')}}`;
    }
    case 'bar': return `\\overline{${part('e')}}`;
    case 'groupChr': {
      const pr = childOf(e, 'groupChrPr');
      const chr = val(pr, 'chr') ?? '⏟';
      const long = LONG_OF.get(chr);
      const inner = part('e').replace(/\\quad\s*/g, '').trim();
      if (long) return `\\${long}{${inner}}`;
      return val(pr, 'pos') === 'top' ? `\\overset{${texChars(chr)}}{${inner}}` : `\\underset{${texChars(chr)}}{${inner}}`;
    }
    case 'limUpp': case 'limLow': {
      const body = part('e'), lim = part('lim');
      const up = local(e) === 'limUpp';
      // an arrow with conditions under it
      const m = /^\\(x[A-Za-z]+)\{(.*)\}$/.exec(body);
      if (m && !up) return `\\${m[1]}[${lim}]{${m[2]}}`;
      return up ? `\\overset{${lim}}{${body}}` : `\\underset{${lim}}{${body}}`;
    }
    case 'func': return `${part('fName')} ${part('e')}`;
    case 'box': case 'borderBox': case 'phant': return part('e');
    case 'eqArr': return kidsOf(e).filter((k) => local(k) === 'e').map((k) => texOf(kidsOf(k))).join(' \\quad ');
    case 'm': return kidsOf(e).filter((k) => local(k) === 'mr').map((r) => kidsOf(r).filter((k) => local(k) === 'e').map((k) => texOf(kidsOf(k))).join(' \\quad ')).join(' \\quad ');
    default: return texOf(kidsOf(e));
  }
}

/** An equation's text as it reads (for finding text, and for places that only take plain text). */
export function mathText(src: string): string {
  const flat = (n: MathNode): string => {
    switch (n.t) {
      case 'row': return n.kids.map(flat).join('');
      case 'sym': return n.style === 'op' ? ` ${n.s} ` : n.s;
      case 'space': return n.em >= 0.2 ? ' ' : '';
      case 'frac': return `(${flat(n.num)})/(${flat(n.den)})`;
      case 'scr': return `${flat(n.base)}${n.sub ? `_${flat(n.sub)}` : ''}${n.sup ? `^${flat(n.sup)}` : ''}`;
      case 'sqrt': return `√(${flat(n.body)})`;
      case 'delim': return `${n.open}${flat(n.body)}${n.close}`;
      case 'big': return n.op;
      case 'acc': return flat(n.body);
      case 'over': return flat(n.body);
      case 'arrow': return ` ${n.ch}${n.over ? ` (${flat(n.over)})` : ''} `;
    }
  };
  return flat(parseMath(src)).replace(/\s+/g, ' ').trim();
}
