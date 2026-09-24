import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { PANEL_WIDTH, useUI } from '../store/ui';

const MIN = 200;
const MAX = 560;
/** Dragged narrower than this, the panel closes (like in VS Code). */
const CLOSE_BELOW = 130;

type Side = 'left' | 'right';
const keys = (side: Side) =>
  side === 'left'
    ? ({ open: 'leftPanel', width: 'leftWidth' } as const)
    : ({ open: 'rightPanel', width: 'rightWidth' } as const);

/**
 * Edge of a side panel: drag to resize, double-click for the default width, the small chevron
 * (or dragging it very narrow) closes the panel.
 */
export function PanelResizer({ side }: { side: Side }) {
  const k = keys(side);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const moved = useRef(false);
  const set = useUI.getState().setSetting;

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: useUI.getState()[k.width] };
    moved.current = false;
    document.body.classList.add('resizing-panel');
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * (side === 'left' ? 1 : -1);
    if (Math.abs(dx) > 2) moved.current = true;
    const w = d.w + dx;
    if (w < CLOSE_BELOW) {
      drag.current = null;
      document.body.classList.remove('resizing-panel');
      set(k.open, false);
      return;
    }
    // Live while dragging; saved once, on release.
    useUI.setState({ [k.width]: Math.round(Math.min(MAX, Math.max(MIN, w))) });
  };
  const up = () => {
    if (drag.current && moved.current) set(k.width, useUI.getState()[k.width]);
    drag.current = null;
    document.body.classList.remove('resizing-panel');
  };

  return (
    <div
      className={`panel-resizer ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${side === 'left' ? 'library' : 'properties'} panel`}
      title="Drag to resize · double-click for the default width"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => set(k.width, PANEL_WIDTH)}
      data-testid={`resize-${side}`}
    >
      <button
        type="button"
        className="panel-toggle"
        title={`Hide the panel (${side === 'left' ? 'Ctrl \\' : 'Ctrl Shift \\'})`}
        onClick={() => set(k.open, false)}
        data-testid={`hide-${side}`}
      >
        {side === 'left' ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
      </button>
    </div>
  );
}

/** Slim strip on the edge of the canvas that brings a closed panel back. */
export function PanelReopen({ side }: { side: Side }) {
  const k = keys(side);
  return (
    <button
      type="button"
      className={`panel-reopen ${side}`}
      title={`Show the ${side === 'left' ? 'library' : 'properties'} panel`}
      onClick={() => useUI.getState().setSetting(k.open, true)}
      data-testid={`show-${side}`}
    >
      {side === 'left' ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
    </button>
  );
}
