import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  Project,
  addComponent,
  createBlock,
  effectiveLevel,
  makeContext,
  updateAllowedFor,
  writesSomewhere,
  type SheetRule,
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
    const editRoot = touchedScopes(
      p.doc,
      remoteUpdate(p, (q) => addComponent(q, root, 'resistor', 0, 0, makeContext(q))),
    );
    const editChild = touchedScopes(
      p.doc,
      remoteUpdate(p, (q) => addComponent(q, child, 'resistor', 0, 0, makeContext(q))),
    );
    const commentChild = touchedScopes(
      p.doc,
      remoteUpdate(p, (q) => q.addComment({ sheetId: child, x: 0, y: 0 }, alice, 'hi')),
    );
    expect([...commentChild.commentSheets]).toEqual([child]);
    expect(editChild.parents.get(child)).toBe(root);
    const rules = [
      { sheetId: child, principal: 'user' as const, principalId: 'a', level: 'editor' as const },
    ];
    const levelOf = (s: string) =>
      effectiveLevel(s, 'viewer', rules, (x) => p.getSheet(x)?.parentSheetId);
    // A viewer who may edit only the sub-sheet.
    expect(updateAllowedFor('viewer', levelOf, editChild, []).ok).toBe(true);
    expect(updateAllowedFor('viewer', levelOf, editRoot, []).ok).toBe(false);
    expect(updateAllowedFor('viewer', levelOf, commentChild, []).ok).toBe(true);
    // An editor kept to viewing the sub-sheet.
    const lowered = (s: string) =>
      effectiveLevel(
        s,
        'editor',
        [{ ...rules[0]!, level: 'viewer' }],
        (x) => p.getSheet(x)?.parentSheetId,
      );
    expect(updateAllowedFor('editor', lowered, editRoot, []).ok).toBe(true);
    expect(updateAllowedFor('editor', lowered, editChild, []).ok).toBe(false);
    expect(updateAllowedFor('editor', lowered, commentChild, []).ok).toBe(false);
  });
});
