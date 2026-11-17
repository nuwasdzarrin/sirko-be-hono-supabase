import { createHash, createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { uuid } from './uuid.js';
import { AppError } from './errors.js';

/**
 * Abstraksi storage S3-compatible — presigned URL via AWS Signature V4
 * di-hand-roll dengan `node:crypto` (ZERO dependency). Portabel: Cloudflare R2,
 * Supabase Storage (endpoint S3), MinIO/VPS — cukup ganti env. Tak ada SDK.
 *
 * Semua key diberi folder lingkungan di depan (`STORAGE_ENV`): pemanggil memakai
 * key LOGIS (`catalog/x.jpg`), objek di bucket menjadi `prod/catalog/x.jpg`.
 */

export interface SignUploadInput {
  scope: 'catalog' | 'product';
  fileName: string;
  contentType: string;
  /** epoch detik (default 300). */
  expiresIn?: number;
}

export interface SignUploadResult {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  publicUrl: string;
  expiresIn: number;
}

export interface StorageProvider {
  signUpload(input: SignUploadInput): SignUploadResult;
  /** Presigned PUT URL untuk key PERSIS (tanpa uuid) — dipakai mirror server-side. */
  signPut(key: string, contentType: string, expiresIn?: number): string;
  /** URL publik objek untuk key tertentu. */
  publicUrl(key: string): string;
  /** Presigned GET URL untuk key logis (baca objek walau bucket privat). */
  signGet(key: string, expiresIn?: number): string;
  /** Daftar key LOGIS (tanpa folder lingkungan) di bawah `prefix` — ListObjectsV2, semua halaman. */
  listKeys(prefix?: string): Promise<string[]>;
}

// ── SigV4 helpers ─────────────────────────────────────────────────────────────

const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/** Encode RFC3986 (encodeURIComponent + karakter yang tak dienkode olehnya). */
function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Encode path per-segmen (pertahankan '/'). S3 = single-encoding. */
function canonicalUri(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => rfc3986(seg))
    .join('/');
}

/** `YYYYMMDDTHHMMSSZ` & `YYYYMMDD`. */
function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260902T010203Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 120) || 'file';
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  /** Folder teratas di bucket (mis. `prod`). Kosong = tanpa folder (bucket lama). */
  keyPrefix?: string;
}

class S3StorageProvider implements StorageProvider {
  private readonly prefix: string;

  constructor(private readonly cfg: S3Config) {
    this.prefix = (cfg.keyPrefix ?? '').replace(/^\/+|\/+$/g, '');
  }

  /** Key logis → key objek di bucket (dengan folder lingkungan). */
  private objectKey(key: string): string {
    const k = key.replace(/^\/+/, '');
    return this.prefix ? `${this.prefix}/${k}` : k;
  }

  publicUrl(key: string): string {
    const base = this.cfg.publicBaseUrl || `${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}`;
    return `${base.replace(/\/$/, '')}/${this.objectKey(key)}`;
  }

  /** Presigned PUT untuk key persis. SignedHeaders=host → Content-Type bebas. */
  signPut(key: string, _contentType: string, expiresIn = 300): string {
    return this.presign('PUT', `/${this.objectKey(key)}`, expiresIn);
  }

  signGet(key: string, expiresIn = 300): string {
    return this.presign('GET', `/${this.objectKey(key)}`, expiresIn);
  }

  async listKeys(prefix = ''): Promise<string[]> {
    const full = this.objectKey(prefix);
    const strip = this.prefix ? `${this.prefix}/` : '';
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000', prefix: full };
      if (token) query['continuation-token'] = token;
      const res = await fetch(this.presign('GET', '', 300, query), { signal: AbortSignal.timeout(30000) });
      const xml = await res.text();
      if (!res.ok) throw new Error(`ListObjectsV2 HTTP ${res.status}: ${xml.slice(0, 200)}`);
      for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
        const k = decodeXml(m[1]!);
        keys.push(strip && k.startsWith(strip) ? k.slice(strip.length) : k);
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? decodeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || undefined
        : undefined;
    } while (token);
    return keys;
  }

  /**
   * Presigned URL path-style: `${endpoint}/${bucket}${objectPath}` (objectPath '' = bucket,
   * untuk ListObjectsV2). SignedHeaders=host, payload UNSIGNED.
   */
  private presign(method: 'GET' | 'PUT', objectPath: string, expiresIn: number, query: Record<string, string> = {}): string {
    const url = new URL(this.cfg.endpoint);
    const host = url.host;
    const basePath = url.pathname.replace(/\/$/, '');
    const uriPath = canonicalUri(`${basePath}/${this.cfg.bucket}${objectPath}`);

    const now = new Date();
    const { amzDate, dateStamp } = amzDates(now);
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const credential = `${this.cfg.accessKeyId}/${scope}`;

    const params: Record<string, string> = {
      ...query,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
    };
    const canonicalQuery = Object.keys(params)
      .sort()
      .map((k) => `${rfc3986(k)}=${rfc3986(params[k]!)}`)
      .join('&');

    const canonicalRequest = [method, uriPath, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    return `${url.protocol}//${host}${uriPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  signUpload(input: SignUploadInput): SignUploadResult {
    const expiresIn = input.expiresIn ?? 300;
    const key = `${input.scope}/${uuid()}-${sanitizeFileName(input.fileName)}`;
    return {
      uploadUrl: this.signPut(key, input.contentType, expiresIn),
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      publicUrl: this.publicUrl(key),
      expiresIn,
    };
  }
}

function decodeXml(v: string): string {
  return v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Provider dari konfigurasi eksplisit (mis. bucket SUMBER saat migrasi antar-storage). */
export function createS3Storage(cfg: S3Config): StorageProvider {
  return new S3StorageProvider(cfg);
}

let cached: StorageProvider | null = null;

/** Provider storage (module-scope, reuse). Lempar bila S3 belum dikonfigurasi. */
export function getStorage(): StorageProvider {
  if (cached) return cached;
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_ENDPOINT || !S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new AppError('INTERNAL', 'Storage (S3) belum dikonfigurasi di server');
  }
  cached = new S3StorageProvider({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL,
    keyPrefix: env.STORAGE_ENV,
  });
  return cached;
}
