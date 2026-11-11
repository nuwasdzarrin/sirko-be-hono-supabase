import { env } from '../config/env.js';
import { escAttr, escHtml } from './markdown.js';
import { breadcrumbsHtml, renderPage, siteUrl, ORG_ID, type Crumb } from './layout.js';

/**
 * Halaman formulir publik: /kontak, /hapus-akun, dan formulir daftar tunggu di beranda.
 * Tanpa JavaScript wajib (progressive enhancement), honeypot `website` untuk bot.
 */

export const FORM_CSS = `
.form{display:grid;gap:14px;max-width:560px}
.form label{display:block;font-weight:700;font-size:15px;margin-bottom:6px}
.form input,.form textarea,.form select{width:100%;box-sizing:border-box;background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:12px;padding:13px 14px;font:inherit;font-size:16px}
.form input:focus,.form textarea:focus,.form select:focus{outline:0;border-color:var(--green);box-shadow:0 0 0 3px var(--green-50)}
.form .hint{font-size:14px;color:var(--mut);margin-top:4px}
.form .btn{justify-self:start}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.note-ok{background:var(--green-50);border:1px solid var(--green);border-radius:14px;padding:14px 16px;font-weight:600}
.note-err{background:var(--mango-50);border:1px solid var(--mango);border-radius:14px;padding:14px 16px;font-weight:600}
`;

export interface FormState {
  ok?: boolean;
  error?: string | null;
  values?: Record<string, string>;
}

const STORE_TYPES = ['Warung / toko kelontong', 'Toko sembako', 'Toko grosir', 'Minimarket', 'Toko bangunan', 'Toko pertanian', 'Lainnya'];

const val = (s: FormState, k: string) => escAttr(s.values?.[k] ?? '');

function notice(s: FormState, okText: string): string {
  if (s.ok) return `<p class="note-ok" role="status">${escHtml(okText)}</p>`;
  if (s.error) return `<p class="note-err" role="alert">${escHtml(s.error)}</p>`;
  return '';
}

/** Formulir daftar tunggu (dipakai di bagian #unduh beranda). */
export function waitlistForm(s: FormState = {}): string {
  if (s.ok) return notice(s, 'Terima kasih! Kami kabari lewat kontak Anda begitu Sirko tersedia di Google Play.');
  return `${notice(s, '')}<form class="form waitlist" method="post" action="/daftar-tunggu#unduh" style="margin:0 auto;text-align:left">
  <div class="hp" aria-hidden="true"><label for="w-web">Website</label><input id="w-web" name="website" tabindex="-1" autocomplete="off"></div>
  <div><label for="w-name">Nama</label><input id="w-name" name="name" autocomplete="name" maxlength="80" value="${val(s, 'name')}" placeholder="mis. Bu Sri"></div>
  <div><label for="w-contact">Nomor WhatsApp atau email</label><input id="w-contact" name="contact" required maxlength="120" inputmode="email" autocomplete="email" value="${val(s, 'contact')}" placeholder="0812xxxx atau nama@email.com"></div>
  <div><label for="w-type">Jenis usaha</label><select id="w-type" name="storeType">${STORE_TYPES.map((t) => `<option${s.values?.storeType === t ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}</select></div>
  <button class="btn btn-primary" type="submit">Kabari saya saat rilis</button>
  <p class="hint" style="margin:0">Kami hanya memakai kontak ini untuk mengabari peluncuran Sirko. Lihat <a href="/kebijakan-privasi">kebijakan privasi</a>.</p>
</form>`;
}

function formPage(o: { path: string; title: string; metaTitle: string; description: string; lead: string; body: string; type?: 'ContactPage' | 'WebPage' }) {
  const crumbs: Crumb[] = [{ name: 'Beranda', path: '/' }, { name: o.title, path: o.path }];
  return renderPage({
    title: o.metaTitle,
    description: o.description,
    path: o.path,
    crumbs,
    extraHead: `<style>${FORM_CSS}</style>`,
    body: `<main id="isi"><div class="wrap"><div class="doc">
  ${breadcrumbsHtml(crumbs)}
  <header class="doc-head"><h1>${escHtml(o.title)}</h1><p class="lead" style="margin:0 0 24px">${o.lead}</p></header>
  ${o.body}
</div></div></main>`,
    jsonLd: [{ '@type': o.type ?? 'ContactPage', '@id': siteUrl(o.path), url: siteUrl(o.path), name: o.title, inLanguage: 'id-ID', about: { '@id': ORG_ID() } }],
  });
}

export function renderContact(s: FormState = {}): string {
  const email = env.SITE_CONTACT_EMAIL;
  return formPage({
    path: '/kontak',
    title: 'Hubungi Sirko',
    metaTitle: 'Kontak Sirko — Tanya, Saran, dan Kerja Sama',
    description: 'Hubungi tim Sirko untuk pertanyaan seputar aplikasi kasir warung, saran fitur, kerja sama, atau bantuan akun. Kami balas lewat WhatsApp atau email.',
    lead: `Ada pertanyaan tentang aplikasi kasir Sirko, saran fitur, atau ingin bekerja sama? Kirim pesan di bawah, kami balas lewat WhatsApp atau email.${email ? ` Bisa juga langsung ke <a href="mailto:${escAttr(email)}">${escHtml(email)}</a>.` : ''}`,
    body: `${notice(s, 'Pesan terkirim. Terima kasih — kami akan membalas secepatnya.')}
${
  s.ok
    ? ''
    : `<form class="form" method="post" action="/kontak">
  <div class="hp" aria-hidden="true"><label for="c-web">Website</label><input id="c-web" name="website" tabindex="-1" autocomplete="off"></div>
  <div><label for="c-name">Nama</label><input id="c-name" name="name" autocomplete="name" maxlength="80" value="${val(s, 'name')}"></div>
  <div><label for="c-contact">Nomor WhatsApp atau email</label><input id="c-contact" name="contact" required maxlength="120" value="${val(s, 'contact')}" placeholder="0812xxxx atau nama@email.com"></div>
  <div><label for="c-msg">Pesan</label><textarea id="c-msg" name="message" required minlength="5" maxlength="2000" rows="6">${escHtml(s.values?.message ?? '')}</textarea></div>
  <button class="btn btn-primary" type="submit">Kirim pesan</button>
  <p class="hint" style="margin:0">Data ini hanya dipakai untuk membalas pesan Anda. Lihat <a href="/kebijakan-privasi">kebijakan privasi</a>.</p>
</form>`
}`,
  });
}

export function renderDeleteAccount(s: FormState = {}): string {
  return formPage({
    path: '/hapus-akun',
    type: 'WebPage',
    title: 'Hapus akun Sirko',
    metaTitle: 'Hapus Akun Sirko dan Datanya',
    description: 'Ajukan penghapusan akun Sirko beserta data toko Anda tanpa perlu memasang aplikasi. Isi email atau nomor WhatsApp yang terdaftar, kami proses dan konfirmasi.',
    lead: 'Ajukan penghapusan akun Sirko beserta data toko Anda di sini, tanpa perlu memasang aplikasi.',
    body: `<div class="prose" style="margin-bottom:24px">
  <h2 id="yang-dihapus">Yang dihapus</h2>
  <ul>
    <li>Akun pemilik: nama, email, nomor WhatsApp, dan password.</li>
    <li>Data toko yang dicadangkan di server: produk, stok, transaksi, pelanggan &amp; kasbon, pemasok, dan karyawan.</li>
    <li>Riwayat dan saldo Poin Sirko. <b>Saldo Poin tidak dapat ditarik tunai</b>, jadi gunakan dulu sebelum mengajukan.</li>
  </ul>
  <h2 id="yang-disimpan">Yang tetap kami simpan</h2>
  <p>Catatan transaksi PPOB dan pembayaran yang wajib disimpan menurut ketentuan hukum dan perpajakan, hanya selama masa yang diwajibkan, lalu dihapus.</p>
  <h2 id="prosesnya">Prosesnya</h2>
  <ol>
    <li>Isi formulir dengan email atau nomor WhatsApp yang terdaftar.</li>
    <li>Kami memverifikasi bahwa permintaan berasal dari pemilik akun (kami hubungi kontak tersebut).</li>
    <li>Akun dan data dihapus paling lambat 30 hari setelah verifikasi, dan kami kirim konfirmasi.</li>
  </ol>
  <p>Data yang tersimpan di HP Anda ikut hilang saat aplikasi dihapus dari HP.</p>
</div>
${notice(s, 'Permintaan diterima. Kami akan menghubungi kontak Anda untuk verifikasi sebelum menghapus akun.')}
${
  s.ok
    ? ''
    : `<form class="form" method="post" action="/hapus-akun">
  <div class="hp" aria-hidden="true"><label for="d-web">Website</label><input id="d-web" name="website" tabindex="-1" autocomplete="off"></div>
  <div><label for="d-contact">Email atau nomor WhatsApp yang terdaftar</label><input id="d-contact" name="contact" required maxlength="120" value="${val(s, 'contact')}"></div>
  <div><label for="d-name">Nama pemilik / nama toko</label><input id="d-name" name="name" maxlength="80" value="${val(s, 'name')}"></div>
  <div><label for="d-msg">Alasan (opsional)</label><textarea id="d-msg" name="message" maxlength="2000" rows="3">${escHtml(s.values?.message ?? '')}</textarea></div>
  <button class="btn btn-primary" type="submit">Ajukan penghapusan akun</button>
</form>`
}`,
  });
}
