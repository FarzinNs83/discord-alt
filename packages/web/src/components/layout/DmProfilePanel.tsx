import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '@patogh/shared';
import { Avatar } from '../ui/Avatar';
import { Username } from '../ui/Username';
import { ProfileBio } from '../ui/ProfileBio';
import { ActivityCard } from '../ui/ActivityCard';
import { useUIStore } from '../../stores/uiStore';
import { useActivityStore, activitiesFor } from '../../stores/activityStore';
import { useFormatters } from '../../i18n/formatters';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { useShownStatus } from '../../hooks/useShownStatus';
import { loadFederatedMutuals, type MutualSpace } from '../../utils/mutuals';
import { parseFederatedUsername } from '../../utils/identity';
import { getAvatarGradient, getSpaceGradient } from '../../utils/gradients';
import { api } from '../../api/client';

const SECTION_LABEL = 'text-[11px] font-bold uppercase tracking-[0.12em] text-txt-tertiary';

/**
 * Right column of a 1-on-1 DM: the partner's profile, opened and closed by the
 * same member-list toggle that shows a space's members or a group's roster.
 */
export function DmProfilePanel({ partner, origin }: { partner: User; origin: string }) {
  const { t } = useTranslation(['social']);
  const f = useFormatters();
  const openModal = useUIStore((s) => s.openModal);
  const user = useCanonicalUserView(partner, origin);
  const shownStatus = useShownStatus(user, origin, user.status);
  const userActivities = useActivityStore((s) => s.userActivities);
  const activities = activitiesFor(userActivities, user, origin);
  const displayName = user.displayName ?? parseFederatedUsername(user.username).baseName;

  const [sharedSpaces, setSharedSpaces] = useState<MutualSpace[]>([]);
  useEffect(() => {
    let cancelled = false;
    setSharedSpaces([]);
    loadFederatedMutuals(user.id, user.homeUserId)
      .then((data) => { if (!cancelled) setSharedSpaces(data.mutualSpaces); })
      .catch(() => { /* Non-critical: the section just stays hidden. */ });
    return () => { cancelled = true; };
  }, [user.id, user.homeUserId]);

  // Another instance's assets arrive as absolute URLs; a bare filename is ours.
  const bannerSrc = user.banner
    ? (user.banner.startsWith('http') || user.banner.startsWith('/') ? user.banner : api.uploads.url(user.banner))
    : null;
  const bannerFill = user.accentColor
    ?? getAvatarGradient(user.homeUserId ?? user.id, displayName, user.avatarColor).gradient;

  return (
    <aside
      data-dm-profile-panel
      aria-label={displayName}
      className="w-[300px] bg-surface-members flex-shrink-0 overflow-y-auto no-scrollbar hidden desktop:flex flex-col border-s border-border-hard"
    >
      <div
        className="h-[110px] flex-shrink-0 relative overflow-hidden"
        style={bannerSrc
          ? { backgroundImage: `url(${bannerSrc})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: bannerFill }}
      >
        {!bannerSrc && (
          <>
            <span aria-hidden="true" className="absolute end-6 top-[18px] w-14 h-14 rounded-[18px] bg-accent-amber rotate-[14deg]" />
            <span aria-hidden="true" className="absolute end-[90px] top-[50px] w-7 h-7 rounded-full bg-accent-primary" />
          </>
        )}
      </div>

      <div className="px-5 pb-6 -mt-11 flex flex-col gap-3.5">
        <Avatar
          src={user.avatar}
          name={displayName}
          size={84}
          status={shownStatus}
          user={user}
          userId={user.homeUserId ?? user.id}
          ring={{ width: 5, color: 'rgb(var(--bg-members))' }}
          className="-rotate-[4deg] self-start"
          onClick={() => openModal('userProfile', { userId: user.id, user, origin })}
        />

        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-display font-extrabold text-2xl leading-tight text-txt-primary break-words">{displayName}</span>
          <Username username={user.username} showAt className="text-sm text-txt-tertiary" />
        </div>

        {activities.length > 0 || user.customStatus ? (
          <div className="px-3 py-2.5 rounded-[14px] bg-surface-elevated text-sm text-txt-secondary">
            <ActivityCard activities={activities} fallbackCustomStatus={user.customStatus} />
          </div>
        ) : null}

        {user.bio && (
          <div className="flex flex-col gap-1.5">
            <span className={SECTION_LABEL}>{t('social:profile.aboutMe')}</span>
            <ProfileBio bio={user.bio} />
          </div>
        )}

        {sharedSpaces.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className={SECTION_LABEL}>{t('social:profile.tabs.mutualSpaces')}</span>
            <div className="flex flex-wrap gap-2">
              {sharedSpaces.map((space) => (
                <span
                  key={`${space._instanceOrigin}:${space.id}`}
                  className="px-2.5 py-1.5 rounded-xl text-[13px] font-extrabold text-white max-w-full truncate"
                  style={{ background: getSpaceGradient(space.id, space.name, space.avatarColor).gradient }}
                >
                  {space.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className={SECTION_LABEL}>{t('social:profile.memberSince')}</span>
          <span className="text-sm text-txt-secondary">{f.formatMediumDate(user.createdAt)}</span>
        </div>
      </div>
    </aside>
  );
}
