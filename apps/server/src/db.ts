/**
 * SQLite storage (Node's built-in `node:sqlite`, no native module to compile).
 *
 * Tables: users, sessions, projects, members, invites, documents (Yjs state), versions,
 * libraries (each user's personal symbols and templates).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Role } from '@overleagger/core';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  color: string;
  password_hash: string | null;
  github_id: string | null;
  created_at: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
  thumbnail: string | null;
}

export interface InviteRow {
  token: string;
  project_id: string;
  role: Role;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
}

export interface VersionRow {
  id: string;
  project_id: string;
  created_at: number;
  author_id: string | null;
  label: string | null;
  auto: number;
  size: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  password_hash TEXT,
  github_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  thumbnail TEXT
);
CREATE TABLE IF NOT EXISTS members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  state BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  author_id TEXT,
  label TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL,
  state BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_project ON versions(project_id, created_at);
CREATE TABLE IF NOT EXISTS libraries (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // Users & sessions ---------------------------------------------------------

  createUser(u: UserRow) {
    this.db
      .prepare(
        'INSERT INTO users (id, email, name, color, password_hash, github_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(u.id, u.email, u.name, u.color, u.password_hash, u.github_id, u.created_at);
  }

  userById(id: string) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  userByEmail(email: string) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  }

  userByGithub(githubId: string) {
    return this.db.prepare('SELECT * FROM users WHERE github_id = ?').get(githubId) as
      UserRow | undefined;
  }

  setGithubId(userId: string, githubId: string) {
    this.db.prepare('UPDATE users SET github_id = ? WHERE id = ?').run(githubId, userId);
  }

  updateUser(userId: string, patch: { name?: string; color?: string }) {
    if (patch.name)
      this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(patch.name, userId);
    if (patch.color)
      this.db.prepare('UPDATE users SET color = ? WHERE id = ?').run(patch.color, userId);
  }

  createSession(tokenHash: string, userId: string, ttlMs: number) {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(tokenHash, userId, now, now + ttlMs);
  }

  sessionUser(tokenHash: string): UserRow | undefined {
    return this.db
      .prepare(
        'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?',
      )
      .get(tokenHash, Date.now()) as UserRow | undefined;
  }

  deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  // Projects & members ------------------------------------------------------

  createProject(p: ProjectRow) {
    this.db
      .prepare(
        'INSERT INTO projects (id, name, owner_id, created_at, updated_at, thumbnail) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(p.id, p.name, p.owner_id, p.created_at, p.updated_at, p.thumbnail);
    this.setMember(p.id, p.owner_id, 'owner');
  }

  project(id: string) {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  }

  updateProject(id: string, patch: { name?: string; thumbnail?: string; touch?: boolean }) {
    if (patch.name !== undefined)
      this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.thumbnail !== undefined)
      this.db.prepare('UPDATE projects SET thumbnail = ? WHERE id = ?').run(patch.thumbnail, id);
    if (patch.touch)
      this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  deleteProject(id: string) {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  projectsOf(userId: string) {
    return this.db
      .prepare(
        `SELECT projects.*, members.role AS role, owners.name AS owner_name
         FROM members
         JOIN projects ON projects.id = members.project_id
         JOIN users AS owners ON owners.id = projects.owner_id
         WHERE members.user_id = ?
         ORDER BY projects.updated_at DESC`,
      )
      .all(userId) as unknown as (ProjectRow & { role: Role; owner_name: string })[];
  }

  role(projectId: string, userId: string): Role | undefined {
    const r = this.db
      .prepare('SELECT role FROM members WHERE project_id = ? AND user_id = ?')
      .get(projectId, userId) as { role: Role } | undefined;
    return r?.role;
  }

  setMember(projectId: string, userId: string, role: Role) {
    this.db
      .prepare(
        `INSERT INTO members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(projectId, userId, role, Date.now());
  }

  removeMember(projectId: string, userId: string) {
    this.db
      .prepare('DELETE FROM members WHERE project_id = ? AND user_id = ?')
      .run(projectId, userId);
  }

  members(projectId: string) {
    return this.db
      .prepare(
        `SELECT users.id, users.name, users.email, users.color, members.role
         FROM members JOIN users ON users.id = members.user_id
         WHERE members.project_id = ? ORDER BY members.added_at`,
      )
      .all(projectId) as unknown as {
      id: string;
      name: string;
      email: string;
      color: string;
      role: Role;
    }[];
  }

  // Invites -----------------------------------------------------------------

  createInvite(i: InviteRow) {
    this.db
      .prepare(
        'INSERT INTO invites (token, project_id, role, created_by, created_at, expires_at, max_uses, uses) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      )
      .run(i.token, i.project_id, i.role, i.created_by, i.created_at, i.expires_at, i.max_uses);
  }

  invite(token: string) {
    return this.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as
      InviteRow | undefined;
  }

  invites(projectId: string) {
    return this.db
      .prepare('SELECT * FROM invites WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as unknown as InviteRow[];
  }

  useInvite(token: string) {
    this.db.prepare('UPDATE invites SET uses = uses + 1 WHERE token = ?').run(token);
  }

  deleteInvite(token: string) {
    this.db.prepare('DELETE FROM invites WHERE token = ?').run(token);
  }

  // Documents & versions ------------------------------------------------------

  loadState(projectId: string): Uint8Array | undefined {
    const r = this.db.prepare('SELECT state FROM documents WHERE project_id = ?').get(projectId) as
      { state: Uint8Array } | undefined;
    return r?.state;
  }

  saveState(projectId: string, state: Uint8Array) {
    this.db
      .prepare(
        `INSERT INTO documents (project_id, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(projectId, state, Date.now());
  }

  addVersion(v: Omit<VersionRow, 'size'> & { state: Uint8Array }) {
    this.db
      .prepare(
        'INSERT INTO versions (id, project_id, created_at, author_id, label, auto, size, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        v.id,
        v.project_id,
        v.created_at,
        v.author_id,
        v.label,
        v.auto,
        v.state.byteLength,
        v.state,
      );
  }

  versions(projectId: string) {
    return this.db
      .prepare(
        `SELECT versions.id, versions.project_id, versions.created_at, versions.author_id,
                versions.label, versions.auto, versions.size, users.name AS author_name
         FROM versions LEFT JOIN users ON users.id = versions.author_id
         WHERE versions.project_id = ? ORDER BY versions.created_at DESC`,
      )
      .all(projectId) as unknown as (VersionRow & { author_name: string | null })[];
  }

  lastVersionAt(projectId: string): number {
    const r = this.db
      .prepare('SELECT MAX(created_at) AS t FROM versions WHERE project_id = ?')
      .get(projectId) as { t: number | null };
    return r.t ?? 0;
  }

  versionState(projectId: string, versionId: string): Uint8Array | undefined {
    const r = this.db
      .prepare('SELECT state FROM versions WHERE project_id = ? AND id = ?')
      .get(projectId, versionId) as { state: Uint8Array } | undefined;
    return r?.state;
  }

  /** Keep every labelled version and the most recent `keep` automatic ones. */
  pruneAutoVersions(projectId: string, keep = 50) {
    this.db
      .prepare(
        `DELETE FROM versions WHERE project_id = ? AND auto = 1 AND id NOT IN (
           SELECT id FROM versions WHERE project_id = ? AND auto = 1 ORDER BY created_at DESC LIMIT ?)`,
      )
      .run(projectId, projectId, keep);
  }

  // Personal library ----------------------------------------------------------

  library(userId: string): { data: string; updated_at: number } | undefined {
    return this.db
      .prepare('SELECT data, updated_at FROM libraries WHERE user_id = ?')
      .get(userId) as { data: string; updated_at: number } | undefined;
  }

  saveLibrary(userId: string, data: string) {
    this.db
      .prepare(
        `INSERT INTO libraries (user_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(userId, data, Date.now());
  }
}
