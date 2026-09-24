const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id (12 base-36 chars ≈ 62 bits). */
export function newId(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
}
