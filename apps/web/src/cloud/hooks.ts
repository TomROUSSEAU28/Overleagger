import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useEditor } from '../editor/context';
import { useUI } from '../store/ui';
import type { SessionState } from './session';

/** State of a local project: the only person is the owner. */
const localSession = create<SessionState>(() => ({
  status: 'connected',
  synced: true,
  unsynced: 0,
  role: 'owner',
  refused: null,
  peers: [],
  following: null,
  members: [],
}));

/** Read the collaboration state (works for local projects too). */
export function useSession<T>(sel: (s: SessionState) => T): T {
  const ed = useEditor();
  return (ed.session?.state ?? localSession)(sel);
}

/** May the local user edit the current sheet? Re-renders when the role or the locks change. */
export function useCanEdit(): boolean {
  const ed = useEditor();
  useSession((s) => s.role);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    ed.project.locks.observe(h);
    return () => ed.project.locks.unobserve(h);
  }, [ed]);
  return ed.canEdit(sheetId);
}
