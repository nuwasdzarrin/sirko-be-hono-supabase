/**
 * Klien API Sirko (same-origin: web app disajikan dari server API yang sama → tanpa CORS).
 * Amplop `{ data }` / `{ error: { code, message, details? } }`; `message` siap ditampilkan.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Gagal menjangkau server (offline, DNS, timeout) — bukan penolakan server. */
export class NetworkError extends Error {}

export interface ApiResult<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export type Fetcher = (path: string, init: RequestInit) => Promise<Response>;

let fetcher: Fetcher = (path, init) => fetch(path, init);

/** Ganti transport (test). */
export function setFetcher(f: Fetcher): () => void {
  const prev = fetcher;
  fetcher = f;
  return () => {
    fetcher = prev;
  };
}

export async function request<T>(method: string, path: string, opts: { body?: unknown; token?: string | null; timeoutMs?: number } = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetcher(path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    throw new NetworkError((e as Error).message || 'Tidak bisa terhubung ke server');
  }
  const json = (await res.json().catch(() => null)) as { data?: T; meta?: Record<string, unknown>; error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok || !json || json.error) {
    throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? `Server menjawab ${res.status}`, json?.error?.details);
  }
  return { data: json.data as T, meta: json.meta };
}

export const isOfflineError = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && e.status >= 500);
