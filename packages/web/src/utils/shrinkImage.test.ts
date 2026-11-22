import { describe, expect, it } from 'vitest';
import { canShrink, fitWithin } from './shrinkImage';

const file = (type: string, bytes: number) => new File([new Uint8Array(bytes)], 'x', { type });

describe('shrinkImage', () => {
  it('fits the longest side and never upscales', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1000, 3200)).toEqual({ width: 500, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('only shrinks large still photos', () => {
    expect(canShrink(file('image/jpeg', 400 * 1024))).toBe(true);
    expect(canShrink(file('image/jpeg', 100 * 1024))).toBe(false);
    expect(canShrink(file('image/gif', 400 * 1024))).toBe(false);
    expect(canShrink(file('application/pdf', 400 * 1024))).toBe(false);
  });
});
