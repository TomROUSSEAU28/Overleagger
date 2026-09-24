import { Project, addComponent, createBlock, makeContext, type Person } from '@overleagger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { testClient } from './helpers';

let srv: App;
let base = '';
let client: ReturnType<typeof testClient>;

beforeAll(async () => {
  srv = await createApp({
    ...loadConfig({}),
    dbFile: ':memory:',
    autoVersionEveryMs: 60 * 60 * 1000,
  });
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = srv.app.server.address();
  base = `127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  client = testClient(base);
});

afterAll(async () => {
  client.close();
  await srv.close();
});

const api = <T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) => client.api<T>(method, path, token, body);
const signup = (name: string) => client.signup(name);
const until = (fn: () => boolean, ms?: number) => client.until(fn, ms);
const connect = (projectId: string, token: string) => client.connect(projectId, token);

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
    await until(o.settled);
    const saved = await api<{ id: string }>(
      'POST',
      `/api/projects/${data.id}/versions`,
      owner.token,
      {
        label: 'One resistor',
      },
    );
    addComponent(o.project, root, 'capacitor', 40, 0, makeContext(o.project));
    await until(o.settled);
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

describe('friends and teams', () => {
  it('finds people by @username or e-mail, and needs both sides to agree', async () => {
    const zoe = await signup('Zoe');
    const yan = await signup('Yan');
    const me = await api<{ user: { handle: string } }>('GET', '/api/auth/me', yan.token);
    expect(me.data.user.handle).toBe('yan');

    // Unknown person, yourself.
    expect((await api('POST', '/api/friends', zoe.token, { who: '@nobody.here' })).status).toBe(
      404,
    );
    expect((await api('POST', '/api/friends', zoe.token, { who: '@zoe' })).status).toBe(400);

    // Request by handle: pending on both sides.
    const sent = await api<{ outgoing: { id: string }[] }>('POST', '/api/friends', zoe.token, {
      who: '@Yan',
    });
    expect(sent.data.outgoing.map((u) => u.id)).toEqual([yan.user.id]);
    const inbox = await api<{ incoming: { id: string }[]; friends: unknown[] }>(
      'GET',
      '/api/friends',
      yan.token,
    );
    expect(inbox.data.incoming.map((u) => u.id)).toEqual([zoe.user.id]);
    expect(inbox.data.friends).toEqual([]);

    // Accept → friends; the answer never shows e-mail addresses.
    const ok = await api<{ friends: Record<string, unknown>[] }>(
      'POST',
      `/api/friends/${zoe.user.id}/accept`,
      yan.token,
    );
    expect(ok.data.friends.map((u) => u.id)).toEqual([zoe.user.id]);
    expect(ok.data.friends[0]).not.toHaveProperty('email');

    // Asking back by e-mail when they already asked you accepts at once.
    const xia = await signup('Xia');
    await api('POST', '/api/friends', xia.token, { who: 'zoe@lab.test' });
    const back = await api<{ friends: { id: string }[] }>('POST', '/api/friends', zoe.token, {
      who: '@xia',
    });
    expect(back.data.friends.map((u) => u.id).sort()).toEqual([xia.user.id, yan.user.id].sort());

    // Handle change: unique and valid.
    expect((await api('PATCH', '/api/auth/me', xia.token, { handle: '@yan' })).status).toBe(400);
    expect((await api('PATCH', '/api/auth/me', xia.token, { handle: 'x' })).status).toBe(400);
    expect((await api('PATCH', '/api/auth/me', xia.token, { handle: 'xia.lab' })).status).toBe(200);
  });

  it('shares a project with a friend or a whole team, and follows team changes', async () => {
    const owner = await signup('Olga');
    const pal = await signup('Pablo');
    const late = await signup('Lina');
    const stranger = await signup('Sam');
    for (const u of [pal, late]) {
      await api('POST', '/api/friends', owner.token, { who: `@${u === pal ? 'pablo' : 'lina'}` });
      await api('POST', `/api/friends/${owner.user.id}/accept`, u.token);
    }
    const { data: proj } = await api<{ id: string }>('POST', '/api/projects', owner.token, {
      name: 'Team project',
    });

    // Only friends can be added directly.
    expect(
      (
        await api('POST', `/api/projects/${proj.id}/members`, owner.token, {
          userId: stranger.user.id,
        })
      ).status,
    ).toBe(400);
    const added = await api<{ members: { id: string; role: string }[] }>(
      'POST',
      `/api/projects/${proj.id}/members`,
      owner.token,
      { userId: pal.user.id, role: 'viewer' },
    );
    expect(added.data.members.find((m) => m.id === pal.user.id)?.role).toBe('viewer');

    // A team with Pablo, given edit rights: the best role wins.
    const t = await api<{ teams: { id: string }[] }>('POST', '/api/teams', owner.token, {
      name: 'Lab group 4',
    });
    const teamId = t.data.teams[0]!.id;
    await api('POST', `/api/teams/${teamId}/members`, owner.token, { userId: pal.user.id });
    expect(
      (await api('POST', `/api/teams/${teamId}/members`, owner.token, { userId: stranger.user.id }))
        .status,
    ).toBe(400);
    await api('POST', `/api/projects/${proj.id}/teams`, owner.token, { teamId, role: 'editor' });
    const palView = await api<{ role: string; teams: { name: string }[] }>(
      'GET',
      `/api/projects/${proj.id}`,
      pal.token,
    );
    expect(palView.data.role).toBe('editor');
    expect(palView.data.teams.map((x) => x.name)).toEqual(['Lab group 4']);

    // Someone who joins the team later gets the project too, and loses it on leaving.
    expect((await api('GET', `/api/projects/${proj.id}`, late.token)).status).toBe(404);
    await api('POST', `/api/teams/${teamId}/members`, owner.token, { userId: late.user.id });
    const list = await api<{ projects: { id: string; role: string; team?: string }[] }>(
      'GET',
      '/api/projects',
      late.token,
    );
    expect(list.data.projects.find((p) => p.id === proj.id)).toMatchObject({
      role: 'editor',
      team: 'Lab group 4',
    });
    await api('DELETE', `/api/teams/${teamId}/members/${late.user.id}`, late.token);
    expect((await api('GET', `/api/projects/${proj.id}`, late.token)).status).toBe(404);

    // Removing the team from the project: Pablo keeps his own viewer role.
    await api('DELETE', `/api/projects/${proj.id}/teams/${teamId}`, owner.token);
    expect(
      (await api<{ role: string }>('GET', `/api/projects/${proj.id}`, pal.token)).data.role,
    ).toBe('viewer');
    // Only the creator manages the team.
    expect((await api('DELETE', `/api/teams/${teamId}`, pal.token)).status).toBe(403);
    expect((await api('DELETE', `/api/teams/${teamId}`, owner.token)).status).toBe(200);
  });
});

describe('rights per sheet', () => {
  it('lets a viewer edit one sheet, keeps an editor to viewing another', async () => {
    const owner = await signup('Rita');
    const vito = await signup('Vito');
    const eve = await signup('Eve');
    const { data } = await api<{ id: string }>('POST', '/api/projects', owner.token, {
      name: 'Rules',
    });
    const id = data.id;
    const link = async (role: string) =>
      (
        await api<{ invite: { token: string } }>(
          'POST',
          `/api/projects/${id}/invites`,
          owner.token,
          { role },
        )
      ).data.invite.token;
    await api('POST', `/api/invites/${await link('viewer')}/accept`, vito.token);
    await api('POST', `/api/invites/${await link('editor')}/accept`, eve.token);

    // The owner draws a block: its sub-sheet is the "controller".
    const o = await connect(id, owner.token);
    const root = o.project.rootSheetId;
    const ctrl = createBlock(
      o.project,
      root,
      { x: 0, y: 0, w: 80, h: 60 },
      'Controller',
    ).childSheetId;
    await until(o.settled);

    // Only the owner sets rules.
    const setRule = (tok: string, principalId: string, level: string | null) =>
      api('PUT', `/api/projects/${id}/rules`, tok, {
        sheetId: ctrl,
        principal: 'user',
        principalId,
        level,
      });
    expect((await setRule(eve.token, vito.user.id, 'editor')).status).toBe(403);
    expect((await setRule(owner.token, vito.user.id, 'secret')).status).toBe(400);
    expect((await setRule(owner.token, vito.user.id, 'editor')).status).toBe(200);
    expect((await setRule(owner.token, eve.user.id, 'viewer')).status).toBe(200);
    const info = await api<{ rules: { principalId: string }[] }>(
      'GET',
      `/api/projects/${id}`,
      vito.token,
    );
    expect(info.data.rules.map((r) => r.principalId)).toEqual([vito.user.id]);

    const v = await connect(id, vito.token);
    const e = await connect(id, eve.token);
    // Vito (viewer) may edit the controller…
    addComponent(v.project, ctrl, 'resistor', 0, 0, makeContext(v.project));
    await until(() => o.project.getElements(ctrl).length === 1);
    // …but not the main sheet (read-only there: the change is ignored).
    addComponent(v.project, root, 'capacitor', 0, 0, makeContext(v.project));
    await new Promise((r) => setTimeout(r, 300));
    expect(o.project.getElements(root).filter((x) => x.type === 'component')).toHaveLength(0);

    // Eve (editor) edits the main sheet, not the controller.
    addComponent(e.project, root, 'inductor', 100, 0, makeContext(e.project));
    await until(() => o.project.getElements(root).some((x) => x.type === 'component'));
    addComponent(e.project, ctrl, 'capacitor', 40, 0, makeContext(e.project));
    await until(() => e.closed() === 'You cannot edit this sheet.');
    await new Promise((r) => setTimeout(r, 200));
    expect(o.project.getElements(ctrl)).toHaveLength(1);

    // Removing the rule gives Eve her editor rights back everywhere.
    expect((await setRule(owner.token, eve.user.id, null)).status).toBe(200);
    expect(
      (await api<{ rules: unknown[] }>('GET', `/api/projects/${id}`, eve.token)).data.rules,
    ).toEqual([]);
  });
});

describe('hidden sheets', () => {
  it('never sends a hidden sheet, and follows rule changes', async () => {
    const owner = await signup('Hana');
    const ivo = await signup('Ivo');
    const { data } = await api<{ id: string }>('POST', '/api/projects', owner.token, {
      name: 'Secret',
    });
    const id = data.id;
    const inv = await api<{ invite: { token: string } }>(
      'POST',
      `/api/projects/${id}/invites`,
      owner.token,
      { role: 'editor' },
    );
    await api('POST', `/api/invites/${inv.data.invite.token}/accept`, ivo.token);

    const o = await connect(id, owner.token);
    const root = o.project.rootSheetId;
    const ctrl = createBlock(
      o.project,
      root,
      { x: 0, y: 0, w: 80, h: 60 },
      'Controller',
    ).childSheetId;
    addComponent(o.project, ctrl, 'mosfet', 0, 0, makeContext(o.project));
    o.project.addComment({ sheetId: ctrl, x: 0, y: 0 }, person('Hana'), 'secret note');
    await until(o.settled);
    const hide = (level: string | null) =>
      api('PUT', `/api/projects/${id}/rules`, owner.token, {
        sheetId: ctrl,
        principal: 'user',
        principalId: ivo.user.id,
        level,
      });
    expect((await hide('hidden')).status).toBe(200);

    // Ivo sees the block and the sheet in the tree, never its content or comments.
    const i = await connect(id, ivo.token);
    expect(i.project.hasSheet(ctrl)).toBe(true);
    expect(i.denied.has(ctrl)).toBe(true);
    expect(i.project.getElements(ctrl)).toEqual([]);
    expect(i.project.getComments()).toEqual([]);
    expect(i.project.getElements(root)).toHaveLength(1); // the block

    // Versions he downloads leave it out too.
    const v = await api<{ id: string }>('POST', `/api/projects/${id}/versions`, owner.token, {
      label: 'v1',
    });
    const got = await api<{ state: string }>(
      'GET',
      `/api/projects/${id}/versions/${v.data.id}`,
      ivo.token,
    );
    const copy = Project.fromUpdate(new Uint8Array(Buffer.from(got.data.state, 'base64')));
    expect(copy.hasSheet(ctrl)).toBe(true);
    expect(copy.getElements(ctrl)).toEqual([]);
    const full = await api<{ state: string }>(
      'GET',
      `/api/projects/${id}/versions/${v.data.id}`,
      owner.token,
    );
    expect(
      Project.fromUpdate(new Uint8Array(Buffer.from(full.data.state, 'base64'))).getElements(ctrl),
    ).toHaveLength(1);
    // Restoring would rewrite the hidden sheet: owner only.
    expect(
      (await api('POST', `/api/projects/${id}/versions/${v.data.id}/restore`, ivo.token)).status,
    ).toBe(403);

    // The owner lifts the rule: a new connection gets the sheet.
    expect((await hide(null)).status).toBe(200);
    const again = await connect(id, ivo.token);
    await until(() => again.project.getElements(ctrl).length === 1);
    expect(again.project.getComments().map((t) => t.messages[0]?.text)).toEqual(['secret note']);
  });

  it('converts projects saved in one single document', async () => {
    const u = await signup('Otto');
    // An upload in the old format (one Yjs document).
    const old = new Y.Doc();
    old.transact(() => {
      old.getMap('meta').set('name', 'Old one');
      old.getMap('meta').set('rootSheetId', 'r');
      const sheet = new Y.Map<unknown>();
      sheet.set('id', 'r');
      sheet.set('name', 'Main');
      const els = new Y.Map<unknown>();
      const el = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 'e', type: 'text', x: 0, y: 0, z: 1, text: 'hi' }))
        el.set(k, v);
      els.set('e', el);
      sheet.set('elements', els);
      old.getMap('sheets').set('r', sheet);
    });
    const up = await api<{ id: string }>('POST', '/api/projects', u.token, {
      state: Buffer.from(Y.encodeStateAsUpdate(old)).toString('base64'),
    });
    const o = await connect(up.data.id, u.token);
    expect(o.project.getMeta().name).toBe('Old one');
    await until(() => o.project.getElements('r').length === 1);
  });
});
