import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project, addComponent, createBlock, makeContext } from '@overleagger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { testClient } from './helpers';

// A small server: 2 projects per account, 64 kB per project, one admin.
const dir = mkdtempSync(join(tmpdir(), 'cn-quota-'));
let srv: App;
let c: ReturnType<typeof testClient>;

beforeAll(async () => {
  srv = await createApp({
    ...loadConfig({}),
    dbFile: join(dir, 'db.sqlite'),
    autoVersionEveryMs: 60 * 60 * 1000,
    maxProjects: 2,
    maxProjectBytes: 64 * 1024,
    adminEmails: ['boss@quota.test'],
    backupKeepDays: 3,
  });
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = srv.app.server.address();
  c = testClient(`127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, 'quota.test');
});

afterAll(async () => {
  c.close();
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

const newProject = (token: string, body: object = { name: 'P' }) =>
  c.api<{ id: string; error?: string }>('POST', '/api/projects', token, body);

/** A local project with a big image (about `kb` kB). */
function bigProject(kb: number) {
  const p = Project.create('Heavy');
  p.addElement(p.rootSheetId, {
    type: 'image',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: `data:image/png;base64,${'A'.repeat(kb * 1024)}`,
  });
  return p;
}

describe('beta quotas', () => {
  it('limits the projects kept on the server, and the admin can raise the limit', async () => {
    const ana = await c.signup('Ana');
    expect((await newProject(ana.token)).status).toBe(200);
    expect((await newProject(ana.token)).status).toBe(200);
    const third = await newProject(ana.token);
    expect(third.status).toBe(403);
    expect(third.data.error).toContain('2 projects on the server');
    const me = await c.api<{ user: { quota: { projects: number; maxProjects: number } } }>(
      'GET',
      '/api/auth/me',
      ana.token,
    );
    expect(me.data.user.quota).toMatchObject({ projects: 2, maxProjects: 2 });

    // Projects shared with Ana do not count.
    const bob = await c.signup('Bob');
    const shared = await newProject(bob.token);
    const inv = await c.api<{ invite: { token: string } }>(
      'POST',
      `/api/projects/${shared.data.id}/invites`,
      bob.token,
      { role: 'editor' },
    );
    await c.api('POST', `/api/invites/${inv.data.invite.token}/accept`, ana.token);
    expect((await newProject(ana.token)).status).toBe(403);

    // The admin page is for admins; the admin gives Ana 3 projects.
    expect((await c.api('GET', '/api/admin/users', ana.token)).status).toBe(403);
    const boss = await c.signup('Boss');
    const users = await c.api<{ users: { id: string; projects: number }[] }>(
      'GET',
      '/api/admin/users',
      boss.token,
    );
    expect(users.data.users.find((u) => u.id === ana.user.id)?.projects).toBe(2);
    await c.api('PATCH', `/api/admin/users/${ana.user.id}`, boss.token, { maxProjects: 3 });
    expect((await newProject(ana.token)).status).toBe(200);
    // Deleting a project frees a place.
    await c.api('PATCH', `/api/admin/users/${ana.user.id}`, boss.token, { maxProjects: null });
    const mine = await c.api<{ projects: { id: string; role: string }[] }>(
      'GET',
      '/api/projects',
      ana.token,
    );
    for (const p of mine.data.projects.filter((x) => x.role === 'owner').slice(0, 2))
      await c.api('DELETE', `/api/projects/${p.id}`, ana.token);
    expect((await newProject(ana.token)).status).toBe(200);
    // Admins have no limit.
    for (let i = 0; i < 3; i++) expect((await newProject(boss.token)).status).toBe(200);
  });

  it('refuses a project too big, on upload and while editing', async () => {
    const eva = await c.signup('Eva');
    const upload = await newProject(eva.token, {
      state: Buffer.from(bigProject(80).encodeState()).toString('base64'),
    });
    expect(upload.status).toBe(413);
    expect(upload.data.error).toContain('too big');

    // Live: a project filled up to its limit only accepts small changes.
    const ok = await newProject(eva.token, {
      state: Buffer.from(bigProject(40).encodeState()).toString('base64'),
    });
    expect(ok.status).toBe(200);
    const o = await c.connect(ok.data.id, eva.token);
    const root = o.project.rootSheetId;
    o.project.addElement(root, {
      type: 'image',
      x: 0,
      y: 200,
      w: 100,
      h: 100,
      src: `data:image/png;base64,${'B'.repeat(40 * 1024)}`,
    });
    await c.until(() => o.closed()?.includes('This project is full') ?? false);
    const info = await c.api<{ size: { bytes: number; max: number } }>(
      'GET',
      `/api/projects/${ok.data.id}`,
      eva.token,
    );
    expect(info.data.size.max).toBe(64 * 1024);
    expect(info.data.size.bytes).toBeGreaterThan(40 * 1024);
  });

  it('gives a copy of the project without the sheets hidden from the reader', async () => {
    const own = await c.signup('Olga');
    const guest = await c.signup('Gus');
    const p = await newProject(own.token);
    const inv = await c.api<{ invite: { token: string } }>(
      'POST',
      `/api/projects/${p.data.id}/invites`,
      own.token,
      { role: 'editor' },
    );
    await c.api('POST', `/api/invites/${inv.data.invite.token}/accept`, guest.token);
    const o = await c.connect(p.data.id, own.token);
    const root = o.project.rootSheetId;
    const sub = createBlock(o.project, root, { x: 0, y: 0, w: 80, h: 60 }, 'Secret').childSheetId;
    addComponent(o.project, sub, 'resistor', 0, 0, makeContext(o.project));
    await c.until(o.settled);
    await c.api('PUT', `/api/projects/${p.data.id}/rules`, own.token, {
      sheetId: sub,
      principal: 'user',
      principalId: guest.user.id,
      level: 'hidden',
    });
    const read = async (token: string) => {
      const r = await c.api<{ state: string }>('GET', `/api/projects/${p.data.id}/state`, token);
      return Project.fromUpdate(new Uint8Array(Buffer.from(r.data.state, 'base64')));
    };
    expect((await read(own.token)).getElements(sub)).toHaveLength(1);
    const copy = await read(guest.token);
    expect(copy.hasSheet(sub)).toBe(true);
    expect(copy.getElements(sub)).toEqual([]);
  });

  it('keeps the history of a project within its budget', async () => {
    const u = await c.signup('Hugo');
    const p = await newProject(u.token);
    const add = (i: number, auto: 0 | 1, kb: number) =>
      srv.store.addVersion({
        id: `v${i}`,
        project_id: p.data.id,
        created_at: 1000 + i,
        author_id: null,
        label: auto ? null : `named ${i}`,
        auto,
        state: new Uint8Array(kb * 1024),
      });
    for (let i = 0; i < 30; i++) add(i, 1, 10);
    add(99, 0, 10);
    // At most 20 automatic versions, and no more than 100 kB in all (named ones are kept).
    srv.store.pruneAutoVersions(p.data.id, 20, 100 * 1024);
    const left = srv.store.versions(p.data.id);
    expect(left.some((v) => v.id === 'v99')).toBe(true);
    expect(left.filter((v) => v.auto).length).toBe(9);
    expect(left.find((v) => v.auto)?.id).toBe('v29');
  });

  it('keeps nightly copies of the database and removes the old ones', async () => {
    const backups = join(dir, 'backups');
    // A copy was made at start.
    await c.until(() => existsSync(backups) && readdirSync(backups).length > 0);
    // An old copy disappears at the next run.
    const old = join(backups, 'circuit-notebook-2020-01-01.sqlite');
    writeFileSync(old, 'old');
    const t = new Date('2020-01-01').getTime() / 1000;
    utimesSync(old, t, t);
    const boss = await c.api<{ token: string }>('POST', '/api/auth/login', undefined, {
      email: 'boss@quota.test',
      password: 'correct horse battery',
    });
    const r = await c.api<{ backup: { bytes: number } }>(
      'POST',
      '/api/admin/backup',
      boss.data.token,
    );
    expect(r.data.backup.bytes).toBeGreaterThan(0);
    expect(existsSync(old)).toBe(false);
    const stats = await c.api<{ users: number; backup: { at: number } }>(
      'GET',
      '/api/admin/stats',
      boss.data.token,
    );
    expect(stats.data.users).toBeGreaterThan(3);
    expect(stats.data.backup.at).toBeGreaterThan(0);
  });
});
