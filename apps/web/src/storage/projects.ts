import { Project } from '@overleagger/core';
import type { Standard } from '@overleagger/symbols';
import { createStore, del, get, keys, set } from 'idb-keyval';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Small SVG preview of the root sheet. */
  thumbnail?: string;
}

const index = createStore('overleagger-index', 'projects');
const dbName = (id: string) => `overleagger-project-${id}`;

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
  persistence: IndexeddbPersistence;
  close: () => void;
}

/** Store a Yjs document under a new project id. */
async function persistNew(doc: Y.Doc, name: string): Promise<string> {
  const id = newProjectId();
  const persistence = new IndexeddbPersistence(dbName(id), doc);
  await persistence.whenSynced;
  // Make sure the full state is written before closing.
  await new Promise((r) => setTimeout(r, 50));
  await persistence.destroy();
  const now = Date.now();
  await set(id, { id, name, createdAt: now, updatedAt: now } satisfies ProjectEntry, index);
  return id;
}

export async function createProject(
  name: string,
  standard: Standard,
  seed?: (p: Project) => void,
): Promise<string> {
  const doc = new Y.Doc();
  const p = Project.create(name, standard, doc);
  seed?.(p);
  return persistNew(doc, name);
}

export async function createProjectFromUpdate(update: Uint8Array, name?: string): Promise<string> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const p = new Project(doc);
  if (name) p.setMeta({ name });
  return persistNew(doc, p.getMeta().name);
}

export async function openProject(id: string): Promise<OpenProject> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(dbName(id), doc);
  await persistence.whenSynced;
  const project = new Project(doc);
  if (!project.rootSheetId || !project.hasSheet(project.rootSheetId)) {
    await persistence.destroy();
    throw new Error('This project could not be loaded (empty or damaged document).');
  }
  return {
    id,
    project,
    persistence,
    close: () => {
      void persistence.destroy();
      doc.destroy();
    },
  };
}

export async function deleteProject(id: string): Promise<void> {
  await del(id, index);
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(id));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export async function duplicateProject(id: string): Promise<string> {
  const open = await openProject(id);
  const update = open.project.encodeState();
  const name = `${open.project.getMeta().name} (copy)`;
  open.close();
  return createProjectFromUpdate(update, name);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const open = await openProject(id);
  open.project.setMeta({ name });
  await new Promise((r) => setTimeout(r, 50));
  open.close();
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
  open.close();
  return out;
}
