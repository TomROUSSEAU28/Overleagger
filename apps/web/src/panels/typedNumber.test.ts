import { describe, expect, it } from 'vitest';
import { typedNumber } from './typedNumber';

describe('typedNumber', () => {
  it('ignores empty and invalid fields instead of writing 0 or NaN', () => {
    expect(typedNumber('')).toBeUndefined();
    expect(typedNumber('  ')).toBeUndefined();
    expect(typedNumber('abc')).toBeUndefined();
    expect(typedNumber('-')).toBeUndefined();
  });
  it('clamps to the allowed range', () => {
    expect(typedNumber('3', 4, 400)).toBe(4);
    expect(typedNumber('12.5', 4, 400)).toBe(12.5);
    expect(typedNumber('9999', 4, 400)).toBe(400);
  });
});
