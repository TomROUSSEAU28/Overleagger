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

// ---------------------------------------------------------------------------------------------
// The manual: a search box over its sections, and a table of contents that follows the reading.

const manual = document.querySelector<HTMLElement>('article.manual');
const q = document.getElementById('manual-q') as HTMLInputElement | null;
const resultsList = document.getElementById('manual-results') as HTMLUListElement | null;
if (manual && q && resultsList) setupManual(manual, q, resultsList);

function setupManual(article: HTMLElement, input: HTMLInputElement, list: HTMLUListElement) {
  /** Lower case, without accents, one character for one (so positions stay the same). */
  const fold = (s: string) =>
    s
      .split('')
      .map((c) => (c.normalize('NFD')[0] ?? c).toLowerCase())
      .join('');
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const sections = [...article.querySelectorAll<HTMLElement>('section[id]')].map((el) => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const title = (el.querySelector('h2')?.textContent ?? '').replace(/^\d+\.\s*/, '');
    return { el, id: el.id, title, text, folded: fold(text), foldedTitle: fold(title) };
  });

  // Search ---------------------------------------------------------------------------------
  let hits: typeof sections = [];
  let active = 0;
  const termsOf = (s: string) =>
    fold(s)
      .split(/\s+/)
      .filter((t) => t.length > 1);

  /** A piece of the section's text around the first match, the words found marked. */
  const snippet = (text: string, folded: string, terms: string[]) => {
    const at = Math.max(0, folded.indexOf(terms[0]!));
    // Whole words at both ends.
    let from = Math.max(0, at - 50);
    if (from > 0) from = text.indexOf(' ', from) + 1 || from;
    if (from > at) from = at;
    let to = Math.min(text.length, at + 90);
    if (to < text.length) to = text.lastIndexOf(' ', to) > at ? text.lastIndexOf(' ', to) : to;
    let out = '';
    let i = from;
    const part = folded.slice(from, to);
    const re = new RegExp(
      terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g',
    );
    for (const m of part.matchAll(re)) {
      const s = from + m.index!;
      out += esc(text.slice(i, s)) + '<mark>' + esc(text.slice(s, s + m[0].length)) + '</mark>';
      i = s + m[0].length;
    }
    out += esc(text.slice(i, to));
    return (from > 0 ? '…' : '') + out + (to < text.length ? '…' : '');
  };

  const render = () => {
    const terms = termsOf(input.value);
    clearMarks();
    if (!terms.length) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    hits = sections
      .filter((s) => terms.every((t) => s.folded.includes(t)))
      .map((s) => ({
        s,
        score:
          terms.reduce((n, t) => n + s.folded.split(t).length - 1, 0) +
          (terms.every((t) => s.foldedTitle.includes(t)) ? 100 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .map((h) => h.s);
    active = 0;
    list.hidden = false;
    list.innerHTML = hits.length
      ? hits
          .map(
            (h, i) =>
              `<li role="option" id="manual-hit-${i}"${i === 0 ? ' aria-selected="true"' : ''}><a href="#${h.id}"><b>${esc(h.title)}</b><span>${snippet(h.text, h.folded, terms)}</span></a></li>`,
          )
          .join('')
      : `<li class="none">Nothing found for “${esc(input.value.trim())}”.</li>`;
  };

  const setActive = (i: number) => {
    const items = [...list.querySelectorAll('li[role=option]')];
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((li, k) => li.toggleAttribute('aria-selected', k === active));
    items[active]!.scrollIntoView({ block: 'nearest' });
  };

  /** Open a result: its section, every match in it marked, the first one on screen. */
  const open = (i: number) => {
    const h = hits[i];
    if (!h) return;
    const terms = termsOf(input.value);
    list.hidden = true;
    clearMarks();
    const first = markIn(h.el, terms);
    history.replaceState(null, '', `#${h.id}`);
    (first ?? h.el).scrollIntoView({ behavior: 'smooth', block: first ? 'center' : 'start' });
  };

  const clearMarks = () => {
    for (const m of article.querySelectorAll('mark.manual-hit')) {
      m.replaceWith(document.createTextNode(m.textContent ?? ''));
    }
    article.normalize();
  };

  const markIn = (root: HTMLElement, terms: string[]): HTMLElement | null => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const re = new RegExp(
      terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g',
    );
    let first: HTMLElement | null = null;
    for (const node of nodes) {
      const text = node.data;
      const matches = [...fold(text).matchAll(re)];
      if (!matches.length) continue;
      const frag = document.createDocumentFragment();
      let i = 0;
      for (const m of matches) {
        frag.append(text.slice(i, m.index));
        const mark = document.createElement('mark');
        mark.className = 'manual-hit';
        mark.textContent = text.slice(m.index, m.index! + m[0].length);
        frag.append(mark);
        first ??= mark;
        i = m.index! + m[0].length;
      }
      frag.append(text.slice(i));
      node.replaceWith(frag);
    }
    return first;
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', () => {
    if (input.value.trim()) render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(active);
    } else if (e.key === 'Escape') {
      input.value = '';
      render();
    }
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li[role=option]');
    if (!li) return;
    e.preventDefault();
    open([...list.children].indexOf(li));
  });
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.manual-search')) list.hidden = true;
  });
  // "/" goes to the search box (like on many documentation sites).
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      return;
    e.preventDefault();
    input.focus();
    input.select();
  });
  // A link to the manual with ?q=… opens with that search.
  const asked = new URLSearchParams(location.search).get('q');
  if (asked) {
    input.value = asked;
    render();
  }

  // Table of contents -------------------------------------------------------------------------
  const toc = document.querySelector<HTMLDetailsElement>('.manual-toc');
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.manual-toc a[href^="#"]')];
  const targets = links
    .map((a) => ({ a, el: document.getElementById(a.hash.slice(1)) }))
    .filter((x): x is { a: HTMLAnchorElement; el: HTMLElement } => Boolean(x.el));
  const narrow = window.matchMedia('(max-width: 900px)');
  // On a phone the search bar sits right under the site's header.
  const header = document.querySelector<HTMLElement>('header.nav');
  const setNavH = () =>
    document.documentElement.style.setProperty('--nav-h', `${header?.offsetHeight ?? 60}px`);
  setNavH();
  window.addEventListener('resize', setNavH);
  // A click outside the dropped-down contents closes them.
  document.addEventListener('click', (e) => {
    if (toc && narrow.matches && toc.open && !(e.target as HTMLElement).closest('.manual-toc'))
      toc.open = false;
  });
  // On a phone the contents fold away (they sit above the text), and close after a choice.
  if (toc && narrow.matches) toc.open = false;
  // On a computer the contents are always shown: their title is not a switch.
  toc?.querySelector('summary')?.addEventListener('click', (e) => {
    if (!narrow.matches) e.preventDefault();
  });
  for (const { a } of targets)
    a.addEventListener('click', () => {
      if (toc && narrow.matches) toc.open = false;
      // On a computer the contents are always shown: their title is not a switch.
      toc?.querySelector('summary')?.addEventListener('click', (e) => {
        if (!narrow.matches) e.preventDefault();
      });
    });
  let ticking = false;
  const spy = () => {
    ticking = false;
    // The part being read: the last heading above the upper third of the window (or the last
    // one, at the very bottom of the page).
    const line = Math.min(240, window.innerHeight / 3);
    let current: HTMLAnchorElement | null = null;
    for (const { a, el } of targets) if (el.getBoundingClientRect().top <= line) current = a;
    const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (bottom) current = targets.filter((t) => !t.a.closest('ol ol')).at(-1)?.a ?? current;
    // The subsection's own section stays marked too.
    const parent = current?.closest('ol ol')?.closest('li')?.querySelector('a') ?? null;
    for (const { a } of targets) {
      const on = a === current || a === parent;
      a.classList.toggle('active', on);
      if (a === current) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(spy);
      }
    },
    { passive: true },
  );
  spy();
}
