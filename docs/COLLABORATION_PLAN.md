# Collaboration plan: contacts, teams, per-sheet rights

Goal: after creating an account, working together is easy. You add friends, create a team,
add people to a project, and the owner decides who may **see**, **comment** or **edit**, down
to a single sheet ("Alice may only edit sheet 2", "Bob must not see the controller").

## What exists today

- Accounts (email + password, optional GitHub), sessions, a personal library.
- Server projects with members and 4 roles: **owner / editor / commenter / viewer**, checked by
  the server on every change (`beforeSync` + `touchedScopes`), not only in the interface.
- Invite links with a role, an expiry and a number of uses.
- Sheet **locks** (only the owner edits a locked sheet), comments, presence, history.

What is missing: finding people without a link, groups of people, and rights that differ from
sheet to sheet, above all **read** rights (hiding a sheet).

## 1. The rules (what the user sees)

| Level     | Sees the sheet | Comments | Edits |
| --------- | :------------: | :------: | :---: |
| Hidden    |       –        |    –     |   –   |
| Viewer    |       ✓        |    –     |   –   |
| Commenter |       ✓        |    ✓     |   –   |
| Editor    |       ✓        |    ✓     |   ✓   |

- Everyone on a project has a **project role** (the default for every sheet).
- The owner can add **sheet rules** for a person or a team: _Hidden / Viewer / Commenter /
  Editor_. A rule can **lower** the role (hide the controller from Bob) or **raise** it (Alice
  is a viewer of the project but an editor of sheet 2).
- A rule applies to the sheet **and its sub-sheets**, unless a sub-sheet has its own rule
  (like folder permissions).
- Priority: the person's own rule > the rule of one of their teams (the highest team rule wins)
  > the project role. The **owner** always has full rights.
- A hidden sheet appears on its parent as a closed block, "🔒 Restricted", and is left out of
  the presentation, the PDF and the exports of that person.

One pure function in `packages/core` computes the effective level:

```ts
effectiveLevel(userId, sheetId, { projectRoles, teamsOf, sheetRules, sheetTree }): Level;
```

The server enforces it; the interface uses the same function to show or grey out actions.

## 2. Contacts ("friends")

- Every account gets a **handle** (`@tom`), unique, chosen at sign-up (editable).
- **Add a contact** by handle or by exact email. No public directory: you cannot list the users
  (privacy, no email harvesting).
- A request → the other person accepts or declines; they can also **block**.
- The contact list is used everywhere you pick people: add to a project, to a team, @mentions
  in comments (later).
- A **notifications** bell: contact requests, "Alice added you to _Buck converter_",
  "you were given edit rights on sheet 2", replies to your comments.

## 3. Teams

- Create a team (e.g. "PFC lab group 4"), add contacts. Team roles: **owner / admin / member**
  (admins manage the members).
- A team can be **added to a project** with a role, like a person: everybody in the team gets it,
  and people who join the team later get it too.
- Dashboard: filters "Mine / Shared with me / Team X".
- Later: team projects (owned by the team, they stay when a member leaves) and a team library of
  symbols and templates.

## 4. Share dialog, version 2

```
┌ Share "Buck converter" ──────────────────────────────────────┐
│ [ Add people or teams…  (@handle, email, team)  ] [Editor ▾] │
│                                                              │
│ People with access                                           │
│  (T) Tom Rousseau        Owner                               │
│  (A) Alice Martin        Viewer ▾   · edits "Controller"     │
│  (B) Bob Leroy           Editor ▾   · hidden: "Controller"   │
│  (L) Lab group 4 (team)  Commenter ▾                         │
│                                                              │
│ ▸ Sheet access (advanced)                                    │
│   Sheet            Alice    Bob      Lab group 4             │
│   Power stage      —        —        —                       │
│   └ Controller     Editor   Hidden   —                       │
│                                                              │
│ Invite link: [Viewer ▾] [Copy link]                          │
└──────────────────────────────────────────────────────────────┘
```

"—" means "project role" (inherited). The Sheets tab shows a small lock or eye icon on
restricted sheets, and "Only you, Alice can edit this sheet" in the sheet properties.

## 5. The hard part: hiding a sheet for real

Today a project is **one** Yjs document, sent **whole** to every member. Hiding a sheet only in
the interface would be fake security: the data would still reach the browser. So the document
has to be **split**:

- a **project document** (the "manifest"): name, standard, the sheet tree (ids, parent, block),
  project symbols;
- one **document per sheet**: its elements and its comments.

The server sends a sheet document **only** to people who may see that sheet (Hocuspocus handles
several documents on one WebSocket). Checks per document:

| Document | Read        | Write                                               |
| -------- | ----------- | --------------------------------------------------- |
| manifest | all members | structure changes: editor of the parent sheet       |
| sheet    | ≥ Viewer    | elements: Editor; comments: Commenter; locks: owner |

Consequences to handle:

- **Names**: sheet names move into the sheet documents, so a hidden sheet shows only
  "🔒 Restricted". The block title on the parent sheet stays visible (the parent's editors
  write it).
- **Undo**: a `Y.UndoManager` follows one document → one manager per document and a combined
  undo stack (ordered by time).
- **Offline cache**: the browser keeps only what it may see; when a right is removed, the
  server closes that document and the browser deletes its copy.
- **Operations across sheets** (moving a selection into a new block, deleting a block with its
  sub-sheets, copy/paste between sheets) need edit rights on every sheet they touch.
- **History**: a version = the manifest + every sheet document; only the owner restores.
- **Migration**: a server script splits existing projects; local projects keep a single
  document and are split when they are shared.

## 6. Server data (SQLite)

```sql
users           + handle TEXT UNIQUE
contacts        (user_id, contact_id, status: pending|accepted|blocked, created_at)
teams           (id, name, created_by, created_at)
team_members    (team_id, user_id, role: owner|admin|member)
members         (project_id, principal: user|team, principal_id, role)   -- replaces members
sheet_rules     (project_id, sheet_id, principal: user|team, principal_id,
                 level: hidden|viewer|commenter|editor)
documents       (project_id, doc: 'manifest' | sheet_id, state)          -- one row per document
notifications   (id, user_id, kind, payload JSON, created_at, read_at)
```

New API: `/api/contacts` (request, accept, decline, block, list), `/api/teams` (+ members),
`/api/projects/:id/members` for users **and** teams, `/api/projects/:id/sheet-rules`,
`/api/notifications`. Rate limits on contact requests.

## 7. Delivery, in steps that are each useful on their own

| Step | Content                                                                | Size   |
| ---- | ---------------------------------------------------------------------- | ------ |
| 1    | Handles, contacts, notifications; add a contact to a project directly  | medium |
| 2    | Teams; a team as a project member; dashboard filters                   | medium |
| 3    | Share dialog v2 + **per-sheet edit rights** (raise or lower; no split) | medium |
| 4    | **Per-sheet read rights**: split documents, restricted blocks, cache   | large  |
| 5    | Email invitations, @mentions in comments, activity feed, audit log     | medium |

Step 3 already gives "Alice may only edit sheet 2" without touching the document format, because
the server already knows which sheets an update touches. Step 4 adds "Bob must not see it".

Tests at each step: unit tests of `effectiveLevel` (every combination), server tests of each
rule (a refused change is refused by the server, not only hidden in the interface), and an
end-to-end test with three browsers (owner, restricted editor, viewer with a hidden sheet).

## Decisions to take

1. Find people by **@handle**, by **email**, or both? (Proposed: both, exact match only.)
2. A hidden sheet: show the block title, or only "🔒 Restricted"? (Proposed: the block title,
   since the parent's editors chose it; the sheet's own content and name stay hidden.)
3. Can a sheet rule **raise** a project role (viewer → editor of sheet 2)? (Proposed: yes.)
4. Teams: members only at first, team-owned projects later? (Proposed: yes.)
