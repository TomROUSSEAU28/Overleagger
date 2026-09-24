/**
 * URL of a file in `public/`. The editor lives in `<site>/app/` and the homepage in `<site>/`,
 * so a relative `BASE_URL` ("./") would point inside `app/`: resolve from the site root instead.
 */
export function siteFile(path: string): string {
  const here = new URL('.', location.href);
  return new URL(here.pathname.endsWith('/app/') ? `../${path}` : path, here).href;
}
