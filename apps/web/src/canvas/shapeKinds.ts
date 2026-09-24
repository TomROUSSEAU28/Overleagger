import type { ShapeKind } from '@overleagger/core';

/** Basic shapes, then the flowchart (ISO 5807) ones. */
export const SHAPE_KINDS: { kind: ShapeKind; label: string; flow?: boolean }[] = [
  { kind: 'rect', label: 'Rectangle / process' },
  { kind: 'ellipse', label: 'Ellipse / connector' },
  { kind: 'diamond', label: 'Diamond / decision' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'terminator', label: 'Start / end', flow: true },
  { kind: 'data', label: 'Input / output (data)', flow: true },
  { kind: 'document', label: 'Document', flow: true },
  { kind: 'predefined', label: 'Predefined process (subroutine)', flow: true },
  { kind: 'database', label: 'Database / storage', flow: true },
  { kind: 'manual-input', label: 'Manual input', flow: true },
  { kind: 'preparation', label: 'Preparation (loop, init)', flow: true },
  { kind: 'delay', label: 'Delay', flow: true },
  { kind: 'manual-op', label: 'Manual operation', flow: true },
  { kind: 'offpage', label: 'Off-page connector', flow: true },
];
