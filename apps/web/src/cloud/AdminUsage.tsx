/**
 * Admin page: how the site is used, with or without an account (the server's anonymous daily
 * counts). Visitors per day as bars, then where they come from, which pages, which countries,
 * which devices and what they do in the app.
 */
import { Eye } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './cloud';

interface Count {
  key: string;
  n: number;
}

interface Usage {
  days: { day: string; visitors: number; views: number }[];
  visitors: number;
  views: number;
  today: { day: string; visitors: number; views: number };
  pages: Count[];
  sources: Count[];
  countries: Count[];
  devices: Count[];
  actions: Count[];
}

const PERIODS = [7, 30, 90] as const;

const PAGE_NAMES: Record<string, string> = {
  '/': 'Homepage',
  '/app/': 'The app',
  '/manual/': 'Manual',
  '/changelog/': "What's new",
  '/privacy/': 'Privacy policy',
  '/legal/': 'Legal notice',
};

const ACTION_NAMES: Record<string, string> = {
  'open-example': 'Opened the example',
  'new-project': 'Started a blank project',
  present: 'Presented',
  'export-pdf': 'Exported a PDF',
  'export-svg': 'Exported an SVG',
  'export-png': 'Exported a PNG',
  'export-tikz': 'Exported CircuiTikZ',
  'export-file': 'Saved a project file',
};

const DEVICE_NAMES: Record<string, string> = {
  desktop: 'Computer',
  mobile: 'Phone',
  tablet: 'Tablet',
};

const regions = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
/** "FR" → "🇫🇷 France". */
const countryName = (code: string) => {
  const flag = String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  return `${flag} ${regions?.of(code) ?? code}`;
};

const shortDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });

/** A round step above `max` for the axis (1, 2, 5, 10, 20, 50…). */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const k of [1, 2, 5, 10]) if (k * p >= max) return k * p;
  return 10 * p;
}

/** Visitors per day: one bar a day, the numbers of the day under the pointer. */
function DailyChart({ days }: { days: Usage['days'] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at its real width, so that its text keeps its size on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 180;
  const left = 34;
  const bottom = 22;
  const top = 8;
  const max = niceMax(Math.max(...days.map((d) => d.visitors), 0));
  const step = (W - left) / days.length;
  const barW = Math.max(2, Math.min(24, step - 2));
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const ticks = [0, max / 2, max];
  const labelAt = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);
  const h = hover === null ? null : days[hover];
  // Where the tip is (0…1 across): kept inside the chart near its edges.
  const at = hover === null ? 0.5 : (left + (hover + 0.5) * step) / W;
  return (
    <div className="usage-chart" ref={box} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Visitors per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} className="usage-grid" />
            <text x={left - 6} y={y(t) + 4} className="usage-axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + i * step + (step - barW) / 2;
          const bh = Math.max(0, H - bottom - y(d.visitors));
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={d.day}>
              {bh > 0 && (
                // Rounded at the top only, standing on the baseline.
                <path
                  className={`usage-bar${hover !== null && hover !== i ? ' dim' : ''}`}
                  d={`M${x} ${H - bottom}V${H - bottom - bh + r}q0 ${-r} ${r} ${-r}h${barW - 2 * r}q${r} 0 ${r} ${r}V${H - bottom}Z`}
                />
              )}
              {/* A tall hit area over each day, easier to point at than the bar. */}
              <rect
                x={left + i * step}
                y={top}
                width={step}
                height={H - top - bottom}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
              />
              {labelAt.has(i) && (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  className="usage-axis"
                  textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
                >
                  {shortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={left} x2={W} y1={H - bottom} y2={H - bottom} className="usage-base" />
      </svg>
      {h && hover !== null && (
        <div
          className="usage-tip"
          style={{
            left: `${at * 100}%`,
            top: y(h.visitors),
            transform: `translate(${-Math.min(90, Math.max(10, at * 100))}%, calc(-100% - 8px))`,
          }}
        >
          <b>{longDay(h.day)}</b>
          <span>
            {h.visitors} visitor{h.visitors === 1 ? '' : 's'} · {h.views} page view
            {h.views === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </div>
  );
}

/** A ranked list with a bar for each share of the total. */
function Ranked({
  title,
  rows,
  name,
  empty,
}: {
  title: string;
  rows: Count[];
  name?: (key: string) => string;
  empty: string;
}) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="usage-list">
      <h3>{title}</h3>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <span className="usage-fill" style={{ width: `${(r.n / max) * 100}%` }} />
              <span className="usage-name">{name ? name(r.key) : r.key}</span>
              <b>{r.n}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </div>
  );
}

export function UsageSection() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setUsage(await api<Usage>('GET', `/api/admin/usage?days=${days}`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);
  const appViews = usage?.pages.find((p) => p.key === '/app/')?.n ?? 0;
  return (
    <section className="people-card usage" data-testid="admin-usage">
      <div className="usage-head">
        <h2>
          <Eye size={18} /> Visitors
        </h2>
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === days ? 'active' : ''}
              aria-pressed={p === days}
              onClick={() => setDays(p)}
            >
              {p} days
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">
        Everyone, with or without an account. Anonymous counts by day: no cookie, no IP address
        kept; browsers asking not to be tracked are not counted.
      </p>
      {error && <p className="warning small">{error}</p>}
      {usage && (
        <>
          <div className="admin-tiles">
            <div className="admin-tile">
              <span className="muted small">Visitors today</span>
              <b>{usage.today.visitors}</b>
              <span className="muted small">{usage.today.views} page views</span>
            </div>
            <div className="admin-tile">
              <span className="muted small">Visitors, {days} days</span>
              <b>{usage.visitors}</b>
              <span className="muted small">one per person per day</span>
            </div>
            <div className="admin-tile">
              <span className="muted small">Page views, {days} days</span>
              <b>{usage.views}</b>
            </div>
            <div className="admin-tile">
              <span className="muted small">App opened, {days} days</span>
              <b>{appViews}</b>
            </div>
          </div>
          <DailyChart days={usage.days} />
          <div className="usage-lists">
            <Ranked
              title="Where they come from"
              rows={usage.sources}
              name={(k) => (k === 'direct' ? 'Direct (typed, bookmark, app)' : k)}
              empty="Nothing yet."
            />
            <Ranked
              title="Pages"
              rows={usage.pages}
              name={(k) => PAGE_NAMES[k] ?? k}
              empty="Nothing yet."
            />
            <Ranked
              title="In the app"
              rows={usage.actions}
              name={(k) => ACTION_NAMES[k] ?? k}
              empty="Nothing yet."
            />
            <Ranked
              title="Countries"
              rows={usage.countries}
              name={countryName}
              empty="Known behind Cloudflare only."
            />
            <Ranked
              title="Devices"
              rows={usage.devices}
              name={(k) => DEVICE_NAMES[k] ?? k}
              empty="Nothing yet."
            />
          </div>
        </>
      )}
    </section>
  );
}
