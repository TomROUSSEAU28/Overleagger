/**
 * The documentation pages (/manual/, /changelog/): the current version, and the list of
 * versions drawn from the same data as the app's "What's new".
 */
import { CHANGELOG, STAGE, VERSION, formatDate, versionLabel } from '../changelog';

for (const el of document.querySelectorAll<HTMLElement>('[data-version]'))
  el.textContent = `${versionLabel(VERSION)} ${STAGE}`;

const list = document.getElementById('releases');
if (list) {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const items = (title: string, cls: string, xs: string[]) =>
    xs.length
      ? `<h3 class="${cls}">${title}</h3><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '';
  list.innerHTML = CHANGELOG.map(
    (r, i) => `
      <section class="release" id="v${r.version}">
        <header>
          <h2>${versionLabel(r.version)} <span class="release-title">${esc(r.title)}</span></h2>
          <p class="kicker">${formatDate(r.date)}${i === 0 ? ' · <b>current version</b>' : ''}</p>
        </header>
        ${items('Added', 'added', r.added)}
        ${items('Fixed', 'fixed', r.fixed)}
      </section>`,
  ).join('');
}
