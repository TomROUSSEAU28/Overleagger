import { C, L, P, PC, T, M, arrow, pin, sine } from '../prims';
import type { Primitive, SymbolDef } from '../types';

const CAT = 'Sources';
const R0 = 1.2;

/** Vertical leads for a round source body of radius r, pins at (0,±3). */
const vLeads = (r = R0): Primitive[] => [L(0, -3, 0, -r), L(0, r, 0, 3)];
const vPins = () => [pin('+', 0, -3, 'Positive'), pin('-', 0, 3, 'Negative')];

const plusMinus = (dy = 0.55): Primitive[] => [
  T(0, -dy, '+', { size: 1.1 }),
  T(0, dy + 0.05, '−', { size: 1.1 }),
];

const diamond = (r = 1.35): Primitive => PC([0, -r, r, 0, 0, r, -r, 0]);

export const sources: SymbolDef[] = [
  {
    id: 'vsource-dc',
    name: 'Voltage source (DC)',
    category: CAT,
    keywords: ['dc', 'supply', 'voltage', 'emf'],
    refPrefix: 'V',
    build: ({ standard }) => ({
      prims: [
        ...vLeads(),
        C(0, 0, R0),
        ...(standard === 'ANSI' ? plusMinus() : [L(0, -R0, 0, R0)]),
      ],
      pins: vPins(),
    }),
  },
  {
    id: 'vsource-ac',
    name: 'Voltage source (AC)',
    category: CAT,
    keywords: ['ac', 'sine', 'grid', 'mains', 'alternating'],
    refPrefix: 'V',
    build: () => ({
      prims: [...vLeads(), C(0, 0, R0), sine(0, 0, 1.5, 0.9, 1)],
      pins: vPins(),
    }),
  },
  {
    id: 'vsource-pulse',
    name: 'Voltage source (pulse)',
    category: CAT,
    keywords: ['square', 'pwm', 'clock', 'pulse'],
    refPrefix: 'V',
    build: () => ({
      prims: [
        ...vLeads(),
        C(0, 0, R0),
        P([-0.75, 0.4, -0.35, 0.4, -0.35, -0.4, 0.2, -0.4, 0.2, 0.4, 0.75, 0.4]),
      ],
      pins: vPins(),
    }),
  },
  {
    id: 'isource-dc',
    name: 'Current source',
    category: CAT,
    keywords: ['dc', 'current'],
    refPrefix: 'I',
    build: ({ standard }) => ({
      prims: [
        ...vLeads(),
        C(0, 0, R0),
        ...(standard === 'ANSI' ? arrow(0, 0.75, 0, -0.75, 0.45) : [L(-R0, 0, R0, 0)]),
      ],
      pins: vPins(),
    }),
  },
  {
    id: 'vsource-controlled',
    name: 'Controlled voltage source',
    category: CAT,
    keywords: ['vcvs', 'ccvs', 'dependent', 'diamond'],
    refPrefix: 'E',
    build: ({ standard }) => ({
      prims: [
        L(0, -3, 0, -1.35),
        L(0, 1.35, 0, 3),
        diamond(),
        ...(standard === 'ANSI' ? plusMinus(0.5) : [L(0, -1.35, 0, 1.35)]),
      ],
      pins: vPins(),
    }),
  },
  {
    id: 'isource-controlled',
    name: 'Controlled current source',
    category: CAT,
    keywords: ['vccs', 'cccs', 'dependent', 'diamond'],
    refPrefix: 'G',
    build: ({ standard }) => ({
      prims: [
        L(0, -3, 0, -1.35),
        L(0, 1.35, 0, 3),
        diamond(),
        ...(standard === 'ANSI' ? arrow(0, 0.75, 0, -0.75, 0.45) : [L(-1.35, 0, 1.35, 0)]),
      ],
      pins: vPins(),
    }),
  },
  {
    id: 'battery',
    name: 'Battery',
    category: CAT,
    keywords: ['cell', 'accumulator', 'dc'],
    refPrefix: 'B',
    options: [
      {
        key: 'cells',
        label: 'Cells',
        type: 'enum',
        default: '2',
        choices: [
          { value: '1', label: 'Single cell' },
          { value: '2', label: 'Two cells' },
        ],
      },
    ],
    build: ({ opts }) => {
      const two = opts.cells === '2';
      const prims: Primitive[] = two
        ? [
            L(0, -3, 0, -0.9),
            L(-1, -0.9, 1, -0.9),
            L(-0.5, -0.4, 0.5, -0.4, { sw: 2.2 }),
            L(-1, 0.4, 1, 0.4),
            L(-0.5, 0.9, 0.5, 0.9, { sw: 2.2 }),
            L(0, 0.9, 0, 3),
            L(0, -0.4, 0, 0.4, { dash: 'dotted', sw: 0.8 }),
          ]
        : [
            L(0, -3, 0, -0.3),
            L(-1, -0.3, 1, -0.3),
            L(-0.5, 0.3, 0.5, 0.3, { sw: 2.2 }),
            L(0, 0.3, 0, 3),
          ];
      prims.push(T(1.2, -1.3, '+', { size: 1 }));
      return { prims, pins: vPins() };
    },
  },
  {
    id: 'source-3ph',
    name: 'Three-phase source',
    category: CAT,
    keywords: ['3 phase', 'grid', 'mains', 'abc', 'three phase'],
    refPrefix: 'V',
    build: () => ({
      prims: [
        C(0, 0, 2.2),
        L(Math.sqrt(2.2 * 2.2 - 4), -2, 3, -2),
        L(2.2, 0, 3, 0),
        L(Math.sqrt(2.2 * 2.2 - 4), 2, 3, 2),
        sine(-0.2, -0.35, 1.8, 0.9, 1),
        M(-0.2, 1.05, '3\\sim', 1.1),
      ],
      pins: [pin('a', 3, -2, 'Phase a'), pin('b', 3, 0, 'Phase b'), pin('c', 3, 2, 'Phase c')],
    }),
  },
  {
    id: 'ground',
    name: 'Ground',
    category: CAT,
    keywords: ['gnd', '0v', 'earth', 'masse', 'reference'],
    refPrefix: '',
    build: () => ({
      prims: [L(0, 0, 0, 1), L(-1, 1, 1, 1), L(-0.65, 1.4, 0.65, 1.4), L(-0.3, 1.8, 0.3, 1.8)],
      pins: [pin('1', 0, 0)],
    }),
  },
  {
    id: 'ground-signal',
    name: 'Signal ground',
    category: CAT,
    keywords: ['gnd', 'agnd', 'reference'],
    refPrefix: '',
    build: () => ({
      prims: [L(0, 0, 0, 1), PC([-1, 1, 1, 1, 0, 2])],
      pins: [pin('1', 0, 0)],
    }),
  },
  {
    id: 'ground-chassis',
    name: 'Chassis / frame ground',
    category: CAT,
    keywords: ['chassis', 'frame', 'pe', 'protective earth'],
    refPrefix: '',
    build: () => ({
      prims: [
        L(0, 0, 0, 1),
        L(-1, 1, 1, 1),
        L(-1, 1, -1.5, 1.7),
        L(0, 1, -0.5, 1.7),
        L(1, 1, 0.5, 1.7),
      ],
      pins: [pin('1', 0, 0)],
    }),
  },
  {
    id: 'rail-up',
    name: 'Supply rail (VDD)',
    category: CAT,
    keywords: ['vcc', 'vdd', 'supply', 'rail', 'power'],
    refPrefix: '',
    defaultValue: 'V_{DD}',
    hideValueLabel: true,
    build: () => ({
      prims: [L(0, 0, 0, -1), L(-1, -1, 1, -1), M(0, -2, '{value}')],
      pins: [pin('1', 0, 0)],
    }),
  },
  {
    id: 'rail-down',
    name: 'Supply rail (VSS)',
    category: CAT,
    keywords: ['vee', 'vss', 'negative', 'rail'],
    refPrefix: '',
    defaultValue: 'V_{SS}',
    hideValueLabel: true,
    build: () => ({
      prims: [L(0, 0, 0, 1), L(-1, 1, 1, 1), M(0, 2, '{value}')],
      pins: [pin('1', 0, 0)],
    }),
  },
  {
    id: 'solar-cell',
    name: 'Photovoltaic cell',
    category: CAT,
    keywords: ['pv', 'solar', 'panel'],
    refPrefix: 'PV',
    build: () => ({
      prims: [
        L(0, -3, 0, -0.3),
        L(-1, -0.3, 1, -0.3),
        L(-0.5, 0.3, 0.5, 0.3, { sw: 2.2 }),
        L(0, 0.3, 0, 3),
        ...arrow(-2.6, -2.2, -1.3, -0.9, 0.45),
        ...arrow(-2.6, -1.2, -1.3, 0.1, 0.45),
      ],
      pins: vPins(),
    }),
  },
];
