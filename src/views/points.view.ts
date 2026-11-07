import type { BusinessDetail } from '../services/dashboard.service.js';
import type { LedgerItem, PointsConfig, Topup, PointAccountRow } from '../services/points.service.js';
import { bizUrl, esc, helpers, pagerHtml, renderBusinessShell, renderLayout } from './dashboard.view.js';

/**
 * Halaman admin Poin Sirko: menu "Poin" (konfirmasi top-up, saldo per akun,
 * pengaturan) & tab "Poin" di halaman toko. Saldo milik AKUN PEMILIK.
 */

const rp = (v: number) => esc(helpers.fmtRp(v));
const dt = (v: number | null) => (v ? esc(helpers.fmtDateTime(v)) : '—');
const signed = (v: number) =>
  v > 0 ? `<span style="color:var(--ok)">+${rp(v)}</span>` : `<span style="color:var(--bad)">${rp(v)}</span>`;

const TOPUP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Menunggu', cls: 'warn' },
  paid: { label: 'Dikonfirmasi', cls: 'ok' },
  rejected: { label: 'Ditolak', cls: 'bad' },
  expired: { label: 'Kedaluwarsa', cls: '' },
  cancelled: { label: 'Dibatalkan', cls: '' },
};
const LEDGER_TYPE: Record<string, string> = {
  topup: 'Top-up', purchase: 'Pembelian PPOB', refund: 'Refund', adjustment: 'Koreksi admin',
};
const pill = (s: string) => {
  const x = TOPUP_STATUS[s] ?? { label: s, cls: '' };
  return `<span class="pill ${x.cls}">${x.label}</span>`;
};

const CSS = `<style>
  .pt-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
  .pt-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line);color:var(--tx);background:var(--card);font-size:13px;font-weight:600}
  .pt-tabs a.on{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}
  .tp-list{display:grid;gap:10px}
  .tp{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .tp.pending{border-color:var(--warn-line);box-shadow:inset 3px 0 0 var(--warn)}
  .tp .amt{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .tp .amt small{font-size:12px;font-weight:600;color:var(--mut);margin-left:6px}
  .tp .meta{font-size:12px;color:var(--mut);margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 14px}
  .tp .meta b{color:var(--tx);font-weight:600}
  .tp .acts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;align-items:center}
  .tp .acts input{background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;width:180px}
  .bal{font-size:30px;font-weight:800;letter-spacing:-.02em}
  .adj{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
  .adj input{background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px}
  .adj input[name=amount]{width:150px}
  .adj input[name=note]{flex:1;min-width:200px}
  .stmt{width:100%;min-width:0;border-collapse:collapse}
  .stmt td{padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px}
  .stmt td.v{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .cfg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px;max-width:760px}
  .cfg .full{grid-column:1/-1}
  .qris-prev{display:block;width:180px;max-width:100%;border:1px solid var(--line);border-radius:10px;background:#fff;padding:6px;margin:4px 0}
  .qris-box .chk{display:flex;gap:6px;align-items:center;font-weight:400;font-size:13px}
  .qris-box input[type=file]{font-size:13px}
  @media (max-width:640px){.cfg{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:640px){.tp{grid-template-columns:1fr}.tp .acts{justify-content:flex-start}.cfg{grid-template-columns:1fr}}
</style>`;

function ledgerTable(items: LedgerItem[], showStore = true): string {
  if (!items.length) return '<div class="tablewrap"><div class="empty">Belum ada mutasi Poin.</div></div>';
  return `<div class="tablewrap"><table>
<thead><tr><th>Waktu</th><th>Jenis</th>${showStore ? '<th>Toko</th>' : ''}<th class="num">Jumlah</th><th class="num">Saldo</th><th>Keterangan</th><th>Oleh</th></tr></thead>
<tbody>${items
    .map(
      (l) => `<tr><td class="mut">${dt(l.createdAt)}</td><td>${esc(LEDGER_TYPE[l.type] ?? l.type)}</td>
      ${showStore ? `<td>${l.businessId ? `<a href="/dashboard/businesses/${esc(l.businessId)}?tab=points">${esc(l.businessName ?? '—')}</a>` : '<span class="mut">—</span>'}</td>` : ''}
      <td class="num">${signed(l.amount)}</td><td class="num">${rp(l.balanceAfter)}</td>
      <td>${l.note ? esc(l.note) : '<span class="mut">—</span>'}</td><td class="mut">${esc(l.createdBy)}</td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}

function topupCard(t: Topup, back: string): string {
  const actionable = t.status === 'pending' || t.status === 'expired';
  return `<div class="tp ${t.status === 'pending' ? 'pending' : ''}">
  <div>
    <div class="amt">${rp(t.transferAmount)}<small>kode unik ${t.uniqueCode} · Poin dikreditkan ${rp(t.transferAmount)}</small></div>
    <div class="meta">
      ${pill(t.status)}
      <span>Toko: ${t.businessId ? `<a href="/dashboard/businesses/${esc(t.businessId)}?tab=points"><b>${esc(t.businessName ?? '—')}</b></a>` : '—'}</span>
      ${t.ownerEmail ? `<span>Akun: <b>${esc(t.ownerEmail)}</b></span>` : ''}
      <span>Diajukan ${dt(t.createdAt)}</span>
      ${t.status === 'pending' ? `<span>Batas ${dt(t.expiresAt)}</span>` : ''}
      ${t.confirmedBy ? `<span>Oleh ${esc(t.confirmedBy)} ${t.paidAt ? '· ' + dt(t.paidAt) : ''}</span>` : ''}
      ${t.adminNote ? `<span>Catatan: ${esc(t.adminNote)}</span>` : ''}
    </div>
  </div>
  ${
    actionable
      ? `<div class="acts">
    <form method="post" action="/dashboard/points/topups/${esc(t.id)}/confirm" onsubmit="return confirm('Dana ${esc(helpers.fmtRp(t.transferAmount))} sudah MASUK ke rekening? Poin akan dikreditkan.')">
      <input type="hidden" name="back" value="${esc(back)}"><button class="btn ok" type="submit">✓ Dana masuk — konfirmasi</button>
    </form>
    <form method="post" action="/dashboard/points/topups/${esc(t.id)}/reject" onsubmit="return confirm('Tolak top-up ini?')" style="display:flex;gap:6px">
      <input type="hidden" name="back" value="${esc(back)}"><input name="note" placeholder="Alasan tolak (opsional)" maxlength="200">
      <button class="btn bad" type="submit">Tolak</button>
    </form>
  </div>`
      : '<div></div>'
  }
</div>`;
}

// ── Menu Poin ────────────────────────────────────────────────────────────────

export interface PointsPageData {
  tab: 'topups' | 'accounts' | 'settings';
  serverTime: number;
  topups?: { items: Topup[]; total: number; page: number; pages: number; counts: Record<string, number>; status: string };
  accounts?: { items: PointAccountRow[]; total: number; page: number; pages: number; q: string; totalBalance: number };
  config?: PointsConfig;
  configError?: string | null;
}

export function renderPointsPage(d: PointsPageData): string {
  const tabs = `<div class="pt-tabs">
  <a class="${d.tab === 'topups' ? 'on' : ''}" href="/dashboard/points?tab=topups">Top-up</a>
  <a class="${d.tab === 'accounts' ? 'on' : ''}" href="/dashboard/points?tab=accounts">Saldo akun</a>
  <a class="${d.tab === 'settings' ? 'on' : ''}" href="/dashboard/points?tab=settings">Pengaturan</a>
</div>`;
  let main = '';

  if (d.tab === 'topups' && d.topups) {
    const t = d.topups;
    const self = `/dashboard/points?tab=topups&status=${encodeURIComponent(t.status)}${t.page > 1 ? `&page=${t.page}` : ''}`;
    const sub = ['pending', 'paid', 'rejected', 'expired', 'cancelled', 'semua']
      .map(
        (s) =>
          `<a class="${t.status === s ? 'on' : ''}" href="/dashboard/points?tab=topups&status=${s}">${s === 'semua' ? 'Semua' : TOPUP_STATUS[s]!.label} (${helpers.fmtNum(t.counts[s] ?? 0)})</a>`,
      )
      .join('');
    main = `<p class="mut" style="margin:-4px 0 12px;font-size:13px">Cocokkan <b>nominal transfer persis</b> (termasuk 3 digit kode unik) dengan mutasi rekening, lalu konfirmasi. Konfirmasi hanya sekali berlaku.</p>
<div class="subnav">${sub}</div>
${t.items.length ? `<div class="tp-list">${t.items.map((x) => topupCard(x, self)).join('')}</div>` : '<div class="tablewrap"><div class="empty">Tidak ada top-up pada status ini.</div></div>'}
${pagerHtml(t.page, t.pages, t.total, (p) => `/dashboard/points?tab=topups&amp;status=${encodeURIComponent(t.status)}&amp;page=${p}`)}`;
  }

  if (d.tab === 'accounts' && d.accounts) {
    const a = d.accounts;
    main = `<div class="grid" style="margin-bottom:14px">
  <div class="kpi"><div class="n">${rp(a.totalBalance)}</div><div class="l">Total Poin beredar (kewajiban ke pengguna)</div></div>
  <div class="kpi"><div class="n">${helpers.fmtNum(a.total)}</div><div class="l">Akun pemilik</div></div>
</div>
<form class="search" method="get" action="/dashboard/points">
  <input type="hidden" name="tab" value="accounts">
  <div class="search-box"><input type="search" name="q" value="${esc(a.q)}" placeholder="Cari email / no HP / nama toko / pemilik…"></div>
  <button class="btn primary" type="submit">Cari</button>
</form>
<div class="tablewrap"><table>
<thead><tr><th>Pemilik</th><th>Login</th><th>Toko</th><th class="num">Saldo Poin</th><th>Aktivitas terakhir</th></tr></thead>
<tbody>${
      a.items
        .map(
          (r) => `<tr><td><b>${esc(r.ownerName ?? '—')}</b></td><td class="mut">${esc(r.email ?? r.phone ?? '—')}</td>
        <td>${r.stores.map((s) => `<a href="/dashboard/businesses/${esc(s.id)}?tab=points">${esc(s.name)}</a>`).join(', ') || '—'}</td>
        <td class="num"><b>${rp(r.balance)}</b></td><td class="mut">${dt(r.lastActivityAt)}</td></tr>`,
        )
        .join('') || '<tr><td colspan="5" class="empty">Tidak ada akun.</td></tr>'
    }</tbody></table></div>
${pagerHtml(a.page, a.pages, a.total, (p) => `/dashboard/points?tab=accounts&amp;q=${encodeURIComponent(a.q)}&amp;page=${p}`)}`;
  }

  if (d.tab === 'settings' && d.config) {
    const c = d.config;
    const f = (name: keyof PointsConfig, label: string, type = 'text', hint = '', full = false) =>
      `<div class="f ${full ? 'full' : ''}"><label for="${name}">${label}</label><input type="${type}" id="${name}" name="${name}" value="${esc(c[name])}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    main = `${d.configError ? `<div class="flash err" role="alert">${esc(d.configError)}</div>` : ''}
<form method="post" action="/dashboard/points/settings" class="panel" enctype="multipart/form-data">
  <h3>Rekening tujuan top-up (tampil di aplikasi)</h3>
  <div class="cfg">
    ${f('bankName', 'Bank', 'text', 'mis. BCA')}
    ${f('accountNo', 'Nomor rekening')}
    ${f('accountName', 'Atas nama', 'text', '', true)}
    <div class="f full qris-box">
      <label>QRIS statis (opsional)</label>
      ${c.qrisImageUrl ? `<a href="${esc(c.qrisImageUrl)}" target="_blank" rel="noopener"><img src="${esc(c.qrisImageUrl)}" alt="QRIS top-up Poin" class="qris-prev"></a>
      <label class="chk"><input type="checkbox" name="qrisRemove"> Hapus QRIS</label>` : '<div class="hint">Belum ada gambar QRIS.</div>'}
      <label for="qrisFile" style="margin-top:8px">Unggah gambar QRIS baru</label>
      <input type="file" id="qrisFile" name="qrisFile" accept="image/png,image/jpeg,image/webp">
      <div class="hint">PNG/JPG/WebP, maks 2 MB. Mengganti gambar lama.</div>
      <label for="qrisImageUrl" style="margin-top:8px">atau URL gambar QRIS (HTTPS)</label>
      <input type="url" id="qrisImageUrl" name="qrisImageUrl" value="${esc(c.qrisImageUrl)}">
    </div>
    ${f('note', 'Catatan instruksi', 'text', '', true)}
  </div>
  <h3 style="margin-top:18px">Batas</h3>
  <div class="cfg">
    ${f('minTopup', 'Minimal top-up (Rp)', 'number')}
    ${f('maxTopup', 'Maksimal top-up (Rp)', 'number')}
    ${f('expiryHours', 'Batas waktu transfer (jam)', 'number')}
    ${f('maxPendingTopups', 'Maks top-up menunggu per akun', 'number')}
  </div>
  <div class="form-actions"><button class="btn primary" type="submit">Simpan pengaturan</button></div>
</form>
<p class="mut" style="font-size:12px;margin-top:12px">Poin hanya untuk membeli PPOB Sirko: tidak bisa ditarik tunai dan tidak bisa dipindah ke akun lain.</p>`;
  }

  const body = `${CSS}<div class="titlebar"><h1>Poin Sirko</h1></div>${tabs}${main}`;
  return renderLayout({ title: 'Poin', active: 'points', body, serverTime: d.serverTime });
}

// ── Tab Poin di halaman toko ─────────────────────────────────────────────────

export function renderBusinessPoints(
  d: BusinessDetail,
  p: { accountId: string; balance: number; ledger: LedgerItem[]; topups: Topup[]; stores: Array<{ id: string; name: string }> } | null,
): string {
  const id = String(d.business.id);
  const self = bizUrl(id, { tab: 'points' });
  const main = !p
    ? `${CSS}<div class="h2row"><h2>Poin Sirko</h2></div><div class="tablewrap"><div class="empty">Toko ini belum punya akun pemilik (login cloud), jadi belum bisa memakai Poin Sirko.</div></div>`
    : `${CSS}
<div class="h2row"><h2>Poin Sirko</h2></div>
<div class="two" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">
  <div class="panel">
    <h3>Saldo akun pemilik</h3>
    <div class="bal">${rp(p.balance)}</div>
    <div class="mut" style="font-size:12px;margin-top:4px">Dipakai bersama ${p.stores.length > 1 ? `${p.stores.length} toko: ${p.stores.map((s) => esc(s.name)).join(', ')}` : 'oleh toko ini'}.</div>
    <form class="adj" method="post" action="/dashboard/points/accounts/${esc(p.accountId)}/adjust" onsubmit="return confirm('Simpan koreksi saldo? Tercatat permanen di riwayat.')">
      <input type="hidden" name="back" value="${esc(self)}"><input type="hidden" name="businessId" value="${esc(id)}">
      <input name="amount" type="number" step="1" required placeholder="±Poin, mis. -5000" aria-label="Jumlah koreksi">
      <input name="note" required maxlength="200" placeholder="Alasan koreksi (wajib)" aria-label="Alasan koreksi">
      <button class="btn ghost" type="submit">Koreksi</button>
    </form>
  </div>
  <div class="panel">
    <h3>Top-up terakhir</h3>
    ${
      p.topups.length
        ? `<table class="stmt">${p.topups
            .slice(0, 6)
            .map((t) => `<tr><td>${dt(t.createdAt)} ${pill(t.status)}</td><td class="v">${rp(t.transferAmount)}</td></tr>`)
            .join('')}</table>
           ${p.topups.some((t) => t.status === 'pending') ? '<a class="btn-link" style="margin-top:10px" href="/dashboard/points?tab=topups">Konfirmasi di menu Poin →</a>' : ''}`
        : '<div class="mut">Belum ada top-up.</div>'
    }
  </div>
</div>
<h2>Riwayat mutasi</h2>
${ledgerTable(p.ledger)}`;
  return renderBusinessShell(d, 'points', main, `Poin · ${String(d.business.name ?? 'Toko')}`);
}
