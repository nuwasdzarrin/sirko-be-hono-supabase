import { renderPage, siteUrl, signupUrl, type Crumb, breadcrumbsHtml } from './layout.js';
import { nowMs } from '../lib/time.js';

/**
 * Alat gratis di /alat/* (butuh JavaScript, jadi dibuat di kode — CMS menyaring skrip).
 * Tiap alat punya tanggal tayang (rencana SEO 30 hari): sebelum itu 404 & tak masuk sitemap; saat tayang
 * IndexNow dikabari oleh job di server.ts (sama seperti artikel terjadwal). Skrip di /js/* (CSP 'self').
 */
export interface Tool {
  path: string;
  title: string;
  releaseAt: number;
  render: () => string;
}

const WIB = (iso: string) => Date.parse(`${iso}T08:00:00+07:00`);

const TOOL_CSS = `
.tool{max-width:860px;margin:0 auto}
.tool h1{font-size:clamp(30px,4.6vw,44px);margin:8px 0 12px}
.tool .lead{font-size:18px}
.tool-card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:22px;margin:22px 0;box-shadow:var(--shadow)}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.tabs button{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer;color:var(--ink)}
.tabs button[aria-selected="true"]{background:var(--green);border-color:var(--green);color:#fff}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}
.grid2 .full{grid-column:1/-1}
@media(max-width:640px){.grid2{grid-template-columns:1fr}}
.fld label{display:block;font-weight:700;font-size:14px;margin-bottom:4px}
.fld small{display:block;color:var(--mut);font-size:13px;margin-top:2px}
.fld input,.fld select{width:100%;font:inherit;font-size:17px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink)}
.fld input:focus{outline:2px solid var(--green);outline-offset:1px}
.res{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:18px}
.res div{background:var(--sunk);border-radius:14px;padding:14px}
.res b{display:block;font-size:22px;margin-top:2px}
.res .pos{color:var(--green-tx)}.res .neg{color:#B3261E}
.explain{margin-top:14px;color:var(--mut);font-size:15px}
.howto{padding-left:20px}.howto li{margin:6px 0}
.tool table{width:100%;border-collapse:collapse;font-size:15px}.tool th,.tool td{border-bottom:1px solid var(--line);padding:8px;text-align:left}
`;

function shell(o: { path: string; title: string; metaTitle: string; description: string; crumb: string; body: string; faq: Array<[string, string]>; script: string; extraCss?: string; extraHead?: string }) {
  const crumbs: Crumb[] = [{ name: 'Beranda', path: '/' }, { name: o.crumb, path: o.path }];
  const faqHtml = o.faq.map(([q, a]) => `<h3>${q}</h3><p>${a}</p>`).join('');
  const body = `<main id="isi"><div class="wrap"><article class="tool prose">
  ${breadcrumbsHtml(crumbs)}
  ${o.body}
  <h2 id="tanya-jawab">Tanya jawab</h2>
  ${faqHtml}
</article></div></main>
<script src="${o.script}" defer></script>`;
  return renderPage({
    title: o.metaTitle,
    description: o.description,
    path: o.path,
    body,
    crumbs,
    extraHead: `<style>${TOOL_CSS}${o.extraCss ?? ''}</style>${o.extraHead ?? ''}`,
    jsonLd: [
      { '@type': 'WebApplication', name: o.title, url: siteUrl(o.path), applicationCategory: 'BusinessApplication', operatingSystem: 'Web', inLanguage: 'id-ID', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'IDR' } },
      { '@type': 'FAQPage', mainEntity: o.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') } })) },
    ],
    waAsk: o.title,
  });
}

// ── Kalkulator laba warung ───────────────────────────────────────────────────

function kalkulator(): string {
  const path = '/alat/kalkulator-laba-warung';
  const money = (id: string, label: string, help = '', full = false) =>
    `<div class="fld${full ? ' full' : ''}"><label for="${id}">${label}</label><input id="${id}" inputmode="numeric" autocomplete="off" placeholder="0" data-rp>${help ? `<small>${help}</small>` : ''}</div>`;
  return shell({
    path,
    title: 'Kalkulator Laba Warung',
    metaTitle: 'Kalkulator Laba Warung Gratis: Hitung Laba Bersih | Sirko',
    description: 'Kalkulator laba warung gratis: hitung laba kotor, laba bersih, dan margin per bulan, atau untung per barang. Langsung di HP, tanpa daftar, tanpa download.',
    crumb: 'Kalkulator laba warung',
    script: '/js/kalkulator-laba.js',
    body: `<h1>Kalkulator Laba Warung</h1>
<p class="lead">Hitung laba warung Anda dalam satu menit: <b>laba kotor, laba bersih, dan margin</b> per bulan, atau untung per barang. Gratis, langsung di HP, dan angka Anda tidak dikirim ke mana pun.</p>

<section class="tool-card" aria-label="Kalkulator">
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected="true" aria-controls="mode-bulan" id="tab-bulan">Laba bulanan</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="mode-barang" id="tab-barang">Untung per barang</button>
  </div>
  <div id="mode-bulan" role="tabpanel" aria-labelledby="tab-bulan">
    <div class="grid2">
      ${money('omzet', 'Total penjualan (omzet) sebulan', 'Semua uang dari penjualan barang, termasuk yang masih kasbon.', true)}
      ${money('stokAwal', 'Nilai stok awal bulan', 'Jumlah barang di toko × harga beli, di awal bulan.')}
      ${money('belanja', 'Belanja barang sebulan', 'Total kulakan/pembelian ke supplier, termasuk ongkos angkut.')}
      ${money('stokAkhir', 'Nilai stok akhir bulan', 'Hasil hitung stok (opname) di akhir bulan × harga beli.')}
      ${money('ppob', 'Untung pulsa & token sebulan', 'Hanya untungnya, bukan nominal pulsanya.')}
      ${money('biaya', 'Biaya operasional sebulan', 'Listrik, sewa, gaji, plastik, iuran, transport, dll.')}
      <div class="fld"><label for="hari">Hari buka sebulan</label><input id="hari" inputmode="numeric" value="30"></div>
    </div>
    <div class="res" aria-live="polite">
      <div>Modal barang terjual (HPP)<b id="r-hpp">Rp0</b></div>
      <div>Laba kotor<b id="r-kotor">Rp0</b></div>
      <div>Margin kotor<b id="r-margin">0%</b></div>
      <div>Laba bersih<b id="r-bersih">Rp0</b></div>
      <div>Laba bersih per hari<b id="r-harian">Rp0</b></div>
    </div>
    <p class="explain" id="r-catatan">Isi angka di atas. Hasil dihitung otomatis.</p>
  </div>
  <div id="mode-barang" role="tabpanel" aria-labelledby="tab-barang" hidden>
    <div class="grid2">
      ${money('beli', 'Harga beli per barang', 'Kalau beli per dus: harga dus ÷ isi.')}
      ${money('jual', 'Harga jual per barang')}
      <div class="fld"><label for="qty">Terjual sebulan (perkiraan)</label><input id="qty" inputmode="numeric" placeholder="0"></div>
    </div>
    <div class="res" aria-live="polite">
      <div>Untung per barang<b id="b-untung">Rp0</b></div>
      <div>Markup (dari harga beli)<b id="b-markup">0%</b></div>
      <div>Margin (dari harga jual)<b id="b-margin">0%</b></div>
      <div>Untung sebulan<b id="b-bulan">Rp0</b></div>
    </div>
    <p class="explain">Markup = untung ÷ harga beli. Margin = untung ÷ harga jual. Angka markup selalu lebih besar dari margin.</p>
  </div>
</section>

<h2 id="cara-pakai">Cara memakai kalkulator laba warung</h2>
<ol class="howto">
  <li>Isi <b>total penjualan sebulan</b>. Kalau belum punya catatan, jumlahkan penjualan harian di buku.</li>
  <li>Isi <b>nilai stok awal, belanja, dan stok akhir</b>. Dari tiga angka ini kalkulator menghitung modal barang yang benar-benar terjual (HPP).</li>
  <li>Isi <b>untung pulsa & token</b> (bila ada) dan <b>biaya operasional</b>.</li>
  <li>Baca hasilnya: laba kotor, margin, laba bersih, dan laba per hari.</li>
</ol>

<h2 id="rumus">Rumus yang dipakai</h2>
<table>
  <thead><tr><th>Hasil</th><th>Rumus</th></tr></thead>
  <tbody>
    <tr><td>Modal barang terjual (HPP)</td><td>stok awal + belanja − stok akhir</td></tr>
    <tr><td>Laba kotor</td><td>penjualan − HPP</td></tr>
    <tr><td>Margin kotor</td><td>laba kotor ÷ penjualan × 100%</td></tr>
    <tr><td>Laba bersih</td><td>laba kotor + untung pulsa & token − biaya operasional</td></tr>
  </tbody>
</table>
<p><em>Ilustrasi:</em> penjualan Rp45.000.000, stok awal Rp20.000.000, belanja Rp38.000.000, stok akhir Rp19.500.000. HPP = Rp38.500.000, laba kotor = Rp6.500.000 (margin ±14,4%). Ditambah untung pulsa Rp600.000 dan dikurangi biaya Rp2.400.000, laba bersih = Rp4.700.000.</p>
<p>Penjelasan lengkap tiap langkahnya ada di artikel <a href="/blog/cara-menghitung-laba-toko-kelontong">cara menghitung laba toko kelontong</a>. Untuk menentukan harga per barang, baca <a href="/blog/cara-menentukan-harga-jual-barang-warung">cara menentukan harga jual barang warung</a>.</p>

<aside class="cta-box" aria-label="Coba Sirko">
  <div><b>Tidak mau menghitung manual tiap bulan?</b><p>Sirko mencatat penjualan, modal per barang, dan laba otomatis — gratis untuk satu toko, langsung di browser HP atau laptop.</p></div>
  <a class="btn" href="${signupUrl('alat-kalkulator-laba')}">Coba Gratis</a>
</aside>`,
    faq: [
      ['Apa beda laba kotor dan laba bersih warung?', 'Laba kotor adalah penjualan dikurangi modal barang yang terjual. Laba bersih adalah laba kotor dikurangi biaya operasional seperti listrik, sewa, dan gaji, lalu ditambah penghasilan lain seperti untung pulsa.'],
      ['Kenapa harus memakai stok awal dan stok akhir?', 'Karena tidak semua barang yang dibeli bulan ini terjual bulan ini. Stok awal + belanja − stok akhir memberi modal barang yang benar-benar terjual, jadi laba tidak terlihat rugi saat Anda kulakan banyak.'],
      ['Berapa margin yang wajar untuk warung sembako?', 'Sembako pokok biasanya bermargin tipis, sedangkan jajanan dan minuman lebih tebal, sehingga margin rata-rata toko tergantung campuran barang Anda. Pantau margin Anda sendiri dari bulan ke bulan dan perhatikan kalau turun.'],
      ['Apakah angka yang saya isi tersimpan atau dikirim?', 'Tidak. Semua perhitungan berjalan di browser Anda dan tidak dikirim ke server.'],
    ],
  });
}

// ── Template buku hutang ─────────────────────────────────────────────────────

const PRINT_CSS = `
.bk-opts{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}
@media(max-width:640px){.bk-opts{grid-template-columns:1fr}}
.bk-check{display:flex;gap:8px;align-items:center;font-weight:600}
.bk-preview{margin-top:18px;max-height:70vh;overflow:auto;border:1px dashed var(--line);border-radius:14px;padding:12px;background:#fff}
.bk-page{color:#111;font:10.5pt/1.3 Arial,Helvetica,sans-serif;width:186mm;margin:0 auto 14px}
.bk-page h2{font-size:14pt;margin:0 0 6px}
.bk-head{display:grid;grid-template-columns:repeat(12,1fr);gap:6px 10px;margin-bottom:6px}
.bk-head span{border-bottom:1px solid #444;padding-bottom:2px;white-space:nowrap;overflow:hidden}
.bk-page table{width:100%;border-collapse:collapse;table-layout:fixed}
.bk-page th,.bk-page td{border:1px solid #444;height:7.6mm;padding:0 4px;font-size:10pt}
.bk-page th{background:#eee;font-weight:700;height:auto;padding:4px}
.bk-page td.c{text-align:center}.bk-page td.sisa{border-width:1.5px}
.bk-page thead{display:table-header-group}
.bk-line{margin:6px 0}
.bk-foot{font-size:8pt;color:#555;margin-top:6px}
#bk-print-root{display:none}
@media print{
  @page{size:A4 portrait;margin:12mm}
  html,body{background:#fff!important}
  body>*:not(#bk-print-root){display:none!important}
  #bk-print-root{display:block}
  #bk-print-root .bk-page{margin:0;width:auto;break-after:page;page-break-after:always}
  #bk-print-root .bk-page:last-child{break-after:auto;page-break-after:auto}
  #bk-print-root .bk-page td{height:6.6mm}
  #bk-print-root .bk-rekap td{height:6.3mm}
}}`;

function templateHutang(): string {
  const path = '/alat/template-buku-hutang';
  return shell({
    path,
    title: 'Template Buku Hutang Warung',
    metaTitle: 'Template Buku Hutang Warung Gratis (A4, Siap Cetak) | Sirko',
    description: 'Template buku hutang warung gratis ukuran A4: halaman per pelanggan dan rekap daftar kasbon. Atur jumlah halaman, lalu cetak atau simpan PDF dari HP.',
    crumb: 'Template buku hutang',
    script: '/js/template-buku-hutang.js',
    extraCss: PRINT_CSS,
    body: `<h1>Template Buku Hutang Warung Gratis (A4, Siap Cetak)</h1>
<p class="lead">Template buku hutang warung ini berisi <b>halaman per pelanggan</b> (tanggal, keterangan, hutang, bayar, sisa, paraf) dan <b>halaman rekap</b> daftar pelanggan kasbon. Atur jumlah halaman, lalu cetak atau simpan sebagai PDF. Gratis, tanpa daftar.</p>

<section class="tool-card" aria-label="Atur template">
  <div class="bk-opts">
    <div class="fld"><label for="bk-n">Jumlah halaman pelanggan</label><input id="bk-n" type="number" inputmode="numeric" min="1" max="100" value="10"><small>Satu pelanggan satu halaman. 1–100.</small></div>
    <div class="fld"><label for="bk-toko">Nama toko (opsional)</label><input id="bk-toko" maxlength="40" placeholder="mis. Warung Bu Sri"><small>Dicetak di kepala setiap halaman.</small></div>
    <label class="bk-check"><input id="bk-rekap" type="checkbox" checked> Sertakan halaman rekap di depan</label>
    <label class="bk-check"><input id="bk-nomor" type="checkbox" checked> Nomori halaman otomatis</label>
  </div>
  <p style="margin:16px 0 0"><button type="button" class="btn btn-primary" id="bk-print">Cetak / Simpan PDF</button></p>
  <p class="explain">Di HP: tekan tombol di atas, lalu pilih <b>Simpan sebagai PDF</b> atau printer. Pilih kertas A4.</p>
  <div class="bk-preview" id="bk-preview" aria-label="Pratinjau template"><noscript>Aktifkan JavaScript untuk membuat template.</noscript></div>
</section>

<h2 id="cara-pakai">Cara memakai template buku hutang</h2>
<ol class="howto">
  <li>Atur jumlah halaman sesuai jumlah pelanggan yang biasa kasbon, tambah beberapa cadangan.</li>
  <li>Cetak di kertas A4, lalu jilid atau masukkan ke map.</li>
  <li>Satu pelanggan satu halaman. Tulis nomor halamannya di halaman rekap.</li>
  <li>Saat halaman penuh, tulis "Dipindah ke hal. …" beserta sisanya, lalu lanjutkan di halaman baru.</li>
</ol>
<p>Contoh pengisian, cara memindahkan sisa hutang antarhalaman, dan kapan sebaiknya pindah ke aplikasi ada di artikel <a href="/blog/contoh-buku-hutang-warung">contoh buku hutang warung</a>. Cara mencatat kasbon yang rapi dijelaskan di <a href="/blog/cara-mencatat-hutang-pelanggan-warung">cara mencatat hutang pelanggan warung</a>.</p>

<aside class="cta-box" aria-label="Coba Sirko">
  <div><b>Ingin sisa hutang terhitung otomatis?</b><p>Di Sirko, kasbon dicatat dari kasir, sisa hutang dan cicilan terhitung sendiri, dan pengingat bisa dikirim lewat WhatsApp. Gratis untuk satu toko. Lihat juga <a href="/aplikasi-kasbon">aplikasi kasbon Sirko</a>.</p></div>
  <a class="btn" href="${signupUrl('alat-template-buku-hutang')}">Coba Gratis</a>
</aside>`,
    faq: [
      ['Apakah template buku hutang ini gratis?', 'Ya, gratis dan tanpa daftar. Anda boleh mencetaknya sebanyak yang Anda perlukan untuk toko sendiri.'],
      ['Bagaimana mencetak dari HP?', 'Tekan Cetak / Simpan PDF, lalu pilih Simpan sebagai PDF untuk dikirim ke tempat fotokopi, atau pilih printer yang tersambung. Pastikan ukuran kertas A4.'],
      ['Satu halaman muat berapa transaksi?', 'Setiap halaman pelanggan berisi 25 baris. Bila penuh, tulis sisa hutang di baris Dipindah ke hal. dan lanjutkan di halaman lain.'],
      ['Apa beda template ini dengan aplikasi kasbon?', 'Template kertas cocok untuk mulai rapi. Aplikasi seperti Sirko menghitung sisa hutang otomatis, mencatat cicilan, dan menyimpan cadangan data, sehingga catatan tidak hilang bila buku basah atau terselip.'],
    ],
  });
}

export const TOOLS: Tool[] = [
  { path: '/alat/template-buku-hutang', title: 'Template Buku Hutang Warung', releaseAt: WIB('2026-12-02'), render: templateHutang },
  { path: '/alat/kalkulator-laba-warung', title: 'Kalkulator Laba Warung', releaseAt: WIB('2026-12-08'), render: kalkulator },
];

export const liveTools = (now = nowMs()) => TOOLS.filter((t) => t.releaseAt <= now);
export const toolByPath = (path: string, now = nowMs()) => liveTools(now).find((t) => t.path === path) ?? null;
