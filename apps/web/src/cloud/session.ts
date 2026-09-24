/**
 * An open cloud project: the Yjs document synced with the server (Hocuspocus), cached in this
 * browser (IndexedDB) so it opens instantly and works offline, the user's role, and presence
 * (who is here, where their cursor is, what they look at, who is presenting).
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  Project,
  accessAtLeast,
  docName,
  effectiveLevel,
  roleAtLeast,
  writesSomewhere,
  type Access,
  type Id,
  type Person,
  type Pt,
  type Role,
  type SheetRule,
  type WriteScope,
} from '@overleagger/core';
import type * as Y from 'yjs';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { DocStore } from '../storage/docStore';
import { useUI } from '../store/ui';
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
  /** Rights per sheet: all of them for the owner, the ones that apply to me otherwise. */
  rules: SheetRule[];
  /** Sheets the server refused to send me (hidden from me). */
  denied: Id[];
  /** Weight of the project on the server, and its limit (null: none). */
  size: { bytes: number; max: number | null } | null;
}

interface ProjectInfo {
  role: Role;
  members: Members;
  teams?: ProjectTeam[];
  rules?: SheetRule[];
  size?: { bytes: number; max: number | null };
}

/** Cache of the first versions of the app (one document): deleted, the server has it all. */
const OLD_CACHE = (id: string) => `schemaboard-cloud-${id}`;
const EMPTY_UPDATE = new Uint8Array([0, 0]);

export class CloudSession {
  readonly id: string;
  readonly project: Project;
  readonly state: UseBoundStore<StoreApi<SessionState>>;
  /** One WebSocket for all the documents of the project. */
  private socket: HocuspocusProviderWebsocket;
  /** The root document: sheet tree, symbols, locks, and presence. */
  private provider: HocuspocusProvider;
  private sheetProviders = new Map<Id, HocuspocusProvider>();
  /** Sheets the server refused (hidden from me), until my rights change. */
  private denied = new Set<Id>();
  private unsynced = new Map<HocuspocusProvider, number>();
  /** Documents the server reset (rights changed), to join again once the rights are known. */
  private reset = new Set<HocuspocusProvider>();
  private refreshing: Promise<void> | null = null;
  private wanted = 0;
  private served = 0;
  private rightsChanged = false;
  private cache: DocStore;
  private offCache: () => void;
  private me: Person;
  private token: string;
  private closed = false;
  private sizeTimer: ReturnType<typeof setInterval> | undefined;

  private constructor(
    id: string,
    info: ProjectInfo,
    cache: DocStore,
    cached: Map<string, Uint8Array>,
  ) {
    const { role, members } = info;
    this.id = id;
    this.cache = cache;
    const sheets = new Map(cached);
    sheets.delete('root');
    this.project = Project.fromParts({ root: cached.get('root') ?? EMPTY_UPDATE, sheets });
    const { server, token, user } = useCloud.getState();
    this.token = token ?? '';
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
      teams: info.teams ?? [],
      rules: info.rules ?? [],
      denied: [],
      size: info.size ?? null,
    }));
    // The project's weight changes as people draw: read it again now and then.
    this.sizeTimer = setInterval(() => void this.refreshRole(), 90_000);
    this.offCache = this.cache.bindProject(this.project);
    this.socket = new HocuspocusProviderWebsocket({
      url: collabUrl(server!),
      onStatus: ({ status }) =>
        this.state.setState({
          status:
            status === 'connected'
              ? 'connected'
              : status === 'connecting'
                ? 'connecting'
                : 'offline',
        }),
    });
    this.provider = this.connect(this.project.doc);
    this.provider.setAwarenessField('user', this.me);
    this.project.writeGuard = (sheetId, scope) => this.canWrite(sheetId, scope);
    this.project.readGuard = (sheetId) => !this.isHidden(sheetId);
    // Sheets appear, are deleted or come back (undo): open the documents I may see.
    this.project.onSheetDoc(() => this.reconcile());
    this.project.sheets.observe(() => this.reconcile());
    this.reconcile();
  }

  /** Sync one document of the project with the server. */
  private connect(doc: Y.Doc, sheetId?: Id): HocuspocusProvider {
    const provider: HocuspocusProvider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: docName(this.id, sheetId),
      document: doc,
      token: this.token,
      // Presence travels with the root document only.
      ...(sheetId ? { awareness: null } : { onAwarenessChange: () => this.readPeers() }),
      onSynced: () => this.syncState(),
      onUnsyncedChanges: ({ number }) => {
        this.unsynced.set(provider, number);
        this.syncState();
      },
      onAuthenticationFailed: () => {
        if (!sheetId) return;
        // The server keeps this sheet from me: forget its content, then check my rights.
        this.denied.add(sheetId);
        this.state.setState({ denied: [...this.denied] });
        this.drop(sheetId);
        void this.refreshRole();
      },
      onClose: ({ event }) => {
        if (event.reason === 'Reset Connection') {
          // Rights changed (the owner edited people or rules): reload them and join again.
          this.reset.add(provider);
          void this.refreshRole(true);
          return;
        }
        // A refused change: the server explains why (the banner offers to reload).
        if (event.reason) this.state.setState({ refused: event.reason });
        void this.refreshRole();
      },
    });
    provider.attach();
    return provider;
  }

  private syncState() {
    const all = [this.provider, ...this.sheetProviders.values()];
    let unsynced = 0;
    for (const p of all) unsynced += this.unsynced.get(p) ?? 0;
    this.state.setState({ synced: all.every((p) => p.isSynced), unsynced });
  }

  /** Stop syncing a sheet and throw away its content in this browser. */
  private drop(sheetId: Id) {
    const p = this.sheetProviders.get(sheetId);
    if (p) {
      this.sheetProviders.delete(sheetId);
      this.unsynced.delete(p);
      // Closed or refused by the server already: do not send it a "close" for this document
      // (the server would keep it and replay it on the next connection to the sheet).
      if (this.reset.has(p) || !p.isAuthenticated)
        this.socket.configuration.providerMap.delete(p.effectiveName);
      this.reset.delete(p);
      p.destroy();
    }
    const doc = this.project.sheetDoc(sheetId);
    if (doc && (doc.store.clients.size > 0 || doc.getMap('elements').size > 0)) {
      this.project.resetSheetDoc(sheetId);
    }
    void this.cache.clear(sheetId);
    this.syncState();
  }

  /** Open the documents of the sheets I may see, close the others. */
  private reconcile() {
    if (this.closed) return;
    for (const [sheetId, doc] of this.project.sheetDocs()) {
      const hidden = this.isHidden(sheetId);
      const p = this.sheetProviders.get(sheetId);
      if (hidden) {
        if (p || doc.store.clients.size > 0) this.drop(sheetId);
        continue;
      }
      if (p?.document === doc) continue;
      if (p) p.destroy();
      if (!this.project.hasSheet(sheetId) && !p) continue;
      this.sheetProviders.set(sheetId, this.connect(doc, sheetId));
    }
    this.syncState();
    this.leaveHiddenSheet();
  }

  /** The sheet on screen was just hidden from me: go up to the nearest one I may see. */
  private leaveHiddenSheet() {
    const ui = useUI.getState();
    let s: Id | undefined = ui.sheetId ?? undefined;
    if (!s || !this.isHidden(s)) return;
    while (s && this.isHidden(s)) s = this.project.getSheet(s)?.parentSheetId;
    if (s) ui.set({ sheetId: s, selection: [], commentDraft: null, openThread: null });
  }

  /** Open a cloud project: fetch the role, then show the cached copy or wait for the server. */
  static async open(id: string): Promise<CloudSession> {
    let info: ProjectInfo;
    try {
      info = await api<ProjectInfo>('GET', `/api/projects/${id}`);
      localStorage.setItem(`sb.role.${id}`, info.role);
    } catch (e) {
      // Offline: open the cached copy with the last known role.
      const role = localStorage.getItem(`sb.role.${id}`) as Role | null;
      if (!(e instanceof ApiError && e.status === 0) || !role) throw e;
      info = { role, members: [] };
    }
    indexedDB.deleteDatabase(OLD_CACHE(id));
    const cache = new DocStore(`cloud:${id}`);
    const cached = await cache.load().catch(() => new Map<string, Uint8Array>());
    const s = new CloudSession(id, info, cache, cached);
    if (!s.project.rootSheetId) {
      const root = s.project.doc;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error('The server did not send the project.')),
          15000,
        );
        const check = () => {
          if (s.project.rootSheetId) {
            clearTimeout(t);
            root.off('update', check);
            resolve();
          }
        };
        root.on('update', check);
      }).catch((e: unknown) => {
        s.close();
        throw e;
      });
      // First time here: wait for the sheets too, so the view opens on the drawing.
      await s.whenSynced(8000);
    }
    return s;
  }

  /** Every open document is synced (or `ms` passed). */
  private whenSynced(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const all = [this.provider, ...this.sheetProviders.values()];
        if (this.closed || Date.now() - t0 > ms || all.every((p) => p.isSynced)) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
  }

  close() {
    this.closed = true;
    clearInterval(this.sizeTimer);
    for (const p of this.sheetProviders.values()) p.destroy();
    this.sheetProviders.clear();
    this.provider.destroy();
    this.socket.destroy();
    this.offCache();
    void this.cache.close().then(() => this.project.destroy());
  }

  get role(): Role {
    return this.state.getState().role;
  }

  get person(): Person {
    return this.me;
  }

  /** My access to a sheet: project role, adjusted by the owner's rules for that sheet. */
  levelOf(sheetId: Id): Access {
    const { role, rules } = this.state.getState();
    return effectiveLevel(sheetId, role, rules, (s) => this.project.getSheet(s)?.parentSheetId);
  }

  /** Is this sheet kept from me (by the owner's rules, or refused by the server)? */
  isHidden(sheetId: Id): boolean {
    return this.denied.has(sheetId) || this.levelOf(sheetId) === 'hidden';
  }

  /** Rights of the local user (mirrors what the server enforces). */
  canWrite(sheetId: Id | undefined, scope: WriteScope): boolean {
    const { role, rules } = this.state.getState();
    if (role === 'owner') return true;
    if (scope === 'locks') return false;
    if (scope === 'project') return roleAtLeast(role, 'editor');
    if (scope === 'comments')
      return sheetId
        ? accessAtLeast(this.levelOf(sheetId), 'commenter')
        : writesSomewhere(role, rules, 'commenter');
    if (!sheetId) return writesSomewhere(role, rules, 'editor');
    return accessAtLeast(this.levelOf(sheetId), 'editor') && !this.project.locks.has(sheetId);
  }

  /** Join again the documents the server reset (new rights). */
  private rejoin() {
    const live = new Set([this.provider, ...this.sheetProviders.values()]);
    for (const p of this.reset) if (live.has(p)) void p.sendToken().then(() => p.startSync());
    this.reset.clear();
  }

  /** Throw away the local copy (it holds a change the server refused) and load it again. */
  async reload() {
    await this.cache.clear().catch(() => undefined);
    window.location.reload();
  }

  /**
   * Read my rights again, then open or close sheets accordingly. `changed`: the server says
   * they changed (sheets it refused may be allowed now).
   */
  refreshRole(changed = false): Promise<void> {
    if (changed) this.rightsChanged = true;
    // A request made while one is running is served by a new read after it.
    this.wanted++;
    this.refreshing ??= (async () => {
      // Let the other documents of the project receive their reset too.
      await new Promise((r) => setTimeout(r, 30));
      while (this.served < this.wanted) {
        const target = this.wanted;
        try {
          const info = await api<ProjectInfo>('GET', `/api/projects/${this.id}`);
          this.state.setState({
            role: info.role,
            members: info.members,
            teams: info.teams ?? [],
            rules: info.rules ?? [],
            size: info.size ?? null,
          });
        } catch {
          // offline: keep the last known role
        }
        this.served = target;
      }
      if (this.rightsChanged) {
        this.rightsChanged = false;
        this.denied.clear();
        this.state.setState({ denied: [] });
      }
      this.refreshing = null;
      this.reconcile();
      this.rejoin();
    })();
    return this.refreshing;
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
