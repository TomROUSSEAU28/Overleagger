import type { OptionValue, Standard, StaticSymbolDef } from '@overleagger/symbols';

export type Id = string;

/** Quarter turns, clockwise. */
export type Rot = 0 | 1 | 2 | 3;

/** Canvas pixels per grid unit. Symbol geometry is authored in grid units. */
export const GRID = 10;

export type Dash = 'solid' | 'dashed' | 'dotted';

export interface ElementStyle {
  /** Ink colour; undefined = theme ink. */
  color?: string;
  /** Stroke width in px; undefined = default. */
  width?: number;
  dash?: Dash;
  /** Fill colour for blocks / text backgrounds. */
  fill?: string;
}

interface BaseElement {
  id: Id;
  /** Stacking order (higher is drawn on top). */
  z: number;
  /** Id of the group this element belongs to. */
  groupId?: Id;
  locked?: boolean;
  style?: ElementStyle;
}

export interface ComponentElement extends BaseElement {
  type: 'component';
  symbolId: string;
  x: number;
  y: number;
  rot: Rot;
  mirror: boolean;
  /** Symbol options (body diode, circle, channel…). */
  opts: Record<string, OptionValue>;
  /** Text parameters: `value` plus symbol specific ones (e.g. `tex`). */
  params: Record<string, string>;
  /** Reference designator, e.g. "R1". */
  ref: string;
  /** Override of the project drawing standard. */
  standard?: Standard;
  showRef?: boolean;
  showValue?: boolean;
  /** Size factor of the symbol (1 = normal). Only values keeping the pins on the grid. */
  scale?: number;
}

export type WireKind = 'power' | 'signal';
export type ArrowMode = 'none' | 'end' | 'start' | 'both';

export interface WireElement extends BaseElement {
  type: 'wire';
  /** Flat list of vertices [x0, y0, x1, y1, …] in px. */
  pts: number[];
  kind: WireKind;
  arrow?: ArrowMode;
}

export interface BlockElement extends BaseElement {
  type: 'block';
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  /** Optional LaTeX line drawn under the title. */
  tex?: string;
  childSheetId: Id;
}

export type PortDir = 'in' | 'out' | 'io';
export type Side = 'l' | 'r' | 't' | 'b';

export interface PortElement extends BaseElement {
  type: 'port';
  x: number;
  y: number;
  name: string;
  dir: PortDir;
  /** Side of the parent block where the matching pin appears (default from `dir`). */
  side?: Side;
  /** Draw the port shape on the other side of its connection point. */
  flip?: boolean;
}

export interface LabelElement extends BaseElement {
  type: 'label';
  x: number;
  y: number;
  text: string;
  /** Flag drawn to the left of its connection point. */
  flip?: boolean;
}

export type TextAlign = 'start' | 'middle' | 'end';

export interface TextElement extends BaseElement {
  type: 'text';
  x: number;
  y: number;
  /** Plain text; `$…$` segments are rendered as LaTeX. */
  text: string;
  /** Font size in px. */
  size: number;
  align: TextAlign;
  /** Optional frame around the text. */
  frame?: 'box' | 'round' | 'double' | 'underline';
}

export interface GroupElement extends BaseElement {
  type: 'group';
  name?: string;
}

/** Common fields of elements drawn inside a rectangle (resizable with handles). */
export interface BoxFields {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'triangle';

export interface ShapeElement extends BaseElement, BoxFields {
  type: 'shape';
  kind: ShapeKind;
  /** Where a triangle points (default 't', apex up). */
  dir?: Side;
  /** Corner radius for rectangles (px). */
  radius?: number;
  /** Hand-drawn rendering (rough.js). */
  sketch?: boolean;
  /** Optional centred text / LaTeX. */
  text?: string;
}

export interface LineElement extends BaseElement {
  type: 'line';
  /** Two points [x1, y1, x2, y2]. */
  pts: number[];
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** Curvature: offset of the control point from the middle, perpendicular to the line (px). */
  bend?: number;
  sketch?: boolean;
  /** Optional label (LaTeX with $…$) at the middle. */
  text?: string;
}

export interface StrokeElement extends BaseElement {
  type: 'stroke';
  /** Freehand points as triples [x, y, pressure, …]. */
  pts: number[];
  /** Pen size in px. */
  size: number;
  /** Highlighter: wide and translucent. */
  highlighter?: boolean;
}

export interface ImageElement extends BaseElement, BoxFields {
  type: 'image';
  /** Data URL of the (downscaled) image. */
  src: string;
  name?: string;
  flipX?: boolean;
  flipY?: boolean;
}

export interface NoteElement extends BaseElement, BoxFields {
  type: 'note';
  text: string;
  /** Paper colour of the sticky note. */
  color: string;
}

export type LinkTarget = { kind: 'url'; url: string } | { kind: 'sheet'; sheetId: Id };

export interface ButtonElement extends BaseElement, BoxFields {
  type: 'button';
  label: string;
  link: LinkTarget;
}

export type TraceKind =
  | 'sine'
  | 'square'
  | 'triangle'
  | 'sawtooth'
  | 'pwm'
  | 'halfwave'
  | 'fullwave'
  | 'ripple'
  | 'step1'
  | 'step2'
  | 'exp'
  | 'dc'
  | 'custom';

export interface Trace {
  id: string;
  kind: TraceKind;
  /** Peak amplitude (normalized, 1 = full band height / 2). */
  amp: number;
  offset: number;
  /** Number of periods shown. */
  periods: number;
  /** Phase in degrees. */
  phase: number;
  /** Duty cycle 0…1 (square / PWM / sawtooth). */
  duty: number;
  /** Time constant as a fraction of the width (step / exp). */
  tau: number;
  /** Damping ratio (2nd-order step). */
  zeta: number;
  /** Ripple amplitude relative to amp (ripple). */
  ripple: number;
  /** Custom waveform: normalized points [t0, v0, t1, v1…] with t in 0…1 and v in −1…1. */
  points?: number[];
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface WaveformElement extends BaseElement, BoxFields {
  type: 'waveform';
  traces: Trace[];
  /** Overlay = all traces on one axis; stacked = one band per trace (chronogram). */
  layout: 'overlay' | 'stacked';
  xLabel: string;
  yLabel: string;
  grid: boolean;
  axes: boolean;
}

export interface FrameElement extends BaseElement, BoxFields {
  type: 'frame';
  name: string;
}

export type Element =
  | ComponentElement
  | WireElement
  | BlockElement
  | PortElement
  | LabelElement
  | TextElement
  | GroupElement
  | ShapeElement
  | LineElement
  | StrokeElement
  | ImageElement
  | NoteElement
  | ButtonElement
  | WaveformElement
  | FrameElement;

/** Elements positioned by a rectangle (x, y, w, h). */
export type BoxElement =
  | BlockElement
  | ShapeElement
  | ImageElement
  | NoteElement
  | ButtonElement
  | WaveformElement
  | FrameElement;

export const BOX_TYPES = [
  'block',
  'shape',
  'image',
  'note',
  'button',
  'waveform',
  'frame',
] as const;

export function isBox(el: Element): el is BoxElement {
  return (BOX_TYPES as readonly string[]).includes(el.type);
}

export type ElementType = Element['type'];

/** Distributive Omit that keeps the discriminated union intact. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NewElement = DistributiveOmit<Element, 'id' | 'z'> & { id?: Id; z?: number };

export interface SheetInfo {
  id: Id;
  name: string;
  /** Parent sheet (undefined for the root sheet). */
  parentSheetId?: Id;
  /** Block (in the parent sheet) that opens this sheet. */
  blockId?: Id;
}

export interface ProjectMeta {
  name: string;
  standard: Standard;
  rootSheetId: Id;
  formatVersion: number;
  createdAt: number;
  /** Custom colours of the project (CSS colours). */
  palette?: string[];
}

export type ProjectSymbol = StaticSymbolDef;

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
