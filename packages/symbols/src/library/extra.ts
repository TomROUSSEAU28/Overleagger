/**
 * Additional symbols: parts that complete the base library (coupled inductors, shunt, 3-phase
 * rectifier, generic IC, regulator, converters, extra control blocks…).
 */
import { A, C, L, M, PC, R, T, arrow, arrowHead, dot, pin, sine, tf } from '../prims';
import type { OptionDef, PinDef, Primitive, SymbolDef } from '../types';
import { inductorBody, leads, resistorBody, twoPins } from './passives';
import { diodeBody, diodeFill } from './semiconductors';

const intOpt = (key: string, label: string, def: number, min: number, max: number): OptionDef => ({
  key,
  label,
  type: 'number',
  default: def,
  min,
  max,
  step: 1,
});

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.round(Number(v ?? def));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

// ---------------------------------------------------------------------------
// Passives
// ---------------------------------------------------------------------------

export const extraPassives: SymbolDef[] = [
  {
    id: 'inductor-coupled',
    name: 'Coupled inductors',
    category: 'Passives',
    keywords: ['mutual', 'coupled', 'flyback', 'common mode choke', 'magnetic'],
    refPrefix: 'L',
    options: [
      { key: 'dots', label: 'Dot convention', type: 'bool', default: true },
      { key: 'core', label: 'Core lines', type: 'bool', default: true },
    ],
    build: ({ opts }) => {
      const up = tf(inductorBody('loops'), { dy: -1 });
      const down = tf(inductorBody('loops'), { my: true, dy: 1 });
      const prims: Primitive[] = [
        L(-3, -1, -2, -1),
        L(2, -1, 3, -1),
        L(-3, 1, -2, 1),
        L(2, 1, 3, 1),
        ...up,
        ...down,
      ];
      if (opts.core) prims.push(L(-2, -0.15, 2, -0.15), L(-2, 0.15, 2, 0.15));
      if (opts.dots) prims.push(dot(-2.3, -1.6, 0.18), dot(-2.3, 1.6, 0.18));
      return {
        prims,
        pins: [pin('1a', -3, -1), pin('1b', 3, -1), pin('2a', -3, 1), pin('2b', 3, 1)],
      };
    },
  },
  {
    id: 'resistor-shunt',
    name: 'Shunt resistor (4-wire)',
    category: 'Passives',
    keywords: ['current sense', 'kelvin', 'shunt'],
    refPrefix: 'R',
    build: ({ standard }) => ({
      prims: [
        ...leads(3, 1.5),
        ...resistorBody(standard === 'ANSI'),
        L(-1, 0, -1, 2),
        L(1, 0, 1, 2),
        dot(-1, 0),
        dot(1, 0),
      ],
      pins: [...twoPins(3), pin('s+', -1, 2, 'Sense +'), pin('s-', 1, 2, 'Sense −')],
    }),
  },
  {
    id: 'photoresistor',
    name: 'Photoresistor (LDR)',
    category: 'Passives',
    keywords: ['ldr', 'light dependent', 'photocell'],
    refPrefix: 'R',
    build: ({ standard }) => ({
      prims: [
        ...leads(3, 1.5),
        ...resistorBody(standard === 'ANSI'),
        ...arrow(-1.8, -2.4, -0.8, -1.2, 0.4),
        ...arrow(-0.8, -2.4, 0.2, -1.2, 0.4),
      ],
      pins: twoPins(3),
    }),
  },
  {
    id: 'ferrite-bead',
    name: 'Ferrite bead',
    category: 'Passives',
    keywords: ['emi', 'filter', 'bead'],
    refPrefix: 'FB',
    build: () => ({
      prims: [L(-2, 0, 2, 0), PC([-0.5, -1, 1, -0.2, 0.5, 1, -1, 0.2], { fill: 'paper' })],
      pins: twoPins(2),
    }),
  },
  {
    id: 'transformer-3ph',
    name: 'Three-phase transformer (single-line)',
    category: 'Passives',
    keywords: ['dyn11', 'star', 'delta', 'wye', 'power system', '3 phase'],
    refPrefix: 'T',
    options: [
      {
        key: 'prim',
        label: 'Primary',
        type: 'enum',
        default: 'D',
        choices: [
          { value: 'D', label: 'Delta' },
          { value: 'Y', label: 'Star' },
        ],
      },
      {
        key: 'sec',
        label: 'Secondary',
        type: 'enum',
        default: 'Y',
        choices: [
          { value: 'D', label: 'Delta' },
          { value: 'Y', label: 'Star' },
        ],
      },
    ],
    build: ({ opts }) => {
      const mark = (kind: unknown, cx: number): Primitive[] =>
        kind === 'Y'
          ? [L(cx, 0, cx, -0.45), L(cx, 0, cx - 0.4, 0.25), L(cx, 0, cx + 0.4, 0.25)]
          : [PC([cx, -0.45, cx + 0.42, 0.28, cx - 0.42, 0.28])];
      return {
        prims: [
          L(-4, 0, -2.3, 0),
          L(2.3, 0, 4, 0),
          C(-0.8, 0, 1.5),
          C(0.8, 0, 1.5),
          ...mark(opts.prim, -1.4),
          ...mark(opts.sec, 1.4),
        ],
        pins: twoPins(4),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Sources & semiconductors
// ---------------------------------------------------------------------------

export const extraSources: SymbolDef[] = [
  {
    id: 'isource-ac',
    name: 'Current source (AC)',
    category: 'Sources',
    keywords: ['ac', 'sine', 'current'],
    refPrefix: 'I',
    build: () => ({
      prims: [
        L(0, -3, 0, -1.2),
        L(0, 1.2, 0, 3),
        C(0, 0, 1.2),
        sine(0, 0.1, 1.4, 0.7, 1),
        ...arrow(0, 2.6, 0, 1.6, 0.4),
      ],
      pins: [pin('+', 0, -3, 'Out'), pin('-', 0, 3, 'In')],
    }),
  },
];

export const extraSemis: SymbolDef[] = [
  {
    id: 'diode-varicap',
    name: 'Varicap diode',
    category: 'Diodes',
    keywords: ['varactor', 'tuning', 'capacitance diode'],
    refPrefix: 'D',
    build: ({ standard }) => ({
      prims: [
        L(-2, 0, -0.6, 0),
        L(1, 0, 2, 0),
        ...diodeBody(diodeFill(standard, 'auto')),
        L(1, -0.7, 1, 0.7),
      ],
      pins: [pin('a', -2, 0, 'Anode'), pin('k', 2, 0, 'Cathode')],
    }),
  },
  {
    id: 'phototransistor',
    name: 'Phototransistor',
    category: 'Transistors',
    keywords: ['light sensor', 'optical', 'npn'],
    refPrefix: 'Q',
    build: () => ({
      prims: [
        L(0, -0.9, 0, 0.9, { sw: 2 }),
        L(0, -0.4, 1, -1),
        L(1, -1, 1, -2),
        L(0, 0.4, 1, 1),
        L(1, 1, 1, 2),
        arrowHead(0.85, 0.91, 31, 0.55),
        C(0.35, 0, 1.55),
        ...arrow(-2.4, -1.8, -1.2, -0.6, 0.4),
        ...arrow(-2.4, -0.8, -1.2, 0.4, 0.4),
      ],
      pins: [pin('c', 1, -2, 'Collector'), pin('e', 1, 2, 'Emitter')],
    }),
  },
];

// ---------------------------------------------------------------------------
// Power modules & switches
// ---------------------------------------------------------------------------

/** Vertical diode between yBot (anode) and yTop (cathode), conducting upwards. */
function diodeV(x: number, yTop: number, yBot: number, fill: 'ink' | 'paper'): Primitive[] {
  const cy = (yTop + yBot) / 2;
  return [
    L(x, yTop, x, cy - 0.5),
    L(x, cy + 0.5, x, yBot),
    ...tf(diodeBody(fill, 'plain', 0.5), { rot: -90, dx: x, dy: cy }),
  ];
}

export const extraPower: SymbolDef[] = [
  {
    id: 'bridge-diode-3ph',
    name: 'Three-phase diode rectifier',
    category: 'Power modules',
    keywords: ['six pulse', 'b6', 'graetz', '3 phase', 'rectifier'],
    refPrefix: 'BR',
    options: [
      {
        key: 'fill',
        label: 'Diode triangle',
        type: 'enum',
        default: 'auto',
        choices: [
          { value: 'auto', label: 'Standard default' },
          { value: 'filled', label: 'Filled' },
          { value: 'empty', label: 'Empty' },
        ],
      },
    ],
    build: ({ standard, opts }) => {
      const fill = diodeFill(standard, opts.fill) === 'ink' ? 'ink' : 'paper';
      const prims: Primitive[] = [
        L(1, -5, 11, -5),
        L(1, 5, 11, 5),
        L(6, -5, 6, -7),
        L(6, 5, 6, 7),
        dot(6, -5),
        dot(6, 5),
      ];
      const pins: PinDef[] = [pin('dc+', 6, -7, 'DC+'), pin('dc-', 6, 7, 'DC−')];
      ['a', 'b', 'c'].forEach((ph, i) => {
        const x = 1 + i * 5;
        prims.push(
          ...diodeV(x, -5, 0, fill),
          ...diodeV(x, 0, 5, fill),
          dot(x, 0),
          L(x - 2, 0, x, 0),
        );
        pins.push(pin(ph, x - 2, 0, `Phase ${ph}`));
      });
      return { prims, pins };
    },
  },
  {
    id: 'switch-ideal',
    name: 'Ideal switch (controlled)',
    category: 'Switches & protection',
    keywords: ['ideal', 'controlled switch', 'plecs', 'simulation'],
    refPrefix: 'S',
    build: () => ({
      prims: [
        L(-3, 0, -1, 0),
        L(1, 0, 3, 0),
        L(-1, 0, 1, -1),
        dot(-1, 0, 0.18),
        dot(1, 0, 0.18),
        L(0, -0.5, 0, -2, { dash: 'dashed', sw: 0.8 }),
      ],
      pins: [pin('1', -3, 0), pin('2', 3, 0), pin('ctrl', 0, -2, 'Control')],
    }),
  },
  {
    id: 'isolation-barrier',
    name: 'Isolation barrier',
    category: 'Power modules',
    keywords: ['galvanic isolation', 'isolator', 'digital isolator', 'gate driver'],
    refPrefix: 'U',
    build: () => ({
      prims: [
        R(-3, -2, 6, 4),
        L(-0.25, -2, -0.25, 2, { dash: 'dashed', sw: 0.8 }),
        L(0.25, -2, 0.25, 2, { dash: 'dashed', sw: 0.8 }),
        L(-4, 0, -3, 0),
        L(3, 0, 4, 0),
        ...arrow(-2.2, 0, -0.6, 0, 0.4),
        ...arrow(0.6, 0, 2.2, 0, 0.4),
      ],
      pins: [pin('in', -4, 0, 'Input'), pin('out', 4, 0, 'Output')],
    }),
  },
];

// ---------------------------------------------------------------------------
// Analog / digital blocks
// ---------------------------------------------------------------------------

export const extraAnalog: SymbolDef[] = [
  {
    id: 'ic-generic',
    name: 'Integrated circuit (generic)',
    category: 'Analog & logic',
    keywords: ['ic', 'chip', 'microcontroller', 'mcu', 'dsp', 'fpga', 'package'],
    refPrefix: 'U',
    defaultValue: 'MCU',
    hideValueLabel: true,
    options: [
      intOpt('left', 'Pins on the left', 4, 0, 16),
      intOpt('right', 'Pins on the right', 4, 0, 16),
      intOpt('w', 'Width', 8, 4, 30),
    ],
    params: [{ key: 'pins', label: 'Pin names (comma separated, left then right)', default: '' }],
    build: ({ opts }) => {
      const nl = clampInt(opts.left, 4, 0, 16);
      const nr = clampInt(opts.right, 4, 0, 16);
      const w = clampInt(opts.w, 8, 4, 30);
      const n = Math.max(nl, nr, 1);
      const h = n * 2 + 2;
      const prims: Primitive[] = [R(0, 0, w, h), T(w / 2, -0.8, '{value}', { size: 1.1 })];
      const pins: PinDef[] = [];
      for (let i = 0; i < nl; i++) {
        const y = 2 + i * 2;
        prims.push(L(-2, y, 0, y), T(0.4, y, `{pin${i + 1}}`, { size: 0.9, anchor: 'start' }));
        pins.push(pin(`l${i + 1}`, -2, y, `Pin ${i + 1}`));
      }
      for (let i = 0; i < nr; i++) {
        const y = 2 + i * 2;
        prims.push(
          L(w, y, w + 2, y),
          T(w - 0.4, y, `{pin${nl + i + 1}}`, { size: 0.9, anchor: 'end' }),
        );
        pins.push(pin(`r${i + 1}`, w + 2, y, `Pin ${nl + i + 1}`));
      }
      return { prims, pins };
    },
  },
  {
    id: 'regulator',
    name: 'Voltage regulator (3-pin)',
    category: 'Analog & logic',
    keywords: ['ldo', '7805', 'linear regulator', 'lm317'],
    refPrefix: 'U',
    defaultValue: 'LDO',
    hideValueLabel: true,
    build: () => ({
      prims: [
        // Room for the name on top and the three pin names under it (same pins as before).
        R(-3.5, -2, 7, 4),
        L(-5, 0, -3.5, 0),
        L(3.5, 0, 5, 0),
        L(0, 2, 0, 3),
        T(0, -1.05, '{value}', { size: 1 }),
        T(-3.1, 0.2, 'IN', { size: 0.75, anchor: 'start' }),
        T(3.1, 0.2, 'OUT', { size: 0.75, anchor: 'end' }),
        T(0, 1.35, 'GND', { size: 0.75 }),
      ],
      pins: [pin('in', -5, 0, 'Input'), pin('out', 5, 0, 'Output'), pin('gnd', 0, 3, 'Ground')],
    }),
  },
  {
    id: 'adc',
    name: 'ADC',
    category: 'Analog & logic',
    keywords: ['analog to digital', 'converter', 'sampling'],
    refPrefix: 'U',
    build: () => ({
      prims: [
        PC([-2, -2, 1.5, -2, 3, 0, 1.5, 2, -2, 2]),
        L(-4, 0, -2, 0),
        L(3, 0, 5, 0),
        T(-0.4, -0.7, 'A', { size: 1 }),
        L(-1.2, 0.9, 0.6, -0.9, { sw: 0.8 }),
        T(0.9, 0.7, 'D', { size: 1 }),
      ],
      pins: [pin('in', -4, 0, 'Analog in'), pin('out', 5, 0, 'Digital out')],
    }),
  },
  {
    id: 'dac',
    name: 'DAC',
    category: 'Analog & logic',
    keywords: ['digital to analog', 'converter'],
    refPrefix: 'U',
    build: () => ({
      prims: [
        PC([-3, 0, -1.5, -2, 2, -2, 2, 2, -1.5, 2]),
        L(-5, 0, -3, 0),
        L(2, 0, 4, 0),
        T(-0.9, -0.7, 'D', { size: 1 }),
        L(-1.3, 0.9, 0.5, -0.9, { sw: 0.8 }),
        T(0.8, 0.7, 'A', { size: 1 }),
      ],
      pins: [pin('in', -5, 0, 'Digital in'), pin('out', 4, 0, 'Analog out')],
    }),
  },
];

// ---------------------------------------------------------------------------
// Measurement & annotations
// ---------------------------------------------------------------------------

export const extraMisc: SymbolDef[] = [
  {
    id: 'current-probe',
    name: 'Current probe (clamp)',
    category: 'Measurement',
    keywords: ['clamp', 'rogowski', 'scope', 'probe'],
    refPrefix: '',
    defaultValue: 'CH2',
    hideValueLabel: true,
    build: () => ({
      prims: [
        L(-2, 0, 2, 0),
        A(0, 0, 0.9, 200, 520),
        L(0.6, -0.7, 1.6, -1.8),
        arrowHead(-0.75, 0.55, 150, 0.45),
        T(1.8, -2.1, '{value}', { size: 0.9, anchor: 'start' }),
      ],
      pins: [pin('1', -2, 0), pin('2', 2, 0)],
    }),
  },
  {
    id: 'no-connect',
    name: 'No connection (×)',
    category: 'Annotations',
    kind: 'annotation',
    keywords: ['nc', 'not connected', 'unused pin'],
    refPrefix: '',
    build: () => ({
      prims: [L(-0.5, -0.5, 0.5, 0.5, { sw: 1.3 }), L(-0.5, 0.5, 0.5, -0.5, { sw: 1.3 })],
      pins: [],
    }),
  },
  {
    id: 'power-flow',
    name: 'Power flow arrow',
    category: 'Annotations',
    kind: 'annotation',
    keywords: ['energy', 'power', 'flow', 'p'],
    refPrefix: '',
    defaultValue: 'P',
    hideValueLabel: true,
    build: () => ({
      prims: [
        PC([-2.5, -0.35, 1.3, -0.35, 1.3, -0.8, 2.5, 0, 1.3, 0.8, 1.3, 0.35, -2.5, 0.35], {
          fill: 'paper',
        }),
        M(0, -1.4, '{value}'),
      ],
      pins: [],
    }),
  },
];

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

function frame(w: number, h: number): Primitive[] {
  return [R(-w / 2, -h / 2, w, h), L(-w / 2 - 1, 0, -w / 2, 0), L(w / 2, 0, w / 2 + 1, 0)];
}

export const extraControl: SymbolDef[] = [
  {
    id: 'ctl-state-space',
    name: 'State-space model',
    category: 'Control blocks',
    kind: 'control',
    keywords: ['block diagram', 'state space', 'abcd', 'matrix'],
    refPrefix: '',
    params: [
      {
        key: 'tex',
        label: 'Equations (LaTeX)',
        default: '\\begin{aligned}\\dot{x} &= Ax + Bu\\\\ y &= Cx + Du\\end{aligned}',
        math: true,
      },
    ],
    build: () => ({
      prims: [...frame(10, 6), M(0, 0, '{tex}')],
      pins: [pin('in', -6, 0, 'Input'), pin('out', 6, 0, 'Output')],
    }),
  },
  {
    id: 'ctl-integrator-z',
    name: 'Discrete integrator',
    category: 'Control blocks',
    kind: 'control',
    keywords: ['block diagram', 'discrete', 'accumulator', 'z'],
    refPrefix: '',
    params: [
      { key: 'tex', label: 'Expression (LaTeX)', default: '\\frac{T_s\\,z}{z-1}', math: true },
    ],
    build: () => ({
      prims: [...frame(6, 4), M(0, 0, '{tex}')],
      pins: [pin('in', -4, 0), pin('out', 4, 0)],
    }),
  },
  {
    id: 'ctl-sign',
    name: 'Sign',
    category: 'Control blocks',
    kind: 'control',
    keywords: ['block diagram', 'sign', 'sgn', 'nonlinear'],
    refPrefix: '',
    build: () => ({
      prims: [
        ...frame(4, 4),
        L(-1.6, 0, 1.6, 0, { sw: 0.5 }),
        L(0, -1.6, 0, 1.6, { sw: 0.5 }),
        L(-1.5, 0.9, 0, 0.9, { sw: 1.2 }),
        L(0, -0.9, 1.5, -0.9, { sw: 1.2 }),
      ],
      pins: [pin('in', -3, 0), pin('out', 3, 0)],
    }),
  },
  {
    id: 'ctl-switch',
    name: 'Signal switch',
    category: 'Control blocks',
    kind: 'control',
    keywords: ['block diagram', 'selector', 'multiport switch'],
    refPrefix: '',
    build: () => ({
      prims: [
        R(-2, -3, 4, 6),
        L(-3, -2, -2, -2),
        L(-3, 0, -2, 0),
        L(-3, 2, -2, 2),
        L(2, 0, 3, 0),
        // Two contacts, a blade from the output to input 1, and the control acting on it.
        L(-2, -2, -1.4, -2),
        L(-2, 2, -1.4, 2),
        dot(-1.4, -2, 0.16),
        dot(-1.4, 2, 0.16),
        L(-1.4, -2, 1.2, 0, { sw: 1.2 }),
        L(1.2, 0, 2, 0),
        L(-2, 0, -0.1, -1, { dash: 'dashed', sw: 0.7 }),
      ],
      pins: [
        pin('in1', -3, -2, 'Input 1'),
        pin('ctrl', -3, 0, 'Control'),
        pin('in2', -3, 2, 'Input 2'),
        pin('out', 3, 0, 'Output'),
      ],
    }),
  },
  {
    id: 'ctl-observer',
    name: 'Observer / estimator',
    category: 'Control blocks',
    kind: 'control',
    keywords: ['block diagram', 'luenberger', 'kalman', 'estimator'],
    refPrefix: '',
    params: [{ key: 'tex', label: 'Label (LaTeX)', default: '\\hat{x}', math: true }],
    build: () => ({
      prims: [
        R(-4, -3, 8, 6, { rx: 0.8 }),
        M(0, 0, '{tex}'),
        L(-5, -1, -4, -1),
        L(-5, 1, -4, 1),
        L(4, 0, 5, 0),
        T(-3.5, -1, 'u', { size: 0.8, anchor: 'start', italic: true }),
        T(-3.5, 1, 'y', { size: 0.8, anchor: 'start', italic: true }),
      ],
      pins: [pin('u', -5, -1, 'u'), pin('y', -5, 1, 'y'), pin('out', 5, 0, 'Estimate')],
    }),
  },
];
