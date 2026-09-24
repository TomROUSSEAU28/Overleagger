import { describe, expect, it } from 'vitest';
import {
  builtinSymbols,
  defaultOptions,
  librarySymbols,
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
  // Very configurable symbols (transformers): an even sample keeps the test fast.
  const max = 800;
  if (combos.length <= max) return combos;
  const step = combos.length / max;
  return Array.from({ length: max }, (_, i) => combos[Math.floor(i * step)]!);
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

  it('transformers take 1 to 4 secondaries, center taps and inverted dots', () => {
    const t = builtinSymbols.find((s) => s.id === 'transformer')!;
    const one = resolveSymbol(t, 'IEC', {});
    expect(one.pins.map((p) => p.id)).toEqual(['p1', 'p2', 's1', 's2']);
    const four = resolveSymbol(t, 'IEC', { secondaries: 4, p: 'ct', s3: 'ct', s2Dot: 'bottom' });
    expect(four.pins.map((p) => p.id)).toEqual([
      'p1',
      'pct',
      'p2',
      's1',
      's2',
      't1',
      't2',
      'u1',
      'uct',
      'u2',
      'v1',
      'v2',
    ]);
    // The primary spans the whole stack of secondaries.
    const ys = (ids: string[]) => four.pins.filter((p) => ids.includes(p.id)).map((p) => p.y);
    expect(Math.min(...ys(['p1']))).toBeLessThanOrEqual(Math.min(...ys(['s1'])) + 1);
    const ct = resolveSymbol(
      builtinSymbols.find((s) => s.id === 'transformer-ct')!,
      'IEC',
      {},
    );
    expect(ct.pins.map((p) => p.id)).toContain('ct');
    expect(librarySymbols.some((s) => s.id === 'transformer-3w')).toBe(false);
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
