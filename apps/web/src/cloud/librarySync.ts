/**
 * Personal library ↔ account: when signed in, the symbols and templates of "My library" are
 * merged with the copy stored on the server, then every change is uploaded (debounced).
 */
import { parseLibraryFile, useUserLib } from '../storage/userLibrary';
import { api, useCloud } from './cloud';

let started = false;

export function startLibrarySync() {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ready = false;

  const upload = () => {
    if (!ready || !useCloud.getState().user) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void api('PUT', '/api/library', { library: useUserLib.getState().exportFile() }).catch(
        () => undefined,
      );
    }, 1500);
  };

  const download = async () => {
    ready = false;
    if (!useCloud.getState().user) return;
    await useUserLib.getState().load();
    try {
      const r = await api<{ library: unknown }>('GET', '/api/library');
      if (r.library) useUserLib.getState().importFile(parseLibraryFile(JSON.stringify(r.library)));
      ready = true;
      upload();
    } catch {
      // offline: try again at the next sign-in
    }
  };

  useCloud.subscribe((s, prev) => {
    if (s.user?.id !== prev.user?.id) void download();
  });
  useUserLib.subscribe((s, prev) => {
    if (s.symbols !== prev.symbols || s.templates !== prev.templates) upload();
  });
  void download();
}
