import {
  buildSlides,
  elementBBox,
  visibleFor,
  type Element,
  type FrameElement,
  type Id,
  type Rect,
  type Slide,
  type Transition,
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
import { resolveColor, THEMES } from '../theme';
import { evaluate, slideElements, slideSteps, type AnimFrame, type Clock, type ElFx } from './anim';

type Mode = 'point' | 'laser' | 'pen';
type Box = { x: number; y: number; w: number; h: number };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Halves of an ease-in-out: they meet at the same speed, so out + in is one movement. */
const easeInQuad = (t: number) => t * t;
const easeOutQuad = (t: number) => 1 - (1 - t) ** 2;

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
    // Start on the frame asked for (Preview), the selected frame, else on the first slide of
    // the current sheet.
    const at = useUI.getState().presentAt;
    const k = at ? slides.findIndex((s) => s.frameId === at) : -1;
    if (k >= 0) return k;
    const sel = ed.selection();
    const i = slides.findIndex((s) => s.frameId && sel.includes(s.frameId));
    if (i >= 0) return i;
    const j = slides.findIndex((s) => s.sheetId === ed.sheetId);
    return Math.max(0, j);
  });
  const slide: Slide | undefined = slides[index];
  const [sheetId, setSheetId] = useState<Id | undefined>(slide?.sheetId);
  const sheetIdRef = useRef(sheetId);
  sheetIdRef.current = sheetId;
  const sheetElements = useSheetElements(sheetId ?? ed.project.rootSheetId);
  // Elements hidden from the presentation are neither drawn nor clickable.
  const elements = useMemo(() => visibleFor(sheetElements, 'present'), [sheetElements]);
  /** Elements of a slide (those touching its frame, or the whole sheet). */
  const slideOf = (sl: Slide) =>
    slideElements(
      visibleFor(ed.project.getElements(sl.sheetId), 'present'),
      sl.frameId ? sl.rect : null,
      ed.ctx,
    );
  // Click steps of the slide on screen (it is only animated once the camera shows its sheet).
  const steps = useMemo(
    () => (slide && slide.sheetId === sheetId ? slideSteps(slideOf(slide)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slide, sheetId, elements],
  );
  const [box, setBox] = useState<Box>(() =>
    slide ? fitBox(slide.rect, screen) : { x: 0, y: 0, w: 800, h: 600 },
  );
  const [fade, setFade] = useState(1);
  const [blur, setBlur] = useState(0);
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
    useUI.getState().set({ presenting: false, presentFollow: null, presentAt: null });
  }, []);

  // Full screen while presenting; leaving full screen (Esc) ends the presentation. Opening a
  // link in a new tab also leaves full screen: then the presentation goes on, and the next click
  // brings full screen back.
  const full = useRef(false);
  const linkOpened = useRef(-Infinity);
  const refull = useRef(false);
  const enterFullscreen = useCallback(() => {
    rootRef.current?.requestFullscreen?.().then(
      () => (full.current = true),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    enterFullscreen();
    const onChange = () => {
      if (!full.current || document.fullscreenElement) return;
      full.current = false;
      if (document.hidden || performance.now() - linkOpened.current < 3000) refull.current = true;
      else useUI.getState().set({ presenting: false, presentFollow: null, presentAt: null });
    };
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(anim.current);
    };
  }, [enterFullscreen]);

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

  // Build steps of the current slide: 0 = as it opens, then one per click.
  const [level, setLevel] = useState(0);
  const started = useRef(new Map<number, number>([[0, performance.now() + 150]]));
  const [now, setNow] = useState(() => performance.now());

  /** A tween driven by requestAnimationFrame (skipped when animations are off). */
  const tween = useCallback((ms: number, frame: (k: number) => void, done?: () => void) => {
    cancelAnimationFrame(anim.current);
    const reduce =
      !useUI.getState().animations ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || ms <= 0) {
      frame(1);
      done?.();
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      frame(k);
      if (k < 1) anim.current = requestAnimationFrame(step);
      else done?.();
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  /**
   * Show slide `i` with the transition of its frame (the camera glides by default, and
   * cross-fades to another sheet). `atEnd`: with all its steps played (going back).
   */
  const goToken = useRef(0);
  const go = useCallback(
    (i: number, via?: Rect, atEnd = false) => {
      const target = slides[i];
      if (!target) return;
      setInk([]);
      setIndex(i);
      const token = ++goToken.current;
      const to = fitBox(target.rect, screen);
      const frame = target.frameId
        ? (ed.project.getElement(target.sheetId, target.frameId) as FrameElement | undefined)
        : undefined;
      const sameSheet = target.sheetId === sheetId;
      let kind: Transition = via ? 'move' : (frame?.transition ?? 'move');
      // The camera cannot glide to another sheet: it fades there.
      if (kind === 'move' && !sameSheet && !via) kind = 'fade';
      const ms = frame?.transitionMs ?? (kind === 'move' ? 560 : kind === 'fade' ? 480 : 620);
      setLevel(atEnd ? slideSteps(slideOf(target)).length : 0);
      // The slide's own animations wait until it has arrived (then step 0 starts).
      started.current = new Map(atEnd ? [] : [[0, Infinity]]);
      setNow(performance.now());
      const arrived = () => {
        if (token !== goToken.current) return;
        setFade(1);
        setBlur(0);
        if (!atEnd) started.current.set(0, performance.now());
        setNow(performance.now());
      };
      const from = boxRef.current;
      /** A box moved by (dx, dy) of its size, and scaled by k around its centre. */
      const shift = (b: Box, dx: number, dy: number, k = 1): Box => ({
        x: b.x + b.w * dx + (b.w * (1 - k)) / 2,
        y: b.y + b.h * dy + (b.h * (1 - k)) / 2,
        w: b.w * k,
        h: b.h * k,
      });
      /**
       * Out, then in, as one movement: the first half speeds up (ease in), the second slows
       * down (ease out), at the same speed where they meet — no stop in the middle. The sheet
       * changes when the screen is at its faintest.
       */
      const outIn = (outBox: Box, inBox: Box, blurPx = 0) =>
        tween(
          ms,
          (k) => {
            if (k < 0.5) {
              const e = easeInQuad(k * 2);
              setBox(lerpBox(from, outBox, e));
              setFade(1 - e);
              setBlur(blurPx * e);
            } else {
              if (sheetIdRef.current !== target.sheetId) setSheetId(target.sheetId);
              const e = easeOutQuad(k * 2 - 1);
              setBox(lerpBox(inBox, to, e));
              setFade(e);
              setBlur(blurPx * (1 - e));
            }
          },
          arrived,
        );
      if (kind === 'none') {
        cancelAnimationFrame(anim.current);
        setSheetId(target.sheetId);
        setBox(to);
        arrived();
        return;
      }
      if (kind === 'fade') return outIn(from, to);
      if (kind === 'blur') return outIn(from, to, 10);
      if (kind === 'slide') return outIn(shift(from, 0.35, 0), shift(to, -0.35, 0));
      if (kind === 'slide-up') return outIn(shift(from, 0, 0.35), shift(to, 0, -0.35));
      if (kind === 'zoom') return outIn(shift(from, 0, 0, 0.55), shift(to, 0, 0, 1.6));
      if (sameSheet) {
        animateTo(to, ms, arrived);
        return;
      }
      // Drilling into a block: zoom onto it, then dive into its sheet from a bit further away.
      const k = 1.35;
      const dive = {
        x: to.x - (to.w * (k - 1)) / 2,
        y: to.y - (to.h * (k - 1)) / 2,
        w: to.w * k,
        h: to.h * k,
      };
      const block = fitBox(via!, screen);
      animateTo(block, 420, () =>
        tween(
          420,
          (t) => {
            if (t < 0.35) setFade(1 - easeInQuad(t / 0.35));
            else {
              if (sheetIdRef.current !== target.sheetId) setSheetId(target.sheetId);
              const e = easeOutQuad((t - 0.35) / 0.65);
              setFade(e);
              setBox(lerpBox(dive, to, e));
            }
          },
          arrived,
        ),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slides, screen, sheetId, animateTo, tween, ed],
  );

  const indexRef = useRef(index);
  indexRef.current = index;
  const levelRef = useRef(level);
  levelRef.current = level;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const goRef = useRef(go);
  goRef.current = go;

  // Next: the next build step of the slide, or the next slide.
  const next = useCallback(() => {
    if (level < steps.length) {
      const l = level + 1;
      started.current.set(steps[l - 1]!, performance.now());
      setLevel(l);
      setNow(performance.now());
      return;
    }
    if (index < slides.length - 1) go(index + 1);
  }, [index, slides, go, level, steps]);
  // Back: undo the last step at once, or show the previous slide with all its steps played.
  const prev = useCallback(() => {
    if (level > 0) {
      started.current.delete(steps[level - 1]!);
      setLevel(level - 1);
      setNow(performance.now());
      return;
    }
    if (index > 0) go(index - 1, undefined, true);
  }, [index, go, level, steps]);
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
    session.setPresence({ presenting: { index, step: level } });
  }, [ed, index, level, follow]);
  useEffect(() => () => ed.session?.setPresence({ presenting: null }), [ed]);
  useEffect(() => {
    const session = ed.session;
    if (!session || !follow) return;
    const sync = () => {
      const p = session.state.getState().peers.find((x) => x.user.id === follow);
      if (!p?.presenting) {
        // The presenter stopped.
        useUI.getState().set({ presenting: false, presentFollow: null, presentAt: null });
        return;
      }
      if (p.presenting.index !== indexRef.current) goRef.current(p.presenting.index);
      // The presenter's build steps too.
      const step = p.presenting.step ?? 0;
      if (step !== levelRef.current) {
        if (step > levelRef.current)
          started.current.set(stepsRef.current[step - 1] ?? 0, performance.now());
        setLevel(step);
        setNow(performance.now());
      }
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

  const drawing = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    // Back from a link opened in another tab: full screen again.
    if (refull.current && !document.fullscreenElement) {
      refull.current = false;
      enterFullscreen();
    }
    // A click on the blank screen shows the slide again (and does not move on).
    if (blank && e.button === 0) {
      setBlank(false);
      return;
    }
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
        if (/^(https?:|mailto:)/i.test(el.link.url)) {
          linkOpened.current = performance.now();
          window.open(el.link.url, '_blank', 'noopener');
        }
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
    () => ({ theme, ctx: ed.ctx, interactive: true, latexRefs, live: true }),
    [theme, ed.ctx, latexRefs],
  );

  // Frames only define the slides: their dashed outline and name tab are not shown.
  const drawn = useMemo(() => elements.filter((e) => e.type !== 'frame'), [elements]);

  // Which slide of this sheet each element belongs to (the first frame it touches).
  const slideOfEl = useMemo(() => {
    const m = new Map<Id, number>();
    slides.forEach((sl, i) => {
      if (sl.sheetId !== sheetId) return;
      for (const e of slideElements(elements, sl.frameId ? sl.rect : null, ed.ctx))
        if (!m.has(e.id)) m.set(e.id, i);
    });
    return m;
  }, [slides, sheetId, elements, ed.ctx]);

  // The animations: the current slide at its step, the slides before all played, the ones after
  // not started yet (seen while the camera glides past them).
  const played: AnimFrame = useMemo(() => {
    const animated = drawn.filter((e) => e.anims?.length);
    if (!animated.length) return { elements: drawn, fx: new Map(), rings: [], busy: false };
    const reached = level === 0 ? 0 : (steps[level - 1] ?? 0);
    const onScreen = slide?.sheetId === sheetId;
    const clocks: Record<'cur' | 'before' | 'after', Clock> = {
      cur: { reached: onScreen ? reached : -1, started: started.current, now },
      before: { reached: Infinity, started: new Map(), now },
      after: { reached: -1, started: new Map(), now },
    };
    const groups: Record<'cur' | 'before' | 'after', Element[]> = {
      cur: [],
      before: [],
      after: [],
    };
    for (const e of animated) {
      const i = slideOfEl.get(e.id);
      groups[i === undefined || i === index ? 'cur' : i < index ? 'before' : 'after'].push(e);
    }
    const byId = new Map<Id, Element>();
    const fx = new Map<Id, ElFx>();
    const rings: AnimFrame['rings'] = [];
    let busy = false;
    const resolve = (c: string | undefined) => resolveColor(c, theme);
    const box = (e: Element) => elementBBox(e, ed.ctx, elements);
    for (const k of ['cur', 'before', 'after'] as const) {
      if (!groups[k].length) continue;
      const f = evaluate(groups[k], clocks[k], resolve, box);
      f.elements.forEach((e) => byId.set(e.id, e));
      f.fx.forEach((v, id) => fx.set(id, v));
      if (k === 'cur') {
        rings.push(...f.rings);
        busy = f.busy;
      }
    }
    return { elements: drawn.map((e) => byId.get(e.id) ?? e), fx, rings, busy };
  }, [drawn, level, steps, slide, sheetId, now, slideOfEl, index, theme, ed.ctx, elements]);
  // Keep drawing while something moves.
  useEffect(() => {
    if (!played.busy) return;
    const id = requestAnimationFrame(() => setNow(performance.now()));
    return () => cancelAnimationFrame(id);
  }, [played]);
  // Elements not there (yet): not drawn at all, so their junction dots go too.
  const gone = useMemo(() => {
    const out = new Set<string>();
    played.fx.forEach((f, id) => {
      if (f.opacity === 0) out.add(id);
    });
    return out;
  }, [played]);
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
      {blank && (
        <div className="present-blank-note" data-testid="present-blank-note">
          Screen blanked · press B or click the square to show the slide
        </div>
      )}
      {!slides.length && (
        <div className="present-empty">This project has nothing to present yet.</div>
      )}
      {!blank && sheetId && (
        <svg
          className="present-stage"
          width={screen.w}
          height={screen.h}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          style={{ opacity: fade, filter: blur > 0.2 ? `blur(${blur}px)` : undefined }}
        >
          <SheetRenderer elements={played.elements} o={o} fx={played.fx} hidden={gone} />
          {played.rings.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={Math.min(14, r.h / 2)}
              fill="none"
              stroke={theme.select}
              strokeWidth={2.5}
              opacity={r.opacity}
              pointerEvents="none"
            />
          ))}
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
        <button
          type="button"
          className={blank ? 'on' : ''}
          aria-pressed={blank}
          onClick={() => setBlank((b) => !b)}
          title={blank ? 'Show the slide again (B)' : 'Blank screen (B)'}
          data-testid="present-blank"
        >
          <Square size={17} fill={blank ? 'currentColor' : 'none'} />
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
