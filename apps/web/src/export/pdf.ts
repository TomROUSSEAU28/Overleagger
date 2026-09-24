import {
  sheetPath,
  sheetTree,
  type Id,
  type Project,
  type SheetContext,
  type SheetNode,
} from '@overleagger/core';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { renderSheetSvg, type SvgExportOptions } from './render';

const PAGE = { w: 841.89, h: 595.28 }; // A4 landscape, pt
const MARGIN = 28;
const HEADER = 30;
const FOOTER = 22;

async function fetchBase64(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function registerFonts(doc: jsPDF): Promise<string> {
  const base = import.meta.env.BASE_URL;
  const [roman, italic] = await Promise.all([
    fetchBase64(`${base}fonts/cmu-serif-500-roman.ttf`),
    fetchBase64(`${base}fonts/cmu-serif-500-italic.ttf`),
  ]);
  if (!roman) return 'times';
  doc.addFileToVFS('cmu-serif-roman.ttf', roman);
  doc.addFont('cmu-serif-roman.ttf', 'CMU Serif', 'normal');
  if (italic) {
    doc.addFileToVFS('cmu-serif-italic.ttf', italic);
    doc.addFont('cmu-serif-italic.ttf', 'CMU Serif', 'italic');
  }
  return 'CMU Serif';
}

function flatten(node: SheetNode, out: SheetNode[] = []): SheetNode[] {
  out.push(node);
  for (const c of node.children) flatten(c, out);
  return out;
}

export interface PdfResult {
  blob: Blob;
  pages: number;
}

/**
 * Interactive PDF: one page per sheet (hierarchy order), a bookmark tree mirroring the
 * hierarchy, clickable blocks that jump to their sub-sheet and a link back to the parent sheet.
 */
export async function exportPdf(
  project: Project,
  ctx: SheetContext,
  o: SvgExportOptions,
): Promise<PdfResult> {
  const tree = sheetTree(project);
  if (!tree) throw new Error('Empty project');
  const nodes = flatten(tree);
  const pageOf = new Map<Id, number>(nodes.map((n, i) => [n.sheet.id, i + 1]));
  const meta = project.getMeta();

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({
    title: meta.name,
    creator: 'Overleagger',
    subject: 'Hierarchical schematic',
  });
  const font = await registerFonts(doc);

  const outlineOf = new Map<Id, unknown>();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const sheet = node.sheet;
      if (i > 0) doc.addPage('a4', 'landscape');
      const { svg, view, blocks, links } = await renderSheetSvg(project, ctx, sheet.id, {
        ...o,
        embedFonts: false,
      });

      const availW = PAGE.w - 2 * MARGIN;
      const availH = PAGE.h - HEADER - FOOTER - 2 * MARGIN;
      const s = Math.min(availW / view.w, availH / view.h, 1.1);
      const w = view.w * s;
      const h = view.h * s;
      const x0 = MARGIN + (availW - w) / 2;
      const y0 = MARGIN + HEADER + (availH - h) / 2;

      host.innerHTML = svg.replace(/^<\?xml[^>]*>\s*/, '');
      const svgEl = host.querySelector('svg')!;
      await doc.svg(svgEl, { x: x0, y: y0, width: w, height: h });

      // Header: path + parent link.
      const path = sheetPath(project, sheet.id);
      doc.setFont(font, 'normal');
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text(
        `${meta.name}  —  ${path.map((p) => p.name || 'Untitled').join('  /  ')}`,
        MARGIN,
        MARGIN + 8,
      );
      doc.setDrawColor(200, 196, 186);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, MARGIN + HEADER - 12, PAGE.w - MARGIN, MARGIN + HEADER - 12);
      if (sheet.parentSheetId && pageOf.has(sheet.parentSheetId)) {
        const label = 'back to parent sheet';
        doc.setFontSize(10);
        doc.setTextColor(47, 93, 158);
        const tw = doc.getTextWidth(label);
        doc.textWithLink(label, PAGE.w - MARGIN - tw, MARGIN + 8, {
          pageNumber: pageOf.get(sheet.parentSheetId)!,
        });
      }
      // Footer
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Page ${i + 1} / ${nodes.length}`, PAGE.w - MARGIN, PAGE.h - MARGIN + 6, {
        align: 'right',
      });
      doc.text('Made with Overleagger', MARGIN, PAGE.h - MARGIN + 6);

      // Clickable blocks → sub-sheet pages.
      for (const b of blocks) {
        const target = pageOf.get(b.childSheetId);
        if (!target) continue;
        doc.link(
          x0 + (b.rect.x - view.x) * s,
          y0 + (b.rect.y - view.y) * s,
          b.rect.w * s,
          b.rect.h * s,
          { pageNumber: target },
        );
      }

      // Link buttons: web pages / online PDFs, or other sheets of the document.
      for (const l of links) {
        const x = x0 + (l.rect.x - view.x) * s;
        const y = y0 + (l.rect.y - view.y) * s;
        if (l.url && /^(https?:|mailto:)/i.test(l.url))
          doc.link(x, y, l.rect.w * s, l.rect.h * s, { url: l.url });
        else if (l.sheetId && pageOf.has(l.sheetId))
          doc.link(x, y, l.rect.w * s, l.rect.h * s, { pageNumber: pageOf.get(l.sheetId)! });
      }

      // Bookmarks mirroring the hierarchy.
      const parent = sheet.parentSheetId ? outlineOf.get(sheet.parentSheetId) : null;
      const item = doc.outline.add(parent ?? null, sheet.name || 'Untitled', { pageNumber: i + 1 });
      outlineOf.set(sheet.id, item);
    }
  } finally {
    host.remove();
  }
  return { blob: doc.output('blob'), pages: nodes.length };
}
