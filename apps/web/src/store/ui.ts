import type { Id, Pt, Rect, Rot } from '@overleagger/core';
import type { OptionValue } from '@overleagger/symbols';
import { create } from 'zustand';
import type { ThemeName } from '../theme';

export type ToolId =
  'select' | 'pan' | 'wire' | 'signal' | 'block' | 'port' | 'label' | 'text' | 'place';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Placing {
  symbolId: string;
  rot: Rot;
  mirror: boolean;
  opts?: Record<string, OptionValue>;
}

export interface WireDraft {
  /** Committed vertices (flat). */
  pts: number[];
  cursor: Pt;
  hFirst: boolean;
  /** User forced the bend direction with `/`. */
  manual: boolean;
}

export interface DragPreview {
  ids: Id[];
  dx: number;
  dy: number;
  /** Segment drag of a single wire. */
  segment?: { wireId: Id; index: number };
}

export type Modal = null | 'quickadd' | 'help' | 'shortcuts' | 'export' | 'rename';

export interface InlineEdit {
  id: Id;
  field: 'text' | 'name' | 'title';
}

interface Settings {
  theme: ThemeName;
  showGrid: boolean;
  latexRefs: boolean;
  leftPanel: boolean;
  rightPanel: boolean;
}

export interface UIState extends Settings {
  tool: ToolId;
  placing: Placing | null;
  sheetId: Id | null;
  selection: Id[];
  viewports: Record<Id, Viewport>;
  wireDraft: WireDraft | null;
  drag: DragPreview | null;
  marquee: Rect | null;
  ghost: Pt | null;
  blockDraft: Rect | null;
  hoverPin: Pt | null;
  cursor: Pt | null;
  modal: Modal;
  inlineEdit: InlineEdit | null;
  leftTab: 'library' | 'sheets';
  spaceDown: boolean;

  set: (patch: Partial<UIState>) => void;
  setTool: (tool: ToolId) => void;
  setSelection: (ids: Id[]) => void;
  setViewport: (sheetId: Id, vp: Viewport) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetEditor: () => void;
}

const SETTINGS_KEY = 'olg.settings';

function loadSettings(): Settings {
  const defaults: Settings = {
    theme: 'paper',
    showGrid: true,
    latexRefs: true,
    leftPanel: true,
    rightPanel: true,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // storage unavailable
  }
  return defaults;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable
  }
}

const transient = {
  tool: 'select' as ToolId,
  placing: null,
  selection: [],
  wireDraft: null,
  drag: null,
  marquee: null,
  ghost: null,
  blockDraft: null,
  hoverPin: null,
  cursor: null,
  modal: null as Modal,
  inlineEdit: null,
};

export const useUI = create<UIState>((set, get) => ({
  ...loadSettings(),
  ...transient,
  sheetId: null,
  viewports: {},
  leftTab: 'library',
  spaceDown: false,

  set: (patch) => set(patch),
  setTool: (tool) =>
    set({
      tool,
      wireDraft: null,
      ghost: null,
      blockDraft: null,
      ...(tool !== 'place' ? { placing: null } : {}),
    }),
  setSelection: (ids) => set({ selection: ids }),
  setViewport: (sheetId, vp) => set({ viewports: { ...get().viewports, [sheetId]: vp } }),
  setSetting: (key, value) => {
    set({ [key]: value } as Partial<UIState>);
    const s = get();
    saveSettings({
      theme: s.theme,
      showGrid: s.showGrid,
      latexRefs: s.latexRefs,
      leftPanel: s.leftPanel,
      rightPanel: s.rightPanel,
    });
  },
  resetEditor: () => set({ ...transient, sheetId: null, viewports: {} }),
}));
