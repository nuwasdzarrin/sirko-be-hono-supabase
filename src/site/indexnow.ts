import { env } from '../config/env.js';

/**
 * IndexNow (https://www.indexnow.org): kabari Bing/Yandex/Seznam/Naver bahwa URL baru/berubah/dihapus,
 * agar cepat di-crawl ulang. Aktif bila INDEXNOW_KEY diisi & APP_ENV=production.
 * Kunci dibuktikan lewat https://<situs>/<INDEXNOW_KEY>.txt (lihat routes/site.ts).
 * Tak pernah melempar error — kegagalan hanya dicatat.
 */

export type IndexNowTransport = (body: { host: string; key: string; keyLocation: string; urlList: string[] }) => Promise<void>;

async function httpTransport(body: Parameters<IndexNowTransport>[0]): Promise<void> {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  // 200 = diterima, 202 = diterima (kunci sedang divalidasi).
  if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow HTTP ${res.status}`);
}

let transport: IndexNowTransport = httpTransport;
let forceEnabled = false;

/** Ganti transport (test). Kembalikan fungsi pemulih. */
export function setIndexNowTransport(t: IndexNowTransport): () => void {
  const prev = transport;
  transport = t;
  forceEnabled = true;
  return () => {
    transport = prev;
    forceEnabled = false;
  };
}

export const indexNowEnabled = () => Boolean(env.INDEXNOW_KEY) && (env.APP_ENV === 'production' || forceEnabled);

/** Kirim daftar path/URL (maks 10.000 per panggilan). Path relatif dijadikan URL penuh SITE_URL. */
export async function submitUrls(paths: string[]): Promise<void> {
  if (!indexNowEnabled() || !paths.length) return;
  const base = env.SITE_URL.replace(/\/$/, '');
  const urlList = [...new Set(paths.map((p) => (p.startsWith('http') ? p : `${base}${p}`)))].slice(0, 10_000);
  try {
    await transport({ host: new URL(base).hostname, key: env.INDEXNOW_KEY!, keyLocation: `${base}/${env.INDEXNOW_KEY}.txt`, urlList });
    console.log(`[indexnow] ${urlList.length} URL dikirim`);
  } catch (e) {
    console.error('[indexnow] gagal:', (e as Error).message);
  }
}
