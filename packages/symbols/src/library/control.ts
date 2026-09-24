import { C, L, M, P, PC, R, T, arrow, pin, sine } from '../prims';
import type { OptionDef, PinDef, Primitive, SymbolDef } from '../types';

const CAT = 'Control blocks';

const sizeOpts = (w: number, h: number): OptionDef[] => [
  { key: 'w', label: 'Width', type: 'number', default: w, min: 2, max: 40, step: 2 },
  { key: 'h', label: 'Height', type: 'number', default: h, min: 2, max: 40, step: 2 },
];

const even = (v: unknown, def: number) => {
  const n = Math.round(Number(v ?? def) / 2) * 2;
  return Number.isFinite(n) && n >= 2 ? n : def;
};

/** Rectangular SISO block with pins one grid unit outside the left/right edges. */
function sisoFrame(w: number, h: number): { prims: Primitive[]; pins: PinDef[] } {
  const hw = w / 2;
  return {
    prims: [R(-hw, -h / 2, w, h), L(-hw - 1, 0, -hw, 0), L(hw, 0, hw + 1, 0)],
    pins: [pin('in', -hw - 1, 0, 'Input'), pin('out', hw + 1, 0, 'Output')],
  };
}

/** Transfer-function style block: a rectangle with a LaTeX expression inside. */
function texBlock(
  id: string,
  name: string,
  tex: string,
  w: number,
  h: number,
  keywords: string[],
): SymbolDef {
  return {
    id,
    name,
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', ...keywords],
    refPrefix: '',
    params: [{ key: 'tex', label: 'Expression (LaTeX)', default: tex, math: true }],
    options: sizeOpts(w, h),
    build: ({ opts }) => {
      const bw = even(opts.w, w);
      const bh = even(opts.h, h);
      const f = sisoFrame(bw, bh);
      return { prims: [...f.prims, M(0, 0, '{tex}')], pins: f.pins };
    },
  };
}

/** Square block showing a small characteristic curve (saturation, relay…). */
function glyphBlock(
  id: string,
  name: string,
  glyph: Primitive[],
  keywords: string[],
  axes = true,
): SymbolDef {
  return {
    id,
    name,
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', ...keywords],
    refPrefix: '',
    build: () => {
      const f = sisoFrame(4, 4);
      const ax: Primitive[] = axes
        ? [L(-1.6, 0, 1.6, 0, { sw: 0.5 }), L(0, -1.6, 0, 1.6, { sw: 0.5 })]
        : [];
      return { prims: [...f.prims, ...ax, ...glyph], pins: f.pins };
    },
  };
}

/** Source block: output only. */
function sourceBlock(id: string, name: string, glyph: Primitive[], keywords: string[]): SymbolDef {
  return {
    id,
    name,
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'source', ...keywords],
    refPrefix: '',
    build: () => ({
      prims: [R(-2, -2, 4, 4), L(2, 0, 3, 0), ...glyph],
      pins: [pin('out', 3, 0, 'Output')],
    }),
  };
}

const sumLayouts = [
  { value: 'lb', label: 'Left + bottom' },
  { value: 'lt', label: 'Left + top' },
  { value: 'lbt', label: 'Left + bottom + top' },
  { value: 'll', label: 'Two left inputs' },
];

function sumBlock(): SymbolDef {
  return {
    id: 'ctl-sum',
    name: 'Sum junction',
    category: CAT,
    kind: 'control',
    keywords: ['summing', 'comparator', 'error', 'sommateur', 'plus minus'],
    refPrefix: '',
    options: [
      { key: 'layout', label: 'Inputs', type: 'enum', default: 'lb', choices: sumLayouts },
      {
        key: 'signs',
        label: 'Signs (in order)',
        type: 'enum',
        default: '+-',
        choices: ['+-', '++', '-+', '--', '+-+', '++-', '+--', '+++'].map((v) => ({
          value: v,
          label: v,
        })),
      },
      { key: 'cross', label: 'Cross inside', type: 'bool', default: false },
    ],
    build: ({ opts }) => {
      const layout = String(opts.layout ?? 'lb');
      const signs = String(opts.signs ?? '+-');
      const r = 1;
      const prims: Primitive[] = [C(0, 0, r), L(r, 0, 2, 0)];
      if (opts.cross) prims.push(L(-0.707, -0.707, 0.707, 0.707), L(-0.707, 0.707, 0.707, -0.707));
      const pins: PinDef[] = [pin('out', 2, 0, 'Output')];
      const inputs: {
        id: string;
        x: number;
        y: number;
        line: Primitive;
        sx: number;
        sy: number;
      }[] = [];
      if (layout === 'll') {
        inputs.push(
          { id: 'in1', x: -2, y: -1, line: P([-2, -1, -0.9, -1, -0.6, -0.8]), sx: -1.5, sy: -1.6 },
          { id: 'in2', x: -2, y: 1, line: P([-2, 1, -0.9, 1, -0.6, 0.8]), sx: -1.5, sy: 1.6 },
        );
      } else {
        inputs.push({ id: 'in1', x: -2, y: 0, line: L(-2, 0, -r, 0), sx: -1.5, sy: -0.6 });
        if (layout.includes('b'))
          inputs.push({
            id: `in${inputs.length + 1}`,
            x: 0,
            y: 2,
            line: L(0, 2, 0, r),
            sx: 0.6,
            sy: 1.5,
          });
        if (layout.includes('t'))
          inputs.push({
            id: `in${inputs.length + 1}`,
            x: 0,
            y: -2,
            line: L(0, -2, 0, -r),
            sx: 0.6,
            sy: -1.5,
          });
      }
      inputs.forEach((inp, i) => {
        prims.push(inp.line);
        const s = signs[i] ?? '+';
        prims.push(T(inp.sx, inp.sy, s === '-' ? '−' : '+', { size: 1.15 }));
        pins.push(pin(inp.id, inp.x, inp.y, `Input ${i + 1}`));
      });
      return { prims, pins };
    },
  };
}

function multiPortBlock(
  id: string,
  name: string,
  tex: string,
  inputs: string[],
  outputs: string[],
  keywords: string[],
  bottom?: string,
): SymbolDef {
  const n = Math.max(inputs.length, outputs.length);
  const h = Math.max(4, n * 2 + 2);
  const w = 8;
  return {
    id,
    name,
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', ...keywords],
    refPrefix: '',
    params: [{ key: 'tex', label: 'Expression (LaTeX)', default: tex, math: true }],
    build: () => {
      const prims: Primitive[] = [R(-w / 2, -h / 2, w, h), M(0, bottom ? -0.6 : 0, '{tex}', 1.1)];
      const pins: PinDef[] = [];
      const place = (names: string[], side: -1 | 1) => {
        const y0 = -(names.length - 1);
        names.forEach((nm, i) => {
          const y = y0 + i * 2;
          const x = side * (w / 2 + 1);
          prims.push(L(side * (w / 2), y, x, y), M(side * (w / 2 - 0.6), y, nm, 0.8));
          pins.push(pin(`${side < 0 ? 'in' : 'out'}${i + 1}`, x, y, nm));
        });
      };
      place(inputs, -1);
      place(outputs, 1);
      if (bottom) {
        prims.push(L(0, h / 2, 0, h / 2 + 1), M(0, h / 2 - 0.7, bottom, 0.8));
        pins.push(pin('aux', 0, h / 2 + 1, bottom));
      }
      return { prims, pins };
    },
  };
}

/** Thin filled bar with several inputs (mux) or outputs (demux). */
function busBlock(id: string, name: string, demux: boolean): SymbolDef {
  return {
    id,
    name,
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'bus', 'vector', demux ? 'demultiplexer' : 'multiplexer'],
    refPrefix: '',
    options: [
      {
        key: 'n',
        label: demux ? 'Outputs' : 'Inputs',
        type: 'number',
        default: 2,
        min: 2,
        max: 8,
        step: 1,
      },
    ],
    build: ({ opts }) => {
      const n = Math.max(2, Math.min(8, Math.round(Number(opts.n ?? 2))));
      const h = n * 2;
      const side = demux ? 1 : -1;
      const prims: Primitive[] = [
        R(-0.35, -h / 2, 0.7, h, { fill: 'ink' }),
        L(-side * 0.35, 0, -side * 2, 0),
      ];
      const pins: PinDef[] = [pin(demux ? 'in' : 'out', -side * 2, 0, demux ? 'Input' : 'Output')];
      for (let i = 0; i < n; i++) {
        const y = -(n - 1) + i * 2;
        prims.push(L(side * 0.35, y, side * 2, y));
        pins.push(
          pin(
            `${demux ? 'out' : 'in'}${i + 1}`,
            side * 2,
            y,
            `${demux ? 'Output' : 'Input'} ${i + 1}`,
          ),
        );
      }
      return { prims, pins };
    },
  };
}

const step = (): Primitive[] => [P([-1.4, 1, -0.2, 1, -0.2, -1, 1.4, -1])];
const ramp = (): Primitive[] => [P([-1.4, 1, -0.4, 1, 1.4, -1.2])];

export const control: SymbolDef[] = [
  sumBlock(),
  {
    id: 'ctl-gain',
    name: 'Gain',
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'proportional', 'k', 'amplifier'],
    refPrefix: '',
    params: [{ key: 'tex', label: 'Gain (LaTeX)', default: 'K', math: true }],
    build: () => ({
      prims: [PC([-2, -2, -2, 2, 2, 0]), L(-3, 0, -2, 0), L(2, 0, 3, 0), M(-0.7, 0, '{tex}', 1.1)],
      pins: [pin('in', -3, 0, 'Input'), pin('out', 3, 0, 'Output')],
    }),
  },
  texBlock('ctl-tf', 'Transfer function', '\\frac{K}{1+\\tau s}', 6, 4, [
    'tf',
    'laplace',
    'h(s)',
    'fonction de transfert',
  ]),
  texBlock('ctl-block', 'Generic block G(s)', 'G(s)', 6, 4, ['plant', 'system', 'process']),
  texBlock('ctl-integrator', 'Integrator', '\\frac{1}{s}', 4, 4, ['integral', '1/s']),
  texBlock('ctl-derivative', 'Derivative', 's', 4, 4, ['differentiator', 'du/dt']),
  texBlock('ctl-pi', 'PI controller', 'K_p + \\frac{K_i}{s}', 8, 4, [
    'proportional integral',
    'regulator',
    'correcteur',
  ]),
  texBlock('ctl-pid', 'PID controller', 'K_p + \\frac{K_i}{s} + K_d s', 10, 4, [
    'regulator',
    'correcteur',
    'pid',
  ]),
  texBlock('ctl-lowpass', 'Low-pass filter', '\\frac{1}{1+\\tau s}', 6, 4, [
    'filter',
    'first order',
    'lpf',
  ]),
  texBlock('ctl-delay', 'Time delay', 'e^{-sT}', 4, 4, ['transport delay', 'dead time', 'retard']),
  texBlock('ctl-zinv', 'Unit delay', 'z^{-1}', 4, 4, ['discrete', 'z transform', 'memory']),
  texBlock('ctl-zoh', 'Zero-order hold', '\\mathrm{ZOH}', 6, 4, [
    'sampler',
    'bloqueur',
    'discrete',
  ]),
  texBlock('ctl-fcn', 'Function f(u)', 'f(u)', 6, 4, ['function', 'nonlinear', 'math']),
  texBlock(
    'ctl-tf-z',
    'Discrete transfer function',
    '\\frac{b_0 + b_1 z^{-1}}{1 + a_1 z^{-1}}',
    8,
    4,
    ['digital', 'z', 'discrete'],
  ),
  glyphBlock(
    'ctl-saturation',
    'Saturation',
    [P([-1.5, 1, -0.7, 1, 0.7, -1, 1.5, -1], { sw: 1.2 })],
    ['limiter', 'clamp', 'saturation'],
  ),
  glyphBlock(
    'ctl-deadzone',
    'Dead zone',
    [P([-1.5, 0.9, -0.6, 0, 0.6, 0, 1.5, -0.9], { sw: 1.2 })],
    ['dead band', 'zone morte'],
  ),
  glyphBlock(
    'ctl-relay',
    'Relay (hysteresis)',
    [
      P([-1.5, 0.8, 0.4, 0.8, 0.4, -0.8, 1.5, -0.8], { sw: 1.2 }),
      P([-1.5, 0.8, -0.4, 0.8, -0.4, -0.8, 0.4, -0.8], { sw: 0.8, dash: 'dashed' }),
    ],
    ['hysteresis', 'bang-bang', 'schmitt', 'on off'],
  ),
  glyphBlock(
    'ctl-ratelimit',
    'Rate limiter',
    [
      P([-1.5, 1.1, -0.6, 1.1, 0.6, -1.1, 1.5, -1.1], { sw: 1.2 }),
      T(0.9, 0.7, 'd/dt', { size: 0.55 }),
    ],
    ['slew rate', 'ramp limiter'],
  ),
  glyphBlock(
    'ctl-quantizer',
    'Quantizer',
    [
      P([-1.4, 1.2, -0.7, 1.2, -0.7, 0.6, 0, 0.6, 0, 0, 0.7, 0, 0.7, -0.6, 1.4, -0.6, 1.4, -1.2], {
        sw: 1.2,
      }),
    ],
    ['adc', 'staircase', 'discrete'],
    false,
  ),
  glyphBlock('ctl-abs', 'Absolute value', [M(0, 0, '|u|', 1.2)], ['abs', 'rectify'], false),
  glyphBlock(
    'ctl-lookup',
    '1-D lookup table',
    [P([-1.4, 1, -0.6, 0.3, 0.2, 0.1, 0.8, -0.8, 1.4, -1], { sw: 1.2 })],
    ['lut', 'map', 'table'],
    true,
  ),
  {
    id: 'ctl-pwm',
    name: 'PWM modulator',
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'modulation', 'carrier', 'mli', 'duty cycle'],
    refPrefix: '',
    build: () => {
      const f = sisoFrame(6, 4);
      return {
        prims: [
          ...f.prims,
          P([-2.4, 0.2, -1.6, -1.4, -0.8, 0.2, 0, -1.4, 0.8, 0.2, 1.6, -1.4, 2.4, 0.2], {
            sw: 0.7,
          }),
          P(
            [
              -2.4, 1.4, -2, 1.4, -2, 0.6, -1.2, 0.6, -1.2, 1.4, -0.4, 1.4, -0.4, 0.6, 0.4, 0.6,
              0.4, 1.4, 1.2, 1.4, 1.2, 0.6, 2, 0.6, 2, 1.4, 2.4, 1.4,
            ],
            { sw: 1 },
          ),
        ],
        pins: f.pins,
      };
    },
  },
  {
    id: 'ctl-sample-hold',
    name: 'Sample & hold',
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 's/h', 'sampler', 'echantillonneur'],
    refPrefix: '',
    build: () => {
      const f = sisoFrame(4, 4);
      return {
        prims: [
          ...f.prims,
          L(-2, 0, -0.9, 0),
          L(-0.9, 0, 0.6, -0.8),
          L(0.8, 0, 2, 0),
          T(0, 1.2, 'S/H', { size: 0.7 }),
        ],
        pins: f.pins,
      };
    },
  },
  {
    id: 'ctl-product',
    name: 'Product',
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'multiplier', 'multiply', 'times'],
    refPrefix: '',
    build: () => ({
      prims: [
        C(0, 0, 1),
        L(-2, 0, -1, 0),
        L(0, 2, 0, 1),
        L(1, 0, 2, 0),
        L(-0.707, -0.707, 0.707, 0.707),
        L(-0.707, 0.707, 0.707, -0.707),
      ],
      pins: [pin('in1', -2, 0, 'Input 1'), pin('in2', 0, 2, 'Input 2'), pin('out', 2, 0, 'Output')],
    }),
  },
  {
    id: 'ctl-divide',
    name: 'Divide',
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'division', 'ratio'],
    refPrefix: '',
    build: () => ({
      prims: [
        C(0, 0, 1),
        L(-2, 0, -1, 0),
        L(0, 2, 0, 1),
        L(1, 0, 2, 0),
        T(0, 0, '÷', { size: 1.3 }),
      ],
      pins: [
        pin('num', -2, 0, 'Numerator'),
        pin('den', 0, 2, 'Denominator'),
        pin('out', 2, 0, 'Output'),
      ],
    }),
  },
  multiPortBlock(
    'ctl-clarke',
    'Clarke transform (abc→αβ)',
    'abc \\to \\alpha\\beta',
    ['a', 'b', 'c'],
    ['\\alpha', '\\beta'],
    ['concordia', 'alpha beta', 'transformation'],
  ),
  multiPortBlock(
    'ctl-park',
    'Park transform (αβ→dq)',
    '\\alpha\\beta \\to dq',
    ['\\alpha', '\\beta'],
    ['d', 'q'],
    ['dq', 'rotating frame', 'transformation'],
    '\\theta',
  ),
  multiPortBlock(
    'ctl-park-inv',
    'Inverse Park (dq→αβ)',
    'dq \\to \\alpha\\beta',
    ['d', 'q'],
    ['\\alpha', '\\beta'],
    ['inverse park', 'dq', 'transformation'],
    '\\theta',
  ),
  multiPortBlock(
    'ctl-abc-dq',
    'abc→dq transform',
    'abc \\to dq',
    ['a', 'b', 'c'],
    ['d', 'q'],
    ['park', 'dq0', 'transformation'],
    '\\theta',
  ),
  multiPortBlock(
    'ctl-pll',
    'Phase-locked loop (PLL)',
    '\\mathrm{PLL}',
    ['v'],
    ['\\theta', '\\omega'],
    ['pll', 'synchronisation', 'grid sync'],
  ),
  busBlock('ctl-mux', 'Mux', false),
  busBlock('ctl-demux', 'Demux', true),
  {
    id: 'ctl-scope',
    name: 'Scope',
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'oscilloscope', 'display', 'sink'],
    refPrefix: '',
    build: () => ({
      prims: [
        L(-3, 0, -2, 0),
        R(-2, -2, 4, 4),
        R(-1.5, -1.5, 3, 2.2, { sw: 0.7 }),
        sine(0, -0.4, 2.6, 1.2, 1.5),
        C(-1, 1.3, 0.2),
        C(0, 1.3, 0.2),
      ],
      pins: [pin('in', -3, 0, 'Input')],
    }),
  },
  sourceBlock('ctl-step', 'Step', step(), ['heaviside', 'echelon', 'reference']),
  sourceBlock('ctl-ramp', 'Ramp', ramp(), ['rampe', 'reference']),
  sourceBlock('ctl-sine', 'Sine wave', [sine(0, 0, 3, 2, 1)], ['sinus', 'oscillator', 'reference']),
  {
    id: 'ctl-const',
    name: 'Constant',
    category: CAT,
    kind: 'control',
    keywords: ['block diagram', 'constant', 'setpoint', 'reference', 'consigne'],
    refPrefix: '',
    params: [{ key: 'tex', label: 'Value (LaTeX)', default: 'x^*', math: true }],
    build: () => ({
      prims: [R(-2, -1.5, 4, 3), L(2, 0, 3, 0), M(0, 0, '{tex}')],
      pins: [pin('out', 3, 0, 'Output')],
    }),
  },
  {
    id: 'ctl-signal-label',
    name: 'Signal arrow',
    category: CAT,
    kind: 'annotation',
    keywords: ['block diagram', 'arrow', 'signal', 'label'],
    refPrefix: '',
    params: [{ key: 'tex', label: 'Label (LaTeX)', default: 'u', math: true }],
    build: () => ({
      prims: [...arrow(-2, 0, 2, 0, 0.55), M(0, -0.9, '{tex}')],
      pins: [pin('in', -2, 0), pin('out', 2, 0)],
    }),
  },
];
