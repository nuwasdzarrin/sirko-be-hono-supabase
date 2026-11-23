import { For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Icon, type IconName } from '../ui/icon';
import { allowed, MORE, OWNER } from '../ui/nav';
import { can, hasFeature, lockToUserPicker, session, user } from '../state';
import { confirmLogout } from './shell';

/**
 * Halaman "Lainnya" (HP) — sama dengan MorePage aplikasi: kartu pengguna, kartu pemilik, grid menu
 * 3 kolom, bantuan, Keluar, logo. Menu dari ui/nav.ts (sumber yang sama dengan sidebar desktop).
 */
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
      <For each={OWNER.filter((i) => allowed(i, can, owner()))}>
        {(i) => (
          <CardTile
            href={i.path}
            icon={i.icon}
            title={i.label}
            sub={i.path === '/langganan' && juraganActive() ? 'Aktif — lihat atau perpanjang' : i.sub ?? ''}
          />
        )}
      </For>

      <div class="m-grid">
        <For each={MORE.filter((i) => allowed(i, can, owner()))}>
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
