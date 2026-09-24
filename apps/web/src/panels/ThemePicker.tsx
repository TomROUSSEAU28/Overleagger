import { useUI } from '../store/ui';
import { THEMES, THEME_NAMES } from '../theme';

/** Three paper swatches: cream lab notebook, white whiteboard, blackboard. */
export function ThemePicker() {
  const theme = useUI((s) => s.theme);
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme">
      {THEME_NAMES.map((t) => (
        <button
          key={t.name}
          type="button"
          role="radio"
          aria-checked={theme === t.name}
          className={`theme-swatch${theme === t.name ? ' active' : ''}`}
          title={t.label}
          data-testid={`theme-${t.name}`}
          style={{ background: THEMES[t.name].paper, color: THEMES[t.name].ink }}
          onClick={() => useUI.getState().setSetting('theme', t.name)}
        >
          <svg width={14} height={14} viewBox="0 0 14 14">
            <path
              d="M2 10 L5 4 L8 9 L12 3"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
