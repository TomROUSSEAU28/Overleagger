import { C, L, P, PC, T, arrow, arrowHead, dot, pin, tf, tfPins } from '../prims';
import type {
  OptionDef,
  Primitive,
  Standard,
  StrokeOpts,
  SymbolDef,
  SymbolGraphics,
} from '../types';

const DIODES = 'Diodes';
const TRANSISTORS = 'Transistors';
const THYRISTORS = 'Thyristors';

// ---------------------------------------------------------------------------
// Diodes
// ---------------------------------------------------------------------------

const fillOption: OptionDef = {
  key: 'fill',
  label: 'Triangle',
  type: 'enum',
  default: 'auto',
  choices: [
    { value: 'auto', label: 'Standard default' },
    { value: 'filled', label: 'Filled' },
    { value: 'empty', label: 'Empty' },
  ],
};

export function diodeFill(standard: Standard, fill: unknown): StrokeOpts['fill'] {
  if (fill === 'filled') return 'ink';
  if (fill === 'empty') return 'paper';
  return standard === 'ANSI' ? 'ink' : 'paper';
}

type Bar = 'plain' | 'zener' | 'schottky' | 'tvs';

/** Horizontal diode body, anode on the left, triangle between x = -s … s. */
export function diodeBody(fill: StrokeOpts['fill'], bar: Bar = 'plain', s = 0.6): Primitive[] {
  const out: Primitive[] = [PC([-s, -s * 1.15, s, 0, -s, s * 1.15], { fill })];
  const h = s * 1.15;
  switch (bar) {
    case 'plain':
      out.push(L(s, -h, s, h));
      break;
    case 'zener':
      out.push(P([s - 0.3, -h - 0.2, s, -h, s, h, s + 0.3, h + 0.2]));
      break;
    case 'schottky':
      out.push(P([s + 0.3, -h + 0.3, s + 0.3, -h, s, -h, s, h, s - 0.3, h, s - 0.3, h - 0.3]));
      break;
    case 'tvs':
      out.push(P([s - 0.3, -h - 0.2, s, -h, s, h, s + 0.3, h + 0.2]));
      break;
  }
  return out;
}

/** Vertical diode at column x, triangle pointing up (anode at the bottom), centred on y = cy. */
export function diodeUp(x: number, cy: number, fill: StrokeOpts['fill'], s = 0.45): Primitive[] {
  return tf(diodeBody(fill, 'plain', s), { rot: -90, dx: x, dy: cy });
}

const twoPinsAK = (o = 2) => [pin('a', -o, 0, 'Anode'), pin('k', o, 0, 'Cathode')];

function simpleDiode(
  id: string,
  name: string,
  bar: Bar,
  keywords: string[],
  extra: (fill: StrokeOpts['fill']) => Primitive[] = () => [],
): SymbolDef {
  return {
    id,
    name,
    category: DIODES,
    keywords,
    refPrefix: 'D',
    options: [fillOption],
    build: ({ standard, opts }) => {
      const fill = diodeFill(standard, opts.fill);
      return {
        prims: [L(-2, 0, -0.6, 0), L(0.6, 0, 2, 0), ...diodeBody(fill, bar), ...extra(fill)],
        pins: twoPinsAK(),
      };
    },
  };
}

const outArrows = (): Primitive[] => [
  ...arrow(0.1, -1.1, 0.9, -1.9, 0.4),
  ...arrow(0.7, -0.9, 1.5, -1.7, 0.4),
];
const inArrows = (): Primitive[] => [
  ...arrow(0.9, -1.9, 0.15, -1.15, 0.4),
  ...arrow(1.5, -1.7, 0.75, -0.95, 0.4),
];

export const diodes: SymbolDef[] = [
  simpleDiode('diode', 'Diode', 'plain', ['rectifier', 'pn', 'freewheeling']),
  simpleDiode('diode-schottky', 'Schottky diode', 'schottky', ['sic', 'fast', 'freewheeling']),
  simpleDiode('diode-zener', 'Zener diode', 'zener', ['reference', 'regulator']),
  simpleDiode('led', 'LED', 'plain', ['light emitting diode', 'indicator'], () => outArrows()),
  simpleDiode('photodiode', 'Photodiode', 'plain', ['light sensor', 'optical'], () => inArrows()),
  {
    id: 'diode-tvs',
    name: 'TVS diode (bidirectional)',
    category: DIODES,
    keywords: ['transient', 'suppressor', 'surge', 'clamp'],
    refPrefix: 'D',
    options: [fillOption],
    build: ({ standard, opts }) => {
      const fill = diodeFill(standard, opts.fill);
      return {
        prims: [
          L(-2, 0, -1.2, 0),
          L(1.2, 0, 2, 0),
          PC([-1.2, -0.7, 0, 0, -1.2, 0.7], { fill }),
          PC([1.2, -0.7, 0, 0, 1.2, 0.7], { fill }),
          P([-0.3, -0.9, 0, -0.7, 0, 0.7, 0.3, 0.9]),
        ],
        pins: [pin('1', -2, 0), pin('2', 2, 0)],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Transistors
// ---------------------------------------------------------------------------

const circleOpt = (def: boolean): OptionDef => ({
  key: 'circle',
  label: 'Circle (envelope)',
  type: 'bool',
  default: def,
});

const channelOpt: OptionDef = {
  key: 'channel',
  label: 'Channel',
  type: 'enum',
  default: 'n',
  choices: [
    { value: 'n', label: 'N-channel' },
    { value: 'p', label: 'P-channel' },
  ],
};

/** Mirror a graphic vertically (y → -y). */
const flipY = (g: SymbolGraphics): SymbolGraphics => ({
  prims: tf(g.prims, { my: true }),
  pins: tfPins(g.pins, { my: true }),
});

/**
 * Anti-parallel / body diode attached to the vertical rail at x = 1 (between y = -1.6 and 1.6),
 * drawn at column x = 2, pointing up.
 */
function railDiode(fill: StrokeOpts['fill']): Primitive[] {
  return [
    L(1, -1.6, 2, -1.6),
    L(1, 1.6, 2, 1.6),
    L(2, -1.6, 2, -0.45),
    L(2, 0.45, 2, 1.6),
    ...diodeUp(2, 0, fill),
    dot(1, -1.6),
    dot(1, 1.6),
  ];
}

function bjt(pnp: boolean, circle: boolean): SymbolGraphics {
  const yEnd = circle ? 3 : 2;
  const prims: Primitive[] = [
    L(-2, 0, 0, 0),
    L(0, -0.9, 0, 0.9, { sw: 2 }),
    L(0, -0.4, 1, -1),
    L(1, -1, 1, -yEnd),
    L(0, 0.4, 1, 1),
    L(1, 1, 1, yEnd),
  ];
  // Emitter arrow on the lower diagonal: outward for NPN, inward for PNP.
  prims.push(pnp ? arrowHead(0.35, 0.61, 211, 0.55) : arrowHead(0.85, 0.91, 31, 0.55));
  if (circle) prims.push(C(0.35, 0, 1.55));
  const g: SymbolGraphics = {
    prims,
    pins: [pin('b', -2, 0, 'Base'), pin('c', 1, -yEnd, 'Collector'), pin('e', 1, yEnd, 'Emitter')],
  };
  // PNP: mirror vertically so the emitter (with its inward arrow) ends up on top.
  return pnp ? flipY(g) : g;
}

interface FetOpts {
  p: boolean;
  depletion: boolean;
  fourTerm: boolean;
  bodyDiode: boolean;
  circle: boolean;
  fill: StrokeOpts['fill'];
  gan?: boolean;
}

function mosfet(opts: FetOpts): SymbolGraphics {
  // A 4-terminal device exposes its bulk pin instead of drawing the body diode.
  const o = { ...opts, bodyDiode: opts.bodyDiode && !opts.fourTerm };
  const yEnd = o.circle ? 3 : 2;
  const gx = o.circle ? -3 : -2;
  const prims: Primitive[] = [];
  // Gate: plate + lead aligned with the source.
  prims.push(L(-0.3, -1.2, -0.3, 1.2), L(gx, 1, -0.3, 1));
  // Channel
  if (o.depletion || o.gan) prims.push(L(0.2, -1.3, 0.2, 1.3, { sw: 1.5 }));
  else
    prims.push(
      L(0.2, -1.3, 0.2, -0.7, { sw: 1.5 }),
      L(0.2, -0.3, 0.2, 0.3, { sw: 1.5 }),
      L(0.2, 0.7, 0.2, 1.3, { sw: 1.5 }),
    );
  if (o.gan) prims.push(L(0.45, -1.3, 0.45, 1.3, { dash: 'dashed', sw: 0.8 }));
  // Drain and source
  prims.push(L(0.2, -1, 1, -1), L(1, -1, 1, -yEnd), L(0.2, 1, 1, 1), L(1, 1, 1, yEnd));
  // Bulk
  if (!o.gan) {
    const bulkEnd = o.fourTerm ? 2 : 1;
    prims.push(L(0.2, 0, bulkEnd, 0));
    if (!o.fourTerm) prims.push(L(1, 0, 1, 1));
    // N-channel: arrow towards the channel; P-channel: away from it.
    prims.push(o.p ? arrowHead(0.95, 0, 0, 0.5) : arrowHead(0.25, 0, 180, 0.5));
  }
  const pins = [
    pin('g', gx, 1, 'Gate'),
    pin('d', 1, -yEnd, 'Drain'),
    pin('s', 1, yEnd, 'Source'),
    ...(o.fourTerm && !o.gan ? [pin('b', 2, 0, 'Bulk')] : []),
  ];
  let g: SymbolGraphics = { prims, pins };
  // P-channel: source on top (mirror vertically), the body diode keeps pointing up.
  if (o.p) g = flipY(g);
  if (o.bodyDiode) g.prims.push(...railDiode(o.fill));
  if (o.circle) g.prims.push(C(o.bodyDiode ? 0.9 : 0.5, 0, o.bodyDiode ? 2.05 : 1.8));
  return g;
}

function igbt(
  p: boolean,
  diode: boolean,
  circle: boolean,
  fill: StrokeOpts['fill'],
): SymbolGraphics {
  const yEnd = circle ? 3 : 2;
  const gx = circle ? -3 : -2;
  const prims: Primitive[] = [
    L(-0.3, -1.2, -0.3, 1.2),
    L(gx, 1, -0.3, 1),
    L(0.2, -1.2, 0.2, 1.2, { sw: 1.8 }),
    L(0.2, -0.6, 1, -1.2),
    L(1, -1.2, 1, -yEnd),
    L(0.2, 0.6, 1, 1.2),
    L(1, 1.2, 1, yEnd),
    p ? arrowHead(0.4, 0.75, 217, 0.5) : arrowHead(0.9, 1.125, 37, 0.5),
  ];
  let g: SymbolGraphics = {
    prims,
    pins: [pin('g', gx, 1, 'Gate'), pin('c', 1, -yEnd, 'Collector'), pin('e', 1, yEnd, 'Emitter')],
  };
  if (p) g = flipY(g);
  if (diode) g.prims.push(...railDiode(fill));
  if (circle) g.prims.push(C(diode ? 0.9 : 0.5, 0, diode ? 2.05 : 1.8));
  return g;
}

function jfet(p: boolean, circle: boolean): SymbolGraphics {
  const yEnd = circle ? 3 : 2;
  const gx = circle ? -3 : -2;
  const prims: Primitive[] = [
    L(0, -1.3, 0, 1.3, { sw: 1.8 }),
    L(0, -1, 1, -1),
    L(1, -1, 1, -yEnd),
    L(0, 1, 1, 1),
    L(1, 1, 1, yEnd),
    L(gx, 1, 0, 1),
    p ? arrowHead(-1.1, 1, 180, 0.5) : arrowHead(-0.05, 1, 0, 0.5),
  ];
  if (circle) prims.push(C(0.4, 0, 1.8));
  return {
    prims,
    pins: [pin('g', gx, 1, 'Gate'), pin('d', 1, -yEnd, 'Drain'), pin('s', 1, yEnd, 'Source')],
  };
}

export const transistors: SymbolDef[] = [
  {
    id: 'bjt',
    name: 'Bipolar transistor (BJT)',
    category: TRANSISTORS,
    keywords: ['npn', 'pnp', 'bipolar', 'transistor'],
    refPrefix: 'Q',
    options: [
      {
        key: 'type',
        label: 'Type',
        type: 'enum',
        default: 'npn',
        choices: [
          { value: 'npn', label: 'NPN' },
          { value: 'pnp', label: 'PNP' },
        ],
      },
      circleOpt(true),
    ],
    build: ({ opts }) => bjt(opts.type === 'pnp', Boolean(opts.circle)),
  },
  {
    id: 'mosfet',
    name: 'MOSFET',
    category: TRANSISTORS,
    keywords: [
      'nmos',
      'pmos',
      'fet',
      'sic',
      'power switch',
      'depletion',
      'enhancement',
      'body diode',
    ],
    refPrefix: 'Q',
    options: [
      channelOpt,
      {
        key: 'mode',
        label: 'Mode',
        type: 'enum',
        default: 'enh',
        choices: [
          { value: 'enh', label: 'Enhancement' },
          { value: 'dep', label: 'Depletion' },
        ],
      },
      {
        key: 'terminals',
        label: 'Terminals',
        type: 'enum',
        default: '3',
        choices: [
          { value: '3', label: '3 (bulk tied to source)' },
          { value: '4', label: '4 (bulk pin)' },
        ],
      },
      { key: 'bodyDiode', label: 'Body diode', type: 'bool', default: true },
      circleOpt(false),
      fillOption,
    ],
    build: ({ standard, opts }) =>
      mosfet({
        p: opts.channel === 'p',
        depletion: opts.mode === 'dep',
        fourTerm: opts.terminals === '4',
        bodyDiode: Boolean(opts.bodyDiode),
        circle: Boolean(opts.circle),
        fill: diodeFill(standard, opts.fill),
      }),
  },
  {
    id: 'igbt',
    name: 'IGBT',
    category: TRANSISTORS,
    keywords: ['insulated gate', 'power switch', 'antiparallel diode', 'freewheeling'],
    refPrefix: 'Q',
    options: [
      channelOpt,
      { key: 'diode', label: 'Anti-parallel diode', type: 'bool', default: true },
      circleOpt(false),
      fillOption,
    ],
    build: ({ standard, opts }) =>
      igbt(
        opts.channel === 'p',
        Boolean(opts.diode),
        Boolean(opts.circle),
        diodeFill(standard, opts.fill),
      ),
  },
  {
    id: 'jfet',
    name: 'JFET',
    category: TRANSISTORS,
    keywords: ['junction fet', 'njfet', 'pjfet'],
    refPrefix: 'Q',
    options: [channelOpt, circleOpt(false)],
    build: ({ opts }) => jfet(opts.channel === 'p', Boolean(opts.circle)),
  },
  {
    id: 'gan-hemt',
    name: 'GaN HEMT',
    category: TRANSISTORS,
    keywords: ['gan', 'hemt', 'wide bandgap', 'power switch'],
    refPrefix: 'Q',
    options: [circleOpt(false)],
    build: ({ opts }) =>
      mosfet({
        p: false,
        depletion: false,
        fourTerm: false,
        bodyDiode: false,
        circle: Boolean(opts.circle),
        fill: 'ink',
        gan: true,
      }),
  },
];

// ---------------------------------------------------------------------------
// Thyristors
// ---------------------------------------------------------------------------

function thyristorBase(fill: StrokeOpts['fill']): Primitive[] {
  return [L(-2, 0, -0.6, 0), L(0.6, 0, 2, 0), ...diodeBody(fill), P([0.6, 0.45, 1, 1, 1, 2])];
}

const gatePin = () => pin('g', 1, 2, 'Gate');

/** Two anti-parallel triangles between two bars (DIAC/TRIAC body). */
function bidirBody(fill: StrokeOpts['fill']): Primitive[] {
  return [
    L(-2, 0, -0.6, 0),
    L(0.6, 0, 2, 0),
    L(-0.6, -1.1, -0.6, 1.1),
    L(0.6, -1.1, 0.6, 1.1),
    PC([-0.6, -1.05, -0.6, -0.05, 0.6, -0.55], { fill }),
    PC([0.6, 0.05, 0.6, 1.05, -0.6, 0.55], { fill }),
  ];
}

export const thyristors: SymbolDef[] = [
  {
    id: 'thyristor',
    name: 'Thyristor (SCR)',
    category: THYRISTORS,
    keywords: ['scr', 'silicon controlled rectifier', 'phase control'],
    refPrefix: 'TH',
    options: [fillOption],
    build: ({ standard, opts }) => ({
      prims: thyristorBase(diodeFill(standard, opts.fill)),
      pins: [...twoPinsAK(), gatePin()],
    }),
  },
  {
    id: 'gto',
    name: 'GTO thyristor',
    category: THYRISTORS,
    keywords: ['gate turn-off', 'gto'],
    refPrefix: 'TH',
    options: [fillOption],
    build: ({ standard, opts }) => ({
      prims: [
        ...thyristorBase(diodeFill(standard, opts.fill)),
        L(0.55, 1.35, 1.45, 1.35),
        L(0.55, 1.65, 1.45, 1.65),
      ],
      pins: [...twoPinsAK(), gatePin()],
    }),
  },
  {
    id: 'igct',
    name: 'IGCT',
    category: THYRISTORS,
    keywords: ['integrated gate commutated thyristor'],
    refPrefix: 'TH',
    options: [fillOption],
    build: ({ standard, opts }) => ({
      prims: [
        ...thyristorBase(diodeFill(standard, opts.fill)),
        L(0.55, 1.35, 1.45, 1.35),
        L(0.55, 1.65, 1.45, 1.65),
        T(-1.3, 1.5, 'IGCT', { size: 0.7 }),
      ],
      pins: [...twoPinsAK(), gatePin()],
    }),
  },
  {
    id: 'triac',
    name: 'TRIAC',
    category: THYRISTORS,
    keywords: ['ac switch', 'dimmer', 'bidirectional'],
    refPrefix: 'TR',
    options: [fillOption],
    build: ({ standard, opts }) => ({
      prims: [...bidirBody(diodeFill(standard, opts.fill)), P([-0.6, 0.9, -1, 1.4, -1, 2])],
      pins: [pin('mt1', -2, 0, 'MT1'), pin('mt2', 2, 0, 'MT2'), pin('g', -1, 2, 'Gate')],
    }),
  },
  {
    id: 'diac',
    name: 'DIAC',
    category: THYRISTORS,
    keywords: ['trigger', 'bidirectional'],
    refPrefix: 'D',
    options: [fillOption],
    build: ({ standard, opts }) => ({
      prims: bidirBody(diodeFill(standard, opts.fill)),
      pins: [pin('1', -2, 0), pin('2', 2, 0)],
    }),
  },
];

export { mosfet, igbt };
