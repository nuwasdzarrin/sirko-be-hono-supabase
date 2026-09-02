import { z } from 'zod';

/**
 * Skema katalog (spec 10 §3) & media (spec 10 §4).
 * public_products GLOBAL: TANPA businessId, TANPA harga/stok.
 */

const barcodeType = z.enum(['EAN13', 'UPC', 'EAN8', 'QR', 'other']);
const source = z.enum(['admin', 'crowdsource']);

/** Field katalog yang bisa ditulis (tanpa harga/stok). */
const catalogFields = {
  barcode: z.string().trim().max(64).nullish(),
  barcodeType: barcodeType.nullish(),
  name: z.string().trim().min(1).max(200),
  shortDescription: z.string().max(500).nullish(),
  photoUrl: z.string().url().max(1000).nullish(),
  brand: z.string().max(120).nullish(),
  category: z.string().max(120).nullish(),
  manufacturer: z.string().max(120).nullish(),
  defaultUnit: z.string().max(40).nullish(),
  netSize: z.number().nullish(),
  netUnit: z.string().max(40).nullish(),
  packaging: z.string().max(80).nullish(),
  variant: z.string().max(120).nullish(),
  countryOfOrigin: z.string().max(80).nullish(),
  keywords: z.array(z.string().max(80)).max(50).optional(),
  verified: z.boolean().optional(),
  source: source.optional(),
};

/** POST /v1/catalog — id opsional (server generate bila absen). */
export const catalogCreateSchema = z.object({
  id: z.string().uuid().optional(),
  ...catalogFields,
});
export type CatalogCreateInput = z.infer<typeof catalogCreateSchema>;

/** PUT /v1/catalog/:id — semua opsional (partial), minimal 1 field. */
export const catalogUpdateSchema = z
  .object({
    barcode: catalogFields.barcode,
    barcodeType: catalogFields.barcodeType,
    name: z.string().trim().min(1).max(200).optional(),
    shortDescription: catalogFields.shortDescription,
    photoUrl: catalogFields.photoUrl,
    brand: catalogFields.brand,
    category: catalogFields.category,
    manufacturer: catalogFields.manufacturer,
    defaultUnit: catalogFields.defaultUnit,
    netSize: catalogFields.netSize,
    netUnit: catalogFields.netUnit,
    packaging: catalogFields.packaging,
    variant: catalogFields.variant,
    countryOfOrigin: catalogFields.countryOfOrigin,
    keywords: catalogFields.keywords,
    verified: catalogFields.verified,
    source: catalogFields.source,
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Tidak ada field untuk diperbarui' });
export type CatalogUpdateInput = z.infer<typeof catalogUpdateSchema>;

export const lookupQuerySchema = z.object({
  barcode: z.string().trim().min(1).max(64),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** POST /v1/media/sign-upload (spec 10 §4). */
export const signUploadSchema = z.object({
  scope: z.enum(['catalog', 'product']),
  fileName: z.string().trim().min(1).max(200),
  contentType: z
    .string()
    .trim()
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'contentType MIME tidak valid')
    .max(120),
  size: z.number().int().positive().max(25 * 1024 * 1024).optional(), // maks 25MB
});
export type SignUploadRequest = z.infer<typeof signUploadSchema>;
