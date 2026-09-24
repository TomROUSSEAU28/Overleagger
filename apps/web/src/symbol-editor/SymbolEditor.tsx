import { newId } from '@overleagger/core';
import {
  CATEGORY_ORDER,
  builtinSymbols,
  defaultOptions,
  isStatic,
  primsBBox,
  resolveSymbol,
  type OptionValue,
  type PinDef,
  type Primitive,
  type StaticSymbolDef,
} from '@overleagger/symbols';
import { Circle, Minus, MousePointer2, Pin, Spline, Square, Trash, Type } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { SymbolPreview, SymbolShapes, SymbolText } from '../canvas/render/SymbolGraphic';
import { useEditor, useMeta } from '../editor/context';
import { Field, IconButton, Modal } from '../panels/common';
import { useUserLib } from '../storage/userLibrary';
import { useUI } from '../store/ui';
import { DEFAULT_STROKE, THEMES } from '../theme';

type Tool = 'select' | 'line' | 'poly' | 'rect' | 'circle' | 'text' | 'pin';

/** Pixels per grid unit in the editor. */
const S = 22;
const VIEW = { x: -12, y: -8, w: 24, h: 16 };

const snapHalf = (v: number) => Math.round(v * 2) / 2;

type Sel = { kind: 'prim'; i: number } | { kind: 'pin'; i: number } | null;

function movePrim(p: Primitive, dx: number, dy: number): Primitive {
  switch (p.k) {
    case 'line':
      return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    case 'poly':
      return { ...p, pts: p.pts.map((v, i) => (i % 2 ? v + dy : v + dx)) };
    case 'circle':
    case 'arc':
      return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case 'rect':
    case 'text':
      return { ...p, x: p.x + dx, y: p.y + dy };
    case 'path':
      return p;
  }
}

/**
 * Editor for project symbols: draw lines, polylines, rectangles, circles and texts on a grid,
 * place pins (always on whole grid units), start from any built-in symbol.
 */
export function SymbolEditor() {
  const ed = useEditor();
  const meta = useMeta();
  const editing = useUI((s) => s.editingSymbol);
  const theme = THEMES[useUI((s) => s.theme)];
  const libSymbols = useUserLib((s) => s.symbols);
  const inLibrary = editing?.id ? libSymbols.find((s) => s.id === editing.id) : undefined;
  const existing = editing?.id ? (ed.project.symbols.get(editing.id) ?? inLibrary) : undefined;
  /** Where the symbol is saved: this project only, or the personal library (every project). */
  const [scope, setScope] = useState<'project' | 'library'>(
    inLibrary || !existing ? 'library' : 'project',
  );
  const categories = [
    ...new Set([
      ...libSymbols.map((s) => s.category),
      ...ed.project.getProjectSymbols().map((s) => s.category),
      'Custom',
      ...CATEGORY_ORDER,
    ]),
  ];

  const [name, setName] = useState(existing?.name ?? 'My symbol');
  const [refPrefix, setRefPrefix] = useState(existing?.refPrefix ?? 'X');
  const [category, setCategory] = useState(existing?.category ?? 'Custom');
  const [prims, setPrims] = useState<Primitive[]>(existing?.graphics.prims ?? []);
  const [pins, setPins] = useState<PinDef[]>(existing?.graphics.pins ?? []);
  const [params, setParams] = useState({
    defaultValue: existing?.defaultValue,
    hideValueLabel: existing?.hideValueLabel,
    params: existing?.params,
  });
  const [tool, setTool] = useState<Tool>('line');
  const [sel, setSel] = useState<Sel>(null);
  const [draft, setDraft] = useState<Primitive | null>(null);
  const [from, setFrom] = useState(editing?.from ?? '');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: { x: number; y: number }; orig: Primitive | PinDef } | null>(null);

  const close = () => useUI.getState().set({ modal: null, editingSymbol: null });

  const startFrom = (id: string, opts?: Record<string, OptionValue>) => {
    setFrom(id);
    const src =
      builtinSymbols.find((s) => s.id === id) ??
      ed.project.symbols.get(id) ??
      libSymbols.find((s) => s.id === id);
    if (!src) return;
    const g = resolveSymbol(
      src,
      meta.standard,
      isStatic(src) ? {} : { ...defaultOptions(src), ...opts },
    );
    setPrims(JSON.parse(JSON.stringify(g.prims)) as Primitive[]);
    setPins(JSON.parse(JSON.stringify(g.pins)) as PinDef[]);
    setParams({
      defaultValue: src.defaultValue,
      hideValueLabel: src.hideValueLabel,
      params: src.params,
    });
    if (!existing) {
      setName(`${src.name} (custom)`);
      setRefPrefix(src.refPrefix || 'X');
    }
    setSel(null);
  };

  useEffect(() => {
    if (editing?.from) startFrom(editing.from, editing.opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gridPt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S + VIEW.x, y: (e.clientY - r.top) / S + VIEW.y };
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    svgRef.current?.setPointerCapture(e.pointerId);
    const raw = gridPt(e);
    const p = { x: snapHalf(raw.x), y: snapHalf(raw.y) };
    const target = (e.target as Element).closest('[data-kind]');
    if (tool === 'select') {
      if (target) {
        const kind = target.getAttribute('data-kind') as 'prim' | 'pin';
        const i = Number(target.getAttribute('data-i'));
        setSel({ kind, i });
        drag.current = { start: p, orig: kind === 'prim' ? prims[i]! : pins[i]! };
      } else setSel(null);
      return;
    }
    if (tool === 'pin') {
      const x = Math.round(raw.x);
      const y = Math.round(raw.y);
      if (pins.some((q) => q.x === x && q.y === y)) return;
      let n = pins.length + 1;
      while (pins.some((q) => q.id === String(n))) n++;
      setPins([...pins, { id: String(n), x, y }]);
      setSel({ kind: 'pin', i: pins.length });
      return;
    }
    if (tool === 'text') {
      setPrims([...prims, { k: 'text', x: p.x, y: p.y, t: 'A', size: 1.2 }]);
      setSel({ kind: 'prim', i: prims.length });
      setTool('select');
      return;
    }
    if (tool === 'poly') {
      if (draft?.k === 'poly') {
        const n = draft.pts.length;
        if (draft.pts[n - 4] === p.x && draft.pts[n - 3] === p.y) {
          // Click on the last point again: finish.
          const pts = draft.pts.slice(0, -2);
          if (pts.length >= 4) setPrims([...prims, { ...draft, pts }]);
          setDraft(null);
          return;
        }
        setDraft({ ...draft, pts: [...draft.pts.slice(0, -2), p.x, p.y, p.x, p.y] });
      } else setDraft({ k: 'poly', pts: [p.x, p.y, p.x, p.y] });
      return;
    }
    if (tool === 'line') setDraft({ k: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    if (tool === 'rect') setDraft({ k: 'rect', x: p.x, y: p.y, w: 0, h: 0 });
    if (tool === 'circle') setDraft({ k: 'circle', cx: p.x, cy: p.y, r: 0 });
    drag.current = { start: p, orig: { k: 'line', x1: 0, y1: 0, x2: 0, y2: 0 } };
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const raw = gridPt(e);
    const p = { x: snapHalf(raw.x), y: snapHalf(raw.y) };
    if (draft?.k === 'poly') {
      const pts = [...draft.pts];
      pts[pts.length - 2] = p.x;
      pts[pts.length - 1] = p.y;
      setDraft({ ...draft, pts });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (draft?.k === 'line') setDraft({ ...draft, x2: p.x, y2: p.y });
    else if (draft?.k === 'rect') {
      const s = d.start;
      setDraft({
        ...draft,
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      });
    } else if (draft?.k === 'circle')
      setDraft({ ...draft, r: snapHalf(Math.hypot(p.x - d.start.x, p.y - d.start.y)) });
    else if (tool === 'select' && sel) {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (sel.kind === 'prim')
        setPrims(prims.map((q, i) => (i === sel.i ? movePrim(d.orig as Primitive, dx, dy) : q)));
      else {
        const o = d.orig as PinDef;
        setPins(
          pins.map((q, i) =>
            i === sel.i ? { ...q, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : q,
          ),
        );
      }
    }
  };

  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    svgRef.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
    if (!draft || draft.k === 'poly') return;
    const ok =
      (draft.k === 'line' && (draft.x1 !== draft.x2 || draft.y1 !== draft.y2)) ||
      (draft.k === 'rect' && draft.w > 0 && draft.h > 0) ||
      (draft.k === 'circle' && draft.r > 0);
    if (ok) setPrims([...prims, draft]);
    setDraft(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        if (sel.kind === 'prim') setPrims(prims.filter((_, i) => i !== sel.i));
        else setPins(pins.filter((_, i) => i !== sel.i));
        setSel(null);
      }
      if (e.key === 'Enter' && draft?.k === 'poly') {
        const pts = draft.pts.slice(0, -2);
        if (pts.length >= 4) setPrims([...prims, { ...draft, pts }]);
        setDraft(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, prims, pins, draft]);

  const ink = { color: theme.ink, paper: theme.paper, width: DEFAULT_STROKE * 1.3 };
  const selPrim = sel?.kind === 'prim' ? prims[sel.i] : undefined;
  const selPin = sel?.kind === 'pin' ? pins[sel.i] : undefined;
  const updPrim = (patch: Record<string, unknown>) =>
    sel?.kind === 'prim' &&
    setPrims(prims.map((q, i) => (i === sel.i ? ({ ...q, ...patch } as Primitive) : q)));
  const bbox = useMemo(() => primsBBox(prims, pins), [prims, pins]);

  const save = () => {
    if (!prims.length) return;
    const id = existing?.id ?? `custom-${newId(8)}`;
    const def: StaticSymbolDef = {
      id,
      name: name.trim() || 'Custom symbol',
      category: category.trim() || 'Custom',
      refPrefix: refPrefix.trim(),
      graphics: { prims, pins },
      ...(params.defaultValue ? { defaultValue: params.defaultValue } : {}),
      ...(params.hideValueLabel ? { hideValueLabel: true } : {}),
      ...(params.params ? { params: params.params } : {}),
    };
    if (scope === 'library') useUserLib.getState().saveSymbol(def);
    else if (inLibrary) useUserLib.getState().removeSymbol(id);
    ed.commit(() => {
      // Library symbols are copied into the project when used: keep that copy up to date.
      if (scope === 'project' || ed.project.symbols.has(id) || editing?.replaceId)
        ed.project.symbols.set(id, def);
      if (editing?.replaceId) ed.updateElement(editing.replaceId, { symbolId: id, opts: {} });
    });
    close();
  };

  const remove = () => {
    if (!existing) return;
    if (inLibrary) {
      if (!confirm(`Remove “${existing.name}” from your library? (Projects keep their copy)`))
        return;
      useUserLib.getState().removeSymbol(existing.id);
      close();
      return;
    }
    const used = ed.project
      .listSheets()
      .some((s) =>
        ed.project
          .getElements(s.id)
          .some((e) => e.type === 'component' && e.symbolId === existing.id),
      );
    if (
      used &&
      !confirm(
        'This symbol is used in the project. Delete it anyway? (Parts using it will show a “?”)',
      )
    )
      return;
    ed.commit(() => ed.project.symbols.delete(existing.id));
    close();
  };

  const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Select / move (Delete removes)', icon: <MousePointer2 size={16} /> },
    { id: 'line', label: 'Line', icon: <Minus size={16} /> },
    {
      id: 'poly',
      label: 'Polyline (click points, click the last point again to finish)',
      icon: <Spline size={16} />,
    },
    { id: 'rect', label: 'Rectangle', icon: <Square size={16} /> },
    { id: 'circle', label: 'Circle', icon: <Circle size={16} /> },
    { id: 'text', label: 'Text', icon: <Type size={16} /> },
    { id: 'pin', label: 'Pin (connection point)', icon: <Pin size={16} /> },
  ];

  return (
    <Modal title={existing ? `Edit symbol — ${existing.name}` : 'New symbol'} onClose={close} wide>
      <div className="symed">
        <div className="symed-tools">
          {tools.map((t) => (
            <IconButton
              key={t.id}
              title={t.label}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
              testId={`symed-${t.id}`}
            >
              {t.icon}
            </IconButton>
          ))}
        </div>
        <svg
          ref={svgRef}
          className="symed-canvas"
          data-testid="symed-canvas"
          width={VIEW.w * S}
          height={VIEW.h * S}
          viewBox={`${VIEW.x * 10} ${VIEW.y * 10} ${VIEW.w * 10} ${VIEW.h * 10}`}
          style={{ background: theme.paper }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {Array.from({ length: VIEW.w * 2 + 1 }, (_, i) => {
            const x = (VIEW.x + i / 2) * 10;
            const major = i % 2 === 0;
            return (
              <line
                key={`v${i}`}
                x1={x}
                y1={VIEW.y * 10}
                x2={x}
                y2={(VIEW.y + VIEW.h) * 10}
                stroke={major ? theme.gridMajor : theme.gridMinor}
                strokeWidth={major ? 0.4 : 0.25}
              />
            );
          })}
          {Array.from({ length: VIEW.h * 2 + 1 }, (_, i) => {
            const y = (VIEW.y + i / 2) * 10;
            const major = i % 2 === 0;
            return (
              <line
                key={`h${i}`}
                x1={VIEW.x * 10}
                y1={y}
                x2={(VIEW.x + VIEW.w) * 10}
                y2={y}
                stroke={major ? theme.gridMajor : theme.gridMinor}
                strokeWidth={major ? 0.4 : 0.25}
              />
            );
          })}
          <g stroke={theme.select} strokeWidth={0.4}>
            <line x1={-6} y1={0} x2={6} y2={0} />
            <line x1={0} y1={-6} x2={0} y2={6} />
          </g>
          {prims.map((p, i) => (
            <g key={i} data-kind="prim" data-i={i} className="symed-prim">
              {p.k === 'text' ? (
                <SymbolText
                  p={p}
                  x={p.x * 10}
                  y={p.y * 10}
                  color={theme.ink}
                  params={{ value: 'value' }}
                />
              ) : (
                <SymbolShapes prims={[p]} ink={ink} />
              )}
              {sel?.kind === 'prim' && sel.i === i && <SelBox p={p} color={theme.select} />}
            </g>
          ))}
          {draft && <SymbolShapes prims={[draft]} ink={{ ...ink, color: theme.select }} />}
          {pins.map((p, i) => (
            <g key={p.id} data-kind="pin" data-i={i}>
              <circle
                cx={p.x * 10}
                cy={p.y * 10}
                r={2.6}
                fill={sel?.kind === 'pin' && sel.i === i ? theme.select : 'none'}
                stroke={theme.select}
                strokeWidth={0.8}
              />
              <text x={p.x * 10 + 3} y={p.y * 10 - 3} fontSize={4.5} fill={theme.select}>
                {p.id}
              </text>
            </g>
          ))}
        </svg>
        <div className="symed-side">
          <Field label="Start from a built-in symbol">
            <select
              value={from}
              onChange={(e) => startFrom(e.target.value)}
              data-testid="symed-from"
            >
              <option value="">—</option>
              {builtinSymbols.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.category} · {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="symed-name"
            />
          </Field>
          <div className="row">
            <Field label="Reference prefix">
              <input value={refPrefix} onChange={(e) => setRefPrefix(e.target.value)} />
            </Field>
            <Field label="Category (pick or type)">
              <input
                list="symbol-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid="symed-category"
              />
              <datalist id="symbol-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Save in">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'project' | 'library')}
              data-testid="symed-scope"
            >
              <option value="library">My library (every project)</option>
              <option value="project">This project only</option>
            </select>
          </Field>
          {selPrim && selPrim.k !== 'text' && (
            <>
              <h3>Shape</h3>
              <div className="row">
                <Field label="Stroke ×">
                  <input
                    type="number"
                    min={0}
                    max={4}
                    step={0.1}
                    value={selPrim.sw ?? 1}
                    onChange={(e) => updPrim({ sw: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Fill">
                  <select
                    value={selPrim.fill ?? 'none'}
                    onChange={(e) =>
                      updPrim({ fill: e.target.value === 'none' ? undefined : e.target.value })
                    }
                  >
                    <option value="none">None</option>
                    <option value="ink">Ink</option>
                    <option value="paper">Paper (opaque)</option>
                  </select>
                </Field>
              </div>
              <Field label="Line">
                <select
                  value={selPrim.dash ?? ''}
                  onChange={(e) => updPrim({ dash: e.target.value || undefined })}
                >
                  <option value="">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </Field>
              {selPrim.k === 'poly' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(selPrim.closed)}
                    onChange={(e) => updPrim({ closed: e.target.checked || undefined })}
                  />
                  Closed
                </label>
              )}
            </>
          )}
          {selPrim?.k === 'text' && (
            <>
              <h3>Text</h3>
              <Field label="Content ({value} = part value)">
                <input
                  value={selPrim.t}
                  onChange={(e) => updPrim({ t: e.target.value })}
                  data-testid="symed-text"
                />
              </Field>
              <div className="row">
                <Field label="Size">
                  <input
                    type="number"
                    min={0.4}
                    max={4}
                    step={0.1}
                    value={selPrim.size ?? 1.2}
                    onChange={(e) => updPrim({ size: Number(e.target.value) })}
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(selPrim.math)}
                    onChange={(e) => updPrim({ math: e.target.checked || undefined })}
                  />
                  LaTeX
                </label>
              </div>
            </>
          )}
          {selPin && (
            <>
              <h3>Pin</h3>
              <div className="row">
                <Field label="Id">
                  <input
                    value={selPin.id}
                    onChange={(e) =>
                      setPins(pins.map((q) => (q === selPin ? { ...q, id: e.target.value } : q)))
                    }
                  />
                </Field>
                <Field label="Name">
                  <input
                    value={selPin.name ?? ''}
                    onChange={(e) =>
                      setPins(
                        pins.map((q) =>
                          q === selPin ? { ...q, name: e.target.value || undefined } : q,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            </>
          )}
          {sel && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (sel.kind === 'prim') setPrims(prims.filter((_, i) => i !== sel.i));
                else setPins(pins.filter((_, i) => i !== sel.i));
                setSel(null);
              }}
            >
              <Trash size={14} /> Delete selected
            </button>
          )}
          <h3>Preview</h3>
          <div className="symed-preview">
            {prims.length ? (
              <SymbolPreview prims={prims} bbox={bbox} ink={ink} size={90} params={{ value: '' }} />
            ) : (
              <span className="muted small">Draw something…</span>
            )}
            <span className="muted small">
              {prims.length} shapes · {pins.length} pins
            </span>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        {existing && (
          <button type="button" className="btn" onClick={remove}>
            <Trash size={14} /> Delete symbol
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={save}
          disabled={!prims.length}
          data-testid="symed-save"
        >
          {scope === 'library' ? 'Save to my library' : 'Save to project'}
        </button>
      </div>
    </Modal>
  );
}

function SelBox({ p, color }: { p: Primitive; color: string }) {
  const b = primsBBox([p]);
  return (
    <rect
      x={b.x * 10 - 2}
      y={b.y * 10 - 2}
      width={b.w * 10 + 4}
      height={b.h * 10 + 4}
      fill="none"
      stroke={color}
      strokeWidth={0.6}
      strokeDasharray="2 1.5"
    />
  );
}
