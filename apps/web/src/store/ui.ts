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

export interface WireSegment {
  wireId: Id;
  index: number;
}

export interface DragPreview {
  ids: Id[];
  dx: number;
  dy: number;
  /** Segment drag of a single wire. */
  segment?: { wireId: Id; index: number };
}

/** Bottom drawer of the phone layout. */
export type PhoneSheet = null | 'tools' | 'parts' | 'sheets' | 'comments' | 'edit' | 'more';

export type Modal =
  | null
  | 'quickadd'
  | 'help'
  | 'shortcuts'
  | 'export'
  | 'rename'
  | 'symbol-editor'
  | 'save-template'
  | 'whatsnew';

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
  /** Widths of the side panels (px), set by dragging their edge. */
  leftWidth: number;
  rightWidth: number;
  /** Small feedback animations (also off when the system asks for reduced motion). */
  animations: boolean;
}

export interface UIState extends Settings {
  tool: ToolId;
  placing: Placing | null;
  sheetId: Id | null;
  selection: Id[];
  /** One segment of the selected wire, picked by clicking the wire again (moved / deleted alone). */
  wireSegment: WireSegment | null;
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
  /** Share window open (on the "access per sheet" of this sheet when given). */
  shareOpen: { sheetId?: string } | null;
  /** Short message shown at the bottom of the editor. */
  toast: { text: string; at: number; action?: { label: string; run: () => void } } | null;
  /** Comment bubble being dragged, and where it is now (saved when released). */
  commentDrag: { id: string; x: number; y: number } | null;
  showResolved: boolean;
  /** Presentation mode (full screen slides). */
  presenting: boolean;
  /** Phone layout: the drawer open at the bottom. */
  phoneSheet: PhoneSheet;
  /** Following someone else's presentation (their user id). */
  presentFollow: string | null;
  /** Start the presentation on this frame (Preview). */
  presentAt: Id | null;
  /** The Animation section of the properties panel is open (and the step badges shown). */
  animOpen: boolean;
  spaceDown: boolean;

  set: (patch: Partial<UIState>) => void;
  setTool: (tool: ToolId) => void;
  setSelection: (ids: Id[]) => void;
  setViewport: (sheetId: Id, vp: Viewport) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetEditor: () => void;
}

const SETTINGS_KEY = 'olg.settings';
/** Default width of the side panels (px). */
export const PANEL_WIDTH = 272;

function loadSettings(): Settings {
  const defaults: Settings = {
    theme: 'paper',
    showGrid: true,
    latexRefs: true,
    leftPanel: true,
    rightPanel: true,
    leftWidth: PANEL_WIDTH,
    rightWidth: PANEL_WIDTH,
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
  wireSegment: null,
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
  phoneSheet: null as PhoneSheet,
  presentFollow: null,
  presentAt: null,
  animOpen: false,
  commentDraft: null,
  openThread: null,
  commentDrag: null,
  toast: null,
  shareOpen: null,
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
      leftWidth: s.leftWidth,
      rightWidth: s.rightWidth,
      animations: s.animations,
    });
  },
  resetEditor: () => set({ ...transient, sheetId: null, viewports: {} }),
}));

// A picked wire segment belongs to the selection it was picked in: any other selection drops it.
useUI.subscribe((s, prev) => {
  if (s.wireSegment && s.selection !== prev.selection && s.wireSegment === prev.wireSegment)
    useUI.setState({ wireSegment: null });
});
