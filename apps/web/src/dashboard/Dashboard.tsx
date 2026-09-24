import type { Standard } from '@overleagger/symbols';
import {
  Copy,
  Download,
  FilePlus2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash,
  Upload,
  UploadCloud,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

type StartFrom = 'blank' | 'buck';
const DEFAULT_NAME = 'Untitled project';

function NewProjectDialog({
  onClose,
  start = 'blank',
}: {
  onClose: () => void;
  start?: StartFrom;
}) {
  const [from, setFrom] = useState<StartFrom>(start);
  const [name, setName] = useState(start === 'buck' ? 'Buck converter example' : DEFAULT_NAME);
  const [standard, setStandard] = useState<Standard>('IEC');
  const signedIn = useCloud((s) => Boolean(s.user));
  const [where, setWhere] = useState<'local' | 'cloud'>('local');
  const [error, setError] = useState('');
  const pick = (f: StartFrom) => {
    setFrom(f);
    // Keep a name the user typed; otherwise follow the choice.
    if (name === DEFAULT_NAME || name === 'Buck converter example')
      setName(f === 'buck' ? 'Buck converter example' : DEFAULT_NAME);
  };
  const create = async () => {
    const title = name.trim() || DEFAULT_NAME;
    const seed = from === 'buck' ? seedBuckExample : undefined;
    if (where === 'cloud') {
      try {
        const p = Project.create(title, standard);
        seed?.(p);
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
    const id = await createProject(title, standard, seed);
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
        <div className="start-from" role="radiogroup" aria-label="Start from">
          <StartCard
            active={from === 'blank'}
            onClick={() => pick('blank')}
            icon={<FilePlus2 size={20} />}
            title="Blank"
            text="An empty sheet."
            testId="start-blank"
          />
          <StartCard
            active={from === 'buck'}
            onClick={() => pick('buck')}
            icon={<Zap size={20} />}
            title="Example: buck converter"
            text="Power stage, PI controller in a sub-sheet, LaTeX labels."
            testId="start-example"
          />
        </div>
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

function StartCard(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  text: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.active}
      className={`start-card${props.active ? ' active' : ''}`}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      {props.icon}
      <b>{props.title}</b>
      <span className="muted small">{props.text}</span>
    </button>
  );
}

/** "3 min ago", "yesterday", or the date. */
function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (s < 45) return 'just now';
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

interface MenuItem {
  label: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
  testId?: string;
}

/** The "⋯" menu of a project card. */
function CardMenu({ items, name }: { items: MenuItem[]; name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="card-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Actions for ${name}`}
        aria-expanded={open}
        title="Actions"
        onClick={() => setOpen(!open)}
        data-testid="card-menu"
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
              data-testid={it.testId}
            >
              {it.icon} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard(props: {
  href: string;
  name: string;
  thumbnail?: string | null;
  badge: string;
  meta: string;
  menu: MenuItem[];
  testId: string;
}) {
  return (
    <article className="project-card" data-testid={props.testId}>
      <a className="thumb" href={props.href} aria-label={`Open ${props.name}`}>
        {props.thumbnail ? (
          <img
            alt=""
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(props.thumbnail)}`}
          />
        ) : (
          <span className="muted small">Empty sheet</span>
        )}
      </a>
      <div className="card-body">
        <a className="card-title" href={props.href} title={props.name}>
          {props.name}
        </a>
        <span className="card-meta">
          <span className={`badge ${props.badge === 'Local' ? '' : 'shared'}`}>{props.badge}</span>
          {props.meta}
        </span>
      </div>
      <CardMenu items={props.menu} name={props.name} />
    </article>
  );
}

type Filter = 'all' | 'local' | 'cloud';
type Sort = 'recent' | 'name';
type Item = { kind: 'local'; p: ProjectEntry } | { kind: 'cloud'; p: CloudProjectEntry };

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null);
  const [newDialog, setNewDialog] = useState<StartFrom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
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

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const upload = async (p: ProjectEntry) => {
    try {
      const r = await exportProjectUpdate(p.id);
      const res = await api<{ id: string }>('POST', '/api/projects', {
        name: r.name,
        state: bytesToBase64(r.update),
      });
      navigate(`/cloud/${res.id}`);
    } catch (e) {
      fail(e);
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
      fail(e);
    }
  };

  const items = useMemo(() => {
    const all: Item[] = [
      ...(filter !== 'cloud' ? (projects ?? []).map((p) => ({ kind: 'local' as const, p })) : []),
      ...(filter !== 'local' && user
        ? (cloudProjects ?? []).map((p) => ({ kind: 'cloud' as const, p }))
        : []),
    ];
    const q = query.trim().toLowerCase();
    const found = q ? all.filter((i) => i.p.name.toLowerCase().includes(q)) : all;
    return found.sort((a, b) =>
      sort === 'name' ? a.p.name.localeCompare(b.p.name) : b.p.updatedAt - a.p.updatedAt,
    );
  }, [projects, cloudProjects, user, filter, query, sort]);

  const total = (projects?.length ?? 0) + (user ? (cloudProjects?.length ?? 0) : 0);
  const loading = projects === null;

  const localMenu = (p: ProjectEntry): MenuItem[] => [
    {
      label: 'Rename',
      icon: <Pencil size={14} />,
      run: async () => {
        const name = prompt('Project name', p.name);
        if (name?.trim() && name !== p.name) {
          await renameProject(p.id, name.trim());
          refresh();
        }
      },
    },
    {
      label: 'Duplicate',
      icon: <Copy size={14} />,
      run: async () => {
        await duplicateProject(p.id);
        refresh();
      },
    },
    {
      label: 'Download .olg file',
      icon: <Download size={14} />,
      run: async () => {
        const r = await exportProjectUpdate(p.id);
        download(
          new Blob([encodeOlg(r.name, r.update, r.json) as BlobPart], { type: 'application/zip' }),
          `${safeFileName(r.name)}.olg`,
        );
      },
    },
    ...(user
      ? [
          {
            label: 'Share on the server',
            icon: <UploadCloud size={14} />,
            run: () => void upload(p),
            testId: 'upload-project',
          },
        ]
      : []),
    {
      label: 'Delete',
      icon: <Trash size={14} />,
      danger: true,
      run: async () => {
        if (confirm(`Delete “${p.name}”? This cannot be undone.`)) {
          await deleteProject(p.id);
          refresh();
        }
      },
    },
  ];

  const cloudMenu = (p: CloudProjectEntry): MenuItem[] =>
    p.role === 'owner'
      ? [
          {
            label: 'Delete for everyone',
            icon: <Trash size={14} />,
            danger: true,
            run: async () => {
              if (confirm(`Delete “${p.name}” for everyone? This cannot be undone.`)) {
                await api('DELETE', `/api/projects/${p.id}`).catch(fail);
                refreshCloud();
              }
            },
          },
        ]
      : [
          {
            label: 'Leave this project',
            icon: <LogOut size={14} />,
            run: async () => {
              if (user && confirm(`Leave “${p.name}”?`)) {
                await api('DELETE', `/api/projects/${p.id}/members/${user.id}`).catch(fail);
                refreshCloud();
              }
            },
          },
        ];

  return (
    <div className="dashboard" data-theme={theme}>
      <header className="dash-top">
        <a className="dash-brand" href="../" title="About Circuit Notebook">
          <Logo size={28} />
          <span className="logo">Circuit Notebook</span>
        </a>
        <div className="dash-top-right">
          <AccountMenu />
          <ThemePicker />
        </div>
      </header>

      <div className="dash-title-row">
        <div>
          <h1>Projects</h1>
          <p className="muted small">
            {user
              ? 'In this browser and shared with you on the server.'
              : 'Saved in this browser. Connect to a server to share and work together.'}
          </p>
        </div>
        <div className="dash-title-actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Import
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => setNewDialog('blank')}
            data-testid="new-project"
          >
            <Plus size={16} /> New project
          </button>
        </div>
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

      {total > 0 && (
        <div className="dash-toolbar">
          <label className="dash-search">
            <Search size={15} />
            <input
              type="search"
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="project-search"
            />
          </label>
          {user && (
            <div className="segmented" role="group" aria-label="Show">
              {(
                [
                  ['all', 'All'],
                  ['local', 'This browser'],
                  ['cloud', 'Shared'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={filter === k ? 'active' : ''}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <label className="dash-sort">
            <span className="muted small">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recent">Last edited</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      )}

      {error && <p className="warning">{error}</p>}

      {!loading && total === 0 ? (
        <div className="dash-empty">
          <Logo size={56} className="dash-empty-logo" />
          <h2>Start your first project</h2>
          <p className="muted">
            A schematic, a control loop or a flowchart — on sheets you can open like blocks.
          </p>
          <div className="dash-empty-actions">
            <button type="button" className="btn primary" onClick={() => setNewDialog('blank')}>
              <Plus size={16} /> New project
            </button>
            <button type="button" className="btn" onClick={() => void openExample()}>
              <Zap size={15} /> Open the example
            </button>
          </div>
        </div>
      ) : (
        <section className="project-grid" data-testid="project-list">
          {items.map((i) =>
            i.kind === 'local' ? (
              <ProjectCard
                key={`l-${i.p.id}`}
                href={`#/p/${i.p.id}`}
                name={i.p.name}
                thumbnail={i.p.thumbnail}
                badge="Local"
                meta={`Edited ${ago(i.p.updatedAt)}`}
                menu={localMenu(i.p)}
                testId="project-card"
              />
            ) : (
              <ProjectCard
                key={`c-${i.p.id}`}
                href={`#/cloud/${i.p.id}`}
                name={i.p.name}
                thumbnail={i.p.thumbnail}
                badge={i.p.role === 'owner' ? 'Shared' : ROLE_LABELS[i.p.role]}
                meta={`${i.p.role === 'owner' ? 'Yours' : `By ${i.p.owner}`} · ${ago(i.p.updatedAt)}`}
                menu={cloudMenu(i.p)}
                testId="cloud-card"
              />
            ),
          )}
          {!items.length && !loading && (
            <p className="muted dash-none">No project matches “{query}”.</p>
          )}
        </section>
      )}

      <footer className="dash-foot">
        <a href="#/gallery">Symbol gallery</a>
        <button
          type="button"
          className="link"
          onClick={() => void openExample()}
          data-testid="open-example"
        >
          Example project
        </button>
        <a href="../">About</a>
        <span className="muted">
          {user
            ? 'Local projects stay in this browser until you share them.'
            : 'Your projects stay in this browser.'}
        </span>
      </footer>
      {newDialog && <NewProjectDialog start={newDialog} onClose={() => setNewDialog(null)} />}
    </div>
  );
}
