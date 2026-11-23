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

/** POST /v1/media/upload — body = biner gambar; `?fileName=` opsional. Untuk web app (browser). */
export async function handleDirectUpload(c: Context<AppEnv>) {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > media.MAX_DIRECT_UPLOAD_BYTES) {
    return c.json({ error: { code: 'VALIDATION', message: `Gambar ${Math.ceil(len / 1024)} KB — maksimal 400 KB.` } }, 422);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const result = await media.uploadProductImage(bytes, c.req.query('fileName') ?? 'foto');
  return c.json(ok(result), 201);
}
