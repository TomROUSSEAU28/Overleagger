/**
 * CircuiTikZ / TikZ export of one sheet, ready to paste into a LaTeX report.
 *
 * - Common two-terminal parts (R, C, L, diodes…) become native CircuiTikZ bipoles drawn between
 *   their two pins, so they follow the document's CircuiTikZ style.
 * - Every other part is drawn from its own primitives with plain TikZ paths: the drawing is
 *   exactly the one on screen (MOSFETs with body diode, bridges, control blocks…).
 * - Wires, junction dots, labels, text (with `$…$` math), blocks, ports, shapes, arrows, notes,
 *   waveforms and frames are exported too. Images are skipped (a comment says where).
 *
 * Coordinates: 1 grid unit (10 px) = UNIT cm, y pointing up as in TikZ.
 */
import {
  GRID,
  analyzeConnectivity,
  blockLayout,
  componentLabels,
  componentPoint,
  elementPins,
  lineControlPoint,
  linePoints,
  polylineMiddle,
  shapeGeometry,
  portShape,
  portTextPos,
  resolveComponent,
  type ComponentElement,
  type Element,
  type Id,
  type Project,
  type SheetContext,
  type WaveformElement,
} from '@overleagger/core';
import { fillTemplate, type Primitive } from '@overleagger/symbols';
import { sampleTrace } from '../canvas/render/waveforms';
import { DEFAULT_STROKE, THEMES, resolveColor, resolveNoteColor } from '../theme';

export interface TikzOptions {
  /** Complete `standalone` document (compiles on its own) instead of the bare environment. */
  standalone: boolean;
  /** Centimetres per grid unit. */
  unit?: number;
}

/** Native CircuiTikZ bipoles: symbol → [bipole, start pin, end pin]. */
const BIPOLES: Record<string, [string, string, string]> = {
  resistor: ['R', '1', '2'],
  capacitor: ['C', '1', '2'],
  'capacitor-polarized': ['eC', '+', '-'],
  diode: ['D', 'a', 'k'],
  'diode-schottky': ['sD', 'a', 'k'],
  'diode-zener': ['zD', 'a', 'k'],
  led: ['leD', 'a', 'k'],
  photodiode: ['pD', 'a', 'k'],
  fuse: ['fuse', '1', '2'],
  inductor: ['L', '1', '2'],
};

const theme = THEMES.paper;

function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** LaTeX-safe text: `$…$` segments stay math, the rest is escaped. */
export function texText(s: string): string {
  return s
    .split(/(\$[^$]*\$)/g)
    .map((part) =>
      part.startsWith('$') && part.endsWith('$') && part.length > 1
        ? part
        : part
            .replace(/\\/g, '\\textbackslash{}')
            .replace(/([#%&_{}])/g, '\\$1')
            .replace(/\^/g, '\\^{}')
            .replace(/~/g, '\\~{}')
            .replace(/Ω/g, '$\\Omega$')
            .replace(/[µμ]/g, '$\\mu$')
            .replace(/°/g, '$^\\circ$')
            .replace(/−/g, '$-$')
            .replace(/\n/g, '\\\\ '),
    )
    .join('');
}

class Writer {
  lines: string[] = [];
  colors = new Map<string, string>();
  constructor(readonly unit: number) {}

  /** World px → TikZ coordinate string. */
  p(x: number, y: number): string {
    return `(${num((x / GRID) * this.unit)},${num((-y / GRID) * this.unit)})`;
  }
  len(px: number): string {
    return `${num((px / GRID) * this.unit)}cm`;
  }
  color(css: string | undefined): string | undefined {
    if (!css || css.toLowerCase() === theme.ink.toLowerCase()) return undefined;
    const hex = css.replace('#', '').toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(hex)) return undefined;
    let name = this.colors.get(hex);
    if (!name) {
      name = `sb${this.colors.size + 1}`;
      this.colors.set(hex, name);
    }
    return name;
  }
  emit(s: string) {
    this.lines.push(s);
  }
}

type Style = { color?: string; width?: number; dash?: string; fill?: string };

function opts(w: Writer, s: Style, extra: string[] = []): string {
  const o = [...extra];
  if (s.color) o.push(`color=${s.color}`);
  if (s.width !== undefined && Math.abs(s.width - 1) > 0.01)
    o.push(`line width=${num(0.6 * s.width)}pt`);
  if (s.dash === 'dashed') o.push('dashed');
  if (s.dash === 'dotted') o.push('dotted');
  if (s.fill) o.push(`fill=${s.fill}`);
  return o.length ? `[${o.join(', ')}]` : '';
}

function elStyle(w: Writer, el: Element): Style {
  const st = el.style;
  return {
    ...(st?.color ? { color: w.color(resolveColor(st.color, theme)) } : {}),
    ...(st?.width !== undefined ? { width: st.width / DEFAULT_STROKE } : {}),
    ...(st?.dash && st.dash !== 'solid' ? { dash: st.dash } : {}),
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function arcPoints(p: Extract<Primitive, { k: 'arc' }>): [number, number][] {
  const n = Math.max(6, Math.ceil((p.a1 - p.a0) / 12));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((p.a0 + ((p.a1 - p.a0) * i) / n) * Math.PI) / 180;
    out.push([p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)]);
  }
  return out;
}

function component(w: Writer, el: ComponentElement, ctx: SheetContext) {
  const r = resolveComponent(el, ctx);
  const base = elStyle(w, el);
  if (!r) {
    w.emit(`% unknown part ${el.symbolId} (${el.ref})`);
    return;
  }
  const bip = BIPOLES[el.symbolId];
  // An inductor with a magnetic core keeps its exact drawing (CircuiTikZ has no core lines).
  const plain = el.symbolId !== 'inductor' || !el.opts.core || el.opts.core === 'none';
  if (bip && plain && (el.scale ?? 1) === 1) {
    const pins = elementPins(el, ctx);
    const a = pins.find((q) => q.pinId === bip[1]);
    const b = pins.find((q) => q.pinId === bip[2]);
    if (a && b) {
      const kind =
        el.symbolId === 'inductor' && el.opts.style !== 'block' ? 'cute inductor' : bip[0];
      w.emit(`\\draw${opts(w, base)} ${w.p(a.x, a.y)} to[${kind}] ${w.p(b.x, b.y)};`);
      labels(w, el, ctx);
      return;
    }
  }
  const pt = (gx: number, gy: number) => {
    const q = componentPoint(el, gx, gy);
    return w.p(q.x, q.y);
  };
  const k = el.scale ?? 1;
  for (const p of r.prims) {
    const s: Style = {
      ...base,
      ...(p.k !== 'text' && p.sw !== undefined ? { width: (base.width ?? 1) * p.sw } : {}),
      ...(p.k !== 'text' && p.dash ? { dash: p.dash } : {}),
    };
    const fill =
      p.k !== 'text' && p.fill === 'ink'
        ? (base.color ?? 'black')
        : p.k !== 'text' && p.fill === 'paper'
          ? 'white'
          : undefined;
    const noStroke = p.k !== 'text' && p.sw === 0;
    const cmd = fill ? (noStroke ? '\\fill' : '\\filldraw') : '\\draw';
    const o = opts(w, { ...s, ...(fill ? { fill } : {}) });
    if (noStroke && !fill) continue;
    switch (p.k) {
      case 'line':
        w.emit(`${cmd}${o} ${pt(p.x1, p.y1)} -- ${pt(p.x2, p.y2)};`);
        break;
      case 'poly': {
        const pts: string[] = [];
        for (let i = 0; i < p.pts.length; i += 2) pts.push(pt(p.pts[i]!, p.pts[i + 1]!));
        w.emit(`${cmd}${o} ${pts.join(' -- ')}${p.closed ? ' -- cycle' : ''};`);
        break;
      }
      case 'circle':
        w.emit(`${cmd}${o} ${pt(p.cx, p.cy)} circle[radius=${w.len(p.r * GRID * k)}];`);
        break;
      case 'arc':
        w.emit(
          `${cmd}${o} ${arcPoints(p)
            .map(([x, y]) => pt(x, y))
            .join(' -- ')};`,
        );
        break;
      case 'rect':
        w.emit(
          `${cmd}${o} ${pt(p.x, p.y)} -- ${pt(p.x + p.w, p.y)} -- ${pt(p.x + p.w, p.y + p.h)} -- ${pt(p.x, p.y + p.h)} -- cycle;`,
        );
        break;
      case 'path':
        w.emit(`% (path primitive of ${el.symbolId} skipped)`);
        break;
      case 'text': {
        const t = fillTemplate(p.t, el.params);
        if (!t.trim()) break;
        const body = p.math ? `$${t.replace(/^\$|\$$/g, '')}$` : texText(t);
        const anchor = p.anchor === 'start' ? 'west' : p.anchor === 'end' ? 'east' : 'center';
        w.emit(
          `\\node[font=\\scriptsize, inner sep=0, anchor=${anchor}${base.color ? `, text=${base.color}` : ''}] at ${pt(p.x, p.y)} {${body}};`,
        );
        break;
      }
    }
  }
  labels(w, el, ctx);
}

function labels(w: Writer, el: ComponentElement, ctx: SheetContext) {
  const lay = componentLabels(el, ctx);
  if (!lay) return;
  const text = lay.lines
    .map((l) => (l.kind === 'ref' ? refTex(l.text) : texText(l.text)))
    .join('\\\\ ');
  const anchor = lay.anchor === 'start' ? 'west' : lay.anchor === 'end' ? 'east' : 'center';
  // `lay.y` is the middle of the first line: move to the middle of the block.
  const midY = lay.y + ((lay.lines.length - 1) * lay.lineHeight) / 2;
  w.emit(
    `\\node[font=\\small, align=${lay.anchor === 'start' ? 'left' : lay.anchor === 'end' ? 'right' : 'center'}, anchor=${anchor}, inner sep=1pt] at ${w.p(lay.x, midY)} {${text}};`,
  );
}

/** R1 → $R_{1}$, like the canvas does with “LaTeX references”. */
function refTex(ref: string): string {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  return m ? `$${m[1]}_{${m[2]}}$` : texText(ref);
}

// ---------------------------------------------------------------------------
// Other elements
// ---------------------------------------------------------------------------

/** Drop points that lie on a straight horizontal/vertical run (keeps square waves small). */
function simplify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i]!;
    const c = pts[i + 1];
    if (a && c && Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(b[1] - c[1]) < 1e-3) continue;
    out.push(b);
  }
  return out;
}

function waveform(w: Writer, el: WaveformElement) {
  const s = elStyle(w, el);
  const { x, y, h } = el;
  const padL = el.yLabel || el.layout === 'stacked' ? 34 : 14;
  const x0 = x + padL;
  const x1 = x + el.w - 18;
  const padT = 16;
  const padB = el.xLabel ? 20 : 10;
  const n = Math.max(1, el.traces.length);
  el.traces.forEach((tr, i) => {
    const top = el.layout === 'stacked' ? y + padT + (i * (h - padT - padB)) / n : y + padT;
    const bottom =
      el.layout === 'stacked' ? y + padT + ((i + 1) * (h - padT - padB)) / n - 6 : y + h - padB;
    const samples = sampleTrace(tr, 160);
    let lo = 0;
    let hi = 0;
    const all = el.layout === 'stacked' ? [samples] : el.traces.map((t) => sampleTrace(t, 160));
    for (const smp of all)
      for (let k = 1; k < smp.length; k += 2) {
        lo = Math.min(lo, smp[k]!);
        hi = Math.max(hi, smp[k]!);
      }
    if (hi - lo < 1e-6) hi = lo + 1;
    const vy = (v: number) => bottom - 4 - ((v - lo) / (hi - lo)) * (bottom - top - 8);
    if (el.axes && (el.layout === 'stacked' || i === 0)) {
      w.emit(`\\draw${opts(w, s, ['->'])} ${w.p(x0, vy(0))} -- ${w.p(x1 + 8, vy(0))};`);
      w.emit(`\\draw${opts(w, s, ['->'])} ${w.p(x0, bottom)} -- ${w.p(x0, top - 6)};`);
    }
    const pts: [number, number][] = [];
    for (let k = 0; k < samples.length; k += 2)
      pts.push([x0 + samples[k]! * (x1 - x0 - 6), vy(samples[k + 1]!)]);
    const color = tr.color ? w.color(resolveColor(tr.color, theme)) : s.color;
    w.emit(
      `\\draw${opts(w, { ...s, ...(color ? { color } : {}) })} ${simplify(pts)
        .map(([a, b]) => w.p(a, b))
        .join(' -- ')};`,
    );
    if (tr.label)
      w.emit(
        `\\node[font=\\scriptsize, anchor=east] at ${w.p(x0 - 3, (top + bottom) / 2)} {${texText(tr.label)}};`,
      );
  });
  if (el.xLabel)
    w.emit(
      `\\node[font=\\scriptsize, anchor=north east] at ${w.p(x1 + 8, y + h - padB + 2)} {${texText(el.xLabel)}};`,
    );
  if (el.yLabel)
    w.emit(
      `\\node[font=\\scriptsize, anchor=south west] at ${w.p(x0 + 2, y + 2)} {${texText(el.yLabel)}};`,
    );
}

function element(w: Writer, el: Element, all: Element[], ctx: SheetContext, sheetId: Id) {
  const s = elStyle(w, el);
  switch (el.type) {
    case 'component':
      return component(w, el, ctx);
    case 'wire': {
      const pts: string[] = [];
      for (let i = 0; i < el.pts.length; i += 2) pts.push(w.p(el.pts[i]!, el.pts[i + 1]!));
      const arrow =
        el.arrow === 'end'
          ? '-latex'
          : el.arrow === 'start'
            ? 'latex-'
            : el.arrow === 'both'
              ? 'latex-latex'
              : '';
      w.emit(`\\draw${opts(w, s, arrow ? [arrow] : [])} ${pts.join(' -- ')};`);
      return;
    }
    case 'label':
      w.emit(`\\draw${opts(w, s)} ${w.p(el.x, el.y)} -- ${w.p(el.x, el.y - 4)};`);
      w.emit(
        `\\node[font=\\small, anchor=south ${el.flip ? 'east' : 'west'}, inner sep=1pt] at ${w.p(el.x + (el.flip ? -2 : 2), el.y - 4)} {${texText(el.text)}};`,
      );
      return;
    case 'text': {
      const anchor =
        el.align === 'middle' ? 'base' : el.align === 'end' ? 'base east' : 'base west';
      const extra = el.frame
        ? ['draw', el.frame === 'round' ? 'rounded corners' : ''].filter(Boolean)
        : [];
      const align = el.align === 'middle' ? 'center' : el.align === 'end' ? 'right' : 'left';
      w.emit(
        `\\node[${[`anchor=${anchor}`, `align=${align}`, `font=\\fontsize{${num(el.size * 0.75)}}{${num(el.size * 0.95)}}\\selectfont`, ...extra, ...(s.color ? [`text=${s.color}`] : [])].join(', ')}] at ${w.p(el.x, el.y)} {${texText(el.text)}};`,
      );
      return;
    }
    case 'block': {
      const lay = blockLayout(el, ctx.ports(el.childSheetId));
      const bw = Math.max(el.w, ...lay.pins.map((p) => p.x - el.x));
      const bh = Math.max(el.h, ...lay.pins.map((p) => p.y - el.y));
      w.emit(
        `\\draw${opts(w, s, ['thick'])} ${w.p(el.x, el.y)} rectangle ${w.p(el.x + bw, el.y + bh)};`,
      );
      w.emit(
        `\\node[align=center] at ${w.p(el.x + bw / 2, el.y + bh / 2)} {${texText(el.title)}${el.tex ? `\\\\ $${el.tex}$` : ''}};`,
      );
      for (const p of lay.pins) {
        const anchor = { l: 'west', r: 'east', t: 'north', b: 'south' }[p.side];
        w.emit(
          `\\node[font=\\scriptsize, anchor=${anchor}, inner sep=2pt] at ${w.p(p.x, p.y)} {${texText(p.name)}};`,
        );
      }
      return;
    }
    case 'port': {
      const sh = portShape(el);
      const pts: string[] = [];
      for (let i = 0; i < sh.length; i += 2) pts.push(w.p(sh[i]!, sh[i + 1]!));
      w.emit(`\\draw${opts(w, s)} ${pts.join(' -- ')} -- cycle;`);
      const t = portTextPos(el);
      w.emit(`\\node[font=\\small] at ${w.p(t.x, t.y)} {${texText(el.name)}};`);
      return;
    }
    case 'shape': {
      const fill = el.style?.fill ? w.color(resolveColor(el.style.fill, theme)) : undefined;
      const o = opts(w, { ...s, ...(fill ? { fill: `${fill}!35` } : {}) });
      if (el.kind === 'rect') {
        const rc = el.radius ? `[rounded corners=${w.len(el.radius)}]` : '';
        w.emit(
          `\\draw${o}${rc ? ` ${rc}` : ''} ${w.p(el.x, el.y)} rectangle ${w.p(el.x + el.w, el.y + el.h)};`,
        );
      } else if (el.kind === 'ellipse')
        w.emit(
          `\\draw${o} ${w.p(el.x + el.w / 2, el.y + el.h / 2)} ellipse[x radius=${w.len(el.w / 2)}, y radius=${w.len(el.h / 2)}];`,
        );
      else {
        const g = shapeGeometry(el);
        w.emit(`\\draw${o} ${g.outline.map(([a, b]) => w.p(a, b)).join(' -- ')} -- cycle;`);
        for (const e of g.extras)
          w.emit(`\\draw${opts(w, s)} ${e.map(([a, b]) => w.p(a, b)).join(' -- ')};`);
      }
      if (el.text)
        w.emit(
          `\\node[align=center, text width=${w.len(el.w * 0.8)}] at ${w.p(el.x + el.w / 2, el.y + el.h / 2)} {${texText(el.text)}};`,
        );
      return;
    }
    case 'line': {
      const [x1, y1, x2, y2] = el.pts as [number, number, number, number];
      const arrow =
        el.arrowStart && el.arrowEnd
          ? 'latex-latex'
          : el.arrowEnd
            ? '-latex'
            : el.arrowStart
              ? 'latex-'
              : '';
      const o = opts(w, s, arrow ? [arrow] : []);
      if (el.route === 'elbow') {
        const pts = linePoints(el);
        w.emit(`\\draw${o}[rounded corners=1pt] ${pts.map(([a, b]) => w.p(a, b)).join(' -- ')};`);
        if (el.text) {
          const m = polylineMiddle(pts);
          w.emit(
            `\\node[fill=white, inner sep=1pt, font=\\small] at ${w.p(m.x, m.y)} {${texText(el.text)}};`,
          );
        }
        return;
      }
      if (el.bend) {
        const c = lineControlPoint(el.pts, el.bend);
        // Quadratic Bézier → cubic control points.
        const c1 = { x: x1 + ((c.x - x1) * 2) / 3, y: y1 + ((c.y - y1) * 2) / 3 };
        const c2 = { x: x2 + ((c.x - x2) * 2) / 3, y: y2 + ((c.y - y2) * 2) / 3 };
        w.emit(
          `\\draw${o} ${w.p(x1, y1)} .. controls ${w.p(c1.x, c1.y)} and ${w.p(c2.x, c2.y)} .. ${w.p(x2, y2)};`,
        );
      } else w.emit(`\\draw${o} ${w.p(x1, y1)} -- ${w.p(x2, y2)};`);
      if (el.text) {
        const c = el.bend
          ? lineControlPoint(el.pts, el.bend / 2)
          : { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
        w.emit(
          `\\node[fill=white, inner sep=1pt, font=\\small] at ${w.p(c.x, c.y)} {${texText(el.text)}};`,
        );
      }
      return;
    }
    case 'stroke': {
      const pts: string[] = [];
      const step = Math.max(1, Math.floor(el.pts.length / 3 / 80));
      for (let i = 0; i < el.pts.length; i += 3 * step) pts.push(w.p(el.pts[i]!, el.pts[i + 1]!));
      const width = `line width=${num(el.size * 0.45)}pt`;
      const extra = el.highlighter
        ? [width, 'opacity=0.35', 'line cap=round']
        : [width, 'line cap=round'];
      w.emit(`\\draw${opts(w, s, extra)} plot[smooth] coordinates {${pts.join(' ')}};`);
      return;
    }
    case 'note': {
      const fill = resolveNoteColor(el.color, theme).replace('#', '').toUpperCase();
      w.emit(
        `\\node[draw=black!25, fill={rgb,255:red,${parseInt(fill.slice(0, 2), 16)};green,${parseInt(fill.slice(2, 4), 16)};blue,${parseInt(fill.slice(4, 6), 16)}}, anchor=north west, text width=${w.len(el.w - 12)}, minimum height=${w.len(el.h)}, align=left, font=\\small] at ${w.p(el.x, el.y)} {${texText(el.text)}};`,
      );
      return;
    }
    case 'button': {
      const label = texText(el.label);
      const body =
        el.link.kind === 'url'
          ? `\\href{${el.link.url.replace(/([#%])/g, '\\$1')}}{${label}}`
          : label;
      w.emit(
        `\\node[draw, rounded corners=3pt, minimum width=${w.len(el.w)}, minimum height=${w.len(el.h)}] at ${w.p(el.x + el.w / 2, el.y + el.h / 2)} {${body}};`,
      );
      return;
    }
    case 'waveform':
      return waveform(w, el);
    case 'frame':
      w.emit(
        `\\draw[dashed, black!45] ${w.p(el.x, el.y)} rectangle ${w.p(el.x + el.w, el.y + el.h)};`,
      );
      w.emit(
        `\\node[anchor=south west, font=\\small\\scshape, black!60] at ${w.p(el.x, el.y)} {${texText(el.name)}};`,
      );
      return;
    case 'image':
      w.emit(`% image “${el.name ?? 'image'}” not exported (use \\includegraphics)`);
      return;
    case 'group':
      return;
  }
  void all;
  void sheetId;
}

/** CircuiTikZ code of one sheet. */
export function sheetToCircuitikz(
  project: Project,
  ctx: SheetContext,
  sheetId: Id,
  o: TikzOptions,
): string {
  const unit = o.unit ?? 0.25;
  const w = new Writer(unit);
  const all = project.getElements(sheetId);
  const layer = (e: Element) => (e.type === 'frame' ? 0 : e.type === 'block' ? 1 : 2);
  const ordered = [...all].sort((a, b) => layer(a) - layer(b) || a.z - b.z);
  for (const el of ordered) element(w, el, all, ctx, sheetId);
  const conn = analyzeConnectivity(all, ctx);
  for (const j of conn.junctions) w.emit(`\\fill ${w.p(j.x, j.y)} circle[radius=1.6pt];`);

  const meta = project.getMeta();
  const sheet = project.getSheet(sheetId);
  const style = meta.standard === 'ANSI' ? 'american' : 'european';
  const colorDefs = [...w.colors.entries()].map(
    ([hex, name]) => `\\definecolor{${name}}{HTML}{${hex}}`,
  );
  const env = [
    `% ${meta.name} — ${sheet?.name ?? ''} (exported from SchemaBoard)`,
    ...colorDefs,
    `\\begin{circuitikz}[${style}, line width=0.6pt, line cap=round, line join=round]`,
    `\\ctikzset{bipoles/length=${num(unit * 3.2)}cm}`,
    ...w.lines.map((l) => `  ${l}`),
    '\\end{circuitikz}',
  ].join('\n');
  if (!o.standalone) return `${env}\n`;
  return [
    '\\documentclass[border=4pt]{standalone}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath}',
    '\\usepackage{circuitikz}',
    '\\usepackage{hyperref}',
    '\\begin{document}',
    env,
    '\\end{document}',
    '',
  ].join('\n');
}
