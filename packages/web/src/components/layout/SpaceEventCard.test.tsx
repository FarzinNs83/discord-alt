import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Channel, SpaceEvent } from '@patogh/shared';

const api = vi.hoisted(() => ({
  spaces: {
    events: vi.fn(),
    rsvp: vi.fn(),
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
  },
}));
vi.mock('../../utils/crossStoreResolvers', () => ({ getApiForOrigin: () => api }));
vi.mock('../../stores/spaceStore', () => ({ getMyUserIdForOrigin: () => 'me' }));

import { SpaceEventCard } from './SpaceEventCard';
import { useEventStore } from '../../stores/eventStore';

const room = { id: 'room', name: 'Game Room', type: 'voice' } as Channel;
const event = (o: Partial<SpaceEvent> = {}): SpaceEvent => ({
  id: 'e1', spaceId: 'gn', channelId: 'room', title: 'Mafia night',
  startsAt: Date.now() + 3 * 60 * 60 * 1000, createdBy: 'darya', goingCount: 13, going: false, ...o,
});

const renderCard = (canManage = false) =>
  render(<SpaceEventCard spaceId="gn" origin="" channels={[room]} canManage={canManage} />);

beforeEach(() => {
  vi.clearAllMocks();
  useEventStore.setState({ bySpace: new Map() });
});

describe('SpaceEventCard', () => {
  it('shows the next event with its place, and RSVP flips the pill', async () => {
    api.spaces.events.mockResolvedValue([event()]);
    api.spaces.rsvp.mockResolvedValue(event({ going: true, goingCount: 14 }));
    renderCard();

    expect(await screen.findByText('Mafia night in Game Room')).toBeInTheDocument();
    const pill = screen.getByRole('button', { name: '13 in' });
    expect(pill).toHaveAttribute('aria-pressed', 'false');
    // Not the creator and no Manage Channels: nothing to cancel or schedule.
    expect(screen.queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule an event' })).not.toBeInTheDocument();

    fireEvent.click(pill);
    expect(await screen.findByRole('button', { name: '14 in' })).toHaveAttribute('aria-pressed', 'true');
    expect(api.spaces.rsvp).toHaveBeenCalledWith('gn', 'e1', true);
  });

  it('shows nothing to members when there is no event, and a schedule button to managers', async () => {
    api.spaces.events.mockResolvedValue([]);
    const { container, unmount } = renderCard();
    await waitFor(() => expect(api.spaces.events).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    renderCard(true);
    expect(await screen.findByRole('button', { name: 'Schedule an event' })).toBeInTheDocument();
  });

  it('lets the creator cancel their own event', async () => {
    api.spaces.events.mockResolvedValueOnce([event({ createdBy: 'me' })]).mockResolvedValueOnce([]);
    api.spaces.deleteEvent.mockResolvedValue({ success: true });
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel event' }));
    const confirm = await screen.findAllByRole('button', { name: 'Cancel event' });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(api.spaces.deleteEvent).toHaveBeenCalledWith('gn', 'e1'));
    await waitFor(() => expect(screen.queryByText('Mafia night in Game Room')).not.toBeInTheDocument());
  });

  it('schedules an event from the form', async () => {
    api.spaces.events.mockResolvedValue([]);
    api.spaces.createEvent.mockResolvedValue(event());
    renderCard(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Schedule an event' }));
    fireEvent.change(screen.getByLabelText('What'), { target: { value: '  Mafia night ' } });
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: 'room' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    await waitFor(() => expect(api.spaces.createEvent).toHaveBeenCalledWith('gn', expect.objectContaining({
      title: 'Mafia night', channelId: 'room', startsAt: expect.any(Number),
    })));
  });
});
