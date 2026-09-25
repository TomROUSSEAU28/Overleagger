import type { Transporter } from 'nodemailer';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { testClient } from './helpers';

let srv: App;
let c: ReturnType<typeof testClient>;
const sent: {
  from?: unknown;
  to?: unknown;
  replyTo?: unknown;
  subject?: unknown;
  text?: unknown;
  messageId?: string;
  references?: string;
}[] = [];

beforeAll(async () => {
  // Messages go to a fake mail server.
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
      adminEmails: ['boss@contact.test'],
      contactEmail: 'contact@circuitnotebook.com',
      smtp: { host: 'smtp.example', port: 587, from: 'contact@circuitnotebook.com' },
    },
    { mailTransport: transport },
  );
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = srv.app.server.address();
  c = testClient(`127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, 'contact.test');
});

afterAll(async () => {
  c.close();
  await srv.close();
});

const send = (body: object) =>
  c.api<{ ok?: boolean; error?: string }>('POST', '/api/contact', undefined, body);

it('receives messages from the homepage and e-mails them', async () => {
  const ok = await send({ name: 'Léa', email: 'Lea@Univ.fr', message: 'Great tool, one bug: …' });
  expect(ok.status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    from: { name: 'Léa via Circuit Notebook', address: 'contact@circuitnotebook.com' },
    to: 'contact@circuitnotebook.com',
    replyTo: { name: 'Léa', address: 'lea@univ.fr' },
    subject: '[Circuit Notebook] Message from lea@univ.fr',
  });
  expect(String(sent[0]!.text)).toContain('Great tool');

  // Checks: an e-mail to answer, a real message, robots ignored.
  expect((await send({ email: 'nope', message: 'hello there' })).status).toBe(400);
  expect((await send({ email: 'a@b.fr', message: '' })).status).toBe(400);
  expect((await send({ email: 'bot@spam.io', message: 'buy now', website: 'x' })).status).toBe(200);
  expect(sent).toHaveLength(1);

  // At most 5 messages an hour from one place.
  for (let i = 0; i < 4; i++) await send({ email: 'a@b.fr', message: `message ${i}` });
  expect((await send({ email: 'a@b.fr', message: 'one too many' })).status).toBe(429);

  // One conversation per person: the messages of one address refer to the same thread.
  const [a1, a2] = sent.filter((m) => m.subject === '[Circuit Notebook] Message from a@b.fr');
  expect(a1!.references).toBe(a2!.references);
  expect(a1!.messageId).not.toBe(a2!.messageId);
  expect(a1!.references).not.toBe(sent[0]!.references);
  expect(a1!.references).toMatch(/^<contact\.[0-9a-f]{16}@circuitnotebook\.com>$/);

  // The administrator reads them in the admin page.
  const user = await c.signup('Visitor');
  expect((await c.api('GET', '/api/admin/messages', user.token)).status).toBe(403);
  const boss = await c.signup('Boss');
  const list = await c.api<{ messages: { id: string; email: string; read: boolean }[] }>(
    'GET',
    '/api/admin/messages',
    boss.token,
  );
  expect(list.data.messages).toHaveLength(5);
  const lea = list.data.messages.find((m) => m.email === 'lea@univ.fr')!;
  expect(lea.read).toBe(false);
  const stats = await c.api<{ unreadMessages: number }>('GET', '/api/admin/stats', boss.token);
  expect(stats.data.unreadMessages).toBe(5);
  await c.api('PATCH', `/api/admin/messages/${lea.id}`, boss.token, { read: true });
  await c.api('DELETE', `/api/admin/messages/${list.data.messages[0]!.id}`, boss.token);
  const after = await c.api<{ unreadMessages: number }>('GET', '/api/admin/stats', boss.token);
  expect(after.data.unreadMessages).toBe(3);
});
