import { describe, expect, it } from 'vitest';
import { browserSaysWeak, weakNetActive, weakNetFeature, useWeakNetStore } from './weakNetStore';

describe('weakNetStore', () => {
  it('trusts the browser only for data saver', () => {
    expect(browserSaysWeak({ saveData: true })).toBe(true);
    expect(browserSaysWeak({ effectiveType: '2g' })).toBe(false);
    expect(browserSaysWeak({ effectiveType: '3g' })).toBe(false);
    expect(browserSaysWeak(undefined)).toBe(false);
  });

  it('is on when always, or automatic and detected; never when off', () => {
    expect(weakNetActive({ mode: 'always', detected: false })).toBe(true);
    expect(weakNetActive({ mode: 'auto', detected: true })).toBe(true);
    expect(weakNetActive({ mode: 'auto', detected: false })).toBe(false);
    expect(weakNetActive({ mode: 'off', detected: true })).toBe(false);
  });

  it('applies a saving only when its switch is on', () => {
    useWeakNetStore.setState({ mode: 'always' });
    useWeakNetStore.getState().setFeature('shrinkImages', false);
    expect(weakNetFeature('shrinkImages')).toBe(false);
    expect(weakNetFeature('tapToLoad')).toBe(true);
  });
});
