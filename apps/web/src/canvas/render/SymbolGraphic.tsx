import { GRID } from '@overleagger/core';
import { fillTemplate, type Primitive, type TextPrimitive } from '@overleagger/symbols';
import { memo } from 'react';
import { FONT_SERIF } from '../../theme';
import { Tex } from '../../latex/Tex';
import { arcPath, scalePath } from './paths';

const S = GRID;

export interface Ink {
  color: string;
  paper: string;
  /** Base stroke width in px. */
  width: number;
}

function strokeProps(p: Exclude<Primitive, TextPrimitive>, ink: Ink) {
  const sw = p.sw ?? 1;
  const fill = p.fill === 'ink' ? ink.color : p.fill === 'paper' ? ink.paper : 'none';
  const dash =
    p.dash === 'dashed'
      ? `${ink.width * 3.2} ${ink.width * 2.4}`
      : p.dash === 'dotted'
        ? `0.1 ${ink.width * 2.4}`
        : undefined;
  return {
    stroke: sw === 0 ? 'none' : ink.color,
    strokeWidth: sw === 0 ? undefined : ink.width * sw,
    fill,
    strokeDasharray: dash,
  };
}

/** Render the non-text primitives of a symbol (coordinates in grid units). */
export const SymbolShapes = memo(function SymbolShapes({
  prims,
  ink,
}: {
  prims: Primitive[];
  ink: Ink;
}) {
  return (
    <>
      {prims.map((p, i) => {
        switch (p.k) {
          case 'line':
            return (
              <line
                key={i}
                x1={p.x1 * S}
                y1={p.y1 * S}
                x2={p.x2 * S}
                y2={p.y2 * S}
                {...strokeProps(p, ink)}
              />
            );
          case 'poly': {
            const pts = p.pts.map((v) => v * S).join(' ');
            const props = strokeProps(p, ink);
            return p.closed ? (
              <polygon key={i} points={pts} {...props} />
            ) : (
              <polyline key={i} points={pts} {...props} fill={props.fill} />
            );
          }
          case 'circle':
            return (
              <circle key={i} cx={p.cx * S} cy={p.cy * S} r={p.r * S} {...strokeProps(p, ink)} />
            );
          case 'arc':
            return (
              <path
                key={i}
                d={arcPath(p.cx * S, p.cy * S, p.r * S, p.a0, p.a1)}
                {...strokeProps(p, ink)}
              />
            );
          case 'rect':
            return (
              <rect
                key={i}
                x={p.x * S}
                y={p.y * S}
                width={p.w * S}
                height={p.h * S}
                rx={p.rx ? p.rx * S : undefined}
                {...strokeProps(p, ink)}
              />
            );
          case 'path':
            return <path key={i} d={scalePath(p.d, S)} {...strokeProps(p, ink)} />;
          case 'text':
            return null;
        }
      })}
    </>
  );
});

/**
 * Upright text primitive at a world position. Text inside symbols never rotates or mirrors with
 * the symbol, which keeps labels readable.
 */
export function SymbolText({
  p,
  x,
  y,
  color,
  params,
  anchor,
}: {
  p: TextPrimitive;
  x: number;
  y: number;
  color: string;
  params: Record<string, string>;
  anchor?: 'start' | 'middle' | 'end';
}) {
  const t = fillTemplate(p.t, params);
  if (!t) return null;
  const size = (p.size ?? 1.2) * S;
  const a = anchor ?? p.anchor ?? 'middle';
  if (p.math) return <Tex tex={t} x={x} y={y} size={size} color={color} anchor={a} display />;
  return (
    <text
      x={x}
      y={y}
      dy={size * 0.34}
      fontSize={size}
      fill={color}
      textAnchor={a}
      fontFamily={FONT_SERIF}
      fontStyle={p.italic ? 'italic' : undefined}
      fontWeight={p.bold ? 700 : undefined}
    >
      {t}
    </text>
  );
}

/** Stand-alone preview of symbol graphics (library tiles, gallery). */
export function SymbolPreview({
  prims,
  bbox,
  ink,
  size,
  params = {},
}: {
  prims: Primitive[];
  bbox: { x: number; y: number; w: number; h: number };
  ink: Ink;
  size: number;
  params?: Record<string, string>;
}) {
  const pad = 0.8;
  const vb = [
    (bbox.x - pad) * S,
    (bbox.y - pad) * S,
    (bbox.w + 2 * pad) * S,
    (bbox.h + 2 * pad) * S,
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox={vb.join(' ')}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <SymbolShapes prims={prims} ink={ink} />
      {prims.map((p, i) =>
        p.k === 'text' ? (
          <SymbolText key={i} p={p} x={p.x * S} y={p.y * S} color={ink.color} params={params} />
        ) : null,
      )}
    </svg>
  );
}
