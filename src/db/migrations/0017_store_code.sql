-- 0017_store_code — kode toko per akun pemilik (J12: nomor invoice `INV-<kode>-YYYYMMDD-NNNN`).
-- Toko pertama akun = A, berikutnya B, C, … Z, AA, AB, … Kode tak pernah berubah dan tak dipakai
-- ulang walau tokonya dihapus (invoice lama tetap unik di laporan gabungan). Dibagikan server agar
-- sama di semua HP (HP kasir toko cabang tak tahu dirinya toko ke berapa). Kolom ini TIDAK ada di
-- daftar kolom backup, jadi push dari app tak pernah menimpanya.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS store_code text;

-- Isi toko yang sudah ada: urut waktu dibuat per akun pemilik (termasuk toko terhapus).
WITH owner_of AS (
  SELECT DISTINCT ON (b.id) b.id, u.account_id, b.created_at
  FROM businesses b
  JOIN users u ON u.business_id = b.id AND u.role = 'owner' AND u.account_id IS NOT NULL
  ORDER BY b.id, u.created_at
),
numbered AS (
  SELECT id, row_number() OVER (PARTITION BY account_id ORDER BY created_at, id) AS n FROM owner_of
)
UPDATE businesses b
SET store_code = CASE
    WHEN x.n <= 26 THEN chr((64 + x.n)::int)
    ELSE chr((64 + (x.n - 1) / 26)::int) || chr((65 + (x.n - 1) % 26)::int)
  END
FROM numbered x
WHERE x.id = b.id AND b.store_code IS NULL;

-- Toko tanpa akun pemilik cloud (data lama) → A.
UPDATE businesses SET store_code = 'A' WHERE store_code IS NULL;

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_store_code_check;
ALTER TABLE businesses ADD CONSTRAINT businesses_store_code_check CHECK (store_code IS NULL OR store_code ~ '^[A-Z]{1,2}$');
