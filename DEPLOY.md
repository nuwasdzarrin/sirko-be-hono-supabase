# Deploy — Vercel + Supabase (produksi)

Runbook produksi backend Sirko. Urutan: **Supabase → migrasi → env Vercel → deploy → verifikasi**.
Repo GitHub (`nuwasdzarrin/sirko-be-hono-supabase`) **= root backend** (bukan monorepo),
jadi Root Directory Vercel = `./`.

> Prinsip portabilitas tetap berlaku: yang mengikat ke Supabase hanyalah **string koneksi
> Postgres + kredensial S3**. Pindah ke VPS = ganti env ini, kode tak berubah.

---

## 0. Prasyarat
- Akun Supabase & Vercel.
- Repo sudah ter-push ke GitHub.
- Node ≥ 20.6 di mesin lokal (untuk menjalankan migrasi).

---

## 1. Siapkan Supabase (dipakai HANYA sebagai Postgres + Storage S3)

1. **Buat project** di https://supabase.com → catat **Database password** (muncul sekali).
2. **Connection strings** — Project Settings → **Database** → *Connection string*:
   - **Runtime (WAJIB pooled)** → tab **Transaction / pooler**, port **6543**:
     ```
     postgresql://postgres.<REF>:<PWD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres?sslmode=require
     ```
     Ini yang dipakai app di Vercel (serverless → butuh Supavisor + `prepare:false`, sudah diset di kode).
   - **Migrasi (direct / session)** → tab **Session pooler** atau **Direct**, port **5432**:
     ```
     postgresql://postgres:<PWD>@db.<REF>.supabase.co:5432/postgres?sslmode=require
     ```
     Dipakai **hanya** saat menjalankan migrasi (DDL/CREATE EXTENSION/DO-block lebih andal di 5432,
     bukan transaction-pooler 6543).
   > Pastikan ada `?sslmode=require` (Supabase mewajibkan SSL; postgres.js menghormati param ini).
3. **Storage (S3-compatible)**:
   - Storage → **New bucket** → nama `sirko-media` → centang **Public** (agar `publicUrl` bisa diakses).
   - Storage → **Settings → S3 Connection** → aktifkan, **generate** *Access Key ID* & *Secret*, catat **Region**.
   - Endpoint S3: `https://<REF>.supabase.co/storage/v1/s3`
   - Public base: `https://<REF>.supabase.co/storage/v1/object/public/sirko-media`

---

## 2. Migrasi skema ke Postgres produksi (dari lokal)

Buat file kredensial **lokal & gitignored** (`.env.production.local` — sudah di-`.gitignore`).
Pakai koneksi **5432**. `APP_ENV=development` di sini agar validasi S3 tak diminta (migrasi tak butuh S3).
`JWT_*` cukup dummy ≥32 char (tak dipakai migrasi, tapi divalidasi saat boot).

```bash
cd sirko-backend

cat > .env.production.local <<'EOF'
DATABASE_URL=postgresql://postgres:<PWD>@db.<REF>.supabase.co:5432/postgres?sslmode=require
JWT_SECRET=dummy-untuk-migrasi-minimal-32-karakter-xxxxx
JWT_REFRESH_SECRET=dummy-untuk-migrasi-minimal-32-karakter-yyyyy
APP_ENV=development
EOF

npm install
npm run migrate:prod
```

Output diharapkan:
```
→ apply  0001_init ...        ✓ done
→ apply  0002_tenant_backup_tables ...  ✓ done
→ apply  0003_catalog ...     ✓ done
Selesai: 3 migrasi diterapkan.
```
Idempotent — aman diulang (migrasi yang sudah ada di-skip). **Hapus `.env.production.local`** setelah selesai bila tak ingin menyimpan kredensial DB di disk.

---

## 3. Set Environment Variables di Vercel

Project → **Settings → Environment Variables** (scope **Production**):

| Key | Nilai |
|---|---|
| `DATABASE_URL` | string **pooled 6543** + `?sslmode=require` (langkah 1) |
| `JWT_SECRET` | acak kuat — `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | acak kuat lain — `openssl rand -base64 48` |
| `S3_ENDPOINT` | `https://<REF>.supabase.co/storage/v1/s3` |
| `S3_REGION` | region dari Supabase (mis. `ap-southeast-1`) |
| `S3_BUCKET` | `sirko-media` |
| `S3_ACCESS_KEY_ID` | dari S3 Connection |
| `S3_SECRET_ACCESS_KEY` | dari S3 Connection |
| `S3_PUBLIC_BASE_URL` | `https://<REF>.supabase.co/storage/v1/object/public/sirko-media` |
| `APP_ENV` | `production` |
| `DASHBOARD_USER` | user Basic Auth untuk `/dashboard` (opsional tapi **disarankan** di produksi) |
| `DASHBOARD_PASSWORD` | password Basic Auth `/dashboard` |

> `APP_ENV=production` membuat `config/env.ts` **mewajibkan** semua `S3_*` lengkap (gagal-cepat bila kurang).
> Bila `DASHBOARD_USER`/`DASHBOARD_PASSWORD` kosong, `/dashboard` **terbuka** — di produksi sebaiknya diisi.

---

## 4. Deploy ke Vercel

1. **Add New… → Project** → import repo `nuwasdzarrin/sirko-be-hono-supabase`.
2. **Root Directory**: `./` (repo ini sudah = folder backend).
3. **Framework Preset**: **Other**.
4. **Build Command**: kosongkan · **Install Command**: `npm install` · **Output**: default.
   (Tak ada build step — `@vercel/node` mengompilasi fungsi `api/[[...route]].ts` langsung.)
5. Pastikan Env Vars (langkah 3) sudah terisi → **Deploy**.
6. `vercel.json` sudah mengatur:
   - **catch-all** semua path → fungsi Hono,
   - **Cron harian** `GET /v1/health` (anti idle-pause Supabase).

---

## 5. Verifikasi pasca-deploy

Ganti `HOST` dengan domain Vercel (mis. `https://sirko-be.vercel.app`).

```bash
HOST=https://<app>.vercel.app

# health (juga dipakai cron)
curl -s $HOST/v1/health          # → {"data":{"status":"ok","db":"ok","serverTime":...}}

# register → login → me
curl -sX POST $HOST/v1/auth/register-business -H 'content-type: application/json' \
  -d '{"business":{"name":"Toko Uji"},"owner":{"name":"Budi","email":"budi@toko.id","password":"rahasia123"}}'
# simpan accessToken lalu:
curl -s $HOST/v1/me -H "Authorization: Bearer <TOKEN>"

# katalog lookup (kosong → 404) & backup status
curl -s "$HOST/v1/catalog/lookup?barcode=999" -H "Authorization: Bearer <TOKEN>"   # → 404
curl -s $HOST/v1/backup/status -H "Authorization: Bearer <TOKEN>"                   # → counts + serverTime
```

`db":"ok"` di `/v1/health` menandakan koneksi pooled ke Supabase sukses.

---

## 6. Troubleshooting cepat
- **`/v1/health` → `db":"down"`**: `DATABASE_URL` salah / bukan pooler 6543 / kurang `sslmode=require`.
- **500 di endpoint tulis media**: `S3_*` belum lengkap (padahal `APP_ENV=production`).
- **Error koneksi Postgres saat trafik naik**: memakai `5432` langsung, bukan pooler `6543`.
- **Migrasi gagal di 6543**: jalankan migrasi via `5432` (langkah 2), bukan transaction pooler.
- **Supabase ke-pause**: pastikan Cron `/v1/health` aktif (Vercel → Deployments → Crons).

---

## 7. Rilis berikutnya
- Push ke `main` → Vercel auto-deploy.
- Bila ada migrasi baru (`00xx_*.sql`) → jalankan `npm run migrate:prod` **sebelum** trafik memakai skema baru (migrasi tidak otomatis saat deploy).
