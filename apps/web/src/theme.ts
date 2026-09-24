export type ThemeName = 'paper' | 'blackboard';

export interface Theme {
  name: ThemeName;
  /** Canvas background. */
  paper: string;
  /** Default drawing colour (graphite / chalk). */
  ink: string;
  gridMinor: string;
  gridMajor: string;
  accent: string;
  accentSoft: string;
  /** Named ink colours, used as `@name` in element styles. */
  palette: Record<string, string>;
}

export const INK_NAMES = [
  'graphite',
  'pencil',
  'blue',
  'red',
  'green',
  'orange',
  'violet',
  'brown',
] as const;
export type InkName = (typeof INK_NAMES)[number];

export const THEMES: Record<ThemeName, Theme> = {
  paper: {
    name: 'paper',
    paper: '#f7f5ef',
    ink: '#262626',
    gridMinor: '#e7e3d9',
    gridMajor: '#d6d0c2',
    accent: '#2f5d9e',
    accentSoft: 'rgba(47, 93, 158, 0.14)',
    palette: {
      graphite: '#262626',
      pencil: '#6b6b6b',
      blue: '#1f4e8c',
      red: '#b0302f',
      green: '#2e6b3a',
      orange: '#c2621a',
      violet: '#6a3d9a',
      brown: '#7a4b2a',
    },
  },
  blackboard: {
    name: 'blackboard',
    paper: '#1f2723',
    ink: '#e9e6dc',
    gridMinor: '#28322d',
    gridMajor: '#334039',
    accent: '#8fb8e8',
    accentSoft: 'rgba(143, 184, 232, 0.18)',
    palette: {
      graphite: '#e9e6dc',
      pencil: '#a9a69c',
      blue: '#8fb8e8',
      red: '#f08a80',
      green: '#9ed39a',
      orange: '#f2b36d',
      violet: '#c3a6e6',
      brown: '#d6ae8a',
    },
  },
};

/** Resolve an element colour: undefined → theme ink, `@blue` → palette entry, else raw CSS colour. */
export function resolveColor(color: string | undefined, theme: Theme): string {
  if (!color) return theme.ink;
  if (color.startsWith('@')) return theme.palette[color.slice(1)] ?? theme.ink;
  return color;
}

export const DEFAULT_STROKE = 1.5;
export const FONT_SERIF = "'CMU Serif', 'Latin Modern Roman', 'Computer Modern', Georgia, serif";
export const FONT_MONO = "'CMU Typewriter Text', 'Latin Modern Mono', ui-monospace, monospace";
