#!/usr/bin/env node
/**
 * dist/ içindeki her HTML sayfasından sitemap.xml üretir.
 *
 * Çalıştırma:  astro build && node scripts/make-sitemap.mjs
 *
 * Kural: dist/index.html → https://versucher.com/
 *        dist/film/index.html → https://versucher.com/film/
 *        dist/404.html hariç (hata sayfası indekslenmez).
 *
 * <lastmod>: içerik sayfaları (film/dizi/kitap/blog) için kaynaktaki gerçek
 * tarih kullanılır; diğer sayfalar için sitedeki en yeni içerik tarihi.
 * Dosya mtime'ı kullanılmaz: CI'da checkout her dosyayı aynı ana damgalar.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');
const SITE = 'https://versucher.com';

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** "DD.MM.YYYY[ HH:mm]" → ISO (gün hassasiyetinde). */
function parseTr(s) {
	const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s || '');
	return m ? iso(m[3], m[2], m[1]) : null;
}

/** "YYYY-MM-DD..." → ISO (gün hassasiyetinde). */
function parseIso(s) {
	const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
	return m ? iso(m[1], m[2], m[3]) : null;
}

/** İçinde geçen 4 haneli yıldan "YYYY-01-01". */
function parseYear(s) {
	const m = /(\d{4})/.exec(String(s ?? ''));
	return m ? iso(m[1], 1, 1) : null;
}

/** Bir kaydın (film/dizi/kitap) son değişiklik tarihi. */
function entryDate(e) {
	return (
		parseTr(e.reviewDate) ||
		parseIso(e.watchDateISO) ||
		parseTr(e.watchDate) ||
		parseYear(e.startedYear) ||
		parseYear(e.readYear) ||
		null
	);
}

// URL → son değişiklik tarihi (ISO, gün).
const lastmod = new Map();
const note = (url, date) => {
	if (date) lastmod.set(url, date);
};

// Kayıtlar: /film/<slug>/, /dizi/<slug>/, /kitap/<slug>/
for (const kind of ['film', 'dizi', 'kitap']) {
	const raw = JSON.parse(readFileSync(path.join(SRC, 'data', `${kind}.json`), 'utf-8'));
	const entries = Array.isArray(raw) ? raw : (raw.entries ?? []);
	for (const e of entries) {
		if (e.slug) note(`/${kind}/${e.slug}/`, entryDate(e));
	}
}

// Blog yazıları: /blog/<slug>/ (dosya adı = slug; _ ile başlayan şablonlar hariç)
const blogDir = path.join(SRC, 'content', 'blog');
for (const f of readdirSync(blogDir)) {
	if (!f.endsWith('.md') || f.startsWith('_')) continue;
	const txt = readFileSync(path.join(blogDir, f), 'utf-8');
	const end = txt.indexOf('\n---', 3);
	const fm = end > 0 ? txt.slice(0, end) : txt.slice(0, 4000);
	const updated = parseIso(/"updatedDate"\s*:\s*"([^"]*)"/.exec(fm)?.[1]);
	const pub = parseIso(/"pubDate"\s*:\s*"([^"]*)"/.exec(fm)?.[1]);
	note(`/blog/${f.replace(/\.md$/, '')}/`, updated || pub);
}

// İçerikten tarih bilinmeyen sayfalar için site geneli en yeni tarih.
const contentDates = [...lastmod.values()].sort();
const now = new Date();
const siteMax = contentDates.at(-1) || iso(now.getFullYear(), now.getMonth() + 1, now.getDate());

const walk = (dir) => {
	const res = [];
	for (const e of readdirSync(dir)) {
		const f = path.join(dir, e);
		if (statSync(f).isDirectory()) res.push(...walk(f));
		else if (e.endsWith('.html')) res.push(f);
	}
	return res;
};

// Yönlendirme sayfaları (meta refresh) ve 404 indekslenmez.
const isRedirectPage = (f) => readFileSync(f, 'utf-8').includes('http-equiv="refresh"');

const urls = walk(DIST)
	.filter((f) => !isRedirectPage(f))
	.map((f) => path.relative(DIST, f).split(path.sep).join('/'))
	.filter((p) => p !== '404.html')
	.map((p) => (p === 'index.html' ? '/' : p.endsWith('/index.html') ? `/${p.slice(0, -'index.html'.length)}` : `/${p}`))
	.sort();

const xml =
	'<?xml version="1.0" encoding="UTF-8"?>\n' +
	'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
	urls
		.map((u) => `\t<url>\n\t\t<loc>${SITE}${u}</loc>\n\t\t<lastmod>${lastmod.get(u) ?? siteMax}</lastmod>\n\t</url>\n`)
		.join('') +
	'</urlset>\n';

writeFileSync(path.join(DIST, 'sitemap.xml'), xml, 'utf-8');
const dated = urls.filter((u) => lastmod.has(u)).length;
console.log(`sitemap.xml: ${urls.length} sayfa (${dated} içerik tarihli, kalanı ${siteMax})`);
