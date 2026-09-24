import { useEffect, useState } from 'react';
import {
  ACTIONS,
  FIXED_SHORTCUTS,
  conflicts,
  eventToCombo,
  formatCombo,
  type ActionDef,
  type ActionId,
} from '../shortcuts/keymap';
import { useKeymap } from '../shortcuts/useKeymap';
import { useUI } from '../store/ui';
import { Kbd, Modal } from './common';

const CATEGORIES: ActionDef['category'][] = ['Tools', 'Edit', 'Hierarchy', 'View', 'File', 'Help'];

export function HelpOverlay() {
  const keymap = useKeymap((s) => s.keymap);
  const close = () => useUI.getState().set({ modal: null });
  return (
    <Modal title="Keyboard shortcuts & tips" onClose={close} wide>
      <div className="help-grid">
        {CATEGORIES.map((cat) => (
          <section key={cat}>
            <h3>{cat}</h3>
            <dl>
              {ACTIONS.filter((a) => a.category === cat).map((a) => (
                <div key={a.id} className="help-row">
                  <dt>{a.label}</dt>
                  <dd>
                    {(keymap[a.id] ?? []).map((k) => (
                      <Kbd key={k} combo={k} />
                    ))}
                  </dd>
                </div>
              ))}
              {cat === 'Edit' &&
                FIXED_SHORTCUTS.map((f) => (
                  <div key={f.label} className="help-row">
                    <dt>{f.label}</dt>
                    <dd>
                      {f.keys.map((k) => (
                        <kbd key={k} className="kbd">
                          {k.includes('+') || k.length === 1 ? formatCombo(k) : k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
        <section>
          <h3>How it works</h3>
          <ul className="tips">
            <li>Everything snaps to the grid. Pins sit on the grid, so wires connect exactly.</li>
            <li>
              A junction dot is drawn automatically where three or more connections meet. Crossing
              wires are not connected.
            </li>
            <li>
              A hierarchical block is a whole sheet. Add sheet ports inside it: each one becomes a
              pin on the block.
            </li>
            <li>
              Text supports LaTeX between dollars: <code>{'$v_L = L\\,\\frac{di}{dt}$'}</code>.
            </li>
            <li>
              Switch EU/US symbols in the top bar. Each part can also override the standard and
              change its size.
            </li>
            <li>
              Whiteboard tools: pencil, eraser, shapes (with a hand-drawn option), arrows (drag the
              middle handle to curve them), sticky notes, images (drop or paste them), link buttons
              (Ctrl+click to follow), waveforms and frames.
            </li>
            <li>
              Flowcharts: pick a flowchart shape (S), then draw lines (Shift L) from shape to shape
              — they attach to the connection points and follow the shapes.
            </li>
            <li>
              Templates: select part of a drawing and “Save selection as template” to reuse it in
              any project.
            </li>
            <li>
              Present with F5 (frames become slides), comment with C, share with the Share button
              when connected to a server.
            </li>
            <li>
              “New symbol” in the library opens the symbol editor. “Customize symbol…” in the
              properties starts from the selected part.
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog() {
  const { keymap, setKeys, reset } = useKeymap();
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const close = () => useUI.getState().set({ modal: null });

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = eventToCombo(e);
      const clash = conflicts(keymap, combo, capturing);
      if (clash.length) {
        for (const id of clash)
          setKeys(
            id,
            keymap[id].filter((k) => k !== combo),
          );
        setWarning(
          `${formatCombo(combo)} was removed from “${ACTIONS.find((a) => a.id === clash[0])?.label}”.`,
        );
      } else setWarning(null);
      setKeys(capturing, [...(keymap[capturing] ?? []).filter((k) => k !== combo), combo]);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, keymap, setKeys]);

  return (
    <Modal title="Customize keyboard shortcuts" onClose={close} wide>
      <p className="muted small">
        Click <b>+</b> then press the new key combination. Click a key to remove it. Shortcuts are
        saved in this browser.
      </p>
      {warning && <p className="warning small">{warning}</p>}
      <div className="shortcut-table">
        {CATEGORIES.map((cat) => (
          <section key={cat}>
            <h3>{cat}</h3>
            {ACTIONS.filter((a) => a.category === cat).map((a) => (
              <div key={a.id} className="shortcut-row">
                <span>{a.label}</span>
                <span className="keys">
                  {(keymap[a.id] ?? []).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="kbd removable"
                      title="Remove"
                      onClick={() =>
                        setKeys(
                          a.id,
                          keymap[a.id].filter((x) => x !== k),
                        )
                      }
                    >
                      {formatCombo(k)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`kbd add${capturing === a.id ? ' capturing' : ''}`}
                    onClick={() => setCapturing(a.id)}
                    data-testid={`add-key-${a.id}`}
                  >
                    {capturing === a.id ? 'press keys…' : '+'}
                  </button>
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={reset}>
          Reset to defaults
        </button>
        <button type="button" className="btn primary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
