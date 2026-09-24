/** Server settings, read from environment variables (see README, "Self-hosting"). */
export interface Config {
  port: number;
  host: string;
  /** SQLite file (":memory:" for tests). */
  dbFile: string;
  /** Public URL of the web app (for GitHub sign-in redirects and invite links). */
  publicUrl: string;
  /** Allowed browser origins for the API ("*" = any). */
  corsOrigins: string[] | '*';
  /** Anyone may create an account (otherwise only through an invite link). */
  allowSignup: boolean;
  github?: { clientId: string; clientSecret: string };
  /** Folder of the built web app to serve on the same origin (optional). */
  webDir?: string;
  /** Session lifetime. */
  sessionTtlMs: number;
  /** Minimum time between two automatic versions of a project. */
  autoVersionEveryMs: number;
  /** Behind a reverse proxy / tunnel: take the visitor's IP from X-Forwarded-For. */
  trustProxy: boolean;
  /** Projects a person may keep on the server (beta; an admin can change it per account). */
  maxProjects: number;
  /** Size of one project on the server (all its documents), in bytes. */
  maxProjectBytes: number;
  /** E-mail addresses of the accounts that see the admin page (lower case; "@domain" = all). */
  adminEmails: string[];
  /** Folder of the nightly database copies (none for an in-memory database). */
  backupDir?: string;
  /** Days of nightly database copies kept. */
  backupKeepDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  const cors = (env.CORS_ORIGINS ?? '*').trim();
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dbFile: env.DB_FILE ?? './data/circuit-notebook.sqlite',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    corsOrigins: cors === '*' ? '*' : cors.split(',').map((s) => s.trim()),
    allowSignup: env.ALLOW_SIGNUP !== 'false',
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}),
    ...(env.WEB_DIR ? { webDir: env.WEB_DIR } : {}),
    sessionTtlMs: Number(env.SESSION_DAYS ?? 30) * 24 * 3600 * 1000,
    autoVersionEveryMs: Number(env.AUTO_VERSION_MINUTES ?? 10) * 60 * 1000,
    trustProxy: env.TRUST_PROXY === 'true',
    maxProjects: Number(env.MAX_PROJECTS ?? 5),
    maxProjectBytes: Math.round(Number(env.MAX_PROJECT_MB ?? 5) * 1024 * 1024),
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    ...(env.BACKUP_DIR ? { backupDir: env.BACKUP_DIR } : {}),
    backupKeepDays: Number(env.BACKUP_KEEP_DAYS ?? 7),
  };
}

/** Is this e-mail an administrator's (listed, or its domain listed as "@domain")? */
export function isAdminEmail(config: Pick<Config, 'adminEmails'>, email: string): boolean {
  const e = email.toLowerCase();
  return config.adminEmails.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}
