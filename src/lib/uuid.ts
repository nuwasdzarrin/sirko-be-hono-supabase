import { randomUUID } from 'node:crypto';

/** UUID v4 baru (server-generated, mis. untuk business/user/account id). */
export function uuid(): string {
  return randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True bila `v` string UUID valid. ID dari client harus lolos ini. */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
