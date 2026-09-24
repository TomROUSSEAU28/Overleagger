import { useEffect } from 'react';
import { AuthPage, InvitePage } from './cloud/AccountUI';
import { useCloud } from './cloud/cloud';
import { startLibrarySync } from './cloud/librarySync';
import { Loading } from './brand/Logo';
import { Dashboard } from './dashboard/Dashboard';
import { seedBuckExample } from './examples/buck';
import { createProject } from './storage/projects';
import { EditorPage } from './editor/EditorPage';
import { PeoplePage } from './cloud/PeoplePage';
import { Gallery } from './gallery/Gallery';
import { parseHash, useHash } from './router';
import { useUserLib } from './storage/userLibrary';
import { useUI } from './store/ui';

/** `#/example`: create the buck converter example and open it (link from the homepage). */
function ExamplePage() {
  useEffect(() => {
    void createProject('Buck converter example', 'IEC', seedBuckExample).then((id) =>
      location.replace(`#/p/${id}`),
    );
  }, []);
  return <Loading text="Preparing the example…" />;
}

export function App() {
  const route = parseHash(useHash());
  const theme = useUI((s) => s.theme);
  const animations = useUI((s) => s.animations);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.anim = animations ? 'on' : 'off';
  }, [animations]);
  useEffect(() => {
    void useUserLib.getState().load();
    void useCloud.getState().init();
    startLibrarySync();
  }, []);
  switch (route.page) {
    case 'editor':
      return <EditorPage source={{ kind: 'local', id: route.projectId }} />;
    case 'cloud':
      return <EditorPage source={{ kind: 'cloud', id: route.projectId }} />;
    case 'invite':
      return <InvitePage token={route.token} />;
    case 'auth':
      return <AuthPage token={route.token} />;
    case 'gallery':
      return <Gallery />;
    case 'people':
      return <PeoplePage />;
    case 'example':
      return <ExamplePage />;
    default:
      return <Dashboard />;
  }
}
