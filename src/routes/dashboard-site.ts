import { Hono, type Context } from 'hono';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import * as site from '../services/site.service.js';
import { renderMarkdown } from '../site/markdown.js';
import { siteHost } from '../site/layout.js';
import { renderLeads, renderSiteEditor, renderSiteList } from '../views/site-admin.view.js';

/**
 * Dashboard → Website (artikel blog & halaman sirkopos.com). Dipasang di bawah gerbang sesi
 * dashboard (lihat routes/dashboard.ts); `send` & `flash` dipinjam dari dashboard agar badge
 * navbar dan pesan flash konsisten.
 */

type Send = (c: Context, html: string, status?: 200 | 404 | 422) => Promise<Response>;
type Flash = (c: Context, type: 'ok' | 'error', msg: string) => void;

const errMsg = (e: unknown): string | null => {
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return i ? `${i.path.join('.') || 'Data'}: ${i.message}` : 'Data tidak valid';
  }
  if (e instanceof AppError && e.status < 500) return e.message;
  return null;
};

export function siteAdminRoutes(send: Send, flash: Flash, adminName: (c: Context) => string) {
  const r = new Hono();
  const kindOf = (seg: string): site.Kind | null => (seg === 'posts' ? 'post' : seg === 'pages' ? 'page' : null);

  r.get('/', (c) => c.redirect('/dashboard/site/posts'));

  /** Pratinjau Markdown → HTML + statistik (dipakai editor, debounce). */
  r.post('/preview', async (c) => {
    const { md } = (await c.req.json().catch(() => ({}))) as { md?: string };
    const out = renderMarkdown(String(md ?? '').slice(0, 200_000), { siteHost: siteHost() });
    return c.json({
      html: out.html,
      words: out.words,
      h2: out.headings.filter((h) => h.depth === 2).length,
      internalLinks: out.internalLinks,
      images: out.images,
      faq: out.faq.length,
    });
  });

  r.post('/upload', async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File) || file.size === 0) return c.json({ error: 'Pilih file gambar.' }, 422);
      const small = body.small;
      if (small instanceof File && small.size > 0) return c.json({ url: await site.uploadCover(file, small) });
      return c.json({ url: await site.uploadImage(file) });
    } catch (e) {
      const m = errMsg(e);
      if (!m) throw e;
      return c.json({ error: m }, 422);
    }
  });

  // ── Pesan masuk dari situs (daftar tunggu, kontak, hapus akun) ──
  r.get('/leads', async (c) => {
    const s = c.req.query('status') === 'done' ? 'done' : c.req.query('status') === 'semua' ? 'semua' : 'new';
    return send(c, renderLeads(await site.leadList({ status: s }), { status: s, serverTime: Date.now() }));
  });
  r.post('/leads/:id', async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    await site.markLead(c.req.param('id'), body.done === '1', adminName(c));
    return c.redirect('/dashboard/site/leads');
  });

  r.get('/:seg', async (c) => {
    const kind = kindOf(c.req.param('seg'));
    if (!kind) return c.notFound();
    const s = c.req.query('status') ?? 'semua';
    const status = (['semua', 'draft', 'published', 'scheduled'] as const).find((x) => x === s) ?? 'semua';
    const q = (c.req.query('q') ?? '').slice(0, 80);
    return send(c, renderSiteList(kind, await site.adminList({ kind, status, q }), { status, q, serverTime: Date.now() }));
  });

  r.get('/:seg/new', (c) => {
    const kind = kindOf(c.req.param('seg'));
    if (!kind) return c.notFound();
    return send(c, renderSiteEditor(kind, null, { serverTime: Date.now() }));
  });

  r.get('/:seg/:id', async (c) => {
    const kind = kindOf(c.req.param('seg'));
    const p = kind ? await site.getById(c.req.param('id')) : null;
    if (!kind || !p || p.kind !== kind) return c.notFound();
    return send(c, renderSiteEditor(kind, p, { serverTime: Date.now(), revisions: await site.revisions(p.id) }));
  });

  const save = async (c: Context, id: string | null) => {
    const kind = kindOf(c.req.param('seg') ?? '');
    if (!kind) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, string>;
    try {
      const p = await site.save(id, { ...body, kind, noindex: body.noindex === 'on' } as site.PostInput, adminName(c));
      flash(c, 'ok', `${kind === 'post' ? 'Artikel' : 'Halaman'} disimpan${p.status === 'published' ? (site.isLive(p) ? ' & terbit' : ' & dijadwalkan') : ' sebagai draf'}.`);
      return c.redirect(`/dashboard/site/${c.req.param('seg')}/${p.id}`);
    } catch (e) {
      const m = errMsg(e);
      if (!m) throw e;
      const p = id ? await site.getById(id) : null;
      return send(c, renderSiteEditor(kind, p, { error: m, values: body, serverTime: Date.now() }), 422);
    }
  };
  r.post('/:seg', (c) => save(c, null));
  r.post('/:seg/:id', (c) => save(c, c.req.param('id')));

  r.post('/:seg/:id/revisions/:rid', async (c) => {
    try {
      await site.restoreRevision(c.req.param('id'), c.req.param('rid'), adminName(c));
      flash(c, 'ok', 'Revisi dipulihkan. Versi sebelumnya tersimpan di riwayat.');
    } catch (e) {
      const m = errMsg(e);
      if (!m) throw e;
      flash(c, 'error', m);
    }
    return c.redirect(`/dashboard/site/${c.req.param('seg')}/${c.req.param('id')}`);
  });

  r.post('/:seg/:id/delete', async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    try {
      await site.remove(c.req.param('id'), body.redirectTo);
      flash(c, 'ok', body.redirectTo ? `Konten dihapus & dialihkan ke ${body.redirectTo}.` : 'Konten dihapus. URL lama kini menjawab 410.');
    } catch (e) {
      const m = errMsg(e);
      if (!m) throw e;
      flash(c, 'error', m);
    }
    return c.redirect(`/dashboard/site/${c.req.param('seg')}`);
  });


  return r;
}
