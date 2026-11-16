-- 0016_site_leads_spam — status "spam" untuk pesan formulir situs yang tersaring (jebakan waktu /
-- saringan isi). Disimpan tanpa notifikasi Telegram; admin bisa memulihkan di dashboard.

ALTER TABLE site_leads DROP CONSTRAINT IF EXISTS site_leads_status_check;
ALTER TABLE site_leads ADD CONSTRAINT site_leads_status_check CHECK (status IN ('new', 'done', 'spam'));
ALTER TABLE site_leads ADD COLUMN IF NOT EXISTS spam_reason text;
