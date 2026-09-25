import type { Element, SheetContext } from '@overleagger/core';
import { DEFAULT_STROKE, resolveColor, type Theme } from '../../theme';
import type { Ink } from './SymbolGraphic';

export interface RenderOptions {
  theme: Theme;
  ctx: SheetContext;
  /** Add transparent hit areas and data attributes for pointer interaction. */
  interactive: boolean;
  /** Render references like R1 as LaTeX R₁. */
  latexRefs: boolean;
  /** Project drawing standard (only used to invalidate memoized views). */
  standard?: string;
  /** Custom-symbol revision (only used to invalidate memoized views). */
  symbolsVersion?: number;
  /** Presenting: animated currents run while they are shown. */
  live?: boolean;
}

export const dashArray = (dash: string | undefined, w: number) =>
  dash === 'dashed' ? `${w * 4} ${w * 3}` : dash === 'dotted' ? `0.1 ${w * 2.6}` : undefined;

export function inkOf(el: Element, o: RenderOptions): Ink {
  return {
    color: resolveColor(el.style?.color, o.theme),
    paper: o.theme.paper,
    width: el.style?.width ?? DEFAULT_STROKE,
  };
}

/** Plain or mixed (`$…$`) text line. */
