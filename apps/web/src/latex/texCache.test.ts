import { describe, expect, it } from 'vitest';
import { mixedToTex } from './texCache';

describe('mixedToTex', () => {
  it('keeps formulas and writes the special characters of the text outside \\text{}', () => {
    expect(mixedToTex('ripple ≤ 30 % of $I_{out}$')).toBe(
      '\\text{ripple ≤ 30 }\\%\\text{ of }I_{out}',
    );
    expect(mixedToTex('R&D_1 $x$')).toBe('\\text{R}\\&\\text{D}\\_\\text{1 }x');
  });
});
