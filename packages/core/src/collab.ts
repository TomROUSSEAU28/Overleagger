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

// ---------------------------------------------------------------------------
// Rights per sheet
// ---------------------------------------------------------------------------

/** What a person may do on one sheet (set by the project owner). */
export type SheetLevel = 'editor' | 'commenter' | 'viewer' | 'hidden';
/** From the most to the least powerful. */
export const SHEET_LEVELS: SheetLevel[] = ['editor', 'commenter', 'viewer', 'hidden'];
export const LEVEL_LABELS: Record<SheetLevel, string> = {
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'Can view',
  hidden: 'Hidden',
};

/** A rule on a sheet (and its sub-sheets) for a person or a team. */
export interface SheetRule {
  sheetId: Id;
  principal: 'user' | 'team';
  principalId: string;
  level: SheetLevel;
}

/** Access to a sheet: a project role, or hidden. */
export type Access = Role | 'hidden';

/** At least `min` (hidden is below everything). */
export function accessAtLeast(access: Access | undefined, min: Role): boolean {
  return access !== undefined && access !== 'hidden' && roleAtLeast(access, min);
}

/**
 * Access of a person to a sheet. The nearest sheet (itself, then its parents) that has rules
 * for the person decides: their own rule first, otherwise the best rule of their teams. Without
 * any rule, the project role applies. The owner always has every right.
 *
 * `rules` are the rules that apply to this person (theirs and their teams').
 */
export function effectiveLevel(
  sheetId: Id,
  role: Role,
  rules: readonly SheetRule[],
  parentOf: (sheetId: Id) => Id | undefined,
): Access {
  if (role === 'owner' || !rules.length) return role;
  const seen = new Set<Id>();
  for (let s: Id | undefined = sheetId; s && !seen.has(s); s = parentOf(s)) {
    seen.add(s);
    const here = rules.filter((r) => r.sheetId === s);
    if (!here.length) continue;
    const own = here.find((r) => r.principal === 'user');
    if (own) return own.level;
    return here.reduce((a, b) =>
      SHEET_LEVELS.indexOf(b.level) < SHEET_LEVELS.indexOf(a.level) ? b : a,
    ).level;
  }
  return role;
}

/** Can this person edit (or comment on) at least one sheet? */
export function writesSomewhere(role: Role, rules: readonly SheetRule[], min: Role = 'editor') {
  return (
    roleAtLeast(role, min) || rules.some((r) => r.level !== 'hidden' && roleAtLeast(r.level, min))
  );
}

/** Parts of a project document changed by an update. */
export interface TouchedScopes {
  /** Root maps: meta, sheets, symbols, comments, locks. */
  roots: Set<string>;
  /** Sheets whose content (or existence) changed. */
  sheets: Set<Id>;
  /** Sheets of the comment threads the update changes. */
  commentSheets: Set<Id>;
  /** Parent of each touched sheet (new sheets included), to find their rules. */
  parents: Map<Id, Id | undefined>;
}

function rootName(doc: Y.Doc, type: Y.AbstractType<unknown>): string {
  for (const [name, t] of doc.share) if (t === type) return name;
  return '?';
}

/** Root maps of the root document of a project, and of a sheet document. */
export const ROOT_DOC_MAPS = ['meta', 'sheets', 'symbols', 'locks'];
export const SHEET_DOC_MAPS = ['elements', 'comments'];

/**
 * Apply `update` to a copy of `doc` and report what it changes. The original document is not
 * modified. Cost: one copy of the document, so only call it when restrictions apply.
 */
export function touchedScopes(
  doc: Y.Doc,
  update: Uint8Array,
  maps: string[] = ROOT_DOC_MAPS,
): TouchedScopes {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  // Make sure the root types exist so nested items resolve to them by name.
  for (const name of maps) copy.getMap(name);
  const out: TouchedScopes = {
    roots: new Set(),
    sheets: new Set(),
    commentSheets: new Set(),
    parents: new Map(),
  };
  const threads = new Set<string>();
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
      const touched = root === 'sheets' ? out.sheets : root === 'comments' ? threads : null;
      if (!touched) continue;
      if (cur === type) {
        // Entries added or removed.
        for (const k of keys) if (k) touched.add(k);
      } else if (key) touched.add(key);
    }
  });
  Y.applyUpdate(copy, update);
  // After the update, or before it for what the update deleted.
  const field = (root: string, id: string, name: string) =>
    ((copy.getMap(root).get(id) as Y.Map<unknown> | undefined)?.get(name) ??
      (doc.getMap(root).get(id) as Y.Map<unknown> | undefined)?.get(name)) as string | undefined;
  for (const s of out.sheets) out.parents.set(s, field('sheets', s, 'parentSheetId'));
  for (const t of threads) {
    const s = field('comments', t, 'sheetId');
    if (s) out.commentSheets.add(s);
  }
  copy.destroy();
  return out;
}

type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * May a user with `role` send an update touching `scopes`? Viewers may change nothing,
 * commenters only comments, editors anything but locks and locked sheets, owners everything.
 * (Project-wide rights: see `updateAllowedFor` for rights per sheet.)
 */
export function updateAllowed(
  role: Role,
  scopes: TouchedScopes,
  lockedSheets: Iterable<Id>,
): Verdict {
  return updateAllowedFor(role, () => role, scopes, lockedSheets);
}

/** Name of a document of a project on the sync server: its root, or one of its sheets. */
export function docName(projectId: string, sheetId?: Id): string {
  return `${projectId}/${sheetId ?? 'root'}`;
}

/** `docName` the other way round (`undefined` for a name of the first versions of the app). */
export function parseDocName(name: string): { projectId: string; sheetId?: Id } | undefined {
  const i = name.indexOf('/');
  if (i <= 0 || i === name.length - 1) return undefined;
  const projectId = name.slice(0, i);
  const rest = name.slice(i + 1);
  return rest === 'root' ? { projectId } : { projectId, sheetId: rest };
}

/**
 * May a person apply `update` to one document of a project (`sheetId` for a sheet document,
 * none for the root)? `doc` is the current document, `parentOf` reads the sheet tree, `locked`
 * lists the locked sheets.
 */
export function docUpdateAllowed(
  doc: Y.Doc,
  sheetId: Id | undefined,
  update: Uint8Array,
  access: {
    role: Role;
    rules: readonly SheetRule[];
    parentOf: (sheetId: Id) => Id | undefined;
    locked: Iterable<Id>;
  },
): Verdict {
  const { role, rules } = access;
  if (role === 'owner') return { ok: true };
  const lockedSheets = [...access.locked];
  if (!sheetId) {
    const scopes = touchedScopes(doc, update);
    const parentOf = (s: Id) =>
      scopes.parents.has(s) ? scopes.parents.get(s) : access.parentOf(s);
    return updateAllowedFor(
      role,
      (s) => effectiveLevel(s, role, rules, parentOf),
      scopes,
      lockedSheets,
      writesSomewhere(role, rules, 'editor'),
    );
  }
  const level = effectiveLevel(sheetId, role, rules, access.parentOf);
  const locked = lockedSheets.includes(sheetId);
  // Editors of this sheet may change anything in it: no need to look at the update.
  if (accessAtLeast(level, 'editor') && !locked) return { ok: true };
  const { roots } = touchedScopes(doc, update, SHEET_DOC_MAPS);
  const scopes: TouchedScopes = {
    roots: new Set(),
    sheets: new Set(roots.has('elements') ? [sheetId] : []),
    commentSheets: new Set(roots.has('comments') ? [sheetId] : []),
    parents: new Map(),
  };
  return updateAllowedFor(role, () => level, scopes, lockedSheets);
}

/**
 * May a person send an update touching `scopes`, given their project `role` and their access
 * to each sheet (`levelOf`, from `effectiveLevel`)? Each changed sheet needs "Can edit", each
 * changed comment "Can comment" on its sheet; the project name needs the project role
 * "Can edit"; locks are for the owner.
 */
export function updateAllowedFor(
  role: Role,
  levelOf: (sheetId: Id) => Access,
  scopes: TouchedScopes,
  lockedSheets: Iterable<Id>,
  /** May add project symbols (they edit some sheet, where they place the part). */
  mayAddSymbols = false,
): Verdict {
  if (role === 'owner') return { ok: true };
  if (scopes.roots.has('locks')) return { ok: false, reason: 'Only the owner can lock sheets.' };
  if (scopes.roots.has('meta') && !roleAtLeast(role, 'editor'))
    return { ok: false, reason: 'Only editors of the whole project can change it.' };
  const locked = new Set(lockedSheets);
  for (const s of scopes.sheets) {
    if (!accessAtLeast(levelOf(s), 'editor'))
      return {
        ok: false,
        reason:
          role === 'viewer'
            ? 'Viewers cannot edit.'
            : role === 'commenter'
              ? 'Commenters can only comment.'
              : 'You cannot edit this sheet.',
      };
    if (locked.has(s)) return { ok: false, reason: 'This sheet is locked by the owner.' };
  }
  // Project symbols: editors of the project, or placing a part on a sheet you may edit.
  if (
    scopes.roots.has('symbols') &&
    !roleAtLeast(role, 'editor') &&
    !scopes.sheets.size &&
    !mayAddSymbols
  )
    return { ok: false, reason: 'Only editors of the whole project can change its symbols.' };
  for (const s of scopes.commentSheets)
    if (!accessAtLeast(levelOf(s), 'commenter'))
      return {
        ok: false,
        reason: role === 'viewer' ? 'Viewers cannot edit.' : 'You cannot comment on this sheet.',
      };
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
