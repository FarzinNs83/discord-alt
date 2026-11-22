import { Fragment, useState, useEffect, type ReactNode } from 'react';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { api } from '../../api/client';
import type { InstanceInfoResponse } from '@patogh/shared';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import {
  AccountPanel,
  AppearancePanel,
  VoicePanel,
  PrivacyPanel,
  ConnectionsPanel,
  DesktopPanel,
  DesktopDownloadPanel,
  InstancePanel,
  KeybindsPanel,
  WeakNetPanel,
  SettingsPanelSuspense,
} from './lazySettingsPanels';
import { isElectron } from '../../platform/platform';
import { useInstanceUpdateBadge } from '../../hooks/useInstanceUpdateBadge';
import { SettingsSectionsProvider, useSettingsSectionsContext } from './SettingsSectionsContext';

/**
 * Every tab of user settings, in nav order. The nav on both layouts, the
 * deep-link check (`openModal('userSettings', { tab })`) and the panel switch
 * are all read from this one table, so a tab cannot exist in one and be
 * missing from another. `admin` tabs are shown and reachable only for admins.
 */
const USER_SETTINGS_TABS = [
  { id: 'account', group: 'user', label: 'settings:nav.tabs.account' },
  { id: 'appearance', group: 'user', label: 'settings:nav.tabs.appearance' },
  { id: 'voice', group: 'user', label: 'settings:nav.tabs.voice' },
  { id: 'privacy', group: 'user', label: 'settings:nav.tabs.privacy' },
  { id: 'weakNet', group: 'app', label: 'settings:nav.tabs.weakNet' },
  { id: 'connections', group: 'app', label: 'settings:nav.tabs.connections' },
  { id: 'keybinds', group: 'app', label: 'settings:nav.tabs.keybinds' },
  { id: 'desktop', group: 'app', label: 'settings:nav.tabs.desktop' },
  { id: 'instance', group: 'admin', label: 'settings:nav.tabs.instance' },
] as const;

export type UserSettingsTab = (typeof USER_SETTINGS_TABS)[number]['id'];
type TabGroup = (typeof USER_SETTINGS_TABS)[number]['group'];

const GROUP_HEADINGS = {
  user: 'settings:nav.userSettings',
  app: 'settings:nav.appSettings',
  admin: 'settings:nav.administration',
} as const satisfies Record<TabGroup, string>;

const GROUP_ORDER: readonly TabGroup[] = ['user', 'app', 'admin'];

/** Each nav group's diamond colour, as on the board. */
const GROUP_DOT = {
  user: 'bg-accent-sky',
  app: 'bg-accent-lavender',
  admin: 'bg-accent-rose',
} as const satisfies Record<TabGroup, string>;

function isUserSettingsTab(value: unknown): value is UserSettingsTab {
  return typeof value === 'string' && USER_SETTINGS_TABS.some((tab) => tab.id === value);
}

function tabVisible(tab: UserSettingsTab, isAdmin: boolean): boolean {
  // shortcut: the browser's desktop-download tab is hidden for now; drop this line to bring it back.
  if (tab === 'desktop' && !isElectron()) return false;
  return USER_SETTINGS_TABS.find((entry) => entry.id === tab)?.group !== 'admin' || isAdmin;
}

export function SidebarSubLinks() {
  const ctx = useSettingsSectionsContext();
  if (!ctx || ctx.sections.length === 0) return null;

  return (
    <div className="overflow-hidden">
      {ctx.sections.map((section) => (
        <button
          key={section.id}
          onClick={() => ctx.scrollToSection(section.id)}
          className={`w-full flex items-center gap-1.5 text-start ps-6 pe-2 py-1 text-xs rounded-md transition-colors ${
            ctx.activeSection === section.id
              ? 'text-txt-primary'
              : 'text-txt-tertiary hover:text-txt-secondary'
          }`}
          aria-current={ctx.activeSection === section.id ? 'true' : undefined}
        >
          <span className="flex-1 min-w-0 truncate">{section.label}</span>
          {section.badgeCount !== undefined && section.badgeCount > 0 && (
            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-amber/15 text-accent-amber">
              {section.badgeCount}
            </span>
          )}
          {section.badgeDot === true && (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent-amber" />
          )}
        </button>
      ))}
    </div>
  );
}

function SettingsScrollContainer({ children }: { children: React.ReactNode }) {
  const ctx = useSettingsSectionsContext();
  return (
    <div ref={ctx?.scrollContainerRef} className="flex-1 min-w-0 overflow-y-auto scrollbar-thin py-7 bg-surface-members desktop:rounded-ss-[28px]">
      {children}
    </div>
  );
}

export function UserSettingsModal() {
  const federationEnabled = useHomeInstanceInfo()?.federationEnabled ?? false;
  const { t } = useTranslation(['settings', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const isMobile = useUIStore((s) => s.isMobile);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateBadge = useInstanceUpdateBadge();

  const [tab, setTab] = useState<UserSettingsTab>('account');
  const [mobileView, setMobileView] = useState<'tabs' | 'content'>('tabs');
  // AGPL § 13: home-instance source offer. Fetched from the public info endpoint
  // so the source link reflects the version this instance is actually running.
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfoResponse | null>(null);

  const isOpen = activeModal === 'userSettings';

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    api.instance.info()
      .then((info) => { if (!cancelled) setInstanceInfo(info); })
      .catch(() => { /* Non-critical — link falls back to hidden if unreachable. */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Deep-linking: a caller may name the tab to open on. A tab that does not
  // exist, or that this user cannot see, opens Account; on mobile a named tab
  // opens straight on its content.
  useEffect(() => {
    if (isOpen) {
      const requested = modalData.tab;
      const deepLinked = isUserSettingsTab(requested) && tabVisible(requested, isAdmin === true);
      setTab(deepLinked ? requested : 'account');
      setMobileView(deepLinked ? 'content' : 'tabs');
    }
  }, [isOpen, modalData.tab, isAdmin]);

  const handleLogout = () => {
    logout();
    closeModal();
  };

  const tabClass = (target: UserSettingsTab) =>
    `w-full min-w-0 h-10 flex items-center gap-2.5 text-start px-3 rounded-[13px] text-sm transition-colors ${
      tab === target ? 'bg-accent-primary text-txt-on-primary font-extrabold' : 'text-txt-secondary font-semibold hover:text-txt-primary hover:bg-interactive-hover'
    }`;

  const dot = (group: TabGroup, target: UserSettingsTab) => (
    <span
      aria-hidden="true"
      className={`shrink-0 w-2.5 h-2.5 rounded-[4px] rotate-45 ${tab === target ? 'bg-txt-on-primary' : GROUP_DOT[group]}`}
    />
  );

  const userHeader = (
    <div className="flex items-center gap-3 px-2">
      <Avatar
        src={user?.avatar}
        name={user?.displayName || user?.username || ''}
        size={44}
        userId={user?.id}
        avatarColor={user?.avatarColor}
        className="-rotate-[5deg]"
      />
      <div className="min-w-0">
        <div className="font-display font-extrabold text-lg leading-tight text-txt-primary">{t('common:labels.settings')}</div>
        <div className="text-xs text-txt-tertiary truncate">{user?.displayName || user?.username} · @{user?.username}</div>
      </div>
    </div>
  );

  const logoutButton = (
    <button
      onClick={handleLogout}
      className="w-full h-[42px] rounded-[13px] border-2 border-dashed border-border-hard text-accent-rose font-extrabold text-sm hover:bg-accent-rose/10 transition-colors"
    >
      {t('settings:nav.logOut')}
    </button>
  );

  const handleTabClick = (target: UserSettingsTab) => {
    setTab(target);
    if (isMobile) setMobileView('content');
  };

  const renderNav = (layout: 'desktop' | 'mobile'): ReactNode =>
    GROUP_ORDER.filter((group) => group !== 'admin' || isAdmin).map((group, index) => (
      <Fragment key={group}>
        <div className={`text-[11px] font-bold text-txt-tertiary uppercase tracking-[0.12em] px-3 pb-1.5 ${index > 0 ? 'pt-4' : ''}`}>{t(GROUP_HEADINGS[group])}</div>
        {USER_SETTINGS_TABS.filter((entry) => entry.group === group && (federationEnabled || entry.id !== 'connections') && tabVisible(entry.id, isAdmin === true)).map((entry) => (
          entry.id === 'instance' && layout === 'desktop' ? (
            <Fragment key={entry.id}>
              <button
                onClick={() => handleTabClick(entry.id)}
                className={tabClass(entry.id)}
                aria-current={tab === entry.id ? 'page' : undefined}
              >
                {dot(group, entry.id)}
                <span className="flex-1 min-w-0 truncate">{t(entry.label)}</span>
                {updateBadge && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent-amber" />}
              </button>
              {tab === 'instance' && <SidebarSubLinks />}
            </Fragment>
          ) : (
            <button
              key={entry.id}
              onClick={() => handleTabClick(entry.id)}
              className={tabClass(entry.id)}
              aria-current={tab === entry.id ? 'page' : undefined}
            >
              {dot(group, entry.id)}
              <span className="flex-1 min-w-0 truncate">{t(entry.label)}</span>
            </button>
          )
        ))}
      </Fragment>
    ));

  const panels: Record<UserSettingsTab, () => ReactNode> = {
    account: () => <AccountPanel />,
    appearance: () => <AppearancePanel />,
    voice: () => <VoicePanel />,
    privacy: () => <PrivacyPanel />,
    weakNet: () => <WeakNetPanel />,
    connections: () => <ConnectionsPanel />,
    keybinds: () => <KeybindsPanel />,
    desktop: () => (isElectron()
      ? <DesktopPanel />
      : <DesktopDownloadPanel version={instanceInfo?.version ?? null} />),
    instance: () => (isAdmin ? <InstancePanel /> : null),
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="settings" mobileStyle="fullscreen">
      <SettingsSectionsProvider>
      <div className="flex h-full">
        {/* Desktop Sidebar */}
        <div className="hidden desktop:flex w-64 flex-shrink-0 flex-col px-3.5 py-6 gap-5 overflow-y-auto no-scrollbar">
          {userHeader}
          <nav className="flex flex-col gap-0.5" aria-label={t('common:labels.settings')}>
            {renderNav('desktop')}
          </nav>
          <div className="mt-auto">{logoutButton}</div>
        </div>

        {/* Mobile: Tab list */}
        {isMobile && mobileView === 'tabs' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
            {userHeader}
            <nav className="flex flex-col gap-0.5" aria-label={t('common:labels.settings')}>
              {renderNav('mobile')}
            </nav>
            {logoutButton}
          </div>
        )}

        {/* Content area (desktop always, mobile only when viewing content) */}
        {(!isMobile || mobileView === 'content') && (
          <SettingsScrollContainer>
            <div className="px-8 max-w-[720px]">
              {/* Mobile back button */}
              {isMobile && (
                <button
                  onClick={() => setMobileView('tabs')}
                  className="flex items-center gap-1.5 text-txt-tertiary hover:text-txt-secondary mb-4 text-sm"
                  aria-label={t('settings:nav.backToMenu')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                  </svg>
                  {t('common:labels.settings')}
                </button>
              )}
              <SettingsPanelSuspense key={tab}>
                {panels[tab]()}
              </SettingsPanelSuspense>
            </div>
          </SettingsScrollContainer>
        )}
      </div>
      </SettingsSectionsProvider>
    </Modal>
  );
}
