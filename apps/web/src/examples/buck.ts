import {
  addComponent,
  anchorPoints,
  createBlock,
  makeContext,
  type Anchor,
  type Anim,
  type Element,
  type FlowElement,
  type FrameElement,
  type Project,
  type ShapeElement,
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

/** Presentation animations, with fresh ids. */
let animN = 0;
const anim = (a: Omit<Anim, 'id'>): Anim => ({ id: `ex${++animN}`, ...a });

/** Where a shape's connection point is (for the connectors of the design flowchart). */
function anchorOf(el: Element, a: Anchor): [number, number] {
  const pt = anchorPoints(el)![a];
  return [pt.x, pt.y];
}

/**
 * Example project: a synchronous buck converter, laid out as a presentation that shows what the
 * app can do. The main sheet holds five slides (frames): an overview, a zoom on the power stage
 * (the switching phases as animated currents, a load step), a closer zoom on the output filter,
 * the waveforms with pencil notes, and the design steps as a flowchart. The PI voltage
 * controller lives inside a hierarchical block (its own sheet, the last slide).
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

    // ---------------------------------------------------------------------------------------
    // Slide 1, the overview: the whole sheet; the title rises, the subtitle is typed.
    p.addElement(root, {
      type: 'text',
      x: -40,
      y: -175,
      text: 'Synchronous buck converter · 48 V → 12 V · 100 kHz',
      size: 28,
      align: 'start',
      anims: [anim({ kind: 'appear', step: 0, effect: 'rise', dur: 700 })],
    });
    p.addElement(root, {
      type: 'text',
      x: -40,
      y: -140,
      text: 'A tour of the design: switching, output filter, waveforms, design steps and controller.',
      size: 15,
      align: 'start',
      style: { color: '@pencil' },
      anims: [anim({ kind: 'text', step: 0, effect: 'typewriter', delay: 600, dur: 1600 })],
    });

    // ---------------------------------------------------------------------------------------
    // Slide 2, the power stage (a zoom on the overview): how the current flows, click by click.
    p.addElement(root, {
      type: 'text',
      x: -20,
      y: -40,
      text: 'Power stage — $V_{out} = D\\,V_{in}$',
      size: 20,
      align: 'start',
    });

    const v1 = addComponent(p, root, 'vsource-dc', 0, 100, ctx);
    p.updateElement(root, v1.id, { params: { value: '$V_{in}$' } });
    const hb = addComponent(p, root, 'half-bridge', 150, 100, ctx);
    p.updateElement(root, hb.id, { ref: 'Q1' });
    const l1 = addComponent(p, root, 'inductor', 240, 100, ctx);
    // Click 1: the inductor lights up as the current builds up in it.
    p.updateElement(root, l1.id, {
      params: { value: '$L$' },
      anims: [anim({ kind: 'emphasis', step: 1, effect: 'flash', color: '@orange', dur: 900 })],
    });
    const c1 = addComponent(p, root, 'capacitor', 320, 145, ctx, { rot: 1 });
    p.updateElement(root, c1.id, { params: { value: '$C$' } });
    const r1 = addComponent(p, root, 'resistor', 400, 145, ctx, { rot: 1 });
    p.updateElement(root, r1.id, { params: { value: '$R$' } });
    addComponent(p, root, 'ground', 80, 210, ctx);
    const iL = addComponent(p, root, 'current-arrow', 292, 100, ctx);
    // Click 3: the inductor current, named.
    p.updateElement(root, iL.id, {
      params: { value: 'i_L' },
      anims: [anim({ kind: 'appear', step: 3, effect: 'flash', color: '@orange', delay: 150 })],
    });
    // Click 4: a load step — S1 closes and connects a second load.
    const s1 = addComponent(p, root, 'switch', 510, 100, ctx);
    p.updateElement(root, s1.id, {
      ref: 'S1',
      anims: [anim({ kind: 'set', step: 4, opts: { state: 'on' } })],
    });
    const r2 = addComponent(p, root, 'resistor', 580, 145, ctx, { rot: 1 });
    p.updateElement(root, r2.id, {
      params: { value: '$R$' },
      anims: [anim({ kind: 'emphasis', step: 4, effect: 'flash', delay: 250, dur: 900 })],
    });

    wire(root, [0, 70, 0, 20, 160, 20]);
    wire(root, [0, 130, 0, 190, 400, 190]);
    wire(root, [160, 180, 160, 190]);
    wire(root, [80, 190, 80, 210]);
    wire(root, [180, 100, 210, 100]);
    const out = wire(root, [270, 100, 490, 100]);
    wire(root, [320, 125, 320, 100]);
    wire(root, [320, 165, 320, 190]);
    wire(root, [400, 115, 400, 100]);
    wire(root, [400, 175, 400, 190]);
    wire(root, [530, 100, 580, 100, 580, 115]);
    wire(root, [580, 175, 580, 190]);
    wire(root, [400, 190, 580, 190]);
    wire(root, [90, 70, 130, 70]);
    wire(root, [90, 150, 130, 150]);
    p.addElement(root, { type: 'label', x: 90, y: 70, text: '$q_H$' });
    p.addElement(root, { type: 'label', x: 90, y: 150, text: '$q_L$' });
    p.addElement(root, { type: 'label', x: 450, y: 100, text: '$v_{out}$' });

    // The switching phases as animated currents (left out of the exports).
    const flow = (patch: Partial<FlowElement>, anims: Anim[]) =>
      p.addElement(root, {
        type: 'flow',
        pts: [],
        closed: true,
        current: 1,
        signal: 'dc',
        symbol: 'comet',
        speed: 55,
        noExport: true,
        ...patch,
        anims,
      } as Omit<FlowElement, 'id' | 'z'>);
    // Click 1: Q_H conducts, the source drives the current through L into the load…
    flow(
      { pts: [0, 20, 160, 20, 160, 100, 400, 100, 400, 190, 0, 190], style: { color: '@orange' } },
      [
        anim({ kind: 'appear', step: 1, effect: 'fade', delay: 200 }),
        anim({ kind: 'disappear', step: 2, effect: 'fade' }),
      ],
    );
    // …click 2: Q_H opens, L keeps the current going through Q_L (freewheeling)…
    flow({ pts: [160, 100, 400, 100, 400, 190, 160, 190], style: { color: '@violet' } }, [
      anim({ kind: 'appear', step: 2, effect: 'fade', delay: 200 }),
      anim({ kind: 'disappear', step: 3, effect: 'fade' }),
    ]);
    // …click 3: both at 100 kHz, too fast to see: i_L ripples around the load current…
    flow(
      {
        pts: [180, 100, 400, 100, 400, 190, 160, 190, 160, 100],
        symbol: 'dot',
        current: 0.45,
        offset: 1,
        signal: 'triangle',
        period: 1.6,
        style: { color: '@blue' },
      },
      [
        anim({ kind: 'appear', step: 3, effect: 'fade', delay: 200 }),
        // …click 4: the load step, the current goes up.
        anim({ kind: 'wave', step: 4, key: 'offset', from: 1, to: 1.6, dur: 900, delay: 300 }),
      ],
    );
    // What happens, in words (typed, then replaced at each click).
    p.addElement(root, {
      type: 'text',
      x: -20,
      y: 400,
      text: '1. $Q_H$ on: $v_L = V_{in} - V_{out} > 0$, $i_L$ rises',
      size: 16,
      align: 'start',
      anims: [
        anim({ kind: 'text', step: 1, effect: 'typewriter', dur: 900 }),
        anim({
          kind: 'text',
          step: 2,
          text: '2. $Q_L$ on (freewheeling): $v_L = -V_{out} < 0$, $i_L$ falls',
        }),
        anim({ kind: 'text', step: 3, text: '3. At 100 kHz: $i_L$ ripples around $I_{out}$' }),
        anim({ kind: 'text', step: 4, text: '4. Load step: S1 closes, $I_{out}$ goes up' }),
        anim({ kind: 'text', step: 5, text: '5. The controller keeps $v_{out}$ at 12 V' }),
      ],
    });

    // ---------------------------------------------------------------------------------------
    // Slide 3, the output filter (a zoom inside the power stage).
    // Click 1: the capacitor takes the AC part of i_L — its current goes back and forth.
    p.addElement(root, {
      type: 'flow',
      pts: [320, 100, 320, 190],
      current: 0.6,
      signal: 'sine',
      period: 1.6,
      symbol: 'arrow',
      spacing: 22,
      speed: 45,
      noExport: true,
      style: { color: '@green' },
      anims: [anim({ kind: 'appear', step: 1, effect: 'fade' })],
    });
    const vo = addComponent(p, root, 'voltage-arrow', 450, 145, ctx, { rot: 1, mirror: true });
    // Click 2: the output voltage, and the output node turns blue like it.
    p.updateElement(root, vo.id, {
      params: { value: 'v_{out}' },
      style: { color: '@blue' },
      anims: [anim({ kind: 'appear', step: 2, effect: 'wipe', delay: 300 })],
    });
    p.updateElement(root, out.id, { anims: [anim({ kind: 'color', step: 2, color: '@blue' })] });
    p.addElement(root, {
      type: 'text',
      x: 310,
      y: 222,
      text: '$\\Delta v_{out} = \\dfrac{\\Delta i_L}{8\\,C\\,f_s}$',
      size: 15,
      align: 'start',
      anims: [anim({ kind: 'appear', step: 2, effect: 'rise', delay: 500 })],
    });

    // ---------------------------------------------------------------------------------------
    // Slide 4, the waveforms (chronogram), annotated with the pencil.
    const W = 120;
    p.addElement(root, {
      type: 'waveform',
      x: 560 + W,
      y: -20,
      w: 380,
      h: 320,
      layout: 'stacked',
      xLabel: 't',
      yLabel: '',
      grid: true,
      axes: true,
      // Click 4: the duty cycle moves, and the chronogram follows it.
      anims: (['qh', 'vl', 'il'] as const).map((t) =>
        anim({
          kind: 'wave',
          step: 4,
          trace: t,
          key: 'duty',
          from: 0.25,
          to: 0.5,
          loop: true,
          dur: 1800,
        }),
      ),
      traces: [
        trace('qh', 'pwm', { label: 'q_H' }),
        trace('vl', 'square', { amp: 0.8, offset: 0.2, label: 'v_L', color: '@pencil' }),
        trace('il', 'ripple', { label: 'i_L', color: '@blue' }),
        trace('vo', 'sine', { amp: 0.04, offset: 0.96, phase: -60, label: 'v_{out}' }),
      ],
    });
    // ΔiL between the top and the bottom of the current ripple (y 142…168 in the i_L band).
    const red = { style: { color: '@red' } };
    // Click 1: the pencil marks are drawn one after the other, then ΔiL pops in.
    const drawn = (delay: number) => [anim({ kind: 'appear', step: 1, effect: 'wipe', delay })];
    p.addElement(root, {
      type: 'stroke',
      size: 2.2,
      pts: pencilPts([918 + W, 142, 944 + W, 142]),
      ...red,
      anims: drawn(0),
    });
    p.addElement(root, {
      type: 'stroke',
      size: 2.2,
      pts: pencilPts([918 + W, 168, 944 + W, 168], 3),
      ...red,
      anims: drawn(250),
    });
    p.addElement(root, {
      type: 'stroke',
      size: 2.2,
      pts: pencilPts([936 + W, 146, 936 + W, 164], 5),
      ...red,
      anims: drawn(500),
    });
    p.addElement(root, {
      type: 'text',
      x: 952 + W,
      y: 156,
      text: '$\\Delta i_L$',
      size: 16,
      align: 'start',
      ...red,
      anims: [anim({ kind: 'appear', step: 1, effect: 'pop', delay: 750 })],
    });
    p.addElement(root, {
      type: 'text',
      x: 580 + W,
      y: 340,
      text: '$\\Delta i_L = \\dfrac{(V_{in} - V_{out})\\,D}{L\\,f_s}$',
      size: 18,
      align: 'start',
      // Click 2: the formula, then its underline.
      anims: [anim({ kind: 'appear', step: 2, effect: 'rise' })],
    });
    p.addElement(root, {
      type: 'stroke',
      size: 2,
      pts: pencilPts([578 + W, 372, 640 + W, 369, 700 + W, 373, 770 + W, 370], 7),
      ...red,
      anims: [anim({ kind: 'appear', step: 2, effect: 'wipe', delay: 500, dur: 700 })],
    });
    p.addElement(root, {
      type: 'note',
      x: 790 + W,
      y: 320,
      w: 226,
      h: 118,
      color: '@yellow',
      text: 'Specs\n$V_{in}$ = 48 V → $V_{out}$ = 12 V\n$f_s$ = 100 kHz, D = 0.25\n$\\Delta i_L$ ≤ 30 % of $I_{out}$',
      // Click 3: the specs.
      anims: [anim({ kind: 'appear', step: 3, effect: 'pop' })],
    });

    // ---------------------------------------------------------------------------------------
    // Slide 5, the design steps: a flowchart walked through click by click (a marker moving on,
    // the boxes in turn, the way back when the losses are too high), ending with the build.
    const Y = 590;
    const shape = (
      kind: ShapeElement['kind'],
      x: number,
      y: number,
      w: number,
      h: number,
      text: string,
      anims: Anim[] = [],
      patch: Partial<ShapeElement> = {},
    ) =>
      p.addElement(root, {
        type: 'shape',
        kind,
        x,
        y,
        w,
        h,
        text,
        anims,
        ...patch,
      }) as ShapeElement;
    const specs = shape('terminator', -20, Y + 10, 120, 50, 'Specs');
    const chooseL = shape('rect', 150, Y, 180, 70, 'Choose $L$\n$\\Delta i_L \\le 30\\,\\%$', [
      anim({ kind: 'emphasis', step: 1, effect: 'pulse', delay: 350 }),
    ]);
    const chooseC = shape('rect', 380, Y, 180, 70, 'Choose $C$\n$\\Delta v_{out} \\le 1\\,\\%$', [
      anim({ kind: 'emphasis', step: 2, effect: 'pulse', delay: 350 }),
    ]);
    const losses = shape(
      'diamond',
      610,
      Y - 20,
      150,
      110,
      'Losses\nOK?',
      [
        anim({ kind: 'emphasis', step: 3, effect: 'glow', delay: 350 }),
        // Click 4: not the first time — back to the inductor.
        anim({ kind: 'emphasis', step: 4, effect: 'shake' }),
      ],
      { style: { color: '@red' } },
    );
    const tune = shape('rect', 820, Y + 5, 160, 60, 'Tune the PI', [
      anim({ kind: 'emphasis', step: 5, effect: 'pulse', delay: 350 }),
    ]);
    const build = shape(
      'terminator',
      820,
      Y + 130,
      160,
      50,
      'Build it!',
      [
        anim({ kind: 'appear', step: 5, effect: 'zoom', delay: 900 }),
        anim({ kind: 'emphasis', step: 5, effect: 'pulse', delay: 1500 }),
      ],
      { style: { color: '@green' } },
    );
    /** A connector between two boxes: always there, or drawn at click `step`. */
    const link = (
      a: ShapeElement,
      aa: Anchor,
      b: ShapeElement,
      ba: Anchor,
      step?: number,
      text?: string,
    ) =>
      p.addElement(root, {
        type: 'line',
        pts: [...anchorOf(a, aa), ...anchorOf(b, ba)],
        arrowEnd: true,
        route: 'elbow',
        from: { id: a.id, anchor: aa },
        to: { id: b.id, anchor: ba },
        ...(text ? { text } : {}),
        ...(step !== undefined
          ? { anims: [anim({ kind: 'appear', step, effect: 'wipe', delay: 300 })] }
          : {}),
      });
    link(specs, 'e', chooseL, 'w');
    link(chooseL, 'e', chooseC, 'w');
    link(chooseC, 'e', losses, 'w');
    link(losses, 'e', tune, 'w', undefined, 'yes');
    // Click 4: the losses are too high — the way back to the inductor is drawn.
    link(losses, 's', chooseL, 's', 4, 'no: bigger $L$, better FETs');
    // Click 5: then on to the build.
    link(tune, 's', build, 'n', 5);
    // "You are here": moves on at each click.
    p.addElement(root, {
      type: 'text',
      x: 40,
      y: Y - 18,
      text: '▼',
      size: 18,
      align: 'middle',
      ...red,
      anims: [
        anim({ kind: 'move', step: 1, dx: 200, dur: 500 }),
        anim({ kind: 'move', step: 2, dx: 230, dur: 500 }),
        anim({ kind: 'move', step: 3, dx: 215, dur: 500 }),
        anim({ kind: 'move', step: 5, dx: 215, dur: 500 }),
      ],
    });
    p.addElement(root, {
      type: 'text',
      x: -20,
      y: Y - 70,
      text: 'Design steps',
      size: 20,
      align: 'start',
    });
    // For the one presenting (in every slide): the keys of the presentation.
    p.addElement(root, {
      type: 'note',
      x: -20,
      y: Y + 140,
      w: 230,
      h: 110,
      color: '@green',
      text: 'Presenting\n→ or click: next, ← back\nL laser, P pen, B blank\nEsc: back to the editor',
    });
    // Only in the editor: hidden from the presentation.
    p.addElement(root, {
      type: 'note',
      x: 240,
      y: Y + 140,
      w: 230,
      h: 104,
      color: '@pink',
      noPresent: true,
      text: 'Editor only\nThis note is hidden from the presentation (right panel: Show in → Presentation).',
    });
    p.addElement(root, {
      type: 'text',
      x: 480,
      y: Y + 200,
      text: 'Read more: the buck converter on Wikipedia ↗',
      size: 15,
      align: 'start',
      style: { color: '@blue' },
      link: { kind: 'url', url: 'https://en.wikipedia.org/wiki/Buck_converter' },
    });

    // ---------------------------------------------------------------------------------------
    // The frames: the slides, in this order, each with its own way of arriving.
    const frame = (
      name: string,
      slide: number,
      x: number,
      y: number,
      w: number,
      h: number,
      patch: Partial<FrameElement> = {},
    ) => p.addElement(root, { type: 'frame', name, slide, x, y, w, h, ...patch });
    frame('Overview', 0, -90, -215, 1300, 1095);
    frame('Power stage', 1, -60, -90, 690, 520);
    frame('Output filter', 2, 300, 60, 180, 190);
    frame('Waveforms', 3, 530 + W, -90, 490, 560, { transition: 'slide' });
    frame('Design steps', 4, -60, Y - 110, 1080, 380, { transition: 'slide-up' });

    // Controller block and its sub-sheet.
    const block = createBlock(p, root, { x: 120, y: 260, w: 200, h: 100 }, 'Voltage controller');
    // Click 5 of the power stage: the controller lights up (click it, or the button, to go in).
    p.updateElement(root, block.id, {
      tex: 'K_p + \\frac{K_i}{s}',
      anims: [anim({ kind: 'emphasis', step: 5, effect: 'glow', dur: 1200 })],
    });
    const sub = block.childSheetId;
    p.addElement(root, {
      type: 'button',
      x: 380,
      y: 330,
      w: 190,
      h: 36,
      label: 'Open the controller →',
      link: { kind: 'sheet', sheetId: sub },
      anims: [anim({ kind: 'appear', step: 5, effect: 'pop', delay: 600 })],
    });
    p.addElement(sub, {
      type: 'text',
      x: 40,
      y: -110,
      text: 'PI voltage loop with PWM: $C(s) = K_p + \\frac{K_i}{s}$',
      size: 18,
      align: 'start',
      anims: [anim({ kind: 'appear', step: 0, effect: 'rise', dur: 600 })],
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
      // As the slide opens: tuning the PI tames the overshoot, then the gains show up.
      anims: [
        anim({
          kind: 'wave',
          step: 0,
          trace: 'out',
          key: 'zeta',
          from: 0.15,
          to: 0.45,
          dur: 1800,
          delay: 700,
        }),
      ],
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
      anims: [anim({ kind: 'appear', step: 0, effect: 'pop', delay: 2500 })],
    });
    // A button back to the main sheet (in the presentation too).
    p.addElement(sub, {
      type: 'button',
      x: 450,
      y: 240,
      w: 240,
      h: 36,
      label: '← Back to the power stage',
      link: { kind: 'sheet', sheetId: root },
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
