/**
 * SQLite storage (Node's built-in `node:sqlite`, no native module to compile).
 *
 * Tables: users, sessions, projects, members, invites, documents (Yjs state), versions,
 * libraries (each user's personal symbols and templates), friends, teams, team_members and
 * project_teams (a team added to a project: all its members get the role).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROLES, type Role, type SheetLevel, type SheetRule } from '@overleagger/core';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  color: string;
  password_hash: string | null;
  github_id: string | null;
  created_at: number;
  /** Short public name (@tom) to be found by friends. */
  handle?: string | null;
}

/** What other people may see of an account. */
export interface PublicUser {
  id: string;
  name: string;
  handle: string;
  color: string;
}

export interface TeamRow {
  id: string;
  name: string;
  owner_id: string;
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
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS project_teams (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, team_id)
);
CREATE TABLE IF NOT EXISTS sheet_rules (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id TEXT NOT NULL,
  principal TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY (project_id, sheet_id, principal, principal_id)
);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Older databases: add the handle column and give every account one. */
  private migrate() {
    const cols = this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'handle'))
      this.db.exec('ALTER TABLE users ADD COLUMN handle TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_handle ON users(handle)');
    const missing = this.db.prepare('SELECT id, name FROM users WHERE handle IS NULL').all() as {
      id: string;
      name: string;
    }[];
    for (const u of missing)
      this.db
        .prepare('UPDATE users SET handle = ? WHERE id = ?')
        .run(this.freeHandle(u.name), u.id);
  }

  /** A free handle made from a name: "Léa Martin" → "lea.martin", then "lea.martin2"… */
  freeHandle(name: string): string {
    const base =
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 16) || 'user';
    const padded = base.length < 3 ? `${base}${'0'.repeat(3 - base.length)}` : base;
    for (let i = 1; ; i++) {
      const h = i === 1 ? padded : `${padded}${i}`;
      if (!this.userByHandle(h)) return h;
    }
  }

  close() {
    this.db.close();
  }

  // Users & sessions ---------------------------------------------------------

  createUser(u: UserRow) {
    const handle = u.handle ?? this.freeHandle(u.name);
    this.db
      .prepare(
        'INSERT INTO users (id, email, name, color, password_hash, github_id, created_at, handle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(u.id, u.email, u.name, u.color, u.password_hash, u.github_id, u.created_at, handle);
    u.handle = handle;
  }

  userByHandle(handle: string) {
    return this.db.prepare('SELECT * FROM users WHERE handle = ?').get(handle) as
      UserRow | undefined;
  }

  setHandle(userId: string, handle: string) {
    this.db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, userId);
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

  /** Projects a person can open: as a member, or through one of their teams (best role wins). */
  projectsOf(userId: string) {
    const rows = this.db
      .prepare(
        `SELECT projects.*, members.role AS role, owners.name AS owner_name, NULL AS team_name
         FROM members
         JOIN projects ON projects.id = members.project_id
         JOIN users AS owners ON owners.id = projects.owner_id
         WHERE members.user_id = ?
         UNION ALL
         SELECT projects.*, project_teams.role AS role, owners.name AS owner_name,
                teams.name AS team_name
         FROM team_members
         JOIN project_teams ON project_teams.team_id = team_members.team_id
         JOIN teams ON teams.id = team_members.team_id
         JOIN projects ON projects.id = project_teams.project_id
         JOIN users AS owners ON owners.id = projects.owner_id
         WHERE team_members.user_id = ?`,
      )
      .all(userId, userId) as unknown as (ProjectRow & {
      role: Role;
      owner_name: string;
      team_name: string | null;
    })[];
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = best.get(r.id);
      if (!cur || ROLES.indexOf(r.role) < ROLES.indexOf(cur.role)) best.set(r.id, r);
    }
    return [...best.values()].sort((a, b) => b.updated_at - a.updated_at);
  }

  /** Role on a project: the best of the person's own role and the roles of their teams. */
  role(projectId: string, userId: string): Role | undefined {
    const rows = this.db
      .prepare(
        `SELECT role FROM members WHERE project_id = ? AND user_id = ?
         UNION ALL
         SELECT project_teams.role FROM project_teams
         JOIN team_members ON team_members.team_id = project_teams.team_id
         WHERE project_teams.project_id = ? AND team_members.user_id = ?`,
      )
      .all(projectId, userId, projectId, userId) as { role: Role }[];
    let best: Role | undefined;
    for (const r of rows) if (!best || ROLES.indexOf(r.role) < ROLES.indexOf(best)) best = r.role;
    return best;
  }

  /** The person's own membership (not through a team). */
  directRole(projectId: string, userId: string): Role | undefined {
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
        `SELECT users.id, users.name, users.email, users.color, users.handle, members.role
         FROM members JOIN users ON users.id = members.user_id
         WHERE members.project_id = ? ORDER BY members.added_at`,
      )
      .all(projectId) as unknown as {
      id: string;
      name: string;
      email: string;
      color: string;
      handle: string;
      role: Role;
    }[];
  }

  // Teams on a project --------------------------------------------------------

  setProjectTeam(projectId: string, teamId: string, role: Role) {
    this.db
      .prepare(
        `INSERT INTO project_teams (project_id, team_id, role, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, team_id) DO UPDATE SET role = excluded.role`,
      )
      .run(projectId, teamId, role, Date.now());
  }

  removeProjectTeam(projectId: string, teamId: string) {
    this.db
      .prepare('DELETE FROM project_teams WHERE project_id = ? AND team_id = ?')
      .run(projectId, teamId);
  }

  projectTeams(projectId: string) {
    return this.db
      .prepare(
        `SELECT teams.id, teams.name, project_teams.role,
                (SELECT COUNT(*) FROM team_members WHERE team_members.team_id = teams.id) AS size
         FROM project_teams JOIN teams ON teams.id = project_teams.team_id
         WHERE project_teams.project_id = ? ORDER BY project_teams.added_at`,
      )
      .all(projectId) as unknown as { id: string; name: string; role: Role; size: number }[];
  }

  // Rights per sheet ------------------------------------------------------------

  /** Set (or remove, with `null`) the rule of a person or a team on a sheet. */
  setRule(projectId: string, r: Omit<SheetRule, 'level'> & { level: SheetLevel | null }) {
    if (r.level === null)
      this.db
        .prepare(
          'DELETE FROM sheet_rules WHERE project_id = ? AND sheet_id = ? AND principal = ? AND principal_id = ?',
        )
        .run(projectId, r.sheetId, r.principal, r.principalId);
    else
      this.db
        .prepare(
          `INSERT INTO sheet_rules (project_id, sheet_id, principal, principal_id, level)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(project_id, sheet_id, principal, principal_id)
           DO UPDATE SET level = excluded.level`,
        )
        .run(projectId, r.sheetId, r.principal, r.principalId, r.level);
  }

  /** Every rule of a project (for its owner). */
  rules(projectId: string): SheetRule[] {
    return (
      this.db
        .prepare(
          'SELECT sheet_id, principal, principal_id, level FROM sheet_rules WHERE project_id = ?',
        )
        .all(projectId) as {
        sheet_id: string;
        principal: 'user' | 'team';
        principal_id: string;
        level: SheetLevel;
      }[]
    ).map((r) => ({
      sheetId: r.sheet_id,
      principal: r.principal,
      principalId: r.principal_id,
      level: r.level,
    }));
  }

  /** The rules that apply to a person: their own and those of their teams. */
  rulesFor(projectId: string, userId: string): SheetRule[] {
    const teams = new Set(
      (
        this.db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').all(userId) as {
          team_id: string;
        }[]
      ).map((t) => t.team_id),
    );
    return this.rules(projectId).filter((r) =>
      r.principal === 'user' ? r.principalId === userId : teams.has(r.principalId),
    );
  }

  // Friends -----------------------------------------------------------------

  /** The request between two people, whoever sent it. */
  friendship(a: string, b: string) {
    return this.db
      .prepare(
        `SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      )
      .get(a, b, b, a) as
      { user_id: string; friend_id: string; status: 'pending' | 'accepted' } | undefined;
  }

  requestFriend(from: string, to: string) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)",
      )
      .run(from, to, Date.now());
  }

  acceptFriend(me: string, from: string) {
    this.db
      .prepare(
        "UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'",
      )
      .run(from, me);
  }

  removeFriend(a: string, b: string) {
    this.db
      .prepare(
        'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      )
      .run(a, b, b, a);
  }

  areFriends(a: string, b: string) {
    return this.friendship(a, b)?.status === 'accepted';
  }

  /** Friends, requests received and requests sent. */
  friendsOf(userId: string) {
    const rows = this.db
      .prepare(
        `SELECT users.id, users.name, users.handle, users.color, friends.status,
                friends.user_id = ? AS sent
         FROM friends
         JOIN users ON users.id = CASE WHEN friends.user_id = ? THEN friends.friend_id
                                       ELSE friends.user_id END
         WHERE friends.user_id = ? OR friends.friend_id = ?
         ORDER BY users.name`,
      )
      .all(userId, userId, userId, userId) as unknown as (PublicUser & {
      status: string;
      sent: number;
    })[];
    const pub = ({ id, name, handle, color }: PublicUser) => ({ id, name, handle, color });
    return {
      friends: rows.filter((r) => r.status === 'accepted').map(pub),
      incoming: rows.filter((r) => r.status === 'pending' && !r.sent).map(pub),
      outgoing: rows.filter((r) => r.status === 'pending' && r.sent).map(pub),
    };
  }

  // Teams -------------------------------------------------------------------

  createTeam(t: TeamRow) {
    this.db
      .prepare('INSERT INTO teams (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(t.id, t.name, t.owner_id, t.created_at);
    this.addTeamMember(t.id, t.owner_id);
  }

  team(id: string) {
    return this.db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as TeamRow | undefined;
  }

  renameTeam(id: string, name: string) {
    this.db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, id);
  }

  deleteTeam(id: string) {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }

  addTeamMember(teamId: string, userId: string) {
    this.db
      .prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, added_at) VALUES (?, ?, ?)')
      .run(teamId, userId, Date.now());
  }

  removeTeamMember(teamId: string, userId: string) {
    this.db
      .prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
      .run(teamId, userId);
  }

  isTeamMember(teamId: string, userId: string) {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?')
        .get(teamId, userId),
    );
  }

  /** Teams a person belongs to, with their members. */
  teamsOf(userId: string) {
    const teams = this.db
      .prepare(
        `SELECT teams.* FROM teams JOIN team_members ON team_members.team_id = teams.id
         WHERE team_members.user_id = ? ORDER BY teams.name`,
      )
      .all(userId) as unknown as TeamRow[];
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      ownerId: t.owner_id,
      members: this.db
        .prepare(
          `SELECT users.id, users.name, users.handle, users.color FROM team_members
           JOIN users ON users.id = team_members.user_id
           WHERE team_members.team_id = ? ORDER BY team_members.added_at`,
        )
        .all(t.id) as unknown as PublicUser[],
    }));
  }

  /** Projects a team was added to (to refresh open connections when the team changes). */
  teamProjects(teamId: string) {
    return (
      this.db.prepare('SELECT project_id FROM project_teams WHERE team_id = ?').all(teamId) as {
        project_id: string;
      }[]
    ).map((r) => r.project_id);
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
