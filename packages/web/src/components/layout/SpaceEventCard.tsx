import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SPACE_EVENT_TITLE_LENGTH, type Channel, type SpaceEvent } from '@patogh/shared';
import { useEventStore, eventsFor } from '../../stores/eventStore';
import { useFormatters, type Formatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { getMyUserIdForOrigin } from '../../stores/spaceStore';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface SpaceEventCardProps {
  spaceId: string;
  /** The instance hosting the space ('' = home). */
  origin: string;
  channels: Channel[];
  /** Manage Channels in this space: may schedule and cancel any event. */
  canManage: boolean;
  className?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "tomorrow", "Friday", or a short date beyond a week. */
function dayLabel(f: Formatters, startsAt: number): string {
  const ahead = startsAt - Date.now();
  if (ahead < 2 * DAY_MS) return f.formatRelativeDay(startsAt);
  if (ahead < 6 * DAY_MS) return f.formatWeekday(startsAt);
  return f.formatShortDate(startsAt);
}

/** `datetime-local` value for the next whole hour, local time. */
function nextHourInput(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

/** The space's next event as a sticker above the channel list, plus scheduling for managers. */
export function SpaceEventCard({ spaceId, origin, channels, canManage, className = '' }: SpaceEventCardProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const f = useFormatters();
  const events = useEventStore((s) => eventsFor(s.bySpace, spaceId, origin));
  const load = useEventStore((s) => s.load);
  const rsvp = useEventStore((s) => s.rsvp);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<SpaceEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(spaceId, origin); }, [spaceId, origin, load]);

  const next = events[0];
  if (!next) {
    return canManage ? (
      <div className={className}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full h-10 rounded-[14px] border-2 border-dashed border-border-hard text-sm font-bold text-txt-tertiary hover:text-txt-primary hover:border-accent-primary transition-colors"
        >
          {t('spaces:events.schedule')}
        </button>
        {creating && <CreateEventDialog spaceId={spaceId} origin={origin} channels={channels} onClose={() => setCreating(false)} />}
      </div>
    ) : null;
  }

  const place = next.channelId ? channels.find((c) => c.id === next.channelId)?.name : undefined;
  const mine = next.createdBy === getMyUserIdForOrigin(origin);

  const toggleGoing = async () => {
    setBusy(true);
    try { await rsvp(next, origin, !next.going); } catch { /* The next push or reload corrects the pill. */ }
    setBusy(false);
  };

  const cancelEvent = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await getApiForOrigin(origin).spaces.deleteEvent(spaceId, cancelling.id);
      await load(spaceId, origin);
    } finally {
      setBusy(false);
      setCancelling(null);
    }
  };

  return (
    <div className={className}>
      <div className="group/event relative px-3.5 py-3 rounded-[16px] bg-accent-primary text-txt-on-primary flex items-center gap-2.5 -rotate-[1.5deg]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
          <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="font-extrabold text-sm truncate">{dayLabel(f, next.startsAt)} · {f.formatTime(next.startsAt)}</span>
          <span className="text-xs font-semibold truncate">
            {place ? t('spaces:events.titleIn', { title: next.title, place }) : next.title}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleGoing}
          disabled={busy}
          aria-pressed={next.going}
          title={t('spaces:events.imIn')}
          className={`flex-shrink-0 px-2.5 py-1 rounded-[10px] text-xs font-extrabold transition-colors disabled:opacity-60 ${
            next.going ? 'bg-txt-primary text-txt-on-primary' : 'bg-txt-on-primary text-txt-primary'
          }`}
        >
          {t('spaces:events.going', { count: next.goingCount })}
        </button>
        {(canManage || mine) && (
          <button
            type="button"
            onClick={() => setCancelling(next)}
            aria-label={t('spaces:events.cancel')}
            title={t('spaces:events.cancel')}
            className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-surface-elevated text-txt-secondary hover:text-txt-primary flex items-center justify-center desktop:opacity-0 desktop:group-hover/event:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        )}
      </div>
      {canManage && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mt-2 w-full text-xs font-bold text-txt-tertiary hover:text-txt-primary transition-colors"
        >
          {t('spaces:events.schedule')}
        </button>
      )}
      {creating && <CreateEventDialog spaceId={spaceId} origin={origin} channels={channels} onClose={() => setCreating(false)} />}
      <ConfirmDialog
        isOpen={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={cancelEvent}
        title={t('spaces:events.cancelConfirm.title')}
        description={t('spaces:events.cancelConfirm.description', { title: cancelling?.title ?? '' })}
        confirmLabel={t('spaces:events.cancel')}
        loading={busy}
      />
    </div>
  );
}

function CreateEventDialog({ spaceId, origin, channels, onClose }: {
  spaceId: string; origin: string; channels: Channel[]; onClose: () => void;
}) {
  const { t } = useTranslation(['spaces', 'common']);
  const load = useEventStore((s) => s.load);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(nextHourInput);
  const [channelId, setChannelId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Voice channels first: that is where events usually happen.
  const places = [...channels].sort((a, b) => Number(b.type === 'voice') - Number(a.type === 'voice'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const startsAt = new Date(when).getTime();
    if (!title.trim() || !Number.isFinite(startsAt)) return;
    setSaving(true);
    setError(null);
    try {
      await getApiForOrigin(origin).spaces.createEvent(spaceId, { title: title.trim(), startsAt, channelId: channelId || null });
      await load(spaceId, origin);
      onClose();
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('spaces:events.schedule')} mobileStyle="sheet">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <div role="alert" className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">{error}</div>}
        <label className="flex flex-col gap-2">
          <span className="text-xs font-bold text-txt-secondary uppercase">{t('spaces:events.form.what')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_SPACE_EVENT_TITLE_LENGTH}
            placeholder={t('spaces:events.form.whatPlaceholder')}
            className="input-standard w-full"
            autoFocus
            required
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-xs font-bold text-txt-secondary uppercase">{t('spaces:events.form.when')}</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input-standard w-full" required />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-xs font-bold text-txt-secondary uppercase">{t('spaces:events.form.where')}</span>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="input-standard w-full">
            <option value="">{t('spaces:events.form.nowhere')}</option>
            {places.map((c) => <option key={c.id} value={c.id}>{c.type === 'voice' ? '♪ ' : '# '}{c.name}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-txt-tertiary hover:text-txt-secondary">
            {t('common:actions.cancel')}
          </button>
          <button type="submit" disabled={saving || !title.trim()} className="px-4 py-1.5 rounded-full bg-accent-primary text-txt-on-primary text-sm font-bold disabled:opacity-50">
            {t('spaces:events.form.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
