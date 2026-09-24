/**
 * Real-time sync with Hocuspocus (Yjs over WebSocket). A project is several documents: its
 * root (`<project>/root`: name, sheet tree, symbols, locks) and one per sheet
 * (`<project>/<sheet>`: the drawing and its comments), so a hidden sheet is simply never sent.
 *
 * - Authentication: the session token of the web app; the member's role and rights per sheet
 *   come from the database. A sheet hidden from someone is refused to them.
 * - Every incoming update is checked (`beforeSync`), not only the UI: viewers change nothing,
 *   commenters only comments, editors anything but sheet locks and locked sheets, each as
 *   adjusted by the owner's rules for the sheet.
 * - Presence (cursors, viewports, "who is presenting") travels in the awareness of the root
 *   document; the name and colour of each person are set by the server.
 * - Documents are stored in SQLite; an automatic version (all documents) is kept every few
 *   minutes.
 */
import { Hocuspocus } from '@hocuspocus/server';
import {
  Project,
  accessAtLeast,
  docName,
  docUpdateAllowed,
  effectiveLevel,
  encodeBundle,
  parseDocName,
  replaceContent,
  writesSomewhere,
  type Id,
  type Person,
  type ProjectParts,
  type Role,
  type SheetRule,
} from '@overleagger/core';
import * as Y from 'yjs';
import { hashToken, randomToken } from './auth';
import type { Config } from './config';
import type { Store } from './db';

export interface CollabContext {
  user: Person;
  role: Role;
  /** Rights per sheet that apply to this person (theirs and their teams'). */
  rules: SheetRule[];
}

/** WebSocket close code for a refused change (the client shows the reason). */
export const FORBIDDEN_CHANGE = 4403;

/** What the rights depend on in the root document: the sheet tree and the locks. */
interface Manifest {
  parentOf: (sheetId: Id) => Id | undefined;
  has: (sheetId: Id) => boolean;
  locked: Id[];
}

function manifestOf(root: Y.Doc): Manifest {
  const sheets = root.getMap<Y.Map<unknown>>('sheets');
  return {
    parentOf: (s) => sheets.get(s)?.get('parentSheetId') as Id | undefined,
    has: (s) => sheets.has(s),
    locked: [...root.getMap('locks').keys()],
  };
}

/** Is this sheet hidden from a person? */
export function hiddenFor(role: Role, rules: readonly SheetRule[], sheetId: Id, m: Manifest) {
  return effectiveLevel(sheetId, role, rules, m.parentOf) === 'hidden';
}

/** Drop from `parts` the sheets hidden from a person (versions they download). */
export function visibleParts(
  parts: ProjectParts,
  role: Role,
  rules: readonly SheetRule[],
): ProjectParts {
  if (role === 'owner' || !rules.some((r) => r.level === 'hidden')) return parts;
  const root = new Y.Doc();
  Y.applyUpdate(root, parts.root);
  const m = manifestOf(root);
  root.destroy();
  const sheets = new Map([...parts.sheets].filter(([id]) => !hiddenFor(role, rules, id, m)));
  return { root: parts.root, sheets };
}

export function createCollab(store: Store, config: Config) {
  // Sheet tree of projects whose root document is not open (short cache).
  const stored = new Map<string, { at: number; m: Manifest }>();

  /** The sheet tree and locks of a project, from its live root document if open. */
  function manifest(projectId: string): Manifest {
    const open = hocuspocus.documents.get(docName(projectId));
    if (open) return manifestOf(open);
    const hit = stored.get(projectId);
    if (hit && Date.now() - hit.at < 2000) return hit.m;
    const root = new Y.Doc();
    const state = store.loadDoc(projectId, 'root');
    if (state) Y.applyUpdate(root, state);
    const m = manifestOf(root);
    root.destroy();
    stored.set(projectId, { at: Date.now(), m });
    return m;
  }

  const hocuspocus = new Hocuspocus<CollabContext>({
    name: 'circuit-notebook',
    quiet: true,
    debounce: 1500,
    maxDebounce: 8000,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const name = parseDocName(documentName);
      if (!name) throw new Error('Circuit Notebook was updated: reload the page.');
      const user = token ? store.sessionUser(hashToken(token)) : undefined;
      if (!user) throw new Error('Not signed in');
      const role = store.role(name.projectId, user.id);
      if (!role) throw new Error('No access to this project');
      const rules = store.rulesFor(name.projectId, user.id);
      if (!name.sheetId) {
        // The root: changing it (sheet tree, symbols) needs "Can edit" somewhere.
        connectionConfig.readOnly = !writesSomewhere(role, rules, 'editor');
      } else if (role !== 'owner') {
        const m = manifest(name.projectId);
        const sheetId = name.sheetId;
        // A sheet deleted since: its content is only for people who hide nothing.
        const deleted = !m.has(sheetId) && store.loadDoc(name.projectId, sheetId) !== undefined;
        if (deleted ? rules.some((r) => r.level === 'hidden') : hiddenFor(role, rules, sheetId, m))
          throw new Error('This sheet is hidden from you.');
        const level = effectiveLevel(sheetId, role, rules, m.parentOf);
        connectionConfig.readOnly = !accessAtLeast(level, 'commenter');
      }
      return { user: { id: user.id, name: user.name, color: user.color }, role, rules };
    },

    async onLoadDocument({ document, documentName }) {
      const name = parseDocName(documentName);
      if (!name) return document;
      const state = store.loadDoc(name.projectId, name.sheetId ?? 'root');
      if (state) Y.applyUpdate(document, state);
      return document;
    },

    async beforeSync({ type, payload, document, documentName, context }) {
      // 1 = SyncStep2, 2 = Update: messages that carry changes.
      if (type !== 1 && type !== 2) return;
      const { role, rules } = context;
      if (role === 'owner') return;
      const name = parseDocName(documentName)!;
      const m = manifest(name.projectId);
      // Fast path: an editor of the whole project, no lock, no rule lowering anything.
      if (role === 'editor' && !m.locked.length && rules.every((r) => r.level === 'editor')) return;
      const verdict = docUpdateAllowed(document, name.sheetId, payload, {
        role,
        rules,
        parentOf: m.parentOf,
        locked: m.locked,
      });
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
      const name = parseDocName(documentName);
      if (!name || !store.project(name.projectId)) return;
      const { projectId, sheetId } = name;
      store.saveDoc(projectId, sheetId ?? 'root', Y.encodeStateAsUpdate(document));
      const title = sheetId ? undefined : document.getMap('meta').get('name');
      store.updateProject(projectId, {
        ...(typeof title === 'string' && title ? { name: title } : {}),
        touch: true,
      });
      if (Date.now() - store.lastVersionAt(projectId) >= config.autoVersionEveryMs) {
        store.addVersion({
          id: randomToken(9),
          project_id: projectId,
          created_at: Date.now(),
          author_id: lastContext?.user?.id ?? null,
          label: null,
          auto: 1,
          state: encodeBundle(currentParts(projectId)),
        });
        store.pruneAutoVersions(projectId);
      }
    },
  });

  /** Current documents of a project (live ones if open, else the stored ones). */
  function currentParts(projectId: string): ProjectParts {
    const live = (key: string) =>
      hocuspocus.documents.get(docName(projectId, key === 'root' ? undefined : key));
    const read = (key: string) => {
      const d = live(key);
      return d ? Y.encodeStateAsUpdate(d) : store.loadDoc(projectId, key);
    };
    const root = read('root') ?? new Uint8Array([0, 0]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, root);
    const sheets = new Map<Id, Uint8Array>();
    for (const id of doc.getMap('sheets').keys()) {
      const s = read(id);
      if (s) sheets.set(id, s);
    }
    doc.destroy();
    return { root, sheets };
  }

  /** Save a named version now. */
  async function saveVersion(projectId: string, authorId: string | null, label: string | null) {
    if (!store.loadDoc(projectId, 'root') && !hocuspocus.documents.has(docName(projectId)))
      return undefined;
    const id = randomToken(9);
    store.addVersion({
      id,
      project_id: projectId,
      created_at: Date.now(),
      author_id: authorId,
      label,
      auto: label ? 0 : 1,
      state: encodeBundle(currentParts(projectId)),
    });
    return id;
  }

  /** Change one document of a project as the server (restoring a version). */
  async function edit(
    projectId: string,
    sheetId: Id | undefined,
    by: Person,
    fn: (d: Y.Doc) => void,
  ) {
    const conn = await hocuspocus.openDirectConnection(docName(projectId, sheetId), {
      user: by,
      role: 'owner',
      rules: [],
    });
    await conn.transact(fn);
    await conn.disconnect();
  }

  /** Bring back an old version for everyone (as ordinary edits, after saving the current state). */
  async function restoreVersion(projectId: string, versionId: string, by: Person) {
    const old = store.versionState(projectId, versionId);
    if (!old) return false;
    await saveVersion(projectId, by.id, 'Before restoring a version');
    const source = Project.fromUpdate(new Uint8Array(old));
    await edit(projectId, undefined, by, (doc) => replaceContent(doc, source.doc));
    for (const sheet of source.listSheets()) {
      const from = source.sheetDoc(sheet.id);
      if (from)
        await edit(projectId, sheet.id, by, (doc) => replaceContent(doc, from, ['elements']));
    }
    source.destroy();
    return true;
  }

  /** Close the connections of a project so that everyone reconnects with fresh rights. */
  function refreshAccess(projectId: string) {
    stored.delete(projectId);
    for (const name of [...hocuspocus.documents.keys()])
      if (parseDocName(name)?.projectId === projectId) hocuspocus.closeConnections(name);
  }

  return { hocuspocus, saveVersion, restoreVersion, refreshAccess, currentParts };
}

export type Collab = ReturnType<typeof createCollab>;
