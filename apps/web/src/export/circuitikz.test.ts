import { Project, addComponent, makeContext } from '@overleagger/core';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seedBuckExample } from '../examples/buck';
import { sheetToCircuitikz, texText } from './circuitikz';

const balanced = (s: string) => {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '{') depth++;
    if (s[i] === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
};

describe('CircuiTikZ export', () => {
  it('exports every sheet of the example as balanced LaTeX', () => {
    const p = Project.create('Buck');
    seedBuckExample(p);
    const ctx = makeContext(p);
    for (const s of p.listSheets()) {
      const tex = sheetToCircuitikz(p, ctx, s.id, { standalone: true });
      expect(tex).toContain('\\begin{circuitikz}[european');
      expect(tex).toContain('\\end{document}');
      expect(balanced(tex), s.name).toBe(true);
      expect(tex).not.toMatch(/NaN|undefined/);
      // Set TIKZ_OUT=dir to write the files and compile them with pdflatex.
      if (process.env.TIKZ_OUT)
        writeFileSync(`${process.env.TIKZ_OUT}/${s.name.replace(/\W+/g, '-')}.tex`, tex);
    }
  });

  it('uses native bipoles for simple parts and exact paths for the others', () => {
    const p = Project.create('t');
    const ctx = makeContext(p);
    addComponent(p, p.rootSheetId, 'resistor', 0, 0, ctx);
    addComponent(p, p.rootSheetId, 'mosfet', 100, 0, ctx);
    const tex = sheetToCircuitikz(p, ctx, p.rootSheetId, { standalone: false });
    expect(tex).toContain('to[R]');
    expect(tex).toContain('$R_{1}$');
    expect(tex).not.toContain('nmos');
    expect(tex.split('\n').filter((l) => l.includes('\\draw')).length).toBeGreaterThan(4);
  });

  it('escapes text but keeps math', () => {
    expect(texText('10 kΩ & 50% at $V_{in}$')).toBe('10 k$\\Omega$ \\& 50\\% at $V_{in}$');
  });
});
