import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WeakNetMode = 'auto' | 'always' | 'off';
export type WeakNetFeature = 'voiceOnly' | 'lighterVoice' | 'tapToLoad' | 'shrinkImages';

/** A round trip slower than this counts as a weak connection. */
export const SLOW_RTT_MS = 600;
const PROBE_EVERY_MS = 60_000;

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', fn: () => void) => void;
}

interface WeakNetState {
  mode: WeakNetMode;
  features: Record<WeakNetFeature, boolean>;
  /** Last measured round trip to this server, ms; null before the first probe or when it failed. */
  rttMs: number | null;
  /** Automatic mode's verdict. */
  detected: boolean;
  setMode: (mode: WeakNetMode) => void;
  setFeature: (feature: WeakNetFeature, on: boolean) => void;
  /** Time a request to the server and refresh `detected`. */
  probe: () => Promise<void>;
}

function connectionHint(): NetworkInformationLike | undefined {
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

/**
 * The browser's own hint, where it gives one (Chromium only): data saver turned on.
 * Its link-type estimate is ignored: it reported 2G and 3G for a 2 ms localhost link, and the probe measures the real round trip.
 */
export function browserSaysWeak(c: NetworkInformationLike | undefined = connectionHint()): boolean {
  return c?.saveData === true;
}

export const useWeakNetStore = create<WeakNetState>()(
  persist(
    (set) => ({
      mode: 'auto',
      features: { voiceOnly: true, lighterVoice: true, tapToLoad: true, shrinkImages: true },
      rttMs: null,
      detected: false,
      setMode: (mode) => set({ mode }),
      setFeature: (feature, on) => set((s) => ({ features: { ...s.features, [feature]: on } })),
      probe: async () => {
        const started = performance.now();
        let rttMs: number | null = null;
        try {
          const res = await fetch('/api/health', { cache: 'no-store' });
          if (res.ok) rttMs = Math.round(performance.now() - started);
        } catch { /* Offline: the banner covers that; no verdict from a failed probe. */ }
        set({ rttMs, detected: browserSaysWeak() || (rttMs !== null && rttMs > SLOW_RTT_MS) });
      },
    }),
    { name: 'patogh:weak-net', partialize: (s) => ({ mode: s.mode, features: s.features }) },
  ),
);

/** Whether weak internet mode is on now (always, or automatic and the connection is weak). */
export function weakNetActive(s: Pick<WeakNetState, 'mode' | 'detected'> = useWeakNetStore.getState()): boolean {
  return s.mode === 'always' || (s.mode === 'auto' && s.detected);
}

/** Whether one of its savings applies right now. */
export function weakNetFeature(feature: WeakNetFeature, s: WeakNetState = useWeakNetStore.getState()): boolean {
  return weakNetActive(s) && s.features[feature];
}

/** React form of `weakNetFeature`. */
export function useWeakNetFeature(feature: WeakNetFeature): boolean {
  return useWeakNetStore((s) => weakNetFeature(feature, s));
}

let started = false;
/** Probe now, every minute, and when the browser reports a network change. Call once at startup. */
export function startWeakNetProbe(): void {
  if (started) return;
  started = true;
  // Only automatic mode needs a verdict; the settings page measures on its own when opened.
  const probe = () => { if (useWeakNetStore.getState().mode === 'auto') void useWeakNetStore.getState().probe(); };
  probe();
  setInterval(probe, PROBE_EVERY_MS);
  connectionHint()?.addEventListener?.('change', probe);
  window.addEventListener('online', probe);
}
