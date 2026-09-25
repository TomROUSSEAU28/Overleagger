import { A, L, P, PC, R, T, arrow, dot, pin, sine, plus } from '../prims';
import type {
  OptionDef,
  OptionValue,
  PinDef,
  Primitive,
  SymbolDef,
  SymbolGraphics,
} from '../types';

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

// ---------------------------------------------------------------------------
// Transformers: one primary on the left, 1 to 4 secondaries stacked on the right.
// Each winding is plain or center-tapped, with its polarity dot at the top, bottom or none.
// ---------------------------------------------------------------------------

const COIL_R = 0.375;
const SEC_PITCH = 6;
const MAX_SECONDARIES = 4;
/** Pin ids per winding: primary, then secondaries (s1/s2/ct keep the ids of the old symbols). */
const WINDING_IDS = [
  { a: 'p1', b: 'p2', ct: 'pct' },
  { a: 's1', b: 's2', ct: 'ct' },
  { a: 't1', b: 't2', ct: 'tct' },
  { a: 'u1', b: 'u2', ct: 'uct' },
  { a: 'v1', b: 'v2', ct: 'vct' },
];

interface WindingSpec {
  /** -1 = primary (left), 1 = secondary (right). */
  side: -1 | 1;
  /** Centre of the coil (integer grid units). */
  c: number;
  /** Number of half-turns (even, so a center tap falls between two of them). */
  arcs: number;
  ct: boolean;
  dot: string;
  ids: { a: string; b: string; ct: string };
  name: string;
}

function windingGraphics(w: WindingSpec): SymbolGraphics {
  const x = w.side;
  const px = 3 * w.side;
  const half = w.arcs * COIL_R;
  const top = w.c - half;
  const bot = w.c + half;
  const ya = Math.floor(top - 0.5);
  const yb = Math.ceil(bot + 0.5);
  const prims: Primitive[] = [
    P([px, ya, x, ya, x, top]),
    P([px, yb, x, yb, x, bot]),
    ...vCoil(x, top, w.arcs, COIL_R, w.side === -1 ? 1 : -1),
  ];
  const pins = [pin(w.ids.a, px, ya, `${w.name} (1)`), pin(w.ids.b, px, yb, `${w.name} (2)`)];
  if (w.ct) {
    prims.push(L(x, w.c, px, w.c));
    pins.splice(1, 0, pin(w.ids.ct, px, w.c, `${w.name} center tap`));
  }
  if (w.dot === 'top') prims.push(dot(1.7 * w.side, top + 0.3, 0.18));
  if (w.dot === 'bottom') prims.push(dot(1.7 * w.side, bot - 0.3, 0.18));
  return { prims, pins };
}

const windingOptions = (key: string, label: string, show?: OptionDef['show']): OptionDef[] => [
  {
    key,
    label,
    type: 'enum',
    default: 'normal',
    choices: [
      { value: 'normal', label: 'Plain' },
      { value: 'ct', label: 'Center tap' },
    ],
    row: key,
    ...(show ? { show } : {}),
  },
  {
    key: `${key}Dot`,
    label: 'Polarity dot',
    type: 'enum',
    default: 'top',
    choices: [
      { value: 'top', label: 'Top' },
      { value: 'bottom', label: 'Bottom (inverted)' },
      { value: 'none', label: 'None' },
    ],
    row: key,
    ...(show ? { show } : {}),
  },
];

function transformerDef(
  id: string,
  name: string,
  keywords: string[],
  defaults: Record<string, OptionValue>,
): SymbolDef {
  const options: OptionDef[] = [
    { ...coreOption, default: 'iron' },
    {
      key: 'secondaries',
      label: 'Secondary windings',
      type: 'number',
      default: 1,
      min: 1,
      max: MAX_SECONDARIES,
      step: 1,
    },
    ...windingOptions('p', 'Primary'),
  ];
  for (let i = 1; i <= MAX_SECONDARIES; i++)
    options.push(
      ...windingOptions(
        `s${i}`,
        `Secondary ${i}`,
        i > 1 ? (o) => Number(o.secondaries) >= i : undefined,
      ),
    );
  return {
    id,
    name,
    category: CAT,
    keywords,
    refPrefix: 'T',
    options: options.map((o) =>
      o.key in defaults ? ({ ...o, default: defaults[o.key] } as OptionDef) : o,
    ),
    build: ({ opts }) => {
      const n = Math.max(1, Math.min(MAX_SECONDARIES, Math.round(Number(opts.secondaries) || 1)));
      // Projects made before the polarity choice had a single "dots" switch.
      const dotOf = (k: string) =>
        opts.dots === false ? 'none' : String(opts[`${k}Dot`] ?? 'top');
      const specs: WindingSpec[] = [
        {
          side: -1,
          c: 0,
          // The primary spans the whole stack of secondaries.
          arcs: 8 * (n - 1) + 4,
          ct: opts.p === 'ct',
          dot: dotOf('p'),
          ids: WINDING_IDS[0]!,
          name: 'Primary',
        },
      ];
      for (let i = 1; i <= n; i++)
        specs.push({
          side: 1,
          c: (i - 1 - (n - 1) / 2) * SEC_PITCH,
          arcs: 4,
          ct: opts[`s${i}`] === 'ct',
          dot: dotOf(`s${i}`),
          ids: WINDING_IDS[i]!,
          name: n > 1 ? `Secondary ${i}` : 'Secondary',
        });
      const prims: Primitive[] = [];
      const pins: PinDef[] = [];
      for (const w of specs) {
        const g = windingGraphics(w);
        prims.push(...g.prims);
        pins.push(...g.pins);
      }
      const extent = specs[0]!.arcs * COIL_R;
      prims.push(...coreLines(String(opts.core), -extent - 0.1, extent + 0.1, 0, true));
      return { prims, pins };
    },
  };
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
  transformerDef(
    'transformer',
    'Transformer',
    ['coupled inductors', 'transfo', 'isolation', 'magnetic', 'secondary', 'flyback', 'forward'],
    {},
  ),
  transformerDef(
    'transformer-ct',
    'Transformer, center tap',
    ['centre tap', 'push-pull', 'magnetic', 'secondary'],
    { s1: 'ct' },
  ),
  // One winding on its own: place the primary and the secondaries apart in the schematic
  // (e.g. on each side of an isolation barrier); the same designator (T1…) ties them together.
  {
    id: 'transformer-winding',
    name: 'Transformer winding (separate)',
    category: CAT,
    keywords: [
      'winding',
      'separate windings',
      'split transformer',
      'coupled',
      'primary',
      'secondary',
      'auxiliary',
      'flyback',
      'enroulement',
    ],
    refPrefix: 'T',
    options: [
      { ...coreOption, default: 'iron' },
      {
        key: 'coreSide',
        label: 'Core side',
        type: 'enum',
        default: 'right',
        choices: [
          { value: 'right', label: 'Right' },
          { value: 'left', label: 'Left' },
        ],
      },
      {
        key: 'turns',
        label: 'Length',
        type: 'enum',
        default: '4',
        choices: [
          { value: '4', label: 'Short' },
          { value: '6', label: 'Medium' },
          { value: '8', label: 'Long' },
        ],
      },
      ...windingOptions('w', 'Winding'),
    ],
    build: ({ opts }) => {
      const side = opts.coreSide === 'left' ? -1 : 1;
      const arcs = [4, 6, 8].includes(Number(opts.turns)) ? Number(opts.turns) : 4;
      const half = arcs * COIL_R;
      const end = Math.ceil(half + 0.5);
      const prims: Primitive[] = [
        L(0, -end, 0, -half),
        L(0, half, 0, end),
        ...vCoil(0, -half, arcs, COIL_R, side),
        ...coreLines(String(opts.core), -half - 0.1, half + 0.1, side, true),
      ];
      const pins: PinDef[] = [pin('1', 0, -end, 'Start'), pin('2', 0, end, 'End')];
      if (opts.w === 'ct') {
        prims.push(L(0, 0, -2 * side, 0));
        pins.splice(1, 0, pin('ct', -2 * side, 0, 'Center tap'));
      }
      // The polarity dot sits on the outer side of the coil, away from the core.
      const dotY = opts.wDot === 'bottom' ? half - 0.3 : -half + 0.3;
      if (opts.wDot !== 'none') prims.push(dot(-0.7 * side, dotY, 0.18));
      return { prims, pins };
    },
  },
  // Old three-winding model: same drawing as a transformer with two secondaries.
  {
    ...transformerDef('transformer-3w', 'Transformer, 3 windings', [], { secondaries: 2 }),
    hidden: true,
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
