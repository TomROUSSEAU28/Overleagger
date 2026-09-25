import type {
  ButtonElement,
  Element,
  FrameElement,
  ImageElement,
  LinkTarget,
  LineElement,
  NoteElement,
  ShapeElement,
  Side,
  StrokeElement,
  Trace,
  TraceKind,
  WaveformElement,
} from '@overleagger/core';
import { ExternalLink, Plus, Trash } from 'lucide-react';
import { TRACE_KINDS, WAVE_PRESETS, newTrace } from '../canvas/render/waveforms';
import { useEditor, useSheets } from '../editor/context';
import { SHAPE_KINDS } from '../canvas/shapeKinds';
import { useUI } from '../store/ui';
import { INK_NAMES, NOTE_NAMES, THEMES, resolveNoteColor } from '../theme';
import { Field, IconButton } from './common';

function useUpd<T extends Element>(el: T) {
  const ed = useEditor();
  return (patch: Partial<T>) => ed.updateElement(el.id, patch as Partial<Element>);
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function ShapeProps({ el }: { el: ShapeElement }) {
  const ed = useEditor();
  const upd = useUpd(el);
  return (
    <>
      <h3>Shape</h3>
      <div className="row">
        <Field label="Kind">
          <select
            value={el.kind}
            onChange={(e) =>
              // Attached connectors move to the new outline.
              ed.patchWithFollow(el.id, { kind: e.target.value as ShapeElement['kind'] })
            }
          >
            {SHAPE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        {el.kind === 'rect' && (
          <Field label="Corner radius">
            <input
              type="number"
              min={0}
              max={60}
              value={el.radius ?? 0}
              onChange={(e) => upd({ radius: Number(e.target.value) || undefined })}
            />
          </Field>
        )}
        {el.kind === 'triangle' && (
          <Field label="Points">
            <select
              value={el.dir ?? 't'}
              onChange={(e) =>
                upd({ dir: e.target.value === 't' ? undefined : (e.target.value as Side) })
              }
            >
              <option value="t">Up</option>
              <option value="r">Right</option>
              <option value="b">Down</option>
              <option value="l">Left</option>
            </select>
          </Field>
        )}
      </div>
      <Field label="Text ($…$ = LaTeX)">
        <input value={el.text ?? ''} onChange={(e) => upd({ text: e.target.value || undefined })} />
      </Field>
      <Check
        label="Hand-drawn (sketch)"
        checked={Boolean(el.sketch)}
        onChange={(v) => upd({ sketch: v || undefined })}
      />
    </>
  );
}

export function LineProps({ el }: { el: LineElement }) {
  const upd = useUpd(el);
  return (
    <>
      <h3>{el.arrowEnd || el.arrowStart ? 'Arrow' : 'Line'}</h3>
      <div className="row">
        <Check
          label="Arrow at start"
          checked={Boolean(el.arrowStart)}
          onChange={(v) => upd({ arrowStart: v || undefined })}
        />
        <Check
          label="Arrow at end"
          checked={Boolean(el.arrowEnd)}
          onChange={(v) => upd({ arrowEnd: v || undefined })}
        />
      </div>
      <Field label="Route">
        <select
          value={el.route ?? 'straight'}
          onChange={(e) => upd({ route: e.target.value === 'elbow' ? 'elbow' : undefined })}
          data-testid="prop-line-route"
        >
          <option value="straight">Straight / curved</option>
          <option value="elbow">Right angles (flowchart)</option>
        </select>
      </Field>
      {el.route !== 'elbow' && (
        <Field label="Curvature">
          <input
            type="range"
            min={-120}
            max={120}
            value={el.bend ?? 0}
            onChange={(e) => upd({ bend: Number(e.target.value) || undefined })}
          />
        </Field>
      )}
      {(el.from || el.to) && (
        <p className="muted small">
          Attached to {el.from && el.to ? 'two shapes' : 'a shape'}: it follows them when they move.
          Drag an end away to detach it.
        </p>
      )}
      <Field label="Label ($…$ = LaTeX)">
        <input value={el.text ?? ''} onChange={(e) => upd({ text: e.target.value || undefined })} />
      </Field>
      <Check
        label="Hand-drawn (sketch)"
        checked={Boolean(el.sketch)}
        onChange={(v) => upd({ sketch: v || undefined })}
      />
      <p className="muted small">
        Start or end a line on a shape to attach it to a connection point.
        {el.route !== 'elbow' ? ' Drag the round middle handle to curve it.' : ''}
      </p>
    </>
  );
}

export function StrokeProps({ el }: { el: StrokeElement }) {
  const upd = useUpd(el);
  return (
    <>
      <h3>{el.highlighter ? 'Highlighter' : 'Pencil stroke'}</h3>
      <Field label={`Size: ${el.size}px`}>
        <input
          type="range"
          min={1}
          max={40}
          step={0.5}
          value={el.size}
          onChange={(e) => upd({ size: Number(e.target.value) })}
        />
      </Field>
    </>
  );
}

export function ImageProps({ el }: { el: ImageElement }) {
  const upd = useUpd(el);
  return (
    <>
      <h3>Image</h3>
      <p className="muted small">
        {el.name ?? 'Image'} · drag the corners to resize (Shift: free ratio).
      </p>
      <Check
        label="Border"
        checked={el.style?.width !== undefined}
        onChange={(v) =>
          upd({ style: v ? { ...el.style, width: 1 } : { ...el.style, width: undefined } })
        }
      />
    </>
  );
}

export function NoteProps({ el }: { el: NoteElement }) {
  const upd = useUpd(el);
  const theme = THEMES[useUI((s) => s.theme)];
  return (
    <>
      <h3>Sticky note</h3>
      <Field label="Text ($…$ = LaTeX)">
        <textarea rows={4} value={el.text} onChange={(e) => upd({ text: e.target.value })} />
      </Field>
      <div className="swatches">
        {NOTE_NAMES.map((n) => (
          <button
            key={n}
            type="button"
            className={`swatch${el.color === `@${n}` ? ' active' : ''}`}
            title={n}
            style={{ background: resolveNoteColor(`@${n}`, theme) }}
            onClick={() => upd({ color: `@${n}` })}
          />
        ))}
      </div>
    </>
  );
}

/** Link target editor (web page / online PDF, or a sheet), optional unless `required`. */
export function LinkFields({
  link,
  onChange,
  required = false,
}: {
  link: LinkTarget | undefined;
  onChange: (link: LinkTarget | undefined) => void;
  required?: boolean;
}) {
  const ed = useEditor();
  const sheets = useSheets();
  const kind = link?.kind ?? 'none';
  return (
    <>
      <Field label={required ? 'Opens' : 'Link'}>
        <select
          value={kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'url'
                ? { kind: 'url', url: 'https://' }
                : e.target.value === 'sheet'
                  ? { kind: 'sheet', sheetId: ed.project.rootSheetId }
                  : undefined,
            )
          }
          data-testid="prop-link-kind"
        >
          {!required && <option value="none">No link</option>}
          <option value="url">A web page / online PDF</option>
          <option value="sheet">A sheet of this project</option>
        </select>
      </Field>
      {link?.kind === 'url' && (
        <Field label="URL">
          <input
            className="mono"
            value={link.url}
            onChange={(e) => onChange({ kind: 'url', url: e.target.value })}
            data-testid="prop-link-url"
          />
        </Field>
      )}
      {link?.kind === 'sheet' && (
        <Field label="Sheet">
          <select
            value={link.sheetId}
            onChange={(e) => onChange({ kind: 'sheet', sheetId: e.target.value })}
            data-testid="prop-link-sheet"
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || 'Untitled'}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

/** Optional link of any element, with a "follow" button. */
export function LinkSection({ el }: { el: Element }) {
  const ed = useEditor();
  return (
    <>
      <h3>Link</h3>
      <LinkFields link={el.link} onChange={(link) => ed.updateElement(el.id, { link })} />
      {el.link && (
        <>
          <button type="button" className="btn" onClick={() => ed.followLink(el.id)}>
            <ExternalLink size={15} /> Follow the link
          </button>
          <p className="muted small">Ctrl+click it on the canvas. It stays clickable in the PDF.</p>
        </>
      )}
    </>
  );
}

export function ButtonProps({ el }: { el: ButtonElement }) {
  const ed = useEditor();
  const upd = useUpd(el);
  return (
    <>
      <h3>Link button</h3>
      <Field label="Label">
        <input
          value={el.label}
          onChange={(e) => upd({ label: e.target.value })}
          data-testid="prop-button-label"
        />
      </Field>
      <LinkFields required link={el.link} onChange={(link) => link && upd({ link })} />
      <button type="button" className="btn" onClick={() => ed.followLink(el.id)}>
        <ExternalLink size={15} /> Follow the link
      </button>
      <p className="muted small">
        Ctrl+click the button on the canvas to follow it. Links stay clickable in the PDF export.
      </p>
    </>
  );
}

export function FrameProps({ el }: { el: FrameElement }) {
  const upd = useUpd(el);
  return (
    <>
      <h3>Frame</h3>
      <Field label="Name">
        <input value={el.name} onChange={(e) => upd({ name: e.target.value })} />
      </Field>
      <p className="muted small">
        A frame is a slide of the presentation: it shows what is inside it. Set its place under
        Presentation.
      </p>
    </>
  );
}

/** A number typed in a field ("" while one is being typed, like a lone "-", is skipped). */
function num(v: string, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function TraceEditor({
  t,
  onChange,
  onRemove,
}: {
  t: Trace;
  onChange: (t: Trace) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Trace>) => onChange({ ...t, ...patch });
  const theme = THEMES[useUI((s) => s.theme)];
  const periodic = !['step1', 'step2', 'exp', 'dc', 'custom'].includes(t.kind);
  return (
    <div className="trace">
      <div className="row">
        <Field label="Signal">
          <select value={t.kind} onChange={(e) => set({ kind: e.target.value as TraceKind })}>
            {TRACE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <IconButton title="Remove this trace" onClick={onRemove}>
          <Trash size={15} />
        </IconButton>
      </div>
      <div className="row">
        <Field label="Label (LaTeX)">
          <input
            className="mono"
            value={t.label ?? ''}
            onChange={(e) => set({ label: e.target.value || undefined })}
          />
        </Field>
      </div>
      <div className="row">
        <Field label="Amplitude">
          <input
            type="number"
            step={0.1}
            value={t.amp}
            onChange={(e) => e.target.value !== '' && set({ amp: num(e.target.value, 1) })}
          />
        </Field>
        <Field label="Offset">
          <input
            type="number"
            step={0.1}
            value={t.offset}
            onChange={(e) => e.target.value !== '' && set({ offset: num(e.target.value, 0) })}
          />
        </Field>
      </div>
      {periodic && (
        <div className="row">
          <Field label="Periods">
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={t.periods}
              onChange={(e) => e.target.value !== '' && set({ periods: num(e.target.value, 2) })}
            />
          </Field>
          <Field label="Phase (°)">
            <input
              type="number"
              step={15}
              value={t.phase}
              onChange={(e) => e.target.value !== '' && set({ phase: num(e.target.value, 0) })}
            />
          </Field>
        </div>
      )}
      {['square', 'pwm', 'ripple'].includes(t.kind) && (
        <Field label={`Duty cycle: ${Math.round(t.duty * 100)} %`}>
          <input
            type="range"
            min={0.02}
            max={0.98}
            step={0.01}
            value={t.duty}
            onChange={(e) => set({ duty: Number(e.target.value) })}
          />
        </Field>
      )}
      {t.kind === 'ripple' && (
        <Field label={`Ripple: ${Math.round(t.ripple * 100)} %`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={t.ripple}
            onChange={(e) => set({ ripple: Number(e.target.value) })}
          />
        </Field>
      )}
      {['step1', 'step2', 'exp'].includes(t.kind) && (
        <Field label={`Time constant: ${t.tau.toFixed(2)}`}>
          <input
            type="range"
            min={0.01}
            max={0.6}
            step={0.01}
            value={t.tau}
            onChange={(e) => set({ tau: Number(e.target.value) })}
          />
        </Field>
      )}
      {t.kind === 'step2' && (
        <Field label={`Damping ζ: ${t.zeta.toFixed(2)}`}>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={t.zeta}
            onChange={(e) => set({ zeta: Number(e.target.value) })}
          />
        </Field>
      )}
      {t.kind === 'custom' && (
        <Field label="Points t,v; t,v … (t: 0→1, v: −1→1)">
          <input
            className="mono"
            value={(t.points ?? [0, 0, 1, 0])
              .reduce<string[]>((a, v, i, arr) => (i % 2 ? a : [...a, `${v},${arr[i + 1]}`]), [])
              .join('; ')}
            onChange={(e) => {
              const pts = e.target.value
                .split(';')
                .map((pair) => pair.split(',').map(Number))
                .filter((p) => p.length === 2 && p.every(Number.isFinite))
                .sort((a, b) => a[0]! - b[0]!)
                .flat();
              if (pts.length >= 4) set({ points: pts });
            }}
          />
        </Field>
      )}
      <div className="swatches">
        <button
          type="button"
          className={`swatch small auto${!t.color ? ' active' : ''}`}
          onClick={() => set({ color: undefined })}
        >
          A
        </button>
        {INK_NAMES.slice(1).map((n) => (
          <button
            key={n}
            type="button"
            className={`swatch small${t.color === `@${n}` ? ' active' : ''}`}
            style={{ background: theme.palette[n] }}
            onClick={() => set({ color: `@${n}` })}
          />
        ))}
        <label className="check compact">
          <input
            type="checkbox"
            checked={Boolean(t.dashed)}
            onChange={(e) => set({ dashed: e.target.checked || undefined })}
          />
          dashed
        </label>
      </div>
    </div>
  );
}

export function WaveformProps({ el }: { el: WaveformElement }) {
  const upd = useUpd(el);
  const setTrace = (i: number, t: Trace) =>
    upd({ traces: el.traces.map((x, k) => (k === i ? t : x)) });
  return (
    <>
      <h3>Waveform</h3>
      <Field label="Preset">
        <select
          value=""
          onChange={(e) => {
            const p = WAVE_PRESETS.find((x) => x.id === e.target.value);
            if (p)
              upd({ traces: p.traces(), layout: p.layout, xLabel: p.xLabel, yLabel: p.yLabel });
          }}
          data-testid="wave-preset"
        >
          <option value="">Choose a preset…</option>
          {WAVE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Field label="Layout">
          <select
            value={el.layout}
            onChange={(e) => upd({ layout: e.target.value as WaveformElement['layout'] })}
          >
            <option value="overlay">Overlay (oscilloscope)</option>
            <option value="stacked">Stacked (chronogram)</option>
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="x label">
          <input
            className="mono"
            value={el.xLabel}
            onChange={(e) => upd({ xLabel: e.target.value })}
          />
        </Field>
        <Field label="y label">
          <input
            className="mono"
            value={el.yLabel}
            onChange={(e) => upd({ yLabel: e.target.value })}
          />
        </Field>
      </div>
      <div className="row">
        <Check label="Axes" checked={el.axes} onChange={(v) => upd({ axes: v })} />
        <Check label="Grid" checked={el.grid} onChange={(v) => upd({ grid: v })} />
      </div>
      <h3>Traces</h3>
      {el.traces.map((t, i) => (
        <TraceEditor
          key={t.id}
          t={t}
          onChange={(nt) => setTrace(i, nt)}
          onRemove={() => upd({ traces: el.traces.filter((_, k) => k !== i) })}
        />
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => upd({ traces: [...el.traces, newTrace('sine')] })}
      >
        <Plus size={15} /> Add a trace
      </button>
    </>
  );
}
