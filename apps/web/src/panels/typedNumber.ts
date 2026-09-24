/**
 * Number typed in a field: undefined while the field is empty or not a number (so clearing a
 * field never writes NaN or 0 into the drawing), otherwise clamped to [min, max].
 */
export function typedNumber(raw: string, min = -Infinity, max = Infinity): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}
