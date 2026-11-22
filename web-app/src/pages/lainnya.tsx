import { For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Icon, type IconName } from '../ui/icon';
import type { Permission } from '../lib/permissions';
import { can, hasFeature, lockToUserPicker, session, user } from '../state';
import { confirmLogout } from './shell';

/**
 * Halaman "Lainnya" — sama dengan MorePage aplikasi HP: kartu pengguna, kartu pemilik (Paket
 * Juragan, Poin Sirko, Toko Saya), grid menu 3 kolom, bantuan, tombol Keluar, logo.
 * Item yang belum ada di web (Katalog Umum, Shift/Bill terpisah) tidak ditampilkan.
 */
interface Item {
  path: string;
  label: string;
  icon: IconName;
  perm?: Permission;
}

const GRID: Item[] = [
  { path: '/transaksi', label: 'Riwayat Transaksi', icon: 'receiptLong', perm: 'transactionList' },
  { path: '/pelanggan', label: 'Pelanggan', icon: 'peopleAlt', perm: 'customerManagement' },
  { path: '/kas', label: 'Kas / Wallet', icon: 'wallet', perm: 'walletView' },
  { path: '/pembelian/supplier', label: 'Supplier', icon: 'storefront', perm: 'productManagement' },
  { path: '/pembelian', label: 'Pembelian', icon: 'localShipping', perm: 'productManagement' },
  { path: '/pembelian/opname', label: 'Stok Opname', icon: 'factCheck', perm: 'productManagement' },
  { path: '/karyawan', label: 'Karyawan', icon: 'manageAccounts', perm: 'userService' },
  { path: '/data', label: 'Sinkronisasi', icon: 'cloudSync', perm: 'settingCompany' },
  { path: '/pengaturan', label: 'Pengaturan', icon: 'settings', perm: 'settingCompany' },
];

function CardTile(props: { href: string; icon: IconName; title: string; sub: string; external?: boolean }) {
  return (
    <Show
      when={!props.external}
      fallback={
        <a class="m-card m-tile" href={props.href} target="_blank" rel="noopener">
          <Icon name={props.icon} class="lead" />
          <span class="m-tile-text"><b>{props.title}</b><span>{props.sub}</span></span>
          <Icon name="chevronRight" class="trail" />
        </a>
      }
    >
      <A class="m-card m-tile" href={props.href}>
        <Icon name={props.icon} class="lead" />
        <span class="m-tile-text"><b>{props.title}</b><span>{props.sub}</span></span>
        <Icon name="chevronRight" class="trail" />
      </A>
    </Show>
  );
}

export function LainnyaPage() {
  const nav = useNavigate();
  const u = () => user();
  const owner = () => !!u()?.isOwner;
  const juraganActive = () => session()?.plan?.name === 'juragan';
  return (
    <div class="m-more">
      <div class="m-card m-tile">
        <span class="m-avatar">{(u()?.name ?? '?').trim().charAt(0).toUpperCase()}</span>
        <span class="m-tile-text"><b>{u()?.name}</b><span>Masuk sebagai {owner() ? 'owner' : u()?.role}</span></span>
      </div>
      <Show when={owner()}>
        <CardTile
          href="/langganan"
          icon="workspacePremium"
          title="Paket Juragan"
          sub={juraganActive() ? 'Aktif — lihat atau perpanjang' : 'Multi-cabang, karyawan, laporan Excel/PDF, logo struk'}
        />
        <CardTile href="/ppob/poin" icon="bolt" title="Poin Sirko" sub="Saldo, top-up & mutasi Poin untuk PPOB" />
        <CardTile href="/toko" icon="storefront" title="Toko Saya" sub="Pindah toko, tambah cabang, laporan gabungan" />
      </Show>

      <div class="m-grid">
        <For each={GRID.filter((i) => !i.perm || can(i.perm))}>
          {(i) => (
            <A class="m-grid-tile" href={i.path} end>
              <Icon name={i.icon} size={30} />
              <span>{i.label}</span>
            </A>
          )}
        </For>
      </div>

      <CardTile href="/kontak" icon="supportAgent" title="Hubungi Bantuan" sub="Chat WhatsApp Layanan Admin Sirko" external />

      <Show when={hasFeature('staff')}>
        <button class="m-tonal" onClick={async () => { await lockToUserPicker(); nav('/pengguna'); }}>
          <Icon name="switchAccount" size={18} /> Ganti pengguna
        </button>
      </Show>
      <Show when={owner()}>
        <button class="m-tonal" onClick={() => void confirmLogout(nav)}>
          <Icon name="logout" size={18} /> Keluar
        </button>
      </Show>

      <div class="m-brand">
        <img src="/app/lockup.png" alt="Sirko" />
        <span>Sirko Web</span>
      </div>
    </div>
  );
}
