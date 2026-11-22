/** Every recorded voice message is uploaded under this name, which is how the chat knows to draw the voice player. */
export const VOICE_MESSAGE_NAME = 'voice-message';
export const VOICE_MESSAGE_MAX_SECONDS = 5 * 60;

/** Recorder formats in preference order, with the extension the server maps to an audio mimetype. */
const FORMATS: { mime: string; ext: string }[] = [
  { mime: 'audio/webm;codecs=opus', ext: 'weba' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  { mime: 'audio/mp4', ext: 'm4a' },
];

export function pickVoiceFormat(isSupported: (mime: string) => boolean): { mime: string; ext: string } | null {
  return FORMATS.find((f) => isSupported(f.mime)) ?? null;
}

export function isVoiceMessage(originalName: string): boolean {
  return originalName.startsWith(`${VOICE_MESSAGE_NAME}.`);
}

/** `count` bar heights (0–1) from decoded samples: the loudest sample in each slice, scaled to the loudest slice. */
export function peaks(samples: Float32Array, count: number): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(samples.length / count));
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let j = i * step; j < Math.min(samples.length, (i + 1) * step); j++) max = Math.max(max, Math.abs(samples[j]!));
    out.push(max);
  }
  const top = Math.max(...out, 1e-6);
  return out.map((v) => Math.max(0.12, v / top));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
