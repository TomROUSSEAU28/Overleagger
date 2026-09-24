/**
 * Comment threads pinned on the drawing: bubbles on the canvas, a popup to read / reply /
 * resolve, and the list of every thread in the left panel. Comments are part of the project
 * document, so they sync live and commenters may write them even when the drawing is read-only.
 */
import type { CommentThread, Id } from '@overleagger/core';
import { Check, MessageSquare, RotateCcw, Trash, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useEditor, useSheets } from '../editor/context';
import { useComments, useMe } from './hooks';
import { useUI, type Viewport } from '../store/ui';

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

/** Bubbles on the canvas (world coordinates, constant size on screen). */
export function CommentPins({ zoom }: { zoom: number }) {
  const ed = useEditor();
  const me = useMe();
  const threads = useComments();
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const open = useUI((s) => s.openThread);
  const showResolved = useUI((s) => s.showResolved);
  const draft = useUI((s) => s.commentDraft);
  const drag = useUI((s) => s.commentDrag);
  const k = 1 / zoom;
  const isOwner = (ed.session?.role ?? 'owner') === 'owner';
  const canWrite = ed.project.canWrite(undefined, 'comments');
  const here = threads.filter(
    (t) => t.sheetId === sheetId && (showResolved || !t.resolved || t.id === open),
  );
  // Click opens the thread; dragging (the author's or the owner's bubble) moves it.
  const press = (t: CommentThread, e: ReactPointerEvent<SVGGElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const movable = canWrite && (isOwner || t.messages[0]?.author.id === me.id);
    const start = { cx: e.clientX, cy: e.clientY, x: t.x, y: t.y };
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.cx;
      const dy = ev.clientY - start.cy;
      if (!movable || (!moved && Math.hypot(dx, dy) < 4)) return;
      moved = true;
      useUI.getState().set({
        commentDrag: { id: t.id, x: start.x + dx / zoom, y: start.y + dy / zoom },
      });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      const ui = useUI.getState();
      if (moved && ui.commentDrag) {
        ed.project.updateComment(t.id, { x: ui.commentDrag.x, y: ui.commentDrag.y });
        ui.set({ commentDrag: null });
      } else ui.set({ openThread: t.id === ui.openThread ? null : t.id, commentDraft: null });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  return (
    <g className="comment-pins">
      {here.map((t) => {
        const color = t.messages[0]?.author.color ?? '#2f5d9e';
        const at = drag?.id === t.id ? drag : t;
        const movable = canWrite && (isOwner || t.messages[0]?.author.id === me.id);
        return (
          <g
            key={t.id}
            className={`comment-pin${t.id === open ? ' open' : ''}${t.resolved ? ' resolved' : ''}${movable ? ' movable' : ''}${drag?.id === t.id ? ' dragging' : ''}`}
            transform={`translate(${at.x} ${at.y}) scale(${k})`}
            onPointerDown={(e) => press(t, e)}
            data-testid="comment-pin"
          >
            <title>{movable ? 'Click to open · drag to move' : 'Click to open'}</title>
            <path
              d="M0 0 L0 -6 A12 12 0 1 1 6 -2 Z"
              transform="translate(0 0)"
              fill={t.resolved ? '#9a968c' : color}
              stroke="#fff"
              strokeWidth={1.5}
            />
            <text
              x={12}
              y={-9}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="#fff"
              fontFamily="system-ui, sans-serif"
            >
              {t.messages.length}
            </text>
          </g>
        );
      })}
      {draft && (
        <g transform={`translate(${draft.x} ${draft.y}) scale(${k})`} pointerEvents="none">
          <path d="M0 0 L0 -6 A12 12 0 1 1 6 -2 Z" fill="#2f5d9e" opacity={0.6} />
        </g>
      )}
    </g>
  );
}

/** Popup of the open thread (or of a new comment), positioned next to its bubble. */
export function CommentPopover({ vp }: { vp: Viewport }) {
  const ed = useEditor();
  const me = useMe();
  const threads = useComments();
  const openId = useUI((s) => s.openThread);
  const draft = useUI((s) => s.commentDraft);
  const [text, setText] = useState('');
  const thread = openId ? threads.find((t) => t.id === openId) : undefined;
  const canWrite = ed.project.canWrite(undefined, 'comments');
  const isOwner = (ed.session?.role ?? 'owner') === 'owner';
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(''), [openId, draft]);
  // Focus without scrolling the canvas (autoFocus would scroll it to show the popup).
  useEffect(() => textRef.current?.focus({ preventScroll: true }), [openId, draft]);
  const drag = useUI((s) => s.commentDrag);
  const at = thread && drag?.id === thread.id ? drag : (thread ?? draft);
  if (!at) return null;
  const close = () => useUI.getState().set({ openThread: null, commentDraft: null });
  // Keep the popup inside the canvas: on the right of the bubble, or on its left near the edge.
  const W = 290;
  const px = at.x * vp.zoom + vp.x;
  const py = at.y * vp.zoom + vp.y;
  const left = px + 26 + W > ed.canvasSize.w - 8 ? Math.max(8, px - 16 - W) : px + 26;
  const style: CSSProperties = {
    left,
    top: Math.min(Math.max(8, py - 30), Math.max(8, ed.canvasSize.h - 330)),
  };
  const post = () => {
    const t = text.trim();
    if (!t) return;
    if (thread) ed.project.replyComment(thread.id, me, t);
    else if (draft) {
      const id = ed.project.addComment({ sheetId: ed.sheetId, x: draft.x, y: draft.y }, me, t);
      useUI.getState().set({ commentDraft: null, openThread: id ?? null });
    }
    setText('');
  };
  return (
    <div
      className="comment-popover"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      data-testid="comment-popover"
    >
      <header>
        <MessageSquare size={14} />
        <b>{thread ? (thread.resolved ? 'Resolved' : 'Comment') : 'New comment'}</b>
        <span style={{ flex: 1 }} />
        {thread && canWrite && (
          <button
            type="button"
            className="icon-btn"
            title={thread.resolved ? 'Reopen' : 'Resolve'}
            onClick={() => {
              ed.project.updateComment(thread.id, { resolved: !thread.resolved });
              if (!thread.resolved) close();
            }}
            data-testid="comment-resolve"
          >
            {thread.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
          </button>
        )}
        {thread && canWrite && (isOwner || thread.messages[0]?.author.id === me.id) && (
          <button
            type="button"
            className="icon-btn danger"
            title="Delete the thread"
            onClick={() => {
              if (confirm('Delete this comment thread?')) {
                ed.project.deleteComment(thread.id);
                close();
              }
            }}
          >
            <Trash size={14} />
          </button>
        )}
        <button type="button" className="icon-btn" title="Close" onClick={close}>
          <X size={14} />
        </button>
      </header>
      {thread && (
        <ol className="messages">
          {thread.messages.map((m) => (
            <li key={m.id}>
              <span className="who" style={{ color: m.author.color }}>
                {m.author.name}
              </span>
              <span className="muted small"> · {ago(m.at)}</span>
              <p>{m.text}</p>
            </li>
          ))}
        </ol>
      )}
      {canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            post();
          }}
        >
          <textarea
            ref={textRef}
            rows={2}
            value={text}
            placeholder={thread ? 'Reply…' : 'Write a comment… (Ctrl+Enter to post)'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post();
              if (e.key === 'Escape') close();
            }}
            data-testid="comment-text"
          />
          <button
            type="submit"
            className="btn primary"
            disabled={!text.trim()}
            data-testid="comment-post"
          >
            {thread ? 'Reply' : 'Comment'}
          </button>
        </form>
      ) : (
        <p className="muted small">You can read comments but not write them.</p>
      )}
    </div>
  );
}

/** Left panel: every thread of the project, by sheet. */
export function CommentsPanel() {
  const ed = useEditor();
  const threads = useComments();
  const sheets = useSheets();
  const showResolved = useUI((s) => s.showResolved);
  const open = useUI((s) => s.openThread);
  const visible = threads.filter((t) => showResolved || !t.resolved);
  const go = (t: CommentThread) => {
    ed.openSheet(t.sheetId);
    const vp = ed.viewport(t.sheetId);
    ed.setViewport(
      { ...vp, x: ed.canvasSize.w / 2 - t.x * vp.zoom, y: ed.canvasSize.h / 2 - t.y * vp.zoom },
      t.sheetId,
    );
    useUI.getState().set({ openThread: t.id, commentDraft: null });
  };
  const bySheet = new Map<Id, CommentThread[]>();
  for (const t of visible) bySheet.set(t.sheetId, [...(bySheet.get(t.sheetId) ?? []), t]);
  return (
    <div className="library-scroll pad comments-panel" data-testid="comments-panel">
      <div className="row comments-head">
        <button type="button" className="btn" onClick={() => ed.setTool('comment')}>
          <MessageSquare size={14} /> New comment (C)
        </button>
        <label className="check compact">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => useUI.getState().set({ showResolved: e.target.checked })}
          />
          resolved
        </label>
      </div>
      {!visible.length && (
        <p className="muted small">
          No comment. Pick the comment tool (C) and click on the drawing to ask a question or leave
          a remark{ed.session ? ' — everyone on the project sees it live' : ''}. Drag a bubble to
          move it.
        </p>
      )}
      {[...bySheet.entries()].map(([sid, list]) => (
        <section key={sid}>
          <h4 className="lib-cat-title">{sheets.find((s) => s.id === sid)?.name ?? 'Sheet'}</h4>
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`thread-card${open === t.id ? ' active' : ''}${t.resolved ? ' resolved' : ''}`}
              onClick={() => go(t)}
            >
              <span className="who" style={{ color: t.messages[0]?.author.color }}>
                {t.messages[0]?.author.name}
              </span>
              <span className="text">{t.messages[0]?.text}</span>
              <span className="muted small">
                {t.messages.length > 1
                  ? `${t.messages.length - 1} repl${t.messages.length > 2 ? 'ies' : 'y'} · `
                  : ''}
                {ago(t.messages[t.messages.length - 1]?.at ?? t.createdAt)}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Left panel tab: an icon with the number of open threads. */
export function CommentsTab({ active }: { active: boolean }) {
  const open = useComments().filter((t) => !t.resolved).length;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label="Comments"
      title="Comments"
      className={`tab-icon${active ? ' active' : ''}`}
      onClick={() => useUI.getState().set({ leftTab: 'comments' })}
      data-testid="tab-comments"
    >
      <MessageSquare size={15} />
      {open > 0 && <span className="tab-badge">{open}</span>}
    </button>
  );
}
