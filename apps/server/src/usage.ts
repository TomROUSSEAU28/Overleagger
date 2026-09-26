/**
 * Anonymous statistics of the site's use, for the admin page: how many people come (with or
 * without an account), to which pages, from where, and what they do in the app.
 *
 * Nothing about a person is kept, and no cookie is used. Only daily counts are stored. To count
 * each visitor once a day, the server keeps in memory a hash of (a random salt of the day, IP
 * address, browser); the salt changes every day and is never written anywhere, so the hashes of
 * one day cannot be linked to another day or to anyone (the method of Plausible Analytics). A
 * restart forgets them: a visitor coming back that day counts twice.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Store } from './db';

/** Pages of the site that are counted (others are ignored). */
const PAGES = ['/', '/app/', '/manual/', '/changelog/', '/privacy/', '/legal/'];

/** Actions in the app that are counted. */
export const ACTIONS = [
  'open-example',
  'new-project',
  'present',
  'export-pdf',
  'export-svg',
  'export-png',
  'export-tikz',
  'export-file',
] as const;

/** Robots, link previews and monitoring: not visitors. */
const BOT =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|facebookexternalhit|embedly|whatsapp|discord|telegram/i;

/** The day of a time (YYYY-MM-DD) in a time zone. */
export function dayOf(t: number, timeZone: string): string {
  return new Date(t).toLocaleDateString('sv-SE', { timeZone });
}

/**
 * Where a visitor came from: a campaign name (`?ref=instagram`), else the site of the link they
 * followed, without its "www." (t.co and twitter.com are X), else "direct".
 */
export function sourceOf(ref: string | undefined, campaign: string | undefined, ownHost: string) {
  const c = (campaign ?? '').trim().toLowerCase();
  if (/^[a-z0-9._-]{1,40}$/.test(c)) return c;
  let host: string;
  try {
    host = new URL(ref ?? '').hostname.toLowerCase();
  } catch {
    return 'direct';
  }
  host = host.replace(/^(www|m|l|lm|out|old|new|mobile)\./, '');
  if (!host || host === ownHost.replace(/^www\./, '')) return 'direct';
  if (host === 't.co' || host === 'twitter.com') return 'x.com';
  return host.slice(0, 60);
}

/** Phone, tablet or computer, from the browser's name. */
export function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export interface Hit {
  /** "view" (a page of the site) or one of ACTIONS. */
  event: string;
  /** The page (views). */
  page?: string;
  /** document.referrer */
  ref?: string;
  /** ?ref= or ?utm_source= of the page's address. */
  campaign?: string;
  ip: string;
  ua: string;
  /** Two-letter country code (from Cloudflare's CF-IPCountry header), if known. */
  country?: string;
  /** Host of the site (a link from the site itself is no source). */
  host: string;
}

export function createUsage(store: Store, timeZone: string) {
  let today = '';
  let salt = randomBytes(16);
  /** Hits of each visitor today (by hash). */
  let seen = new Map<string, number>();

  return {
    /** Count a hit; false when it is ignored (a robot, an unknown page or action, too many). */
    hit(h: Hit, now = Date.now()): boolean {
      if (!h.ua || BOT.test(h.ua)) return false;
      const page = h.event === 'view' ? h.page : undefined;
      if (h.event === 'view' ? !page || !PAGES.includes(page) : !ACTIONS.includes(h.event as never))
        return false;
      const day = dayOf(now, timeZone);
      if (day !== today) {
        today = day;
        salt = randomBytes(16);
        seen = new Map();
      }
      const who = createHash('sha256').update(salt).update(h.ip).update(h.ua).digest('hex');
      const hits = seen.get(who) ?? 0;
      // A page left open, or someone playing with the counter: at most 300 counts a day each.
      if (hits >= 300) return false;
      seen.set(who, hits + 1);
      if (hits === 0) {
        store.count(day, 'visitors');
        store.count(day, 'source', sourceOf(h.ref, h.campaign, h.host));
        store.count(day, 'device', deviceOf(h.ua));
        const c = (h.country ?? '').toUpperCase();
        if (/^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1') store.count(day, 'country', c);
      }
      if (page) store.count(day, 'views', page);
      else store.count(day, 'action', h.event);
      return true;
    },

    /** The last `days` days, for the admin page. */
    report(days: number, now = Date.now()) {
      const list: string[] = [];
      for (let i = days - 1; i >= 0; i--) list.push(dayOf(now - i * 24 * 3600 * 1000, timeZone));
      const rows = store.usage(list[0]!);
      const perDay = new Map(list.map((d) => [d, { day: d, visitors: 0, views: 0 }]));
      const top: Record<
        'pages' | 'sources' | 'countries' | 'devices' | 'actions',
        Map<string, number>
      > = {
        pages: new Map(),
        sources: new Map(),
        countries: new Map(),
        devices: new Map(),
        actions: new Map(),
      };
      const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
      for (const r of rows) {
        const d = perDay.get(r.day);
        if (!d) continue;
        if (r.metric === 'visitors') d.visitors += r.n;
        else if (r.metric === 'views') {
          d.views += r.n;
          add(top.pages, r.key, r.n);
        } else if (r.metric === 'source') add(top.sources, r.key, r.n);
        else if (r.metric === 'country') add(top.countries, r.key, r.n);
        else if (r.metric === 'device') add(top.devices, r.key, r.n);
        else if (r.metric === 'action') add(top.actions, r.key, r.n);
      }
      const sorted = (m: Map<string, number>) =>
        [...m]
          .map(([key, n]) => ({ key, n }))
          .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
      const series = [...perDay.values()];
      return {
        days: series,
        visitors: series.reduce((s, d) => s + d.visitors, 0),
        views: series.reduce((s, d) => s + d.views, 0),
        today: series[series.length - 1]!,
        pages: sorted(top.pages),
        sources: sorted(top.sources).slice(0, 15),
        countries: sorted(top.countries).slice(0, 15),
        devices: sorted(top.devices),
        actions: sorted(top.actions),
      };
    },
  };
}
