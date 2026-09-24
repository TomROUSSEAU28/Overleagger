import * as Y from 'yjs';
import type { Standard } from '@overleagger/symbols';
import { newId } from '../ids';
import type {
  CommentMessage,
  CommentThread,
  Element,
  Id,
  NewElement,
  Person,
  PortElement,
  ProjectMeta,
  ProjectSymbol,
  SheetInfo,
  SheetLock,
} from './types';

/** What a change is about: drawing content, comments, sheet locks, or the project itself. */
export type WriteScope = 'doc' | 'comments' | 'locks' | 'project';

/**
 * What the local user may change (set by the collaboration layer). `sheetId` is the sheet being
 * changed; without it, the question is "may they change this kind of thing somewhere?".
 * 'project' is the project name, standard and symbols.
 */
export type WriteGuard = (sheetId: Id | undefined, scope: WriteScope) => boolean;

/** Transaction origin for edits made by the local user (tracked by the undo manager). */
export const LOCAL_ORIGIN = 'overleagger:local';

export const FORMAT_VERSION = 1;

type YElement = Y.Map<unknown>;
type YSheet = Y.Map<unknown>;

/** Origin of the edits made while converting an old single-document project. */
const MIGRATION_ORIGIN = 'overleagger:migration';
/** Origin of the copy of a sheet's ports kept in the root (derived data, not undone). */
const PORTS_ORIGIN = 'overleagger:ports';

export interface ProjectOptions {
  /**
   * Gives the document of a sheet (the app can sync or store it, or pass one already loaded).
   * Default: a new empty document.
   */
  sheetDoc?: (sheetId: Id) => Y.Doc;
}

/** Called when the document of a sheet appears or is replaced (`old`). */
export type SheetDocListener = (sheetId: Id, doc: Y.Doc, old?: Y.Doc) => void;

/**
 * Project backed by Yjs, split in several documents so that a sheet can be kept from some
 * people (the server only sends the documents they may see):
 *
 * - the **root** document (`project.doc`):
 *     meta:    Y.Map   { name, standard, rootSheetId, formatVersion, createdAt, palette }
 *     sheets:  Y.Map<sheetId, Y.Map { id, name, parentSheetId?, blockId?, noPresent?, noExport?,
 *                                     ports? }>   (ports: copy of the sheet's ports, so the pins
 *                                                  of its block show even if it is hidden)
 *     symbols: Y.Map<symbolId, StaticSymbolDef>   (project custom symbols)
 *     locks:   Y.Map<sheetId, SheetLock>          (sheets only the owner may edit)
 * - one document **per sheet** (`project.sheetDoc(id)`):
 *     elements: Y.Map<id, Y.Map>                  (the drawing)
 *     comments: Y.Map<threadId, Y.Map { id, sheetId, x, y, elementId?, resolved?, createdAt,
 *                                       messages: Y.Array<CommentMessage> }>
 *
 * Each element is its own Y.Map so concurrent edits of different fields merge cleanly.
 * Reads return plain immutable snapshots that are cached until the element changes, so UI
 * components can rely on object identity. A sheet that is kept from the user simply has an
 * empty document.
 */
export class Project {
  /** The root document. */
  readonly doc: Y.Doc;
  readonly meta: Y.Map<unknown>;
  readonly sheets: Y.Map<YSheet>;
  readonly symbols: Y.Map<ProjectSymbol>;
  readonly locks: Y.Map<SheetLock>;
  /** Collaboration permissions; `null` = everything allowed (local projects). */
  writeGuard: WriteGuard | null = null;
  /** Sheets the local user may see; `null` = all of them. */
  readGuard: ((sheetId: Id) => boolean) | null = null;

  private docs = new Map<Id, Y.Doc>();
  private handlers = new Map<Y.Doc, (tr: Y.Transaction) => void>();
  private portsCache = new Map<Id, { version: number; list: PortElement[] }>();
  private makeDoc: (sheetId: Id) => Y.Doc;
  private docListeners = new Set<SheetDocListener>();
  private cache = new WeakMap<YElement, Element>();
  private listCache = new Map<Id, { version: number; list: Element[] }>();
  private _version = 0;
  private listeners = new Set<() => void>();

  constructor(doc: Y.Doc, options: ProjectOptions = {}) {
    this.doc = doc;
    this.makeDoc = options.sheetDoc ?? (() => new Y.Doc());
    this.meta = doc.getMap('meta');
    this.sheets = doc.getMap('sheets') as Y.Map<YSheet>;
    this.symbols = doc.getMap('symbols') as Y.Map<ProjectSymbol>;
    this.locks = doc.getMap('locks') as Y.Map<SheetLock>;
    this.watch(doc);
    for (const id of this.sheets.keys()) this.ensureDoc(id);
    // Sheets added by someone else get their document too.
    this.sheets.observe((e) => {
      for (const [id, change] of e.changes.keys) if (change.action !== 'delete') this.ensureDoc(id);
    });
  }

  private onTransaction = (tr: Y.Transaction) => {
    if (tr.changed.size === 0) return;
    for (const type of tr.changed.keys()) {
      if (type instanceof Y.Map) this.cache.delete(type as YElement);
    }
    // Changes nested deeper (should not happen, we store plain JSON) are covered by changedParentTypes.
    for (const type of tr.changedParentTypes.keys()) {
      if (type instanceof Y.Map) this.cache.delete(type as YElement);
    }
    this._version++;
    for (const l of this.listeners) l();
  };

  private watch(doc: Y.Doc, sheetId?: Id) {
    const h = sheetId
      ? (tr: Y.Transaction) => {
          this.onTransaction(tr);
          // My changes to a sheet: keep the copy of its ports in the root up to date.
          if (tr.local && tr.changed.size) this.publishPorts(sheetId);
        }
      : this.onTransaction;
    doc.on('afterTransaction', h);
    this.handlers.set(doc, h);
  }

  private unwatch(doc: Y.Doc) {
    const h = this.handlers.get(doc);
    if (h) doc.off('afterTransaction', h);
    this.handlers.delete(doc);
  }

  private ensureDoc(sheetId: Id): Y.Doc {
    let d = this.docs.get(sheetId);
    if (!d) {
      d = this.makeDoc(sheetId);
      this.docs.set(sheetId, d);
      this.watch(d, sheetId);
      this.listCache.delete(sheetId);
      for (const l of this.docListeners) l(sheetId, d);
    }
    return d;
  }

  /** The document of a sheet (elements and comments). */
  sheetDoc(sheetId: Id): Y.Doc | undefined {
    return this.docs.get(sheetId);
  }

  /** Every sheet document, deleted sheets included (their content is kept for undo). */
  sheetDocs(): [Id, Y.Doc][] {
    return [...this.docs];
  }

  /** Be told when a sheet document appears or is replaced. */
  onSheetDoc(fn: SheetDocListener): () => void {
    this.docListeners.add(fn);
    return () => this.docListeners.delete(fn);
  }

  /**
   * Throw away the local content of a sheet (it became hidden for this user): its document is
   * replaced by a new empty one.
   */
  resetSheetDoc(sheetId: Id): Y.Doc {
    const old = this.docs.get(sheetId);
    const d = this.makeDoc(sheetId);
    this.docs.set(sheetId, d);
    this.watch(d, sheetId);
    this.listCache.delete(sheetId);
    if (old) {
      this.unwatch(old);
      old.destroy();
    }
    for (const l of this.docListeners) l(sheetId, d, old);
    this._version++;
    for (const l of this.listeners) l();
    return d;
  }

  /** Close every document. */
  destroy() {
    for (const d of this.docs.values()) d.destroy();
    this.doc.destroy();
  }

  /** Create a new empty project with a root sheet. */
  static create(name: string, standard: Standard = 'IEC', doc = new Y.Doc()): Project {
    const p = new Project(doc);
    const rootId = newId();
    doc.transact(() => {
      p.meta.set('name', name);
      p.meta.set('standard', standard);
      p.meta.set('rootSheetId', rootId);
      p.meta.set('formatVersion', FORMAT_VERSION);
      p.meta.set('createdAt', Date.now());
      p.createSheetRaw({ id: rootId, name: 'Main' });
    });
    return p;
  }

  /** Monotonic counter bumped after every transaction (local or remote). */
  get version(): number {
    return this._version;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** False for a sheet hidden from the local user (its content is not in this browser). */
  canRead(sheetId: Id): boolean {
    return this.readGuard ? this.readGuard(sheetId) : true;
  }

  /** True when the local user may make this kind of change. */
  canWrite(sheetId?: Id, scope: WriteScope = 'doc'): boolean {
    return this.writeGuard ? this.writeGuard(sheetId, scope) : true;
  }

  /** Run edits in one Yjs transaction (skipped entirely when the user may not edit). */
  transact<T>(fn: () => T, origin: unknown = LOCAL_ORIGIN): T {
    if (!this.canWrite()) return undefined as T;
    return this.inAllDocs(fn, origin);
  }

  /**
   * Run `fn` with a transaction open on every document, so that one action is one change per
   * document (one undo step, one message to the server).
   */
  private inAllDocs<T>(fn: () => T, origin: unknown): T {
    const docs = [this.doc, ...this.docs.values()];
    let out!: T;
    const run = (i: number): void => {
      if (i === docs.length) out = fn();
      else docs[i]!.transact(() => run(i + 1), origin);
    };
    run(0);
    return out;
  }

  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------

  getMeta(): ProjectMeta {
    return {
      name: (this.meta.get('name') as string) ?? 'Untitled',
      standard: (this.meta.get('standard') as Standard) ?? 'IEC',
      rootSheetId: this.meta.get('rootSheetId') as Id,
      formatVersion: (this.meta.get('formatVersion') as number) ?? FORMAT_VERSION,
      createdAt: (this.meta.get('createdAt') as number) ?? 0,
      palette: (this.meta.get('palette') as string[] | undefined) ?? [],
    };
  }

  setMeta(patch: Partial<ProjectMeta>): void {
    if (!this.canWrite(undefined, 'project')) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) this.meta.set(k, v);
    });
  }

  get rootSheetId(): Id {
    return this.meta.get('rootSheetId') as Id;
  }

  // -------------------------------------------------------------------------
  // Sheets
  // -------------------------------------------------------------------------

  /** Create a sheet (must be called inside a transaction). */
  createSheetRaw(info: SheetInfo): Id {
    const s = new Y.Map<unknown>();
    s.set('id', info.id);
    s.set('name', info.name);
    if (info.parentSheetId) s.set('parentSheetId', info.parentSheetId);
    if (info.blockId) s.set('blockId', info.blockId);
    if (info.noPresent) s.set('noPresent', true);
    if (info.noExport) s.set('noExport', true);
    this.sheets.set(info.id, s);
    this.ensureDoc(info.id);
    return info.id;
  }

  hasSheet(id: Id): boolean {
    return this.sheets.has(id);
  }

  getSheet(id: Id): SheetInfo | undefined {
    const s = this.sheets.get(id);
    if (!s) return undefined;
    const info: SheetInfo = { id, name: (s.get('name') as string) ?? '' };
    const parent = s.get('parentSheetId') as Id | undefined;
    const block = s.get('blockId') as Id | undefined;
    if (parent) info.parentSheetId = parent;
    if (block) info.blockId = block;
    if (s.get('noPresent')) info.noPresent = true;
    if (s.get('noExport')) info.noExport = true;
    return info;
  }

  listSheets(): SheetInfo[] {
    const out: SheetInfo[] = [];
    for (const id of this.sheets.keys()) {
      const s = this.getSheet(id);
      if (s) out.push(s);
    }
    return out;
  }

  updateSheet(id: Id, patch: Partial<Omit<SheetInfo, 'id'>>): void {
    const s = this.sheets.get(id);
    if (!s || !this.canWrite(id)) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === false) s.delete(k);
        else s.set(k, v);
      }
    });
  }

  /**
   * Delete a sheet (no recursion; see hierarchy helpers). Must be called inside a transaction.
   * Its document is kept, so that undo brings the sheet back with its content.
   */
  deleteSheetRaw(id: Id): void {
    this.sheets.delete(id);
    this.listCache.delete(id);
  }

  private elementsMap(sheetId: Id): Y.Map<YElement> | undefined {
    if (!this.sheets.has(sheetId)) return undefined;
    return this.docs.get(sheetId)?.getMap('elements') as Y.Map<YElement> | undefined;
  }

  private commentsMap(sheetId: Id): Y.Map<Y.Map<unknown>> | undefined {
    return this.docs.get(sheetId)?.getMap('comments') as Y.Map<Y.Map<unknown>> | undefined;
  }

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------

  private snapshot(m: YElement): Element {
    if (m.doc && inTransaction(m.doc)) return m.toJSON() as Element;
    let el = this.cache.get(m);
    if (!el) {
      el = Object.freeze(m.toJSON()) as Element;
      this.cache.set(m, el);
    }
    return el;
  }

  /** All elements of a sheet sorted by z-order. The array is cached per document version. */
  getElements(sheetId: Id): Element[] {
    const doc = this.docs.get(sheetId);
    const busy = doc ? inTransaction(doc) : false;
    const hit = this.listCache.get(sheetId);
    if (hit && hit.version === this._version && !busy) return hit.list;
    const map = this.elementsMap(sheetId);
    const list: Element[] = [];
    if (map) for (const m of map.values()) list.push(this.snapshot(m));
    list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    if (!busy) this.listCache.set(sheetId, { version: this._version, list });
    return list;
  }

  getElement(sheetId: Id, id: Id): Element | undefined {
    const m = this.elementsMap(sheetId)?.get(id);
    return m ? this.snapshot(m) : undefined;
  }

  /**
   * Ports of a sheet (they make the pins of its block): read from the sheet, or from the copy
   * kept in the root when the sheet is hidden from the user.
   */
  sheetPorts(sheetId: Id): PortElement[] {
    if (this.canRead(sheetId))
      return this.getElements(sheetId).filter((e): e is PortElement => e.type === 'port');
    const hit = this.portsCache.get(sheetId);
    if (hit && hit.version === this._version) return hit.list;
    const list = (this.sheets.get(sheetId)?.get('ports') as PortElement[] | undefined) ?? [];
    this.portsCache.set(sheetId, { version: this._version, list });
    return list;
  }

  private publishPorts(sheetId: Id) {
    const entry = this.sheets.get(sheetId);
    if (!entry || !this.canWrite(sheetId)) return;
    const ports = this.getElements(sheetId).filter((e) => e.type === 'port');
    const old = entry.get('ports');
    if (sameValue(old ?? [], ports)) return;
    this.doc.transact(() => {
      if (ports.length) entry.set('ports', clone(ports));
      else entry.delete('ports');
    }, PORTS_ORIGIN);
  }

  /** Highest z value in a sheet. */
  maxZ(sheetId: Id): number {
    let z = 0;
    for (const el of this.getElements(sheetId)) if (el.z > z) z = el.z;
    return z;
  }

  addElement(sheetId: Id, el: NewElement): Element {
    const map = this.elementsMap(sheetId);
    if (!map) throw new Error(`Unknown sheet ${sheetId}`);
    if (!this.canWrite(sheetId)) throw new ReadOnlyError();
    const id = el.id ?? newId();
    const full = { ...el, id, z: el.z ?? this.maxZ(sheetId) + 1 } as Element;
    this.transact(() => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(full)) if (v !== undefined) m.set(k, clone(v));
      map.set(id, m);
    });
    return this.getElement(sheetId, id)!;
  }

  /** Shallow-merge `patch` into an element. `undefined` values delete the field. */
  updateElement(sheetId: Id, id: Id, patch: Partial<Element>): void {
    const m = this.elementsMap(sheetId)?.get(id);
    if (!m || !this.canWrite(sheetId)) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'id' || k === 'type') continue;
        if (v === undefined) m.delete(k);
        else if (!sameValue(m.get(k), v)) m.set(k, clone(v));
      }
    });
  }

  /** Replace several elements at once (each one shallow-merged). */
  updateElements(sheetId: Id, patches: { id: Id; patch: Partial<Element> }[]): void {
    this.transact(() => {
      for (const { id, patch } of patches) this.updateElement(sheetId, id, patch);
    });
  }

  removeElement(sheetId: Id, id: Id): void {
    const map = this.elementsMap(sheetId);
    if (!map?.has(id) || !this.canWrite(sheetId)) return;
    this.transact(() => map.delete(id));
  }

  // -------------------------------------------------------------------------
  // Custom symbols
  // -------------------------------------------------------------------------

  getProjectSymbols(): ProjectSymbol[] {
    return [...this.symbols.values()];
  }

  // -------------------------------------------------------------------------
  // Comments (writable by commenters too)
  // -------------------------------------------------------------------------

  private commentTransact(sheetId: Id | undefined, fn: () => void) {
    const doc = sheetId ? this.docs.get(sheetId) : undefined;
    if (!doc || !this.canWrite(sheetId, 'comments')) return false;
    doc.transact(fn, LOCAL_ORIGIN);
    return true;
  }

  /** The thread and the sheet it is on. */
  private findThread(threadId: Id): { m: Y.Map<unknown>; sheetId: Id } | undefined {
    for (const [sheetId, doc] of this.docs) {
      const m = doc.getMap('comments').get(threadId) as Y.Map<unknown> | undefined;
      if (m) return { m, sheetId };
    }
    return undefined;
  }

  /** Comment threads of the sheets that exist (oldest first). */
  getComments(): CommentThread[] {
    const out: CommentThread[] = [];
    for (const sheetId of this.sheets.keys()) {
      const map = this.commentsMap(sheetId);
      if (!map) continue;
      for (const m of map.values()) {
        const t = m.toJSON() as CommentThread;
        out.push({ ...t, sheetId, messages: t.messages ?? [] });
      }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  addComment(
    at: { sheetId: Id; x: number; y: number; elementId?: Id },
    author: Person,
    text: string,
  ): Id | undefined {
    const id = newId();
    const ok = this.commentTransact(at.sheetId, () => {
      const m = new Y.Map<unknown>();
      m.set('id', id);
      m.set('sheetId', at.sheetId);
      m.set('x', at.x);
      m.set('y', at.y);
      if (at.elementId) m.set('elementId', at.elementId);
      m.set('createdAt', Date.now());
      const msgs = new Y.Array<CommentMessage>();
      msgs.push([{ id: newId(), author, text, at: Date.now() }]);
      m.set('messages', msgs);
      this.commentsMap(at.sheetId)!.set(id, m);
    });
    return ok ? id : undefined;
  }

  replyComment(threadId: Id, author: Person, text: string): void {
    const t = this.findThread(threadId);
    const msgs = t?.m.get('messages') as Y.Array<CommentMessage> | undefined;
    if (!t || !msgs) return;
    this.commentTransact(t.sheetId, () =>
      msgs.push([{ id: newId(), author, text, at: Date.now() }]),
    );
  }

  updateComment(threadId: Id, patch: Partial<Pick<CommentThread, 'resolved' | 'x' | 'y'>>): void {
    const t = this.findThread(threadId);
    if (!t) return;
    this.commentTransact(t.sheetId, () => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === false) t.m.delete(k);
        else t.m.set(k, v);
      }
    });
  }

  /** Put back a thread exactly as it was (undo of a deletion). */
  restoreComment(thread: CommentThread): void {
    this.commentTransact(thread.sheetId, () => {
      this.commentsMap(thread.sheetId)!.set(thread.id, commentMap(thread));
    });
  }

  deleteComment(threadId: Id): void {
    const t = this.findThread(threadId);
    if (!t) return;
    this.commentTransact(t.sheetId, () => this.commentsMap(t.sheetId)!.delete(threadId));
  }

  // -------------------------------------------------------------------------
  // Sheet locks (owner only)
  // -------------------------------------------------------------------------

  getLock(sheetId: Id): SheetLock | undefined {
    return this.locks.get(sheetId);
  }

  setLock(sheetId: Id, by: Person | null): void {
    if (!this.canWrite(sheetId, 'locks')) return;
    this.doc.transact(() => {
      if (by) this.locks.set(sheetId, { by, at: Date.now() });
      else this.locks.delete(sheetId);
    }, LOCAL_ORIGIN);
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /** Readable JSON snapshot of the whole project (for `.olg` files and debugging). */
  toJSON(): {
    meta: ProjectMeta;
    sheets: (SheetInfo & { elements: Element[] })[];
    symbols: ProjectSymbol[];
  } {
    return {
      meta: this.getMeta(),
      sheets: this.listSheets().map((s) => ({ ...s, elements: this.getElements(s.id) })),
      symbols: this.getProjectSymbols(),
    };
  }

  /** The state of each document: the root, and the sheets that exist. */
  encodeParts(): ProjectParts {
    const sheets = new Map<Id, Uint8Array>();
    for (const id of this.sheets.keys()) {
      const d = this.docs.get(id);
      if (d) sheets.set(id, Y.encodeStateAsUpdate(d));
    }
    return { root: Y.encodeStateAsUpdate(this.doc), sheets };
  }

  /** The whole project in one byte array (see `encodeBundle`). */
  encodeState(): Uint8Array {
    return encodeBundle(this.encodeParts());
  }

  /** Load a project from its parts (documents missing from `parts` start empty). */
  static fromParts(parts: ProjectParts, options: ProjectOptions = {}): Project {
    const root = new Y.Doc();
    Y.applyUpdate(root, parts.root);
    return new Project(root, {
      sheetDoc: (id) => {
        const d = options.sheetDoc?.(id) ?? new Y.Doc();
        const state = parts.sheets.get(id);
        if (state) Y.applyUpdate(d, state);
        return d;
      },
    });
  }

  /**
   * Load a project saved by `encodeState`, or by the first versions of the app (one single
   * Yjs document), which is converted.
   */
  static fromUpdate(bytes: Uint8Array): Project {
    const parts = decodeBundle(bytes);
    if (parts) return Project.fromParts(parts);
    const old = new Y.Doc();
    Y.applyUpdate(old, bytes);
    const p = Project.fromSingleDoc(old);
    old.destroy();
    return p;
  }

  /** True for a document of the first versions of the app (everything in one document). */
  static isSingleDoc(doc: Y.Doc): boolean {
    const sheets = doc.getMap('sheets') as Y.Map<YSheet>;
    for (const s of sheets.values()) if (s.get('elements') instanceof Y.Map) return true;
    return (doc.getMap('comments') as Y.Map<unknown>).size > 0;
  }

  /** Convert a project of the first versions of the app (ids are kept, not the history). */
  static fromSingleDoc(old: Y.Doc): Project {
    const p = new Project(new Y.Doc());
    const oldSheets = old.getMap('sheets') as Y.Map<YSheet>;
    const oldComments = old.getMap('comments') as Y.Map<Y.Map<unknown>>;
    p.inAllDocs(() => {
      for (const name of ['meta', 'symbols', 'locks'] as const)
        for (const [k, v] of old.getMap(name).entries()) p.doc.getMap(name).set(k, clone(v));
      for (const [id, s] of oldSheets.entries()) {
        const info = s.toJSON() as SheetInfo & { elements?: unknown };
        delete info.elements;
        p.createSheetRaw({ ...info, id });
        const els = s.get('elements') as Y.Map<YElement> | undefined;
        const to = p.elementsMap(id)!;
        p.docs.get(id)!.transact(() => {
          if (els)
            for (const [eid, m] of els.entries()) {
              const n = new Y.Map<unknown>();
              for (const [k, v] of Object.entries(m.toJSON())) if (v !== undefined) n.set(k, v);
              to.set(eid, n);
            }
        }, MIGRATION_ORIGIN);
      }
      for (const m of oldComments.values()) {
        const t = m.toJSON() as CommentThread;
        const map = p.commentsMap(t.sheetId);
        if (map)
          p.docs
            .get(t.sheetId)!
            .transact(
              () => map.set(t.id, commentMap({ ...t, messages: t.messages ?? [] })),
              MIGRATION_ORIGIN,
            );
      }
    }, MIGRATION_ORIGIN);
    for (const id of p.sheets.keys()) p.publishPorts(id);
    return p;
  }
}

/** The documents of a project: the root and one per sheet. */
export interface ProjectParts {
  root: Uint8Array;
  sheets: Map<Id, Uint8Array>;
}

// A bundle starts with a byte no Yjs update of a real project starts with (0 = no structs,
// then a delete set announced for 0x43 clients: never produced).
const BUNDLE_MAGIC = [0x00, 0x43, 0x4e, 0x42, 0x31]; // "\0CNB1"

/** Pack the documents of a project in one byte array (files, storage, versions). */
export function encodeBundle(parts: ProjectParts): Uint8Array {
  const enc = new TextEncoder();
  const items: [Uint8Array, Uint8Array][] = [[new Uint8Array(0), parts.root]];
  for (const [id, state] of parts.sheets) items.push([enc.encode(id), state]);
  let size = BUNDLE_MAGIC.length + 4;
  for (const [k, v] of items) size += 2 + k.length + 4 + v.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(BUNDLE_MAGIC, 0);
  let o = BUNDLE_MAGIC.length;
  view.setUint32(o, items.length);
  o += 4;
  for (const [k, v] of items) {
    view.setUint16(o, k.length);
    out.set(k, o + 2);
    o += 2 + k.length;
    view.setUint32(o, v.length);
    out.set(v, o + 4);
    o += 4 + v.length;
  }
  return out;
}

/** Unpack a bundle; `undefined` when `bytes` is not one (a single-document project). */
export function decodeBundle(bytes: Uint8Array): ProjectParts | undefined {
  if (bytes.length < BUNDLE_MAGIC.length + 4 || BUNDLE_MAGIC.some((b, i) => bytes[i] !== b))
    return undefined;
  const dec = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = BUNDLE_MAGIC.length;
  const n = view.getUint32(o);
  o += 4;
  let root: Uint8Array | undefined;
  const sheets = new Map<Id, Uint8Array>();
  for (let i = 0; i < n; i++) {
    const kl = view.getUint16(o);
    const key = dec.decode(bytes.subarray(o + 2, o + 2 + kl));
    o += 2 + kl;
    const vl = view.getUint32(o);
    const v = bytes.slice(o + 4, o + 4 + vl);
    o += 4 + vl;
    if (i === 0) root = v;
    else sheets.set(key, v);
  }
  return root ? { root, sheets } : undefined;
}

function inTransaction(doc: Y.Doc): boolean {
  return (doc as unknown as { _transaction: unknown })._transaction !== null;
}

function commentMap(thread: CommentThread): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(thread)) {
    if (k === 'messages' || v === undefined || v === false) continue;
    m.set(k, v);
  }
  const msgs = new Y.Array<CommentMessage>();
  msgs.push(thread.messages.map((x) => ({ ...x })));
  m.set('messages', msgs);
  return m;
}

/** Thrown when adding content the local user may not add (read-only or locked sheet). */
export class ReadOnlyError extends Error {
  constructor() {
    super('This sheet is read-only for you.');
    this.name = 'ReadOnlyError';
  }
}

function clone<T>(v: T): T {
  return v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** One undo step: the changes it made in each document, and what the app wants to remember. */
export interface UndoStep {
  managers: Set<Y.UndoManager>;
  meta: Map<string, unknown>;
}

/**
 * Undo / redo across the documents of a project. Each document has its own `Y.UndoManager`
 * (Yjs tracks one document per manager); the changes one action makes in several documents
 * form one step, undone together.
 */
export class ProjectUndo {
  private managers = new Map<Y.Doc, Y.UndoManager>();
  private undoSteps: UndoStep[] = [];
  private redoSteps: UndoStep[] = [];
  /** Step that changes of the current action join. */
  private open: UndoStep | null = null;
  private mode: 'do' | 'undo' | 'redo' = 'do';
  private carried: Map<string, unknown> | null = null;
  private stepListeners = new Set<(step: UndoStep) => void>();
  private off: () => void;

  constructor(project: Project) {
    this.track(project.doc, [project.meta, project.sheets, project.symbols]);
    for (const [, d] of project.sheetDocs()) this.track(d, [d.getMap('elements')]);
    this.off = project.onSheetDoc((_id, d, old) => {
      if (old) this.untrack(old);
      this.track(d, [d.getMap('elements')]);
    });
  }

  private track(doc: Y.Doc, scope: ConstructorParameters<typeof Y.UndoManager>[0]) {
    const um = new Y.UndoManager(scope, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 400,
    });
    um.on('stack-item-added', () => this.added(um));
    this.managers.set(doc, um);
  }

  private untrack(doc: Y.Doc) {
    const um = this.managers.get(doc);
    if (!um) return;
    um.destroy();
    this.managers.delete(doc);
    for (const list of [this.undoSteps, this.redoSteps]) {
      for (const s of list) s.managers.delete(um);
      const kept = list.filter((s) => s.managers.size);
      list.splice(0, list.length, ...kept);
    }
  }

  private added(um: Y.UndoManager) {
    const list = this.mode === 'undo' ? this.redoSteps : this.undoSteps;
    if (this.mode === 'do' && this.redoSteps.length) {
      // A new change: nothing to redo any more, in any document.
      this.redoSteps = [];
      for (const m of this.managers.values()) if (m !== um) m.clear(false, true);
    }
    let step = this.open;
    if (!step || !list.includes(step)) {
      step = { managers: new Set(), meta: new Map(this.carried ?? []) };
      list.push(step);
      this.open = step;
      if (this.mode === 'do') for (const l of this.stepListeners) l(step);
      // Changes made in the same task belong to the same action.
      queueMicrotask(() => {
        if (this.open === step) this.open = null;
      });
    }
    step.managers.add(um);
  }

  /** Be told of each new step (to remember where it was made). */
  onStep(fn: (step: UndoStep) => void): () => void {
    this.stepListeners.add(fn);
    return () => this.stepListeners.delete(fn);
  }

  /** The next change starts a new step. */
  stopCapturing() {
    this.open = null;
    for (const m of this.managers.values()) m.stopCapturing();
  }

  canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  /** The step that `undo` / `redo` would revert. */
  peek(which: 'undo' | 'redo'): UndoStep | undefined {
    const list = which === 'undo' ? this.undoSteps : this.redoSteps;
    return list[list.length - 1];
  }

  undo(): UndoStep | undefined {
    return this.revert('undo');
  }

  redo(): UndoStep | undefined {
    return this.revert('redo');
  }

  private revert(mode: 'undo' | 'redo'): UndoStep | undefined {
    const list = mode === 'undo' ? this.undoSteps : this.redoSteps;
    for (let step = list.pop(); step; step = list.pop()) {
      this.open = null;
      this.mode = mode;
      this.carried = step.meta;
      let done = false;
      try {
        for (const m of step.managers) if (mode === 'undo' ? m.undo() : m.redo()) done = true;
      } finally {
        this.mode = 'do';
        this.carried = null;
        this.open = null;
      }
      if (done) return step;
    }
    return undefined;
  }

  destroy() {
    this.off();
    for (const m of this.managers.values()) m.destroy();
    this.managers.clear();
  }
}

export function createUndoManager(project: Project): ProjectUndo {
  return new ProjectUndo(project);
}
