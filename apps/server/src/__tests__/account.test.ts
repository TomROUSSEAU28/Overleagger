import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { testClient } from './helpers';

let srv: App;
let c: ReturnType<typeof testClient>;

beforeAll(async () => {
  srv = await createApp({ ...loadConfig({}), dbFile: ':memory:' });
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = srv.app.server.address();
  c = testClient(`127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, 'account.test');
});

afterAll(async () => {
  c.close();
  await srv.close();
});

it('deletes an account and what is only theirs', async () => {
  const ana = await c.signup('Ana');
  const bob = await c.signup('Bob');
  const share = async (owner: string, guest: string) => {
    const p = await c.api<{ id: string }>('POST', '/api/projects', owner, { name: 'P' });
    const inv = await c.api<{ invite: { token: string } }>(
      'POST',
      `/api/projects/${p.data.id}/invites`,
      owner,
      { role: 'editor' },
    );
    await c.api('POST', `/api/invites/${inv.data.invite.token}/accept`, guest);
    return p.data.id;
  };
  const anas = await share(ana.token, bob.token);
  const bobs = await share(bob.token, ana.token);
  await c.api('POST', '/api/friends', ana.token, { who: 'bob@account.test' });
  await c.api('POST', '/api/contact', undefined, {
    email: 'ana@account.test',
    message: 'Hello there',
  });

  // The password confirms it.
  const wrong = await c.api('DELETE', '/api/auth/me', ana.token, { password: 'nope' });
  expect(wrong.status).toBe(403);
  const del = await c.api('DELETE', '/api/auth/me', ana.token, {
    password: 'correct horse battery',
  });
  expect(del.status).toBe(200);

  // Signed out everywhere, and the e-mail is free again.
  expect((await c.api('GET', '/api/auth/me', ana.token)).status).toBe(401);
  const login = await c.api('POST', '/api/auth/login', undefined, {
    email: 'ana@account.test',
    password: 'correct horse battery',
  });
  expect(login.status).toBe(401);
  // Her project is gone, for Bob too; Bob's project stays, without her.
  expect((await c.api('GET', `/api/projects/${anas}`, bob.token)).status).toBe(404);
  const bobP = await c.api<{ members: { id: string }[] }>(
    'GET',
    `/api/projects/${bobs}`,
    bob.token,
  );
  expect(bobP.status).toBe(200);
  expect(bobP.data.members.map((m) => m.id)).toEqual([bob.user.id]);
  const friends = await c.api<{ outgoing: unknown[]; incoming: unknown[] }>(
    'GET',
    '/api/friends',
    bob.token,
  );
  expect(friends.data.incoming).toEqual([]);
  expect((await c.signup('Ana')).user.id).not.toBe(ana.user.id);
});

it('forgets contact messages after a year', () => {
  const s = srv.store;
  s.addMessage({ id: 'old', name: '', email: 'a@b.fr', body: 'old one' });
  s.db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(1000, 'old');
  s.addMessage({ id: 'new', name: '', email: 'a@b.fr', body: 'new one' });
  expect(s.pruneMessages(Date.now() - 365 * 24 * 3600 * 1000)).toBe(1);
  expect(s.messages().map((m) => m.id)).toContain('new');
  expect(s.messages().map((m) => m.id)).not.toContain('old');
});
