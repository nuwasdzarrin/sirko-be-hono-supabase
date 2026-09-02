import type { Context } from 'hono';
import type { AppEnv } from '../types.ts';
import { ok } from '../lib/envelope.ts';
import {
  lookupQuerySchema,
  searchQuerySchema,
  catalogCreateSchema,
  catalogUpdateSchema,
} from '../schemas/catalog.schema.ts';
import { notFound } from '../lib/errors.ts';
import { isUuid } from '../lib/uuid.ts';
import * as catalog from '../services/catalog.service.ts';

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
  const { data, meta } = await catalog.search(query);
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
