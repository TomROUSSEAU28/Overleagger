import type { Transporter } from 'nodemailer';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { testClient } from './helpers';

let srv: App;
let c: ReturnType<typeof testClient>;
const sent: { to?: string; subject?: string; text?: string }[] = [];
/** The code of the last e-mail sent to this address. */
const lastCode = (to: string) =>
  /\b(\d{6})\b/.exec(sent.filter((m) => m.to === to).at(-1)?.text ?? '')?.[1] ?? '';

beforeAll(async () => {
  const transport = {
    sendMail: async (m: (typeof sent)[number]) => {
      sent.push(m);
      return {};
    },
  } as unknown as Transporter;
  srv = await createApp(
    {
      ...loadConfig({}),
      dbFile: ':memory:',
      smtp: { host: 'smtp.example', port: 587, from: 'contact@circuitnotebook.com' },
      verifyEmail: true,
    },
    { mailTransport: transport },
  );
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = srv.app.server.address();
  c = testClient(`127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, 'verify.test');
});

afterAll(async () => {
  c.close();
  await srv.close();
});

const post = <T = Record<string, unknown>>(path: string, body: object) =>
  c.api<T & { error?: string }>('POST', path, undefined, body);

it('a new account confirms its e-mail with a code', async () => {
  const health = await c.api<{ verify: boolean; reset: boolean }>('GET', '/api/health');
  expect(health.data).toMatchObject({ verify: true, reset: true });

  const r = await post('/api/auth/signup', {
    email: 'Ada@Lab.test',
    name: 'Ada',
    password: 'correct horse battery',
  });
  expect(r.status).toBe(200);
  expect(r.data).toEqual({ verify: true, email: 'ada@lab.test' });
  expect(sent.at(-1)!.to).toBe('ada@lab.test');
  const code = lastCode('ada@lab.test');
  expect(sent.at(-1)!.subject).toContain(code);
  // No account (and no sign-in) before the code.
  expect(
    (await post('/api/auth/login', { email: 'ada@lab.test', password: 'correct horse battery' }))
      .status,
  ).toBe(401);
  // A new code too soon is refused.
  expect(
    (
      await post('/api/auth/signup', {
        email: 'ada@lab.test',
        password: 'correct horse battery',
      })
    ).status,
  ).toBe(429);

  const wrong = await post('/api/auth/signup/verify', {
    email: 'ada@lab.test',
    code: code === '000000' ? '111111' : '000000',
  });
  expect(wrong.status).toBe(400);
  const ok = await post<{ token: string; user: { name: string } }>('/api/auth/signup/verify', {
    email: 'ada@lab.test',
    code: ` ${code.slice(0, 3)} ${code.slice(3)} `,
  });
  expect(ok.status).toBe(200);
  expect(ok.data.user.name).toBe('Ada');
  expect((await c.api('GET', '/api/auth/me', ok.data.token)).status).toBe(200);
  // A code works once.
  expect((await post('/api/auth/signup/verify', { email: 'ada@lab.test', code })).status).toBe(400);
  expect(
    (await post('/api/auth/login', { email: 'ada@lab.test', password: 'correct horse battery' }))
      .status,
  ).toBe(200);
});

it('five wrong codes, and the code is gone', async () => {
  await post('/api/auth/signup', { email: 'bob@lab.test', password: 'correct horse battery' });
  const code = lastCode('bob@lab.test');
  const bad = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    expect(
      (await post('/api/auth/signup/verify', { email: 'bob@lab.test', code: bad })).status,
    ).toBe(400);
  const late = await post('/api/auth/signup/verify', { email: 'bob@lab.test', code });
  expect(late.status).toBe(400);
  expect(late.data.error).toMatch(/expired/);
});

it('a forgotten password: a code by e-mail, then a new password', async () => {
  const before = sent.length;
  // An unknown address gets the same answer, and no e-mail.
  expect((await post('/api/auth/forgot', { email: 'nobody@lab.test' })).status).toBe(200);
  expect(sent.length).toBe(before);

  const old = await post<{ token: string }>('/api/auth/login', {
    email: 'ada@lab.test',
    password: 'correct horse battery',
  });
  expect((await post('/api/auth/forgot', { email: 'ada@lab.test' })).status).toBe(200);
  const code = lastCode('ada@lab.test');
  expect(sent.at(-1)!.subject).toMatch(/new password/);
  expect(
    (await post('/api/auth/reset', { email: 'ada@lab.test', code, password: 'short' })).status,
  ).toBe(400);
  const r = await post<{ token: string }>('/api/auth/reset', {
    email: 'ada@lab.test',
    code,
    password: 'a brand new password',
  });
  expect(r.status).toBe(200);
  // Signed out everywhere else, signed in here, with the new password only.
  expect((await c.api('GET', '/api/auth/me', old.data.token)).status).toBe(401);
  expect((await c.api('GET', '/api/auth/me', r.data.token)).status).toBe(200);
  expect(
    (await post('/api/auth/login', { email: 'ada@lab.test', password: 'correct horse battery' }))
      .status,
  ).toBe(401);
  expect(
    (await post('/api/auth/login', { email: 'ada@lab.test', password: 'a brand new password' }))
      .status,
  ).toBe(200);
});

it('without e-mail, accounts are created at once and passwords cannot be reset', async () => {
  const plain = await createApp({ ...loadConfig({}), dbFile: ':memory:' });
  await plain.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = plain.app.server.address();
  const p = testClient(`127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
  const me = await p.signup('Cleo');
  expect(me.token).toBeTruthy();
  expect(
    (await p.api('POST', '/api/auth/forgot', undefined, { email: 'cleo@lab.test' })).status,
  ).toBe(503);
  p.close();
  await plain.close();
});
