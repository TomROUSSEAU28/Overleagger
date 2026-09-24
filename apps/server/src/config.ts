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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  const cors = (env.CORS_ORIGINS ?? '*').trim();
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dbFile: env.DB_FILE ?? './data/schemaboard.sqlite',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    corsOrigins: cors === '*' ? '*' : cors.split(',').map((s) => s.trim()),
    allowSignup: env.ALLOW_SIGNUP !== 'false',
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}),
    ...(env.WEB_DIR ? { webDir: env.WEB_DIR } : {}),
    sessionTtlMs: Number(env.SESSION_DAYS ?? 30) * 24 * 3600 * 1000,
    autoVersionEveryMs: Number(env.AUTO_VERSION_MINUTES ?? 10) * 60 * 1000,
  };
}
