import { z } from 'zod';

/** Skema request auth (spec 10 §1). Validasi ketat; invalid → 422 VALIDATION. */

const emailSchema = z.string().trim().toLowerCase().email().max(255);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+][0-9]{6,19}$/, 'Nomor telepon tidak valid');
const passwordSchema = z.string().min(6, 'Password minimal 6 karakter').max(200);

export const registerBusinessSchema = z.object({
  business: z.object({
    name: z.string().trim().min(1).max(120),
    businessType: z.string().trim().max(60).optional().nullable(),
  }),
  owner: z
    .object({
      name: z.string().trim().min(1).max(120),
      email: emailSchema.optional().nullable(),
      phone: phoneSchema.optional().nullable(),
      password: passwordSchema,
    })
    .refine((o) => o.email || o.phone, {
      message: 'Wajib isi email atau phone',
      path: ['email'],
    }),
});
export type RegisterBusinessInput = z.infer<typeof registerBusinessSchema>;

export const loginSchema = z.object({
  emailOrPhone: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;
