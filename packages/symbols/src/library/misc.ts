import {
  A,
  C,
  L,
  M,
  P,
  PC,
  R,
  T,
  arrow,
  arrowHead,
  bez2,
  dot,
  pin,
  sine,
  tf,
  sign,
  plus,
  minus,
} from '../prims';
import type { OptionDef, Primitive, Standard, SymbolDef } from '../types';
import { diodeBody, diodeFill } from './semiconductors';

// ---------------------------------------------------------------------------
// Switches & protection
// ---------------------------------------------------------------------------

const SWITCHES = 'Switches & protection';

const contactDots = (standard: Standard, xs: [number, number][]): Primitive[] =>
  standard === 'ANSI' ? xs.map(([x, y]) => C(x, y, 0.22, { fill: 'paper' })) : [];

const ncOpt: OptionDef = {
  key: 'contact',
  label: 'Contact',
  type: 'enum',
  default: 'no',
  choices: [
    { value: 'no', label: 'Normally open' },
    { value: 'nc', label: 'Normally closed' },
  ],
};

function blade(nc: boolean): Primitive[] {
  return nc ? [L(-0.8, 0, 1.05, 0.45), L(0.8, 0, 0.8, 0.7)] : [L(-0.8, 0, 0.75, -0.9)];
}

export const switches: SymbolDef[] = [
  {
    id: 'switch',
    name: 'Switch (SPST)',
    category: SWITCHES,
    keywords: ['spst', 'interrupteur', 'ideal switch', 'contact'],
    refPrefix: 'S',
    options: [ncOpt],
    build: ({ standard, opts }) => ({
      prims: [
        L(-2, 0, -0.8, 0),
        L(0.8, 0, 2, 0),
        ...blade(opts.contact === 'nc'),
        ...contactDots(standard, [
          [-0.8, 0],
          [0.8, 0],
        ]),
      ],
      pins: [pin('1', -2, 0), pin('2', 2, 0)],
    }),
  },
  {
    id: 'switch-spdt',
    name: 'Changeover switch (SPDT)',
    category: SWITCHES,
    keywords: ['spdt', 'changeover', 'inverseur', 'selector'],
    refPrefix: 'S',
    build: ({ standard }) => ({
      prims: [
        L(-2, 0, -0.8, 0),
        L(-0.8, 0, 0.85, -0.85),
        P([0.8, -1, 1.2, -1, 2, -1]),
        P([0.8, 1, 2, 1]),
        ...contactDots(standard, [
          [-0.8, 0],
          [0.8, -1],
          [0.8, 1],
        ]),
      ],
      pins: [pin('c', -2, 0, 'Common'), pin('a', 2, -1, 'Throw A'), pin('b', 2, 1, 'Throw B')],
    }),
  },
  {
    id: 'pushbutton',
    name: 'Push button',
    category: SWITCHES,
    keywords: ['button', 'momentary', 'bouton poussoir'],
    refPrefix: 'S',
    options: [ncOpt],
    build: ({ standard, opts }) => {
      const nc = opts.contact === 'nc';
      return {
        prims: [
          L(-2, 0, -0.8, 0),
          L(0.8, 0, 2, 0),
          ...(nc ? [L(-0.9, 0.35, 0.9, 0.35)] : [L(-0.9, -0.5, 0.9, -0.5)]),
          L(0, nc ? 0.35 : -0.5, 0, -1.4),
          L(-0.6, -1.4, 0.6, -1.4),
          ...contactDots(standard, [
            [-0.8, 0],
            [0.8, 0],
          ]),
        ],
        pins: [pin('1', -2, 0), pin('2', 2, 0)],
      };
    },
  },
  {
    id: 'contactor',
    name: 'Contactor / relay contact',
    category: SWITCHES,
    keywords: ['relay contact', 'kontaktor', 'contacteur'],
    refPrefix: 'K',
    options: [ncOpt],
    build: ({ opts }) => ({
      prims: [
        L(-2, 0, -0.8, 0),
        L(0.8, 0, 2, 0),
        ...blade(opts.contact === 'nc'),
        A(1.1, 0, 0.3, 180, 360),
      ],
      pins: [pin('1', -2, 0), pin('2', 2, 0)],
    }),
  },
  {
    id: 'breaker',
    name: 'Circuit breaker',
    category: SWITCHES,
    keywords: ['disjoncteur', 'mcb', 'protection'],
    refPrefix: 'Q',
    build: () => ({
      prims: [
        L(-2, 0, -0.8, 0),
        L(0.8, 0, 2, 0),
        L(-0.8, 0, 0.75, -0.9),
        L(0.55, -0.25, 1.05, 0.25),
        L(0.55, 0.25, 1.05, -0.25),
      ],
      pins: [pin('1', -2, 0), pin('2', 2, 0)],
    }),
  },
  {
    id: 'relay-coil',
    name: 'Relay coil',
    category: SWITCHES,
    keywords: ['relay', 'coil', 'bobine', 'contactor coil'],
    refPrefix: 'K',
    build: ({ standard }) => ({
      prims:
        standard === 'ANSI'
          ? [L(-2, 0, -1, 0), L(1, 0, 2, 0), C(0, 0, 1)]
          : [L(-2, 0, -1, 0), L(1, 0, 2, 0), R(-1, -0.6, 2, 1.2), L(-1, 0.6, 1, -0.6)],
      pins: [pin('1', -2, 0), pin('2', 2, 0)],
    }),
  },
];

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

const MACHINES = 'Machines';

const dcGlyph = (y: number): Primitive[] => [
  L(-0.6, y - 0.12, 0.6, y - 0.12),
  L(-0.6, y + 0.18, 0.6, y + 0.18, { dash: 'dashed' }),
];

function dcMachine(id: string, name: string, letter: string, keywords: string[]): SymbolDef {
  return {
    id,
    name,
    category: MACHINES,
    keywords,
    refPrefix: letter,
    params: [{ key: 'label', label: 'Letter', default: letter }],
    build: () => ({
      prims: [
        L(0, -3, 0, -1.5),
        L(0, 1.5, 0, 3),
        C(0, 0, 1.5),
        T(0, -0.3, '{label}', { size: 1.3 }),
        ...dcGlyph(0.75),
      ],
      pins: [pin('+', 0, -3, 'Positive'), pin('-', 0, 3, 'Negative')],
    }),
  };
}

function acMachine(
  id: string,
  name: string,
  letter: string,
  sub: string,
  keywords: string[],
): SymbolDef {
  const r = 2.5;
  return {
    id,
    name,
    category: MACHINES,
    keywords,
    refPrefix: letter,
    params: [
      { key: 'label', label: 'Letter', default: letter },
      { key: 'sub', label: 'Subscript (LaTeX)', default: sub, math: true },
    ],
    build: () => ({
      prims: [
        L(-2, -4, -2, -Math.sqrt(r * r - 4)),
        L(0, -4, 0, -r),
        L(2, -4, 2, -Math.sqrt(r * r - 4)),
        C(0, 0, r),
        T(0, -0.3, '{label}', { size: 1.4 }),
        M(0, 1.25, '{sub}', 1),
      ],
      pins: [pin('u', -2, -4, 'Phase U'), pin('v', 0, -4, 'Phase V'), pin('w', 2, -4, 'Phase W')],
    }),
  };
}

export const machines: SymbolDef[] = [
  dcMachine('motor-dc', 'DC motor', 'M', ['dc motor', 'moteur', 'mcc']),
  dcMachine('generator-dc', 'DC generator', 'G', ['dynamo', 'generator', 'génératrice']),
  acMachine('motor-3ph', 'Three-phase motor', 'M', '3\\sim', [
    'induction',
    'asynchronous',
    'moteur asynchrone',
    'mas',
    'squirrel',
  ]),
  acMachine('motor-pmsm', 'Synchronous motor (PMSM)', 'MS', '3\\sim', [
    'pmsm',
    'synchronous',
    'msap',
    'permanent magnet',
  ]),
  acMachine('motor-bldc', 'BLDC motor', 'M', '\\mathrm{BLDC}', ['brushless', 'bldc', 'ec motor']),
  acMachine('generator-3ph', 'Three-phase generator', 'G', '3\\sim', [
    'alternator',
    'wind',
    'synchronous generator',
  ]),
];

// ---------------------------------------------------------------------------
// Analog, drivers & logic
// ---------------------------------------------------------------------------

const ANALOG = 'Analog & logic';

function opampGraphics(standard: Standard, supply: boolean, plusTop: boolean, comparator: boolean) {
  const prims: Primitive[] = [L(-3, -1, -2, -1), L(-3, 1, -2, 1), L(2, 0, 3, 0)];
  if (standard === 'IEC') {
    prims.push(R(-2, -2, 4, 4), T(0.9, -1.2, comparator ? '⊳' : '▷∞', { size: 0.8 }));
  } else {
    prims.push(PC([-2, -2, -2, 2, 2, 0]));
  }
  prims.push(...sign(plusTop ? '+' : '-', -1.45, -1), ...sign(plusTop ? '-' : '+', -1.45, 1));
  if (comparator)
    prims.push(P([-0.5, 0.5, 0.1, 0.5, 0.1, -0.3, 0.7, -0.3]), P([-0.3, 0.5, 0.3, 0.5, 0.3, -0.3]));
  const pins = [
    pin(plusTop ? 'in+' : 'in-', -3, -1, plusTop ? 'Non-inverting input' : 'Inverting input'),
    pin(plusTop ? 'in-' : 'in+', -3, 1, plusTop ? 'Inverting input' : 'Non-inverting input'),
    pin('out', 3, 0, 'Output'),
  ];
  if (supply) {
    const y = standard === 'IEC' ? 2 : 1;
    prims.push(L(0, -3, 0, -y), L(0, y, 0, 3));
    pins.push(pin('v+', 0, -3, 'V+'), pin('v-', 0, 3, 'V−'));
  }
  return { prims, pins };
}

const opampOpts: OptionDef[] = [
  { key: 'supply', label: 'Supply pins', type: 'bool', default: false },
  { key: 'plusTop', label: '+ input on top', type: 'bool', default: false },
];

type GateKind = 'and' | 'or' | 'xor' | 'not' | 'buf';

function gateShape(kind: GateKind, standard: Standard, invert: boolean): Primitive[] {
  const out: Primitive[] = [];
  const oneInput = kind === 'not' || kind === 'buf';
  if (standard === 'IEC') {
    out.push(R(-2, -2, 4, 4));
    const label = { and: '&', or: '≥1', xor: '=1', not: '1', buf: '1' }[kind];
    out.push(T(0, -0.9, label, { size: 1.1 }));
    if (invert) out.push(C(2.3, 0, 0.3));
  } else if (kind === 'and') {
    out.push(P([0, -2, -2, -2, -2, 2, 0, 2]), A(0, 0, 2, -90, 90));
    if (invert) out.push(C(2.3, 0, 0.3));
  } else if (kind === 'or' || kind === 'xor') {
    const pts = [
      ...bez2(-2, -2, -1, 0, -2, 2),
      ...bez2(-2, 2, 0.8, 2, 2, 0, 12, true),
      ...bez2(2, 0, 0.8, -2, -2, -2, 12, true),
    ];
    out.push(PC(pts));
    if (kind === 'xor') out.push(P(bez2(-2.5, -2, -1.5, 0, -2.5, 2)));
    if (invert) out.push(C(2.3, 0, 0.3));
  } else {
    out.push(PC([-2, -1.6, -2, 1.6, 1.6, 0]));
    if (invert) out.push(C(1.9, 0, 0.3));
  }
  // Leads
  const inX =
    standard === 'ANSI' && (kind === 'or' || kind === 'xor') ? (kind === 'xor' ? -2.1 : -1.6) : -2;
  if (oneInput) out.push(L(-3, 0, -2, 0));
  else out.push(L(-3, -1, inX, -1), L(-3, 1, inX, 1));
  const outStart = invert
    ? standard === 'ANSI' && oneInput
      ? 2.2
      : 2.6
    : standard === 'ANSI' && oneInput
      ? 1.6
      : 2;
  out.push(L(outStart, 0, 3, 0));
  return out;
}

function gate(id: string, name: string, kind: GateKind, invert: boolean): SymbolDef {
  const oneInput = kind === 'not' || kind === 'buf';
  return {
    id,
    name,
    category: ANALOG,
    keywords: ['logic', 'gate', 'digital', kind],
    refPrefix: 'U',
    build: ({ standard }) => ({
      prims: gateShape(kind, standard, invert),
      pins: oneInput
        ? [pin('in', -3, 0, 'Input'), pin('out', 3, 0, 'Output')]
        : [pin('a', -3, -1, 'Input A'), pin('b', -3, 1, 'Input B'), pin('out', 3, 0, 'Output')],
    }),
  };
}

export const analog: SymbolDef[] = [
  {
    id: 'opamp',
    name: 'Operational amplifier',
    category: ANALOG,
    keywords: ['op-amp', 'aop', 'amplifier', 'ampli op'],
    refPrefix: 'U',
    options: opampOpts,
    build: ({ standard, opts }) =>
      opampGraphics(standard, Boolean(opts.supply), Boolean(opts.plusTop), false),
  },
  {
    id: 'comparator',
    name: 'Comparator',
    category: ANALOG,
    keywords: ['comparateur', 'schmitt', 'hysteresis'],
    refPrefix: 'U',
    options: opampOpts,
    build: ({ standard, opts }) =>
      opampGraphics(standard, Boolean(opts.supply), Boolean(opts.plusTop), true),
  },
  {
    id: 'optocoupler',
    name: 'Optocoupler',
    category: ANALOG,
    keywords: ['opto', 'isolation', 'photocoupler'],
    refPrefix: 'U',
    build: ({ standard }) => {
      const fill = diodeFill(standard, 'auto');
      const led = tf(diodeBody(fill, 'plain', 0.5), { rot: 90, dx: -2 });
      return {
        prims: [
          R(-3, -2.8, 6, 5.6),
          P([-4, -2, -2, -2, -2, -0.5]),
          P([-4, 2, -2, 2, -2, 0.5]),
          ...led,
          ...arrow(-1.3, -0.3, -0.1, -0.3, 0.4),
          ...arrow(-1.3, 0.4, -0.1, 0.4, 0.4),
          L(0.6, -0.9, 0.6, 0.9, { sw: 2 }),
          P([0.6, -0.4, 1.8, -1.1, 1.8, -2, 4, -2]),
          P([0.6, 0.4, 1.8, 1.1, 1.8, 2, 4, 2]),
          arrowHead(1.55, 0.96, 30, 0.5),
        ],
        pins: [
          pin('a', -4, -2, 'Anode'),
          pin('k', -4, 2, 'Cathode'),
          pin('c', 4, -2, 'Collector'),
          pin('e', 4, 2, 'Emitter'),
        ],
      };
    },
  },
  gate('gate-and', 'AND gate', 'and', false),
  gate('gate-nand', 'NAND gate', 'and', true),
  gate('gate-or', 'OR gate', 'or', false),
  gate('gate-nor', 'NOR gate', 'or', true),
  gate('gate-xor', 'XOR gate', 'xor', false),
  gate('gate-not', 'NOT gate (inverter)', 'not', true),
  gate('gate-buf', 'Buffer', 'buf', false),
];

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const MEAS = 'Measurement';

function meter(id: string, name: string, letter: string, keywords: string[]): SymbolDef {
  return {
    id,
    name,
    category: MEAS,
    keywords,
    refPrefix: letter === 'V' ? 'VM' : letter === 'A' ? 'AM' : 'M',
    build: () => ({
      prims: [L(-2, 0, -1.1, 0), L(1.1, 0, 2, 0), C(0, 0, 1.1), T(0, 0, letter, { size: 1.2 })],
      pins: [pin('+', -2, 0, 'Positive'), pin('-', 2, 0, 'Negative')],
    }),
  };
}

export const measurement: SymbolDef[] = [
  meter('voltmeter', 'Voltmeter', 'V', ['voltage', 'measure']),
  meter('ammeter', 'Ammeter', 'A', ['current', 'measure']),
  meter('ohmmeter', 'Ohmmeter', 'Ω', ['resistance', 'measure']),
  {
    id: 'wattmeter',
    name: 'Wattmeter',
    category: MEAS,
    keywords: ['power', 'measure'],
    refPrefix: 'W',
    build: () => ({
      prims: [
        L(-3, 0, -1.2, 0),
        L(1.2, 0, 3, 0),
        L(0, -3, 0, -1.2),
        L(0, 1.2, 0, 3),
        C(0, 0, 1.2),
        T(0, 0, 'W', { size: 1.2 }),
      ],
      pins: [
        pin('i+', -3, 0, 'Current in'),
        pin('i-', 3, 0, 'Current out'),
        pin('v+', 0, -3, 'Voltage +'),
        pin('v-', 0, 3, 'Voltage −'),
      ],
    }),
  },
  {
    id: 'current-sensor',
    name: 'Current sensor',
    category: MEAS,
    keywords: ['hall', 'clamp', 'ct', 'current transducer', 'lem'],
    refPrefix: 'CS',
    build: () => ({
      prims: [
        L(-2, 0, 2, 0),
        C(0, 0, 0.9),
        L(0, -0.9, 0, -3),
        ...arrow(-0.45, 0.45, 0.45, -0.45, 0.35),
      ],
      pins: [pin('in', -2, 0, 'In'), pin('out', 2, 0, 'Out'), pin('m', 0, -3, 'Measurement')],
    }),
  },
  {
    id: 'voltage-sensor',
    name: 'Voltage sensor',
    category: MEAS,
    keywords: ['isolated', 'differential probe', 'transducer'],
    refPrefix: 'VS',
    build: () => ({
      prims: [
        L(-3, -1, -1.5, -1),
        L(-3, 1, -1.5, 1),
        L(1.5, 0, 3, 0),
        R(-1.5, -1.5, 3, 3),
        T(0, 0, 'V', { size: 1.2 }),
      ],
      pins: [
        pin('+', -3, -1, 'Positive'),
        pin('-', -3, 1, 'Negative'),
        pin('m', 3, 0, 'Measurement'),
      ],
    }),
  },
  {
    id: 'probe',
    name: 'Oscilloscope probe',
    category: MEAS,
    keywords: ['scope', 'probe', 'measure point'],
    refPrefix: '',
    defaultValue: 'CH1',
    hideValueLabel: true,
    build: () => ({
      prims: [
        L(0, 0, 0.9, -0.9),
        PC([0.9, -0.9, 1.4, -1.9, 1.9, -1.4]),
        L(1.65, -1.65, 2.3, -2.3),
        T(2.5, -2.6, '{value}', { size: 0.9, anchor: 'start' }),
      ],
      pins: [pin('1', 0, 0)],
    }),
  },
  {
    id: 'test-point',
    name: 'Test point',
    category: MEAS,
    keywords: ['tp', 'measure'],
    refPrefix: 'TP',
    build: () => ({
      prims: [L(0, 0, 0, -0.7), C(0, -1, 0.3)],
      pins: [pin('1', 0, 0)],
    }),
  },
];

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

const ANNOT = 'Annotations';

export const annotations: SymbolDef[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    category: ANNOT,
    keywords: ['connection', 'borne', 'node', 'port'],
    refPrefix: '',
    build: () => ({ prims: [C(0, 0, 0.3, { fill: 'paper' })], pins: [pin('1', 0, 0)] }),
  },
  {
    id: 'voltage-arrow',
    name: 'Voltage arrow',
    category: ANNOT,
    kind: 'annotation',
    keywords: ['tension', 'fleche', 'potential difference', 'u', 'v'],
    refPrefix: '',
    defaultValue: 'v',
    hideValueLabel: true,
    options: [
      {
        key: 'shape',
        label: 'Shape',
        type: 'enum',
        default: 'straight',
        choices: [
          { value: 'straight', label: 'Straight' },
          { value: 'curved', label: 'Curved' },
        ],
      },
    ],
    build: ({ opts }) => ({
      prims:
        opts.shape === 'curved'
          ? [A(0, 1.8, 2.6, 225, 312), arrowHead(1.74, -0.13, 42, 0.55), M(0, -1.6, '{value}')]
          : [...arrow(-2, 0, 2, 0, 0.6), M(0, -0.9, '{value}')],
      pins: [],
    }),
  },
  {
    id: 'current-arrow',
    name: 'Current arrow',
    category: ANNOT,
    kind: 'annotation',
    keywords: ['courant', 'i', 'direction'],
    refPrefix: '',
    defaultValue: 'i',
    hideValueLabel: true,
    build: () => ({
      prims: [arrowHead(0.3, 0, 0, 0.7), M(0, -1, '{value}')],
      pins: [],
    }),
  },
  {
    id: 'plus-minus',
    name: 'Polarity marks (+/−)',
    category: ANNOT,
    kind: 'annotation',
    keywords: ['polarity', 'sign', 'ansi voltage'],
    refPrefix: '',
    build: () => ({
      prims: [...plus(0, -1.5, 0.4), ...minus(0, 1.5, 0.4)],
      pins: [],
    }),
  },
  {
    id: 'ac-wave',
    name: 'AC glyph (~)',
    category: ANNOT,
    kind: 'annotation',
    keywords: ['tilde', 'sine', 'alternating'],
    refPrefix: '',
    build: () => ({ prims: [sine(0, 0, 2, 0.9, 1)], pins: [] }),
  },
  {
    id: 'junction',
    name: 'Junction dot (manual)',
    category: ANNOT,
    keywords: ['node', 'dot', 'connection'],
    refPrefix: '',
    build: () => ({ prims: [dot(0, 0, 0.3)], pins: [pin('1', 0, 0)] }),
  },
];
