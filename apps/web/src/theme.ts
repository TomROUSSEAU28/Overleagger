export type ThemeName = 'paper' | 'whiteboard' | 'blackboard';

export const THEME_NAMES: { name: ThemeName; label: string }[] = [
  { name: 'paper', label: 'Lab notebook (cream paper)' },
  { name: 'whiteboard', label: 'Whiteboard (white)' },
  { name: 'blackboard', label: 'Blackboard (chalk)' },
];

export interface Theme {
  name: ThemeName;
  /** Canvas background. */
  paper: string;
  /** Default drawing colour (graphite / marker / chalk). */
  ink: string;
  gridMinor: string;
  gridMajor: string;
  accent: string;
  accentSoft: string;
  /**
   * Selection colour: "non-photo blue", the light blue pencil draughtsmen use for
   * construction lines — visible on screen, never part of the drawing.
   */
  select: string;
  selectSoft: string;
  /** Named ink colours, used as `@name` in element styles. */
  palette: Record<string, string>;
  /** Sticky-note paper colours. */
  notes: Record<string, string>;
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

export const NOTE_NAMES = ['yellow', 'blue', 'green', 'pink', 'white'] as const;

const lightPalette = {
  graphite: '#262626',
  pencil: '#6b6b6b',
  blue: '#1f4e8c',
  red: '#b0302f',
  green: '#2e6b3a',
  orange: '#c2621a',
  violet: '#6a3d9a',
  brown: '#7a4b2a',
};

const lightNotes = {
  yellow: '#fbeea0',
  blue: '#cfe3f6',
  green: '#d4ecc9',
  pink: '#f6d3dc',
  white: '#ffffff',
};

export const THEMES: Record<ThemeName, Theme> = {
  paper: {
    name: 'paper',
    paper: '#f7f5ef',
    ink: '#262626',
    gridMinor: '#e7e3d9',
    gridMajor: '#d6d0c2',
    accent: '#2f5d9e',
    accentSoft: 'rgba(47, 93, 158, 0.14)',
    select: '#4f8fd6',
    selectSoft: 'rgba(79, 143, 214, 0.07)',
    palette: lightPalette,
    notes: lightNotes,
  },
  whiteboard: {
    name: 'whiteboard',
    paper: '#ffffff',
    ink: '#1d1f22',
    gridMinor: '#eef0f3',
    gridMajor: '#dde1e6',
    accent: '#2563b8',
    accentSoft: 'rgba(37, 99, 184, 0.12)',
    select: '#3f8ae0',
    selectSoft: 'rgba(63, 138, 224, 0.06)',
    palette: { ...lightPalette, graphite: '#1d1f22', blue: '#1b55b3', red: '#c62828' },
    notes: lightNotes,
  },
  blackboard: {
    name: 'blackboard',
    paper: '#1f2723',
    ink: '#e9e6dc',
    gridMinor: '#28322d',
    gridMajor: '#334039',
    accent: '#8fb8e8',
    accentSoft: 'rgba(143, 184, 232, 0.18)',
    select: '#8fc3f2',
    selectSoft: 'rgba(143, 195, 242, 0.08)',
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
    notes: {
      yellow: '#6b6128',
      blue: '#2d4a66',
      green: '#35553a',
      pink: '#5f3945',
      white: '#3a4540',
    },
  },
};

/** Resolve an element colour: undefined → theme ink, `@blue` → palette entry, else raw CSS colour. */
export function resolveColor(color: string | undefined, theme: Theme): string {
  if (!color) return theme.ink;
  if (color.startsWith('@')) return theme.palette[color.slice(1)] ?? theme.ink;
  return color;
}

/** Sticky-note colour: `@yellow` → theme note colour, else raw CSS colour. */
export function resolveNoteColor(color: string | undefined, theme: Theme): string {
  if (!color) return theme.notes.yellow!;
  if (color.startsWith('@')) return theme.notes[color.slice(1)] ?? theme.notes.yellow!;
  return color;
}

export const DEFAULT_STROKE = 1.5;
export const FONT_SERIF = "'CMU Serif', 'Latin Modern Roman', 'Computer Modern', Georgia, serif";
export const FONT_MONO = "'CMU Typewriter Text', 'Latin Modern Mono', ui-monospace, monospace";
