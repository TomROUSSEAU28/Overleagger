import { describe, expect, it } from 'vitest';
import {
  builtinSymbols,
  defaultOptions,
  resolveSymbol,
  searchSymbols,
  type OptionValue,
  type Primitive,
  type Standard,
  type SymbolDef,
} from '../index';

/** Every combination of enum/bool options (numbers keep their default). */
function optionCombos(sym: SymbolDef): Record<string, OptionValue>[] {
  let combos: Record<string, OptionValue>[] = [defaultOptions(sym)];
  for (const o of sym.options ?? []) {
    const values: OptionValue[] =
      o.type === 'bool'
        ? [true, false]
        : o.type === 'enum'
          ? o.choices.map((c) => c.value)
          : [o.default, o.max];
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [o.key]: v })));
  }
  return combos;
}

function numbersOf(p: Primitive): number[] {
  switch (p.k) {
    case 'line':
      return [p.x1, p.y1, p.x2, p.y2];
    case 'poly':
      return p.pts;
    case 'circle':
      return [p.cx, p.cy, p.r];
    case 'arc':
      return [p.cx, p.cy, p.r, p.a0, p.a1];
    case 'rect':
      return [p.x, p.y, p.w, p.h];
    case 'text':
      return [p.x, p.y];
    case 'path':
      return [];
  }
}

const standards: Standard[] = ['IEC', 'ANSI'];

describe('symbol library', () => {
  it('has unique ids', () => {
    const ids = builtinSymbols.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a large library', () => {
    expect(builtinSymbols.length).toBeGreaterThan(90);
  });

  for (const sym of builtinSymbols) {
    it(`${sym.id} builds valid graphics in every standard and option combination`, () => {
      for (const standard of standards) {
        for (const opts of optionCombos(sym)) {
          const g = resolveSymbol(sym, standard, opts);
          expect(g.prims.length).toBeGreaterThan(0);
          for (const p of g.prims)
            for (const n of numbersOf(p)) expect(Number.isFinite(n)).toBe(true);
          const pinIds = g.pins.map((p) => p.id);
          expect(new Set(pinIds).size, `duplicate pin ids ${pinIds.join(',')}`).toBe(pinIds.length);
          const pos = g.pins.map((p) => `${p.x},${p.y}`);
          expect(new Set(pos).size, `overlapping pins ${pos.join(' ')}`).toBe(pos.length);
          for (const p of g.pins) {
            expect(Number.isInteger(p.x), `${sym.id} pin ${p.id} x=${p.x} off grid`).toBe(true);
            expect(Number.isInteger(p.y), `${sym.id} pin ${p.id} y=${p.y} off grid`).toBe(true);
          }
          expect(g.bbox.w).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe('MOSFET variants', () => {
  const mos = builtinSymbols.find((s) => s.id === 'mosfet')!;
  it('draws the body diode only when asked', () => {
    const withDiode = resolveSymbol(mos, 'IEC', { bodyDiode: true });
    const without = resolveSymbol(mos, 'IEC', { bodyDiode: false });
    expect(withDiode.prims.length).toBeGreaterThan(without.prims.length);
  });
  it('moves the pins outside the circle', () => {
    const plain = resolveSymbol(mos, 'IEC', { circle: false });
    const circled = resolveSymbol(mos, 'IEC', { circle: true });
    const d = (g: typeof plain) => g.pins.find((p) => p.id === 'd')!;
    expect(Math.abs(d(circled).y)).toBeGreaterThan(Math.abs(d(plain).y));
  });
  it('puts the P-channel source on top', () => {
    const p = resolveSymbol(mos, 'IEC', { channel: 'p' });
    expect(p.pins.find((x) => x.id === 's')!.y).toBeLessThan(0);
    expect(p.pins.find((x) => x.id === 'd')!.y).toBeGreaterThan(0);
  });
  it('exposes a bulk pin in 4-terminal mode', () => {
    const g = resolveSymbol(mos, 'IEC', { terminals: '4' });
    expect(g.pins.map((p) => p.id)).toContain('b');
  });
});

describe('search', () => {
  it('finds symbols by keyword', () => {
    expect(searchSymbols('body diode').map((s) => s.id)).toContain('mosfet');
    expect(searchSymbols('transfer').map((s) => s.id)).toContain('ctl-tf');
    expect(searchSymbols('resistor')[0]!.id).toBe('resistor');
  });
});
