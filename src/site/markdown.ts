import { Marked, type Tokens } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { env } from '../config/env.js';

/**
 * Markdown artikel/halaman → HTML aman untuk website publik.
 * - Judul ##/### diberi id (jangkar daftar isi) & dikumpulkan untuk TOC.
 * - Tautan eksternal: rel="noopener" (+ nofollow bila diminta), buka tab baru.
 * - Gambar: loading="lazy" decoding="async".
 * - Bagian "## Tanya jawab" (### pertanyaan + paragraf jawaban) → data FAQ untuk schema FAQPage.
 * - Hasil selalu disaring sanitize-html (penulis = admin, tetap tak dipercaya).
 * - Token `[EMAIL KONTAK]` → email resmi (SITE_CONTACT_EMAIL) atau tautan formulir /kontak, saat render.
 * - Gambar unggahan membawa ukuran di fragmen URL (`#w=1200&h=800`) → width/height (cegah CLS).
 */

/** Ganti token kontak di Markdown dengan kontak resmi terkini. */
export function withContact(md: string): string {
  const email = env.SITE_CONTACT_EMAIL;
  const repl = email ? `[${email}](mailto:${email})` : '[formulir kontak Sirko](/kontak)';
  return md
    .replace(/\*\*\[EMAIL KONTAK\]\*\*|\[EMAIL KONTAK\]/g, `**${repl}**`)
    .replace(/\[PENGELOLA\]/g, env.SITE_OPERATOR || 'tim pengelola Sirko');
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}
export interface FaqItem {
  q: string;
  a: string;
}
export interface Rendered {
  html: string;
  headings: Heading[];
  faq: FaqItem[];
  words: number;
  readingMinutes: number;
  internalLinks: number;
  images: Array<{ src: string; alt: string }>;
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const FAQ_HEADING = /^(tanya jawab|pertanyaan (yang )?sering diajukan|faq)\b/i;

export function renderMarkdown(md: string, opts: { siteHost?: string } = {}): Rendered {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const images: Rendered['images'] = [];
  let internalLinks = 0;
  const host = (opts.siteHost ?? 'sirkopos.com').toLowerCase();

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Heading) {
        const inner = this.parser.parseInline(t.tokens);
        const text = plain(inner);
        let id = slugify(text) || `bagian-${headings.length + 1}`;
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n + 1}`;
        // Isi artikel tak boleh punya H1 (judul halaman sudah H1) → turunkan ke H2.
        const depth = Math.min(Math.max(t.depth, 2), 4);
        headings.push({ depth, text, id });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Link) {
        const inner = this.parser.parseInline(t.tokens);
        const href = t.href ?? '';
        let external = false;
        try {
          const u = new URL(href, `https://${host}/`);
          external = u.hostname.toLowerCase() !== host && u.hostname.toLowerCase() !== `www.${host}`;
        } catch {
          external = false;
        }
        if (!external) internalLinks++;
        const title = t.title ? ` title="${escAttr(t.title)}"` : '';
        return external
          ? `<a href="${escAttr(href)}"${title} target="_blank" rel="noopener">${inner}</a>`
          : `<a href="${escAttr(href)}"${title}>${inner}</a>`;
      },
      image(t: Tokens.Image) {
        const dim = /#w=(\d{2,5})&h=(\d{2,5})$/.exec(t.href);
        const src = dim ? t.href.slice(0, dim.index) : t.href;
        images.push({ src, alt: t.text ?? '' });
        const title = t.title ? ` title="${escAttr(t.title)}"` : '';
        const wh = dim ? ` width="${dim[1]}" height="${dim[2]}"` : '';
        return `<img src="${escAttr(src)}" alt="${escAttr(t.text ?? '')}"${title}${wh} loading="lazy" decoding="async">`;
      },
    },
  });

  const raw = marked.parse(withContact(md ?? ''), { async: false }) as string;
  const html = sanitizeHtml(raw, {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'mark', 'small', 'sub', 'sup',
      'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'loading', 'decoding', 'width', 'height'],
      h2: ['id'], h3: ['id'], h4: ['id'],
      th: ['align'], td: ['align'],
      ol: ['start'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // Tautan tab baru (termasuk dari HTML mentah) selalu rel=noopener.
    transformTags: {
      a: (tagName, attribs) => (attribs.target === '_blank' ? { tagName, attribs: { ...attribs, rel: 'noopener' } } : { tagName, attribs }),
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
  });

  const text = plain(html);
  const words = text ? text.split(' ').length : 0;
  return {
    html: wrapTables(html),
    headings,
    faq: extractFaq(md ?? ''),
    words,
    readingMinutes: Math.max(1, Math.round(words / 200)),
    internalLinks,
    images,
  };
}

/** Tabel lebar bisa digeser di HP tanpa merusak tata letak. */
function wrapTables(html: string): string {
  return html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
}

/** Ambil "## Tanya jawab" → [### pertanyaan, paragraf jawaban…] untuk schema FAQPage. */
export function extractFaq(md: string): FaqItem[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => /^##\s+/.test(l) && FAQ_HEADING.test(l.replace(/^##\s+/, '').trim()));
  if (start < 0) return [];
  const out: FaqItem[] = [];
  // Jawaban = paragraf pertama sesudah ### pertanyaan (paragraf berikutnya, mis. ajakan penutup, diabaikan).
  let cur: { q: string; a: string[]; closed: boolean } | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^##\s+/.test(l)) break;
    const q = /^###\s+(.+)$/.exec(l);
    if (q) {
      if (cur && cur.a.length) out.push({ q: cur.q, a: cur.a.join(' ') });
      cur = { q: stripMd(q[1]!), a: [], closed: false };
    } else if (cur && !cur.closed) {
      if (l.trim()) cur.a.push(stripMd(l.trim()));
      else if (cur.a.length) cur.closed = true;
    }
  }
  if (cur && cur.a.length) out.push({ q: cur.q, a: cur.a.join(' ') });
  return out;
}

function stripMd(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
