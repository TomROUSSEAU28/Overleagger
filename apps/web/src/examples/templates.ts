import {
  Project,
  addComponent,
  copyElements,
  elementPins,
  makeContext,
  type ClipData,
  type ComponentElement,
  type Id,
  type Pt,
  type Rot,
  type SheetContext,
} from '@overleagger/core';
import type { OptionValue } from '@overleagger/symbols';

/** Small helper to draw a circuit in code with exact pin-to-pin wiring. */
class Builder {
  readonly ctx: SheetContext;
  constructor(
    readonly p: Project,
    readonly sheet: Id,
  ) {
    this.ctx = makeContext(p);
  }

  part(
    symbolId: string,
    x: number,
    y: number,
    o: {
      rot?: Rot;
      mirror?: boolean;
      value?: string;
      opts?: Record<string, OptionValue>;
      params?: Record<string, string>;
    } = {},
  ): ComponentElement {
    const el = addComponent(this.p, this.sheet, symbolId, x, y, this.ctx, {
      ...(o.rot ? { rot: o.rot } : {}),
      ...(o.mirror ? { mirror: o.mirror } : {}),
      ...(o.opts ? { opts: o.opts } : {}),
    });
    const params = {
      ...el.params,
      ...(o.value !== undefined ? { value: o.value } : {}),
      ...o.params,
    };
    this.p.updateElement(this.sheet, el.id, { params });
    return this.p.getElement(this.sheet, el.id) as ComponentElement;
  }

  pin(el: ComponentElement, id: string): Pt {
    const p = elementPins(el, this.ctx).find((x) => x.pinId === id);
    if (!p) throw new Error(`No pin ${id} on ${el.symbolId}`);
    return { x: p.x, y: p.y };
  }

  wire(...pts: number[]) {
    this.p.addElement(this.sheet, { type: 'wire', pts, kind: 'power' });
  }

  signal(...pts: number[]) {
    this.p.addElement(this.sheet, { type: 'wire', pts, kind: 'signal', arrow: 'end' });
  }

  label(x: number, y: number, text: string) {
    this.p.addElement(this.sheet, { type: 'label', x, y, text });
  }

  text(x: number, y: number, text: string, size = 14) {
    this.p.addElement(this.sheet, { type: 'text', x, y, text, size, align: 'start' });
  }
}

export interface Template {
  id: string;
  name: string;
  category: 'Power electronics' | 'Control' | 'Analog';
  description: string;
  build: (b: Builder) => void;
}

export const TEMPLATES: Template[] = [
  {
    id: 'buck',
    name: 'Buck converter',
    category: 'Power electronics',
    description: 'Step-down DC/DC: switch, freewheeling diode, LC filter, load',
    build: (b) => {
      b.part('vsource-dc', 0, 100, { value: '$V_{in}$' });
      b.part('mosfet', 100, 50, { rot: 3 });
      b.part('diode', 160, 100, { rot: 3 });
      b.part('inductor', 230, 40, { value: '$L$' });
      b.part('capacitor', 300, 100, { rot: 1, value: '$C$' });
      b.part('resistor', 340, 100, { rot: 1, value: '$R$' });
      b.part('ground', 80, 180);
      b.wire(0, 70, 0, 40, 80, 40);
      b.wire(120, 40, 200, 40);
      b.wire(160, 80, 160, 40);
      b.wire(260, 40, 340, 40, 340, 70);
      b.wire(300, 80, 300, 40);
      b.wire(0, 130, 0, 160, 340, 160, 340, 130);
      b.wire(160, 120, 160, 160);
      b.wire(300, 120, 300, 160);
      b.wire(80, 160, 80, 180);
      b.wire(110, 70, 110, 90);
      b.label(110, 90, '$q$');
    },
  },
  {
    id: 'boost',
    name: 'Boost converter',
    category: 'Power electronics',
    description: 'Step-up DC/DC: inductor, low-side switch, diode, output capacitor',
    build: (b) => {
      b.part('vsource-dc', 0, 100, { value: '$V_{in}$' });
      b.part('inductor', 60, 40, { value: '$L$' });
      b.part('mosfet', 110, 100);
      b.part('diode', 170, 40);
      b.part('capacitor', 240, 100, { rot: 1, value: '$C$' });
      b.part('resistor', 300, 100, { rot: 1, value: '$R$' });
      b.part('ground', 60, 180);
      b.wire(0, 70, 0, 40, 30, 40);
      b.wire(90, 40, 150, 40);
      b.wire(120, 80, 120, 40);
      b.wire(190, 40, 300, 40, 300, 70);
      b.wire(240, 80, 240, 40);
      b.wire(0, 130, 0, 160, 300, 160, 300, 130);
      b.wire(120, 120, 120, 160);
      b.wire(240, 120, 240, 160);
      b.wire(60, 160, 60, 180);
      b.wire(90, 110, 70, 110);
      b.label(70, 110, '$q$');
    },
  },
  {
    id: 'buck-boost',
    name: 'Buck-boost converter (inverting)',
    category: 'Power electronics',
    description: 'Inverting DC/DC: high-side switch, inductor to ground, reversed diode',
    build: (b) => {
      b.part('vsource-dc', 0, 100, { value: '$V_{in}$' });
      b.part('mosfet', 100, 50, { rot: 3 });
      b.part('inductor', 160, 100, { rot: 1, value: '$L$' });
      b.part('diode', 220, 40, { rot: 2 });
      b.part('capacitor', 280, 100, { rot: 1, value: '$C$' });
      b.part('resistor', 320, 100, { rot: 1, value: '$R$' });
      b.part('ground', 60, 180);
      b.wire(0, 70, 0, 40, 80, 40);
      b.wire(120, 40, 200, 40);
      b.wire(160, 70, 160, 40);
      b.wire(240, 40, 320, 40, 320, 70);
      b.wire(280, 80, 280, 40);
      b.wire(0, 130, 0, 160, 320, 160, 320, 130);
      b.wire(160, 130, 160, 160);
      b.wire(280, 120, 280, 160);
      b.wire(60, 160, 60, 180);
      b.wire(110, 70, 110, 90);
      b.label(110, 90, '$q$');
    },
  },
  {
    id: 'flyback',
    name: 'Flyback converter',
    category: 'Power electronics',
    description: 'Isolated DC/DC with coupled inductor, low-side switch and output diode',
    build: (b) => {
      b.part('vsource-dc', 0, 100, { value: '$V_{in}$' });
      b.part('transformer', 120, 100, { opts: { core: 'ferrite' } });
      b.part('mosfet', 80, 160);
      b.part('diode', 190, 80);
      b.part('capacitor', 250, 110, { rot: 1, value: '$C$' });
      b.part('resistor', 290, 110, { rot: 1, value: '$R$' });
      b.part('ground', 40, 220);
      b.part('ground-signal', 200, 180);
      b.wire(0, 70, 0, 50, 90, 50, 90, 80);
      b.wire(90, 120, 90, 140);
      b.wire(0, 130, 0, 200, 90, 200, 90, 180);
      b.wire(40, 200, 40, 220);
      b.wire(150, 80, 170, 80);
      b.wire(210, 80, 290, 80);
      b.wire(250, 90, 250, 80);
      b.wire(150, 120, 150, 160, 290, 160, 290, 140);
      b.wire(250, 130, 250, 160);
      b.wire(200, 160, 200, 180);
      b.wire(60, 170, 40, 170);
      b.label(40, 170, '$q$');
    },
  },
  {
    id: 'h-bridge-inverter',
    name: 'Single-phase inverter (H-bridge)',
    category: 'Power electronics',
    description: 'Full bridge fed by a DC link, RL load between the two legs',
    build: (b) => {
      b.part('vsource-dc', 20, 100, { value: '$V_{dc}$' });
      b.part('full-bridge', 100, 100);
      b.part('inductor', 340, 60, { value: '$L$' });
      b.part('resistor', 400, 100, { rot: 1, value: '$R$' });
      b.wire(20, 70, 20, 20, 170, 20);
      b.wire(20, 130, 20, 200, 170, 200, 170, 180);
      b.wire(130, 100, 150, 100);
      b.wire(250, 100, 270, 100);
      b.label(150, 100, '$a$');
      b.label(270, 100, '$b$');
      b.wire(300, 60, 310, 60);
      b.wire(370, 60, 400, 60, 400, 70);
      b.wire(400, 130, 400, 140, 300, 140);
      b.label(300, 60, '$a$');
      b.label(300, 140, '$b$');
    },
  },
  {
    id: 'inverter-motor',
    name: 'Three-phase inverter + motor',
    category: 'Power electronics',
    description: 'Two-level VSI on a DC link driving a three-phase machine',
    build: (b) => {
      b.part('vsource-dc', 20, 100, { value: '$V_{dc}$' });
      b.part('inverter-3ph', 100, 100);
      b.part('motor-3ph', 540, 160);
      b.wire(20, 70, 20, 20, 230, 20);
      b.wire(20, 130, 20, 200, 230, 200, 230, 180);
      b.wire(130, 100, 150, 100);
      b.wire(250, 100, 270, 100);
      b.wire(370, 100, 390, 100);
      b.label(150, 100, '$a$');
      b.label(270, 100, '$b$');
      b.label(390, 100, '$c$');
      b.wire(520, 120, 520, 80);
      b.wire(540, 120, 540, 60);
      b.wire(560, 120, 560, 40);
      b.label(520, 80, '$a$');
      b.label(540, 60, '$b$');
      b.label(560, 40, '$c$');
    },
  },
  {
    id: 'rectifier',
    name: 'Diode bridge rectifier + filter',
    category: 'Power electronics',
    description: 'Single-phase full-wave rectifier with a capacitor filter and a load',
    build: (b) => {
      b.part('vsource-ac', 40, 130, { value: '$v_s$' });
      b.part('bridge-diode', 120, 100);
      b.part('capacitor', 250, 110, { rot: 1, value: '$C$' });
      b.part('resistor', 300, 110, { rot: 1, value: '$R$' });
      b.wire(40, 100, 70, 100);
      b.wire(40, 160, 40, 220, 190, 220, 190, 100, 170, 100);
      b.wire(120, 50, 120, 30, 300, 30, 300, 80);
      b.wire(250, 90, 250, 30);
      b.wire(120, 150, 120, 190, 300, 190, 300, 140);
      b.wire(250, 130, 250, 190);
    },
  },
  {
    id: 'rectifier-3ph',
    name: 'Three-phase rectifier + DC link',
    category: 'Power electronics',
    description: 'Six-pulse diode bridge fed by the grid, DC-link capacitor and load',
    build: (b) => {
      b.part('source-3ph', 0, 100);
      b.part('bridge-diode-3ph', 100, 100);
      b.part('capacitor', 260, 100, { rot: 1, value: '$C$' });
      b.part('resistor', 310, 100, { rot: 1, value: '$R$' });
      b.wire(30, 80, 60, 80, 60, 100, 90, 100);
      b.wire(30, 100, 50, 100, 50, 210, 140, 210, 140, 100);
      b.wire(30, 120, 40, 120, 40, 230, 190, 230, 190, 100);
      b.wire(160, 30, 310, 30, 310, 70);
      b.wire(260, 80, 260, 30);
      b.wire(160, 170, 160, 190, 310, 190, 310, 130);
      b.wire(260, 120, 260, 190);
    },
  },
  {
    id: 'pi-loop',
    name: 'PI control loop',
    category: 'Control',
    description: 'Reference, error, PI controller, plant and unity feedback',
    build: (b) => {
      b.part('ctl-const', 0, 0, { params: { tex: 'r' } });
      b.part('ctl-sum', 80, 0);
      b.part('ctl-pi', 170, 0);
      b.part('ctl-block', 290, 0);
      b.signal(30, 0, 60, 0);
      b.signal(100, 0, 120, 0);
      b.signal(220, 0, 250, 0);
      b.signal(330, 0, 420, 0);
      b.signal(380, 0, 380, 60, 80, 60, 80, 20);
      b.text(104, -14, '$\\varepsilon$');
      b.text(400, -14, '$y$');
    },
  },
  {
    id: 'cascade-loop',
    name: 'Cascaded current + voltage loops',
    category: 'Control',
    description: 'Outer voltage PI, inner current PI, LC plant (typical converter control)',
    build: (b) => {
      b.part('ctl-const', 0, 0, { params: { tex: 'v^*' } });
      b.part('ctl-sum', 80, 0);
      b.part('ctl-pi', 170, 0, { params: { tex: 'C_v(s)' } });
      b.part('ctl-sum', 270, 0);
      b.part('ctl-pi', 360, 0, { params: { tex: 'C_i(s)' } });
      b.part('ctl-tf', 480, 0, { params: { tex: '\\frac{1}{L s}' } });
      b.part('ctl-tf', 600, 0, { params: { tex: '\\frac{1}{C s}' } });
      b.signal(30, 0, 60, 0);
      b.signal(100, 0, 120, 0);
      b.signal(220, 0, 250, 0);
      b.signal(290, 0, 310, 0);
      b.signal(410, 0, 440, 0);
      b.signal(520, 0, 560, 0);
      b.signal(640, 0, 720, 0);
      b.signal(540, 0, 540, 50, 270, 50, 270, 20);
      b.signal(680, 0, 680, 90, 80, 90, 80, 20);
      b.text(226, -14, '$i^*$');
      b.text(544, -14, '$i_L$');
      b.text(690, -14, '$v_C$');
    },
  },
  {
    id: 'rc-filter',
    name: 'RC low-pass filter',
    category: 'Analog',
    description: 'First-order filter, cut-off $f_c = 1/(2\\pi RC)$',
    build: (b) => {
      b.part('vsource-ac', 0, 100, { value: '$v_{in}$' });
      b.part('resistor', 60, 40, { value: '$R$' });
      b.part('capacitor', 130, 100, { rot: 1, value: '$C$' });
      b.part('terminal', 170, 40);
      b.part('terminal', 170, 160);
      b.part('ground', 60, 180);
      b.wire(0, 70, 0, 40, 30, 40);
      b.wire(90, 40, 170, 40);
      b.wire(130, 80, 130, 40);
      b.wire(0, 130, 0, 160, 170, 160);
      b.wire(130, 120, 130, 160);
      b.wire(60, 160, 60, 180);
      b.text(180, 104, '$v_{out}$');
    },
  },
  {
    id: 'inverting-amp',
    name: 'Inverting amplifier',
    category: 'Analog',
    description: 'Op-amp with input and feedback resistors, gain $-R_f/R_1$',
    build: (b) => {
      b.part('opamp', 200, 100);
      b.part('resistor', 110, 90, { value: '$R_1$' });
      b.part('resistor', 200, 40, { value: '$R_f$' });
      b.part('ground', 160, 130);
      b.part('terminal', 50, 90);
      b.part('terminal', 300, 100);
      b.wire(50, 90, 80, 90);
      b.wire(140, 90, 170, 90);
      b.wire(150, 90, 150, 40, 170, 40);
      b.wire(230, 40, 260, 40, 260, 100);
      b.wire(230, 100, 300, 100);
      b.wire(170, 110, 160, 110, 160, 130);
      b.text(20, 70, '$v_{in}$');
      b.text(290, 80, '$v_{out}$');
    },
  },
];

/** Build a template in a scratch project and return it as clipboard data. */
export function templateClip(t: Template): ClipData {
  const p = Project.create(t.name);
  const b = new Builder(p, p.rootSheetId);
  p.transact(() => t.build(b));
  return copyElements(
    p,
    p.rootSheetId,
    p.getElements(p.rootSheetId).map((e) => e.id),
  );
}

/** Build a template in a project sheet (tests). */
export function buildTemplate(t: Template, p: Project, sheet: Id) {
  p.transact(() => t.build(new Builder(p, sheet)));
}
