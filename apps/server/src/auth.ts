import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** `scrypt$<salt>$<hash>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(expected, got);
}

/** Random URL-safe token (sessions, invites, ids). */
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

/** Sessions are stored hashed: a leaked database does not leak usable tokens. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const COLORS = [
  '#c0392b',
  '#2f5d9e',
  '#1e8449',
  '#b9770e',
  '#7d3c98',
  '#117a65',
  '#a04000',
  '#2e4053',
];

/** A stable, readable colour for a new user. */
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}
