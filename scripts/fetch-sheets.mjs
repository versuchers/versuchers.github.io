#!/usr/bin/env node
/**
 * Google Sheets'ten (yayınlanmış CSV/TSV) veriyi çeker, normalize eder ve
 * src/data/*.json olarak yazar.
 *
 * Çalıştırma:  npm run fetch
 *
 * Sheet'ler "Bağlantıya sahip olan herkes -> Görüntüleyici" olarak paylaşılmış olmalı.
 * Ağ yoksa mevcut JSON dosyaları korunur (build offline da çalışsın diye).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');

const SOURCES = {
	film: {
		url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT1YHCZZuOjpPo3nKJlYjEAhIUuC8ydUKnfLfHTZG6FnKZnbcDaSVhbQB2YzsGlTunGu97D0VUGKGpn/pub?gid=561093981&single=true&output=tsv',
		delimiter: '\t',
	},
	dizi: {
		url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTkwoU4Jgi5F45dOT3OS7LU4R7iOnp0OU3kUolFNVOz3gTXmic216-s7Ehp2dnNJ_v0EVVLr43_yj9h/pub?gid=0&single=true&output=csv',
		delimiter: ',',
	},
	kitap: {
		url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSEUPPQmFFM-okUlnnxCMh1FR6TAHjBYnFv2K7jtiY4AfSFGFSAAu9qZiqUwJkUyJm8MbhxBAYpmbk8/pub?gid=0&single=true&output=csv',
		delimiter: ',',
	},
};

/** Başlık satırı her sheet'in 3. satırında (index 2). */
const HEADER_ROW_INDEX = 2;

// ---------------------------------------------------------------- CSV parser
/** Tırnak, virgül ve satır sonlarını doğru işleyen basit CSV/TSV çözücü. */
function parseDelimited(text, delimiter) {
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];

		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
			continue;
		}

		if (ch === '"') {
			// Sadece alanın başında gelen tırnak quote sayılır; alan ortasındaki
			// tırnak (ör. oyuncu JSON'u) literal karakterdir.
			if (field === '') {
				inQuotes = true;
			} else {
				field += ch;
			}
		} else if (ch === delimiter) {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (ch === '\r') {
			// yoksay
		} else {
			field += ch;
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

// ------------------------------------------------------------ normalizasyon
const TR_MAP = {
	ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
	Ç: 'c', Ğ: 'g', İ: 'i', I: 'i', Ö: 'o', Ş: 's', Ü: 'u',
};

/** Başlığı URL-güvenli slug'a çevirir. */
function slugify(input) {
	return String(input ?? '')
		.trim()
		.replace(/[çğıöşüÇĞİIÖŞÜ]/g, (c) => TR_MAP[c] ?? c)
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Metinden ilk geçerli 4 haneli yılı (1000-2099) çeker. */
function firstYear(value) {
	const matches = String(value ?? '').match(/\d{4}/g);
	if (!matches) return '';
	for (const m of matches) {
		const y = Number(m);
		if (y >= 1000 && y <= 2099) return m;
	}
	return '';
}

/** Hücre değerini temizler; '-' ve boş değerleri '' yapar. */
function clean(value) {
	const v = String(value ?? '').trim();
	if (v === '' || v === '-' || v === '—' || v === 'N/A') return '';
	return v;
}

/** '{"name":"x","role":"y"}' formatındaki oyuncu listesini ayrıştırır. */
function parseCast(value) {
	const v = clean(value);
	if (!v) return [];
	try {
		const parsed = JSON.parse(v);
		if (Array.isArray(parsed)) {
			return parsed
				.map((p) => ({ name: clean(p.name), role: clean(p.role) }))
				.filter((p) => p.name);
		}
	} catch {
		// JSON değilse virgülle ayrılmış düz metin kabul et
	}
	return v.split(',').map((s) => ({ name: s.trim(), role: '' })).filter((p) => p.name);
}

/** '18.11.2017' veya '07.10.2026 17:30' -> 'YYYY-MM-DD' (sıralama için). */
function toISODate(value) {
	const v = clean(value);
	const m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
	if (!m) return '';
	const [, d, mo, y] = m;
	return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Kolon adı -> index haritası üretir. */
function indexMap(header) {
	const map = {};
	header.forEach((name, i) => {
		const key = clean(name).toUpperCase();
		if (key && !(key in map)) map[key] = i;
	});
	return map;
}

function pick(row, map, ...names) {
	for (const n of names) {
		const i = map[n.toUpperCase()];
		if (i !== undefined && row[i] !== undefined) {
			const v = clean(row[i]);
			if (v) return v;
		}
	}
	return '';
}

// ---------------------------------------------------------------- dönüşümler
function normalizeFilm(row, map) {
	const title = pick(row, map, 'FILM');
	if (!title) return null;
	const year = firstYear(pick(row, map, 'YAPIM YILI'));
	const slug = [slugify(title), year].filter(Boolean).join('-');
	return {
		id: slug,
		slug,
		type: 'film',
		title,
		prefix: pick(row, map, 'ÖN EK'),
		fullTitle: pick(row, map, 'FILM TAM ADI') || title,
		originalTitle: pick(row, map, 'FILM ORIJINAL ADI'),
		year,
		rating: Number(pick(row, map, 'PUAN')) || null,
		review: pick(row, map, 'YORUM'),
		reviewDate: pick(row, map, 'YORUM TARIHI'),
		director: pick(row, map, 'YÖNETMEN'),
		cast: parseCast(row[map['OYUNCULAR']]),
		genre: pick(row, map, 'TÜR'),
		tags: pick(row, map, 'ETIKET'),
		mainTheme: pick(row, map, 'ANA TEMA'),
		language: pick(row, map, 'DILI'),
		screenplay: pick(row, map, 'SENARYO'),
		story: pick(row, map, 'HIKAYE'),
		sourceAuthor: pick(row, map, 'KAYNAK YAZAR'),
		sourceWork: pick(row, map, 'KAYNAK ESER'),
		discovery: pick(row, map, 'NASIL KEŞFETTIM'),
		reason: pick(row, map, 'İZLEME SEBEBIM'),
		firstCity: pick(row, map, 'İLK İZLEDIĞIM ŞEHIR'),
		watchDate: pick(row, map, 'İZLEME TARIHI'),
		watchDateISO: toISODate(pick(row, map, 'İZLEME TARIHI')),
		platform: pick(row, map, 'İLK İZLEDIĞIM PLATFORM'),
		seriesOrder: pick(row, map, 'SERI SIRALAMASI'),
		country: pick(row, map, 'YAPIM ÜLKESI'),
		directorCountry: pick(row, map, 'YÖNETMEN ÜLKESI'),
		color: pick(row, map, 'RENK KODU'),
		homeOrder: Number(pick(row, map, 'ANASAYFA SIRA')) || null,
		rewatchCount: Number(pick(row, map, 'KAÇ KEZ İZLEDIM')) || null,
		poster: pick(row, map, 'FILM AFIŞI LINKI'),
		links: {
			tmdb: pick(row, map, 'TMDB LINKI'),
			imdb: pick(row, map, 'IMDB LINKI'),
			letterboxd: pick(row, map, 'LETTERBOXD LINKI'),
		},
	};
}

function normalizeDizi(row, map) {
	const title = pick(row, map, 'DIZI');
	if (!title) return null;
	const rawYear = pick(row, map, 'YAPIM YILI');
	const startYear = firstYear(rawYear);
	const slug = [slugify(title), startYear].filter(Boolean).join('-');
	return {
		id: slug,
		slug,
		type: 'dizi',
		title,
		year: startYear,
		yearRange: rawYear,
		startedYear: pick(row, map, 'BAŞLADIĞIM YIL'),
		rating: Number(pick(row, map, 'PUAN')) || null,
		review: pick(row, map, 'YORUM'),
		reviewDate: pick(row, map, 'YORUM TARIHI'),
		cast: parseCast(row[map['OYUNCULAR']]),
		genre: pick(row, map, 'TÜR'),
		tags: pick(row, map, 'ETIKET'),
		mainLabel: pick(row, map, 'MAIN LABEL'),
		language: pick(row, map, 'DILI'),
		originalTitle: pick(row, map, 'ORIJINAL ADI'),
		discovery: pick(row, map, 'NASIL KEŞFETTIM'),
		reason: pick(row, map, 'NEDEN İZLEDIM'),
		favoriteSeason: pick(row, map, 'FAVORI SEZON'),
		firstCity: pick(row, map, 'İLK İZLEDIĞIM ŞEHIR'),
		status: pick(row, map, 'DURUMU'),
		format: pick(row, map, 'FORMAT'),
		watched: pick(row, map, 'NE KADARINI İZLEDIM'),
		network: pick(row, map, 'NETWORK'),
		medium: pick(row, map, 'MEDIUM'),
		creator: pick(row, map, 'CREATOR / SHOWRUNNER'),
		platform: pick(row, map, 'İLK İZLEDIĞIM PLATFORM'),
		finished: pick(row, map, 'BITIRDIM MI'),
		finishCount: Number(pick(row, map, 'KAÇ KEZ BITIRDIM')) || null,
		country: pick(row, map, 'YAPIM ÜLKESI'),
		sourceAuthor: pick(row, map, 'KAYNAK YAZAR'),
		sourceWork: pick(row, map, 'KAYNAK ESER'),
		poster: pick(row, map, 'AFIŞ LINKI'),
		links: {
			tmdb: pick(row, map, 'TMDB'),
			imdb: pick(row, map, 'IMDB'),
			tvmaze: pick(row, map, 'TVMAZE'),
		},
	};
}

function normalizeKitap(row, map) {
	const title = pick(row, map, 'TÜRKÇE ADI');
	if (!title) return null;
	const originalYear =
		firstYear(pick(row, map, 'ORIJINAL BASIM YILI')) ||
		firstYear(pick(row, map, 'TÜRÇE İLK BASIM YILI')) ||
		firstYear(pick(row, map, 'OKUDUĞUM YIL'));
	const slug = [slugify(title), originalYear].filter(Boolean).join('-');
	// YAZAR ADI sütunu zaten tam adı içerir; ayrı bir "soyadı" sütunu kullanılmaz.
	const authorName = pick(row, map, 'YAZAR ADI');
	return {
		id: slug,
		slug,
		type: 'kitap',
		title,
		originalTitle: pick(row, map, 'ORIJINAL ADI'),
		author: authorName,
		authorName,
		isbn: pick(row, map, 'ISBN'),
		publisher: pick(row, map, 'YAYINEVI'),
		translator: pick(row, map, 'ÇEVIRMEN'),
		series: pick(row, map, 'SERI'),
		rating: Number(pick(row, map, 'KITAP PUANIM')) || null,
		authorRating: Number(pick(row, map, 'YAZAR PUANIM')) || null,
		review: pick(row, map, 'YORUM'),
		reviewDate: pick(row, map, 'YORUM TARIHI'),
		mainTheme: pick(row, map, 'ANA TEMA'),
		tags: pick(row, map, 'ETIKET'),
		access: pick(row, map, 'ERIŞIM ŞEKLIM'),
		readYear: pick(row, map, 'OKUDUĞUM YIL'),
		reason: pick(row, map, 'OKUMA NEDENIM'),
		discovery: pick(row, map, 'KEŞIF KAYNAĞIM'),
		protagonist: pick(row, map, 'PROTAGONIST'),
		workType: pick(row, map, 'ESER TÜRÜ'),
		format: pick(row, map, 'OKUDUĞUM FORMAT'),
		// KATEGORİ = eski "ANA TÜR" (kitaba özgü üst sınıf)
		category: pick(row, map, 'KATEGORİ', 'KATEGORI', 'ANA TÜR'),
		// TÜR = eski "ALT TÜR" (film/dizi "TÜR" ile aynı havuza girer)
		genre: pick(row, map, 'TÜR', 'ALT TÜR'),
		country: pick(row, map, 'ÜLKE'),
		owned: pick(row, map, 'KITAP BENDE VAR MI'),
		city: pick(row, map, 'OKUDUĞUM ŞEHIR'),
		readLanguage: pick(row, map, 'OKUDUĞUM DIL'),
		originalLanguage: pick(row, map, 'ORIJINAL DILI'),
		pages: Number(pick(row, map, 'SAYFA SAYISI')) || null,
		wouldReread: pick(row, map, 'TEKRAR OKUR MUYUM'),
		authorBirthYear: firstYear(pick(row, map, 'YAZAR DOĞUM YILI')),
		originalYear,
		originalYearRaw: pick(row, map, 'ORIJINAL BASIM YILI'),
		readCount: Number(pick(row, map, 'KAÇ KEZ OKUDUM')) || null,
		poster: pick(row, map, 'KAPAK GÖRSELI'),
		links: {
			goodreads: pick(row, map, "GOODREADS LINKI"),
		},
	};
}

const NORMALIZERS = {
	film: normalizeFilm,
	dizi: normalizeDizi,
	kitap: normalizeKitap,
};

// ------------------------------------------------------------------- çalışma
async function fetchText(url) {
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`HTTP ${res.status} - ${url}`);
	return res.text();
}

function dedupeSlugs(items) {
	const seen = new Map();
	for (const item of items) {
		const base = item.slug || item.title;
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		if (count > 0) {
			item.slug = `${base}-${count + 1}`;
			item.id = item.slug;
		}
	}
}

async function build(key) {
	const { url, delimiter } = SOURCES[key];
	const text = await fetchText(url);
	const rows = parseDelimited(text, delimiter);
	const header = rows[HEADER_ROW_INDEX] ?? [];
	const map = indexMap(header);
	const normalize = NORMALIZERS[key];

	const items = [];
	for (let i = HEADER_ROW_INDEX + 1; i < rows.length; i++) {
		const item = normalize(rows[i] ?? [], map);
		if (item) items.push(item);
	}
	dedupeSlugs(items);
	return items;
}

function describe(key, items) {
	const withPoster = items.filter((i) => i.poster).length;
	console.log(`  ${key.padEnd(6)} ${String(items.length).padStart(3)} kayıt  (afişli: ${withPoster})`);
}

async function main() {
	await mkdir(DATA_DIR, { recursive: true });
	console.log('Google Sheets verisi çekiliyor...\n');

	let failed = false;
	for (const key of Object.keys(SOURCES)) {
		try {
			const items = await build(key);
			const out = resolve(DATA_DIR, `${key}.json`);
			await writeFile(out, JSON.stringify(items, null, '\t') + '\n', 'utf-8');
			describe(key, items);
		} catch (err) {
			failed = true;
			console.error(`  ${key.padEnd(6)} HATA: ${err.message}`);
		}
	}

	console.log('');
	if (failed) {
		// Ağ/toplu kesinti site dağıtımını DÜŞÜRMESİN: mevcut JSON'lar korunur.
		console.warn("⚠️  Bazı sheet'ler çekilemedi. Mevcut JSON dosyaları korundu.");
	} else {
		console.log(`✓ Veri yazıldı: src/data/`);
	}
}

main().catch((e) => {
	console.error('❌ Hata:', e.message || e);
	process.exit(1);
});
