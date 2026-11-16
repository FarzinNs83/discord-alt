import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'owner';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    addUserSpace: vi.fn(),
    removeUserSpace: vi.fn(),
    sendToSpace: vi.fn(),
    sendToUser: vi.fn(),
  },
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const now = 1_700_000_000_000;
let app: FastifyInstance;

function addUser(id: string): void {
  testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: now }).run();
}

function mainSpaceId(): string | null {
  return testDb.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get()?.mainSpaceId ?? null;
}

function memberIds(spaceId: string): string[] {
  return testDb.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, spaceId)).all().map(m => m.userId).sort();
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  addUser('owner');
  addUser('member');
  testDb.insert(schema.instanceSettings).values({ id: 1, instanceName: 'Home', ownerUserId: 'owner', updatedAt: now }).run();

  const { spaceRoutes } = await import('./spaces.js');
  app = Fastify();
  await app.register(spaceRoutes);
});

describe('main space', () => {
  it('is created for the owner with default channels, and every local user joins it', async () => {
    const { ensureMainSpace } = await import('./spaces.js');
    ensureMainSpace();
    const id = mainSpaceId()!;
    const space = testDb.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get()!;
    expect(space).toMatchObject({ name: 'Home', ownerId: 'owner' });
    expect(testDb.select().from(schema.channels).where(eq(schema.channels.spaceId, id)).all()).toHaveLength(25);
    expect(memberIds(id)).toEqual(['member', 'owner']);
    const memberRole = testDb.select().from(schema.roles).where(eq(schema.roles.name, 'Member')).get()!;
    expect(testDb.select().from(schema.memberRoles).all().map(r => [r.userId, r.roleId])).toEqual([['member', memberRole.id]]);

    // Idempotent: a second boot neither creates another space nor re-adds anyone.
    testDb.delete(schema.spaceMembers).where(eq(schema.spaceMembers.userId, 'member')).run();
    ensureMainSpace();
    expect(testDb.select().from(schema.spaces).all()).toHaveLength(1);
    expect(memberIds(id)).toEqual(['owner']);
  });

  it('default roles and overrides gate the default channels', async () => {
    const { ensureMainSpace } = await import('./spaces.js');
    const { computePermissions, PermissionBits: P } = await import('../utils/permissions.js');
    ensureMainSpace();
    const id = mainSpaceId()!;
    const channel = (name: string) => testDb.select().from(schema.channels).where(eq(schema.channels.name, name)).get()!.id;
    const role = (name: string) => testDb.select().from(schema.roles).where(eq(schema.roles.name, name)).get()!.id;
    const can = (bit: bigint, name: string) => (computePermissions('member', id, channel(name)) & bit) !== 0n;
    const giveRole = (name: string) => testDb.insert(schema.memberRoles).values({ spaceId: id, userId: 'member', roleId: role(name) }).run();

    expect(testDb.select().from(schema.roles).where(eq(schema.roles.spaceId, id)).all().map(r => r.name).sort())
      .toEqual(['@everyone', 'Admin', 'Helper', 'Member', 'Moderator', 'Muted', 'VIP']);

    // Plain member: talks in general, reads but cannot post in rules, does not see staff or VIP.
    expect(can(P.SEND_MESSAGES, 'general')).toBe(true);
    expect(can(P.VIEW_CHANNEL, 'rules')).toBe(true);
    expect(can(P.SEND_MESSAGES, 'rules')).toBe(false);
    expect(can(P.VIEW_CHANNEL, 'staff-chat')).toBe(false);
    expect(can(P.VIEW_CHANNEL, 'vip-lounge')).toBe(false);

    giveRole('VIP');
    expect(can(P.CONNECT, 'vip-lounge')).toBe(true);
    expect(can(P.VIEW_CHANNEL, 'staff-chat')).toBe(false);

    giveRole('Muted');
    expect(can(P.SEND_MESSAGES, 'general')).toBe(false);
    expect(can(P.SPEAK, 'lobby')).toBe(false);
    expect(can(P.VIEW_CHANNEL, 'general')).toBe(true);

    testDb.delete(schema.memberRoles).run();
    giveRole('Moderator');
    expect(can(P.VIEW_CHANNEL, 'staff-chat')).toBe(true);
    expect(can(P.SEND_MESSAGES, 'announcements')).toBe(true);
    expect(can(P.SEND_MESSAGES, 'rules')).toBe(false);
  });

  it("adopts the owner's existing space instead of creating one", async () => {
    testDb.insert(schema.spaces).values({ id: 'old', name: 'Old', ownerId: 'owner', createdAt: now }).run();
    const { ensureMainSpace } = await import('./spaces.js');
    ensureMainSpace();
    expect(mainSpaceId()).toBe('old');
    expect(testDb.select().from(schema.spaces).all()).toHaveLength(1);
  });

  it('joinMainSpace skips a user banned from it', async () => {
    const { ensureMainSpace, joinMainSpace } = await import('./spaces.js');
    ensureMainSpace();
    addUser('banned');
    testDb.insert(schema.bans).values({ spaceId: mainSpaceId()!, userId: 'banned', bannedBy: 'owner', createdAt: now }).run();
    joinMainSpace('banned');
    expect(memberIds(mainSpaceId()!)).not.toContain('banned');
  });

  it('cannot be deleted, left, or transferred', async () => {
    const { ensureMainSpace } = await import('./spaces.js');
    ensureMainSpace();
    const id = mainSpaceId()!;

    const del = await app.inject({ method: 'DELETE', url: `/api/spaces/${id}` });
    expect(del.json().code).toBe('single_space_mode');

    const transfer = await app.inject({ method: 'PATCH', url: `/api/spaces/${id}/transfer-ownership`, payload: { newOwnerId: 'member' } });
    expect(transfer.json().code).toBe('single_space_mode');

    currentUserId = 'member';
    const leave = await app.inject({ method: 'DELETE', url: `/api/spaces/${id}/members/member` });
    expect(leave.json().code).toBe('single_space_mode');
    expect(memberIds(id)).toContain('member');
  });
});
