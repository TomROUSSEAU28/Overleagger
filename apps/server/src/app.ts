/**
 * Circuit Notebook server: REST API (accounts, projects, members, invite links, versions, personal
 * library) + WebSocket sync (`/collab`) + optionally the web app itself.
 */
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { Project, ROLES, roleAtLeast, type Role } from '@overleagger/core';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import * as Y from 'yjs';
import { colorFor, hashPassword, hashToken, randomToken, verifyPassword } from './auth';
import { createCollab } from './collab';
import type { Config } from './config';
import { Store, type UserRow } from './db';

const publicUser = (u: UserRow) => ({ id: u.id, name: u.name, email: u.email, color: u.color });

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

export async function createApp(config: Config) {
  const store = new Store(config.dbFile);
  const collab = createCollab(store, config);
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
  }));

  app.post('/api/auth/signup', async (req) => {
    const b = (req.body ?? {}) as {
      email?: string;
      name?: string;
      password?: string;
      invite?: string;
    };
    const email = (b.email ?? '').trim().toLowerCase();
    const name = (b.name ?? '').trim() || email.split('@')[0] || 'Engineer';
    if (!EMAIL.test(email)) throw bad('Please enter a valid email address.');
    if ((b.password ?? '').length < 8) throw bad('The password needs at least 8 characters.');
    if (!config.allowSignup && !(b.invite && validInvite(b.invite)))
      throw new HttpError(403, 'Sign-up is closed on this server: ask for an invite link.');
    if (store.userByEmail(email)) throw bad('An account already exists with this email.');
    const user: UserRow = {
      id: randomToken(9),
      email,
      name: name.slice(0, 60),
      color: colorFor(email),
      password_hash: await hashPassword(b.password!),
      github_id: null,
      created_at: Date.now(),
    };
    store.createUser(user);
    return { token: newSession(user.id), user: publicUser(user) };
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
    return { token: newSession(user.id), user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req) => {
    const t = tokenOf(req);
    if (t) store.deleteSession(hashToken(t));
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: publicUser(requireUser(req)) }));

  app.patch('/api/auth/me', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as { name?: string; color?: string };
    store.updateUser(user.id, {
      ...(b.name?.trim() ? { name: b.name.trim().slice(0, 60) } : {}),
      ...(b.color && /^#[0-9a-f]{6}$/i.test(b.color) ? { color: b.color } : {}),
    });
    return { user: publicUser(store.userById(user.id)!) };
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
        updatedAt: p.updated_at,
        createdAt: p.created_at,
        thumbnail: p.thumbnail,
      })),
    };
  });

  app.post('/api/projects', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as { name?: string; state?: string };
    const id = randomToken(12);
    let state: Uint8Array;
    let name = (b.name ?? '').trim();
    if (b.state) {
      // Upload of an existing (local) project.
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, Buffer.from(b.state, 'base64'));
      } catch {
        throw bad('This is not a Circuit Notebook project.');
      }
      const p = new Project(doc);
      if (!p.rootSheetId) throw bad('This is not a Circuit Notebook project.');
      name = name || p.getMeta().name;
      state = Y.encodeStateAsUpdate(doc);
    } else {
      state = Project.create(name || 'Untitled project').encodeState();
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
    store.saveState(id, state);
    return { id };
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { role } = requireRole(req, id, 'viewer');
    const p = store.project(id)!;
    return {
      project: { id, name: p.name, updatedAt: p.updated_at, ownerId: p.owner_id },
      role,
      members: store.members(id),
    };
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
    if (!store.role(id, userId)) throw new HttpError(404, 'Not a member.');
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
    if (store.role(id, userId) === 'owner') throw bad('The owner cannot be removed.');
    store.removeMember(id, userId);
    collab.refreshAccess(id);
    return { ok: true };
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
    requireRole(req, id, 'viewer');
    const state = store.versionState(id, vid);
    if (!state) throw new HttpError(404, 'Version not found.');
    return { state: Buffer.from(state).toString('base64') };
  });

  app.post('/api/projects/:id/versions/:vid/restore', async (req) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const { user } = requireRole(req, id, 'editor');
    const ok = await collab.restoreVersion(id, vid, {
      id: user.id,
      name: user.name,
      color: user.color,
    });
    if (!ok) throw new HttpError(404, 'Version not found.');
    return { ok: true };
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
    await app.close();
    await collab.hocuspocus.flushPendingStores?.();
    store.close();
  }

  return { app, store, collab, close };
}

export type App = Awaited<ReturnType<typeof createApp>>;
export type Reply = FastifyReply;
