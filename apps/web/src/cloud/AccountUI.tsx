import { ROLE_LABELS, type Role } from '@overleagger/core';
import {
  Cloud,
  CloudOff,
  Gauge,
  Heart,
  LogIn,
  LogOut,
  Server,
  Trash2,
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

type AuthMode =
  /** Sign in. */
  | 'in'
  /** Create an account. */
  | 'up'
  /** Type the code e-mailed to confirm the address of the new account. */
  | 'code'
  /** Forgot my password: the address to send a code to. */
  | 'forgot'
  /** The code, and a new password. */
  | 'reset';

const AUTH_TITLES: Record<AuthMode, string> = {
  in: 'Sign in',
  up: 'Create an account',
  code: 'Check your e-mail',
  forgot: 'Forgot your password?',
  reset: 'Choose a new password',
};

/**
 * Sign in or create an account on the current server. A new account confirms its e-mail with a
 * 6-digit code when the server sends e-mails; a forgotten password is changed the same way.
 */
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
  const [mode, setModeRaw] = useState<AuthMode>('in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canSignUp = cloud.info?.signup || Boolean(invite);
  const setMode = (m: AuthMode) => {
    setModeRaw(m);
    setError('');
    setNote('');
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const done = () => {
    onDone?.();
    onClose();
  };
  const submit = () =>
    run(async () => {
      if (mode === 'in') {
        await cloud.signIn(email, password);
        done();
      } else if (mode === 'up') {
        if ((await cloud.signUp(email, name, password, invite)) === 'done') done();
        else {
          setCode('');
          setMode('code');
        }
      } else if (mode === 'code') {
        await cloud.verifySignUp(email, code);
        done();
      } else if (mode === 'forgot') {
        await cloud.forgotPassword(email);
        setCode('');
        setPassword('');
        setMode('reset');
      } else {
        await cloud.resetPassword(email, code, password);
        done();
      }
    });
  /** Another code (the last one got lost, or expired). */
  const resend = () =>
    run(async () => {
      if (mode === 'code') await cloud.signUp(email, name, password, invite);
      else await cloud.forgotPassword(email);
      setNote('A new code is on its way.');
    });
  const githubUrl = `${cloud.server}/api/auth/github?return=${encodeURIComponent(
    `${location.origin}${location.pathname}`,
  )}`;
  const codeField = (
    <Field label="Code (6 digits)">
      <input
        autoFocus
        className="mono auth-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        data-testid="auth-code"
      />
    </Field>
  );
  const submitLabel: Record<AuthMode, string> = {
    in: 'Sign in',
    up: 'Create account',
    code: 'Confirm',
    forgot: 'Send me a code',
    reset: 'Save and sign in',
  };
  return (
    <Modal title={AUTH_TITLES[mode]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {(mode === 'in' || mode === 'up') && (
          <p className="muted small">
            Server: <span className="mono">{cloud.server}</span>
          </p>
        )}
        {mode === 'up' && (
          <Field label="Name (shown to your collaborators)">
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="auth-name" />
          </Field>
        )}
        {(mode === 'in' || mode === 'up' || mode === 'forgot') && (
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
        )}
        {mode === 'forgot' && (
          <p className="muted small">We will e-mail you a code to choose a new password.</p>
        )}
        {(mode === 'code' || mode === 'reset') && (
          <p className="small">
            We sent a 6-digit code to <b>{email}</b>. It works for 30 minutes (have a look in your
            spam folder too).
          </p>
        )}
        {(mode === 'code' || mode === 'reset') && codeField}
        {(mode === 'in' || mode === 'up' || mode === 'reset') && (
          <Field
            label={
              mode === 'up'
                ? 'Password (8 characters or more)'
                : mode === 'reset'
                  ? 'New password (8 characters or more)'
                  : 'Password'
            }
          >
            <input
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="auth-password"
            />
          </Field>
        )}
        {mode === 'in' && cloud.info?.reset && (
          <p className="small auth-forgot">
            <button
              type="button"
              className="link"
              onClick={() => setMode('forgot')}
              data-testid="auth-forgot"
            >
              Forgot your password?
            </button>
          </p>
        )}
        {mode === 'up' && (
          <p className="muted small">
            {cloud.info?.verify ? 'We will send a code to this address to check it. ' : ''}
            Your e-mail is only used to sign you in and to share projects.{' '}
            <a href={`${cloud.server}/privacy/`} target="_blank" rel="noopener">
              Privacy policy
            </a>
          </p>
        )}
        {note && !error && <p className="muted small">{note}</p>}
        {error && <p className="warning small">{error}</p>}
        <div className="modal-foot">
          {(mode === 'in' || mode === 'up') && canSignUp && (
            <button
              type="button"
              className="link accent"
              onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
              data-testid="auth-switch"
            >
              {mode === 'in' ? 'No account yet? Create one' : 'I already have an account'}
            </button>
          )}
          {(mode === 'code' || mode === 'reset') && (
            <button
              type="button"
              className="link accent"
              disabled={busy}
              onClick={() => void resend()}
              data-testid="auth-resend"
            >
              Send a new code
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="link accent" onClick={() => setMode('in')}>
              Back to sign in
            </button>
          )}
          <span style={{ flex: 1 }} />
          {mode === 'code' && (
            <button type="button" className="btn" onClick={() => setMode('up')}>
              Change e-mail
            </button>
          )}
          {(mode === 'in' || mode === 'up') && cloud.info?.github && (
            <a className="btn" href={githubUrl}>
              Continue with GitHub
            </a>
          )}
          <button type="submit" className="btn primary" disabled={busy} data-testid="auth-submit">
            {submitLabel[mode]}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Server + account button (dashboard and editor). */
export function AccountMenu() {
  const cloud = useCloud();
  const [dialog, setDialog] = useState<'server' | 'signin' | 'delete' | null>(null);
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
          <Server size={15} /> Connect<span className="btn-label"> to a server</span>
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
          <span className="account-name">{cloud.user.name}</span>
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
          <button
            type="button"
            className="danger"
            onClick={() => (setOpen(false), setDialog('delete'))}
            data-testid="delete-account"
          >
            <Trash2 size={14} /> Delete my account…
          </button>
        </div>
      )}
      {dialog === 'delete' && <DeleteAccountDialog onClose={() => setDialog(null)} />}
      {dialog === 'server' && <ServerDialog onClose={() => setDialog(null)} />}
      {dialog === 'signin' && <SignInDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Delete the account: says what goes away, and asks for the password (or the e-mail). */
function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const cloud = useCloud();
  // Kept as it was when the dialog opened: the account is gone once deleted.
  const [user] = useState(cloud.user!);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const owned = user.quota?.projects ?? 0;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await cloud.deleteAccount(
        user.hasPassword === false ? { email: value } : { password: value },
      );
      onClose();
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Delete my account" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p>This removes from the server, for good:</p>
        <ul className="small">
          <li>
            your account (<b>{user.email}</b>), your friends, teams and library;
          </li>
          <li>
            {owned === 0 ? (
              'no project: you own none on the server;'
            ) : (
              <>
                <b>
                  the {owned} project{owned > 1 ? 's' : ''} you own
                </b>
                , also for the people you shared {owned > 1 ? 'them' : 'it'} with;
              </>
            )}
          </li>
          <li>your access to the projects others shared with you.</li>
        </ul>
        {owned > 0 && (
          <p className="muted small">
            To keep a project, first choose <i>Move to this computer</i> in its menu (⋯) on the
            dashboard.
          </p>
        )}
        <p className="muted small">Projects saved on this computer are not touched.</p>
        <Field
          label={
            user.hasPassword === false
              ? `Type your e-mail address (${user.email}) to confirm`
              : 'Your password, to confirm'
          }
        >
          <input
            type={user.hasPassword === false ? 'email' : 'password'}
            autoFocus
            autoComplete={user.hasPassword === false ? 'off' : 'current-password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="delete-confirm"
          />
        </Field>
        {error && <p className="warning small">{error}</p>}
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn danger-solid"
            disabled={busy || !value}
            data-testid="delete-submit"
          >
            Delete my account
          </button>
        </div>
      </form>
    </Modal>
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
