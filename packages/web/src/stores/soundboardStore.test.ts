import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpaceSound } from '@patogh/shared';

const playSound = vi.hoisted(() => vi.fn());
const voice = vi.hoisted(() => ({ currentVoiceChannelId: 'lounge' as string | null, isDeafened: false }));
const api = vi.hoisted(() => ({ spaces: { sounds: vi.fn(), playSound: vi.fn() } }));

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ playSound }) } }));
vi.mock('./voiceStore', () => ({ useVoiceStore: { getState: () => voice } }));
vi.mock('../utils/crossStoreResolvers', () => ({ getApiForOrigin: () => api }));

import { useSoundboardStore } from './soundboardStore';

const drum: SpaceSound = { id: 's1', spaceId: 'gn', name: 'Drumroll', emoji: '🥁', url: '/api/sounds/abc.ogg', uploadedBy: 'darya' };
const played = { spaceId: 'gn', channelId: 'lounge', soundId: 's1', userId: 'sara' };

beforeEach(async () => {
  vi.clearAllMocks();
  voice.currentVoiceChannelId = 'lounge';
  voice.isDeafened = false;
  api.spaces.sounds.mockResolvedValue([drum]);
  useSoundboardStore.setState({ bySpace: new Map(), recent: [], cooldownUntil: 0, volume: 0.5 });
  await useSoundboardStore.getState().load('gn', '');
});

describe('soundboard playback', () => {
  it('plays to people in that voice channel at their own volume, and records it', () => {
    useSoundboardStore.getState().onPlayed(played, '');
    expect(playSound).toHaveBeenCalledWith('/api/sounds/abc.ogg', { volume: 0.5 });
    expect(useSoundboardStore.getState().recent[0]).toMatchObject({ soundId: 's1', userId: 'sara' });
  });

  it('stays silent in another channel or while deafened', () => {
    voice.currentVoiceChannelId = 'other';
    useSoundboardStore.getState().onPlayed(played, '');
    voice.currentVoiceChannelId = 'lounge';
    voice.isDeafened = true;
    useSoundboardStore.getState().onPlayed(played, '');
    expect(playSound).not.toHaveBeenCalled();
  });

  it('fetches sounds from a remote space’s own server', () => {
    useSoundboardStore.setState({ bySpace: new Map([['https://far.example|gn', [drum]]]) });
    useSoundboardStore.getState().onPlayed(played, 'https://far.example');
    expect(playSound).toHaveBeenCalledWith('https://far.example/api/sounds/abc.ogg', { volume: 0.5 });
  });

  it('asks the server once per cooldown', async () => {
    api.spaces.playSound.mockResolvedValue({ success: true });
    await useSoundboardStore.getState().play('gn', '', 's1');
    await useSoundboardStore.getState().play('gn', '', 's1');
    expect(api.spaces.playSound).toHaveBeenCalledTimes(1);
  });
});
