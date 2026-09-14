import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { ok } from '../lib/envelope.js';
import {
  lookupQuerySchema,
  searchQuerySchema,
  catalogCreateSchema,
  catalogUpdateSchema,
  catalogContributionSchema,
  contributionListQuerySchema,
} from '../schemas/catalog.schema.js';
import { notFound, validation } from '../lib/errors.js';
import { isUuid } from '../lib/uuid.js';
import * as catalog from '../services/catalog.service.js';
import * as contributions from '../services/catalog-contribution.service.js';

export async function handleCatalogLookup(c: Context<AppEnv>) {
  const { barcode } = lookupQuerySchema.parse({ barcode: c.req.query('barcode') });
  const product = await catalog.lookup(barcode);
  return c.json(ok(product), 200);
}

export async function handleCatalogSearch(c: Context<AppEnv>) {
  const query = searchQuerySchema.parse({
    q: c.req.query('q'),
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });
  const verified = catalog.parseVerified(c.req.query('verified'));
  const { data, meta } = await catalog.search(query, verified);
  return c.json(ok(data, meta), 200);
}

// ── Kontribusi katalog (toko biasa, dengan moderasi) ─────────────────────────

export async function handleContributionSubmit(c: Context<AppEnv>) {
  const auth = c.get('auth');
  if (!auth?.businessId) throw validation('Hanya akun toko yang bisa mengusulkan produk');
  const input = catalogContributionSchema.parse(await c.req.json());
  const created = await contributions.submit(auth.businessId, auth.userId, input);
  return c.json(ok(created), 201);
}

export async function handleContributionListMine(c: Context<AppEnv>) {
  const auth = c.get('auth');
  if (!auth?.businessId) throw validation('Hanya akun toko yang punya daftar usulan');
  const query = contributionListQuerySchema.parse({
    status: c.req.query('status'),
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });
  const { data, meta } = await contributions.listMine(auth.businessId, query);
  return c.json(ok(data, meta), 200);
}

export async function handleCatalogCreate(c: Context<AppEnv>) {
  const input = catalogCreateSchema.parse(await c.req.json());
  const product = await catalog.create(input);
  return c.json(ok(product), 201);
}

export async function handleCatalogUpdate(c: Context<AppEnv>) {
  const id = c.req.param('id');
  if (!isUuid(id)) throw notFound('Produk katalog tidak ditemukan');
  const input = catalogUpdateSchema.parse(await c.req.json());
  const product = await catalog.update(id, input);
  return c.json(ok(product), 200);
}

export async function handleCatalogDelete(c: Context<AppEnv>) {
  const id = c.req.param('id');
  if (!isUuid(id)) throw notFound('Produk katalog tidak ditemukan');
  const result = await catalog.remove(id);
  return c.json(ok(result), 200);
}
