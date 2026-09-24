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

const year = document.querySelector('[data-year]');
if (year) year.textContent = `© ${new Date().getFullYear()}`;
