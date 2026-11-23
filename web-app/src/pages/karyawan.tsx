import { createSignal, For, Show } from 'solid-js';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { can, db, hasFeature, syncNow, user } from '../state';
import { decodePermissions, PERMISSION_LABEL, PERMISSIONS, ROLE_DEFAULTS, type Permission } from '../lib/permissions';
import { PosError } from '../pos/repo';
import { deleteUser, MIN_PIN, saveUser, type UserInput } from '../manage/repo';
import { Modal, Toast } from './ui';

/** Karyawan & PIN (sama dengan Users page HP): tambah butuh Paket Juragan + izin addUser. */

const ROLE_LABEL: Record<string, string> = { owner: 'Pemilik', admin: 'Admin', cashier: 'Kasir', staff: 'Staf gudang', custom: 'Khusus' };
const ROLES: UserInput['role'][] = ['admin', 'cashier', 'staff', 'custom'];

export function KaryawanPage() {
  const users = createLive(db, async (d) => (await d.t('users').toArray()).filter((u) => u.deletedAt == null && u.role !== 'sirko_admin').sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : String(a.name).localeCompare(String(b.name)))), [] as Row[]);
  const [edit, setEdit] = createSignal<Row | 'new' | null>(null);
  const [toast, setToast] = createSignal('');
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  };
  const juragan = () => hasFeature('staff');

  return (
    <>
      <div class="row-btns">
        <h1 style={{ margin: 0 }}>Karyawan</h1>
        <span class="spacer" />
        <Show when={can('addUser')}>
          <button class="btn primary" disabled={!juragan()} title={juragan() ? '' : 'Butuh Paket Juragan'} onClick={() => setEdit('new')}>+ Karyawan</button>
        </Show>
      </div>
      <Show when={!juragan()}>
        <div class="alert warn" style={{ 'margin-top': '12px' }}>Akun karyawan (masuk dengan PIN) adalah fitur <b>Paket Juragan</b>. Langganan lewat aplikasi Sirko di HP (menu Langganan).</div>
      </Show>
      <p class="mut small">Karyawan masuk di komputer ini lewat tombol "Ganti pengguna" lalu memilih nama & mengetik PIN.</p>
      <div class="m-list">
          <For each={users()}>
            {(u) => (
              <button class="m-row" onClick={() => can('userService') && setEdit(u)}>
                <span class="m-avatar">{String(u.name ?? '?').trim().charAt(0).toUpperCase()}</span>
                <span class="m-row-text">
                  <span class="m-row-title">{String(u.name)}{u.id === user()?.id ? ' (Anda)' : ''}</span>
                  <span class="m-row-sub">{ROLE_LABEL[String(u.role)] ?? String(u.role)}{u.username ? ` • ${String(u.username)}` : ''}</span>
                </span>
                <span class={`m-pill ${u.isActive === false ? 'low' : ''}`}>{u.isActive === false ? 'Nonaktif' : 'Aktif'}</span>
              </button>
            )}
          </For>
        </div>
      <Show when={edit()} keyed>
        {(u) => <UserForm user={u === 'new' ? null : u} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); say(m); void syncNow(); }} />}
      </Show>
      <Toast msg={toast()} />
    </>
  );
}

function UserForm(props: { user: Row | null; onClose: () => void; onSaved: (m: string) => void }) {
  const u = props.user;
  const isOwner = u?.role === 'owner';
  const [role, setRole] = createSignal<UserInput['role']>((u && u.role !== 'owner' ? u.role : 'cashier') as UserInput['role']);
  const [perms, setPerms] = createSignal<Set<Permission>>(u?.role === 'custom' ? decodePermissions(u.permissions) : new Set());
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const toggle = (p: Permission, on: boolean) => {
    const s = new Set(perms());
    if (on) s.add(p);
    else s.delete(p);
    setPerms(s);
  };
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const pin = String(f.get('pin') ?? '');
    setError('');
    if (pin !== String(f.get('pin2') ?? '')) return setError('PIN tidak sama.');
    setBusy(true);
    try {
      await saveUser(db()!, u?.id ?? null, {
        name: String(f.get('name') ?? ''),
        username: isOwner ? String(u!.username) : String(f.get('username') ?? ''),
        role: role(),
        permissions: perms(),
        isActive: isOwner ? true : f.get('active') === 'on',
        pin: isOwner ? '' : pin,
      });
      props.onSaved(u ? 'Data karyawan disimpan.' : 'Karyawan ditambahkan.');
    } catch (err) {
      setError(err instanceof PosError ? err.message : `Gagal: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!u || !confirm(`Hapus akun ${u.name}?`)) return;
    try {
      await deleteUser(db()!, u.id);
      props.onSaved('Akun dihapus.');
    } catch (err) {
      setError(err instanceof PosError ? err.message : String(err));
    }
  };
  return (
    <Modal title={u ? `Ubah ${u.name}` : 'Karyawan baru'} onClose={props.onClose} wide>
      <form onSubmit={submit} class="form-grid">
        <Show when={error()}><div class="alert err full">{error()}</div></Show>
        <div class="field"><label for="un">Nama</label><input id="un" name="name" required maxlength="80" value={String(u?.name ?? '')} autofocus /></div>
        <div class="field"><label for="uu">Username</label><input id="uu" name="username" required maxlength="40" value={String(u?.username ?? '')} disabled={isOwner} autocomplete="off" /></div>
        <Show when={!isOwner} fallback={<p class="small mut full">Akun pemilik: hanya nama yang bisa diubah. Pemilik masuk dengan password akun.</p>}>
          <div class="field"><label for="ur">Peran</label>
            <select id="ur" value={role()} onChange={(e) => setRole(e.currentTarget.value as UserInput['role'])}>
              <For each={ROLES}>{(r) => <option value={r}>{ROLE_LABEL[r]}</option>}</For>
            </select>
          </div>
          <label class="check" style={{ 'align-self': 'end' }}><input type="checkbox" name="active" checked={u ? u.isActive !== false : true} /> Aktif (boleh masuk)</label>
          <div class="full perm-box">
            <Show
              when={role() === 'custom'}
              fallback={<p class="small mut">Hak akses {ROLE_LABEL[role()]}: {(ROLE_DEFAULTS[role() as 'admin' | 'cashier' | 'staff'] ?? []).map((p) => PERMISSION_LABEL[p]).join(', ')}.</p>}
            >
              <p class="small"><b>Pilih hak akses:</b></p>
              <div class="perm-grid">
                <For each={PERMISSIONS}>{(p) => <label class="check small"><input type="checkbox" checked={perms().has(p)} onChange={(e) => toggle(p, e.currentTarget.checked)} /> {PERMISSION_LABEL[p]}</label>}</For>
              </div>
            </Show>
          </div>
          <div class="field"><label for="up">{u ? 'PIN baru (kosongkan bila tetap)' : `PIN (min. ${MIN_PIN} angka)`}</label><input id="up" name="pin" type="password" inputmode="numeric" autocomplete="new-password" required={!u} minlength={MIN_PIN} maxlength="12" pattern="\d*" /></div>
          <div class="field"><label for="up2">Ulangi PIN</label><input id="up2" name="pin2" type="password" inputmode="numeric" autocomplete="new-password" required={!u} maxlength="12" pattern="\d*" /></div>
        </Show>
        <div class="row-btns full">
          <Show when={u && !isOwner}><button type="button" class="btn bad" onClick={remove}>Hapus akun</button></Show>
          <span class="spacer" />
          <button class="btn primary" disabled={busy()}>{busy() ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  );
}
