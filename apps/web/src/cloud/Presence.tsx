/**
 * Live presence on the canvas: what I share (sheet, cursor, view, selection) and what I see of
 * the others (their cursor with their name, their selection), plus "follow" mode.
 */
import { elementBBox, rectUnion, type Element, type Rect } from '@overleagger/core';
import { useMemo } from 'react';
import type { RenderOptions } from '../canvas/render/style';
import { useEditor } from '../editor/context';
import { useUI } from '../store/ui';
import { useSession } from './hooks';

/** Other people's cursors and selections on this sheet (canvas overlay, world coordinates). */
export function RemoteOverlay({
  elements,
  o,
  zoom,
}: {
  elements: Element[];
  o: RenderOptions;
  zoom: number;
}) {
  const ed = useEditor();
  const peers = useSession((s) => s.peers);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const here = peers.filter((p) => p.sheetId === sheetId);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  if (!here.length) return null;
  const k = 1 / zoom;
  return (
    <g className="remote" pointerEvents="none">
      {here.map((p) => {
        const sel = (p.selection ?? [])
          .map((id) => byId.get(id))
          .filter((e): e is Element => Boolean(e) && e!.type !== 'group');
        const box: Rect | undefined = sel.length
          ? rectUnion(sel.map((e) => elementBBox(e, o.ctx, elements)))
          : undefined;
        return (
          <g key={p.clientId}>
            {box && (
              <rect
                x={box.x - 5 * k}
                y={box.y - 5 * k}
                width={box.w + 10 * k}
                height={box.h + 10 * k}
                fill="none"
                stroke={p.user.color}
                strokeWidth={1.4 * k}
                strokeDasharray={`${5 * k} ${3 * k}`}
                rx={3 * k}
              />
            )}
            {p.cursor && (
              <g
                className="remote-cursor"
                transform={`translate(${p.cursor.x} ${p.cursor.y}) scale(${k})`}
                data-testid="remote-cursor"
              >
                <path
                  d="M0 0 L0 15 L4 11 L7.5 18 L10 17 L6.8 10.2 L12 10.2 Z"
                  fill={p.user.color}
                  stroke="#fff"
                  strokeWidth={1.2}
                  strokeLinejoin="round"
                />
                <g transform="translate(12 18)">
                  <rect
                    rx={4}
                    width={p.user.name.length * 6.6 + 12}
                    height={17}
                    fill={p.user.color}
                  />
                  <text x={6} y={12.3} fontSize={11} fill="#fff" fontFamily="system-ui, sans-serif">
                    {p.user.name}
                  </text>
                </g>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
