#!/usr/bin/env node
/**
 * Blogger (Google Takeout) feed.atom içe aktarıcı.
 *
 * Yalnızca YAYIMLANMIŞ yazıları (status=LIVE, POST, trashed değil) seçer ve
 * src/content/blog/ altına markdown dosyası olarak yazar. Blogger gövdesi HTML
 * olduğu için markdown yerine frontmatter'daki `contentHtml` alanına konur.
 *
 * Kullanım:
 *   node scripts/import-blogger.mjs ["/path/to/feed.atom"]
 *   npm run import:blogger
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const DEFAULT_FEED =
	'/home/versucher/Downloads/Takeout/Blogger/Blogs/p v t   p e k m e z i /feed.atom';
const feedPath = process.argv[2] || DEFAULT_FEED;
const outDir = path.resolve('src/content/blog');

if (!fs.existsSync(feedPath)) {
	console.error(`Feed bulunamadı: ${feedPath}`);
	process.exit(1);
}

const xml = fs.readFileSync(feedPath, 'utf8');

/* ------------------------------------------------------------------ yardımcılar */

/** XML katmanını (tek seviye) çözer. &amp; en sonda; &nbsp; korunur. */
function decodeXml(s) {
	return (s || '')
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function safeChar(code) {
	try {
		return String.fromCodePoint(code);
	} catch {
		return '';
	}
}

function stripTags(html) {
	return (html || '')
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<\/p>/gi, ' ')
		.replace(/<[^>]+>/g, '');
}

function excerpt(html, max = 200) {
	const text = stripTags(html)
		.replace(/&nbsp;/g, ' ')
		.replace(/&[a-zA-Z]+;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length <= max) return text;
	return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

const TR_MAP = {
	ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o',
	ş: 's', Ş: 's', ü: 'u', Ü: 'u', â: 'a', î: 'i', û: 'u',
};

function slugify(s) {
	return (s || '')
		.trim()
		.replace(/[çÇğĞıİöÖşŞüÜâîû]/g, (c) => TR_MAP[c] ?? c)
		.toLowerCase()
		.replace(/['"’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

/** Blogger gövdesini temizler: script'leri ve temaya zarar veren inline stilleri atar. */
function cleanHtml(html) {
	let out = (html || '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
	out = out.replace(/\sdata-darkreader-inline-[a-zA-Z-]+="[^"]*"/gi, '');
	out = out.replace(/\sdata-darkreader-inline-[a-zA-Z-]+='[^']*'/gi, '');

	const cleanDecls = (decls) => {
		const strip = [
			'color',
			'background',
			'background-color',
			'font-family',
			'font-size',
			'line-height',
			'letter-spacing',
			'-webkit-text-stroke',
		];
		const kept = decls
			.split(';')
			.map((d) => d.trim())
			.filter(Boolean)
			.filter((d) => {
				const prop = d.split(':')[0].trim().toLowerCase();
				if (!prop || prop.startsWith('--')) return false; // darkreader değişkenleri
				return !strip.includes(prop);
			});
		return kept.length ? ` style="${kept.join('; ')}"` : '';
	};

	out = out.replace(/\sstyle="([^"]*)"/gi, (_, decls) => cleanDecls(decls));
	out = out.replace(/\sstyle='([^']*)'/gi, (_, decls) => cleanDecls(decls));
	return out.trim();
}

function tag(block, name) {
	const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
	return m ? m[1] : '';
}

function dateOnly(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ ayrıştırma */

const entries = xml
	.split('<entry>')
	.slice(1)
	.map((s) => s.split('</entry>')[0]);

const posts = [];
for (const b of entries) {
	const type = (b.match(/<blogger:type>(POST|PAGE|COMMENT)<\/blogger:type>/) || [])[1];
	const status = (b.match(/<blogger:status>(DRAFT|LIVE|SCHEDULED|UNKNOWN)<\/blogger:status>/) || [])[1];
	const trashed = /<blogger:trashed>trashed<\/blogger:trashed>/.test(b);
	if (type !== 'POST') continue;
	if (status !== 'LIVE') continue;
	if (trashed) continue;

	const title = decodeXml(tag(b, 'title')).trim();
	const rawContent = decodeXml(tag(b, 'content'));
	const filename = tag(b, 'blogger:filename').trim();
	const published = tag(b, 'published') || tag(b, 'blogger:created');
	const updated = tag(b, 'updated');
	const tags = [...b.matchAll(/<category[^>]*term='([^']*)'[^>]*\/>/g)].map((m) =>
		decodeXml(m[1]).trim(),
	);
	const encrypted = /type=["']text\/sp-enc["']/i.test(rawContent);
	// Şifreli (sp-enc) yazılarda çözme yükünü sakla (base64 → {salt,iv,hmac,cipher,hint}).
	const encMatch = rawContent.match(
		/<script[^>]*type=["']text\/sp-enc["'][^>]*>([\s\S]*?)<\/script>/i,
	);
	const encPayload = encMatch ? encMatch[1].trim() : '';

	// slug: /2014/06/baslik.html → baslik (+ çakışmada yıl-ay)
	const m = filename.match(/\/(\d{4})\/(\d{2})\/([^/]+)\.html?$/);
	const base = slugify(m ? m[3] : title) || 'yazi';
	const yearMonth = m ? `${m[1]}-${m[2]}` : '';

	const content = cleanHtml(rawContent);

	posts.push({
		title,
		content,
		description: excerpt(content),
		pubDate: dateOnly(published),
		updatedDate: dateOnly(updated),
		tags: [...new Set(tags.filter(Boolean))],
		source: filename,
		encrypted,
		encPayload,
		base,
		yearMonth,
	});
}

// tarihe göre eskiden yeniye
posts.sort((a, b) => (a.pubDate < b.pubDate ? -1 : a.pubDate > b.pubDate ? 1 : 0));

// slug çakışmalarını çöz
const used = new Set();
for (const p of posts) {
	let slug = p.base;
	if (used.has(slug)) slug = [p.base, p.yearMonth].filter(Boolean).join('-');
	while (used.has(slug)) slug = `${slug}-2`;
	used.add(slug);
	p.slug = slug;
}

/* ------------------------------------------------------------------ yazma */

fs.mkdirSync(outDir, { recursive: true });

let written = 0;
for (const p of posts) {
	const frontmatter = {
		title: p.title,
		description: p.description,
		pubDate: p.pubDate,
		...(p.updatedDate && p.updatedDate !== p.pubDate ? { updatedDate: p.updatedDate } : {}),
		tags: p.tags,
		draft: false,
		source: p.source,
		encrypted: p.encrypted,
		...(p.encPayload ? { encPayload: p.encPayload } : {}),
		contentHtml: p.content,
	};
	const yaml = YAML.stringify(frontmatter, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' });
	const file = path.join(outDir, `${p.slug}.md`);
	fs.writeFileSync(file, `---\n${yaml}---\n`, 'utf8');
	written++;
}

/* ------------------------------------------------------------------ özet */

const dates = posts.map((p) => p.pubDate).filter(Boolean).sort();
const enc = posts.filter((p) => p.encrypted).length;
console.log(`Feed: ${feedPath}`);
console.log(`Yayımlanmış yazı (POST + LIVE): ${posts.length}`);
console.log(`Tarih aralığı: ${dates[0]} → ${dates[dates.length - 1]}`);
console.log(`Şifreli (sp-enc) yazı: ${enc}`);
console.log(`Yazıldı: ${written} dosya → ${path.relative(process.cwd(), outDir)}/`);
