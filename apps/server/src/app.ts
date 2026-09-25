/**
 * Circuit Notebook server: REST API (accounts, projects, members, invite links, versions, personal
 * library) + WebSocket sync (`/collab`) + optionally the web app itself.
 */
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import {
  Project,
  ROLES,
  encodeBundle,
  roleAtLeast,
  type ProjectParts,
  type Role,
  type SheetLevel,
} from '@overleagger/core';
import { randomInt } from 'node:crypto';
import { statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { colorFor, hashPassword, hashToken, randomToken, verifyPassword } from './auth';
import type { Transporter } from 'nodemailer';
import { startBackups } from './backup';
import { createCollab, visibleParts } from './collab';
import { isAdminEmail, type Config } from './config';
import { Store, type CodePurpose, type UserRow } from './db';
import { createMailer } from './mail';

const publicUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  color: u.color,
  handle: u.handle ?? '',
});
/** "@Tom.Martin " → "tom.martin" if it is a valid handle. */
const HANDLE = /^[a-z0-9][a-z0-9._]{2,19}$/;
const cleanHandle = (s: string) => s.trim().replace(/^@/, '').toLowerCase();

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const bad = (msg: string) => new HttpError(400, msg);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createApp(
  config: Config,
  /** Tests: where e-mails go instead of the SMTP server. */
  options: { mailTransport?: Transporter } = {},
) {
  const store = new Store(config.dbFile);
  const mailer = createMailer(config, options.mailTransport);
  const collab = createCollab(store, config);
  const backups = startBackups(store.db, config);
  // Contact messages are kept one year at most (privacy policy), old codes are dropped: checked
  // at start, then daily.
  const pruneMessages = () => {
    store.pruneMessages(Date.now() - config.messageKeepDays * 24 * 3600 * 1000);
    store.pruneCodes();
  };
  pruneMessages();
  const pruneTimer = setInterval(pruneMessages, 24 * 3600 * 1000);
  pruneTimer.unref();
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024 * 1024,
    // Behind Cloudflare / Caddy every request comes from the proxy: read the real IP instead.
    trustProxy: config.trustProxy,
  });

  await app.register(cors, {
    origin: config.corsOrigins === '*' ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  await app.register(websocket);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err instanceof HttpError ? err.status : (err.statusCode ?? 500);
    if (status >= 500) console.error(err);
    void reply.status(status).send({ error: status >= 500 ? 'Server error' : err.message });
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const tokenOf = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  };
  const userOf = (req: FastifyRequest) => {
    const t = tokenOf(req);
    return t ? store.sessionUser(hashToken(t)) : undefined;
  };
  const requireUser = (req: FastifyRequest) => {
    const u = userOf(req);
    if (!u) throw new HttpError(401, 'Please sign in.');
    return u;
  };
  const requireRole = (req: FastifyRequest, projectId: string, min: Role) => {
    const user = requireUser(req);
    const role = store.role(projectId, user.id);
    if (!role) throw new HttpError(404, 'Project not found.');
    if (!roleAtLeast(role, min)) throw new HttpError(403, 'You do not have the rights for this.');
    return { user, role };
  };
  const isAdmin = (u: UserRow) => isAdminEmail(config, u.email);
  const requireAdmin = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (!isAdmin(u)) throw new HttpError(403, 'This page is for the administrators.');
    return u;
  };
  /** Projects a person may keep on the server (no limit for admins). */
  const maxProjectsOf = (u: UserRow) =>
    isAdmin(u) ? Infinity : (u.max_projects ?? config.maxProjects);
  /** The signed-in person: public profile, plus their rights and room on the server. */
  const account = (u: UserRow) => {
    const used = store.ownedUsage(u.id);
    const max = maxProjectsOf(u);
    return {
      ...publicUser(u),
      admin: isAdmin(u),
      /** GitHub-only accounts confirm with their e-mail instead. */
      hasPassword: Boolean(u.password_hash),
      quota: {
        projects: used.projects,
        maxProjects: Number.isFinite(max) ? max : null,
        bytes: used.bytes,
        maxProjectBytes: isAdmin(u) ? null : config.maxProjectBytes,
      },
    };
  };
  const newSession = (userId: string) => {
    const token = randomToken(32);
    store.createSession(hashToken(token), userId, config.sessionTtlMs);
    return token;
  };
  const validInvite = (token: string) => {
    const inv = store.invite(token);
    if (!inv) return undefined;
    if (inv.expires_at && inv.expires_at < Date.now()) return undefined;
    if (inv.max_uses && inv.uses >= inv.max_uses) return undefined;
    return inv;
  };

  // Very small brute-force protection for sign-in.
  const failures = new Map<string, { n: number; until: number }>();
  const checkThrottle = (key: string) => {
    const f = failures.get(key);
    if (f && f.n >= 8 && f.until > Date.now())
      throw new HttpError(429, 'Too many attempts, try again in a few minutes.');
  };
  const fail = (key: string) => {
    const f = failures.get(key);
    const n = f && f.until > Date.now() ? f.n + 1 : 1;
    failures.set(key, { n, until: Date.now() + 15 * 60 * 1000 });
  };

  // -------------------------------------------------------------------------
  // Accounts
  // -------------------------------------------------------------------------

  app.get('/api/health', async () => ({
    ok: true,
    name: 'Circuit Notebook',
    signup: config.allowSignup,
    github: Boolean(config.github),
    /** New accounts confirm their e-mail with a code. */
    verify: config.verifyEmail,
    /** A forgotten password can be changed with a code sent by e-mail. */
    reset: Boolean(config.smtp),
    ...(config.contactEmail ? { contact: config.contactEmail } : {}),
  }));

  // Contact form of the homepage (no account needed) --------------------------

  const contactTimes = new Map<string, number[]>();
  app.post('/api/contact', async (req) => {
    const b = (req.body ?? {}) as {
      name?: string;
      email?: string;
      message?: string;
      website?: string;
    };
    // Robots fill every field, people don't see this one: pretend it worked.
    if (b.website) return { ok: true };
    const name = (b.name ?? '').trim().slice(0, 100);
    const email = (b.email ?? '').trim().toLowerCase();
    const body = (b.message ?? '').trim();
    if (!EMAIL.test(email) || email.length > 200)
      throw bad('Please enter your e-mail address, so I can answer.');
    if (body.length < 5) throw bad('Your message is empty.');
    if (body.length > 4000) throw bad('Your message is too long (4000 characters at most).');
    const now = Date.now();
    const recent = (contactTimes.get(req.ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 5)
      throw new HttpError(429, 'Too many messages from here, try again in an hour.');
    contactTimes.set(req.ip, [...recent, now]);
    const user = userOf(req);
    store.addMessage({
      id: randomToken(9),
      name,
      email,
      body,
      ...(user ? { userId: user.id } : {}),
    });
    // The message is saved in any case; the e-mail is a bonus.
    await mailer.sendContact({ name, email, body }).catch((e: unknown) => {
      console.error('Could not e-mail a contact message:', e);
      return false;
    });
    return { ok: true };
  });

  // E-mailed codes (confirm an address, choose a new password) -------------

  const CODE_TTL = 30 * 60 * 1000;
  const codeHash = (email: string, code: string) => hashToken(`${email}|${code}`);
  const codeSends = new Map<string, number[]>();
  /**
   * E-mail a new 6-digit code. Signing up, a code asked again too soon is refused; for a new
   * password it is silently not sent again (that would tell whether the account exists).
   */
  const sendCode = async (
    req: FastifyRequest,
    email: string,
    purpose: CodePurpose,
    data?: string,
  ) => {
    const prev = store.code(email, purpose);
    if (prev && Date.now() - prev.sent_at < 30_000) {
      if (purpose === 'reset') return;
      throw new HttpError(429, 'A code was just sent: wait a little before asking for another.');
    }
    const now = Date.now();
    const recent = (codeSends.get(req.ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 10)
      throw new HttpError(429, 'Too many e-mails asked from here, try again in an hour.');
    codeSends.set(req.ip, [...recent, now]);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    store.setCode({ email, purpose, codeHash: codeHash(email, code), data, ttlMs: CODE_TTL });
    const sent = await mailer.sendCode(email, purpose, code).catch((e: unknown) => {
      console.error('Could not e-mail a code:', e);
      return false;
    });
    if (!sent) {
      store.deleteCode(email, purpose);
      throw new HttpError(502, 'The e-mail could not be sent. Please try again in a moment.');
    }
  };
  /** Check a code typed by the person (5 tries); it can be used once. */
  const useCode = (email: string, purpose: CodePurpose, code: string) => {
    const row = store.code(email, purpose);
    if (!row) throw bad('This code has expired: ask for a new one.');
    if (codeHash(email, code.replace(/\s/g, '')) !== row.code_hash) {
      if (store.codeAttempt(email, purpose) >= 5) {
        store.deleteCode(email, purpose);
        throw bad('Too many wrong codes: ask for a new one.');
      }
      throw bad('Wrong code: check the last e-mail we sent you.');
    }
    store.deleteCode(email, purpose);
    return row;
  };

  const createAccount = (email: string, name: string, passwordHash: string) => {
    const user: UserRow = {
      id: randomToken(9),
      email,
      name: name.slice(0, 60),
      color: colorFor(email),
      password_hash: passwordHash,
      github_id: null,
      created_at: Date.now(),
    };
    store.createUser(user);
    return { token: newSession(user.id), user: account(user) };
  };

  /**
   * Create an account. When the server sends e-mails, the account waits for the code sent to
   * the address (`{ verify: true }`, then /api/auth/signup/verify); asking again sends a new one.
   */
  app.post('/api/auth/signup', async (req) => {
    const b = (req.body ?? {}) as {
      email?: string;
      name?: string;
      password?: string;
      invite?: string;
    };
    const email = (b.email ?? '').trim().toLowerCase();
    const name = (b.name ?? '').trim() || email.split('@')[0] || 'Engineer';
    if (!EMAIL.test(email) || email.length > 200) throw bad('Please enter a valid email address.');
    if ((b.password ?? '').length < 8) throw bad('The password needs at least 8 characters.');
    if (!config.allowSignup && !(b.invite && validInvite(b.invite)))
      throw new HttpError(403, 'Sign-up is closed on this server: ask for an invite link.');
    if (store.userByEmail(email)) throw bad('An account already exists with this email.');
    const passwordHash = await hashPassword(b.password!);
    if (!config.verifyEmail) return createAccount(email, name, passwordHash);
    const pending = { name, passwordHash, ...(b.invite ? { invite: b.invite } : {}) };
    await sendCode(req, email, 'signup', JSON.stringify(pending));
    return { verify: true, email };
  });

  app.post('/api/auth/signup/verify', async (req) => {
    const b = (req.body ?? {}) as { email?: string; code?: string };
    const email = (b.email ?? '').trim().toLowerCase();
    const row = useCode(email, 'signup', b.code ?? '');
    const d = JSON.parse(row.data ?? '{}') as {
      name?: string;
      passwordHash?: string;
      invite?: string;
    };
    if (!d.passwordHash) throw bad('This code has expired: ask for a new one.');
    if (!config.allowSignup && !(d.invite && validInvite(d.invite)))
      throw new HttpError(403, 'Sign-up is closed on this server: ask for an invite link.');
    if (store.userByEmail(email)) throw bad('An account already exists with this email.');
    return createAccount(email, d.name || email.split('@')[0] || 'Engineer', d.passwordHash);
  });

  /** Forgot my password: a code by e-mail (the answer is the same for an unknown address). */
  app.post('/api/auth/forgot', async (req) => {
    if (!config.smtp)
      throw new HttpError(
        503,
        'This server cannot send e-mails: ask its administrator to reset your password.',
      );
    const email = ((req.body as { email?: string } | undefined)?.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw bad('Please enter a valid email address.');
    if (store.userByEmail(email)) await sendCode(req, email, 'reset');
    return { ok: true };
  });

  /** A new password with the e-mailed code: signs out everywhere else, signs in here. */
  app.post('/api/auth/reset', async (req) => {
    const b = (req.body ?? {}) as { email?: string; code?: string; password?: string };
    const email = (b.email ?? '').trim().toLowerCase();
    if ((b.password ?? '').length < 8) throw bad('The password needs at least 8 characters.');
    useCode(email, 'reset', b.code ?? '');
    const user = store.userByEmail(email);
    if (!user) throw bad('This code has expired: ask for a new one.');
    store.setPassword(user.id, await hashPassword(b.password!));
    store.deleteSessionsOf(user.id);
    failures.delete(`${req.ip}|${email}`);
    return { token: newSession(user.id), user: account(store.userById(user.id)!) };
  });

  app.post('/api/auth/login', async (req) => {
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const email = (b.email ?? '').trim().toLowerCase();
    const key = `${req.ip}|${email}`;
    checkThrottle(key);
    const user = store.userByEmail(email);
    if (!user || !(await verifyPassword(b.password ?? '', user.password_hash))) {
      fail(key);
      throw new HttpError(401, 'Wrong email or password.');
    }
    failures.delete(key);
    return { token: newSession(user.id), user: account(user) };
  });

  /** Delete my account: the password (or, for a GitHub account, the e-mail) confirms it. */
  app.delete('/api/auth/me', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as { password?: string; email?: string };
    const key = `${req.ip}|delete|${user.id}`;
    checkThrottle(key);
    const ok = user.password_hash
      ? await verifyPassword(b.password ?? '', user.password_hash)
      : (b.email ?? '').trim().toLowerCase() === user.email;
    if (!ok) {
      fail(key);
      throw new HttpError(
        403,
        user.password_hash ? 'Wrong password.' : 'Type the e-mail address of your account.',
      );
    }
    failures.delete(key);
    for (const id of store.deleteUser(user.id)) collab.refreshAccess(id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req) => {
    const t = tokenOf(req);
    if (t) store.deleteSession(hashToken(t));
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: account(requireUser(req)) }));

  app.patch('/api/auth/me', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as { name?: string; color?: string; handle?: string };
    if (b.handle !== undefined) {
      const h = cleanHandle(b.handle);
      if (!HANDLE.test(h))
        throw bad('A username has 3 to 20 characters: letters, digits, dots or underscores.');
      const taken = store.userByHandle(h);
      if (taken && taken.id !== user.id) throw bad(`@${h} is already taken.`);
      store.setHandle(user.id, h);
    }
    store.updateUser(user.id, {
      ...(b.name?.trim() ? { name: b.name.trim().slice(0, 60) } : {}),
      ...(b.color && /^#[0-9a-f]{6}$/i.test(b.color) ? { color: b.color } : {}),
    });
    return { user: account(store.userById(user.id)!) };
  });

  // GitHub sign-in (only when GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are set).
  const oauthStates = new Map<string, { returnTo: string; until: number }>();
  const safeReturn = (url: string | undefined) => {
    const allowed = [config.publicUrl, ...(config.corsOrigins === '*' ? [] : config.corsOrigins)];
    try {
      const u = new URL(url ?? '');
      if (allowed.some((a) => new URL(a).origin === u.origin)) return `${u.origin}${u.pathname}`;
    } catch {
      // fall through
    }
    return `${config.publicUrl}/`;
  };

  app.get('/api/auth/github', async (req, reply) => {
    if (!config.github) throw new HttpError(404, 'GitHub sign-in is not configured.');
    const q = req.query as { return?: string };
    const state = randomToken(16);
    oauthStates.set(state, { returnTo: safeReturn(q.return), until: Date.now() + 10 * 60 * 1000 });
    const redirect = `${config.publicUrl}/api/auth/github/callback`;
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', config.github.clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  app.get('/api/auth/github/callback', async (req, reply) => {
    if (!config.github) throw new HttpError(404, 'GitHub sign-in is not configured.');
    const q = req.query as { code?: string; state?: string };
    const st = q.state ? oauthStates.get(q.state) : undefined;
    if (q.state) oauthStates.delete(q.state);
    if (!st || st.until < Date.now() || !q.code) throw bad('Sign-in expired, please try again.');
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code: q.code,
      }),
    });
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw bad('GitHub refused the sign-in.');
    const gh = { Authorization: `Bearer ${access_token}`, 'User-Agent': 'CircuitNotebook' };
    const profile = (await (
      await fetch('https://api.github.com/user', { headers: gh })
    ).json()) as {
      id: number;
      login: string;
      name?: string;
    };
    const emails = (await (
      await fetch('https://api.github.com/user/emails', { headers: gh })
    ).json()) as { email: string; primary: boolean; verified: boolean }[];
    const email = (
      emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
    )?.email?.toLowerCase();
    let user = store.userByGithub(String(profile.id));
    if (!user && email) {
      user = store.userByEmail(email);
      if (user) store.setGithubId(user.id, String(profile.id));
    }
    if (!user) {
      if (!config.allowSignup) throw new HttpError(403, 'Sign-up is closed on this server.');
      const mail = email ?? `${profile.login}@users.noreply.github.com`;
      user = {
        id: randomToken(9),
        email: mail,
        name: profile.name || profile.login,
        color: colorFor(mail),
        password_hash: null,
        github_id: String(profile.id),
        created_at: Date.now(),
      };
      store.createUser(user);
    }
    return reply.redirect(`${st.returnTo}#/auth?token=${newSession(user.id)}`);
  });

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  app.get('/api/projects', async (req) => {
    const user = requireUser(req);
    return {
      projects: store.projectsOf(user.id).map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        owner: p.owner_name,
        ...(p.team_name ? { team: p.team_name } : {}),
        updatedAt: p.updated_at,
        createdAt: p.created_at,
        thumbnail: p.thumbnail,
      })),
    };
  });

  app.post('/api/projects', async (req) => {
    const user = requireUser(req);
    const max = maxProjectsOf(user);
    if (store.ownedUsage(user.id).projects >= max)
      throw new HttpError(
        403,
        `You already have ${max} projects on the server (the beta limit). Move one to this computer or delete it, or keep this one on your computer.`,
      );
    const b = (req.body ?? {}) as { name?: string; state?: string };
    const id = randomToken(12);
    let parts: ProjectParts;
    let name = (b.name ?? '').trim();
    if (b.state) {
      // Upload of an existing (local) project.
      let p: Project;
      try {
        p = Project.fromUpdate(new Uint8Array(Buffer.from(b.state, 'base64')));
      } catch {
        throw bad('This is not a Circuit Notebook project.');
      }
      if (!p.rootSheetId || !p.hasSheet(p.rootSheetId))
        throw bad('This is not a Circuit Notebook project.');
      name = name || p.getMeta().name;
      parts = p.encodeParts();
      p.destroy();
      const bytes =
        parts.root.length + [...parts.sheets.values()].reduce((a, x) => a + x.length, 0);
      if (!isAdmin(user) && bytes > config.maxProjectBytes)
        throw new HttpError(
          413,
          `This project is too big for the server (${Math.round((bytes / 1048576) * 10) / 10} MB, ${Math.round(config.maxProjectBytes / 1048576)} MB at most). Keep it on your computer, or remove large images first.`,
        );
    } else {
      parts = Project.create(name || 'Untitled project').encodeParts();
    }
    const now = Date.now();
    store.createProject({
      id,
      name: name || 'Untitled project',
      owner_id: user.id,
      created_at: now,
      updated_at: now,
      thumbnail: null,
    });
    store.saveParts(id, parts);
    return { id };
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { role } = requireRole(req, id, 'viewer');
    const p = store.project(id)!;
    const size = collab.projectSize(id);
    return {
      project: { id, name: p.name, updatedAt: p.updated_at, ownerId: p.owner_id },
      size: { bytes: size.bytes, max: Number.isFinite(size.max) ? size.max : null },
      role,
      members: store.members(id),
      teams: store.projectTeams(id),
      // The owner sees every rule; the others, the ones that apply to them.
      rules: role === 'owner' ? store.rules(id) : store.rulesFor(id, requireUser(req).id),
    };
  });

  /** Rights of a person or a team on one sheet (and its sub-sheets); `level: null` removes it. */
  app.put('/api/projects/:id/rules', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireRole(req, id, 'owner');
    const b = (req.body ?? {}) as {
      sheetId?: string;
      principal?: 'user' | 'team';
      principalId?: string;
      level?: SheetLevel | null;
    };
    if (!b.sheetId || !b.principalId || (b.principal !== 'user' && b.principal !== 'team'))
      throw bad('Which sheet, and for whom?');
    if (b.level !== null && !['editor', 'commenter', 'viewer', 'hidden'].includes(b.level ?? ''))
      throw bad('Unknown access level.');
    if (b.principal === 'user') {
      if (b.principalId === user.id) throw bad('The owner always has every right.');
      if (!store.role(id, b.principalId)) throw bad('This person has no access to the project.');
    } else if (!store.projectTeams(id).some((t) => t.id === b.principalId))
      throw bad('This team has no access to the project.');
    store.setRule(id, {
      sheetId: b.sheetId,
      principal: b.principal,
      principalId: b.principalId,
      level: b.level ?? null,
    });
    collab.refreshAccess(id);
    return { rules: store.rules(id) };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    requireRole(req, id, 'editor');
    const b = (req.body ?? {}) as { thumbnail?: string };
    if (typeof b.thumbnail === 'string' && b.thumbnail.length < 400_000)
      store.updateProject(id, { thumbnail: b.thumbnail });
    return { ok: true };
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    requireRole(req, id, 'owner');
    collab.refreshAccess(id);
    store.deleteProject(id);
    return { ok: true };
  });

  // Members ------------------------------------------------------------------

  app.patch('/api/projects/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { user } = requireRole(req, id, 'owner');
    const role = (req.body as { role?: Role } | undefined)?.role;
    if (!role || !ROLES.includes(role)) throw bad('Unknown role.');
    if (!store.directRole(id, userId)) throw new HttpError(404, 'Not a member.');
    if (userId === user.id) throw bad('Give the ownership to someone else first.');
    if (role === 'owner') {
      // Transfer: the previous owner stays as an editor.
      store.setMember(id, user.id, 'editor');
      store.db.prepare('UPDATE projects SET owner_id = ? WHERE id = ?').run(userId, id);
    }
    store.setMember(id, userId, role);
    collab.refreshAccess(id);
    return { members: store.members(id) };
  });

  app.delete('/api/projects/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const me = requireUser(req);
    const myRole = store.role(id, me.id);
    if (!myRole) throw new HttpError(404, 'Project not found.');
    const leaving = userId === me.id;
    if (!leaving && myRole !== 'owner')
      throw new HttpError(403, 'Only the owner can remove people.');
    if (leaving && !store.directRole(id, me.id))
      throw bad('You have access through a team: leave the team, or ask the owner.');
    if (store.role(id, userId) === 'owner') throw bad('The owner cannot be removed.');
    store.removeMember(id, userId);
    collab.refreshAccess(id);
    return { ok: true };
  });

  /** Add a friend to the project directly (no link needed). */
  app.post('/api/projects/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireRole(req, id, 'owner');
    const b = (req.body ?? {}) as { userId?: string; role?: Role };
    const role = b.role ?? 'editor';
    if (!ROLES.includes(role) || role === 'owner') throw bad('Unknown role.');
    if (!b.userId || !store.areFriends(user.id, b.userId))
      throw bad('You can add your friends directly; send an invite link to anyone else.');
    store.setMember(id, b.userId, role);
    collab.refreshAccess(id);
    return { members: store.members(id) };
  });

  /** Give one of your teams access: every member, now and later. */
  app.post('/api/projects/:id/teams', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireRole(req, id, 'owner');
    const b = (req.body ?? {}) as { teamId?: string; role?: Role };
    const role = b.role ?? 'editor';
    if (!ROLES.includes(role) || role === 'owner') throw bad('Unknown role.');
    if (!b.teamId || !store.isTeamMember(b.teamId, user.id))
      throw bad('You can only add teams you belong to.');
    store.setProjectTeam(id, b.teamId, role);
    collab.refreshAccess(id);
    return { teams: store.projectTeams(id) };
  });

  app.patch('/api/projects/:id/teams/:teamId', async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    requireRole(req, id, 'owner');
    const role = (req.body as { role?: Role } | undefined)?.role;
    if (!role || !ROLES.includes(role) || role === 'owner') throw bad('Unknown role.');
    store.setProjectTeam(id, teamId, role);
    collab.refreshAccess(id);
    return { teams: store.projectTeams(id) };
  });

  app.delete('/api/projects/:id/teams/:teamId', async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    requireRole(req, id, 'owner');
    store.removeProjectTeam(id, teamId);
    collab.refreshAccess(id);
    return { teams: store.projectTeams(id) };
  });

  // Friends ------------------------------------------------------------------

  // A few dozen requests an hour is plenty for a person, and stops anyone from probing accounts.
  const requests = new Map<string, number[]>();
  const limitRequests = (userId: string) => {
    const now = Date.now();
    const recent = (requests.get(userId) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 30) throw new HttpError(429, 'Too many requests, try again later.');
    requests.set(userId, [...recent, now]);
  };

  app.get('/api/friends', async (req) => store.friendsOf(requireUser(req).id));

  /** Send a request by exact email or @username; accepts it if they already asked you. */
  app.post('/api/friends', async (req) => {
    const me = requireUser(req);
    limitRequests(me.id);
    const who = ((req.body as { who?: string } | undefined)?.who ?? '').trim();
    if (!who) throw bad('Type the e-mail address or the @username of your friend.');
    const other =
      who.includes('@') && !who.startsWith('@')
        ? store.userByEmail(who.toLowerCase())
        : store.userByHandle(cleanHandle(who));
    if (!other) throw new HttpError(404, `Nobody found with “${who}”. Check the spelling.`);
    if (other.id === me.id) throw bad('That is you!');
    const f = store.friendship(me.id, other.id);
    if (f?.status === 'accepted') throw bad(`${other.name} is already your friend.`);
    if (f && f.user_id === other.id) store.acceptFriend(me.id, other.id);
    else store.requestFriend(me.id, other.id);
    return store.friendsOf(me.id);
  });

  app.post('/api/friends/:userId/accept', async (req) => {
    const me = requireUser(req);
    const { userId } = req.params as { userId: string };
    store.acceptFriend(me.id, userId);
    return store.friendsOf(me.id);
  });

  /** Decline a request, cancel yours, or remove a friend. */
  app.delete('/api/friends/:userId', async (req) => {
    const me = requireUser(req);
    const { userId } = req.params as { userId: string };
    store.removeFriend(me.id, userId);
    return store.friendsOf(me.id);
  });

  // Teams --------------------------------------------------------------------

  const refreshTeam = (teamId: string) => {
    for (const p of store.teamProjects(teamId)) collab.refreshAccess(p);
  };
  const ownTeam = (req: FastifyRequest) => {
    const me = requireUser(req);
    const { id } = req.params as { id: string };
    const team = store.team(id);
    if (!team || !store.isTeamMember(id, me.id)) throw new HttpError(404, 'Team not found.');
    return { me, team, isOwner: team.owner_id === me.id };
  };

  app.get('/api/teams', async (req) => ({ teams: store.teamsOf(requireUser(req).id) }));

  app.post('/api/teams', async (req) => {
    const me = requireUser(req);
    const name = ((req.body as { name?: string } | undefined)?.name ?? '').trim().slice(0, 60);
    if (!name) throw bad('Give the team a name.');
    store.createTeam({ id: randomToken(9), name, owner_id: me.id, created_at: Date.now() });
    return { teams: store.teamsOf(me.id) };
  });

  app.patch('/api/teams/:id', async (req) => {
    const { me, team, isOwner } = ownTeam(req);
    if (!isOwner) throw new HttpError(403, 'Only the creator of the team can rename it.');
    const name = ((req.body as { name?: string } | undefined)?.name ?? '').trim().slice(0, 60);
    if (name) store.renameTeam(team.id, name);
    return { teams: store.teamsOf(me.id) };
  });

  app.delete('/api/teams/:id', async (req) => {
    const { me, team, isOwner } = ownTeam(req);
    if (!isOwner) throw new HttpError(403, 'Only the creator of the team can delete it.');
    const projects = store.teamProjects(team.id);
    store.deleteTeam(team.id);
    for (const p of projects) collab.refreshAccess(p);
    return { teams: store.teamsOf(me.id) };
  });

  /** The creator adds one of their friends. */
  app.post('/api/teams/:id/members', async (req) => {
    const { me, team, isOwner } = ownTeam(req);
    if (!isOwner) throw new HttpError(403, 'Only the creator of the team can add people.');
    const userId = (req.body as { userId?: string } | undefined)?.userId;
    if (!userId || !store.areFriends(me.id, userId))
      throw bad('Add your friends to a team (send them a friend request first).');
    store.addTeamMember(team.id, userId);
    refreshTeam(team.id);
    return { teams: store.teamsOf(me.id) };
  });

  /** The creator removes someone, or a member leaves. */
  app.delete('/api/teams/:id/members/:userId', async (req) => {
    const { me, team, isOwner } = ownTeam(req);
    const { userId } = req.params as { userId: string };
    if (userId !== me.id && !isOwner)
      throw new HttpError(403, 'Only the creator of the team can remove people.');
    if (userId === team.owner_id) throw bad('The creator cannot leave: delete the team instead.');
    store.removeTeamMember(team.id, userId);
    refreshTeam(team.id);
    return { teams: store.teamsOf(me.id) };
  });

  // Invite links -------------------------------------------------------------

  const inviteView = (i: ReturnType<Store['invites']>[number]) => ({
    token: i.token,
    role: i.role,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    maxUses: i.max_uses,
    uses: i.uses,
  });

  app.get('/api/projects/:id/invites', async (req) => {
    const { id } = req.params as { id: string };
    requireRole(req, id, 'owner');
    return { invites: store.invites(id).map(inviteView) };
  });

  app.post('/api/projects/:id/invites', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireRole(req, id, 'owner');
    const b = (req.body ?? {}) as { role?: Role; days?: number; maxUses?: number };
    const role = b.role ?? 'editor';
    if (!ROLES.includes(role) || role === 'owner') throw bad('Invite links cannot make owners.');
    const token = randomToken(18);
    store.createInvite({
      token,
      project_id: id,
      role,
      created_by: user.id,
      created_at: Date.now(),
      expires_at: b.days ? Date.now() + b.days * 24 * 3600 * 1000 : null,
      max_uses: b.maxUses ?? null,
      uses: 0,
    });
    return { invite: inviteView(store.invite(token)!) };
  });

  app.delete('/api/invites/:token', async (req) => {
    const { token } = req.params as { token: string };
    const inv = store.invite(token);
    if (!inv) return { ok: true };
    requireRole(req, inv.project_id, 'owner');
    store.deleteInvite(token);
    return { ok: true };
  });

  /** What an invite link opens (shown before accepting, no account needed). */
  app.get('/api/invites/:token', async (req) => {
    const { token } = req.params as { token: string };
    const inv = validInvite(token);
    if (!inv) throw new HttpError(404, 'This invite link is not valid any more.');
    const p = store.project(inv.project_id)!;
    const by = store.userById(inv.created_by);
    return { projectName: p.name, role: inv.role, invitedBy: by?.name ?? 'someone' };
  });

  app.post('/api/invites/:token/accept', async (req) => {
    const { token } = req.params as { token: string };
    const user = requireUser(req);
    const inv = validInvite(token);
    if (!inv) throw new HttpError(404, 'This invite link is not valid any more.');
    const current = store.role(inv.project_id, user.id);
    // Never downgrade someone who already has more rights.
    if (!current || !roleAtLeast(current, inv.role))
      store.setMember(inv.project_id, user.id, inv.role);
    store.useInvite(token);
    if (current) collab.refreshAccess(inv.project_id);
    return { projectId: inv.project_id, role: store.role(inv.project_id, user.id) };
  });

  // Versions -----------------------------------------------------------------

  app.get('/api/projects/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    requireRole(req, id, 'viewer');
    return {
      versions: store.versions(id).map((v) => ({
        id: v.id,
        createdAt: v.created_at,
        author: v.author_name,
        label: v.label,
        auto: Boolean(v.auto),
        size: v.size,
      })),
    };
  });

  app.post('/api/projects/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireRole(req, id, 'editor');
    const label = ((req.body as { label?: string } | undefined)?.label ?? '').trim();
    const vid = await collab.saveVersion(id, user.id, label.slice(0, 120) || 'Saved version');
    return { id: vid };
  });

  app.get('/api/projects/:id/versions/:vid', async (req) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const { user, role } = requireRole(req, id, 'viewer');
    const state = store.versionState(id, vid);
    if (!state) throw new HttpError(404, 'Version not found.');
    // Without the sheets hidden from this person.
    const p = Project.fromUpdate(new Uint8Array(state));
    const parts = visibleParts(p.encodeParts(), role, store.rulesFor(id, user.id));
    p.destroy();
    return { state: Buffer.from(encodeBundle(parts)).toString('base64') };
  });

  app.post('/api/projects/:id/versions/:vid/restore', async (req) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const { user, role } = requireRole(req, id, 'editor');
    // Restoring rewrites every sheet: not for someone whose rights differ from sheet to sheet.
    if (role !== 'owner' && store.rulesFor(id, user.id).length)
      throw new HttpError(403, 'Only the owner can restore a version of this project.');
    const ok = await collab.restoreVersion(id, vid, {
      id: user.id,
      name: user.name,
      color: user.color,
    });
    if (!ok) throw new HttpError(404, 'Version not found.');
    return { ok: true };
  });

  /** The whole project (without the sheets hidden from this person): to keep a local copy. */
  app.get('/api/projects/:id/state', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = requireRole(req, id, 'viewer');
    const parts = visibleParts(collab.currentParts(id), role, store.rulesFor(id, user.id));
    return { state: Buffer.from(encodeBundle(parts)).toString('base64') };
  });

  // Administration --------------------------------------------------------------

  app.get('/api/admin/stats', async (req) => {
    requireAdmin(req);
    const week = Date.now() - 7 * 24 * 3600 * 1000;
    const disk = await statfs(config.dbFile === ':memory:' ? '.' : dirname(config.dbFile))
      .then((st) => ({ free: st.bavail * st.bsize, total: st.blocks * st.bsize }))
      .catch(() => null);
    const dbBytes = (() => {
      try {
        return config.dbFile === ':memory:' ? 0 : statSync(config.dbFile).size;
      } catch {
        return 0;
      }
    })();
    const last = backups.last();
    return {
      ...store.stats(week),
      unreadMessages: store.unreadMessages(),
      dbBytes,
      disk,
      backup: last ? { at: last.at, bytes: last.bytes } : null,
      limits: { maxProjects: config.maxProjects, maxProjectBytes: config.maxProjectBytes },
      biggest: store.biggestProjects(),
    };
  });

  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    return {
      users: store.usersWithUsage().map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        handle: u.handle ?? '',
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in,
        projects: u.projects,
        bytes: u.bytes,
        maxProjects: u.max_projects,
        admin: isAdminEmail(config, u.email),
      })),
      defaultMaxProjects: config.maxProjects,
    };
  });

  /** Change how many projects an account may keep on the server (null: the default). */
  app.patch('/api/admin/users/:userId', async (req) => {
    requireAdmin(req);
    const { userId } = req.params as { userId: string };
    const b = (req.body ?? {}) as { maxProjects?: number | null };
    if (!store.userById(userId)) throw new HttpError(404, 'Unknown account.');
    const v = b.maxProjects;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000))
      throw bad('Give a whole number of projects (or nothing for the default).');
    store.setMaxProjects(userId, v);
    return { ok: true };
  });

  app.get('/api/admin/messages', async (req) => {
    requireAdmin(req);
    return {
      messages: store.messages().map((m) => ({
        id: m.id,
        at: m.created_at,
        name: m.name,
        email: m.email,
        body: m.body,
        read: m.read_at !== null,
      })),
    };
  });

  app.patch('/api/admin/messages/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    store.markMessageRead(id, (req.body as { read?: boolean } | undefined)?.read !== false);
    return { ok: true };
  });

  app.delete('/api/admin/messages/:id', async (req) => {
    requireAdmin(req);
    store.deleteMessage((req.params as { id: string }).id);
    return { ok: true };
  });

  /** Make the nightly database copy now. */
  app.post('/api/admin/backup', async (req) => {
    requireAdmin(req);
    await backups.run();
    const last = backups.last();
    return { backup: last ? { at: last.at, bytes: last.bytes } : null };
  });

  // Personal library (symbols + templates of the account) ----------------------

  app.get('/api/library', async (req) => {
    const user = requireUser(req);
    const lib = store.library(user.id);
    return lib ? { library: JSON.parse(lib.data), updatedAt: lib.updated_at } : { library: null };
  });

  app.put('/api/library', async (req) => {
    const user = requireUser(req);
    const b = req.body as { library?: unknown };
    if (!b?.library || typeof b.library !== 'object') throw bad('Missing library.');
    store.saveLibrary(user.id, JSON.stringify(b.library));
    return { ok: true, updatedAt: Date.now() };
  });

  // -------------------------------------------------------------------------
  // Real-time sync
  // -------------------------------------------------------------------------

  app.get('/collab', { websocket: true }, (socket, req) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { headers });
    const conn = collab.hocuspocus.handleConnection(socket, request);
    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data;
      conn.handleMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    socket.on('close', (code: number, reason: Buffer) =>
      conn.handleClose({ code, reason: reason.toString() }),
    );
  });

  // -------------------------------------------------------------------------
  // The web app itself (single container deployments)
  // -------------------------------------------------------------------------

  if (config.webDir)
    await app.register(fastifyStatic, { root: config.webDir, index: 'index.html', redirect: true });

  async function close() {
    backups.stop();
    clearInterval(pruneTimer);
    await app.close();
    await collab.hocuspocus.flushPendingStores?.();
    store.close();
  }

  return { app, store, collab, close };
}

export type App = Awaited<ReturnType<typeof createApp>>;
export type Reply = FastifyReply;
