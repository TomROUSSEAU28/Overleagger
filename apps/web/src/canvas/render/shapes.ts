import { lineControlPoint, textWidth, type LineElement } from '@overleagger/core';
import { getStroke } from 'perfect-freehand';

export function linePath(el: Pick<LineElement, 'pts' | 'bend'>): string {
  const [x1, y1, x2, y2] = el.pts as [number, number, number, number];
  if (!el.bend) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const c = lineControlPoint(el.pts, el.bend);
  return `M ${x1} ${y1} Q ${c.x} ${c.y} ${x2} ${y2}`;
}

/** Outline polygon from perfect-freehand → smooth SVG path. */
export function strokePath(pts: number[], size: number, highlighter = false): string {
  const input: [number, number, number][] = [];
  let pressure = false;
  for (let i = 0; i < pts.length; i += 3) {
    const p = pts[i + 2]!;
    if (p !== 0.5) pressure = true;
    input.push([pts[i]!, pts[i + 1]!, p]);
  }
  const outline = getStroke(input, {
    size,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !pressure && !highlighter,
    last: true,
  });
  if (!outline.length) return '';
  const d = outline.reduce<string[]>((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length]!;
    acc.push(
      `${x0!.toFixed(2)},${y0!.toFixed(2)} ${((x0! + x1!) / 2).toFixed(2)},${((y0! + y1!) / 2).toFixed(2)}`,
    );
    return acc;
  }, []);
  return `M ${d[0]!.split(' ')[0]} Q ${d.join(' ')} Z`;
}

/**
 * Greedy word wrap using the same width estimate as the rest of the app. `$…$` formulas are
 * kept whole (a formula is never split across lines).
 */
export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const tokens = para.match(/\$[^$]*\$|\s+|[^\s$]+|\$/g) ?? [];
    let line = '';
    for (const tok of tokens) {
      const next = line + tok;
      if (line.trim() && !/^\s+$/.test(tok) && textWidth(next.trim(), size) > maxWidth) {
        out.push(line.trim());
        line = tok;
      } else line = next;
    }
    out.push(line.trim());
  }
  return out;
}
