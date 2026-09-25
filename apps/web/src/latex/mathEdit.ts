/**
 * Editing helpers for text with `$…$` math: wrap text in dollars, and insert LaTeX snippets at
 * the cursor. Pure functions: they return the new text and the new selection.
 */

export interface Edit {
  value: string;
  start: number;
  end: number;
}

export interface Snippet {
  /** What the button shows. */
  label: string;
  /** Tooltip. */
  title: string;
  tex: string;
  /** Placeholder in `tex` selected after insertion (and replaced by the selected text, if any). */
  pick?: string;
}

/** Is `pos` inside `$…$` (an odd number of dollars before it)? */
export function inMath(value: string, pos: number): boolean {
  let n = 0;
  for (let i = 0; i < pos; i++) if (value[i] === '$') n++;
  return n % 2 === 1;
}

/**
 * Put `$…$` around the selection, or take them away if it already has them. With nothing
 * selected, the whole line under the cursor is wrapped (or unwrapped).
 */
export function toggleDollars(value: string, start: number, end: number): Edit {
  let a = start;
  let b = end;
  if (a === b) {
    a = value.lastIndexOf('\n', a - 1) + 1;
    const nl = value.indexOf('\n', b);
    b = nl < 0 ? value.length : nl;
    // Leave the spaces around the line where they are.
    while (a < b && value[a] === ' ') a++;
    while (b > a && value[b - 1] === ' ') b--;
  }
  const text = value.slice(a, b);
  if (text.length >= 2 && text.startsWith('$') && text.endsWith('$')) {
    const inner = text.slice(1, -1);
    return { value: value.slice(0, a) + inner + value.slice(b), start: a, end: a + inner.length };
  }
  // Dollars just outside the selection: take them away.
  if (value[a - 1] === '$' && value[b] === '$' && a !== b) {
    return {
      value: value.slice(0, a - 1) + text + value.slice(b + 1),
      start: a - 1,
      end: b - 1,
    };
  }
  if (!text) {
    // Empty line: open a formula and put the cursor in it.
    return { value: value.slice(0, a) + '$$' + value.slice(b), start: a + 1, end: a + 1 };
  }
  return { value: value.slice(0, a) + `$${text}$` + value.slice(b), start: a, end: b + 2 };
}

/**
 * Insert a snippet at the cursor. The selected text (if any) goes in its placeholder; outside a
 * formula the snippet gets its own `$…$`. The placeholder is selected, ready to be typed over.
 */
export function insertSnippet(value: string, start: number, end: number, s: Snippet): Edit {
  const selected = value.slice(start, end);
  let tex = s.tex;
  let pickAt = -1;
  let pickLen = 0;
  if (s.pick) {
    // The placeholder is an argument: look for it after a brace first (`a` of \frac is no `a`).
    const inBraces = tex.indexOf(`{${s.pick}`);
    pickAt = inBraces >= 0 ? inBraces + 1 : tex.indexOf(s.pick);
    if (selected && pickAt >= 0) {
      tex = tex.slice(0, pickAt) + selected + tex.slice(pickAt + s.pick.length);
      pickLen = selected.length;
    } else pickLen = s.pick.length;
  }
  // The snippet starts at `offset` in `out`: select its placeholder, or put the cursor after it.
  const place = (out: string, offset: number): Edit =>
    pickAt >= 0 && !selected
      ? { value: out, start: offset + pickAt, end: offset + pickAt + pickLen }
      : { value: out, start: offset + tex.length, end: offset + tex.length };
  const after = value.slice(end);
  let before = value.slice(0, start);
  if (inMath(value, start)) return place(before + tex + after, before.length);
  // An index or exponent goes on what was just typed: `V|` → `$V_{n}$`, `$V$|` → `$V_{n}$`.
  let base = '';
  if (/^[_^]/.test(tex)) {
    if (before.endsWith('$') && inMath(value, start - 1)) {
      const head = before.slice(0, -1);
      return place(`${head}${tex}$${after}`, head.length);
    }
    base = /[A-Za-z0-9]+$/.exec(before)?.[0] ?? '';
    before = before.slice(0, before.length - base.length);
  }
  return place(`${before}$${base}${tex}$${after}`, before.length + 1 + base.length);
}

/** The main snippets (always shown). */
export const SNIPPETS: Snippet[] = [
  { label: 'a⁄b', title: 'Fraction  \\frac{a}{b}', tex: '\\frac{a}{b}', pick: 'a' },
  { label: 'x²', title: 'Superscript  x^{2}', tex: '^{2}', pick: '2' },
  { label: 'xₙ', title: 'Subscript  x_{n}', tex: '_{n}', pick: 'n' },
  { label: '√', title: 'Square root  \\sqrt{x}', tex: '\\sqrt{x}', pick: 'x' },
  { label: 'x̄', title: 'Bar  \\overline{x}', tex: '\\overline{x}', pick: 'x' },
  { label: 'Ω', title: 'Ohm  \\Omega', tex: '\\Omega' },
  { label: 'µ', title: 'Micro  \\mu', tex: '\\mu' },
  { label: 'ω', title: 'Omega  \\omega', tex: '\\omega' },
  { label: 'Δ', title: 'Delta  \\Delta', tex: '\\Delta' },
  { label: '·', title: 'Times (dot)  \\cdot', tex: '\\cdot ' },
];

/** More snippets, in a drop-down grid. */
export const MORE_SNIPPETS: { name: string; items: Snippet[] }[] = [
  {
    name: 'Greek',
    items: [
      ['α', 'alpha'],
      ['β', 'beta'],
      ['γ', 'gamma'],
      ['δ', 'delta'],
      ['ε', 'varepsilon'],
      ['η', 'eta'],
      ['θ', 'theta'],
      ['λ', 'lambda'],
      ['π', 'pi'],
      ['ρ', 'rho'],
      ['σ', 'sigma'],
      ['τ', 'tau'],
      ['φ', 'varphi'],
      ['ψ', 'psi'],
      ['Φ', 'Phi'],
      ['Σ', 'Sigma'],
    ].map(([label, name]) => ({ label: label!, title: `\\${name}`, tex: `\\${name!} ` })),
  },
  {
    name: 'Symbols',
    items: [
      { label: '±', title: '\\pm', tex: '\\pm ' },
      { label: '×', title: '\\times', tex: '\\times ' },
      { label: '≈', title: '\\approx', tex: '\\approx ' },
      { label: '≤', title: '\\leq', tex: '\\leq ' },
      { label: '≥', title: '\\geq', tex: '\\geq ' },
      { label: '≠', title: '\\neq', tex: '\\neq ' },
      { label: '∞', title: '\\infty', tex: '\\infty ' },
      { label: '→', title: '\\rightarrow', tex: '\\rightarrow ' },
      { label: '∠', title: '\\angle', tex: '\\angle ' },
      { label: '°', title: 'Degrees  ^\\circ', tex: '^\\circ ' },
      { label: '∂', title: '\\partial', tex: '\\partial ' },
      { label: '∥', title: 'In parallel  \\parallel', tex: '\\parallel ' },
    ],
  },
  {
    name: 'Structures',
    items: [
      { label: 'x̂', title: 'Hat  \\hat{x}', tex: '\\hat{x}', pick: 'x' },
      { label: 'x⃗', title: 'Vector  \\vec{x}', tex: '\\vec{x}', pick: 'x' },
      { label: 'ẋ', title: 'Derivative  \\dot{x}', tex: '\\dot{x}', pick: 'x' },
      { label: 'ⁿ√', title: 'n-th root  \\sqrt[n]{x}', tex: '\\sqrt[n]{x}', pick: 'x' },
      { label: 'd/dt', title: 'Derivative  \\frac{d}{dt}', tex: '\\frac{d}{dt}' },
      { label: '∫', title: 'Integral  \\int_{a}^{b}', tex: '\\int_{0}^{T} ', pick: '0' },
      { label: '∑', title: 'Sum  \\sum_{k=0}^{n}', tex: '\\sum_{k=0}^{n} ', pick: 'k=0' },
      {
        label: '( )',
        title: 'Big parentheses  \\left( … \\right)',
        tex: '\\left( x \\right)',
        pick: 'x',
      },
      { label: '|x|', title: 'Modulus  \\left| x \\right|', tex: '\\left| x \\right|', pick: 'x' },
      { label: 'Aa', title: 'Upright text  \\mathrm{…}', tex: '\\mathrm{max}', pick: 'max' },
      { label: 'e^', title: 'Exponential  e^{-t/\\tau}', tex: 'e^{-t/\\tau}', pick: '-t/\\tau' },
      { label: 'j', title: 'Complex  j\\omega', tex: 'j\\omega ' },
    ],
  },
];
