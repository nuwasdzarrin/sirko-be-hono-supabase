// Kurasi Katalog Umum — bersihkan nama, normalisasi kategori (taksonomi ID),
// regen keywords, dedup, validasi barcode, filter relevansi ritel Indonesia.
//
// DRY-RUN (default, TAK sentuh Supabase):
//   node data/curate-catalog.js
//     → tulis data/public_product.curated.json + data/curation-report.json + ringkasan
// APPLY (setelah konfirmasi):
//   node --env-file=.env.production.local data/curate-catalog.js --apply
//     → backup dulu, update idempoten per-barcode, SOFT DELETE yg tak-relevan,
//       lalu selaraskan data/public_product.json dengan DB.
//
// Jalankan dari folder sirko-backend (agar `postgres` ter-resolve).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ═══════════════════════════════ CONFIG (mudah diedit) ═══════════════════════════════
const CONFIG = {
  // Taksonomi tetap Indonesia.
  taxonomy: ['Makanan', 'Minuman', 'Rokok', 'Sembako', 'Kebersihan', 'Perawatan', 'Kesehatan', 'Bumbu/Dapur', 'Snack', 'ATK', 'Lainnya'],

  // Classifier kata-kunci → taksonomi (URUT: paling spesifik dulu; match pertama menang).
  categoryRules: [
    ['Rokok', /\brokok\b|cigarette|kretek|tobacco|djarum|gudang garam|sampoerna|marlboro|dunhill|surya\b/i],
    ['Kesehatan', /vitamin|suplemen|supplement|\bobat\b|antangin|tolak angin|kayu putih|minyak angin|minyak telon|balsem|\bbalm\b|\bkoyo\b|betadine|antiseptik|hand sanitizer|masker/i],
    ['Perawatan', /shampoo|shampo|sampo|conditioner|sabun mandi|sabun muka|body wash|face wash|pasta gigi|\bodol\b|mouthwash|lotion|hand ?body|deodorant|deodoran|parfum|cologne|kosmetik|cosmetic|lipstick|bedak|skincare|moisturizer|pomade|pembalut|pantyliner|popok|diaper|\btisu\b|\btissue\b|cukur|razor/i],
    ['Kebersihan', /deterjen|detergent|sabun cuci|cuci piring|cuci baju|pewangi|pelembut|softener|pembersih|cleaner|karbol|pemutih|bleach|bayclin|\brinso\b|so klin|\bmolto\b|wipol|super ?pell|sunlight|vixal|harpic|baygon|obat nyamuk|pengharum/i],
    ['ATK', /pulpen|pensil|buku tulis|penghapus|spidol|\bkertas\b|stationery|\batk\b|penggaris|lem\b|staples/i],
    // Mie instan diprioritaskan sebelum Bumbu (agar "Indomie Kuah Kaldu" → Makanan, bukan Bumbu).
    ['Makanan', /indomie|mie sedaap|\bmie\b|\bmi\b goreng|instant noodle|\bnoodle|pop ?mie|sarimi|supermi|\bbihun\b|kwetiau/i],
    ['Bumbu/Dapur', /\bkecap\b|\bsaus\b|\bsauce\b|sambal|\bbumbu\b|penyedap|\bmsg\b|royco|masako|\bsasa\b|kaldu|\bmerica\b|\blada\b|\bcuka\b|vinegar|santan|coconut milk|saori|ladaku|desaku|bango|tepung|\bflour\b/i],
    ['Sembako', /\bberas\b|\brice\b|\bgula\b|\bsugar\b|minyak goreng|cooking oil|vegetable oil|\btelur\b|\begg\b|garam dapur|bimoli|\bsania\b|gulaku|\bfilma\b|tropical|sunco/i],
    // Cairan (ml/cl/liter) → Minuman; kategori cairan non-minum (kecap/minyak/sabun) sudah tersaring di atas.
    ['Minuman', /air mineral|\baqua\b|le minerale|\bteh\b|\btea\b|\bkopi\b|coffee|nescafe|\bsusu\b|\bmilk\b|dairy|yogurt|yoghurt|\bjuice\b|\bjus\b|\bsoda\b|\bcola\b|sirup|syrup|minuman|\bdrink\b|beverage|sprite|fanta|pocari|isotonic|nutrisari|milo|energen|ovaltine|krimer|creamer|kental manis|uht|\b\d+\s?ml\b|\b\d+\s?cl\b|\bliter\b|\bltr\b/i],
    ['Snack', /snack|keripik|\bchips\b|biskuit|biscuit|wafer|cokelat|coklat|chocolate|permen|\bcandy\b|kerupuk|\bkacang\b|chiki|chitato|\btaro\b|richeese|nabati|\boreo\b|beng.?beng|silver.?queen|astor|tango|momogi|popcorn|marshmallow/i],
    ['Makanan', /\bmie\b|\bmi\b goreng|instant noodle|noodle|indomie|sedaap|pop ?mie|sarimi|\bbihun\b|kwetiau|sarden|sardine|kornet|corned|\btuna\b|sereal|cereal|\boat|granola|\broti\b|\bbread\b|\bkue\b|selai|\bjam\b|makaroni|spaghetti|pasta\b|abon|\bkaleng\b/i],
  ],
  // Fallback: pemetaan taksonomi lama (16) → baru (11).
  categoryMap: {
    'Makanan Ringan': 'Snack', 'Cokelat & Permen': 'Snack',
    'Minuman': 'Minuman', 'Kopi & Teh': 'Minuman', 'Susu & Olahan Susu': 'Minuman',
    'Mie Instan': 'Makanan', 'Makanan Kaleng & Instan': 'Makanan', 'Sarapan & Sereal': 'Makanan', 'Roti & Kue': 'Makanan',
    'Bumbu & Bahan Masak': 'Bumbu/Dapur',
    'Sembako': 'Sembako',
    'Perawatan Tubuh': 'Perawatan', 'Bayi & Anak': 'Perawatan',
    'Pembersih Rumah Tangga': 'Kebersihan',
    'Kesehatan': 'Kesehatan', 'Rokok': 'Rokok', 'Lainnya': 'Lainnya',
    // Identity (taksonomi-11 → dirinya) agar re-run idempoten/stabil.
    'Makanan': 'Makanan', 'Minuman': 'Minuman', 'Snack': 'Snack', 'Sembako': 'Sembako',
    'Kebersihan': 'Kebersihan', 'Perawatan': 'Perawatan', 'Bumbu/Dapur': 'Bumbu/Dapur', 'ATK': 'ATK',
  },

  // Merek Indonesia (sinyal relevan). Lowercase. Mudah diperluas.
  brandsID: [
    'indomie', 'indofood', 'mie sedaap', 'sedaap', 'sarimi', 'supermi', 'pop mie',
    'aqua', 'le minerale', 'teh botol', 'sosro', 'teh pucuk', 'floridina', 'nutrisari', 'marjan', 'frestea',
    'djarum', 'gudang garam', 'sampoerna', 'wismilak',
    'sania', 'bimoli', 'filma', 'gulaku', 'sunco', 'tropical',
    'wings', 'so klin', 'rinso', 'molto', 'sunlight', 'daia', 'giv', 'nuvo',
    'lifebuoy', 'pepsodent', 'ciptadent', 'formula', 'close up',
    'mayora', 'roma', 'biskuat', 'kokola', 'khong guan', 'nissin', 'gery',
    'chitato', 'taro', 'qtela', 'chiki', 'lays', 'cheetos', 'richeese', 'nabati', 'dua kelinci', 'garuda',
    'silverqueen', 'beng beng', 'delfi', 'kopiko', 'relaxa', 'mentos', 'yupi',
    'kapal api', 'good day', 'torabika', 'abc', 'nescafe', 'luwak',
    'ultra milk', 'frisian flag', 'indomilk', 'dancow', 'milo', 'ovaltine', 'bear brand', 'cimory', 'greenfields',
    'energen', 'quaker', 'bango', 'saori', 'royco', 'masako', 'sasa', 'ladaku', 'desaku',
    'tolak angin', 'antangin', 'kaki tiga', 'komix', 'bodrex', 'promag', 'entrostop',
    'pocari sweat', 'mizone', 'kratingdaeng', 'extra joss', 'kuku bima', 'hemaviton',
    'so nice', 'so good', 'fiesta', 'kanzler', 'bernardi', 'kraft', 'prochiz',
  ],

  // Stopword (id+en) + satuan — dibuang dari keywords.
  stopwords: new Set([
    'dan', 'atau', 'yang', 'untuk', 'dengan', 'dari', 'the', 'and', 'for', 'with', 'of', 'in', 'a', 'an',
    'isi', 'per', 'pcs', 'pack', 'sachet', 'botol', 'kaleng', 'dus', 'renteng', 'bungkus', 'pouch',
    'ml', 'gr', 'gram', 'kg', 'liter', 'ltr', 'cl', 'mg', 'cm', 'mm', 'plus', 'new', 'original',
  ]),

  // Regex prefix "harga/berat nyasar" di depan nama → dibuang.
  namePrefixJunk: [
    /^\s*\([^)]*?(?:eur|€|rp|usd|\/\s*100\s*g|\bgr\b|\bml\b|\bg\b|\bkg\b|\bl\b|\bcl\b|%|,)[^)]*\)\s*/i, // "(3, 58eur / 100g) "
    /^\s*\d{5,}\s+/, // kode angka nyasar di depan
    /^\s*[-•·]\s*/, // bullet nyasar
  ],
};

// Satuan yang dibiarkan huruf kecil saat Title Case.
const UNIT_TOKENS = new Set(['ml', 'g', 'gr', 'kg', 'l', 'cl', 'mg', 'cm', 'mm', 'pcs', 'x']);

// ═══════════════════════════════ FUNGSI KURASI ═══════════════════════════════

function titleCase(s) {
  return s
    .split(/\s+/)
    .map((w) => {
      const lw = w.toLowerCase();
      if (UNIT_TOKENS.has(lw)) return lw;
      if (/^\d/.test(w)) return lw; // ukuran spt 200ml, 60x2gr → biarkan
      if (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w; // akronim pendek (ABC)
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanName(raw, brand, barcode) {
  let s = (raw ?? '').trim();
  if (/^\d{6,14}$/.test(s)) s = brand ? String(brand) : ''; // nama = barcode → pakai brand
  for (const re of CONFIG.namePrefixJunk) s = s.replace(re, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  if (s && (!hasLower || !hasUpper)) s = titleCase(s); // ALL CAPS / all-lower → Title Case
  // Jangan pernah kosongkan nama: fallback ke nama asal bila hasil bersih kosong.
  return s || (raw ?? '').trim();
}

function classifyCategory(name, brand, oldCategory) {
  const hay = `${name} ${brand ?? ''}`.toLowerCase();
  for (const [cat, re] of CONFIG.categoryRules) if (re.test(hay)) return cat;
  return CONFIG.categoryMap[oldCategory] ?? 'Lainnya';
}

function regenKeywords(name, brand) {
  const toks = `${name} ${brand ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 24 && !CONFIG.stopwords.has(t) && !/^\d+$/.test(t));
  return [...new Set(toks)].slice(0, 15);
}

/** Checksum EAN-8 / UPC-A(12) / EAN-13. */
function barcodeValid(code) {
  if (!code || !/^\d+$/.test(code)) return false;
  if (![8, 12, 13].includes(code.length)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  d.reverse();
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === check;
}

function relevance(cleanNm, brand, barcode) {
  const bc = String(barcode ?? '');
  const hay = `${cleanNm} ${brand ?? ''}`.toLowerCase();
  const id899 = bc.startsWith('899');
  const brandID = CONFIG.brandsID.some((b) => hay.includes(b));
  if (id899 || brandID) return 'relevant';
  const foreign = /[^\x00-\x7f]/.test(cleanNm); // nama non-ASCII (aksen/huruf asing)
  if (foreign) return 'irrelevant';
  return 'review';
}

/** Skor kelengkapan untuk memilih record terbaik saat dedup. */
function completeness(r) {
  let s = 0;
  if (r.verified) s += 4;
  if (r.brand) s += 2;
  if (r.category && r.category !== 'Lainnya') s += 2;
  if (r.netSize != null) s += 1;
  if (r.photoUrl) s += 1;
  if (r.name && !/^\d+$/.test(r.name)) s += 1;
  return s;
}

// ═══════════════════════════════ PIPELINE ═══════════════════════════════

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(HERE, 'public_product.json');
const CURATED_PATH = join(HERE, 'public_product.curated.json');
const REPORT_PATH = join(HERE, 'curation-report.json');

function curateAll(records) {
  // Dedup by barcode (simpan record paling lengkap).
  const byBarcode = new Map();
  const noBarcode = [];
  let dedupDropped = 0;
  for (const r of records) {
    const bc = r.barcode ?? null;
    if (!bc) { noBarcode.push(r); continue; }
    const prev = byBarcode.get(bc);
    if (!prev) byBarcode.set(bc, r);
    else { dedupDropped++; if (completeness(r) > completeness(prev)) byBarcode.set(bc, r); }
  }

  const curated = [];
  for (const r of [...byBarcode.values(), ...noBarcode]) {
    const nameOriginal = r.name ?? '';
    const name = cleanName(r.name, r.brand, r.barcode);
    const category = classifyCategory(name, r.brand, r.category);
    const keywords = regenKeywords(name, r.brand);
    const bcValid = barcodeValid(r.barcode);
    const status = relevance(name, r.brand, r.barcode);
    const verified = status === 'relevant' && bcValid && !!name;
    curated.push({
      ...r,
      name,
      category,
      keywords,
      verified,
      _status: status, // relevant | review | irrelevant
      _barcodeValid: bcValid,
      _nameChanged: name !== nameOriginal,
      _nameOriginal: nameOriginal,
    });
  }
  return { curated, dedupDropped };
}

function buildReport(curated, dedupDropped, total) {
  const by = (s) => curated.filter((r) => r._status === s);
  const relevant = by('relevant'), review = by('review'), irrelevant = by('irrelevant');
  const nameChanged = curated.filter((r) => r._nameChanged);
  const bcInvalid = curated.filter((r) => !r._barcodeValid);
  const catDist = {};
  for (const r of curated) if (r._status !== 'irrelevant') catDist[r.category] = (catDist[r.category] ?? 0) + 1;

  const beforeAfter = nameChanged.slice(0, 30).map((r) => ({ barcode: r.barcode, before: r._nameOriginal, after: r.name }));
  const reviewList = review.slice(0, 60).map((r) => ({ barcode: r.barcode, name: r.name, brand: r.brand ?? null }));

  return {
    ringkasan: {
      totalInput: total,
      dedupDibuang: dedupDropped,
      totalUnik: curated.length,
      relevan: relevant.length,
      perluReview: review.length,
      takRelevan_softDelete: irrelevant.length,
      namaDibersihkan: nameChanged.length,
      barcodeInvalid: bcInvalid.length,
      akanVerifiedTrue: curated.filter((r) => r.verified).length,
    },
    distribusiKategori: catDist,
    contohNamaSebelumSesudah: beforeAfter,
    perluReviewManual: reviewList,
    takRelevanContoh: irrelevant.slice(0, 30).map((r) => ({ barcode: r.barcode, name: r._nameOriginal, brand: r.brand ?? null })),
    barcodeInvalidContoh: bcInvalid.slice(0, 20).map((r) => ({ barcode: r.barcode, name: r.name })),
  };
}

function printSummary(report) {
  const r = report.ringkasan;
  console.log('\n═══════════ LAPORAN KURASI (DRY-RUN) ═══════════');
  console.log(`  Total input          : ${r.totalInput}`);
  console.log(`  Dedup dibuang        : ${r.dedupDibuang}`);
  console.log(`  Total unik           : ${r.totalUnik}`);
  console.log(`  ✅ Relevan           : ${r.relevan}`);
  console.log(`  🟡 Perlu review      : ${r.perluReview}`);
  console.log(`  🗑️  Tak relevan (soft): ${r.takRelevan_softDelete}`);
  console.log(`  ✏️  Nama dibersihkan  : ${r.namaDibersihkan}`);
  console.log(`  ⚠️  Barcode invalid   : ${r.barcodeInvalid}`);
  console.log(`  verified=true        : ${r.akanVerifiedTrue}`);
  console.log('\n  Distribusi kategori (non-softdelete):');
  for (const [c, n] of Object.entries(report.distribusiKategori).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${c}`);
  console.log('\n  Contoh nama SEBELUM → SESUDAH (20):');
  for (const e of report.contohNamaSebelumSesudah.slice(0, 20)) console.log(`    • ${JSON.stringify(e.before)}\n        → ${JSON.stringify(e.after)}`);
  console.log('\n  Contoh yang akan SOFT-DELETE (asing kuat, 15):');
  for (const e of report.takRelevanContoh.slice(0, 15)) console.log(`    ✗ [${e.barcode}] ${JSON.stringify(e.name)}`);
}

// ═══════════════════════════════ APPLY (Supabase) ═══════════════════════════════

async function applyToSupabase(curated) {
  const { default: postgres } = await import('postgres');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tak ada. Jalankan dengan --env-file=.env.production.local');
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  const ts = Date.now();
  try {
    // 1) BACKUP semua baris apa adanya.
    const all = await sql`SELECT * FROM public_products`;
    const backupDir = join(HERE, 'backup');
    await mkdir(backupDir, { recursive: true });
    const backupPath = join(backupDir, `public_products_${ts}.json`);
    await writeFile(backupPath, JSON.stringify(all, null, 2), 'utf8');
    console.log(`\n✓ Backup ${all.length} baris → ${backupPath}`);

    // 2) UPDATE relevan+review (kolom kurasi) via jsonb_to_recordset, batch.
    const upd = curated.filter((r) => r._status !== 'irrelevant' && r.barcode);
    const CHUNK = 500;
    let updated = 0;
    for (let i = 0; i < upd.length; i += CHUNK) {
      const chunk = upd.slice(i, i + CHUNK).map((r) => ({
        barcode: r.barcode, name: r.name, category: r.category, keywords: r.keywords, verified: r.verified,
      }));
      const res = await sql`
        UPDATE public_products p SET
          name = v.name, category = v.category, keywords = v.keywords,
          verified = v.verified, updated_at = ${ts}
        FROM jsonb_to_recordset(${sql.json(chunk)}::jsonb)
          AS v(barcode text, name text, category text, keywords text[], verified boolean)
        WHERE p.barcode = v.barcode AND p.deleted_at IS NULL
      `;
      updated += res.count;
      console.log(`  update batch ${i / CHUNK + 1}: ${res.count}`);
    }

    // 3) SOFT DELETE tak-relevan (deleted_at) — bukan hard delete.
    const del = curated.filter((r) => r._status === 'irrelevant' && r.barcode).map((r) => r.barcode);
    let softDeleted = 0;
    for (let i = 0; i < del.length; i += CHUNK) {
      const slice = del.slice(i, i + CHUNK);
      const res = await sql`
        UPDATE public_products SET deleted_at = ${ts}, updated_at = ${ts}
        WHERE barcode = ANY(${slice}) AND deleted_at IS NULL
      `;
      softDeleted += res.count;
    }
    console.log(`✓ Update: ${updated} | Soft delete: ${softDeleted}`);

    // 4) Selaraskan JSON sumber dengan DB (hanya non-softdelete; buang field _*).
    const clean = curated
      .filter((r) => r._status !== 'irrelevant')
      .map(({ _status, _barcodeValid, _nameChanged, _nameOriginal, ...rest }) => rest);
    await writeFile(JSON_PATH, JSON.stringify(clean, null, 2), 'utf8');
    console.log(`✓ Selaraskan ${clean.length} baris → ${JSON_PATH}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ═══════════════════════════════ MAIN ═══════════════════════════════

async function main() {
  const apply = process.argv.includes('--apply');
  const raw = JSON.parse(await readFile(JSON_PATH, 'utf8'));
  console.log(`Baca ${raw.length} produk dari public_product.json`);
  const { curated, dedupDropped } = curateAll(raw);
  const report = buildReport(curated, dedupDropped, raw.length);

  await writeFile(CURATED_PATH, JSON.stringify(curated, null, 2), 'utf8');
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  printSummary(report);
  console.log(`\n  Hasil lengkap : ${CURATED_PATH}`);
  console.log(`  Laporan JSON  : ${REPORT_PATH}`);

  if (apply) {
    console.log('\n>>> MODE APPLY: menerapkan ke Supabase (backup dulu)...');
    await applyToSupabase(curated);
    console.log('\n✅ APPLY selesai.');
  } else {
    console.log('\n(DRY-RUN — Supabase TAK disentuh. Jalankan dengan --apply untuk menerapkan.)');
  }
}

main().catch((e) => { console.error('GAGAL:', e); process.exit(1); });
