import { esc, helpers, renderLayout } from './dashboard.view.js';
import { isLive, pathOf, type Kind, type SitePost } from '../services/site.service.js';
import { siteUrl, SITE_CSS } from '../site/layout.js';

/**
 * Dashboard → Website: daftar & editor artikel/halaman sirkopos.com.
 * Editor: toolbar Markdown, unggah gambar (dikompres di browser), pratinjau langsung,
 * cuplikan Google, daftar periksa SEO (kata kunci fokus), jadwal terbit (WIB).
 */

const dt = (v: number | null | undefined) => (v ? esc(helpers.fmtDateTime(v)) : '—');
const KIND_LABEL: Record<Kind, { one: string; many: string }> = {
  post: { one: 'Artikel', many: 'Artikel blog' },
  page: { one: 'Halaman', many: 'Halaman' },
};
export const SITE_CATEGORIES = ['Panduan Warung', 'Keuangan Toko', 'Pulsa & PPOB', 'Tips Sirko'];

function statusPill(p: SitePost): string {
  if (p.status === 'draft') return '<span class="pill">Draf</span>';
  if (!isLive(p)) return `<span class="pill warn">Terjadwal ${dt(p.publishedAt)}</span>`;
  return '<span class="pill ok">Terbit</span>';
}

const CSS = `<style>
  .site-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
  .site-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line);color:var(--tx);background:var(--card);font-size:13px;font-weight:600}
  .site-tabs a.on{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}
  .ed{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}
  .ed>*{min-width:0}
  .ed .panel+.panel{margin-top:12px}
  .ed label{display:block;font-size:12px;font-weight:700;margin:12px 0 6px}
  .ed label:first-child{margin-top:0}
  .ed input[type=text],.ed input[type=url],.ed input[type=datetime-local],.ed select,.ed textarea{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:9px 11px;font:inherit;font-size:14px}
  .ed input:focus,.ed textarea:focus,.ed select:focus{outline:0;border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
  .ed .title-in{font-size:20px;font-weight:700}
  .ed .cnt{float:right;font-weight:600;color:var(--mut)}
  .ed .cnt.ok{color:var(--ok)} .ed .cnt.bad{color:var(--bad)} .ed .cnt.warn{color:var(--warn)}
  .ed .hint{font-size:12px;color:var(--mut);margin-top:4px}
  .md-bar{display:flex;flex-wrap:wrap;gap:4px;border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;padding:6px;background:var(--sunk)}
  .md-bar button{border:1px solid var(--line);background:var(--card);color:var(--tx);border-radius:7px;min-width:34px;height:32px;padding:0 9px;cursor:pointer;font:inherit;font-size:13px;font-weight:700}
  .md-bar button:hover{border-color:var(--acc)}
  .md-bar .sep{width:1px;background:var(--line);margin:4px 4px}
  .md-bar .sp{flex:1}
  #body{min-height:520px;border-radius:0 0 10px 10px;font-family:ui-monospace,Consolas,monospace;font-size:14px;line-height:1.6;resize:vertical}
  .mode button.on{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}
  #pv{display:none;width:100%;border:1px solid var(--line);border-radius:0 0 10px 10px;background:#FFFBF4;height:75vh;min-height:520px}
  .restore{display:none;background:var(--sunk);border:1px solid var(--warn-line);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:13px;align-items:center;gap:10px;flex-wrap:wrap}
  .serp{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg);font-family:arial,sans-serif}
  .serp .u{font-size:12px;color:var(--mut);word-break:break-all}
  .serp .t{color:#1a0dab;font-size:18px;line-height:1.3;margin:4px 0}
  [data-theme="dark"] .serp .t{color:#8ab4f8}
  .serp .d{font-size:13px;color:var(--mut);line-height:1.5}
  .checks{list-style:none;padding:0;margin:0;display:grid;gap:6px;font-size:13px}
  .checks li{display:flex;gap:8px;align-items:flex-start}
  .checks li::before{content:"●";font-size:11px;margin-top:3px}
  .checks li.ok::before{color:var(--ok)} .checks li.warn::before{color:var(--warn)} .checks li.bad::before{color:var(--bad)}
  .score{font-size:30px;font-weight:800}
  .cover-box{border:1px dashed var(--line);border-radius:10px;aspect-ratio:1200/630;display:grid;place-items:center;overflow:hidden;background:var(--sunk);color:var(--mut);font-size:13px;text-align:center}
  .cover-box img{width:100%;height:100%;object-fit:cover}
  .row2{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .stickybar{position:sticky;bottom:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;box-shadow:var(--shadow);z-index:5}
  .stickybar .btn{flex:1;justify-content:center}
  @media (max-width:980px){.ed{grid-template-columns:minmax(0,1fr)}}
</style>`;

export function renderSiteList(
  kind: Kind,
  d: { items: SitePost[]; counts: Record<string, number> },
  o: { status: string; q: string; serverTime: number },
): string {
  const L = KIND_LABEL[kind];
  const base = `/dashboard/site/${kind === 'post' ? 'posts' : 'pages'}`;
  const filters = [
    ['semua', 'Semua'],
    ['published', 'Terbit'],
    ['scheduled', 'Terjadwal'],
    ['draft', 'Draf'],
  ]
    .map(([k, label]) => `<a class="${o.status === k ? 'on' : ''}" href="${base}${k === 'semua' ? '' : `?status=${k}`}">${label} (${d.counts[k!] ?? 0})</a>`)
    .join('');
  const rows = d.items
    .map((p) => {
      const url = pathOf(p);
      return `<tr class="rowlink" onclick="location.href='${base}/${esc(p.id)}'">
      <td data-l="Judul"><b>${esc(p.title)}</b><div class="mut" style="font-size:12px">${esc(url)}</div></td>
      ${kind === 'post' ? `<td data-l="Kategori" class="mut">${esc(p.category || '—')}</td>` : ''}
      <td data-l="Kata kunci" class="mut">${esc(p.focusKeyword || '—')}</td>
      <td data-l="Status">${statusPill(p)}${p.noindex ? ' <span class="pill">noindex</span>' : ''}</td>
      <td data-l="Diperbarui" class="mut" style="white-space:nowrap">${dt(p.updatedAt)}</td>
      <td style="white-space:nowrap"><a class="mini" href="${esc(url)}${isLive(p) ? '' : '?preview=1'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Lihat ↗</a></td></tr>`;
    })
    .join('');
  const body = `${CSS}<div class="titlebar"><h1>Website</h1><a class="btn primary" href="${base}/new">+ ${L.one} baru</a></div>
<div class="site-tabs"><a class="${kind === 'post' ? 'on' : ''}" href="/dashboard/site/posts">Artikel blog</a><a class="${kind === 'page' ? 'on' : ''}" href="/dashboard/site/pages">Halaman</a><a href="${esc(siteUrl('/'))}" target="_blank" rel="noopener">Lihat situs ↗</a></div>
<div class="subnav">${filters}</div>
<form method="get" action="${base}" style="display:flex;gap:6px;margin:0 0 12px">
  ${o.status !== 'semua' ? `<input type="hidden" name="status" value="${esc(o.status)}">` : ''}
  <input type="search" name="q" value="${esc(o.q)}" placeholder="Cari judul / slug / kata kunci" style="flex:1;max-width:360px;background:var(--card);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px">
  <button class="btn ghost" type="submit">Cari</button>
</form>
<div class="tablewrap"><table>
<thead><tr><th>Judul</th>${kind === 'post' ? '<th>Kategori</th>' : ''}<th>Kata kunci fokus</th><th>Status</th><th>Diperbarui</th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="6" class="empty">Belum ada ${L.one.toLowerCase()}. <a href="${base}/new">Tulis yang pertama →</a></td></tr>`}</tbody></table></div>
<p class="mut" style="font-size:12px;margin-top:12px">Setiap ${L.one.toLowerCase()} yang terbit otomatis masuk <a href="/sitemap.xml" target="_blank">sitemap.xml</a>${kind === 'post' ? ', <a href="/feed.xml" target="_blank">RSS</a>,' : ''} dan <a href="/llms.txt" target="_blank">llms.txt</a>. Slug yang diganti setelah terbit dialihkan 301 otomatis.</p>`;
  return renderLayout({ title: `Website · ${L.many}`, active: 'site', body, serverTime: o.serverTime });
}

const wibInput = (ms: number | null) => {
  if (!ms) return '';
  const d = new Date(ms + 7 * 3_600_000);
  return d.toISOString().slice(0, 16);
};

export function renderSiteEditor(
  kind: Kind,
  p: SitePost | null,
  o: { error?: string | null; values?: Partial<Record<string, string>>; serverTime: number; revisions?: import('../services/site.service.js').Revision[] },
): string {
  const L = KIND_LABEL[kind];
  const base = `/dashboard/site/${kind === 'post' ? 'posts' : 'pages'}`;
  const v = (k: keyof SitePost, fallback = '') => esc(o.values?.[k as string] ?? (p ? String(p[k] ?? '') : fallback));
  const tags = esc(o.values?.tags ?? (p?.tags ?? []).join(', '));
  const status = o.values?.status ?? p?.status ?? 'draft';
  const pub = o.values?.publishedAt ?? wibInput(p?.publishedAt ?? null);
  const live = p ? isLive(p) : false;
  const cats = [...new Set([...SITE_CATEGORIES, ...(p?.category ? [p.category] : [])])];
  const body = `${CSS}<a class="crumb" href="${base}">← ${L.many}</a>
<div class="titlebar"><h1 style="font-size:19px">${p ? `Edit ${L.one.toLowerCase()}` : `${L.one} baru`}</h1>${p ? statusPill(p) : ''}</div>
${o.error ? `<div class="flash err" role="alert">${esc(o.error)}</div>` : ''}
<form method="post" action="${base}${p ? `/${esc(p.id)}` : ''}" id="ed-form" class="ed" data-kind="${kind}" data-site="${esc(siteUrl('/'))}" data-key="sirko-draft-${p ? esc(p.id) : `new-${kind}`}" data-saved="${p ? p.updatedAt : 0}">
  <div>
    <div class="panel">
      <label for="title">Judul (H1) <span class="cnt" data-count="title" data-min="20" data-max="70"></span></label>
      <input type="text" id="title" name="title" class="title-in" required maxlength="140" value="${v('title')}" placeholder="mis. Cara Mencatat Hutang Pelanggan Warung">
      <label for="slug">Slug URL</label>
      <div style="display:flex;align-items:center;gap:6px"><span class="mut" style="font-size:13px;white-space:nowrap">${esc(siteUrl(kind === 'post' ? '/blog/' : '/'))}</span><input type="text" id="slug" name="slug" maxlength="80" value="${v('slug')}" placeholder="otomatis dari judul" ${p ? 'data-locked="1"' : ''}></div>
      <div class="hint">Huruf kecil, angka, tanda minus. Mengganti slug yang sudah terbit membuat pengalihan 301 otomatis.</div>
    </div>
    <div class="panel">
      <div class="restore" id="restore"><span>Ada draf tersimpan otomatis di browser ini yang belum disimpan.</span><button type="button" class="btn ghost" id="restore-yes">Pulihkan</button><button type="button" class="btn ghost" id="restore-no">Buang</button></div>
      <div class="md-bar" role="toolbar" aria-label="Format teks">
        <button type="button" data-md="h2" title="Sub-judul (H2)">H2</button><button type="button" data-md="h3" title="Sub-sub-judul (H3)">H3</button>
        <span class="sep"></span>
        <button type="button" data-md="b" title="Tebal">B</button><button type="button" data-md="i" title="Miring"><i>I</i></button>
        <button type="button" data-md="link" title="Tautan">🔗</button>
        <button type="button" data-md="ul" title="Daftar">•</button><button type="button" data-md="ol" title="Daftar bernomor">1.</button>
        <button type="button" data-md="quote" title="Kutipan">❝</button><button type="button" data-md="table" title="Tabel">▦</button>
        <button type="button" data-md="faq" title="Bagian Tanya jawab (schema FAQ)">FAQ</button>
        <button type="button" id="img-btn" title="Sisipkan gambar">🖼 Gambar</button>
        <span class="sp"></span>
        <span class="mode" style="display:flex;gap:4px"><button type="button" class="on" data-mode="write">Tulis</button><button type="button" data-mode="preview">Pratinjau</button></span>
      </div>
      <textarea id="body" name="bodyMd" spellcheck="true" placeholder="Tulis isi dengan Markdown. Mulai dengan paragraf pembuka yang memuat kata kunci fokus, lalu pakai ## untuk sub-judul.">${v('bodyMd')}</textarea>
      <iframe id="pv" title="Pratinjau seperti di situs" sandbox="allow-same-origin"></iframe>
      <script type="application/json" id="site-css">${JSON.stringify(SITE_CSS).replace(/</g, '\\u003c')}</script>
      <div class="hint" id="stats">—</div>
      <input type="file" id="img-file" accept="image/jpeg,image/png,image/webp" hidden>
    </div>
  </div>

  <div>
    <div class="panel">
      <h3>Terbitkan</h3>
      <label for="status">Status</label>
      <select id="status" name="status"><option value="draft"${status === 'draft' ? ' selected' : ''}>Draf (belum tampil)</option><option value="published"${status === 'published' ? ' selected' : ''}>Terbit</option></select>
      <label for="publishedAt">Tanggal terbit (WIB)</label>
      <input type="datetime-local" id="publishedAt" name="publishedAt" value="${esc(pub)}">
      <div class="hint">Kosong = sekarang. Isi tanggal masa depan untuk menjadwalkan.</div>
      <label style="display:flex;gap:8px;align-items:center;font-weight:400;margin-top:12px"><input type="checkbox" name="noindex"${(o.values?.noindex ?? (p?.noindex ? 'on' : '')) ? ' checked' : ''}> Sembunyikan dari Google (noindex)</label>
      ${p ? `<div class="row2"><a class="btn ghost" href="${esc(pathOf(p))}${live ? '' : '?preview=1'}" target="_blank" rel="noopener">${live ? 'Lihat ↗' : 'Pratinjau ↗'}</a></div>` : ''}
    </div>

    <div class="panel">
      <h3>SEO</h3>
      <label for="focusKeyword">Kata kunci fokus</label>
      <input type="text" id="focusKeyword" name="focusKeyword" maxlength="80" value="${v('focusKeyword')}" placeholder="mis. aplikasi kasir warung">
      <label for="metaTitle">Judul SEO <span class="cnt" data-count="metaTitle" data-min="30" data-max="60"></span></label>
      <input type="text" id="metaTitle" name="metaTitle" maxlength="70" value="${v('metaTitle')}" placeholder="Kosong = judul + | Sirko">
      <label for="metaDescription">Deskripsi meta <span class="cnt" data-count="metaDescription" data-min="120" data-max="160"></span></label>
      <textarea id="metaDescription" name="metaDescription" rows="3" maxlength="170" placeholder="120–160 karakter: kata kunci + manfaat + ajakan">${v('metaDescription')}</textarea>
      <label>Cuplikan di Google</label>
      <div class="serp"><div class="u" id="serp-u"></div><div class="t" id="serp-t"></div><div class="d" id="serp-d"></div></div>
      <label>Skor SEO <span class="score" id="seo-score" style="float:right;font-size:18px"></span></label>
      <ul class="checks" id="seo-checks"></ul>
    </div>

    <div class="panel">
      <h3>Ringkasan &amp; gambar</h3>
      <label for="excerpt">Ringkasan (kartu artikel) <span class="cnt" data-count="excerpt" data-min="80" data-max="220"></span></label>
      <textarea id="excerpt" name="excerpt" rows="3" maxlength="320">${v('excerpt')}</textarea>
      <label>Gambar sampul (1200×630, juga gambar share)</label>
      <div class="cover-box" id="cover-box">${p?.coverUrl ? `<img src="${esc(p.coverUrl)}" alt="">` : 'Belum ada sampul — situs memakai gambar bawaan Sirko'}</div>
      <input type="hidden" id="coverUrl" name="coverUrl" value="${v('coverUrl')}">
      <div class="row2"><button type="button" class="btn ghost" id="cover-btn">Unggah sampul</button><button type="button" class="btn ghost" id="cover-del">Hapus</button></div>
      <input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp" hidden>
      <label for="coverAlt">Teks alt sampul</label>
      <input type="text" id="coverAlt" name="coverAlt" maxlength="160" value="${v('coverAlt')}" placeholder="Jelaskan isi gambar">
      ${
        kind === 'post'
          ? `<label for="category">Kategori</label>
      <input type="text" id="category" name="category" list="cats" maxlength="60" value="${v('category')}">
      <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label for="tags">Tag (pisahkan koma)</label>
      <input type="text" id="tags" name="tags" maxlength="200" value="${tags}" placeholder="kasbon, warung">`
          : ''
      }
      <label for="author">Penulis</label>
      <input type="text" id="author" name="author" maxlength="80" value="${v('author', 'Tim Sirko')}">
    </div>

    ${
      p && o.revisions?.length
        ? `<div class="panel"><h3>Riwayat revisi</h3><ul class="checks" style="gap:8px">${o.revisions
            .slice(0, 10)
            .map(
              (r) => `<li style="justify-content:space-between;align-items:center"><span>${dt(r.createdAt)}<br><span class="mut" style="font-size:12px">${esc(r.createdBy)} · ${r.words} kata</span></span><button class="btn ghost" type="submit" form="rev-${esc(r.id)}">Pulihkan</button></li>`,
            )
            .join('')}</ul></div>`
        : ''
    }
    <div class="stickybar">
      <button class="btn primary" type="submit">Simpan</button>
      ${p ? `<button class="btn bad" type="submit" form="del-form">Hapus</button>` : ''}
    </div>
  </div>
  <input type="hidden" name="kind" value="${kind}">
</form>
${p && o.revisions ? o.revisions.slice(0, 10).map((r) => `<form id="rev-${esc(r.id)}" method="post" action="${base}/${esc(p.id)}/revisions/${esc(r.id)}" onsubmit="return confirm('Pulihkan versi ${dt(r.createdAt)}? Isi saat ini tersimpan sebagai revisi.')"></form>`).join('') : ''}
${p ? `<form id="del-form" method="post" action="${base}/${esc(p.id)}/delete" onsubmit="var t=prompt('Hapus ${L.one.toLowerCase()} ini?\\n\\nAlihkan pengunjung & Google ke halaman lain? Isi path tujuan (mis. /blog/artikel-lain), atau kosongkan agar URL lama menjawab 410 (dihapus).','');if(t===null)return false;this.redirectTo.value=t;return true"><input type="hidden" name="redirectTo"></form>` : ''}
${EDITOR_JS}`;
  return renderLayout({ title: `Website · ${p ? 'Edit' : 'Baru'}`, active: 'site', body, serverTime: o.serverTime });
}

const IMG_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/browser-image-compression/2.0.2/browser-image-compression.js';
const IMG_SRI = 'sha512-AqNGerESFmfQYTtyWZDQv8WSi4ICG16z/O+8JyAD5Iaafp+fnAU4xbJipYZ0bU9DrhXAsx1Vylli0oebd9l55g==';

const EDITOR_JS = `<script src="${IMG_LIB}" integrity="${IMG_SRI}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>
(function(){
  var f=document.getElementById('ed-form'); if(!f) return;
  var kind=f.dataset.kind, site=f.dataset.site.replace(/\\/$/,'');
  var $=function(id){return document.getElementById(id)};
  var title=$('title'), slug=$('slug'), body=$('body'), pv=$('pv'), kw=$('focusKeyword'), mt=$('metaTitle'), md=$('metaDescription');
  function slugify(s){return (s||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'')}
  var slugTouched=!!slug.dataset.locked && slug.value!=='';
  slug.addEventListener('input',function(){slugTouched=true});
  title.addEventListener('input',function(){if(!slugTouched) slug.value=slugify(title.value); update()});

  // ── penghitung karakter ──
  function counters(){document.querySelectorAll('[data-count]').forEach(function(c){
    var el=$(c.dataset.count), n=(el.value||'').trim().length, mn=+c.dataset.min, mx=+c.dataset.max;
    c.textContent=n+' / '+mn+'–'+mx; c.className='cnt '+(n===0?'':(n>=mn&&n<=mx)?'ok':n>mx?'bad':'warn');
  })}

  // ── toolbar markdown ──
  function wrap(pre,post,ph){var s=body.selectionStart,e=body.selectionEnd,sel=body.value.slice(s,e)||ph;
    body.setRangeText(pre+sel+post,s,e,'end'); if(sel===ph){body.selectionStart=s+pre.length;body.selectionEnd=s+pre.length+sel.length} body.focus(); update()}
  function line(prefix,ph){var s=body.selectionStart,e=body.selectionEnd,ls=body.value.lastIndexOf('\\n',s-1)+1,sel=body.value.slice(ls,e)||ph;
    var out=sel.split('\\n').map(function(l,i){return (typeof prefix==='function'?prefix(i):prefix)+l.replace(/^(#{1,6} |> |- |\\d+\\. )/,'')}).join('\\n');
    body.setRangeText(out,ls,e,'end'); body.focus(); update()}
  function block(t){var s=body.selectionStart; var lead=(s>0&&body.value[s-1]!=='\\n')?'\\n\\n':''; body.setRangeText(lead+t+'\\n',s,body.selectionEnd,'end'); body.focus(); update()}
  var acts={
    h2:function(){line('## ','Sub-judul')}, h3:function(){line('### ','Sub-sub-judul')},
    b:function(){wrap('**','**','teks tebal')}, i:function(){wrap('*','*','teks miring')},
    link:function(){var u=prompt('Alamat tautan (mis. /aplikasi-kasir-warung atau https://…)','/'); if(u) wrap('[','](' + u + ')','teks tautan')},
    ul:function(){line('- ','poin')}, ol:function(){line(function(i){return (i+1)+'. '},'langkah')},
    quote:function(){line('> ','kutipan')},
    table:function(){block('| Kolom 1 | Kolom 2 |\\n| --- | --- |\\n| isi | isi |')},
    faq:function(){block('## Tanya jawab\\n\\n### Pertanyaan pertama?\\n\\nJawaban singkat dalam satu paragraf.\\n\\n### Pertanyaan kedua?\\n\\nJawaban singkat.')}
  };
  document.querySelectorAll('[data-md]').forEach(function(b){b.addEventListener('click',function(){acts[b.dataset.md]()})});

  // ── pratinjau ──
  var mode='write', pvTimer=null;
  document.querySelectorAll('[data-mode]').forEach(function(b){b.addEventListener('click',function(){
    mode=b.dataset.mode; document.querySelectorAll('[data-mode]').forEach(function(x){x.classList.toggle('on',x===b)});
    body.style.display=mode==='write'?'':'none'; pv.style.display=mode==='write'?'none':'block'; if(mode==='preview') renderPv();
  })});
  var last=null, css=JSON.parse(document.getElementById('site-css').textContent);
  function esc(t){return (t||'').replace(/[&<>]/g,function(ch){return ch==='&'?'&amp;':ch==='<'?'&lt;':'&gt;'})}
  function renderPv(cb){
    fetch('/dashboard/site/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({md:body.value})})
      .then(function(r){return r.json()}).then(function(d){
        last=d;
        if(mode==='preview'){
          var cov=$('coverUrl').value;
          pv.srcdoc='<!doctype html><html lang="id"><head><meta charset="utf-8"><style>'+css+'</style></head><body><main class="wrap"><article class="doc"><header class="doc-head"><h1>'+esc(title.value)+'</h1></header>'+(cov?'<figure class="cover"><img src="'+esc(cov)+'" alt=""></figure>':'')+'<div class="prose">'+(d.html||'<p>Kosong.</p>')+'</div></article></main></body></html>';
        }
        seo(); if(cb)cb();
      }).catch(function(){});
  }

  // ── analisis SEO (meniru pemeriksaan server: kata, H2, tautan internal, alt gambar) ──
  function has(h,n){return n&&h.toLowerCase().indexOf(n.toLowerCase())>=0}
  function seo(){
    var k=kw.value.trim(), t=title.value.trim(), m=mt.value.trim()||t+' | Sirko', d=md.value.trim(), s=slug.value.trim()||slugify(t);
    var text=body.value, first=(text.split(/\\n\\s*\\n/).find(function(p){return p.trim()&&!/^#/.test(p.trim())})||'');
    var words=last?last.words:text.split(/\\s+/).filter(Boolean).length, h2=last?last.h2:(text.match(/^## /gm)||[]).length;
    var internal=last?last.internalLinks:(text.match(/\\]\\(\\//g)||[]).length, imgs=last?last.images:[], noAlt=imgs.filter(function(i){return !i.alt.trim()}).length;
    var minWords=kind==='post'?700:500;
    var c=[
      [!!k,'Kata kunci fokus diisi',k?'ok':'bad'],
      [has(t,k),'Kata kunci ada di judul (H1)'],
      [has(m,k),'Kata kunci ada di judul SEO'],
      [has(d,k),'Kata kunci ada di deskripsi meta'],
      [k&&s.indexOf(slugify(k).split('-').slice(0,3).join('-'))>=0,'Kata kunci (sebagian) ada di slug'],
      [has(first,k),'Kata kunci ada di paragraf pertama'],
      [/^##\\s.*$/m.test(text)&&k&&text.split('\\n').some(function(l){return /^#{2,3}\\s/.test(l)&&has(l,k)}),'Kata kunci ada di minimal satu sub-judul'],
      [m.length>=30&&m.length<=60,'Judul SEO 30–60 karakter ('+m.length+')'],
      [d.length>=120&&d.length<=160,'Deskripsi meta 120–160 karakter ('+d.length+')'],
      [words>=minWords,'Panjang isi ≥ '+minWords+' kata ('+words+')'],
      [h2>=2,'Minimal 2 sub-judul H2 ('+h2+')'],
      [internal>=2,'Minimal 2 tautan internal ('+internal+')'],
      [noAlt===0,imgs.length?'Semua gambar punya teks alt':'Tidak ada gambar tanpa alt'],
      [kind!=='post'||!!$('coverUrl').value,'Gambar sampul (untuk share & Google Discover)'],
      [kind!=='post'||!!$('excerpt').value.trim(),'Ringkasan diisi'],
      [!/\\[EMAIL KONTAK\\]|lorem ipsum|TODO/i.test(text),'Tidak ada placeholder tertinggal'],
    ];
    var okN=0,ul=$('seo-checks'); ul.innerHTML='';
    c.forEach(function(x){var ok=!!x[0]; if(ok)okN++; var li=document.createElement('li'); li.className=ok?'ok':(x[2]||'warn'); li.textContent=x[1]; ul.appendChild(li)});
    var sc=Math.round(okN/c.length*100), el=$('seo-score'); el.textContent=sc+'/100'; el.style.color=sc>=85?'var(--ok)':sc>=60?'var(--warn)':'var(--bad)';
    $('serp-u').textContent=site+(kind==='post'?'/blog/':'/')+s; $('serp-t').textContent=m.length>60?m.slice(0,58)+'…':m;
    $('serp-d').textContent=(d||$('excerpt').value||'Deskripsi meta belum diisi — Google akan memilih teks sendiri.').slice(0,160);
    $('stats').textContent=words+' kata · ±'+Math.max(1,Math.round(words/200))+' menit baca · '+h2+' H2 · '+internal+' tautan internal';
  }
  function update(){counters(); seo(); clearTimeout(pvTimer); pvTimer=setTimeout(function(){renderPv()},700)}
  ['input','change'].forEach(function(ev){f.addEventListener(ev,function(e){if(e.target!==title)update()})});

  // ── unggah gambar (kompres di browser ≤ 400 KB, WebP/JPG) ──
  async function upload(file,maxW){
    if(!/^image\\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Pakai JPG, PNG, atau WebP.');
    var type=file.type==='image/jpeg'?'image/jpeg':'image/webp', out=file;
    if(window.imageCompression) out=await window.imageCompression(file,{maxSizeMB:0.38,maxWidthOrHeight:maxW,useWebWorker:true,fileType:type,initialQuality:0.82,libURL:'${IMG_LIB}'});
    var name=slugify(file.name.replace(/\\.[^.]*$/,''))||'gambar';
    var fd=new FormData(); fd.append('file',new File([out],name+(type==='image/jpeg'?'.jpg':'.webp'),{type:type}));
    var r=await fetch('/dashboard/site/upload',{method:'POST',body:fd}); var j=await r.json();
    if(!r.ok) throw new Error(j.error||'Unggah gagal'); return j.url;
  }
  $('img-btn').addEventListener('click',function(){$('img-file').click()});
  $('img-file').addEventListener('change',async function(){
    var file=this.files[0]; this.value=''; if(!file) return;
    var alt=prompt('Teks alt gambar (jelaskan isi gambar, penting untuk SEO):','')||'';
    var b=$('img-btn'), o=b.textContent; b.textContent='Mengunggah…'; b.disabled=true;
    try{
      var url=await upload(file,1600), dim='';
      try{var bm=await createImageBitmap(file), sc=Math.min(1,1600/Math.max(bm.width,bm.height)); dim='#w='+Math.round(bm.width*sc)+'&h='+Math.round(bm.height*sc)}catch(_){}
      block('!['+alt+']('+url+dim+')');
    }catch(e){alert(e.message)} b.textContent=o; b.disabled=false;
  });
  /** Potong tengah ke rasio 1200:630 lalu JPEG (pratinjau WhatsApp/Facebook andal). */
  async function coverJpeg(file,w,h){
    var bm=await createImageBitmap(file), r=w/h, sw=bm.width, sh=bm.height, sx=0, sy=0;
    if(sw/sh>r){sw=Math.round(sh*r);sx=Math.round((bm.width-sw)/2)}else{sh=Math.round(sw/r);sy=Math.round((bm.height-sh)/2)}
    var cv=document.createElement('canvas'); cv.width=w; cv.height=h; var cx=cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,w,h); cx.drawImage(bm,sx,sy,sw,sh,0,0,w,h);
    for(var q=0.85;q>=0.5;q-=0.1){var blob=await new Promise(function(res){cv.toBlob(res,'image/jpeg',q)}); if(blob.size<=380*1024) return blob}
    throw new Error('Sampul terlalu besar setelah dikompres.');
  }
  $('cover-btn').addEventListener('click',function(){$('cover-file').click()});
  $('cover-file').addEventListener('change',async function(){
    var file=this.files[0]; this.value=''; if(!file) return; var box=$('cover-box'); box.textContent='Mengunggah…';
    try{
      if(!/^image\\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Pakai JPG, PNG, atau WebP.');
      var name=(slugify(file.name.replace(/\\.[^.]*$/,''))||'sampul')+'.jpg';
      var fd=new FormData(); fd.append('file',new File([await coverJpeg(file,1200,630)],name,{type:'image/jpeg'})); fd.append('small',new File([await coverJpeg(file,600,315)],name,{type:'image/jpeg'}));
      var r=await fetch('/dashboard/site/upload',{method:'POST',body:fd}), j=await r.json(); if(!r.ok) throw new Error(j.error||'Unggah gagal');
      $('coverUrl').value=j.url; box.innerHTML='<img src="'+j.url+'" alt="">'; if(!$('coverAlt').value) $('coverAlt').value=title.value; update();
    }catch(e){box.textContent=e.message}
  });
  $('cover-del').addEventListener('click',function(){$('coverUrl').value=''; $('cover-box').textContent='Belum ada sampul'; update()});

  var dirty=false, KEY=f.dataset.key, saved=+f.dataset.saved, FIELDS=['title','slug','focusKeyword','metaTitle','metaDescription','excerpt','coverUrl','coverAlt','category','tags','author','bodyMd'];
  function snap(){var o={t:Date.now()};FIELDS.forEach(function(n){var el=f.elements[n];if(el)o[n]=el.value});return o}
  f.addEventListener('input',function(){dirty=true;clearTimeout(f._as);f._as=setTimeout(function(){try{localStorage.setItem(KEY,JSON.stringify(snap()))}catch(_){}} ,800)});
  f.addEventListener('submit',function(){dirty=false;try{localStorage.removeItem(KEY)}catch(_){}});
  try{var d0=JSON.parse(localStorage.getItem(KEY)||'null'); if(d0&&d0.t>saved&&d0.bodyMd!==body.value){var rb=$('restore');rb.style.display='flex';
    $('restore-yes').onclick=function(){FIELDS.forEach(function(n){var el=f.elements[n];if(el&&d0[n]!=null)el.value=d0[n]});rb.style.display='none';dirty=true;update()};
    $('restore-no').onclick=function(){try{localStorage.removeItem(KEY)}catch(_){}rb.style.display='none'}}}catch(_){}
  window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue=''}});
  counters(); renderPv();
})();
</script>`;

const LEAD_LABEL: Record<string, string> = { waitlist: 'Daftar tunggu', contact: 'Kontak', delete_account: 'Hapus akun' };

export function renderLeads(items: import('../services/site.service.js').SiteLead[], o: { status: string; serverTime: number }): string {
  const tabs = [['new', 'Baru'], ['done', 'Selesai'], ['semua', 'Semua']]
    .map(([k, l]) => `<a class="${o.status === k ? 'on' : ''}" href="/dashboard/site/leads?status=${k}">${l}</a>`)
    .join('');
  const rows = items
    .map(
      (l) => `<tr>
    <td data-l="Jenis"><span class="pill${l.kind === 'delete_account' ? ' bad' : l.kind === 'waitlist' ? ' ok' : ''}">${LEAD_LABEL[l.kind]}</span></td>
    <td data-l="Nama">${esc(l.name || '—')}${l.storeType ? `<div class="mut" style="font-size:12px">${esc(l.storeType)}</div>` : ''}</td>
    <td data-l="Kontak"><code>${esc(l.contact)}</code>${l.kind === 'delete_account' ? `<div><a class="mini" href="/dashboard/users?q=${encodeURIComponent(l.contact.replace(/[\s-]/g, '').replace(/^\+?0(?=8)/, '62').replace(/^\+/, ''))}">Cari akun →</a></div>` : ''}</td>
    <td data-l="Pesan" style="max-width:420px;white-space:pre-wrap">${esc(l.message || '—')}</td>
    <td data-l="Masuk" class="mut" style="white-space:nowrap">${dt(l.createdAt)}</td>
    <td><form method="post" action="/dashboard/site/leads/${esc(l.id)}"><input type="hidden" name="done" value="${l.status === 'new' ? '1' : '0'}"><button class="btn ghost" type="submit">${l.status === 'new' ? '✓ Selesai' : '↺ Buka lagi'}</button></form>${l.handledBy ? `<div class="mut" style="font-size:11px">oleh ${esc(l.handledBy)}</div>` : ''}</td></tr>`,
    )
    .join('');
  const body = `${CSS}<div class="titlebar"><h1>Pesan masuk dari situs</h1></div>
<div class="site-tabs">${tabs}</div>
<p class="mut" style="font-size:13px;margin:0 0 12px">Daftar tunggu (sebelum rilis), formulir kontak, dan permintaan hapus akun dari sirkopos.com. Permintaan hapus akun: verifikasi ke kontak pemilik dulu, lalu proses maksimal 30 hari.</p>
<div class="tablewrap"><table><thead><tr><th>Jenis</th><th>Nama</th><th>Kontak</th><th>Pesan</th><th>Masuk</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="empty">Tidak ada pesan.</td></tr>'}</tbody></table></div>`;
  return renderLayout({ title: 'Website · Pesan masuk', active: 'site', body, serverTime: o.serverTime });
}
