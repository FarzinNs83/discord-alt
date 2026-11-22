import React from 'react';
import { MemberSidebar } from './MemberSidebar';
import { ActivityPanel } from './ActivityPanel';
import { DmRosterPanel } from './DmRosterPanel';
import { DmProfilePanel } from './DmProfilePanel';
import type { User } from '@patogh/shared';
import { useDmViewer } from '../../hooks/useDmViewer';
import { isMine } from '../../utils/identity';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';

export function RightPanel() {
  const showDms = useUIStore((s) => s.showDms);
  const memberListOpen = useUIStore((s) => s.memberListOpen);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const currentChannelId = useChatStore((s) => s.currentChannelId);

  // In the DM view (showDms or no current space), the right column is normally
  // the activity panel. The exception is group DMs while the user has the
  // member list toggled on — then we swap in DmRosterPanel, which itself
  // returns null if any of its preconditions are unmet.
  if (showDms || !currentSpaceId) {
    const dmChannel = dmChannels.find((dm) => dm.id === currentChannelId);
    const isGroupDm = !!dmChannel?.ownerId;
    if (isGroupDm && memberListOpen) {
      return <DmRosterPanel />;
    }
    if (dmChannel && memberListOpen) {
      return <OneOnOneProfile dmId={dmChannel.id} members={dmChannel.members} />;
    }
    return <ActivityPanel />;
  }

  return <MemberSidebar />;
}

/** A 1-on-1 DM shows its partner's profile; a DM with nobody else left falls back to activity. */
function OneOnOneProfile({ dmId, members }: { dmId: string; members: User[] }) {
  const viewer = useDmViewer(dmId);
  const partner = members.find((m) => !isMine(m, viewer.origin, viewer.self));
  return partner ? <DmProfilePanel partner={partner} origin={viewer.origin} /> : <ActivityPanel />;
}
