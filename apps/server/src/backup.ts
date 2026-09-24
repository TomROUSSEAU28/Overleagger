/**
 * Nightly copy of the database, next to it (`<data>/backups/`). The copy is made by SQLite
 * itself, so it is always a clean, complete file — even while people are editing. With Hetzner
 * Backups (a snapshot of the whole server every night), each snapshot then holds several clean
 * copies of the last days.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, type DatabaseSync } from 'node:sqlite';
import type { Config } from './config';

const DAY = 24 * 3600 * 1000;
const NAME = /^circuit-notebook-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export interface Backups {
  /** When the last copy was made (ms), if any. */
  last(): { at: number; file: string; bytes: number } | undefined;
  /** Make today's copy now (replaces it if it exists) and remove the old ones. */
  run(): Promise<void>;
  stop(): void;
}

export function backupDirFor(config: Config): string | undefined {
  if (config.backupDir) return config.backupDir;
  if (config.dbFile === ':memory:') return undefined;
  return join(dirname(config.dbFile), 'backups');
}

export function startBackups(db: DatabaseSync, config: Config): Backups {
  const dir = backupDirFor(config);
  const list = () => {
    if (!dir) return [];
    try {
      return readdirSync(dir)
        .filter((f) => NAME.test(f))
        .map((f) => {
          const st = statSync(join(dir, f));
          return { file: f, at: st.mtimeMs, bytes: st.size };
        })
        .sort((a, b) => b.at - a.at);
    } catch {
      return [];
    }
  };
  let running: Promise<void> | null = null;
  const run = async () => {
    if (!dir || running) return running ?? undefined;
    running = (async () => {
      mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      await backup(db, join(dir, `circuit-notebook-${day}.sqlite`));
      const keepFrom = Date.now() - config.backupKeepDays * DAY;
      for (const b of list()) if (b.at < keepFrom) unlinkSync(join(dir, b.file));
    })()
      .catch((e: unknown) => console.error('Nightly database copy failed:', e))
      .finally(() => {
        running = null;
      });
    return running;
  };
  // A copy at start when today's is missing, then one a day.
  const today = () => list()[0]?.file.includes(new Date().toISOString().slice(0, 10));
  if (dir && !today()) void run();
  const timer = dir ? setInterval(() => void run(), DAY) : undefined;
  timer?.unref();
  return {
    last: () => list()[0],
    run,
    stop: () => clearInterval(timer),
  };
}
