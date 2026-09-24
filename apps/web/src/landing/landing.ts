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
    '.story, .promises > div, .cards article, .selfhost, .faq',
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

const year = document.querySelector('[data-year]');
if (year) year.textContent = `© ${new Date().getFullYear()}`;
