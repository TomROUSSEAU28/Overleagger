/**
 * URL of a file in `public/`. The editor lives in `<site>/app/` and the homepage in `<site>/`,
 * so a relative `BASE_URL` ("./") would point inside `app/`: resolve from the site root instead.
 */
export function siteFile(path: string): string {
  const here = new URL('.', location.href);
  return new URL(here.pathname.endsWith('/app/') ? `../${path}` : path, here).href;
}

/** Where people can support the project (Ko-fi page). */
export const SUPPORT_URL = 'https://ko-fi.com/circuitnotebook';

/**
 * Anonymous statistics of the site's use (the server's `usage.ts`): a page seen or an action in
 * the app, counted by day — no cookie, nothing about the person. Nothing is sent when the
 * browser asks not to be tracked (Global Privacy Control, Do Not Track), nor from a local copy.
 */
export function track(event: string, page?: string): void {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.globalPrivacyControl || nav.doNotTrack === '1') return;
    if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
    const q = new URLSearchParams(location.search);
    const body = JSON.stringify({
      e: event,
      ...(page ? { p: page } : {}),
      r: document.referrer,
      s: q.get('ref') ?? q.get('utm_source') ?? undefined,
    });
    const url = siteFile('api/hit');
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
    void fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // statistics never get in the way
  }
}
