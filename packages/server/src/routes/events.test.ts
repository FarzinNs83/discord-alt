import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let app: FastifyInstance;
const sent = vi.hoisted(() => [] as unknown[]);
const managers = vi.hoisted(() => new Set<string>());

vi.mock('../db/index.js', () => ({ getDb: () => db, schema }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToSpace: (_id: string, e: unknown) => sent.push(e) } }));
vi.mock('../utils/permissions.js', () => ({
  PermissionBits: { MANAGE_CHANNELS: 4n, VIEW_CHANNEL: 2n },
  isMember: (spaceId: string, userId: string) =>
    !!db.select().from(schema.spaceMembers).all().find((m) => m.spaceId === spaceId && m.userId === userId),
  hasPermission: (userId: string, _space: string, bit: bigint) => bit === 2n || managers.has(userId),
}));
vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId: string; headers: Record<string, string> }, reply: { code: (code: number) => { send: () => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send();
    request.userId = request.headers.authorization;
  },
}));
import { eventRoutes } from './events.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  sent.length = 0;
  managers.clear();
  managers.add('darya');
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });
  for (const id of ['darya', 'sara', 'outsider']) {
    db.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  db.insert(schema.spaces).values({ id: 'gn', name: 'Game Night', ownerId: 'darya', createdAt: 1 }).run();
  db.insert(schema.spaces).values({ id: 'other', name: 'Other', ownerId: 'darya', createdAt: 1 }).run();
  for (const userId of ['darya', 'sara']) db.insert(schema.spaceMembers).values({ spaceId: 'gn', userId, joinedAt: 1 }).run();
  db.insert(schema.channels).values({ id: 'room', spaceId: 'gn', name: 'Game Room', type: 'voice', createdAt: 1 }).run();
  db.insert(schema.channels).values({ id: 'elsewhere', spaceId: 'other', name: 'x', type: 'voice', createdAt: 1 }).run();
  app = Fastify();
  await app.register(eventRoutes);
});
afterEach(async () => {
  await app.close();
  sqlite.close();
});

const as = (user: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: user }, ...(payload ? { payload } : {}) });

const create = (user = 'darya', body: object = { title: 'Mafia night', startsAt: Date.now() + 24 * HOUR, channelId: 'room' }) =>
  as(user, 'POST', '/api/spaces/gn/events', body);

describe('space events', () => {
  it('lets a manager schedule one and members see it with RSVP counts', async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    const event = res.json();
    expect(event).toMatchObject({ title: 'Mafia night', channelId: 'room', goingCount: 0, going: false });
    expect(sent).toEqual([{ type: 'space_events_changed', spaceId: 'gn' }]);

    expect((await as('sara', 'PUT', `/api/spaces/gn/events/${event.id}/rsvp`)).json()).toMatchObject({ goingCount: 1, going: true });
    // Saying it twice changes nothing and tells nobody.
    sent.length = 0;
    await as('sara', 'PUT', `/api/spaces/gn/events/${event.id}/rsvp`);
    expect(sent).toEqual([]);

    const forDarya = (await as('darya', 'GET', '/api/spaces/gn/events')).json();
    expect(forDarya).toEqual([expect.objectContaining({ id: event.id, goingCount: 1, going: false })]);

    expect((await as('sara', 'DELETE', `/api/spaces/gn/events/${event.id}/rsvp`)).json()).toMatchObject({ goingCount: 0, going: false });
  });

  it('keeps non-members and non-managers out', async () => {
    expect((await as('outsider', 'GET', '/api/spaces/gn/events')).statusCode).toBe(403);
    expect((await create('sara')).statusCode).toBe(403);
    const event = (await create()).json();
    expect((await as('outsider', 'PUT', `/api/spaces/gn/events/${event.id}/rsvp`)).statusCode).toBe(403);
    expect((await as('sara', 'DELETE', `/api/spaces/gn/events/${event.id}`)).statusCode).toBe(403);
    expect((await as('darya', 'DELETE', `/api/spaces/other/events/${event.id}`)).statusCode).toBe(403);
  });

  it('rejects bad titles, times and channels from another space', async () => {
    const soon = Date.now() + HOUR;
    for (const body of [
      { title: '  ', startsAt: soon },
      { title: 'x'.repeat(101), startsAt: soon },
      { title: 'Old', startsAt: Date.now() - 4 * HOUR },
      { title: 'Far', startsAt: Date.now() + 400 * 24 * HOUR },
      { title: 'NaN', startsAt: 'tomorrow' },
      { title: 'Wrong room', startsAt: soon, channelId: 'elsewhere' },
    ]) {
      expect((await create('darya', body)).statusCode).toBe(400);
    }
  });

  it('lists upcoming events in order, drops old ones, and stops counting people who left', async () => {
    db.insert(schema.spaceEvents).values([
      { id: 'late', spaceId: 'gn', title: 'Later', startsAt: Date.now() + 48 * HOUR, createdBy: 'darya', createdAt: 1 },
      { id: 'soon', spaceId: 'gn', title: 'Soon', startsAt: Date.now() + HOUR, createdBy: 'darya', createdAt: 1 },
      { id: 'gone', spaceId: 'gn', title: 'Last week', startsAt: Date.now() - 7 * 24 * HOUR, createdBy: 'darya', createdAt: 1 },
    ]).run();
    db.insert(schema.spaceEventRsvps).values({ eventId: 'soon', userId: 'outsider', createdAt: 1 }).run();
    const list = (await as('sara', 'GET', '/api/spaces/gn/events')).json();
    expect(list.map((e: { id: string }) => e.id)).toEqual(['soon', 'late']);
    expect(list[0].goingCount).toBe(0);
  });

  it('lets the creator delete their event, and a deleted channel just clears the place', async () => {
    managers.add('sara');
    const event = (await create('sara')).json();
    managers.delete('sara');
    db.delete(schema.channels).where(eq(schema.channels.id, 'room')).run();
    expect((await as('sara', 'GET', '/api/spaces/gn/events')).json()[0].channelId).toBeNull();
    expect((await as('sara', 'DELETE', `/api/spaces/gn/events/${event.id}`)).statusCode).toBe(200);
    expect((await as('sara', 'GET', '/api/spaces/gn/events')).json()).toEqual([]);
  });
});
