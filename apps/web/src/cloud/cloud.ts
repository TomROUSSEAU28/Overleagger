/**
 * Connection to a Circuit Notebook server (optional): which server, who is signed in, and a small
 * JSON API helper. Without a server the app stays 100 % local, as before.
 *
 * The server is found in this order: the one saved by the user, `VITE_SERVER_URL` at build
 * time, or the page's own origin when the app is served by the server itself.
 */
import type { Role } from '@overleagger/core';
import { create } from 'zustand';

export interface CloudUser {
  id: string;
  name: string;
  email: string;
  color: string;
  /** Public username (@tom), how friends find you. */
  handle: string;
  /** Sees the admin page. */
  admin?: boolean;
  /** False for GitHub-only accounts (they confirm with their e-mail). */
  hasPassword?: boolean;
  /** Room on the server during the beta (projects you own). */
  quota?: Quota;
}

export interface Quota {
  projects: number;
  /** null: no limit. */
  maxProjects: number | null;
  bytes: number;
  maxProjectBytes: number | null;
}

export interface ServerInfo {
  ok: boolean;
  name: string;
  signup: boolean;
  github: boolean;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  color: string;
  handle?: string;
  role: Role;
}

/** A team given access to a project (all its members get the role). */
export interface ProjectTeam {
  id: string;
  name: string;
  role: Role;
  size: number;
}

export interface CloudProjectEntry {
  id: string;
  name: string;
  role: Role;
  owner: string;
  /** Access through this team (not as a direct member). */
  team?: string;
  updatedAt: number;
  createdAt: number;
  thumbnail: string | null;
}

const SERVER_KEY = 'sb.server';
const TOKEN_KEY = 'sb.token';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // storage unavailable
  }
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface CloudState {
  /** Base URL of the server (no trailing slash), or null when working locally only. */
  server: string | null;
  info: ServerInfo | null;
  status: 'idle' | 'checking' | 'online' | 'offline';
  token: string | null;
  user: CloudUser | null;
  init: () => Promise<void>;
  setServer: (url: string | null) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, name: string, password: string, invite?: string) => Promise<void>;
  acceptToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateMe: (patch: { name?: string; color?: string; handle?: string }) => Promise<void>;
  /** Delete the account on the server (confirmed by the password, or the e-mail). */
  deleteAccount: (confirm: { password?: string; email?: string }) => Promise<void>;
  /** Read the account again (its room on the server changed). */
  refreshUser: () => Promise<void>;
}

const normalize = (url: string) => url.trim().replace(/\/+$/, '');

async function health(server: string): Promise<ServerInfo | null> {
  try {
    const res = await fetch(`${server}/api/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerInfo;
    return data?.ok && (data.name === 'Circuit Notebook' || data.name === 'SchemaBoard')
      ? data
      : null;
  } catch {
    return null;
  }
}

export const useCloud = create<CloudState>((set, get) => ({
  server: null,
  info: null,
  status: 'idle',
  token: read(TOKEN_KEY),
  user: null,

  init: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'checking' });
    const candidates = [
      read(SERVER_KEY),
      import.meta.env.VITE_SERVER_URL as string | undefined,
      // Served by the Circuit Notebook server itself?
      // (the app lives in `<base>/app/`, the server answers at `<base>/api/…`)
      `${location.origin}${location.pathname.replace(/\/app(\/[^/]*)?$/, '')}`,
    ].filter((x): x is string => Boolean(x));
    for (const c of candidates) {
      const info = await health(normalize(c));
      if (info) {
        set({ server: normalize(c), info, status: 'online' });
        await loadUser();
        return;
      }
    }
    // A saved server that does not answer: keep it (probably offline for now).
    const saved = read(SERVER_KEY);
    set(saved ? { server: saved, status: 'offline' } : { status: 'idle' });
  },

  setServer: async (url) => {
    if (!url) {
      write(SERVER_KEY, null);
      set({ server: null, info: null, status: 'idle', user: null });
      return true;
    }
    const server = normalize(url);
    const info = await health(server);
    if (!info) return false;
    write(SERVER_KEY, server);
    set({ server, info, status: 'online' });
    await loadUser();
    return true;
  },

  signIn: async (email, password) => {
    const r = await api<{ token: string; user: CloudUser }>('POST', '/api/auth/login', {
      email,
      password,
    });
    write(TOKEN_KEY, r.token);
    set({ token: r.token, user: r.user });
  },

  signUp: async (email, name, password, invite) => {
    const r = await api<{ token: string; user: CloudUser }>('POST', '/api/auth/signup', {
      email,
      name,
      password,
      ...(invite ? { invite } : {}),
    });
    write(TOKEN_KEY, r.token);
    set({ token: r.token, user: r.user });
  },

  acceptToken: async (token) => {
    write(TOKEN_KEY, token);
    set({ token });
    await loadUser();
  },

  signOut: async () => {
    try {
      await api('POST', '/api/auth/logout');
    } catch {
      // already gone
    }
    write(TOKEN_KEY, null);
    set({ token: null, user: null });
  },

  updateMe: async (patch) => {
    const r = await api<{ user: CloudUser }>('PATCH', '/api/auth/me', patch);
    set({ user: r.user });
  },

  deleteAccount: async (confirm) => {
    await api('DELETE', '/api/auth/me', confirm);
    write(TOKEN_KEY, null);
    set({ token: null, user: null });
  },

  refreshUser: () => loadUser(),
}));

async function loadUser() {
  const { token } = useCloud.getState();
  if (!token) return;
  try {
    const r = await api<{ user: CloudUser }>('GET', '/api/auth/me');
    useCloud.setState({ user: r.user });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      write(TOKEN_KEY, null);
      useCloud.setState({ token: null, user: null });
    }
  }
}

/** JSON call to the server with the session token. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const { server, token } = useCloud.getState();
  if (!server) throw new ApiError(0, 'No server configured.');
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'The server cannot be reached.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`);
  return data;
}

/** WebSocket URL of the sync endpoint. */
export const collabUrl = (server: string) => `${server.replace(/^http/, 'ws')}/collab`;

/** Link that opens an invite in this web app. */
export const inviteLink = (token: string) =>
  `${location.origin}${location.pathname}#/invite/${token}`;

export const bytesToBase64 = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

export const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
