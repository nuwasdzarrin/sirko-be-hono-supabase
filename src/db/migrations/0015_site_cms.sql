-- 0015_site_cms — website publik sirkopos.com: halaman & artikel blog (dikelola dari dashboard),
-- plus pengalihan 301 otomatis saat slug berubah. 0013 dicadangkan untuk agen Juragan.

CREATE TABLE IF NOT EXISTS site_posts (
  id               uuid PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('post', 'page')),
  slug             text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text NOT NULL,
  meta_title       text NOT NULL DEFAULT '',
  meta_description text NOT NULL DEFAULT '',
  focus_keyword    text NOT NULL DEFAULT '',
  excerpt          text NOT NULL DEFAULT '',
  body_md          text NOT NULL DEFAULT '',
  cover_url        text,
  cover_alt        text NOT NULL DEFAULT '',
  category         text NOT NULL DEFAULT '',
  tags             text[] NOT NULL DEFAULT '{}',
  -- draft = tak tampil; published = tampil sejak published_at (masa depan = terjadwal).
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  noindex          boolean NOT NULL DEFAULT false,
  author           text NOT NULL DEFAULT 'Tim Sirko',
  published_at     bigint,
  created_at       bigint NOT NULL,
  updated_at       bigint NOT NULL,
  deleted_at       bigint
);

-- Satu slug per jenis (halaman /<slug>, artikel /blog/<slug>), abaikan yang dihapus.
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_posts_slug ON site_posts (kind, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_site_posts_pub ON site_posts (kind, status, published_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS site_redirects (
  from_path  text PRIMARY KEY,
  to_path    text NOT NULL,
  created_at bigint NOT NULL
);

-- Formulir publik situs: daftar tunggu (sebelum rilis Play Store), kontak, & permintaan hapus akun
-- (Google Play mewajibkan jalur hapus akun lewat web tanpa memasang aplikasi).
CREATE TABLE IF NOT EXISTS site_leads (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('waitlist', 'contact', 'delete_account')),
  name        text NOT NULL DEFAULT '',
  contact     text NOT NULL,              -- email atau nomor WA
  store_type  text NOT NULL DEFAULT '',
  message     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  ip          text,
  created_at  bigint NOT NULL,
  handled_at  bigint,
  handled_by  text
);
CREATE INDEX IF NOT EXISTS idx_site_leads_new ON site_leads (status, created_at DESC);

-- Riwayat revisi konten (versi sebelum tiap simpan; 30 terakhir per konten).
CREATE TABLE IF NOT EXISTS site_post_revisions (
  id          uuid PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES site_posts (id) ON DELETE CASCADE,
  snapshot    jsonb NOT NULL,
  created_by  text NOT NULL DEFAULT '',
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_rev_post ON site_post_revisions (post_id, created_at DESC);
