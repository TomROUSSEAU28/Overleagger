import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  Project,
  addComponent,
  createBlock,
  createUndoManager,
  decodeBundle,
  docName,
  docUpdateAllowed,
  effectiveLevel,
  makeContext,
  parseDocName,
  writesSomewhere,
  type Role,
  type SheetRule,
  replaceContent,
  roleAtLeast,
  touchedScopes,
  updateAllowed,
  type Person,
} from '../index';

const alice: Person = { id: 'a', name: 'Alice', color: '#c00' };

/** The updates `fn` makes on a replica of `p`, per document (like a remote client sends). */
function remoteUpdates(p: Project, fn: (q: Project) => void): Map<string, Uint8Array> {
  const q = Project.fromUpdate(p.encodeState());
  const docs = () => [['root', q.doc] as const, ...q.sheetDocs()];
  const before = new Map(docs().map(([k, d]) => [k, Y.encodeStateVector(d)]));
  fn(q);
  const out = new Map<string, Uint8Array>();
  for (const [k, d] of docs()) {
    const sv = before.get(k);
    const u = Y.encodeStateAsUpdate(d, sv);
    const empty = sv && Y.encodeStateAsUpdate(d, Y.encodeStateVector(d));
    if (!sv || u.length > (empty?.length ?? 0)) out.set(k, u);
  }
  return out;
}

/** Would the server accept every document update of `fn`? */
function allowed(
  p: Project,
  role: Role,
  fn: (q: Project) => void,
  rules: SheetRule[] = [],
): boolean {
  for (const [key, u] of remoteUpdates(p, fn)) {
    const sheetId = key === 'root' ? undefined : key;
    const doc = sheetId ? (p.sheetDoc(sheetId) ?? new Y.Doc()) : p.doc;
    const verdict = docUpdateAllowed(doc, sheetId, u, {
      role,
      rules,
      parentOf: (s) => p.getSheet(s)?.parentSheetId,
      locked: p.locks.keys(),
    });
    if (!verdict.ok) return false;
  }
  return true;
}

describe('collaboration rules', () => {
  it('keeps each sheet in its own document', () => {
    const p = Project.create('t');
    const root = p.rootSheetId;
    const edit = remoteUpdates(p, (q) => addComponent(q, root, 'resistor', 0, 0, makeContext(q)));
    expect([...edit.keys()]).toEqual([root]);
    const s = touchedScopes(p.sheetDoc(root)!, edit.get(root)!, ['elements', 'comments']);
    expect([...s.roots]).toEqual(['elements']);
    const comment = remoteUpdates(p, (q) =>
      q.addComment({ sheetId: root, x: 0, y: 0 }, alice, 'hi'),
    );
    expect([...comment.keys()]).toEqual([root]);
    const rename = remoteUpdates(p, (q) => q.setMeta({ name: 'x' }));
    expect([...rename.keys()]).toEqual(['root']);
    expect(docName('p1')).toBe('p1/root');
    expect(parseDocName(docName('p1', root))).toEqual({ projectId: 'p1', sheetId: root });
    expect(parseDocName('p1')).toBeUndefined();
  });

  it('applies the role rules', () => {
    const p = Project.create('t');
    const root = p.rootSheetId;
    const edit = (q: Project) => addComponent(q, root, 'resistor', 0, 0, makeContext(q));
    const comment = (q: Project) => q.addComment({ sheetId: root, x: 0, y: 0 }, alice, 'hi');
    const lock = (q: Project) => q.setLock(root, alice);
    expect(allowed(p, 'viewer', comment)).toBe(false);
    expect(allowed(p, 'commenter', comment)).toBe(true);
    expect(allowed(p, 'commenter', edit)).toBe(false);
    expect(allowed(p, 'editor', edit)).toBe(true);
    expect(allowed(p, 'editor', lock)).toBe(false);
    expect(allowed(p, 'owner', lock)).toBe(true);
    expect(allowed(p, 'commenter', (q) => q.setMeta({ name: 'x' }))).toBe(false);
    p.setLock(root, alice);
    expect(allowed(p, 'editor', edit)).toBe(false);
    expect(roleAtLeast('editor', 'commenter')).toBe(true);
    expect(roleAtLeast('viewer', 'commenter')).toBe(false);
    // The old per-project check still reads the same scopes.
    expect(updateAllowed('editor', touchedScopes(p.doc, new Uint8Array([0, 0])), []).ok).toBe(true);
  });

  it('write guard blocks local edits and allows comments', () => {
    const p = Project.create('t');
    p.writeGuard = (_sheet, scope) => scope === 'comments';
    p.setMeta({ name: 'changed' });
    expect(p.getMeta().name).toBe('t');
    expect(p.addComment({ sheetId: p.rootSheetId, x: 1, y: 2 }, alice, 'Looks good')).toBeTruthy();
    const [t] = p.getComments();
    p.replyComment(t!.id, alice, 'Second');
    expect(p.getComments()[0]!.messages.map((m) => m.text)).toEqual(['Looks good', 'Second']);
  });

  it('restores a version as ordinary edits', () => {
    const p = Project.create('v1');
    const old = Project.fromUpdate(p.encodeState());
    addComponent(p, p.rootSheetId, 'resistor', 0, 0, makeContext(p));
    p.setMeta({ name: 'v2' });
    p.addComment({ sheetId: p.rootSheetId, x: 0, y: 0 }, alice, 'keep me');
    replaceContent(p.doc, old.doc);
    replaceContent(p.sheetDoc(p.rootSheetId)!, old.sheetDoc(p.rootSheetId)!, ['elements']);
    expect(p.getMeta().name).toBe('v1');
    expect(p.getElements(p.rootSheetId)).toEqual([]);
    expect(p.getComments()).toHaveLength(1);
  });

  it('reads projects saved in one single document by the first versions', () => {
    // Build a project the old way: sheets hold their elements, comments at the root.
    const old = new Y.Doc();
    old.transact(() => {
      const meta = old.getMap('meta');
      meta.set('name', 'Old');
      meta.set('rootSheetId', 'r');
      const sheet = new Y.Map<unknown>();
      sheet.set('id', 'r');
      sheet.set('name', 'Main');
      const els = new Y.Map<unknown>();
      const el = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 'e1', type: 'text', x: 1, y: 2, z: 1, text: 'hi' }))
        el.set(k, v);
      els.set('e1', el);
      sheet.set('elements', els);
      old.getMap('sheets').set('r', sheet);
      const t = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 't1', sheetId: 'r', x: 0, y: 0, createdAt: 1 }))
        t.set(k, v);
      const msgs = new Y.Array<unknown>();
      msgs.push([{ id: 'm', author: alice, text: 'note', at: 1 }]);
      t.set('messages', msgs);
      old.getMap('comments').set('t1', t);
    });
    expect(Project.isSingleDoc(old)).toBe(true);
    const p = Project.fromUpdate(Y.encodeStateAsUpdate(old));
    expect(p.getMeta().name).toBe('Old');
    expect(p.getElements('r').map((e) => e.id)).toEqual(['e1']);
    expect(p.getComments()[0]?.messages[0]?.text).toBe('note');
    expect(Project.isSingleDoc(p.doc)).toBe(false);
    const parts = decodeBundle(p.encodeState())!;
    expect([...parts.sheets.keys()]).toEqual(['r']);
  });

  it('keeps the pins of a block whose sheet is hidden', () => {
    const p = Project.create('t');
    const child = createBlock(p, p.rootSheetId, { x: 0, y: 0, w: 80, h: 60 }, 'Sub').childSheetId;
    p.transact(() => p.addElement(child, { type: 'port', x: 0, y: 0, name: 'IN', dir: 'in' }));
    // Someone who may not see the sheet only has the root and an empty sheet document.
    const parts = decodeBundle(p.encodeState())!;
    parts.sheets.delete(child);
    const q = Project.fromParts(parts);
    q.readGuard = (s) => s !== child;
    expect(q.getElements(child)).toEqual([]);
    expect(
      makeContext(q)
        .ports(child)
        .map((x) => x.name),
    ).toEqual(['IN']);
  });

  it('undoes an action that changed several documents in one step', () => {
    const p = Project.create('t');
    const um = createUndoManager(p);
    const root = p.rootSheetId;
    const block = p.transact(() => createBlock(p, root, { x: 0, y: 0, w: 80, h: 60 }, 'Sub'));
    const child = block.childSheetId;
    um.stopCapturing();
    p.transact(() => {
      addComponent(p, root, 'resistor', 0, 0, makeContext(p));
      addComponent(p, child, 'resistor', 0, 0, makeContext(p));
    });
    um.stopCapturing();
    expect(p.getElements(child)).toHaveLength(1);
    um.undo();
    expect(p.getElements(child)).toHaveLength(0);
    expect(p.getElements(root)).toHaveLength(1); // the block
    um.undo();
    expect(p.hasSheet(child)).toBe(false);
    expect(um.canUndo()).toBe(false);
    um.redo();
    um.redo();
    expect(p.getElements(child)).toHaveLength(1);
    expect(p.getElements(root)).toHaveLength(2);
    // A new change clears what could be redone.
    um.undo();
    um.stopCapturing();
    p.setMeta({ name: 'n' });
    expect(um.canRedo()).toBe(false);
  });
});

describe('rights per sheet', () => {
  // Sheet tree: root ─ power ─ driver
  //                  └ control
  const parents: Record<string, string | undefined> = {
    root: undefined,
    power: 'root',
    driver: 'power',
    control: 'root',
  };
  const parentOf = (s: string) => parents[s];
  const rule = (
    sheetId: string,
    level: SheetRule['level'],
    principal: SheetRule['principal'] = 'user',
  ): SheetRule => ({ sheetId, principal, principalId: principal === 'user' ? 'u' : 't', level });

  it('uses the project role without rules, and the owner always has every right', () => {
    expect(effectiveLevel('driver', 'viewer', [], parentOf)).toBe('viewer');
    expect(effectiveLevel('driver', 'owner', [rule('power', 'viewer')], parentOf)).toBe('owner');
  });

  it('applies the nearest rule, down the sub-sheets, raising or lowering the role', () => {
    const rules = [rule('power', 'editor')];
    expect(effectiveLevel('power', 'viewer', rules, parentOf)).toBe('editor');
    expect(effectiveLevel('driver', 'viewer', rules, parentOf)).toBe('editor');
    expect(effectiveLevel('control', 'viewer', rules, parentOf)).toBe('viewer');
    const lower = [rule('control', 'viewer')];
    expect(effectiveLevel('control', 'editor', lower, parentOf)).toBe('viewer');
    // A sub-sheet rule beats the parent's.
    const both = [rule('power', 'editor'), rule('driver', 'commenter')];
    expect(effectiveLevel('driver', 'viewer', both, parentOf)).toBe('commenter');
  });

  it("prefers the person's own rule, else the best team rule", () => {
    const teams = [rule('power', 'viewer', 'team'), rule('power', 'editor', 'team')];
    expect(effectiveLevel('power', 'commenter', teams, parentOf)).toBe('editor');
    const mine = [...teams, rule('power', 'commenter')];
    expect(effectiveLevel('power', 'commenter', mine, parentOf)).toBe('commenter');
  });

  it('says who can write somewhere', () => {
    expect(writesSomewhere('viewer', [])).toBe(false);
    expect(writesSomewhere('viewer', [rule('power', 'editor')])).toBe(true);
    expect(writesSomewhere('viewer', [rule('power', 'commenter')])).toBe(false);
    expect(writesSomewhere('viewer', [rule('power', 'commenter')], 'commenter')).toBe(true);
  });

  it('checks each changed sheet and comment against the access of the person', () => {
    const p = Project.create('t');
    const root = p.rootSheetId;
    const child = createBlock(p, root, { x: 0, y: 0, w: 80, h: 60 }, 'Sub').childSheetId;
    const editRoot = (q: Project) => addComponent(q, root, 'resistor', 0, 0, makeContext(q));
    const editChild = (q: Project) => addComponent(q, child, 'resistor', 0, 0, makeContext(q));
    const commentChild = (q: Project) => q.addComment({ sheetId: child, x: 0, y: 0 }, alice, 'hi');
    const subSheet = (q: Project) => createBlock(q, child, { x: 0, y: 0, w: 80, h: 60 }, 'Deep');
    const rules: SheetRule[] = [
      { sheetId: child, principal: 'user', principalId: 'a', level: 'editor' },
    ];
    // A viewer who may edit only the sub-sheet (and make sub-sheets in it).
    expect(allowed(p, 'viewer', editChild, rules)).toBe(true);
    expect(allowed(p, 'viewer', editRoot, rules)).toBe(false);
    expect(allowed(p, 'viewer', commentChild, rules)).toBe(true);
    expect(allowed(p, 'viewer', subSheet, rules)).toBe(true);
    expect(allowed(p, 'viewer', (q) => q.setMeta({ name: 'x' }), rules)).toBe(false);
    // An editor kept to viewing the sub-sheet.
    const lowered: SheetRule[] = [{ ...rules[0]!, level: 'viewer' }];
    expect(allowed(p, 'editor', editRoot, lowered)).toBe(true);
    expect(allowed(p, 'editor', editChild, lowered)).toBe(false);
    expect(allowed(p, 'editor', commentChild, lowered)).toBe(false);
    expect(allowed(p, 'editor', subSheet, lowered)).toBe(false);
  });
});
