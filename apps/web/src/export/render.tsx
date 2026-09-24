import {
  elementBBox,
  rectUnion,
  type BlockElement,
  type Id,
  type Project,
  type Rect,
  type SheetContext,
} from '@overleagger/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTex } from '../latex/texCache';
import { SheetRenderer } from '../canvas/render/SheetRenderer';
import { siteFile } from '../site';
import { FONT_SERIF, type Theme } from '../theme';

export type Background = 'paper' | 'white' | 'transparent';

export interface SvgExportOptions {
  theme: Theme;
  background: Background;
  latexRefs: boolean;
  margin?: number;
  /** Embed the CMU Serif font (needed for PNG and portable SVG files). */
  embedFonts?: boolean;
}

export interface SheetSvg {
  svg: string;
  /** Drawing area in world coordinates (px). */
  view: Rect;
  blocks: { id: Id; childSheetId: Id; rect: Rect; title: string }[];
  /** Link buttons (clickable in the PDF). */
  links: { rect: Rect; url?: string; sheetId?: Id }[];
  /** Sticky notes (PDF comments). */
  notes: { rect: Rect; text: string }[];
}

let fontCss: Promise<string> | null = null;

async function toBase64(buf: ArrayBuffer): Promise<string> {
  const blob = new Blob([buf]);
  const url: string = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

function embeddedFontCss(): Promise<string> {
  if (!fontCss) {
    const face = async (file: string, style: string, weight: number) => {
      const res = await fetch(siteFile(`fonts/${file}`));
      if (!res.ok) return '';
      const b64 = await toBase64(await res.arrayBuffer());
      return `@font-face{font-family:'CMU Serif';font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
    };
    fontCss = Promise.all([
      face('cmu-serif-500-roman.woff2', 'normal', 400),
      face('cmu-serif-500-italic.woff2', 'italic', 400),
    ]).then((f) => f.join(''));
  }
  return fontCss;
}

/** Render one sheet to a standalone SVG string. */
export async function renderSheetSvg(
  project: Project,
  ctx: SheetContext,
  sheetId: Id,
  o: SvgExportOptions,
): Promise<SheetSvg> {
  await loadTex();
  const elements = project.getElements(sheetId);
  const m = o.margin ?? 24;
  const b = rectUnion(
    elements.filter((e) => e.type !== 'group').map((e) => elementBBox(e, ctx, elements)),
  ) ?? { x: 0, y: 0, w: 200, h: 120 };
  const view = {
    x: Math.floor(b.x - m),
    y: Math.floor(b.y - m),
    w: Math.ceil(b.w + 2 * m),
    h: Math.ceil(b.h + 2 * m),
  };
  const bg =
    o.background === 'transparent' ? null : o.background === 'white' ? '#ffffff' : o.theme.paper;
  // Shapes filled with "paper" (empty diodes, blocks) must match the export background.
  const theme = bg && bg !== o.theme.paper ? { ...o.theme, paper: bg } : o.theme;
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={view.w}
      height={view.h}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      fontFamily={FONT_SERIF}
    >
      {bg && <rect x={view.x} y={view.y} width={view.w} height={view.h} fill={bg} />}
      <SheetRenderer
        elements={elements}
        o={{ theme, ctx, interactive: false, latexRefs: o.latexRefs }}
      />
    </svg>,
  );
  let svg = markup;
  if (o.embedFonts) {
    const css = await embeddedFontCss();
    svg = svg.replace(/^<svg([^>]*)>/, (all) => `${all}<defs><style>${css}</style></defs>`);
  }
  const blocks = elements
    .filter((e): e is BlockElement => e.type === 'block')
    .map((e) => ({
      id: e.id,
      childSheetId: e.childSheetId,
      rect: elementBBox(e, ctx, elements),
      title: e.title,
    }));
  const parentSheetId = project.getSheet(sheetId)?.parentSheetId;
  const links = elements.flatMap((e) => {
    // Sheet ports jump back to the parent sheet (where their block is).
    if (e.type === 'port' && parentSheetId)
      return [{ rect: elementBBox(e, ctx, elements), sheetId: parentSheetId }];
    if (!e.link || e.type === 'group') return [];
    const rect = elementBBox(e, ctx, elements);
    return [e.link.kind === 'url' ? { rect, url: e.link.url } : { rect, sheetId: e.link.sheetId }];
  });
  const notes = elements.flatMap((e) =>
    e.type === 'note' ? [{ rect: { x: e.x, y: e.y, w: e.w, h: e.h }, text: e.text }] : [],
  );
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, view, blocks, links, notes };
}

export async function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not rasterize the drawing.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const g = canvas.getContext('2d')!;
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
