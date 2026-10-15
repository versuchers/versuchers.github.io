#!/usr/bin/env node
/**
 * dist/ içindeki her HTML sayfasından sitemap.xml üretir.
 *
 * Çalıştırma:  astro build && node scripts/make-sitemap.mjs
 *
 * Kural: dist/index.html → https://versucher.com/
 *        dist/film/index.html → https://versucher.com/film/
 *        dist/404.html hariç (hata sayfası indekslenmez).
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://versucher.com';

const walk = (dir) => {
	const res = [];
	for (const e of readdirSync(dir)) {
		const f = path.join(dir, e);
		if (statSync(f).isDirectory()) res.push(...walk(f));
		else if (e.endsWith('.html')) res.push(f);
	}
	return res;
};

const urls = walk(DIST)
	.map((f) => path.relative(DIST, f).split(path.sep).join('/'))
	.filter((p) => p !== '404.html')
	.map((p) => (p === 'index.html' ? '/' : p.endsWith('/index.html') ? `/${p.slice(0, -'index.html'.length)}` : `/${p}`))
	.sort();

const xml =
	'<?xml version="1.0" encoding="UTF-8"?>\n' +
	'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
	urls.map((u) => `\t<url>\n\t\t<loc>${SITE}${u}</loc>\n\t</url>\n`).join('') +
	'</urlset>\n';

writeFileSync(path.join(DIST, 'sitemap.xml'), xml, 'utf-8');
console.log(`sitemap.xml: ${urls.length} sayfa`);
