import { env } from '../config/env.js';
import { escAttr, escHtml } from './markdown.js';
import { FORM_CSS, waitlistForm, type FormState } from './forms.js';
import { renderPage, siteUrl, ORG_ID } from './layout.js';
import { postCards } from './pages.js';
import type { SitePost } from '../services/site.service.js';

/** Beranda sirkopos.com (desain landing yang disetujui pemilik, 2026-11-11). */

const LANDING_CSS = () => `/* hero */
.hero{padding:64px 0 80px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:-40% -10% auto auto;width:640px;height:640px;background:radial-gradient(circle,var(--mango-50) 0%,transparent 70%);z-index:-1}
.hero .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.hero h1{font-size:clamp(36px,5.6vw,60px);font-weight:800;margin:14px 0 18px}
.hero h1 .hl{color:var(--green);position:relative;white-space:nowrap}
:root[data-theme="dark"] .hero h1 .hl{color:#4FD1A5}
.hero h1 .hl::after{content:"";position:absolute;left:0;right:0;bottom:.06em;height:.22em;background:var(--mango);opacity:.45;z-index:-1;border-radius:4px}
.hero .cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.ticks{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:22px;padding:0;list-style:none;color:var(--mut);font-size:15px;font-weight:600}
.ticks li::before{content:"✓";color:var(--green);font-weight:800;margin-right:6px}
@media (max-width:900px){.hero .wrap{grid-template-columns:1fr}.hero{padding-top:36px}}

/* phone mockup */
.phone{margin:0 auto;width:min(320px,78vw);background:#14213D;border-radius:40px;padding:10px;box-shadow:var(--shadow);transform:rotate(2deg)}
.phone img{display:block;width:100%;height:auto;border-radius:30px}
.hero-shot{margin:0}
.hero-shot figcaption{text-align:center;color:var(--mut);font-size:14px;margin-top:18px}
:root[data-theme="dark"] .phone{background:#000}

/* masalah */
.pain{background:var(--sunk)}
.pain-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:40px}
.pain-card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:24px}
.pain-card .q{font-size:20px;font-weight:800;margin-bottom:8px}
.pain-card p{margin:0;color:var(--mut)}
@media (max-width:820px){.pain-grid{grid-template-columns:1fr}}

/* fitur */
.feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:44px}
.feat{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:26px}
.feat .ic svg{color:var(--green-tx)}
.feat .ic{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:var(--green-50);margin-bottom:16px}
.feat:nth-child(3n+2) .ic{background:var(--mango-50)}
.feat h3{font-size:20px;margin-bottom:8px}
.feat p{margin:0;color:var(--mut);font-size:16px}
@media (max-width:900px){.feat-grid{grid-template-columns:1fr 1fr}}
@media (max-width:600px){.feat-grid{grid-template-columns:1fr}}

/* ppob */
.ppob .wrap{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.ppob-card{background:#0A5A45;color:#fff;border-radius:28px;padding:34px;box-shadow:var(--shadow)}
.ppob-card .big{font-size:44px;font-weight:800;letter-spacing:-.03em}
.ppob-card ul{list-style:none;padding:0;margin:20px 0 0;display:grid;gap:10px}
.ppob-card li{background:#16654F;border-radius:14px;padding:12px 16px;display:flex;justify-content:space-between;font-weight:600}
.ppob-card li b{color:#FFE3AE}
.ppob-card .muted{color:#E3F1EC}
.steps{list-style:none;padding:0;margin:26px 0 0;display:grid;gap:14px;counter-reset:s}
.steps li{display:flex;gap:14px;align-items:flex-start}
.steps li::before{counter-increment:s;content:counter(s);flex:none;width:32px;height:32px;border-radius:50%;background:var(--mango);color:#14213D;font-weight:800;display:grid;place-items:center}
.note{font-size:14px;color:var(--mut);margin-top:16px}
@media (max-width:900px){.ppob .wrap{grid-template-columns:1fr}}

/* offline */
.offline{background:var(--ink);color:#fff}
:root[data-theme="dark"] .offline{background:#0A1020}
.offline .wrap{display:grid;grid-template-columns:1.2fr 1fr;gap:40px;align-items:center}
.offline h2{color:#fff}
.offline .lead{color:#C9D0DE}
.signal{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
.signal span{border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:8px 14px;font-weight:600;font-size:15px}
.flow{display:grid;gap:12px}
.flow div{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:16px 18px}
.flow b{color:#FFD48A}
@media (max-width:900px){.offline .wrap{grid-template-columns:1fr}}

/* harga */
.price-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;max-width:880px;margin:44px auto 0}
.plan{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:32px;position:relative}
.plan.best{border:2px solid var(--green);box-shadow:var(--shadow)}
.plan .badge{position:absolute;top:-14px;left:28px;background:var(--mango);color:#14213D;font-weight:800;font-size:13px;border-radius:999px;padding:4px 12px}
.plan h3{font-size:22px}
.plan .amt{font-size:42px;font-weight:800;letter-spacing:-.03em;margin:10px 0 2px}
.plan .amt small{font-size:16px;font-weight:600;color:var(--mut)}
.plan .sub{color:var(--mut);font-size:15px;margin:0 0 18px}
.plan ul{list-style:none;padding:0;margin:0 0 24px;display:grid;gap:9px;font-size:16px}
.plan li::before{content:"✓";color:var(--green);font-weight:800;margin-right:8px}
.plan .btn{width:100%;justify-content:center}
@media (max-width:760px){.price-grid{grid-template-columns:1fr}}

/* mulai */
.start-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:40px}
.start-grid div{border-top:4px solid var(--mango);background:var(--card);border-radius:0 0 18px 18px;padding:22px;border-left:1px solid var(--line);border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.start-grid b{display:block;font-size:19px;margin-bottom:6px}
.start-grid p{margin:0;color:var(--mut)}
@media (max-width:820px){.start-grid{grid-template-columns:1fr}}

/* faq */
.faq{background:var(--sunk)}
.faq-list{max-width:820px;margin:36px auto 0;display:grid;gap:12px}
details{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 22px}
summary{font-weight:700;font-size:18px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:16px}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";font-size:24px;line-height:1;color:var(--green)}
details[open] summary::after{content:"–"}
details p{margin:12px 0 0;color:var(--mut)}

/* cta akhir */
.final{text-align:center}
.final-box{background:#FFA62E;color:#14213D;border-radius:32px;padding:56px 24px}
.final-box h2{color:#14213D}
.final-box p{font-size:19px;margin:12px auto 26px;max-width:560px}
.final-box .btn-primary{background:#14213D;box-shadow:none}


.h1-kicker{display:block;font-size:13px;letter-spacing:.08em;margin-bottom:14px;line-height:1.4}
.shots{background:var(--sunk)}
.shot-row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:18px;margin-top:40px;text-align:left}
.shot{margin:0;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:10px 10px 14px}
.shot img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line)}
.shot figcaption{font-size:14px;color:var(--mut);margin-top:10px;line-height:1.45}
.shot figcaption b{display:block;color:var(--ink);font-size:15px}
@media (max-width:1100px){.shot-row{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:700px){.shot-row{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:14px;padding-bottom:8px;margin-inline:-20px;padding-inline:20px}.shot{flex:0 0 62vw;scroll-snap-align:center}}
.feat p a,.lead a{color:var(--green-tx);font-weight:700;text-underline-offset:3px}
.latest .head{display:flex;justify-content:space-between;align-items:end;gap:16px;flex-wrap:wrap;margin-bottom:28px}
.final-box .form{max-width:440px;margin:0 auto}
.final-box .form label{color:#14213D}
.final-box .form input::placeholder{color:#5B6478;opacity:1}
.final-box .form input,.final-box .form select{background:#fff;color:#14213D;border-color:rgba(20,33,61,.2)}
.final-box .form .hint{color:#14213D;font-size:14px}
.final-box .form .hint a{color:#14213D;font-weight:700}
.final-box .note-ok,.final-box .note-err{color:#14213D;background:#fff;max-width:440px;margin:0 auto}
${FORM_CSS}
`;

const SHOTS: Array<[string, string, string]> = [
  ['01-kasir', 'Kasir cepat', 'Keranjang, diskon, dan total otomatis.'],
  ['03-kasbon', 'Kasbon rapi', 'Siapa yang masih berutang dan berapa sisanya.'],
  ['04-laporan-laba', 'Laba kelihatan', 'Pendapatan, modal, laba, dan margin hari ini.'],
  ['05-stok', 'Stok terpantau', 'Barang yang hampir habis ditandai merah.'],
  ['06-ppob-token', 'Token listrik', 'Cek nama pelanggan dari nomor meter.'],
  ['08-offline', 'Tetap jalan offline', 'Tanpa sinyal, kasir barang tetap bisa dipakai.'],
];

export const LANDING_FAQ: Array<[string, string]> = [
  ['Apakah Sirko benar-benar gratis?', 'Ya. Paket Warung gratis untuk satu toko: kasir, stok, kasbon, laporan, dan cadangan data. Paket Juragan Rp49.000 per bulan diperlukan bila Anda butuh akun karyawan, ekspor laporan ke Excel/PDF, logo di struk, atau mengelola sampai 3 toko.'],
  ['Apakah aplikasi kasir Sirko bisa dipakai tanpa internet?', 'Bisa. Kasir, stok, dan kasbon tersimpan di HP sehingga tetap jalan walau sinyal hilang. Begitu ada internet, data dicadangkan otomatis. Hanya penjualan pulsa, paket data, dan token listrik yang memerlukan internet.'],
  ['Bagaimana cara jualan pulsa dan token listrik di Sirko?', 'Isi Poin Sirko lewat transfer atau QRIS, lalu jual pulsa, paket data, atau token listrik langsung dari layar kasir. Anda menentukan sendiri harga jual dan untungnya, dan item itu tercatat di nota yang sama dengan barang lain.'],
  ['Apakah data toko saya aman kalau HP rusak atau hilang?', 'Aman. Data toko dicadangkan ke cloud setiap ada internet. Masuk dengan email atau nomor WA di HP baru, dan data toko kembali.'],
  ['Sirko cocok untuk usaha apa saja?', 'Sirko dibuat untuk usaha ritel: warung, toko kelontong, toko sembako, toko grosir, minimarket, toko bangunan, dan toko pertanian. Sirko tidak dirancang untuk kafe atau restoran.'],
];

export function renderLanding(latestPosts: SitePost[], waitlist: FormState = {}): string {
  const latest = latestPosts.length
    ? `<section class="latest" id="blog"><div class="wrap">
  <div class="head"><div><span class="eyebrow">Belajar dari blog</span><h2>Tips mengelola warung</h2></div><a class="btn btn-ghost" href="/blog">Semua artikel</a></div>
  ${postCards(latestPosts.slice(0, 3), 'h3')}
</div></section>`
    : '';
  const download = env.PLAY_STORE_URL
    ? `<p>Gratis untuk satu toko, tanpa kartu kredit.</p><a class="btn btn-primary" href="${escAttr(env.PLAY_STORE_URL)}" rel="noopener">Unduh di Google Play</a>`
    : `<p>Sirko segera hadir di Google Play. Daftar sekarang, kami kabari begitu bisa diunduh — gratis untuk satu toko.</p>${waitlistForm(waitlist)}`;
  const faq = LANDING_FAQ.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${escHtml(q)}</summary><p>${escHtml(a)}</p></details>`).join('\n      ');
  const body = `<main>

<section class="hero" id="isi">
  <div class="wrap">
    <div>
      <h1><span class="eyebrow h1-kicker">Aplikasi kasir gratis untuk warung &amp; toko kelontong</span> Kasir toko, <span class="hl">untung kelihatan.</span></h1>
      <p class="lead">Sirko mencatat setiap penjualan, stok, dan kasbon dari HP Android Anda, tetap jalan walau sinyal hilang. Ditambah jualan pulsa &amp; token listrik di nota yang sama.</p>
      <div class="cta">
        <a class="btn btn-primary" href="#unduh">Coba Gratis Sekarang</a>
        <a class="btn btn-ghost" href="#fitur">Lihat Fitur</a>
      </div>
      <ul class="ticks">
        <li>Gratis untuk 1 toko</li>
        <li>Bisa tanpa internet</li>
        <li>Tanpa alat khusus, cukup HP</li>
      </ul>
    </div>
    <figure class="hero-shot">
      <div class="phone"><img src="/img/app/02-nota-ppob.webp" srcset="/img/app/02-nota-ppob-360.webp 360w, /img/app/02-nota-ppob.webp 720w" sizes="(max-width:900px) 70vw, 320px" width="720" height="1280" alt="Layar aplikasi kasir Sirko: satu nota berisi token listrik PLN beserta tokennya, beras, dan gula" fetchpriority="high" decoding="async"></div>
      <figcaption>Tampilan asli aplikasi: sembako &amp; token listrik dalam satu nota.</figcaption>
    </figure>
  </div>
</section>

<section class="pain">
  <div class="wrap center">
    <span class="eyebrow">Kenal masalah ini?</span>
    <h2>Toko ramai, tapi untungnya ke mana?</h2>
    <div class="pain-grid" style="text-align:left">
      <div class="pain-card"><div class="q">“Catatan buku hilang.”</div><p>Buku tulis basah, robek, atau lupa ditulis. Sirko menyimpan setiap transaksi otomatis dan mencadangkannya ke cloud.</p></div>
      <div class="pain-card"><div class="q">“Siapa yang masih ngutang?”</div><p>Kasbon pelanggan tercatat rapi lengkap dengan cicilannya, jadi tidak ada lagi utang yang terlupa.</p></div>
      <div class="pain-card"><div class="q">“Stok habis tanpa sadar.”</div><p>Stok berkurang sendiri setiap barang terjual, dan Sirko memberi tahu barang yang hampir habis atau mendekati kedaluwarsa.</p></div>
    </div>
  </div>
</section>

<section id="fitur">
  <div class="wrap center">
    <span class="eyebrow">Fitur</span>
    <h2>Semua yang dibutuhkan toko, di satu aplikasi</h2>
    <p class="lead">Dibuat khusus untuk usaha ritel Indonesia: <a href="/aplikasi-kasir-warung">warung, kelontong, toko sembako</a>, grosir, sampai minimarket.</p>
    <div class="feat-grid" style="text-align:left">
      <div class="feat"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></div><h3>Kasir cepat</h3><p>Cari barang atau scan barcode pakai kamera HP, hitung kembalian otomatis, dan simpan nota sekali tekan.</p></div>
      <div class="feat"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg></div><h3>Stok otomatis</h3><p>Stok berkurang tiap penjualan dan bertambah saat barang masuk. Lengkap dengan varian, harga grosir, dan stok opname.</p></div>
      <div class="feat"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/></svg></div><h3>Kasbon &amp; cicilan</h3><p>Catat utang pelanggan, terima cicilan, dan lihat siapa saja yang belum lunas. <a href="/aplikasi-kasbon">Lihat cara kerjanya</a></p></div>
      <div class="feat"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/></svg></div><h3>Laporan laba</h3><p>Lihat penjualan, modal, dan laba per hari atau per bulan. Ekspor ke Excel &amp; PDF tersedia di paket Juragan.</p></div>
      <div class="feat"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg></div><h3>Pulsa &amp; token listrik</h3><p>Jual pulsa, paket data, dan token listrik dari layar kasir yang sama. Untungnya Anda tentukan sendiri. <a href="/jualan-pulsa-token-listrik">Selengkapnya</a></p></div>
      <div class="feat"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/><path d="m9.5 13 2 2 3.5-3.5"/></svg></div><h3>Data aman di cloud</h3><p>HP rusak atau hilang? Masuk di HP baru dengan email atau nomor WA, dan data toko kembali.</p></div>
    </div>
  </div>
</section>

<section class="shots" id="tampilan">
  <div class="wrap center">
    <span class="eyebrow">Lihat aplikasinya</span>
    <h2>Begini rasanya pakai Sirko di warung</h2>
    <p class="lead">Semua tangkapan layar di bawah ini diambil dari aplikasi Sirko yang sebenarnya, dengan data contoh.</p>
    <div class="shot-row" role="list">
      ${SHOTS.map(([f, t, d]) => `<figure class="shot" role="listitem"><img src="/img/app/${f}.webp" srcset="/img/app/${f}-360.webp 360w, /img/app/${f}.webp 720w" sizes="(max-width:700px) 62vw, 220px" width="720" height="1280" alt="${escAttr(`${t}: ${d}`)}" loading="lazy" decoding="async"><figcaption><b>${t}</b>${d}</figcaption></figure>`).join('')}
    </div>
  </div>
</section>

<section class="ppob" id="ppob">
  <div class="wrap">
    <div>
      <span class="eyebrow">Penghasilan tambahan</span>
      <h2>Jual sembako dan token listrik di nota yang sama</h2>
      <p class="lead">Pelanggan beli beras sekalian isi pulsa? Masukkan semuanya ke satu keranjang. Barang tercatat, token langsung terbit, laba keduanya masuk laporan.</p>
      <ol class="steps">
        <li><span><b>Isi Poin Sirko</b> lewat transfer bank atau QRIS.</span></li>
        <li><span><b>Atur untung sendiri</b> per kategori: pulsa, paket data, token listrik.</span></li>
        <li><span><b>Jual dari kasir.</b> Nomor tujuan, nominal, bayar, selesai.</span></li>
      </ol>
      <p class="note">Gagal terkirim? Poin otomatis kembali. Penjualan pulsa &amp; token butuh internet; kasir lainnya tetap jalan offline.</p>
    </div>
    <div class="ppob-card" aria-hidden="true">
      <div class="muted" style="font-weight:600">Contoh untung sehari</div>
      <div class="big">+Rp40.000</div>
      <ul>
        <li>Token listrik 20rb × 8 <b>+Rp16.000</b></li>
        <li>Pulsa 10rb × 6 <b>+Rp12.000</b></li>
        <li>Paket data × 6 <b>+Rp12.000</b></li>
      </ul>
      <div class="muted" style="font-size:13px;margin-top:14px">Ilustrasi dengan untung Rp2.000 per transaksi. Untung sebenarnya tergantung harga jual Anda.</div>
    </div>
  </div>
</section>

<section class="offline">
  <div class="wrap">
    <div>
      <span class="eyebrow" style="color:#FFD48A">Bisa offline</span>
      <h2>Sinyal hilang? Kasir tetap jalan.</h2>
      <p class="lead">Semua data toko tersimpan di HP, bukan menunggu server. Begitu internet kembali, Sirko mencadangkannya diam-diam di latar belakang. <a href="/aplikasi-kasir-offline" style="color:#FFD48A">Cara kerja kasir offline</a></p>
      <div class="signal"><span>Sinyal lemah</span><span>Pelosok desa</span><span>Kuota habis</span></div>
    </div>
    <div class="flow">
      <div><b>1. Jualan</b> — nota tersimpan langsung di HP.</div>
      <div><b>2. Internet kembali</b> — data dicadangkan otomatis.</div>
      <div><b>3. Ganti HP</b> — masuk, data toko kembali utuh.</div>
    </div>
  </div>
</section>

<section id="harga">
  <div class="wrap center">
    <span class="eyebrow">Harga</span>
    <h2>Mulai gratis. Bayar hanya kalau toko bertambah.</h2>
    <p class="lead">Tidak perlu kartu kredit. Tidak ada biaya tersembunyi.</p>
    <div class="price-grid" style="text-align:left">
      <div class="plan best">
        <span class="badge">Gratis selamanya</span>
        <h3>Warung</h3>
        <div class="amt">Rp0 <small>selamanya</small></div>
        <p class="sub">Untuk satu toko.</p>
        <ul>
          <li>Kasir, stok &amp; scan barcode</li>
          <li>Kasbon &amp; cicilan pelanggan</li>
          <li>Laporan penjualan &amp; laba</li>
          <li>Jual pulsa, data &amp; token listrik</li>
          <li>Cadangan data otomatis</li>
        </ul>
        <a class="btn btn-primary" href="#unduh">Coba Gratis</a>
      </div>
      <div class="plan">
        <h3>Juragan</h3>
        <div class="amt">Rp49.000 <small>/bulan</small></div>
        <p class="sub">Atau Rp499.000 per tahun. Untuk toko yang punya karyawan atau beberapa cabang.</p>
        <ul>
          <li>Semua fitur Warung</li>
          <li>Kelola sampai 3 toko</li>
          <li>Laporan gabungan semua toko</li>
          <li>Salin produk &amp; kirim stok antar-toko</li>
          <li>Akun karyawan (tanpa akses laba &amp; modal)</li>
          <li>Ekspor laporan ke Excel &amp; PDF</li>
          <li>Logo toko di struk</li>
        </ul>
        <a class="btn btn-ghost" href="#unduh">Mulai dari Gratis</a>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap center">
    <span class="eyebrow">Cara mulai</span>
    <h2>Siap jualan dalam 5 menit</h2>
    <div class="start-grid" style="text-align:left">
      <div><b>1. Pasang Sirko</b><p>Unduh aplikasinya di HP Android Anda.</p></div>
      <div><b>2. Daftar &amp; buat toko</b><p>Isi nama, email, dan nomor WA, lalu beri nama toko Anda.</p></div>
      <div><b>3. Masukkan barang</b><p>Scan barcode; ribuan produk umum sudah tersedia lengkap dengan foto.</p></div>
    </div>
  </div>
</section>

${latest}
<section class="faq" id="faq">
  <div class="wrap">
    <div class="center"><span class="eyebrow">Tanya jawab</span><h2>Yang sering ditanyakan</h2></div>
    <div class="faq-list">
      ${faq}
    </div>
  </div>
</section>

<section class="final" id="unduh">
  <div class="wrap">
    <div class="final-box">
      <h2>Saatnya untung toko Anda kelihatan.</h2>
      ${download}
    </div>
  </div>
</section>

</main>`;
  const app = {
    '@type': 'SoftwareApplication',
    name: 'Sirko',
    alternateName: 'Sirko POS',
    url: siteUrl('/'),
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Point of Sale',
    operatingSystem: 'Android',
    inLanguage: 'id-ID',
    description: 'Aplikasi kasir untuk warung, toko kelontong, dan toko sembako. Bisa offline, catat stok dan kasbon, jual pulsa dan token listrik.',
    image: siteUrl('/img/og-image.png'),
    screenshot: SHOTS.map(([f]) => siteUrl(`/img/app/${f}.webp`)),
    publisher: { '@id': ORG_ID() },
    offers: [
      { '@type': 'Offer', name: 'Paket Warung', price: '0', priceCurrency: 'IDR' },
      { '@type': 'Offer', name: 'Paket Juragan (bulanan)', price: '49000', priceCurrency: 'IDR' },
      { '@type': 'Offer', name: 'Paket Juragan (tahunan)', price: '499000', priceCurrency: 'IDR' },
    ],
    ...(env.PLAY_STORE_URL ? { downloadUrl: env.PLAY_STORE_URL, installUrl: env.PLAY_STORE_URL } : {}),
  };
  return renderPage({
    title: 'Aplikasi Kasir Gratis untuk Warung & Toko Kelontong | Sirko',
    description:
      'Sirko adalah aplikasi kasir gratis untuk warung dan toko kelontong. Catat penjualan, stok, dan kasbon tanpa internet, plus jual pulsa & token listrik.',
    path: '/',
    body,
    waAsk: 'aplikasi kasir Sirko (harga, cara pakai, atau pulsa & token listrik)',
    extraHead: `<style>${LANDING_CSS()}</style>`,
    preload: '/img/app/02-nota-ppob.webp',
    preloadSrcset: '/img/app/02-nota-ppob-360.webp 360w, /img/app/02-nota-ppob.webp 720w',
    preloadSizes: '(max-width:900px) 70vw, 320px',
    jsonLd: [
      { '@type': 'WebSite', '@id': siteUrl('/#website'), url: siteUrl('/'), name: 'Sirko', inLanguage: 'id-ID', publisher: { '@id': ORG_ID() } },
      app,
      {
        '@type': 'FAQPage',
        mainEntity: LANDING_FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  });
}
