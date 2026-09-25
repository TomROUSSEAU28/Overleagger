import { Project, makeContext, type Element } from '@overleagger/core';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  mixColor,
  slideElements,
  slideOwners,
  slideSteps,
  typed,
  type Clock,
} from './anim';

const resolve = (c: string | undefined) => c ?? '#000000';
const at = (reached: number, started: [number, number][], now: number): Clock => ({
  reached,
  started: new Map(started),
  now,
});

const text = (anims: Element['anims'], t = 'Hello'): Element =>
  ({
    id: 't',
    type: 'text',
    z: 0,
    x: 0,
    y: 0,
    text: t,
    size: 16,
    align: 'start',
    anims,
  }) as Element;

describe('presentation animations', () => {
  it('lists the click steps of a slide', () => {
    expect(
      slideSteps([
        text([
          { id: 'a', kind: 'appear', step: 2 },
          { id: 'b', kind: 'emphasis', step: 0 },
        ]),
        text([{ id: 'c', kind: 'appear', step: 1 }]),
      ]),
    ).toEqual([1, 2]);
  });

  it('keeps an element hidden until its click, then fades it in', () => {
    const el = text([{ id: 'a', kind: 'appear', step: 1, effect: 'fade', dur: 400 }]);
    expect(evaluate([el], at(0, [[0, 0]], 100), resolve).fx.get('t')?.opacity).toBe(0);
    const mid = evaluate([el], at(1, [[1, 1000]], 1200), resolve);
    expect(mid.fx.get('t')!.opacity).toBeGreaterThan(0);
    expect(mid.fx.get('t')!.opacity).toBeLessThan(1);
    expect(mid.busy).toBe(true);
    // Reached long ago (going back through the slides): shown, nothing moving.
    const done = evaluate([el], at(1, [], 5000), resolve);
    expect(done.fx.get('t')).toBeUndefined();
    expect(done.busy).toBe(false);
  });

  it('closes a switch at its click', () => {
    const sw = {
      id: 's',
      type: 'component',
      z: 0,
      symbolId: 'switch',
      x: 0,
      y: 0,
      rot: 0,
      mirror: false,
      opts: { contact: 'no' },
      params: {},
      ref: 'S1',
      anims: [{ id: 'a', kind: 'set', step: 1, opts: { state: 'on' } }],
    } as Element;
    const before = evaluate([sw], at(0, [], 0), resolve).elements[0]!;
    expect(before.type === 'component' && before.opts.state).toBeFalsy();
    const after = evaluate([sw], at(1, [], 0), resolve).elements[0]!;
    expect(after.type === 'component' && after.opts.state).toBe('on');
  });

  it('moves a PWM duty cycle, once or back and forth', () => {
    const wave = {
      id: 'w',
      type: 'waveform',
      z: 0,
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      layout: 'overlay',
      xLabel: '',
      yLabel: '',
      grid: true,
      axes: true,
      traces: [
        {
          id: 't1',
          kind: 'pwm',
          amp: 1,
          offset: 0,
          periods: 3,
          phase: 0,
          duty: 0.5,
          tau: 0,
          zeta: 0,
          ripple: 0,
        },
      ],
      anims: [{ id: 'a', kind: 'wave', step: 0, key: 'duty', from: 0.2, to: 0.8, dur: 1000 }],
    } as Element;
    const duty = (now: number, loop = false) => {
      const w = { ...wave, anims: [{ ...wave.anims![0]!, loop }] } as Element;
      const e = evaluate([w], at(0, [[0, 0]], now), resolve).elements[0]!;
      return e.type === 'waveform' ? e.traces[0]!.duty : NaN;
    };
    expect(duty(0)).toBeCloseTo(0.2);
    expect(duty(1000)).toBeCloseTo(0.8);
    expect(duty(2000)).toBeCloseTo(0.8);
    // Looping: back at the start after two durations.
    expect(duty(1000, true)).toBeCloseTo(0.8);
    expect(duty(2000, true)).toBeCloseTo(0.2);
  });

  it('waits for the slide to arrive: nothing plays, nothing flashes', () => {
    const typing = text([{ id: 'a', kind: 'text', step: 0, effect: 'typewriter' }]);
    const arriving = at(0, [[0, Infinity]], 500);
    const e = evaluate([typing], arriving, resolve).elements[0]!;
    expect(e.type === 'text' && e.text).toBe('');
  });

  it('types a text, keeping formulas whole', () => {
    expect(typed('ab $x^2$', 0.5)).toBe('ab');
    expect(typed('ab $x^2$', 0.99)).toBe('ab $x^2$');
    const el = text([{ id: 'a', kind: 'text', step: 1, effect: 'typewriter' }]);
    const before = evaluate([el], at(0, [], 0), resolve).elements[0]!;
    expect(before.type === 'text' && before.text).toBe('');
  });

  it('changes colour smoothly', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
    const el = text([{ id: 'a', kind: 'color', step: 0, color: '#ff0000', dur: 100 }]);
    const e = evaluate([el], at(0, [[0, 0]], 200), resolve).elements[0]!;
    expect(e.style?.color).toBe('rgb(255, 0, 0)');
  });

  it('never scales a part of the circuit: it lights up instead, and settles back', () => {
    const r = {
      id: 'r',
      type: 'component',
      z: 0,
      symbolId: 'resistor',
      x: 0,
      y: 0,
      rot: 0,
      mirror: false,
      ref: 'R1',
      params: {},
      opts: {},
      style: { color: '#000000' },
      anims: [{ id: 'a', kind: 'emphasis', step: 1, effect: 'pulse', color: '#ff0000', dur: 1000 }],
    } as unknown as Element;
    const mid = evaluate([r], at(1, [[1, 0]], 500), resolve);
    expect(mid.fx.get('r')?.transform).toBeUndefined();
    expect(mid.elements[0]!.style?.color).toBe('rgb(255, 0, 0)');
    expect(mid.busy).toBe(true);
    const done = evaluate([r], at(1, [[1, 0]], 2000), resolve);
    expect(done.elements[0]!.style?.color).toBe('#000000');
    // A pop on a part: a lit-up fade, not a scale.
    const pop = {
      ...r,
      anims: [{ id: 'b', kind: 'appear', step: 1, effect: 'pop', dur: 1000 }],
    } as Element;
    const f = evaluate([pop], at(1, [[1, 0]], 300), resolve);
    expect(f.fx.get('r')?.transform).toBeUndefined();
    expect(f.fx.get('r')?.opacity).toBeGreaterThan(0);
  });

  it('pulses a text gently', () => {
    const el = text([{ id: 'a', kind: 'emphasis', step: 1, effect: 'pulse', dur: 1000 }]);
    const mid = evaluate([el], at(1, [[1, 0]], 500), resolve);
    const k = Number(/scale\(([\d.]+)\)/.exec(mid.fx.get('t')?.transform ?? '')?.[1]);
    expect(k).toBeGreaterThan(1);
    expect(k).toBeLessThanOrEqual(1.07);
  });

  it('an overview, then a zoom: what is inside the zoom plays on the zoom', () => {
    const p = Project.create('T');
    const sheet = p.rootSheetId;
    const box = (x: number, y: number) =>
      p.addElement(sheet, { type: 'shape', kind: 'rect', x, y, w: 20, h: 20 }).id;
    const overview = p.addElement(sheet, {
      type: 'frame',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      name: 'Overview',
    }).id;
    const zoom = p.addElement(sheet, {
      type: 'frame',
      x: 10,
      y: 10,
      w: 100,
      h: 80,
      name: 'Zoom',
    }).id;
    const side = p.addElement(sheet, {
      type: 'frame',
      x: 380,
      y: 0,
      w: 200,
      h: 100,
      name: 'Side',
    }).id;
    const inZoom = box(40, 30);
    const onlyOverview = box(200, 200);
    // Across the edge of the overview and the side frame: its centre is in the side frame.
    const across = box(385, 40);
    const outside = box(900, 900);
    const all = p.getElements(sheet);
    const ctx = makeContext(p);
    const owners = slideOwners(all, ctx);
    expect(owners.get(inZoom)).toBe(zoom);
    expect(owners.get(onlyOverview)).toBe(overview);
    expect(owners.get(across)).toBe(side);
    expect(owners.has(outside)).toBe(false);
    expect(slideElements(all, zoom, ctx).map((e) => e.id)).toEqual([inZoom]);
    // A sheet without frames: all its elements.
    expect(slideElements(all, null, ctx)).toHaveLength(4);
  });
});
