import type { EditorController } from '../editor/controller';
import { THEMES } from '../theme';
import { useUI } from '../store/ui';
import type { Background } from './render';

/**
 * Put a PNG of the selection (or of the whole sheet) on the clipboard, ready to paste in a
 * report, a slide or a chat. Elements hidden from the export are left out.
 */
export async function copySheetImage(
  ed: EditorController,
  o: { only?: string[]; theme?: keyof typeof THEMES; background?: Background } = {},
): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write)
    throw new Error('this browser cannot copy images — use PNG instead.');
  const png = (async () => {
    const { renderSheetSvg, svgToPngBlob } = await import('./render');
    const r = await renderSheetSvg(ed.project, ed.ctx, ed.sheetId, {
      theme: THEMES[o.theme ?? 'paper'],
      background: o.background ?? 'white',
      latexRefs: useUI.getState().latexRefs,
      embedFonts: true,
      ...(o.only?.length ? { only: o.only } : {}),
    });
    return svgToPngBlob(r.svg, r.view.w, r.view.h, 2);
  })();
  // Safari wants the ClipboardItem created at once, with a promise of the data.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
