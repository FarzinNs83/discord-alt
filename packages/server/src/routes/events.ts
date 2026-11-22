import type { FastifyInstance } from 'fastify';
import { and, eq, gte, asc, inArray } from 'drizzle-orm';
import { MAX_SPACE_EVENT_TITLE_LENGTH, type CreateSpaceEventRequest, type SpaceEvent } from '@patogh/shared';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { isMember, hasPermission, PermissionBits } from '../utils/permissions.js';
import { connectionManager } from '../ws/handler.js';
import { sendError } from '../utils/httpErrors.js';

/** An event stays on the card this long after it starts, so a running one is still visible. */
const EVENT_GRACE_MS = 3 * 60 * 60 * 1000;
/** Furthest ahead an event may be scheduled. */
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_LISTED = 20;

type Params = { id: string };
type EventParams = { id: string; eventId: string };

function listEvents(spaceId: string, viewerId: string): SpaceEvent[] {
  const db = getDb();
  const rows = db.select().from(schema.spaceEvents)
    .where(and(eq(schema.spaceEvents.spaceId, spaceId), gte(schema.spaceEvents.startsAt, Date.now() - EVENT_GRACE_MS)))
    .orderBy(asc(schema.spaceEvents.startsAt))
    .limit(MAX_LISTED)
    .all();
  if (rows.length === 0) return [];

  // Only people still in the space count, so leaving drops an RSVP without cleanup.
  const rsvps = db.select({ eventId: schema.spaceEventRsvps.eventId, userId: schema.spaceEventRsvps.userId })
    .from(schema.spaceEventRsvps)
    .innerJoin(schema.spaceMembers, and(
      eq(schema.spaceMembers.userId, schema.spaceEventRsvps.userId),
      eq(schema.spaceMembers.spaceId, spaceId),
    ))
    .where(inArray(schema.spaceEventRsvps.eventId, rows.map((r) => r.id)))
    .all();

  return rows.map((r) => {
    const going = rsvps.filter((x) => x.eventId === r.id);
    return {
      id: r.id,
      spaceId: r.spaceId,
      channelId: r.channelId,
      title: r.title,
      startsAt: r.startsAt,
      createdBy: r.createdBy,
      goingCount: going.length,
      going: going.some((x) => x.userId === viewerId),
    };
  });
}

function announce(spaceId: string): void {
  connectionManager.sendToSpace(spaceId, { type: 'space_events_changed', spaceId });
}

function findEvent(spaceId: string, eventId: string) {
  return getDb().select().from(schema.spaceEvents)
    .where(and(eq(schema.spaceEvents.id, eventId), eq(schema.spaceEvents.spaceId, spaceId)))
    .get();
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: Params }>('/api/spaces/:id/events', { preHandler: authenticate }, async (request, reply) => {
    if (!isMember(request.params.id, request.userId)) return sendError(reply, 403, 'not_space_member');
    return reply.send(listEvents(request.params.id, request.userId));
  });

  app.post<{ Params: Params; Body: CreateSpaceEventRequest }>('/api/spaces/:id/events', { preHandler: authenticate }, async (request, reply) => {
    const spaceId = request.params.id;
    if (!isMember(spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
    if (!hasPermission(request.userId, spaceId, PermissionBits.MANAGE_CHANNELS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_CHANNELS' });
    }

    const body = request.body ?? ({} as CreateSpaceEventRequest);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const startsAt = body.startsAt;
    const now = Date.now();
    if (!title || title.length > MAX_SPACE_EVENT_TITLE_LENGTH
      || typeof startsAt !== 'number' || !Number.isFinite(startsAt)
      || startsAt < now - EVENT_GRACE_MS || startsAt > now + MAX_LEAD_MS) {
      return sendError(reply, 400, 'validation_failed');
    }

    const channelId = body.channelId ?? null;
    if (channelId !== null) {
      const channel = getDb().select({ spaceId: schema.channels.spaceId }).from(schema.channels)
        .where(eq(schema.channels.id, String(channelId))).get();
      if (channel?.spaceId !== spaceId || !hasPermission(request.userId, spaceId, PermissionBits.VIEW_CHANNEL, String(channelId))) {
        return sendError(reply, 400, 'validation_failed');
      }
    }

    const id = generateSnowflake();
    getDb().insert(schema.spaceEvents).values({
      id, spaceId, channelId: channelId === null ? null : String(channelId), title, startsAt: Math.round(startsAt), createdBy: request.userId, createdAt: now,
    }).run();
    announce(spaceId);
    return reply.code(201).send(listEvents(spaceId, request.userId).find((e) => e.id === id));
  });

  app.delete<{ Params: EventParams }>('/api/spaces/:id/events/:eventId', { preHandler: authenticate }, async (request, reply) => {
    const { id: spaceId, eventId } = request.params;
    if (!isMember(spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
    const event = findEvent(spaceId, eventId);
    if (!event) return sendError(reply, 404, 'not_found');
    if (event.createdBy !== request.userId && !hasPermission(request.userId, spaceId, PermissionBits.MANAGE_CHANNELS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_CHANNELS' });
    }
    getDb().delete(schema.spaceEvents).where(eq(schema.spaceEvents.id, eventId)).run();
    announce(spaceId);
    return reply.send({ success: true });
  });

  // RSVP: PUT says "I'm in", DELETE takes it back. Both are idempotent.
  for (const method of ['PUT', 'DELETE'] as const) {
    app.route<{ Params: EventParams }>({
      method,
      url: '/api/spaces/:id/events/:eventId/rsvp',
      preHandler: authenticate,
      handler: async (request, reply) => {
        const { id: spaceId, eventId } = request.params;
        if (!isMember(spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
        if (!findEvent(spaceId, eventId)) return sendError(reply, 404, 'not_found');
        const db = getDb();
        const result = method === 'PUT'
          ? db.insert(schema.spaceEventRsvps).values({ eventId, userId: request.userId, createdAt: Date.now() }).onConflictDoNothing().run()
          : db.delete(schema.spaceEventRsvps)
            .where(and(eq(schema.spaceEventRsvps.eventId, eventId), eq(schema.spaceEventRsvps.userId, request.userId)))
            .run();
        // A repeat of the same answer changes nothing, so nobody needs telling.
        if (result.changes > 0) announce(spaceId);
        return reply.send(listEvents(spaceId, request.userId).find((e) => e.id === eventId) ?? null);
      },
    });
  }
}

