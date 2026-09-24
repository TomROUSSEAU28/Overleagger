import { Project, addComponent, anchorPoints, makeContext } from '@overleagger/core';
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

  it('exports flowchart shapes and elbow connectors', () => {
    const p = Project.create('Flow');
    const ctx = makeContext(p);
    const s = p.rootSheetId;
    const a = p.addElement(s, {
      type: 'shape',
      kind: 'terminator',
      x: 0,
      y: 0,
      w: 140,
      h: 60,
      text: 'Start',
    });
    const b = p.addElement(s, {
      type: 'shape',
      kind: 'database',
      x: 0,
      y: 140,
      w: 140,
      h: 80,
      text: 'Log',
    });
    const pa = anchorPoints(a)!.s;
    const pb = anchorPoints(b)!.n;
    p.addElement(s, {
      type: 'line',
      pts: [pa.x, pa.y, pb.x + 0, pb.y],
      route: 'elbow',
      arrowEnd: true,
      text: 'Yes',
      from: { id: a.id, anchor: 's' },
      to: { id: b.id, anchor: 'n' },
    });
    const tex = sheetToCircuitikz(p, ctx, s, { standalone: true });
    expect(balanced(tex)).toBe(true);
    expect(tex).toContain('-latex');
    expect(tex).toContain('{Yes}');
    if (process.env.TIKZ_OUT) writeFileSync(`${process.env.TIKZ_OUT}/Flow.tex`, tex);
  });

  it('escapes text but keeps math', () => {
    expect(texText('10 kΩ & 50% at $V_{in}$')).toBe('10 k$\\Omega$ \\& 50\\% at $V_{in}$');
  });
});
