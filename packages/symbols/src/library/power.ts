import { L, R, T, dot, pin, sine, tf, tfPins, plus, minus } from '../prims';
import type {
  OptionDef,
  PinDef,
  Primitive,
  Standard,
  StrokeOpts,
  SymbolDef,
  SymbolGraphics,
} from '../types';
import { diodeBody, diodeFill, gan, igbt, mosfet } from './semiconductors';

const CAT = 'Power modules';

const switchOpt: OptionDef = {
  key: 'switch',
  label: 'Switch',
  type: 'enum',
  default: 'mosfet',
  choices: [
    { value: 'mosfet', label: 'MOSFET + body diode' },
    { value: 'igbt', label: 'IGBT + diode' },
    { value: 'gan', label: 'GaN HEMT' },
  ],
};

function cell(kind: unknown, fill: StrokeOpts['fill']): SymbolGraphics {
  if (kind === 'igbt') return igbt(false, true, false, fill);
  if (kind === 'gan') return gan(false, false, false, fill);
  return mosfet({
    p: false,
    depletion: false,
    fourTerm: false,
    bodyDiode: true,
    circle: false,
    fill,
  });
}

export interface BridgeOpts {
  kind: unknown;
  fill: StrokeOpts['fill'];
  /** Vertical space between the high-side and low-side switches (grid units, even). */
  gap: number;
  /** Horizontal distance between legs (grid units, even). */
  pitch: number;
}

/**
 * One bridge leg at column x = dx + 1: high-side switch on top, low-side below, the mid-point
 * (switching node) at y = 0.
 */
function leg(o: BridgeOpts, dx: number, n: string): SymbolGraphics {
  const h = o.gap / 2;
  const c = cell(o.kind, o.fill);
  const hi = { prims: tf(c.prims, { dx, dy: -2 - h }), pins: tfPins(c.pins, { dx, dy: -2 - h }) };
  const lo = { prims: tf(c.prims, { dx, dy: 2 + h }), pins: tfPins(c.pins, { dx, dy: 2 + h }) };
  const gHi = hi.pins.find((p) => p.id === 'g')!;
  const gLo = lo.pins.find((p) => p.id === 'g')!;
  const prims = [...hi.prims, ...lo.prims, dot(dx + 1, 0)];
  if (h > 0) prims.push(L(dx + 1, -h, dx + 1, h));
  return {
    prims,
    pins: [
      { id: `g${n}h`, name: `Gate ${n} high`, x: gHi.x, y: gHi.y },
      { id: `g${n}l`, name: `Gate ${n} low`, x: gLo.x, y: gLo.y },
    ],
  };
}

function bridge(o: BridgeOpts, legs: number, outNames: string[]): SymbolGraphics {
  const prims: Primitive[] = [];
  const pins: PinDef[] = [];
  const rail = 4 + o.gap / 2;
  for (let i = 0; i < legs; i++) {
    const dx = i * o.pitch;
    const g = leg(o, dx, String(i + 1));
    prims.push(...g.prims, L(dx + 1, 0, dx + 3, 0));
    pins.push(...g.pins, pin(outNames[i]!, dx + 3, 0, `Output ${outNames[i]}`));
  }
  const xl = 1;
  const xr = 1 + (legs - 1) * o.pitch;
  const midX = Math.round((xl + xr) / 2);
  if (legs > 1) {
    prims.push(L(xl, -rail, xr, -rail), L(xl, rail, xr, rail));
    for (let i = 1; i < legs - 1; i++) {
      prims.push(dot(1 + i * o.pitch, -rail), dot(1 + i * o.pitch, rail));
    }
  }
  prims.push(L(midX, -rail, midX, -rail - 2), L(midX, rail, midX, rail + 2));
  if (legs > 1) prims.push(dot(midX, -rail), dot(midX, rail));
  pins.push(pin('dc+', midX, -rail - 2, 'DC+'), pin('dc-', midX, rail + 2, 'DC−'));
  return { prims, pins };
}

const gapOpt: OptionDef = {
  key: 'gap',
  label: 'Gap high ↔ low side',
  type: 'number',
  default: 4,
  min: 0,
  max: 12,
  step: 2,
};
const pitchOpt: OptionDef = {
  key: 'pitch',
  label: 'Distance between legs',
  type: 'number',
  default: 12,
  min: 8,
  max: 30,
  step: 2,
};

const evenOpt = (v: unknown, def: number, min: number) => {
  const n = Math.round(Number(v ?? def) / 2) * 2;
  return Number.isFinite(n) ? Math.max(min, n) : def;
};

function bridgeOpts(standard: Standard, opts: Record<string, unknown>): BridgeOpts {
  return {
    kind: opts.switch,
    fill: diodeFill(standard, opts.fill),
    gap: evenOpt(opts.gap, 4, 0),
    pitch: evenOpt(opts.pitch, 12, 8),
  };
}

/** Diode placed on the segment (x1,y1) → (x2,y2), conducting from the first to the second point. */
function diodeOn(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fill: StrokeOpts['fill'],
): Primitive[] {
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const s = 0.55;
  const body = tf(diodeBody(fill, 'plain', s), { rot: angle, dx: cx, dy: cy });
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  return [L(x1, y1, cx - ux * s, cy - uy * s), L(cx + ux * s, cy + uy * s, x2, y2), ...body];
}

/** Square converter block with a diagonal, e.g. "~" top-left and "=" bottom-right. */
function converter(
  id: string,
  name: string,
  tl: 'ac' | 'dc',
  br: 'ac' | 'dc',
  keywords: string[],
): SymbolDef {
  const glyph = (kind: 'ac' | 'dc', x: number, y: number): Primitive[] =>
    kind === 'ac'
      ? [sine(x, y, 1.2, 0.6, 1)]
      : [
          L(x - 0.6, y - 0.2, x + 0.6, y - 0.2),
          L(x - 0.6, y + 0.2, x + 0.6, y + 0.2, { dash: 'dashed' }),
        ];
  return {
    id,
    name,
    category: CAT,
    keywords: ['converter', 'block diagram', ...keywords],
    refPrefix: 'U',
    build: () => ({
      prims: [
        L(-4, 0, -2, 0),
        L(2, 0, 4, 0),
        R(-2, -2, 4, 4),
        L(-2, 2, 2, -2),
        ...glyph(tl, -0.9, -0.9),
        ...glyph(br, 0.9, 0.9),
      ],
      pins: [pin('in', -4, 0, 'Input'), pin('out', 4, 0, 'Output')],
    }),
  };
}

const fillOpt: OptionDef = {
  key: 'fill',
  label: 'Diode triangle',
  type: 'enum',
  default: 'auto',
  choices: [
    { value: 'auto', label: 'Standard default' },
    { value: 'filled', label: 'Filled' },
    { value: 'empty', label: 'Empty' },
  ],
};

export const power: SymbolDef[] = [
  {
    id: 'bridge-diode',
    name: 'Diode bridge rectifier',
    category: CAT,
    keywords: ['graetz', 'rectifier', 'full wave', 'pont de diodes'],
    refPrefix: 'BR',
    options: [fillOpt],
    build: ({ standard, opts }) => {
      const fill = diodeFill(standard, opts.fill);
      return {
        prims: [
          ...diodeOn(0, 3, -3, 0, fill),
          ...diodeOn(-3, 0, 0, -3, fill),
          ...diodeOn(0, 3, 3, 0, fill),
          ...diodeOn(3, 0, 0, -3, fill),
          L(-5, 0, -3, 0),
          L(3, 0, 5, 0),
          L(0, -3, 0, -5),
          L(0, 3, 0, 5),
          dot(-3, 0),
          dot(3, 0),
          dot(0, -3),
          dot(0, 3),
          sine(-4.1, -0.7, 0.9, 0.45, 1),
          sine(4.1, -0.7, 0.9, 0.45, 1),
          ...plus(0.8, -4.3),
          ...minus(0.8, 4.3),
        ],
        pins: [
          pin('ac1', -5, 0, 'AC 1'),
          pin('ac2', 5, 0, 'AC 2'),
          pin('+', 0, -5, 'DC+'),
          pin('-', 0, 5, 'DC−'),
        ],
      };
    },
  },
  {
    id: 'half-bridge',
    name: 'Half-bridge leg',
    category: CAT,
    keywords: ['phase leg', 'totem pole', 'buck', 'synchronous'],
    refPrefix: 'Q',
    options: [switchOpt, gapOpt, fillOpt],
    build: ({ standard, opts }) => bridge(bridgeOpts(standard, opts), 1, ['out']),
  },
  {
    id: 'full-bridge',
    name: 'Full bridge (H-bridge)',
    category: CAT,
    keywords: ['h-bridge', 'single phase inverter', 'dab'],
    refPrefix: 'Q',
    options: [switchOpt, gapOpt, pitchOpt, fillOpt],
    build: ({ standard, opts }) => bridge(bridgeOpts(standard, opts), 2, ['a', 'b']),
  },
  {
    id: 'inverter-3ph',
    name: 'Three-phase inverter',
    category: CAT,
    keywords: ['vsi', 'two level', '3 phase', 'motor drive', 'onduleur'],
    refPrefix: 'Q',
    options: [switchOpt, gapOpt, pitchOpt, fillOpt],
    build: ({ standard, opts }) => bridge(bridgeOpts(standard, opts), 3, ['a', 'b', 'c']),
  },
  converter('conv-acdc', 'AC/DC converter (rectifier)', 'ac', 'dc', ['rectifier', 'redresseur']),
  converter('conv-dcdc', 'DC/DC converter', 'dc', 'dc', ['buck', 'boost', 'hacheur', 'chopper']),
  converter('conv-dcac', 'DC/AC converter (inverter)', 'dc', 'ac', ['inverter', 'onduleur']),
  converter('conv-acac', 'AC/AC converter', 'ac', 'ac', ['cycloconverter', 'matrix', 'gradateur']),
  {
    id: 'gate-driver',
    name: 'Gate driver',
    category: CAT,
    keywords: ['driver', 'isolated', 'bootstrap'],
    refPrefix: 'U',
    defaultValue: 'DRV',
    hideValueLabel: true,
    build: () => ({
      prims: [
        L(-4, 0, -2, 0),
        L(2, 0, 4, 0),
        L(2, 1, 4, 1),
        R(-2, -1.5, 4, 3),
        T(0, 0, '{value}', { size: 0.9 }),
      ],
      pins: [pin('in', -4, 0, 'Input'), pin('out', 4, 0, 'Output'), pin('ref', 4, 1, 'Reference')],
    }),
  },
];
