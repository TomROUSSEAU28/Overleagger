/**
 * `#/people`: friends and teams. Add a friend by @username or e-mail, answer requests, make
 * teams out of friends. Friends and teams can then be added to a project in two clicks.
 */
import {
  ArrowLeft,
  AtSign,
  Check,
  Copy,
  LogOut,
  Pencil,
  Plus,
  Trash,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Logo } from '../brand/Logo';
import { ThemePicker } from '../panels/ThemePicker';
import { useUI } from '../store/ui';
import { AccountMenu, Avatar } from './AccountUI';
import { useCloud } from './cloud';
import { useSocial, type PublicPerson, type TeamInfo } from './social';

function PersonRow({ p, children }: { p: PublicPerson; children?: ReactNode }) {
  return (
    <li className="person-row">
      <Avatar name={p.name} color={p.color} size={28} />
      <span className="person-name">
        {p.name}
        <span className="muted small">@{p.handle}</span>
      </span>
      <span className="person-actions">{children}</span>
    </li>
  );
}

function useAction() {
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { error, run };
}

function MyUsername() {
  const user = useCloud((s) => s.user)!;
  const [copied, setCopied] = useState(false);
  const { error, run } = useAction();
  return (
    <section className="people-card me-card">
      <Avatar name={user.name} color={user.color} size={40} />
      <div>
        <b>{user.name}</b>
        <div className="handle-line">
          <span className="handle" data-testid="my-handle">
            @{user.handle}
          </span>
          <button
            type="button"
            className="icon-btn"
            title="Copy"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(`@${user.handle}`)
                .then(() => setCopied(true))
                .catch(() => undefined)
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Change my username"
            onClick={() => {
              const h = prompt('Your username (letters, digits, dots, underscores)', user.handle);
              if (h && h !== user.handle)
                void run(() => useCloud.getState().updateMe({ handle: h }));
            }}
          >
            <Pencil size={14} />
          </button>
        </div>
        <p className="muted small">
          Give your username to your friends: they add you with it (or with your e-mail).
        </p>
        {error && <p className="warning small">{error}</p>}
      </div>
    </section>
  );
}

function Friends() {
  const { friends, incoming, outgoing, friendsCall } = useSocial();
  const [who, setWho] = useState('');
  const [sent, setSent] = useState('');
  const { error, run } = useAction();
  const add = (e: FormEvent) => {
    e.preventDefault();
    const w = who.trim();
    if (!w) return;
    void run(async () => {
      await friendsCall('POST', '/api/friends', { who: w });
      setSent(w);
      setWho('');
    });
  };
  return (
    <section className="people-card">
      <h2>
        <UserPlus size={18} /> Friends
      </h2>
      <form className="people-add" onSubmit={add}>
        <label className="people-input">
          <AtSign size={15} />
          <input
            value={who}
            onChange={(e) => {
              setWho(e.target.value);
              setSent('');
            }}
            placeholder="username or e-mail address"
            data-testid="friend-who"
          />
        </label>
        <button
          type="submit"
          className="btn primary"
          disabled={!who.trim()}
          data-testid="friend-add"
        >
          Add
        </button>
      </form>
      {sent && !error && <p className="muted small">Request sent to {sent}.</p>}
      {error && <p className="warning small">{error}</p>}

      {incoming.length > 0 && (
        <>
          <h3 className="people-h">Requests for you</h3>
          <ul className="people-list" data-testid="friend-requests">
            {incoming.map((p) => (
              <PersonRow key={p.id} p={p}>
                <button
                  type="button"
                  className="btn primary small-btn"
                  onClick={() => void run(() => friendsCall('POST', `/api/friends/${p.id}/accept`))}
                  data-testid="friend-accept"
                >
                  <Check size={14} /> Accept
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Decline"
                  onClick={() => void run(() => friendsCall('DELETE', `/api/friends/${p.id}`))}
                >
                  <X size={15} />
                </button>
              </PersonRow>
            ))}
          </ul>
        </>
      )}

      <h3 className="people-h">Your friends</h3>
      {friends.length ? (
        <ul className="people-list" data-testid="friends">
          {friends.map((p) => (
            <PersonRow key={p.id} p={p}>
              <button
                type="button"
                className="icon-btn"
                title="Remove from your friends"
                onClick={() =>
                  confirm(`Remove ${p.name} from your friends?`) &&
                  void run(() => friendsCall('DELETE', `/api/friends/${p.id}`))
                }
              >
                <UserMinus size={15} />
              </button>
            </PersonRow>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          No friend yet. Add someone with their username or e-mail: they get a request to accept.
        </p>
      )}

      {outgoing.length > 0 && (
        <>
          <h3 className="people-h">Waiting for an answer</h3>
          <ul className="people-list">
            {outgoing.map((p) => (
              <PersonRow key={p.id} p={p}>
                <button
                  type="button"
                  className="link muted small"
                  onClick={() => void run(() => friendsCall('DELETE', `/api/friends/${p.id}`))}
                >
                  Cancel
                </button>
              </PersonRow>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function TeamCard({ team }: { team: TeamInfo }) {
  const me = useCloud((s) => s.user)!;
  const { friends, teamsCall } = useSocial();
  const { error, run } = useAction();
  const owner = team.ownerId === me.id;
  const addable = friends.filter((f) => !team.members.some((m) => m.id === f.id));
  return (
    <article className="team-card" data-testid="team">
      <header>
        <Users size={16} />
        <b>{team.name}</b>
        <span className="muted small">
          {team.members.length} {team.members.length === 1 ? 'person' : 'people'}
        </span>
        <span style={{ flex: 1 }} />
        {owner ? (
          <>
            <button
              type="button"
              className="icon-btn"
              title="Rename"
              onClick={() => {
                const name = prompt('Team name', team.name);
                if (name?.trim())
                  void run(() => teamsCall('PATCH', `/api/teams/${team.id}`, { name }));
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="icon-btn danger"
              title="Delete the team"
              onClick={() =>
                confirm(`Delete the team “${team.name}”? Its projects stay with their owners.`) &&
                void run(() => teamsCall('DELETE', `/api/teams/${team.id}`))
              }
            >
              <Trash size={14} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn small-btn"
            onClick={() =>
              confirm(`Leave the team “${team.name}”?`) &&
              void run(() => teamsCall('DELETE', `/api/teams/${team.id}/members/${me.id}`))
            }
          >
            <LogOut size={13} /> Leave
          </button>
        )}
      </header>
      <ul className="team-members">
        {team.members.map((m) => (
          <li key={m.id} title={`@${m.handle}`}>
            <Avatar name={m.name} color={m.color} size={22} />
            <span>{m.id === me.id ? `${m.name} (you)` : m.name}</span>
            {m.id === team.ownerId && <span className="role-tag">creator</span>}
            {owner && m.id !== me.id && (
              <button
                type="button"
                className="icon-btn"
                title="Remove from the team"
                onClick={() =>
                  void run(() => teamsCall('DELETE', `/api/teams/${team.id}/members/${m.id}`))
                }
              >
                <X size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <select
          className="team-add"
          value=""
          onChange={(e) =>
            e.target.value &&
            void run(() =>
              teamsCall('POST', `/api/teams/${team.id}/members`, { userId: e.target.value }),
            )
          }
          disabled={!addable.length}
          data-testid="team-add-member"
        >
          <option value="">{addable.length ? '+ Add a friend…' : 'All your friends are in'}</option>
          {addable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} (@{f.handle})
            </option>
          ))}
        </select>
      )}
      {error && <p className="warning small">{error}</p>}
    </article>
  );
}

function Teams() {
  const { teams, teamsCall } = useSocial();
  const [name, setName] = useState('');
  const { error, run } = useAction();
  return (
    <section className="people-card">
      <h2>
        <Users size={18} /> Teams
      </h2>
      <form
        className="people-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim())
            void run(async () => {
              await teamsCall('POST', '/api/teams', { name });
              setName('');
            });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New team, e.g. “PFC lab group 4”"
          data-testid="team-name"
        />
        <button
          type="submit"
          className="btn primary"
          disabled={!name.trim()}
          data-testid="team-create"
        >
          <Plus size={15} /> Create
        </button>
      </form>
      {error && <p className="warning small">{error}</p>}
      {teams.length ? (
        <div className="team-list">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      ) : (
        <p className="muted small">
          A team is a group of friends. Share a project with the team: everybody in it gets access,
          including the people you add later.
        </p>
      )}
    </section>
  );
}

export function PeoplePage() {
  const theme = useUI((s) => s.theme);
  const user = useCloud((s) => s.user);
  const status = useCloud((s) => s.status);
  useEffect(() => {
    document.title = 'Friends & teams — Circuit Notebook';
    void useSocial
      .getState()
      .load()
      .catch(() => undefined);
  }, [user?.id]);
  return (
    <div className="dashboard people-page" data-theme={theme}>
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
          <h1>Friends &amp; teams</h1>
          <p className="muted small">
            Add friends, group them in teams, then share a project with them from the Share button.
          </p>
        </div>
      </div>
      {!user ? (
        <div className="dash-empty">
          <h2>Sign in to work with others</h2>
          <p className="muted">
            {status === 'online'
              ? 'Use the Sign in button at the top right.'
              : 'Connect to a Circuit Notebook server first (top right).'}
          </p>
        </div>
      ) : (
        <>
          <MyUsername />
          <div className="people-grid">
            <Friends />
            <Teams />
          </div>
        </>
      )}
    </div>
  );
}
