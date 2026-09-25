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
  /** Share of a page's scroll spent reading it (the page stays still); the rest turns it. */
  const READ = 0.62;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  pages.forEach((p, i) => (p.style.zIndex = String(n - i + 1)));
  const span = () => Math.max(1, nb.offsetHeight - innerHeight);
  /** Where the notebook is in the scroll, in pages (0 … n). */
  const target = () => (-nb.getBoundingClientRect().top / span()) * n;
  /** Scroll position for a position in pages. */
  const scrollFor = (s: number) => nb.getBoundingClientRect().top + scrollY + (span() * s) / n;
  /** Scroll position where page `i` is open, its pencil notes written. */
  const pageTop = (i: number) => scrollFor(i + 0.25);

  /** Filming the page (`?video`): the pages follow the scroll exactly, frame by frame. */
  const filming = new URLSearchParams(location.search).has('video');
  /** What is drawn: it follows the scroll with a little lag, so a wheel notch glides. */
  let shown = target();
  const draw = () => {
    let current = 0;
    let prevTurn = 0;
    pages.forEach((p, i) => {
      const local = shown - i;
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
  let frame = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const goal = target();
    if (filming) {
      shown = goal;
      draw();
      frame = 0;
      return;
    }
    // Follow the scroll smoothly (~0.16 s to catch up, whatever the frame rate)…
    const free = shown + (goal - shown) * (1 - Math.exp(-dt / 0.16));
    // …but a page never turns faster than in ~0.5 s, even after a big flick of the wheel: the
    // part of the move that lies in a turn is limited (the reading part is free).
    const max = ((1 - READ) / 0.5) * dt;
    const base = Math.floor(shown);
    const inTurn = shown - base >= READ;
    if (free > shown) {
      const entry = inTurn ? shown : base + READ;
      shown = free > entry ? Math.min(free, entry + max) : free;
    } else {
      const entry = inTurn ? shown : base;
      shown = free < entry ? Math.max(free, entry - max) : free;
    }
    if (Math.abs(goal - shown) < 0.0008) shown = goal;
    draw();
    frame = shown === goal ? 0 : requestAnimationFrame(tick);
    if (!frame) last = 0;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  // A page left half turned finishes its move (or falls back) once the scroll stops.
  let settleTimer = 0;
  let settling = false;
  const settle = () => {
    if (filming) return;
    const s = target();
    if (s <= 0 || s >= n - 1) return;
    const i = Math.floor(s);
    const turn = (s - i - READ) / (1 - READ);
    if (turn <= 0.04 || turn >= 0.96) return;
    settling = true;
    scrollTo({
      top: turn >= 0.5 ? scrollFor(i + 1 + 0.2) : scrollFor(i + READ - 0.04),
      behavior: 'smooth',
    });
  };
  const onScroll = () => {
    schedule();
    clearTimeout(settleTimer);
    if (!settling) settleTimer = window.setTimeout(settle, 220);
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('scrollend', () => {
    if (settling) settling = false;
    else {
      clearTimeout(settleTimer);
      settle();
    }
  });
  // A new gesture takes over from the settling.
  for (const ev of ['wheel', 'touchstart', 'keydown'])
    addEventListener(ev, () => (settling = false), { passive: true });
  addEventListener('resize', schedule);
  draw();

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
  // Arriving with a link to a page (circuitnotebook.com/#p-together): shown open at once.
  const openFromHash = () => {
    const i = pages.findIndex((p) => `#${p.id}` === location.hash);
    if (i < 0) return;
    // After the browser's own jump to the anchor (the page's box, not its open position).
    const go = () => {
      scrollTo({ top: pageTop(i), behavior: 'instant' });
      shown = target();
      draw();
    };
    requestAnimationFrame(go);
    if (document.readyState !== 'complete')
      addEventListener('load', () => setTimeout(go, 0), { once: true });
  };
  openFromHash();
  addEventListener('hashchange', openFromHash);
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
