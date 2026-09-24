import { FONT_SERIF } from '../theme';
import { renderTex, useTexVersion } from './texCache';

export interface TexProps {
  tex: string;
  x: number;
  y: number;
  /** Font size in px. */
  size: number;
  color: string;
  /** Horizontal anchor of (x, y). The vertical position is the centre of the formula. */
  anchor?: 'start' | 'middle' | 'end';
  display?: boolean;
}

/** LaTeX formula drawn inside an SVG, centred vertically on y. */
export function Tex({ tex, x, y, size, color, anchor = 'middle', display = false }: TexProps) {
  useTexVersion();
  if (!tex.trim()) return null;
  const r = renderTex(tex, display);
  if (!r) {
    return (
      <text
        x={x}
        y={y}
        dy={size * 0.34}
        fontSize={size}
        fill={color}
        textAnchor={anchor}
        fontStyle="italic"
        fontFamily={FONT_SERIF}
      >
        {tex}
      </text>
    );
  }
  const [vx, vy, vw, vh] = r.vb;
  const w = (vw / 1000) * size;
  const h = (vh / 1000) * size;
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return (
    <svg
      x={left}
      y={y - h / 2}
      width={w}
      height={h}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      overflow="visible"
      dangerouslySetInnerHTML={{ __html: r.inner.replaceAll('currentColor', color) }}
    />
  );
}
