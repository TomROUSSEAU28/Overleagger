/** Settings of an animated current: how much, how it changes in time, and what flows. */
import {
  FLOW_DEFAULTS,
  PERIODIC_SIGNALS,
  flowCurrent,
  reversePath,
  type FlowElement,
  type FlowSignal,
  type FlowSymbol,
} from '@overleagger/core';
import { ArrowLeftRight } from 'lucide-react';
import { FLOW_COLOR, FLOW_SYMBOL_SIZE } from '../canvas/render/flowStyle';
import { useEditor } from '../editor/context';
import { useUI } from '../store/ui';
import { THEMES, resolveColor } from '../theme';
import { Field } from './common';

const SIGNALS: [FlowSignal, string][] = [
  ['dc', 'DC (constant)'],
  ['sine', 'Sine (AC)'],
  ['square', 'Square (±)'],
  ['triangle', 'Triangle (ripple)'],
  ['sawtooth', 'Sawtooth'],
  ['pwm', 'PWM pulses'],
  ['ramp', 'Ramp, then steady'],
  ['rise', 'Rise (RL / RC charge)'],
  ['decay', 'Decay (discharge)'],
];

const SYMBOLS: [FlowSymbol, string][] = [
  ['dot', 'Dots'],
  ['electron', 'Electrons (−)'],
  ['plus', 'Charges (+)'],
  ['arrow', 'Arrows'],
  ['dash', 'Dashes'],
  ['comet', 'Comets (with a trail)'],
];

export function FlowProps({ el }: { el: FlowElement }) {
  const ed = useEditor();
  const theme = THEMES[useUI((s) => s.theme)];
  const upd = (patch: Partial<FlowElement>) => ed.updateElement(el.id, patch);
  const periodic = PERIODIC_SIGNALS.includes(el.signal);
  const period = el.period ?? FLOW_DEFAULTS.period;
  const size = el.size ?? FLOW_SYMBOL_SIZE[el.symbol];
  const spacing = el.spacing ?? FLOW_DEFAULTS.spacing;
  const speed = el.speed ?? FLOW_DEFAULTS.speed;
  const color = resolveColor(el.style?.color ?? FLOW_COLOR, theme);
  return (
    <>
      <h3>Animated current</h3>
      <p className="muted small">
        It flows in the presentation (and here, while it is selected). A negative current goes the
        other way.
      </p>
      <div className="row">
        <Field label="Current (A)">
          <input
            type="number"
            step={0.1}
            value={el.current}
            onChange={(e) => upd({ current: Number(e.target.value) || 0 })}
            data-testid="flow-current"
          />
        </Field>
        <button
          type="button"
          className="btn flow-reverse"
          title="Make it flow the other way along its path"
          onClick={() => upd({ pts: reversePath(el.pts) })}
          data-testid="flow-reverse"
        >
          <ArrowLeftRight size={14} /> Reverse
        </button>
      </div>
      <Field label="Signal">
        <select
          value={el.signal}
          onChange={(e) => upd({ signal: e.target.value as FlowSignal })}
          data-testid="flow-signal"
        >
          {SIGNALS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <SignalPreview el={el} color={color} />
      {el.signal !== 'dc' && (
        <div className="row">
          <Field label={periodic ? 'Period (s)' : el.signal === 'ramp' ? 'Ramp time (s)' : 'τ (s)'}>
            <input
              type="number"
              min={0.05}
              step={0.1}
              value={period}
              onChange={(e) => upd({ period: Math.max(0.05, Number(e.target.value) || 0.05) })}
            />
          </Field>
          <Field label="Offset (A)">
            <input
              type="number"
              step={0.1}
              value={el.offset ?? 0}
              onChange={(e) => upd({ offset: Number(e.target.value) || undefined })}
            />
          </Field>
        </div>
      )}
      {el.signal === 'pwm' && (
        <Field label={`Duty cycle: ${Math.round((el.duty ?? FLOW_DEFAULTS.duty) * 100)} %`}>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={el.duty ?? FLOW_DEFAULTS.duty}
            onChange={(e) => upd({ duty: Number(e.target.value) })}
          />
        </Field>
      )}
      <Field label="What flows">
        <div className="flow-symbols">
          {SYMBOLS.map(([s, l]) => (
            <button
              key={s}
              type="button"
              className={`icon-btn${el.symbol === s ? ' active' : ''}`}
              title={l}
              aria-label={l}
              aria-pressed={el.symbol === s}
              onClick={() => upd({ symbol: s, size: undefined })}
              data-testid={`flow-symbol-${s}`}
            >
              <SymbolIcon symbol={s} color={color} paper={theme.paper} />
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Size: ${size} px`}>
        <input
          type="range"
          min={3}
          max={24}
          step={1}
          value={size}
          onChange={(e) => upd({ size: Number(e.target.value) })}
        />
      </Field>
      <Field label={`Spacing: ${spacing} px`}>
        <input
          type="range"
          min={8}
          max={100}
          step={2}
          value={spacing}
          onChange={(e) => upd({ spacing: Number(e.target.value) })}
        />
      </Field>
      <Field label={`Speed: ${speed} px/s per A`}>
        <input
          type="range"
          min={5}
          max={300}
          step={5}
          value={speed}
          onChange={(e) => upd({ speed: Number(e.target.value) })}
          data-testid="flow-speed"
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(el.electrons)}
          onChange={(e) => upd({ electrons: e.target.checked || undefined })}
        />
        Electron flow (they move against the current)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(el.closed)}
          onChange={(e) => upd({ closed: e.target.checked || undefined })}
        />
        Closed loop
      </label>
    </>
  );
}

/** i(t) over two periods (or the start of a ramp), with the zero line. */
function SignalPreview({ el, color }: { el: FlowElement; color: string }) {
  const W = 220;
  const H = 46;
  const span = 2 * (el.period ?? FLOW_DEFAULTS.period) * (el.signal === 'dc' ? 1 : 1.2);
  const n = 160;
  const vals = Array.from({ length: n + 1 }, (_, i) => flowCurrent(el, (i / n) * span));
  const max = Math.max(1e-6, ...vals.map(Math.abs));
  const y = (v: number) => H / 2 - (v / max) * (H / 2 - 4);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'} ${((i / n) * W).toFixed(1)} ${y(v).toFixed(1)}`);
  return (
    <svg
      className="flow-preview"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      aria-label="The current in time"
    >
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="flow-zero" />
      <path d={d.join(' ')} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <text x={4} y={11} className="flow-axis">
        i(t)
      </text>
    </svg>
  );
}

function SymbolIcon({
  symbol,
  color,
  paper,
}: {
  symbol: FlowSymbol;
  color: string;
  paper: string;
}) {
  return (
    <svg width={22} height={16} viewBox="-11 -8 22 16">
      <line x1={-10} x2={10} y1={0} y2={0} stroke="currentColor" strokeOpacity={0.25} />
      {symbol === 'dot' && <circle r={3} fill={color} />}
      {(symbol === 'electron' || symbol === 'plus') && (
        <>
          <circle r={5.5} fill={color} />
          <path d="M -2.8 0 H 2.8" stroke={paper} strokeWidth={1.6} strokeLinecap="round" />
          {symbol === 'plus' && (
            <path d="M 0 -2.8 V 2.8" stroke={paper} strokeWidth={1.6} strokeLinecap="round" />
          )}
        </>
      )}
      {symbol === 'arrow' && (
        <path
          d="M -2.5 -4.5 L 2.5 0 L -2.5 4.5"
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {symbol === 'dash' && (
        <path d="M -5 0 H 5" stroke={color} strokeWidth={3} strokeLinecap="round" />
      )}
      {symbol === 'comet' && (
        <>
          {[0.6, 0.4, 0.2].map((k, i) => (
            <circle key={i} cx={-3 * (i + 1)} r={2 + k} fill={color} opacity={k} />
          ))}
          <circle cx={2} r={3.2} fill={color} />
        </>
      )}
    </svg>
  );
}
