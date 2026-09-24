import type { Standard } from '@overleagger/symbols';
import {
  Copy,
  Download,
  FolderOpen,
  LogOut,
  Pencil,
  Plus,
  Shapes,
  Sparkles,
  Trash,
  Upload,
  UploadCloud,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Project, ROLE_LABELS } from '@overleagger/core';
import { Logo } from '../brand/Logo';
import { AccountMenu } from '../cloud/AccountUI';
import { api, bytesToBase64, useCloud, type CloudProjectEntry } from '../cloud/cloud';
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
  const signedIn = useCloud((s) => Boolean(s.user));
  const [where, setWhere] = useState<'local' | 'cloud'>('local');
  const [error, setError] = useState('');
  const create = async () => {
    const title = name.trim() || 'Untitled project';
    if (where === 'cloud') {
      try {
        const p = Project.create(title, standard);
        const r = await api<{ id: string }>('POST', '/api/projects', {
          name: title,
          state: bytesToBase64(p.encodeState()),
        });
        navigate(`/cloud/${r.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    const id = await createProject(title, standard);
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
        {signedIn && (
          <Field label="Where">
            <select
              value={where}
              onChange={(e) => setWhere(e.target.value as 'local' | 'cloud')}
              data-testid="new-project-where"
            >
              <option value="local">This browser only</option>
              <option value="cloud">On the server (shareable, real-time)</option>
            </select>
          </Field>
        )}
        {error && <p className="warning small">{error}</p>}
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
  const user = useCloud((s) => s.user);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectEntry[] | null>(null);

  useEffect(() => {
    document.title = 'Your projects — Circuit Notebook';
  }, []);

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(String(e)));
  }, []);
  useEffect(refresh, [refresh]);
  const refreshCloud = useCallback(() => {
    if (!user) return setCloudProjects(null);
    api<{ projects: CloudProjectEntry[] }>('GET', '/api/projects')
      .then((r) => setCloudProjects(r.projects))
      .catch(() => setCloudProjects(null));
  }, [user]);
  useEffect(refreshCloud, [refreshCloud]);

  const upload = async (p: ProjectEntry) => {
    try {
      const r = await exportProjectUpdate(p.id);
      const res = await api<{ id: string }>('POST', '/api/projects', {
        name: r.name,
        state: bytesToBase64(r.update),
      });
      navigate(`/cloud/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
          <h1 className="logo big brand-title">
            <Logo size={38} /> Circuit Notebook
          </h1>
          <p className="tagline">
            Power electronics &amp; control diagram editor — schematics, block diagrams and
            whiteboards, with sheets you can open like blocks.
          </p>
        </div>
        <div className="dash-head-right">
          <AccountMenu />
          <ThemePicker />
        </div>
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
      {user && (
        <section className="cloud-section" data-testid="cloud-projects">
          <h2>
            <Users size={17} /> Shared projects
          </h2>
          {cloudProjects?.length === 0 && (
            <p className="muted small">
              No shared project yet. Create one “on the server”, upload a project from this browser,
              or open an invite link.
            </p>
          )}
          <div className="project-grid">
            {cloudProjects?.map((p) => (
              <article key={p.id} className="project-card" data-testid="cloud-card">
                <a className="thumb" href={`#/cloud/${p.id}`} aria-label={`Open ${p.name}`}>
                  {p.thumbnail ? (
                    <img
                      alt=""
                      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.thumbnail)}`}
                    />
                  ) : (
                    <span className="muted">no preview yet</span>
                  )}
                </a>
                <div className="card-body">
                  <a className="card-title" href={`#/cloud/${p.id}`}>
                    {p.name}
                  </a>
                  <span className="muted small">
                    {p.role === 'owner' ? 'Yours' : `By ${p.owner}`} · {ROLE_LABELS[p.role]} ·{' '}
                    {when(p.updatedAt)}
                  </span>
                </div>
                <div className="card-actions">
                  <a className="icon-btn" href={`#/cloud/${p.id}`} title="Open">
                    <FolderOpen size={16} />
                  </a>
                  {p.role === 'owner' ? (
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="Delete for everyone"
                      onClick={async () => {
                        if (confirm(`Delete “${p.name}” for everyone? This cannot be undone.`)) {
                          await api('DELETE', `/api/projects/${p.id}`);
                          refreshCloud();
                        }
                      }}
                    >
                      <Trash size={16} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Leave this project"
                      onClick={async () => {
                        if (confirm(`Leave “${p.name}”?`)) {
                          await api('DELETE', `/api/projects/${p.id}/members/${user.id}`);
                          refreshCloud();
                        }
                      }}
                    >
                      <LogOut size={16} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <h2>In this browser</h2>
        </section>
      )}
      <p className="muted small">
        Projects are saved automatically in this browser. Export a .olg file to back them up or move
        them to another computer.
      </p>
      <section className="project-grid" data-testid="project-list">
        {projects?.length === 0 && (
          <div className="empty">
            <p>No project yet.</p>
            <p className="muted">
              Create a new one, or open the example to see what Circuit Notebook can do.
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
              {user && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Upload to the server to share it (a copy stays here)"
                  onClick={() => void upload(p)}
                  data-testid="upload-project"
                >
                  <UploadCloud size={16} />
                </button>
              )}
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
      <footer className="dash-foot">
        <Logo size={18} />
        <span>Circuit Notebook</span>
        <a href="../">About</a>
        <a href="#/gallery">Symbol gallery</a>
        <span className="muted">Projects stay in this browser unless you share them.</span>
      </footer>
      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}
