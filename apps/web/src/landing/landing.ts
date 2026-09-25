/**
 * Homepage: tiny progressive enhancements only (the page is plain HTML, readable without JS).
 */
import './landing.css';

// Sections fade in as they come into view (skipped when reduced motion is asked).
const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
if (!reduce && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add('seen');
          // Once arrived, hover effects react at once again.
          setTimeout(() => e.target.classList.add('settled'), 1200);
          io.unobserve(e.target);
        }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  for (const el of document.querySelectorAll('.beta, .contact, .faq')) {
    el.classList.add('reveal');
    io.observe(el);
  }
  // The last arrow is drawn when you reach the end of the page.
  const last = document.querySelector('.final');
  if (last) {
    last.classList.add('reveal-watch');
    io.observe(last);
  }
}

// Click a screenshot to see it in full size (Esc, or a click, closes it).
let zoom: HTMLDialogElement | null = null;
function showBig(img: HTMLImageElement) {
  if (!zoom) {
    zoom = document.createElement('dialog');
    zoom.className = 'zoom';
    zoom.append(document.createElement('img'));
    zoom.addEventListener('click', () => zoom?.close());
    document.body.append(zoom);
  }
  const big = zoom.querySelector('img')!;
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  zoom.showModal();
}
for (const img of document.querySelectorAll<HTMLImageElement>('.shot img, .nb-shot img'))
  img.addEventListener('click', () => showBig(img));

// The notebook: it stays on screen while its section scrolls by, and each page turns up over
// the spiral. A page is read first (its pencil marks are drawn, --q: 0 → 1), then turned
// (--f: 0 → 1). Without this, or with reduced motion, the pages are simply one under the other.
const nb = document.querySelector<HTMLElement>('.nb');
if (nb && !reduce && CSS.supports('transform-style', 'preserve-3d')) {
  nb.classList.add('nb-on');
  const pages = [...nb.querySelectorAll<HTMLElement>('.nb-page')];
  const tabs = [...nb.querySelectorAll<HTMLAnchorElement>('.nb-tab')];
  const n = pages.length;
  /** Share of a page's scroll spent reading it; the rest turns it. */
  const READ = 0.55;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  pages.forEach((p, i) => (p.style.zIndex = String(n - i + 1)));
  /** Scroll position where page `i` is open, its pencil notes written. */
  const pageTop = (i: number) => {
    const span = nb.offsetHeight - innerHeight;
    return nb.getBoundingClientRect().top + scrollY + (span * (i + 0.25)) / n;
  };
  let frame = 0;
  const update = () => {
    frame = 0;
    const r = nb.getBoundingClientRect();
    const s = (-r.top / Math.max(1, r.height - innerHeight)) * n;
    let current = 0;
    let prevTurn = 0;
    pages.forEach((p, i) => {
      const local = s - i;
      const turn = i === n - 1 ? 0 : ease(clamp((local - READ) / (1 - READ)));
      p.style.setProperty('--f', turn.toFixed(4));
      p.style.setProperty('--q', clamp((local + 0.35) / 0.55).toFixed(3));
      // The page being turned darkens the one it uncovers.
      p.style.setProperty('--shade', (Math.sin(Math.PI * prevTurn) * 0.9).toFixed(3));
      p.style.visibility = turn > 0.995 ? 'hidden' : '';
      p.classList.toggle('turning', turn > 0 && turn < 1);
      if (turn >= 0.5) current = i + 1;
      prevTurn = turn;
    });
    tabs.forEach((t, i) => {
      t.classList.toggle('on', i === current);
      if (i === current) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  update();
  // Tabs and links to a page scroll to where that page is open.
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="#p-"]')) {
    const i = pages.findIndex((p) => `#${p.id}` === a.getAttribute('href'));
    if (i < 0) continue;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      scrollTo({ top: pageTop(i), behavior: 'smooth' });
      history.replaceState(null, '', `#${pages[i]!.id}`);
    });
  }
  // Arriving with a link to a page (circuitnotebook.com/#p-together).
  const start = pages.findIndex((p) => `#${p.id}` === location.hash);
  if (start >= 0) requestAnimationFrame(() => scrollTo({ top: pageTop(start) }));
}

// Contact form: sent to the Circuit Notebook server (the one this page is served by, or the one
// saved by the app in this browser); without a server, the e-mail address is offered instead.
const form = document.querySelector<HTMLFormElement>('.contact-form');
if (form) {
  const status = form.querySelector<HTMLElement>('.form-status')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const say = (text: string, kind: 'ok' | 'error' | '' = '') => {
    status.textContent = text;
    status.className = `form-status small ${kind}`;
  };
  const servers = () => {
    const saved = (() => {
      try {
        return localStorage.getItem('sb.server');
      } catch {
        return null;
      }
    })();
    const list = [
      saved,
      import.meta.env.VITE_SERVER_URL as string | undefined,
      location.origin,
    ].filter((x): x is string => Boolean(x));
    return [...new Set(list.map((u) => u.replace(/\/$/, '')))];
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email?.trim() ?? ''))
      return say('Please enter your e-mail address, so I can answer.', 'error');
    if ((data.message ?? '').trim().length < 5) return say('Your message is empty.', 'error');
    button.disabled = true;
    say('Sending…');
    try {
      for (const server of servers()) {
        let res: Response;
        try {
          res = await fetch(`${server}/api/contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
        } catch {
          continue; // not reachable: try the next one
        }
        if (res.status === 404 || res.status === 405) continue;
        const r = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return say(r.error ?? 'Sorry, the message could not be sent.', 'error');
        form.reset();
        return say('Thank you! Your message is sent — I will answer by e-mail.', 'ok');
      }
      say('The server cannot be reached right now: e-mail contact@circuitnotebook.com.', 'error');
    } finally {
      button.disabled = false;
    }
  });
}

const year = document.querySelector('[data-year]');
if (year) year.textContent = `© ${new Date().getFullYear()}`;
