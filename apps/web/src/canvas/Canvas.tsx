import {
  anchorPoints,
  elbowRoute,
  followConnectors,
  GRID,
  HANDLES,
  computeMove,
  dragSegment,
  elementBBox,
  expandSelection,
  handlePos,
  inflate,
  isBox,
  lineControlPoint,
  rectUnion,
  snap,
  type ComponentElement,
  type Element,
  type Pt,
  type Rect,
} from '@overleagger/core';
import { defaultOptions, defaultParams, getBuiltinSymbol } from '@overleagger/symbols';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as RPointerEvent,
} from 'react';
import { useEditor, useMeta, useSheetElements, useSymbolsVersion } from '../editor/context';
import { CommentPins, CommentPopover } from '../comments/Comments';
import { RemoteOverlay } from '../cloud/Presence';
import { useFollow, usePresencePublisher } from '../cloud/presenceHooks';
import { useUserLib } from '../storage/userLibrary';
import { useUI } from '../store/ui';
import { THEMES, resolveColor, type Theme } from '../theme';
import { InlineEditor } from './InlineEditor';
import { ComponentView, type RenderOptions } from './render/ElementViews';
import { SheetRenderer } from './render/SheetRenderer';
import { strokePath } from './render/shapes';
import {
  PICK_IMAGE_EVENT,
  ToolController,
  activeTools,
  wireDraftPoints,
  type PointerInfo,
} from './tools';
import { ToolOptions } from './ToolOptions';
import { TEMPLATE_DND_TYPE } from '../panels/TemplatesPanel';

export const SYMBOL_DND_TYPE = 'application/x-overleagger-symbol';

function closestAttr(t: EventTarget | null, attr: string): string | null {
  const el = (t as HTMLElement | null)?.closest?.(`[${attr}]`);
  return el ? el.getAttribute(attr) : null;
}

export function Canvas() {
  const ed = useEditor();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickAt = useRef<Pt | null>(null);
  const tools = useMemo(() => new ToolController(ed), [ed]);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const elements = useSheetElements(sheetId);
  const theme = THEMES[useUI((s) => s.theme)];
  const latexRefs = useUI((s) => s.latexRefs);
  const showGrid = useUI((s) => s.showGrid);
  const tool = useUI((s) => s.tool);
  const spaceDown = useUI((s) => s.spaceDown);
  const hoverPin = useUI((s) => s.hoverPin);
  const drag = useUI((s) => s.drag);
  const resize = useUI((s) => s.resize);
  const erasing = useUI((s) => s.erasing);
  const animations = useUI((s) => s.animations);
  usePresencePublisher();
  const followTarget = useFollow();
  const storedVp = useUI((s) => s.viewports[sheetId]);
  const meta = useMeta();
  const symbolsVersion = useSymbolsVersion();
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const size = measured ?? { w: 0, h: 0 };
  const [panning, setPanning] = useState(false);

  const vp = storedVp ?? { x: size.w / 2, y: size.h / 2, zoom: 1 };

  const o: RenderOptions = useMemo(
    () => ({
      theme,
      ctx: ed.ctx,
      interactive: true,
      latexRefs,
      standard: meta.standard,
      symbolsVersion,
    }),
    [theme, ed.ctx, latexRefs, meta.standard, symbolsVersion],
  );

  // Elements with the live previews (drag, segment drag, resize) applied.
  const effective = useMemo(() => {
    let changed: Element[] = [];
    if (drag && (drag.dx || drag.dy)) {
      if (drag.segment) {
        const w = elements.find((e) => e.id === drag.segment!.wireId);
        if (w?.type === 'wire')
          changed = [{ ...w, pts: dragSegment(w, drag.segment.index, drag.dx, drag.dy) }];
      } else {
        changed = computeMove(
          elements,
          expandSelection(elements, drag.ids),
          drag.dx,
          drag.dy,
          ed.ctx,
        );
      }
    }
    if (resize) {
      const el = elements.find((e) => e.id === resize.id);
      if (el) {
        const patch: Record<string, unknown> = {};
        if (resize.rect) Object.assign(patch, resize.rect);
        if (resize.pts) patch.pts = resize.pts;
        if (resize.bend !== undefined) patch.bend = resize.bend;
        changed.push({ ...el, ...patch } as Element);
      }
    }
    if (!changed.length) return elements;
    const map = new Map(changed.map((e) => [e.id, e]));
    // Connectors attached to resized shapes follow.
    if (resize) for (const l of followConnectors(elements, changed)) map.set(l.id, l);
    return elements.map((e) => map.get(e.id) ?? e);
  }, [elements, drag, resize, ed.ctx]);

  const hidden = useMemo(() => new Set(erasing), [erasing]);

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

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      const v = ed.viewport();
      const screen = { x: clientX - r.left, y: clientY - r.top };
      return { screen, world: { x: (screen.x - v.x) / v.zoom, y: (screen.y - v.y) / v.zoom } };
    },
    [ed],
  );

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
      pressure?: number;
      pointerType?: string;
    }): PointerInfo => {
      const { screen, world } = toWorld(e.clientX, e.clientY);
      return {
        screen,
        world,
        button: e.button,
        shift: e.shiftKey,
        alt: e.altKey,
        mod: e.ctrlKey || e.metaKey,
        targetId: closestAttr(e.target, 'data-id'),
        handle: closestAttr(e.target, 'data-handle'),
        pressure: e.pointerType === 'pen' && e.pressure ? e.pressure : 0.5,
        hitTest: () => closestAttr(document.elementFromPoint(e.clientX, e.clientY), 'data-id'),
      };
    },
    [toWorld],
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
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    // Pens and fast mice: use coalesced events for smooth freehand strokes.
    const native = e.nativeEvent;
    const list =
      useUI.getState().strokeDraft && native.getCoalescedEvents ? native.getCoalescedEvents() : [];
    if (list.length > 1) {
      // Copy the fields explicitly: `{ ...event }` would lose clientX/clientY, which are
      // prototype getters (this used to turn every pencil point into NaN).
      for (const c of list)
        tools.move(
          info({
            clientX: c.clientX,
            clientY: c.clientY,
            button: e.button,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            target: e.target,
            pressure: c.pressure,
            pointerType: e.pointerType,
          }),
        );
    } else tools.move(info(e));
  };
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

  // Keyboard shortcuts drive the mounted tool controller (wire finishing, bend flip).
  useEffect(() => {
    activeTools.current = tools;
    return () => {
      if (activeTools.current === tools) activeTools.current = null;
    };
  }, [tools]);

  // Image tool → file picker; images pasted from the clipboard.
  useEffect(() => {
    const onPick = (e: Event) => {
      pickAt.current = (e as CustomEvent<Pt>).detail;
      fileRef.current?.click();
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void ed.insertImage(file, useUI.getState().cursor ?? ed.viewCenter());
    };
    window.addEventListener(PICK_IMAGE_EVENT, onPick);
    document.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener(PICK_IMAGE_EVENT, onPick);
      document.removeEventListener('paste', onPaste, true);
    };
  }, [ed]);

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer.types;
    if (
      types.includes(SYMBOL_DND_TYPE) ||
      types.includes(TEMPLATE_DND_TYPE) ||
      types.includes('Files')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: DragEvent) => {
    const at = toWorld(e.clientX, e.clientY).world;
    const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (images.length) {
      e.preventDefault();
      images.forEach((f, i) => void ed.insertImage(f, { x: at.x + i * 30, y: at.y + i * 30 }));
      return;
    }
    const templateId = e.dataTransfer.getData(TEMPLATE_DND_TYPE);
    const template = useUserLib.getState().templates.find((t) => t.id === templateId);
    if (template) {
      e.preventDefault();
      ed.insertTemplate(template, at);
      return;
    }
    const symbolId = e.dataTransfer.getData(SYMBOL_DND_TYPE);
    if (!symbolId) return;
    e.preventDefault();
    const el = ed.placeComponent(symbolId, { x: snap(at.x, GRID), y: snap(at.y, GRID) });
    ed.select([el.id]);
  };

  const cursor = panning
    ? 'grabbing'
    : spaceDown || tool === 'pan'
      ? 'grab'
      : tool === 'eraser'
        ? 'cell'
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
      // Overlays (popups, inline editors) must never scroll the drawing area.
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0;
        e.currentTarget.scrollTop = 0;
      }}
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
        data-anim={animations ? 'on' : 'off'}
        data-busy={drag || resize ? 'drag' : undefined}
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
          <g key={sheetId} className="sheet-enter">
            <SheetRenderer elements={effective} o={o} hidden={hidden} />
          </g>
          <g
            className="fx-layer"
            pointerEvents="none"
            style={{ '--fx-ink': theme.ink, '--fx-sel': theme.select } as CSSProperties}
          />
          <Overlay elements={effective} o={o} zoom={vp.zoom} />
          <RemoteOverlay elements={effective} o={o} zoom={vp.zoom} />
          <CommentPins zoom={vp.zoom} />
        </g>
      </svg>
      <CommentPopover vp={vp} />
      {followTarget && (
        <div
          className="follow-frame"
          style={{ ['--c' as string]: followTarget.user.color }}
          data-testid="follow-frame"
        >
          <span>
            Following {followTarget.user.name}
            <button type="button" onClick={() => ed.session?.state.setState({ following: null })}>
              Stop
            </button>
          </span>
        </div>
      )}
      <ToolOptions />
      <InlineEditor vp={vp} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="image-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void ed.insertImage(f, pickAt.current ?? ed.viewCenter());
          e.target.value = '';
          useUI.getState().setTool('select');
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay: selection, handles and previews (drawn in "non-photo blue" like drafting marks)
// ---------------------------------------------------------------------------

/** Corner brackets around a rectangle, like registration marks on a technical drawing. */
function Brackets({ r, color, sw, len }: { r: Rect; color: string; sw: number; len: number }) {
  const l = Math.min(len, r.w / 2, r.h / 2);
  const { x, y, w, h } = r;
  const d = [
    `M ${x} ${y + l} V ${y} H ${x + l}`,
    `M ${x + w - l} ${y} H ${x + w} V ${y + l}`,
    `M ${x + w} ${y + h - l} V ${y + h} H ${x + w - l}`,
    `M ${x + l} ${y + h} H ${x} V ${y + h - l}`,
  ].join(' ');
  return (
    <path
      className="brackets"
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={sw * 1.6}
      strokeLinecap="square"
    />
  );
}

/** Small "↗" tag on the corner of elements that carry a link (Ctrl+click follows it). */
function LinkBadges({
  elements,
  o,
  zoom,
}: {
  elements: Element[];
  o: RenderOptions;
  zoom: number;
}) {
  const k = 1 / zoom;
  return (
    <>
      {elements
        .filter((e) => e.link && e.type !== 'button' && e.type !== 'group')
        .map((e) => {
          const b = elementBBox(e, o.ctx, elements);
          const x = b.x + b.w;
          const y = b.y;
          const r = 6.5 * k;
          return (
            <g key={e.id} className="link-badge" transform={`translate(${x} ${y})`}>
              <title>{e.link!.kind === 'url' ? e.link!.url : 'Link to a sheet'}</title>
              <circle r={r} fill={o.theme.paper} stroke={o.theme.select} strokeWidth={1.2 * k} />
              <path
                d={`M ${-2.4 * k} ${2.4 * k} L ${2.4 * k} ${-2.4 * k} M ${-0.6 * k} ${-2.4 * k} H ${2.4 * k} V ${0.6 * k}`}
                fill="none"
                stroke={o.theme.select}
                strokeWidth={1.3 * k}
                strokeLinecap="round"
              />
            </g>
          );
        })}
    </>
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
  const rectDraft = useUI((s) => s.rectDraft);
  const lineDraft = useUI((s) => s.lineDraft);
  const lineDraftEnds = useUI((s) => s.lineDraftEnds);
  const anchorHover = useUI((s) => s.anchorHover);
  const anchorEl = anchorHover ? elements.find((e) => e.id === anchorHover) : undefined;
  const strokeDraft = useUI((s) => s.strokeDraft);
  const prefs = useUI((s) => s.prefs);
  const hoverPin = useUI((s) => s.hoverPin);
  const t: Theme = o.theme;
  const sel = t.select;
  const sw = 1 / zoom;

  const boxes = useMemo(() => {
    const byId = new Map(elements.map((e) => [e.id, e]));
    return selection
      .map((id) => byId.get(id))
      .filter((e): e is Element => Boolean(e))
      .map((e) => {
        if (e.type === 'wire') return { el: e, wire: e.pts };
        const members =
          e.type === 'group'
            ? elements.filter(
                (m) => expandSelection(elements, [e.id]).has(m.id) && m.type !== 'group',
              )
            : [e];
        const r = rectUnion(members.map((m) => elementBBox(m, o.ctx, elements)));
        return r ? { el: e, rect: r } : null;
      })
      .filter(Boolean) as { el: Element; rect?: Rect; wire?: number[] }[];
  }, [selection, elements, o.ctx]);

  const single = boxes.length === 1 ? boxes[0]!.el : null;

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
  const hs = 7 / zoom; // handle size
  const inkColor = resolveColor(prefs.inkColor, t);

  return (
    <g className="overlay">
      <g pointerEvents="none">
        <LinkBadges elements={elements} o={o} zoom={zoom} />
        {boxes.map((b) =>
          b.wire ? (
            <polyline
              key={b.el.id}
              points={b.wire.join(' ')}
              fill="none"
              stroke={sel}
              strokeOpacity={0.45}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <g key={b.el.id}>
              <rect
                x={inflate(b.rect!, 4).x}
                y={inflate(b.rect!, 4).y}
                width={inflate(b.rect!, 4).w}
                height={inflate(b.rect!, 4).h}
                fill={t.selectSoft}
                stroke={sel}
                strokeWidth={sw}
                strokeDasharray={`${3 * sw} ${3 * sw}`}
              />
              <Brackets r={inflate(b.rect!, 4)} color={sel} sw={sw} len={9 * sw} />
            </g>
          ),
        )}
        {marquee && (
          <g>
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill={t.selectSoft}
              stroke={sel}
              strokeWidth={sw}
              strokeDasharray={`${1.5 * sw} ${3 * sw}`}
            />
            <Brackets r={marquee} color={sel} sw={sw} len={9 * sw} />
          </g>
        )}
        {wireDraft && (
          <>
            <polyline
              points={wireDraftPoints(wireDraft).join(' ')}
              fill="none"
              stroke={t.ink}
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
              stroke={sel}
              strokeWidth={sw}
            />
          </>
        )}
        {ghostEl && (
          <g opacity={0.5}>
            <ComponentView el={ghostEl} o={ghostO} />
          </g>
        )}
        {ghost && tool !== 'place' && tool !== 'select' && !wireDraft && (
          <Crosshair p={ghost} color={sel} sw={sw} />
        )}
        {blockDraft && <DraftRect r={blockDraft} color={sel} fill={t.selectSoft} />}
        {rectDraft && (
          <DraftRect
            r={rectDraft}
            color={sel}
            fill={t.selectSoft}
            ellipse={tool === 'shape' && prefs.shapeKind === 'ellipse'}
          />
        )}
        {lineDraft &&
          (lineDraftEnds && (prefs.route ?? 'elbow') === 'elbow' ? (
            <polyline
              points={elbowRoute(
                { x: lineDraft[0]!, y: lineDraft[1]! },
                lineDraftEnds.from,
                { x: lineDraft[2]!, y: lineDraft[3]! },
                lineDraftEnds.to,
              )
                .flat()
                .join(' ')}
              fill="none"
              stroke={inkColor}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ) : (
            <line
              x1={lineDraft[0]}
              y1={lineDraft[1]}
              x2={lineDraft[2]}
              y2={lineDraft[3]}
              stroke={inkColor}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}
        {anchorEl && <AnchorDots el={anchorEl} color={sel} zoom={zoom} />}
        {strokeDraft && strokeDraft.length >= 6 && (
          <path
            d={strokePath(
              strokeDraft,
              prefs.highlighter ? prefs.penSize * 5 : prefs.penSize,
              prefs.highlighter,
            )}
            fill={inkColor}
            fillOpacity={prefs.highlighter ? 0.32 : 1}
          />
        )}
        {hoverPin && (
          <circle
            cx={hoverPin.x}
            cy={hoverPin.y}
            r={4.5}
            fill="none"
            stroke={sel}
            strokeWidth={1.6}
          />
        )}
      </g>
      {/* Resize handles (interactive). */}
      {single && !single.locked && isBox(single) && (
        <g className="handles">
          {HANDLES.map((h) => {
            const p = handlePos(boxes[0]!.rect!, h);
            return (
              <rect
                key={h}
                data-handle={h}
                className={`handle handle-${h}`}
                x={p.x - hs / 2}
                y={p.y - hs / 2}
                width={hs}
                height={hs}
                fill={t.paper}
                stroke={sel}
                strokeWidth={sw * 1.3}
              />
            );
          })}
        </g>
      )}
      {single && !single.locked && single.type === 'line' && (
        <g className="handles">
          {(single.route === 'elbow'
            ? (['p0', 'p1'] as const)
            : (['p0', 'p1', 'bend'] as const)
          ).map((h) => {
            const [x1, y1, x2, y2] = single.pts as [number, number, number, number];
            const c = lineControlPoint(single.pts, single.bend ?? 0);
            const p =
              h === 'p0'
                ? { x: x1, y: y1 }
                : h === 'p1'
                  ? { x: x2, y: y2 }
                  : { x: (x1 + 2 * c.x + x2) / 4, y: (y1 + 2 * c.y + y2) / 4 };
            return h === 'bend' ? (
              <circle
                key={h}
                data-handle={h}
                className="handle handle-move"
                cx={p.x}
                cy={p.y}
                r={hs / 2}
                fill={sel}
                stroke={t.paper}
                strokeWidth={sw}
              />
            ) : (
              <rect
                key={h}
                data-handle={h}
                className="handle handle-move"
                x={p.x - hs / 2}
                y={p.y - hs / 2}
                width={hs}
                height={hs}
                fill={t.paper}
                stroke={sel}
                strokeWidth={sw * 1.3}
              />
            );
          })}
        </g>
      )}
    </g>
  );
}

/** Connection points of a shape (shown while drawing connectors). */
function AnchorDots({ el, color, zoom }: { el: Element; color: string; zoom: number }) {
  const pts = anchorPoints(el);
  if (!pts) return null;
  const r = 4 / zoom;
  return (
    <g className="anchor-dots" pointerEvents="none">
      {Object.values(pts).map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={r}
          fill="white"
          stroke={color}
          strokeWidth={1.5 / zoom}
        />
      ))}
    </g>
  );
}

function DraftRect({
  r,
  color,
  fill,
  ellipse,
}: {
  r: Rect;
  color: string;
  fill: string;
  ellipse?: boolean;
}) {
  return ellipse ? (
    <ellipse
      cx={r.x + r.w / 2}
      cy={r.y + r.h / 2}
      rx={r.w / 2}
      ry={r.h / 2}
      fill={fill}
      stroke={color}
      strokeWidth={1.2}
      strokeDasharray="5 4"
    />
  ) : (
    <rect
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      fill={fill}
      stroke={color}
      strokeWidth={1.2}
      strokeDasharray="5 4"
    />
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
