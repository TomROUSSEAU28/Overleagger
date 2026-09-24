import { addComponent, createBlock, makeContext, type Project } from '@overleagger/core';

/**
 * Example project: a synchronous buck converter on the main sheet, and its PI voltage
 * controller inside a hierarchical block.
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

    // Block pins: v_out on the left (y = 310), q_H / q_L on the right (y = 300 / 320).
    wire(root, [80, 310, 120, 310]);
    wire(root, [320, 300, 360, 300]);
    wire(root, [320, 320, 360, 320]);
    p.addElement(root, { type: 'label', x: 80, y: 310, text: '$v_{out}$' });
    p.addElement(root, { type: 'label', x: 360, y: 300, text: '$q_H$' });
    p.addElement(root, { type: 'label', x: 360, y: 320, text: '$q_L$' });
  });
}
