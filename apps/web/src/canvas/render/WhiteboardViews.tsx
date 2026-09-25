import {
  linePoints,
  polylineMiddle,
  shapeGeometry,
  lineControlPoint,
  textWidth,
  type ButtonElement,
  type FrameElement,
  type ImageElement,
  type LineElement,
  type NoteElement,
  type ShapeElement,
  type StrokeElement,
  type WaveformElement,
} from '@overleagger/core';
import rough from 'roughjs';
import { memo, useMemo } from 'react';
import { Tex } from '../../latex/Tex';
import { resolveColor, resolveNoteColor, FONT_SERIF } from '../../theme';
import { RichText } from './ElementViews';
import { linePath, strokePath, wrapText } from './shapes';
import { dashArray, inkOf, type RenderOptions } from './style';
import { sampleTrace } from './waveforms';

const generator = rough.generator();

/** Waveform labels are math: accept both `V_{out}` and `$V_{out}$` (like everywhere else). */
const asMath = (s: string) => s.trim().replace(/^\$([^$]*)\$$/, '$1');

/** Stable pseudo-random seed from an element id (so sketchy shapes do not jitter). */
function seedOf(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2 ** 31) + 1;
}

function RoughPaths({ drawable }: { drawable: ReturnType<typeof generator.rectangle> }) {
  const paths = generator.toPaths(drawable);
  return (
    <>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          fill={p.fill ?? 'none'}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const ShapeView = memo(function ShapeView({
  el,
  o,
}: {
  el: ShapeElement;
  o: RenderOptions;
}) {
  const ink = inkOf(el, o);
  const fill = el.style?.fill;
  const dash = dashArray(el.style?.dash, ink.width);
  const common = {
    stroke: ink.color,
    strokeWidth: ink.width,
    fill: fill ?? 'none',
    strokeDasharray: dash,
  };
  const drawable = useMemo(() => {
    if (!el.sketch) return null;
    const opts = {
      seed: seedOf(el.id),
      stroke: ink.color,
      strokeWidth: ink.width,
      roughness: 1.1,
      bowing: 1,
      fill,
      fillStyle: 'hachure' as const,
      hachureGap: 6,
      fillWeight: ink.width * 0.6,
      ...(dash ? { strokeLineDash: dash.split(' ').map(Number) } : {}),
    };
    if (el.kind === 'rect') return [generator.rectangle(el.x, el.y, el.w, el.h, opts)];
    if (el.kind === 'ellipse')
      return [generator.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w, el.h, opts)];
    const g = shapeGeometry(el);
    return [
      generator.polygon(g.outline, opts),
      ...g.extras.map((e) => generator.linearPath(e, { ...opts, fill: undefined })),
    ];
  }, [el, ink.color, ink.width, fill, dash]);
  const geo = el.kind === 'rect' || el.kind === 'ellipse' ? null : shapeGeometry(el);
  // Flowchart boxes: the text wraps inside the shape.
  const textSize = 15;
  const lines = el.text
    ? wrapText(el.text, Math.max(30, el.w * (geo ? 0.72 : 0.86)), textSize)
    : [];
  const lineH = textSize * 1.25;
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      {o.interactive && <rect className="hit" x={el.x} y={el.y} width={el.w} height={el.h} />}
      {drawable ? (
        drawable.map((d, i) => <RoughPaths key={i} drawable={d} />)
      ) : el.kind === 'rect' ? (
        <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={el.radius ?? 0} {...common} />
      ) : el.kind === 'ellipse' ? (
        <ellipse
          cx={el.x + el.w / 2}
          cy={el.y + el.h / 2}
          rx={el.w / 2}
          ry={el.h / 2}
          {...common}
        />
      ) : (
        <>
          <polygon points={geo!.outline.flat().join(' ')} strokeLinejoin="round" {...common} />
          {geo!.extras.map((e, i) => (
            <polyline
              key={i}
              points={e.flat().join(' ')}
              fill="none"
              stroke={ink.color}
              strokeWidth={ink.width}
              strokeDasharray={dash}
            />
          ))}
        </>
      )}
      {lines.map((line, i) => (
        <RichText
          key={i}
          text={line}
          x={el.x + el.w / 2}
          y={
            el.y +
            el.h / 2 +
            (i - (lines.length - 1) / 2) * lineH +
            (el.kind === 'document' ? -el.h * 0.06 : el.kind === 'database' ? el.h * 0.06 : 0)
          }
          size={textSize}
          color={ink.color}
          anchor="middle"
        />
      ))}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Lines & arrows
// ---------------------------------------------------------------------------

/** Arrow head at (x, y) coming from (fromX, fromY): its tip and the two corners of its base. */
function headPts(x: number, y: number, fromX: number, fromY: number, w: number): number[][] {
  const a = Math.atan2(y - fromY, x - fromX);
  const len = 8 + w * 2;
  const half = len * 0.38;
  const bx = x - Math.cos(a) * len;
  const by = y - Math.sin(a) * len;
  const nx = -Math.sin(a) * half;
  const ny = Math.cos(a) * half;
  return [
    [bx + nx, by + ny],
    [x, y],
    [bx - nx, by - ny],
  ];
}

/** Move `p` towards `to` by `d` (not past it). */
function pullBack(p: [number, number], to: [number, number], d: number): [number, number] {
  const len = Math.hypot(to[0] - p[0], to[1] - p[1]);
  if (len < 1e-6) return p;
  const k = Math.min(d, len / 2) / len;
  return [p[0] + (to[0] - p[0]) * k, p[1] + (to[1] - p[1]) * k];
}

/** Points along the quadratic curve a → b bent by control point c (for the hand-drawn look). */
function quadPoints(a: [number, number], c: { x: number; y: number }, b: [number, number]) {
  const out: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * c.x + t * t * b[0],
      u * u * a[1] + 2 * u * t * c.y + t * t * b[1],
    ]);
  }
  return out;
}

export const LineView = memo(function LineView({ el, o }: { el: LineElement; o: RenderOptions }) {
  const ink = inkOf(el, o);
  const [x1, y1, x2, y2] = el.pts as [number, number, number, number];
  const elbow = el.route === 'elbow';
  const route = elbow ? linePoints(el) : null;
  const c = el.bend ? lineControlPoint(el.pts, el.bend) : { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const d = route ? `M ${route.map((p) => p.join(' ')).join(' L ')}` : linePath(el);
  // Arrow heads follow the first / last segment (or the tangent of a curve).
  const n = route?.length ?? 0;
  const endFrom: [number, number] = route ? route[n - 2]! : el.bend ? [c.x, c.y] : [x1, y1];
  const startFrom: [number, number] = route ? route[1]! : el.bend ? [c.x, c.y] : [x2, y2];
  // A filled head covers the end of the line: stop the line under it, so a thick line does not
  // poke out of the tip.
  const cut = (8 + ink.width * 2) * 0.6;
  const a: [number, number] =
    el.arrowStart && !el.sketch ? pullBack([x1, y1], startFrom, cut) : [x1, y1];
  const b: [number, number] =
    el.arrowEnd && !el.sketch ? pullBack([x2, y2], endFrom, cut) : [x2, y2];
  const trimmed =
    a[0] === x1 && a[1] === y1 && b[0] === x2 && b[1] === y2
      ? d
      : route
        ? `M ${[a, ...route.slice(1, -1), b].map((p) => p.join(' ')).join(' L ')}`
        : el.bend
          ? `M ${a[0]} ${a[1]} Q ${c.x} ${c.y} ${b[0]} ${b[1]}`
          : `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`;
  const drawable = useMemo(() => {
    if (!el.sketch) return null;
    // The ends stay exactly in place, so the arrow heads meet the line.
    const opts = {
      seed: seedOf(el.id),
      stroke: ink.color,
      strokeWidth: ink.width,
      roughness: 0.9,
      preserveVertices: true,
    };
    const body = route
      ? generator.linearPath(route, opts)
      : el.bend
        ? // Follow the real curve (a rough curve through 3 points takes another shape).
          generator.curve(quadPoints([x1, y1], c, [x2, y2]), { ...opts, roughness: 0.5 })
        : generator.line(x1, y1, x2, y2, opts);
    // Hand-drawn heads: two strokes, like a pen would draw them.
    const heads = [
      ...(el.arrowEnd ? [headPts(x2, y2, endFrom[0], endFrom[1], ink.width)] : []),
      ...(el.arrowStart ? [headPts(x1, y1, startFrom[0], startFrom[1], ink.width)] : []),
    ].map((h) => generator.linearPath(h as [number, number][], { ...opts, roughness: 0.5 }));
    return [body, ...heads];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.sketch, el.bend, el.id, d, ink.color, ink.width, el.arrowEnd, el.arrowStart]);
  const mid = route
    ? polylineMiddle(route)
    : { x: (x1 + 2 * c.x + x2) / 4, y: (y1 + 2 * c.y + y2) / 4 };
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el wire">
      {o.interactive && <path className="hit" d={d} fill="none" strokeWidth={12} />}
      {drawable ? (
        drawable.map((dr, i) => <RoughPaths key={i} drawable={dr} />)
      ) : (
        <>
          <path
            d={trimmed}
            fill="none"
            stroke={ink.color}
            strokeWidth={ink.width}
            strokeLinejoin="round"
            strokeDasharray={dashArray(el.style?.dash, ink.width)}
          />
          {el.arrowEnd && (
            <polygon
              points={headPts(x2, y2, endFrom[0], endFrom[1], ink.width).join(' ')}
              fill={ink.color}
            />
          )}
          {el.arrowStart && (
            <polygon
              points={headPts(x1, y1, startFrom[0], startFrom[1], ink.width).join(' ')}
              fill={ink.color}
            />
          )}
        </>
      )}
      {el.text &&
        (route ? (
          <>
            <rect
              x={mid.x - el.text.length * 3.6 - 4}
              y={mid.y - 10}
              width={el.text.length * 7.2 + 8}
              height={20}
              fill={o.theme.paper}
              rx={3}
            />
            <RichText
              text={el.text}
              x={mid.x}
              y={mid.y}
              size={14}
              color={ink.color}
              anchor="middle"
            />
          </>
        ) : (
          <RichText
            text={el.text}
            x={mid.x}
            y={mid.y - 12}
            size={14}
            color={ink.color}
            anchor="middle"
          />
        ))}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Freehand strokes
// ---------------------------------------------------------------------------

export const StrokeView = memo(function StrokeView({
  el,
  o,
}: {
  el: StrokeElement;
  o: RenderOptions;
}) {
  const color = resolveColor(el.style?.color, o.theme);
  const d = useMemo(
    () => strokePath(el.pts, el.size, el.highlighter),
    [el.pts, el.size, el.highlighter],
  );
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      <path
        d={d}
        fill={color}
        fillOpacity={el.highlighter ? 0.32 : 1}
        stroke="none"
        className={o.interactive ? 'stroke-hit' : undefined}
      />
    </g>
  );
});

// ---------------------------------------------------------------------------
// Images, notes, buttons, frames
// ---------------------------------------------------------------------------

export const ImageView = memo(function ImageView({
  el,
  o,
}: {
  el: ImageElement;
  o: RenderOptions;
}) {
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      <image
        href={el.src}
        x={el.x}
        y={el.y}
        width={el.w}
        height={el.h}
        preserveAspectRatio="none"
        transform={
          el.flipX || el.flipY
            ? `translate(${el.flipX ? 2 * el.x + el.w : 0} ${el.flipY ? 2 * el.y + el.h : 0}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})`
            : undefined
        }
      />
      {o.interactive && <rect className="hit" x={el.x} y={el.y} width={el.w} height={el.h} />}
      {el.style?.width !== undefined && el.style.width > 0 && (
        <rect
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          fill="none"
          stroke={resolveColor(el.style.color, o.theme)}
          strokeWidth={el.style.width}
        />
      )}
    </g>
  );
});

export const NoteView = memo(function NoteView({ el, o }: { el: NoteElement; o: RenderOptions }) {
  const ink = inkOf(el, o);
  const bg = resolveNoteColor(el.color, o.theme);
  const size = 14;
  const lines = wrapText(el.text, el.w - 20, size);
  const fold = 14;
  const { x, y, w, h } = el;
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      <rect x={x + 3} y={y + 4} width={w} height={h} fill="#000" fillOpacity={0.08} rx={2} />
      <path
        d={`M ${x} ${y} H ${x + w} V ${y + h - fold} L ${x + w - fold} ${y + h} H ${x} Z`}
        fill={bg}
        stroke={ink.color}
        strokeOpacity={0.25}
        strokeWidth={1}
      />
      <path
        d={`M ${x + w} ${y + h - fold} L ${x + w - fold} ${y + h - fold} L ${x + w - fold} ${y + h} Z`}
        fill="#000"
        fillOpacity={0.12}
      />
      {lines.map((l, i) => (
        <RichText
          key={i}
          text={l}
          x={x + 10}
          y={y + 18 + i * size * 1.35}
          size={size}
          color={ink.color}
          anchor="start"
        />
      ))}
    </g>
  );
});

export const ButtonView = memo(function ButtonView({
  el,
  o,
}: {
  el: ButtonElement;
  o: RenderOptions;
}) {
  const color = el.style?.color ? resolveColor(el.style.color, o.theme) : o.theme.accent;
  const { x, y, w, h } = el;
  const ix = x + w - 16;
  const iy = y + h / 2;
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el button">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={Math.min(8, h / 2)}
        fill={el.style?.fill ?? o.theme.paper}
        stroke={color}
        strokeWidth={1.4}
      />
      <RichText
        text={el.label}
        x={x + (w - 18) / 2 + 4}
        y={y + h / 2}
        size={14}
        color={color}
        anchor="middle"
      />
      {/* External-link glyph */}
      <g stroke={color} strokeWidth={1.2} fill="none" strokeLinecap="round">
        <path d={`M ${ix + 2} ${iy - 5} H ${ix + 6} V ${iy - 1}`} />
        <path d={`M ${ix + 6} ${iy - 5} L ${ix} ${iy + 1}`} />
        <path d={`M ${ix + 3} ${iy + 5} H ${ix - 4} V ${iy - 2}`} />
      </g>
    </g>
  );
});

export const FrameView = memo(function FrameView({
  el,
  o,
}: {
  el: FrameElement;
  o: RenderOptions;
}) {
  const color = el.style?.color ? resolveColor(el.style.color, o.theme) : o.theme.palette.pencil!;
  const tabW = Math.max(60, textWidth(el.name, 13) + 20);
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el frame">
      {el.style?.fill && <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={el.style.fill} />}
      {o.interactive && (
        <rect
          className="hit frame-hit"
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          fill="none"
          strokeWidth={10}
        />
      )}
      <rect
        x={el.x}
        y={el.y}
        width={el.w}
        height={el.h}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray="8 5"
      />
      <path
        d={`M ${el.x} ${el.y} v -20 h ${tabW - 6} l 6 6 v 14`}
        fill={o.theme.paper}
        stroke={color}
        strokeWidth={1.2}
        className={o.interactive ? 'frame-tab' : undefined}
      />
      <text
        x={el.x + 8}
        y={el.y - 6}
        fontSize={13}
        fill={color}
        fontFamily={FONT_SERIF}
        fontVariant="small-caps"
        letterSpacing={0.5}
      >
        {el.name}
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Waveforms (oscillograms / chronograms)
// ---------------------------------------------------------------------------

export const WaveformView = memo(function WaveformView({
  el,
  o,
}: {
  el: WaveformElement;
  o: RenderOptions;
}) {
  const ink = inkOf(el, o);
  const { x, y, w, h } = el;
  const padL = el.yLabel || el.layout === 'stacked' ? 34 : 14;
  const padR = 18;
  const padT = 16;
  const padB = el.xLabel ? 20 : 10;
  const x0 = x + padL;
  const x1 = x + w - padR;
  const bands =
    el.layout === 'stacked'
      ? el.traces.map((_, i) => {
          const bh = (h - padT - padB) / Math.max(1, el.traces.length);
          return { top: y + padT + i * bh, bottom: y + padT + (i + 1) * bh - 6 };
        })
      : el.traces.map(() => ({ top: y + padT, bottom: y + h - padB }));

  const samples = el.traces.map((t) => sampleTrace(t));
  const range = (idx: number[]) => {
    let lo = 0;
    let hi = 0;
    for (const i of idx) {
      const s = samples[i]!;
      for (let k = 1; k < s.length; k += 2) {
        lo = Math.min(lo, s[k]!);
        hi = Math.max(hi, s[k]!);
      }
    }
    if (hi - lo < 1e-6) hi = lo + 1;
    return { lo, hi };
  };
  const overlay = el.layout !== 'stacked' ? range(el.traces.map((_, i) => i)) : null;
  const axisColor = ink.color;
  return (
    <g data-id={o.interactive ? el.id : undefined} className="el">
      {o.interactive && <rect className="hit" x={x} y={y} width={w} height={h} />}
      {el.traces.map((t, i) => {
        const band = bands[i]!;
        const r = overlay ?? range([i]);
        const m = 4;
        const vy = (v: number) =>
          band.bottom - m - ((v - r.lo) / (r.hi - r.lo)) * (band.bottom - band.top - 2 * m);
        const s = samples[i]!;
        const pts: string[] = [];
        for (let k = 0; k < s.length; k += 2)
          pts.push(`${(x0 + s[k]! * (x1 - x0 - 6)).toFixed(2)},${vy(s[k + 1]!).toFixed(2)}`);
        const color = t.color ? resolveColor(t.color, o.theme) : ink.color;
        const zeroY = vy(0);
        const showBandAxis = el.layout === 'stacked' || i === 0;
        return (
          <g key={t.id}>
            {el.grid && showBandAxis && (
              <g stroke={axisColor} strokeOpacity={0.18} strokeWidth={0.8} strokeDasharray="2 3">
                {Array.from({ length: 9 }, (_, k) => (
                  <line
                    key={k}
                    x1={x0 + ((k + 1) * (x1 - x0)) / 10}
                    y1={band.top}
                    x2={x0 + ((k + 1) * (x1 - x0)) / 10}
                    y2={band.bottom}
                  />
                ))}
                <line x1={x0} y1={vy(r.hi)} x2={x1} y2={vy(r.hi)} />
                {r.lo < 0 && <line x1={x0} y1={vy(r.lo)} x2={x1} y2={vy(r.lo)} />}
              </g>
            )}
            {el.axes && showBandAxis && (
              <g stroke={axisColor} strokeWidth={1} fill={axisColor}>
                <line x1={x0} y1={zeroY} x2={x1} y2={zeroY} />
                <polygon
                  points={`${x1 + 6},${zeroY} ${x1 - 2},${zeroY - 3.5} ${x1 - 2},${zeroY + 3.5}`}
                  stroke="none"
                />
                {(el.layout === 'stacked' || i === 0) && (
                  <>
                    <line x1={x0} y1={band.bottom} x2={x0} y2={band.top - 2} />
                    <polygon
                      points={`${x0},${band.top - 8} ${x0 - 3.5},${band.top} ${x0 + 3.5},${band.top}`}
                      stroke="none"
                    />
                  </>
                )}
              </g>
            )}
            <polyline
              points={pts.join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={ink.width * 1.1}
              strokeDasharray={t.dashed ? '5 4' : undefined}
              strokeLinejoin="round"
            />
            {t.label &&
              (el.layout === 'stacked' ? (
                <Tex
                  tex={asMath(t.label)}
                  x={x0 - 6}
                  y={(band.top + band.bottom) / 2}
                  size={14}
                  color={color}
                  anchor="end"
                />
              ) : (
                <Tex
                  tex={asMath(t.label)}
                  x={x1 - 4}
                  y={vy(s[s.length - 1]!) - 10}
                  size={13}
                  color={color}
                  anchor="end"
                />
              ))}
          </g>
        );
      })}
      {el.xLabel && (
        <Tex
          tex={asMath(el.xLabel)}
          x={x1 + 4}
          y={
            (overlay
              ? bands[0]!.bottom -
                4 -
                ((0 - overlay.lo) / (overlay.hi - overlay.lo)) *
                  (bands[0]!.bottom - bands[0]!.top - 8)
              : y + h - padB) + 12
          }
          size={14}
          color={axisColor}
          anchor="middle"
        />
      )}
      {el.yLabel && el.layout !== 'stacked' && (
        <Tex
          tex={asMath(el.yLabel)}
          x={x0 - 8}
          y={y + padT - 4}
          size={14}
          color={axisColor}
          anchor="end"
        />
      )}
    </g>
  );
});
