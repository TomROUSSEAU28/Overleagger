import { analyzeConnectivity, type Element, type Pt } from '@overleagger/core';
import { memo, useMemo } from 'react';
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

export function ElementView({ el, o }: { el: Element; o: RenderOptions }) {
  switch (el.type) {
    case 'component':
      return <ComponentView el={el} o={o} />;
    case 'wire':
      return <WireView el={el} o={o} />;
    case 'block':
      return <BlockView el={el} ports={o.ctx.ports(el.childSheetId)} o={o} />;
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
    case 'group':
      return null;
  }
}

export const Junctions = memo(function Junctions({
  points,
  colors,
}: {
  points: Pt[];
  colors: string[];
}) {
  return (
    <g className="junctions" pointerEvents="none">
      {points.map((p, i) => (
        <circle key={`${p.x},${p.y}`} cx={p.x} cy={p.y} r={3.3} fill={colors[i]} />
      ))}
    </g>
  );
});

/** Draw order layer: frames at the back, then blocks, then everything else in z order. */
const layer = (e: Element) => (e.type === 'frame' ? 0 : e.type === 'block' ? 1 : 2);

/** Draws every element of a sheet plus the automatic junction dots. */
export const SheetRenderer = memo(function SheetRenderer({
  elements,
  o,
  hidden,
}: {
  elements: Element[];
  o: RenderOptions;
  /** Elements not drawn (e.g. being erased). */
  hidden?: ReadonlySet<string>;
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
      {ordered.map((el) => (
        <ElementView key={el.id} el={el} o={o} />
      ))}
      <Junctions points={conn.junctions} colors={colors} />
    </g>
  );
});
