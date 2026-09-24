import { useEffect } from 'react';
import { useEditor } from '../editor/context';
import { useUI } from '../store/ui';
import { useSession } from './hooks';
import { throttle } from './session';

/** Publish my sheet, cursor, view and selection (only for cloud projects). */
export function usePresencePublisher() {
  const ed = useEditor();
  useEffect(() => {
    const s = ed.session;
    if (!s) return;
    const push = throttle(() => {
      const ui = useUI.getState();
      const sheetId = ui.sheetId ?? ed.project.rootSheetId;
      const vp = ui.viewports[sheetId];
      s.setPresence({
        sheetId,
        cursor: ui.cursor,
        selection: ui.selection,
        ...(vp ? { viewport: { ...vp, w: ed.canvasSize.w, h: ed.canvasSize.h } } : {}),
      });
    }, 50);
    push();
    const off = useUI.subscribe((a, b) => {
      if (
        a.cursor !== b.cursor ||
        a.sheetId !== b.sheetId ||
        a.selection !== b.selection ||
        a.viewports !== b.viewports
      )
        push();
    });
    return off;
  }, [ed]);
}

/**
 * Follow someone: show the sheet they look at, the same area, until I move the view myself.
 */
export function useFollow() {
  const ed = useEditor();
  const following = useSession((s) => s.following);
  const peers = useSession((s) => s.peers);
  const target = following ? peers.find((p) => p.user.id === following) : undefined;

  useEffect(() => {
    if (!following || !ed.session) return;
    let applied: unknown = null;
    // Moving the view myself stops following.
    const off = useUI.subscribe((a, b) => {
      if (a.viewports === b.viewports) return;
      const cur = a.viewports[a.sheetId ?? ''];
      if (cur && cur !== applied) ed.session?.state.setState({ following: null });
    });
    const apply = () => {
      const p = ed.session?.state.getState().peers.find((x) => x.user.id === following);
      if (!p?.sheetId || !ed.project.hasSheet(p.sheetId)) return;
      const ui = useUI.getState();
      if (ui.sheetId !== p.sheetId) ed.openSheet(p.sheetId);
      const v = p.viewport;
      if (!v) return;
      // Show the same world area, centred, scaled to my window.
      const k = Math.min(ed.canvasSize.w / v.w, ed.canvasSize.h / v.h);
      const zoom = v.zoom * k;
      const cx = (v.w / 2 - v.x) / v.zoom;
      const cy = (v.h / 2 - v.y) / v.zoom;
      const next = { x: ed.canvasSize.w / 2 - cx * zoom, y: ed.canvasSize.h / 2 - cy * zoom, zoom };
      applied = next;
      useUI.getState().setViewport(p.sheetId, next);
    };
    apply();
    const unsub = ed.session.state.subscribe((a, b) => {
      if (a.peers !== b.peers) apply();
    });
    return () => {
      off();
      unsub();
    };
  }, [ed, following]);

  return target;
}
