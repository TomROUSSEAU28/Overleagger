/**
 * The version of Circuit Notebook in the top bar, and what changed in it ("What's new"). A dot
 * on the version says there is a version you have not looked at yet.
 */
import { BookOpen, History } from 'lucide-react';
import { useState } from 'react';
import { CHANGELOG, STAGE, VERSION, formatDate, versionLabel } from '../changelog';
import { useUI } from '../store/ui';
import { Modal } from './common';

const SEEN_KEY = 'olg.seenVersion';

function seenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** "v0.9 beta" in the top bar: opens What's new. */
export function VersionChip({ compact = false }: { compact?: boolean }) {
  const [fresh, setFresh] = useState(() => seenVersion() !== VERSION);
  return (
    <button
      type="button"
      className={`version-chip${fresh ? ' fresh' : ''}`}
      title={fresh ? "New version: see what's new" : "What's new in Circuit Notebook"}
      onClick={() => {
        try {
          localStorage.setItem(SEEN_KEY, VERSION);
        } catch {
          // storage unavailable
        }
        setFresh(false);
        useUI.getState().set({ modal: 'whatsnew' });
      }}
      data-testid="version-chip"
    >
      {versionLabel()}
      {!compact && <span className="version-stage">{STAGE}</span>}
    </button>
  );
}

export function WhatsNew() {
  const close = () => useUI.getState().set({ modal: null });
  const [all, setAll] = useState(false);
  const shown = all ? CHANGELOG : CHANGELOG.slice(0, 2);
  return (
    <Modal title={`What's new · ${versionLabel(VERSION)} ${STAGE}`} onClose={close}>
      <div className="whatsnew" data-testid="whatsnew">
        <p className="muted small">
          Circuit Notebook is in open beta: it changes often. Thank you for trying it!
        </p>
        {shown.map((r, i) => (
          <section key={r.version} className={`wn-release${i === 0 ? ' current' : ''}`}>
            <h3>
              {versionLabel(r.version)} <i>{r.title}</i>
              <span className="muted small">{formatDate(r.date)}</span>
            </h3>
            {r.added.length > 0 && (
              <ul className="wn-added">
                {r.added.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            {r.fixed.length > 0 && (
              <>
                <b className="wn-fixed-title">Fixed</b>
                <ul className="wn-fixed">
                  {r.fixed.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
        {!all && CHANGELOG.length > 2 && (
          <button type="button" className="btn" onClick={() => setAll(true)}>
            <History size={14} /> Earlier versions
          </button>
        )}
        <div className="wn-links">
          <a className="btn" href="../manual/" target="_blank" rel="noopener">
            <BookOpen size={14} /> User manual
          </a>
          <a className="btn" href="../changelog/" target="_blank" rel="noopener">
            All versions
          </a>
        </div>
      </div>
    </Modal>
  );
}
