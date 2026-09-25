import { describe, expect, it } from 'vitest';
import { inMath, insertSnippet, SNIPPETS, toggleDollars } from './mathEdit';

const frac = SNIPPETS.find((s) => s.tex.startsWith('\\frac'))!;
const sub = SNIPPETS.find((s) => s.tex.startsWith('_'))!;
const omega = SNIPPETS.find((s) => s.tex === '\\Omega')!;

describe('math editing', () => {
  it('knows when the cursor is inside a formula', () => {
    expect(inMath('a $x$ b', 3)).toBe(true);
    expect(inMath('a $x$ b', 6)).toBe(false);
  });

  it('wraps and unwraps the selection or the line in dollars', () => {
    expect(toggleDollars('V_out = 5', 0, 5)).toEqual({ value: '$V_out$ = 5', start: 0, end: 7 });
    expect(toggleDollars('$V_out$ = 5', 0, 7)).toEqual({ value: 'V_out = 5', start: 0, end: 5 });
    // Nothing selected: the line under the cursor.
    expect(toggleDollars('title\n  x^2 ', 9, 9).value).toBe('title\n  $x^2$ ');
    expect(toggleDollars('$x^2$', 2, 2).value).toBe('x^2');
    expect(toggleDollars('', 0, 0)).toEqual({ value: '$$', start: 1, end: 1 });
  });

  it('inserts a snippet in its own formula, with the placeholder selected', () => {
    const e = insertSnippet('Gain: ', 6, 6, frac);
    expect(e.value).toBe('Gain: $\\frac{a}{b}$');
    expect(e.value.slice(e.start, e.end)).toBe('a');
  });

  it('inserts inside a formula as it is', () => {
    expect(insertSnippet('$R = 10$', 7, 7, omega).value).toBe('$R = 10\\Omega$');
  });

  it('puts the selection in the placeholder', () => {
    const e = insertSnippet('V_in', 0, 4, frac);
    expect(e.value).toBe('$\\frac{V_in}{b}$');
  });

  it('puts an index on what was just typed', () => {
    const e = insertSnippet('I = V', 5, 5, sub);
    expect(e.value).toBe('I = $V_{n}$');
    expect(e.value.slice(e.start, e.end)).toBe('n');
    expect(insertSnippet('$V$', 3, 3, sub).value).toBe('$V_{n}$');
  });
});
