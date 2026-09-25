/**
 * Presentation animations in the properties panel: a folded "Animation" section on each
 * element (what it does, and when: as the slide opens or at the n-th click), and the transition
 * and build order of a frame. Kept out of the way: folded until opened.
 */
import {
  elementBBox,
  framesInSlideOrder,
  newId,
  rectsIntersect,
  type Anim,
  type AnimKind,
  type Element,
  type FrameElement,
  type Transition,
} from '@overleagger/core';
import { isStatic, type OptionDef, type OptionValue } from '@overleagger/symbols';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useEditor, useSheetElements } from '../editor/context';
import { slideElements, slideSteps, textField } from '../present/anim';
import { useUI } from '../store/ui';
import { INK_NAMES, THEMES, resolveColor } from '../theme';
import { Field } from './common';

const KIND_LABEL: Record<AnimKind, string> = {
  appear: 'Appear',
  disappear: 'Disappear',
  emphasis: 'Emphasis',
  color: 'Change colour',
  move: 'Move',
  set: 'Change state',
  wave: 'Animate the curve',
  text: 'Text',
};

const EFFECTS: Partial<Record<AnimKind, [string, string][]>> = {
  appear: [
    ['fade', 'Fade in'],
    ['pop', 'Pop'],
    ['rise', 'Rise'],
    ['zoom', 'Zoom in'],
    ['wipe', 'Wipe (draws from the left)'],
  ],
  disappear: [
    ['fade', 'Fade out'],
    ['pop', 'Pop'],
    ['rise', 'Sink'],
    ['zoom', 'Zoom out'],
    ['wipe', 'Wipe'],
  ],
  emphasis: [
    ['pulse', 'Pulse'],
    ['shake', 'Shake'],
    ['glow', 'Glow'],
  ],
};

const WAVE_KEYS: [NonNullable<Anim['key']>, string, number, number][] = [
  ['duty', 'Duty cycle', 0, 1],
  ['amp', 'Amplitude', 0, 1],
  ['phase', 'Phase (°)', -360, 360],
  ['periods', 'Periods shown', 0.5, 20],
  ['offset', 'Offset', -1, 1],
  ['zeta', 'Damping (2nd order)', 0, 2],
  ['tau', 'Time constant', 0.01, 1],
  ['ripple', 'Ripple', 0, 1],
];

/** What can be animated on an element. */
function kindsFor(el: Element, options: OptionDef[]): AnimKind[] {
  const out: AnimKind[] = ['appear', 'disappear', 'emphasis', 'color', 'move'];
  if (el.type === 'component' && options.length) out.push('set');
  if (el.type === 'waveform') out.push('wave');
  if (textField(el)) out.push('text');
  return out;
}

/** The slide an element is on: the first frame it touches (slide order), else its sheet. */
function slideAround(el: Element, all: Element[], ctx: ReturnType<typeof useEditor>['ctx']) {
  const box = elementBBox(el, ctx, all);
  const frames = framesInSlideOrder(
    all.filter((e): e is FrameElement => e.type === 'frame' && !e.noPresent),
  );
  const frame =
    el.type === 'frame' ? el : frames.find((f) => rectsIntersect(f, box) && f.id !== el.id);
  const rect = frame ? { x: frame.x, y: frame.y, w: frame.w, h: frame.h } : null;
  return { frame, elements: slideElements(all, rect, ctx) };
}

/** Start the presentation on the slide showing this element. */
function preview(frameId: string | undefined) {
  useUI.getState().set({ presentAt: frameId ?? null, presenting: true });
}

/** "When" choices: as the slide opens, then the clicks used on the slide plus a new one. */
function WhenSelect({
  value,
  steps,
  onChange,
}: {
  value: number;
  steps: number[];
  onChange: (step: number) => void;
}) {
  const clicks = [...new Set([...steps, value].filter((s) => s > 0))].sort((a, b) => a - b);
  const next = (clicks.at(-1) ?? 0) + 1;
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      title="When it plays"
      data-testid="anim-when"
    >
      <option value={0}>As the slide opens</option>
      {clicks.map((s, i) => (
        <option key={s} value={s}>
          On click {i + 1}
        </option>
      ))}
      <option value={next}>On a new click ({clicks.length + 1})</option>
    </select>
  );
}

const secs = (ms: number | undefined, def: number) =>
  String(((ms ?? def) / 1000).toFixed(2)).replace(/\.?0+$/, '');

function AnimCard({
  a,
  el,
  options,
  steps,
  onChange,
  onRemove,
}: {
  a: Anim;
  el: Element;
  options: OptionDef[];
  steps: number[];
  onChange: (patch: Partial<Anim>) => void;
  onRemove: () => void;
}) {
  const theme = THEMES[useUI((s) => s.theme)];
  const effects = EFFECTS[a.kind];
  const opt = a.kind === 'set' ? options.find((o) => a.opts && o.key in a.opts) : undefined;
  const optValue = opt && a.opts ? a.opts[opt.key] : undefined;
  const setOpt = (o: OptionDef, v: OptionValue) => onChange({ opts: { [o.key]: v } });
  return (
    <div className="anim-card" data-testid="anim-card">
      <div className="anim-card-head">
        <b>{KIND_LABEL[a.kind]}</b>
        <WhenSelect value={a.step} steps={steps} onChange={(step) => onChange({ step })} />
        <button
          type="button"
          className="icon-btn"
          aria-label="Remove this animation"
          title="Remove"
          onClick={onRemove}
        >
          <X size={14} />
        </button>
      </div>
      {effects && (
        <select
          value={a.effect ?? effects[0]![0]}
          onChange={(e) => onChange({ effect: e.target.value })}
        >
          {effects.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )}
      {a.kind === 'color' && (
        <div className="anim-swatches">
          {INK_NAMES.map((n) => (
            <button
              key={n}
              type="button"
              className={`swatch${a.color === `@${n}` ? ' active' : ''}`}
              style={{ background: resolveColor(`@${n}`, theme) }}
              title={n}
              aria-label={n}
              onClick={() => onChange({ color: `@${n}` })}
            />
          ))}
        </div>
      )}
      {a.kind === 'move' && (
        <div className="row">
          <Field label="Right (px)">
            <input
              type="number"
              step={10}
              value={a.dx ?? 0}
              onChange={(e) => onChange({ dx: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Down (px)">
            <input
              type="number"
              step={10}
              value={a.dy ?? 0}
              onChange={(e) => onChange({ dy: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
      )}
      {a.kind === 'set' && (
        <div className="row">
          <Field label="Option">
            <select
              value={opt?.key ?? ''}
              onChange={(e) => {
                const o = options.find((x) => x.key === e.target.value);
                if (o) setOpt(o, o.default);
              }}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {opt && (
            <Field label="Becomes">
              {opt.type === 'bool' ? (
                <select
                  value={optValue ? 'yes' : 'no'}
                  onChange={(e) => setOpt(opt, e.target.value === 'yes')}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : opt.type === 'enum' ? (
                <select
                  value={String(optValue ?? opt.default)}
                  onChange={(e) => setOpt(opt, e.target.value)}
                  data-testid="anim-set-value"
                >
                  {opt.choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={opt.min}
                  max={opt.max}
                  step={opt.step}
                  value={Number(optValue ?? opt.default)}
                  onChange={(e) => setOpt(opt, Number(e.target.value))}
                />
              )}
            </Field>
          )}
        </div>
      )}
      {a.kind === 'wave' && el.type === 'waveform' && (
        <>
          <div className="row">
            {el.traces.length > 1 && (
              <Field label="Trace">
                <select
                  value={a.trace ?? el.traces[0]?.id}
                  onChange={(e) => onChange({ trace: e.target.value })}
                >
                  {el.traces.map((t, i) => (
                    <option key={t.id} value={t.id}>
                      {t.label || `Trace ${i + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Parameter">
              <select
                value={a.key ?? 'duty'}
                onChange={(e) => onChange({ key: e.target.value as Anim['key'] })}
              >
                {WAVE_KEYS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="From">
              <input
                type="number"
                step={0.05}
                value={a.from ?? 0}
                onChange={(e) => onChange({ from: Number(e.target.value) })}
                data-testid="anim-from"
              />
            </Field>
            <Field label="To">
              <input
                type="number"
                step={0.05}
                value={a.to ?? 1}
                onChange={(e) => onChange({ to: Number(e.target.value) })}
                data-testid="anim-to"
              />
            </Field>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(a.loop)}
              onChange={(e) => onChange({ loop: e.target.checked || undefined })}
            />
            Keep going back and forth
          </label>
        </>
      )}
      {a.kind === 'text' && (
        <>
          <select
            value={a.effect === 'typewriter' || !a.text ? 'typewriter' : 'replace'}
            onChange={(e) =>
              onChange(
                e.target.value === 'typewriter'
                  ? { effect: 'typewriter' }
                  : { effect: 'replace', text: a.text || 'New text' },
              )
            }
          >
            <option value="typewriter">Typed, letter by letter</option>
            <option value="replace">Replaced by…</option>
          </select>
          {a.effect === 'replace' && (
            <input
              value={a.text ?? ''}
              placeholder="New text ($…$ for LaTeX)"
              onChange={(e) => onChange({ text: e.target.value })}
            />
          )}
        </>
      )}
      <div className="row anim-times">
        <Field label="Duration (s)">
          <input
            type="number"
            min={0.05}
            step={0.1}
            value={secs(a.dur, a.kind === 'set' ? 300 : 600)}
            onChange={(e) => onChange({ dur: Math.max(50, Number(e.target.value) * 1000 || 0) })}
          />
        </Field>
        <Field label="Delay (s)">
          <input
            type="number"
            min={0}
            step={0.1}
            value={secs(a.delay, 0)}
            onChange={(e) =>
              onChange({ delay: Math.max(0, Number(e.target.value) * 1000 || 0) || undefined })
            }
          />
        </Field>
      </div>
    </div>
  );
}

/** A new animation of a kind, with sensible values for the element. */
function makeAnim(kind: AnimKind, el: Element, step: number, options: OptionDef[]): Anim {
  const a: Anim = { id: newId(), kind, step };
  if (kind === 'appear' || kind === 'disappear') a.effect = el.type === 'line' ? 'wipe' : 'fade';
  if (kind === 'emphasis') a.effect = 'pulse';
  if (kind === 'color') a.color = '@red';
  if (kind === 'move') a.dx = 40;
  if (kind === 'text') a.effect = 'typewriter';
  if (kind === 'set' && el.type === 'component') {
    // A switch closes; otherwise the first option takes another value.
    const o = options.find((x) => x.key === 'state') ?? options[0];
    if (o) {
      const cur = el.opts[o.key] ?? o.default;
      const v =
        o.type === 'bool'
          ? !cur
          : o.type === 'enum'
            ? (o.choices.find((c) => c.value !== cur)?.value ?? o.default)
            : o.default;
      a.opts = { [o.key]: v };
    }
  }
  if (kind === 'wave' && el.type === 'waveform') {
    const t = el.traces[0];
    a.key = 'duty';
    a.from = t?.duty ?? 0.5;
    a.to = Math.round(Math.min(0.9, (t?.duty ?? 0.5) + 0.3) * 100) / 100;
    a.dur = 1500;
  }
  return a;
}

/** The "Animation" section of an element (folded by default). */
export function AnimationSection({ el }: { el: Element }) {
  const ed = useEditor();
  const open = useUI((s) => s.animOpen);
  const all = useSheetElements(ed.sheetId);
  const [menu, setMenu] = useState(false);
  const anims = el.anims ?? [];
  const sym = el.type === 'component' ? ed.ctx.symbol(el.symbolId) : undefined;
  const options = sym && !isStatic(sym) ? (sym.options ?? []) : [];
  const { frame, elements } = slideAround(el, all, ed.ctx);
  const steps = slideSteps(elements);
  const save = (next: Anim[]) =>
    ed.commit(() => ed.updateElement(el.id, { anims: next.length ? next : undefined }));
  const toggle = () => useUI.getState().set({ animOpen: !open });
  return (
    <section className="anim-section">
      <button
        type="button"
        className="anim-toggle"
        onClick={toggle}
        aria-expanded={open}
        data-testid="anim-toggle"
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Sparkles size={14} />
        <span>Animation</span>
        {anims.length > 0 && <i className="anim-count">{anims.length}</i>}
      </button>
      {open && (
        <div className="anim-body">
          {!anims.length && (
            <p className="muted small">
              Make it appear, move, change colour, close a switch, sweep a duty cycle… during the
              presentation, as the slide opens or on a click.
            </p>
          )}
          {anims.map((a, i) => (
            <AnimCard
              key={a.id}
              a={a}
              el={el}
              options={options}
              steps={steps}
              onChange={(patch) => save(anims.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
              onRemove={() => save(anims.filter((_, j) => j !== i))}
            />
          ))}
          <div className="anim-actions">
            <div className="anim-add">
              <button
                type="button"
                className="btn"
                onClick={() => setMenu(!menu)}
                aria-expanded={menu}
                data-testid="anim-add"
              >
                <Plus size={14} /> Add
              </button>
              {menu && (
                <div className="anim-menu" role="menu">
                  {kindsFor(el, options).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        save([...anims, makeAnim(k, el, (steps.at(-1) ?? 0) + 1, options)]);
                      }}
                      data-testid={`anim-add-${k}`}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => preview(frame?.id)}
              title="Present this slide"
              data-testid="anim-preview"
            >
              <Play size={14} /> Preview
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Name of an element in the build order list. */
function nameOf(el: Element): string {
  if (el.type === 'component') return el.ref || el.symbolId;
  const f = textField(el);
  const t = f ? String((el as unknown as Record<string, unknown>)[f] ?? '').trim() : '';
  if (t) return t.length > 22 ? `${t.slice(0, 20)}…` : t;
  if (el.type === 'line') return el.arrowEnd || el.arrowStart ? 'Arrow' : 'Line';
  return el.type[0]!.toUpperCase() + el.type.slice(1);
}

const TRANSITIONS: [Transition, string][] = [
  ['move', 'Camera glides (default)'],
  ['fade', 'Fade'],
  ['slide', 'Slide in from the right'],
  ['slide-up', 'Slide up'],
  ['zoom', 'Zoom through'],
  ['blur', 'Blur'],
  ['none', 'Cut'],
];

/**
 * Where the frame comes in the presentation: "Slide 2 of 5", one place earlier or later.
 * Frames follow the reading order until one is moved; then the sheet keeps its own order.
 */
function SlideOrder({ el, all }: { el: FrameElement; all: Element[] }) {
  const ed = useEditor();
  const frames = framesInSlideOrder(
    all.filter((e): e is FrameElement => e.type === 'frame' && !e.noPresent),
  );
  const i = frames.findIndex((f) => f.id === el.id);
  if (frames.length < 2 || i < 0) return null;
  const custom = frames.some((f) => f.slide !== undefined);
  const move = (d: number) => {
    const order = [...frames];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    ed.commit(() => order.forEach((f, k) => f.slide !== k && ed.updateElement(f.id, { slide: k })));
  };
  const reset = () =>
    ed.commit(() =>
      frames.forEach((f) => f.slide !== undefined && ed.updateElement(f.id, { slide: undefined })),
    );
  return (
    <div className="slide-order" data-testid="slide-order">
      <span>
        Slide <b>{i + 1}</b> of {frames.length}
      </span>
      <button
        type="button"
        className="icon-btn"
        onClick={() => move(-1)}
        disabled={i === 0}
        title="Show it one slide earlier"
        data-testid="slide-earlier"
      >
        <ChevronLeft size={15} />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => move(1)}
        disabled={i === frames.length - 1}
        title="Show it one slide later"
        data-testid="slide-later"
      >
        <ChevronRight size={15} />
      </button>
      {custom && (
        <button
          type="button"
          className="icon-btn"
          onClick={reset}
          title="Back to reading order (top to bottom, left to right)"
          data-testid="slide-reset"
        >
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  );
}

/** A frame: how the presentation arrives on it, and what plays on it, click by click. */
export function FrameAnimation({ el }: { el: FrameElement }) {
  const ed = useEditor();
  const all = useSheetElements(ed.sheetId);
  const { elements } = slideAround(el, all, ed.ctx);
  const steps = [0, ...slideSteps(elements)];
  const upd = (patch: Partial<FrameElement>) => ed.commit(() => ed.updateElement(el.id, patch));
  const rows = steps.map((s) => ({
    step: s,
    items: elements.flatMap((e) =>
      (e.anims ?? []).filter((a) => a.step === s).map((a) => ({ e, a })),
    ),
  }));
  return (
    <>
      <h3>Presentation</h3>
      <SlideOrder el={el} all={all} />
      <div className="row">
        <Field label="Transition">
          <select
            value={el.transition ?? 'move'}
            onChange={(e) =>
              upd({
                transition: e.target.value === 'move' ? undefined : (e.target.value as Transition),
              })
            }
            data-testid="frame-transition"
          >
            {TRANSITIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Speed">
          <select
            value={el.transitionMs ?? 0}
            onChange={(e) => upd({ transitionMs: Number(e.target.value) || undefined })}
          >
            <option value={0}>Normal</option>
            <option value={300}>Fast</option>
            <option value={1000}>Slow</option>
          </select>
        </Field>
      </div>
      {rows.some((r) => r.items.length) ? (
        <ol className="build-order" data-testid="build-order">
          {rows
            .filter((r) => r.items.length)
            .map((r) => (
              <li key={r.step}>
                <span className="build-when">
                  {r.step === 0 ? 'Opens' : `Click ${steps.indexOf(r.step)}`}
                </span>
                {r.items.map(({ e, a }) => (
                  <button
                    key={a.id}
                    type="button"
                    className="build-item"
                    onClick={() => ed.select([e.id])}
                    title="Select it"
                  >
                    {nameOf(e)} · {KIND_LABEL[a.kind].toLowerCase()}
                  </button>
                ))}
              </li>
            ))}
        </ol>
      ) : (
        <p className="muted small">
          Select something in the frame and open its Animation section to make it appear, move or
          change on a click.
        </p>
      )}
      <button type="button" className="btn" onClick={() => preview(el.id)}>
        <Play size={14} /> Preview this frame
      </button>
    </>
  );
}
