import type { Project } from '@overleagger/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** `.olg` project file: a zip with the Yjs state and a readable JSON snapshot. */
export const OLG_FORMAT = 'overleagger-project';

export interface OlgManifest {
  format: typeof OLG_FORMAT;
  version: 1;
  name: string;
  exportedAt: string;
}

export function encodeOlg(name: string, update: Uint8Array, json: unknown): Uint8Array {
  const manifest: OlgManifest = {
    format: OLG_FORMAT,
    version: 1,
    name,
    exportedAt: new Date().toISOString(),
  };
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'document.yjs': update,
    'snapshot.json': strToU8(JSON.stringify(json, null, 2)),
  });
}

export function encodeProjectOlg(project: Project): Uint8Array {
  return encodeOlg(project.getMeta().name, project.encodeState(), project.toJSON());
}

export function decodeOlg(data: Uint8Array): { manifest: OlgManifest; update: Uint8Array } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('Not an Overleagger file (.olg).');
  }
  const m = files['manifest.json'];
  const doc = files['document.yjs'];
  if (!m || !doc) throw new Error('Not an Overleagger file (.olg).');
  const manifest = JSON.parse(strFromU8(m)) as OlgManifest;
  if (manifest.format !== OLG_FORMAT) throw new Error('Unknown file format.');
  return { manifest, update: doc };
}

export function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (s: string) =>
  s
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'project';
