import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { Store } from '../db';
import { createUsage, deviceOf, sourceOf } from '../usage';
import { testClient } from './helpers';

const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const LAPTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

describe('usage statistics', () => {
  it('tells where visitors come from, and on what', () => {
    expect(sourceOf('https://www.google.com/', undefined, 'circuitnotebook.com')).toBe(
      'google.com',
    );
    expect(sourceOf('https://l.instagram.com/?u=x', undefined, 'circuitnotebook.com')).toBe(
      'instagram.com',
    );
    expect(sourceOf('https://t.co/abc', undefined, 'circuitnotebook.com')).toBe('x.com');
    expect(sourceOf('https://circuitnotebook.com/', undefined, 'circuitnotebook.com')).toBe(
      'direct',
    );
    expect(sourceOf('', undefined, 'circuitnotebook.com')).toBe('direct');
    // A campaign link (?ref=…) wins.
    expect(sourceOf('', 'TikTok', 'circuitnotebook.com')).toBe('tiktok');
    expect(deviceOf(PHONE)).toBe('mobile');
    expect(deviceOf(LAPTOP)).toBe('desktop');
  });

  it('counts each visitor once a day, and nothing about them', () => {
    const store = new Store(':memory:');
    const u = createUsage(store, 'Europe/Paris');
    const t = Date.UTC(2026, 8, 26, 10);
    const base = { ip: '1.2.3.4', ua: LAPTOP, host: 'circuitnotebook.com' };
    expect(u.hit({ ...base, event: 'view', page: '/', ref: 'https://www.reddit.com/r/x' }, t)).toBe(
      true,
    );
    u.hit({ ...base, event: 'view', page: '/app/', ref: 'https://circuitnotebook.com/' }, t);
    u.hit({ ...base, event: 'present' }, t);
    u.hit(
      { ip: '5.6.7.8', ua: PHONE, host: base.host, event: 'view', page: '/', country: 'be' },
      t,
    );
    // Robots, unknown pages and actions are not counted.
    expect(u.hit({ ...base, ua: 'Googlebot/2.1', event: 'view', page: '/' }, t)).toBe(false);
    expect(u.hit({ ...base, event: 'view', page: '/wp-admin/' }, t)).toBe(false);
    expect(u.hit({ ...base, event: 'hack' }, t)).toBe(false);
    // The next day, the same person is a new visitor (nothing links the two days).
    u.hit({ ...base, event: 'view', page: '/manual/' }, t + 24 * 3600 * 1000);

    const r = u.report(2, t + 24 * 3600 * 1000);
    expect(r.days.map((d) => [d.day, d.visitors, d.views])).toEqual([
      ['2026-09-26', 2, 3],
      ['2026-09-27', 1, 1],
    ]);
    expect(r.visitors).toBe(3);
    expect(r.today).toEqual({ day: '2026-09-27', visitors: 1, views: 1 });
    expect(r.pages[0]).toEqual({ key: '/', n: 2 });
    expect(r.sources).toEqual(
      expect.arrayContaining([
        { key: 'reddit.com', n: 1 },
        { key: 'direct', n: 2 },
      ]),
    );
    expect(r.countries).toEqual([{ key: 'BE', n: 1 }]);
    expect(r.devices).toEqual(
      expect.arrayContaining([
        { key: 'desktop', n: 2 },
        { key: 'mobile', n: 1 },
      ]),
    );
    expect(r.actions).toEqual([{ key: 'present', n: 1 }]);
    // Stored: counts by day only (no address, no hash).
    const raw = JSON.stringify(store.usage('2000-01-01'));
    expect(raw).not.toContain('1.2.3.4');
    expect(raw).not.toMatch(/[0-9a-f]{32}/);
    store.close();
  });
});

describe('usage statistics on the server', () => {
  let srv: App;
  let c: ReturnType<typeof testClient>;
  let base = '';
  beforeAll(async () => {
    srv = await createApp({
      ...loadConfig({}),
      dbFile: ':memory:',
      adminEmails: ['boss@usage.test'],
    });
    await srv.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = srv.app.server.address();
    base = `127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    c = testClient(base, 'usage.test');
  });
  afterAll(async () => {
    c.close();
    await srv.close();
  });

  it('takes hits from anyone, and shows them to the administrators only', async () => {
    const hit = (body: object) =>
      fetch(`http://${base}/api/hit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': LAPTOP },
        body: JSON.stringify(body),
      });
    expect((await hit({ e: 'view', p: '/', r: 'https://www.youtube.com/' })).status).toBe(204);
    expect((await hit({ e: 'new-project' })).status).toBe(204);
    expect((await hit({ e: 'nonsense', p: 42 })).status).toBe(204);
    const visitor = await c.signup('Visitor');
    expect((await c.api('GET', '/api/admin/usage', visitor.token)).status).toBe(403);
    const boss = await c.signup('Boss');
    const r = await c.api<{ visitors: number; sources: { key: string }[]; actions: unknown[] }>(
      'GET',
      '/api/admin/usage?days=7',
      boss.token,
    );
    expect(r.status).toBe(200);
    expect(r.data.visitors).toBe(1);
    expect(r.data.sources[0]!.key).toBe('youtube.com');
    expect(r.data.actions).toEqual([{ key: 'new-project', n: 1 }]);
  });
});
