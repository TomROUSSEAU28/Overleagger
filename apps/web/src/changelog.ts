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

export const VERSION = '0.1.0';
/** Shown next to the version while the app is in beta. */
export const STAGE = 'beta';

export const CHANGELOG: Release[] = [
  {
    version: '0.1.0',
    date: '2026-09-25',
    title: 'First open beta',
    added: [
      'Hierarchical schematic editor: blocks, sheets and ports; IEC and US symbol libraries; wires with automatic junction dots.',
      'Wires that follow what they are attached to; click a selected wire again to pick one piece (cut at the junctions), then drag it or delete it.',
      'Text and LaTeX everywhere, with a math bar ($…$, fractions, indices, Greek letters…).',
      'Whiteboard tools: shapes and flowcharts, arrows, sticky notes, pencil, images, waveforms and frames.',
      'Your own symbols, templates and a personal library.',
      'Presentation mode with animations (appear, emphasis, colour, move, change state, animated waveforms, typed text), transitions and slide order per frame, laser pointer and pen.',
      'Animated currents: dots, electrons, arrows or comets flowing through the selected wires in the presentation, with DC, AC, ramps, ripple or PWM currents that can reverse.',
      'Overview, then zooms: frames inside a frame each build up their own part; coming back from a block or a link returns to the same click.',
      'Exports: smart PDF, PNG, SVG and CircuiTikZ for LaTeX.',
      'Working together: accounts, sharing with people and teams, rights per sheet, live presence, comments and history.',
      'An example project that walks through all of it, as a presentation.',
      'Accounts confirm their e-mail with a code, and a forgotten password can be changed the same way.',
      'A phone version, a user manual, and this list of versions.',
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
