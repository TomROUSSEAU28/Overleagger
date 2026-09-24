import { HocuspocusProvider } from '@hocuspocus/provider';
import { Project, addComponent, makeContext, type Person } from '@overleagger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';

let srv: App;
let base = '';
const providers: HocuspocusProvider[] = [];

beforeAll(async () => {
  srv = await createApp({
    ...loadConfig({}),
    dbFile: ':memory:',
    autoVersionEveryMs: 60 * 60 * 1000,
  });
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = srv.app.server.address();
  base = `127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await srv.close();
});

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`http://${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function signup(name: string) {
  const r = await api<{ token: string; user: { id: string } }>(
    'POST',
    '/api/auth/signup',
    undefined,
    {
      email: `${name.toLowerCase()}@lab.test`,
      name,
      password: 'correct horse battery',
    },
  );
  expect(r.status).toBe(200);
  return r.data;
}

async function until(fn: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function connect(projectId: string, token: string) {
  const doc = new Y.Doc();
  let closed: string | null = null;
  const provider = new HocuspocusProvider({
    url: `ws://${base}/collab`,
    name: projectId,
    document: doc,
    token,
    onClose: ({ event }) => {
      // The refusal reason travels with the close event.
      if (event.reason) closed = event.reason;
    },
  });
  providers.push(provider);
  await until(() => provider.isSynced);
  return { doc, project: new Project(doc), provider, closed: () => closed };
}

const person = (id: string): Person => ({ id, name: id, color: '#000' });

describe('accounts', () => {
  it('signs up, signs in and refuses a wrong password', async () => {
    const a = await signup('Ada');
    expect((await api('GET', '/api/auth/me', a.token)).data).toMatchObject({
      user: { name: 'Ada' },
    });
    const ok = await api('POST', '/api/auth/login', undefined, {
      email: 'ada@lab.test',
      password: 'correct horse battery',
    });
    expect(ok.status).toBe(200);
    const ko = await api('POST', '/api/auth/login', undefined, {
      email: 'ada@lab.test',
      password: 'nope',
    });
    expect(ko.status).toBe(401);
    expect((await api('GET', '/api/projects')).status).toBe(401);
  });
});

describe('sharing and real-time sync', () => {
  it('invites people with roles and enforces them on every update', async () => {
    const owner = await signup('Owner');
    const bob = await signup('Bob');
    const carl = await signup('Carl');
    const vic = await signup('Vic');
    const { data } = await api<{ id: string }>('POST', '/api/projects', owner.token, {
      name: 'Buck',
    });
    const id = data.id;

    // Invite links: Bob edits, Carl comments, Vic views.
    const link = async (role: string) =>
      (
        await api<{ invite: { token: string } }>(
          'POST',
          `/api/projects/${id}/invites`,
          owner.token,
          { role },
        )
      ).data.invite.token;
    const accept = async (tok: string, invite: string) =>
      expect((await api('POST', `/api/invites/${invite}/accept`, tok)).status).toBe(200);
    await accept(bob.token, await link('editor'));
    await accept(carl.token, await link('commenter'));
    await accept(vic.token, await link('viewer'));
    expect((await api('GET', `/api/invites/nope`)).status).toBe(404);
    // Only the owner manages members.
    expect(
      (await api('POST', `/api/projects/${id}/invites`, bob.token, { role: 'viewer' })).status,
    ).toBe(403);
    expect((await api('GET', `/api/projects`, carl.token)).data).toMatchObject({
      projects: [{ id, role: 'commenter' }],
    });

    const o = await connect(id, owner.token);
    const b = await connect(id, bob.token);
    const c = await connect(id, carl.token);
    const v = await connect(id, vic.token);
    const root = o.project.rootSheetId;

    // Editor → everybody.
    addComponent(b.project, root, 'resistor', 0, 0, makeContext(b.project));
    await until(
      () => o.project.getElements(root).length === 1 && v.project.getElements(root).length === 1,
    );

    // Commenter: comments are accepted…
    c.project.addComment({ sheetId: root, x: 10, y: 10 }, person('Carl'), 'Why 10 kΩ?');
    await until(() => o.project.getComments().length === 1);
    // …but not drawing changes: the server closes the connection and ignores them.
    addComponent(c.project, root, 'capacitor', 40, 0, makeContext(c.project));
    await until(() => c.closed() === 'Commenters can only comment.');
    await new Promise((r) => setTimeout(r, 200));
    expect(o.project.getElements(root)).toHaveLength(1);

    // Viewer: read-only.
    v.project.setMeta({ name: 'Hacked' });
    await new Promise((r) => setTimeout(r, 300));
    expect(o.project.getMeta().name).toBe('Buck');

    // Owner locks the sheet: the editor cannot change it any more.
    o.project.setLock(root, person('Owner'));
    await until(() => b.project.getLock(root) !== undefined);
    addComponent(b.project, root, 'inductor', 80, 0, makeContext(b.project));
    await until(() => b.closed() === 'This sheet is locked by the owner.');
    await new Promise((r) => setTimeout(r, 200));
    expect(o.project.getElements(root)).toHaveLength(1);
  });

  it('keeps versions and restores one for everyone', async () => {
    const owner = await signup('Vera');
    const { data } = await api<{ id: string }>('POST', '/api/projects', owner.token, {
      name: 'History',
    });
    const o = await connect(data.id, owner.token);
    const root = o.project.rootSheetId;
    addComponent(o.project, root, 'resistor', 0, 0, makeContext(o.project));
    await until(() => o.provider.unsyncedChanges === 0);
    const saved = await api<{ id: string }>(
      'POST',
      `/api/projects/${data.id}/versions`,
      owner.token,
      {
        label: 'One resistor',
      },
    );
    addComponent(o.project, root, 'capacitor', 40, 0, makeContext(o.project));
    await until(() => o.provider.unsyncedChanges === 0);
    expect(o.project.getElements(root)).toHaveLength(2);
    const r = await api(
      'POST',
      `/api/projects/${data.id}/versions/${saved.data.id}/restore`,
      owner.token,
    );
    expect(r.status).toBe(200);
    await until(() => o.project.getElements(root).length === 1);
    const list = await api<{ versions: { label: string }[] }>(
      'GET',
      `/api/projects/${data.id}/versions`,
      owner.token,
    );
    expect(list.data.versions.map((v) => v.label)).toEqual([
      'Before restoring a version',
      'One resistor',
    ]);
  });

  it('uploads a local project and stores the personal library', async () => {
    const u = await signup('Uma');
    const local = Project.create('From my laptop');
    addComponent(local, local.rootSheetId, 'diode', 0, 0, makeContext(local));
    const up = await api<{ id: string }>('POST', '/api/projects', u.token, {
      state: Buffer.from(local.encodeState()).toString('base64'),
    });
    const o = await connect(up.data.id, u.token);
    expect(o.project.getMeta().name).toBe('From my laptop');
    expect(o.project.getElements(o.project.rootSheetId)).toHaveLength(1);

    const lib = {
      format: 'overleagger-library',
      version: 1,
      symbols: [],
      templates: [{ id: 't' }],
    };
    expect((await api('PUT', '/api/library', u.token, { library: lib })).status).toBe(200);
    expect((await api('GET', '/api/library', u.token)).data).toMatchObject({ library: lib });
  });
});
