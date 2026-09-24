# SchemaBoard

> Power electronics & control diagram editor — schematics, block diagrams and whiteboards in one place.

_Formerly “Overleagger”. The internal identifiers (package names, `.olg` files, browser storage)
keep the old name so existing projects and files still open._

**A hierarchical whiteboard for electronics, power electronics and control diagrams** — like
draw.io or CircuitPaint, but made for engineers: symbols that follow the **IEC (EU)** and
**ANSI (US)** standards, wires that snap to a grid with **automatic junction dots**, **blocks you
can open** like sub-sheets, and a **graphite-on-paper / LaTeX** look.

![Status](<https://img.shields.io/badge/status-phase%203%20(presentation%20%26%20smart%20PDF)-2f5d9e>)

## Features

### Schematics (phase 1)

- **Grid canvas**: pan (Space / middle mouse / wheel), zoom (Ctrl + wheel, pinch), fit (`F`).
- **About 150 symbols**, each in IEC and ANSI style:
  - passives, coupled inductors, **transformers with 1 to 4 secondaries** (each winding plain or
    centre-tapped, polarity dot at the top, bottom or none), single-line and 3-phase Y/Δ,
    shunt, LDR, ferrite bead;
  - sources (DC, AC, pulse, controlled, 3-phase, PV), grounds and rails;
  - diodes (Schottky, Zener, LED, TVS, varicap…), BJT, JFET, phototransistor, **GaN HEMT
    (e-mode / d-mode)**;
  - **MOSFET N/P, enhancement or depletion, 3 or 4 terminals, with or without body
    (freewheeling) diode, with or without circle**; **IGBT with/without anti-parallel diode**;
  - thyristors (SCR, GTO, IGCT, TRIAC, DIAC), single- and three-phase diode bridges, half/full
    bridge and 3-phase inverter (**adjustable gap between high/low side and between legs**),
    AC/DC… converter blocks, gate driver, isolation barrier;
  - switches, ideal controlled switch, relays, contactor, breaker, machines, meters, sensors and
    probes, generic IC, regulator, ADC/DAC, logic gates;
  - **control blocks** with LaTeX: sum junction, gain, transfer functions, PI, PID, state space,
    integrators, delay, ZOH, saturation, relay, rate limiter, PWM, Clarke/Park, PLL, mux/demux…
- **Reference labels follow the rotation** (like LTspice): a half turn or a mirror moves R1 / V1
  to the opposite side; if a pin is in the way the label goes to the other side.
- **Every part has a size option** (×1.5, ×2, ×3 when the pins stay on the grid).
- **Wires**: orthogonal routing, `/` flips the bend, drag a pin to start a wire, drag a segment to
  move it, wires stretch when parts move **or rotate**. **Junction dots appear automatically**
  where 3 or more connections meet (crossing wires are not connected).
- **Hierarchy**: blocks open like sub-sheets, sheet ports become block pins, unlimited nesting,
  **"move selection into a new block"** (`Ctrl Shift B`).
- **Mirror / rotate everything**: parts, sheet ports and net labels (their shape goes to the
  other side of the connection point), text (alignment), triangles, images.
- **My library** (personal, shared by all your projects, stored in the browser for now):
  - **Your own templates**: select part of a drawing → _Save selection as template_ (Templates tab
    or the bookmark button in the properties). Pick a category or type a new one. Click or drag a
    template to insert it; custom symbols it uses come with it.
  - **Your own symbols**: the symbol editor saves to _My library_ (every project) or to _This
    project only_, in any category you type.
  - Export / import the whole library as an `.olglib` file (ready for future user accounts).

### Whiteboard (phase 2)

- **Pencil** (pen pressure, highlighter), **eraser**, **shapes** (rectangle, ellipse, diamond,
  triangle) with an optional **hand-drawn look**, **lines and arrows** you can curve.
- **Sticky notes**, **text with frames** (box, rounded, double, underline) and LaTeX everywhere.
- **Images**: image tool, drag and drop, or paste from the clipboard (downscaled automatically).
- **Link buttons** to a web page / online PDF or to another sheet (Ctrl+click to follow; they stay
  clickable in the PDF).
- **Waveform generator** (oscillograms and chronograms): sine, square, PWM, triangle, sawtooth,
  rectified, DC + ripple, 1st/2nd-order step responses, exponential, custom points; presets such
  as buck chronogram, PWM carrier, three-phase voltages.
- **Frames** to organise the board (the base of the coming presentation mode).
- **Custom symbol editor**: lines, polylines, rectangles, circles, texts and pins on a grid; start
  from any built-in symbol ("Customize symbol…") and save it to your library or to the project.
- **Align and distribute**, **project colour palette**, fills, three themes: **cream lab
  notebook**, **white whiteboard** and **blackboard**, with drafting-style ("non-photo blue")
  selection marks.
- **Small animations** that stay discreet: parts pop in when placed (with a graphite ring), settle
  when dropped, fade out when deleted; new junction dots pop; a blue ring marks a new connection;
  smooth zoom-to-fit. Toggle them with the ✦ button (they are off automatically when the system
  asks for reduced motion).

- **Links on anything** (shapes, images, text, notes, parts, lines): a web page / online PDF or
  a sheet of the project. Ctrl+click follows it; a small ↗ tag marks linked elements.

### Presentation (phase 3)

- **Present** (`F5`): the frames of every sheet become slides (reading order), sheets without
  frames are shown whole. Smooth zoom between slides.
- **Click a block to dive into its sub-sheet** (zoom transition), `Backspace` to come back up;
  links and sheet ports are clickable too.
- **Laser pointer** (`L`), **pen** (`P`, nothing is saved, `C` clears), **blank screen** (`B`),
  `←/→`, `Space`, `Home/End`, `Esc` to leave.

### Files and export

- Projects saved automatically in the browser (IndexedDB), `.olg` project files to back up/share.
- **Smart PDF**: one page per sheet, bookmarks that mirror the hierarchy (with frames), clickable
  blocks → sub-sheet, **sheet ports → parent sheet**, links on any element, a header link back to
  the parent sheet, and **sticky notes as PDF comments**.
- **SVG and PNG** of the current sheet.
- **CircuiTikZ / LaTeX**: the current sheet as `circuitikz` code (complete document or just the
  environment). R, C, L and diodes use native CircuiTikZ symbols; every other part is drawn
  exactly as on screen, with `$…$` math kept as LaTeX.
- **Keyboard shortcuts** for everything, re-bindable (`?` shows them all).

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

The build is a static site (`base: './'`), so it can be hosted on any static host. The workflow
`.github/workflows/pages.yml` publishes it on **GitHub Pages** on every push to `main`
(one-time setup: repository _Settings → Pages → Source: GitHub Actions_).

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

- ~~Phase 1 — Core editor~~ ✔
- ~~Phase 2 — Whiteboard~~ ✔
- ~~Phase 3 — Presentation & smart PDF, CircuiTikZ export~~ ✔
- **Phase 4 — Collaboration**: self-hosted server (Hocuspocus + SQLite, Docker), invitations,
  roles (owner / editor / commenter / viewer), live cursors, comments, version history.
- **Phase 5 — Extras**: SPICE netlist, BOM.

## Licences

Code: to be decided by the project owner. Fonts: Computer Modern Unicode (SIL Open Font Licence,
see `apps/web/public/fonts/OFL.txt`).
