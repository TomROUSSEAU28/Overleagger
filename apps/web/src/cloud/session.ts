/**
 * An open cloud project: the Yjs document synced with the server (Hocuspocus), cached in this
 * browser (IndexedDB) so it opens instantly and works offline, the user's role, and presence
 * (who is here, where their cursor is, what they look at, who is presenting).
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Project, type Id, type Person, type Pt, type Role } from '@overleagger/core';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { ApiError, api, collabUrl, useCloud, type Member, type ProjectTeam } from './cloud';

type Members = Member[];

export interface Presence {
  clientId: number;
  user: Person;
  sheetId?: Id;
  cursor?: Pt | null;
  viewport?: { x: number; y: number; zoom: number; w: number; h: number };
  selection?: Id[];
  /** Presenting: index of the slide shown. */
  presenting?: { index: number } | null;
}

export interface SessionState {
  status: 'connecting' | 'connected' | 'offline';
  synced: boolean;
  unsynced: number;
  role: Role;
  /** Why the server refused the last change (shown to the user). */
  refused: string | null;
  peers: Presence[];
  /** Person whose view we follow (their user id). */
  following: string | null;
  members: Members;
  teams: ProjectTeam[];
}

// (Storage name kept from the first version of the app, so cached projects stay available.)
const DB = (id: string) => `schemaboard-cloud-${id}`;

export class CloudSession {
  readonly id: string;
  readonly doc = new Y.Doc();
  readonly project: Project;
  readonly provider: HocuspocusProvider;
  readonly cache: IndexeddbPersistence;
  readonly state: UseBoundStore<StoreApi<SessionState>>;
  private me: Person;

  private constructor(id: string, role: Role, members: Members, teams: ProjectTeam[]) {
    this.id = id;
    this.project = new Project(this.doc);
    const { server, token, user } = useCloud.getState();
    this.me = user
      ? { id: user.id, name: user.name, color: user.color }
      : { id: 'me', name: 'Me', color: '#2f5d9e' };
    this.state = create<SessionState>(() => ({
      status: 'connecting',
      synced: false,
      unsynced: 0,
      role,
      refused: null,
      peers: [],
      following: null,
      members,
      teams,
    }));
    this.cache = new IndexeddbPersistence(DB(id), this.doc);
    this.provider = new HocuspocusProvider({
      url: collabUrl(server!),
      name: id,
      document: this.doc,
      token: token ?? '',
      onStatus: ({ status }) =>
        this.state.setState({
          status:
            status === 'connected'
              ? 'connected'
              : status === 'connecting'
                ? 'connecting'
                : 'offline',
        }),
      onSynced: ({ state }) => this.state.setState({ synced: state }),
      onUnsyncedChanges: ({ number }) => this.state.setState({ unsynced: number }),
      onClose: ({ event }) => {
        // A refused change (the server explains why) or rights that changed: refresh the role.
        if (event.reason) this.state.setState({ refused: event.reason });
        void this.refreshRole();
      },
      onAwarenessChange: () => this.readPeers(),
    });
    this.provider.setAwarenessField('user', this.me);
    this.project.writeGuard = (sheetId, scope) => this.canWrite(sheetId, scope);
  }

  /** Open a cloud project: fetch the role, then show the cached copy or wait for the server. */
  static async open(id: string): Promise<CloudSession> {
    let info: { role: Role; members: Members; teams?: ProjectTeam[] };
    try {
      info = await api<{ role: Role; members: Members; teams: ProjectTeam[] }>(
        'GET',
        `/api/projects/${id}`,
      );
      localStorage.setItem(`sb.role.${id}`, info.role);
    } catch (e) {
      // Offline: open the cached copy with the last known role.
      const role = localStorage.getItem(`sb.role.${id}`) as Role | null;
      if (!(e instanceof ApiError && e.status === 0) || !role) throw e;
      info = { role, members: [] };
    }
    const s = new CloudSession(id, info.role, info.members, info.teams ?? []);
    await s.cache.whenSynced;
    if (!s.project.rootSheetId) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error('The server did not send the project.')),
          15000,
        );
        const check = () => {
          if (s.project.rootSheetId) {
            clearTimeout(t);
            s.doc.off('update', check);
            resolve();
          }
        };
        s.doc.on('update', check);
      }).catch((e: unknown) => {
        s.close();
        throw e;
      });
    }
    return s;
  }

  close() {
    this.provider.destroy();
    void this.cache.destroy();
    this.doc.destroy();
  }

  get role(): Role {
    return this.state.getState().role;
  }

  get person(): Person {
    return this.me;
  }

  /** Rights of the local user (mirrors what the server enforces). */
  canWrite(sheetId: Id | undefined, scope: 'doc' | 'comments' | 'locks'): boolean {
    const role = this.role;
    if (role === 'owner') return true;
    if (role === 'viewer') return false;
    if (scope === 'comments') return true;
    if (role === 'commenter') return false;
    if (scope === 'locks') return false;
    return !(sheetId && this.project.locks.has(sheetId));
  }

  async refreshRole() {
    try {
      const info = await api<{ role: Role; members: Members; teams: ProjectTeam[] }>(
        'GET',
        `/api/projects/${this.id}`,
      );
      this.state.setState({ role: info.role, members: info.members, teams: info.teams ?? [] });
    } catch {
      // offline: keep the last known role
    }
  }

  // Presence -----------------------------------------------------------------

  setPresence(patch: Partial<Omit<Presence, 'clientId' | 'user'>>) {
    for (const [k, v] of Object.entries(patch)) this.provider.setAwarenessField(k, v);
  }

  private readPeers() {
    const aw = this.provider.awareness;
    if (!aw) return;
    const peers: Presence[] = [];
    for (const [clientId, st] of aw.getStates()) {
      if (clientId === aw.clientID || !st.user) continue;
      peers.push({ clientId, ...(st as Omit<Presence, 'clientId'>) });
    }
    this.state.setState({ peers });
  }
}

/** Presence helper: throttle frequent updates (cursor) to ~25 per second. */
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms = 40) {
  let last = 0;
  let pending: A | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...a: A) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...a);
      return;
    }
    pending = a;
    if (!timer)
      timer = setTimeout(
        () => {
          timer = null;
          last = Date.now();
          if (pending) fn(...pending);
          pending = null;
        },
        ms - (now - last),
      );
  };
}
