import { sql } from './client.ts';
import { uuid } from '../lib/uuid.ts';
import { nowMs } from '../lib/time.ts';

/**
 * Seed Katalog Umum (public_products) dari data TERBUKA Open Food Facts &
 * Open Beauty Facts (lisensi ODbL) — produk yang beredar di Indonesia.
 *
 * - Sumber resmi via API (bukan scraping); wajib User-Agent (aturan OFF).
 * - Saring kualitas: wajib ada nama & foto; brand/kategori dibersihkan.
 * - Dedupe by barcode (lintas sumber & terhadap DB).
 * - Idempotent: ON CONFLICT (barcode) DO NOTHING → aman diulang, tak menggandakan.
 * - Enrich: net_size/net_unit dari quantity, country_of_origin dari prefix 899 (GS1 Indonesia),
 *   keywords dari nama+brand, barcode_type dari panjang digit.
 *
 * Jalankan:  npm run seed:catalog        (DB lokal, .env)
 *            npm run seed:catalog:prod   (.env.production.local)
 * Konfigurasi via env: OFF_PAGES, BEAUTY_PAGES, PAGE_SIZE (default 40 / 12 / 100).
 */

const UA = 'SirkoCatalogBot/1.0 (nuwas@creativism.id) - seeding retail catalog';
const PAGE_SIZE = Number(process.env.PAGE_SIZE ?? 50);
// Query "populer" cepat kena blok deep-pagination → halaman sedikit; breadth dari brand/kategori.
const OFF_PAGES = Number(process.env.OFF_PAGES ?? 10);
const BEAUTY_PAGES = Number(process.env.BEAUTY_PAGES ?? 8);

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_id?: string;
  brands?: string;
  categories?: string;
  image_front_url?: string;
  image_url?: string;
  quantity?: string;
  countries_tags?: string[];
}

interface CatalogRow {
  id: string;
  barcode: string;
  barcode_type: string;
  name: string;
  short_description: string | null;
  photo_url: string;
  brand: string | null;
  category: string | null;
  manufacturer: string | null;
  default_unit: string | null;
  net_size: number | null;
  net_unit: string | null;
  packaging: string | null;
  variant: string | null;
  country_of_origin: string | null;
  keywords: string[];
  verified: boolean;
  source: string;
  created_at: number;
  updated_at: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function barcodeType(code: string): string {
  if (/^\d{13}$/.test(code)) return 'EAN13';
  if (/^\d{12}$/.test(code)) return 'UPC';
  if (/^\d{8}$/.test(code)) return 'EAN8';
  return 'other';
}

/** "600 ml" → {size:600, unit:'ml'}; "85 g" → {85,'g'}; "1 L" → {1,'l'}. */
function parseQuantity(q?: string): { size: number | null; unit: string | null } {
  if (!q) return { size: null, unit: null };
  const m = q.trim().match(/^([\d]+(?:[.,]\d+)?)\s*([a-zA-Z]+)/);
  if (!m) return { size: null, unit: null };
  const size = Number(m[1]!.replace(',', '.'));
  const unit = m[2]!.toLowerCase();
  return { size: Number.isFinite(size) ? size : null, unit };
}

function firstCategory(categories?: string): string | null {
  if (!categories) return null;
  const first = categories.split(',')[0]?.trim();
  if (!first) return null;
  return first.replace(/^[a-z]{2}:/i, '').trim() || null;
}

function cleanBrand(brands?: string): string | null {
  if (!brands) return null;
  const b = brands.split(',')[0]?.trim();
  if (!b || b.toLowerCase() === 'undefined') return null;
  return b.slice(0, 120);
}

function buildKeywords(name: string, brand: string | null): string[] {
  const toks = (name + ' ' + (brand ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 24);
  return [...new Set(toks)].slice(0, 15);
}

function toRow(p: OffProduct, ts: number): CatalogRow | null {
  const code = (p.code ?? '').trim();
  if (!/^\d{6,14}$/.test(code)) return null; // barcode wajib & masuk akal
  const name = (p.product_name_id || p.product_name || '').trim();
  if (name.length < 2 || name.length > 200) return null;
  const photo = (p.image_front_url || p.image_url || '').trim();
  if (!photo) return null; // wajib ada foto (permintaan: foto produk)

  const brand = cleanBrand(p.brands);
  const { size, unit } = parseQuantity(p.quantity);
  return {
    id: uuid(),
    barcode: code,
    barcode_type: barcodeType(code),
    name,
    short_description: null,
    photo_url: photo,
    brand,
    category: firstCategory(p.categories),
    manufacturer: null,
    default_unit: null,
    net_size: size,
    net_unit: unit,
    packaging: null,
    variant: null,
    country_of_origin: code.startsWith('899') ? 'ID' : null,
    keywords: buildKeywords(name, brand),
    verified: false,
    source: 'crowdsource',
    created_at: ts,
    updated_at: ts,
  };
}

interface Query {
  host: string;
  label: string;
  extra: string; // parameter query tambahan (mis. brands_tags=indomie)
  pages: number;
}

// Brand & kategori umum di toko Indonesia (tag OFF: huruf kecil, tanda hubung).
const BRANDS = [
  'indomie', 'indofood', 'mie-sedaap', 'mayora', 'wings', 'wings-food', 'unilever',
  'nestle', 'garudafood', 'orang-tua', 'khong-guan', 'kapal-api', 'sosro', 'aqua',
  'frisian-flag', 'ultra-milk', 'so-klin', 'rinso', 'lifebuoy', 'pepsodent', 'sunlight',
  'sido-muncul', 'blue-band', 'bimoli', 'roma', 'biskuat', 'chitato', 'taro', 'richeese',
  'teh-pucuk', 'le-minerale', 'pocari-sweat', 'marjan', 'abc', 'bango', 'sasa', 'royco',
  'nabati', 'good-day', 'silverqueen', 'beng-beng', 'milo', 'dancow', 'oreo', 'sprite',
  'coca-cola', 'teh-botol-sosro', 'gulaku', 'sania',
];
const CATEGORIES = [
  'instant-noodles', 'biscuits', 'snacks', 'chocolates', 'candies', 'coffees', 'teas',
  'dairies', 'milks', 'juices', 'sodas', 'waters', 'sauces', 'condiments',
  'breakfast-cereals', 'vegetable-oils', 'rices', 'spreads', 'wafers', 'chips-and-fries',
];

async function fetchSearch(host: string, extra: string, page: number, attempt = 0): Promise<OffProduct[]> {
  const url =
    `https://${host}/api/v2/search?${extra}` +
    `&fields=code,product_name,product_name_id,brands,categories,image_front_url,image_url,quantity` +
    `&page_size=${PAGE_SIZE}&page=${page}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    // 401/429/5xx = rate-limit/Cloudflare/server sibuk → retry singkat (hemat waktu).
    if ([401, 429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      return fetchSearch(host, extra, page, attempt + 1);
    }
    if (!res.ok) return [];
    const json = (await res.json()) as { products?: OffProduct[] };
    return json.products ?? [];
  } catch {
    if (attempt < 2) {
      await sleep(1500 * (attempt + 1));
      return fetchSearch(host, extra, page, attempt + 1);
    }
    return [];
  }
}

async function collect(q: Query, seen: Set<string>, out: Map<string, CatalogRow>) {
  const ts = nowMs();
  let addedTotal = 0;
  for (let page = 1; page <= q.pages; page++) {
    const products = await fetchSearch(q.host, q.extra, page);
    if (products.length === 0) break;
    for (const p of products) {
      const row = toRow(p, ts);
      if (!row || seen.has(row.barcode)) continue;
      seen.add(row.barcode);
      out.set(row.barcode, row);
      addedTotal += 1;
    }
    await sleep(400); // sopan ke server OFF
    if (products.length < PAGE_SIZE) break; // halaman terakhir
  }
  if (addedTotal > 0) console.log(`  [${q.label}] +${addedTotal} unik (total terkumpul ${out.size})`);
}

async function upsertAll(rows: CatalogRow[]): Promise<number> {
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await sql`
      INSERT INTO public_products ${sql(
        chunk as unknown as readonly Record<string, unknown>[],
        'id', 'barcode', 'barcode_type', 'name', 'short_description', 'photo_url',
        'brand', 'category', 'manufacturer', 'default_unit', 'net_size', 'net_unit',
        'packaging', 'variant', 'country_of_origin', 'keywords', 'verified', 'source',
        'created_at', 'updated_at',
      )}
      ON CONFLICT (barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL
      DO NOTHING
      RETURNING id
    `;
    // postgres.js: `.count` = baris terpengaruh (lebih akurat dari .length untuk
    // INSERT ... ON CONFLICT DO NOTHING RETURNING).
    const added = (res as unknown as { count?: number }).count ?? res.length;
    inserted += added;
    console.log(`  upsert chunk ${i / CHUNK + 1}: +${added} baru (dari ${chunk.length})`);
  }
  return inserted;
}

async function run() {
  const seen = new Set<string>();
  const out = new Map<string, CatalogRow>();
  const FOOD = 'world.openfoodfacts.org';
  const BEAUTY = 'world.openbeautyfacts.org';

  // Query dangkal & beragam → hindari blok deep-pagination, perluas cakupan.
  const queries: Query[] = [
    { host: FOOD, label: 'food-populer', extra: 'countries_tags_en=indonesia&sort_by=unique_scans_n', pages: OFF_PAGES },
    { host: BEAUTY, label: 'beauty-populer', extra: 'countries_tags_en=indonesia&sort_by=unique_scans_n', pages: BEAUTY_PAGES },
    ...BRANDS.map((b) => ({ host: FOOD, label: `brand:${b}`, extra: `brands_tags=${b}`, pages: 3 })),
    ...CATEGORIES.map((c) => ({
      host: FOOD,
      label: `kat:${c}`,
      extra: `categories_tags=${c}&countries_tags_en=indonesia&sort_by=unique_scans_n`,
      pages: 3,
    })),
  ];

  console.log(`Seed katalog — ${queries.length} query, page_size ${PAGE_SIZE}`);
  const budgetMs = Number(process.env.BUDGET_MS ?? 8 * 60 * 1000);
  const started = Date.now();
  const insertedBarcodes = new Set<string>();
  let totalNew = 0;

  const flush = async () => {
    const pending = [...out.values()].filter((r) => !insertedBarcodes.has(r.barcode));
    if (pending.length === 0) return;
    totalNew += await upsertAll(pending);
    pending.forEach((r) => insertedBarcodes.add(r.barcode));
  };

  for (const q of queries) {
    await collect(q, seen, out);
    // Flush bertahap → progres tersimpan walau proses terpotong.
    if (out.size - insertedBarcodes.size >= 150) await flush();
    if (Date.now() - started > budgetMs) {
      console.log('  ⏳ budget waktu habis — hentikan pengumpulan');
      break;
    }
  }
  await flush(); // sisa

  const totalRows = await sql<{ n: number }[]>`SELECT count(*)::int n FROM public_products WHERE deleted_at IS NULL`;
  const total = totalRows[0]?.n ?? 0;
  console.log(`\n✅ Selesai. Baru dimasukkan sesi ini: ${totalNew}. Total katalog sekarang: ${total}.`);
}

run()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Seed GAGAL:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
