import type { Element, Id, ProjectMeta, SheetInfo } from '@overleagger/core';
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { EditorController } from './controller';

export const EditorContext = createContext<EditorController | null>(null);

export function useEditor(): EditorController {
  const ed = useContext(EditorContext);
  if (!ed) throw new Error('useEditor outside of an editor');
  return ed;
}

/** Re-render on every document change. */
export function useDocVersion(): number {
  const ed = useEditor();
  return useSyncExternalStore(
    (fn) => ed.project.subscribe(fn),
    () => ed.project.version,
  );
}

export function useSheetElements(sheetId: Id): Element[] {
  const ed = useEditor();
  const v = useDocVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ed.project.getElements(sheetId), [ed, sheetId, v]);
}

export function useMeta(): ProjectMeta {
  const ed = useEditor();
  const v = useDocVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ed.project.getMeta(), [ed, v]);
}

export function useSheets(): SheetInfo[] {
  const ed = useEditor();
  const v = useDocVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ed.project.listSheets(), [ed, v]);
}

export function useUndoState(): { canUndo: boolean; canRedo: boolean } {
  const ed = useEditor();
  useDocVersion();
  return { canUndo: ed.undo.canUndo(), canRedo: ed.undo.canRedo() };
}

/** Counter bumped when the project's custom symbols change (to refresh memoized views). */
export function useSymbolsVersion(): number {
  const ed = useEditor();
  const ref = useMemo(() => ({ v: 0 }), []);
  return useSyncExternalStore(
    (fn) => {
      const h = () => {
        ref.v++;
        fn();
      };
      ed.project.symbols.observe(h);
      return () => ed.project.symbols.unobserve(h);
    },
    () => ref.v,
  );
}
