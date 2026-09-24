import { sheetTree, type SheetNode } from '@overleagger/core';
import { FileText } from 'lucide-react';
import { useEditor, useSheets } from '../editor/context';
import { useUI } from '../store/ui';

function Node({
  node,
  depth,
  current,
  onOpen,
}: {
  node: SheetNode;
  depth: number;
  current: string;
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`sheet-node${node.sheet.id === current ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onOpen(node.sheet.id)}
        data-testid={`sheet-${node.sheet.name}`}
      >
        <FileText size={14} />
        <span>{node.sheet.name || 'Untitled'}</span>
        {node.children.length > 0 && <span className="count">{node.children.length}</span>}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <Node key={c.sheet.id} node={c} depth={depth + 1} current={current} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SheetsPanel() {
  const ed = useEditor();
  useSheets();
  const current = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const tree = sheetTree(ed.project);
  if (!tree) return null;
  return (
    <div className="sheets">
      <p className="muted pad small">
        Every hierarchical block opens its own sheet. Double-click a block (or press ↵) to enter it,
        Esc to go back up.
      </p>
      <ul className="sheet-tree">
        <Node node={tree} depth={0} current={current} onOpen={(id) => ed.openSheet(id)} />
      </ul>
    </div>
  );
}
