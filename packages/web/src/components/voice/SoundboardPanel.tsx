import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SOUNDBOARD, type SpaceSound } from '@patogh/shared';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore, getChannelOrigin, getMyUserIdForOrigin } from '../../stores/spaceStore';
import { useSoundboardStore, soundsFor } from '../../stores/soundboardStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { describeError } from '../../i18n/errors';

/** Tile accents, cycled; whole class names so Tailwind keeps them. */
const ACCENTS = [
  'border-accent-primary', 'border-accent-mint', 'border-accent-amber',
  'border-accent-sky', 'border-accent-rose', 'border-accent-lavender',
];
const ACTIVE = ['bg-accent-primary', 'bg-accent-mint', 'bg-accent-amber', 'bg-accent-sky', 'bg-accent-rose', 'bg-accent-lavender'];
const NO_SOUNDS: SpaceSound[] = [];
const TILTS = ['-rotate-2', 'rotate-[1.5deg]', '-rotate-1', 'rotate-2', '-rotate-[1.5deg]', 'rotate-1'];

/** Seconds of audio in `file`, or null when the browser cannot read it. */
function durationOf(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => { URL.revokeObjectURL(url); resolve(value); };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The soundboard for the space call you are in. `side` sits beside the call on
 * desktop, `sheet` slides up over the mobile call screen.
 */
export function SoundboardPanel({ variant = 'side', onClose }: { variant?: 'side' | 'sheet'; onClose?: () => void }) {
  const { t } = useTranslation(['voice', 'common']);
  const channelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const spaceId = useSpaceStore((s) => (channelId ? s.channelToSpaceMap.get(channelId) : undefined));
  const canManage = useSpaceStore((s) => hasPermissionBit(spaceId ? s.spacePermissions.get(spaceId) : undefined, PermissionBits.MANAGE_CHANNELS));
  const members = useSpaceStore((s) => s.members);
  const origin = channelId ? getChannelOrigin(channelId) : '';
  const sounds = useSoundboardStore((s) => (spaceId ? soundsFor(s.bySpace, spaceId, origin) : NO_SOUNDS));
  const { load, play, volume, setVolume, cooldownUntil, recent } = useSoundboardStore();
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState<{ file: File; name: string; emoji: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (spaceId) void load(spaceId, origin); }, [spaceId, origin, load]);
  // Tick only while a cooldown is running, for the countdown and to re-enable the tiles.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  if (!spaceId) return null;
  const waitSeconds = Math.ceil(Math.max(0, cooldownUntil - now) / 1000);
  const me = getMyUserIdForOrigin(origin);
  const nameOf = (userId: string) => {
    const m = members.find((x) => x.userId === userId);
    return m?.nickname ?? m?.user.displayName ?? m?.user.username ?? t('voice:soundboard.someone');
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    const seconds = await durationOf(file);
    if (file.size > SOUNDBOARD.maxBytes || seconds === null || seconds > SOUNDBOARD.maxSeconds) {
      setError(t('voice:soundboard.tooLong', { seconds: SOUNDBOARD.maxSeconds, size: SOUNDBOARD.maxBytes / (1024 * 1024) }));
      return;
    }
    setDraft({ file, name: file.name.replace(/\.[^.]+$/, '').slice(0, SOUNDBOARD.maxNameLength), emoji: '' });
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    try {
      await getApiForOrigin(origin).spaces.uploadSound(spaceId, {
        name: draft.name.trim(), emoji: draft.emoji.trim() || null, audio: await toBase64(draft.file),
      });
      await load(spaceId, origin);
      setDraft(null);
    } catch (err) {
      setError(describeError(err));
    }
    setBusy(false);
  };

  const remove = async (soundId: string) => {
    try {
      await getApiForOrigin(origin).spaces.deleteSound(spaceId, soundId);
      await load(spaceId, origin);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const latest = recent[0] && now - recent[0].at < 1500 ? recent[0].soundId : null;

  const shell = variant === 'side'
    ? 'w-[380px] flex-shrink-0 h-full bg-surface-members rounded-ss-[28px] p-5 flex flex-col gap-4 overflow-y-auto no-scrollbar'
    : 'fixed inset-x-0 bottom-0 z-50 max-h-[80%] bg-surface-members rounded-t-[30px] px-4 pt-2.5 pb-[calc(24px+var(--safe-bottom,0px))] flex flex-col gap-3.5 overflow-y-auto';

  return (
    <>
      {variant === 'sheet' && <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />}
      <aside aria-label={t('voice:soundboard.title')} className={shell}>
        {variant === 'sheet' && <span aria-hidden="true" className="self-center w-11 h-[5px] rounded-full bg-border-hard" />}
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display font-extrabold text-2xl text-txt-primary">{t('voice:soundboard.title')}</h2>
          {canManage && sounds.length < SOUNDBOARD.maxPerSpace && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="h-9 px-3 rounded-xl border-2 border-dashed border-border-hard text-accent-mint text-[13px] font-extrabold hover:border-accent-mint transition-colors"
            >
              {t('voice:soundboard.upload')}
            </button>
          )}
          <input ref={fileInput} type="file" accept="audio/ogg,audio/mpeg,audio/wav,audio/webm,.ogg,.mp3,.wav,.webm" className="hidden" onChange={pick} />
        </div>

        {error && <p role="alert" className="text-sm text-txt-danger">{error}</p>}

        {draft && (
          <form onSubmit={upload} className="p-3 rounded-[18px] bg-surface-elevated flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={draft.emoji}
                onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
                maxLength={8}
                aria-label={t('voice:soundboard.emoji')}
                placeholder="🔔"
                className="input-standard w-14 text-center"
              />
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                maxLength={SOUNDBOARD.maxNameLength}
                aria-label={t('voice:soundboard.name')}
                className="input-standard flex-1 min-w-0"
                autoFocus
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className="px-3 py-1.5 text-sm text-txt-tertiary hover:text-txt-secondary">
                {t('common:actions.cancel')}
              </button>
              <button type="submit" disabled={busy} className="px-4 py-1.5 rounded-full bg-accent-primary text-txt-on-primary text-sm font-bold disabled:opacity-50">
                {t('voice:soundboard.add')}
              </button>
            </div>
          </form>
        )}

        {sounds.length === 0 ? (
          <p className="text-sm text-txt-tertiary">{canManage ? t('voice:soundboard.emptyManager') : t('voice:soundboard.empty')}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {sounds.map((sound, i) => {
              const on = latest === sound.id;
              return (
                <div key={sound.id} className="relative group/sound">
                  <button
                    type="button"
                    onClick={() => void play(spaceId, origin, sound.id).catch(() => { /* A 429 just means wait; the countdown shows it. */ })}
                    disabled={waitSeconds > 0}
                    aria-label={t('voice:soundboard.play', { name: sound.name })}
                    className={`w-full h-[92px] rounded-[20px] flex flex-col items-center justify-center gap-1.5 px-1 transition-transform disabled:cursor-wait ${
                      on
                        ? `${ACTIVE[i % ACTIVE.length]} text-txt-on-primary ${TILTS[i % TILTS.length]} scale-[1.04] shadow-[4px_4px_0_rgb(var(--text-primary))]`
                        : `bg-surface-elevated text-txt-primary border-b-4 ${ACCENTS[i % ACCENTS.length]} hover:-translate-y-0.5`
                    }`}
                  >
                    <span className="text-[26px] leading-none" aria-hidden="true">{sound.emoji || '♪'}</span>
                    <span className="text-[13px] font-extrabold truncate max-w-full">{sound.name}</span>
                  </button>
                  {(canManage || sound.uploadedBy === me) && (
                    <button
                      type="button"
                      onClick={() => void remove(sound.id)}
                      aria-label={t('voice:soundboard.remove', { name: sound.name })}
                      className="absolute -top-1.5 -end-1.5 w-6 h-6 rounded-full bg-surface-base text-txt-secondary hover:text-txt-danger flex items-center justify-center desktop:opacity-0 desktop:group-hover/sound:opacity-100 focus-visible:opacity-100"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {waitSeconds > 0 && (
          <p role="status" className="px-3.5 py-3 rounded-[18px] bg-surface-elevated text-[13px] text-txt-secondary">
            {t('voice:soundboard.cooldown', { count: waitSeconds })}
          </p>
        )}

        <div className="p-3.5 rounded-[18px] bg-surface-chat flex flex-col gap-2.5">
          <label htmlFor="soundboard-volume" className="text-[13px] font-extrabold text-txt-secondary flex justify-between">
            {t('voice:soundboard.volume')}
            <span className="text-txt-primary">{Math.round(volume * 100)}%</span>
          </label>
          <input
            id="soundboard-volume"
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            className="accent-accent-primary"
          />
          <span className="text-xs text-txt-tertiary">{t('voice:soundboard.rule', { count: SOUNDBOARD.cooldownMs / 1000 })}</span>
        </div>

        {recent.length > 0 && (
          <div className="px-3.5 py-3 rounded-[18px] bg-surface-chat flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-txt-tertiary">{t('voice:soundboard.justPlayed')}</span>
            {recent.map((r) => (
              <span key={`${r.at}-${r.userId}`} className="text-sm text-txt-secondary">
                {t('voice:soundboard.played', {
                  name: nameOf(r.userId),
                  sound: sounds.find((s) => s.id === r.soundId)?.name ?? '♪',
                })}
              </span>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}

/** Opens the soundboard from a call's control row; shown in space calls only. */
export function useSoundboardAvailable(): boolean {
  const channelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const isDmCall = useVoiceStore((s) => !!s.activeDmCall);
  const inSpace = useSpaceStore((s) => !!channelId && s.channelToSpaceMap.has(channelId));
  return inSpace && !isDmCall;
}

