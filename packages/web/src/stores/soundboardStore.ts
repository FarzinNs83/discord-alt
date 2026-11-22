import { create } from 'zustand';
import { SOUNDBOARD, type SpaceSound } from '@patogh/shared';
import { getApiForOrigin } from '../utils/crossStoreResolvers';
import { AudioManager } from '../audio/AudioManager';
import { useVoiceStore } from './voiceStore';

const keyOf = (spaceId: string, origin: string) => `${origin}|${spaceId}`;
const VOLUME_KEY = 'patogh:soundboard-volume';
const NONE: SpaceSound[] = [];

export interface RecentPlay {
  soundId: string;
  userId: string;
  at: number;
}

interface SoundboardState {
  bySpace: Map<string, SpaceSound[]>;
  /** How loud I hear soundboard sounds, 0..1. Per device. */
  volume: number;
  /** When I may play again (epoch ms). */
  cooldownUntil: number;
  /** Newest first, a few at most. */
  recent: RecentPlay[];
  load: (spaceId: string, origin: string) => Promise<void>;
  refreshIfLoaded: (spaceId: string, origin: string) => void;
  setVolume: (volume: number) => void;
  play: (spaceId: string, origin: string, soundId: string) => Promise<void>;
  /** A `soundboard_played` push from `origin`. */
  onPlayed: (event: { spaceId: string; channelId: string; soundId: string; userId: string }, origin: string) => void;
}

/** The sounds held for a space, or a stable empty list. */
export function soundsFor(bySpace: Map<string, SpaceSound[]>, spaceId: string, origin: string): SpaceSound[] {
  return bySpace.get(keyOf(spaceId, origin)) ?? NONE;
}

/** Absolute URL for a sound served by `origin` ('' = this page's server). */
export function soundSrc(sound: SpaceSound, origin: string): string {
  return origin ? `${origin}${sound.url}` : sound.url;
}

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return localStorage.getItem(VOLUME_KEY) !== null && v >= 0 && v <= 1 ? v : 0.7;
  } catch {
    return 0.7;
  }
}

export const useSoundboardStore = create<SoundboardState>((set, get) => ({
  bySpace: new Map(),
  volume: readVolume(),
  cooldownUntil: 0,
  recent: [],

  load: async (spaceId, origin) => {
    let sounds: SpaceSound[] = NONE;
    try { sounds = await getApiForOrigin(origin).spaces.sounds(spaceId); } catch { /* An older server has no soundboard. */ }
    set((s) => ({ bySpace: new Map(s.bySpace).set(keyOf(spaceId, origin), sounds) }));
  },

  refreshIfLoaded: (spaceId, origin) => {
    if (get().bySpace.has(keyOf(spaceId, origin))) void get().load(spaceId, origin);
  },

  setVolume: (volume) => {
    set({ volume });
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* Private mode: it just isn't remembered. */ }
  },

  play: async (spaceId, origin, soundId) => {
    if (Date.now() < get().cooldownUntil) return;
    set({ cooldownUntil: Date.now() + SOUNDBOARD.cooldownMs });
    await getApiForOrigin(origin).spaces.playSound(spaceId, soundId);
  },

  onPlayed: (event, origin) => {
    const voice = useVoiceStore.getState();
    if (voice.currentVoiceChannelId !== event.channelId) return;
    set((s) => ({ recent: [{ soundId: event.soundId, userId: event.userId, at: Date.now() }, ...s.recent].slice(0, 4) }));
    if (voice.isDeafened) return;
    const sound = soundsFor(get().bySpace, event.spaceId, origin).find((x) => x.id === event.soundId);
    if (sound) {
      void AudioManager.getInstance().playSound(soundSrc(sound, origin), { volume: get().volume });
    } else {
      // Someone played a sound this client has not listed yet: fetch the list, then play it.
      void get().load(event.spaceId, origin).then(() => {
        const loaded = soundsFor(get().bySpace, event.spaceId, origin).find((x) => x.id === event.soundId);
        if (loaded) void AudioManager.getInstance().playSound(soundSrc(loaded, origin), { volume: get().volume });
      });
    }
  },
}));
