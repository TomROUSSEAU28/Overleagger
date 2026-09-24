import { sheetTree, type SheetNode } from '@overleagger/core';
import { Eye, FileText, Lock, LockOpen, MessageSquare, Pencil, UserCog } from 'lucide-react';
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
  const role = useSession((s) => s.role);
  const rules = useSession((s) => s.rules);
  const id = node.sheet.id;
  // Owner: sheets with special access. Others: sheets where they have other rights than usual.
  const special = role === 'owner' ? rules.filter((r) => r.sheetId === id) : [];
  const level = ed.session && role !== 'owner' ? ed.session.levelOf(id) : role;
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
          {level !== role && (
            <span
              className="access-mark"
              title={`You ${level === 'editor' ? 'can edit' : level === 'commenter' ? 'can comment on' : 'can only view'} this sheet`}
            >
              {level === 'editor' ? (
                <Pencil size={11} />
              ) : level === 'commenter' ? (
                <MessageSquare size={11} />
              ) : (
                <Eye size={11} />
              )}
            </span>
          )}
        </button>
        {special.length > 0 && (
          <button
            type="button"
            className="icon-btn access-btn"
            title={`Special access for ${special.length} ${special.length === 1 ? 'person or team' : 'people or teams'}: click to change`}
            onClick={() => useUI.getState().set({ shareOpen: { sheetId: id } })}
            data-testid={`access-${node.sheet.name}`}
          >
            <UserCog size={13} />
          </button>
        )}
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
