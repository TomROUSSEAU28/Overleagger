/**
 * Friends and teams of the signed-in person (server accounts only): requests received and
 * sent, teams with their members. Loaded on demand and after every change.
 */
import { create } from 'zustand';
import { api, useCloud } from './cloud';

export interface PublicPerson {
  id: string;
  name: string;
  handle: string;
  color: string;
}

export interface TeamInfo {
  id: string;
  name: string;
  ownerId: string;
  members: PublicPerson[];
}

interface FriendLists {
  friends: PublicPerson[];
  incoming: PublicPerson[];
  outgoing: PublicPerson[];
}

interface Social extends FriendLists {
  teams: TeamInfo[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Run a friends call and keep its answer (the server returns the new lists). */
  friendsCall: (method: string, path: string, body?: unknown) => Promise<void>;
  teamsCall: (method: string, path: string, body?: unknown) => Promise<void>;
}

const empty: FriendLists & { teams: TeamInfo[] } = {
  friends: [],
  incoming: [],
  outgoing: [],
  teams: [],
};

export const useSocial = create<Social>((set) => ({
  ...empty,
  loaded: false,
  load: async () => {
    if (!useCloud.getState().user) return set({ ...empty, loaded: false });
    const [f, t] = await Promise.all([
      api<FriendLists>('GET', '/api/friends'),
      api<{ teams: TeamInfo[] }>('GET', '/api/teams'),
    ]);
    set({ ...f, teams: t.teams, loaded: true });
  },
  friendsCall: async (method, path, body) => {
    set(await api<FriendLists>(method, path, body));
  },
  teamsCall: async (method, path, body) => {
    set({ teams: (await api<{ teams: TeamInfo[] }>(method, path, body)).teams });
  },
}));

// Signing in or out reloads (or clears) the lists.
useCloud.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id)
    void useSocial
      .getState()
      .load()
      .catch(() => undefined);
});
