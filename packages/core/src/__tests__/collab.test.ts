import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  Project,
  addComponent,
  makeContext,
  replaceContent,
  roleAtLeast,
  touchedScopes,
  updateAllowed,
  type Person,
} from '../index';

const alice: Person = { id: 'a', name: 'Alice', color: '#c00' };

/** Update produced by `fn` on a replica of `p` (like a remote client would send). */
function remoteUpdate(p: Project, fn: (q: Project) => void): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(p.doc));
  const q = new Project(doc);
  const before = Y.encodeStateVector(doc);
  fn(q);
  return Y.encodeStateAsUpdate(doc, before);
}

describe('collaboration rules', () => {
  it('finds which roots and sheets an update touches', () => {
    const p = Project.create('t');
    const root = p.rootSheetId;
    const edit = remoteUpdate(p, (q) => addComponent(q, root, 'resistor', 0, 0, makeContext(q)));
    const s = touchedScopes(p.doc, edit);
    expect([...s.roots]).toEqual(['sheets']);
    expect([...s.sheets]).toEqual([root]);
    const comment = remoteUpdate(p, (q) =>
      q.addComment({ sheetId: root, x: 0, y: 0 }, alice, 'hi'),
    );
    expect([...touchedScopes(p.doc, comment).roots]).toEqual(['comments']);
  });

  it('applies the role rules', () => {
    const p = Project.create('t');
    const root = p.rootSheetId;
    const edit = touchedScopes(
      p.doc,
      remoteUpdate(p, (q) => addComponent(q, root, 'resistor', 0, 0, makeContext(q))),
    );
    const comment = touchedScopes(
      p.doc,
      remoteUpdate(p, (q) => q.addComment({ sheetId: root, x: 0, y: 0 }, alice, 'hi')),
    );
    const lock = touchedScopes(
      p.doc,
      remoteUpdate(p, (q) => q.setLock(root, alice)),
    );
    expect(updateAllowed('viewer', comment, []).ok).toBe(false);
    expect(updateAllowed('commenter', comment, []).ok).toBe(true);
    expect(updateAllowed('commenter', edit, []).ok).toBe(false);
    expect(updateAllowed('editor', edit, []).ok).toBe(true);
    expect(updateAllowed('editor', edit, [root]).ok).toBe(false);
    expect(updateAllowed('editor', lock, []).ok).toBe(false);
    expect(updateAllowed('owner', lock, []).ok).toBe(true);
    expect(roleAtLeast('editor', 'commenter')).toBe(true);
    expect(roleAtLeast('viewer', 'commenter')).toBe(false);
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
    const old = new Y.Doc();
    Y.applyUpdate(old, Y.encodeStateAsUpdate(p.doc));
    addComponent(p, p.rootSheetId, 'resistor', 0, 0, makeContext(p));
    p.setMeta({ name: 'v2' });
    p.addComment({ sheetId: p.rootSheetId, x: 0, y: 0 }, alice, 'keep me');
    replaceContent(p.doc, old);
    expect(p.getMeta().name).toBe('v1');
    expect(p.getElements(p.rootSheetId)).toEqual([]);
    expect(p.getComments()).toHaveLength(1);
  });
});
