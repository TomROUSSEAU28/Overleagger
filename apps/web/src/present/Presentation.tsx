import {
  buildSlides,
  visibleFor,
  type Element,
  type Id,
  type Rect,
  type Slide,
} from '@overleagger/core';
import {
  ChevronLeft,
  ChevronRight,
  CornerLeftUp,
  Eraser,
  Pen,
  Pointer,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SheetRenderer } from '../canvas/render/SheetRenderer';
import { strokePath } from '../canvas/render/shapes';
import { useEditor, useSheetElements } from '../editor/context';
import { useUI } from '../store/ui';
import { THEMES } from '../theme';

type Mode = 'point' | 'laser' | 'pen';
type Box = { x: number; y: number; w: number; h: number };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Height kept free at the bottom for the control bar (screen px). */
const HUD_SPACE = 72;

/** View box showing `r` with a margin above the control bar, filling the whole screen. */
function fitBox(r: Rect, screen: { w: number; h: number }): Box {
  const m = Math.max(r.w, r.h) * 0.05 + 10;
  const availH = Math.max(screen.h - HUD_SPACE, 1);
  const scale = Math.min(screen.w / (r.w + 2 * m), availH / (r.h + 2 * m));
  const w = screen.w / scale;
  const h = screen.h / scale;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - availH / scale / 2, w, h };
}

const lerpBox = (a: Box, b: Box, k: number): Box => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  w: a.w + (b.w - a.w) * k,
  h: a.h + (b.h - a.h) * k,
});

/**
 * Presentation mode: the frames of every sheet (or whole sheets without frames) become slides,
 * in hierarchy order. Click a block to zoom into its sub-sheet, a link to follow it. Laser
 * pointer (L), pen (P) that leaves no trace in the project, blank screen (B).
 */
export function Presentation() {
  const ed = useEditor();
  const theme = THEMES[useUI((s) => s.theme)];
  const latexRefs = useUI((s) => s.latexRefs);
  const rootRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight });

  const slides = useMemo(() => buildSlides(ed.project, ed.ctx), [ed]);
  const [index, setIndex] = useState(() => {
    // Start on the selected frame, else on the first slide of the current sheet.
    const sel = ed.selection();
    const i = slides.findIndex((s) => s.frameId && sel.includes(s.frameId));
    if (i >= 0) return i;
    const j = slides.findIndex((s) => s.sheetId === ed.sheetId);
    return Math.max(0, j);
  });
  const slide: Slide | undefined = slides[index];
  const [sheetId, setSheetId] = useState<Id | undefined>(slide?.sheetId);
  const [box, setBox] = useState<Box>(() =>
    slide ? fitBox(slide.rect, screen) : { x: 0, y: 0, w: 800, h: 600 },
  );
  const [fade, setFade] = useState(1);
  const [mode, setMode] = useState<Mode>('point');
  const [blank, setBlank] = useState(false);
  const [ink, setInk] = useState<number[][]>([]);
  const [laser, setLaser] = useState<{ x: number; y: number; t: number }[]>([]);
  const [hud, setHud] = useState(true);
  const history = useRef<number[]>([]);
  const anim = useRef(0);
  const boxRef = useRef(box);
  boxRef.current = box;

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    useUI.getState().set({ presenting: false, presentFollow: null });
  }, []);

  // Full screen while presenting; leaving full screen (Esc) ends the presentation.
  useEffect(() => {
    const el = rootRef.current;
    let wasFull = false;
    el?.requestFullscreen?.().then(
      () => (wasFull = true),
      () => undefined,
    );
    const onChange = () => {
      if (wasFull && !document.fullscreenElement)
        useUI.getState().set({ presenting: false, presentFollow: null });
    };
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(anim.current);
    };
  }, []);

  const animateTo = useCallback((to: Box, ms: number, done?: () => void, start?: Box) => {
    cancelAnimationFrame(anim.current);
    const reduce =
      !useUI.getState().animations ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || ms <= 0) {
      setBox(to);
      done?.();
      return;
    }
    const from = start ?? boxRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      setBox(lerpBox(from, to, easeInOut(t)));
      if (t < 1) anim.current = requestAnimationFrame(step);
      else done?.();
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  /** Show slide `i`: glide inside the same sheet, cross-fade to another sheet. */
  const go = useCallback(
    (i: number, via?: Rect) => {
      const target = slides[i];
      if (!target) return;
      setInk([]);
      setIndex(i);
      const to = fitBox(target.rect, screen);
      if (target.sheetId === sheetId) {
        animateTo(to, 520);
        return;
      }
      const swap = () => {
        setFade(0);
        window.setTimeout(() => {
          setSheetId(target.sheetId);
          setFade(1);
          if (!via) return setBox(to);
          // Arrive in the sub-sheet from slightly further away, like diving into the block.
          const k = 1.35;
          const from = {
            x: to.x - (to.w * (k - 1)) / 2,
            y: to.y - (to.h * (k - 1)) / 2,
            w: to.w * k,
            h: to.h * k,
          };
          setBox(from);
          animateTo(to, 380, undefined, from);
        }, 140);
      };
      // Drilling into a block: first zoom onto the block, then open its sheet.
      if (via) animateTo(fitBox(via, screen), 420, swap);
      else swap();
    },
    [slides, screen, sheetId, animateTo],
  );

  const indexRef = useRef(index);
  indexRef.current = index;
  const goRef = useRef(go);
  goRef.current = go;

  const next = useCallback(() => index < slides.length - 1 && go(index + 1), [index, slides, go]);
  const prev = useCallback(() => index > 0 && go(index - 1), [index, go]);
  const up = useCallback(() => {
    const back = history.current.pop();
    if (back !== undefined) return go(back);
    const parent = ed.project.getSheet(sheetId ?? '')?.parentSheetId;
    const i = slides.findIndex((s) => s.sheetId === parent);
    if (i >= 0) go(i);
  }, [ed, sheetId, slides, go]);

  // Collaboration: tell the others which slide I show, or follow the presenter's slides.
  const follow = useUI((s) => s.presentFollow);
  useEffect(() => {
    const session = ed.session;
    if (!session || follow) return;
    session.setPresence({ presenting: { index } });
  }, [ed, index, follow]);
  useEffect(() => () => ed.session?.setPresence({ presenting: null }), [ed]);
  useEffect(() => {
    const session = ed.session;
    if (!session || !follow) return;
    const sync = () => {
      const p = session.state.getState().peers.find((x) => x.user.id === follow);
      if (!p?.presenting) {
        // The presenter stopped.
        useUI.getState().set({ presenting: false, presentFollow: null });
        return;
      }
      if (p.presenting.index !== indexRef.current) goRef.current(p.presenting.index);
    };
    sync();
    return session.state.subscribe((a, b) => {
      if (a.peers !== b.peers) sync();
    });
  }, [ed, follow]);

  // Re-fit on resize.
  useEffect(() => {
    if (slide && slide.sheetId === sheetId) setBox(fitBox(slide.rect, screen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Keys (captured before the editor shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) next();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k) && !e.altKey) prev();
      else if (k === 'Backspace' || k === 'u' || (e.altKey && k === 'ArrowUp')) up();
      else if (k === 'Home') go(0);
      else if (k === 'End') go(slides.length - 1);
      else if (k === 'Escape') close();
      else if (k === 'l' || k === 'L') setMode((m) => (m === 'laser' ? 'point' : 'laser'));
      else if (k === 'p' || k === 'P' || k === 'd') setMode((m) => (m === 'pen' ? 'point' : 'pen'));
      else if (k === 'c' || k === 'C') setInk([]);
      else if (k === 'b' || k === 'B' || k === '.') setBlank((b) => !b);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, prev, up, go, close, slides.length]);

  // The bottom bar hides after a few seconds without mouse movement.
  const hudTimer = useRef(0);
  const poke = () => {
    setHud(true);
    window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(false), 2600);
  };
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hudTimer.current);
  }, []);

  // Laser trail fades out on its own.
  useEffect(() => {
    if (mode !== 'laser' || !laser.length) return;
    const t = window.setTimeout(
      () => setLaser((l) => l.filter((p) => performance.now() - p.t < 260)),
      40,
    );
    return () => window.clearTimeout(t);
  }, [laser, mode]);

  const sheetElements = useSheetElements(sheetId ?? ed.project.rootSheetId);
  // Elements hidden from the presentation are neither drawn nor clickable.
  const elements = useMemo(() => visibleFor(sheetElements, 'present'), [sheetElements]);
  const drawing = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode === 'pen') {
      drawing.current = true;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setInk((s) => [...s, [e.clientX, e.clientY, e.pressure || 0.5]]);
      return;
    }
    if (mode === 'laser' || e.button !== 0) return;
    const hit = (e.target as HTMLElement).closest?.('[data-id]');
    const id = hit?.getAttribute('data-id');
    const el: Element | undefined = id ? elements.find((x) => x.id === id) : undefined;
    if (el?.type === 'block') {
      const i = slides.findIndex((s) => s.sheetId === el.childSheetId);
      if (i >= 0) {
        history.current.push(index);
        go(i, { x: el.x, y: el.y, w: el.w, h: el.h });
        return;
      }
    }
    if (el?.link) {
      if (el.link.kind === 'url') {
        if (/^(https?:|mailto:)/i.test(el.link.url)) window.open(el.link.url, '_blank', 'noopener');
      } else {
        const sid = el.link.sheetId;
        const i = slides.findIndex((s) => s.sheetId === sid);
        if (i >= 0) {
          history.current.push(index);
          go(i);
        }
      }
      return;
    }
    if (el?.type === 'port') return up();
    next();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    poke();
    if (mode === 'laser') {
      const now = performance.now();
      setLaser((l) => [
        ...l.filter((p) => now - p.t < 260),
        { x: e.clientX, y: e.clientY, t: now },
      ]);
    } else if (mode === 'pen' && drawing.current) {
      setInk((s) => {
        const last = s[s.length - 1];
        if (!last) return s;
        return [...s.slice(0, -1), [...last, e.clientX, e.clientY, e.pressure || 0.5]];
      });
    }
  };
  const onPointerUp = () => {
    drawing.current = false;
  };

  const o = useMemo(
    () => ({ theme, ctx: ed.ctx, interactive: true, latexRefs }),
    [theme, ed.ctx, latexRefs],
  );

  // Frames only define the slides: their dashed outline and name tab are not shown.
  const drawn = useMemo(() => elements.filter((e) => e.type !== 'frame'), [elements]);
  // On a frame slide, what lies outside the frame is covered, so the slide is just the frame.
  const spot = slide?.frameId && slide.sheetId === sheetId ? slide.rect : null;

  const head = laser[laser.length - 1];
  const inkColor = theme.name === 'blackboard' ? '#ffd166' : '#d62828';

  return (
    <div
      ref={rootRef}
      className={`presentation mode-${mode}`}
      style={{ background: blank ? '#000' : theme.paper }}
      data-testid="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        prev();
      }}
    >
      {!slides.length && (
        <div className="present-empty">This project has nothing to present yet.</div>
      )}
      {!blank && sheetId && (
        <svg
          className="present-stage"
          width={screen.w}
          height={screen.h}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          style={{ opacity: fade }}
        >
          <SheetRenderer elements={drawn} o={o} />
          {spot && (
            <path
              className="present-spot"
              d={`M ${box.x - box.w} ${box.y - box.h} h ${box.w * 3} v ${box.h * 3} h ${-box.w * 3} Z M ${spot.x} ${spot.y} v ${spot.h} h ${spot.w} v ${-spot.h} Z`}
              fill={theme.paper}
              fillRule="evenodd"
            />
          )}
        </svg>
      )}
      <svg className="present-ink" width={screen.w} height={screen.h}>
        {ink.map((s, i) => (
          <path key={i} d={strokePath(s, 4)} fill={inkColor} />
        ))}
        {mode === 'laser' && laser.length > 1 && (
          <polyline
            points={laser.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#ff2a2a"
            strokeOpacity={0.35}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {mode === 'laser' && head && (
          <>
            <circle cx={head.x} cy={head.y} r={11} fill="#ff2a2a" opacity={0.22} />
            <circle cx={head.x} cy={head.y} r={4.5} fill="#ff2a2a" />
          </>
        )}
      </svg>
      <div
        className={`present-hud${hud ? '' : ' hidden'}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={prev} disabled={index === 0} title="Previous (←)">
          <ChevronLeft size={18} />
        </button>
        <span className="present-count" data-testid="present-count">
          {slides.length ? `${index + 1} / ${slides.length}` : '0 / 0'}
          {slide && <b>{slide.title}</b>}
        </span>
        <button
          type="button"
          onClick={next}
          disabled={index >= slides.length - 1}
          title="Next (→, Space, click)"
        >
          <ChevronRight size={18} />
        </button>
        <span className="sep" />
        <button type="button" onClick={up} title="Back up one level (Backspace)">
          <CornerLeftUp size={17} />
        </button>
        <button
          type="button"
          className={mode === 'laser' ? 'on' : ''}
          onClick={() => setMode((m) => (m === 'laser' ? 'point' : 'laser'))}
          title="Laser pointer (L)"
          data-testid="present-laser"
        >
          <Pointer size={17} />
        </button>
        <button
          type="button"
          className={mode === 'pen' ? 'on' : ''}
          onClick={() => setMode((m) => (m === 'pen' ? 'point' : 'pen'))}
          title="Pen: draw on the slide, nothing is saved (P)"
          data-testid="present-pen"
        >
          <Pen size={17} />
        </button>
        <button type="button" onClick={() => setInk([])} title="Clear the pen (C)">
          <Eraser size={17} />
        </button>
        <button type="button" onClick={() => setBlank((b) => !b)} title="Blank screen (B)">
          <Square size={17} />
        </button>
        <span className="sep" />
        <button
          type="button"
          onClick={close}
          title="End the presentation (Esc)"
          data-testid="present-close"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
