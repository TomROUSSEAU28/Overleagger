/** The drawing tools, in the groups of the tool rail. */
import {
  Activity,
  Box,
  Eraser,
  Hand,
  Image,
  Link,
  LogIn,
  MessageSquarePlus,
  MousePointer2,
  MoveRight,
  MoveUpRight,
  Pencil,
  Shapes,
  Spline,
  SquareDashed,
  StickyNote,
  Tag,
  Type,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCanEdit } from '../cloud/hooks';
import { useEditor } from '../editor/context';
import type { ActionId } from '../shortcuts/keymap';
import type { ToolId } from '../store/ui';

export interface ToolDef {
  tool: ToolId;
  action: ActionId;
  label: string;
  icon: ReactNode;
}

export const GROUPS: ToolDef[][] = [
  [
    { tool: 'select', action: 'tool.select', label: 'Select', icon: <MousePointer2 size={18} /> },
    { tool: 'pan', action: 'tool.pan', label: 'Pan', icon: <Hand size={18} /> },
    {
      tool: 'comment',
      action: 'tool.comment',
      label: 'Comment',
      icon: <MessageSquarePlus size={18} />,
    },
  ],
  [
    { tool: 'wire', action: 'tool.wire', label: 'Wire', icon: <Spline size={18} /> },
    { tool: 'signal', action: 'tool.signal', label: 'Signal line', icon: <MoveRight size={18} /> },
    { tool: 'block', action: 'tool.block', label: 'Hierarchical block', icon: <Box size={18} /> },
    { tool: 'port', action: 'tool.port', label: 'Sheet port', icon: <LogIn size={18} /> },
    { tool: 'label', action: 'tool.label', label: 'Net label', icon: <Tag size={18} /> },
    {
      tool: 'flow',
      action: 'tool.flow',
      label: 'Animated current (select wires first, or draw its path)',
      icon: <Zap size={18} />,
    },
  ],
  [
    { tool: 'text', action: 'tool.text', label: 'Text / LaTeX', icon: <Type size={18} /> },
    { tool: 'draw', action: 'tool.draw', label: 'Pencil', icon: <Pencil size={18} /> },
    { tool: 'eraser', action: 'tool.eraser', label: 'Eraser', icon: <Eraser size={18} /> },
    { tool: 'shape', action: 'tool.shape', label: 'Shape', icon: <Shapes size={18} /> },
    { tool: 'line', action: 'tool.line', label: 'Line / arrow', icon: <MoveUpRight size={18} /> },
    { tool: 'note', action: 'tool.note', label: 'Sticky note', icon: <StickyNote size={18} /> },
    { tool: 'image', action: 'tool.image', label: 'Image', icon: <Image size={18} /> },
    { tool: 'button', action: 'tool.button', label: 'Link button', icon: <Link size={18} /> },
    { tool: 'waveform', action: 'tool.waveform', label: 'Waveform', icon: <Activity size={18} /> },
    { tool: 'frame', action: 'tool.frame', label: 'Frame', icon: <SquareDashed size={18} /> },
  ],
];

/** The tools this person may use here, in groups. */
export function useToolGroups(): ToolDef[][] {
  const ed = useEditor();
  const canEdit = useCanEdit();
  const canComment = ed.project.canWrite(ed.sheetId, 'comments');
  // Read-only: keep select, pan and (if allowed) comment.
  return canEdit ? GROUPS : [GROUPS[0]!.filter((t) => t.tool !== 'comment' || canComment)];
}

/** Every tool, including the ones only reached from the library ("place"). */
export const TOOL_DEFS: ToolDef[] = GROUPS.flat();
