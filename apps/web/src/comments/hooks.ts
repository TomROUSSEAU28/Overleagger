import type { CommentThread, Person } from '@overleagger/core';
import { useMemo } from 'react';
import { useCloud } from '../cloud/cloud';
import { useDocVersion, useEditor } from '../editor/context';

/** Who writes comments here: the signed-in person, or "Me" in a local project. */
export function useMe(): Person {
  const ed = useEditor();
  const user = useCloud((s) => s.user);
  return (
    ed.session?.person ??
    (user
      ? { id: user.id, name: user.name, color: user.color }
      : { id: 'me', name: 'Me', color: '#2f5d9e' })
  );
}

/**
 * Comment threads of the project. Threads of a deleted sheet are left out (they come back if the
 * deletion is undone).
 */
export function useComments(): CommentThread[] {
  const ed = useEditor();
  const v = useDocVersion();
  return useMemo(
    () => ed.project.getComments().filter((t) => ed.project.hasSheet(t.sheetId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ed, v],
  );
}
