/**
 * Keyboard shortcuts: a registry of actions with default key combos, user overrides stored in
 * localStorage, and helpers to normalize keyboard events into combo strings like "mod+shift+z".
 */

export type ActionId =
  | 'tool.select'
  | 'tool.pan'
  | 'tool.wire'
  | 'tool.signal'
  | 'tool.block'
  | 'tool.port'
  | 'tool.label'
  | 'tool.text'
  | 'tool.draw'
  | 'tool.eraser'
  | 'tool.shape'
  | 'tool.line'
  | 'tool.note'
  | 'tool.image'
  | 'tool.button'
  | 'tool.waveform'
  | 'tool.frame'
  | 'tool.comment'
  | 'edit.toBlock'
  | 'edit.quickAdd'
  | 'edit.rotate'
  | 'edit.rotateCcw'
  | 'edit.mirrorX'
  | 'edit.mirrorY'
  | 'edit.delete'
  | 'edit.duplicate'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.selectAll'
  | 'edit.group'
  | 'edit.ungroup'
  | 'edit.front'
  | 'edit.back'
  | 'edit.forward'
  | 'edit.backward'
  | 'edit.nudgeLeft'
  | 'edit.nudgeRight'
  | 'edit.nudgeUp'
  | 'edit.nudgeDown'
  | 'edit.nudgeLeftBig'
  | 'edit.nudgeRightBig'
  | 'edit.nudgeUpBig'
  | 'edit.nudgeDownBig'
  | 'edit.cancel'
  | 'edit.rename'
  | 'nav.enter'
  | 'nav.up'
  | 'view.fit'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.zoomReset'
  | 'view.grid'
  | 'view.leftPanel'
  | 'view.rightPanel'
  | 'file.export'
  | 'file.copyImage'
  | 'view.present'
  | 'help.shortcuts'
  | 'wire.flipBend';

export interface ActionDef {
  id: ActionId;
  label: string;
  category: 'Tools' | 'Edit' | 'Hierarchy' | 'View' | 'File' | 'Help';
  keys: string[];
}

export const ACTIONS: ActionDef[] = [
  { id: 'tool.select', label: 'Select tool', category: 'Tools', keys: ['v'] },
  { id: 'tool.pan', label: 'Pan tool (or hold Space)', category: 'Tools', keys: ['h'] },
  { id: 'tool.wire', label: 'Wire', category: 'Tools', keys: ['w'] },
  { id: 'tool.signal', label: 'Signal line (arrow)', category: 'Tools', keys: ['shift+w'] },
  { id: 'tool.block', label: 'Hierarchical block', category: 'Tools', keys: ['b'] },
  { id: 'tool.port', label: 'Sheet port', category: 'Tools', keys: ['p'] },
  { id: 'tool.label', label: 'Net label', category: 'Tools', keys: ['l'] },
  { id: 'tool.text', label: 'Text / LaTeX', category: 'Tools', keys: ['t'] },
  { id: 'tool.draw', label: 'Pencil (freehand)', category: 'Tools', keys: ['d'] },
  { id: 'tool.eraser', label: 'Eraser', category: 'Tools', keys: ['e'] },
  { id: 'tool.shape', label: 'Shape (rectangle, ellipse…)', category: 'Tools', keys: ['s'] },
  { id: 'tool.line', label: 'Line / arrow', category: 'Tools', keys: ['shift+l'] },
  { id: 'tool.note', label: 'Sticky note', category: 'Tools', keys: ['n'] },
  { id: 'tool.image', label: 'Image', category: 'Tools', keys: ['i'] },
  { id: 'tool.button', label: 'Link button', category: 'Tools', keys: ['k'] },
  { id: 'tool.waveform', label: 'Waveform / oscillogram', category: 'Tools', keys: ['o'] },
  { id: 'tool.frame', label: 'Frame', category: 'Tools', keys: ['shift+f'] },
  { id: 'tool.comment', label: 'Comment', category: 'Tools', keys: ['c'] },
  {
    id: 'edit.toBlock',
    label: 'Move selection into a new block',
    category: 'Hierarchy',
    keys: ['mod+shift+b'],
  },
  { id: 'edit.quickAdd', label: 'Quick add component', category: 'Edit', keys: ['a', 'mod+k'] },
  { id: 'edit.rotate', label: 'Rotate 90°', category: 'Edit', keys: ['r'] },
  { id: 'edit.rotateCcw', label: 'Rotate −90°', category: 'Edit', keys: ['shift+r'] },
  { id: 'edit.mirrorX', label: 'Mirror horizontally', category: 'Edit', keys: ['x'] },
  { id: 'edit.mirrorY', label: 'Mirror vertically', category: 'Edit', keys: ['y'] },
  { id: 'edit.delete', label: 'Delete', category: 'Edit', keys: ['delete', 'backspace'] },
  { id: 'edit.duplicate', label: 'Duplicate', category: 'Edit', keys: ['mod+d'] },
  { id: 'edit.undo', label: 'Undo', category: 'Edit', keys: ['mod+z'] },
  { id: 'edit.redo', label: 'Redo', category: 'Edit', keys: ['mod+shift+z', 'mod+y'] },
  { id: 'edit.selectAll', label: 'Select all', category: 'Edit', keys: ['mod+a'] },
  { id: 'edit.group', label: 'Group', category: 'Edit', keys: ['mod+g'] },
  { id: 'edit.ungroup', label: 'Ungroup', category: 'Edit', keys: ['mod+shift+g'] },
  // Shift+] types "}" (and Shift+[ types "{"): the shifted symbol is the key.
  {
    id: 'edit.front',
    label: 'Bring to front',
    category: 'Edit',
    keys: ['mod+}', 'mod+shift+arrowup'],
  },
  {
    id: 'edit.back',
    label: 'Send to back',
    category: 'Edit',
    keys: ['mod+{', 'mod+shift+arrowdown'],
  },
  {
    id: 'edit.forward',
    label: 'Bring forward (one step)',
    category: 'Edit',
    keys: ['mod+]', 'mod+arrowup'],
  },
  {
    id: 'edit.backward',
    label: 'Send backward (one step)',
    category: 'Edit',
    keys: ['mod+[', 'mod+arrowdown'],
  },
  { id: 'edit.nudgeLeft', label: 'Nudge left', category: 'Edit', keys: ['arrowleft'] },
  { id: 'edit.nudgeRight', label: 'Nudge right', category: 'Edit', keys: ['arrowright'] },
  { id: 'edit.nudgeUp', label: 'Nudge up', category: 'Edit', keys: ['arrowup'] },
  { id: 'edit.nudgeDown', label: 'Nudge down', category: 'Edit', keys: ['arrowdown'] },
  { id: 'edit.nudgeLeftBig', label: 'Nudge left ×5', category: 'Edit', keys: ['shift+arrowleft'] },
  {
    id: 'edit.nudgeRightBig',
    label: 'Nudge right ×5',
    category: 'Edit',
    keys: ['shift+arrowright'],
  },
  { id: 'edit.nudgeUpBig', label: 'Nudge up ×5', category: 'Edit', keys: ['shift+arrowup'] },
  { id: 'edit.nudgeDownBig', label: 'Nudge down ×5', category: 'Edit', keys: ['shift+arrowdown'] },
  { id: 'edit.cancel', label: 'Cancel / deselect / go up', category: 'Edit', keys: ['escape'] },
  { id: 'edit.rename', label: 'Edit text of selection', category: 'Edit', keys: ['f2'] },
  {
    id: 'nav.enter',
    label: 'Open block (enter sub-sheet)',
    category: 'Hierarchy',
    keys: ['enter'],
  },
  { id: 'nav.up', label: 'Go to parent sheet', category: 'Hierarchy', keys: ['alt+arrowup', 'u'] },
  { id: 'view.fit', label: 'Zoom to fit', category: 'View', keys: ['f'] },
  { id: 'view.zoomIn', label: 'Zoom in', category: 'View', keys: ['=', '+', 'mod+='] },
  { id: 'view.zoomOut', label: 'Zoom out', category: 'View', keys: ['-', 'mod+-'] },
  { id: 'view.zoomReset', label: 'Zoom 100 %', category: 'View', keys: ['mod+0', '0'] },
  { id: 'view.grid', label: 'Show / hide grid', category: 'View', keys: ['g'] },
  { id: 'view.leftPanel', label: 'Toggle library panel', category: 'View', keys: ['mod+\\'] },
  {
    id: 'view.rightPanel',
    label: 'Toggle properties panel',
    category: 'View',
    keys: ['mod+shift+\\'],
  },
  {
    id: 'view.present',
    label: 'Present (slides from frames and sheets)',
    category: 'View',
    keys: ['f5', 'mod+enter'],
  },
  { id: 'file.export', label: 'Export…', category: 'File', keys: ['mod+e'] },
  {
    id: 'file.copyImage',
    label: 'Copy the selection (or the sheet) as an image',
    category: 'File',
    keys: ['shift+c'],
  },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', category: 'Help', keys: ['?'] },
  { id: 'wire.flipBend', label: 'Flip wire bend (while drawing)', category: 'Tools', keys: ['/'] },
];

/** Shortcuts handled by the browser clipboard events (shown in help, not rebindable). */
export const FIXED_SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: 'Copy', keys: ['mod+c'] },
  { label: 'Cut', keys: ['mod+x'] },
  { label: 'Paste', keys: ['mod+v'] },
  { label: 'Pan', keys: ['space+drag', 'middle mouse'] },
  { label: 'Zoom', keys: ['mod+wheel', 'pinch'] },
  { label: 'Select inside a group', keys: ['alt+click'] },
];

const STORAGE_KEY = 'olg.keymap';

export type Keymap = Record<ActionId, string[]>;

export function defaultKeymap(): Keymap {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]])) as Keymap;
}

export function loadKeymap(): Keymap {
  const km = defaultKeymap();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const over = JSON.parse(raw) as Partial<Keymap>;
      for (const [id, keys] of Object.entries(over))
        if (id in km && Array.isArray(keys)) km[id as ActionId] = keys;
    }
  } catch {
    // ignore
  }
  return km;
}

export function saveKeymap(km: Keymap) {
  const def = defaultKeymap();
  const diff: Partial<Keymap> = {};
  for (const a of ACTIONS)
    if (JSON.stringify(km[a.id]) !== JSON.stringify(def[a.id])) diff[a.id] = km[a.id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch {
    // ignore
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Convert a keyboard event to a combo string (e.g. "mod+shift+z"). */
export function eventToCombo(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string {
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  if (key === 'esc') key = 'escape';
  if (key === 'del') key = 'delete';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  // Shift is implied by printable symbols such as "?" or "+".
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (e.shiftKey && !symbol) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

export function normalizeCombo(combo: string): string {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const mods = ['mod', 'alt', 'shift'].filter((m) => parts.includes(m));
  return [...mods, key || '+'].join('+');
}

export function buildLookup(km: Keymap): Map<string, ActionId> {
  const m = new Map<string, ActionId>();
  for (const a of ACTIONS) for (const k of km[a.id] ?? []) m.set(normalizeCombo(k), a.id);
  return m;
}

/** Actions that already use `combo` (for conflict warnings). */
export function conflicts(km: Keymap, combo: string, except?: ActionId): ActionId[] {
  const n = normalizeCombo(combo);
  return ACTIONS.filter(
    (a) => a.id !== except && (km[a.id] ?? []).some((k) => normalizeCombo(k) === n),
  ).map((a) => a.id);
}

/** Pretty label for a combo: "mod+shift+z" → "Ctrl Shift Z" (⌘ on Mac). */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .filter(Boolean)
    .map((p) => {
      switch (p) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'arrowleft':
          return '←';
        case 'arrowright':
          return '→';
        case 'arrowup':
          return '↑';
        case 'arrowdown':
          return '↓';
        case 'escape':
          return 'Esc';
        case 'delete':
          return 'Del';
        case 'backspace':
          return '⌫';
        case 'enter':
          return '↵';
        case 'space':
          return 'Space';
        default:
          return p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1);
      }
    })
    .join(isMac ? '' : ' ');
}
