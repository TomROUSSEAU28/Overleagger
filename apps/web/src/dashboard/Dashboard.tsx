import type { Standard } from '@overleagger/symbols';
import {
  Copy,
  Download,
  FolderOpen,
  Pencil,
  Plus,
  Shapes,
  Sparkles,
  Trash,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { seedBuckExample } from '../examples/buck';
import { Field, Modal } from '../panels/common';
import { ThemePicker } from '../panels/ThemePicker';
import { navigate } from '../router';
import { decodeOlg, download, encodeOlg, safeFileName } from '../storage/olg';
import {
  createProject,
  createProjectFromUpdate,
  deleteProject,
  duplicateProject,
  exportProjectUpdate,
  listProjects,
  renameProject,
  type ProjectEntry,
} from '../storage/projects';
import { useUI } from '../store/ui';

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Untitled project');
  const [standard, setStandard] = useState<Standard>('IEC');
  const create = async () => {
    const id = await createProject(name.trim() || 'Untitled project', standard);
    navigate(`/p/${id}`);
  };
  return (
    <Modal title="New project" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="new-project-name"
            onFocus={(e) => e.target.select()}
          />
        </Field>
        <Field label="Symbol standard">
          <select value={standard} onChange={(e) => setStandard(e.target.value as Standard)}>
            <option value="IEC">IEC 60617 — Europe</option>
            <option value="ANSI">IEEE 315 / ANSI — US</option>
          </select>
        </Field>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" data-testid="create-project">
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function when(t: number) {
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const theme = useUI((s) => s.theme);

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(String(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const openExample = async () => {
    const id = await createProject('Buck converter example', 'IEC', seedBuckExample);
    navigate(`/p/${id}`);
  };

  const importFile = async (f: File) => {
    try {
      const { manifest, update } = decodeOlg(new Uint8Array(await f.arrayBuffer()));
      const id = await createProjectFromUpdate(update, manifest.name);
      navigate(`/p/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="dashboard" data-theme={theme}>
      <header className="dash-head">
        <div>
          <h1 className="logo big">SchemaBoard</h1>
          <p className="tagline">
            Power electronics &amp; control diagram editor — schematics, block diagrams and
            whiteboards, with sheets you can open like blocks.
          </p>
        </div>
        <ThemePicker />
      </header>
      <div className="dash-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => setShowNew(true)}
          data-testid="new-project"
        >
          <Plus size={16} /> New project
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void openExample()}
          data-testid="open-example"
        >
          <Sparkles size={16} /> Open the example (buck converter)
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <Upload size={16} /> Import .olg
        </button>
        <a className="btn" href="#/gallery">
          <Shapes size={16} /> Symbol gallery
        </a>
        <input
          ref={fileRef}
          type="file"
          accept=".olg,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="warning">{error}</p>}
      <p className="muted small">
        Projects are saved automatically in this browser. Export a .olg file to back them up or move
        them to another computer.
      </p>
      <section className="project-grid" data-testid="project-list">
        {projects?.length === 0 && (
          <div className="empty">
            <p>No project yet.</p>
            <p className="muted">
              Create a new one, or open the example to see what SchemaBoard can do.
            </p>
          </div>
        )}
        {projects?.map((p) => (
          <article key={p.id} className="project-card" data-testid="project-card">
            <a className="thumb" href={`#/p/${p.id}`} aria-label={`Open ${p.name}`}>
              {p.thumbnail ? (
                <img
                  alt=""
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.thumbnail)}`}
                />
              ) : (
                <span className="muted">empty</span>
              )}
            </a>
            <div className="card-body">
              <a className="card-title" href={`#/p/${p.id}`}>
                {p.name}
              </a>
              <span className="muted small">Edited {when(p.updatedAt)}</span>
            </div>
            <div className="card-actions">
              <a className="icon-btn" href={`#/p/${p.id}`} title="Open">
                <FolderOpen size={16} />
              </a>
              <button
                type="button"
                className="icon-btn"
                title="Rename"
                onClick={async () => {
                  const name = prompt('Project name', p.name);
                  if (name && name !== p.name) {
                    await renameProject(p.id, name);
                    refresh();
                  }
                }}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Duplicate"
                onClick={async () => {
                  await duplicateProject(p.id);
                  refresh();
                }}
              >
                <Copy size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Download .olg"
                onClick={async () => {
                  const r = await exportProjectUpdate(p.id);
                  download(
                    new Blob([encodeOlg(r.name, r.update, r.json) as BlobPart], {
                      type: 'application/zip',
                    }),
                    `${safeFileName(r.name)}.olg`,
                  );
                }}
              >
                <Download size={16} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="Delete"
                onClick={async () => {
                  if (confirm(`Delete “${p.name}”? This cannot be undone.`)) {
                    await deleteProject(p.id);
                    refresh();
                  }
                }}
              >
                <Trash size={16} />
              </button>
            </div>
          </article>
        ))}
      </section>
      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}
