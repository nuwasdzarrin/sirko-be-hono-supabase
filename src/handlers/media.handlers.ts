import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { ok } from '../lib/envelope.js';
import { signUploadSchema } from '../schemas/catalog.schema.js';
import * as media from '../services/media.service.js';

export async function handleSignUpload(c: Context<AppEnv>) {
  const input = signUploadSchema.parse(await c.req.json());
  const isSirkoAdmin = c.get('auth').role === 'sirko_admin';
  const result = media.signUpload(input, isSirkoAdmin);
  return c.json(ok(result), 200);
}
