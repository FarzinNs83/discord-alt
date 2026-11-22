import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@patogh/shared';

const state = {
  showDms: true,
  memberListOpen: true,
  currentSpaceId: null as string | null,
  currentChannelId: 'dm-1',
  dmChannels: [] as { id: string; ownerId?: string; members: User[] }[],
};

const selectFrom = (s: unknown) => <T,>(selector: (s: never) => T) => selector(s as never);
vi.mock('../../stores/uiStore', () => ({ useUIStore: (sel: (s: never) => unknown) => selectFrom(state)(sel) }));
vi.mock('../../stores/spaceStore', () => ({ useSpaceStore: (sel: (s: never) => unknown) => selectFrom(state)(sel) }));
vi.mock('../../stores/chatStore', () => ({ useChatStore: (sel: (s: never) => unknown) => selectFrom(state)(sel) }));
vi.mock('../../hooks/useDmViewer', () => ({ useDmViewer: () => ({ self: { key: 'me', rowIds: new Map([['', 'me']]) }, origin: '' }) }));

vi.mock('./MemberSidebar', () => ({ MemberSidebar: () => <div>members</div> }));
vi.mock('./ActivityPanel', () => ({ ActivityPanel: () => <div>activity</div> }));
vi.mock('./DmRosterPanel', () => ({ DmRosterPanel: () => <div>roster</div> }));
vi.mock('./DmProfilePanel', () => ({ DmProfilePanel: ({ partner }: { partner: User }) => <div>profile of {partner.username}</div> }));

import { RightPanel } from './RightPanel';

const person = (id: string) => ({ id, username: id }) as User;

describe('RightPanel in the DM view', () => {
  beforeEach(() => {
    state.memberListOpen = true;
    state.dmChannels = [];
  });

  it('shows the partner profile in a 1-on-1 DM', () => {
    state.dmChannels = [{ id: 'dm-1', members: [person('me'), person('sara')] }];
    render(<RightPanel />);
    expect(screen.getByText('profile of sara')).toBeInTheDocument();
  });

  it('shows the roster in a group DM', () => {
    state.dmChannels = [{ id: 'dm-1', ownerId: 'me', members: [person('me'), person('sara'), person('kian')] }];
    render(<RightPanel />);
    expect(screen.getByText('roster')).toBeInTheDocument();
  });

  it('falls back to activity when the panel is toggled off or nobody else is left', () => {
    state.dmChannels = [{ id: 'dm-1', members: [person('me'), person('sara')] }];
    state.memberListOpen = false;
    const { unmount } = render(<RightPanel />);
    expect(screen.getByText('activity')).toBeInTheDocument();
    unmount();

    state.memberListOpen = true;
    state.dmChannels = [{ id: 'dm-1', members: [person('me')] }];
    render(<RightPanel />);
    expect(screen.getByText('activity')).toBeInTheDocument();
  });
});
