import { Copy, FileCode, FileDown, FileImage, FileText, Sigma } from 'lucide-react';
import { useState } from 'react';
import { useEditor } from '../editor/context';
import type { Background } from '../export/render';
import { download, encodeProjectOlg, safeFileName } from '../storage/olg';
import { useUI } from '../store/ui';
import { THEMES, type ThemeName } from '../theme';
import { Field, Modal } from './common';

export function ExportDialog() {
  const ed = useEditor();
  const uiTheme = useUI((s) => s.theme);
  const latexRefs = useUI((s) => s.latexRefs);
  const [themeName, setThemeName] = useState<ThemeName>('paper');
  const [background, setBackground] = useState<Background>('white');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tikz, setTikz] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [copied, setCopied] = useState(false);
  const close = () => useUI.getState().set({ modal: null });
  const meta = ed.project.getMeta();
  const sheet = ed.project.getSheet(ed.sheetId);
  const base = safeFileName(
    `${meta.name}${sheet && sheet.id !== ed.project.rootSheetId ? `-${sheet.name}` : ''}`,
  );
  const opts = { theme: THEMES[themeName], background, latexRefs };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const svg = () =>
    run('SVG', async () => {
      const { renderSheetSvg } = await import('../export/render');
      const r = await renderSheetSvg(ed.project, ed.ctx, ed.sheetId, { ...opts, embedFonts: true });
      download(new Blob([r.svg], { type: 'image/svg+xml' }), `${base}.svg`);
    });
  const png = () =>
    run('PNG', async () => {
      const { renderSheetSvg, svgToPngBlob } = await import('../export/render');
      const r = await renderSheetSvg(ed.project, ed.ctx, ed.sheetId, { ...opts, embedFonts: true });
      download(await svgToPngBlob(r.svg, r.view.w, r.view.h, 3), `${base}.png`);
    });
  const pdf = () =>
    run('PDF', async () => {
      const { exportPdf } = await import('../export/pdf');
      const r = await exportPdf(ed.project, ed.ctx, opts);
      download(r.blob, `${safeFileName(meta.name)}.pdf`);
    });
  const makeTikz = (full = standalone) =>
    run('CircuiTikZ', async () => {
      const { sheetToCircuitikz } = await import('../export/circuitikz');
      setTikz(sheetToCircuitikz(ed.project, ed.ctx, ed.sheetId, { standalone: full }));
      setCopied(false);
    });
  const olg = () =>
    run('OLG', async () => {
      download(
        new Blob([encodeProjectOlg(ed.project) as BlobPart], { type: 'application/zip' }),
        `${safeFileName(meta.name)}.olg`,
      );
    });

  return (
    <Modal title="Export" onClose={close}>
      <div className="row">
        <Field label="Colours">
          <select value={themeName} onChange={(e) => setThemeName(e.target.value as ThemeName)}>
            <option value="paper">Graphite on cream paper</option>
            <option value="whiteboard">Ink on whiteboard</option>
            <option value="blackboard">Chalk on blackboard</option>
          </select>
        </Field>
        <Field label="Background">
          <select value={background} onChange={(e) => setBackground(e.target.value as Background)}>
            <option value="white">White</option>
            <option value="paper">Theme paper</option>
            <option value="transparent">Transparent (SVG/PNG)</option>
          </select>
        </Field>
      </div>
      {uiTheme === 'blackboard' && themeName === 'paper' && (
        <p className="muted small">The export uses light colours, ready for printing.</p>
      )}
      <div className="export-grid">
        <button
          type="button"
          className="export-btn"
          onClick={pdf}
          disabled={!!busy}
          data-testid="export-pdf"
        >
          <FileText size={22} />
          <b>Smart PDF</b>
          <span>All sheets · one page each · clickable blocks · bookmarks</span>
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={svg}
          disabled={!!busy}
          data-testid="export-svg"
        >
          <FileCode size={22} />
          <b>SVG</b>
          <span>Current sheet, vector (for LaTeX / Inkscape)</span>
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={png}
          disabled={!!busy}
          data-testid="export-png"
        >
          <FileImage size={22} />
          <b>PNG</b>
          <span>Current sheet, 3× resolution</span>
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={olg}
          disabled={!!busy}
          data-testid="export-olg"
        >
          <FileDown size={22} />
          <b>Project file (.olg)</b>
          <span>Full project, to back up or share</span>
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={() => makeTikz()}
          disabled={!!busy}
          data-testid="export-tikz"
        >
          <Sigma size={22} />
          <b>CircuiTikZ (LaTeX)</b>
          <span>Current sheet as LaTeX code for your report</span>
        </button>
      </div>
      {tikz !== null && (
        <div className="tikz-box">
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={standalone}
                onChange={(e) => {
                  setStandalone(e.target.checked);
                  makeTikz(e.target.checked);
                }}
              />
              Complete document (compiles on its own)
            </label>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.clipboard?.writeText(tikz).then(() => setCopied(true))}
            >
              <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                download(new Blob([tikz], { type: 'application/x-tex' }), `${base}.tex`)
              }
              data-testid="download-tikz"
            >
              <FileDown size={14} /> .tex
            </button>
          </div>
          <textarea
            className="mono tikz-code"
            readOnly
            value={tikz}
            rows={12}
            data-testid="tikz-code"
          />
          <p className="muted small">
            Needs <code>\usepackage{'{circuitikz}'}</code>. Resistors, capacitors, inductors and
            diodes use native CircuiTikZ symbols; other parts are drawn exactly as on screen.
          </p>
        </div>
      )}
      {busy && <p className="muted small">Exporting {busy}…</p>}
      {error && <p className="warning small">Export failed: {error}</p>}
    </Modal>
  );
}
