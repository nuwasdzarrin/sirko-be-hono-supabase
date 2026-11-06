import { z } from 'zod';

/** Skema request auth (spec 10 §1). Validasi ketat; invalid → 422 VALIDATION. */

const emailSchema = z.string().trim().toLowerCase().email().max(255);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+][0-9]{6,19}$/, 'Nomor telepon tidak valid');
const passwordSchema = z.string().min(6, 'Password minimal 6 karakter').max(200);


export const loginSchema = z
  .object({
    /** Email ATAU nomor WA (akun pemilik baru). */
    login: z.string().trim().min(1).max(255).optional(),
    /** Nama field lama (app ≤ 1.2.x) — setara `login`. */
    emailOrPhone: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(1).max(200),
    /** Juragan: toko yang ingin dibuka (harus anggota). Opsional. */
    businessId: z.string().uuid().optional().nullable(),
  })
  .refine((o) => o.login || o.emailOrPhone, { message: 'Isi email atau nomor WA', path: ['login'] })
  .transform((o) => ({ ...o, emailOrPhone: (o.login ?? o.emailOrPhone)! }));
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

// ── Juragan (multi-toko) ──

export const switchBusinessSchema = z.object({
  businessId: z.string().uuid(),
});
export type SwitchBusinessInput = z.infer<typeof switchBusinessSchema>;

export const createBusinessSchema = z.object({
  name: z.string().trim().min(1, 'Nama toko wajib diisi').max(120),
  businessType: z.string().trim().max(60).optional().nullable(),
});
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
