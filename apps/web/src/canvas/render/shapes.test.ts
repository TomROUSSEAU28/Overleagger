import { describe, expect, it } from 'vitest';
import { wrapText } from './shapes';
import { newTrace, sampleTrace } from './waveforms';

describe('wrapText', () => {
  it('never splits a formula', () => {
    const lines = wrapText(
      'Ripple: $\\Delta i_L = \\frac{V_{in} D (1-D)}{L f_s}$ at full load',
      120,
      14,
    );
    for (const l of lines) expect((l.match(/\$/g) ?? []).length % 2).toBe(0);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('waveforms', () => {
  it('samples PWM between 0 and 1 with the right duty cycle', () => {
    const s = sampleTrace(newTrace('pwm', { periods: 1, duty: 0.25 }), 400);
    const vals = s.filter((_, i) => i % 2 === 1);
    const high = vals.filter((v) => v === 1).length / vals.length;
    expect(high).toBeGreaterThan(0.22);
    expect(high).toBeLessThan(0.28);
    expect(Math.min(...vals)).toBe(0);
  });

  it('keeps a DC ripple around its mean', () => {
    const s = sampleTrace(newTrace('ripple', { ripple: 0.2 }), 200);
    const vals = s.filter((_, i) => i % 2 === 1);
    expect(Math.max(...vals)).toBeCloseTo(1.2, 1);
    expect(Math.min(...vals)).toBeCloseTo(0.8, 1);
  });

  it('settles step responses at 1', () => {
    for (const k of ['step1', 'step2'] as const) {
      const s = sampleTrace(newTrace(k, { tau: 0.05, zeta: 0.5 }), 200);
      expect(s[s.length - 1]).toBeCloseTo(1, 1);
    }
  });
});
