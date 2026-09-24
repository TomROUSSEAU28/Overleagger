/**
 * Browser storage of the documents of a project (IndexedDB). Every change of every document is
 * written as soon as it happens; when the project is loaded again, the changes of each document
 * are merged into one record.
 *
 * One database for every project: records are keyed `[space, document, time, random]`, where
 * `space` names the project ("local:<id>" or "cloud:<id>") and `document` is "root" or a sheet id.
 */
import type { Project } from '@overleagger/core';
import * as Y from 'yjs';

const DB_NAME = 'circuit-notebook-docs';
const STORE = 'updates';

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('IndexedDB is not available.'));
    };
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write failed.'));
  });
}

/** Key range of a whole space, or of one document of it. */
function range(space: string, doc?: string): IDBKeyRange {
  return doc === undefined
    ? IDBKeyRange.bound([space], [space, []])
    : IDBKeyRange.bound([space, doc], [space, doc, []]);
}

/** Documents stored in this browser for one project. */
export class DocStore {
  private pending = new Set<Promise<void>>();
  private bound = new Map<Y.Doc, () => void>();

  constructor(readonly space: string) {}

  /** The stored documents, each merged into one update (and compacted in storage). */
  async load(): Promise<Map<string, Uint8Array>> {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const [keys, values] = await Promise.all([
      request(store.getAllKeys(range(this.space))),
      request(store.getAll(range(this.space))),
    ]);
    const byDoc = new Map<string, { keys: IDBValidKey[]; updates: Uint8Array[] }>();
    keys.forEach((k, i) => {
      const doc = (k as [string, string])[1];
      let e = byDoc.get(doc);
      if (!e) byDoc.set(doc, (e = { keys: [], updates: [] }));
      e.keys.push(k);
      e.updates.push(new Uint8Array(values[i] as ArrayBuffer | Uint8Array));
    });
    const out = new Map<string, Uint8Array>();
    for (const [doc, e] of byDoc) {
      const merged = e.updates.length === 1 ? e.updates[0]! : Y.mergeUpdates(e.updates);
      out.set(doc, merged);
      if (e.updates.length > 1) {
        for (const k of e.keys) store.delete(k);
        store.put(merged, key(this.space, doc));
      }
    }
    await done(tx);
    return out;
  }

  private write(doc: string, update: Uint8Array) {
    const p = openDb()
      .then((db) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(update, key(this.space, doc));
        return done(tx);
      })
      .catch((e: unknown) => console.error('Could not save a change in this browser:', e))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Keep a document stored: all its content now if `initial`, then each change. */
  bind(name: string, doc: Y.Doc, initial = false) {
    this.bound.get(doc)?.();
    if (initial) this.write(name, Y.encodeStateAsUpdate(doc));
    const onUpdate = (update: Uint8Array) => this.write(name, update);
    doc.on('update', onUpdate);
    this.bound.set(doc, () => doc.off('update', onUpdate));
  }

  /** Keep the root and every sheet of a project stored, and the sheets added later. */
  bindProject(project: Project, initial = false): () => void {
    this.bind('root', project.doc, initial);
    for (const [id, d] of project.sheetDocs()) this.bind(id, d, initial);
    return project.onSheetDoc((id, d, old) => {
      if (old) this.unbind(old);
      this.bind(id, d, true);
    });
  }

  unbind(doc: Y.Doc) {
    this.bound.get(doc)?.();
    this.bound.delete(doc);
  }

  /** Every write started so far is done. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** Forget the stored content of one document, or of the whole project. */
  async clear(doc?: string): Promise<void> {
    await this.flush();
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(range(this.space, doc));
    await done(tx);
  }

  /** Stop writing (after the last changes are written). */
  async close(): Promise<void> {
    for (const off of this.bound.values()) off();
    this.bound.clear();
    await this.flush();
  }
}

let seq = 0;
function key(space: string, doc: string): IDBValidKey {
  return [space, doc, Date.now(), ++seq, Math.random()];
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed.'));
  });
}
