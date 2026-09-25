/**
 * Version of Circuit Notebook and what changed in each one (newest first). Shown in the app
 * ("What's new") and on the /changelog/ page. When releasing: bump VERSION and add an entry.
 */

export interface Release {
  version: string;
  /** ISO date. */
  date: string;
  title: string;
  added: string[];
  fixed: string[];
}

export const VERSION = '0.9.0';
/** Shown next to the version while the app is in beta. */
export const STAGE = 'beta';

export const CHANGELOG: Release[] = [
  {
    version: '0.9.0',
    date: '2026-09-25',
    title: 'Animated presentations',
    added: [
      'Animations in the presentation: make things appear or disappear (fade, pop, rise, zoom, wipe), draw the eye (pulse, shake, glow), change colour, move, change state (a switch closes), animate a waveform (duty cycle, amplitude, damping…) or type a text — as the slide opens or on a click.',
      'Frames choose their transition (camera glide, fade, slide in, zoom, cut) and show their build order, click by click, with a Preview button.',
      'The buck converter example is now an animated presentation.',
      'Switches, contactors, push buttons, changeover and ideal switches have an actuated position.',
      'New symbol: a transformer winding on its own, to draw the primary and the secondaries apart.',
      'Drawing order: bring forward or send backward one step, besides to the front / to the back.',
      'A user manual, this list of versions, and the version number in the app.',
    ],
    fixed: [
      'Opening a link during a presentation no longer ends it.',
      'The blank screen button shows when the screen is blanked.',
      'The LDO regulator and the gate driver are redrawn with readable pin names.',
      'Clearer signal switch block; bigger texts in the rate limiter and sample & hold blocks.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-09-25',
    title: 'Wires that follow',
    added: [
      'Click a selected wire again to pick one segment, then drag it or delete only it.',
      'A math bar in text editors: $…$ around the text (Ctrl+M), fractions, indices, roots, Greek letters and symbols.',
      'A new homepage: a notebook whose pages turn as you scroll.',
      'A richer buck example: waveforms, pencil notes, sticky note and frames.',
    ],
    fixed: [
      'Junction dots, and wires connected in the middle of a moved wire, follow it.',
      'A moved wire stays attached to the parts that do not move.',
      'Rotating or mirroring wires keeps the wires connected to them.',
      'Hand-drawn arrows follow their curve, and their heads meet the line.',
      'Thick arrows no longer poke through their head.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-09-24',
    title: 'On your phone',
    added: [
      'A phone version: the drawing takes the whole screen, panels open as drawers, pinch to zoom, drag with a finger, actions on the selection.',
    ],
    fixed: [],
  },
  {
    version: '0.6.0',
    date: '2026-09-24',
    title: 'Open beta',
    added: [
      'Open beta: a few projects per account on the server, unlimited projects in your browser.',
      'Contact form, support button, privacy policy and legal notice.',
      'Delete my account, from the menu of your name.',
    ],
    fixed: ['Contact messages are kept one year at most.'],
  },
  {
    version: '0.5.0',
    date: '2026-09-24',
    title: 'Working together, safely',
    added: [
      'Friends and teams: share a project with a whole team.',
      'Rights per sheet: view, comment or edit, for a person or a team.',
      'Hidden sheets are only sent to who may see them.',
      'Side panels you can resize and hide; a project dashboard with previews.',
    ],
    fixed: ['Comments: Enter posts, resolving and deleting can be undone.'],
  },
  {
    version: '0.4.0',
    date: '2026-09-24',
    title: 'Circuit Notebook',
    added: [
      'New name, logo and homepage.',
      'Leave elements out of the presentation or the export; export only the selection.',
      'Undo and redo show the sheet where the change was made.',
    ],
    fixed: ['A round of bug fixes across the editor.'],
  },
  {
    version: '0.3.0',
    date: '2026-09-24',
    title: 'Collaboration',
    added: [
      'Accounts, projects on the server, sharing, live presence, comments and version history.',
      'Flowcharts: connection points on shapes, connectors that stay attached, ISO 5807 shapes.',
    ],
    fixed: [],
  },
  {
    version: '0.2.0',
    date: '2026-09-24',
    title: 'Present and export',
    added: [
      'Presentation mode: frames become slides, click a block to dive into it, laser pointer and pen.',
      'Smart PDF (one page per sheet, with links) and CircuiTikZ export for LaTeX.',
      'Transformers with polarity dots, several secondaries and center taps.',
    ],
    fixed: ['Reference labels follow rotation and mirroring, like in LTspice.'],
  },
  {
    version: '0.1.0',
    date: '2026-09-24',
    title: 'First sketch',
    added: [
      'Hierarchical schematic editor: blocks, sheets and ports.',
      'IEC and US symbol libraries; wires with automatic junction dots.',
      'Whiteboard tools: shapes, arrows, sticky notes, pencil, images and waveforms.',
      'Custom symbol editor and a personal library of templates.',
    ],
    fixed: [],
  },
];

/** "25 September 2026". */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "v0.9 beta" (the patch number only when it is not 0). */
export function versionLabel(v = VERSION): string {
  const [maj, min, patch] = v.split('.');
  return `v${maj}.${min}${patch && patch !== '0' ? `.${patch}` : ''}`;
}
