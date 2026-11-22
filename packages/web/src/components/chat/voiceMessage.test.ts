import { describe, expect, it } from 'vitest';
import { formatClock, isVoiceMessage, peaks, pickVoiceFormat } from './voiceMessage';

describe('voiceMessage', () => {
  it('picks the first format the browser records', () => {
    expect(pickVoiceFormat((m) => m.startsWith('audio/webm'))?.ext).toBe('weba');
    expect(pickVoiceFormat((m) => m === 'audio/mp4')?.ext).toBe('m4a');
    expect(pickVoiceFormat(() => false)).toBeNull();
  });

  it('recognises voice messages by name only', () => {
    expect(isVoiceMessage('voice-message.weba')).toBe(true);
    expect(isVoiceMessage('voice-message-notes.mp3')).toBe(false);
    expect(isVoiceMessage('song.ogg')).toBe(false);
  });

  it('scales peaks to the loudest slice with a visible floor', () => {
    const p = peaks(new Float32Array([0, 0.5, 0, -1, 0, 0]), 3);
    expect(p).toEqual([0.5, 1, 0.12]);
  });

  it('formats a clock', () => {
    expect(formatClock(6.7)).toBe('0:06');
    expect(formatClock(75)).toBe('1:15');
  });
});
