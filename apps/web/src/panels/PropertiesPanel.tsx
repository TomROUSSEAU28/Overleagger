import {
  GRID,
  ROLE_LABELS,
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
import {
  defaultOptions,
  isStatic,
  type OptionDef,
  type OptionValue,
  type Standard,
} from '@overleagger/symbols';
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
  UserCog,
} from 'lucide-react';
import { useEditor, useMeta, useSheetElements, useSheets } from '../editor/context';
import { useCanEdit, useSession } from '../cloud/hooks';
import { useUI } from '../store/ui';
import { INK_NAMES, THEMES, resolveColor } from '../theme';
import { Field, IconButton } from './common';
import { typedNumber } from './typedNumber';
import {
  ButtonProps,
  FrameProps,
  ImageProps,
  LinkSection,
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
  const canEdit = useCanEdit();
  return (
    <div className="props" data-testid="properties">
      {/* Read-only: everything is shown but disabled. */}
      <fieldset className="plain" disabled={!canEdit}>
        {body}
      </fieldset>
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
  const count = (t: Element['type'], word: string) => {
    const n = elements.filter((e) => e.type === t).length;
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  };
  return (
    <>
      <h3>Sheet</h3>
      <Field label="Sheet name">
        <input
          value={sheet?.name ?? ''}
          onChange={(e) =>
            // One change: the sheet and its block keep the same name (typing merges for undo).
            ed.project.transact(() => {
              ed.project.updateSheet(ed.sheetId, { name: e.target.value });
              const s = ed.project.getSheet(ed.sheetId);
              if (s?.blockId && s.parentSheetId)
                ed.project.updateElement(s.parentSheetId, s.blockId, { title: e.target.value });
            })
          }
        />
      </Field>
      {sheet && (
        <div className="show-in">
          <span className="field-label">Include this sheet in</span>
          <label className="check">
            <input
              type="checkbox"
              checked={!sheet.noPresent}
              onChange={(e) => ed.project.updateSheet(sheet.id, { noPresent: !e.target.checked })}
              data-testid="sheet-in-present"
            />
            Presentation
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!sheet.noExport}
              onChange={(e) => ed.project.updateSheet(sheet.id, { noExport: !e.target.checked })}
              data-testid="sheet-in-export"
            />
            PDF export
          </label>
        </div>
      )}
      {sheet && <SheetAccessInfo sheetId={sheet.id} />}
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
        {count('component', 'part')} · {count('wire', 'wire')} · {count('block', 'block')} ·{' '}
        {count('port', 'port')}
      </p>
      <p className="muted small">
        Tip: select an element to edit it. Press <kbd className="kbd">A</kbd> to quickly add a part.
      </p>
    </>
  );
}

/** Shared projects: who may do what on this sheet. */
function SheetAccessInfo({ sheetId }: { sheetId: string }) {
  const ed = useEditor();
  const role = useSession((s) => s.role);
  const rules = useSession((s) => s.rules);
  if (!ed.session) return null;
  if (role === 'owner') {
    const n = rules.filter((r) => r.sheetId === sheetId).length;
    return (
      <div className="sheet-access-info">
        <span className="field-label">Access</span>
        <span className="muted small">
          {n
            ? `Special access for ${n} ${n === 1 ? 'person or team' : 'people or teams'}`
            : 'Everyone keeps their role'}
        </span>
        <button
          type="button"
          className="btn small-btn"
          onClick={() => useUI.getState().set({ shareOpen: { sheetId } })}
          data-testid="manage-sheet-access"
        >
          <UserCog size={13} /> Manage access
        </button>
      </div>
    );
  }
  const level = ed.session.levelOf(sheetId);
  return (
    <div className="sheet-access-info">
      <span className="field-label">Your access here</span>
      <span className="small">{level === 'hidden' ? 'Hidden' : ROLE_LABELS[level]}</span>
    </div>
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

/** Elements that can carry a hyperlink (buttons always have one, blocks open their sheet). */
const LINKABLE: Element['type'][] = [
  'shape',
  'image',
  'text',
  'note',
  'component',
  'waveform',
  'line',
];

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
      {LINKABLE.includes(el.type) && <LinkSection el={el} />}
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
      <ShowIn els={[el]} />
    </>
  );
}

/**
 * "Show in": leave elements out of the presentation and/or the exports (draft notes, hints for
 * the audience only…). Several elements: a box is ticked when every one of them is shown.
 */
function ShowIn({ els }: { els: Element[] }) {
  const ed = useEditor();
  const set = (key: 'noPresent' | 'noExport', shown: boolean) =>
    ed.commit(() => {
      for (const e of els) ed.updateElement(e.id, { [key]: shown ? undefined : true });
    });
  return (
    <div className="show-in">
      <span className="field-label">Show in</span>
      <label className="check">
        <input
          type="checkbox"
          checked={els.every((e) => !e.noPresent)}
          onChange={(e) => set('noPresent', e.target.checked)}
          data-testid="show-in-present"
        />
        Presentation
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={els.every((e) => !e.noExport)}
          onChange={(e) => set('noExport', e.target.checked)}
          data-testid="show-in-export"
        />
        Export
      </label>
    </div>
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
      <ShowIn els={sel} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Visible options, grouped by their `row` key (consecutive options side by side). */
function optionRows(options: OptionDef[], opts: Record<string, OptionValue>): OptionDef[][] {
  const rows: OptionDef[][] = [];
  for (const o of options) {
    if (o.show && !o.show(opts)) continue;
    const last = rows[rows.length - 1];
    if (o.row && last?.[0]?.row === o.row) last.push(o);
    else rows.push([o]);
  }
  return rows;
}

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
        onChange={(e) => {
          const n = typedNumber(e.target.value, o.min, o.max);
          if (n !== undefined) onChange(n);
        }}
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
      {optionRows(options, { ...defaultOptions(sym!), ...el.opts }).map((row) => {
        const inputs = row.map((o) => (
          <OptionInput
            key={o.key}
            o={o}
            value={el.opts[o.key]}
            onChange={(v) => ed.patchWithFollow(el.id, { opts: { ...el.opts, [o.key]: v } })}
          />
        ));
        return row.length > 1 ? (
          <div key={row[0]!.key} className="row">
            {inputs}
          </div>
        ) : (
          inputs[0]
        );
      })}
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
            onChange={(e) => {
              // Even grid units keep the pins of the block on the grid.
              const n = typedNumber(e.target.value, 4, 400);
              if (n !== undefined) upd({ w: Math.round(n / 2) * 2 * GRID });
            }}
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            step={2}
            min={4}
            value={el.h / GRID}
            onChange={(e) => {
              const n = typedNumber(e.target.value, 4, 400);
              if (n !== undefined) upd({ h: Math.round(n / 2) * 2 * GRID });
            }}
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

/** `$v_{out}$` → `v_out`: readable text for help sentences. */
const plainText = (s: string) => s.replace(/\$/g, '').replace(/\\(\w+)|[{}]/g, '$1');

function PortProps({ el }: { el: PortElement }) {
  const ed = useEditor();
  const upd = (patch: Partial<PortElement>) => ed.updateElement(el.id, patch);
  const sheet = ed.project.getSheet(ed.sheetId);
  const block =
    sheet?.parentSheetId && sheet.blockId
      ? ed.project.getElement(sheet.parentSheetId, sheet.blockId)
      : undefined;
  const parentBlock = block?.type === 'block' ? block : undefined;
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
      <Field label="Pin position on the block (one level up)">
        <select
          value={el.side ?? ''}
          onChange={(e) => upd({ side: (e.target.value || undefined) as PortElement['side'] })}
          data-testid="prop-port-side"
        >
          <option value="">Automatic (inputs left, outputs right)</option>
          <option value="l">Left edge</option>
          <option value="r">Right edge</option>
          <option value="t">Top edge</option>
          <option value="b">Bottom edge</option>
        </select>
      </Field>
      <p className="muted small">
        {parentBlock ? (
          <>
            This port is the pin <i>{plainText(el.name)}</i> of the block “
            {plainText(parentBlock.title)}” in the sheet above; choose on which edge of that block
            the pin appears.{' '}
            <button type="button" className="link accent" onClick={() => ed.followLink(el.id)}>
              Show the block
            </button>{' '}
            (or Ctrl+click the port).
          </>
        ) : (
          'Ports connect a sub-sheet to the pins of its block. This sheet is not inside a block yet.'
        )}
      </p>
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
