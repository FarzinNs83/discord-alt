import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWeakNetFeature } from '../../stores/weakNetStore';
import { formatClock, peaks } from './voiceMessage';

const BARS = 34;
const SPEEDS = [1, 1.5, 2] as const;
const FLAT = Array.from({ length: BARS }, () => 0.3);

interface VoiceMessagePlayerProps {
  src: string;
  mimetype: string;
  /** Seconds, from the server's probe; recordings from the browser often carry no duration of their own. */
  duration: number | null | undefined;
}

export function VoiceMessagePlayer({ src, mimetype, duration }: VoiceMessagePlayerProps) {
  const { t } = useTranslation(['chat']);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [bars, setBars] = useState<number[]>(FLAT);
  const [length, setLength] = useState(duration ?? 0);
  // On a weak connection the clip is fetched only when played, so the bars stay flat until then.
  const holdDownload = useWeakNetFeature('tapToLoad');

  useEffect(() => {
    if (holdDownload) return;
    let cancelled = false;
    void (async () => {
      try {
        const buf = await (await fetch(src)).arrayBuffer();
        const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
        if (cancelled) return;
        setBars(peaks(decoded.getChannelData(0), BARS));
        if (!duration) setLength(decoded.duration);
      } catch { /* Undecodable here: keep flat bars; the <audio> element may still play it. */ }
    })();
    return () => { cancelled = true; };
  }, [src, duration, holdDownload]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !length) return;
    audio.currentTime = fraction * length;
    setTime(audio.currentTime);
  };

  const progress = length ? Math.min(1, time / length) : 0;
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;

  return (
    <div className="mt-1 w-[380px] max-w-full px-3 py-2.5 rounded-[20px] bg-surface-elevated border-2 border-border-hard flex items-center gap-3">
      <audio
        ref={audioRef}
        preload={holdDownload ? 'none' : 'metadata'}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTime(0); }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { if (!length && Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration); }}
      >
        <source src={src} type={mimetype} />
      </audio>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('chat:voiceMessage.pause') : t('chat:voiceMessage.play')}
        className="w-11 h-11 shrink-0 rounded-[15px] bg-accent-primary text-txt-on-primary flex items-center justify-center -rotate-[4deg]"
      >
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
        )}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => seek(Number(e.target.value) / 1000)}
          aria-label={t('chat:voiceMessage.seek')}
          aria-valuetext={t('chat:voiceMessage.position', { current: formatClock(time), total: formatClock(length) })}
          className="peer sr-only"
        />
        {/* Bars run in the reading direction; the hidden range above is what keyboards and screen readers use. */}
        <div
          className="h-7 flex items-center gap-[2px] cursor-pointer rounded peer-focus-visible:ring-2 peer-focus-visible:ring-accent-primary"
          aria-hidden="true"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            seek(getComputedStyle(e.currentTarget).direction === 'rtl' ? 1 - x : x);
          }}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={`flex-1 rounded-[3px] ${i / BARS < progress ? 'bg-accent-primary' : 'bg-interactive-muted'}`}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          ))}
        </div>
        <span className="text-xs text-txt-tertiary tabular-nums">
          {t('chat:voiceMessage.position', { current: formatClock(time), total: formatClock(length) })}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setSpeed(nextSpeed)}
        aria-label={t('chat:voiceMessage.speed', { speed })}
        className="h-[30px] px-2 shrink-0 rounded-[10px] bg-accent-amber text-[#1A0E07] font-extrabold text-[13px] tabular-nums"
      >
        {t('chat:voiceMessage.speedValue', { speed })}
      </button>
    </div>
  );
}
