import type { Trace, TraceKind } from '@overleagger/core';

/** Normalized shape of a trace at time t ∈ [0, 1] (before amplitude / offset). */
function shape(tr: Trace, t: number): number {
  const u = t * tr.periods + tr.phase / 360;
  const frac = u - Math.floor(u);
  const duty = Math.min(0.99, Math.max(0.01, tr.duty));
  const t0 = 0.08;
  switch (tr.kind) {
    case 'sine':
      return Math.sin(2 * Math.PI * u);
    case 'square':
      return frac < duty ? 1 : -1;
    case 'pwm':
      return frac < duty ? 1 : 0;
    case 'triangle':
      return frac < 0.5 ? 4 * frac - 1 : 3 - 4 * frac;
    case 'sawtooth':
      return 2 * frac - 1;
    case 'halfwave':
      return Math.max(0, Math.sin(2 * Math.PI * u));
    case 'fullwave':
      return Math.abs(Math.sin(2 * Math.PI * u));
    case 'ripple': {
      // Inductor current: rises during the on-time, falls during the off-time.
      const tri = frac < duty ? -1 + (2 * frac) / duty : 1 - (2 * (frac - duty)) / (1 - duty);
      return 1 + tr.ripple * tri;
    }
    case 'step1': {
      if (t < t0) return 0;
      return 1 - Math.exp(-(t - t0) / Math.max(1e-3, tr.tau));
    }
    case 'step2': {
      if (t < t0) return 0;
      const wn = 1 / Math.max(1e-3, tr.tau);
      const z = Math.max(0, tr.zeta);
      const x = t - t0;
      if (z < 1) {
        const wd = wn * Math.sqrt(1 - z * z);
        return (
          1 -
          Math.exp(-z * wn * x) * (Math.cos(wd * x) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * x))
        );
      }
      return 1 - (1 + wn * x) * Math.exp(-wn * x);
    }
    case 'exp':
      return Math.exp(-t / Math.max(1e-3, tr.tau));
    case 'dc':
      return 1;
    case 'custom': {
      const p = tr.points ?? [0, 0, 1, 0];
      for (let i = 2; i < p.length; i += 2) {
        const ta = p[i - 2]!;
        const tb = p[i]!;
        if (t <= tb) {
          const k = tb === ta ? 1 : (t - ta) / (tb - ta);
          return p[i - 1]! + k * (p[i + 1]! - p[i - 1]!);
        }
      }
      return p[p.length - 1] ?? 0;
    }
  }
}

/** Traces with discontinuities: sample them densely so edges stay vertical. */
const STEPPY: TraceKind[] = ['square', 'pwm', 'sawtooth', 'custom'];

export function sampleTrace(tr: Trace, n = 480): number[] {
  const count = STEPPY.includes(tr.kind) ? Math.max(n, tr.periods * 120) : n;
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push(t, tr.offset + tr.amp * shape(tr, t));
  }
  return out;
}

let counter = 0;
export function newTrace(kind: TraceKind, patch: Partial<Trace> = {}): Trace {
  return {
    id: `t${Date.now().toString(36)}${counter++}`,
    kind,
    amp: 1,
    offset: 0,
    periods: 2,
    phase: 0,
    duty: 0.5,
    tau: 0.15,
    zeta: 0.3,
    ripple: 0.25,
    ...patch,
  };
}

export interface WavePreset {
  id: string;
  label: string;
  layout: 'overlay' | 'stacked';
  xLabel: string;
  yLabel: string;
  traces: () => Trace[];
}

export const WAVE_PRESETS: WavePreset[] = [
  {
    id: 'sine',
    label: 'Sine wave',
    layout: 'overlay',
    xLabel: 't',
    yLabel: 'v',
    traces: () => [newTrace('sine', { label: 'v(t)' })],
  },
  {
    id: 'three-phase',
    label: 'Three-phase voltages',
    layout: 'overlay',
    xLabel: '\\omega t',
    yLabel: 'v',
    traces: () => [
      newTrace('sine', { label: 'v_a', color: '@red' }),
      newTrace('sine', { label: 'v_b', phase: -120, color: '@green' }),
      newTrace('sine', { label: 'v_c', phase: -240, color: '@blue' }),
    ],
  },
  {
    id: 'pwm-carrier',
    label: 'PWM: carrier and reference',
    layout: 'overlay',
    xLabel: 't',
    yLabel: '',
    traces: () => [
      newTrace('triangle', { periods: 10, label: 'carrier', color: '@pencil' }),
      newTrace('sine', { periods: 1, amp: 0.8, label: 'v_{ref}', color: '@blue' }),
    ],
  },
  {
    id: 'buck',
    label: 'Buck converter chronogram',
    layout: 'stacked',
    xLabel: 't',
    yLabel: '',
    traces: () => [
      newTrace('pwm', { periods: 3, duty: 0.4, label: 'q' }),
      newTrace('square', { periods: 3, duty: 0.4, offset: 0.2, amp: 0.8, label: 'v_L' }),
      newTrace('ripple', { periods: 3, duty: 0.4, ripple: 0.3, label: 'i_L', color: '@blue' }),
    ],
  },
  {
    id: 'rectifier',
    label: 'Rectified sine (full / half wave)',
    layout: 'overlay',
    xLabel: '\\omega t',
    yLabel: 'v',
    traces: () => [
      newTrace('sine', { label: 'v_s', dashed: true, color: '@pencil' }),
      newTrace('fullwave', { label: 'v_d', color: '@red' }),
    ],
  },
  {
    id: 'step',
    label: 'Step responses (1st and 2nd order)',
    layout: 'overlay',
    xLabel: 't',
    yLabel: 'y',
    traces: () => [
      newTrace('step1', { tau: 0.12, label: '1^{st}', color: '@blue' }),
      newTrace('step2', { tau: 0.05, zeta: 0.3, label: '2^{nd}', color: '@red' }),
    ],
  },
  {
    id: 'clock',
    label: 'Digital chronogram',
    layout: 'stacked',
    xLabel: 't',
    yLabel: '',
    traces: () => [
      newTrace('pwm', { periods: 8, label: 'clk' }),
      newTrace('pwm', { periods: 4, label: 'Q_0' }),
      newTrace('pwm', { periods: 2, label: 'Q_1' }),
    ],
  },
];

export const TRACE_KINDS: { value: TraceKind; label: string }[] = [
  { value: 'sine', label: 'Sine' },
  { value: 'square', label: 'Square (±)' },
  { value: 'pwm', label: 'PWM / logic (0–1)' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
  { value: 'halfwave', label: 'Half-wave rectified' },
  { value: 'fullwave', label: 'Full-wave rectified' },
  { value: 'ripple', label: 'DC + ripple (inductor current)' },
  { value: 'step1', label: 'Step response, 1st order' },
  { value: 'step2', label: 'Step response, 2nd order' },
  { value: 'exp', label: 'Exponential decay' },
  { value: 'dc', label: 'DC level' },
  { value: 'custom', label: 'Custom (points)' },
];
