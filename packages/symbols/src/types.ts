/**
 * Symbol geometry is expressed in grid units (GU). One grid unit is 10 px on the canvas at zoom 1.
 * The y axis points down (SVG convention). Angles are in degrees, clockwise on screen.
 */

export type Standard = 'IEC' | 'ANSI';

/** `ink` fills with the stroke colour, `paper` fills with the background colour (hides what is behind). */
export type Fill = 'none' | 'ink' | 'paper';

export interface StrokeOpts {
  /** Stroke width multiplier (1 = the element's base stroke width). 0 = no stroke. */
  sw?: number;
  dash?: 'dashed' | 'dotted';
  fill?: Fill;
}

export type TextAnchor = 'start' | 'middle' | 'end';

export type Primitive =
  | ({ k: 'line'; x1: number; y1: number; x2: number; y2: number } & StrokeOpts)
  /** Flat list of coordinates: [x0, y0, x1, y1, …]. */
  | ({ k: 'poly'; pts: number[]; closed?: boolean } & StrokeOpts)
  | ({ k: 'circle'; cx: number; cy: number; r: number } & StrokeOpts)
  /** Arc from angle a0 to a1 (a1 > a0), sweeping clockwise on screen. */
  | ({ k: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number } & StrokeOpts)
  | ({ k: 'rect'; x: number; y: number; w: number; h: number; rx?: number } & StrokeOpts)
  /** Raw SVG path in grid units. Only absolute commands M L H V C Q A Z are supported. */
  | ({ k: 'path'; d: string } & StrokeOpts)
  | TextPrimitive;

export interface TextPrimitive {
  k: 'text';
  x: number;
  y: number;
  /** Text content. `{name}` is replaced by the element parameter `name`. */
  t: string;
  /** Font size in grid units (default 1.2). */
  size?: number;
  anchor?: TextAnchor;
  /** Render the text as LaTeX math. */
  math?: boolean;
  italic?: boolean;
  bold?: boolean;
}

export interface PinDef {
  id: string;
  /** Human readable name shown in the UI (e.g. "Drain"). */
  name?: string;
  x: number;
  y: number;
}

export interface SymbolGraphics {
  prims: Primitive[];
  pins: PinDef[];
}

export type OptionValue = string | number | boolean;

export type OptionDef =
  | { key: string; label: string; type: 'bool'; default: boolean }
  | {
      key: string;
      label: string;
      type: 'enum';
      default: string;
      choices: { value: string; label: string }[];
    }
  | {
      key: string;
      label: string;
      type: 'number';
      default: number;
      min: number;
      max: number;
      step: number;
    };

export interface ParamDef {
  key: string;
  label: string;
  default: string;
  /** The parameter holds LaTeX (edited with a math hint). */
  math?: boolean;
  multiline?: boolean;
}

export interface BuildContext {
  standard: Standard;
  opts: Record<string, OptionValue>;
}

export type SymbolKind = 'electrical' | 'control' | 'annotation';

export interface SymbolDef {
  id: string;
  name: string;
  category: string;
  keywords?: string[];
  kind?: SymbolKind;
  /** Prefix used for automatic reference designators (R → R1, R2…). Empty = no reference shown. */
  refPrefix: string;
  defaultValue?: string;
  /** Extra editable text parameters, used by `{key}` placeholders in text primitives. */
  params?: ParamDef[];
  options?: OptionDef[];
  /** The value is drawn inside the symbol by a text primitive, so no external value label. */
  hideValueLabel?: boolean;
  build: (ctx: BuildContext) => SymbolGraphics;
}

/** Serializable symbol stored inside a project (custom symbols). */
export interface StaticSymbolDef {
  id: string;
  name: string;
  category: string;
  keywords?: string[];
  kind?: SymbolKind;
  refPrefix: string;
  defaultValue?: string;
  params?: ParamDef[];
  hideValueLabel?: boolean;
  graphics: SymbolGraphics;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
