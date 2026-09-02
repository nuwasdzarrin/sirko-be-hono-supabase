import type { Context } from 'hono';
import type { AppEnv } from '../types.ts';
import { ok } from '../lib/envelope.ts';
import { signUploadSchema } from '../schemas/catalog.schema.ts';
import * as media from '../services/media.service.ts';

export async function handleSignUpload(c: Context<AppEnv>) {
  const input = signUploadSchema.parse(await c.req.json());
  const isSirkoAdmin = c.get('auth').role === 'sirko_admin';
  const result = media.signUpload(input, isSirkoAdmin);
  return c.json(ok(result), 200);
}
