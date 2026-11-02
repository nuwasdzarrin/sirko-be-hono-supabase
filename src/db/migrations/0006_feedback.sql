-- 0006_feedback.sql — Saran dari pengguna app Sirko (ditinjau admin di dashboard).
--
-- Tabel server-only (BUKAN cermin backup): dikirim app via POST /v1/feedback,
-- business_id & user_id dari JWT. Status ditindaklanjuti admin.
-- Waktu = bigint epoch ms. Idempotent (IF NOT EXISTS) & maju-saja.

CREATE TABLE IF NOT EXISTS feedback (
  id           uuid PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id      uuid,
  user_name    text,                       -- snapshot nama pengirim
  category     text NOT NULL DEFAULT 'saran'
                 CHECK (category IN ('saran', 'masalah', 'pertanyaan', 'lainnya')),
  message      text NOT NULL,
  contact      text,                       -- opsional: WA/email bila ingin dihubungi
  app_version  text,
  platform     text,
  status       text NOT NULL DEFAULT 'baru'
                 CHECK (status IN ('baru', 'dibaca', 'diproses', 'selesai', 'ditolak')),
  admin_note   text,
  handled_by   text,
  handled_at   bigint,
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_business ON feedback (business_id, created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON feedback;
CREATE POLICY tenant_isolation ON feedback
  USING (business_id::text = current_setting('app.business_id', true));
