import { sheetTree, type SheetNode } from '@overleagger/core';
import { FileText, Lock, LockOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '../cloud/hooks';
import { useEditor, useSheets } from '../editor/context';
import { useUI } from '../store/ui';

function Node({
  node,
  depth,
  current,
  onOpen,
  lockable,
}: {
  node: SheetNode;
  depth: number;
  current: string;
  onOpen: (id: string) => void;
  /** The owner of a shared project can lock sheets. */
  lockable: boolean;
}) {
  const ed = useEditor();
  const lock = ed.project.getLock(node.sheet.id);
  return (
    <li>
      <div className="sheet-row">
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
          {lock && !lockable && <Lock size={12} className="lock-mark" />}
        </button>
        {lockable && (
          <button
            type="button"
            className={`icon-btn lock-btn${lock ? ' on' : ''}`}
            title={
              lock
                ? `Locked by ${lock.by.name}: click to let editors change it again`
                : 'Lock: only you (the owner) can change this sheet'
            }
            onClick={() => ed.project.setLock(node.sheet.id, lock ? null : ed.session!.person)}
            data-testid={`lock-${node.sheet.name}`}
          >
            {lock ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <Node
              key={c.sheet.id}
              node={c}
              depth={depth + 1}
              current={current}
              onOpen={onOpen}
              lockable={lockable}
            />
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
  const role = useSession((s) => s.role);
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    ed.project.locks.observe(h);
    return () => ed.project.locks.unobserve(h);
  }, [ed]);
  const tree = sheetTree(ed.project);
  if (!tree) return null;
  return (
    <div className="sheets">
      <p className="muted pad small">
        Every hierarchical block opens its own sheet. Double-click a block (or press ↵) to enter it,
        Esc to go back up.
      </p>
      <ul className="sheet-tree">
        <Node
          node={tree}
          depth={0}
          current={current}
          onOpen={(id) => ed.openSheet(id)}
          lockable={Boolean(ed.session) && role === 'owner'}
        />
      </ul>
    </div>
  );
}
