/**
 * Collaboration rules shared by the server (which enforces them) and the client (which hides
 * what the user may not do).
 */
import * as Y from 'yjs';
import type { Id, Role } from './model/types';

export const ROLES: Role[] = ['owner', 'editor', 'commenter', 'viewer'];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'Can view',
};

/** True when `role` is at least as powerful as `min`. */
export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLES.indexOf(role) <= ROLES.indexOf(min);
}

/** Parts of a project document changed by an update. */
export interface TouchedScopes {
  /** Root maps: meta, sheets, symbols, comments, locks. */
  roots: Set<string>;
  /** Sheets whose content (or existence) changed. */
  sheets: Set<Id>;
}

function rootName(doc: Y.Doc, type: Y.AbstractType<unknown>): string {
  for (const [name, t] of doc.share) if (t === type) return name;
  return '?';
}

/**
 * Apply `update` to a copy of `doc` and report what it changes. The original document is not
 * modified. Cost: one copy of the document, so only call it when restrictions apply.
 */
export function touchedScopes(doc: Y.Doc, update: Uint8Array): TouchedScopes {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  // Make sure the root types exist so nested items resolve to them by name.
  for (const name of ['meta', 'sheets', 'symbols', 'comments', 'locks']) copy.getMap(name);
  const out: TouchedScopes = { roots: new Set(), sheets: new Set() };
  copy.on('afterTransaction', (tr: Y.Transaction) => {
    for (const [type, keys] of tr.changed) {
      let cur = type as Y.AbstractType<unknown>;
      let key: string | null = null;
      while (cur._item) {
        key = cur._item.parentSub;
        cur = cur._item.parent as Y.AbstractType<unknown>;
      }
      const root = rootName(copy, cur);
      out.roots.add(root);
      if (root !== 'sheets') continue;
      if (cur === type) {
        // Sheets added or removed.
        for (const k of keys) if (k) out.sheets.add(k);
      } else if (key) out.sheets.add(key);
    }
  });
  Y.applyUpdate(copy, update);
  copy.destroy();
  return out;
}

/**
 * May a user with `role` send an update touching `scopes`? Viewers may change nothing,
 * commenters only comments, editors anything but locks and locked sheets, owners everything.
 */
export function updateAllowed(
  role: Role,
  scopes: TouchedScopes,
  lockedSheets: Iterable<Id>,
): { ok: true } | { ok: false; reason: string } {
  if (role === 'owner') return { ok: true };
  if (role === 'viewer') return { ok: false, reason: 'Viewers cannot edit.' };
  if (role === 'commenter') {
    for (const r of scopes.roots)
      if (r !== 'comments') return { ok: false, reason: 'Commenters can only comment.' };
    return { ok: true };
  }
  if (scopes.roots.has('locks')) return { ok: false, reason: 'Only the owner can lock sheets.' };
  const locked = new Set(lockedSheets);
  for (const s of scopes.sheets)
    if (locked.has(s)) return { ok: false, reason: 'This sheet is locked by the owner.' };
  return { ok: true };
}

function cloneValue(v: unknown): unknown {
  if (v instanceof Y.Map) {
    const m = new Y.Map<unknown>();
    for (const [k, x] of v.entries()) m.set(k, cloneValue(x));
    return m;
  }
  if (v instanceof Y.Array) {
    const a = new Y.Array<unknown>();
    a.push(v.toArray().map(cloneValue));
    return a;
  }
  if (v instanceof Y.Text) return new Y.Text(v.toString());
  return v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}

/**
 * Replace the drawing content of `target` by the one of `source` (restoring a version).
 * Done as ordinary edits, so it syncs to every collaborator and can be undone by restoring
 * another version. Comments and locks are kept.
 */
export function replaceContent(
  target: Y.Doc,
  source: Y.Doc,
  roots = ['meta', 'sheets', 'symbols'],
  origin: unknown = null,
) {
  target.transact(() => {
    for (const name of roots) {
      const to = target.getMap(name);
      const from = source.getMap(name);
      for (const k of [...to.keys()]) if (!from.has(k)) to.delete(k);
      for (const [k, v] of from.entries()) to.set(k, cloneValue(v));
    }
  }, origin);
}
