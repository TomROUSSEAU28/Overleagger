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
}

export interface GroupElement extends BaseElement {
  type: 'group';
  name?: string;
}

export type Element =
  | ComponentElement
  | WireElement
  | BlockElement
  | PortElement
  | LabelElement
  | TextElement
  | GroupElement;

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
