import { Project } from '@overleagger/core';
import type { Standard } from '@overleagger/symbols';
import { createStore, del, get, keys, set } from 'idb-keyval';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { DocStore } from './docStore';

export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Small SVG preview of the root sheet. */
  thumbnail?: string;
}

const index = createStore('overleagger-index', 'projects');
/** Storage of a project in the first versions of the app (one Yjs document). */
const legacyDbName = (id: string) => `overleagger-project-${id}`;

export function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function listProjects(): Promise<ProjectEntry[]> {
  const ids = (await keys(index)) as string[];
  const entries = await Promise.all(ids.map((id) => get<ProjectEntry>(id, index)));
  return entries
    .filter((e): e is ProjectEntry => Boolean(e))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getEntry(id: string): Promise<ProjectEntry | undefined> {
  return get<ProjectEntry>(id, index);
}

export async function updateEntry(id: string, patch: Partial<ProjectEntry>): Promise<void> {
  const cur = await get<ProjectEntry>(id, index);
  if (!cur) return;
  await set(id, { ...cur, ...patch }, index);
}

export interface OpenProject {
  id: string;
  project: Project;
  /** Stop saving (after the last changes are saved) and close the documents. */
  close: () => Promise<void>;
}

const space = (id: string) => `local:${id}`;

/** Store a project under a new project id. */
async function persistNew(project: Project, name: string): Promise<string> {
  const id = newProjectId();
  const store = new DocStore(space(id));
  const off = store.bindProject(project, true);
  off();
  await store.close();
  const now = Date.now();
  await set(id, { id, name, createdAt: now, updatedAt: now } satisfies ProjectEntry, index);
  return id;
}

export async function createProject(
  name: string,
  standard: Standard,
  seed?: (p: Project) => void,
): Promise<string> {
  const p = Project.create(name, standard);
  seed?.(p);
  const id = await persistNew(p, name);
  p.destroy();
  return id;
}

export async function createProjectFromUpdate(update: Uint8Array, name?: string): Promise<string> {
  const p = Project.fromUpdate(update);
  if (name) p.setMeta({ name });
  const id = await persistNew(p, p.getMeta().name);
  p.destroy();
  return id;
}

/** A project saved by the first versions of the app (one document, y-indexeddb). */
async function loadSingleDoc(id: string): Promise<Project | undefined> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(legacyDbName(id), doc);
  await persistence.whenSynced;
  await persistence.destroy();
  const p = doc.getMap('meta').has('rootSheetId') ? Project.fromSingleDoc(doc) : undefined;
  doc.destroy();
  return p;
}

export async function openProject(id: string): Promise<OpenProject> {
  const store = new DocStore(space(id));
  const docs = await store.load();
  let project: Project;
  let initial = false;
  if (docs.has('root')) {
    const sheets = new Map(docs);
    sheets.delete('root');
    project = Project.fromParts({ root: docs.get('root')!, sheets });
  } else {
    // Converted once; the old copy stays in the browser until the project is deleted.
    const old = await loadSingleDoc(id);
    if (!old) throw new Error('This project could not be loaded (empty or damaged document).');
    project = old;
    initial = true;
  }
  if (!project.rootSheetId || !project.hasSheet(project.rootSheetId)) {
    project.destroy();
    throw new Error('This project could not be loaded (empty or damaged document).');
  }
  const off = store.bindProject(project, initial);
  return {
    id,
    project,
    close: async () => {
      off();
      await store.close();
      project.destroy();
    },
  };
}

export async function deleteProject(id: string): Promise<void> {
  await del(id, index);
  await new DocStore(space(id)).clear();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(legacyDbName(id));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export async function duplicateProject(id: string): Promise<string> {
  const open = await openProject(id);
  const update = open.project.encodeState();
  const name = `${open.project.getMeta().name} (copy)`;
  await open.close();
  return createProjectFromUpdate(update, name);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const open = await openProject(id);
  open.project.setMeta({ name });
  await open.close();
  await updateEntry(id, { name, updatedAt: Date.now() });
}

export async function exportProjectUpdate(
  id: string,
): Promise<{ name: string; update: Uint8Array; json: unknown }> {
  const open = await openProject(id);
  const out = {
    name: open.project.getMeta().name,
    update: open.project.encodeState(),
    json: open.project.toJSON(),
  };
  await open.close();
  return out;
}
