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
  ProjectMeta,
  ProjectSymbol,
  SheetInfo,
  SheetLock,
} from './types';

/**
 * What the local user may change (set by the collaboration layer). `sheetId` is the sheet being
 * edited when known; `scope` is 'comments' for comment threads, 'locks' for sheet locks.
 */
export type WriteGuard = (sheetId: Id | undefined, scope: 'doc' | 'comments' | 'locks') => boolean;

/** Transaction origin for edits made by the local user (tracked by the undo manager). */
export const LOCAL_ORIGIN = 'overleagger:local';

export const FORMAT_VERSION = 1;

type YElement = Y.Map<unknown>;
type YSheet = Y.Map<unknown>;

/**
 * Project document backed by Yjs.
 *
 * Layout:
 *   meta:    Y.Map   { name, standard, rootSheetId, formatVersion, createdAt }
 *   sheets:  Y.Map<sheetId, Y.Map { id, name, parentSheetId?, blockId?, elements: Y.Map<id, Y.Map> }>
 *   symbols: Y.Map<symbolId, StaticSymbolDef>   (project custom symbols)
 *   comments: Y.Map<threadId, Y.Map { id, sheetId, x, y, elementId?, resolved?, createdAt,
 *                                     messages: Y.Array<CommentMessage> }>
 *   locks:   Y.Map<sheetId, SheetLock>          (sheets only the owner may edit)
 *
 * Each element is its own Y.Map so concurrent edits of different fields merge cleanly.
 * Reads return plain immutable snapshots that are cached until the element changes, so UI
 * components can rely on object identity.
 */
export class Project {
  readonly doc: Y.Doc;
  readonly meta: Y.Map<unknown>;
  readonly sheets: Y.Map<YSheet>;
  readonly symbols: Y.Map<ProjectSymbol>;
  readonly comments: Y.Map<Y.Map<unknown>>;
  readonly locks: Y.Map<SheetLock>;
  /** Collaboration permissions; `null` = everything allowed (local projects). */
  writeGuard: WriteGuard | null = null;

  private cache = new WeakMap<YElement, Element>();
  private listCache = new Map<Id, { version: number; list: Element[] }>();
  private _version = 0;
  private listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.meta = doc.getMap('meta');
    this.sheets = doc.getMap('sheets') as Y.Map<YSheet>;
    this.symbols = doc.getMap('symbols') as Y.Map<ProjectSymbol>;
    this.comments = doc.getMap('comments') as Y.Map<Y.Map<unknown>>;
    this.locks = doc.getMap('locks') as Y.Map<SheetLock>;
    doc.on('afterTransaction', (tr: Y.Transaction) => {
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
    });
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

  /** True when the local user may make this kind of change. */
  canWrite(sheetId?: Id, scope: 'doc' | 'comments' | 'locks' = 'doc'): boolean {
    return this.writeGuard ? this.writeGuard(sheetId, scope) : true;
  }

  /** Run edits in one Yjs transaction (skipped entirely when the user may not edit). */
  transact<T>(fn: () => T, origin: unknown = LOCAL_ORIGIN): T {
    if (!this.canWrite()) return undefined as T;
    let out!: T;
    this.doc.transact(() => {
      out = fn();
    }, origin);
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
    s.set('elements', new Y.Map());
    this.sheets.set(info.id, s);
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

  /** Delete a sheet (no recursion; see hierarchy helpers). Must be called inside a transaction. */
  deleteSheetRaw(id: Id): void {
    this.sheets.delete(id);
    this.listCache.delete(id);
  }

  private elementsMap(sheetId: Id): Y.Map<YElement> | undefined {
    return this.sheets.get(sheetId)?.get('elements') as Y.Map<YElement> | undefined;
  }

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------

  /** True while a Yjs transaction is open: caches are only refreshed after it ends. */
  private get inTransaction(): boolean {
    return (this.doc as unknown as { _transaction: unknown })._transaction !== null;
  }

  private snapshot(m: YElement): Element {
    if (this.inTransaction) return m.toJSON() as Element;
    let el = this.cache.get(m);
    if (!el) {
      el = Object.freeze(m.toJSON()) as Element;
      this.cache.set(m, el);
    }
    return el;
  }

  /** All elements of a sheet sorted by z-order. The array is cached per document version. */
  getElements(sheetId: Id): Element[] {
    const hit = this.listCache.get(sheetId);
    if (hit && hit.version === this._version && !this.inTransaction) return hit.list;
    const map = this.elementsMap(sheetId);
    const list: Element[] = [];
    if (map) for (const m of map.values()) list.push(this.snapshot(m));
    list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    if (!this.inTransaction) this.listCache.set(sheetId, { version: this._version, list });
    return list;
  }

  getElement(sheetId: Id, id: Id): Element | undefined {
    const m = this.elementsMap(sheetId)?.get(id);
    return m ? this.snapshot(m) : undefined;
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

  private commentTransact(fn: () => void) {
    if (!this.canWrite(undefined, 'comments')) return false;
    this.doc.transact(fn, LOCAL_ORIGIN);
    return true;
  }

  getComments(): CommentThread[] {
    const out: CommentThread[] = [];
    for (const m of this.comments.values()) {
      const t = m.toJSON() as CommentThread;
      out.push({ ...t, messages: t.messages ?? [] });
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  addComment(
    at: { sheetId: Id; x: number; y: number; elementId?: Id },
    author: Person,
    text: string,
  ): Id | undefined {
    const id = newId();
    const ok = this.commentTransact(() => {
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
      this.comments.set(id, m);
    });
    return ok ? id : undefined;
  }

  replyComment(threadId: Id, author: Person, text: string): void {
    const msgs = this.comments.get(threadId)?.get('messages') as
      Y.Array<CommentMessage> | undefined;
    if (!msgs) return;
    this.commentTransact(() => msgs.push([{ id: newId(), author, text, at: Date.now() }]));
  }

  updateComment(threadId: Id, patch: Partial<Pick<CommentThread, 'resolved' | 'x' | 'y'>>): void {
    const m = this.comments.get(threadId);
    if (!m) return;
    this.commentTransact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === false) m.delete(k);
        else m.set(k, v);
      }
    });
  }

  /** Put back a thread exactly as it was (undo of a deletion). */
  restoreComment(thread: CommentThread): void {
    this.commentTransact(() => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(thread)) {
        if (k === 'messages' || v === undefined || v === false) continue;
        m.set(k, v);
      }
      const msgs = new Y.Array<CommentMessage>();
      msgs.push(thread.messages.map((x) => ({ ...x })));
      m.set('messages', msgs);
      this.comments.set(thread.id, m);
    });
  }

  deleteComment(threadId: Id): void {
    if (!this.comments.has(threadId)) return;
    this.commentTransact(() => this.comments.delete(threadId));
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

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  static fromUpdate(update: Uint8Array): Project {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    return new Project(doc);
  }
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

export function createUndoManager(project: Project): Y.UndoManager {
  return new Y.UndoManager([project.meta, project.sheets, project.symbols], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 400,
  });
}
