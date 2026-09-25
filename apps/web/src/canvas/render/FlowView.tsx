/**
 * An animated current: symbols (dots, electrons, arrows…) moving along a path at a speed
 * proportional to the current. It runs by itself (requestAnimationFrame): in the presentation
 * while it is shown (its time starts when it appears), in the editor while it is selected (a
 * live preview of its settings); everywhere else (exports) it is drawn still.
 */
import {
  FLOW_DEFAULTS,
  PERIODIC_SIGNALS,
  flowPoints,
  flowPositions,
  flowVelocity,
  pathSampler,
  type FlowElement,
  type FlowSymbol,
} from '@overleagger/core';
import { memo, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ElFx } from '../../present/anim';
import { useUI } from '../../store/ui';
import { resolveColor } from '../../theme';
import { FLOW_COLOR, FLOW_SYMBOL_SIZE } from './flowStyle';
import type { RenderOptions } from './style';

interface Run {
  /** Time since the flow started (s). */
  t: number;
  /** How far the symbols moved along the path (px). */
  phase: number;
  /** Last direction of motion (+1 along the path, −1 against it). */
  dir: number;
  last: number;
}

export const FlowView = memo(function FlowView({
  el,
  o,
  fx,
}: {
  el: FlowElement;
  o: RenderOptions;
  fx?: ElFx;
}) {
  const selected = useUI((s) => o.interactive && !o.live && s.selection.includes(el.id));
  // Presentation: runs while shown (a hidden flow waits, and starts from 0 when it appears).
  const shown = (fx?.opacity ?? 1) > 0.01;
  const running = o.live ? shown && !fx?.idle : selected;
  // (Presenting, the element is a new object at every frame of an animation: keyed on its path.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pts = useMemo(() => flowPoints(el), [el.pts, el.closed]);
  const path = useMemo(() => pathSampler(pts), [pts]);
  const elRef = useRef(el);
  elRef.current = el;
  const run = useRef<Run>({ t: 0, phase: 0, dir: 1, last: 0 });
  const [, redraw] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!running) {
      run.current = { t: 0, phase: 0, dir: 1, last: 0 };
      redraw();
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const r = run.current;
      const dt = r.last ? Math.min(0.1, (now - r.last) / 1000) : 0;
      r.last = now;
      // Integrate the speed in small steps (a square wave switches within a frame).
      const n = Math.max(1, Math.ceil(dt / 0.01));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const v = flowVelocity(elRef.current, r.t + h * (i + 0.5));
        r.phase += v * h;
        if (Math.abs(v) > 1e-6) r.dir = Math.sign(v);
      }
      r.t += dt;
      // Editing: a ramp, rise or decay starts again once it has settled, to be seen again.
      const cur = elRef.current;
      if (
        !o.live &&
        cur.signal !== 'dc' &&
        !PERIODIC_SIGNALS.includes(cur.signal) &&
        r.t > 5 * (cur.period ?? FLOW_DEFAULTS.period) + 1.5
      )
        r.t = 0;
      redraw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, o.live]);
  // A new signal starts from its beginning (a ramp starts at 0 again).
  useEffect(() => {
    run.current.t = 0;
  }, [el.signal, el.period]);

  const r = run.current;
  // Still: the direction of the current at its start.
  const v = running ? flowVelocity(el, r.t) : flowVelocity(el, 0.001);
  const dir = running ? r.dir : Math.sign(v) || 1;
  const color = resolveColor(el.style?.color ?? FLOW_COLOR, o.theme);
  const size = el.size ?? FLOW_SYMBOL_SIZE[el.symbol];
  const spacing = el.spacing ?? FLOW_DEFAULTS.spacing;
  const marks = flowPositions(path.length, Boolean(el.closed), spacing, r.phase);
  return (
    <g
      data-id={o.interactive && !o.live ? el.id : undefined}
      className="el flow"
      // Editing: faint while not selected (it runs in the presentation, over the drawing).
      opacity={o.interactive && !o.live && !selected ? 0.5 : undefined}
      // Presenting: a click goes to what is under the current (a block, a link…).
      pointerEvents={o.live ? 'none' : undefined}
    >
      {selected && (
        // The path, while it is being edited.
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke={color}
          strokeOpacity={0.35}
          strokeWidth={1.5}
          strokeDasharray="5 5"
          pointerEvents="none"
        />
      )}
      {marks.map(({ s, alpha }, i) => {
        const p = path.at(s);
        // Charges stay upright; arrows, dashes and comets point where they go.
        const turns = el.symbol === 'arrow' || el.symbol === 'dash' || el.symbol === 'comet';
        const angle = (p.angle * 180) / Math.PI + (dir < 0 ? 180 : 0);
        return (
          <g
            key={i}
            transform={`translate(${p.x} ${p.y})${turns ? ` rotate(${angle})` : ''}`}
            opacity={alpha}
          >
            {o.interactive && !o.live && <circle className="hit" r={Math.max(4, size / 2 + 3)} />}
            <FlowMark
              symbol={el.symbol}
              size={size}
              color={color}
              paper={o.theme.paper}
              speed={Math.abs(v)}
            />
          </g>
        );
      })}
    </g>
  );
});

/** One symbol, centred on 0, pointing to +x (the direction it moves). */
function FlowMark({
  symbol,
  size,
  color,
  paper,
  speed,
}: {
  symbol: FlowSymbol;
  size: number;
  color: string;
  paper: string;
  speed: number;
}) {
  const r = size / 2;
  switch (symbol) {
    case 'dot':
      return <circle r={r} fill={color} />;
    case 'electron':
    case 'plus': {
      const k = r * 0.5;
      return (
        <g>
          <circle r={r} fill={color} />
          <g stroke={paper} strokeWidth={Math.max(1.2, r * 0.28)} strokeLinecap="round">
            <path d={`M ${-k} 0 H ${k}`} />
            {symbol === 'plus' && <path d={`M 0 ${-k} V ${k}`} />}
          </g>
        </g>
      );
    }
    case 'arrow':
      return (
        <path
          d={`M ${-r * 0.6} ${-r} L ${r * 0.6} 0 L ${-r * 0.6} ${r}`}
          fill="none"
          stroke={color}
          strokeWidth={Math.max(1.5, size / 4)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'dash':
      return (
        <path
          d={`M ${-r} 0 H ${r}`}
          stroke={color}
          strokeWidth={Math.max(1.5, size / 3)}
          strokeLinecap="round"
        />
      );
    case 'comet': {
      // A tail behind the head, longer when it goes faster.
      const tail = Math.min(4 * size, speed * 0.06);
      return (
        <g>
          {[0.8, 0.6, 0.4, 0.2].map((k, i) => (
            <circle
              key={i}
              cx={-tail * ((i + 1) / 4)}
              r={r * (0.5 + 0.5 * k)}
              fill={color}
              opacity={k * 0.6}
            />
          ))}
          <circle r={r} fill={color} />
        </g>
      );
    }
  }
}
