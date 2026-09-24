import { Project, addComponent, makeContext } from '@overleagger/core';
import { describe, expect, it } from 'vitest';
import { decodeOlg, encodeProjectOlg } from './olg';

describe('.olg files', () => {
  it('round-trips a project', () => {
    const p = Project.create('Round trip');
    addComponent(p, p.rootSheetId, 'resistor', 10, 20, makeContext(p));
    const { manifest, update } = decodeOlg(encodeProjectOlg(p));
    expect(manifest.name).toBe('Round trip');
    expect(Project.fromUpdate(update).toJSON()).toEqual(p.toJSON());
  });

  it('rejects other files', () => {
    expect(() => decodeOlg(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
