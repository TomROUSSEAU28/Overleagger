import { ROLE_LABELS, type Role } from '@overleagger/core';
import {
  Cloud,
  CloudOff,
  Gauge,
  Heart,
  LogIn,
  LogOut,
  Server,
  UserRound,
  Users,
} from 'lucide-react';
import { useSocial } from './social';
import { useEffect, useState } from 'react';
import { Field, Modal } from '../panels/common';
import { navigate } from '../router';
import { SUPPORT_URL } from '../site';
import { Loading, Logo } from '../brand/Logo';
import { ApiError, api, useCloud } from './cloud';

/** Small round avatar with initials in the person's colour. */
export function Avatar({
  name,
  color,
  size = 26,
  title,
  ring,
}: {
  name: string;
  color: string;
  size?: number;
  title?: string;
  ring?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={`avatar${ring ? ' ring' : ''}`}
      title={title ?? name}
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials || '?'}
    </span>
  );
}

/** Choose (or forget) the Circuit Notebook server. */
export function ServerDialog({ onClose }: { onClose: () => void }) {
  const cloud = useCloud();
  const [url, setUrl] = useState(cloud.server ?? 'http://localhost:8787');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Collaboration server" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await cloud.setServer(url);
          setBusy(false);
          if (ok) onClose();
          else setError('No Circuit Notebook server answers at this address.');
        }}
      >
        <p className="muted small">
          Circuit Notebook works fully in your browser. To share projects and work together in real
          time, connect to a Circuit Notebook server (your lab's, or one you run yourself with
          Docker — see the README).
        </p>
        <Field label="Server address">
          <input
            autoFocus
            className="mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://circuits.my-lab.org"
            data-testid="server-url"
          />
        </Field>
        {error && <p className="warning small">{error}</p>}
        <div className="modal-foot">
          {cloud.server && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void cloud.setServer(null);
                onClose();
              }}
            >
              <CloudOff size={14} /> Work offline only
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            data-testid="server-connect"
          >
            Connect
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Sign in or create an account on the current server. */
export function SignInDialog({
  onClose,
  invite,
  onDone,
}: {
  onClose: () => void;
  invite?: string;
  onDone?: () => void;
}) {
  const cloud = useCloud();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canSignUp = cloud.info?.signup || Boolean(invite);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') await cloud.signIn(email, password);
      else await cloud.signUp(email, name, password, invite);
      onDone?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const githubUrl = `${cloud.server}/api/auth/github?return=${encodeURIComponent(
    `${location.origin}${location.pathname}`,
  )}`;
  return (
    <Modal title={mode === 'in' ? 'Sign in' : 'Create an account'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="muted small">
          Server: <span className="mono">{cloud.server}</span>
        </p>
        {mode === 'up' && (
          <Field label="Name (shown to your collaborators)">
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="auth-name" />
          </Field>
        )}
        <Field label="Email">
          <input
            type="email"
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="auth-email"
          />
        </Field>
        <Field label={mode === 'up' ? 'Password (8 characters or more)' : 'Password'}>
          <input
            type="password"
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="auth-password"
          />
        </Field>
        {error && <p className="warning small">{error}</p>}
        <div className="modal-foot">
          {canSignUp && (
            <button
              type="button"
              className="link accent"
              onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
              data-testid="auth-switch"
            >
              {mode === 'in' ? 'No account yet? Create one' : 'I already have an account'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          {cloud.info?.github && (
            <a className="btn" href={githubUrl}>
              Continue with GitHub
            </a>
          )}
          <button type="submit" className="btn primary" disabled={busy} data-testid="auth-submit">
            {mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Server + account button (dashboard and editor). */
export function AccountMenu() {
  const cloud = useCloud();
  const [dialog, setDialog] = useState<'server' | 'signin' | null>(null);
  const [open, setOpen] = useState(false);
  const requests = useSocial((s) => s.incoming.length);
  useEffect(() => {
    void cloud.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="account">
      {!cloud.server ? (
        <button
          type="button"
          className="btn"
          onClick={() => setDialog('server')}
          data-testid="connect-server"
        >
          <Server size={15} /> Connect to a server
        </button>
      ) : !cloud.user ? (
        <button
          type="button"
          className="btn"
          onClick={() => setDialog(cloud.status === 'online' ? 'signin' : 'server')}
          data-testid="sign-in"
        >
          {cloud.status === 'online' ? <LogIn size={15} /> : <CloudOff size={15} />}
          {cloud.status === 'online' ? 'Sign in' : 'Server offline'}
        </button>
      ) : (
        <button
          type="button"
          className="account-btn"
          onClick={() => setOpen(!open)}
          data-testid="account-menu"
        >
          <Avatar name={cloud.user.name} color={cloud.user.color} />
          <span>{cloud.user.name}</span>
          {requests > 0 && (
            <span className="count-badge" title={`${requests} friend request(s)`}>
              {requests}
            </span>
          )}
        </button>
      )}
      {open && cloud.user && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <div className="menu-head">
            <b>{cloud.user.name}</b>
            <span className="muted small">
              @{cloud.user.handle} · {cloud.user.email}
            </span>
            <span className="muted small mono">
              <Cloud size={12} /> {cloud.server}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/people');
            }}
            data-testid="open-people"
          >
            <Users size={14} /> Friends &amp; teams
            {requests > 0 && <span className="count-badge">{requests}</span>}
          </button>
          {cloud.user.admin && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/admin');
              }}
              data-testid="open-admin"
            >
              <Gauge size={14} /> Administration
            </button>
          )}
          <a href={SUPPORT_URL} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
            <Heart size={14} /> Support the project
          </a>
          <button
            type="button"
            onClick={async () => {
              const name = prompt('Your name, as your collaborators see it', cloud.user!.name);
              if (name?.trim()) await cloud.updateMe({ name: name.trim() });
              setOpen(false);
            }}
          >
            <UserRound size={14} /> Change my name
          </button>
          <button type="button" onClick={() => (setOpen(false), setDialog('server'))}>
            <Server size={14} /> Change server
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void cloud.signOut();
            }}
            data-testid="sign-out"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
      {dialog === 'server' && <ServerDialog onClose={() => setDialog(null)} />}
      {dialog === 'signin' && <SignInDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** `#/auth?token=…`: back from GitHub sign-in. */
export function AuthPage({ token }: { token: string }) {
  useEffect(() => {
    void (async () => {
      await useCloud.getState().init();
      await useCloud.getState().acceptToken(token);
      const pending = sessionStorage.getItem('sb.pendingInvite');
      navigate(pending ? `/invite/${pending}` : '/');
    })();
  }, [token]);
  return <Loading text="Signing in…" />;
}

/** `#/invite/<token>`: join a shared project. */
export function InvitePage({ token }: { token: string }) {
  const cloud = useCloud();
  const [info, setInfo] = useState<{ projectName: string; role: Role; invitedBy: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    void (async () => {
      await cloud.init();
      if (!useCloud.getState().server) {
        setError('This invite link belongs to a Circuit Notebook server this page cannot reach.');
        return;
      }
      try {
        setInfo(await api('GET', `/api/invites/${token}`));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const accept = async () => {
    try {
      const r = await api<{ projectId: string }>('POST', `/api/invites/${token}/accept`);
      sessionStorage.removeItem('sb.pendingInvite');
      navigate(`/cloud/${r.projectId}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignIn(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="invite-page">
      <div className="invite-card">
        <h1 className="logo big brand-title">
          <Logo size={34} /> Circuit Notebook
        </h1>
        {error && <p className="warning">{error}</p>}
        {!error && !info && <p className="muted">Checking the invite…</p>}
        {info && (
          <>
            <p>
              <b>{info.invitedBy}</b> invites you to <b>“{info.projectName}”</b>
            </p>
            <p className="muted">
              You will be able to: <b>{ROLE_LABELS[info.role].toLowerCase()}</b>.
            </p>
            {cloud.user ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => void accept()}
                data-testid="invite-accept"
              >
                Join as {cloud.user.name}
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  sessionStorage.setItem('sb.pendingInvite', token);
                  setSignIn(true);
                }}
                data-testid="invite-signin"
              >
                Sign in to join
              </button>
            )}
          </>
        )}
        <p>
          <a href="#/">Back to my projects</a>
        </p>
      </div>
      {signIn && (
        <SignInDialog
          invite={token}
          onClose={() => setSignIn(false)}
          onDone={() => void accept()}
        />
      )}
    </div>
  );
}
