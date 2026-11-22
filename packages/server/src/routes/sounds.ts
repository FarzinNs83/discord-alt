import type { FastifyInstance } from 'fastify';
import { and, asc, count, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SOUNDBOARD, type SpaceSound, type UploadSpaceSoundRequest } from '@patogh/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { isMember, hasPermission, PermissionBits } from '../utils/permissions.js';
import { connectionManager } from '../ws/handler.js';
import { sendError } from '../utils/httpErrors.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';

const FILE_PATTERN = /^[a-f0-9]{64}\.(ogg|webm|wav|mp3)$/;
const MIME: Record<string, string> = { ogg: 'audio/ogg', webm: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg' };

const playLimit = createFixedWindowLimit({ max: 1, windowMs: SOUNDBOARD.cooldownMs });
const uploadLimit = createFixedWindowLimit({ max: 10, windowMs: 60_000 });

/** Tests only. */
export function _resetSoundLimits(): void {
  playLimit.reset();
  uploadLimit.reset();
}

const soundDir = () => path.join(config.uploadDir, 'sounds');

/**
 * The container format from the file's first bytes. There is no audio decoder
 * on the server, so this signature check plus the size cap is the whole
 * validation; the file is only ever served back as that audio type.
 */
export function sniffAudio(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

function toWire(row: typeof schema.spaceSounds.$inferSelect): SpaceSound {
  return { id: row.id, spaceId: row.spaceId, name: row.name, emoji: row.emoji, url: `/api/sounds/${row.file}`, uploadedBy: row.uploadedBy };
}

function announce(spaceId: string): void {
  connectionManager.sendToSpace(spaceId, { type: 'space_sounds_changed', spaceId });
}

export async function soundRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/spaces/:id/sounds', { preHandler: authenticate }, async (request, reply) => {
    if (!isMember(request.params.id, request.userId)) return sendError(reply, 403, 'not_space_member');
    return getDb().select().from(schema.spaceSounds)
      .where(eq(schema.spaceSounds.spaceId, request.params.id))
      .orderBy(asc(schema.spaceSounds.createdAt))
      .all().map(toWire);
  });

  app.post<{ Params: { id: string }; Body: UploadSpaceSoundRequest }>('/api/spaces/:id/sounds', {
    preHandler: authenticate,
    bodyLimit: Math.ceil(SOUNDBOARD.maxBytes / 3) * 4 + 4096,
    schema: { body: { type: 'object', required: ['name', 'audio'], additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: SOUNDBOARD.maxNameLength },
      emoji: { type: ['string', 'null'], maxLength: 16 },
      audio: { type: 'string', minLength: 16 },
    } } },
  }, async (request, reply) => {
    const spaceId = request.params.id;
    if (!isMember(spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
    if (!hasPermission(request.userId, spaceId, PermissionBits.MANAGE_CHANNELS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_CHANNELS' });
    }
    if (!uploadLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const name = request.body.name.trim();
    const emoji = request.body.emoji?.trim() || null;
    const { audio } = request.body;
    if (!name || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) return sendError(reply, 400, 'validation_failed');
    const bytes = Buffer.from(audio, 'base64');
    const ext = sniffAudio(bytes);
    if (!ext || bytes.length > SOUNDBOARD.maxBytes) return sendError(reply, 400, 'validation_failed');

    const db = getDb();
    const existing = db.select({ n: count() }).from(schema.spaceSounds).where(eq(schema.spaceSounds.spaceId, spaceId)).get()?.n ?? 0;
    if (existing >= SOUNDBOARD.maxPerSpace) return sendError(reply, 409, 'validation_failed');

    const file = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    await mkdir(soundDir(), { recursive: true });
    // Write then rename, so a concurrent identical upload never serves a truncated file.
    const temporary = path.join(soundDir(), `${file}.${randomUUID()}.tmp`);
    await writeFile(temporary, bytes);
    await rename(temporary, path.join(soundDir(), file));

    const row = { id: generateSnowflake(), spaceId, name, emoji, file, uploadedBy: request.userId, createdAt: Date.now() };
    db.insert(schema.spaceSounds).values(row).run();
    announce(spaceId);
    return reply.code(201).send(toWire(row));
  });

  app.delete<{ Params: { id: string; soundId: string } }>('/api/spaces/:id/sounds/:soundId', { preHandler: authenticate }, async (request, reply) => {
    const { id: spaceId, soundId } = request.params;
    if (!isMember(spaceId, request.userId)) return sendError(reply, 403, 'not_space_member');
    const db = getDb();
    const sound = db.select().from(schema.spaceSounds)
      .where(and(eq(schema.spaceSounds.id, soundId), eq(schema.spaceSounds.spaceId, spaceId))).get();
    if (!sound) return sendError(reply, 404, 'not_found');
    if (sound.uploadedBy !== request.userId && !hasPermission(request.userId, spaceId, PermissionBits.MANAGE_CHANNELS)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_CHANNELS' });
    }
    db.delete(schema.spaceSounds).where(eq(schema.spaceSounds.id, soundId)).run();
    // Identical uploads share one file; it goes when the last sound using it does.
    const stillUsed = db.select({ n: count() }).from(schema.spaceSounds).where(eq(schema.spaceSounds.file, sound.file)).get()?.n ?? 0;
    if (!stillUsed) await rm(path.join(soundDir(), sound.file), { force: true });
    announce(spaceId);
    return reply.send({ success: true });
  });

  // Play to everyone in the caller's voice channel, which must be in this space.
  app.post<{ Params: { id: string; soundId: string } }>('/api/spaces/:id/sounds/:soundId/play', { preHandler: authenticate }, async (request, reply) => {
    const { id: spaceId, soundId } = request.params;
    const inRoom = connectionManager.getUserRoom(request.userId);
    if (!inRoom || inRoom.room.metadata.type !== 'space' || inRoom.room.metadata.spaceId !== spaceId) {
      return sendError(reply, 403, 'forbidden');
    }
    const sound = getDb().select({ id: schema.spaceSounds.id }).from(schema.spaceSounds)
      .where(and(eq(schema.spaceSounds.id, soundId), eq(schema.spaceSounds.spaceId, spaceId))).get();
    if (!sound) return sendError(reply, 404, 'not_found');
    if (!playLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const event = { type: 'soundboard_played' as const, spaceId, channelId: inRoom.roomId, soundId, userId: request.userId };
    for (const uid of inRoom.room.participants) connectionManager.sendToUser(uid, event);
    return reply.send({ success: true });
  });

  // Public like sticker assets: the name is a content hash, and the bytes are only ever served as audio.
  app.get<{ Params: { file: string } }>('/api/sounds/:file', async (request, reply) => {
    const { file } = request.params;
    if (!FILE_PATTERN.test(file)) return sendError(reply, 404, 'not_found');
    const row = getDb().select({ file: schema.spaceSounds.file }).from(schema.spaceSounds).where(eq(schema.spaceSounds.file, file)).get();
    if (!row) return sendError(reply, 404, 'not_found');
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(soundDir(), row.file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return sendError(reply, 404, 'not_found');
      throw error;
    }
    return reply.type(MIME[row.file.split('.').pop()!]!)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'")
      .header('X-Frame-Options', 'DENY')
      .send(bytes);
  });
}
