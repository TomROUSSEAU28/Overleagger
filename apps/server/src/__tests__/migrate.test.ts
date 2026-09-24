import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Project } from '@overleagger/core';
import { afterAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Store } from '../db';

const dir = mkdtempSync(join(tmpdir(), 'cn-migrate-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('splits projects stored in one single document when the server starts', () => {
  const file = join(dir, 'db.sqlite');
  const first = new Store(file);
  first.close();

  // A database of the first versions: the project in the `documents` table.
  const old = new Y.Doc();
  old.transact(() => {
    old.getMap('meta').set('name', 'Legacy');
    old.getMap('meta').set('rootSheetId', 'r');
    const sheet = new Y.Map<unknown>();
    sheet.set('id', 'r');
    sheet.set('name', 'Main');
    const els = new Y.Map<unknown>();
    const el = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ id: 'e', type: 'text', x: 0, y: 0, z: 1, text: 'hi' }))
      el.set(k, v);
    els.set('e', el);
    sheet.set('elements', els);
    old.getMap('sheets').set('r', sheet);
  });
  const db = new DatabaseSync(file);
  db.exec(
    "INSERT INTO users (id, email, name, color, created_at) VALUES ('u', 'u@x.test', 'U', '#000', 0)",
  );
  db.exec(
    "INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES ('p', 'Legacy', 'u', 0, 0)",
  );
  db.prepare('INSERT INTO documents (project_id, state, updated_at) VALUES (?, ?, 0)').run(
    'p',
    Y.encodeStateAsUpdate(old),
  );
  db.close();

  const store = new Store(file);
  const docs = store.loadDocs('p');
  expect([...docs.keys()].sort()).toEqual(['r', 'root']);
  const p = Project.fromParts({
    root: docs.get('root')!,
    sheets: new Map([['r', docs.get('r')!]]),
  });
  expect(p.getMeta().name).toBe('Legacy');
  expect(p.getElements('r').map((e) => e.id)).toEqual(['e']);
  store.close();
});
