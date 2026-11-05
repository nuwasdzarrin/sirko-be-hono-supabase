import type { PriceRow, PaymentConfig } from '../services/subscription.service.js';
import type {
  AccountDetail,
  AccountsPage,
  PaymentItem,
  PaymentsPage,
  PaymentStatus,
} from '../services/subscription-admin.service.js';
import type { EffectivePlan } from '../services/plan.service.js';
import { esc, helpers, pagerHtml, renderLayout } from './dashboard.view.js';

/**
 * Halaman admin Langganan Juragan (/dashboard/subscriptions). File sendiri agar
 * tak menabrak file panas dashboard (brief §5.3). Memakai layout & CSS dashboard.
 */

export type SubTab = 'pending' | 'history' | 'accounts' | 'settings';

const rp = (v: number) => esc(helpers.fmtRp(v));
const dt = (v: number | null) => (v ? esc(helpers.fmtDateTime(v)) : '—');
const PERIOD: Record<'monthly' | 'yearly', string> & Record<string, string | undefined> = { monthly: 'Bulanan', yearly: 'Tahunan' };
const STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  pending: { label: 'Menunggu', cls: 'warn' },
  confirmed: { label: 'Dikonfirmasi', cls: 'ok' },
  rejected: { label: 'Ditolak', cls: 'bad' },
  expired: { label: 'Kedaluwarsa', cls: '' },
};
const pill = (s: PaymentStatus) => `<span class="pill ${STATUS[s].cls}">${STATUS[s].label}</span>`;

const CSS = `<style>
  .pay-list{display:grid;gap:12px}
  .pay{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  .pay.old{border-color:var(--warn-line)}
  .pay .amt{font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .pay .amt small{font-size:13px;font-weight:600;color:var(--mut);margin-left:6px}
  .pay .code{display:inline-block;margin-top:4px;font-size:13px}
  .pay .code b{background:var(--acc-soft);color:var(--acc);padding:1px 8px;border-radius:6px;font-variant-numeric:tabular-nums}
  .pay .kv{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-size:13px;color:var(--mut)}
  .pay .kv b{color:var(--tx);font-weight:600}
  .pay .acts{display:flex;flex-direction:column;gap:8px;min-width:240px}
  .pay .acts form{display:flex;gap:6px}
  .pay .acts input[type=text]{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}
  .qris-prev{width:180px;aspect-ratio:1;border:1px solid var(--line);border-radius:10px;background:#fff;object-fit:contain}
  .manual{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:12px}
  .manual form{display:grid;gap:8px}
  .manual select,.manual input[type=text]{background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:8px 10px;font:inherit;font-size:14px}
  @media (max-width:700px){.pay{grid-template-columns:1fr}.pay .acts{min-width:0}}
</style>`;

function tabs(active: SubTab, pendingCount: number): string {
  const t = (key: SubTab, label: string, href: string) =>
    `<a class="${active === key ? 'on' : ''}" href="${href}">${label}</a>`;
  return `<div class="subnav">
    ${t('pending', `Antrian${pendingCount ? ` (${helpers.fmtNum(pendingCount)})` : ''}`, '/dashboard/subscriptions')}
    ${t('history', 'Riwayat pembayaran', '/dashboard/subscriptions/payments')}
    ${t('accounts', 'Akun pelanggan', '/dashboard/subscriptions/accounts')}
    ${t('settings', 'Harga & QRIS', '/dashboard/subscriptions/settings')}
  </div>`;
}

function shell(active: SubTab, pendingCount: number, body: string, title = 'Langganan'): string {
  return renderLayout({
    title,
    active: 'subscriptions',
    body: `${CSS}<div class="titlebar"><h1>Langganan Juragan</h1></div>${tabs(active, pendingCount)}${body}`,
    serverTime: Date.now(),
  });
}

export function planText(p: EffectivePlan): string {
  if (p.name !== 'juragan') return '<span class="pill">Warung (gratis)</span>';
  return `<span class="pill ok">Juragan ${PERIOD[p.period ?? ''] ?? ''}</span> <span class="mut">s/d ${dt(p.expiresAt)}</span>`;
}

const accountLink = (p: PaymentItem) =>
  `<a href="/dashboard/subscriptions/accounts/${esc(p.accountId)}"><b>${esc(p.accountLabel)}</b></a>`;

// ── Antrian ──────────────────────────────────────────────────────────────────

export function renderQueue(pg: PaymentsPage): string {
  const now = Date.now();
  const back = '/dashboard/subscriptions';
  const cards = pg.items
    .map((p) => {
      const old = now - p.createdAt > 6 * 3600_000;
      return `<div class="pay ${old ? 'old' : ''}">
  <div>
    <div class="amt">${rp(p.amount)}<small>${PERIOD[p.period]} · ${rp(p.baseAmount)} + kode</small></div>
    <span class="code">Kode unik <b>${esc(p.uniqueCode)}</b> — cocokkan dengan mutasi QRIS/rekening</span>
    <div class="kv">
      <span>Akun: ${accountLink(p)}</span>
      <span>Toko: ${p.businessId ? `<a href="/dashboard/businesses/${esc(p.businessId)}"><b>${esc(p.businessName ?? '—')}</b></a>` : '—'}</span>
      <span>Diminta: <b>${dt(p.createdAt)}</b></span>
      <span>Batas: <b>${dt(p.expiresAt)}</b></span>
      ${p.proofPath ? `<span><a href="${esc(p.proofPath)}" target="_blank" rel="noopener">📎 Lihat bukti transfer</a></span>` : '<span>Tanpa bukti</span>'}
    </div>
  </div>
  <div class="acts">
    <form method="post" action="/dashboard/subscriptions/payments/${esc(p.id)}/confirm"
      onsubmit="return confirm('Konfirmasi pembayaran ${esc(helpers.fmtRp(p.amount))} dari ${esc(p.accountLabel)}? Paket Juragan langsung aktif.')">
      <input type="hidden" name="back" value="${back}">
      <button class="btn ok" type="submit" style="width:100%;justify-content:center">✓ Konfirmasi — dana sudah masuk</button>
    </form>
    <form method="post" action="/dashboard/subscriptions/payments/${esc(p.id)}/reject">
      <input type="hidden" name="back" value="${back}">
      <label class="sr" for="rj-${esc(p.id)}">Alasan tolak</label>
      <input type="text" id="rj-${esc(p.id)}" name="note" required maxlength="300" placeholder="Alasan tolak (tampil ke pengguna)">
      <button class="btn bad" type="submit">Tolak</button>
    </form>
  </div>
</div>`;
    })
    .join('');
  const body = `<p class="mut" style="margin:-6px 0 14px;font-size:13px">Cek mutasi QRIS/rekening: nominal harus <b>persis sama</b> (termasuk kode unik). Konfirmasi hanya bila dana sudah masuk. Permintaan kedaluwarsa setelah 24 jam (masih bisa dikonfirmasi dari Riwayat bila dana masuk terlambat).</p>
${pg.items.length ? `<div class="pay-list">${cards}</div>` : '<div class="tablewrap"><div class="empty">Tidak ada pembayaran yang menunggu konfirmasi. 🎉</div></div>'}
${pagerHtml(pg.page, pg.pages, pg.total, (n) => `/dashboard/subscriptions?page=${n}`)}`;
  return shell('pending', pg.counts.pending, body);
}

// ── Riwayat pembayaran ───────────────────────────────────────────────────────

function paymentRows(items: PaymentItem[], back: string, withAccount = true): string {
  return items
    .map((p) => {
      const canAct = p.status === 'pending' || p.status === 'expired';
      const acts = canAct
        ? `<form method="post" action="/dashboard/subscriptions/payments/${esc(p.id)}/confirm" style="display:inline"
             onsubmit="return confirm('Konfirmasi pembayaran ${esc(helpers.fmtRp(p.amount))}? Paket Juragan langsung aktif.')">
             <input type="hidden" name="back" value="${esc(back)}"><button class="mini" type="submit">✓ Konfirmasi</button></form>`
        : '';
      const review = p.reviewedBy ? `${esc(p.reviewedBy)} · ${dt(p.reviewedAt)}` : '—';
      return `<tr>
  <td class="num"><b>${rp(p.amount)}</b><br><span class="mut" style="font-size:11px">kode ${esc(p.uniqueCode)}</span></td>
  <td>${PERIOD[p.period]}</td>
  ${withAccount ? `<td>${accountLink(p)}<br><span class="mut" style="font-size:12px">${esc(p.businessName ?? '—')}</span></td>` : ''}
  <td>${pill(p.status)}${p.note ? `<br><span class="mut" style="font-size:12px">${esc(p.note)}</span>` : ''}</td>
  <td class="mut">${dt(p.createdAt)}</td>
  <td class="mut">${review}</td>
  <td>${p.proofPath ? `<a href="${esc(p.proofPath)}" target="_blank" rel="noopener">bukti</a>` : '—'}</td>
  <td class="acts-col">${acts}</td>
</tr>`;
    })
    .join('');
}

export function renderPayments(pg: PaymentsPage): string {
  const url = (o: { status?: string; page?: number }) => {
    const q = new URLSearchParams();
    const status = o.status ?? pg.status;
    if (status !== 'all') q.set('status', status);
    if (pg.q) q.set('q', pg.q);
    if (o.page && o.page > 1) q.set('page', String(o.page));
    const s = q.toString();
    return '/dashboard/subscriptions/payments' + (s ? `?${s}` : '');
  };
  const total = Object.values(pg.counts).reduce((a, b) => a + b, 0);
  const chips = (['all', 'pending', 'confirmed', 'rejected', 'expired'] as const)
    .map((s) => `<a class="chip ${pg.status === s ? 'on' : ''}" href="${esc(url({ status: s }))}">${s === 'all' ? 'Semua' : STATUS[s].label} <span class="c">${helpers.fmtNum(s === 'all' ? total : pg.counts[s])}</span></a>`)
    .join('');
  const self = url({ page: pg.page });
  const body = `<form class="search" method="get" action="/dashboard/subscriptions/payments">
  ${pg.status !== 'all' ? `<input type="hidden" name="status" value="${esc(pg.status)}">` : ''}
  <div class="search-box"><input type="search" name="q" value="${esc(pg.q)}" placeholder="Cari email / telepon / nama toko / nominal…"></div>
  <button class="btn primary" type="submit">Cari</button>
</form>
<div class="chips" style="margin-bottom:12px">${chips}</div>
<div class="tablewrap">${
    pg.items.length
      ? `<table><thead><tr><th class="num">Nominal</th><th>Periode</th><th>Akun / toko</th><th>Status</th><th>Diminta</th><th>Diproses</th><th>Bukti</th><th></th></tr></thead><tbody>${paymentRows(pg.items, self)}</tbody></table>`
      : '<div class="empty">Belum ada pembayaran pada filter ini.</div>'
  }</div>
${pagerHtml(pg.page, pg.pages, pg.total, (n) => esc(url({ page: n })))}`;
  return shell('history', pg.counts.pending, body, 'Riwayat pembayaran');
}

// ── Akun ─────────────────────────────────────────────────────────────────────

export function renderAccounts(pg: AccountsPage, pendingCount: number): string {
  const rows = pg.items
    .map(
      (a) => `<tr class="rowlink" onclick="location.href='/dashboard/subscriptions/accounts/${esc(a.id)}'">
  <td><a href="/dashboard/subscriptions/accounts/${esc(a.id)}" style="color:var(--tx);font-weight:600">${esc(a.label)}</a></td>
  <td>${planText(a.plan)}</td>
  <td class="num">${helpers.fmtNum(a.ownedStores)}</td>
  <td class="mut">${dt(a.lastPaymentAt)}</td>
  <td class="mut">${esc(helpers.fmtDate(a.createdAt))}</td>
</tr>`,
    )
    .join('');
  const body = `<form class="search" method="get" action="/dashboard/subscriptions/accounts">
  <div class="search-box"><input type="search" name="q" value="${esc(pg.q)}" placeholder="Cari email / telepon / nama toko…"></div>
  <button class="btn primary" type="submit">Cari</button>
</form>
<div class="tablewrap">${
    pg.items.length
      ? `<table><thead><tr><th>Akun pemilik</th><th>Paket</th><th class="num">Toko</th><th>Bayar terakhir</th><th>Terdaftar</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="empty">Tidak ada akun yang cocok.</div>'
  }</div>
${pagerHtml(pg.page, pg.pages, pg.total, (n) => `/dashboard/subscriptions/accounts?page=${n}${pg.q ? `&q=${encodeURIComponent(pg.q)}` : ''}`)}`;
  return shell('accounts', pendingCount, body, 'Akun pelanggan');
}

export function renderAccountDetail(d: AccountDetail, pendingCount: number): string {
  const back = `/dashboard/subscriptions/accounts/${d.id}`;
  const now = Date.now();
  const subRows = d.subscriptions
    .map((s) => {
      const state = s.cancelledAt
        ? `<span class="pill bad">Dipotong</span><br><span class="mut" style="font-size:11px">${esc(s.cancelledBy ?? '')} · ${dt(s.cancelledAt)}</span>`
        : s.endsAt <= now
          ? '<span class="pill">Selesai</span>'
          : s.startsAt > now
            ? '<span class="pill warn">Antre (perpanjangan)</span>'
            : '<span class="pill ok">Aktif</span>';
      return `<tr><td>${PERIOD[s.period]}</td><td>${dt(s.startsAt)}</td><td>${dt(s.endsAt)}</td><td>${state}</td>
  <td class="mut">${s.paymentId ? 'pembayaran' : esc(s.createdBy ?? '—')}</td><td class="mut">${esc(s.note ?? '')}</td></tr>`;
    })
    .join('');
  const stores = d.stores
    .map((s) => `<a class="chip" href="/dashboard/businesses/${esc(s.id)}">${esc(s.name)} <span class="c">${esc(s.role)}</span></a>`)
    .join('');
  const owned = d.stores.filter((s) => s.role === 'owner').length;
  const body = `<a class="crumb" href="/dashboard/subscriptions/accounts">← Semua akun</a>
<div class="panel">
  <div class="biz-head">
    <div><b>Akun</b>${esc(d.email ?? d.phone ?? '—')}</div>
    <div><b>Telepon</b>${esc(d.phone ?? '—')}</div>
    <div><b>Terdaftar</b>${dt(d.createdAt)}</div>
    <div><b>Paket sekarang</b>${planText(d.plan)}</div>
    <div><b>Toko dimiliki</b>${owned} / ${d.plan.maxStores}</div>
  </div>
  <div class="chips" style="margin-top:12px">${stores || '<span class="mut">Tidak ada toko</span>'}</div>
</div>
<div class="manual">
  <div class="panel"><h3>Perpanjang manual</h3>
    <form method="post" action="${back}/extend" onsubmit="return confirm('Tambah masa langganan untuk akun ini tanpa pembayaran?')">
      <select name="period" aria-label="Periode"><option value="monthly">+1 bulan</option><option value="yearly">+1 tahun</option></select>
      <input type="text" name="note" required maxlength="300" placeholder="Alasan (wajib, mis. kompensasi gangguan)">
      <button class="btn primary" type="submit">Perpanjang</button>
    </form>
    <p class="mut" style="font-size:12px;margin:8px 0 0">Menyambung dari akhir langganan aktif. Tercatat atas nama Anda.</p>
  </div>
  <div class="panel"><h3>Potong langganan</h3>
    <form method="post" action="${back}/cancel" onsubmit="return confirm('Hentikan langganan aktif sekarang? Paket kembali ke Warung. Data toko tidak dihapus.')">
      <input type="text" name="note" required maxlength="300" placeholder="Alasan (wajib, mis. pembayaran dibatalkan bank)">
      <button class="btn bad" type="submit" ${d.plan.name === 'juragan' ? '' : 'disabled'}>Potong sekarang</button>
    </form>
    <p class="mut" style="font-size:12px;margin:8px 0 0">Langganan aktif & antrean ditandai dipotong (riwayat tetap ada). Pencatatan & sync toko tidak diblok.</p>
  </div>
</div>
<h2>Riwayat langganan</h2>
<div class="tablewrap">${
    subRows
      ? `<table><thead><tr><th>Periode</th><th>Mulai</th><th>Berakhir</th><th>Status</th><th>Sumber</th><th>Catatan</th></tr></thead><tbody>${subRows}</tbody></table>`
      : '<div class="empty">Belum pernah berlangganan.</div>'
  }</div>
<h2>Pembayaran</h2>
<div class="tablewrap">${
    d.payments.length
      ? `<table><thead><tr><th class="num">Nominal</th><th>Periode</th><th>Status</th><th>Diminta</th><th>Diproses</th><th>Bukti</th><th></th></tr></thead><tbody>${paymentRows(d.payments, back, false)}</tbody></table>`
      : '<div class="empty">Belum ada pembayaran.</div>'
  }</div>`;
  return shell('accounts', pendingCount, body, d.email ?? d.phone ?? 'Akun');
}

// ── Harga & QRIS ─────────────────────────────────────────────────────────────

export function renderSettings(prices: PriceRow[], payment: PaymentConfig, pendingCount: number): string {
  const price = (period: 'monthly' | 'yearly') => prices.find((p) => p.period === period);
  const priceForm = (period: 'monthly' | 'yearly') => {
    const p = price(period);
    return `<form method="post" action="/dashboard/subscriptions/settings/price" class="fields" style="margin-bottom:12px">
  <input type="hidden" name="period" value="${period}">
  <div class="f"><label>Harga ${PERIOD[period].toLowerCase()} (Rp)</label><input type="number" name="amount" min="1" step="1" required value="${p ? p.amount : ''}"></div>
  <div class="f"><label>Maks toko</label><input type="number" name="maxStores" min="1" step="1" required value="${p ? p.maxStores : 3}"></div>
  <div class="f full"><button class="btn primary" type="submit"
    onclick="return confirm('Ubah harga ${PERIOD[period].toLowerCase()}? Berlaku untuk checkout berikutnya.')">Simpan harga ${PERIOD[period].toLowerCase()}</button></div>
</form>`;
  };
  const v = (k: keyof PaymentConfig) => esc(payment[k] ?? '');
  const body = `<div class="form-grid">
  <div class="panel">
    <h3>Harga paket Juragan</h3>
    ${priceForm('monthly')}
    ${priceForm('yearly')}
    <p class="mut" style="font-size:12px;margin:0">Perubahan harga tidak memengaruhi permintaan bayar yang sudah dibuat.</p>
  </div>
  <div class="panel">
    <h3>Pembayaran (QRIS statis)</h3>
    ${payment.qrisUrl ? `<img class="qris-prev" src="${v('qrisUrl')}" alt="QRIS saat ini">` : '<div class="notice"><b>QRIS belum diatur</b> — pengguna hanya melihat data rekening.</div>'}
    <form method="post" action="/dashboard/subscriptions/settings/payment" enctype="multipart/form-data" class="fields" style="margin-top:12px">
      <div class="f full"><label for="qf">Unggah gambar QRIS baru</label><input type="file" id="qf" name="qrisFile" accept="image/png,image/jpeg,image/webp"><div class="hint">PNG/JPG/WebP, maks 2 MB.</div></div>
      <div class="f full"><label for="qu">atau URL gambar QRIS (HTTPS)</label><input type="url" id="qu" name="qrisUrl" value="${v('qrisUrl')}" placeholder="https://…/qris.png"></div>
      <div class="f"><label for="bn">Bank</label><input type="text" id="bn" name="bankName" maxlength="60" value="${v('bankName')}"></div>
      <div class="f"><label for="an">No. rekening</label><input type="text" id="an" name="accountNo" maxlength="40" value="${v('accountNo')}"></div>
      <div class="f full"><label for="am">Atas nama</label><input type="text" id="am" name="accountName" maxlength="120" value="${v('accountName')}"></div>
      <div class="f full"><label for="nt">Catatan untuk pengguna</label><textarea id="nt" name="note" maxlength="500">${v('note')}</textarea></div>
      <div class="f full"><button class="btn primary" type="submit">Simpan data pembayaran</button></div>
    </form>
  </div>
</div>`;
  return shell('settings', pendingCount, body, 'Harga & QRIS');
}
