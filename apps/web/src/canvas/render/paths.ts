/** Scale an SVG path (absolute M L H V C Q A Z commands) from grid units to px. */
export function scalePath(d: string, s: number): string {
  const tokens = d.match(/[MLHVCQAZmlhvcqaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let cmd = '';
  let idx = 0;
  const out: string[] = [];
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) {
      cmd = t.toUpperCase();
      idx = 0;
      out.push(cmd);
      continue;
    }
    const v = Number(t);
    // Arc: rx ry rot large sweep x y — do not scale rot/flags.
    const scaled = cmd === 'A' ? ([2, 3, 4].includes(idx % 7) ? v : v * s) : v * s;
    out.push(String(Math.round(scaled * 1000) / 1000));
    idx++;
  }
  return out.join(' ');
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const rad = (a: number) => (a * Math.PI) / 180;
  const sweep = a1 - a0;
  if (Math.abs(sweep) >= 359.999) {
    return `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`;
  }
  const x0 = cx + r * Math.cos(rad(a0));
  const y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const large = Math.abs(sweep) > 180 ? 1 : 0;
  const dir = sweep > 0 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${dir} ${x1} ${y1}`;
}
