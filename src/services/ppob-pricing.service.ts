import { z } from 'zod';
import { sql } from '../db/client.js';
import { nowMs } from '../lib/time.js';
import { forbidden } from '../lib/errors.js';
import type { Role } from '../lib/permissions.js';

/**
 * Aturan harga JUAL PPOB per toko (SPEC-warung-akun-ppob.md §4): untung per kategori,
 * dibulatkan ke atas kelipatan `rounding`, boleh harga khusus per produk.
 * Harga jual = harga ke PEMBELI warung (bukan Poin). Poin yang dipotong tetap `price`.
 * Disimpan di server per toko agar ikut ke HP baru.
 */

export type PpobCategory = 'pulsa' | 'data' | 'pln';
export const ROUNDING_OPTIONS = [100, 500, 1000] as const;

export interface StorePricing {
  markups: Record<PpobCategory, number>;
  rounding: number;
  overrides: Array<{ productId: string; sellPrice: number }>;
  /** true = belum pernah diatur pemilik (nilai bawaan). */
  isDefault: boolean;
  updatedAt: number | null;
}

/** Nilai bawaan bila pemilik belum mengatur (keputusan default — bisa diubah pemilik produk). */
export const DEFAULT_PRICING: Omit<StorePricing, 'isDefault' | 'updatedAt'> = {
  markups: { pulsa: 2000, data: 2000, pln: 2000 },
  rounding: 500,
  overrides: [],
};

export async function getPricing(businessId: string): Promise<StorePricing> {
  const [row, ov] = await Promise.all([
    sql<{ markups: Partial<Record<PpobCategory, number>>; rounding: number; updated_at: string }[]>`
      SELECT markups, rounding, updated_at FROM ppob_store_pricing WHERE business_id = ${businessId}`,
    sql<{ product_id: string; sell_price: string }[]>`
      SELECT o.product_id, o.sell_price FROM ppob_store_price_overrides o
      JOIN ppob_products p ON p.id = o.product_id
      WHERE o.business_id = ${businessId} ORDER BY p.category, p.brand, p.sell_price`,
  ]);
  const r = row[0];
  return {
    markups: { ...DEFAULT_PRICING.markups, ...(r?.markups ?? {}) },
    rounding: r?.rounding ?? DEFAULT_PRICING.rounding,
    overrides: ov.map((o) => ({ productId: o.product_id, sellPrice: Number(o.sell_price) })),
    isDefault: !r,
    updatedAt: r ? Number(r.updated_at) : null,
  };
}

/** Harga jual terhitung untuk satu produk. */
export function sellPriceOf(p: { id: string; category: string; price: number }, pr: StorePricing): {
  sellPrice: number;
  margin: number;
  customPrice: boolean;
} {
  const ov = pr.overrides.find((o) => o.productId === p.id);
  const markup = pr.markups[p.category as PpobCategory] ?? 0;
  const sellPrice = ov ? ov.sellPrice : Math.ceil((p.price + markup) / pr.rounding) * pr.rounding;
  return { sellPrice, margin: sellPrice - p.price, customPrice: Boolean(ov) };
}

const money = z.number().int('Harus bilangan bulat').min(0, 'Tidak boleh negatif').max(10_000_000);

export const pricingSchema = z.object({
  markups: z.object({ pulsa: money, data: money, pln: money }),
  rounding: z
    .number()
    .int()
    .refine((v) => (ROUNDING_OPTIONS as readonly number[]).includes(v), 'Pembulatan harus 100, 500, atau 1000'),
  /** Daftar LENGKAP harga khusus (menggantikan yang lama). Kosong = hapus semua. */
  overrides: z
    .array(z.object({ productId: z.string().uuid(), sellPrice: z.number().int().min(1).max(100_000_000) }))
    .max(1000)
    .default([]),
});

export interface PricingWarning {
  productId: string;
  productName: string;
  price: number;
  sellPrice: number;
  message: string;
}

/** Simpan aturan harga toko (owner/admin). Harga khusus di bawah modal tetap disimpan + peringatan. */
export async function putPricing(
  auth: { businessId: string; role: Role },
  input: z.infer<typeof pricingSchema>,
): Promise<StorePricing & { warnings: PricingWarning[] }> {
  if (auth.role !== 'owner' && auth.role !== 'admin') throw forbidden('Hanya pemilik/admin toko yang bisa mengatur harga PPOB.');
  const ids = [...new Set(input.overrides.map((o) => o.productId))];
  const products = ids.length
    ? await sql<{ id: string; name: string; sell_price: string }[]>`SELECT id, name, sell_price FROM ppob_products WHERE id = ANY(${ids}::uuid[])`
    : [];
  const known = new Map(products.map((p) => [p.id, p]));
  const overrides = input.overrides.filter((o) => known.has(o.productId)); // produk tak dikenal diabaikan
  const ts = nowMs();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO ppob_store_pricing (business_id, markups, rounding, updated_by, updated_at)
      VALUES (${auth.businessId}, ${tx.json(input.markups)}, ${input.rounding}, ${auth.role}, ${ts})
      ON CONFLICT (business_id) DO UPDATE SET markups = EXCLUDED.markups, rounding = EXCLUDED.rounding,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
    await tx`DELETE FROM ppob_store_price_overrides WHERE business_id = ${auth.businessId}`;
    if (overrides.length) {
      await tx`INSERT INTO ppob_store_price_overrides ${tx(
        [...new Map(overrides.map((o) => [o.productId, o])).values()].map((o) => ({
          business_id: auth.businessId,
          product_id: o.productId,
          sell_price: o.sellPrice,
          updated_at: ts,
        })),
      )}`;
    }
  });
  const warnings: PricingWarning[] = overrides
    .filter((o) => o.sellPrice < Number(known.get(o.productId)!.sell_price))
    .map((o) => {
      const p = known.get(o.productId)!;
      return {
        productId: o.productId,
        productName: p.name,
        price: Number(p.sell_price),
        sellPrice: o.sellPrice,
        message: `Harga jual ${p.name} di bawah modal (rugi Rp${new Intl.NumberFormat('id-ID').format(Number(p.sell_price) - o.sellPrice)}).`,
      };
    });
  return { ...(await getPricing(auth.businessId)), warnings };
}
