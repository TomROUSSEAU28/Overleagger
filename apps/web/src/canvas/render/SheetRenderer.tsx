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
    case 'group':
      return null;
  }
}

export const Junctions = memo(function Junctions({
  points,
  color,
}: {
  points: Pt[];
  color: string;
}) {
  return (
    <g className="junctions" pointerEvents="none">
      {points.map((p) => (
        <circle key={`${p.x},${p.y}`} cx={p.x} cy={p.y} r={3.3} fill={color} />
      ))}
    </g>
  );
});

/** Draws every element of a sheet plus the automatic junction dots. */
export const SheetRenderer = memo(function SheetRenderer({
  elements,
  o,
}: {
  elements: Element[];
  o: RenderOptions;
}) {
  const junctions = useMemo(
    () => analyzeConnectivity(elements, o.ctx).junctions,
    [elements, o.ctx],
  );
  // Blocks and text boxes first so wires and parts are drawn on top of block fills.
  const ordered = useMemo(() => {
    const back = elements.filter((e) => e.type === 'block');
    const front = elements.filter((e) => e.type !== 'block');
    return [...back, ...front];
  }, [elements]);
  const junctionColor = useMemo(() => {
    // Junction dots take the colour of the wires meeting there when they all share one.
    const wireColors = new Set(
      elements.filter((e) => e.type === 'wire').map((e) => e.style?.color),
    );
    return wireColors.size === 1 ? resolveColor([...wireColors][0], o.theme) : o.theme.ink;
  }, [elements, o.theme]);
  return (
    <g className="sheet" strokeLinecap="round" strokeLinejoin="round">
      {ordered.map((el) => (
        <ElementView key={el.id} el={el} o={o} />
      ))}
      <Junctions points={junctions} color={junctionColor} />
    </g>
  );
});
