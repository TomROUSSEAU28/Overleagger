import type { Anchor, Handle, Id, Pt, Rect, Rot, ShapeKind } from '@overleagger/core';
import type { OptionValue } from '@overleagger/symbols';
import { create } from 'zustand';
import type { ThemeName } from '../theme';

export type ToolId =
  | 'comment'
  | 'select'
  | 'pan'
  | 'wire'
  | 'signal'
  | 'block'
  | 'port'
  | 'label'
  | 'text'
  | 'place'
  | 'draw'
  | 'eraser'
  | 'shape'
  | 'line'
  | 'note'
  | 'image'
  | 'button'
  | 'waveform'
  | 'frame';

export interface ToolPrefs {
  shapeKind: ShapeKind;
  sketch: boolean;
  arrow: boolean;
  penSize: number;
  highlighter: boolean;
  /** Routing of new connectors attached to shapes (flowcharts). */
  route?: 'straight' | 'elbow';
  /** Ink colour used for new strokes, shapes and lines (`@name` or CSS colour). */
  inkColor?: string;
}

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

export type Modal =
  | null
  | 'quickadd'
  | 'help'
  | 'shortcuts'
  | 'export'
  | 'rename'
  | 'symbol-editor'
  | 'save-template';

/** Live preview of a resize / line edit. */
export interface ResizePreview {
  id: Id;
  rect?: Rect;
  pts?: number[];
  bend?: number;
}

export interface InlineEdit {
  id: Id;
  field: 'text' | 'name' | 'title' | 'label';
}

interface Settings {
  theme: ThemeName;
  showGrid: boolean;
  latexRefs: boolean;
  leftPanel: boolean;
  rightPanel: boolean;
  /** Small feedback animations (also off when the system asks for reduced motion). */
  animations: boolean;
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
  /** Rectangle being drawn by the shape / frame / waveform tools. */
  rectDraft: Rect | null;
  lineDraft: number[] | null;
  strokeDraft: number[] | null;
  resize: ResizePreview | null;
  erasing: Id[];
  handle: Handle | null;
  prefs: ToolPrefs;
  /** Symbol opened in the symbol editor (undefined = new symbol). */
  editingSymbol: {
    id?: string;
    from?: string;
    opts?: Record<string, OptionValue>;
    /** Component switched to the new symbol when it is saved. */
    replaceId?: Id;
  } | null;
  /** Template being renamed in the save-template dialog (null = save the selection). */
  editingTemplate: string | null;
  hoverPin: Pt | null;
  cursor: Pt | null;
  modal: Modal;
  inlineEdit: InlineEdit | null;
  leftTab: 'library' | 'sheets' | 'templates' | 'comments';
  /** New comment being written at this point (world px). */
  commentDraft: Pt | null;
  /** Element whose connection points are shown (line tool). */
  anchorHover: Id | null;
  /** Connection points used by the connector being drawn. */
  lineDraftEnds: { from?: Anchor; to?: Anchor } | null;
  /** Comment thread shown in its popup. */
  openThread: string | null;
  /** Comment bubble being dragged, and where it is now (saved when released). */
  commentDrag: { id: string; x: number; y: number } | null;
  showResolved: boolean;
  /** Presentation mode (full screen slides). */
  presenting: boolean;
  /** Following someone else's presentation (their user id). */
  presentFollow: string | null;
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
    animations: true,
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
  rectDraft: null,
  lineDraft: null,
  strokeDraft: null,
  resize: null,
  erasing: [] as Id[],
  handle: null,
  editingSymbol: null,
  editingTemplate: null,
  hoverPin: null,
  cursor: null,
  modal: null as Modal,
  inlineEdit: null,
  presenting: false,
  presentFollow: null,
  commentDraft: null,
  openThread: null,
  commentDrag: null,
  anchorHover: null,
  lineDraftEnds: null,
};

export const useUI = create<UIState>((set, get) => ({
  ...loadSettings(),
  ...transient,
  sheetId: null,
  viewports: {},
  prefs: { shapeKind: 'rect', sketch: false, arrow: true, penSize: 3, highlighter: false },
  leftTab: 'library',
  spaceDown: false,
  showResolved: false,

  set: (patch) => set(patch),
  setTool: (tool) =>
    set({
      tool,
      wireDraft: null,
      ghost: null,
      blockDraft: null,
      rectDraft: null,
      lineDraft: null,
      strokeDraft: null,
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
      animations: s.animations,
    });
  },
  resetEditor: () => set({ ...transient, sheetId: null, viewports: {} }),
}));
