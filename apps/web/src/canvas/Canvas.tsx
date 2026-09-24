import {
  GRID,
  computeMove,
  dragSegment,
  expandSelection,
  inflate,
  elementBBox,
  rectUnion,
  type ComponentElement,
  type Element,
  type Id,
  type Pt,
} from '@overleagger/core';
import { getBuiltinSymbol, defaultOptions, defaultParams } from '@overleagger/symbols';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as RPointerEvent,
} from 'react';
import { useEditor, useMeta, useSheetElements } from '../editor/context';
import { useUI } from '../store/ui';
import { THEMES } from '../theme';
import { InlineEditor } from './InlineEditor';
import { ComponentView, type RenderOptions } from './render/ElementViews';
import { SheetRenderer } from './render/SheetRenderer';
import { ToolController, activeTools, wireDraftPoints, type PointerInfo } from './tools';

export const SYMBOL_DND_TYPE = 'application/x-overleagger-symbol';

function targetId(t: EventTarget | null): Id | null {
  const el = (t as Element | null) && (t as unknown as HTMLElement).closest?.('[data-id]');
  return el ? el.getAttribute('data-id') : null;
}

export function Canvas() {
  const ed = useEditor();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tools = useMemo(() => new ToolController(ed), [ed]);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const elements = useSheetElements(sheetId);
  const themeName = useUI((s) => s.theme);
  const theme = THEMES[themeName];
  const latexRefs = useUI((s) => s.latexRefs);
  const showGrid = useUI((s) => s.showGrid);
  const tool = useUI((s) => s.tool);
  const spaceDown = useUI((s) => s.spaceDown);
  const hoverPin = useUI((s) => s.hoverPin);
  const drag = useUI((s) => s.drag);
  const storedVp = useUI((s) => s.viewports[sheetId]);
  const meta = useMeta();
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const size = measured ?? { w: 0, h: 0 };
  const [panning, setPanning] = useState(false);

  const vp = storedVp ?? { x: size.w / 2, y: size.h / 2, zoom: 1 };

  const o: RenderOptions = useMemo(
    () => ({ theme, ctx: ed.ctx, interactive: true, latexRefs, standard: meta.standard }),
    [theme, ed.ctx, latexRefs, meta.standard],
  );

  // Elements with the live drag preview applied.
  const effective = useMemo(() => {
    if (!drag || (!drag.dx && !drag.dy)) return elements;
    let changed: Element[];
    if (drag.segment) {
      const w = elements.find((e) => e.id === drag.segment!.wireId);
      changed =
        w?.type === 'wire'
          ? [{ ...w, pts: dragSegment(w, drag.segment.index, drag.dx, drag.dy) }]
          : [];
    } else {
      changed = computeMove(
        elements,
        expandSelection(elements, drag.ids),
        drag.dx,
        drag.dy,
        ed.ctx,
      );
    }
    const map = new Map(changed.map((e) => [e.id, e]));
    return elements.map((e) => map.get(e.id) ?? e);
  }, [elements, drag, ed.ctx]);

  // Track the canvas size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      ed.canvasSize = { w: r.width, h: r.height };
      setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ed]);

  // Fit the view the first time a sheet is shown.
  const hasSize = measured !== null;
  useEffect(() => {
    if (hasSize && !useUI.getState().viewports[sheetId]) ed.fit(sheetId);
  }, [ed, sheetId, hasSize]);

  const info = useCallback(
    (e: {
      clientX: number;
      clientY: number;
      button: number;
      shiftKey: boolean;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      target: EventTarget | null;
    }): PointerInfo => {
      const r = svgRef.current!.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      const v = ed.viewport();
      return {
        screen,
        world: { x: (screen.x - v.x) / v.zoom, y: (screen.y - v.y) / v.zoom },
        button: e.button,
        shift: e.shiftKey,
        alt: e.altKey,
        mod: e.ctrlKey || e.metaKey,
        targetId: targetId(e.target),
      };
    },
    [ed],
  );

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (useUI.getState().inlineEdit) useUI.getState().set({ inlineEdit: null });
    (document.activeElement as HTMLElement | null)?.blur?.();
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = info(e);
    if (e.button === 1 || useUI.getState().spaceDown || useUI.getState().tool === 'pan')
      setPanning(true);
    tools.down(p);
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => tools.move(info(e));
  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    svgRef.current?.releasePointerCapture(e.pointerId);
    setPanning(false);
    tools.up(info(e));
  };
  const onPointerLeave = () => useUI.getState().set({ cursor: null, hoverPin: null, ghost: null });

  // Wheel: pan, or zoom with Ctrl/⌘ (also trackpad pinch).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        ed.zoomAt(Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        const v = ed.viewport();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        ed.setViewport({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [ed]);

  // Tool controller is also driven by keyboard shortcuts (wire finishing, bend flip).
  useEffect(() => {
    activeTools.current = tools;
    return () => {
      if (activeTools.current === tools) activeTools.current = null;
    };
  }, [tools]);

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(SYMBOL_DND_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: DragEvent) => {
    const symbolId = e.dataTransfer.getData(SYMBOL_DND_TYPE);
    if (!symbolId) return;
    e.preventDefault();
    const p = info({ ...e, button: 0, target: null });
    const el = ed.placeComponent(symbolId, {
      x: Math.round(p.world.x / GRID) * GRID,
      y: Math.round(p.world.y / GRID) * GRID,
    });
    ed.select([el.id]);
  };

  const cursor = panning
    ? 'grabbing'
    : spaceDown || tool === 'pan'
      ? 'grab'
      : hoverPin || tool !== 'select'
        ? 'crosshair'
        : 'default';

  // Visible world rectangle (for the grid).
  const world = {
    x: -vp.x / vp.zoom,
    y: -vp.y / vp.zoom,
    w: size.w / vp.zoom,
    h: size.h / vp.zoom,
  };
  const minorVisible = vp.zoom * GRID >= 6;

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ background: theme.paper }}
    >
      <svg
        ref={svgRef}
        className="canvas"
        data-testid="canvas"
        width={size.w}
        height={size.h}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid-minor" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path
              d={`M ${GRID} 0 L 0 0 0 ${GRID}`}
              fill="none"
              stroke={theme.gridMinor}
              strokeWidth={1 / vp.zoom}
            />
          </pattern>
          <pattern id="grid-major" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
            <path
              d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`}
              fill="none"
              stroke={theme.gridMajor}
              strokeWidth={1.2 / vp.zoom}
            />
          </pattern>
        </defs>
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.zoom})`}>
          {showGrid && (
            <g pointerEvents="none">
              {minorVisible && (
                <rect
                  x={world.x}
                  y={world.y}
                  width={world.w}
                  height={world.h}
                  fill="url(#grid-minor)"
                />
              )}
              <rect
                x={world.x}
                y={world.y}
                width={world.w}
                height={world.h}
                fill="url(#grid-major)"
              />
            </g>
          )}
          <SheetRenderer elements={effective} o={o} />
          <Overlay elements={effective} o={o} zoom={vp.zoom} />
        </g>
      </svg>
      <InlineEditor vp={vp} />
    </div>
  );
}

function Overlay({ elements, o, zoom }: { elements: Element[]; o: RenderOptions; zoom: number }) {
  const ed = useEditor();
  const selection = useUI((s) => s.selection);
  const marquee = useUI((s) => s.marquee);
  const wireDraft = useUI((s) => s.wireDraft);
  const ghost = useUI((s) => s.ghost);
  const tool = useUI((s) => s.tool);
  const placing = useUI((s) => s.placing);
  const blockDraft = useUI((s) => s.blockDraft);
  const hoverPin = useUI((s) => s.hoverPin);
  const accent = o.theme.accent;
  const sw = 1 / zoom;

  const boxes = useMemo(() => {
    const byId = new Map(elements.map((e) => [e.id, e]));
    return selection
      .map((id) => byId.get(id))
      .filter((e): e is Element => Boolean(e))
      .map((e) => {
        if (e.type === 'wire') return { id: e.id, wire: e.pts };
        const members =
          e.type === 'group'
            ? elements.filter(
                (m) => expandSelection(elements, [e.id]).has(m.id) && m.type !== 'group',
              )
            : [e];
        const r = rectUnion(members.map((m) => elementBBox(m, o.ctx, elements)));
        return r ? { id: e.id, rect: inflate(r, 4) } : null;
      })
      .filter(Boolean) as {
      id: Id;
      rect?: { x: number; y: number; w: number; h: number };
      wire?: number[];
    }[];
  }, [selection, elements, o.ctx]);

  const ghostEl: ComponentElement | null = useMemo(() => {
    if (tool !== 'place' || !placing || !ghost) return null;
    const sym = getBuiltinSymbol(placing.symbolId) ?? ed.ctx.symbol(placing.symbolId);
    if (!sym) return null;
    return {
      id: '__ghost',
      type: 'component',
      z: 0,
      symbolId: placing.symbolId,
      x: ghost.x,
      y: ghost.y,
      rot: placing.rot,
      mirror: placing.mirror,
      opts: { ...defaultOptions(sym), ...placing.opts },
      params: defaultParams(sym),
      ref: sym.refPrefix ? `${sym.refPrefix}?` : '',
    };
  }, [tool, placing, ghost, ed.ctx]);

  const ghostO = useMemo(() => ({ ...o, interactive: false }), [o]);

  return (
    <g className="overlay" pointerEvents="none">
      {boxes.map((b) =>
        b.wire ? (
          <polyline
            key={b.id}
            points={b.wire.join(' ')}
            fill="none"
            stroke={accent}
            strokeOpacity={0.35}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <rect
            key={b.id}
            x={b.rect!.x}
            y={b.rect!.y}
            width={b.rect!.w}
            height={b.rect!.h}
            fill={o.theme.accentSoft}
            stroke={accent}
            strokeWidth={sw}
            strokeDasharray={`${4 * sw} ${3 * sw}`}
            rx={3 * sw}
          />
        ),
      )}
      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill={o.theme.accentSoft}
          stroke={accent}
          strokeWidth={sw}
          strokeDasharray={`${5 * sw} ${3 * sw}`}
        />
      )}
      {wireDraft && (
        <>
          <polyline
            points={wireDraftPoints(wireDraft).join(' ')}
            fill="none"
            stroke={o.theme.ink}
            strokeOpacity={0.75}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={wireDraft.cursor.x}
            cy={wireDraft.cursor.y}
            r={3 * sw + 1.5}
            fill="none"
            stroke={accent}
            strokeWidth={sw}
          />
        </>
      )}
      {ghostEl && (
        <g opacity={0.5}>
          <ComponentView el={ghostEl} o={ghostO} />
        </g>
      )}
      {ghost &&
        (tool === 'wire' ||
          tool === 'signal' ||
          tool === 'port' ||
          tool === 'label' ||
          tool === 'text' ||
          tool === 'block') &&
        !wireDraft && <Crosshair p={ghost} color={accent} sw={sw} />}
      {blockDraft && (
        <rect
          x={blockDraft.x}
          y={blockDraft.y}
          width={blockDraft.w}
          height={blockDraft.h}
          fill={o.theme.accentSoft}
          stroke={accent}
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      )}
      {hoverPin && (
        <circle
          cx={hoverPin.x}
          cy={hoverPin.y}
          r={4.5}
          fill="none"
          stroke={accent}
          strokeWidth={1.6}
        />
      )}
    </g>
  );
}

function Crosshair({ p, color, sw }: { p: Pt; color: string; sw: number }) {
  const s = 6;
  return (
    <g stroke={color} strokeWidth={sw}>
      <line x1={p.x - s} y1={p.y} x2={p.x + s} y2={p.y} />
      <line x1={p.x} y1={p.y - s} x2={p.x} y2={p.y + s} />
    </g>
  );
}
