/**
 * `#/admin`: how the server is doing (accounts, projects, storage, disk, nightly copy of the
 * database) and each account's room on the server. Only for the e-mails in ADMIN_EMAILS.
 */
import { ArrowLeft, Check, DatabaseBackup, Mail, RefreshCw, Reply, Trash } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Logo } from '../brand/Logo';
import { ThemePicker } from '../panels/ThemePicker';
import { useUI } from '../store/ui';
import { AccountMenu } from './AccountUI';
import { api, useCloud } from './cloud';
import { formatBytes } from './quota';

interface Stats {
  users: number;
  newUsers: number;
  projects: number;
  activeProjects: number;
  teams: number;
  docsBytes: number;
  versionsBytes: number;
  dbBytes: number;
  disk: { free: number; total: number } | null;
  backup: { at: number; bytes: number } | null;
  limits: { maxProjects: number; maxProjectBytes: number };
  biggest: {
    id: string;
    name: string;
    updated_at: number;
    owner_name: string;
    owner_email: string;
    bytes: number;
    versions_bytes: number;
  }[];
}

interface Message {
  id: string;
  at: number;
  name: string;
  email: string;
  body: string;
  read: boolean;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  handle: string;
  createdAt: number;
  lastSignIn: number | null;
  projects: number;
  bytes: number;
  maxProjects: number | null;
  admin: boolean;
}

const day = (t: number | null) =>
  t ? new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
const when = (t: number) =>
  new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="admin-tile">
      <span className="muted small">{label}</span>
      <b>{value}</b>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

function LimitCell({ u, def, onSaved }: { u: AdminUser; def: number; onSaved: () => void }) {
  const [v, setV] = useState(u.maxProjects === null ? '' : String(u.maxProjects));
  const [error, setError] = useState('');
  if (u.admin) return <span className="muted small">no limit (admin)</span>;
  const save = async () => {
    const t = v.trim();
    if (t === (u.maxProjects === null ? '' : String(u.maxProjects))) return;
    try {
      await api('PATCH', `/api/admin/users/${u.id}`, { maxProjects: t === '' ? null : Number(t) });
      setError('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <span className="admin-limit">
      <input
        type="number"
        min={0}
        value={v}
        placeholder={String(def)}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={`Projects allowed for ${u.name}`}
        data-testid="admin-limit"
      />
      {error && <span className="warning small">{error}</span>}
    </span>
  );
}

export function AdminPage() {
  const theme = useUI((s) => s.theme);
  const user = useCloud((s) => s.user);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [def, setDef] = useState(5);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, u, m] = await Promise.all([
        api<Stats>('GET', '/api/admin/stats'),
        api<{ users: AdminUser[]; defaultMaxProjects: number }>('GET', '/api/admin/users'),
        api<{ messages: Message[] }>('GET', '/api/admin/messages'),
      ]);
      setStats(s);
      setMessages(m.messages);
      setUsers(u.users);
      setDef(u.defaultMaxProjects);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    document.title = 'Administration — Circuit Notebook';
    if (user?.admin) void load();
  }, [user?.admin, load]);

  const backupNow = async () => {
    setBusy(true);
    try {
      await api('POST', '/api/admin/backup');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const diskUsed = stats?.disk ? 1 - stats.disk.free / stats.disk.total : 0;
  const unread = messages.filter((m) => !m.read).length;
  const setRead = async (m: Message, read: boolean) => {
    await api('PATCH', `/api/admin/messages/${m.id}`, { read }).catch(() => undefined);
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, read } : x)));
  };
  const remove = async (m: Message) => {
    if (!confirm(`Delete the message of ${m.name || m.email}?`)) return;
    await api('DELETE', `/api/admin/messages/${m.id}`).catch(() => undefined);
    setMessages((list) => list.filter((x) => x.id !== m.id));
  };
  return (
    <div className="dashboard admin-page" data-theme={theme}>
      <header className="dash-top">
        <a className="dash-brand" href="#/" title="Your projects">
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
          <a className="back-link" href="#/">
            <ArrowLeft size={14} /> Projects
          </a>
          <h1>Administration</h1>
          <p className="muted small">
            Beta limits: {stats?.limits.maxProjects ?? def} projects per account,{' '}
            {stats ? formatBytes(stats.limits.maxProjectBytes) : '…'} per project (change them with
            MAX_PROJECTS and MAX_PROJECT_MB on the server).
          </p>
        </div>
        {user?.admin && (
          <div className="dash-title-actions">
            <button type="button" className="btn" onClick={() => void load()}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        )}
      </div>

      {!user?.admin ? (
        <div className="dash-empty">
          <h2>This page is for the administrators</h2>
          <p className="muted">Sign in with an administrator account (ADMIN_EMAILS).</p>
        </div>
      ) : (
        <>
          {error && <p className="warning">{error}</p>}
          <section className="people-card" data-testid="admin-messages">
            <h2>
              <Mail size={18} /> Messages
              {unread > 0 && <span className="count-badge">{unread}</span>}
            </h2>
            <p className="muted small">
              Answer within a month; the server deletes messages after one year (privacy policy).
            </p>
            {messages.length ? (
              <ul className="admin-messages">
                {messages.map((m) => (
                  <li key={m.id} className={m.read ? 'read' : ''}>
                    <div className="msg-head">
                      <b>{m.name || m.email}</b>
                      <span className="muted small">
                        {m.name ? `${m.email} · ` : ''}
                        {when(m.at)}
                      </span>
                      <span style={{ flex: 1 }} />
                      <a
                        className="icon-btn"
                        title="Answer by e-mail"
                        href={`mailto:${m.email}?subject=${encodeURIComponent('Re: your message about Circuit Notebook')}`}
                        onClick={() => void setRead(m, true)}
                      >
                        <Reply size={15} />
                      </a>
                      <button
                        type="button"
                        className="icon-btn"
                        title={m.read ? 'Mark as unread' : 'Mark as read'}
                        onClick={() => void setRead(m, !m.read)}
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete"
                        onClick={() => void remove(m)}
                      >
                        <Trash size={15} />
                      </button>
                    </div>
                    <p className="msg-body">{m.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">
                No message yet. Visitors write to you from the form at the bottom of the homepage.
              </p>
            )}
          </section>
          {stats && (
            <section className="admin-tiles" data-testid="admin-stats">
              <Tile
                label="Accounts"
                value={String(stats.users)}
                note={`+${stats.newUsers} this week`}
              />
              <Tile
                label="Projects on the server"
                value={String(stats.projects)}
                note={`${stats.activeProjects} edited this week · ${stats.teams} teams`}
              />
              <Tile
                label="Storage"
                value={formatBytes(stats.docsBytes + stats.versionsBytes)}
                note={`drawings ${formatBytes(stats.docsBytes)} · history ${formatBytes(stats.versionsBytes)}`}
              />
              <Tile label="Database file" value={formatBytes(stats.dbBytes)} />
              <Tile
                label="Disk"
                value={stats.disk ? `${formatBytes(stats.disk.free)} free` : '—'}
                note={
                  stats.disk
                    ? `${Math.round(diskUsed * 100)} % of ${formatBytes(stats.disk.total)} used`
                    : undefined
                }
              />
              <div className="admin-tile">
                <span className="muted small">Nightly copy of the database</span>
                <b className="admin-date">{stats.backup ? when(stats.backup.at) : 'none yet'}</b>
                <button
                  type="button"
                  className="link small"
                  disabled={busy}
                  onClick={() => void backupNow()}
                >
                  <DatabaseBackup size={13} /> Make one now
                </button>
              </div>
            </section>
          )}

          <section className="people-card">
            <h2>Accounts</h2>
            <div className="admin-table-wrap">
              <table className="admin-table" data-testid="admin-users">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>E-mail</th>
                    <th>Joined</th>
                    <th>Last sign-in</th>
                    <th>Projects</th>
                    <th>Storage</th>
                    <th title="Empty: the default">Projects allowed</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.name}
                        <span className="muted small"> @{u.handle}</span>
                      </td>
                      <td>{u.email}</td>
                      <td>{day(u.createdAt)}</td>
                      <td>{day(u.lastSignIn)}</td>
                      <td>{u.projects}</td>
                      <td>{formatBytes(u.bytes)}</td>
                      <td>
                        <LimitCell u={u} def={def} onSaved={() => void load()} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {stats && stats.biggest.length > 0 && (
            <section className="people-card">
              <h2>Heaviest projects</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Owner</th>
                      <th>Drawing</th>
                      <th>History</th>
                      <th>Last edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.biggest.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>
                          {p.owner_name} <span className="muted small">{p.owner_email}</span>
                        </td>
                        <td>{formatBytes(p.bytes)}</td>
                        <td>{formatBytes(p.versions_bytes)}</td>
                        <td>{day(p.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
