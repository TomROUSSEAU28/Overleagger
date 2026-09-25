import { analyzeConnectivity, type Element, type Pt } from '@overleagger/core';
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ElFx } from '../../present/anim';
import { useUI } from '../../store/ui';
import { resolveColor } from '../../theme';
import {
  BlockView,
  ComponentView,
  LabelView,
  PortView,
  TextView,
  WireView,
  type RenderOptions,
} from './ElementViews';
import { FlowView } from './FlowView';
import {
  ButtonView,
  FrameView,
  ImageView,
  LineView,
  NoteView,
  ShapeView,
  StrokeView,
  WaveformView,
} from './WhiteboardViews';

export function ElementView({ el, o, fx }: { el: Element; o: RenderOptions; fx?: ElFx }) {
  switch (el.type) {
    case 'component':
      return <ComponentView el={el} o={o} />;
    case 'wire':
      return <WireView el={el} o={o} />;
    case 'block':
      return (
        <BlockView
          el={el}
          ports={o.ctx.ports(el.childSheetId)}
          o={o}
          hidden={o.ctx.canRead?.(el.childSheetId) === false}
        />
      );
    case 'port':
      return <PortView el={el} o={o} />;
    case 'label':
      return <LabelView el={el} o={o} />;
    case 'text':
      return <TextView el={el} o={o} />;
    case 'shape':
      return <ShapeView el={el} o={o} />;
    case 'line':
      return <LineView el={el} o={o} />;
    case 'stroke':
      return <StrokeView el={el} o={o} />;
    case 'image':
      return <ImageView el={el} o={o} />;
    case 'note':
      return <NoteView el={el} o={o} />;
    case 'button':
      return <ButtonView el={el} o={o} />;
    case 'waveform':
      return <WaveformView el={el} o={o} />;
    case 'frame':
      return <FrameView el={el} o={o} />;
    case 'flow':
      return <FlowView el={el} o={o} fx={fx} />;
    case 'group':
      return null;
  }
}

/** One junction dot. Whether it pops in is decided once, when it appears. */
function Dot({ p, color, pop }: { p: Pt; color: string; pop: boolean }) {
  const [popped] = useState(pop);
  return <circle cx={p.x} cy={p.y} r={3.3} fill={color} className={popped ? 'pop' : undefined} />;
}

export const Junctions = memo(function Junctions({
  points,
  colors,
  interactive = false,
}: {
  points: Pt[];
  colors: string[];
  interactive?: boolean;
}) {
  // Dots already there when the sheet opens, or moving with a drag, don't pop.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(t);
  }, []);
  const calm = useUI((s) => Boolean(s.drag || s.resize) || !s.animations);
  const pop = interactive && ready && !calm;
  return (
    <g className="junctions" pointerEvents="none">
      {points.map((p, i) => (
        <Dot key={`${p.x},${p.y}`} p={p} color={colors[i]!} pop={pop} />
      ))}
    </g>
  );
});

/**
 * Draw order layer: frames at the back, then blocks, then everything else in z order, and the
 * animated currents on top (they run over the wires and the parts).
 */
const layer = (e: Element) =>
  e.type === 'frame' ? 0 : e.type === 'block' ? 1 : e.type === 'flow' ? 3 : 2;

/** CSS for an animated element (presentation): fade, move / scale around its centre, wipe, glow. */
function fxStyle(f: ElFx | undefined): CSSProperties | undefined {
  if (!f) return undefined;
  const style: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };
  if (f.opacity !== undefined) style.opacity = f.opacity;
  if (f.transform) style.transform = f.transform;
  if (f.reveal !== undefined) style.clipPath = `inset(-40px ${(1 - f.reveal) * 100}% -40px -40px)`;
  if (f.glow)
    style.filter = `drop-shadow(0 0 ${2 + 7 * f.glow}px rgba(214, 40, 40, ${0.9 * f.glow}))`;
  return style;
}

/** Draws every element of a sheet plus the automatic junction dots. */
export const SheetRenderer = memo(function SheetRenderer({
  elements,
  o,
  hidden,
  fx,
}: {
  elements: Element[];
  o: RenderOptions;
  /** Elements not drawn (e.g. being erased). */
  hidden?: ReadonlySet<string>;
  /** Presentation: how the animated elements are drawn right now. */
  fx?: ReadonlyMap<string, ElFx>;
}) {
  const visible = useMemo(
    () => (hidden?.size ? elements.filter((e) => !hidden.has(e.id)) : elements),
    [elements, hidden],
  );
  const conn = useMemo(() => analyzeConnectivity(visible, o.ctx), [visible, o.ctx]);
  const ordered = useMemo(() => [...visible].sort((a, b) => layer(a) - layer(b)), [visible]);
  const colors = useMemo(() => {
    // A junction dot takes the colour of its wires when they all share one.
    const byId = new Map(visible.map((e) => [e.id, e]));
    return conn.junctionWires.map((ids) => {
      const set = new Set(ids.map((id) => byId.get(id)?.style?.color));
      return set.size === 1 ? resolveColor([...set][0], o.theme) : o.theme.ink;
    });
  }, [conn, visible, o.theme]);
  return (
    <g className="sheet" strokeLinecap="round" strokeLinejoin="round">
      {ordered.map((el) =>
        // Animated elements get a wrapper (always the same, so they are not re-created).
        fx && el.anims?.length ? (
          <g key={el.id} className="anim-el" style={fxStyle(fx.get(el.id))}>
            <ElementView el={el} o={o} fx={fx.get(el.id)} />
          </g>
        ) : (
          <ElementView key={el.id} el={el} o={o} />
        ),
      )}
      <Junctions points={conn.junctions} colors={colors} interactive={o.interactive} />
    </g>
  );
});
