import { createEffect, createResource, createSignal, For, on, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Icon } from '../ui/icon';
import { ScanButton } from '../ui/scanner';
import { Modal, Toast } from './ui';
import { online, sync } from '../state';
import { ApiError, NetworkError } from '../lib/api';
import {
  lookupBarcode, myContributions, searchCatalog, sizeLabel, submitContribution, uploadCatalogImage, type CatalogItem, type Contribution,
} from '../cloud/catalog';
import { bumpCache, cacheCount, cacheVersion, searchCache, syncCatalog, syncing, syncProcessed, upsertCatalog } from '../db/catalog';

/**
 * Katalog Umum (KatalogUmumScreen aplikasi): referensi produk bersama milik Sirko. Tab Cache (data
 * tersimpan di browser, cari langsung) & Online (cari ke server, muat lebih banyak), scan barcode,
 * sync katalog, Usulkan produk/perbaikan, Usulan Saya.
 */

const errText = (e: unknown) =>
  e instanceof ApiError && e.code === 'NEEDS_LOGIN' ? 'Belum terhubung ke cloud. Silakan login dulu.'
  : e instanceof NetworkError ? 'Tidak ada internet.'
  : e instanceof Error ? e.message : String(e);

/** Gambar 44×44 (CatalogThumb): foto katalog atau placeholder. */
export function CatalogThumb(props: { url: string | null; size?: number }) {
  const [broken, setBroken] = createSignal(false);
  const size = () => props.size ?? 44;
  return (
    <Show when={props.url && !broken()} fallback={<span class="cat-thumb ph" style={{ width: `${size()}px`, height: `${size()}px` }}><Icon name="inventory2" size={Math.round(size() / 2)} /></span>}>
      <img class="cat-thumb" src={props.url!} alt="" loading="lazy" width={size()} height={size()} onError={() => setBroken(true)} />
    </Show>
  );
}

const subtitle = (i: CatalogItem, withSize: boolean) => [i.brand, i.category, withSize ? sizeLabel(i) : null, i.barcode].filter(Boolean).join(' • ');

export function KatalogPage() {
  const nav = useNavigate();
  const [tab, setTab] = createSignal<'cache' | 'online'>('cache');
  const [q, setQ] = createSignal('');
  const [toast, setToast] = createSignal<{ msg: string; kind: 'ok' | 'err' | 'warn' }>({ msg: '', kind: 'ok' });
  const say = (msg: string, kind: 'ok' | 'err' | 'warn' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast({ msg: '', kind }), 3500);
  };
  const [form, setForm] = createSignal<{ existing: CatalogItem | null } | null>(null);

  // Cache: cari langsung tiap ketik.
  const [cached] = createResource(() => [q(), cacheVersion()] as const, ([s]) => searchCache(s));

  // Online: cari saat Enter / scan; pertama kali tab dibuka langsung "lihat semua".
  const [online_, setOnline] = createSignal<{ items: CatalogItem[]; cursor: string | null; hasMore: boolean; loading: boolean; error: string; searched: boolean }>({ items: [], cursor: null, hasMore: false, loading: false, error: '', searched: false });
  const runOnline = async (more = false) => {
    const st = online_();
    setOnline({ ...st, loading: true, error: '' });
    try {
      const r = await searchCatalog(q(), more ? st.cursor : null, 20);
      setOnline({ items: more ? [...st.items, ...r.items] : r.items, cursor: r.nextCursor, hasMore: r.hasMore, loading: false, error: '', searched: true });
    } catch (e) {
      setOnline({ ...online_(), loading: false, error: errText(e), searched: true });
    }
  };
  createEffect(on(tab, (t) => { if (t === 'online' && !online_().searched && online()) void runOnline(); }));

  const onScan = async (code: string) => {
    setQ(code);
    if (tab() !== 'online' || !online()) return;
    setOnline({ ...online_(), loading: true, error: '' });
    try {
      const hit = await lookupBarcode(code);
      setOnline({ items: hit ? [hit] : [], cursor: null, hasMore: false, loading: false, error: '', searched: true });
    } catch (e) {
      setOnline({ ...online_(), loading: false, error: errText(e), searched: true });
    }
  };

  const syncAll = async () => {
    if (!online()) return say('Tidak ada internet.', 'warn');
    say('Mulai sync katalog di latar belakang…');
    try {
      const n = await syncCatalog();
      say(`Sync katalog selesai: ${n} produk diperbarui`);
    } catch (e) {
      say(`Sync gagal: ${errText(e)}`, 'err');
    }
  };
  // Seperti aplikasi yang membawa katalog bawaan: cache kosong + online → isi otomatis sekali.
  onMount(async () => {
    if (online() && !syncing() && (await cacheCount()) === 0) void syncAll();
  });

  const syncOne = async (i: CatalogItem) => {
    if (!i.barcode) return;
    try {
      const hit = await lookupBarcode(i.barcode);
      if (!hit) return say(`Barcode ${i.barcode} tak ada di katalog online`, 'warn');
      await upsertCatalog([hit]);
      bumpCache();
      say(`Diperbarui: ${hit.name}`);
    } catch (e) {
      say(errText(e), 'err');
    }
  };

  return (
    <div class="katalog">
      <div class="page-actions">
        <button class="m-icon-btn" title="Usulan Saya" onClick={() => nav('/katalog/usulan')}><Icon name="inbox" /></button>
        <button class="m-icon-btn" title="Sync katalog" disabled={syncing()} onClick={() => void syncAll()}>
          <Show when={!syncing()} fallback={<span class="spin" />}><Icon name="sync" /></Show>
        </button>
      </div>
      <div class="m-tabs">
        <button class={tab() === 'cache' ? 'on' : ''} onClick={() => setTab('cache')}>Cache</button>
        <button class={tab() === 'online' ? 'on' : ''} onClick={() => setTab('online')}>Online</button>
      </div>
      <p class="info-strip">Daftar katalog produk umum milik Sirko — referensi bersama, bukan produk tokomu. Kamu bisa cari via teks atau scan barcode.</p>
      <Show when={syncing()}>
        <div class="sync-banner"><Icon name="sync" size={20} />Sedang sync katalog… {syncProcessed()} produk</div>
      </Show>
      <form class="m-toolbar" onSubmit={(e) => { e.preventDefault(); if (tab() === 'online') void runOnline(); }}>
        <div class="search-wrap">
          <input class="pos-search" enterkeyhint="search" placeholder="Cari nama / merek / barcode…" value={q()} onInput={(e) => setQ(e.currentTarget.value.trimStart())} />
          <Show when={q()}><button type="button" class="m-icon-btn sm clear" title="Hapus" onClick={() => setQ('')}><Icon name="close" size={18} /></button></Show>
        </div>
        <ScanButton class="tonal" title="Scan barcode" onCode={(c) => void onScan(c)} />
      </form>

      <Show when={tab() === 'cache'}>
        <div class="m-list">
          <For each={cached() ?? []} fallback={<Show when={!cached.loading}><div class="m-empty"><Icon name="inventory2" size={56} /><span>Tak ada produk di cache untuk pencarian ini.</span></div></Show>}>
            {(i) => (
              <div class="m-row">
                <CatalogThumb url={i.photoUrl} />
                <span class="m-row-text">
                  <span class="m-row-title">{i.name}</span>
                  <span class="m-row-sub">{subtitle(i, false) || '—'}</span>
                </span>
                <button class="m-icon-btn" title="Sync produk ini" onClick={() => void syncOne(i)}><Icon name="sync" /></button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={tab() === 'online'}>
        <Show
          when={online() && !sync.needsLogin}
          fallback={
            <div class="m-empty">
              <Icon name="cloudOff" size={56} />
              <span>{online() ? 'Belum terhubung ke cloud.' : 'Tidak ada internet.'}</span>
              <Show when={online()}><button class="btn primary" onClick={() => nav('/masuk')}><Icon name="cloud" size={18} />Hubungkan ke Cloud</button></Show>
            </div>
          }
        >
          <Show when={online_().error && !online_().items.length}><div class="m-empty"><Icon name="warningAmber" size={56} /><span>Gagal: {online_().error}</span></div></Show>
          <Show when={online_().searched && !online_().loading && !online_().error && !online_().items.length}><div class="m-empty"><Icon name="search" size={56} /><span>Tak ada hasil online.</span></div></Show>
          <div class="m-list">
            <For each={online_().items}>
              {(i) => (
                <div class="m-row">
                  <CatalogThumb url={i.photoUrl} />
                  <span class="m-row-text">
                    <span class="m-row-title">{i.name}</span>
                    <span class="m-row-sub">{subtitle(i, true) || '—'}</span>
                  </span>
                  <Show when={i.verified}><Icon name="verified" size={18} class="cat-verified" /></Show>
                  <button class="m-icon-btn" title="Usulkan perbaikan" onClick={() => setForm({ existing: i })}><Icon name="editNote" /></button>
                </div>
              )}
            </For>
          </div>
          <Show when={online_().loading}><p class="m-caption">Memuat…</p></Show>
          <Show when={online_().hasMore && !online_().loading}>
            <div class="load-more"><button class="btn" onClick={() => void runOnline(true)}>Muat lebih banyak</button></div>
          </Show>
        </Show>
      </Show>

      <button class="m-fab cat-fab" onClick={() => (online() ? setForm({ existing: null }) : say('Usulan butuh internet.', 'warn'))}>
        <Icon name="addAPhoto" />Usulkan
      </button>
      <Show when={form()}>
        {(f) => <ContributionDialog existing={f().existing} onClose={() => setForm(null)} onSent={() => { setForm(null); say('Usulan terkirim — menunggu review admin. Cek di "Usulan Saya".'); }} />}
      </Show>
      <Toast msg={toast().msg} kind={toast().kind} />
    </div>
  );
}

const CATEGORIES = ['Makanan', 'Minuman', 'Rokok', 'Sembako', 'Kebersihan', 'Perawatan', 'Kesehatan', 'Bumbu/Dapur', 'Snack', 'ATK', 'Lainnya'];

/** Usulkan Produk / Usulkan Perbaikan (ContributionFormScreen aplikasi). */
export function ContributionDialog(props: { existing: CatalogItem | null; initialBarcode?: string; onClose: () => void; onSent: () => void }) {
  const ex = props.existing;
  const [file, setFile] = createSignal<File | null>(null);
  const [preview, setPreview] = createSignal<string | null>(ex?.photoUrl ?? null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pickPhoto, setPickPhoto] = createSignal(false);
  let barcodeEl: HTMLInputElement | undefined;
  let cameraEl: HTMLInputElement | undefined;
  let galleryEl: HTMLInputElement | undefined;
  const choose = (f: File | undefined) => {
    setPickPhoto(false);
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return setError('Nama wajib diisi');
    setBusy(true);
    setError('');
    try {
      const photoUrl = file() ? await uploadCatalogImage(file()!) : ex?.photoUrl ?? undefined;
      const size = String(fd.get('netSize') ?? '').replace(',', '.').trim();
      await submitContribution({
        name,
        barcode: String(fd.get('barcode') ?? ''),
        brand: String(fd.get('brand') ?? ''),
        category: String(fd.get('category') ?? ''),
        photoUrl: photoUrl ?? undefined,
        netSize: size ? Number(size) : undefined,
        netUnit: String(fd.get('netUnit') ?? ''),
        note: String(fd.get('note') ?? ''),
        targetId: ex?.id,
      });
      props.onSent();
    } catch (err) {
      setError(`Gagal mengirim: ${errText(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={ex ? 'Usulkan Perbaikan' : 'Usulkan Produk'} onClose={props.onClose}>
      <form onSubmit={submit} class="contrib">
        <button type="button" class="photo-pick" onClick={() => setPickPhoto(true)}>
          <Show when={preview()} fallback={<><Icon name="addAPhoto" size={32} /><span>Foto</span></>}>
            <img src={preview()!} alt="Foto produk" />
          </Show>
        </button>
        <Show when={pickPhoto()}>
          <div class="photo-src">
            <button type="button" class="btn" onClick={() => cameraEl?.click()}><Icon name="photoCamera" size={18} />Kamera</button>
            <button type="button" class="btn" onClick={() => galleryEl?.click()}><Icon name="photoLibrary" size={18} />Galeri</button>
          </div>
        </Show>
        <input ref={cameraEl} type="file" accept="image/*" capture="environment" hidden onChange={(e) => choose(e.currentTarget.files?.[0])} />
        <input ref={galleryEl} type="file" accept="image/*" hidden onChange={(e) => choose(e.currentTarget.files?.[0])} />
        <div class="field"><label for="cn">Nama produk *</label><input id="cn" name="name" required maxlength="160" autocapitalize="words" value={ex?.name ?? ''} /></div>
        <div class="field"><label for="cb">Barcode</label>
          <div class="with-action">
            <input id="cb" ref={barcodeEl} name="barcode" inputmode="numeric" maxlength="64" value={ex?.barcode ?? props.initialBarcode ?? ''} />
            <ScanButton title="Scan barcode" onCode={(c) => { if (barcodeEl) barcodeEl.value = c; }} />
          </div>
        </div>
        <div class="field"><label for="cm">Merek</label><input id="cm" name="brand" maxlength="80" value={ex?.brand ?? ''} /></div>
        <div class="field"><label for="ck">Kategori</label>
          <select id="ck" name="category">
            <option value="">—</option>
            <For each={CATEGORIES}>{(c) => <option value={c} selected={ex?.category === c}>{c}</option>}</For>
          </select>
        </div>
        <div class="form-grid">
          <div class="field"><label for="cs">Ukuran (mis. 85)</label><input id="cs" name="netSize" inputmode="decimal" value={ex?.netSize ?? ''} /></div>
          <div class="field"><label for="cu">Satuan (g/ml)</label><input id="cu" name="netUnit" maxlength="12" value={ex?.netUnit ?? ''} /></div>
        </div>
        <div class="field"><label for="ct">Catatan untuk admin (opsional)</label><textarea id="ct" name="note" rows="2" maxlength="500" /></div>
        <Show when={error()}><div class="alert err" role="alert">{error()}</div></Show>
        <button class="btn primary block big" type="submit" disabled={busy()}><Icon name="send" size={18} />{busy() ? 'Mengirim…' : 'Kirim Usulan'}</button>
        <p class="small mut contrib-note">Usulan tidak langsung masuk katalog — di-review admin dulu. Setelah disetujui, produk muncul di katalog untuk semua toko.</p>
      </form>
    </Modal>
  );
}

const STATUS: Record<string, { label: string; icon: 'checkCircle' | 'cancel' | 'hourglassTop'; cls: string }> = {
  approved: { label: 'Disetujui', icon: 'checkCircle', cls: 'ok' },
  rejected: { label: 'Ditolak', icon: 'cancel', cls: 'bad' },
  pending: { label: 'Menunggu', icon: 'hourglassTop', cls: 'wait' },
};

/** Usulan Saya (MyContributionsScreen aplikasi). */
export function UsulanSayaPage() {
  const [list, { refetch }] = createResource(() => online(), () => myContributions());
  return (
    <div class="katalog">
      <div class="page-actions"><button class="m-icon-btn" title="Muat ulang" onClick={() => void refetch()}><Icon name="sync" /></button></div>
      <Show when={!list.error} fallback={<div class="m-empty"><Icon name="warningAmber" size={56} /><span>Gagal memuat: {errText(list.error)}</span></div>}>
        <div class="m-list">
          <For each={list() ?? []} fallback={<Show when={!list.loading}><div class="m-empty"><Icon name="inbox" size={56} /><span>Belum ada usulan.</span></div></Show>}>
            {(c: Contribution) => {
              const st = () => STATUS[c.status] ?? STATUS.pending!;
              return (
                <div class="m-row">
                  <span class={`contrib-ic ${st().cls}`}><Icon name={st().icon} /></span>
                  <span class="m-row-text">
                    <span class="m-row-title">{c.name}</span>
                    <span class="m-row-sub">{[c.barcode, c.reviewNote ? `Catatan: ${c.reviewNote}` : ''].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                  <span class={`contrib-chip ${st().cls}`}>{st().label}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
