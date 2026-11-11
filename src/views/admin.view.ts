import { esc, helpers, pagerHtml, renderAuthCard, renderLayout } from './dashboard.view.js';
import type { AdminUser } from '../services/admin.service.js';
import type { UserDetail, UserRow, UserStatusFilter } from '../services/users-admin.service.js';

/** Halaman admin: lupa/reset password, profil (password & Telegram), pengguna terdaftar. */

const rp = (v: number) => esc(helpers.fmtRp(v));
const dt = (v: number | null | undefined) => (v ? esc(helpers.fmtDateTime(v)) : '—');

const CSS = `<style>
  .prof{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start;max-width:980px}
  .prof .panel h3{margin-top:0}
  .prof .fields{grid-template-columns:minmax(0,1fr)}
  .prof .fields input{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:9px 11px;font:inherit;font-size:14px}
  .prof .fields input:focus{outline:0;border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
  .u-table td.nw{white-space:nowrap}
  .ava{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;background:var(--acc-soft);color:var(--acc);flex:none}
  .prof-head{display:flex;gap:14px;align-items:center}
  .tg-link{display:block;word-break:break-all;background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:13px}
  .pill.ok{color:var(--ok);border-color:var(--ok-line)} .pill.bad{color:var(--bad);border-color:var(--bad-line)} .pill.warn{color:var(--warn);border-color:var(--warn-line)}
  .u-stores a{white-space:nowrap}
  .kv2{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 16px;font-size:13px}
  .kv2 b{display:block;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .stmt{width:100%;border-collapse:collapse}
  .stmt td{padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px}
  .stmt td.v{text-align:right;font-variant-numeric:tabular-nums}
  @media (max-width:860px){.prof{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:640px){
    .u-cards{overflow:visible;border:0;background:none}
    .u-cards table,.u-cards tbody{display:block;width:100%;min-width:0}
    .u-cards thead{display:none}
    .u-cards tr{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:10px}
    .u-cards td{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:4px 0;border:0;text-align:right}
    .u-cards td::before{content:attr(data-l);color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;flex:none}
    .u-cards td.empty{display:block;text-align:center}
    .u-cards td.empty::before{content:none}
  }
</style>`;

// ── Lupa / reset password ────────────────────────────────────────────────────

export function renderForgot(o: { email: string; error?: string | null }): string {
  return renderAuthCard({
    title: 'Lupa password',
    sub: 'Masukkan email admin. Kami kirim kode 6 digit untuk membuat password baru.',
    error: o.error ?? null,
    body: `<form method="post" action="/dashboard/forgot">
  <div class="field"><label for="email">Email admin</label>
    <div class="input"><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${esc(o.email)}"></div></div>
  <button class="btn primary submit" type="submit">Kirim kode</button>
</form>`,
  });
}

export function renderReset(o: { email: string; error?: string | null; notice?: string | null; devCode?: string }): string {
  return renderAuthCard({
    title: 'Buat password baru',
    sub: 'Masukkan kode 6 digit dari email, lalu password baru (minimal 8 karakter).',
    error: o.error ?? null,
    notice: o.notice ? o.notice + (o.devCode ? ` (dev: ${o.devCode})` : '') : null,
    body: `<form method="post" action="/dashboard/reset" autocomplete="off">
  <div class="field"><label for="email">Email admin</label>
    <div class="input"><input id="email" name="email" type="email" required value="${esc(o.email)}" ${o.email ? 'readonly' : 'autofocus'}></div></div>
  <div class="field"><label for="code">Kode 6 digit</label>
    <div class="input otp-input"><input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code" ${o.email ? 'autofocus' : ''}></div></div>
  <div class="field"><label for="password">Password baru</label>
    <div class="input"><input id="password" name="password" type="password" minlength="8" required autocomplete="new-password"></div></div>
  <div class="field"><label for="confirm">Ulangi password baru</label>
    <div class="input"><input id="confirm" name="confirm" type="password" minlength="8" required autocomplete="new-password"></div></div>
  <button class="btn primary submit" type="submit">Simpan &amp; masuk</button>
</form>
<form method="post" action="/dashboard/forgot" style="margin-top:12px;text-align:center">
  <input type="hidden" name="email" value="${esc(o.email)}">
  <button class="btn ghost" type="submit" ${o.email ? '' : 'disabled'}>Kirim ulang kode</button>
</form>`,
  });
}

// ── Profil admin ─────────────────────────────────────────────────────────────

export function renderProfile(
  a: AdminUser,
  o: { botUsername: string | null; serverTime: number; error?: string | null; tgLink?: { url: string; expiresAt: number } | null },
): string {
  const initial = esc((a.name || a.email).trim().charAt(0).toUpperCase() || 'A');
  const tg = a.telegramChatId
    ? `<p style="margin:0 0 10px;font-size:13px"><span class="pill ok">Tertaut</span> ${a.telegramUsername ? `@${esc(a.telegramUsername)}` : `chat ${esc(a.telegramChatId)}`} · sejak ${dt(a.telegramLinkedAt)}</p>
<p class="mut" style="font-size:13px;margin:0 0 12px">Notifikasi order token, top-up, dan gangguan PPOB dikirim ke sini. Di bot Anda juga bisa kirim <b>/ringkasan</b>, <b>/token</b>, <b>/topup</b>, <b>/saldo</b>, dan memproses token listrik tanpa membuka web.</p>
<div style="display:flex;gap:8px;flex-wrap:wrap">
  <form method="post" action="/dashboard/profile/telegram/test"><button class="btn ghost" type="submit">Kirim pesan uji</button></form>
  <form method="post" action="/dashboard/profile/telegram/unlink" onsubmit="return confirm('Putuskan Telegram dari akun admin ini?')"><button class="btn bad" type="submit">Putuskan Telegram</button></form>
</div>`
    : o.tgLink
      ? `<p style="margin:0 0 6px;font-size:13px"><span class="pill warn">Menunggu</span> Buka tautan berikut di HP/PC yang ada Telegram-nya, lalu tekan <b>Start</b> di bot:</p>
<a class="tg-link" href="${esc(o.tgLink.url)}" target="_blank" rel="noopener">${esc(o.tgLink.url)}</a>
<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
  <a class="btn primary" href="${esc(o.tgLink.url)}" target="_blank" rel="noopener">Buka Telegram</a>
  <a class="btn ghost" href="/dashboard/profile">Sudah, muat ulang</a>
  <span class="mut" style="font-size:12px">Berlaku sampai ${dt(o.tgLink.expiresAt)} · sekali pakai</span>
</div>`
      : `<p style="margin:0 0 12px;font-size:13px"><span class="pill bad">Belum tertaut</span> Hubungkan Telegram agar notifikasi order & top-up masuk ke Telegram Anda${o.botUsername ? ` (bot <b>@${esc(o.botUsername)}</b>)` : ''}.</p>
<form method="post" action="/dashboard/profile/telegram/link"><button class="btn primary" type="submit" ${o.botUsername ? '' : 'disabled title="Bot belum dikonfigurasi"'}>Hubungkan Telegram</button></form>`;

  const body = `${CSS}<div class="titlebar"><h1>Profil</h1></div>
${o.error ? `<div class="flash err" role="alert">${esc(o.error)}</div>` : ''}
<div class="prof">
  <div>
    <div class="panel"><div class="prof-head"><span class="ava">${initial}</span><div><b style="font-size:16px">${esc(a.name || 'Admin')}</b><div class="mut" style="font-size:13px">${esc(a.email)}</div><div class="mut" style="font-size:12px">Admin sejak ${dt(a.createdAt)}</div></div></div></div>
    <form method="post" action="/dashboard/profile" class="panel" style="margin-top:12px">
      <h3>Data admin</h3>
      <div class="fields">
        <div class="f"><label for="name">Nama</label><input id="name" name="name" required maxlength="80" value="${esc(a.name)}"></div>
        <div class="f"><label for="email">Email (untuk login &amp; lupa password)</label><input id="email" name="email" type="email" required maxlength="120" value="${esc(a.email)}"></div>
      </div>
      <div class="form-actions"><button class="btn primary" type="submit">Simpan profil</button></div>
    </form>
  </div>
  <div>
    <div class="panel"><h3>Notifikasi Telegram</h3>${tg}</div>
    <form method="post" action="/dashboard/profile/password" class="panel" style="margin-top:12px" autocomplete="off">
      <h3>Ganti password</h3>
      <div class="fields">
        <div class="f"><label for="current">Password sekarang</label><input id="current" name="current" type="password" required autocomplete="current-password"></div>
        <div class="f"><label for="password">Password baru</label><input id="password" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
        <div class="f"><label for="confirm">Ulangi password baru</label><input id="confirm" name="confirm" type="password" minlength="8" required autocomplete="new-password"></div>
      </div>
      <p class="mut" style="font-size:12px;margin:8px 0 0">Setelah diganti, sesi di perangkat lain otomatis keluar. Lupa password? Keluar lalu pilih <b>Lupa password</b> di halaman masuk.</p>
      <div class="form-actions"><button class="btn primary" type="submit">Ganti password</button></div>
    </form>
  </div>
</div>`;
  return renderLayout({ title: 'Profil', active: 'profile', body, serverTime: o.serverTime });
}

// ── Pengguna terdaftar ───────────────────────────────────────────────────────

const FILTER_LABEL: Record<UserStatusFilter, string> = {
  semua: 'Semua',
  verified: 'Email terverifikasi',
  unverified: 'Belum verifikasi',
  juragan: 'Paket Juragan',
  no_store: 'Belum punya toko',
};

function statusPills(u: UserRow): string {
  const p: string[] = [];
  if (u.isAdmin) p.push('<span class="pill">admin</span>');
  if (u.pendingVerification) p.push('<span class="pill warn">belum verifikasi</span>');
  else if (u.emailVerified) p.push('<span class="pill ok">terverifikasi</span>');
  if (u.juragan) p.push('<span class="pill ok">Juragan</span>');
  return p.join(' ') || '<span class="mut">—</span>';
}

const storeLinks = (u: UserRow) =>
  u.stores.length
    ? u.stores.map((s) => `<a href="/dashboard/businesses/${esc(s.id)}">${esc(s.name)}</a>${s.role !== 'owner' ? ` <span class="mut">(${esc(s.role)})</span>` : ''}`).join(', ')
    : '<span class="mut">—</span>';

export function renderUsers(d: Awaited<ReturnType<typeof import('../services/users-admin.service.js').listUsers>>, serverTime: number): string {
  const url = (o: { status?: string; page?: number; q?: string }) => {
    const p = new URLSearchParams();
    const status = o.status ?? d.status;
    const q = o.q ?? d.q;
    if (status !== 'semua') p.set('status', status);
    if (q) p.set('q', q);
    if (o.page && o.page > 1) p.set('page', String(o.page));
    const s = p.toString();
    return '/dashboard/users' + (s ? `?${s}` : '');
  };
  const sub = (Object.keys(FILTER_LABEL) as UserStatusFilter[])
    .map((k) => `<a class="${d.status === k ? 'on' : ''}" href="${esc(url({ status: k }))}">${FILTER_LABEL[k]} (${helpers.fmtNum(d.counts[k] ?? 0)})</a>`)
    .join('');
  const rows = d.items
    .map(
      (u) => `<tr class="rowlink" onclick="location.href='/dashboard/users/${esc(u.id)}'">
    <td data-l="Nama"><b>${esc(u.name || '—')}</b></td>
    <td data-l="Email" class="mut">${esc(u.email ?? '—')}</td>
    <td data-l="WA" class="mut">${esc(u.phone ?? '—')}</td>
    <td data-l="Toko" class="u-stores">${storeLinks(u)}</td>
    <td data-l="Poin" class="num nw">${rp(u.balance)}</td>
    <td data-l="Status">${statusPills(u)}</td>
    <td data-l="Daftar" class="mut nw">${dt(u.createdAt)}</td>
    <td data-l="Aktif" class="mut nw">${dt(u.lastActiveAt)}</td></tr>`,
    )
    .join('');
  const body = `${CSS}<div class="titlebar"><h1>Pengguna terdaftar</h1></div>
<div class="grid" style="margin-bottom:14px">
  <div class="kpi"><div class="n">${helpers.fmtNum(d.counts.semua)}</div><div class="l">Total akun</div></div>
  <div class="kpi"><div class="n">${helpers.fmtNum(d.counts.new7d)}</div><div class="l">Daftar 7 hari terakhir</div></div>
  <div class="kpi"><div class="n">${helpers.fmtNum(d.counts.juragan)}</div><div class="l">Paket Juragan aktif</div></div>
</div>
<div class="subnav">${sub}</div>
<form method="get" action="/dashboard/users" class="pp-row" style="display:flex;gap:6px;margin:0 0 12px">
  ${d.status !== 'semua' ? `<input type="hidden" name="status" value="${esc(d.status)}">` : ''}
  <input type="search" name="q" value="${esc(d.q)}" placeholder="Nama / email / WA / nama toko" style="flex:1;min-width:0;max-width:360px;background:var(--card);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px">
  <button class="btn ghost" type="submit">Cari</button>
</form>
<div class="tablewrap u-cards"><table class="u-table">
<thead><tr><th>Nama</th><th>Email</th><th>WA</th><th>Toko</th><th class="num">Poin</th><th>Status</th><th>Daftar</th><th>Aktif terakhir</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" class="empty">Tidak ada pengguna pada filter ini.</td></tr>'}</tbody></table></div>
${pagerHtml(d.page, d.pages, d.total, (p) => esc(url({ page: p })))}`;
  return renderLayout({ title: 'Pengguna', active: 'users', body, serverTime });
}

export function renderUserDetail(d: UserDetail, serverTime: number): string {
  const u = d.user;
  const plan =
    d.plan.name === 'juragan'
      ? `Juragan (${d.plan.period === 'yearly' ? 'tahunan' : 'bulanan'}) · s/d ${dt(d.plan.expiresAt)} · maks ${d.plan.maxStores} toko`
      : 'Warung (gratis)';
  const body = `${CSS}<a class="crumb" href="/dashboard/users">← Semua pengguna</a>
<div class="titlebar"><h1 style="font-size:18px">${esc(u.name || u.email || 'Pengguna')}</h1>${statusPills(u)}</div>
<div class="prof">
  <div>
    <div class="panel"><div class="kv2">
      <div><b>Nama</b>${esc(u.name ?? '—')}</div>
      <div><b>Email</b>${esc(u.email ?? '—')}</div>
      <div><b>No. WA</b>${esc(u.phone ?? '—')}</div>
      <div><b>Email</b>${u.emailVerified ? 'terverifikasi' : u.pendingVerification ? 'belum verifikasi (belum bisa login)' : '—'}</div>
      <div><b>Paket</b>${esc(plan)}</div>
      <div><b>Daftar</b>${dt(u.createdAt)}</div>
      <div><b>Aktif terakhir</b>${dt(u.lastActiveAt)}</div>
      <div><b>ID akun</b><code style="word-break:break-all">${esc(u.id)}</code></div>
    </div></div>
    <h2>Toko</h2>
    <div class="panel">${u.stores.length ? `<table class="stmt">${u.stores.map((s) => `<tr><td><a href="/dashboard/businesses/${esc(s.id)}">${esc(s.name)}</a></td><td class="v mut">${esc(s.role)}</td></tr>`).join('')}</table>` : '<span class="mut">Belum punya toko.</span>'}</div>
  </div>
  <div>
    <div class="panel"><h3>Poin Sirko</h3>
      <div style="font-size:24px;font-weight:800;margin-bottom:8px">${rp(u.balance)}</div>
      <table class="stmt">${d.ledger.map((l) => `<tr><td>${esc(l.type)} · ${dt(l.createdAt)}${l.note ? `<br><span class="mut" style="font-size:12px">${esc(l.note)}</span>` : ''}</td><td class="v">${l.amount > 0 ? '+' : ''}${rp(l.amount)}</td></tr>`).join('') || '<tr><td class="mut">Belum ada mutasi.</td></tr>'}</table>
      ${u.stores[0] ? `<a class="mini" href="/dashboard/businesses/${esc(u.stores[0].id)}?tab=points" style="display:inline-block;margin-top:10px">Kelola Poin →</a>` : ''}
    </div>
    <div class="panel" style="margin-top:12px"><h3>Keamanan login</h3>
      ${
        d.locked
          ? `<p style="margin:0 0 10px;font-size:13px"><span class="pill bad">Terkunci</span> 5× salah password — terbuka otomatis 15 menit.</p>
      <form method="post" action="/dashboard/users/${esc(u.id)}/unlock"><button class="btn ghost" type="submit">Buka kunci sekarang</button></form>`
          : '<p class="mut" style="margin:0;font-size:13px">Tidak terkunci. Lupa password? Pengguna bisa reset sendiri lewat OTP email di aplikasi.</p>'
      }
    </div>
    ${
      u.email?.endsWith('@sirkopos.invalid')
        ? '<div class="panel" style="margin-top:12px"><h3>Akun dihapus</h3><p class="mut" style="margin:0;font-size:13px">Akun ini sudah dihapus atas permintaan pemiliknya.</p></div>'
        : `<form class="panel" style="margin-top:12px;border-color:var(--bad-line)" method="post" action="/dashboard/users/${esc(u.id)}/delete" onsubmit="return confirm('Hapus akun & semua data tokonya? Tidak bisa dibatalkan.')">
      <h3 style="color:var(--bad)">Hapus akun &amp; data</h3>
      <p class="mut" style="margin:0 0 10px;font-size:13px">Untuk permintaan di /hapus-akun, setelah pemilik diverifikasi. Data toko dihapus, akun dianonimkan. Catatan PPOB, Poin &amp; pembayaran tetap disimpan (wajib hukum).</p>
      <label for="confirm" style="display:block;font-size:12px;font-weight:700;margin-bottom:6px">Ketik email atau nomor WA akun untuk konfirmasi</label>
      <input id="confirm" name="confirm" required autocomplete="off" style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:8px 10px;font:inherit">
      <button class="btn bad" type="submit" style="margin-top:10px">Hapus akun permanen</button>
    </form>`
    }
  </div>
</div>`;
  return renderLayout({ title: 'Pengguna', active: 'users', body, serverTime });
}
