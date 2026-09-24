import { useEffect } from 'react';
import { Dashboard } from './dashboard/Dashboard';
import { EditorPage } from './editor/EditorPage';
import { Gallery } from './gallery/Gallery';
import { parseHash, useHash } from './router';
import { useUserLib } from './storage/userLibrary';
import { useUI } from './store/ui';

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
  }, []);
  switch (route.page) {
    case 'editor':
      return <EditorPage key={route.projectId} projectId={route.projectId} />;
    case 'gallery':
      return <Gallery />;
    default:
      return <Dashboard />;
  }
}
