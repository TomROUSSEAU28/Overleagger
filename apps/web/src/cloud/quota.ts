/** Room on the server during the beta: a few projects each, of limited size. */
import type { CloudUser } from './cloud';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
  return `${Math.round((n / 1024 / 1024 / 1024) * 10) / 10} GB`;
}

/** No room left for another project of your own on the server. */
export function serverFull(user: CloudUser | null | undefined): boolean {
  const q = user?.quota;
  return Boolean(q && q.maxProjects !== null && q.projects >= q.maxProjects);
}

export const FULL_HINT =
  'Your projects on the server are at the beta limit: move one to this computer or delete it first.';
