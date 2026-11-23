-- Sampul bawaan repo dikonversi ke WebP (public/site/img/blog/<slug>.webp + -600.webp; .jpg tetap untuk og:image).
UPDATE site_posts
   SET cover_url = regexp_replace(cover_url, '\.jpg$', '.webp')
 WHERE cover_url ~ '^/img/blog/[a-z0-9-]+\.jpg$';
