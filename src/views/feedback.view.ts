import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackPage } from '../services/feedback.service.js';
import { esc, helpers, pagerHtml, renderLayout } from './dashboard.view.js';

/** Halaman Saran (/dashboard/feedback): daftar saran pengguna + tindak lanjut admin. */

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  baru: { label: 'Baru', cls: 'warn' },
  dibaca: { label: 'Dibaca', cls: '' },
  diproses: { label: 'Diproses', cls: 'warn' },
  selesai: { label: 'Selesai', cls: 'ok' },
  ditolak: { label: 'Ditolak', cls: 'bad' },
};
const CATEGORY_LABEL: Record<string, string> = {
  saran: '💡 Saran', masalah: '🐞 Masalah', pertanyaan: '❓ Pertanyaan', lainnya: 'Lainnya',
};

const CSS = `<style>
  .fb-list{display:grid;gap:12px}
  .fb{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .fb.is-new{border-color:var(--warn-line);box-shadow:inset 3px 0 0 var(--warn)}
  .fb-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
  .fb-top .when{margin-left:auto;color:var(--mut);font-size:12px}
  .fb-msg{white-space:pre-wrap;font-size:15px;line-height:1.55;word-break:break-word}
  .fb-meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-size:12px;color:var(--mut)}
  .fb-meta b{color:var(--tx);font-weight:600}
  .fb-reply{margin-top:10px;font-size:13px;background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
  .fb-form{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}
  .fb-form select,.fb-form textarea{background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}
  .fb-form textarea{flex:1;min-width:200px;min-height:38px;resize:vertical}
</style>`;

function url(p: FeedbackPage, over: Record<string, string | number | undefined>, business?: string) {
  const q = new URLSearchParams();
  const v = { status: p.status, category: p.category, business, ...over };
  for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== '' && !(k === 'page' && String(x) === '1')) q.set(k, String(x));
  const s = q.toString();
  return '/dashboard/feedback' + (s ? `?${s}` : '');
}

export function renderFeedback(p: FeedbackPage, business?: { id: string; name: string } | null): string {
  const bid = business?.id;
  const statusTabs = ['semua', ...FEEDBACK_STATUSES]
    .map(
      (s) =>
        `<a class="${p.status === s ? 'on' : ''}" href="${esc(url(p, { status: s, page: undefined }, bid))}">${s === 'semua' ? 'Semua' : STATUS_LABEL[s]!.label} (${helpers.fmtNum(p.counts[s] ?? 0)})</a>`,
    )
    .join('');
  const catChips = ['', ...FEEDBACK_CATEGORIES]
    .map(
      (c) =>
        `<a class="chip ${(p.category ?? '') === c ? 'on' : ''}" href="${esc(url(p, { category: c || undefined, page: undefined }, bid))}">${c ? CATEGORY_LABEL[c] : 'Semua jenis'}</a>`,
    )
    .join('');
  const self = url(p, { page: p.page }, bid);

  const cards = p.items
    .map((f) => {
      const st = STATUS_LABEL[f.status] ?? { label: f.status, cls: '' };
      const options = FEEDBACK_STATUSES.map(
        (s) => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${STATUS_LABEL[s]!.label}</option>`,
      ).join('');
      return `<div class="fb ${f.status === 'baru' ? 'is-new' : ''}">
  <div class="fb-top">
    <span class="pill">${esc(CATEGORY_LABEL[f.category] ?? f.category)}</span>
    <span class="pill ${st.cls}">${esc(st.label)}</span>
    <span class="when">${esc(helpers.fmtDateTime(f.createdAt))}</span>
  </div>
  <div class="fb-msg">${esc(f.message)}</div>
  <div class="fb-meta">
    <span>Toko: <a href="/dashboard/businesses/${esc(f.businessId)}"><b>${esc(f.businessName ?? '—')}</b></a></span>
    <span>Pengirim: <b>${esc(f.userName ?? '—')}</b></span>
    ${f.contact ? `<span>Kontak: <b>${esc(f.contact)}</b></span>` : ''}
    ${f.appVersion || f.platform ? `<span>App: ${esc([f.appVersion, f.platform].filter(Boolean).join(' · '))}</span>` : ''}
  </div>
  ${f.adminNote ? `<div class="fb-reply"><b>Catatan admin</b> <span class="mut">· ${esc(f.handledBy ?? '')} · ${esc(helpers.fmtDateTime(f.handledAt ?? 0))}</span><br>${esc(f.adminNote)}</div>` : ''}
  <form class="fb-form" method="post" action="/dashboard/feedback/${esc(f.id)}">
    <input type="hidden" name="back" value="${esc(self)}">
    <label class="sr" for="st-${esc(f.id)}">Status</label>
    <select id="st-${esc(f.id)}" name="status">${options}</select>
    <label class="sr" for="nt-${esc(f.id)}">Catatan admin</label>
    <textarea id="nt-${esc(f.id)}" name="adminNote" maxlength="1000" placeholder="Catatan / balasan untuk pengirim (opsional)">${esc(f.adminNote ?? '')}</textarea>
    <button class="btn primary" type="submit">Simpan</button>
  </form>
</div>`;
    })
    .join('');

  const body = `${CSS}
<div class="titlebar"><h1>Saran Pengguna${business ? ` · ${esc(business.name)}` : ''}</h1>${business ? `<a class="btn-link" href="${esc(url(p, { page: undefined }))}">✕ Semua toko</a>` : ''}</div>
<p class="mut" style="margin:-6px 0 14px;font-size:13px">Masukan yang dikirim pengguna dari aplikasi Sirko. Ubah status untuk menandai tindak lanjut; catatan admin bisa ditampilkan ke pengirim di aplikasi.</p>
<div class="subnav">${statusTabs}</div>
<div class="chips" style="margin-bottom:14px">${catChips}</div>
${p.items.length ? `<div class="fb-list">${cards}</div>` : '<div class="tablewrap"><div class="empty">Belum ada saran pada filter ini.</div></div>'}
${pagerHtml(p.page, p.pages, p.total, (pg) => esc(url(p, { page: pg }, bid)))}`;

  return renderLayout({ title: 'Saran', active: 'feedback', body, serverTime: p.serverTime });
}
