import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as schema from '../db/schema.js';

let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let app: FastifyInstance;
const settings = vi.hoisted(() => ({ uploadDir: '' }));
const sentToSpace = vi.hoisted(() => [] as unknown[]);
const sentToUser = vi.hoisted(() => [] as [string, unknown][]);
const rooms = vi.hoisted(() => new Map<string, { roomId: string; room: { metadata: { type: string; spaceId: string }; participants: Set<string> } }>());

vi.mock('../db/index.js', () => ({ getDb: () => db, schema }));
vi.mock('../config.js', () => ({ config: settings }));
vi.mock('../ws/handler.js', () => ({ connectionManager: {
  sendToSpace: (_id: string, e: unknown) => sentToSpace.push(e),
  sendToUser: (uid: string, e: unknown) => sentToUser.push([uid, e]),
  getUserRoom: (uid: string) => rooms.get(uid) ?? null,
} }));
vi.mock('../utils/permissions.js', () => ({
  PermissionBits: { MANAGE_CHANNELS: 4n },
  isMember: (spaceId: string, userId: string) =>
    !!db.select().from(schema.spaceMembers).all().find((m) => m.spaceId === spaceId && m.userId === userId),
  hasPermission: (userId: string) => userId === 'darya',
}));
vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId: string; headers: Record<string, string> }, reply: { code: (code: number) => { send: () => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send();
    request.userId = request.headers.authorization;
  },
}));
import { soundRoutes, sniffAudio, _resetSoundLimits } from './sounds.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);

const ogg = (tag = 'a') => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40, tag)]).toString('base64');

beforeEach(async () => {
  _resetSoundLimits();
  sentToSpace.length = 0;
  sentToUser.length = 0;
  rooms.clear();
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'patogh-sounds-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });
  for (const id of ['darya', 'sara', 'kian']) db.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  for (const id of ['gn', 'other']) db.insert(schema.spaces).values({ id, name: id, ownerId: 'darya', createdAt: 1 }).run();
  for (const userId of ['darya', 'sara', 'kian']) db.insert(schema.spaceMembers).values({ spaceId: 'gn', userId, joinedAt: 1 }).run();
  db.insert(schema.spaceMembers).values({ spaceId: 'other', userId: 'darya', joinedAt: 1 }).run();
  app = Fastify();
  await app.register(soundRoutes);
});
afterEach(async () => {
  await app.close();
  sqlite.close();
  await rm(settings.uploadDir, { recursive: true, force: true });
});

const as = (user: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: user }, ...(payload ? { payload } : {}) });
const upload = (space = 'gn', audio = ogg(), user = 'darya') =>
  as(user, 'POST', `/api/spaces/${space}/sounds`, { name: ' Drumroll ', emoji: '🥁', audio });

describe('sniffAudio', () => {
  it('names the container from its signature and refuses anything else', () => {
    const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(16)]);
    expect(sniffAudio(pad(Buffer.from('OggS')))).toBe('ogg');
    expect(sniffAudio(pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))).toBe('webm');
    expect(sniffAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)]))).toBe('wav');
    expect(sniffAudio(pad(Buffer.from('ID3')))).toBe('mp3');
    expect(sniffAudio(pad(Buffer.from([0xff, 0xfb])))).toBe('mp3');
    expect(sniffAudio(pad(Buffer.from('<svg')))).toBeNull();
    expect(sniffAudio(Buffer.from('OggS'))).toBeNull();
  });
});

describe('space soundboard', () => {
  it('lets a manager upload, members list it, and serves it as audio', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);
    const sound = res.json();
    expect(sound).toMatchObject({ name: 'Drumroll', emoji: '🥁', url: expect.stringMatching(/^\/api\/sounds\/[a-f0-9]{64}\.ogg$/) });
    expect(sentToSpace).toEqual([{ type: 'space_sounds_changed', spaceId: 'gn' }]);
    expect((await as('sara', 'GET', '/api/spaces/gn/sounds')).json()).toEqual([sound]);

    const file = await app.inject({ url: sound.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('audio/ogg');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses non-managers, outsiders, non-audio and oversized files', async () => {
    expect((await upload('gn', ogg(), 'sara')).statusCode).toBe(403);
    expect((await as('sara', 'GET', '/api/spaces/other/sounds')).statusCode).toBe(403);
    expect((await upload('gn', Buffer.from('<svg onload=alert(1)></svg>').toString('base64'))).statusCode).toBe(400);
    expect((await upload('gn', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(1024 * 1024)]).toString('base64'))).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/sounds/../../etc/passwd' })).statusCode).toBe(404);
  });

  it('keeps a shared file until the last sound using it is deleted', async () => {
    const a = (await upload('gn')).json();
    const b = (await upload('other')).json();
    expect(a.url).toBe(b.url);
    const files = () => readdir(path.join(settings.uploadDir, 'sounds'));

    expect((await as('sara', 'DELETE', `/api/spaces/gn/sounds/${a.id}`)).statusCode).toBe(403);
    expect((await as('darya', 'DELETE', `/api/spaces/gn/sounds/${a.id}`)).statusCode).toBe(200);
    expect(await files()).toHaveLength(1);
    expect((await as('darya', 'DELETE', `/api/spaces/other/sounds/${b.id}`)).statusCode).toBe(200);
    expect(await files()).toHaveLength(0);
    expect((await app.inject({ url: a.url })).statusCode).toBe(404);
  });

  it('plays only to the people in the caller’s voice channel, once per cooldown', async () => {
    const sound = (await upload()).json();
    const room = { roomId: 'lounge', room: { metadata: { type: 'space', spaceId: 'gn' }, participants: new Set(['sara', 'kian']) } };
    const play = (user: string) => as(user, 'POST', `/api/spaces/gn/sounds/${sound.id}/play`);

    expect((await play('sara')).statusCode).toBe(403); // not in a call
    rooms.set('sara', room);
    expect((await play('sara')).statusCode).toBe(200);
    expect(sentToUser.map(([uid]) => uid).sort()).toEqual(['kian', 'sara']);
    expect(sentToUser[0]![1]).toEqual({ type: 'soundboard_played', spaceId: 'gn', channelId: 'lounge', soundId: sound.id, userId: 'sara' });
    expect((await play('sara')).statusCode).toBe(429);

    rooms.set('kian', { roomId: 'x', room: { metadata: { type: 'space', spaceId: 'other' }, participants: new Set(['kian']) } });
    expect((await play('kian')).statusCode).toBe(403); // in a call in another space
  });
});
