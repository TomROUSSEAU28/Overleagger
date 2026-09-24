import { create } from 'zustand';
import {
  buildLookup,
  defaultKeymap,
  loadKeymap,
  saveKeymap,
  type ActionId,
  type Keymap,
} from './keymap';

interface KeymapState {
  keymap: Keymap;
  lookup: Map<string, ActionId>;
  setKeys: (id: ActionId, keys: string[]) => void;
  reset: () => void;
}

export const useKeymap = create<KeymapState>((set, get) => {
  const keymap = loadKeymap();
  return {
    keymap,
    lookup: buildLookup(keymap),
    setKeys: (id, keys) => {
      const km = { ...get().keymap, [id]: keys };
      saveKeymap(km);
      set({ keymap: km, lookup: buildLookup(km) });
    },
    reset: () => {
      const km = defaultKeymap();
      saveKeymap(km);
      set({ keymap: km, lookup: buildLookup(km) });
    },
  };
});
