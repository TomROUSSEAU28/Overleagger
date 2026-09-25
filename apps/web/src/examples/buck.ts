import {
  addComponent,
  createBlock,
  makeContext,
  type Project,
  type Trace,
  type TraceKind,
} from '@overleagger/core';

/** A waveform trace with the usual defaults. */
const trace = (id: string, kind: TraceKind, patch: Partial<Trace> = {}): Trace => ({
  id,
  kind,
  amp: 1,
  offset: 0,
  periods: 3,
  phase: 0,
  duty: 0.25,
  tau: 0.15,
  zeta: 0.3,
  ripple: 0.3,
  ...patch,
});

/**
 * A pencil stroke through `pts` ([x, y, …]): the path is resampled and wobbles very slightly,
 * like a hand-drawn line.
 */
function pencilPts(pts: number[], seed = 1): number[] {
  const out: number[] = [];
  for (let i = 2; i < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i - 2]!, pts[i - 1]!, pts[i]!, pts[i + 1]!];
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 6));
    for (let k = i === 2 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const w = Math.sin((out.length / 3 + seed) * 1.7) * 0.6;
      out.push(ax + (bx - ax) * t + w, ay + (by - ay) * t - w, 0.45 + 0.15 * Math.sin(t * Math.PI));
    }
  }
  return out;
}

/**
 * Example project: a synchronous buck converter on the main sheet with its waveforms, design
 * notes and pencil annotations, and its PI voltage controller inside a hierarchical block.
 */
export function seedBuckExample(p: Project) {
  const ctx = makeContext(p);
  const root = p.rootSheetId;
  p.transact(() => {
    p.updateSheet(root, { name: 'Power stage' });
    const wire = (sheet: string, pts: number[], signal = false) =>
      p.addElement(sheet, {
        type: 'wire',
        pts,
        kind: signal ? 'signal' : 'power',
        ...(signal ? { arrow: 'end' as const } : {}),
      });

    p.addElement(root, {
      type: 'text',
      x: -20,
      y: -40,
      text: 'Synchronous buck converter — $V_{out} = D\\,V_{in}$',
      size: 20,
      align: 'start',
    });

    const v1 = addComponent(p, root, 'vsource-dc', 0, 100, ctx);
    p.updateElement(root, v1.id, { params: { value: '$V_{in}$' } });
    const hb = addComponent(p, root, 'half-bridge', 150, 100, ctx);
    p.updateElement(root, hb.id, { ref: 'Q1' });
    const l1 = addComponent(p, root, 'inductor', 240, 100, ctx);
    p.updateElement(root, l1.id, { params: { value: '$L$' } });
    const c1 = addComponent(p, root, 'capacitor', 320, 145, ctx, { rot: 1 });
    p.updateElement(root, c1.id, { params: { value: '$C$' } });
    const r1 = addComponent(p, root, 'resistor', 400, 145, ctx, { rot: 1 });
    p.updateElement(root, r1.id, { params: { value: '$R$' } });
    addComponent(p, root, 'ground', 80, 210, ctx);
    const iL = addComponent(p, root, 'current-arrow', 292, 100, ctx);
    p.updateElement(root, iL.id, { params: { value: 'i_L' } });
    const vo = addComponent(p, root, 'voltage-arrow', 450, 145, ctx, { rot: 1, mirror: true });
    p.updateElement(root, vo.id, { params: { value: 'v_{out}' }, style: { color: '@blue' } });

    wire(root, [0, 70, 0, 20, 160, 20]);
    wire(root, [0, 130, 0, 190, 400, 190]);
    wire(root, [160, 180, 160, 190]);
    wire(root, [80, 190, 80, 210]);
    wire(root, [180, 100, 210, 100]);
    wire(root, [270, 100, 450, 100]);
    wire(root, [320, 125, 320, 100]);
    wire(root, [320, 165, 320, 190]);
    wire(root, [400, 115, 400, 100]);
    wire(root, [400, 175, 400, 190]);
    wire(root, [90, 70, 130, 70]);
    wire(root, [90, 150, 130, 150]);
    p.addElement(root, { type: 'label', x: 90, y: 70, text: '$q_H$' });
    p.addElement(root, { type: 'label', x: 90, y: 150, text: '$q_L$' });
    p.addElement(root, { type: 'label', x: 450, y: 100, text: '$v_{out}$' });

    // Waveforms of the power stage (chronogram), annotated with the pencil.
    p.addElement(root, {
      type: 'waveform',
      x: 560,
      y: -20,
      w: 380,
      h: 320,
      layout: 'stacked',
      xLabel: 't',
      yLabel: '',
      grid: true,
      axes: true,
      traces: [
        trace('qh', 'pwm', { label: 'q_H' }),
        trace('vl', 'square', { amp: 0.8, offset: 0.2, label: 'v_L', color: '@pencil' }),
        trace('il', 'ripple', { label: 'i_L', color: '@blue' }),
        trace('vo', 'sine', { amp: 0.04, offset: 0.96, phase: -60, label: 'v_{out}' }),
      ],
    });
    // ΔiL between the top and the bottom of the current ripple (y 142…168 in the i_L band).
    const red = { style: { color: '@red' } };
    p.addElement(root, { type: 'stroke', size: 2.2, pts: pencilPts([918, 142, 944, 142]), ...red });
    p.addElement(root, {
      type: 'stroke',
      size: 2.2,
      pts: pencilPts([918, 168, 944, 168], 3),
      ...red,
    });
    p.addElement(root, {
      type: 'stroke',
      size: 2.2,
      pts: pencilPts([936, 146, 936, 164], 5),
      ...red,
    });
    p.addElement(root, {
      type: 'text',
      x: 952,
      y: 156,
      text: '$\\Delta i_L$',
      size: 16,
      align: 'start',
      ...red,
    });
    p.addElement(root, {
      type: 'text',
      x: 580,
      y: 340,
      text: '$\\Delta i_L = \\dfrac{(V_{in} - V_{out})\\,D}{L\\,f_s}$',
      size: 18,
      align: 'start',
    });
    p.addElement(root, {
      type: 'stroke',
      size: 2,
      pts: pencilPts([578, 372, 640, 369, 700, 373, 770, 370], 7),
      ...red,
    });
    p.addElement(root, {
      type: 'note',
      x: 790,
      y: 320,
      w: 226,
      h: 118,
      color: '@yellow',
      text: 'Specs\n$V_{in}$ = 48 V → $V_{out}$ = 12 V\n$f_s$ = 100 kHz, D = 0.25\n$\\Delta i_L$ ≤ 30 % of $I_{out}$',
    });
    // Two frames: the slides of the presentation.
    p.addElement(root, { type: 'frame', x: -60, y: -90, w: 560, h: 480, name: 'Power stage' });
    p.addElement(root, { type: 'frame', x: 530, y: -90, w: 490, h: 560, name: 'Waveforms' });

    // Controller block and its sub-sheet.
    const block = createBlock(p, root, { x: 120, y: 260, w: 200, h: 100 }, 'Voltage controller');
    p.updateElement(root, block.id, { tex: 'K_p + \\frac{K_i}{s}' });
    const sub = block.childSheetId;
    p.addElement(sub, {
      type: 'text',
      x: 40,
      y: -110,
      text: 'PI voltage loop with PWM: $C(s) = K_p + \\frac{K_i}{s}$',
      size: 18,
      align: 'start',
    });
    p.addElement(sub, { type: 'port', x: 60, y: 40, name: '$v_{out}$', dir: 'in' });
    p.addElement(sub, { type: 'port', x: 460, y: -40, name: '$q_H$', dir: 'out' });
    p.addElement(sub, { type: 'port', x: 540, y: 20, name: '$q_L$', dir: 'out' });
    const ref = addComponent(p, sub, 'ctl-const', 60, -40, ctx);
    p.updateElement(sub, ref.id, { params: { value: '', tex: 'V_{ref}' } });
    addComponent(p, sub, 'ctl-sum', 140, -40, ctx);
    addComponent(p, sub, 'ctl-pi', 230, -40, ctx);
    addComponent(p, sub, 'ctl-pwm', 340, -40, ctx);
    addComponent(p, sub, 'gate-not', 470, 20, ctx);
    wire(sub, [90, -40, 120, -40], true);
    wire(sub, [60, 40, 140, 40, 140, -20], true);
    wire(sub, [160, -40, 180, -40], true);
    wire(sub, [280, -40, 300, -40], true);
    wire(sub, [380, -40, 460, -40], true);
    wire(sub, [420, -40, 420, 20, 440, 20], true);
    wire(sub, [500, 20, 540, 20], true);
    // Tuning: the closed-loop step response, and the chosen gains.
    p.addElement(sub, {
      type: 'waveform',
      x: 60,
      y: 110,
      w: 360,
      h: 180,
      layout: 'overlay',
      xLabel: 't',
      yLabel: 'v',
      grid: true,
      axes: true,
      traces: [
        trace('ref', 'dc', { amp: 0.8, color: '@pencil', dashed: true }),
        trace('out', 'step2', {
          amp: 0.8,
          tau: 0.06,
          zeta: 0.45,
          label: 'v_{out}',
          color: '@blue',
        }),
      ],
    });
    p.addElement(sub, {
      type: 'text',
      x: 100,
      y: 141,
      text: '$V_{ref}$',
      size: 14,
      align: 'start',
      style: { color: '@pencil' },
    });
    p.addElement(sub, {
      type: 'note',
      x: 450,
      y: 120,
      w: 180,
      h: 100,
      color: '@blue',
      text: 'Tuning\n$K_p$ = 0.05, $K_i$ = 400\novershoot ≈ 20 %',
    });

    // Block pins: v_out on the left (y = 310), q_H / q_L on the right (y = 300 / 320).
    wire(root, [80, 310, 120, 310]);
    wire(root, [320, 300, 360, 300]);
    wire(root, [320, 320, 360, 320]);
    p.addElement(root, { type: 'label', x: 80, y: 310, text: '$v_{out}$' });
    p.addElement(root, { type: 'label', x: 360, y: 300, text: '$q_H$' });
    p.addElement(root, { type: 'label', x: 360, y: 320, text: '$q_L$' });
  });
}
