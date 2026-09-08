import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { ok } from '../lib/envelope.js';
import { pushEnvelopeSchema, pullQuerySchema } from '../schemas/backup.schema.js';
import * as backup from '../services/backup.service.js';

/** businessId dijamin ada oleh requireTenant; ambil dari context (JWT). */
function businessId(c: Context<AppEnv>): string {
  return c.get('auth').businessId as string;
}

export async function handleBackupPush(c: Context<AppEnv>) {
  const envelope = pushEnvelopeSchema.parse(await c.req.json());
  const idempotencyKey = c.req.header('Idempotency-Key');
  const result = await backup.push(businessId(c), envelope, idempotencyKey);
  return c.json(ok(result), 200);
}

export async function handleBackupPull(c: Context<AppEnv>) {
  const query = pullQuerySchema.parse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });
  const { data, meta } = await backup.pull(businessId(c), query);
  return c.json(ok(data, meta), 200);
}

export async function handleBackupStatus(c: Context<AppEnv>) {
  const result = await backup.status(businessId(c));
  return c.json(ok(result), 200);
}
