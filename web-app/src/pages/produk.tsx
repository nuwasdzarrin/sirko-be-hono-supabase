import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { can, db, syncNow } from '../state';
import { num, rp } from '../pos/calc';
import { PosError } from '../pos/repo';
import {
  adjustStock, barcodeOwner, createProduct, createVariant, deleteCategory, deleteProduct, deleteUnit, deleteVariant, deleteWholesale,
  expiryStatus, restoreProduct, saveCategory, saveUnit, saveWholesale, stockIn, updateProduct, updateVariant,
} from '../manage/repo';
import { fmtDateTime } from '../pos/receipt';
import { Modal, MoneyInput, Toast } from './ui';
import { isMobile } from '../lib/media';
import { Icon } from '../ui/icon';

const live = (r: Row) => r.deletedAt == null;
const byName = (a: Row, b: Row) => String(a.name).localeCompare(String(b.name));
const msg = (e: unknown) => (e instanceof PosError ? e.message : `Gagal: ${(e as Error).message}`);

/** yyyy-mm-dd (zona lokal) ⇄ epoch ms awal hari. */
const toDateInput = (ms: unknown) => {
  if (ms == null) return '';
  const d = new Date(Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromDateInput = (s: string) => (s ? new Date(`${s}T00:00:00`).getTime() : null);

type Filter = 'all' | 'low' | 'expiry' | 'price' | 'deleted';
type Dlg = { kind: 'adjust'; product: Row; variant?: Row } | { kind: 'stockin' } | { kind: 'cats' } | { kind: 'units' } | null;

export function ProdukPage() {
  const params = useParams();
  const nav = useNavigate();
  const [q, setQ] = createSignal('');
  const [cat, setCat] = createSignal('');
  const [filter, setFilter] = createSignal<Filter>('all');
  const [dlg, setDlg] = createSignal<Dlg>(null);
  // Pintasan Beranda (HP): ?aksi=stok-masuk membuka Stok Masuk · ?f=menipis menyaring stok menipis.
  const [search] = useSearchParams();
  if (search.aksi === 'stok-masuk') setDlg({ kind: 'stockin' });
  if (search.f === 'menipis') setFilter('low');
  const [toast, setToast] = createSignal('');
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  };

  const products = createLive(db, async (d) => (await d.t('products').toArray()).sort(byName), [] as Row[]);
  const variants = createLive(db, async (d) => (await d.t('product_variants').toArray()).filter(live), [] as Row[]);
  const categories = createLive(db, async (d) => (await d.t('categories').toArray()).filter(live).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || byName(a, b)), [] as Row[]);
  const units = createLive(db, async (d) => (await d.t('units').toArray()).filter(live).sort(byName), [] as Row[]);

  const varOf = createMemo(() => {
    const m = new Map<string, Row[]>();
    for (const v of variants()) m.set(String(v.productId), [...(m.get(String(v.productId)) ?? []), v]);
    return m;
  });
  const stockOf = (p: Row) => (p.hasVariants === true ? (varOf().get(p.id) ?? []).reduce((s, v) => s + Number(v.stock ?? 0), 0) : Number(p.stock ?? 0));
  const isLow = (p: Row) => p.minStock != null && (p.hasVariants === true ? (varOf().get(p.id) ?? []).some((v) => Number(v.stock ?? 0) <= Number(p.minStock)) : Number(p.stock ?? 0) <= Number(p.minStock));
  const catName = createMemo(() => new Map(categories().map((c) => [c.id, String(c.name)])));

  const list = createMemo(() => {
    const s = q().trim().toLowerCase();
    const now = Date.now();
    return products().filter((p) => {
      if (filter() === 'deleted' ? p.deletedAt == null : p.deletedAt != null) return false;
      if (cat() && p.categoryId !== cat()) return false;
      if (s && !String(p.name).toLowerCase().includes(s) && !String(p.barcode ?? '').includes(s) && !(varOf().get(p.id) ?? []).some((v) => String(v.barcode ?? '') === s)) return false;
      if (filter() === 'low') return isLow(p);
      if (filter() === 'expiry') return ['expired', 'nearExpiry'].includes(expiryStatus(p.expiryDate as number | null, now));
      if (filter() === 'price') return p.needsPrice === true;
      return true;
    });
  });
  const counts = createMemo(() => {
    const now = Date.now();
    const a = products().filter(live);
    return { low: a.filter(isLow).length, expiry: a.filter((p) => ['expired', 'nearExpiry'].includes(expiryStatus(p.expiryDate as number | null, now))).length, price: a.filter((p) => p.needsPrice === true).length };
  });

  const unitName = createMemo(() => new Map(units().map((u) => [u.id, String(u.name)])));
  const [menu, setMenu] = createSignal(false);
  const FILTER_LABEL: Record<Filter, string> = { all: 'Semua', low: 'Stok menipis', expiry: 'Kedaluwarsa', price: 'Perlu harga', deleted: 'Recycle Bin' };
  return (
    <div class="split">
      <Show when={isMobile()} fallback={
      <section class="split-list">
        <div class="row-btns">
          <h1 style={{ margin: 0 }}>Produk & stok</h1>
          <span class="spacer" />
          <button class="btn sm" onClick={() => setDlg({ kind: 'cats' })}>Kategori</button>
          <button class="btn sm" onClick={() => setDlg({ kind: 'units' })}>Satuan</button>
          <button class="btn sm" onClick={() => setDlg({ kind: 'stockin' })}>Stok masuk</button>
          <Show when={can('addProduct')}><button class="btn sm primary" onClick={() => nav('/produk/baru')}>+ Produk</button></Show>
        </div>
        <div class="filters">
          <input class="pos-search" placeholder="Cari nama / barcode" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <select class="sel" value={cat()} onChange={(e) => setCat(e.currentTarget.value)}>
            <option value="">Semua kategori</option>
            <For each={categories()}>{(c) => <option value={c.id}>{String(c.name)}</option>}</For>
          </select>
        </div>
        <div class="chips" style={{ 'margin-bottom': '10px' }}>
          <button class={`chip ${filter() === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Semua</button>
          <button class={`chip ${filter() === 'low' ? 'on' : ''}`} onClick={() => setFilter('low')}>Stok menipis ({counts().low})</button>
          <button class={`chip ${filter() === 'expiry' ? 'on' : ''}`} onClick={() => setFilter('expiry')}>Kedaluwarsa ({counts().expiry})</button>
          <button class={`chip ${filter() === 'price' ? 'on' : ''}`} onClick={() => setFilter('price')}>Perlu harga ({counts().price})</button>
          <Show when={can('recycleBin')}><button class={`chip ${filter() === 'deleted' ? 'on' : ''}`} onClick={() => setFilter('deleted')}>Terhapus</button></Show>
        </div>
        <div class="card flush">
          <table class="list hover">
            <thead><tr><th>Produk</th><th>Kategori</th><th class="num">Harga jual</th><Show when={can('viewCostProfit')}><th class="num">Modal</th></Show><th class="num">Stok</th></tr></thead>
            <tbody>
              <For each={list().slice(0, 500)} fallback={<tr><td colspan="5" class="mut">Tidak ada produk.</td></tr>}>
                {(p) => {
                  const vs = () => varOf().get(p.id) ?? [];
                  const ex = () => expiryStatus(p.expiryDate as number | null, Date.now());
                  return (
                    <tr class={params.id === p.id ? 'sel' : ''} onClick={() => nav(`/produk/${p.id}`)}>
                      <td>
                        {String(p.name)}
                        <div class="small mut">
                          {String(p.barcode ?? '')}{p.hasVariants === true ? ` · ${vs().length} varian` : ''}
                          <Show when={p.needsPrice === true}> · <span class="badge warn">perlu harga</span></Show>
                          <Show when={ex() === 'expired'}> · <span class="bad-t">kedaluwarsa</span></Show>
                          <Show when={ex() === 'nearExpiry'}> · <span class="badge warn">hampir kedaluwarsa</span></Show>
                        </div>
                      </td>
                      <td>{catName().get(String(p.categoryId)) ?? '—'}</td>
                      <td class="num">{p.hasVariants === true && vs().length ? `mulai ${rp(Math.min(...vs().map((v) => Number(v.sellingPrice ?? 0))))}` : rp(Number(p.sellingPrice ?? 0))}</td>
                      <Show when={can('viewCostProfit')}><td class="num">{p.hasVariants === true ? '—' : rp(Number(p.costPrice ?? 0))}</td></Show>
                      <td class={`num ${isLow(p) ? 'bad-t' : ''}`}>{num(stockOf(p))}</td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={list().length > 500}><p class="small mut">Menampilkan 500 dari {list().length}. Perjelas pencarian.</p></Show>
      </section>
      }>
        {/* HP: ProductListScreen aplikasi (cari + Stok Masuk + Peringatan stok + ⋮, chip kategori, ProductTile, FAB) */}
        <section class="split-list">
          <div class="m-toolbar">
            <input class="pos-search" placeholder="Cari nama atau barcode…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
            <button class="m-icon-btn" title="Stok Masuk" onClick={() => setDlg({ kind: 'stockin' })}><Icon name="moveToInbox" /></button>
            <button class={`m-icon-btn ${filter() === 'low' ? 'm-on' : ''}`} title="Peringatan stok" onClick={() => setFilter(filter() === 'low' ? 'all' : 'low')}>
              <Icon name="warningAmber" />
              <Show when={counts().low}><span class="m-badge">{counts().low}</span></Show>
            </button>
            <div class="m-menu-wrap">
              <button class="m-icon-btn" title="Lainnya" onClick={() => setMenu(!menu())}><Icon name="moreVert" /></button>
              <Show when={menu()}>
                <div class="m-menu-bg" onClick={() => setMenu(false)} />
                <div class="m-menu" onClick={() => setMenu(false)}>
                  <button onClick={() => setDlg({ kind: 'cats' })}>Kategori</button>
                  <button onClick={() => setDlg({ kind: 'units' })}>Satuan</button>
                  <button onClick={() => setFilter('expiry')}>Kedaluwarsa ({counts().expiry})</button>
                  <button onClick={() => setFilter('price')}>Perlu harga ({counts().price})</button>
                  <Show when={can('recycleBin')}><button onClick={() => setFilter('deleted')}>Recycle Bin</button></Show>
                </div>
              </Show>
            </div>
          </div>
          <div class="m-chiprow">
            <button class={`chip ${!cat() ? 'on' : ''}`} onClick={() => setCat('')}>Semua</button>
            <For each={categories()}>{(c) => <button class={`chip ${cat() === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{String(c.name)}</button>}</For>
          </div>
          <Show when={filter() !== 'all'}>
            <div class="m-filterbar">
              <span>Filter: <b>{FILTER_LABEL[filter()]}</b> · {list().length} produk</span>
              <button class="btn text sm" onClick={() => setFilter('all')}>Hapus filter</button>
            </div>
          </Show>
          <div class="m-list">
            <For
              each={list().slice(0, 500)}
              fallback={
                <div class="m-empty">
                  <Show when={products().length} fallback={<><Icon name="inventory2" size={64} style={{ color: 'var(--m-primary)' }} /><b>Belum ada produk</b><span class="small">Tambah produk pertama Anda dengan tombol di bawah.</span></>}>
                    <Icon name="search" size={56} /><b>Tidak ada produk yang cocok.</b>
                  </Show>
                </div>
              }
            >
              {(p) => {
                const vs = () => varOf().get(p.id) ?? [];
                const ex = () => expiryStatus(p.expiryDate as number | null, Date.now());
                const price = () => (p.hasVariants === true && vs().length ? `mulai ${rp(Math.min(...vs().map((v) => Number(v.sellingPrice ?? 0))))}` : rp(Number(p.sellingPrice ?? 0)));
                return (
                  <button class="m-row m-row3" onClick={() => nav(`/produk/${p.id}`)}>
                    <span class="m-avatar lg"><Icon name="inventory2" /></span>
                    <span class="m-row-text">
                      <span class="m-row-title">{String(p.name)}</span>
                      <span class="m-row-sub">
                        {[catName().get(String(p.categoryId)), p.barcode, p.hasVariants === true ? `${vs().length} varian` : ''].filter(Boolean).join(' • ') || '—'}
                      </span>
                      <span class="m-row-line">
                        <span class="m-price">{p.needsPrice === true ? '—' : price()}</span>
                        <span class={`m-pill ${isLow(p) ? 'low' : ''}`}>Stok {num(stockOf(p))} {unitName().get(String(p.unitId)) ?? ''}</span>
                        <Show when={p.needsPrice === true}><span class="m-pill err">Perlu harga</span></Show>
                        <Show when={ex() === 'expired'}><span class="m-pill err">Kedaluwarsa</span></Show>
                        <Show when={ex() === 'nearExpiry'}><span class="m-pill low">Hampir kedaluwarsa</span></Show>
                      </span>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
          <Show when={list().length > 500}><p class="m-caption">Menampilkan 500 dari {list().length}. Perjelas pencarian.</p></Show>
          <Show when={can('addProduct')}>
            <button class="m-fab" onClick={() => nav('/produk/baru')}><Icon name="add" />Produk</button>
          </Show>
        </section>
      </Show>

      <Show when={params.id} keyed fallback={<aside class="split-detail mut empty">Pilih produk untuk mengubah, atau tambah produk baru.</aside>}>
        {(pid) => (
          <ProductEditor
            id={pid === 'baru' ? null : pid}
            categories={categories()}
            units={units()}
            variants={pid !== 'baru' ? varOf().get(pid) ?? [] : []}
            onDone={(id, m) => { if (m) say(m); nav(id ? `/produk/${id}` : '/produk'); void syncNow(); }}
            onAdjust={(product, variant) => setDlg({ kind: 'adjust', product, variant })}
          />
        )}
      </Show>

      <Show when={dlg()} keyed>
        {(d) => {
          const close = () => setDlg(null);
          switch (d.kind) {
            case 'adjust':
              return <AdjustDialog product={d.product} variant={d.variant} onClose={close} say={say} />;
            case 'stockin':
              return <StockInDialog products={products().filter((p) => live(p) && p.hasVariants !== true)} onClose={close} say={say} />;
            case 'cats':
              return <NamesDialog title="Kategori" rows={categories()} onSave={(id, name) => saveCategory(db()!, { id, name })} onDelete={(id) => deleteCategory(db()!, id)} onClose={close} />;
            case 'units':
              return <NamesDialog title="Satuan" rows={units()} onSave={(id, name) => saveUnit(db()!, { id, name })} onDelete={(id) => deleteUnit(db()!, id)} onClose={close} />;
          }
        }}
      </Show>
      <Toast msg={toast()} />
    </div>
  );
}

function ProductEditor(props: { id: string | null; categories: Row[]; units: Row[]; variants: Row[]; onDone: (id: string | null, msg?: string) => void; onAdjust: (p: Row, v?: Row) => void }) {
  const product = createLive(() => { const d = db(); return d ? { d, id: props.id } : null; }, async ({ d, id }) => (id ? (await d.t('products').get(id)) ?? null : null), null as Row | null);
  const tiers = createLive(() => { const d = db(); return d && props.id ? { d, id: props.id } : null; }, async ({ d, id }) => (await d.t('wholesale_prices').where('productId').equals(id).toArray()).filter(live).sort((a, b) => Number(a.minQty) - Number(b.minQty)), [] as Row[]);
  const logs = createLive(() => { const d = db(); return d && props.id ? { d, id: props.id } : null; }, async ({ d, id }) => (await d.t('stock_logs').where('productId').equals(id).toArray()).filter(live).sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, 30), [] as Row[]);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [hasVariants, setHasVariants] = createSignal<boolean | null>(null);
  const [cost, setCost] = createSignal<number | null>(null);
  const [sell, setSell] = createSignal<number | null>(null);
  const seeCost = () => can('viewCostProfit');
  const isNew = () => !props.id;
  const p = () => product();
  // Isian form = SALINAN saat dibuka (bukan data live): sinkron latar belakang tak menimpa ketikan.
  const [f, setF] = createSignal<Row | null>(null);
  createEffect(() => {
    const cur = p();
    if (cur && !untrack(f)) setF({ ...cur });
  });
  const hv = () => hasVariants() ?? p()?.hasVariants === true;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const d = db();
    if (!d) return;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const barcode = String(fd.get('barcode') ?? '').trim();
    setError('');
    setBusy(true);
    try {
      const owner = barcode ? await barcodeOwner(d, barcode, props.id ?? undefined) : null;
      if (owner) throw new PosError(`Barcode ini sudah dipakai "${owner}".`);
      const stockStr = String(fd.get('stock') ?? '');
      const stockVal = stockStr === '' ? null : parseInt(stockStr, 10);
      const input = {
        name: String(fd.get('name') ?? ''),
        barcode,
        categoryId: String(fd.get('categoryId') ?? '') || null,
        unitId: String(fd.get('unitId') ?? '') || null,
        costPrice: cost() ?? Number(f()?.costPrice ?? 0),
        sellingPrice: sell() ?? Number(f()?.sellingPrice ?? 0),
        stock: hv() ? null : isNew() ? stockVal ?? 0 : stockVal === Number(f()?.stock ?? 0) ? null : stockVal,
        minStock: fd.get('minStock') === '' ? null : parseInt(String(fd.get('minStock')), 10),
        expiryDate: fromDateInput(String(fd.get('expiry') ?? '')),
        hasVariants: hv(),
      };
      if (!input.name.trim()) throw new PosError('Nama produk wajib diisi.');
      if (isNew()) {
        const id = await createProduct(d, input);
        props.onDone(id, hv() ? 'Produk dibuat. Tambahkan variannya.' : 'Produk ditambahkan.');
      } else {
        await updateProduct(d, props.id!, input);
        setF({ ...((await d.t('products').get(props.id!)) ?? f()!) });
        props.onDone(props.id, 'Produk disimpan.');
      }
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Hapus "${p()?.name}"? Produk bisa dipulihkan dari daftar Terhapus.`)) return;
    await deleteProduct(db()!, props.id!);
    props.onDone(null, 'Produk dihapus.');
  };

  return (
    <aside class="split-detail">
      <Show when={isNew() || p()} fallback={<p class="mut">Memuat…</p>}>
        <div class="row-btns">
          <h2 style={{ margin: 0 }}>{isNew() ? 'Produk baru' : String(p()!.name)}</h2>
          <span class="spacer" />
          <button class="x" aria-label="Tutup" onClick={() => props.onDone(null)}>×</button>
        </div>
        <Show when={p()?.deletedAt != null}>
          <div class="alert warn">Produk ini terhapus. <button class="btn sm" onClick={async () => { await restoreProduct(db()!, props.id!); props.onDone(props.id, 'Produk dipulihkan.'); }}>Pulihkan</button></div>
        </Show>
        <Show when={error()}><div class="alert err" role="alert">{error()}</div></Show>
        <form onSubmit={submit} class="form-grid">
          <div class="field full"><label for="pn">Nama produk</label><input id="pn" name="name" required maxlength="160" value={String(f()?.name ?? '')} autofocus={isNew()} /></div>
          <div class="field full"><label for="pb">Barcode (opsional)</label><input id="pb" name="barcode" maxlength="64" value={String(f()?.barcode ?? '')} placeholder="Scan atau ketik" /></div>
          <div class="field"><label for="pc">Kategori</label>
            <select id="pc" name="categoryId"><option value="">Tanpa kategori</option><For each={props.categories}>{(c) => <option value={c.id} selected={f()?.categoryId === c.id}>{String(c.name)}</option>}</For></select>
          </div>
          <div class="field"><label for="pu">Satuan</label>
            <select id="pu" name="unitId"><option value="">Tanpa satuan</option><For each={props.units}>{(u) => <option value={u.id} selected={f()?.unitId === u.id}>{String(u.name)}</option>}</For></select>
          </div>
          <label class="full check"><input type="checkbox" checked={hv()} onChange={(e) => setHasVariants(e.currentTarget.checked)} /> Produk bervarian (ukuran/warna — harga & stok per varian)</label>
          <Show when={!hv()}>
            <div class="field"><label>Harga jual</label><MoneyInput value={sell() ?? Number(f()?.sellingPrice ?? 0)} onInput={setSell} /></div>
            <Show when={seeCost()}><div class="field"><label>Harga modal</label><MoneyInput value={cost() ?? Number(f()?.costPrice ?? 0)} onInput={setCost} /></div></Show>
            <div class="field"><label for="ps">{isNew() ? 'Stok awal' : 'Stok'}</label><input id="ps" name="stock" inputmode="numeric" value={isNew() ? '' : String(f()?.stock ?? 0)} placeholder="0" /></div>
          </Show>
          <div class="field"><label for="pm">Stok minimum</label><input id="pm" name="minStock" inputmode="numeric" value={f()?.minStock != null ? String(f()!.minStock) : ''} placeholder="—" /></div>
          <div class="field"><label for="pe">Kedaluwarsa</label><input id="pe" name="expiry" type="date" value={toDateInput(f()?.expiryDate)} /></div>
          <div class="row-btns full">
            <Show when={!isNew() && p()?.deletedAt == null}><button type="button" class="btn bad" onClick={remove}>Hapus</button></Show>
            <span class="spacer" />
            <button class="btn primary" disabled={busy()}>{busy() ? 'Menyimpan…' : 'Simpan'}</button>
          </div>
        </form>

        <Show when={!isNew() && p() && p()!.deletedAt == null}>
          <Show when={hv()}>
            <VariantsSection product={p()!} variants={props.variants} onAdjust={(v) => props.onAdjust(p()!, v)} />
          </Show>
          <WholesaleSection productId={props.id!} tiers={tiers()} />
          <Show when={!hv()}>
            <div class="sec"><div class="row-btns"><h3>Stok</h3><span class="spacer" /><button class="btn sm" onClick={() => props.onAdjust(p()!)}>Sesuaikan stok</button></div></div>
          </Show>
          <div class="sec">
            <h3>Arus stok terakhir</h3>
            <table class="list small">
              <tbody>
                <For each={logs()} fallback={<tr><td class="mut">Belum ada catatan stok.</td></tr>}>
                  {(l) => (
                    <tr>
                      <td>{fmtDateTime(Number(l.createdAt))}<div class="mut">{LOG_LABEL[String(l.type)] ?? String(l.type)}{l.variantId ? ` · ${props.variants.find((v) => v.id === l.variantId)?.name ?? 'varian'}` : ''}{l.note ? ` · ${l.note}` : ''}</div></td>
                      <td class={`num ${Number(l.qtyChange) < 0 ? 'bad-t' : ''}`}>{Number(l.qtyChange) > 0 ? '+' : ''}{num(Number(l.qtyChange))}</td>
                      <td class="num mut">→ {num(Number(l.stockAfter ?? 0))}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </aside>
  );
}

const LOG_LABEL: Record<string, string> = { initial: 'Stok awal', in: 'Stok masuk', out: 'Stok keluar', adjustment: 'Penyesuaian', sale: 'Penjualan', void: 'Batal jual' };

function VariantsSection(props: { product: Row; variants: Row[]; onAdjust: (v: Row) => void }) {
  const [edit, setEdit] = createSignal<Row | 'new' | null>(null);
  const [error, setError] = createSignal('');
  const [sell, setSell] = createSignal(0);
  const [cost, setCost] = createSignal(0);
  const open = (v: Row | 'new') => {
    setError('');
    setSell(v === 'new' ? 0 : Number(v.sellingPrice ?? 0));
    setCost(v === 'new' ? 0 : Number(v.costPrice ?? 0));
    setEdit(v);
  };
  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    const d = db();
    const v = edit();
    if (!d || !v) return;
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const barcode = String(f.get('barcode') ?? '').trim();
    try {
      const owner = barcode ? await barcodeOwner(d, barcode, undefined, v === 'new' ? undefined : v.id) : null;
      if (owner) throw new PosError(`Barcode ini sudah dipakai "${owner}".`);
      const stockStr = String(f.get('stock') ?? '');
      const stock = stockStr === '' ? null : parseInt(stockStr, 10);
      const input = { name: String(f.get('name') ?? ''), barcode, sellingPrice: sell(), costPrice: can('viewCostProfit') ? cost() : v === 'new' ? 0 : Number(v.costPrice ?? 0), stock };
      if (!input.name.trim()) throw new PosError('Nama varian wajib diisi.');
      if (v === 'new') await createVariant(d, props.product.id, { ...input, stock: stock ?? 0 });
      else await updateVariant(d, v.id, { ...input, stock: stock === Number(v.stock ?? 0) ? null : stock });
      setEdit(null);
      void syncNow();
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <div class="sec">
      <div class="row-btns"><h3>Varian</h3><span class="spacer" /><Show when={can('variantManagement')}><button class="btn sm" onClick={() => open('new')}>+ Varian</button></Show></div>
      <table class="list small hover">
        <tbody>
          <For each={[...props.variants].sort(byName)} fallback={<tr><td class="mut">Belum ada varian. Produk bervarian hanya bisa dijual lewat variannya.</td></tr>}>
            {(v) => (
              <tr onClick={() => can('variantManagement') && open(v)}>
                <td>{String(v.name)}<div class="mut">{String(v.barcode ?? '')}</div></td>
                <td class="num">{rp(Number(v.sellingPrice ?? 0))}</td>
                <td class="num">{num(Number(v.stock ?? 0))}</td>
                <td class="num"><button class="btn sm" onClick={(e) => { e.stopPropagation(); props.onAdjust(v); }}>Stok</button></td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={edit()} keyed>
        {(v) => (
          <Modal title={v === 'new' ? 'Varian baru' : `Ubah varian ${v.name}`} onClose={() => setEdit(null)}>
            <form onSubmit={save}>
              <Show when={error()}><div class="alert err">{error()}</div></Show>
              <div class="field"><label for="vn">Nama varian</label><input id="vn" name="name" required maxlength="80" value={v === 'new' ? '' : String(v.name)} autofocus placeholder="mis. L / Merah" /></div>
              <div class="field"><label for="vb">Barcode (opsional)</label><input id="vb" name="barcode" maxlength="64" value={v === 'new' ? '' : String(v.barcode ?? '')} /></div>
              <div class="field"><label>Harga jual</label><MoneyInput value={sell()} onInput={setSell} /></div>
              <Show when={can('viewCostProfit')}><div class="field"><label>Harga modal</label><MoneyInput value={cost()} onInput={setCost} /></div></Show>
              <div class="field"><label for="vs">{v === 'new' ? 'Stok awal' : 'Stok'}</label><input id="vs" name="stock" inputmode="numeric" value={v === 'new' ? '' : String(v.stock ?? 0)} placeholder="0" /></div>
              <div class="row-btns">
                <Show when={v !== 'new'}><button type="button" class="btn bad" onClick={async () => { if (v !== 'new' && confirm(`Hapus varian ${v.name}?`)) { await deleteVariant(db()!, v.id); setEdit(null); } }}>Hapus</button></Show>
                <span class="spacer" />
                <button class="btn primary">Simpan</button>
              </div>
            </form>
          </Modal>
        )}
      </Show>
    </div>
  );
}

function WholesaleSection(props: { productId: string; tiers: Row[] }) {
  const [minQty, setMinQty] = createSignal('');
  const [price, setPrice] = createSignal(0);
  const [error, setError] = createSignal('');
  const add = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      await saveWholesale(db()!, props.productId, { minQty: parseInt(minQty(), 10) || 0, price: price() });
      setMinQty('');
      setPrice(0);
      setError('');
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <div class="sec">
      <h3>Harga grosir</h3>
      <p class="small mut">Beli minimal sekian → harga per item jadi lebih murah (dipakai otomatis di kasir).</p>
      <For each={props.tiers}>
        {(t) => (
          <div class="row-btns tier">
            <span>Min. <b>{num(Number(t.minQty))}</b></span><span>{rp(Number(t.price))}/item</span>
            <span class="spacer" />
            <button class="btn sm bad" onClick={() => void deleteWholesale(db()!, t.id)}>Hapus</button>
          </div>
        )}
      </For>
      <form class="row-btns" onSubmit={add} style={{ 'margin-top': '8px' }}>
        <input class="mini" inputmode="numeric" placeholder="Min. qty" value={minQty()} onInput={(e) => setMinQty(e.currentTarget.value)} aria-label="Jumlah minimal" />
        <MoneyInput value={price()} onInput={setPrice} placeholder="Harga/item" class="mini" />
        <button class="btn sm">Tambah</button>
      </form>
      <Show when={error()}><p class="small bad-t">{error()}</p></Show>
    </div>
  );
}

function AdjustDialog(props: { product: Row; variant?: Row; onClose: () => void; say: (m: string) => void }) {
  const cur = () => Number((props.variant ?? props.product).stock ?? 0);
  const [qty, setQty] = createSignal(String(cur()));
  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    const n = parseInt(qty(), 10);
    if (!Number.isFinite(n)) return;
    const note = String(new FormData(e.currentTarget as HTMLFormElement).get('note') ?? '');
    const ch = await adjustStock(db()!, props.product.id, props.variant?.id ?? null, n, note);
    props.say(`Stok disesuaikan (${ch > 0 ? '+' : ''}${ch}).`);
    void syncNow();
    props.onClose();
  };
  return (
    <Modal title={`Sesuaikan stok — ${props.product.name}${props.variant ? ` (${props.variant.name})` : ''}`} onClose={props.onClose}>
      <form onSubmit={save}>
        <p class="small mut">Isi jumlah fisik sebenarnya. Selisihnya dicatat sebagai penyesuaian. Stok sekarang: <b>{num(cur())}</b></p>
        <div class="field"><label for="aq">Stok fisik</label><input id="aq" class="big-input" inputmode="numeric" value={qty()} onInput={(e) => setQty(e.currentTarget.value)} autofocus onFocus={(e) => e.currentTarget.select()} /></div>
        <div class="field"><label for="an">Catatan (opsional)</label><input id="an" name="note" maxlength="120" placeholder="mis. rusak, hilang, hitung ulang" /></div>
        <button class="btn primary block">Simpan</button>
      </form>
    </Modal>
  );
}

function StockInDialog(props: { products: Row[]; onClose: () => void; say: (m: string) => void }) {
  const [lines, setLines] = createSignal<Array<{ p: Row; qty: number }>>([]);
  const [q, setQ] = createSignal('');
  const [error, setError] = createSignal('');
  const found = createMemo(() => {
    const s = q().trim().toLowerCase();
    return s ? props.products.filter((p) => String(p.name).toLowerCase().includes(s) || String(p.barcode ?? '') === s).slice(0, 8) : [];
  });
  const add = (p: Row) => {
    const ex = lines().find((l) => l.p.id === p.id);
    setLines(ex ? lines().map((l) => (l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...lines(), { p, qty: 1 }]);
    setQ('');
  };
  const save = async () => {
    try {
      const r = await stockIn(db()!, lines().map((l) => ({ productId: l.p.id, qty: l.qty })));
      props.say(`Stok masuk tersimpan: ${r.updated} produk, ${num(r.totalQty)} item.`);
      void syncNow();
      props.onClose();
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <Modal title="Stok masuk" onClose={props.onClose} wide>
      <p class="small mut">Scan barcode atau cari produk, isi jumlah yang datang, lalu Simpan. (Produk bervarian: pakai "Stok" di variannya.)</p>
      <input
        class="pos-search"
        placeholder="Scan barcode / cari produk lalu Enter"
        autofocus
        value={q()}
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const exact = props.products.find((p) => String(p.barcode ?? '') === q().trim());
          const pick = exact ?? (found().length === 1 ? found()[0] : undefined);
          if (pick) add(pick);
          else setError(found().length ? 'Pilih produk dari daftar.' : 'Produk tidak ditemukan. Tambahkan dulu lewat "+ Produk".');
        }}
      />
      <div class="clist" style={{ 'max-height': '160px' }}>
        <For each={found()}>{(p) => <button class="crow" onClick={() => add(p)}><b>{String(p.name)}</b><span class="mut small">Stok {num(Number(p.stock ?? 0))}</span></button>}</For>
      </div>
      <Show when={error()}><p class="small bad-t">{error()}</p></Show>
      <table class="list" style={{ 'margin-top': '10px' }}>
        <tbody>
          <For each={lines()} fallback={<tr><td class="mut">Belum ada barang.</td></tr>}>
            {(l, i) => (
              <tr>
                <td>{String(l.p.name)}<div class="small mut">{num(Number(l.p.stock ?? 0))} → {num(Number(l.p.stock ?? 0) + l.qty)}</div></td>
                <td class="num"><input class="mini" inputmode="numeric" value={l.qty} onInput={(e) => setLines(lines().map((x, j) => (j === i() ? { ...x, qty: parseInt(e.currentTarget.value, 10) || 0 } : x)))} aria-label="Jumlah masuk" /></td>
                <td class="num"><button class="btn sm" onClick={() => setLines(lines().filter((_, j) => j !== i()))}>Hapus</button></td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <button class="btn primary block" style={{ 'margin-top': '12px' }} disabled={!lines().some((l) => l.qty > 0)} onClick={save}>Simpan stok masuk</button>
    </Modal>
  );
}

function NamesDialog(props: { title: string; rows: Row[]; onSave: (id: string | undefined, name: string) => Promise<unknown>; onDelete: (id: string) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = createSignal('');
  const add = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!name().trim()) return;
    await props.onSave(undefined, name());
    setName('');
    void syncNow();
  };
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <form class="row-btns" onSubmit={add}>
        <input class="pos-search" placeholder={`${props.title} baru`} value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus maxlength="60" />
        <button class="btn primary">Tambah</button>
      </form>
      <div class="clist">
        <For each={props.rows} fallback={<p class="mut">Belum ada.</p>}>
          {(r) => (
            <div class="crow">
              <input class="plain" value={String(r.name)} onChange={(e) => e.currentTarget.value.trim() && void props.onSave(r.id, e.currentTarget.value)} aria-label="Ubah nama" />
              <button class="btn sm bad" onClick={() => confirm(`Hapus "${r.name}"? Produk yang memakainya tidak ikut terhapus.`) && void props.onDelete(r.id)}>Hapus</button>
            </div>
          )}
        </For>
      </div>
    </Modal>
  );
}
