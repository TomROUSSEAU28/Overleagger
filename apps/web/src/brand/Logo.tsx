import { useId } from 'react';

/**
 * The Circuit Notebook mark: a page of a ruled notebook (red margin, blue lines) with a
 * resistor drawn in graphite. Same drawing as `public/brand/logo.svg`.
 */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  const clip = useId();
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <rect x="5" y="5" width="54" height="54" rx="9" />
        </clipPath>
      </defs>
      <rect x="5" y="5" width="54" height="54" rx="9" fill="#f7f3e8" />
      <g clipPath={`url(#${clip})`}>
        <path d="M5 20.5H59M5 43.5H59" stroke="#9db5d6" strokeWidth="1.4" />
        <path d="M17 5V59" stroke="#d24b3e" strokeWidth="2.2" />
      </g>
      <path
        d="M17 32H23L25.5 25.5L30.5 38.5L35.5 25.5L40.5 38.5L43 32H48"
        fill="none"
        stroke="#262626"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="51" cy="32" r="3" fill="#f7f3e8" stroke="#262626" strokeWidth="2.4" />
      <circle cx="17" cy="32" r="3.6" fill="#262626" />
      <rect
        x="5"
        y="5"
        width="54"
        height="54"
        rx="9"
        fill="none"
        stroke="#262626"
        strokeWidth="3"
      />
    </svg>
  );
}

/** Full-page “please wait” with the logo (opening a project, signing in…). */
export function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status">
      <Logo size={56} className="loading-logo" />
      <p>{text}</p>
    </div>
  );
}
