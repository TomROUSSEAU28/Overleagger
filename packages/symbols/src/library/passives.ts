import { A, L, P, PC, R, T, arrow, dot, pin, sine, plus } from '../prims';
import type { Primitive, SymbolDef } from '../types';

const CAT = 'Passives';

/** Leads for a horizontal two-terminal part between ±outer, leaving a gap of ±inner. */
export const leads = (outer: number, inner: number): Primitive[] => [
  L(-outer, 0, -inner, 0),
  L(inner, 0, outer, 0),
];

export const twoPins = (outer: number) => [pin('1', -outer, 0), pin('2', outer, 0)];

export function resistorBody(ansi: boolean): Primitive[] {
  if (!ansi) return [R(-1.5, -0.5, 3, 1)];
  const pts = [-1.5, 0];
  const n = 6;
  for (let i = 0; i < n; i++) pts.push(-1.25 + i * 0.5, i % 2 === 0 ? -0.55 : 0.55);
  pts.push(1.5, 0);
  return [P(pts)];
}

const adjustArrow = (): Primitive[] => arrow(-1.6, 1.2, 1.7, -1.3, 0.5);

export function inductorBody(style: string, n = 4): Primitive[] {
  if (style === 'block') return [R(-n / 2, -0.45, n, 0.9, { fill: 'ink' })];
  const out: Primitive[] = [];
  for (let i = 0; i < n; i++) out.push(A(-n / 2 + 0.5 + i, 0, 0.5, 180, 360));
  return out;
}

function coreLines(core: string, x0: number, x1: number, y: number, vertical = false): Primitive[] {
  if (core === 'none') return [];
  const o = core === 'ferrite' ? { dash: 'dashed' as const } : {};
  if (vertical) return [L(y - 0.15, x0, y - 0.15, x1, o), L(y + 0.15, x0, y + 0.15, x1, o)];
  return [L(x0, y - 0.15, x1, y - 0.15, o), L(x0, y + 0.15, x1, y + 0.15, o)];
}

const coreOption = {
  key: 'core',
  label: 'Core',
  type: 'enum' as const,
  default: 'none',
  choices: [
    { value: 'none', label: 'Air' },
    { value: 'iron', label: 'Iron (solid)' },
    { value: 'ferrite', label: 'Ferrite (dashed)' },
  ],
};

/** Vertical coil of `n` bumps centred on (x, 0), bulging to the right (dir 1) or left (dir -1). */
function vCoil(x: number, yTop: number, n: number, r: number, dir: 1 | -1): Primitive[] {
  const out: Primitive[] = [];
  for (let i = 0; i < n; i++) {
    const cy = yTop + r + i * 2 * r;
    out.push(dir === 1 ? A(x, cy, r, -90, 90) : A(x, cy, r, 90, 270));
  }
  return out;
}

export const passives: SymbolDef[] = [
  {
    id: 'resistor',
    name: 'Resistor',
    category: CAT,
    keywords: ['resistance', 'ohm', 'load'],
    refPrefix: 'R',
    build: ({ standard }) => ({
      prims: [...leads(3, 1.5), ...resistorBody(standard === 'ANSI')],
      pins: twoPins(3),
    }),
  },
  {
    id: 'resistor-variable',
    name: 'Variable resistor',
    category: CAT,
    keywords: ['rheostat', 'adjustable'],
    refPrefix: 'R',
    build: ({ standard }) => ({
      prims: [...leads(3, 1.5), ...resistorBody(standard === 'ANSI'), ...adjustArrow()],
      pins: twoPins(3),
    }),
  },
  {
    id: 'potentiometer',
    name: 'Potentiometer',
    category: CAT,
    keywords: ['pot', 'wiper', 'trimmer'],
    refPrefix: 'RV',
    build: ({ standard }) => ({
      prims: [...leads(3, 1.5), ...resistorBody(standard === 'ANSI'), ...arrow(0, 2, 0, 0.6, 0.5)],
      pins: [...twoPins(3), pin('w', 0, 2, 'Wiper')],
    }),
  },
  {
    id: 'thermistor',
    name: 'Thermistor (NTC/PTC)',
    category: CAT,
    keywords: ['ntc', 'ptc', 'temperature'],
    refPrefix: 'TH',
    build: ({ standard }) => ({
      prims: [
        ...leads(3, 1.5),
        ...resistorBody(standard === 'ANSI'),
        P([-2, 1.3, -1.3, 1.3, 1.4, -1.3]),
        T(1.9, -1.3, 'θ', { size: 1, italic: true }),
      ],
      pins: twoPins(3),
    }),
  },
  {
    id: 'varistor',
    name: 'Varistor (MOV)',
    category: CAT,
    keywords: ['mov', 'surge', 'vdr'],
    refPrefix: 'RV',
    build: ({ standard }) => ({
      prims: [
        ...leads(3, 1.5),
        ...resistorBody(standard === 'ANSI'),
        P([-2, 1.3, -1.3, 1.3, 1.4, -1.3]),
        T(1.9, -1.3, 'U', { size: 1 }),
      ],
      pins: twoPins(3),
    }),
  },
  {
    id: 'capacitor',
    name: 'Capacitor',
    category: CAT,
    keywords: ['cap', 'condensateur'],
    refPrefix: 'C',
    build: () => ({
      prims: [...leads(2, 0.3), L(-0.3, -1, -0.3, 1, { sw: 1.4 }), L(0.3, -1, 0.3, 1, { sw: 1.4 })],
      pins: twoPins(2),
    }),
  },
  {
    id: 'capacitor-polarized',
    name: 'Polarized capacitor',
    category: CAT,
    keywords: ['electrolytic', 'polarised', 'chemical'],
    refPrefix: 'C',
    build: ({ standard }) => {
      const prims: Primitive[] =
        standard === 'ANSI'
          ? [
              L(-2, 0, -0.3, 0),
              L(-0.3, -1, -0.3, 1, { sw: 1.4 }),
              A(2.1, 0, 1.8, 146, 214, { sw: 1.4 }),
              L(0.3, 0, 2, 0),
            ]
          : [
              L(-2, 0, -0.55, 0),
              R(-0.55, -1, 0.3, 2),
              L(0.3, -1, 0.3, 1, { sw: 1.4 }),
              L(0.3, 0, 2, 0),
            ];
      prims.push(...plus(-1.2, -1.15));
      return { prims, pins: [pin('+', -2, 0, 'Positive'), pin('-', 2, 0, 'Negative')] };
    },
  },
  {
    id: 'capacitor-variable',
    name: 'Variable capacitor',
    category: CAT,
    keywords: ['trimmer', 'varicap'],
    refPrefix: 'C',
    build: () => ({
      prims: [
        ...leads(2, 0.3),
        L(-0.3, -1, -0.3, 1, { sw: 1.4 }),
        L(0.3, -1, 0.3, 1, { sw: 1.4 }),
        ...arrow(-1.3, 1.2, 1.4, -1.3, 0.5),
      ],
      pins: twoPins(2),
    }),
  },
  {
    id: 'inductor',
    name: 'Inductor',
    category: CAT,
    keywords: ['coil', 'choke', 'self', 'bobine'],
    refPrefix: 'L',
    options: [
      coreOption,
      {
        key: 'style',
        label: 'Style',
        type: 'enum',
        default: 'loops',
        choices: [
          { value: 'loops', label: 'Loops' },
          { value: 'block', label: 'Filled block (old IEC)' },
        ],
      },
    ],
    build: ({ opts }) => ({
      prims: [
        ...leads(3, 2),
        ...inductorBody(String(opts.style)),
        ...coreLines(String(opts.core), -2, 2, -0.9),
      ],
      pins: twoPins(3),
    }),
  },
  {
    id: 'transformer',
    name: 'Transformer',
    category: CAT,
    keywords: ['coupled inductors', 'transfo', 'isolation', 'magnetic'],
    refPrefix: 'T',
    options: [
      { ...coreOption, default: 'iron' },
      { key: 'dots', label: 'Dot convention', type: 'bool', default: true },
    ],
    build: ({ opts }) => {
      const prims: Primitive[] = [
        P([-3, -2, -1, -2, -1, -1.5]),
        P([-3, 2, -1, 2, -1, 1.5]),
        P([3, -2, 1, -2, 1, -1.5]),
        P([3, 2, 1, 2, 1, 1.5]),
        ...vCoil(-1, -1.5, 4, 0.375, 1),
        ...vCoil(1, -1.5, 4, 0.375, -1),
        ...coreLines(String(opts.core), -1.6, 1.6, 0, true),
      ];
      if (opts.dots) prims.push(dot(-1.7, -1.2, 0.18), dot(1.7, -1.2, 0.18));
      return {
        prims,
        pins: [pin('p1', -3, -2), pin('p2', -3, 2), pin('s1', 3, -2), pin('s2', 3, 2)],
      };
    },
  },
  {
    id: 'transformer-ct',
    name: 'Transformer, center tap',
    category: CAT,
    keywords: ['centre tap', 'push-pull', 'magnetic'],
    refPrefix: 'T',
    options: [
      { ...coreOption, default: 'iron' },
      { key: 'dots', label: 'Dot convention', type: 'bool', default: true },
    ],
    build: ({ opts }) => {
      const prims: Primitive[] = [
        P([-3, -2, -1, -2, -1, -1.5]),
        P([-3, 2, -1, 2, -1, 1.5]),
        P([3, -2, 1, -2, 1, -1.5]),
        P([3, 2, 1, 2, 1, 1.5]),
        L(1, 0, 3, 0),
        ...vCoil(-1, -1.5, 4, 0.375, 1),
        ...vCoil(1, -1.5, 4, 0.375, -1),
        ...coreLines(String(opts.core), -1.6, 1.6, 0, true),
      ];
      if (opts.dots) prims.push(dot(-1.7, -1.2, 0.18), dot(1.7, -1.2, 0.18));
      return {
        prims,
        pins: [
          pin('p1', -3, -2),
          pin('p2', -3, 2),
          pin('s1', 3, -2),
          pin('ct', 3, 0, 'Center tap'),
          pin('s2', 3, 2),
        ],
      };
    },
  },
  {
    id: 'transformer-3w',
    name: 'Transformer, 3 windings',
    category: CAT,
    keywords: ['three winding', 'flyback', 'forward', 'magnetic'],
    refPrefix: 'T',
    options: [
      { ...coreOption, default: 'iron' },
      { key: 'dots', label: 'Dot convention', type: 'bool', default: true },
    ],
    build: ({ opts }) => {
      const prims: Primitive[] = [
        P([-3, -2, -1, -2, -1, -1.5]),
        P([-3, 2, -1, 2, -1, 1.5]),
        ...vCoil(-1, -1.5, 4, 0.375, 1),
        P([3, -4, 1, -4, 1, -3.2]),
        P([3, -1, 1, -1, 1, -0.8]),
        ...vCoil(1, -3.2, 3, 0.4, -1),
        P([3, 1, 1, 1, 1, 0.8]),
        P([3, 4, 1, 4, 1, 3.2]),
        ...vCoil(1, 0.8, 3, 0.4, -1),
        ...coreLines(String(opts.core), -3.4, 3.4, 0, true),
      ];
      if (opts.dots) prims.push(dot(-1.7, -1.2, 0.18), dot(1.7, -2.9, 0.18), dot(1.7, 1.1, 0.18));
      return {
        prims,
        pins: [
          pin('p1', -3, -2),
          pin('p2', -3, 2),
          pin('s1', 3, -4),
          pin('s2', 3, -1),
          pin('t1', 3, 1),
          pin('t2', 3, 4),
        ],
      };
    },
  },
  {
    id: 'transformer-1line',
    name: 'Transformer (single-line)',
    category: CAT,
    keywords: ['iec', 'power system', 'circles', 'one-line'],
    refPrefix: 'T',
    build: () => ({
      prims: [
        L(-3, 0, -1.9, 0),
        L(1.9, 0, 3, 0),
        { k: 'circle', cx: -0.6, cy: 0, r: 1.3 },
        { k: 'circle', cx: 0.6, cy: 0, r: 1.3 },
      ],
      pins: twoPins(3),
    }),
  },
  {
    id: 'fuse',
    name: 'Fuse',
    category: CAT,
    keywords: ['protection'],
    refPrefix: 'F',
    build: ({ standard }) => ({
      prims:
        standard === 'ANSI'
          ? [...leads(2, 1.2), sine(0, 0, 2.4, 1.2, 1)]
          : [L(-2, 0, 2, 0), R(-1.2, -0.45, 2.4, 0.9)],
      pins: twoPins(2),
    }),
  },
  {
    id: 'crystal',
    name: 'Crystal (quartz)',
    category: CAT,
    keywords: ['xtal', 'oscillator', 'quartz'],
    refPrefix: 'Y',
    build: () => ({
      prims: [
        ...leads(2, 0.8),
        L(-0.8, -1, -0.8, 1, { sw: 1.3 }),
        L(0.8, -1, 0.8, 1, { sw: 1.3 }),
        R(-0.45, -1.2, 0.9, 2.4),
      ],
      pins: twoPins(2),
    }),
  },
  {
    id: 'lamp',
    name: 'Lamp',
    category: CAT,
    keywords: ['bulb', 'light', 'indicator'],
    refPrefix: 'LP',
    build: () => ({
      prims: [
        ...leads(2, 1),
        { k: 'circle', cx: 0, cy: 0, r: 1 },
        L(-0.7, -0.7, 0.7, 0.7),
        L(-0.7, 0.7, 0.7, -0.7),
      ],
      pins: twoPins(2),
    }),
  },
  {
    id: 'antenna',
    name: 'Antenna',
    category: CAT,
    keywords: ['aerial', 'rf'],
    refPrefix: 'AE',
    build: () => ({
      prims: [L(0, 2, 0, -1.4), PC([-1.2, -2.4, 1.2, -2.4, 0, -0.6])],
      pins: [pin('1', 0, 2)],
    }),
  },
];
