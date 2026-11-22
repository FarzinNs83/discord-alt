import { create } from 'zustand';
import type { SpaceEvent } from '@patogh/shared';
import { getApiForOrigin } from '../utils/crossStoreResolvers';

const keyOf = (spaceId: string, origin: string) => `${origin}|${spaceId}`;

interface EventState {
  /** Upcoming events per space (`origin|spaceId`), soonest first. Absent until first loaded. */
  bySpace: Map<string, SpaceEvent[]>;
  load: (spaceId: string, origin: string) => Promise<void>;
  /** A `space_events_changed` push: refetch, but only spaces someone has looked at. */
  refreshIfLoaded: (spaceId: string, origin: string) => void;
  rsvp: (event: SpaceEvent, origin: string, going: boolean) => Promise<void>;
}

const NONE: SpaceEvent[] = [];

/** The events held for a space, or a stable empty list. */
export function eventsFor(bySpace: Map<string, SpaceEvent[]>, spaceId: string, origin: string): SpaceEvent[] {
  return bySpace.get(keyOf(spaceId, origin)) ?? NONE;
}

export const useEventStore = create<EventState>((set, get) => {
  const put = (spaceId: string, origin: string, events: SpaceEvent[]) =>
    set((s) => ({ bySpace: new Map(s.bySpace).set(keyOf(spaceId, origin), events) }));

  return {
    bySpace: new Map(),

    load: async (spaceId, origin) => {
      try {
        put(spaceId, origin, await getApiForOrigin(origin).spaces.events(spaceId));
      } catch {
        // An older server has no events route; the card just stays hidden.
        put(spaceId, origin, NONE);
      }
    },

    refreshIfLoaded: (spaceId, origin) => {
      if (get().bySpace.has(keyOf(spaceId, origin))) void get().load(spaceId, origin);
    },

    rsvp: async (event, origin, going) => {
      const updated = await getApiForOrigin(origin).spaces.rsvp(event.spaceId, event.id, going);
      if (!updated) return;
      const current = eventsFor(get().bySpace, event.spaceId, origin);
      put(event.spaceId, origin, current.map((e) => (e.id === updated.id ? updated : e)));
    },
  };
});
