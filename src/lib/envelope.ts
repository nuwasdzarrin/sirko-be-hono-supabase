import type { ErrorCode } from './errors.js';

/** Envelope sukses: `{ data, meta? }` (spec 10 §0). */
export interface SuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/** Envelope error: `{ error: { code, message, details? } }` (spec 10 §0). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export function ok<T>(data: T, meta?: Record<string, unknown>): SuccessEnvelope<T> {
  return meta ? { data, meta } : { data };
}

export function fail(code: ErrorCode, message: string, details?: unknown): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = { code, message };
  if (details !== undefined) error.details = details;
  return { error };
}
