/** Test client for a running server: HTTP calls, accounts, and projects opened like the web app. */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Project, docName } from '@overleagger/core';
import { expect } from 'vitest';
import * as Y from 'yjs';

export function testClient(base: string, emailDomain = 'lab.test') {
  const providers: { destroy(): void }[] = [];
  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const res = await fetch(`http://${base}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: (await res.json()) as T };
  }

  async function signup(name: string) {
    const r = await api<{ token: string; user: { id: string } }>(
      'POST',
      '/api/auth/signup',
      undefined,
      {
        email: `${name.toLowerCase()}@${emailDomain}`,
        name,
        password: 'correct horse battery',
      },
    );
    expect(r.status).toBe(200);
    return r.data;
  }

  async function until(fn: () => boolean, ms = 5000) {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /**
   * Open a project like the web app: its root document and one document per sheet, all on one
   * WebSocket. `closed()` is the last refusal reason; `denied` the sheets the server refused.
   */
  async function connect(projectId: string, token: string) {
    const socket = new HocuspocusProviderWebsocket({ url: `ws://${base}/collab` });
    providers.push(socket);
    let closed: string | null = null;
    const denied = new Set<string>();
    const byName = new Map<string, HocuspocusProvider>();
    const open = (doc: Y.Doc, sheetId?: string) => {
      const provider = new HocuspocusProvider({
        websocketProvider: socket,
        name: docName(projectId, sheetId),
        document: doc,
        token,
        onAuthenticationFailed: () => denied.add(sheetId ?? 'root'),
        onClose: ({ event }) => {
          // Rights changed: join again, like the web app does.
          if (event.reason === 'Reset Connection') {
            void provider.sendToken().then(() => provider.startSync());
            return;
          }
          // The refusal reason travels with the close event.
          if (event.reason) closed = event.reason;
        },
      });
      provider.attach();
      providers.push(provider);
      byName.set(sheetId ?? 'root', provider);
      return provider;
    };
    const rootDoc = new Y.Doc();
    const project = new Project(rootDoc, {
      sheetDoc: (id) => {
        const d = new Y.Doc();
        open(d, id);
        return d;
      },
    });
    const provider = open(rootDoc);
    await until(() => provider.isSynced && Boolean(project.rootSheetId));
    const settled = () =>
      [...byName].every(([k, p]) => denied.has(k) || (p.isSynced && p.unsyncedChanges === 0));
    await until(settled);
    return { project, provider, settled, denied, closed: () => closed };
  }

  return {
    api,
    signup,
    until,
    connect,
    close: () => {
      for (const p of providers) p.destroy();
    },
  };
}
