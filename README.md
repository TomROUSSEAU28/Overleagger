# Overleagger

**A hierarchical whiteboard for electronics, power electronics and control diagrams** — like
draw.io or CircuitPaint, but made for engineers: symbols that follow the **IEC (EU)** and
**ANSI (US)** standards, wires that snap to a grid with **automatic junction dots**, **blocks you
can open** like sub-sheets, and a **graphite-on-paper / LaTeX** look.

![Status](<https://img.shields.io/badge/status-phase%201%20(core%20editor)-2f5d9e>)

## Features (phase 1)

- **Grid canvas**: pan (Space / middle mouse / wheel), zoom (Ctrl + wheel, pinch), fit (`F`).
- **129 symbols**, each in IEC and ANSI style:
  - passives, transformers (2/3 windings, centre tap, dot convention, iron/ferrite core);
  - sources (DC, AC, pulse, controlled, 3-phase, PV), grounds and rails;
  - diodes (Schottky, Zener, LED, TVS…), BJT, JFET, GaN HEMT;
  - **MOSFET N/P, enhancement or depletion, 3 or 4 terminals, with or without body
    (freewheeling) diode, with or without circle**; **IGBT with/without anti-parallel diode**;
  - thyristors (SCR, GTO, IGCT, TRIAC, DIAC), diode bridge, half/full bridge, 3-phase inverter,
    AC/DC, DC/DC, DC/AC, AC/AC converter blocks, gate driver;
  - switches, relays, contactor, breaker, machines (DC, induction, PMSM, BLDC), meters and sensors;
  - **control blocks** with LaTeX: sum junction, gain, transfer function, PI, PID, integrator,
    delay, ZOH, saturation, relay, rate limiter, PWM, Clarke/Park, PLL, mux…
- **Wires**: orthogonal routing, `/` flips the bend, drag a pin to start a wire, drag a segment to
  move it, wires stretch when parts move. **Junction dots appear automatically** where 3 or more
  connections meet (crossing wires are not connected).
- **Signal lines** with arrows for block diagrams (same automatic branch points).
- **Hierarchy**: draw a block, double-click it to open its sheet, add sheet ports: each port becomes
  a pin of the block. Breadcrumbs + sheet tree. Blocks can be nested without limit.
- **LaTeX everywhere**: `$…$` in texts, values and labels, rendered with MathJax (vector paths).
- **Group / ungroup**, z-order, lock, copy / cut / paste (also between projects), duplicate,
  rotate, mirror, nudge, undo / redo.
- **Customisable colours** (graphite, pencil, blue, red… or any colour), stroke width, dashes;
  **paper** and **blackboard** themes.
- **Keyboard shortcuts** for everything, **re-bindable** in a settings dialog (`?` shows them all).
- **Projects** saved automatically in the browser (IndexedDB), `.olg` project files to back up / share.
- **Export**: SVG, PNG and a **smart PDF** — one page per sheet, bookmarks that mirror the
  hierarchy, clickable blocks that jump to their sub-sheet and a link back to the parent.

## Getting started

Requirements: Node ≥ 22.12 and pnpm 10.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Other commands:

| Command          | What it does                            |
| ---------------- | --------------------------------------- |
| `pnpm build`     | Production build in `apps/web/dist`     |
| `pnpm test`      | Unit tests (Vitest)                     |
| `pnpm test:e2e`  | End-to-end tests (Playwright, Chromium) |
| `pnpm typecheck` | TypeScript checks of every package      |
| `pnpm lint`      | ESLint                                  |
| `pnpm format`    | Prettier                                |

The build is a static site (`base: './'`), so it can be hosted on GitHub Pages or any static host.

## Architecture

```
packages/symbols   Symbol library: primitives in grid units, IEC/ANSI variants, options, search
packages/core      Document model (Yjs), geometry, connectivity (junctions, nets), hierarchy,
                   move/rotate/mirror, groups, clipboard, reference designators
apps/web           React + Vite editor: SVG canvas, tools, panels, shortcuts, LaTeX, export
```

- The document is a **Yjs** CRDT (`meta`, `sheets`, `symbols`). Each element is a `Y.Map`, so the
  future real-time collaboration server only has to sync the document — no rewrite.
- Junction dots are **computed, never stored**: at every wire end or pin, a wire end counts 1
  branch, a wire passing through counts 2, a pin counts 1; three or more branches → a dot.
- Symbols are plain data (`line`, `poly`, `circle`, `arc`, `rect`, `path`, `text`) built by small
  functions, so one MOSFET definition gives every variant.

## Roadmap

- **Phase 2 — Whiteboard**: freehand pencil, shapes, images, sticky notes, link buttons,
  waveform / oscillogram generator, frames, "selection → block", **custom symbol editor**.
- **Phase 3 — Presentation & smart PDF**: presentation mode with laser pointer, URL buttons and
  comments in the PDF, **CircuiTikZ export**.
- **Phase 4 — Collaboration**: self-hosted server (Hocuspocus + SQLite, Docker), invitations,
  roles (owner / editor / commenter / viewer), live cursors, comments, version history.
- **Phase 5 — Extras**: SPICE netlist, BOM.

## Licences

Code: to be decided by the project owner. Fonts: Computer Modern Unicode (SIL Open Font Licence,
see `apps/web/public/fonts/OFL.txt`).
