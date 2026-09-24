import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  buildLookup,
  conflicts,
  defaultKeymap,
  eventToCombo,
  normalizeCombo,
} from './keymap';

const ev = (
  key: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('keymap', () => {
  it('normalizes keyboard events', () => {
    expect(eventToCombo(ev('Z', { ctrlKey: true, shiftKey: true }))).toBe('mod+shift+z');
    expect(eventToCombo(ev('z', { metaKey: true }))).toBe('mod+z');
    expect(eventToCombo(ev('?', { shiftKey: true }))).toBe('?');
    expect(eventToCombo(ev('ArrowUp', { altKey: true }))).toBe('alt+arrowup');
    expect(eventToCombo(ev(' '))).toBe('space');
  });

  it('orders modifiers canonically', () => {
    expect(normalizeCombo('shift+mod+Z')).toBe('mod+shift+z');
    expect(normalizeCombo('mod++')).toBe('mod++');
  });

  it('has no conflicting default shortcuts', () => {
    const km = defaultKeymap();
    for (const a of ACTIONS)
      for (const k of a.keys) expect(conflicts(km, k, a.id), `${a.id} ${k}`).toEqual([]);
  });

  it('maps combos to actions', () => {
    const lookup = buildLookup(defaultKeymap());
    expect(lookup.get('mod+z')).toBe('edit.undo');
    expect(lookup.get('w')).toBe('tool.wire');
  });
});
