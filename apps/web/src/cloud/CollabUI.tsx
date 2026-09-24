import {
  Project,
  ROLE_LABELS,
  ROLES,
  elementBBox,
  rectUnion,
  roleAtLeast,
  type PortElement,
  type Rect,
  type Role,
  type SheetContext,
} from '@overleagger/core';
import {
  Check,
  Cloud,
  CloudOff,
  Copy,
  History,
  Link2,
  Lock,
  MonitorPlay,
  RefreshCw,
  RotateCcw,
  Save,
  Share2,
  Trash,
  UploadCloud,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSocial } from './social';
import * as Y from 'yjs';
import { SheetRenderer } from '../canvas/render/SheetRenderer';
import { useEditor } from '../editor/context';
import { Field, Modal } from '../panels/common';
import { navigate } from '../router';
import { useUI } from '../store/ui';
import { THEMES } from '../theme';
import { Avatar } from './AccountUI';
import { api, base64ToBytes, bytesToBase64, inviteLink, useCloud, type Member } from './cloud';
import { useSession } from './hooks';

// ---------------------------------------------------------------------------
// Top bar: status, people, share, history
// ---------------------------------------------------------------------------

export function CollabBar() {
  const ed = useEditor();
  const status = useSession((s) => s.status);
  const unsynced = useSession((s) => s.unsynced);
  const peers = useSession((s) => s.peers);
  const following = useSession((s) => s.following);
  const user = useCloud((s) => s.user);
  const [dialog, setDialog] = useState<'share' | 'history' | null>(null);
  // One avatar per person (someone may have several tabs open).
  const people = useMemo(() => {
    const m = new Map<string, (typeof peers)[number]>();
    for (const p of peers) if (!m.has(p.user.id)) m.set(p.user.id, p);
    return [...m.values()];
  }, [peers]);

  const presenter = people.find((p) => p.presenting);
  const presenting = useUI((s) => s.presenting);
  return (
    <div className="collab-bar">
      {presenter && !presenting && (
        <button
          type="button"
          className="btn presenter-btn"
          style={{ ['--c' as string]: presenter.user.color }}
          onClick={() =>
            useUI.getState().set({ presenting: true, presentFollow: presenter.user.id })
          }
          data-testid="join-presentation"
        >
          <MonitorPlay size={15} /> {presenter.user.name} is presenting — Join
        </button>
      )}
      {ed.session && (
        <span
          className={`sync-state ${status}`}
          title={
            status === 'connected'
              ? unsynced
                ? 'Sending your changes…'
                : 'All changes saved on the server'
              : status === 'connecting'
                ? 'Connecting to the server…'
                : 'Offline: your changes are kept here and will be sent when you are back online'
          }
          data-testid="sync-state"
        >
          {status === 'offline' ? <CloudOff size={16} /> : <Cloud size={16} />}
          {status !== 'connected' || unsynced ? <i /> : null}
        </span>
      )}
      <div className="avatars">
        {people.map((p) => (
          <button
            key={p.user.id}
            type="button"
            className={`avatar-btn${following === p.user.id ? ' following' : ''}`}
            onClick={() =>
              ed.session!.state.setState({ following: following === p.user.id ? null : p.user.id })
            }
            title={
              following === p.user.id
                ? `Following ${p.user.name} (click to stop)`
                : `${p.user.name}${p.presenting ? ' — presenting' : ''}: click to follow their view`
            }
            style={{ ['--c' as string]: p.user.color }}
            data-testid="peer-avatar"
          >
            <Avatar
              name={p.user.name}
              color={p.user.color}
              size={26}
              ring={Boolean(p.presenting)}
            />
          </button>
        ))}
      </div>
      {ed.session && (
        <button
          type="button"
          className="icon-btn"
          title="Version history"
          onClick={() => setDialog('history')}
          data-testid="open-history"
        >
          <History size={17} />
        </button>
      )}
      {(ed.session || user) && (
        <button
          type="button"
          className="btn"
          onClick={() => setDialog('share')}
          data-testid="open-share"
        >
          <Share2 size={15} /> Share
        </button>
      )}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
      {dialog === 'history' && <HistoryDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner: what the user may do here
// ---------------------------------------------------------------------------

export function AccessBanner() {
  const ed = useEditor();
  const role = useSession((s) => s.role);
  const refused = useSession((s) => s.refused);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  // Re-render when locks change.
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    ed.project.locks.observe(h);
    return () => ed.project.locks.unobserve(h);
  }, [ed]);
  const lock = ed.project.getLock(sheetId);
  let msg: React.ReactNode = null;
  if (role === 'viewer')
    msg = 'View only: you can look, present and export, but not change this project.';
  else if (role === 'commenter')
    msg = 'Comment only: add comments with the comment tool (C); the drawing is read-only for you.';
  else if (lock)
    msg = (
      <>
        <Lock size={13} /> This sheet is locked by {lock.by.name}
        {role === 'owner' ? (
          <button
            type="button"
            className="link accent"
            onClick={() => ed.project.setLock(sheetId, null)}
          >
            Unlock
          </button>
        ) : (
          ': only the owner can change it.'
        )}
      </>
    );
  if (!msg && !refused) return null;
  return (
    <div className="access-banner" data-testid="access-banner">
      {msg}
      {refused && (
        <span className="refused">
          The server refused a change: {refused}
          <button
            type="button"
            className="link accent"
            onClick={() => ed.session?.state.setState({ refused: null })}
          >
            OK
          </button>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share dialog
// ---------------------------------------------------------------------------

interface InviteInfo {
  token: string;
  role: Role;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
}

function ShareDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const session = ed.session;
  const close = onClose;

  // Local project: offer to upload it first.
  if (!session) {
    return (
      <Modal title="Share this project" onClose={close}>
        <p>
          This project lives only in this browser. Upload a copy to the server to invite people and
          work on it together in real time (this local copy is kept).
        </p>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            data-testid="share-upload"
            onClick={async () => {
              const r = await api<{ id: string }>('POST', '/api/projects', {
                name: ed.project.getMeta().name,
                state: bytesToBase64(ed.project.encodeState()),
              });
              close();
              navigate(`/cloud/${r.id}`);
            }}
          >
            <UploadCloud size={15} /> Upload and share
          </button>
        </div>
      </Modal>
    );
  }
  return <CloudShare onClose={close} />;
}

function CloudShare({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const session = ed.session!;
  const role = useSession((s) => s.role);
  const members = useSession((s) => s.members);
  const teams = useSession((s) => s.teams);
  const me = useCloud((s) => s.user);
  const isOwner = role === 'owner';
  const social = useSocial();
  const [pick, setPick] = useState('');
  const [pickRole, setPickRole] = useState<Role>('editor');
  useEffect(() => {
    if (isOwner) void social.load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);
  // Friends and teams not on the project yet.
  const friendChoices = social.friends.filter((f) => !members.some((m) => m.id === f.id));
  const teamChoices = social.teams.filter((t) => !teams.some((x) => x.id === t.id));
  const addPicked = () => {
    const [kind, id] = pick.split(':');
    if (!id) return;
    void run(async () => {
      if (kind === 'team')
        await api('POST', `/api/projects/${session.id}/teams`, { teamId: id, role: pickRole });
      else await api('POST', `/api/projects/${session.id}/members`, { userId: id, role: pickRole });
      setPick('');
    });
  };
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [newRole, setNewRole] = useState<Role>('editor');
  const [days, setDays] = useState(7);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    await session.refreshRole();
    if (isOwner)
      setInvites(
        (await api<{ invites: InviteInfo[] }>('GET', `/api/projects/${session.id}/invites`))
          .invites,
      );
  };
  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const copy = async (token: string) => {
    await navigator.clipboard?.writeText(inviteLink(token)).catch(() => undefined);
    setCopied(token);
  };

  return (
    <Modal title="Share" onClose={onClose}>
      {isOwner && (
        <>
          <h3 className="share-h">Add people</h3>
          {friendChoices.length || teamChoices.length ? (
            <div className="share-add">
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                data-testid="share-pick"
              >
                <option value="">Choose a friend or a team…</option>
                {teamChoices.length > 0 && (
                  <optgroup label="Your teams">
                    {teamChoices.map((t) => (
                      <option key={t.id} value={`team:${t.id}`}>
                        {t.name} ({t.members.length})
                      </option>
                    ))}
                  </optgroup>
                )}
                {friendChoices.length > 0 && (
                  <optgroup label="Your friends">
                    {friendChoices.map((f) => (
                      <option key={f.id} value={`user:${f.id}`}>
                        {f.name} (@{f.handle})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <select
                value={pickRole}
                onChange={(e) => setPickRole(e.target.value as Role)}
                aria-label="Role"
              >
                {ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn primary"
                disabled={!pick}
                onClick={addPicked}
                data-testid="share-add"
              >
                <UserPlus size={15} /> Add
              </button>
            </div>
          ) : (
            <p className="muted small">
              {social.friends.length || social.teams.length
                ? 'All your friends and teams are already here.'
                : 'Add friends or create a team in '}
              {!(social.friends.length || social.teams.length) && (
                <a href="#/people" onClick={onClose}>
                  Friends &amp; teams
                </a>
              )}
              {!(social.friends.length || social.teams.length) &&
                ' to add them here in one click — or send an invite link below.'}
            </p>
          )}
        </>
      )}
      <h3 className="share-h">People with access</h3>
      <ul className="members" data-testid="members">
        {members.map((m: Member) => (
          <li key={m.id}>
            <Avatar name={m.name} color={m.color} size={24} />
            <span className="member-name">
              {m.name}
              {m.id === me?.id ? ' (you)' : ''}
              <span className="muted small">{m.email}</span>
            </span>
            {isOwner && m.id !== me?.id ? (
              <>
                <select
                  value={m.role}
                  onChange={(e) =>
                    void run(() =>
                      api('PATCH', `/api/projects/${session.id}/members/${m.id}`, {
                        role: e.target.value,
                      }),
                    )
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r === 'owner' ? 'Make owner' : ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Remove"
                  onClick={() =>
                    confirm(`Remove ${m.name} from this project?`) &&
                    void run(() => api('DELETE', `/api/projects/${session.id}/members/${m.id}`))
                  }
                >
                  <Trash size={14} />
                </button>
              </>
            ) : (
              <span className="role-tag">{ROLE_LABELS[m.role]}</span>
            )}
          </li>
        ))}
      </ul>
      {teams.length > 0 && (
        <ul className="members" data-testid="project-teams">
          {teams.map((t) => (
            <li key={t.id}>
              <span className="team-avatar">
                <Users size={14} />
              </span>
              <span className="member-name">
                {t.name}
                <span className="muted small">
                  team · {t.size} {t.size === 1 ? 'person' : 'people'}
                </span>
              </span>
              {isOwner ? (
                <>
                  <select
                    value={t.role}
                    onChange={(e) =>
                      void run(() =>
                        api('PATCH', `/api/projects/${session.id}/teams/${t.id}`, {
                          role: e.target.value,
                        }),
                      )
                    }
                  >
                    {ROLES.filter((r) => r !== 'owner').map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Remove the team from this project"
                    onClick={() =>
                      confirm(`Remove the team “${t.name}” from this project?`) &&
                      void run(() => api('DELETE', `/api/projects/${session.id}/teams/${t.id}`))
                    }
                  >
                    <Trash size={14} />
                  </button>
                </>
              ) : (
                <span className="role-tag">{ROLE_LABELS[t.role]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <>
          <h3 className="share-h">Invite links</h3>
          <div className="row">
            <Field label="People who open the link">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                data-testid="invite-role"
              >
                {ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Valid for">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={0}>No limit</option>
              </select>
            </Field>
          </div>
          <button
            type="button"
            className="btn primary"
            data-testid="create-invite"
            onClick={() =>
              void run(async () => {
                const r = await api<{ invite: InviteInfo }>(
                  'POST',
                  `/api/projects/${session.id}/invites`,
                  {
                    role: newRole,
                    ...(days ? { days } : {}),
                  },
                );
                await copy(r.invite.token);
              })
            }
          >
            <Link2 size={15} /> Create a link and copy it
          </button>
          <ul className="invites">
            {invites.map((i) => (
              <li key={i.token}>
                <span className="role-tag">{ROLE_LABELS[i.role]}</span>
                <input
                  className="mono"
                  readOnly
                  value={inviteLink(i.token)}
                  data-testid="invite-link"
                />
                <span className="muted small">
                  {i.uses} use{i.uses === 1 ? '' : 's'}
                  {i.expiresAt ? ` · until ${new Date(i.expiresAt).toLocaleDateString()}` : ''}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  title="Copy"
                  onClick={() => void copy(i.token)}
                >
                  {copied === i.token ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Disable this link"
                  onClick={() => void run(() => api('DELETE', `/api/invites/${i.token}`))}
                >
                  <Trash size={14} />
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Owners manage people and links, and can lock sheets (Sheets tab). Editors change the
            drawing, commenters only add comments, viewers look, present and export.
          </p>
        </>
      ) : (
        <p className="muted small">
          Only the owner can invite people. You can: <b>{ROLE_LABELS[role].toLowerCase()}</b>.
        </p>
      )}
      {error && <p className="warning small">{error}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

interface VersionInfo {
  id: string;
  createdAt: number;
  author: string | null;
  label: string | null;
  auto: boolean;
  size: number;
}

function VersionPreview({ id, versionId }: { id: string; versionId: string }) {
  const ed = useEditor();
  const theme = THEMES[useUI((s) => s.theme)];
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => {
    let alive = true;
    void api<{ state: string }>('GET', `/api/projects/${id}/versions/${versionId}`).then((r) => {
      if (!alive) return;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, base64ToBytes(r.state));
      setProject(new Project(doc));
    });
    return () => {
      alive = false;
    };
  }, [id, versionId]);
  const view = useMemo(() => {
    if (!project) return null;
    const ctx: SheetContext = {
      get standard() {
        return project.getMeta().standard;
      },
      symbol: (sid) => ed.ctx.symbol(sid) ?? project.symbols.get(sid),
      ports: (sheet) =>
        project.getElements(sheet).filter((e): e is PortElement => e.type === 'port'),
    };
    const els = project.getElements(project.rootSheetId);
    const b = rectUnion(els.filter((e) => e.type !== 'group').map((e) => elementBBox(e, ctx, els)));
    const box: Rect = b
      ? { x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 }
      : { x: -100, y: -60, w: 200, h: 120 };
    return { ctx, els, box };
  }, [project, ed.ctx]);
  if (!view) return <div className="version-preview muted small">Loading…</div>;
  const { box } = view;
  return (
    <svg
      className="version-preview"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={{ background: theme.paper }}
    >
      <SheetRenderer
        elements={view.els}
        o={{ theme, ctx: view.ctx, interactive: false, latexRefs: true }}
      />
    </svg>
  );
}

function HistoryDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const session = ed.session!;
  const role = useSession((s) => s.role);
  const canEdit = roleAtLeast(role, 'editor');
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const load = () =>
    api<{ versions: VersionInfo[] }>('GET', `/api/projects/${session.id}/versions`)
      .then((r) => setVersions(r.versions))
      .catch((e: unknown) => setError(String(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const when = (t: number) =>
    new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Modal title="Version history" onClose={onClose} wide>
      <div className="history">
        <div className="history-list">
          {canEdit && (
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                await api('POST', `/api/projects/${session.id}/versions`, { label });
                setLabel('');
                await load();
              }}
            >
              <input
                value={label}
                placeholder="Name this version (e.g. “Sent to the tutor”)"
                onChange={(e) => setLabel(e.target.value)}
                data-testid="version-label"
              />
              <button type="submit" className="btn" data-testid="save-version">
                <Save size={14} /> Save
              </button>
            </form>
          )}
          <p className="muted small">
            A version is kept automatically every few minutes while people edit.
          </p>
          <ul data-testid="versions">
            {versions?.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={selected === v.id ? 'active' : ''}
                  onClick={() => setSelected(v.id)}
                >
                  <b>{v.label ?? 'Automatic save'}</b>
                  <span className="muted small">
                    {when(v.createdAt)}
                    {v.author ? ` · ${v.author}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {versions?.length === 0 && <li className="muted small">No version yet.</li>}
          </ul>
        </div>
        <div className="history-preview">
          {selected ? (
            <>
              <VersionPreview id={session.id} versionId={selected} />
              {canEdit && (
                <button
                  type="button"
                  className="btn primary"
                  data-testid="restore-version"
                  onClick={async () => {
                    if (
                      !confirm(
                        'Bring back this version for everyone? The current state is saved as a version first.',
                      )
                    )
                      return;
                    await api('POST', `/api/projects/${session.id}/versions/${selected}/restore`);
                    onClose();
                  }}
                >
                  <RotateCcw size={15} /> Restore this version
                </button>
              )}
            </>
          ) : (
            <p className="muted">Select a version to preview its main sheet.</p>
          )}
        </div>
      </div>
      {error && (
        <p className="warning small">
          {error} <RefreshCw size={12} />
        </p>
      )}
    </Modal>
  );
}
