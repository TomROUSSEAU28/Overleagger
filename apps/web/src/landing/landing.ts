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
  for (const el of document.querySelectorAll(
    '.story, .promises > div, .cards article, .beta, .contact, .faq',
  )) {
    el.classList.add('reveal');
    io.observe(el);
  }
  // The last arrow is drawn when you reach the end of the page.
  const last = document.querySelector('.final');
  if (last) {
    last.classList.add('reveal-watch');
    io.observe(last);
  }
  // Cards arrive one after the other.
  document.querySelectorAll<HTMLElement>('.cards article').forEach((c, i) => {
    c.style.setProperty('--delay', `${(i % 4) * 80}ms`);
  });
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
for (const img of document.querySelectorAll<HTMLImageElement>('.shot img'))
  img.addEventListener('click', () => showBig(img));

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
