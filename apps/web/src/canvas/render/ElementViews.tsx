import {
  LABEL_SIZE,
  blockLayout,
  componentLabels,
  componentPoint,
  portShape,
  portTextPos,
  resolveComponent,
  textWidth,
  type BlockElement,
  type ComponentElement,
  type Element,
  type LabelElement,
  type PortElement,
  type SheetContext,
  type TextElement,
  type WireElement,
} from '@overleagger/core';
import { memo } from 'react';
import { Tex } from '../../latex/Tex';
import { hasMath, mixedToTex } from '../../latex/texCache';
import { refToTex } from './labels';
import { DEFAULT_STROKE, FONT_SERIF, resolveColor, type Theme } from '../../theme';
import { SymbolShapes, SymbolText, type Ink } from './SymbolGraphic';

export interface RenderOptions {
  theme: Theme;
  ctx: SheetContext;
  /** Add transparent hit areas and data attributes for pointer interaction. */
  interactive: boolean;
  /** Render references like R1 as LaTeX R₁. */
  latexRefs: boolean;
  /** Project drawing standard (only used to invalidate memoized views). */
  standard?: string;
}

const dashArray = (dash: string | undefined, w: number) =>
  dash === 'dashed' ? `${w * 4} ${w * 3}` : dash === 'dotted' ? `0.1 ${w * 2.6}` : undefined;

function inkOf(el: Element, o: RenderOptions): Ink {
  return {
    color: resolveColor(el.style?.color, o.theme),
    paper: o.theme.paper,
    width: el.style?.width ?? DEFAULT_STROKE,
  };
}

/** Plain or mixed (`$…$`) text line. */
export function RichText({
  text,
  x,
  y,
  size,
  color,
  anchor,
  italic,
}: {
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  anchor: 'start' | 'middle' | 'end';
  italic?: boolean;
}) {
  if (hasMath(text))
    return (
      <Tex tex={mixedToTex(text)} x={x} y={y} size={size * 1.05} color={color} anchor={anchor} />
    );
  return (
    <text
      x={x}
      y={y}
      dy={size * 0.34}
      fontSize={size}
      fill={color}
      textAnchor={anchor}
      fontFamily={FONT_SERIF}
      fontStyle={italic ? 'italic' : undefined}
    >
      {text}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ComponentView = memo(function ComponentView({
  el,
  o,
}: {
  el: ComponentElement;
  o: RenderOptions;
}) {
  const ink = inkOf(el, o);
  const r = resolveComponent(el, o.ctx);
  if (!r) {
    return (
      <g data-id={o.interactive ? el.id : undefined} className="el">
        <rect
          x={el.x - 10}
          y={el.y - 10}
          width={20}
          height={20}
          fill="none"
          stroke="#c0392b"
          strokeDasharray="3 2"
        />
        <text
          x={el.x}
          y={el.y}
          fontSize={12}
          fill="#c0392b"
          textAnchor="middle"
          dominantBaseline="central"
        >
          ?
        </text>
      </g>
    );
  }
  const b = r.bbox;
  const labels = componentLabels(el, o.ctx);
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      <g
        transform={`translate(${el.x} ${el.y}) rotate(${el.rot * 90}) scale(${el.mirror ? -1 : 1} 1)`}
      >
        {o.interactive && (
          <rect
            className="hit"
            x={b.x * 10 - 3}
            y={b.y * 10 - 3}
            width={b.w * 10 + 6}
            height={b.h * 10 + 6}
          />
        )}
        <SymbolShapes prims={r.prims} ink={ink} />
      </g>
      {r.prims.map((p, i) => {
        if (p.k !== 'text') return null;
        const w = componentPoint(el, p.x, p.y);
        // Text stays upright: when a rotation moves a centred label beside the symbol, align it
        // away from the symbol so it does not overlap the drawing.
        const dx = w.x - el.x;
        const dy = w.y - el.y;
        const anchor =
          el.rot % 2 === 1 && (p.anchor ?? 'middle') === 'middle' && Math.abs(dx) > Math.abs(dy) + 2
            ? dx < 0
              ? 'end'
              : 'start'
            : undefined;
        return (
          <SymbolText
            key={i}
            p={p}
            x={w.x + (anchor === 'end' ? -2 : anchor === 'start' ? 2 : 0)}
            y={w.y}
            color={ink.color}
            params={el.params}
            anchor={anchor}
          />
        );
      })}
      {labels?.lines.map((line, i) => {
        const y = labels.y + i * labels.lineHeight;
        if (line.kind === 'ref' && o.latexRefs) {
          return (
            <Tex
              key={i}
              tex={refToTex(line.text)}
              x={labels.x}
              y={y}
              size={LABEL_SIZE * 1.1}
              color={ink.color}
              anchor={labels.anchor}
            />
          );
        }
        return (
          <RichText
            key={i}
            text={line.text}
            x={labels.x}
            y={y}
            size={LABEL_SIZE}
            color={ink.color}
            anchor={labels.anchor}
          />
        );
      })}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

function arrowAt(pts: number[], end: boolean, w: number): string {
  const n = pts.length;
  const [x, y, px, py] = end
    ? [pts[n - 2]!, pts[n - 1]!, pts[n - 4]!, pts[n - 3]!]
    : [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
  const a = Math.atan2(y - py, x - px);
  const len = 7 + w * 2;
  const half = len * 0.38;
  const bx = x - Math.cos(a) * len;
  const by = y - Math.sin(a) * len;
  const nx = -Math.sin(a) * half;
  const ny = Math.cos(a) * half;
  return `${x},${y} ${bx + nx},${by + ny} ${bx - nx},${by - ny}`;
}

export const WireView = memo(function WireView({ el, o }: { el: WireElement; o: RenderOptions }) {
  const ink = inkOf(el, o);
  const pts = el.pts.join(' ');
  const arrow = el.arrow ?? (el.kind === 'signal' ? 'end' : 'none');
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el wire">
      {o.interactive && <polyline className="hit" points={pts} fill="none" strokeWidth={10} />}
      <polyline
        points={pts}
        fill="none"
        stroke={ink.color}
        strokeWidth={ink.width}
        strokeDasharray={dashArray(el.style?.dash, ink.width)}
      />
      {(arrow === 'end' || arrow === 'both') && el.pts.length >= 4 && (
        <polygon points={arrowAt(el.pts, true, ink.width)} fill={ink.color} />
      )}
      {(arrow === 'start' || arrow === 'both') && el.pts.length >= 4 && (
        <polygon points={arrowAt(el.pts, false, ink.width)} fill={ink.color} />
      )}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Hierarchical block
// ---------------------------------------------------------------------------

export const BlockView = memo(function BlockView({
  el,
  ports,
  o,
}: {
  el: BlockElement;
  ports: PortElement[];
  o: RenderOptions;
}) {
  const ink = inkOf(el, o);
  const l = blockLayout(el, ports);
  const fill = el.style?.fill ?? o.theme.paper;
  const cx = l.x + l.w / 2;
  const titleY = el.tex ? l.y + Math.min(22, l.h / 3) : l.y + l.h / 2;
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el block">
      <rect
        x={l.x}
        y={l.y}
        width={l.w}
        height={l.h}
        fill={fill}
        stroke={ink.color}
        strokeWidth={ink.width * 1.2}
        strokeDasharray={dashArray(el.style?.dash, ink.width)}
        className={o.interactive ? 'block-body' : undefined}
      />
      <RichText text={el.title} x={cx} y={titleY} size={15} color={ink.color} anchor="middle" />
      {el.tex && (
        <Tex
          tex={el.tex}
          x={cx}
          y={l.y + l.h / 2 + (el.title ? 10 : 0)}
          size={15}
          color={ink.color}
          display
        />
      )}
      {l.pins.map((p) => {
        const inset = 5;
        const tx = p.side === 'l' ? p.x + inset : p.side === 'r' ? p.x - inset : p.x;
        const ty = p.side === 't' ? p.y + 9 : p.side === 'b' ? p.y - 9 : p.y;
        const anchor = p.side === 'l' ? 'start' : p.side === 'r' ? 'end' : 'middle';
        return (
          <g key={p.portId}>
            <circle cx={p.x} cy={p.y} r={1.8} fill={ink.color} />
            <RichText text={p.name} x={tx} y={ty} size={10.5} color={ink.color} anchor={anchor} />
          </g>
        );
      })}
      {/* Sub-sheet marker: two stacked sheets in the corner. */}
      <g stroke={ink.color} strokeWidth={0.9} fill={fill}>
        <rect x={l.x + l.w - 15} y={l.y + l.h - 12} width={8} height={6} />
        <rect x={l.x + l.w - 12} y={l.y + l.h - 9} width={8} height={6} />
      </g>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Port, net label, text
// ---------------------------------------------------------------------------

export const PortView = memo(function PortView({ el, o }: { el: PortElement; o: RenderOptions }) {
  const ink = inkOf(el, o);
  const shape = portShape(el);
  const t = portTextPos(el);
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      <polygon
        points={shape.join(' ')}
        fill={o.theme.paper}
        stroke={ink.color}
        strokeWidth={ink.width}
        strokeLinejoin="round"
      />
      <RichText text={el.name} x={t.x} y={t.y} size={12} color={ink.color} anchor="middle" />
    </g>
  );
});

export const LabelView = memo(function LabelView({
  el,
  o,
}: {
  el: LabelElement;
  o: RenderOptions;
}) {
  const ink = inkOf(el, o);
  const w = Math.max(20, textWidth(el.text, 12) + 6);
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      {o.interactive && <rect className="hit" x={el.x} y={el.y - 16} width={w} height={16} />}
      <line
        x1={el.x}
        y1={el.y}
        x2={el.x}
        y2={el.y - 4}
        stroke={ink.color}
        strokeWidth={ink.width}
      />
      <RichText
        text={el.text}
        x={el.x + 3}
        y={el.y - 8}
        size={12}
        color={ink.color}
        anchor="start"
        italic={!hasMath(el.text)}
      />
    </g>
  );
});

export const TextView = memo(function TextView({ el, o }: { el: TextElement; o: RenderOptions }) {
  const ink = inkOf(el, o);
  const lines = el.text.split('\n');
  const lh = el.size * 1.3;
  const w = Math.max(10, ...lines.map((l) => textWidth(l.replace(/\$/g, ''), el.size)));
  const x0 = el.align === 'middle' ? el.x - w / 2 : el.align === 'end' ? el.x - w : el.x;
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      {o.interactive && (
        <rect
          className="hit"
          x={x0 - 3}
          y={el.y - el.size * 0.9}
          width={w + 6}
          height={lines.length * lh + 2}
        />
      )}
      {el.style?.fill && (
        <rect
          x={x0 - 6}
          y={el.y - el.size * 0.9 - 3}
          width={w + 12}
          height={lines.length * lh + 8}
          fill={el.style.fill}
          rx={3}
        />
      )}
      {lines.map((line, i) => (
        <RichText
          key={i}
          text={line}
          x={el.x}
          y={el.y + i * lh - el.size * 0.2}
          size={el.size}
          color={ink.color}
          anchor={el.align}
        />
      ))}
    </g>
  );
});
