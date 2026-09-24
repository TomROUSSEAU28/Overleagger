/**
 * Real-time sync with Hocuspocus (Yjs over WebSocket): one document per project.
 *
 * - Authentication: the session token of the web app; the member's role comes from the database.
 * - Viewers connect read-only. Commenters may only change comments; editors anything but sheet
 *   locks and locked sheets. Every incoming update is checked (`beforeSync`), not only the UI.
 * - Presence (cursors, viewports, "who is presenting") travels in the Yjs awareness; the name
 *   and colour of each person are set by the server so nobody can pretend to be someone else.
 * - Documents are stored in SQLite; an automatic version is kept every few minutes.
 */
import { Hocuspocus } from '@hocuspocus/server';
import {
  replaceContent,
  touchedScopes,
  updateAllowed,
  type Person,
  type Role,
} from '@overleagger/core';
import * as Y from 'yjs';
import { hashToken, randomToken } from './auth';
import type { Config } from './config';
import type { Store } from './db';

export interface CollabContext {
  user: Person;
  role: Role;
}

/** WebSocket close code for a refused change (the client shows the reason). */
export const FORBIDDEN_CHANGE = 4403;

export function createCollab(store: Store, config: Config) {
  const hocuspocus = new Hocuspocus<CollabContext>({
    name: 'schemaboard',
    quiet: true,
    debounce: 1500,
    maxDebounce: 8000,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const user = token ? store.sessionUser(hashToken(token)) : undefined;
      if (!user) throw new Error('Not signed in');
      const role = store.role(documentName, user.id);
      if (!role) throw new Error('No access to this project');
      connectionConfig.readOnly = role === 'viewer';
      return { user: { id: user.id, name: user.name, color: user.color }, role };
    },

    async onLoadDocument({ document, documentName }) {
      const state = store.loadState(documentName);
      if (state) Y.applyUpdate(document, state);
      return document;
    },

    async beforeSync({ type, payload, document, context }) {
      // 1 = SyncStep2, 2 = Update: messages that carry changes.
      if (type !== 1 && type !== 2) return;
      const role = context.role;
      if (role === 'owner' || role === 'viewer') return; // viewers are read-only already
      const locks = document.getMap('locks');
      if (role === 'editor' && locks.size === 0) return;
      const verdict = updateAllowed(role, touchedScopes(document, payload), locks.keys());
      if (!verdict.ok)
        throw Object.assign(new Error(verdict.reason), {
          code: FORBIDDEN_CHANGE,
          reason: verdict.reason,
        });
    },

    async beforeHandleAwareness({ states, context }) {
      if (!context) return;
      for (const s of states.values()) if (s && typeof s === 'object') s.user = context.user;
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      if (!store.project(documentName)) return;
      const state = Y.encodeStateAsUpdate(document);
      store.saveState(documentName, state);
      const name = document.getMap('meta').get('name');
      store.updateProject(documentName, {
        ...(typeof name === 'string' && name ? { name } : {}),
        touch: true,
      });
      if (Date.now() - store.lastVersionAt(documentName) >= config.autoVersionEveryMs) {
        store.addVersion({
          id: randomToken(9),
          project_id: documentName,
          created_at: Date.now(),
          author_id: lastContext?.user?.id ?? null,
          label: null,
          auto: 1,
          state,
        });
        store.pruneAutoVersions(documentName);
      }
    },
  });

  /** Current state of a project (live document if open, else the stored one). */
  async function currentState(projectId: string): Promise<Uint8Array | undefined> {
    const open = hocuspocus.documents.get(projectId);
    return open ? Y.encodeStateAsUpdate(open) : store.loadState(projectId);
  }

  /** Save a named version now. */
  async function saveVersion(projectId: string, authorId: string | null, label: string | null) {
    const state = await currentState(projectId);
    if (!state) return undefined;
    const id = randomToken(9);
    store.addVersion({
      id,
      project_id: projectId,
      created_at: Date.now(),
      author_id: authorId,
      label,
      auto: label ? 0 : 1,
      state,
    });
    return id;
  }

  /** Bring back an old version for everyone (as ordinary edits, after saving the current state). */
  async function restoreVersion(projectId: string, versionId: string, by: Person) {
    const old = store.versionState(projectId, versionId);
    if (!old) return false;
    await saveVersion(projectId, by.id, 'Before restoring a version');
    const source = new Y.Doc();
    Y.applyUpdate(source, old);
    const conn = await hocuspocus.openDirectConnection(projectId, { user: by, role: 'owner' });
    await conn.transact((doc) => replaceContent(doc, source));
    await conn.disconnect();
    source.destroy();
    return true;
  }

  /** Close the connections of a project so that everyone reconnects with fresh rights. */
  function refreshAccess(projectId: string) {
    hocuspocus.closeConnections(projectId);
  }

  return { hocuspocus, saveVersion, restoreVersion, refreshAccess, currentState };
}

export type Collab = ReturnType<typeof createCollab>;
