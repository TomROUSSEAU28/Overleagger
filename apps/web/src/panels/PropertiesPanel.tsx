import {
  GRID,
  allowedScales,
  expandSelection,
  resolveComponent,
  type BlockElement,
  type ComponentElement,
  type Element,
  type ElementStyle,
  type LabelElement,
  type PortElement,
  type TextElement,
  type WireElement,
} from '@overleagger/core';
import { isStatic, type OptionDef, type Standard } from '@overleagger/symbols';
import {
  ArrowLeftRight,
  ArrowUpDown,
  BookmarkPlus,
  BringToFront,
  Group,
  LogIn,
  RotateCw,
  SendToBack,
  Ungroup,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  PackagePlus,
  Pencil,
  Plus,
} from 'lucide-react';
import { useEditor, useMeta, useSheetElements, useSheets } from '../editor/context';
import { useUI } from '../store/ui';
import { INK_NAMES, THEMES, resolveColor } from '../theme';
import { Field, IconButton } from './common';
import {
  ButtonProps,
  FrameProps,
  ImageProps,
  LineProps,
  NoteProps,
  ShapeProps,
  StrokeProps,
  WaveformProps,
} from './WhiteboardProps';

export function PropertiesPanel() {
  const ed = useEditor();
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const elements = useSheetElements(sheetId);
  const selection = useUI((s) => s.selection);
  const sel = selection
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is Element => Boolean(e));

  let body;
  if (sel.length === 0) body = <SheetProps />;
  else if (sel.length === 1) body = <SingleProps el={sel[0]!} elements={elements} />;
  else body = <MultiProps sel={sel} elements={elements} />;
  return (
    <div className="props" data-testid="properties">
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SheetProps() {
  const ed = useEditor();
  const meta = useMeta();
  useSheets();
  const sheet = ed.project.getSheet(ed.sheetId);
  const elements = ed.elements();
  const count = (t: Element['type']) => elements.filter((e) => e.type === t).length;
  return (
    <>
      <h3>Sheet</h3>
      <Field label="Sheet name">
        <input
          value={sheet?.name ?? ''}
          onChange={(e) => {
            ed.project.updateSheet(ed.sheetId, { name: e.target.value });
            const s = ed.project.getSheet(ed.sheetId);
            if (s?.blockId && s.parentSheetId)
              ed.project.updateElement(s.parentSheetId, s.blockId, { title: e.target.value });
          }}
        />
      </Field>
      <h3>Project</h3>
      <Field label="Drawing standard">
        <select
          value={meta.standard}
          onChange={(e) => ed.project.setMeta({ standard: e.target.value as Standard })}
          data-testid="standard-select"
        >
          <option value="IEC">IEC 60617 (Europe)</option>
          <option value="ANSI">IEEE 315 / ANSI (US)</option>
        </select>
      </Field>
      <p className="muted small">
        {count('component')} parts · {count('wire')} wires · {count('block')} blocks ·{' '}
        {count('port')} ports
      </p>
      <p className="muted small">
        Tip: select an element to edit it. Press <kbd className="kbd">A</kbd> to quickly add a part.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

const WIDTH_TYPES: Element['type'][] = [
  'component',
  'wire',
  'block',
  'port',
  'shape',
  'line',
  'text',
  'waveform',
];
const DASH_TYPES: Element['type'][] = ['component', 'wire', 'block', 'shape', 'line', 'text'];

/** Light fills that stay readable under graphite ink. */
const FILLS = ['#ffffff', '#f3efe4', '#e6eef8', '#e5f1e1', '#fbf1c7', '#f8e1e1', '#ece6f5'];

function StyleEditor({ els }: { els: Element[] }) {
  const ed = useEditor();
  const theme = THEMES[useUI((s) => s.theme)];
  const first = els[0]?.style ?? {};
  const setStyle = (patch: Partial<ElementStyle>) => {
    ed.commit(() => {
      for (const el of els) {
        const style = { ...el.style, ...patch };
        for (const k of Object.keys(style) as (keyof ElementStyle)[])
          if (style[k] === undefined) delete style[k];
        ed.updateElement(el.id, { style: Object.keys(style).length ? style : undefined });
      }
    });
  };
  const current = first.color;
  const palette = useMeta().palette ?? [];
  const fillable = els.some((e) => ['shape', 'text', 'block', 'frame', 'button'].includes(e.type));
  // Only offer the settings the selected elements actually draw with.
  const hasWidth = els.some(
    (e) => WIDTH_TYPES.includes(e.type) && (e.type !== 'text' || Boolean(e.frame)),
  );
  const hasDash = els.some(
    (e) => DASH_TYPES.includes(e.type) && (e.type !== 'text' || Boolean(e.frame)),
  );
  const hasColor = els.some((e) => e.type !== 'image');
  return (
    <>
      <h3>Style</h3>
      {hasColor && (
        <div className="swatches" role="radiogroup" aria-label="Ink colour">
          <button
            type="button"
            className={`swatch auto${!current ? ' active' : ''}`}
            title="Theme ink"
            onClick={() => setStyle({ color: undefined })}
          >
            A
          </button>
          {INK_NAMES.slice(1).map((n) => (
            <button
              key={n}
              type="button"
              className={`swatch${current === `@${n}` ? ' active' : ''}`}
              title={n}
              style={{ background: theme.palette[n] }}
              onClick={() => setStyle({ color: `@${n}` })}
            />
          ))}
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${current === c ? ' active' : ''}`}
              title={`${c} (project colour)`}
              style={{ background: c }}
              onClick={() => setStyle({ color: c })}
            />
          ))}
          <input
            type="color"
            title="Custom colour"
            value={current && !current.startsWith('@') ? current : resolveColor(current, theme)}
            onChange={(e) => setStyle({ color: e.target.value })}
          />
          {current && !current.startsWith('@') && !palette.includes(current) && (
            <IconButton
              title="Add this colour to the project palette"
              onClick={() => ed.project.setMeta({ palette: [...palette, current] })}
            >
              <Plus size={14} />
            </IconButton>
          )}
        </div>
      )}
      {fillable && (
        <div className="swatches" aria-label="Fill">
          <span className="field-label">Fill</span>
          <button
            type="button"
            className={`swatch auto${!first.fill ? ' active' : ''}`}
            title="No fill"
            onClick={() => setStyle({ fill: undefined })}
          >
            ∅
          </button>
          {FILLS.map((f) => (
            <button
              key={f}
              type="button"
              className={`swatch${first.fill === f ? ' active' : ''}`}
              style={{ background: f }}
              title={f}
              onClick={() => setStyle({ fill: f })}
            />
          ))}
          <input
            type="color"
            title="Custom fill"
            value={first.fill ?? '#ffffff'}
            onChange={(e) => setStyle({ fill: e.target.value })}
          />
        </div>
      )}
      {(hasWidth || hasDash) && (
        <div className="row">
          {hasWidth && (
            <Field label="Stroke">
              <select
                value={first.width ?? ''}
                onChange={(e) =>
                  setStyle({ width: e.target.value ? Number(e.target.value) : undefined })
                }
              >
                <option value="">Default</option>
                {[0.8, 1, 1.5, 2, 2.5, 3, 4].map((w) => (
                  <option key={w} value={w}>
                    {w} px
                  </option>
                ))}
              </select>
            </Field>
          )}
          {hasDash && (
            <Field label="Line">
              <select
                value={first.dash ?? 'solid'}
                onChange={(e) =>
                  setStyle({
                    dash:
                      e.target.value === 'solid'
                        ? undefined
                        : (e.target.value as 'dashed' | 'dotted'),
                  })
                }
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </Field>
          )}
        </div>
      )}
    </>
  );
}

function ArrangeButtons() {
  const ed = useEditor();
  return (
    <div className="button-row">
      <IconButton title="Rotate (R)" onClick={() => ed.rotate()}>
        <RotateCw size={16} />
      </IconButton>
      <IconButton title="Mirror horizontally (X)" onClick={() => ed.mirror('x')}>
        <ArrowLeftRight size={16} />
      </IconButton>
      <IconButton title="Mirror vertically (Y)" onClick={() => ed.mirror('y')}>
        <ArrowUpDown size={16} />
      </IconButton>
      <IconButton title="Bring to front" onClick={() => ed.reorder('front')}>
        <BringToFront size={16} />
      </IconButton>
      <IconButton title="Send to back" onClick={() => ed.reorder('back')}>
        <SendToBack size={16} />
      </IconButton>
      <IconButton
        title="Move into a new hierarchical block (Ctrl Shift B)"
        onClick={() => ed.selectionToBlock()}
      >
        <PackagePlus size={16} />
      </IconButton>
      <IconButton
        title="Save as a template in my library"
        onClick={() => useUI.getState().set({ modal: 'save-template' })}
      >
        <BookmarkPlus size={16} />
      </IconButton>
    </div>
  );
}

function AlignButtons({ count }: { count: number }) {
  const ed = useEditor();
  return (
    <>
      <h3>Align</h3>
      <div className="button-row" data-testid="align-buttons">
        <IconButton title="Align left" onClick={() => ed.align('left')}>
          <AlignStartVertical size={16} />
        </IconButton>
        <IconButton title="Align centres horizontally" onClick={() => ed.align('hcenter')}>
          <AlignCenterVertical size={16} />
        </IconButton>
        <IconButton title="Align right" onClick={() => ed.align('right')}>
          <AlignEndVertical size={16} />
        </IconButton>
        <IconButton title="Align top" onClick={() => ed.align('top')}>
          <AlignStartHorizontal size={16} />
        </IconButton>
        <IconButton title="Align middles vertically" onClick={() => ed.align('vcenter')}>
          <AlignCenterHorizontal size={16} />
        </IconButton>
        <IconButton title="Align bottom" onClick={() => ed.align('bottom')}>
          <AlignEndHorizontal size={16} />
        </IconButton>
        <IconButton
          title="Distribute horizontally (3 or more)"
          onClick={() => ed.distribute('h')}
          disabled={count < 3}
        >
          <AlignHorizontalDistributeCenter size={16} />
        </IconButton>
        <IconButton
          title="Distribute vertically (3 or more)"
          onClick={() => ed.distribute('v')}
          disabled={count < 3}
        >
          <AlignVerticalDistributeCenter size={16} />
        </IconButton>
      </div>
    </>
  );
}

function SingleProps({ el, elements }: { el: Element; elements: Element[] }) {
  const ed = useEditor();
  const members =
    el.type === 'group'
      ? elements.filter((m) => expandSelection(elements, [el.id]).has(m.id) && m.type !== 'group')
      : [el];
  return (
    <>
      {el.type === 'component' && <ComponentProps el={el} />}
      {el.type === 'wire' && <WireProps el={el} />}
      {el.type === 'block' && <BlockProps el={el} />}
      {el.type === 'port' && <PortProps el={el} />}
      {el.type === 'label' && <LabelProps el={el} />}
      {el.type === 'text' && <TextProps el={el} />}
      {el.type === 'shape' && <ShapeProps el={el} />}
      {el.type === 'line' && <LineProps el={el} />}
      {el.type === 'stroke' && <StrokeProps el={el} />}
      {el.type === 'image' && <ImageProps el={el} />}
      {el.type === 'note' && <NoteProps el={el} />}
      {el.type === 'button' && <ButtonProps el={el} />}
      {el.type === 'waveform' && <WaveformProps el={el} />}
      {el.type === 'frame' && <FrameProps el={el} />}
      {el.type === 'group' && (
        <>
          <h3>Group</h3>
          <p className="muted small">
            {members.length} elements. Alt+click or double-click to select inside the group.
          </p>
          <button type="button" className="btn" onClick={() => ed.ungroup()}>
            <Ungroup size={15} /> Ungroup
          </button>
        </>
      )}
      <ArrangeButtons />
      <StyleEditor els={members} />
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(el.locked)}
          onChange={(e) =>
            ed.commit(() => ed.updateElement(el.id, { locked: e.target.checked || undefined }))
          }
        />
        Lock position
      </label>
    </>
  );
}

function MultiProps({ sel, elements }: { sel: Element[]; elements: Element[] }) {
  const ed = useEditor();
  const all = elements.filter(
    (m) =>
      expandSelection(
        elements,
        sel.map((s) => s.id),
      ).has(m.id) && m.type !== 'group',
  );
  return (
    <>
      <h3>{sel.length} selected</h3>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => ed.group()}>
          <Group size={15} /> Group
        </button>
        {sel.some((s) => s.type === 'group') && (
          <button type="button" className="btn" onClick={() => ed.ungroup()}>
            <Ungroup size={15} /> Ungroup
          </button>
        )}
      </div>
      <ArrangeButtons />
      <AlignButtons count={sel.length} />
      <StyleEditor els={all} />
    </>
  );
}

// ---------------------------------------------------------------------------

function OptionInput({
  o,
  value,
  onChange,
}: {
  o: OptionDef;
  value: unknown;
  onChange: (v: string | number | boolean) => void;
}) {
  if (o.type === 'bool') {
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {o.label}
      </label>
    );
  }
  if (o.type === 'enum') {
    return (
      <Field label={o.label}>
        <select value={String(value ?? o.default)} onChange={(e) => onChange(e.target.value)}>
          {o.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={o.label}>
      <input
        type="number"
        min={o.min}
        max={o.max}
        step={o.step}
        value={Number(value ?? o.default)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function ComponentProps({ el }: { el: ComponentElement }) {
  const ed = useEditor();
  const sym = ed.ctx.symbol(el.symbolId);
  const upd = (patch: Partial<ComponentElement>) => ed.updateElement(el.id, patch);
  const resolved = resolveComponent(el, ed.ctx);
  const options = sym && !isStatic(sym) ? (sym.options ?? []) : [];
  return (
    <>
      <h3>{sym?.name ?? el.symbolId}</h3>
      <p className="muted small">{sym?.category}</p>
      {sym?.refPrefix ? (
        <div className="row">
          <Field label="Reference">
            <input
              value={el.ref}
              onChange={(e) => upd({ ref: e.target.value })}
              data-testid="prop-ref"
            />
          </Field>
          <label className="check compact" title="Show reference">
            <input
              type="checkbox"
              checked={el.showRef !== false}
              onChange={(e) => upd({ showRef: e.target.checked ? undefined : false })}
            />
            show
          </label>
        </div>
      ) : null}
      <div className="row">
        <Field label={sym?.hideValueLabel ? 'Label' : 'Value'}>
          <input
            value={el.params.value ?? ''}
            placeholder="e.g. 10 kΩ or $L_f$"
            onChange={(e) => upd({ params: { ...el.params, value: e.target.value } })}
            data-testid="prop-value"
          />
        </Field>
        {!sym?.hideValueLabel && (
          <label className="check compact" title="Show value">
            <input
              type="checkbox"
              checked={el.showValue !== false}
              onChange={(e) => upd({ showValue: e.target.checked ? undefined : false })}
            />
            show
          </label>
        )}
      </div>
      {(sym?.params ?? []).map((p) => (
        <Field key={p.key} label={p.label}>
          <input
            className={p.math ? 'mono' : undefined}
            value={el.params[p.key] ?? ''}
            onChange={(e) => upd({ params: { ...el.params, [p.key]: e.target.value } })}
            data-testid={`prop-param-${p.key}`}
          />
        </Field>
      ))}
      {options.map((o) => (
        <OptionInput
          key={o.key}
          o={o}
          value={el.opts[o.key]}
          onChange={(v) => ed.patchWithFollow(el.id, { opts: { ...el.opts, [o.key]: v } })}
        />
      ))}
      {resolved && allowedScales(resolved).length > 1 && (
        <Field label="Size">
          <select
            value={el.scale ?? 1}
            onChange={(e) =>
              ed.patchWithFollow(el.id, {
                scale: Number(e.target.value) === 1 ? undefined : Number(e.target.value),
              })
            }
            data-testid="prop-scale"
          >
            {allowedScales(resolved).map((k) => (
              <option key={k} value={k}>
                {k === 1 ? 'Normal' : `× ${k}`}
              </option>
            ))}
          </select>
        </Field>
      )}
      <button
        type="button"
        className="btn"
        title="Open this symbol in the symbol editor and save a customised copy"
        onClick={() =>
          useUI.getState().set({
            modal: 'symbol-editor',
            editingSymbol:
              sym && isStatic(sym)
                ? { id: sym.id }
                : { from: el.symbolId, opts: el.opts, replaceId: el.id },
          })
        }
        data-testid="customize-symbol"
      >
        <Pencil size={14} /> {sym && isStatic(sym) ? 'Edit symbol' : 'Customize symbol…'}
      </button>
      <Field label="Symbol standard">
        <select
          value={el.standard ?? ''}
          onChange={(e) => upd({ standard: (e.target.value || undefined) as Standard | undefined })}
        >
          <option value="">Project default</option>
          <option value="IEC">IEC (EU)</option>
          <option value="ANSI">ANSI (US)</option>
        </select>
      </Field>
      <p className="muted small mono">
        x {el.x / GRID} · y {el.y / GRID} · {el.rot * 90}°{el.mirror ? ' · mirrored' : ''}
      </p>
    </>
  );
}

function WireProps({ el }: { el: WireElement }) {
  const ed = useEditor();
  const upd = (patch: Partial<WireElement>) => ed.commit(() => ed.updateElement(el.id, patch));
  return (
    <>
      <h3>{el.kind === 'signal' ? 'Signal line' : 'Wire'}</h3>
      <Field label="Kind">
        <select
          value={el.kind}
          onChange={(e) =>
            upd({
              kind: e.target.value as WireElement['kind'],
              arrow: e.target.value === 'signal' ? 'end' : undefined,
            })
          }
        >
          <option value="power">Wire (electrical)</option>
          <option value="signal">Signal line (block diagram)</option>
        </select>
      </Field>
      <Field label="Arrow">
        <select
          value={el.arrow ?? (el.kind === 'signal' ? 'end' : 'none')}
          onChange={(e) => upd({ arrow: e.target.value as WireElement['arrow'] })}
        >
          <option value="none">None</option>
          <option value="end">At end</option>
          <option value="start">At start</option>
          <option value="both">Both ends</option>
        </select>
      </Field>
      <p className="muted small">
        Drag a segment to move it. Junction dots appear automatically where 3 or more connections
        meet.
      </p>
    </>
  );
}

function BlockProps({ el }: { el: BlockElement }) {
  const ed = useEditor();
  const ports = ed.ctx.ports(el.childSheetId);
  const upd = (patch: Partial<BlockElement>) => ed.updateElement(el.id, patch);
  return (
    <>
      <h3>Hierarchical block</h3>
      <Field label="Title">
        <input
          value={el.title}
          onChange={(e) => ed.setBlockTitle(el.id, e.target.value)}
          data-testid="prop-title"
        />
      </Field>
      <Field label="LaTeX (optional)">
        <input
          className="mono"
          value={el.tex ?? ''}
          placeholder="\frac{1}{1+sT}"
          onChange={(e) => upd({ tex: e.target.value || undefined })}
        />
      </Field>
      <div className="row">
        <Field label="Width">
          <input
            type="number"
            step={2}
            min={4}
            value={el.w / GRID}
            onChange={(e) => upd({ w: Math.max(40, Number(e.target.value) * GRID) })}
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            step={2}
            min={4}
            value={el.h / GRID}
            onChange={(e) => upd({ h: Math.max(40, Number(e.target.value) * GRID) })}
          />
        </Field>
      </div>
      <Field label="Fill">
        <input
          type="color"
          value={el.style?.fill ?? '#ffffff'}
          onChange={(e) =>
            ed.updateElement(el.id, { style: { ...el.style, fill: e.target.value } })
          }
        />
      </Field>
      <button
        type="button"
        className="btn primary"
        onClick={() => ed.enterBlock(el.id)}
        data-testid="open-block"
      >
        <LogIn size={15} /> Open sub-sheet
      </button>
      <p className="muted small">
        Ports:{' '}
        {ports.length
          ? ports.map((p) => p.name).join(', ')
          : 'none yet — add sheet ports (P) inside the block.'}
      </p>
    </>
  );
}

function PortProps({ el }: { el: PortElement }) {
  const ed = useEditor();
  const upd = (patch: Partial<PortElement>) => ed.updateElement(el.id, patch);
  return (
    <>
      <h3>Sheet port</h3>
      <Field label="Name">
        <input
          value={el.name}
          onChange={(e) => upd({ name: e.target.value })}
          data-testid="prop-port-name"
        />
      </Field>
      <Field label="Direction">
        <select value={el.dir} onChange={(e) => upd({ dir: e.target.value as PortElement['dir'] })}>
          <option value="in">Input</option>
          <option value="out">Output</option>
          <option value="io">Bidirectional</option>
        </select>
      </Field>
      <Field label="Pin side on parent block">
        <select
          value={el.side ?? ''}
          onChange={(e) => upd({ side: (e.target.value || undefined) as PortElement['side'] })}
        >
          <option value="">Automatic</option>
          <option value="l">Left</option>
          <option value="r">Right</option>
          <option value="t">Top</option>
          <option value="b">Bottom</option>
        </select>
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(el.flip)}
          onChange={(e) => upd({ flip: e.target.checked || undefined })}
        />
        Flip shape
      </label>
    </>
  );
}

function LabelProps({ el }: { el: LabelElement }) {
  const ed = useEditor();
  return (
    <>
      <h3>Net label</h3>
      <Field label="Net name">
        <input
          value={el.text}
          onChange={(e) => ed.updateElement(el.id, { text: e.target.value })}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(el.flip)}
          onChange={(e) => ed.updateElement(el.id, { flip: e.target.checked || undefined })}
        />
        Text on the left
      </label>
      <p className="muted small">Labels with the same name are connected, even without a wire.</p>
    </>
  );
}

function TextProps({ el }: { el: TextElement }) {
  const ed = useEditor();
  const upd = (patch: Partial<TextElement>) => ed.updateElement(el.id, patch);
  return (
    <>
      <h3>Text</h3>
      <Field label="Content ($…$ = LaTeX)">
        <textarea rows={4} value={el.text} onChange={(e) => upd({ text: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="Size">
          <input
            type="number"
            min={6}
            max={96}
            value={el.size}
            onChange={(e) => upd({ size: Number(e.target.value) || 16 })}
          />
        </Field>
        <Field label="Align">
          <select
            value={el.align}
            onChange={(e) => upd({ align: e.target.value as TextElement['align'] })}
          >
            <option value="start">Left</option>
            <option value="middle">Center</option>
            <option value="end">Right</option>
          </select>
        </Field>
      </div>
      <Field label="Frame">
        <select
          value={el.frame ?? ''}
          onChange={(e) => upd({ frame: (e.target.value || undefined) as TextElement['frame'] })}
          data-testid="prop-text-frame"
        >
          <option value="">None</option>
          <option value="box">Box</option>
          <option value="round">Rounded box</option>
          <option value="double">Double box</option>
          <option value="underline">Underline</option>
        </select>
      </Field>
    </>
  );
}
